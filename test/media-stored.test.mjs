// test/media-stored.test.mjs — gallery "Store in database" feature
// (Troy's order 2026-11-13): the user, on their phone, can send ANY
// gallery item into the Neon database and get it back.
//
// What this pins, following the repo's no-DOM test style:
// Server:
//   - retrieveMedia gains a stored view (category='stored') and the
//     main list excludes stored rows; items carry a `stored` flag.
//   - setMediaStored scopes exactly like setMediaFiled, snapshots text
//     artifacts/documents into media_content, and refuses to half-store
//     when the snapshot fails.
//   - The media-gallery handler routes POST {stored:bool} and the
//     GET stored=1 selector through the same identity resolution.
//   - artifact-view serves documents as well as artifacts and prefers
//     the database snapshot (media_content) over the Blob.
// Client (public/app.html):
//   - A "Database" pill, a store button in BOTH overlays (artifact
//     viewer + media lightbox), a per-card store icon, and a
//     long-press offering the same store/restore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appHtml   = readFileSync(new URL('../public/app.html', import.meta.url), 'utf8');
const mediaMem  = readFileSync(new URL('../lib/mediaMemory.js', import.meta.url), 'utf8');
const handler   = readFileSync(new URL('../server/handlers/media-gallery.js', import.meta.url), 'utf8');
const artView   = readFileSync(new URL('../server/handlers/artifact-view.js', import.meta.url), 'utf8');

test('server: stored is a distinct view in retrieveMedia', () => {
  assert.match(mediaMem, /category = 'stored'/, 'stored view selects category stored');
  assert.match(mediaMem, /NOT IN \('filed', 'test-residue', 'stored'\)/, 'main list excludes stored rows');
  assert.match(mediaMem, /stored: category === 'stored'/, 'items carry a stored flag');
});

test('server: setMediaStored snapshots text kinds and scopes like filing', () => {
  assert.match(mediaMem, /export async function setMediaStored/, 'setMediaStored exists');
  assert.match(mediaMem, /row\.kind === 'artifact' \|\| row\.kind === 'document'/, 'snapshot only for text kinds');
  assert.match(mediaMem, /media_content = \$1/, 'snapshot lands in media_content');
  assert.match(mediaMem, /category = 'stored'/, 'store sets the stored category');
  assert.match(mediaMem, /snapshot failed/, 'a failed snapshot refuses the store instead of half-storing');
  assert.match(mediaMem, /kind = 'artifact'\)/, 'same identity scope shape as setMediaFiled');
});

test('server: handler routes store/restore and the stored view', () => {
  assert.match(handler, /typeof body\.stored === 'boolean'/, 'POST stored branch');
  assert.match(handler, /setMediaStored/, 'POST uses setMediaStored');
  assert.match(handler, /req\.query\?\.stored/, 'GET reads the stored selector');
  assert.match(handler, /filed, stored \}\)/, 'GET passes stored to retrieveMedia');
});

test('server: artifact-view serves documents and prefers the snapshot', () => {
  assert.match(artView, /kind IN \('artifact', 'document'\)/, 'documents served too');
  assert.match(artView, /media_content AS "mediaContent"/, 'snapshot selected');
  assert.match(artView, /let html = snapshot;/, 'snapshot wins over the Blob fetch');
  assert.match(artView, /kind === 'document' \? 'text\/plain/, 'documents served as plain text (markdown)');
});

test('client: Database pill and both overlay store buttons exist', () => {
  assert.match(appHtml, /data-type="database">🗄 Database<\/button>/, 'Database pill');
  assert.match(appHtml, /id="artifactViewerStoreBtn"[^>]*>🗄 Store in database<\/button>/, 'viewer store button');
  assert.match(appHtml, /id="galleryLightboxStore"[^>]*>🗄 Store in database<\/button>/, 'lightbox store button');
  assert.match(appHtml, /'↩ Restore to gallery'/, 'restore label used when opened from Database');
});

test('client: cards carry the store icon and a long-press', () => {
  assert.match(appHtml, /gallery-item-store/, 'per-card store icon class');
  assert.match(appHtml, /item\.stored \? '↩' : '🗄'/, 'icon flips to restore in the Database view');
  assert.match(appHtml, /pointerdown/, 'long-press listens for pointerdown');
  assert.match(appHtml, /\}, 600\);/, 'long-press timer is 600ms');
  assert.match(appHtml, /if \(longPressed\) \{ longPressed = false; return; \}/, 'the click ending a long-press is swallowed');
});

test('client: stored mode drives the stored=1 read and stays distinct from Saved', () => {
  assert.match(appHtml, /params\.set\('stored', '1'\)/, 'stored view read');
  assert.match(appHtml, /galleryStoredMode = true;/, 'database pill enters stored mode');
  assert.match(appHtml, /galleryStoredMode = false;/, 'other pills leave stored mode');
  assert.match(appHtml, /postGalleryState\(\{ id: item\.id, stored: !item\.stored \}\)/, 'store toggle posts stored state');
});
