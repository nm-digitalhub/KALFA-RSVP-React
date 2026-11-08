# Customer and auth i18n map

Area `customer-auth`: logged-in customer app and auth pages, 86 files, 14,430 lines. Records are in `customer-auth.jsonl`. Line numbers are 1-based, as in `lint-raw.txt`. File paths in the table below drop the leading `src/app/`.

## Totals

- Records: 1007. Unique keys: 886.
- Action: convert 853, restructure 137, keep 0, decide 17.
- Scope: render 904, module 103.
- Namespace: customer 971, admin 24, common 12.
- Audience: customer 983, staff 24.
- Flags: concat 101, rich-text 31, dynamic-key 55, plural 33, legal 12, gender-slash 9, logic 6, legal-signed 0, outbound 0, worker 0, b2b-wording 0.
- Already converted: none. The AST pass found no `t('key', 'default')` call in the 86 files.

**Why `keep`, `legal-signed` and `outbound` are 0.** No Hebrew literal in these files is compared, used as a `case`, a type, an object key or a regex (AST check, all 86 files). The 6 `logic` flags are different: those strings name or carry values that are parsed or posted elsewhere, namely the import headers and the payer fallback. The signed text is not here:

- `recordPackageApproval` hashes the PDF built from `agreementContent` and the approved document (`src/lib/data/agreements.ts`, lines 201-226). The checkbox labels never reach it.
- The marketing consent wording is server text from `src/lib/marketing/consent-wording`, pinned by SHA-256 in its test. These files only render the prop.
- No send text lives here. Team invites send no email yet, per the source comment in `team/actions.ts`. The one push body is `decide`.

These must stay Hebrew when the `lib` area is mapped: `agreementContent` and `renderAgreementBody`, `CHANNEL_LABELS`, `fmtAgreementDate`, and `consentTemplate`.

## Per file

