#!/usr/bin/env bash
# Tests for install.sh against COPIES of the real PAM file and xrdp.ini. Nothing outside a temp directory is touched.
#   bash ops/rdpgw/xrdp-ticket/test-install.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
INSTALL="$HERE/install.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=0; FAIL=0
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $1"; fi; }

fresh() { # a new sandbox with copies of the real files and a fake app env
  rm -rf "$WORK/box"; mkdir -p "$WORK/box/etc" "$WORK/box/app"
  cp "${REAL_PAM:-/etc/pam.d/xrdp-sesman}" "$WORK/box/pam"
  cp "${REAL_INI:-/etc/xrdp/xrdp.ini}" "$WORK/box/xrdp.ini"
  cp "$WORK/box/pam" "$WORK/box/pam.orig"; cp "$WORK/box/xrdp.ini" "$WORK/box/xrdp.ini.orig"
  printf 'RDPGW_USER=desktopuser\nRDPGW_CHECK_SECRET=%s\nOTHER=1' "$(printf 'g%.0s' $(seq 1 40))" > "$WORK/box/app/.env.local"   # no trailing newline on purpose
  cp "$WORK/box/app/.env.local" "$WORK/box/env.orig"
  chmod 0640 "$WORK/box/app/.env.local"
}
inst() { # args... -> OUT, STATUS
  OUT=$(env -i PATH="$PATH" KALFA_ALLOW_NON_ROOT=1 KALFA_PAM_FILE="$WORK/box/pam" KALFA_XRDP_INI="$WORK/box/xrdp.ini" \
    KALFA_HELPER_DEST="$WORK/box/sbin/kalfa-xrdp-ticket" KALFA_ETC_DIR="$WORK/box/etc/kalfa" KALFA_APP_ENV="$WORK/box/app/.env.local" \
    bash "$INSTALL" "$@" 2>&1); STATUS=$?
}
same() { cmp -s "$1" "$2"; echo $?; }
PAM_LINE_RE='^auth sufficient pam_exec.so quiet expose_authtok .*/kalfa-xrdp-ticket$'

# --- dry run changes nothing and says what it would do
fresh; inst
check "dry run: exit 0" "$([ "$STATUS" -eq 0 ]; echo $?)"
check "dry run: pam untouched" "$(same "$WORK/box/pam" "$WORK/box/pam.orig")"
check "dry run: ini untouched" "$(same "$WORK/box/xrdp.ini" "$WORK/box/xrdp.ini.orig")"
check "dry run: env untouched" "$(same "$WORK/box/app/.env.local" "$WORK/box/env.orig")"
check "dry run: no helper, no etc dir" "$([ ! -e "$WORK/box/sbin" ] && [ ! -e "$WORK/box/etc/kalfa" ]; echo $?)"
check "dry run: says so" "$(grep -q 'dry run only' <<<"$OUT"; echo $?)"
check "dry run: shows the pam diff" "$(grep -q '+auth sufficient pam_exec.so' <<<"$OUT"; echo $?)"
check "dry run: shows the ini diff" "$(grep -q '+enable_token_login=true' <<<"$OUT"; echo $?)"

