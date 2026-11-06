---
name: translation-qa
description: Validate translation quality and completeness across existing localization files in any common format. Catches missing translations, placeholder errors, glossary violations, grammar and context errors, cut-off text, and formatting issues, with length thresholds and grammar rules for Hebrew, English and French (fr-FR). Use when reviewing translation app output, auditing multilingual content, or validating localization files before release. Also use for requests phrased as translation review, localization QA, check translations, translation audit, or i18n validation. Do not use to produce a new translation, to add i18n to code, to run or sync Locize, or to find hardcoded strings in code. This skill checks translations that already exist.
---

# Translation QA

You audit translations for completeness, accuracy, and consistency across languages. You work with localization files in any common format and catch the issues that automated tools miss.

## Gather Context First

1. **File format** — JSON (react-intl, next-intl, i18next), PO/POT (gettext), XLIFF, YAML (Rails), ARB (Flutter), .strings (Apple), .resx (.NET), or raw text?
2. **Languages** — Source language and target language(s). How many target languages?
3. **Source of translations** — Human translator, machine translation, translation app (e.g., Weglot, Shopify Translate), or mixed?
4. **Glossary** — Is there a terminology glossary or style guide for each language?
5. **Context** — What type of content? (UI strings, marketing copy, legal, product descriptions, help docs)
6. **Known issues** — Any reported problems? (e.g., "German translations feel too formal," "missing translations on the checkout page")

## Run the Script First

Run the bundled script instead of writing your own checks, so every audit applies the same rules. Run it at the start, and again after every fix, until no critical findings remain. It only reads files and prints JSON.

```bash
node ${CLAUDE_SKILL_DIR}/scripts/check_translations.mjs
node ${CLAUDE_SKILL_DIR}/scripts/check_translations.mjs --target-root docs/translations/drafts
```

Run it from the project root. The first command checks `src/locales`, and the second checks the drafts against the Hebrew in `src/locales`. It needs Node.js 18 or later. The project's `i18next-cli` gives the placeholder and tag check, and its `typescript` gives the code scan.

- **Exit codes:** `0` no critical findings, `1` critical findings, `2` invalid arguments, `3` files unreadable or the placeholder check could not run. Exit 1 is a result, not a tool failure.
- **Findings:** the report shows the first findings of each check. `--check ID --lang LANG` lists all of them, with `--limit` and `--offset`.
- **Only what changed:** `--changed-since REF` limits the report and the dump to keys changed since a git ref.
- **Other file formats:** PO, XLIFF, ARB, ICU JSON, YAML, `.strings` and `.resx` work with `--target-file`. See [formats](references/formats.md).
- **Never work from cut text:** the overview shortens long strings and marks those rows `textCut`, so use `--check` for the whole text. Don't pipe strings or reports through `head` or `cut`. If any tool or agent output says it was truncated, get the rest before drawing a conclusion, and check that what you read ends on a complete sentence.
- **All options:** `--help`.

The report's `scope` field says what the script measured and what it did not. An empty report means the file is well formed, not that the translation is right: meaning, tone and whether a term fits its context need a reader, in Steps 3 and 4. For problems in the code, such as hardcoded strings, use `npx i18next-cli lint` and `npx i18next-cli status`.

## QA Process

### Step 1 — Parse and Align

Load source and target files. Align strings by key/ID.

Report:
- Total string count per language
- Strings in source but missing from target (untranslated)
- Strings in target but missing from source (orphaned — possibly from a removed feature)
- Percentage complete per language

### Step 2 — Automated Checks

Run these checks on every translated string:

**Critical (will break the UI or functionality):**

| Check | What It Catches |
|-------|----------------|
| Missing placeholders | Variables in source (`{name}`, `%s`, `{{count}}`) absent in translation |
| Extra placeholders | Translation has variables not in source |
| Broken HTML tags | Unclosed or mismatched tags in translation |
| Format specifier mismatch | `%d`, `%@`, `%1$@` not preserved exactly |
| ICU syntax errors | Invalid MessageFormat syntax (plural rules, select statements) |
| Missing plural forms | Language requires plural variants but not all are provided (Hebrew: one, two, other; English: one, other; French: one, other, and many only from 1,000,000). A missing form shows the reader the raw key or the fallback language |

