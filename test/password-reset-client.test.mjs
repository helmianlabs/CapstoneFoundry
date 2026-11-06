// test/password-reset-client.test.mjs — password-reset bite, the
// CLIENT door (public/onboarding.js): the "Forgot password?" request
// view, the #reset=<token> set-new-password view, and the boot
// precedence that lets a reset link open over a live session.
//
// The server half is pinned by test/password-reset.test.mjs; this
// file pins the face:
//   - parseResetToken (the pure hash helper): the server's mint shape
//     (64 hex chars) and nothing else — missing, malformed, and
//     extra-param hashes all read as "no reset in this URL".
//   - The two wire calls ride the injectable session-fetch seam
//     (public/requests.js's pattern): exact URL, POST, JSON body of
//     exactly the contracted fields — and they never throw, so the
//     request view can honor anti-enumeration (any answer earns the
//     same confirmation) while a network failure reads differently.
//   - The confirmation / done / stale / weak wordings, character for
//     character.
//
// Method (house client pattern): onboarding.js boots against the DOM
// at module scope, so it is never imported here. The reset block —
// copy constants, the helper, the two wire calls — runs under
// node:vm exactly as shipped (the profile-reprime harness), with
// tbFetch stubbed; the views and boot wiring a vm slice cannot reach
// are pinned statically over the source.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const onboardingJs = readFileSync(new URL('../public/onboarding.js', import.meta.url), 'utf8');

function sliceExclusive(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `start marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after: ${startMarker}`);
  return src.slice(a, b);
}

// Run the shipped reset block (copy constants through the two wire
// calls) in a fresh vm context whose only outside name is the
// sandbox's tbFetch — the default seam the wire calls fall back to.
function loadResetBlock(tbFetchStub) {
  const block = sliceExclusive(
    onboardingJs,
    'export const RESET_REQUEST_SENT_TEXT',
    'function clearResetHash',
  ).replace(/^export /gm, '');
  const sandbox = { tbFetch: tbFetchStub };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);
  return vm.runInContext(
    '({ parseResetToken, requestPasswordReset, confirmPasswordReset,'
    + ' RESET_REQUEST_SENT_TEXT, RESET_DONE_TEXT, RESET_STALE_TEXT, RESET_WEAK_TEXT })',
    sandbox,
  );
}

// A fetch stub with tbFetch's exact contract (see requests-client):
// a plain-object body is JSON-encoded, the options ride along, and
// every call is recorded for shape assertions.
function recordingFetch(responder) {
  const calls = [];
  const fetchFn = async (path, opts = {}) => {
    let body = opts.body;
    if (body && typeof body === 'object') body = JSON.stringify(body);
    calls.push({ path, method: opts.method || 'GET', headers: opts.headers || {}, body });
    return responder();
  };
  return { calls, fetchFn };
}

// Result objects are born inside the vm realm, whose Object.prototype
// is not this realm's — deepStrictEqual would refuse them on sight.
// The wire results are pure JSON shapes, so compare them as JSON.
const plain = (o) => JSON.parse(JSON.stringify(o));

const TOKEN = '0123456789abcdef'.repeat(4); // 64 hex chars, the mint shape
const noFetch = async () => { throw new Error('tbFetch must not be called without an injected seam here'); };

describe('parseResetToken', () => {
  const { parseResetToken } = loadResetBlock(noFetch);

  test('a well-formed #reset=<64 hex> hash yields the token', () => {
    assert.equal(parseResetToken(`#reset=${TOKEN}`), TOKEN);
    assert.equal(parseResetToken(`reset=${TOKEN}`), TOKEN); // leading # tolerated
  });

  test('missing: empty, non-string, and param-less hashes yield null', () => {
    assert.equal(parseResetToken(''), null);
    assert.equal(parseResetToken('#'), null);
    assert.equal(parseResetToken('#/some/route'), null);
    assert.equal(parseResetToken(undefined), null);
    assert.equal(parseResetToken(null), null);
    assert.equal(parseResetToken(42), null);
  });

  test('malformed: wrong length, non-hex, and empty values yield null', () => {
    assert.equal(parseResetToken(`#reset=${TOKEN.slice(1)}`), null); // 63 chars
    assert.equal(parseResetToken(`#reset=${TOKEN}a`), null); // 65 chars
    assert.equal(parseResetToken(`#reset=${'g'.repeat(64)}`), null); // not hex
    assert.equal(parseResetToken('#reset='), null);
    assert.equal(parseResetToken('#reset=not-a-token'), null);
  });

  test('extra params: the reset param is found among others, either side', () => {
    assert.equal(parseResetToken(`#reset=${TOKEN}&utm=email`), TOKEN);
    assert.equal(parseResetToken(`#foo=1&reset=${TOKEN}`), TOKEN);
    assert.equal(parseResetToken(`#resetting=${TOKEN}`), null); // a different key is not reset
  });
});

