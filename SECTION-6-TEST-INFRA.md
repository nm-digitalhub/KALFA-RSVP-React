# §6 — Test Infrastructure Audit

Generated: 2026-09-15T22:08:55+03:00
HEAD: c0de7c82f29dc5873cfc932a698ae1fcd8e3ef41

## 1. Package test configuration
```text
{
  "scripts": {
    "dev": "next dev",
    "build": "NEXT_DIST_DIR=.next-verify next build --webpack",
    "start": "next start",
    "gen:types": "supabase gen types --linked > src/lib/supabase/types.generated.ts",
    "types:check": "node scripts/check-supabase-types.mjs",
    "browser:check": "node scripts/check-puppeteer-browser.mjs",
    "natives:install": "node scripts/install-native-deps.mjs",
    "postinstall": "node scripts/install-native-deps.mjs",
    "deploy": "node scripts/check-supabase-types.mjs && node scripts/check-puppeteer-browser.mjs && node -e \"require('fs').writeFileSync('.deploy-id', Date.now().toString(36))\" && NEXT_DIST_DIR=.next-stage next build --webpack && rm -rf .next.old && mv .next .next.old && mv .next-stage .next && pm2 restart kalfa-beta && rm -rf .next.old && node scripts/worker-build-restart.mjs && env -u npm_config_global_ignore_file npm run fleet-agent:build && pm2 restart kalfa-fleet && pm2 restart kalfa-ops-agent && env -u npm_config_global_ignore_file npm run seo:audit && env -u npm_config_global_ignore_file npm run seo:indexnow",
    "seo:audit": "node --env-file=.env.local scripts/seo-audit.mjs",
    "seo:indexnow": "node --env-file=.env.local scripts/seo-indexnow.mjs",
    "worker:build": "esbuild worker/main.ts --bundle --platform=node --format=cjs --target=node24 --outfile=dist/worker.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native --external:deasync && node scripts/check-worker-bundle.mjs",
    "worker:start": "node dist/worker.cjs",
    "worker:logs": "pm2 logs kalfa-worker --lines 100",
    "pm2:restart": "pm2 restart kalfa-beta",
    "pm2:reload": "pm2 reload kalfa-beta",
    "pm2:status": "pm2 status kalfa-beta",
    "pm2:logs": "pm2 logs kalfa-beta --lines 100",
    "lint": "eslint",
    "worker:deps": "depcruise --config .dependency-cruiser.cjs worker/main.ts scripts src/lib/workflow src/lib/data",
    "sync:voximplant-sa": "esbuild scripts/sync-voximplant-sa.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/sync-voximplant-sa.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/sync-voximplant-sa.cjs",
    "set:voximplant-callback-secret": "esbuild scripts/set-voximplant-callback-secret.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/set-voximplant-callback-secret.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/set-voximplant-callback-secret.cjs",
    "bridge:call": "esbuild scripts/voximplant/bridge-call.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/bridge-call.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/bridge-call.cjs",
    "mtgconfirm:call": "esbuild scripts/voximplant/meeting-confirm-call.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/meeting-confirm-call.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/meeting-confirm-call.cjs",
    "salesclose:call": "esbuild scripts/voximplant/sales-close-call.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/sales-close-call.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/sales-close-call.cjs",
    "outreach:call": "esbuild scripts/voximplant/outreach-call.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/outreach-call.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/outreach-call.cjs",
    "vox:upload": "ROOT=$PWD && cd node_modules/@voximplant/voxengine-ci && VOX_CI_ROOT_PATH=$ROOT/voxfiles VOX_CI_CREDENTIALS=$ROOT/vox_ci_credentials.json node bin/voxengine-ci.js upload --application-name kalfa-rsvp.kalfarsvp.voximplant.com",
    "vox:upload:inbound": "env -u npm_config_global_ignore_file npm run vox:upload -- --rule-name incoming",
    "vox:upload:dial-internal": "env -u npm_config_global_ignore_file npm run vox:upload -- --rule-name ConsoleInternal",
    "vox:upload:dial-out": "env -u npm_config_global_ignore_file npm run vox:upload -- --rule-name ConsoleOut",
    "vox:upload:callmenow": "env -u npm_config_global_ignore_file npm run vox:upload -- --rule-name ConsoleCallMeNow",
    "vox:upload:rsvp": "env -u npm_config_global_ignore_file npm run vox:upload -- --rule-name OutCall",
    "vox:upload:rsvpagent": "env -u npm_config_global_ignore_file npm run vox:upload -- --rule-name OutCallAgent",
    "vox:upload:meetingconfirm": "env -u npm_config_global_ignore_file npm run vox:upload -- --rule-name OutCallMeetingConfirm",
    "vox:upload:purpose": "env -u npm_config_global_ignore_file npm run vox:upload -- --rule-name OutCallPurpose",
    "vox:upload:salesclose": "env -u npm_config_global_ignore_file npm run vox:upload -- --rule-name OutCallSalesClose",
    "vox:probe-binding": "esbuild scripts/voximplant/probe-scenario-binding.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/probe-scenario-binding.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/probe-scenario-binding.cjs",
    "vox:migrate-scenarios": "esbuild scripts/voximplant/migrate-scenarios-to-application.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/migrate-scenarios-to-application.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/migrate-scenarios-to-application.cjs",
    "vox:init": "ROOT=$PWD && cd node_modules/@voximplant/voxengine-ci && VOX_CI_ROOT_PATH=$ROOT/voxfiles VOX_CI_CREDENTIALS=$ROOT/vox_ci_credentials.json node bin/voxengine-ci.js init",
    "vox:reorder-rules": "esbuild scripts/voximplant/reorder-rules.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/reorder-rules.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/reorder-rules.cjs",
    "set:console-secret": "esbuild scripts/voximplant/set-console-secret.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/set-console-secret.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/set-console-secret.cjs",
    "rotate:console-secret": "esbuild scripts/voximplant/rotate-console-agent-secret.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/rotate-console-agent-secret.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/rotate-console-agent-secret.cjs",
    "copy:el-secret": "esbuild scripts/voximplant/copy-el-secret.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/copy-el-secret.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/copy-el-secret.cjs",
    "vox:set-app-origin": "esbuild scripts/voximplant/set-app-origin-secret.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/set-app-origin-secret.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/set-app-origin-secret.cjs",
    "fleet:agent": "esbuild scripts/fleet-agent-cli.ts --bundle --platform=node --format=cjs --target=node20 --outfile=dist/fleet-agent-cli.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node --env-file=.env.local dist/fleet-agent-cli.cjs",
    "fleet-agent:build": "esbuild scripts/fleet-agent-cli.ts --bundle --platform=node --format=cjs --target=node24 --outfile=dist/fleet-agent-cli.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native && node scripts/check-fleet-agent-bundle.mjs",
    "pretest": "env -u npm_config_global_ignore_file npm run worker:deps && env -u npm_config_global_ignore_file npm run check:control-chars",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:scraper": "node --test scripts/docs-scraper/scraper.test.mjs",
    "verify:db": "node --env-file=.env.local scripts/verify-db-contracts.mjs",
    "typecheck": "tsc --noEmit",
    "transcribe": "node scripts/transcribe-he.mjs",
    "voximplant": "tsx scripts/voximplant/cli.ts",
    "relocate": "tsx scripts/relocate/cli.ts",
    "check:control-chars": "node scripts/check-control-characters.mjs",
    "meta:types": "node scripts/meta-types.mjs",
    "meta:verify": "tsx --env-file=.env.local scripts/verify-meta-schema.ts",
    "email:health": "esbuild scripts/email-health.ts --bundle --platform=node --format=cjs --target=node24 --outfile=dist/email-health.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native --log-level=error && node --env-file=.env.local dist/email-health.cjs",
    "extra:health": "esbuild scripts/extra-health.ts --bundle --platform=node --format=cjs --target=node24 --outfile=dist/extra-health.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native --log-level=error && node --env-file=.env.local dist/extra-health.cjs",
    "sumit:health": "esbuild scripts/sumit-health.ts --bundle --platform=node --format=cjs --target=node24 --outfile=dist/sumit-health.cjs --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js --external:pg-native --log-level=error && node --env-file=.env.local dist/sumit-health.cjs",
    "flags:sync": "rm -rf public/country-flags && mkdir -p public/country-flags && find node_modules/circle-flags/flags -maxdepth 1 -type f -regextype posix-extended -regex '.*/[a-z]{2}\\.svg' -exec cp -a {} public/country-flags/ \\;",
    "check:permissions": "supabase db query --linked -f scripts/check-permission-deny-matrix.sql"
  },
  "devDependencies": {
    "@clack/prompts": "^1.7.0",
    "@crawlee/playwright": "^3.18.1",
    "@lacspace/seo": "^1.7.2",
    "@microsoft/microsoft-graph-types": "^2.43.1",
    "@next/bundle-analyzer": "16.3.4",
    "@tailwindcss/postcss": "^4",
    "@types/google.maps": "^3.66.1",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/node": "^26.2.0",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "@types/web-push": "^3.6.4",
    "cheerio": "^1.2.0",
    "crawlee": "^3.18.1",
    "dependency-cruiser": "^18.1.0",
    "esbuild": "^0.28.1",
    "eslint": "9.39.5",
    "eslint-config-next": "16.3.4",
    "orval": "^8.31.0",
    "playwright": "^1.63.0",
    "shadcn": "^4.19.0",
    "supabase": "2.117.0",
    "tailwindcss": "^4.3.3",
    "tsx": "^4.23.1",
    "type-fest": "^5.8.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.9"
  },
  "dependencies": {
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "next": "16.3.4"
  }
}
```

