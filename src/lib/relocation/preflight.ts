/**
 * Relocation wizard — Stage A preflight (read-only, plan §5 Stage A).
 *
 * Every check here READS — the preflight mutates nothing, ever. Each check is
 * tolerant: an unreadable source degrades to status 'unknown' with an honest
 * detail line, never a crash (a preflight that dies tells the operator less
 * than one that reports what it could not see).
 *
 * Values from env files are never returned, logged, or embedded in findings —
 * only key NAMES and booleans leave this module.
 */
import { execFile } from "node:child_process";
import { resolve4, resolve6 } from "node:dns/promises";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { promisify } from "node:util";

import type { Label } from "./state";

const execFileAsync = promisify(execFile);

export type FindingStatus = "ok" | "blocked" | "decision" | "open" | "na" | "unknown";

export interface PreflightFinding {
  id: string;
  status: FindingStatus;
  label: Label;
  /** English, single line, safe to print — never an env value or secret. */
  detail: string;
}

/** Minimal .env parser: KEY=VALUE lines, quotes stripped, comments ignored.
 * The returned map stays in-process; callers must never print its values. */
export function parseEnvFile(content: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

export type TargetValidation =
  | { ok: true; origin: string; host: string }
  | { ok: false; reason: string };

/** Same shape of rules as src/lib/url.ts originFromEnv (which is server-only
 * and unavailable to the CLI), plus target-specific ones: https only, and it
 * must differ from the current origin. */
export function validateTargetOrigin(raw: string, currentOrigin: string): TargetValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty target" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: `not an absolute URL — enter a bare origin like https://example.com` };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "target must use https://" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "target must not include credentials" };
  }
  if ((url.pathname !== "" && url.pathname !== "/") || url.search !== "" || url.hash !== "") {
    return { ok: false, reason: `"${trimmed}" has a path/query/fragment — enter a bare origin` };
  }
  if (url.origin === currentOrigin) {
    return { ok: false, reason: "target equals the current origin — nothing to relocate" };
  }
  return { ok: true, origin: url.origin, host: url.hostname };
}

export interface EnvScan {
  hasAppOrigin: boolean;
  /** NEXT_PUBLIC_* key NAMES whose value embeds the current origin host. */
  nextPublicWithOrigin: string[];
  /** PGBOSS_DASHBOARD_URL embeds the origin (plan Stage D — second rewrite key). */
  pgbossDashboardHasOrigin: boolean;
  supabaseTokenPresent: boolean;
}

export function scanEnv(env: Record<string, string>, currentHost: string): EnvScan {
  return {
    hasAppOrigin: Boolean(env.APP_ORIGIN?.trim()),
    nextPublicWithOrigin: Object.keys(env)
      .filter((k) => k.startsWith("NEXT_PUBLIC_"))
      .filter((k) => env[k].includes(currentHost))
      .sort(),
    pgbossDashboardHasOrigin: Boolean(env.PGBOSS_DASHBOARD_URL?.includes(currentHost)),
    supabaseTokenPresent: Boolean(
      env.SUPABASE_ACCESS_TOKEN?.trim() || process.env.SUPABASE_ACCESS_TOKEN?.trim(),
    ),
  };
}

export async function resolveIps(host: string): Promise<string[]> {
  const results = await Promise.allSettled([resolve4(host), resolve6(host)]);
  const ips = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return [...new Set(ips)].sort();
}

export function ipsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((ip) => b.includes(ip));
}

interface PreflightInput {
  repoRoot: string;
  env: Record<string, string>;
  currentOrigin: string;
  targetOrigin: string;
}

function label(en: string, he: string): Label {
  return { en, he };
}

