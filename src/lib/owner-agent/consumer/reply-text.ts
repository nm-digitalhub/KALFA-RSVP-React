import { formatIsraelDateTime, formatIsraelWeekday } from '@/lib/date';

// The words of the owner agent's WhatsApp side: the system prompt, the prompt
// wrapper, the one fixed failure reply, and the split into WhatsApp-sized
// messages. Kept apart from the handler so the Hebrew is in one place.

// Replaces Claude Code's default system prompt (runner.ts `--system-prompt`).
// ⚠️ NO DATE OR OTHER CHANGING VALUE HERE. A resumed session replays the
// system prompt it recorded first (`--system-prompt-snapshot`, on by default in
// 2.1.281), so anything that changes belongs in the prompt (buildOwnerPrompt).
export const OWNER_AGENT_SYSTEM_PROMPT = [
  'אתה עוזר הנתונים העסקיים של KALFA, ועונה לבעלים בוואטסאפ.',
  '- ענה רק על סמך תוצאות הכלים שקיבלת. לעולם אל תמציא מספר ואל תשער.',
  '- ספירות וסכומים בלבד: בלי שמות של אנשים, אירועים או לקוחות, בלי טלפונים ובלי תוכן של הודעות.',
  '- ענה בעברית, בקצרה: כמה שורות, בלי כותרות ובלי טבלאות.',
  '- אם אין כלי שעונה על השאלה, או שמספר לא זמין, אמור זאת במפורש.',
  '- התאריך והשעה בישראל כתובים בתחילת כל הודעה. "היום", "השבוע" ו"החודש" נמדדים מהם.',
].join('\n');

/** The fixed reply for a run that failed. Never an error text, a code or a provider name. */
export const OWNER_AGENT_FAILURE_REPLY = 'לא הצלחתי לענות כרגע. נסה שוב בעוד רגע.';

/** The prompt for one question: Israel's date and time now, then the question as written. */
export function buildOwnerPrompt(question: string, nowMs: number): string {
  return `עכשיו יום ${formatIsraelWeekday(nowMs)}, ${formatIsraelDateTime(nowMs)} (שעון ישראל).\n\nשאלת הבעלים:\n${question}`;
}

// WhatsApp's limit on a text body is 4096 characters. Counted here in UTF-16
// units (String length), which is never less than the number of characters, so
// a part is never over the limit whatever Meta counts in — and a part is never
// cut inside a surrogate pair.
export const WHATSAPP_TEXT_LIMIT = 4096;
// An answer longer than this many messages is cut: the agent is asked for a
// few lines, and a runaway answer should not become a wall of messages.
export const MAX_REPLY_PARTS = 3;
const ELLIPSIS = '…';

// The last index at which `text` may be cut so the part stays within `limit`:
// prefer a line break, then a space, in the last quarter of the window; never
// inside a surrogate pair.
function cutPoint(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const floor = Math.floor(limit * 0.75);
  for (const sep of ['\n', ' ']) {
    const at = text.lastIndexOf(sep, limit - 1);
    if (at >= floor) return at + 1;
  }
  let at = limit;
  const code = text.charCodeAt(at - 1);
  if (code >= 0xd800 && code <= 0xdbff) at -= 1; // a high surrogate: keep the pair together
  return at;
}

/** The messages to send for `text`: at most MAX_REPLY_PARTS, each within the WhatsApp limit. */
export function splitForWhatsApp(
  text: string,
  limit: number = WHATSAPP_TEXT_LIMIT,
  maxParts: number = MAX_REPLY_PARTS,
): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > 0 && parts.length < maxParts) {
    const last = parts.length === maxParts - 1;
    if (last && rest.length > limit) {
      const at = cutPoint(rest, limit - ELLIPSIS.length);
      parts.push(`${rest.slice(0, at).trimEnd()}${ELLIPSIS}`);
      break;
    }
    const at = cutPoint(rest, limit);
    const part = rest.slice(0, at).trimEnd();
    if (part.length > 0) parts.push(part);
    rest = rest.slice(at).trimStart();
  }
  return parts;
}
