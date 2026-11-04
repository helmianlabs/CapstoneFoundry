// scripts/update-agent-config.mjs
// ---------------------------------------------------------------------------
// Updates the live ElevenLabs agent + its tools. This agent has migrated to
// the newer tool-registry model: tools are standalone objects (their own
// tool_xxx id, managed via /v1/convai/tools) that the agent REFERENCES via
// conversation_config.agent.prompt.tool_ids -- NOT inline tool definitions
// on the agent itself (the GET response still echoes a `tools` array for
// convenience, but PATCHing the agent with BOTH `tools` and `tool_ids`
// present is rejected: "Cannot specify both tools and tool IDs"). Discovered
// live via a failed first attempt at this script -- fixed here.
//
// Changes made:
//   1. Agent: conversation_config.conversation.max_duration_seconds 3600 -> 7200
//      (Troy asked for ~2hr headroom. NOTE: this was already 3600s [1hr], not
//      the 600s default, so it did NOT cause the 15-minute call Troy lost --
//      that's what conversation-turn.js / conversation-webhook.js fix.)
//   2. EVERY identity-bearing tool the agent references (see
//      IDENTITY_TOOL_DEFINITIONS below): its request body gains a REQUIRED
//      `userId` property bound to the {{user_id}} dynamic variable index.html
//      already sets every session. This generalizes the original
//      save_memory-only fix (that tool had been called 34 times with NO
//      userId param while api/memory.js requires one -- every in-call save
//      failed). Media tools are in the set: the generation handlers resolve
//      the tenant from this userId and store under the tenant identity.
//   3. Creates a NEW tool `recall_memory` (api/recall-memory.js) if none is
//      referenced, with the same {{user_id}} binding, and appends its id to
//      the agent's tool_ids.
//   4. Verification re-fetches the agent and every target tool and FAILS
//      (exit code 1) if any target tool is missing, unbound, not required,
//      or not referenced by the agent.
//
// This module is import-safe: the definitions and binding helpers are
// exported for tests, and the live run only happens when the file is
// executed directly (`node scripts/update-agent-config.mjs [app-base]`).
// Running it against the live agent is a separate, authorized step — the
// repo tests never execute it.
// ---------------------------------------------------------------------------
import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'node:url';

export const AGENT_ID = 'agent_9101m6kwm1sqe0ctz33pn1q7p07w';

// The API rejects setting more than one of {description, dynamic_variable,
// is_system_provided, constant_value, is_omitted} on a param at once --
// discovered live via a 422 on the first attempt (which had both
// description text AND dynamic_variable set). dynamic_variable alone is
// the correct binding to {{user_id}}.
export const userIdParamPatch = {
  type: 'string',
  description: '',
  enum: null,
  is_system_provided: false,
  dynamic_variable: 'user_id',
  allowed_values_dynamic_variable: '',
  constant_value: '',
  is_omitted: false,
};

// Every identity-bearing tool on the agent: the tools whose endpoints
// resolve a tenant/user from the request `userId`. Each definition
// carries ONLY the identity slice of its request-body schema — the
// required `userId` property bound to {{user_id}}. No safety field is
// ever required from the model: safety is decided server-side from the
// tenant profile, never from tool-call arguments.
//
// As of D2 this set covers EVERY tool docs/elevenlabs-template/tools.md
// marks **Required** — a test in test/agent-tool-identity.test.mjs
// parses the template and fails if the two ever drift apart again.
//
// search_web / browse_url joined this set in safety wiring bite 7:
// their handlers now resolve the tenant from userId and take the
// profile safety decision through the shared resolver, so they carry
// identity exactly like the media tools.
//
// Deliberately NOT in this set:
//   - save_task_for_clyde: its handler stores to a shared, unscoped
//     task list and consumes no userId.
//   - generate_image_imagen / generate_video_sora: retired providers;
//     their handlers are deleted and the routes 404. Do not provision.
export const IDENTITY_TOOL_DEFINITIONS = [
  { name: 'save_memory', endpoint: '/api/memory' },
  { name: 'recall_memory', endpoint: '/api/recall-memory' },
  { name: 'search_web', endpoint: '/api/search' },
  { name: 'browse_url', endpoint: '/api/browse' },
  { name: 'generate_image', endpoint: '/api/image' },
  { name: 'generate_image_flux', endpoint: '/api/image-flux' },
  { name: 'generate_image_gemini', endpoint: '/api/image-gemini' },
  { name: 'generate_video_runway', endpoint: '/api/video-runway' },
  { name: 'generate_video', endpoint: '/api/video' },
  { name: 'generate_video_veo', endpoint: '/api/video-runway-veo' },
  { name: 'generate_video_omni', endpoint: '/api/video-omni' },
  { name: 'generate_video_higgsfield', endpoint: '/api/video-higgsfield' },
  { name: 'generate_video_heygen', endpoint: '/api/video-heygen' },
  { name: 'set_alarm', endpoint: '/api/alarm' },
].map((def) => ({
  ...def,
  identityRequestBodySchema: {
    type: 'object',
    required: ['userId'],
    properties: { userId: userIdParamPatch },
  },
}));

