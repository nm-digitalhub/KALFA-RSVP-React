# Workflow editor — implementation plan

**Objective.** One real vertical slice: an inbound WhatsApp message starts a workflow the
owner drew in the admin panel, a condition branches on its text, and a guest's RSVP status
actually changes in the database. Nothing stubbed.

Approved 2026-09-09. Written against measured facts; every claim that could have been
assumed is marked with where it was checked.

---

## 1. The slice

```
טריגר: הודעת וואטסאפ נכנסת            trigger.whatsapp_inbound
    ↓
תנאי:  הטקסט מכיל "כן"?               logic.condition
    ↓ true
פעולה: עדכן סטטוס אורח ל-attending    action.update_guest_status
```

Three node types. Each goes through the **full vertical slice**: catalogue entry → property
schema → renders in the editor → converts to `WorkflowDefinition` → validates → executes.
Execution is real: pg-boss runs it, the row changes.

`update_guest_status` is deliberately the first action rather than `send_whatsapp`. It is
fully real and irreversible enough to prove the chain, but it sends nothing outward, so a
mistake during development cannot message a guest. `send_whatsapp` is the next node, once
the chain is proven.

---

## 2. Where it plugs into what already exists

| Existing | Verified at | What we add |
|---|---|---|
| Inbound webhook, persist-then-process (B2) | `src/app/api/webhooks/whatsapp/route.ts:270` | **nothing.** The route persists and returns, exactly as today |
| Webhook drain | `src/lib/data/webhook-processing.ts`, `QUEUES.webhook` | the only place a run is enqueued — one inbox row, one run |
| RSVP button → status map | `src/lib/whatsapp/rsvp-buttons.ts:27` (`RSVP_BUTTON_MAP`) | reused by the action node, not duplicated |
| Queue registry | `src/lib/queue/queues.ts:3` | one new queue, `workflowStep` |
| Vendored runner | `src/lib/workflow/vendor/workflowbuilder/` (10 files, commit `2d987d3`) | `WorkflowEnginePort` + `ActivityRunnerPort` over pg-boss |

The existing RSVP path stays exactly as it is. A workflow is an **additional** consumer of
the same inbound event, not a replacement — nothing that works today changes behaviour.

---

## 3. The conversion contract — binding

The editor's JSON and the runner's model are **different types**. `PaletteItem` /
`WorkflowBuilderNode` belong to the SDK; `BaseNode` belongs to the execution model and
carries `role?: NodeRole`. Measured: `grep isStartNode` over the vendored runner returns
nothing — `resolve-start-node.ts:20` filters on `node.role === 'start'`.

The adapter is the only bridge, and it obeys eight rules:

```
WorkflowBuilderNode
        │
        │  KALFA adapter
        │
        ├── type in catalogue, marked trigger  →  role: 'start'
        ├── type in catalogue, not a trigger   →  role left undefined
        └── type not in catalogue              →  validation error
```

1. **The node-type catalogue decides** which types may begin a flow — not the SDK, not the
   stored JSON. This is not a preference: `isStartNode` does not exist in
   `@workflowbuilder/sdk@2.3.0` (`dist/index.d.ts` has no such identifier), so the editor
   built from the installed package can neither write nor preserve it.
2. The adapter is the **only** writer of `role: 'start'`.
3. **`role` arriving from the client or from stored JSON is discarded unconditionally** —
   not validated, not merged. Discarded.
4. Exactly **one** start node.
5. An unknown node type is rejected **before** execution.
6. An incoming edge into the start node is rejected.
7. An orphan node that is not the start node is rejected.
8. **Start is never inferred from in-degree zero.** Upstream's own reasoning, which we
   inherit (`resolve-start-node.ts:10-15`): in-degree cannot distinguish an intentional
   trigger from a node whose only incoming edge was deleted — the orphan would run in the
   first wave with no upstream output, and that output would still flow downstream.

### Naming, kept apart

`number_roles` says what a **provider phone number** is used for. `BaseNode.role` says what
a **node** is within an execution graph. They share a word and nothing else: no shared
resolver, no shared type, no import between them. A grep for one must never surface the
other's logic.

---

## 4. Data

### 4.1 Table

`workflows` — one row per saved diagram.