describe('the reset copy, character for character', () => {
  const copy = loadResetBlock(noFetch);

  test('the four lines are the specced wordings', () => {
    assert.equal(copy.RESET_REQUEST_SENT_TEXT, 'If that email has an account, a reset link is on its way. Check your inbox.');
    assert.equal(copy.RESET_DONE_TEXT, 'Your password is changed. You can sign in now.');
    assert.equal(copy.RESET_STALE_TEXT, 'That reset link is old or already used. Request a new one.');
    assert.equal(copy.RESET_WEAK_TEXT, 'Please use at least 10 characters.');
  });
});

describe('requestPasswordReset — the wire call', () => {
  test('POSTs exactly { email } to /api/auth/request-reset and carries the 200 shape', async () => {
    const { requestPasswordReset } = loadResetBlock(noFetch);
    const { calls, fetchFn } = recordingFetch(() => ({ status: 200, json: async () => ({ ok: true }) }));
    const res = await requestPasswordReset('driver@example.com', { fetchFn });
    assert.deepEqual(plain(res), { responded: true, status: 200, data: { ok: true } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/auth/request-reset');
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].body), { email: 'driver@example.com' });
  });

  test('ANY server answer counts as responded (the anti-enumeration seam)', async () => {
    const { requestPasswordReset } = loadResetBlock(noFetch);
    for (const status of [200, 400, 500]) {
      const { fetchFn } = recordingFetch(() => ({ status, json: async () => ({}) }));
      const res = await requestPasswordReset('whoever@example.com', { fetchFn });
      assert.equal(res.responded, true, `status ${status}`);
      assert.equal(res.status, status, `status ${status}`);
    }
  });

  test('a network failure is responded:false and never throws', async () => {
    const { requestPasswordReset } = loadResetBlock(noFetch);
    const down = async () => { throw new Error('offline'); };
    const res = await requestPasswordReset('driver@example.com', { fetchFn: down });
    assert.deepEqual(plain(res), { responded: false, status: 0, data: null });
  });

  test('the default seam is tbFetch itself', async () => {
    const { calls, fetchFn } = recordingFetch(() => ({ status: 200, json: async () => ({ ok: true }) }));
    const { requestPasswordReset } = loadResetBlock(fetchFn);
    const res = await requestPasswordReset('driver@example.com');
    assert.equal(res.responded, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/auth/request-reset');
  });
});

