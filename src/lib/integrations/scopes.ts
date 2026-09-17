// Comparing what a provider GRANTED against what a capability REQUIRES.
//
// ⚠️ THE TWO SIDES SPEAK DIFFERENT VOCABULARIES, AND THAT IS DOCUMENTED RATHER
// THAN GUESSED. `provider.capabilities` names a permission the way an app asks
// for it — `Mail.Send` — which Microsoft's `scopes-oidc` reference explicitly
// blesses: omitting the resource identifier defaults the resource to Microsoft
// Graph, so a request for `User.Read` IS a request for Graph `User.Read`.
//
// But every token-response example in Microsoft's own protocol reference echoes
// the FULLY QUALIFIED, LOWERCASED form:
//
//   v2-oauth2-auth-code-flow      "scope": "…graph.microsoft.com%2Fmail.read"
//   v2-oauth2-on-behalf-of-flow   "scope": "https://graph.microsoft.com/user.read"
//   howto-call-a-web-api-with-curl "scope": "api://{client_id}/Forecast.Read"
//
// So `['Mail.Send'].filter((s) => !granted.includes(s))` — which is what this
// replaced — can only ever report the scope as missing, and every send fails
// permanently with `integration_scope_missing`.
//
// ⚠️ AND IT FAILED INTERMITTENTLY, WHICH IS WORSE THAN ALWAYS. That same
// reference calls the response's `scope` "Optional. This parameter is
// non-standard", so when Microsoft omits it, `token-response.ts` falls back to
// the scopes we requested — the SHORT form — and the comparison passes. Whether
// a connection works therefore depended on whether the server chose to echo.
//
// WHY NO TEST CAUGHT IT: 27 fixture occurrences of `'Mail.Send'`, on both sides
// of the comparison. They agreed with each other, not with the provider.
//
// A COMPARISON HELPER, NEVER A WRITER. `integration_connections.scopes` keeps
// the raw strings the provider returned, for two reasons: that column is the
// record of what was actually granted, and `refresh-service.ts` feeds it back as
// `requestedAccessScopes`, so canonicalising on write would also rewrite what we
// claim to have asked for.

/**
 * A scope reduced to the form both sides can be compared in.
 *
 * Lowercased, and stripped of a resource identifier the provider DECLARED. An
 * undeclared prefix is deliberately left whole: stripping any `scheme://host/`
 * blindly would let `api://someone-else/Mail.Send` satisfy a Graph capability,
 * and a loud `integration_scope_missing` is the better failure.
 */
export function canonicalScope(scope: string, resources: readonly string[]): string {
  const value = scope.trim().toLowerCase();

  for (const resource of resources) {
    const trimmed = resource.trim().toLowerCase().replace(/\/+$/, '');
    // A blank entry would otherwise become the prefix `/` and quietly strip a
    // leading slash off every scope. Skipped by name rather than guarded by
    // length, so the intent survives the next edit.
    if (trimmed === '') continue;

    const prefix = `${trimmed}/`;
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }

  return value;
}

/**
 * Which required scopes the grant does NOT satisfy. Empty means it does.
 *
 * ⚠️ STILL CHECKED AGAINST WHAT THE PROVIDER REPORTED AS GRANTED, never against
 * what was asked for — a consent screen that lets a user untick a scope is the
 * case the check exists for. Normalising makes the two strings comparable; it
 * does not make the check weaker. A user who declines `Mail.Send` is still
 * refused, because `mail.send` is simply absent from what came back.
 *
 * Returns the REQUIRED spelling of each miss, not the canonical one, so the
 * error message names the permission an operator has to go and grant.
 */
export function unsatisfiedScopes(
  granted: readonly string[],
  required: readonly string[],
  resources: readonly string[],
): string[] {
  const held = new Set(granted.map((scope) => canonicalScope(scope, resources)));
  return required.filter((scope) => !held.has(canonicalScope(scope, resources)));
}

/** Whether a grant covers every required scope. */
export function grantSatisfies(
  granted: readonly string[],
  required: readonly string[],
  resources: readonly string[],
): boolean {
  return unsatisfiedScopes(granted, required, resources).length === 0;
}