## 2. Test config files
```text
find: paths must precede expression: `:math:text$'
```

## 3. Existing workflow editor tests
```text
find: paths must precede expression: `:math:text$'
```

## 4. Tests touching effects / stores / rerender
```text
find: paths must precede expression: `:math:text$'
SECTION-6-SDK-AUDIT.md
SECTION-6-TEST-INFRA.md
agent/skills/agents/references/widget-embedding.md
docs/b2c-entry-routing-plan-2026-09-03.md
docs/voice-agent/plans/2026-09-15-generic-voice-primitive-plan.md
docs/voximplant/research/guides-conferences.md
docs/workflowbuilder-sdk-reference-2026-09-09.md
docs/workflowbuilder/AUDIT-2026-09-15.md
docs/workflowbuilder/README.md
docs/workflowbuilder/api/hooks/useeffectchange.md
docs/workflowbuilder/api/listeners/addnodechangedlistener.md
docs/workflowbuilder/api/listeners/addnodedragstartlistener.md
docs/workflowbuilder/api/store/usestore.md
docs/workflowbuilder/workflowbuilder.io-md/integrations/temporal.html.md
docs/workflowbuilder/workflowbuilder.io-md/llms-ctx.txt
handoffs/claude_700ddb02-7a6a-471b-b5c5-d55f5f5e806f.md
handoffs/claude_f7f09f8a-5bde-4020-8eb4-fe48bf8c9915.md
plans/close-open-loops.md
plans/open-questions.md
scripts/docs-json-to-md.mjs
src/app/(admin)/admin/analytics/_auto-refresh.tsx
src/app/(admin)/admin/calendar/calendar-client.tsx
src/app/(admin)/admin/calendar/event-edit-dialog.tsx
src/app/(admin)/admin/debug/_auto-refresh-toggle.tsx
src/app/(admin)/admin/integrations/extra-sms/page.test.ts
src/app/(admin)/admin/integrations/meta-whatsapp/page.test.ts
src/app/(admin)/admin/integrations/numbers/numbers-table.test.ts
src/app/(admin)/admin/integrations/page.test.ts
src/app/(admin)/admin/integrations/resend-email/page.test.ts
src/app/(admin)/admin/integrations/slack/page.test.ts
src/app/(admin)/admin/integrations/sumit/page.test.ts
src/app/(admin)/admin/integrations/voximplant/page.test.ts
src/app/(admin)/admin/relocation/_auto-refresh-toggle.tsx
src/app/(admin)/admin/voice/console/_console-client.tsx
src/app/(admin)/admin/workflows/[id]/app-bar.tsx
src/app/(admin)/admin/workflows/[id]/highlighting.tsx
src/app/(admin)/admin/workflows/[id]/log-panel.tsx
src/app/(admin)/admin/workflows/[id]/node-markers.tsx
src/app/(admin)/admin/workflows/[id]/page.tsx
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx
src/app/(admin)/admin/workflows/[id]/test-panel.tsx
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts
src/app/(admin)/admin/workflows/[id]/use-panels-store.ts
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx
src/app/(customer)/app/events/[id]/campaign/[campaignId]/approve/sign-agreement-form.tsx
src/app/(customer)/app/events/[id]/campaign/[campaignId]/manage-client.tsx
src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/_held-analytics.tsx
src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.test.ts
src/app/(customer)/app/events/[id]/guests/guest-list-controls.tsx
src/app/(customer)/app/settings/passkey-manager.tsx
src/app/(customer)/app/settings/push-notification-manager.tsx
src/app/(public)/(site)/contact/inquiry-forms.tsx
src/app/(public)/g/[token]/page.tsx
src/app/(public)/r/[token]/page.tsx
src/app/(public)/rate/[token]/page.tsx
src/app/(public)/ty/[token]/page.tsx
src/app/guest-list-template.csv/route.ts
src/app/llms.txt/route.ts
src/components/availability/availability-status.tsx
src/components/consent/cookie-consent.tsx
src/components/consent/ga-flag-listener.tsx
src/components/consent/google-analytics-gated.tsx
src/components/consent/page-view-tracker.tsx
src/components/console/ai-handoff-section.tsx
src/components/console/call-bar.tsx
src/components/console/chat-section.tsx
src/components/console/dial-button.tsx
src/components/console/push-alert-toggle.tsx
src/components/console/roster-dial-button.tsx
src/components/console/softphone-panel.tsx
src/components/motion/flip-card.tsx
src/components/places-autocomplete.tsx
src/components/reui/event-calendar/event-calendar-dnd.tsx
src/components/reui/event-calendar/event-calendar-month-view.tsx
src/components/reui/event-calendar/event-calendar-resource-view.tsx
src/components/reui/event-calendar/event-calendar-time-grid.tsx
src/components/reui/event-calendar/event-calendar.tsx
src/components/site/call-widget.tsx
src/components/ui/calendar.tsx
src/components/ui/sidebar.tsx
src/components/use-version-skew-reload.ts
src/lib/http/markdown-negotiation.test.ts
src/lib/workflow/sdk-integration-invariants.test.ts
```

## 5. Testing-library / jsdom / happy-dom availability
```text
beta@0.1.0 /var/www/vhosts/kalfa.me/beta
└── vitest@4.1.11

