import { createSign } from 'node:crypto';

// Voximplant Management API — runtime-agnostic core (no `server-only` guard, so
// both the Next server module `./client` and the in-repo CLI `./cli` can share
// ONE implementation instead of re-hand-rolling JWT+fetch per call).
//
// WHY fetch (no SDK): the official `@voximplant/apiclient-nodejs` pins abandoned
// axios@0.21.4 + form-data@2.5.1 with ~22 unfixable advisories (verified
// 2026-07-14). Voximplant's own agent-skill sanctions "Direct HTTPS requests
// when the official client is too heavy" — so this is the DOCUMENTED path.
// Zero dependencies: the JWT is signed with Node's built-in `crypto`.
//
// Auth (verified against docs.voximplant.ai/platform/management-api/authorization):
//   service-account JSON → RS256 JWT → `Authorization: Bearer <jwt>`.
//   JWT header  { typ:'JWT', alg:'RS256', kid:key_id }
//   JWT payload { iss:account_id, iat:now, exp:now+≤3600 }
//   Endpoint    POST https://api.voximplant.com/platform_api/<Method>/

const MGMT_BASE = 'https://api.voximplant.com/platform_api';
const JWT_TTL_SECONDS = 3600; // Voximplant hard max.
const DEFAULT_TIMEOUT_MS = 20_000; // Node/undici fetch has no default timeout.

// The three fields of the downloaded service-account JSON key. The private key is
// a secret — sourced server-side / from a gitignored file only, never logged.
export interface VoximplantConfig {
  accountId: number | string; // JSON `account_id`
  keyId: string; // JSON `key_id`
  privateKey: string; // JSON `private_key` (RSA PEM)
}

// A Voximplant Management API business error (envelope `{ error: { code, msg } }`).
export class VoximplantApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'VoximplantApiError';
  }
}

// A transport / non-2xx / unparseable-response failure (distinct from a business
// error, so callers can retry transport but not a definitive rejection).
export class VoximplantNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoximplantNetworkError';
  }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

