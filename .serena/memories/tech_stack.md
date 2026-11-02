# Tech stack

- Next.js 16.4 App Router (breaking vs training data — read `node_modules/next/dist/docs/` before framework APIs), React 19, TypeScript 6, webpack build (`--webpack`).
- Supabase: `@supabase/supabase-js` 2.x + `@supabase/ssr` (cookie sessions); CLI pinned `supabase@2.122.0`. Service role only via `createAdminClient()` (server-only).
- pg-boss 12 (queues in `src/lib/queue/queues.ts`); worker bundled by esbuild to `dist/worker.cjs`, run by pm2 `kalfa-worker`; web app = pm2 `kalfa-beta` (`ecosystem.config.cjs`, plain `pm2 restart`, no --update-env).
- Zod 4 at server boundaries; next-safe-action 8 (`src/lib/safe-action.ts`); CASL 7 permissions (`src/lib/casl.ts`, `PLATFORM_ACTIONS`).
- UI: Tailwind 4 (CSS config), shadcn on `@base-ui/react` (NOT Radix), RTL via DirectionProvider + `dir=rtl`.
- Messaging/voice: `whatsapp-api-js` 6 (Meta Cloud API), Voximplant VoxEngine via `@voximplant/voxengine-ci` 36 (per-application layout), ElevenLabs agents (Rust `elevenlabs` CLI, OAuth keyring).
- Calendar: `@hebcal/core` (Shabbat/holiday send windows). XState 5 available.
- Tests: Vitest 5 (unit, colocated `*.test.ts`), Playwright (e2e), pgTAP (`supabase/tests/database`), dependency-cruiser (`.dependency-cruiser.cjs`, worker import boundaries).
- No `engines`/`packageManager` field; npm.
