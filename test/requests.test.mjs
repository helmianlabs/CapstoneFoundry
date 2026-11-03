// test/requests.test.mjs — requests bite B1: the unified request
// box (provider + curriculum kinds). Fake db, no live database.
// These tests pin the spec's B1 proof (curriculum-requests-spec.md
// §6): POST stores exactly the whitelisted payload under the TOKEN's
// tenant; a body claiming another tenant_id is ignored; GET returns
// only the caller's rows; unknown kind/role/level/capability or an
// oversized field → 400 with nothing stored; and the status pipeline
// moves operator-side only, with 'verifying' curriculum-only and no
// curriculum shipping unverified.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRequestPayload, createRequest, listRequests, getRequest,
  canTransition, setRequestStatus, STATUS_LABELS,
} from '../lib/requests.js';
import { signSession, LEGACY_TENANT_ID } from '../lib/tenant.js';
import { handleRequests, publicRequest } from '../server/handlers/requests.js';
import { FakeDb } from './fake-db.mjs';

const SECRET = 'requests-test-secret';
process.env.SESSION_SECRET = SECRET;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}

function authedReq(tenantId, { method = 'POST', body = {} } = {}) {
  return {
    method,
    url: 'http://local/api/requests',
    headers: { authorization: `Bearer ${signSession(tenantId, SECRET)}` },
    body,
  };
}

const PROVIDER_BODY = {
  kind: 'provider',
  provider_name: 'Higgsfield',
  capability: 'video',
  use_case: 'Make short story videos from my kid\'s drawings',
};

const CURRICULUM_BODY = {
  kind: 'curriculum',
  role: 'parent',
  subject: 'SAT Math',
  level: '13-17',
  goal: 'My daughter freezes on word problems; I want her confident by spring.',
  source_links: ['https://www.khanacademy.org/sat'],
};

// ─── buildRequestPayload — the whitelist ────────────────────────────

test('provider payload is EXACTLY the three whitelisted fields — everything else stripped', () => {
  const { kind, payload } = buildRequestPayload({
    ...PROVIDER_BODY,
    tenant_id: TENANT_B,
    status: 'shipped',
    plan: 'helmian_connect',
    bucket: 999999,
    safety_mode: false,
    id: 'forged',
  });
  assert.equal(kind, 'provider');
  assert.deepEqual(payload, {
    provider_name: 'Higgsfield',
    capability: 'video',
    use_case: PROVIDER_BODY.use_case,
  });
});

test('curriculum payload is EXACTLY the five whitelisted fields', () => {
  const { kind, payload } = buildRequestPayload({ ...CURRICULUM_BODY, tenant_id: TENANT_B, extra: 'x' });
  assert.equal(kind, 'curriculum');
  assert.deepEqual(payload, {
    role: 'parent',
    subject: 'SAT Math',
    level: '13-17',
    goal: CURRICULUM_BODY.goal,
    source_links: ['https://www.khanacademy.org/sat'],
  });
});

test('curriculum payload omits source_links when none are given', () => {
  const { payload } = buildRequestPayload({
    kind: 'curriculum', role: 'teacher', subject: 'Phonics', level: '6-8', goal: 'Reading reps.',
  });
  assert.deepEqual(Object.keys(payload).sort(), ['goal', 'level', 'role', 'subject']);
});

test('unknown kind / capability / role / level are coded 400s', () => {
  assert.throws(() => buildRequestPayload({ kind: 'homework' }), (e) => e.code === 'invalid_kind');
  assert.throws(() => buildRequestPayload({}), (e) => e.code === 'invalid_kind');
  assert.throws(
    () => buildRequestPayload({ ...PROVIDER_BODY, capability: 'teleport' }),
    (e) => e.code === 'invalid_capability',
  );
  assert.throws(
    () => buildRequestPayload({ ...CURRICULUM_BODY, role: 'principal' }),
    (e) => e.code === 'invalid_role',
  );
  assert.throws(
    () => buildRequestPayload({ ...CURRICULUM_BODY, level: 'toddler' }),
    (e) => e.code === 'invalid_level',
  );
});

