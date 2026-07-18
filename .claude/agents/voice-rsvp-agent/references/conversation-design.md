# Conversation Design — Hebrew RSVP Calls

## Why people hang up (and the counter-move)

| Hangup trigger | Counter-move |
|---|---|
| Sounds like telemarketing in the first 2 sec | Open with the guest's name + the couple's/host's names — social context, not corporate |
| Long robotic monologue | First utterance ≤ 8 words, then a question |
| Can't interrupt | Barge-in: ASR listens during TTS; stop playback on speech |
| Feels trapped | Offer an exit every branch: "אפשר גם לענות בוואטסאפ" |
| Repeats itself identically | Re-prompts must be *rephrased*, never replayed |

## The 3-second rule
The listener decides in ~3 seconds whether this is spam. The opening line must
contain, in this order: their name → the host's name → the event. Nothing else.

BAD:  "שלום, זוהי שיחה אוטומטית ממערכת קלפא לניהול אירועים בנושא אישור הגעה."
GOOD: "היי {guest_name}? זה בקשר לחתונה של {event_owner}."

## Spoken Hebrew register
- Short verbs, present tense: "מגיעים?", "כמה תהיו?", "רשמתי"
- No formal constructions: never "האם", "בכוונתכם", "נא לאשר"
- Numbers spoken naturally: "ארבעה" not "4 אנשים בסך הכל"
- Confirmations are 2–4 words: "מעולה, ארבעה. רשום."
- One question per turn. Never stack questions.

## Pacing / SSML notes
- 300–400ms pause after the opening question — silence invites an answer
- Slightly rising intonation on questions (mark for ElevenLabs/TTS tuning)
- Total bot speech per turn ≤ 5 seconds

## Full example transcript (wedding)

Variables: {guest_name}=דנה, {event_owner}=נועה ואיתי, {event_date}=חמישי הקרובה

### GREETING + IDENTITY_CONFIRM
BOT: "היי, דנה? [pause 400ms]"
- Guest: "כן" → RSVP_ASK
- Guest: "מי זה?" → BOT: "מתקשרים בשם נועה ואיתי לגבי החתונה ביום חמישי. זו דנה?" → yes → RSVP_ASK
- Guest: "לא / טעות" → BOT: "סליחה על הטעות, יום טוב!" → hangup, mark wrong_number
- Silence 4s → BOT: "הלו, דנה?" → silence again → voicemail check → hangup, mark no_answer

### RSVP_ASK
BOT: "מעולה! מתקשרים בשם נועה ואיתי — רצינו לבדוק, מגיעים לחתונה ביום חמישי?"
- "כן / בטח / ברור" → GUEST_COUNT
- "לא / לא נוכל" → REGRET
- "עוד לא יודעת / אולי" → SOFT_HOLD
- "אין לי זמן עכשיו" → BOT: "אין בעיה, נשלח לך הודעת וואטסאפ ותוכלי לענות מתי שנוח. יום נהדר!" → mark callback_whatsapp
- "תסירו אותי" → BOT: "כמובן, הסרנו. סליחה על ההפרעה." → mark opt_out
- Unclear ×1 → rephrase: "רק לוודא — תגיעו לאירוע?"
- Unclear ×2 → WhatsApp fallback line → hangup

### GUEST_COUNT
BOT: "איזה כיף! כמה תהיו?"
- Number → CONFIRM
- "רק אני" → count=1 → CONFIRM
- "אני ועוד אחד" → count=2 → CONFIRM
- Unclear ×2 → BOT: "נרשום אותך בינתיים ותוכלי לעדכן מספר בוואטסאפ. נתראה בחתונה!" → mark confirmed_count_pending

### CONFIRM
BOT: "מעולה, {count} — רשום! נועה ואיתי מחכים לכם. יום טוב!"
→ hangup, mark confirmed

### REGRET
BOT: "חבל, נעדכן את נועה ואיתי. שיהיה יום נעים!"
→ hangup, mark declined
(No guilt-tripping, no "בטוח?" — respect the answer.)

### SOFT_HOLD
BOT: "בסדר גמור. נשלח תזכורת בוואטסאפ בעוד כמה ימים, טוב?"
→ hangup, mark maybe + schedule reminder

### VOICEMAIL (AMD detected)
"היי דנה, מתקשרים בשם נועה ואיתי לגבי החתונה ביום חמישי. נשלח לך וואטסאפ לאישור הגעה. תודה!"
→ mark voicemail + trigger WhatsApp

## Re-prompt bank (rotate, never repeat verbatim)
1. "סליחה, לא שמעתי טוב — מגיעים?"
2. "רק לוודא — תגיעו לאירוע?"

## Event-type variants
Replace "החתונה" per event type: בר המצווה / בת המצווה / הברית / החינה /
יום ההולדת. The {event_owner} phrasing changes: for bar mitzvah use the
parents' names — "בשם משפחת {family}".
