# Stage 3 — deploying the DB-config protection (dc862599, f2bafdcf, 37051a10)

Status: **plan for approval. Not executed.**
Scope: kalfa-worker, kalfa-owner-agent, kalfa-beta only.

Do NOT use `npm run deploy` for this. Besides the three apps it also:
- restarts kalfa-fleet and kalfa-ops-agent;
- deletes `.next.old` right after the swap, so the web tier has no rollback;
- runs `seo:audit` and `seo:indexnow`, which ping external services.

Neither fleet (`.claude/fleet/bin/scheduler.mjs`, `scripts/fleet-agent-cli.ts`) nor ops
(`ops/probe-server.mjs`) imports `env-validation` or `web-sender`. Only the entry files were
checked; transitive imports were not.

The scripts referenced below are in this directory:
- `preflight-bundles.sh`
- `prod-readonly-probe.cjs`

Variables (set once, in one shell):

```bash
R=/var/www/vhosts/kalfa.me/beta
P=$R/plans/db-config-f2bafdcf-verification
B=/var/www/vhosts/kalfa.me/deploy-backups/stage3-$(date +%Y%m%d-%H%M)   # outside the repo, not pruned
S=$B/stage
cd $R
```

## Two different failures: tell them apart before acting

| | Port configuration refused | Database actually unavailable |
|---|---|---|
| Where | the pure rule `checkSupabaseDbTarget` (`src/lib/relocation/env-validation.ts`) | TCP, TLS or auth against the pooler |
| Socket opened | no | yes |
| Message / class | `invalid database configuration` (`DbConfigError`), probe class `format` | probe class `network` or `auth`; pg errors such as `Connection terminated due to connection timeout` |
| Fix | `.env.local` (`SUPABASE_DB_PORT` must be 5432 or 6543 with a pooler host in production) | Supabase status, network. Not a config change. |
| Check | step 0.3 | step 0.4 |

## Alert path: what it depends on

`register()` in `src/instrumentation.ts` reports a refused target with `sendSlackAlert` (category `errors`).
The call chain is `sendSlackAlert` (`src/lib/alerts/slack.ts`) → `getAlertsConfig`
(`src/lib/data/alerts-config.ts`) → `createAdminClient` → PostgREST `app_settings` over HTTPS.

- It does NOT use `SUPABASE_DB_PORT`. A bad port still alerts: the worker-fatal alert of the
  2026-10-21 incident did arrive.
- If PostgREST itself is down, `getAlertsConfig` returns DISABLED and the alert is dropped
  silently. Only the console line remains, so always read the pm2 logs as well.
- The rate limiter (`src/lib/security/rate-limit.ts`) is in-memory. It has no database dependency.
- No test alert is sent. Step 0.5 only reads the switches.

## 0. Preflight (read-only). Any failure = STOP. Nothing has changed yet.

0.1 Code. Expect the last commit containing the protection, and no tracked changes under the build inputs:

```bash
git rev-parse --short HEAD
git diff --quiet HEAD -- src worker scripts package.json next.config.ts && echo clean
```

0.2 Services. All three must be `online`. Note `restart_time` as the baseline:

```bash
pm2 jlist | python3 -c "import json,sys;[print(p['name'],p['pm2_env']['status'],p['pm2_env']['restart_time']) for p in json.load(sys.stdin) if p['name'] in ('kalfa-beta','kalfa-worker','kalfa-owner-agent')]"
```

0.3 Database configuration. These commands print the port and a count only, never the host or a secret:

```bash
grep -E '^SUPABASE_DB_PORT=' .env.local          # expect 5432 (or 6543)
grep -cE '^SUPABASE_DB_HOST=[a-z0-9-]+\.pooler\.supabase\.com$' .env.local   # expect 1
for a in kalfa-worker kalfa-owner-agent kalfa-beta; do pid=$(pm2 pid $a); echo "$a $(tr '\0' '\n' < /proc/$pid/environ | grep -E '^SUPABASE_DB_PORT=' || echo 'not in process env (read from .env.local at load)')"; done
```

0.4 Reachability. Prints only open or closed:

```bash
H=$(grep -E '^SUPABASE_DB_HOST=' .env.local | cut -d= -f2-); nc -z -w5 "$H" 5432 && echo open || echo CLOSED; unset H
```

0.5 and 0.6. Alert switches (booleans) and the queue baseline, in one read-only transaction:

```bash
node $P/prod-readonly-probe.cjs > $B-pre-probe.txt 2>&1   # or into $B after step 1
```

- `enabled` and `errors_category` must be true, and `has_token` and `has_channel` too.
  Otherwise there will be no Slack alert, and the plan relies on logs only (record this).
- Keep `due_waiting`, `retry`, `failed_since` and `stuck active` as the baseline.

## 1. Back up the live artifacts (nothing is restarted)

