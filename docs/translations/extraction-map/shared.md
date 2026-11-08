# i18n map: shared components, API routes, root files

Rows: 579 in `shared.jsonl`: 571 carrying Hebrew (570 string or JSX literals, 1 regex) and 8 English strings a person meets. Line numbers and text come from a TypeScript AST pass (`out/_tools/extract-shared.cjs`), so each literal is listed once; comments are skipped. `out/_tools/` is working material, not output: the extractors and a 3.3 MB literal dump.

| action | rows |
|---|---|
| convert | 390 |
| restructure | 137 |
| keep | 45 |
| decide | 7 |

Namespaces for convert and restructure: admin 349, common 92, public 73, customer 13.

Flags: logic 37, outbound 26, concat 24, plural 5, legal 3, rich-text 3, gender-slash 2, b2b-wording 1.

`needs use client change` is `no` everywhere: `getT` is a plain function and already runs in both client and server components (`rating-form.tsx`).

## Per file

| file | convert | restructure | keep | decide | module-scope | use client change | risk note |
|---|---|---|---|---|---|---|---|
| `src/app/[...catchAll]/route.ts` | 0 | 9 | 0 | 0 | 0 | no | Plain-string HTML, no React escaping. Must stay in sync with not-found.tsx. English markdown 404 body (lines 33-51) is for agents and stays. lang/dir hard-coded at line 77. |
| `src/app/api/agents/sdk-auth/route.ts` | 5 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/agents/shift/route.ts` | 5 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/agents/status/route.ts` | 4 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/agents/telemetry/route.ts` | 6 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/call-me-now/request-code/route.ts` | 6 | 0 | 0 | 0 | 0 | no | Public route; its error reaches the visitor. requestOtp can return its own Hebrew from src/lib/data/otp.ts. |
| `src/app/api/calls/[callAttemptId]/agent-command/route.ts` | 10 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/calls/[callAttemptId]/end/route.ts` | 7 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/calls/[callAttemptId]/monitor/route.ts` | 11 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/campaigns/[id]/purchase/cardcom/route.ts` | 0 | 0 | 1 | 0 | 0 | no | Receipt name fallback only. Other outcomes are codes the browser maps itself. |
| `src/app/api/campaigns/[id]/purchase/route.ts` | 0 | 0 | 1 | 0 | 0 | no | Receipt name fallback only. Errors leave as ?error=<code>. English 403 "Forbidden" is a cross-origin refusal, not UI. |
| `src/app/api/campaigns/[id]/status/route.ts` | 5 | 2 | 2 | 0 | 2 | no | HIGH. CONFLICT_MESSAGES matches Hebrew err.message. Translating the domain throw turns 409 into 500. Needs typed errors first. |
| `src/app/api/cardcom/webhook/route.ts` | 0 | 0 | 1 | 0 | 0 | no | Slack title only. Server to server. |
| `src/app/api/console-calls/[id]/conference/remove/route.ts` | 10 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/console-calls/[id]/conference/route.ts` | 18 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/console-calls/[id]/consult/cancel/route.ts` | 10 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/console-calls/[id]/consult/complete/route.ts` | 10 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/console-calls/[id]/consult/route.ts` | 18 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/console-calls/[id]/transfer/route.ts` | 14 | 0 | 0 | 0 | 0 | no | Staff console route. API `error` value, see each row for whether a browser shows it. |
| `src/app/api/console-calls/dial-intent/route.ts` | 12 | 0 | 0 | 0 | 0 | no | Staff console route; `reason` and `vox_code` are the machine fields, `error` is display only. |
| `src/app/api/elevenlabs/rsvp-sales-call-dispatch/pcw_id/route.ts` | 0 | 0 | 1 | 0 | 0 | no | Slack title only. Server to server. |
| `src/app/api/elevenlabs/rsvp/update/route.ts` | 0 | 0 | 1 | 0 | 0 | no | Slack title only. Server to server. |
| `src/app/api/events/[eventId]/outreach-call/route.ts` | 12 | 0 | 0 | 0 | 0 | no | Staff console route; the app branches on `code`, so the Hebrew can change safely. |
| `src/app/api/voximplant/console/route-inbound/route.ts` | 0 | 0 | 4 | 0 | 0 | no | Slack alerts only. Response is read by the scenario; caller_display comes from data. |
| `src/app/api/voximplant/ctx/[token]/route.ts` | 0 | 0 | 23 | 0 | 21 | no | HIGH if EVENT_TYPE_LABELS, celebrantsTextFor or formatIsraelSpokenDate ever follow the web language: these feed a live call. Everything here is voice. |
| `src/app/api/voximplant/mtg/ctx/[token]/route.ts` | 0 | 0 | 5 | 0 | 2 | no | PLACEHOLDER_NAMES matches stored values exactly, pinned by a test against console-calls.ts. Rest is voice. |
| `src/app/api/webhooks/whatsapp/route.ts` | 0 | 0 | 4 | 0 | 0 | no | Slack alerts only. Server to server. |
| `src/app/api/widget/sdk-auth/route.ts` | 5 | 0 | 0 | 0 | 0 | no | No caller found in src/; the WebRTC widget was replaced. Convert only if the route stays. |
| `src/app/global-error.tsx` | 5 | 0 | 0 | 0 | 0 | no | Renders with no layout and no provider. lang/dir hard-coded at line 21. |
| `src/app/layout.tsx` | 4 | 0 | 0 | 0 | 0 | no | Root metadata. lang/dir at line 76, DirectionProvider at line 84. revalidate = 20 and static auth pages: a request-derived language here changes rendering. |
| `src/app/llms.txt/route.ts` | 0 | 0 | 0 | 1 | 0 | no | force-static, bilingual, contains B2B wording. Owner decision. |
| `src/app/manifest.ts` | 2 | 0 | 0 | 0 | 0 | no | One manifest for every user; dir and lang hard-coded at lines 11-12. |
| `src/app/not-found-back-link.tsx` | 1 | 0 | 0 | 0 | 0 | no | None. |
| `src/app/not-found.tsx` | 8 | 0 | 0 | 0 | 0 | no | Keep in sync with the catch-all route. |
| `src/components/add-to-calendar-island.tsx` | 18 | 0 | 0 | 0 | 0 | no | Guest surface. rows() helper needs t passed in. |
| `src/components/admin-shell.tsx` | 5 | 39 | 0 | 0 | 39 | no | Largest restructure here: exported NAV_GROUPS holds 38 labels; group label doubles as state and React key; admin-nav-coverage.test.ts reads the export. |
| `src/components/app-shell.tsx` | 5 | 3 | 0 | 0 | 3 | no | Two module-scope nav arrays. |
| `src/components/availability/actions.ts` | 7 | 0 | 0 | 0 | 0 | no | Server Action: no root-params language (docs). result.message from exchange-availability.ts passes through untranslated. |
| `src/components/availability/availability-status.tsx` | 8 | 9 | 0 | 0 | 9 | no | Two module-scope tables. block.label comes from the server in Hebrew. |
| `src/components/console/ai-handoff-section.tsx` | 18 | 10 | 0 | 0 | 10 | no | Shows server errors verbatim (line 243). "אין session פעיל" mixes an English word into Hebrew; do not reword. |
| `src/components/console/call-bar.tsx` | 21 | 5 | 0 | 0 | 5 | no | Shows server errors verbatim (line 208). STATE_LABEL wording is deliberate (comment at line 34). |
| `src/components/console/chat-section.tsx` | 8 | 0 | 0 | 0 | 0 | no | chatAuthorDisplayName comes from src/lib/console/chat and may hold Hebrew (not in this list). |
| `src/components/console/push-alert-actions.ts` | 2 | 0 | 0 | 0 | 0 | no | Server Action; see availability/actions.ts. |
| `src/components/console/push-alert-toggle.tsx` | 9 | 0 | 0 | 0 | 0 | no | None. |
| `src/components/console/roster-dial-button.tsx` | 3 | 0 | 0 | 0 | 0 | no | Hebrew preposition glued to a name. err.message may come from web-client.ts. |
| `src/components/console/softphone-panel.tsx` | 33 | 24 | 0 | 0 | 24 | no | Six module-scope tables. phoneSnap.detail (line 853) is text from web-client.ts. Queue names are DB data (nameHe). |
| `src/components/date-select-il.tsx` | 3 | 0 | 0 | 0 | 0 | no | dd/mm/yyyy order is a product decision, fixed by the component. Lint hits at lines 119, 134, 149 are the "--" empty option: language-neutral, left as is. |
| `src/components/forms.tsx` | 1 | 0 | 0 | 0 | 0 | no | Highest fan-out: 57 files. One key, common. |
| `src/components/forms/callback-fields.tsx` | 5 | 4 | 1 | 0 | 4 | no | TopicSelect renders INQUIRY_TOPICS values as both label and posted value; callback-scheduling.ts routes on the Hebrew value (comment at line 13). No literal in this file, but translating needs a value-to-label map. Legal text at line 114. |
| `src/components/guest/guest-shell.tsx` | 1 | 0 | 0 | 0 | 0 | no | Rich text around the KALFA link. Lint hit at line 45 is the brand name KALFA, which stays. |
| `src/components/help-tip.tsx` | 1 | 0 | 0 | 0 | 0 | no | dir="rtl" and text-right hard-coded at lines 29-30. text prop comes from callers. |
| `src/components/jsonforms/value-path-control.tsx` | 2 | 0 | 0 | 0 | 0 | no | Admin only; label, description and errors arrive from the JSON Forms schema and JSON_FORMS_I18N. |
| `src/components/landing-header-nav.tsx` | 1 | 5 | 0 | 0 | 5 | no | site-header.test.ts imports LANDING_NAV_ITEMS: check what it asserts before moving the labels. |
| `src/components/landing-mobile-nav.tsx` | 10 | 0 | 0 | 0 | 0 | no | Hard-coded physical ArrowLeft (line 116), SheetContent side="right" (line 64). Duplicates the header labels, so share the keys. |
| `src/components/landing-user-menu.tsx` | 5 | 0 | 0 | 0 | 0 | no | Shares common nav keys with the customer and admin shells. |
| `src/components/org-switcher.tsx` | 3 | 0 | 0 | 0 | 0 | no | None. |
| `src/components/pagination.tsx` | 7 | 0 | 0 | 0 | 0 | no | Server Component used on 16 surfaces. |
| `src/components/password-input.tsx` | 2 | 0 | 0 | 0 | 0 | no | None. |
| `src/components/payments/campaign-payments.tsx` | 11 | 23 | 0 | 0 | 23 | no | Mixed audience by prop. Reads labels from operation-labels, provider-value-labels and DB label_he, all outside this file. Lint hit at line 154 is the card mask, not text. |
| `src/components/places-autocomplete.tsx` | 2 | 1 | 1 | 0 | 0 | no | Default parameter value. "Powered by Google" stays. |
| `src/components/public-token-loading.tsx` | 1 | 0 | 0 | 0 | 0 | no | None. |
| `src/components/time-select-24.tsx` | 2 | 0 | 0 | 0 | 0 | no | 24-hour clock fixed by the component. Lint hits at lines 69 and 84 are the "--" empty option: language-neutral, left as is. |
| `src/components/tiptap-ui-utils/suggestion-menu/suggestion-menu.tsx` | 3 | 1 | 0 | 1 | 0 | no | Three-way count text needs plural options. |
| `src/components/tiptap-ui/mention-dropdown-menu/mention-dropdown-menu.tsx` | 0 | 2 | 0 | 0 | 0 | no | Two default parameter values. |
| `src/components/ui/phone-input.tsx` | 4 | 0 | 0 | 0 | 0 | no | Module-scope COUNTRY_OPTIONS built with Intl.DisplayNames(["he"]) and he sort at import time; dir="rtl" at line 273. Vendored shape. |
| `src/components/ui/sheet.tsx` | 1 | 0 | 0 | 0 | 0 | no | Vendored shadcn primitive; re-adding it from the registry would drop the edit. |
| `src/app/(admin)/admin/agreement/contract-editor-extensions.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: Tiptap node names and HTML tag sets. |
| `src/app/(admin)/admin/rdp-access/requests/progress-dots.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: class names; aria-label arrives as a prop. |
| `src/app/api/admin/fleet-file/route.ts` | 0 | 0 | 0 | 0 | 0 | no | English plain-text refusals (Forbidden, Bad request, Not found, File too large) in a staff file download. Technical; left as is. |
| `src/components/motion/flip-card.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: animation code. |
| `src/components/motion/tilt-card.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: animation code. |
| `src/components/motion/use-media-query.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: media queries. |
| `src/components/reui/event-calendar/event-calendar-event.tsx` | 0 | 0 | 0 | 0 | 0 | no | Vendored ReUI. EVENT_CALENDAR_COLORS names (Blue…) have no consumer outside this file. Labels come through settings.i18n. |
| `src/components/reui/event-calendar/event-calendar-i18n.tsx` | 0 | 0 | 0 | 0 | 0 | no | Vendored ReUI English defaults. The one caller passes CALENDAR_I18N_HE (admin calendar), which overrides every label and view name; viewShortcuts stay English on purpose. The Hebrew lives in calendar-he.ts, admin area. |
| `src/components/reui/event-calendar/event-calendar.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: developer errors and warnOnce only. |
| `src/components/site/cta.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: class builder. |
| `src/components/ui/alert.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: class names. |
| `src/components/ui/badge.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: class names. |
| `src/components/ui/bubble.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: class names. |
| `src/components/ui/button-group.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: class names. |
| `src/components/ui/button.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: class names. |
| `src/components/ui/input-group.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: class names. |
| `src/components/ui/navigation-menu.tsx` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: class names. |
| `src/components/ui/sidebar.tsx` | 0 | 0 | 0 | 5 | 0 | no | English sr-only and tooltip text in a Hebrew UI. Vendored shadcn primitive. |
| `src/lib/auth/staff-table-permissions.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: policy map for a generator. |
| `src/lib/auth/staff-table-rls.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: SQL and pgTAP generator. |
| `src/lib/callbacks/policy-config.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: column lists. |
| `src/lib/cardcom/generated/models/acquire.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated provider enum; display goes through provider-value-labels. |
| `src/lib/cardcom/generated/models/actionCode.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated provider enum; display goes through provider-value-labels. |
| `src/lib/cardcom/generated/models/brand.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated provider enum; display goes through provider-value-labels. |
| `src/lib/cardcom/generated/models/brand2.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated provider enum; display goes through provider-value-labels. |
| `src/lib/cardcom/generated/models/docType.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated provider enum; display goes through provider-value-labels. |
| `src/lib/cardcom/generated/models/extPaymentMethod.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated provider enum; display goes through provider-value-labels. |
| `src/lib/cardcom/generated/models/issuer.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated provider enum; display goes through provider-value-labels. |
| `src/lib/cardcom/generated/models/relations.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated provider enum; display goes through provider-value-labels. |
| `src/lib/data/admin/owner-agent-reports.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: column lists; the one Hebrew line is a comment. |
| `src/lib/data/admin/rdp-access.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: column lists, English thrown errors never shown, machine codes. |
| `src/lib/data/agent-benefits.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: column lists. |
| `src/lib/data/campaign-pricing.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: column lists. |
| `src/lib/data/push-delivery.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: internal error text stored or logged. |
| `src/lib/data/voximplant-reconcile.ts` | 0 | 0 | 0 | 0 | 0 | no | English Slack titles, internal. |
| `src/lib/fleet/ltr-segments.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: text direction helper. |
| `src/lib/ops/app-health.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: column list. |
| `src/lib/owner-agent/consumer/store.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: internal store errors. |
| `src/lib/owner-agent/mcp/names.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: tool names. |
| `src/lib/owner-agent/whatsapp/adapter.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: internal error mapping for a library. |
| `src/lib/queue/pg-error.ts` | 0 | 0 | 0 | 0 | 0 | no | PG_ERROR_MEANING: English, read by pg-boss-alert.ts for an ops alert. The includes() strings match driver messages (logic). Internal. |
| `src/lib/rdp-access/cli/watch-connections.tsx` | 0 | 0 | 0 | 0 | 0 | no | English terminal UI for the owner, run from a shell. Internal. |
| `src/lib/rdp-access/cli/watch-data.ts` | 0 | 0 | 0 | 0 | 0 | no | English terminal UI. Internal. |
| `src/lib/rdp-access/cli/watch-view.tsx` | 0 | 0 | 0 | 0 | 0 | no | English terminal UI (Ink). Internal; the 39 strings the tools see are not a web surface. |
| `src/lib/rdp-access/queries.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: queries, internal errors. |
| `src/lib/rdp-access/rdp-file.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: .rdp file keys. |
| `src/lib/relocation/cli-support.ts` | 0 | 0 | 0 | 0 | 0 | no | English CLI help for the owner. Internal. |
| `src/lib/relocation/nginx.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: nginx config text. |
| `src/lib/sumit/types.generated.ts` | 0 | 0 | 0 | 0 | 0 | no | Generated types. The 26 Hebrew lines are comments (parser found 0 Hebrew literals). |
| `src/lib/validation/agent-console.ts` | 0 | 0 | 0 | 0 | 0 | no | English Zod messages (3). Routes answer with their own generic text and never echo these. Internal. |
| `src/lib/validation/voximplant.ts` | 0 | 0 | 0 | 0 | 0 | no | English Zod messages (3) on scenario callbacks; the 4 Hebrew lines are comments. Internal. |
| `src/lib/voximplant/cli-support.ts` | 0 | 0 | 0 | 0 | 0 | no | English CLI errors, report text and usage for the owner. Internal. All 48 candidate strings reviewed. |
| `src/lib/whatsapp/generated/add-phone-numbers.d.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated types. |
| `src/lib/whatsapp/generated/client-wabas.d.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated types. |
| `src/lib/whatsapp/generated/error-codes.ts` | 0 | 0 | 0 | 0 | 0 | no | Generated English catalog. error-labels.ts reads only range data; visible labels come from src/locales/he/whatsappErrors.json. Not UI. |
| `src/lib/whatsapp/generated/incoming-webhook.d.ts` | 0 | 0 | 0 | 0 | 0 | no | No user-facing text: generated types. |
| `src/whatsapp-error-codes.ts` | 0 | 0 | 0 | 0 | 0 | no | Generated English catalog, no importer found (search on the path, and LSP references of whatsappErrors). Not UI; inferred orphan. |

## Surfaces of shared components

From `find_referencing_symbols`, tests excluded.

| component | used by | namespace |
|---|---|---|
| `SubmitButton` (`forms.tsx`) | admin, customer, public, auth: 57 files | common |
| `Pagination` | 15 admin files, customer guest list | common |
| `PhoneInput` | admin, customer, public | common |
| `SheetContent` (`ui/sheet.tsx`) | admin, customer, public | common |
| `DateSelectIL` | admin filters, customer forms | common |
| `CampaignPayments` | customer campaign page, admin cancellation page | common, staff facts in admin |
| `TimeSelect24`, `PlacesAutocomplete` | customer forms only | customer |
| `PasswordInput` | auth pages only | customer |
| `OrgSwitcher`, `AppShell` | customer shell | customer |
| `HelpTip` | nine admin files | admin |
| `AdminShell`, console panel, availability menu | admin shell | admin |
| `ValuePathControl`, `MentionDropdownMenu`, `SuggestionMenu` | admin templates | admin |
| `GuestShell`, `PublicLoading`, `AddToCalendarIsland` | guest token pages | public |
| `TopicSelect`, `CallbackTimePreference`, `PrivacyNote`, `Honeypot` | `/contact`, `/cb/[token]` | public |
| `LandingHeaderNav`, `LandingMobileNav`, `LandingUserMenu` | public site header | public, plus common nav keys |

## API routes: does the error reach a browser

| route | reaches a browser |
|---|---|
| `/api/call-me-now/request-code` | yes, visitor (`call-me-now-widget.tsx:101`) |
| `/api/calls/[id]/monitor` | yes, staff (`ai-handoff-section.tsx:243`) |
| `/api/console-calls/[id]/consult`, `consult/cancel`, `consult/complete`, `conference` | yes, staff (`call-bar.tsx:208`) |
| `/api/agents/sdk-auth`, `/status`, `/shift`, `/api/calls/[id]/agent-command` | no: the web caller reads the status and shows its own text |
| `/api/agents/telemetry`, `/api/calls/[id]/end`, `conference/remove`, `transfer`, `dial-intent`, `/api/events/[id]/outreach-call`, `/api/campaigns/[id]/status` | no web caller in `src/`. Native agent app only; its source is not in this repo, so what it shows is inferred |
| `/api/widget/sdk-auth` | no caller found in `src/` |
| `/api/campaigns/[id]/purchase`, `purchase/cardcom` | errors are codes (`?error=`, `status`); the page maps them |
| webhooks, voximplant routes | server to server. Hebrew here is Slack or voice |

`auth.error` in the staff routes comes from `requireConsoleAgent` (`src/lib/auth/console-agent.ts`), which is not in this list.

## Non-text items (seen, not fixed)

- Hard-coded `lang`/`dir`: `src/app/layout.tsx:76`, `src/app/global-error.tsx:21`, `src/app/[...catchAll]/route.ts:77`, `src/app/manifest.ts:11-12`.
- Hard-coded `dir="rtl"` on elements: `softphone-panel.tsx:790`, `call-bar.tsx:248`, `help-tip.tsx:29`, `places-autocomplete.tsx:451`, `value-path-control.tsx:128`, `phone-input.tsx:273`.
- `DirectionProvider direction="rtl"`: `layout.tsx:84`, `app-shell.tsx:165`, `admin-shell.tsx:406`, `landing-mobile-nav.tsx:52`, `landing-user-menu.tsx:64`.
- Physical side and icon: `side="right"` in `app-shell.tsx:168`, `admin-shell.tsx:409`, `landing-mobile-nav.tsx:64`; `ArrowLeft` as a forward arrow in `landing-mobile-nav.tsx:116`; `text-right` in `help-tip.tsx:30`.
- Hebrew at import time: `phone-input.tsx:69,80-92` builds `COUNTRY_OPTIONS` with `Intl.DisplayNames(["he"])` and a `he` sort at module load.
- `he-IL` formatters: `formatIsraelDateTime`, `formatIsraelTime`, `formatAmount` in `availability-status.tsx:216,281`, `chat-section.tsx:118`, `softphone-panel.tsx:993`, `campaign-payments.tsx:83-84,149,153`.
- Fixed formats by design: `date-select-il.tsx` (dd/mm/yyyy), `time-select-24.tsx` (24 hours).
- Voice date helpers `formatIsraelSpokenDate`, `formatIsraelSpokenClock`, `formatIsraelRelativeSpokenDate` in the two `ctx` routes must stay on the call language.
- Hebrew-calendar dates: none in these files.
- Text from the database, which `t()` cannot reach: `q.nameHe` (`softphone-panel.tsx:948`), `op.kindLabel` from `payment_operation_kinds.label_he` (`campaign-payments.tsx:144`), `block.label` (`availability-status.tsx:281`).

## Shared mechanisms needed

1. **Language in Route Handlers and Server Actions.** The installed docs say `next/root-params` getters run in Server Components and server-side utilities, "but not in Client Components, Server Actions, or Route Handlers" (`node_modules/next/dist/docs/01-app/02-guides/internationalization.md:252`). So 170 API strings and the Server Action strings need another source: the `Accept-Language` header or a cookie read from the request, or a stable code that the client turns into text. Fixed `he` needs neither, so conversion can land first. The code pattern already exists: `outreach-call` returns `code`, `dial-intent` returns `reason`.
2. **One API error vocabulary.** 48 rows are five strings: `api.errors.invalidBody` 24, `api.errors.bodyTooLarge` 16, `api.errors.rateLimited` 4, `api.errors.invalidOneTimeKey` 2, `api.errors.invalidRequest` 2. They sit in staff and public routes, so `common`.
3. **Typed errors in place of matching Hebrew.** `src/app/api/campaigns/[id]/status/route.ts:58-65` compares `err.message` with Hebrew. The domain must throw a code. `src/lib/data/campaign-transition.ts` and `src/lib/data/event-date.ts` hold the throws. Same family: UI that prints `err.message` from another module (`softphone-panel.tsx:853`, `roster-dial-button.tsx:54`).
4. **Module-scope label tables.** 147 rows are at module scope. Pattern: move the table into the component or a function taking `t`, and keep value-to-label lookup in the table so each key stays a static literal.
5. **Plurals.** Measured on the repo's i18next 26.7.1 with `getT`'s settings (no resources loaded): `t('k', '{{count}} תוצאות', { count })` gives one text for every count, while `defaultValue_zero/_one/_two/_other` options give the right form. Docs: the variable must be named `count`, with no fallback to the base key. `Intl.PluralRules` here returns `one, two, other` for `he`, `one, other` for `en`, `one, many, other` for `fr`. How `extract` writes these options into `he` was not tested, because extract is off limits in this phase.
6. **Rich text.** `Trans` lives in react-i18next, which is not installed. Of three cases here, two are full sentences next to a link and split into two keys (`softphone-panel.tsx:847-849`, `callback-fields.tsx:114-116`). `guest-shell.tsx:39` is a real split: "מנוהל באמצעות {link}". It needs a placeholder that the component replaces with the link. That helper is a proposal, not a documented API.
7. **Default parameters.** `places-autocomplete.tsx:113`, `suggestion-menu.tsx:110-111`, `mention-dropdown-menu.tsx:109-110` set text in the signature, where `t` does not exist. Default to undefined and fall back in the body.
8. **Strings inside HTML.** `[...catchAll]/route.ts` builds HTML by hand and `getT` has `escapeValue: false`, so a translated value must be escaped there.
9. **Locale files.** `src/locales/he` holds only `public.json` and `whatsappErrors.json`; `common`, `customer` and `admin` do not exist yet. `whatsappErrors` is a fifth namespace with its own i18n instance (`src/lib/whatsapp/error-labels.ts`), kept by `preservePatterns` in `i18next.config.ts` and absent from `getT`'s list.
10. **Keys across areas.** `common` keys here (`nav.*`, `actions.close`, `status.loading`, `yesNo.*`, `api.errors.*`) may meet the same text in other areas; merge them when combining maps. `public` already has two copies of the error copy (`error.*` and `site.error.*`); `global-error.tsx` uses `error.*`.

## Owner decisions

- `llms.txt`: keep one bilingual file, or one per language? It also says "אירוע עסקי" and "company events", against private customers only.
- English in the Hebrew UI (`ui/sidebar.tsx` five strings, `suggestion-menu.tsx:110`): keep English as the default, or write Hebrew? Hebrew changes what Hebrew users hear.
- Native agent app: does it show the API `error` text, and in which language should it arrive? Its source is not in this repo.
- Staff surfaces: is `admin` translated at all, or only wrapped? This decides the order of about two thirds of this map (349 of 527 rows to wrap).
- `/api/widget/sdk-auth` has no caller in `src/`: keep the route?
- `src/whatsapp-error-codes.ts` has no importer: keep the file?
- PWA manifest: one name for everyone, or per language?

## Coverage

**76 of 123 files read** line by line, to the last line. **47 files were parsed, not read**, under the lead's quick-decide allowance for files with no Hebrew in code. By the brief's rule ("covered only if you read it") those 47 do not count as read. No assigned file was unreadable.

- Read: every file with Hebrew in code (66), the eight CardCom enums, `site/cta.tsx`, `progress-dots.tsx`.
- Parsed: every string literal in the file was extracted by the AST pass to the last line, then reviewed through a filter that drops class names, column lists and lowercase single tokens, with a separate list of all JSX text and user-facing attributes. Targeted reads on top: `ui/sidebar.tsx`, `event-calendar-i18n.tsx`, `pg-error.ts`, the head of `whatsapp-error-codes.ts`, the colours in `event-calendar-event.tsx`. The largest are generated: `sumit/types.generated.ts` (10,162 lines), `whatsapp/generated/error-codes.ts`, `whatsapp-error-codes.ts`.

Checks run on the output:

- Hebrew in tokens other than strings and JSX text (`out/_tools/hebrew-leaves.cjs`): one regex, now a row; the rest are comments.
- `lint-raw.txt`: all 92 hits on these files reconciled. Seven have no row at their exact line, and each has a reason in that file's risk note (`--` five times, `KALFA`, the card mask).
- Every row was matched back to its source line; schema and enum values validated; every `outbound` row is `keep`.

Parsed files: `src/app/(admin)/admin/agreement/contract-editor-extensions.ts`, `src/app/api/admin/fleet-file/route.ts`, `src/components/motion/flip-card.tsx`, `src/components/motion/tilt-card.tsx`, `src/components/motion/use-media-query.ts`, `src/components/reui/event-calendar/event-calendar-event.tsx`, `src/components/reui/event-calendar/event-calendar-i18n.tsx`, `src/components/reui/event-calendar/event-calendar.tsx`, `src/components/ui/alert.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/bubble.tsx`, `src/components/ui/button-group.tsx`, `src/components/ui/button.tsx`, `src/components/ui/input-group.tsx`, `src/components/ui/navigation-menu.tsx`, `src/components/ui/sidebar.tsx`, `src/lib/auth/staff-table-permissions.ts`, `src/lib/auth/staff-table-rls.ts`, `src/lib/callbacks/policy-config.ts`, `src/lib/data/admin/owner-agent-reports.ts`, `src/lib/data/admin/rdp-access.ts`, `src/lib/data/agent-benefits.ts`, `src/lib/data/campaign-pricing.ts`, `src/lib/data/push-delivery.ts`, `src/lib/data/voximplant-reconcile.ts`, `src/lib/fleet/ltr-segments.ts`, `src/lib/ops/app-health.ts`, `src/lib/owner-agent/consumer/store.ts`, `src/lib/owner-agent/mcp/names.ts`, `src/lib/owner-agent/whatsapp/adapter.ts`, `src/lib/queue/pg-error.ts`, `src/lib/rdp-access/cli/watch-connections.tsx`, `src/lib/rdp-access/cli/watch-data.ts`, `src/lib/rdp-access/cli/watch-view.tsx`, `src/lib/rdp-access/queries.ts`, `src/lib/rdp-access/rdp-file.ts`, `src/lib/relocation/cli-support.ts`, `src/lib/relocation/nginx.ts`, `src/lib/sumit/types.generated.ts`, `src/lib/validation/agent-console.ts`, `src/lib/validation/voximplant.ts`, `src/lib/voximplant/cli-support.ts`, `src/lib/whatsapp/generated/add-phone-numbers.d.ts`, `src/lib/whatsapp/generated/client-wabas.d.ts`, `src/lib/whatsapp/generated/error-codes.ts`, `src/lib/whatsapp/generated/incoming-webhook.d.ts`, `src/whatsapp-error-codes.ts`.

Tools: code was read through Serena. `i18next.config.ts`, `package.json` versions and `src/locales` listing came from Bash `cat`, `grep` and `ls`; a Node one-liner measured plural behaviour; nothing in the repo was changed.

Inferred, not verified: what the native app shows; that `/api/widget/sdk-auth` and `src/whatsapp-error-codes.ts` are unused (search plus LSP only); that `chatAuthorDisplayName` may return Hebrew.
