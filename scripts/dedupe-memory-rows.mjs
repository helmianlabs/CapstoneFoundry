// scripts/dedupe-memory-rows.mjs
// ---------------------------------------------------------------------------
// ONE-SHOT cleanup for the legacy memory rows, using the LIVE system's
// own rules (server/handlers/memory.js saveMemoryCandidates):
//   similarity ≥ 0.92        → near-duplicate cluster: keep one winner,
//                              retire the rest (valid_until = now()).
//   0.75 ≤ similarity < 0.92 → ask the LLM judge (same one-word prompt as
//                              classifyContradiction): on "contradicts",
//                              retire the OLDER row. Without an
//                              ANTHROPIC_API_KEY these pairs are
//                              REPORT-ONLY.
//   degraded rows            → the two known-bad legacy entries (below)
//                              are retired: "User's name is Mark" (the
//                              assistant's name written as the USER's
//                              name) and anything mentioning "bursell"
//                              (a garbled deployment domain).
//
// Retiring = setting valid_until = now(). The row leaves every live
// read immediately and the existing expiry cron hard-deletes it after
// the 7-day grace — nothing is destroyed outright by this script.
//
// ⚠️ DEFAULT IS --dry-run (report only). Pass --apply to write.
// ⚠️ NOT RUN against production as part of the 2026-11-05 memory-fix
//    bite. Run scripts/backfill-memory-embeddings.mjs FIRST — rows
//    without embeddings cannot be clustered and are only reported.
//
// USAGE:
//   DATABASE_URL_MEMORY=... [ANTHROPIC_API_KEY=...] \
//     node scripts/dedupe-memory-rows.mjs [--user=<id>] [--apply]
// ---------------------------------------------------------------------------

import { Pool } from 'pg';

const args = process.argv.slice(2);
const connArg = args.find((a) => !a.startsWith('--'));
const onlyUser = (args.find((a) => a.startsWith('--user=')) || '').split('=')[1] || null;
const apply = args.includes('--apply');

const conn = connArg || process.env.DATABASE_URL_MEMORY || process.env.DATABASE_URL;
if (!conn || conn.trim().length < 12) {
  console.error('✗ No connection string. Pass it as arg 1 or set DATABASE_URL_MEMORY.');
  process.exit(1);
}

const SIM_UPDATE = 0.92;        // mirrors memory.js SIM_UPDATE
const SIM_CONFLICT_LO = 0.75;   // mirrors memory.js SIM_CONFLICT_LO

// The known degraded legacy rows (2026-11-05 deep dive §6.3). Patterns
// are deliberately narrow and printed in the report before any write.
const DEGRADED_PATTERNS = [
  { name: 'user-name-is-mark', test: (r) => /name is Mark\b/i.test(r.content) || /^User'?s name is Mark$/i.test(r.subject.trim()) },
  { name: 'bursell-domain', test: (r) => /bursell/i.test(r.content) || /bursell/i.test(r.subject) },
];

const masked = conn.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
console.log(`→ Target: ${masked}${onlyUser ? ` (user: ${onlyUser})` : ''} [${apply ? 'APPLY' : 'DRY RUN'}]`);

const pool = new Pool({
  connectionString: conn,
  max: 2,
  idleTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false },
});

function parseVec(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  try { return JSON.parse(String(v)); } catch { return null; }
}
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function judgeContradiction(oldText, newText) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null; // report-only
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      system: 'Classify the relationship between two memory statements. Respond with ONE word: contradicts, related, or unrelated. "contradicts" means the new statement makes the old one false.',
      messages: [{ role: 'user', content: `OLD: ${oldText}\nNEW: ${newText}` }],
    }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const out = (data?.content?.[0]?.text || '').trim().toLowerCase();
  if (out.startsWith('contradicts')) return 'contradicts';
  if (out.startsWith('related')) return 'related';
  if (out.startsWith('unrelated')) return 'unrelated';
  return 'related';
}

