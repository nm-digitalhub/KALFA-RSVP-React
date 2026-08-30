# Inbound inquiry routing + deterministic reply association

**Status:** plan only — nothing implemented, nothing applied.
**Date:** 2026-08-26
**Follows:** `docs/inquiry-email-threading-fix-plan-2026-08-25.md` (shipped and live).
That plan made a reply *match* the right inquiry once it reaches the app. This one
closes the two gaps it left open: getting the reply into the app at all, and
matching it by something stronger than a subject string.

Everything marked **VERIFIED** below was checked against the live tenant, the live
Resend account, the installed SDK, or a primary Microsoft doc page during research
on 2026-08-26. Everything marked **INFERRED** or **UNRESOLVED** was not, and is
called out as such rather than smoothed over.

---

## 0. The two problems

### 0.1 Nothing routes mail into the intake folder

`intakeMailAsInquiry` only ever sees mail that lands in one specific folder.
The Graph subscription resource is
`/users/{mailbox}/mailFolders/{folderId}/messages` where the folder is
`MS_GRAPH_INTAKE_FOLDER` (`subscriptions.ts:75-80`).

- **VERIFIED** (live): `MS_GRAPH_INTAKE_FOLDER=KALFA-Intake`,
  `MS_GRAPH_PRIMARY_MAILBOX=netanel.kalfa@kalfa.me`.
- **VERIFIED** (live, `Get-MailboxFolderStatistics`): the folder exists, 4 items.
- **VERIFIED** (live, two independent APIs): there is **no rule of any kind**
  moving mail into it. `Get-InboxRule` → `(no results)`.
  `GET /users/{mb}/mailFolders/inbox/messageRules` → HTTP 200, `0` rules.

Consequence, observed in production on 2026-08-25: the owner replied as a customer,
the reply landed in the Inbox, and **nothing happened until the owner dragged it
into `KALFA-Intake` by hand.** Every customer reply has this failure mode. It is
not intermittent — it is the default.

The mailbox is the owner's mixed personal/business mailbox, so pointing the
subscription at `inbox` instead is not an option: `subscriptions.ts:72` already
warns "Set it to `inbox` only if the mailbox is genuinely dedicated to customer
mail." It is not.

### 0.2 Association rests on the weakest available signal

The shipped design matches a reply to its inquiry by the `[KLF-XXXXXXXX]` token in
the subject (tier 1) or Graph's `conversationId` (tier 2).

**VERIFIED against RFC 5322** (rfc-editor.org):
- §3.6.5, subject: a reply's subject "**MAY** start with the string 'Re: '". MAY.
  Nothing obliges a client to preserve the rest of the subject either.
- §3.6.4, identification: "reply messages **SHOULD** have In-Reply-To: and
  References: fields as appropriate", and `In-Reply-To` carries the `Message-ID`
  of the message being replied to.

So the plan built its primary tier on a MAY and left the SHOULD unused. §2.4 of
that plan explicitly parked this, reasoning that capturing our own outbound
Message-ID "needs a follow-up `GET /emails/{id}` round-trip" that didn't exist.

**That reasoning was right about the mechanism and wrong about the cost** — see §2.

---

## 1. What was verified about the routing options

Four independent research tracks. Findings that constrain the design:

### 1.1 Inbox rules cannot pattern-match

**VERIFIED** (`New-InboxRule` doc): `SubjectContainsWords` — "Supports wildcards:
**False**", max 255 characters. No regex, no wildcards.

### 1.2 Transport rules CAN pattern-match but cannot move to a folder

**VERIFIED** (mail-flow-rule conditions doc): `SubjectMatchesPatterns` takes real
regular expressions, org-wide, and is not bound by the 255-char limit (org-wide
budget: 8 KB per rule, 20 KB for all patterns combined, max 300 rules).

**VERIFIED** (mail-flow-rule actions doc): there is **no** move-to-folder action.
Transport rules run before delivery; "folder" is a mailbox-level concept.

The workaround — transport rule stamps `X-KALFA-Inquiry`, inbox rule routes on it —
has an unverified link: `New-InboxRule -HeaderContainsWords` is documented only as
matching "the header fields of messages", with no statement that it reads custom
`X-` headers. **UNRESOLVED.** Not chosen.

### 1.3 `subjectContains` match semantics — genuinely undocumented

This was researched down the full chain and **could not be resolved**:

| Layer | Result |
|---|---|
| Graph `messageRulePredicates` | "strings that appear in the subject" — no semantics |
| `New-InboxRule -SubjectContainsWords` | "**words or phrases**", wildcards False |
| Outlook COM `olConditionSubject` | "Subject contains **words** specified in…" |
| MS-OXORULE `PidTagRuleCondition` | condition is a restriction (MS-OXCDATA §2.12) — **does not say which FuzzyLevel a standard condition uses** |
| MS-OXCDATA `FL_SUBSTRING` (0x0001) | "matches **some portion** of the value" — i.e. raw substring, *if* selected |

Two **independent** Microsoft product surfaces (PowerShell and Outlook COM) say
"words", not "substring". The open protocol leaves the choice to the
implementation and Microsoft never documented it.

**Re-checked 2026-08-26 against two further sources, still unanswered:**
- `New-MgUserMailFolderMessageRule` (Graph PowerShell) — its CONDITIONS notes say
  only *"[SubjectContains <String[]>]: Represents the strings that appear in the
  subject…"* and, identically, *"[HeaderContains <String[]>]: …the strings that
  appear in the headers…"*. No semantics.
- `POST /mailFolders/{id}/messageRules` — the request example uses
  `senderContains`, and the page says nothing about how condition strings are
  evaluated.

**Five Microsoft sources now checked; none defines the matching rule.** This is
not a gap in the search — it is genuinely undocumented, and §9.6/§9.7 is the only
way to settle it.

**Practical consequence, and it is decisive for the design:** `"[KLF-"` may or may
not match, depending on whether the engine tokenizes on `[` and `-`.
`"KLF"` matches under **both** readings — it is a clean alphanumeric token *and* a
substring. So the routing rule must use `KLF`, and the app must extract the exact
code itself. Precision moves out of the rule and into code we control.

### 1.4 Address-based matching is the only string-free option

**VERIFIED** (`messageRulePredicates`): predicates split into two kinds.
- `Collection(String)` — `subjectContains`, `headerContains`, `recipientContains`.
  Subject to §1.3's ambiguity.
- `Collection(recipient)` — `sentToAddresses`, `fromAddresses`. **Address equality.
  No string interpretation at all.**

**VERIFIED** (live tenant, `Get-OrganizationConfig`):
`DisablePlusAddressInRecipients = False` → plus addressing is **already active**,
no change needed. (The older `AllowPlusAddressInRecipients` opt-in was replaced;
Microsoft enabled this by default.)

**VERIFIED** (M365 alias doc): up to **400 aliases** per user, "No additional fees
or licenses are required", requires Exchange Administrator (we have it, app-only),
**up to 24 hours to propagate**. That 24h is why an alias-per-inquiry is
impossible: a customer can reply within minutes of the first email.

### 1.5 Ruled out

- **Distribution list** — no mailbox, no Inbox, no message store. Graph cannot
  subscribe to it. Not applicable.
- **Transport rules keyed on a plus-address** — Microsoft documents that mail flow
  rules cannot reliably distinguish a plus address from the base address.
- **Custom `X-` headers as a reply signal** — not preserved by replying clients.
  (Our own outbound headers never come back.)
- **`RequireSenderAuthenticationEnabled = True`** — **VERIFIED** on real mail:
  every inbound message, including the owner's own from Gmail, carries
  `X-MS-Exchange-Organization-AuthAs: Anonymous`. Enabling this would block the
  owner too. Only meaningful for intra-tenant mail.

---

## 2. The finding that changes the design: Resend exposes the Message-ID

§2.4 of the previous plan assumed capturing our outbound Message-ID was expensive.
It is not, but it is also not free, and the exact shape matters.

**VERIFIED — installed Resend SDK type definitions.** Checked first against
`resend@6.20.0`, then **re-checked after an upgrade to `6.22.1` on 2026-08-26**:
both response contracts below are byte-identical across the two versions, so the
measurements in §4.3 (taken on 6.20.0) still hold.