| File | convert | restructure | keep | decide | Module-scope | `'use client'` change | Risk note |
|---|---:|---:|---:|---:|---:|---|---|
| `(access)/access-denied/page.tsx` | 7 | 1 | 0 | 0 | 1 | no | Hard-coded dir="rtl" on main. |
| `(customer)/app/error.tsx` | 5 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/[id]/actions.ts` | 8 | 0 | 0 | 0 | 0 | no | returnUserError(err.message) at line 172 surfaces four *_LOCKED_ERROR constants from src/lib/data/events that are also compared by value; they are outside this file. |
| `(customer)/app/events/[id]/benefit-accept-banner.tsx` | 2 | 2 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/[id]/campaign/[campaignId]/approve/agreement-sheet.tsx` | 2 | 0 | 0 | 0 | 0 | no | Chrome only. The sheet body is the server-rendered agreement HTML, which stays Hebrew, so a translated page opens a Hebrew contract. |
| `(customer)/app/events/[id]/campaign/[campaignId]/approve/approve-package-terms-form.tsx` | 1 | 0 | 0 | 2 | 0 | no | Consent boxes split around links, with מאשר/ת. Not evidence text, but they are the act of acceptance. |
| `(customer)/app/events/[id]/campaign/[campaignId]/approve/package-terms-step.tsx` | 8 | 0 | 0 | 3 | 0 | no | CHANNEL_LABELS and fmtAgreementDate come from src/lib/agreements and also feed the signed document. Translating them for this summary must not change the document. |
| `(customer)/app/events/[id]/campaign/[campaignId]/approve/page.tsx` | 5 | 1 | 0 | 0 | 1 | no |  |
| `(customer)/app/events/[id]/campaign/[campaignId]/manage-client.tsx` | 64 | 5 | 0 | 0 | 0 | no | Staff-only sections live in a customer client file, so it needs two namespaces. Labels also come from guests/labels.ts and src/lib/data/event-labels. 13 he-IL number calls. |
| `(customer)/app/events/[id]/campaign/[campaignId]/page.tsx` | 2 | 1 | 0 | 0 | 1 | no |  |
| `(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.tsx` | 24 | 13 | 0 | 0 | 13 | no | Card-number, CVV, captcha and Google Pay frames are CardCom's and render in CardCom's language, outside t(). Label text sits around them. |
| `(customer)/app/events/[id]/campaign/[campaignId]/payment/package-payment-view.tsx` | 11 | 2 | 0 | 0 | 2 | no | Most screen text comes from PURCHASE_ERROR_MESSAGES and SERVICE_STARTING in src/lib/payments, outside this file. |
| `(customer)/app/events/[id]/campaign/[campaignId]/payment/page.tsx` | 0 | 1 | 0 | 1 | 1 | no |  |
| `(customer)/app/events/[id]/campaign/[campaignId]/payment/sumit-card-form.tsx` | 10 | 7 | 0 | 0 | 6 | no | ResponseLanguage is 'he-IL' at line 155, so SUMIT writes Hebrew tokenization errors into .og-errors whatever the UI language. Hard-coded dir="rtl" on the dialog. |
| `(customer)/app/events/[id]/campaign/campaign-actions.ts` | 27 | 0 | 0 | 0 | 0 | no | returnUserError(result.error) and thrown messages from publishEvent, closeEvent and createCampaign reach the customer unchanged; those Hebrew strings live in src/lib/data. |
| `(customer)/app/events/[id]/cancellation-request-form.tsx` | 4 | 5 | 0 | 1 | 3 | no | existingRequest.resolutionNote is staff-written free text and stays in the language it was typed in. |
| `(customer)/app/events/[id]/edit-event-form.tsx` | 28 | 0 | 0 | 0 | 0 | no | EVENT_TYPE_LABELS comes from src/lib/data/event-labels. The 5MB figure is typed into three strings while the limit is the INVITE_IMAGE_MAX_BYTES constant. |
| `(customer)/app/events/[id]/event-status-actions.tsx` | 3 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/[id]/event-summary.tsx` | 27 | 1 | 0 | 0 | 0 | no | summaryBillingRows is an exported pure function: getT goes inside it. BillingRow uses the label as a React key, which still works once translated. Labels also come from src/lib/payments/operation-labels. |
| `(customer)/app/events/[id]/guests/[guestId]/page.tsx` | 14 | 1 | 0 | 0 | 1 | no | OP_STATUS_LABELS and DELIVERY_STATUS_LABELS come from guests/labels.ts. |
| `(customer)/app/events/[id]/guests/[guestId]/rsvp-link.tsx` | 9 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/[id]/guests/add-guests-onboarding.tsx` | 15 | 1 | 0 | 0 | 0 | no | CUSTOMER_STAGE_LABELS comes from src/lib/data/event-labels. Server component, but the `description` prop already takes ReactNode, so the rich-text case fits. |
| `(customer)/app/events/[id]/guests/contact-status-cell.tsx` | 1 | 1 | 0 | 0 | 0 | no | Option text comes from CONTACT_STATUS_LABELS; the option values stay DB enum values. |
| `(customer)/app/events/[id]/guests/fill-expected-count.tsx` | 5 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/[id]/guests/groups-manager.tsx` | 13 | 0 | 0 | 0 | 0 | no | sr-only suffixes ` – {group.name}` hold no words and stay in JSX. |
| `(customer)/app/events/[id]/guests/guest-form.tsx` | 8 | 0 | 0 | 0 | 0 | no | Option text comes from labels.ts; option values stay DB enums. |
| `(customer)/app/events/[id]/guests/guest-list-controls.tsx` | 18 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/[id]/guests/guest-row-actions.tsx` | 14 | 0 | 0 | 0 | 0 | no | The source comment requires the visible text to stay a prefix of the accessible name (label-in-name). The translated editNamed and deleteNamed must keep that, or voice control breaks. |
| `(customer)/app/events/[id]/guests/guests-actions.ts` | 17 | 0 | 0 | 0 | 0 | no | err.message === PHONE_TAKEN_ERROR and GROUP_NAME_TAKEN_ERROR compare Hebrew constants from src/lib/data/guests by value and show them as field errors. |
| `(customer)/app/events/[id]/guests/import/import-actions.ts` | 17 | 0 | 0 | 0 | 0 | no | Row messages come from importRowSchema in src/lib/validation/guests (zod, lib area). Header aliases live in src/lib/data/guest-import-shared. |
| `(customer)/app/events/[id]/guests/import/import-form.tsx` | 13 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/[id]/guests/import/page.tsx` | 8 | 1 | 0 | 4 | 1 | no | The downloadable template comes from src/lib/guests/import-template; its Hebrew headers and filename are outside this file. |
| `(customer)/app/events/[id]/guests/import/whatsapp/actions.ts` | 10 | 0 | 0 | 0 | 0 | no | Thrown data-layer messages reach the owner unchanged through safe-action, per the source comment. |
| `(customer)/app/events/[id]/guests/import/whatsapp/page.tsx` | 14 | 5 | 0 | 0 | 1 | no | error_rows are Hebrew messages already stored in the database by the WhatsApp import, which runs with no request language (inferred from the source comment; the writer is outside this file). |
| `(customer)/app/events/[id]/guests/import/whatsapp/staging-client.tsx` | 13 | 10 | 0 | 0 | 3 | no | Heaviest rich-text file in the area: guest names and phones sit in <bdi> inside sentences that are also split by conditionals. |
| `(customer)/app/events/[id]/guests/labels.ts` | 0 | 19 | 0 | 0 | 19 | no | Consumers confirmed with LSP find_referencing_symbols: GUEST_STATUS_LABELS 3 customer files plus admin/support.ts; CONTACT_STATUS_LABELS 3 customer files; OP_STATUS_LABELS 3 customer files. admin/labels.ts keeps its own separate CONTACT_STATUS_LABELS. None is compared or stored; values are display only. |
| `(customer)/app/events/[id]/guests/loading.tsx` | 1 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/[id]/guests/new/page.tsx` | 3 | 1 | 0 | 0 | 1 | no |  |
| `(customer)/app/events/[id]/guests/not-found.tsx` | 3 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/[id]/guests/page.tsx` | 32 | 1 | 0 | 0 | 1 | no | Module helpers headcountValue and GuestCard render text, so each needs its own getT call. Status text comes from labels.ts. |
| `(customer)/app/events/[id]/package-choice-form.tsx` | 13 | 1 | 0 | 0 | 0 | no | offer.name, offer.description and offer.includes come from the database in Hebrew and are not in t() (see OD-4). The source comment says wording touching the price is compliance-reviewed before it goes live. |
| `(customer)/app/events/[id]/page.tsx` | 20 | 2 | 0 | 0 | 0 | no | generateMetadata uses event.name, which is user content and stays as typed. Status, stage and type labels come from src/lib/data/event-labels; unavailableNoticeOf and closeControl.hint come from src/lib/data/event-lifecycle. |
| `(customer)/app/events/[id]/setup-shell.tsx` | 2 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/[id]/setup-stepper.tsx` | 2 | 4 | 0 | 0 | 4 | no | Step labels and hints arrive as props from src/lib/data/setup-steps, so the translation happens on the server side of that boundary. |
| `(customer)/app/events/[id]/setup/page.tsx` | 5 | 1 | 0 | 3 | 1 | no | Acknowledgment text with מאשר/ת. SETUP_LOCK_WARNING and SETUP_STEP_LABELS come from src/lib/data/setup-steps. offers come from the database. |
| `(customer)/app/events/[id]/stats/page.tsx` | 40 | 1 | 0 | 0 | 1 | no | Alert labels (a.label) come from src/lib/data/event-stats. Status and stage labels come from src/lib/data/event-labels. SectionCard is a module helper and needs its own getT call. |
| `(customer)/app/events/[id]/stats/stats-refresh-button.tsx` | 2 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/events/actions.ts` | 4 | 0 | 0 | 0 | 0 | no | ONE_EVENT_PER_ACCOUNT_ERROR is compared by value and passed through; it lives in src/lib/data/events. |
| `(customer)/app/events/celebrant-fields.tsx` | 4 | 0 | 0 | 0 | 0 | no | Field and option labels come from src/lib/data/event-labels. |
| `(customer)/app/events/new/new-event-form.tsx` | 22 | 2 | 0 | 0 | 0 | no | Shares its keys with edit-event-form, which is deliberate: the source says the two forms mirror each other. |
| `(customer)/app/events/new/page.tsx` | 2 | 1 | 0 | 0 | 1 | no |  |
| `(customer)/app/events/page.tsx` | 5 | 4 | 0 | 0 | 4 | no | Type and status labels come from src/lib/data/event-labels. |
| `(customer)/app/loading.tsx` | 1 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/not-found.tsx` | 3 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/page.tsx` | 3 | 1 | 0 | 0 | 1 | no |  |
| `(customer)/app/settings/actions.ts` | 23 | 1 | 0 | 0 | 1 | no | The SMS code and the confirmation emails are sent by Supabase Auth and the sms-hook, outside this file and outside t(). |
| `(customer)/app/settings/customer-number-field.tsx` | 3 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/settings/page.tsx` | 0 | 1 | 0 | 0 | 1 | no |  |
| `(customer)/app/settings/passkey-manager.tsx` | 15 | 0 | 0 | 0 | 0 | no | The browser's own passkey prompt is outside the app. |
| `(customer)/app/settings/push-actions.ts` | 4 | 0 | 0 | 1 | 0 | no |  |
| `(customer)/app/settings/push-notification-manager.tsx` | 27 | 0 | 0 | 0 | 0 | no |  |
| `(customer)/app/settings/settings-client.tsx` | 63 | 0 | 0 | 1 | 0 | no | Consent wording rendered here is evidence text from the server, not in this file. Six section components each need their own getT call. |
| `(customer)/app/team/actions.ts` | 10 | 0 | 0 | 0 | 0 | no | src/lib/data/orgs throws Hebrew messages that reach the customer unchanged (rethrowOrFallback). The source says no invite email is sent yet; the inviter shares the link. |
| `(customer)/app/team/page.tsx` | 0 | 1 | 0 | 0 | 1 | no |  |
| `(customer)/app/team/roles/actions.ts` | 2 | 6 | 0 | 0 | 6 | no |  |
| `(customer)/app/team/roles/org-roles-client.tsx` | 14 | 8 | 0 | 0 | 8 | no | role.label and permission.label come from the database in Hebrew (see OD-4). The source says this file was copied from admin/roles/roles-client.tsx, so the same strings exist there. |
| `(customer)/app/team/roles/page.tsx` | 3 | 1 | 0 | 0 | 1 | no |  |
| `(customer)/app/team/team-client.tsx` | 29 | 0 | 0 | 0 | 0 | no | roleLabel values come from the database. |
| `auth/actions.ts` | 9 | 0 | 0 | 0 | 0 | no | Field messages come from the shared schemas in src/lib/validation/schemas (lib area). Confirmation and recovery emails come from Supabase templates, outside t(). |
| `auth/confirm/expired/page.tsx` | 6 | 3 | 0 | 0 | 2 | no |  |
| `auth/confirm/expired/resend-form.tsx` | 2 | 0 | 0 | 0 | 0 | no |  |
| `auth/confirm/page.tsx` | 3 | 2 | 0 | 0 | 2 | no |  |
| `auth/error.tsx` | 6 | 0 | 0 | 0 | 0 | no |  |
| `auth/forgot-password/forgot-password-form.tsx` | 2 | 0 | 0 | 0 | 0 | no |  |
| `auth/forgot-password/page.tsx` | 2 | 3 | 0 | 0 | 2 | no |  |
| `auth/loading.tsx` | 1 | 0 | 0 | 0 | 0 | no |  |
| `auth/login/login-form.tsx` | 5 | 1 | 0 | 0 | 0 | no |  |
| `auth/login/page.tsx` | 3 | 3 | 0 | 0 | 2 | no |  |
| `auth/login/passkey-sign-in-button.tsx` | 3 | 0 | 0 | 0 | 0 | no | The English .includes() checks test provider messages, not Hebrew text. |
| `auth/reset-password/page.tsx` | 4 | 2 | 0 | 0 | 2 | no |  |
| `auth/reset-password/reset-password-form.tsx` | 3 | 0 | 0 | 0 | 0 | no |  |
| `auth/signup/page.tsx` | 5 | 6 | 0 | 0 | 5 | no | marketingConsentText is the versioned server wording and stays Hebrew (see OD-1). |
| `auth/signup/password-field.tsx` | 1 | 0 | 0 | 0 | 0 | no | Requirement labels come from PASSWORD_REQUIREMENTS in src/lib/password-strength (lib area). |
| `auth/signup/signup-form.tsx` | 5 | 0 | 0 | 1 | 0 | no | Terms box split around two links. marketingConsentText is the versioned server wording and stays Hebrew. |
| `auth/signup/success/page.tsx` | 6 | 2 | 0 | 0 | 2 | no | Gender-slash verbs in two sentences; the same page also uses the singular אליך while other auth pages use the plural. |
| `oauth/consent/page.tsx` | 0 | 1 | 0 | 0 | 1 | no | All consent UI text is in src/components/oauth-consent (shared area). |

