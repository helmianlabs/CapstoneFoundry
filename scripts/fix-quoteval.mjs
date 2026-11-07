import fs from 'fs';
import vm from 'vm';

let html = fs.readFileSync('E:/CapstoneFoundry/index.html', 'utf-8');

// Replace corrupted line
html = html.replace(
  /quoteVal\.textContent = '[\s\S]*?\+ total\.toLocaleString\(\);/,
  () => "quoteVal.textContent = '$' + total.toLocaleString();"
);

fs.writeFileSync('E:/CapstoneFoundry/index.html', html, 'utf-8');

const scriptMatches = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)];
const s3 = scriptMatches[3][1];
try {
  new vm.Script(s3);
  console.log('Script 3 parsed successfully with VM!');
} catch (err) {
  console.log('VM Parse Error:', err.message);
}
