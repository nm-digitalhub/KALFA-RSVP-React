import 'server-only';

import { computeOneTimeKeyHash } from '@/lib/data/console-sdk-auth';

// One-time-key signing for the PUBLIC WIDGET's shared Voximplant identity
// (capability A, revised 12.8 — see console-calls.ts's evaluateWidgetCallCaps
// header for the full research trail on why a shared identity is the design).
//
// Structurally the widget's counterpart to console-sdk-auth.ts, with the one
// difference that actually matters: signOneTimeKeyForAgent resolves WHICH
// identity to sign for from an authenticated session (an agent can only ever
// sign for themselves). A widget visitor has no session — there is exactly
// ONE identity this can ever sign for, fixed by two env vars the owner sets
// once the shared Voximplant user is provisioned (AddUser — an
// account-changing Management API operation, not done by this module or by
// this delegation; see the report for the exact remaining step). Reuses
// computeOneTimeKeyHash UNCHANGED — same MD5-per-protocol function, already
// pinned against a known vector; nothing about the login protocol itself
// differs for a shared identity vs. a per-agent one.
//
// Mirrors KALFA_CONSOLE_SECRET's existing env-var-over-DB-table choice
// (route-inbound.ts, authorize/route.ts): a single static shared secret, not
// per-row state, so a new table would be pure overhead. Absent env vars ⇒
// `not_provisioned`, which the route below turns into the same 503 shape
// route-inbound already uses for "the secret we need isn't configured yet."
//
// USERNAME IS PUBLIC, PASSWORD IS NOT — deliberately two different env-var
// shapes. The login protocol requires requestOneTimeKey (called by the
// BROWSER, before this module ever runs) to name the SAME identity
// loginOneTimeKey will use — the browser has to know the username up front,
// not learn it from this endpoint's response after the fact. A username has
// no confidentiality requirement (agent usernames like `agent_<uuid>`
// aren't secret either — only vox_password is), so it's
// NEXT_PUBLIC_WIDGET_VOX_USERNAME, inlined at build time like
// NEXT_PUBLIC_VAPID_PUBLIC_KEY already is (src/lib/push/web-push.ts). The
// password stays WIDGET_VOX_PASSWORD, server-only, never NEXT_PUBLIC_.

export type WidgetSdkAuthResult =
  | { ok: true; hash: string }
  | { ok: false; reason: 'not_provisioned' };

function requireEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * Sign a one-time key for the shared widget identity. Pure aside from the
 * two env reads — no DB, no per-caller branching (there is nothing to branch
 * on: every caller gets the same identity, by design).
 */
export function signOneTimeKeyForWidget(oneTimeKey: string): WidgetSdkAuthResult {
  const username = requireEnv('NEXT_PUBLIC_WIDGET_VOX_USERNAME');
  const password = requireEnv('WIDGET_VOX_PASSWORD');
  if (!username || !password) return { ok: false, reason: 'not_provisioned' };

  // Defensive: stored short, but strip a domain if one was ever written by
  // hand — same guard as signOneTimeKeyForAgent, same reason (the inner hash
  // MUST see the short form per the login protocol, not the FQDN).
  const shortName = username.split('@')[0];

  return { ok: true, hash: computeOneTimeKeyHash(shortName, password, oneTimeKey) };
}
