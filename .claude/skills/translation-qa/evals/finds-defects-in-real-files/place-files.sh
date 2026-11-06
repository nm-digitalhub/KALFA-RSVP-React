#!/usr/bin/env bash
# Builds the test files from the project's real translations, so the case stays small in git. Run from the project root.
set -eu
mkdir -p locales
for language in he en fr; do mkdir -p "locales/$language"; done
cp src/locales/he/*.json locales/he/
for language in en fr; do cp docs/translations/drafts/$language/public.json docs/translations/drafts/$language/whatsappErrors.json "locales/$language/"; done
python3 "$(dirname "$0")/plant-defects.py" locales
