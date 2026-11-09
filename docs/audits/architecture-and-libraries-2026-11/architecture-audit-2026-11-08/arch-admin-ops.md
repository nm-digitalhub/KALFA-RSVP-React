**Read-only architecture audit: admin ops slice of KALFA**

Scope: integrations, fleet, voice, webhooks, debug, rdp-access and relocation. That is 115 non-test files (about 18,100 lines); the 43 test files were left out. Every line reference is 1-based. M = MEASURED (I read the lines), I = INFERRED.

### (a) Module map
- **integrations/**: index page plus 10 provider sub-pages (cardcom, extra-sms, meta-whatsapp + connect, microsoft, numbers, owner-agent, resend-email, slack, sumit, voximplant). Each provider has a status card, a credentials form and a test, and most have their own `actions.ts`. A shared `actions.ts` serves WhatsApp, Voximplant, the master switch, the channel catalog and the send policy. (M)
- **fleet/**: owner↔agent messaging. The layout holds the conversation list, the page shows one conversation, and there are composer, goals and stream client components plus `actions.ts`. (M)
- **voice/**: overview, platform, per-event, console, console-history and queues pages, plus the shared `_helpers`/`_meters`/`_donut`. (M)
- **webhooks/**: inbox list, detail drawer and reprocess action. (M)
- **debug/** and **relocation/**: owner-only read-only diagnostic panels with an auto-refresh toggle. (M)
- **rdp-access/**: request, pending and active screens, the owner's request list, and the actions. (M)

### (b) Mixed-concern files
- **Database access outside the data layer:**
  - `webhooks/actions.ts:30-34` updates `webhook_inbox` through `createAdminClient()` directly inside the Server Action, even though `@/lib/data/admin/webhook-inbox` exists and the page uses it. (M)
  - `voice/console/page.tsx:16-20` queries `console_me` from the page itself. (M)
- **Domain work inside actions:**
  - `extra-sms/actions.ts:80-169` does it all in one action: normalises the phone, rate-limits, reads settings, builds the sender, sends, maps provider errors and parses JSON out of an error message (160-169). (M)
  - `integrations/actions.ts`: the one-rule-one-purpose checks (125-152, 269-289), the persona enable guard plus a Slack security audit (304-351), and the enable guards (207-214, 234-241). (M) Its comments say authorization is in the data layer; I did not verify that. (I)
  - `fleet/actions.ts:134-138`: checks that the role exists in fleet.json. (M)
  - `rdp-access/actions.ts:73-80`: builds a service-role client and passes it to the notifier inside `after()`. (M)
- **Where audit rows are written is inconsistent.** fleet, voice and numbers actions call `logActivity` themselves (e.g. `fleet/actions.ts:115-124`). `owner-agent/actions.ts:42` says its data layer writes them. (M)
- **Where the gate sits is inconsistent.** `numbers/actions.ts:37-41` deliberately does not gate in the action; `owner-agent/actions.ts:34-40` gates in both the action and the data layer; slack and fleet gate through `use()`. (M) Search confirmed gate calls exist in `number-registration.ts` and `provider-numbers.ts`. (M) For saveCardcomConfig, updateSumitCredentials, updateEmailTransportConfig, connectViaEmbeddedSignup and the other callees, the only evidence of a gate is the comments. (I)
- **Pages carrying logic:**
  - `voice/events/[eventId]/page.tsx:128-143` classifies statuses into buckets and tallies them in memory for the current page; 77-87 labels RSVP answers. (M)
  - `voice/console-history/page.tsx`: 91-97 decodes `reason:detail`; 124 casts a searchParam with `as` and no validation; 139-153 runs one recording lookup per row. (M)
  - `voice/queues/page.tsx:22-26` is an N+1: one `getQueueMemberIds` call per queue, and each call is one query (`src/lib/data/console-queues.ts:94-102`). (M)
  - `webhooks/page.tsx:60-253` holds the filter catalogues and two sub-components. (M)
  - `voice/platform/page.tsx:56-75` builds view-model maps, then renders six sections inline. (M)
  - `fleet/page.tsx:52-68` routes legacy links; 82-94 derives the view. (M)
- **Presentational component doing domain work:** `webhooks/webhook-detail.tsx:90-118` parses raw payload errors and pricing, and 26/236 classifies Meta error 131026. (M)
- **Client components:**
  - Every `@/lib/data` import in a `'use client'` file is `import type`. (M)
  - `rdp-access/active-console.tsx:53-97` does its own `fetch` to `/api/admin/rdp-access/file`, builds the download and parses the error body. (M)
  - `add-number-wizard.tsx:134-149` repeats the server's phone split in the browser. (M)
  - Four files are `'use client'` with no hooks and no handlers: `extra-key-status.tsx`, `sumit-status-card.tsx`, `email-health-card.tsx` and `voximplant-status-card.tsx`. (M) `_donut.tsx` needs the directive for recharts. (M)
- **Cross-route import:** `integrations/voximplant/page.tsx:13-18` imports from `../../voice/_helpers`. (M)
- **Security notes, one line each:**
  - `getQueueMemberIds` (`src/lib/data/console-queues.ts:94-102`) is a service-role read with no gate inside the function. That contradicts the "per-function" claim at `voice/queues/page.tsx:16-17`; the page itself gates at :18. (M)
  - Phone and payload masking in the webhook drawer is visual only. Full values are passed as props (`webhook-detail.tsx:191`, 380-398), so they are in the server-rendered payload. (M)

### (c) Large files (>~400 lines)
| File | Lines | What it holds (M) |
|---|---|---|
| `debug/_panels.tsx` | 746 | 8 panels plus formatters. Presentational. ExchangePanel carries a static migration narrative (654-688). |
| `numbers/add-number-wizard.tsx` | 556 | One component (103-556): resume picker, 4 step forms, step state, phone preview parsing. |
| `owner-agent/allowlist-panel.tsx` | 493 | Table, row actions, 5 forms (approve, revoke, relabel, add staff, add external), approval-state badges. |
| `fleet/fleet-composer.tsx` | 491 | Context provider with two action states and navigation (85-182), DOM scroll bar (186-204), composer form (246-491). |
| `integrations/actions.ts` | 488 | 11 actions across 5 concerns; the file explains why at 43-48. |
| `owner-agent/reports-panel.tsx` | 477 | Switch, 2 template forms, dynamic schedule editor with a module-level counter (305), runs table, 3 label catalogues (53-89). |
| `fleet/fleet-goals.tsx` | 431 | Goal strip, new-goal sheet, 3 lifecycle forms, goal card, note label maps. |
| `webhooks/page.tsx` | 419 | Catalogues, HealthStat, filter form, list, drawer composition. |
| `webhooks/webhook-detail.tsx` | 412 | Payload interpretation, 5 sections, its own date formatter (30-44). |
| `relocation/_panels.tsx` | 406 | 10 presentational panels, label maps, elapsed-time helper. |

Near the threshold: `fleet/actions.ts` (361), `voice/platform/page.tsx` (359), `numbers/actions.ts` (349).

### (d) Duplication (all M)
- **Integrations form/save/test pattern:**
  - **Save actions:** the same shape (data-layer call → `unstable_rethrow` → `returnUserError` → revalidate the page and the index → `{notice}`) at `cardcom/actions.ts:33-63`, `sumit/actions.ts:27-39`, `resend-email/actions.ts:31-45`, `extra-sms/actions.ts:32-45` and `integrations/actions.ts:67-83`.
  - **Connection tests:** the two test actions `integrations/actions.ts:86-98` and `168-180` match each other, as do their UIs, `whatsapp-connection-test.tsx:14-29` and `voximplant-connection-test.tsx:16-31`.
  - **Two field kits:** sumit, cardcom, resend and extra-sms forms use `EditableField` from `admin/_form-fields`; whatsapp and voximplant use `Field`/`SecretField` from `integrations/_components/form-fields`.
  - **Status cards:** `sumit-status-card.tsx:16-57` and `email-health-card.tsx:12-55` share the same `KIND_LABELS` map, "not our fault" set and three-branch card.
  - **Page chrome:** the back-link to integrations appears in 10 provider pages (e.g. `cardcom/page.tsx:38`, `owner-agent/page.tsx:72`), and a `sectionClass` constant in 9 pages.
- **The same `inputClass` string in 7 files:** `channel-catalog-editor.tsx:22`, `voximplant-rule-field.tsx:45`, `voximplant-credentials-form.tsx:32`, `send-policy-form.tsx:25`, `alerts-client.tsx:24`, `allowlist-panel.tsx:50`, `reports-panel.tsx:50`. The shared `_components/form-fields.tsx:16` has it too but does not export it.
- **Small helpers:** `revalidateAll` in `integrations/actions.ts:53-55` and `slack/actions.ts:29-31`; `safeMessage` in `owner-agent/actions.ts:59-62` and `reports-actions.ts:30-33`; `isUserFacing` (`numbers/actions.ts:183-185`) repeats the `HEBREW` test in `src/lib/safe-action.ts`.
- **Voice tiles:** the balance/wiring tile at `integrations/voximplant/page.tsx:101-136` and `voice/platform/page.tsx:92-141`; stat-tile markup twice in `voice/events/[eventId]/page.tsx` (207-218 and 225-236).
- **Configured/enabled badge:** `integrations/page.tsx:28-41` and `debug/_panels.tsx:546-561`.
- **Auto-refresh:** `debug/_auto-refresh-toggle.tsx:22-40` and `relocation/_auto-refresh-toggle.tsx:17-35` differ only in the storage key; `status-poller.tsx:16-33` is a third visible-tab refresh loop.
- **rdp-access:** `STATUS_BADGE` is identical in `requests/page.tsx:29-36` and `requests/[id]/page.tsx:22-29`; `Fact` appears in `pending-panel.tsx:159-169` and `requests/[id]/page.tsx:152-159`.
- **Webhook kinds:** `webhooks/page.tsx:70-114` restates the labels from `src/lib/data/admin/labels.ts:197-229` and offers only 13 of that file's 31 kinds in the filter.
- **Fleet:**
  - The role regex appears at `fleet/actions.ts:55`, `:217` and `fleet/page.tsx:28`.
  - `NEW_MAX`/`REPLY_MAX` (`fleet-composer.tsx:243-244`) restate the schema limits at `fleet/actions.ts:66,181`.
  - The goal limits in `fleet-goals.tsx:158-174` restate `actions.ts:218-227`.
  - `nextActionOf` (`fleet-goals.tsx:55-62`) is repeated inline at 336-342.
- **Webhook inspector:** `PayloadViewer` (`webhook-inspector-client.tsx:102-127`) duplicates `JsonTree` (133-172) and has no references; I ran the reference search twice on a warm language server.
- **Allowlist form:** the same `PhoneInput` block at `allowlist-panel.tsx:263-280` and `339-356`.

### (e) Coverage
- **Read in full (about 50 files):**
  - All 14 `actions.ts` / `reports-actions.ts` files.
  - Pages: the integrations index, voximplant, debug, relocation, fleet (page, layout, `[id]`), voice (overview, platform, events, console, queues), webhooks (page, detail, inspector client).
  - Components: `debug/_panels`, `relocation/_panels`, both toggles, `status-poller`, `voice/_helpers`, `wiring-card`, the four hook-free cards, `sync-buttons`, `thresholds`, both connection tests, `add-number-wizard`, `allowlist-panel`.
  - Read from the end of the import block to the last line (imports seen only through the pattern scan): `reports-panel` (31-477), `fleet-goals` (28-431), `fleet-composer` (28-491).
- **Partial reads (no claims outside these ranges):**
  - `voice/console-history/page.tsx` 1-175; `numbers/page.tsx` 1-90; `resend-email/page.tsx` 1-60
  - `active-console.tsx` 27-135; `rdp-access/requests/page.tsx` 19-45; `requests/[id]/page.tsx` 15-60 and 149-159
  - `pending-panel.tsx` 156-169; `_donut.tsx` 1-25
- **Profiled only (about 57 files):** every remaining non-test file got its symbol overview plus a whole-file scan for directives, imports, database, fetch, gate and hook patterns. These include the remaining provider pages, forms and cards, the slack, owner-agent, numbers and fleet sub-components, the voice console client and meters, the other rdp components and the loading files. They were not read line by line because of the time and context budget, and I report no findings on them beyond the measured scans above.
- **Skipped by the exclusion rules:** tests, `.env*`, generated types and vendored UI.