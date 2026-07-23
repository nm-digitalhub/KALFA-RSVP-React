# Disk Cleanup — separating certain junk from live state

A full disk is a frequent trigger and usually *not* an incident. But "junk" and "live service" look alike, so apply the same evidence discipline: **prove a path is safe to delete before proposing it**, and deletion is still destructive → it goes through the human-approval gate (SKILL.md doctrine #3).

## 1. Find the weight (read-only)
```bash
df -h
du -h -d1 / 2>/dev/null | sort -h | tail -15
du -h -d2 /var/www/vhosts/kalfa.me/beta 2>/dev/null | sort -h | tail -20
```

## 2. Classify each large item — certain junk vs. live

**Certifiably safe (regenerable, not serving traffic):**
- **Abandoned clone dirs** — e.g. `temp_git_*` that contain only a `.git` (leftovers from plugin installs). Verify each is inert before counting it:
  ```bash
  for d in /var/www/vhosts/kalfa.me/beta/temp_git_*; do
    echo "$d -> $(ls -A "$d" | tr '\n' ' ')"     # expect just ".git"
  done
  ```
- **Package/build caches** — `~/.npm/_cacache`, `.next/cache`, `node_modules/.cache`. These rebuild on next install/build.
- **Stale build output that is NOT the live one** — e.g. `.next-verify` (a throwaway verify build) is distinct from the live `.next`. Confirm which one pm2 actually serves before touching either:
  ```bash
  pm2 describe <app> | grep -Ei 'script|cwd|exec'   # find the live build dir
  du -sh /var/www/vhosts/kalfa.me/beta/.next /var/www/vhosts/kalfa.me/beta/.next-verify 2>/dev/null
  ```

**Never delete without extra care (live state):**
- The live `.next` the running app serves.
- `node_modules` of the running app (breaks it until reinstall).
- Anything under `pm2` runtime, active logs you haven't rotated, or the DB.

## 3. Old logs & journal (usually safe, bounded)
```bash
journalctl --disk-usage
du -sh /var/log/* 2>/dev/null | sort -h | tail
# MySQL binary logs can balloon (this host has hit 300G+). PURGE via SQL, never rm:
#   PURGE BINARY LOGS BEFORE NOW() - INTERVAL 3 DAY;   (or set expire_logs_days)
```
Do **not** `rm` MySQL binlogs directly — that corrupts replication state; purge them through the DB.

## 4. Propose, then delete (approval gate)
Present a table: path → size → why it's safe (the proof from step 2) → total to reclaim. Wait for approval. Then delete narrowest-first and re-check `df -h` after each group, confirming the live app still responds (`pm2 list`, a quick curl to the local port).

## Worked example (real numbers from this host)
- `temp_git_*` = 31 abandoned clones, each only `.git` → **14G**, safe.
- npm cache → **7.2G**, safe (rebuilds).
- `.next-verify` (1.6G) ≠ live `.next` (550M) → safe.
- Result: 96% → 91%, ~23G reclaimed, live `.next`/pm2 untouched.
