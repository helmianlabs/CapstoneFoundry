import fs from 'fs';

const path = 'api/[...path].js';
let content = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

if (!content.includes("import { applySwarmGate")) {
  content = `import { applySwarmGate, detectSuspiciousBotSwarm } from '../lib/swarmDefense.js';\n` + content;
}

const targetHandler = `export default async function handler(req, res) {
  const pathname = new URL(req.url, 'http://local').pathname;`;

const replacementHandler = `export default async function handler(req, res) {
  // AI Swarm & DDoS Defense: gate automated flooding & scraping tools
  if (req.method !== 'OPTIONS') {
    const hasWebhookAuth = Boolean(req.headers?.['x-webhook-secret'] || req.headers?.['x-elevenlabs-secret']);
    if (!hasWebhookAuth) {
      const botCheck = detectSuspiciousBotSwarm(req);
      if (botCheck.isBot) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'Access denied: automated script detected', reason: botCheck.reason }));
      }
    }
    if (!applySwarmGate(req, res, { maxRequests: 120, burstLimit: 25 })) {
      return;
    }
  }

  const pathname = new URL(req.url, 'http://local').pathname;`;

if (!content.includes(targetHandler)) {
  console.error('targetHandler not found in api/[...path].js');
  process.exit(1);
}

content = content.replace(targetHandler, replacementHandler);
fs.writeFileSync(path, content, 'utf8');
console.log('Successfully patched api/[...path].js with AI Swarm & DDoS gate!');
