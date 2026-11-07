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
const currentPrompt = agent.conversation_config?.agent?.prompt?.prompt;

const targetSection = /\[WHAT YOU KNOW ABOUT TROY[\s\S]*?takes jokes the wrong way\./;
if (!targetSection.test(currentPrompt)) {
  console.log('Target section not found in prompt!');
  process.exit(1);
}

const replacement = `[MEMORY AND KNOWLEDGE]
Your persistent memories are stored in your Neon database. When a conversation starts, your briefing is dynamically loaded from the database. Mid-call, you MUST use the recall_memory tool to look up details about past conversations, projects, people, codes, or preferences before answering. Never say you don't remember without calling recall_memory.`;

const updatedPrompt = currentPrompt.replace(targetSection, replacement);

const cc = agent.conversation_config;
cc.agent.prompt.prompt = updatedPrompt;
delete cc.agent.prompt.tools; // per elevenlabs requirement

const patchRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
  method: 'PATCH',
  headers: {
    'xi-api-key': key,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ conversation_config: cc })
});

console.log('Patch response status:', patchRes.status);
if (patchRes.ok) {
  console.log('Successfully cleaned ElevenLabs base prompt of stale hardcoded memories!');
} else {
  console.log('Error:', await patchRes.text());
}