| column | why |
|---|---|
| `id` uuid pk | |
| `event_id` uuid fk nullable | a workflow may be global or scoped to one event |
| `name` text | shown in the editor header |
| `definition` jsonb | the editor's format verbatim: `{ name, layoutDirection, nodes, edges }` — documented as "the same format used when saving to local storage, sending to an API, or passing in via props" |
| `is_active` boolean default false | drawn ≠ armed. A workflow does nothing until switched on |
| `version` integer | auto-save writes often; see the risk below |
| `created_at` / `updated_at` | |

`workflow_runs` and `workflow_run_steps` — the execution record. A step row is written
**before** its side effect, so recovery after a crash is a query rather than a replay.

RLS mirrors `channels` (`20260726111038`): admin-all through the cookie client, service_role
for the worker. Verified as `authenticated` non-admin returning zero rows, per the
`querying-live-supabase` skill.

### 4.2 Migrations

Through `supabase migration new` → dry run inside `begin; … rollback;` → `db push --linked`
→ `gen:types`. No hand-written migration files.

---

## 5. Modules

```
src/lib/workflow/
├── vendor/workflowbuilder/     10 files, untouched, not imported outside this directory
├── catalogue/                  node types: id, label, icon, isTrigger, schema, uischema, defaults
├── adapter/
│   ├── to-definition.ts        editor JSON → WorkflowDefinition<KalfaNode>, the 8 rules
│   └── validate.ts             errors, named, before any execution
├── engine/
│   ├── pg-boss-engine.ts       WorkflowEnginePort over pg-boss
│   └── activity-runner.ts      ActivityRunnerPort → the step handlers
├── steps/                      one file per node type: the handler
└── index.ts                    the public surface; the rest of KALFA imports only this
```

`createMetaGraphClient`'s pattern applies here too: the vendored runner is generic, our
adapter supplies the vocabulary.

---

## 6. Execution, and what a naive runner gets wrong

pg-boss guarantees **at-least-once**. A crash between "the side effect happened" and "the
job was acked" re-runs the step. Four rules, each from a real failure mode:

1. **One job per step.** A single job walking five steps replays the three that already ran.
2. **Idempotency key per (run, step, target)**, claimed atomically before the side effect.
   The existing `detId` / `deferId` + reserve CAS (`src/lib/outreach/enqueue.ts:42`) is
   exactly this shape — extend that key space, do not build a second one.
3. **Never hold a job open across a wait.** A wait completes its job and enqueues a
   successor with `startAfter`. Durable at any duration.

   **This rule does not hold against the vendored runner, and it is not implemented.**
   `runGraph` has no pause/resume seam: it resolves the start node and then drives waves
   with `Promise.all` until the graph ends. A wait node would have to block inside
   `executeNode` and hold the worker for the duration. Nothing breaks in v1 — the slice
   has no wait node — but the rule is a design constraint on a **future** engine, not a
   description of this one. Recorded here so step 4 does not discover it. See §9.
4. **Persist the step's output, not an accumulated in-memory array** — with a retention
   window, because execution data is guest PII.

---

## 7. Editor page

`/admin/integrations/workflows`, `'use client'`.

- `<WorkflowBuilder.Root nodeTypes={…} integration={{ strategy: 'props', onDataSave }} />`
  — the documented callback strategy; `onDataSave` is a Server Action that already carries
  `requireAdmin`. No new endpoint, no CORS.

  **`integration` must be passed explicitly.** Its default is
  `{ strategy: 'localStorage' }` — omit the prop and the workflow is written to the
  browser instead of to us, silently and with no error. The other server strategy,
  `'api'`, is excluded for a stated reason rather than a preference: upstream documents
  that it "issues plain `fetch()` calls with no auth headers", and points at `'props'` for
  anything needing `Authorization`. An unauthenticated save endpoint is not something this
  project can hold, so `'props'` is the only candidate; the choice is forced, not aesthetic.

  The contract is `(data, savingParams?) => Promise<DidSaveStatus>`, where `DidSaveStatus`
  is `'success' | 'error' | 'alreadyStarted'`. **Two things about it are traps.**

  First: resolving to `'error'` does not show the user an error. Upstream states that the
  runtime "treats every non-empty resolution as 'the save finished' and surfaces the
  success-style snackbar — so all three variants currently look identical at the UI layer",
  and that you must **throw** to get an error snackbar. A save that failed would otherwise
  report success, and the owner would close a workflow believing it was stored. Our action
  therefore throws on failure and only ever resolves `'success'`.

  Second: `savingParams.isAutoSave` distinguishes a deliberate save from a background one.
  That is the lever for the auto-save risk below — the two are handled differently rather
  than written blind at the same rate.
