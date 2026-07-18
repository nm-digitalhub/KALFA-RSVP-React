# Call Flow Patterns — RSVP State Machine

## Canonical state machine

```
DIALING
  ├─ Failed/NoAnswer ──────────────→ REPORT(no_answer) → END
  ├─ AMD: voicemail ───────────────→ VOICEMAIL_MSG → REPORT(voicemail) → END
  └─ Connected
       ↓
GREETING ("היי, {name}?")
  ├─ yes ──────────────────────────→ RSVP_ASK
  ├─ who-is-this ──────────────────→ IDENTIFY → RSVP_ASK
  ├─ wrong person ─────────────────→ APOLOGY → REPORT(wrong_number) → END
  └─ silence ×2 ───────────────────→ REPORT(no_answer) → END

RSVP_ASK ("מגיעים ל...?")
  ├─ yes ──────────────────────────→ GUEST_COUNT
  ├─ no ───────────────────────────→ REGRET → REPORT(declined) → END
  ├─ maybe ────────────────────────→ SOFT_HOLD → REPORT(maybe) → END
  ├─ busy-now ─────────────────────→ WHATSAPP_FALLBACK → REPORT(callback) → END
  ├─ opt-out ──────────────────────→ OPT_OUT_ACK → REPORT(opt_out) → END
  └─ unclear ×2 ───────────────────→ WHATSAPP_FALLBACK → END

GUEST_COUNT ("כמה תהיו?")
  ├─ number ───────────────────────→ CONFIRM → REPORT(confirmed, n) → END
  └─ unclear ×2 ───────────────────→ REPORT(confirmed, count_pending) → END
```

## Timing budget (target: 30–50s total)

| State | Bot speech | Listen window |
|---|---|---|
| GREETING | ≤ 2s | 4s, one retry |
| RSVP_ASK | ≤ 5s | 5s |
| GUEST_COUNT | ≤ 2s | 5s |
| CONFIRM/REGRET | ≤ 3s | — |

Global hard limit: 90s → polite close + WhatsApp fallback. Enforce with a
scenario-level `setTimeout`.

## Non-negotiable rules

1. **2-strike rule**: max 2 failed recognitions per question, then fallback.
   Never loop a third time — that's when people hang up angry.
2. **Barge-in**: start ASR ~1s into TTS playback; on `InterimResult`, stop
   playback immediately.
3. **Every terminal state reports**: no call ends without a webhook to
   kalfa.me. no_answer / voicemail / wrong_number are data too — they drive
   the retry/WhatsApp campaign logic.
4. **Retry policy lives outside the scenario** (in the kalfa.me dispatcher):
   no_answer → retry once after 3h, then WhatsApp. voicemail → WhatsApp
   immediately, no voice retry same day.
5. **Intent detection is keyword-first**: for Hebrew yes/no/count, match
   normalized keywords ("כן", "בטח", "ברור", "מגיעים", "לא", "אולי",
   digits + "שניים/שלושה/ארבעה..."). Only escalate ambiguous text to an LLM
   intent call if keywords fail — latency kills conversations; keep any LLM
   round-trip under 1.5s or skip it.
6. **Silence ≠ no**: silence goes to re-prompt, never to REGRET.
7. **Number words map**: build an explicit Hebrew map (אחד/אחת=1 …
   עשרה/עשר=10, זוג=2, "אני ועוד אחד"=2). ASR often returns digits for
   Hebrew numbers — handle both.

## Result payload (webhook to kalfa.me)

```json
{
  "call_id": "...",
  "guest_id": "...",
  "event_id": "...",
  "outcome": "confirmed|declined|maybe|no_answer|voicemail|wrong_number|opt_out|callback_whatsapp",
  "guest_count": 4,
  "transcript": "...",
  "duration_sec": 41,
  "recording_url": "..."
}
```
