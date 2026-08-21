import 'server-only';

import { randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import {
  addVoximplantUser,
  delVoximplantUser,
  setVoximplantUserActive,
  setVoximplantUserPassword,
  VOX_USER_NAME_PATTERN,
} from '@/lib/voximplant/mutations';
import { VoximplantNetworkError } from '@/lib/voximplant/core';

// Caught-exception detail, safe to log: VoximplantNetworkError's message is
// always ONE OF the fixed generic strings voxRequest itself throws (network/
// non-2xx/non-JSON) — never an echo of request params or a provider error
// body (the res.error.msg path below stays unlogged verbatim, unchanged, for
// exactly that echo risk). A plain Error's message here is our OWN validation
// text (e.g. the generated username), also safe.
function describeThrown(err: unknown): string {
  const status = err instanceof VoximplantNetworkError ? err.status : undefined;
  const message = err instanceof Error ? err.message : 'unknown error';
  return status ? `${message} (status=${status})` : message;
}

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
  | { ok: false; reason: 'not_configured' | 'store_failed' }
  // voxErrorCode is present only for a STRUCTURED AddUser rejection (the API
  // returned {error:{code,msg}} — never for a network-level throw, which has
  // no code). 157 = "The 'user_display_name' parameter is invalid" — verified
  // live against voximplant.com/api/v2/getDoc?fqdn=references.httpapi.errors
  // on 2026-08-21 — the ONLY code the caller may safely attribute to the
  // display-name field specifically; every other code stays a generic failure.
  | { ok: false; reason: 'api_failed'; voxErrorCode?: number };

/**
 * Mint a fresh Voximplant identity for a console agent being enrolled for the
 * FIRST time, and persist its secret.
 *
 * Callers: enrollConsoleAgent ONLY, and only on the fresh-enrollment path — an
 * agent that already has a username and a stored secret is handled entirely by
 * the caller (a display-name edit, no Voximplant call at all). This function
 * therefore never checks for an existing identity; it always mints one.
 *
 * ORDER IS THE WHOLE DESIGN, and it is now the OWNER'S OWN RULE, not just an
 * internal convention: "לא הגיוני לבצע שינויים שקשורים לספק רק מהצד שלנו" — no
 * local grant of console access may exist unless Voximplant genuinely holds the
 * identity behind it.
 *   1. AddUser        — Voximplant FIRST. Nothing local exists yet, so a
 *                       failure here grants nothing: this agent is simply not
 *                       enrolled, not a "half-enrolled" local row.
 *   2. console_agents  — ONLY once Voximplant has succeeded. This is the FK
 *                       console_agent_secrets depends on, so it must exist
 *                       before step 3.
 *   3. store secret    — if THIS fails we have an unusable user, but we know
 *                       it, because step 4 never ran.
 *   4. vox_username    — written LAST, so a non-null username still means
 *                       "provisioned AND its secret is stored". Never the
 *                       reverse.
 *
 * A failure at step 2, 3, or 4 leaves a Voximplant user Kalfa cannot yet use —
 * the same narrow, already-logged "delete it there and retry" state this
 * module has always surfaced for a failed store. What no longer happens is the
 * OLD failure mode: real console access granted locally while Voximplant was
 * never actually asked, or was asked and refused.
 */
export async function provisionConsoleAgentVoxUser(
  userId: string,
  displayName: string,
  // (לא חובה) pass-through to AddUser's own (לא חובה) fields — see
  // AddVoximplantUserOptions in mutations.ts. Not set by any caller today.
  opts?: { parentAccounting?: boolean; userCustomData?: string },
): Promise<ProvisionOutcome> {
  const admin = createAdminClient();

  const cfg = await getVoximplantConfig();
  const applicationId = await readApplicationId(admin);
  if (!cfg || !applicationId) return { ok: false, reason: 'not_configured' };

  const userName = voxUserNameFor(userId);
  if (!VOX_USER_NAME_PATTERN.test(userName)) return { ok: false, reason: 'api_failed' };
  const password = generateVoxPassword();

  // Step 1 — Voximplant FIRST. Nothing local is written until this succeeds.
  let voxUserId: number | undefined;
  try {
    const res = await addVoximplantUser(
      cfg.auth,
      applicationId,
      userName,
      password,
      displayName,
      {
        parentAccounting: opts?.parentAccounting,
        userCustomData: opts?.userCustomData,
      },
    );
    if (res.error) {
      // Never log the message verbatim — an API error can echo the request.
      // The code alone IS safe (a fixed enum from Voximplant's own error
      // list, never request content) — surfaced so the caller can attribute
      // a display-name-specific rejection (157) to that field.
      console.error(`[provision] AddUser failed (code=${res.error.code})`);
      return { ok: false, reason: 'api_failed', voxErrorCode: res.error.code };
    }
    voxUserId = res.user_id;
  } catch (err) {
    console.error(`[provision] AddUser threw: ${describeThrown(err)}`);
    return { ok: false, reason: 'api_failed' };
  }

  // Step 2 — the local grant row, ONLY now that Voximplant has confirmed the
  // identity. This is the FIRST point at which the agent has real console
  // access (feed, live-call commands, dial) — never earlier.
  const { error: rowErr } = await admin
    .from('console_agents')
    .upsert({ user_id: userId, display_name: displayName }, { onConflict: 'user_id' });
  if (rowErr) {
    console.error(
      `[provision] user ${userName} CREATED on Voximplant but the local grant could not be written — delete it there before retrying`,
    );
    return { ok: false, reason: 'store_failed' };
  }

  // Step 3 — the secret, BEFORE the username.
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

  // Step 4 — only now does the agent read as provisioned.
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
    .update({ vox_username: userName, vox_user_id: voxUserId ?? null })
    .eq('user_id', userId);
  if (nameErr) {
    console.error('[provision] vox_username write failed');
    return { ok: false, reason: 'store_failed' };
  }

  return { ok: true, voxUsername: userName, alreadyProvisioned: false };
}

export type RotateOutcome =
  | { ok: true; voxUsername: string }
  | { ok: false; reason: 'not_provisioned' | 'not_configured' | 'api_failed' | 'store_failed' };

/**
 * Rotate the platform password of an ALREADY-provisioned console agent and
 * store the fresh secret. Recovery for the state live login just exposed
 * (LoginInvalidPasswordError with a correct hash formula): the stored secret
 * and the platform password have drifted, and since Voximplant never reads a
 * password back, re-minting the pair is the only honest repair.
 *
 * Same ordering discipline as provisioning: platform FIRST, then the store.
 * If the store fails, the platform now holds a password nobody knows — which
 * is exactly the state we started from, and a re-run mints again. Idempotent
 * to repeat; loud on partial failure.
 */
export async function rotateConsoleAgentVoxSecret(userId: string): Promise<RotateOutcome> {
  const admin = createAdminClient();

  const { data: agent } = await admin
    .from('console_agents')
    .select('vox_username')
    .eq('user_id', userId)
    .maybeSingle();
  if (!agent?.vox_username) return { ok: false, reason: 'not_provisioned' };

  const cfg = await getVoximplantConfig();
  const applicationId = await readApplicationId(admin);
  if (!cfg || !applicationId) return { ok: false, reason: 'not_configured' };

  const password = generateVoxPassword();
  try {
    const res = await setVoximplantUserPassword(
      cfg.auth,
      applicationId,
      agent.vox_username,
      password,
    );
    if (res.error) {
      console.error(`[rotate] SetUserInfo failed (code=${res.error.code})`);
      return { ok: false, reason: 'api_failed' };
    }
  } catch (err) {
    console.error(`[rotate] SetUserInfo threw: ${describeThrown(err)}`);
    return { ok: false, reason: 'api_failed' };
  }

  const { error: secretErr } = await admin
    .from('console_agent_secrets')
    .upsert(
      {
        user_id: userId,
        vox_password: password,
        rotated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  if (secretErr) {
    console.error(
      `[rotate] platform password for ${agent.vox_username} was CHANGED but the new secret could not be stored — re-run to mint again`,
    );
    return { ok: false, reason: 'store_failed' };
  }

  return { ok: true, voxUsername: agent.vox_username };
}

export type DeprovisionOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'api_failed' };

/**
 * Delete the Voximplant user backing a console agent being removed.
 *
 * WHY THIS EXISTS. vox_username is DETERMINISTIC (agent_<user_id> —
 * voxUserNameFor), so without this, removing an agent leaves their
 * Voximplant user orphaned but very much alive; the FIRST call to re-enrol
 * the SAME person calls AddUser with that exact name again and Voximplant
 * rejects the collision. Every subsequent retry fails identically, forever —
 * "remove and re-bind will try again" (the admin UI's own hint) can never
 * actually recover, because nothing ever deletes the original.
 *
 * Takes voxUsername (and, when known, voxUserId) directly rather than
 * re-reading console_agents itself: the caller (removeConsoleAgent) must read
 * them BEFORE its own delete, since that delete cascades away
 * console_agent_secrets and the row itself — this function's whole reason to
 * exist is cleaning up AFTER that point.
 *
 * Prefers voxUserId (Voximplant's own numeric id, stored at provisioning
 * time) over name-matching when available — the more robust of the two
 * identifiers DelUser accepts. Falls back to voxUsername for an agent
 * provisioned before vox_user_id existed.
 *
 * LOAD-BEARING, not best-effort: removeConsoleAgent calls this BEFORE its own
 * local delete and does not remove the local row unless this succeeds (owner
 * directive — a removal must not claim to have cut access at Voximplant when
 * it has not). A failure here is therefore a failed removal, surfaced to the
 * admin as an error, not a logged-and-ignored side note.
 */
export async function deprovisionConsoleAgentVoxUser(
  voxUsername: string,
  voxUserId?: number | null,
): Promise<DeprovisionOutcome> {
  const admin = createAdminClient();
  const cfg = await getVoximplantConfig();
  const applicationId = await readApplicationId(admin);
  if (!cfg || !applicationId) return { ok: false, reason: 'not_configured' };

  try {
    const res = await delVoximplantUser(
      cfg.auth,
      applicationId,
      voxUsername,
      voxUserId != null ? { userId: voxUserId } : undefined,
    );
    if (res.error) {
      console.error(`[deprovision] DelUser failed (code=${res.error.code})`);
      return { ok: false, reason: 'api_failed' };
    }
  } catch (err) {
    console.error(`[deprovision] DelUser threw: ${describeThrown(err)}`);
    return { ok: false, reason: 'api_failed' };
  }

  return { ok: true };
}

export type SetActiveOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_provisioned' | 'not_configured' | 'api_failed' };

/**
 * Block or unblock a console agent's Voximplant identity — the whole feature
 * exists because a KALFA-only flag is not an acceptable design for something
 * that gates a Voximplant-side capability (owner directive, repeated: "לא
 * הגיוני לבצע שינויים שקשורים לספק רק מהצד שלנו").
 *
 * ORDER, again, IS the design: SetUserInfo(user_active) at Voximplant FIRST —
 * that call is load-bearing, not a mirror of a decision already made. The
 * local console_agents.vox_active flag (which is_console_agent() actually
 * checks — see migration 20260821170246) is written ONLY after Voximplant
 * confirms the change. A Voximplant failure returns api_failed and writes
 * NOTHING locally: this function must never let KALFA claim a block the
 * provider does not actually hold, or an unblock the provider never granted.
 *
 * 'not_provisioned' — the agent has no vox_username at all (never enrolled
 * with a Voximplant identity, or enrollment never got that far). There is
 * nothing at Voximplant to block; the caller should say so plainly rather
 * than attempt a call that has no identity to target.
 */
export async function setConsoleAgentVoxActive(
  userId: string,
  active: boolean,
): Promise<SetActiveOutcome> {
  const admin = createAdminClient();

  const { data: agent } = await admin
    .from('console_agents')
    .select('vox_username')
    .eq('user_id', userId)
    .maybeSingle();
  if (!agent?.vox_username) return { ok: false, reason: 'not_provisioned' };

  const cfg = await getVoximplantConfig();
  const applicationId = await readApplicationId(admin);
  if (!cfg || !applicationId) return { ok: false, reason: 'not_configured' };

  try {
    const res = await setVoximplantUserActive(cfg.auth, applicationId, agent.vox_username, active);
    if (res.error) {
      console.error(`[set-active] SetUserInfo failed (code=${res.error.code})`);
      return { ok: false, reason: 'api_failed' };
    }
  } catch (err) {
    console.error(`[set-active] SetUserInfo threw: ${describeThrown(err)}`);
    return { ok: false, reason: 'api_failed' };
  }

  // Voximplant confirmed the change — now, and only now, the local gate
  // is_console_agent() actually reads is updated to match.
  const { error } = await admin
    .from('console_agents')
    .update({ vox_active: active })
    .eq('user_id', userId);
  if (error) {
    console.error(
      `[set-active] Voximplant user ${agent.vox_username} set active=${active} but the local flag write failed — provider and local state now disagree, retry`,
    );
    return { ok: false, reason: 'api_failed' };
  }

  return { ok: true };
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
