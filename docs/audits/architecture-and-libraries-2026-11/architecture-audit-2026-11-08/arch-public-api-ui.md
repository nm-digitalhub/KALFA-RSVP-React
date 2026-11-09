Audit report for the public, API and UI slice. Labels: **[M]** means I read the lines; **[I]** means I deduced it. All line numbers are 1-based.

## (a) Module map
- **`(public)/(site)/*`**: marketing and legal pages that compose content with data. `_legal.tsx` is the shared legal shell. `contact/` has a page, Server Actions and the client forms. `event-type-page.tsx` is the shared layout for the four event-type pages. [M/I]
- **`(public)/r|g|ty|cb|join|rate/[token]`**: guest token surfaces. Each `page.tsx` rate-limits, looks up `@/lib/data/*`, and renders a client form or landing. Each `actions.ts` uses next-safe-action plus a domain call. `event.ics` and `g/go` are Route Handlers. [M]
- **`api/voximplant/*`**: endpoints the Voximplant scenarios call:
  - `ctx` and `cb` routes, protected by a token in the path
  - `agent-tool`, `mtg/tool` and `sls/tool` agent tools
  - `console/*`, protected by a shared secret [M]
- **`api/console-calls/*` and `api/calls/*`**: staff live-call commands, authorized by `requireConsoleAgent` plus `manage_voice`. [M]
- **`api/agents/*`**: console-agent presence, shift and history. [M/I]
- **`api/webhooks/*` and `api/cardcom/*`**: provider webhooks that persist first and process later. [M]
- **Other `api/*`**: `campaigns/*` (payment and run state), `call-me-now/*` and `widget/*` (public call-in), `internal/rdp-gateway/*`, `mcp/*` (owner MCP), `hermes/teams` (proxy to localhost), `health`. [M/I]
- **`components/console/*`**: browser softphone (SDK, presence, roster, chat, AI handoff). [M]
- **`components/admin-shell.tsx` and `app-shell.tsx`**: navigation shells. **`availability/*`**: presence menu plus thin actions. **`site/*`**: marketing chrome. **`consent/*`**: cookies and GA. **`motion/*`**: animation islands. [M/I]
- **`components/tiptap*`, `jsonforms`, `hooks/use-menu-navigation`**: editor UI (one hook is vendored, MIT). [I]
- **Root files**: `proxy.ts` (thin, delegates) [M]; `instrumentation.ts` (error capture plus startup check) [M].

## (b) Mixed-concern files
**Client components that query Supabase directly**
- `softphone-panel.tsx`: UI plus 5 browser-client queries (`:303 agent_status`, `:312 console_agents_roster`, `:480 console_calls`, `:515 console_event_guests` including name, RSVP and phone, `:562 console_chat_messages`). It also makes 3 Bearer fetches (`:421`, `:654`, `:682`), runs realtime and polling, and manages the SDK lifecycle. [M] Whether the guest-card read breaks the "no privileged data from browser" rule depends on the view's own gate. [I]
- `ai-handoff-section.tsx:199`: browser-side UPDATE on `console_call_feed`, plus reads at `:112`/`:138` and fetches at `:235`/`:263`. [M]
- `chat-section.tsx:77`: browser INSERT. [M]
- `call-bar.tsx`: reads at `:144`, fetch at `:200`. [M]

**Route Handlers doing domain work**
- `webhooks/whatsapp/route.ts:95-266`: three normalizers that turn Meta payloads into inbox rows. [M]
- `voximplant/console/event/route.ts:110-295`: a 16-case event → `console_calls` state-transition switch. [M]
- `voximplant/ctx/[token]/route.ts:42-135`: speech-form and ASR-keyword transforms. [M]
- `sls/tool/signup-link/[token]/route.ts:111-225`: WhatsApp-then-SMS delivery cascade, failure classification and outcome claim. [M]
- `call-me-now/verify/route.ts:120-246`: 7-step admission flow; builds the scenario payload at `:230`. [M]
- `console/route-inbound/route.ts:111-316`: admission sequencing, throttled alerts at `:187-215`, fraud refusal at `:271`. [M]
- `events/[eventId]/outreach-call/route.ts:88-116`: three service-role queries, plus job build and enqueue at `:145-185`. [M]

**Direct DB calls in routes, actions and instrumentation**
- `agents/shift:76-94` (upsert plus admin `activity_log` insert), `agents/status:48-55`, `campaigns/[id]/status:88-92`, `purchase/settle:46-62`, `g/[token]/go:29-35`, `instrumentation.ts:186-197`. [M]

