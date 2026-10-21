/**
 * Relocation wizard — environment-parameter validation catalog (design §5c).
 *
 * Every key the setup form collects is classified and, where a service stands
 * behind it, validated with a REAL read-only probe — a cheap authenticated
 * call that proves the credential works and distinguishes "the service
 * rejected the key" from "the service is unreachable". Probe endpoints were
 * verified against LIVE vendor documentation on 2026-08-23 (sources in the
 * design doc §5c table).
 *
 * Security contract: probe functions receive values in-process and return
 * ONLY a classification — never the value, never response bodies. Callers
 * (the setup form server, step I4) must not log inputs.
 */
import { z } from "zod";

export type EnvKeyKind =
  | "probe" // live read-only API probe available
  | "format" // format/zod rule only (app-internal secret or plain config)
  | "generated" // the wizard GENERATES it (never user-entered)
  | "db-settings"; // lives in app_settings (DB), not in env — out of form scope

export type ProbeId =
  | "supabase-anon"
  | "supabase-service-role"
  | "supabase-mgmt"
  | "supabase-db"
  | "graph-app"
  | "graph-mailbox"
  | "resend"
  | "elevenlabs"
  | "meta-token"
  | "vapid-local"
  | "voximplant"
  | "ga4";

export interface EnvKeySpec {
  key: string;
  kind: EnvKeyKind;
  /** zod rule for the raw string value (format layer). */
  format: z.ZodType<string>;
  /** probe this key participates in (several keys can share one probe). */
  probe?: ProbeId;
  /** allowed to be skipped with an explicit override (recorded in openItems). */
  skippable?: boolean;
  /** not required for the APP to run (wizard-only key) — missingEnvKeys
   * excludes it from the install gate; validation still applies when set. */
  optional?: boolean;
}

const httpsOrigin = z
  .string()
  .regex(/^https:\/\/[^/\s]+$/, "must be a bare https origin");
const url = z.url();
const nonEmpty = z.string().min(1);
const boolStr = z.enum(["true", "false"]);
const numeric = z.string().regex(/^\d+$/, "must be numeric");
const hex32 = z.string().regex(/^[0-9a-f]{64}$/i, "expected openssl rand -hex 32");
const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/, "expected base64url");

/** The full catalog — MUST stay 1:1 with .env.example (the wizard's key
 * source of truth); the test enforces that. */
