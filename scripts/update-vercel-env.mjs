import fs from 'fs';
import { execSync } from 'child_process';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();

console.log("Updating DATABASE_URL_MEMORY on Vercel production and preview...");
for (const env of ['production', 'preview']) {
  try {
    const out = execSync(`vercel env add DATABASE_URL_MEMORY ${env} --value "${workingUrl}" --force --yes --project thinkbuddy`, {
      encoding: 'utf8'
    });
    console.log(`[${env}] SUCCESS:\n`, out);
  } catch (err) {
    console.error(`[${env}] ERROR:`, err.message);
  }
}
