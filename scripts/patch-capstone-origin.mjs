import fs from 'fs';

const path = 'lib/security.js';
let content = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const target = `'https://thinkbuddy-sandy.vercel.app',`;
const replacement = `'https://thinkbuddy-sandy.vercel.app',\n  'https://capstonefoundry.vercel.app',`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Successfully added capstonefoundry.vercel.app to DEFAULT_ALLOWED_ORIGINS!');
} else {
  console.error('Target not found in lib/security.js');
}
