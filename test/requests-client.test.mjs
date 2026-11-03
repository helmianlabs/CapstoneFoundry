// test/requests-client.test.mjs — the Settings request door
// (requests bite B2; design: curriculum-requests-spec.md §1.3/§2/§6).
//
// Two layers, matching the house style (cf. billing-client.test.mjs,
// onboarding-ui.test.mjs, alarms.test.mjs):
//   1. Functional tests over public/requests.js: the validation
//      mirror of lib/requests.js's caps, the exact POST body (the
//      kind's whitelist and nothing else — a smuggled tenant_id /
//      status / plan never leaves the client), the call riding the
//      injected session fetch (the Authorization header is attached
//      by that fetch, exactly as onboarding.js's tbFetch attaches
//      it), server refusals surfacing as plain words, and the
//      own-requests list rendering the server's status labels
//      verbatim.
//   2. Source assertions over index.html + public/onboarding.js: the
//      door block sits in the Account & Safety pane with both field
//      sets and the specced controls, every door id appears exactly
//      once, onboarding wires the module through tbFetch — and the
//      door's markup contains NO status-changing control of any kind
//      (statuses are operator-side only, spec §1.2; the door displays
//      status, it never offers to change it).
//
// Pure: fetch is stubbed per test; no network, no DOM run, no db.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  PROVIDER_CAPABILITIES,
  CURRICULUM_ROLES,
  CURRICULUM_LEVELS,
  CAPS,
  MAX_SOURCE_LINKS,
  REQUEST_NOTED_TEXT,
  parseSourceLinks,
  validateProviderFields,
  validateCurriculumFields,
  buildRequestBody,
  refusalText,
  submitRequest,
  fetchOwnRequests,
  requestSummary,
  requestListHtml,
} from '../public/requests.js';

import {
  PROVIDER_CAPABILITIES as SERVER_CAPABILITIES,
  CURRICULUM_ROLES as SERVER_ROLES,
  CURRICULUM_LEVELS as SERVER_LEVELS,
  STATUS_LABELS,
} from '../lib/requests.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const onboardingJs = readFileSync(new URL('../public/onboarding.js', import.meta.url), 'utf8');
const requestsJs = readFileSync(new URL('../public/requests.js', import.meta.url), 'utf8');

const DOOR_IDS = [
  'requestKindProvider', 'requestKindCurriculum',
  'requestProviderFields', 'requestProviderName', 'requestCapability', 'requestUseCase',
  'requestCurriculumFields', 'requestRole', 'requestSubject', 'requestLevel',
  'requestGoal', 'requestSourceLinks',
  'requestSubmit', 'requestLine', 'requestList',
];

// The door block: from its heading to the Log out button that follows it.
function doorBlock() {
  const a = indexHtml.indexOf('<label>Ask for something we don\'t have</label>');
  const b = indexHtml.indexOf('id="accountLogout"');
  assert.ok(a > -1 && b > a, 'door block located in index.html');
  return indexHtml.slice(a, b);
}

const goodProvider = { provider_name: '  Leonardo AI ', capability: 'image', use_case: 'Story art for my kids.' };
const goodCurriculum = {
  role: 'parent', subject: ' SAT Math ', level: '13-17',
  goal: 'Confident on word problems by spring.',
};

describe('vocabularies mirror the server (lib/requests.js)', () => {
  test('capability / role / level values are the server values, in order', () => {
    assert.deepEqual(PROVIDER_CAPABILITIES.map(o => o.value), SERVER_CAPABILITIES);
    assert.deepEqual(CURRICULUM_ROLES.map(o => o.value), SERVER_ROLES);
    assert.deepEqual(CURRICULUM_LEVELS.map(o => o.value), SERVER_LEVELS);
  });

  test('caps are the server numbers', () => {
    assert.equal(CAPS.subject, 80);
    assert.equal(CAPS.goal, 300);
    assert.equal(CAPS.provider_name, 120);
    assert.equal(CAPS.use_case, 300);
    assert.equal(MAX_SOURCE_LINKS, 3);
  });

  test('the noted text is the spec §1.3 confirmation, character for character', () => {
    assert.equal(REQUEST_NOTED_TEXT, 'Request noted — we read every one.');
  });
});

