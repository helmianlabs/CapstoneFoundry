import fs from 'fs';

try {
  const raw = fs.readFileSync('C:/Users/troyh/.claude.json', 'utf8');
  const m = raw.match(/postgres(?:ql)?:\/\/[^"'\s\\]+neon\.tech\/[^\s"'\\]+/g);
  console.log("Matches in .claude.json:", m?.length);
  if (m) {
    for (const match of m) {
      const u = new URL(match.replace(/\\u0026/g, '&'));
      console.log(`- Host: ${u.host}, DB: ${u.pathname}, user: ${u.username}, password length: ${u.password.length}`);
    }
  }
} catch (e) {
  console.log("Error reading .claude.json:", e.message);
}
