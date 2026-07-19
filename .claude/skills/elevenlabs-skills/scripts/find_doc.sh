#!/usr/bin/env bash
# Find ElevenLabs doc pages by keyword WITHOUT loading the ~15K-token index into context.
# Usage: find_doc.sh <grep-pattern>   e.g. find_doc.sh 'websocket'  |  find_doc.sh 'twilio'
# Prints matching "Title (url.mdx)" lines. Fetch the winning .mdx URL next.
set -euo pipefail
IDX="${TMPDIR:-/tmp}/elevenlabs-llms.txt"
if [ ! -s "$IDX" ] || [ -n "$(find "$IDX" -mmin +1440 2>/dev/null)" ]; then
  curl -fsSL https://elevenlabs.io/docs/llms.txt -o "$IDX"
fi
grep -i -- "$1" "$IDX" || { echo "No match for: $1 — try a broader pattern"; exit 1; }
