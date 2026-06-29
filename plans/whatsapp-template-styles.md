# WhatsApp RSVP Template Styles — Submission-Ready Designs (DESIGN ONLY)

> Scope: DESIGN ONLY. Nothing here was submitted to Meta, no Graph API call was
> made, no message was sent, and no secret/token was read. This is the input for a
> later, separately-approved submission step against WABA `990921550130385`.
>
> Grounding: every structural fact (caps, example shapes, button rules, webhook
> button-tap shape, category rules) comes from
> `plans/whatsapp-templates-research.md` (live-fetched official Meta docs, §0/§4/§9/
> §13/§16). The send-path facts come from reading the code directly:
> - `src/lib/whatsapp/client.ts` — `sendWhatsAppTemplate` builds
>   `new Template(name, new Language(language))` with **NO components**. So any
>   template whose body has variables CANNOT be sent by the current code.
> - `src/lib/data/outreach.ts` — `sendOneWhatsApp` passes only
>   `{ to, templateName, language }`; it has `campaign.event_id` + `contact` but
>   does NOT load event name/host/date.
> - `src/lib/data/message-templates.ts` — `getTemplateByKey(message_key)` resolves
>   ONE **active** row per key to `{ name, language, channel }`, fail-closed.
>
> **Graph API version**: project pins **v23.0** (`src/lib/whatsapp/*`). Create
> endpoint: `POST https://graph.facebook.com/v23.0/{WABA_ID}/message_templates`.

---

## Definitions used below

- **Option A** = sendable by the CURRENT `client.ts` UNCHANGED (zero body variables;
  `new Template(name, language)` is enough).
- **Option B** = requires the `client.ts` (+ usually `outreach.ts`) change to thread
  `BodyComponent`/`BodyParameter`s — i.e. the body has `{{…}}` variables.
- **"Reached" mapping**: a tap on a template QUICK_REPLY arrives as an inbound webhook
  `messages[].type:"button"` with `button.text` = the tapped label and `context.id` =
  the wamid of the template we sent (research §13). With no `PayloadComponent`,
  `button.payload` == `button.text`. **Any** tap (מגיע / לא מגיע / אולי) = reached.
- **`he`** is the correct language code (the `message_templates.language` column defaults
  to `'he'`; the approved template MUST be created as `he` to resolve).
- Naming convention follows the existing live grounding: `kalfa_` prefix + purpose +
  `_he`. `(name, language)` is the unique key per WABA — two templates can never share a
  name, which is why the marketing/utility invites have distinct names even though their
  intent overlaps.
- The `message_templates.body` column is admin display/reference only; the **authoritative**
  body is the `text` in the create-JSON below. When wiring a row, paste the same Hebrew
  `text` into `body` for the admin UI.

---

## Style 1 — `kalfa_rsvp_invite_he` (MARKETING, zero-param) — THE FIRST SHIP

The cold RSVP invite, "safe" category. Business-initiated + an invitation = textbook
MARKETING (research §2/§16.2 — the iPlan competitor evidence shows their RSVP invite is
classed MARKETING). Choosing MARKETING up front avoids the `INCORRECT_CATEGORY` rejection
that a UTILITY submission of a cold invite would risk (`allow_category_change` discontinued
2025-04-09 → wrong category = REJECTED, hurts standing).

- **name**: `kalfa_rsvp_invite_he`  ·  **category**: `MARKETING`  ·  **language**: `he`
- **parameter_format**: n/a (no variables)
- **Option A** — sendable by current `client.ts` UNCHANGED.
- **Maps to**: `message_templates` row `message_key='invite'`, `channel='whatsapp'`,
  `name='kalfa_rsvp_invite_he'`, `language='he'`, `active=true` (set active ONLY after Meta
  returns `APPROVED`). `getTemplateByKey('invite')` then resolves it, fail-closed.
- **Rejection risk**: **LOW**. Correct category, no variables, no media, clean copy.

**Hebrew body (no variables):**
> היי 🎉
> קיבלתם הזמנה לאירוע משמח, ואנחנו נרגשים לחגוג יחד אתכם!
> נשמח לדעת אם נראה אתכם שם — בחרו אחת מהאפשרויות למטה:

