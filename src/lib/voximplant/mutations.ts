import {
  voxRequest,
  type VoxParams,
  type VoximplantConfig,
} from './core';

// Voximplant Management API — MUTATING wrappers, deliberately separated from
// the read-only `./core` (plan §3, owner directive):
//
//   - `./core` stays strictly read-only and is what the CLI imports;
//   - THIS module is never imported by the CLI (a guard test pins that), so no
//     terminal command can place a call or change account state;
//   - allowed consumers: `./client` (server-only re-export for Next server
//     code) and the request-free worker dispatcher (`outreach-calls.ts`).
//
// Like core, this file carries no `server-only` import so the esbuild worker
// bundle can include it; the Next.js boundary is enforced by `./client`.

// StartScenarios — trigger an outbound scenario run (the RSVP call). `rule_id`
// binds the scenario; `script_custom_data` carries per-call context. NOTE: this
// INITIATES a real call — gate behind config + explicit authorization.
export interface StartScenariosRequest {
  rule_id: number | string;
  script_custom_data?: string;
}
export interface StartScenariosResponse {
  result: number;
  call_session_history_id?: number;
  media_session_access_url?: string;
  // HTTPS control URL (verified field, httpapi/scenarios "Returns"). Type-only —
  // not persisted, and NEVER proof of a started call (only result===1 &&
  // call_session_history_id is proof).
  media_session_access_secure_url?: string;
}
export function startScenarios(
  config: VoximplantConfig,
  params: StartScenariosRequest,
  timeoutMs?: number,
): Promise<StartScenariosResponse> {
  return voxRequest<StartScenariosResponse>(
    config,
    'StartScenarios',
    { ...params },
    timeoutMs,
  );
}

// SetAccountInfo — RESTRICTED to the two account-callback fields (plan B5).
// The params object is built inline from exactly two named arguments — no
// spread of caller input — so no other SetAccountInfo field (email, password,
// billing…) can EVER be sent through this wrapper; a test pins the exact body
// keys. Passing null clears the value provider-side (used by rollback when the
// previous state had no callback configured).
export interface SetAccountCallbackResponse {
  result: number;
}
export function setAccountCallbackUrl(
  config: VoximplantConfig,
  callbackUrl: string | null,
  callbackSalt: string | null,
  timeoutMs?: number,
): Promise<SetAccountCallbackResponse> {
  return voxRequest<SetAccountCallbackResponse>(
    config,
    'SetAccountInfo',
    {
      callback_url: callbackUrl ?? '',
      callback_salt: callbackSalt ?? '',
    },
    timeoutMs,
  );
}

// Secrets API — application-scoped secret store (Management API "Secrets"
// folder: AddSecret / GetSecretValue). These live HERE (not core) because a
// secret read-back is as privileged as a mutation: the CLI must never be able
// to print a secret, and the cli-guard test pins that the CLI cannot import
// this module. Values pass through verbatim and are NEVER logged by callers
// (the copy runner prints presence only). Both take application_id explicitly —
// secrets are per-application, and an implicit default could silently target
// the wrong app.
export interface GetSecretValueResponse {
  // Observed envelope variants: {result: {secret_value}} or a flat field.
  result?: { secret_name?: string; secret_value?: string } | number;
  secret_value?: string;
}
export function getApplicationSecretValue(
  config: VoximplantConfig,
  applicationId: number | string,
  secretName: string,
  timeoutMs?: number,
): Promise<GetSecretValueResponse> {
  return voxRequest<GetSecretValueResponse>(
    config,
    'GetSecretValue',
    {
      application_id: applicationId,
      secret_name: secretName,
    },
    timeoutMs,
  );
}

export interface AddSecretResponse {
  result?: number | { secret_name?: string };
}
export function addApplicationSecret(
  config: VoximplantConfig,
  applicationId: number | string,
  secretName: string,
  secretValue: string,
  timeoutMs?: number,
): Promise<AddSecretResponse> {
  return voxRequest<AddSecretResponse>(
    config,
    'AddSecret',
    {
      application_id: applicationId,
      secret_name: secretName,
      secret_value: secretValue,
    },
    timeoutMs,
  );
}

