# Other file formats

For i18next JSON, use the folder options in `SKILL.md`. For any other format, name the files:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/check_translations.mjs --source en --target-file fr=locale/fr.po
node ${CLAUDE_SKILL_DIR}/scripts/check_translations.mjs --source en --source-file lib/l10n/en.arb --target-file fr=lib/l10n/fr.arb
```

`--target-file` can repeat, once per language. The format comes from the extension, or from `--format`.

| Format | Extension | Source text | Placeholders checked | Also reported |
|--------|-----------|-------------|----------------------|---------------|
| i18next JSON | `.json` | `--source-file` | Not with `--target-file`. Use the folder options, which run `i18next-cli lint` | |
| ICU JSON (react-intl, next-intl) | `.json` with `--format icu` | `--source-file` | `{name}` arguments | Invalid ICU, missing plural cases |
| ARB (Flutter) | `.arb` | `--source-file` | `{name}` arguments, `@` metadata skipped | Invalid ICU, missing plural cases |
| PO, POT (gettext) | `.po`, `.pot` | In the file | `%s`, `%d`, `%(name)s`, `{name}` | Fuzzy entries, as `unfinished` |
| XLIFF 1.2 and 2.x | `.xlf`, `.xliff` | In the file | Inline tags by `id` | `state` of new or needs-work, as `unfinished` |
| YAML (Rails) | `.yml`, `.yaml` | `--source-file` | `%{name}` | Needs the `yaml` package in the project |
| Apple strings | `.strings` | `--source-file` | `%@`, `%d`, `%1$@` | |
| .NET | `.resx` | `--source-file` | `{0}` | Binary resources skipped |

Every format gets the same text checks as i18next JSON: coverage, numbers, addresses, length, punctuation, and the French rules.

`--dump` and `--review` work with `--target-file` too. The code scan and `--changed-since` don't: the scan reads i18next `t()` calls, and `--changed-since` works on folders.

An entry marked fuzzy or not final does not count as translated, because a compiled file leaves it out and readers see the source.

For PO files, also run `msgfmt --check` when it is installed. It reports header problems the script doesn't, but it compares placeholders only for entries flagged `c-format`, so a clean run does not replace the script's check. An entry whose text varies by count needs `msgid_plural` in the source: without it, `1 new messages` can't be fixed by the translator, so report it as a source problem.
