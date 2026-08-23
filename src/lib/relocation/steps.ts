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

/** The full intended sequence (plan doc §5). Stage A runs OUTSIDE the engine
 * as the read-only preflight; stages B–H are engine steps. */
export function buildStepDefinitions(): StepDefinition[] {
  return [
    step({
      id: "B1",
      stage: "B",
      gate: "meta-template-submit",
      label: { en: "Submit Meta _v2 templates", he: "הגשת תבניות _v2 ל-Meta" },
      plan: (ctx) => [
        `submit _v2 versions of URL-button templates with base ${ctx.targetOrigin} (never delete existing)`,
        "poll approval status; stage D SHOULD wait for approval (override = meta-approval-override gate)",
      ],
      // Template submission/approval is a multi-day, Meta-paced workflow with
      // no safe single API call to wire here yet (owner-gated by the gate
      // above regardless) — stays manual.
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
      label: { en: "Voximplant account callback", he: "callback חשבון Voximplant" },
      plan: (ctx) => [
        `re-arm account callback to ${ctx.targetOrigin}/api/voximplant/… via the existing admin flow (API call, not raw UPDATE)`,
        "then close the /api/* proxy exception for voximplant paths once verified",
      ],
      apply: async () => {
        throw new NotImplementedError(
          "F5 stays manual: use the existing admin re-arm flow in src/lib/data/admin/voximplant-channel.ts (run through the running app's /admin UI, not this CLI)",
        );
      },
    }),
    step({
      id: "F6",
      stage: "F",
      gate: "voximplant-scenario-redeploy",
      label: { en: "Voximplant scenario redeploy", he: "פריסת תסריטי Voximplant" },
      plan: () => [
        "re-template ConsoleInbound origin constant + redeploy via vox:upload (never touch DTMF OutCall rule 1494311)",
        "HTTP-started scenarios receive the origin via custom_data after Phase 0 #4 — no redeploy needed for them",
      ],
      apply: async () => {
        throw new NotImplementedError(
          "F6 stays manual: requires vox:upload after Phase 0 #4/#4b lands — see plan Stage F6",
        );
      },
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
      id: "H1",
      stage: "H",
      label: { en: "Verification suite", he: "חבילת אימות" },
      plan: (ctx) => [
        "local probe with Host header; public GET; authenticated /admin (proxy-buffer path)",
        `old-origin 301 → ${ctx.targetOrigin}; robots/sitemap/llms.txt/OG emit the new origin`,
        "Supabase auth read-back; webhook echoes; pm2 effective-env check (fleet)",
      ],
      // Verify-only step — apply() has nothing to mutate.
      apply: async () => undefined,
      verify: async (ctx) => {
        const results = await runVerificationSuite({
          targetOrigin: ctx.targetOrigin,
          previousOrigin: ctx.previousOrigin,
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
