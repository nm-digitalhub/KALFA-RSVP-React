"""Re-score the contextual benchmark with VERIFIED prefix neutralisation.

⚠️ WHY THIS IS A SEPARATE STEP. `context_benchmark.py` runs the model; this only
scores what it produced, so the scoring can be corrected and re-argued without
another 59 inferences — and so the two layers cannot silently disagree.

⚠️ AND WHY THE FIRST SCORING WAS WRONG. The extraction aligns by token index, so
a grapheme that appears inside a prefixed token comes back WITH its prefix:
`אילת` inside `באילת` returns `beʔejlˈat`, which can never equal a prefix-less
410 entry. The first attempt papered over that with `ctx.endswith(current_410)`.
That is a suffix test, not a prefix test: it accepts ANY leading material,
including a genuinely different reading, and it would happily match a two-phoneme
entry against an unrelated word ending in the same two phonemes.

So this strips the prefix EXPLICITLY and only when it is justified:

  1. the Hebrew token must actually differ from the grapheme, and the extra
     characters must sit in FRONT of it (a suffix difference is not a prefix);
  2. those extra characters must all be Hebrew prefix letters (בהלוכמש);
  3. the phonemes removed must match what that letter can sound like. `ב` may
     drop be/ba/bi/bə/v, `ה` may drop ha/he — nothing else.

If any of the three fails, nothing is stripped and the row is compared as-is.
A row that only matches because of a strip is marked, so every such verdict can
be read back and disputed.

Read-only. Run:  python3 scripts/pronunciation/score_context_benchmark.py
"""

import csv
import unicodedata as U
from pathlib import Path

SRC = Path("voxfiles/pronunciation/audit/results/context-benchmark.csv")
OUT = Path("voxfiles/pronunciation/audit/results/context-benchmark-scored.csv")

# What each Hebrew prefix letter is allowed to contribute, longest first so the
# fuller vowel wins before the bare consonant.
PREFIX_SOUNDS = {
    "ב": ("be", "ba", "bi", "bə", "b", "ve", "va", "v"),
    "ה": ("ha", "he", "h"),
    "ל": ("le", "la", "li", "lə", "l"),
    "ו": ("ve", "va", "vi", "u", "v"),
    "כ": ("ke", "ka", "ki", "k", "χe", "χa"),
    "מ": ("me", "mi", "ma", "m"),
    "ש": ("ʃe", "ʃa", "ʃ"),
}


def norm(s: str) -> str:
    """Collapse notation-only differences so only real ones survive.

    ⚠️ `ei` → `ej` IS INCLUDED, and it is not cosmetic here. Renikud emitted
    `haʔeiʁusˈin` for אירוסין — a bare `i` where every other row of the same
    family has `j`. Without this the row scores NEITHER for a spelling choice
    inside one model's own output.
    """
    s = U.normalize("NFC", s)
    for a, b in (
        ("ˈ", ""), ("ˌ", ""), ("ɡ", "g"), ("χ", "x"), ("ʁ", "r"), ("ʔ", ""),
        (",", ""), (".", ""), ("?", ""), ("!", ""), ("ei", "ej"),
    ):
        s = s.replace(a, b)
    return s


def strip_prefix(sentence: str, word: str, ctx: str) -> tuple[str, str]:
    """Return (ctx without a justified prefix, what was removed)."""
    token = next((t for t in sentence.split() if word in t), "")
    if not token or token == word:
        return ctx, ""
    head, _, _ = token.partition(word)
    if not head or not all(ch in PREFIX_SOUNDS for ch in head):
        # Either the difference is a SUFFIX (nothing in front) or the extra
        # characters are not prefix letters — in both cases removing anything
        # would be inventing a justification.
        return ctx, ""
    removed = ""
    rest = norm(ctx)
    for ch in head:
        for sound in PREFIX_SOUNDS[ch]:
            if rest.startswith(norm(sound)):
                removed += sound
                rest = rest[len(norm(sound)):]
                break
        else:
            return ctx, ""  # this letter's sound is not there; strip nothing
    return rest, removed


def main() -> None:
    rows = list(csv.DictReader(SRC.open(encoding="utf-8-sig")))
    tally: dict[str, int] = {}
    out_rows = []
    for r in rows:
        ctx_raw = r["renikud_in_context"]
        if ctx_raw.startswith("<"):
            verdict, removed, bare = "NO_CONTEXT", "", ctx_raw
        else:
            bare, removed = strip_prefix(r["context_sentence"], r["grapheme"], ctx_raw)
            bare = norm(bare)
            hit410 = bare == norm(r["current_410"])
            hitph = bare == norm(r["phonikud"])
            verdict = (
                "410" if hit410 and not hitph
                else "PHONIKUD" if hitph and not hit410
                else "BOTH" if hit410 else "NEITHER"
            )
        tally[verdict] = tally.get(verdict, 0) + 1
        out_rows.append({**r, "prefix_removed": removed, "context_bare": bare, "verdict": verdict})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)

    print("VERDICT (prefix explicitly stripped and verified):", tally, "SUM", sum(tally.values()))
    print(f"rows where a prefix was removed: {sum(1 for r in out_rows if r['prefix_removed'])}")
    print("SAVED:", OUT)
    print()
    for want in ("PHONIKUD", "NEITHER"):
        sel = [r for r in out_rows if r["verdict"] == want]
        print(f"=== {want} ({len(sel)}) ===")
        for r in sel:
            pre = f"[-{r['prefix_removed']}]" if r["prefix_removed"] else "     "
            print(
                f'  {r["grapheme"]:<11}{pre} CTX={r["context_bare"]:<15} '
                f'410={r["current_410"]:<15} PH={r["phonikud"]}'
            )
        print()


if __name__ == "__main__":
    main()