export const ENV_KEY_SPECS: readonly EnvKeySpec[] = [
  // Supabase
  { key: "NEXT_PUBLIC_SUPABASE_URL", kind: "probe", format: httpsOrigin, probe: "supabase-anon" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", kind: "probe", format: nonEmpty, probe: "supabase-anon" },
  { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", kind: "probe", format: nonEmpty, probe: "supabase-anon" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", kind: "probe", format: nonEmpty, probe: "supabase-service-role" },
  // Management API token (sbp_...) — wizard-only: stage F PATCHes auth
  // config, stage G may run SQL via /v1/projects/{ref}/database/query
  // (read_only flag supported). Live-doc-verified 2026-08-23.
  { key: "SUPABASE_ACCESS_TOKEN", kind: "probe", format: z.string().min(20), probe: "supabase-mgmt", optional: true },
  { key: "SUPABASE_DB_HOST", kind: "probe", format: nonEmpty, probe: "supabase-db" },
  { key: "SUPABASE_DB_PORT", kind: "probe", format: numeric, probe: "supabase-db" },
  { key: "SUPABASE_DB_NAME", kind: "probe", format: nonEmpty, probe: "supabase-db" },
  { key: "SUPABASE_DB_USER", kind: "probe", format: nonEmpty, probe: "supabase-db" },
  { key: "SUPABASE_DB_PASSWORD", kind: "probe", format: nonEmpty, probe: "supabase-db" },
  // SUMIT — no documented read-only endpoint (design §5c): format-only, skippable.
  { key: "NEXT_PUBLIC_SUMIT_COMPANY_ID", kind: "format", format: numeric, skippable: true },
  { key: "NEXT_PUBLIC_SUMIT_API_PUBLIC_KEY", kind: "format", format: nonEmpty, skippable: true },
  { key: "SUMIT_API_KEY", kind: "format", format: nonEmpty, skippable: true },
  // App origin + ops
  { key: "APP_ORIGIN", kind: "format", format: httpsOrigin },
  { key: "PGBOSS_DASHBOARD_URL", kind: "format", format: url },
  { key: "OPS_AGENT_TOKEN", kind: "format", format: z.string().min(16) },
  { key: "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", kind: "format", format: nonEmpty },
  { key: "RECONCILE_AUTHORIZED_SET_ENABLED", kind: "format", format: boolStr },
  { key: "DEVICE_TELEMETRY_ENABLED", kind: "format", format: boolStr },
  { key: "KALFA_CONSOLE_SECRET", kind: "format", format: z.string().min(16) },
  // MCP server (src/app/api/mcp): comma-separated lists; empty is a valid,
  // deliberate state (no OAuth client accepted / Origin not restricted), so
  // neither gates an install.
  { key: "KALFA_MCP_OAUTH_CLIENT_IDS", kind: "format", format: z.string(), optional: true },
  { key: "KALFA_MCP_ALLOWED_ORIGINS", kind: "format", format: z.string(), optional: true },
  // Microsoft Graph
  { key: "MS_GRAPH_TENANT_ID", kind: "probe", format: nonEmpty, probe: "graph-app" },
  { key: "MS_GRAPH_CLIENT_ID", kind: "probe", format: nonEmpty, probe: "graph-app" },
  { key: "MS_GRAPH_CERT_PATH", kind: "probe", format: nonEmpty, probe: "graph-app" },
  { key: "MS_GRAPH_PRIMARY_MAILBOX", kind: "probe", format: z.email(), probe: "graph-mailbox" },
  { key: "MS_GRAPH_INTAKE_FOLDER", kind: "format", format: nonEmpty },
  { key: "MS_GRAPH_WEBHOOK_SECRET", kind: "format", format: hex32 },
  { key: "EXCHANGE_PROVIDER", kind: "format", format: z.enum(["graph", "off"]) },
  { key: "EXCHANGE_EWS_ENCRYPTION_KEY", kind: "format", format: hex32 },
  // Email
  { key: "EMAIL_PROVIDER", kind: "format", format: z.enum(["resend", "smtp"]) },
  { key: "RESEND_API_KEY", kind: "probe", format: nonEmpty, probe: "resend" },
  // Signing secret for /api/webhooks/resend. Optional because a fresh
  // deployment has no webhook registered yet — but when it IS absent the
  // route answers 200 "not configured" and DROPS every delivery event, so a
  // relocation that skips it loses bounce visibility silently. Not probeable:
  // Resend returns the signing secret only at creation, never on read.
  {
    key: "RESEND_WEBHOOK_SECRET",
    kind: "format",
    format: z.string().min(1),
    optional: true,
  },
  // "אל תתקשר אליי" — the Do-Not-Call registry (src/lib/dnc). Optional: while call_compliance_settings
  // .dnc_registry_gate_enabled is off nothing needs it, and once it is on a deployment without it holds marketing dials
  // back as `registry_pending` (the mutator refuses with `not_configured`). Not probed: the only endpoint is the check
  // itself, which is logged at the authority under the account.
  { key: "DNC_API_NAME", kind: "format", format: nonEmpty, optional: true },
  { key: "DNC_API_TOKEN", kind: "format", format: nonEmpty, optional: true },
  // The numbers the ops scripts in scripts/voximplant/ may dial on their own say-so (src/lib/voximplant/test-numbers.ts).
  // Optional: without it those scripts refuse every --to.
  { key: "VOX_TEST_NUMBERS", kind: "format", format: nonEmpty, optional: true },
  // Workflow delegated OAuth — the deployment's own OAuth CLIENT, not a user's
  // connected account.
  //
  // ⚠️ OPTIONAL BY DESIGN, AND NOT A GAP. A deployment can register the same
  // client in `integration_provider_configs` instead, where the secret lives in
  // Vault and an operator gets a kill switch — and a row WINS over these two
  // whenever it exists (see `provider-availability.ts`). These are the
  // zero-configuration path, so a relocation that leaves them blank is a
  // complete relocation.
  //
  // Not probeable: verifying an OAuth client means redeeming a code, which needs
  // a human at a consent screen. A format check is all that can honestly run.
  {
    key: "INTEGRATION_OAUTH_MICROSOFT_CLIENT_ID",
    kind: "format",
    format: nonEmpty,
    optional: true,
  },
  {
    key: "INTEGRATION_OAUTH_MICROSOFT_CLIENT_SECRET",
    kind: "format",
    format: nonEmpty,
    optional: true,
  },
  // ElevenLabs
  { key: "ELEVENLABS_API_KEY", kind: "probe", format: nonEmpty, probe: "elevenlabs" },
  { key: "ELEVENLABS_WEBHOOK", kind: "format", format: nonEmpty },
  { key: "ELEVENLABS_SALES_WEBHOOK", kind: "format", format: nonEmpty },
  // Meta
  { key: "META_APP_ID", kind: "probe", format: numeric, probe: "meta-token" },
  { key: "META_APP_SECRET", kind: "probe", format: nonEmpty, probe: "meta-token" },
  { key: "META_ADS_ACCESS_TOKEN", kind: "probe", format: nonEmpty, probe: "meta-token" },
  { key: "META_IG_ACCESS_TOKEN", kind: "probe", format: nonEmpty, probe: "meta-token" },
  { key: "META_IG_ACCESS_TOKEN_EXPIRES_AT", kind: "format", format: nonEmpty },
  { key: "META_INSTAGRAM_BUSINESS_ACCOUNT_ID", kind: "format", format: numeric },
  // GA4
  { key: "NEXT_PUBLIC_GA_ID", kind: "format", format: z.string().regex(/^G-[A-Z0-9]+$/) },
  { key: "GA4_PROPERTY_ID", kind: "probe", format: numeric, probe: "ga4" },
  { key: "GA4_STREAM_ID", kind: "format", format: numeric },
  { key: "GA4_CHANNEL_GROUP_ID", kind: "format", format: nonEmpty },
  { key: "GOOGLE_APPLICATION_CREDENTIALS", kind: "probe", format: nonEmpty, probe: "ga4" },
  // Web push — GENERATED by the wizard (web-push generate-vapid-keys); only
  // the subject is user-entered. Local keypair validation, no network.
  { key: "NEXT_PUBLIC_VAPID_PUBLIC_KEY", kind: "generated", format: base64url, probe: "vapid-local" },
  { key: "VAPID_PRIVATE_KEY", kind: "generated", format: base64url, probe: "vapid-local" },
  { key: "VAPID_SUBJECT", kind: "probe", format: z.string().regex(/^(mailto:|https:)/), probe: "vapid-local" },
  // Voximplant
  { key: "VOX_CI_CREDENTIALS", kind: "probe", format: nonEmpty, probe: "voximplant" },
];

export type ProbeOutcome =
  | { ok: true }
  | { ok: false; class: "auth" | "network" | "format"; reason: string };

/** Hebrew feedback line per outcome class (design §5c — the two failure
 * classes must read differently). */
export function outcomeHe(outcome: ProbeOutcome): string {
  if (outcome.ok) return "אומת מול השירות";
  switch (outcome.class) {
    case "auth":
      return "המפתח נדחה על-ידי השירות";
    case "network":
      return "אין תקשורת לשירות — ייתכן שזו בעיית רשת, לא המפתח";
    case "format":
      return `ערך לא תקין: ${outcome.reason}`;
  }
}

/** Format-layer validation for one key. Pure. */
export function validateFormat(key: string, value: string): ProbeOutcome {
  const spec = ENV_KEY_SPECS.find((s) => s.key === key);
  if (!spec) return { ok: false, class: "format", reason: "unknown key" };
  const parsed = spec.format.safeParse(value);
  if (parsed.success) return { ok: true };
  return {
    ok: false,
    class: "format",
    reason: parsed.error.issues[0]?.message ?? "invalid",
  };
}

/** Classify an HTTP probe response: 2xx ok; 401/403 auth; anything the
 * transport threw is network. Pure — used by every fetch-based probe. */
export function classifyHttpProbe(input:
  | { kind: "response"; status: number }
  | { kind: "transport-error"; message: string }): ProbeOutcome {
  if (input.kind === "transport-error") {
    return { ok: false, class: "network", reason: input.message };
  }
  if (input.status >= 200 && input.status < 300) return { ok: true };
  if (input.status === 401 || input.status === 403) {
    return { ok: false, class: "auth", reason: `HTTP ${input.status}` };
  }
  // 404 on an object-lookup probe (wrong id) is a credential-class problem —
  // the caller knows better; default it to auth so it never masquerades as ok.
  return { ok: false, class: "auth", reason: `HTTP ${input.status}` };
}

async function fetchProbe(
  urlStr: string,
  init: RequestInit,
  timeoutMs = 8000,
): Promise<ProbeOutcome> {
  try {
    const res = await fetch(urlStr, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    // Bodies are deliberately not read: outcomes carry status classes only.
    return classifyHttpProbe({ kind: "response", status: res.status });
  } catch (err) {
    return classifyHttpProbe({
      kind: "transport-error",
      message: (err as Error).name === "TimeoutError" ? "timeout" : ((err as Error).message ?? "fetch failed"),
    });
  }
}

/** Live probes (design §5c table — each endpoint live-doc-verified 2026-08-23).
 * Values arrive as a plain map and are used ONLY inside the request. */
export const PROBES: Record<
  Exclude<ProbeId, "vapid-local" | "supabase-db" | "voximplant" | "ga4" | "graph-app" | "graph-mailbox">,
  (env: Record<string, string>) => Promise<ProbeOutcome>
> = {
  "supabase-anon": (env) =>
    fetchProbe(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
    }),
  "supabase-service-role": (env) =>
    fetchProbe(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
      },
    }),
  "supabase-mgmt": (env) =>
    fetchProbe("https://api.supabase.com/v1/projects", {
      headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN ?? ""}` },
    }),
  resend: (env) =>
    fetchProbe("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${env.RESEND_API_KEY ?? ""}` },
    }),
  elevenlabs: (env) =>
    fetchProbe("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY ?? "" },
    }),
  "meta-token": async (env) => {
    // debug_token checks the token AND the app pair in one read-only call.
    const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
    try {
      const res = await fetch(
        `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(env.META_ADS_ACCESS_TOKEN ?? "")}&access_token=${encodeURIComponent(appToken)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return { ok: false, class: "auth", reason: `HTTP ${res.status}` };
      const body = (await res.json()) as { data?: { is_valid?: boolean } };
      return body.data?.is_valid
        ? { ok: true }
        : { ok: false, class: "auth", reason: "token reported invalid" };
    } catch (err) {
      return { ok: false, class: "network", reason: (err as Error).message };
    }
  },
};

/** VAPID: local keypair validation via the installed web-push lib — throws on
 * a bad/mismatched pair; no network involved. The wizard GENERATES the pair
 * (webpush.generateVAPIDKeys()); this validates entered/migrated values. */
export async function probeVapidLocal(env: Record<string, string>): Promise<ProbeOutcome> {
  try {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(
      env.VAPID_SUBJECT ?? "",
      env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
      env.VAPID_PRIVATE_KEY ?? "",
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, class: "format", reason: (err as Error).message };
  }
}

// ── Supabase DB connection TARGET — a configuration check, not a connection ──
//
// Incident 2026-10-20/21: SUPABASE_DB_PORT=54322 (the LOCAL Supabase database
// port) was paired with the production pooler host in .env.local; the worker
// crash-looped for ~12 h on "connection timeout" and the web sender silently
// could not enqueue. This rule refuses that pairing BEFORE any connection is
// attempted, with a message that names the cause. It is pure (no network, no
// DNS) and is the ONE rule every connection site goes through (supabaseDbPort);
// probeSupabaseDb below is the separate, live connectivity check.

/** The ports a Supabase pooler serves: 5432 session mode, 6543 transaction mode. */
export const SUPABASE_POOLER_PORTS: readonly number[] = [5432, 6543];
const DEFAULT_DB_PORT = 5432;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A syntactically valid hostname that is `pooler.supabase.com` or under it,
 * compared label by label — never a substring match, so `evilpooler.supabase.com`
 * or `pooler.supabase.com.example.net` are not poolers. */
export function isSupabasePoolerHost(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (h.length === 0 || h.length > 253) return false;
  const labels = h.split(".");
  if (!labels.every((l) => HOST_LABEL.test(l))) return false;
  return labels.length >= 3 && labels.slice(-3).join(".") === "pooler.supabase.com";
}

type DbTargetEnv = Record<string, string | undefined>;

/** The ONE normalisation of SUPABASE_DB_PORT, used by the rule AND for the port
 * actually connected to: surrounding whitespace is ignored, unset / empty /
 * whitespace-only means the default 5432, anything but digits is NaN. */
function effectiveDbPort(raw: string | undefined): number {
  const v = (raw ?? "").trim();
  if (v === "") return DEFAULT_DB_PORT;
  return /^\d+$/.test(v) ? Number(v) : Number.NaN;
}

/** Production + a Supabase pooler host ⇒ the port must be 5432 or 6543 (an unset
 * port means the callers' default, 5432). Development / test and non-pooler
 * hosts keep their existing behaviour, 54322 included. The reason names the
 * port only — never the host, user, password or a connection string. */
export function checkSupabaseDbTarget(env: DbTargetEnv): ProbeOutcome {
  if (env.NODE_ENV !== "production" || !isSupabasePoolerHost(env.SUPABASE_DB_HOST)) return { ok: true };
  const port = effectiveDbPort(env.SUPABASE_DB_PORT);
  if (SUPABASE_POOLER_PORTS.includes(port)) return { ok: true };
  const shown = Number.isNaN(port) ? "(not a number)" : String(port);
  const local = port === 54322 ? " — 54322 is the LOCAL Supabase database port" : "";
  return {
    ok: false,
    class: "format",
    reason:
      `SUPABASE_DB_PORT=${shown} with a Supabase pooler host in production; ` +
      `allowed: 5432 (session pooler) or 6543 (transaction pooler)${local}`,
  };
}

export class DbConfigError extends Error {
  readonly code = "DB_CONFIG_INVALID";
  constructor(reason: string) {
    super(`invalid database configuration: ${reason}`);
    this.name = "DbConfigError";
  }
}

/** The port every connection site uses: validates the target first (throws
 * DbConfigError, nothing is opened), then returns the SAME normalised value the
 * rule judged (effectiveDbPort). */
export function supabaseDbPort(env: DbTargetEnv): number {
  const outcome = checkSupabaseDbTarget(env);
  if (!outcome.ok) throw new DbConfigError(outcome.reason);
  return effectiveDbPort(env.SUPABASE_DB_PORT);
}

/** Supabase DB (session pooler): connect + SELECT 1. 28P01 = bad password
 * (auth class); connection-level errors = network. The configuration rule runs
 * first: a refused target is a format failure and nothing is connected.
 * NODE_ENV in the given map can only TIGHTEN the rule: when this process runs in
 * production the rule applies whatever the map says. */
export async function probeSupabaseDb(env: Record<string, string>): Promise<ProbeOutcome> {
  const nodeEnv = process.env.NODE_ENV === "production" ? "production" : env.NODE_ENV;
  const target = checkSupabaseDbTarget({ ...env, NODE_ENV: nodeEnv });
  if (!target.ok) return target;
  const { Client } = await import("pg");
  const client = new Client({
    host: env.SUPABASE_DB_HOST,
    port: effectiveDbPort(env.SUPABASE_DB_PORT), // the value the rule above judged
    database: env.SUPABASE_DB_NAME,
    user: env.SUPABASE_DB_USER,
    password: env.SUPABASE_DB_PASSWORD,
    connectionTimeoutMillis: 8000,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "28P01" || code === "28000") {
      return { ok: false, class: "auth", reason: "database rejected the credentials" };
    }
    return { ok: false, class: "network", reason: code ?? (err as Error).message };
  } finally {
    await client.end().catch(() => undefined);
  }
}
