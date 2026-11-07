import fs from 'fs';

const path = 'E:/CapstoneFoundry/server/handlers/memory.js';
let content = fs.readFileSync(path, 'utf8');

const t1 = "insParams.push(sourceSession); insVals.push(`${insParams.length}`);\n  insParams.push(category); insVals.push(`${insParams.length}`);";
const r1 = "insParams.push(sourceSession); insVals.push(`\\$${insParams.length}`);\n  insParams.push(category); insVals.push(`\\$${insParams.length}`);";

if (!content.includes(t1)) {
  console.log('t1 not found! Checking CRLF...');
  const t1crlf = t1.replace(/\n/g, '\r\n');
  const r1crlf = r1.replace(/\n/g, '\r\n');
  if (content.includes(t1crlf)) {
    content = content.replace(t1crlf, r1crlf);
    console.log('Replaced t1 CRLF!');
  } else {
    console.log('t1 CRLF not found!');
  }
} else {
  content = content.replace(t1, r1);
  console.log('Replaced t1 LF!');
}

const t2 = "0.7, 0.5, ${vec ? 5 : 4}${tenantId ? `, ${vec ? 6 : 5}` : ''}";
const r2 = "0.7, 0.5, \\$${vec ? 5 : 4}${tenantId ? `, \\$${vec ? 6 : 5}` : ''}";
if (!content.includes(t2)) {
  console.log('t2 not found!');
} else {
  content = content.replace(t2, r2);
  console.log('Replaced t2!');
}

fs.writeFileSync(path, content, 'utf8');
