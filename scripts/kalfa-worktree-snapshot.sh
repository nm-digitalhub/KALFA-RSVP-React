#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
umask 077

ROOT="${KALFA_ROOT:-/var/www/vhosts/kalfa.me/beta}"
MODE="${1:-snapshot}"
FORCE="${FORCE:-0}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

section() {
  printf '\n=== %s ===\n' "$*"
}

usage() {
  cat <<'EOF'
Usage:
  kalfa-worktree-snapshot.sh
  kalfa-worktree-snapshot.sh snapshot
  kalfa-worktree-snapshot.sh --backfill-latest
  kalfa-worktree-snapshot.sh --repair-manifest-latest
  kalfa-worktree-snapshot.sh --verify-latest

Environment:
  KALFA_ROOT=/path/to/repository
  FORCE=1   Allow overwriting an existing untracked backup in backfill mode.
EOF
}

[ -d "$ROOT/.git" ] || fail "Not a Git repository: $ROOT"
cd "$ROOT"

mkdir -p ops-evidence
chmod 700 ops-evidence

install_local_exclude() {
  local exclude=".git/info/exclude"

  mkdir -p .git/info
  touch "$exclude"

  if ! grep -qxF '/ops-evidence/' "$exclude"; then
    {
      printf '\n'
      printf '# Local operational evidence; never commit.\n'
      printf '/ops-evidence/\n'
    } >> "$exclude"
  fi
}

list_untracked() {
  git ls-files -o --exclude-standard \
    | awk '$0 !~ /^ops-evidence\//'
}

latest_snapshot() {
  find ops-evidence \
    -maxdepth 1 \
    -mindepth 1 \
    -type d \
    -name 'triage-*' \
    -printf '%T@ %p\n' \
    | sort -nr \
    | head -n 1 \
    | cut -d' ' -f2-
}

write_checksums() {
  local dir="$1"
  local tmp

  # קובץ זמני בתיקיית האב, לא בתוך תיקיית ה-snapshot.
  # לכן הוא לא נכלל בעצמו בתוך SHA256SUMS.
  tmp="$(mktemp "$(dirname "$dir")/.SHA256SUMS.XXXXXX")"

  if ! (
    cd "$dir"

    find . \
      -maxdepth 1 \
      -type f \
      ! -name 'SHA256SUMS' \
      ! -name '.SHA256SUMS.*' \
      -printf '%P\0' \
      | LC_ALL=C sort -z \
      | while IFS= read -r -d '' file; do
          sha256sum -- "$file"
        done
  ) > "$tmp"; then
    rm -f -- "$tmp"
    return 1
  fi

  mv -f -- "$tmp" "$dir/SHA256SUMS"

  find "$dir" \
    -maxdepth 1 \
    -type f \
    -exec chmod 600 {} +
}

archive_untracked() {
  local dir="$1"
  local capture_kind="$2"
  local list="$dir/untracked-backup.list"
  local archive="$dir/untracked-files.tar.gz"
  local meta="$dir/untracked-backup-captured-at.txt"

  list_untracked > "$list"

  {
    printf 'captured_at=%s\n' "$(date -Is)"
    printf 'capture_kind=%s\n' "$capture_kind"

    if [ "$capture_kind" = "backfill" ]; then
      printf '%s\n' \
        'note=This archive contains current untracked-file content.' \
        'note=It is not proof that those files were identical at the original snapshot timestamp.'
    else
      printf '%s\n' \
        'note=This archive was created during the same snapshot run.'
    fi
  } > "$meta"

  if [ -s "$list" ]; then
    tar \
      --verbatim-files-from \
      --files-from="$list" \
      -czf "$archive"
  else
    tar -czf "$archive" --files-from=/dev/null
  fi

  tar -tzf "$archive" > "$dir/untracked-files.tar.list"
}

