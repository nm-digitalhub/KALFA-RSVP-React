# vendor/workflowbuilder

Third-party source. **Not ours, not edited.**

| | |
|---|---|
| Repository | <https://github.com/synergycodes/workflowbuilder> |
| Commit | `2d987d3b01618306eef898c0eb0c0d08ee207016` (2026-09-04) |
| Upstream paths | `packages/execution-core/src`, `packages/types/src` |
| Licence | Apache 2.0 — see `LICENSE` |

## Why it is copied and not installed

Of that monorepo's thirteen packages only two are published to npm:
`@workflowbuilder/sdk` (2.3.0, a normal dependency here) and `@workflowbuilder/ui`
(marked publishable but `npm view` returns 404). `execution-core` and `types` are
`"private": true` at version `0.0.0`, so `npm install` cannot reach them. The
licence permits copying; the cost is that this does not update, carries no
semver, and `0.0.0` is upstream saying it promises no stability.

## What is here — ten files, chosen by closure

The exact transitive closure of `graph-runner.ts`, computed from the import
graph, not selected by eye:

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
```

Upstream's own README describes this layer as "pure mechanism for executing
workflow graphs — no Temporal, no HTTP, no database, no node vocabulary", and
names `BullMQEngine` among future adapters. A pg-boss adapter is that shape.

## What was deliberately left behind, and why

| Not taken | Reason |
|---|---|
| `templates/resolve-template.ts` | Needs `target: ES2018` (named capture groups, line 51) and this project targets ES2017. It is **not** a dependency of `runGraph` — only of the `index.ts` barrel — so leaving it out removes the incompatibility without editing upstream code or changing the project's compiler target. If we later want a template evaluator, that is its own decision. |
| `index.ts`, `workflow.ts` | Barrels that re-export everything, including the file above. |
| `registry/node-executor-registry.ts` | A convenience for mapping node types to executors. `runGraph` takes an `ActivityRunnerPort`; we implement that port directly. |
| `console-logger.ts`, `ports/logger.port.ts` | This project has its own logging. |
| `reconstruct-node-inputs.ts` | Reachable only through the barrel. |
| Everything under `apps/` | `apps/backend` (Hono) and `apps/execution-worker` (Temporal) are upstream's reference stack. We run on pg-boss, and upstream states the bundled backend has "no authentication, authorization, user/tenant isolation, and no CORS restrictions" and must not be exposed. |

## Rules

- **Do not edit these files.** The one adjustment that looked necessary — the
  ES2018 regex — was avoided by not taking the file. Keep it that way: a future
  re-sync should stay a diff, never a merge.
- **Do not import from here outside `src/lib/workflow/`.** The rest of KALFA
  talks to our own adapter, so the vendored surface can be replaced without a
  cross-cutting change.
- KALFA's tests for this behaviour live beside our adapter, not in this
  directory. Nothing here should be modified to make a test pass.

## Re-syncing

Clone the repo at a newer commit, recompute the closure of `graph-runner.ts`,
diff against these files, and update the commit above. Upstream has no
`Unreleased` changelog section, so release notes are not a reliable signal —
compare the types.
