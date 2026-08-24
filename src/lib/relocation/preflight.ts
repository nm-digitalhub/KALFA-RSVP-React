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
import { execFile, execFileSync } from "node:child_process";
import { resolve4, resolve6 } from "node:dns/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
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

/** The linked supabase CLI stores its Management API token here (verified
 * live 2026-08-23: sbp_ prefix, 0600). Existence check only. */
export function supabaseCliTokenExists(): boolean {
  const home = process.env.HOME;
  if (!home) return false;
  return existsSync(join(home, ".supabase", "access-token"));
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

/** Elevation rule (owner directive + design §2 writer identity): the wizard
 * runs as the app user, NOT root (the engine refuses uid 0). Privileged
 * material is read with plain fs first; only when that fails AND we are not
 * root does a read-only `sudo -n` fallback run. Both helpers return null on
 * failure — callers must surface that as "unknown", never as a clean "ok". */
function sudoAvailable(): boolean {
  return typeof process.getuid === "function" && process.getuid() !== 0;
}

function readFileMaybeSudo(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    if (!sudoAvailable()) return null;
    try {
      return execFileSync("sudo", ["-n", "cat", path], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return null;
    }
  }
}

/** List *.conf under dir (bounded depth) with a `sudo -n find` fallback for
 * dirs the app user cannot list. Returns null when both attempts fail. */
function listConfsMaybeSudo(dir: string, maxDepth: number): string[] | null {
  try {
    const out: string[] = [];
    const walk = (d: string, depth: number): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          if (depth < maxDepth) walk(full, depth + 1);
        } else if (entry.name.endsWith(".conf")) {
          out.push(full);
        }
      }
    };
    walk(dir, 0);
    return out;
  } catch {
    if (!sudoAvailable()) return null;
    try {
      const found = execFileSync(
        "sudo",
        ["-n", "find", dir, "-maxdepth", String(maxDepth + 1), "-name", "*.conf"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return found.split("\n").filter((line) => line.trim().length > 0);
    } catch {
      return null;
    }
  }
}

function listConfFiles(): { files: string[]; unreadable: boolean } {
  const files: string[] = [];
  let unreadable = false;
  // Recursive, depth-bounded: Plesk keeps the ACTUAL vhost server blocks in
  // SUBDIRECTORIES (/etc/nginx/plesk.conf.d/vhosts/<domain>.conf) — a flat
  // readdir missed them and reported "no vhost serves kalfa.me" while the
  // live Laravel site sat right there (caught on the first real dry-run,
  // 2026-08-23). Missing a conflict here skips the shadow-decision gate.
  for (const dir of NGINX_SCAN_DIRS) {
    const found = listConfsMaybeSudo(dir, 3);
    if (found === null) unreadable = true;
    else files.push(...found);
  }
  // Plesk's per-domain system dirs hold last_nginx.conf etc.; the domain list
  // itself is usually readable, the conf dirs usually are not — the sudo
  // fallback inside the helper covers both.
  const domains = listConfsMaybeSudo(PLESK_SYSTEM_DIR, 2);
  if (domains === null) unreadable = true;
  else files.push(...domains);
  return { files: [...new Set(files)], unreadable };
}

/** Word-boundary match of the target host inside `server_name` directives.
 * Plesk quotes each name (`server_name "kalfa.me";`) — verified live
 * 2026-08-23 after an unquoted-only pattern reported "no vhost serves
 * kalfa.me" across 118 files while the live site's block sat in one of them —
 * so quotes count as boundaries on both sides. A dot still does not, which is
 * what keeps `www.kalfa.me` from matching a `kalfa.me` search. */
export function confServesHost(confText: string, host: string): boolean {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`server_name[^;]*(?:^|[\\s,"'])${escaped}(?:[\\s,;"']|$)`, "m");
  return re.test(confText);
}

