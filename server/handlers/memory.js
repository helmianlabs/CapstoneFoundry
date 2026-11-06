// api/memory.js — per-user persistent memory store for ThinkinBuddy.
//
// 2026-06-02: REWRITTEN from Vercel Blob → Neon Postgres + pgvector.
// Spec: thinkinbuddy/docs/persistent-memory-spec-2026-05-27.md
//
// HTTP CONTRACT PRESERVED so the ElevenLabs widget's `save_memory` tool keeps
// the same body shape. Authorization is separate from that shape: a userId
// UUID never authorizes the call (authorizeMemoryAccess). Browser callers
// send a session; the tool sends X-Webhook-Secret.
//   GET    /api/memory?userId=...                  → { userId, facts: [...] }
//   POST   /api/memory   body { userId, key, value } → { ok, fact }
//   DELETE /api/memory?userId=...&key=...           → { ok }
//
// MAPPING legacy {key, value} → spec {subject, content}:
//   subject ← key (canonical short noun-phrase)
//   content ← value (the durable fact)
//   kind    ← 'fact' (default; extractor handles richer kinds)
//   scope   ← 'semantic'
//
// Embeddings: Gemini gemini-embedding-001 at 1536 dims (free tier) first,
// OpenAI text-embedding-3-small (1536 dims) as fallback — Troy's free-road
// steer, 2026-11-05. Both fit the VECTOR(1536) column; embed() normalizes
// Gemini's output (not pre-normalized below 3072 dims) so every consumer
// sees unit vectors exactly as with OpenAI's.
// Semantic dedup: skipped for v1 of the rewrite — TODO wire SIM_UPDATE/
// SIM_CONFLICT_LO logic per spec lines 355-468. Current behavior:
//   - Same (user_id, scope='semantic', kind='fact', subject=key) → UPDATE.
//   - Else INSERT new row.
// This keeps the widget contract idempotent on `key` without LLM round-trips.

import { Pool } from 'pg';
import OpenAI from 'openai';
import { authorizeMemoryAccess } from '../../lib/tenant.js';

const DB_URL = process.env.DATABASE_URL_MEMORY || process.env.DATABASE_URL;