No file needs a `'use client'` change: `getT` is a plain function that works in server and client components, as `rating-form.tsx` shows.

## Non-text items (seen, not fixed)

**`he-IL` number formatting**
- `toLocaleString('he-IL')`: `approve/package-terms-step.tsx:76`; `manage-client.tsx:300,301,327,368,372,376,388,392,396,577,935,937`; `event-summary.tsx:72`; `guests/fill-expected-count.tsx:58`; `guests/guests-actions.ts:315`.
- `ResponseLanguage: 'he-IL'`: `payment/sumit-card-form.tsx:155`. SUMIT writes its own Hebrew errors into `.og-errors`.
- Indirect: `formatIsraelDate`, `formatIsraelDateTime`, `formatAmount` and `formatCurrency` are called from 16 of these files. Their locale is set in `src/lib/date` and `src/lib/format`, which are outside this area.

**Physical arrows**
- `ChevronRight`: `campaign/[campaignId]/page.tsx:173`, `stats/page.tsx:110`.
- `→` in an `aria-hidden` span: `approve/page.tsx:33`, `setup-shell.tsx:36`, `setup-stepper.tsx:150`, `new/page.tsx:23`.
- `→` inside the string itself: `events/[id]/page.tsx:169,357` (recorded as `restructure`).
- `↓` in `guests/import/page.tsx:41` is vertical and needs no flip.

