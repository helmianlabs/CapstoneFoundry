import fs from 'fs';

const path = 'E:/CapstoneFoundry/api/[...path].js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `  'diary': { api: { bodyParser: { sizeLimit: '10mb' } } },`,
  `  'diary': { api: { bodyParser: { sizeLimit: '10mb' } } },\n  'generate-3d': { maxDuration: 180 },\n  'export-document': { maxDuration: 60 },`
);

content = content.replace(
  `  'extract-memories': () => import('../server/handlers/extract-memories.js'),`,
  `  'export-document': () => import('../server/handlers/export-document.js'),\n  'extract-memories': () => import('../server/handlers/extract-memories.js'),\n  'generate-3d': () => import('../server/handlers/generate-3d.js'),`
);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully updated api/[...path].js with generate-3d and export-document routes!');
