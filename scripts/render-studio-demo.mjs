import fs from 'fs';
import path from 'path';

const API_KEY = 'sk_80b7a4daca3448ca6f4e808a78b1e6f82c9697091f85ea90';
const VOICE_FOUNDER = 'EXAVITQu4vr4xnSDxMaL'; // Sarah (Crisp Executive Founder)
const VOICE_MARK = 'nPczCjzI2devNBz1zQrb';    // Brian (Authoritative Executive Mark)

const outDir = 'E:/CapstoneFoundry/public/audio/demo';
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function generateSpeech(text, voiceId, filename) {
  const filePath = path.join(outDir, filename);
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
    console.log(`Already exists: ${filename}`);
    return;
  }
  console.log(`Generating: ${filename}...`);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8
      }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs error: ${res.status} ${err}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  console.log(`Saved ${filename} (${buffer.length} bytes)`);
}

async function main() {
  // Demo 1
  await generateSpeech(
    "Mark, I want to launch a mobile equipment detailing business next week. What do I actually need to do first?",
    VOICE_FOUNDER,
    "demo1_founder.mp3"
  );
  await generateSpeech(
    "Don't buy expensive equipment yet. Call five commercial fleet managers, pitch weekly maintenance, and lock down two contracts. Once cash is in hand, we buy the trailer.",
    VOICE_MARK,
    "demo1_mark.mp3"
  );

  // Demo 2
  await generateSpeech(
    "Mark, pull our unpaid invoices from last month and draft follow-up reminders.",
    VOICE_FOUNDER,
    "demo2_founder.mp3"
  );
  await generateSpeech(
    "Done. Found four overdue accounts totaling twelve thousand four hundred dollars. Drafted the follow-ups with invoice attachments; check your queue for approval.",
    VOICE_MARK,
    "demo2_mark.mp3"
  );

  // Demo 3
  await generateSpeech(
    "Mark, what did we agree on with the supplier pricing when we talked two weeks ago?",
    VOICE_FOUNDER,
    "demo3_founder.mp3"
  );
  await generateSpeech(
    "We agreed on a fifteen percent volume discount if we hit five hundred units a month, with thirty-day payment terms locked in through December.",
    VOICE_MARK,
    "demo3_mark.mp3"
  );

  console.log('All studio ElevenLabs demo audio files generated successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
