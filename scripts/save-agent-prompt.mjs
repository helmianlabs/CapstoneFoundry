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
fs.writeFileSync('E:/CapstoneFoundry/agent-prompt-full.txt', agent.conversation_config?.agent?.prompt?.prompt || '', 'utf8');
console.log('Saved agent prompt to E:/CapstoneFoundry/agent-prompt-full.txt. Length:', agent.conversation_config?.agent?.prompt?.prompt?.length);
