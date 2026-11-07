import fs from 'fs';

const conv = JSON.parse(fs.readFileSync('E:/CapstoneFoundry/conv_4401_full.json', 'utf8'));

function findKeyWithPath(obj, targetStr, path = '') {
  if (typeof obj === 'string') {
    if (obj.includes(targetStr)) {
      console.log(`Found in path: ${path}`);
      console.log(`Snippet: ${obj.slice(0, 300)}...\n`);
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, idx) => findKeyWithPath(item, targetStr, `${path}[${idx}]`));
  } else if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      findKeyWithPath(v, targetStr, path ? `${path}.${k}` : k);
    }
  }
}

findKeyWithPath(conv, 'BLUE-EAGLE');