async function dnsFinding(input: PreflightInput): Promise<PreflightFinding> {
  const currentHost = new URL(input.currentOrigin).hostname;
  const targetHost = new URL(input.targetOrigin).hostname;
  const serverIps = await resolveIps(currentHost);
  if (serverIps.length === 0) {
    return {
      id: "dns",
      status: "unknown",
      label: label("DNS", "DNS"),
      detail: `could not resolve the current origin host (${currentHost}) to learn this server's IPs`,
    };
  }
  const targetIps = await resolveIps(targetHost);
  if (targetIps.length === 0) {
    return {
      id: "dns",
      status: "blocked",
      label: label("DNS", "DNS"),
      detail: `${targetHost} does not resolve yet — create an A record pointing at ${serverIps.join(" / ")}`,
    };
  }
  if (ipsOverlap(serverIps, targetIps)) {
    return {
      id: "dns",
      status: "ok",
      label: label("DNS", "DNS"),
      detail: `${targetHost} → ${targetIps.join(", ")} (this server)`,
    };
  }
  return {
    id: "dns",
    status: "blocked",
    label: label("DNS", "DNS"),
    detail: `${targetHost} → ${targetIps.join(", ")}, expected ${serverIps.join(" / ")}`,
  };
}

const NGINX_SCAN_DIRS = ["/etc/nginx/conf.d", "/etc/nginx/plesk.conf.d"];
const PLESK_SYSTEM_DIR = "/var/www/vhosts/system";

function listConfFiles(): { files: string[]; unreadable: boolean } {
  const files: string[] = [];
  let unreadable = false;
  for (const dir of NGINX_SCAN_DIRS) {
    try {
      for (const name of readdirSync(dir)) {
        if (name.endsWith(".conf")) files.push(join(dir, name));
      }
    } catch {
      unreadable = true;
    }
  }
  try {
    for (const domain of readdirSync(PLESK_SYSTEM_DIR)) {
      const confDir = join(PLESK_SYSTEM_DIR, domain, "conf");
      try {
        for (const name of readdirSync(confDir)) {
          if (name.endsWith(".conf")) files.push(join(confDir, name));
        }
      } catch {
        /* per-domain dirs may be unreadable; that's fine */
      }
    }
  } catch {
    unreadable = true;
  }
  return { files, unreadable };
}

/** Word-boundary match of the target host inside `server_name` directives. */
export function confServesHost(confText: string, host: string): boolean {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`server_name[^;]*(?:^|[\\s,])${escaped}(?:[\\s,;]|$)`, "m");
  return re.test(confText);
}

function conflictFinding(input: PreflightInput): PreflightFinding {
  const targetHost = new URL(input.targetOrigin).hostname;
  const { files, unreadable } = listConfFiles();
  const matches: string[] = [];
  for (const file of files) {
    try {
      if (confServesHost(readFileSync(file, "utf8"), targetHost)) matches.push(file);
    } catch {
      /* single unreadable file: skip */
    }
  }
  if (matches.length > 0) {
    return {
      id: "conflict",
      status: "decision",
      label: label("Existing site on target", "אתר קיים על דומיין היעד"),
      detail: `${targetHost} already appears in: ${matches.join(", ")} — proceeding shadows that site`,
    };
  }
  if (files.length === 0 && unreadable) {
    return {
      id: "conflict",
      status: "unknown",
      label: label("Existing site on target", "אתר קיים על דומיין היעד"),
      detail: "nginx config dirs unreadable from this user (needs elevated read) — conflict state unknown",
    };
  }
  return {
    id: "conflict",
    status: "ok",
    label: label("Existing site on target", "אתר קיים על דומיין היעד"),
    detail: `no vhost serves ${targetHost} on this server (${files.length} conf files scanned)`,
  };
}

function tlsFinding(input: PreflightInput): Promise<PreflightFinding> {
  const targetHost = new URL(input.targetOrigin).hostname;
  return new Promise((resolvePromise) => {
    const socket = tlsConnect(
      { host: targetHost, port: 443, servername: targetHost, rejectUnauthorized: false, timeout: 4000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        const expiry = cert?.valid_to ? ` (expires ${cert.valid_to})` : "";
        const subject = cert?.subject?.CN ? ` for ${cert.subject.CN}` : "";
        resolvePromise({
          id: "tls",
          status: "ok",
          label: label("TLS", "TLS"),
          detail: `certificate present${subject}${expiry}`,
        });
      },
    );
    const fail = () => {
      socket.destroy();
      resolvePromise({
        id: "tls",
        status: "na",
        label: label("TLS", "TLS"),
        detail: "no TLS endpoint for the target yet — a certificate will be issued in stage C",
      });
    };
    socket.on("error", fail);
    socket.on("timeout", fail);
  });
}

