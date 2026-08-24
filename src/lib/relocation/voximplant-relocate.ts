/**
 * Relocation wizard — Voximplant (Stage F5 / F6 / F6b).
 *
 * Three console scenarios (ConsoleDial, ConsoleInbound, ConsoleCallMeNow) are
 * CallAlerting/StartScenarios-triggered and used to carry the app origin as a
 * LITERAL. They now read it from the application secret `KALFA_APP_ORIGIN`
 * (VoxEngine.getSecretValue — the same mechanism KALFA_CONSOLE_SECRET already
 * uses), so a domain move is a secret rotation, not a redeploy:
 *
 *   F6  ensureAppOriginSecret  — AddSecret / SetSecretInfo (live-doc verified
 *       2026-08-24: Secrets = AddSecret, GetSecrets, GetSecretValue,
 *       SetSecretInfo{application_id, secret_id, secret_value}, DelSecret)
 *   F6b uploadConsoleScenarios — ONLY when the DEPLOYED text still carries the
 *       old origin literal / does not read the secret (GetScenarios
 *       with_script parity, the same read the voximplant CLI's `scenario`
 *       command does). Runs `npm run vox:upload -- --rule-name <rule>` for the
 *       console rules only — never the DTMF OutCall rule (1494311).
 *   F5  rearmAccountCallback   — GetAccountInfo echoes the current
 *       callback_url (which embeds the raw token); re-registering the same
 *       token on the new origin via the restricted SetAccountInfo keeps the
 *       stored hash valid, so no DB write is needed. Previous URL/salt are
 *       returned as the rollback inverse.
 *
 * The voximplant CLI's mutations guard (cli-guard.test.ts) pins
 * scripts/voximplant/cli.ts, not this wizard; every mutating function here
 * checks the RELOCATE_EXECUTE latch instead. Secret VALUES are compared,
 * never logged or returned to the CLI output.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAccountInfo, getScenarios, voxRequest, type VoximplantConfig } from "@/lib/voximplant/core";
import {
  addApplicationSecret,
  getApplicationSecretValue,
  setAccountCallbackUrl,
} from "@/lib/voximplant/mutations";

import { readAppSettings } from "./app-settings";
import { assertExecuteLatch, runCommand, type RunCommandResult } from "./exec";

export const APP_ORIGIN_SECRET_NAME = "KALFA_APP_ORIGIN";

/** Console scenarios that read the origin secret, keyed by the rules.config.json
 * rule that binds each (voxfiles/applications/…/rules.config.json). The DTMF
 * `OutCall` rule and every agent rule are deliberately absent. */
export const CONSOLE_SCENARIOS: readonly { scenario: string; rule: string }[] = [
  { scenario: "ConsoleInbound", rule: "incoming" },
  { scenario: "ConsoleDial", rule: "ConsoleInternal" },
  { scenario: "ConsoleCallMeNow", rule: "ConsoleCallMeNow" },
];

/* ------------------------------------------------------------------------- *
 * Config
 * ------------------------------------------------------------------------- */

interface ServiceAccountFile {
  account_id: number | string;
  key_id: string;
  private_key: string;
}

