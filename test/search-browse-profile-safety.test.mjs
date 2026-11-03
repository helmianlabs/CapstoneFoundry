// test/search-browse-profile-safety.test.mjs — safety wiring bite 7
// (safety-gap-map §7): handler-level pins for the voice agent's two
// outside-content tools. search_web and browse_url now resolve the
// tenant from the tool's userId (the same rule as every other tool
// handler) and take the profile safety decision through Bite 1's
// shared resolver, so their moderation fails closed exactly when the
// tenant profile says it must — and the summary each tool produces is
// screened as output before it reaches the caller.
//
// Pinned here (the gap map's bite-7 proof line): a minor profile
// with moderation unavailable refuses search before any web/LLM call
// and refuses browse with no page content returned; a request body
// claiming safetyMode:false cannot weaken that profile on either
// tool; an adult profile with clean moderation preserves the current
// behavior end to end; flagged page text is refused under both a
// minor and an adult profile; a summary that moderation flags never
// reaches the caller on either tool; enforced mode with no
// resolvable tenant rejects 400; compat mode is untouched (request
// safety decides, historical fail-open, zero profile queries).
// Also pinned: the provisioning contract — search_web and browse_url
// now appear in scripts/update-agent-config.mjs's identity
// definitions with the canonical {{user_id}} binding, and no safety
// field is required from the model (the script is imported, never
// executed; the deployed agent's schemas stay UNVERIFIED until a
// separately authorized live run).
//
// The handlers run in a child process with module mocks — see
// test/fixtures/search-browse-safety-child.mjs. NOT covered: any
// live deployment, live agent, real web fetch, or real provider
// (the child stubs fetch and the LLM/DDG seams and counts calls).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const {
  IDENTITY_TOOL_DEFINITIONS,
  IDENTITY_TOOL_NAMES,
  userIdParamPatch,
} = await import('../scripts/update-agent-config.mjs');

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/search-browse-safety-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', child], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON result from child:\n${run.stdout}`);
  return JSON.parse(line);
}

const results = runChild();

test('handler pins (bite 7): minor profile + moderation unavailable -> search makes no web/LLM call, browse returns no page content', () => {
  const { search, browse } = results.minorDown;

  assert.ok(search.profileDelta >= 1, 'search: profile store consulted');
  assert.equal(search.code, 200, 'search: refusal is the standard 200 shape');
  assert.equal(search.queryRefusal, true, 'search: standard query refusal returned');
  assert.equal(search.ddgDelta, 0, 'search: no web search was performed');
  assert.equal(search.llmDelta, 0, 'search: no LLM call was made');

  assert.ok(browse.profileDelta >= 1, 'browse: profile store consulted');
  assert.equal(browse.code, 200, 'browse: refusal is the standard 200 shape');
  assert.equal(browse.siteRefusal, true, 'browse: unsafe-site refusal returned');
  assert.equal(browse.leaksPage, false, 'browse: no page content in the refusal');
  assert.equal(browse.llmDelta, 0, 'browse: no summarizer call was made');
});

test('handler pins (bite 7): a request body claiming safetyMode:false cannot override a minor profile on either tool', () => {
  const { search, browse } = results.minorWeaken;

  assert.ok(search.profileDelta >= 1, 'search: profile store consulted');
  assert.equal(search.queryRefusal, true, 'search: refused despite the request claiming adult');
  assert.equal(search.ddgDelta, 0, 'search: no web search was performed');
  assert.equal(search.llmDelta, 0, 'search: no LLM call was made');

  assert.ok(browse.profileDelta >= 1, 'browse: profile store consulted');
  assert.equal(browse.siteRefusal, true, 'browse: refused despite the request claiming adult');
  assert.equal(browse.leaksPage, false, 'browse: no page content in the refusal');
  assert.equal(browse.llmDelta, 0, 'browse: no summarizer call was made');
});

test('handler pins (bite 7): adult profile + clean moderation -> current behavior preserved on both tools', () => {
  const { search, browse } = results.adultClean;

  assert.ok(search.profileDelta >= 1, 'search: profile store consulted');
  assert.equal(search.code, 200, 'search: completed');
  assert.equal(search.queryRefusal, false, 'search: not refused');
  assert.ok(search.ddgDelta >= 1, 'search: the web search ran');
  assert.ok(search.llmDelta >= 1, 'search: the summarizer ran');
  assert.ok(search.result?.includes('Frogs are amphibians'), 'search: the summary came back');

  assert.ok(browse.profileDelta >= 1, 'browse: profile store consulted');
  assert.equal(browse.code, 200, 'browse: completed');
  assert.equal(browse.siteRefusal, false, 'browse: not refused');
  assert.ok(browse.pageDelta >= 1, 'browse: the page was fetched');
  assert.ok(browse.llmDelta >= 1, 'browse: the summarizer ran');
  assert.ok(browse.result?.includes('Frogs are amphibians'), 'browse: the summary came back');
});