**FOOTER** (optional but recommended, ≤60): `מערכת ההזמנות של KALFA`

**COMPLETE create-JSON (POST verbatim):**
```json
{
  "name": "kalfa_rsvp_invite_he",
  "language": "he",
  "category": "MARKETING",
  "components": [
    {
      "type": "BODY",
      "text": "היי 🎉\nקיבלתם הזמנה לאירוע משמח, ואנחנו נרגשים לחגוג יחד אתכם!\nנשמח לדעת אם נראה אתכם שם — בחרו אחת מהאפשרויות למטה:"
    },
    {
      "type": "FOOTER",
      "text": "מערכת ההזמנות של KALFA"
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "מגיע" },
        { "type": "QUICK_REPLY", "text": "לא מגיע" },
        { "type": "QUICK_REPLY", "text": "אולי" }
      ]
    }
  ]
}
```
> Even-safer minimal variant: drop the FOOTER component entirely (the research §Option-A
> payload). The FOOTER adds polish at ~zero risk; keep it.

**Send (current code, unchanged):** `new Template("kalfa_rsvp_invite_he", new Language("he"))`.

**Button-tap → "reached" mapping:** match on `button.text` — `מגיע`→attending, `לא מגיע`→not
attending, `אולי`→maybe. Any tap = reached. (No `PayloadComponent` sent, so `payload` mirrors
the label.)

---

## Style 2 — `kalfa_rsvp_invite_utility_he` (UTILITY, zero-param) — THE EXPERIMENT

Same use-case as Style 1 but submitted as UTILITY to **test** whether Meta will accept an
event-RSVP as a utility message. Copy is deliberately drier/transactional (framed as a
required status update, no "invitation/celebration" language) to give UTILITY its best chance.

- **name**: `kalfa_rsvp_invite_utility_he`  ·  **category**: `UTILITY`  ·  **language**: `he`
- **parameter_format**: n/a
- **Option A** — sendable by current `client.ts` UNCHANGED.
- **Maps to**: NOT wired by default. It is a research artifact. It could only take
  `message_key='invite'` as an A/B swap (and only ONE active row resolves per key, so it is
  mutually exclusive with Style 1). Do NOT set active unless deliberately A/B testing.
- **Rejection risk**: **HIGH**, two independent reasons:
  1. **Category**: a cold first-touch to a host-added guest is business-initiated → Meta is
     likely to classify it MARKETING regardless of wording → `INCORRECT_CATEGORY` /
     `TAG_CONTENT_MISMATCH` REJECTED. No silent re-category (2025-04-09).
  2. **Duplicate content**: it is intent-adjacent to Style 1. Submitting both to a fresh WABA
     risks duplicate-flagging. **Never submit Style 1 and Style 2 together.**

**Hebrew body (no variables):**
> שלום, נדרש עדכון סטטוס הגעה לאירוע שאליו הוזמנתם.
> כדי לעדכן את הסטטוס שלכם, בחרו אחת מהאפשרויות למטה:

**COMPLETE create-JSON (POST verbatim — but see "do not ship first"):**
```json
{
  "name": "kalfa_rsvp_invite_utility_he",
  "language": "he",
  "category": "UTILITY",
  "components": [
    {
      "type": "BODY",
      "text": "שלום, נדרש עדכון סטטוס הגעה לאירוע שאליו הוזמנתם.\nכדי לעדכן את הסטטוס שלכם, בחרו אחת מהאפשרויות למטה:"
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "מגיע" },
        { "type": "QUICK_REPLY", "text": "לא מגיע" },
        { "type": "QUICK_REPLY", "text": "אולי" }
      ]
    }
  ]
}
```
No FOOTER here, to keep it textually distinct from Style 1 (reduces duplicate-flag overlap).

**Send (current code, unchanged):** `new Template("kalfa_rsvp_invite_utility_he", new Language("he"))`.

**Button-tap → "reached" mapping:** identical to Style 1 (`button.text`).

**Verdict:** valuable as a single, deliberate UTILITY-acceptance probe — but it costs account
standing if rejected. Recommend SKIP or DEFER (see submission order). Style 1 already gives a
working invite.

---

