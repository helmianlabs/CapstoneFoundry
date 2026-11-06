// lib/mailer.js — outbound email for the Capstone Foundry store build.
// Today it sends exactly one thing: the password-reset email for
// lib/accounts.js's reset flow (POST /api/auth/request-reset).
//
// PROVIDER: Resend (https://api.resend.com/emails), called with a
// plain fetch — ZERO new dependencies, the same posture as the rest
// of lib/. The API key is server-side only (RESEND_API_KEY), never
// shipped to the client and never logged.
//
// FAIL-SOFT BY CONTRACT: this module NEVER throws and NEVER blocks
// the reset flow. With no key configured it returns
// { sent: false, reason: 'mailer_not_configured' } — the handler
// answers the same anti-enumeration 200 either way (the person asking
// for a reset must not be able to tell whether the email exists OR
// whether our mailer is up), and the token simply goes unused. A
// provider error or a network failure is likewise reported in the
// return value, never raised.
//
// RESET LINK SHAPE (the client build matches this exactly): the app
// is a single-page shell, so the token rides the URL fragment —
//   <APP_BASE_URL>/#reset=<token>
// Fragments are never sent to a server or written to access logs, and
// the client reads the token out of location.hash on load.

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const DEFAULT_BASE_URL = 'https://thinkbuddy-sandy.vercel.app';
const DEFAULT_FROM = 'Capstone Foundry <support@capstonefoundry.helmian.cloud>';

/** The exact reset link for one raw token (see the header). */
export function buildResetLink(token) {
  const base = process.env.APP_BASE_URL || DEFAULT_BASE_URL;
  return `${base}/#reset=${token}`;
}

/**
 * Email one password reset link.
 * @param {string} toEmail  the account's email (already normalized)
 * @param {string} token    the RAW reset token from
 *   lib/accounts.js mintPasswordResetToken (never a stored hash)
 * @returns {Promise<{ sent: true } | { sent: false, reason: string }>}
 *   Never throws.
 */
export async function sendPasswordResetEmail(toEmail, token) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'mailer_not_configured' };
  if (typeof toEmail !== 'string' || !toEmail || typeof token !== 'string' || !token) {
    return { sent: false, reason: 'invalid_request' };
  }
  const link = buildResetLink(token);
  try {
    const res = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESET_FROM || DEFAULT_FROM,
        to: toEmail,
        subject: 'Reset your Capstone Foundry password',
        text: [
          'Hello,',
          '',
          'We received a request to reset the password for your Capstone Foundry account.',
          'Open this link within 30 minutes to choose a new password:',
          '',
          link,
          '',
          'The link works once. If you did not ask for a password reset,',
          'you can ignore this email — your password has not changed.',
          '',
          '— Capstone Foundry',
        ].join('\n'),
      }),
    });
    if (res && res.ok) return { sent: true };
    return { sent: false, reason: `provider_http_${res?.status ?? 'unknown'}` };
  } catch {
    // Network failure, DNS, a stubbed fetch in tests — the reset flow
    // must not learn about any of it (see the header).
    return { sent: false, reason: 'send_failed' };
  }
}
