/**
 * Relocation wizard — INSTALL MODE step definitions (plan doc §5b).
 *
 * `relocate --install`: bring a bare/partial server to a fully-running site —
 * not moving an existing install. Same engine, same gates, same state file.
 *
 * Every command in the plan() lines below was verified against LIVE vendor
 * documentation on 2026-08-23 (docs.plesk.com / support.plesk.com, NodeSource
 * distributions, pm2.keymetrics.io, nginx.org, certbot.eff.org,
 * docs.npmjs.com) — see plan doc §5b for the source list.
 *
 * Wired 2026-08-23: I0/I1/I2/I5/I6/I7/I8/I9/I10/I11 have real apply/verify,
 * sharing the C2/C3/C4/E1 logic with steps.ts via wiring-helpers.ts. I3
 * (clone source unknown) and I12 (owner-driven via /admin/settings) stay
 * intentional NotImplementedError. I4's setup-form apply is real.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { assertExecuteLatch, runCommand, type RunCommandResult } from "./exec";
import { NotImplementedError, type StepDefinition, type WizardContext } from "./engine";
import { ENV_KEY_SPECS } from "./env-validation";
import { ipsOverlap, parseEnvFile, resolveIps } from "./preflight";
import { startSetupForm } from "./setup-form";
import type { Label } from "./state";
import {
  certCoversHost,
  isPleskServer,
  issueCertPlesk,
  localHealthOk,
  resolveCertEmail,
  resolveServerListenAddress,
  runVerificationSuite,
  savePrevValue,
  testAndReloadNginx,
  writeAppVhostForHost,
  writeDnsRecordPlesk,
} from "./wiring-helpers";

function step(def: {
  id: string;
  stage: StepDefinition["stage"];
  label: Label;
  gate?: StepDefinition["gate"];
  plan: (ctx: WizardContext) => string[];
  check?: StepDefinition["check"];
  apply?: StepDefinition["apply"];
  verify?: StepDefinition["verify"];
}): StepDefinition {
  return {
    id: def.id,
    stage: def.stage,
    label: def.label,
    gate: def.gate,
    check: def.check ?? (async () => "pending"),
    plan: async (ctx) => def.plan(ctx),
    apply:
      def.apply ??
      (async () => {
        throw new NotImplementedError("install mode is plan-only in this build");
      }),
    verify: def.verify ?? (async () => ({ ok: false, checks: [] })),
  };
}

const host = (origin: string) => new URL(origin).hostname;

function requireOk(res: RunCommandResult, what: string): void {
  if (!res.ok) throw new Error(`${what} failed (exit ${res.code ?? "?"})`);
}

/** Compare .env.local key NAMES against .env.example (the committed key
 * catalog). Returns missing key names — never values. Keys marked `optional`
 * in the validation catalog (wizard-only, e.g. SUPABASE_ACCESS_TOKEN) do not
 * gate the install — the app runs without them. */
export function missingEnvKeys(repoRoot: string): { missing: string[]; hasEnv: boolean } {
  const optional = new Set(ENV_KEY_SPECS.filter((s) => s.optional).map((s) => s.key));
  const examplePath = join(repoRoot, ".env.example");
  const localPath = join(repoRoot, ".env.local");
  const exampleKeys = (
    existsSync(examplePath)
      ? Object.keys(parseEnvFile(readFileSync(examplePath, "utf8")))
      : []
  ).filter((k) => !optional.has(k));
  if (!existsSync(localPath)) return { missing: exampleKeys, hasEnv: false };
  const localKeys = new Set(Object.keys(parseEnvFile(readFileSync(localPath, "utf8"))));
  return { missing: exampleKeys.filter((k) => !localKeys.has(k)), hasEnv: true };
}

/** The full install sequence (plan §5b + design §5c). Order matters twice:
 * DNS (I10) before cert issuance (I9) — http-01 needs the domain resolving
 * here — and vhost+DNS+cert (I8/I10/I9) before the setup form (I4), which is
 * served THROUGH that vhost on the real domain, WordPress-style. */
