#!/usr/bin/env bash
# Tests for kalfa-xrdp-ticket, run against a FAKE curl: nothing is installed, no network is used, no port is opened.
#   bash ops/rdpgw/xrdp-ticket/test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
HELPER="$HERE/kalfa-xrdp-ticket"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

TICKET="k1.$(printf 'A%.0s' $(seq 1 38))"
SECRET='s3cr3t-header-value-that-must-never-leak'
PASS=0
FAIL=0

# the fake curl records how it was called and answers what the test says
cat > "$WORK/curl" <<'FAKE'
#!/usr/bin/env bash
echo called >> "$FAKE_DIR/calls"
printf '%s\n' "$@" > "$FAKE_DIR/argv"
cat > "$FAKE_DIR/stdin"
# what the header file said at the moment curl was run (the real curl reads it itself)
for a in "$@"; do case $a in @/*) [ -f "${a#@}" ] && cp "${a#@}" "$FAKE_DIR/header-used";; esac; done
[ -n "${FAKE_FAIL:-}" ] && exit "$FAKE_FAIL"
printf '%s' "${FAKE_ANSWER-}"
FAKE
chmod 0755 "$WORK/curl"
printf 'Authorization: Bearer %s\n' "$SECRET" > "$WORK/header"
chmod 0600 "$WORK/header"

# run INPUT USER ANSWER -> sets STATUS, OUT (stdout+stderr) and CALLS
run() {
  local input=$1 user=$2 answer=$3
  rm -f "$WORK/calls" "$WORK/argv" "$WORK/stdin" "$WORK/header-used"
  OUT=$(printf '%b' "$input" | env -i PATH="$PATH" FAKE_DIR="$WORK" FAKE_ANSWER="$answer" FAKE_FAIL="${FAKE_FAIL:-}" \
    PAM_USER="$user" KALFA_XRDP_TICKET_CURL="$WORK/curl" KALFA_XRDP_TICKET_HEADER_FILE="${HEADER_FILE:-$WORK/header}" \
    ${URL_OVERRIDE:+KALFA_XRDP_TICKET_URL="$URL_OVERRIDE"} bash "$HELPER" 2>&1)
  STATUS=$?
  CALLS=0; [ -f "$WORK/calls" ] && CALLS=$(wc -l < "$WORK/calls")
}

check() { # name, condition result (0 = ok)
  if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $1"; fi
}
expect_deny() { # name
  check "$1: exit 1" "$([ "$STATUS" -eq 1 ]; echo $?)"
  check "$1: prints nothing" "$([ -z "$OUT" ]; echo $?)"
}
expect_deny_no_call() {
  expect_deny "$1"
  check "$1: no network call" "$([ "$CALLS" -eq 0 ]; echo $?)"
}
ALLOW='{"allow":true}'

# --- the allow path
run "$TICKET\\0" desktopuser "$ALLOW"
check "allow: exit 0" "$([ "$STATUS" -eq 0 ]; echo $?)"
check "allow: prints nothing" "$([ -z "$OUT" ]; echo $?)"
check "allow: one call" "$([ "$CALLS" -eq 1 ]; echo $?)"
check "allow: body carries ticket and user" "$([ "$(cat "$WORK/stdin")" = "{\"ticket\":\"$TICKET\",\"user\":\"desktopuser\"}" ]; echo $?)"
check "allow: ticket NOT in the command line" "$(! grep -qF "$TICKET" "$WORK/argv"; echo $?)"
check "allow: secret NOT in the command line" "$(! grep -qF "$SECRET" "$WORK/argv"; echo $?)"
check "allow: header file passed by path" "$(grep -q "^@$WORK/header\$" "$WORK/argv"; echo $?)"
check "allow: fixed loopback url" "$(grep -q '^http://127.0.0.1:3002/api/internal/rdp-gateway/xrdp-ticket$' "$WORK/argv"; echo $?)"
check "allow: bounded time" "$(grep -qx -- '--max-time' "$WORK/argv" && grep -qx '2' "$WORK/argv"; echo $?)"
check "allow: no proxy, http only" "$(grep -qx -- '--noproxy' "$WORK/argv" && grep -qx -- '--proto' "$WORK/argv"; echo $?)"

run "$TICKET\\n" desktopuser "$ALLOW";  check "allow with newline terminator" "$([ "$STATUS" -eq 0 ]; echo $?)"
run "$TICKET\\r\\n" desktopuser "$ALLOW"; check "allow with CRLF terminator" "$([ "$STATUS" -eq 0 ]; echo $?)"
run "$TICKET" desktopuser "$ALLOW";      check "allow with no terminator" "$([ "$STATUS" -eq 0 ]; echo $?)"
run "$TICKET\\0" "kalfa.me" "$ALLOW";    check "allow for a dotted account name" "$([ "$STATUS" -eq 0 ]; echo $?)"

# --- anything that is not a ticket never reaches the network (a real password must not leave this machine)
for input in '' 'hunter2\0' 'correct horse battery staple\0' "${TICKET}x\\0" "${TICKET%?}\\0" "k2.${TICKET#k1.}\\0" \
  "$TICKET\\nsecond-line\\0" "$TICKET\\0extra" 'k1.\0' "k1.$(printf '!%.0s' $(seq 1 38))\\0" \
  "$(printf 'A%.0s' $(seq 1 300))\\0" "k1.$(printf 'A%.0s' $(seq 1 200))\\0"; do
  run "$input" desktopuser "$ALLOW"
  expect_deny_no_call "not a ticket (${input:0:24})"
done

# --- the account
for user in '' 'a b' 'a;b' 'a$(id)' '-x' '1abc' "$(printf 'a%.0s' $(seq 1 40))" 'a"b' 'a\\b'; do
  run "$TICKET\\0" "$user" "$ALLOW"
  expect_deny_no_call "bad PAM_USER '${user:0:20}'"
done

# --- the answer: only the exact allow text lets the login in
for answer in '' '{"allow":false}' '{"allow":true} ' ' {"allow":true}' '{"allow": true}' '{"allow":true,"grantId":"x"}' 'allow' '<html>502</html>' '{"allow":"true"}'; do
  run "$TICKET\\0" desktopuser "$answer"
  expect_deny "answer '${answer:0:24}'"
done
for code in 6 7 28 52; do
  FAKE_FAIL=$code run "$TICKET\\0" desktopuser "$ALLOW"
  expect_deny "curl exit $code"
done

# --- the secret file
HEADER_FILE="$WORK/missing" run "$TICKET\\0" desktopuser "$ALLOW"; expect_deny_no_call "missing header file"
cp "$WORK/header" "$WORK/open"; chmod 0644 "$WORK/open"
HEADER_FILE="$WORK/open" run "$TICKET\\0" desktopuser "$ALLOW"; expect_deny_no_call "group/world-readable header file"
chmod 0660 "$WORK/open"
HEADER_FILE="$WORK/open" run "$TICKET\\0" desktopuser "$ALLOW"; expect_deny_no_call "group-writable header file"
ln -s "$WORK/header" "$WORK/link"
HEADER_FILE="$WORK/link" run "$TICKET\\0" desktopuser "$ALLOW"; expect_deny_no_call "symlinked header file"
HEADER_FILE="$WORK" run "$TICKET\\0" desktopuser "$ALLOW"; expect_deny_no_call "header path is a directory"
HEADER_FILE="" run "$TICKET\\0" desktopuser "$ALLOW"; check "empty header path falls back to the default (absent here)" "$([ "$STATUS" -eq 1 ] || [ "$STATUS" -eq 0 ]; echo $?)"

# --- the url can only be loopback
for url in 'http://example.com:3002/api/internal/rdp-gateway/xrdp-ticket' 'https://127.0.0.1:3002/api/internal/rdp-gateway/xrdp-ticket' \
  'http://127.0.0.1.evil.test:3002/api/internal/rdp-gateway/xrdp-ticket' 'http://user@127.0.0.1:3002/api/internal/rdp-gateway/xrdp-ticket' \
  'http://127.0.0.1:3002/api/internal/rdp-gateway/tunnel-check' 'http://127.0.0.1:3002/api/internal/rdp-gateway/xrdp-ticket?x=1' \
  'http://localhost:3002/api/internal/rdp-gateway/xrdp-ticket'; do
  URL_OVERRIDE=$url run "$TICKET\\0" desktopuser "$ALLOW"
  expect_deny_no_call "url $url"
done
URL_OVERRIDE='http://[::1]:3002/api/internal/rdp-gateway/xrdp-ticket' run "$TICKET\\0" desktopuser "$ALLOW"
check "ipv6 loopback is allowed" "$([ "$STATUS" -eq 0 ]; echo $?)"

# --- the script itself never prints the ticket or the secret, whatever happens
run "$TICKET\\0" desktopuser '{"allow":false}'
check "refusal output has no ticket or secret" "$(! printf '%s' "$OUT" | grep -qE "$SECRET|k1\\."; echo $?)"

echo "passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ]
