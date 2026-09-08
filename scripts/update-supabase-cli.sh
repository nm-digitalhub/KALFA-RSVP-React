#!/usr/bin/env bash
# Keep the Supabase CLI at ONE version everywhere it is reachable from this box.
#
# WHY THIS EXISTS. The CLI has no self-update command — `supabase --help` lists
# none, and the upstream Go source only ships an update *notifier* that compares
# against the GitHub latest release and prints a suggestion (cached 10h). So the
# "A new version is available" line every command printed was never going to fix
# itself. Worse, the CLI is reachable here through TWO independent installs that
# drift apart silently:
#
#   1. ~/.supabase/bin/supabase   standalone binary, first on PATH  → `supabase`
#   2. node_modules/.bin/supabase npm dependency of this project    → `npx supabase`
#
# Drift between them is not cosmetic: this is the tool that runs `db push`
# against the LIVE database and `gen types` whose output gates deploys. Two
# versions doing the same job differently is exactly the failure we do not want
# to debug at 2am, so this script pins both to the SAME version rather than
# letting each wander.
#
# HOW. The binary is upgraded by the OFFICIAL upstream installer (it resolves
# the latest release, verifies checksums.txt, and installs into the same
# ~/.supabase/bin it already uses) — never by a hand-rolled downloader here.
# Whatever version that lands is then mirrored EXACTLY onto the npm side, so
# package.json, the lockfile, the binary and npx can never disagree.
#
# Run: bash scripts/update-supabase-cli.sh [--check]
#   --check  report drift and the available version, change nothing.
#
# Scheduled weekly via cron (see docs/project/11-operations-and-deployment.md).
set -uo pipefail

PROJECT_DIR="/var/www/vhosts/kalfa.me/beta"
INSTALL_DIR="${SUPABASE_INSTALL_DIR:-$HOME/.supabase/bin}"
BIN="$INSTALL_DIR/supabase"
LOG="$HOME/.supabase/update.log"
CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

version_of() { "$1" --version 2>/dev/null | tr -d '[:space:]'; }

mkdir -p "$(dirname "$LOG")"

# --- current state -----------------------------------------------------------
binary_before="$(version_of "$BIN")"
npm_before="$(cd "$PROJECT_DIR" && node -p "require('./package.json').devDependencies?.supabase ?? require('./package.json').dependencies?.supabase ?? ''" 2>/dev/null)"
latest="$(curl -fsSL --max-time 30 https://api.github.com/repos/supabase/cli/releases/latest 2>/dev/null |
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write((JSON.parse(d).tag_name||"").replace(/^v/,""))}catch(e){}})')"

if [[ -z "$latest" ]]; then
  log "SKIP: could not resolve the latest release (network/GitHub API). Nothing changed."
  exit 0
fi

log "binary=$binary_before  package.json=$npm_before  latest=$latest"

if $CHECK_ONLY; then
  [[ "$binary_before" == "$latest" ]] && log "binary is current" || log "binary is BEHIND"
  exit 0
fi

# --- 1. the standalone binary ------------------------------------------------
if [[ "$binary_before" == "$latest" ]]; then
  log "binary already at $latest — no download"
else
  # Keep exactly ONE rollback copy; the directory had six stale .bak files
  # totalling ~600MB before this script existed.
  [[ -f "$BIN" ]] && cp -f "$BIN" "$BIN.previous"
  # --no-modify-path: PATH is already exported from ~/.bashrc (two entries);
  # letting the installer append another one would keep growing it.
  if curl -fsSL --max-time 120 https://raw.githubusercontent.com/supabase/cli/main/install |
    bash -s -- --no-modify-path >>"$LOG" 2>&1; then
    binary_after="$(version_of "$BIN")"
    if [[ "$binary_after" != "$latest" ]]; then
      log "ERROR: installer finished but binary reports $binary_after (wanted $latest) — rolling back"
      [[ -f "$BIN.previous" ]] && mv -f "$BIN.previous" "$BIN"
      exit 1
    fi
    log "binary $binary_before -> $binary_after"
  else
    log "ERROR: installer failed — binary left at $binary_before"
    exit 1
  fi
fi

# --- 2. the npm side, pinned to whatever the binary actually is --------------
binary_now="$(version_of "$BIN")"
cd "$PROJECT_DIR" || { log "ERROR: project dir missing"; exit 1; }
npm_installed="$(node -p "require('./node_modules/supabase/package.json').version" 2>/dev/null || echo '')"

if [[ "$npm_installed" == "$binary_now" && "$npm_before" == "$binary_now" ]]; then
  log "npm side already pinned to $binary_now"
else
  # --save-exact on purpose: a caret range would let `npm ci` resolve a version
  # the binary is not on, which is the drift this script exists to prevent.
  #
  # --allow-remote=all is REQUIRED on this machine, not optional tuning. npm's
  # `allow-remote` default is `none` here (a security default we deliberately do
  # NOT change), and any reify that resolves a package by tarball URL dies with
  # EALLOWREMOTE — verified 2026-09-08: a plain `npm install supabase@2.117.0
  # --dry-run` fails on @tailwindcss/oxide-wasm32-wasi, a platform-mismatched
  # optional dep that has nothing to do with supabase. The flag is per-command
  # and does not persist into the stored config.
  if npm install "supabase@$binary_now" --save-exact --save-dev --allow-remote=all >>"$LOG" 2>&1; then
    log "npm $npm_before -> $(node -p "require('./package.json').devDependencies?.supabase ?? require('./package.json').dependencies?.supabase")"
  else
    log "ERROR: npm install supabase@$binary_now failed — versions now DIFFER"
    exit 1
  fi
