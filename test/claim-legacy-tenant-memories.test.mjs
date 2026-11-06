import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEGACY_TENANT_ID } from '../lib/tenant.js';
import { CLAIM_STATEMENTS, LEGACY_TENANT_ID as SCRIPT_LEGACY, LEGACY_USER_ID } from '../scripts/claim-legacy-tenant-memories.mjs';

const sqlFile = readFileSync(new URL('../sql/store/012_claim_legacy_memories.sql', import.meta.url), 'utf8');

test('legacy id matches the tenant scaffold', () => {
  assert.equal(SCRIPT_LEGACY, LEGACY_TENANT_ID);
  assert.equal(LEGACY_TENANT_ID, '00000000-0000-4000-8000-000000000001');
  assert.equal(LEGACY_USER_ID, 'troy');
  assert.match(sqlFile, new RegExp(LEGACY_TENANT_ID));
});

test('claim does not delete tenants or memory rows and does not invent an owner email', () => {
  const blob = `${sqlFile}\n${Object.values(CLAIM_STATEMENTS).join('\n')}`;
  assert.doesNotMatch(blob, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(blob, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(blob, /troyhalter1@gmail\.com/i);
  assert.match(sqlFile, /capstone\.claim_target_email/);
  assert.match(sqlFile, /need exactly 1/);
});

test('memory move changes tenant_id only; conversations also retarget user_id', () => {
  const memorySet = CLAIM_STATEMENTS.moveMemories.split(/WHERE/i)[0];
  assert.match(memorySet, /SET tenant_id = \$1/);
  assert.doesNotMatch(memorySet, /user_id/);
  assert.match(CLAIM_STATEMENTS.moveMemories, /user_id = \$3/);
  assert.match(CLAIM_STATEMENTS.moveSessions, /user_id = \$1::text/);
  assert.match(CLAIM_STATEMENTS.moveSessions, /tenant_id = \$2/);
  assert.match(CLAIM_STATEMENTS.moveTurns, /conversation_turns/);
  assert.match(sqlFile, /SET tenant_id = dest/);
  assert.match(sqlFile, /user_id = legacy_user/);
  assert.match(sqlFile, /user_id = dest::text/);
});
