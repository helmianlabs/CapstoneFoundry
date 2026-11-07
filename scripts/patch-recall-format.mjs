import fs from 'fs';

const path = 'E:/CapstoneFoundry/server/handlers/recall-memory.js';
let code = fs.readFileSync(path, 'utf8');

const target = `export function formatRecallLine(fact) {
  const value = fact && fact.value != null ? String(fact.value) : '';
  const key = fact && typeof fact.key === 'string' ? fact.key.trim() : '';
  if (key && key !== value) return \`\${key}: \${value}\`;
  return value;
}`;

const replacement = `export function formatRecallLine(fact) {
  const value = fact && fact.value != null ? String(fact.value) : '';
  const key = fact && typeof fact.key === 'string' ? fact.key.trim() : '';
  const dateStr = fact && fact.updatedAt ? new Date(fact.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const prefix = dateStr ? \`[\${dateStr}] \` : '';
  if (key && key !== value) return \`\${prefix}\${key}: \${value}\`;
  return \`\${prefix}\${value}\`;
}`;

const normalized = code.replace(/\r\n/g, '\n');
const normalizedTarget = target.replace(/\r\n/g, '\n');
const normalizedReplacement = replacement.replace(/\r\n/g, '\n');

if (!normalized.includes(normalizedTarget)) {
  console.error("Target not found!");
  process.exit(1);
}

const updated = normalized.replace(normalizedTarget, normalizedReplacement);
fs.writeFileSync(path, updated, 'utf8');
console.log("Updated formatRecallLine in recall-memory.js!");
