"""Run the substantive disagreements through Renikud and compare all three.

The 59 rows in `phonikud-substantive.csv` are the ones where dictionary 410 and
Phonikud genuinely disagree about the sounds — notation differences (stress
placement, g/ɡ, x/χ, ʁ/r, ʔ) are already normalised away by the audit that
produced it.

This adds Renikud, the follow-up G2P, as a third opinion.

⚠️ STRESS PLACEMENT IS NORMALISED BEFORE COMPARING, and that is not cosmetic.
Renikud hardcodes `[consonant][ˈ][vowel]` (read in its source: there is no
`stress_placement` option at all), while 410 marks the syllable boundary. Left
alone, every single row would differ for that reason and the comparison would
say nothing.

Read-only. Run:  python3 scripts/pronunciation/compare_renikud.py
"""

import csv
import unicodedata as U
from pathlib import Path

SUBSTANTIVE = Path("voxfiles/pronunciation/audit/results/phonikud-substantive.csv")
RENIKUD_MODEL = Path("models/renikud/model.onnx")
OUT = Path("voxfiles/pronunciation/audit/results/renikud-comparison.csv")


def norm(s: str) -> str:
    """Collapse notation-only differences so only real ones survive."""
    s = U.normalize("NFC", s)
    for a, b in (("ˈ", ""), ("ˌ", ""), ("ɡ", "g"), ("χ", "x"), ("ʁ", "r"), ("ʔ", "")):
        s = s.replace(a, b)
    return s


def main() -> None:
    from renikud_onnx import G2P

    rows = list(csv.DictReader(SUBSTANTIVE.open(encoding="utf-8-sig")))
    g2p = G2P(str(RENIKUD_MODEL))

    agree_410 = agree_ph = agree_none = 0
    out_rows = []
    for r in rows:
        grapheme = r["grapheme"]
        cur = r["current_410"]
        ph = r["modern_syllable"]
        try:
            ren = g2p.phonemize(grapheme)
        except Exception as exc:  # a broken row must not stop the sweep
            ren = f"<error: {exc}>"

        matches_410 = norm(ren) == norm(cur)
        matches_ph = norm(ren) == norm(ph)
        verdict = (
            "410" if matches_410 and not matches_ph
            else "PHONIKUD" if matches_ph and not matches_410
            else "BOTH" if matches_410 and matches_ph
            else "NEITHER"
        )
        if verdict == "410":
            agree_410 += 1
        elif verdict == "PHONIKUD":
            agree_ph += 1
        elif verdict == "NEITHER":
            agree_none += 1

        print(f"{grapheme:<14} 410={cur:<22} PH={ph:<22} REN={ren:<22} → {verdict}")
        out_rows.append(
            {
                "grapheme": grapheme,
                "current_410": cur,
                "phonikud": ph,
                "renikud": ren,
                "renikud_agrees_with": verdict,
                "nikud": r.get("nikud", ""),
            }
        )

    print()
    print(f"TOTAL          {len(rows)}")
    print(f"  Renikud = 410       {agree_410}")
    print(f"  Renikud = Phonikud  {agree_ph}")
    print(f"  Renikud = neither   {agree_none}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)
    print("SAVED:", OUT)


if __name__ == "__main__":
    main()
