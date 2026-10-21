# DB-config protection: verification record and stage-3 deploy plan

Commits covered:

| Commit | What |
|---|---|
| `dc862599` | Refuse a local DB port against the Supabase pooler before connecting (`src/lib/relocation/env-validation.ts`, all five connection sites) |
| `f2bafdcf` | Report-only startup check in kalfa-beta (`register()` in `src/instrumentation.ts`) |
| `37051a10` | Per-site worker port assertions (`src/lib/relocation/worker-db-sites.test.ts`); controlled-promise alert test (`src/instrumentation.test.ts`) |

Background: the 2026-10-21 pg-boss incident (`SUPABASE_DB_PORT=54322` against
`*.pooler.supabase.com`). The worker crash-looped about 1,000 times on
`Connection terminated due to connection timeout`.

## Files

| File | Purpose |
|---|---|
| `stage3-deploy-plan.md` | Step-by-step deploy, stop conditions, rollback. **Not executed; needs approval.** |
| `mutation-results.txt` | Per-mutant result: verdict, failing test, first assertion line, restore and verification run |
| `mutate.py` | The mutation runner (27 mutants). Isolated copy only |
| `guard.cjs` | Network block preloaded into every test run (loopback allowed except DB ports) |
| `preflight-bundles.sh` | Isolated start of staged worker / owner-agent bundles (deploy step 2.4) |
| `prod-readonly-probe.cjs` | Read-only production aggregates: alert switches as booleans, pg-boss queues, webhook_inbox (deploy steps 0.5, 0.6, 3.5, 5.4) |

## Mutation verification: what was done

Environment: `git archive f2bafdcf` into a scratch directory, with `node_modules` symlinked.
`env -i`, no `.env.local`, network blocked (0 attempts in every run), no database.
The two test changes later committed as 37051a10 were applied to that copy.

The tested set:
`env-validation.test.ts`, `web-sender.test.ts`, `instrumentation.test.ts`, `worker-db-sites.test.ts`, `session-slots.test.ts`.
The baseline was 69/69.

Every mutant went through baseline → mutation → detection → restore → verification:
- sha256 of the file after the restore equals its sha256 before the mutation;
- the verification run passed 69/69;
- the working tree was untouched (HEAD, index hash, diff hash, status and untracked list were identical before and after).

| Group | Mutants | Target |
|---|---|---|
| B1–B8 | The eight original mutants (same strings as the earlier `mutate-dbcfg.py`) | rule, probe, message, web-sender, owner-agent |
| C1–C4 | `effectiveDbPort`: old computation, blank becomes 0, un-normalised return, probe port ≠ validated port | `env-validation.ts` |
| P1–P4 | `probeSupabaseDb`: old NODE_ENV spread, weakening by development or test, fixed port | `env-validation.ts` |
| D1–D8 | `register()`: runtime guard, run-once flag, check, log, alert, `await`, throw, DB client | `instrumentation.ts` |
| E1–E3 | Each `worker/main.ts` site separately: lock `PgClient`, LISTEN `PgClient`, `PgBoss` | `worker/main.ts` |

Result: **27/27 CAUGHT**. For each one, the expected test failed and there were no load failures
(see `mutation-results.txt`). D4 was first written with a syntax error. The runner classified it
NOT-PROVEN (a transform failure, not an assertion). It was then corrected and re-run: CAUGHT.

### What the results do and do not prove

- B3, B6 and B7 fail logically, but not through an `AssertionError`:
  - B3 and B7: `DbConfigError` thrown from code under test (`supabaseDbPort`, `webSenderOptions`).
  - B6: `promise resolved "PgBoss…" instead of rejecting`.
  - The stacks point at the code under test, not at the test infrastructure.
- Delivery of the Slack alert in production was not verified, because no test alert was allowed.
- The web-sender path in production is unverified until the first natural send (it is lazy).
- Fleet and ops were checked for direct imports of the changed modules only.

## Still open from stage 9 (not part of this deploy)

These were not re-run: no mutation against the shared local database.

- **M2**: the full failure reason was not kept.
- **M3**: the failure happened on a different path from the one intended.
- **M4b**: the teardown outcome is unknown.

See `plans/kalfa-stage-9-incident-local-audit-deletion.md` (local, untracked).

## Raw evidence (outside git)

`/var/www/vhosts/kalfa.me/deploy-backups/db-config-f2bafdcf-verification-evidence/` (5.1M)
contains, per run:
- stdout, stderr and the exit code;
- the vitest JSON result;
- the network log;
- the before/after manifests of the working tree and of the isolated copy.

`SHA256SUMS` covers every file.

## Reproducing

Run in a scratch directory, never inside the repo:

```bash
R=/var/www/vhosts/kalfa.me/beta; V=$R/plans/db-config-f2bafdcf-verification
C=$(mktemp -d); git -C $R archive 37051a10 | tar -x -C $C; ln -s $R/node_modules $C/node_modules
mkdir -p $C.out; (cd $C && W=$C OUT=$C.out GUARD=$V/guard.cjs python3 $V/mutate.py)   # or: ... mutate.py C1 E2
```