**Hard-coded direction**
- `dir="rtl"`: `access-denied/page.tsx:17`, `cardcom-open-fields-form.tsx:539,543`, `sumit-card-form.tsx:340`.
- `dir="ltr"` on emails, phones, amounts and card fields is correct in every language; leave it. That includes `cardcom-open-fields-form.tsx:538`, which sets the card expiry order.
- Physical classes: `text-right` at `whatsapp/page.tsx:124`, `text-left` at `guests/[guestId]/page.tsx:151`.

**None found in these files:** `lang=`, `DirectionProvider`, Hebrew-calendar dates.

**Outside `t()` by nature**
- CardCom card, CVV, captcha and Google Pay frames render in CardCom's language.
- SMS codes and auth emails come from Supabase and the `sms-hook`.
- Israeli input assumptions stay in the UI: 9-digit ID, `050-000-0000` placeholder, `DateSelectIL`, "(שעון ישראל)".

## Shared mechanisms needed

**1. Rich text (31 records).** `t()` returns a string, so a sentence holding a link, `<strong>` or `<bdi>` needs a way back to elements.
- Verified: react-i18next's `Trans` maps named tags through its `components` prop (`TransWithoutContext.js`, via ctx7). `react-i18next` is not in `package.json`.
- Alternative: a small in-repo helper that splits the `t()` result on `<tag>…</tag>` and maps tags to elements. This is a design proposal, not a library API.
- Inferred, not tested: `Trans` working with the instance from `getFixedT` and no provider.
- Records whose element is only a `dir="ltr"` or `<bdi>` wrapper could use plain interpolation plus Unicode isolates instead. Each such record says so.
- See OD-2.