function envFindings(input: PreflightInput): PreflightFinding[] {
  const currentHost = new URL(input.currentOrigin).hostname;
  const scan = scanEnv(input.env, currentHost);
  const findings: PreflightFinding[] = [];
  findings.push(
    scan.hasAppOrigin
      ? {
          id: "env-app-origin",
          status: "ok",
          label: label("APP_ORIGIN", "APP_ORIGIN"),
          detail: "present in .env.local (the single origin knob)",
        }
      : {
          id: "env-app-origin",
          status: "blocked",
          label: label("APP_ORIGIN", "APP_ORIGIN"),
          detail: "missing from .env.local — the app cannot build links without it",
        },
  );
  findings.push(
    scan.nextPublicWithOrigin.length === 0
      ? {
          id: "env-next-public",
          status: "ok",
          label: label("NEXT_PUBLIC_* origin scan", "סריקת NEXT_PUBLIC_*"),
          detail: "no NEXT_PUBLIC_* value embeds the app origin (build-inlined vars stay origin-free)",
        }
      : {
          id: "env-next-public",
          status: "blocked",
          label: label("NEXT_PUBLIC_* origin scan", "סריקת NEXT_PUBLIC_*"),
          detail: `these NEXT_PUBLIC_* keys embed the app origin and would freeze it into the build: ${scan.nextPublicWithOrigin.join(", ")}`,
        },
  );
  findings.push({
    id: "env-pgboss-url",
    status: scan.pgbossDashboardHasOrigin ? "open" : "ok",
    label: label("PGBOSS_DASHBOARD_URL", "PGBOSS_DASHBOARD_URL"),
    detail: scan.pgbossDashboardHasOrigin
      ? "embeds the origin — stage D rewrites this key alongside APP_ORIGIN"
      : "does not embed the origin",
  });
  findings.push({
    id: "env-supabase-token",
    status: scan.supabaseTokenPresent ? "ok" : "open",
    label: label("Supabase Management token", "טוקן Supabase Management"),
    detail: scan.supabaseTokenPresent
      ? "SUPABASE_ACCESS_TOKEN present — stage F auth updates can run"
      : "SUPABASE_ACCESS_TOKEN not set — stage F (auth Site URL/redirects) will need it",
  });
  return findings;
}

async function pm2Finding(): Promise<PreflightFinding> {
  const expected = ["kalfa-beta", "kalfa-worker", "kalfa-fleet", "kalfa-ops-agent"];
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"], { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
    const jsonStart = stdout.indexOf("[");
    const list = JSON.parse(stdout.slice(jsonStart)) as {
      name?: string;
      pm2_env?: { status?: string };
    }[];
    const byName = new Map(list.map((p) => [p.name, p.pm2_env?.status]));
    const missing = expected.filter((n) => !byName.has(n));
    const offline = expected.filter((n) => byName.has(n) && byName.get(n) !== "online");
    if (missing.length === 0 && offline.length === 0) {
      return {
        id: "pm2",
        status: "ok",
        label: label("pm2 processes", "תהליכי pm2"),
        detail: `${expected.join(", ")} online`,
      };
    }
    return {
      id: "pm2",
      status: "blocked",
      label: label("pm2 processes", "תהליכי pm2"),
      detail: `${missing.length ? `missing: ${missing.join(", ")}` : ""}${missing.length && offline.length ? "; " : ""}${offline.length ? `not online: ${offline.join(", ")}` : ""}`,
    };
  } catch {
    return {
      id: "pm2",
      status: "unknown",
      label: label("pm2 processes", "תהליכי pm2"),
      detail: "pm2 jlist failed — process state unknown",
    };
  }
}

