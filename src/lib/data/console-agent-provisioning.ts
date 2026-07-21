import 'server-only';

import { randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { addVoximplantUser, VOX_USER_NAME_PATTERN } from '@/lib/voximplant/mutations';

// Provision the Voximplant SDK identity a console agent needs in order to be
// present in a live call at all (listen / take over).
//
// WHY THIS EXISTS AS CODE rather than a runbook step. Creating the user MINTS A
// PASSWORD: it comes into existence at the moment of the API call and can never
// be read back from Voximplant. If it is not stored in the same operation it is
// gone, and the only recovery is to delete the user and start again. A terminal
// command cannot promise that; this can.
//
// It also removes the state we already have and do not want: console_agents held
// a vox_username with no user behind it — a value that reads as provisioned and
// is not. Nothing produced that string; it was written out of band.

// Voximplant's own rule, quoted from the method tree
// (voximplant.com/api/v2/getDoc?fqdn=references.httpapi.users): "at least 8
// characters long and contain at least one uppercase and lowercase letter, one
// number, and one special character".
//
// Built by construction rather than by generate-and-test: one character drawn
// from each required class, the remainder from the full alphabet, then shuffled
// so the required ones are not always in the same positions. 24 chars — the
// password is never typed by a human, so length is free.
const LOWER = 'abcdefghijkmnopqrstuvwxyz'; // no l
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
const DIGIT = '23456789'; // no 0, 1
const SPECIAL = '!@#$%^&*-_=+';
const ALL = LOWER + UPPER + DIGIT + SPECIAL;

function pick(alphabet: string): string {
  // Rejection-free modulo bias is irrelevant at these alphabet sizes for a
  // 24-char secret, but randomBytes (CSPRNG) is used rather than Math.random,
  // which must never generate a credential.
  return alphabet[randomBytes(1)[0] % alphabet.length];
}

export function generateVoxPassword(length = 24): string {
  const required = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SPECIAL)];
  const rest = Array.from({ length: length - required.length }, () => pick(ALL));
  const chars = [...required, ...rest];
  // Fisher-Yates with CSPRNG bytes.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// `agent_<uuid>` — 42 chars, inside Voximplant's [a-z0-9][a-z0-9_-]{2,49} and
// matching the format already recorded on console_agents. Hyphens are legal.
export function voxUserNameFor(userId: string): string {
  return `agent_${userId.toLowerCase()}`;
}

export type ProvisionOutcome =
  | { ok: true; voxUsername: string; alreadyProvisioned: boolean }
  | { ok: false; reason: 'not_configured' | 'api_failed' | 'store_failed' };

/**
 * Create (or confirm) the Voximplant user for one console agent and persist its
 * secret.
 *
 * ORDER IS THE WHOLE DESIGN:
 *   1. AddUser        — the credential now exists on Voximplant
 *   2. store secret   — if THIS fails we have an unusable user, but we know it,
 *                       because step 3 never ran
 *   3. vox_username   — written LAST, so a non-null username means "provisioned
 *                       AND its secret is stored". Never the reverse.
 *
 * The reverse order is what produces the state we are cleaning up: a username
 * that looks authoritative with nothing behind it. A caller seeing a null
 * username can safely retry; a caller seeing a set one can rely on it.
 *
 * Idempotent by intent: an agent that already has BOTH a username and a stored
 * secret is returned as-is rather than issued a second identity.
 */
export async function provisionConsoleAgentVoxUser(
  userId: string,
  displayName: string,
): Promise<ProvisionOutcome> {
  const admin = createAdminClient();

  const { data: agent } = await admin
    .from('console_agents')
    .select('vox_username')
    .eq('user_id', userId)
    .maybeSingle();
  const { data: existingSecret } = await admin
    .from('console_agent_secrets')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (agent?.vox_username && existingSecret) {
    return { ok: true, voxUsername: agent.vox_username, alreadyProvisioned: true };
  }

  const cfg = await getVoximplantConfig();
  const applicationId = await readApplicationId(admin);
  if (!cfg || !applicationId) return { ok: false, reason: 'not_configured' };

  const userName = voxUserNameFor(userId);
  if (!VOX_USER_NAME_PATTERN.test(userName)) return { ok: false, reason: 'api_failed' };
  const password = generateVoxPassword();

  try {
    const res = await addVoximplantUser(
      cfg.auth,
      applicationId,
      userName,
      password,
      displayName,
    );
    if (res.error) {
      // Never log the message verbatim — an API error can echo the request.
      console.error(`[provision] AddUser failed (code=${res.error.code})`);
      return { ok: false, reason: 'api_failed' };
    }
  } catch {
    console.error('[provision] AddUser threw');
    return { ok: false, reason: 'api_failed' };
  }

  // Step 2 — the secret, BEFORE the username.
  const { error: secretErr } = await admin
    .from('console_agent_secrets')
    .upsert({ user_id: userId, vox_password: password }, { onConflict: 'user_id' });
  if (secretErr) {
    // The Voximplant user now exists and we cannot use it. Say so loudly: the
    // remedy is to delete it there and re-run, and leaving vox_username null is
    // what makes that safe to do.
    console.error(
      `[provision] user ${userName} CREATED on Voximplant but its secret could not be stored — delete it there before retrying`,
    );
    return { ok: false, reason: 'store_failed' };
  }

  // Step 3 — only now does the agent read as provisioned.
  //
  // The BARE user_name is stored, not the FQDN. Two reasons, both from the
  // protocol: this is exactly the string AddUser accepted, so it is the one
  // value we know Voximplant holds; and the inner MD5 of the one-time-key login
  // hashes the SHORT name (`user:voximplant.com:password`), so this is the form
  // the signing route needs. The full
  // `user_name@application_name.account_name.voximplant.com` that the SDK's
  // loginWithOneTimeKey takes is COMPOSED at login time — it needs the
  // application and account names, which are not stored yet. That is tracked in
  // the plan; storing a half-derived FQDN here would repeat the mistake this
  // whole change exists to fix.
  const { error: nameErr } = await admin
    .from('console_agents')
    .update({ vox_username: userName })
    .eq('user_id', userId);
  if (nameErr) {
    console.error('[provision] vox_username write failed');
    return { ok: false, reason: 'store_failed' };
  }

  return { ok: true, voxUsername: userName, alreadyProvisioned: false };
}

// The application new users are created in. Configuration, not a constant — the
// account has more than one application and which is production is an ops fact.
async function readApplicationId(
  admin: ReturnType<typeof createAdminClient>,
): Promise<number | null> {
  const { data } = await admin
    .from('app_settings')
    .select('voximplant_application_id')
    .eq('id', true)
    .maybeSingle();
  const raw = (data as { voximplant_application_id?: string | null } | null)
    ?.voximplant_application_id;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
