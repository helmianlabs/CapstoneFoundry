// test/profile-reprime.test.mjs — safety bite 5: the profile
// completion + re-priming lifecycle on the client.
//
// The server half is already proven elsewhere: prime-agent resolves
// the tenant profile through the shared resolver at prime time
// (test/prime-safety.test.mjs), and an incomplete profile resolves to
// the fail-closed safe default (test/profile.test.mjs). What those
// tests cannot see is the CLIENT lifecycle this bite wires:
//
//   - public/onboarding.js publishes a 'tb-profile-changed' event
//     after every SUCCESSFUL profile/PIN write — and only then;
//   - index.html hears it, bumps its profile generation, and
//     re-primes; the widget :call path applies the cached prompt
//     only when it was primed from the current generation, so a
//     stale prime can never be observed by a new call;
//   - onboarding treats a profile with no age_band as incomplete
//     (not just one with no display_name) and the age band is an
//     explicit choice — no preselected 'adult' to fall through on.
//
// Method (house client-test pattern): the lifecycle block of
// index.html and the publisher of onboarding.js run under node:vm
// with a fake /api/prime-agent at the fetch seam. The fake returns
// the prompt the real server WOULD resolve for the profile as it
// stands at that moment ('PROMPT-KIDCORE' while the profile is
// incomplete or minor/safety-on, 'PROMPT-ADULT' for a completed
// adult profile with safety off) — the client never decides safety
// itself; these tests observe when it primes, what it applies, and
// what it withholds. Wiring that a vm slice cannot reach (which
// branches publish, the boot completeness checks, the select's
// options) is pinned statically, character-for-character where the
// house style does that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const onboardingJs = readFileSync(new URL('../public/onboarding.js', import.meta.url), 'utf8');

function sliceExclusive(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `start marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after: ${startMarker}`);
  return src.slice(a, b);
}

// ─── The lifecycle harness (index.html's prime block, live) ───────

function makeLifecycleHarness() {
  const server = { decision: 'KIDCORE', gate: null };
  const primeCalls = [];
  const fetch = (url, opts) => {
    primeCalls.push({ url, opts });
    const respond = () => Promise.resolve({
      json: async () => ({
        ok: true,
        prompt: `PROMPT-${server.decision}`,
        memoryCount: 0,
        buddyName: 'B',
        userId: 'u1',
      }),
    });
    return server.gate ? server.gate.then(respond) : respond();
  };
  const listeners = {};
  const sandbox = {
    console,
    fetch,
    tbAuthHeaders: () => ({ Authorization: 'Bearer tok-abc' }),
    window: {
      addEventListener: (name, fn) => { listeners[name] = fn; },
    },
  };
  vm.createContext(sandbox);
  const lifecycleSrc = sliceExclusive(indexHtml, 'let sessionPromptOverride = null;', 'function fireExtractMemories');
  vm.runInContext(lifecycleSrc, sandbox);
  const run = (expr) => vm.runInContext(expr, sandbox);
  run(`sessionPrimeContext = { buddyName: 'B', userName: 'U', userId: 'u1', mode: 'default' };`);
  return { server, primeCalls, listeners, run };
}

test('lifecycle: an incomplete profile primes fail-closed; completing it re-primes with the newly resolved decision', async () => {
  const h = makeLifecycleHarness();
  // Profile incomplete: the server's safe default is what a prime
  // returns (bites 1-2), and the client serves exactly that.
  await h.run('primeSessionPrompt()');
  assert.equal(h.primeCalls.length, 1);
  assert.equal(h.primeCalls[0].url, '/api/prime-agent');
  assert.equal(h.primeCalls[0].opts.headers.Authorization, 'Bearer tok-abc');
  assert.equal(h.run('currentSessionPrompt()'), 'PROMPT-KIDCORE');

  // The profile completes — as an adult with safety off. The save
  // publishes the change; a NEW prime must land before any next call
  // configuration can be produced from it.
  h.server.decision = 'ADULT';
  h.listeners['tb-profile-changed']();
  await h.run('reprimeSessionPrompt()');
  assert.equal(h.primeCalls.length, 2, 'the profile change was followed by a new /api/prime-agent request');
  assert.equal(h.primeCalls[1].url, '/api/prime-agent');
  assert.equal(h.run('currentSessionPrompt()'), 'PROMPT-ADULT');
  assert.equal(h.run('sessionPromptGeneration'), h.run('profileChangeGeneration'));
});

