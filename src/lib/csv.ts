// Minimal, dependency-free CSV parser for guest imports.
//
// Why hand-rolled: the import path needs only a small, well-understood subset
// of CSV, and the project rule is to avoid adding a dependency for it. This
// follows RFC 4180 semantics for the cases we accept:
//   - UTF-8 input, with an optional leading BOM that is stripped.
//   - Comma-separated fields; fields may be wrapped in double quotes.
//   - Inside a quoted field, a literal double quote is written as "" (escaped).
//   - Quoted fields may contain commas and newlines.
//   - Row terminators may be CRLF or LF (a stray CR is treated as part of the
//     line terminator, never as field data).
//   - A trailing newline does NOT produce a phantom empty final row.
//
// It returns the raw grid of string cells. Header mapping, trimming, and
// per-row validation are the caller's concern (see the guests import flow).

// The character the import treats as the field delimiter.
const DELIMITER = ',';
const QUOTE = '"';

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
export function parseCsv(input: string): string[][] {
  // Strip a leading UTF-8 BOM if present (common when files are exported from
  // spreadsheet software on Windows).
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  // Tracks whether the current row has seen any character at all, so we can
  // distinguish a real final row from the empty tail after a trailing newline.
  let rowHasContent = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    rowHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === QUOTE) {
        // A doubled quote ("") inside a quoted field is a literal quote.
        if (text[i + 1] === QUOTE) {
          field += QUOTE;
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === QUOTE) {
      inQuotes = true;
      rowHasContent = true;
      continue;
    }

    if (ch === DELIMITER) {
      pushField();
      rowHasContent = true;
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      // Normalise CRLF to a single terminator: if this is CR followed by LF,
      // consume the LF too.
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      pushRow();
      continue;
    }

    field += ch;
    rowHasContent = true;
  }

  // Flush the final field/row only if the file did not end on a clean row
  // boundary (i.e. there was trailing content after the last newline, or the
  // file has no trailing newline at all).
  if (rowHasContent || field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}
