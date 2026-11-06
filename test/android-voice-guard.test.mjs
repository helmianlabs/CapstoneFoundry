// The Android WebView mic dies in two places the page can fix without
// a new APK:
//
//   1. bgAudio.start() used to skip the silent looping <audio> only when
//      Capacitor.isNativePlatform() was already true at page load. On a
//      WebView where the bridge never arrives, that <audio> still starts
//      on elevenlabs-convai:call and the capture meter stays at 0 while
//      the greeting plays.
//   2. @elevenlabs/client VoiceConversation.startSession opens
//      getUserMedia, then MediaDeviceInput.create opens a second one and
//      the session stops the first tracks. The second open (or the stop)
//      leaves the live track silent. The hold serves one {audio:true}
//      stream to every audio open and swallows track.stop() until the
//      session owns the track.
//
// The functions live in the no-cache index.html document. This file
// evaluates that slice so the test cannot drift from the page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = html.match(/\/\/ cf-android-voice-guard:start([\s\S]*?)\/\/ cf-android-voice-guard:end/);
assert.ok(slice, 'guard slice missing from index.html');

const context = {};
vm.createContext(context);
vm.runInContext(slice[1], context);
const { cfBgAudioSkipReason, cfShouldHoldMic, cfCreateMicHold, cfDirectVoiceWanted, cfAndroidOrCapacitor, cfStockTransportDebug } = context;

const WV = 'Mozilla/5.0 (Linux; Android 16; SM-S948U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36';

test('Android WebView skips keepalive even when Capacitor is absent', () => {
  assert.equal(cfBgAudioSkipReason({ ua: WV, ios: false, native: false, directVoice: true }), 'android-webview');
  assert.equal(cfBgAudioSkipReason({ ua: WV, ios: false, native: false, directVoice: false }), 'android-webview');
});

test('native app and direct voice skip when the UA is not a WebView', () => {
  const chrome = 'Mozilla/5.0 (Linux; Android 16; SM-S948U) AppleWebKit/537.36 Mobile Safari/537.36';
  assert.equal(cfBgAudioSkipReason({ ua: chrome, ios: false, native: true, directVoice: false }), 'native-app');
  assert.equal(cfBgAudioSkipReason({ ua: chrome, ios: false, native: false, directVoice: true }), 'direct-voice');
  assert.equal(cfBgAudioSkipReason({ ua: chrome, ios: false, native: false, directVoice: false }), '');
});

test('iOS skips ahead of the Android checks', () => {
  assert.equal(cfBgAudioSkipReason({ ua: WV, ios: true, native: true, directVoice: true }), 'ios');
});

test('mic hold is Android-only', () => {
  assert.equal(cfShouldHoldMic(WV), true);
  assert.equal(cfShouldHoldMic('Mozilla/5.0 (Windows NT 10.0)'), false);
});

test('a second audio getUserMedia reuses the first stream and preliminary stop is a no-op', async () => {
  const stopped = [];
  let calls = 0;
  function streamFor(tag) {
    const track = { tag, stop() { stopped.push(tag); } };
    return { tag, getAudioTracks: () => [track], getTracks: () => [track] };
  }
  const mediaDevices = {
    getUserMedia(constraints) {
      calls += 1;
      return Promise.resolve(streamFor('open-' + calls + '-' + JSON.stringify(constraints)));
    },
  };
  const hold = cfCreateMicHold(mediaDevices);
  const first = await mediaDevices.getUserMedia({ audio: true });
  const second = await mediaDevices.getUserMedia({
    audio: { voiceIsolation: true, echoCancellation: true, noiseSuppression: true },
  });
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(first.tag, 'open-1-{"audio":true}');
  first.getTracks()[0].stop();
  assert.deepEqual(stopped, []);
  hold.release();
  first.getTracks()[0].stop();
  assert.deepEqual(stopped, ['open-1-{"audio":true}']);
  await mediaDevices.getUserMedia({ audio: true });
  assert.equal(calls, 2);
});

test('video capture is not folded into the shared mic', async () => {
  const kinds = [];
  const mediaDevices = {
    getUserMedia(constraints) {
      kinds.push(constraints);
      return Promise.resolve({ getAudioTracks: () => [] });
    },
  };
  const hold = cfCreateMicHold(mediaDevices);
  await mediaDevices.getUserMedia({ audio: true, video: true });
  await mediaDevices.getUserMedia({ audio: true });
  hold.release();
  assert.equal(kinds.length, 2);
  assert.equal(JSON.stringify(kinds[0]), JSON.stringify({ audio: true, video: true }));
  assert.equal(JSON.stringify(kinds[1]), JSON.stringify({ audio: true }));
});

test('a failed open can be retried and stopHeld releases the hardware', async () => {
  let calls = 0;
  const stopped = [];
  const mediaDevices = {
    getUserMedia() {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('busy'));
      const track = { stop() { stopped.push('released'); } };
      return Promise.resolve({ getAudioTracks: () => [track] });
    },
  };
  const hold = cfCreateMicHold(mediaDevices);
  await assert.rejects(() => mediaDevices.getUserMedia({ audio: true }), /busy/);
  const stream = await mediaDevices.getUserMedia({ audio: true });
  assert.equal(calls, 2);
  stream.getAudioTracks()[0].stop();
  assert.deepEqual(stopped, []);
  hold.stopHeld();
  assert.deepEqual(stopped, ['released']);
});

