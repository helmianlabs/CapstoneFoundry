// test/memory-schema.test.mjs — the memory_items.category schema guard.
// Run: node test/memory-schema.test.mjs
//
// Proves: the guard issues exactly one idempotent ALTER across repeated
// calls (memoized), reports success, and after a failure it reports
// false and retries on the next call instead of caching the failure.

import { ensureMemoryCategoryColumn, _resetMemorySchemaMemo } from '../lib/memorySchema.js';

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`check failed: ${name}`);
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function fakePool(failFirst = 0) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (calls.length <= failFirst) throw new Error('permission denied for table memory_items');
      return { rows: [] };
    },
  };
}

// 1. One ALTER, memoized across calls.
{
  _resetMemorySchemaMemo();
  const pool = fakePool();
  const a = await ensureMemoryCategoryColumn(pool);
  const b = await ensureMemoryCategoryColumn(pool);
  check('ensure reports success', a === true && b === true);
  check('exactly one statement issued', pool.calls.length === 1);
  check(
    'statement is the idempotent category ALTER',
    /ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general'/.test(pool.calls[0])
  );
}

// 2. Failure is reported, not hidden, and the next call retries.
{
  _resetMemorySchemaMemo();
  const pool = fakePool(1);
  const a = await ensureMemoryCategoryColumn(pool);
  check('failure reports false', a === false);
  const b = await ensureMemoryCategoryColumn(pool);
  check('retry after failure succeeds', b === true);
  check('retry actually re-issued the ALTER', pool.calls.length === 2);
}

// 3. A missing/invalid pool is a plain false, never a throw.
{
  _resetMemorySchemaMemo();
  check('null pool -> false', (await ensureMemoryCategoryColumn(null)) === false);
  check('non-pool -> false', (await ensureMemoryCategoryColumn({})) === false);
}

console.log(`\n${passed} checks passed`);