export const IDENTITY_TOOL_NAMES = IDENTITY_TOOL_DEFINITIONS.map((d) => d.name);

function requestBodySchema(toolConfig) {
  return toolConfig?.api_schema?.request_body_schema || null;
}

/** True when the tool config's request body carries the required,
 *  {{user_id}}-bound `userId` property. */
export function hasUserIdBinding(toolConfig) {
  const schema = requestBodySchema(toolConfig);
  const prop = schema?.properties?.userId;
  return Boolean(
    prop
    && prop.dynamic_variable === 'user_id'
    && Array.isArray(schema.required)
    && schema.required.includes('userId'),
  );
}

/**
 * Bring a tool config's request body up to the identity contract:
 * a required `userId` property bound to {{user_id}}. Mutates the given
 * config (callers pass the fetched object they are about to PATCH).
 * Returns true when anything changed. Returns false without touching
 * the config when it has no request body schema to bind into.
 */
export function ensureUserIdBinding(toolConfig) {
  const schema = requestBodySchema(toolConfig);
  if (!schema || typeof schema !== 'object') return false;
  if (hasUserIdBinding(toolConfig)) return false;
  schema.properties = (schema.properties && typeof schema.properties === 'object')
    ? schema.properties
    : {};
  schema.properties.userId = { ...userIdParamPatch };
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  required.add('userId');
  schema.required = Array.from(required);
  return true;
}

