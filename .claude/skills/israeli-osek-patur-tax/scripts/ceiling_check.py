#!/usr/bin/env python3
"""Osek-patur ceiling proximity check.

Reads the current VAT-exempt turnover ceiling from the skill's evidence.json
(claim: vat-exempt-ceiling) — never hardcodes it — and reports how close a
given year-to-date turnover is, plus a simple run-rate projection.

Usage:
    python3 ceiling_check.py <ytd_turnover_nis> [--as-of YYYY-MM-DD]

Exits non-zero (with a loud message) if the evidence claim is older than
MAX_AGE_DAYS: the ceiling is indexed annually, so a stale figure must be
re-verified live (Nevo חוק מע"מ §1) before this check may be trusted.
"""

import argparse
import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

MAX_AGE_DAYS = 180
CLAIM_ID = "vat-exempt-ceiling"
EVIDENCE = Path(__file__).resolve().parent.parent / "evidence.json"


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load_ceiling() -> tuple[float, str]:
    try:
        data = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"evidence.json not found at {EVIDENCE}")
    claim = next((c for c in data.get("claims", []) if c.get("claim_id") == CLAIM_ID), None)
    if claim is None:
        fail(f"claim '{CLAIM_ID}' missing from evidence.json")

    fetched_at = claim.get("fetched_at", "")
    try:
        fetched = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
    except ValueError:
        fail(f"claim '{CLAIM_ID}' has unparseable fetched_at: {fetched_at!r}")
    age = (datetime.now(timezone.utc) - fetched).days
    if age > MAX_AGE_DAYS:
        fail(
            f"ceiling evidence is {age} days old (max {MAX_AGE_DAYS}). "
            "The ceiling is indexed annually — re-verify live against the "
            "statute text (Nevo, חוק מע\"מ §1) and refresh evidence.json first."
        )

    amounts = re.findall(r"\d{1,3}(?:,\d{3})+|\d{5,}", claim.get("claim", ""))
    if not amounts:
        fail(f"no shekel amount found in claim text: {claim.get('claim')!r}")
    ceiling = float(amounts[0].replace(",", ""))
    return ceiling, fetched_at


def main() -> None:
    parser = argparse.ArgumentParser(description="Osek-patur ceiling proximity check")
    parser.add_argument("ytd_turnover", type=float, help="year-to-date turnover in NIS (מחזור, not profit)")
    parser.add_argument("--as-of", default=None, help="date of the YTD figure (YYYY-MM-DD, default today)")
    args = parser.parse_args()

    as_of = date.fromisoformat(args.as_of) if args.as_of else date.today()
    ceiling, fetched_at = load_ceiling()

    pct = args.ytd_turnover / ceiling * 100
    day_of_year = as_of.timetuple().tm_yday
    projected = args.ytd_turnover / day_of_year * 365 if day_of_year else 0.0

    print(f"ceiling (from evidence.json, fetched {fetched_at}): ₪{ceiling:,.0f}")
    print(f"YTD turnover as of {as_of}: ₪{args.ytd_turnover:,.0f} → {pct:.1f}% of ceiling")
    print(f"linear run-rate projection for the full year: ₪{projected:,.0f} ({projected / ceiling * 100:.1f}% of ceiling)")

    if args.ytd_turnover >= ceiling:
        print("STATUS: CEILING CROSSED — the osek-patur status no longer holds; "
              "start the transition procedure (regional VAT office) immediately.")
    elif projected >= ceiling:
        print("STATUS: ON TRACK TO CROSS — projected turnover exceeds the ceiling; "
              "plan the עוסק מורשה transition (pricing, VAT, documents) now.")
    elif pct >= 80:
        print("STATUS: WATCH — within 20% of the ceiling; track monthly.")
    else:
        print("STATUS: OK.")


if __name__ == "__main__":
    main()
