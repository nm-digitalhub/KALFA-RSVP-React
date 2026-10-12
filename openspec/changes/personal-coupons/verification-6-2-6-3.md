# 6.2 + 6.3 — verified by two real production calls (12.10.2026)

Both tasks required a real, transcribed test call. Two calls on the deployed stack
(claude-sonnet-5-5 agent version agtvrsn_3301m4r9…, bridge scenario with the body.ok
contract, the rewritten tool definitions and prompt) provided both sides of the flow.
Each call was verified against the ElevenLabs transcript+tool log AND an independent
Scribe transcription of the actual call audio (the agent's own transcript hides bugs).

## Call 1 — the no-offer path (conv_2001m4rd6h0df97tfg2smat5pdp7, 18:55, 114s)

- Explicit price objection → `apply_discount_tier` with the caller's words →
  `{offer:null, options:[]}` (the configured objections did not match) → the agent
  said plainly there is no benefit, kept the list price, and NEVER invented a
  discount. A second objection did not produce a second promise.
- `schedule_callback` for "תשע בערב" → `2026-10-12T18:00:00Z` (21:00 Israel, correct
  DST) → server booked it (`{ok:true}` → `noted`); `log_outcome` → `recorded`.
- All 8 evaluation criteria passed. Audio: tags unspoken, prices in words.

## Call 2 — the full benefit path (conv_3901m4rycw69fffsc7dae4q2kftt, 23:55, 262s)

- "המחיר מעט יקר לי" → the server chose "לקוחות מצטרפים" and the tool answered
  `offer` + options (100→90, 200→180) + `expires_at`; assignment 35b4bd60 written
  BEFORE the promise. The agent quoted ONLY the returned final price, said the
  choice happens at signup on the site, and that the benefit waits for the phone
  it was called on. A further "עדיין קצת יקר" got the same 90 — no invented tier.
- The legal disclosure was spoken IN FULL (audio-verified word for word): the
  benefit-aware price line ("וכך יופיע גם בהסכם"), no setup fees / no
  pay-per-result, one charge at the site after approving the agreement, and the
  14-day cancellation right. The outdated disclosure PROCEDURE did not fire; the
  price-objection procedure fired before the tool, correctly.
- Explicit WhatsApp consent question → `update_state {wa_consent:true}` →
  `send_signup_link {wa_consent:true}` → `{accepted:true}` → "שלחתי לך קישור"
  (channel-neutral, no false close); no `log_outcome` after success (the server
  records completed). The customer then actually registered.
- All 8 evaluation criteria passed. Sonnet 5.5 turn latency covered by buffer
  speech; audio tags silent.

Redemption-side follow-through the same night: phone verification of the CALLED
number on an account revealed the benefit on package choice (owner-confirmed:
"אימתתי את המספר, ההטבה מופיעה").