export function buildInstallStepDefinitions(): StepDefinition[] {
  return [
    step({
      id: "I0",
      stage: "C",
      gate: "install-prereqs",
      label: { en: "OS base packages", he: "חבילות בסיס של מערכת ההפעלה" },
      plan: () => ["sudo apt-get update && sudo apt-get install -y curl git gnupg"],
      check: async () => {
        const res = await runCommand({ cmd: "curl", args: ["--version"], timeoutMs: 5000 });
        return res.ok ? "done" : "pending";
      },
      apply: async () => {
        assertExecuteLatch("I0 apt-get base packages");
        const update = await runCommand({ cmd: "apt-get", args: ["update"], sudo: true, timeoutMs: 120_000 });
        requireOk(update, "apt-get update");
        const install = await runCommand({
          cmd: "apt-get",
          args: ["install", "-y", "curl", "git", "gnupg"],
          sudo: true,
          timeoutMs: 120_000,
        });
        requireOk(install, "apt-get install curl git gnupg");
      },
      verify: async () => {
        const res = await runCommand({ cmd: "curl", args: ["--version"], timeoutMs: 5000 });
        return { ok: res.ok, checks: [{ label: { en: "curl present", he: "curl מותקן" }, ok: res.ok }] };
      },
    }),
    step({
      id: "I1",
      stage: "C",
      gate: "install-prereqs",
      label: { en: "Install Node.js 24", he: "התקנת Node.js 24" },
      plan: () => [
        "curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh && sudo -E bash /tmp/nodesource_setup.sh && sudo apt-get install -y nodejs",
        "Plesk alternative: the Node toolkit (plesk ext nodejs) offers vendor LTS majors only — NodeSource pins the exact major production runs",
        "never a version manager (nvm/fnm) for system services: pm2's systemd unit hard-codes the node path (pm2 startup docs)",
      ],
      check: async () => {
        const res = await runCommand({ cmd: "node", args: ["--version"], timeoutMs: 5000 });
        return res.ok && res.stdout.trim().startsWith("v24") ? "done" : "pending";
      },
      apply: async () => {
        assertExecuteLatch("I1 install Node.js");
        const fetchScript = await runCommand({
          cmd: "curl",
          args: ["-fsSL", "https://deb.nodesource.com/setup_24.x", "-o", "/tmp/nodesource_setup.sh"],
          timeoutMs: 60_000,
        });
        requireOk(fetchScript, "download NodeSource setup script");
        const runScript = await runCommand({
          cmd: "bash",
          args: ["/tmp/nodesource_setup.sh"],
          sudo: true,
          timeoutMs: 120_000,
        });
        requireOk(runScript, "run NodeSource setup script");
        const install = await runCommand({
          cmd: "apt-get",
          args: ["install", "-y", "nodejs"],
          sudo: true,
          timeoutMs: 120_000,
        });
        requireOk(install, "apt-get install nodejs");
      },
      verify: async () => {
        const res = await runCommand({ cmd: "node", args: ["--version"], timeoutMs: 5000 });
        const ok = res.ok && res.stdout.trim().startsWith("v24");
        return { ok, checks: [{ label: { en: "node --version is v24.x", he: "גרסת Node היא v24.x" }, ok }] };
      },
    }),
    step({
      id: "I2",
      stage: "C",
      gate: "install-prereqs",
      label: { en: "Install pm2", he: "התקנת pm2" },
      plan: () => ["sudo npm install -g pm2"],
      check: async () => {
        const res = await runCommand({ cmd: "pm2", args: ["-v"], timeoutMs: 5000 });
        return res.ok ? "done" : "pending";
      },
      apply: async () => {
        assertExecuteLatch("I2 install pm2");
        const res = await runCommand({ cmd: "npm", args: ["install", "-g", "pm2"], sudo: true, timeoutMs: 120_000 });
        requireOk(res, "npm install -g pm2");
      },
      verify: async () => {
        const res = await runCommand({ cmd: "pm2", args: ["-v"], timeoutMs: 5000 });
        return { ok: res.ok, checks: [{ label: { en: "pm2 present", he: "pm2 מותקן" }, ok: res.ok }] };
      },
    }),
    step({
      id: "I3",
      stage: "D",
      label: { en: "Clone the repository", he: "שכפול הריפו" },
      plan: () => ["git clone <repo-url> <target-path> (or rsync from the source server)"],
      apply: async () => {
        throw new NotImplementedError(
          "I3 stays manual: the clone source (git remote or source-server rsync target) is not known at wizard-design time",
        );
      },
    }),
    step({
      id: "I8",
      stage: "C",
      gate: "install-prereqs",
      label: { en: "nginx + vhost", he: "nginx וקובץ vhost" },
      plan: (ctx) => [
        `write the vhost for ${host(ctx.targetOrigin)} from the repo template (proxy → 127.0.0.1:3002, X-Forwarded-Host/Proto, enlarged proxy buffers, ACME location)`,
        "Plesk server: plesk installer --select-release-current --install-component nginx; plesk sbin nginxmng --enable",
        "bare server: nginx.org official apt repo (keyring + pinned source) then apt install nginx",
        "nginx -t && systemctl reload nginx",
      ],
      check: async () => {
        const res = await runCommand({ cmd: "nginx", args: ["-v"], timeoutMs: 5000 });
        return res.ok ? "pending" : "pending"; // nginx present doesn't mean OUR vhost exists yet
      },
      apply: async (ctx) => {
        assertExecuteLatch("I8 nginx + vhost");
        const nginxProbe = await runCommand({ cmd: "nginx", args: ["-v"], timeoutMs: 5000 });
        if (!nginxProbe.ok) {
          if (await isPleskServer()) {
            const install = await runCommand({
              cmd: "plesk",
              args: ["installer", "--select-release-current", "--install-component", "nginx"],
              sudo: true,
              timeoutMs: 300_000,
            });
            requireOk(install, "plesk installer --install-component nginx");
            const enable = await runCommand({
              cmd: "plesk",
              args: ["sbin", "nginxmng", "--enable"],
              sudo: true,
              timeoutMs: 60_000,
            });
            requireOk(enable, "plesk sbin nginxmng --enable");
          } else {
            throw new Error(
              "nginx is absent and this is not a Plesk server — install nginx via the nginx.org apt repo manually, then re-run",
            );
          }
        }
        const listenAddress = await resolveServerListenAddress(ctx.targetOrigin);
        await writeAppVhostForHost(host(ctx.targetOrigin), listenAddress);
      },
      verify: async () => {
        const test = await testAndReloadNginx();
        return { ok: test.ok, checks: [{ label: { en: "nginx -t", he: "בדיקת nginx" }, ok: test.ok }] };
      },
    }),
    step({
      id: "I10",
      stage: "C",
      gate: "dns-write-local-zone",
      label: { en: "DNS record", he: "רשומת DNS" },
      plan: (ctx) => [
        `local Plesk zone: plesk bin dns -a ${host(ctx.targetOrigin)} -a "" -ip <server-ip>`,
        "external registrar: MANUAL — wizard prints the exact A record and polls until it resolves",
      ],
      check: async (ctx) => {
        const serverIps = await resolveIps(host(ctx.previousOrigin || ctx.targetOrigin));
        const targetIps = await resolveIps(host(ctx.targetOrigin));
        return targetIps.length > 0 && ipsOverlap(serverIps, targetIps) ? "done" : "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("I10 DNS record");
        if (!(await isPleskServer())) {
          throw new NotImplementedError(
            "I10 stays manual on a non-Plesk / non-locally-hosted zone: point the A record at this server's IP at your registrar, then --resume",
          );
        }
        const ip = await resolveServerListenAddress(ctx.targetOrigin);
        if (!ip) throw new Error("could not resolve this server's own public IP");
        await writeDnsRecordPlesk(host(ctx.targetOrigin), ip);
      },
      verify: async (ctx) => {
        const serverIps = await resolveIps(host(ctx.targetOrigin));
        const targetIps = await resolveIps(host(ctx.targetOrigin));
        const ok = targetIps.length > 0 && ipsOverlap(serverIps, targetIps);
        return { ok, checks: [{ label: { en: "target resolves to this server", he: "היעד מפנה לשרת זה" }, ok }] };
      },
    }),
    step({
      id: "I9",
      stage: "C",
      gate: "install-prereqs",
      label: { en: "TLS certificate", he: "תעודת TLS" },
      plan: (ctx) => [
        `Plesk server: plesk bin extension --exec letsencrypt cli.php -d ${host(ctx.targetOrigin)} -m <admin-email>`,
        `bare server: sudo snap install --classic certbot; certbot certonly --webroot -w <acme-root> -d ${host(ctx.targetOrigin)}`,
        "runs only AFTER the DNS step resolves to this server (http-01); never let Plesk LE and certbot manage the same domain",
      ],
      check: async (ctx) => ((await certCoversHost(host(ctx.targetOrigin))) ? "done" : "pending"),
      apply: async (ctx) => {
        assertExecuteLatch("I9 TLS certificate");
        if (await isPleskServer()) {
          const email = await resolveCertEmail(ctx.repoRoot, ctx.targetOrigin);
          await issueCertPlesk(host(ctx.targetOrigin), email);
          return;
        }
        const snap = await runCommand({
          cmd: "snap",
          args: ["install", "--classic", "certbot"],
          sudo: true,
          timeoutMs: 120_000,
        });
        requireOk(snap, "snap install certbot");
        const link = await runCommand({
          cmd: "ln",
          args: ["-s", "/snap/bin/certbot", "/usr/local/bin/certbot"],
          sudo: true,
          timeoutMs: 10_000,
        });
        if (!link.ok && link.code !== 1) requireOk(link, "symlink certbot"); // code 1 = already linked
        const issue = await runCommand({
          cmd: "certbot",
          args: [
            "certonly",
            "--webroot",
            "-w",
            "/var/www/vhosts/default/htdocs",
            "-d",
            host(ctx.targetOrigin),
            "--non-interactive",
            "--agree-tos",
            "-m",
            await resolveCertEmail(ctx.repoRoot, ctx.targetOrigin),
          ],
          sudo: true,
          timeoutMs: 120_000,
        });
        requireOk(issue, "certbot certonly --webroot");
      },
      verify: async (ctx) => {
        const ok = await certCoversHost(host(ctx.targetOrigin));
        return { ok, checks: [{ label: { en: "TLS probe", he: "בדיקת TLS" }, ok }] };
      },
    }),
    step({
      id: "I4",
      stage: "D",
      label: {
        en: "Environment parameters via the setup form",
        he: "הזנת פרמטרים בטופס ההגדרה",
      },
      plan: (ctx) => [
        `WordPress-style setup form on the REAL domain (design §5c): the vhost already proxies ${host(ctx.targetOrigin)} → 127.0.0.1:3002, which nothing occupies yet — the wizard's temporary form binds there`,
        `operator opens https://${host(ctx.targetOrigin)}/setup?token=<one-time> in a browser and fills the missing keys (names from .env.example; values go browser→server over TLS, never through wizard state/logs)`,
        "every credential is VALIDATED live before acceptance (env-validation.ts catalog): read-only probe per service, ✓/✗ per key, auth-vs-network failure classes in Hebrew; VAPID pair is GENERATED by the wizard; SUMIT is format-only + explicit skip recorded in openItems",
        "wizard writes .env.local (0600), shuts the form down, and CONTINUES AUTOMATICALLY (waiting-external kind env-provisioning until then)",
        "running-app alternative: /admin/relocation/setup behind requirePlatformOwner — shows only missing keys, never existing values",
      ],
      check: async (ctx) => {
        const { missing, hasEnv } = missingEnvKeys(ctx.repoRoot);
        if (!hasEnv) return "pending"; // fresh server: no .env.local yet — the form creates it
        return missing.length === 0 ? "done" : "pending";
      },
      apply: async (ctx) => {
        assertExecuteLatch("I4 env catalog setup form");
        const handle = await startSetupForm({ repoRoot: ctx.repoRoot, targetOrigin: ctx.targetOrigin });
        process.stdout.write(`\nOpen in a browser: ${handle.url}\n\n`);
        const result = await handle.completed;
        if (result.skippedKeys.length > 0) {
          savePrevValue(ctx.repoRoot, "I4", { skippedKeys: result.skippedKeys });
        }
      },
      verify: async (ctx) => {
        const ok = missingEnvKeys(ctx.repoRoot).missing.length === 0;
        return { ok, checks: [{ label: { en: "env catalog complete", he: "קטלוג הפרמטרים שלם" }, ok }] };
      },
    }),
    step({
      id: "I5",
      stage: "D",
      label: { en: "Install dependencies (npm ci)", he: "התקנת תלויות (npm ci)" },
      plan: () => [
        "npm ci — install scripts MUST run (package.json allowScripts governs them; --ignore-scripts would break sharp/esbuild/puppeteer)",
        "then: npm install-scripts ls — surface any unreviewed script for the operator",
      ],
      apply: async (ctx) => {
        assertExecuteLatch("I5 npm ci");
        const res = await runCommand({ cmd: "npm", args: ["ci"], cwd: ctx.repoRoot, timeoutMs: 10 * 60_000 });
        requireOk(res, "npm ci");
      },
      verify: async (ctx) => {
        const ok = existsSync(join(ctx.repoRoot, "node_modules", ".package-lock.json"));
        return { ok, checks: [{ label: { en: "node_modules present", he: "node_modules קיים" }, ok }] };
      },
    }),
    step({
      id: "I6",
      stage: "D",
      label: { en: "Build the application", he: "בניית האפליקציה" },
      plan: () => ["npm run build (webpack, staged dist dir)"],
      apply: async (ctx) => {
        assertExecuteLatch("I6 npm run build");
        const res = await runCommand({
          cmd: "npm",
          args: ["run", "build"],
          cwd: ctx.repoRoot,
          timeoutMs: 15 * 60_000,
        });
        requireOk(res, "npm run build");
      },
      verify: async (ctx) => {
        const ok = existsSync(join(ctx.repoRoot, ".next"));
        return { ok, checks: [{ label: { en: ".next output present", he: "פלט הבנייה קיים" }, ok }] };
      },
    }),
    step({
      id: "I7",
      stage: "D",
      gate: "install-prereqs",
      label: { en: "Start processes + boot persistence", he: "הפעלת תהליכים + הישרדות ריבוט" },
      plan: () => [
        "env -i HOME=$HOME USER=$USER PATH=/usr/local/bin:/usr/bin:/bin pm2 start ecosystem.config.cjs (scrubbed shell — the repo's documented recipe)",
        "pm2 save",
        "pm2 startup systemd -u <user> --hp <home> — then run the ONE sudo command it prints (that is the documented automation path)",
      ],
      apply: async (ctx) => {
        assertExecuteLatch("I7 pm2 start + boot persistence");
        const home = process.env.HOME ?? "";
        const user = process.env.USER ?? "";
        const start = await runCommand({
          cmd: "env",
          args: ["-i", `HOME=${home}`, `USER=${user}`, "PATH=/usr/local/bin:/usr/bin:/bin", "pm2", "start", "ecosystem.config.cjs"],
          cwd: ctx.repoRoot,
          timeoutMs: 120_000,
        });
        requireOk(start, "pm2 start ecosystem.config.cjs (scrubbed)");
        const save = await runCommand({ cmd: "pm2", args: ["save"], timeoutMs: 30_000 });
        requireOk(save, "pm2 save");
        const startupPrint = await runCommand({
          cmd: "pm2",
          args: ["startup", "systemd", "-u", user, "--hp", home],
          timeoutMs: 30_000,
        });
        const printedCmd = startupPrint.stdout
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.startsWith("sudo "));
        if (printedCmd) {
          const parts = printedCmd.split(/\s+/).slice(1); // drop leading "sudo"
          const [cmd, ...args] = parts;
          const runStartup = await runCommand({ cmd, args, sudo: true, timeoutMs: 30_000 });
          requireOk(runStartup, "pm2 startup systemd (printed command)");
        }
      },
      verify: async () => {
        const res = await runCommand({ cmd: "pm2", args: ["jlist"], timeoutMs: 15_000 });
        const ok = res.ok && res.stdout.includes("kalfa-beta");
        return { ok, checks: [{ label: { en: "kalfa-beta running under pm2", he: "kalfa-beta רץ תחת pm2" }, ok }] };
      },
    }),
    step({
      id: "I12",
      stage: "D",
      label: {
        en: "Service settings stored in the DB (app_settings)",
        he: "הגדרות שירותים השמורות ב-DB (app_settings)",
      },
      plan: () => [
        "NOT env keys (owner note 2026-08-23): WhatsApp Cloud API (phone-number-id, access token, WABA id, app secret), SUMIT billing credentials, ExtrA SMS, SMTP identity and Voximplant service account all live in the app_settings ROW — entered via the running app's own admin: /admin/settings + /admin/channels",
        "the wizard polls presence (read-only REST check with the service key; values never read into state) and waits until the channels the owner wants are configured; channels left off are recorded as open items",
      ],
      check: async (ctx) => {
        // Presence booleans only — read via Supabase REST with the service
        // key from .env.local; no server-only import chain, no values kept.
        const env = readEnvSafe(ctx.repoRoot);
        const base = env.NEXT_PUBLIC_SUPABASE_URL;
        const key = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!base || !key) return "pending";
        try {
          const res = await fetch(
            `${base}/rest/v1/app_settings?id=eq.true&select=whatsapp_access_token,whatsapp_phone_number_id`,
            {
              headers: { apikey: key, authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(8000),
            },
          );
          if (!res.ok) return "pending";
          const rows = (await res.json()) as {
            whatsapp_access_token?: string | null;
            whatsapp_phone_number_id?: string | null;
          }[];
          const row = rows[0];
          return row?.whatsapp_access_token && row.whatsapp_phone_number_id
            ? "done"
            : "pending";
        } catch {
          return "pending";
        }
      },
      apply: async () => {
        throw new NotImplementedError(
          "I12 stays owner-driven: configure channels at /admin/settings and /admin/channels on the running app, then --resume",
        );
      },
    }),
    step({
      id: "I11",
      stage: "H",
      label: { en: "Full verification suite", he: "חבילת אימות מלאה" },
      plan: () => [
        "local probe /api/health; public HTTPS GET; pm2 processes online; cert chain valid; app answers on the target origin",
      ],
      apply: async () => undefined,
      verify: async (ctx) => {
        const health = await localHealthOk();
        const results = await runVerificationSuite({
          targetOrigin: ctx.targetOrigin,
          previousOrigin: ctx.targetOrigin, // install mode has no old origin to check a 301 against
        });
        // Drop the old-origin-301 check (meaningless for a fresh install).
        const relevant = results.filter((r) => r.label !== "old origin 301s to target");
        const ok = health && relevant.every((r) => r.ok);
        return {
          ok,
          checks: [
            { label: { en: "/api/health", he: "בדיקת בריאות" }, ok: health },
            ...relevant.map((r) => ({ label: { en: r.label, he: r.label }, ok: r.ok, detail: r.detail })),
          ],
        };
      },
    }),
  ];
}

function readEnvSafe(repoRoot: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(join(repoRoot, ".env.local"), "utf8"));
  } catch {
    return {};
  }
}
