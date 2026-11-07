import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;

const res = await fetch("https://api.elevenlabs.io/v1/convai/conversations?agent_id=agent_9101m6kwm1sqe0ctz33pn1q7p07w&page_size=5", {
  headers: { "xi-api-key": key }
});

console.log("Conversations status:", res.status);
const data = await res.json();
console.log("Conversations list:", data.conversations?.map(c => ({
  id: c.conversation_id,
  status: c.status,
  start_time: c.start_time_unix_secs ? new Date(c.start_time_unix_secs * 1000).toISOString() : null,
  call_duration_secs: c.call_duration_secs
})));

if (data.conversations?.[0]) {
  const latestId = data.conversations[0].conversation_id;
  console.log(`\nFetching details for latest conversation ${latestId}...`);
  const convRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${latestId}`, {
    headers: { "xi-api-key": key }
  });
  const conv = await convRes.json();
  console.log("Conversation dynamic variables:", conv.conversation_initiation_client_data?.dynamic_variables);
  console.log("Transcript preview:");
  for (const t of conv.transcript?.slice(-6) || []) {
    console.log(`  [${t.role}]: ${t.message}`);
    if (t.tool_calls) {
      console.log(`    TOOL CALL:`, t.tool_calls);
    }
    if (t.tool_results) {
      console.log(`    TOOL RESULT:`, t.tool_results);
    }
  }
}
