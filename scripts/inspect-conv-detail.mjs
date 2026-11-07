import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;

const convIds = [
  'conv_4401m6s7yrzmfb0v3btbsscqcnqn',
  'conv_3501m6s7s4t6efh9amsdqxxa5v4v',
  'conv_0001m6s7jesafvwr57k692vdfag8'
];

for (const id of convIds) {
  console.log(`\n=================== CONVERSATION ${id} ===================`);
  const convRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}`, {
    headers: { 'xi-api-key': key }
  });
  const conv = await convRes.json();
  console.log('Agent ID:', conv.agent_id);
  console.log('Dynamic Vars:', JSON.stringify(conv.conversation_initiation_client_data?.dynamic_variables, null, 2));
  for (const t of conv.transcript || []) {
    console.log(`[${t.role}]: ${t.message}`);
    if (t.tool_calls && t.tool_calls.length > 0) {
      console.log(`  -> TOOL CALL:`, JSON.stringify(t.tool_calls, null, 2));
    }
    if (t.tool_results && t.tool_results.length > 0) {
      console.log(`  <- TOOL RESULT:`, JSON.stringify(t.tool_results, null, 2));
    }
  }
}
