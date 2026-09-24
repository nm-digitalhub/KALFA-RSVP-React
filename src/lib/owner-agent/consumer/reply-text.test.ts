import { describe, expect, it } from 'vitest';

import {
  MAX_REPLY_PARTS,
  OWNER_AGENT_FAILURE_REPLY,
  OWNER_AGENT_SYSTEM_PROMPT,
  WHATSAPP_TEXT_LIMIT,
  buildOwnerPrompt,
  splitForWhatsApp,
} from './reply-text';

// Emoji are two UTF-16 units: the limit is counted in units, and a part must
// never end on half a pair. Built from a code point, not typed.
const EMOJI = String.fromCodePoint(0x1f389);

describe('splitForWhatsApp', () => {
  it('a short answer is one message, trimmed', () => {
    expect(splitForWhatsApp('  יש 12 אירועים.\n')).toEqual(['יש 12 אירועים.']);
  });

  it('nothing but whitespace is no message at all', () => {
    expect(splitForWhatsApp(' \n\t ')).toEqual([]);
  });

  it('exactly the limit is one message; one more is two', () => {
    expect(splitForWhatsApp('א'.repeat(WHATSAPP_TEXT_LIMIT))).toHaveLength(1);
    expect(splitForWhatsApp('א'.repeat(WHATSAPP_TEXT_LIMIT + 1))).toHaveLength(2);
  });

  it('prefers a line break, then a space, near the end of the window', () => {
    const text = `${'א'.repeat(4000)}\n${'ב'.repeat(50)} ${'ג'.repeat(200)}`;
    const parts = splitForWhatsApp(text);
    expect(parts[0]).toBe('א'.repeat(4000));
    expect(parts[1]).toBe(`${'ב'.repeat(50)} ${'ג'.repeat(200)}`);

    const spaced = `${'א'.repeat(4050)} ${'ב'.repeat(100)}`;
    expect(splitForWhatsApp(spaced)).toEqual(['א'.repeat(4050), 'ב'.repeat(100)]);
  });

  it('never cuts inside a surrogate pair, and no part exceeds the limit in UTF-16 units', () => {
    const text = EMOJI.repeat(3000); // 6000 units, no spaces
    const parts = splitForWhatsApp(text);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(WHATSAPP_TEXT_LIMIT);
      expect([...p].every((ch) => ch === EMOJI)).toBe(true);
    }
    expect(parts.join('')).toBe(text);
  });

  it(`at most ${MAX_REPLY_PARTS} messages; a runaway answer is cut and marked`, () => {
    const parts = splitForWhatsApp('א'.repeat(WHATSAPP_TEXT_LIMIT * (MAX_REPLY_PARTS + 1)));
    expect(parts).toHaveLength(MAX_REPLY_PARTS);
    expect(parts[MAX_REPLY_PARTS - 1].endsWith('…')).toBe(true);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(WHATSAPP_TEXT_LIMIT);
  });
});

describe('the words', () => {
  it('the prompt carries Israel date and time and the question as written', () => {
    const prompt = buildOwnerPrompt('כמה פניות?', Date.parse('2026-01-15T22:05:00Z')); // 00:05 on the 16th, IST
    expect(prompt).toContain('16.01.2026, 00:05');
    expect(prompt).toContain('שעון ישראל');
    expect(prompt.endsWith('כמה פניות?')).toBe(true);
  });

  it('the system prompt changes with nothing (it is frozen on resume)', () => {
    // Fixed numbers (LIMIT 50, the first 30) are rules; a date or a time of
    // day would be a changing value.
    expect(OWNER_AGENT_SYSTEM_PROMPT).not.toMatch(/\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d\d-\d\d|\d{1,2}:\d\d/);
    expect(OWNER_AGENT_SYSTEM_PROMPT).toMatch(/אל תמציא/);
  });

  it('the failure reply is Hebrew and says nothing about why', () => {
    expect(OWNER_AGENT_FAILURE_REPLY).not.toMatch(/[A-Za-z0-9_]/);
    expect(OWNER_AGENT_FAILURE_REPLY.length).toBeGreaterThan(10);
  });
});
