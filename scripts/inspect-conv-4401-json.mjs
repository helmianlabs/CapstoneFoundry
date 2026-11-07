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
fs.writeFileSync('E:/CapstoneFoundry/conv_4401_full.json', JSON.stringify(conv, null, 2), 'utf8');

// Also let's check how many times BLUE-EAGLE appears
const str = JSON.stringify(conv);
console.log('Includes BLUE-EAGLE:', str.includes('BLUE-EAGLE'));
const matches = [];
let idx = str.indexOf('BLUE-EAGLE');
while (idx !== -1) {
  matches.push(str.slice(Math.max(0, idx - 100), Math.min(str.length, idx + 100)));
  idx = str.indexOf('BLUE-EAGLE', idx + 1);
}
console.log('Matches:', matches);
