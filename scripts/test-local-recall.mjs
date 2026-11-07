import fs from 'fs';
import { retrieveMemoriesWithMeta } from '../server/handlers/memory.js';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();
process.env.DATABASE_URL_MEMORY = workingUrl;

try {
  const result = await retrieveMemoriesWithMeta("troy", {
    query: "Troy DairyForge",
    limit: 5
  });
  console.log("SUCCESS! Mode:", result.mode, "count:", result.facts?.length);
  for (const f of result.facts || []) {
    console.log(`- [${f.key}]: ${f.value}`);
  }
} catch (e) {
  console.error("Local error:", e);
}
