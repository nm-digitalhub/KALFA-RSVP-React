/**
 * kalfa.me — RSVP Confirmation Call Scenario (skeleton)
 * State machine: GREETING → RSVP_ASK → GUEST_COUNT → CONFIRM
 * NOTE: Verify VoiceList / ASRProfileList Hebrew entries against current docs
 *       before deploying (see references/voximplant-api.md).
 */
require(Modules.ASR);
require(Modules.Player);

const CALLER_ID = '<verified_caller_id>';
const KALFA_API = 'https://kalfa.me/api/voice';
const HEBREW_TTS = null;   // TODO: VoiceList.<provider>.<he_IL_voice> — verify
const HEBREW_ASR = null;   // TODO: ASRProfileList.<provider>.<he_IL> — verify

const GLOBAL_LIMIT_MS = 90000;
const LISTEN_MS = 5000;

let call, asr, ctx;
let state = 'INIT';
let strikes = 0;
let result = { outcome: 'no_answer', guest_count: null, transcript: [] };

// ---------- intent helpers ----------
const YES = ['כן', 'בטח', 'ברור', 'מגיעים', 'מגיעה', 'מגיע', 'נגיע', 'כמובן'];
const NO = ['לא נגיע', 'לא נוכל', 'לא מגיעים', 'לא'];
const MAYBE = ['אולי', 'לא יודע', 'לא יודעת', 'עוד לא'];
const OPTOUT = ['תסירו', 'הסירו', 'תפסיקו', 'אל תתקשרו'];
const BUSY = ['אין לי זמן', 'עסוק', 'עסוקה', 'תתקשרו אחר כך', 'לא עכשיו'];
const NUMBERS = { 'אחד': 1, 'אחת': 1, 'שניים': 2, 'שתיים': 2, 'זוג': 2,
  'שלושה': 3, 'שלוש': 3, 'ארבעה': 4, 'ארבע': 4, 'חמישה': 5, 'חמש': 5,
  'שישה': 6, 'שש': 6, 'שבעה': 7, 'שבע': 7, 'שמונה': 8, 'תשעה': 9, 'תשע': 9,
  'עשרה': 10, 'עשר': 10 };

function detectIntent(text) {
  const t = (text || '').trim();
  if (OPTOUT.some(k => t.includes(k))) return 'opt_out';
  if (BUSY.some(k => t.includes(k))) return 'busy';
  if (MAYBE.some(k => t.includes(k))) return 'maybe';
  if (NO.some(k => t.includes(k))) return 'no';
  if (YES.some(k => t.includes(k))) return 'yes';
  return 'unclear';
}

function detectCount(text) {
  const digits = (text || '').match(/\d+/);
  if (digits) return parseInt(digits[0], 10);
  for (const [w, n] of Object.entries(NUMBERS)) if (text.includes(w)) return n;
  if (text.includes('רק אני') || text.includes('לבד')) return 1;
  if (text.includes('אני ועוד')) return 2;
  return null;
}

// ---------- lifecycle ----------
VoxEngine.addEventListener(AppEvents.Started, async () => {
  const data = JSON.parse(VoxEngine.customData()); // { c: call_context_id }
  ctx = await fetchContext(data.c); // guest_name, event_owner, event_type, event_date, ids
  call = VoxEngine.callPSTN(ctx.phone, CALLER_ID);
  call.addEventListener(CallEvents.Connected, () => { armGlobalLimit(); enter('GREETING'); });
  call.addEventListener(CallEvents.Disconnected, finish);
  call.addEventListener(CallEvents.Failed, finish);
});

function armGlobalLimit() {
  setTimeout(() => { sayThenHangup(lines.timeoutClose(), 'callback_whatsapp'); }, GLOBAL_LIMIT_MS);
}

