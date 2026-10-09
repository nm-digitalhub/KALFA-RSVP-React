import { parse } from 'csv-parse/sync';

// Magic-byte sniffing for files users upload instead of CSV: 'xlsx' is a ZIP
// container (PK\x03\x04), legacy 'xls' is an OLE compound file (D0 CF 11 E0).
// Neither can ever be a text CSV, so four bytes are enough to give a precise
// Hebrew error instead of a garbled parse.
export type SpreadsheetBinary = 'xlsx' | 'xls';

export function sniffSpreadsheetBinary(
  bytes: Uint8Array,
): SpreadsheetBinary | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return 'xlsx';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    return 'xls';
  }
  return null;
}

// Decode uploaded CSV bytes. Hebrew Excel's plain "CSV" save is Windows-1255
// (ANSI); every Hebrew letter in that encoding is an invalid UTF-8 sequence,
// so a strict UTF-8 decode either succeeds (true UTF-8/ASCII) or throws — and
// the fallback decodes the legacy encoding. Node bundles full ICU, so the
// 'windows-1255' label is always available to TextDecoder.
export function decodeCsvBuffer(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1255').decode(bytes);
  }
}

/**
 * Parse CSV text into a grid of rows, each row an array of string cells.
 *
 * A completely empty input (or input that is only a BOM) yields `[]`. Empty
 * lines in the middle of the file are preserved as single-empty-cell rows so
 * the caller can decide whether to skip them; a single trailing line break is
 * not treated as a new row.
 */
export function parseCsv(input: string, delimiter = ','): string[][] {
  return parse(input, {
    delimiter,
    bom: true,
    record_delimiter: ['\r\n', '\n', '\r'],
    relax_column_count: true,
    skip_empty_lines: false,
    // Preserve spaces and blank rows; callers own field validation.
    trim: false,
  }) as string[][];
}
