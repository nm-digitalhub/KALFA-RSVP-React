# Verified documentation sources — per domain (kalfa.me)

Compiled 2026-07-18 from live-fetch verification. Status tags: **FETCHED** (content
verified by direct fetch on that date), **SEARCH-ONLY** (URL found via search,
content not independently fetched), **BLOCKED** (site rejects automated access —
use the access techniques below). Re-verify anything critical before relying on it;
these URLs are pointers, not snapshots.

## Access techniques (when a source is BLOCKED)

- **Wayback bypass** (works for kolzchut.org.il, israelhayom.co.il, and most
  WAF-403 sites): `curl "http://archive.org/wayback/available?url=<URL>"` → fetch
  the returned snapshot URL with curl. Check the snapshot date before trusting it.
- **nevo.co.il law pages** (`/law_html/...`) are directly WebFetch-able. Nevo
  *case-law* pages (`/psika_html/...`) are login-gated — use secondary summaries
  (isoc.org.il spam verdicts, law-firm digests) or a paid database.
- **JS-rendered SPA portals** (voximplant.com/docs, SUMIT Swagger) don't render in
  WebFetch — use their llms.txt/markdown endpoints where available, GitHub READMEs,
  or a real browser session from the MAIN session (subagents cannot drive Chrome).
- **exm.co.il (ExtrA SMS)**: blocks everything (403). No public docs exist; the
  repo's validated integration (`src/lib/sms/sender.ts` + memory `extra-sms-api`)
  is the only reference.

## Supabase — STRONG (all official)

- SSR auth for Next.js: https://supabase.com/docs/guides/auth/server-side/nextjs
  — FETCHED 2026-07-18. `getClaims()` is now the recommended identity check over
  `getSession()`; Server Components can't write cookies (proxy pattern).
- SSR client creation: https://supabase.com/docs/guides/auth/server-side/creating-a-client — SEARCH-ONLY
- RLS: https://supabase.com/docs/guides/database/postgres/row-level-security — SEARCH-ONLY.
  SELECT policy is required for UPDATE to apply; index policy columns.
- Functions/SECURITY DEFINER: https://supabase.com/docs/guides/database/functions — SEARCH-ONLY.
  Always `set search_path = ''` + fully-qualify objects in SECDEF functions.
- CLI: https://supabase.com/docs/reference/cli/supabase-migration-new ·
  https://supabase.com/docs/reference/cli/supabase-gen-types-typescript — SEARCH-ONLY.
- Management API: https://supabase.com/docs/reference/api/introduction — SEARCH-ONLY.
- Live-schema introspection in THIS repo: `supabase db query --linked` runs as
  postgres (can exec SECDEF); use pg_catalog (pg_constraint/pg_indexes), NOT
  information_schema, for constraints (returns empty for real FKs here).

## Meta WhatsApp Cloud API — STRONG for templates/webhooks, stitched elsewhere

- Template categorization: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
  — FETCHED 2026-07-18. Utility = non-promotional AND user-specific/safety-critical;
  mixed/unclear → Marketing. Since Apr 2025: category-abuse reclassification is
  IMMEDIATE (no 24h warning).
- Messages reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/ — SEARCH-ONLY
- Webhooks: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
  — SEARCH-ONLY. 3MB payload cap; retries up to 7 days on non-200; mTLS supported.
- MM Lite / Marketing Messages API: https://developers.facebook.com/docs/whatsapp/marketing-messages-lite-api/
  — FETCHED 2026-07-18. Meta does NOT document 131049 bypass; our live testing
  proved MM Lite does NOT bypass 131049 (memory `mm-lite-marketing-routing-workstream`).
- Error codes: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
  — SEARCH-ONLY; Meta keeps these vague. Live-verified here: 131049 = marketing
  frequency-cap drop (needs open 24h session), 131026 = recipient not on WhatsApp.
- Resumable upload (media template headers): `POST /{APP_ID}/uploads` — split across
  docs; live-verified in memory `whatsapp-media-template-submission`.

## Voximplant — official but portal not fetch-readable

- Markdown endpoints (WORK in fetch): https://docs.voximplant.ai/llms.txt ·
  https://docs.voximplant.ai/platform/voxengine/llms.txt (append `.md` to pages) ·
  https://docs.voximplant.ai/api-reference/voxengine
- Signature oracle: https://cdn.voximplant.com/voxengine_typings/voxengine.d.ts
  (download as file).
- voxengine-ci: https://github.com/voximplant/voxengine-ci — README renders fine.
- The 4 existing voice agents own this domain; their live-verified facts
  (SSML read literally by he-IL TTS, 200-byte customData cap) override docs.

## SUMIT (OfficeGuy) — WEAK public docs; repo knowledge is authoritative

