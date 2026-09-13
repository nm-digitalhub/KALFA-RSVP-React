import { isPrivateOrLocalHost } from '@/lib/net/private-host';

// Whether a workflow may POST to a URL an admin typed into the editor.
//
// UNLIKE `validateRecordingUrl`, THIS ONE IS ABOUT A REQUEST WE ACTUALLY MAKE.
// That validator decides whether a string is safe to STORE and says so in its
// own header ("We NEVER fetch it — no SSRF surface here"). Here the server does
// fetch, from inside the pg-boss worker, so this is the real SSRF surface and
// the rules are stricter in the two ways that matter:
//
//   * https only — a webhook carrying guest data must not go out in clear text.
//   * no allowlist. The recording validator can insist on one host because there
//     IS one; an outgoing webhook points wherever the owner's other system
//     lives, and an allowlist nobody can populate is a feature that never ships.
//     So the defence is the deny-list of private space plus https, and the
//     REVIEW is the audit row the handler writes.
//
// ⚠️ WHAT THIS DOES NOT STOP, stated because the module below is where someone
// will look for it. The check is on the STRING. A public hostname that RESOLVES
// to 127.0.0.1 or 169.254.169.254 — a DNS rebind, or an internal name published
// on a public zone — passes here and the worker will connect to it. Closing that
// needs resolve-then-pin-the-socket, which Node's stock `fetch` does not expose.
// It is a residual risk accepted on the grounds that the URL is typed by a
// platform admin with `manage_settings`, not by a guest, and every call is
// audited. It is NOT a risk this function pretends to cover.

export type WebhookUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: WebhookUrlRejection };

export type WebhookUrlRejection =
  | 'empty'
  | 'unparseable'
  | 'not_https'
  | 'has_credentials'
  | 'private_host';

/** Hebrew for each rejection, so the editor can say which rule was broken. */
export const WEBHOOK_URL_REJECTION_LABELS: Record<WebhookUrlRejection, string> = {
  empty: 'לא הוזנה כתובת',
  unparseable: 'הכתובת אינה תקינה',
  not_https: 'נדרשת כתובת https',
  has_credentials: 'אין להטמיע שם משתמש או סיסמה בכתובת',
  private_host: 'לא ניתן לפנות לכתובת פנימית או לכתובת IP',
};

export function validateWebhookUrl(raw: string): WebhookUrlResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  if (parsed.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  // `https://user:pass@host/` — credentials in a URL end up in logs and in the
  // audit row. Refused rather than stripped: silently dropping half of what
  // someone typed is how a webhook authenticates as nobody and nobody notices.
  if (parsed.username || parsed.password) return { ok: false, reason: 'has_credentials' };
  if (isPrivateOrLocalHost(parsed.hostname)) return { ok: false, reason: 'private_host' };

  return { ok: true, url: parsed.toString() };
}