test('missing or oversized fields are coded 400s (subject ≤80, goal ≤300, name ≤120, use_case ≤300)', () => {
  assert.throws(() => buildRequestPayload({ ...PROVIDER_BODY, provider_name: '  ' }), (e) => e.code === 'invalid_field');
  assert.throws(() => buildRequestPayload({ ...PROVIDER_BODY, provider_name: 'x'.repeat(121) }), (e) => e.code === 'invalid_field');
  assert.throws(() => buildRequestPayload({ ...PROVIDER_BODY, use_case: 'x'.repeat(301) }), (e) => e.code === 'invalid_field');
  assert.throws(() => buildRequestPayload({ ...CURRICULUM_BODY, subject: 'x'.repeat(81) }), (e) => e.code === 'invalid_field');
  assert.throws(() => buildRequestPayload({ ...CURRICULUM_BODY, goal: 'x'.repeat(301) }), (e) => e.code === 'invalid_field');
  const noGoal = { ...CURRICULUM_BODY };
  delete noGoal.goal;
  assert.throws(() => buildRequestPayload(noGoal), (e) => e.code === 'invalid_field');
});

test('source_links: at most 3, each a real http(s) URL', () => {
  assert.throws(
    () => buildRequestPayload({ ...CURRICULUM_BODY, source_links: ['https://a.co', 'https://b.co', 'https://c.co', 'https://d.co'] }),
    (e) => e.code === 'invalid_source_links',
  );
  assert.throws(
    () => buildRequestPayload({ ...CURRICULUM_BODY, source_links: ['not a url'] }),
    (e) => e.code === 'invalid_source_links',
  );
  assert.throws(
    () => buildRequestPayload({ ...CURRICULUM_BODY, source_links: ['ftp://example.com/x'] }),
    (e) => e.code === 'invalid_source_links',
  );
  const { payload } = buildRequestPayload({
    ...CURRICULUM_BODY,
    source_links: ['https://a.co/1', 'https://b.co/2', 'https://c.co/3'],
  });
  assert.equal(payload.source_links.length, 3);
});

test('every curriculum role and level in the spec lists is accepted', () => {
  for (const role of ['parent', 'teacher', 'educator', 'student', 'other']) {
    assert.equal(buildRequestPayload({ ...CURRICULUM_BODY, role }).payload.role, role);
  }
  for (const level of ['6-8', '9-12', '13-17', 'college', 'adult']) {
    assert.equal(buildRequestPayload({ ...CURRICULUM_BODY, level }).payload.level, level);
  }
  for (const capability of ['chat', 'image', 'video', 'voice', 'other']) {
    assert.equal(buildRequestPayload({ ...PROVIDER_BODY, capability }).payload.capability, capability);
  }
});

// ─── Handler: POST / GET, tenant fencing ────────────────────────────

test('POST stores under the TOKEN tenant at status new; a body-claimed tenant_id is ignored', async () => {
  const db = new FakeDb();
  const res = fakeRes();
  await handleRequests(authedReq(TENANT_A, { body: { ...PROVIDER_BODY, tenant_id: TENANT_B } }), res, db);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.request.status, 'new');
  assert.equal(res.body.request.status_label, 'Received');
  assert.equal(db.rows.requests.length, 1);
  assert.equal(db.rows.requests[0].tenant_id, TENANT_A); // NOT the body's TENANT_B
  assert.deepEqual(db.rows.requests[0].payload, {
    provider_name: 'Higgsfield', capability: 'video', use_case: PROVIDER_BODY.use_case,
  });
});

test('POST cannot smuggle a status, a plan, a bucket, or a safety change — the row is only the whitelist', async () => {
  const db = new FakeDb();
  const res = fakeRes();
  await handleRequests(authedReq(TENANT_A, {
    body: {
      ...CURRICULUM_BODY,
      status: 'shipped', plan: 'helmian_connect', credits: 1000000,
      safety_mode: false, age_band: 'adult',
    },
  }), res, db);
  assert.equal(res.statusCode, 201);
  const row = db.rows.requests[0];
  assert.equal(row.status, 'new'); // not the body's 'shipped'
  assert.deepEqual(
    Object.keys(row.payload).sort(),
    ['goal', 'level', 'role', 'source_links', 'subject'],
  );
});

