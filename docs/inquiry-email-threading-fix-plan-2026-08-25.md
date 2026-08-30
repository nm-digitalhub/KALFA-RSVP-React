# Inquiry Email Thread-Continuity Fix — Plan (2026-08-25)

Status: **PLAN ONLY — no code changes made.** Per standing instruction for this session
("תקרא ותלמד את אופן היישום הנדרש" / "must plan, read, learn, write a precise plan"),
nothing below is implemented until explicitly approved.

## 0. The problem (verified)

The inquiry follow-up cascade shipped earlier today (§3/§6 of
`docs/admin-contacts-redesign-plan-2026-08-25.md`) sends up to 4 emails per inquiry:
admin reply, reminder, closing warning, rating request. All 4 go out via
`getEmailSender()` (`src/lib/email/sender.ts`)'s configured transport, never through the
M365 mailbox's own send path. *(Correction — independent audit 2026-08-25, PARTIALLY
TRUE: the earlier draft said "all 4 go out via Resend," stating a live config gate as if
it were a code invariant. `selectedEmailProvider()`'s actual default is `smtp`;
`EMAIL_PROVIDER=resend` is a deployment setting, not something guaranteed by the code
itself. Whichever transport is active, both `resendSender` and `smtpSender` are edited
identically in §2.4/§3.1, so this correction doesn't change the design — only the
framing of this opening paragraph.)* Inbound customer
replies are matched back to a `contact_messages` row purely by
`thread_id = mail.conversationId` (`src/lib/data/inquiry-mail-intake.ts:95-106`), with
**no fallback** — a miss silently creates a brand-new, disconnected inquiry instead of
reopening the existing one (`intakeMailAsInquiry`'s upsert path).

Verified risk factors (read from live docs and live code, not assumed):

1. **Subject lines differ across all 4 templates** (`src/lib/email/templates.ts:145,244,277,321`)
   — none share text, none are prefixed "Re:". Microsoft's own conversation-threading
   guidance confirms a changed subject gets a **new** `ConversationTopic`/`ConversationIndex`
   (Microsoft Q&A: [conversation id changes after editing subject](https://learn.microsoft.com/en-us/answers/questions/1194303/conversation-id-changes-after-editing-subject)).
2. **Exchange's threading signal (`Thread-Index`/`conversationIndex`) is a proprietary
   MAPI property, and setting it is documented as the mail *client's* responsibility —
   not an Exchange-exclusive guarantee.** *(Correction — independent audit 2026-08-25,
   REFUTED: the original wording here, "only exists on messages that passed through
   Exchange," overstated this. Microsoft's own Tracking Conversations page states
   plainly "It is a **client's** responsibility to set PR_CONVERSATION_INDEX," not
   Exchange's alone. Corrected here; the practical conclusion below is unaffected —
   KALFA's outbound mail never passes through any mail client that would set this
   property either way.)* KALFA's outbound mail is sent externally via Resend/SMTP and
   never lands in the mailbox's own Sent Items, so no client — Outlook or otherwise —
   ever sets this property on KALFA's own sends. Exchange has nothing to anchor a reply
   to via this path (Microsoft Q&A: [conversationId changes when external party replies](https://learn.microsoft.com/en-au/answers/questions/5883983/microsoft-graph-webhook-conversationid-changes-whe)).
   Confirmed against Microsoft's own primary MAPI spec, not just community Q&A: a
   message store provider (Exchange) "has the option of assuring that
   **PR_CONVERSATION_INDEX** is always set on incoming or outgoing messages... by
   calling **ScCreateConversationIndex**, either with the existing value if this
   property is set **or with NULL if it is not**" — i.e. Exchange manufactures a
   *fresh* conversation index for a message with none, rather than failing to assign
   one ([PidTagConversationIndex](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/pidtagconversationindex-canonical-property)).
   The real fallback grouping key at that point is **PR_CONVERSATION_TOPIC** (the
   normalized subject) — Tracking Conversations §5 documents grouping recipients "by
   PR_CONVERSATION_TOPIC first" when no conversation index links them
   ([Tracking Conversations](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/tracking-conversations)).
   *(Citation correction — independent audit 2026-08-25, REFUTED: an earlier draft
   attributed a different quote — "sorted on this property to reveal the hierarchical
   relationship of the messages" — to this same Tracking Conversations page. That exact
   phrase in fact appears on the PidTagConversationIndex page above, describing the case
   where a conversation index *does* exist — the inverse of what it was cited here to
   support. The substantive claim itself — topic as the fallback grouping key — still
   holds and is now sourced correctly to Tracking Conversations §5 above; only the
   misattributed quote was removed.)*
   This sharpens, not weakens, the case for `ref_code`: topic-matching only works
   against a message that's actually *sitting in the mailbox* already carrying that
   topic. For a web-form-originated inquiry there never was one (the customer's first
   message never touched Exchange either) — confirmed live, see the box below. For a
   mail-originated inquiry, the original customer email IS in the mailbox, but KALFA's
   own reply/reminder/warning/rating subjects deliberately don't repeat the customer's
   original subject text (§2.2 uses a fixed constant) — so even topic-matching has
   nothing of KALFA's own to anchor to, since none of KALFA's sent messages ever
   entered Exchange to begin with, under either origin.

   > **Live-verified, not theoretical** (2026-08-25, this session): a real reminder
   > email (pre-fix, current production subject) was replied to from
   > `admin@nm-digitalhub.com` at 13:53 UTC. The reply landed in the mailbox correctly,
   > but `intakeMailAsInquiry`'s existing `conversationId` match failed exactly as this
   > section predicts — it created a brand-new, disconnected inquiry (`42194bf7-...`)
   > instead of reopening the original (`b033f8ef-...`, `source: 'contact_form'`,
   > `thread_id: null`, confirmed via direct query before and after). This is the
   > plan's own root-cause diagnosis, reproduced live, not inferred from docs alone.
3. **`src/lib/email/sender.ts` sets no `In-Reply-To`/`References` headers at all**, on
   any of the 4 templates — verified by reading `resendSender`/`smtpSender` in full.

Industry practice for exactly this situation (external sender, no control over the
receiving mailbox's internals) was researched across several support-desk vendors.
**Correction — independent audit 2026-08-25 checked every vendor citation below against
the actual source pages and refuted both citation-based claims as originally worded**
(the third bullet, live mailbox evidence, was independently confirmed and needed no
correction). The
design conclusion is unaffected — it does not depend on these vendor citations, only on
the live-verified incident (box above) and the correctly-cited Microsoft MAPI docs — but
the claims themselves are corrected here rather than left standing:

- **Zendesk** documents an ID embedded in the message **body** (its own worked example
  is an encoded ID such as `[1G7EOR-0Q2J]`), not primarily the subject line, and
  describes three matching signals — a subject-line ticket number, `References`/
  `In-Reply-To` headers, and the body-embedded ID — without stating a priority order
  among them; in its Side Conversations feature the body-token is checked *before* the
  header, the opposite of the "token-first, headers-as-fallback" order this section
  originally claimed. **Freshdesk**'s cited article documents only the subject-line
  ticket-ID convention; it does not mention `In-Reply-To`/`References`/RFC-header
  matching anywhere (confirmed by a full-text search of the page), so "header-based
  matching as a fallback" was not something either source actually stated. *(REFUTED,
  independent audit 2026-08-25 — checked via full-text extraction of both pages.)* —
  [Zendesk: how incoming emails
  are threaded](https://support.zendesk.com/hc/en-us/articles/8396827889946-How-are-incoming-emails-threaded-to-tickets),
  [Freshdesk: ticket ID in subject](https://support.freshdesk.com/support/solutions/articles/191769-customizing-email-subject-in-tickets).
- **Salesforce Lightning** email-to-case threading was described here as explicitly
  **token-in-subject first, RFC headers second** ("Thread-Topic... is why it's used as a
  last resort"). *(REFUTED, independent audit 2026-08-25: this exact quote does not
  appear in either Salesforce source page checked — verified via full-text extraction of
  both, ~5.6K characters each, zero matches. "Thread-Topic" is a Microsoft/MAPI term, not
  a Salesforce one; likely a citation mix-up with this same plan's Microsoft research
  above. Salesforce's actual documented direction is closer to the opposite of what was
  claimed: newer Salesforce threading *combines* signals rather than leading with a
  subject token, with the older token-only approach described as "maintenance-only
  mode.")* This bullet added no support beyond what the live Voximplant evidence below
  already demonstrates, and is dropped rather than re-sourced.
- **Live evidence from this tenant's own mailbox** (read via Graph, `netanel.kalfa@kalfa.me`,
  search `"voximplant"`): Voximplant's own support desk does exactly this — every message
  in a ticket thread repeats the identical subject text with an embedded ticket number,
  e.g. `[#413379] RE: Urgent investigation request regarding unusual incoming call
  activity(387)`, `REMINDER: Urgent investigation request...(387)`, and the CSAT request
  itself quotes the same text: `Rate your support experience on your ticket "Urgent
  investigation request...(387)"`. **This live, first-party observation — not the vendor
  citations above — is the strongest support this section actually has**, and on its own
  is sufficient to motivate the subject-token design below.

**Conclusion**: a subject-embedded reference token is the primary, most reliable fix.
*(This conclusion does not rest on the vendor citations corrected above — independent
audit 2026-08-25 confirmed it rests on the live-verified incident and the correctly-cited
Microsoft MAPI documentation instead.)*
`In-Reply-To`/`References` headers (confirmed available on both transports — Resend via
its `headers` object per [Resend's own reply-threading guide](https://resend.com/docs/dashboard/receiving/reply-to-emails);
nodemailer via dedicated `inReplyTo`/`references` message properties, **not** via its
generic `headers` object, which nodemailer explicitly forbids for these fields) are set
on every outbound send as a defense-in-depth signal for the **customer's own mail
client** (so KALFA's messages visually thread even if a gateway mangles the subject).
**They are not, in this plan, a second automated matching tier** — `findExistingInquiry`
never reads them back on intake. See §2.4 for the exact scope of what "defense in depth"
means here, and why closing that gap fully is left as follow-up (§6).

## 1. Rejected design: sequential ticket number

First draft of this plan used a simple incrementing integer (mirroring Voximplant's own
`#413379`-style numbers literally). **Rejected on user's explicit security objection**:
a sequential number is guessable/enumerable, and every other customer-facing identifier
in this codebase (`rating_token`, RSVP tokens, gift tokens) is `randomBytes`-based for
exactly this reason. Adopting a sequential id here would be the one inconsistent,
weaker identifier in an otherwise consistent security posture.

`ref_code`, as specified in §2.1, is still `randomBytes`-based and therefore not
enumerable — but at 32 bits it is deliberately far weaker than the 96–256-bit tokens
cited above (`rating_token` is 128-bit). That gap is real, not an oversight this
rejection re-introduces by the back door; §2.1 states the exact number and the reason
it's an acceptable departure.

## 2. Design

### 2.1 Schema — new random reference column

Add `contact_messages.ref_code` — a short, random, unique, human-typeable reference:

- **Format, pinned exactly**: `upper(encode(gen_random_bytes(4), 'hex'))` — **8 uppercase
  hex characters, 32 bits of entropy**, e.g. `KLF-7F2A91B4`. (Earlier drafts of this plan
  said "~6-7 characters" while the SQL always produces 8 — that inconsistency is fixed
  everywhere below: prose, examples, and the matching regex all now say 8.)
- **Deliberately weaker than `rating_token`** (`randomBytes(16)`, 128-bit — see
  `20260825124143_contact_messages_rating_schema.sql:56`), and weaker than RSVP/gift
  tokens (96–256-bit). This is an explicit, reasoned tradeoff, not a silent departure
  from this codebase's usual convention: `ref_code` is **never trusted alone**.
  `findExistingInquiry` (§2.3/§2.5) requires a `ref_code` match **and** a matching
  sender email before treating it as a hit — unlike `rating_token`, which is a sole
  bearer credential in a public URL and therefore needs full 128-bit strength on its
  own. Recorded here so the gap is deliberate and documented, not an inconsistency a
  future reviewer has to rediscover. (Caveat, applies to the sender-email half of that
  AND-check on *either* matching tier: `mail.fromAddress` is Graph's parsed
  `from.emailAddress.address` — an unauthenticated header value, not SPF/DKIM/DMARC-
  verified. The sender check raises the bar meaningfully; it is not cryptographic proof
  of identity. **Open, unconfirmed upside (independent audit 2026-08-25, §5 item 16)**:
  whether this M365 tenant's own Exchange Online Protection already rejects or flags a
  spoofed `From:` header before `fetchInboundMail` ever sees the message — if so, this
  check is stronger in practice than this paragraph alone credits it as being. Not
  verified either way from code; recorded as a possible upside to confirm, not assumed.)
- **Generated by a DB-side `DEFAULT`, not app-layer code** — this question is resolved,
  not left open. `contact_messages` has exactly two INSERT paths today —
  `insertContactMessage` (`src/lib/data/inquiry-intake.ts:84-96`, the public contact
  form) and the upsert inside `intakeMailAsInquiry`
  (`src/lib/data/inquiry-mail-intake.ts:108-126`) — confirmed exhaustive by the same
  write-path audit already on record in this table's own
  `20260825133136_contact_messages_status_check.sql` comment block. Neither inserts a
  `ref_code` value explicitly and neither is proposed for a code change: with a column
  `DEFAULT`, Postgres fills `ref_code` automatically on every new row regardless of
  which of the two paths (or any future third path) performs the insert. This is also
  why `ref_code` is `NOT NULL` rather than nullable-until-first-send like `rating_token`
  — unlike a rating request (only relevant at auto-close), `ref_code` must already be on
  the row before the very first outbound email (the initial admin reply) is sent, so
  "generate lazily on first send" is not an option here the way it is for
  `rating_token`.
- **Residual collision risk, accepted, not silently ignored**: at 32 bits, the DEFAULT
  expression has a non-zero (if small) chance of colliding with an existing `ref_code`
  on a given insert, which the `UNIQUE` constraint turns into an insert failure rather
  than silent data corruption. At this table's realistic scale (birthday-bound
  collision probability is roughly n²/2·2³², i.e. **0.0116%** at 1,000 lifetime rows —
  *independent audit 2026-08-25 recomputed this precisely; the earlier "≈0.01%" was a
  fine directional rounding, not a material error, and is replaced here with the exact
  figure* — rising sharply at larger scale, ~68.8% at 100,000 rows) this is treated as
  negligible today and left unhandled by retry logic — see §4 for the asymmetry between
  the two insert paths' failure behavior if it ever does happen, and §4.1 for whether to
  widen the byte count pre-emptively as a separate, not-yet-decided question.
- Backfilled once for the 8 existing rows via the same DEFAULT expression, before the
  column is made `NOT NULL` + `UNIQUE` (§2.5).
- Per project convention (hard rule from this session), authored via
  `supabase migration new <name>`, **never** hand-written, and **not applied** without
  explicit go-ahead — same process as today's `contact_messages_status_check` migration,
  including its idempotency-guard, `if not exists`, column-comment, and `-- Rollback:`
  conventions, all of which are now reflected in §2.5's SQL (an earlier draft of this
  plan's SQL sketch omitted all four; fixed below).

### 2.2 Subject-line convention (all outbound templates)

Every email on a given inquiry thread — admin reply, reminder, closing warning, rating
request — carries the **same subject text**, prefixed with the reference code in
brackets:

```
[KLF-7F2A91B4] תגובה לפנייתך — KALFA        ← first (admin reply)
Re: [KLF-7F2A91B4] תגובה לפנייתך — KALFA    ← reminder / warning / rating request
```

`Re:` goes at the **very front** of the string, before the bracket tag — not
`[KLF-...] Re: ...`. Two reasons: (1) Resend's own reply-threading guide (§2.4's source)
gives `subject: Re: ${event.data.subject}` as its one worked example — `Re:` first,
always, whenever `In-Reply-To` is set (no distinction between a genuine human reply and
an automated follow-up) — which is exactly this plan's situation for the
reminder/warning/rating templates. (2) *Correction — independent audit 2026-08-25,
REFUTED (found independently in two separate review passes): the original second reason
here claimed "most mail clients only check the very start of a subject for an existing
Re:... confirmed by re-reading the same live Resend doc." That confirmation does not
hold — the Resend doc cited in (1) says nothing about how mail clients detect an
existing `Re:` prefix; re-checked directly against the full live page text, with no such
content found.* The underlying design choice — `Re:` before the bracket tag, not after —
is still correct, on a better-grounded basis: RFC 5322 §3.6.5 states "only one instance
of 'Re: ' ought to be used," and putting `Re:` at the very front, rather than burying it
after an unfamiliar bracket token, is the conventional way client-side "already has a
Re:" detection is written to find it — a client's own collapsing logic is far more
likely to look at the start of the string than to skip past an unrecognized tag first.

Templates to change: `inquiryReplyEmail`, `inquiryReminderEmail`,
`inquiryClosingWarningEmail`, `inquiryRatingRequestEmail` — all in
`src/lib/email/templates.ts`, each needs `ref_code` threaded in as a new required input.

### 2.3 Matching logic — two-tier, both tiers sender-verified

`intakeMailAsInquiry` (`src/lib/data/inquiry-mail-intake.ts`) gets a new first check,
**before** the existing `conversationId` lookup — and the existing `conversationId`
check itself gains a verification it does not have today:

1. Parse `[KLF-XXXXXXXX]` out of the inbound subject (case-insensitive regex on
   `mail.subject`; normalize the captured code to uppercase before comparing, since the
   stored value is always uppercase per §2.1 but a mail client or gateway could
   plausibly re-case it in transit).
2. If found, look up `contact_messages` by `ref_code` — **and** verify
   `mail.fromAddress` matches the row's stored `email` (case-insensitive). A code match
   with a mismatched sender is treated as no-match — mirrors this codebase's existing
   "never trust a single weak signal" pattern (public-rsvp-sentinel convention) and
   specifically closes the spoofing gap: without this check, anyone who learned a
   `ref_code` (e.g. by forwarding one of their own emails) could inject a message into
   someone else's thread. **A mismatch itself is not silent**: fires a `level: 'warn'`
   Slack alert (`contactMessageId` only — never `mail.fromAddress` or the stored
   `email`, matching this file's existing PII-minimal alert payloads) before falling
   through to tier 2. This closes a gap the workflow's own adversarial review surfaced
   while checking (and refuting) an earlier, differently-framed finding about this same
   branch: the finding's PII-leak claim didn't hold up (the code never logged the
   addresses themselves), but the reviewer's own reframing — a possible spoofing
   attempt currently produces *zero* trace anywhere — was correct and, on inspection,
   the code hadn't actually been updated to add it. Fixed here.
3. If no subject token, or it doesn't match, or the sender mismatches — fall through to
   the `conversationId` check. **This tier gets the same comparison as tier 1** —
   `.select('id, email, status')`, require
   `data.email?.toLowerCase() === mail.fromAddress?.toLowerCase()` before treating it as
   a match — **but deliberately not the same response to a mismatch.** *(Correction —
   independent audit 2026-08-25, REFUTED: the earlier draft called the two checks
   "identical" without qualification, which is true of the comparison logic but not of
   what happens on a mismatch — tier 1 fires a `warn` Slack alert (point 2 above), tier 2
   does not. Corrected here to state the asymmetry explicitly and justify it, rather than
   leave "identical" standing uncorrected.)* The asymmetry is intentional, not an
   oversight: a `ref_code` match with a mismatched sender (tier 1) means someone
   presented a value meant to be a private-enough reference and got the identity wrong —
   worth a signal. A shared `conversationId` with a mismatched sender (tier 2) is the
   older, weaker signal to begin with, and far more likely to have a benign cause — a
   colleague cc'd on the thread, a forward, a shared mailbox — than an attempted spoof;
   alerting on every such case would make an already-noisier signal noisier still
   without a matching rise in actionable cases. Tier 2 still correctly refuses to attach
   on a mismatch (returns no match, falls through to the miss path in point 6 below) —
   just without a dedicated alert of its own. Earlier drafts of this plan left tier 2
   unchecked entirely, reasoning that §2.2's
   subject-unification would make it a "softer target" — that specific causal claim
   doesn't hold up (every subject still carries a distinct per-row `ref_code`, and
   Exchange/Outlook only strip known `Re:`/`Fwd:`-style prefixes, not bracket tokens, so
   collisions across *different* customers' threads aren't actually more likely after
   unification). The real reason to fix it is simpler: an unchecked `conversationId`
   match is a **pre-existing gap in the currently-live code**
   (`inquiry-mail-intake.ts:95-106`, unchanged by this plan until now) that lets an
   inbound message attach to any row sharing a `conversationId`, with zero identity
   check — and since this plan is already rewriting `findExistingInquiry` end to end,
   closing it costs one extra `email`/`status` column in the existing `select` and one
   comparison. There is no DB-level backstop for a wrong-row match either way:
   `createAdminClient()` is service-role and bypasses RLS, so the application-layer
   sender check is the only control on both tiers.
4. **Neither tier ever reopens a `cancelled` row.** `sendInquiryReply`
   (`src/lib/data/admin/contacts.ts:202-207`) already refuses to reply to a cancelled
   inquiry, with the explicit rationale "a cancelled inquiry is closed on purpose —
   sending a reply to it would... silently undo the cancellation." `attachReplyToInquiry`
   (`inquiry-mail-intake.ts:218-261`) has no equivalent guard today — it flips *any*
   matched row to `reopened` unconditionally. That's dormant risk today only because the
   unfixed `conversationId` fallback rarely matches at all for Resend-sent mail (§0);
   the `ref_code` tier is what makes a match — and therefore this gap — routinely
   reachable. Both `findExistingInquiry` branches now also select `status` and, on a
   match against a `cancelled` row, return a distinct "matched but cancelled" result
   instead of an id to reopen (concrete shape in §2.5). `attachReplyToInquiry` branches
   on that result: no status write, no cascade change, just a Slack alert with a title
   that's visually distinct from a normal reopen (`'לקוח הגיב לפנייה שבוטלה'` vs.
   `'לקוח הגיב לפנייה קיימת'`) so an admin who deliberately cancelled a case is not
   silently overruled by a stale reply. **Fixed, independent audit 2026-08-25 (table row
   3, CONFIRMED — one of four findings that blocked implementation until corrected)**:
   an earlier draft of `attachReplyToInquiry` returned this "skipped" result *before*
   writing the reply to `inquiry_messages` at all, so the customer's message content was
   permanently discarded on every reply to a cancelled inquiry — directly against this
   project's own auditability rule (CLAUDE.md: "Preserve auditability... Do not catch
   errors merely to ignore them"), and repeating on every subsequent reply on the same
   thread, not a one-off. The exact fix — moving the `inquiry_messages` insert ahead of
   this guard — is in §2.5's corrected code below. That insert is now the durable record
   of what happened; the Slack alert alone was never reliable enough to serve as one on
   its own (60-second dedup keyed on `level|title|source`, not `contactMessageId`, and
   `logOpsAlert` does not persist the `fields` payload — see §4 for both).
5. **A real reopen resets the follow-up cascade's own stamps.** `attachReplyToInquiry`'s
   update (`inquiry-mail-intake.ts:239-247`) today sets
   `status`/`reply_needed_at`/`last_activity_at`/`handled_at` but never touches
   `reminder_sent_at`, `closing_warning_sent_at`, `auto_closed_at`, or
   `rating_requested_at`/`rating_token`. Since `listDueForReminder`/`listDueForWarning`/
   `listDueForAutoClose` (`src/lib/data/inquiry-followup.ts:64-112`) all gate on the
   relevant stamp being `null`, a row that went through part or all of the cascade before
   being reopened would either skip straight to a later stage (partial cascade) or never
   re-enter the cascade at all (`auto_closed_at` already set — permanent exclusion,
   confirmed no other writer ever nulls it). This is the same "dormant until `ref_code`
   makes reopening common" situation as point 4. Fix, folded into the same update (exact
   diff in §2.5): on an actual reopen, null out `reminder_sent_at`,
   `closing_warning_sent_at`, `auto_closed_at`, `rating_requested_at`, **and**
   `rating_token` — the last two together, since they're the whole authorization pair
   for the public `/rate/[token]` page (`src/lib/data/inquiry-rating.ts:18-29,42-62`
   gates on `rating_token` match **and** `rating_requested_at is not null`; nulling one
   without the other just leaves a token whose gate is permanently shut, which fails
   closed but is untidy). **Do not** null `rating_score`, `rating_comment`, or
   `rating_at` — the rating-schema migration's own column comment
   (`20260825124143_..._rating_schema.sql:64`) states resubmission overwrites those in
   place by design, and a reply-triggered reopen unrelated to the rating itself
   shouldn't discard feedback the customer already gave. This is a considered choice
   (null-out on every reopen) over the alternative of keeping round-1's stamps and
   changing the three `listDueFor*` queries to gate on "stamp is null OR stamp predates
   `replied_at`" instead — the alternative preserves full cross-cycle audit history (the
   admin pane surfaces these stamps specifically to show cascade progress) at the cost of
   a less trivial `WHERE` clause; null-out was chosen for simplicity, and this tradeoff
   is recorded here rather than left implicit.
6. **When neither tier matches, distinguish "looks like an unmatched reply" from "really
   new."** Today, any miss falls straight through to the upsert-insert path
   (`inquiry-mail-intake.ts:108-158`) and fires the same generic
   `'פנייה חדשה בדואר'` Slack alert used for a genuinely new inquiry — indistinguishable
   from the residual failure mode this whole plan exists to shrink (a `ref_code` that
   got stripped/mangled in transit, on a thread where `conversationId` also never
   anchored). Before firing that alert, add one cheap, PII-minimal check: does another
   `contact_messages` row already exist with the same `email` (case-insensitive)?
   `mail.fromAddress` is already in hand at this point, so this needs no new Graph field.
   If a same-sender row exists, fire a `level: 'warn'` alert instead, with a distinct
   title (`'תגובה אפשרית לא שויכה — נפתחה פנייה חדשה'`) and only row ids in `fields` —
   never subject/sender/body, matching this file's existing alert-payload contract. This
   doesn't catch a genuinely fresh compose from a known customer (no signal could,
   without asking them), only the case that matters: a reply that should have matched
   and didn't. **Fixed, independent audit 2026-08-25 (table row 2, CONFIRMED — one of
   four findings that blocked implementation until corrected)**: this point's prose was
   the *only* description of this check anywhere in the plan — §3.1 separately claimed
   the concrete code for it was "already spelled out in §2.5," but no query, function
   signature, or exclusion logic for it actually appeared there. The `hasSameSenderInquiry`
   helper now added to §2.5 below is that missing code, closing the gap. It must also use
   a case-insensitive comparison correctly: `contact_messages.email` is **never**
   lowercased on write (`insertContactMessage` has no `.toLowerCase()` step, confirmed by
   reading its Zod schema and insert call), while `mail.fromAddress` always is — a naive
   `.eq('email', mail.fromAddress)` would silently miss a form submission entered as
   `Dana@Gmail.com`. §2.5's version uses `.ilike()` instead, with the address escaped
   first (`%`/`_` are wildcards under `ILIKE`, and `_` is a common, legal character in
   real email addresses — an unescaped comparison would over-match).
7. **Known unhandled edge case, flagged by independent audit 2026-08-25 — owner ruling
   obtained, see §4.1 point 1: accepted as-is, "a genuine edge case."** A legitimate
   customer who replies from a *different* address than the one on file (e.g. switching
   from a work inbox to a personal one mid-thread) is not served correctly by either
   tier as designed: tier 1 matches the `ref_code` but the sender check fails, firing
   the `warn`, spoofing-flavored alert from point 2 above against someone who did
   nothing wrong; tier 2 fails for the same reason. The reply falls through to the
   upsert-insert path and creates a new, disconnected inquiry — the exact failure mode
   this plan exists to fix, just triggered by a different, entirely innocent cause than
   §0's live incident. §2.1 already notes in general terms that the sender check "is
   not cryptographic proof of identity"; this is the concrete scenario where that
   caveat has a real cost to a real, non-malicious customer. Deliberately left
   unhandled per the owner's ruling — not a gap in this plan's execution.

### 2.4 Headers — outbound-only defense in depth (not a matching tier)

`src/lib/email/sender.ts`: `EmailSender.send()` gains optional `inReplyTo?: string` and
`references?: string[]`.

- `resendSender`: passed via `headers: { 'In-Reply-To': ..., 'References': ... }`
  (space-joined), per Resend's documented custom-headers support.
- `smtpSender`: passed as **dedicated** `inReplyTo`/`references` nodemailer message
  properties — verified nodemailer explicitly forbids setting these via its generic
  `headers` object.

Value: the most recent inbound `inquiry_messages.message_id` for that inquiry (already
stored, no new column needed). Only set when one exists — web-form-originated inquiries
have no email thread to reference, and get no headers (unchanged behavior for them).
*(Refined — independent audit 2026-08-25, PARTIALLY TRUE: "only set when one exists"
covers the case of a genuinely empty result correctly, but not a **failed** lookup — see
§2.5's `lastInbound`/`lastInboundMessageIds` fix, which now logs rather than silently
drops a query error, distinguishing "no prior inbound message" from "couldn't check."
Separately: for the reminder/warning/rating templates specifically, the semantically
"correct" parent to reference would arguably be the admin's own most recent reply, not
the customer's last inbound message — but capturing an outbound `Message-ID` at all is
not something this plan's design does (see below and §6), so the customer's last inbound
message is used as the best available anchor for all four templates. A real accumulating
chain is also not built here: every code path in §2.5/§3.1 sends `references` as a
single-element array (`references ?? [inReplyTo]`), never a growing list across
multiple replies on the same thread, because KALFA does not read incoming
`References`/`In-Reply-To` headers and does not persist its own outbound Message-ID.
This is syntactically valid against RFC 5322 (`1*msg-id` means "one or more," not "two
or more"), but weaker defense-in-depth than the Resend guide's own worked example, which
demonstrates appending to a growing list. Documented here as a known limitation of this
plan's outbound-only scope, not changed — closing it needs the outbound-Message-ID
capture work already tracked in §6.)*

**Scope, stated explicitly (this was previously overclaimed):** these headers are set on
**outbound sends only**. Nothing in `findExistingInquiry` (§2.3/§2.5) reads
`In-Reply-To`/`References` back on intake — the Graph `$select` in
`src/lib/microsoft/mail.ts:78` doesn't even fetch `internetMessageHeaders`, and
`InboundMail` (`mail.ts:46-63`) has no field for them. So in this plan, the headers help
the **customer's own mail client** display KALFA's messages as one thread (a real,
useful property — it's what makes the `Re:`-flavored subjects and grouped view a
customer sees in Gmail/Outlook actually work) but provide **zero automated matching
robustness** on the intake side; §0's "defense in depth" framing means this, not a
second server-side matching tier.

A genuine header-based fallback tier is a larger change than this plan takes on, for two
reasons worth recording rather than silently deferring: (1) it needs
`internetMessageHeaders` added to the Graph `$select` and parsed into `InboundMail`, and
a third lookup tier matching `inquiry_messages.message_id` against the inbound
`In-Reply-To`/`References` tokens; and (2) more importantly, KALFA's own *outbound*
Message-ID is never captured today — `sendInquiryReply`'s `inquiry_messages` insert
(`src/lib/data/admin/contacts.ts`) stores no `message_id` for outbound rows, so even
with (1) built, a customer's mail client citing KALFA's own message in `In-Reply-To`
(the common case for a direct reply) would have nothing to match against; only the
rarer case where a `References` chain still carries the *original inbound* Message-ID
forward would work. Both pieces are tracked as explicit follow-up (§6), not silently
dropped. **This follow-up is larger still than reason (2) above implies — independent
audit 2026-08-25 (CONFIRMED, table row 5 area)**: Resend's `emails.send()` returns only
its own internal `id` (a UUID), not an RFC 5322 `Message-ID` — capturing the real
outbound Message-ID on that transport needs a follow-up `GET /emails/{id}` round-trip or
a webhook, not just reading the send response; whether `nodemailer`'s `info.messageId`
is more directly usable on the SMTP path is unconfirmed (§5 item 17). And only
`inquiryReplyEmail` (the admin's own reply) gets an outbound `inquiry_messages` row at
all in this plan's design — the reminder, closing-warning, and rating-request templates
have no outbound thread row either, so before a real third matching tier is useful for 3
of the 4 templates, that follow-up first needs to decide whether those three should get
outbound rows too. Neither point is decided here; recorded so a future reader doesn't
assume "add a column" is the whole of this follow-up.

## 2.5 Concrete code (the non-obvious pieces, spelled out)

**Migration** (`supabase migration new contact_messages_ref_code`, contents to author,
NOT applied):

```sql
-- ref_code: short random per-inquiry reference embedded as [KLF-XXXXXXXX] in every
-- outbound subject on a thread (templates.ts threadSubject()), matched first by
-- intakeMailAsInquiry (inquiry-mail-intake.ts findExistingInquiry) before falling back
-- to conversationId — always paired with a sender-email identity check on EITHER tier,
-- never trusted alone (see docs/inquiry-email-threading-fix-plan-2026-08-25.md §2.1/§2.3
-- for the entropy tradeoff and matching design).
--
-- DEFAULT-generated (not app-layer): the two existing INSERT paths into
-- contact_messages -- insertContactMessage (inquiry-intake.ts) and the upsert in
-- intakeMailAsInquiry (inquiry-mail-intake.ts), confirmed exhaustive by the write-path
-- audit in 20260825133136_contact_messages_status_check.sql -- need no code change:
-- Postgres fills ref_code on every insert automatically.
--
-- Verify live before applying (same verify-first step as the CHECK constraint):
--   * pg_extension / search_path -- whether gen_random_bytes needs the
--     extensions.gen_random_bytes(...) qualification (as in
--     202606290034_rsvp_harden.sql) or the bare form is reachable (as in
--     20260705120408_event_gift_and_invite_media.sql) on this project.
--   * Row count / no existing ref_code values to collide with, before backfill.
--
-- Rollback:
--   alter table public.contact_messages
--     drop constraint if exists contact_messages_ref_code_key,
--     drop column if exists ref_code;
--
-- NOTE (independent audit 2026-08-25, PRODUCT DECISION -- not resolved here, see §4.1):
-- unlike ref_code's uniqueness (enforced below), its FORMAT is only ever produced by the
-- DEFAULT expression -- there is no CHECK constraint stopping a future explicit insert
-- from writing a value that doesn't match /^[0-9A-F]{8}$/, which would then silently
-- never match REF_CODE_RE on intake. Whether to add
-- `check (ref_code ~ '^[0-9A-F]{8}$')` (precedent: contact_messages_status_valid on
-- this same table) is an open decision requiring owner sign-off -- see §4.1.

alter table public.contact_messages
  add column if not exists ref_code text
    default upper(encode(gen_random_bytes(4), 'hex'));

-- Backfill existing rows before the NOT NULL + UNIQUE land — verify count/collisions
-- against live data first, same process as contact_messages_status_check.
update public.contact_messages
  set ref_code = upper(encode(gen_random_bytes(4), 'hex'))
  where ref_code is null;

alter table public.contact_messages
  alter column ref_code set not null;

-- Guarded for idempotency (ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS, and a
-- re-run after a `db push` that already applied but reported a false failure -- see
-- memory: parallel-sessions-one-live-db -- must not abort on 42710). Same pattern as
-- contact_messages_status_valid / contact_messages_rating_token_key, both added to this
-- same table today.
--
-- FIXED (independent audit 2026-08-25, CONFIRMED, table row 11): pg_constraint's own
-- documentation states conname is "not necessarily unique" globally -- confirmed
-- empirically on this project's live DB, where duplicate constraint names already exist
-- across schemas (e.g. messages_payload_exclusive appears 8 times, schema_migrations_pkey
-- 3 times), though not yet for this specific name. The earlier draft's `where conname =
-- ...` alone could, in principle, match a same-named constraint on an unrelated table and
-- skip adding this one. Scoped to this table explicitly below.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contact_messages_ref_code_key'
      and conrelid = 'public.contact_messages'::regclass
  ) then
    alter table public.contact_messages
      add constraint contact_messages_ref_code_key unique (ref_code);
  end if;
end $$;

comment on column public.contact_messages.ref_code is
  'Random reference code (upper(encode(gen_random_bytes(4), ''hex'')), 8 hex chars / 32 bits -- intentionally weaker than rating_token''s 128 bits because it is never trusted alone, see AND-check in findExistingInquiry) embedded as [KLF-XXXXXXXX] in every outbound subject on this inquiry''s thread (admin reply, reminder, closing warning, rating request -- src/lib/email/templates.ts threadSubject()). DB-generated by DEFAULT on every insert, no application insert-path change needed. Unique so intakeMailAsInquiry can match an inbound reply by subject token as its first-tier check, before falling back to conversationId -- always paired with a sender-email identity check on either tier.';
```

`SET NOT NULL` is left unguarded deliberately — re-running it on an already-not-null
column is a no-op in Postgres, unlike `ADD CONSTRAINT`, which has no native
`IF NOT EXISTS` and must be wrapped.

**Subject builder** (new small helper in `src/lib/email/templates.ts`, used by all 4
templates instead of each hardcoding its own subject):

```ts
const THREAD_SUBJECT = 'תגובה לפנייתך — KALFA';

function threadSubject(refCode: string, isFirst: boolean): string {
  const tag = `[KLF-${refCode}]`;
  // `Re:` at the very front, not after the tag — see §2.2 for why (matches Resend's
  // own documented example, and gives a mail client's own leading-"Re:" detection the
  // best chance of actually firing instead of double-prefixing a genuine customer
  // reply).
  return isFirst ? `${tag} ${THREAD_SUBJECT}` : `Re: ${tag} ${THREAD_SUBJECT}`;
}
```

`isFirst` is a plain boolean here by design — this helper doesn't compute it. **Fixed at
the call sites, independent audit 2026-08-25 (CONFIRMED, table row 7)**: the earlier
draft of `inquiryReplyEmail` (§3.1) called `threadSubject(refCode, /* isFirst */ true)`
as a hardcoded compile-time literal, not a value derived from actual thread state — so a
genuine first admin reply on a mail-originated inquiry (correct: `true`) and a second or
later admin reply on the same thread (should be `false`, but got `true` anyway) were
indistinguishable, producing a bare, non-`Re:` subject on a reply that isn't actually
first. This doesn't affect `ref_code` matching (the bracket tag is unchanged either way),
only the `Re:`-consistency this section itself sets out to guarantee. §3.1's diff for
`inquiryReplyEmail` and `sendInquiryReply` now threads a caller-computed `isFirst`
through instead.

**Two-tier matching** (`intakeMailAsInquiry`, replacing the single `conversationId`
lookup at `inquiry-mail-intake.ts:95-106`):

```ts
// Local alias — inquiry-mail-intake.ts has no existing AdminClient type to import
// (only inquiry-followup.ts:39 defines one, and it's unexported/module-private).
// This mirrors the same local-alias pattern already used independently in 13 other
// files in this codebase (inquiry-followup.ts, outreach.ts, console-calls.ts, etc.)
// rather than exporting a cross-file type these two modules otherwise don't share.
type AdminClient = ReturnType<typeof createAdminClient>;

const REF_CODE_RE = /\[KLF-([0-9A-F]{8})\]/i;

type InquiryMatch = { id: string; status: 'cancelled' | (string & {}) };

async function findExistingInquiry(
  admin: AdminClient,
  mail: InboundMail,
): Promise<InquiryMatch | null> {
  const tokenMatch = mail.subject?.match(REF_CODE_RE);
  if (tokenMatch) {
    const code = tokenMatch[1].toUpperCase();
    const { data, error } = await admin
      .from('contact_messages')
      .select('id, email, status')
      .eq('ref_code', code)
      .maybeSingle();
    if (error) {
      // A transient DB failure here must NOT be treated as "no match" — that is
      // exactly how the live-verified incident in §0 happened (a miss silently
      // creates a new, disconnected row). Fixed here and in the conversationId branch
      // below. (Independent audit 2026-08-25, CONFIRMED, table row 1 — one of four
      // findings that blocked implementation until corrected: an earlier draft of
      // this function left `error` uncaught on both queries, and the worker's own
      // retry loop does not save this, because the function returns a "success" shape
      // either way.)
      throw new Error('שאילתת חיפוש פנייה לפי קוד נכשלה', { cause: error });
    }
    // Sender must match the row's own address on EITHER tier — a code (or a shared
    // conversationId) alone is not proof of identity. mail.fromAddress is Graph's
    // parsed From: header, not SPF/DKIM/DMARC-verified — a meaningful deterrent, not
    // cryptographic proof (§2.1).
    if (data && data.email?.toLowerCase() === mail.fromAddress?.toLowerCase()) {
      return { id: data.id, status: data.status };
    }
    if (data) {
      // A code matched but the sender didn't — a possible spoofing attempt, not just
      // an ordinary miss. Must not pass silently: ids/reason only, never the two
      // addresses being compared (matches this file's existing alert-payload
      // contract at lines 147-151/252-258).
      void sendSlackAlert({
        category: 'customer_inquiry',
        level: 'warn',
        title: 'קוד פנייה תואם אך כתובת שולח לא תואמת',
        source: 'outlook',
        fields: { contactMessageId: data.id, reason: 'ref_code_sender_mismatch' },
      });
    }
  }
  if (!mail.conversationId) return null;
  const { data, error } = await admin
    .from('contact_messages')
    .select('id, email, status')
    .eq('thread_id', mail.conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error('שאילתת חיפוש פנייה לפי conversationId נכשלה', { cause: error });
  }
  // Same identity comparison as tier 1 above, but deliberately no dedicated alert on a
  // mismatch here — see §2.3 point 3 for why the two tiers share comparison logic but
  // not alerting behavior (independent audit 2026-08-25 corrected the plan's earlier
  // "identical" wording, which had conflated the two).
  if (!data || data.email?.toLowerCase() !== mail.fromAddress?.toLowerCase()) return null;
  return { id: data.id, status: data.status };
}

// (Independent audit 2026-08-25, CONFIRMED, table row 2 — one of four findings that
// blocked implementation until corrected: §3.1 claims this same-sender pre-check is
// "already spelled out in §2.5," but no such function actually appeared here in the
// earlier draft; this is the missing code.) Used by intakeMailAsInquiry's miss path
// (§2.3 point 6) to distinguish "looks like an unmatched reply" from "genuinely new"
// before choosing which Slack alert to fire — MUST be called before the upsert-insert
// runs, not after, or it would match the very row that insert just created and always
// report true.
async function hasSameSenderInquiry(
  admin: AdminClient,
  fromAddress: string | null,
): Promise<boolean> {
  if (!fromAddress) return false;
  // contact_messages.email is never normalized to lowercase on write
  // (insertContactMessage has no .toLowerCase() step) while mail.fromAddress always
  // is — a plain .eq() would silently miss a form submission entered as
  // "Dana@Gmail.com". .ilike() is case-insensitive but treats `%` and `_` as
  // wildcards under Postgres's default ILIKE escape rules, so the address is escaped
  // first — an unescaped `_` (a common, legal character in real addresses) would
  // otherwise match any single character in that position and silently over-match.
  const escaped = fromAddress.replace(/[%_\\]/g, (ch) => `\\${ch}`);
  const { data, error } = await admin
    .from('contact_messages')
    .select('id')
    .ilike('email', escaped)
    .limit(1)
    .maybeSingle();
  if (error) {
    // Fail closed to the generic "new inquiry" alert rather than throwing — this
    // check only affects which Slack alert fires, not the correctness of the insert
    // itself, so a transient failure here should degrade quietly, not block inquiry
    // creation.
    return false;
  }
  return data != null;
}
```

`intakeMailAsInquiry` calls `findExistingInquiry` once, near the top, and — on a hit —
branches to `attachReplyToInquiry(match, mail, body)` instead of the old
`attachReplyToInquiry(id, ...)`. On a miss, it falls through to the existing
upsert-insert path, but first calls `hasSameSenderInquiry(admin, mail.fromAddress)`
(**before** the insert — see the comment above) to decide which Slack alert to fire, per
§2.3 point 6.

**`attachReplyToInquiry`** (`inquiry-mail-intake.ts:218-261`) gains the cancelled-guard
and cascade-stamp reset from §2.3 points 4–5:

```ts
async function attachReplyToInquiry(
  match: InquiryMatch,
  mail: InboundMail,
  body: string,
): Promise<MailIntakeResult> {
  const admin = createAdminClient();

  // FIXED — independent audit 2026-08-25, CONFIRMED, table row 3 (one of four findings
  // that blocked implementation until corrected): an earlier draft of this function
  // returned on the cancelled-guard BEFORE this insert ran, which meant the customer's
  // reply body and message_id were never written anywhere — permanent, silent data
  // loss on every reply to a cancelled inquiry, repeating on every subsequent reply on
  // the same thread, and in direct conflict with this project's own auditability rule
  // (CLAUDE.md: "Preserve auditability... Do not catch errors merely to ignore them").
  // The insert now runs unconditionally, first — this row is the durable record of
  // what happened, not the (best-effort, 60-second-deduped, non-persisted-payload)
  // Slack alert below. Only the status/cascade mutation is skipped for a cancelled row.
  const { error: threadError } = await admin.from('inquiry_messages').insert({
    inquiry_id: match.id,
    direction: 'inbound',
    body,
    message_id: mail.internetMessageId,
    created_at: mail.receivedAt,
  });
  if (threadError) {
    throw new Error('שמירת תגובת הלקוח נכשלה', { cause: threadError });
  }

  if (match.status === 'cancelled') {
    // Deliberate cancellation — do not resurrect the row's status/cascade state. The
    // reply itself is already safely recorded above. Distinct title from a normal
    // reopen so ops can tell the two apart at a glance; ids only, no PII.
    void sendSlackAlert({
      category: 'customer_inquiry',
      level: 'warn',
      title: 'לקוח הגיב לפנייה שבוטלה',
      source: 'outlook',
      fields: { contactMessageId: match.id },
    });
    return { status: 'skipped', reason: 'cancelled' };
  }

  const { error } = await admin
    .from('contact_messages')
    .update({
      status: 'reopened',
      reply_needed_at: mail.receivedAt,
      last_activity_at: mail.receivedAt,
      handled_at: null,
      // A reopen starts a fresh silence-cascade cycle — round-1's stamps must not
      // leak into round-2's gating (listDueForReminder/Warning/AutoClose all gate on
      // "is null", inquiry-followup.ts:64-112). rating_token clears alongside
      // rating_requested_at since together they're the whole /rate/[token] auth pair
      // (inquiry-rating.ts:18-29,42-62). rating_score/rating_comment/rating_at are
      // deliberately NOT touched — resubmission overwrites those in place by design
      // (rating-schema migration column comment), and this reopen is unrelated to
      // the rating itself.
      reminder_sent_at: null,
      closing_warning_sent_at: null,
      auto_closed_at: null,
      rating_requested_at: null,
      rating_token: null,
    })
    .eq('id', match.id);
  if (error) {
    throw new Error('עדכון הפנייה שנפתחה מחדש נכשל', { cause: error });
  }

  void sendSlackAlert({
    category: 'customer_inquiry',
    level: 'info',
    title: 'לקוח הגיב לפנייה קיימת',
    source: 'outlook',
    fields: { contactMessageId: match.id },
  });

  return { status: 'reopened', contactMessageId: match.id };
}
```

`MailIntakeResult`'s `{ status: 'skipped'; reason: string }` variant already exists and
covers the new cancelled-skip case with no type change needed.

## 2.6 Send idempotency — closing the outbound duplicate-send gap

**Added after this plan's own status was challenged — "we don't leave things open."**
Independent audit 2026-08-25 (finding, table row 8; confirmed live 2026-08-25) identified
a real, separate gap from everything above: `runInquiryFollowupSweep`
(`src/lib/data/inquiry-followup.ts:144-224`, the exact function this plan's §3.1 already
edits) sends each stage email **before** writing its completion stamp
(`reminder_sent_at`/`closing_warning_sent_at`/`auto_closed_at`), with **no** secondary
protection — no atomic claim, no `UNIQUE`-backed claim row, no send-level idempotency key.
If the process crashes or the request times out *after* Resend has actually accepted the
email but *before* the stamp write completes, the next tick (5 minutes later) re-selects
the same row (its stamp is still `null`) and **sends the same email to the same customer a
second time**. This is worse than the inbound duplicate-row gap closed in §2.5 above — this
one is customer-visible, not just a DB-internal duplicate.

**Confirmed as the live gap, not a hypothetical**: `EMAIL_PROVIDER=resend` in this
deployment's `.env.local` (verified directly, 2026-08-25) — Resend is the actual transport
in production, not the SMTP fallback. The fix below targets the transport that is actually
live.

**Precedent already in this codebase for the identical failure shape**:
`worker/main.ts`'s `thankyouSweep` (`auto-thankyou.ts`, the closest sibling to this sweep —
same 5-minute-cron idiom) is registered with `policy: 'singleton'` specifically so an
overlapping cron tick can't run concurrently with the previous one, on top of an atomic
claim (`contact_interactions` partial `UNIQUE` index) — the code comment states this
directly: *"closes the race at its source instead of relying on a single defense layer."*
`inquiryFollowupSweep` is conspicuously absent from that singleton list today.

**Two-part fix**:

1. **`worker/main.ts`** — add `q === QUEUES.inquiryFollowupSweep` to the existing
   `singleton` disjunction (around line 743-768), with the same style of reasoning comment
   as its siblings:

   ```diff
        q === QUEUES.graphIntakeRenew;
   +    q === QUEUES.graphIntakeRenew ||
   +    // Singleton too, for the same reason as thankyouSweep: an overlapping cron
   +    // tick could re-select a row whose stamp the previous tick hasn't written
   +    // yet, and (unlike thankyouSweep) there is no atomic per-row claim here to
   +    // fall back on — see §2.6 of the threading-fix plan for the send-level
   +    // idempotency key that covers the *sequential* retry-after-crash case this
   +    // singleton policy alone does not.
   +    q === QUEUES.inquiryFollowupSweep;
   ```

   This closes **concurrent** double-processing (two overlapping ticks). It does **not**
   close the **sequential** case (one tick crashes mid-send, the *next* tick retries) —
   that needs part 2.

2. **Resend Idempotency Key** — `EmailSender.send()` (`src/lib/email/sender.ts`, already
   gaining `inReplyTo`/`references` in §2.4) gains one more optional field:

   ```diff
      send(params: {
        to: string;
        subject: string;
        html: string;
        text?: string;
        attachments?: EmailAttachment[];
        inReplyTo?: string;
        references?: string[];
   +    idempotencyKey?: string;
      }): Promise<void>;
   ```

   `resendSender` passes it as the SDK's documented second argument (verified live against
   the installed `resend@6.20.0`: `async send(payload, options = {})`, and
   `options.idempotencyKey` is a real, supported field — confirmed both from Resend's own
   idempotency-keys doc and by reading the installed SDK's type definitions directly):

   ```diff
      async send({ to, subject, html, text, attachments, inReplyTo, references, idempotencyKey }) {
        const { error } = await client.emails.send({
          from, to, replyTo: from, subject, html,
          ...(text ? { text } : {}),
          ...(inReplyTo ? { headers: {...} } : {}),
          ...(attachments?.length ? { attachments: /* unchanged */ } : {}),
   -    });
   +    }, idempotencyKey ? { idempotencyKey } : undefined);
   ```

   `smtpSender` ignores the field (documented limitation below, not silently dropped —
   nodemailer/SMTP has no protocol-level equivalent, confirmed: the installed
   `nodemailer@9.0.5` README has zero mentions of `idempot`/`message-id`-based dedup).

   **Key format**, matching Resend's own documented `<event-type>/<entity-id>` convention
   and the codebase's `inquiry-reminder`-style naming already used elsewhere in this file's
   comments: `` `inquiry-${stage}/${row.id}/${row.replied_at}` `` where `stage` is
   `'reminder' | 'warning' | 'rating'`. **`replied_at` is in the key deliberately, not just
   `row.id`**: §2.3 point 5 (above) resets the cascade stamps on every reopen, so the same
   `contact_messages.id` can go through the reminder stage more than once across its
   lifetime, each time with a fresh `replied_at`. Without `replied_at` in the key, a
   *second, legitimate* cascade cycle's reminder would collide with the *first* cycle's
   already-used key and Resend would silently treat it as a duplicate of the old send —
   suppressing a real reminder the customer should get. `DueRow` (§3.1) already carries
   `id`; add `replied_at` to its `.select()` alongside `ref_code` (one extra column, no
   new query).

   `sendInquiryReply` (`admin/contacts.ts`) is **not** given an idempotency key here — it
   runs once per explicit admin click with no automatic retry loop around it (unlike the
   sweep and the webhook path), so a failed send surfaces as a visible error the admin can
   deliberately retry, which is the expected, safe behavior for a human-triggered action,
   not a race to close.

   **Scope of the guarantee, precisely stated — Resend's own doc, quoted exactly**: *"an
   email with the same idempotency key has already been sent **in the last 24 hours**."*
   This key is remembered for 24 hours, not indefinitely. The realistic retry path this
   fix targets — a crash between send and stamp-write, picked up by the **next** 5-minute
   cron tick — is minutes, not hours, so it sits nowhere near that boundary. The
   theoretical edge this doesn't cover: if the stamp write kept failing on *every* tick
   for **more than 24 hours straight** (e.g. a sustained DB outage) while the send itself
   kept succeeding-but-being-deduped each time, the first tick to run *after* the 24-hour
   window would be treated as a brand-new request and would actually send again — a
   genuine duplicate, just delayed past a day instead of prevented outright. Not fixed
   here: a failure mode lasting over 24 hours would already be surfacing loudly through
   the sweep's own `failed`-count Slack summary (`inquiry-followup.ts:226-236`) long
   before the window matters, so this is a bounded, low-probability residual — recorded
   precisely rather than left as an implicit "solved forever" claim.

**Considered and rejected: a permanent DB send-record table (no 24-hour bound at
all).** An earlier draft of this section added a new `inquiry_followup_send_log` table
(a pre-send existence check + post-send insert, mirroring `contact_interactions`'
`message_key` idiom) specifically to remove the 24-hour limitation above entirely.
**Removed on reconsideration — scope check, not a correctness objection**: the gap it
closed is already bounded, low-probability (a sustained *24-hours-straight* stamp-write
failure while sends keep succeeding), and — as the paragraph above already states —
would already be surfacing loudly through the sweep's own `failed`-count Slack alert
long before 24 hours elapse. Closing it needed a new table, a third migration, and a new
pre-send/post-send code path in every stage loop — real, ongoing complexity for a residual
that is not just unlikely but independently observable through an alert that already
exists. Matches this codebase's own standard against unrequested abstraction (CLAUDE.md:
"Don't add features... beyond what the task requires... Don't design for hypothetical
future requirements"). The Resend Idempotency Key alone (above) is the fix; the SMTP path
remains genuinely out of scope (see §6) — it was only the now-removed table that would
have covered it, not anything else in §2.6.

## 2.7 Inbound duplicate-row prevention — `inquiry_messages.message_id`

**Also added per "we don't leave things open."** A narrower, separate duplicate-row risk
from §2.6's outbound gap: `webhook_inbox`'s own retry-after-partial-failure (up to 5
attempts, `src/lib/data/webhooks.ts`) can re-run `attachReplyToInquiry` (§2.5 above) after
its `inquiry_messages.insert()` already succeeded but a *later* step in the same function
(the `contact_messages` update) failed — writing a second, identical thread row for the
same inbound message on the retry.

**Ruled out as the mechanism, verified by reading the code directly**: Graph's own
notification redelivery (the standard behavior confirmed in §0's Graph webhook docs — up
to 4 hours of retries on a non-2xx or slow response) is **not** the risk here. It's already
fully deduped one layer upstream: `src/app/api/webhooks/microsoft-graph/route.ts` sets
`dedupe_key: \`graph-mail:${messageId}\`` where `messageId` is the Graph message's own
resource id (`resourceData.id`) — stable across retries of the same logical event, not the
notification's own transient id — and `webhook_inbox` has `UNIQUE(provider, dedupe_key)`
with `ignoreDuplicates: true`. A Graph-level retry never reaches `intakeMailAsInquiry` a
second time as a "new" row. The real risk is KALFA's own internal retry of an
**already-deduped, already-claimed** row after a **partial** failure mid-processing.

**Fix**: a plain (non-partial) `UNIQUE` constraint on `inquiry_messages.message_id`,
paired with changing `attachReplyToInquiry`'s plain `.insert()` to
`.upsert({...}, {onConflict: 'message_id', ignoreDuplicates: true})`.

```diff
- const { error: threadError } = await admin.from('inquiry_messages').insert({
+ const { error: threadError } = await admin.from('inquiry_messages').upsert({
    inquiry_id: match.id,
    direction: 'inbound',
    body,
    message_id: mail.internetMessageId,
    created_at: mail.receivedAt,
- });
+ }, { onConflict: 'message_id', ignoreDuplicates: true });
```

**Why a plain constraint, not a partial one — verified against both official sources,
including a genuine correction to an earlier answer in this same review round**:
`NULL` is always distinct from `NULL` under a standard PostgreSQL `UNIQUE` constraint, so
the many rows with `message_id = NULL` (every web-form-originated inquiry — confirmed live:
**8 of the 9 existing `inquiry_messages` rows with `direction = 'inbound'` already have
`message_id = NULL`**, and zero duplicate *non-null* values exist today, so this needs no
backfill and is safe to add now) are entirely unaffected — no `WHERE message_id IS NOT
NULL` predicate is needed at all. A **partial** index was considered first and rejected:
PostgreSQL's own docs state `ON CONFLICT (message_id)` infers a partial index only when the
*same* `WHERE` predicate is repeated in the `ON CONFLICT` clause itself ("If an
`index_predicate` is specified, it must... satisfy arbiter indexes" — omitting it does not
implicitly satisfy one); Supabase-js's `.upsert()` `onConflict` option is a bare column-name
string with no way to express that predicate. Pairing a partial index with the `.upsert()`
call above would fail at runtime with "no unique or exclusion constraint matching the ON
CONFLICT specification." A plain constraint sidesteps the mismatch entirely.

Migration addition (folded into §2.5's `contact_messages_ref_code` migration file is
**not** appropriate — this touches a different table with its own change history; author
via a second `supabase migration new inquiry_messages_message_id_unique`, same
verify-first/idempotency-guard/rollback conventions as every other migration in this plan):

```sql
-- Rollback: alter table public.inquiry_messages drop constraint if exists
--   inquiry_messages_message_id_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inquiry_messages_message_id_key'
      and conrelid = 'public.inquiry_messages'::regclass
  ) then
    alter table public.inquiry_messages
      add constraint inquiry_messages_message_id_key unique (message_id);
  end if;
end $$;

comment on constraint inquiry_messages_message_id_key on public.inquiry_messages is
  'Prevents a webhook_inbox retry-after-partial-failure from writing a duplicate thread
   row for the same inbound Graph message. NULL (web-form-originated rows) is exempt by
   standard Postgres UNIQUE semantics — no partial-index predicate needed or used, since
   Supabase-js upsert() cannot express one. See docs/inquiry-email-threading-fix-plan-
   2026-08-25.md §2.7.';
```

## 2.8 First-inquiry-creation path — closing the silent-loss gap

**A second, distinct problem in `intakeMailAsInquiry`'s new-inquiry branch
(`inquiry-mail-intake.ts:108-145`), found while checking whether §2.7's fix covered "most"
inbound messages — it doesn't, this is a different code path entirely.** The founding
`inquiry_messages` row for a brand-new inquiry is written by a **plain `.insert()` that
never captures `error`** (line 139, verified by reading the code directly — no
`const { error } = ` at all, a bare `await`). If that insert fails, the failure is silently
swallowed: the function still returns `{status:'created', ...}`, the `contact_messages` row
exists permanently, and the customer's original message text is gone — with no retry,
because `webhook_inbox` sees the call as having succeeded.

**§2.7's `UNIQUE(message_id)` + `.upsert(...)` fix doesn't reach this — verified, not
assumed**: that fix was written for `attachReplyToInquiry` only. This branch is a separate
function path in the same file, reached only for a message's *first* insert, not a reply.

**Chosen design — Option A (sequential, self-healing on retry), not a single-transaction
RPC**: both approaches are correct per PostgreSQL's own docs (a Postgres function called via
`.rpc()` runs as one atomic transaction by default — verified live,
[postgresql.org/docs/current/tutorial-transactions.html](https://www.postgresql.org/docs/current/tutorial-transactions.html),
[supabase.com/docs/guides/database/functions](https://supabase.com/docs/guides/database/functions)).
Option A is chosen because it already achieves full correctness — no data loss, no
duplication — through retry-idempotency alone, without a strict single-transaction
guarantee: if the process crashes between the two writes below, the **next** invocation
(whether a genuine retry or a much-later Graph redelivery) re-enters the same "duplicate"
branch and re-attempts the idempotent `inquiry_messages` upsert, which either has already
succeeded (no-op) or completes what was missing. A single-transaction RPC would close an
already-harmless window at the cost of a new migration, a new `SECURITY DEFINER` function,
and a real stylistic break from every other write in this file, which is sequential
JS-side calls throughout — not worth it for a gap that was never actually open in practice.

```diff
   const { data, error } = await admin
     .from('contact_messages')
     .upsert(
       { name: mail.fromName ?? mail.fromAddress ?? 'ללא שם', email: mail.fromAddress,
         phone: null, topic: MAIL_TOPIC, message: body, user_id: null,
         source: 'outlook', source_message_id: mail.internetMessageId,
         thread_id: mail.conversationId },
       { onConflict: 'source,source_message_id', ignoreDuplicates: true },
     )
     .select('id');

   if (error) {
     throw new Error('שמירת הפנייה מהדואר נכשלה', { cause: error });
   }

-  // ignoreDuplicates makes an already-seen message return no rows. That is the
-  // success path for a redelivery, not a failure.
-  const created = data?.[0]?.id;
-  if (!created) return { status: 'duplicate' };
-
-  // The thread carries the same text the flat column does, so the conversation
-  // view is right from the first message rather than only from the first reply.
-  await admin.from('inquiry_messages').insert({
-    inquiry_id: created,
-    direction: 'inbound',
-    body,
-    message_id: mail.internetMessageId,
-    created_at: mail.receivedAt,
-  });
+  // ignoreDuplicates makes an already-seen message return no rows. That is the
+  // success path for a redelivery, not a failure — but a redelivery might be
+  // retrying a PRIOR attempt whose inquiry_messages write never landed (silent
+  // loss, closed below), so it still needs to look up the existing row and
+  // re-attempt that write, not just report "duplicate" and stop.
+  let contactMessageId = data?.[0]?.id;
+  const wasNew = Boolean(contactMessageId);
+  if (!contactMessageId) {
+    const { data: existing, error: findError } = await admin
+      .from('contact_messages')
+      .select('id')
+      .eq('source', 'outlook')
+      .eq('source_message_id', mail.internetMessageId)
+      .maybeSingle();
+    if (findError) {
+      throw new Error('איתור הפנייה הקיימת נכשל', { cause: findError });
+    }
+    if (!existing) {
+      // Should not happen — ignoreDuplicates just reported a conflict against
+      // this exact (source, source_message_id) pair. Fail loudly rather than
+      // silently drop the message if it somehow does.
+      throw new Error('פנייה קיימת לא אותרה לאחר זיהוי כפילות');
+    }
+    contactMessageId = existing.id;
+  }
+
+  // The thread carries the same text the flat column does, so the conversation
+  // view is right from the first message rather than only from the first reply.
+  // Idempotent regardless of wasNew: on a redelivery this self-heals a prior
+  // attempt's silently-lost insert instead of assuming it already succeeded.
+  const { error: threadError } = await admin.from('inquiry_messages').upsert(
+    { inquiry_id: contactMessageId, direction: 'inbound', body,
+      message_id: mail.internetMessageId, created_at: mail.receivedAt },
+    { onConflict: 'message_id', ignoreDuplicates: true },
+  );
+  if (threadError) {
+    throw new Error('שמירת ההודעה בשרשור נכשלה', { cause: threadError });
+  }
+
+  if (!wasNew) return { status: 'duplicate' };
```

Reuses §2.7's `inquiry_messages_message_id_unique` constraint — no third migration needed,
the same constraint backs both `.upsert()` call sites in this file.

The two lines after this block (currently `inquiry-mail-intake.ts:147-160`, the Slack
alert and final return) are unchanged in substance but need the renamed variable:

```diff
   void sendSlackAlert({
     category: 'customer_inquiry',
     level: 'info',
     title: 'פנייה חדשה בדואר',
     source: 'outlook',
-    fields: { contactMessageId: created },
+    fields: { contactMessageId },
   });

-  return { status: 'created', contactMessageId: created };
+  return { status: 'created', contactMessageId };
```

Both already execute only on the `wasNew` path — the `if (!wasNew) return { status:
'duplicate' }` line at the end of the previous diff returns before reaching them, so no
separate gating is needed here.

## 3. Files to change — index

| File | Change |
|---|---|
| `supabase/migrations/<new>` | `ref_code` column with `DEFAULT` + backfill + `NOT NULL` + guarded unique constraint (now scoped by `conrelid`, see §2.5) + column comment + rollback block (via `migration new`, not applied) |
| `supabase/migrations/<new 2>` | Separate migration: `UNIQUE(message_id)` on `inquiry_messages`, guarded + rollback (§2.7, via `migration new`, not applied) |
| `src/lib/supabase/types.generated.ts` | **Regenerate via `supabase gen types` after the migration is applied, before running static gates.** Added row — independent audit 2026-08-25 (CONFIRMED, table row 5): the original plan had no explicit step for this; every `ref_code`-typed reference below fails to compile against the current, un-regenerated file, and this project's deploy gate blocks on schema drift (memory: supabase-types-drift-gate). See §5's reordered verification list. |
| `src/lib/email/templates.ts` | 4 templates take `refCode` input, unify subject construction via `threadSubject()`; `inquiryReplyEmail` also takes a caller-computed `isFirst: boolean` instead of a hardcoded literal (fixed per independent audit 2026-08-25, table row 7); examples/tests use the 8-char format |
| `src/lib/email/sender.ts` | `EmailSender` interface + both transports gain `inReplyTo`/`references` (outbound-only — see §2.4); `resendSender` also gains `idempotencyKey` passthrough (§2.6, added per "we don't leave things open" — closes the outbound duplicate-send gap on the live transport) |
| `worker/main.ts` | `inquiryFollowupSweep` added to the existing `singleton`-policy queue list (§2.6) — closes concurrent-tick double-processing, matching `thankyouSweep`'s established precedent for the identical race shape |
| `src/lib/data/admin/contacts.ts` | `ContactMessage` type + `CONTACT_COLUMNS` gain `ref_code`; `sendInquiryReply` fetches it + last inbound message-id (now with a captured, logged — not swallowed — `error`), computes `isFirst`, builds subject + headers (its existing `status === 'cancelled'` guard already covers the admin-reply side of §2.3 point 4 — no new check needed here); deliberately **not** given an idempotency key (§2.6 — human-triggered, no retry loop) |
| `src/lib/data/inquiry-followup.ts` | `sendStageEmail`/auto-close block do the same for the other 3 templates — **batched**, not per-row (see §3.1); `lastInboundMessageIds` now types its map as `Map<string, string | null>`, filters to `message_id IS NOT NULL` at the query level (not just ordering), and captures `error` (fixed per independent audit 2026-08-25, table row 4); `DueRow` and `listDueFor*` also select `replied_at`, and each send call passes a `` `inquiry-${stage}/${id}/${replied_at}` `` idempotency key (§2.6) |
| `src/lib/data/inquiry-mail-intake.ts` | `intakeMailAsInquiry` gains the subject-token-first matching tier (§2.5); `findExistingInquiry` now throws on a DB `error` instead of treating it as "no match" on either tier (table row 1); the missing `hasSameSenderInquiry` helper for §2.3 point 6 is now actually written (table row 2); `attachReplyToInquiry` gains the cancelled-guard + cascade-stamp reset, with the `inquiry_messages` insert moved ahead of the cancelled-guard so a reply is never discarded (§2.3/§2.5, table row 3); local `AdminClient` type alias added; the `inquiry_messages` insert becomes an `.upsert(..., {onConflict:'message_id', ignoreDuplicates:true})` (§2.7); the new-inquiry branch now locates the existing row on a redelivery and re-attempts an idempotent `inquiry_messages` upsert instead of just reporting "duplicate," self-healing a prior silent-loss failure (§2.8) |
| `src/lib/data/inquiry-intake.ts` | **No change.** `insertContactMessage`'s insert has no `ref_code` field and needs none — the column `DEFAULT` (§2.1/§2.5) fills it automatically. Called out explicitly so a future reviewer doesn't independently rediscover this and assume it's still an open gap. |
| Test files | `templates.test.ts`, `contacts.test.ts`, `inquiry-followup.test.ts`, `inquiry-mail-intake.test.ts` — updated/extended. `sender.ts` has **no existing test file today** (`src/lib/email/` contains only `sender.ts`, `templates.ts`, `templates.test.ts`); it's exercised only indirectly via `getEmailSender` mocks in 4 consumer tests, which never inspect `resendSender`/`smtpSender`'s internal header construction — **confirmed independently, table row 29 area**. Add a new `src/lib/email/sender.test.ts` for direct coverage of the `inReplyTo`/`references` branches, or explicitly accept indirect-only coverage — don't assume a 5th pre-existing file that isn't there. |

## 3.1 Full diffs, file by file

**`src/lib/email/templates.ts`** — all 4 functions gain `refCode: string`, subject built
via the shared `threadSubject()` helper from §2.5:

```diff
 export function inquiryReplyEmail(input: {
   recipientName: string;
   replyText: string;
   origin: string;
+  refCode: string;
+  isFirst: boolean;
 }): { subject: string; html: string; text: string } {
   const name = input.recipientName.trim() || 'לקוח יקר';
-  const subject = 'תגובה לפנייתך — KALFA';
+  const subject = threadSubject(input.refCode, input.isFirst);
```

**Fixed — independent audit 2026-08-25 (CONFIRMED, table row 7)**: the earlier draft
hardcoded `/* isFirst */ true` as a compile-time literal inside this call, not a value
derived from actual thread state. That's wrong for a genuine first admin reply *after* a
reopen, or a second admin reply sent before the customer has replied even once — both
would get a bare, non-`Re:` subject despite not being the thread's very first message.
`isFirst` is now a required caller-supplied input; see the `sendInquiryReply` diff below
for how it's computed.

```diff
 export function inquiryReminderEmail(input: {
   recipientName: string;
   origin: string;
+  refCode: string;
 }): { subject: string; html: string; text: string } {
   const name = input.recipientName.trim() || 'לקוח יקר';
-  const subject = 'עדיין צריך עזרה? — הפנייה שלך אצלנו';
+  const subject = threadSubject(input.refCode, /* isFirst */ false);
```

(same one-line change for `inquiryClosingWarningEmail` and `inquiryRatingRequestEmail` —
both currently at `templates.ts:277` and `:321`; body copy is untouched, only the
`subject` line and the added `refCode` param change. Unlike `inquiryReplyEmail`, these
three keep `/* isFirst */ false` as a hardcoded literal — that's correct as-is, not part
of the fix above: a reminder, closing-warning, or rating-request email is by definition
never the first message on a thread, so there's no caller-state to derive it from.)

**`src/lib/email/sender.ts`** — interface + both transports:

```diff
 export interface EmailSender {
   send(params: {
     to: string;
     subject: string;
     html: string;
     text?: string;
     attachments?: EmailAttachment[];
+    inReplyTo?: string;
+    references?: string[];
   }): Promise<void>;
 }
```

```diff
 // resendSender
-    async send({ to, subject, html, text, attachments }) {
+    async send({ to, subject, html, text, attachments, inReplyTo, references }) {
       const { error } = await client.emails.send({
         from, to, replyTo: from, subject, html,
         ...(text ? { text } : {}),
+        ...(inReplyTo
+          ? { headers: { 'In-Reply-To': inReplyTo, 'References': (references ?? [inReplyTo]).join(' ') } }
+          : {}),
         ...(attachments?.length ? { attachments: /* unchanged */ } : {}),
       });
```

```diff
 // smtpSender
-    async send({ to, subject, html, text, attachments }) {
+    async send({ to, subject, html, text, attachments, inReplyTo, references }) {
       try {
         await transporter.sendMail({
           from, to, replyTo: from, subject, html, text,
+          ...(inReplyTo ? { inReplyTo, references: references ?? [inReplyTo] } : {}),
           attachments: /* unchanged */,
         });
```

**`src/lib/data/admin/contacts.ts`** — `sendInquiryReply` (currently `:189-238`):

```diff
   const { data: msg, error } = await supabase
     .from('contact_messages')
-    .select('email, name, status')
+    .select('email, name, status, ref_code')
     .eq('id', id)
     .maybeSingle();
   ...
+  const { data: lastInbound, error: lastInboundError } = await supabase
+    .from('inquiry_messages')
+    .select('message_id')
+    .eq('inquiry_id', id)
+    .eq('direction', 'inbound')
+    .order('created_at', { ascending: false })
+    .limit(1)
+    .maybeSingle();
+  // Non-fatal by design: In-Reply-To is a defense-in-depth header (§2.4), not part of
+  // the ref_code matching path — a failed lookup here should degrade to "no header
+  // set," not block the admin's reply from sending. Contrast with findExistingInquiry
+  // in §2.5, where the same class of uncaught `error` was a correctness-critical bug
+  // (table row 1) because a miss there creates a disconnected duplicate row; here a
+  // miss only omits an outbound header. Logged, not silently dropped, and not thrown.
+  // (Independent audit 2026-08-25, table row 1 area.)
+  if (lastInboundError) {
+    console.error('[sendInquiryReply] lastInbound lookup failed', lastInboundError);
+  }
+
   const { subject, html, text } = inquiryReplyEmail({
     recipientName: msg.name,
     replyText,
     origin: await getAppOrigin(),
+    refCode: msg.ref_code,
+    // Approximation, not exact (independent audit 2026-08-25's own suggested minimal
+    // fix, table row 7): "no prior inbound customer message" is used as a proxy for
+    // "this is the first outbound message on this thread." It also reports `true` for
+    // a second admin reply sent before the customer has replied even once, which still
+    // gets a bare (non-`Re:`) subject in that narrow case. A fully precise isFirst
+    // would need a count of prior inquiry_messages rows of either direction, which
+    // this plan doesn't otherwise need to fetch — accepted as the minimal fix.
+    isFirst: !lastInbound,
   });
   ...
-    await sender.send({ to: msg.email, subject, html, text });
+    await sender.send({
+      to: msg.email, subject, html, text,
+      ...(lastInbound?.message_id ? { inReplyTo: lastInbound.message_id } : {}),
+    });
```

**`src/lib/data/inquiry-followup.ts`** — `sendStageEmail` (currently `:114-122`) needs
`refCode` + the last-inbound-message-id lookup threaded in, and the auto-close block
(`:184-224`) needs the same for `inquiryRatingRequestEmail`. **Not** a per-row diff like
`sendInquiryReply`'s — `sendStageEmail` runs inside three sweep loops
(`listDueForReminder`-driven at `:144`, `listDueForWarning`-driven at `:164`, the
auto-close block at `:184`), so threading a per-row `inquiry_messages` lookup into it
would reintroduce exactly the N+1 shape `listInquiryMessages`
(`src/lib/data/admin/contacts.ts:301-328`) has an explicit, on-the-record precedent
against for this same table ("Batched deliberately: ... a per-row read would be a
classic N+1 against a table that grows with every reply. The caller groups by
inquiry_id."). Instead, batch it once per tier, outside the loop:

```diff
 type DueRow = { id: string; email: string; name: string };
+type DueRow = { id: string; email: string; name: string; ref_code: string };

 export async function listDueForReminder(...): Promise<DueRow[]> {
   const { data } = await admin
     .from('contact_messages')
-    .select('id, email, name')
+    .select('id, email, name, ref_code')
     ...
 }
 // (same one-line select change in listDueForWarning / listDueForAutoClose)

+async function lastInboundMessageIds(admin: AdminClient, ids: string[]): Promise<Map<string, string>> {
+  if (ids.length === 0) return new Map();
+  const { data, error } = await admin
+    .from('inquiry_messages')
+    .select('inquiry_id, message_id')
+    .eq('direction', 'inbound')
+    .in('inquiry_id', ids)
+    // Filtered at the query level, not left to ordering alone — independent audit
+    // 2026-08-25 (CONFIRMED, table row 4): message_id is nullable (8 of 9 live inbound
+    // rows are null today, from web-form-originated founding messages, which never had
+    // an email Message-ID). Without this filter, "most recent inbound row" could pick a
+    // null-message_id row even when an OLDER row on the same thread has a real one,
+    // silently dropping In-Reply-To for a thread that does have something to reference —
+    // relying on "nulls always sort last chronologically" as an unstated invariant
+    // instead of asking for what's actually needed.
+    .not('message_id', 'is', null)
+    .order('created_at', { ascending: false });
+  if (error) {
+    // Same non-fatal reasoning as sendInquiryReply's lookup above — degrade to "no
+    // In-Reply-To header this tick" for the whole batch rather than blocking the tier.
+    console.error('[lastInboundMessageIds] lookup failed', error);
+    return new Map();
+  }
+  const map = new Map<string, string>();
+  for (const row of data ?? []) {
+    // row.message_id is still typed string | null by the generated schema (the .not()
+    // filter above is a runtime guarantee, not a type-level one) — the defensive check
+    // keeps the Map's value type honestly `string`, not an unsafe cast.
+    if (row.message_id && !map.has(row.inquiry_id)) map.set(row.inquiry_id, row.message_id);
+  }
+  return map;
+}

 async function sendStageEmail(
   row: DueRow,
+  inReplyTo: string | undefined,
   build: (input: { recipientName: string; origin: string; refCode: string }) => {...},
 ): Promise<void> {
   const origin = await getAppOrigin();
-  const { subject, html, text } = build({ recipientName: row.name, origin });
+  const { subject, html, text } = build({ recipientName: row.name, origin, refCode: row.ref_code });
   const sender = await getEmailSender();
-  await sender.send({ to: row.email, subject, html, text });
+  await sender.send({ to: row.email, subject, html, text, ...(inReplyTo ? { inReplyTo } : {}) });
 }
```

Each of the three loops in `runInquiryFollowupSweep` calls `lastInboundMessageIds(admin,
rows.map(r => r.id))` **once**, right after its `listDueFor*` call and before iterating,
and passes `inReplyToMap.get(row.id)` into `sendStageEmail` per row — one extra query per
tier per tick, not one per due row. This mirrors `listInquiryMessages`'s own batching
shape exactly, and keeps `sendInquiryReply`'s single-row lookup (admin-click context, not
a sweep) as the only legitimate non-batched call site for this pattern.
*(Minor note — independent audit 2026-08-25, PARTIALLY TRUE: `.order('created_at', {
ascending: false })` above has no explicit tiebreaker for two rows sharing an identical
`created_at`, so "first = most recent" isn't formally guaranteed by the query alone. In
the one realistic collision case — a redelivered Graph webhook for the same inbound
message — both competing rows carry the same `message_id` anyway, so the ambiguity is
harmless in practice. Not changed here.)*

**Separately — independent audit 2026-08-25, CONFIRMED (table row 8)**:
this file's `runInquiryFollowupSweep` sends the email *before* updating the relevant
stamp (`reminder_sent_at` etc.), with no claim/UNIQUE/idempotency-key protection against
a crash or timeout in between — unlike this codebase's own `auto-thankyou.ts`, which
solves the identical send-then-persist shape with `policy: 'singleton'` **and** a
`UNIQUE` constraint, reasoned about explicitly in its own code. Under today's
single-worker-instance configuration (`localConcurrency=1`) this can't produce a
*concurrent* double-send, but a bad-timing crash between `send()` and the stamp
`UPDATE` still causes a duplicate send on the next tick — no concurrency needed, just an
unlucky restart. Pre-existing in this file, not introduced by this plan.

**CORRECTED (internal-consistency pass, 2026-08-25 — flagged by an independent gap-check
against the actual codebase): this paragraph originally said the fix was "not required...
not folded into this plan's required diff," deferred to §4 as a follow-up.** That line was
written before §2.6 below existed and was never updated after §2.6 was added ("Added after
this plan's own status was challenged — 'we don't leave things open'"). §2.6 is the
authoritative, later section: it makes the `worker/main.ts` singleton-list addition and the
`EmailSender.send()` `idempotencyKey` passthrough part of this plan's **required** diff, not
a deferred follow-up. Treat §2.6 as controlling; this paragraph is retained only for its
still-accurate diagnosis of the underlying gap, not for its now-superseded "not required"
conclusion.

**`src/lib/data/inquiry-mail-intake.ts`** — full `findExistingInquiry`,
`hasSameSenderInquiry`, and `attachReplyToInquiry` are spelled out in §2.5, including the
`AdminClient` type alias, the DB-error handling on both matching tiers, the
cancelled-guard (with the `inquiry_messages` insert now ordered ahead of it), the
cascade-stamp reset, and the same-sender pre-check before the generic "new inquiry"
alert (§2.3 point 6). *(Correction — independent audit 2026-08-25, CONFIRMED, table row
2: this line previously claimed the same-sender pre-check was "already spelled out in
§2.5" when in fact no such function existed there at all — a real gap between what this
table claimed and what the plan actually contained, in a document that presents itself
as "concrete code... spelled out." `hasSameSenderInquiry` has now been added to §2.5,
making this line accurate.)*

## 4. Risks / open questions

- **Backfill for the 8 existing rows**: needs a `ref_code` before the constraint can be
  `NOT NULL` — same verify-first pattern as today's CHECK constraint (confirm no
  existing row would collide/violate before applying). The DEFAULT expression handles
  both the backfill and all future inserts identically (§2.1/§2.5).
- **`ref_code` entropy/collision, decided**: 32 bits, DB-generated by `DEFAULT`, no
  app-layer retry logic (§2.1). Accepted as negligible at this table's realistic scale.
  The two insert paths differ in what a collision (however rare) would do if it ever
  happened: `intakeMailAsInquiry`'s upsert runs inside the worker's webhook claim/retry
  loop (`worker/main.ts` → `src/lib/data/webhooks.ts`, up to 5 attempts, ~1/minute), so
  it self-heals on retry with a fresh draw. `insertContactMessage` (the public
  contact-form Server Action) has no retry budget — a collision there would surface as
  one failed submission (`{ ok: false }`) to that customer. If inquiry volume grows
  enough to make this a real concern, raising the byte count (and updating §2.1/§2.2's
  examples and §2.5's regex to match) is a one-line change; not pre-emptively done here
  since the current volume doesn't warrant it.
- **Reopening a cancelled inquiry, and cascade-stamp leakage across reopen cycles**
  (§2.3 points 4–5): both were pre-existing gaps in the currently-live
  `attachReplyToInquiry`, dormant only because the unfixed `conversationId` fallback
  rarely matches Resend-sent mail. This plan's `ref_code` tier makes reopening routine,
  which is exactly why both are fixed here rather than left as-is. **Not independently
  verified**: whether reopening is *already* reachable today, before this plan ships,
  for `source='outlook'` rows specifically (their `thread_id` is populated from the
  original inbound `conversationId` at `inquiry-mail-intake.ts:122`, and Exchange's own
  threading for a mail-originated reply may already correlate independently of
  `ref_code`). If so, both bugs may already be live in production today rather than only
  becoming reachable once this plan ships — worth checking against real data before
  treating this as purely prospective (§5 adds a check for this).
- **Headers are outbound-only in this design** (§2.4): a real inbound
  `In-Reply-To`/`References` matching tier is deliberately out of scope for this plan
  (needs a new Graph field plus outbound-message-id capture that doesn't exist yet) —
  tracked in §6, not silently dropped.
- **Voximplant's `(387)` suffix** in their subjects looks like a *second*, different
  identifier (possibly their own internal ticket/case number) — not fully understood
  from mailbox evidence alone, not proposed for KALFA; noted for completeness only.
- Still **cannot be verified with certainty short of a live send-and-reply test** — the
  docs establish the correct, industry-standard design, but only a real round-trip
  confirms this tenant's Exchange actually threads it as expected. Proposed as a
  verification step after implementation, before considering this closed.
- **`runInquiryFollowupSweep`'s send-then-persist ordering** (`inquiry-followup.ts`, a
  file this plan already edits) — see the note in §3.1 above the `inquiry-mail-intake.ts`
  diff for the full reasoning. **Closed by §2.6, not a deferred follow-up**: the Resend
  `idempotencyKey` passthrough and the `worker/main.ts` singleton-list addition are part
  of this plan's required diff (§2.6 supersedes this bullet's earlier "not required"
  framing — internal-consistency pass, 2026-08-25). **(Independent audit 2026-08-25,
  table row 8.)**
- **Whether to add a `CHECK` constraint enforcing `ref_code`'s format** — not added in
  §2.5's migration. This is a judgment call, not a code fix; see §4.1 below.
  **(Independent audit 2026-08-25, CONFIRMED, table row 12.)**
- **Additional gaps confirmed by independent audit 2026-08-25, not blocking, recorded
  for completeness — none implemented in this plan:**
  - The Slack alert on a cancelled-row reply is no longer the *only* trace of what
    happened — that's now the `inquiry_messages` row itself (§2.3 point 4 / §2.5's
    `attachReplyToInquiry` fix, above). But the alert itself remains less reliable on
    its own terms than it might appear: `sendSlackAlert`'s dedup window is keyed on
    `level|title|source` for 60 seconds, not on `contactMessageId`, so two different
    cancelled inquiries replied to within the same minute could see one alert
    suppressed; and `logOpsAlert` does not persist the `fields` payload at all
    (`ops_alerts`'s own migration comment describes it as "a delivery log, not an
    error log") — so even a delivered alert isn't queryable by `contactMessageId`
    afterward. Neither is fixed here; the DB-row fix above is what actually closes the
    auditability gap, not this alert. (Table row 16.)
  - `submitInquiryRating` (`src/lib/data/inquiry-rating.ts`) is a single `UPDATE` with
    no history — a second follow-up cycle's rating silently overwrites the first, and
    no admin UI currently reads `rating_score`/`rating_comment`/`rating_at` at all
    (grep-confirmed empty). Pre-existing, unrelated to the reopen mechanics this plan
    adds, not fixed here. (Table row 19.)
  - `updateContactStatus` (manual admin status change,
    `src/lib/data/admin/contacts.ts`) does not stamp `replied_at`. Combined with this
    plan's cascade-stamp reset on reopen (§2.3 point 5), an admin who manually moves a
    case out of a terminal status without actually sending a reply can make it eligible
    for an **immediate** reminder send on the very next sweep tick
    (`reminder_sent_at IS NULL` right after the reset, while `replied_at` is already
    stale enough to satisfy `listDueForReminder`'s window). This is new reachability
    this plan introduces — before this plan, the old, un-reset `reminder_sent_at` used
    to block it. Needs either `updateContactStatus` to also stamp `replied_at` when
    leaving a terminal status without an actual reply, or an explicit decision to
    accept this as a known limitation. (New finding, independent audit 2026-08-25.)
  - `inquiry_messages.message_id` has no `UNIQUE` constraint — a redelivered Graph
    webhook (at-least-once delivery) could in theory insert two identical rows for the
    same inbound message. Pre-existing gap, not created or worsened by this plan, not
    fixed here.
  - Three separate "status vocabularies" exist in this codebase today:
    `types.generated.ts` (no enum union), `ContactStatus` in
    `src/lib/validation/admin.ts` (4 values, explicitly excluding `'reopened'` as
    "system-set only"), and the `contact_messages_status_check` migration's `CHECK` (5
    values). This plan's own `InquiryMatch.status: 'cancelled' | (string & {})` is
    type-equivalent to `string` (the `(string & {})` branch absorbs every literal), so
    this doesn't cause a compile error, but the three vocabularies staying
    unreconciled is worth knowing about. Out of scope for this plan.

## 4.1 Decisions requiring explicit owner sign-off (not resolved by this plan)

Flagged by independent audit 2026-08-25 as judgment calls the code/design cannot settle
on its own — listed here so each gets an explicit ruling rather than an implicit default:

1. **RESOLVED — owner ruling, 2026-08-25: "מקרה קיצון לחלוטין" (a genuine edge case).**
   A legitimate customer who replies from a different address than the one on file
   (§2.3 point 7, above) is not served by this plan as designed, and triggers a
   spoofing-flavored `warn` alert against someone who did nothing wrong. Owner
   explicitly accepted the current behavior as-is — no wording/level softening, no
   identity-verification follow-up. Not revisited unless it proves more common than
   expected in practice.
2. **Whether to add a `CHECK` constraint enforcing `ref_code`'s format**
   (`~ '^[0-9A-F]{8}$'`, precedent: `contact_messages_status_valid` on this same
   table). Today only the column `DEFAULT` produces a valid value; nothing at the DB
   level stops a future explicit insert from writing something else, which would then
   silently never match `REF_CODE_RE` on intake. Not added to §2.5's migration —
   flagged as a decision, not defaulted either way.
3. **Whether 32-bit `ref_code` entropy is acceptable long-term**, or whether to widen
   it pre-emptively rather than waiting for volume to justify it. §2.1 already
   documents the current tradeoff and the (now precisely recomputed, 0.0116%-at-1,000-
   rows) collision math; this decision is about whether to act pre-emptively, not
   whether that math is right.
4. **Null-out vs. preserve-with-`WHERE`-change for the five cascade columns on reopen**
   (§2.3 point 5) — already a considered, documented tradeoff in this plan (simplicity
   over full cross-cycle audit history in the admin UI). Listed here only so it sits
   alongside the other decisions in one place, not because it's newly in question.
5. **Destroying `rating_token` on every reopen, even if it was already used to submit
   a rating** (§2.3 point 5) — already a deliberate fail-closed choice in this plan.
   Listed here for the same reason as #4.

## 5. Verification steps (after implementation, before considering this done)

**Reordered and extended — independent audit 2026-08-25.** The list below replaces the
earlier draft's ordering and numbering wholesale (rather than inserting items
piecemeal) for one concrete reason: the original order put static gates (`tsc --noEmit`
etc.) *before* both the migration apply step and a types-regeneration step that doesn't
otherwise exist in the list, which would have run the type-checker against a
`ref_code` column that doesn't exist in `types.generated.ts` yet. No other section of
this plan cross-references a step by number, so renumbering here is safe.

1. **Live-data pre-apply check** on `contact_messages` (row count, existing values;
   confirm `pg_extension`/search_path for `gen_random_bytes`) — before applying the
   migration, same process as the CHECK constraint.
2. **Apply the migration**, after explicit go-ahead — this plan remains PLAN ONLY until
   then, per the standing instruction at the top of this document.
3. **Regenerate `types.generated.ts`** via `supabase gen types`, immediately after the
   migration lands and before the static gates below. **Added — independent audit
   2026-08-25 (CONFIRMED, table row 5):** every `.eq('ref_code', ...)`, `msg.ref_code`,
   and `row.ref_code` reference in this plan's own code fails to type-check against the
   current, un-regenerated `types.generated.ts`, and this project's deploy gate blocks
   on schema drift (memory: supabase-types-drift-gate) — this step must sit between
   "apply" and "static gates," not be assumed implicit inside them.
4. **Static gates**: lint, `tsc --noEmit`, `next build`, full test suite.
5. **Real round-trip test**: send one of the 4 templates to a real mailbox, reply as a
   customer would, confirm `intakeMailAsInquiry` matches it via `ref_code` (not
   `conversationId`) and reopens the correct row.
6. **Tier-1 (`ref_code`) sender-mismatch** — a reply whose subject carries a valid,
   matching `[KLF-XXXXXXXX]` token but a `From:` address that does **not** match the
   row's stored `email` must fall through to tier 2 (not attach on the `ref_code`
   alone), and must fire the `warn`-level `'קוד פנייה תואם אך כתובת שולח לא תואמת'`
   Slack alert. **Added — independent audit 2026-08-25:** §2.3 point 2 presents this
   exact check as the plan's core security contribution ("closes the spoofing gap"),
   yet the original verification list only exercised the older tier-2 check (next item)
   and never exercised tier 1 directly — the single most significant gap the audit
   found in this section.
7. **Tier-2 (`conversationId`) sender-mismatch**: a matched `conversationId` with a
   different `From:` address must **not** attach — confirms the check on the fallback
   tier actually rejects, not just the primary tier. Per §2.3 point 3, this tier does
   **not** fire its own Slack alert on a mismatch (an intentional, documented
   asymmetry, not a gap) — confirm only the non-attachment here, not an alert.
8. **Cancelled-row match (either tier)**: the reply is **always** written to
   `inquiry_messages` — confirm it's visible in the admin thread view — while `status`
   and the cascade columns stay untouched, and the distinct `'לקוח הגיב לפנייה שבוטלה'`
   alert fires instead of the normal reopen alert. **Strengthened — independent audit
   2026-08-25 (table row 3):** the earlier draft of `attachReplyToInquiry` discarded
   the message body entirely on a cancelled match before this fix; the durable check is
   now the DB row, not just the (best-effort, dedup'd) Slack alert.
9. **`findExistingInquiry` DB-error resilience**: a simulated/forced failure on either
   the `ref_code` or `conversationId` lookup query must surface as a thrown error, not
   silently fall through as "no match" (which would recreate the exact disconnected-row
   failure mode from §0's live incident, under a different trigger). **Added —
   independent audit 2026-08-25 (table row 1).**
10. **Full-cascade-then-reopen**: a row with `auto_closed_at`, `rating_requested_at`,
    and `rating_token` all set, then reopened by a matched reply, ends up with all five
    cascade columns (`reminder_sent_at`, `closing_warning_sent_at`, `auto_closed_at`,
    `rating_requested_at`, `rating_token`) null — and, separately, that `rating_score`/
    `rating_comment`/`rating_at` are **unchanged** if the row had already been rated.
11. **Reminder-only-then-reopen**: a row with only `reminder_sent_at` set, reopened,
    then left silent again past 24h — confirm it gets a **reminder**, not a warning
    (i.e. it isn't skipped to a later stage by a leftover stamp).
12. **`ref_code` case-insensitivity**: a subject with a lowercase or mixed-case bracket
    tag still matches (defends against any future generation path or gateway
    re-casing).
13. **Same-sender "possible unmatched reply" alert, including the escaping edge case**:
    a reply from a known sender's address whose subject and `conversationId` both fail
    to match fires the distinct warn-level alert, not the generic new-inquiry one —
    and, separately, a stored `email` containing an underscore (e.g.
    `dana_levi@gmail.com`, a valid and common address) is matched correctly, not
    treated as a wildcard, by the `ILIKE` check in `hasSameSenderInquiry` (§2.3 point 6
    / §2.5). **The escaping half is added per independent audit's review of this
    fix**: an unescaped `ILIKE` would silently over-match on `_`/`%`.
14. **`inquiry-followup.ts`'s batched last-inbound-message lookup** runs once per tier
    per sweep tick (one query for N due rows), not once per row — confirm via a
    query-count assertion or log inspection with N > 1 due rows in one tick.
15. **Confirm live whether reopening is already reachable today** (pre-implementation)
    for `source='outlook'` rows via the existing unmodified `conversationId` path, per
    the open question in §4 — informs whether points 8–11 above are closing a
    not-yet-shipped risk or an already-live one.
16. **Tenant DMARC/EOP enforcement — cannot be determined from code alone (independent
    audit 2026-08-25):** check whether Exchange Online Protection on this M365 tenant
    already rejects or flags mail with a spoofed `From:` header before
    `fetchInboundMail` ever sees it. If so, the sender-email check in §2.1/§2.3 is
    *stronger* in practice than this plan currently credits it as being (§2.1 only
    states the check is "not cryptographic proof of identity" — a downside framing) —
    a genuine open upside to confirm, not just a residual gap.
17. **`nodemailer`'s outbound `Message-ID` exposure — cannot be determined from code
    alone (independent audit 2026-08-25):** confirm whether `transporter.sendMail()`'s
    result (`info.messageId`) actually surfaces the auto-generated RFC 5322 Message-ID
    in this project's nodemailer version/config. Bears directly on the outbound
    Message-ID capture work parked in §6 — if it doesn't expose one directly, that
    follow-up needs a different approach (e.g. explicit `messageId` generation before
    send) than assumed there.
18. **`supabase db push` transaction scope — cannot be determined from code alone
    (independent audit 2026-08-25):** confirm whether this migration file runs as a
    single transaction. Doesn't change the safety conclusion either way — every
    statement in §2.5's SQL is independently idempotent — but worth confirming rather
    than assuming.
19. **Send idempotency (§2.6)**: force the same stage's send to run twice with the same
    `id`/`replied_at` (e.g. by simulating a crash between send and stamp-write, or by
    manually re-invoking `sendStageEmail` for an already-`reminder_sent_at`-null row
    with an unchanged `replied_at`) and confirm Resend's `409 concurrent_idempotent_requests`
    / cached-result behavior actually suppresses the second send rather than mailing the
    customer twice. Also confirm a **second cascade cycle** (after a reopen resets the
    stamps, §2.3 point 5) with a genuinely new `replied_at` produces a **new**
    idempotency key and is **not** suppressed by the first cycle's already-used one.

## 6. Out of scope (not touched by this plan)

- **Inbound `In-Reply-To`/`References` matching as a real third tier** (§2.4): would
  need `internetMessageHeaders` added to the Graph `$select`
  (`src/lib/microsoft/mail.ts:78`), new fields on `InboundMail`, a new matching branch
  in `findExistingInquiry`, and — the harder half — capturing KALFA's own outbound
  Message-ID on the `inquiry_messages` row so a direct reply's `In-Reply-To` has
  something to match against (not just a `References` chain carrying the original
  inbound message forward). Parked because the `ref_code` tier already covers the
  common case and this is a materially larger change.
- The Power Automate research (parked separately, per explicit instruction — "שם את זה
  בצד אל תשכח את הנושא הזה").
- Any change to the rating page pre-selection fix (already shipped this session).
- **SMTP-path send idempotency** (§2.6): the `EMAIL_PROVIDER=smtp` fallback has no
  protocol-level idempotency mechanism the way Resend's REST API does. A permanent
  transport-agnostic DB send-record was considered specifically because it would have
  closed this too, and rejected on scope grounds (§2.6) — the live transport is confirmed
  `resend` (verified in `.env.local`, 2026-08-25), not `smtp`, so this is a known gap for
  a future rollback scenario, not the active path today, and not worth a standalone fix
  on its own merits either.
- **`.claude/fleet/roles/support-drafter.md` has no `reopened`-status trigger — owner-only
  file, outside this plan's edit scope, not fixed here.** Verified live 2026-08-25: the
  role's entire trigger query is `status = 'new' AND draft_reply IS NULL`
  (`support-drafter.md:27`, `fleet.json`, `bin/scheduler.mjs:197`) — zero mentions of
  `reopened` anywhere in the role spec. **Corrected after an initial misread of this same
  file**: `fleet.json` (line 57) has `"enabled": true` — the role runs today, on a real
  schedule (09:30/15:30 weekdays) and reactively on `contact_messages_new`. A stale
  comment two lines above the config (`$support_drafter_comment`, still reading "Kept
  enabled:false") no longer matches the field it's describing — a real, separate
  documentation-drift finding in that file, not something this plan touches either. So
  this gap is **not** a future concern — it is live and already skipping every reopened
  inquiry today, and this plan makes it materially worse: before `ref_code`, a reply
  reliably reaching `attachReplyToInquiry` (and therefore `status='reopened'`) was the
  uncommon case (§0's whole premise, `conversationId` rarely matching); after this plan
  ships, it becomes the expected path for any inquiry a customer replies to more than
  once. The owner should know this is active now, not something to discover later.
