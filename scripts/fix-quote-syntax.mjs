import fs from 'fs';

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Fix unescaped apostrophe in Don't
  content = content.replace(
    /a:\s*['"]Don'?t buy expensive equipment yet/g,
    'a: `"Don\'t buy expensive equipment yet'
  );
  content = content.replace(
    /Once cash is in hand, we buy the trailer\.[^"]*['"]/g,
    'Once cash is in hand, we buy the trailer."`'
  );

  fs.writeFileSync(filePath, content, 'utf8');
}

fixFile('E:/CapstoneFoundry/index.html');
fixFile('E:/CapstoneFoundry/public/landing.html');
console.log('Fixed quotes in both index.html and public/landing.html');
