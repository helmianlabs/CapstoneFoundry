import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;
const webhookSecret = env.WEBHOOK_SECRET;
const AGENT_ID = 'agent_9101m6kwm1sqe0ctz33pn1q7p07w';

async function api(pathname, init = {}) {
  const r = await fetch(`https://api.elevenlabs.io/v1${pathname}`, {
    ...init,
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${init.method || 'GET'} ${pathname} -> ${r.status}: ${text}`);
  }
  return r.json();
}

console.log('[1/4] Fetching all existing tools...');
const allTools = await api('/convai/tools');
const tools = allTools.tools || [];
const byName = (name) => tools.find(t => t.tool_config?.name === name);

const agent = await api(`/convai/agents/${AGENT_ID}`);
const cc = agent.conversation_config;
const toolIds = new Set(cc.agent.prompt.tool_ids || []);

// 1. generate_3d_character
let tool3d = byName('generate_3d_character');
const tool3dConfig = {
  type: 'webhook',
  name: 'generate_3d_character',
  description: 'Create a 3D character, creature, or model asset with Meshy. Pass a detailed prompt describing the character appearance.',
  api_schema: {
    url: 'https://thinkbuddy-sandy.vercel.app/api/generate-3d',
    method: 'POST',
    request_headers: {
      'X-Webhook-Secret': webhookSecret,
    },
    request_body_schema: {
      type: 'object',
      required: ['prompt', 'userId'],
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the 3D model or creature to generate',
        },
        userId: {
          type: 'string',
          dynamic_variable: 'user_id',
        },
      },
    },
  },
};

if (tool3d) {
  console.log('generate_3d_character tool exists, updating...');
  await api(`/convai/tools/${tool3d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ tool_config: tool3dConfig })
  });
  toolIds.add(tool3d.id);
} else {
  console.log('Creating generate_3d_character tool...');
  const created = await api('/convai/tools', {
    method: 'POST',
    body: JSON.stringify({ tool_config: tool3dConfig })
  });
  console.log('Created tool:', created.id);
  toolIds.add(created.id);
}

// 2. export_document
let toolDoc = byName('export_document');
const toolDocConfig = {
  type: 'webhook',
  name: 'export_document',
  description: 'Export a structured lesson, proposal, business summary, or plan into a permanent document and push to Google Docs/Drive.',
  api_schema: {
    url: 'https://thinkbuddy-sandy.vercel.app/api/export-document',
    method: 'POST',
    request_headers: {
      'X-Webhook-Secret': webhookSecret,
    },
    request_body_schema: {
      type: 'object',
      required: ['title', 'content', 'userId'],
      properties: {
        title: {
          type: 'string',
          description: 'Title of the document (e.g. "DairyForge TMS Business Proposal" or "Financial Literacy Lesson 1")',
        },
        content: {
          type: 'string',
          description: 'Full markdown or structured text content of the document',
        },
        userId: {
          type: 'string',
          dynamic_variable: 'user_id',
        },
      },
    },
  },
};

if (toolDoc) {
  console.log('export_document tool exists, updating...');
  await api(`/convai/tools/${toolDoc.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ tool_config: toolDocConfig })
  });
  toolIds.add(toolDoc.id);
} else {
  console.log('Creating export_document tool...');
  const created = await api('/convai/tools', {
    method: 'POST',
    body: JSON.stringify({ tool_config: toolDocConfig })
  });
  console.log('Created tool:', created.id);
  toolIds.add(created.id);
}

console.log('[3/4] Updating agent with new tool IDs...');
cc.agent.prompt.tool_ids = Array.from(toolIds);
delete cc.agent.prompt.tools;

await api(`/convai/agents/${AGENT_ID}`, {
  method: 'PATCH',
  body: JSON.stringify({ conversation_config: cc })
});

console.log('[4/4] Verifying updated agent...');
const verify = await api(`/convai/agents/${AGENT_ID}`);
console.log('Active tool count on Mark:', verify.conversation_config?.agent?.prompt?.tool_ids?.length);
console.log('Success! Mark has generate_3d_character and export_document registered.');
