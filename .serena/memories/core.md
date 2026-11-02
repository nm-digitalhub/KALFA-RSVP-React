# KALFA beta — core map

Hebrew-first RTL, B2C per-event RSVP SaaS (Next.js App Router + Supabase + pg-boss worker + Voximplant/ElevenLabs voice + Meta WhatsApp).
Project rules live in `CLAUDE.md` / `AGENTS.md` at repo root; they override generic habits.

## Source map
- `src/app/` — route groups: `(customer)` owner app, `(admin)` staff, `(public)` site + token pages (`/r/[token]` RSVP), `(access)`, `api/` route handlers (webhooks, voximplant ctx/cb/agent-tool, console), `auth/`, `oauth/`.
- `src/lib/data/` — LAYER folder: every module that touches the DB (~138 source + `admin/` 55). Flat, all domains mixed.
- `src/lib/<domain>/` (~40: outreach, whatsapp, voximplant, payments, casl, console, dnc, …) — mostly DB-free domain logic. A domain is usually split: DB part in `src/lib/data/`, rest in its domain folder.
- `worker/main.ts` — pg-boss worker entry (outreach steps, webhook drain, crons); bundled to `dist/worker.cjs` (gitignored build output, never edit).
- `supabase/migrations/` (source of schema truth over time), `supabase/tests/database/` (pgTAP).
- `voxfiles/applications/<app>/scenarios/src/*.voxengine.js` — Voximplant scenarios; `voxfiles/.voxengine-ci/**/metadata` = last-uploaded hashes (tracked).
- `agent_configs/*.json` + `agents.json` — ElevenLabs agent configs (CLI round-trip only).
- `openspec/` — spec-driven change workflow.

## Invariants
- Guest answer of record = `guests.status`, written by DB fn `submit_rsvp` (all channels) except owner edits (`updateGuest`, direct write).
- Outreach stop gate = `isContactReached` (`src/lib/data/outreach-engine.ts`) → reads `billed_results` (legacy "reached", not the guest answer).
- One phone per event: unique index `guests_event_phone_key` (digits-normalized, 972→0).
- `src/lib/supabase/types.generated.ts` is generated from the LINKED project only.

Further: stack/versions `mem:tech_stack`; commands `mem:suggested_commands`; code conventions `mem:conventions`; done-checklist `mem:task_completion`.
