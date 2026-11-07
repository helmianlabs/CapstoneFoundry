import fs from 'fs';

const path = 'server/handlers/memory.js';
let content = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

if (!content.includes("import { inspectTextSecurity }")) {
  content = `import { inspectTextSecurity } from '../../lib/injectionDefense.js';\n` + content;
}

const targetPost = `    if (req.method === 'POST') {
      const { key, value } = req.body || {};
      if (!key || !value) return res.status(400).json({ error: 'key and value required' });`;

const replacementPost = `    if (req.method === 'POST') {
      const { key, value } = req.body || {};
      if (!key || !value) return res.status(400).json({ error: 'key and value required' });

      // Anti-Poisoning & Adversarial Injection Defense
      const injectionCheck = inspectTextSecurity(\`\${key}: \${value}\`);
      if (!injectionCheck.safe) {
        console.warn('[memory] rejected memory poisoning attempt:', injectionCheck.reason);
        return res.status(400).json({ error: 'Security violation: memory content disallowed' });
      }`;

if (!content.includes(targetPost)) {
  console.error('targetPost not found in server/handlers/memory.js');
  process.exit(1);
}

content = content.replace(targetPost, replacementPost);
fs.writeFileSync(path, content, 'utf8');
console.log('Successfully patched server/handlers/memory.js with anti-poisoning defense!');
