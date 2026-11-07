import fs from 'fs';

const path = 'E:/CapstoneFoundry/server/handlers/memory.js';
let content = fs.readFileSync(path, 'utf8');

// Function replacement avoids $ expansion in String.prototype.replace
content = content.replace(
  "insParams.push(sourceSession); insVals.push(`${insParams.length}`);\n  insParams.push(category); insVals.push(`${insParams.length}`);",
  () => "insParams.push(sourceSession); insVals.push(`$" + "{insParams.length}`);\n  insParams.push(category); insVals.push(`$" + "{insParams.length}`);"
);

content = content.replace(
  "0.7, 0.5, ${vec ? 5 : 4}${tenantId ? `, ${vec ? 6 : 5}` : ''}",
  () => "0.7, 0.5, $" + "{vec ? 5 : 4}${tenantId ? `, $" + "{vec ? 6 : 5}` : ''}"
);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully replaced with exact literal $');
