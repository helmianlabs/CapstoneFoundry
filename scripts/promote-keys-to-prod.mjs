import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const previewText = fs.readFileSync('E:/CapstoneFoundry/.env.preview', 'utf8');
const env = {};
for (const line of previewText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const meshyPath = path.join(os.homedir(), '.meshy_key');
let meshyKey = null;
if (fs.existsSync(meshyPath)) {
  meshyKey = fs.readFileSync(meshyPath, 'utf8').trim();
}

console.log('RUNWAY_API_KEY present:', Boolean(env.RUNWAY_API_KEY));
console.log('HEYGEN_API_KEY present:', Boolean(env.HEYGEN_API_KEY));
console.log('REPLICATE_API_TOKEN present:', Boolean(env.REPLICATE_API_TOKEN));
console.log('MESHY_API_KEY present:', Boolean(meshyKey));

const toAdd = [
  { name: 'RUNWAY_API_KEY', val: env.RUNWAY_API_KEY },
  { name: 'HEYGEN_API_KEY', val: env.HEYGEN_API_KEY },
  { name: 'REPLICATE_API_TOKEN', val: env.REPLICATE_API_TOKEN },
  { name: 'MESHY_API_KEY', val: meshyKey }
];

for (const item of toAdd) {
  if (!item.val) continue;
  try {
    console.log(`Adding ${item.name} to Vercel production...`);
    execSync(`vercel env add ${item.name} production --project thinkbuddy --scope dairyforge1-6376s-projects --force`, {
      input: item.val,
      stdio: ['pipe', 'inherit', 'inherit']
    });
    console.log(`Successfully added ${item.name}!`);
  } catch (e) {
    console.error(`Error adding ${item.name}:`, e.message);
  }
}
