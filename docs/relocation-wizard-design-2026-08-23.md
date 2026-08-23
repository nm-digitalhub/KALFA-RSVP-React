# Relocation Wizard — Interface & Engine Design (2026-08-23)

Companion to `docs/relocation-wizard-plan-2026-08-23.md` (stages A–I, requirements R1–R5).
Synthesized from three live-doc research agents (installer-patterns research, CLI/UX design,
/admin integration planning). Every external claim below was verified against LIVE
documentation on 2026-08-23 (sources at the end), and every framework claim against the
INSTALLED versions (Next 16.3.1 docs in `node_modules/next/dist/docs`, Node 24.19.0,
package.json). Status: **DESIGN — not build-authorized.**

---

## 1. Architecture decisions (with the why)

1. **Custom step engine, thin UI layer.** Every production tool studied (Terraform, certbot,
   Supabase CLI, Prisma Migrate) separates the *ledger* (what happened — persisted state)
   from the *renderer*. No CLI UI library provides crash-surviving resume/rollback — listr2's
   rollback hooks are in-memory only and die with the process. So the engine is ours;
   libraries only render.
2. **One new devDependency: `@clack/prompts`** (v1.7.0, Node ≥20.12) — intro/outro, select/
   confirm with `isCancel`, spinner, sequential `tasks()`. Everything else is already here:
   `node:util.parseArgs` (stable) for the tiny flag surface (repo convention is hand-rolled
   parsing anyway), `node:util.styleText` for color (both ran live on our Node 24.19.0),
   zod ^4 (installed) for target validation + state-file parse. Rejected: listr2 (above),
   inquirer/ora (redundant), prompts (unmaintained since 2023).
3. **Plan-as-artifact** (Terraform): the reviewed dry-run change-set is stored in the state
   file; `apply` refuses if reality drifted since the plan was approved.
4. **Checkpoints + lock** (certbot): snapshot every file before touching it; one lock file —
   one wizard run at a time; `--dry-run` performs only reads/verifies, never mutations.
