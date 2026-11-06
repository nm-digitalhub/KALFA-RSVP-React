# Changelog

All notable changes are documented in this file.

The format follows Keep a Changelog, and versioning follows semantic versioning.


## [2.2.0] - 03/06/2026

### Added

- Added `references/verification-log.md` with two-pass web validation for official Israeli sources, current rates, thresholds, fees, endpoint applicability, and webhook applicability.
- Added current-value verification notes to the English and Hebrew skill guides for VAT, VAT-exempt dealer ceiling, minimum wage, consumer cancellation fees, and small-claims fees.
- Added web-validated current-values table to `references/api-reference.md`.

### Changed

- Bumped metadata and package version to `2.2.0`.
- Updated legal-source URLs in the client from generic catalog pages to exact official law or regulator pages where available.
- Updated the workflow invoice example from ₪1,170 to ₪1,180 to align with the confirmed 18% standard VAT rate from 01/01/2025.
- Corrected the Hebrew year reference for the Contracts Remedies Law from 1970 to התשלא-1970.

### Verification findings

- Pass 1 confirmed the standard VAT rate, VAT-exempt dealer 2026 ceiling, minimum wage values, cancellation-fee reference, small-claims fee, privacy database notice trigger, and Knesset source catalog.
- Pass 2 double-confirmed all Pass 1 rows through different official or independent legal-information sources where available.
- No webhook event names apply because the package is local and has no external service integration.
- No package API host is used at runtime; Knesset OData was verified only as a public official data source and documented as not called by this package.

## [2.1.0] - 03/06/2026

### Added

- Added installable `hebrew_legal_term_translator` package so `from hebrew_legal_term_translator import HebrewLegalTermTranslator` works after `pip install -e .`.
- Added underscored client helper at `scripts/hebrew_legal_term_translator_client.py`.
- Added branding audit report and Hebrew quality log under `references/`.
- Added environment-aware runnable examples that accept `--env sandbox|production` and print JSON with `ensure_ascii=False`.
- Added CLI environment labels and package console script entry point.
- Added tests for package imports, async methods, CLI JSON output, examples, and naming cleanup.

### Changed

- Bumped metadata and package version to `2.1.0`.
- Replaced hyphenated client implementation with an importable package implementation.
- Updated README install steps to use `pip install -e .` and `pip install -r requirements-dev.txt`.
- Updated quick start to extract a term identifier from the first response and reuse it in the next lookup.
- Tightened Hebrew wording, date localization, and public Markdown formatting.

### Fixed

- Removed non-importable hyphenated client filename.
- Removed public Markdown emoji, visual-status references, and distribution branding.
- Preserved the neutral MIT license holder required for this package.

## [2.0.0] - 03/06/2026

### Added

- Added bilingual skill guides, source references, workflows, troubleshooting, tests, examples, and local CLI.
- Added structured glossary entries for Israeli tax, consumer, contract, employment, privacy, debt, procedure, companies, and finance contexts.