# --- apply
inst --apply
check "apply: exit 0" "$([ "$STATUS" -eq 0 ]; echo $?)"
check "apply: one pam line" "$([ "$(grep -cE "$PAM_LINE_RE" "$WORK/box/pam")" -eq 1 ]; echo $?)"
check "apply: the line is before common-auth" "$([ "$(grep -nE "$PAM_LINE_RE" "$WORK/box/pam" | cut -d: -f1)" -lt "$(grep -n '@include common-auth' "$WORK/box/pam" | cut -d: -f1)" ]; echo $?)"
check "apply: everything else in pam is unchanged" "$(diff <(grep -v -e kalfa-xrdp-ticket "$WORK/box/pam") "$WORK/box/pam.orig" >/dev/null; echo $?)"
check "apply: enable_token_login true exactly once, in [Globals]" "$([ "$(grep -c '^enable_token_login=true' "$WORK/box/xrdp.ini")" -eq 1 ] && [ "$(awk '/^\[/{g=($0=="[Globals]")} g&&/^enable_token_login=true/{print}' "$WORK/box/xrdp.ini" | wc -l)" -eq 1 ]; echo $?)"
check "apply: ini changed by one line only" "$([ "$(diff "$WORK/box/xrdp.ini" "$WORK/box/xrdp.ini.orig" | grep -c '^[<>]')" -eq 2 ]; echo $?)"
check "apply: helper installed executable and identical" "$([ -x "$WORK/box/sbin/kalfa-xrdp-ticket" ] && cmp -s "$HERE/kalfa-xrdp-ticket" "$WORK/box/sbin/kalfa-xrdp-ticket"; echo $?)"
check "apply: header file 0600 with a bearer line" "$([ "$(stat -c %a "$WORK/box/etc/kalfa/xrdp-ticket.header")" = 600 ] && grep -qE '^Authorization: Bearer [0-9a-f]{64}$' "$WORK/box/etc/kalfa/xrdp-ticket.header"; echo $?)"
check "apply: etc dir 0700" "$([ "$(stat -c %a "$WORK/box/etc/kalfa")" = 700 ]; echo $?)"
check "apply: app env kept its lines and mode" "$(grep -q '^OTHER=1$' "$WORK/box/app/.env.local" && grep -q '^RDPGW_USER=desktopuser$' "$WORK/box/app/.env.local" && [ "$(stat -c %a "$WORK/box/app/.env.local")" = 640 ]; echo $?)"
check "apply: two new secrets of 64 hex chars" "$([ "$(grep -cE '^RDPGW_XRDP_(TICKET|CHECK)_SECRET=[0-9a-f]{64}$' "$WORK/box/app/.env.local")" -eq 2 ]; echo $?)"
check "apply: the two secrets differ, and differ from the gateway's" "$([ "$(grep -E '^RDPGW_.*SECRET=' "$WORK/box/app/.env.local" | cut -d= -f2 | sort -u | wc -l)" -eq 3 ]; echo $?)"
check "apply: the header carries the CHECK secret" "$([ "$(sed -n 's/^Authorization: Bearer //p' "$WORK/box/etc/kalfa/xrdp-ticket.header")" = "$(sed -n 's/^RDPGW_XRDP_CHECK_SECRET=//p' "$WORK/box/app/.env.local")" ]; echo $?)"
check "apply: no secret value is printed" "$(! grep -qE '[0-9a-f]{40,}' <<<"$OUT"; echo $?)"
check "apply: backups made, with the old content" "$([ -f "$(ls "$WORK"/box/etc/kalfa/backup/pam.* | head -1)" ] && cmp -s "$(ls "$WORK"/box/etc/kalfa/backup/pam.* | head -1)" "$WORK/box/pam.orig"; echo $?)"
check "apply: tells the owner what to restart, and does not do it" "$(grep -q 'systemctl restart xrdp' <<<"$OUT" && grep -q 'Nothing was restarted' <<<"$OUT"; echo $?)"

# --- apply twice: nothing changes
cp "$WORK/box/pam" "$WORK/box/pam.1"; cp "$WORK/box/xrdp.ini" "$WORK/box/xrdp.ini.1"; cp "$WORK/box/app/.env.local" "$WORK/box/env.1"; cp "$WORK/box/etc/kalfa/xrdp-ticket.header" "$WORK/box/header.1"
inst --apply
check "again: exit 0, nothing to do" "$([ "$STATUS" -eq 0 ] && grep -q 'nothing to do' <<<"$OUT"; echo $?)"
check "again: pam same" "$(same "$WORK/box/pam" "$WORK/box/pam.1")"
check "again: ini same" "$(same "$WORK/box/xrdp.ini" "$WORK/box/xrdp.ini.1")"
check "again: env same (secrets kept, not regenerated)" "$(same "$WORK/box/app/.env.local" "$WORK/box/env.1")"
check "again: header same" "$(same "$WORK/box/etc/kalfa/xrdp-ticket.header" "$WORK/box/header.1")"

