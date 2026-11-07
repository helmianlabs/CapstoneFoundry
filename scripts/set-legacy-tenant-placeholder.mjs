import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;

const patchRes = await fetch("https://api.elevenlabs.io/v1/convai/agents/agent_9101m6kwm1sqe0ctz33pn1q7p07w", {
  method: 'PATCH',
  headers: {
    'xi-api-key': key,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    conversation_config: {
      agent: {
        dynamic_variables: {
          dynamic_variable_placeholders: {
            user_id: "00000000-0000-4000-8000-000000000001"
          }
        }
      }
    }
  })
});

console.log("Status:", patchRes.status);
const data = await patchRes.json();
console.log("Updated dynamic_variables:", JSON.stringify(data.conversation_config?.agent?.dynamic_variables, null, 2));
