import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;

const agentRes = await fetch("https://api.elevenlabs.io/v1/convai/agents/agent_9101m6kwm1sqe0ctz33pn1q7p07w", {
  headers: { "xi-api-key": key }
});
const agentData = await agentRes.json();
const tools = agentData.conversation_config?.agent?.prompt?.tools || [];
console.log(`Agent has ${tools.length} tools:`);
for (const t of tools) {
  console.log(`- [${t.type}] ${t.name}:`);
  if (t.api_schema) {
    console.log(`    URL: ${t.api_schema.url}`);
    console.log(`    Method: ${t.api_schema.method}`);
    console.log(`    Headers:`, Object.keys(t.api_schema.request_headers || {}));
    console.log(`    Path params:`, t.api_schema.path_params);
    console.log(`    Query params:`, t.api_schema.query_params);
  }
}
