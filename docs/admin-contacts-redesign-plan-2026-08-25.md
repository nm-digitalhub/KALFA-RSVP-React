# Admin Contacts Redesign + Inquiry Lifecycle Automation — Plan (2026-08-25)

Status: **PLAN ONLY — no code changes made.** Per standing instruction for this workstream
("אל תבצע שום שינוי לפני שאתה מציג לי תוכנית מסודרת"), nothing below is implemented until
explicitly approved. Basis: two parallel code/DB audits (2026-08-25), one live-mailbox
research pass (Voximplant's own support-ticket lifecycle, read via Graph from
`netanel.kalfa@kalfa.me`), one live-DB fact-finding pass, one shadcn/reui registry check,
and one advisor alignment pass. All file:line references below are read-verified, not
inferred.

## 0. What this plan covers, in the order the user asked for it

1. Two small, independent bug fixes (§1).
2. A change to what "closing" an inquiry means, replacing immediate auto-close-on-reply
   with a Voximplant-style silence cascade (§2–§4).
3. A responsive master-detail redesign of `/admin/contacts`, updated to surface every new
   piece of state §2–§4 introduce (§5) — this is the "align all the changes" pass the user
   asked for explicitly.
4. Full DB schema, kill-switch, security, and compliance sections needed to ship §2–§4
   safely (§6–§9).
5. What was found but is explicitly out of scope (§10).
6. Suggested build order + verification (§11).

---

## 1. Two independent bug fixes

### 1.1 Cancelled inquiry still shows a reply composer

- **UI** (`src/app/(admin)/admin/contacts/page.tsx:94-121`): `<ContactReplyForm>` renders
  whenever `msg.email` exists, with no `status` check. Fix: when `status === 'cancelled'`,
  render the AI-draft box (if `draft_reply` exists) **read-only**, with a note
  ("הפנייה בוטלה — לא נשלח מענה"), and never render the reply form itself. This matters
  concretely: the one `cancelled` row in the live DB today *has* an AI draft
  (verified via live query) — hiding it entirely would silently lose it, not just gate it.
- **Server** (`src/lib/data/admin/contacts.ts` `sendInquiryReply`, currently
  `select('email, name')` at line ~136): widen to `select('email, name, status')` and throw
  a safe Hebrew error if `status === 'cancelled'`. This is not cosmetic: today a successful
  send on a cancelled row **resurrects it to `done`** (the function sets `status:'done'`
  unconditionally on success), which is worse than the missing UI guard alone.
- **Test**: `src/lib/data/admin/contacts.test.ts:196-270` — mock's `.select()` ignores its
  argument, so widening the real `.select()` call doesn't break the 4 existing cases (their
  `status` stays `undefined`, which is `!== 'cancelled'`). Add one new case: `status:
  'cancelled'` → `sendInquiryReply` rejects.

### 1.2 "reopened" status shows the raw English string

`src/app/(admin)/admin/contacts/contact-status-form.tsx:40` (fallback branch for a status
outside the admin-settable set) renders `{currentStatus}` raw instead of calling
`contactStatusLabel(currentStatus)`, which already has the Hebrew label ("נפתחה מחדש") in
`CONTACT_ONLY_STATUS_LABELS` (`src/lib/data/admin/labels.ts:115-116`). One-line fix.

---

## 2. Changing what "closing" means

### 2.1 Current behavior (to be replaced)

`sendInquiryReply` (`contacts.ts:192-203`) sets `status:'done', handled_at:now`
**unconditionally** on every successful send, regardless of whether the admin expects the
customer to respond further. This is the root of the "done conflates resolved vs.
awaiting-customer" concern the user raised, and — independently verified via live mailbox
research — is not how any real support desk behaves. Voximplant's own support flow
(22 emails read from `support@voximplant.com`, 4 full ticket lifecycles, 2026-04 through
2026-08) never closes on an agent reply either; closing is either customer-initiated or
silence-driven.

### 2.2 New behavior

