import fs from 'fs';

const path = 'E:/CapstoneFoundry/server/handlers/memory.js';
const content = fs.readFileSync(path, 'utf8');
const isCRLF = content.includes('\r\n');
const lines = content.split(/\r?\n/);

lines[445] = "  insParams.push(sourceSession); insVals.push(`$" + "{insParams.length}`);";
lines[446] = "  insParams.push(category); insVals.push(`$" + "{insParams.length}`);";
lines[803] = "     VALUES ($1, 'semantic', 'fact', $2, $3, ${vec ? '$4::vector' : 'NULL'}, 0.7, 0.5, $" + "{vec ? 5 : 4}${tenantId ? `, $" + "{vec ? 6 : 5}` : ''})";

fs.writeFileSync(path, lines.join(isCRLF ? '\r\n' : '\n'), 'utf8');
console.log('Successfully updated lines 446, 447, and 804 with $');
