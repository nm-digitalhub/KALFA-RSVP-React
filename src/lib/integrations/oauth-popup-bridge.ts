import 'server-only';

/**
 * The page the OAuth callback renders when the flow was started from a popup.
 *
 * ⚠️ WHY A PAGE AND NOT A REDIRECT. The ordinary callback answers with a 302 to
 * `/admin/workflows/<id>`, which is correct when the flow owns the whole tab:
 * the editor reloads and reads the new connection out of the fresh server
 * render. It is wrong when the flow runs in a popup, because there is no editor
 * in that window to return to — the editor is the OPENER, still mounted, still
 * holding every unsaved change on the canvas. Redirecting the popup would leave
 * a stray tab showing an editor nobody asked for, and tell the real one nothing.
 *
 * So the popup's last act is to speak to its opener and close itself.
 *
 * ── BOTH CHANNELS, ALWAYS. THIS IS MEASURED, NOT DEFENSIVE. ────────────────
 *
 * `BroadcastChannel` is the obvious choice for us: the popup and the editor are
 * the same origin, so it should simply work, and n8n's own comment calls
 * `postMessage` the "cross-origin embed fallback".
 *
 * It is not a fallback. Instrumenting n8n's live product through two complete
 * OAuth round trips on 2026-09-17 measured:
 *
 *   run 1 — BroadcastChannel at +208,114ms, postMessage at +208,139ms (both)
 *   run 2 — postMessage only. BroadcastChannel never fired.
 *
 * Same browser, same origin, same code path, minutes apart. Whatever caused
 * run 2 — a bfcache'd channel, a throttled background tab on mobile — a
 * listener on one channel alone would have hung until the timeout and reported
 * a failure to a user whose account had connected perfectly. So both are sent,
 * and the listener settles on whichever arrives first.
 *
 * ── WHAT TRAVELS ──────────────────────────────────────────────────────────
 *
 * The connection id and nothing else. It is a uuid the opener is about to
 * select; it is not a secret, and the token it points at never leaves the
 * server. `postMessage` is addressed to an explicit origin rather than `*`, so
 * a page that manages to become our opener cannot read even that.
 */

/**
 * Where a window with no opener is sent instead of waiting forever.
 *
 * The same destination the full-page flow uses, so the two paths agree. It is a
 * path rather than a URL because the origin is supplied by the caller — the
 * bridge never invents one.
 */
export const OAUTH_FALLBACK_PATH = '/admin/integrations?oauth=failed';

export type OAuthPopupOutcome =
  | { ok: true; connectionId: string }
  | { ok: false; reason: string };

// ⚠️ RE-EXPORTED, NEVER REDECLARED. The listener is a client component and
// cannot import this `server-only` module, so the strings themselves live in
// `oauth-popup-constants.ts`. Copying them here would be two sources for one
// wire protocol.
export {
  OAUTH_POPUP_CHANNEL,
  OAUTH_POPUP_PARAM,
  OAUTH_POPUP_TAG,
  OAUTH_POPUP_VALUE,
} from './oauth-popup-constants';

import {
  OAUTH_POPUP_CHANNEL,
  OAUTH_POPUP_PARAM,
  OAUTH_POPUP_TAG,
  OAUTH_POPUP_VALUE,
} from './oauth-popup-constants';

/**
 * A self-closing HTML document that reports `outcome` to its opener.
 *
 * ⚠️ EVERY VALUE IS JSON-SERIALIZED INTO A SCRIPT, so it must be escaped for
 * that context. `</script>` inside a string would end the block early, and `<!--`
 * opens an HTML comment that swallows the rest. `connectionId` is a uuid from
 * our own database and `reason` is a constant, so neither can contain them
 * today — the escaping is here because the next value someone adds might.
 */
export function oauthPopupBridgeHtml(
  outcome: OAuthPopupOutcome,
  openerOrigin: string,
): string {
  const payload = safeJson({ tag: OAUTH_POPUP_TAG, ...outcome });
  const origin = safeJson(openerOrigin);
  const fallback = safeJson(`${openerOrigin}${OAUTH_FALLBACK_PATH}`);

  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>סיום חיבור</title>
<meta name="robots" content="noindex">
<style>
  body{margin:0;display:grid;place-items:center;min-height:100dvh;
       font:14px/1.5 system-ui,sans-serif;color:#444;background:#fff}
</style></head>
<body>
<p id="m">מסיים את החיבור…</p>
<script>
(function () {
  var payload = ${payload};
  var origin = ${origin};

  // THE PAGE DECIDES WHAT IT IS, because the server cannot. The callback is
  // called by the provider and carries only code and state, so any flag we put
  // on the START url is gone by then. On the success path the server still has
  // the stored redirect_to to consult; a failure may be the very inability to
  // read it. window.opener is the one signal present in both cases.
  //
  // No opener means this window IS the flow: nobody is listening, and a page
  // reading "finishing..." forever would be the worst of both. Send the browser
  // where the full-page flow would have gone.
  // (Comments in here carry no backticks on purpose - this whole document is a
  // template literal, and one backtick ends it.)
  var opener = null;
  try { opener = window.opener; } catch (e) {}   // COOP-severed opener throws
  if (!opener) {
    location.replace(${fallback});
    return;
  }

  // Both channels. See the note in oauth-popup-bridge.ts — one of them was
  // measured silently not firing in a real run.
  try { var c = new BroadcastChannel(${safeJson(OAUTH_POPUP_CHANNEL)});
        c.postMessage(payload); c.close(); } catch (e) {}
  try { opener.postMessage(payload, origin); } catch (e) {}

  // ⚠️ CLOSING IS NOT GUARANTEED. A window the browser did not consider
  // script-opened refuses close(), and a provider that sent
  // Cross-Origin-Opener-Policy severs the opener so the message above went
  // nowhere. Both end here, with a page a person can read and close, rather
  // than a blank tab that looks like a crash.
  setTimeout(function () {
    try { window.close(); } catch (e) {}
    document.getElementById('m').textContent = payload.ok
      ? 'החשבון חובר. אפשר לסגור את החלון ולחזור לעורך.'
      : 'החיבור לא הושלם. סגרו את החלון ונסו שוב.';
  }, 120);
})();
</script>
</body></html>`;
}

/** JSON that is safe to embed inside a `<script>` block. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    // ⚠️ WRITTEN AS ESCAPES, NOT AS THEMSELVES. U+2028 and U+2029 ARE line
    // terminators in JavaScript, so a regex literal containing one verbatim is
    // unterminated and the file does not parse — which is exactly what happened
    // the first time this was written.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Whether a stored redirect path asked for the popup bridge.
 *
 * ⚠️ THE FLAG RIDES ON `redirect_to` RATHER THAN A COLUMN OF ITS OWN, and that
 * is a deliberate trade. A column would need a migration, which only the owner
 * can apply, to carry one boolean — while `resolveAppRedirectPath` already
 * returns `pathname + search` (url.ts:127) and the value was already sanitised
 * to a path on this app before it was stored. So the flag inherits the same
 * validation as the destination it travels with, and costs no schema change.
 */
export function isPopupRedirect(redirectTo: string): boolean {
  const query = redirectTo.indexOf('?');
  if (query < 0) return false;
  return (
    new URLSearchParams(redirectTo.slice(query + 1)).get(OAUTH_POPUP_PARAM) ===
    OAUTH_POPUP_VALUE
  );
}
