#!/usr/bin/env python3
import csv
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from phonikud import phonemize
from phonikud_onnx import Phonikud

BASE = Path.cwd()
FILES = {
    "410": BASE / "voxfiles/pronunciation/audit/hebrew-410.pls",
    "99": BASE / "voxfiles/pronunciation/audit/hebrew-99.pls",
    "kalfa-he": BASE / "voxfiles/pronunciation/kalfa-he.pls",
}
MODEL = BASE / "models/phonikud/phonikud-1.0.int8.onnx"
OUT = BASE / "voxfiles/pronunciation/audit/results"
HEBREW_RE = re.compile(r"[\u0590-\u05FF]")

VARIANT_COLUMNS = (
    "modern_vowel",
    "modern_syllable",
    "plain_vowel",
    "plain_syllable",
    "no_stress",
    "stress_prediction_off",
    "vocal_shva_off",
    "expander_off",
    "post_normalize_off",
)

def local_name(tag):
    return tag.rsplit("}", 1)[-1]

def load_pls(path):
    root = ET.parse(path).getroot()
    rules = {}
    duplicates = []
    for lexeme in root.iter():
        if local_name(lexeme.tag) != "lexeme":
            continue
        grapheme = None
        kind = None
        value = None
        for child in lexeme:
            tag = local_name(child.tag)
            text = (child.text or "").strip()
            if tag == "grapheme":
                grapheme = text
            elif tag in ("phoneme", "alias"):
                kind, value = tag, text
        if not grapheme:
            continue
        if grapheme in rules:
            duplicates.append(grapheme)
        rules[grapheme] = (kind or "", value or "")
    return rules, duplicates

def safe(fn):
    try:
        return fn(), ""
    except Exception as exc:
        return "", f"{type(exc).__name__}: {exc}"

def main():
    required = [*FILES.values(), MODEL]
    missing = [str(p) for p in required if not p.is_file()]
    if missing:
        print("ERROR: required files are missing:", file=sys.stderr)
        for p in missing:
            print(f"  - {p}", file=sys.stderr)
        return 2

    OUT.mkdir(parents=True, exist_ok=True)

    datasets = {}
    for name, path in FILES.items():
        rules, duplicates = load_pls(path)
        datasets[name] = rules
        print(f"{name}: {len(rules)} rules, {len(duplicates)} duplicate grapheme(s)")

    print(f"Loading ONNX model: {MODEL}")
    model = Phonikud(str(MODEL))

    graphemes = sorted(
        set(datasets["410"]) | set(datasets["99"]) | set(datasets["kalfa-he"])
    )
    rows = []

    for index, grapheme in enumerate(graphemes, 1):
        r410 = datasets["410"].get(grapheme)
        r99 = datasets["99"].get(grapheme)
        rkalfa = datasets["kalfa-he"].get(grapheme)
        current = r410[1] if r410 else ""

        row = {
            "grapheme": grapheme,
            "has_hebrew": bool(HEBREW_RE.search(grapheme)),
            "in_410": bool(r410),
            "type_410": r410[0] if r410 else "",
            "current_410": current,
            "in_99": bool(r99),
            "old_99": r99[1] if r99 else "",
            "in_kalfa_he": bool(rkalfa),
            "kalfa_he": rkalfa[1] if rkalfa else "",
            "nikud": "",
            **{key: "" for key in VARIANT_COLUMNS},
            "has_ascii_g": "g" in current,
            "has_ipa_g": "ɡ" in current,
            "has_x": "x" in current,
            "has_chi": "χ" in current,
            "missing_from_410": not bool(r410),
            "diff_410_vs_modern_syllable": False,
            "error": "",
        }

        if row["has_hebrew"]:
            nikud, err = safe(lambda: model.add_diacritics(grapheme))
            row["nikud"] = nikud
            errors = [err] if err else []

            calls = {
                "modern_vowel": lambda: phonemize(
                    nikud, schema="modern", stress_placement="vowel"
                ),
                "modern_syllable": lambda: phonemize(
                    nikud, schema="modern", stress_placement="syllable"
                ),
                "plain_vowel": lambda: phonemize(
                    nikud, schema="plain", stress_placement="vowel"
                ),
                "plain_syllable": lambda: phonemize(
                    nikud, schema="plain", stress_placement="syllable"
                ),
                "no_stress": lambda: phonemize(
                    nikud, schema="modern", preserve_stress=False
                ),
                "stress_prediction_off": lambda: phonemize(
                    nikud, schema="modern", predict_stress=False
                ),
                "vocal_shva_off": lambda: phonemize(
                    nikud, schema="modern", predict_vocal_shva=False
                ),
                "expander_off": lambda: phonemize(
                    nikud, schema="modern", use_expander=False
                ),
                "post_normalize_off": lambda: phonemize(
                    nikud, schema="modern", use_post_normalize=False
                ),
            }

            if nikud:
                for key, fn in calls.items():
                    value, call_err = safe(fn)
                    row[key] = value
                    if call_err:
                        errors.append(f"{key}: {call_err}")

            row["error"] = " | ".join(e for e in errors if e)

        row["diff_410_vs_modern_syllable"] = bool(
            r410
            and r410[0] == "phoneme"
            and row["modern_syllable"]
            and current != row["modern_syllable"]
        )
        rows.append(row)

        if index % 25 == 0 or index == len(graphemes):
            print(f"Processed {index}/{len(graphemes)}")

    fields = list(rows[0].keys())
    full_path = OUT / "phonikud-full-audit.csv"
    with full_path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    differences = [
        r for r in rows
        if r["missing_from_410"]
        or r["diff_410_vs_modern_syllable"]
        or r["error"]
    ]
    diff_path = OUT / "phonikud-differences.csv"
    with diff_path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(differences)

    print()
    print("=== SUMMARY ===")
    print("TOTAL:", len(rows))
    print("HEBREW:", sum(bool(r["has_hebrew"]) for r in rows))
    print("IN 410:", sum(bool(r["in_410"]) for r in rows))
    print("MISSING FROM 410:", sum(bool(r["missing_from_410"]) for r in rows))
    print("ASCII g:", sum(bool(r["has_ascii_g"]) for r in rows))
    print("IPA ɡ:", sum(bool(r["has_ipa_g"]) for r in rows))
    print("x:", sum(bool(r["has_x"]) for r in rows))
    print("χ:", sum(bool(r["has_chi"]) for r in rows))
    print("410 vs MODERN/SYLLABLE DIFF:", sum(bool(r["diff_410_vs_modern_syllable"]) for r in rows))
    print("ERRORS:", sum(bool(r["error"]) for r in rows))
    print("DIFFERENCE ROWS:", len(differences))
    print()
    print(full_path)
    print(diff_path)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
