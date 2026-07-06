import { describe, expect, it } from 'vitest';

import { decodeCsvBuffer, parseCsv, sniffSpreadsheetBinary } from './csv';

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

describe('sniffSpreadsheetBinary', () => {
  it('detects an xlsx (ZIP) upload by magic bytes', () => {
    expect(
      sniffSpreadsheetBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])),
    ).toBe('xlsx');
  });

  it('detects a legacy xls (OLE) upload by magic bytes', () => {
    expect(
      sniffSpreadsheetBinary(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1])),
    ).toBe('xls');
  });

  it('returns null for plain text (UTF-8 CSV)', () => {
    expect(
      sniffSpreadsheetBinary(new TextEncoder().encode('שם מלא,טלפון\n')),
    ).toBe(null);
  });

  it('returns null for a short/empty buffer', () => {
    expect(sniffSpreadsheetBinary(new Uint8Array([0x50, 0x4b]))).toBe(null);
    expect(sniffSpreadsheetBinary(new Uint8Array([]))).toBe(null);
  });
});

describe('decodeCsvBuffer', () => {
  it('decodes valid UTF-8 (with Hebrew) as UTF-8', () => {
    const bytes = new TextEncoder().encode('שם מלא,טלפון\nדנה,0501234567\n');
    expect(decodeCsvBuffer(bytes)).toContain('דנה');
  });

  it('keeps the UTF-8 BOM intact for parseCsv to strip', () => {
    const bytes = new TextEncoder().encode('\uFEFF' + 'שם,טלפון\n');
    const grid = parseCsv(decodeCsvBuffer(bytes));
    expect(grid[0][0]).toBe('שם');
  });

  it('falls back to windows-1255 for Hebrew-Excel ANSI bytes', () => {
    // 'דנה' in windows-1255: 0xE3 0xF0 0xE4 — invalid as UTF-8.
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('name,phone\n'),
      0xe3, 0xf0, 0xe4,
      ...new TextEncoder().encode(',0501234567\n'),
    ]);
    expect(decodeCsvBuffer(bytes)).toContain('דנה');
  });

  it('decodes pure ASCII identically under either path', () => {
    const bytes = new TextEncoder().encode('name,phone\nDana,0501234567\n');
    expect(decodeCsvBuffer(bytes)).toBe('name,phone\nDana,0501234567\n');
  });
});
