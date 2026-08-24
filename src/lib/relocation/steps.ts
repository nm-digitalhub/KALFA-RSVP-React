/**
 * Relocation wizard — step definitions for stages B–H.
 *
 * Wired 2026-08-23: apply()/verify()/rollback() call the execution modules
 * (exec/nginx/env-rewrite/pm2/external/setup-form) behind the RELOCATE_EXECUTE
 * latch those modules already enforce — the CLI is the only thing that ever
 * sets that env var, and only for a real (non-dry-run), gate-approved run.
 * Steps left as NotImplementedError are DELIBERATELY owner-gated/manual
 * (each says why in its message) — not an oversight.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertExecuteLatch,
  backupFile,
  runCommand,
  type RunCommandResult,
} from "./exec";
import {
  getSupabaseAuthConfig,
  listGraphSubscriptions,
  patchSupabaseAuthConfig,
  patchGa4StreamUri,
  projectRefFromSupabaseUrl,
  recreateGraphSubscription,
  runSupabaseSql,
  subscribeMetaWebhook,
  supabaseMgmtToken,
  type GraphSubscriptionInfo,
} from "./external";
import { renderRedirectVhost, writeVhost } from "./nginx";
import {
  rewriteEcosystemOrigin,
  rewriteOriginKeys,
} from "./env-rewrite";
import { NotImplementedError, type StepDefinition, type WizardContext } from "./engine";
import { deploy, cleanRestartFleet, pm2Env } from "./pm2";
import { missingEnvKeys } from "./install-steps";
import { parseEnvFile } from "./preflight";
import { startSetupForm } from "./setup-form";
import { readAppSettings } from "./app-settings";
import {
  createMetaTemplate,
  listMetaTemplates,
  planTemplateNames,
  planTemplateRowSwitch,
  referencedOldNames,
  rewriteComponents,
  templateSwitchSql,
  type MetaCreds,
  type TemplateNamePlan,
  type TemplateRow,
} from "./meta-templates";
import {
  APP_ORIGIN_SECRET_NAME,
  appSecretEquals,
  consoleScenarioParity,
  ensureAppSecret,
  loadVoxConfig,
  readAccountCallback,
  readAccountCallbackSalt,
  rearmAccountCallback,
  resolveVoxApplicationId,
  restoreAccountCallback,
  uploadConsoleScenarios,
} from "./voximplant-relocate";
import {
  collectFolderUrlDocs,
  createKbFolder,
  createKbUrlDocument,
  getElAgentKb,
  getElTool,
  getKbDocument,
  listElTools,
  loadElApiKey,
  patchToolUrl,
  pullAgentConfig,
  pushAgentConfig,
  readAgentConfig,
  readAgentsJson,
  rebaseUrl,
  rewriteAgentKb,
  toolUrl,
  toolsOnHost,
  urlOnHost,
  writeAgentConfig,
  type KbItem,
} from "./elevenlabs-relocate";
import type { Label } from "./state";
import {
  certCoversHost,
  domainRegisteredInPlesk,
  findOldVhostFile,
  isPleskServer,
  issueCertPlesk,
  loadPrevValue,
  localBodyContains,
  localHealthOk,
  registerDomainInPlesk,
  resolveCertEmail,
  resolveServerListenAddress,
  restoreVhostFile,
  runVerificationSuite,
  savePrevValue,
  testAndReloadNginx,
  writeAppVhostForHost,
  removeVhostFile,
} from "./wiring-helpers";

function step(def: {
  id: string;
  stage: StepDefinition["stage"];
  label: Label;
  gate?: StepDefinition["gate"];
  plan: (ctx: WizardContext) => string[];
  check?: StepDefinition["check"];
  backup?: StepDefinition["backup"];
  apply?: StepDefinition["apply"];
  verify?: StepDefinition["verify"];
  rollback?: StepDefinition["rollback"];
}): StepDefinition {
  return {
    id: def.id,
    stage: def.stage,
    label: def.label,
    gate: def.gate,
    check: def.check ?? (async () => "pending"),
    plan: async (ctx) => def.plan(ctx),
    backup: def.backup,
    apply:
      def.apply ??
      (async () => {
        throw new NotImplementedError("stage not enabled in this build");
      }),
    verify: def.verify ?? (async () => ({ ok: false, checks: [] })),
    rollback: def.rollback,
  };
}

const host = (origin: string) => new URL(origin).hostname;

function requireOk(res: RunCommandResult, what: string): void {
  if (!res.ok) throw new Error(`${what} failed (exit ${res.code ?? "?"})`);
}

function readEnv(repoRoot: string): Record<string, string> {
  return parseEnvFile(readFileSync(join(repoRoot, ".env.local"), "utf8"));
}

/** WhatsApp credentials live in app_settings (DB), not env. */
async function metaCreds(repoRoot: string): Promise<MetaCreds | null> {
  const row = await readAppSettings<{ whatsapp_waba_id: string | null; whatsapp_access_token: string | null }>(
    readEnv(repoRoot),
    ["whatsapp_waba_id", "whatsapp_access_token"],
  );
  if (!row?.whatsapp_waba_id || !row.whatsapp_access_token) return null;
  return { wabaId: row.whatsapp_waba_id, accessToken: row.whatsapp_access_token };
}

/** Old→new template-name plan from the LIVE WABA inventory. */
async function metaPlans(ctx: WizardContext, creds: MetaCreds): Promise<TemplateNamePlan[]> {
  const templates = await listMetaTemplates(creds);
  return planTemplateNames(templates, host(ctx.previousOrigin), host(ctx.targetOrigin));
}

