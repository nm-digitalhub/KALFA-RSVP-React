import { describe, expect, it } from 'vitest';

import {
  CALLBACK_CATEGORY,
  CALLBACK_REMINDER_MINUTES,
  buildCallbackBody,
  buildCallbackDraft,
  buildCallbackSubject,
  escapeHtml,
  formatPhoneForDisplay,
  sanitizeNote,
} from './calendar-item';

describe('buildCallbackSubject', () => {
  it('reads name then topic, both scannable at a glance', () => {
    expect(
      buildCallbackSubject({ fullName: 'דנה כהן', topic: 'מכירות', attemptCount: 0 }),
    ).toBe('שיחה חוזרת — דנה כהן — מכירות');
  });

  it('omits the topic rather than leaving a dangling separator', () => {
    expect(buildCallbackSubject({ fullName: 'דנה כהן', topic: null, attemptCount: 0 })).toBe(
      'שיחה חוזרת — דנה כהן',
    );
    expect(buildCallbackSubject({ fullName: 'דנה כהן', topic: '   ', attemptCount: 0 })).toBe(
      'שיחה חוזרת — דנה כהן',
    );
  });

  it('numbers the NEXT attempt, not the ones already made', () => {
    // One unanswered call so far ⇒ the appointment being written is attempt 2.
    expect(buildCallbackSubject({ fullName: 'דנה', topic: null, attemptCount: 1 })).toBe(
      'שיחה חוזרת — דנה [ניסיון 2]',
    );
    expect(buildCallbackSubject({ fullName: 'דנה', topic: null, attemptCount: 3 })).toBe(
      'שיחה חוזרת — דנה [ניסיון 4]',
    );
  });
});

describe('sanitizeNote', () => {
  it('strips control characters but keeps tabs and newlines', () => {
    expect(sanitizeNote('שלום\u0000\u0007עולם')).toBe('שלוםעולם');
    expect(sanitizeNote('שורה\tאחת\nשתיים')).toBe('שורה\tאחת\nשתיים');
  });

  it('normalises CRLF and collapses blank-line runs', () => {
    expect(sanitizeNote('א\r\nב')).toBe('א\nב');
    expect(sanitizeNote('א\n\n\n\n\nב')).toBe('א\n\nב');
  });

  it('caps the length with an ellipsis rather than truncating mid-flow', () => {
    const got = sanitizeNote('א'.repeat(50), 10);
    expect(got).toHaveLength(10);
    expect(got.endsWith('…')).toBe(true);
  });
});

describe('buildCallbackBody', () => {
  const input = { phone: '+972501234567', detailUrl: 'https://x/admin/callbacks/1', note: null };

  it('makes the number a real tel: link — not a string a client might notice', () => {
    // Measured 28.07: a plain-text body arrived with the "+" entity-encoded and
    // no linkification at all, so the number could not be dialled.
    expect(buildCallbackBody(input)).toContain('href="tel:+972501234567"');
  });

  it('puts the number first, because it is the action', () => {
    const firstLink = buildCallbackBody(input).indexOf('href="tel:');
    const secondLink = buildCallbackBody(input).indexOf('href="https://x');
    expect(firstLink).toBeGreaterThan(-1);
    expect(firstLink).toBeLessThan(secondLink);
  });

  it('shows a named link, not a raw UUID', () => {
    const got = buildCallbackBody(input);
    expect(got).toContain('פתיחת הפנייה');
    expect(got).not.toMatch(/>https:\/\//);
  });

  it("labels the caller's own words", () => {
    const got = buildCallbackBody({ ...input, note: 'רוצה הצעת מחיר' });
    expect(got).toContain('הודעה:');
    expect(got).toContain('רוצה הצעת מחיר');
  });

  it('leaves no empty label when there is no note', () => {
    expect(buildCallbackBody(input)).not.toContain('הודעה:');
    expect(buildCallbackBody({ ...input, note: '   ' })).not.toContain('הודעה:');
  });

  it('labels every line, so no value has to be guessed at', () => {
    const got = buildCallbackBody({ ...input, topic: 'מכירות', note: 'שלום', createdAtText: '28.07.2026 בשעה 07:40' });
    for (const label of ['נושא:', 'הודעה:', 'נייד ליצירת קשר:', 'התקבל:']) {
      expect(got).toContain(label);
    }
  });

  it('omits the topic label when there is no topic', () => {
    expect(buildCallbackBody(input)).not.toContain('נושא:');
  });

  it('ESCAPES the note — it is customer-controlled text in the owner\'s mailbox', () => {
    const got = buildCallbackBody({ ...input, note: '<img src=x onerror=alert(1)> & "quoted"' });
    expect(got).not.toContain('<img');
    expect(got).toContain('&lt;img');
    expect(got).toContain('&amp;');
    expect(got).toContain('&quot;');
  });

  it('turns newlines in the note into <br>, since HTML collapses them', () => {
    const got = buildCallbackBody({ ...input, note: 'שורה\nשנייה' });
    expect(got).toContain('שורה<br>שנייה');
  });

  it('adds the arrival time only when it exists', () => {
    expect(buildCallbackBody(input)).not.toContain('התקבל:');
    expect(
      buildCallbackBody({ ...input, createdAtText: '28.07.2026 בשעה 07:40' }),
    ).toContain('התקבל:</b> 28.07.2026 בשעה 07:40');
  });

  it('numbers the NEXT attempt, and says nothing on the first', () => {
    expect(buildCallbackBody({ ...input, attemptCount: 0 })).not.toContain('ניסיון');
    expect(buildCallbackBody({ ...input, attemptCount: 1 })).toContain('ניסיון:</b> 2');
  });

  it('is RTL, so Hebrew and the phone number sit the right way round', () => {
    expect(buildCallbackBody(input)).toContain('dir="rtl"');
  });
});

describe('formatPhoneForDisplay', () => {
  it('groups an Israeli number for the eye while href keeps E.164', () => {
    expect(formatPhoneForDisplay('+972501234567')).toBe('+972 50-123-4567');
  });

  it('leaves anything it does not recognise untouched', () => {
    expect(formatPhoneForDisplay('+14155550123')).toBe('+14155550123');
  });
});

describe('escapeHtml', () => {
  it('covers every character that could open a tag or break an attribute', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('buildCallbackDraft', () => {
  const start = Date.UTC(2026, 6, 28, 11, 0);
  const draft = buildCallbackDraft({
    fullName: 'דנה כהן',
    phone: '+972501234567',
    topic: 'מכירות',
    note: 'רוצה הצעת מחיר',
    detailUrl: 'https://x/admin/callbacks/1',
    attemptCount: 0,
    startMs: start,
    endMs: start + 15 * 60_000,
  });

  it('blocks the owner as busy, so the next auto-schedule routes around it', () => {
    expect(draft.showAs).toBe('busy');
  });

  it('is private — the mitigation that made the name in the subject acceptable', () => {
    expect(draft.sensitivity).toBe('private');
  });

  it('carries the category and the agreed reminder', () => {
    expect(draft.category).toBe(CALLBACK_CATEGORY);
    expect(draft.reminderMinutes).toBe(CALLBACK_REMINDER_MINUTES);
  });

  it('has NO attendees — a non-empty list would email the caller a real invitation', () => {
    expect(draft.attendees).toBeUndefined();
  });

  it('never carries a recurrence', () => {
    expect(draft.recurrence).toBeUndefined();
  });

  it('DECLARES its body as HTML rather than letting the provider guess', () => {
    expect(draft.bodyIsHtml).toBe(true);
  });
});