- **Our own toolbar** via `useWorkflowBuilderActions()` instead of `<TopBar>`, so it is
  Hebrew and matches the panel. Two consequences of dropping the bar: the hook **must be
  called from a descendant of `<Root>`** — called outside it, `save()` resolves `'error'`
  and only logs a warning, i.e. the button appears to work and saves nothing — and the
  workflow name is no longer rendered by anything, so the page reads `documentName` and
  writes `setDocumentName` through `useStore` itself.
- **`isValidConnection` refuses an edge into the trigger while it is being drawn.** That is
  rule 6 of the conversion contract, enforced a second time at the point of gesture so the
  owner never draws an invalid graph and learns about it only on save. It is a courtesy,
  **not** the enforcement: the adapter stays authoritative, because a graph can also arrive
  by import or by a hand-edited row, and neither passes through this prop.
- `nodeTypes` at **module scope** — the docs require a stable reference or the editor
  re-renders on every change.
- **One `<Root>` per page.** Two clash silently on module-level singletons.
- The SDK's `style.css` sets `body { overflow: hidden }` and `html,body,#root { height:
  100vh }`. They ship inside `@layer reset`, so our rules win automatically — but the page
  must set them deliberately rather than discover this in production.

### What importing the SDK does to the rest of the app

`import '@workflowbuilder/sdk'` runs module-level side effects on shared singletons. Two
matter, and the first one upstream describes as a global regression — measured here, it is
not one **yet**:

- **`immer.setAutoFreeze(false)`.** ReactFlow mutates the objects the SDK produces, so the
  SDK disables auto-freeze on import. Upstream warns this is global, "because immer is a
  shared, deduped dependency" — any of the host's own reducers lose frozen-draft
  protection. In this tree it is not deduped. `npm ls immer` resolves **two** instances:
  `immer@10.2.0` nested under `@workflowbuilder/sdk/node_modules`, and `immer@11.1.18`
  hoisted and shared by `zustand@5.0.15`, `@xyflow/react`'s `zustand@4.5.7` and
  `@reduxjs/toolkit@2.12.0` (pulled in by `recharts`). The `setAutoFreeze(false)` call lands
  on the 10.x copy only; nothing else in the app sees it. KALFA's own `src/` imports immer
  nowhere, so today the blast radius is zero.

  **The reason to write this down is the upgrade.** The day the SDK moves to immer 11, npm
  collapses the two into one instance and that call silently starts applying to RTK and to
  our zustand. It is a version-resolution accident protecting us, not a design. Re-run
  `npm ls immer` on every SDK bump and treat one line of output as the check.

- **`i18next.init(...)`** with the SDK's bundled `en` and `pl`. Per i18next's contract a
  second `init` is a no-op, so **whichever initialises first wins the shared registry**.
  KALFA does not use i18next today; if it ever adopts one, import order decides the
  outcome, and the SDK's is not the configuration we would want to win.

Two limits belong beside them: **one `<Root>` per page** (the plugin, decorator, JsonForms
and i18n registries are module-level singletons — two mounts fight over them silently, and
swapping workflows means mount → save → unmount → mount), and **import only from the
package root**. The `@workflowbuilder/sdk/<subpath>` exports ship raw `.ts` reaching into
internals "that may change without notice"; upstream states they are for monorepo use.

None of this is visible at runtime, which is exactly why it is in the plan and not left to
be discovered.

### Plugins — two are needed and are not built in

`undo-redo` and `copy-paste` are **plugins, not core behaviour**. Load neither and the
editor has no Ctrl+Z and no copy-paste — unacceptable for someone arranging a graph. Both
are Community-badged; their source is `apps/demo/src/app/plugins/` in the clone and is not
published, so they are vendored the same way as the runner, under the same rules.

They were included in the first vendoring pass and dropped when the copy was reduced to the
ten files `runGraph` needs. That reduction was right for execution and wrong for the editor:
re-add them when step 4 starts, not before, and recompute their closure the same way.

The plugin API is also where two of this plan's open ends get resolved, and it reaches
further than the props do — upstream lists palette **and pre-built workflow templates**,
properties-panel **tabs**, menu items, translations, and **diagram-change observation**
among its hook points, "without touching core code":

- **State tracking** is where the auto-save throttle hangs, rather than debouncing inside
  the save action.
- **Translations** (`registerPluginTranslation`) is how Hebrew arrives, since the SDK ships
  `en` and `pl` only.

A plugin is just `() => void` — a synchronous function calling `register*`, invoked once per
`<Root>` on first mount through a lazy `useState` initializer. Three registration functions
cover it: `registerComponentDecorator(slot, …)` renders `'before' | 'after' | 'wrapper'` a
named slot (`OptionalAppBarControls`, `OptionalAppBarTools`, `OptionalNodeContent` — which
receives `nodeId` — `OptionalEdgeProperties`, `OptionalFooterContent`, `OptionalAppChildren`,
`OptionalHooks`), or rewrites the host's props via `modifyProps` without rendering anything;
`registerFunctionDecorator(fn, …)` intercepts a decorable function before or after, returning
`{ replacedParams }` or `{ replacedReturn }` to substitute rather than merely observe — the
named ones include `getPaletteData`, `getTemplates` and `trackFutureChange`; and
`registerPluginTranslation`.

**Always pass `name` to the two decorators.** (`registerPluginTranslation` takes only a
resource — it merges, so it has nothing to deduplicate.) The registries are module-global
singletons and the functions are side-effecting, so `name` is the only thing deduplicating
them. Under Fast Refresh a module re-evaluates while the registry survives, and a nameless
decorator accumulates a copy per edit — a button that quietly becomes three buttons in dev.

`modifyProps` on a built-in slot should be typed with the SDK's exported props type
(`DiagramContainerProps`, `PropertiesBarProps`, `ProjectSelectionProps`) so the rewrite is
checked against the real host shape instead of `object`.

### Theming

The editor is fully themeable through the `--ax-*` token layer — backgrounds, text, node
colours, buttons, spacing, radius, shadows — and both light and dark are defined
separately. Upstream's own words: the styled layer is "isolated in cascade layers, so you
can retheme or replace it… **without fighting against built-in component styles**". Same
decision as `style.css`'s `@layer reset`: our overrides win without `!important`.

Their design system follows Atomic Design on headless Base UI primitives — atoms, molecules,
organisms, templates — which is the same structure and the same foundation as
`src/components/ui/`. Visual integration is therefore a token file, not a fork.

What tokens do **not** solve is direction: they cover colour, spacing and typography, never
RTL. That risk stands and is settled by rendering, not by reading.

### Property forms — where "not hard-coded" actually happens

Property forms are JSON Schema + UI Schema through JSONForms; conditional visibility is
supported (`rule: { effect: 'SHOW', condition: … }`) and we will use it.

This is the part of the SDK that carries the original requirement. A node's fields come
from the `schema` / `uischema` on its catalogue entry, so adding a step type is adding a
row's worth of definition — no editor code changes. But plain JSON Schema only gets us
primitives, and the fields that matter here are not primitives: *which WhatsApp template*,
*which phone number*, *which event*. Typed as `string`, each is a free-text box the owner
can spell wrong, and the graph would carry an id that resolves to nothing until the run
fails. Each of those is a **custom renderer** reading the live list — a select over our own
data, validated when it is chosen rather than when it is executed.

The mechanism is the `jsonForm` prop:

```ts
jsonForm?: { renderers?, cells?, translations? }
```

Consumer renderers are tested **before** the built-ins, and on a rank tie ours wins — that
is also how a built-in control gets replaced rather than merely extended.

Four rules, each from a stated upstream constraint:

1. **Never add `@jsonforms/*` to `package.json`.** Every primitive we need — the
   `withJsonForms*Props` HOCs, `useJsonForms`, `JsonFormsDispatch`, the testers
   (`rankWith`, `uiTypeIs`, …), `RuleEffect`, `ControlProps` — is re-exported from
   `@workflowbuilder/sdk`. Upstream is explicit about the failure mode: a renderer wrapped
   with a HOC from a second copy "would read from a different React context and silently
   receive empty props". Silently. Measured, the tree holds exactly one copy today —
   `@jsonforms/core@3.8.0` and `@jsonforms/react@3.8.0`, both under the SDK — so this rule
   is about not creating the second one. A dependency-cruiser rule forbidding
   `@jsonforms/*` outside the SDK is cheaper than debugging an empty form.
2. **Supplying any `cell` drops all built-in cells.** Renderers merge; cells do not — "if
   you provide any, yours are used as-is". So we supply cells only if we are prepared to
   own the whole set. Default: renderers only.
3. **Hebrew labels arrive as `translations`**, merged into the `plugins.*` namespace — the
   declarative twin of `registerPluginTranslation`. Two routes to the same registry; pick
   one and keep to it, or the source of a string becomes a guessing game.
4. **No `@jsonforms/material-renderers`.** The SDK depends on core and react only and
   renders with its own controls, so the panel already matches the design system. Pulling
   the Material set in would import a second design language and a second copy of the
   context along with it.

---

## 8. Tests

The ten that the contract requires, each a named case:

| # | Case | Guards rule |
|---|---|---|
| 1 | one trigger, no incoming edge → `role: 'start'` | 1, 2 |
| 2 | no trigger → fails **before** `runGraph` | 4 |
| 3 | two triggers → fails | 4 |
| 4 | an edge into the trigger → fails | 6 |
| 5 | an extra orphan → fails | 7 |
| 6 | `role: 'start'` injected into a normal node's JSON → **not accepted** | 3 |
| 7 | unknown node type → **never reaches** `ActivityRunnerPort` | 5 |
| 8 | node and edge ids convert unchanged | — |
| 9 | `sourceHandle` preserved, so decision and error branches work | — |
| 10 | validation fails → **no node runs** | 5, 8 |

Cases 7 and 10 assert **a call count of zero on a spy port**, not merely the absence of an
error — an adapter that silently swallowed the graph would otherwise pass.

**An eleventh, and it is not decoration.** A namespaced template reference in any string
property → validation fails, no node runs — **and `{{1}}` still passes**. Both directions
are asserted, because KALFA's own WhatsApp bodies are full of Meta's positional
placeholders (85 occurrences across `src/lib/data/outreach.ts`,
`outreach-engine.ts`, `campaigns.ts` and the Voximplant signup-link route). A guard
matching bare `{{` would reject legitimate content. The reasoning is in §9.

Plus, for the real chain: an integration test that posts an inbound webhook payload and
asserts the guest row changed, and one that posts the same payload twice and asserts it
changed **once**.

---

## 9. Risks, measured

**A pg-boss retry re-runs the entire graph, not the failed node.** `runGraph` keeps no
per-node checkpoint — on a retry it resolves the start node again and replays every wave,
side effects included. So "a step row is written before its side effect" is only a recovery
story if the database refuses the second write: `workflow_run_steps` carries
`unique (run_id, node_id)`, the handler claims that row first, and a unique violation is
read as "another attempt owns this node", never swallowed. Without the constraint two
concurrent attempts both insert and both send.

**`deadLetter: QUEUES.dead` would crash the dead-letter consumer.** `handleDead` hard-assumes
an `OutreachStepJob` shape; a workflow payload is not one. `CALL_RETRY` already omits
`deadLetter` for exactly this reason and says so in a comment. `WORKFLOW_RETRY` follows that
precedent — retries, no dead-letter — rather than copying `STEP_RETRY` verbatim, which would
fail only on the third retry of a real job, in production.

**A wait node cannot be durable on this runner** (§6 rule 3). There is no seam to complete a
job at and resume the graph in a successor; a wait would hold the worker for its duration.
The v1 slice has no wait node. Adding one means an engine change, not a node.

**A template reference the editor writes and nothing resolves.** This one is new, and it is
the sharpest thing in this batch of documentation.

The editor has a variable picker. Type `{{` in a property field and a panel offers the
outputs of ancestor nodes; the field then shows a chip, and the diagram stores the raw form
`{{nodes.<nodeId>.<property>}}`. Upstream states it plainly: "The SDK only stores these
references as text on the diagram. Actual values are filled in later, when the workflow
runs." The component that fills them in is `resolve-template.ts` — **the one file we
deliberately did not vendor.**

So the two halves are split down the middle: the editor writes the reference, and our
runtime has nothing that reads it. A `{{nodes.x.response}}` typed into a message body
reaches the step handler as those exact characters and is sent verbatim.

Two facts make this worse than a note in the out-of-scope list:

- The picker is wired only onto built-in AI Agent and Decision fields, and only ancestors
  declaring an `outputSchema` appear in it. That field is real and it is ours to control:
  `NodeDefinition` in `dist/index.d.ts` carries `outputSchema?: NodeOutputSchema`, commented
  "used by the variable picker". Omit it on our catalogue entries and no node of ours is
  ever offered as a source — which is the v1 position, deliberately, not an accident. But
  `trigger.<path>` and `variables.<path>` are documented as **manual entry**: "Typing `{{`
  opens the suggestions panel… keep typing past it to enter a `trigger.*` reference as
  plain text." Nothing stops the owner typing `{{trigger.guest.name}}` into any text field
  in the panel, and it will look to them like it works — it is, after all, how the product
  is documented.
- The failure is silent and outbound. Not a crash, not a log line: a message delivered to a
  guest with `{{trigger.guest.name}}` in it, over WhatsApp, from KALFA.

**The guard: the adapter rejects a namespaced template reference before execution.**

```
/\{\{\s*(nodes|trigger|variables)\./
```

Anchored on the namespace, not on `{{`. Every form the editor can write carries one —
`{{nodes.…}}`, `{{trigger.…}}`, `{{variables.…}}`, and the `?` / `| default:` modifiers sit
after the path, inside the same expression. Meta's positional `{{1}}` matches none of them,
which matters: this codebase has 85 of those, and a guard on bare `{{` would reject the
message bodies we actually send. Fail closed on the first, pass the second, and let test 11
assert both — `{{trigger.guest.name}}` rejected, `{{1}}` accepted.

The owner gets an error naming the node and the field; nobody gets a broken message. Three
lines and one test, converting a data-quality incident into a validation error.

When a template evaluator does become its own task, upstream's semantics are already fixed
and should be matched rather than reinvented: a plain reference is **strict** — an
unresolvable path fails the run with `Unresolved template reference: {{…}}`, deliberately,
"not silently substituted with an empty string" — with two opt-in modifiers, `{{x?}}` for
`''` and `{{x | default:'tbd'}}`. Dot paths only: no array indexing, no filters, no
transforms. Note also that `trigger.<path>` and `nodes.<triggerNodeId>.<path>` are **not**
the same value — the first is the raw payload that started the run, the second is whatever
the trigger node emitted.


| Risk | Evidence | Response |
|---|---|---|
| **Auto-save frequency** | Docs: the editor "saves data before the user exits", not only on click. The Server Action will be called at a rate we do not control | `savingParams.isAutoSave` separates the two cases; version the row and throttle the background one. Never blind-write per keystroke |
| **Same message processed twice** | pg-boss is at-least-once; n8n does not solve this and its retry makes it worse | The idempotency claim above, on the existing key space |
| **No auto-layout** | `elk-layout` is Enterprise (€6,990) | The owner arranges manually. Felt on a large graph; blocks nothing |
| **No in-editor validation** | `validation` is Enterprise | We validate server-side on save, which is the correct boundary anyway — the editor can be wrong, the server cannot |
| **RTL unknown** | `packages/sdk/src/features/i18n/locales/` contains `en.ts` and `pl.ts` only. `layoutDirection` is `'DOWN' \| 'RIGHT'` — graph flow, not text direction | Hebrew strings via `registerPluginTranslation`; RTL must be checked by rendering, not by reading docs |
| **Vendored code does not update** | `execution-core` is `private: true` at `0.0.0`, absent from npm | Ten files, pinned to commit `2d987d3`, re-sync by diff. Documented in its README |
| **Docs describe `main`, not 2.3.0** | `isStartNode`, `ProjectSelection`, `PropertiesBar`, the whole UI Library section | `dist/index.d.ts` of the installed package is the only contract. `docs/workflowbuilder-sdk-reference-2026-09-09.md` marks every entry |

---

## 10. Order

1. **Table + RLS + types.** Verified live as a non-admin `authenticated` role.
2. **Catalogue + adapter + the ten tests.** No editor yet, no execution — the contract first,
   because it is the part that must never be wrong.
3. **Engine over pg-boss + the three step handlers.** Drive it from a hand-written JSON
   fixture. If a hand-written definition runs and changes the row, execution works.
4. **The editor page.** Last, because by then it only has to produce the JSON that step 3
   already proved.

Ordering 3 before 4 is deliberate. Building the editor first would mean discovering at the
end whether execution works at all.

---

## 11. Gates

`npx tsc --noEmit` · `npm run lint` · `npm run worker:deps` · `npm run build` · the full
test suite · `git diff --stat src/lib/workflow/vendor/` **empty**, proving the vendored code
was not touched · RLS verified live · the editor rendered and checked in RTL in a browser,
because no static gate can see that.

---

## 12. Explicitly out of scope

Real sends (Meta, Voximplant, ExtrA, Slack) beyond `update_guest_status` · variable and
template resolution — `resolve-template.ts` was deliberately not vendored, it needs
`target: ES2018` and is not a dependency of `runGraph`; a template evaluator is its own
decision, and until it exists the adapter **rejects** `{{` rather than passing it through
(§9) · `provider_numbers` and `number_roles` · Enterprise plugins.