## Style 3 — `kalfa_rsvp_confirmation_he` (UTILITY, zero-param) — POST-RESPONSE ACK

Sent AFTER a guest responds (taps a button on the invite), inside the 24h customer-service
window. This is genuinely **user-triggered** and tied to a specific, already-agreed
interaction → a **strong, honest UTILITY fit**, and it is **free when sent in-window**.

- **name**: `kalfa_rsvp_confirmation_he`  ·  **category**: `UTILITY`  ·  **language**: `he`
- **parameter_format**: n/a (zero-param primary; single-named-var variant noted below)
- **Option A for `client.ts`** (zero variables → sendable unchanged) — **BUT** it has **no
  caller yet**: nothing triggers a confirmation on inbound. It requires the **B2 inbound
  webhook handler** (separate, not-yet-built task) to decide "guest responded → send
  confirmation." So: no code change to `client.ts`, but a new trigger must exist.
- **Maps to**: a NEW `message_templates` row, a NEW `message_key` (e.g. `'confirmation'` /
  `'rsvp_received'` — confirm with the lead). NOT `'invite'`.
- **Rejection risk**: **LOW**. Strongest UTILITY fit of the set; no duplicate overlap with the
  invites (different purpose + content).

**Hebrew body (no variables) — one generic confirmation:**
> תודה רבה! ✅
> אישור ההגעה שלכם נקלט במערכת. נתראה באירוע!

**FOOTER** (optional, ≤60): `מערכת ההזמנות של KALFA`

**COMPLETE create-JSON (POST verbatim):**
```json
{
  "name": "kalfa_rsvp_confirmation_he",
  "language": "he",
  "category": "UTILITY",
  "components": [
    {
      "type": "BODY",
      "text": "תודה רבה! ✅\nאישור ההגעה שלכם נקלט במערכת. נתראה באירוע!"
    },
    {
      "type": "FOOTER",
      "text": "מערכת ההזמנות של KALFA"
    }
  ]
}
```
No buttons (a confirmation is a terminal acknowledgment — no reached signal needed; it IS the
response).

**Send (current code, unchanged):** `new Template("kalfa_rsvp_confirmation_he", new Language("he"))`.

**Button-tap → "reached" mapping:** n/a (no buttons).

**Variants (NOT for v1):**
- **Single named var** for warmth: body `"תודה רבה! ✅\nאישור ההגעה שלכם לאירוע {{event_name}}
  נקלט במערכת. נתראה!"`, `parameter_format:"NAMED"`,
  `example.body_text_named_params:[{"param_name":"event_name","example":"בר מצווה של איתי"}]`.
  This makes it **Option B** (needs the `client.ts` change). Keep zero-param for v1.
- **Three flavored confirmations** (attending / declined / maybe) for warmer copy — 3 separate
  templates. Out of scope for v1; one generic line is the simplest UTILITY-safe choice.
- **"Change my response"** affordance: a dynamic URL button to `r/[token]` (the web RSVP). That
  needs a per-guest token suffix (`url` with trailing `{{1}}`) → Option B for the button. Defer.

---

## Style 4 — `kalfa_rsvp_invite_personalized_he` (MARKETING, NAMED params) — THE PRODUCTION INVITE

The real product invite: personalized with the guest's name, host/family, event name, and
date, using **NAMED** parameters. Still a cold, business-initiated invitation → **MARKETING**
(personalization does NOT make it utility). Showcases the NAMED example shape (array of
`{param_name, example}`, research §4.2/§15.1) and respects the **adjacency rule** (no two
variables adjacent — every `{{…}}` is surrounded by Hebrew text; research §9 confirms a real
`INVALID_FORMAT` rejection for adjacent params).

- **name**: `kalfa_rsvp_invite_personalized_he`  ·  **category**: `MARKETING`  ·  **language**: `he`
- **parameter_format**: `NAMED`
- **Option B** — **requires code changes** (see chain below). This is a LATER style, NOT first.
- **Maps to**: `message_key='invite'`, swapping the active row from Style 1 →
  Style 4 once the code change ships. (Same key; only one active at a time.)
- **Rejection risk**: **LOW–MEDIUM**. Category is correct (MARKETING). The only structural risk
  is the adjacency rule, which the copy satisfies. Personalized invites can draw slightly more
  reviewer scrutiny than a generic one, hence not LOW-LOW.

