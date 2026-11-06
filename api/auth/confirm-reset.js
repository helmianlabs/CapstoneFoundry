// Physical route file for POST /api/auth/confirm-reset.
// See api/auth/request-reset.js and api/auth/reset.js: physical
// files route exactly where the generated catch-all cannot, and
// test/routing.test.mjs requires one for every multi-segment /api
// URL the web clients call. Re-exports the handler that owns
// /api/auth/*.
export { default } from '../../server/handlers/auth.js';
