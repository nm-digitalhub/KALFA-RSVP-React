# KALFA Event Magic

B2C, per-event RSVP platform. Hebrew-first, RTL. Built with Next.js 16 (App
Router), React 19, TypeScript, Tailwind CSS v4, and Supabase.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env.local` from the template and fill in your Supabase project values:
   ```bash
   cp .env.example .env.local
   ```
   | Variable | Scope | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | public | project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | **server only** | never expose via `NEXT_PUBLIC_*` |
3. Link to the Supabase project (its schema already exists) and regenerate types:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase gen types typescript --linked --schema public > src/lib/supabase/types.ts
   ```
4. Run the dev server:
   ```bash
   npm run dev
   ```

## Verification

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Routes

- `/` — public landing
- `/auth/login`, `/auth/signup` — authentication (Server Actions + Zod)
- `/auth/logout` (POST), `/auth/callback` (GET) — session lifecycle
- `/app` — customer dashboard: the owner's events (protected)
- `/app/events/new` — create an event (protected)

## Architecture

- `src/proxy.ts` — Next 16 Proxy (renamed from middleware): optimistic Supabase
  session refresh + redirect for protected routes. Not the only line of defense.
- `src/lib/supabase/` — separate server (`server.ts`) and browser (`client.ts`)
  clients via `@supabase/ssr`; `env.ts` reads public env; `types.ts` is generated
  from the live project (`supabase gen types typescript --linked`).
- `src/lib/auth/dal.ts` — Data Access Layer: `getUser` / `requireUser` /
  `requireAdmin`, memoized with React `cache()`. `getUser()` verifies the token
  with Supabase Auth (never `getSession()` for authorization).
- `src/lib/data/` — ownership-scoped queries returning DTOs; explicit
  `owner_id` filtering in addition to RLS.
- `src/lib/validation/` — Zod schemas and shared `FormState` / `ActionResult`.
- Security model: server-side authorization on every protected page, Action, and
  Route Handler; RLS enabled on `public.events` as a second layer.

## Status

Foundation + events vertical slice, built on the **existing live schema** of the
`kalfa-event-magic` Supabase project (types generated via `supabase gen types`).
The database already contains the full domain — `events`, `guests`,
`guest_groups`, `event_questions`, `rsvp_responses`, `campaigns`, `orders`,
`packages`, `profiles`, `user_roles`, … — plus RPCs (`submit_rsvp`,
`get_rsvp_by_token`, `has_role`, `owns_event`). Next domains follow the same
pattern: guests, public RSVP (`/r/[token]`), campaigns/messaging, reports,
orders/packages, admin.
