import { describe, expect, it } from 'vitest';

import {
  ANSWER_MAX,
  buildCompletionAnswer,
  isCompletableStatus,
} from './complete';

describe('buildCompletionAnswer', () => {
  it('starts a fresh answer with the completion stamp', () => {
    expect(buildCompletionAnswer(null, 'האירוע נסגר')).toBe('[הושלם] האירוע נסגר');
  });

  it('appends after the existing verdict, keeping it a verbatim prefix', () => {
    const verdict = 'תסגור את הקמפיין ותשחרר את המסגרת';
    const out = buildCompletionAnswer(verdict, 'בוצע ואומת ב-DB');
    expect(out.startsWith(verdict)).toBe(true);
    expect(out).toBe(`${verdict}\n\n[הושלם] בוצע ואומת ב-DB`);
  });

  it('truncates the summary tail to fit the DB cap, never the verdict', () => {
    const verdict = 'א'.repeat(1900);
    const out = buildCompletionAnswer(verdict, 'ב'.repeat(300));
    expect(out.length).toBeLessThanOrEqual(ANSWER_MAX);
    expect(out.startsWith(verdict)).toBe(true);
    expect(out).toContain('[הושלם] ');
    expect(out.endsWith('…')).toBe(true);
  });

  it('throws when there is no meaningful room left and on empty summaries', () => {
    expect(() => buildCompletionAnswer('א'.repeat(1995), 'בוצע')).toThrow(/too full/);
    expect(() => buildCompletionAnswer(null, '   ')).toThrow(/empty/);
  });
});

describe('isCompletableStatus', () => {
  it('allows pending and the two positive verdicts only', () => {
    expect(isCompletableStatus('pending')).toBe(true);
    expect(isCompletableStatus('approved')).toBe(true);
    expect(isCompletableStatus('answered')).toBe(true);
    expect(isCompletableStatus('denied')).toBe(false);
    expect(isCompletableStatus('expired')).toBe(false);
    expect(isCompletableStatus('consumed')).toBe(false);
    expect(isCompletableStatus('completed')).toBe(false);
  });
});
