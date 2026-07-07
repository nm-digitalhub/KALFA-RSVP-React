# Wiring the personal brit WhatsApp templates — implementation plan (2026-07-07)

Templates (all live at Meta): `kalfa_brit_invite_trad_v4` (APPROVED/UTILITY) +
`_media_v4` (APPROVED/UTILITY), `kalfa_brit_reminder_trad_v1` (PENDING/MARKETING) +
`_media_v1` (APPROVED/MARKETING), `kalfa_brit_thankyou_trad_v1` (PENDING/UTILITY).

Positional layouts (as submitted — authoritative, not in the older submission doc):
- **invite v4** (7): `{{1}}` first-person line · `{{2}}` weekday · `{{3}}` Hebrew date · `{{4}}` Gregorian · `{{5}}` time · `{{6}}` venue · `{{7}}` closing line
- **reminder v1** (6): `{{1}}` first-person reminder line · `{{2}}`–`{{6}}` weekday/hebrew/gregorian/time/venue
- **thankyou v1** (2): `{{1}}` first-person thanks line · `{{2}}` signature (`משפחת <surname>`)

## Context already true (parallel session)
- **Fix A deployed + flag LIVE**: `message_templates.components.rsvp_quick_reply={"brit":true}` on invite/reminder_1/reminder_2/final. Quick-reply payload injection is DONE — new brit template names registered under those keys inherit it.
- **Hebrew gematria already implemented**: `gematria(n)` + `formatHebrewDateIL(ms)` in `template-spec.ts` produce `כ״ז בתמוז תשפ״ו` today (folded into `{{5}}`). Reuse, don't hand-roll.

## The blocker (needs approval)
The requested conjugation (single-mother/single-father/couple → `מתכבדת/מתכבד/מתכבדים`, `בני/בננו`, `אשמח…עמי/נשמח…עמנו`) is **not derivable** from current data: `events.celebrants` 'parents' kind stores only free-text `parents` + optional `child` — no gender/host-count. Requires an additive `host_composition` enum (`single_mother|single_father|couple`) on the parents kind (schemas.ts + event-labels.ts + owner form + brit gate). No ALTER TABLE (celebrants is jsonb) but a data-contract change per CLAUDE.md.

## Steps (14)
1. **src/lib/date.ts** — relocate `gematria`/`formatHebrewDateIL` here as `formatIsraelHebrewDate(value)` (toMs-guarded, `''` on invalid); add `formatIsraelWeekday(value)` (strip `יום ` → `ראשון`).
2. **template-spec.ts** — delete the moved helpers, import from `@/lib/date`; existing generic/wedding 7-tuple unchanged (byte-for-byte tests pass).
3. **schemas.ts** *(NEEDS APPROVAL)* — add `host_composition` enum to parents kind (form + complete schema, CelebrantsInput, CelebrantFieldKey, CELEBRANT_FIELD_KEYS_BY_KIND).
4. **event-labels.ts** — `CELEBRANT_FIELD_LABELS.brit/britah.host_composition` + `HOST_COMPOSITION_LABELS` (data-driven).
5. **owner celebrant form** — RTL `<select>` for host_composition (parents kind only), same input path.
6. **template-spec.ts** — new pure composer + brit builders: `buildBritPersonalLine`, `britClosing`, `buildBritTradInviteParams`/`ReminderParams`/`ThankyouParams` (own tuple types, fail-closed `{missing}`).
7. **message-templates.ts** — `paramContractFor(components, eventType)` + `ResolvedTemplate.paramContract` from `components.param_contract[eventType]` (data-driven, not a name test).
8. **template-spec.ts** — one shared `buildBodyParams({paramContract, family, ctx})` dispatcher.
9. **outreach.ts:214** — manual-batch site → `buildBodyParams`.
10. **outreach-engine.ts:354** — worker `executeStep` → `buildBodyParams`.
11. **outreach-engine.ts:632** — worker `prepareAndSendStep` → `buildBodyParams` (lockstep with 10).
12. **new migration** — DATA-only jsonb merge on `message_templates.components`: invite row → `variants.brit=kalfa_brit_invite_trad_v4`, `media_variants.brit=..._media_v4`, `param_contract.brit=brit_trad_invite`; reminder_1 (and reminder_2?) → reminder v1 names + `param_contract.brit=brit_trad_reminder`. After 20260707160000. Preserve existing keys via `components || jsonb_build_object(...)`.
13. **(DEFER)** thankyou SEND path — land only the builder; the drip engine structurally rejects post-event sends (isPastEventDay gate, terminalized reached/attending, active-only). Needs a separate trigger (webhook post-RSVP ack OR post-event pg-boss sweep) + consent decision.
14. **tests** — date.test (hebrew-date + weekday fixtures), template-spec.test (conjugation matrix + builder tuples + fail-closed), message-templates.test (param_contract resolution), outreach(.engine).test (buildBodyParams routing).

## Decisions needed
- **host_composition**: required at brit gate (correct; existing active brit events need backfill) vs optional + default `couple` (no friction).
- **reminder**: brit reminder template on reminder_1 only, or reminder_1 + reminder_2.
- **britah** (baby girl): brit-only now, or symmetric brit+britah (child noun switches on event_type).
- **signature surname source**: parents-string last token / event.name / new field.
- **thankyou semantics**: post-RSVP webhook ack (in-window, free) vs post-event sweep (billing/consent).

## Verification
lint · tsc --noEmit · build (`next build --webpack`) · vitest (date, template-spec, message-templates, outreach, outreach-engine) · post-migration SELECT of components on a branch DB · staging brit send (guard Meta 132000/132012 param-count/format).

## Key risks
- Making host_composition required retroactively blocks existing brit campaigns until backfilled.
- 3-site dispatch must move together or one path mis-binds (mitigated by the shared dispatcher).
- Builder arity MUST match the Meta layout above or every send hard-fails (132000/132012).
- media_v4 only activates when the event has an uploaded `invite_image_path`; else text v4.