write_snapshot() {
  local stamp dir

  stamp="$(date +%Y%m%d-%H%M%S)"
  dir="ops-evidence/triage-${stamp}"

  mkdir -p "$dir"
  chmod 700 "$dir"

  {
    printf 'captured_at=%s\n' "$(date -Is)"
    printf 'root=%s\n' "$ROOT"
    printf 'head=%s\n' "$(git rev-parse HEAD)"
    printf 'branch=%s\n' "$(git branch --show-current || true)"
  } > "$dir/context.txt"

  git rev-parse HEAD > "$dir/head.txt"
  git status --short > "$dir/git-status.txt"

  git diff --check > "$dir/git-diff-check.txt" || true
  git diff --cached --check > "$dir/git-diff-cached-check.txt" || true

  git diff --stat > "$dir/git-diff-stat.txt"
  git diff --cached --stat > "$dir/git-diff-cached-stat.txt"

  git diff --binary > "$dir/worktree.patch"
  git diff --cached --binary > "$dir/staged.patch"

  list_untracked > "$dir/untracked-files.txt"

  archive_untracked "$dir" "snapshot"
  write_checksums "$dir"

  printf 'Snapshot saved: %s/%s\n' "$ROOT" "$dir"

  section 'Snapshot summary'

  echo '-- Git status --'
  sed -n '1,200p' "$dir/git-status.txt"

  echo
  echo '-- Unstaged diff stat --'
  sed -n '1,200p' "$dir/git-diff-stat.txt"

  echo
  echo '-- Staged diff stat --'
  sed -n '1,200p' "$dir/git-diff-cached-stat.txt"

  echo
  echo '-- Untracked files backed up --'
  sed -n '1,200p' "$dir/untracked-backup.list"

  echo
  echo '-- Archive verification --'
  tar -tzf "$dir/untracked-files.tar.gz" | sed -n '1,200p'

  echo
  echo '-- Integrity manifest --'
  cat "$dir/SHA256SUMS"
}

backfill_latest() {
  local dir

  dir="$(latest_snapshot)"
  [ -n "$dir" ] || fail "No existing triage snapshot found."

  if [ -e "$dir/untracked-files.tar.gz" ] && [ "$FORCE" != "1" ]; then
    fail "Untracked archive already exists in $dir. Use FORCE=1 only if replacement is intentional."
  fi

  rm -f \
    "$dir/untracked-backup.list" \
    "$dir/untracked-files.tar.gz" \
    "$dir/untracked-files.tar.list" \
    "$dir/untracked-backup-captured-at.txt"

  archive_untracked "$dir" "backfill"
  write_checksums "$dir"

  printf 'Backfill completed: %s/%s\n' "$ROOT" "$dir"

  section 'Backfilled archive contents'
  sed -n '1,200p' "$dir/untracked-files.tar.list"

  section 'Checksum verification'
  (
    cd "$dir"
    sha256sum -c SHA256SUMS
  )
}

repair_manifest_latest() {
  local dir

  dir="$(latest_snapshot)"
  [ -n "$dir" ] || fail "No existing triage snapshot found."

  write_checksums "$dir"

  printf 'Checksum manifest rebuilt: %s/%s\n' "$ROOT" "$dir"

  section 'Checksum verification'
  (
    cd "$dir"
    sha256sum -c SHA256SUMS
  )

  if [ -f "$dir/untracked-files.tar.gz" ]; then
    tar -tzf "$dir/untracked-files.tar.gz" > /dev/null
    echo 'Untracked archive: OK'
  else
    echo 'Untracked archive: MISSING'
  fi
}

verify_latest() {
  local dir

  dir="$(latest_snapshot)"
  [ -n "$dir" ] || fail "No existing triage snapshot found."

  section "Verifying $dir"

  (
    cd "$dir"
    sha256sum -c SHA256SUMS
  )

  if [ -f "$dir/untracked-files.tar.gz" ]; then
    tar -tzf "$dir/untracked-files.tar.gz" > /dev/null
    echo 'Untracked archive: OK'
  else
    echo 'Untracked archive: MISSING'
  fi
}

install_local_exclude

case "$MODE" in
  snapshot)
    write_snapshot
    ;;
  --backfill-latest)
    backfill_latest
    ;;
  --repair-manifest-latest)
    repair_manifest_latest
    ;;
  --verify-latest)
    verify_latest
    ;;
  --help|-h|help)
    usage
    ;;
  *)
    usage
    fail "Unknown mode: $MODE"
    ;;
esac