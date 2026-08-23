import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Probes are mocked at the transport level — the form must never place real
// network calls from tests. validateFormat/outcomeHe/catalog stay REAL.
vi.mock("./env-validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env-validation")>();
  const okProbe = () => vi.fn().mockResolvedValue({ ok: true });
  return {
    ...actual,
    PROBES: Object.fromEntries(Object.keys(actual.PROBES).map((k) => [k, okProbe()])),
    probeSupabaseDb: okProbe(),
  };
});

import { ENV_KEY_SPECS, validateFormat } from "./env-validation";
import {
  SetupFormTimeoutError,
  startSetupForm,
  type SetupFormHandle,
} from "./setup-form";

const TARGET = "https://new.example";

let repoRoot: string;
let home: string;
let handles: SetupFormHandle[];

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "setup-form-repo-"));
  home = mkdtempSync(join(tmpdir(), "setup-form-home-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("SUPABASE_ACCESS_TOKEN", "");
  vi.stubEnv("RELOCATE_EXECUTE", "1"); // the form binds a port + later writes .env.local — latched like every other mutator
  handles = [];
});

afterEach(() => {
  for (const handle of handles) handle.close();
  vi.unstubAllEnvs();
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

async function start(opts?: { idleTimeoutMs?: number }): Promise<SetupFormHandle> {
  const handle = await startSetupForm({
    repoRoot,
    targetOrigin: TARGET,
    port: 0, // NEVER 3002 in tests — production listens there.
    idleTimeoutMs: opts?.idleTimeoutMs,
  });
  handle.completed.catch(() => undefined); // settled via close() in afterEach
  handles.push(handle);
  return handle;
}

function inputNames(html: string): string[] {
  return [...html.matchAll(/name="([A-Z_0-9]+)"/g)].map((m) => m[1]);
}

/** A format-passing value for every key the form may render. The loop test
 * asserts each against the REAL validateFormat, so a future catalog addition
 * without a value here fails loudly with the key's name. */
function validValueFor(key: string): string {
  const exact: Record<string, string> = {
    APP_ORIGIN: "https://new.example",
    NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
    PGBOSS_DASHBOARD_URL: "https://new.example/admin/jobs",
    EMAIL_PROVIDER: "resend",
    EXCHANGE_PROVIDER: "graph",
    RECONCILE_AUTHORIZED_SET_ENABLED: "false",
    DEVICE_TELEMETRY_ENABLED: "false",
    NEXT_PUBLIC_GA_ID: "G-TEST123",
    MS_GRAPH_PRIMARY_MAILBOX: "inbox@example.com",
    MS_GRAPH_INTAKE_FOLDER: "KALFA-Intake",
    VAPID_SUBJECT: "mailto:admin@example.com",
    META_IG_ACCESS_TOKEN_EXPIRES_AT: "2027-01-01T00:00:00Z",
    SUPABASE_DB_HOST: "pooler.supabase.com",
    SUPABASE_DB_PORT: "5432",
    SUPABASE_DB_NAME: "postgres",
    SUPABASE_DB_USER: "postgres.abc",
    SUPABASE_DB_PASSWORD: "db-secret-value-1234",
  };
  if (key in exact) return exact[key];
  if (/^(MS_GRAPH_WEBHOOK_SECRET|EXCHANGE_EWS_ENCRYPTION_KEY)$/.test(key)) return "a".repeat(64);
  if (/ID$/.test(key) && /SUMIT|META|GA4/.test(key)) return "123456";
  return `test-value-${key.toLowerCase().replaceAll("_", "-")}`;
}

describe("startSetupForm", () => {
  it("serves nothing without the exact one-time token", async () => {
    const handle = await start();
    const base = handle.localUrl.split("?")[0];
    expect((await fetch(`${base}?token=wrong`)).status).toBe(404);
    expect((await fetch(base)).status).toBe(404);
    expect((await fetch(`${base.replace("/setup", "/other")}`)).status).toBe(404);
    expect((await fetch(handle.localUrl)).status).toBe(200);
  });

  it("GET renders required inputs; generated VAPID and resolved-optional and db-settings are NOT inputs", async () => {
    mkdirSync(join(home, ".supabase"));
    writeFileSync(join(home, ".supabase", "access-token"), "sbp_x", { mode: 0o600 });
    const handle = await start();
    const html = await (await fetch(handle.localUrl)).text();
    const names = inputNames(html);
    expect(names).toContain("APP_ORIGIN");
    expect(names).toContain("VAPID_SUBJECT");
    // generated pair: read-only row, never an input
    expect(names).not.toContain("VAPID_PRIVATE_KEY");
    expect(names).not.toContain("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    expect(html).toContain("נוצר אוטומטית");
    // optional key resolved via the CLI credential file → not rendered
    expect(names).not.toContain("SUPABASE_ACCESS_TOKEN");
    // db-settings note
    expect(html).toContain("/admin/settings");
  }, 10_000);

  it("POST with a bad value re-renders with ✗ + Hebrew reason and writes nothing", async () => {
    const handle = await start();
    const res = await fetch(handle.localUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ APP_ORIGIN: "not-a-url" }).toString(),
    });
    const html = await res.text();
    expect(html).toContain("✗");
    expect(html).toContain("ערך לא תקין");
    expect(html).toContain("not-a-url"); // the user's own failed-field echo
    expect(existsSync(join(repoRoot, ".env.local"))).toBe(false);
  });

  it("POST with all valid values writes .env.local (0600, incl. generated VAPID), resolves completed, closes", async () => {
    const handle = await start();
    const html = await (await fetch(handle.localUrl)).text();
    const body = new URLSearchParams();
    for (const name of inputNames(html)) {
      const value = validValueFor(name);
      expect(validateFormat(name, value), `validValueFor(${name})`).toEqual({ ok: true });
      body.set(name, value);
    }
    const res = await fetch(handle.localUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const successHtml = await res.text();
    expect(successHtml).toContain("הפרמטרים נשמרו");
    // no entered secret value leaks into the success page
    expect(successHtml).not.toContain("db-secret-value-1234");

    await expect(handle.completed).resolves.toEqual({ skippedKeys: [] });

    const envPath = join(repoRoot, ".env.local");
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    const written = readFileSync(envPath, "utf8");
    expect(written).toContain("APP_ORIGIN=https://new.example");
    expect(written).toMatch(/NEXT_PUBLIC_VAPID_PUBLIC_KEY=.+/);
    expect(written).toMatch(/VAPID_PRIVATE_KEY=.+/);

    // the one-shot server is gone
    await new Promise((r) => setTimeout(r, 50));
    await expect(fetch(handle.localUrl)).rejects.toThrow();
  }, 15_000);

  it("explicit skip on a skippable key resolves completed with skippedKeys", async () => {
    const handle = await start();
    const html = await (await fetch(handle.localUrl)).text();
    const skippable = new Set(
      ENV_KEY_SPECS.filter((s) => s.skippable).map((s) => s.key),
    );
    const body = new URLSearchParams();
    for (const name of inputNames(html)) {
      if (skippable.has(name)) body.set(`skip_${name}`, "on");
      else body.set(name, validValueFor(name));
    }
    const res = await fetch(handle.localUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(await res.text()).toContain("הפרמטרים נשמרו");
    await expect(handle.completed).resolves.toEqual({
      skippedKeys: [...skippable].sort(),
    });
    const written = readFileSync(join(repoRoot, ".env.local"), "utf8");
    for (const key of skippable) expect(written).not.toContain(`${key}=`);
  }, 15_000);

  it("idle timeout rejects completed with the typed error", async () => {
    const handle = await start({ idleTimeoutMs: 60 });
    await expect(handle.completed).rejects.toBeInstanceOf(SetupFormTimeoutError);
  });
});
