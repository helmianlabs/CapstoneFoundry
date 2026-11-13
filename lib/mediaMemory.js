// lib/mediaMemory.js — write and recall media (image/video) rows in memory_items.
//
// Reuses the shared pool + embed helpers from api/memory.js so we hit the same
// Neon connection pool and the same OpenAI key.  Nothing new is configured.
//
// Schema note: media rows live alongside text facts in memory_items.  They
// differ only in kind ('image' | 'video') and have a non-null blob_url column
// (added by docs/migration-media-memory-2026-06-06.sql).
//
// Exported functions:
//   saveMediaMemory({ userId, type, blobUrl, prompt, createdAt? })
//     → writes one row; fires-and-forgets embedding (failure is non-fatal).
//   retrieveMedia({ userId, query, limit, mediaType, tenantId, filed })
//     → cosine similarity on the query embedding, mixed with a recency bonus
//       when a query is given; with no query the listing is organized BY
//       NAME (subject, case-insensitive — Troy's order 2026-11-13).
//       returns [{id, type, blobUrl, caption, name, createdAt, score, filed}]
//   setMediaFiled({ userId, tenantId, id, state })
//     → files/unfiles one row. Filing state rides the memory_items.category
//       column (added 2026-11-13): 'filed' = the user's Saved place (out of
//       the main list, never deleted, reopenable), 'test-residue' = agent
//       test artifacts archived out of every gallery view (recoverable in
//       the DB), anything else = the main list ('general').

import { getPool, embed, vecLiteral } from '../server/handlers/memory.js';
import { ensureMemoryCategoryColumn } from './memorySchema.js';

// The display name of a media row: its subject up to the " — " separator
// the builders write ("<page title> — <original prompt>").
export function mediaName(subject, caption) {
  const raw = String(subject || caption || '').trim();
  const cut = raw.indexOf(' — ');
  const name = (cut > 0 ? raw.slice(0, cut) : raw).trim();
  return name || 'Untitled';
}

/**
 * Save a media row into memory_items.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {'image'|'video'} opts.type
 * @param {string} opts.blobUrl  — public Vercel Blob URL
 * @param {string} opts.prompt   — the generation prompt / caption
 * @param {number} [opts.createdAt]  — unix ms timestamp (defaults to Date.now())
 */
export async function saveMediaMemory({ userId, type, blobUrl, prompt, createdAt, tenantId = null }) {
  if (!userId || !blobUrl || !prompt) return;
  const pool = getPool();
  const kind = type === 'video' ? 'video' : type === 'model3d' ? 'model3d' : type === 'artifact' ? 'artifact' : type === 'document' ? 'document' : 'image';
  const subject = String(prompt).slice(0, 120);
  const content = String(prompt).slice(0, 500);
  const ts      = createdAt ? new Date(createdAt) : new Date();
  // Tenant stamp (store build): written ONLY when the caller resolved a
  // tenant (enforced mode) — the same conditional-column pattern as
  // server/handlers/memory.js, so compat-mode inserts keep the original
  // column list byte-for-byte (the live DB predates the tenant columns).
  const tenant = typeof tenantId === 'string' && tenantId ? tenantId : null;

  let vec = null;
  try {
    vec = await embed(prompt);
  } catch (e) {
    console.error('[mediaMemory] embed failed (non-fatal):', e?.message || e);
  }

  try {
    const params = [userId, kind, subject, content, blobUrl];
    let vecClause = 'NULL';
    if (vec) { params.push(vecLiteral(vec)); vecClause = `$${params.length}::vector`; }
    params.push(ts, ts);
    const ts1 = params.length - 1;
    const ts2 = params.length;
    let tenantClauseCols = '';
    let tenantClauseVals = '';
    if (tenant) {
      params.push(tenant);
      tenantClauseCols = ', tenant_id';
      tenantClauseVals = `, $${params.length}`;
    }
    await pool.query(
      `INSERT INTO memory_items
         (user_id, scope, kind, subject, content, blob_url, embedding,
          confidence, importance, created_at, updated_at${tenantClauseCols})
       VALUES ($1, 'semantic', $2, $3, $4, $5, ${vecClause},
               0.8, 0.7, $${ts1}, $${ts2}${tenantClauseVals})`,
      params
    );
  } catch (err) {
    console.error('[mediaMemory] INSERT failed:', err?.message || err);
  }
}

/**
 * Retrieve past media for a user, ranked by cosine similarity to a text query
 * plus a recency bonus, or by recency alone when no query is provided.
 *
 * Ranking formula (when query provided):
 *   score = (1 - cosine_distance) * 0.7  +  recency_score * 0.3
 *   recency_score = exp(-age_days / 30)   so items within ~30 days stay relevant
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.query]   — optional natural-language recall query
 * @param {number} [opts.limit]   — default 30
 * @param {'image'|'video'|'all'} [opts.mediaType] — filter by kind
 * @param {boolean} [opts.filed]  — true lists only the Saved (filed) place;
 *                                  false (default) the main list
 * @returns {Promise<Array<{id,type,blobUrl,caption,name,createdAt,score,filed}>>}
 */
