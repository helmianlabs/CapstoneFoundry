import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;
const AGENT_ID = 'agent_9101m6kwm1sqe0ctz33pn1q7p07w';

const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
  headers: { 'xi-api-key': key }
});
const agent = await res.json();
const cc = agent.conversation_config;

const newFirstMessage = "";
cc.agent.first_message = newFirstMessage;
delete cc.agent.prompt.tools;

const patchRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
  method: 'PATCH',
  headers: {
    'xi-api-key': key,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ conversation_config: cc })
});

console.log('Update first_message status:', patchRes.status);
if (patchRes.ok) {
  console.log('Successfully set Mark first_message to:', newFirstMessage);
} else {
  console.error('Error:', await patchRes.text());
}
