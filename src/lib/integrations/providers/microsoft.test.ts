import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { MICROSOFT_MAIL_CAPABILITY, microsoftProvider } from './microsoft';

// The Microsoft provider definition, pinned field by field.
//
// ⚠️ EVERY VALUE HERE IS A DECISION THAT FAILS SILENTLY WHEN DROPPED. None of it
// throws, none of it type-errors, and the whole suite stays green: a missing
// `prompt` connects the wrong mailbox, a missing `scopeResources` refuses every
// send, a missing `offline_access` dies at the first token expiry. So each one is
// asserted with the reason it exists.

describe('what this provider declares to Microsoft', () => {
  it('⚠️ forces the account chooser — without it the second mailbox IS the first', () => {
    // Microsoft reuses the browser's signed-in account and shows no chooser. An
    // operator connecting a second account silently gets the first back: no
    // prompt, no error, and the connection list fills with duplicates of one
    // mailbox. n8n ships the same parameter as a HIDDEN credential field
    // (`authQueryParameters`), i.e. not something a user can switch off.
    expect(microsoftProvider.oauth.authorizationParams).toEqual({ prompt: 'select_account' });
  });

  it('does NOT restate response_mode — openid-client owns that default', () => {
    // n8n's value is `response_mode=query&prompt=select_account`. The code flow
    // already defaults to `query`; repeating it would be a second source for a
    // value the library sets, and the two could drift.
    const params: Record<string, string> = microsoftProvider.oauth.authorizationParams ?? {};
    expect(params.response_mode).toBeUndefined();
  });

  it('⚠️ asks for offline_access, or the connection dies at the first expiry', () => {
    // Microsoft returns a refresh token ONLY when this scope was requested.
    expect(microsoftProvider.oauth.authorizationScopes).toContain('offline_access');
  });

  it('⚠️ asks for openid AND profile, or every connection is called "Microsoft 365"', () => {
    // These two are what make the token response carry an `id_token`, which is
    // the only place the connected account's identity appears. Drop either and
    // the picker goes back to three identical rows — no error, no failing test
    // anywhere else, just an unusable list. Microsoft's reference gates the
    // claim we read: `preferred_username` is "Present only in v2.0 tokens" and
    // "The profile scope is required to receive this claim".
    expect(microsoftProvider.oauth.authorizationScopes).toContain('openid');
    expect(microsoftProvider.oauth.authorizationScopes).toContain('profile');
  });

  it('⚠️ keeps all three OUT of capabilities — the access token never carries them', () => {
    // `capabilities` feeds the runtime scope check against what the token
    // actually holds. Microsoft does not report any of these in the token
    // response's `scope`, so a capability naming one could never be satisfied
    // and every send would fail `integration_scope_missing`.
    const granted = Object.values(microsoftProvider.capabilities).flat();
    for (const requested of microsoftProvider.oauth.authorizationScopes ?? []) {
      expect(granted).not.toContain(requested);
    }
  });

  it('⚠️ names the ISSUER, never the .well-known path — the library branches on it', () => {
    // THE DEFECT THIS PINS, observed live on 2026-09-17: every connection ended
    // at `?oauth=failed` with the state row consumed and zero connections
    // written, and nothing was logged.
    //
    // `discovery()` decides how much work to do from the SPELLING of this URL:
    //
    //   openid-client/build/index.js:263
    //     const resolve = !server.href.includes('/.well-known/');
    //   :287
    //     if (resolve && new URL(as.issuer).href !== server.href) {
    //       handleEntraId(server, as, options) || ...
    //
    // `handleEntraId` is the library's OWN Microsoft support — it installs the
    // substitution of the real tenant into the issuer template (`:493`). Microsoft
    // publishes `https://login.microsoftonline.com/{tenantid}/v2.0` as the issuer
    // of `/organizations/`, and the ID token carries the real tenant, so without
    // it the two can never match.
    //
    // Passing the `.well-known` path skips that branch entirely. It was harmless
    // until `openid` was requested: with no ID token there was nothing to
    // validate against. The moment an identity was asked for, every connection
    // broke.
    expect(microsoftProvider.oauth.server.href).not.toContain('/.well-known/');
    expect(microsoftProvider.oauth.server.href).toBe(
      'https://login.microsoftonline.com/organizations/v2.0',
    );
  });

  it('⚠️ targets organizational accounts only, which the Azure registration must match', () => {
    // `/organizations/` excludes personal Microsoft accounts. An app registered
    // as "…and personal Microsoft accounts" would still reject them here, and the
    // error would read as a registration mistake.
    expect(microsoftProvider.oauth.server.href).toContain('/organizations/');
  });

  it('authenticates the client in the body, and says so explicitly', () => {
    // No implicit default: a confidential client that reached the token endpoint
    // as a public one would fail with an opaque `invalid_client`.
    expect(microsoftProvider.oauth.clientAuth).toBe('post');
  });

  it('keeps the mail capability keyed the way every caller spells it', () => {
    expect(MICROSOFT_MAIL_CAPABILITY).toBe('mail.send');
    expect(microsoftProvider.capabilities[MICROSOFT_MAIL_CAPABILITY]).toEqual(['Mail.Send']);
  });

  it('⚠️ may only send to Graph', () => {
    // `validateDestination` checks every outbound request against this list, so a
    // wider entry would let a credential travel somewhere it does not belong.
    expect(microsoftProvider.apiOrigins).toEqual(['https://graph.microsoft.com']);
  });
});
