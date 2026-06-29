# Master Gap Map — end-to-end wiring of the KALFA outcome-billing flow

> מסמך-על שמאחד את שני מבדקי-הסוכנים (זרימת outreach/RSVP/billing + מבדק רוחבי של כל המערכת),
> את מפת הטפסים↔טבלאות, ואת תיאום מצב-החי. כל "גשר" מצביע על **הקובץ הקיים שהוא מרחיב** —
> אין יצירת קוד כפול ([[reuse-existing-no-duplication]]). אין כאן שינוי קוד — מסמך תכנון בלבד.
>
> **Method note:** the two audits ran *before* several merges landed. Section 1 reconciles what is
> already built so this plan **references, not re-proposes** it. Gap IDs carry both audit prefixes
> (`OB-*` = outreach/RSVP/billing audit; `APP-*` = whole-app audit) deduped to one row.

---

## 0. The central safety fact — accidental fail-closed (verified, primary source)

Live ops gates (read from `app_settings`, [[sb-query-readonly-helper]]):

| gate | value | meaning |
|---|---|---|
| `outreach_enabled` | **true** | send paths are *armed* |
| `payments_enabled` | **true** | SUMIT charge path on |
| `campaign_holds_enabled` | **true** | J5 holds can be placed |
| `close_charge_enabled` | **false** | final settle/charge OFF |

**Yet no WhatsApp message can actually be sent**, because every send path gates on
`contacts.whatsapp_consent_at`, and the *only* writer of that column —
`recordWhatsAppConsent()` (`src/lib/data/contacts.ts:245`) — **has zero production callers**
(grep: only `contacts.test.ts`). Verified both paths:

- **Manual route** `src/app/api/campaigns/[id]/whatsapp-send/route.ts:86` → `sendCampaignWhatsApp`
  (`outreach.ts:96`) → `listSendableContacts` → `.not('whatsapp_consent_at','is',null)`
  (`contacts.ts:282,296`).
- **pg-boss engine** `outreach-engine.ts:238` → `if (tp.channel==='whatsapp' && !contact.whatsapp_consent_at) return {action:'skipped'}`.

So the system is **fail-closed on consent — but by accident, not by design.** This is the hinge of
the whole plan:

> ⚠ **Arming order is the inverse of severity.** Writing `whatsapp_consent_at` (the "fix" for the
> consent gap) is the single act that *arms both broken send paths at once* — and they currently send
> a **bare template with no per-guest RSVP link, no personalization** (`outreach.ts:30` /
> `outreach-engine.ts:256` pass only `{to, templateName, language}`), with **no inbound path that
> records attendance**. Fixing consent first would push broken messages to real guests. Therefore
> consent-capture and `close_charge_enabled=true` are the **LAST** steps, gated behind the RSVP loop.

**Recommendation (user decision, one reversible config row):** set `outreach_enabled=false` until the
send flow is whole — converting accidental safety into deliberate safety. Surfaced in §7; not done here.

---

## 1. Already built — reconciliation (DO NOT re-propose)

Merges that landed after the audits ran already close several "gaps" the raw reports list:

| Audit finding (raw) | Status now | Evidence |
|---|---|---|
| APP ORG-1 — no org/team management | ✅ **BUILT** | `/app/team`, `/admin/users`, `/join/[token]` exist (commit `f04993c`) |
| APP — agreement is hardcoded draft | ✅ **BUILT** | `/admin/agreement` DB-driven + approvable (`39ac38b`, `64694b3`) |
| APP CAMP — orphaned activate/pause/close | ✅ **WIRED** | lifecycle UI + owner board (`c3c04a3`) — residual = CAMP-1 settle path (§6) |
| OB billing — uncapped outreach (reached ⊄ billable) | ✅ **BUILT** | frozen-set `snapshotAuthorizedSet()` `contacts.ts:344`, wired `campaigns.ts:421` (`d648148`) |
| APP guests G1 — no group management | ◑ **MOSTLY** | `createGroupAction`/`deleteGroupAction` exist (form-map §A.2); full mgmt UI thin |
| OB — no inbound webhook | ✅ **BUILT** | signature-verified, dedup, billed (`181a6f3`) — but see OB-ATT (§2, bills≠attendance) |
| OB — no message-templates surface | ✅ **BUILT** | `/admin/templates` + resolver (`b35695f`) |
| OB — no provider config | ✅ **BUILT** | `/admin/channels` WhatsApp form (`0eeafb0`) |
| OB — no outreach engine | ✅ **BUILT, gated OFF** | C1 engine + pg-boss worker (`e756a2b`, `3bcbf1c`) |
| OB — close-charge missing | ✅ **BUILT, gated OFF** | B4 orchestrator + route (`a87fcf6`, `8386212`); `close_charge_enabled=false` |

