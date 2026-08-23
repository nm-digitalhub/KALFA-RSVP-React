/**
 * Relocation wizard — the WordPress-style env setup form (design doc §5c).
 *
 * A self-contained, temporary HTTP server the wizard starts during install
 * step I4. By that point the install order has already delivered DNS → TLS →
 * vhost, and the vhost proxies the target domain to 127.0.0.1:3002 — a port
 * nothing occupies yet (the app is not built). This form binds exactly there,
 * so the operator opens `https://<target>/setup?token=<one-time>` in a normal
 * browser. On success the wizard writes `.env.local` (0600), shuts the form
 * down, and the real app later takes over the port.
 *
 * Security contract:
 * - single-use random token in the URL, constant-time compared (via SHA-256
 *   digests so length never leaks); wrong/missing token → 404, identical to
 *   any unknown path.
 * - secret values travel browser→server once and are NEVER echoed back except
 *   a FAILED field's own value (so the operator fixes rather than retypes);
 *   passed values are held server-side in memory only.
 * - nothing is logged; probe outcomes carry classifications, never values.
 * - field rendering follows the env-validation catalog kinds (§5c): generated
 *   keys (VAPID pair) are produced server-side and shown read-only; optional
 *   keys render only when unresolved; db-settings live in /admin/settings.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";

import {
  ENV_KEY_SPECS,
  PROBES,
  outcomeHe,
  probeSupabaseDb,
  probeVapidLocal,
  validateFormat,
  type EnvKeySpec,
  type ProbeId,
  type ProbeOutcome,
} from "./env-validation";
import { assertExecuteLatch } from "./exec";
import { parseEnvFile, supabaseCliTokenExists } from "./preflight";

export class SetupFormTimeoutError extends Error {
  constructor() {
    super("setup form timed out waiting for parameters");
    this.name = "SetupFormTimeoutError";
  }
}

export class SetupFormClosedError extends Error {
  constructor() {
    super("setup form closed before completion");
    this.name = "SetupFormClosedError";
  }
}

export interface SetupFormResult {
  /** keys the operator explicitly skipped («דלג — אאמת ידנית») — the caller
   * records them as openItems so /admin shows what was accepted unverified. */
  skippedKeys: string[];
}

export interface SetupFormHandle {
  /** The public URL to print: rides the already-configured vhost + TLS. */
  url: string;
  /** Loopback URL (tests / diagnostics). */
  localUrl: string;
  close(): void;
  completed: Promise<SetupFormResult>;
}

export interface SetupFormOptions {
  repoRoot: string;
  targetOrigin: string;
  /** 3002 in production (the app's port, vacant during install). Tests MUST
   * pass 0 (ephemeral) — never bind the real port on a live server. */
  port?: number;
  host?: string;
  /** Override for tests; production default is 30 minutes. */
  idleTimeoutMs?: number;
}

interface KeyView {
  spec: EnvKeySpec;
  state: "input" | "stored" | "generated";
  /** echoed value — ONLY for a failed field (the user's own input). */
  echoValue?: string;
  outcome?: ProbeOutcome | null;
}