function conflictFinding(input: PreflightInput): PreflightFinding {
  const targetHost = new URL(input.targetOrigin).hostname;
  const { files, unreadable: dirsUnreadable } = listConfFiles();
  const matches: string[] = [];
  let filesUnreadable = 0;
  for (const file of files) {
    // Plesk's plesk.conf.d/vhosts/*.conf are SYMLINKS to root-only
    // /var/www/vhosts/system/<domain>/conf/nginx.conf — exactly the files
    // that hold the live server blocks. A silent skip here reported a false
    // "ok" while the target was serving the live Laravel site (caught on the
    // second real dry-run, 2026-08-23). readFileMaybeSudo retries with a
    // read-only elevated cat; a file unreadable even then counts toward
    // "unknown", never toward a clean "ok".
    const text = readFileMaybeSudo(file);
    if (text === null) {
      filesUnreadable += 1;
      continue;
    }
    if (confServesHost(text, targetHost)) matches.push(file);
  }
  const unreadable = dirsUnreadable || filesUnreadable > 0;
  if (matches.length > 0) {
    return {
      id: "conflict",
      status: "decision",
      label: label("Existing site on target", "אתר קיים על דומיין היעד"),
      detail: `${targetHost} already appears in: ${matches.join(", ")} — proceeding shadows that site`,
    };
  }
  if (unreadable) {
    // PARTIAL coverage must never report a clean "ok": absence of a match in
    // the files we could read is not proof no vhost serves the target.
    return {
      id: "conflict",
      status: "unknown",
      label: label("Existing site on target", "אתר קיים על דומיין היעד"),
      detail: `no match in the readable conf files, but ${filesUnreadable} file(s)/dirs stayed unreadable even via sudo -n — conflict state unknown`,
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
  {
    // Owner insight 2026-08-23: the linked supabase CLI keeps its own
    // Management token at ~/.supabase/access-token (0600) — the wizard
    // resolves env first, then that file. Presence + source only; the value
    // is never read into a finding.
    const source = scan.supabaseTokenPresent
      ? "env"
      : supabaseCliTokenExists()
        ? "cli-file"
        : null;
    findings.push({
      id: "env-supabase-token",
      status: source ? "ok" : "open",
      label: label("Supabase Management token", "טוקן Supabase Management"),
      detail:
        source === "env"
          ? "SUPABASE_ACCESS_TOKEN present — stage F auth updates can run"
          : source === "cli-file"
            ? "available via the supabase CLI credential (~/.supabase/access-token) — stage F auth updates can run"
            : "not found in env or ~/.supabase/access-token — stage F (auth Site URL/redirects) will need one",
    });
  }
  return findings;
}

/** One required external tool: how to probe it and how to fix its absence. */
interface ToolProbe {
  name: string;
  ok: boolean;
  version?: string;
  fix: string;
}

/** Pure aggregation of tool probes into one finding (owner requirement
 * 2026-08-23: prove the tools exist, never assume). Installation itself is
 * DELIBERATELY not automated for system packages — that is an owner-gated
 * action; the fix text carries the exact command instead. */
export function summarizeTooling(tools: ToolProbe[]): PreflightFinding {
  const missing = tools.filter((t) => !t.ok);
  if (missing.length === 0) {
    const versions = tools
      .filter((t) => t.version)
      .map((t) => `${t.name} ${t.version}`)
      .join(", ");
    return {
      id: "tooling",
      status: "ok",
      label: label("Required tooling", "כלים נדרשים"),
      detail: `all ${tools.length} required tools present (${versions})`,
    };
  }
  return {
    id: "tooling",
    status: "blocked",
    label: label("Required tooling", "כלים נדרשים"),
    detail: `missing: ${missing.map((t) => `${t.name} — fix: ${t.fix}`).join("; ")}`,
  };
}

async function probeVersion(
  name: string,
  cmd: string,
  args: string[],
  fix: string,
  opts?: { sudoFallback?: boolean },
): Promise<ToolProbe> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 10_000 });
    const version = (stdout || stderr).trim().split("\n")[0]?.slice(0, 60);
    return { name, ok: true, version, fix };
  } catch {
    // Same elevation rule as every other privileged read (sudoAvailable):
    // some tools exist but refuse non-root ("plesk version" prints "must run
    // as root" — caught on a live dry-run 2026-08-23 and reported as MISSING).
    if (opts?.sudoFallback && sudoAvailable()) {
      try {
        const { stdout, stderr } = await execFileAsync("sudo", ["-n", cmd, ...args], {
          timeout: 10_000,
        });
        const version = (stdout || stderr).trim().split("\n")[0]?.slice(0, 60);
        return { name, ok: true, version, fix };
      } catch {
        return { name, ok: false, fix };
      }
    }
    return { name, ok: false, fix };
  }
}