**Frozen-set caveat to verify (not re-build):** confirm `snapshotAuthorizedSet` fires at the **J5
hold / financial-commitment** step (the cross-agent contract comment at `campaigns.ts:421` asserts
`set == current eligible` at that moment) — and that `max_contacts`/ceiling are recomputed from it
there, closing the create→approval drift.

---

## 2. The end-to-end flow, stage by stage — with the broken links marked

The outcome-billing business flow and where each link is whole (✓) or broken (✗). This is the
"חיווט תהליכי הזרימה" the user asked to trace.

```
[1] Event ──✓── [2] Guests/Contacts ──✗ CONSENT ── [3] Campaign create ──✓── [4] Agreement+OTP+J5 hold
                                                                                       │
                                                                                       ✓ (frozen-set snapshot here)
                                                                                       ▼
[8] Charge/Invoice ──✗ CAMP-1/gate── [7] Close/settle ──✗ ATTENDANCE── [6] Recipient confirms ──✗ RSVP PAGE / LINK ── [5] Outreach send
```

Stage-by-stage broken links (deduped IDs):

- **[2→3] Consent gate unsatisfiable — `OB-CONSENT` (crit).** `whatsapp_consent_at` never written →
  no send can fire. *Where:* writer `contacts.ts:245` has no caller. (This is also the accidental
  safety in §0.)
- **[5] Send carries zero personalization / no RSVP link — `OB-SEND` (crit).** `sendWhatsAppTemplate`
  is called with only `{to, templateName, language}`; no body params, no URL-button token.
  *Where:* `outreach.ts:30`, `outreach-engine.ts:256`. Even with consent on, guests get a bare message.
- **[6] No public RSVP surface — `OB-RSVP` (crit).** Route `src/app/r/[token]` **does not exist**;
  no app code calls the live RPCs. *Where:* `find src/app/r` → absent; grep `get_rsvp_by_token` in
  `src/` → none. (RPCs exist on the DB — §5.)
- **[6] RPC security gaps — `OB-RPC-READ` / `OB-RPC-WRITE` (crit).** `get_rsvp_by_token` returns
  guest+event PII to anon with no expiry/status/revocation gate (`OB-RPC-READ`); `submit_rsvp` is an
  ungated, non-idempotent anon write with no deadline/status/count bound (`OB-RPC-WRITE`). *Where:*
  live DB function bodies (§5).
- **[6→7] Inbound reply bills but never records attendance — `OB-ATT` (crit).** Webhook calls
  `recordReached` (billing) but never touches `guests` / `confirmed_adults` / `status='attending'`.
  *Where:* `src/app/api/webhooks/whatsapp/route.ts` imports `recordReached` only; no `guests` write.
  Net: reach (cost) is recorded, the actual RSVP answer is lost.
- **[6→7] Inbound can bill the wrong event — `OB-ATT2` (high).** Reach keyed by contact without a
  hardened campaign/event binding on the quick-reply path. *Where:* webhook resolve path (audit OB).
- **[7→8] Settle is an unauthenticated charge on the already-closed path — `APP-CAMP-1` (crit, latent).**
  `settleCampaignAction` has no own ownership gate; `closeCampaignAndCharge` skips the ownership-bearing
  `closeCampaign` when `status==='closed'`. Dormant only because `close_charge_enabled=false`. *Where:*
  `campaign-actions.ts:214-242`, `close-charge.ts:55-61`. (§6)
- **[8] J5 hold release not wired — `OB-HOLD-REL` (high).** Hold is placed but never released on
  close/no-charge. *Where:* lifecycle close path (audit OB).
- **Auth recovery missing — `APP-AUTH-1` (high).** No forgot/reset/update-password page; a locked-out
  user cannot recover. *Where:* `src/app/auth/*` has login/signup/logout/callback only.
- **Orphan tables — `APP-ORPH` (high).** `event_questions` (no authoring UI, no RSVP render),
  `rsvp_responses` (written only by the missing RSVP submit). *Where:* form-map §C.
- **Admin-config gaps (med):** packages outcome-billing fields not editable (`APP-PKG`);
  `app_settings` ops gates not in admin UI (`APP-OPS`: `close_charge_enabled`,
  `campaign_holds_enabled`, coverage thresholds, dkim_*). *Where:* form-map §B.
- **NEEDS-RECONCILE — `APP-ORD-1`.** Audit said orders have no creation path; but `orders.ts` is
  read-only and the agreement-signing flow writes order rows (form-map §A.18). Verify the pay surface
  is reachable before treating as a gap.

