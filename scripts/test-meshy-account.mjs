import fs from 'fs';
import os from 'os';
import path from 'path';

const meshyPath = path.join(os.homedir(), '.meshy_key');
const key = fs.readFileSync(meshyPath, 'utf8').trim();

console.log('Testing Meshy API key against https://api.meshy.ai/openapi/v2/text-to-3d ...');
const res = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d?page_num=1&page_size=1', {
  headers: {
    'Authorization': `Bearer ${key}`
  }
});

console.log('Meshy API response status:', res.status);
if (res.ok) {
  const data = await res.json();
  console.log('Meshy account tasks/info:', JSON.stringify(data, null, 2).slice(0, 500));
} else {
  console.log('Meshy API error:', await res.text());
}
