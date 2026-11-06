// Physical route file for POST /api/auth/request-reset.
// See api/auth/reset.js for the full story: the generated catch-all
// route matches one segment only, so every multi-segment path the
// web clients call needs a physical file that routes exactly. The
// reset routes originally shared the single api/auth/reset.js shim
// (body-shape dispatch); once the client door in onboarding.js began
// calling the named routes directly, each needed its own file —
// pinned by test/routing.test.mjs. Re-exports the handler that
// owns /api/auth/*.
export { default } from '../../server/handlers/auth.js';