**Named params** (lowercase + `_`, ≤20 chars each):
- `{{guest_name}}` — the invited guest (e.g. "דנה")
- `{{host_name}}` — host / family (e.g. "כהן")
- `{{event_name}}` — event (e.g. "בר מצווה של איתי")
- `{{event_date}}` — server-formatted date string (e.g. "12/07/2026")

**Hebrew body (adjacency-safe — Hebrew text between every variable):**
> שלום {{guest_name}}! 🎉
> משפחת {{host_name}} שמחה להזמין אתכם לאירוע {{event_name}}.
> האירוע יתקיים בתאריך {{event_date}}.
> נשמח לאישור הגעה — בחרו אחת מהאפשרויות למטה:

**FOOTER** (optional, ≤60): `מערכת ההזמנות של KALFA`

**COMPLETE create-JSON (POST verbatim):**
```json
{
  "name": "kalfa_rsvp_invite_personalized_he",
  "language": "he",
  "category": "MARKETING",
  "parameter_format": "NAMED",
  "components": [
    {
      "type": "BODY",
      "text": "שלום {{guest_name}}! 🎉\nמשפחת {{host_name}} שמחה להזמין אתכם לאירוע {{event_name}}.\nהאירוע יתקיים בתאריך {{event_date}}.\nנשמח לאישור הגעה — בחרו אחת מהאפשרויות למטה:",
      "example": {
        "body_text_named_params": [
          { "param_name": "guest_name", "example": "דנה" },
          { "param_name": "host_name", "example": "כהן" },
          { "param_name": "event_name", "example": "בר מצווה של איתי" },
          { "param_name": "event_date", "example": "12/07/2026" }
        ]
      }
    },
    {
      "type": "FOOTER",
      "text": "מערכת ההזמנות של KALFA"
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "מגיע" },
        { "type": "QUICK_REPLY", "text": "לא מגיע" },
        { "type": "QUICK_REPLY", "text": "אולי" }
      ]
    }
  ]
}
```

**Send (AFTER the code change):**
```ts
new Template(
  "kalfa_rsvp_invite_personalized_he",
  new Language("he"),
  new BodyComponent(
    new BodyParameter(guestName, "guest_name"),
    new BodyParameter(hostName,  "host_name"),
    new BodyParameter(eventName, "event_name"),
    new BodyParameter(eventDate, "event_date"),
  ),
);
```

**Button-tap → "reached" mapping:** same as Style 1 (`button.text`). Optionally attach stable
ASCII payloads via `PayloadComponent("rsvp_yes"|"rsvp_no"|"rsvp_maybe")` in button index order
so the inbound webhook carries label-independent `button.payload`.

**What must change for Style 4 (the full Option-B chain):**
1. **`src/lib/whatsapp/client.ts`** — extend `sendWhatsAppTemplate`'s `params` to accept
   `bodyParams` (and optional `buttonPayloads`), import `BodyComponent`/`BodyParameter` (and
   `PayloadComponent`) from `whatsapp-api-js/messages`, and build
   `new Template(name, new Language(language), new BodyComponent(...named BodyParameters), ...payloadComponents)`.
   **The single most important change.**
2. **`src/lib/data/outreach.ts`** — `sendOneWhatsApp` must load the event (name, host/family,
   `event_date`) and pass them as `bodyParams`. `sendCampaignWhatsApp` already has
   `campaign.event_id`; add ONE `events` fetch before the contact loop and thread values in.
3. **Date formatting** — `events.event_date` is `timestamptz` (project schema note); format on
   the server (`toLocaleDateString('he-IL')` or a slice), never pass a raw ISO timestamp.
4. **`getTemplateByKey`** needs no change (variable values are not template metadata).

> A POSITIONAL alternative to Style 4 already exists in the research doc (§Option B,
> `kalfa_rsvp_invite_he` with `{{1}}/{{2}}/{{3}}`). NAMED (this style) is more self-documenting
> and order-independent at send time, at the cost of slightly more verbose `BodyParameter`
> calls. Pick ONE personalization style — do not submit both POSITIONAL and NAMED personalized
> invites (duplicate content + only one active row per key anyway).