// ---------- states ----------
const lines = {
  greeting: () => `היי, ${ctx.guest_name}?`,
  identify: () => `מתקשרים בשם ${ctx.event_owner} לגבי ${ctx.event_label}. זו ${ctx.guest_name}?`,
  rsvpAsk: () => `מעולה! מתקשרים בשם ${ctx.event_owner} — רצינו לבדוק, מגיעים ${ctx.event_label_with_date}?`,
  rsvpRephrase: () => `רק לוודא — תגיעו לאירוע?`,
  count: () => `איזה כיף! כמה תהיו?`,
  confirm: n => `מעולה, ${n} — רשום! ${ctx.event_owner} מחכים לכם. יום טוב!`,
  regret: () => `חבל, נעדכן את ${ctx.event_owner}. שיהיה יום נעים!`,
  softHold: () => `בסדר גמור. נשלח תזכורת בוואטסאפ בעוד כמה ימים. יום טוב!`,
  whatsappFallback: () => `אין בעיה, נשלח לך הודעת וואטסאפ ואפשר לענות שם. יום נהדר!`,
  optOut: () => `כמובן, הסרנו. סליחה על ההפרעה.`,
  wrongNumber: () => `סליחה על הטעות, יום טוב!`,
  timeoutClose: () => `נשלח לך וואטסאפ להשלמת הפרטים. תודה ויום טוב!`,
};

function enter(next) {
  state = next;
  strikes = 0;
  Logger.write(`[state] ${state}`);
  switch (state) {
    case 'GREETING':    return ask(lines.greeting());
    case 'RSVP_ASK':    return ask(lines.rsvpAsk());
    case 'GUEST_COUNT': return ask(lines.count());
  }
}

function ask(text) {
  say(text);
  // barge-in: start listening ~1s into playback
  setTimeout(listen, 1000);
}

function say(text) {
  result.transcript.push({ bot: text });
  call.say(text, { language: HEBREW_TTS });
}

function listen() {
  asr = VoxEngine.createASR({ profile: HEBREW_ASR, interimResults: true });
  const timeout = setTimeout(() => { asr.stop(); onHeard(''); }, LISTEN_MS);
  asr.addEventListener(ASREvents.InterimResult, () => call.stopPlayback());
  asr.addEventListener(ASREvents.Result, e => {
    clearTimeout(timeout);
    asr.stop();
    onHeard(e.text || '');
  });
  call.sendMediaTo(asr);
}

function onHeard(text) {
  result.transcript.push({ guest: text });
  const intent = detectIntent(text);
  if (intent === 'opt_out') return sayThenHangup(lines.optOut(), 'opt_out');

  switch (state) {
    case 'GREETING':
      if (intent === 'yes') return enter('RSVP_ASK');
      if (text.includes('מי זה') || text.includes('מי מדבר')) return ask(lines.identify());
      if (intent === 'no' || text.includes('טעות')) return sayThenHangup(lines.wrongNumber(), 'wrong_number');
      return retryOr(() => ask(lines.greeting()), 'no_answer');

    case 'RSVP_ASK':
      if (intent === 'yes') return enter('GUEST_COUNT');
      if (intent === 'no') return sayThenHangup(lines.regret(), 'declined');
      if (intent === 'maybe') return sayThenHangup(lines.softHold(), 'maybe');
      if (intent === 'busy') return sayThenHangup(lines.whatsappFallback(), 'callback_whatsapp');
      return retryOr(() => ask(lines.rsvpRephrase()), 'callback_whatsapp');

    case 'GUEST_COUNT': {
      const n = detectCount(text);
      if (n) { result.guest_count = n; return sayThenHangup(lines.confirm(n), 'confirmed'); }
      return retryOr(() => ask(lines.count()), 'confirmed_count_pending');
    }
  }
}

function retryOr(retryFn, fallbackOutcome) {
  strikes++;
  if (strikes < 2) return retryFn();
  sayThenHangup(lines.whatsappFallback(), fallbackOutcome);
}

function sayThenHangup(text, outcome) {
  result.outcome = outcome;
  say(text);
  call.addEventListener(CallEvents.PlaybackFinished, () => call.hangup());
}

// ---------- reporting ----------
async function fetchContext(id) {
  const res = await Net.httpRequestAsync(`${KALFA_API}/context/${id}`);
  return JSON.parse(res.text);
}

async function finish() {
  try {
    await Net.httpRequestAsync(`${KALFA_API}/result`, {
      method: 'POST',
      headers: ['Content-Type: application/json'],
      postData: JSON.stringify({ call_context_id: ctx && ctx.id, ...result }),
    });
  } catch (e) { Logger.write('webhook failed: ' + e); }
  VoxEngine.terminate();
}