test('lifecycle: a safety-relevant change withholds the stale prime until the re-prime lands', async () => {
  const h = makeLifecycleHarness();
  h.server.decision = 'ADULT';
  await h.run('primeSessionPrompt()');
  assert.equal(h.run('currentSessionPrompt()'), 'PROMPT-ADULT');

  // Safety turns on in Settings. The change publishes; the re-prime
  // is still in flight (gated fetch). In that window the OLD prime
  // must be unobservable through the call path — never applied.
  h.server.decision = 'KIDCORE';
  let release;
  h.server.gate = new Promise((r) => { release = r; });
  h.listeners['tb-profile-changed']();
  assert.equal(h.run('currentSessionPrompt()'), null, 'stale override withheld while the re-prime is in flight');
  release();
  h.server.gate = null;
  await h.run('reprimeSessionPrompt()');
  assert.equal(h.run('currentSessionPrompt()'), 'PROMPT-KIDCORE');
});

test('lifecycle: no publication, no re-prime — a failed write leaves the previous prime untouched', async () => {
  const h = makeLifecycleHarness();
  await h.run('primeSessionPrompt()');
  assert.equal(h.run('currentSessionPrompt()'), 'PROMPT-KIDCORE');
  const callsBefore = h.primeCalls.length;
  const genBefore = h.run('profileChangeGeneration');
  // A failed profile write publishes nothing (pinned on the
  // onboarding.js side below: the publisher is called only from
  // success branches). With no event, the lifecycle must not move:
  // no new prime fetch, same generation, same prompt served.
  await new Promise((r) => setImmediate(r));
  assert.equal(h.primeCalls.length, callsBefore);
  assert.equal(h.run('profileChangeGeneration'), genBefore);
  assert.equal(h.run('currentSessionPrompt()'), 'PROMPT-KIDCORE');
});

test('lifecycle: a same-generation re-prime keeps the previous prompt until the new one lands', async () => {
  const h = makeLifecycleHarness();
  await h.run('primeSessionPrompt()');
  assert.equal(h.run('currentSessionPrompt()'), 'PROMPT-KIDCORE');
  // Hangup refresh: same profile generation, new memories. While the
  // fetch is in flight the call path must still apply the previous
  // override (it carries the recall rule), not fall through to the
  // agent's base prompt.
  h.server.decision = 'ADULT';
  let release;
  h.server.gate = new Promise((r) => { release = r; });
  const pending = h.run('reprimeSessionPrompt()');
  assert.equal(h.run('currentSessionPrompt()'), 'PROMPT-KIDCORE', 'same-generation refresh does not blank the override');
  release();
  h.server.gate = null;
  await pending;
  assert.equal(h.run('currentSessionPrompt()'), 'PROMPT-ADULT');
});

test('lifecycle: the re-prime operation is exposed and awaitable; concurrent callers share one prime', async () => {
  const h = makeLifecycleHarness();
  await h.run('primeSessionPrompt()');
  assert.equal(typeof h.run('window.reprimeSessionPrompt'), 'function');
  let release;
  h.server.gate = new Promise((r) => { release = r; });
  const callsBefore = h.primeCalls.length;
  const p1 = h.run('reprimeSessionPrompt()');
  const p2 = h.run('reprimeSessionPrompt()');
  assert.equal(h.primeCalls.length, callsBefore + 1, 'two re-prime callers, one prime fetch');
  release();
  h.server.gate = null;
  await p1;
  await p2;
  assert.equal(h.run('currentSessionPrompt()'), 'PROMPT-KIDCORE');
});

// ─── The publisher (onboarding.js), live under vm ─────────────────

test('publisher: publishProfileChanged dispatches exactly one tb-profile-changed event', () => {
  const dispatched = [];
  const sandbox = {
    console,
    CustomEvent: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent: (ev) => { dispatched.push(ev); return true; } },
  };
  vm.createContext(sandbox);
  const src = sliceExclusive(onboardingJs, 'function publishProfileChanged()', '// ─── Overlay');
  vm.runInContext(src, sandbox);
  sandbox.publishProfileChanged();
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'tb-profile-changed');
});