- Swagger: https://app.sumit.co.il/help/developers/swagger/index.html — BLOCKED (JS).
- Payments JS API (Hebrew): https://help.sumit.co.il/he/articles/5893615-payments-javascript-api — SEARCH-ONLY
- Redirect/IFrame: https://app.sumit.co.il/help/developers/redirectapi/ — SEARCH-ONLY
- **Authoritative for real behavior**: memory `sumit-charge-verified-behavior` +
  `src/lib/sumit/*` — J5 hold is NOT re-queryable (Payment.ID:0); final charge =
  FRESH token charge (not capture), OMIT VATRate+AuthNumber; decline signaled by
  ValidPayment; only `getforcustomer` lookup works.

## Next.js 16.2.9 — LOCAL DOCS ARE THE SOURCE OF TRUTH

- `node_modules/next/dist/docs/` (01-app, 02-pages, 03-architecture) — per
  AGENTS.md this build has breaking changes vs. public docs and training data.
  Cross-check any nextjs.org advice against the local docs before applying.
- nextjs.org pages (route handlers, mutating data, serverActions config) — SEARCH-ONLY,
  secondary to local docs.

## Base UI / shadcn / Tailwind v4 — STRONG

- DirectionProvider: https://base-ui.com/react/utils/direction-provider — FETCHED
  2026-07-18. It does NOT set the `dir` attribute/CSS — set `dir="rtl"` yourself;
  provider affects Base UI behavior only (needed for portaled components).
- shadcn CLI: https://ui.shadcn.com/docs/cli · components.json:
  https://ui.shadcn.com/docs/components-json · registry: https://ui.shadcn.com/docs/registry — SEARCH-ONLY
- Tailwind v4 (CSS-based config, `@theme`): https://tailwindcss.com/docs/installation/using-postcss ·
  https://tailwindcss.com/blog/tailwindcss-v4 — SEARCH-ONLY
- Repo gotchas (live-verified, override docs): memories `base-ui-rtl-direction-provider`,
  `base-ui-collapsible-render-gotcha`, `sidebar-inset-rtl-overflow`,
  `shadcn-cli-add-primitives` (always `npx shadcn@latest add`, never hand-roll).

## pg-boss — STRONG

- https://timgit.github.io/pg-boss/ — FETCHED 2026-07-18 at v12.26.1 (installed
  ^12.21.2). API: https://timgit.github.io/pg-boss/api/jobs — SEARCH-ONLY.
- Repo gotcha: worker MUST use the session pooler host (IPv4) — memory
  `worker-db-session-pooler`.

## Web Push / PWA — STRONG

- MDN Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API — SEARCH-ONLY
- VAPID: RFC 8292 https://datatracker.ietf.org/doc/html/rfc8292 — SEARCH-ONLY
- web-push lib: https://github.com/web-push-libs/web-push — SEARCH-ONLY (matches ^3.6.7)

## Zod 4 / Vitest 4

- Zod: https://zod.dev/api — FETCHED 2026-07-18. `z.uuid()` enforces RFC 9562
  variant bits — use real v4 UUID fixtures in tests, never all-1s.
- Vitest: https://vitest.dev/guide/ · https://vitest.dev/blog/vitest-4 — SEARCH-ONLY.
- Playwright: NOT a dependency of this repo (tests are vitest only).

## Israeli law / regulation

→ See `legal-catalog-israel.md` (same directory) — full verified catalog with
Nevo (binding text), Kol Zchut (plain-language, via Wayback), case law, and the
declared attorney-questions list.

## Israeli tax (מע"מ, מס הכנסה, ביטוח לאומי, פנסיה)

→ See `tax-catalog-israel.md` (same directory) — verified tax catalog for the
owner's עוסק-פטור business, with the open CPA-questions (שאלות רו"ח) list.
Access findings (verified 2026-07-18):
- **Nevo statute pages fetch LIVE via curl** (browser UA; content is UTF-8
  despite no declared charset — strip tags with python). The annually-indexed
  amounts appear INSIDE the statute text (e.g. חוק מע"מ §1 carries the current
  עוסק-פטור ceiling) — this makes Nevo the live PRIMARY for figures, not just
  wording. חוק מע"מ: `law_html/law00/72813.htm` · תקנות מע"מ:
  `law_html/Law01/271_005.htm` · פקודת מס הכנסה (נוסח משולב מלא — the
  `law01/255_001*.htm` parts are partial/redirect): `law_html/law00/84255.htm` ·
  הוראות ניהול פנקסים: `law_html/law01/255_179.htm`.
- kolzchut.org.il, gov.il, greeninvoice.co.il: WAF-403 from this server even
  with browser UA. WebFetch cannot reach web.archive.org, but **curl can** —
  Wayback via curl is the LAST resort (check + state the snapshot date).
  Preferred fallback: WebSearch cross-checked against ≥2 current-year sources,
  or a real browser from the MAIN session with user approval.
- btl.gov.il: alive to curl (302 homepage); deep pages vary — test per page.