5. **Idempotent `check()` per step** (Prisma four-way comparison / Supabase "skip already
   applied"): re-running is always safe; `--resume` re-enters at the first non-done step.
6. **Human override**: `relocate repair --step <id> --status done|pending` (Supabase
   `migration repair` convention) — when ledger and reality disagree, the fix is a command,
   never hand-editing the state file.

### Step interface (engine core, `scripts/relocate/engine.ts`, run with tsx)

```ts
export interface StepDefinition<Ctx> {   // "Step" is the STATE record (§2); this is the engine unit
  id: string;                        // stable — the resume key ("C3")
  label: Label;                      // {en, he} — he surfaces only in /admin
  gate?: GateId | null;              // owner-approval stop before apply
  check(ctx): Promise<'pending' | 'done' | 'blocked'>;   // idempotency probe
  plan(ctx): Promise<string[]>;      // human-readable change lines for dry-run
  backup?(ctx): Promise<{ path: string; backupPath: string }[]>;
  apply(ctx): Promise<void>;
  verify(ctx): Promise<{ ok: boolean; checks: Check[] }>; // failure = HALT, no third option
  rollback?(ctx, saved): Promise<void>;
}
```

Engine loop per step: `check` (done ⇒ skip) → dry-run? collect `plan` and stop → `backup` →
persist `running` → `apply` → `verify` → persist `done`. Failed verify halts the run.
`--rollback` walks done/failed steps in reverse. External mutations (Supabase auth PATCH,
Meta webhook, Graph subscriptions…) record their inverse args in the state file
(`externalCalls[]`) so rollback can replay them with the previous origin.

---

## 2. The shared contract: `.relocation-state.json`

Single writer (the CLI), atomic replace (temp file + rename) on every transition, `0600`,
git-ignored, previous version kept as `.relocation-state.json.bak`.

**Writer identity (verifier fix — blocking gap):** the wizard runs as the vhost/app user
(the same user pm2 runs as), NOT as root, and elevates only whitelisted commands via
`sudo -n` (nginx write + `nginx -t` + reload, plesk CLI, cert paths). The state file is
therefore owned by the app user with `0600` — readable by the `/admin` page's server
process by construction. A root-owned state file would render /admin permanently
"no run"; the engine asserts its own uid ≠ 0 at startup. Validated with zod on
load (truncated/hand-edited state is caught, never crashes a renderer). **This schema IS
the API between the CLI and /admin** — both render from it, no second source of truth.

```ts
type StepStatus = 'pending'|'running'|'waiting-external'|'needs-decision'
                | 'done'|'skipped'|'failed'|'rolled-back';
interface Label { en: string; he: string }

interface RelocationState {
  schemaVersion: 1;                 // renderers refuse unknown majors
  serial: number;                   // monotonic write counter (Terraform)
  runId: string;                    // short id, appears in all copy & log paths
  createdAt: string; updatedAt: string;   // updatedAt = heartbeat (≥ every 30s while running)
  writer: { pid: number; host: string; user: string } | null;  // null = resumable, no live process
  target: { origin: string };
  previous: { origin: string };
  mode: 'interactive' | 'non-interactive' | 'dry-run';
  phase: 'planning'|'executing'|'waiting'|'blocked'|'rolling-back'|'done'|'failed'|'aborted';
  stages: { id: 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'; label: Label; steps: Step[] }[];
  gates: Gate[];
  openItems: { id: string; label: Label; severity: 'info'|'warn'; resolvedAt?: string }[];
  rollbacks: { stepId: string; at: string }[];    // rollback history (rendered by /admin)
  reportPath: string | null;                      // under git-ignored .relocate/ dir
}

interface Step {
  id: string; label: Label; status: StepStatus;
  startedAt?: string; endedAt?: string; attempt: number;
  backups: { path: string; backupPath: string }[];
  externalCalls?: { service: string; op: string; prevValue: unknown }[];  // rollback inverses (non-secret)
  verification?: { ok: boolean; checks: { label: Label; ok: boolean; detail?: string }[] };
  waiting?: { kind: 'dns-propagation'|'meta-template-approval'|'cert-issuance-retry';
              detail: Label; attempts: number; nextPollAt: string; pollEverySec: number };
  error?: { message: string; logPath: string; hint?: Label };
  // error.message is GUARANTEED pre-sanitized by the CLI (one line, no secrets/paths);
  // logPath is an absolute path and is stripped by the /admin view schema.
}

interface Gate {
  id: 'conflict-existing-site'|'voximplant-scenario-redeploy'|'meta-template-submit'
    | 'meta-approval-override'|'dns-write-local-zone'|'go-live';
  label: Label; consequence: Label;               // the one-sentence "what happens"
  status: 'not-reached'|'open'|'approved'|'declined';
  decidedAt?: string; decidedBy?: 'operator'|'flag'; choice?: string;
}
```

Renderer derivation rules (CLI footer and /admin MUST agree): progress = done / total
non-skipped; "current focus" = first step in {running, waiting-external, needs-decision,
failed}; **heartbeat staleness** — `updatedAt` older than 2 min while `phase='executing'`
renders as "wizard process not responding", never as "running". **No secrets ever enter the
state file** (Terraform warns state/plan artifacts carry sensitive values cleartext —
we store paths and non-secret previous values only).

Label catalog: `scripts/relocate/labels.ts` — typed `Label` constants, en+he side by side,
reviewable in one diff. CLI chrome (flag help, prompts) is en-only.

---

## 3. CLI experience (English-only terminal — deliberate)

Terminal RTL was verified live as broken/experimental across emulators (Windows Terminal
issue #20302 open, iTerm2 3.6 experimental opt-in, xterm none). **Hebrew lives in /admin**,
carried by the `Label` pairs in the state file.

Design rules adopted from GitHub Primer CLI guidelines: symbols never carry meaning alone
(`✓ done`, `✗ blocked` — word always present), color enhances but never communicates
(readable colorless, 8 basic ANSI), confirmation for risky ops, machine output uncolored/
untruncated.

Flow (full screen-by-screen copy lives in the UX agent's spec, reproduced here abridged):

- **S0 welcome + target** — inline validation (https, bare origin, ≠ current); errors
  re-prompt, never exit.
- **S1 preflight table** — 9 checks, each `symbol + word`; `blocked` (e.g. DNS not pointed)
  converts to a waiting state, `decision` rows route to gates.
- **S2 gates** — fixed anatomy, in order: identity (`▲ DECISION GATE <id>`) → evidence
  (verified facts, paths, values) → consequence (one sentence each way) → options with the
  safe choice preselected → escalated confirmation ONLY for irreversible/offline-taking
  choices: acknowledge + **type the domain name** (GitHub danger-zone convention). Gates
  never time out, never default-proceed; Ctrl-C at a gate = state saved, resumable.
- **S3 plan review** — always shown (with or without `--dry-run`): the full step list grouped
  by stage, gate/wait counts, the "first mutation" marker on stage D; approve = `go-live` gate.
- **S4 stage progress** — spinner on the running step, done steps collapse to one line,
  persistent footer `run 7f3a · stage C 3/4 · elapsed 1m12s · state: .relocation-state.json`.
- **S5 waiting-external** — names the wait, shows evidence ("still resolves to 185.60.11.9,
  attempt 6"), poll cadence, and offers "keep waiting" vs "exit now, `--resume` later".
  Meta-approval wait offers the override ("ride the 301") — which is itself a gate.
- **S6 failure** — evidence + traffic-impact sentence + exactly two exits: roll back, or
  leave-and-fix (`--resume`). **Never a "continue anyway"** after a failed verify.
- **S7 final report** — also written to `relocate-report-<runId>.md`; lists open items
  (Android fleet, Meta approval, orphaned push) as tracked-not-blocking.

### Non-interactive / CI mode

- Deliberately **no bare `--yes`**. Gates approved individually and explicitly:
  `--non-interactive --approve go-live,conflict-existing-site=shadow`.
- Unapproved gate → exit 3 with the gate id on stderr. `NO_COLOR`/`--no-color` honored;
  non-TTY log = one tab-delimited line per event (timestamp, step, status, detail).
- Exit codes — execute mode: `0` done · `1` error/failed (state saved) · `3` gate needs
  decision · `4` waiting-external with `--no-wait` · `5` lock held. Dry-run mode follows the
  Terraform `-detailed-exitcode` convention instead: `0` nothing to do · `1` error ·
  `2` changes pending (lets /admin and CI distinguish "already migrated" from "work to do").

---

## 4. `/admin/relocation` — progress page plan

**Data flow (decided against installed Next 16.3.1 docs + repo precedent):** force-dynamic
Server Component reads the state file directly through a `server-only` data module; client
auto-refresh via `router.refresh()` on an interval (re-renders Server Components without
losing client state — `use-router.md:46` of the installed docs). **No new API route, no
SSE** — no new HTTP surface, no rate-limiting question; matches the exact shape of
`/admin/debug` (owner-gated, force-dynamic, fail-soft panels, opt-in refresh toggle with
30s floor, default OFF).

**Files to create:**

| Path | Purpose |
|---|---|
| `src/lib/data/admin/relocation.ts` | `server-only` reader: fs read → zod parse → **whitelist** → `SoftResult<RelocationStateView>`; platform-owner gate in the data layer too (defense-in-depth) |
| `src/lib/data/admin/relocation.test.ts` | unit tests (below) |
| `src/app/(admin)/admin/relocation/page.tsx` | Server Component, `requirePlatformOwner()`, `dynamic = 'force-dynamic'`, title «העברת דומיין» |
| `src/app/(admin)/admin/relocation/_panels.tsx` | presentational panels + local `TimelineItem` (pattern: `admin/fleet/[id]/page.tsx:138`) |
| `src/app/(admin)/admin/relocation/_auto-refresh-toggle.tsx` | copy of debug's toggle, own localStorage key |
| `src/app/(admin)/admin/relocation/loading.tsx` | skeleton |
| edit `src/components/admin-shell.tsx` | nav entry in «כלי בדיקה ואבחון» (defaultOpen:false), icon Globe |

**Whitelist (what never reaches the browser):** absolute server paths (backups, nginx conf,
.env), executed command lines, raw stdout/stderr, cert/key paths, recorded API args, DNS
values beyond the target host, internal ports. Allowed: target/previous origins, runId,
schemaVersion, per-step id/phase/status/timestamps, `Label`s, coarse pre-sanitized
`errorSummary`, verification check names + pass/fail, `waiting.kind` + attempts/next poll,
gate ids/status/consequence, open items, `rollbacks` entries (stepId + timestamp),
`error.message` (the CLI-sanitized one-liner; `error.logPath` stripped).
Zod picks the shape; unknown keys are stripped by default.

**UI element → existing component map (no new primitives needed):** PageHeading + Card +
Badge (run header, status), `Progress` (n/m steps), `Accordion` per stage + TimelineItem
rows with lucide status icons, `Alert` for waiting-external (elapsed computed server-side —
no client clock, no hydration mismatch) and destructive-variant for needs-decision («the
page shows WHICH decision the CLI awaits — it never executes anything»), `Table` for
verification results, `EmptyState`/`Skeleton` for empty/loading. RTL inherited from the
admin layout; nothing portaled → no DirectionProvider concern.

**States + Hebrew copy:** no-run («לא בוצעה העברת דומיין. מריצים `npm run relocate` בשרת —
ההתקדמות תוצג כאן»), in-progress («מתבצע» + current step highlighted), waiting («ממתין
לגורם חיצוני: … — ממתין כבר {duration}» / «ממתין להחלטה בטרמינל: {decision}»), failed
(«ההעברה נעצרה בשלב "{step}". {error.message}. התיקון וההמשך — מהטרמינל (`--resume`)»),
complete, rolled-back, unreadable-file (soft: «קובץ המצב אינו קריא כרגע — ייתכן שכתיבה
מתבצעת; רעננו»). Stale heartbeat (§2 rule) renders «תהליך האשף אינו מגיב — יש לבדוק בשרת».

**Tests** (colocated vitest on the data layer, mirroring `admin/settings/actions.test.ts`):
missing file → `{ok:false}`; malformed JSON → `{ok:false}` no-throw; full fixture →
forbidden fields absent from the view; unknown keys stripped; enums parsed; non-owner
rejected (mock the DAL like sibling tests).

---

## 5. Build order (extends plan §10)

**Implementation precondition (AGENTS.md compliance):** before writing ANY Next.js code for
`/admin/relocation`, the implementer must initialize the next-devtools MCP context (the
`init`/`nextjs_index` tool as exposed by the installed server version) and re-read the
relevant guides in `node_modules/next/dist/docs/` for the installed version — the design
above cites them, but implementation must not rely on this document as a substitute for
the docs themselves.

1. `scripts/relocate/labels.ts` + state-file zod schema (shared contract first — both
   renderers depend on it).
2. Engine + lock + state persistence + `repair` command; preflight steps only (read-only
   value immediately, exercises the whole loop safely).
3. CLI UX layer (clack) over the engine; dry-run end-to-end.
4. `/admin/relocation` page against fixture state files (works before the engine can
   execute anything real).
5. Mutating stages C–E with rollback, then F–I service by service — per plan §10, rehearsed
   on a throwaway subdomain before any real move.

## 6. Next.js 16.3.1 URL/origin configuration reference (verified against installed docs)

Read end-to-end from `node_modules/next/dist/docs/` on 2026-08-23 (next-devtools MCP context
established first), each setting checked against our actual config.

| Setting | Doc source (under `docs/`) | Our state | Domain-change implication |
|---|---|---|---|
| `serverActions.allowedOrigins` | `01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:11-25`, mechanism `02-guides/server-actions.md:82` | not set; only `bodySizeLimit: '6mb'` (`next.config.ts:54-58`) | **safe on any domain**: CSRF check compares `Origin` to `Host`/`X-Forwarded-Host`, which our vhost template sets. Needed ONLY if a dual-origin window serves the app on both domains simultaneously |
| `allowedDevOrigins` | `allowedDevOrigins.md` | not set | none — dev-server only |
| `metadataBase` | `04-functions/generate-metadata.md:392-429` | per-request from `getAppOrigin()` (`src/app/layout.tsx:19-26`) | follows APP_ORIGIN, but **baked at build for statically-rendered pages** → rebuild required |
| `robots.ts` / `sitemap.ts` | `03-file-conventions/01-metadata/robots.md:22`, `sitemap.md:44` — special route handlers, **cached by default** (env read ≠ request-time API) | build URLs from `getAppOrigin()` | **rebuild required** — new finding; Stage H must fetch `/robots.txt` + `/sitemap.xml` and assert the new origin |
| `llms.txt` | route-handler caching config | `force-static` (`src/app/llms.txt/route.ts:11`) | rebuild required (confirmed) |
| `NEXT_PUBLIC_*` inlining | `02-guides/environment-variables.md:158-166` — frozen at build time | 7 `NEXT_PUBLIC_*` vars exist; the only URL-valued one is `NEXT_PUBLIC_SUPABASE_URL` (project URL, not app domain) | none today; **preflight rule**: assert no `NEXT_PUBLIC_*` contains the app origin — if one ever appears, env-swap-without-rebuild is silently wrong |
| `deploymentId` | `deploymentId.md`, `self-hosting.md:205-219` | **already set** from `.deploy-id` (`next.config.ts:34`) | works FOR the wizard: rebuild mints a new id → stale tabs hard-reload onto the new origin |
| `assetPrefix` / `basePath` / `trailingSlash` / `redirects` / `rewrites` | respective docs | none set | none — origin-relative and portable; keep unset (adding them would CREATE coupling). Target must stay a bare origin (UX S0 validation) |
| `headers()` config | `next.config.ts:107-194` | all `source` patterns path-relative | none |
| `images.remotePatterns` | `images.md` | Supabase hostname from env (`next.config.ts:65-77`) | none — tied to the Supabase project, not the app domain |
| proxy file | `03-file-conventions/proxy.md` (v16 convention) | `src/proxy.ts` — zero host/origin references | none — path-matched, origin-agnostic |
| self-hosting model | `self-hosting.md` | `next start` behind nginx, single instance | matches the documented path; no cache-coordination steps. (Pre-existing note: `self-hosting.md:239` wants proxy buffering off for streaming — our 502 fix keeps it on; unrelated to migration) |

**Design-claim verdicts**: (1) no `allowedOrigins` pin needed — CONFIRMED with doc citation;
(2) rebuild-required — CONFIRMED and WIDENED: four baked surfaces (llms.txt, robots,
sitemap, static-page metadata); (3) `force-dynamic` valid with `cacheComponents` off —
CONFIRMED. **Absorbed into the plan**: Stage A preflight gains the `NEXT_PUBLIC_*` origin
assertion; Stage H gains robots/sitemap origin checks; Phase 0 #9 (dual-origin window)
must touch BOTH layers — `src/lib/http/allowed-origin.ts` AND
`serverActions.allowedOrigins`; the "consider adding deploymentId" candidate is moot
(already implemented).

## 7. Sources (live, 2026-08-23)

Terraform plan/state docs (developer.hashicorp.com) · certbot user guide
(eff-certbot.readthedocs.io) · Supabase CLI migration reference · Prisma Migrate mental
model · Coolify install docs · Node v24 `util` docs (parseArgs/styleText, ran locally) ·
ctx7: `/bombshell-dev/clack`, `/listr2/listr2` · npm registry freshness checks · GitHub
Primer CLI principles & foundations · GitHub Docs danger-zone (type-the-name) convention ·
Vercel CLI global options (`--non-interactive`, NO_COLOR, env secrets) · terminal-wg BiDi
draft, microsoft/terminal#20302, iTerm2 3.6 RTL note · installed Next 16.3.1 docs
(`node_modules/next/dist/docs`: use-router refresh semantics, route-segment-config) ·
repo precedents: `/admin/debug`, `/admin/analytics`, `admin/fleet/[id]`.
