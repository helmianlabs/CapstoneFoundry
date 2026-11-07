import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;

const id = 'conv_3501m6s7s4t6efh9amsdqxxa5v4v';
const convRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}`, {
  headers: { 'xi-api-key': key }
});
const conv = await convRes.json();

for (let i = 0; i < conv.transcript.length; i++) {
  const t = conv.transcript[i];
  console.log(`\n--- Step ${i} [${t.role}] ---`);
  if (t.message) console.log('Message:', t.message);
  if (t.tool_calls) console.log('Tool calls:', JSON.stringify(t.tool_calls, null, 2));
  if (t.tool_results) {
    for (const res of t.tool_results) {
      console.log('Tool result for:', res.tool_name);
      try {
        const parsed = JSON.parse(res.result_value);
        console.log('Parsed result summary:', parsed.summary);
        console.log('Parsed result facts count:', parsed.facts?.length);
        console.log('Parsed result facts keys:', parsed.facts?.map(f => f.key));
        console.log('Full result stringified:', JSON.stringify(parsed, null, 2));
      } catch (e) {
        console.log('Raw result_value:', res.result_value);
      }
    }
  }
}
