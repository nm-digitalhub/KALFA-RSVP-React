# Provider config admin forms — fields + UI/UX (the "C0" gap)

> Answers: (1) exactly which fields each provider form needs for END-TO-END wiring, verified against LIVE docs (Meta WhatsApp Cloud API + Voximplant via Context7) and the existing config readers; (2) how to build the additions UI/UX-wise, matching the established admin pattern. The config COLUMNS for WhatsApp already exist (0028); Voximplant's are authored in C2's migration. What's missing is the ADMIN UI to populate them.

## Established pattern to mirror (verified in code)
`src/lib/data/admin/settings.ts` + `/admin/settings` + `/admin/company`: app_settings singleton (admin-only RLS); secrets (`sumit_api_key`, `extra_sms_token`, `smtp_password`) are **stored in columns, shown MASKED with a reveal toggle**, prefilled, every save submits all fields, `'' → null`. Per-channel **enable toggle** (`payments_enabled`/`sms_enabled`/`email_enabled`). Server page (`requireAdmin`) → client form (`useActionState`+`FormState`) → action (Zod → update → `revalidatePath`). Shared `forms.tsx` + admin `_components` (`PageHeading`/`Badge`) + RTL. Env-only infra shows **presence-only** (`configured: true/false`). The provider forms follow this EXACTLY.

---

## 1. WhatsApp (Meta Cloud API) — fields for precise wiring
Consumers today: `getWhatsAppConfig` (phoneNumberId, accessToken, appSecret, verifyToken), `whatsapp/client.ts` (send), `api/webhooks/whatsapp/route.ts` (verify+inbound). Meta docs (`developers.facebook.com/.../whatsapp/get-started`) confirm the credential set.

| Field (column) | Purpose | Status | UX note |
|---|---|---|---|
| `whatsapp_phone_number_id` | the Business **Phone Number ID** (send endpoint `/{id}/messages`) | ✅ exists | plain text |
| `whatsapp_access_token` | Bearer token | ✅ exists | **SECRET (mask+reveal)**. Helper: "**Permanent System-User token**, not the 24h temp token — perms: `whatsapp_business_messaging` + `whatsapp_business_management` + `business_management`." |
| `whatsapp_business_account_id` (WABA) | template list/sync, account scoping | ⚠️ **ADD** | plain text. Meta: "save the WhatsApp Business Account ID for API calls." Needed for template management/sync (not for sending a pre-approved template by name) |
| `whatsapp_app_secret` | webhook `X-Hub-Signature-256` HMAC | ✅ exists | **SECRET (mask+reveal)** |
| `whatsapp_verify_token` | webhook GET challenge (admin-chosen) | ✅ exists | text; admin invents it, then pastes into Meta |
| `whatsapp_graph_version` (opt) | Graph API version (docs show v23.0) | ⏸ optional | lib-managed today; add only if pinning is needed |
| `whatsapp_enabled` (opt sub-flag) | channel on/off under `outreach_enabled` | ⏸ optional | parity with Voximplant's sub-flag; today WhatsApp gates on config-presence + `outreach_enabled` |

**DISPLAY (read-only, copyable — the wiring the admin must paste INTO Meta):**
- **Webhook callback URL** = `${APP_ORIGIN}/api/webhooks/whatsapp` (copy button).
- The **verify token** value (copy button) → Meta App → WhatsApp → Configuration → Webhook.
- A **"Test connection"** action → server action `GET https://graph.facebook.com/v23.0/{phone_number_id}?fields=display_phone_number` with the token → shows ✓/✗ + the resolved number (validates token+phone without sending).

---

## 2. Voximplant (AI calls) — fields (C2 migration cols; verified vs Voximplant docs)
Voximplant docs confirm: `StartScenarios` auth = `account_id` + `api_key`; `rule_id` = application rule → scenario; `caller_id` = purchased/verified number. C2 spec's `app_settings` columns + tuning:

| Field (column) | Purpose | Kind |
|---|---|---|
| `voximplant_enabled` | sub-flag under `outreach_enabled` | toggle |
| `voximplant_account_id` | Management API account | text |
| `voximplant_api_key` | StartScenarios auth | **SECRET (mask+reveal)** |
| `voximplant_rule_id` | application rule → outbound scenario | text |
| `voximplant_caller_id` | purchased/verified caller id | text + helper "must be a Voximplant-purchased/verified number" |
| `voximplant_callback_secret` | HMAC for the result callback (lives in the scenario SECRET, NOT script_custom_data) | **SECRET (mask+reveal)** |
| **Tuning (D3, admin-config):** `call_amd_enabled` (toggle) · `call_asr_model` · `call_asr_language` (default he-IL) · `call_asr_min_confidence` (number, model-scale) · `call_min_utterance_ms` (number) · `call_dtmf_reach_keys` (text) | what counts as a billable human reach | inputs + **HelpTip** each |

**DISPLAY (read-only, copyable):** the **callback URL** the scenario posts results to = `${APP_ORIGIN}/api/webhooks/voximplant`; the `callback_secret` to embed in the Voximplant scenario SECRET. **"Test connection"** → a Management API `GetAccountInfo`/account ping with account_id+api_key → ✓/✗.
> Consent/DNC (`contacts.call_consent_at`, `call_dnc_list`) are data managed elsewhere (per-contact + a DNC list screen), NOT this credentials form.

