/**
 * Relocation wizard — step definitions for stages B–H.
 *
 * THIS BUILD IS PLAN-ONLY: every `apply()` below throws NotImplementedError.
 * That is deliberate (design doc §5 build order): the engine, preflight, and
 * dry-run plan ship first; each mutating stage gets enabled in its own later,
 * reviewed change. `plan()` lines are real — they are the reviewed dry-run
 * change-set — so the operator sees the full intended sequence today.
 */
import { NotImplementedError, type StepDefinition, type WizardContext } from "./engine";
import type { Label } from "./state";

function step(def: {
  id: string;
  stage: StepDefinition["stage"];
  label: Label;
  gate?: StepDefinition["gate"];
  plan: (ctx: WizardContext) => string[];
}): StepDefinition {
  return {
    id: def.id,
    stage: def.stage,
    label: def.label,
    gate: def.gate,
    check: async () => "pending",
    plan: async (ctx) => def.plan(ctx),
    apply: async () => {
      throw new NotImplementedError("stage not enabled in this build");
    },
    verify: async () => ({ ok: false, checks: [] }),
  };
}

const host = (origin: string) => new URL(origin).hostname;

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
    }),
    step({
      id: "C1",
      stage: "C",
      gate: "go-live",
      label: { en: "Register domain for cert management", he: "רישום הדומיין לניהול תעודות" },
      plan: (ctx) => [
        `plesk bin domain --create ${host(ctx.targetOrigin)} (no hosting) — only if not already in Plesk`,
      ],
    }),
    step({
      id: "C2",
      stage: "C",
      label: { en: "Issue TLS certificate", he: "הנפקת תעודת TLS" },
      plan: (ctx) => [
        `issue Let's Encrypt cert for ${host(ctx.targetOrigin)} (http-01; retry with backoff; hard-stop before 5 failed validations/hour)`,
        "skip if an existing cert already covers the target (e.g. wildcard)",
      ],
    }),
    step({
      id: "C3",
      stage: "C",
      label: { en: "Write nginx vhost", he: "כתיבת vhost ב-nginx" },
      plan: (ctx) => [
        `write /etc/nginx/conf.d/${host(ctx.targetOrigin)}-app.conf from the repo template`,
        "template includes: proxy → 127.0.0.1:3002, X-Forwarded-Host/Proto, enlarged proxy buffers (502 fix), ACME location",
      ],
    }),
    step({
      id: "C4",
      stage: "C",
      label: { en: "Test and reload nginx", he: "בדיקת nginx וטעינה מחדש" },
      plan: () => ["nginx -t (whitelisting the benign duplicate-server_name warning) → systemctl reload nginx"],
    }),
    step({
      id: "D1",
      stage: "D",
      label: { en: "Rewrite origin env keys", he: "שכתוב מפתחות ה-origin ב-env" },
      plan: (ctx) => [
        `.env.local: APP_ORIGIN → ${ctx.targetOrigin}; PGBOSS_DASHBOARD_URL host → ${host(ctx.targetOrigin)} (backup first)`,
        `ecosystem.config.cjs: inline kalfa-fleet APP_ORIGIN → ${ctx.targetOrigin} (deliberate duplicate, plan §3 #3)`,
      ],
    }),
    step({
      id: "D2",
      stage: "D",
      label: { en: "Rebuild and deploy", he: "בנייה מחדש ופריסה" },
      plan: () => [
        "npm run deploy — rebuild REQUIRED: llms.txt/robots/sitemap/static-page metadata bake the origin at build",
        "the rebuild mints a new deploymentId → stale tabs hard-reload (version-skew cutover)",
      ],
    }),
    step({
      id: "D3",
      stage: "D",
      label: { en: "Clean-restart kalfa-fleet", he: "אתחול נקי ל-kalfa-fleet" },
      plan: () => [
        "pm2 delete kalfa-fleet → scrubbed start (env -i … pm2 start ecosystem.config.cjs --only kalfa-fleet) → pm2 save",
        "NEVER pm2 restart --update-env (2026-07-06 env-pollution incident, plan §5 Stage D.1)",
      ],
    }),
    step({
      id: "E1",
      stage: "E",
      label: { en: "Old-origin 301 + API proxy exception", he: "הפניית 301 מהדומיין הישן" },
      plan: (ctx) => [
        `rewrite the old origin's vhost: location / → 301 ${ctx.targetOrigin}$request_uri`,
        "EXCEPT /api/* which keeps proxying to the app (Voximplant callbacks + installed Android builds POST there; POSTs don't survive 301)",
      ],
    }),
    step({
      id: "F1",
      stage: "F",
      label: { en: "Supabase auth Site URL + redirects", he: "עדכון Supabase auth" },
      plan: (ctx) => [
        `Management API PATCH /v1/projects/{ref}/config/auth: site_url + redirect allow-list → ${ctx.targetOrigin}`,
      ],
    }),
    step({
      id: "F2",
      stage: "F",
      label: { en: "Redeploy Supabase auth email templates", he: "פריסת תבניות מייל auth" },
      plan: () => [
        "re-run scripts/deploy-recovery-email-template.mjs --apply and scripts/deploy-email-change-template.mjs --apply",
      ],
    }),
    step({
      id: "F3",
      stage: "F",
      label: { en: "Meta WhatsApp webhook", he: "עדכון webhook של Meta" },
      plan: (ctx) => [
        `POST /{app-id}/subscriptions with callback ${ctx.targetOrigin}/api/webhooks/whatsapp; verify handshake`,
      ],
    }),
    step({
      id: "F4",
      stage: "F",
      label: { en: "Microsoft Graph subscriptions", he: "מנויי Microsoft Graph" },
      plan: (ctx) => [
        `delete + recreate Graph webhook subscriptions (notificationUrl embeds ${ctx.targetOrigin})`,
      ],
    }),
    step({
      id: "F5",
      stage: "F",
      label: { en: "Voximplant account callback", he: "callback חשבון Voximplant" },
      plan: (ctx) => [
        `re-arm account callback to ${ctx.targetOrigin}/api/voximplant/… via the existing admin flow (API call, not raw UPDATE)`,
        "then close the /api/* proxy exception for voximplant paths once verified",
      ],
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
    }),
    step({
      id: "F7",
      stage: "F",
      label: { en: "GA4 data stream URI", he: "עדכון GA4" },
      plan: (ctx) => [`GA Admin API dataStreams.patch default URI → ${ctx.targetOrigin}`],
    }),
    step({
      id: "G1",
      stage: "G",
      label: { en: "app_settings URL rows", he: "עדכון שורות URL ב-app_settings" },
      plan: (ctx) => [
        `UPDATE app_settings SET privacy_url = '${ctx.targetOrigin}/privacy', terms_url = '${ctx.targetOrigin}/terms'`,
      ],
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
    }),
  ];
}
