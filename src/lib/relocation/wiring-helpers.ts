/**
 * Relocation wizard — shared plumbing between relocation steps.ts (C1-C4/E1)
 * and install-steps.ts (I8/I9/I10), so the two step lists call ONE
 * implementation of "register domain / issue cert / write vhost / DNS"
 * instead of maintaining it twice.
 *
 * Every mutating helper here goes through exec.ts/nginx.ts, which already
 * enforce the RELOCATE_EXECUTE latch — this module adds no latch of its own.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";

import { assertExecuteLatch, runCommand } from "./exec";
import {
  nginxReload,
  nginxTest,
  pleskCertPaths,
  renderAppVhost,
  writeVhost,
} from "./nginx";
import { confServesHost, parseEnvFile, resolveIps } from "./preflight";

/** `plesk version` succeeds only on a Plesk-managed server (preflight already
 * probes this the same way for the tooling finding). */
export async function isPleskServer(): Promise<boolean> {
  const direct = await runCommand({ cmd: "plesk", args: ["version"], timeoutMs: 10_000 });
  if (direct.ok) return true;
  const sudo = await runCommand({ cmd: "plesk", args: ["version"], sudo: true, timeoutMs: 10_000 });
  return sudo.ok;
}

/** The server's own public address, resolved the same way preflight's DNS
 * check does (via the CURRENT origin's host) — never hardcoded (R1). */
export async function resolveServerListenAddress(currentOrigin: string): Promise<string | undefined> {
  const host = new URL(currentOrigin).hostname;
  const ips = await resolveIps(host);
  return ips[0];
}

export async function domainRegisteredInPlesk(host: string): Promise<boolean> {
  const res = await runCommand({ cmd: "plesk", args: ["bin", "domain", "--list"], sudo: true, timeoutMs: 20_000 });
  if (!res.ok) return false;
  return res.stdout.split("\n").some((line) => line.trim() === host);
}

export async function registerDomainInPlesk(host: string): Promise<void> {
  assertExecuteLatch(`registerDomainInPlesk(${host})`);
  const res = await runCommand({
    cmd: "plesk",
    args: ["bin", "domain", "--create", host, "-hosting", "false"],
    sudo: true,
    timeoutMs: 60_000,
  });
  if (!res.ok) {
    throw new Error(`plesk domain --create ${host} failed (exit ${res.code ?? "?"})`);
  }
}

/** company_contact_email from app_settings (DB-resident, same REST pattern as
 * preflight's fetchWhatsAppSettings), falling back to admin@<apex>. */
export async function resolveCertEmail(repoRoot: string, targetOrigin: string): Promise<string> {
  const apex = new URL(targetOrigin).hostname.split(".").slice(-2).join(".");
  const fallback = `admin@${apex}`;
  try {
    const env = parseEnvFile(readFileSync(join(repoRoot, ".env.local"), "utf8"));
    const base = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) return fallback;
    const res = await fetch(`${base}/rest/v1/app_settings?id=eq.true&select=company_contact_email`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return fallback;
    const rows = (await res.json()) as { company_contact_email?: string | null }[];
    return rows[0]?.company_contact_email || fallback;
  } catch {
    return fallback;
  }
}

/** True when a cert already covers `host` (e.g. an existing wildcard) — same
 * TLS-probe shape as preflight's tlsFinding, reduced to a boolean. */
export function certCoversHost(host: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = tlsConnect(
      { host, port: 443, servername: host, rejectUnauthorized: false, timeout: 4000 },
      () => {
        socket.end();
        resolvePromise(true);
      },
    );
    const fail = () => {
      socket.destroy();
      resolvePromise(false);
    };
    socket.on("error", fail);
    socket.on("timeout", fail);
  });
}

export async function issueCertPlesk(host: string, email: string): Promise<void> {
  assertExecuteLatch(`issueCertPlesk(${host})`);
  const res = await runCommand({
    cmd: "plesk",
    args: ["bin", "extension", "--exec", "letsencrypt", "cli.php", "-d", host, "-m", email],
    sudo: true,
    timeoutMs: 120_000,
  });
  if (!res.ok) {
    throw new Error(`Let's Encrypt issuance for ${host} failed (exit ${res.code ?? "?"})`);
  }
}

export async function writeAppVhostForHost(
  host: string,
  listenAddress?: string,
): Promise<{ path: string; backupPath: string | null }> {
  const { certPath, keyPath } = pleskCertPaths(host);
  const content = renderAppVhost({ domain: host, certPath, keyPath, listenAddress });
  const path = `/etc/nginx/conf.d/${host}-app.conf`;
  return writeVhost(path, content);
}

/** `nginx -t` then reload — the pair every vhost mutation ends with. */
export async function testAndReloadNginx(): Promise<{ ok: boolean; output: string }> {
  const test = await nginxTest();
  if (!test.ok) return test;
  await nginxReload();
  return test;
}

export async function removeVhostFile(path: string): Promise<void> {
  assertExecuteLatch(`removeVhostFile(${path})`);
  await runCommand({ cmd: "rm", args: ["-f", path], sudo: true, timeoutMs: 10_000 });
}