describe('provider validation (caps + whitelist)', () => {
  test('good input → trimmed payload of exactly the three fields', () => {
    const res = validateProviderFields(goodProvider);
    assert.equal(res.ok, true);
    assert.deepEqual(res.payload, {
      provider_name: 'Leonardo AI', capability: 'image', use_case: 'Story art for my kids.',
    });
  });

  test('extra keys are stripped, never carried (tenant/status/plan smuggling)', () => {
    const res = validateProviderFields({
      ...goodProvider, tenant_id: 'someone-else', status: 'shipped', plan: 'helmian_connect', safety_mode: false,
    });
    assert.equal(res.ok, true);
    assert.deepEqual(Object.keys(res.payload), ['provider_name', 'capability', 'use_case']);
  });

  test('missing/blank name and use_case → plain errors', () => {
    assert.match(validateProviderFields({ ...goodProvider, provider_name: '  ' }).error, /name/i);
    assert.match(validateProviderFields({ ...goodProvider, use_case: '' }).error, /use it for/i);
  });

  test('caps enforced: name 121 and use_case 301 fail, at-cap values pass', () => {
    assert.equal(validateProviderFields({ ...goodProvider, provider_name: 'x'.repeat(121) }).ok, false);
    assert.equal(validateProviderFields({ ...goodProvider, provider_name: 'x'.repeat(120) }).ok, true);
    assert.equal(validateProviderFields({ ...goodProvider, use_case: 'x'.repeat(301) }).ok, false);
    assert.equal(validateProviderFields({ ...goodProvider, use_case: 'x'.repeat(300) }).ok, true);
  });

  test('unknown capability → plain error', () => {
    const res = validateProviderFields({ ...goodProvider, capability: 'teleport' });
    assert.equal(res.ok, false);
    assert.match(res.error, /Pick what it should do/);
  });
});