**2. Metadata (32 records in 25 pages).** Replace `export const metadata` with `generateMetadata()` that calls `getT` inside.
- Verified in `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`, lines 109-110: Server Components only, and a segment cannot export both.
- `events/[id]/page.tsx` already uses `generateMetadata`, with the event name.

**3. Module label maps (64 records in 10 files).** Turn each `Record` into a function that returns the same exhaustive `Record`, with `getT` inside and one static `t()` per value. Callers call it during render. This keeps static keys for `extract` and the compile-time exhaustiveness in `labels.ts`. `PURCHASE_COPY` is also read by `sumit-card-form.test.ts`, so that test changes with it.

**4. Zod messages (8 records here; most Zod text is in `src/lib/validation`).** Pass a function: `{ error: () => t('key', 'טקסט') }`.
- Verified in zod v4.6.7 `error-customization.mdx`: the `error` param accepts a function that runs at parse time. `package.json` has `^4.6.7`.
- Inferred: the request language is reachable at parse time. That depends on the language design, which does not exist yet.

**5. Plurals (33 records).** Call `t('key', 'default', { count })`.
- Measured with `Intl.PluralRules`: `he` one, two, other; `en` one, other; `fr` one, many, other.
- Verified: i18next resolves through `Intl.PluralRules`, and `i18next-cli extract` generates suffixed keys for `count`.
- Not verified: which default each Hebrew suffix receives. Today's Hebrew has one form for every count, so all forms must carry that same text. Test one key before converting the rest.

