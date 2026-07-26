# Data-driven channels — plan (Stages 0/1/2)

**Owner ask (2026-07-26):** "the AI-call status on the package page must be *genuinely* affected by the channels selection" → then, after research: "first research, then design — maybe a relationship between tables is needed" + **priority: no hardcode**.

**Research verdict (rls-schema-engineer, VERIFIED-LIVE + ctx7 Supabase docs):** the word "channel" is really THREE separable things, and only one of them is still hardcoded:

| component | where today | hardcoded? |
|---|---|---|
| **1. channel SET** (whatsapp/call) | `campaign_channel` enum **+** UI literals `['whatsapp','call']` + `CHANNEL_LABELS` in `package-form.tsx` | ✅ **yes** — the real remaining hardcode |
| **2. channel STATUS** (built/live/configured) | `app_settings` (`voximplant_*`, `voximplant_live_calls`, `outreach_enabled`) | ❌ no — already data-driven, admin-editable, already threaded server-side into the page |
| **3. channel CONFIG** (credentials/toggles) | `app_settings` columns | ❌ no — admin-editable in DB |

The owner's *immediate* ask (real AI-call status) is component **#2, which is already data-driven** — the only defect is that the current `callChannelLive` boolean collapses three states into one and the "off" copy says "**built** but off" even when the channel was never built. The *no-hardcode priority* points at component **#1** (the enum + UI literals).

**ctx7 Supabase evidence (docs-only, `guides/database/postgres/enums.mdx`):** enums are for a set that is *"small, fixed, and unlikely to change"* — the current 2-value set fits, so the enum is not a technical error. **But** adding/removing a value *"requires schema modifications"* (`alter type … add value`), which is exactly what the no-hardcode goal wants to avoid → the docs push a set-that-must-change-without-migration toward a **reference table + FK**. PostgREST junction requirement (blog v10): an M2M join table needs a composite PK of both FKs. RLS on a lookup table: `enable row level security` + `has_role((select auth.uid()),'admin')` write policy + read GRANT to `authenticated` (columns without GRANT → 42501 even with a perfect policy). Generated columns are **not** the tool here — the live status is per-install runtime config in `app_settings`, not a row-derived value.

**Guiding decision:** remove the hardcode in additive stages, never touching the money-path gate (`campaigns.allowed_channels`) until a genuinely new channel justifies it.

---

## Stage 0 — 3-state AI-call status (IMMEDIATE · app-layer only · zero schema · zero risk)

Satisfies the literal ask and fixes the "built but off" inaccuracy. **No new permission needed:** `getVoximplantConfig()` uses `createAdminClient()` (no `manage_voice` gate — the page is `manage_billing`) and already distinguishes the three states:

- returns `null` → **not_configured** (SA-json / rule_id / caller_id missing)
- object, `liveCallsEnabled === false` → **configured_off** (built but env/DB toggle off)
- object, `liveCallsEnabled === true` → **live**

### Changes
1. `src/app/(admin)/admin/packages/new/page.tsx` + `[id]/page.tsx`: replace
   `const callChannelLive = (await getVoximplantConfig())?.liveCallsEnabled ?? false;`
   with a derived 3-state value:
   ```ts
   const voxCfg = await getVoximplantConfig();
   const callChannelStatus: CallChannelStatus =
     voxCfg == null ? 'not_configured' : voxCfg.liveCallsEnabled ? 'live' : 'configured_off';
   ```
2. `package-form.tsx`: change the `callChannelLive: boolean` prop to `callChannelStatus: CallChannelStatus` (exported union type); thread through `PackageForm` → `TouchpointRow`. Render one message per state:
   - `live` → existing "פעיל ומחובר … שיחה אמיתית" (muted).
   - `configured_off` → "מוגדר אך כבוי כרגע — לא יבצע שיחה עד שיודלק תחת /admin/channels." (amber).
   - `not_configured` → "טרם הוגדר במערכת — הגדירו את הערוץ תחת /admin/channels לפני שילוב שלב שיחה." (amber). **Removes the false "בנוי" claim.**

**Out of scope for Stage 0 (owner product call, per research):** whether the status also reflects the global `outreach_enabled` master switch and the WhatsApp channel. Left as a documented follow-up — not decided unilaterally.

**Verification:** `npx tsc --noEmit` + `npm run lint`; the two package pages render; authed browser check that a `call` touchpoint shows the correct one of the three messages for the current live state (`voximplant_live_calls` currently governs).

**Risk:** none — presentation only, no data path, no schema.

---

## Stage 1 — `channels` lookup table (NO-HARDCODE for the SET's metadata · additive · low risk · money-path untouched)

Makes the channel SET + labels + built-flag + order **admin-managed data**, removing the UI literals. The `campaign_channel` enum and `packages.channels` / `campaigns.allowed_channels` arrays **stay exactly as they are** — the table is a display/metadata catalog whose `key` mirrors the enum labels.

