import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;
const AGENT_ID = 'agent_9101m6kwm1sqe0ctz33pn1q7p07w';

const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, { headers: { 'xi-api-key': key } });
const data = await res.json();
console.log('first_message:', data.conversation_config?.agent?.first_message);
const tools = data.conversation_config?.agent?.prompt?.tools || [];
console.log('Tools list:');
for (const t of tools) {
  console.log(`- ${t.name} (${t.api_schema?.url || t.type})`);
}
