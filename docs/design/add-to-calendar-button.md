# "הוספה ליומן" — the guest add-to-calendar control

> Scope: the one shared control on the gift card back face (`/g/[token]`) and the RSVP success box
> (`/r/[token]`, after a guest confirms attendance), plus the two token-gated ICS routes it links to.
> Rewritten 2026-09-08 after the owner's iPhone tests of v1 (the library's own menu): rows opened web pages,
> the sheet was a bare white page. **v3 (same day, owner-approved 5-point plan, after a live P0):** the generators
> are now `calendar-link` (web links) and `ics` (the file); `add-to-calendar-button` has **zero imports** in src/. **MEASURED** = read in code (`node_modules/add-to-calendar-button/dist/…`,
> Chromium's intent handler docs, Android's `Intent.java` / `CalendarContract.java`, Microsoft Q&A) or
> observed in the headless harness; **INFERRED** = what an OS/app does after the hand-off — the device
> checklist in §8 confirms it.

## 1. Architecture (v2)

| Layer | File | Role |
| --- | --- | --- |
| Domain (server) | `src/lib/calendar/event-calendar.ts` | `buildCalendarEvent(event)` — pure build (sanitized single-line title/location, absolute instants, 3h end, Israel calendar day, filename); `buildCalendarLinks(build)` — Google / Outlook.com / Microsoft 365 via **`calendar-link`** (`google` / `outlook` / `office365`, the pre-pivot call shape); `renderIcs(build, uidSeed?)` — RFC 5545 via **`ics@3.12`** (`createEvent`, UTC instants, `VALUE=DATE` for all-day, `productId kalfa.me`, `STATUS:CONFIRMED`, busy). All pure and synchronous: no module state, so concurrent renders/route hits cannot interfere. **P0 that forced this (2026-09-08 14:58–15:00, a live wedding page 500'd ×12):** v2 used `add-to-calendar-button`'s undocumented `sink` mode, whose single module-level result channel fails under concurrency (2 of 4 concurrent calls fail in Node — MEASURED by the team lead; our per-bundle promise queue could not fix it because Next bundles our module per route while the library's channel is shared). |
| Domain (client-safe) | `src/lib/calendar/platform.ts` | `detectCalendarPlatform(ua)` — the library's own iOS / Android / WebView regexes; `googleCalendarAndroidIntent(webUrl)` — Chrome's documented `intent:` wrapper with `S.browser_fallback_url`. |
| HTTP | `src/lib/calendar/ics-response.ts` | `icsResponse(ics, name)` — `text/calendar; charset=utf-8`, **`Content-Disposition: inline`** (+ RFC 5987 Hebrew filename), `no-store`, `nosniff`, `noindex`, `no-referrer`. |
| Routes | `src/app/(public)/g/[token]/event.ics/route.ts`, `src/app/(public)/r/[token]/event.ics/route.ts` | Token-gated ICS (§7). |
| Component (server) | `src/components/add-to-calendar.tsx` | `<AddToCalendar event icsHref variant? />` — Server Component: build → links → island props (hrefs only). **Never-fail boundary** (`safeCalendarLinks`): any generator error → `console.warn` (message only, no token/guest data) and the page renders WITHOUT the menu; the payment CTA / RSVP form never depend on it. |
| Component (client) | `src/components/add-to-calendar-island.tsx` | KALFA's own button + menu (Base UI Dialog, portaled, RTL via the root `DirectionProvider`): bottom sheet under `sm`, 360px card above; rows are plain `<a>`s chosen per platform (§3). |
| Call sites | `g/[token]/gift-landing.tsx` (`variant="outline"`, `icsHref="/g/<token>/event.ics"`), `r/[token]/page.tsx` → `rsvp-form.tsx` `calendar` prop (`icsHref="/r/<token>/event.ics"`) | Same event fields the pages already render. |
| Tests | `src/lib/calendar/*.test.ts`, `src/components/add-to-calendar.test.ts`, `…/event.ics/ics-route.test.ts` ×2 | Config/TZ/all-day, generated URL + ICS shapes, platform detection, intent syntax, response headers, server render, route tripwires (fingerprint keys, event-only fields). |

Time zones (v3): Google links and the ICS carry the absolute instant in UTC (`…Z`), so every calendar shows
Israel time to a guest in Israel and the correct local time abroad. **Outlook.com / Microsoft 365 links from
`calendar-link` carry a ZONELESS local wall clock (`startdt=2026-07-12T20:30:00`, its `dateTimeLocal` format,
MEASURED in dist/index.js)** — "local" = the Node process TZ, which the pm2 ecosystem pins to `Asia/Jerusalem`
(and vitest pins the same), so guests in Israel get the right time; a guest whose Outlook is set to another zone
gets the Israel wall time in their zone (INFERRED). This is calendar-link's behaviour, accepted by the plan;
`add-to-calendar-button` emitted `Z` instants there. ICS text: title/location are folded to one line (`[\r\n]+` →
space, control chars stripped) before generation; `ics` additionally escapes `\`, `,`, `;` — a title containing
"\nURL:https://evil…" cannot inject a property (tested). UID = `sha256("kalfa-calendar:" + event id)[0..32]@kalfa.me`
— stable per event (re-import updates), opaque, never the token or the raw id.

What v1 was and why it went: the library's web component + SSR shell + its modal list. Its rows are hard-wired to
the generators (web URLs; Apple/iCal = `download` anchor or a clipboard modal), it cannot carry an https ICS
link without `download`, and no per-row href override exists — so the owner's goal ("open the app / the
Calendar preview, not a web page or a download") was unreachable inside it. The 60.6 KB gz client runtime, the
42 KB SSR shell and the `::part()` sheet styling are gone. `add-to-calendar-button` is imported nowhere in `src/`
(grep-verified) — it stays in package.json only until the owner decides to uninstall it (package.json untouched).

## 2. What the guest sees

One button **"הוספה ליומן"** (calendar-plus icon + label; solid indigo on `/r`, indigo outline on the gift card —
§11). Tap → a menu titled "הוספה ליומן" with a 44px close control; under 640px a bottom sheet (top radius
`rounded-t-2xl`, safe-area padding, 220 ms rise, motion-safe), from `sm` a centred 360px card. Each row is 56px
with a leading icon, the calendar name and a one-line hint saying what will happen — the surprise the owner hit
("it opened a web page") is now stated up front.

| Platform (`detectCalendarPlatform`, MEASURED regexes) | Rows, in order |
| --- | --- |
| iPhone / iPad (`iPad|iPhone|iPod`; iPadOS "desktop mode" reports a Mac UA → desktop rows) | **יומן Apple** "נפתח ביומן של האייפון" · יומן Google "נפתח בדפדפן" · Outlook.com · Microsoft 365 (+ a hint line inside WKWebViews, §3) |
| Android (Chrome, Samsung Internet, WhatsApp/Chrome Custom Tab) | **יומן Google** "נפתח באפליקציה (או בדפדפן אם אינה מותקנת)" · **יומן אחר (Samsung ועוד)** "הורדת קובץ יומן ופתיחה באפליקציה" · Outlook.com · Microsoft 365 |
| Android `wv` WebView (Instagram/Facebook in-app) | same, but יומן Google is the plain web URL (intents are not reliable in WebViews) |
| Desktop | יומן Google · Outlook.com · Microsoft 365 · **קובץ יומן (Apple, Outlook ועוד)** "הורדת קובץ .ics" |

## 3. Platform × service matrix — BEFORE (v1, library menu) → AFTER (v2)

**M** = MEASURED (code/docs/harness), **I** = INFERRED (device checklist §8).

| Service | iPhone Safari (and in-app browsers with Safari's UA: SFSafariViewController) | iPhone WKWebView (UA without "Safari": Chrome/Firefox for iOS, Instagram/FB, WhatsApp if WKWebView-based) | Android Chrome / Samsung Internet / WhatsApp Custom Tab | Android `wv` WebView | Desktop |
| --- | --- | --- | --- | --- | --- |
| **Apple Calendar / ICS** | BEFORE: `blob:` anchor + `download` → download sheet / Files (owner: "looks like a download"). AFTER (M): plain `<a href="/g/<token>/event.ics">`, same tab, no `download`; the route answers inline `text/calendar` (M). (I): Safari opens the Calendar preview ("Add All"). | BEFORE: clipboard-copy modal "פתח את ספארי". AFTER (M): same link + an in-menu hint that in-app browsers may not open it and to use Safari. (I): WKWebView cannot render text/calendar; behaviour depends on the host app — the hint is the honest fallback; no scheme can force Safari. | BEFORE: `data:` anchor + `download`. AFTER (M): https anchor + `download="<name>.ics"` → download manager notification. (I): "Open" → Samsung Calendar / Google Calendar import. | AFTER (M): same download anchor (Instagram's WebView lost the library's guidance modal; downloads in WebViews depend on the host app — I). | AFTER (M): https anchor + `download` → `.ics` file. (I): macOS Calendar, Outlook desktop, Thunderbird by file association. |
| **Google Calendar** | BEFORE = AFTER (M): `calendar.google.com/calendar/render?action=TEMPLATE&…&ctz=Asia/Jerusalem`, new tab. Web editor. **No documented iOS scheme or universal link exists for a pre-filled event** (Google community thread 167086239: `googlecalendar://` only opens the app, no parameters) — none is shipped; the hint says "נפתח בדפדפן". | Same (M). | BEFORE (library) = AFTER (ours, M): `intent://calendar.google.com/…#Intent;scheme=https;package=com.google.android.calendar;S.browser_fallback_url=<web>;end` — Chrome launches the **Google Calendar app** pre-filled; without the app Chrome navigates to the fallback (documented: developer.chrome.com/docs/android/intents — user gesture required, BROWSABLE activity, fallback stripped before delivery). | AFTER (M): plain web URL, new tab (intents are not handled in `wv` WebViews). | AFTER (M): TEMPLATE URL in a new tab (v1 used the desktop `r/eventedit` variant; both are Google's web editor). |
| **Outlook.com / Microsoft 365** | BEFORE = AFTER (M): `outlook.live.com` / `outlook.office.com` `/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&startdt=…Z&enddt=…Z&subject=…&location=…`, new tab. **`ms-outlook://events/new` is NOT shipped**: no Microsoft documentation exists (Q&A 202137 — moderator "know little about scheme"; a reporter saw the app open with EMPTY fields; Tech Community 242742 — Microsoft: "No plans to support these deep links, only regular hyperlinks"), and iOS has no OS-mediated fallback for a custom scheme (Safari's "invalid address" alert when the app is missing). (I): whether the Outlook app claims the https deep link as a universal link depends on Microsoft — the owner saw the web page, so assume web. | Same (M). | Same URL (M). An `intent:` with `package=com.microsoft.office.outlook` would give an OS fallback but needs the undocumented scheme — rejected. | Same (M). | Same (M). |

What a web page cannot force on iOS: launching a third-party app with data unless that app documents a scheme
(Microsoft/Google do not) or claims the URL as a universal link (their choice, not ours); opening Safari from
inside another app's WebView; a Calendar *event* (not subscription) from a WebView — `webcal://` is the only
scheme that reaches Calendar from anywhere and it creates a **subscribed calendar**, which is why v1's design-B
evaluation rejected it (a one-off event is not a subscription).

## 4. Event configuration (server, `buildCalendarEvent`)

| Field | Source | Notes |
| --- | --- | --- |
| `name` | `eventHeadingFor(type, celebrants, name).title` | The page's own title ("החתונה של דנה ויוסי"). |
| `startDate` / `startTime` | `israelCalendarDay(ms)` / `formatIsraelTime(ms)` | Israel wall clock through `src/lib/date.ts` + `event-date.ts` (never `slice(0,10)`). |
| `endDate` / `endTime` | start + **3h** (`DEFAULT_DURATION_HOURS`) | No duration column; documented guess; crosses midnight correctly. |
| all-day | `ilTimeInputValue(event_date) === ''` (legacy date-only value) | No times → all-day (Google `dates=YYYYMMDD/YYYYMMDD+1`, ICS `VALUE=DATE`). |
| `timeZone` | `Asia/Jerusalem` | Google gets `ctz=`, Microsoft gets UTC `Z` instants, ICS gets a `VTIMEZONE` — all by the library. |
| `location` | `venue_name, venue_address` | Omitted when empty. |
| `iCalFileName` | `icsFileName(title)` | Path/quote/control chars stripped, whitespace → `-`, ≤60, Hebrew kept; the route adds an ASCII fallback name. |

Only those fields exist in the config (pinned by a test); the island receives **hrefs only** — the title and
venue reach the browser solely inside the generated URLs (also pinned by a test).

## 5. Menu design (island)

- Button: `primary` = the gift CTA classes (bg-primary, primary-tinted shadow, hover lift); `outline` = `border-primary
  text-primary bg-transparent hover:bg-primary/10` (§11 contrast figures). 48px, `focus-visible:outline-ring`.
- Popup: Base UI `Dialog` (`ui/dialog.tsx` wrappers + `Dialog.Popup`/`Close`/`Trigger` from `@base-ui/react/dialog`),
  portaled to `<body>` — outside the FlipCard's `overflow-hidden` + 3D transform, and outside the `inert` hidden face.
  Sheet: `inset-x-0 bottom-0 rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]`; card: `sm:inset-0 sm:m-auto
  sm:h-fit sm:max-w-[22.5rem] sm:rounded-2xl` (auto margins, no transforms); enter/exit `translate-y-6` + opacity,
  200 ms `ease-k-out`, `motion-reduce:transition-none`. Overlay = the app's `DialogOverlay` (bg-black/10 + blur).
- Rows: `<ul class="divide-y divide-border">` of `<a>` 56px, leading lucide icon in `text-primary` (`CalendarPlus`
  Apple, `Smartphone` app intent, `ExternalLink` web, `Download` file), label + hint, hover `bg-muted`, focus ring
  inset. New-tab rows carry `target="_blank" rel="noopener noreferrer"`; intent/ICS rows navigate in place.
- Close: 44px circle, `text-muted-foreground` on `bg-muted`, `aria-label="סגירה"`; `DialogTitle` "הוספה ליומן",
  sr-only description. Esc / backdrop close (Base UI).
- Platform is read from `navigator.userAgent` after hydration (`useSyncExternalStore`, memoised snapshot; server
  snapshot = desktop) — the rows exist only while the dialog is open, so server HTML never depends on it.
- No-JS: the button needs the island; `<noscript>` renders a plain Google link. On `/g` the back face itself is
  hidden without JS (motion spec §9), so this only matters where the control is on a visible surface.

## 6. Bundle and payload (MEASURED after the build — see the report for the numbers)

Client: the island + Base UI Dialog (already in the app's client bundle) replace v1's lazy 60.6 KB gz runtime +
1.3 KB locale and the 42 KB (9 KB gz) SSR shell in the HTML/RSC payload. Server: `calendar-link` (+ dayjs) and `ics`
in the server bundle only.

## 7. The ICS routes — security shape (for review)

- Paths: `/g/[token]/event.ics`, `/r/[token]/event.ics`. Same token spaces as the pages: the 32-hex gift token
  (`TOKEN_RE`, then `getGiftByToken` — active event with an https payment link only) and the guest's RSVP token
  (`looksLikeRsvpToken`, now exported from `src/lib/data/rsvp.ts` and shared with the page, then
  `get_rsvp_by_token`, exact-value RPC, no listing). Every failure → bare `404`; over-rate → `429`.
- Rate limit, two buckets each: per token-fingerprint + IP (`gift:ics:<fp>:<ip>` 30/min; `rsvp:ics:<fp>:<ip>`
  `RSVP_READ_RATE`) and per IP alone (`gift:ics:ip:<ip>`, `rsvp:ics:ip:<ip>`, 30/min = the `/go` limit) — token
  fingerprint, never the raw token (tripwire tests). Both routes `export const dynamic = 'force-dynamic'`.
- Failure handling: `/r` wraps `getRsvpByToken` (which throws on an RPC error) → generic 404; both routes wrap ICS
  generation → generic 404 + redacted `console.error`. No path returns a 500 or a detail.
- Capability: strictly less than the pages — the file contains title, date/time, venue. No guest name/phone/status/
  answers, no payment URL, no owner identity, no token (the ICS is identical for every guest of the event). `UID`
  is a random uuid per response (library).
- Headers: `text/calendar; charset=utf-8`, `Content-Disposition: inline; filename="…"; filename*=UTF-8''…`,
  `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex, nofollow`,
  `Referrer-Policy: no-referrer` — also enforced by the `/g/:token*` and `/r/:token*` header rules in next.config.
- Generation: the `ics` package (no hand-rolled RFC 5545), pure and synchronous; UID = one-way hash of the internal
  event id (`calendarUid`), identical for every guest of the event.
- Enumeration: unchanged — same tokens, same shape guards, same generic responses as `/g/[token]`, `/g/[token]/go`,
  `/r/[token]`.

## 8. Device checklist for the owner (cannot be proven from code)

1. **iPhone Safari** (`/g` and `/r` after confirming): tap → bottom sheet in Hebrew, RTL, close visible; **יומן Apple** →
   Calendar preview with "הוסף הכול"/"Add All" (not a download sheet); event at the right Israel time. **יומן Google** /
   **Outlook.com** → web editors pre-filled (expected; no app scheme exists).
2. **iPhone WhatsApp in-app browser**: same sheet; יומן Apple → note what happens (preview / nothing / "open in Safari");
   the hint line under the rows should be visible only if WhatsApp's browser reports a WKWebView UA.
3. **Android Chrome**: יומן Google → the Google Calendar **app** opens pre-filled; uninstall test (or a phone without it)
   → the web editor via the fallback. יומן אחר → download notification → "Open" → Samsung Calendar / calendar chooser.
4. **Android WhatsApp** (Chrome Custom Tab): same as Chrome. **Samsung Internet**: same; the Google row is the intent too.
5. **Desktop**: centred card; Google/Outlook rows open new tabs; קובץ יומן downloads `<title>.ics`; Esc closes; Tab
   cycles rows → close; the FlipCard's back-face button is unreachable before the flip and works after it.

## 9. Research record (primary sources, 2026-09-08)

- Chrome intents: developer.chrome.com/docs/android/intents — `intent:HOST/URI-path#Intent;package=…;scheme=…;S.browser_fallback_url=…;end`,
  fallback when unresolvable, requires user gesture, no launch from redirects/iframes, only BROWSABLE activities.
- Android `Intent.java` (`toUri`/`parseUri`): extras typed `S.`/`B.`/`l.`/`i.`…; `CalendarContract.java`:
  `EXTRA_EVENT_BEGIN_TIME="beginTime"`, `EXTRA_EVENT_END_TIME="endTime"`, `EXTRA_EVENT_ALL_DAY="allDay"`,
  `Events.TITLE="title"`, `EVENT_LOCATION="eventLocation"`, `AUTHORITY="com.android.calendar"`; intents-common
  documents `ACTION_INSERT` on `content://com.android.calendar/events`. **Not shipped**: Chromium blocks/limits
  `intent:` launches whose data is a `content://` URI and calendar INSERT activities are not documented as BROWSABLE
  (INFERRED) — the ICS download is the safe "any calendar" path; revisit on a device if desired.
- Microsoft: Q&A 202137 (no docs, fields reported empty on mobile), Tech Community 242742 ("No plans to support these
  deep links"); Outlook REST/Graph docs contain no URL-scheme reference.
- Google: community thread 167086239 (no parameters via scheme); no developer documentation for a Calendar iOS scheme.
- Apple: support.apple.com/guide/iphone/use-multiple-calendars-iph3d1110d4 ("subscribe … by tapping a link"),
  community reports of the "add events (all or none)" screen for `.ics` URLs; iOS hands `text/calendar` to Calendar,
  `application/octet-stream` does not work (addcal.co/text-2-ics guides).

## 10. Limitations

- Google/Outlook on iOS stay web editors; Outlook stays web everywhere — vendor limitations, not ours.
- The ICS row inside an iOS WKWebView depends on the host app; the menu says so.
- The end time is a 3h guess (no duration field).
- The Android Google row is an `intent:` URL: a `wv` WebView gets the web URL instead; Chrome refuses intents without a
  user gesture (a real tap is one).
- Outlook links carry zoneless Israel wall-clock times (calendar-link); correct for Israeli guests, shifted for a
  guest whose Outlook zone differs. The ICS has no `VTIMEZONE` (the `ics` package emits UTC) — clients convert.
- Tests pin the URL and ICS shapes so a `calendar-link` / `ics` upgrade that changes them fails loudly.

## 11. Visual hierarchy: why the button is an outline on `/g` and solid on `/r` (decision 2026-09-08)

The button's weight is a **page** decision made through the `variant` prop (`'primary' | 'outline'`), which selects
one of two Tailwind class sets on KALFA's own button (`BUTTON_VARIANT` in add-to-calendar-island.tsx) and nothing else. Measured on the live beta gift page
of a real wedding at 390×844 and 1440×900 (headless Chromium, read-only; screenshots in the session scratchpad).

**`/g/[token]` → `outline`.** The page exists to collect a gift: its one primary action is "שליחת מתנה ב־Bit"
below the card. Before this change the back face carried a second solid-indigo 188×49 button ("הוספה ליומן")
24px above a solid-indigo 199×48 CTA — same fill, same text colour (`#fafafa` on `#4f39f6`, 6.17:1), same weight,
same width — two equal primaries, with the non-revenue one higher on the screen and reached first by the
auto-flip. The outline treatment keeps the calendar button clearly tappable (48px, 1px border, same geometry)
but subordinate, and pairs it with the Waze link beside it (both plain indigo on the wash). It stays inside
DESIGN.md's colour law (indigo only on interactive elements, no new hue) and reuses the app's existing
primary-vs-outline pairing rather than inventing a third look.

Contrast, computed from the OKLCH tokens (WCAG 2.x relative luminance; wash sampled at the button's measured
position, t≈0.64 of the wedding gradient rose-100 → amber-50, `#fff3e9`):

| Pair | Ratio | Requirement |
| --- | --- | --- |
| indigo text/border on the wash at the button | **5.89:1** | text 4.5 · UI boundary 3.0 |
| indigo on the darkest end of every event-type wash (rose/pink/orange/sky/violet/amber/indigo-100) | **5.23–5.79:1** | 4.5 / 3.0 |
| solid variant, `primary-foreground` on `primary` (unchanged, `/r`) | 6.17:1 | 4.5 |
| rejected: neutral outline (`bg-background` + `border-border`) — hairline `#e5e5e5` vs the wash | 1.15:1 (fill 1.09:1) | 3.0 — **fails**; on the tinted wash the white pill would be defined by nothing |

**`/r/[token]` → `primary` (unchanged).** In the success box the guest has just confirmed; adding the event is
the natural next step, there is no payment action in that box, and the box itself (`border-primary/30
bg-primary/5`) frames the button. Demoting it there would hand the visual lead to the still-visible
"שליחת אישור" submit button below the box — the wrong action after success (see the open note below).

Follow-up (same day, team-lead approved): items (3) and (4) below were fixed in `gift-landing.tsx` — the meta lines on the
wash (front: subtitle, date, venue; back: date) are `text-foreground/70`, which measures **6.92–7.27:1** on the darkest edge of
all seven event-type washes (was `text-muted-foreground`, 3.84–4.25:1; the greeting keeps `/80`); and the invitation image
is capped at `max-h-[max(10rem,calc(100svh_-_30rem))]` — the small viewport minus the rest of the first screen (card
offset + banner + toggle row + gap + CTA, MEASURED ≈ 30rem on a 2-line title / 2-line venue event), floor 10rem — so the
payment CTA sits inside the first viewport on 667px phones (CTA bottom 663 of 667 on both faces, was 703; simulated on the
live page with the exact emitted CSS, 375×667 and 390×844) and for portrait invitations on 844px phones. A `45svh` cap would
not have helped: this event's landscape invitation is only 227px tall at 375px wide, the overflow came from the banner stack.

Follow-up 2 (owner's iPhone Safari recording over 4G, same day): (A) the 1.4s auto-flip fired before the invitation image
had painted, so the guest saw only the tinted placeholder and then the back — `FlipCard` now takes
`autoFlipAwaitsFrontImage` (the gift page passes it when an invitation exists): the flip waits for the front `<img>`'s
load event and dwells 2.5s on the picture (`autoFlipDwellMs`); a failed image falls back to the 1.4s timer counted from
mount, a still-pending image is never flipped away; no-image events, reduced motion (no auto-flip), interaction-cancels and
the SSR contract are unchanged (`src/components/motion/auto-flip.ts` + `auto-flip.test.ts`). (B) the heading broke inside a
name ("החתונה של אייל / מלכה ושלומית קאקון") — `eventHeadingSegmentsFor` (celebrant-display.ts) splits the same title into
segments and the gift page renders each multi-word name (≤24 chars) in a `whitespace-nowrap` span on both faces; the plain
string is untouched for the sr-only h1, calendar titles, ICS and Exchange. Simulated on the live page at 390px with the exact
emitted DOM: lines before "החתונה של אייל" / "מלכה ושלומית קאקון", after "החתונה של" / "אייל מלכה ושלומית קאקון", each name
in one rect. `/r` and `/ty` still render the plain title and can adopt the same segments (owner decision).

Still open for the owner: (1) after a successful submit the form's solid "שליחת אישור" button stays directly under the
success box, so `/r` still shows two solid primaries (three when the gift card is present) — proposal: demote it to an
outline "עדכון התשובה" once `state.notice` is set; (2) the back face has no venue line (front shows name + address, back
shows only the Waze link) — proposal: repeat `venue_name` under the date; (5) the FlipCard toggles keep their neutral
look (front: outline on white; back: `text-muted-foreground`, 4.50:1 at the light end of the wash). `/ty` renders the
same wash with `text-muted-foreground` lines and was not touched.
