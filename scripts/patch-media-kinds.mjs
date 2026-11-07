import fs from 'fs';

let code = fs.readFileSync('E:/CapstoneFoundry/lib/mediaMemory.js', 'utf8');
code = code.replace(
  /: mediaType === 'model3d' \? `AND kind = 'model3d'` : `AND kind IN \('image','video','model3d'\)`;/,
  `: mediaType === 'model3d' ? \`AND kind = 'model3d'\` : mediaType === 'artifact' ? \`AND kind = 'artifact'\` : mediaType === 'document' ? \`AND kind = 'document'\` : \`AND kind IN ('image','video','model3d','artifact','document')\`;`
);
fs.writeFileSync('E:/CapstoneFoundry/lib/mediaMemory.js', code, 'utf8');
console.log('patched mediaMemory.js');

let gcode = fs.readFileSync('E:/CapstoneFoundry/server/handlers/media-gallery.js', 'utf8');
gcode = gcode.replace(
  `['image', 'video', 'model3d'].includes(req.query?.type)`,
  `['image', 'video', 'model3d', 'artifact', 'document'].includes(req.query?.type)`
);
fs.writeFileSync('E:/CapstoneFoundry/server/handlers/media-gallery.js', gcode, 'utf8');
console.log('patched media-gallery.js');