---

## Summary table

| Style | name | category | param | Option | Risk | Wired today? |
|---|---|---|---|---|---|---|
| 1 Invite (safe) | `kalfa_rsvp_invite_he` | MARKETING | none | A | **LOW** | Yes → `message_key='invite'` |
| 2 Invite (utility probe) | `kalfa_rsvp_invite_utility_he` | UTILITY | none | A | **HIGH** | No (experiment) |
| 3 Confirmation | `kalfa_rsvp_confirmation_he` | UTILITY | none | A (needs B2 trigger) | **LOW** | No (new key + B2 webhook) |
| 4 Invite (personalized) | `kalfa_rsvp_invite_personalized_he` | MARKETING | NAMED | **B** | LOW–MEDIUM | No (needs client.ts + outreach.ts) |

---

## Recommended submission ORDER + first-batch size

**First batch = 1 template: Style 1 (`kalfa_rsvp_invite_he`).**

Reasoning: the WABA `990921550130385` is fresh — standing matters. Submitting several
near-identical templates at once risks duplicate-flagging and INCORRECT_CATEGORY rejections that
lower standing. Style 1 is Option A (zero code change), correct category (LOW risk), and proves
the entire pipeline create → approve → send → inbound button webhook → "reached" with zero
engineering. This honors both the previous researcher's "ship one first" advice AND the user's
"several styles" request — the several styles are designed and ready; we just submit them in a
deliberate sequence rather than all at once.

**Then, in order:**
2. **Style 3 (`kalfa_rsvp_confirmation_he`)** — submit once the **B2 inbound webhook** work is
   underway (it needs a trigger to be useful). Strong UTILITY fit, no duplicate overlap with
   Style 1, and free in-window. Safe to submit early; just not useful until B2 exists.
3. **Style 4 (`kalfa_rsvp_invite_personalized_he`)** — implement the `client.ts` + `outreach.ts`
   Option-B chain, then submit. On approval, swap `message_key='invite'` active row Style 1 →
   Style 4. This is the production invite.
4. **Style 2 (`kalfa_rsvp_invite_utility_he`)** — LAST and OPTIONAL. Only if you actively want
   the UTILITY-acceptance data, submitted ALONE (never with Style 1), accepting a likely
   `INCORRECT_CATEGORY` rejection. Recommend **SKIP** unless the category question must be
   answered empirically — Style 1 already gives a working invite and Style 3 gives the
   legitimate UTILITY message.

**First-batch size: 1.** Never co-submit Style 1 + Style 2 (duplicate-flag + category-cost).

---

## Open questions for the lead (decide before submitting)

1. **Confirmation message_key**: Style 3 needs a NEW `message_templates` row + a new
   `message_key` (`'confirmation'`? `'rsvp_received'`?). Confirm the key name and that the table
   enforces ONE active row per `(message_key, channel)` (so the invite/utility variants are
   correctly mutually exclusive).
2. **FOOTER brand text**: is `מערכת ההזמנות של KALFA` acceptable? Note the per-event venue/host
   brand CANNOT go in the footer (footers allow no variables); a venue-specific footer would
   require a parameter, which footers don't support — so it stays static.
3. **Button labels & gender**: labels are `מגיע / לא מגיע / אולי` (masculine singular), kept
   consistent with the research §13 reached-mapping. A gender-neutral alternative is
   `אגיע / לא אגיע / אולי` (first-person future). If changed, the §13 webhook match strings must
   change in lockstep. Confirm which to lock in BEFORE first approval (labels are baked into the
   approved template).
4. **Personalization style for the production invite**: NAMED (Style 4) vs the research's
   POSITIONAL Option B — both valid, pick ONE. Recommend NAMED (self-documenting).
5. **Run the UTILITY probe (Style 2) at all?** It costs standing if rejected. Recommend skipping
   unless you specifically want the category answer.
6. **WABA standing prerequisites** (out of template scope, affects deliverability/limits): is the
   display name `APPROVED` and is OBA / business verification pursued? Until then recipients see
   "נשלח באמצעות {provider}" (research §16.1). Not blocking submission, but worth tracking.
