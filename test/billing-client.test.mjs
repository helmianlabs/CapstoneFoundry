// test/billing-client.test.mjs — the anti-steering guard in
// public/billing.js (billing/grants bite, Play compliance audit
// §11.3). The Android app is the same website inside a Capacitor
// shell; inside the shell, subscriptions may be offered ONLY through
// the Purchases plugin (Google Play Billing) — a web-checkout entry
// point rendered in-shell would violate Play's payments policy. These
// tests pin the guard: webCheckoutAllowed() is false exactly when the
// page runs inside the shell, true on the plain web, and the native
// purchase path stays available in-shell.
//
// Pure: window is stubbed per test; no network, no SDK, no provider.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { isAppShell, webCheckoutAllowed, configureBilling, getCustomerInfo } =
  await import('../public/billing.js');

afterEach(() => { delete globalThis.window; });

describe('isAppShell / webCheckoutAllowed', () => {
  test('no window at all (server/test env): not a shell, web checkout allowed', () => {
    delete globalThis.window;
    assert.equal(isAppShell(), false);
    assert.equal(webCheckoutAllowed(), true);
  });

  test('plain web page (no Capacitor bridge): web checkout allowed', () => {
    globalThis.window = {};
    assert.equal(isAppShell(), false);
    assert.equal(webCheckoutAllowed(), true);
  });

  test('native shell (Capacitor reports a native platform): web checkout suppressed', () => {
    globalThis.window = {
      Capacitor: { isNativePlatform: () => true, Plugins: { Purchases: {} } },
    };
    assert.equal(isAppShell(), true);
    assert.equal(webCheckoutAllowed(), false);
  });

  test('Capacitor bridge on a web platform: not a shell, web checkout allowed', () => {
    globalThis.window = { Capacitor: { isNativePlatform: () => false, Plugins: {} } };
    assert.equal(isAppShell(), false);
    assert.equal(webCheckoutAllowed(), true);
  });

  test('bridge with plugins but no isNativePlatform counts as shell', () => {
    globalThis.window = { Capacitor: { Plugins: { Purchases: {} } } };
    assert.equal(isAppShell(), true);
    assert.equal(webCheckoutAllowed(), false);
  });
});

describe('in-shell purchase path is the Purchases plugin', () => {
  test('configureBilling inside the shell logs the tenant into the plugin', async () => {
    const calls = [];
    globalThis.window = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          Purchases: {
            logIn: async (arg) => { calls.push(['logIn', arg]); return {}; },
            getCustomerInfo: async () => ({ customerInfo: { entitlements: { active: {} } } }),
          },
        },
      },
    };
    const res = await configureBilling('tenant-x');
    assert.deepEqual(res, { available: true, ok: true });
    assert.deepEqual(calls, [['logIn', { appUserID: 'tenant-x' }]]);
    // Customer info also comes from the store plugin — the in-shell surface.
    const info = await getCustomerInfo();
    assert.equal(info.available, true);
    assert.ok(info.customerInfo);
  });

  test('on the plain web there is no plugin: billing reports unavailable, web checkout is the path', async () => {
    globalThis.window = {};
    const res = await configureBilling('tenant-x');
    assert.deepEqual(res, { available: false });
    assert.equal(webCheckoutAllowed(), true);
  });
});