**Warning (likely errors):**

| Check | What It Catches |
|-------|----------------|
| Untranslated strings | Target text identical to source (may be intentional for brand names) |
| Number mismatch | Numeric values in source not preserved in translation |
| URL mismatch | URLs in source not preserved or localized incorrectly |
| Email mismatch | Email addresses differ between source and translation |
| Significant length change | Translation outside the range for its language pair in Length Thresholds below (may indicate truncation or missed content) |
| Cut-off text | Translation stops mid-sentence, ends on a word that can't end one, has an unclosed bracket, or has far fewer sentences than the source. Also text in an element that clips it (`truncate`, `line-clamp`) when the translation is wider than the source |

**Style (quality improvement):**

| Check | What It Catches |
|-------|----------------|
| Punctuation mismatch | Final punctuation differs (period, question mark, exclamation) |
| Leading/trailing whitespace | Spaces that may affect UI layout |
| Double spaces | Multiple consecutive spaces |
| Capitalization | First letter case doesn't match source pattern |
| Glossary violations | Key terms not using the approved translation |

### Length Thresholds

A length result means "read this string", not "this string is wrong". Normal length depends on the language pair: Hebrew writes few vowels and attaches small words to the next word, so a correct French translation is usually about 1.7 times its Hebrew source.

The script applies these rules. `--thresholds` prints the ranges.

How a string is measured:

1. Placeholders, tags and Hebrew niqqud are removed from both strings, and non-breaking spaces count as ordinary spaces.
2. The ratio is the target length divided by the source length, in characters.
3. Sources under 20 characters are skipped, because the ratio says nothing there: `שאלות נפוצות` → `FAQ` is 0.25 and `נא למלא שם` → `Please fill in your name` is 2.40, and both are correct.
4. Each direction between Hebrew, English and French has one range for sources of 20–79 characters, one for 80 characters or more, and a UI limit.
5. Where it catches more faults, a term much longer in one language, such as `RSVP` and `confirmation de présence`, is masked in both.

How to read a result:

- Each range holds the middle 95% of the measured translations, so about 1 correct string in 20 falls outside by design.
- The report's `lengthCatchRate` says how strong the check is for that pair, overall and for strings under 80 characters: how many translations cut in half, cut by a third, or doubled it would catch.
- A string inside the range is not proven complete. Length alone misses most cuts of about a third. `possible-truncation` catches more of them, but only where the text visibly stops short, so compare the meaning in Step 4.
- A language pair with no measured range uses 0.50–2.00 and a UI limit of 1.30.