test('the hosted widget is the default voice surface, including Android WebView', () => {
  assert.equal(typeof cfDirectVoiceWanted, 'function');
  assert.equal(cfDirectVoiceWanted('1'), true);
  assert.equal(cfDirectVoiceWanted('0'), false);
  assert.equal(cfDirectVoiceWanted(null), false);
  assert.equal(cfDirectVoiceWanted(undefined), false);
  assert.equal(cfDirectVoiceWanted(''), false);

  const fn = html.slice(html.indexOf('function directVoiceWanted()'), html.indexOf('function directCallUi'));
  assert.match(fn, /cfDirectVoiceWanted\(forced\)/);
  assert.doesNotMatch(fn, /return[\s\S]*isNativePlatform/);
  assert.doesNotMatch(fn, /return\s+\/Android/);
  assert.match(html, /createElement\('elevenlabs-convai'\)/);
  assert.match(html, /cfg\.connectionType = 'websocket'/);
  assert.match(html, /user_id: uid/);
  assert.match(html, /profile_id: pid/);
  assert.match(html, /https:\/\/elevenlabs\.io\/convai-widget\/index\.js/);
});

test('a Capacitor Android WebView still mounts the widget unless the flag is 1', () => {
  const start = html.indexOf('function directVoiceWanted()');
  const end = html.indexOf('function directCallUi', start);
  const ctx = {
    cfDirectVoiceWanted,
    localStorage: { getItem() { return null; } },
    navigator: { userAgent: WV },
    window: { Capacitor: { isNativePlatform() { return true; } } },
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end) + '\nthis.wanted = directVoiceWanted();', ctx);
  assert.equal(ctx.wanted, false);
  ctx.localStorage = { getItem() { return '1'; } };
  vm.runInContext('this.optIn = directVoiceWanted();', ctx);
  assert.equal(ctx.optIn, true);
  ctx.localStorage = { getItem() { return '0'; } };
  vm.runInContext('this.optOut = directVoiceWanted();', ctx);
  assert.equal(ctx.optOut, false);
});

test('hosted widget defaults to websocket, including Android, unless the stock debug flag is set', () => {
  assert.equal(typeof cfStockTransportDebug, 'function');
  assert.equal(cfStockTransportDebug({ stockFlag: null, search: '' }), false);
  assert.equal(cfStockTransportDebug({ stockFlag: '0', search: '' }), false);
  assert.equal(cfStockTransportDebug({ stockFlag: '1', search: '' }), true);
  assert.equal(cfStockTransportDebug({ stockFlag: null, search: '?transport=stock' }), true);
  assert.equal(cfStockTransportDebug({ stockFlag: null, search: '?mode=default&transport=stock' }), true);
  assert.equal(cfStockTransportDebug({ stockFlag: null, search: '?transport=websocket' }), false);
  assert.equal(cfAndroidOrCapacitor({ ua: WV, native: false }), true);
  assert.equal(cfAndroidOrCapacitor({ ua: 'Mozilla/5.0 (Windows NT 10.0)', native: false }), false);

  const block = html.slice(html.indexOf('── TRANSPORT'), html.indexOf('PER-USER ISOLATION'));
  assert.match(block, /cfStockTransportDebug\(/);
  assert.match(block, /if \(!cfStockTransport\) cfg\.connectionType = 'websocket'/);
  assert.match(block, /thinkinbuddy_stock_transport_v1/);
  assert.doesNotMatch(block, /cfAndroidOrCapacitor\(cfSurface\)/);
  assert.match(html, /function cfUnlockOutputElement/);
  assert.match(html, /function cfAndroidOutputUnlock/);
  assert.match(html, /cfScheduleOutputUnlock\(session\)/);
  assert.match(html, /el\.muted = false/);
  assert.match(html, /el\.volume = 1/);
  assert.match(html, /await el\.play\(\)/);
  assert.match(html, /cfBeacon\('output-unlock'/);
  assert.match(html, /cfBeacon\('call-end'/);
  assert.match(html, /cfNoteHangup\('widget-close'\)/);
  assert.match(html, /cfNoteHangup\('disconnect'\)/);
  assert.match(html, /cfNoteHangup\('pagehide'\)/);
  assert.match(html, /cfg\.onAudio = /);
  assert.match(html, /const skip = pageBgAudioSkipReason\(\)/);
  const direct = html.slice(html.indexOf('directSession = await window.__cfVoice.startSession'), html.indexOf('onConnect: (info) =>'));
  assert.match(direct, /connectionType: 'websocket'/);
});

test('the page skips keepalive at call time and holds the mic around startSession', () => {
  assert.equal(html.includes('const IS_NATIVE_APP'), false);
  assert.match(html, /const skip = pageBgAudioSkipReason\(\)/);
  assert.match(html, /cfBeacon\('bg-audio-skip'/);
  assert.match(html, /cfBeacon\('bg-audio-start'/);
  assert.match(html, /cfCreateMicHold\(navigator\.mediaDevices\)/);
  assert.match(html, /cfBeacon\('voice-build', \{ fix: 'bg-audio-skip\+single-mic' \}\)/);
  assert.match(html, /cfBeacon\(micLive \? 'mic-probe-ok' : 'mic-probe-fail', probe\)/);
});
