// test/avatar.test.mjs — Digital Avatar Creation & Likeness Release Tests
import test from 'node:test';
import assert from 'node:assert/strict';
import handleAvatar from '../server/handlers/avatar.js';

test('Avatar Handler: requires legal statement and name on create', async () => {
  let statusCode = 0;
  let jsonBody = null;

  const req = {
    method: 'POST',
    url: '/api/avatar/create',
    headers: {},
    body: {
      name: 'Troy',
      photo_url: 'data:image/jpeg;base64,1234',
      // missing statement
    },
  };

  const res = {
    setHeader: () => {},
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonBody = data; },
      };
    },
  };

  await handleAvatar(req, res);
  assert.equal(statusCode, 400);
  assert.ok(jsonBody.error.includes('Likeness') || jsonBody.error.includes('mandatory') || jsonBody.error.includes('consent'));
});

test('Avatar Handler: OPTIONS preflight returns 200', async () => {
  let ended = false;
  let statusCode = 0;

  const req = { method: 'OPTIONS', url: '/api/avatar', headers: {} };
  const res = {
    setHeader: () => {},
    status: (code) => {
      statusCode = code;
      return { end: () => { ended = true; } };
    },
  };

  await handleAvatar(req, res);
  assert.equal(statusCode, 200);
  assert.equal(ended, true);
});
