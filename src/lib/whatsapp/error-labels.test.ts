import { describe, expect, it } from 'vitest';

import { whatsappErrorCodes, whatsappErrors } from '@/lib/whatsapp/generated/error-codes';
import labels from '@/locales/he/whatsappErrors.json';

import { whatsappErrorLabel } from './error-labels';

const labelsByKey: Record<string, unknown> = labels;
const rangeLabels: Record<string, string> = labels.range;
const exactCodes = new Set<number>(whatsappErrorCodes);

const ranges = whatsappErrors.flatMap(({ api, kind, min, max }) =>
  kind === 'range' && min !== null && max !== null ? [{ api, min, max }] : [],
);

describe('whatsappErrorLabel', () => {
  // Through the function, so a code the catalog's default API filter leaves out is covered too. The comparison with
  // `unknown` matters: a missing label still returns text, the fallback.
  it.each(whatsappErrorCodes)('code %i has its own Hebrew label', (code) => {
    const label = labelsByKey[String(code)];

    expect(typeof label).toBe('string');
    expect(String(label).trim()).not.toBe('');
    expect(label).not.toBe(labels.unknown);
    expect(whatsappErrorLabel(String(code))).toBe(label);
  });

  it.each(whatsappErrorCodes)('the label of code %i is plain text, without the code', (code) => {
    const label = String(labelsByKey[String(code)]);

    expect(label).not.toContain(String(code));
    expect(label).not.toMatch(/\{\{|\$t\(/);
  });

  it('has a label only for the codes in the catalog', () => {
    const expected = [...whatsappErrorCodes.map(String), 'range', 'unknown'];

    expect(Object.keys(labels).sort()).toEqual(expected.sort());
  });

  it('the catalog still has the 2 ranges this file words', () => {
    expect(ranges).toHaveLength(2);
    expect(Object.keys(rangeLabels).sort()).toEqual([...new Set(ranges.map(({ min, max }) => `${min}-${max}`))].sort());
  });

  it.each(ranges)('every code of the $api range $min-$max resolves to the range label', ({ min, max }) => {
    const label = rangeLabels[`${min}-${max}`];

    expect(label?.trim()).toBeTruthy();
    expect(label).not.toBe(labels.unknown);
    for (let code = min; code <= max; code += 1) {
      if (!exactCodes.has(code)) expect(whatsappErrorLabel(String(code))).toBe(label);
    }
  });

  it.each(ranges)('a code just outside the $api range $min-$max is unknown', ({ min, max }) => {
    expect(whatsappErrorLabel(String(min - 1))).toBe(labels.unknown);
    expect(whatsappErrorLabel(String(max + 1))).toBe(labels.unknown);
  });

  it('an exact code wins over the range holding it', () => {
    expect(whatsappErrorLabel('200')).toBe(labels['200']);
    expect(labels['200']).not.toBe(labels.range['200-299']);
  });

  it('a number with no label resolves to unknown', () => {
    expect(labels.unknown.trim()).not.toBe('');
    expect(whatsappErrorLabel('999999')).toBe(labels.unknown);
    expect(whatsappErrorLabel('99999999999999999999')).toBe(labels.unknown);
  });

  it.each([
    [''],
    [' '],
    ['abc'],
    ['meta_131049'],
    [' 131049'],
    ['131049 '],
    ['131049\n'],
    ['1e5'],
    ['0x83'],
    ['-1'],
    ['0201'],
    ['131049.0'],
    ['131049.5'],
    ['a.b'],
    ['range.200-299'],
    ['ns:key'],
    ['whatsappErrors:131049'],
    ['range'],
    ['unknown'],
    ['constructor'],
    ['__proto__'],
  ])('%j is not a code and resolves to unknown', (value) => {
    expect(whatsappErrorLabel(value)).toBe(labels.unknown);
  });
});
