// scripts/backfill-memory-embeddings.mjs
// ---------------------------------------------------------------------------
// ONE-SHOT, IDEMPOTENT backfill: give every memory_items row that is
// missing its embedding one, using the SAME embed contract as the live
// write paths (OpenAI text-embedding-3-small over "subject: content" —
// see server/handlers/memory.js embed() call sites).
//
// WHY THIS EXISTS (memory-fix bite, 2026-11-05): recall's vector ranking
// can only rank rows that HAVE embeddings; rows written while an embed
// call failed (or bulk-loaded) carry embedding = NULL, sort behind every
// embedded row, and are effectively invisible to semantic recall. The
// 2026-10-23 legacy rows for user 'troy' are the known suspects. This
// script fills the NULLs; it never touches a row that already has one.
//
// ⚠️ NOT RUN against production as part of the bite — run it manually
//    once the deploy + the production OPENAI_API_KEY (see REPORT) land.
//
// USAGE (from project root):
//   DATABASE_URL_MEMORY=... OPENAI_API_KEY=... \
//     node scripts/backfill-memory-embeddings.mjs [--user=<id>] [--dry-run]
//   or pass the connection string as arg 1:
//     node scripts/backfill-memory-embeddings.mjs "postgresql://..." [--user=troy]
// ---------------------------------------------------------------------------

import { Pool } from 'pg';

const args = process.argv.slice(2);
const connArg = args.find((a) => !a.startsWith('--'));
const onlyUser = (args.find((a) => a.startsWith('--user=')) || '').split('=')[1] || null;
const dryRun = args.includes('--dry-run');

const conn = connArg || process.env.DATABASE_URL_MEMORY || process.env.DATABASE_URL;
if (!conn || conn.trim().length < 12) {
  console.error('✗ No connection string. Pass it as arg 1 or set DATABASE_URL_MEMORY.');
  process.exit(1);
}
const openAiKey = process.env.OPENAI_API_KEY;
if (!openAiKey && !dryRun) {
  console.error('✗ OPENAI_API_KEY not set (required unless --dry-run).');
  process.exit(1);
}

const masked = conn.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
console.log(`→ Target: ${masked}${onlyUser ? ` (user: ${onlyUser})` : ''}${dryRun ? ' [DRY RUN]' : ''}`);

const pool = new Pool({
  connectionString: conn,
  max: 2,
  idleTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false },
});

async function embed(text) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: String(text).slice(0, 8000) }),
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data.data[0].embedding;
}

try {
  const { rows: before } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE embedding IS NULL)::int AS missing
       FROM memory_items
      ${onlyUser ? 'WHERE user_id = $1' : ''}`,
    onlyUser ? [onlyUser] : []
  );
  console.log(`rows: ${before[0].total}, missing embeddings: ${before[0].missing}`);
  if (before[0].missing === 0) { console.log('✅ Nothing to backfill.'); process.exit(0); }

  const { rows } = await pool.query(
    `SELECT id, user_id, subject, content FROM memory_items
      WHERE embedding IS NULL ${onlyUser ? 'AND user_id = $1' : ''}
      ORDER BY created_at ASC`,
    onlyUser ? [onlyUser] : []
  );

  let done = 0, failed = 0;
  for (const row of rows) {
    try {
      if (dryRun) {
        console.log(`  [dry-run] would embed: ${row.user_id} / ${row.subject}`);
      } else {
        const vec = await embed(`${row.subject}: ${row.content}`);
        const lit = `[${vec.join(',')}]`;
        // AND embedding IS NULL keeps the script idempotent under a
        // concurrent live write that filled the row first.
        await pool.query(
          `UPDATE memory_items SET embedding = $1::vector WHERE id = $2 AND embedding IS NULL`,
          [lit, row.id]
        );
        console.log(`  ✓ ${row.user_id} / ${row.subject}`);
      }
      done++;
    } catch (e) {
      failed++;
      console.error(`  ✗ ${row.id} (${row.subject}): ${e?.message || e}`);
    }
  }

  const { rows: after } = await pool.query(
    `SELECT count(*) FILTER (WHERE embedding IS NULL)::int AS missing
       FROM memory_items ${onlyUser ? 'WHERE user_id = $1' : ''}`,
    onlyUser ? [onlyUser] : []
  );
  console.log(`\nprocessed: ${done}, failed: ${failed}, still missing: ${after[0].missing}`);
  console.log(failed === 0 ? '✅ BACKFILL COMPLETE' : '⚠️ BACKFILL FINISHED WITH FAILURES — safe to re-run');
} finally {
  await pool.end();
}