// ─── Static pins: publication happens on success branches only ────

test('onboarding.js publishes the change from every successful profile/PIN write, and nowhere else', () => {
  // The definition dispatches the exact event index.html hears.
  assert.ok(onboardingJs.includes("window.dispatchEvent(new CustomEvent('tb-profile-changed'))"));
  // Each call site sits directly on a success assignment:
  // onboarding profile save, onboarding PIN set, Settings safety
  // on/off (both assign profileCache = res.data), Settings PIN save.
  assert.match(onboardingJs, /profileCache = saved\.data;\s*publishProfileChanged\(\);/);
  assert.match(onboardingJs, /profileCache = res\.data;\s*publishProfileChanged\(\);/);
  assert.match(onboardingJs, /profileCache\.pin_set = true;\s*publishProfileChanged\(\);/);
  // Exactly eight call sites — the five bite-5 sites above plus
  // bite 9b's three profile writes (switch, create, edit save),
  // each on its success branch only. A ninth, on any failure
  // branch, would break the no-half-state rule this count pins.
  assert.equal((onboardingJs.match(/publishProfileChanged\(\);/g) || []).length, 8);
  assert.equal((onboardingJs.match(/function publishProfileChanged\(\)/g) || []).length, 1);
});

// ─── Static pins: explicit age band + completeness ────────────────

test('onboarding.js: the age band is an explicit choice — no preselected adult', () => {
  assert.ok(!onboardingJs.includes("? ' selected'"), 'no option is preselected by the band map');
  assert.ok(onboardingJs.includes('<option value="" selected>Choose…</option>'), 'a value-less placeholder leads the select');
  assert.ok(onboardingJs.includes('if (!bandEl.value)'), 'step 2 refuses to advance without a band');
  assert.ok(onboardingJs.includes('Pick who this buddy is for to continue.'));
});

test('onboarding.js: a profile with no age_band is onboarding-incomplete at boot and at sign-in', () => {
  assert.ok(onboardingJs.includes('if (!prof.data?.display_name || !prof.data?.age_band) showOnboarding();'), 'boot path');
  assert.ok(onboardingJs.includes('if (!prof?.data?.display_name || !prof?.data?.age_band) showOnboarding();'), 'sign-in path');
  assert.ok(!onboardingJs.includes('if (!prof.data?.display_name) showOnboarding();'), 'name-only check is gone (boot)');
  assert.ok(!onboardingJs.includes('if (!prof?.data?.display_name) showOnboarding();'), 'name-only check is gone (sign-in)');
});

// ─── Static pins: index.html's side of the lifecycle ──────────────

test('index.html: the re-prime is exposed, heard, and gated on the call path', () => {
  assert.ok(indexHtml.includes('window.reprimeSessionPrompt = reprimeSessionPrompt;'));
  assert.ok(indexHtml.includes("window.addEventListener('tb-profile-changed'"));

  // The prime fetch lives in exactly one place (primeSessionPrompt)
  // and still carries the session (the session-identity contract).
  assert.equal(indexHtml.split("fetch('/api/prime-agent'").length - 1, 1);
  const primeFn = sliceExclusive(indexHtml, 'async function primeSessionPrompt()', 'function currentSessionPrompt');
  assert.ok(primeFn.includes("fetch('/api/prime-agent'"));
  assert.ok(primeFn.includes('tbAuthHeaders()'));

  // The :call handler applies currentSessionPrompt() — never the
  // raw cached variable — and names the withheld-stale case.
  const callHandler = sliceExclusive(indexHtml, "document.addEventListener('elevenlabs-convai:call'", 'const userOnConnect = cfg.onConnect;');
  assert.ok(callHandler.includes('currentSessionPrompt()'), 'call config comes from the generation gate');
  assert.ok(!callHandler.includes('prompt: sessionPromptOverride'), 'the raw stale-able variable is never applied');
  assert.ok(callHandler.includes('withheld a stale session prompt override'));

  // initApp primes through the same operation the re-prime uses.
  const initPrime = sliceExclusive(indexHtml, 'sessionPrimeContext = {', '// Mount the hosted widget after the agent is primed');
  assert.ok(initPrime.includes('await primeSessionPrompt();'));
  assert.ok(initPrime.includes('userId: user.userId'));
});