export async function restoreVhostFile(path: string, backupPath: string): Promise<void> {
  assertExecuteLatch(`restoreVhostFile(${path})`);
  await runCommand({ cmd: "cp", args: [backupPath, path], sudo: true, timeoutMs: 10_000 });
}

/** Find the OLD origin's existing vhost file among /etc/nginx/conf.d/*.conf —
 * the file Stage E overwrites with a redirect. Plain read first, sudo cat
 * fallback (same elevation rule as preflight). Read-only. */
export async function findOldVhostFile(oldHost: string): Promise<string | null> {
  let names: string[];
  try {
    names = readdirSync("/etc/nginx/conf.d").filter((n) => n.endsWith(".conf"));
  } catch {
    const res = await runCommand({
      cmd: "find",
      args: ["/etc/nginx/conf.d", "-maxdepth", "1", "-name", "*.conf"],
      sudo: true,
      timeoutMs: 10_000,
    });
    if (!res.ok) return null;
    names = res.stdout.split("\n").filter(Boolean).map((p) => p.split("/").pop() ?? "");
  }
  for (const name of names) {
    const path = `/etc/nginx/conf.d/${name}`;
    let text: string | null = null;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      const res = await runCommand({ cmd: "cat", args: [path], sudo: true, timeoutMs: 10_000 });
      text = res.ok ? res.stdout : null;
    }
    if (text && confServesHost(text, oldHost)) return path;
  }
  return null;
}

export async function writeDnsRecordPlesk(host: string, ip: string): Promise<void> {
  assertExecuteLatch(`writeDnsRecordPlesk(${host})`);
  const res = await runCommand({
    cmd: "plesk",
    args: ["bin", "dns", "-a", host, "-a", "", "-ip", ip],
    sudo: true,
    timeoutMs: 30_000,
  });
  if (!res.ok) throw new Error(`plesk bin dns -a ${host} failed (exit ${res.code ?? "?"})`);
}

/** Local liveness — the app answering on the port the setup form/build target. */
export async function localHealthOk(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:3002/api/health", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** Fetch a local path with a specific Host header and check it contains
 * `needle` — used to prove a rebuild picked up the new origin. */
export async function localBodyContains(path: string, host: string, needle: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:3002${path}`, {
      headers: { host },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes(needle);
  } catch {
    return false;
  }
}

/** Public verification suite (Stage H / I11): a small set of independent
 * checks against the live target + old origin. Read-only. */
export async function runVerificationSuite(opts: {
  targetOrigin: string;
  previousOrigin: string;
}): Promise<{ label: string; ok: boolean; detail?: string }[]> {
  const checks: { label: string; ok: boolean; detail?: string }[] = [];

  checks.push(await httpCheck(`${opts.targetOrigin}/`, (res) => res.status === 200, "public GET 200"));
  checks.push(
    await httpCheck(
      `${opts.targetOrigin}/api/health`,
      async (res) => res.status === 200 && Boolean((await res.json().catch(() => null))?.ok),
      "/api/health ok:true",
    ),
  );
  checks.push(
    await httpCheck(
      `${opts.targetOrigin}/robots.txt`,
      async (res) => (await res.text()).includes(new URL(opts.targetOrigin).hostname),
      "robots.txt contains target origin",
    ),
  );
  checks.push(
    await httpCheck(
      `${opts.targetOrigin}/sitemap.xml`,
      async (res) => (await res.text()).includes(new URL(opts.targetOrigin).hostname),
      "sitemap.xml contains target origin",
    ),
  );
  checks.push(
    await httpCheck(
      `${opts.previousOrigin}/r/nonexistent-token`,
      (res) => {
        const loc = res.headers.get("location") ?? "";
        return (res.status === 301 || res.status === 308) && loc.startsWith(opts.targetOrigin);
      },
      "old origin 301s to target",
      { redirect: "manual" },
    ),
  );
  return checks;
}

/**
 * Durable prevValue storage for external (non-file) mutations. The
 * StepDefinition contract gives apply() no channel to write into
 * `step.externalCalls` (only `backup()` can update engine-tracked state, and
 * only in the file-shaped {path,backupPath} form) — so external-API steps
 * (F1/F4/F7/G1) persist their own "what stood before" here, under `.relocate/`
 * (already git-ignored, already the wizard's scratch dir), keyed by step id.
 * rollback() reads it back. Never holds secrets — only the previous URL/value
 * shapes these steps themselves already treat as non-secret.
 */
export function savePrevValue(repoRoot: string, stepId: string, value: unknown): void {
  const dir = join(repoRoot, ".relocate");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stepId}-prev.json`), JSON.stringify(value), { mode: 0o600 });
}

export function loadPrevValue<T>(repoRoot: string, stepId: string): T | null {
  try {
    return JSON.parse(readFileSync(join(repoRoot, ".relocate", `${stepId}-prev.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

async function httpCheck(
  url: string,
  predicate: (res: Response) => boolean | Promise<boolean>,
  label: string,
  init?: RequestInit,
): Promise<{ label: string; ok: boolean; detail?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), ...init });
    const ok = await predicate(res);
    return { label, ok, detail: ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { label, ok: false, detail: (err as Error).message?.slice(0, 120) };
  }
}
