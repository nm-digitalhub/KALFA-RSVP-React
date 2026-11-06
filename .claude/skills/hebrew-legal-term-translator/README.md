# Hebrew Legal-Term Translator

Explain Israeli Hebrew legal and regulatory terms for non-Hebrew speakers, small businesses, freelancers, and consumers. Use the package as a local glossary, command-line helper, and structured review aid. Verify every result against the cited Israeli source before taking legal, tax, employment, privacy, or debt-collection action.

## Install

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e .
pip install -r requirements-dev.txt
```

## Quick start

Create the first lookup response, extract the returned term identifier, then use that identifier in the next step.

```bash
hebrew-legal-term-translator lookup "חשבונית מס" --json --env sandbox > create-response.json
TERM_ID=$(python -c 'import json; print(json.load(open("create-response.json", encoding="utf-8"))["matched_key"])')
hebrew-legal-term-translator lookup "$TERM_ID" --json --env sandbox
```

Python usage:

```python
from hebrew_legal_term_translator import HebrewLegalTermTranslator

translator = HebrewLegalTermTranslator()
result = translator.explain("עוסק פטור", language="en", context="freelancer")
print(result.to_json())
```

Async usage:

```python
import asyncio
from hebrew_legal_term_translator import HebrewLegalTermTranslator

async def main():
    translator = HebrewLegalTermTranslator()
    result = await translator.async_explain("עסקת מכר מרחוק")
    print(result.to_json())

asyncio.run(main())
```

## Command-line examples

```bash
hebrew-legal-term-translator search "refund online" --json
hebrew-legal-term-translator explain-text "קיבלתי התראה לפני נקיטת הליכים על חוב בסך ₪4,200" --json
hebrew-legal-term-translator list-terms --area tax --json
hebrew-legal-term-translator sources
```

Supported environment labels are `sandbox` and `production`. The tool is local and does not call an external service. Use the label to keep sample output, review logs, and production decisions separate.

```bash
export HEBREW_LEGAL_TRANSLATOR_ENV=sandbox
export HEBREW_LEGAL_TRANSLATOR_LANG=en
python scripts/examples/invoice_review.py --env sandbox
```

## File index

| Path | Purpose |
| --- | --- |
| `SKILL.md` | English operating guide with examples, decision trees, edge cases, anti-patterns, and checklist. |
| `SKILL_HE.md` | Hebrew operating guide with Israeli terminology, ₪ examples, and DD/MM/YYYY dates. |
| `hebrew_legal_term_translator/client.py` | Installable typed sync and async client implementation. |
| `hebrew_legal_term_translator/cli.py` | Installable Typer command-line interface. |
| `scripts/hebrew_legal_term_translator_client.py` | Compatibility helper that re-exports the package API. |
| `scripts/hebrew-legal-term-translator-cli.py` | Runnable CLI shim for local checkout usage. |
| `scripts/test_hebrew_legal_term_translator_client.py` | Pytest suite with sync, async, CLI, example, and packaging checks. |
| `scripts/examples/` | Runnable scenario scripts for invoice, consumer, contract, employment, debt, and privacy reviews. |
| `references/api-reference.md` | Local request and response contracts plus Israeli source catalog. |
| `references/workflow-guide.md` | End-to-end workflows for common small-business, freelancer, and consumer tasks. |
| `references/troubleshooting.md` | Failure modes, messages, and correction steps. |
| `references/test-scenarios.md` | More than 20 concrete test scenarios. |
| `references/migration-checklist.md` | Upgrade checklist from earlier packages and ad hoc scripts. |
| `references/branding-audit.md` | Branding, author metadata, visual-reference, and public Markdown audit. |
| `references/hebrew-qa-log.md` | Hebrew-language quality log. |

## Scope

Use for plain-language explanation and triage, not legal advice. The package intentionally avoids live scraping and does not guarantee that a cited law, regulation, threshold, or agency page is current. Use cited sources as verification anchors.

## Development checks

```bash
pytest
python -m compileall scripts/ -q
```

## Packaging

```bash
python -m build
```