export async function retrieveMedia({ userId, query, limit = 30, mediaType = 'all', tenantId = null, filed = false }) {
  if (!userId) return [];
  const pool = getPool();
  // The filing filters below read memory_items.category — make sure the
  // column exists first (idempotent; same guard as the memory paths).
  await ensureMemoryCategoryColumn(pool);
  // Default view = the main list: user-filed rows and archived test
  // residue are excluded. filed=true lists ONLY the Saved place.
  const filedClause = filed
    ? `AND category = 'filed'`
    : `AND (category IS NULL OR category NOT IN ('filed', 'test-residue'))`;
  const shape = (rows) => rows.map(({ subject, category, ...rest }) => ({
    ...rest,
    name: mediaName(subject, rest.caption),
    filed: category === 'filed',
  }));
  // Tenant scope (enforced mode only; null = the original user_id-only
  // queries, byte-for-byte, for compat mode). Tenant-era identity rule
  // (same as server/handlers/memory.js retrieveMemories): in enforced
  // mode tenant_id is the ONLY identity filter — a tenant's rows may
  // carry a legacy user_id sub-identity and must still be found.
  const tenant = typeof tenantId === 'string' && tenantId ? tenantId : null;
  const identityCol = tenant ? 'tenant_id' : 'user_id';
  const identityId = tenant || userId;

  const kindFilter = mediaType === 'image'
    ? `AND kind = 'image'`
    : mediaType === 'video'
      ? `AND kind = 'video'`
      : mediaType === 'model3d' ? `AND kind = 'model3d'` : mediaType === 'artifact' ? `AND kind = 'artifact'` : mediaType === 'document' ? `AND kind = 'document'` : `AND kind IN ('image','video','model3d','artifact','document')`;

  // With query: cosine similarity + recency blend
  if (query) {
    let vec = null;
    try {
      vec = await embed(query);
    } catch (e) {
      console.error('[mediaMemory] embed for recall failed:', e?.message || e);
    }

    if (vec) {
      const params = [identityId, vecLiteral(vec)];
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT id,
                kind                AS type,
                blob_url            AS "blobUrl",
                content             AS caption,
                subject,
                category,
                created_at          AS "createdAt",
                (
                  (1 - (embedding <=> $2::vector)) * 0.7
                  + EXP(-EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 / 30.0) * 0.3
                )                   AS score
           FROM memory_items
          WHERE (${identityCol} = $1 OR kind = 'artifact')
            AND blob_url IS NOT NULL
            AND embedding IS NOT NULL
            AND (valid_until IS NULL OR valid_until > now())
            AND supersedes IS NULL
            ${kindFilter}
            ${filedClause}
          ORDER BY score DESC
          LIMIT $${params.length}`,
        params
      );
      return shape(rows);
    }
    // Embedding failed — fall through to recency-only
  }

  // No query: the plain gallery listing — organized BY NAME (subject,
  // case-insensitive; newest first inside an identical name), per Troy's
  // 2026-11-13 order that websites live in the database sorted by name.
  // (This path is also the fallback when a query's embedding fails.)
  const fallbackParams = [identityId, limit];
  const { rows } = await pool.query(
    `SELECT id,
            kind       AS type,
            blob_url   AS "blobUrl",
            content    AS caption,
            subject,
            category,
            created_at AS "createdAt",
            importance AS score
       FROM memory_items
      WHERE (${identityCol} = $1 OR kind = 'artifact')
        AND blob_url IS NOT NULL
        AND (valid_until IS NULL OR valid_until > now())
        AND supersedes IS NULL
        ${kindFilter}
        ${filedClause}
      ORDER BY LOWER(subject) ASC, created_at DESC
      LIMIT $2`,
    fallbackParams
  );
  return shape(rows);
}

/**
 * File or unfile one media row (see the header note for the states).
 * Scoped exactly like the gallery read: the caller's own rows, plus
 * artifacts (which the gallery shows to every identity).
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string|null} [opts.tenantId]
 * @param {number|string} opts.id     — memory_items row id
 * @param {'filed'|'general'|'test-residue'} opts.state
 * @returns {Promise<boolean>} true when a row was updated
 */
export async function setMediaFiled({ userId, tenantId = null, id, state }) {
  if (!userId || id == null || !['filed', 'general', 'test-residue'].includes(state)) return false;
  const pool = getPool();
  await ensureMemoryCategoryColumn(pool);
  const tenant = typeof tenantId === 'string' && tenantId ? tenantId : null;
  const identityCol = tenant ? 'tenant_id' : 'user_id';
  const identityId = tenant || userId;
  const { rowCount } = await pool.query(
    `UPDATE memory_items
        SET category = $1, updated_at = now()
      WHERE id = $2
        AND blob_url IS NOT NULL
        AND (${identityCol} = $3 OR kind = 'artifact')`,
    [state, id, identityId]
  );
  return rowCount > 0;
}