const BODY_LIMIT_BYTES = 1_000_000;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function tokenMatches(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  return timingSafeEqual(sha256(expected), sha256(provided));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isSecretLooking(key: string): boolean {
  if (key.startsWith("NEXT_PUBLIC_")) return false;
  return /(KEY|TOKEN|SECRET|PASSWORD)/.test(key);
}

/** Probe membership derived from the catalog once. */
const PROBE_MEMBERS: ReadonlyMap<ProbeId, readonly string[]> = (() => {
  const map = new Map<ProbeId, string[]>();
  for (const spec of ENV_KEY_SPECS) {
    if (!spec.probe) continue;
    const list = map.get(spec.probe) ?? [];
    list.push(spec.key);
    map.set(spec.probe, list);
  }
  return map;
})();

/** Probes actually implemented today; a null runner means the group passes on
 * format alone (graph/voximplant/ga4 runners land with the mutation phase). */
function runnerFor(id: ProbeId): ((env: Record<string, string>) => Promise<ProbeOutcome>) | null {
  if (id === "vapid-local") return probeVapidLocal;
  if (id === "supabase-db") return probeSupabaseDb;
  return (PROBES as Partial<Record<ProbeId, (env: Record<string, string>) => Promise<ProbeOutcome>>>)[id] ?? null;
}

function optionalResolved(spec: EnvKeySpec): boolean {
  if (!spec.optional) return false;
  if (process.env[spec.key]) return true;
  if (spec.key === "SUPABASE_ACCESS_TOKEN") return supabaseCliTokenExists();
  return false;
}

function pageShell(body: string): string {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>הגדרת KALFA</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;background:#f6f7f9;color:#111;margin:0;padding:2rem 1rem}
  main{max-width:44rem;margin:0 auto;background:#fff;border:1px solid #e3e5e8;border-radius:12px;padding:2rem}
  h1{font-size:1.4rem;margin:0 0 .25rem}
  p.lead{color:#555;margin:0 0 1.5rem}
  .row{border-top:1px solid #eee;padding:.8rem 0}
  label{display:block;font-weight:600;margin-bottom:.3rem;font-family:ui-monospace,monospace;font-size:.85rem;direction:ltr;text-align:right}
  input[type=text],input[type=password]{width:100%;box-sizing:border-box;direction:ltr;padding:.45rem .6rem;border:1px solid #cfd3d8;border-radius:8px;font-family:ui-monospace,monospace;font-size:.85rem}
  .ok{color:#0a7a3d}.err{color:#b3261e}.gen{color:#0a7a3d}
  .reason{font-size:.85rem;margin-top:.25rem}
  .skip{font-size:.85rem;color:#666;margin-top:.3rem;display:block}
  .note{background:#f2f6ff;border:1px solid #d6e2ff;border-radius:8px;padding: .8rem 1rem;font-size:.9rem;margin:1.2rem 0}
  button{margin-top:1.4rem;width:100%;padding:.7rem;border:0;border-radius:8px;background:#1d4ed8;color:#fff;font-size:1rem;cursor:pointer}
</style></head><body><main>${body}</main></body></html>`;
}

function renderForm(opts: {
  token: string;
  targetHost: string;
  views: KeyView[];
  hadErrors: boolean;
}): string {
  const rows = opts.views
    .map((view) => {
      const key = view.spec.key;
      if (view.state === "generated") {
        return `<div class="row"><label>${escapeHtml(key)}</label><span class="gen">נוצר אוטומטית ✓</span></div>`;
      }
      if (view.state === "stored") {
        return `<div class="row"><label>${escapeHtml(key)}</label><span class="ok">✓ אומת ונשמר זמנית</span></div>`;
      }
      const outcome = view.outcome;
      const status = outcome
        ? outcome.ok
          ? `<div class="reason ok">✓ ${escapeHtml(outcomeHe(outcome))}</div>`
          : `<div class="reason err">✗ ${escapeHtml(outcomeHe(outcome))}</div>`
        : "";
      const type = isSecretLooking(key) ? "password" : "text";
      const value = view.echoValue ? ` value="${escapeHtml(view.echoValue)}"` : "";
      const skip = view.spec.skippable
        ? `<label class="skip"><input type="checkbox" name="skip_${escapeHtml(key)}"> דלג — אאמת ידנית (יירשם כפריט פתוח)</label>`
        : "";
      return `<div class="row"><label for="${escapeHtml(key)}">${escapeHtml(key)}</label><input id="${escapeHtml(key)}" name="${escapeHtml(key)}" type="${type}" autocomplete="off" spellcheck="false"${value}>${status}${skip}</div>`;
    })
    .join("\n");
  const errorBanner = opts.hadErrors
    ? `<div class="note" style="background:#fff2f1;border-color:#f3c4c0">חלק מהשדות לא עברו אימות — תקנו את המסומנים ב-✗ ושלחו שוב. שדות שאומתו נשמרו זמנית.</div>`
    : "";
  return pageShell(`
<h1>הגדרת KALFA — ${escapeHtml(opts.targetHost)}</h1>
<p class="lead">הזינו את פרמטרי הסביבה. כל מפתח נבדק מול השירות שלו לפני שמירה; הערכים נכתבים ישירות לשרת ואינם נשמרים בשום יומן.</p>
${errorBanner}
<form method="post" action="/setup?token=${encodeURIComponent(opts.token)}">
${rows}
<div class="note">הגדרות ערוצים (WhatsApp, SUMIT, SMS, SMTP) אינן חלק מהטופס — הן מוזנות אחרי עליית המערכת במסכי <span dir="ltr">/admin/settings</span> ו-<span dir="ltr">/admin/channels</span>.</div>
<button type="submit">בדוק הכול, שמור והמשך התקנה</button>
</form>`);
}

function renderSuccess(targetHost: string): string {
  return pageShell(
    `<h1>הפרמטרים נשמרו — ההתקנה ממשיכה</h1><p class="lead">אפשר לסגור את החלון. בסיום ההתקנה האתר יעלה בכתובת <span dir="ltr">https://${escapeHtml(targetHost)}</span>.</p>`,
  );
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        rejectPromise(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectPromise);
  });
}

/** Atomic 0600 append-merge: existing content is preserved verbatim (comments
 * included); new keys land under a dated marker. */
function writeEnvLocal(repoRoot: string, entries: ReadonlyMap<string, string>): void {
  const target = join(repoRoot, ".env.local");
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  const lines = [...entries.entries()].map(([k, v]) => `${k}=${v}`);
  const marker = `# --- נכתב על-ידי טופס ההגדרה של אשף ההתקנה ${new Date().toISOString()} ---`;
  const content = `${existing.replace(/\n*$/, existing ? "\n\n" : "")}${marker}\n${lines.join("\n")}\n`;
  const tmp = `${target}.setup-tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, target);
}

export async function startSetupForm(options: SetupFormOptions): Promise<SetupFormHandle> {
  // Binding the app's own port and later writing .env.local are both real
  // mutations — latched exactly like every other mutator in the execution
  // layer (design: the CLI sets RELOCATE_EXECUTE=1 only for an approved,
  // non-dry-run run).
  assertExecuteLatch("startSetupForm");
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3002;
  const idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60_000;
  const targetHost = new URL(options.targetOrigin).host;
  const token = randomBytes(24).toString("base64url");

  const existingEnv = (() => {
    try {
      return parseEnvFile(readFileSync(join(options.repoRoot, ".env.local"), "utf8"));
    } catch {
      return {} as Record<string, string>;
    }
  })();

  // Generated class (VAPID pair): produced HERE, shown read-only, written on
  // success. Skipped entirely when the pair already exists (re-install).
  const generatedSpecs = ENV_KEY_SPECS.filter(
    (s) => s.kind === "generated" && !(s.key in existingEnv),
  );
  let generatedValues = new Map<string, string>();
  if (generatedSpecs.length > 0) {
    const webpush = (await import("web-push")).default;
    const pair = webpush.generateVAPIDKeys();
    generatedValues = new Map([
      ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", pair.publicKey],
      ["VAPID_PRIVATE_KEY", pair.privateKey],
    ]);
  }

  const inputSpecs = ENV_KEY_SPECS.filter(
    (s) =>
      s.kind !== "generated" &&
      s.kind !== "db-settings" &&
      !(s.key in existingEnv) &&
      !optionalResolved(s),
  );

  // Passed-and-held values (never echoed back to the browser).
  const pending = new Map<string, string>();
  const skipped = new Set<string>();

  let settled = false;
  let resolveCompleted!: (result: SetupFormResult) => void;
  let rejectCompleted!: (err: Error) => void;
  const completed = new Promise<SetupFormResult>((res, rej) => {
    resolveCompleted = res;
    rejectCompleted = rej;
  });

  const sockets = new Set<Socket>();
  let idleTimer: NodeJS.Timeout | null = null;

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("error");
    });
  });

  const close = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    server.close();
    for (const socket of sockets) socket.destroy();
    if (!settled) {
      settled = true;
      rejectCompleted(new SetupFormClosedError());
    }
  };

  const armIdleTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectCompleted(new SetupFormTimeoutError());
      }
      server.close();
      for (const socket of sockets) socket.destroy();
    }, idleTimeoutMs);
    idleTimer.unref();
  };

  function currentViews(results?: Map<string, ProbeOutcome>, echoes?: Map<string, string>): KeyView[] {
    const views: KeyView[] = [];
    for (const spec of generatedSpecs) views.push({ spec, state: "generated" });
    for (const spec of inputSpecs) {
      if (pending.has(spec.key) || skipped.has(spec.key)) {
        views.push({ spec, state: "stored" });
        continue;
      }
      views.push({
        spec,
        state: "input",
        outcome: results?.get(spec.key) ?? null,
        echoValue: echoes?.get(spec.key),
      });
    }
    return views;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    armIdleTimer();
    const url = new URL(req.url ?? "/", `http://${host}`);
    const okToken = url.pathname === "/setup" && tokenMatches(token, url.searchParams.get("token"));
    if (!okToken) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const headers = {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    };

    if (req.method === "GET") {
      res.writeHead(200, headers);
      res.end(renderForm({ token, targetHost, views: currentViews(), hadErrors: false }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }

    const params = new URLSearchParams(await readBody(req));
    const entered = new Map<string, string>();
    for (const spec of inputSpecs) {
      if (pending.has(spec.key) || skipped.has(spec.key)) continue;
      if (spec.skippable && params.get(`skip_${spec.key}`) !== null) {
        skipped.add(spec.key);
        continue;
      }
      const raw = params.get(spec.key)?.trim();
      if (raw) entered.set(spec.key, raw);
    }

    const results = new Map<string, ProbeOutcome>();
    const echoes = new Map<string, string>();

    // Layer 1 — format.
    for (const [key, value] of entered) {
      const outcome = validateFormat(key, value);
      if (!outcome.ok) {
        results.set(key, outcome);
        echoes.set(key, value);
      }
    }

    // Layer 2 — live probes, only for groups whose members were entered now
    // and only when every format check in the group passed.
    const mergedEnv: Record<string, string> = {
      ...existingEnv,
      ...Object.fromEntries(pending),
      ...Object.fromEntries(entered),
      ...Object.fromEntries(generatedValues),
    };
    for (const [probeId, members] of PROBE_MEMBERS) {
      const enteredMembers = members.filter((k) => entered.has(k));
      if (enteredMembers.length === 0) continue;
      if (enteredMembers.some((k) => results.has(k))) continue;
      const runner = runnerFor(probeId);
      if (!runner) continue;
      const outcome = await runner(mergedEnv);
      if (!outcome.ok) {
        for (const key of enteredMembers) {
          results.set(key, outcome);
          echoes.set(key, entered.get(key) ?? "");
        }
      } else {
        for (const key of enteredMembers) results.set(key, outcome);
      }
    }

    // Passed fields move to the server-side store; their values never render.
    for (const [key, value] of entered) {
      const outcome = results.get(key);
      if (!outcome || outcome.ok) pending.set(key, value);
    }

    const failures = [...results.values()].some((o) => !o.ok);
    const missing = inputSpecs.filter(
      (s) => !pending.has(s.key) && !skipped.has(s.key),
    );

    if (failures || missing.length > 0) {
      for (const spec of missing) {
        if (!results.has(spec.key) && params.has(spec.key)) {
          results.set(spec.key, { ok: false, class: "format", reason: "שדה חובה" });
        }
      }
      res.writeHead(200, headers);
      res.end(renderForm({ token, targetHost, views: currentViews(results, echoes), hadErrors: true }));
      return;
    }

    // All present (or skipped): persist and finish.
    const toWrite = new Map<string, string>([...pending, ...generatedValues]);
    writeEnvLocal(options.repoRoot, toWrite);
    if (!settled) {
      settled = true;
      resolveCompleted({ skippedKeys: [...skipped].sort() });
    }
    res.writeHead(200, headers);
    res.end(renderSuccess(targetHost));
    res.once("finish", () => {
      server.close();
      for (const socket of sockets) socket.destroy();
      if (idleTimer) clearTimeout(idleTimer);
    });
  }

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => resolveListen());
  });
  armIdleTimer();

  const actualPort = (server.address() as AddressInfo).port;
  return {
    url: `https://${targetHost}/setup?token=${token}`,
    localUrl: `http://${host}:${actualPort}/setup?token=${token}`,
    close,
    completed,
  };
}
