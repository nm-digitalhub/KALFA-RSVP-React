/**
 * Relocation wizard — Stage-F external-registration clients (plan Stage F,
 * design §6). Small fetch-based clients the wizard's mutating steps will call.
 *
 * Contract:
 * - Every MUTATING function checks the execute latch: it throws
 *   {@link RelocateExecuteLatchError} unless `RELOCATE_EXECUTE=1`. Read
 *   functions never check it. The latch is the plan-only build's hard floor —
 *   nothing in this module can touch an external service by accident.
 * - Mutations capture the PREVIOUS value first and return it as `prevValue`,
 *   so the engine can record the rollback inverse (state.ts externalCalls).
 * - Tokens travel in headers or POST bodies only — never in URLs — and are
 *   never interpolated into details, errors, or logs. Failure details carry
 *   status codes and generic transport text, nothing from credentials.
 *
 * Endpoints live-doc-verified 2026-08-23 (plan Stage F table): Supabase
 * Management API config/auth GET+PATCH and database/query; Meta app
 * subscriptions; MS Graph subscriptions (cert client-credentials flow, the
 * same shape as src/lib/microsoft/graph-client.ts:35-50 — that module is
 * `server-only` and cannot load under tsx, so the calls are made directly);
 * GA4 Admin API dataStreams.patch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export class RelocateExecuteLatchError extends Error {
  constructor() {
    super("execute latch is off — set RELOCATE_EXECUTE=1 to allow external mutations");
    this.name = "RelocateExecuteLatchError";
  }
}

function assertExecuteLatch(): void {
  if (process.env.RELOCATE_EXECUTE !== "1") throw new RelocateExecuteLatchError();
}

const TIMEOUT_MS = 10_000;

export interface ReadResult<T> {
  ok: boolean;
  detail: string;
  value?: T;
}

export interface MutationResult<TPrev> {
  ok: boolean;
  detail: string;
  /** What stood BEFORE the mutation — the rollback inverse. */
  prevValue?: TPrev;
}

/* ------------------------------------------------------------------------- *
 * Supabase Management API
 * ------------------------------------------------------------------------- */

/** Resolve the Management token: env first, then the linked CLI's own
 * credential file (~/.supabase/access-token — verified live 2026-08-23).
 * Returns null when neither exists; the value is returned, never logged. */
export function supabaseMgmtToken(opts: {
  env: Record<string, string>;
  homeDir?: string;
}): { token: string; source: "env" | "cli-file" } | null {
  const fromEnv = opts.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };
  const home = opts.homeDir ?? process.env.HOME;
  if (!home) return null;
  try {
    const raw = readFileSync(join(home, ".supabase", "access-token"), "utf8").trim();
    return raw ? { token: raw, source: "cli-file" } : null;
  } catch {
    return null;
  }
}

/** `<ref>.supabase.co` → `<ref>`. Throws on a host that does not look like a
 * Supabase project URL — a wrong ref must never silently hit someone else's. */
export function projectRefFromSupabaseUrl(supabaseUrl: string): string {
  const host = new URL(supabaseUrl).hostname;
  const ref = host.split(".")[0];
  if (!ref || !host.endsWith(".supabase.co")) {
    throw new Error(`cannot derive a project ref from host ${host}`);
  }
  return ref;
}

export interface SupabaseAuthConfig {
  site_url: string;
  uri_allow_list: string;
}

const MGMT_BASE = "https://api.supabase.com";