// ReorderRules — set the ORDER of an application's routing rules.
//
// Order is load-bearing, not cosmetic: the platform evaluates rules TOP TO
// BOTTOM and executes the FIRST whose pattern matches the destination,
// disregarding every rule after it (official docs,
// getting-started.basic-concepts.routing-rules — and the same doc states this
// applies to SDK-originated calls, matched against `e.destination`). A `.*`
// rule therefore shadows everything below it, which is exactly the state a
// freshly-added rule lands in: AddRule appends.
//
// This is what voxengine-ci calls internally after an application-level upload
// (Rules.reorderRules); exposed here so the order can be fixed on its own,
// without an application-level upload dragging unrelated scenarios along.
//
// The signature takes the full ordered id list — the API's own contract
// ("Configures the rules' order… the rules should belong to the same
// application"). Verified against references.httpapi.rules.reorderrules:
// the single parameter is `rule_id`.
export interface ReorderRulesResponse {
  result?: number;
  error?: { code: number; msg: string };
}
export function reorderApplicationRules(
  config: VoximplantConfig,
  orderedRuleIds: number[],
  timeoutMs?: number,
): Promise<ReorderRulesResponse> {
  if (orderedRuleIds.length === 0) {
    return Promise.reject(new Error('ReorderRules requires at least one rule id'));
  }
  // SEMICOLON-separated, not comma: `rule_id` is an API "intlist", the same
  // convention GetAuditLog's `filtered_cmd` uses. A comma-joined value is
  // rejected by the platform with a Java parse error ("For input string: …"),
  // verified live 2026-08-12 — the error names the whole string, which is what
  // makes the separator the obvious suspect.
  return voxRequest<ReorderRulesResponse>(
    config,
    'ReorderRules',
    { rule_id: orderedRuleIds.join(';') },
    timeoutMs,
  );
}

// AddUser — create a Voximplant SDK/SIP user inside an application.
//
// MUTATION, and the only one in this codebase that MINTS A CREDENTIAL. It is
// here and deliberately NOT in the read-only CLI (see cli-guard.test.ts): a
// password comes into existence at the moment of this call and must be stored in
// the same operation, which a terminal command cannot guarantee.
//
// Constraints are the API's own, quoted from the official method tree
// (voximplant.com/api/v2/getDoc?fqdn=references.httpapi.users):
//   user_name     "[a-z0-9][a-z0-9_-]{2,49}"
//   user_password "at least 8 characters long and contain at least one uppercase
//                  and lowercase letter, one number, and one special character"
// Callers must satisfy both before calling; the API rejects otherwise and the
// error is not friendly.
//
// The password is passed in and never logged here. Nothing in the response
// echoes it back.
export const VOX_USER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,49}$/;

// SetUserInfo — RESTRICTED here to PASSWORD ROTATION of an existing SDK user.
// Recovery path for a stored-secret ↔ platform-password mismatch: Voximplant
// never reads a password back, so the only fix is minting a fresh known pair
// and storing it in the same operation (the AddUser rationale, applied again).
// Params verified against the official method tree (references.httpapi.users →
// SetUserInfo: user_id|user_name, application_id|application_name,
// user_password, …). The body is built inline from named arguments — no spread
// of caller input — so no other SetUserInfo field (active, display name, …)
// can ever be sent through this wrapper.
export interface SetUserInfoResponse {
  result?: number;
  error?: { code: number; msg: string };
}
export function setVoximplantUserPassword(
  config: VoximplantConfig,
  applicationId: number,
  userName: string,
  newPassword: string,
  timeoutMs?: number,
): Promise<SetUserInfoResponse> {
  if (!VOX_USER_NAME_PATTERN.test(userName)) {
    return Promise.reject(
      new Error(`שם משתמש Voximplant אינו תקין: ${userName}`),
    );
  }
  return voxRequest<SetUserInfoResponse>(
    config,
    'SetUserInfo',
    {
      application_id: applicationId,
      user_name: userName,
      user_password: newPassword,
    },
    timeoutMs,
  );
}

// SetUserInfo — RESTRICTED here to the `user_active` field: blocking/
// unblocking a console agent's Voximplant identity (and the identity the
// owner directive requires — see setConsoleAgentVoxActive in
// console-agent-provisioning.ts — this must be the LOAD-BEARING call: the
// local vox_active flag is written only after this succeeds, never before,
// never independently). Same restricted-body discipline as
// setVoximplantUserPassword above — no other SetUserInfo field can ever be
// sent through this wrapper.
export function setVoximplantUserActive(
  config: VoximplantConfig,
  applicationId: number,
  userName: string,
  active: boolean,
  timeoutMs?: number,
): Promise<SetUserInfoResponse> {
  if (!VOX_USER_NAME_PATTERN.test(userName)) {
    return Promise.reject(
      new Error(`שם משתמש Voximplant אינו תקין: ${userName}`),
    );
  }
  return voxRequest<SetUserInfoResponse>(
    config,
    'SetUserInfo',
    {
      application_id: applicationId,
      user_name: userName,
      user_active: active,
    },
    timeoutMs,
  );
}