async function toolingFinding(input: PreflightInput): Promise<PreflightFinding> {
  const probes = await Promise.all([
    // node: we are running under it — record the version for the report.
    Promise.resolve<ToolProbe>({
      name: "node",
      ok: true,
      version: process.version,
      fix: "provision via the Plesk Node toolkit",
    }),
    probeVersion("nginx", "nginx", ["-v"], "install via Plesk (manages nginx on this stack)"),
    probeVersion("pm2", "pm2", ["-v"], "npm install -g pm2"),
    probeVersion(
      "plesk",
      "plesk",
      ["version"],
      "Plesk CLI missing — this wizard targets a Plesk-managed server",
      { sudoFallback: true },
    ),
    // sudo -n true proves passwordless elevation actually works for this user
    // (the conflict scan and stages C/E depend on it).
    probeVersion("sudo -n", "sudo", ["-n", "true"], "grant NOPASSWD sudo to the app user").then(
      (p) => ({ ...p, version: p.ok ? "passwordless ok" : undefined }),
    ),
  ]);
  // Repo dependencies: tsx/@clack/prompts must resolve from node_modules —
  // if the tree is missing this CLI would not even start, but on a FRESH
  // clone this line tells the operator the exact fix.
  const depsOk = ["@clack/prompts", "zod", "tsx"].every((dep) =>
    existsSync(join(input.repoRoot, "node_modules", dep, "package.json")),
  );
  probes.push({
    name: "node_modules",
    ok: depsOk,
    version: depsOk ? "in sync" : undefined,
    fix: "npm ci (repo-local, safe)",
  });
  return summarizeTooling(probes);
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
        "-rIn",
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
        // Console scenarios read the origin from the KALFA_APP_ORIGIN
        // application secret (F6) — a literal here means an un-fixed scenario.
        "voxfiles/scenarios/src",
      ],
      { cwd: input.repoRoot, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    // Split BEHAVIORAL hardcodes from comment-only mentions: a domain inside a
    // `//`, `*` or `#` line documents something (often the Meta-resident base
    // URL) and breaks nothing on a move — counting them as one bucket buried
    // the real signal (owner question, 2026-08-23). Line-start comment
    // detection only; a literal inside real code always counts as code.
    const codeFiles = new Set<string>();
    const commentFiles = new Set<string>();
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      const [file, , ...rest] = line.split(":");
      const text = rest.join(":").trimStart();
      if (!file) continue;
      if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*") || text.startsWith("#")) {
        commentFiles.add(file);
      } else {
        codeFiles.add(file);
      }
    }
    const commentNote =
      commentFiles.size > 0
        ? ` (${commentFiles.size} more file(s) mention it in comments only — harmless)`
        : "";
    if (codeFiles.size === 0) {
      return {
        id: "hardcoded-origins",
        status: "ok",
        label: label("Hardcoded origins", "כתובות קשיחות בקוד"),
        detail: `no non-test source CODE embeds the current origin${commentNote}`,
      };
    }
    const list = [...codeFiles];
    return {
      id: "hardcoded-origins",
      status: "open",
      label: label("Hardcoded origins", "כתובות קשיחות בקוד"),
      detail: `${list.length} file(s) embed the current origin in CODE (Phase 0): ${list.slice(0, 5).join(", ")}${list.length > 5 ? ", …" : ""}${commentNote}`,
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

/** WhatsApp credentials live in app_settings (DB), NOT env (owner note
 * 2026-08-23). Read them via the Supabase REST endpoint with the service key
 * from env — a plain fetch, no server-only import chain (this file runs under
 * tsx). Returns null when anything is missing; values never printed. */
async function fetchWhatsAppSettings(env: Record<string, string>): Promise<{
  wabaId: string;
  accessToken: string;
} | null> {
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  try {
    const res = await fetch(
      `${base}/rest/v1/app_settings?id=eq.true&select=whatsapp_waba_id,whatsapp_access_token`,
      {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as {
      whatsapp_waba_id?: string | null;
      whatsapp_access_token?: string | null;
    }[];
    const row = rows[0];
    if (!row?.whatsapp_waba_id || !row.whatsapp_access_token) return null;
    return { wabaId: row.whatsapp_waba_id, accessToken: row.whatsapp_access_token };
  } catch {
    return null;
  }
}

/** Pure classification of a live Meta template inventory (exported for tests).
 * Discovered live 2026-08-23: 21 approved templates bake the beta origin, the
 * two OTP templates point at whatsapp.com (domain-neutral), and legacy
 * `rsvp_invite_v2` points at the APEX — a repo-spec scan sees ONE line and
 * badly undercounts, so the live API is the only honest inventory. */
export function classifyMetaTemplates(
  templates: { name: string; status: string; urls: string[] }[],
  currentHost: string,
): { affected: string[]; neutral: number; other: string[] } {
  const affected: string[] = [];
  const other: string[] = [];
  let neutral = 0;
  for (const t of templates) {
    if (t.urls.length === 0) continue;
    if (t.urls.some((u) => u.includes(currentHost))) affected.push(t.name);
    else if (t.urls.every((u) => u.includes("whatsapp.com"))) neutral += 1;
    else other.push(`${t.name} → ${t.urls[0]}`);
  }
  return { affected, neutral, other };
}

async function metaTemplateFinding(input: PreflightInput): Promise<PreflightFinding> {
  const currentHost = new URL(input.currentOrigin).hostname;
  const heLabel = label("Meta template URL buttons", "כפתורי URL בתבניות Meta");
  const creds = await fetchWhatsAppSettings(input.env);
  if (creds) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${creds.wabaId}/message_templates?fields=name,status,components&limit=200`,
        {
          headers: { authorization: `Bearer ${creds.accessToken}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (res.ok) {
        const body = (await res.json()) as {
          data?: { name: string; status: string; components?: { type?: string; buttons?: { type?: string; url?: string }[] }[] }[];
        };
        const templates = (body.data ?? [])
          .filter((t) => t.status === "APPROVED")
          .map((t) => ({
            name: t.name,
            status: t.status,
            urls: (t.components ?? [])
              .filter((c) => c.type === "BUTTONS")
              .flatMap((c) => c.buttons ?? [])
              .filter((b) => b.type === "URL" && typeof b.url === "string")
              .map((b) => b.url as string),
          }));
        const { affected, neutral, other } = classifyMetaTemplates(templates, currentHost);
        const otherNote = other.length > 0 ? `; NOTE ${other.length} template(s) point elsewhere: ${other.join(", ")}` : "";
        return {
          id: "meta-templates",
          status: affected.length > 0 ? "open" : "ok",
          label: heLabel,
          detail:
            affected.length > 0
              ? `LIVE inventory: ${affected.length} approved template(s) bake the current origin — _v2 submissions needed (stage B); ${neutral} OTP template(s) are domain-neutral${otherNote}`
              : `LIVE inventory: no approved template bakes the current origin${otherNote}`,
        };
      }
    } catch {
      /* fall through to the repo-spec fallback */
    }
  }
  // Fallback (no DB creds / API unreachable): repo-spec scan, clearly labeled
  // as an UNDERCOUNT — it sees spec lines, not the real template registry.
  try {
    const spec = readFileSync(join(input.repoRoot, "src/lib/whatsapp/template-spec.ts"), "utf8");
    const lines = spec.split("\n").filter((l) => l.includes(currentHost));
    return {
      id: "meta-templates",
      status: lines.length > 0 ? "open" : "unknown",
      label: heLabel,
      detail:
        lines.length > 0
          ? `repo-spec fallback (live inventory unavailable — UNDERCOUNTS): ${lines.length} spec line(s) reference the current origin`
          : "live inventory unavailable and repo spec shows nothing — template state unknown",
    };
  } catch {
    return {
      id: "meta-templates",
      status: "unknown",
      label: heLabel,
      detail: "could not read template-spec.ts and live inventory unavailable",
    };
  }
}

/** Run all Stage A checks (read-only). Order is the render order. */
/** What answered when we fetched the target origin from here. */
export interface LiveProbeResult {
  answered: boolean;
  status?: number;
  server?: string;
  tlsError?: boolean;
  reason?: string;
}

/** Pure classification of the live-site probe (owner requirement 2026-08-23):
 * a target that already serves a LIVE system — even on ANOTHER server, where
 * no local vhost exists to conflict — must be surfaced before any move.
 * Pointing DNS at this server takes that site offline; the operator must see
 * that consequence, not discover it. */
export function classifyLiveSite(opts: {
  targetHost: string;
  pointsHere: boolean;
  probe: LiveProbeResult;
}): PreflightFinding {
  const { targetHost, pointsHere, probe } = opts;
  const heLabel = label("Live site at target", "אתר חי בכתובת היעד");
  if (!probe.answered) {
    return {
      id: "live-site",
      status: "ok",
      label: heLabel,
      detail: `nothing live answers at ${targetHost} today${probe.reason ? ` (${probe.reason})` : ""}`,
    };
  }
  const evidence = probe.tlsError
    ? "TLS endpoint answers (certificate not for us)"
    : `HTTP ${probe.status ?? "?"}${probe.server ? `, server: ${probe.server}` : ""}`;
  if (pointsHere) {
    // Something on THIS server already serves it — the vhost conflict check
    // owns the decision gate; this line just shows the live evidence.
    return {
      id: "live-site",
      status: "open",
      label: heLabel,
      detail: `${targetHost} already answers from this server (${evidence}) — see the existing-site conflict check`,
    };
  }
  return {
    id: "live-site",
    status: "decision",
    label: heLabel,
    detail: `${targetHost} serves a LIVE site on ANOTHER server (${evidence}) — pointing its DNS here will take that site offline`,
  };
}

function probeOnce(
  scheme: "https" | "http",
  host: string,
): Promise<LiveProbeResult> {
  return new Promise((resolvePromise) => {
    const req = (scheme === "https" ? httpsRequest : httpRequest)(
      {
        host,
        method: "GET",
        path: "/",
        timeout: 5000,
        headers: { host, "user-agent": "kalfa-relocate-preflight" },
      },
      (res) => {
        res.resume();
        resolvePromise({
          answered: true,
          status: res.statusCode,
          server: typeof res.headers.server === "string" ? res.headers.server : undefined,
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolvePromise({ answered: false, reason: "timeout" });
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      // A TLS handshake failure still proves something is listening there.
      const message = err.message || String(err);
      if (scheme === "https" && /certificate|TLS|SSL|handshake/i.test(message)) {
        resolvePromise({ answered: true, tlsError: true });
      } else {
        resolvePromise({ answered: false, reason: err.code ?? message });
      }
    });
    req.end();
  });
}

async function liveSiteFinding(input: PreflightInput): Promise<PreflightFinding> {
  const currentHost = new URL(input.currentOrigin).hostname;
  const targetHost = new URL(input.targetOrigin).hostname;
  const [serverIps, targetIps] = await Promise.all([
    resolveIps(currentHost),
    resolveIps(targetHost),
  ]);
  if (targetIps.length === 0) {
    return {
      id: "live-site",
      status: "na",
      label: label("Live site at target", "אתר חי בכתובת היעד"),
      detail: `${targetHost} does not resolve — nothing can answer there yet`,
    };
  }
  let probe = await probeOnce("https", targetHost);
  if (!probe.answered) probe = await probeOnce("http", targetHost);
  return classifyLiveSite({
    targetHost,
    pointsHere: ipsOverlap(serverIps, targetIps),
    probe,
  });
}

export async function runPreflight(input: PreflightInput): Promise<PreflightFinding[]> {
  const findings: PreflightFinding[] = [];
  findings.push(await toolingFinding(input));
  findings.push(...envFindings(input));
  findings.push(await dnsFinding(input));
  findings.push(conflictFinding(input));
  findings.push(await liveSiteFinding(input));
  findings.push(await tlsFinding(input));
  findings.push(await pm2Finding());
  findings.push(await diskFinding(input.repoRoot));
  findings.push(await hardcodeFinding(input));
  findings.push(await metaTemplateFinding(input));
  return findings;
}
