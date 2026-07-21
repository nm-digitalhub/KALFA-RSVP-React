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
