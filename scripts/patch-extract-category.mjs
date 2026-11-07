import fs from 'fs';

const path = 'E:/CapstoneFoundry/server/handlers/extract-memories.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `  "kind": "fact|preference|identity|decision|project_state|task|feedback|reminder",\n  "subject": "string",`,
  `  "kind": "fact|preference|identity|decision|project_state|task|feedback|reminder",\n  "category": "business|build|personal|learning|finance|general",\n  "subject": "string",`
);

content = content.replace(
  `      kind: typeof c.kind === 'string' && c.kind ? c.kind : 'fact',`,
  `      kind: typeof c.kind === 'string' && c.kind ? c.kind : 'fact',\n      category: typeof c.category === 'string' && c.category ? c.category.trim() : undefined,`
);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully patched extract-memories.js with category in prompt and candidate shape!');