```ts
interface CreateEmailResponseSuccess {   // what send() returns
  id: string;                            // ← ONLY this. No message_id.
}

interface GetEmailResponseSuccess {      // what GET /emails/{id} returns
  id: string;
  message_id: string;                    // ← the RFC 5322 Message-ID
  last_event: 'queued' | 'sent' | 'delivered' | …;
  …
}

interface BaseEmailEventData {           // webhook payload for email.sent etc.
  email_id: string;
  message_id: string;                    // ← also here
  …
}
```

**VERIFIED — live Resend account, exact match against real inbound mail:**

| Source | Value |
|---|---|
| Resend `message_id` (email `73b3a1ba…`, the admin reply of 25.8 19:28) | `<010201a03a656355-b60157fb-b56c-4bc7-9496-b446e3b75863-000000@eu-west-1.amazonses.com>` |
| `In-Reply-To` on the customer reply that came back | `<010201a03a656355-b60157fb-b56c-4bc7-9496-b446e3b75863-000000@eu-west-1.amazonses.com>` |

Byte-identical. Confirmed a second time on the reminder email (`451c3e0e…`) and its
reply. **This is an exact-equality join key, not a string match.**

**Disproven along the way:** the UUID embedded inside the SES Message-ID is *not*
the Resend `id` — `GET /emails/{that-uuid}` returns **404**. The two identifiers
are unrelated and both must be stored if both are wanted.

### 2.1 The chain is only half-proven, and the missing half is the point

Verifying the above raised an objection worth recording, because it bounds what the
evidence actually shows.

**VERIFIED** (live DB, `inquiry_messages` grouped by direction):

| direction | rows | with `message_id` | without |
|---|---|---|---|
| inbound | 11 | 2 | 9 |
| outbound | **5** | **0** | **5** |
| draft | 5 | 0 | 5 |

Every outbound row we have is `message_id = NULL`. So the join proposed in §3.2
would have matched **nothing** on any existing message. What §2 proves is:

- the inbound reply carries a correct `In-Reply-To` — **proven**;
- it equals the `message_id` Resend holds for our outbound mail — **proven**;
- our database holds that value — **false today; this plan is what makes it true.**

The middle link — that the value captured at send time is the same value that comes
back — is **INFERRED** from the two ends matching. It is not separately provable
without implementing the capture. Stated here rather than glossed.

### 2.2 What actually went out yesterday, and why the duplicate happened

**VERIFIED** — live Resend account, all mail sent on 2026-08-25:

| time (UTC) | subject | thread row written? |
|---|---|---|
| 13:50:36 | עדיין צריך עזרה? — הפנייה שלך אצלנו | **no** |
| 13:50:37 | הפנייה שלך תיסגר בקרוב — KALFA | **no** |
| 13:50:38 | איך היה השירות שקיבלת מ-KALFA? | **no** |
| 19:28:37 | Re: [KLF-F9F89C6B] תגובה לפנייתך — KALFA | yes (admin reply) |

All four `delivered`. The first three are the follow-up cascade
(reminder 24h → closing warning 72h → auto-close + rating 96h,
`inquiry-followup.ts`). They fired seconds apart rather than across four days
because inquiry `b033f8ef` was already old (16.8) when the feature shipped, so the
first sweep found it eligible for all three stages at once.

**VERIFIED** (live DB, thread of `b033f8ef`): four rows — inbound 16.8 10:15,
draft 16.8 11:41, outbound 16.8 11:43, inbound 25.8 13:53. **The thread jumps from
16.8 straight to the customer's reply on 25.8.** Three real emails reached the
customer in between and left no record.

**And this is the direct cause of the incident the previous plan was written for:**
the customer's reply carries
`In-Reply-To: <010201a0392feb21-…@eu-west-1.amazonses.com>` — a byte-exact match
for the 13:50:36 reminder. Had that email been recorded with its `message_id`, the
association would have been immediate and certain, with no dependence on the
subject at all. Instead there was nothing to match against, and duplicate inquiry
`42194bf7` was created.

> **State note — the data was repaired by hand on 2026-08-26, after the incident
> and before this plan.** The orphaned reply was moved onto `b033f8ef` (which is
> why it appears in the thread above), `b033f8ef` was set to `reopened` with its
> cascade stamps cleared and the Graph `conversationId` adopted, and `42194bf7`
> was set to `cancelled` with its `thread_id` cleared so it can never win a tier-2
> match. **VERIFIED** post-merge: `b033f8ef` = `reopened`, `42194bf7` =
> `cancelled`; row counts unchanged at inbound 11 / outbound 5 / draft 5, all
> outbound still `message_id = NULL`.
> So the thread listed above is the *repaired* state. The failure it documents was
> real; the evidence for it now lives on the merged row rather than on the
> duplicate.

---

## 3. Design

Two layers, each doing only what it is actually good at.

```
                    outbound (we send)                inbound (customer replies)
                    ──────────────────                ──────────────────────────
  sender.ts  ──►  Resend send() ──► {id}
                        │
                        ├─► GET /emails/{id} ──► message_id
                        │                            │
                        ▼                            │        Exchange
   inquiry_messages(direction:'outbound',            │      inbox rule
                    message_id: <ours>) ◄────────────┼──── subjectContains:["KLF"]
                        ▲                            │      → moveToFolder(KALFA-Intake)
                        │                            │              │
                        │   exact equality join      ▼              ▼
                        └──────────────────  In-Reply-To      Graph subscription
                                             / References  →  intakeMailAsInquiry
```

- **Routing** decides *where mail lands*. Imprecision here is cheap: a false
  positive is a non-inquiry sitting in a folder, which the matching layer then
  declines to associate.
- **Association** decides *which inquiry a reply belongs to*. This must be exact,
  and now can be.

### 3.1 Routing layer

**A gap found on the full read-through, and it changes this section.** An earlier
draft specified a single subject-based rule. That is wrong, and the error is
structural rather than cosmetic:

> Routing runs **before** association. If a reply is not routed into
> `KALFA-Intake`, `intakeMailAsInquiry` never sees it, and tier 0 never executes.
> So a subject-only rule makes the *whole* design — including the exact
> Message-ID join — inherit the subject's fragility. The very case tier 0 exists
> for (a reply whose `[KLF-…]` tag was stripped or rewritten) is a case the
> routing layer would silently drop.

Two rules are therefore required, and they are **separate rules on purpose**:
multiple conditions inside one rule are AND-ed, which would make the net narrower,
not wider. Two rules give the OR.

**Rule A — threading headers (primary).** Catches any reply to anything we sent,
regardless of what happened to the subject:

```jsonc
POST /users/netanel.kalfa@kalfa.me/mailFolders/inbox/messageRules
{
  "displayName": "KALFA — reply to our mail (headers)",
  "sequence": 1,
  "isEnabled": true,
  "conditions": { "headerContains": ["eu-west-1.amazonses.com"] },
  "actions": { "moveToFolder": "<KALFA-Intake id>", "stopProcessingRules": true }
}
```

Basis: **VERIFIED** on both real customer replies — each carries
`In-Reply-To`/`References` pointing at our outbound id, and every one of our
outbound ids ends in `@eu-west-1.amazonses.com` (Resend→SES; the domain is
**VERIFIED** verified in Resend, region `eu-west-1`).

**Rule B — subject token (fallback).** Catches mail whose headers were stripped by
an intermediary but whose subject survived:

```jsonc
{
  "displayName": "KALFA — inquiry token in subject",
  "sequence": 2,
  "isEnabled": true,
  "conditions": { "subjectContains": ["KLF"] },
  "actions": { "moveToFolder": "<KALFA-Intake id>", "stopProcessingRules": true }
}
```

