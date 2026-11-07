import fs from 'fs';

const path = 'E:/CapstoneFoundry/server/handlers/memory.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `  insParams.push(sourceSession); insVals.push(\`\${insParams.length}\`);\n  insParams.push(category); insVals.push(\`\${insParams.length}\`);`,
  `  insParams.push(sourceSession); insVals.push(\`$\${insParams.length}\`);\n  insParams.push(category); insVals.push(\`$\${insParams.length}\`);`
);

content = content.replace(
  `VALUES ($1, 'semantic', 'fact', $2, $3, \${vec ? '$4::vector' : 'NULL'}, 0.7, 0.5, \${vec ? 5 : 4}\${tenantId ? \`, \${vec ? 6 : 5}\` : ''})`,
  `VALUES ($1, 'semantic', 'fact', $2, $3, \${vec ? '$4::vector' : 'NULL'}, 0.7, 0.5, $\${vec ? 5 : 4}\${tenantId ? \`, $\${vec ? 6 : 5}\` : ''})`
);

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed dollar signs in SQL strings in memory.js');