**6. Hebrew constants compared by value.** `PHONE_TAKEN_ERROR`, `GROUP_NAME_TAKEN_ERROR`, `ONE_EVENT_PER_ACCOUNT_ERROR`, `DATES_LOCKED_ERROR` and three other lock errors are compared with `err.message` in these actions, then shown. They live in `src/lib/data`. Translating the constant breaks nothing only if the throw and the comparison stay together; a stable error code with `t()` at the display point is safer. Other thrown Hebrew reaches customers unchanged through `safe-action`: `publishEvent`, `closeEvent`, `createCampaign`, `src/lib/data/orgs`.

**7. Fragments spliced into sentences.** `LoadFailureNotice` takes a Hebrew noun phrase in `what`. `labelPrefix` is joined as `${labelPrefix} – ${part}` inside the shared `DateSelectIL` and `TimeSelect24` (verified, line 57 and line 36). The first is recorded as `restructure`. The second is a `convert` here, but the joining code is in the shared area.

**8. Reused keys.** `src/app/auth/error.tsx` and the customer `error.tsx` share `error.boundary.*`. Four of those strings also exist in `public` as `error.generic.*` and `error.updated.*`, so they are a `common` candidate; the `public` keys already shipped, so this map does not move them. `shared.*` holds repeated UI words (ביטול, מחיקה, נכשל, טוען…, חזרה לאירוע). `edit-event-form` and `new-event-form` share `events.form.*` on purpose, as the source says they mirror each other.

## Owner decisions

- **OD-1** Consent and contract-summary text: may it be shown translated while the contract and consent wording stay Hebrew? Covers 11 records: package approval boxes, the terms summary, setup acknowledgments, SMS consent, the marketing label, signup terms.
- **OD-2** Rich text: install `react-i18next` for `Trans`, or build a small in-repo helper?
- **OD-3** Guest import headers: keep Hebrew and English headers for every language, or add French aliases first? `guestImportHeaderKey` has no French.
- **OD-4** Hebrew held in the database: package name, description and includes; role and permission labels; stored WhatsApp import `error_rows`. Translate them, or show them as stored?
- **OD-5** Fallback name לקוח KALFA, prefilled in the card-holder field and posted to CardCom: translate it, or leave the field empty? The same literal is the signer fallback in `agreements.ts`, which must not change.
- **OD-6** Test push body: translate by request language, or treat push as an outbound channel and keep it?
- **OD-7** 24 staff-only strings inside customer files are mapped to `admin`: if admin stays out of scope, they stay as they are.

## Coverage

86 of 86 files read, each to its last line through Serena. No assigned file was unreadable.

Method: exact text and line numbers come from a TypeScript AST pass over the text Serena returned (`out/.ca-work/extract.cjs`), so no Hebrew was retyped. Every record was classified by hand after reading its file.

Cross-checks:
- `find_referencing_symbols` (LSP) confirmed the consumers of `GUEST_STATUS_LABELS`, `CONTACT_STATUS_LABELS`, `OP_STATUS_LABELS` and `PURCHASE_COPY`.
- All 428 Hebrew strings in `lint-raw.txt` for these files are inside a record.
- Every non-comment Hebrew line is inside a record.
- Where `instrument-dryrun` reports more module strings than this map, the extras are Tailwind class constants, seen in the reads (for example `inputClass`, `NOTICE`).
- One key has two texts on purpose: `events.new.requiredLegend`, a sentence split around an asterisk.
- Not read as part of this area: the `src/lib` modules named above, except the parts quoted here.