---

## 3. UI/UX design (how to build the additions)
**Location — recommend a dedicated `/admin/channels`** (nav "ערוצי תקשורת"): groups the guest-OUTREACH providers (WhatsApp + Voximplant) under the shared `outreach_enabled` master, distinct from the billing/SMS/email infra already in `/admin/settings`. (Alternative: add two sections to `/admin/settings` — same singleton/pattern — if a separate page feels heavy. Either is consistent.)

**Per-provider CARD (top→bottom), each a clear section:**
1. **Header + status badge** — provider name + `Badge`: `מחובר` (min creds present) / `לא מוגדר` / `כבוי`. Plus the **enable toggle** (gated: can't enable without the minimum creds; enabling while `outreach_enabled` is off shows "המתג הראשי כבוי").
2. **Credentials** — masked secret inputs (reveal toggle, reuse the existing settings pattern) + plain inputs; helper text on token type (the System-User-token note is load-bearing — wrong token type is the #1 wiring failure).
3. **Webhook wiring** — read-only callback URL + verify/callback secret with **copy buttons**, and a numbered "paste these into Meta/Voximplant" mini-guide. This closes the loop the admin can't see otherwise.
4. **Tuning** (Voximplant only) — number/toggle inputs for the D3 thresholds, each with a **HelpTip** (reuse `src/app/(admin)/admin/agreement/help-tip.tsx`, click/tap Base UI Popover) explaining the billing impact.
5. **Test connection** — a button → server action that pings the provider read-only; inline ✓/✗ + message. Lets the admin verify BEFORE enabling live sends.

**Cross-cutting UX:**
- **Secrets:** never rendered unmasked by default; reveal is per-field; values sent only to this `requireAdmin` HTTPS page; never logged. Empty submit keeps `null` (intentional unset) — same as settings.
- **Safety of enabling:** turning a channel ON = live, paid sends to real guests → a **confirm step** + a visible reminder that the global `outreach_enabled` master must also be on. Show "last verified" from a successful test.
- **Stack:** server page `requireAdmin` → `getWhatsAppAdminConfig()` / `getVoximplantAdminConfig()` (new, settings.ts-style, masked-safe) → client form `useActionState`+`FormState` → action (Zod, required-when-enabling) → `updateProviderConfig` → `revalidatePath`. Shared `forms.tsx` (`SubmitButton`/`FieldError`/`FormError`/`FormNotice`), admin `_components`, `ui/*`. **RTL + a11y**: logical properties, copy buttons with `aria-label`, masked-reveal keyboard-accessible, visible focus.
- **No hardcoded business facts** ([[no-hardcoded-business-facts]]): thresholds/keys are DB config read server-side, never constants.

## Build placement
A small **phase "C0 — provider config UI"** BEFORE go-live of either channel: WhatsApp form ([מרחיב] data layer + [יוצר] `/admin/channels` page/form/action; add `whatsapp_business_account_id` column) can ship now (cols exist). The Voximplant card ships WITH C2 (its migration adds the cols). Both reuse the one `/admin/channels` shell.

---

## 4. UI library + anti-clutter layout (DECIDED: Tabs + Accordion)
**Library decision — stay within the existing stack, NO new dependency.** Stack = `@base-ui/react ^1.6` (headless, Radix/Floating-UI/MUI team) + Tailwind v4 + cva/`cn` + lucide. `src/components/ui/*` already wraps Base UI (tooltip/dropdown/sheet). Base UI provides Tabs, Accordion, Collapsible + `DirectionProvider` (RTL already mounted in app-shell). Do NOT add Radix/Headless UI/MUI-styled (duplication; RTL already solved).
- **[יוצר]** `src/components/ui/tabs.tsx` + `src/components/ui/accordion.tsx` — thin Base UI wrappers, modelled on the existing `ui/tooltip.tsx`/`ui/dropdown-menu.tsx` (cva variants, `cn`, forwardRef). Reusable later by the Phase-3 lifecycle UI too.
- Reuse `help-tip.tsx` (Base UI Popover, click/tap) for the tuning explanations — info on demand, not a wall of inline text.

**Layout — Tabs (provider) + Accordion (sections), to avoid an overloaded page:**
- **Top: provider Tabs** — `[ WhatsApp ✓ ] [ Voximplant ⚠ ]` — only ONE provider's config is rendered at a time. Tab label carries a status glyph (✓ מחובר / ⚠ לא מוגדר / ○ כבוי).
- **Card header (always visible):** status badge + the enable toggle (gated). The common case (already configured) is a one-glance read, not a field wall.
- **Body: Accordion sections** — `פרטי התחברות` OPEN by default; `חיווט Webhook` + `כיוונון מתקדם` (Voximplant) COLLAPSED. The admin expands wiring/tuning only when needed.
- **Footer:** `בדיקת חיבור` action.
- RTL: Accordion/Tabs are inline (not portaled) → DirectionProvider + logical Tailwind properties suffice; the chevron flips with `dir`. a11y: tabs are roving-tabindex + the accordion triggers are buttons (keyboard + visible focus), copy buttons get `aria-label`.

This keeps the dense field set (2 providers × creds+webhook+tuning+test) to a calm, progressive surface: one provider, one open section, advanced hidden until asked.
