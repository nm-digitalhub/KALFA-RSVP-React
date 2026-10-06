import 'server-only';

/**
 * WHO a connection authenticates as, read from a validated ID token.
 *
 * ⚠️ WHY THIS EXISTS AT ALL. Every connection was labelled with the PROVIDER's
 * display name — "Microsoft 365" for all of them — because the callback had
 * nothing else to write. Connect three mailboxes and the picker offers three
 * identical rows separated only by an invisible uuid, ordered by that uuid, so
 * not even by the order they were created in. There was no way to tell them
 * apart and no way to pick the right one.
 *
 * n8n does not solve this either, and we have now seen both its code and its
 * live product: `CredentialConfig.vue:241-250` says in its own comment that
 * "Many providers return no identity at all (Gmail asks for no identity scope),
 * so an absent value is normal", and a real account with two connected mailboxes
 * shows "Microsoft Outlook account" and "Microsoft Outlook account 2" — a
 * counter, not an identity. The counter is a tie-breaker, not an answer.
 *
 * Microsoft DOES return an identity when asked. So this reads one.
 *
 * ── THE TWO FIELDS ARE NOT INTERCHANGEABLE ─────────────────────────────────
 *
 * Both come from the same token and they are governed by opposite rules, which
 * is why they are separate fields here and used in exactly one way each.
 *
 * OpenID Connect Core 1.0 §5.7, "Claim Stability and Uniqueness":
 *
 *   "The sub (subject) and iss (issuer) Claims from the ID Token, used
 *    together, are the ONLY Claims that an RP can rely upon as a stable
 *    identifier for the End-User… the only guaranteed unique identifier for a
 *    given End-User is the combination of the iss Claim and the sub Claim. All
 *    other Claims carry no such guarantees… an Issuer MAY re-use an email Claim
 *    Value across different End-Users at different points in time."
 *
 * And §5.1 on the friendly one:
 *
 *   "preferred_username — Shorthand name by which the End-User wishes to be
 *    referred to at the RP… The RP MUST NOT rely upon this value being unique."
 *
 * Microsoft's own reference agrees from the other side: `preferred_username`
 * "can be used for username hints and in human-readable UI as a username", and
 * because it "is mutable, this value can't be used to make authorization
 * decisions"; `email` "isn't guaranteed to be correct and is mutable over time.
 * Never use it for authorization or to save data for a user."
 *
 * So: `key` decides WHETHER TWO CONNECTIONS ARE THE SAME ACCOUNT. `displayName`
 * only ever reaches a screen. Neither may do the other's job.
 *
 * ── VENDOR-NEUTRAL ON PURPOSE ──────────────────────────────────────────────
 *
 * Every claim read here is standard OIDC, so a second provider needs no new
 * code. Microsoft's own `oid`/`tid` pair would work too, but it is a proprietary
 * spelling of a question the spec already answers, and `provider.ts` keeps
 * vendor names out of the generic contract.
 */
export type AccountIdentity = {
  /**
   * The stable key: `iss` and `sub` joined, in that order.
   *
   * Compared, never displayed. Joined with a space because neither claim may
   * contain one — both are JSON strings used as URI/identifier values — so the
   * pair cannot be forged by a value that embeds the separator.
   */
  key: string | null;

  /**
   * What a person reads in the picker. Not unique, not stable, not a key.
   * `null` when the provider returned no identity at all, which is a normal
   * state and must stay legible rather than becoming an empty label.
   */
  displayName: string | null;
};

export const NO_ACCOUNT_IDENTITY: AccountIdentity = { key: null, displayName: null };

/**
 * Read an identity out of ID token claims.
 *
 * ⚠️ THE CLAIMS MUST ALREADY BE VALIDATED. The only caller passes the result of
 * `openid-client`'s `TokenEndpointResponseHelpers.claims()`, which returns the
 * parsed claim set only after the library has checked the token's signature,
 * issuer, audience and expiry. This function does no verification of its own and
 * must never be handed a JWT it decoded itself — an unverified `sub` is an
 * attacker-chosen string, and this one decides which account a connection is.
 *
 * Returns `NO_ACCOUNT_IDENTITY` rather than throwing. A provider that returns no
 * `id_token` (because `openid` was not requested, or a tenant policy strips it)
 * is a working connection with an anonymous label, not a failed authorization —
 * refusing the grant here would turn a cosmetic gap into an outage.
 */
export function readAccountIdentity(claims: unknown): AccountIdentity {
  if (typeof claims !== 'object' || claims === null) return NO_ACCOUNT_IDENTITY;

  const record = claims as Record<string, unknown>;

  const iss = readClaim(record.iss);
  const sub = readClaim(record.sub);

  return {
    // BOTH OR NEITHER. §5.7 makes the guarantee about the pair: `sub` is unique
    // "within the Issuer", so a `sub` without its issuer is a key that two
    // different providers could collide on.
    key: iss !== null && sub !== null ? `${iss} ${sub}` : null,

    // `preferred_username` first because that is the claim whose entire purpose
    // is being shown to the user. `email` is the fallback and nothing more — the
    // spec warns it may be re-used across End-Users, so it may never become the
    // key, but it is still a better label than none.
    displayName: readClaim(record.preferred_username) ?? readClaim(record.email),
  };
}

/**
 * A claim value we are willing to use, or `null`.
 *
 * Non-strings are rejected rather than coerced: a claim that arrived as a number
 * or an object is not the claim the spec describes, and `String(value)` would
 * turn `{}` into a label reading "[object Object]" or, worse, into half of a key.
 * Whitespace-only is the same case — it renders as an empty row.
 */
function readClaim(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
