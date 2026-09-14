import 'server-only';

import { SECRET_NAME_REGEX, SECRET_REFERENCE_REGEX } from './catalogue/types';

// `{{secrets.<NAME>}}` — the only way a workflow can carry a credential.
//
// THE WHOLE POINT OF THIS FILE is that the secret VALUE exists in exactly one
// place — this process's environment — and for exactly as long as it takes to
// write it to a socket. Everything else in the system holds the NAME:
//
//   the diagram (jsonb)      {{secrets.ACME_API_KEY}}
//   the browser              {{secrets.ACME_API_KEY}}
//   the dry-run trace        {{secrets.ACME_API_KEY}}
//   the run log / step row   {{secrets.ACME_API_KEY}}
//   the outbound socket      the value
//
// That holds because `resolveTemplate` is taught to skip this namespace (see its
// `secrets` case), so the token survives config resolution intact and is
// substituted here instead — inside the outbound port, after the audit row is
// written and after the event is emitted.
//
// ⚠️ WHY THE ENVIRONMENT AND NOT THE DATABASE.
//
// A `workflow_secrets` table is the obvious alternative and is NOT what this
// does, for three reasons that are worth writing down because the table will be
// proposed again:
//
//   1. Stored in the database it would be plaintext at rest unless encrypted,
//      and this codebase has no live encryption helper to reuse — the AES-GCM
//      columns on `exchange_connections` are vestigial (every writer sets them
//      null since EWS was removed). Building a second crypto scheme, plus its
//      key custody and rotation story, to hold values the owner already keeps in
//      `.env` is a larger security surface than it removes.
//   2. A database secret is reachable by anything holding the service-role key.
//      An environment secret is reachable only by the process it was given to —
//      and the worker is the only process that makes outbound calls.
//   3. `.env` is already this project's declared home for credentials.
//
// THE COST, stated plainly: adding a secret is an env edit and a worker restart,
// not a click in /admin. `listSecretNames` exists so the admin UI can still show
// WHICH secrets a workflow may reference without ever reading one.
//
// If the owner wants add-a-secret-from-the-browser, the seam is `lookupSecret`:
// a database-backed implementation swaps in there and nothing else in the system
// changes. That is a deliberate choice left open, not an oversight.

/**
 * The prefix an environment variable needs to be visible to a workflow.
 *
 * NOT bare `process.env[name]`, which is the bug this prefix exists to prevent:
 * with a bare lookup, `{{secrets.SUPABASE_SERVICE_ROLE_KEY}}` in a header would
 * exfiltrate our own database to any URL an admin typed. The prefix means a
 * variable is reachable by a workflow ONLY because someone deliberately named it
 * for one — every other secret this process holds is invisible here.
 */
const SECRET_ENV_PREFIX = 'KALFA_WORKFLOW_SECRET_';

export type SecretLookup = (name: string) => string | undefined;

/**
 * The default lookup: the process environment, behind the prefix.
 *
 * Returns `undefined` for an unknown or empty name rather than `''`, because the
 * caller must be able to tell "not configured" from "configured as empty" — the
 * first is a refusal, the second would send an empty Authorization header and
 * look like a server-side bug at the receiving end.
 */
export const lookupSecret: SecretLookup = (name) => {
  if (!SECRET_NAME_REGEX.test(name)) return undefined;
  const value = process.env[`${SECRET_ENV_PREFIX}${name}`];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/**
 * The names a workflow may reference — never the values.
 *
 * For the admin UI and for validation messages. Sorted so the list is stable
 * between renders.
 */
export function listSecretNames(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(env)
    .filter((key) => key.startsWith(SECRET_ENV_PREFIX))
    .map((key) => key.slice(SECRET_ENV_PREFIX.length))
    .filter((name) => SECRET_NAME_REGEX.test(name) && env[`${SECRET_ENV_PREFIX}${name}`] !== '')
    .sort();
}

export type SecretSubstitution =
  | { ok: true; value: string }
  /** `missing` names the secrets that are referenced but not configured. */
  | { ok: false; missing: string[] };

/**
 * Replace every `{{secrets.<NAME>}}` in one string.
 *
 * FAILS CLOSED. If any referenced secret is absent the whole substitution is
 * refused and the names are reported — the caller must NOT send the string. The
 * alternative, substituting an empty string, would put a header reading
 * `Authorization: Bearer ` on the wire: a request that looks authenticated,
 * fails at the far end, and costs an afternoon to diagnose.
 *
 * The returned `missing` list carries NAMES, which are safe to show — that is
 * the entire reason the name and the value were separated.
 */
export function substituteSecrets(input: string, lookup: SecretLookup = lookupSecret): SecretSubstitution {
  const missing: string[] = [];

  // A fresh regex per call: SECRET_REFERENCE_REGEX carries the `g` flag, and a
  // shared global regex keeps `lastIndex` between calls — the classic bug where
  // every second call silently skips the first match.
  const pattern = new RegExp(SECRET_REFERENCE_REGEX.source, 'g');

  const value = input.replaceAll(pattern, (match, name: string) => {
    const secret = lookup(name);
    if (secret === undefined) {
      if (!missing.includes(name)) missing.push(name);
      return match;
    }
    return secret;
  });

  return missing.length > 0 ? { ok: false, missing } : { ok: true, value };
}

/**
 * True when a string still carries an unresolved `{{secrets.…}}`.
 *
 * The last gate before the socket. It catches the case `substituteSecrets` alone
 * cannot: a reference whose NAME is malformed (lower-case, too long, punctuation)
 * never matches the pattern at all, so nothing reports it missing and the literal
 * token would be sent as the header value — leaking to the receiver that we have
 * a secret store and what an owner tried to name in it.
 */
export function hasUnresolvedSecretReference(input: string): boolean {
  return /\{\{\s*secrets\./i.test(input);
}
