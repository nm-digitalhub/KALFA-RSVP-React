#!/usr/bin/env bash
# install.sh - turn the shared desktop's ticket login on or off. DRY RUN unless you say --apply.
#
#   sudo bash ops/rdpgw/xrdp-ticket/install.sh                  show exactly what would change (a diff), change nothing
#   sudo bash ops/rdpgw/xrdp-ticket/install.sh --apply          make the change
#   sudo bash ops/rdpgw/xrdp-ticket/install.sh --rollback       show how to undo it (dry run)
#   sudo bash ops/rdpgw/xrdp-ticket/install.sh --rollback --apply
#   ... --rollback --apply --purge                              also remove the helper, the header file and the app secrets
#
# WHAT --apply DOES (each step is skipped if it is already done, so running it twice changes nothing the second time):
#   1. installs the PAM helper to /usr/local/sbin/kalfa-xrdp-ticket (root:root, 0755)
#   2. generates the two ticket secrets (never printed) and writes
#        - the app's two variables into <repo>/.env.local   (RDPGW_XRDP_TICKET_SECRET, RDPGW_XRDP_CHECK_SECRET)
#        - the helper's header file /etc/kalfa/xrdp-ticket.header (root:root, 0600)
#   3. adds ONE line to /etc/pam.d/xrdp-sesman, before `@include common-auth` (backup first)
#   4. sets `enable_token_login=true` in the [Globals] section of /etc/xrdp/xrdp.ini (backup first)
#
# WHAT IT NEVER DOES: restart or reload anything (it prints the commands), change the firewall, nginx, the gateway, the
# application's code or the existing password login. PAM reads its configuration on every login, so step 3 needs no
# restart. Step 4 only takes effect after xrdp is restarted, and the app only sees step 2 after it is restarted: do the
# app first (so a ticket can be checked), xrdp last.
#
# Everything it touches can be redirected with KALFA_* variables (see the top of the code), which is how test.sh runs
# it against copies. KALFA_ALLOW_NON_ROOT=1 exists for that and for nothing else.
set -euo pipefail
umask 077

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)

PAM_FILE=${KALFA_PAM_FILE:-/etc/pam.d/xrdp-sesman}
XRDP_INI=${KALFA_XRDP_INI:-/etc/xrdp/xrdp.ini}
HELPER_DEST=${KALFA_HELPER_DEST:-/usr/local/sbin/kalfa-xrdp-ticket}
ETC_DIR=${KALFA_ETC_DIR:-/etc/kalfa}
APP_ENV=${KALFA_APP_ENV:-$REPO/.env.local}
HEADER_FILE="$ETC_DIR/xrdp-ticket.header"
BACKUP_DIR="$ETC_DIR/backup"
TS=$(date -u +%Y%m%dT%H%M%SZ)

MARKER='# kalfa-xrdp-ticket: staff ticket login (ops/rdpgw/xrdp-ticket). Remove this line and the next to turn it off.'
PAM_LINE="auth sufficient pam_exec.so quiet expose_authtok $HELPER_DEST"
INI_KEY='enable_token_login'
ENV_TICKET='RDPGW_XRDP_TICKET_SECRET'
ENV_CHECK='RDPGW_XRDP_CHECK_SECRET'

APPLY=0; ROLLBACK=0; PURGE=0
for arg in "$@"; do
  case $arg in
    --apply) APPLY=1 ;;
    --rollback) ROLLBACK=1 ;;
    --purge) PURGE=1 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ "$PURGE" -eq 0 ] || [ "$ROLLBACK" -eq 1 ] || { echo "--purge only goes with --rollback" >&2; exit 2; }