**Server Components in `src/components` that load data**
- `site-header.tsx:29-32` (`getUser`, `getProfile`) and `event-type-page.tsx:53-57`. [M]

**Smaller**
- `call-me-now-widget.tsx:35-43`: inline fetch helper. [M]
- `places-autocomplete.tsx:194-264`: Google Places client inside the combobox. [M]
- `cb/[token]/page.tsx:145-246`: two decorative components inside the page, with hex colors and physical `-left`/`-right`/`mr-1` classes. [M]

**Security one-liners** (seen in passing, not hunted)
- `r/[token]/actions.ts:92-108`: after `submitRsvp`, a second service-role `guests` update keyed on `rsvp_token` runs outside the RPC. This conflicts with "RSVP updates atomic". [M]
- `voximplant/ctx/[token]:168`: the local terminal-status list omits `'handed_off'`, while `lib/data/call-attempts.ts:40` includes it. A ctx fetch for a handed-off attempt is therefore not refused. [M] The impact is [I].
- `chat-section:77` (`author_id`) and `ai-handoff:199` (`agent_id`) take identity from browser state. Enforcement rests on RLS, which I did not read. [I]

## (c) Large files (>~400 lines)
- **`console/softphone-panel.tsx`, 1054 lines** [M]
  - gate props and label maps
  - SDK connect and auto-connect
  - presence read/write and heartbeat (`:410-455`)
  - roster
  - active call and guest card (`:473-539`)
  - chat state and realtime (`:556-602`)
  - shift toggle
  - full panel UI
- **`(site)/page.tsx`, 678 lines** [M]
  - 7 copy-data factories
  - Eyebrow component
  - auth-aware CTAs (`:185`, `:543`, `:664`)
  - company read plus Organization/WebSite/SoftwareApplication JSON-LD (`:193-271`)
  - 8 inline sections, including a ~140-line sample-dashboard mock
- **`admin-shell.tsx`, 581 lines** [M]
  - `NAV_GROUPS` config with permissions (`:130-221`)
  - visibility filter
  - count badges
  - sidebar, account menu, logout
  - softphone mount
- **`places-autocomplete.tsx`, 508 lines** [M]
  - Places data access and session tokens
  - debounce
  - keyboard combobox
  - portal positioning
  - fallback input
- **`r/[token]/rsvp-form.tsx`, 462 lines** [M]
  - Stepper
  - status, counts, meal, custom questions, note
  - success region
  - attendees list
  - gift CTA
- **`webhooks/whatsapp/route.ts`, 452 lines** [M]
  - 3 normalizers
  - signature check
  - Slack alerting
  - owner-agent diversion
  - GET verify challenge
  - POST
- **`console/call-bar.tsx`, 445 lines** [M]
  - SDK call-state UI and DTMF
  - its own `console_calls` query
  - consult/conference picker and commands
- **Near the threshold**: `route-inbound` 388, `ai-handoff-section` 374. [M]

## (d) Duplication
1. **Console-call command skeleton ×6** (`consult`, `consult/cancel`, `consult/complete`, `conference`, `conference/remove`, `transfer`). Each runs auth → uuid check → body cap → `getConsoleCallById` → kind and status guard → `pickSessionUrl` → envelope → `postCommandToSession` → audit → 202. Example pair: `consult:67-154` vs `conference:60-140`. The three `calls/*` routes repeat the attempt variant (`end:48-90`, `agent-command:54-113`, `monitor:48-112`). [M]
   - The transfer-target error-message map is verbatim ×3: `consult:112-117`, `conference:100-105`, `transfer:100-105`. The external-number map appears ×2: `consult:124-129`, `conference:112-117`. [M]
2. **Request preamble** [M]
   - `content-length` check in 17 files; `Buffer.byteLength(raw)` in 21.
   - `KALFA_CONSOLE_SECRET` comparison ×7 (`route-inbound:105-109` ≡ `event:70-74`).
   - Local helpers: `json()` ×29, `NO_STORE` ×53, `bad()` ×18.
   - `cardcom/webhook:39-45` ≡ `document-webhook:38-44`.
3. **Voximplant tool and cb routes** [M]
   - Parse → schema → process → `{ok}`: `mtg/tool/confirm:38-55` ≈ `sls/tool/note:36-53`.
   - Inbox-row persistence ×5: `mtg/tool/dnc:56-68`, `sls/tool/dnc:51-63`, `cb:149-163`, `agent-tool/rsvp:85-99`, `agent-tool/note:61-73`.
   - `type WebhookInboxInsert` is redeclared in 5 routes, while the WhatsApp route imports it from lib (`:16`).
   - `mtg/cb:59-75` ≈ `sls/cb:63-79`.
   - `claimSalesOutcome` → `applyCallOutcome` ×2 at `sls/cb:83-86` and `signup-link:216-219`; a grep hit at `log-outcome:62` [I].
