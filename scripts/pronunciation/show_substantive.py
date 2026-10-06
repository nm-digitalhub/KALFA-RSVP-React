"""Print the pronunciation differences that are NOT explained by notation alone.

Reads the audit produced by `audit_phonikud.py` and keeps only the rows where
410 and Phonikud genuinely disagree about the sounds — after normalising away
the four differences that are spelling conventions rather than pronunciations:

    ˈ / ˌ   stress marks (410 marks the syllable, Phonikud marks the vowel)
    g ↔ ɡ   ASCII g vs IPA ɡ
    x ↔ χ   the old 99-generation spelling of ח vs the correct one
    ʔ       the glottal stop 410 omits on initial א/ע and Phonikud writes

Read-only. Run:  python3 scripts/pronunciation/show_substantive.py
"""

import csv
import unicodedata as U
from pathlib import Path

AUDIT = Path("voxfiles/pronunciation/audit/results/phonikud-full-audit.csv")


def norm(s: str) -> str:
    """Collapse the notation-only differences so only real ones survive."""
    s = U.normalize("NFC", s)
    for a, b in (("ˈ", ""), ("ˌ", ""), ("ɡ", "g"), ("χ", "x"), ("ʁ", "r"), ("ʔ", "")):
        s = s.replace(a, b)
    return s


def main() -> None:
    rows = list(csv.DictReader(AUDIT.open(encoding="utf-8-sig")))
    diffs = [
        r
        for r in rows
        if r["diff_410_vs_modern_syllable"] == "True"
        and norm(r["current_410"]) != norm(r["modern_syllable"])
    ]
    for r in diffs:
        print(
            f'{r["grapheme"]:<20} | 410={r["current_410"]:<25} '
            f'| PH={r["modern_syllable"]:<25} | {r["nikud"]}'
        )
    print("\nTOTAL:", len(diffs))


if __name__ == "__main__":
    main()
