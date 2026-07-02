#!/usr/bin/env bash
set -u
set -o pipefail
umask 077

ROOT="${KALFA_ROOT:-/var/www/vhosts/kalfa.me/beta}"
DOMAIN="${KALFA_DOMAIN:-beta.kalfa.me}"
PORT="${KALFA_PORT:-3002}"
NO_FETCH="${NO_FETCH:-0}"
SKIP_SUDO="${SKIP_SUDO:-0}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

section() {
  printf '\n\n===== %s =====\n' "$*"
}

warn_if_failed() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '[WARN] previous command exited with %s\n' "$rc"
  fi
  return 0
}

[ -d "$ROOT/.git" ] || fail "Not a Git repository: $ROOT"
cd "$ROOT"

mkdir -p ops-evidence
chmod 700 ops-evidence

stamp="$(date +%Y%m%d-%H%M%S)"
report="ops-evidence/preflight-${stamp}.txt"
touch "$report"
chmod 600 "$report"

SUDO_OK=0
if [ "$SKIP_SUDO" != "1" ]; then
  printf 'Validating sudo once for nginx diagnostics...\n'
  if sudo -v; then
    SUDO_OK=1
  else
    printf '[WARN] sudo unavailable; nginx config/log sections will be skipped.\n'
  fi
fi

sudo_cmd() {
  if [ "$SUDO_OK" = "1" ]; then
    sudo -n "$@"
  else
    printf '[SKIP] sudo unavailable: %s\n' "$*"
    return 0
  fi
}

{
  section 'TIME'
  date -Is
  hostname
  whoami
  pwd

  section 'GIT'
  if [ "$NO_FETCH" = "1" ]; then
    echo 'git fetch skipped (NO_FETCH=1)'
  else
    git fetch origin --prune
    warn_if_failed
  fi

  echo "HEAD:        $(git rev-parse HEAD 2>/dev/null || echo unavailable)"
  echo "origin/main: $(git rev-parse origin/main 2>/dev/null || echo unavailable)"

  echo '-- status --'
  status="$(git status --porcelain=v1 2>/dev/null || true)"
  printf '%s\n' "${status:-clean}"

  echo '-- unstaged changes --'
  git diff --name-status || true

  echo '-- staged changes --'
  git diff --cached --name-status || true

  echo '-- untracked files --'
  untracked="$(git ls-files -o --exclude-standard 2>/dev/null || true)"
  printf '%s\n' "${untracked:-none}"

  echo '-- diff against origin/main --'
  git diff --name-status origin/main...HEAD || true

  echo '-- recent commits --'
  git log --oneline --decorate -n 12 || true

  section 'NEXT ARTIFACTS'
  ls -ld .next .next-stage .next.old dist 2>/dev/null || true
  for d in .next .next-stage .next.old; do
    if [ -f "$d/BUILD_ID" ]; then
      printf '%s BUILD_ID: ' "$d"
      cat "$d/BUILD_ID"
    fi
  done

  section 'MIGRATIONS ON DISK'
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' \
    -printf '%f\n' 2>/dev/null | sort | tail -n 20

  for file in \
    supabase/migrations/20260630223635_event_lifecycle_state_model.sql \
    supabase/migrations/20260630230249_event_lifecycle_trigger_revoke_public.sql
  do
    echo
    echo "-- $file --"

    if [ -f "$file" ]; then
      printf 'local sha256: '
      sha256sum "$file" | awk '{print $1}'
    else
      echo 'local: MISSING'
    fi

    if git cat-file -e "origin/main:${file}" 2>/dev/null; then
      printf 'origin/main sha256: '
      git show "origin/main:${file}" | sha256sum | awk '{print $1}'
    else
      echo 'origin/main: MISSING'
    fi
  done

  section 'LINKED SUPABASE MIGRATIONS'
  npx --no-install supabase migration list --linked
  warn_if_failed

  section 'PM2 WITHOUT ENVIRONMENT VARIABLES'
  if command -v pm2 >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    pm2 jlist | jq -r '
      .[]
      | select(.name == "kalfa-beta" or .name == "kalfa-worker")
      | {
          name,
          pm_id,
          pid,
          status: .pm2_env.status,
          exec_mode: .pm2_env.exec_mode,
          instances: .pm2_env.instances,
          cwd: .pm2_env.pm_cwd,
          script: .pm2_env.pm_exec_path,
          restart_time: .pm2_env.restart_time,
          unstable_restarts: .pm2_env.unstable_restarts
        }'
  else
    echo '[WARN] pm2 or jq is not available'
    pm2 status 2>/dev/null || true
  fi

  section 'NODE MEMORY DISK'
  node --version || true
  npm --version || true
  free -h || true
  df -hT / || true

  section "PORT ${PORT}"
  sudo_cmd ss -ltnp 2>/dev/null | grep -E ":${PORT}\b" || true

  section 'LOCAL NEXT RESPONSE'
  curl -sS \
    --connect-timeout 2 \
    --max-time 5 \
    -H "Host: ${DOMAIN}" \
    -o /dev/null \
    -w 'HTTP %{http_code} in %{time_total}s\n' \
    "http://127.0.0.1:${PORT}/" || true

  section 'NGINX CONFIG TEST'
  sudo_cmd nginx -t || true

  section 'NGINX RELEVANT CONFIG'
  sudo_cmd nginx -T 2>&1 | \
    grep -nE "${DOMAIN//./\\.}|proxy_pass|upstream|${PORT}" || true

  section 'PM2 APP LOG'
  timeout 20s pm2 logs kalfa-beta --lines 150 --nostream || true

  section 'NGINX ERROR LOGS'
  found_log=0
  for log in \
    "/var/www/vhosts/system/${DOMAIN}/logs/proxy_error_log" \
    "/var/www/vhosts/system/${DOMAIN}/logs/error_log" \
    "/var/log/nginx/error.log"
  do
    if sudo_cmd test -f "$log"; then
      found_log=1
      echo "--- $log ---"
      sudo_cmd tail -n 150 "$log" || true
    fi
  done

  if [ "$found_log" -eq 0 ]; then
    echo 'No known nginx error log path was found.'
  fi
} 2>&1 | tee "$report"

chmod 600 "$report"

echo

echo "Saved: $ROOT/$report"

echo

echo '=== SAVED REPORT ==='

cat "$report" |copy