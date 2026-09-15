"""Judge the 59 disputed words in a KALFA sentence, not in isolation.

⚠️ WHY THIS EXISTS. The three-way comparison that preceded it ran every word
ALONE, and one row proved that is not enough: `שם` came back as `ˈʃam` ("there")
from both models, because for a bare token that is the likelier reading. In
`"מה השם שלך?"` it is `ʃem` ("name"), and the only thing that can know the
difference is surrounding text.

ReNikud is a transformer over the whole string — it predicts a consonant, a
vowel and a stress position per character with attention across the sentence —
so feeding it one word discards exactly the signal that resolves a homograph.
Phonikud's `add_diacritics` is likewise a sequence model. Neither was ever meant
to be judged on isolated tokens.

So each disputed grapheme gets a sentence an agent would actually say, and the
word's phonemes are pulled back out of the sentence-level output.

⚠️ AND THE EXTRACTION IS THE HARD PART, done by character offset rather than by
matching the output text: the phonemisers emit IPA, so there is nothing in the
result that still looks like the Hebrew word. The sentence is split on the word
boundary, each part is phonemised separately, and the middle piece is the
answer. That costs three inferences per row instead of one, and it is the only
way to get a per-word reading out of a sentence-level model without guessing
where one word's phonemes end and the next begin.

Read-only. Run:  python3 scripts/pronunciation/context_benchmark.py
"""

import csv
import json
import unicodedata as U
from pathlib import Path

COMPARISON = Path("voxfiles/pronunciation/audit/results/renikud-comparison.csv")
CONTEXTS = Path("voxfiles/pronunciation/audit/contexts.json")
RENIKUD_MODEL = Path("models/renikud/model.onnx")
OUT = Path("voxfiles/pronunciation/audit/results/context-benchmark.csv")


def norm(s: str) -> str:
    """Collapse notation-only differences so only real ones survive."""
    s = U.normalize("NFC", s)
    for a, b in (("ˈ", ""), ("ˌ", ""), ("ɡ", "g"), ("χ", "x"), ("ʁ", "r"), ("ʔ", "")):
        s = s.replace(a, b)
    return s


def in_context(g2p, sentence: str, word: str) -> str:
    """The word's own phonemes, taken from a sentence-level inference.

    ⚠️ ALIGNED BY TOKEN INDEX, NOT BY STRING SLICING. The first version split the
    sentence at the word and trimmed the phonemised prefix off the front, and it
    failed on every prefixed form: `אילת` occurs inside `באילת`, so the prefix
    ended mid-word, phonemising it alone produced something the full output did
    not start with, and nothing got trimmed — the whole sentence came back as the
    word's reading.

    Both Hebrew and the IPA output keep whitespace between words, and ReNikud
    passes non-Hebrew characters through unchanged, so the Nth word in equals the
    Nth word out. That is the alignment used here: find the token CONTAINING the
    grapheme (prefixes and all), and take the token at the same index from the
    phonemised sentence.
    """
    he_tokens = sentence.split()
    idx = next((i for i, t in enumerate(he_tokens) if word in t), -1)
    if idx < 0:
        return "<word not in sentence>"
    out_tokens = g2p.phonemize(sentence).split()
    if len(out_tokens) != len(he_tokens):
        # Token counts must line up for the index to mean anything; if the
        # phonemiser merged or split something, say so rather than return a
        # neighbouring word's phonemes.
        return f"<token mismatch {len(he_tokens)}->{len(out_tokens)}>"
    return out_tokens[idx]

def main() -> None:
    from renikud_onnx import G2P

    rows = list(csv.DictReader(COMPARISON.open(encoding="utf-8-sig")))
    contexts = json.loads(CONTEXTS.read_text(encoding="utf-8")) if CONTEXTS.exists() else {}
    g2p = G2P(str(RENIKUD_MODEL))

    changed = 0
    out_rows = []
    for r in rows:
        w = r["grapheme"]
        sentence = contexts.get(w, "")
        ctx = in_context(g2p, sentence, w) if sentence else "<no context>"
        isolated = r["renikud"]
        moved = bool(sentence) and norm(ctx) != norm(isolated)
        if moved:
            changed += 1
        verdict = ""
        if sentence and not ctx.startswith("<"):
            if norm(ctx) == norm(r["current_410"]):
                verdict = "410"
            elif norm(ctx) == norm(r["phonikud"]):
                verdict = "PHONIKUD"
            else:
                verdict = "NEITHER"
        print(
            f'{w:<12} 410={r["current_410"]:<20} REN={isolated:<20} '
            f'CTX={ctx:<20} {"← זז" if moved else "":<6} {verdict}'
        )
        out_rows.append(
            {
                **r,
                "context_sentence": sentence,
                "renikud_in_context": ctx,
                "context_changed_reading": moved,
                "context_agrees_with": verdict,
            }
        )

    print()
    print(f"TOTAL {len(rows)}   with context: {sum(1 for r in out_rows if r['context_sentence'])}")
    print(f"reading changed by context: {changed}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)
    print("SAVED:", OUT)


if __name__ == "__main__":
    main()