function loadLocalEnv() {
  const envUrl = new URL('../.env.local', import.meta.url);
  if (!existsSync(envUrl)) return;
  for (const line of readFileSync(envUrl, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function main() {
  loadLocalEnv();
  const APP_BASE = process.argv[2] || 'https://thinkbuddy-sandy.vercel.app';
  const KEY = process.env.ELEVENLABS_API_KEY;
  if (!KEY) { console.error('ELEVENLABS_API_KEY not set'); process.exit(1); }

  async function api(path, opts = {}) {
    const r = await fetch(`https://api.elevenlabs.io/v1${path}`, {
      ...opts,
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${r.status}: ${await r.text()}`);
    return r.json();
  }

  console.log('[1/6] Fetching agent + its referenced tools...');
  const agent = await api(`/convai/agents/${AGENT_ID}`);
  const cc = agent.conversation_config;
  const referencedIds = new Set(cc.agent.prompt.tool_ids || []);
  const allTools = await api('/convai/tools');
  const tools = allTools.tools || [];
  const referencedTools = tools.filter((t) => referencedIds.has(t.id));
  const byName = (name, pool) => pool.filter((t) => t.tool_config?.name === name);

  // Preflight: every non-recall target must already be referenced by
  // the agent. A missing target is a dashboard/provisioning gap, not
  // something to silently skip — fail before PATCHing anything.
  const missing = IDENTITY_TOOL_NAMES.filter(
    (name) => name !== 'recall_memory' && byName(name, referencedTools).length === 0,
  );
  if (missing.length) {
    throw new Error(`identity-bearing tools not referenced by the agent: ${missing.join(', ')}`);
  }

  const targetIds = new Set();
  async function patchTool(tool) {
    const config = tool.tool_config;
    if (ensureUserIdBinding(config)) {
      await api(`/convai/tools/${tool.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ tool_config: config }),
      });
      console.log(`      ${config.name} (${tool.id}): userId binding added.`);
    } else if (hasUserIdBinding(config)) {
      console.log(`      ${config.name} (${tool.id}): userId binding already present.`);
    } else {
      throw new Error(`${config.name} (${tool.id}): no request body schema to bind userId into`);
    }
    targetIds.add(tool.id);
  }

  console.log('[2/6] Binding userId on every referenced identity-bearing tool...');
  for (const def of IDENTITY_TOOL_DEFINITIONS) {
    if (def.name === 'recall_memory') continue; // step 3 owns recall
    for (const tool of byName(def.name, referencedTools)) {
      await patchTool(tool);
    }
  }

  console.log('[3/6] Ensuring recall_memory (create if missing, bind if present)...');
  const recallToolConfig = {
    type: 'webhook',
    name: 'recall_memory',
    description: 'Look up something specific you might already know about the user or a past conversation, mid-call. Use this whenever the user references something you might have saved before (a name, a project, a preference, a past decision) and you are not certain you already have it in context -- silently, without announcing it.',
    response_timeout_secs: 10,
    disable_interruptions: false,
    interruption_mode: 'allow',
    force_pre_tool_speech: false,
    pre_tool_speech: 'auto',
    assignments: [],
    tool_call_sound: null,
    tool_call_sound_behavior: 'auto',
    tool_error_handling_mode: 'auto',
    dynamic_variables: { dynamic_variable_placeholders: {} },
    execution_mode: 'immediate',
    api_schema: {
      request_headers: {},
      url: `${APP_BASE}/api/recall-memory`,
      method: 'POST',
      path_params_schema: {},
      query_params_schema: null,
      request_body_schema: {
        description: 'Recall a saved fact matching a query.',
        dynamic_variable: '',
        is_omitted: false,
        type: 'object',
        required: ['userId', 'query'],
        properties: {
          userId: userIdParamPatch,
          query: {
            type: 'string',
            description: 'What to look up, in your own words (e.g. "his daughter\'s name" or "the DairyForge launch date")',
            enum: null,
            is_system_provided: false,
            dynamic_variable: '',
            allowed_values_dynamic_variable: '',
            constant_value: '',
            is_omitted: false,
          },
        },
      },
      response_body_schema: null,
      response_filter: null,
      content_type: 'application/json',
      auth_resolved_params: [],
      auth_connection: null,
    },
  };

  const referencedRecall = byName('recall_memory', referencedTools);
  let recallToolId;
  if (referencedRecall.length) {
    for (const tool of referencedRecall) await patchTool(tool);
    recallToolId = referencedRecall[0].id;
  } else {
    const existingRecall = byName('recall_memory', tools)[0];
    if (existingRecall) {
      recallToolId = existingRecall.id;
      await patchTool(existingRecall);
      console.log('      recall_memory exists but was unreferenced; it is added to the agent below.');
    } else {
      const created = await api('/convai/tools', { method: 'POST', body: JSON.stringify({ tool_config: recallToolConfig }) });
      recallToolId = created.id;
      targetIds.add(recallToolId);
      console.log('      recall_memory tool created:', recallToolId);
    }
  }

  console.log('[4/6] Updating agent conversation config + tool_ids...');
  cc.conversation = cc.conversation || {};
  const beforeDuration = cc.conversation.max_duration_seconds;
  cc.conversation.max_duration_seconds = 7200;
  const toolIds = new Set(cc.agent.prompt.tool_ids || []);
  for (const id of targetIds) toolIds.add(id);
  cc.agent.prompt.tool_ids = Array.from(toolIds);
  delete cc.agent.prompt.tools; // must not send both tools and tool_ids
  await api(`/convai/agents/${AGENT_ID}`, { method: 'PATCH', body: JSON.stringify({ conversation_config: cc }) });
  console.log(`      max_duration_seconds: ${beforeDuration} -> 7200`);
  console.log(`      tool_ids now reference ${targetIds.size} identity-bearing tools`);

  console.log('[5/6] Verifying every identity-bearing tool...');
  const verifyAgent = await api(`/convai/agents/${AGENT_ID}`);
  const verifyIds = new Set(verifyAgent.conversation_config.agent.prompt.tool_ids || []);
  const checks = [
    ['max_duration_seconds = 7200', verifyAgent.conversation_config.conversation.max_duration_seconds === 7200],
  ];
  for (const def of IDENTITY_TOOL_DEFINITIONS) {
    const ids = def.name === 'recall_memory'
      ? [recallToolId]
      : byName(def.name, referencedTools).map((t) => t.id);
    if (!ids.length) {
      checks.push([`${def.name}: present`, false]);
      continue;
    }
    for (const id of ids) {
      const fetched = await api(`/convai/tools/${id}`);
      checks.push([`${def.name} (${id}): userId bound to {{user_id}}`, hasUserIdBinding(fetched.tool_config)]);
      checks.push([`${def.name} (${id}): referenced by the agent`, verifyIds.has(id)]);
    }
  }

  console.log('[6/6] Results');
  let failed = false;
  for (const [label, ok] of checks) {
    console.log(`      ${label}: ${ok ? 'OK' : 'FAILED'}`);
    if (!ok) failed = true;
  }
  if (failed) process.exitCode = 1;
  else console.log('\n✅ All agent-config changes verified live.');
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((e) => { console.error('\n✗ FAILED:', e.message); process.exitCode = 1; });
}
