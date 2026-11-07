import fs from 'fs';

const path = 'lib/personality.js';
let content = fs.readFileSync(path, 'utf8');

const oldTools = `- search_web: news, weather, prices, current events, anything time-sensitive
- browse_url: visit and read a specific website
- generate_image: draw or visualize anything (great for visual learners). Default aspect is PORTRAIT (fills the phone screen). Pass aspect='square' or aspect='landscape' ONLY if the user explicitly asks for that shape, or the content clearly needs it (e.g. a landscape photo of a beach).
- save_memory: when the user shares personal info (name, location, family, projects, goals, codes) call this immediately with key + value, silently mid-conversation. The key is the name of the fact ("Capstone canary code"); the value is the fact itself ("BlueSky42").
- recall_memory: look up a saved fact mid-call — a name, a code, a project, a preference, a past detail. Pass a short query in your own words (for example "Capstone canary code"). Use it silently, without announcing the lookup.
- set_alarm: save an alarm or reminder for the user's phone. Use whenever the user says "remind me", "set an alarm", "wake me up", "alert me when", "set a timer", or anything scheduling-related. Parameters: title (short label), schedule (ISO-8601 datetime OR relative like "+30m" / "+2h" / "+1d"), body (optional extra note). The tool SAVES the reminder on the server; the phone app schedules it on the device. Confirm back what time you saved it for — say "saved", never claim it is set on the phone.`;

const newTools = `- search_web: news, weather, prices, current events, anything time-sensitive
- browse_url: visit and read a specific website
- generate_image: draw or visualize anything (great for visual learners). Default aspect is PORTRAIT (fills the phone screen). Pass aspect='square' or aspect='landscape' ONLY if the user explicitly asks for that shape, or the content clearly needs it (e.g. a landscape photo of a beach).
- generate_video_runway: generate a dynamic video clip via Runway Gen-3/HeyGen whenever the user asks for a video, motion clip, or animation.
- generate_3d_character: create a 3D character, creature, avatar, or 3D asset file (GLB) via Meshy whenever the user asks for a 3D model, 3D character, or game mesh.
- export_document: export a structured document, lesson, action plan, proposal, or study guide to a permanent file (Vercel Blob, Neon documents table, and Google Docs/Drive). Use whenever the user asks to export a document, save a doc/PDF, write up notes, or make a tangible plan. Parameters: title, category, content (full markdown text).
- save_memory: when the user shares personal info (name, location, family, projects, goals, codes) call this immediately with key + value, silently mid-conversation. The key is the name of the fact ("Capstone canary code"); the value is the fact itself ("BlueSky42").
- recall_memory: look up a saved fact mid-call — a name, a code, a project, a preference, a past detail. Pass a short query in your own words (for example "Capstone canary code"). Use it silently, without announcing the lookup.
- save_task_for_clyde: queue an engineering or autonomous code task for Clyde.
- set_alarm: save an alarm or reminder for the user's phone. Use whenever the user says "remind me", "set an alarm", "wake me up", "alert me when", "set a timer", or anything scheduling-related. Parameters: title (short label), schedule (ISO-8601 datetime OR relative like "+30m" / "+2h" / "+1d"), body (optional extra note). The tool SAVES the reminder on the server; the phone app schedules it on the device. Confirm back what time you saved it for — say "saved", never claim it is set on the phone.`;

const normalized = content.replace(/\r\n/g, '\n');
if (!normalized.includes(oldTools)) {
  console.error('Target oldTools not found in normalized content!');
  process.exit(1);
}

const updated = normalized.replace(oldTools, newTools);
fs.writeFileSync(path, updated, 'utf8');
console.log('Successfully updated toolsBlock in lib/personality.js');
