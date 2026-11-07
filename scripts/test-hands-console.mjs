import puppeteer from 'puppeteer-core';
import path from 'path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function check() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  const url = 'file:///' + path.resolve('E:/CapstoneFoundry/dist/index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle0' });

  await page.evaluate(() => {
    if (typeof window.runHandsDemo === 'function') {
      console.log('Calling window.runHandsDemo()...');
      window.runHandsDemo();
    } else {
      console.log('window.runHandsDemo is NOT a function!');
    }
  });

  await new Promise(r => setTimeout(r, 4500));
  const lines = await page.evaluate(() => {
    const el = document.getElementById('termBody');
    return el ? el.innerText : 'NO TERMBODY';
  });
  console.log('Terminal Content:\n', lines);
  await browser.close();
}
check().catch(console.error);
