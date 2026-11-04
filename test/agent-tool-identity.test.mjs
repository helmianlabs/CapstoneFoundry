// test/agent-tool-identity.test.mjs — safety wiring bite 4
// (safety-gap-map §7): the ElevenLabs provisioning contract.
//
// Pinned here, over the definitions exported by
// scripts/update-agent-config.mjs (importing the module must NOT run
// the live provisioning — it only fires when executed directly):
//   - every identity-bearing tool definition requires a `userId`
//     property bound to the {{user_id}} dynamic variable;
//   - no definition requires any safety field from the model (safety
//     is decided server-side from the tenant profile);
//   - the binding helpers used by the live run actually establish
//     and recognize that contract on a tool config;
//   - (D2) the definition set is exactly the set of tools
//     docs/elevenlabs-template/tools.md marks **Required**, parsed
//     from the template itself so the two cannot drift apart.
//
// NOT covered: the deployed agent's actual tool schemas. That
// readback happens only when the provisioning script is run against
// the live agent under a separate authorization — still UNVERIFIED.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  IDENTITY_TOOL_DEFINITIONS,
  IDENTITY_TOOL_NAMES,
  ensureUserIdBinding,
  hasUserIdBinding,
  userIdParamPatch,
} = await import('../scripts/update-agent-config.mjs');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every identity-bearing tool definition requires userId bound to {{user_id}}', () => {
  assert.ok(IDENTITY_TOOL_DEFINITIONS.length >= 5, 'the identity-bearing tool set is named');
  for (const def of IDENTITY_TOOL_DEFINITIONS) {
    const schema = def.identityRequestBodySchema;
    assert.ok(schema, `${def.name}: carries an identity request-body schema`);
    assert.ok(schema.required.includes('userId'), `${def.name}: userId is required`);
    assert.equal(
      schema.properties.userId.dynamic_variable, 'user_id',
      `${def.name}: userId is bound to the {{user_id}} dynamic variable`,
    );
    assert.deepEqual(
      schema.properties.userId, userIdParamPatch,
      `${def.name}: the binding is the canonical patch`,
    );
  }
  // The media tools are identity-bearing: their handlers resolve the
  // tenant from userId and (after bite 4) store under it.
  for (const mediaTool of ['generate_image', 'generate_image_flux', 'generate_video_runway']) {
    assert.ok(IDENTITY_TOOL_NAMES.includes(mediaTool), `${mediaTool} is in the identity set`);
  }
});

test('the definition set is exactly the tools the template marks Required (D2)', () => {
  // Parse docs/elevenlabs-template/tools.md — the provisioning
  // template — and collect every tool it marks **Required**, with the
  // endpoint its row names. Table rows carry the binding in the last
  // cell; recall_memory is the one Required tool documented in prose
  // below the table instead of in a row.
  const src = readFileSync(join(ROOT, 'docs', 'elevenlabs-template', 'tools.md'), 'utf8');
  const required = new Map();
  for (const line of src.split('\n')) {
    if (!line.startsWith('|') || !line.includes('**Required**')) continue;
    const name = line.match(/`([^`]+)`/)?.[1];
    const endpoint = line.match(/(\/api\/[a-z0-9-]+)/)?.[1];
    assert.ok(name && endpoint, `unparseable Required row in tools.md: ${line}`);
    required.set(name, endpoint);
  }
  const recallProse = src.match(/Plus `recall_memory`[\s\S]{0,300}?\*\*Required\*\*/);
  assert.ok(recallProse, 'tools.md prose marks recall_memory Required');
  required.set('recall_memory', '/api/recall-memory');
  assert.ok(required.size >= 12, `expected the full Required set, parsed ${required.size}`);

  const defined = new Map(IDENTITY_TOOL_DEFINITIONS.map((d) => [d.name, d.endpoint]));
  assert.deepEqual(
    [...defined.entries()].sort(),
    [...required.entries()].sort(),
    'script definitions and template Required rows name the same tools at the same endpoints',
  );
});

test('no tool definition requires a safety field from the model', () => {
  for (const def of IDENTITY_TOOL_DEFINITIONS) {
    const schema = def.identityRequestBodySchema;
    for (const field of [...schema.required, ...Object.keys(schema.properties)]) {
      assert.ok(!/safety|age/i.test(field), `${def.name}: model is never asked for ${field}`);
    }
  }
});

test('ensureUserIdBinding establishes the contract and hasUserIdBinding recognizes it', () => {
  const bare = {
    api_schema: {
      request_body_schema: {
        type: 'object',
        required: ['prompt'],
        properties: { prompt: { type: 'string' } },
      },
    },
  };
  assert.equal(hasUserIdBinding(bare), false);
  assert.equal(ensureUserIdBinding(bare), true, 'a missing binding is added');
  assert.equal(hasUserIdBinding(bare), true);
  assert.ok(bare.api_schema.request_body_schema.required.includes('prompt'), 'existing required fields survive');
  assert.equal(ensureUserIdBinding(bare), false, 'an established binding is left alone');

  const unbound = {
    api_schema: {
      request_body_schema: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string', dynamic_variable: '' } },
      },
    },
  };
  assert.equal(hasUserIdBinding(unbound), false, 'a present-but-unbound userId does not count');
  assert.equal(ensureUserIdBinding(unbound), true, 'an unbound userId is repaired');
  assert.equal(hasUserIdBinding(unbound), true);

  const noSchema = { api_schema: {} };
  assert.equal(ensureUserIdBinding(noSchema), false, 'no request body schema: nothing to bind into');
  assert.equal(hasUserIdBinding(noSchema), false);
});