test('GET returns ONLY the caller\'s rows, newest first, with the spec\'s labels', async () => {
  const db = new FakeDb();
  await createRequest(db, TENANT_A, PROVIDER_BODY);
  await createRequest(db, TENANT_B, CURRICULUM_BODY);
  await createRequest(db, TENANT_A, CURRICULUM_BODY);

  const resA = fakeRes();
  await handleRequests(authedReq(TENANT_A, { method: 'GET' }), resA, db);
  assert.equal(resA.statusCode, 200);
  assert.equal(resA.body.requests.length, 2);
  assert.equal(resA.body.requests[0].kind, 'curriculum'); // newest first
  assert.equal(resA.body.requests[1].kind, 'provider');
  for (const r of resA.body.requests) assert.equal(r.status_label, STATUS_LABELS[r.status]);

  const resB = fakeRes();
  await handleRequests(authedReq(TENANT_B, { method: 'GET' }), resB, db);
  assert.equal(resB.body.requests.length, 1);
  assert.equal(resB.body.requests[0].kind, 'curriculum');

  assert.deepEqual(await listRequests(db, TENANT_B).then((rows) => rows.map((r) => r.tenant_id)), [TENANT_B]);
});

test('invalid POSTs answer 400 and store NOTHING', async () => {
  const db = new FakeDb();
  for (const body of [
    { kind: 'homework' },
    { ...PROVIDER_BODY, capability: 'teleport' },
    { ...CURRICULUM_BODY, role: 'principal' },
    { ...CURRICULUM_BODY, level: 'toddler' },
    { ...CURRICULUM_BODY, subject: 'x'.repeat(81) },
    { ...CURRICULUM_BODY, source_links: ['nope'] },
  ]) {
    const res = fakeRes();
    await handleRequests(authedReq(TENANT_A, { body }), res, db);
    assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 60));
    assert.match(res.body.error, /^invalid_/);
  }
  assert.equal(db.rows.requests.length, 0);
});

test('enforced mode: no session token → 401, nothing stored', async () => {
  const db = new FakeDb();
  const res = fakeRes();
  await handleRequests(
    { method: 'POST', url: 'http://local/api/requests', headers: {}, body: PROVIDER_BODY },
    res, db,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(db.rows.requests.length, 0);
});

test('compat mode (no SESSION_SECRET): accepts under the LEGACY identity, per spec §1.1', async () => {
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    const db = new FakeDb();
    const res = fakeRes();
    await handleRequests(
      { method: 'POST', url: 'http://local/api/requests', headers: {}, body: PROVIDER_BODY },
      res, db,
    );
    assert.equal(res.statusCode, 201);
    assert.equal(db.rows.requests[0].tenant_id, LEGACY_TENANT_ID);
    const getRes = fakeRes();
    await handleRequests(
      { method: 'GET', url: 'http://local/api/requests', headers: {}, body: {} },
      getRes, db,
    );
    assert.equal(getRes.body.requests.length, 1);
  } finally {
    process.env.SESSION_SECRET = saved;
  }
});

test('no other verb exists: PUT/PATCH/DELETE answer 405 (statuses cannot move through this surface)', async () => {
  const db = new FakeDb();
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const res = fakeRes();
    await handleRequests(authedReq(TENANT_A, { method, body: { status: 'shipped' } }), res, db);
    assert.equal(res.statusCode, 405);
  }
  assert.equal(db.rows.requests.length, 0);
});

test('publicRequest re-whitelists on the way out and carries the requester label', () => {
  const pub = publicRequest({
    id: 'x', kind: 'provider', status: 'listed', created_at: 't',
    payload: { provider_name: 'A', capability: 'chat', use_case: 'B', tenant_id: 'leak', plan: 'leak' },
  });
  assert.deepEqual(pub.payload, { provider_name: 'A', capability: 'chat', use_case: 'B' });
  assert.equal(pub.status_label, 'On the list');
  assert.equal(STATUS_LABELS.shipped, 'Added');
  assert.equal(STATUS_LABELS.not_planned, 'Not planned');
  assert.equal(STATUS_LABELS.verifying, 'In verification');
});

