import {
  voxRequest,
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
