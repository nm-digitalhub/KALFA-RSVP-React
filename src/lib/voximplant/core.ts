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
// `status` carries the HTTP status when one was received (e.g. 429 for rate
// limiting) so retry policies can classify without parsing the message text.
export class VoximplantNetworkError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
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

  // Read the body as TEXT first, then check status + Content-Type, and only
  // then JSON.parse — so a non-JSON body (HTML error page, empty body) is
  // classified as a network-layer failure and never reaches JSON.parse blind.
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new VoximplantNetworkError('תגובה לא תקינה ממערכת השיחות');
  }
  if (!res.ok) {
    throw new VoximplantNetworkError(
      `תגובה לא תקינה ממערכת השיחות (${res.status})`,
      res.status,
    );
  }
  const contentType = (res.headers?.get('content-type') ?? '').toLowerCase();
  const stripped = text.replace(/^\uFEFF/, '').trimStart();
  const looksJson =
    contentType.includes('application/json') ||
    stripped.startsWith('{') ||
    stripped.startsWith('[');
  if (!looksJson) {
    throw new VoximplantNetworkError('תגובה לא תקינה ממערכת השיחות');
  }
  let json: unknown;
  try {
    json = JSON.parse(stripped);
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

// --- Bounded retry for READ-ONLY calls ----------------------------------------
//
// Retry policy per the Management API's documented failure modes:
//   HTTP 429                        — too many concurrent/parallel requests
//   API code 340 RATE_LIMIT_EXCEED  — per-method rate limit
//   API code 515 SAME_OPERATION_... — identical operation repeated too fast
//   API code 456 TOKEN_EXPIRED      — JWT expired (clock skew); every voxRequest
//                                     signs a FRESH JWT, so one immediate retry
//                                     is the renewal — never more than once.
// Opt-in by design: existing server/worker callers keep their fail-fast
// behavior (the outbound trigger's timeout classification depends on it); the
// CLI wraps its read-only calls. NEVER wrap StartScenarios — a blind retry
// could place a second live call.
export const VOX_RETRYABLE_API_CODES: ReadonlySet<number> = new Set([340, 515]);
export const VOX_TOKEN_EXPIRED_CODE = 456;

export interface VoxRetryOptions {
  attempts?: number; // total attempts including the first (default 4)
  baseDelayMs?: number; // first backoff delay, doubles each retry (default 1000)
  sleep?: (ms: number) => Promise<void>; // injectable for tests
}

export async function voxRetry<T>(
  run: () => Promise<T>,
  opts: VoxRetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let tokenRetryUsed = false;
  let delayMs = baseDelayMs;
  let attempt = 1;
  for (;;) {
    try {
      return await run();
    } catch (e) {
      if (
        e instanceof VoximplantApiError &&
        e.code === VOX_TOKEN_EXPIRED_CODE &&
        !tokenRetryUsed
      ) {
        tokenRetryUsed = true; // re-run signs a fresh JWT — the one-time renewal
        continue;
      }
      const retryable =
        (e instanceof VoximplantNetworkError && e.status === 429) ||
        (e instanceof VoximplantApiError &&
          e.code !== null &&
          VOX_RETRYABLE_API_CODES.has(e.code));
      if (!retryable || attempt >= attempts) throw e;
      await sleep(delayMs);
      delayMs *= 2;
      attempt += 1;
    }
  }
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
  // Account-callback echo (plan B5). UNVERIFIED against live responses —
  // AccountInfoType's full field list is not in the research corpus; treat as
  // optional and confirm at the stage-6 wiring gate (a panel/first-callback
  // fallback is specced if the echo turns out to be absent).
  callback_url?: string | null;
  callback_salt?: string | null;
}
export interface GetAccountInfoResponse {
  result: AccountInfo;
}
export interface GetAccountInfoOptions {
  // Ask the API for the LIVE balance (not the cached one) — used by the
  // account-callback verified pull. Optional to keep every existing call site
  // source-compatible.
  returnLiveBalance?: boolean;
}
export function getAccountInfo(
  config: VoximplantConfig,
  timeoutMs?: number,
  opts: GetAccountInfoOptions = {},
): Promise<GetAccountInfoResponse> {
  return voxRequest<GetAccountInfoResponse>(
    config,
    'GetAccountInfo',
    opts.returnLiveBalance ? { return_live_balance: true } : {},
    timeoutMs,
  );
}

// GetAutochargeConfig — READ-ONLY view of the account's automatic top-up setup.
//
// Voximplant exposes NO setter for this: the whole accounts category is 15
// methods, of which only SetAccountInfo and SetChildAccountInfo write, and
// neither touches autocharge. Enabling it is a support ticket (done for this
// account on 2026-07-21). So this reads back what support configured — the only
// programmatic visibility that exists.
//
// Worth having because the balance floor stopped being a natural brake the
// moment autocharge was enabled: before, a runaway would exhaust the balance and
// halt; now it silently refills. Knowing the recharge amount and threshold is
// what makes the spend ceiling calculable instead of assumed.
//
// Field names are NOT pinned to an interface: the documented result type
// (GetAutochargeConfigResultType) publishes no field list beyond auto_charge, so
// asserting a shape here would be inventing one. The CLI prints whatever comes
// back.
export function getAutochargeConfig(
  config: VoximplantConfig,
  timeoutMs?: number,
): Promise<{ result?: Record<string, unknown> }> {
  return voxRequest<{ result?: Record<string, unknown> }>(
    config,
    'GetAutochargeConfig',
    {},
    timeoutMs,
  );
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

// NOTE: this module is READ-ONLY by design (owner directive). Mutating
// wrappers (StartScenarios, the restricted SetAccountInfo) live in
// `./mutations`, which the CLI never imports — a guard test pins both facts.

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

// GetCallHistory (SYNCHRONOUS) — returns sessions (with records) immediately for a
// bounded query. Used to resolve a single call's recording URL by session id, far
// faster than the async CSV report. Requires a from/to window; filter by
// call_session_history_id to get exactly one session back.
export interface GetCallHistoryRequest {
  from_date: string;
  to_date: string;
  call_session_history_id?: number;
  application_id?: number;
  with_records?: boolean;
  with_calls?: boolean;
  // Include auxiliary session resources (log_file_url et al) in the response —
  // used by the log-export job (plan A4).
  with_other_resources?: boolean;
  count?: number;
  output?: 'json';
}
export interface CallHistoryRecord {
  record_url?: string;
  record_id?: number;
  record_duration?: number;
}
export interface CallHistorySession {
  call_session_history_id: number;
  records?: CallHistoryRecord[];
  // Base CallSessionInfoType fields consumed by the log-export job. The URL is
  // UNTRUSTED — it must pass src/lib/voximplant/log-download.ts gates before
  // any fetch (plan §8).
  log_file_url?: string;
  custom_data?: string;
  start_date?: string;
  duration?: number;
  finish_reason?: string;
}
export interface GetCallHistoryResponse {
  result: CallHistorySession[];
  total_count?: number;
}
export function getCallHistory(
  config: VoximplantConfig,
  params: GetCallHistoryRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GetCallHistoryResponse> {
  return voxRequest<GetCallHistoryResponse>(
    config,
    'GetCallHistory',
    { with_records: true, count: 100, output: 'json', ...params },
    timeoutMs,
  );
}

// --- A1: CallLists (READ-ONLY observation; creation/edit is out of scope) ----

// GetCallLists — list server-side dialing campaigns. Filters per
// httpapi/calllists: list_id (intlist or 'all'), name, is_active, UTC
// from_date/to_date, application_id, type_list, count/offset. The response
// rows are UNTRUSTED and must go through normalizeCallList before any UI.
export interface GetCallListsRequest {
  list_id?: number | string;
  name?: string;
  is_active?: boolean;
  from_date?: string;
  to_date?: string;
  application_id?: number;
  type_list?: 'AUTOMATIC' | 'MANUAL';
  count?: number;
  offset?: number;
}
export interface GetCallListsResponse {
  result: unknown[]; // CallListType[] — normalized downstream, never trusted raw
  count?: number;
  total_count?: number;
}
export function getCallLists(
  config: VoximplantConfig,
  params: GetCallListsRequest = {},
  timeoutMs?: number,
): Promise<GetCallListsResponse> {
  return voxRequest<GetCallListsResponse>(config, 'GetCallLists', { ...params }, timeoutMs);
}

// GetCallListDetails — per-task export for ONE list. `list_id` is excluded
// from the params type and set AFTER the spread; `output:'json'` is FORCED
// after the spread so a caller can never flip the response to csv/xls.
// Task rows carry guest PII in custom_data/result_data — normalize to
// metadata-only before anything user-facing (plan §4).
export interface GetCallListDetailsRequest {
  batch_id?: string;
  count?: number;
  offset?: number;
}
export interface GetCallListDetailsResponse {
  result: unknown[]; // CallListDetailType[] — normalized downstream
  count?: number;
  total_count?: number;
}
export function getCallListDetails(
  config: VoximplantConfig,
  listId: number | string,
  params: GetCallListDetailsRequest = {},
  timeoutMs?: number,
): Promise<GetCallListDetailsResponse> {
  return voxRequest<GetCallListDetailsResponse>(
    config,
    'GetCallListDetails',
    { count: 100, ...params, list_id: listId, output: 'json' },
    timeoutMs,
  );
}

// --- A3: GetAuditLog (Owner-role-only per docs — expect VoximplantApiError
// with a forbidden code under the service-account key; every caller must
// degrade gracefully, never hard-fail a page) -------------------------------
export interface GetAuditLogRequest {
  from_date: string;
  to_date: string;
  filtered_cmd?: string; // semicolon-separated command list
  count?: number;
  offset?: number;
}
export interface GetAuditLogResponse {
  result: unknown[]; // AuditLogInfoType[] — field list unconfirmed; normalized downstream
  count?: number;
  total_count?: number;
}
export function getAuditLog(
  config: VoximplantConfig,
  params: GetAuditLogRequest,
  timeoutMs?: number,
): Promise<GetAuditLogResponse> {
  // from/to are mandatory — re-set after the spread (getTransactionHistory idiom).
  return voxRequest<GetAuditLogResponse>(
    config,
    'GetAuditLog',
    { ...params, from_date: params.from_date, to_date: params.to_date },
    timeoutMs,
  );
}

// --- A2: GetMediaResources — firewall-allowlist inventory -------------------
//
// NOT a /platform_api method: a bare GET on https://api.voximplant.com/
// getMediaResources with presence-style query flags and NO Authorization
// header (both getting-started §Firewall and the child-accounts guide show it
// as a plain URL — public by design). Response shape is undocumented → raw
// JSON out, extractIpStrings() downstream.
export interface GetMediaResourcesFlags {
  with_nodes?: boolean;
  with_jsservers?: boolean;
  with_mediaservers?: boolean;
  with_webgateways?: boolean;
  with_sbcs?: boolean;
  with_videoconverters?: boolean;
}
export async function getMediaResources(
  flags: GetMediaResourcesFlags = { with_jsservers: true },
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const query = Object.entries(flags)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .join('&');
  let res: Response;
  try {
    res = await fetch(`https://api.voximplant.com/getMediaResources${query ? `?${query}` : ''}`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new VoximplantNetworkError('שגיאת תקשורת עם מערכת השיחות');
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new VoximplantNetworkError('תגובה לא תקינה ממערכת השיחות');
  }
  if (!res.ok) {
    throw new VoximplantNetworkError(
      `תגובה לא תקינה ממערכת השיחות (${res.status})`,
      res.status,
    );
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '').trimStart());
  } catch {
    throw new VoximplantNetworkError('תגובה לא תקינה ממערכת השיחות');
  }
}

// Download a secure Voximplant asset (recording / log) that 401s to an anonymous
// GET. Authenticated with the same Management-API RS256 JWT. Returns the bytes;
// NEVER logs the token. Throws VoximplantNetworkError on a non-2xx/transport error.
export async function downloadSecureUrl(
  config: VoximplantConfig,
  url: string,
  timeoutMs: number = 30_000,
): Promise<Buffer> {
  const token = signManagementJwt(config);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new VoximplantNetworkError(
      `secure download transport error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) {
    throw new VoximplantNetworkError(`secure download failed: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
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