function planSummary(plans: TemplateNamePlan[]): string {
  const counts = new Map<string, number>();
  for (const p of plans) {
    const k = p.newStatus ?? "NOT SUBMITTED";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(", ") || "none";
}

/** Supabase Management-API handle for the Stage G SQL steps. */
function mgmtHandle(repoRoot: string): { token: string; projectRef: string } | null {
  const env = readEnv(repoRoot);
  const resolved = supabaseMgmtToken({ env });
  if (!resolved || !env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return { token: resolved.token, projectRef: projectRefFromSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL) };
}

async function readTemplateRows(handle: { token: string; projectRef: string }): Promise<TemplateRow[] | null> {
  const res = await runSupabaseSql({
    ...handle,
    query: "SELECT message_key, name, components FROM message_templates WHERE channel = 'whatsapp'",
    readOnly: true,
  });
  if (!res.ok || !Array.isArray(res.value)) return null;
  return res.value as TemplateRow[];
}

/** Voximplant handle shared by F5/F6/F6b. */
async function voxHandle(repoRoot: string) {
  const env = readEnv(repoRoot);
  const cfg = await loadVoxConfig(repoRoot, env);
  const appId = resolveVoxApplicationId(repoRoot);
  return cfg && appId !== null ? { cfg, appId, env } : null;
}

/** ElevenLabs KB relocation plan for ONE agent, computed from the live agent
 * config: which KB items still resolve to url documents on the old host. */
async function elAgentKbPlan(
  apiKey: string,
  agentId: string,
  oldHost: string,
): Promise<{ items: KbItem[]; stale: { item: KbItem; urls: { id: string; name: string; url: string }[] }[] } | null> {
  const items = await getElAgentKb(apiKey, agentId);
  if (!items) return null;
  const stale: { item: KbItem; urls: { id: string; name: string; url: string }[] }[] = [];
  for (const item of items) {
    if (item.type === "url") {
      const doc = await getKbDocument(apiKey, item.id);
      if (doc?.url && urlOnHost(doc.url, oldHost)) stale.push({ item, urls: [{ id: doc.id, name: doc.name, url: doc.url }] });
    } else if (item.type === "folder") {
      const docs = (await collectFolderUrlDocs(apiKey, item.id)).filter((d) => urlOnHost(d.url, oldHost));
      if (docs.length > 0) {
        stale.push({ item, urls: docs.map((d) => ({ id: d.id, name: d.name, url: d.url as string })) });
      }
    }
  }
  return { items, stale };
}

/** The full intended sequence (plan doc §5). Stage A runs OUTSIDE the engine
 * as the read-only preflight; stages B–H are engine steps. */
export function buildStepDefinitions(): StepDefinition[] {
  return [
    step({
      id: "B1",
      stage: "B",
      gate: "meta-template-submit",
      label: { en: "Submit Meta template versions on the new origin", he: "הגשת גרסאות תבנית ל-Meta על הכתובת החדשה" },
      plan: (ctx) => [
        `live WABA inventory → every APPROVED template whose URL button targets ${host(ctx.previousOrigin)} gets a _vN+1 successor submitted with base ${ctx.targetOrigin} (POST /{waba}/message_templates; the approved original is never edited or deleted)`,
        "idempotent: a successor already carrying the new host (any status) is not re-submitted; components (BODY/FOOTER/QUICK_REPLY + examples) are carried verbatim, only URL buttons are re-based",
      ],
      check: async (ctx) => {
        const creds = await metaCreds(ctx.repoRoot);
        if (!creds) return "blocked";
        const plans = await metaPlans(ctx, creds);
        return plans.every((p) => p.newStatus !== null) ? "done" : "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("B1 Meta template submit");
        const creds = await metaCreds(ctx.repoRoot);
        if (!creds) throw new Error("WhatsApp credentials unavailable in app_settings");
        const templates = await listMetaTemplates(creds);
        const plans = planTemplateNames(templates, host(ctx.previousOrigin), host(ctx.targetOrigin));
        const byName = new Map(templates.map((t) => [t.name, t]));
        const submitted: string[] = [];
        for (const p of plans) {
          if (p.newStatus !== null) continue;
          const src = byName.get(p.oldName);
          if (!src) continue;
          const res = await createMetaTemplate(creds, {
            name: p.newName,
            language: src.language,
            category: src.category,
            parameter_format: src.parameter_format,
            components: rewriteComponents(src.components, host(ctx.previousOrigin), ctx.targetOrigin),
          });
          if (!res.ok) throw new Error(`Meta submit ${p.newName} failed: ${res.detail}`);
          submitted.push(p.newName);
        }
        savePrevValue(ctx.repoRoot, "B1", { submitted });
      },
      verify: async (ctx) => {
        const creds = await metaCreds(ctx.repoRoot);
        if (!creds) return { ok: false, checks: [{ label: { en: "WhatsApp credentials", he: "פרטי WhatsApp" }, ok: false }] };
        const plans = await metaPlans(ctx, creds);
        const ok = plans.every((p) => p.newStatus !== null);
        return {
          ok,
          checks: [
            {
              label: { en: `${plans.length} successor template(s) exist on the WABA`, he: `${plans.length} תבניות-המשך קיימות ב-WABA` },
              ok,
              detail: planSummary(plans),
            },
          ],
        };
      },
      // No rollback: a submitted template version is a review item on Meta's
      // side, never deleted by the wizard (owner rule: submit in addition).
    }),
    step({
      id: "B2",
      stage: "B",
      gate: "meta-approval-override",
      label: { en: "Wait for Meta template approval", he: "המתנה לאישור תבניות Meta" },
      plan: () => [
        "poll the successors' status on the WABA: all APPROVED → continue automatically",
        "not yet approved → the meta-approval-override gate decides whether the move proceeds now (old URL buttons keep working through the Stage E 301; G2 switches each template the moment Meta approves it — re-run `repair G2 pending` + --resume later)",
      ],
      check: async (ctx) => {
        const creds = await metaCreds(ctx.repoRoot);
        if (!creds) return "blocked";
        const plans = await metaPlans(ctx, creds);
        return plans.every((p) => p.newStatus === "APPROVED") ? "done" : "pending";
      },
      // Reached only through the override gate: nothing to mutate — the
      // decision itself is the step.
      apply: async () => undefined,
      verify: async (ctx) => {
        const creds = await metaCreds(ctx.repoRoot);
        const plans = creds ? await metaPlans(ctx, creds) : [];
        const approved = plans.filter((p) => p.newStatus === "APPROVED").length;
        return {
          ok: true,
          checks: [
            {
              label: { en: `${approved}/${plans.length} successor template(s) approved`, he: `${approved}/${plans.length} תבניות-המשך אושרו` },
              ok: approved === plans.length,
              detail: planSummary(plans),
            },
          ],
        };
      },
    }),
    step({
      id: "C1",
      stage: "C",
      gate: "go-live",
      label: { en: "Register domain for cert management", he: "רישום הדומיין לניהול תעודות" },
      plan: (ctx) => [
        `plesk bin domain --create ${host(ctx.targetOrigin)} (no hosting) — only if not already in Plesk`,
      ],
      check: async (ctx) => {
        if (!(await isPleskServer())) return "done"; // bare server: nothing to register here
        return (await domainRegisteredInPlesk(host(ctx.targetOrigin))) ? "done" : "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("C1 register domain");
        await registerDomainInPlesk(host(ctx.targetOrigin));
      },
      verify: async (ctx) => {
        const ok = await domainRegisteredInPlesk(host(ctx.targetOrigin));
        return { ok, checks: [{ label: { en: "domain registered", he: "הדומיין רשום" }, ok }] };
      },
    }),
    step({
      id: "C2",
      stage: "C",
      label: { en: "Issue TLS certificate", he: "הנפקת תעודת TLS" },
      plan: (ctx) => [
        `issue Let's Encrypt cert for ${host(ctx.targetOrigin)} (http-01; retry with backoff; hard-stop before 5 failed validations/hour)`,
        "skip if an existing cert already covers the target (e.g. wildcard)",
      ],
      check: async (ctx) => ((await certCoversHost(host(ctx.targetOrigin))) ? "done" : "pending"),
      apply: async (ctx) => {
        assertExecuteLatch("C2 issue TLS certificate");
        const email = await resolveCertEmail(ctx.repoRoot, ctx.targetOrigin);
        await issueCertPlesk(host(ctx.targetOrigin), email);
      },
      verify: async (ctx) => {
        const ok = await certCoversHost(host(ctx.targetOrigin));
        return { ok, checks: [{ label: { en: "TLS probe", he: "בדיקת TLS" }, ok }] };
      },
    }),
    step({
      id: "C3",
      stage: "C",
      label: { en: "Write nginx vhost", he: "כתיבת vhost ב-nginx" },
      plan: (ctx) => [
        `write /etc/nginx/conf.d/${host(ctx.targetOrigin)}-app.conf from the repo template`,
        "template includes: proxy → 127.0.0.1:3002, X-Forwarded-Host/Proto, enlarged proxy buffers (502 fix), ACME location",
      ],
      apply: async (ctx) => {
        assertExecuteLatch("C3 write nginx vhost");
        const listenAddress = await resolveServerListenAddress(ctx.previousOrigin);
        await writeAppVhostForHost(host(ctx.targetOrigin), listenAddress);
      },
      verify: async () => {
        const test = await testAndReloadNginx();
        return { ok: test.ok, checks: [{ label: { en: "nginx -t", he: "בדיקת nginx" }, ok: test.ok, detail: test.output.slice(0, 200) }] };
      },
      // The vhost is NEW (Stage A's conflict gate already handled a pre-existing
      // one) — rollback removes exactly what this step wrote, nothing more.
      rollback: async (ctx) => {
        await removeVhostFile(`/etc/nginx/conf.d/${host(ctx.targetOrigin)}-app.conf`);
      },
    }),
    step({
      id: "C4",
      stage: "C",
      label: { en: "Test and reload nginx", he: "בדיקת nginx וטעינה מחדש" },
      plan: () => ["nginx -t (whitelisting the benign duplicate-server_name warning) → systemctl reload nginx"],
      // C3's own verify already runs nginx -t + reload — this step's job is
      // done once C3 verified; a second no-op pass just re-confirms.
      check: async () => "done",
      verify: async () => {
        const test = await testAndReloadNginx();
        return { ok: test.ok, checks: [{ label: { en: "nginx -t (re-check)", he: "בדיקת nginx חוזרת" }, ok: test.ok }] };
      },
    }),
    step({
      id: "D0",
      stage: "D",
      label: {
        en: "Env catalog completeness (browser setup form if needed)",
        he: "שלמות קטלוג הפרמטרים (טופס דפדפן אם חסר)",
      },
      plan: (ctx) => [
        "verify .env.local carries every key in .env.example (names only; wizard-only keys excluded)",
        `if keys are MISSING: the same browser setup form as install mode opens at https://${new URL(ctx.targetOrigin).hostname}/setup?token=<one-time> — live-validated per key, wizard continues automatically once complete (design §5c)`,
        "if complete (the normal relocation case): this step is a no-op",
      ],
      // Real check today (read-only): 'done' when the catalog is complete —
      // the normal relocation case — so the engine skips it without a form.
      check: async (ctx) => {
        const { missing, hasEnv } = missingEnvKeys(ctx.repoRoot);
        if (!hasEnv) return "blocked";
        return missing.length === 0 ? "done" : "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("D0 env catalog setup form");
        const handle = await startSetupForm({ repoRoot: ctx.repoRoot, targetOrigin: ctx.targetOrigin });
        process.stdout.write(`\nOpen in a browser: ${handle.url}\n\n`);
        const result = await handle.completed;
        if (result.skippedKeys.length > 0) {
          savePrevValue(ctx.repoRoot, "D0", { skippedKeys: result.skippedKeys });
        }
      },
      verify: async (ctx) => {
        const ok = missingEnvKeys(ctx.repoRoot).missing.length === 0;
        return { ok, checks: [{ label: { en: "env catalog complete", he: "קטלוג הפרמטרים שלם" }, ok }] };
      },
    }),
    step({
      id: "D1",
      stage: "D",
      label: { en: "Rewrite origin env keys", he: "שכתוב מפתחות ה-origin ב-env" },
      plan: (ctx) => [
        `.env.local: APP_ORIGIN → ${ctx.targetOrigin}; PGBOSS_DASHBOARD_URL host → ${host(ctx.targetOrigin)} (backup first)`,
        `ecosystem.config.cjs: inline kalfa-fleet APP_ORIGIN → ${ctx.targetOrigin} (deliberate duplicate, plan §3 #3)`,
      ],
      // Pre-mutation backups of BOTH files, so rollback always has real
      // records — independent of whatever the latched rewrite wrappers do
      // internally (they also self-backup; harmless double-backup, but
      // step.backups here is the one the engine hands to rollback()).
      backup: async (ctx) => {
        assertExecuteLatch("D1 backup");
        const backups: { path: string; backupPath: string }[] = [];
        const envPath = join(ctx.repoRoot, ".env.local");
        const ecoPath = join(ctx.repoRoot, "ecosystem.config.cjs");
        if (existsSync(envPath)) backups.push(backupFile(envPath));
        if (existsSync(ecoPath)) backups.push(backupFile(ecoPath));
        return backups;
      },
      apply: async (ctx) => {
        rewriteOriginKeys({ repoRoot: ctx.repoRoot, newOrigin: ctx.targetOrigin });
        rewriteEcosystemOrigin({ repoRoot: ctx.repoRoot, newOrigin: ctx.targetOrigin });
      },
      verify: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        const ok = env.APP_ORIGIN === ctx.targetOrigin;
        return { ok, checks: [{ label: { en: "APP_ORIGIN rewritten", he: "APP_ORIGIN עודכן" }, ok }] };
      },
      rollback: async (_ctx, saved) => {
        for (const { path, backupPath } of saved) {
          await runCommand({ cmd: "cp", args: [backupPath, path] });
        }
      },
    }),
    step({
      id: "D2",
      stage: "D",
      label: { en: "Rebuild and deploy", he: "בנייה מחדש ופריסה" },
      plan: () => [
        "npm run deploy — rebuild REQUIRED: llms.txt/robots/sitemap/static-page metadata bake the origin at build",
        "the rebuild mints a new deploymentId → stale tabs hard-reload (version-skew cutover)",
      ],
      apply: async (ctx) => {
        const res = await deploy(ctx.repoRoot, (chunk) => process.stdout.write(chunk));
        requireOk(res, "npm run deploy");
      },
      // No rollback function: recovery is D1's rollback (restore old env)
      // followed by re-running D2 — a second deploy, not a file restore.
      verify: async (ctx) => {
        const health = await localHealthOk();
        const robotsOk = await localBodyContains("/robots.txt", host(ctx.targetOrigin), ctx.targetOrigin);
        const ok = health && robotsOk;
        return {
          ok,
          checks: [
            { label: { en: "/api/health", he: "בדיקת בריאות" }, ok: health },
            { label: { en: "robots.txt reflects new origin", he: "robots.txt משקף את הכתובת החדשה" }, ok: robotsOk },
          ],
        };
      },
    }),
    step({
      id: "D3",
      stage: "D",
      label: { en: "Clean-restart kalfa-fleet", he: "אתחול נקי ל-kalfa-fleet" },
      plan: () => [
        "pm2 delete kalfa-fleet → scrubbed start (env -i … pm2 start ecosystem.config.cjs --only kalfa-fleet) → pm2 save",
        "NEVER pm2 restart --update-env (2026-07-06 env-pollution incident, plan §5 Stage D.1)",
      ],
      apply: async (ctx) => {
        const home = process.env.HOME ?? "";
        const user = process.env.USER ?? "";
        const results = await cleanRestartFleet({ repoRoot: ctx.repoRoot, home, user });
        const failed = results.find((r) => !r.ok);
        if (failed) throw new Error(`kalfa-fleet clean restart failed (exit ${failed.code ?? "?"})`);
      },
      verify: async (ctx) => {
        const env = await pm2Env("kalfa-fleet");
        const ok = env?.APP_ORIGIN === ctx.targetOrigin;
        return { ok, checks: [{ label: { en: "kalfa-fleet effective APP_ORIGIN", he: "APP_ORIGIN בפועל ב-kalfa-fleet" }, ok }] };
      },
    }),
    step({
      id: "E1",
      stage: "E",
      label: { en: "Old-origin 301 + API proxy exception", he: "הפניית 301 מהדומיין הישן" },
      plan: (ctx) => [
        `rewrite the old origin's vhost: location / → 301 ${ctx.targetOrigin}$request_uri`,
        "EXCEPT /api/* which keeps proxying to the app (Voximplant callbacks + installed Android builds POST there; POSTs don't survive 301)",
      ],
      backup: async (ctx) => {
        assertExecuteLatch("E1 backup");
        const oldHost = host(ctx.previousOrigin);
        const path = await findOldVhostFile(oldHost);
        if (!path) return [];
        const backupPath = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const cp = await runCommand({ cmd: "cp", args: [path, backupPath], sudo: true });
        return cp.ok ? [{ path, backupPath }] : [];
      },
      apply: async (ctx) => {
        // nginx.ts's writeVhost also self-backs-up (harmless duplicate);
        // this step's own backup() above is what rollback() relies on.
        const oldHost = host(ctx.previousOrigin);
        const path = (await findOldVhostFile(oldHost)) ?? `/etc/nginx/conf.d/${oldHost}-app.conf`;
        const content = renderRedirectVhost({ fromDomain: oldHost, toOrigin: ctx.targetOrigin });
        await writeVhost(path, content);
      },
      verify: async () => {
        const test = await testAndReloadNginx();
        return { ok: test.ok, checks: [{ label: { en: "nginx -t", he: "בדיקת nginx" }, ok: test.ok }] };
      },
      rollback: async (_ctx, saved) => {
        for (const { path, backupPath } of saved) {
          await restoreVhostFile(path, backupPath);
        }
        await testAndReloadNginx();
      },
    }),
    step({
      id: "F1",
      stage: "F",
      label: { en: "Supabase auth Site URL + redirects", he: "עדכון Supabase auth" },
      plan: (ctx) => [
        `Management API PATCH /v1/projects/{ref}/config/auth: site_url + redirect allow-list → ${ctx.targetOrigin}`,
      ],
      check: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        const resolved = supabaseMgmtToken({ env });
        const projectUrl = env.NEXT_PUBLIC_SUPABASE_URL;
        if (!resolved || !projectUrl) return "blocked";
        try {
          const projectRef = projectRefFromSupabaseUrl(projectUrl);
          const current = await getSupabaseAuthConfig({ token: resolved.token, projectRef });
          if (current.ok && current.value?.site_url === ctx.targetOrigin) return "done";
        } catch {
          return "blocked";
        }
        return "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("F1 Supabase auth config");
        const env = readEnv(ctx.repoRoot);
        const resolved = supabaseMgmtToken({ env });
        const projectUrl = env.NEXT_PUBLIC_SUPABASE_URL;
        if (!resolved || !projectUrl) throw new Error("Supabase Management token/project URL unavailable");
        const projectRef = projectRefFromSupabaseUrl(projectUrl);
        const res = await patchSupabaseAuthConfig({
          token: resolved.token,
          projectRef,
          siteUrl: ctx.targetOrigin,
          additionalRedirects: [ctx.targetOrigin],
        });
        if (res.prevValue) savePrevValue(ctx.repoRoot, "F1", { ...res.prevValue, projectRef });
        if (!res.ok) throw new Error(`Supabase auth config PATCH failed: ${res.detail}`);
      },
      verify: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        const resolved = supabaseMgmtToken({ env });
        if (!resolved) return { ok: false, checks: [{ label: { en: "read back", he: "קריאה חוזרת" }, ok: false }] };
        const projectRef = projectRefFromSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
        const current = await getSupabaseAuthConfig({ token: resolved.token, projectRef });
        const ok = current.ok && current.value?.site_url === ctx.targetOrigin;
        return { ok, checks: [{ label: { en: "site_url matches target", he: "site_url תואם ליעד" }, ok }] };
      },
      rollback: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        const resolved = supabaseMgmtToken({ env });
        const prev = loadPrevValue<{ site_url: string; uri_allow_list: string; projectRef: string }>(
          ctx.repoRoot,
          "F1",
        );
        if (!resolved || !prev) return;
        await patchSupabaseAuthConfig({
          token: resolved.token,
          projectRef: prev.projectRef,
          siteUrl: prev.site_url,
          additionalRedirects: prev.uri_allow_list.split(",").filter(Boolean),
        });
      },
    }),
    step({
      id: "F2",
      stage: "F",
      label: { en: "Redeploy Supabase auth email templates", he: "פריסת תבניות מייל auth" },
      plan: () => [
        "re-run scripts/deploy-recovery-email-template.mjs --apply and scripts/deploy-email-change-template.mjs --apply",
      ],
      apply: async (ctx) => {
        assertExecuteLatch("F2 redeploy email templates");
        const a = await runCommand({
          cmd: "node",
          args: ["scripts/deploy-recovery-email-template.mjs", "--apply"],
          cwd: ctx.repoRoot,
          timeoutMs: 60_000,
        });
        requireOk(a, "deploy-recovery-email-template.mjs --apply");
        const b = await runCommand({
          cmd: "node",
          args: ["scripts/deploy-email-change-template.mjs", "--apply"],
          cwd: ctx.repoRoot,
          timeoutMs: 60_000,
        });
        requireOk(b, "deploy-email-change-template.mjs --apply");
      },
      verify: async () => ({ ok: true, checks: [{ label: { en: "both scripts exited 0", he: "שני הסקריפטים הצליחו" }, ok: true }] }),
    }),
    step({
      id: "F3",
      stage: "F",
      label: { en: "Meta WhatsApp webhook", he: "עדכון webhook של Meta" },
      plan: (ctx) => [
        `POST /{app-id}/subscriptions with callback ${ctx.targetOrigin}/api/webhooks/whatsapp; verify handshake`,
      ],
      // Meta's subscriptions endpoint needs an APP id + app-level token
      // (META_APP_ID/META_APP_SECRET, env) and the webhook verify_token,
      // which is DB-resident (app_settings.whatsapp_verify_token) — there is
      // no app_id column in app_settings (checked live 2026-08-23), so this
      // blocks with a clear reason rather than guessing at a shape.
      check: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        if (!env.META_APP_ID || !env.META_APP_SECRET) {
          return "blocked";
        }
        return "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("F3 Meta WhatsApp webhook");
        const env = readEnv(ctx.repoRoot);
        const base = env.NEXT_PUBLIC_SUPABASE_URL;
        const key = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!base || !key) throw new Error("Supabase REST credentials unavailable to read the verify token");
        const res = await fetch(`${base}/rest/v1/app_settings?id=eq.true&select=whatsapp_verify_token`, {
          headers: { apikey: key, authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        });
        const rows = (await res.json()) as { whatsapp_verify_token?: string | null }[];
        const verifyToken = rows[0]?.whatsapp_verify_token;
        if (!verifyToken) throw new Error("whatsapp_verify_token not set in app_settings");
        const result = await subscribeMetaWebhook({
          appId: env.META_APP_ID,
          appToken: `${env.META_APP_ID}|${env.META_APP_SECRET}`,
          callbackUrl: `${ctx.targetOrigin}/api/webhooks/whatsapp`,
          verifyToken,
        });
        if (!result.ok) throw new Error(`Meta subscription failed: ${result.detail}`);
      },
      verify: async () => ({ ok: true, checks: [{ label: { en: "subscription POST accepted", he: "הרשמת webhook התקבלה" }, ok: true }] }),
    }),
    step({
      id: "F4",
      stage: "F",
      label: { en: "Microsoft Graph subscriptions", he: "מנויי Microsoft Graph" },
      plan: (ctx) => [
        `delete + recreate Graph webhook subscriptions (notificationUrl embeds ${ctx.targetOrigin})`,
      ],
      check: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        if (!env.MS_GRAPH_TENANT_ID || !env.MS_GRAPH_CLIENT_ID || !env.MS_GRAPH_CERT_PATH) return "blocked";
        return "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("F4 Graph subscriptions");
        const env = readEnv(ctx.repoRoot);
        const current = await listGraphSubscriptions({ env });
        if (!current.ok || !current.value) throw new Error(`could not list Graph subscriptions: ${current.detail}`);
        const oldHost = host(ctx.previousOrigin);
        const targets = current.value.filter((s) => s.notificationUrl.includes(oldHost));
        const created: GraphSubscriptionInfo["id"][] = [];
        for (const sub of targets) {
          const newUrl = sub.notificationUrl.replace(`https://${oldHost}`, ctx.targetOrigin);
          const res = await recreateGraphSubscription({
            env,
            deleteId: sub.id,
            resource: sub.resource,
            changeType: sub.changeType,
            notificationUrl: newUrl,
            clientState: `relocate-${ctx.targetOrigin}`,
          });
          if (!res.ok) throw new Error(`Graph subscription recreate failed for ${sub.id}: ${res.detail}`);
          created.push(sub.id);
        }
        savePrevValue(ctx.repoRoot, "F4", { recreated: created });
      },
      verify: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        const current = await listGraphSubscriptions({ env });
        const oldHost = host(ctx.previousOrigin);
        const ok = current.ok && (current.value ?? []).every((s) => !s.notificationUrl.includes(oldHost));
        return { ok, checks: [{ label: { en: "no subscription targets the old origin", he: "אין מנוי שמצביע לכתובת הישנה" }, ok }] };
      },
      // No rollback: Graph assigns a fresh subscription id on create, so a
      // deleted-and-recreated subscription cannot be restored to its exact
      // prior identity — re-run F4 after a relocation rollback instead.
    }),
    step({
      id: "F5",
      stage: "F",
      label: { en: "Voximplant account callback re-arm", he: "חיווט מחדש של callback החשבון ב-Voximplant" },
      plan: (ctx) => [
        `GetAccountInfo echoes the current callback_url (embeds the raw token) → SetAccountInfo re-registers the SAME token on ${ctx.targetOrigin} with the salt stored in app_settings — the stored hash stays valid, no DB write`,
        "previous callback_url saved to .relocate/F5-prev.json for rollback; the /api/* proxy on the old origin (E1) keeps late callbacks working meanwhile",
      ],
      check: async (ctx) => {
        const h = await voxHandle(ctx.repoRoot);
        if (!h) return "blocked";
        const cur = await readAccountCallback(h.cfg);
        if (!cur.echoAvailable) return "blocked";
        if (!cur.callbackUrl) return "done";
        if (cur.callbackUrl.startsWith(`${ctx.targetOrigin}/`)) return "done";
        return (await readAccountCallbackSalt(h.env)) ? "pending" : "blocked";
      },
      apply: async (ctx) => {
        assertExecuteLatch("F5 account callback re-arm");
        const h = await voxHandle(ctx.repoRoot);
        if (!h) throw new Error("Voximplant credentials/application id unavailable");
        const salt = await readAccountCallbackSalt(h.env);
        if (!salt) throw new Error("account-callback salt missing in app_settings — re-arm would break signature checks");
        const res = await rearmAccountCallback(h.cfg, ctx.targetOrigin, salt);
        savePrevValue(ctx.repoRoot, "F5", { prevUrl: res.prevUrl });
        if (!res.ok) throw new Error(`account callback re-arm failed: ${res.detail}`);
      },
      verify: async (ctx) => {
        const h = await voxHandle(ctx.repoRoot);
        const cur = h ? await readAccountCallback(h.cfg) : null;
        const ok = Boolean(cur && (!cur.callbackUrl || cur.callbackUrl.startsWith(`${ctx.targetOrigin}/`)));
        return { ok, checks: [{ label: { en: "callback_url echo on target origin", he: "callback_url על הכתובת החדשה" }, ok }] };
      },
      rollback: async (ctx) => {
        const h = await voxHandle(ctx.repoRoot);
        const prev = loadPrevValue<{ prevUrl: string | null }>(ctx.repoRoot, "F5");
        const salt = h ? await readAccountCallbackSalt(h.env) : null;
        if (!h || !prev || !salt) return;
        await restoreAccountCallback(h.cfg, prev.prevUrl, salt);
      },
    }),
    step({
      id: "F6",
      stage: "F",
      gate: "voximplant-scenario-redeploy",
      label: { en: `Voximplant ${APP_ORIGIN_SECRET_NAME} application secret`, he: `סוד האפליקציה ${APP_ORIGIN_SECRET_NAME} ב-Voximplant` },
      plan: (ctx) => [
        `GetSecrets on the kalfa-rsvp application → AddSecret / SetSecretInfo ${APP_ORIGIN_SECRET_NAME} = ${ctx.targetOrigin} (the console scenarios read it via VoxEngine.getSecretValue, so a move is a secret rotation, not a redeploy)`,
        "read back via GetSecretValue to verify; the previous value is kept only in .relocate/ for rollback, never printed",
      ],
      check: async (ctx) => {
        const h = await voxHandle(ctx.repoRoot);
        if (!h) return "blocked";
        return (await appSecretEquals(h.cfg, h.appId, APP_ORIGIN_SECRET_NAME, ctx.targetOrigin)) ? "done" : "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("F6 application secret");
        const h = await voxHandle(ctx.repoRoot);
        if (!h) throw new Error("Voximplant credentials/application id unavailable");
        const res = await ensureAppSecret(h.cfg, h.appId, APP_ORIGIN_SECRET_NAME, ctx.targetOrigin);
        savePrevValue(ctx.repoRoot, "F6", { op: res.op, prevValue: res.prevValue });
      },
      verify: async (ctx) => {
        const h = await voxHandle(ctx.repoRoot);
        const ok = Boolean(h && (await appSecretEquals(h.cfg, h.appId, APP_ORIGIN_SECRET_NAME, ctx.targetOrigin)));
        return { ok, checks: [{ label: { en: "GetSecretValue read-back equals target origin", he: "קריאה חוזרת של הסוד תואמת ליעד" }, ok }] };
      },
      rollback: async (ctx) => {
        const h = await voxHandle(ctx.repoRoot);
        const prev = loadPrevValue<{ prevValue: string | null }>(ctx.repoRoot, "F6");
        if (!h || !prev?.prevValue) return;
        await ensureAppSecret(h.cfg, h.appId, APP_ORIGIN_SECRET_NAME, prev.prevValue);
      },
    }),
    step({
      id: "F6b",
      stage: "F",
      gate: "voximplant-scenario-redeploy",
      label: { en: "Upload console scenarios (only if the deployed text still pins an origin)", he: "העלאת תסריטי הקונסול (רק אם הגרסה הפרוסה עדיין מקבעת כתובת)" },
      plan: () => [
        "GetScenarios with_script parity for ConsoleInbound / ConsoleDial / ConsoleCallMeNow: skipped when the DEPLOYED text already reads the secret and pins no origin literal",
        "otherwise `npm run vox:upload -- --rule-name <incoming|ConsoleInternal|ConsoleCallMeNow>` per stale scenario (voxengine-ci; the DTMF OutCall rule 1494311 and the agent rules are never touched)",
      ],
      check: async (ctx) => {
        const h = await voxHandle(ctx.repoRoot);
        if (!h) return "blocked";
        const parity = await consoleScenarioParity(h.cfg, ctx.repoRoot, host(ctx.previousOrigin));
        if (parity.some((p) => !p.localReadsSecret || p.deployedReadsSecret === null)) return "blocked";
        return parity.every((p) => p.deployedReadsSecret) ? "done" : "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("F6b console scenario upload");
        const h = await voxHandle(ctx.repoRoot);
        if (!h) throw new Error("Voximplant credentials/application id unavailable");
        const parity = await consoleScenarioParity(h.cfg, ctx.repoRoot, host(ctx.previousOrigin));
        const stale = parity.filter((p) => p.deployedReadsSecret === false).map((p) => p.scenario);
        const results = await uploadConsoleScenarios(ctx.repoRoot, stale, (chunk) => process.stdout.write(chunk));
        const failed = results.find((r) => !r.ok);
        if (failed) throw new Error(`vox:upload failed (exit ${failed.code ?? "?"})`);
      },
      verify: async (ctx) => {
        const h = await voxHandle(ctx.repoRoot);
        const parity = h ? await consoleScenarioParity(h.cfg, ctx.repoRoot, host(ctx.previousOrigin)) : [];
        const ok = parity.length > 0 && parity.every((p) => p.deployedReadsSecret === true);
        return {
          ok,
          checks: parity.map((p) => ({
            label: { en: `${p.scenario} deployed text reads the secret`, he: `${p.scenario} — הגרסה הפרוסה קוראת את הסוד` },
            ok: p.deployedReadsSecret === true,
          })),
        };
      },
      // No rollback: the previous deployed text pinned the OLD origin; after a
      // relocation rollback the secret (F6) is what restores behaviour.
    }),
    step({
      id: "F7",
      stage: "F",
      label: { en: "GA4 data stream URI", he: "עדכון GA4" },
      plan: (ctx) => [`GA Admin API dataStreams.patch default URI → ${ctx.targetOrigin}`],
      check: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        if (!env.GA4_PROPERTY_ID || !env.GA4_STREAM_ID || !env.GOOGLE_APPLICATION_CREDENTIALS) return "blocked";
        return "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("F7 GA4 data stream URI");
        const env = readEnv(ctx.repoRoot);
        const res = await patchGa4StreamUri({
          propertyId: env.GA4_PROPERTY_ID,
          streamId: env.GA4_STREAM_ID,
          uri: ctx.targetOrigin,
        });
        if (res.prevValue) savePrevValue(ctx.repoRoot, "F7", res.prevValue);
        if (!res.ok) throw new Error(`GA4 dataStreams.patch failed: ${res.detail}`);
      },
      verify: async () => ({ ok: true, checks: [{ label: { en: "dataStreams.patch accepted", he: "עדכון GA4 התקבל" }, ok: true }] }),
      rollback: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        const prev = loadPrevValue<{ defaultUri: string }>(ctx.repoRoot, "F7");
        if (!prev?.defaultUri || !env.GA4_PROPERTY_ID || !env.GA4_STREAM_ID) return;
        await patchGa4StreamUri({
          propertyId: env.GA4_PROPERTY_ID,
          streamId: env.GA4_STREAM_ID,
          uri: prev.defaultUri,
        });
      },
    }),
    step({
      id: "F8",
      stage: "F",
      gate: "elevenlabs-live-update",
      label: { en: "ElevenLabs webhook tools", he: "כלי webhook ב-ElevenLabs" },
      plan: (ctx) => [
        `GET /v1/convai/tools → every webhook tool whose URL targets ${host(ctx.previousOrigin)} is PATCHed with its own tool_config re-based onto ${ctx.targetOrigin} (live today: lookup_guest_rsvp → /api/agent/rsvp-lookup; client tools carry no URL)`,
        "previous URLs saved to .relocate/F8-prev.json for rollback",
      ],
      check: async (ctx) => {
        const key = loadElApiKey(readEnv(ctx.repoRoot));
        if (!key) return "blocked";
        return toolsOnHost(await listElTools(key), host(ctx.previousOrigin)).length === 0 ? "done" : "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("F8 ElevenLabs webhook tools");
        const key = loadElApiKey(readEnv(ctx.repoRoot));
        if (!key) throw new Error("ELEVENLABS_API_KEY missing");
        const stale = toolsOnHost(await listElTools(key), host(ctx.previousOrigin));
        const prev: { id: string; prevUrl: string | null }[] = [];
        for (const tool of stale) {
          const url = toolUrl(tool);
          if (!url) continue;
          const res = await patchToolUrl(key, tool, rebaseUrl(url, ctx.targetOrigin));
          prev.push({ id: tool.id, prevUrl: res.prevUrl });
          savePrevValue(ctx.repoRoot, "F8", { tools: prev });
          if (!res.ok) throw new Error(`tool PATCH ${tool.id} failed: ${res.detail}`);
        }
      },
      verify: async (ctx) => {
        const key = loadElApiKey(readEnv(ctx.repoRoot));
        const tools = key ? await listElTools(key) : [];
        const stale = toolsOnHost(tools, host(ctx.previousOrigin));
        const ok = Boolean(key) && stale.length === 0;
        return { ok, checks: [{ label: { en: "no webhook tool targets the old origin", he: "אין כלי webhook שמצביע לכתובת הישנה" }, ok, detail: stale.map((t) => t.tool_config.name ?? t.id).join(", ") || undefined }] };
      },
      rollback: async (ctx) => {
        const key = loadElApiKey(readEnv(ctx.repoRoot));
        const prev = loadPrevValue<{ tools: { id: string; prevUrl: string | null }[] }>(ctx.repoRoot, "F8");
        if (!key || !prev) return;
        for (const t of prev.tools) {
          if (!t.prevUrl) continue;
          const tool = await getElTool(key, t.id);
          if (tool) await patchToolUrl(key, tool, t.prevUrl);
        }
      },
    }),
    step({
      id: "F9",
      stage: "F",
      gate: "elevenlabs-live-update",
      label: { en: "ElevenLabs knowledge-base documents + agent push", he: "מסמכי ידע ב-ElevenLabs ופריסת הסוכנים" },
      plan: (ctx) => [
        `for each agent in agents.json: knowledge_base items that resolve to url documents on ${host(ctx.previousOrigin)} (url docs and crawl folders) are recreated on ${ctx.targetOrigin} — POST /knowledge-base/folder + /knowledge-base/url; old documents are never deleted`,
        "then `elevenlabs agents pull --agent <id> --update` → knowledge_base ids swapped in the pulled config → `elevenlabs agents push --agent <id>` (CLAUDE.md: never PATCH the agent directly)",
        "agent_configs/*.json backed up first (engine backups → rollback restores + pushes the previous config)",
      ],
      backup: async (ctx) => {
        assertExecuteLatch("F9 backup");
        return readAgentsJson(ctx.repoRoot)
          .filter((a) => existsSync(join(ctx.repoRoot, a.config)))
          .map((a) => backupFile(join(ctx.repoRoot, a.config)));
      },
      check: async (ctx) => {
        const key = loadElApiKey(readEnv(ctx.repoRoot));
        if (!key) return "blocked";
        const agents = readAgentsJson(ctx.repoRoot);
        if (agents.length === 0) return "done";
        for (const a of agents) {
          const plan = await elAgentKbPlan(key, a.id, host(ctx.previousOrigin));
          if (!plan) return "blocked";
          if (plan.stale.length > 0) return "pending";
        }
        return "done";
      },
      apply: async (ctx) => {
        assertExecuteLatch("F9 ElevenLabs knowledge base");
        const key = loadElApiKey(readEnv(ctx.repoRoot));
        if (!key) throw new Error("ELEVENLABS_API_KEY missing");
        const oldHost = host(ctx.previousOrigin);
        const newHost = host(ctx.targetOrigin);
        const stamp = new Date().toISOString().slice(0, 10);
        const created: { id: string; name: string; forAgent: string }[] = [];
        // Documents are created once and reused across agents that attach the
        // same old item (keyed by old KB id).
        const replacementCache = new Map<string, KbItem>();
        for (const agent of readAgentsJson(ctx.repoRoot)) {
          const plan = await elAgentKbPlan(key, agent.id, oldHost);
          if (!plan) throw new Error(`could not read live config of agent ${agent.id}`);
          if (plan.stale.length === 0) continue;
          const replacements = new Map<string, KbItem>();
          for (const { item, urls } of plan.stale) {
            let next = replacementCache.get(item.id);
            if (!next) {
              if (item.type === "url") {
                const doc = await createKbUrlDocument(key, { url: rebaseUrl(urls[0].url, ctx.targetOrigin), name: urls[0].name });
                next = { type: "url", name: doc.name, id: doc.id, usage_mode: item.usage_mode };
                created.push({ id: doc.id, name: doc.name, forAgent: agent.id });
              } else {
                const folder = await createKbFolder(key, `${newHost} pages (relocation ${stamp})`);
                created.push({ id: folder.id, name: folder.name, forAgent: agent.id });
                for (const u of urls) {
                  const doc = await createKbUrlDocument(key, { url: rebaseUrl(u.url, ctx.targetOrigin), name: u.name, parentFolderId: folder.id });
                  created.push({ id: doc.id, name: doc.name, forAgent: agent.id });
                }
                next = { type: "folder", name: folder.name, id: folder.id, usage_mode: item.usage_mode };
              }
              replacementCache.set(item.id, next);
            }
            replacements.set(item.id, next);
          }
          savePrevValue(ctx.repoRoot, "F9", { created });
          const pulled = await pullAgentConfig(ctx.repoRoot, agent.id);
          if (!pulled.ok) throw new Error(`elevenlabs agents pull failed for ${agent.id} (exit ${pulled.code ?? "?"})`);
          const { config, changed } = rewriteAgentKb(readAgentConfig(ctx.repoRoot, agent), replacements);
          if (!changed) throw new Error(`pulled config of ${agent.id} does not list the stale knowledge-base items — refusing to push blind`);
          writeAgentConfig(ctx.repoRoot, agent, config);
          const pushed = await pushAgentConfig(ctx.repoRoot, agent.id, `relocation → ${ctx.targetOrigin}: knowledge base re-attached`);
          if (!pushed.ok) throw new Error(`elevenlabs agents push failed for ${agent.id} (exit ${pushed.code ?? "?"})`);
        }
      },
      verify: async (ctx) => {
        const key = loadElApiKey(readEnv(ctx.repoRoot));
        const checks: { label: Label; ok: boolean; detail?: string }[] = [];
        if (!key) return { ok: false, checks: [{ label: { en: "ELEVENLABS_API_KEY", he: "מפתח ElevenLabs" }, ok: false }] };
        for (const a of readAgentsJson(ctx.repoRoot)) {
          const plan = await elAgentKbPlan(key, a.id, host(ctx.previousOrigin));
          const ok = Boolean(plan && plan.stale.length === 0);
          checks.push({
            label: { en: `agent ${a.config.split("/").pop()} has no knowledge-base document on the old origin`, he: `לסוכן ${a.config.split("/").pop()} אין מסמך ידע על הכתובת הישנה` },
            ok,
            detail: plan ? plan.stale.map((s) => s.item.name).join(", ") || undefined : "live config unreadable",
          });
        }
        return { ok: checks.every((c) => c.ok), checks };
      },
      rollback: async (ctx, saved) => {
        for (const { path, backupPath } of saved) {
          await runCommand({ cmd: "cp", args: [backupPath, path] });
        }
        const restored = new Set(saved.map((s) => s.path));
        for (const a of readAgentsJson(ctx.repoRoot)) {
          if (restored.has(join(ctx.repoRoot, a.config))) {
            await pushAgentConfig(ctx.repoRoot, a.id, `relocation rollback → ${ctx.previousOrigin}`);
          }
        }
      },
    }),
    step({
      id: "G1",
      stage: "G",
      label: { en: "app_settings URL rows", he: "עדכון שורות URL ב-app_settings" },
      plan: (ctx) => [
        `UPDATE app_settings SET privacy_url = '${ctx.targetOrigin}/privacy', terms_url = '${ctx.targetOrigin}/terms'`,
      ],
      check: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        const resolved = supabaseMgmtToken({ env });
        if (!resolved || !env.NEXT_PUBLIC_SUPABASE_URL) return "blocked";
        return "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("G1 app_settings URL rows");
        const env = readEnv(ctx.repoRoot);
        const resolved = supabaseMgmtToken({ env });
        if (!resolved) throw new Error("Supabase Management token unavailable");
        const projectRef = projectRefFromSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
        const before = await runSupabaseSql({
          token: resolved.token,
          projectRef,
          query: "SELECT privacy_url, terms_url FROM app_settings WHERE id = true",
          readOnly: true,
        });
        if (before.ok) savePrevValue(ctx.repoRoot, "G1", before.value);
        const update = await runSupabaseSql({
          token: resolved.token,
          projectRef,
          query: `UPDATE app_settings SET privacy_url = '${ctx.targetOrigin}/privacy', terms_url = '${ctx.targetOrigin}/terms' WHERE id = true`,
          readOnly: false,
        });
        if (!update.ok) throw new Error(`app_settings UPDATE failed: ${update.detail}`);
      },
      verify: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        const resolved = supabaseMgmtToken({ env });
        if (!resolved) return { ok: false, checks: [] };
        const projectRef = projectRefFromSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
        const after = await runSupabaseSql({
          token: resolved.token,
          projectRef,
          query: "SELECT privacy_url FROM app_settings WHERE id = true",
          readOnly: true,
        });
        const rows = after.value as { privacy_url?: string }[] | undefined;
        const ok = after.ok && rows?.[0]?.privacy_url === `${ctx.targetOrigin}/privacy`;
        return { ok, checks: [{ label: { en: "privacy_url updated", he: "privacy_url עודכן" }, ok }] };
      },
      rollback: async (ctx) => {
        const env = readEnv(ctx.repoRoot);
        const resolved = supabaseMgmtToken({ env });
        const prev = loadPrevValue<{ privacy_url?: string; terms_url?: string }[]>(ctx.repoRoot, "G1");
        const row = prev?.[0];
        if (!resolved || !row) return;
        const projectRef = projectRefFromSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
        await runSupabaseSql({
          token: resolved.token,
          projectRef,
          query: `UPDATE app_settings SET privacy_url = '${row.privacy_url}', terms_url = '${row.terms_url}' WHERE id = true`,
          readOnly: false,
        });
      },
    }),
    step({
      id: "G2",
      stage: "G",
      label: { en: "Switch message_templates to the approved successors", he: "מעבר שורות message_templates לתבניות-ההמשך המאושרות" },
      plan: () => [
        "UPDATE message_templates: name + components.variants / media_variants / media_variant → the _vN+1 successor, ONLY where Meta already APPROVED it (unapproved names stay in place and keep working through the Stage E 301)",
        "previous rows saved to .relocate/G2-prev.json for rollback; once Meta approves the rest, re-run `npm run relocate -- repair G2 pending` then `--resume`",
      ],
      check: async (ctx) => {
        const handle = mgmtHandle(ctx.repoRoot);
        const creds = await metaCreds(ctx.repoRoot);
        if (!handle || !creds) return "blocked";
        const rows = await readTemplateRows(handle);
        if (!rows) return "blocked";
        const plans = await metaPlans(ctx, creds);
        return referencedOldNames(rows, plans).length === 0 ? "done" : "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("G2 message_templates switch");
        const handle = mgmtHandle(ctx.repoRoot);
        const creds = await metaCreds(ctx.repoRoot);
        if (!handle || !creds) throw new Error("Supabase Management token or WhatsApp credentials unavailable");
        const rows = await readTemplateRows(handle);
        if (!rows) throw new Error("could not read message_templates");
        savePrevValue(ctx.repoRoot, "G2", rows);
        const updates = planTemplateRowSwitch(rows, await metaPlans(ctx, creds));
        for (const u of updates) {
          const res = await runSupabaseSql({ ...handle, query: templateSwitchSql(u), readOnly: false });
          if (!res.ok) throw new Error(`message_templates UPDATE (${u.message_key}) failed: ${res.detail}`);
        }
      },
      verify: async (ctx) => {
        const handle = mgmtHandle(ctx.repoRoot);
        const creds = await metaCreds(ctx.repoRoot);
        const rows = handle ? await readTemplateRows(handle) : null;
        const plans = creds ? await metaPlans(ctx, creds) : [];
        if (!rows) return { ok: false, checks: [{ label: { en: "message_templates readable", he: "message_templates נקראת" }, ok: false }] };
        const pendingSwitch = planTemplateRowSwitch(rows, plans);
        const remaining = referencedOldNames(rows, plans);
        const ok = pendingSwitch.length === 0; // every APPROVED successor is in use
        return {
          ok,
          checks: [
            { label: { en: "every approved successor is referenced by the DB", he: "כל תבנית-המשך מאושרת בשימוש ב-DB" }, ok },
            {
              label: { en: `${remaining.length} old name(s) still referenced (awaiting Meta approval)`, he: `${remaining.length} שמות ישנים עדיין בשימוש (ממתינים לאישור Meta)` },
              ok: remaining.length === 0,
              detail: remaining.join(", ") || undefined,
            },
          ],
        };
      },
      rollback: async (ctx) => {
        const handle = mgmtHandle(ctx.repoRoot);
        const prev = loadPrevValue<TemplateRow[]>(ctx.repoRoot, "G2");
        if (!handle || !prev) return;
        for (const row of prev) {
          await runSupabaseSql({
            ...handle,
            query: templateSwitchSql({ message_key: row.message_key, name: row.name, components: row.components, switched: [] }),
            readOnly: false,
          });
        }
      },
    }),
    step({
      id: "H1",
      stage: "H",
      label: { en: "Verification suite", he: "חבילת אימות" },
      plan: (ctx) => [
        "public GET /, canonical, /api/health; static pages /privacy /terms /faq /contact /cookies",
        "public token surfaces with ONE live token each (read via the service key, never logged): /r/<guest>, /g/<event>, /ty/<event> must render real content, not the generic refusal",
        `old-origin 301 → ${ctx.targetOrigin}; robots/sitemap/llms.txt emit the new origin`,
      ],
      // Verify-only step — apply() has nothing to mutate.
      apply: async () => undefined,
      verify: async (ctx) => {
        const results = await runVerificationSuite({
          targetOrigin: ctx.targetOrigin,
          previousOrigin: ctx.previousOrigin,
          env: readEnv(ctx.repoRoot),
        });
        const ok = results.every((r) => r.ok);
        return {
          ok,
          checks: results.map((r) => ({ label: { en: r.label, he: r.label }, ok: r.ok, detail: r.detail })),
        };
      },
    }),
  ];
}