- **VERIFIED**: `MailboxSettings.ReadWrite` is granted to the app (read from the
  live token's `roles` claim). `GET …/messageRules` already returns HTTP 200.
  No new permission, no PowerShell, no org-level change.
- `"KLF"` not `"[KLF-"` — see §1.3. The exact code is extracted in code by
  `REF_CODE_RE`, which already exists and already handles case-insensitivity.
- `stopProcessingRules: true` — **VERIFIED** (Microsoft Graph PowerShell reference,
  `New-MgUserMailFolderMessageRule`, ACTIONS complex-parameter notes):
  *"[StopProcessingRules <Boolean?>]: Indicates whether **subsequent rules should
  be evaluated**."* Paired with `sequence`, documented on the same page as
  *"Indicates the order in which the rule is executed, among other rules."*
  So rule A (sequence 1) matching genuinely prevents rule B (sequence 2) from
  running. No longer an assumption.

**Two honest limits on rule A:**
1. `headerContains` is a `Collection(String)` predicate and so inherits §1.3's
   tokenisation ambiguity. `eu-west-1.amazonses.com` is dotted/hyphenated
   alphanumerics — better odds than `[KLF-`, but **UNRESOLVED** until test §9.6.
   This is precisely why rule B exists as an independent net.
2. It matches replies to **every** Resend send, including agreements and
   event-cancellation mail (§4.2 scope note). Those will be moved into
   `KALFA-Intake` too. **This is harmless by construction**: tier 0 finds no
   matching outbound row, tiers 1–2 find no match either, and
   `hasSameSenderInquiry` fires the "possible unmatched reply" warn alert instead
   of silently creating a bogus association. It is noise in a folder, not a
   correctness failure — but it *is* a behaviour change worth naming (§6.1).

**Open question for the owner (§6.1):** `"KLF"` in rule B will also match an
unrelated personal email containing that string. Low probability in a Hebrew
mailbox, non-zero. A dedicated address (§6.2) removes the question entirely but is
a larger change.

### 3.2 Association layer

New **tier 0** in `findExistingInquiry`, before the existing ref_code tier:

1. Parse `In-Reply-To`, else the last id in `References`.
2. Look up `inquiry_messages` where `direction='outbound'` and
   `message_id` equals it.
3. On a hit → that row's `inquiry_id` is the inquiry. Still apply the same
   sender-email check the other tiers use (§2.3 of the previous plan) — an exact
   Message-ID is proof of *which thread*, not of *who is writing*.

Tiers 1 (`ref_code`) and 2 (`conversationId`) stay exactly as they are, as
fallbacks for mail that predates this change or lost its headers.

**Where the headers come from — RESOLVED this session.**
`InboundMail` does not currently expose them, and the intake fetch does not ask
for them. **VERIFIED** (`mail.ts:78`), the current `$select` is:

```
id,internetMessageId,conversationId,subject,receivedDateTime,hasAttachments,bodyPreview,body,from
```

**VERIFIED empirically** against both real customer replies in `KALFA-Intake`:
adding `internetMessageHeaders` to that `$select` returns 57 headers per message,
including exactly what tier 0 needs:

```
In-Reply-To = <010201a03a656355-…@eu-west-1.amazonses.com>
References  = <010201a03a656355-…@eu-west-1.amazonses.com>
```

This supersedes the `PR_TRANSPORT_MESSAGE_HEADERS` route considered during
research: `internetMessageHeaders` is a first-class field on the message resource,
needs no extended-property expansion, and needs no extra request.

**Also learned while testing (relevant if extended properties are ever used):**
`$expand=singleValueExtendedProperties` on a message **collection** fails
intermittently with `ErrorRestrictionTooComplex`. Only per-message `GET` is
reliable. Another reason `internetMessageHeaders` is the better route.

---

## 4. What must be stored, and how

### 4.1 Schema: no migration needed

> **Review history, kept because the reasoning matters.** Mid-review this section
> briefly called for a new `provider_message_ref` column. That was correct *while*
> the webhook was the chosen mechanism — a callback arriving later needs an anchor
> to find its row by. The live measurement (§4.3) replaced the webhook with a
> bounded synchronous wait, and with nothing arriving later there is nothing to
> anchor. **The column is not needed. No migration.**

**VERIFIED** (live schema) — `inquiry_messages` today:

| column | type | null |
|---|---|---|
| `id` | uuid | NO |
| `inquiry_id` | uuid | NO |
| `direction` | text | NO |
| `body` | text | NO |
| `message_id` | text | YES |
| `author_id` | uuid | YES |
| `created_at` | timestamptz | NO |

`message_id` is exactly the column tier 0 needs, already nullable, and already
carries a `UNIQUE` constraint (`inquiry_messages_message_id_key`, added
2026-08-25).

Note for anyone reconsidering the webhook later: Resend's `id` must **not** be
stored in `message_id`. That column is the RFC Message-ID join key and is unique —
a Resend UUID there would corrupt the join. A webhook design would need its own
column, i.e. the migration described above.

**Question asked and answered:** does storing *outbound* ids in the same column
collide with the *inbound* ids already there? **No.** RFC 5322 Message-IDs are
globally unique by construction; an outbound id and an inbound id can never be
equal. The existing `UNIQUE` constraint is therefore an asset, not an obstacle —
it makes the lookup in §3.2 provably single-row, and it makes a double-write
idempotent through the same `onConflict:'message_id'` upsert already used for
inbound.

**VERIFIED** (live): all outbound rows currently have `message_id = NULL`, so
there is nothing to backfill and no uniqueness risk on existing data.

### 4.2 Where outbound rows are written today

**VERIFIED** by reading the code:

| Flow | Writes an `inquiry_messages` outbound row? |
|---|---|
| `sendInquiryReply` (`admin/contacts.ts:283-287`) | **Yes** — `{inquiry_id, direction:'outbound', body}` |
| `runInquiryFollowupSweep` reminder / warning / rating (`inquiry-followup.ts`) | **No** — sends mail, writes only the stamp columns |

**VERIFIED twice over:** `inquiry-followup.ts` contains **zero** `.insert(` or
`.upsert(` calls — its only reference to `inquiry_messages` is the read added on
25.8 (`lastInboundMessageIds`). And live data confirms the consequence: three
delivered cascade emails on 25.8 with no corresponding rows (§2.2).

So the cascade emails currently leave **no thread record at all**. A customer who
replies to a reminder is replying to a message we never recorded — which is
exactly what happened with the duplicate inquiry `42194bf7` on 25.8.

**Scope note, stated precisely.** Fixing this does *not* produce a "complete"
thread. Agreement emails (`agreements.ts`) and event-cancellation emails
(`event-cancellation.ts`) also go out through the same `getEmailSender`, but they
belong to other flows and are not `inquiry_messages` at all — they stay unrecorded
here, by design. The accurate claim is narrow: **cascade emails stop being
invisible in the inquiry thread.**

**This means the fix has two distinct parts, not one:**
- `sendInquiryReply` — add `message_id` to an insert that already exists.
- the three cascade stages — **create the outbound row at all**, then add
  `message_id`. This is new behaviour and also fixes the missing-thread-record gap
  independently of Message-ID matching.

### 4.3 How the id is obtained — the timing question

`send()` gives only `id`; `message_id` requires a second call. Three options were
considered:

| Option | Mechanism | Cost | Risk |
|---|---|---|---|
| **A. Immediate GET** | `send()` → `GET /emails/{id}` right after | 1 extra API call per send | `message_id` is empty while `last_event` is `queued` — **MEASURED at ~1.2 s, resolved below**; a *single* immediate GET fails, a bounded retry succeeds |
| **B. Resend webhook** | `email.sent` event carries `email_id` + `message_id` | New public route, signature verification, Resend-side config | More moving parts; also async, so a fast reply could beat it |
| **C. Deferred sweep** | store `id`, backfill `message_id` on a cron | No new route | Same race as B, plus latency |

#### RESOLVED — measured 2026-08-26, no mail sent

The question was whether `message_id` is minted when Resend accepts the request or
when the message is actually dispatched. Settled with a scheduled-then-cancelled
probe (schedule +7 days → `GET` → cancel; nothing ever left):

```
scheduled id : a85880e0-92ab-4b95-a44a-dd48ba90e24e
GET after 760 ms
  last_event : queued
  message_id : null          ← empty while queued
CANCEL       : ok  → last_event: canceled
```

**`message_id` is null while `last_event: queued`. It is generated at dispatch,
not at API-accept.** The SDK types it as a non-nullable `string`; at runtime it is
`null` before dispatch. The type is wrong, and code must not trust it.

#### And then measured for real — owner-approved live send, 2026-08-26

The scheduled probe proved *that* a gap exists but not *how long* it lasts. A real
send to `admin@nm-digitalhub.com`, polled every 500 ms:

```
send() returned after 223 ms | id: fd8629d3-51af-4b2f-a0fd-44fb8e51d7f0
  (send response fields: id)          ← confirms again: no message_id here
  t+  470ms  last_event=queued  message_id=null
  t+ 1171ms  last_event=sent    message_id=PRESENT
              <010201a03dc2a06a-844cf451-abe3-40f0-86ab-39cbf1e17a25-000000@eu-west-1.amazonses.com>
```

**The gap is about one second.** An immediate `GET` genuinely fails (null at
470 ms), but a short bounded wait succeeds.

#### Stop condition: check `last_event`, not just non-null — as cheap insurance

> **Two self-corrections are recorded here, because the first one over-claimed.**
> A draft said "poll until non-null"; a second draft called that a proven trap that
> "would have shipped a join key that silently never matches". **The second draft
> was also wrong** — it inferred a risk the evidence does not show. What follows is
> what was actually observed.

**VERIFIED 2026-08-26** — two emails, confirmed distinct by full record (different
`id`, different subject, one scheduled and one not — not merely different
recipients), carry Message-IDs in *different formats*:

| | scheduled → cancelled | really sent |
|---|---|---|
| `id` | `a85880e0-92ab-4b95-a44a-dd48ba90e24e` | `fd8629d3-51af-4b2f-a0fd-44fb8e51d7f0` |
| subject | `[probe] message_id timing…` | `[בדיקה] מדידת זמן…` |
| `scheduled_at` | `2026-09-02 11:06:58` | `None` |
| `last_event` | `canceled` | `delivered` |
| `message_id` | `<38bff927-…@`**`email`**`.amazonses.com>` | `<010201a03dc2a06a-…-000000@`**`eu-west-1`**`.amazonses.com>` |

The cancelled one is doubly informative: at `t+760 ms`, while `queued`, its
`message_id` was `null` — yet it now has one, despite **never having been
dispatched**.

**Settled by a dedicated probe** (scheduled +3 days to an external address, polled
for 22 s *without* cancelling, then cancelled — no mail ever sent):

```
t+ 0s  last_event=queued     message_id=null
t+ 6s  last_event=queued     message_id=null
t+11s  last_event=queued     message_id=null
t+17s  last_event=queued     message_id=null
t+22s  last_event=scheduled  message_id=<88fe6173-…@email.amazonses.com>   ← appears
--- cancel ---
post-cancel(+0s)  last_event=scheduled  message_id=<88fe6173-…@email.amazonses.com>
post-cancel(+5s)  last_event=scheduled  message_id=<88fe6173-…@email.amazonses.com>
```

This corrected a second wrong guess: the `@email.amazonses.com` value does **not**
appear "because it was cancelled". It appears on the transition
`queued → scheduled`, entirely independently of cancellation, and cancelling
changed neither the state nor the id.

**What is now established:**
1. `queued` never exposes a `message_id` — four samples over 17 s, all `null`,
   consistent with the earlier live-send probe.
2. A **non-null `message_id` in the wrong format does occur pre-dispatch**, in the
   `scheduled` state. So "non-null" genuinely is not a safe stop condition — the
   risk is real, just located in a different state than first guessed.
3. The form that returns in `In-Reply-To` is `@eu-west-1.amazonses.com` —
   **VERIFIED on both real customer replies**.

**Conclusion.** Today's send path is `queued → sent` and never enters `scheduled`,
so the guard is not fixing a live bug. But the failure mode it prevents is now
*demonstrated*, not hypothesised: the moment anyone uses `scheduledAt`, a non-null
check would capture an id that can never match an inbound reply, and the breakage
would be silent. Gate on `last_event ∈ {sent, delivered}`.

Storing the wrong form would be worse than storing nothing — tier 0 would hold a
key that can never match, and the failure would be invisible.

**Therefore the stop condition is a state check, not a null check:**
accept `message_id` only when `last_event` is `sent` or `delivered`.

**FINAL DECISION — option A with a bounded retry. No webhook.**

```
send()  →  poll GET /emails/{id} every ~400 ms, max ~3 s
        →  accept message_id ONLY when last_event ∈ {sent, delivered}
        →  anything else at the deadline → store NULL, carry on
```

Rationale for choosing this over the webhook, now that the number is known:
- ~1 s of in-process waiting on a path that is already doing network I/O, versus a
  new public route + signature verification + provider-side configuration.
- Synchronous: the row is complete when the send call returns. No second write
  path, no ordering questions, no partially-written rows.
- **No migration.** A late webhook would have needed a column to find the row by
  (Resend's `id`); a synchronous read does not — nothing arrives later.

**Rejected and why (both remain valid fallbacks if the assumption breaks):**
- **B — `email.sent` webhook.** Payload carries `email_id` + `message_id`
  (**VERIFIED** in `BaseEmailEventData`); nothing configured today (**VERIFIED**:
  `GET /webhooks` → 0). Correct but disproportionate for a one-second wait. Revisit
  if the deadline is hit often — the sweep counter in §9 is what would show that.
- **C — deferred sweep.** Redundant given the above.

**The one thing this measurement does not prove:** that ~1 s holds under load or
during a Resend incident. That is why the deadline is bounded and failure is
non-fatal rather than retried forever.

**Failure handling regardless of mechanism:** if `message_id` never arrives, store
`NULL` and continue. The send has already succeeded; the reply falls through to the
`ref_code` tier, which is today's behaviour. **A missing Message-ID must never fail
a send** — that would trade a working email for a better index.

### 4.4 Contract change in `sender.ts`

`send()` currently returns `Promise<void>` and discards `data`:

```ts
const { error } = await client.emails.send(…);   // data thrown away
```

It must return what it learned. Both transports implement `EmailSender`, so the
return type change touches both:

```ts
send(params: {…}): Promise<{ messageId: string | null }>;
```

- `resendSender` — capture `data.id`, then poll `GET /emails/{id}` per §4.3
  (~400 ms interval, ~3 s ceiling) and return the first non-null `message_id`, else
  `null`. **VERIFIED**: the send response really does carry only `id` — the live
  test logged `send response fields: id`.
- `smtpSender` — nodemailer's `sendMail` resolves with `{ messageId }`; return it.
  **VERIFIED** in the installed package source: `smtp-transport/index.js:253` does
  `info.messageId = messageId`, derived from `mail.message.messageId()` at `:207`.
  Simpler than the Resend path — the id exists synchronously, no polling. The SMTP
  transport is not live (`EMAIL_PROVIDER=resend`) so this is not on the critical
  path, but it is now a known quantity rather than an assumption.
- All existing callers ignore the return value and keep compiling — the change is
  additive.
- **The wait must not be inside the caller's critical path for correctness**: the
  mail is already sent by then. If the polling throws for any reason, swallow it,
  return `null`, and let the send be reported as the success it is.

---

## 5. Files to change

| File | Change |
|---|---|
| `src/lib/email/sender.ts` | `EmailSender.send` returns `{messageId}`; `resendSender` captures `data.id` + follow-up `GET`; `smtpSender` returns nodemailer's id |
| `src/lib/data/admin/contacts.ts` | `sendInquiryReply` stores the returned `messageId` on the outbound row it already inserts |
| `src/lib/data/inquiry-followup.ts` | all three stages **create** an outbound `inquiry_messages` row (new) and store `messageId` |
| `src/lib/data/inquiry-mail-intake.ts` | new tier 0 in `findExistingInquiry`: `In-Reply-To`/`References` → exact match on outbound `message_id`, sender-verified |
| `src/lib/microsoft/mail.ts` | add `internetMessageHeaders` to the `$select` (`mail.ts:78`); expose `inReplyTo` / `references` on `InboundMail`. **RESOLVED — verified empirically, see §3.2.** No extended properties, no extra request. |
| Tests | `sender.test.ts`, `contacts.test.ts`, `inquiry-followup.test.ts`, `inquiry-mail-intake.test.ts` |
| Mailbox (not code) | **two** Graph message rules (§3.1) — headers first, subject as fallback. A live mailbox change, owner approval required |

**No migration.** No new table, no new column, no new permission, no public route.

---

## 6. Decisions the owner must make

### 6.1 Routing breadth on a personal mailbox
Two rules land mail in `KALFA-Intake` (§3.1): rule A catches **any reply to any
Resend mail** (so agreements and cancellation replies get moved too), rule B
catches **any subject containing "KLF"** (so an unrelated personal email could
match). Both are safe by construction — §3.2's association layer refuses to
associate what it cannot match, and `hasSameSenderInquiry` raises a warn alert
rather than inventing a link — but the folder will hold more than strictly
inquiries. Accept that, or move to a dedicated address (§6.2)?

### 6.2 Dedicated address — larger change, removes all ambiguity
Setting `Reply-To: inquiries@kalfa.me` (an alias, free, propagates ≤24h) adds a
third rule keyed on `sentToAddresses` — address equality, no §1.3 tokenisation
ambiguity at all, and it would let rule B be retired.
Cost: outbound identity changes, and a customer replying to an *old* email still
hits the personal mailbox, so rules A and B stay as the fallback for a long tail.
**Recommended as the eventual target, not as step one.**

### 6.3 Should the cascade emails create thread rows?
§4.2 says they must for Message-ID matching to cover them. But it also changes what
the admin sees: reminder/warning/rating emails would start appearing in the thread
view. Correct, arguably overdue — but a visible behaviour change.

### 6.4 Timing test — CLOSED, no decision needed
Both variants were run on 2026-08-26 (§4.3): a scheduled-then-cancelled probe (no
mail sent) and, with the owner's approval, one live send. Result: `message_id`
appears ~1.2 s after `send()`. Mechanism decided — bounded synchronous wait, no
webhook, no migration. Nothing left for the owner to decide here.

### 6.5 Delivery-outcome blindness (§8.1) — its own plan, not this one
**The most consequential thing found while writing this plan.** There is currently
**no** handling of bounces, complaints or delivery failures anywhere in the
codebase (**VERIFIED** by grep). A bouncing address is invisible: the cascade keeps
sending to it and eventually auto-closes the inquiry as if the customer simply
chose not to answer.

**A worked solution is specified in §8.2**, verified end to end: no new dependency
(`resend.webhooks.verify()` ships in the installed SDK), no migration
(`webhook_inbox.provider` is unconstrained text already carrying three values),
and an existing in-repo precedent for raw-body signature verification. The route
itself is the only new surface.

What §8.2 deliberately leaves to you — and the reason it is a separate plan:
**what should happen to an inquiry whose mail bounced?** Record only; record and
stop the cascade; or record, stop, and flag for contact by another channel. §8.2
recommends the middle option and explains why.

---

## 7. Security model for any inbound-driven automation

Not required for §3, but recorded because it was researched here and any future
"agents act on email" work depends on it. An earlier draft of this reasoning
overstated the protections; corrected against live evidence:

**VERIFIED** on real inbound mail (raw headers, own mailbox):
- Exchange stamps `Authentication-Results` with `spf=`, `dkim=`, `dmarc=`,
  readable via Graph. Real cryptographic signal, available today.
- **But** the owner's own mail from Gmail shows `dmarc=bestguesspass`, not `pass` —
  `nm-digitalhub.com` publishes no DMARC record, so Outlook infers. Mail from our
  own domain shows a true `dmarc=pass`. DMARC-grade verification is only as strong
  as the *sender's* DNS.
- Every inbound message, **including the owner's own**, carries
  `X-MS-Exchange-Organization-AuthAs: Anonymous`. Therefore
  `RequireSenderAuthenticationEnabled = True` would block the owner too — it is
  only meaningful for intra-tenant mail. (**VERIFIED**: the field exists on the
  mailbox and is currently `False`.)
- `AcceptMessagesOnlyFromSendersOrMembers` exists and is empty (**VERIFIED** live).
  Populating it rejects other senders at the Exchange edge — *but not usefully
  here.* **VERIFIED** (`Set-Mailbox` doc): "Valid values for this parameter are
  **individual senders in your organization** (mailboxes, mail users, and mail
  contacts)." An external Gmail address cannot be listed at all, so the owner —
  who sends from `nm-digitalhub.com` — could not be allow-listed. The doc never
  states outright what happens to anonymous internet senders (that specific
  question stays **UNRESOLVED**), but it does not need to: the parameter cannot
  express the rule we would want. **Not usable for this purpose.**

**The protection that does not depend on any of the above:** tiering what email is
allowed to trigger. Reporting and reading are safe; actions with external effect
(sending to a customer, charging, changing settings) stay behind the authenticated
admin surface. Even if every sender check fails, the blast radius is bounded.

**And the one that no sender check addresses at all:** message *content* is
untrusted input regardless of who sent it. A customer can quote text that reads as
an instruction. Agents must treat bodies as data and take direction only from
structured fields.

---

## 8. Findings recorded but not adopted

Researched, verified, and deliberately not used — kept so the next reader does not
re-derive them.

| Option | Why not |
|---|---|
| Transport rule with `SubjectMatchesPatterns` (real regex) | Cannot move to a folder; the header-stamp workaround depends on `HeaderContainsWords` reading custom `X-` headers, which is **UNRESOLVED** in the docs |
| Per-inquiry alias | 400-alias cap, and **up to 24h propagation** — a customer can reply within minutes |
| Per-inquiry plus address (`inquiries+KLF-XXXX@`) | Works in principle (plus addressing **VERIFIED** active: `DisablePlusAddressInRecipients = False`), and Graph does see the tag in `toRecipients` — but Message-ID matching achieves the same certainty with no addressing change |
| Distribution list | No mailbox, no Inbox, no message store — Graph cannot subscribe |
| Catch-all subdomain | Heaviest to set up, spam exposure, activation steps only in secondary sources |
| Resend webhook **for `message_id`** | Payload **VERIFIED** to carry both `email_id` and `message_id`, and nothing is configured today (**VERIFIED**: `GET /webhooks` → 0). Rejected *for this purpose*: §4.3 measured the gap at ~1.2 s, which a bounded synchronous wait covers in ~10 lines. A public route + signature verification + provider config to save one second is engineering driven by the mechanism rather than the need. **But see §8.1 — the webhook is worth building for a different reason.** |
| Rich Graph notifications (`includeResourceData`) | Works, but forces daily instead of weekly subscription renewal, plus payload decryption |
| `PR_TRANSPORT_MESSAGE_HEADERS` extended property | Superseded by `internetMessageHeaders` (§3.2) |

### 8.1 Delivery-outcome blindness — found while evaluating the webhook, NOT fixed here

Assessing whether the webhook was worth building surfaced a gap that has nothing to
do with Message-IDs and is more consequential than the one this plan fixes.

**VERIFIED** by grepping the whole codebase: there is **no handling anywhere** of
`bounce`, `complained`, `delivery_delayed`, `failed`, or `last_event`. The only
matches are comments and `skipReason()`'s filter that *ignores* inbound bounce
notifications. `sender.ts` throws `EmailSendError` only when the Resend **API call
itself** is rejected (`sender.ts:137`, `:184`).

So today: once Resend accepts a message, **any downstream failure is invisible to
us.** A wrong address, a full mailbox, a spam block — all silent. Concretely:

- The follow-up cascade keeps sending reminder → warning → rating to an address
  that is bouncing every one of them.
- A customer who never received anything is indistinguishable, in our data, from a
  customer who received everything and chose not to reply — and the cascade
  auto-closes the inquiry on that basis.
- Repeated sending to bouncing addresses is exactly what damages sending
  reputation, which affects deliverability for everyone else.

**VERIFIED against Resend's event-type documentation** (resend.com/docs/dashboard/
webhooks/event-types) — the events exist and mean exactly what the gap requires:

| Event | Documented meaning |
|---|---|
| `email.bounced` | recipient's mail server "**permanently rejected** the email" |
| `email.complained` | "successfully delivered, but the recipient **marked it as spam**" |
| `email.failed` | "failed to send due to an error" (invalid recipient, quota, domain) |
| `email.delivery_delayed` | "temporary issue, such as a full inbox" — may retry |
| `email.delivered` | reached the recipient's mail server |

**Correction to an earlier claim in this section.** A first draft said a webhook is
the *only* way to learn about a bounce. **That is wrong**, and the correction
matters: `GET /emails/{id}` returns `last_event`, and the §4.3 measurement
observed it transitioning `queued` → `sent` live. So the outcome is also
**pollable**. The real distinction is push vs. pull, not possible vs. impossible.

That weakens the case for a webhook somewhat: since the send path is already going
to wait ~1.2 s for `message_id`, it gets an early `last_event` for free, and a
periodic sweep over recent sends could surface bounces without any public route.
A webhook is still the better fit for *terminal* outcomes (a bounce can arrive
minutes later, long after any reasonable in-request wait), but "webhook or
blindness" was a false dichotomy and is not the basis for the recommendation.

**Deliberately not folded into this plan's critical path.** It is a different
problem with a different owner decision (what should happen to an inquiry whose
mail bounces?), and mixing it in would make both harder to review. The worked
solution is specified below so the decision can be made on something concrete
rather than on an idea.

### 8.2 Solution for §8.1 — delivery-outcome capture

Every element below was verified on 2026-08-26 against the installed packages, the
live Resend account, the live database, or Resend's current documentation.

#### What already exists (so this is smaller than it looks)

| Piece | Status |
|---|---|
| Signature verification | **VERIFIED** — `resend.webhooks.verify()` exists in the installed `resend@6.22.1`: `verify(payload: {payload: string; headers: {id; timestamp; signature}; webhookSecret: string}): WebhookEventPayload`. Synchronous, throws on mismatch. |
| Crypto dependency | **VERIFIED** — none to add. `resend`'s own `dependencies` are `{postal-mime, standardwebhooks@1.0.0}`; `svix` is **not** installed separately and is not needed. |
| Header names | **VERIFIED** (Resend docs, verify-webhook-requests): `svix-id`, `svix-timestamp`, `svix-signature`. Docs warn: *"Make sure that you're using the raw request body when verifying webhooks. The cryptographic signature is sensitive to even the slightest change."* |
| Raw-body precedent | **VERIFIED** in-repo — `src/app/api/webhooks/whatsapp/route.ts:109` does `const raw = await request.text()` then verifies and returns **401** on failure (`:128`). Same shape applies. |
| Durable intake | **VERIFIED** — `webhook_inbox` already implements persist-then-process with `unique(provider, dedupe_key)`. |
| Schema change | **VERIFIED — none needed.** `webhook_inbox.provider` is plain `text` with **no CHECK constraint** (only PK + the unique pair). It already carries three distinct values live: `whatsapp`, `graph`, `voximplant`. Adding `resend` needs no migration. |
| Event semantics | **VERIFIED** (Resend event-types doc) — see the table in §8.1. |
| Webhooks configured today | **VERIFIED** — `GET /webhooks` → `0`. Nothing exists yet. |

#### Design

```
Resend  ──POST──►  /api/webhooks/resend
                        │  1. raw = await request.text()
                        │  2. resend.webhooks.verify({payload: raw, headers, secret})
                        │     └─ throws → 401, nothing persisted
                        │  3. insert webhook_inbox{ provider:'resend',
                        │       dedupe_key: <svix-id>, payload: raw }
                        │     └─ unique(provider,dedupe_key) absorbs Svix retries
                        └──► 200 immediately
                                  │
                worker  ──────────┘  processWebhookEvent()
                        │  match event.data.email_id → inquiry_messages row
                        │  record outcome; on bounce/complained/failed:
                        │    • stop the cascade for that inquiry
                        │    • Slack alert (send_health)
```

- **`dedupe_key` = the `svix-id` header.** Resend's own docs name it as the
  duplicate-handling identifier ("a unique identifier for each event delivery"),
  which is exactly what `unique(provider, dedupe_key)` needs. Not `email_id` — one
  email legitimately emits several events (`sent`, `delivered`, `bounced`).

#### Exact verification code, and the one header caveat

**VERIFIED** by reading the installed implementation
(`resend/dist/index.mjs:1197-1203`) — the SDK takes generic field names and maps
them to the Standard Webhooks header names itself:

```js
verify(payload) {
  return new Webhook(payload.webhookSecret).verify(payload.payload, {
    "webhook-id":        payload.headers.id,
    "webhook-timestamp": payload.headers.timestamp,
    "webhook-signature": payload.headers.signature
  });
}
```

So our code never writes a Svix header name into the *verification* call — only
into the `request.headers.get()` lookups. Those names come from Resend's docs
(`svix-id` / `svix-timestamp` / `svix-signature`), not from an SDK constant, and
the underlying standard uses `webhook-*`. Read both, and the ambiguity disappears:

```ts
const raw = await request.text();          // raw body — signature is byte-sensitive
const pick = (a: string, b: string) =>
  request.headers.get(a) ?? request.headers.get(b) ?? '';

const event = resend.webhooks.verify({
  payload: raw,
  headers: {
    id:        pick('svix-id',        'webhook-id'),
    timestamp: pick('svix-timestamp', 'webhook-timestamp'),
    signature: pick('svix-signature', 'webhook-signature'),
  },
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
});                                        // throws → return 401, persist nothing
```

`RESEND_WEBHOOK_SECRET` is a new env var — the signing secret shown on the webhook
details page (and returned by the create/get/list webhook endpoints).
- **Verify before persisting**, so an unsigned request cannot fill the table.
- **200 fast, process in the worker** — matching the existing Graph/WhatsApp shape,
  so a slow processor never causes provider-side retries.

#### The open question this does NOT decide

What *should* happen to an inquiry whose mail bounced? Options, in increasing
order of intervention:
1. Record only — surface it in the admin thread, change nothing.
2. Record + **stop the cascade** for that inquiry (no more reminders to a dead
   address) + Slack alert.
3. The above + mark the inquiry as needing manual contact by another channel.

**Recommendation: (2).** It removes the concrete harm — repeatedly mailing a
bouncing address, which damages sending reputation — without inventing workflow the
owner has not asked for. But this is an owner decision, and it is the reason §8.2
is a separate plan rather than an addendum here.

#### Concrete implementation

Conventions below are **VERIFIED** by reading the existing webhook stack, so this
slots into the established shape rather than inventing a parallel one:
`insertWebhookEvents()` already upserts with `onConflict:'provider,dedupe_key',
ignoreDuplicates:true` (`webhooks.ts:20-29`); the worker dispatches on
`row.event_kind` (`webhook-processing.ts:60+`); `microsoft-graph/route.ts` sets
`runtime='nodejs'` + `dynamic='force-dynamic'`.

**1. New route — `src/app/api/webhooks/resend/route.ts`**

```ts
import { type NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { insertWebhookEvents } from '@/lib/data/webhooks';

// Resend delivery-outcome notifications — persist-then-process, same shape as
// the Graph and WhatsApp webhooks. Server-to-server: the Standard Webhooks
// signature IS the auth (no session, no CSRF).
//
// Never log the payload: it carries recipient addresses and subjects.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Events we act on. Anything else is persisted-and-ignored rather than
// rejected, so a future Resend event type can never 4xx back at them.
const HANDLED = new Set([
  'email.sent', 'email.delivered', 'email.bounced',
  'email.complained', 'email.failed', 'email.delivery_delayed',
]);

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new NextResponse('not configured', { status: 503 });

  // RAW body — the signature is byte-sensitive (Resend docs). Must not be
  // request.json(), which re-serialises.
  const raw = await request.text();
  const pick = (a: string, b: string) =>
    request.headers.get(a) ?? request.headers.get(b) ?? '';

  let event: { type?: string; data?: { email_id?: string; message_id?: string } };
  try {
    event = new Resend().webhooks.verify({
      payload: raw,
      headers: {
        id: pick('svix-id', 'webhook-id'),
        timestamp: pick('svix-timestamp', 'webhook-timestamp'),
        signature: pick('svix-signature', 'webhook-signature'),
      },
      webhookSecret: secret,
    }) as typeof event;
  } catch {
    // Verify BEFORE persisting, so an unsigned caller cannot fill the table.
    return new NextResponse('invalid signature', { status: 401 });
  }

  const deliveryId = pick('svix-id', 'webhook-id');
  if (!deliveryId || !event?.type) {
    return new NextResponse('malformed', { status: 400 });
  }
  if (!HANDLED.has(event.type)) return new NextResponse(null, { status: 200 });

  await insertWebhookEvents([
    {
      provider: 'resend',
      // The delivery id, NOT email_id: one email emits several events, and
      // UNIQUE(provider, dedupe_key) must dedupe retries, not distinct events.
      dedupe_key: deliveryId,
      event_kind: 'email_delivery',
      provider_id: event.data?.email_id ?? null,
      payload: JSON.parse(raw),
    },
  ]);

  return new NextResponse(null, { status: 200 });
}
```

**2. Worker branch — `webhook-processing.ts`**, one more `event_kind` alongside
the existing ones:

```ts
if (row.event_kind === 'email_delivery') {
  await processEmailDelivery(row);
  return;
}
```

```ts
// Terminal delivery failures. `delivered`/`sent` are recorded but need no action.
const TERMINAL_FAILURE = new Set(['email.bounced', 'email.failed']);

async function processEmailDelivery(row: WebhookInboxRow): Promise<void> {
  const p = row.payload as { type?: string; data?: { email_id?: string } };
  const emailId = p.data?.email_id;
  if (!emailId || !p.type) return;

  // Find the outbound thread row this event belongs to. Requires the
  // provider-id column from §4.1's "webhook design would need" note.
  const admin = createAdminClient();
  const { data: msg, error } = await admin
    .from('inquiry_messages')
    .select('id, inquiry_id')
    .eq('provider_message_ref', emailId)
    .maybeSingle();
  if (error) throw new Error('איתור ההודעה היוצאת נכשל', { cause: error });
  if (!msg) return;               // not one of ours (agreement mail etc.) — fine

  if (!TERMINAL_FAILURE.has(p.type) && p.type !== 'email.complained') return;

  // Owner decision (below) determines what happens here. Option 2 = stop the
  // cascade for this inquiry so a dead address stops being mailed.
  const { error: updateError } = await admin
    .from('contact_messages')
    .update({ /* cascade-stop marker — column TBD by the owner decision */ })
    .eq('id', msg.inquiry_id);
  if (updateError) throw new Error('עצירת המפל נכשלה', { cause: updateError });

  void sendSlackAlert({
    category: 'send_health',
    level: p.type === 'email.complained' ? 'warn' : 'error',
    title: p.type === 'email.complained'
      ? 'לקוח סימן מייל כספאם'
      : 'מייל ללקוח לא נמסר',
    source: 'resend-webhook',
    fields: { contactMessageId: msg.inquiry_id, event: p.type },  // ids only
  });
}
```

**3. Schema — this design DOES need the migration §4.1 describes.** To find the
row from `email_id`, the outbound row must store Resend's `id`. That is the
`provider_message_ref` column §4.1 specified and then withdrew when polling won:

```sql
alter table public.inquiry_messages
  add column if not exists provider_message_ref text;
```

**This is the sharpest reason §8.2 is a separate plan:** the main plan is
migration-free precisely because it polls; §8.2 reintroduces the column. Deciding
them together, in the right order, avoids adding a column and then not using it.

**4. Setup (not code) — via the Resend CLI, which is installed and authenticated.**

**VERIFIED 2026-08-26** on this machine: `resend whoami` → `authenticated: true`,
key sourced from env, config at `~/.config/resend/credentials.json`. The CLI's own
help text confirms every contract this section relies on, from the vendor rather
than from docs alone:

> *"Payloads are signed with Svix headers for verification."*
> *"Each delivery includes headers: `svix-id`, `svix-timestamp`, `svix-signature`"*
> *"Verify payloads in your application using: `resend.webhooks.verify({ payload, headers, webhookSecret })`"*

It also lists **19 event types**, including all six this design subscribes to
(`email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
`email.complained`, `email.failed`).

Registration is one command, not a dashboard visit:

```bash
resend webhooks create \
  --endpoint https://<host>/api/webhooks/resend \
  --events email.sent,email.delivered,email.delivery_delayed,email.bounced,email.complained,email.failed
```

Then put the returned signing secret in `RESEND_WEBHOOK_SECRET`, and declare it in
`src/lib/relocation/env-validation.ts`, where required env vars live.

Useful adjacent commands (**VERIFIED** in `resend webhooks --help` /
`resend --help`): `resend webhooks list|get|update|delete` for lifecycle,
`resend logs` for API request logs, `resend doctor` for key/domain health.

**5. Operational details learned by running the CLI (not from docs).**

- **Signing secret is available ONLY at creation — RESOLVED.** Two Resend sources
  appeared to disagree: the API reference for `GET /webhooks/{id}` shows a response
  example *containing* `signing_secret`, while the CLI help says it is shown once.
  Resend's own CLI reference in their repo settles it
  (`resend/resend-cli` → `skills/resend-cli/references/webhooks.md`):

  > `webhooks create` — *"**Output includes `signing_secret`** — shown once only.
  > Save immediately."*
  > `webhooks get` — *"**Note:** `signing_secret` is **NOT** returned by get (only
  > at creation)."*

  The API reference example is misleading. **Capture the secret at creation into
  `RESEND_WEBHOOK_SECRET` in the same step; losing it means rotating the webhook,
  not re-reading it.**
- **Events fire per recipient — CLI says so, the event schema hints otherwise.**
  `resend webhooks --help`: *"a batch email to 3 recipients generates 3 email.sent
  events."* But the `email.delivered` payload documents `to` as an *"Array of
  **impacted** recipient email addresses"* — an array, which would be redundant
  under a strict one-event-per-recipient model. **Left UNRESOLVED**: it cannot be
  settled without a real multi-recipient send, and it does not need to be. Every
  KALFA inquiry email goes to exactly one address (`to: [row.email]`), and
  `svix-id` deduping is correct under either reading. Recorded so nobody assumes
  one-event-per-recipient if batch sending is ever introduced. (For reference,
  `send-email` documents `to` as *"Max 50"* recipients.)
- **Delivery is at-least-once, with a documented retry ladder — corrected against
  the dedicated docs page.** An earlier draft copied a partial ladder from the
  introduction page. `resend.com/docs/webhooks/retries-and-replays` gives the full
  one: **Immediately, 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours,
  and 10 hours again** — *eight* attempts spanning ~27.5 h, not six over ~18 h.
  Their worked example: *"an attempt that fails three times before eventually
  succeeding will be delivered roughly 35 minutes and 5 seconds following the first
  attempt."* They explicitly recommend `svix-id` for duplicate detection — the same
  conclusion this design reached independently.
- **A persistently failing endpoint gets disabled — and this is the operational
  risk worth naming.** Same page: *"When a webhook endpoint starts failing…
  Resend sends an email notification to your team… If the endpoint continues to
  fail, Resend will eventually **disable it automatically**"*, after which it must
  be re-enabled by hand from the dashboard. So a deploy that breaks the route does
  not merely drop a few events — it can switch delivery off entirely and stay off
  until someone notices. Another argument for returning 200 fast and failing only
  inside the worker.
- **Failed deliveries can be replayed manually** from the Webhooks page (*"You can
  replay both `failed` and `succeeded` webhook messages"*), so a bounded outage is
  recoverable rather than data-lost.

  **Three consequences the route must honour, all now non-optional:**
  1. **Only HTTP 200 stops the ladder.** Any other status — including a 500 from an
     unhandled exception — buys up to six redeliveries over ~18 hours. The route
     must therefore return 200 for anything it deliberately ignores (unhandled
     event types), and must not let a processing error escape as a 5xx. This is
     already why the design persists-then-processes: the worker's failures never
     reach Resend.
  2. **Duplicates are expected, not exceptional.** `unique(provider, dedupe_key)`
     with `ignoreDuplicates` is load-bearing, not defensive.
  3. **401 on a bad signature is deliberate and correct** — an unsigned caller
     should be retried at, not silently accepted. A legitimate Resend delivery will
     never hit that path.
- **No documented endpoint timeout.** Resend does not publish how long the endpoint
  may take to respond, which is a further argument for returning 200 immediately
  and doing the work in the worker.
- **`--events all` means 17 events, and the two `suppression.*` types are NOT
  among them — RESOLVED.** The CLI help looks self-contradictory (*"all 17 events"*
  next to *"Available event types (19 total)"*). Resend's CLI reference enumerates
  the 17 that `all` covers: 11 email + 3 contact + 3 domain. **`suppression.added`
  and `suppression.removed` are absent from that list** — they are the 19-minus-17.
  Naming the six we want explicitly avoids the question entirely, and is what §8.2
  does.
- **Response formats confirmed live**: `resend webhooks list` → `{object:'list',
  has_more, data:[]}` (currently empty); `resend emails get <id>` returns
  `last_event` and the full `message_id` — the exact shape §4.3 relies on.
- **`resend doctor`** is a useful pre-flight: it reported CLI v2.16.0, API key
  present from env, `kalfa.me` verified, and one `warn` — credentials stored as a
  **plaintext file** at `~/.config/resend/credentials.json`. Worth knowing, since
  the key there is a live production sending credential.

**6. Local testing — `resend webhooks listen` is NOT a no-exposure option.**

> **Correction to an earlier draft of this plan.** It claimed the CLI's listener
> allows testing "with no public endpoint exposed". **That is wrong.** Reading
> `resend webhooks listen --help`: the command *requires* `--url` — *"You must
> provide a public URL (e.g. from ngrok or localtunnel) that points to the local
> server port"* — starts a local server on port 4318, registers a **temporary
> Resend webhook** pointing at that tunnel, and deletes it on Ctrl+C.
>
> **VERIFIED empirically 2026-08-26**, not inferred from help text — running the
> command with no flags returns:
> ```json
> {"error":{"message":"Missing --url flag.","code":"missing_url"}}
> ```
> `--url` is hard-required and the CLI does **not** provision a tunnel itself.
> (Resend has no `test-webhooks-locally` docs page — that URL 404s — so the help
> text plus this behaviour are the authoritative sources.)

**…and none of that matters, because `listen` solves a problem we do not have.**

`webhooks listen` exists for a developer on a laptop with no public address. This
project is not in that situation. **VERIFIED 2026-08-26:**

```
https://beta.kalfa.me/                              → HTTP 200
https://beta.kalfa.me/api/webhooks/microsoft-graph  → HTTP 405
```

The 405 is the informative one: the path **exists and is publicly reachable**, it
simply rejects `GET`. Two production webhooks (Microsoft Graph, WhatsApp) already
receive real provider callbacks at this host, which terminates TLS for `kalfa.me`.

So the path is the ordinary one, with no tunnel, no ad-hoc server, and no temp
port — the same shape the two existing webhooks were set up with:

1. Deploy `/api/webhooks/resend` to beta.
2. `resend webhooks create --endpoint https://beta.kalfa.me/api/webhooks/resend --events …`
3. Verify against real deliveries.

Unit tests still come first for the cases that need no network — call the exported
`POST` with a crafted `Request` and a signature built through the same
`webhooks.verify` path (covers §9 items 13, 14, 17). Only 15 and 16 need a live
delivery, and step 3 above provides it.

**Incidental but worth recording:** running `listen` on this host fails anyway —
port 4318 is already occupied by a system sidecar process. Notably the CLI binds
the local port *before* registering anything, so the failed attempt left
`webhooks list` empty. A mistaken `listen` cannot strand a stray webhook.

#### Secondary benefit, once the route exists

If the webhook is built, `message_id` capture should move onto it (`email.sent`
carries `email_id` + `message_id`, **VERIFIED** in `BaseEmailEventData`) and
§4.3's ~1.2 s polling loop should be deleted. Ten discarded lines is a fine price
for not having built a public route prematurely — and it is why §4.1 records
exactly which column a webhook design would then need.

#### What is NOT specified here, on purpose

The cascade-stop mechanism (`/* column TBD */` above) depends on the owner
decision at the top of §8.2. Options: a new `delivery_failed_at` column; reusing
`auto_closed_at`; or a status value. Each has different consequences for the admin
UI and for `listDueFor*`'s gating, and picking one without the owner deciding what
a bounce *means* would be guessing.

---

## 9. Verification

**Timing test — DONE (§4.3).** Both variants ran on 2026-08-26: the
scheduled-then-cancelled probe (no mail sent) proved `message_id` is null while
queued, and an owner-approved live send measured the real gap at ~1.2 s. Nothing
here is blocked on it any more.

1. `npx tsc --noEmit`, `npm run lint`, `npx vitest run` — all green.
2. Unit: tier 0 matches on `In-Reply-To`; falls through to ref_code when absent;
   refuses on a sender mismatch; `References` multi-id parsing takes the last id.
3. Unit: the `message_id` poll gives up at the deadline, stores `NULL`, and the
   send is still reported as successful. A throw inside the poll must not surface.
4. Unit: each cascade stage writes exactly one outbound row (new behaviour, §4.2),
   and a re-run does not duplicate it.
5. Create **both** rules (§3.1); confirm via `GET …/messageRules` that two enabled
   rules exist with the expected sequence.
6. Rule B test: send a mail with `[KLF-XXXXXXXX]` in the subject from an external
   address → lands in `KALFA-Intake` **without manual movement**. This settles
   §1.3's tokenisation question empirically.
7. Rule A test: reply to a KALFA email **after deleting the `[KLF-…]` tag from the
   subject** → must still land in `KALFA-Intake`, proving header-based routing
   works independently. This is the case rule A exists for, and the one a
   subject-only design would have dropped silently.
8. Full live round-trip: open an inquiry → reply → customer replies → confirm it
   attaches via **tier 0** (check logs/DB, not just the end state — tier 1 would
   also produce a correct-looking result and mask a broken tier 0).
9. Negative: a personal email containing "KLF" — confirm it routes to the folder
   but is **not** associated to any inquiry.
10. Negative: reply to an *agreement* email (rule A will route it, §3.1 limit 2) —
    confirm it produces the "possible unmatched reply" warn alert and creates no
    bogus association.
11. Confirm the five pre-existing outbound rows still show `message_id = NULL` and
    nothing attempted to backfill them (§4.1 — no retroactive write is intended).
12. Measure how often the `message_id` poll hits its deadline in normal operation.
    A non-trivial rate is the signal to revisit the webhook (§8/§8.1).

**If §8.2 is built** — items 13, 14 and 17 are unit-testable against the exported
route handler with no network at all; 15 and 16 need a real delivery, which comes
from registering the webhook against the already-public beta endpoint (§8.2 step 6
— no tunnel is involved, and `webhooks listen` is not needed here):

13. A tampered `svix-signature` → **401**, and **nothing** written to
    `webhook_inbox`. (Verify-before-persist is the whole point; a row appearing
    here means the order is wrong.)
14. The same event delivered twice with the same `svix-id` → exactly one
    `webhook_inbox` row, no error. Exercises `unique(provider,dedupe_key)`.
15. An `email.bounced` for a known outbound row → cascade stops for that inquiry
    and a `send_health` alert fires with **ids only**, no address or subject.
16. An `email.bounced` for an `email_id` we do not have (e.g. an agreement mail) →
    processed and ignored, no error, no bogus association.
17. An unhandled event type (e.g. `email.opened`) → **200**, not 4xx, so Resend
    never retries something we simply do not act on.

---

## 10. Out of scope

- Agent-to-agent and owner-to-agent email. Researched here (aliases: 400 free, no
  licence; Resend already verified for all of `kalfa.me`, so agents could *send*
  today with no alias at all; a shared mailbox beats aliases for *receiving*), but
  it needs its own plan — the security model in §7 is only partly resolved, and the
  owner has not yet settled whether agents act on inbound mail or only report.
- Resend inbound/receiving features.
- SMTP-path Message-ID capture beyond a best-effort passthrough.
- Retroactive backfill of existing outbound rows.
- Agreement and event-cancellation emails (§4.2 scope note) — different flows, not
  `inquiry_messages`.
