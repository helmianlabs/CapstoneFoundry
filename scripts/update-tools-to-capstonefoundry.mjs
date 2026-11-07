import fs from 'fs';

const envText = fs.readFileSync('.env.local', 'utf8');
const key = envText.match(/ELEVENLABS_API_KEY=(.*)/)[1].trim();

const r = await fetch('https://api.elevenlabs.io/v1/convai/tools', { headers: { 'xi-api-key': key } });
const data = await r.json();

for (const t of data.tools) {
  const url = t.tool_config?.api_schema?.url;
  if (url && url.includes('thinkbuddy-sandy.vercel.app')) {
    const newUrl = url.replace('thinkbuddy-sandy.vercel.app', 'capstonefoundry.vercel.app');
    console.log(`Updating tool ${t.tool_config.name} (${t.id}): ${url} -> ${newUrl}`);
    const updatedConfig = { ...t.tool_config };
    updatedConfig.api_schema.url = newUrl;
    const patchRes = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${t.id}`, {
      method: 'PATCH',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tool_config: updatedConfig }),
    });
    console.log(`Tool ${t.tool_config.name} PATCH status:`, patchRes.status);
    if (!patchRes.ok) {
      console.error(await patchRes.text());
    }
  }
}
console.log('Finished updating tool URLs to capstonefoundry.vercel.app!');
