# vendor/workflowbuilder

Third-party source, kept as close to upstream as the build allows.

⚠️ **THIS FILE SAID "not edited" AND THAT WAS NOT TRUE.** Two kinds of change
have been made, both listed below under *Divergences*. The claim mattered — it is
what let a re-sync be read as a diff — so it is replaced by the list rather than
repeated.

| | |
|---|---|
| Repository | <https://github.com/synergycodes/workflowbuilder> |
| Commit | `2d987d3b01618306eef898c0eb0c0d08ee207016` (2026-09-04) |
| Later cherry-pick | `badcca6` — `errors.ts` only (2026-09-16), see *Divergences* |
| Upstream paths | `packages/execution-core/src`, `packages/types/src` |
| Licence | Apache 2.0 — see `LICENSE` |

## Why it is copied and not installed

Of that monorepo's thirteen packages only two are published to npm:
`@workflowbuilder/sdk` (2.3.0, a normal dependency here) and `@workflowbuilder/ui`
(marked publishable but `npm view` returns 404). `execution-core` and `types` are
`"private": true` at version `0.0.0`, so `npm install` cannot reach them. The
licence permits copying; the cost is that this does not update, carries no
semver, and `0.0.0` is upstream saying it promises no stability.

## What is here — twelve files

Ten are the exact transitive closure of `graph-runner.ts`, computed from the
import graph rather than selected by eye. The other two arrived later and are
marked.

```
execution-core/graph-runner.ts          runGraph — topological traversal
execution-core/resolve-start-node.ts    finds the entry node
execution-core/execution-context.ts     per-run context
execution-core/errors.ts                the NodeExecutionError family
execution-core/redact.ts                redaction on emitted events
execution-core/ports/workflow-engine.port.ts
execution-core/ports/activity-runner.port.ts
execution-core/ports/event-emitter.port.ts
types/workflow-execution/execution-model.ts
types/workflow-execution/execution-events.ts

templates/resolve-template.ts           ← ADDED 2026-09-10, not in the closure
templates/resolve-template.test.ts      ← upstream's test, EDITED — see Divergences
```

⚠️ The last two contradict what this file used to say twice over: they were
listed as *deliberately left behind*, and the rules below say KALFA's tests live
beside our adapter. `0598bdb` took the file to resolve `{{…}}` references in
node configs, and twelve of our modules import it today. Its test came with it
because it pins upstream's grammar, which is the thing our copy must not drift
from — but it did NOT come unchanged, and divergence 3 below says what was cut.

Upstream's own README describes this layer as "pure mechanism for executing
workflow graphs — no Temporal, no HTTP, no database, no node vocabulary", and
names `BullMQEngine` among future adapters. A pg-boss adapter is that shape.

## What was deliberately left behind, and why

| Not taken | Reason |
|---|---|
| ~~`templates/resolve-template.ts`~~ | **No longer true — it was taken on 2026-09-10 (`0598bdb`).** The ES2018 objection was real and is measured below; it was solved by converting the named groups rather than by leaving the file out. |
| `index.ts`, `workflow.ts` | Barrels that re-export everything, including the file above. |
| `registry/node-executor-registry.ts` | A convenience for mapping node types to executors. `runGraph` takes an `ActivityRunnerPort`; we implement that port directly. |
| `console-logger.ts`, `ports/logger.port.ts` | This project has its own logging. |
| `reconstruct-node-inputs.ts` | Reachable only through the barrel. |
| Everything under `apps/` | `apps/backend` (Hono) and `apps/execution-worker` (Temporal) are upstream's reference stack. We run on pg-boss, and upstream states the bundled backend has "no authentication, authorization, user/tenant isolation, and no CORS restrictions" and must not be exposed. |

## Divergences — the complete list, each measured

**1. Import paths, in every file that has one.** Upstream resolves
`@workflow-builder/types/...` through a pnpm workspace alias that does not exist
here; ours are relative. Mechanical, unavoidable, and the ONLY difference in ten
of the twelve files — verified by diffing each against `2d987d3`.

**2. `errors.ts` is ahead of the pinned commit.** `extractDeepestError` returns
the deepest NON-EMPTY message, cherry-picked from `badcca6`. Measured before
taking it: a refused connection arrives as `Cannot connect to API:` wrapping an
`AggregateError` with no message of its own, and the old walk returned `''` — so
a failed node reached the canvas with no reason on it. A normal cause chain is
unchanged by the fix.

**3. `templates/resolve-template.ts` carries two KALFA changes.** This is the one
file where a re-sync is a merge rather than a diff, and it is why the "never
edited" claim at the top of this file was removed.

*Numbered capture groups instead of named ones.* Measured: `tsc --target ES2017`
rejects a named group with `error TS1503`; ES2018 accepts it. `tsconfig.json`
targets ES2017. Behaviour-preserving — the two implementations were run against
seventeen inputs covering whitespace, nested paths, `?`, `default:'…'`, a default
containing `}`, malformed tokens, unknown namespaces and plain text, and agreed
on all seventeen INCLUDING the wording of every throw.

*Three upstream tests deleted from `resolve-template.test.ts`.* They asserted
`PermanentNodeExecutionError` with codes `template_malformed` and
`template_unresolved` — which `badcca6` introduced and our copy does not throw,
because it still raises a plain `Error` and `activity-runner.ts` classifies it
one layer up. They could not pass, so they were removed; the file now holds 37
tests where upstream holds 35, five of them ours.

⚠️ AND THAT DELETION COST THE SIGNAL. Those three were the only thing that would
have failed when our copy diverged on error types — removing them is why the
divergence went unrecorded until a diff against upstream found it. If the codes
are ever adopted, note that `activity-runner`'s wrapper discards them: it builds
a fresh `PermanentNodeExecutionError('unresolved_template_reference', …)` with no
`cause`, and `extractDeepestError` takes the FIRST code it meets walking the
chain. Measured: passing `{ cause }` does NOT preserve the inner code — only
re-throwing the original does.

*A `deferSecrets` option, default `false`.* With it off the file behaves exactly
as upstream (those same 17/17). With it on, `{{secrets.NAME}}` passes through
untouched so the outbound port can substitute it at the socket; every other
unknown namespace still throws. Measured why it is needed: `redact.ts` matches on
KEY names, and a webhook header row is `{ key: 'Authorization', value: '…' }` —
so `redactSensitive` leaves the secret in plain text, as it does for a Slack
webhook URL that is itself the credential.

## Rules

- **Prefer not to edit these files**, and when an edit is unavoidable, add it to
  the list above with the measurement that forced it. A re-sync of anything not
  listed there is a plain diff; `resolve-template.ts` is a merge.
- **Do not import from here outside `src/lib/workflow/`.** The rest of KALFA
  talks to our own adapter, so the vendored surface can be replaced without a
  cross-cutting change.
- KALFA's tests live beside our adapter, not here. `resolve-template.test.ts` is
  the exception: upstream's own file, taken with the module it tests and then
  EDITED — three of its tests removed because our copy cannot pass them, five of
  ours added. That is the one place where something here was changed to fit our
  version, and divergence 3 is where it is written down.

## Re-syncing

Clone the repo at a newer commit, recompute the closure of `graph-runner.ts`,
diff against these files, and update the commit above. Expect the import paths to
differ everywhere, `errors.ts` to already match anything at or after `badcca6`,
and `resolve-template.ts` to need a real merge against the two divergences. Upstream has no
`Unreleased` changelog section, so release notes are not a reliable signal —
compare the types.
