#!/usr/bin/env python3
"""Fetch a (geo-blocked) official Israeli gazette/law PDF and extract clean
logical-order Hebrew text.

Two proven pieces (validated 2026-07-26 on ס"ח 3481 — Contracts Law Amendment 3):
1. ACCESS — knesset.gov.il/gov.il block this server (HTTP 474/403); the Wayback
   Machine `id_` endpoint serves the ORIGINAL bytes of the archived PDF. A
   gazette issue is a static, dated publication that never changes after
   publication, so its snapshot IS the authoritative content (full
   verification). For LIVE pages (consolidated texts), a snapshot is
   discovery-only — state the snapshot date, never claim "current law".
2. EXTRACTION — Hebrew legal PDFs extract as garbled visual-order text with
   naive tools; PyMuPDF performs bidi reordering and yields logical-order
   Hebrew. Never paste raw WebFetch text of a Hebrew PDF into analysis.

Usage:
  python3 scripts/fetch_law_pdf.py <original-pdf-url> [--timestamp 2026] [--out file.txt]
Requires: pymupdf (installed in the interpreter venv; `pip install pymupdf`).
"""
from __future__ import annotations

import argparse
import sys
import tempfile
import urllib.request

TIMEOUT = 60


def main() -> None:
    p = argparse.ArgumentParser(description="Wayback id_ fetch + PyMuPDF Hebrew extraction")
    p.add_argument("url", help="Original PDF URL (e.g. https://fs.knesset.gov.il/25/law/25_lsr_10622519.pdf)")
    p.add_argument("--timestamp", default="2026", help="Wayback timestamp prefix (default: 2026)")
    p.add_argument("--out", default=None, help="Optional path to write the extracted text")
    args = p.parse_args()

    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("PyMuPDF חסר — התקינו: pip install pymupdf", file=sys.stderr)
        sys.exit(1)

    wb_url = f"https://web.archive.org/web/{args.timestamp}id_/{args.url}"
    req = urllib.request.Request(wb_url, headers={"User-Agent": "Mozilla/5.0 (compatible; legal-research)"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            blob = resp.read()
    except Exception as e:  # noqa: BLE001
        print(f"אחזור מה-Wayback נכשל ({type(e).__name__}: {e}).", file=sys.stderr)
        print("בדקו שה-URL צולם: https://web.archive.org/web/*/" + args.url, file=sys.stderr)
        sys.exit(1)

    if not blob.startswith(b"%PDF"):
        print("התוכן שהוחזר אינו PDF (ייתכן שאין snapshot) — אין להסתמך עליו.", file=sys.stderr)
        sys.exit(1)

    with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
        tmp.write(blob)
        tmp.flush()
        doc = fitz.open(tmp.name)
        text = "\n".join(page.get_text() for page in doc)

    header = (
        f"# PROVENANCE: fetched via Wayback id_ (authoritative for a static, dated gazette publication)\n"
        f"# original: {args.url}\n# wayback:  {wb_url}\n# pages: {len(doc)} · chars: {len(text)}\n"
    )
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(header + "\n" + text)
        print(header + f"נכתב אל: {args.out}")
    else:
        print(header)
        print(text)


if __name__ == "__main__":
    main()
