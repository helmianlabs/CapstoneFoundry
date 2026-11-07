import fs from 'fs';

const path = 'E:/CapstoneFoundry/server/handlers/memory.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace("`\\${insParams.length}`", "`$" + "{insParams.length}`");
content = content.replace("`\\${insParams.length}`", "`$" + "{insParams.length}`");
content = content.replace("\\${vec ? 5 : 4}", "$" + "{vec ? 5 : 4}");
content = content.replace("\\${vec ? 6 : 5}", "$" + "{vec ? 6 : 5}");

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed backslashes before $');
