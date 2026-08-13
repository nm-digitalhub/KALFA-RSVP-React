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
  timeoutMs?: number,
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
  return voxRequest<AddUserResponse>(config, 'AddUser', params, timeoutMs);
}