`sendInquiryReply` no longer sets `status:'done'`. Instead:

- If the row's current status is `new` or `reopened` → advance to `in_progress`.
- If it is already `in_progress` → leave it (a second reply mid-conversation doesn't change
  state).
- `handled_at` is **not** touched by this function any more — it becomes exclusively the
  terminal-status signal `updateContactStatus` already computes it as
  (`terminal = status==='done'||status==='cancelled'`, `contacts.ts:103`).
- `done` becomes reachable only two ways: an admin explicitly picks it in the status
  dropdown, or the new auto-close sweep (§3) reaches it after a full silence window.

This is safe against the fleet trigger without any fleet-side change: `support-drafter`'s
reactive trigger and read query both key on `status='new' AND draft_reply IS NULL`
(`scheduler.mjs:194-197`, `support-drafter.md:27`) — `in_progress` was never in that set, so
this change is invisible to the drafter.

**Alignment check — `handled_at` consumers** (grepped repo-wide, not inferred): exactly
three call sites read it, all already accounted for above — `page.tsx:125` (display, will
now correctly stay empty until a real terminal state), `contacts.ts:106`
(`updateContactStatus`, unaffected), and `contacts.ts:198` (`sendInquiryReply`, the one
line being removed). No dashboard, report, or fleet role reads `handled_at`.

---

## 3. Silence cascade — reminder, warning, auto-close

Timing mirrors Voximplant's observed cadence exactly (measured across all 4 ticket
lifecycles in the mailbox research, not estimated):

```
admin reply (replied_at = T0, status stays in_progress)
   │
   ├─ T0 + 24h silence  → reminder email #1 ("still need help? just reply")
   ├─ T0 + 72h silence  → reminder email #2 / final warning ("closing soon unless you reply")
   └─ T0 + 96h silence  → auto-close: status → done, auto_closed_at = now
                           → rating request email sent (§4)
```

"Silence" is derived **only** from `replied_at`, gated by `status = 'in_progress'` — not
from `last_activity_at` (which `sendInquiryReply` also bumps, so it never actually reveals
silence) and not by inventing a new heuristic. The gate is structurally self-cleaning: any
customer reply runs `attachReplyToInquiry` (`inquiry-mail-intake.ts:218-261`), which sets
`status:'reopened'` unconditionally — the row leaves `in_progress` the instant the customer
responds, so the sweep's `WHERE status='in_progress'` clause already excludes it. No new
"has the customer replied" check is needed.

### 3.1 Eligibility (mirrors `listDueThankyouCampaigns`, `auto-thankyou.ts:29-60`)

```
status = 'in_progress'
AND email IS NOT NULL                      -- can't email a phone-only inquiry
AND replied_at IS NOT NULL
AND (next stage's sent_at column) IS NULL  -- not already sent for this stage
AND now - replied_at >= (stage threshold)
```

Phone-only inquiries (`email IS NULL`) are excluded from the whole cascade — they neither
get reminded nor auto-closed by it, and stay exactly as they behave today (admin closes them
manually). Worth a one-line confirmation from the owner during review, not a blocker.