if [ "${KALFA_ALLOW_NON_ROOT:-0}" != 1 ]; then
  [ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0 $*" >&2; exit 1; }
fi
OWNER_ARGS=(-o root -g root); [ "${KALFA_ALLOW_NON_ROOT:-0}" != 1 ] || OWNER_ARGS=()

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
say() { printf '%s\n' "$*"; }
mode_word() { [ "$APPLY" -eq 1 ] && echo APPLY || echo "DRY RUN (nothing is changed; add --apply)"; }

# --- pure text transforms: stdin -> stdout, they never touch the real files -------------------------------------------

pam_add() { # insert marker + line before the first `@include common-auth`; exit 3 if there is none
  awk -v marker="$MARKER" -v line="$PAM_LINE" '
    !done && $0 ~ /^[[:space:]]*@include[[:space:]]+common-auth([[:space:]]|$)/ { print marker; print line; done = 1 }
    { print }
    END { if (!done) exit 3 }'
}
pam_remove() { # drop exactly the two lines this script added
  awk -v marker="$MARKER" -v line="$PAM_LINE" '$0 == marker || $0 == line { next } { print }'
}
ini_enable() { # in [Globals]: uncomment or set enable_token_login=true; exit 3 if there is no [Globals]
  awk -v key="$INI_KEY" '
    /^\[/ { if (inglobals && !set) { print key "=true"; set = 1 } inglobals = ($0 == "[Globals]"); seen = seen || inglobals }
    inglobals && $0 ~ "^[#;]?[[:space:]]*" key "[[:space:]]*=" { if (!set) { print key "=true"; set = 1 } next }
    { print }
    END { if (!seen) exit 3; if (inglobals && !set) print key "=true" }'
}
ini_disable() { # put the setting back the way the package ships it: commented out
  awk -v key="$INI_KEY" '
    /^\[/ { inglobals = ($0 == "[Globals]") }
    inglobals && $0 ~ "^[[:space:]]*" key "[[:space:]]*=" { print "#" key "=true"; next }
    { print }'
}

# --- state ------------------------------------------------------------------------------------------------------------

has_line() { [ -f "$2" ] && grep -qxF -- "$1" "$2"; }
env_has() { [ -f "$APP_ENV" ] && grep -q "^$1=." "$APP_ENV"; }
env_value() { sed -n "s/^$1=//p" "$APP_ENV" | head -n1; }
ini_enabled() { [ -f "$XRDP_INI" ] && awk -v key="$INI_KEY" '/^\[/{g=($0=="[Globals]")} g && $0 ~ "^[[:space:]]*" key "[[:space:]]*=[[:space:]]*true[[:space:]]*$"{f=1} END{exit !f}' "$XRDP_INI"; }

show_diff() { # name current new
  if cmp -s "$2" "$3"; then say "  $1: already as wanted"; return 1; fi
  say "  $1: would change:"; diff -u --label "$1 (now)" --label "$1 (after)" "$2" "$3" | sed 's/^/    /' || true
  return 0
}

backup() { # file
  install -d -m 0700 "${OWNER_ARGS[@]}" "$BACKUP_DIR"
  cp -p -- "$1" "$BACKUP_DIR/$(basename "$1").$TS"
  say "  backup: $BACKUP_DIR/$(basename "$1").$TS"
}

replace_file() { # file newcontent  (same mode and owner as the old file, atomic rename in the same directory)
  local target=$1 new=$2 tmp
  tmp=$(mktemp "$(dirname "$target")/.kalfa-new.XXXXXX")
  cat "$new" > "$tmp"
  chmod --reference="$target" "$tmp"
  chown --reference="$target" "$tmp" 2>/dev/null || true
  mv -f -- "$tmp" "$target"
}

# --- apply ------------------------------------------------------------------------------------------------------------

do_apply() {
  say "== ticket login: install ($(mode_word))"
  [ -f "$HERE/kalfa-xrdp-ticket" ] && bash -n "$HERE/kalfa-xrdp-ticket" || { say "the helper script is missing or has a syntax error"; exit 1; }
  [ -f "$PAM_FILE" ] || { say "no PAM file at $PAM_FILE"; exit 1; }
  [ -f "$XRDP_INI" ] || { say "no xrdp.ini at $XRDP_INI"; exit 1; }
  local curl_version; curl_version=$(curl --version 2>/dev/null | head -n1 | awk '{print $2}')
  [ -n "$curl_version" ] && [ "$(printf '%s\n7.55.0\n' "$curl_version" | sort -V | head -n1)" = 7.55.0 ] \
    || { say "needs curl 7.55 or newer (the helper reads headers from a file): found '${curl_version:-none}'"; exit 1; }

  # a half-set pair of secrets is a mistake to fix by hand, not something to paper over
  local have_ticket=0 have_check=0
  env_has "$ENV_TICKET" && have_ticket=1; env_has "$ENV_CHECK" && have_check=1
  if [ $((have_ticket + have_check)) -eq 1 ]; then
    say "only one of $ENV_TICKET / $ENV_CHECK is set in $APP_ENV: fix that first (both or neither)"; exit 1
  fi
  [ -f "$APP_ENV" ] || { say "no application environment file at $APP_ENV"; exit 1; }

  local changed=0

  # 1. helper
  if cmp -s "$HERE/kalfa-xrdp-ticket" "$HELPER_DEST" 2>/dev/null; then say "  helper: already installed"
  else say "  helper: would install $HELPER_DEST (root:root 0755)"; changed=1; fi

  # 2. secrets: app env + header file
  if [ "$have_ticket" -eq 1 ]; then say "  app secrets: already in $APP_ENV (kept)"
  else say "  app secrets: would append $ENV_TICKET and $ENV_CHECK to $APP_ENV (values generated, never shown)"; changed=1; fi
  if [ "$have_ticket" -eq 1 ] && [ -f "$HEADER_FILE" ] && grep -qxF "Authorization: Bearer $(env_value "$ENV_CHECK")" "$HEADER_FILE"; then
    say "  header file: already in place"
  else say "  header file: would write $HEADER_FILE (root:root 0600)"; changed=1; fi

  # 3. PAM
  if has_line "$PAM_LINE" "$PAM_FILE"; then say "  PAM: already has the line"
  else
    pam_add < "$PAM_FILE" > "$WORK/pam.new" || { say "  PAM: no '@include common-auth' line in $PAM_FILE: refusing to guess where to insert"; exit 1; }
    show_diff "$PAM_FILE" "$PAM_FILE" "$WORK/pam.new" && changed=1
  fi

  # 4. xrdp.ini
  if ini_enabled; then say "  xrdp.ini: $INI_KEY already true"
  else
    ini_enable < "$XRDP_INI" > "$WORK/ini.new" || { say "  xrdp.ini: no [Globals] section"; exit 1; }
    show_diff "$XRDP_INI" "$XRDP_INI" "$WORK/ini.new" && changed=1
  fi

  [ "$changed" -eq 1 ] || { say "== nothing to do"; return 0; }
  [ "$APPLY" -eq 1 ] || { say "== dry run only. To apply: sudo bash $0 --apply"; return 0; }

  # --- the writes. The order is deliberate: nothing that can let a ticket in is switched on before everything it needs.
  install -d -m 0700 "${OWNER_ARGS[@]}" "$ETC_DIR"
  if ! cmp -s "$HERE/kalfa-xrdp-ticket" "$HELPER_DEST" 2>/dev/null; then
    install -d -m 0755 "$(dirname "$HELPER_DEST")"
    install -m 0755 "${OWNER_ARGS[@]}" "$HERE/kalfa-xrdp-ticket" "$HELPER_DEST"; say "  installed $HELPER_DEST"
  fi
  if [ "$have_ticket" -eq 0 ]; then
    local ticket_secret check_secret
    ticket_secret=$(openssl rand -hex 32); check_secret=$(openssl rand -hex 32)
    { printf '\n# Desktop ticket login (ops/rdpgw/xrdp-ticket). Remove both lines to switch it off: every ticket is then refused.\n'
      printf '%s=%s\n%s=%s\n' "$ENV_TICKET" "$ticket_secret" "$ENV_CHECK" "$check_secret"; } >> "$APP_ENV"
    printf 'Authorization: Bearer %s\n' "$check_secret" > "$WORK/header"
    unset ticket_secret check_secret
    say "  appended the two secrets to $APP_ENV"
  else
    printf 'Authorization: Bearer %s\n' "$(env_value "$ENV_CHECK")" > "$WORK/header"
  fi
  if ! { [ -f "$HEADER_FILE" ] && cmp -s "$WORK/header" "$HEADER_FILE"; }; then
    install -m 0600 "${OWNER_ARGS[@]}" "$WORK/header" "$HEADER_FILE"; say "  wrote $HEADER_FILE"
  fi
  if ! has_line "$PAM_LINE" "$PAM_FILE"; then
    backup "$PAM_FILE"; replace_file "$PAM_FILE" "$WORK/pam.new"; say "  PAM line added (takes effect on the next login, no restart)"
  fi
  if ! ini_enabled; then
    backup "$XRDP_INI"; replace_file "$XRDP_INI" "$WORK/ini.new"; say "  xrdp.ini updated (takes effect after xrdp is restarted)"
  fi

  say "== done. Nothing was restarted. Next, in this order:"
  say "   1. deploy / restart the app so it reads the new secrets:   (your usual deploy)"
  say "   2. restart xrdp ONLY when nobody needs the live desktop for a minute:   sudo systemctl restart xrdp"
  say "      (sesman, which owns the shared session, is not restarted; whether session :10 survives is verified on the first try)"
  say "   rollback: sudo bash $0 --rollback --apply"
}

# --- rollback ---------------------------------------------------------------------------------------------------------

do_rollback() {
  say "== ticket login: rollback ($(mode_word))"
  local changed=0
  if has_line "$PAM_LINE" "$PAM_FILE" || has_line "$MARKER" "$PAM_FILE"; then
    pam_remove < "$PAM_FILE" > "$WORK/pam.new"; show_diff "$PAM_FILE" "$PAM_FILE" "$WORK/pam.new" && changed=1
  else say "  PAM: nothing of ours in $PAM_FILE"; fi
  if ini_enabled; then
    ini_disable < "$XRDP_INI" > "$WORK/ini.new"; show_diff "$XRDP_INI" "$XRDP_INI" "$WORK/ini.new" && changed=1
  else say "  xrdp.ini: $INI_KEY is not enabled"; fi
  if [ "$PURGE" -eq 1 ]; then
    [ -e "$HELPER_DEST" ] && { say "  would delete $HELPER_DEST"; changed=1; }
    [ -e "$HEADER_FILE" ] && { say "  would delete $HEADER_FILE"; changed=1; }
    if env_has "$ENV_TICKET" || env_has "$ENV_CHECK"; then say "  would remove $ENV_TICKET and $ENV_CHECK from $APP_ENV"; changed=1; fi
  else
    say "  (the helper, the header file and the app secrets are left in place: harmless without the PAM line; add --purge to remove them)"
  fi
  [ "$changed" -eq 1 ] || { say "== nothing to do"; return 0; }
  [ "$APPLY" -eq 1 ] || { say "== dry run only. To apply: sudo bash $0 --rollback --apply"; return 0; }

  if [ -s "$WORK/pam.new" ] && has_line "$PAM_LINE" "$PAM_FILE"; then backup "$PAM_FILE"; replace_file "$PAM_FILE" "$WORK/pam.new"; say "  PAM line removed"; fi
  if [ -s "$WORK/ini.new" ] && ini_enabled; then backup "$XRDP_INI"; replace_file "$XRDP_INI" "$WORK/ini.new"; say "  xrdp.ini setting commented out"; fi
  if [ "$PURGE" -eq 1 ]; then
    rm -f -- "$HELPER_DEST" "$HEADER_FILE"
    if [ -f "$APP_ENV" ]; then
      grep -v -e "^$ENV_TICKET=" -e "^$ENV_CHECK=" -e '^# Desktop ticket login (ops/rdpgw/xrdp-ticket)' "$APP_ENV" > "$WORK/env.new" || true
      replace_file "$APP_ENV" "$WORK/env.new"
    fi
    say "  helper, header file and app secrets removed"
  fi
  say "== done. Nothing was restarted. To make xrdp forget the setting: sudo systemctl restart xrdp (and deploy the app if you used --purge)."
  say "   Fastest way to refuse every ticket without touching the server: remove the two variables from the app's environment and restart the app."
}

if [ "$ROLLBACK" -eq 1 ]; then do_rollback; else do_apply; fi
