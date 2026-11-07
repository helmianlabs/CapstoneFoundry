import fs from 'fs';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();
const envPath = "E:/CapstoneFoundry/.env.local";
let envContent = fs.readFileSync(envPath, "utf8");

// Remove any existing DATABASE_URL_MEMORY lines
const lines = envContent.split("\n").filter(l => !l.startsWith("DATABASE_URL_MEMORY="));
lines.push(`DATABASE_URL_MEMORY="${workingUrl}"`);

fs.writeFileSync(envPath, lines.join("\n"), "utf8");
console.log("Updated .env.local with working Neon URL!");
