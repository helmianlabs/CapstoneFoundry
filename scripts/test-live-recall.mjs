import fs from 'fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const secret = env.WEBHOOK_SECRET;

console.log("Calling live recall-memory on thinkbuddy-sandy.vercel.app...");
const res = await fetch("https://thinkbuddy-sandy.vercel.app/api/recall-memory", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Secret": secret
  },
  body: JSON.stringify({
    userId: "troy",
    query: "Jarvis or dairy trucking or Mark"
  })
});

console.log("Status:", res.status);
const body = await res.text();
console.log("Response body:\n", body);