Per `auto-thankyou.ts`'s own signature (`listDueThankyouCampaigns(admin, nowMs =
Date.now())`), the eligibility function takes an injectable `nowMs` — required for the
cascade to be unit-testable without waiting 96 real hours.

### 3.2 New columns on `contact_messages` (additive, nullable, no CHECK constraints added)

| column | type | written by |
|---|---|---|
| `reminder_sent_at` | timestamptz null | sweep, stage 1 |
| `closing_warning_sent_at` | timestamptz null | sweep, stage 2 |
| `auto_closed_at` | timestamptz null | sweep, stage 3 — **distinguishes auto-close from a manual `done`**, which the redesigned UI needs to show (§5) |
| `rating_token` | text null, unique | sweep, stage 3 (generated once, with the rating email) |
| `rating_requested_at` | timestamptz null | sweep, stage 3 — idempotency guard for the rating email itself |
| `rating_score` | smallint null | public `/rate/[token]` submit |
| `rating_comment` | text null | public `/rate/[token]` submit |
| `rating_at` | timestamptz null | public `/rate/[token]` submit |

All eight are optional columns on the existing row, matching how `draft_reply` /
`draft_created_at` / `sent_reply` / `replied_at` already live flat on this same table — no
new table earns its cost here (a rating-history table would only be justified if the owner
wants multiple ratings per inquiry over time, which nothing so far asks for).

### 3.3 Sweep implementation (mirrors `auto-thankyou.ts` + `worker/main.ts:958` exactly)

New `src/lib/data/inquiry-followup.ts`: `listDueForReminder`, `listDueForWarning`,
`listDueForAutoClose`, each idempotency-guarded on its own `*_at` column, marked processed
**only after a confirmed non-blocked send** — same discipline as
`markThankyouProcessed`/`runThankyouSweep`'s blocked-vs-failed distinction
(`auto-thankyou.ts:81-89`). Registered in `worker/main.ts` as
`boss.schedule(QUEUES.inquiryFollowupSweep, '*/5 * * * *')`, same cadence as the existing
sweeps.

**Gate — not `getOutreachEnabled()`.** That switch is the campaign/WhatsApp master kill
switch; wiring inquiry follow-ups to it means an unrelated campaign incident silently stops
support reminders, with no way to disable one without the other. `app_settings.email_enabled`
is also wrong — that would kill agreement mail and inquiry replies too. This needs its own
flag: `app_settings.inquiry_followup_enabled boolean not null default false`. Per
[[kill-switches-need-admin-ui-not-db-only]] (owner ruling 22.8: a DB column alone is not
"done"), the plan includes the toggle itself, not just the column: a new switch in
`src/app/(admin)/admin/settings/settings-form.tsx`, next to the existing `email_enabled`
toggle at line 218-219, wired through the same `settings-form.tsx` / `actions.ts` pair.
Defaults to **off** — the first real send is owner-triggered, per
[[user-runs-platform-commands]].

---

## 4. Rating request email + `/rate/[token]` page

### 4.1 Compliance — two separate gates, not one

The reminder email (§3, stages 1–2) rests on the same precedent already shipping today:
`inquiryReplyEmail`'s own comment, `templates.ts:53-54` — *"Transactional/responsive — the
recipient initiated the conversation by submitting the form."* A reminder on a thread the
customer opened, before it's closed, is squarely inside that precedent.

The **rating request** is weaker: it fires *after* the thread is closed, and asks for
something for KALFA's benefit rather than answering the customer's own question. Israeli
spam law's "דבר פרסומת" test is broad. **Plan and build both emails together; gate only the
rating email's first real send behind an `israeli-compliance-advisor` sign-off.** This
doesn't block writing the code or reviewing this plan — it blocks flipping
`inquiry_followup_enabled` in a way that lets rating emails actually go out, which is one
line of admin-UI copy work either way.

### 4.2 Email content

New template `templates.ts` `ratingRequestEmail()`, cloned from `inquiryReplyEmail`'s exact
shell (same RTL structure, same signature block, same escaping discipline). Three emoji
links (😕 😐 😊 — unicode, not SVG: email clients don't reliably render inline SVG, confirmed
via mockup research), each a plain link to `/rate/{token}?score={1|2|3}` — no JS, no tracking
pixel.

### 4.3 `/rate/[token]` — new public token surface, security spec

This is a new anonymous, token-gated public route, so it inherits the project's Public RSVP
Security rules even though it isn't RSVP:

- **Token**: `randomBytes(16).toString('hex')` — the project's established 128-bit standard
  (`rsvp-links.ts:79`, mirrored exactly, not invented).
- **The page renders nothing identifying.** No customer name, no inquiry subject, no email —
  only "Rate the service you received" and the 3-icon picker + optional comment. The token
  resolves the inquiry **server-side only**; nothing about the inquiry's content is exposed
  to the browser. This keeps the page out of the PII-behind-bearer-token class entirely.
- **Re-submittable, not single-use**: a customer changing their mind (clicking 😊 then
  wanting to add a comment later) should still work; `rating_score`/`rating_comment` are
  simply overwritten, `rating_at` updated. No expiry beyond the token existing at all — a
  stale rating link doing nothing surprising is preferable to a confusing "expired" state for
  a low-stakes CSAT click.
- **Generic errors**: invalid/unknown token → the same generic not-found treatment already
  established for public tokens elsewhere, never a distinguishing error.
- **Rate limiting**: same class of protection already required for public mutation endpoints
  under "Public RSVP Security" — reuse the existing rate-limit primitive
  ([[reuse-existing-no-duplication]]), not a new one.
- Icons on this page (unlike the email) are **lucide-react** `Frown` / `Meh` / `Smile`
  (verified present in the installed `lucide-react` version, same icon family already used
  by `not-found.tsx`'s `MailQuestionMark`), colored via the existing `--destructive` /
  `--warning` / `--success` tokens — not raw emoji, which don't carry brand color.

### 4.4 UI building blocks (shadcn/reui — verified, not guessed)

Confirmed live against the project's configured registries (`@shadcn`, `@reui`) and the
installed `components.json` (`base-nova` / Base UI, no Radix):

- `@reui/c-rating-9` ("Rating with review text input") is shadcn's own composition for
  exactly this shape — `Card` + rating control + adaptive feedback copy + `Textarea` + a
  submit `Button` disabled until a value is picked — built entirely from `Button`/`Card`/
  `Textarea`, all three already present in `src/components/ui/`. Only `Label` needs adding
  (`npx shadcn add label` — zero Radix dependency, confirmed).
- `@reui/c-rating-8` ("Emoji reaction rating") is shadcn's own preset for icon/emoji-style
  sentiment picking — plain `<button>` elements, no dedicated primitive, `class-variance-
  authority` only. This **is** "the shadcn built-in answer" for this shape (confirmed
  against reui.io's own docs: their Rating component's star-based API is for continuous/
  half-star values; the officially documented emoji variant is described as "for informal
  feedback, satisfaction surveys" — literally this use case).
- Combine both: `c-rating-9`'s shell, with `c-rating-8`'s button pattern swapped from emoji
  to the three lucide icons above.
- A working visual mockup of the email + page exists:
  https://claude.ai/code/artifact/846b86d5-218d-48ef-b9c6-0fac64df5b86

---

## 5. Redesigned `/admin/contacts` — updated to display everything §2–§4 add

This supersedes the earlier "idle badge" idea floated mid-conversation: that was a UI-only
silence timer, proposed *before* real reminder emails and auto-close were in scope. Building
both would be two competing signals for the same thing — the badge below **is** the cascade
state, not a parallel guess at it.

### 5.1 Architecture (unchanged from the earlier design pass, still correct)

`/admin/contacts?id=<uuid>` — selection via query param on the same route, not a
`/admin/contacts/[id]` sub-route. This keeps `actions.ts`'s two existing
`revalidatePath('/admin/contacts')` calls (lines 44, 75) correct with zero changes, and
matches the `q=`/`status=` convention already used by `/admin/users` and
`/admin/voice/console-history`.

- **Desktop**: list pane + detail pane side by side.
- **Mobile**: single pane, `useIsMobile()`-driven — list by default, detail when `id` is
  present, back clears it. Reuses the same responsive precedent `sidebar.tsx` already
  implements; no new primitive needed for the split itself.
- **List pane**: search (`q=`), status-filter pills with a real per-status color map
  (today every status renders the same badge color — `page.tsx:68` — fixed here following
  `console-history`'s `STATUS_VARIANT` pattern), sort by `last_activity_at` (existing
  default).
- **Perf**: `listInquiryMessages` narrows to the selected `id` only, not every row on the
  page (today it loads the full thread for every visible inquiry).
- `ContactReplyForm` keyed on `id` so `useActionState` resets between selections.

### 5.2 New state the detail (and list) pane must surface — this is the alignment ask

| state | where shown | source |
|---|---|---|
| Cascade stage (waiting / reminder sent / final warning sent / auto-closed) | small badge, list row + detail header | derived from `reminder_sent_at` / `closing_warning_sent_at` / `auto_closed_at` — no new column needed for the label itself |
| Auto-closed vs. manually closed `done` | detail header, next to the status control | `auto_closed_at IS NOT NULL` |
| Rating result (score + optional comment) | detail pane, below the message thread, once received | `rating_score` / `rating_comment` / `rating_at` |
| "Rating requested, not yet answered" | quiet note in detail pane | `rating_requested_at IS NOT NULL AND rating_at IS NULL` |

None of this needs new list-view columns beyond the cascade-stage badge — the rating result
only matters once someone opens the detail pane, consistent with the "don't show everything
at once" principle from the original redesign spec.

---

## 6. Fix list, complete

1. §1.1 — cancelled-inquiry reply-form bug (UI + server).
2. §1.2 — `reopened` raw-string label bug.
3. §2 — `sendInquiryReply` stops setting `done`; sets `in_progress` instead.
4. §3 — new sweep (`inquiry-followup.ts`) + 8 new columns + `inquiry_followup_enabled` flag
   + admin settings toggle.
5. §4 — `ratingRequestEmail()` template + `/rate/[token]` page + rate-limit wiring.
6. §5 — master-detail redesign, including the new cascade/rating state.

---

## 7. Found during audits, explicitly out of scope for this round

- **`support-drafter`'s `reopened` wake-path gap**: the write-path (`fleet-agent-cli.ts:
  1113-1119`) correctly supports drafting for a `reopened` inquiry, but nothing wakes it —
  neither the reactive trigger (`scheduler.mjs:194-197`, keys only on `status='new'`) nor the
  role's own scheduled read query (`support-drafter.md:27`). Verified this has never actually
  fired: 0 rows have ever reached `reopened` in the live DB, and both `source='outlook'` rows
  predate the migration that added the comparison logic — so this is a latent gap, not a live
  bug. Fix lives in `.claude/fleet/**`, which is **owner-only**; this plan reports it, does
  not fix it.
- **No CHECK constraint on `contact_messages.status`** — free text today, enforced only by
  four independent app-layer write paths. Worth a separate migration if the owner wants it;
  not bundled here since it's unrelated to the redesign and touches production DDL on its
  own.
- **Stale RLS comment** — `contacts.ts:15` still says access is authorized by the
  `cm_admin_all` RLS policy, which was deliberately dropped 2026-07-20 (Step 3, staff-axis
  removal). Actual authorization today is `requirePlatformPermission('view_customer_data')`
  + service-role, RLS is pure deny-by-default backstop. One-line comment fix, bundle with
  §1 since it's in a file already being touched.

---

## 8. Suggested build order

1. §1 (bug fixes) — smallest, independent, ship first.
2. §6 schema migration (8 columns + `inquiry_followup_enabled`) — additive, low-risk on its
   own.
3. §2 (`sendInquiryReply` behavior change) — depends on nothing else, but should land before
   the sweep so `in_progress` rows actually exist for it to find.
4. §3 sweep + admin toggle (default off) — safe to deploy dark; the toggle stays off until
   explicitly armed.
5. §4 rating email + `/rate/[token]` — gate the *sending* behind compliance sign-off, not the
   build.
6. §5 UI redesign — last, since it's the one piece that benefits from all prior state
   actually existing to display.

## 9. Verification

Static gates (`tsc`, `eslint`, unit tests with injected `nowMs` for the cascade) run locally.
No dev server, no ad-hoc scripts. First real deploy and the first real
`inquiry_followup_enabled` flip are owner-triggered via `!` per
[[user-runs-platform-commands]]; verification after that is against **live beta**, not a
local run.