describe('curriculum validation (the spec §2 five fields)', () => {
  test('good input → trimmed payload; no source_links key when none given', () => {
    const res = validateCurriculumFields(goodCurriculum);
    assert.equal(res.ok, true);
    assert.deepEqual(res.payload, {
      role: 'parent', subject: 'SAT Math', level: '13-17', goal: 'Confident on word problems by spring.',
    });
    assert.ok(!('source_links' in res.payload));
  });

  test('links: up to 3 http(s) URLs ride along, normalized like the server', () => {
    const res = validateCurriculumFields({
      ...goodCurriculum,
      source_links_text: 'https://example.com/book\n\n  https://school.edu/syllabus  \n',
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.payload.source_links, ['https://example.com/book', 'https://school.edu/syllabus']);
  });

  test('links: a 4th link, a non-URL, and a non-http(s) URL each fail plainly', () => {
    const four = ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'];
    assert.equal(validateCurriculumFields({ ...goodCurriculum, source_links: four }).ok, false);
    assert.match(validateCurriculumFields({ ...goodCurriculum, source_links: ['notaurl'] }).error, /web address/);
    assert.match(validateCurriculumFields({ ...goodCurriculum, source_links: ['ftp://a.com/x'] }).error, /web address/);
    assert.equal(validateCurriculumFields({ ...goodCurriculum, source_links: ['https://a.com/' + 'x'.repeat(500)] }).ok, false);
  });

  test('unknown role / level, caps on subject (80) and goal (300)', () => {
    assert.equal(validateCurriculumFields({ ...goodCurriculum, role: 'principal' }).ok, false);
    assert.equal(validateCurriculumFields({ ...goodCurriculum, level: '3-5' }).ok, false);
    assert.equal(validateCurriculumFields({ ...goodCurriculum, subject: 'x'.repeat(81) }).ok, false);
    assert.equal(validateCurriculumFields({ ...goodCurriculum, subject: 'x'.repeat(80) }).ok, true);
    assert.equal(validateCurriculumFields({ ...goodCurriculum, goal: 'x'.repeat(301) }).ok, false);
    assert.equal(validateCurriculumFields({ ...goodCurriculum, goal: '' }).ok, false);
  });

  test('parseSourceLinks splits lines, trims, drops blanks', () => {
    assert.deepEqual(parseSourceLinks(' a \n\n b\n'), ['a', 'b']);
    assert.deepEqual(parseSourceLinks(''), []);
    assert.deepEqual(parseSourceLinks(undefined), []);
  });
});

describe('submitRequest — the wire call', () => {
  // A fetch stub with onboarding.js tbFetch's exact contract: the
  // session token becomes the Authorization header, a plain-object
  // body is JSON-encoded. This is the seam the door rides in the app.
  function sessionFetch(token, responder) {
    const calls = [];
    const fetchFn = async (path, opts = {}) => {
      const headers = { ...(opts.headers || {}) };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      let body = opts.body;
      if (body && typeof body === 'object') {
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
      calls.push({ path, method: opts.method || 'GET', headers, body });
      return responder();
    };
    return { calls, fetchFn };
  }

  const createdRow = {
    id: 'r1', kind: 'provider',
    payload: { provider_name: 'Leonardo AI', capability: 'image', use_case: 'Story art for my kids.' },
    status: 'new', status_label: 'Received', created_at: '2026-11-01T00:00:00.000Z',
  };

  test('POST carries the session header and the whitelisted payload only', async () => {
    const { calls, fetchFn } = sessionFetch('tok-123', () => ({
      status: 201, json: async () => ({ ok: true, request: createdRow }),
    }));
    const res = await submitRequest('provider', { ...goodProvider, tenant_id: 'evil', status: 'shipped' }, { fetchFn });
    assert.equal(res.ok, true);
    assert.deepEqual(res.request, createdRow);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/requests');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers.Authorization, 'Bearer tok-123');
    assert.deepEqual(JSON.parse(calls[0].body), {
      kind: 'provider', provider_name: 'Leonardo AI', capability: 'image', use_case: 'Story art for my kids.',
    });
  });

  test('curriculum POST body is exactly kind + the five-field payload', async () => {
    const { calls, fetchFn } = sessionFetch('tok-123', () => ({
      status: 201, json: async () => ({ ok: true, request: { ...createdRow, kind: 'curriculum' } }),
    }));
    const res = await submitRequest('curriculum', {
      ...goodCurriculum, source_links_text: 'https://example.com/book', tenant_id: 'evil',
    }, { fetchFn });
    assert.equal(res.ok, true);
    assert.deepEqual(JSON.parse(calls[0].body), {
      kind: 'curriculum', role: 'parent', subject: 'SAT Math', level: '13-17',
      goal: 'Confident on word problems by spring.', source_links: ['https://example.com/book'],
    });
  });

  test('client-side validation failure → plain error, network never touched', async () => {
    const { calls, fetchFn } = sessionFetch('tok-123', () => { throw new Error('must not be called'); });
    const res = await submitRequest('curriculum', { ...goodCurriculum, subject: '' }, { fetchFn });
    assert.equal(res.ok, false);
    assert.equal(res.stage, 'validation');
    assert.match(res.error, /subject/i);
    assert.equal(calls.length, 0);
  });

  test('a 400 refusal surfaces as plain words, never the raw code', async () => {
    for (const code of ['invalid_kind', 'invalid_capability', 'invalid_role', 'invalid_level', 'invalid_source_links', 'invalid_field']) {
      const { fetchFn } = sessionFetch('tok-123', () => ({
        status: 400, json: async () => ({ error: code }),
      }));
      const res = await submitRequest('provider', goodProvider, { fetchFn });
      assert.equal(res.ok, false, code);
      assert.equal(res.status, 400, code);
      assert.ok(res.error.length > 0, code);
      assert.notEqual(res.error, code, code);
      assert.ok(!res.error.includes('invalid_'), code);
    }
    assert.match(refusalText('invalid_field'), /missing or too long/i);
  });

  test('401 and network failure come back as plain result objects (never throws)', async () => {
    const { fetchFn: f401 } = sessionFetch(null, () => ({ status: 401, json: async () => ({ error: 'unauthorized' }) }));
    const r401 = await submitRequest('provider', goodProvider, { fetchFn: f401 });
    assert.equal(r401.ok, false);
    assert.match(r401.error, /log in again/i);
    const down = async () => { throw new Error('offline'); };
    const rNet = await submitRequest('provider', goodProvider, { fetchFn: down });
    assert.equal(rNet.ok, false);
    assert.match(rNet.error, /Could not reach the server/);
  });
});

describe('fetchOwnRequests + list rendering', () => {
  const rows = [
    {
      id: 'r2', kind: 'curriculum',
      payload: { role: 'teacher', subject: 'Idaho history', level: '9-12', goal: 'State test prep.', source_links: ['https://a.com'] },
      status: 'verifying', status_label: STATUS_LABELS.verifying, created_at: '2026-11-01T01:00:00.000Z',
    },
    {
      id: 'r1', kind: 'provider',
      payload: { provider_name: 'Leonardo AI', capability: 'image', use_case: 'Story art.' },
      status: 'listed', status_label: STATUS_LABELS.listed, created_at: '2026-10-31T01:00:00.000Z',
    },
  ];

  test('GET returns the server rows untouched (labels as served)', async () => {
    const fetchFn = async (path, opts = {}) => {
      assert.equal(path, '/api/requests');
      assert.equal(opts.method || 'GET', 'GET');
      return { status: 200, json: async () => ({ requests: rows }) };
    };
    const res = await fetchOwnRequests({ fetchFn });
    assert.equal(res.ok, true);
    assert.deepEqual(res.requests, rows);
  });

  test('the list renders every status label verbatim', () => {
    for (const [status, label] of Object.entries(STATUS_LABELS)) {
      const html = requestListHtml([{
        id: 'x', kind: 'provider', status, status_label: label,
        payload: { provider_name: 'P', capability: 'chat', use_case: 'U' },
      }]);
      assert.ok(html.includes(`Status: ${label}`), `${status} → "${label}" rendered`);
    }
  });

  test('the list shows what was asked (subject + level, name + capability)', () => {
    const html = requestListHtml(rows);
    assert.ok(html.includes('Idaho history'));
    assert.ok(html.includes('Ages 9–12'));
    assert.ok(html.includes('Teacher'));
    assert.ok(html.includes('Status: In verification'));
    assert.ok(html.includes('Leonardo AI'));
    assert.ok(html.includes('Make images'));
    assert.ok(html.includes('Status: On the list'));
  });

  test('payload text is escaped — a subject cannot inject markup', () => {
    const html = requestListHtml([{
      id: 'x', kind: 'curriculum', status: 'new', status_label: 'Received',
      payload: { role: 'parent', subject: '<img src=x onerror=alert(1)>', level: '6-8', goal: '<b>bold</b>' },
    }]);
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<b>bold</b>'));
    assert.ok(html.includes('&lt;img'));
  });

  test('an empty list says so plainly; summaries handle missing fields', () => {
    assert.match(requestListHtml([]), /haven't asked for anything yet/);
    assert.equal(requestSummary({ kind: 'provider', payload: {} }).heading, 'A tool or service');
    assert.equal(requestSummary({ kind: 'curriculum', payload: {} }).heading, 'A subject');
  });
});

describe('the door in index.html + onboarding.js (source assertions)', () => {
  test('public/requests.js parses as a valid ES module (node --check)', () => {
    execFileSync(process.execPath, ['--check', `${root}public/requests.js`], { stdio: 'pipe' });
  });

  test('the door sits inside the Account & Safety pane, before Log out', () => {
    const pane = indexHtml.indexOf('id="accountPane"');
    const door = indexHtml.indexOf('<label>Ask for something we don\'t have</label>');
    const logout = indexHtml.indexOf('id="accountLogout"');
    assert.ok(pane > -1 && door > pane && logout > door);
    assert.ok(indexHtml.includes('A tool or AI service'));
    assert.ok(indexHtml.includes('A subject to learn'));
    assert.ok(indexHtml.includes('Your requests'));
  });

  test('every door id appears exactly once in index.html', () => {
    for (const id of DOOR_IDS) {
      const count = indexHtml.split(`id="${id}"`).length - 1;
      assert.equal(count, 1, `id "${id}" should appear exactly once, found ${count}`);
    }
  });

  test('both field sets render with the specced fields and caps', () => {
    const block = doorBlock();
    // provider set (§5 fields): name (≤120), capability picker, use case (≤300)
    assert.ok(block.includes('id="requestProviderName"'));
    assert.ok(block.includes('maxlength="120"'));
    for (const v of SERVER_CAPABILITIES) assert.ok(block.includes(`<option value="${v}">`), `capability ${v}`);
    assert.ok(block.includes('id="requestUseCase"'));
    assert.ok(block.includes('maxlength="300"'));
    // curriculum set (§2 fields): role, subject (≤80), level, goal (≤300), links
    for (const v of SERVER_ROLES) assert.ok(block.includes(`<option value="${v}">`), `role ${v}`);
    assert.ok(block.includes('id="requestSubject"'));
    assert.ok(block.includes('maxlength="80"'));
    for (const v of SERVER_LEVELS) assert.ok(block.includes(`<option value="${v}">`), `level ${v}`);
    assert.ok(block.includes('id="requestGoal"'));
    assert.ok(block.includes('id="requestSourceLinks"'));
  });

  test('NO status-changing control exists in the door markup or module', () => {
    const block = doorBlock();
    assert.ok(!/id="[^"]*status/i.test(block), 'no status element id in the door');
    assert.ok(!/name="[^"]*status/i.test(block), 'no status field name in the door');
    assert.ok(!block.includes('setRequestStatus'), 'no transition call in the markup');
    assert.ok(!/data-status/.test(block), 'no data-status hook in the markup');
    // The module's whole verb set is POST (create) + GET (list).
    assert.ok(!requestsJs.includes('setRequestStatus'), 'the module never touches transitions');
    for (const verb of ["'PUT'", "'PATCH'", "'DELETE'", '"PUT"', '"PATCH"', '"DELETE"']) {
      assert.ok(!requestsJs.includes(`method: ${verb}`), `no ${verb} call in the module`);
    }
    assert.ok(requestsJs.includes("'/api/requests'"), 'the module talks to the B1 endpoint');
  });

  test('onboarding.js wires the door through tbFetch and prepends the new request', () => {
    assert.ok(onboardingJs.includes("import('./requests.js')"), 'guarded dynamic import, billing/alarms pattern');
    assert.ok(onboardingJs.includes('fetchFn: tbFetch'), 'calls ride the pane session fetch');
    assert.ok(onboardingJs.includes('rows = [res.request, ...rows]'), 'success joins the list without a reload');
    assert.ok(onboardingJs.includes('mod.REQUEST_NOTED_TEXT'), 'the noted confirmation is painted');
    assert.ok(onboardingJs.includes('wireRequestsDoor'), 'the door hook exists');
    assert.ok(onboardingJs.includes('requestsListLoader'), 'the list refreshes with the pane');
  });
});
