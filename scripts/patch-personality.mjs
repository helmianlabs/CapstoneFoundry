import fs from 'fs';

const path = 'E:/CapstoneFoundry/lib/personality.js';
let content = fs.readFileSync(path, 'utf8');

const target = `export function memoryBullet(m) {\r\n  const value = m && m.value != null ? String(m.value) : '';\r\n  const key = m && typeof m.key === 'string' ? m.key.trim() : '';\r\n  if (key && key !== value) return \`- \${key}: \${value}\`;\r\n  return \`- \${value}\`;\r\n}`;

const replacement = `export function memoryBullet(m) {\r\n  const value = m && m.value != null ? String(m.value) : '';\r\n  const key = m && typeof m.key === 'string' ? m.key.trim() : '';\r\n  const tag = (m && m.category && m.category !== 'general') ? \` [\${m.category.toUpperCase()}]\` : '';\r\n  const dateStr = (m && (m.createdAt || m.updatedAt))\r\n    ? \` (\${new Date(m.createdAt || m.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})\`\r\n    : '';\r\n  if (key && key !== value) return \`- \${key}: \${value}\${tag}\${dateStr}\`;\r\n  return \`- \${value}\${tag}\${dateStr}\`;\r\n}`;

if (!content.includes(target)) {
  console.log('Target not found in personality.js!');
  process.exit(1);
}

content = content.replace(target, replacement);
fs.writeFileSync(path, content, 'utf8');
console.log('Successfully updated personality.js memoryBullet!');
