#!/usr/bin/env python3
"""Runnable scenario example for the Hebrew legal-term translator."""

from __future__ import annotations

import argparse
import json
import os

from hebrew_legal_term_translator import HebrewLegalTermTranslator


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Review payroll and termination terms for a small employer.')
    parser.add_argument(
        "--env",
        choices=("sandbox", "production"),
        default=os.getenv("HEBREW_LEGAL_TRANSLATOR_ENV", "sandbox"),
        help="Execution environment label.",
    )
    parser.add_argument(
        "--language",
        choices=("en", "he"),
        default=os.getenv("HEBREW_LEGAL_TRANSLATOR_LANG", "en"),
        help="Output language.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    translator = HebrewLegalTermTranslator()
    terms = ['שכר מינימום', 'שעות נוספות', 'פיצויי פיטורים', 'הודעה מוקדמת']
    results = [translator.explain(term, language=args.language).to_dict() for term in terms]
    payload = {
        "environment": args.env,
        "scenario": 'employment_payroll',
        "input_terms": terms,
        "results": results,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