function parseServiceAccount(raw: string): VoximplantConfig | null {
  try {
    const p = JSON.parse(raw) as Partial<ServiceAccountFile>;
    if (
      (typeof p.account_id === "string" || typeof p.account_id === "number") &&
      typeof p.key_id === "string" &&
      typeof p.private_key === "string"
    ) {
      return { accountId: p.account_id, keyId: p.key_id, privateKey: p.private_key };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Management-API credentials: the voxengine-ci credentials file (the same
 * one `npm run vox:upload` uses), then the admin-stored service account. */
export async function loadVoxConfig(
  repoRoot: string,
  env: Record<string, string>,
): Promise<VoximplantConfig | null> {
  const candidates = [
    env.VOXIMPLANT_CREDENTIALS_FILE,
    env.VOX_CI_CREDENTIALS,
    join(repoRoot, "vox_ci_credentials.json"),
  ].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const cfg = parseServiceAccount(readFileSync(path, "utf8"));
    if (cfg) return cfg;
  }
  const row = await readAppSettings<{ voximplant_service_account_json: string | null }>(env, [
    "voximplant_service_account_json",
  ]);
  return row?.voximplant_service_account_json ? parseServiceAccount(row.voximplant_service_account_json) : null;
}

/** The production application id from voxengine-ci's own metadata (what the
 * upload targets), so the secret lands on the app the scenarios run in. */
export function resolveVoxApplicationId(repoRoot: string): number | null {
  const dir = join(repoRoot, "voxfiles", ".voxengine-ci", "applications");
  if (!existsSync(dir)) return null;
  for (const app of readdirSync(dir)) {
    const meta = join(dir, app, "application.metadata.config.json");
    if (!existsSync(meta)) continue;
    try {
      const parsed = JSON.parse(readFileSync(meta, "utf8")) as { applicationId?: number };
      if (typeof parsed.applicationId === "number") return parsed.applicationId;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Deployed scenario ids from voxengine-ci metadata (never hardcoded). */
export function resolveScenarioIds(repoRoot: string): Record<string, number> {
  const out: Record<string, number> = {};
  const dir = join(repoRoot, "voxfiles", ".voxengine-ci", "scenarios", "dist");
  if (!existsSync(dir)) return out;
  for (const { scenario } of CONSOLE_SCENARIOS) {
    const meta = join(dir, `${scenario}.metadata.config.json`);
    if (!existsSync(meta)) continue;
    try {
      const parsed = JSON.parse(readFileSync(meta, "utf8")) as { scenarioId?: number };
      if (typeof parsed.scenarioId === "number") out[scenario] = parsed.scenarioId;
    } catch {
      /* skip */
    }
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * Pure checks (exported for tests)
 * ------------------------------------------------------------------------- */

/** True when a scenario text reads the origin from the secret and no CODE
 * line still pins an https://<host> literal (comment lines are ignored —
 * they document history and break nothing). */
export function scenarioReadsOriginSecret(script: string, host: string): boolean {
  if (!script.includes(`getSecretValue('${APP_ORIGIN_SECRET_NAME}')`)) return false;
  return !scenarioCodeMentionsHost(script, host);
}

export function scenarioCodeMentionsHost(script: string, host: string): boolean {
  const needle = `https://${host}`;
  return script.split("\n").some((line) => {
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
    return line.includes(needle);
  });
}

/** Rewrites an account-callback URL onto the new origin, keeping the path
 * (which embeds the raw token). */
export function rebaseCallbackUrl(current: string, newOrigin: string): string | null {
  try {
    const u = new URL(current);
    return `${newOrigin}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- *
 * Secrets
 * ------------------------------------------------------------------------- */

interface GetSecretsResponse {
  result?: { secret_id?: number; secret_name?: string }[];
}

export async function findAppSecret(
  cfg: VoximplantConfig,
  applicationId: number,
  name: string,
): Promise<{ secretId: number } | null> {
  const res = await voxRequest<GetSecretsResponse>(cfg, "GetSecrets", { application_id: applicationId });
  const hit = (res.result ?? []).find((s) => s.secret_name === name);
  return hit && typeof hit.secret_id === "number" ? { secretId: hit.secret_id } : null;
}

function extractSecretValue(res: Awaited<ReturnType<typeof getApplicationSecretValue>>): string | null {
  if (typeof res.secret_value === "string") return res.secret_value;
  if (res.result && typeof res.result === "object" && typeof res.result.secret_value === "string") {
    return res.result.secret_value;
  }
  return null;
}

/** Read-back for verification: does the secret equal `expected`? The value
 * itself never leaves this function. */
export async function appSecretEquals(
  cfg: VoximplantConfig,
  applicationId: number,
  name: string,
  expected: string,
): Promise<boolean> {
  try {
    const res = await getApplicationSecretValue(cfg, applicationId, name);
    return extractSecretValue(res) === expected;
  } catch {
    return false;
  }
}

/** MUTATING. Creates or rotates the application secret. Returns the previous
 * value (rollback inverse) — kept in memory / .relocate only, never printed. */
export async function ensureAppSecret(
  cfg: VoximplantConfig,
  applicationId: number,
  name: string,
  value: string,
): Promise<{ op: "added" | "updated" | "unchanged"; prevValue: string | null }> {
  assertExecuteLatch(`ensureAppSecret(${name})`);
  const existing = await findAppSecret(cfg, applicationId, name);
  if (!existing) {
    await addApplicationSecret(cfg, applicationId, name, value);
    return { op: "added", prevValue: null };
  }
  let prevValue: string | null = null;
  try {
    prevValue = extractSecretValue(await getApplicationSecretValue(cfg, applicationId, name));
  } catch {
    /* unreadable previous value — rotation still proceeds */
  }
  if (prevValue === value) return { op: "unchanged", prevValue };
  await voxRequest<{ result?: number }>(cfg, "SetSecretInfo", {
    application_id: applicationId,
    secret_id: existing.secretId,
    secret_value: value,
  });
  return { op: "updated", prevValue };
}

/* ------------------------------------------------------------------------- *
 * Deployed-scenario parity + upload
 * ------------------------------------------------------------------------- */

export interface ScenarioParity {
  scenario: string;
  scenarioId: number | null;
  deployedReadsSecret: boolean | null; // null = could not read
  localReadsSecret: boolean;
}

export async function consoleScenarioParity(
  cfg: VoximplantConfig | null,
  repoRoot: string,
  host: string,
): Promise<ScenarioParity[]> {
  const ids = resolveScenarioIds(repoRoot);
  const out: ScenarioParity[] = [];
  for (const { scenario } of CONSOLE_SCENARIOS) {
    const localPath = join(repoRoot, "voxfiles", "scenarios", "src", `${scenario}.voxengine.js`);
    const localReadsSecret = existsSync(localPath)
      ? scenarioReadsOriginSecret(readFileSync(localPath, "utf8"), host)
      : false;
    const scenarioId = ids[scenario] ?? null;
    let deployedReadsSecret: boolean | null = null;
    if (cfg && scenarioId !== null) {
      try {
        const res = await getScenarios(cfg, scenarioId, { with_script: true }, 20_000);
        const row = (res.result ?? []).find((s) => s.scenario_id === scenarioId);
        const script = row?.scenario_script;
        if (typeof script === "string" && script.length > 0) {
          deployedReadsSecret = scenarioReadsOriginSecret(script, host);
        }
      } catch {
        deployedReadsSecret = null;
      }
    }
    out.push({ scenario, scenarioId, deployedReadsSecret, localReadsSecret });
  }
  return out;
}

/** MUTATING. `npm run vox:upload -- --rule-name <rule>` per console rule —
 * the project's only sanctioned deploy path (CLAUDE.md: voxengine-ci upload,
 * never the DTMF OutCall rule). */
export async function uploadConsoleScenarios(
  repoRoot: string,
  scenarios: readonly string[],
  onOutput?: (chunk: string) => void,
): Promise<RunCommandResult[]> {
  assertExecuteLatch("uploadConsoleScenarios");
  const results: RunCommandResult[] = [];
  for (const { scenario, rule } of CONSOLE_SCENARIOS) {
    if (!scenarios.includes(scenario)) continue;
    const res = await runCommand({
      cmd: "npm",
      args: ["run", "vox:upload", "--", "--rule-name", rule],
      cwd: repoRoot,
      timeoutMs: 240_000,
      onOutput,
    });
    results.push(res);
    if (!res.ok) break;
  }
  return results;
}

/* ------------------------------------------------------------------------- *
 * Account callback re-arm
 * ------------------------------------------------------------------------- */

export interface AccountCallbackState {
  /** Present in the live echo (verified 2026-08-24: GetAccountInfo returns
   * `callback_url`; it does NOT return `callback_salt`). */
  echoAvailable: boolean;
  callbackUrl: string | null;
}

export async function readAccountCallback(cfg: VoximplantConfig): Promise<AccountCallbackState> {
  const info = await getAccountInfo(cfg, 10_000);
  const r = (info.result ?? {}) as unknown as Record<string, unknown>;
  const echoAvailable = "callback_url" in r;
  const url = r.callback_url;
  return {
    echoAvailable,
    callbackUrl: typeof url === "string" && url ? url : null,
  };
}

/** The salt the platform signs callbacks with lives ONLY in app_settings
 * (persist-then-mutate, voximplant-channel.ts B5) — the echo never returns
 * it, and re-registering with an empty salt would break signature checks. */
export async function readAccountCallbackSalt(env: Record<string, string>): Promise<string | null> {
  const row = await readAppSettings<{ voximplant_account_callback_salt: string | null }>(env, [
    "voximplant_account_callback_salt",
  ]);
  return row?.voximplant_account_callback_salt || null;
}

/** MUTATING. Re-registers the CURRENT callback token on the new origin with
 * the stored salt. Returns what stood before (rollback inverse). */
export async function rearmAccountCallback(
  cfg: VoximplantConfig,
  newOrigin: string,
  salt: string,
): Promise<{ ok: boolean; detail: string; prevUrl: string | null; next: string | null }> {
  assertExecuteLatch("rearmAccountCallback");
  const prev = await readAccountCallback(cfg);
  if (!prev.echoAvailable) return { ok: false, detail: "GetAccountInfo did not echo callback_url — cannot re-arm safely", prevUrl: null, next: null };
  if (!prev.callbackUrl) return { ok: true, detail: "no account callback registered — nothing to re-arm", prevUrl: null, next: null };
  const next = rebaseCallbackUrl(prev.callbackUrl, newOrigin);
  if (!next) return { ok: false, detail: "current callback_url is not a valid URL", prevUrl: prev.callbackUrl, next: null };
  if (next === prev.callbackUrl) return { ok: true, detail: "callback already on the target origin", prevUrl: prev.callbackUrl, next };
  await setAccountCallbackUrl(cfg, next, salt, 10_000);
  return { ok: true, detail: "callback re-registered on the target origin", prevUrl: prev.callbackUrl, next };
}

/** MUTATING (rollback path). Never blank-resets a callback we did not set. */
export async function restoreAccountCallback(cfg: VoximplantConfig, prevUrl: string | null, salt: string): Promise<void> {
  assertExecuteLatch("restoreAccountCallback");
  if (!prevUrl) return;
  await setAccountCallbackUrl(cfg, prevUrl, salt, 10_000);
}
