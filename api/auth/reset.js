// Physical route file for the password-reset routes:
//   POST /api/auth/reset          (this file — dispatches by body)
//   POST /api/auth/request-reset  (handler route, reached via router)
//   POST /api/auth/confirm-reset  (handler route, reached via router)
//
// Why this file exists: the single-function router (api/[...path].js)
// is correct in code, but in this Vite-framework build Vercel emits
// the catch-all's route as a ONE-segment pattern — /api/<name> reaches
// the router, anything deeper dies at the platform with a plain-text
// NOT_FOUND before any function runs (verified live against the
// store-test preview, 2026-10-23). A physical file routes exactly.
//
// Why ONE file for two routes: the function budget is the binding
// constraint (Hobby: 12). The sibling auth routes each got their own
// shim before this one existed; reset lands both of its routes behind
// this single function instead. The handler sub-routes by URL suffix
// for the named routes, and for THIS endpoint dispatches by body
// shape (a token/newPassword field = confirm-reset, otherwise
// request-reset) — see server/handlers/auth.js. Pinned by
// test/routing.test.mjs.
export { default } from '../../server/handlers/auth.js';
