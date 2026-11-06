# Migration Checklist

Use this checklist when upgrading from earlier local scripts, non-installable packages, or ad hoc glossary files.

## Naming and imports

- Replace imports from hyphenated script paths with package imports.
- Use `from hebrew_legal_term_translator import HebrewLegalTermTranslator`.
- Use `scripts/hebrew_legal_term_translator_client.py` only as a compatibility helper.
- Remove references to `scripts/hebrew-legal-term-translator-client.py`; that file is intentionally absent.
- Keep the CLI shim at `scripts/hebrew-legal-term-translator-cli.py` for direct local execution.

## Installation

Run from the package root:

```bash
pip install -e .
pip install -r requirements-dev.txt
```

Verify import:

```bash
python -c "from hebrew_legal_term_translator import HebrewLegalTermTranslator; print(HebrewLegalTermTranslator().explain('קבלה').matched_key)"
```

## README quick-start change

Use the returned identifier from the first response:

```bash
hebrew-legal-term-translator lookup "חשבונית מס" --json --env sandbox > create-response.json
TERM_ID=$(python -c 'import json; print(json.load(open("create-response.json", encoding="utf-8"))["matched_key"])')
hebrew-legal-term-translator lookup "$TERM_ID" --json --env sandbox
```

## Example script change

Every example should:

- Read `HEBREW_LEGAL_TRANSLATOR_ENV` when `--env` is not supplied.
- Accept `--env sandbox|production`.
- Read `HEBREW_LEGAL_TRANSLATOR_LANG` when `--language` is not supplied.
- Print `json.dumps(payload, ensure_ascii=False, indent=2)`.
- Import the installed package without path manipulation.

## Test change

- Rename test files to valid Python module names.
- Keep at least 20 tests.
- Include async tests with `pytest-asyncio`.
- Include CLI JSON and example-script tests.
- Include a check that the removed hyphenated client file is absent.

## Documentation change

- Use neutral imperative voice.
- Remove visual brand assets, image references, branding, and owner metadata.
- Use `Copyright holder: neutral license placeholder` in explanations instead of personal names.
- Keep the license file with the required neutral MIT holder.
- Remove emoji from public Markdown.
- Use ₪ for money and DD/MM/YYYY for dates.

## Hebrew quality change

- Remove niqqud from technical prose.
- Prefer Israeli professional terms, such as `ממשק`, `שורת פקודה`, `בדיקה מקצועית`, `מאגר מידע`, `ניכוי מס במקור`, and `הודעה מוקדמת`.
- Avoid unnecessary transliteration when a standard Hebrew term exists.
- Keep literal command flags such as `--env sandbox|production` inside code or command examples.
