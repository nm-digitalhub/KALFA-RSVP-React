// What a scheduled callback looks like once it reaches the owner's calendar.
//
// The server composes every field here from STRUCTURED database columns. No
// agent, and no caller, ever supplies a finished string — that is the whole
// point of the deterministic gateway (owner ruling 27.07 23:44): an autonomous
// agent may schedule a callback without approval precisely because it cannot
// choose what the appointment says.
//
// Pure: no DB, no Exchange. The DAL supplies the row, this returns the draft.

import type { AppointmentDraft } from '@/lib/exchange-ews/types';

/** Outlook category, so everything this feature writes is filterable there. */
export const CALLBACK_CATEGORY = 'KALFA — שיחת לקוח';

/** Owner decision 28.07. */
export const CALLBACK_REMINDER_MINUTES = 10;

export type CallbackItemInput = {
  fullName: string;
  /** Already normalised to E.164 by the DAL. */
  phone: string;
  /** One of INQUIRY_TOPICS — a closed list, which is why it may go in the subject. */
  topic: string | null;
  /** The caller's own words. Copied from the DB, never from an agent. */
  note: string | null;
  /** Absolute URL of the per-request admin screen. */
  detailUrl: string;
  /** Already formatted for display by the caller (Israel time). */
  createdAtText?: string;
  /** 0 for the first appointment; 1+ after a no-answer retry. */
  attemptCount: number;
  startMs: number;
  endMs: number;
};

/**
 * Strips anything that would break the calendar body or arrive as markup.
 *
 * The note is stored plain and written plain (MessageBody defaults to text), so
 * this is not HTML escaping — it removes control characters, collapses runs of
 * blank lines, and caps the length. Belt-and-braces: the note reaches Exchange
 * from our own database, never from a model, so injection has no path here.
 */
export function sanitizeNote(note: string, maxLength = 600): string {
  const cleaned = note
    // Control characters, except \t and \n which are legitimate in a body.
    // Written as \u escapes: no-control-regex therefore does not fire, and the
    // source file never carries a literal NUL (which some tools truncate at).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}\u2026` : cleaned;
}

/**
 * "שיחה חוזרת — דנה כהן — מכירות", with "[ניסיון 2]" once a first call went
 * unanswered. The name is deliberate (owner decision 28.07): a subject without
 * it makes the lock-screen reminder useless. Sensitivity 'private' below is
 * what keeps that safe if the mailbox is ever shared or delegated.
 */
export function buildCallbackSubject(input: {
  fullName: string;
  topic: string | null;
  attemptCount: number;
}): string {
  const parts = ['שיחה חוזרת', input.fullName.trim()];
  if (input.topic?.trim()) parts.push(input.topic.trim());
  const base = parts.join(' — ');
  // attemptCount 0 = never dialled, 1 = the first call went unanswered, so the
  // NEXT one is attempt 2 — which is the number worth showing.
  return input.attemptCount > 0 ? `${base} [ניסיון ${input.attemptCount + 1}]` : base;
}

/**
 * Escapes a value for interpolation into the HTML body.
 *
 * The note is a CUSTOMER's free text. The moment the body is HTML, an
 * unescaped note is markup the caller controls, landing in the owner's own
 * mailbox. Nothing here is decorative.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Israeli E.164 shown as +972 53-274-3588 — owner's format, 28.07. */
export function formatPhoneForDisplay(e164: string): string {
  const m = /^\+972(\d{1,2})(\d{3})(\d{4})$/.exec(e164.trim());
  return m ? `+972 ${m[1]}-${m[2]}-${m[3]}` : e164;
}

/**
 * The body, as HTML.
 *
 * Every line is `label: value` (owner's format, 28.07). Labels rather than bare
 * values because this is read on a phone in the seconds before dialling: a lone
 * date or a lone number makes the reader work out what it is, and a label costs
 * nothing. One field per line, in the order the reader needs them.
 *
 * HTML, not plain text, for one concrete reason: the number has to be TAPPABLE.
 * In plain text that depends on the calendar client noticing it — measured
 * 28.07, it did not, and the number arrived unusable.
 */
export function buildCallbackBody(input: {
  phone: string;
  detailUrl: string;
  note: string | null;
  topic?: string | null;
  createdAtText?: string;
  attemptCount?: number;
}): string {
  const lines: string[] = [];
  const row = (label: string, value: string) =>
    `<div><b>${escapeHtml(label)}:</b> ${value}</div>`;

  if (input.topic?.trim()) lines.push(row('נושא', escapeHtml(input.topic.trim())));

  const note = input.note ? sanitizeNote(input.note) : '';
  // Newlines become <br> because HTML collapses them — the collapse that
  // flattened the first live item into one run-on paragraph.
  if (note) lines.push(row('הודעה', escapeHtml(note).replace(/\n/g, '<br>')));

  const tel = escapeHtml(input.phone.trim());
  lines.push(
    row(
      'נייד ליצירת קשר',
      `<a href="tel:${tel}">${escapeHtml(formatPhoneForDisplay(input.phone))}</a>`,
    ),
  );

  if (input.createdAtText) lines.push(row('התקבל', escapeHtml(input.createdAtText)));
  // attemptCount 0 = never dialled; "attempt 1" would be noise.
  if (input.attemptCount && input.attemptCount > 0) {
    lines.push(row('ניסיון', String(input.attemptCount + 1)));
  }

  lines.push(`<div><a href="${escapeHtml(input.detailUrl)}">פתיחת הפנייה</a></div>`);

  return `<div dir="rtl">${lines.join('\n')}</div>`;
}

export function buildCallbackDraft(input: CallbackItemInput): AppointmentDraft {
  return {
    subject: buildCallbackSubject(input),
    start: new Date(input.startMs),
    end: new Date(input.endMs),
    body: buildCallbackBody(input),
    // Declared, never inferred: the provider defaults to HTML when the type is
    // left unsaid, which is exactly the bug this replaces.
    bodyIsHtml: true,
    // Blocks the owner's own free/busy, which is what makes the next
    // auto-scheduled callback route around this one.
    showAs: 'busy',
    // Content hidden from anyone the mailbox is ever shared with or delegated
    // to — the mitigation that made the name in the subject acceptable.
    sensitivity: 'private',
    category: CALLBACK_CATEGORY,
    reminderMinutes: CALLBACK_REMINDER_MINUTES,
    // Never any attendees: a non-empty list makes Exchange email real meeting
    // invitations, and the caller must not receive one.
  };
}