export async function getSupabaseAuthConfig(opts: {
  token: string;
  projectRef: string;
}): Promise<ReadResult<SupabaseAuthConfig>> {
  try {
    const res = await fetch(`${MGMT_BASE}/v1/projects/${opts.projectRef}/config/auth`, {
      method: "GET",
      headers: { authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { site_url?: string | null; uri_allow_list?: string | null };
    return {
      ok: true,
      detail: "auth config read",
      value: { site_url: body.site_url ?? "", uri_allow_list: body.uri_allow_list ?? "" },
    };
  } catch (err) {
    return { ok: false, detail: transportDetail(err) };
  }
}

/** MUTATING. Sets `site_url` and MERGES `additionalRedirects` into the
 * existing allow-list (never drops entries — the transitional window needs
 * old-origin redirects to keep working). Returns the previous config. */
export async function patchSupabaseAuthConfig(opts: {
  token: string;
  projectRef: string;
  siteUrl: string;
  additionalRedirects: string[];
}): Promise<MutationResult<SupabaseAuthConfig>> {
  assertExecuteLatch();
  const before = await getSupabaseAuthConfig(opts);
  if (!before.ok || !before.value) {
    return { ok: false, detail: `could not read current auth config (${before.detail})` };
  }
  const existing = before.value.uri_allow_list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...new Set([...existing, ...opts.additionalRedirects])].join(",");
  try {
    const res = await fetch(`${MGMT_BASE}/v1/projects/${opts.projectRef}/config/auth`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${opts.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ site_url: opts.siteUrl, uri_allow_list: merged }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, prevValue: before.value };
    return { ok: true, detail: `site_url → ${opts.siteUrl}`, prevValue: before.value };
  } catch (err) {
    return { ok: false, detail: transportDetail(err), prevValue: before.value };
  }
}

/** Stage G's door: POST /v1/projects/{ref}/database/query. Read-only queries
 * run freely; a write additionally requires the execute latch. */
export async function runSupabaseSql(opts: {
  token: string;
  projectRef: string;
  query: string;
  readOnly: boolean;
}): Promise<ReadResult<unknown>> {
  if (!opts.readOnly) assertExecuteLatch();
  try {
    const res = await fetch(`${MGMT_BASE}/v1/projects/${opts.projectRef}/database/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: opts.query, read_only: opts.readOnly }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, detail: "query ran", value: await res.json() };
  } catch (err) {
    return { ok: false, detail: transportDetail(err) };
  }
}

/* ------------------------------------------------------------------------- *
 * Meta — WhatsApp webhook subscription
 * ------------------------------------------------------------------------- */

/** MUTATING. Registers the app-level WhatsApp webhook. Meta then performs the
 * GET verify handshake against the callback (hub.verify_token must equal the
 * app_settings verify token — src/app/api/webhooks/whatsapp/route.ts:80-93),
 * so the route must already be live on the new origin. The app token rides in
 * the POST BODY (never the URL) so transport errors cannot carry it. */
export async function subscribeMetaWebhook(opts: {
  appId: string;
  appToken: string;
  callbackUrl: string;
  verifyToken: string;
}): Promise<MutationResult<undefined>> {
  assertExecuteLatch();
  try {
    const body = new URLSearchParams({
      object: "whatsapp_business_account",
      callback_url: opts.callbackUrl,
      verify_token: opts.verifyToken,
      fields: "messages",
      access_token: opts.appToken,
    });
    const res = await fetch(`https://graph.facebook.com/v21.0/${opts.appId}/subscriptions`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, detail: `webhook → ${opts.callbackUrl}` };
  } catch (err) {
    return { ok: false, detail: transportDetail(err) };
  }
}

/* ------------------------------------------------------------------------- *
 * Microsoft Graph — change-notification subscriptions
 * ------------------------------------------------------------------------- */

export interface GraphSubscriptionInfo {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
}

/** Same ceiling discipline as src/lib/microsoft/subscriptions.ts:21-36 (that
 * module is server-only and unloadable under tsx — the values are mirrored,
 * with the same minute of clock-skew headroom). */
const GRAPH_MAX_MINUTES = 4230;

function graphExpiry(): string {
  return new Date(Date.now() + (GRAPH_MAX_MINUTES - 1) * 60_000).toISOString();
}

/** Client-credentials token via the SAME cert flow as graph-client.ts:43
 * (ClientCertificateCredential), imported lazily so the CLI never loads
 * @azure/identity unless a Graph step actually runs. */
async function graphToken(env: Record<string, string>): Promise<string> {
  const tenantId = env.MS_GRAPH_TENANT_ID;
  const clientId = env.MS_GRAPH_CLIENT_ID;
  const certPath = env.MS_GRAPH_CERT_PATH;
  if (!tenantId || !clientId || !certPath) throw new Error("graph_config_missing");
  const { ClientCertificateCredential } = await import("@azure/identity");
  const credential = new ClientCertificateCredential(tenantId, clientId, certPath);
  const token = await credential.getToken("https://graph.microsoft.com/.default");
  if (!token?.token) throw new Error("graph_token_unavailable");
  return token.token;
}

export async function listGraphSubscriptions(opts: {
  env: Record<string, string>;
}): Promise<ReadResult<GraphSubscriptionInfo[]>> {
  try {
    const token = await graphToken(opts.env);
    const res = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { value?: GraphSubscriptionInfo[] };
    return { ok: true, detail: "subscriptions listed", value: body.value ?? [] };
  } catch (err) {
    return { ok: false, detail: transportDetail(err) };
  }
}

/** MUTATING. Deletes the old-origin subscription (when given) and creates a
 * fresh one against the new notification URL. Graph validates the URL
 * synchronously (validationToken echo within 10s — subscriptions.ts:84-90),
 * so the webhook route must already be deployed on the new origin. */
export async function recreateGraphSubscription(opts: {
  env: Record<string, string>;
  deleteId?: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  clientState: string;
}): Promise<MutationResult<{ deletedId: string | null }>> {
  assertExecuteLatch();
  try {
    const token = await graphToken(opts.env);
    let deletedId: string | null = null;
    if (opts.deleteId) {
      const del = await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(opts.deleteId)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (del.ok || del.status === 404) deletedId = opts.deleteId;
      else return { ok: false, detail: `delete failed: HTTP ${del.status}` };
    }
    const res = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        changeType: opts.changeType,
        notificationUrl: opts.notificationUrl,
        resource: opts.resource,
        expirationDateTime: graphExpiry(),
        clientState: opts.clientState,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `create failed: HTTP ${res.status}`, prevValue: { deletedId } };
    return { ok: true, detail: `subscription → ${opts.notificationUrl}`, prevValue: { deletedId } };
  } catch (err) {
    return { ok: false, detail: transportDetail(err) };
  }
}

/* ------------------------------------------------------------------------- *
 * GA4 Admin API — data-stream default URI
 * ------------------------------------------------------------------------- */

/** MUTATING. PATCHes the web stream's defaultUri (GA Admin API
 * dataStreams.patch, analytics.edit scope). Auth via ADC — the same
 * GOOGLE_APPLICATION_CREDENTIALS the analytics stack already uses
 * (ga4-client.ts:5-7); google-auth-library is imported lazily. Captures the
 * previous defaultUri first as the rollback inverse. */
export async function patchGa4StreamUri(opts: {
  propertyId: string;
  streamId: string;
  uri: string;
}): Promise<MutationResult<{ defaultUri: string }>> {
  assertExecuteLatch();
  const streamPath = `properties/${opts.propertyId}/dataStreams/${opts.streamId}`;
  const base = "https://analyticsadmin.googleapis.com/v1beta";
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/analytics.edit"] });
    const token = await auth.getAccessToken();
    if (!token) return { ok: false, detail: "no ADC access token" };
    const headers = { authorization: `Bearer ${token}` };

    const beforeRes = await fetch(`${base}/${streamPath}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!beforeRes.ok) return { ok: false, detail: `read failed: HTTP ${beforeRes.status}` };
    const before = (await beforeRes.json()) as { webStreamData?: { defaultUri?: string } };
    const prevValue = { defaultUri: before.webStreamData?.defaultUri ?? "" };

    const res = await fetch(`${base}/${streamPath}?updateMask=webStreamData.defaultUri`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ webStreamData: { defaultUri: opts.uri } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, prevValue };
    return { ok: true, detail: `defaultUri → ${opts.uri}`, prevValue };
  } catch (err) {
    return { ok: false, detail: transportDetail(err) };
  }
}

/* ------------------------------------------------------------------------- */

/** Generic transport failure text. Credentials travel in headers/POST bodies
 * only, so runtime error messages cannot contain them; this trims noise and
 * normalizes timeouts. */
function transportDetail(err: unknown): string {
  const e = err as Error;
  if (e?.name === "TimeoutError") return "timeout";
  return e?.message?.slice(0, 200) || "transport error";
}
