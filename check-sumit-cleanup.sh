#!/usr/bin/env bash
set -Eeuo pipefail
if ! command -v git >/dev/null 2>&1; then
  printf '%s\n' '[X] git is required.' >&2
  exit 2
fi
if ! command -v rg >/dev/null 2>&1; then
  printf '%s\n' '[X] ripgrep (rg) is required.' >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '[X] node is required.' >&2
  exit 2
fi
root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf '%s\n' '[X] Run this script inside the Git repository.' >&2
  exit 2
}
cd "$root"
if [[ "$#" -ne 1 ]]; then
  printf '%s\n' \
    'Usage:' \
    '  bash check-sumit-cleanup.sh column1,column2,column3,column4,column5' \
    '' \
    'Pass the five exact campaigns column names as one comma-separated argument.' >&2
  exit 2
fi
columns="$1"
if ! [[ "$columns" =~ ^[a-zA-Z_][a-zA-Z0-9_]*(,[a-zA-Z_][a-zA-Z0-9_]*){4}$ ]]; then
  printf '%s\n' '[X] Provide exactly five comma-separated SQL column names.' >&2
  exit 2
fi
column_script="scripts/find-legacy-campaign-payment-columns.mjs"
if [[ ! -f "$column_script" ]]; then
  printf '[X] Missing column scanner: %s\n' "$column_script" >&2
  exit 2
fi
# Exclude this wrapper from its own searches, including when it is stored
# inside the repository. Resolve symlinks using Node, which is already required.
self_path="$(
  node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$0"
)"
self_relative=""
case "$self_path" in
  "$root"/*) self_relative="${self_path#"$root"/}" ;;
esac
patterns=(
  'sumit-test'
  'safe-preview'
  'charge-response'
  'sumit-doc-check'
  '/admin/sumit-test'
  '/api/admin/sumit-test'
  'listChargeableCampaigns'
  'resolveSavedCardForCampaign'
  'listTestHolds'
  'recordSumitTestTransaction'
  'getTestHoldForCapture'
  'summarizeSumitRequest'
  'summarizeSumitResponse'
  'mapSumitChargeResponse'
  'sumit_test_transactions'
)
rg_options=(
  --hidden
  --no-ignore
  --glob '!.git/**'
  --glob '!**/node_modules/**'
  --glob '!**/.next/**'
  --glob '!**/.next-*/**'
  --glob '!**/dist/**'
  --glob '!**/build/**'
  --glob '!**/coverage/**'
  --glob '!**/.turbo/**'
)
if [[ -n "$self_relative" ]]; then
  rg_options+=(--glob "!/$self_relative")
fi
pattern_args=()
for pattern in "${patterns[@]}"; do
  pattern_args+=(-e "$pattern")
done
printf '\n%s\n' '=== Repository ==='
printf '%s\n' "$root"
printf '\n%s\n' '=== Content matches ==='
printf '%s\n' 'Review each result as LIVE, HISTORICAL, or NEEDS REVIEW.'
printf '%s\n\n' 'Matching a name alone does not prove the reference is live.'
set +e
rg \
  "${rg_options[@]}" \
  --line-number \
  --column \
  --fixed-strings \
  --color never \
  "${pattern_args[@]}" \
  .
content_status=$?
set -e
if [[ "$content_status" -eq 1 ]]; then
  printf '%s\n' '[OK] No matching text found.'
elif [[ "$content_status" -ne 0 ]]; then
  printf '[X] Content search failed with exit code %s.\n' "$content_status" >&2
  exit "$content_status"
fi
printf '\n%s\n' '=== Matching file and directory paths ==='
set +e
rg \
  "${rg_options[@]}" \
  --files \
  -0 \
  . |
  node -e '
    const chunks = [];
    process.stdin.on("data", c => chunks.push(c));
    process.stdin.on("end", () => {
      const names = Buffer.concat(chunks).toString("utf8").split("\0");
      const needles = ["sumit-test", "safe-preview", "charge-response", "sumit-doc-check"];
      let count = 0;
      for (const name of names) {
        if (name && needles.some(needle => name.includes(needle))) {
          console.log(JSON.stringify(name));
          count++;
        }
      }
      if (count === 0) console.log("[OK] No matching file paths found.");
    });
  '
path_status=("${PIPESTATUS[@]}")
set -e
if [[ "${path_status[0]}" -gt 1 || "${path_status[1]}" -ne 0 ]]; then
  printf '%s\n' '[X] File path search failed.' >&2
  exit 2
fi
printf '\n%s\n' '=== Campaign column analysis ==='
printf '%s\n' 'The existing scanner checks code and grades its confidence.'
printf '%s\n' 'Review confirmed, likely, ambiguous, and weak results.'
printf '%s\n\n' 'Database objects are not queried by this wrapper.'
node "$column_script" --columns "$columns"
printf '\n%s\n' '=== Review required ==='
printf '%s\n' \
  'LIVE: code, configuration, or agent instructions that depend on removed items.' \
  'HISTORICAL: reviewed historical migrations, dated records, and change notes.' \
  'NEEDS REVIEW: ambiguous findings or references whose purpose is unclear.' \
  'A successful scan does not by itself prove that live findings are zero.'