test('handler pins (bite 7): flagged page text is refused in both profiles', () => {
  for (const [label, t] of [['minor', results.flaggedPageMinor], ['adult', results.flaggedPageAdult]]) {
    const { browse } = t;
    assert.ok(browse.profileDelta >= 1, `${label}: profile store consulted`);
    assert.equal(browse.siteRefusal, true, `${label}: flagged page refused`);
    assert.equal(browse.leaksMarker, false, `${label}: flagged text never returned`);
    assert.equal(browse.llmDelta, 0, `${label}: summarizer never called`);
  }
});

test('handler pins (bite 7): a flagged query is refused under an adult profile too', () => {
  const { search } = results.flaggedQuery;
  assert.equal(search.queryRefusal, true, 'search: flagged query refused');
  assert.equal(search.ddgDelta, 0, 'search: no web search was performed');
  assert.equal(search.llmDelta, 0, 'search: no LLM call was made');
});

test('handler pins (bite 7): the summary-output screening fires — a flagged summary never reaches the caller', () => {
  const { search, browse } = results.flaggedSummary;

  // The summarizer DID run on both tools; the refusal happened at
  // the output screen, after production, before return.
  assert.ok(search.llmDelta >= 1, 'search: the summary was produced');
  assert.equal(search.queryRefusal, true, 'search: flagged summary refused at the output screen');
  assert.ok(!search.result?.includes('ZXQFLAGGED'), 'search: flagged summary text never returned');

  assert.ok(browse.llmDelta >= 1, 'browse: the summary was produced');
  assert.equal(browse.siteRefusal, true, 'browse: flagged summary refused at the output screen');
  assert.equal(browse.leaksMarker, false, 'browse: flagged summary text never returned');
});

test('handler pins (bite 7): enforced mode with no resolvable tenant rejects both tools before any call', () => {
  const { search, browse } = results.noIdentity;

  assert.equal(search.code, 400, 'search: rejected');
  assert.equal(search.error, 'tenant identity required (session token or tenant user_id)', 'search: the tool-handler tenant rule');
  assert.equal(search.profileDelta, 0, 'search: no profile query without a tenant');
  assert.equal(search.ddgDelta, 0, 'search: no web search was performed');
  assert.equal(search.llmDelta, 0, 'search: no LLM call was made');

  assert.equal(browse.code, 400, 'browse: rejected');
  assert.equal(browse.error, 'tenant identity required (session token or tenant user_id)', 'browse: the tool-handler tenant rule');
  assert.equal(browse.profileDelta, 0, 'browse: no profile query without a tenant');
  assert.equal(browse.pageDelta, 0, 'browse: no page was fetched');
  assert.equal(browse.llmDelta, 0, 'browse: no summarizer call was made');
});

test('handler pins (bite 7): compat mode is unchanged — request safety decides, zero profile queries', () => {
  const { search, browse } = results.compat;

  // No SESSION_SECRET and moderation DOWN: the historical fail-open
  // posture carries both tools through, exactly as before this bite,
  // and the profile store was never touched — the fake store was set
  // to throw, so a single query would have changed the outcome.
  assert.equal(search.profileDelta, 0, 'search: compat mode makes NO profile query');
  assert.equal(search.queryRefusal, false, 'search: not refused');
  assert.ok(search.ddgDelta >= 1, 'search: the web search ran');
  assert.ok(search.llmDelta >= 1, 'search: the summarizer ran');

  assert.equal(browse.profileDelta, 0, 'browse: compat mode makes NO profile query');
  assert.equal(browse.siteRefusal, false, 'browse: not refused');
  assert.ok(browse.pageDelta >= 1, 'browse: the page was fetched');
  assert.ok(browse.llmDelta >= 1, 'browse: the summarizer ran');
});

test('provisioning contract (bite 7): search_web and browse_url carry the identity binding requirement', () => {
  for (const [name, endpoint] of [['search_web', '/api/search'], ['browse_url', '/api/browse']]) {
    assert.ok(IDENTITY_TOOL_NAMES.includes(name), `${name} is in the identity set`);
    const def = IDENTITY_TOOL_DEFINITIONS.find((d) => d.name === name);
    assert.equal(def.endpoint, endpoint, `${name}: endpoint`);
    const schema = def.identityRequestBodySchema;
    assert.ok(schema.required.includes('userId'), `${name}: userId is required`);
    assert.deepEqual(schema.properties.userId, userIdParamPatch, `${name}: the canonical {{user_id}} binding`);
    for (const field of [...schema.required, ...Object.keys(schema.properties)]) {
      assert.ok(!/safety|age/i.test(field), `${name}: no safety field is required from the model`);
    }
  }
});
