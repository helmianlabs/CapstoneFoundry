import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;

// Fetch agent config
const agentRes = await fetch("https://api.elevenlabs.io/v1/convai/agents/agent_9101m6kwm1sqe0ctz33pn1q7p07w", {
  headers: { "xi-api-key": key }
});
const agentData = await agentRes.json();
console.log("Agent keys:", Object.keys(agentData));
console.log("conversation_config keys:", Object.keys(agentData.conversation_config));
console.log("agent config keys:", Object.keys(agentData.conversation_config.agent));
console.log("dynamic_variables in agent config:", agentData.conversation_config?.agent?.dynamic_variables);

// Let's also check the OpenAPI spec for dynamic_variables
const specRes = await fetch("https://api.elevenlabs.io/openapi.json");
const spec = await specRes.json();
const agentSchema = spec.components?.schemas?.AgentConfigModel || spec.components?.schemas?.Body_Update_agent_v1_convai_agents__agent_id__patch;
console.log("Agent schema dynamic_variables:", JSON.stringify(agentSchema?.properties?.conversation_config?.properties?.agent?.properties?.dynamic_variables || {}, null, 2));
