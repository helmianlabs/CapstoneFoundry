import fs from 'fs';

const path = 'E:/CapstoneFoundry/lib/mediaMemory.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `: \`AND kind IN ('image','video')\`;`,
  `: mediaType === 'model3d' ? \`AND kind = 'model3d'\` : \`AND kind IN ('image','video','model3d')\`;`
);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully updated lib/mediaMemory.js with model3d filter!');
