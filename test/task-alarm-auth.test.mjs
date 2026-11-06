// Task and alarm privacy. A tenant UUID is not a credential.
// The child calls the real handlers with @vercel/blob mocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/task-alarm-auth-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', child], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON from child:\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(line);
}

const http = runChild();

test('unauthenticated task and alarm calls are rejected and do not touch blob', () => {
  for (const key of ['taskGetUnauth', 'taskPostUnauth', 'alarmGetUnauth', 'alarmPostUnauth']) {
    const r = http[key];
    assert.equal(r.code, 401, key);
    assert.deepEqual(r.body, { error: 'Unauthorized' });
    assert.deepEqual(r.touched, [], key);
    assert.equal(JSON.stringify(r.body).includes('alpha-task'), false);
    assert.equal(JSON.stringify(r.body).includes('beta-alarm'), false);
  }
});

test('the owning session saves and lists only its tasks', () => {
  assert.equal(http.taskOwn.code, 200);
  assert.equal(http.taskOwn.body.ok, true);
  assert.ok(http.paths.taskPuts.some((p) => p.startsWith(`tasks/${TENANT_A}/`)));
  assert.equal(http.paths.taskPuts.some((p) => !p.startsWith(`tasks/${TENANT_A}/`)), false);
  assert.equal(http.taskListOwn.code, 200);
  assert.ok(Array.isArray(http.taskListOwn.body));
  assert.equal(http.taskListOwn.body.length, 1);
  assert.equal(http.taskListOwn.body[0].task, 'alpha-task');
  assert.equal(http.taskListOwn.body[0].userId, TENANT_A);
});

test('a session cannot read another tenant\'s tasks or alarms', () => {
  assert.equal(http.taskCross.code, 403);
  assert.deepEqual(http.taskCross.body, { error: 'Forbidden' });
  assert.deepEqual(http.taskCross.touched, []);

  assert.equal(http.alarmCross.code, 403);
  assert.deepEqual(http.alarmCross.body, { error: 'Forbidden' });
  assert.deepEqual(http.alarmCross.touched, []);
  assert.equal(JSON.stringify(http.alarmCross.body).includes('beta-alarm'), false);
});

test('new task and alarm blobs are private and are not read by public URL', () => {
  assert.ok(http.paths.writes.length > 0);
  for (const write of http.paths.writes) {
    assert.equal(write.access, 'private', `${write.op} ${write.path}`);
  }
  assert.equal(http.paths.writes.some((w) => w.access === 'public'), false);
  assert.equal(http.alarmDeliver.code, 200);
  assert.equal(http.alarmDeliver.body.ok, true);
  assert.ok(http.paths.storeKeys.some((k) => k.startsWith(`alarms/${TENANT_B}/`)));
});

test('chat action-tag saves only under an authenticated tenant prefix', () => {
  assert.equal(http.chatSkip, null);
  assert.equal(http.chatBad, null);
  assert.equal(http.chatPuts.length, 1);
  assert.equal(http.chatPuts[0].access, 'private');
  assert.ok(http.chatPuts[0].path.startsWith(`tasks/${TENANT_A}/`));
  assert.equal(http.chatPuts[0].path.startsWith('tasks/' + TENANT_A + '/') && !/^tasks\/\d+\.json$/.test(http.chatPuts[0].path), true);

  const chat = readFileSync(new URL('../server/handlers/chat.js', import.meta.url), 'utf8');
  assert.equal(chat.includes('tasks/${id}.json'), false);
  assert.equal(chat.includes("access: 'public'"), false);
  assert.ok(chat.includes('saveScopedTask'));
  assert.ok(chat.includes('no authenticated tenant'));
});

test('webhook secret selects the alarm tenant and cannot be used to delete it from another session', () => {
  assert.equal(http.alarmOwn.code, 200);
  assert.equal(http.alarmOwn.body.ok, true);
  assert.ok(http.paths.alarmPuts.some((p) => p.startsWith(`alarms/${TENANT_B}/`)));
  assert.equal(http.alarmListTool.code, 200);
  assert.equal(http.alarmListTool.body.ok, true);
  assert.equal(http.alarmListTool.body.alarms.length, 1);
  assert.equal(http.alarmListTool.body.alarms[0].title, 'beta-alarm');
  assert.equal(http.alarmListTool.body.alarms[0].userId, TENANT_B);

  assert.equal(http.alarmListOwn.code, 200);
  assert.deepEqual(http.alarmListOwn.body.alarms, []);

  assert.equal(http.alarmDeleteCross.code, 200);
  assert.equal(http.alarmDeleteCross.body.ok, true);
  assert.ok(http.paths.storeKeys.some((k) => k.startsWith(`alarms/${TENANT_B}/`)));
});