// Module-scoped pool — reused across warm Lambda invocations.
let _pool = null;
function getPool() {
  if (!_pool) {
    if (!DB_URL) throw new Error('DATABASE_URL_MEMORY (or DATABASE_URL) not set');
    _pool = new Pool({
      connectionString: DB_URL,
      max: 3,
      idleTimeoutMillis: 10_000,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

async function embedViaOpenAI(text) {
  const oa = getOpenAI();
  const res = await oa.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

async function embedViaGemini(text) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: 1536,
      }),
    }
  );
  if (!r.ok) throw new Error(`Gemini embed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== 1536) {
    throw new Error('Gemini embed: unexpected response shape');
  }
  // Below 3072 dims the API does not pre-normalize; normalize so stored and
  // query vectors are unit length, matching OpenAI's output contract.
  let norm = 0;
  for (const v of values) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return values.map((v) => v / norm);
}

async function embed(text) {
  const trimmed = String(text || '').slice(0, 8000);
  if (!trimmed) return null;
  // Free road first (Troy, 2026-11-05): Gemini when its key is present, with
  // the OpenAI call kept as fallback. If both fail, the OpenAI error throws —
  // the exact failure surface callers already handle (NULL row / boot-fallback).
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY) {
    try {
      return await embedViaGemini(trimmed);
    } catch {
      /* fall through to OpenAI */
    }
  }
  return embedViaOpenAI(trimmed);
}

function vecLiteral(vec) {
  return `[${vec.join(',')}]`;
}


export function classifyMemoryCategory(subject = '', content = '') {
  const text = `${subject} ${content}`.toLowerCase();
  if (/\b(code|api|github|git|bug|endpoint|build|deploy|vercel|database|postgres|neon|sql|schema|migration|relay|spoke|helmian|software|npm|package|frontend|backend|app)\b/.test(text)) {
    return 'build';
  }
  if (/\b(dfa|truck|trucking|hauler|hauling|dairyforge|dispatch|customer|client|sales|pricing|bid|contract|tms|business|company|carrier)\b/.test(text)) {
    return 'business';
  }
  if (/\b(spanish|language|tutor|curriculum|feynman|lesson|learn|study|homework|school|math|grade)\b/.test(text)) {
    return 'learning';
  }
  if (/\b(money|finance|credit|loan|interest|mortgage|bank|revenue|expense|bill|cost|dollar|price|fee)\b/.test(text)) {
    return 'finance';
  }
  if (/\b(family|friend|wife|son|daughter|dad|brother|sister|neighbor|luis|arturo|derek|home|idaho|burley|shoshone|chisone|health|doctor|dog)\b/.test(text)) {
    return 'personal';
  }
  return 'general';
}

// Shared helpers for other API routes (prime-agent.js, extract-memories.js).
// Keep these exports stable — phase 2 of the Neon migration depends on them.
export { getPool, embed, vecLiteral };

// retrieveMemories: top-N facts for a user.
//
// TWO PATHS, one function (spec :130-172 retrieveMemories + :476-498 bootSession):
//   - WITH a query  → VECTOR-FIRST recall. Embed the query, ORDER BY cosine
//                     distance (embedding <=> vec), tiebreak importance DESC,
//                     confidence DESC, created_at DESC. Mirrors
//                     lib/mediaMemory.js:94-116. Rows with no embedding sort last
//                     (NULL distance) but are still eligible.
//   - NO query (boot) → importance DESC, updated_at DESC, confidence DESC. Recency
//                     breaks importance ties BEFORE confidence, so a just-saved
//                     importance-1.0 fact (the canary) is not pushed out of the
//                     brief by an older row that merely has higher confidence.
//                     This is the non-circular boot path the spec describes
//                     (:471-498): on page load there is no "what are they talking
//                     about" hook yet, so we pull the highest-value rows.
//                     Callers that pass reserveRecent (prime-agent) also pin the
//                     newest rows into the brief, so a freshly saved fact at the
//                     default importance still survives a crowded top-30.
//
// SCOPES (spec :141-143): default ['semantic']. Callers may pass
// ['semantic','project:<slug>','task:<id>'] to widen recall. Filtered with
// scope = ANY($scopes::text[]).
//
// RETURN SHAPE is preserved: [{key, value, importance, updatedAt}]. buildSystemPrompt
// (lib/personality.js:92) reads m.value; prime-agent.js reads facts.length. Extra
// fields are additive and harmless. (2026-11-05: rows also carry kind + scope so
// buildSystemPrompt can group the briefing by kind.)
//
// Signature stays backward-compatible: retrieveMemories(userId, limit) still works
// exactly as before (no query → boot path, default semantic scope). New callers
// pass an options object: retrieveMemories(userId, { limit, query, scopes }).
//
// MODE VISIBILITY (memory-fix bite, 2026-11-05): retrieveMemoriesWithMeta is
// the same retrieval, but it also reports HOW the rows were ranked:
//   mode 'vector'        — the query embedded and the vector ranking ran.
//   mode 'boot'          — no query was given (session-start briefing path).
//   mode 'boot-fallback' — a query WAS given but its embedding failed, so the
//                          rows are boot-ranked, NOT search results.
// Production ran for weeks in permanent silent 'boot-fallback' (the deployed
// OPENAI_API_KEY exists only on the Preview target, so every production
// embed threw "OPENAI_API_KEY not set" and recall returned the boot top-5
// for any query). Callers that face the user/agent (recall-memory.js) must
// use the WithMeta variant and surface the mode — a dead vector path must
// never again fail silently.
// How many of a boot brief's slots are reserved for the newest rows when
// the caller asks for reserveRecent. The rest stay importance-ranked.
// A 30-fact prime keeps 8 just-saved facts even when they are not in the
// importance head. Smaller limits (recall's boot fallback does not use
// this) stay importance-majority.
export function recentSlotCount(limit) {
  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 30;
  if (n >= 24) return 8;
  if (n >= 12) return 4;
  return Math.min(2, n);
}

// Union of the importance-ranked head and the newest rows, capped at
// `limit`. Newest rows are placed first so they are never the ones
// trimmed when the union is longer than the cap. Identity is key+value
// (the briefing shape); the same fact coming back from both queries
// appears once.
export function mergeBootFacts(ranked, recent, limit) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 30;
  const seen = new Set();
  const out = [];
  const idOf = (f) => `${f && f.key}\0${f && f.value}`;
  const push = (f) => {
    if (!f || out.length >= cap) return;
    const id = idOf(f);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(f);
  };
  for (const f of recent || []) push(f);
  for (const f of ranked || []) {
    if (out.length >= cap) break;
    push(f);
  }
  return out;
}

// A query that literally names a saved subject or value ("Capstone canary
// code", "BlueSky42") must outrank a merely nearby embedding. Short or
// wildcard-only queries skip the pin so a one-letter lookup cannot match
// every row. `%` and `_` are stripped; the pattern is a bound parameter.
export function lexicalPinPattern(query) {
  const cleaned = String(query || '').replace(/[%_\\]/g, '').trim();
  if (cleaned.length < 3) return null;
  return `%${cleaned}%`;
}

export async function retrieveMemories(userId, optsOrLimit = 30) {
  const { facts } = await retrieveMemoriesWithMeta(userId, optsOrLimit);
  return facts;
}

export async function retrieveMemoriesWithMeta(userId, optsOrLimit = 30) {
  if (!userId) return { facts: [], mode: 'boot', embedError: null };

  // Back-compat: a bare number means "limit, no query, default scope".
  const opts = typeof optsOrLimit === 'number'
    ? { limit: optsOrLimit }
    : (optsOrLimit || {});
  const limit = typeof opts.limit === 'number' ? opts.limit : 30;
  const query = typeof opts.query === 'string' ? opts.query.trim() : '';
  const scopes = Array.isArray(opts.scopes) && opts.scopes.length > 0
    ? opts.scopes
    : ['semantic'];
  // Tenant scoping (store wiring bite): callers pass opts.tenantId ONLY
  // in enforced mode (SESSION_SECRET set — see lib/tenant.js). Null here
  // means the original user_id-only queries run byte-for-byte, which is
  // what compat mode (today's live deployment) requires.
  const tenantId = typeof opts.tenantId === 'string' && opts.tenantId ? opts.tenantId : null;

  // TENANT-ERA IDENTITY (buddy-repair fix): in enforced mode memory
  // belongs to the TENANT — tenant_id is the isolation boundary and the
  // ONLY identity filter. A tenant's rows may carry any legacy user_id
  // sub-identity (rows claimed from the single-user era are stamped
  // user_id 'troy' under the owner's tenant); ALSO filtering on
  // user_id = <tenantId> starved exactly those rows and the buddy woke
  // up with amnesia. In compat mode (tenantId null) the identity is
  // user_id, and the queries below are the originals unchanged.
  const identityCol = tenantId ? 'tenant_id' : 'user_id';
  const identityId = tenantId || userId;

  const pool = getPool();
  const mapRow = (r) => ({
    key: r.key,
    value: r.value,
    kind: r.kind || 'fact',
    scope: r.scope || 'semantic',
    category: r.category || 'general',
    importance: r.importance,
    createdAt: r.created_at?.toISOString?.() || null,
    updatedAt: r.updated_at?.toISOString?.() || null,
  });

  // VECTOR-FIRST path: embed the query and rank by cosine distance.
  if (query) {
    let vec = null;
    let embedError = null;
    try { vec = await embed(query); }
    catch (e) {
      embedError = e?.message || String(e);
      console.error('[memory] retrieve embed failed (falling back to boot rank):', embedError);
    }

    if (vec) {
      const params = [identityId, scopes];
      params.push(vecLiteral(vec)); const vecParam = params.length;
      params.push(limit); const limitParam = params.length;
      // Literal subject/content hits sort ahead of pure neighbors. The
      // pattern is bound ($N), never interpolated. FALSE when the query
      // is too short to pin, so the ORDER BY shape stays one statement
      // and the cosine rank is unchanged for those queries.
      const pin = lexicalPinPattern(query);
      let pinExpr = 'FALSE';
      if (pin) {
        params.push(pin);
        pinExpr = `(subject ILIKE $${params.length} OR content ILIKE $${params.length})`;
      }
      const { rows } = await pool.query(
        `SELECT subject AS key,
                content AS value,
                kind,
                scope,
                category,
                importance,
                created_at,
                updated_at
           FROM memory_items
          WHERE ${identityCol} = $1
            AND scope = ANY($2::text[])
            AND (valid_until IS NULL OR valid_until > now())
            -- liveness gated by valid_until; supersedes is an audit back-pointer, not a hide flag
          ORDER BY CASE WHEN ${pinExpr} THEN 0 ELSE 1 END,
                   embedding <=> $${vecParam}::vector,
                   importance DESC NULLS LAST,
                   confidence DESC NULLS LAST,
                   created_at DESC
          LIMIT $${limitParam}`,
        params
      );
      return { facts: rows.map(mapRow), mode: 'vector', embedError: null };
    }
    // Embedding failed → fall through to boot rank rather than erroring,
    // but the mode SAYS so (see the WithMeta contract above).
    const boot = await bootRank(pool, identityCol, identityId, scopes, limit, mapRow);
    return { facts: boot, mode: 'boot-fallback', embedError };
  }

  // BOOT path (no query): importance, then recency, then confidence.
  // reserveRecent (prime-agent) also pins the newest rows into the brief.
  const reserveRecent = opts.reserveRecent === true;
  const boot = await bootRank(pool, identityCol, identityId, scopes, limit, mapRow, reserveRecent);
  return { facts: boot, mode: 'boot', embedError: null };
}

async function runBootQuery(pool, identityCol, identityId, scopes, limit, orderBy) {
  const bootParams = [identityId, scopes, limit];
  const { rows } = await pool.query(
    `SELECT subject AS key,
            content AS value,
            kind,
            scope,
            category,
            importance,
            created_at,
            updated_at
       FROM memory_items
      WHERE ${identityCol} = $1
        AND scope = ANY($2::text[])
        AND (valid_until IS NULL OR valid_until > now())
      ORDER BY ${orderBy}
      LIMIT $3`,
    bootParams
  );
  return rows;
}

async function bootRank(pool, identityCol, identityId, scopes, limit, mapRow, reserveRecent) {
  // Recency before confidence: an importance-1.0 canary saved today stays
  // ahead of an older importance-1.0 row with a slightly higher confidence.
  const ranked = await runBootQuery(
    pool, identityCol, identityId, scopes, limit,
    `importance DESC NULLS LAST,
               updated_at DESC,
               confidence DESC NULLS LAST`,
  );
  if (!reserveRecent) return ranked.map(mapRow);
  const recent = await runBootQuery(
    pool, identityCol, identityId, scopes, recentSlotCount(limit),
    `updated_at DESC NULLS LAST`,
  );
  return mergeBootFacts(ranked.map(mapRow), recent.map(mapRow), limit);
}

// upsertExtractedFact: write path for extract-memories.js. Same semantics as the
// HTTP POST /api/memory upsertFact, but allows extractor to set importance and
// source_session. Reuses pool + embed.
export async function upsertExtractedFact({
  userId,
  key,
  value,
  importance = 0.5,
  sourceSession = null,
  tenantId = null,
}) {
  return upsertFactInternal(userId, key, value, { importance, sourceSession, tenantId });
}

async function upsertFactInternal(userId, key, value, opts = {}) {
  const pool = getPool();
  const subject = String(key).slice(0, 120);
  const content = String(value).slice(0, 500);
  const importance = typeof opts.importance === 'number' ? opts.importance : 0.5;
  const sourceSession = opts.sourceSession || null;
  const tenantId = opts.tenantId || null;

  // Dedup identity follows retrieval's rule (see retrieveMemories):
  // enforced mode keys the existing-row lookup on tenant_id alone, so a
  // fact re-saved under the tenant identity updates the legacy-stamped
  // row instead of duplicating it; compat keys on user_id as before.
  const existingParams = [tenantId || userId, subject];
  const existing = await pool.query(
    `SELECT id FROM memory_items
      WHERE ${tenantId ? 'tenant_id' : 'user_id'} = $1 AND scope = 'semantic' AND kind = 'fact'
        AND subject = $2 AND supersedes IS NULL
      LIMIT 1`,
    existingParams
  );

  let vec = null;
  try { vec = await embed(`${subject}: ${content}`); }
  catch (e) { console.error('[memory] embed failed:', e?.message || e); }

  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    if (vec) {
      await pool.query(
        `UPDATE memory_items
            SET content = $1, embedding = $2::vector, importance = $3
          WHERE id = $4${tenantId ? ' AND tenant_id = $5' : ''}`,
        tenantId ? [content, vecLiteral(vec), importance, id, tenantId]
                 : [content, vecLiteral(vec), importance, id]
      );
    } else {
      await pool.query(
        `UPDATE memory_items SET content = $1, importance = $2 WHERE id = $3${tenantId ? ' AND tenant_id = $4' : ''}`,
        tenantId ? [content, importance, id, tenantId] : [content, importance, id]
      );
    }
    return { id, subject, content, action: 'updated' };
  }

  const category = classifyMemoryCategory(subject, content);
  const insCols = ['user_id', 'scope', 'kind', 'subject', 'content', 'embedding', 'confidence', 'importance', 'source_session', 'category'];
  const insParams = [userId, subject, content];
  const insVals = ['$1', `'semantic'`, `'fact'`, '$2', '$3'];
  if (vec) { insParams.push(vecLiteral(vec)); insVals.push(`$${insParams.length}::vector`); }
  else insVals.push('NULL');
  insVals.push('0.7');
  insParams.push(importance); insVals.push(`$${insParams.length}`);
  insParams.push(sourceSession); insVals.push(`$${insParams.length}`);
  insParams.push(category); insVals.push(`$${insParams.length}`);
  if (tenantId) { insCols.push('tenant_id'); insParams.push(tenantId); insVals.push(`$${insParams.length}`); }
  const insert = await pool.query(
    `INSERT INTO memory_items (${insCols.join(', ')})
     VALUES (${insVals.join(', ')})
     RETURNING id`,
    insParams
  );
  return { id: insert.rows[0].id, subject, content, action: 'inserted' };
}

// ---------------------------------------------------------------------------
// Semantic dedup + supersedes wiring (spec :351-468).
//
// saveMemoryCandidates() replaces the shallow kind+subject dedup (upsertFact)
// with embedding nearest-neighbor logic and finally wires the supersedes column:
//   - topSim >= SIM_UPDATE (0.92)      → MERGE into the nearest row (GREATEST
//                                        confidence/importance, replace content).
//   - SIM_CONFLICT_LO (0.75) <= topSim → ask the LLM if the new statement
//        < SIM_UPDATE                    contradicts the old one. If 'contradicts':
//                                        BEGIN; UPDATE old SET valid_until=now();
//                                        INSERT new WITH supersedes=old.id; COMMIT.
//   - otherwise                        → fresh INSERT.
//
// `llm` is (system, user) => Promise<string> per spec :364. If omitted, a default
// is built from ANTHROPIC_API_KEY using the same raw-fetch call shape as
// api/extract-memories.js:54-74 (model claude-haiku-4-5, version 2023-06-01).
//
// Candidates are normalized defensively so this works for BOTH spec-shaped
// candidates ({scope, kind, subject, content, confidence, importance,
// valid_until, source_session, source_span:{start,end}}) and the legacy
// {key, value} shape. Missing fields get safe defaults; source_span is OPTIONAL
// (column is nullable) and only written when both start/end are present.
const SIM_UPDATE      = 0.92;   // near-identical → merge into existing
const SIM_CONFLICT_LO = 0.75;   // related but possibly contradicting → check supersede
const NEIGHBOR_K      = 5;

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// Normalize a raw candidate (spec-shaped OR legacy {key,value}) into the fields
// saveMemoryCandidates relies on. Returns null if there's nothing to save.
function normalizeCandidate(c) {
  if (!c || typeof c !== 'object') return null;
  const subjectRaw = c.subject ?? c.key;
  const contentRaw = c.content ?? c.value;
  if (!contentRaw) return null;

  const subject = String(subjectRaw ?? contentRaw).slice(0, 120);
  const content = String(contentRaw).slice(0, 500);

  // source_span is only valid when both ends are finite integers.
  // Normalize to a NON-EMPTY half-open range (start < end): swap if reversed
  // (int4range(7,3) throws), and bump end to start+1 when end<=start
  // (int4range(n,n) is the EMPTY range and silently drops single-message provenance).
  let span = null;
  const s = c.source_span;
  if (s && Number.isFinite(Number(s.start)) && Number.isFinite(Number(s.end))) {
    let start = Math.trunc(Number(s.start));
    let end = Math.trunc(Number(s.end));
    if (start > end) { const t = start; start = end; end = t; }
    if (end <= start) end = start + 1;
    span = { start, end };
  }

  return {
    scope: typeof c.scope === 'string' && c.scope ? c.scope : 'semantic',
    kind: typeof c.kind === 'string' && c.kind ? c.kind : 'fact',
    subject,
    content,
    confidence: typeof c.confidence === 'number' ? clamp01(c.confidence) : 0.7,
    importance: typeof c.importance === 'number' ? clamp01(c.importance) : 0.5,
    valid_until: (typeof c.valid_until === 'string' && !Number.isNaN(Date.parse(c.valid_until))) ? c.valid_until : null,
    source_session: c.source_session ?? c.sourceSession ?? null,
    source_span: span,
  };
}

// Default LLM: raw fetch to Anthropic Messages API. Mirrors
// api/extract-memories.js:54-74. (system, user) => Promise<string of model text>.
function makeDefaultLLM() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return async (system, user) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 16,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Anthropic ${r.status}: ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    return data?.content?.[0]?.text || '';
  };
}

// Ask the LLM whether `incoming` makes `existing` false. One-word verdict.
// Spec :457-468. Fail-safe: on any LLM error, return 'related' so we INSERT the
// new fact rather than destructively superseding on an unverifiable verdict.
async function classifyContradiction(llm, existing, incoming) {
  const sys = `Classify the relationship between two memory statements. Respond with ONE word: contradicts, related, or unrelated. "contradicts" means the new statement makes the old one false.`;
  const user = `OLD: ${existing}\nNEW: ${incoming}`;
  let out = '';
  try {
    out = (await llm(sys, user)).trim().toLowerCase();
  } catch (e) {
    console.error('[memory] classifyContradiction LLM failed (treating as related):', e?.message || e);
    return 'related';
  }
  if (out.startsWith('contradicts')) return 'contradicts';
  if (out.startsWith('related'))     return 'related';
  if (out.startsWith('unrelated'))   return 'unrelated';
  // Unrecognized output → safest is 'related' (no destructive supersede).
  return 'related';
}

/**
 * Save memory candidates with embedding-based dedup + supersedes wiring.
 *
 * @param {import('pg').Pool} pool
 * @param {string} user_id
 * @param {Array<object>} candidates  spec-shaped or legacy {key,value}
 * @param {(system:string,user:string)=>Promise<string>} [llm]  contradiction judge;
 *        defaults to claude-haiku-4-5 via ANTHROPIC_API_KEY.
 * @returns {Promise<{inserted:number, updated:number, superseded:number, skipped:number}>}
 */
export async function saveMemoryCandidates(pool, user_id, candidates, llm, tenantId = null) {
  if (!pool) pool = getPool();
  let inserted = 0, updated = 0, superseded = 0, skipped = 0;
  if (!user_id || !Array.isArray(candidates) || candidates.length === 0) {
    return { inserted, updated, superseded, skipped };
  }

  const judge = typeof llm === 'function' ? llm : makeDefaultLLM();

  for (const raw of candidates) {
    const c = normalizeCandidate(raw);
    if (!c) { skipped++; continue; }

    // Embed the candidate. If embedding fails, we can't run NN dedup — fall back
    // to a plain INSERT (without embedding) so the fact is still durably saved.
    let vec = null;
    try { vec = await embed(`${c.subject}: ${c.content}`); }
    catch (e) { console.error('[memory] candidate embed failed (inserting without vector):', e?.message || e); }

    if (!vec) {
      const cat = c.category || classifyMemoryCategory(c.subject, c.content);
      const nvParams = [user_id, c.scope, c.kind, c.subject, c.content,
        c.confidence, c.importance, c.valid_until, c.source_session, cat];
      let nvTenantCol = '', nvTenantVal = '';
      if (tenantId) { nvParams.push(tenantId); nvTenantCol = ', tenant_id'; nvTenantVal = `, $${nvParams.length}`; }
      let nvSpanVal = 'NULL';
      if (c.source_span) { nvParams.push(c.source_span.start, c.source_span.end); nvSpanVal = `int4range($${nvParams.length - 1},$${nvParams.length})`; }
      await pool.query(
        `INSERT INTO memory_items
           (user_id, scope, kind, subject, content,
            confidence, importance, valid_until, source_session, category, source_span${nvTenantCol})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,${nvSpanVal}${nvTenantVal})`,
        nvParams
      );
      inserted++;
      continue;
    }

    const vlit = vecLiteral(vec);

    // Nearest neighbors within the SAME scope (spec :371-382). The
    // identity predicate follows retrieval's rule: tenant_id alone in
    // enforced mode (legacy-stamped rows stay dedup-visible), user_id
    // in compat mode.
    const nbParams = [vlit, tenantId || user_id, c.scope];
    nbParams.push(NEIGHBOR_K); const nbLimitParam = nbParams.length;
    const neighbors = await pool.query(
      `SELECT id, kind, subject, content, confidence, importance,
              (embedding <=> $1::vector) AS distance
         FROM memory_items
        WHERE ${tenantId ? 'tenant_id' : 'user_id'} = $2
          AND scope = $3
          AND embedding IS NOT NULL
          AND (valid_until IS NULL OR valid_until > now())
        ORDER BY embedding <=> $1::vector
        LIMIT $${nbLimitParam}`,
      nbParams
    );

    // pgvector cosine distance = 1 - cosine_similarity → similarity = 1 - distance.
    const top = neighbors.rows[0];
    const topSim = top ? 1 - Number(top.distance) : 0;

    // MERGE (spec :389-404): near-identical. Replace content, lift confidence/
    // importance to the max of old vs new, refresh embedding + source provenance.
    // (updated_at is bumped automatically by trg_memory_touch — setup-memory-db.mjs:86-89.)
    if (top && topSim >= SIM_UPDATE) {
      const mgParams = [c.content, vlit, c.confidence, c.importance, c.source_session, top.id];
      let mgTenantClause = '';
      if (tenantId) { mgParams.push(tenantId); mgTenantClause = ` AND tenant_id = $${mgParams.length}`; }
      let mgSpanSet = '';
      if (c.source_span) { mgParams.push(c.source_span.start, c.source_span.end); mgSpanSet = `, source_span = int4range($${mgParams.length - 1},$${mgParams.length})`; }
      await pool.query(
        `UPDATE memory_items
            SET content        = $1,
                embedding      = $2::vector,
                confidence     = GREATEST(confidence, $3),
                importance     = GREATEST(importance, $4),
                source_session = COALESCE($5, source_session)
                ${mgSpanSet}
          WHERE id = $6${mgTenantClause}`,
        mgParams
      );
      updated++;
      continue;
    }

    // POSSIBLE CONFLICT (spec :406-437): mid-similarity. Ask the LLM. If it
    // contradicts, supersede the old row inside a transaction.
    if (top && topSim >= SIM_CONFLICT_LO) {
      const verdict = judge
        ? await classifyContradiction(judge, top.content, c.content)
        : 'related'; // no LLM available → never destructively supersede
      if (verdict === 'contradicts') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE memory_items SET valid_until = now() WHERE id = $1${tenantId ? ' AND tenant_id = $2' : ''}`,
            tenantId ? [top.id, tenantId] : [top.id]
          );
          const ssParams = [user_id, c.scope, c.kind, c.subject, c.content, vlit,
            c.confidence, c.importance, c.valid_until, top.id, c.source_session];
          let ssTenantCol = '', ssTenantVal = '';
          if (tenantId) { ssParams.push(tenantId); ssTenantCol = ', tenant_id'; ssTenantVal = `, $${ssParams.length}`; }
          let ssSpanVal = 'NULL';
          if (c.source_span) { ssParams.push(c.source_span.start, c.source_span.end); ssSpanVal = `int4range($${ssParams.length - 1},$${ssParams.length})`; }
          await client.query(
            `INSERT INTO memory_items
               (user_id, scope, kind, subject, content, embedding,
                confidence, importance, valid_until, supersedes,
                source_session, category, source_span${ssTenantCol})
             VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8,$9,$10,$11,$12,${ssSpanVal}${ssTenantVal})`,
            ssParams
          );
          await client.query('COMMIT');
          superseded++;
        } catch (e) {
          await client.query('ROLLBACK');
          client.release();
          throw e;
        }
        client.release();
        continue;
      }
      // 'related' or 'unrelated' → fall through to fresh insert.
    }

    // FRESH INSERT (spec :440-451).
    const cat = c.category || classifyMemoryCategory(c.subject, c.content);
    const fiParams = [user_id, c.scope, c.kind, c.subject, c.content, vlit,
      c.confidence, c.importance, c.valid_until, c.source_session, cat];
    let fiTenantCol = '', fiTenantVal = '';
    if (tenantId) { fiParams.push(tenantId); fiTenantCol = ', tenant_id'; fiTenantVal = `, $${fiParams.length}`; }
    let fiSpanVal = 'NULL';
    if (c.source_span) { fiParams.push(c.source_span.start, c.source_span.end); fiSpanVal = `int4range($${fiParams.length - 1},$${fiParams.length})`; }
    await pool.query(
      `INSERT INTO memory_items
         (user_id, scope, kind, subject, content, embedding,
          confidence, importance, valid_until, source_session, category, source_span${fiTenantCol})
       VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8,$9,$10,$11,${fiSpanVal}${fiTenantVal})`,
      fiParams
    );
    inserted++;
  }

  return { inserted, updated, superseded, skipped };
}