// Build a short-lived RS256 JWT for one request. Signed with node:crypto — no deps.
// `now` is injectable for deterministic tests.
export function signManagementJwt(
  config: VoximplantConfig,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const header = { typ: 'JWT', alg: 'RS256', kid: config.keyId };
  const payload = {
    iss: String(config.accountId),
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(payload),
  )}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(config.privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

export type VoxParams = Record<
  string,
  string | number | boolean | null | undefined
>;

// Call any Management API method. Params are form-urlencoded (skips null/undefined).
// Throws VoximplantApiError on a business error envelope, VoximplantNetworkError on
// transport/parse/non-2xx. NEVER logs params or the token (may carry PII/secrets).
export async function voxRequest<T = unknown>(
  config: VoximplantConfig,
  method: string,
  params: VoxParams = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const token = signManagementJwt(config);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) body.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(`${MGMT_BASE}/${method}/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      // Node/undici `fetch` has NO default timeout — without this an unresponsive
      // Management API would hang the worker forever, and the outbound trigger's
      // "ambiguous timeout → start_unknown" path could never fire. The abort throws
      // here and is (correctly) classified below as a VoximplantNetworkError.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new VoximplantNetworkError('שגיאת תקשורת עם מערכת השיחות');
  }
  if (!res.ok) {
    throw new VoximplantNetworkError(
      `תגובה לא תקינה ממערכת השיחות (${res.status})`,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new VoximplantNetworkError('תגובה לא תקינה ממערכת השיחות');
  }

  // Management API returns a top-level `{ error: { code, msg } }` on failure.
  const err = (json as { error?: { code?: number; msg?: string } } | null)
    ?.error;
  if (err) {
    throw new VoximplantApiError(
      err.msg ?? 'שגיאה ממערכת השיחות',
      err.code ?? null,
    );
  }
  return json as T;
}

// --- Typed Management API wrappers -------------------------------------------
//
// Each method has a FIXED request/response type (no generic `<T = unknown>`), and
// every wrapper that carries a mandatory id (application_id / history_report_id)
// (1) omits that id from its params type so a caller cannot pass it, and
// (2) sets the id AFTER the `...params` spread so it can never be overridden.
// This is the ONLY place Management API method names are used — the CLI/server
// never builds a raw call.

// GetAccountInfo — read-only connectivity check + balance.
export interface AccountInfo {
  account_id: number;
  account_name: string;
  account_email: string;
  active: boolean;
  currency: string;
  balance: number;
  created: string;
}
export interface GetAccountInfoResponse {
  result: AccountInfo;
}
export function getAccountInfo(
  config: VoximplantConfig,
  timeoutMs?: number,
): Promise<GetAccountInfoResponse> {
  return voxRequest<GetAccountInfoResponse>(config, 'GetAccountInfo', {}, timeoutMs);
}

// GetPhoneNumbers — READ-ONLY list of the account's phone numbers (used to find a
// usable Caller ID). NEVER purchases, attaches, deactivates, or modifies a number.
// Fields absent for a given number arrive as null/undefined. No secret data.
export interface PhoneNumberInfo {
  phone_id: number;
  phone_number: string;
  phone_name?: string | null; // an optional operator-set label
  phone_country_code?: string | null;
  deactivated?: boolean;
  can_be_used?: boolean;
  application_id?: number | null; // set when the number is bound to an application
  application_name?: string | null;
  rule_id?: number | null; // set when the number is bound to a routing rule
  rule_name?: string | null;
}
export interface GetPhoneNumbersResponse {
  result: PhoneNumberInfo[];
  total_count: number;
}
export function getPhoneNumbers(
  config: VoximplantConfig,
  timeoutMs?: number,
): Promise<GetPhoneNumbersResponse> {
  return voxRequest<GetPhoneNumbersResponse>(config, 'GetPhoneNumbers', {}, timeoutMs);
}

// GetTransactionHistory — READ-ONLY ledger of account debits/credits (to see what
// the balance is spent on: phone-number rent, call/SMS charges, top-ups, etc.).
// Amounts follow the API sign convention (charges typically negative). No secrets.
// Field names per the official TransactionInfoType docs
// (voximplant.com/docs/references/httpapi/structure/transactioninfotype):
// the date is `performed_at` (NOT transaction_date) and the text is
// `transaction_description` (NOT comment).
export interface TransactionInfo {
  transaction_id: number;
  performed_at: string; // "YYYY-MM-DD HH:mm:ss" in the account's timezone
  transaction_type: string;
  amount: number;
  currency?: string | null;
  transaction_description?: string | null;
}
export interface GetTransactionHistoryResponse {
  result: TransactionInfo[];
  total_count: number;
  timezone?: string | null;
}
export interface GetTransactionHistoryRequest {
  from_date: string; // "YYYY-MM-DD HH:MM:SS" (account timezone / UTC)
  to_date: string;
  transaction_type?: string; // optional CSV filter
  count?: number;
  offset?: number; // pagination — skip this many rows
}
export function getTransactionHistory(
  config: VoximplantConfig,
  params: GetTransactionHistoryRequest,
  timeoutMs?: number,
): Promise<GetTransactionHistoryResponse> {
  // from_date/to_date are mandatory — set AFTER the spread so they can't be dropped.
  return voxRequest<GetTransactionHistoryResponse>(
    config,
    'GetTransactionHistory',
    { ...params, from_date: params.from_date, to_date: params.to_date },
    timeoutMs,
  );
}

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

// GetApplications
export interface ApplicationInfo {
  application_id: number;
  application_name: string;
}
export interface GetApplicationsRequest {
  count?: number;
  offset?: number;
  application_id?: number;
  application_name?: string;
}
export interface GetApplicationsResponse {
  result: ApplicationInfo[];
  total_count?: number;
}
export function getApplications(
  config: VoximplantConfig,
  params: GetApplicationsRequest = { count: 50 },
): Promise<GetApplicationsResponse> {
  return voxRequest<GetApplicationsResponse>(config, 'GetApplications', {
    ...params,
  });
}

// GetRules — `application_id` is intentionally absent from the request type and
// set after the spread so params cannot override it.
export interface ScenarioRef {
  scenario_id: number;
  scenario_name: string;
}
export interface RuleInfo {
  rule_id: number;
  rule_name: string;
  rule_pattern: string;
  scenarios?: ScenarioRef[];
}
export interface GetRulesRequest {
  count?: number;
  offset?: number;
  with_scenarios?: boolean;
  rule_name?: string;
}
export interface GetRulesResponse {
  result: RuleInfo[];
  total_count?: number;
}
export function getRules(
  config: VoximplantConfig,
  applicationId: number | string,
  params: GetRulesRequest = {},
): Promise<GetRulesResponse> {
  return voxRequest<GetRulesResponse>(config, 'GetRules', {
    count: 100,
    with_scenarios: true,
    ...params,
    application_id: applicationId,
  });
}

// GetCallHistoryAsync — queues an async CSV report, returns its id.
export interface GetCallHistoryAsyncRequest {
  from_date: string;
  to_date: string;
  application_id?: number;
  application_name?: string;
  with_calls?: boolean;
  with_records?: boolean;
  output?: 'csv';
  timezone?: string;
  desc_order?: boolean;
}
export interface GetCallHistoryAsyncResponse {
  result: number;
  history_report_id: number;
}
export function getCallHistoryAsync(
  config: VoximplantConfig,
  params: GetCallHistoryAsyncRequest,
): Promise<GetCallHistoryAsyncResponse> {
  return voxRequest<GetCallHistoryAsyncResponse>(
    config,
    'GetCallHistoryAsync',
    { ...params },
  );
}

// GetHistoryReports — `history_report_id` is absent from the request type and set
// after the spread so params cannot override it.
export interface HistoryReportInfo {
  history_report_id: number;
  completed?: string | null;
  file_name?: string;
  file_size?: number;
  format?: string;
}
export interface GetHistoryReportsRequest {
  count?: number;
  offset?: number;
}
export interface GetHistoryReportsResponse {
  result: HistoryReportInfo[];
  total_count?: number;
}
export function getHistoryReports(
  config: VoximplantConfig,
  historyReportId: number | string,
  params: GetHistoryReportsRequest = {},
): Promise<GetHistoryReportsResponse> {
  return voxRequest<GetHistoryReportsResponse>(config, 'GetHistoryReports', {
    ...params,
    history_report_id: historyReportId,
  });
}

// The raw (unclassified) response from DownloadHistoryReport. This endpoint is a
// GET that streams the CSV file on success but returns a JSON error envelope
// (e.g. code 356 "not ready") while the report is still generating — so callers
// MUST classify the body, not assume it is CSV.
export interface RawFileResponse {
  status: number;
  contentType: string;
  body: string;
}

export async function downloadHistoryReportRaw(
  config: VoximplantConfig,
  historyReportId: number | string,
): Promise<RawFileResponse> {
  const token = signManagementJwt(config);
  const res = await fetch(
    `${MGMT_BASE}/DownloadHistoryReport/?history_report_id=${encodeURIComponent(
      String(historyReportId),
    )}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body: await res.text(),
  };
}
