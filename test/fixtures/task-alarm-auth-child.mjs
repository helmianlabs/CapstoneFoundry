// Handler proof for task and alarm auth. Not a test file.
// Mocks @vercel/blob so no network or store is touched.
import { mock } from 'node:test';
import { signSession } from '../../lib/tenant.js';

process.env.SESSION_SECRET = 'task-alarm-test-secret';
process.env.WEBHOOK_SECRET = 'task-alarm-test-webhook';
delete process.env.ENFORCE_TOOL_AUTH;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const calls = [];
const store = new Map();

mock.module('@vercel/blob', {
  namedExports: {
    put: async (path, body) => {
      calls.push({ op: 'put', path });
      store.set(path, typeof body === 'string' ? body : JSON.stringify(body));
      return { pathname: path, url: `https://blob.test/${path}` };
    },
    list: async ({ prefix }) => {
      calls.push({ op: 'list', prefix });
      const blobs = [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((pathname) => ({ pathname, url: `https://blob.test/${pathname}` }));
      return { blobs };
    },
    del: async (url) => {
      calls.push({ op: 'del', url });
      store.delete(String(url).replace('https://blob.test/', ''));
    },
  },
});

globalThis.fetch = async (url) => {
  const path = String(url).replace('https://blob.test/', '');
  const body = store.get(path);
  return { ok: Boolean(body), json: async () => (body ? JSON.parse(body) : null) };
};

const taskHandler = (await import('../../server/handlers/task.js')).default;
const alarmHandler = (await import('../../server/handlers/alarm.js')).default;

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

async function call(handler, req) {
  const before = calls.length;
  const res = fakeRes();
  await handler(req, res);
  return {
    code: res.statusCode,
    body: res.body,
    touched: calls.slice(before).map((c) => c.op),
    paths: calls.slice(before).map((c) => c.path || c.prefix || ''),
  };
}

function session(tenant) {
  return { authorization: `Bearer ${signSession(tenant, process.env.SESSION_SECRET, 600)}` };
}
const hook = { 'x-webhook-secret': process.env.WEBHOOK_SECRET };

const out = {};

out.taskGetUnauth = await call(taskHandler, {
  method: 'GET', headers: {}, query: { userId: TENANT_A },
});
out.taskPostUnauth = await call(taskHandler, {
  method: 'POST', headers: {}, query: {},
  body: { userId: TENANT_A, task: 'leak me' },
});
out.alarmGetUnauth = await call(alarmHandler, {
  method: 'GET', headers: {}, query: { userId: TENANT_A },
});
out.alarmPostUnauth = await call(alarmHandler, {
  method: 'POST', headers: {},
  body: { userId: TENANT_A, title: 'leak', schedule: '+30m' },
});

out.taskOwn = await call(taskHandler, {
  method: 'POST', headers: session(TENANT_A), query: {},
  body: { userId: TENANT_A, task: 'alpha-task', project: 'general' },
});
out.taskListOwn = await call(taskHandler, {
  method: 'GET', headers: session(TENANT_A), query: { userId: TENANT_A },
});
out.taskCross = await call(taskHandler, {
  method: 'GET', headers: session(TENANT_A), query: { userId: TENANT_B },
});

out.alarmOwn = await call(alarmHandler, {
  method: 'POST', headers: hook,
  body: { userId: TENANT_B, title: 'beta-alarm', schedule: '+30m' },
});
out.alarmListTool = await call(alarmHandler, {
  method: 'GET', headers: hook, query: { userId: TENANT_B },
});
out.alarmCross = await call(alarmHandler, {
  method: 'GET', headers: { ...session(TENANT_A), ...hook }, query: { userId: TENANT_B },
});
out.alarmListOwn = await call(alarmHandler, {
  method: 'GET', headers: session(TENANT_A), query: { userId: TENANT_A },
});

const betaPath = [...store.keys()].find((k) => k.startsWith(`alarms/${TENANT_B}/`));
const betaId = betaPath ? betaPath.split('/').pop().replace(/\.json$/, '') : '';
out.alarmDeleteCross = await call(alarmHandler, {
  method: 'DELETE', headers: session(TENANT_A),
  query: { userId: TENANT_A, id: betaId },
});

out.paths = {
  taskPuts: calls.filter((c) => c.op === 'put' && String(c.path).startsWith('tasks/')).map((c) => c.path),
  alarmPuts: calls.filter((c) => c.op === 'put' && String(c.path).startsWith('alarms/')).map((c) => c.path),
  storeKeys: [...store.keys()],
};

console.log(JSON.stringify(out));
