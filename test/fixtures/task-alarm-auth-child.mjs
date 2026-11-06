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
    put: async (path, body, opts = {}) => {
      calls.push({
        op: 'put',
        path,
        access: opts.access || null,
        allowOverwrite: opts.allowOverwrite === true,
      });
      store.set(path, typeof body === 'string' ? body : JSON.stringify(body));
      return { pathname: path, url: `https://blob.test/${path}` };
    },
    get: async (path, opts = {}) => {
      calls.push({ op: 'get', path, access: opts.access || null });
      const body = store.get(path);
      if (!body) return null;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      });
      return { statusCode: 200, stream };
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

globalThis.fetch = async () => {
  throw new Error('public blob URL fetch is not allowed');
};

const taskMod = await import('../../server/handlers/task.js');
const taskHandler = taskMod.default;
const { saveScopedTask } = taskMod;
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

out.alarmDeliver = await call(alarmHandler, {
  method: 'DELETE',
  headers: hook,
  query: { userId: TENANT_B, id: betaId },
});

const putsBeforeChat = calls.length;
out.chatSkip = await saveScopedTask({ owner: '', task: 'should-not-save' });
out.chatBad = await saveScopedTask({ owner: '../etc', task: 'should-not-save' });
out.chatSave = await saveScopedTask({ owner: TENANT_A, task: 'from-chat' });
out.chatPuts = calls.slice(putsBeforeChat).filter((c) => c.op === 'put');

out.paths = {
  taskPuts: calls.filter((c) => c.op === 'put' && String(c.path).startsWith('tasks/')).map((c) => c.path),
  alarmPuts: calls.filter((c) => c.op === 'put' && String(c.path).startsWith('alarms/')).map((c) => c.path),
  storeKeys: [...store.keys()],
  writes: calls.filter((c) => c.op === 'put' || c.op === 'get').map((c) => ({
    op: c.op,
    access: c.access,
    path: c.path,
  })),
};

console.log(JSON.stringify(out));