fi

# --- 3. prove all three agree ------------------------------------------------
b="$(version_of "$BIN")"
n="$(cd "$PROJECT_DIR" && version_of ./node_modules/.bin/supabase)"
if [[ "$b" == "$n" ]]; then
  log "OK: binary and npx both $b"
else
  log "ERROR: still mismatched — binary=$b npx=$n"
  exit 1
fi

# --- 4. did the upgrade change generated types? if so, fix it safely ---------
# Why this belongs in the update window: `npm run deploy` runs
# scripts/check-supabase-types.mjs FIRST and REFUSES to deploy when
# src/lib/supabase/types.generated.ts differs from what the CLI produces. A CLI
# upgrade that changes the generator's output therefore does not fail here — it
# fails at the NEXT deploy, at whatever hour that is, with an error that names
# types rather than the upgrade that caused them.
#
# HOW, and why not a blind overwrite. This follows the flow Supabase's own team
# documented for the identical problem (ADR 0005 "Checked-in types, not
# build-time generation" + docs/openapi-sync.md): keep generated types in version
# control, run a SCHEDULED job that regenerates them, put the result through the
# quality gates, and land it as a PULL REQUEST rather than a direct commit — so
# "changes are visible in pull request reviews" and "breaking changes surface
# through compiler errors". They keep exactly ONE open sync branch rather than a
# pile of commits; `git branch -f` below does the same.
#
# The extra constraint their CI does not have: this is a LIVE working tree the
# owner edits, routinely dirty (20 modified files while this was written). So
# the whole regenerate-verify-commit cycle happens inside a DISPOSABLE GIT
# WORKTREE — a second checkout in a temp directory sharing the same object
# store. The owner's tree, index, branch and stash are never read or written, so
# there is nothing to restore if this is interrupted, and no trap to get wrong.
# node_modules is symlinked in rather than installed: tsc needs it and it is the
# same dependency set by construction (verified: tsc --noEmit exits 0 there).
TYPES_REL="src/lib/supabase/types.generated.ts"
SYNC_BRANCH="chore/supabase-types-sync"

if [[ "$binary_before" != "$b" ]]; then
  wt="$(mktemp -d)/types-sync"
  if git -C "$PROJECT_DIR" worktree add --detach "$wt" HEAD >>"$LOG" 2>&1; then
    ln -s "$PROJECT_DIR/node_modules" "$wt/node_modules"
    [[ -f "$PROJECT_DIR/.env.local" ]] && cp "$PROJECT_DIR/.env.local" "$wt/.env.local"

    if (cd "$wt" && "$PROJECT_DIR/node_modules/.bin/supabase" gen types --linked >"$TYPES_REL.new" 2>>"$LOG") &&
      [[ -s "$wt/$TYPES_REL.new" ]]; then
      if diff -q "$wt/$TYPES_REL" "$wt/$TYPES_REL.new" >/dev/null 2>&1; then
        log "types.generated.ts unchanged by the upgrade — deploys unaffected"
      else
        log "types.generated.ts CHANGED by CLI $b — verifying in an isolated worktree"
        mv -f "$wt/$TYPES_REL.new" "$wt/$TYPES_REL"
        if (cd "$wt" && ./node_modules/.bin/tsc --noEmit >>"$LOG" 2>&1); then
          if (cd "$wt" &&
            git add "$TYPES_REL" &&
            git -c user.name='KALFA CLI updater' -c user.email='admin@nm-digitalhub.com' \
              commit -q -m "chore(deps): regenerate Supabase types for CLI $b" \
              -m "Generated by scripts/update-supabase-cli.sh after the CLI moved $binary_before -> $b. Verified with tsc --noEmit before committing." &&
            git branch -f "$SYNC_BRANCH" HEAD); then
            log "OK: candidate type-checks; committed to branch $SYNC_BRANCH (working tree untouched)"
            log "ACTION: review with 'git diff HEAD..$SYNC_BRANCH' and merge when you are ready"
          else
            log "ERROR: candidate type-checks but the commit failed — run 'npm run gen:types' by hand"
          fi
        else
          log "ERROR: types generated by CLI $b do NOT type-check — nothing committed anywhere."
          log "ERROR: the next deploy will fail on types drift. Resolve by hand before deploying."
        fi
      fi
    else
      log "NOTE: could not generate types for comparison (network/auth) — check before the next deploy"
    fi

    # Always dispose of the worktree; the symlink goes first so `worktree
    # remove` can never follow it into the real node_modules.
    rm -f "$wt/node_modules"
    git -C "$PROJECT_DIR" worktree remove --force "$wt" >>"$LOG" 2>&1 ||
      log "NOTE: temp worktree left at $wt — remove with 'git worktree prune'"
  else
    log "NOTE: could not create a temp worktree — skipped the types check"
  fi
fi
