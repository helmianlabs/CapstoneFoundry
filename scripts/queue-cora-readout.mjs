import fs from 'fs';
import path from 'path';

const queueDir = path.join(process.env.LOCALAPPDATA, 'Helmion', 'speak-queue');
if (!fs.existsSync(queueDir)) {
  fs.mkdirSync(queueDir, { recursive: true });
}

const sections = [
  `Troy, reading everything through Cora voice now. Primary Source Verification and Production Smoke Test: HTTP Status: 200 OK on https://www.capstonefoundry.cloud, running on Vercel Production Deployment BswBTZisKa7751xjhZbExiY2KvAQ. Git commit b7f6d105 is pushed to origin main. Title verified: Capstone Foundry — Autonomous Executive AI Pair Programmer.`,

  `Key Upgrades Live in Production: First, the Website Layout and Companion Widget Fix. The root cause of overlap was the floating companion dialog fixed at the bottom right, which was covering the Helmian Spoke twenty-nine dollar and ninety-nine cent tier and the footer legal links. The remediation is active: Mark companion now starts minimized by default as a compact fifty-six pixel floating badge pill with your headshot, live status dot, and expand chevron. When minimized, its internal content body and footer are completely hidden, guaranteeing zero overlap on the pricing cards or footer links. We also increased the pricing section bottom padding to one hundred forty pixels and centered the pricing grid with a clean eleven hundred pixel max width.`,

  `Second, the Interactive Helmion Hands Live Workbench and 3D Constellation directly below Capabilities on Capstone Foundry dot cloud: A sixty frames per second background 3D motion graphics canvas renders a neural constellation with mouse-reactive physics and energy data packets traveling between nodes, illustrating the Phone to Cloud to Local Spoke relay. Above it sits the glowing cinematic neon tagline with smooth pulse animation: What are you going to discover next? Below the tagline is the interactive split-screen workbench with three scenario tabs: Heavy Hauling Landing Page, Mobile Dispatch Viewport, and Invoices and Approvals Relay.`,

  `When you click Run Live Voice Demo, synchronized studio audio plays: Founder asks: Hey Mark, can you build me a landing page for our equipment hauling service? Mark replies: Spoke connected to pc-troy. Scaffolding responsive layout, wiring the live freight calculator, and launching the preview now. The left terminal HUD streams real-time execution commands step by step: Voice In, Whisper STT, Agent Intent, Hands mkdir, Hands write file, Vite build, and Hot Reload. The right viewport window renders the live interactive Apex Heavy Equipment Hauling landing page with an Instant Freight Rate Calculator, live weight slider, dynamic mileage rates, and working dispatch hold button. Beneath the workbench are the three architecture pillars: Natural Voice Intent, Encrypted Spoke Relay into pc-troy, and Tangible Running Software.`,

  `Store Assets and Visual Synchronization: The Store Icon is the Roman limestone C with engraved Capstone and Foundry, synced across the Google Play Store bundle, Web PWA icon, and Android mipmaps. The Store Feature Graphic is the one thousand twenty-four by five hundred banner featuring your executive headshot with live spoke indicator rings. And the thirty-second store preview video is pre-recorded with your real photo at docs store videos app preview thirty seconds dot mp4.`,

  `Regarding Muse: I sent high-priority dispatch message number 127 to Muse through Scribe asking Muse to describe the complete record of the Capstone Foundry landing page design, what you originally designed, where the design files are stored, and the exact specification from the records. In Scribe memory, we also found record forty-nine thousand three hundred eighty-one where Claude noted that you asked for the Capstone Foundry landing page with the tagline Discover what's next, and we located the thinking-partner-landing dot html page in the repository featuring warm limestone parchment, serif typography, and the interactive thinking partner question chips.`
];

sections.forEach((sec, idx) => {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const filename = `${timestamp}-${idx + 1}-cora.txt`;
  fs.writeFileSync(path.join(queueDir, filename), sec, 'utf-8');
  console.log(`Queued section ${idx + 1} (${sec.length} chars) -> ${filename}`);
});

console.log('All sections queued for Cora voice playback!');
