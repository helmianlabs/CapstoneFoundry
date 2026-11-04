// test/prime-safety.test.mjs — safety wiring bite 2
// (safety-gap-map §7): the tenant profile reaches the VOICE prompt.
//
// Before this bite, server/handlers/prime-agent.js built the
// ElevenLabs session prompt with no profile load and no safetyMode /
// ageBand, so lib/personality.js's KID_SAFETY_CORE could never reach
// a voice session on any trigger (BASE_GUARDRAILS reached it only
// because that layer is unconditional). These tests pin the wired
// behavior through the REAL handler and the REAL bite-1 resolver:
// a minor or safety-on profile's primed prompt carries the kid
// core, an adult safety-off profile's does not, an unresolvable
// profile in enforced mode lands on the resolver's safe default
// (kid core present — never a silent no-safety prompt), no safety
// state or memory crosses tenants, and compat mode is unchanged
// with zero profile queries.
//
// The handler runs in a child process with module mocks (its DB
// seams cannot load in the suite) — see
// test/fixtures/prime-safety-handler-child.mjs. NOT covered: any
// live deployment, the live ElevenLabs agent, or whether the
// dashboard prompt-override toggle is on (safety-gap-map §3.3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/prime-safety-handler-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', child], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON result from child:\n${run.stdout}`);
  return JSON.parse(line);
}

test('prime safety (bite 2): minor age bands put the kid core in the voice prompt, safety toggle or not', () => {
  const out = runChild();
  for (const name of ['minorChild', 'minor68', 'minor912']) {
    const r = out[name];
    assert.equal(r.code, 200, `${name}: primed`);
    assert.equal(r.baseRules, true, `${name}: BASE_GUARDRAILS always present`);
    assert.equal(r.kidCore, true, `${name}: minor band -> KID_SAFETY_CORE in the session prompt`);
    assert.ok(r.profileDelta >= 1, `${name}: profile store consulted`);
    // Only this tenant's memories ride along.
    assert.equal(r.hasDog, true, `${name}: own memory present`);
    assert.equal(r.hasStranger, false, `${name}: no other-tenant memory`);
    assert.equal(r.hasOtherTenantTroy, false, `${name}: no cross-tenant troy-tagged row`);
  }
});

test('prime safety (bite 2): adult safety-off gets no kid core; adult safety-on and the under-13 rule hold', () => {
  const out = runChild();

  assert.equal(out.adultOff.code, 200);
  assert.equal(out.adultOff.baseRules, true, 'adult: base guardrails present');
  assert.equal(out.adultOff.kidCore, false, 'adult profile, safety off -> no kid core');

  assert.equal(out.adultOn.code, 200);
  assert.equal(out.adultOn.baseRules, true);
  assert.equal(out.adultOn.kidCore, true, 'adult profile, safety ON -> kid core present');

  // The documented under-13 rule (lib/safety.js): 13-17 with safety
  // off is not a minor band, so no kid core — pinned as-is; widening
  // it would be a policy change, not wiring (safety-gap-map §7).
  assert.equal(out.teenOff.code, 200);
  assert.equal(out.teenOff.kidCore, false, '13-17, safety off -> no kid core under the current rule');
});

test('prime safety (bite 2): unresolvable profile in enforced mode lands on the safe default, not no-safety', () => {
  const out = runChild();
  for (const name of ['throws', 'noRow', 'incomplete']) {
    const r = out[name];
    assert.equal(r.code, 200, `${name}: prime still succeeds`);
    assert.equal(r.baseRules, true, `${name}: base guardrails present`);
    assert.equal(r.kidCore, true, `${name}: safe default -> kid core present`);
    assert.ok(r.profileDelta >= 1, `${name}: profile store consulted`);
  }
});

test('prime safety (bite 2): two tenants — no safety state or memory crosses', () => {
  const out = runChild();
  const other = out.otherTenant;
  assert.equal(other.code, 200);
  assert.equal(other.kidCore, false, 'other tenant is an adult profile: no kid core from Troy\'s minor profile');
  assert.equal(other.hasStranger, true, 'other tenant sees its own memories');
  assert.equal(other.hasDog, false, 'other tenant never sees Troy\'s memories');
  // And the reverse direction is pinned by the minor scenarios above
  // (hasStranger / hasOtherTenantTroy false under Troy's token).
});

test('prime safety (bite 2): compat mode is unchanged — request-less safety, zero profile queries', () => {
  const out = runChild();
  const compat = out.compat;
  assert.equal(compat.code, 200);
  assert.equal(compat.ok, true);
  assert.equal(compat.tenantId, null, 'compat mode reports no scoping tenant');
  assert.equal(compat.profileDelta, 0, 'compat mode makes NO profile query');
  assert.equal(compat.baseRules, true, 'compat prompt still carries the unconditional guardrails');
  assert.equal(compat.kidCore, false, 'compat prompt construction unchanged (no profile, no kid core)');
  // Compat memory semantics unchanged: user_id 'troy' rows, including
  // the one stamped with another tenant (compat has no tenants).
  assert.equal(compat.hasDog, true);
  assert.equal(compat.hasOtherTenantTroy, true);
});
