import { describe, expect, it } from 'vitest';

import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses a simple comma-separated row', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('parses multiple LF-separated rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles CRLF line terminators', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('strips a leading UTF-8 BOM', () => {
    expect(parseCsv('﻿name,phone\nדנה,050')).toEqual([
      ['name', 'phone'],
      ['דנה', '050'],
    ]);
  });

  it('does not emit a phantom empty row for a single trailing newline', () => {
    expect(parseCsv('a,b\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles a trailing CRLF without a phantom row', () => {
    expect(parseCsv('a,b\r\n')).toEqual([['a', 'b']]);
  });

  it('keeps a comma inside a quoted field as data', () => {
    expect(parseCsv('"Cohen, Dana",050')).toEqual([['Cohen, Dana', '050']]);
  });

  it('keeps a newline inside a quoted field as data', () => {
    expect(parseCsv('"line1\nline2",x')).toEqual([['line1\nline2', 'x']]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    expect(parseCsv('"she said ""hi""",x')).toEqual([['she said "hi"', 'x']]);
  });

  it('preserves empty cells', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('returns an empty array for input that is only a BOM', () => {
    expect(parseCsv('﻿')).toEqual([]);
  });

  it('preserves a blank middle line as a single empty cell', () => {
    expect(parseCsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });

  it('does not treat % or * as special (no CSV-level wildcard handling)', () => {
    expect(parseCsv('100%,a*b')).toEqual([['100%', 'a*b']]);
  });
});
