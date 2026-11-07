import fs from 'fs';

// Patch memory.js
const memPath = 'E:/CapstoneFoundry/server/handlers/memory.js';
let memCode = fs.readFileSync(memPath, 'utf8').replace(/\r\n/g, '\n');

// 1. mapRow
memCode = memCode.replace(
  `  const mapRow = (r) => ({\n    key: r.key,\n    value: r.value,\n    kind: r.kind || 'fact',\n    scope: r.scope || 'semantic',\n    importance: r.importance,\n    updatedAt: r.updated_at?.toISOString?.() || null,\n  });`,
  `  const mapRow = (r) => ({\n    key: r.key,\n    value: r.value,\n    kind: r.kind || 'fact',\n    scope: r.scope || 'semantic',\n    importance: r.importance,\n    createdAt: r.created_at?.toISOString?.() || null,\n    updatedAt: r.updated_at?.toISOString?.() || null,\n  });`
);

// 2. vector SELECT
memCode = memCode.replace(
  `        \`SELECT subject AS key,\n                content AS value,\n                kind,\n                scope,\n                importance,\n                updated_at\n           FROM memory_items`,
  `        \`SELECT subject AS key,\n                content AS value,\n                kind,\n                scope,\n                importance,\n                created_at,\n                updated_at\n           FROM memory_items`
);

// 3. boot SELECT
memCode = memCode.replace(
  `    \`SELECT subject AS key,\n            content AS value,\n            kind,\n            scope,\n            importance,\n            updated_at\n       FROM memory_items`,
  `    \`SELECT subject AS key,\n            content AS value,\n            kind,\n            scope,\n            importance,\n            created_at,\n            updated_at\n       FROM memory_items`
);

fs.writeFileSync(memPath, memCode, 'utf8');
console.log("Updated memory.js with created_at!");

// Patch recall-memory.js
const recPath = 'E:/CapstoneFoundry/server/handlers/recall-memory.js';
let recCode = fs.readFileSync(recPath, 'utf8').replace(/\r\n/g, '\n');

recCode = recCode.replace(
  `  const dateStr = fact && fact.updatedAt ? new Date(fact.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';`,
  `  const ts = fact?.createdAt || fact?.updatedAt;\n  const dateStr = ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';`
);

fs.writeFileSync(recPath, recCode, 'utf8');
console.log("Updated recall-memory.js with createdAt priority!");