Thresholds come from the translations themselves, so measuring on text that is still under review would teach the check to accept its faults. Run `--calibrate` only on reviewed translations, or when the owner asks, and never as part of an audit:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/check_translations.mjs --calibrate --target-root docs/translations/drafts --out ${CLAUDE_SKILL_DIR}/scripts/length-thresholds.json
```

### Step 3 — Glossary Consistency

The script reads the term tables in `<target-root>/<lang>/glossary.md`, or the file given with `--glossary LANG=FILE`, and reports `glossary-review`. It applies a row only where the translations mostly follow it, so each finding is an outlier to read. Many are fair paraphrases, so decide each one in context. Report the rows it did not apply as well: the report shows how many terms it applied.

If a glossary is provided, verify:

- Every occurrence of a glossary term uses the approved translation
- The same term is translated consistently across all strings (e.g., "Dashboard" is always "Tableau de bord" in French, not sometimes "Panneau")
- Brand names, product names, and technical terms are handled according to glossary rules (often left untranslated)

If no glossary exists, extract the most frequent terms and check if they're translated consistently. Flag inconsistencies as potential glossary candidates.

### Step 4 — Context-Aware Review

For strings where automated checks pass, do a contextual review. Start by reading each string where it is used, because the same words can need different translations and the key alone doesn't show that.

Use `--dump` to read: it prints the source, the translations, the code location and element of each key, and a hash, one page at a time. Use `--changed-since REF` to read only what changed. Keep a record of the reading as JSON Lines, one line per key and language: `{"ns":"public","key":"r.form.submit","lang":"fr","hash":"...","verdict":"ok"}`, with `"verdict":"issue"` and a `"note"` for a problem. Then run `--review FILE`, which proves every string was read and none changed afterwards. It can't prove the reading was good, so for important text have a reader who did not write the translation do it.

- **Where it appears** — Work out the element, who reads it, and what happens next. A button must say what it does, and a sentence must match its button. Keys the code scan could not place are listed under `usage` in the report, so find those by hand.
- **Who is addressed** — One person or several, and is their gender known? Hebrew without niqqud relies on context, so `אליך` can address either gender. When the reader's gender is unknown, the translation must not guess it.
- **Same word, different meaning** — The same source word can need different translations in different keys, such as a noun and a verb, or `אישור` as an RSVP and as an approval. Don't report that as inconsistency. The same concept should still keep one term (Step 3).
- **Inserted values** — Put realistic values into each placeholder and read the whole sentence. Grammar often breaks around a placeholder: Hebrew attaches a preposition to it (`ב{{eventType}}`), French needs an article that matches the inserted word, and `de {{name}}` should become `d'` before a vowel.
- **Strength of meaning** — Look for added promises, lost negations and a changed subject. In consent, legal and privacy wording, report any change in strength or scope, and leave the wording decision to the owner.
- **Grammar** — Apply the rules for the target language: [Hebrew](references/grammar-he.md), [English](references/grammar-en.md), [French (fr-FR)](references/grammar-fr-FR.md). When Hebrew is the source, read the Hebrew file too, and report a source problem as a source problem, not as a translation error.
- **UI fit** — Will the translation fit in the UI? The script finds buttons, tabs, table headers and navigation links from the code, and estimates each label's width from the real font. `ui-overflow` means a button is wider than a full row at 320px. `ui-length` means a label is over the limit for its language pair and wider than the narrowest control. Both are estimates, so confirm them on the real screen at 320px wide. Text in other elements wraps and is not flagged. The limits come from `scripts/ui-settings.json`, which states the reason for each: for another project, copy it, pass it with `--ui-settings`, and measure its font with `scripts/measure_font.cjs`. German and Finnish translations are often 30-40% longer than English.
- **Register/Formality** — Is the tone appropriate? Formal "vous" vs informal "tu" in French. "Sie" vs "du" in German. Consistency across the product.
- **Cultural adaptation** — Dates (MM/DD vs DD/MM), currency symbols, number formatting (1,000.00 vs 1.000,00), examples and metaphors that don't translate.
- **Gender and inclusivity** — Languages with grammatical gender may need neutral alternatives or dual forms.
- **Right-to-left** — If any target language is RTL (Arabic, Hebrew), flag UI strings that may need layout mirroring.

### Step 5 — Platform-Specific Checks

**Shopify Translate & Similar Apps:**
- Check all content types: products, collections, pages, blog posts, theme strings, checkout, emails
- Flag content the app can't translate (liquid template strings, metafield content)
- Verify URL handles are localized or redirected

**React/Next.js (JSON i18n):**
- Nested keys match source structure
- Interpolation syntax matches the i18n library (`{value}` vs `{{value}}` vs `%{value}`)
- Namespace organization is consistent
- For a Next.js project, read [the Next.js rules](references/nextjs.md). A correct translation still shows the wrong language if the code does not load it for the request.

**Mobile (iOS/Android):**
- Plural rules follow CLDR for each language
- String arrays have matching element counts
- Format specifiers match platform conventions

### Step 6 — Report

**What this audit can't prove:** say in the report who read the meaning, and that a clean result is not proof. If you did the reading, say that no native speaker or independent reader has confirmed it.

**Summary:**
- Coverage: X% translated across N languages
- Critical issues: N (will break functionality)
- Warnings: N (likely errors)
- Style issues: N (quality improvements)

**Per-language breakdown:**
- Completion percentage
- Issue count by severity
- Top 5 issues with example strings

**Detailed issue list:**
- String key/ID
- Source text
- Target text
- Issue type and severity
- Suggested fix (where possible)

Sort by severity, then by frequency (an error pattern affecting 50 strings is higher priority than a one-off).
