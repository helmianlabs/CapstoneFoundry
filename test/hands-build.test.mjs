// test/hands-build.test.mjs — hermetic proof for the real hands build.
//
// lib/handsBuild.js takes its dependencies injected, so this suite
// exercises the full orchestration (generate → store → register →
// verify) with fakes: no network, no Blob, no database. The contract
// under test is the one the 2026-11-13 audit found broken: success is
// reachable ONLY after the artifact exists and is listed, and every
// failure stage throws instead of fabricating a result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArtifact,
  cleanGeneratedHtml,
  isCompleteHtml,
  extractTitle,
  safeSegment,
  HandsBuildError,
} from '../lib/handsBuild.js';

const GOOD_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en"><head><meta charset="utf-8">',
  '<title>Purple Zucchini Farms</title>',
  '<style>body{font-family:sans-serif}</style></head>',
  '<body><h1>Purple Zucchini Farms</h1><p>Fresh purple zucchini, grown loud.</p>',
  '<p>Visit the farm stand every Saturday for heirloom squash, seeds, and tours.</p>',
  '</body></html>',
].join('\n');

function fakeDeps(overrides = {}) {
  const calls = { registered: [], stored: [] };
  const deps = {
    generate: async () => GOOD_HTML,
    store: async (pathname, html) => {
      calls.stored.push({ pathname, html });
      return `https://blob.example/${pathname}`;
    },
    register: async (entry) => { calls.registered.push(entry); },
    verify: async () => true,
    ...overrides,
  };
  return { deps, calls };
}

test('success: returns the artifact only after store + register + verify', async () => {
  const { deps, calls } = fakeDeps();
  const built = await buildArtifact({ prompt: 'Build a landing page about purple zucchini farms', owner: 'troy', deps });
  assert.equal(built.title, 'Purple Zucchini Farms');
  assert.match(built.url, /^https:\/\/blob\.example\/thinkinbuddy\/artifacts\/troy\/\d+\.html$/);
  assert.equal(built.pathname, `thinkinbuddy/artifacts/troy/${built.id}.html`);
  assert.equal(calls.stored.length, 1);
  assert.equal(calls.registered.length, 1);
  assert.equal(calls.registered[0].type, 'artifact');
  assert.equal(calls.registered[0].blobUrl, built.url);
  assert.equal(calls.registered[0].userId, 'troy');
});

test('fenced model output is unwrapped and still builds', async () => {
  const { deps } = fakeDeps({ generate: async () => '```html\n' + GOOD_HTML + '\n```' });
  const built = await buildArtifact({ prompt: 'zucchini', owner: 'troy', deps });
  assert.equal(built.title, 'Purple Zucchini Farms');
});

test('generation failure: honest error at stage "generate", nothing stored', async () => {
  const { deps, calls } = fakeDeps({ generate: async () => { throw new Error('provider down'); } });
  await assert.rejects(
    buildArtifact({ prompt: 'zucchini', owner: 'troy', deps }),
    (e) => e instanceof HandsBuildError && e.stage === 'generate' && /provider down/.test(e.message),
  );
  assert.equal(calls.stored.length, 0);
  assert.equal(calls.registered.length, 0);
});

test('incomplete page (fragment): rejected at stage "generate", nothing stored', async () => {
  const { deps, calls } = fakeDeps({ generate: async () => '<p>Sorry, I cannot build pages.</p>' });
  await assert.rejects(
    buildArtifact({ prompt: 'zucchini', owner: 'troy', deps }),
    (e) => e instanceof HandsBuildError && e.stage === 'generate',
  );
  assert.equal(calls.stored.length, 0);
});

test('incomplete first attempt: retried once, complete retry builds', async () => {
  let calls = 0;
  const { deps, calls: rec } = fakeDeps({
    generate: async (_p, { attempt } = {}) => {
      calls++;
      return attempt > 1 ? GOOD_HTML : GOOD_HTML.slice(0, 200); // cut off mid-document
    },
  });
  const built = await buildArtifact({ prompt: 'big page', owner: 'troy', deps });
  assert.equal(calls, 2);
  assert.equal(built.title, 'Purple Zucchini Farms');
  assert.equal(rec.stored.length, 1);
});

test('incomplete on both attempts: still an honest stage "generate" error, nothing stored', async () => {
  let calls = 0;
  const { deps, calls: rec } = fakeDeps({
    generate: async () => { calls++; return GOOD_HTML.slice(0, 200); },
  });
  await assert.rejects(
    buildArtifact({ prompt: 'big page', owner: 'troy', deps }),
    (e) => e instanceof HandsBuildError && e.stage === 'generate' && /incomplete/.test(e.message),
  );
  assert.equal(calls, 2);
  assert.equal(rec.stored.length, 0);
});

test('store failure: honest error at stage "store", nothing registered', async () => {
  const { deps, calls } = fakeDeps({ store: async () => { throw new Error('blob 500'); } });
  await assert.rejects(
    buildArtifact({ prompt: 'zucchini', owner: 'troy', deps }),
    (e) => e instanceof HandsBuildError && e.stage === 'store',
  );
  assert.equal(calls.registered.length, 0);
});

test('register failure: honest error at stage "register"', async () => {
  const { deps } = fakeDeps({ register: async () => { throw new Error('db down'); } });
  await assert.rejects(
    buildArtifact({ prompt: 'zucchini', owner: 'troy', deps }),
    (e) => e instanceof HandsBuildError && e.stage === 'register',
  );
});

test('verify failure: success is NOT returned even though store+register ran', async () => {
  const { deps, calls } = fakeDeps({ verify: async () => false });
  await assert.rejects(
    buildArtifact({ prompt: 'zucchini', owner: 'troy', deps }),
    (e) => e instanceof HandsBuildError && e.stage === 'verify',
  );
  assert.equal(calls.stored.length, 1);
  assert.equal(calls.registered.length, 1);
});

test('verify throwing counts as not built', async () => {
  const { deps } = fakeDeps({ verify: async () => { throw new Error('read-back unreachable'); } });
  await assert.rejects(
    buildArtifact({ prompt: 'zucchini', owner: 'troy', deps }),
    (e) => e instanceof HandsBuildError && e.stage === 'verify',
  );
});

test('helpers: html cleaning, completeness, title, segment safety', () => {
  assert.equal(cleanGeneratedHtml('Here is your page:\n' + GOOD_HTML).startsWith('<!DOCTYPE html>'), true);
  assert.equal(isCompleteHtml(GOOD_HTML), true);
  assert.equal(isCompleteHtml('<html><body>tiny</body></html>'), false); // too short to be a page
  assert.equal(isCompleteHtml('plain text, definitely not a page at all, no tags here whatsoever..........'), false);
  assert.equal(extractTitle(GOOD_HTML, 'ignored'), 'Purple Zucchini Farms');
  assert.equal(extractTitle('<html></html>', 'Build a page about bees'), 'Build a page about bees');
  assert.equal(safeSegment('troy'), 'troy');
  assert.equal(safeSegment('00000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-000000000001');
  assert.equal(safeSegment('../etc/passwd'), null);
  assert.equal(safeSegment(''), null);
});
