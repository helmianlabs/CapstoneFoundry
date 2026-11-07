import fs from 'fs';

const envText = fs.readFileSync('.env.local', 'utf8');
const key = envText.match(/ELEVENLABS_API_KEY=(.*)/)[1].trim();
const realSecret = '2473b84d26f2048e11875e23d20c476e91f0c09427424cabdd826f3a8c6d06ea';

const r = await fetch('https://api.elevenlabs.io/v1/convai/tools', { headers: { 'xi-api-key': key } });
const data = await r.json();

for (const t of data.tools) {
  const name = t.tool_config?.name;
  if (['generate_3d_character', 'export_document'].includes(name)) {
    console.log('Updating tool:', name, t.id);
    const updatedConfig = { ...t.tool_config };
    updatedConfig.api_schema.request_headers = { 'X-Webhook-Secret': realSecret };
    const patchRes = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${t.id}`, {
      method: 'PATCH',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tool_config: updatedConfig }),
    });
    console.log(name, 'PATCH status:', patchRes.status);
    if (!patchRes.ok) {
      console.error(await patchRes.text());
    } else {
      console.log(`Successfully updated ${name} with production secret!`);
    }
  }
}