```

## 6. Relevant test setup
```text
./vitest.config.mts-1-import { fileURLToPath } from 'node:url';
./vitest.config.mts-2-import { defineConfig } from 'vitest/config';
./vitest.config.mts-3-
./vitest.config.mts:4:// Unit tests run in a Node environment. Most testable logic is server-side
./vitest.config.mts-5-// (Zod schemas, ownership filtering, auth helpers); component tests can add a
./vitest.config.mts:6:// jsdom environment later if needed.
./vitest.config.mts-7-//
./vitest.config.mts-8-// TZ is pinned so a test suite full of dates gives the same answer on any
./vitest.config.mts-9-// machine. Without it the runner inherits the host, and a scheduling test that
./vitest.config.mts-10-// passes on a server set to Israel can fail in CI set to UTC — or, worse, pass
./vitest.config.mts-11-// in both while asserting different things. Asia/Jerusalem is the product's
./vitest.config.mts-12-// only timezone, so pinning it also means a test that quietly depends on local
./vitest.config.mts-13-// time is testing the behaviour users actually get.
./vitest.config.mts-14-// NODE_ENV is pinned for the same reason as TZ, and for a measured one:
./vitest.config.mts-15-// vitest defaults it to 'test' only when it is UNSET, so an inherited value
./vitest.config.mts:16:// wins. The fleet's qa-runner is spawned from a pm2 process whose environment
./vitest.config.mts-17-// declares NODE_ENV=production (ecosystem.config.cjs), and that leaked into
./vitest.config.mts-18-// the suite — src/lib/url.ts:50 deliberately throws when APP_ORIGIN is unset
./vitest.config.mts-19-// in production, so 2 tests in url.test.ts failed there and passed everywhere
./vitest.config.mts-20-// else. Isolated 2026-07-29: the same run with APP_ORIGIN supplied passes,
./vitest.config.mts:21:// which confirms the trigger is the environment, not the code under test.
./vitest.config.mts-22-// A test run must not depend on who invoked it.
./vitest.config.mts-23-//
./vitest.config.mts-24-// WHAT `test.env` IS, and what it deliberately is NOT
./vitest.config.mts-25-// ---------------------------------------------------
./vitest.config.mts:26:// Vitest defines `test.env` as "custom environment variables assigned to
./vitest.config.mts-27-// `process.env` before running tests" — so the two entries above are the whole
./vitest.config.mts-28-// contract between the runner and the suite. Everything else a test needs it
./vitest.config.mts-29-// must declare itself.
./vitest.config.mts-30-//
./vitest.config.mts-31-// Vitest does NOT read .env/.env.local into process.env. That is opt-in, and the
--
./vitest.config.mts-51-// clears it with `afterEach(() => vi.unstubAllEnvs())`. Never add a product flag
./vitest.config.mts-52-// here to make a test pass — pinning one state in the config also means the
./vitest.config.mts-53-// other state is never tested, and a kill-switch has two real states.
./vitest.config.mts-54-export default defineConfig({
./vitest.config.mts-55-  test: {
./vitest.config.mts:56:    environment: 'node',
./vitest.config.mts-57-    include: ['src/**/*.test.ts'],
./vitest.config.mts-58-    env: { TZ: 'Asia/Jerusalem', NODE_ENV: 'test' },
./vitest.config.mts-59-    // @workflowbuilder/sdk is browser ESM and imports @xyflow/react's
./vitest.config.mts-60-    // stylesheet. Node's loader refuses a .css file outright
./vitest.config.mts-61-    // ("Unknown file extension .css"), and a package left EXTERNAL is loaded by
```

## 7. All resetExecution call sites
```text
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-30-function watchRun(runId: string) {
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-31-  stopWatching();
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-32-  // Reset before subscribing: the snapshot that arrives first replaces the
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-33-  // store wholesale, but a failed connection would otherwise leave the previous
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-34-  // run's nodes lit under the new run's id.
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx:35:  resetExecution();
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-36-  setExecutionStarted(runId);
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-37-  disconnect = connectExecutionStream(runId);
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-38-}
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-39-
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-40-export function RunWatchButton({ runId }: { runId: string }) {
--
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-53-      variant={isWatching ? 'secondary' : 'outline'}
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-54-      aria-pressed={isWatching}
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-55-      onClick={() => {
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-56-        if (isWatching) {
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-57-          stopWatching();
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx:58:          resetExecution();
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-59-        } else {
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-60-          watchRun(runId);
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-61-        }
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-62-      }}
src/app/(admin)/admin/workflows/[id]/run-watcher.tsx-63-    >
--
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts-58-  isLogCollapsed: false,
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts-59-};
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts-60-
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts-61-export const useExecutionStore = create<ExecutionStore>()(() => ({ ...emptyStore }));
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts-62-
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts:63:export function resetExecution() {
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts-64-  useExecutionStore.setState((state) => ({
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts-65-    ...emptyStore,
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts-66-    isLogCollapsed: state.isLogCollapsed,
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts-67-  }));
src/app/(admin)/admin/workflows/[id]/use-execution-store.ts-68-}
--
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-289-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-290-  // Root 2.3.0 omits globalVariables from its props. Its child effects load
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-291-  // nodes/edges first; this parent effect restores the remaining persisted field.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-292-  useEffect(() => {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-293-    useStore.setState({ globalVariables: initialGlobalVariables ?? {} });
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:294:    resetExecution();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-295-    resetPanels();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-296-    return () => {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:297:      resetExecution();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-298-      resetPanels();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-299-    };
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-300-  }, [workflowId, initialGlobalVariables]);
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-301-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-302-  // Published to a module store rather than passed down: the header control is
--
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-44-  const [pending, startTransition] = useTransition();
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-45-
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-46-  const run = () => {
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-47-    setError(null);
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-48-    setResult(null);
src/app/(admin)/admin/workflows/[id]/test-panel.tsx:49:    resetExecution();
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-50-    startTransition(async () => {
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-51-      try {
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-52-        const next = await testWorkflowAction(workflowId, {
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-53-          messageText,
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-54-          buttonPayload,
--
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-71-  };
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-72-
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-73-  const clear = () => {
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-74-    setResult(null);
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-75-    setError(null);
src/app/(admin)/admin/workflows/[id]/test-panel.tsx:76:    resetExecution();
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-77-  };
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-78-
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-79-  return (
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-80-    <section className="space-y-3 rounded-lg border border-border p-4">
src/app/(admin)/admin/workflows/[id]/test-panel.tsx-81-      <div className="flex flex-wrap items-center gap-2">
```

## 8. WorkflowEditor render context
```text

  // The stored jsonb is parsed before it reaches the editor. A row that cannot
  // be parsed opens as an empty canvas rather than crashing the page — the
  // owner can always draw their way out, which is not true if the route throws.
  const parsed = editorDiagramSchema.safeParse(workflow.definition);
  const nodes = parsed.success ? parsed.data.nodes : [];
  const edges = parsed.success ? parsed.data.edges : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/workflows"
          className="text-sm underline underline-offset-4"
        >
          ← כל התהליכים
        </Link>
        <h1 className="text-2xl font-bold">{workflow.name}</h1>
        <Badge variant={workflow.isActive ? "success" : "secondary"}>
          {workflow.isActive ? "פעיל" : "כבוי"}
        </Badge>
        {!parsed.success && (
          <span role="alert" className="text-sm text-destructive">
            התהליך השמור לא ניתן לקריאה ונפתח כקנבס ריק. שמירה תדרוס אותו.
          </span>
        )}
      </div>

      <WorkflowEditor
        key={workflow.id}
        workflowId={workflow.id}
        name={workflow.name}
        layoutDirection={
          parsed.success ? parsed.data.layoutDirection : undefined
        }
        initialGlobalVariables={
          parsed.success ? parsed.data.globalVariables : undefined
        }
        initialNodes={nodes as never}
        initialEdges={edges as never}
        whatsappNumbers={whatsappNumbers}
        voicePurposes={voicePurposes}
        voiceCallerIds={voiceCallerIds}
        secretNames={secretNames}
        saveAction={saveWorkflowAction}
      />

      <RunNowPanel workflowId={workflow.id} scopedEventId={workflow.eventId} />

      <TestPanel workflowId={workflow.id} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">הרצות אחרונות</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            עדיין לא רץ. תהליך כבוי לא רץ אף פעם — הפעילו אותו ברשימה.
          </p>
        ) : (
          <>
            {/*
              Cards on a phone, the table from `lg` up — the same shape as the
              workflow list, and for the reason recorded there: a `min-w` table
              on this page put "מעקב", and with it the cancel button, off-frame
              with no way to reach them.
            */}
            <ul className="space-y-3 lg:hidden">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="space-y-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {RUN_STATUS_HE[run.status] ?? run.status}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {run.triggerSource}
                    </span>
                  </div>
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <div className="flex gap-1">
                      <dt>התחיל:</dt>
                      <dd>{formatDateTime(run.createdAt)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>הסתיים:</dt>
                      <dd>
                        {run.finishedAt ? formatDateTime(run.finishedAt) : "—"}
                      </dd>
                    </div>
                  </dl>
```
