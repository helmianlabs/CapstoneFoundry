import fs from 'fs';

const specRes = await fetch("https://api.elevenlabs.io/openapi.json");
const spec = await specRes.json();

for (const [name, schema] of Object.entries(spec.components?.schemas || {})) {
  if (name.toLowerCase().includes("dynamicvariable")) {
    console.log(`Schema [${name}]:`, JSON.stringify(schema, null, 2));
  }
}