---

## 3. The bridge plan as a dependency graph (arming order, NOT severity)

Each tier must be whole before the next gate is flipped. Read top-to-bottom; the **gate lines** are
hard preconditions.

```
TIER A — make the loop exist (no gates flipped; outreach stays OFF)
  A1 OB-RSVP    public RSVP route + page            → NEW src/app/r/[token] (only genuinely-new home)
  A2 OB-RPC-*   harden get_rsvp_by_token + submit_rsvp (DROP+CREATE, §5) — approval-gated migration
  A3 OB-SEND    personalize send: pass body param + URL-button RSVP-link token
  A4 OB-ATT     inbound records attendance into guests (+ OB-ATT2 event binding)
  A5 APP-ORPH   event_questions authoring + RSVP render; rsvp_responses surfaced
  A6 APP-CAMP-1 add requireOwnedEvent gate to settle (trivial, do-early — §6)

        ════ GATE 1: do NOT enable consent capture until A1–A4 are verified ════

TIER B — capture consent (arms the send path on purpose)
  B1 OB-CONSENT recorded, channel-specific consent UI/flow → calls existing recordWhatsAppConsent()
  B2            verify frozen-set snapshot fires at hold step (§1 caveat)
  B3 OB-HOLD-REL release J5 hold on close/no-charge

        ════ GATE 2: do NOT set close_charge_enabled=true until A6 + B3 verified ════

TIER C — turn on settlement
  C1 APP-PKG    packages outcome-billing fields editable in admin
  C2 APP-OPS    ops gates (close_charge_enabled, thresholds, dkim_*) in admin UI
  C3 APP-AUTH-1 password recovery flow
  C4 APP-ORD-1  reconcile order creation/pay reachability

  flip close_charge_enabled → settlement live
```

Severity says "fix consent first (crit)"; the graph says consent is **B1**, after the entire RSVP
loop, because flipping it early arms broken sends. That inversion is the point of this section.

---

## 4. Per-bridge detail — every bridge names the EXISTING file it extends

