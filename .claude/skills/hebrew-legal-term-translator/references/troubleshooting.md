# Troubleshooting

## Lookup problems

| Problem | Cause | Fix |
| --- | --- | --- |
| Exact Hebrew term does not match | Gershayim, geresh, niqqud, punctuation, or spelling differs | Run `normalize_text`, remove punctuation, or use `search`. |
| English query returns unexpected term | English words are broader than the Hebrew legal term | Add an area filter or provide the Hebrew term. |
| Long paragraph returns no match | The paragraph contains inflected forms or unrelated text | Use `explain-text` and reduce the paragraph to the relevant sentence. |
| Fuzzy match is too weak | Term is outside the glossary | Provide the full Hebrew clause and verify manually. |
| Same term appears in several contexts | Business, consumer, employment, or privacy meaning differs | Add `context` or filter by `area`. |

## CLI problems

| Message | Likely cause | Fix |
| --- | --- | --- |
| `language must be en or he` | Unsupported language option | Use `--language en` or `--language he`. |
| `No glossary terms detected` | Text has no supported term or uses a rare variant | Search key words, add the exact Hebrew phrase, or add a new glossary entry. |
| JSON is unreadable in a terminal | Terminal encoding is not UTF-8 | Redirect to a UTF-8 file or configure the terminal locale. |
| Example script cannot import package | Package was not installed in editable mode | Run `pip install -e .` from the package root. |
| Tests cannot find async support | Development dependencies are missing | Run `pip install -r requirements-dev.txt`. |

## Packaging problems

| Problem | Cause | Fix |
| --- | --- | --- |
| `from hebrew_legal_term_translator import ...` fails | Editable install was skipped | Run `pip install -e .`. |
| Old hyphenated client path is referenced | Script still points to the removed filename | Import `hebrew_legal_term_translator` or `scripts/hebrew_legal_term_translator_client.py`. |
| Console command not found | Entry point was not installed | Reinstall with `pip install -e .`. |
| `compileall` reports syntax errors | Local edits introduced invalid Python | Run `python -m compileall scripts/ -q` and inspect the failing file. |

## Legal-content problems

| Problem | Risk | Fix |
| --- | --- | --- |
| Minimum wage, threshold, fee, or filing limit appears in a user document | Amounts change | Verify current official source before relying on the number. |
| Debt warning includes a date | Deadline risk | Record the service date in DD/MM/YYYY format and check current procedure. |
| VAT status and invoice title conflict | Tax reporting risk | Request VAT registration confirmation and exact document title. |
| Contract contains personal guarantee | Personal asset risk | Request amount cap, expiry, notice rules, and release conditions. |
| Privacy clause mentions marketing consent | Consent and database risk | Review purpose, opt-in wording, withdrawal method, and data sharing. |

## Adding a new term safely

1. Add a `LegalTermEntry` with Hebrew, English, plain-language explanations, area, risk, aliases, contexts, mistakes, questions, and sources.
2. Use official Israeli sources as citation anchors.
3. Add tests for exact Hebrew, alias, search, text detection, and Markdown rendering.
4. Add a scenario to `references/test-scenarios.md`.
5. Run `pytest`.
6. Run `python -m compileall scripts/ -q`.