# --- rollback dry run, then rollback
inst --rollback
check "rollback dry run: changes nothing" "$(same "$WORK/box/pam" "$WORK/box/pam.1")"
inst --rollback --apply
check "rollback: pam byte-for-byte as it was" "$(same "$WORK/box/pam" "$WORK/box/pam.orig")"
check "rollback: ini byte-for-byte as it was" "$(same "$WORK/box/xrdp.ini" "$WORK/box/xrdp.ini.orig")"
check "rollback: secrets and helper left (harmless without the pam line)" "$([ -f "$WORK/box/etc/kalfa/xrdp-ticket.header" ] && [ -x "$WORK/box/sbin/kalfa-xrdp-ticket" ] && grep -q '^RDPGW_XRDP_CHECK_SECRET=' "$WORK/box/app/.env.local"; echo $?)"
inst --rollback --apply
check "rollback twice: nothing to do" "$(grep -q 'nothing to do' <<<"$OUT" || grep -q 'left in place' <<<"$OUT"; echo $?)"
inst --apply
check "re-apply after rollback works" "$(grep -qE "$PAM_LINE_RE" "$WORK/box/pam"; echo $?)"
inst --rollback --apply --purge
check "purge: pam back" "$(same "$WORK/box/pam" "$WORK/box/pam.orig")"
check "purge: helper and header gone" "$([ ! -e "$WORK/box/sbin/kalfa-xrdp-ticket" ] && [ ! -e "$WORK/box/etc/kalfa/xrdp-ticket.header" ]; echo $?)"
check "purge: app env has no ticket variables and keeps the rest" "$(! grep -q 'XRDP' "$WORK/box/app/.env.local" && grep -q '^OTHER=1$' "$WORK/box/app/.env.local" && grep -q '^RDPGW_USER=' "$WORK/box/app/.env.local"; echo $?)"

# --- refusals
fresh; printf '\nRDPGW_XRDP_TICKET_SECRET=%s\n' "$(printf 't%.0s' $(seq 1 64))" >> "$WORK/box/app/.env.local"
inst --apply
check "refuses a half-set pair of secrets, and changes nothing" "$([ "$STATUS" -ne 0 ] && grep -q 'both or neither' <<<"$OUT" && [ "$(same "$WORK/box/pam" "$WORK/box/pam.orig")" -eq 0 ]; echo $?)"
fresh; grep -v 'common-auth' "$WORK/box/pam.orig" > "$WORK/box/pam"
inst --apply
check "refuses a pam file with no common-auth include" "$([ "$STATUS" -ne 0 ] && grep -q 'refusing to guess' <<<"$OUT"; echo $?)"
fresh; grep -v '^\[Globals\]' "$WORK/box/xrdp.ini.orig" > "$WORK/box/xrdp.ini"
inst --apply
check "refuses an xrdp.ini with no [Globals]" "$([ "$STATUS" -ne 0 ] && grep -q 'no \[Globals\]' <<<"$OUT"; echo $?)"
fresh; rm -f "$WORK/box/app/.env.local"
inst --apply
check "refuses when the app environment file is missing" "$([ "$STATUS" -ne 0 ]; echo $?)"
fresh
OUT=$(env -i PATH="$PATH" KALFA_PAM_FILE="$WORK/box/pam" bash "$INSTALL" --apply 2>&1); STATUS=$?
if [ "$(id -u)" -ne 0 ]; then check "refuses to run as a normal user" "$([ "$STATUS" -eq 1 ] && grep -q 'run as root' <<<"$OUT"; echo $?)"; fi
inst --purge; check "--purge alone is refused" "$([ "$STATUS" -eq 2 ]; echo $?)"
inst --bogus; check "unknown argument is refused" "$([ "$STATUS" -eq 2 ]; echo $?)"

# --- the ini variants the package may ship
fresh; sed -i 's/^#enable_token_login=true/enable_token_login=false/' "$WORK/box/xrdp.ini"; cp "$WORK/box/xrdp.ini" "$WORK/box/xrdp.ini.orig"
inst --apply
check "ini: an explicit false becomes true" "$([ "$(grep -c '^enable_token_login=' "$WORK/box/xrdp.ini")" -eq 1 ] && grep -q '^enable_token_login=true' "$WORK/box/xrdp.ini"; echo $?)"
fresh; sed -i '/enable_token_login/d' "$WORK/box/xrdp.ini"; cp "$WORK/box/xrdp.ini" "$WORK/box/xrdp.ini.orig"
inst --apply
check "ini: with no line at all it is added at the end of [Globals]" "$(awk '/^\[/{g=($0=="[Globals]")} g&&/^enable_token_login=true/{f=1} END{exit !f}' "$WORK/box/xrdp.ini"; echo $?)"

echo "passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ]
