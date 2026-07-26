import { describe, expect, it } from 'vitest';

import {
  redactPii,
  renderExamplesMarkdown,
  summarizeMetric,
  toRedactedExample,
  trigramDice,
  type RedactedExample,
} from './corrections';

describe('redactPii', () => {
  const pii = { name: 'דנה כהן', email: 'dana@example.com', phone: '+972501234567' };

  it('masks the submitter name, email and phone (case-insensitive)', () => {
    const out = redactPii('שלום, אני דנה כהן, dana@example.com, 0501234567', pii);
    expect(out).not.toContain('דנה כהן');
    expect(out).not.toContain('dana@example.com');
    expect(out).not.toContain('0501234567');
    expect(out).toContain('[שם]');
    expect(out).toContain('[מייל]');
    expect(out).toContain('[טלפון]');
  });

  it('sweeps other emails and Israeli phones the exact tokens miss', () => {
    // A different contact than the row owner — must still be masked.
    const out = redactPii('פנו ל-other@company.co.il או 052-9876543', {
      name: null,
      email: null,
      phone: null,
    });
    expect(out).not.toContain('other@company.co.il');
    expect(out).not.toContain('9876543');
    expect(out).toContain('[מייל]');
    expect(out).toContain('[טלפון]');
  });

  it('is a no-op for empty/too-short identifiers and empty text', () => {
    expect(redactPii('', { name: '', email: null, phone: undefined })).toBe('');
    // A 1-char "name" is not used as a mask token (would over-shred the text).
    expect(redactPii('טקסט רגיל', { name: 'א', email: null, phone: null })).toBe('טקסט רגיל');
  });
});

describe('trigramDice', () => {
  it('is 1 for identical strings and for two empties', () => {
    expect(trigramDice('שלום עולם', 'שלום עולם')).toBe(1);
    expect(trigramDice('', '')).toBe(1);
  });

  it('is 0 for a disjoint pair and when only one side is empty', () => {
    expect(trigramDice('abcdef', 'uvwxyz')).toBe(0);
    expect(trigramDice('abcdef', '')).toBe(0);
  });

  it('lands strictly between 0 and 1 for a partial overlap', () => {
    const s = trigramDice('the quick brown fox', 'the quick red fox');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe('toRedactedExample', () => {
  it('redacts every field, defaults a missing topic, and scores similarity', () => {
    const ex = toRedactedExample(
      {
        topic: null,
        message: 'אני דנה, dana@x.com, רוצה הצעת מחיר',
        draft: 'שלום, נשמח לעזור בכל שאלה — צוות KALFA',
        sent: 'שלום דנה, נשמח לעזור בכל שאלה — צוות KALFA',
        pii: { name: 'דנה', email: 'dana@x.com', phone: null },
      },
      2000,
    );
    expect(ex.topic).toBe('אחר');
    expect(ex.inquiry).not.toContain('dana@x.com');
    expect(ex.sent).not.toContain('דנה'); // masked to [שם]
    expect(ex.similarity).toBeGreaterThan(0.5); // draft ≈ sent (only the name differs)
  });

  it('caps each field to fieldMax with an ellipsis', () => {
    const long = 'א'.repeat(50);
    const ex = toRedactedExample(
      { topic: 'תמיכה', message: long, draft: long, sent: long, pii: {} },
      10,
    );
    expect(ex.inquiry.length).toBeLessThanOrEqual(11); // 10 chars + '…'
    expect(ex.inquiry.endsWith('…')).toBe(true);
  });
});

describe('summarizeMetric', () => {
  const mk = (similarity: number): RedactedExample => ({
    topic: 'מכירות',
    inquiry: '',
    draft: '',
    sent: '',
    similarity,
  });

  it('returns zeros for an empty corpus', () => {
    expect(summarizeMetric([], 0.85)).toEqual({
      corrected: 0,
      avgSimilarity: 0,
      nearVerbatim: 0,
      nearPct: 0,
    });
  });

  it('counts near-verbatim pairs at/above the threshold and averages the rest', () => {
    const m = summarizeMetric([mk(0.9), mk(0.85), mk(0.5), mk(0.1)], 0.85);
    expect(m.corrected).toBe(4);
    expect(m.nearVerbatim).toBe(2); // 0.9 and 0.85 (inclusive)
    expect(m.nearPct).toBe(50);
    expect(m.avgSimilarity).toBeCloseTo(0.59, 2);
  });
});

describe('renderExamplesMarkdown', () => {
  it('emits a placeholder note when there are no examples', () => {
    const md = renderExamplesMarkdown([], 0.85);
    expect(md).toContain('מוסתר-PII');
    expect(md).toContain('אין עדיין');
  });

  it('labels each example by similarity and never leaks the raw threshold rows', () => {
    const md = renderExamplesMarkdown(
      [
        { topic: 'מכירות', inquiry: 'שאלה', draft: 'ד', sent: 'ד', similarity: 0.95 },
        { topic: 'תמיכה', inquiry: 'שאלה', draft: 'ד', sent: 'שונה', similarity: 0.2 },
      ],
      0.85,
    );
    expect(md).toContain('דוגמה 1 — נושא: מכירות — נשלח כמעט-כמו-שהוא');
    expect(md).toContain('דוגמה 2 — נושא: תמיכה — תוקן');
    expect(md).toContain('**מה שנשלח (אדם):**');
  });
});