try {
  const { rows } = await pool.query(
    `SELECT id, user_id, scope, kind, subject, content, embedding::text AS embedding,
            confidence, importance, created_at, updated_at
       FROM memory_items
      WHERE (valid_until IS NULL OR valid_until > now())
        ${onlyUser ? 'AND user_id = $1' : ''}
      ORDER BY user_id, created_at ASC`,
    onlyUser ? [onlyUser] : []
  );
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push({ ...r, vec: parseVec(r.embedding) });
  }

  let retired = 0;
  const retire = async (row, why) => {
    console.log(`    retire [${why}]: "${row.subject}" — ${String(row.content).slice(0, 90)}`);
    if (apply) {
      await pool.query(`UPDATE memory_items SET valid_until = now() WHERE id = $1`, [row.id]);
    }
    retired++;
  };

  for (const [userId, userRows] of byUser) {
    console.log(`\n== user ${userId}: ${userRows.length} live rows ==`);
    const dead = new Set();

    // 1) Degraded rows.
    for (const r of userRows) {
      const hit = DEGRADED_PATTERNS.find((p) => p.test(r));
      if (hit) { await retire(r, `degraded:${hit.name}`); dead.add(r.id); }
    }

    // 2) Near-duplicate clusters (≥ SIM_UPDATE), union-find over pairs.
    const live = userRows.filter((r) => !dead.has(r.id));
    const embedded = live.filter((r) => r.vec);
    const unembedded = live.filter((r) => !r.vec);
    if (unembedded.length) {
      console.log(`    note: ${unembedded.length} row(s) have no embedding — run the backfill first; they cannot be clustered.`);
    }
    const parent = new Map(embedded.map((r) => [r.id, r.id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (let i = 0; i < embedded.length; i++) {
      for (let j = i + 1; j < embedded.length; j++) {
        if (cosine(embedded[i].vec, embedded[j].vec) >= SIM_UPDATE) {
          parent.set(find(embedded[i].id), find(embedded[j].id));
        }
      }
    }
    const clusters = new Map();
    for (const r of embedded) {
      const root = find(r.id);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(r);
    }
    for (const group of clusters.values()) {
      if (group.length < 2) continue;
      // Winner: highest importance, then confidence, then freshest.
      group.sort((a, b) =>
        (b.importance - a.importance) || (b.confidence - a.confidence) || (new Date(b.updated_at) - new Date(a.updated_at)));
      const [winner, ...losers] = group;
      console.log(`    cluster of ${group.length}: winner "${winner.subject}"`);
      if (apply) {
        const maxConf = Math.max(...group.map((g) => g.confidence));
        const maxImp = Math.max(...group.map((g) => g.importance));
        await pool.query(
          `UPDATE memory_items SET confidence = GREATEST(confidence, $1), importance = GREATEST(importance, $2) WHERE id = $3`,
          [maxConf, maxImp, winner.id]
        );
      }
      for (const loser of losers) { await retire(loser, 'near-duplicate'); dead.add(loser.id); }
    }

    // 3) Mid-similarity pairs → contradiction judge.
    const stillLive = live.filter((r) => !dead.has(r.id) && r.vec);
    for (let i = 0; i < stillLive.length; i++) {
      for (let j = i + 1; j < stillLive.length; j++) {
        const sim = cosine(stillLive[i].vec, stillLive[j].vec);
        if (sim < SIM_CONFLICT_LO || sim >= SIM_UPDATE) continue;
        const [older, newer] = new Date(stillLive[i].created_at) <= new Date(stillLive[j].created_at)
          ? [stillLive[i], stillLive[j]] : [stillLive[j], stillLive[i]];
        const verdict = await judgeContradiction(older.content, newer.content);
        if (verdict === null) {
          console.log(`    pair (sim ${sim.toFixed(2)}) REPORT-ONLY (no ANTHROPIC_API_KEY): "${older.subject}" vs "${newer.subject}"`);
        } else if (verdict === 'contradicts') {
          console.log(`    pair (sim ${sim.toFixed(2)}) judged CONTRADICTS:`);
          await retire(older, 'superseded-by-newer');
          dead.add(older.id);
        } else {
          console.log(`    pair (sim ${sim.toFixed(2)}) judged ${verdict} — both kept.`);
        }
      }
    }
  }

  console.log(`\n${apply ? '✅ APPLIED' : 'ℹ️ DRY RUN ONLY — re-run with --apply to write.'} Rows retired: ${retired}.`);
} finally {
  await pool.end();
}
