I sent the report to `main`. Here it is in full; it is in English because the lead asked for an English report.

Admin-business slice audit (src/app/(admin)/** minus 7 excluded subfolders): 122 source files, 19,263 lines; read-only, Serena only. Line numbers below are 1-based.

Baseline (MEASURED): all 23 Server Action files build on the one `actionClient` (src/lib/safe-action.ts:33). Most of them validate with Zod and call a `@/lib/data/*` function that holds the permission gate, e.g. contacts/actions.ts:16-28 → `updateContactStatus` → `requirePlatformPermission`. Pages gate optimistically and read through `@/lib/data/admin/*`.

## (a) Module map
| Area | Responsibility |
|---|---|
| layout.tsx | Staff gate; shell data (nav counts/grants, Exchange presence, softphone gate) |
| page, error, loading, _components, _form-fields | Dashboard; error boundary; shared server helpers + URL-param parsers; masked secret field (client) |
| activity, access-log | Audit log with filters; access log |
| agreement | Contract editor (tiptap) + approve; agr_* config form |
| analytics | GA4 + Search Console dashboard (page + _sections/_trend-chart/_range-picker/_auto-refresh) |
| assignments, offers | Staff coupon assignment (list/detail/new/void); offer CRUD |
| calendar | Exchange calendar grid, view/edit dialog, form fields, op-tracker, CRUD actions |
| callbacks (+policy) | Callback list/detail/reschedule/cancel/outcome; scheduling-policy form |
| campaigns, events/[id] | Campaign board; staff event view + test-event mark/purge |
| cancellations | Request list, detail, resolve/refund form |
| company, settings, cookie-consent, dnc | Singleton settings: company profile, app flags + Exchange connections, consent toggles, DNC list/registry gate |
| contacts, support | Inquiry inbox; reason-gated customer lookup |
| faq, templates | FAQ editor; WhatsApp journey/catalog + call scripts |
| packages | Package CRUD, outreach schedule, AI copy rewrite |
| payments, recordings | Payment ops awaiting review; call recordings |
| roles, users | RBAC matrix + console agents; users, suspend, credits, break-glass view |
| jobs, jobs.data | Route handlers proxying the pg-boss dashboard (gate in lib/pgboss/dashboard-proxy) |

## (b) Mixed concerns (all MEASURED)
| Evidence | What is mixed |
|---|---|
| agreement/config-actions.ts:52-65 | Action writes `app_settings` directly (cookie client) with column mapping. Its comment (:11-12) says the sibling writes to the same table sit in lib |
| callbacks/policy/actions.ts:68-150 | Action does form→minutes conversion (:84-91), per-day validation (:101-129) and the `callback_schedule_policies` update (:136-150) |
| layout.tsx:112-155 | Layout queries `console_me`, `console_agent_shift` and rpc `is_console_agent`, then composes the softphone gate |
| packages/actions.ts:24-145 | FormData readers, JSON fallback, pricing rule `fixedPriceErrors` (:65-73), campaign-enabled rule (:77-79), template-validation orchestration |
| packages/rewrite-action.ts:13-64 | AI-output validation rules, e.g. line-count preservation (:55-61) |
| calendar/actions.ts:152-167 | Audit log + pg-boss enqueue of `callbackScheduleSweep` in the action. The contacts module logs inside lib instead |
| cookie-consent/actions.ts:43-51,73-81,99-107; dnc/actions.ts:79-87 | Slack alerts sent from actions. platform-roles, users, support and payment-review send theirs from lib/data/admin; there is no `sendSlackAlert` in lib cookie-consent or call-dnc |
| cancellations/[id]/page.tsx:343-375, 263-283, 235 | Page decides the money outcome, builds the timeline, does fee arithmetic, and holds 7 local components |
| callbacks/[id]/page.tsx:66-99; contacts/page.tsx:34-41, 83-94 | Pages derive lead-funnel stage, signup-link state, follow-up stage, and a synthesized thread fallback |
| calendar-client.tsx:162,203; event-edit-dialog.tsx:442; support-client.tsx:58,81; user-detail-gate.tsx:41 | Client components load data by calling Server Actions; each gate is in the data layer. None is a browser Supabase read |

Also: users/[id]/user-actions.tsx:14-21 imports Server Actions from the sibling route ../../roles/actions. resolve-form.tsx:153-166 repeats the server's fee-validity rule on the client.

Security (one line, MEASURED): callbacks/policy/actions.ts and agreement/config-actions.ts parse input before reaching `requirePlatformPermission` (:135, :51). roles and packages check first via `.use()`. The writes are still gated. The gates for the template and exchange actions were confirmed inside lib.

## (c) Large files
| File | Lines | Responsibilities |
|---|---|---|
| calendar/event-edit-dialog.tsx | 752 | `EventEditDialog` 390-751: fetches detail on open (:431-478), maps DTO→form, validates (:484-493), saves and deletes. Same file: linkify engine (:165-271), sales-call summary (:131-162), `CallbackPanel`. MEASURED (read 1-560) |
| calendar/event-form-fields.tsx | 639 | `EventFormFields` is one 410-line component (229-638), plus pickers and option constants. INFERRED (overview) |
| cancellations/[id]/page.tsx | 589 | Page (308-556), 7 sub-components, money and timeline logic. MEASURED |
| callbacks/[id]/page.tsx | 569 | Format/label helpers and funnel logic (MEASURED 1-110); `SalesCallCard` 145-345 and page 354-568 from overview only |
| calendar/calendar-client.tsx | 531 | `AdminExchangeCalendar` 105-530: range loading, polling and focus refresh (:243-255), optimistic writes, create-form state and validation. MEASURED (55-330) |
| packages/package-form.tsx | 514 | `PackageForm` 233-513 plus `TouchpointRow` schedule editor 95-231 |
| analytics/page.tsx | 493 | One 443-line component: 4 loads, quota aggregation (:85-104), consent strip, ~17 section cards. Composition only. MEASURED (full) |
| users/[id]/user-actions.tsx | 467 | Three features in one file: suspend/credit, staff-role selector (85-149), console-agent enrolment (161-295) |
| roles/roles-client.tsx | 435 | Matrix, accordion, create form. INFERRED |

Files between 362 and 390 lines: faq-catalog-editor, offer-form, resolve-form, template-admin-client, assignments/[id]/page (one 326-line component), templates/page, cancellations/page.

## (d) Duplication (MEASURED unless marked)
1. One identical `inputClass` string appears in 9 files: agreement-config-form:39, company-form:26, policy-form:30, exchange-manager:19, templates-client:38, dnc-client:16, review-card:16, roles-client:59, faq-catalog-editor:46. A second variant appears in 7 files: agreement-client:12, contract-body-editor:21, offer-form:55, support-client:25, user-actions:51, user-detail-gate:13, package-form:84. The same `sectionClass` string is in 7 files.
2. There are three sales-call summary variants with different outputs (null vs '—', 'שניות' vs 'שנ׳', different voicemail wording): callbacks/page.tsx:24-50, event-edit-dialog.tsx:131-162, callbacks/[id]/page.tsx:37-49.
3. `eventStatusText` is defined identically at cancellations/page.tsx:115-117 and cancellations/[id]/page.tsx:81-83.
4. Calendar:
   - The datetime-local formatter appears twice (event-edit-dialog:121-125, calendar-client:86-89).
   - The empty event form appears twice (calendar-client:70-83, event-edit-dialog:416-429).
   - The show-as labels appear twice (event-edit-dialog:336-342, event-form-fields:74-80).
   - The end-after-start rule appears 4× (calendar/actions:86,173; event-edit-dialog:490; calendar-client:340).
5. The hidden-JSON field is parsed with a `[]` fallback twice: packages/actions.ts:45-61 and offers/actions.ts:17-39.
6. The shape toggle + Slack alert + revalidate repeats 3× in cookie-consent/actions.ts:27-110 and once more in dnc/actions.ts:70-90.
7. The reason-gated read UI is duplicated, with the same 10-character rule and the same heading: support-client:51,93 and user-detail-gate:36,58.
8. List URL builders are hand-written per page: cancellations/page:77-84, contacts/page:104-110, activity/page:196-212, templates/page:272-277, assignments/list-params:18-26. Only `parsePageParam` and `firstParam` are shared (_components:50-61).
9. The ILS formatter in offer-form:57-61 copies _components:16-24. Refund rounding is repeated at resolve-form:82 and cancellations/[id]/page:235,510.
10. The permission middleware is repeated: `.use(requirePlatformOwner)` 8× in roles/actions.ts and `.use(requirePlatformAction)` 3× in packages/actions.ts.
11. Pages keep their own label maps (recordings:35-46, assignments/[id]:20-33, cancellations/[id]:56-78, cancellations/page:55-58) next to `src/lib/data/admin/labels.ts`. Whether they overlap with it is INFERRED.

## (e) Coverage
- Read in full: all 23 action files, layout, recordings/page, _components, _form-fields, analytics/page, assignments/list-params, both jobs routes.
- Range-read:
  - Calendar: event-edit-dialog 1-560, calendar-client 55-330, event-form-fields 60-82.
  - Cancellations: [id]/page 50-400, page 1-240, resolve-form 1-230.
  - Callbacks: [id]/page 1-110, page 1-60.
  - activity/page 1-240, contacts/page 1-110.
  - Assignments: page 1-130, [id]/page 1-140.
  - templates/page 1-120 and 260-300; offer-form 1-180.
  - user-actions 1-30, 150-200, 297-360; package-form 233-300.
  - support-client 40-100, user-detail-gate 20-60.
- Overview only (claims INFERRED): dnc-client, roles-client, faq-catalog-editor, analytics/_sections, template-admin-client.
- Pattern scan only (imports, 'use client', DB calls, gates, class constants): the remaining ~70 small files in agreement, analytics, assignments, calendar, callbacks, campaigns, company, contacts, cookie-consent, dnc, events, faq, offers, packages, payments, roles, settings, support, templates and users.
- Skipped: 51 test files and 3 AGENTS.md.
- No `find_referencing_symbols` was run, so this report makes no unused-code claims.
- Lib was read only to confirm delegation and gate placement.