async function readFacts(userId, tenantId = null) {
  const pool = getPool();
  // Same tenant-era identity rule as retrieveMemories: tenant_id alone
  // in enforced mode, user_id in compat mode.
  const rfParams = [tenantId || userId];
  const sql = `
    SELECT id, subject AS key, content AS value, updated_at, created_at, importance, confidence
      FROM memory_items
     WHERE ${tenantId ? 'tenant_id' : 'user_id'} = $1
       AND scope = 'semantic'
       AND (valid_until IS NULL OR valid_until > now())
     ORDER BY importance DESC, confidence DESC, updated_at DESC
  `;
  const { rows } = await pool.query(sql, rfParams);
  return rows.map(r => ({
    key: r.key,
    value: r.value,
    savedAt: (r.updated_at || r.created_at)?.toISOString?.() || null,
  }));
}

async function upsertFact(userId, key, value, tenantId = null) {
  const pool = getPool();
  const subject = String(key).slice(0, 120);
  const content = String(value).slice(0, 500);

  // Try UPDATE-by-subject first (idempotent on legacy {key,value} writes).
  // Embedding refresh is fire-and-forget on UPDATE to keep the path fast.
  // Dedup identity follows retrieval's rule (see retrieveMemories):
  // enforced mode keys the existing-row lookup on tenant_id alone, so a
  // fact re-saved under the tenant identity updates the legacy-stamped
  // row instead of duplicating it; compat keys on user_id as before.
  const existingParams = [tenantId || userId, subject];
  const existing = await pool.query(
    `SELECT id FROM memory_items
      WHERE ${tenantId ? 'tenant_id' : 'user_id'} = $1 AND scope = 'semantic' AND kind = 'fact'
        AND subject = $2 AND supersedes IS NULL
      LIMIT 1`,
    existingParams
  );

  let vec = null;
  try { vec = await embed(`${subject}: ${content}`); }
  catch (e) { console.error('[memory] embed failed:', e?.message || e); }

  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    if (vec) {
      await pool.query(
        `UPDATE memory_items
            SET content = $1, embedding = $2::vector
          WHERE id = $3${tenantId ? ' AND tenant_id = $4' : ''}`,
        tenantId ? [content, vecLiteral(vec), id, tenantId]
                 : [content, vecLiteral(vec), id]
      );
    } else {
      await pool.query(
        `UPDATE memory_items SET content = $1 WHERE id = $2${tenantId ? ' AND tenant_id = $3' : ''}`,
        tenantId ? [content, id, tenantId] : [content, id]
      );
    }
    return { id, subject, content, action: 'updated' };
  }

  const category = classifyMemoryCategory(subject, content);
  const insert = await pool.query(
    `INSERT INTO memory_items
       (user_id, scope, kind, subject, content, embedding, confidence, importance, category${tenantId ? ', tenant_id' : ''})
     VALUES ($1, 'semantic', 'fact', $2, $3, ${vec ? '$4::vector' : 'NULL'}, 0.7, 0.5, $${vec ? 5 : 4}${tenantId ? `, $${vec ? 6 : 5}` : ''})
     RETURNING id`,
    vec ? [userId, subject, content, vecLiteral(vec), category, ...(tenantId ? [tenantId] : [])]
        : [userId, subject, content, category, ...(tenantId ? [tenantId] : [])]
  );
  try {
    await pool.query(
      `INSERT INTO memory_filings (tenant_id, memory_id, category, rule_key, explanation)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, String(insert.rows[0].id), category, `librarian.${category}`, `Librarian filed under ${category}`]
    );
  } catch (e) { /* ignore filing logging failure */ }
  return { id: insert.rows[0].id, subject, content, action: 'inserted' };
}

async function deleteFact(userId, key, tenantId = null) {
  const pool = getPool();
  const subject = String(key).slice(0, 120);
  const r = await pool.query(
    `DELETE FROM memory_items
      WHERE ${tenantId ? 'tenant_id' : 'user_id'} = $1 AND scope = 'semantic' AND subject = $2`,
    [tenantId || userId, subject]
  );
  return { deleted: r.rowCount };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // A tenant UUID in userId is NOT a credential. Browser calls need a
  // session for that tenant (the signed-in PWA sends Authorization plus
  // the same id as the widget's user_id). The save_memory tool has no
  // session; it needs X-Webhook-Secret, and only then may userId select
  // the tenant. ENFORCE_TOOL_AUTH does not gate this route — the flag
  // being absent was the live hole. See authorizeMemoryAccess.
  const reqUserId = (req.method === 'POST')
    ? (req.body?.userId || req.query?.userId)
    : req.query?.userId;
  const access = authorizeMemoryAccess(req, reqUserId);
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error });
  }
  const tenantId = access.tenantId;
  const userId = access.userId;

  if (!DB_URL) {
    return res.status(500).json({ error: 'memory store not configured (DATABASE_URL_MEMORY missing)' });
  }
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    if (req.method === 'GET') {
      const facts = await readFacts(userId, tenantId);
      return res.status(200).json({ userId, facts });
    }

    if (req.method === 'POST') {
      const { key, value } = req.body || {};
      if (!key || !value) return res.status(400).json({ error: 'key and value required' });
      // Enforced mode stamps new rows with the tenant identity — the
      // identity retrieval looks for (see retrieveMemories). Compat
      // mode stamps the authorized userId, exactly as before.
      const out = await upsertFact(tenantId || userId, key, value, tenantId);
      return res.status(200).json({
        ok: true,
        fact: { key: out.subject, value: out.content, savedAt: new Date().toISOString() },
        action: out.action,
      });
    }

    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key required' });
    await deleteFact(tenantId || userId, key, tenantId);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[memory] handler error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'memory op failed' });
  }
}