describe('confirmPasswordReset — the wire call', () => {
  test('POSTs exactly { token, newPassword } to /api/auth/confirm-reset', async () => {
    const { confirmPasswordReset } = loadResetBlock(noFetch);
    const { calls, fetchFn } = recordingFetch(() => ({ status: 200, json: async () => ({ ok: true }) }));
    const res = await confirmPasswordReset(TOKEN, 'a fresh passphrase', { fetchFn });
    assert.deepEqual(plain(res), { responded: true, status: 200, data: { ok: true } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/auth/confirm-reset');
    assert.equal(calls[0].method, 'POST');
    // Exactly the two contracted fields — no email, no tenant, nothing else.
    assert.deepEqual(JSON.parse(calls[0].body), { token: TOKEN, newPassword: 'a fresh passphrase' });
  });

  test('the two 400 refusals pass through untouched for the view to face', async () => {
    const { confirmPasswordReset } = loadResetBlock(noFetch);
    for (const error of ['invalid_or_expired_token', 'weak_password']) {
      const { fetchFn } = recordingFetch(() => ({ status: 400, json: async () => ({ error }) }));
      const res = await confirmPasswordReset(TOKEN, 'whatever-pass', { fetchFn });
      assert.deepEqual(plain(res), { responded: true, status: 400, data: { error } }, error);
    }
  });

  test('a network failure is responded:false and never throws', async () => {
    const { confirmPasswordReset } = loadResetBlock(noFetch);
    const down = async () => { throw new Error('offline'); };
    const res = await confirmPasswordReset(TOKEN, 'a fresh passphrase', { fetchFn: down });
    assert.deepEqual(plain(res), { responded: false, status: 0, data: null });
  });
});

describe('the door in onboarding.js (source assertions)', () => {
  test('public/onboarding.js still parses as a valid ES module (node --check)', () => {
    execFileSync(process.execPath, ['--check', `${root}public/onboarding.js`], { stdio: 'pipe' });
  });

  test('the login form carries the Forgot password? door, login mode only', () => {
    assert.ok(onboardingJs.includes('id="acctForgot"'));
    assert.ok(onboardingJs.includes('Forgot password?'));
    assert.ok(onboardingJs.includes("forgotEl.style.display = mode === 'login' ? '' : 'none'"));
    assert.ok(onboardingJs.includes("forgotEl.addEventListener('click', () => showResetRequest())"));
  });

  test('both reset endpoints are the contracted paths', () => {
    assert.ok(onboardingJs.includes("'/api/auth/request-reset'"));
    assert.ok(onboardingJs.includes("'/api/auth/confirm-reset'"));
  });

  test('the request view shows the anti-enumeration line on any response', () => {
    const view = sliceExclusive(onboardingJs, 'function showResetRequest', 'function showResetPassword');
    assert.ok(view.includes('Email me a reset link'));
    assert.ok(view.includes('Back to sign in'));
    assert.ok(view.includes('result.responded'));
    assert.ok(view.includes('RESET_REQUEST_SENT_TEXT'));
    assert.ok(view.includes('Could not reach the server — please try again.'));
  });

  test('the set-password view checks length + match locally BEFORE the confirm call', () => {
    const view = sliceExclusive(onboardingJs, 'function showResetPassword', '// ─── Settings -> Account & Safety pane');
    assert.ok(view.includes('Set new password'));
    const lenCheck = view.indexOf('password.length < 10');
    const matchCheck = view.indexOf("The two passwords didn't match.");
    const call = view.indexOf('confirmPasswordReset(token, password)');
    assert.ok(lenCheck >= 0 && matchCheck > lenCheck, 'both local checks are present, length first');
    assert.ok(call > matchCheck, 'the confirm call comes after the local checks');
  });

  test('confirm outcomes: 200 clears the hash and lands on sign-in with the done line', () => {
    const view = sliceExclusive(onboardingJs, 'function showResetPassword', '// ─── Settings -> Account & Safety pane');
    assert.ok(view.includes('clearResetHash()'));
    assert.ok(onboardingJs.includes('history.replaceState'), 'clearResetHash scrubs the URL via replaceState');
    assert.ok(view.includes('showAuth(RESET_DONE_TEXT)'));
    assert.ok(view.includes("result.data?.error === 'invalid_or_expired_token'"));
    assert.ok(view.includes('showResetRequest(RESET_STALE_TEXT)'));
    assert.ok(view.includes("result.data?.error === 'weak_password'"));
  });

  test('boot precedence: a reset token is routed before the auth form AND before onboarding', () => {
    const init = sliceExclusive(onboardingJs, 'async function init()', '\ninit();');
    assert.ok(init.includes('parseResetToken(location.hash)'));
    const reset401 = init.indexOf('showResetPassword(resetToken)');
    const authForm = init.indexOf('showAuth();');
    assert.ok(reset401 >= 0 && authForm > reset401, 'the 401 branch checks the reset before showAuth');
    const reset200 = init.indexOf('showResetPassword(resetToken)', reset401 + 1);
    const onboarding = init.indexOf('showOnboarding()');
    assert.ok(reset200 > reset401 && onboarding > reset200, 'the 200 branch checks the reset before onboarding');
    // ...and the routes the cancel path returns to are recorded on both.
    assert.ok(init.includes("bootRoute = 'auth'"));
    assert.ok(init.includes("bootRoute = (!prof.data?.display_name || !prof.data?.age_band) ? 'onboarding' : 'app'"));
  });

  test('a reset link followed mid-session takes the overlay (hashchange)', () => {
    assert.ok(onboardingJs.includes("window.addEventListener('hashchange'"));
    const hook = sliceExclusive(onboardingJs, "window.addEventListener('hashchange'", 'init();');
    assert.ok(hook.includes('accountsMode'));
    assert.ok(hook.includes('parseResetToken(location.hash)'));
    assert.ok(hook.includes('showResetPassword(token)'));
  });

  test('cancelling the reset returns to the recorded boot route', () => {
    const exit = sliceExclusive(onboardingJs, 'function exitResetFlow()', 'function showResetRequest');
    assert.ok(exit.includes('clearResetHash()'));
    assert.ok(exit.includes("bootRoute === 'app'"));
    assert.ok(exit.includes('hideOverlay()'));
    assert.ok(exit.includes("bootRoute === 'onboarding'"));
    assert.ok(exit.includes('showAuth()'));
  });
});