4. **Hand-rolled token guard**: `cb/[token]:53-80` re-implements the guard that `agent-tool/*` gets from `guardAgentToolRequest`. [M]
5. **ctx route skeleton ×3**: `ctx:143-164`, `mtg/ctx:60-84`, `sls/ctx:35-53` [M]
   - company read with try/catch ×2: `mtg/ctx:131-138`, `sls/ctx:72-80`
   - correlation-key pair ×3
   - drift: `mtg/ctx:125-126` filters placeholder names, `sls/ctx:67` does not. Whether sls can actually receive placeholders is [I].
6. **Call-me-now caps**: `call-me-now-authorize:155-163` does the cap arithmetic inline, while `verify:183-191` calls `evaluateCallMeNowCaps`. [M]
7. **Browser console code** [M]
   - `bearerToken()` ×2: `call-bar:87-91`, `ai-handoff:86-90`.
   - The same session → Bearer `fetch` runs inline in the softphone (`:418`, `:651`, `:679`).
   - Realtime-plus-polling block ×6 (softphone effects `293-373`, `473-539`, `556-602`; `call-bar:132-182`; `ai-handoff:157-189`).
   - "My live call" query ×2: `softphone:480`, `call-bar:144`.
   - Calendar labels: `softphone:169-174` ≈ `availability-status:52-57`.
8. **Guest token pages** [M]
   - `g/[token]/page.tsx:27-97` ≈ `ty/[token]/page.tsx:27-97`; `r/[token]/page.tsx:37-87` shares the same blocks.
   - `r/event.ics:31-71` ≈ `g/event.ics:32-67`.
   - The 32-hex token regex appears ×5 as constants plus 2 inline (`mtg/ctx:70`, `sls/ctx:41`).
9. **Server Actions** [M]
   - Token rate-limit middleware ×3: `r/actions:35-49`, `rate/actions:26-39`, `cb/actions:47-57`.
   - `trimmedOrUndefined` ×2.
   - `contact/actions:76-113` ≈ `:115-152`.
10. **Shells** [M]
    - `app-shell:75-120` ≈ `admin-shell:244-328` (`isActive`, mobile trigger, logout).
    - The account identity block appears ×4 across the two files.
11. **Marketing pages** [M]
    - Auth-aware CTA ×6.
    - Eyebrow: `page:159-176` ≈ `event-type-page:30-39`.
    - The home page escapes its JSON-LD inline (`:286`); the sibling pages use `jsonLdScript`/`faqJsonLdScript`.
12. **Webhook normalization placement**: WhatsApp keeps it inline; Microsoft Graph (`:60`) and cardcom-document (`:46`) call lib functions. [M] `[...catchAll]` restates the `not-found.tsx` copy, per its own comment at `:26-29`. [I]

## (e) Coverage
- **Read in full:** 77 of 194 in-scope TS/TSX files, 13.9k of 24.8k lines. The 6 console-call routes were read with comment-only lines filtered out; for `dial-intent` and `call-me-now-authorize` I read lines 41 onward only.
- **Partial:** `[...catchAll]` (lines 1-75 and 159-184), `event-type-page` (1-95), and the JSON-LD regions of the about, faq, guest-list-template and whatsapp pages.
- **Symbols, headers or grep only (so [I]), about 117 files:**
  - `api/agents/{call-history,callbacks,sdk-auth,telemetry,transfer-targets}`
  - `call-me-now/request-code`, `campaigns/purchase` plus `cardcom`, `whatsapp-send`
  - `elevenlabs/*`, `console/{authorize,widget-authorize,route-inbound-retry}`, `account-callback`
  - the remaining `mtg/tool` and `sls/tool` routes, `widget/*`, `admin/*`, `mcp/{auth,tools}`
  - `llms.txt`, the CSV route
  - the remaining marketing and token pages and forms
  - `consent/*`, `motion/*`, `tiptap*`, `jsonforms`, `add-to-calendar*`, `forms*`, `landing-*`, smaller widgets, the remaining hooks
  - `i18n.*`, `not-found`, `global-error`, `robots`, `sitemap`, `manifest`
- I ran no `find_referencing_symbols`, so this report claims nothing is unused.