// ─── Status transitions — operator only ─────────────────────────────

test('canTransition: the pipeline, kind rules, and no backward moves', () => {
  // curriculum walks the full chain, verifying included
  assert.equal(canTransition('curriculum', 'new', 'listed'), true);
  assert.equal(canTransition('curriculum', 'listed', 'building'), true);
  assert.equal(canTransition('curriculum', 'building', 'verifying'), true);
  assert.equal(canTransition('curriculum', 'verifying', 'shipped'), true);
  // no curriculum ships unverified
  assert.equal(canTransition('curriculum', 'building', 'shipped'), false);
  assert.equal(canTransition('curriculum', 'new', 'verifying'), false);
  // provider skips verifying entirely
  assert.equal(canTransition('provider', 'building', 'shipped'), true);
  assert.equal(canTransition('provider', 'building', 'verifying'), false);
  assert.equal(canTransition('provider', 'new', 'verifying'), false);
  // never backward, never out of a terminal state
  assert.equal(canTransition('provider', 'listed', 'new'), false);
  assert.equal(canTransition('curriculum', 'shipped', 'building'), false);
  assert.equal(canTransition('curriculum', 'not_planned', 'listed'), false);
  // the honest no is reachable from any live state
  assert.equal(canTransition('provider', 'new', 'not_planned'), true);
  assert.equal(canTransition('curriculum', 'verifying', 'not_planned'), true);
  // nonsense is not a transition
  assert.equal(canTransition('provider', 'new', 'new'), false);
  assert.equal(canTransition('provider', 'new', 'bogus'), false);
});

test('setRequestStatus: the operator walks a curriculum request end to end', async () => {
  const db = new FakeDb();
  const row = await createRequest(db, TENANT_A, CURRICULUM_BODY);
  for (const next of ['listed', 'building', 'verifying', 'shipped']) {
    const moved = await setRequestStatus(db, row.id, next, { actor: 'operator' });
    assert.equal(moved.status, next);
  }
  assert.equal((await getRequest(db, row.id)).status, 'shipped');
});

test('setRequestStatus: a provider request ships from building and can never enter verifying', async () => {
  const db = new FakeDb();
  const row = await createRequest(db, TENANT_A, PROVIDER_BODY);
  await setRequestStatus(db, row.id, 'listed', { actor: 'operator' });
  await setRequestStatus(db, row.id, 'building', { actor: 'operator' });
  await assert.rejects(
    setRequestStatus(db, row.id, 'verifying', { actor: 'operator' }),
    (e) => e.code === 'invalid_transition',
  );
  const shipped = await setRequestStatus(db, row.id, 'shipped', { actor: 'operator' });
  assert.equal(shipped.status, 'shipped');
});

test('setRequestStatus: the REQUESTER can never move a request — terminal states are operator-only', async () => {
  const db = new FakeDb();
  const row = await createRequest(db, TENANT_A, PROVIDER_BODY);
  for (const actor of ['requester', TENANT_A, undefined]) {
    await assert.rejects(
      setRequestStatus(db, row.id, 'shipped', { actor }),
      (e) => e.code === 'forbidden',
    );
    await assert.rejects(
      setRequestStatus(db, row.id, 'not_planned', { actor }),
      (e) => e.code === 'forbidden',
    );
  }
  await assert.rejects(setRequestStatus(db, row.id, 'listed'), (e) => e.code === 'forbidden');
  assert.equal((await getRequest(db, row.id)).status, 'new'); // untouched
});

test('setRequestStatus: unknown id → not_found; backward move → invalid_transition', async () => {
  const db = new FakeDb();
  await assert.rejects(
    setRequestStatus(db, '00000000-0000-4000-8000-000000000099', 'listed', { actor: 'operator' }),
    (e) => e.code === 'not_found',
  );
  const row = await createRequest(db, TENANT_A, PROVIDER_BODY);
  await setRequestStatus(db, row.id, 'listed', { actor: 'operator' });
  await assert.rejects(
    setRequestStatus(db, row.id, 'new', { actor: 'operator' }),
    (e) => e.code === 'invalid_transition',
  );
});