| ID | Bridge | EXISTING file(s) to extend (reuse, don't duplicate) |
|---|---|---|
| A1 OB-RSVP | RSVP route + page | **NEW** `src/app/r/[token]/page.tsx` (no existing home; matches route-group convention). Reuse `forms.tsx`, `result.ts` FormState, `src/lib/security/rate-limit.ts`, `guests.ts` reader pattern |
| A2 OB-RPC | data-layer caller for the RPCs | **NEW** `src/lib/data/rsvp.ts` (`getRsvpByToken`, `submitRsvp`) — thin callers; RPC bodies hardened via migration. Reuse `createAdminClient` not needed (RPCs are SECURITY DEFINER, call via anon/cookie client) |
| A3 OB-SEND | personalized send | **EXTEND** `src/lib/whatsapp/client.ts` `sendWhatsAppTemplate` (add components arg) + `src/lib/data/outreach.ts` `sendOneWhatsApp` (build per-guest link from `rsvp_token`) + `message-templates.ts` (param mapping) |
| A4 OB-ATT | inbound → attendance | **EXTEND** `src/app/api/webhooks/whatsapp/route.ts` + `outreach-engine.ts` `writeReach` to also map the contact→guest and write `guests.status`/`confirmed_*` (reuse the same RPC-dedup discipline) |
| A5 APP-ORPH | event_questions | **EXTEND** event-detail area (owner authoring form, reuse `guest-form` pattern) + render on A1's RSVP page |
| A6 APP-CAMP-1 | settle ownership gate | **EXTEND** `campaign-actions.ts:214` `settleCampaignAction` — add `requireOwnedEvent(campaign.event_id)` (existing helper) |
| B1 OB-CONSENT | consent capture | **CALL** existing `recordWhatsAppConsent()` (`contacts.ts:245`) from a recorded consent action (import flow / guest add) |
| B3 OB-HOLD-REL | hold release | **EXTEND** the close transition (`campaigns.ts` / `close-charge.ts`) to release the J5 hold |
| C1 APP-PKG | package billing fields | **EXTEND** `admin/packages/package-form` + `packageBaseSchema` + `data/admin/packages.ts` (form-map §D.1) |
| C2 APP-OPS | ops gates UI | **EXTEND** `admin/settings/settings-form` / `admin/channels` + their schemas (form-map §D.4) |
| C3 APP-AUTH-1 | password recovery | **NEW** `src/app/auth/reset/` + `update-password` — reuse auth `actions.ts`, `forms.tsx`, add `redirectTo` to `resetPasswordForEmail` |

---

## 5. RSVP-plan correction — the RPCs ALREADY EXIST (fix/harden, don't create)

`plans/public-rsvp-implementation.md` (lines 54/56/67) treats `submit_rsvp` and the token reader as
**new**. Both already exist on the live DB (verified bodies). The plan must change from *create* to
*harden in place*:

- **`get_rsvp_by_token(_token text)`** — exists, `STABLE SECURITY DEFINER`, anon-executable, returns
  guest{...}+event{...}. **Add** expiry/status/revocation gating and trim PII to the minimum the page
  needs (`OB-RPC-READ`).
- **`submit_rsvp(_token, _attending, _adults, _kids, _meal, _note)`** — exists, `SECURITY DEFINER`,
  anon-executable. **Add** deadline/status gate, count bounds, idempotency (`OB-RPC-WRITE`).

> ⚠ **Duplication trap (advisor-flagged):** `CREATE OR REPLACE FUNCTION` **cannot change the argument
> signature** — adding `_extras jsonb` would create a *second* `submit_rsvp` overload and call-ambiguity
> (the exact duplication we forbid). Two clean options:
> 1. `DROP FUNCTION submit_rsvp(text,boolean,integer,integer,text,text)` then `CREATE` the new 7-arg
>    version (single signature), **or**
> 2. keep the existing 6-arg signature and handle `event_questions` answers via a **separate**
>    `submit_rsvp_answers(_token, _answers jsonb)` call.
> Decide before writing the migration. Either way: one function per signature, approval-gated migration
> ([[supabase-live-schema]]).

---

## 6. CAMP-1 — do-early, trivial fix (latent-critical)

`settleCampaignAction` (`campaign-actions.ts:214-242`) calls `closeCampaignAndCharge(campaignId)` with
**no own ownership gate**. Inside `close-charge.ts:55-61`, when `campaign.status==='closed'` the code
*skips* `closeCampaign` — which is the only place ownership (`requireOwnedEvent`) is enforced. So a
second settle on an already-closed campaign reaches the charge path unauthenticated (server actions are
POST endpoints any authenticated session can hit by action ID).

- **Severity:** critical-class IDOR, but **dormant** — `close_charge_enabled=false` makes
  `closeCampaignAndCharge` return `disabled` before any charge. Latent until Gate 2 flips.
- **Fix (trivial, do-early in Tier A):** add `await requireOwnedEvent(campaign.event_id)` at the top of
  `settleCampaignAction` (load the campaign first), **and/or** add the same gate inside
  `closeCampaignAndCharge` *before* the charge, not only inside `closeCampaign`. Existing helper; no new
  file. Land it before the close-charge gate is ever flipped.

---

## 7. Recommendations needing the user's explicit approval

Nothing below is done in this document — each needs a yes:

1. **Set `outreach_enabled=false`** now (reversible single config row) → deliberate safety while the
   send flow is incomplete. *Currently safe only by accident (§0).*
2. **Approval-gated migration** for A2 (RPC hardening) — read+write RSVP RPCs are a public security
   surface; plan + risks per CLAUDE.md before any DB change.
3. **Do not flip `close_charge_enabled=true`** until A6 (CAMP-1) and B3 (hold release) are verified
   (Gate 2).
4. **Do not enable consent capture (B1)** until A1–A4 verified (Gate 1).
5. WhatsApp template to Meta (TaskList #3) stays **blocked on your approval**; the URL-button decision is
   tied to A1 (the RSVP page the button links to). Payload shown before any submission.

---

## 8. Verification (per tier, before flipping its gate)

- Each tier: `npm run lint`, `npx tsc --noEmit`, `next build --webpack` ([[build-webpack-not-found-fix]]),
  focused vitest, then the gate's manual E2E.
- **Gate 1 E2E:** a real token opens the RSVP page; submit writes `guests.status`/`confirmed_*` +
  `rsvp_responses`; an inbound quick-reply records attendance on the right event; expired/revoked token
  returns a generic error; anon cannot read another guest.
- **Gate 2 E2E:** settle on an already-closed campaign by a non-owner session is rejected (CAMP-1);
  J5 hold is released on close/no-charge; double-settle does not double-charge (idempotency).
- **Security review** each tier vs the public-RSVP + authorization checklists in CLAUDE.md.

---

*Folds in: the two adversarially-verified audits (OB-* / APP-*), `plans/form-table-wiring-map.md`,
`plans/public-rsvp-implementation.md` (to be corrected per §5), and live-state introspection. Every
bridge names the existing file it extends ([[reuse-existing-no-duplication]]); no business facts are
hardcoded ([[no-hardcoded-business-facts]]).*