async function diskFinding(repoRoot: string): Promise<PreflightFinding> {
  try {
    const { stdout } = await execFileAsync("df", ["-kP", repoRoot], { timeout: 10_000 });
    const line = stdout.trim().split("\n").at(-1) ?? "";
    const match = line.match(/(\d+)%/);
    const used = match ? Number(match[1]) : NaN;
    if (Number.isNaN(used)) throw new Error("unparsable df output");
    return {
      id: "disk",
      status: used < 90 ? "ok" : "blocked",
      label: label("Disk", "דיסק"),
      detail: `${used}% used (needs <90% for a staged build)`,
    };
  } catch {
    return {
      id: "disk",
      status: "unknown",
      label: label("Disk", "דיסק"),
      detail: "df failed — disk usage unknown",
    };
  }
}

async function hardcodeFinding(input: PreflightInput): Promise<PreflightFinding> {
  const currentHost = new URL(input.currentOrigin).hostname;
  try {
    const { stdout } = await execFileAsync(
      "grep",
      [
        "-rIl",
        "--exclude-dir=node_modules",
        "--exclude-dir=.next",
        "--exclude-dir=relocation",
        "--exclude-dir=relocate",
        "--exclude=*.test.ts",
        "--exclude=*.test.tsx",
        "--exclude=*.md",
        "-e",
        currentHost,
        "src",
        "ops",
        "scripts",
      ],
      { cwd: input.repoRoot, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const files = stdout.trim().split("\n").filter(Boolean);
    if (files.length === 0) {
      return {
        id: "hardcoded-origins",
        status: "ok",
        label: label("Hardcoded origins", "כתובות קשיחות בקוד"),
        detail: "no non-test source file embeds the current origin",
      };
    }
    return {
      id: "hardcoded-origins",
      status: "open",
      label: label("Hardcoded origins", "כתובות קשיחות בקוד"),
      detail: `${files.length} file(s) still embed the current origin (Phase 0): ${files.slice(0, 5).join(", ")}${files.length > 5 ? ", …" : ""}`,
    };
  } catch (err) {
    // grep exits 1 when nothing matches — execFile surfaces that as an error.
    if ((err as { code?: number }).code === 1) {
      return {
        id: "hardcoded-origins",
        status: "ok",
        label: label("Hardcoded origins", "כתובות קשיחות בקוד"),
        detail: "no non-test source file embeds the current origin",
      };
    }
    return {
      id: "hardcoded-origins",
      status: "unknown",
      label: label("Hardcoded origins", "כתובות קשיחות בקוד"),
      detail: "source scan failed",
    };
  }
}

function metaTemplateFinding(input: PreflightInput): PreflightFinding {
  const currentHost = new URL(input.currentOrigin).hostname;
  try {
    const spec = readFileSync(join(input.repoRoot, "src/lib/whatsapp/template-spec.ts"), "utf8");
    const lines = spec.split("\n").filter((l) => l.includes(currentHost));
    return {
      id: "meta-templates",
      status: lines.length > 0 ? "open" : "ok",
      label: label("Meta template URL buttons", "כפתורי URL בתבניות Meta"),
      detail:
        lines.length > 0
          ? `${lines.length} template-spec line(s) reference the current origin — _v2 submissions needed (stage B)`
          : "no template-spec line references the current origin",
    };
  } catch {
    return {
      id: "meta-templates",
      status: "unknown",
      label: label("Meta template URL buttons", "כפתורי URL בתבניות Meta"),
      detail: "could not read template-spec.ts",
    };
  }
}

/** Run all Stage A checks (read-only). Order is the render order. */
export async function runPreflight(input: PreflightInput): Promise<PreflightFinding[]> {
  const findings: PreflightFinding[] = [];
  findings.push(...envFindings(input));
  findings.push(await dnsFinding(input));
  findings.push(conflictFinding(input));
  findings.push(await tlsFinding(input));
  findings.push(await pm2Finding());
  findings.push(await diskFinding(input.repoRoot));
  findings.push(await hardcodeFinding(input));
  findings.push(metaTemplateFinding(input));
  return findings;
}
