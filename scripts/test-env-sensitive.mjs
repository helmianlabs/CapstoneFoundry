import fs from 'fs';
import { execSync } from 'child_process';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();

try {
  const out = execSync(`vercel env add DATABASE_URL_MEMORY development --value "${workingUrl}" --yes --project thinkbuddy`, {
    encoding: 'utf8'
  });
  console.log("SUCCESS:\n", out);
} catch (err) {
  console.log("Stdout:", err.stdout);
  console.log("Stderr:", err.stderr);
}

