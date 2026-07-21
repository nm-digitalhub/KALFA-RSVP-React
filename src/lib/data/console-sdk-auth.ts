import 'server-only';

import { createHash } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';

// One-time-key signing for the agent console's Voximplant SDK login.
//
// THE PROTOCOL, quoted verbatim from the official guide
// (voximplant.com/docs/guides/sdk/authorization-onetimekey):
//
//     MD5(`${login_key}|${MD5(`${myuser}:voximplant.com:${mypass}`)}`)
//
// The app asks Voximplant for a one-time key, sends it here, and logs in with
// what this returns. The password is an input to the inner hash, so this step
// CANNOT happen in the app — that is a property of the protocol, not a policy
// choice. Nothing here ever returns the password.
//
// TWO DETAILS THAT SILENTLY BREAK IT, both easy to get wrong:
//   * the inner MD5 takes the SHORT user name (`agent_x`), never the FQDN
//     (`agent_x@app.account.voximplant.com`). The FQDN is only what the SDK's
//     loginWithOneTimeKey is given afterwards.
//   * the realm is the literal string `voximplant.com` — not our account name.
// Get either wrong and the hash is well-formed and rejected, with no signal
// saying why.
//
// MD5 IS NOT A SECURITY CHOICE HERE. It is dictated by Voximplant's login
// protocol. Do not "improve" it to SHA-256: the platform computes the same MD5
// on its side and would reject anything else. This comment exists because a
// future security sweep will otherwise flag it and be tempted.

const REALM = 'voximplant.com';

function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

/** Pure, and exported so the protocol can be pinned against a known vector. */
export function computeOneTimeKeyHash(
  shortUserName: string,
  password: string,
  oneTimeKey: string,
): string {
  const inner = md5(`${shortUserName}:${REALM}:${password}`);
  return md5(`${oneTimeKey}|${inner}`);
}

export type SdkAuthResult =
  | { ok: true; hash: string }
  | { ok: false; reason: 'not_provisioned' };

/**
 * Sign a one-time key for ONE agent, identified by their session — never by
 * anything in the request body.
 *
 * The user name is read from console_agents by userId. Accepting it from the
 * caller would let agent A request a hash for agent B's identity, which is the
 * whole login.
 *
 * `not_provisioned` covers both halves being absent, deliberately as one
 * outcome: a username without a secret is not a usable identity, and the caller
 * has nothing different to do about either case.
 */
export async function signOneTimeKeyForAgent(
  userId: string,
  oneTimeKey: string,
): Promise<SdkAuthResult> {
  const admin = createAdminClient();

  const { data: agent } = await admin
    .from('console_agents')
    .select('vox_username')
    .eq('user_id', userId)
    .maybeSingle();
  if (!agent?.vox_username) return { ok: false, reason: 'not_provisioned' };

  const { data: secret } = await admin
    .from('console_agent_secrets')
    .select('vox_password')
    .eq('user_id', userId)
    .maybeSingle();
  if (!secret?.vox_password) return { ok: false, reason: 'not_provisioned' };

  // Defensive: vox_username is stored short, but strip a domain if one was ever
  // written there by hand. The inner hash MUST see the short form.
  const shortName = agent.vox_username.split('@')[0];

  return {
    ok: true,
    hash: computeOneTimeKeyHash(shortName, secret.vox_password, oneTimeKey),
  };
}
