import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  isPopupRedirect,
  OAUTH_FALLBACK_PATH,
  oauthPopupBridgeHtml,
  OAUTH_POPUP_CHANNEL,
  OAUTH_POPUP_TAG,
} from './oauth-popup-bridge';

// ⚠️ THIS MODULE EMITS A SCRIPT THAT RUNS IN A BROWSER, which puts it in a
// different risk class from everything around it. A value that escapes its
// JSON string does not fail a type check, does not throw, and does not show up
// in a passing suite — it becomes executable code on our own origin, in a tab
// holding a session. Every assertion below guards that boundary.

const ok = { ok: true as const, connectionId: '11111111-2222-4333-8444-555555555555' };
const origin = 'https://beta.example.test';

describe('the bridge document', () => {
  it('sends on BOTH channels — one of them was measured not firing', () => {
    // Two live OAuth runs through n8n on 2026-09-17: the first delivered on
    // BroadcastChannel and postMessage 25ms apart, the second on postMessage
    // alone. Sending one would hang a successful connection until timeout.
    const html = oauthPopupBridgeHtml(ok, origin);
    expect(html).toContain('new BroadcastChannel');
    expect(html).toContain(JSON.stringify(OAUTH_POPUP_CHANNEL));
    expect(html).toContain('opener.postMessage(payload, origin)');
  });

  it('⚠️ decides for ITSELF whether it is a popup, and leaves nobody waiting', () => {
    // THE DEFECT THIS REPLACES. The route used to ask whether the flow had been
    // started from a popup by reading `oauthMode` off the request — a parameter
    // that cannot be there. The callback is called by the PROVIDER and carries
    // `code` and `state`; our flag rode on the start URL and is never echoed
    // back. So the test was always false, and a popup was redirected to
    // /admin/integrations while the editor waiting on it learned nothing until
    // the five-minute timeout. Observed live 2026-09-17.
    //
    // `window.opener` is the one signal that is correct in both cases and
    // cannot be lost in transit — so the page decides, not the server.
    const html = oauthPopupBridgeHtml({ ok: false, reason: 'failed' }, origin);
    expect(html).toContain('window.opener');
    expect(html).toContain('if (!opener)');
    expect(html).toContain(`location.replace(${JSON.stringify(origin + OAUTH_FALLBACK_PATH)})`);
  });

  it('⚠️ reads window.opener inside try/catch — a COOP-severed opener THROWS', () => {
    // Touching `window.opener` is not always safe: a provider that answered with
    // Cross-Origin-Opener-Policy severs the relationship, and the access itself
    // can raise. An unguarded read would abort the script before either channel
    // fired and before the fallback redirect — the window would simply sit on
    // "finishing...".
    const html = oauthPopupBridgeHtml(ok, origin);
    expect(html).toMatch(/try \{ opener = window\.opener; \} catch/);
  });

  it('⚠️ addresses postMessage to our origin, never to "*"', () => {
    // `*` would hand the connection id to any page that managed to become our
    // opener. The id is not a secret, but naming the origin costs nothing and
    // the next field added here might be.
    const html = oauthPopupBridgeHtml(ok, origin);
    expect(html).toContain('postMessage(payload, origin)');
    expect(html).toContain(JSON.stringify(origin));
    expect(html).not.toMatch(/postMessage\([^)]*,\s*['"]\*['"]\)/);
  });

  it('carries the id and the tag, and no token of any kind', () => {
    const html = oauthPopupBridgeHtml(ok, origin);
    expect(html).toContain(ok.connectionId);
    expect(html).toContain(OAUTH_POPUP_TAG);
    expect(html).not.toMatch(/access_token|refresh_token|client_secret|vault/i);
  });

  it('⚠️ escapes < and > so a value cannot close the script block', () => {
    // `</script>` inside a JSON string ends the block in an HTML parser even
    // though it is still inside quotes as far as JavaScript is concerned. The
    // rest of the document would then be parsed as markup.
    const html = oauthPopupBridgeHtml(
      { ok: false, reason: '</script><img src=x onerror=alert(1)>' },
      origin,
    );
    expect(html).not.toContain('</script><img');
    expect(html).toContain('\\u003c');
    // exactly one real closing tag: the one this module wrote
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('⚠️ escapes U+2028 / U+2029, which terminate a line in JavaScript', () => {
    // They are legal inside a JSON string but NOT inside a JavaScript string
    // literal, so an unescaped one turns the rest of the statement into a
    // syntax error and the popup reports nothing at all. This module broke on
    // exactly that character while it was being written.
    const html = oauthPopupBridgeHtml({ ok: false, reason: 'a b c' }, origin);
    expect(html).not.toContain(' ');
    expect(html).not.toContain(' ');
    expect(html).toContain('\\u2028');
  });

  it('is RTL Hebrew and tells a person what to do when close() is refused', () => {
    // A window the browser did not treat as script-opened refuses close(), and
    // a COOP-severed popup never reached its opener at all. Both end on this
    // page, so it has to read as something rather than as a blank tab.
    const html = oauthPopupBridgeHtml(ok, origin);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('window.close()');
    expect(html).toMatch(/אפשר לסגור את החלון/);
  });
});

describe('reading the flag off a stored redirect', () => {
  it('finds it where the control puts it', () => {
    expect(isPopupRedirect('/admin/workflows/abc?oauthMode=popup')).toBe(true);
  });

  it('⚠️ is false for the ordinary full-page flow, which must still get a 302', () => {
    expect(isPopupRedirect('/admin/workflows/abc')).toBe(false);
    expect(isPopupRedirect('/admin/integrations')).toBe(false);
  });

  it('⚠️ refuses a near-miss rather than guessing', () => {
    // A redirect that merely mentions the word must not switch the response
    // type: the ordinary flow would then get a page that talks to an opener it
    // does not have, and the browser would sit on it forever.
    expect(isPopupRedirect('/admin/workflows/abc?oauthMode=popupx')).toBe(false);
    expect(isPopupRedirect('/admin/workflows/popup')).toBe(false);
    expect(isPopupRedirect('/admin/workflows/abc?mode=popup')).toBe(false);
  });

  it('survives other parameters travelling alongside it', () => {
    expect(isPopupRedirect('/admin/workflows/abc?tab=runs&oauthMode=popup')).toBe(true);
  });
});
