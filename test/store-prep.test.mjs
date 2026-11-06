// test/store-prep.test.mjs — store-prep bite (iOS platform + listings).
// STATIC checks only: this environment has no Xcode and no iOS build
// was run. What these tests prove: the Capacitor config the CLI itself
// parsed (ios/App/App/capacitor.config.json is written BY
// `npx cap add ios` from capacitor.config.ts) carries the store
// identity — appId com.capstonefoundry.app, appName Capstone Foundry,
// live server hostname thinkbuddy-sandy.vercel.app — the iOS platform
// dependency is on the same major line as Android, and the generated
// Info.plist carries the microphone usage string for the one capture
// feature the code actually uses (voice) and NO camera/photo strings
// (no code path calls the Camera plugin or a photo picker — claiming
// them would misstate the app's access).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('capacitor.config.ts carries the store identity and the live hostname', () => {
  const src = read('capacitor.config.ts');
  assert.ok(src.includes("appId: 'com.capstonefoundry.app'"));
  assert.ok(src.includes("appName: 'Capstone Foundry'"));
  assert.ok(src.includes("url: 'https://capstonefoundry.vercel.app'"));
  // The dead hostname the audit flagged must not be the server URL.
  assert.ok(!src.includes('thinkinbuddy.vercel.app'));
});

test('the CLI-parsed iOS config (capacitor.config.json) parses and matches', () => {
  const path = new URL('../ios/App/App/capacitor.config.json', import.meta.url);
  assert.ok(existsSync(path), 'ios platform scaffold exists (npx cap add ios)');
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(cfg.appId, 'com.capstonefoundry.app');
  assert.equal(cfg.appName, 'Capstone Foundry');
  assert.equal(cfg.server.url, 'https://capstonefoundry.vercel.app');
});

test('the Xcode project carries the same bundle id', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.ok(pbx.includes('PRODUCT_BUNDLE_IDENTIFIER = com.capstonefoundry.app;'));
});

test('@capacitor/ios is a dependency on the same major line as @capacitor/android', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['@capacitor/ios'], 'ios dependency present');
  const major = (range) => {
    const m = /(\d+)\./.exec(range || '');
    return m && m[1];
  };
  assert.ok(major(pkg.dependencies['@capacitor/ios']), 'ios range carries a major version');
  assert.equal(major(pkg.dependencies['@capacitor/ios']), major(pkg.dependencies['@capacitor/android']),
    'ios and android Capacitor majors must stay on the same line');
  assert.ok(pkg.dependencies['@revenuecat/purchases-capacitor'], 'RevenueCat plugin present');
});

test('Info.plist has the microphone usage string, character for character', () => {
  const plist = read('ios/App/App/Info.plist');
  assert.ok(plist.includes('<key>NSMicrophoneUsageDescription</key>'));
  assert.ok(plist.includes('<string>Capstone Foundry listens so you can talk to your buddy hands-free.</string>'));
});

test('Info.plist claims NO camera or photo-library access (the code never uses them)', () => {
  const plist = read('ios/App/App/Info.plist');
  assert.ok(!plist.includes('NSCameraUsageDescription'));
  assert.ok(!plist.includes('NSPhotoLibraryUsageDescription'));
  assert.ok(!plist.includes('NSPhotoLibraryAddUsageDescription'));
});