### Migration `supabase/migrations/<ts>_channels_lookup_table.sql`
```sql
create table public.channels (
  key          text primary key,           -- mirrors campaign_channel labels: 'whatsapp','call'
  display_name text not null,
  is_built     boolean not null default false,
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.channels enable row level security;

-- read: any authenticated admin surface; write: admins only (mirrors admin_rls convention)
grant select on public.channels to authenticated;                 -- without GRANT → 42501 even with policy
grant insert, update, delete on public.channels to authenticated; -- gated by the admin policy below

create policy channels_read on public.channels
  for select to authenticated using (true);
create policy channels_admin_write on public.channels
  for all to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));

create index channels_active_sort_idx on public.channels (active, sort_order);

insert into public.channels (key, display_name, is_built, active, sort_order) values
  ('whatsapp', 'וואטסאפ',            true, true, 1),
  ('call',     'שיחת AI (Voximplant)', true, true, 2);
```
- **Backfill risk: none** — seed matches the only two enum values; one live package has `channels={whatsapp,call}`.
- RLS mirrors [[admin-rls-policies]] (cookie client + `has_role`, initplan-wrapped `(select auth.uid())`). Verify the `has_role`/`app_role` signature against the live catalog before writing.
- `updated_at` trigger only if the repo already has a shared `set_updated_at()` — otherwise omit (not load-bearing for a rarely-edited catalog).

### Wiring
- New DAL `getChannelCatalog()` (read `channels where active order by sort_order`) — cookie client, no elevated permission for read.
- `new/page.tsx` + `[id]/page.tsx` fetch the catalog and pass it to `PackageForm`.
- `package-form.tsx`: derive the channel checkboxes, the touchpoint `<select>` options, and every label from the catalog prop instead of `['whatsapp','call']` + `CHANNEL_LABELS`.
- **Validation stays enum-based** (`channelsField = z.array(z.enum([...]))` in `validation/admin.ts`) — the enum remains the storable-value guard; catalog keys mirror it. (Making validation itself catalog-driven is Stage 2.)

### Honest limits (must tell the owner)
1. **A catalog row alone does NOT make a new channel work.** Each channel is a full code stack (dispatcher + templates + consent + billing + provider). The table removes hardcode of the SET's *metadata/labels/status* — it does not make "add a row → channel dials" true.
2. **A genuinely new channel value still needs a migration** (`alter type campaign_channel add value …`) because the enum + arrays remain the storable constraint. Stage 1 buys single-source-of-truth labels, admin-editable `is_built`/`active`/`sort_order`/`display_name`, and a clean home for per-channel metadata — not code-free channel addition.
3. **Live status stays in `app_settings`** — credentials/toggles are per-install runtime config and do not move into the catalog.

**Verification:** migration applied to a rollback-probe first; `list_migrations` in sync; `supabase gen types` regen (never hand-edit — [[no-hand-editing-generated-artifacts]]); `tsc`/`lint`/full test suite; authed browser check that the form renders channels from the catalog and that toggling a catalog row's `active`/`display_name` is reflected without a code change.

**Rollback:** `drop table public.channels;` (no FK depends on it in Stage 1) — safe because nothing on the money path references it.

**Risk:** low — new isolated table, RLS admin-only, read-only in the app hot path, enum/arrays/outreach/billing untouched.

**⚠️ Apply gate:** present this migration for **explicit owner approval before `db push`** (live-schema change; project rule + [[parallel-sessions-one-live-db]]).

---

## Stage 2 — junction table + dynamic validation (DEFERRED · high risk · gate = a real 3rd channel)

Only when a genuinely new channel (email/SMS) enters development AND admin-managed channel membership is wanted:
- `packages.channels` → junction `package_channels(package_id uuid, channel_key text, primary key(package_id, channel_key))` (PostgREST composite-PK requirement) + FK to `channels(key)`.
- `campaigns.allowed_channels` may stay a frozen snapshot (the money-path gate) — do **not** convert it lightly.
- Validation becomes catalog-driven (fetch active keys in the action).
- **Blast radius (all must change):** `validation/admin.ts` (channelsField + subset superRefine), `data/admin/packages.ts` (read/write/diff), `data/campaigns.ts` (`allowed_channels: template.channels` — the snapshot into the money path), `outreach-engine.ts` + `outreach-calls.ts` (`allowed_channels.includes('call')`, `tp.channel`), plus `interactions.ts`/`billing.ts`/`outreach.ts`/`agreements*`/`fleet/business-facts.ts`, and `alter type` for the new enum value; regen types; new RLS.
- **Why deferred:** this touches the pre-charge gate. ROI is low until a third channel exists — and even then the live status stays in `app_settings`. Do not do this to satisfy the current status/label ask.

---

## Risks (summary)

| # | risk | mitigation |
|---|---|---|
| R1 | Stage 0 status wrong for a `configured_off` vs `not_configured` edge | derived directly from `getVoximplantConfig()` null-vs-object + `liveCallsEnabled`; authed browser check |
| R2 | Stage 1 RLS `42501` (GRANT missing) | explicit `grant select/insert/update/delete to authenticated` + admin policy; verify `has_role` signature live |
| R3 | Catalog key drifts from enum → validation rejects a stored channel | seed keys == enum labels; Stage-1 validation stays enum-based so drift is impossible until Stage 2 |
| R4 | Owner expects "add row → new channel" | limits documented above + surfaced in the review message |
| R5 | Applying migration to live without review | explicit approval gate before `db push`; rollback-probe first |

## Definition of done
- Stage 0: 3-state status live on both package pages; `tsc`/`lint`/tests green.
- Stage 1: `channels` table + RLS applied (after approval), catalog-driven form, types regen, full suite green, authed browser verification, live gate for the pricing model **unchanged/OFF**.
- Stage 2: documented only.
