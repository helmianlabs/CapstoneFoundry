import fs from 'fs';

// Patch memory.js
const memPath = 'E:/CapstoneFoundry/server/handlers/memory.js';
let memCode = fs.readFileSync(memPath, 'utf8').replace(/\r\n/g, '\n');

memCode = memCode.replace(
  `    importance: r.importance,\n    createdAt: r.created_at?.toISOString?.() || null,`,
  `    category: r.category || 'general',\n    importance: r.importance,\n    createdAt: r.created_at?.toISOString?.() || null,`
);

memCode = memCode.replace(
  `                importance,\n                created_at,\n                updated_at\n           FROM memory_items`,
  `                category,\n                importance,\n                created_at,\n                updated_at\n           FROM memory_items`
);

memCode = memCode.replace(
  `            importance,\n            created_at,\n            updated_at\n       FROM memory_items`,
  `            category,\n            importance,\n            created_at,\n            updated_at\n       FROM memory_items`
);

fs.writeFileSync(memPath, memCode, 'utf8');
console.log("Updated memory.js with category column in SELECT!");

// Patch recall-memory.js
const recPath = 'E:/CapstoneFoundry/server/handlers/recall-memory.js';
let recCode = fs.readFileSync(recPath, 'utf8').replace(/\r\n/g, '\n');

const recTarget = `export function formatRecallLine(fact) {
  const value = fact && fact.value != null ? String(fact.value) : '';
  const key = fact && typeof fact.key === 'string' ? fact.key.trim() : '';
  const ts = fact?.createdAt || fact?.updatedAt;
  const dateStr = ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const prefix = dateStr ? \`[\${dateStr}] \` : '';
  if (key && key !== value) return \`\${prefix}\${key}: \${value}\`;
  return \`\${prefix}\${value}\`;
}`;

const recReplacement = `export function formatRecallLine(fact) {
  const value = fact && fact.value != null ? String(fact.value) : '';
  const key = fact && typeof fact.key === 'string' ? fact.key.trim() : '';
  const ts = fact?.createdAt || fact?.updatedAt;
  const dateStr = ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const catTag = fact?.category && fact.category !== 'general' ? \`[\${fact.category.toUpperCase()}] \` : '';
  const datePrefix = dateStr ? \`(\${dateStr}) \` : '';
  if (key && key !== value) return \`\${datePrefix}\${catTag}\${key}: \${value}\`;
  return \`\${datePrefix}\${catTag}\${value}\`;
}`;

recCode = recCode.replace(recTarget, recReplacement);
fs.writeFileSync(recPath, recCode, 'utf8');
console.log("Updated recall-memory.js with category tag!");
