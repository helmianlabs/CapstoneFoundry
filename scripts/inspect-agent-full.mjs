import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;

const agentRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/agent_9101m6kwm1sqe0ctz33pn1q7p07w`, {
  headers: { 'xi-api-key': key }
});
const agent = await agentRes.json();
console.log('AGENT NAME:', agent.name);
console.log('PROMPT (first 500 chars):', agent.conversation_config?.agent?.prompt?.prompt?.slice(0, 500));
console.log('DYNAMIC VARIABLES:', agent.conversation_config?.agent?.dynamic_variables);
console.log('TOOLS COUNT:', agent.conversation_config?.agent?.prompt?.tools?.length);
console.log('TOOLS:', JSON.stringify(agent.conversation_config?.agent?.prompt?.tools, null, 2));
