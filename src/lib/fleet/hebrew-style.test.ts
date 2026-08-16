import { describe, expect, it } from 'vitest';

import { buildHebrewStyleGuide } from '@/lib/fleet/hebrew-style';

const guide = buildHebrewStyleGuide();
const allRules = [...guide.punctuation, ...guide.structure, ...guide.typography];

describe('buildHebrewStyleGuide', () => {
  it('covers every mark the Academy guide names', () => {
    const marks = allRules.map((r) => r.mark).join(' ');
    for (const mark of ['פסיק', 'נקודה', 'נקודתיים', 'נקודה־ופסיק', 'ירידת שורה']) {
      expect(marks, `missing ${mark}`).toContain(mark);
    }
  });

  it('states both sides of the comma rule — when to use it and when it is forbidden', () => {
    const marks = guide.punctuation.map((r) => r.mark);
    expect(marks).toContain('פסיק — מתי כן');
    expect(marks).toContain('פסיק — מתי אסור');
  });

  // A rule with a counter-example teaches more than a rule stated abstractly,
  // and the two forbidden-comma cases are the ones a real draft got wrong.
  it('pairs every forbidden-comma rule with a wrong example AND its correction', () => {
    const forbidden = guide.punctuation.filter((r) => r.mark === 'פסיק — מתי אסור');
    expect(forbidden.length).toBeGreaterThanOrEqual(2);
    for (const rule of forbidden) {
      expect(rule.bad, rule.rule).toBeTruthy();
      expect(rule.good, rule.rule).toBeTruthy();
    }
  });

  // The guide is grounding the drafter copies from. A guide that breaks its own
  // rules teaches the break.
  it('obeys its own rules in every GOOD example', () => {
    for (const rule of allRules) {
      if (!rule.good) continue;
      // Forbidden: a comma directly before vav, unless the vav carries the
      // contrastive/consecutive sense the guide explicitly allows.
      const commaVav = /,\s+ו(?!לכן|אילו|אולם|אף)/.exec(rule.good);
      expect(commaVav, `"${rule.good}" — פסיק לפני ו״ו`).toBeNull();
      // Forbidden: a straight double quote inside a Hebrew word (gershayim).
      expect(rule.good, `"${rule.good}" — גרשיים ישרים`).not.toMatch(/[֐-׿]"[֐-׿]/);
    }
  });

  it('carries the measured mistakes, not only abstract rules', () => {
    expect(guide.measured_mistakes.length).toBeGreaterThanOrEqual(5);
    const joined = guide.measured_mistakes.join(' ');
    // The four defects observed in real drafts today.
    expect(joined).toContain('ברכ');
    expect(joined).toContain('חתימה');
    expect(joined).toContain('נציג יפרט');
    expect(joined).toContain('bidi');
  });

  it('is a pure constant — two calls are deep-equal and independent', () => {
    const a = buildHebrewStyleGuide();
    const b = buildHebrewStyleGuide();
    expect(a).toEqual(b);
    a.punctuation.pop();
    expect(buildHebrewStyleGuide().punctuation.length).toBe(b.punctuation.length);
  });
});
