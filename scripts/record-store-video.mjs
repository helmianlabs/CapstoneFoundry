import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'https://capstonefoundry.cloud/app';
const OUT_DIR = path.resolve('docs/store/videos');
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_VIDEO = path.join(OUT_DIR, 'app_preview_30s.mp4');

async function recordVideo() {
  console.log('🎬 Starting 30-Second Store Preview Video Recording...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--hide-scrollbars',
      '--window-size=1080,1920'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: 1080,
    height: 1920,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });

  console.log('Navigating to app...');
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));

  // Spawn ffmpeg to encode incoming JPEG frames into a high quality MP4
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-r', '30',
    '-i', '-',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '20',
    OUT_VIDEO
  ]);

  ffmpeg.stderr.on('data', (d) => {
    // suppress verbose output, print errors if any
    const str = d.toString();
    if (str.includes('Error')) console.error('ffmpeg:', str);
  });

  const client = await page.target().createCDPSession();
  let frameCount = 0;

  client.on('Page.screencastFrame', async ({ data, sessionId }) => {
    try {
      const buffer = Buffer.from(data, 'base64');
      ffmpeg.stdin.write(buffer);
      frameCount++;
      await client.send('Page.screencastFrameAck', { sessionId });
    } catch (e) {}
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    maxWidth: 1080,
    maxHeight: 1920,
    everyNthFrame: 1
  });

  console.log('Recording active (30s simulation)...');

  // Walkthrough action timeline (30 seconds total)
  // 0s - 5s: Voice hero surface with Mark avatar
  await new Promise(r => setTimeout(r, 5000));

  // 5s - 10s: Tap settings pill to show executive config & models
  try {
    await page.click('.settings-pill');
  } catch (e) {}
  await new Promise(r => setTimeout(r, 5000));

  // 10s - 15s: Show memory bank tab
  try {
    await page.evaluate(() => {
      const btn = document.querySelector('.settings-panel .tabs button[data-tab="audio"]');
      if (btn) btn.click();
    });
  } catch (e) {}
  await new Promise(r => setTimeout(r, 5000));

  // 15s - 20s: Close panel and view active voice orb
  try {
    await page.evaluate(() => {
      const close = document.querySelector('.settings-panel .row button');
      if (close) close.click();
    });
  } catch (e) {}
  await new Promise(r => setTimeout(r, 5000));

  // 20s - 25s: Visit executive landing architecture view
  await page.goto('https://capstonefoundry.cloud', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 5000));

  // 25s - 30s: Scroll to system architecture diagram
  await page.evaluate(() => {
    window.scrollBy({ top: 800, behavior: 'smooth' });
  });
  await new Promise(r => setTimeout(r, 5000));

  await client.send('Page.stopScreencast');
  ffmpeg.stdin.end();

  await new Promise((resolve) => ffmpeg.on('close', resolve));
  await browser.close();

  console.log(`✅ Recording complete! Captured ${frameCount} frames.`);
  console.log(`Saved preview video to: ${OUT_VIDEO}`);
}

recordVideo().catch(err => {
  console.error('Fatal video recording error:', err);
  process.exit(1);
});
