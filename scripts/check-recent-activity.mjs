import fs from 'node:fs';
import pg from 'pg';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const key = envText.match(/ELEVENLABS_API_KEY=(.*)/)[1].trim();
let raw = (envText.match(/DATABASE_URL_MEMORY=(.*)/) || envText.match(/DATABASE_URL=(.*)/))[1].trim();
if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
const dbUrl = raw;
const agentId = 'agent_9101m6kwm1sqe0ctz33pn1q7p07w';

async function check() {
  console.log('--- 1. CHECK ELEVENLABS CONVERSATIONS ---');
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${agentId}&page_size=3`, {
    headers: { 'xi-api-key': key },
  });
  const data = await res.json();
  console.log('Conversations count:', data.conversations?.length);
  if (data.conversations && data.conversations.length > 0) {
    const latest = data.conversations[0];
    console.log('Latest conversation ID:', latest.conversation_id);
    console.log('Status:', latest.status);
    console.log('Start time:', new Date(latest.start_time_unix_secs * 1000).toISOString());
    console.log('Message count:', latest.message_count);
    
    // Fetch full detail of latest conversation
    const detailRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${latest.conversation_id}`, {
      headers: { 'xi-api-key': key },
    });
    const detail = await detailRes.json();
    console.log('Call detail transcript:');
    for (const msg of detail.transcript || []) {
      console.log(`[${msg.role}] ${msg.message}`);
    }
  }

  console.log('\n--- 2. CHECK NEON HELMION_RELAY TABLE ---');
  const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  const relayRows = await pool.query('SELECT * FROM helmion_relay ORDER BY id DESC LIMIT 5');
  console.log('Recent relay rows:');
  for (const r of relayRows.rows) {
    console.log(`ID ${r.id} | [${r.channel}] ${r.role} at ${r.at}: ${r.body?.slice(0, 80)}`);
  }
  await pool.end();
}

check().catch(console.error);