```bash
mkdir -p $S
cp -a dist/worker.cjs dist/owner-agent.cjs dist/owner-agent-mcp.cjs $B/
sha256sum dist/worker.cjs dist/owner-agent.cjs dist/owner-agent-mcp.cjs .next/BUILD_ID > $B/live.sha256
```

`.next` is not copied. It is kept by renaming it at swap time (step 5.1).

## 2. Build into isolated paths (the live dist/ and .next are untouched)

2.1 Next. This is the same command as `deploy` step 4. `npm run build` targets `.next-verify` and is only a verification build.

```bash
NEXT_DIST_DIR=.next-stage npx next build --webpack && test -s .next-stage/BUILD_ID && echo next-ok
```

2.2 owner-agent. This builds the consumer and the MCP bundle with tmp+rename, and runs `check-owner-agent-bundle` on $S:

```bash
node scripts/owner-agent-build-restart.mjs --out-dir=$S --no-pm2
```

2.3 worker. This is the esbuild part of `worker:build` with a staged outfile. `check-worker-bundle.mjs` has
`dist/worker.cjs` hard-coded, so its checks are repeated by hand:

```bash
eval "npx $(node -p "require('./package.json').scripts['worker:build'].split('&&')[0].replace('--outfile=dist/worker.cjs','--outfile=$S/worker.cjs')")"
[ $(stat -c %s $S/worker.cjs) -ge 4000000 ] && ! grep -q 'var import_meta = {}' $S/worker.cjs && grep -q 'invalid database configuration' $S/worker.cjs && echo worker-bundle-ok
```

2.4 Isolated preflight of both staged bundles. Every line must be OK and the exit code 0:

```bash
bash $P/preflight-bundles.sh $S
```

STOP if any step in 2.x fails. Production is unchanged at this point; remove `.next-stage` and $S.

## 3. kalfa-worker first (the incident component; cheapest rollback)

```bash
cp $S/worker.cjs dist/worker.cjs.new && mv dist/worker.cjs.new dist/worker.cjs
node scripts/check-worker-bundle.mjs
pm2 restart kalfa-worker
```

Verify for 120 s:
- the status is `online` and `restart_time` = baseline + 1, not rising;
- `pm2 logs kalfa-worker --lines 200 --nostream` shows none of `invalid database configuration`,
  `Connection terminated` or `fatal`;
- `node $P/prod-readonly-probe.cjs <restart-ISO>`: `done_since` is rising on the busy queues,
  `retry` and `failed_since` are not growing against the baseline, and there are no stuck active jobs.

STOP and roll back with R-W if any check fails.

## 4. kalfa-owner-agent

```bash
cp $S/owner-agent.cjs dist/owner-agent.cjs.new && mv dist/owner-agent.cjs.new dist/owner-agent.cjs
cp $S/owner-agent-mcp.cjs dist/owner-agent-mcp.cjs.new && mv dist/owner-agent-mcp.cjs.new dist/owner-agent-mcp.cjs
pm2 restart kalfa-owner-agent
```

Verify for 120 s: `online`, restarts stable, and no fatal or `invalid database configuration` in the logs.
STOP and roll back with R-O if any check fails.

## 5. kalfa-beta last (user-facing; its new check is report-only)

```bash
mv .next .next.prev && mv .next-stage .next
pm2 restart kalfa-beta
```

Verify:

```bash
curl -fsS http://127.0.0.1:3002/api/health        # {"ok":true}
pm2 logs kalfa-beta --lines 200 --nostream | grep '\[db-config\]'   # exactly one "startup check passed"; no FAILED
```

- Load the public root in a browser: it must return 200.
- web-sender is lazy, so the functional proof comes from the first natural send from the web tier:
  re-run the probe and look for new `created_since` and `done_since` on the web-enqueued queues, with
  no `[db-config]` or `DbConfigError` in the logs. No synthetic send without a separate approval.

STOP and roll back with R-B if any check fails. Keep `.next.prev` until its removal is approved.

## 6. After the deploy (24 h)

- Restart counters are stable, there is no worker-fatal alert, and the backlog is stable (probe).
- Then, after a separate approval: `rm -rf .next.prev $B`.

## Rollback (per component, independent)

```bash
# R-W
cp $B/worker.cjs dist/worker.cjs && pm2 restart kalfa-worker
# R-O
cp $B/owner-agent.cjs $B/owner-agent-mcp.cjs dist/ && pm2 restart kalfa-owner-agent
# R-B
mv .next .next.bad && mv .next.prev .next && pm2 restart kalfa-beta
# after any rollback
sha256sum -c $B/live.sha256      # the restored artifacts equal the pre-deploy ones (BUILD_ID for R-B)
```

Then repeat the checks of the component (3, 4 or 5).

- Rolling back the artifacts only removes the protection. This deploy does not touch `.env.local`
  (port 5432), so the previous artifacts are safe to run.
- A code rollback (`git revert`) is a separate decision.
