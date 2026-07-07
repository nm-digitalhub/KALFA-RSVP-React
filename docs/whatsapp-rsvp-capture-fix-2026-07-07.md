# WhatsApp RSVP capture — button-payload fix + link plan (2026-07-07)

## The problem (proven end-to-end)
A quick-reply template button carries NO payload at Meta (`payload: null` in the
approved template). Unless the payload is injected at SEND time, a tap returns the
Hebrew **label** ("מגיע/ה") as `button.payload`, which `RSVP_BUTTON_MAP`
(rsvp_attending/declined/maybe) misses → `guests.status` never updates. Confirmed
with the Meta template GET, 3 historical taps, and one live controlled tap
(`context.id` = our test wamid → `button.payload:"מגיע/ה"`).

## Fix A — inject the payload (IMPLEMENTED, gates green, NOT deployed)
Single source of truth for the button protocol (`RsvpStatus` from the canonical
`src/lib/constants`); the OUTBOUND payloads and the INBOUND map derive from ONE
ordered list so they can't drift. Data-driven, EVENT-TYPE-scoped flag
(`message_templates.components.rsvp_quick_reply` = {"brit": true}) decides which
(template, event_type) gets the payloads — **brit only**. Empirically verified the
built Cloud API JSON: body + one `{type:"button", sub_type:"quick_reply", index,
parameters:[{type:"payload", payload:"rsvp_*"}]}` per button — index 0→rsvp_attending,
1→rsvp_declined, 2→rsvp_maybe.

Files:
- **NEW** `src/lib/whatsapp/rsvp-buttons.ts` — SSOT (`RSVP_QUICK_REPLY` → payloads + map).
- `src/lib/whatsapp/client.ts` — `rsvpButtonPayloads` param → one `PayloadComponent` each; FAIL-CLOSED (returns unknown, no send) if combined with a URL button — they'd collide in the button-index space.
- `src/lib/data/webhook-processing.ts` — imports `RSVP_BUTTON_MAP` from the SSOT.
- `src/lib/data/message-templates.ts` — `ResolvedTemplate.rsvpQuickReply` from `components.rsvp_quick_reply[eventType]` (event-type-scoped).
- `src/lib/data/outreach.ts` — passes `RSVP_QUICK_REPLY_PAYLOADS` when `template.rsvpQuickReply`.
- `supabase/migrations/20260707160000_rsvp_quick_reply_flag.sql` — sets `rsvp_quick_reply={"brit":true}` on invite/reminder_1/reminder_2/final (NOT gift/call).
- Tests: `rsvp-buttons.test.ts` (new), `client.test.ts` (+2: serialization index→payload, fail-closed), `message-templates.test.ts` (event-type-scoped flag + shape).

Gates: lint · tsc · vitest **1027 passed | 12 skipped** · worker:build · next build. All green.

### To ACTIVATE fix A — ORDER MATTERS (deploy code first, flip the flag LAST)
1. commit + push the code, tests, and migration.
2. Deploy (`npm run deploy`) — kalfa-beta + kalfa-worker — while the flag is still
   OFF (migration NOT yet applied). The live code handles the flag but injects
   nothing (`rsvpQuickReply` false everywhere) → NO behavior change, safe.
3. ONLY AFTER the new code is live, apply the migration: `supabase db push --linked`.
4. **Live re-test THROUGH `sendOneWhatsApp`** (never raw Graph API): trigger a
   single send to the test recipient via the app code path → tap "מגיע/ה" → prove
   `button.payload="rsvp_attending"`, `guests.status='attending'`, and that the
   outbound/inbound interactions link via `context.id`.
5. Scope: the flag is EVENT-TYPE-scoped to 'brit' only — a non-verified variant
   (e.g. wedding) never injects. No full campaign, no J5, no billing, no other guests.

## Fix B — RSVP LINK (prepared, parallel; needs a Meta-approved template)
More robust: a URL button to the existing public RSVP page. The infra already
exists — mirror the gift template exactly:
- **Meta template**: an invite/reminder template with a URL button
  `https://beta.kalfa.me/r/{{1}}` where `{{1}}` = the guest `rsvp_token`
  (dynamic-suffix URL button, same shape as `kalfa_event_gift_v1`'s `/g/{token}`).
  → must be submitted + APPROVED at Meta (the only missing piece).
- **Public page**: `src/app/(public)/r/[token]/page.tsx` — already live (full RSVP
  form: exact headcount, meal prefs, notes; handles multi-guest-per-phone).
- **Wiring**: `client.ts` already supports `urlButtonParam` (URLComponent). The
  engine passes `urlButtonParam: guest.rsvp_token` (mirror of `giftButtonToken` in
  `outreach.ts`). Owner-side link is already generated: `getAppUrl('/r/${token}')`.
- Coexists with Fix A (buttons for this event, link when its template is approved).

## Recommendation for the imminent brit
Ship Fix A now (works with the already-approved `kalfa_brit_invite_trad_v1`, code
only). Submit the Fix B RSVP-link template to Meta in parallel as the robust path
for reminders / future events.
