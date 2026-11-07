import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = env.ELEVENLABS_API_KEY;

// Get signed URL for conversation with no client dynamic variables passed (simulating dashboard preview)
const res = await fetch("https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=agent_9101m6kwm1sqe0ctz33pn1q7p07w", {
  headers: { "xi-api-key": key }
});
console.log("Signed URL status:", res.status);
const data = await res.json();
console.log("Signed URL returned:", Boolean(data.signed_url));
