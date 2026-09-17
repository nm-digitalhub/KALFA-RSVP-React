import 'server-only';

import { registerProvider, type ProviderDefinition } from '../provider';
import {
  MICROSOFT_GRAPH_ORIGIN,
  microsoftGraphRequest,
} from '../transports/microsoft-graph';

export const MICROSOFT_PROVIDER_ID = 'microsoft';

/**
 * The capability key the mail-sending node asks for.
 *
 * Exported so a caller reduces a stored grant through `capabilities` rather than
 * re-typing the scope it maps to — that literal is exactly what drifted in
 * `workflow-connections.ts`, where a hard-coded `'Mail.Send'` kept answering a
 * question the provider had already answered differently.
 *
 * ⚠️ The editor's client component keeps its own copy: this module is
 * `server-only`, so a browser bundle cannot reach it.
 */
export const MICROSOFT_MAIL_CAPABILITY = 'mail.send' as const;

export const microsoftProvider = {
  id: MICROSOFT_PROVIDER_ID,
  displayName: 'Microsoft 365',
  credentialKind: 'oauth2_authorization_code',
  presentation: { type: 'bearer' },
  capabilities: {
    [MICROSOFT_MAIL_CAPABILITY]: ['Mail.Send'],
  },
  apiOrigins: [MICROSOFT_GRAPH_ORIGIN],
  oauth: {
    // ⚠️ THE ISSUER IDENTIFIER, NOT THE `.well-known` PATH — AND THE DIFFERENCE
    // SILENTLY BROKE THE FLOW.
    //
    // `discovery()` documents this argument as "URL representation of the
    // Authorization Server's Issuer Identifier", and it branches on the spelling:
    //
    //   openid-client/build/index.js:263
    //     const resolve = !server.href.includes('/.well-known/');
    //   :287
    //     if (resolve && new URL(as.issuer).href !== server.href) {
    //       handleEntraId(server, as, options) || ...
    //
    // `handleEntraId` is what installs the library's OWN Microsoft support: it
    // marks the server and then substitutes the real tenant into the issuer
    // template (`:493`, `server.issuer.replace('{tenantid}', tid)`). Microsoft's
    // `/organizations/` document literally publishes
    // `https://login.microsoftonline.com/{tenantid}/v2.0` as its issuer, while
    // the ID token carries the real tenant — so without that substitution the
    // two never match.
    //
    // Passing the `.well-known` path made `resolve` false, skipped the whole
    // branch, and left the template in place. It went unnoticed for as long as
    // we asked for no `openid` scope: with no ID token there was nothing to
    // validate. Adding `openid profile` for the account identity turned a dormant
    // misuse into `?oauth=failed` on every connection — observed live 2026-09-17,
    // state row consumed, zero connections written.
    server: new URL('https://login.microsoftonline.com/organizations/v2.0'),
    clientAuth: 'post',
    // Without `offline_access` Microsoft returns NO refresh token at all — "Only
    // provided if `offline_access` scope was requested" — and the connection
    // would die at the first access-token expiry with no way back but re-consent.
    //
    // ⚠️ `openid profile` BUY THE ACCOUNT'S IDENTITY, and nothing else here can.
    // Without them the token response carries no `id_token`, so every connection
    // is stored under the provider's display name and three mailboxes become
    // three identical rows in the picker — see `account-identity.ts`. Microsoft's
    // reference is explicit that the claim we want is gated: `preferred_username`
    // is "Present only in v2.0 tokens" and "The profile scope is required to
    // receive this claim". `openid` is what makes the request an OIDC one at all.
    //
    // All three sit here and not in `capabilities` because none is a permission
    // the ACCESS token carries: Microsoft does not report them in the token
    // response's `scope`, so a runtime check for any of them could never pass.
    authorizationScopes: ['offline_access', 'openid', 'profile'],
    // ⚠️ MEASURED FROM MICROSOFT'S OWN PROTOCOL REFERENCE, not assumed: the
    // token response echoes `https://graph.microsoft.com/mail.send`, while
    // `capabilities` above names the same permission `Mail.Send` — the spelling
    // `scopes-oidc` says defaults to Graph when a request omits the resource.
    // Without this, every send fails `integration_scope_missing`.
    scopeResources: [MICROSOFT_GRAPH_ORIGIN],
    // ⚠️ WITHOUT THIS, THE SECOND MAILBOX IS SILENTLY THE FIRST ONE. Microsoft
    // reuses the account already signed in to the browser and never shows a
    // chooser, so an operator connecting a second account gets the first back
    // with no prompt, no error, and no way to tell.
    //
    // n8n sends it on every Microsoft authorization — `authQueryParameters` in
    // `MicrosoftOAuth2Api.credentials.ts` is a HIDDEN field defaulting to
    // `response_mode=query&prompt=select_account`, i.e. not a preference a user
    // can turn off. `prompt` is `optional` in Microsoft's auth-code reference,
    // with `select_account` documented as "account selection experience listing
    // all the accounts either in session or any remembered account".
    //
    // `response_mode` is NOT copied: openid-client already defaults the code
    // flow to `query`, and stating it again would be a second source for a value
    // the library owns.
    authorizationParams: { prompt: 'select_account' },
  },
  endpoint: microsoftGraphRequest,
} satisfies ProviderDefinition;

export function registerMicrosoftProvider(): void {
  registerProvider(microsoftProvider);
}