// Params verified against the live method tree (voximplant.com/api/v2/getDoc
// ?fqdn=references.httpapi.users.adduser, fetched 2026-08-21). Every field the
// API accepts is represented — the always-required ones as plain arguments,
// every other one (לא חובה) inside `opts`:
//   application_id      — the app a new user is bound to. Required unless
//                          opts.applicationName is used instead.
//   user_name           — [a-z0-9][a-z0-9_-]{2,49}. Required.
//   user_password       — ≥8 chars, upper+lower+digit+special. Required.
//   user_display_name   — (לא חובה) — only sent when non-empty. Voximplant's
//                          own doc marks it required, but an empty string is
//                          never useful here.
//   user_active         — (לא חובה) whether the user can log in. We always
//                          pass true.
//   opts.applicationName — (לא חובה) alternative to application_id. Not used
//                          by KALFA today — app_settings stores only the
//                          numeric id — kept here for full API parity.
//   opts.parentAccounting — (לא חובה) use the parent account's balance
//                          instead of a separate one. Not set by KALFA today.
//   opts.userCustomData  — (לא חובה) arbitrary string. Not set by KALFA today.
export interface AddVoximplantUserOptions {
  applicationName?: string;
  parentAccounting?: boolean;
  userCustomData?: string;
  timeoutMs?: number;
}
export interface AddUserResponse {
  result?: number;
  user_id?: number;
  error?: { code: number; msg: string };
}
export function addVoximplantUser(
  config: VoximplantConfig,
  applicationId: number,
  userName: string,
  userPassword: string,
  userDisplayName?: string,
  opts?: AddVoximplantUserOptions,
): Promise<AddUserResponse> {
  if (!VOX_USER_NAME_PATTERN.test(userName)) {
    // Fail before the network call so a bad name is a clear local error rather
    // than an opaque API rejection mid-provisioning.
    return Promise.reject(
      new Error(`שם משתמש Voximplant אינו תקין: ${userName}`),
    );
  }
  const params: VoxParams = {
    application_id: applicationId,
    user_name: userName,
    user_password: userPassword,
    user_active: true,
  };
  if (userDisplayName) params.user_display_name = userDisplayName;
  if (opts?.applicationName) params.application_name = opts.applicationName;
  if (opts?.parentAccounting !== undefined) params.parent_accounting = opts.parentAccounting;
  if (opts?.userCustomData) params.user_custom_data = opts.userCustomData;
  return voxRequest<AddUserResponse>(config, 'AddUser', params, opts?.timeoutMs);
}

// DelUser — params verified against the live method tree (voximplant.com/api/
// v2/getDoc?fqdn=references.httpapi.users.deluser, fetched 2026-08-21). Every
// field the API accepts is represented:
//   application_id      — the app the user(s) are bound to. Required unless
//                          opts.applicationName is used instead.
//   user_name            — semicolon-separated list, or 'all'. Required
//                          unless opts.userId is given.
//   opts.applicationName — (לא חובה) alternative to application_id. Not used
//                          by KALFA today (same reason as AddUser).
//   opts.userId          — (לא חובה) alternative to user_name — a numeric
//                          Voximplant user id (or semicolon list / 'all').
//                          Not used by KALFA today: console_agents stores only
//                          vox_username, never Voximplant's own numeric id.
//                          When given, it REPLACES user_name in the request
//                          (the API takes one or the other, never both).
//
// Deletes the Voximplant-side identity a console agent's removal leaves
// behind. Without this, removeConsoleAgent only deletes the KALFA-side row —
// the Voximplant user (whose name is DETERMINISTIC, agent_<user_id>) survives
// orphaned, and every future AddUser for the same person collides with it
// forever (the exact bug this closes).
export interface DelVoximplantUserOptions {
  applicationName?: string;
  userId?: number | string;
  timeoutMs?: number;
}
export interface DelUserResponse {
  result?: number;
  error?: { code: number; msg: string };
}
export function delVoximplantUser(
  config: VoximplantConfig,
  applicationId: number,
  userName: string,
  opts?: DelVoximplantUserOptions,
): Promise<DelUserResponse> {
  // opts.userId REPLACES user_name below, so the local pattern check only
  // applies when user_name is actually the one being sent.
  if (opts?.userId === undefined && !VOX_USER_NAME_PATTERN.test(userName)) {
    return Promise.reject(
      new Error(`שם משתמש Voximplant אינו תקין: ${userName}`),
    );
  }
  const params: VoxParams = { application_id: applicationId };
  if (opts?.applicationName) params.application_name = opts.applicationName;
  if (opts?.userId !== undefined) {
    params.user_id = opts.userId;
  } else {
    params.user_name = userName;
  }
  return voxRequest<DelUserResponse>(config, 'DelUser', params, opts?.timeoutMs);
}
