import fs from 'fs';

const path = 'E:/CapstoneFoundry/server/handlers/memory.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Add classifyMemoryCategory export if not present
if (!content.includes('function classifyMemoryCategory')) {
  const helperCode = `
export function classifyMemoryCategory(subject = '', content = '') {
  const text = \`\${subject} \${content}\`.toLowerCase();
  if (/\\b(code|api|github|git|bug|endpoint|build|deploy|vercel|database|postgres|neon|sql|schema|migration|relay|spoke|helmian|software|npm|package|frontend|backend|app)\\b/.test(text)) {
    return 'build';
  }
  if (/\\b(dfa|truck|trucking|hauler|hauling|dairyforge|dispatch|customer|client|sales|pricing|bid|contract|tms|business|company|carrier)\\b/.test(text)) {
    return 'business';
  }
  if (/\\b(spanish|language|tutor|curriculum|feynman|lesson|learn|study|homework|school|math|grade)\\b/.test(text)) {
    return 'learning';
  }
  if (/\\b(money|finance|credit|loan|interest|mortgage|bank|revenue|expense|bill|cost|dollar|price|fee)\\b/.test(text)) {
    return 'finance';
  }
  if (/\\b(family|friend|wife|son|daughter|dad|brother|sister|neighbor|luis|arturo|derek|home|idaho|burley|shoshone|chisone|health|doctor|dog)\\b/.test(text)) {
    return 'personal';
  }
  return 'general';
}
`;
  content = content.replace('// Shared helpers for other API routes', `${helperCode}\n// Shared helpers for other API routes`);
}

// 2. In upsertFact, insert category into memory_items and record in memory_filings
const oldUpsert = `  const insert = await pool.query(\r\n    \`INSERT INTO memory_items\r\n       (user_id, scope, kind, subject, content, embedding, confidence, importance\${tenantId ? ', tenant_id' : ''})\r\n     VALUES ($1, 'semantic', 'fact', $2, $3, \${vec ? '$4::vector' : 'NULL'}, 0.7, 0.5\${tenantId ? \`, $\${vec ? 5 : 4}\` : ''})\r\n     RETURNING id\`,\r\n    vec ? [userId, subject, content, vecLiteral(vec), ...(tenantId ? [tenantId] : [])]\r\n        : [userId, subject, content, ...(tenantId ? [tenantId] : [])]\r\n  );`;

const newUpsert = `  const category = classifyMemoryCategory(subject, content);\r\n  const insert = await pool.query(\r\n    \`INSERT INTO memory_items\r\n       (user_id, scope, kind, subject, content, embedding, confidence, importance, category\${tenantId ? ', tenant_id' : ''})\r\n     VALUES ($1, 'semantic', 'fact', $2, $3, \${vec ? '$4::vector' : 'NULL'}, 0.7, 0.5, $\${vec ? 5 : 4}\${tenantId ? \`, $\${vec ? 6 : 5}\` : ''})\r\n     RETURNING id\`,\r\n    vec ? [userId, subject, content, vecLiteral(vec), category, ...(tenantId ? [tenantId] : [])]\r\n        : [userId, subject, content, category, ...(tenantId ? [tenantId] : [])]\r\n  );\r\n  try {\r\n    await pool.query(\r\n      \`INSERT INTO memory_filings (tenant_id, memory_id, category, rule_key, explanation)\r\n       VALUES ($1, $2, $3, $4, $5)\`,\r\n      [tenantId, String(insert.rows[0].id), category, \`librarian.\${category}\`, \`Librarian filed under \${category}\`]\r\n    );\r\n  } catch (e) { /* ignore filing logging failure */ }`;

if (content.includes(oldUpsert)) {
  content = content.replace(oldUpsert, newUpsert);
  console.log('Patched upsertFact with Librarian category & filing!');
} else {
  console.log('oldUpsert not matched exactly, checking alternate line endings...');
  const altOld = oldUpsert.replace(/\r\n/g, '\n');
  const altNew = newUpsert.replace(/\r\n/g, '\n');
  if (content.includes(altOld)) {
    content = content.replace(altOld, altNew);
    console.log('Patched upsertFact (LF)!');
  } else {
    console.log('Failed to match upsertFact in memory.js');
  }
}

fs.writeFileSync(path, content, 'utf8');
console.log('Updated memory.js');
