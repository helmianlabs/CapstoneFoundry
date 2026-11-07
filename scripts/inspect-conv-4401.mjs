import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;

const id = 'conv_4401m6s7yrzmfb0v3btbsscqcnqn';
const convRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}`, {
  headers: { 'xi-api-key': key }
});
const conv = await convRes.json();
console.log(JSON.stringify(conv.transcript, null, 2));
