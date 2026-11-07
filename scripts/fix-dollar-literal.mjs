import fs from 'fs';

const path = 'E:/CapstoneFoundry/server/handlers/memory.js';
let content = fs.readFileSync(path, 'utf8');

// Replace `${insParams.length}` with `$${insParams.length}`
content = content.replace("insVals.push(`${insParams.length}`)", "insVals.push(`$${insParams.length}`)");
content = content.replace("insVals.push(`${insParams.length}`)", "insVals.push(`$${insParams.length}`)");
content = content.replace("0.7, 0.5, ${vec ? 5 : 4}${tenantId ? `, ${vec ? 6 : 5}` : ''}", "0.7, 0.5, $${vec ? 5 : 4}${tenantId ? `, $${vec ? 6 : 5}` : ''}");

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed literal $ in memory.js');
