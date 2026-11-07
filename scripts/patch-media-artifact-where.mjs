import fs from 'fs';

let code = fs.readFileSync('E:/CapstoneFoundry/lib/mediaMemory.js', 'utf8');
code = code.replace(/WHERE \$\{identityCol\} = \$1/g, 'WHERE (${identityCol} = $1 OR kind = \'artifact\')');
fs.writeFileSync('E:/CapstoneFoundry/lib/mediaMemory.js', code, 'utf8');
console.log('patched mediaMemory.js WHERE clause');
