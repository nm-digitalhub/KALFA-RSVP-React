# Workflow Builder SDK — complete documentation reference

Generated 2026-09-09. This is an unfiltered transcription of every Workflow Builder
documentation page, with each API entry marked against the version of the SDK actually
installed in this repository.

## How to read this file

### Three different artifacts, three different API surfaces

The documentation, the repository, and the npm package are **not** the same thing. All three
were inspected separately:

| Artifact | What it is | Identified by |
| --- | --- | --- |
| **Installed package** | `@workflowbuilder/sdk@2.3.0`, at `/var/www/vhosts/kalfa.me/beta/node_modules/@workflowbuilder/sdk`. Dated `2026-08-12` in its own bundled `CHANGELOG.md`. Its full public type surface is the 2,452-line `dist/index.d.ts`. | version in `package.json` |
| **Repository clone** | The `synergycodes/workflowbuilder` monorepo at HEAD `2d987d3` (2026-09-04), branch `main`. Docs content lives at `apps/docs/src/content/docs/**`. | `git log -1` |
| **Live docs site** | `https://www.workflowbuilder.io/docs/…`. Its build commit is **not knowable from the outside** — the site exposes no build id. Do not assume live == `main`; it is measurably older (see below). | fetched 2026-09-09 |

### Which source each section came from

- **Everything except the API reference** is transcribed from the repository clone
  (`apps/docs/src/content/docs/**`), i.e. it describes `main`, not the npm package.
- **The API reference (§8)** does not exist in the content directory at all. Those pages are
  generated at docs-build time by `starlight-typedoc` from `packages/sdk/src/index.ts`
  (see `apps/docs/astro.config.mjs`), into a gitignored `src/content/docs/api/` folder. The
  clone has no `node_modules`, so TypeDoc could not be re-run locally; §8 was therefore
  scraped from the **live site** — 134 pages, HTML→Markdown.

### Drift markers

Every API entry in §8 carries one of:

- **✅ in 2.3.0** — documented and present in the installed `dist/index.d.ts`.
- **⚠️ main only** — documented (or exported by `main`) but absent from 2.3.0. Where the page
  puts it in TypeScript, code copied from it will not compile against the installed package;
  where it appears only in prose or in a saved-diagram JSON payload, the marker says so and
  claims no compile failure.
- **❓ unverified** — could not be checked.

Content pages outside §8 carry a `⚠️` blockquote only where a specific drift was found.

---

## 0. Drift map — documentation vs. installed `@workflowbuilder/sdk@2.3.0`

### 0.1 How this was measured (not inferred)

Four mechanical checks, all run against the installed `dist/index.d.ts`:

1. **Symbol-level presence.** Extracted all 136 exported names from `dist/index.d.ts`;
   matched each of the 134 live API pages to a name. **0 pages had no matching export.**
2. **Compile check.** Generated a probe importing all 136 names plus the two `main`-only
   barrel exports, and ran `tsc` with `@workflowbuilder/sdk` mapped to the installed
   `dist/index.d.ts`. Only two `TS2305`/`TS2724` "has no exported member" errors came back —
   `ProjectSelection` and `PropertiesBar`. Every other documented symbol compiles.
3. **Member-level presence.** Extracted every `` `member`: `` token from the 134 converted API
   pages and checked each against the identifiers in `dist/index.d.ts`. **0 missing.** The
   live API reference therefore matches 2.3.0 at both symbol and member level.
4. **Content-doc scan.** Extracted every name imported from `@workflowbuilder/sdk` across the
   clone's 74 content pages (24 distinct names — all present in 2.3.0), then every object key
   and member access inside every fenced code block, filtered against `dist/index.d.ts`
   identifiers. `isStartNode` was the only genuine SDK-API hit. (`maxZoom`, `onNodeClick`,
   `zoomOnDoubleClick` are `@xyflow/react` props forwarded through `reactFlowProps`;
   `accentColor`, `retryOnFailure`, `tokensUsed`, `colorPicker` are fields in the docs' own
   worked examples, not SDK API.)

### 0.2 The three drifts found

| # | Drift | Where documented | Evidence | Marker |
| --- | --- | --- | --- | --- |
| 1 | **`isStartNode`** — a top-level palette-item field, copied onto `node.data.isStartNode` | As **TypeScript a reader would copy**: `guides/add-a-custom-node.mdx` (twice) and `guides/configuring-the-editor.md`. As **prose or saved-diagram JSON only**: `faq.md` (JSON payload at line 60, prose at line 75) and `nodes/trigger.mdx`. | 2.3.0: `declare type NodeDefinition<T> = { … } & Required<Omit<BaseNodeProperties, …>> & Pick<NodeData, 'type' \| 'icon' \| 'templateType'>` — no `isStartNode`. `main`: `packages/sdk/src/node/node-data.ts:35` reads `Pick<NodeData, 'type' \| 'icon' \| 'templateType' \| 'isStartNode'>`. `grep isStartNode dist/index.d.ts` → no hits. The **live** `add-a-custom-node` page does not mention it either (0 occurrences), which is how we know the live site predates `main`. | ⚠️ main only |
| 2 | **`ProjectSelection`** and **`PropertiesBar`** value exports | `packages/sdk/src/index.ts` on `main` exports both components. No content page or live API page documents the values (only `ProjectSelectionProps` / `PropertiesBarProps`). | `dist/index.d.ts:1208` and `:1225` read `/* Excluded from this release type: ProjectSelection */` and `/* Excluded from this release type: PropertiesBar */`. `tsc` confirms: `has no exported member named 'ProjectSelection'. Did you mean 'ProjectSelectionProps'?` and `has no exported member 'PropertiesBar'`. | ⚠️ main only |
| 3 | **The entire UI Library section** (26 pages) | `apps/docs/src/content/docs/ui-library/**`, wired into the sidebar in `astro.config.mjs` | `/docs/ui-library/overview/`, `/docs/ui-library/design-tokens/`, `/docs/ui-library/ui-components/button/` all return **HTTP 404** live. It documents `@workflowbuilder/ui`, a separate package not installed here. | ⚠️ main only |

**Everything else documented is ✅ in 2.3.0.** All 134 live API-reference entries and all 24
SDK imports used across the content docs compile against the installed package.

### 0.3 What the changelog does *not* tell you

`packages/sdk/CHANGELOG.md` on `main` has **no `Unreleased` section** — its newest entry is
`## [2.3.0] - 2026-08-12`, byte-identical to the copy bundled in the installed package. The
changelog therefore cannot be used as a drift map; the three drifts above were derived from
the types, not from release notes.

### 0.4 Two caveats on §8

- §8 reflects the **live** site, which is 2.3.0-era. If `main` has added API symbols since
  (beyond the two in drift #2), those pages do not exist live and are therefore **not in this
  file**. The only way to see them would be to run `pnpm build:docs` in the clone.
- The 13 API **category index** URLs (`/docs/api/core/`, `/docs/api/types/`, …) return HTTP 404.
  They are sidebar group labels, not pages. `/docs/api/` itself is a real hand-written landing
  page (`apps/docs/src/landing-pages/api-index.md`, copied into place by the `wb-api-landing`
  Astro plugin).

---

## 1. Overview

### What Is Workflow Builder?

*Source: `overview/index.mdx` — description: Workflow Builder is a React SDK that gives you a production-ready workflow editor on day one. Embed drag-and-drop workflow UIs into your product. Open-source Community Edition available.*

> _[Screenshot: Workflow Builder - canvas, node palette, and properties panel]_

Workflow Builder is a React SDK for building and embedding visual workflow editors into your application. It is available in open-source and enterprise editions.

It provides a ready-made workflow editor UI, including canvas, nodes, edges, layout, forms, and configuration panels, so you don't have to build workflow UX from scratch.

Workflow Builder focuses exclusively on the **frontend editor layer**.
Execution, orchestration, and business logic remain fully under your control.

Ready to try it? Start with the [Quick Start guide](/get-started/quick-start/standalone-app/).

#### Key features

- Visual workflow canvas with drag-and-drop interactions
- [Node library](/overview/features/node-library/) with triggers, actions, conditions, branching, and delays
- [Dynamic properties panel](/overview/features/properties-sidebar/) driven by JSON Schema
- [Auto-save](/overview/features/diagram-state-management/) to local storage or external API
- Read-only mode for viewing without edit permissions
- [Flow Runner](/plugins/flow-runner/) for graph traversal and step-by-step execution
- Zoom in / out for navigating workflows at any scale
- [Auto-layout](/plugins/elk-layout/) for automatic node and edge positioning
- [Smart edge routing](/plugins/avoid-nodes-edges/) that avoids collision with nodes
- [Edge reshaping](/plugins/reshapable-edges/) for fine-tuning connection paths on the canvas

#### Scope

Workflow Builder focuses exclusively on the frontend editor layer. The SDK outputs workflow definitions as JSON that your own backend consumes and executes. For in-editor execution, the optional [Flow Runner](/plugins/flow-runner/) plugin (Enterprise) can traverse the workflow graph and run node functions directly.

#### Typical use cases

Workflow Builder is commonly used to:

- embed workflow editors into B2B SaaS products
- build visual rule engines and configuration tools
- design AI agent and automation workflow platforms
- serve as a foundation for workflow-driven products and standalone apps

#### Live demo

[Open the live demo](https://app.workflowbuilder.io) to try Workflow Builder in your browser. To read and edit the code, open the <a href={STARTER_FORK_URL} target="_blank" rel="noopener noreferrer">runnable starter in StackBlitz</a> — a minimal React app that embeds the SDK. For a guided walkthrough, [contact us](https://www.workflowbuilder.io/contact).

#### See also

- [Architecture](/overview/architecture/) - tech stack, monorepo layout, plugin system, data model
- [Built-in Nodes](/nodes/) - all built-in node types
- [Plugins](/plugins/) - optional plugins that extend Workflow Builder
- [Videos](/videos/) - walkthroughs and live coding sessions
- [FAQ](/faq/) - frequently asked questions

### Diagram State Management

*Source: `overview/features/diagram-state-management.md` — description: How Workflow Builder manages canvas state - nodes, edges, undo/redo, and auto-save.*

The diagram state is the central data model of Workflow Builder. It holds all nodes, edges, layout direction, and the diagram name. Everything the user does on the canvas (placing nodes, drawing edges, moving elements) updates this state.

#### State structure

The diagram is serialized as a flat JSON object:

```json
{
  "name": "My Workflow",
  "layoutDirection": "DOWN",
  "nodes": [...],
  "edges": [...]
}
```

This is the same format used when saving to local storage, sending to an API, or passing in via props.

#### Canvas interactions

The canvas is an infinite whiteboard built on React Flow:

- **Drag and drop** nodes from the palette onto the canvas
- **Pan** by clicking and dragging the canvas background
- **Zoom** with scroll wheel or the zoom controls in the toolbar
- **Select** nodes and edges by clicking; multi-select with Shift or a drag selection box
- **Move** nodes by dragging them
- **Connect** nodes by dragging from a node's handle to another node
- **Delete** selected elements with the Delete or Backspace key

#### Undo / Redo

The undo/redo history tracks node-related actions. Users can undo and redo using:

- `Ctrl+Z` / `Cmd+Z` - undo
- `Ctrl+Shift+Z` / `Cmd+Shift+Z` - redo

The undo/redo stack is powered by the [Undo/Redo plugin](/plugins/undo-redo/).

#### Auto-save

Workflow Builder automatically persists workflow changes in the background without interrupting the user experience. The system saves data before the user exits the application, preventing accidental data loss. The save destination depends on the integration strategy:

- **localStorage** - saves to `localStorage` under the key `workflowBuilderDiagram`, making it suitable for prototypes and single-user setups
- **REST API** - POSTs the diagram JSON to your endpoint, supporting production-grade, multi-user environments

#### Keyboard shortcuts

| Action     | Windows / Linux | macOS         |
| ---------- | --------------- | ------------- |
| Copy       | `Ctrl+C`        | `Cmd+C`       |
| Paste      | `Ctrl+V`        | `Cmd+V`       |
| Cut        | `Ctrl+X`        | `Cmd+X`       |
| Select all | `Ctrl+A`        | `Cmd+A`       |
| Zoom in    | `Ctrl++`        | `Cmd++`       |
| Zoom out   | `Ctrl+-`        | `Cmd+-`       |
| Undo       | `Ctrl+Z`        | `Cmd+Z`       |
| Redo       | `Ctrl+Shift+Z`  | `Cmd+Shift+Z` |

#### See also

- [via callback](/get-started/persistence/callback/) - pass diagram data and save callbacks as React props
- [localStorage](/get-started/persistence/localstorage/) - persist diagrams to browser localStorage
- [REST API](/get-started/persistence/rest-api/) - load and save diagrams from a backend REST API
- [Undo / Redo plugin](/plugins/undo-redo/) - local session history with keyboard shortcuts

### Node Library

*Source: `overview/features/node-library.mdx` — description: The node palette - browse, search, and drag nodes onto the canvas.*

The node library (palette) is the left sidebar panel that lists all available node types. Users drag nodes from here onto the canvas to build their workflow.

<video autoplay loop muted playsinline>
  <source src={nodeLibraryWebm} type="video/webm" />
</video>

#### Views

The palette supports two display modes:

| View          | Description                                      |
| ------------- | ------------------------------------------------ |
| **Flat list** | All node types shown as a single scrollable list |
| **Grouped**   | Nodes organized into logical categories          |

#### Drag and drop

Dragging a node from the palette onto the canvas creates a new instance of that node type at the drop position. The node is initialized with its default property values defined in `default-properties-data.ts`.

The palette is read-only. Users cannot add, remove, or reorder entries. The available node types are defined in the codebase. See [Add a Custom Node Type](/guides/add-a-custom-node/) for how to extend the list.

#### Templates

Below the node list, the palette also surfaces pre-built workflow templates. Selecting a template replaces the current canvas with the template diagram, giving users a starting point for common workflow patterns.

#### See also

- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties
- [Built-in Nodes](/nodes/) - all built-in node types
- [Widgets plugin](/plugins/widgets/) - extend node cards with extra tabs and inline content

### Properties Sidebar

*Source: `overview/features/properties-sidebar.mdx` — description: How the properties panel works - schema-driven forms, field types, and dynamic rules.*

When a node or edge is selected on the canvas, the properties panel opens on the right. It renders a form for that element's configuration fields.

> _[Screenshot: Properties panel open for a Trigger node]_

#### Schema-driven forms

Every node type defines its properties using **JSON Schema**. Workflow Builder uses [JSONForms](https://jsonforms.io/) to turn that schema into a rendered form automatically - no custom form code required.

Adding, removing, or changing a property is a matter of editing the schema file. The properties panel updates immediately.

```typescript
properties: {
  label: {
    type: 'string',
  },
  description: {
    type: 'string',
  },
}
```

For complete examples, see the [node schema definitions](https://github.com/synergycodes/workflowbuilder/tree/master/apps/demo/src/app/data/nodes) in the source repository. Each node type has a `schema.ts` (JSON Schema) and `uischema.ts` (UI Schema) file.

#### Supported field types

| Field type         | Schema type                                   | Description                                                                    |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Text input         | `{ type: 'string' }`                          | Single-line string field. Use `format: 'textarea'` in UI Schema for multi-line |
| Dropdown           | `{ type: 'string', enum: [...] }`             | Select from a predefined list of options                                       |
| Checkbox           | `{ type: 'boolean' }`                         | Boolean toggle                                                                 |
| Numeric            | `{ type: 'number' }` or `{ type: 'integer' }` | Number input with optional `minimum`/`maximum` constraints                     |
| Date / Time picker | `{ type: 'string', format: 'date' }`          | Date and time selection                                                        |
| Rich text editor   | `{ type: 'string' }` with UI Schema control   | WYSIWYG editor for formatted content                                           |
| Accordion          | UI Schema layout                              | Collapsible group of related fields using `GroupLayout` in UI Schema           |

For a comprehensive guide on all available controls, layouts, and how to create custom renderers, see the [form generation guide](https://github.com/synergycodes/workflowbuilder/blob/master/packages/sdk/src/features/json-form/form-generation.md) in the source repository.

#### Validation

JSON Schema validation rules (such as `required`, `minLength`, `pattern`, and `minimum`/`maximum`) are supported. The properties panel validates input and shows error messages automatically.

#### Dynamic rules

The UI Schema supports conditional visibility rules. Fields can be shown or hidden based on the value of another field:

```typescript
// Show 'timeSchedule' only when type === 'timeBasedTrigger'
rule: {
  effect: 'SHOW',
  condition: {
    scope: '#/properties/type',
    schema: { const: 'timeBasedTrigger' },
  },
}
```

This keeps the form focused and avoids overwhelming users with irrelevant fields.

#### Edge properties

Edges (connections between nodes) also support properties. When an edge is selected, the panel shows:

- **Label** - optional visible text on the connection line
- Label visibility toggle

Labels are draggable directly on the canvas for precise placement.

#### See also

- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties
- [Validation plugin](/plugins/validation/) - detect broken references and missing edges
- [Built-in Nodes](/nodes/) - all built-in node types

#### References

- [Form generation guide](https://github.com/synergycodes/workflowbuilder/blob/master/packages/sdk/src/features/json-form/form-generation.md) - controls, layouts, and custom renderers reference
- [Node schema definitions](https://github.com/synergycodes/workflowbuilder/tree/master/apps/demo/src/app/data/nodes) - `schema.ts` and `uischema.ts` examples for every built-in node
- [JSONForms](https://jsonforms.io/) - the underlying JSON Schema form library

### Design System & Customization

*Source: `overview/features/design-system-and-customization.mdx` — description: Workflow Builder's design system - tokens, themes, and how to customize the UI.*

Workflow Builder includes a fully developed design system based on [Atomic Design](https://bradfrost.com/blog/post/atomic-web-design/) methodology. It uses design tokens (CSS variables) so the entire visual appearance can be changed by adjusting a small set of values.

#### Atomic Design structure

| Level         | Examples                                |
| ------------- | --------------------------------------- |
| **Atoms**     | Buttons, inputs, icons, badges          |
| **Molecules** | Form fields with labels, node cards     |
| **Organisms** | Properties panel, node palette, toolbar |
| **Templates** | Full editor layout                      |

#### Design tokens

The UI is powered by CSS custom properties (tokens) for colors, typography, spacing, and elevation. Changing a token propagates through the entire interface.

Example token categories:

- **UI backgrounds:** `--ax-ui-bg-primary-default`, `--ax-ui-bg-secondary-default`, `--ax-ui-bg-tertiary-default`
- **Text:** `--ax-txt-primary-default`, `--ax-txt-secondary-default`, `--ax-txt-tertiary-default`
- **Node:** `--ax-node-bg-primary-default`, `--ax-node-stroke-primary-default`, `--ax-node-icon-primary-default`
- **Buttons:** `--ax-button-primary-bg-default`, `--ax-button-gray-bg-default`
- **Spacing:** `--ax-token-spacing-spacing-4`, `--ax-token-spacing-spacing-8`, ..., `--ax-token-spacing-spacing-32`
- **Border radius:** `--ax-token-radius-element-4`, `--ax-token-radius-element-8`, ..., `--ax-token-radius-element-24`
- **Shadows:** `--ax-token-shadow-shadow-xs-*`, `--ax-token-shadow-shadow-s-*`, ..., `--ax-token-shadow-shadow-xl-*`

Theming is done by overriding CSS custom properties. Create a CSS file with your overrides and import it after the default theme:

```css
:root {
  --ax-ui-bg-primary-default: #1a1a2e;
  --ax-txt-primary-default: #e0e0e0;
  --ax-button-primary-bg-default: #4a90d9;
}
```

Both light and dark mode tokens are defined separately, so you can customize each theme independently.

#### Light and dark mode

Workflow Builder supports both light and dark modes out of the box, controlled by the `prefers-color-scheme` media query or a toggle.

#### Styled components on headless foundations

Workflow Builder ships with a complete default theme, but the underlying components come from [`@workflowbuilder/ui`](/ui-library/overview/), our component library built on the headless [Base UI](https://base-ui.com/) primitives. The styled layer is fully tokenized and isolated in cascade layers, so you can retheme or replace it through the `--ax-*` design tokens without fighting against built-in component styles. The visual layer is fully separate from the functional layer.

#### White-label support

The design system is set up for white-labeling. Replace logo, colors, typography, and any visual asset to match your product's brand.

#### Video walkthrough

For a visual overview of the design system, watch the walkthrough below.

> _[YoutubeEmbed: "Workflow Builder Design System Walkthrough" — https://www.youtube.com/watch?v=q2IiQh2uDEA]_

#### See also

- [Workflow Builder as a React component](/get-started/quick-start/wb-as-react-component/) - embed Workflow Builder into an existing React app

#### References

- [`@workflowbuilder/ui`](/ui-library/overview/) - the component library behind the default theme, built on [Base UI](https://base-ui.com/)
- [Atomic Design methodology](https://bradfrost.com/blog/post/atomic-web-design/) - the structural model behind the design system

### Architecture

*Source: `overview/architecture.md` — description: How Workflow Builder is structured — the SDK package, surrounding apps, plugin system, and data model.*

#### Tech stack

| Concern          | Library                                                                           |
| ---------------- | --------------------------------------------------------------------------------- |
| UI library       | [React](https://react.dev/)                                                       |
| UI components    | [`@workflowbuilder/ui`](/ui-library/overview/) on [Base UI](https://base-ui.com/) |
| Diagram engine   | [React Flow (xyflow)](https://reactflow.dev/)                                     |
| State management | [Zustand](https://zustand.docs.pmnd.rs/)                                          |
| Dynamic forms    | [JsonForms](https://jsonforms.io/)                                                |
| Build tool       | [Vite](https://vitejs.dev/)                                                       |
| Language         | TypeScript                                                                        |

All libraries are open-source with no additional license purchase required.

#### Repository layout

The project is a pnpm workspace. The editor itself lives in a single distributable package (`packages/sdk`, eventually published to npm as `@workflowbuilder/sdk`); everything in `apps/` is either a consumer of that package, an optional execution-side service, or developer tooling.

```
packages/
└── sdk/               # The editor — distributed as @workflowbuilder/sdk

apps/
├── demo/              # Reference React host that consumes the SDK
├── ai-studio/         # Reference AI workflow product built on the SDK (sibling to demo)
├── docs/              # This documentation site (Astro + Starlight)
├── icons/             # Lazy-loadable icon set, bundled into the SDK at build time
├── backend/           # Optional REST backend used by the demo's `api` strategy
├── execution-core/    # Optional workflow execution runtime
├── execution-worker/  # Optional async worker for execution jobs
├── types/             # Shared types for the execution layer
└── tools/             # Internal scripts and developer utilities
```

`@workflowbuilder/sdk` is the only artifact an external app needs. The execution-side apps (`backend`, `execution-core`, `execution-worker`) are independent — the SDK serialises workflows to JSON and emits save events; what runs them is up to you.

#### SDK structure

The SDK package's source tree:

```
packages/sdk/src/
├── workflow-builder-root/      # <WorkflowBuilder.Root> entry (folder — component, types, helper, shell)
│   ├── workflow-builder-root.tsx       #   the component
│   ├── workflow-builder-root.types.ts  #   public API types (props, plugin, integration, jsonForm)
│   ├── resolve-integration.ts          #   integration-discriminated-union → flat shape helper
│   ├── root-shell.tsx                  #   internal subtree under StoreContext.Provider
│   └── index.ts                        #   barrel re-export
├── bootstrap-immer.ts          # First-loaded side-effect: disables immer auto-freeze
├── bootstrap.ts                # Module-level init (i18next, modals + i18n plugins)
├── index.ts                    # Curated public barrel + compound `WorkflowBuilder` namespace
├── components/                 # Reusable UI primitives (forms, sidebar, loader)
├── data/                       # Default palette + templates registries
├── features/                   # Feature modules (key modules shown)
│   ├── default-layout/         #   Default floating-overlay layout (exported as WorkflowBuilder.DefaultLayout)
│   ├── app-bar/                #   <WorkflowBuilder.TopBar>
│   ├── palette/                #   <WorkflowBuilder.Palette>
│   ├── diagram/                #   <WorkflowBuilder.Canvas> + React Flow integration
│   ├── properties-bar/         #   <WorkflowBuilder.PropertiesPanel>
│   ├── json-form/              #   Dynamic form rendering (JsonForms)
│   ├── integration/            #   Persistence strategies (localStorage / api / props)
│   ├── plugins-core/           #   Plugin adapter layer (decorator registries)
│   ├── changes-tracker/        #   Undo/redo + change events
│   ├── modals/, snackbar/      #   Lightweight UI infra
│   └── i18n/                   #   Translations (en, pl)
├── hooks/                      # Public React hooks (`useStore`, `useFitView`, …)
├── store/                      # Zustand store factory + slices + action helpers
├── node/                       # Node domain types (`NodeSchema`, `NodeData`, …)
├── types/                      # UISchema control / layout / integration types
└── utils/                      # `noop`, `sharedProperties`, schema helpers
```

`apps/demo/src/app/` is much thinner — it's only what a host needs to drive the SDK: an `app.tsx` that mounts `<WorkflowBuilder.Root>`, `data/` with the demo's `palette.ts` + per-node schemas, and `plugins/` with the example plugins.

#### Plugin system

Workflow Builder is plugin-based. The SDK exposes a small set of extension points; a plugin is just a synchronous initializer that calls one or more of them at startup.

| Extension point                                                          | What it does                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [`registerComponentDecorator`](/api/plugins/registercomponentdecorator/) | Wrap a named slot (app bar control, node section, …).         |
| [`registerFunctionDecorator`](/api/plugins/registerfunctiondecorator/)   | Hook before/after a named SDK action.                         |
| [`registerPluginTranslation`](/api/plugins/registerplugintranslation/)   | Merge translations into the SDK's `plugins.*` i18n namespace. |
| `<WorkflowBuilder.Root jsonForm={{ renderers, cells, translations }} />` | Add custom JsonForms renderers / cells.                       |

A plugin is `() => void` — see the [`WorkflowBuilderPlugin`](/api/plugins/workflowbuilderplugin/) type. Pass an array of them via `<WorkflowBuilder.Root plugins={[…]} />` (each runs once, in order, on first mount) or call the `register*` APIs directly at module level — the SDK's decorator registries are module-global and dedupe by `name`.

The SDK's base behaviour is not modified — every customisation is additive through the registries above, so plugins can be added or removed without touching the editor's source.

The `apps/demo/src/app/plugins/` directory ships a set of example plugins (avoid-nodes-edges, copy-paste, undo-redo, flow-runner, …). They double as recipe references — see [Plugins](/plugins/) for documentation per plugin and [Build a plugin](/guides/build-a-plugin/) for the full authoring guide.

#### Data model

A workflow is a flat JSON object:

```typescript
type IntegrationDataFormat = {
  name: string;
  layoutDirection: 'DOWN' | 'RIGHT';
  nodes: WorkflowBuilderNode[];
  edges: WorkflowBuilderEdge[];
};
```

Each node carries its type, position, icon, and a `properties` object whose shape is defined by that node type's [JSON Schema](/node-schemas/data-schema/). This is the payload the SDK reads at load time and emits on save through whichever [persistence strategy](/get-started/persistence/localstorage/) is configured.

#### Execution

Workflow Builder focuses on the editor layer. The serialised JSON is designed to be consumed by a backend execution engine — yours or one of the in-repo apps (`apps/execution-core/` + `apps/execution-worker/` cover the demo's runtime; `apps/backend/` is the REST surface they sit behind). For in-editor execution, the optional [Flow Runner plugin](/plugins/flow-runner/) (Enterprise) traverses the workflow graph and runs node functions directly.

#### See also

- [Plugins](/plugins/) — optional plugins that extend Workflow Builder
- [Built-in Nodes](/nodes/) — all built-in node types
- [Diagram state management](/overview/features/diagram-state-management/) — canvas state, undo/redo, and auto-save
- [API Reference](/api/) — every public symbol exported by the SDK
- [FAQ](/faq/) — licensing, data residency, and tech-stack questions

---

## 2. Get started

The three persistence strategies are the three `get-started/persistence/*` pages below: `localStorage`, `REST API`, and `via callback`.

### Standalone

*Source: `get-started/quick-start/standalone-app.mdx` — description: Clone Workflow Builder and run the reference editor locally. UI-only demo or the full AI Studio stack with backend execution.*

Run Workflow Builder locally from the monorepo. Two paths depending on what you want to evaluate.

Don't want to clone yet? [Open the live demo](https://app.workflowbuilder.io) to try it in your browser first.

#### Pick a path

| Goal                                                   | Path                                | Setup time | Docker |
| ------------------------------------------------------ | ----------------------------------- | ---------- | ------ |
| See the editor running in your browser                 | [Demo](#demo)                       | ~2 min     | no     |
| Run the full reference stack (editor + execution + AI) | [Full Stack Demo](#full-stack-demo) | ~10 min    | yes    |

To embed the SDK in your own React app instead, see [React Component](/get-started/quick-start/wb-as-react-component/).

#### Requirements

- [Node.js](https://nodejs.org/) <code>{packageJson.engines.node}</code>
- [pnpm](https://pnpm.io/) <code>{packageJson.engines.pnpm}</code>
- Docker Desktop. Only required for the AI Studio path.

Works the same on macOS, Linux, and Windows.

#### Preflight

After cloning, run this once. It verifies Node, pnpm, Docker, port availability, and required `.env` files.

```bash
git clone https://github.com/synergycodes/workflowbuilder.git
cd workflowbuilder
pnpm install
pnpm preflight
```

Expected output:

```
Workflow Builder preflight

✅ node                        22.12.0
✅ pnpm                        10.9.0
✅ docker                      running
✅ port_3001                   free (backend)
✅ port_4200                   free (demo)
✅ port_4201                   free (ai-studio)
✅ port_5432                   free (postgres)
✅ port_5433                   free (temporal-db)
✅ port_7233                   free (temporal)
✅ port_8233                   free (temporal-ui)
⚠️  apps/backend/.env           missing — copy from apps/backend/.env.example
⚠️  apps/execution-worker/.env  missing — copy from apps/execution-worker/.env.example

Ready to go. Pick a path below.
```

The two `.env` warnings are expected on a fresh clone. They are only required for the Full Stack Demo path and get created by `pnpm setup:env` in step 1 of that path. After that they switch to `✅ present`.

Fix any red (`❌`) items before continuing. `pnpm preflight --json` returns the same report in structured form for tooling.

#### Demo

UI only. No backend, no Docker. The fastest way to see the editor in action.

```bash
pnpm dev:demo
```

Expected output:

```
[1]   VITE vX.Y.Z  ready in NNN ms
[1]
[1]   ➜  Local:   http://localhost:4200/
[0] Found 0 errors. Watching for file changes.
```

Open [http://localhost:4200](http://localhost:4200). The editor loads with the default plugin set and a starter template.

> _[Screenshot: Workflow Builder canvas, node palette, and properties panel]_

#### Full Stack Demo

Full reference product: editor, Hono backend, Temporal worker, Postgres. The frontend on port 4201 is the **AI Studio** reference product (`apps/ai-studio`). Demonstrates end-to-end workflow execution.

##### 1. Create `.env` files

First time only. Copies the `.env.example` templates into place; existing `.env` files are left untouched.

```bash
pnpm setup:env
```

##### 2. Start infrastructure

```bash
pnpm infra:up
```

Expected output (first run):

```
 Network backend_default            Created
 Volume "backend_temporal-db-data"  Created
 Volume "backend_app-db-data"       Created
 Container backend-app-db-1         Started
 Container backend-temporal-db-1    Started
 Container backend-temporal-1       Started
 Container backend-temporal-ui-1    Started
```

Verify: open [http://localhost:8233](http://localhost:8233) (Temporal UI). The `default` namespace appears.

##### 3. Run migrations

First time, or after pulling schema changes.

```bash
pnpm -F backend db:migrate
```

Expected output:

```
> drizzle-kit migrate

Using 'postgres' driver for database querying
[✓] migrations applied successfully!
```

##### 4. Start the stack

```bash
pnpm dev:ai-studio
```

Expected output (three interleaved streams):

```
Temporal ready
[backend]    Backend running on http://127.0.0.1:3001
[worker]     Execution worker started on task queue: workflow-execution
[ai-studio]    VITE vX.Y.Z  ready in NNN ms
[ai-studio]    ➜  Local:   http://127.0.0.1:4201/
```

Open [http://localhost:4201](http://localhost:4201). Pick the "Sales Inquiry" template, click Play. The Temporal UI at [http://localhost:8233](http://localhost:8233) shows the running execution.

To stop: `Ctrl+C`, then `pnpm infra:down`.

##### Connect a real LLM (optional)

AI Studio works with stub responses out of the box. To use a real model, add to both `apps/backend/.env` and `apps/execution-worker/.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-...
AI_MODEL=anthropic/claude-3.5-haiku
```

If the key is missing, the worker fails to start with `OPENROUTER_API_KEY is required`. If the model id is wrong, the first AI node fails at runtime and the error surfaces in the UI log panel.

#### Troubleshooting

| Symptom                                                                 | Cause                                                                 | Fix                                                                               |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `EADDRINUSE` on 3001, 4200, 4201, 5432, 5433, 7233, or 8233             | Another process holds the port                                        | `pnpm preflight` shows the conflict. Stop the other process or change the port.   |
| Temporal UI loads but the `default` namespace is missing                | Migrations not run                                                    | `pnpm -F backend db:migrate`                                                      |
| Worker exits with `OPENROUTER_API_KEY is required`                      | Real LLM env var missing                                              | Set it in `apps/execution-worker/.env`. Optional unless you want a real LLM call. |
| `pnpm dev:demo` shows TypeScript errors but the dev server still starts | `concurrently` runs typecheck alongside Vite. TS errors are non-fatal | Fix the errors or ignore them temporarily.                                        |
| Vite acts up after a dependency change                                  | Stale `node_modules/.vite`                                            | `rm -rf node_modules/.vite` and rerun.                                            |

#### See also

- [React Component](/get-started/quick-start/wb-as-react-component/). Embed the SDK in your own React app.
- [Node library](/overview/features/node-library/). Browse, search, and drag nodes from the palette.
- [Add Custom Node Type](/guides/add-a-custom-node/). Register a new node type with custom properties.
- [via callback persistence](/get-started/persistence/callback/). Pass diagram data and save callbacks as React props.
- [FAQ](/faq/). Installation, licensing, and compatibility questions.

### React Component

*Source: `get-started/quick-start/wb-as-react-component.mdx` — description: Embed Workflow Builder in any React app.*

#### Requirements

- React 18 or 19
- `@xyflow/react` 12 or higher
- ESM-compatible bundler (Vite, Webpack 5, Next.js, Parcel)

#### Known limitations

:::caution
Mount only one `<WorkflowBuilder.Root>` per page. Multi-instance is not supported. See [Side effects & limitations](/get-started/side-effects/) for the details and how to swap workflows on one page.
:::

#### Try it in your browser

A small React + Vite app that uses the SDK. Click the frame to start it, then change the code.

> _[StackblitzEmbed: an iframe running the starter project on StackBlitz, with an "Open on StackBlitz" link beneath it. No prose. Per the component source, StackBlitz embeds work in Chromium browsers only and the failure is silent.]_

#### Installation

Install the SDK along with its peer dependencies:

**npm**

```bash
npm install @workflowbuilder/sdk @xyflow/react zustand
```

**pnpm**

```bash
pnpm add @workflowbuilder/sdk @xyflow/react zustand
```

**yarn**

```bash
yarn add @workflowbuilder/sdk @xyflow/react zustand
```

Requires React 18 or 19. Everything else the SDK uses (JsonForms,
i18next, immer, …) is a regular dependency and installs automatically.

#### Usage

The SDK exposes a single compound component, `WorkflowBuilder`. Mount
`<WorkflowBuilder.Root>` at the top of your editor subtree; with no
children it renders the default layout (top bar, palette, canvas,
properties panel).

`<WorkflowBuilder.Root>` takes a small set of optional props. See [Configuring the editor](/guides/configuring-the-editor/) for the full props reference and for composing a custom layout, or the auto-generated [API reference](/api/core/workflowbuilderroot/).

##### Hello world

```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

import '@workflowbuilder/sdk/style.css';

function App() {
  return (
    <WorkflowBuilder.Root
      name="my-workflow"
      layoutDirection="DOWN"
      nodeTypes={
        [
          /* PaletteItemOrGroup[] */
        ]
      }
      integration={{
        strategy: 'props',
        onDataSave: async (data) => {
          console.log('Saving:', data);
          return 'success';
        },
      }}
    />
  );
}
```

#### TypeScript

All public types are exported from `@workflowbuilder/sdk`. The full
[API Reference](/api/) is generated by TypeDoc directly from the SDK
source on every docs build, so it never drifts.

#### Next steps

- [Configuring the editor](/guides/configuring-the-editor/) - props reference, custom layouts, integration strategies, connection validation
- Persistence: [localStorage](/get-started/persistence/localstorage/), [REST API](/get-started/persistence/rest-api/), [via callback](/get-started/persistence/callback/) - load and save diagram data
- [Add a custom node type](/guides/add-a-custom-node/) - register a new node with its own properties
- [Build a plugin](/guides/build-a-plugin/) - toolbar buttons, decorators, function hooks, translations
- [Custom JsonForms control](/guides/custom-jsonforms-control/) - render node properties with your own components
- [Theming](/get-started/theming/) - design tokens, light / dark, customization

### localStorage

*Source: `get-started/persistence/localstorage.mdx` — description: Persist diagram state automatically to the browser's localStorage. No backend required.*

The `localStorage` strategy saves and loads the diagram from `localStorage` automatically. No backend or server is needed. This is the **default** strategy — pass no `integration` config at all and you get it.

#### How it works

```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

import '@workflowbuilder/sdk/style.css';

export function App() {
  return (
    <WorkflowBuilder.Root
      name="My Workflow"
      integration={{ strategy: 'localStorage' }} // default — can be omitted
    />
  );
}
```

That's it. Workflow Builder will:

1. On mount — read the diagram from `localStorage` and load it into the editor.
2. On save — serialise the current diagram to JSON and write it to `localStorage`.

#### Storage key

The data is stored under a fixed key:

```
workflowBuilderDiagram
```

The value is the JSON-serialised `IntegrationDataFormat` object. The key is **not** derived from the `name` prop — every `localStorage`-backed instance reads and writes the same slot.

#### Seeding the first visit

On first visit, when no data exists in `localStorage`, the editor falls back to whatever `initialNodes` / `initialEdges` you pass on `<WorkflowBuilder.Root>`. If neither is set, the canvas starts empty. Once the user saves, `localStorage` becomes the source of truth and the props are ignored on subsequent visits — `initialNodes` / `initialEdges` are safe to leave in the JSX as a stable seed.

#### Auto-save on close

Workflow Builder hooks into the browser's `beforeunload` event and triggers a save when the user closes or navigates away from the page. This ensures the diagram is not lost between sessions.

#### Limitations

- Data is per-browser and per-origin — it is not shared across devices.
- `localStorage` has a ~5 MB limit; very large diagrams may hit this.
- Not suitable for multi-user or collaborative scenarios.
- The storage key is hardcoded — only one `localStorage`-backed workflow can be persisted per origin.

#### When to use this strategy

Use the `localStorage` strategy when:

- You want a zero-config setup with no backend.
- The diagram is for a single user on a single device.
- You are prototyping or demoing Workflow Builder.

#### See also

- [REST API](/get-started/persistence/rest-api/) — alternative: persistent, shareable storage via a backend
- [via callback](/get-started/persistence/callback/) — alternative: full control over loading and saving from your app
- [Configuring the editor](/guides/configuring-the-editor/) — full reference for `<WorkflowBuilder.Root>` props
- [Diagram state management](/overview/features/diagram-state-management/) — canvas state, undo/redo, and auto-save

Have a more complex persistence setup in mind? [Contact us](https://www.workflowbuilder.io/contact) and we'll help you pick the right strategy.

### REST API

*Source: `get-started/persistence/rest-api.mdx` — description: Load and save diagrams from your backend REST API.*

The `api` strategy connects Workflow Builder to your backend. It fetches the initial diagram from a `load` endpoint on mount and POSTs the updated diagram to a `save` endpoint when the user saves.

#### How it works

Pass `integration: { strategy: 'api', endpoints }` to `<WorkflowBuilder.Root>` with the load and save URLs:

```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

import '@workflowbuilder/sdk/style.css';

export function App() {
  return (
    <WorkflowBuilder.Root
      name="My Workflow"
      integration={{
        strategy: 'api',
        endpoints: {
          load: '/api/workflow/load',
          save: '/api/workflow/save',
        },
      }}
    />
  );
}
```

The runtime handles two operations:

| Event            | Action                                               |
| ---------------- | ---------------------------------------------------- |
| Component mounts | `GET endpoints.load` — loads the initial diagram     |
| User saves       | `POST endpoints.save` — persists the current diagram |

The initial diagram is fetched from `endpoints.load`. `initialNodes` / `initialEdges` on `<WorkflowBuilder.Root>` are used as the first frame (before the fetch resolves) and as a fallback when the load endpoint fails — non-2xx responses and network errors leave the editor showing whatever you passed in. Pass them if you want a meaningful skeleton instead of an empty canvas during load.

#### Authenticating requests

The built-in `api` strategy issues plain `fetch()` calls with no auth headers. If your backend needs auth, use the [`props` strategy](/get-started/persistence/callback/) instead and call `fetch` yourself in `onDataSave` — there you can attach `Authorization` headers, custom error handling, or any other request shape you need:

```tsx
<WorkflowBuilder.Root
  integration={{
    strategy: 'props',
    onDataSave: async (data) => {
      const response = await fetch('/api/workflow/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      return response.ok ? 'success' : 'error';
    },
  }}
/>
```

#### Data format

Both the GET response body and the POST request body use the same shape:

```typescript
type IntegrationDataFormat = {
  name: string;
  layoutDirection: 'DOWN' | 'RIGHT';
  nodes: WorkflowBuilderNode[];
  edges: WorkflowBuilderEdge[];
};
```

#### Snackbar feedback

Workflow Builder automatically shows a success or error notification after each save attempt based on whether the response was `ok`.

#### When to use this strategy

Use the `api` strategy when:

- You need diagrams persisted in a database.
- Multiple users access the same diagram.
- You want server-side validation or versioning.
- The save endpoint needs no extra request shaping (auth, custom payload) — otherwise reach for [`props`](/get-started/persistence/callback/).

#### See also

- [Save diagrams to database](/guides/save-diagrams-to-database/) — a simple database save example using this strategy
- [via callback](/get-started/persistence/callback/) — alternative: full control over the request shape (auth, payload transforms)
- [localStorage](/get-started/persistence/localstorage/) — alternative: zero-config persistence in the browser
- [Configuring the editor](/guides/configuring-the-editor/) — full reference for `<WorkflowBuilder.Root>` props
- [Diagram state management](/overview/features/diagram-state-management/) — canvas state, undo/redo, and auto-save

Need help wiring this up to your existing API or auth layer? [Contact us](https://www.workflowbuilder.io/contact) and we'll help you out.

### via callback

*Source: `get-started/persistence/callback.mdx` — description: Pass initial diagram data and a save callback directly into Workflow Builder via WorkflowBuilder.Root.*

The `props` strategy is the most direct way to connect Workflow Builder to your application. You supply a save callback and the initial diagram data on the same `<WorkflowBuilder.Root>` mount.

#### How it works

Pass `integration: { strategy: 'props', onDataSave }` along with `name` / `initialNodes` / `initialEdges` to `<WorkflowBuilder.Root>`:

```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

import '@workflowbuilder/sdk/style.css';

export function App() {
  return (
    <WorkflowBuilder.Root
      name="My Workflow"
      initialNodes={initialNodes}
      initialEdges={initialEdges}
      integration={{
        strategy: 'props',
        onDataSave: async (data, savingParams) => {
          const response = await fetch('/api/workflows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });

          return response.ok ? 'success' : 'error';
        },
      }}
    />
  );
}
```

##### `savingParams`

The second argument passed to `onDataSave` has the following type:

```typescript
type OnSaveParams = { isAutoSave?: boolean };
```

`savingParams.isAutoSave` is `true` when the save was triggered automatically (for example, before the user leaves the page). In that case, success and error notifications are suppressed. When `false` or `undefined`, the save was triggered by the user clicking Save and a snackbar is shown.

#### Data format

The `data` object passed to `onDataSave` has the following shape:

```typescript
type IntegrationDataFormat = {
  name: string;
  layoutDirection: 'DOWN' | 'RIGHT';
  nodes: WorkflowBuilderNode[];
  edges: WorkflowBuilderEdge[];
};
```

This is the same format used by the other integration strategies and accepted back as initial props.

#### Save result

`onDataSave` must return a promise resolving to one of:

| Value              | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `'success'`        | Save succeeded.                                                                    |
| `'error'`          | Save failed (at the snackbar layer indistinguishable from `'success'` — see note). |
| `'alreadyStarted'` | A save was already in flight; the new request was coalesced.                       |

##### Snackbar feedback

The runtime treats **any non-empty resolved value** as "the save attempt finished, show the success snackbar". So `'success'`, `'error'`, and `'alreadyStarted'` all currently surface the success-style snackbar. If you need an error snackbar specifically, **throw** from `onDataSave` — throwing surfaces the error snackbar instead. Resolving to `undefined` / empty string surfaces neither.

#### When to use this strategy

Use the `props` strategy when:

- Your diagram data lives in your parent component or state manager
- You want full control over when and how saving happens
- You need to validate or transform the data before persisting it

#### See also

- [localStorage](/get-started/persistence/localstorage/) — alternative: zero-config persistence with no backend required
- [REST API](/get-started/persistence/rest-api/) — alternative: server-managed persistence via a REST API
- [Configuring the editor](/guides/configuring-the-editor/) — full reference for `<WorkflowBuilder.Root>` props
- [Workflow Builder as a React component](/get-started/quick-start/wb-as-react-component/) — embed Workflow Builder into an existing React app

Need help embedding Workflow Builder into your stack? [Contact us](https://www.workflowbuilder.io/contact) and we'll walk you through it.

### Theming

*Source: `get-started/theming.md` — description: Customise the editor's visual style — fonts, background, tokens — via CSS variables on :root.*

The aggregated `style.css` ships with the SDK's default visual layer. Override CSS custom properties on `:root` (or a higher-priority selector) to customise.

#### Typography

Poppins is bundled into `style.css` as inline base64 woff2 (latin + latin-ext, weights 300–700). No external font CDN is contacted at runtime — works under strict CSP, behind GDPR-controlled consent flows, and in air-gapped deployments.

Override `--wb-font-family` to use a different face:

```css
:root {
  --wb-font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
```

Provide the font yourself (via `@font-face`, `@fontsource/<font>`, etc.) — the SDK only consumes the variable.

#### Other tokens

The SDK exposes a small surface of `--wb-*` variables (background, scrollbar, transitions) plus the larger `--ax-*` design-token set re-exported from `@workflowbuilder/ui`. See [Design System & Customization](/overview/features/design-system-and-customization/) for the full token map.

### Side effects & limitations

*Source: `get-started/side-effects.md` — description: What the SDK does to global state on import, and the runtime limits to design around.*

Importing `@workflowbuilder/sdk` runs a handful of module-level side effects on your runtime instances. They're listed below alongside the runtime limitations they tie into — knowing both up front saves debugging time later.

#### Side effects on import

- **`immer`** — calls `setAutoFreeze(false)`. ReactFlow mutates the objects produced by the SDK's `produce` calls (size, position, internal flags), so the SDK's drafts must not be auto-frozen. Because `immer` is a shared, deduped dependency, this disables auto-freeze **globally** for the host app — any of your own reducers, RTK slices, or libraries that rely on frozen drafts lose that protection. If you have your own immer flows that depend on frozen drafts, treat it as a known caveat.
- **`i18next`** — initialises the i18next instance with `react-i18next`, the language detector, and the SDK's bundled `en` / `pl` translations. If your app already configured i18next before importing the SDK, the SDK's `i18n.init(...)` is a no-op for the second `init` per i18next's contract — the registry is shared.

#### Known limitations

##### Single instance per page

Mount only one `<WorkflowBuilder.Root>` per page. Multi-instance is not supported: the plugin / decorator / JsonForms / i18n registries are module-level singletons shared across mounts, so two Roots on the same page would silently fight over those resources. The imperative `useStore.{getState,setState,subscribe}` facade also resolves through a module-level "current" pointer, so writes from one subtree would leak into another. If you need to swap workflows on the same page, render them sequentially (mount → save → unmount → mount next).

##### Raw-TS subpath exports

`@workflowbuilder/sdk/<subpath>` ships raw `.ts` files and reaches into SDK internals that may change without notice. External consumers should import only from the root (`@workflowbuilder/sdk`), which goes through the curated barrel. Subpath imports are for monorepo use only.

##### React deduplication (local-path installs only)

When installed via `npm install <local-path>`, the consumer's bundler may resolve `react` from the library's `node_modules` instead of the consumer's. Fix with `resolve.dedupe: ['react', 'react-dom', '@xyflow/react']`. Not needed once published to npm.

---

## 3. Guides

### Add a custom node

*Source: `guides/add-a-custom-node.mdx` — description: End-to-end recipe — define a node's schema, UI schema, defaults, register it with the palette, and (optionally) plug a custom renderer in.*

> **⚠️ main only — `isStartNode` does not exist in `@workflowbuilder/sdk@2.3.0`.** This page puts `isStartNode` in TypeScript (on a `PaletteItem`, and/or read off `node.data` inside a typed callback). In 2.3.0 `NodeDefinition` is `… & Pick<NodeData, 'type' | 'icon' | 'templateType'>` — no `isStartNode`. Code copied from this page **will not typecheck** against the installed 2.3.0.

Custom nodes let you extend Workflow Builder with node types that match your specific domain and business logic. This guide walks through the full lifecycle of a node — schema, UI, defaults, registration — using a `Webhook` node as a worked example.

> _[YoutubeEmbed: "How to Add a New Custom Node to Workflow Builder" — https://www.youtube.com/watch?v=v0Oy4VIAMok]_

> **Tip** _(partial `_file-paths-disclaimer.mdx`)_
>
> File paths in this guide are relative to the [Standalone App](/get-started/quick-start/standalone-app/) repository
> structure. If you embedded Workflow Builder differently, adjust the paths to match your project layout.

#### Anatomy

A node is a [`PaletteItem`](/api/types/paletteitem/) made of four pieces. File organisation is a suggestion — collapse them into one file if you prefer.

| Piece                   | Defined in                   | Purpose                                                               |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `schema`                | `schema.ts`                  | Shape and validation of the node's properties.                        |
| `uischema`              | `uischema.ts`                | How those properties render in the property panel.                    |
| `defaultPropertiesData` | `default-properties-data.ts` | Initial values applied when the node is dropped.                      |
| Top-level fields        | `<node-name>.ts`             | `type`, `label`, `description`, `icon` — plus optional `isStartNode`. |

#### 1. JSON Schema — `webhook/schema.ts`

```ts
import type { NodeSchema } from '@workflowbuilder/sdk';

export const schema = {
  properties: {
    label: { type: 'string' },
    description: { type: 'string' },
    url: { type: 'string', format: 'uri' },
    method: {
      type: 'string',
      options: [
        { label: 'GET', value: 'GET' },
        { label: 'POST', value: 'POST' },
        { label: 'PUT', value: 'PUT' },
        { label: 'DELETE', value: 'DELETE' },
      ],
    },
    accentColor: { type: 'string' },
    retryOnFailure: { type: 'boolean' },
  },
  required: ['url', 'method'],
} satisfies NodeSchema;

export type WebhookNodeSchema = typeof schema;
```

#### 2. UI Schema — `webhook/uischema.ts`

```ts
import type { UISchema } from '@workflowbuilder/sdk';

export const uischema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: '#/properties/label' },
    { type: 'TextArea', scope: '#/properties/description', minRows: 2 },
    { type: 'Text', scope: '#/properties/url', placeholder: 'https://...' },
    { type: 'Select', scope: '#/properties/method' },

    // Custom control — matches the tester we register below.
    // `UISchema` is a closed union of built-in element types, so custom
    // elements need a cast at declaration. Runtime is fully type-safe — your
    // renderer still receives the exact props you declared.
    { type: 'ColorPicker', scope: '#/properties/accentColor' } as unknown as UISchema,

    { type: 'Switch', scope: '#/properties/retryOnFailure' },
  ],
};
```

Each element's `type` is one of the SDK's built-in control or layout types. For the full list of types and their props, see [Form controls](/node-schemas/form-controls/) and [Form layouts](/node-schemas/form-layouts/). Custom renderer types like `ColorPicker` you register yourself — see [Custom JsonForms control](/guides/custom-jsonforms-control/).

#### 3. Defaults — `webhook/default-properties-data.ts`

```ts
export const defaultPropertiesData = {
  label: 'Webhook',
  description: '',
  url: '',
  method: 'POST',
  accentColor: '#3366ff',
  retryOnFailure: true,
};
```

#### 4. Palette item — `webhook/webhook.ts`

```ts
import type { PaletteItem } from '@workflowbuilder/sdk';

import { defaultPropertiesData } from './default-properties-data';
import { type WebhookNodeSchema, schema } from './schema';
import { uischema } from './uischema';

export const webhookNode: PaletteItem<WebhookNodeSchema> = {
  type: 'webhook',
  label: 'Webhook',
  description: 'Send data to an external HTTP endpoint',
  icon: 'Globe', // see the WBIcon name union for valid icon names
  defaultPropertiesData,
  schema,
  uischema,
};
```

If this node is where a run begins, add `isStartNode: true`. The editor copies the flag onto every node dropped from this palette item, so it travels with the saved diagram as `data.isStartNode` and your execution engine can find the entry point directly:

```ts
export const webhookNode: PaletteItem<WebhookNodeSchema> = {
  type: 'webhook',
  // ...
  isStartNode: true,
};
```

The flag is independent of how the node looks — any node type can be an entry point, not just one using the built-in start-node template.

#### 5. Register the node

Pass your node array to the `nodeTypes` prop on `<WorkflowBuilder.Root>`:

```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

import '@workflowbuilder/sdk/style.css';

import { webhookNode } from './webhook/webhook';

export function App() {
  return (
    <WorkflowBuilder.Root
      name="my-flow"
      nodeTypes={[webhookNode]}
      initialNodes={[]}
      initialEdges={[]}
      integration={{
        strategy: 'props',
        onDataSave: async (data) => {
          console.log('save:', data);
          return 'success';
        },
      }}
    />
  );
}
```

Inside the monorepo, the demo composes its palette in [`apps/demo/src/app/data/palette.ts`](https://github.com/synergycodes/workflowbuilder/blob/master/apps/demo/src/app/data/palette.ts) and passes the resulting array into `<WorkflowBuilder.Root nodeTypes={...} />` from [`apps/demo/src/app/app.tsx`](https://github.com/synergycodes/workflowbuilder/blob/master/apps/demo/src/app/app.tsx).

#### 6. (Optional) Custom renderer

To render a property with a custom React component, split the renderer into two files (the component as `.tsx`, the registry entry as `.ts`) so every JSX-bearing file exports only components — Vite's React Fast Refresh requires it.

`renderers/color-picker.tsx`:

```tsx
import { type ControlProps, withJsonFormsControlProps } from '@workflowbuilder/sdk';

function ColorPickerControl({ data, handleChange, path, label }: ControlProps) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {label && <span>{label}</span>}
      <input type="color" value={data ?? '#000000'} onChange={(e) => handleChange(path, e.target.value)} />
    </label>
  );
}

export const ColorPicker = withJsonFormsControlProps(ColorPickerControl);
```

`renderers/color-picker-renderer.ts`:

```ts
import { type JsonFormsRendererExtension, rankWith, uiTypeIs } from '@workflowbuilder/sdk';

import { ColorPicker } from './color-picker';

export const colorPickerRenderer: JsonFormsRendererExtension = {
  tester: rankWith(5, uiTypeIs('ColorPicker')),
  renderer: ColorPicker,
};
```

Wire it through the `jsonForm` prop on `<WorkflowBuilder.Root>`:

```tsx
<WorkflowBuilder.Root
  nodeTypes={[webhookNode]}
  jsonForm={{ renderers: [colorPickerRenderer] }}
  integration={{ strategy: 'props', onDataSave }}
/>
```

The full reference for renderer/cell/translation registration lives at [Custom JsonForms control](/guides/custom-jsonforms-control/).

#### 7. (Optional) Custom node template

The built-in renderer gives every node a header and one input + one output handle. When you need a different handle layout or a different shape, register a custom template under [`nodeTemplates`](/api/types/nodetemplatesmap/) keyed by the palette `type` string. No plugin needed.

The template below uses the SDK's own building blocks (`NodePanel`, `NodeIcon`,
`NodeDescription`) from the [`@workflowbuilder/ui`](/ui-library/overview/) component
library - a separate package, so install it first:

```sh
npm install @workflowbuilder/ui
```

`my-node-template.tsx`:

```tsx
import { Icon, getHandleId } from '@workflowbuilder/sdk';
import type { WorkflowNodeTemplateProps } from '@workflowbuilder/sdk';
import { NodeDescription, NodeIcon, NodePanel } from '@workflowbuilder/ui';
import { Handle, Position } from '@xyflow/react';
import { memo, useMemo } from 'react';

export const MyNodeTemplate = memo(
  ({ id, icon, label, description, selected = false, showHandles = true }: WorkflowNodeTemplateProps) => {
    const iconElement = useMemo(() => <Icon name={icon} size="large" />, [icon]);

    const handleTargetTopId = getHandleId({ nodeId: id, handleType: 'target', innerId: 'top' });
    const handleTargetLeftId = getHandleId({ nodeId: id, handleType: 'target', innerId: 'left' });
    const handleSourceBottomId = getHandleId({ nodeId: id, handleType: 'source', innerId: 'bottom' });
    const handleSourceRightId = getHandleId({ nodeId: id, handleType: 'source', innerId: 'right' });

    return (
      <NodePanel.Root selected={selected}>
        <NodePanel.Header>
          <NodeIcon icon={iconElement} />
          <NodeDescription label={label} description={description} />
        </NodePanel.Header>
        <NodePanel.Handles isVisible={showHandles}>
          <Handle id={handleTargetTopId} type="target" position={Position.Top} />
          <Handle id={handleTargetLeftId} type="target" position={Position.Left} />
          <Handle id={handleSourceBottomId} type="source" position={Position.Bottom} />
          <Handle id={handleSourceRightId} type="source" position={Position.Right} />
        </NodePanel.Handles>
      </NodePanel.Root>
    );
  },
);
```

The example composes the node from `@workflowbuilder/ui` primitives (`NodePanel.Root`, `NodePanel.Header`, `NodePanel.Handles`) — the same building blocks Workflow Builder uses for its own node renderers, so the result matches the editor's visual language out of the box.

The component receives [`WorkflowNodeTemplateProps`](/api/components/workflownodetemplateprops/). Use [`getHandleId`](/api/utilities/gethandleid/) for handle IDs and pass `innerId` when a node has more than one handle of the same type. If your template needs typed access to `data.properties`, wrap the component in [`defineNodeTemplate`](/api/components/definenodetemplate/) to bind a schema-derived properties type.

Wire it through the `nodeTemplates` prop on `<WorkflowBuilder.Root>`:

```tsx
<WorkflowBuilder.Root
  nodeTypes={[webhookNode]}
  nodeTemplates={{ webhook: MyNodeTemplate }}
  integration={{ strategy: 'props', onDataSave }}
/>
```

The key must match the palette item's `type`. Keys that collide with built-in template names (`'node'`, `'start-node'`, `'ai-node'`, `'decision-node'`) override the built-in renderer for that node category. This affects rendering only — a node is an entry point because of its `isStartNode` flag, never because of the template it draws with. Declare `nodeTemplates` at module level — recreating the map on every render busts ReactFlow's internal memoisation and remounts every node on the canvas.

The same template renders both the canvas node and the static palette thumbnail / drag-ghost. In preview mode `data`, `selected`, and `layoutDirection` are `undefined` — read them with optional chaining and fall back to defaults.

One thing the custom template path does **not** include: `NodeAsPortWrapper` (drag-to-create connections by dropping onto the node body). If you need that, register a custom node container through a plugin instead — see [Build a plugin](/guides/build-a-plugin/).

#### Conditional fields

Show or hide fields based on other field values via `rule`:

```ts
{
  type: 'Text',
  scope: '#/properties/url',
  rule: {
    effect: 'SHOW',
    condition: {
      scope: '#/properties/method',
      schema: { enum: ['POST', 'PUT'] },
    },
  },
}
```

This renders the `url` field only when `method` is `'POST'` or `'PUT'`.

#### Validation

JSON Schema validation runs automatically. Use `required`, `minLength`, `pattern`, `format`, etc. in `schema.ts` — the editor surfaces validation failures on the affected node and in the property panel.

#### Grouping nodes in the palette

Pass a mix of items and groups to `nodeTypes`:

```ts
nodeTypes: [
  { group: 'Integrations', items: [webhookNode, emailNode, slackNode] },
  { group: 'Logic', items: [conditionalNode, delayNode] },
];
```

The palette renders one collapsible section per group.

#### What's happening under the hood

1. `<WorkflowBuilder.Root>` receives your props and registers the custom renderer in the JsonForms extension registry plus the `nodeTypes` array in the palette registry.
2. When a `Webhook` node is dropped on the canvas, `defaultPropertiesData` populates its initial state.
3. When the node is selected, the property panel renders `uischema` with JsonForms. Your custom renderer's tester matches `{ type: 'ColorPicker' }` and wins over the built-in fallback.
4. Edits flow through `handleChange` into the diagram model; `onDataSave` is called when the persistence strategy decides to save.

#### See also

- [Node schemas](/node-schemas/) — overview of both halves of a node's schema
- [Data schema](/node-schemas/data-schema/) — the JSON-Schema half: types, validation, options
- [Form overview](/node-schemas/form-overview/) — the UI layer
- [Form controls](/node-schemas/form-controls/) — every built-in control type with its props and an example
- [Form layouts](/node-schemas/form-layouts/) — `VerticalLayout`, `HorizontalLayout`, `Group`, `Accordion`
- [Custom JsonForms control](/guides/custom-jsonforms-control/) — full registry / cell / translation reference
- [Node library](/overview/features/node-library/) — what the palette does for users
- [Properties sidebar](/overview/features/properties-sidebar/) — schema-driven forms in the property panel
- [Built-in Nodes](/nodes/) — example node types shipped with the demo

Stuck modeling a node for your domain? [Contact us](https://www.workflowbuilder.io/contact).

### Configuring the editor

*Source: `guides/configuring-the-editor.md` — description: Pass node types, integration strategy, plugins, and JsonForms extensions to WorkflowBuilder.Root.*

> **⚠️ main only — `isStartNode` does not exist in `@workflowbuilder/sdk@2.3.0`.** This page puts `isStartNode` in TypeScript (on a `PaletteItem`, and/or read off `node.data` inside a typed callback). In 2.3.0 `NodeDefinition` is `… & Pick<NodeData, 'type' | 'icon' | 'templateType'>` — no `isStartNode`. Code copied from this page **will not typecheck** against the installed 2.3.0.

`<WorkflowBuilder.Root>` is the main entry point of the SDK. Mount it at the top of your editor subtree with the props you need. The full type-level reference lives at [`WorkflowBuilderRoot`](/api/core/workflowbuilderroot/) under API Reference; this page focuses on what each prop does and when you reach for it.

```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

<WorkflowBuilder.Root nodeTypes={[/* ... */]} integration={/* ... */} />;
```

#### Props reference

Every prop is optional. The **Type** column links to the auto-generated [API Reference](/api/core/workflowbuilderrootprops/) for the exact shape. The **Description** points to the section or guide that shows how to use each prop, and notes the default where there is one.

| Prop                | Type                                                                              | Description                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration`       | [`WorkflowBuilderIntegration`](/api/integration/workflowbuilderintegration/)      | How the builder loads and persists diagram data. Defaults to `{ strategy: 'localStorage' }`. See [Integration strategies](#integration-strategies).                 |
| `nodeTypes`         | [`PaletteItemOrGroup[]`](/api/types/paletteitemorgroup/)                          | Node type definitions rendered in the palette and used for validation. Defaults to `[]` (empty palette). See [Node types](#node-types).                             |
| `nodeTemplates`     | [`WorkflowBuilderNodeTemplates`](/api/components/workflowbuildernodetemplates/)   | Per-node-type custom renderers, keyed by `data.type`. See [Custom node and edge renderers](#custom-node-and-edge-renderers).                                        |
| `edgeTemplates`     | [`WorkflowBuilderEdgeTemplates`](/api/components/workflowbuilderedgetemplates/)   | Per-edge-type custom renderers, keyed by `edge.type`, overriding the built-in `'labelEdge'`. See [Custom node and edge renderers](#custom-node-and-edge-renderers). |
| `diagramTemplates`  | [`TemplateModel[]`](/api/types/templatemodel/)                                    | Starter diagrams offered in the template selector. Defaults to `[]`.                                                                                                |
| `jsonForm`          | [`WorkflowBuilderJsonFormConfig`](/api/plugins/workflowbuilderjsonformconfig/)    | Custom JSONForms renderers, cells, and translations for the properties panel. See [Custom JsonForms control](/guides/custom-jsonforms-control/).                    |
| `plugins`           | [`WorkflowBuilderPlugin[]`](/api/plugins/workflowbuilderplugin/)                  | Plugin initializer functions, each called once on first mount. See [Build a plugin](/guides/build-a-plugin/).                                                       |
| `name`              | `string`                                                                          | Workflow name shown in the header and included in saved data.                                                                                                       |
| `logo`              | `WorkflowBuilderLogo`                                                             | Replaces the built-in app-bar logo: an image URL, `{ light, dark }` per-theme URLs, or a custom element.                                                            |
| `logoHref`          | `string`                                                                          | Wraps the app-bar logo (built-in or custom) in a link opened in a new tab.                                                                                          |
| `layoutDirection`   | [`LayoutDirection`](/api/types/layoutdirection/)                                  | Initial flow direction, `'DOWN'` or `'RIGHT'`. Defaults to `'DOWN'`.                                                                                                |
| `initialNodes`      | [`WorkflowBuilderNode[]`](/api/types/workflowbuildernode/)                        | Initial nodes for the `props` integration strategy. Defaults to `[]`. See [`props`](#props).                                                                        |
| `initialEdges`      | [`WorkflowBuilderEdge[]`](/api/types/workflowbuilderedge/)                        | Initial edges for the `props` integration strategy. Defaults to `[]`. See [`props`](#props).                                                                        |
| `isValidConnection` | [`WorkflowBuilderIsValidConnection`](/api/core/workflowbuilderisvalidconnection/) | Validate connections as the user draws them. See [Connection validation](#connection-validation).                                                                   |
| `reactFlowProps`    | [`WorkflowBuilderReactFlowProps`](/api/core/workflowbuilderreactflowprops/)       | Escape hatch forwarding extra props to the underlying ReactFlow canvas. See [Advanced: ReactFlow props](#advanced-reactflow-props).                                 |
| `children`          | `ReactNode`                                                                       | Custom layout. Omit for the default floating-overlay layout. See [Compound subcomponents](#compound-subcomponents).                                                 |

#### Compound subcomponents

Build your own layout by composing the namespaced subcomponents:

| Component                         | Renders                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `WorkflowBuilder.TopBar`          | App-bar with name, controls, toolbar.                       |
| `WorkflowBuilder.Palette`         | Palette of node types (draggable).                          |
| `WorkflowBuilder.Canvas`          | xyflow canvas with nodes, edges, drag-drop.                 |
| `WorkflowBuilder.PropertiesPanel` | Properties sidebar driven by JsonForms.                     |
| `WorkflowBuilder.DefaultLayout`   | The default floating-overlay arrangement of the four above. |

Pass children to skip the default layout and compose your own:

```tsx
<WorkflowBuilder.Root nodeTypes={myNodeTypes}>
  <header>
    <WorkflowBuilder.TopBar />
  </header>
  <aside>
    <WorkflowBuilder.Palette />
  </aside>
  <main>
    <WorkflowBuilder.Canvas />
  </main>
  <aside>
    <WorkflowBuilder.PropertiesPanel />
  </aside>
</WorkflowBuilder.Root>
```

To extend the default layout instead of replacing it (e.g. add a banner alongside), mount `DefaultLayout` explicitly:

```tsx
<WorkflowBuilder.Root nodeTypes={[]}>
  <WorkflowBuilder.DefaultLayout />
  <MyTopBanner />
</WorkflowBuilder.Root>
```

#### Custom toolbar without the app bar

`<WorkflowBuilder.TopBar />` ships the save, import / export, settings, read-only, and theme controls. When you omit it from a custom layout, reach the same commands through the `useWorkflowBuilderActions()` hook. Call it from any descendant of `<WorkflowBuilder.Root>` and wire the returned callbacks to your own buttons:

```tsx
import { useWorkflowBuilderActions } from '@workflowbuilder/sdk';

function MyToolbar() {
  const actions = useWorkflowBuilderActions();

  return (
    <header>
      <button onClick={actions.save}>Save</button>
      <button onClick={actions.openImport}>Import</button>
      <button onClick={actions.openExport}>Export</button>
      <button onClick={actions.openSettings}>Settings</button>
      <button onClick={actions.toggleReadOnly}>Read-only</button>
      <button onClick={actions.toggleDarkMode}>Theme</button>
    </header>
  );
}
```

The hook returns a stable object, so you can pass any callback straight to an event handler. See [`WorkflowBuilderActions`](/api/hooks/workflowbuilderactions/) for the full action list. A few notes:

- It must be called from a descendant of `<WorkflowBuilder.Root>`. `save` reads the active [integration strategy](#integration-strategies) via context, so calling the hook outside Root resolves `save()` to `'error'` and logs a warning.
- The hook also exposes layout-direction control the bar does not surface: `setLayoutDirection('RIGHT' | 'DOWN')` (idempotent) and `toggleLayoutDirection({ flipPositions?, fitView? })`. `flipPositions` mirrors each node's `x`/`y` as a naive axis swap. It is not auto-layout and ignores node sizes, so pair it with `fitView`. That is why it lives only on the toggle, not on `setLayoutDirection`.
- The top bar also shows and edits the document name. Render your own with `useStore`: read `s.documentName` and write through `s.setDocumentName`.

#### Node types

```ts
type PaletteItemOrGroup = PaletteItem | PaletteGroup;
```

The SDK ships no default palette — `nodeTypes` must be supplied for the palette to have content. Each `PaletteItem` carries its own `schema` (JSON Schema) and `uischema` (JSONForms UI Schema) — those schemas drive the property panel rendered by JSONForms.

```tsx
<WorkflowBuilder.Root
  nodeTypes={[
    {
      type: 'myCustomNode',
      label: 'My Custom Node',
      schema: {
        /* JSON Schema */
      },
      uischema: {
        /* UI Schema */
      },
      // … (see PaletteItem type for the full shape)
    },
  ]}
  integration={{ strategy: 'props', onDataSave }}
/>
```

#### Custom node and edge renderers

By default every node uses the SDK's built-in renderer (a header with one input and one output handle) and every edge uses the built-in `'labelEdge'`. Override either per type, without writing a plugin:

- `nodeTemplates` maps a palette `type` string to a React component. Matching nodes render your component instead of the default. The component receives [`WorkflowNodeTemplateProps`](/api/components/workflownodetemplateprops/).
- `edgeTemplates` maps an `edge.type` string to a React component receiving ReactFlow's `EdgeProps`. Unlike node templates, edge components need no adapter. They drop straight into ReactFlow's edge-type map.

```tsx
<WorkflowBuilder.Root
  nodeTypes={myNodeTypes}
  nodeTemplates={{ webhook: WebhookNode }}
  edgeTemplates={{ conditional: ConditionalEdge }}
/>
```

Declare both maps at module scope. Recreating them on every render busts ReactFlow's memoisation and remounts every node and edge on the canvas. For the full walkthrough (handle IDs, typed `data.properties`, overriding the built-in node categories) see [Add a custom node type](/guides/add-a-custom-node/).

#### Integration strategies

`WorkflowBuilderIntegration` is a discriminated union. Each strategy defines where the builder reads initial state and where it writes on save.

```ts
type WorkflowBuilderIntegration =
  | { strategy?: 'localStorage' }
  | { strategy: 'api'; endpoints: { load: string; save: string } }
  | { strategy: 'props'; onDataSave: OnSaveExternal };
```

| Strategy       | Initial data                                     | Save target                     | Use when                             |
| -------------- | ------------------------------------------------ | ------------------------------- | ------------------------------------ |
| `localStorage` | Browser `localStorage['workflowBuilderDiagram']` | Same key in `localStorage`      | Prototyping, demos, default behavior |
| `api`          | `GET` to `endpoints.load`                        | `POST` JSON to `endpoints.save` | Backend-managed persistence          |
| `props`        | `initialNodes` / `initialEdges` instance props   | `onDataSave` callback           | Host app manages persistence itself  |

##### `localStorage`

```tsx
<WorkflowBuilder.Root />
// integration omitted — localStorage is the default
```

##### `api`

```tsx
<WorkflowBuilder.Root
  integration={{
    strategy: 'api',
    endpoints: {
      load: '/api/workflow/load',
      save: '/api/workflow/save',
    },
  }}
/>
```

##### `props`

```tsx
<WorkflowBuilder.Root
  name="wf-1"
  initialNodes={
    [
      /* ... */
    ]
  }
  initialEdges={
    [
      /* ... */
    ]
  }
  integration={{
    strategy: 'props',
    onDataSave: async (data, params) => {
      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      // The runtime renders a success snackbar on any non-empty resolution
      // (`'success'`, `'error'`, `'alreadyStarted'` all look the same at the
      // UI layer). Throw to surface the error snackbar instead.
      if (!response.ok) throw new Error(`Save failed: ${response.status}`);
      return 'success';
    },
  }}
/>
```

##### `OnSaveExternal`

```ts
type OnSaveExternal = (data: IntegrationDataFormat, savingParams?: OnSaveParams) => Promise<DidSaveStatus>;

type IntegrationDataFormat = {
  name: string;
  layoutDirection: LayoutDirection;
  nodes: WorkflowBuilderNode[];
  edges: WorkflowBuilderEdge[];
};

type OnSaveParams = { isAutoSave?: boolean };
type DidSaveStatus = 'success' | 'error' | 'alreadyStarted';
```

Today the runtime treats every non-empty resolution of `onDataSave` as "the save finished", surfacing the success-style snackbar — `'success'`, `'error'`, and `'alreadyStarted'` all behave the same way at the UI level. Throw from `onDataSave` instead of resolving to `'error'` if you need an error snackbar.

#### Connection validation

`isValidConnection` decides whether a dragged connection is allowed. Return `false` to reject it: no edge is created, no flicker. It receives the resolved `sourceNode` / `targetNode` (plus the raw `connection`), so a rule can branch on node `data` without reaching into the store. Declare it at module scope (or memoize) to keep the reference stable.

```tsx
import { WorkflowBuilder, type WorkflowBuilderIsValidConnection } from '@workflowbuilder/sdk';

// A start node is the workflow entry point, so it can never be a connection target.
const isValidConnection: WorkflowBuilderIsValidConnection = ({ targetNode }) => !targetNode.data.isStartNode;

<WorkflowBuilder.Root isValidConnection={isValidConnection} />;
```

Validates interactive drags only, not programmatic edge writes (templates, paste, `setStoreEdges`). Fail-open: if an endpoint can't be resolved to a node, the connection is allowed.

#### Advanced: ReactFlow props

`reactFlowProps` forwards extra props to the underlying ReactFlow canvas for things the SDK doesn't expose directly (zoom limits, key codes, `onNodeClick`, performance flags, …).

```tsx
import { WorkflowBuilder, type WorkflowBuilderReactFlowProps } from '@workflowbuilder/sdk';

const reactFlowProps = {
  maxZoom: 1.5,
  zoomOnDoubleClick: false,
  onNodeClick: (_, node) => console.log(node.id),
} satisfies WorkflowBuilderReactFlowProps;

<WorkflowBuilder.Root reactFlowProps={reactFlowProps} />;
```

Props the SDK owns (graph data, the connection / selection / change handlers, type maps, `colorMode`, …) can't be set here. To observe SDK events use the listener APIs (`addNodeChangedListener`, …); to theme use the design tokens. Treat `reactFlowProps` as static config: runtime value changes may not apply immediately.

### Custom JsonForms control

*Source: `guides/custom-jsonforms-control.md` — description: Register a custom renderer, cell, or plugin translation for node property panels.*

Node properties render through [JsonForms](https://jsonforms.io). Plug in a custom React component for any property type — colour picker, code editor, file uploader — by registering a renderer through the `jsonForm` prop on `<WorkflowBuilder.Root>`.

#### `WorkflowBuilderJsonFormConfig`

```ts
interface WorkflowBuilderJsonFormConfig {
  renderers?: JsonFormsRendererExtension[];
  cells?: JsonFormsCellExtension[];
  translations?: PluginTranslationResource;
}

type JsonFormsRendererExtension = JsonFormsRendererRegistryEntry; // from @jsonforms/core
type JsonFormsCellExtension = JsonFormsCellRendererRegistryEntry; // from @jsonforms/core
```

Consumer-supplied renderers are tried **before** the built-ins. When two testers return the same rank, yours wins — that's how you override a built-in control.

#### Custom renderer — full example

Everything you need is re-exported from `@workflowbuilder/sdk` — you never install or import `@jsonforms/*` yourself. That matters for more than convenience: a renderer wrapped with a HOC from your own copy of JsonForms would read from a different React context than the SDK renders with and silently receive empty props. Importing from the SDK guarantees a single shared copy.

```tsx
import {
  type ControlProps,
  type JsonFormsRendererExtension,
  WorkflowBuilder,
  rankWith,
  uiTypeIs,
  withJsonFormsControlProps,
} from '@workflowbuilder/sdk';

import '@workflowbuilder/sdk/style.css';

function ColorPicker({ data, handleChange, path }: ControlProps) {
  return <input type="color" value={data ?? '#000000'} onChange={(e) => handleChange(path, e.target.value)} />;
}

const colorPickerRenderer: JsonFormsRendererExtension = {
  tester: rankWith(5, uiTypeIs('ColorPicker')),
  renderer: withJsonFormsControlProps(ColorPicker),
};

function App() {
  return (
    <WorkflowBuilder.Root
      jsonForm={{ renderers: [colorPickerRenderer] }}
      integration={{ strategy: 'props', onDataSave }}
    />
  );
}
```

Any node whose `uischema` contains `{ type: 'ColorPicker', scope: '...' }` will now render with your `ColorPicker` component.

#### Cells

`cells` work the same way — type the entry with `JsonFormsCellExtension` and wrap your component with `withJsonFormsCellProps` (also from `@workflowbuilder/sdk`) for list/array cell rendering. Built-in cells are passed through when consumer cells are absent; if you provide any, yours are used as-is (no merging with built-ins for cells).

#### Translations

```ts
type PluginTranslationResource = {
  [lang: string]: {
    translation: {
      [key: string]: {
        [key: string]: string | { [key: string]: string };
      };
    };
  };
};
```

Translations are merged into the `plugins.*` namespace of the built-in i18n resources.

```tsx
<WorkflowBuilder.Root
  jsonForm={{
    translations: {
      en: {
        translation: {
          plugins: {
            colorPicker: {
              label: 'Pick a color',
              description: 'Choose any color for the node',
            },
          },
        },
      },
    },
  }}
  integration={{ strategy: 'props', onDataSave }}
/>
```

The same translations can also be registered imperatively via [`registerPluginTranslation`](/guides/build-a-plugin/#registerplugintranslation).

#### Authoring primitives

All the JsonForms building blocks — the `withJsonForms*Props` HOCs, the `useJsonForms` hook, `JsonFormsDispatch`, the testers (`rankWith`, `uiTypeIs`, `schemaTypeIs`, …), `RuleEffect`, and the prop types (`ControlProps`, `CellProps`, …) — are re-exported from `@workflowbuilder/sdk`. The full list lives in the Forms section of the [API reference](/api/).

#### Related types

Available via `import type { ... } from '@workflowbuilder/sdk'`:

- [`WorkflowBuilderJsonFormConfig`](/api/plugins/workflowbuilderjsonformconfig/)
- [`JsonFormsRendererExtension`](/api/plugins/jsonformsrendererextension/)
- [`JsonFormsCellExtension`](/api/plugins/jsonformscellextension/)
- [`PluginTranslationResource`](/api/plugins/plugintranslationresource/)
- [`UISchema`](/api/types/uischema/) — for typing your `uischema.ts`. Built-in element types are listed in [Form overview](/node-schemas/form-overview/).

### Build a plugin

*Source: `guides/build-a-plugin.md` — description: Compose registerComponentDecorator, registerFunctionDecorator, and registerPluginTranslation into a plugin function passed to WorkflowBuilder.Root.*

A plugin is a synchronous function that registers component decorators, function decorators, JsonForms extensions, and / or translations by calling the SDK's `register*` APIs. `<WorkflowBuilder.Root>` invokes every plugin in the `plugins` prop in order, once on first mount, via a lazy `useState` initializer.

Combined with [Custom JsonForms control](/guides/custom-jsonforms-control/), the three registration functions below cover most customisation needs.

All three are side-effecting and safe to call more than once — pass a `name` to deduplicate.

#### Plugins as initializer callbacks

```ts
type WorkflowBuilderPlugin = () => void;
```

Most plugins combine multiple registrations. Wrap them in a function and pass via the `plugins` prop on `<WorkflowBuilder.Root>`:

```tsx
const myPlugin: WorkflowBuilderPlugin = () => {
  registerComponentDecorator('OptionalAppBarControls', {
    content: MyButton,
    name: 'my-plugin',
  });
  registerFunctionDecorator('trackFutureChange', {
    place: 'after',
    callback: ({ params }) => auditLog(params),
    name: 'my-plugin',
  });
};

<WorkflowBuilder.Root plugins={[myPlugin]} />;
```

Plugins can also be called directly — the registries are currently module-global singletons. See [Known limitations](/get-started/side-effects/#known-limitations).

#### `registerComponentDecorator`

Add, wrap, or modify a component mounted in a named slot.

```ts
function registerComponentDecorator<P = object>(slotName: string, options: ComponentDecoratorOptions<P>): void;

type ComponentDecoratorOptions<P = object> =
  | {
      place?: 'before' | 'after' | 'wrapper';
      content: React.ElementType;
      modifyProps?: (props: P) => P;
      priority?: number;
      name?: string;
    }
  | {
      modifyProps?: (props: P) => P;
      priority?: number;
      name?: string;
    };
```

##### Options

- **`place`** — where to render relative to the slot's host:
  - `'before'` (default) — render your content before the host.
  - `'after'` — render after.
  - `'wrapper'` — wrap the host entirely (your `content` receives the host as children).
- **`content`** — the React component to render.
- **`modifyProps`** — function receiving the host's props, returning modified props.
- **`priority`** — higher = rendered first. Default `0`.
- **`name`** — unique identifier within the slot; prevents duplicate registration across calls.

##### Available slots

| Slot name                | Where it renders                        |
| ------------------------ | --------------------------------------- |
| `OptionalAppBarControls` | App bar — control buttons area          |
| `OptionalAppBarTools`    | App bar — toolbar area                  |
| `OptionalAppChildren`    | App-level children (portals, providers) |
| `OptionalEdgeProperties` | Edge properties panel                   |
| `OptionalFooterContent`  | Footer area                             |
| `OptionalHooks`          | Invisible provider/hook slot            |
| `OptionalNodeContent`    | Inside nodes (receives `nodeId` prop)   |

##### Example

```tsx
import { registerComponentDecorator } from '@workflowbuilder/sdk';

import { MyCustomButton } from './my-custom-button';

registerComponentDecorator('OptionalAppBarControls', {
  content: MyCustomButton,
  name: 'MyPlugin',
  priority: 10, // shown before decorators with lower priority
});
```

##### Typing `modifyProps`

Pass the slot's props type as the type parameter so `modifyProps` is checked against the actual host's prop shape. Slots that target a built-in component export a matching `*Props` type from the SDK barrel — for example, `DiagramContainerProps` for the `'DiagramContainer'` slot, [`ProjectSelectionProps`](/api/components/projectselectionprops/) for `'ProjectSelection'`, and [`PropertiesBarProps`](/api/components/propertiesbarprops/) for `'PropertiesBar'`.

```tsx
import { registerComponentDecorator } from '@workflowbuilder/sdk';
import type { DiagramContainerProps } from '@workflowbuilder/sdk';

import { myEdgeTypes } from './edges';

registerComponentDecorator<DiagramContainerProps>('DiagramContainer', {
  modifyProps: (props) => ({
    ...props,
    edgeTypes: { ...props.edgeTypes, ...myEdgeTypes }, // typed against EdgeTypes
  }),
});
```

For a custom slot you control, type the parameter with your component's own props instead — `registerComponentDecorator<MyButtonProps>('MyCustomSlot', { … })`.

#### `registerFunctionDecorator`

Intercept a decorable function before/after its execution.

```ts
function registerFunctionDecorator(functionName: string, options: FunctionDecoratorOptions): void;

type FunctionDecoratorOptions =
  | { place?: 'before'; callback: CallbackBefore; priority?: number; name?: string }
  | { place: 'after'; callback: CallbackAfter; priority?: number; name?: string };

type CallbackBefore = (args: { params: unknown[] }) => void | { replacedParams: unknown[] };
type CallbackAfter = (args: { params: unknown[]; returnValue: unknown }) => void | { replacedReturn: unknown };
```

##### Decorable functions

A non-exhaustive list (grep `withOptionalFunctionPlugins` in the source for the complete set):

| Function name          | What it does                               |
| ---------------------- | ------------------------------------------ |
| `getPaletteData`       | Builds the palette data structure.         |
| `getTemplates`         | Builds the template list.                  |
| `trackFutureChange`    | Records an upcoming diagram change.        |
| `getControlsDotsItems` | Builds the dots-menu items in the app bar. |

##### Return conventions

- **Before-decorator**: return nothing (observe) or `{ replacedParams: [...] }` (substitute arguments).
- **After-decorator**: return nothing (observe) or `{ replacedReturn: ... }` (substitute the result).

##### Example

```ts
import { registerFunctionDecorator } from '@workflowbuilder/sdk';

// Run code BEFORE a function executes
registerFunctionDecorator('trackFutureChange', {
  place: 'before',
  callback: ({ params }) => {
    console.log('Change incoming:', params);
  },
});

// Run code AFTER and optionally replace the return value
registerFunctionDecorator('trackFutureChange', {
  place: 'after',
  callback: ({ params, returnValue }) => {
    return { replacedReturn: modifiedValue };
  },
});
```

#### `registerPluginTranslation`

Merge additional i18n resources into the `plugins.*` namespace.

```ts
function registerPluginTranslation(resource: PluginTranslationResource): void;
```

```ts
import { registerPluginTranslation } from '@workflowbuilder/sdk';

registerPluginTranslation({
  en: {
    translation: {
      plugins: {
        myPlugin: {
          label: 'My Plugin',
          description: 'Does something useful',
        },
      },
    },
  },
});
```

Equivalent to passing `translations` via `<WorkflowBuilder.Root jsonForm={{ translations }} />`. Use whichever is more convenient for your plugin's lifecycle.

### Use Variable Picker

*Source: `guides/use-variable-picker.mdx` — description: Insert references to data from earlier workflow steps into a downstream node's configuration using the variable picker.*

The variable picker is a properties-panel control that lets you insert references to data from earlier workflow steps without hard-coding the value. Instead of a literal value, you point at an upstream node's output (or the workflow's trigger payload), and the real value is filled in when the workflow runs.

#### Where it works

The picker is wired up on these built-in fields:

| Node                         | Field                 | Picker |
| ---------------------------- | --------------------- | ------ |
| [AI Agent](/nodes/ai-agent/) | System prompt         | Yes    |
| [Decision](/nodes/decision/) | Condition `X` and `Y` | Yes    |

#### Using the picker

1. Focus a supported field in the properties panel.
2. Type `{{`. A suggestions panel opens, grouped by upstream node, with each property's label and description.
3. Pick a suggestion. The field shows a chip labeled `{{ <Node Label> · <Property> }}` (for example `{{ Classify · Response }}`). Continue typing around the chip to mix references with literal text. Press `Esc` or click outside to dismiss the panel.

The chip is the editor view; the diagram stores the raw form `{{nodes.<nodeId>.<property>}}`.

Suggestions come only from **ancestor** nodes - nodes reachable by following edges backward from the selected node. Each suggestion is built from the ancestor's `outputSchema`, so a node only appears in the picker if it declares one.

#### Syntax

A reference uses the form:

```
{{namespace.path}}
```

Paths use dot notation and can drill into nested keys of any object the upstream node emits:

```
{{nodes.ai-agent-1.response}}
{{nodes.trigger-1.payload.customer.email}}
```

A field can mix references with literal text:

```
Summarize the following request from {{nodes.trigger-1.payload.customer.name}}:

{{nodes.classify-1.response}}
```

The path syntax does not support array indexing, filters, or transforms - only nested key access on objects.

#### Namespaces

The SDK only stores these references as text on the diagram. Actual values are filled in later, when the workflow runs.

##### `nodes.<nodeId>.<path>`

Output of an ancestor node, keyed by the node's `id`. **Surfaced in the picker.** The available properties for each ancestor come from that node's `outputSchema`.

For example, an AI Agent node emits `response`, `tokensUsed`, and `model`, so a downstream field can reference any of:

```
{{nodes.<ai-agent-id>.response}}
{{nodes.<ai-agent-id>.tokensUsed}}
{{nodes.<ai-agent-id>.model}}
```

##### `trigger.<path>`

The raw payload that started the current workflow run - exactly as it was received. **Manual entry only - not surfaced in the picker today.** Type the reference yourself:

```
{{trigger.orderId}}
{{trigger.customer.email}}
```

Typing `{{` opens the suggestions panel, which only lists ancestor-node properties - keep typing past it to enter a `trigger.*` reference as plain text.

:::note
`trigger.<path>` and `nodes.<triggerNodeId>.<path>` are **not** the same thing. `trigger.<path>` is the unprocessed input that started the run; `nodes.<triggerNodeId>.<path>` is whatever the trigger node _emitted_ - which may transform or repackage the original payload.
:::

##### `variables.<path>`

Globals and secrets available at the start of each run. **Manual entry only - not surfaced in the picker today.** Type the reference yourself:

```
{{variables.apiBaseUrl}}
{{variables.tenantId}}
```

The set of available variables depends on how your workflow runner is configured.

#### Missing values

A plain reference is **strict**: if the resolver cannot find the path in the execution context, the workflow run fails with `Unresolved template reference: {{…}}`. That is deliberate - a typo in a prompt template should be caught on the first run, not silently substituted with an empty string and shipped to the LLM.

For paths that may genuinely be absent some of the time (an optional trigger field, a node output that only exists on one branch of a decision), two opt-in modifiers let you declare a fallback:

| Form                                    | When path is missing |
| --------------------------------------- | -------------------- |
| `{{nodes.x.response}}`                  | throws (strict)      |
| `{{nodes.x.response?}}`                 | resolves to `''`     |
| `{{nodes.x.response \| default:'tbd'}}` | resolves to `'tbd'`  |

```
Hello, {{trigger.customer.name?}}!
Status: {{nodes.classify-1.label | default:'unclassified'}}
```

A modifier fires **only when the resolved value is strictly `undefined`** - i.e. the namespace, the node, or one of the dot-path segments does not exist on the live execution context. `null`, `''`, and `0` are real values: a node that emits `{ count: 0 }` resolves `{{nodes.x.count?}}` to `'0'`, not to the fallback. Pick the modifier deliberately when the _absence_ of a value is what you want to handle.

The `default:'…'` syntax requires single quotes, and the value cannot contain a single quote. Use `?` if you need an empty fallback.

#### Examples

##### Example 1: Pass an AI Agent's response into the next AI Agent

1. Drop two AI Agent nodes onto the canvas and connect them: `Classify -> Respond`.
2. Configure `Classify` with a prompt that produces a category, e.g. _"Classify the following request as one of: refund, support, sales."_
3. Open `Respond`. Focus the **System prompt** field and type `{{`.
4. From the picker, choose **Classify · Response**. The field renders a chip labeled `{{ Classify · Response }}`; the diagram stores it as `{{nodes.<classify-id>.response}}`.
5. Type the rest of the prompt around the chip. The editor view looks like this:

```
You are responding to a request that has been classified as: {{ Classify · Response }}.

Answer in two sentences, in the tone appropriate for that category.
```

##### Example 2: Branch on a value in the trigger payload

1. Drop a Decision node downstream of your trigger.
2. Add a branch labeled **High priority**, with one condition.
3. In the condition's **X** field, type the reference manually (the picker does not surface `trigger.<path>` today):

```
{{trigger.priority}}
```

4. Set the comparison operator to `is equal`.
5. Set the **Y** field to the literal `high`.

#### Add the picker to a custom node

##### Make a field accept references

In the node's UI schema, use `VariableText` (single-line) or `VariableTextArea` (multi-line) instead of `Text` / `TextArea`:

```typescript
{
  type: 'VariableTextArea',
  scope: scope('properties.systemPrompt'),
  placeholder: 'Use {{ to insert variables',
  minRows: 5,
}
```

The control behaves like the matching plain control, except `{{` opens the suggestions panel.

##### Expose the node's outputs to downstream pickers

Add an `outputSchema` to the node's `PaletteItem`. Each entry describes one output property the node will emit:

```typescript
import type { PaletteItem } from '@workflowbuilder/sdk';

export const myNode: PaletteItem = {
  // ...label, type, schema, defaults, uischema
  outputSchema: {
    properties: {
      response: { type: 'string', label: 'Response', description: 'The text returned by the model' },
      tokensUsed: { type: 'number', label: 'Tokens Used' },
    },
  },
};
```

Without an `outputSchema`, the node never appears as a group in any downstream picker.

#### See also

- [Add a custom node](/guides/add-a-custom-node/) - register a new node type that participates in the picker
- [AI Agent node](/nodes/ai-agent/) - uses the picker on the system prompt
- [Decision node](/nodes/decision/) - uses the picker on condition operands

### Save Diagrams to Database

*Source: `guides/save-diagrams-to-database.mdx` — description: A minimal example of persisting Workflow Builder diagrams to a backend database.*

This example shows the minimal steps to save and load a diagram from a database using the API integration strategy.

#### Backend endpoint

You need two endpoints. The exact implementation depends on your stack - here's a simple Node.js/Express example:

```typescript
import express from 'express';

const app = express();
app.use(express.json());

// In-memory store (replace with your database)
let savedDiagram = null;

// Load diagram
app.get('/api/workflow', (request, response) => {
  response.json(savedDiagram ?? {});
});

// Save diagram
app.post('/api/workflow', (request, response) => {
  savedDiagram = request.body;
  response.json({ ok: true });
});
```

#### Frontend integration

> **Tip** _(partial `_file-paths-disclaimer.mdx`)_
>
> File paths in this guide are relative to the [Standalone App](/get-started/quick-start/standalone-app/) repository
> structure. If you embedded Workflow Builder differently, adjust the paths to match your project layout.

Use the API integration strategy in Workflow Builder and point it at your endpoints:

```typescript
// <root>/features/integration/components/
// integration-variants/with-integration-through-api.tsx

// Load - replace the fetch URL:
const response = await fetch('/api/workflow');

// Save - replace the fetch URL and method:
const response = await fetch('/api/workflow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
```

#### The diagram data

The `data` object POSTed to your API has this shape:

```json
{
  "name": "My Workflow",
  "layoutDirection": "DOWN",
  "nodes": [
    {
      "id": "abc-123",
      "type": "node",
      "position": { "x": 100, "y": 200 },
      "data": {
        "type": "trigger",
        "icon": "Lightning",
        "properties": {
          "label": "Start",
          "description": "Trigger"
        }
      }
    }
  ],
  "edges": []
}
```

Store this as a JSON column in your database. No transformation is needed - load it back as-is to restore the diagram.

#### Storing multiple diagrams

To support multiple diagrams per user, add a diagram ID to the endpoint:

```
GET  /api/workflows/:id
POST /api/workflows/:id
```

Pass the ID to the integration wrapper or manage it in your parent component using the [through props](/get-started/persistence/callback/) strategy.

#### See also

- [REST API persistence](/get-started/persistence/rest-api/) - load and save diagrams from a backend REST API
- [via callback persistence](/get-started/persistence/callback/) - pass diagram data and save callbacks as React props
- [Diagram state management](/overview/features/diagram-state-management/) - canvas state, undo/redo, and auto-save

Need help wiring this up to a real database, auth, or multi-user setup? [Contact us](https://www.workflowbuilder.io/contact) — we've built end-to-end persistence layers for production deployments.

---

## 4. Node schemas

Every control and every layout, with its props, is transcribed in full below — `form-controls.md` and `form-layouts.md` are reproduced verbatim, tables included.

### Node schemas

*Source: `node-schemas/index.md` — description: The two declarative halves that define a custom node — its data schema and the form rendered in the property panel.*

A node is described by two declarative files. Together they define what the node stores and how it's edited:

| File          | Purpose                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `schema.ts`   | **Data layer.** A JSON Schema for the node's `properties` — types, validation rules. |
| `uischema.ts` | **Visual layer.** A JsonForms-shaped tree describing the form in the property panel. |

The two reference each other through `scope` strings — JsonPointer-style paths from the data schema's root, e.g. `'#/properties/url'`. `schema.ts` says **what** a property is; `uischema.ts` says **how** it renders.

#### Pages in this section

| Page                                          | What it covers                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Data schema](/node-schemas/data-schema/)     | Field types, validators, the SDK's `options` extension, `NodeDataProperties` inference. |
| [Form overview](/node-schemas/form-overview/) | The shape of `uischema.ts` and how its three element families fit together.             |
| [Form controls](/node-schemas/form-controls/) | Every built-in input control with required + optional props and an example.             |
| [Form layouts](/node-schemas/form-layouts/)   | Containers (`VerticalLayout`, `HorizontalLayout`, `Group`, `Accordion`) and labels.     |

#### Where to start

If you're authoring your first custom node, follow the [Add a custom node](/guides/add-a-custom-node/) recipe — it walks through `schema.ts`, `uischema.ts`, defaults, and palette registration end-to-end. Reach for the pages above when you need the type catalogue or the props for a specific control.

### Data schema

*Source: `node-schemas/data-schema.md` — description: The JSON-Schema half of a node — what its `schema.ts` declares, what types each property can take, and how validation runs at edit time.*

`schema.ts` is a [JSON Schema](https://json-schema.org/) describing the shape of a node's `properties` — the data half. For the visual half (how those properties render in the property panel), see [Form overview](/node-schemas/form-overview/).

The SDK's [`NodeSchema`](/api/types/nodeschema/) type narrows the standard JSON Schema vocabulary to the subset the editor understands, plus a handful of SDK-specific additions (notably `options` for select-style fields).

It drives three things at runtime:

1. **Validation** — values entered in the property panel are checked against this schema; failures surface as inline errors on the node and the affected field.
2. **Rendering** — JsonForms uses the schema (combined with the matching [`UISchema`](/node-schemas/form-overview/)) to know what each control should accept.
3. **Type inference** — `NodeDataProperties<typeof schema>` extracts a precise TypeScript type for the node's `properties`, so consumers of `NodeData` get autocomplete on their custom fields.

#### Anatomy

A minimal schema for a `Webhook` node:

```ts
import { type NodeSchema, sharedProperties } from '@workflowbuilder/sdk';

export const schema = {
  properties: {
    ...sharedProperties,
    url: { type: 'string', format: 'uri' },
    method: {
      type: 'string',
      options: [
        { label: 'GET', value: 'GET' },
        { label: 'POST', value: 'POST' },
      ],
    },
    retryOnFailure: { type: 'boolean' },
  },
  required: ['url', 'method'],
} satisfies NodeSchema;

export type WebhookNodeSchema = typeof schema;
```

The top level is always an object schema with a `properties` map. Each entry under `properties` describes one editable field. `required` enumerates which of those fields must have a non-empty value before the node validates clean.

`label` and `description` are reserved property names — every node must declare both, and the SDK treats them as the node's display title and subtitle in the diagram. [`sharedProperties`](/api/utilities/sharedproperties/) is the canonical way to spread them into your schema; alternatively, declare each one explicitly: `label: { type: 'string' }, description: { type: 'string' }`.

#### Field types

Five primitive shapes plus two composites cover everything the editor renders:

| `type`      | TypeScript | Typical control                   | Notes                                                         |
| ----------- | ---------- | --------------------------------- | ------------------------------------------------------------- |
| `'string'`  | `string`   | `Text`, `Select`, `DatePicker`    | Default for free-text input. Adds `format` for validation.    |
| `'number'`  | `number`   | (custom)                          | Use `minimum` / `maximum` for bounds.                         |
| `'boolean'` | `boolean`  | `Switch`                          | Two-state on/off.                                             |
| `'array'`   | `T[]`      | `DynamicConditions`, `AiTools`, … | `items` describes one element shape (always an object).       |
| `'object'`  | `{ ... }`  | (nested layout)                   | Group of nested fields; renders flat in the panel by default. |

Date/time fields are `type: 'string'` paired with a `DatePicker` control — the editor stores the value as an ISO string and the control parses it.

#### Adding options to string fields

The SDK extends standard JSON Schema with an `options` array on string fields, used by `Select` and other choice controls:

```ts
status: {
  type: 'string',
  options: [
    { label: 'Active',   value: 'active'   },
    { label: 'Paused',   value: 'paused'   },
    { type: 'separator' },
    { label: 'Archived', value: 'archived' },
  ],
}
```

Each entry is either an `ItemOption` (`label` + `value`, optionally an `icon`) or a `{ type: 'separator' }` divider. The matching uischema element is `{ type: 'Select', scope: '#/properties/status' }`.

See the [`Option`](/api/types/option/) API reference for the exact shape.

#### Validation

Standard JSON-Schema validators apply, with the most-used ones being:

| Keyword                                 | What it checks                                      |
| --------------------------------------- | --------------------------------------------------- |
| `required`                              | Listed property names must have non-empty values.   |
| `minLength` / `maxLength`               | String length bounds.                               |
| `pattern`                               | String matches a regex.                             |
| `format`                                | String shape — `'uri'`, `'email'`, `'date-time'`, … |
| `minimum` / `maximum`                   | Numeric bounds.                                     |
| `exclusiveMinimum` / `exclusiveMaximum` | Numeric bounds (strict).                            |
| `multipleOf`                            | Numeric value must be divisible by this number.     |

For "value must be one of a fixed list", reach for the SDK's `options` array on the field (see the section above) — it's what `Select` reads, surfaces in TypeScript inference, and is what most node schemas use. Plain JSON-Schema `enum` is not part of the statically-typed [`NodeSchema`](/api/types/nodeschema/) surface today.

Validation runs on every edit; failures populate `NodeData.properties.errors` and surface in the property panel via the per-field error indicator. Override or suppress that indicator with `errorIndicatorEnabled: false` on the matching uischema control.

For conditional shape changes (e.g. _if `method === 'POST'`, then `body` is required_), use the standard JSON Schema `if` / `then` / `else` keywords inside `allOf` — see [`NodeSchema`](/api/types/nodeschema/) for the supported subset.

#### Pairing with `uischema.ts`

`schema.ts` says **what** a property is; `uischema.ts` says **how** it renders. They reference each other through `scope` strings — JsonPointer-style paths from the schema root:

```ts
// schema.ts — declares `url` exists and is a URI string
{ properties: { url: { type: 'string', format: 'uri' } } }

// uischema.ts — declares `url` renders as a Text control
{ type: 'Text', scope: '#/properties/url', placeholder: 'https://...' }
```

Build the scope string from a typed dot-path with [`getScope`](/api/forms/getscope/) to get autocomplete and rename safety.

#### Reusable preset fragments

The SDK ships a handful of pre-built fragments you can drop into your schemas instead of redeclaring the same shape per node. They cover the fields the editor reads itself (`label`, `description`, `status`) plus the UISchema slots every node needs.

##### Schema-side

[`sharedProperties`](/api/utilities/sharedproperties/) — the canonical `label` + `description` pair. Spread it into every `NodeSchema['properties']` so your nodes pick up display title and subtitle without redeclaring them.

```ts
import { type NodeSchema, sharedProperties } from '@workflowbuilder/sdk';

export const schema = {
  properties: {
    ...sharedProperties,
    url: { type: 'string', format: 'uri' },
  },
} satisfies NodeSchema;
```

[`statusOptions`](/api/utilities/statusoptions/) — the three canonical statuses (`active` / `draft` / `disabled`) with matching status icons. Use it as the `options` array on a `status: { type: 'string' }` field.

```ts
import { sharedProperties, statusOptions } from '@workflowbuilder/sdk';

const schema = {
  properties: {
    ...sharedProperties,
    status: {
      type: 'string',
      options: Object.values(statusOptions),
    },
  },
} satisfies NodeSchema;
```

##### UISchema-side

[`generalInformation`](/api/utilities/generalinformation/) — pre-built `Accordion` rendering Title / Status / Description for the three fields above. Drop it as a top-level element inside your node's `uischema.elements`.

[`globalControls`](/api/utilities/globalcontrols/) — UISchema fragments rendered on every node regardless of type (today: the missing-previous-variable error slot used by the validation plugin). Spread the array into your node's top-level `elements` so the diagnostic surface stays consistent across node types.

```ts
import { generalInformation, globalControls } from '@workflowbuilder/sdk';

export const uischema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    generalInformation,
    ...globalControls,
    // … your node-specific controls
  ],
};
```

#### TypeScript inference

`NodeDataProperties<typeof schema>` (or `<MySchemaType>`) extracts a TypeScript type for the data shape — every primitive `type` is mapped to its corresponding TS primitive, and **every property is optional** (the editor accepts partial form-state during editing, so the inferred type matches that reality):

```ts
import type { NodeDataProperties } from '@workflowbuilder/sdk';

type WebhookProps = NodeDataProperties<WebhookNodeSchema>;
// {
//   label?: string;
//   description?: string;
//   url?: string;
//   method?: string;
//   retryOnFailure?: boolean;
// }
```

`required: ['url', 'method']` does _not_ narrow the inferred type — `required` is a runtime validator only, not a static-type signal. Likewise the `options` array does not narrow `method` to `'GET' | 'POST'`; the inferred type stays plain `string`. If you need a narrower type at the consumer side, declare it explicitly.

Use `NodeDataProperties` when consuming `NodeData` in plugin handlers, custom listeners, or derived selectors — TypeScript catches typos against the schema instead of at runtime.

#### See also

- [Add a custom node](/guides/add-a-custom-node/) — full walk-through using a `Webhook` example
- [Form overview](/node-schemas/form-overview/) — overview of the visual half
- [Form controls](/node-schemas/form-controls/) — every control type and its props
- [`NodeSchema`](/api/types/nodeschema/), [`NodeDataProperties`](/api/types/nodedataproperties/), [`Option`](/api/types/option/) — auto-generated type reference
- [JSON Schema specification](https://json-schema.org/) — the underlying standard

### Form overview

*Source: `node-schemas/form-overview.md` — description: How a node's uischema describes the form rendered in the property panel — controls, layouts, labels.*

A node's `uischema.ts` declares the **form** rendered in the property panel when that node is selected. It's a tree of elements; each element's `type` decides how its branch renders — a text input, a select, a switch, a horizontal row, an accordion, and so on. This page introduces the shape; the two reference pages below catalogue every built-in element type with its props and a copy-pasteable example.

Three element families:

| Family                                       | What it does                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [Controls](/node-schemas/form-controls/)     | Input fields bound to a property — `Text`, `Select`, `Switch`, `DynamicConditions`, …                |
| [Layouts](/node-schemas/form-layouts/)       | Containers that arrange child elements — `VerticalLayout`, `HorizontalLayout`, `Group`, `Accordion`. |
| [Labels](/node-schemas/form-layouts/#labels) | Text-only elements that don't bind to a property — `Label`, `RichText`.                              |

#### Quick example

```ts
import type { UISchema } from '@workflowbuilder/sdk';

export const uischema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: '#/properties/label' },
    { type: 'Select', scope: '#/properties/method' },
    {
      type: 'Accordion',
      label: 'Advanced',
      elements: [
        { type: 'Switch', scope: '#/properties/retryOnFailure' },
        { type: 'TextArea', scope: '#/properties/headers', minRows: 3 },
      ],
    },
  ],
};
```

The element's `scope` is a JsonPointer-style path into the matching `schema.ts` — use [`getScope`](/api/forms/getscope/) to build it from a typed dot-path instead of writing the string by hand.

#### Custom element types

Element types not on these pages (e.g. `'ColorPicker'`, your own) require a custom JsonForms renderer — see [Custom JsonForms control](/guides/custom-jsonforms-control/).

#### Conditional rendering

Every element accepts an optional `rule` field that shows / hides / enables / disables it based on other property values. The shape is the same as JsonForms's [rule object](https://jsonforms.io/docs/uischema/rules/) — see the conditional-fields walk-through in [Add a custom node](/guides/add-a-custom-node/#conditional-fields).

#### See also

- [Data schema](/node-schemas/data-schema/) — the JSON-Schema half: types, validation, options
- [Form controls](/node-schemas/form-controls/) — every built-in control type with its props and an example
- [Form layouts](/node-schemas/form-layouts/) — `VerticalLayout`, `HorizontalLayout`, `Group`, `Accordion`
- [Add a custom node](/guides/add-a-custom-node/) — full walk-through of authoring `schema.ts` + `uischema.ts`
- [`UISchema`](/api/types/uischema/), [`getScope`](/api/forms/getscope/) — auto-generated type reference

### Form controls

*Source: `node-schemas/form-controls.md` — description: Every built-in control element accepted by a node's uischema, with props and an example for each.*

Controls are leaf elements that bind to a property in a node's `schema.ts` via `scope`. The control type decides how the editor renders that property in the property panel — text input, select, switch, date picker, and so on.

Every control accepts:

| Prop                    | Type           | Required | Notes                                                                                                                                                                             |
| ----------------------- | -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                  | string literal | yes      | One of the values listed below.                                                                                                                                                   |
| `scope`                 | string         | yes      | JsonPointer-style path into `schema.ts`. Use [`getScope`](/api/forms/getscope/) to build it from a typed dot-path.                                                                |
| `rule`                  | object         | no       | Conditional show/hide/enable/disable. JsonForms [rule shape](https://jsonforms.io/docs/uischema/rules/). See [Conditional fields](/guides/add-a-custom-node/#conditional-fields). |
| `errorIndicatorEnabled` | boolean        | no       | Default `true`. Set to `false` to suppress the per-field error icon.                                                                                                              |

Type-specific props are listed under each control below.

#### `Text`

Single-line text input, bound to a `string` property.

| Prop          | Type   | Required | Notes                                                                          |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `inputType`   | string | no       | HTML input type (e.g. `'email'`, `'url'`, `'password'`). Defaults to `'text'`. |
| `placeholder` | string | no       | Empty-state hint.                                                              |

```ts
{ type: 'Text', scope: '#/properties/label', placeholder: 'Node title' }
```

#### `TextArea`

Multi-line text input, bound to a `string` property.

| Prop          | Type   | Required | Notes                                       |
| ------------- | ------ | -------- | ------------------------------------------- |
| `placeholder` | string | no       | Empty-state hint.                           |
| `minRows`     | number | no       | Minimum visible rows before scroll appears. |

```ts
{ type: 'TextArea', scope: '#/properties/description', minRows: 3 }
```

#### `Switch`

On/off toggle, bound to a `boolean` property.

```ts
{ type: 'Switch', scope: '#/properties/retryOnFailure' }
```

#### `Select`

Dropdown picker, bound to a `string` property. Options come from the property's `options` array in `schema.ts`:

```ts
// schema.ts
{
  method: {
    type: 'string',
    options: [
      { label: 'GET', value: 'GET' },
      { label: 'POST', value: 'POST' },
    ],
  },
}
```

```ts
// uischema.ts
{ type: 'Select', scope: '#/properties/method' }
```

#### `DatePicker`

Calendar picker, bound to a date property. The schema field is declared as `type: 'string'` and serialised as an ISO 8601 string at the JSON layer, but the renderer receives — and the `handleChange` callback emits — a JavaScript `Date` object.

```ts
{ type: 'DatePicker', scope: '#/properties/scheduledFor' }
```

#### `DynamicConditions`

Composer for an array of comparison rows — used in nodes that branch on upstream values. Each row is a [`DynamicCondition`](/api/forms/dynamiccondition/) with two operands, a [`ComparisonOperator`](/api/forms/comparisonoperator/), and a logical join (`'AND'` / `'OR'`).

The `x` and `y` operands accept literal strings or `{{nodes.<id>.<output>}}` placeholders that resolve against upstream node outputs at runtime.

```ts
// schema.ts
{
  conditions: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        x: { type: 'string' },
        y: { type: 'string' },
        comparisonOperator: { type: 'string' },
        logicalOperator: { type: 'string' },
      },
    },
  },
}
```

```ts
// uischema.ts
{ type: 'DynamicConditions', scope: '#/properties/conditions' }
```

#### `DecisionBranches`

Composer for an array of named branches — used by decision-style nodes. Each branch has its own label, source handle, and a list of [`DynamicCondition`](/api/forms/dynamiccondition/) rows. Renders one collapsible panel per branch with full add / remove / reorder UI.

```ts
{ type: 'DecisionBranches', scope: '#/properties/branches' }
```

#### `AiTools`

Repeater control for the `tools` array on AI-agent nodes — each row is `{ id, sourceHandle, tool, description, apiKey }`. Surface specific to the demo's AI-agent node; only relevant if you ship a similarly-shaped node type.

```ts
{ type: 'AiTools', scope: '#/properties/tools' }
```

#### `VariableText`

Single-line text input that **also accepts `{{nodes.<id>.<output>}}` placeholders**. Renders an inline picker that suggests upstream node outputs as the user types `{{`. Bound to a `string` property.

| Prop          | Type   | Required | Notes             |
| ------------- | ------ | -------- | ----------------- |
| `placeholder` | string | no       | Empty-state hint. |

```ts
{ type: 'VariableText', scope: '#/properties/url', placeholder: 'https://...' }
```

#### `VariableTextArea`

Multi-line variant of `VariableText`. Same `{{...}}` placeholder behaviour.

| Prop          | Type   | Required | Notes                                       |
| ------------- | ------ | -------- | ------------------------------------------- |
| `placeholder` | string | no       | Empty-state hint.                           |
| `minRows`     | number | no       | Minimum visible rows before scroll appears. |

```ts
{ type: 'VariableTextArea', scope: '#/properties/messageBody', minRows: 4 }
```

#### `MessageOnError`

Inline message that surfaces when a node-level validation error matches the `scope`. Renders nothing if there's no error on that property — useful for context-specific guidance ("This input requires an upstream variable") next to the affected field.

| Prop   | Type   | Required | Notes                                                                                                 |
| ------ | ------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `text` | string | no       | Override the auto-derived error text. If omitted, the message comes from the validation error itself. |

```ts
{
  type: 'MessageOnError',
  scope: '#/properties/missingPreviousVariable',
  text: 'This field needs a variable from an upstream node.',
}
```

#### See also

- [Form overview](/node-schemas/form-overview/) — overview that pairs the UI layer with the data-schema layer
- [Form layouts](/node-schemas/form-layouts/) — containers that group these controls into a layout
- [Add a custom node](/guides/add-a-custom-node/) — full walk-through of authoring `schema.ts` + `uischema.ts`
- [Custom JsonForms control](/guides/custom-jsonforms-control/) — how to add element types not on this page
- [`UISchema`](/api/types/uischema/), [`getScope`](/api/forms/getscope/) — auto-generated type reference

### Form layouts

*Source: `node-schemas/form-layouts.md` — description: Container element types that arrange child elements — VerticalLayout, HorizontalLayout, Group, Accordion. Plus the two text-only label types.*

Layouts are container elements that group child elements into a visual structure. Unlike [controls](/node-schemas/form-controls/), they don't bind to a property — they just arrange other elements.

Every layout accepts:

| Prop       | Type           | Required | Notes                                                                                                                                                                                     |
| ---------- | -------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`     | string literal | yes      | One of `'VerticalLayout'`, `'HorizontalLayout'`, `'Group'`, `'Accordion'`.                                                                                                                |
| `elements` | `UISchema[]`   | yes      | Child elements rendered inside this container. Can be controls, other layouts, or labels. (`UISchema` is the alias re-exported from the barrel; internally `UISchema = UISchemaElement`.) |
| `rule`     | object         | no       | Conditional show/hide/enable/disable. JsonForms [rule shape](https://jsonforms.io/docs/uischema/rules/). See [Conditional fields](/guides/add-a-custom-node/#conditional-fields).         |

Type-specific props are listed under each layout below.

#### `VerticalLayout`

Stacks children top-to-bottom. The default container — most uischemas wrap their root in `VerticalLayout`.

```ts
{
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: '#/properties/label' },
    { type: 'Text', scope: '#/properties/url' },
    { type: 'Switch', scope: '#/properties/retryOnFailure' },
  ],
}
```

#### `HorizontalLayout`

Arranges children left-to-right in a CSS grid row.

| Prop            | Type   | Required | Notes                                                                                                                                                                                        |
| --------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layoutColumns` | string | no       | CSS `grid-auto-columns` value — controls each child's width. Examples: `'1fr 2fr'` (first child half the width of the second), `'100px 1fr'`, `'auto'` (default — children size themselves). |

```ts
{
  type: 'HorizontalLayout',
  layoutColumns: '1fr 1fr',
  elements: [
    { type: 'Text', scope: '#/properties/firstName' },
    { type: 'Text', scope: '#/properties/lastName' },
  ],
}
```

#### `Group`

Rendered as a labeled section with a header and a border around its children. Use it to visually group related fields.

| Prop    | Type   | Required | Notes                            |
| ------- | ------ | -------- | -------------------------------- |
| `label` | string | yes      | Section header shown at the top. |

```ts
{
  type: 'Group',
  label: 'Authentication',
  elements: [
    { type: 'Text', scope: '#/properties/username' },
    { type: 'Text', scope: '#/properties/password', inputType: 'password' },
  ],
}
```

#### `Accordion`

Collapsible labeled section — header + chevron, body hidden by default. Useful for advanced or rarely-used fields that shouldn't crowd the default property panel view.

| Prop    | Type   | Required | Notes                                         |
| ------- | ------ | -------- | --------------------------------------------- |
| `label` | string | yes      | Header text shown next to the expand chevron. |

```ts
{
  type: 'Accordion',
  label: 'Advanced',
  elements: [
    { type: 'Switch', scope: '#/properties/debugMode' },
    { type: 'TextArea', scope: '#/properties/customHeaders', minRows: 3 },
  ],
}
```

#### Labels

Text-only elements that don't bind to a property. Use them when the property panel needs a heading, divider, or static guidance.

##### `Label`

Plain text label — uses the editor's default body styling.

| Prop       | Type     | Required | Notes                                                                                                  |
| ---------- | -------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `text`     | string   | yes      | The label text.                                                                                        |
| `required` | boolean  | no       | Append a `*` to indicate the following section contains required fields.                               |
| `size`     | ItemSize | no       | Visual size — `'small'`, `'medium'` (default), `'large'`. Type re-exported from `@workflowbuilder/ui`. |

```ts
{ type: 'Label', text: 'Connection details' }
```

##### `RichText`

Same as `Label`, but renders Markdown — bold, italics, inline links. Useful for short instructional copy that needs formatting.

| Prop       | Type     | Required | Notes                      |
| ---------- | -------- | -------- | -------------------------- |
| `text`     | string   | yes      | Markdown source.           |
| `required` | boolean  | no       | Same semantics as `Label`. |
| `size`     | ItemSize | no       | Same semantics as `Label`. |

```ts
{
  type: 'RichText',
  text: 'See the [authentication guide](https://example.com/auth) for setup steps.',
}
```

#### Combining layouts

Layouts nest freely — a typical uischema is a `VerticalLayout` at the root with `Accordion`s for advanced sections and `HorizontalLayout`s for paired fields:

```ts
{
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: '#/properties/label' },
    {
      type: 'HorizontalLayout',
      elements: [
        { type: 'Text', scope: '#/properties/firstName' },
        { type: 'Text', scope: '#/properties/lastName' },
      ],
    },
    {
      type: 'Accordion',
      label: 'Advanced',
      elements: [
        { type: 'Switch', scope: '#/properties/debugMode' },
        { type: 'TextArea', scope: '#/properties/customHeaders', minRows: 3 },
      ],
    },
  ],
}
```

#### See also

- [Form overview](/node-schemas/form-overview/) — overview that pairs the UI layer with the data-schema layer
- [Form controls](/node-schemas/form-controls/) — input fields placed inside these layouts
- [Add a custom node](/guides/add-a-custom-node/) — full walk-through of authoring `schema.ts` + `uischema.ts`
- [`UISchema`](/api/types/uischema/) — auto-generated type reference

---

## 5. Built-in nodes

The directory holds **7 node pages plus an overview index** — Trigger, Action, Conditional, Decision, Delay, Notification, AI Agent. There is no eighth node page. Each node page also renders a **Schemas** tab pair (UI Schema / Data Schema) built at docs-build time from `apps/demo/src/app/data/nodes/<node>/{schema,uischema}.ts` via the `NodeDocumentation` component; that JSON is demo-app source, not page content, and is not reproduced here.

### Built-in Nodes Overview

*Source: `nodes/index.mdx` — description: Production-ready node types that ship with Workflow Builder, covering triggers, actions, branching, delays, notifications, and AI agents.*

Workflow Builder ships with several production-ready node types that cover the most common workflow patterns. Each node comes with a full configuration UI, validation, and JSON serialization - ready to use as-is in your application.

| Node                            | Purpose                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| [Trigger](./trigger/)           | Starts a workflow in response to an event, schedule, or condition          |
| [Action](./action/)             | Executes a task such as sending email, calling an API, or running a script |
| [Conditional](./conditional/)   | Splits the workflow into two branches based on a true/false condition      |
| [Decision](./decision/)         | Routes the workflow to one of several named branches                       |
| [Delay](./delay/)               | Pauses the workflow for a fixed, dynamic, or conditional duration          |
| [Notification](./notification/) | Sends a notification through email, SMS, push, webhook, or Slack           |
| [AI Agent](./ai-agent/)         | Delegates a step to an AI model with tool access                           |

#### Fully customizable

Every built-in node is defined by a JSON Schema (what properties exist) and a UI Schema (how they render in the properties panel). You can modify the built-in nodes to fit your domain - rename fields, add new options, change icons - or create entirely new node types from scratch.

#### See also

- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties
- [Node library](/overview/features/node-library/) - browse, search, and drag nodes from the palette
- [Properties sidebar](/overview/features/properties-sidebar/) - schema-driven forms in the properties panel

### Trigger

*Source: `nodes/trigger.mdx` — description: Starts a workflow in response to an event, a schedule, a condition, or a system signal.*

> **⚠️ main only — `isStartNode` does not exist in `@workflowbuilder/sdk@2.3.0`.** This page refers to `isStartNode` in prose and/or inside a saved-diagram JSON payload — not as TypeScript typed against the SDK, so nothing here would fail to compile. But the field is absent from 2.3.0: `grep isStartNode dist/index.d.ts` returns nothing, and the editor built from 2.3.0 neither writes nor preserves it.

The Trigger node is the entry point of every workflow. It defines when and how a workflow starts. Every workflow needs exactly one start node, placed at the start of the diagram — the Trigger node ships marked as one through its `isStartNode` flag.
Any node type can take that role, so a run can begin somewhere else if your product calls for it; see [Add Custom Node Type](/guides/add-a-custom-node/) to mark your own.

#### When to use

Use a Trigger node to define the starting condition for any workflow. The trigger type determines what kicks off the execution.

Common examples:

- **Scheduled jobs** - run a report every morning, send a digest email every Friday, or archive records at the end of each month
- **Incoming events** - start a workflow when a form is submitted, a record changes, or an API call is received
- **Data conditions** - begin processing when a value crosses a threshold (e.g., "inventory below 10 units")
- **System signals** - react to internal platform events like a deployment completing or a health check failing

#### Trigger types

Select the trigger type from the **Trigger Type** dropdown. Each type reveals its own set of configuration fields.

##### Time-based Trigger

Starts the workflow on a schedule.

| Property  | Type        | Description                                                                                      |
| --------- | ----------- | ------------------------------------------------------------------------------------------------ |
| All Day   | Boolean     | Whether the trigger fires for the full day                                                       |
| Starts    | Date + Time | When the schedule begins                                                                         |
| Ends      | Date + Time | When the schedule ends                                                                           |
| Frequency | Dropdown    | None / Daily / Weekly / Monthly / Yearly / Custom. When All Day is off, Hourly is also available |

##### Event-based Trigger

Starts the workflow when an external event occurs.

| Property   | Type     | Options                                                  |
| ---------- | -------- | -------------------------------------------------------- |
| Event Type | Dropdown | Form Submission / Record Change / API Call / User Action |

##### Conditional Trigger

Starts the workflow when a data condition is met.

| Property | Type     | Description                     |
| -------- | -------- | ------------------------------- |
| Rule     | Dropdown | Comparison operator (see below) |
| Value    | Text     | Value to compare against        |

Available rules:

| Rule                        | Description                          |
| --------------------------- | ------------------------------------ |
| Is Equal To                 | Exact match                          |
| Is Not Equal To             | Does not match                       |
| Is Greater Than             | Numeric greater-than                 |
| Is Greater Than or Equal To | Numeric greater-than or equal        |
| Is Less Than                | Numeric less-than                    |
| Is Less Than or Equal To    | Numeric less-than or equal           |
| Contains                    | Value includes the substring         |
| Does Not Contain            | Value excludes the substring         |
| Matches Regex               | Value matches the regular expression |
| Does Not Match Regex        | Value does not match the expression  |
| Formula is True             | Expression evaluates to true         |
| Formula is False            | Expression evaluates to false        |

##### System Trigger

Starts the workflow in response to an internal system event.

| Property     | Type | Description                    |
| ------------ | ---- | ------------------------------ |
| System Value | Text | Identifier of the system event |

#### Properties

All trigger types share the following fields:

| Property    | Type     | Description                                  |
| ----------- | -------- | -------------------------------------------- |
| Label       | Text     | Display name shown on the node card          |
| Description | Text     | Short description of the node's purpose      |
| Status      | Dropdown | Active / Inactive / Draft (or as configured) |

#### Retry settings

Configure how the system handles trigger failures:

| Property       | Options                                    | Description                                 |
| -------------- | ------------------------------------------ | ------------------------------------------- |
| Retry Interval | Every 15 min / Every 20 min / Every 30 min | How long to wait before retrying            |
| Max Retries    | 5 / 10 / 15                                | Maximum number of retry attempts            |
| Timeout        | 30 min / 60 min / 90 min                   | How long before a trigger attempt times out |

#### See also

- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties
- [Flow Runner plugin](/plugins/flow-runner/) - turn a diagram into an executable flow function
- [Notification node](/nodes/notification/) - send a notification via email, SMS, push, webhook, or Slack
- [Delay node](/nodes/delay/) - pause a flow for a specified duration before continuing

### Action

*Source: `nodes/action.mdx` — description: Executes a task such as sending an email, creating a database record, or calling an external service.*

The Action node represents a concrete operation your backend executes. It is the most common node type in any workflow - every step that "does something" is modeled as an Action.

#### When to use

Use Action nodes wherever your workflow needs to perform work: sending an email to a customer, updating a record in your CRM, calling a third-party API, running a script, or generating a document. Most workflows consist primarily of Trigger nodes, Action nodes, and branching logic between them.

Action nodes are intentionally generic. The **Action Type** dropdown determines what kind of operation the node represents, and each type reveals its own configuration fields in the properties panel. Your backend interprets the selected type and properties to execute the actual operation.

#### Action types

Select the action type from the **Action Type** dropdown. Each type reveals a different set of configuration fields.

##### Send Email

Sends an email message.

| Property         | Type     | Description                             |
| ---------------- | -------- | --------------------------------------- |
| Address          | Text     | Recipient email address                 |
| Copy             | Text     | CC recipients                           |
| Subject          | Text     | Email subject line                      |
| Body             | Text     | Email body content                      |
| Priority         | Dropdown | Normal / Low / High                     |
| Retries          | Number   | Number of retry attempts on failure     |
| Retry on Failure | Boolean  | Whether to automatically retry on error |

##### Update Record

Updates an existing record in a data source.

| Property              | Type     | Description                                   |
| --------------------- | -------- | --------------------------------------------- |
| Data Source           | Dropdown | CRM System / Hubspot                          |
| Object Type           | Dropdown | Order / Lead                                  |
| Record ID             | Text     | Identifier of the record to update            |
| Fields to Update      | Text     | Field mapping expression                      |
| Condition for Updates | Text     | Condition that must be met before updating    |
| Include Data          | Boolean  | Whether to include full record data in output |

##### Make API Call

Calls an external HTTP endpoint.

| Property         | Type     | Description                             |
| ---------------- | -------- | --------------------------------------- |
| API URL          | Text     | Endpoint URL                            |
| HTTP Method      | Dropdown | GET / POST / PUT / DELETE               |
| Headers          | Text     | Request headers                         |
| Body             | Text     | Request body                            |
| Response Format  | Dropdown | JSON / XML / Plain Text                 |
| Store Response   | Dropdown | Variable name to store the response in  |
| Retry on Failure | Boolean  | Whether to automatically retry on error |

##### Create Record

Creates a new record in a data source.

| Property           | Type     | Description                                     |
| ------------------ | -------- | ----------------------------------------------- |
| Data Source        | Dropdown | CRM System / Hubspot                            |
| Object Type        | Dropdown | Order / Lead                                    |
| Fields to Populate | Text     | Field mapping expression                        |
| Assign             | Dropdown | Team or user to assign the record to            |
| Include Record     | Boolean  | Whether to include the created record in output |

##### Execute Script

Runs a script in the specified language.

| Property        | Type     | Description                                    |
| --------------- | -------- | ---------------------------------------------- |
| Script Language | Dropdown | JavaScript / Python                            |
| Script Editor   | Text     | The script source code                         |
| Script Storing  | Text     | Variable name to store the script result in    |
| Pass Workflow   | Boolean  | Whether to pass workflow context to the script |

##### Create New Document

Generates a document from a template.

| Property           | Type     | Description                                 |
| ------------------ | -------- | ------------------------------------------- |
| Template           | Dropdown | Invoice Template / Contract Template        |
| Fields to Populate | Text     | Data mapping for template variables         |
| Output Format      | Dropdown | PDF / DOCX                                  |
| Save Location      | Dropdown | Google Drive / Internal Storage             |
| Send Document      | Boolean  | Whether to send the document after creation |

#### Shared properties

All action types share the following fields:

| Property    | Type     | Description                             |
| ----------- | -------- | --------------------------------------- |
| Label       | Text     | Display name shown on the node card     |
| Description | Text     | Short description of the node's purpose |
| Status      | Dropdown | Active / Draft / Disabled               |

#### See also

- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties
- [Flow Runner plugin](/plugins/flow-runner/) - turn a diagram into an executable flow function
- [AI Agent node](/nodes/ai-agent/) - delegate a step to an AI model or agent

### Conditional

*Source: `nodes/conditional.mdx` — description: Branches the workflow based on a true/false condition - if/else logic.*

The Conditional node splits the workflow into exactly two branches based on a condition. One branch executes when the condition is true, the other when it is false.

#### When to use

Use a Conditional node whenever your workflow needs binary branching - a yes/no, true/false, pass/fail decision point.

Common examples:

- **Validation gates** - check if the input data meets requirements before processing (e.g., "Is the order total above the minimum?")
- **Feature flags** - route to different behavior based on a toggle (e.g., "Is the new billing system enabled?")
- **Error handling** - branch based on whether a previous step succeeded or failed
- **Eligibility checks** - determine if a user qualifies for a promotion, discount, or approval

If you need more than two branches (e.g., route to one of several departments based on a category), use a [Decision](/nodes/decision/) node instead.

#### Condition rules

The Conditional node evaluates an array of conditions. Each condition compares two values using a comparison operator. Multiple conditions can be chained with logical operators (AND / OR).

| Property            | Type     | Description                                     |
| ------------------- | -------- | ----------------------------------------------- |
| X                   | Text     | Left-hand value of the comparison               |
| Comparison Operator | Dropdown | How to compare X and Y                          |
| Y                   | Text     | Right-hand value of the comparison              |
| Logical Operator    | Dropdown | AND / OR - how to chain with the next condition |

#### Properties

| Property    | Type | Description                             |
| ----------- | ---- | --------------------------------------- |
| Label       | Text | Display name shown on the node card     |
| Description | Text | Short description of the node's purpose |

#### Conditional vs Decision

Both nodes handle branching, but they serve different purposes:

| Aspect   | Conditional                     | Decision                                  |
| -------- | ------------------------------- | ----------------------------------------- |
| Branches | Exactly 2 (true / false)        | Any number                                |
| Logic    | Evaluates a condition           | Matches a value against multiple branches |
| Best for | Yes/no checks, validation gates | Routing, categorization, multi-way splits |

#### See also

- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties
- [Properties sidebar](/overview/features/properties-sidebar/) - schema-driven forms in the properties panel
- [Validation plugin](/plugins/validation/) - detect broken references and missing edges
- [Flow Runner plugin](/plugins/flow-runner/) - turn a diagram into an executable flow function
- [Decision node](/nodes/decision/) - route a flow to one of several paths by value

### Decision

*Source: `nodes/decision.mdx` — description: Routes the workflow to one of several paths based on user input or a data value.*

The Decision node routes the workflow to one of multiple possible paths. Unlike the Conditional node which handles binary true/false logic, the Decision node supports any number of named branches, each with its own set of conditions.

#### When to use

Use a Decision node when your workflow needs to fan out into more than two paths based on a value or category.

Common examples:

- **Routing by department** - send a support ticket to Engineering, Sales, or Billing based on the ticket category
- **Priority handling** - apply different SLAs or escalation paths based on severity (Low / Medium / High / Critical)
- **Multi-region processing** - route orders to the correct fulfillment center based on the shipping country
- **Approval workflows** - direct a request to different approval chains depending on the request amount or type
- **Status-based branching** - take different actions based on a record's current state (New / In Progress / Completed / Failed)

If you only need two branches (yes/no), use a [Conditional](/nodes/conditional/) node instead - it is simpler and more explicit for binary logic.

#### Decision branches

Each branch is a named output with its own condition set. Branches are configured as an array in the properties panel. You can add as many branches as needed.

| Property   | Type  | Description                                            |
| ---------- | ----- | ------------------------------------------------------ |
| Label      | Text  | Name of the branch (shown as the edge label on canvas) |
| Conditions | Array | Set of conditions that activate this branch            |

Each condition within a branch follows the same structure as the [Conditional node](/nodes/conditional/):

| Property            | Type     | Description                                     |
| ------------------- | -------- | ----------------------------------------------- |
| X                   | Text     | Left-hand value of the comparison               |
| Comparison Operator | Dropdown | How to compare X and Y                          |
| Y                   | Text     | Right-hand value of the comparison              |
| Logical Operator    | Dropdown | AND / OR - how to chain with the next condition |

X and Y support referencing data from earlier nodes and the trigger payload — see [Use Variable Picker](/guides/use-variable-picker/). A plain `{{…}}` reference fails the run if the path is missing; use `{{x.y?}}` or `{{x.y | default:'…'}}` for branches that need to fire on an absent value — see [Missing values](/guides/use-variable-picker/#missing-values).

#### Properties

| Property    | Type     | Description                             |
| ----------- | -------- | --------------------------------------- |
| Label       | Text     | Display name shown on the node card     |
| Description | Text     | Short description of the node's purpose |
| Status      | Dropdown | Active / Draft / Disabled               |

#### Conditional vs Decision

Both nodes handle branching, but they serve different purposes:

| Aspect   | Conditional                     | Decision                                  |
| -------- | ------------------------------- | ----------------------------------------- |
| Branches | Exactly 2 (true / false)        | Any number                                |
| Logic    | Evaluates a condition           | Matches a value against multiple branches |
| Best for | Yes/no checks, validation gates | Routing, categorization, multi-way splits |

#### See also

- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties
- [Use Variable Picker](/guides/use-variable-picker/) - reference data from earlier nodes and the trigger payload inside conditions
- [Properties sidebar](/overview/features/properties-sidebar/) - schema-driven forms in the properties panel
- [Validation plugin](/plugins/validation/) - detect broken references and missing edges
- [Flow Runner plugin](/plugins/flow-runner/) - turn a diagram into an executable flow function
- [Conditional node](/nodes/conditional/) - branch a flow with true/false if/else logic

### Delay

*Source: `nodes/delay.mdx` — description: Pauses the workflow for a specified duration before continuing to the next step.*

The Delay node pauses workflow execution for a configured amount of time before proceeding to the next connected node. The pause duration can be fixed, computed dynamically, or based on a condition.

#### When to use

Use a Delay node whenever your workflow needs to wait before continuing. Delays are essential for building workflows that operate on real-world timelines rather than executing everything instantly.

Common examples:

- **Follow-up sequences** - wait 24 hours after a customer signs up before sending a welcome email, then wait 3 days before sending a feature highlight
- **Rate limiting** - pause between API calls to respect third-party rate limits
- **Cool-down periods** - enforce a waiting period between retries or repeated actions (e.g., wait 15 minutes before retrying a failed payment)
- **SLA timers** - wait until a deadline, then escalate if the task is still unresolved
- **Batch processing** - collect events over a time window, then process them together

#### Delay types

Select the delay type from the **Delay Type** dropdown. Each type reveals different configuration fields.

##### Fixed Delay

Pauses for a specific amount of time.

| Property     | Type     | Description            |
| ------------ | -------- | ---------------------- |
| Delay Amount | Number   | How long to wait       |
| Time Units   | Dropdown | None / Minutes / Hours |

##### Dynamic Delay

Computes the delay duration from an expression at runtime.

| Property      | Type     | Description                                                                 |
| ------------- | -------- | --------------------------------------------------------------------------- |
| Expression    | Text     | Expression that evaluates to a duration (e.g., `order.processing_time * 2`) |
| Max Wait Time | Dropdown | 2 hours / 4 hours / 8 hours / 12 hours / 24 hours                           |

##### Conditional Delay

Waits until a condition is met or a maximum wait time is reached.

| Property      | Type     | Description                                       |
| ------------- | -------- | ------------------------------------------------- |
| Max Wait Time | Dropdown | 2 hours / 4 hours / 8 hours / 12 hours / 24 hours |

##### Until Specific Date/Time

Pauses until a specific date and time.

| Property      | Type     | Description                                       |
| ------------- | -------- | ------------------------------------------------- |
| Max Wait Time | Dropdown | 2 hours / 4 hours / 8 hours / 12 hours / 24 hours |

#### Properties

All delay types share the following fields:

| Property    | Type     | Description                             |
| ----------- | -------- | --------------------------------------- |
| Label       | Text     | Display name shown on the node card     |
| Description | Text     | Short description of the node's purpose |
| Status      | Dropdown | Active / Draft / Disabled               |

#### See also

- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties
- [Flow Runner plugin](/plugins/flow-runner/) - turn a diagram into an executable flow function
- [Trigger node](/nodes/trigger/) - start a flow in response to an event or schedule

### Notification

*Source: `nodes/notification.mdx` — description: Sends a notification to a user or system through email, SMS, push, webhook, or Slack.*

The Notification node dispatches a notification through a configured channel. It is similar to the Action node but specialized for messaging - your backend interprets the notification type and delivers it through the appropriate service.

#### When to use

Use a Notification node when your workflow needs to inform a person or system about something that happened. While you could model notifications as Action nodes, having a dedicated node type makes workflows easier to read and makes the intent immediately clear on the canvas.

Common examples:

- **Transactional messages** - send order confirmations, shipping updates, or password reset emails
- **Alerts and escalations** - notify on-call engineers via Slack when a health check fails, send SMS alerts for critical incidents
- **Approval requests** - push a notification to a manager asking them to review and approve a request
- **Webhook callbacks** - POST a payload to an external system when a workflow step completes
- **Multi-channel notifications** - send the same message via email and push notification for redundancy

#### Notification types

Select the notification type from the **Notification Type** dropdown. Each type configures a different delivery channel.

| Type              | Icon             | Description                                |
| ----------------- | ---------------- | ------------------------------------------ |
| Email             | EnvelopeSimple   | Send an email message                      |
| SMS               | ChatTeardropDots | Send a text message                        |
| Push Notification | Bell             | Send a mobile or browser push notification |
| Webhook           | WebhooksLogo     | POST a payload to an external URL          |
| Slack Message     | SlackLogo        | Send a message to a Slack channel          |

##### Email properties

When **Email** is selected, the following fields are available:

| Property         | Type     | Description                             |
| ---------------- | -------- | --------------------------------------- |
| Address          | Text     | Recipient email address                 |
| Copy             | Text     | CC recipients                           |
| Subject          | Text     | Email subject line                      |
| Body             | Text     | Email body content                      |
| Priority         | Dropdown | Normal / Low / High                     |
| Retries          | Number   | Number of retry attempts on failure     |
| Retry on Failure | Boolean  | Whether to automatically retry on error |

#### Properties

All notification types share the following fields:

| Property    | Type     | Description                             |
| ----------- | -------- | --------------------------------------- |
| Label       | Text     | Display name shown on the node card     |
| Description | Text     | Short description of the node's purpose |
| Status      | Dropdown | Active / Draft / Disabled               |

#### See also

- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties
- [Flow Runner plugin](/plugins/flow-runner/) - turn a diagram into an executable flow function
- [Trigger node](/nodes/trigger/) - start a flow in response to an event or schedule

### AI Agent

*Source: `nodes/ai-agent.mdx` — description: Delegates a step in the workflow to an AI model or agent with tool access.*

The AI Agent node represents a workflow step handled by an AI model. The editor captures the agent's configuration - which model to use, what tools it can access, its system prompt, and memory settings. Your backend is responsible for invoking the actual AI service at runtime.

#### When to use

Use an AI Agent node when a workflow step requires language understanding, generation, or decision-making that cannot be expressed as simple rules or conditions.

Common examples:

- **Document processing** - extract structured data from unstructured text (invoices, contracts, support tickets)
- **Content generation** - draft emails, summaries, or reports based on workflow data
- **Classification and routing** - analyze incoming requests and route them to the right team or process
- **Tool-augmented agents** - let the AI call external tools (Gmail, Jira, Slack, Airtable) to gather information or take action as part of a larger workflow
- **Conversational steps** - generate context-aware responses in customer support or onboarding flows
- **Data enrichment** - look up and synthesize information from multiple sources before passing it downstream

The AI Agent node connects to other nodes like any other step. It receives input from upstream nodes and passes its output to downstream nodes. The difference is that the "logic" is delegated to an LLM rather than coded explicitly.

#### Chat model

Select the AI model that powers this agent step. The models listed below are the defaults shipped with Workflow Builder - they are illustrative examples. You can replace them with any model your backend supports by editing the node schema.

| Model             | Value             | Icon       |
| ----------------- | ----------------- | ---------- |
| GPT-5.4           | `gpt5.4`          | OpenAiLogo |
| Gemini 3.1 Pro    | `gemini3.1pro`    | GeminiLogo |
| Claude Sonnet 4.6 | `claudeSonnet4.6` | ClaudeLogo |

#### Tools

Tools give the AI agent access to external services. Each tool is a named integration the agent can invoke during its execution. Tools are configured as an array - you can add as many as needed. The presets below are examples bundled with the default configuration; you can define your own tools to match whatever services your backend integrates with.

| Property    | Type | Description                                         |
| ----------- | ---- | --------------------------------------------------- |
| Tool        | Text | Name of the tool                                    |
| Description | Text | What the tool does (passed to the model as context) |
| API Key     | Text | Authentication key for the tool's service           |

Available tool presets:

| Tool     | Icon               |
| -------- | ------------------ |
| Gmail    | GoogleLogo         |
| Excel    | MicrosoftExcelLogo |
| Airtable | AirtableLogo       |
| Jira     | JiraLogo           |
| Slack    | SlackLogo          |
| Hubspot  | HubspotLogo        |

#### Memory

Controls whether the agent retains context across invocations within the same workflow run.

| Option              | Description                                             |
| ------------------- | ------------------------------------------------------- |
| Window-based Memory | Retains a sliding window of recent conversation context |

#### System prompt

A free-text field for the system prompt that defines the agent's behavior, persona, and constraints. This is passed directly to the model at runtime.

This field supports referencing data from earlier nodes — see [Use Variable Picker](/guides/use-variable-picker/). A plain `{{…}}` reference fails the run if the path is missing; use `{{x.y?}}` or `{{x.y | default:'…'}}` for fields that may legitimately be absent — see [Missing values](/guides/use-variable-picker/#missing-values).

#### Properties

| Property    | Type     | Description                             |
| ----------- | -------- | --------------------------------------- |
| Label       | Text     | Display name shown on the node card     |
| Description | Text     | Short description of the node's purpose |
| Status      | Dropdown | Active / Draft / Disabled               |

#### See also

- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties
- [Use Variable Picker](/guides/use-variable-picker/) - reference data from earlier nodes inside the system prompt
- [Flow Runner plugin](/plugins/flow-runner/) - turn a diagram into an executable flow function
- [Action node](/nodes/action/) - execute a task like an email, DB write, or external call

---

## 6. Plugins

Ten pages: an overview index plus nine plugins. The tier comes from each page's frontmatter `sidebar.badge`; a page with no badge is Community.

| Plugin | Page | Tier (frontmatter badge) |
| --- | --- | --- |
| Undo / Redo | `plugins/undo-redo.mdx` | **Community** (no badge) |
| Copy & Paste | `plugins/copy-paste.mdx` | **Community** (no badge) |
| Avoid Nodes & Edges | `plugins/avoid-nodes-edges.mdx` | **Enterprise** |
| Auto Layout (ELK) | `plugins/elk-layout.mdx` | **Enterprise** |
| Reshapable Edges | `plugins/reshapable-edges.mdx` | **Enterprise** |
| Widgets | `plugins/widgets.mdx` | **Enterprise** |
| Flow Runner | `plugins/flow-runner.mdx` | **Enterprise** |
| Validation | `plugins/validation.mdx` | **Enterprise** |
| Download PDF | `plugins/download-pdf.mdx` | **Enterprise** |

### Plugins Overview

*Source: `plugins/index.mdx` — description: Optional plugins that extend Workflow Builder with auto-layout, edge routing, copy-paste, PDF export, flow execution, and more.*

Workflow Builder uses a plugin system to keep the core lightweight while offering powerful optional features. Each plugin can be enabled with a single import and removed without breaking anything. Only the plugins you use end up in the bundle.

| Plugin                                      | What it does                                                   |
| ------------------------------------------- | -------------------------------------------------------------- |
| [Undo / Redo](./undo-redo/)                 | Session history. Step backwards and forwards through edits     |
| [Copy & Paste](./copy-paste/)               | Cut, copy, and paste nodes and edges with keyboard shortcuts   |
| [Avoid Nodes & Edges](./avoid-nodes-edges/) | Automatic orthogonal edge routing around nodes (WASM + Worker) |
| [Auto Layout](./elk-layout/)                | One-click node arrangement powered by the ELK layout engine    |
| [Reshapable Edges](./reshapable-edges/)     | Drag handles on edges to manually adjust connection paths      |
| [Widgets](./widgets/)                       | Attach rich content blocks directly on node cards              |
| [Flow Runner](./flow-runner/)               | Reference implementation: parse and execute a workflow diagram |
| [Validation](./validation/)                 | Diagram-based validation for JSON forms.                       |
| [Download PDF](./download-pdf/)             | Export the current diagram as a PDF file                       |

#### What you can do with plugins

Plugins can hook into almost every part of the editor without touching core code:

- **Toolbar and app bar** - add buttons, controls, or status indicators
- **Diagram canvas** - register custom edge types, inject content inside nodes, wrap the React Flow container
- **Properties panel** - add tabs, sections, or controls to the node/edge properties sidebar
- **Node palette and templates** - extend the node library with new node types or pre-built workflow templates
- **Menu items** - add entries to the three-dot control menu
- **State tracking** - observe and react to diagram changes (e.g. for undo/redo or analytics)
- **Translations** - register i18n strings so plugins work in all supported languages

The plugin system is fully extensible. You can build your own plugins using the same API the built-in ones use.

#### See also

- [Architecture](/overview/architecture/) - tech stack, monorepo layout, plugin system, data model
- [Built-in Nodes](/nodes/) - all built-in node types

Some plugins require the Enterprise license. [Contact us](https://www.workflowbuilder.io/contact) to request a guided demo or discuss licensing.

### Undo / Redo

*Source: `plugins/undo-redo.mdx` — description: Local session history for the diagram. Undo and redo node-related actions using keyboard shortcuts or toolbar buttons.*

Users can step backwards and forwards through their editing actions without losing work.

<video autoplay loop muted playsinline>
  <source src={undoRedoWebm} type="video/webm" />
</video>

#### What it tracks

The history tracks node-related actions:

- Adding or removing nodes
- Moving nodes on the canvas
- Connecting or disconnecting nodes
- Editing node properties

Edge-only changes (moving edge labels) may not be included in the history depending on configuration.

#### Keyboard shortcuts

| Action | Windows / Linux | macOS         |
| ------ | --------------- | ------------- |
| Undo   | `Ctrl+Z`        | `Cmd+Z`       |
| Redo   | `Ctrl+Shift+Z`  | `Cmd+Shift+Z` |

Toolbar buttons for undo and redo are also available in the app bar.

#### See also

- [Diagram state management](/overview/features/diagram-state-management/) - canvas state, undo/redo, and auto-save
- [Copy & Paste](/plugins/copy-paste/) - cut, copy, and paste nodes and edges

### Copy & Paste

*Source: `plugins/copy-paste.mdx` — description: Cut, copy, and paste nodes and edges on the canvas.*

Full support for node and edge cut, copy, and paste operations using standard keyboard shortcuts (`Ctrl+C`, `Ctrl+V`, `Ctrl+X`).

When you copy a group of nodes, connected edges between them are included automatically. Pasted nodes receive new unique IDs and are placed at the current mouse position, keeping the relative layout intact.

<video autoplay loop muted playsinline>
  <source src={copyPasteWebm} type="video/webm" />
</video>

#### Keyboard shortcuts

| Action | Windows / Linux | macOS   |
| ------ | --------------- | ------- |
| Copy   | `Ctrl+C`        | `Cmd+C` |
| Cut    | `Ctrl+X`        | `Cmd+X` |
| Paste  | `Ctrl+V`        | `Cmd+V` |

#### Use cases

- Duplicate a group of connected nodes to build a second parallel branch.
- Move a section of a workflow to a different area of the canvas via cut + paste.
- Copy nodes across browser tabs (clipboard is system-level).

#### See also

- [Diagram state management](/overview/features/diagram-state-management/) - canvas state, undo/redo, and auto-save
- [Undo / Redo](/plugins/undo-redo/) - local session history with keyboard shortcuts

### Avoid Nodes & Edges

*Source: `plugins/avoid-nodes-edges.mdx` — description: Orthogonal edge routing that automatically routes edges around nodes using Web Workers and WASM. — **badge: Enterprise***

> _[EnterpriseNote: this page is badged as an Enterprise-tier feature.]_

Edges never overlap nodes. The plugin recalculates routes in real time as nodes are moved or resized, using the **libavoid** C++ routing library compiled to WebAssembly and running in a Web Worker for smooth performance.

Edge-to-node and edge-to-edge spacing is configurable.

<video autoplay loop muted playsinline>
  <source src={avoidNodesWebm} type="video/webm" />
</video>

#### Use cases

- Diagrams with many crossing edges, where the router automatically finds clean, non-overlapping paths.
- Real-time collaborative editing where nodes move frequently and edges need to re-route on the fly.
- Dense workflows where manual edge routing would be impractical.

> _[OverflowCard: links to https://www.overflow.dev/premium?path=/docs/edges-and-ports-avoid-nodes-edges-documentation--docs]_

#### See also

- [Reshapable edges](/plugins/reshapable-edges/) - manually reshape orthogonal edges on the canvas
- [Auto Layout (ELK)](/plugins/elk-layout/) - automatic node arrangement with the ELK engine

### Auto Layout

*Source: `plugins/elk-layout.mdx` — description: Automatic node and edge arrangement powered by the ELK layout engine. — **badge: Enterprise***

> _[EnterpriseNote: this page is badged as an Enterprise-tier feature.]_

The plugin adds two toolbar buttons: **Auto Layout** to trigger a full recalculation, and **Direction Toggle** to switch between left-to-right and top-to-bottom arrangements. Layout also recalculates automatically when nodes are resized.

<video autoplay loop muted playsinline>
  <source src={autolayoutWebm} type="video/webm" />
</video>

#### Toolbar controls

| Button           | What it does                                                       |
| ---------------- | ------------------------------------------------------------------ |
| Auto Layout      | Recalculates positions for every node and edge                     |
| Direction Toggle | Switches between `RIGHT` (horizontal) and `DOWN` (vertical) layout |

The selected direction persists across page refreshes.

#### Use cases

- Automatically arrange a messy diagram after importing data or adding many nodes.
- Toggle between horizontal and vertical orientations to find the best layout for a given workflow.
- Keep the layout tidy after bulk node additions. Hit Auto Layout instead of manually dragging every node.

> _[OverflowCard: links to https://www.overflow.dev/premium?path=/docs/interaction-elk-layout--code-docs]_

#### See also

- [Reshapable edges](/plugins/reshapable-edges/) - manually reshape orthogonal edges on the canvas
- [Avoid Nodes & Edges](/plugins/avoid-nodes-edges/) - orthogonal edge routing that avoids nodes

### Reshapable Edges

*Source: `plugins/reshapable-edges.mdx` — description: Manually reshape orthogonal edges using drag handles on the canvas. — **badge: Enterprise***

> _[EnterpriseNote: this page is badged as an Enterprise-tier feature.]_

Select an edge to reveal interactive drag handles, then drag them to create custom routes. A **Reset Reshaping** button in the edge properties panel reverts any modified edge back to its default path.

<video autoplay loop muted playsinline>
  <source src={reshapableEdgesWebm} type="video/webm" />
</video>

#### Configuration

To change the handle colour, override `--wb-edge-reshape-handler-color` in your CSS.

#### Use cases

- Fine-tune edge routing when automatic layout doesn't produce the desired result.
- Create cleaner diagrams by manually separating edges that overlap.
- Adjust a single edge path without affecting the rest of the layout.

> _[OverflowCard: links to https://www.overflow.dev/premium?path=/docs/edges-and-ports-reshaping-orthogonal-edges--code-docs]_

#### See also

- [Avoid Nodes & Edges](/plugins/avoid-nodes-edges/) - orthogonal edge routing that avoids nodes
- [Auto Layout (ELK)](/plugins/elk-layout/) - automatic node arrangement with the ELK engine

### Widgets

*Source: `plugins/widgets.mdx` — description: Extend node cards with additional tabs and inline content visible directly on the canvas. — **badge: Enterprise***

> _[EnterpriseNote: this page is badged as an Enterprise-tier feature.]_

Each node can have multiple widgets that users can enable, disable, and reorder. Widgets are visible directly on the canvas without opening the properties panel.

<video autoplay loop muted playsinline>
  <source src={widgetsWebm} type="video/webm" />
</video>

#### Widget types

The plugin ships with two built-in widget types:

| Type    | Description                                        |
| ------- | -------------------------------------------------- |
| `text`  | Structured text blocks with a title and paragraphs |
| `other` | Generic content placeholder                        |

#### Use cases

- Add documentation notes directly on a node, visible at a glance without opening properties.
- Display computed or dynamic content inline on the canvas (extend with a custom widget type).
- Let non-technical users annotate workflow steps with rich text descriptions.

#### See also

- [Properties sidebar](/overview/features/properties-sidebar/) - schema-driven forms in the properties panel
- [Node library](/overview/features/node-library/) - browse, search, and drag nodes from the palette

### Flow Runner

*Source: `plugins/flow-runner.mdx` — description: Reference implementation of a JSON parser that turns a Workflow Builder diagram into an executable flow function. — **badge: Enterprise***

> _[EnterpriseNote: this page is badged as an Enterprise-tier feature.]_

The plugin includes play / pause / stop controls in the app bar, a visual debugger that highlights active and completed nodes, and a set of demo palette items (start, decision, display value, calculators) so you can [try it immediately](https://app.workflowbuilder.io).

<video autoplay loop muted playsinline>
  <source src={flowRunnerWebm} type="video/webm" />
</video>

#### Use cases

- Prototype backend logic visually. Build a decision tree in the editor, then run it to verify behaviour.
- Demonstrate Workflow Builder to prospects with a live, runnable flow. [Request a guided demo](https://www.workflowbuilder.io/contact) to see it end-to-end.
- Use as a starting point for a production execution engine by replacing the demo callable logic with real integrations.

#### See also

- [Architecture](/overview/architecture/) - tech stack, monorepo layout, plugin system, data model
- [Built-in Nodes](/nodes/) - all built-in node types
- [Add Custom Node Type](/guides/add-a-custom-node/) - register a new node type with custom properties

### Validation

*Source: `plugins/validation.mdx` — description: Additional logic for working with JSON forms, adding diagram-based validation for detecting broken references and missing edges. — **badge: Enterprise***

> _[EnterpriseNote: this page is badged as an Enterprise-tier feature.]_

This plugin adds diagram-based validation on top of `@jsonforms` validation using `additionalErrors` property (<a href="https://jsonforms.io/docs/validation#external-validation-errors" target="_blank" rel="nofollow">more</a>).

It detects structural errors in the diagram - for example, when a node references a variable computed in a previous node but the connection to that node has been removed, or when required edges are missing.

Because it builds on `@jsonforms`, diagram errors behave like standard form validation errors (such as empty required fields), giving a consistent validation experience across forms and the canvas.

#### Use cases

- Detect when a node uses variables from a previous node but is no longer connected to it.
- Flag missing required edges between nodes.
- Surface diagram-level errors alongside form-level validation in a unified way.

#### See also

- [Properties sidebar](/overview/features/properties-sidebar/) - schema-driven forms in the properties panel
- [Conditional node](/nodes/conditional/) - branching node that uses validation to verify references
- [Decision node](/nodes/decision/) - branching node with multi-way routing

### Download PDF

*Source: `plugins/download-pdf.mdx` — description: Export the current diagram as a PDF file. — **badge: Enterprise***

> _[EnterpriseNote: this page is badged as an Enterprise-tier feature.]_

Adds a **Save as PDF** option to the diagram's control menu (three-dot menu). One click opens an export dialog where users can download the current workflow as a PDF file. No configuration needed.

#### Use cases

- Share a workflow diagram with stakeholders who do not have access to the editor.
- Archive a snapshot of a workflow for documentation or compliance purposes.
- Print a large diagram across multiple pages for offline review.

> _[OverflowCard: links to https://www.overflow.dev/premium?path=/docs/misc-download-pdf-documentation--docs]_

---

## 7. UI Library

> **⚠️ main only — this whole section is unpublished and documents a different package.** Every `/docs/ui-library/*` URL returns HTTP 404 on the live site (measured 2026-09-09). It documents `@workflowbuilder/ui`, which is *not* `@workflowbuilder/sdk` and is not installed in this repo, so nothing here was verified against 2.3.0.

Not in the task's section list, but it is in the clone and in the sidebar, so it is included
for completeness. Each component page has a `## Props` and a `## CSS variables` heading whose
tables are generated at docs-build time (`apps/docs/scripts/generate-ui-api.mjs` runs TypeDoc
over `@workflowbuilder/ui` into `node_modules/.cache/ui-typedoc.json`). That JSON is not in the
repository and the section is not published, so **the prop tables and CSS-variable tables are
not documented anywhere reachable** — the prose and usage code below are the whole of what
exists in source.

### UI Library

*Source: `ui-library/overview.mdx` — description: The component library behind Workflow Builder.*

Workflow Builder's editor is rendered with **`@workflowbuilder/ui`**, the component
library that lives in this monorepo (`packages/ui`) and is published to npm. It is
built on the headless [Base UI](https://base-ui.com/) primitives and adds a styled,
themeable layer on top - the same building blocks the SDK uses for its own nodes,
panels, and controls.

Browse the [UI Components](/ui-library/ui-components/) and
[Diagram Components](/ui-library/diagram-components/) - each component has its own
page with a live example, props, and CSS variables.

#### Install

```sh
npm install @workflowbuilder/ui
```

`react` (18 or 19) and `react-dom` are the only peer dependencies - provide
your own. Everything else the components need, including `@base-ui/react`
(`^1.7.0`), is a regular dependency and installs automatically.

#### Styles

Importing a component from the package root injects that component's CSS
automatically, including the layer order (`@layer ui.base, ui.component`)
and typography classes - so the only thing left to add is the design
tokens:

```ts
// Design tokens (the `--ax-*` custom properties).
import '@workflowbuilder/ui/tokens.css';
```

```tsx
import { Button } from '@workflowbuilder/ui';
```

Need only one component's styles without the others? Import the per-component
subpath instead. That only injects the component's own CSS. Every built
stylesheet carries the cascade-layer order, so import order doesn't matter;
add the global stylesheet once if you also want the typography classes, plus
the tokens:

```ts
// Optional: global typography classes.
import '@workflowbuilder/ui/styles.css';
// Design tokens (the `--ax-*` custom properties).
import '@workflowbuilder/ui/tokens.css';
```

```tsx
import { DatePicker } from '@workflowbuilder/ui/date-picker';
```

#### Theming

Design tokens are keyed on `html[data-theme]`, so set it to `light` or `dark` to
switch themes (this is also how these docs theme the live examples):

```html
<html data-theme="light"></html>
```

Override any `--ax-*` token to retune colors, spacing, or radii without touching
component markup.

### Design tokens

*Source: `ui-library/design-tokens.mdx` — description: How @workflowbuilder/ui turns Figma design tokens into the --ax-* CSS custom properties that style every component.*

Every `@workflowbuilder/ui` component is styled with CSS custom properties
(`--ax-*`) rather than hard-coded values. Those properties are generated from a
single design-token source, so the visual language stays consistent and is
retunable without touching component code.

#### The pipeline

Tokens live in the private `@workflowbuilder/ui-tokens` package (`packages/tokens`)
and are compiled to CSS with [Style Dictionary](https://styledictionary.com/):

```
tokens.json            # Figma export: the design-token source of truth
   │  (style-dictionary, packages/tokens/src)
   ▼
primitives-mode-1.css  # raw scales (colors, etc.) on :root
numerals-mode-1.css    # numeric scales (spacing, radius, …) on :root
tokens-light.css       # semantic tokens, scoped to html[data-theme='light']
tokens-dark.css        # semantic tokens, scoped to html[data-theme='dark']
   │
   ▼
tokens.css             # the four above, bundled - this is what you import
```

`tokens.json` is exported from Figma and contains four token sets:
**Primitives/Mode 1**, **Numerals/Mode 1**, **Tokens/Light**, and **Tokens/Dark**.
Style Dictionary flattens each into kebab-cased CSS variables:

- **Primitives / Numerals** become `--ax-colors-*`, `--ax-primitive-*`, etc. on
  `:root` - the raw palette and scales.
- **Tokens/Light** and **Tokens/Dark** become the _semantic_ layer
  (`--ax-ui-bg-*`, `--ax-txt-*`, `--ax-button-*`, …), each scoped to
  `html[data-theme='light']` / `html[data-theme='dark']` so a single attribute
  switch reskins everything.

Components reference the semantic tokens, which in turn reference the primitives.

#### Using the tokens

Import the bundled stylesheet once and set a theme on `<html>`:

```ts
import '@workflowbuilder/ui/tokens.css';
```

```html
<html data-theme="light">
  <!-- or "dark" -->
</html>
```

#### Customizing

There are three override levels, from broadest to most local:

1. **Primitives** (`--ax-colors-*`, `--ax-primitive-*`) - retune the palette/scales globally.
2. **Semantic tokens** (`--ax-ui-*`, `--ax-txt-*`, `--ax-button-*`, …) - re-map meaning (e.g. make "primary" green).
3. **Component variables** (`--ax-public-*`) - tweak a single component; see each component's CSS variables table.

For the enterprise path you replace `tokens.json` with one generated from your
own Figma design kit and rebuild; the `--ax-*` surface stays the same.

#### Regenerating

The CSS is rebuilt from `tokens.json` whenever the package is built - on
`pnpm install` (via the package's `prepare` script) and as part of
`pnpm build:ui` / `pnpm build:lib`. To rebuild explicitly:

```sh
pnpm --filter @workflowbuilder/ui-tokens build
```

### UI Components Overview

*Source: `ui-library/ui-components/index.mdx` — description: General-purpose UI components from @workflowbuilder/ui.*

General-purpose interface components from `@workflowbuilder/ui`. Each page has a
live, interactive example plus the component's props and CSS variables.

- [Accordion](/ui-library/ui-components/accordion/) - Collapsible content section.
- [Avatar](/ui-library/ui-components/avatar/) - User avatar with image and sizes.
- [Button](/ui-library/ui-components/button/) - Action button with variants and sizes.
- [Checkbox](/ui-library/ui-components/checkbox/) - Checked, unchecked, and indeterminate states.
- [Collapsible](/ui-library/ui-components/collapsible/) - Expand and collapse a content section.
- [DatePicker](/ui-library/ui-components/date-picker/) - Date selection with a calendar popover.
- [Input](/ui-library/ui-components/input/) - Text input with adornments and an error state.
- [Menu](/ui-library/ui-components/menu/) - Popup menu for dropdowns.
- [Modal](/ui-library/ui-components/modal/) - Dialog overlay with a backdrop.
- [NavButton](/ui-library/ui-components/nav-button/) - Compact icon / label navigation button.
- [Radio](/ui-library/ui-components/radio/) - Radio button for a single choice.
- [SegmentPicker](/ui-library/ui-components/segment-picker/) - Segmented single-choice control.
- [Select](/ui-library/ui-components/select/) - Dropdown select.
- [Separator](/ui-library/ui-components/separator/) - Visual divider.
- [Snackbar](/ui-library/ui-components/snackbar/) - Transient status notification.
- [Status](/ui-library/ui-components/status/) - Validation status indicator.
- [Switch](/ui-library/ui-components/switch/) - Toggle between two states.
- [TextArea](/ui-library/ui-components/text-area/) - Multi-line text input.
- [Tooltip](/ui-library/ui-components/tooltip/) - Hover tooltip with variants.

### Accordion

*Source: `ui-library/ui-components/accordion.mdx` — description: An interactive section that toggles the visibility of its content.*

An `Accordion` lets users toggle the visibility of content. The content section
can be expanded to reveal details and collapsed to hide them, keeping
information organized and saving space. It is commonly used in FAQs, settings
panels, and documentation to present layered content efficiently.

> _[AccordionExample: live interactive component preview.]_

#### Usage

```tsx
import { Accordion } from '@workflowbuilder/ui';

function Example() {
  return (
    <Accordion label="What is @workflowbuilder/ui?" defaultOpen>
      Our component library, built on Base UI.
    </Accordion>
  );
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Avatar

*Source: `ui-library/ui-components/avatar.mdx` — description: Displays a user avatar at various sizes.*

An `Avatar` displays a user image inside a circular container at one of several
sizes. Provide a `username` for accessible alt text and an optional `imageUrl`
for the picture.

> _[AvatarExample: live interactive component preview.]_

#### Usage

```tsx
import { Avatar } from '@workflowbuilder/ui';

function Example() {
  return <Avatar username="Ada Lovelace" imageUrl="/ada.png" size="large" />;
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Button

*Source: `ui-library/ui-components/button.mdx` — description: A flexible, type-safe action button with variants and sizes.*

`Button` is a flexible, type-safe component that automatically selects the
correct type (label, icon, or icon + label) based on the structure of its
`children`. A single string renders a label button, a single React element
renders an icon button, and a string combined with icons renders an icon-label
button.

> _[ButtonExample: live interactive component preview.]_

#### Usage

```tsx
import { Button } from '@workflowbuilder/ui';

function Example() {
  return <Button variant="primary">Submit</Button>;
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Checkbox

*Source: `ui-library/ui-components/checkbox.mdx` — description: A control that supports checked, unchecked, and indeterminate states.*

A `Checkbox` is a customizable control that supports three states: checked,
unchecked, and indeterminate. It can be used in forms or as a standalone control.

> _[CheckboxExample: live interactive component preview.]_

#### Usage

```tsx
import { Checkbox } from '@workflowbuilder/ui';
import { useState } from 'react';

function Example() {
  const [checked, setChecked] = useState(false);
  return <Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)} />;
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Collapsible

*Source: `ui-library/ui-components/collapsible.mdx` — description: A compound component that expands and collapses a content section behind a toggle button.*

`Collapsible` toggles the visibility of a content section behind a rotating
chevron button. Unlike `Accordion`, it's a compound component: `Collapsible`
provides the expanded state, and you compose `Collapsible.Button` and
`Collapsible.Content` yourself inside it. This is the building block Workflow
Builder uses for the expand/collapse control on its node panels - see
[`NodePanel`](/ui-library/diagram-components/node-panel/) for that composition.

> _[CollapsibleExample: live interactive component preview.]_

#### Usage

```tsx
import { Collapsible } from '@workflowbuilder/ui';

function Example() {
  return (
    <Collapsible defaultExpanded>
      <Collapsible.Button />
      <Collapsible.Content>Additional details go here.</Collapsible.Content>
    </Collapsible>
  );
}
```

#### Parts

`Collapsible.Button` and `Collapsible.Content` read the expanded state from
context, so both must be rendered inside a `Collapsible`.

| Part                  | Props               | Description                                                                                      |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `Collapsible`         | see [Props](#props) | State provider. Controlled via `isExpanded` + `onToggle`, or uncontrolled via `defaultExpanded`. |
| `Collapsible.Button`  | none                | Toggle button rendered as a rotating chevron. Reads and flips the expanded state.                |
| `Collapsible.Content` | `children`          | Content wrapper. Animates its height between collapsed and expanded.                             |

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### DatePicker

*Source: `ui-library/ui-components/date-picker.mdx` — description: A calendar popover for selecting a single date, a range, or multiple dates.*

A `DatePicker` lets users pick a date from a calendar popover. It supports single
dates (the default), date ranges, and multiple-date selection, and renders the
selected value using `date-fns` format tokens.

> _[DatePickerExample: live interactive component preview.]_

#### Usage

```tsx
import { DatePicker } from '@workflowbuilder/ui';
import { useState } from 'react';

function Example() {
  const [date, setDate] = useState<Date | null>(null);
  return (
    <DatePicker
      value={date ?? undefined}
      placeholder="dd/mm/yyyy"
      valueFormat="dd-MM-yyyy"
      onChange={(next) => setDate((next as Date | null) ?? null)}
    />
  );
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Input

*Source: `ui-library/ui-components/input.mdx` — description: A single-line text field with optional adornments and an error state.*

An `Input` is a single-line text field for collecting short, free-form text. It
supports start and end adornments, an error state, and the standard input sizes.

> _[InputExample: live interactive component preview.]_

#### Usage

```tsx
import { Input } from '@workflowbuilder/ui';
import { useState } from 'react';

function Example() {
  const [value, setValue] = useState('');
  return <Input placeholder="Type something" value={value} onChange={(event) => setValue(event.target.value)} />;
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Menu

*Source: `ui-library/ui-components/menu.mdx` — description: A dropdown list of actions anchored to a trigger element.*

A `Menu` renders a dropdown list of actions anchored to a trigger element. Each
entry is a regular item or a separator, and items can be marked as destructive
for actions such as delete.

> _[MenuExample: live interactive component preview.]_

#### Usage

```tsx
import { Button, Menu } from '@workflowbuilder/ui';

function Example() {
  return (
    <Menu
      items={[
        { label: 'Edit', onClick: () => {} },
        { label: 'Duplicate', onClick: () => {} },
        { type: 'separator' },
        { label: 'Delete', destructive: true, onClick: () => {} },
      ]}
    >
      <Button variant="secondary">Open menu</Button>
    </Menu>
  );
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Modal

*Source: `ui-library/ui-components/modal.mdx` — description: A dialog that appears on top of the main content.*

A `Modal` is a dialog that appears on top of the main content. It has a header
with a title, optional subtitle and icon, a body, and an optional footer, and
fades in and out via the Base UI transition lifecycle.

> _[ModalExample: live interactive component preview.]_

#### Usage

```tsx
import { Button, Modal } from '@workflowbuilder/ui';
import { useState } from 'react';

function Example() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open modal
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Example modal"
        subtitle="Rendered live from @workflowbuilder/ui"
        footer={
          <Button variant="primary" onClick={() => setOpen(false)}>
            Got it
          </Button>
        }
      >
        Modal body content.
      </Modal>
    </>
  );
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Nav Button

*Source: `ui-library/ui-components/nav-button.mdx` — description: A compact, type-safe navigation button with a selected state.*

`NavButton` is a compact, type-safe navigation button. Like `Button`, it
automatically selects the correct type (label, icon, or icon + label) based on
the structure of its `children`, and it adds an `isSelected` state for marking
the active item.

> _[NavButtonExample: live interactive component preview.]_

#### Usage

```tsx
import { NavButton } from '@workflowbuilder/ui';

function Example() {
  return <NavButton isSelected>Overview</NavButton>;
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Radio

*Source: `ui-library/ui-components/radio.mdx` — description: A control for selecting a single option from a group.*

A `Radio` button lets users select a single option from a group. Radios that
share the same `name` form a group in which only one option can be selected.

> _[RadioExample: live interactive component preview.]_

#### Usage

```tsx
import { Radio } from '@workflowbuilder/ui';
import { useState } from 'react';

function Example() {
  const [value, setValue] = useState('daily');
  return <Radio name="cadence" value="daily" checked={value === 'daily'} onChange={() => setValue('daily')} />;
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### SegmentPicker

*Source: `ui-library/ui-components/segment-picker.mdx` — description: A segmented control for selecting a single option from a small set.*

A `SegmentPicker` is a segmented control that lets users select a single option
from a small, fixed set. Each option is declared with a `SegmentPicker.Item`,
and it can run in controlled (`value`) or uncontrolled (`defaultValue`) mode.

> _[SegmentPickerExample: live interactive component preview.]_

#### Usage

```tsx
import { SegmentPicker } from '@workflowbuilder/ui';
import { useState } from 'react';

function Example() {
  const [view, setView] = useState('list');
  return (
    <SegmentPicker value={view} onChange={(_event, next) => setView(next)}>
      <SegmentPicker.Item value="list">List</SegmentPicker.Item>
      <SegmentPicker.Item value="grid">Grid</SegmentPicker.Item>
      <SegmentPicker.Item value="board">Board</SegmentPicker.Item>
    </SegmentPicker>
  );
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Select

*Source: `ui-library/ui-components/select.mdx` — description: A dropdown for choosing a single option from a list.*

A `Select` lets users choose a single option from a dropdown list. Items are
passed as an array of `{ value, label }` objects, and separators can be mixed in
to group related options.

> _[SelectExample: live interactive component preview.]_

#### Usage

```tsx
import { Select, type SelectItem } from '@workflowbuilder/ui';
import { useState } from 'react';

const ITEMS: SelectItem[] = [
  { value: 'opus', label: 'Claude Opus' },
  { value: 'sonnet', label: 'Claude Sonnet' },
  { value: 'haiku', label: 'Claude Haiku' },
];

function Example() {
  const [model, setModel] = useState<string | number | null>('opus');
  return (
    <Select items={ITEMS} value={model} placeholder="Choose a model" onChange={(_event, next) => setModel(next)} />
  );
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Separator

*Source: `ui-library/ui-components/separator.mdx` — description: A horizontal line that divides content.*

A `Separator` is a visual element that creates a horizontal line to divide
content into distinct sections.

> _[SeparatorExample: live interactive component preview.]_

#### Usage

```tsx
import { Separator } from '@workflowbuilder/ui';

function Example() {
  return (
    <div>
      <span>Above</span>
      <Separator />
      <span>Below</span>
    </div>
  );
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Snackbar

*Source: `ui-library/ui-components/snackbar.mdx` — description: A brief inline message about an app process.*

A `Snackbar` displays a brief message about an app process. It comes in several
variants - success, error, warning, info and default - and can show a secondary
subtitle, an action button, and a close button.

The component is purely presentational: it renders inline where you place it,
with no positioning, stacking, or auto-dismiss of its own. For toast-style
behavior, mount it in your own portal/queue and drive dismissal from the
`onClose` callback.

> _[SnackbarExample: live interactive component preview.]_

#### Usage

```tsx
import { Snackbar } from '@workflowbuilder/ui';

function Example() {
  return <Snackbar variant="success" title="Saved" subtitle="Your changes were saved." close onClose={() => {}} />;
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Status

*Source: `ui-library/ui-components/status.mdx` — description: A small visual indicator for a validation status.*

A `Status` displays a small visual indicator based on a validation status. When
the status is `invalid` it renders a circular badge with an exclamation mark;
otherwise it renders nothing.

> _[StatusExample: live interactive component preview.]_

#### Usage

```tsx
import { Status } from '@workflowbuilder/ui';

function Example() {
  return <Status status="invalid" />;
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Switch

*Source: `ui-library/ui-components/switch.mdx` — description: A toggle between two states, such as on and off.*

A `Switch` lets users toggle between two states, such as on and off. It is
typically used for settings or preferences and gives immediate visual feedback.

> _[SwitchExample: live interactive component preview.]_

#### Usage

```tsx
import { Switch } from '@workflowbuilder/ui';
import { useState } from 'react';

function Example() {
  const [checked, setChecked] = useState(false);
  return <Switch checked={checked} onChange={(next) => setChecked(next)} />;
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

#### Icon switch

`IconSwitch` is a `Switch` variant that swaps a track icon and a thumb icon
based on the checked state, for representing on/off states with icons instead
of a bare thumb.

> _[IconSwitchExample: live interactive component preview.]_

##### Usage

```tsx
import { Moon, Sun } from '@phosphor-icons/react';
import { IconSwitch } from '@workflowbuilder/ui';
import { useState } from 'react';

function Example() {
  const [checked, setChecked] = useState(false);
  return <IconSwitch checked={checked} icon={<Sun />} IconChecked={<Moon />} onChange={(next) => setChecked(next)} />;
}
```

##### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

##### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### TextArea

*Source: `ui-library/ui-components/text-area.mdx` — description: A multi-line text field that grows to fit its content.*

A `TextArea` is a multi-line text field for longer, free-form input. It
auto-resizes to fit its content and supports row limits, an error state, and the
standard input sizes.

> _[TextAreaExample: live interactive component preview.]_

#### Usage

```tsx
import { TextArea } from '@workflowbuilder/ui';
import { useState } from 'react';

function Example() {
  const [value, setValue] = useState('');
  return <TextArea placeholder="Multi-line input" value={value} onChange={(event) => setValue(event.target.value)} />;
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Tooltip

*Source: `ui-library/ui-components/tooltip.mdx` — description: Informative text shown when users hover, focus, or tap an element.*

Tooltips display informative text when users hover over, focus on, or tap an
element. The component is compound: a `Tooltip` wraps a `TooltipTrigger` (the
anchor) and a `TooltipContent` (the popup), which supports a default and a blue
color variant.

> _[TooltipExample: live interactive component preview.]_

#### Usage

```tsx
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@workflowbuilder/ui';

function Example() {
  return (
    <Tooltip placement="top">
      <TooltipTrigger asChild>
        <Button variant="secondary">Hover for tooltip</Button>
      </TooltipTrigger>
      <TooltipContent tooltipType="default">Default tooltip</TooltipContent>
    </Tooltip>
  );
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### Diagram Components Overview

*Source: `ui-library/diagram-components/index.mdx` — description: Node and edge building blocks from @workflowbuilder/ui.*

The building blocks Workflow Builder uses to render nodes and edges on the canvas.
They are composed inside React Flow node and edge templates rather than used
standalone, so these pages focus on structure and usage.

- [NodePanel](/ui-library/diagram-components/node-panel/) - Node container with `Root`, `Header`, `Content`, and `Handles` slots.
- [Edge](/ui-library/diagram-components/edge/) - Edge label rendering with hover and selected states.
- [NodeAsPortWrapper](/ui-library/diagram-components/node-as-port-wrapper/) - Turns a whole node into a connection port.
- [NodeDescription](/ui-library/diagram-components/node-description/) - Textual content block inside a node.
- [NodeIcon](/ui-library/diagram-components/node-icon/) - Icon block inside a node.

### Edge

*Source: `ui-library/diagram-components/edge.mdx` — description: Edge label rendering and edge styling for the diagram canvas.*

The edge building blocks give diagram edges a consistent look. `EdgeLabel` is a
label primitive designed to sit on an edge, while the `useEdgeStyle` hook
computes the stroke styles for the edge path itself. Both follow the styling
conventions prepared for edges, so a custom edge type matches the built-in ones.

> _[EdgeExample: live interactive component preview.]_

`EdgeLabel` provides a unified label design for text, icons, or compound content.
Its state (hover, selection, disabled) is managed externally and reflected
through props. It extends a standard `HTMLDivElement` and, by default, uses
`position: absolute` so it can be placed at the `labelX` / `labelY` coordinates
that React Flow provides. Used outside a diagram context it may need extra
wrapper elements or layout adjustments because absolute positioning removes it
from normal document flow.

`useEdgeStyle` returns an object of CSS properties (`stroke`, `strokeWidth`,
`transition`) that you apply directly to the SVG path element representing an
edge. The package also exports the `EdgeState` and `EdgeLabelSize` types and the
`EDGE_LABEL_SIZES` constant.

#### Usage

`EdgeLabel` is rendered through xyflow's `<EdgeLabelRenderer>` and positioned with
a transform, while `useEdgeStyle` feeds the edge path. The example mirrors the
SDK's default labeled edge.

```tsx
import { EdgeLabel, type EdgeState, useEdgeStyle } from '@workflowbuilder/ui';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { useState } from 'react';

function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const state: EdgeState = selected ? 'selected' : 'default';

  const pathStyle = useEdgeStyle({ state, isHovered: hovered });

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={pathStyle} />
      {data?.label && (
        <EdgeLabelRenderer>
          <EdgeLabel
            isHovered={hovered}
            state={state}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {data.label}
          </EdgeLabel>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
```

#### EdgeLabel props

`EdgeLabel` also forwards any remaining `HTMLDivElement` attributes (e.g.
`style`, `onMouseEnter`, `data-*`).

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### useEdgeStyle

A hook that maps an edge's `state` and hover flag to the CSS properties for its
SVG path.

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

Returns `{ stroke, strokeWidth, transition }` ready to spread onto a path's
`style`.

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### NodeAsPortWrapper

*Source: `ui-library/diagram-components/node-as-port-wrapper.mdx` — description: Stretches a node's target handle to the whole node while a link is being dragged.*

`NodeAsPortWrapper` makes a whole node act as a connection drop target while a
link is being dragged, so the user doesn't have to aim at a small handle.
Mechanically it stretches the invisible hit area of the node's **existing
target handle** (`<Handle type="target" />` from `@xyflow/react`) to the
node's full size - the wrapped node must render such a handle, or the wrapper
does nothing. Connections still complete on the handle; only its hit area
grows.

It only applies while both `isConnecting` is `true` and the node is hovered,
so it stays inert during normal interaction. Pass the position the incoming
connection should attach to via `targetPortPosition`, and nudge the hit area
with the optional `offset`. The wrapper adds no visual highlight of its own -
it exposes the node's measured size and position as CSS variables (see below)
so an overlay can align with it.

#### Usage

In the SDK, the node container wraps its template in `NodeAsPortWrapper`, driven
by whether a connection is currently being dragged in the store. The template
renders the target `Handle` the wrapper relies on.

```tsx
import { NodeAsPortWrapper } from '@workflowbuilder/ui';
import type { NodeProps } from '@xyflow/react';

function NodeContainer({ id, data, selected }: NodeProps) {
  const isConnecting = useStore((store) => !!store.connectionBeingDragged);
  const targetPortPosition = getHandlePosition({ direction: layoutDirection, handleType: 'target' });

  return (
    <NodeAsPortWrapper isConnecting={isConnecting} targetPortPosition={targetPortPosition}>
      <WorkflowNodeTemplate id={id} data={data} selected={selected} /* ... */ />
    </NodeAsPortWrapper>
  );
}
```

#### Props

`NodeAsPortWrapper` also accepts `children` (the node to wrap).

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### NodeDescription

*Source: `ui-library/diagram-components/node-description.mdx` — description: Textual title and subtitle block inside a node.*

`NodeDescription` renders a node's textual content - a `label` shown as the title
and an optional `description` shown as the subtitle. It uses the library's
typography classes so the text matches the rest of the editor, and is typically
placed in a [`NodePanel.Header`](/ui-library/diagram-components/node-panel/)
alongside a [`NodeIcon`](/ui-library/diagram-components/node-icon/).

> _[NodeDescriptionExample: live interactive component preview.]_

#### Usage

```tsx
import { NodeDescription, NodeIcon, NodePanel } from '@workflowbuilder/ui';

function NodeHeader({ icon, label, description }) {
  return (
    <NodePanel.Header>
      <NodeIcon icon={icon} />
      <NodeDescription label={label} description={description} />
    </NodePanel.Header>
  );
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### NodeIcon

*Source: `ui-library/diagram-components/node-icon.mdx` — description: Icon block inside a node.*

`NodeIcon` renders an icon inside a styled container for use within a node. It
takes any `ReactNode` as its `icon` - typically an icon component - and wraps it
in the library's icon container styling. It is usually placed in a
[`NodePanel.Header`](/ui-library/diagram-components/node-panel/) next to a
[`NodeDescription`](/ui-library/diagram-components/node-description/).

> _[NodeIconExample: live interactive component preview.]_

#### Usage

```tsx
import { User } from '@phosphor-icons/react';
import { NodeDescription, NodeIcon, NodePanel } from '@workflowbuilder/ui';

function NodeHeader({ label, description }) {
  return (
    <NodePanel.Header>
      <NodeIcon icon={<User />} />
      <NodeDescription label={label} description={description} />
    </NodePanel.Header>
  );
}
```

#### Props

> _[PropsTable: Props table generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON (`scripts/generate-ui-api.mjs`). Not present in the repo and not published on the live site.]_

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

### NodePanel

*Source: `ui-library/diagram-components/node-panel.mdx` — description: Node container with Root, Header, Content, and Handles slots.*

`NodePanel` is the structural container Workflow Builder uses to render a node on
the canvas. It is a compound component: `NodePanel.Root` orchestrates the layout
and accepts up to one of each optional slot — `NodePanel.Header`,
`NodePanel.Content`, and `NodePanel.Handles`. Any other child triggers a runtime
warning, and each slot may appear at most once.

- `NodePanel.Root` - outer wrapper. Takes a `selected` boolean that drives the
  selected border / shadow, and arranges the header, handles, and content.
- `NodePanel.Header` - the node's header row, typically holding a
  [`NodeIcon`](/ui-library/diagram-components/node-icon/) and a
  [`NodeDescription`](/ui-library/diagram-components/node-description/).
- `NodePanel.Content` - the node's main body. Can be toggled with `isVisible`.
- `NodePanel.Handles` - container for React Flow connection `Handle`s. Supports
  `isVisible` and an `alignment` of `'center'` or `'header'`.

It composes naturally with the companion building blocks `NodeIcon`,
`NodeDescription`, and the
[`NodeAsPortWrapper`](/ui-library/diagram-components/node-as-port-wrapper/) that
turns the whole node into a drop target.

> _[NodePanelExample: live interactive component preview.]_

#### Usage

`NodePanel` is composed inside a React Flow node template. The example below
mirrors the SDK's default workflow node: an icon and description in the header,
collapsible content in the body, and source / target handles.

```tsx
import { Collapsible, NodeDescription, NodeIcon, NodePanel, Status } from '@workflowbuilder/ui';
import { Handle, Position } from '@xyflow/react';

function WorkflowNode({ id, icon, label, description, selected, isValid, showHandles = true, children }) {
  return (
    <Collapsible>
      <NodePanel.Root selected={selected}>
        <NodePanel.Header>
          <NodeIcon icon={icon} />
          <NodeDescription label={label} description={description} />
          {!!children && <Collapsible.Button />}
        </NodePanel.Header>

        <NodePanel.Content isVisible={showHandles}>
          <Status status={isValid === false ? 'invalid' : undefined} />
          <Collapsible.Content>{children}</Collapsible.Content>
        </NodePanel.Content>

        <NodePanel.Handles isVisible={showHandles} alignment="center">
          <Handle id={`${id}-target`} type="target" position={Position.Left} />
          <Handle id={`${id}-source`} type="source" position={Position.Right} />
        </NodePanel.Handles>
      </NodePanel.Root>
    </Collapsible>
  );
}
```

#### Parts

| Part                | Props                                                                                                 | Description                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `NodePanel.Root`    | `selected: boolean`, `className?`, `children?`                                                        | Outer wrapper. Lays out header + handles, then content; applies selected styling. |
| `NodePanel.Header`  | `className?`, `children?`                                                                             | Header row. At most one per `Root`.                                               |
| `NodePanel.Content` | `isVisible?` (default `true`), `className?`, `children?`                                              | Main body. Renders nothing when `isVisible` is `false`. At most one per `Root`.   |
| `NodePanel.Handles` | `isVisible?` (default `true`), `alignment?` (`'center' \| 'header'`, default `'center'`), `children?` | Container for connection handles. At most one per `Root`.                         |

#### CSS variables

> _[CssVariablesTable: CSS-variables table generated at docs-build time from the component's CSS module. Not present in the repo.]_

---

## 8. Full API reference

134 entries across 13 categories, transcribed from the live TypeDoc-generated pages
(`https://www.workflowbuilder.io/docs/api/<category>/<symbol>/`) and marked against the
installed 2.3.0. Category order follows the sidebar in `apps/docs/astro.config.mjs`, which
orders "by audience friendliness: highest-level concepts first (Core, Plugins, Components,
Hooks), runtime hooks next (Store, Listeners, Forms, Integration), reference material last
(Types, Utilities, Constants, i18n, Icons)."

**All 134 are ✅ in 2.3.0** — see §0.1 for how that was established. Two entries carry an
additional field-level caution and two carry a note about the component behind the props type.
No entry is marked ⚠️ or ❓.

**The completeness of this section is bounded by the live build, not by 2.3.0.** These are the
symbols the live site publishes; a symbol added on `main` since that build has no live page and
is therefore absent from this file entirely — it is not here and not marked missing. See §0.4.

The barrel that TypeDoc reads is `packages/sdk/src/index.ts`. TypeDoc runs in strict mode:
`excludeNotDocumented` hides any undocumented public symbol from the site and
`treatWarningsAsErrors` fails `pnpm build:docs` when one is found, so a public export with no
TSDoc comment is a build error rather than a silently missing page.

### 8.1 Core

#### WorkflowBuilder — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/core/workflowbuilder/`*

> `const` **WorkflowBuilder**: `Readonly`<{ `Canvas`: `MemoExoticComponent`<(`props`) => `Element`>; `DefaultLayout`: () => `Element`; `Palette`: () => `Element`; `PropertiesPanel`: () => `Element`; `Root`: (`__namedParameters`) => `Element`; `TopBar`: () => `Element`; }>

Workflow Builder compound component. Mount `<WorkflowBuilder.Root>` at the top of the editor subtree; compose with `.TopBar`, `.Palette`, `.Canvas`, `.PropertiesPanel`, or `.DefaultLayout` as children (or omit children to get the default floating-overlay layout).

```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

<WorkflowBuilder.Root nodeTypes={myNodeTypes} />
```

#### WorkflowBuilderIsValidConnection — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/core/workflowbuilderisvalidconnection/`*

> **WorkflowBuilderIsValidConnection** = (`params`) => `boolean`

Decides whether a dragged connection is allowed. Return `false` to block the drop (no edge created, no flicker). Fail-open: if an endpoint can’t be resolved to a node, the connection is allowed and this is not invoked.

##### Parameters

###### params

[`WorkflowBuilderIsValidConnectionParams`](/docs/api/core/workflowbuilderisvalidconnectionparams/)

##### Returns

`boolean`

#### WorkflowBuilderIsValidConnectionParams — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/core/workflowbuilderisvalidconnectionparams/`*

> **WorkflowBuilderIsValidConnectionParams** = `object`

Arguments for [WorkflowBuilderIsValidConnection](/docs/api/core/workflowbuilderisvalidconnection/). Source / target nodes are resolved from the connection’s ids, so a rule can branch on node `data`.

##### Properties

###### connection

> **connection**: `Connection`

The connection candidate (handle ids normalized to `null`).

---

###### sourceNode

> **sourceNode**: [`WorkflowBuilderNode`](/docs/api/types/workflowbuildernode/)

Node the connection is dragged from.

---

###### targetNode

> **targetNode**: [`WorkflowBuilderNode`](/docs/api/types/workflowbuildernode/)

Node the connection is dragged to.

#### WorkflowBuilderLogo — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/core/workflowbuilderlogo/`*

> **WorkflowBuilderLogo** = `string` | { `dark`: `string`; `light`: `string`; } | `ReactElement`

App-bar logo accepted by `<WorkflowBuilder.Root>`: an image URL, per-theme image URLs, or a custom element.

#### WorkflowBuilderReactFlowProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/core/workflowbuilderreactflowprops/`*

> **WorkflowBuilderReactFlowProps** = `Omit`<`ReactFlowProps`<[`WorkflowBuilderNode`](/docs/api/types/workflowbuildernode/), [`WorkflowBuilderEdge`](/docs/api/types/workflowbuilderedge/)>, `AssertAssignable`<`SdkOwnedReactFlowKey`, keyof `ReactFlowProps`<[`WorkflowBuilderNode`](/docs/api/types/workflowbuildernode/), [`WorkflowBuilderEdge`](/docs/api/types/workflowbuilderedge/)>>>

Escape hatch for the underlying ReactFlow canvas: forwards any ReactFlow prop except the ones the SDK owns (SdkOwnedReactFlowKey). Theme via the SDK design tokens, not `colorMode`.

Treat as static config: the canvas reads it out-of-band, so changing a value at runtime may not apply until the canvas re-renders.

#### WorkflowBuilderRoot — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/core/workflowbuilderroot/`*

> **WorkflowBuilderRoot**(`__namedParameters`): `Element`

Top-level component that wires up the Workflow Builder editor. Provides the per-instance store, integration wrapper, ReactFlow context, global overlay (snackbar, loader, plugin hooks), and renders either the supplied children or `<DefaultLayout />` as a fallback.

##### Parameters

###### __namedParameters

[`WorkflowBuilderRootProps`](/docs/api/core/workflowbuilderrootprops/)

##### Returns

`Element`

##### Examples

```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

export function App() {
  return <WorkflowBuilder.Root nodeTypes={myNodeTypes} />;
}
```

```tsx
<WorkflowBuilder.Root nodeTypes={myNodeTypes}>
  <header><WorkflowBuilder.TopBar /></header>
  <aside><WorkflowBuilder.Palette /></aside>
  <main><WorkflowBuilder.Canvas /></main>
  <aside><WorkflowBuilder.PropertiesPanel /></aside>
</WorkflowBuilder.Root>
```

#### WorkflowBuilderRootProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/core/workflowbuilderrootprops/`*

> **WorkflowBuilderRootProps** = `PropsWithChildren`<{ `diagramTemplates?`: [`TemplateModel`](/docs/api/types/templatemodel/)[]; `edgeTemplates?`: [`WorkflowBuilderEdgeTemplates`](/docs/api/components/workflowbuilderedgetemplates/); `initialEdges?`: [`WorkflowBuilderEdge`](/docs/api/types/workflowbuilderedge/)[]; `initialNodes?`: [`WorkflowBuilderNode`](/docs/api/types/workflowbuildernode/)[]; `integration?`: [`WorkflowBuilderIntegration`](/docs/api/integration/workflowbuilderintegration/); `isValidConnection?`: [`WorkflowBuilderIsValidConnection`](/docs/api/core/workflowbuilderisvalidconnection/); `jsonForm?`: [`WorkflowBuilderJsonFormConfig`](/docs/api/plugins/workflowbuilderjsonformconfig/); `layoutDirection?`: [`LayoutDirection`](/docs/api/types/layoutdirection/); `logo?`: [`WorkflowBuilderLogo`](/docs/api/core/workflowbuilderlogo/); `logoHref?`: `string`; `name?`: `string`; `nodeTemplates?`: [`WorkflowBuilderNodeTemplates`](/docs/api/components/workflowbuildernodetemplates/); `nodeTypes?`: [`PaletteItemOrGroup`](/docs/api/types/paletteitemorgroup/)[]; `plugins?`: [`WorkflowBuilderPlugin`](/docs/api/plugins/workflowbuilderplugin/)[]; `reactFlowProps?`: [`WorkflowBuilderReactFlowProps`](/docs/api/core/workflowbuilderreactflowprops/); }>

Props accepted by `<WorkflowBuilder.Root>`.

### 8.2 Plugins

#### ComponentDecoratorOptions — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/componentdecoratoroptions/`*

> **ComponentDecoratorOptions**<`Props`> = `DecoratorWithContent`<`Props`> | `DecoratorWithNoContent`<`Props`>

Options accepted by [registerComponentDecorator](/docs/api/plugins/registercomponentdecorator/). Two shapes:

- With `content` : mount a React component into a named slot — `'before'` , `'after'` , or as a `'wrapper'` around the host component.
- Without `content` : only `modifyProps` runs, transforming props passed to the host component without rendering extra UI.

`priority` controls the relative order when multiple plugins decorate the same slot (higher runs first; default `0`). `name` is used to deduplicate registrations — passing the same `name` twice replaces the earlier entry.

##### Type Parameters

###### Props

`Props` = `object`

#### FunctionDecoratorOptions — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/functiondecoratoroptions/`*

> **FunctionDecoratorOptions** = `DecoratorOptionsBefore` | `DecoratorOptionsAfter`

Options accepted by [registerFunctionDecorator](/docs/api/plugins/registerfunctiondecorator/).

`place: 'before'` callbacks run before the wrapped function and may replace its arguments. `place: 'after'` callbacks run after the wrapped function and may replace its return value. `priority` controls relative order when multiple plugins decorate the same function (higher runs first; default `0`); `name` deduplicates registrations.

#### hasRegisteredComponentDecorator — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/hasregisteredcomponentdecorator/`*

> **hasRegisteredComponentDecorator**(`componentName`, `pluginName`): `boolean` | `undefined`

Test whether a plugin with the given `pluginName` is currently registered for the named slot. Useful in plugin code that conditionally registers dependent decorators.

##### Parameters

###### componentName

`string`

###### pluginName

`string`

##### Returns

`boolean` | `undefined`

#### JsonFormsCellExtension — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/jsonformscellextension/`*

> **JsonFormsCellExtension** = `JsonFormsCellRendererRegistryEntry`

Custom JsonForms cell renderer — like [JsonFormsRendererExtension](/docs/api/plugins/jsonformsrendererextension/) but for cell-level rendering inside table-style controls.

#### JsonFormsRendererExtension — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/jsonformsrendererextension/`*

> **JsonFormsRendererExtension** = `JsonFormsRendererRegistryEntry`

Custom JsonForms renderer entry — a `tester` predicate paired with the React component that renders matching schemas. Use it to plug a domain-specific control (e.g. a colour picker, code editor) into the property panel.

#### PluginTranslationResource — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/plugintranslationresource/`*

> **PluginTranslationResource** = `object`

i18next-shaped resource bundle accepted by [registerPluginTranslation](/docs/api/plugins/registerplugintranslation/). Every plugin’s strings live under `translation.plugins.<pluginName>` to namespace away from SDK keys.

##### Index Signature

[`lang`: `string`]: `object`

#### registerComponentDecorator — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/registercomponentdecorator/`*

> **registerComponentDecorator**<`P`>(`componentName`, `plugin`): `void`

Decorate a named slot — add UI before/after/around it or transform its props.

Slots are mount points the SDK exposes for plugins to inject custom UI without forking the editor. Common slots include `'OptionalAppBarControls'`, `'OptionalNodeContent'`, and others — see the [Build a plugin](/docs/guides/build-a-plugin/) guide for the authoritative list.

Safe to call more than once; pass `plugin.name` to deduplicate.

##### Type Parameters

###### P

`P`

##### Parameters

###### componentName

`string`

Slot identifier (e.g. `'OptionalAppBarControls'`).

###### plugin

[`ComponentDecoratorOptions`](/docs/api/plugins/componentdecoratoroptions/)<`P`>

Decorator configuration. See [ComponentDecoratorOptions](/docs/api/plugins/componentdecoratoroptions/).

##### Returns

`void`

##### Example

```ts
registerComponentDecorator('OptionalAppBarControls', {
  content: MyButton,
  place: 'after',
  name: 'analytics-button',
});
```

#### registerFunctionDecorator — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/registerfunctiondecorator/`*

> **registerFunctionDecorator**(`functionName`, `plugin`): `void`

Decorate a named SDK function — observe its calls or transform its arguments / return value without forking.

Common decoration targets: `'trackFutureChange'` (state-mutation tracking), diagram-listener emitters, save callbacks. See the [Build a plugin](/docs/guides/build-a-plugin/) guide for the authoritative list of decoratable functions.

Safe to call more than once; pass `plugin.name` to deduplicate.

##### Parameters

###### functionName

`string`

###### plugin

[`FunctionDecoratorOptions`](/docs/api/plugins/functiondecoratoroptions/)

##### Returns

`void`

##### Example

```ts
registerFunctionDecorator('trackFutureChange', {
  place: 'after',
  callback: ({ params }) => auditLog(params),
  name: 'audit-log',
});
```

#### registerPluginTranslation — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/registerplugintranslation/`*

> **registerPluginTranslation**(`pluginResourceToAdd`): `void`

Merge plugin translations into the SDK’s i18next instance.

Resources follow the i18next shape `{ [lang]: { translation: { plugins: {...} } } }` — every plugin’s strings live under the `plugins` namespace, scoped by plugin name to avoid key collisions.

Safe to call more than once and at any time relative to i18next init: each call also issues `i18n.addResourceBundle(...)` so newly registered strings surface live, even when the plugin registers after the SDK has already initialised i18next.

##### Parameters

###### pluginResourceToAdd

`Resource`

##### Returns

`void`

##### Example

```ts
registerPluginTranslation({
  en: { translation: { plugins: { myPlugin: { hello: 'Hello' } } } },
  pl: { translation: { plugins: { myPlugin: { hello: 'Cześć' } } } },
});
```

#### WorkflowBuilderJsonFormConfig — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/workflowbuilderjsonformconfig/`*

> **WorkflowBuilderJsonFormConfig** = `object`

JsonForms extensions registered with the editor: custom renderers, cell renderers, and plugin translations.

#### WorkflowBuilderPlugin — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/plugins/workflowbuilderplugin/`*

> **WorkflowBuilderPlugin** = () => `void`

Plugin initializer — a synchronous function invoked exactly once on the first mount of `<WorkflowBuilder.Root>`. Inside the body call one of the SDK’s `register*` APIs:

- `registerComponentDecorator` — inject UI / hooks into a known slot
- `registerFunctionDecorator` — intercept a registered function before/after
- `registerPluginTranslation` — add i18next strings under `plugins.<name>`
- `registerCustomRenderers` / `registerCustomCells` — extend JsonForms

Plugins write into module-level registries; they do **not** see the per-Root store. The Root invokes them through a `useRef`-guarded first-render hook, so strict-mode double-render is a no-op and re-renders skip the work.

##### Returns

`void`

##### Example

```ts
const myPlugin: WorkflowBuilderPlugin = () => {
  registerComponentDecorator('OptionalAppBarTools', {
    content: MyButton,
    name: 'my-plugin',
  });
};
```

### 8.3 Components

The `ProjectSelection` and `PropertiesBar` **components** are exported by `main`'s barrel but are `Excluded from this release type` in 2.3.0 — only their `…Props` types are public there. The live API reference documents only the props types, which is consistent with 2.3.0.

#### defineNodeTemplate — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/definenodetemplate/`*

> **defineNodeTemplate**<`P`>(`template`): `ComponentType`<[`WorkflowNodeTemplateProps`](/docs/api/components/workflownodetemplateprops/)>

Erases the per-schema `P` parameter from a typed node template so it can be stored in a NodeTemplatesMap without consumer-side casts.

The cast is safe in practice: SDK only mounts a template for a node whose palette schema produces `P`. The pair (palette item, template) carries the runtime guarantee; TypeScript cannot express that link, so we erase the parameter here in one well-documented spot.

##### Type Parameters

###### P

`P`

##### Parameters

###### template

`ComponentType`<[`WorkflowNodeTemplateProps`](/docs/api/components/workflownodetemplateprops/)<`P`>>

##### Returns

`ComponentType`<[`WorkflowNodeTemplateProps`](/docs/api/components/workflownodetemplateprops/)>

##### Example

```ts
type MultiPortProperties = NodeDataProperties<typeof multiPortSchema>;

export const MultiPortNodeTemplate = defineNodeTemplate<MultiPortProperties>(
  memo(({ data }: WorkflowNodeTemplateProps<MultiPortProperties>) => {
    const status = data?.properties.status ?? 'active';
    return <NodePanel.Root>…</NodePanel.Root>;
  }),
);
```

#### DiagramContainerProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/diagramcontainerprops/`*

> **DiagramContainerProps** = `object`

Props accepted by [DiagramContainer](/docs/api/components/workflowbuildercanvas/). Use this when typing a `registerComponentDecorator<DiagramContainerProps>('DiagramContainer', …)` call.

##### Properties

###### edgeTypes?

> `optional` **edgeTypes?**: `EdgeTypes`

Extra edge types forwarded to ReactFlow alongside the built-in `'labelEdge'` and any Root-level `edgeTemplates`. Merged last, so a key here intentionally overrides those (this is the direct-mount escape hatch, hence no collision warning); prefer `<WorkflowBuilder.Root edgeTemplates>` for app-wide edges.

#### EdgeLabel — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/edgelabel/`*

> **EdgeLabel**(`__namedParameters`): `Element`

Renders a label (text or icon) at fixed canvas coordinates, used by edge components to attach descriptive content along their path. Built on top of xyflow’s `<EdgeLabelRenderer>` and styled via overflow-ui’s `<EdgeLabel>` primitive so hover / selected states match the rest of the editor.

##### Parameters

###### __namedParameters

`EdgeLabelProps`

##### Returns

`Element`

#### EnhancedBaseEdge — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/enhancedbaseedge/`*

> **EnhancedBaseEdge**(`__namedParameters`): `Element`

Drop-in replacement for xyflow’s `<BaseEdge>` that paints a transparent thicker stroke underneath the visible path. The transparent overlay widens the edge’s hover / click target without altering its visual appearance — useful for thin edges that would otherwise be hard to grab.

Use it inside a custom edge component the same way you’d use `BaseEdge`.

##### Parameters

###### __namedParameters

`BaseEdgeProps`

##### Returns

`Element`

#### FormControlWithLabel — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/formcontrolwithlabel/`*

> **FormControlWithLabel**(`__namedParameters`): `Element`

Wraps an arbitrary form control (input, select, etc.) with a positioned `<Label>` and an optional `*` indicator for required fields. Used inside custom JsonForms renderers and properties-bar tabs to keep label + control spacing consistent with the rest of the editor’s form UI.

##### Parameters

###### __namedParameters

`PropsWithChildren`<`Props`>

##### Returns

`Element`

#### LabelEdge — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/labeledge/`*

> **LabelEdge**(`__namedParameters`): `Element`

Default edge component for the diagram. Renders a smooth-step path between two nodes, mounts an [EdgeLabel](/docs/api/components/edgelabel/) at the midpoint when `data.label` or `data.icon` is set, and degrades to a self-connecting loop when source and target are the same node.

Registered automatically as the `'labelEdge'` type — to use it in your own diagrams, set `edge.type = 'labelEdge'` and put a label / icon in `edge.data`.

##### Parameters

###### __namedParameters

`EdgeProps`<[`WorkflowBuilderEdge`](/docs/api/types/workflowbuilderedge/)>

##### Returns

`Element`

#### NodeSection — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/nodesection/`*

> **NodeSection**(`__namedParameters`): `Element`

Visually-grouped container used inside custom node bodies — renders a header label above its children with the editor’s section spacing and border tokens.

Reach for it when authoring a node template that needs to split its content into named sub-blocks (e.g. “Inputs”, “Settings”).

##### Parameters

###### __namedParameters

`Props`

##### Returns

`Element`

#### OptionalNodeContent — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/optionalnodecontent/`*

> `const` **OptionalNodeContent**: `MemoExoticComponent`<(`props`) => `Element`>

Plugin slot mounted inside every node body. By default renders its children unchanged; plugins can attach extra UI here via [registerComponentDecorator](/docs/api/plugins/registercomponentdecorator/) keyed `'OptionalNodeContent'`.

The slot receives `nodeId` so decorators can scope their content to specific nodes (e.g. show a status badge only on certain types).

#### ProjectSelectionProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/projectselectionprops/`*

> **Note.** The props type is ✅ in 2.3.0. The `ProjectSelection` **component** it names is not — `dist/index.d.ts:1208` reads `/* Excluded from this release type: ProjectSelection */`.

> **ProjectSelectionProps** = `object`

Props accepted by ProjectSelection. Use this when typing a `registerComponentDecorator<ProjectSelectionProps>('ProjectSelection', …)` call.

##### Properties

###### onDuplicateClick?

> `optional` **onDuplicateClick?**: () => `void`

Optional handler for the kebab menu’s “Duplicate to Drafts” item. The item is rendered only when this is provided — omit it and the item is absent.

###### Returns

`void`

#### PropertiesBarProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/propertiesbarprops/`*

> **Note.** The props type is ✅ in 2.3.0. The `PropertiesBar` **component** it names is not — `dist/index.d.ts:1225` reads `/* Excluded from this release type: PropertiesBar */`.

> **PropertiesBarProps** = `PropertiesBarBaseProps` & `object`

Props accepted by PropertiesBar.

Provide localized labels (`headerLabel`, `deleteNodeLabel`, `deleteEdgeLabel`), the active tab + change handler, the delete handler, and an optional `tabs` array for extra tabs alongside the default “Properties” tab.

##### Type Declaration

###### deleteEdgeLabel

> **deleteEdgeLabel**: `string`

###### deleteNodeLabel

> **deleteNodeLabel**: `string`

###### headerLabel

> **headerLabel**: `string`

###### onDeleteClick

> **onDeleteClick**: () => `void`

###### Returns

`void`

###### onMenuHeaderClick?

> `optional` **onMenuHeaderClick?**: () => `void`

###### Returns

`void`

###### onTabChange

> **onTabChange**: (`tab`) => `void`

###### Parameters

###### tab

`string`

###### Returns

`void`

###### tabs?

> `optional` **tabs?**: `PropertiesBarTab`[]

#### SelfConnectingEdge — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/selfconnectingedge/`*

> **SelfConnectingEdge**(`__namedParameters`): `Element`

Edge that loops above the source node when source and target are the same node (a “self-connecting” or “back-to-self” edge). Draws a rounded-corner path that arches over the node so the loop stays visible regardless of the node’s size.

Used internally by [LabelEdge](/docs/api/components/labeledge/); expose only when you author a custom edge type and want to reuse the same loop geometry.

##### Parameters

###### __namedParameters

`SelfConnectingEdgeProps`

##### Returns

`Element`

#### SyntaxHighlighterLazy — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/syntaxhighlighterlazy/`*

> **SyntaxHighlighterLazy**(`props`): `Element`

Code-editor input with syntax highlighting. Lazy-loads the heavy `ace-builds` chunk — until it arrives, falls back to a plain `<TextArea>` so the consumer never sees a blank tile during the load.

Use it inside custom JsonForms renderers when a property accepts code (JSON, JS expressions, etc.). Pass `mode` to pick the highlighter grammar (`'json'`, `'javascript'`, …) and `value` / `onChange` to wire it to your form state.

##### Parameters

###### props

`SyntaxHighlighterProps`

##### Returns

`Element`

#### WorkflowBuilderCanvas — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/workflowbuildercanvas/`*

> `const` **WorkflowBuilderCanvas**: `MemoExoticComponent`<(`props`) => `Element`>

Public canvas component. Mount directly via `<DiagramContainer />` / `<WorkflowBuilder.Canvas />` when assembling a custom layout, or decorate the slot through `registerComponentDecorator<DiagramContainerProps>('DiagramContainer', …)`.

#### WorkflowBuilderDefaultLayout — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/workflowbuilderdefaultlayout/`*

> **WorkflowBuilderDefaultLayout**(): `Element`

Default editor layout — floating overlay with top bar, left palette, right properties panel, and a full-screen canvas underneath. Rendered automatically by `<WorkflowBuilder.Root>` when no children are passed.

Mount it explicitly when you need to mix it with custom overlays:

```tsx
<WorkflowBuilder.Root>
  <WorkflowBuilder.DefaultLayout />
  <MyToast />
</WorkflowBuilder.Root>
```

##### Returns

`Element`

#### WorkflowBuilderEdgeTemplates — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/workflowbuilderedgetemplates/`*

> **WorkflowBuilderEdgeTemplates** = `Record`<`string`, `ComponentType`<`EdgeProps`<[`WorkflowBuilderEdge`](/docs/api/types/workflowbuilderedge/)>>>

Per-edge-type custom renderer registry. Keys are `edge.type` values; values are React components that take ReactFlow’s EdgeProps (typed for [WorkflowBuilderEdge](/docs/api/types/workflowbuilderedge/)) and replace the default edge renderer for matching edges.

Unlike node templates, edge templates need no adapter: the built-in edges already take `EdgeProps` directly, so a consumer component drops straight into ReactFlow’s edge-type map with no wrapping.

#### WorkflowBuilderNodeTemplates — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/workflowbuildernodetemplates/`*

> **WorkflowBuilderNodeTemplates** = `Record`<`string`, `ComponentType`<[`WorkflowNodeTemplateProps`](/docs/api/components/workflownodetemplateprops/)>>

Per-node-type custom template registry. Keys are `data.type` values from the palette; values are React components that take [WorkflowNodeTemplateProps](/docs/api/components/workflownodetemplateprops/) and replace the default node renderer for matching nodes.

#### WorkflowBuilderPalette — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/workflowbuilderpalette/`*

> **WorkflowBuilderPalette**(): `Element`

Left-side palette listing draggable node types and the template selector. Mount via `<WorkflowBuilder.Palette />` (or the named `<WorkflowBuilderPalette />` export) inside a custom layout; the default layout already includes it.

##### Returns

`Element`

#### WorkflowBuilderPropertiesPanel — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/workflowbuilderpropertiespanel/`*

> **WorkflowBuilderPropertiesPanel**(): `Element`

Right-side properties panel — renders the form for the currently selected node or edge, plus its tabs (properties, variables). Mount via `<WorkflowBuilder.PropertiesPanel />` (or the named `<WorkflowBuilderPropertiesPanel />` export) inside a custom layout; the default layout already includes it.

##### Returns

`Element`

#### WorkflowBuilderTopBar — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/workflowbuildertopbar/`*

> **WorkflowBuilderTopBar**(): `Element`

Top bar with toolbar, project selector, and integration controls. Mount via `<WorkflowBuilder.TopBar />` (or the named `<WorkflowBuilderTopBar />` export) inside a custom layout; the default layout already includes it.

##### Returns

`Element`

#### WorkflowNodeTemplateProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/components/workflownodetemplateprops/`*

> **WorkflowNodeTemplateProps**<`P`> = `object`

Props for the editor’s default workflow-node template. A custom node type wraps this template (or composes its parts) to render its body — see [Add a custom node](/docs/guides/add-a-custom-node/) for the full pattern.

`id`, `icon`, `label`, `description` define the header. `selected` / `isValid` drive visual state. `showHandles` toggles the connection dots; `layoutDirection` controls which sides those dots sit on. `children` are rendered inside a collapsible body section.

Generic over `P` so consumer templates can narrow `data.properties` to their schema’s shape without casts:

```ts
type MyProps = WorkflowNodeTemplateProps<NodeDataProperties<MySchema>>;
```

Defaults to the wide `BaseNodeProperties & Record<string, unknown>` so existing usages remain backward-compatible.

##### Type Parameters

###### P

`P` = `BaseNodeProperties` & `Record`<`string`, `unknown`>

### 8.4 Hooks

#### LayoutChangeOptions — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/hooks/layoutchangeoptions/`*

> **LayoutChangeOptions** = `object`

Optional side effects for a layout-direction _toggle_.

##### Properties

###### fitView?

> `optional` **fitView?**: `boolean`

Animate the view to fit all nodes after the change. Defaults to `false`.

---

###### flipPositions?

> `optional` **flipPositions?**: `boolean`

Also reflow node positions by swapping each node’s `x`/`y`, so the diagram visually re-lays-out along the new axis. Defaults to `false` (handles and edges re-orient, coordinates stay put). This is a naive mirror, not a layout algorithm: it ignores node dimensions, so non-square nodes shift relative to their neighbours. Pair it with `fitView` and treat it as a quick approximation, not production auto-layout.

#### useEffectChange — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/hooks/useeffectchange/`*

> **useEffectChange**(`callback`, `dependencies`): `void`

Like `useEffect`, but skips the **first** run — the callback fires only when one of the dependencies actually changes after the initial render.

Useful when you want to react to user-driven changes without firing on the initial mount (e.g. saving form edits to the server, but not the initial seeded values).

##### Parameters

###### callback

() => `void`

Effect to run on dependency changes (post-mount).

###### dependencies

`unknown`[]

Dependency array, identical semantics to `useEffect`.

##### Returns

`void`

#### useFitView — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/hooks/usefitview/`*

> **useFitView**(): () => `void`

Returns a callback that animates the diagram view to fit all nodes, accounting for the editor’s app bar / palette / property panel bounds.

Common triggers: after auto-layout, after loading a new diagram, after a “fit view” toolbar button click. Uses a single `requestAnimationFrame` so the call is safe to issue from a render path.

##### Returns

A `() => void` callback. Stable across renders unless the ReactFlow instance changes.

() => `void`

#### useKeyPress — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/hooks/usekeypress/`*

> **useKeyPress**(`keyCode`, `options?`): `boolean`

Tracks whether a given key (or key combo) is currently held down.

Defaults to firing only when the diagram canvas (body / `.react-flow__*`) has focus — text inputs are excluded so typing in a property field doesn’t accidentally trigger keyboard shortcuts. Pass `skipTarget: true` to listen globally and `withControlOrMeta: true` to require Ctrl / Cmd to also be down.

##### Parameters

###### keyCode

`KeyCode`

xyflow `KeyCode` (single key string or combo).

###### options?

`Options`

Optional `skipTarget` / `withControlOrMeta` flags.

##### Returns

`boolean`

`true` while the key is pressed; `false` otherwise.

#### useLabelEdgeHover — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/hooks/uselabeledgehover/`*

> **useLabelEdgeHover**(`__namedParameters`): `object`

Tracks hover state for a single edge across both its line and its label (which live in different React subtrees) and returns the resolved style

- handlers a custom edge component should bind.

Suppresses hover while another edge is mid-segment-drag so the visual doesn’t flicker. Reach for it when authoring a custom edge type that wants the same hover feel as the built-in [LabelEdge](/docs/api/components/labeledge/).

##### Parameters

###### __namedParameters

`UseLabelEdgeHoverParams`

##### Returns

`object`

###### hovered

> **hovered**: `boolean`

###### onMouseEnter

> **onMouseEnter**: () => `void` = `handleMouseEnter`

###### Returns

`void`

###### onMouseLeave

> **onMouseLeave**: () => `void` = `handleMouseLeave`

###### Returns

`void`

###### style

> **style**: `object`

###### style.stroke

> **stroke**: `string`

###### style.strokeWidth

> **strokeWidth**: `string`

###### style.transition

> **transition**: `string`

#### useSingleSelectedElement — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/hooks/usesingleselectedelement/`*

> **useSingleSelectedElement**(): `SingleSelectedElement` | `null`

Returns the currently-selected node + edge **only when exactly one element is selected**, and `null` otherwise (zero selection or multi-selection). Designed for the properties sidebar’s “edit one thing at a time” UI; the equality check tolerates stable references on `node.data` / `edge.data` so the hook doesn’t spam re-renders.

##### Returns

`SingleSelectedElement` | `null`

The selected element wrapped in `{ node, edge }` (each independently nullable), or `null` when selection isn’t a single item.

#### useWorkflowBuilderActions — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/hooks/useworkflowbuilderactions/`*

> **useWorkflowBuilderActions**(): [`WorkflowBuilderActions`](/docs/api/hooks/workflowbuilderactions/)

Returns a stable object of action callbacks: every command the built-in `<WorkflowBuilder.TopBar />` offers, plus programmatic layout-direction control. Use it from a custom header / toolbar when omitting the bar.

Must be called from a descendant of `<WorkflowBuilder.Root>`; `save` reads the active integration via React context.

##### Returns

[`WorkflowBuilderActions`](/docs/api/hooks/workflowbuilderactions/)

##### Example

```tsx
function MyToolbar() {
  const actions = useWorkflowBuilderActions();
  return <button onClick={actions.save}>Save</button>;
}

<WorkflowBuilder.Root>
  <MyToolbar />
  <WorkflowBuilder.Canvas />
</WorkflowBuilder.Root>
```

#### WorkflowBuilderActions — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/hooks/workflowbuilderactions/`*

> **WorkflowBuilderActions** = `object`

Imperative action surface for a custom layout that omits `<WorkflowBuilder.TopBar />`. Mirrors every command the built-in app bar exposes (`save`, modal openers, read-only and theme toggles) and adds programmatic layout-direction control, which the bar itself does not offer.

Stable across renders while the active integration and the mounted React Flow instance are stable (layout actions close over the fit-view callback, which is keyed on that instance).

##### Properties

###### openExport

> **openExport**: () => `void`

Open the export-diagram modal.

###### Returns

`void`

---

###### openImport

> **openImport**: () => `void`

Open the import-diagram modal.

###### Returns

`void`

---

###### openSettings

> **openSettings**: () => `void`

Open the built-in workflow settings modal.

###### Returns

`void`

---

###### save

> **save**: () => `Promise`<[`DidSaveStatus`](/docs/api/integration/didsavestatus/)>

Persist the current diagram through the active integration strategy.

###### Returns

`Promise`<[`DidSaveStatus`](/docs/api/integration/didsavestatus/)>

---

###### setLayoutDirection

> **setLayoutDirection**: (`direction`) => `void`

Set the diagram layout direction (`'RIGHT'` ↔ `'DOWN'`). Idempotent: setting the same direction twice is a no-op. Position reflow is only offered on [toggleLayoutDirection](/docs/api/hooks/workflowbuilderactions/#togglelayoutdirection), where it is unambiguous.

###### Parameters

###### direction

[`LayoutDirection`](/docs/api/types/layoutdirection/)

###### Returns

`void`

---

###### setReadOnly

> **setReadOnly**: (`value`) => `void`

Set read-only mode explicitly.

###### Parameters

###### value

`boolean`

###### Returns

`void`

---

###### setTheme

> **setTheme**: (`theme`) => `void`

Set the editor theme explicitly.

###### Parameters

###### theme

`Theme`

###### Returns

`void`

---

###### toggleDarkMode

> **toggleDarkMode**: () => `void`

Flip the editor theme between `'light'` and `'dark'`.

###### Returns

`void`

---

###### toggleLayoutDirection

> **toggleLayoutDirection**: (`options?`) => `void`

Flip the diagram layout direction. Pass `options.flipPositions` to also reflow node coordinates and/or `options.fitView` to re-fit the view afterwards.

###### Parameters

###### options?

[`LayoutChangeOptions`](/docs/api/hooks/layoutchangeoptions/)

###### Returns

`void`

---

###### toggleReadOnly

> **toggleReadOnly**: () => `void`

Flip read-only mode.

###### Returns

`void`

### 8.5 Store

#### getStoreDataForIntegration — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/getstoredataforintegration/`*

> **getStoreDataForIntegration**(`params?`): [`IntegrationDataFormat`](/docs/api/integration/integrationdataformat/)

Snapshot the diagram in the shape expected by the integration layer (`{ name, nodes, edges, layoutDirection }`). Use this to hand a persistable payload to the host — e.g. inside a `props`-strategy `onDataSave` callback or before posting to a custom backend.

Dynamic, runtime-only values (selection, computed avoid-edge points, …) are stripped by default; pass `shouldSkipDynamicValues: false` if you specifically need the live values.

##### Parameters

###### params?

`GetStoreDataParams` = `{}`

##### Returns

[`IntegrationDataFormat`](/docs/api/integration/integrationdataformat/)

#### getStoreEdges — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/getstoreedges/`*

> **getStoreEdges**(): [`WorkflowBuilderEdge`](/docs/api/types/workflowbuilderedge/)[]

One-shot read of the current edges from the store (outside React).

##### Returns

[`WorkflowBuilderEdge`](/docs/api/types/workflowbuilderedge/)[]

#### getStoreLayoutDirection — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/getstorelayoutdirection/`*

> **getStoreLayoutDirection**(): `"DOWN"` | `"RIGHT"`

Read the current diagram layout direction (`'RIGHT'` or `'DOWN'`).

##### Returns

`"DOWN"` | `"RIGHT"`

#### getStoreNodes — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/getstorenodes/`*

> **getStoreNodes**(): [`WorkflowBuilderNode`](/docs/api/types/workflowbuildernode/)[]

One-shot read of the current nodes from the store (outside React). Inside a component prefer `useStore((s) => s.nodes)` so the component re-renders when nodes change.

##### Returns

[`WorkflowBuilderNode`](/docs/api/types/workflowbuildernode/)[]

#### getStoreSelection — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/getstoreselection/`*

> **getStoreSelection**(): `OnSelectionChangeParams`

Snapshot of the currently-selected nodes + edges, in xyflow’s `OnSelectionChangeParams` shape. Useful from outside React when you need to act on selection — e.g. on toolbar-button click to reach for the selected items.

##### Returns

`OnSelectionChangeParams`

#### openModal — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/openmodal/`*

> **openModal**(`__namedParameters`): `void`

Open a modal dialog with the given content + optional title / icon / footer. Resolves through the editor’s modal registry (one modal at a time; calling `openModal` while one is already visible replaces it).

Use it from a plugin to render a confirmation dialog, a settings picker, or any custom UI gated behind a button.

##### Parameters

###### __namedParameters

`ModalProps`

##### Returns

`void`

#### resetStoreSelection — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/resetstoreselection/`*

> **resetStoreSelection**(): `void`

Clear all node + edge selection. The diagram updates to the unselected visual state on next render.

##### Returns

`void`

#### setStoreEdges — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/setstoreedges/`*

> **setStoreEdges**(`edges`): `void`

Replace all edges in the store with the given list.

##### Parameters

###### edges

[`WorkflowBuilderEdge`](/docs/api/types/workflowbuilderedge/)[]

##### Returns

`void`

#### setStoreLayoutDirection — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/setstorelayoutdirection/`*

> **setStoreLayoutDirection**(`layoutDirection`): `void`

Set the diagram layout direction. Re-rendering picks up the new direction without recomputing the layout — call your auto-layout helper after this if positions need to update.

##### Parameters

###### layoutDirection

`"DOWN"` | `"RIGHT"`

##### Returns

`void`

#### setStoreNodes — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/setstorenodes/`*

> **setStoreNodes**(`nodes`): `void`

Replace all nodes in the store with the given list. Each node is re-validated against its schema before committing — `properties.errors` on the resulting nodes reflects the new validation state.

##### Parameters

###### nodes

[`WorkflowBuilderNode`](/docs/api/types/workflowbuildernode/)[]

##### Returns

`void`

#### trackFutureChange — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/trackfuturechange/`*

> `const` **trackFutureChange**: (…`params`) => `void`

Mark that a tracked change is about to occur. Updates the [useChangesTrackerStore](/docs/api/store/usechangestrackerstore/) so subscribers see the new `lastChangeName` / `lastChangeTimestamp`.

Wrapped with `withOptionalFunctionPlugins`, so plugins can decorate it via [registerFunctionDecorator](/docs/api/plugins/registerfunctiondecorator/) keyed `'trackFutureChange'` to observe or transform every change before it reaches the store.

##### Parameters

###### params

…[`string`, `object`]

Optional metadata about the change.

##### Returns

`void`

#### useChangesTrackerStore — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/usechangestrackerstore/`*

> `const` **useChangesTrackerStore**: `UseBoundStore`<`WithDevtools`<`StoreApi`<`ChangesTrackerStore`>>>

Zustand store that emits a tick every time a tracked diagram change is about to happen. Subscribe with `useChangesTrackerStore((s) => s.lastChangeName)` (or other fields) to react to changes — useful for undo/redo plugins, autosave, audit logging, and so on.

State shape: `{ lastChangeName, lastChangeParams, lastChangeTimestamp }` — the timestamp is the cheapest field to subscribe to when you only care about “something changed”.

#### useStore — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/store/usestore/`*

> `const` **useStore**: `UseBoundStoreWithEqualityFn`<`WithDevtools`<`StoreApi`<`WorkflowEditorState`>>>

The SDK’s Zustand store — a module-level **global singleton**.

##### Why global (not per-Root)

The SDK is single-instance by contract: mount one `<WorkflowBuilder.Root>` per page (see README → “Single-instance constraint”). The plugin / i18n registries and the palette/template config holders are already module-level singletons, so the store is one too — a single, consistent lifetime model instead of a per-Root store threaded through React context plus a module-level “current” pointer kept in sync from a layout effect.

This removes an entire bug class. Imperative reads (`useStore.getState()` and the `getStore*` / `setStore*` action helpers built on it) used to throw “store access before mount” when called during a descendant’s render or layout effect — i.e. before the Root’s `useLayoutEffect` had a chance to register the per-Root store. The store now exists from module load, so those reads always resolve to a real (initially empty) state.

`createWithEqualityFn` returns a hook that doubles as the store API:

- subscribe with a selector — `const nodes = useStore((s) => s.nodes);`
- read once, outside React — `useStore.getState()`
- write / observe imperatively — `useStore.setState(...)` , `useStore.subscribe(...)`

Equality is `shallow` by default, so selecting an object or array is safe.

Sequential workflows (mount → save → unmount → mount next) get a clean slate via resetWorkflowStore, which `<WorkflowBuilder.Root>` calls on mount — the persistent global store would otherwise carry the previous diagram’s state into the next Root.

### 8.6 Listeners

#### addNodeChangedListener — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/listeners/addnodechangedlistener/`*

> **addNodeChangedListener**(`listener`): `void`

Subscribe to node changes (drag, resize, select, remove). The listener receives xyflow’s raw `NodeChange[]` for every emitted change — useful for analytics, autosave, change-tracking plugins, etc.

The registry is module-global and persists across `<WorkflowBuilder.Root>` remounts — the SDK does not clear it automatically. **Plugins must call [removeNodeChangedListener](/docs/api/listeners/removenodechangedlistener/) themselves in their cleanup** (e.g. `useEffect` teardown) to avoid stacking zombie listeners across mount cycles. See `apps/demo/src/app/plugins/avoid-nodes-edges/providers/avoid-nodes-edges-provider.tsx` for the canonical pattern.

##### Parameters

###### listener

[`NodeChangedListener`](/docs/api/listeners/nodechangedlistener/)

##### Returns

`void`

Nothing. Call [removeNodeChangedListener](/docs/api/listeners/removenodechangedlistener/) with the same reference to unsubscribe.

#### addNodeDragStartListener — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/listeners/addnodedragstartlistener/`*

> **addNodeDragStartListener**(`listener`): `void`

Subscribe to “node drag started” events. The listener receives xyflow’s `OnNodeDrag` callback shape `(event, draggedNode, allNodes)` — fires once at the start of every drag interaction, not on subsequent drag frames.

Useful for plugins that need to capture pre-drag state for snapping, visual previews, or undo entries.

The registry is module-global and persists across `<WorkflowBuilder.Root>` remounts — the SDK does not clear it automatically. **Plugins must call [removeNodeDragStartListener](/docs/api/listeners/removenodedragstartlistener/) themselves in their cleanup** (e.g. `useEffect` teardown) to avoid stacking zombie listeners across mount cycles.

##### Parameters

###### listener

`OnNodeDrag`

##### Returns

`void`

#### NodeChangedListener — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/listeners/nodechangedlistener/`*

> **NodeChangedListener** = (`changes`) => `void`

Callback signature for [addNodeChangedListener](/docs/api/listeners/addnodechangedlistener/). Receives every node change xyflow emits (position, dimensions, selection, …) before the store updates.

##### Parameters

###### changes

`NodeChange`[]

##### Returns

`void`

#### removeNodeChangedListener — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/listeners/removenodechangedlistener/`*

> **removeNodeChangedListener**(`listener`): `void`

Remove a previously-registered node-change listener.

##### Parameters

###### listener

[`NodeChangedListener`](/docs/api/listeners/nodechangedlistener/)

##### Returns

`void`

#### removeNodeDragStartListener — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/listeners/removenodedragstartlistener/`*

> **removeNodeDragStartListener**(`listener`): `void`

Remove a previously-registered node-drag-start listener.

##### Parameters

###### listener

`OnNodeDrag`

##### Returns

`void`

#### useNodeChangedListener — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/listeners/usenodechangedlistener/`*

> **useNodeChangedListener**(`listener`): `void`

React-friendly variant of [addNodeChangedListener](/docs/api/listeners/addnodechangedlistener/) with automatic cleanup on unmount. Preferred over the raw `add` / `remove` pair for components and providers — the SDK does NOT clear the listener registry on `<WorkflowBuilder.Root>` remounts, so manual cleanup is mandatory and easy to forget.

The hook tolerates inline-arrow callbacks: a `useRef` trampoline keeps a single stable subscription across re-renders while always invoking the latest `listener` you passed. No need to wrap your callback in `useCallback`.

##### Parameters

###### listener

[`NodeChangedListener`](/docs/api/listeners/nodechangedlistener/)

##### Returns

`void`

##### Example

```tsx
function MyProvider() {
  useNodeChangedListener((changes) => {
    console.log('changes', changes);
  });
  return null;
}
```

#### useNodeDragStartListener — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/listeners/usenodedragstartlistener/`*

> **useNodeDragStartListener**(`listener`): `void`

React-friendly variant of [addNodeDragStartListener](/docs/api/listeners/addnodedragstartlistener/) with automatic cleanup on unmount. Preferred over the raw `add` / `remove` pair — the SDK does NOT clear the listener registry on `<WorkflowBuilder.Root>` remounts, so manual cleanup is mandatory and easy to forget.

The hook tolerates inline-arrow callbacks: a `useRef` trampoline keeps a single stable subscription across re-renders while always invoking the latest `listener` you passed. No need to wrap your callback in `useCallback`.

##### Parameters

###### listener

`OnNodeDrag`

##### Returns

`void`

### 8.7 Forms

Every symbol in this category is re-declared locally in `packages/sdk/src/features/json-form/authoring.ts` (`export const rankWith = JsonFormsCore.rankWith;` and so on) rather than re-exported with `export … from`, so that TypeDoc keeps the `@category Forms` tag. All of them are present in 2.3.0 — verified individually by `tsc`, not by name-matching a barrel.

#### and — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/and/`*

> `const` **and**: (…`testers`) => `Tester` = `JsonFormsCore.and`

Combines testers — matches when all match.

A tester that allow composing other testers by && them.

##### Parameters

###### testers

…`Tester`[]

the testers to be composed

##### Returns

`Tester`

#### CellProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/cellprops/`*

> **CellProps** = `JsonFormsCore.CellProps`

Props injected into a custom cell renderer.

#### ControlElement — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/controlelement/`*

> **ControlElement** = `JsonFormsCore.ControlElement`

A uischema control element.

#### ControlProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/controlprops/`*

> **ControlProps** = `JsonFormsCore.ControlProps`

Props injected into a custom control renderer.

#### DynamicCondition — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/dynamiccondition/`*

> **DynamicCondition** = `object`

One row in a dynamic-conditions control — two operands (`x`, `y`), a comparison (ComparisonOperator), and a logical operator that joins this condition with the next (`'AND'` / `'OR'`).

Operand strings can be literal values or `{{path}}` template placeholders that resolve against upstream node outputs.

#### formatIs — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/formatis/`*

> `const` **formatIs**: (`expectedFormat`) => `Tester` = `JsonFormsCore.formatIs`

Tester matching by the bound schema’s `format`.

Only applicable for Controls.

This function checks whether the given UI schema is of type Control and if so, resolves the sub-schema referenced by the control and checks whether the format of the sub-schema matches the expected one.

##### Parameters

###### expectedFormat

`string`

the expected format of the resolved sub-schema

##### Returns

`Tester`

#### getScope — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/getscope/`*

> **getScope**<`T`>(`path`): `string`

Build a JsonForms `scope` pointer from a typed dot-path. Equivalent to the JsonPointer fragment-encoding rule: turns `'properties.label'` into `'#/properties/label'`. Generic over the schema type so TypeScript autocompletes valid paths.

##### Type Parameters

###### T

`T` _extends_ `object`

##### Parameters

###### path

`""` | `PropertyPath`<`T`>

##### Returns

`string`

##### Example

```ts
getScope<typeof mySchema>('properties.label');
// => '#/properties/label'
```

##### See

[https://jsonforms.io/docs/uischema/controls/#scope-string](https://jsonforms.io/docs/uischema/controls/#scope-string)

#### isControl — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/iscontrol/`*

> `const` **isControl**: (`uischema`) => `uischema is ControlElement` = `JsonFormsCore.isControl`

Tester matching any control element.

##### Parameters

###### uischema

`any`

##### Returns

`uischema is ControlElement`

#### isLayout — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/islayout/`*

> `const` **isLayout**: (`uischema`) => `uischema is Layout` = `JsonFormsCore.isLayout`

Tester matching any layout element.

##### Parameters

###### uischema

`UISchemaElement`

##### Returns

`uischema is Layout`

#### JsonFormsDispatch — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/jsonformsdispatch/`*

> `const` **JsonFormsDispatch**: `ComponentType`<`OwnPropsOfJsonFormsRenderer`> = `JsonFormsReact.JsonFormsDispatch`

Renders a nested uischema subtree from a custom layout renderer.

#### JsonSchema — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/jsonschema/`*

> **JsonSchema** = `JsonFormsCore.JsonSchema`

A JSON Schema, as used for node property schemas.

#### LabelProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/labelprops/`*

> **LabelProps** = `JsonFormsCore.LabelProps`

Props injected into a custom label renderer.

#### Layout — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/layout/`*

> **Layout** = `JsonFormsCore.Layout`

A uischema layout element.

#### LayoutProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/layoutprops/`*

> **LayoutProps** = `JsonFormsCore.LayoutProps`

Props injected into a custom layout renderer.

#### not — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/not/`*

> `const` **not**: (`tester`) => `Tester` = `JsonFormsCore.not`

Negates a tester.

##### Parameters

###### tester

`Tester`

##### Returns

`Tester`

#### optionIs — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/optionis/`*

> `const` **optionIs**: (`optionName`, `optionValue`) => `Tester` = `JsonFormsCore.optionIs`

Tester matching by a uischema element `options` value.

Checks whether the given UI schema has an option with the given name and whether it has the expected value. If no options property is set, returns false.

##### Parameters

###### optionName

`string`

the name of the option to check

###### optionValue

`any`

the expected value of the option

##### Returns

`Tester`

#### or — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/or/`*

> `const` **or**: (…`testers`) => `Tester` = `JsonFormsCore.or`

Combines testers — matches when any match.

A tester that allow composing other testers by || them.

##### Parameters

###### testers

…`Tester`[]

the testers to be composed

##### Returns

`Tester`

#### RankedTester — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/rankedtester/`*

> **RankedTester** = `JsonFormsCore.RankedTester`

A tester paired with its rank, as returned by [rankWith](/docs/api/forms/rankwith/).

#### rankWith — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/rankwith/`*

> `const` **rankWith**: (`rank`, `tester`) => (`uischema`, `schema`, `context`) => `number` = `JsonFormsCore.rankWith`

Assigns a priority to a tester; rank above the built-ins to override a control.

Create a ranked tester that will associate a number with a given tester, if the latter returns true.

##### Parameters

###### rank

`number`

the rank to be returned in case the tester returns true

###### tester

`Tester`

a tester

##### Returns

(`uischema`, `schema`, `context`) => `number`

#### RuleEffect — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/ruleeffect-1/`*

> `const` **RuleEffect**: _typeof_ `RuleEffect` = `JsonFormsCore.RuleEffect`

Rule effect for conditional uischema rules (`SHOW`, `HIDE`, `ENABLE`, `DISABLE`).

#### RuleEffect — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/ruleeffect/`*

> **RuleEffect** = `JsonFormsCore.RuleEffect`

Rule effect for conditional uischema rules (`SHOW`, `HIDE`, `ENABLE`, `DISABLE`).

#### schemaMatches — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/schemamatches/`*

> `const` **schemaMatches**: (`predicate`) => `Tester` = `JsonFormsCore.schemaMatches`

Tester matching when the bound schema fragment satisfies a predicate.

Only applicable for Controls.

This function checks whether the given UI schema is of type Control and if so, resolves the sub-schema referenced by the control and applies the given predicate

##### Parameters

###### predicate

(`schema`, `rootSchema`) => `boolean`

the predicate that should be applied to the resolved sub-schema

##### Returns

`Tester`

#### schemaTypeIs — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/schematypeis/`*

> `const` **schemaTypeIs**: (`expectedType`) => `Tester` = `JsonFormsCore.schemaTypeIs`

Tester matching by the bound schema’s `type`.

Only applicable for Controls.

This function checks whether the given UI schema is of type Control and if so, resolves the sub-schema referenced by the control and checks whether the type of the sub-schema matches the expected one.

##### Parameters

###### expectedType

`string`

the expected type of the resolved sub-schema

##### Returns

`Tester`

#### scopeEndsWith — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/scopeendswith/`*

> `const` **scopeEndsWith**: (`expected`) => `Tester` = `JsonFormsCore.scopeEndsWith`

Tester matching when the control’s `scope` ends with a fragment.

Only applicable for Controls.

Checks whether the scope of a control ends with the expected string.

##### Parameters

###### expected

`string`

the expected ending of the reference

##### Returns

`Tester`

#### Tester — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/tester/`*

> **Tester** = `JsonFormsCore.Tester`

A renderer/cell matcher function.

#### uiTypeIs — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/uitypeis/`*

> `const` **uiTypeIs**: (`expected`) => `Tester` = `JsonFormsCore.uiTypeIs`

Tester matching a uischema element by its `type`.

Checks whether the given UI schema has the expected type.

##### Parameters

###### expected

`string`

the expected UI schema type

##### Returns

`Tester`

#### useJsonForms — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/usejsonforms/`*

> `const` **useJsonForms**: () => `JsonFormsStateContext` = `JsonFormsReact.useJsonForms`

Reads the full JsonForms state from inside a renderer.

##### Returns

`JsonFormsStateContext`

#### withJsonFormsCellProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/withjsonformscellprops/`*

> `const` **withJsonFormsCellProps**: (`Component`, `memoize?`) => `ComponentType`<`OwnPropsOfCell`> = `JsonFormsReact.withJsonFormsCellProps`

Connects a component to a JsonForms cell, for list/array cell rendering.

##### Parameters

###### Component

`ComponentType`<`CellProps`>

###### memoize?

`boolean`

##### Returns

`ComponentType`<`OwnPropsOfCell`>

#### withJsonFormsControlProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/withjsonformscontrolprops/`*

> `const` **withJsonFormsControlProps**: (`Component`, `memoize?`) => `ComponentType`<`OwnPropsOfControl`> = `JsonFormsReact.withJsonFormsControlProps`

Connects a component to a JsonForms control, injecting control props.

##### Parameters

###### Component

`ComponentType`<`ControlProps`>

###### memoize?

`boolean`

##### Returns

`ComponentType`<`OwnPropsOfControl`>

#### withJsonFormsLabelProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/withjsonformslabelprops/`*

> `const` **withJsonFormsLabelProps**: (`Component`, `memoize?`) => `ComponentType`<`OwnPropsOfLabel`> = `JsonFormsReact.withJsonFormsLabelProps`

Connects a component to a JsonForms label element.

##### Parameters

###### Component

`ComponentType`<`LabelProps` & `OwnPropsOfEnum`>

###### memoize?

`boolean`

##### Returns

`ComponentType`<`OwnPropsOfLabel`>

#### withJsonFormsLayoutProps — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/forms/withjsonformslayoutprops/`*

> `const` **withJsonFormsLayoutProps**: <`T`>(`Component`, `memoize?`) => `ComponentType`<`T` & `OwnPropsOfLayout`> = `JsonFormsReact.withJsonFormsLayoutProps`

Connects a component to a JsonForms layout, injecting child uischema elements.

##### Type Parameters

###### T

`T` _extends_ `LayoutProps`

##### Parameters

###### Component

`ComponentType`<`T`>

###### memoize?

`boolean`

##### Returns

`ComponentType`<`T` & `OwnPropsOfLayout`>

### 8.8 Integration

#### DidSaveStatus — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/integration/didsavestatus/`*

> **DidSaveStatus** = `"error"` | `"success"` | `"alreadyStarted"`

Resolution of a save attempt — three documented values: `'success'` (committed), `'error'` (failed), `'alreadyStarted'` (a save was already in flight and the new request was coalesced).

Today’s runtime treats every non-empty resolution as “the save finished” and surfaces the success-style snackbar — so all three variants currently look identical at the UI layer. Throw from the save callback (rather than resolving to `'error'`) if you need an error snackbar specifically.

#### IntegrationDataFormat — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/integration/integrationdataformat/`*

> **IntegrationDataFormat** = `object`

Canonical persistable shape of a workflow document. Returned by [getStoreDataForIntegration](/docs/api/store/getstoredataforintegration/) and passed to the host’s save callback under the `'props'` strategy.

#### IntegrationDataFormatOptional — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/integration/integrationdataformatoptional/`*

> **IntegrationDataFormatOptional** = `Partial`<[`IntegrationDataFormat`](/docs/api/integration/integrationdataformat/)>

Same shape as [IntegrationDataFormat](/docs/api/integration/integrationdataformat/) but with every field optional — accepted by load callbacks that may only deliver a partial payload (e.g. just nodes + edges, layoutDirection inferred).

#### IntegrationStrategy — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/integration/integrationstrategy/`*

> **IntegrationStrategy** = `"localStorage"` | `"api"` | `"props"`

Persistence strategy identifier — one of:

- `'localStorage'` : editor reads / writes the diagram under a fixed `'workflowBuilderDiagram'` key in browser `localStorage` (not derived from the instance `name` prop). Default.
- `'api'` : editor performs HTTP load + save against the configured `endpoints.load` / `endpoints.save` URLs.
- `'props'` : editor calls the host-supplied `onDataSave` callback; initial state comes from `initialNodes` / `initialEdges` props.

#### OnSaveExternal — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/integration/onsaveexternal/`*

> **OnSaveExternal** = (`data`, `savingParams?`) => `Promise`<[`DidSaveStatus`](/docs/api/integration/didsavestatus/)>

Save callback shape the host supplies under the `'props'` integration strategy. The editor calls it with the current diagram payload and expects a [DidSaveStatus](/docs/api/integration/didsavestatus/) resolution.

##### Parameters

###### data

[`IntegrationDataFormat`](/docs/api/integration/integrationdataformat/)

###### savingParams?

[`OnSaveParams`](/docs/api/integration/onsaveparams/)

##### Returns

`Promise`<[`DidSaveStatus`](/docs/api/integration/didsavestatus/)>

#### OnSaveParams — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/integration/onsaveparams/`*

> **OnSaveParams** = `object`

Optional metadata passed to save callbacks. Today only `isAutoSave` exists — the host can use it to suppress UI feedback on autosaves.

#### WorkflowBuilderIntegration — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/integration/workflowbuilderintegration/`*

> **WorkflowBuilderIntegration** = { `strategy?`: `"localStorage"`; } | { `endpoints`: { `load`: `string`; `save`: `string`; }; `strategy`: `"api"`; } | { `onDataSave`: [`OnSaveExternal`](/docs/api/integration/onsaveexternal/); `strategy`: `"props"`; }

Persistence strategy for a `<WorkflowBuilder.Root>` instance. Exactly one variant applies. `integration` is itself optional — omitting it picks the `localStorage` default.

##### Union Members

###### Type Literal

{ `strategy?`: `"localStorage"`; }

Default — save to browser localStorage under `'workflowBuilderDiagram'`. Selected when `integration` is omitted entirely or set to `{}`.

---

###### Type Literal

{ `endpoints`: { `load`: `string`; `save`: `string`; }; `strategy`: `"api"`; }

REST persistence — SDK issues `GET endpoints.load` and `POST endpoints.save` on every save event.

---

###### Type Literal

{ `onDataSave`: [`OnSaveExternal`](/docs/api/integration/onsaveexternal/); `strategy`: `"props"`; }

Host-managed — SDK invokes `onDataSave` with the diagram payload on every save event; the host owns where it lands.

### 8.9 Types

#### DiagramModel — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/diagrammodel/`*

> **DiagramModel** = `object`

Persistable shape of a complete diagram: name, layout direction, and xyflow’s serialised viewport + nodes + edges JSON. The format used by built-in templates and the integration layer.

#### IconType — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/icontype/`*

> **IconType** = [`WBIcon`](/docs/api/icons/wbicon/)

Icon name accepted by node definitions and palette items. Alias for [WBIcon](/docs/api/icons/wbicon/) from `@workflow-builder/icons`.

#### IfThenElseSchema — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/ifthenelseschema/`*

> **IfThenElseSchema** = `object`

Conditional validation block in a [NodeSchema](/docs/api/types/nodeschema/) — when `if` matches, `then` rules apply; otherwise `else` rules apply. Mirrors the JSON-schema [if/then/else](https://json-schema.org/understanding-json-schema/reference/conditionals) shape, narrowed to the field-validation subset the SDK uses.

#### LayoutDirection — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/layoutdirection/`*

> **LayoutDirection** = _typeof_ `layoutDirections`[`number`]

Diagram flow direction. `'RIGHT'` arranges nodes left→right (default for horizontal workflows); `'DOWN'` arranges them top→bottom.

#### NodeData — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/nodedata/`*

> **⚠️ field-level drift on this type.** `main` adds `isStartNode` to `NodeData`; 2.3.0 has no such field. `grep isStartNode dist/index.d.ts` returns nothing.

> **NodeData**<`T`> = `object`

Per-node data attached to every [WorkflowBuilderNode](/docs/api/types/workflowbuildernode/). The `properties` field carries the node’s user-editable values (typed by `T`); `type` matches the corresponding `NodeDefinition.type`; `icon` is the icon shown in palette and on the diagram canvas.

Generic over `T` so concrete node types can refine `properties` to their own schema-driven shape (typically via `NodeDataProperties<MySchema>`).

##### Type Parameters

###### T

`T` = `BaseNodeProperties` & `Record`<`string`, `unknown`>

#### NodeDataProperties — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/nodedataproperties/`*

> **NodeDataProperties**<`T`> = `MakePropertiesOptional`<`ExtractProperties`<`T`>>

Derives a TypeScript type for a node’s `data.properties` directly from its [NodeSchema](/docs/api/types/nodeschema/). Each property is optional (matching the runtime, where partial form-state is normal).

##### Type Parameters

###### T

`T`

##### Example

```ts
const schema = { type: 'object', properties: { count: { type: 'number' } } } as const;
type Props = NodeDataProperties<typeof schema>; // { count?: number }
```

#### NodeSchema — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/nodeschema/`*

> **NodeSchema** = `ObjectFieldRequiredValidationSchema` & `object`

JSON-schema-like description of a node type’s editable properties.

Drives three things at runtime:

1. **Validation** — values are checked against this shape; failures bubble into `NodeData.properties.errors` for UI display.
2. **Rendering** — JsonForms uses the schema (combined with an optional [UISchema](/docs/api/types/uischema/) ) to render the property panel.
3. **Type inference** — `NodeDataProperties<MySchema>` extracts a precise TypeScript type for a node’s `properties` .

##### Type Declaration

###### allOf?

> `optional` **allOf?**: [`IfThenElseSchema`](/docs/api/types/ifthenelseschema/)[]

###### properties

> **properties**: `NodePropertiesSchema`

#### NodeType — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/nodetype/`*

Built-in template categories the editor recognises. Drives diagram validation rules (e.g. exactly one start node, decision branches), the variable picker’s traversal, and rendering choices in the default node template.

Custom node types declare their template type via this enum so the editor can apply the matching rules.

##### Enumeration Members

###### AiNode

> **AiNode**: `"ai-node"`

---

###### DecisionNode

> **DecisionNode**: `"decision-node"`

---

###### Node

> **Node**: `"node"`

---

###### StartNode

> **StartNode**: `"start-node"`

#### Option — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/option/`*

> **Option** = `ItemOption` | `SeparatorOption`

Single entry in a Select control’s option list — either an item (label + value, optionally an icon) or a visual separator.

#### PaletteItem — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/paletteitem/`*

> **⚠️ field-level drift on this type.** `PaletteItem<T> = NodeDefinition<T>`. On `main`, `NodeDefinition` picks `isStartNode` off `NodeData`; in 2.3.0 it does not. The type name itself is ✅ in 2.3.0 — the missing piece is the field.

> **PaletteItem**<`T`> = `NodeDefinition`<`T`>

One entry in the editor’s left-hand palette — equivalent to a full node definition (schema, default values, icon, type id). Drag onto the canvas to instantiate the corresponding node.

##### Type Parameters

###### T

`T` _extends_ [`NodeSchema`](/docs/api/types/nodeschema/) = [`NodeSchema`](/docs/api/types/nodeschema/)

#### PaletteItemOrGroup — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/paletteitemorgroup/`*

> **PaletteItemOrGroup** = [`PaletteItem`](/docs/api/types/paletteitem/) | `PaletteGroup`

Either a single [PaletteItem](/docs/api/types/paletteitem/) or a labelled group of them (`PaletteGroup`). `<WorkflowBuilder.Root nodeTypes={...} />` accepts a mixed array of both forms.

#### TemplateModel — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/templatemodel/`*

> **TemplateModel** = `object`

One entry in the editor’s template selector — pairs a [DiagramModel](/docs/api/types/diagrammodel/) with display metadata (id, name, icon). Pass an array of these to `<WorkflowBuilder.Root diagramTemplates={...} />` to populate the selector.

#### UISchema — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/uischema/`*

> **UISchema** = `UISchemaElement`

JsonForms-compatible UI schema describing how a node’s properties are rendered in the property panel — controls (Text, Switch, Select, DynamicConditions, …), layouts (Vertical, Horizontal, Group, Accordion), and labels.

Pair with [NodeSchema](/docs/api/types/nodeschema/) to drive both validation and rendering from a single declarative source.

#### WorkflowBuilderEdge — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/workflowbuilderedge/`*

> **WorkflowBuilderEdge** = `Edge`<`EdgeData`>

xyflow `Edge` parameterised with the SDK’s `EdgeData` (label + icon).

#### WorkflowBuilderNode — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/types/workflowbuildernode/`*

> **WorkflowBuilderNode** = `Node`<[`NodeData`](/docs/api/types/nodedata/)>

xyflow `Node` parameterised with the SDK’s [NodeData](/docs/api/types/nodedata/). The node-instance shape used everywhere the editor references a node (store, handlers, listeners, save payload).

### 8.10 Utilities

#### DeepPartial — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/utilities/deeppartial/`*

> **DeepPartial**<`T`> = `T` _extends_ `object` ? `{ [P in keyof T]?: DeepPartial<T[P]> }` : `T`

Recursive `Partial<T>`: every nested object property becomes optional all the way down. Use it when a value is built up incrementally and intermediate states are never fully populated.

##### Type Parameters

###### T

`T`

#### errorPolicyProperty — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/utilities/errorpolicyproperty/`*

> `const` **errorPolicyProperty**: `object`

Opt-in schema fragment exposing the runner’s `errorPolicy` as a Select. Spread alongside [sharedProperties](/docs/api/utilities/sharedproperties/) on node types that should surface the choice in the properties panel; omit it elsewhere — the runner defaults to `'fail'` when the field is absent.

##### Type Declaration

###### errorPolicy

> `readonly` **errorPolicy**: `object`

###### errorPolicy.options

> `readonly` **options**: `object`[]

###### errorPolicy.type

> `readonly` **type**: `"string"` = `'string'`

#### generalInformation — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/utilities/generalinformation/`*

> `const` **generalInformation**: [`UISchema`](/docs/api/types/uischema/)

Reusable “General Information” UISchema accordion (Title / Status / Description) that every standard node type can plug into its own properties UI without redeclaring the three fields by hand.

#### getHandleId — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/utilities/gethandleid/`*

> **getHandleId**(`__namedParameters`): `HandleId`

Build a stable, parseable ID for a node handle. Returns the bare `handleType` for outer handles and `<handleType>:inner:<innerId>` for sub-handles inside compound nodes (e.g. one per decision branch or AI tool). The ID is local to the owning node — xyflow scopes handle IDs by node, so the same string can appear on multiple nodes without clashing.

Use this when authoring a custom node template — pass the returned string to xyflow’s `<Handle id={...}>` so the editor’s edge logic (validation, hover, selection) can find the right handle later.

##### Parameters

###### __namedParameters

`GetHandleIdOptions`

##### Returns

`HandleId`

#### globalControls — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/utilities/globalcontrols/`*

> `const` **globalControls**: `UISchemaElement`[]

UISchema fragments rendered on every node’s properties tab regardless of the node type. Today contains the missing-previous-variable error message; compose it into a node’s UISchema with spread/merge.

#### Prettify — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/utilities/prettify/`*

> **Prettify**<`T`> = `{ [K in keyof T]: T[K] }` & `object`

Forces TypeScript to flatten an intersection / mapped type into a single object literal. Doesn’t change semantics — only what TS shows in tooltips and error messages.

##### Type Parameters

###### T

`T`

#### sharedProperties — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/utilities/sharedproperties/`*

> `const` **sharedProperties**: `BaseNodePropertiesSchema`

Reusable schema fragment for the properties every node carries by default: `label` and `description`. Spread this into a custom `NodeSchema['properties']` to avoid redeclaring them per node type.

#### statusOptions — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/utilities/statusoptions/`*

> `const` **statusOptions**: `object`

Canonical option set for the node-status select control: `active`, `draft`, `disabled`. Each option ships its `label`, `value`, and the matching status icon name.

##### Type Declaration

###### active

> `readonly` **active**: `object`

###### active.icon

> `readonly` **icon**: `"StatusActive"` = `'StatusActive'`

###### active.label

> `readonly` **label**: `"Active"` = `'Active'`

###### active.value

> `readonly` **value**: `"active"` = `'active'`

###### disabled

> `readonly` **disabled**: `object`

###### disabled.icon

> `readonly` **icon**: `"StatusDisabled"` = `'StatusDisabled'`

###### disabled.label

> `readonly` **label**: `"Disabled"` = `'Disabled'`

###### disabled.value

> `readonly` **value**: `"disabled"` = `'disabled'`

###### draft

> `readonly` **draft**: `object`

###### draft.icon

> `readonly` **icon**: `"StatusDraft"` = `'StatusDraft'`

###### draft.label

> `readonly` **label**: `"Draft"` = `'Draft'`

###### draft.value

> `readonly` **value**: `"draft"` = `'draft'`

### 8.11 Constants

#### EDGE_CURVE_RADIUS — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/constants/edge_curve_radius/`*

> `const` **EDGE_CURVE_RADIUS**: `16` = `16`

Corner radius (px) used at every bend of a smooth-step edge.

#### EDGE_OFFSET — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/constants/edge_offset/`*

> `const` **EDGE_OFFSET**: `20` = `20`

Pixel gap between an edge endpoint and the connected node’s bounding box. Tunes the smooth-step routing used by [LabelEdge](/docs/api/components/labeledge/).

#### SELF_CONNECTING_EDGE_LABEL_OFFSET — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/constants/self_connecting_edge_label_offset/`*

> `const` **SELF_CONNECTING_EDGE_LABEL_OFFSET**: `100` = `100`

Vertical distance (px) between the source node’s top edge and the apex of a self-connecting edge’s loop. Also drives where the edge’s label sits on a self-connecting edge.

#### VARIABLE_NODES_KEY — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/constants/variable_nodes_key/`*

> `const` **VARIABLE_NODES_KEY**: `"nodes"` = `'nodes'`

Reserved key under which the variable-text control looks up the available upstream nodes when expanding `{{nodes.*}}` placeholders. Plugins that compose alternative variable sources should namespace their own keys to avoid colliding with this reserved value.

### 8.12 i18n

#### TranslationKey — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/i18n/translationkey/`*

> **TranslationKey** = `Parameters`<`TFunction`>[`0`] & `string`

Union of every valid translation key registered in the SDK’s i18next instance — built from the bundled English locale plus the structural shape declared for plugin keys. Use it to type-check `t(...)` calls inside SDK code and inside plugins that consume the SDK’s i18n.

### 8.13 Icons

#### Icon — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/icons/icon/`*

> **Icon**(`__namedParameters`): `Element`

Lazy loads an icon from the @phosphor-icons/core package with help of SVGR loader. Can be easily extended to support other .svg sources.

##### Parameters

###### __namedParameters

`IconProps`

##### Returns

`Element`

#### WBIcon — ✅ in 2.3.0

*`https://www.workflowbuilder.io/docs/api/icons/wbicon/`*

> **WBIcon** = `"Acorn"` | `"AddressBook"` | `"AddressBookTabs"` | `"AiAgent"` | `"AirTrafficControl"` | `"Airplane"` | `"AirplaneInFlight"` | `"AirplaneLanding"` | `"AirplaneTakeoff"` | `"AirplaneTaxiing"` | `"AirplaneTilt"` | `"Airplay"` | `"AirtableLogo"` | `"Alarm"` | `"Alien"` | `"AlignBottom"` | `"AlignBottomSimple"` | `"AlignCenterHorizontal"` | `"AlignCenterHorizontalSimple"` | `"AlignCenterVertical"` | `"AlignCenterVerticalSimple"` | `"AlignLeft"` | `"AlignLeftSimple"` | `"AlignRight"` | `"AlignRightSimple"` | `"AlignTop"` | `"AlignTopSimple"` | `"AmazonLogo"` | `"Ambulance"` | `"Anchor"` | `"AnchorSimple"` | `"AndroidLogo"` | `"Angle"` | `"AngularLogo"` | `"Aperture"` | `"AppStoreLogo"` | `"AppWindow"` | `"AppleLogo"` | `"ApplePodcastsLogo"` | `"ApproximateEquals"` | `"Archive"` | `"Armchair"` | `"ArrowArcLeft"` | `"ArrowArcRight"` | `"ArrowBendDoubleUpLeft"` | `"ArrowBendDoubleUpRight"` | `"ArrowBendDownLeft"` | `"ArrowBendDownRight"` | `"ArrowBendLeftDown"` | `"ArrowBendLeftUp"` | `"ArrowBendRightDown"` | `"ArrowBendRightUp"` | `"ArrowBendUpLeft"` | `"ArrowBendUpRight"` | `"ArrowCircleDown"` | `"ArrowCircleDownLeft"` | `"ArrowCircleDownRight"` | `"ArrowCircleLeft"` | `"ArrowCircleRight"` | `"ArrowCircleUp"` | `"ArrowCircleUpLeft"` | `"ArrowCircleUpRight"` | `"ArrowClockwise"` | `"ArrowCounterClockwise"` | `"ArrowDown"` | `"ArrowDownLeft"` | `"ArrowDownRight"` | `"ArrowElbowDownLeft"` | `"ArrowElbowDownRight"` | `"ArrowElbowLeft"` | `"ArrowElbowLeftDown"` | `"ArrowElbowLeftUp"` | `"ArrowElbowRight"` | `"ArrowElbowRightDown"` | `"ArrowElbowRightUp"` | `"ArrowElbowUpLeft"` | `"ArrowElbowUpRight"` | `"ArrowFatDown"` | `"ArrowFatLeft"` | `"ArrowFatLineDown"` | `"ArrowFatLineLeft"` | `"ArrowFatLineRight"` | `"ArrowFatLineUp"` | `"ArrowFatLinesDown"` | `"ArrowFatLinesLeft"` | `"ArrowFatLinesRight"` | `"ArrowFatLinesUp"` | `"ArrowFatRight"` | `"ArrowFatUp"` | `"ArrowLeft"` | `"ArrowLineDown"` | `"ArrowLineDownLeft"` | `"ArrowLineDownRight"` | `"ArrowLineLeft"` | `"ArrowLineRight"` | `"ArrowLineUp"` | `"ArrowLineUpLeft"` | `"ArrowLineUpRight"` | `"ArrowRight"` | `"ArrowSquareDown"` | `"ArrowSquareDownLeft"` | `"ArrowSquareDownRight"` | `"ArrowSquareIn"` | `"ArrowSquareLeft"` | `"ArrowSquareOut"` | `"ArrowSquareRight"` | `"ArrowSquareUp"` | `"ArrowSquareUpLeft"` | `"ArrowSquareUpRight"` | `"ArrowUDownLeft"` | `"ArrowUDownRight"` | `"ArrowULeftDown"` | `"ArrowULeftUp"` | `"ArrowURightDown"` | `"ArrowURightUp"` | `"ArrowUUpLeft"` | `"ArrowUUpRight"` | `"ArrowUp"` | `"ArrowUpLeft"` | `"ArrowUpRight"` | `"ArrowsClockwise"` | `"ArrowsCounterClockwise"` | `"ArrowsDownUp"` | `"ArrowsHorizontal"` | `"ArrowsIn"` | `"ArrowsInCardinal"` | `"ArrowsInLineHorizontal"` | `"ArrowsInLineVertical"` | `"ArrowsInSimple"` | `"ArrowsLeftRight"` | `"ArrowsMerge"` | `"ArrowsOut"` | `"ArrowsOutCardinal"` | `"ArrowsOutLineHorizontal"` | `"ArrowsOutLineVertical"` | `"ArrowsOutSimple"` | `"ArrowsSplit"` | `"ArrowsVertical"` | `"Article"` | `"ArticleMedium"` | `"ArticleNyTimes"` | `"Asclepius"` | `"Asterisk"` | `"AsteriskSimple"` | `"At"` | `"Atom"` | `"Avocado"` | `"Axe"` | `"Baby"` | `"BabyCarriage"` | `"Backpack"` | `"Backspace"` | `"Bag"` | `"BagSimple"` | `"Balloon"` | `"Bandaids"` | `"Bank"` | `"Barbell"` | `"Barcode"` | `"Barn"` | `"Barricade"` | `"Baseball"` | `"BaseballCap"` | `"BaseballHelmet"` | `"Basket"` | `"Basketball"` | `"Bathtub"` | `"BatteryCharging"` | `"BatteryChargingVertical"` | `"BatteryEmpty"` | `"BatteryFull"` | `"BatteryHigh"` | `"BatteryLow"` | `"BatteryMedium"` | `"BatteryPlus"` | `"BatteryPlusVertical"` | `"BatteryVerticalEmpty"` | `"BatteryVerticalFull"` | `"BatteryVerticalHigh"` | `"BatteryVerticalLow"` | `"BatteryVerticalMedium"` | `"BatteryWarning"` | `"BatteryWarningVertical"` | `"BeachBall"` | `"Beanie"` | `"Bed"` | `"BeerBottle"` | `"BeerStein"` | `"BehanceLogo"` | `"Bell"` | `"BellRinging"` | `"BellSimple"` | `"BellSimpleRinging"` | `"BellSimpleSlash"` | `"BellSimpleZ"` | `"BellSlash"` | `"BellZ"` | `"Belt"` | `"BezierCurve"` | `"Bicycle"` | `"Binary"` | `"Binoculars"` | `"Biohazard"` | `"Bird"` | `"Blueprint"` | `"Bluetooth"` | `"BluetoothConnected"` | `"BluetoothSlash"` | `"BluetoothX"` | `"Boat"` | `"Bomb"` | `"Bone"` | `"Book"` | `"BookBookmark"` | `"BookOpen"` | `"BookOpenText"` | `"BookOpenUser"` | `"Bookmark"` | `"BookmarkSimple"` | `"Bookmarks"` | `"BookmarksSimple"` | `"Books"` | `"Boot"` | `"Boules"` | `"BoundingBox"` | `"BowlFood"` | `"BowlSteam"` | `"BowlingBall"` | `"BoxArrowDown"` | `"BoxArrowUp"` | `"BoxingGlove"` | `"BracketsAngle"` | `"BracketsCurly"` | `"BracketsRound"` | `"BracketsSquare"` | `"Brain"` | `"Brandy"` | `"Bread"` | `"Bridge"` | `"Briefcase"` | `"BriefcaseMetal"` | `"Broadcast"` | `"Broom"` | `"Browser"` | `"Browsers"` | `"Bug"` | `"BugBeetle"` | `"BugDroid"` | `"Building"` | `"BuildingApartment"` | `"BuildingOffice"` | `"Buildings"` | `"Bulldozer"` | `"Bus"` | `"Butterfly"` | `"CableCar"` | `"Cactus"` | `"Cake"` | `"Calculator"` | `"Calendar"` | `"CalendarBlank"` | `"CalendarCheck"` | `"CalendarDot"` | `"CalendarDots"` | `"CalendarHeart"` | `"CalendarMinus"` | `"CalendarPlus"` | `"CalendarSlash"` | `"CalendarStar"` | `"CalendarX"` | `"CallBell"` | `"Camera"` | `"CameraPlus"` | `"CameraRotate"` | `"CameraSlash"` | `"Campfire"` | `"Car"` | `"CarBattery"` | `"CarProfile"` | `"CarSimple"` | `"Cardholder"` | `"Cards"` | `"CardsThree"` | `"CaretCircleDoubleDown"` | `"CaretCircleDoubleLeft"` | `"CaretCircleDoubleRight"` | `"CaretCircleDoubleUp"` | `"CaretCircleDown"` | `"CaretCircleLeft"` | `"CaretCircleRight"` | `"CaretCircleUp"` | `"CaretCircleUpDown"` | `"CaretDoubleDown"` | `"CaretDoubleLeft"` | `"CaretDoubleRight"` | `"CaretDoubleUp"` | `"CaretDown"` | `"CaretLeft"` | `"CaretLineDown"` | `"CaretLineLeft"` | `"CaretLineRight"` | `"CaretLineUp"` | `"CaretRight"` | `"CaretUp"` | `"CaretUpDown"` | `"Carrot"` | `"CashRegister"` | `"CassetteTape"` | `"CastleTurret"` | `"Cat"` | `"CellSignalFull"` | `"CellSignalHigh"` | `"CellSignalLow"` | `"CellSignalMedium"` | `"CellSignalNone"` | `"CellSignalSlash"` | `"CellSignalX"` | `"CellTower"` | `"Certificate"` | `"Chair"` | `"Chalkboard"` | `"ChalkboardSimple"` | `"ChalkboardTeacher"` | `"Champagne"` | `"ChargingStation"` | `"ChartBar"` | `"ChartBarHorizontal"` | `"ChartDonut"` | `"ChartLine"` | `"ChartLineDown"` | `"ChartLineUp"` | `"ChartPie"` | `"ChartPieSlice"` | `"ChartPolar"` | `"ChartScatter"` | `"Chat"` | `"ChatCentered"` | `"ChatCenteredDots"` | `"ChatCenteredSlash"` | `"ChatCenteredText"` | `"ChatCircle"` | `"ChatCircleDots"` | `"ChatCircleSlash"` | `"ChatCircleText"` | `"ChatDots"` | `"ChatSlash"` | `"ChatTeardrop"` | `"ChatTeardropDots"` | `"ChatTeardropSlash"` | `"ChatTeardropText"` | `"ChatText"` | `"Chats"` | `"ChatsCircle"` | `"ChatsTeardrop"` | `"Check"` | `"CheckCircle"` | `"CheckFat"` | `"CheckSquare"` | `"CheckSquareOffset"` | `"Checkerboard"` | `"Checks"` | `"Cheers"` | `"Cheese"` | `"ChefHat"` | `"Cherries"` | `"Church"` | `"Cigarette"` | `"CigaretteSlash"` | `"Circle"` | `"CircleDashed"` | `"CircleHalf"` | `"CircleHalfTilt"` | `"CircleNotch"` | `"CirclesFour"` | `"CirclesThree"` | `"CirclesThreePlus"` | `"Circuitry"` | `"City"` | `"ClaudeLogo"` | `"Clipboard"` | `"ClipboardText"` | `"Clock"` | `"ClockAfternoon"` | `"ClockClockwise"` | `"ClockCountdown"` | `"ClockCounterClockwise"` | `"ClockUser"` | `"ClosedCaptioning"` | `"Cloud"` | `"CloudArrowDown"` | `"CloudArrowUp"` | `"CloudCheck"` | `"CloudFog"` | `"CloudLightning"` | `"CloudMoon"` | `"CloudRain"` | `"CloudSlash"` | `"CloudSnow"` | `"CloudSun"` | `"CloudWarning"` | `"CloudX"` | `"Clover"` | `"Club"` | `"CoatHanger"` | `"CodaLogo"` | `"Code"` | `"CodeBlock"` | `"CodeSimple"` | `"CodepenLogo"` | `"CodesandboxLogo"` | `"Coffee"` | `"CoffeeBean"` | `"Coin"` | `"CoinVertical"` | `"Coins"` | `"Columns"` | `"ColumnsPlusLeft"` | `"ColumnsPlusRight"` | `"Command"` | `"Compass"` | `"CompassRose"` | `"CompassTool"` | `"ComputerTower"` | `"Confetti"` | `"ContactlessPayment"` | `"Control"` | `"Cookie"` | `"CookingPot"` | `"Copy"` | `"CopySimple"` | `"Copyleft"` | `"Copyright"` | `"CornersIn"` | `"CornersOut"` | `"Couch"` | `"CourtBasketball"` | `"Cow"` | `"CowboyHat"` | `"Cpu"` | `"Crane"` | `"CraneTower"` | `"CreditCard"` | `"Cricket"` | `"Crop"` | `"Cross"` | `"Crosshair"` | `"CrosshairSimple"` | `"Crown"` | `"CrownCross"` | `"CrownSimple"` | `"Cube"` | `"CubeFocus"` | `"CubeTransparent"` | `"CurrencyBtc"` | `"CurrencyCircleDollar"` | `"CurrencyCny"` | `"CurrencyDollar"` | `"CurrencyDollarSimple"` | `"CurrencyEth"` | `"CurrencyEur"` | `"CurrencyGbp"` | `"CurrencyInr"` | `"CurrencyJpy"` | `"CurrencyKrw"` | `"CurrencyKzt"` | `"CurrencyNgn"` | `"CurrencyRub"` | `"Cursor"` | `"CursorClick"` | `"CursorText"` | `"Cylinder"` | `"Database"` | `"Desk"` | `"Desktop"` | `"DesktopTower"` | `"Detective"` | `"DevToLogo"` | `"DeviceMobile"` | `"DeviceMobileCamera"` | `"DeviceMobileSlash"` | `"DeviceMobileSpeaker"` | `"DeviceRotate"` | `"DeviceTablet"` | `"DeviceTabletCamera"` | `"DeviceTabletSpeaker"` | `"Devices"` | `"Diamond"` | `"DiamondsFour"` | `"DiceFive"` | `"DiceFour"` | `"DiceOne"` | `"DiceSix"` | `"DiceThree"` | `"DiceTwo"` | `"Disc"` | `"DiscoBall"` | `"DiscordLogo"` | `"Divide"` | `"Dna"` | `"Dog"` | `"Door"` | `"DoorOpen"` | `"Dot"` | `"DotOutline"` | `"DotsNine"` | `"DotsSix"` | `"DotsSixVertical"` | `"DotsThree"` | `"DotsThreeCircle"` | `"DotsThreeCircleVertical"` | `"DotsThreeOutline"` | `"DotsThreeOutlineVertical"` | `"DotsThreeVertical"` | `"Download"` | `"DownloadSimple"` | `"Dress"` | `"Dresser"` | `"DribbbleLogo"` | `"Drone"` | `"Drop"` | `"DropHalf"` | `"DropHalfBottom"` | `"DropSimple"` | `"DropSlash"` | `"DropboxLogo"` | `"Ear"` | `"EarSlash"` | `"Egg"` | `"EggCrack"` | `"Eject"` | `"EjectSimple"` | `"Elevator"` | `"Empty"` | `"Engine"` | `"Envelope"` | `"EnvelopeOpen"` | `"EnvelopeSimple"` | `"EnvelopeSimpleOpen"` | `"Equalizer"` | `"Equals"` | `"Eraser"` | `"EscalatorDown"` | `"EscalatorUp"` | `"Exam"` | `"ExclamationMark"` | `"Exclude"` | `"ExcludeSquare"` | `"Export"` | `"Eye"` | `"EyeClosed"` | `"EyeSlash"` | `"Eyedropper"` | `"EyedropperSample"` | `"Eyeglasses"` | `"Eyes"` | `"FaceMask"` | `"FacebookLogo"` | `"Factory"` | `"Faders"` | `"FadersHorizontal"` | `"FalloutShelter"` | `"Fan"` | `"Farm"` | `"FastForward"` | `"FastForwardCircle"` | `"Feather"` | `"FediverseLogo"` | `"FigmaLogo"` | `"File"` | `"FileArchive"` | `"FileArrowDown"` | `"FileArrowUp"` | `"FileAudio"` | `"FileC"` | `"FileCSharp"` | `"FileCloud"` | `"FileCode"` | `"FileCpp"` | `"FileCss"` | `"FileCsv"` | `"FileDashed"` | `"FileDoc"` | `"FileHtml"` | `"FileImage"` | `"FileIni"` | `"FileJpg"` | `"FileJs"` | `"FileJsx"` | `"FileLock"` | `"FileMagnifyingGlass"` | `"FileMd"` | `"FileMinus"` | `"FilePdf"` | `"FilePlus"` | `"FilePng"` | `"FilePpt"` | `"FilePy"` | `"FileRs"` | `"FileSql"` | `"FileSvg"` | `"FileText"` | `"FileTs"` | `"FileTsx"` | `"FileTxt"` | `"FileVideo"` | `"FileVue"` | `"FileX"` | `"FileXls"` | `"FileZip"` | `"Files"` | `"FilmReel"` | `"FilmScript"` | `"FilmSlate"` | `"FilmStrip"` | `"Fingerprint"` | `"FingerprintSimple"` | `"FinnTheHuman"` | `"Fire"` | `"FireExtinguisher"` | `"FireSimple"` | `"FireTruck"` | `"FirstAid"` | `"FirstAidKit"` | `"Fish"` | `"FishSimple"` | `"Flag"` | `"FlagBanner"` | `"FlagBannerFold"` | `"FlagCheckered"` | `"FlagPennant"` | `"Flame"` | `"Flashlight"` | `"Flask"` | `"FlipHorizontal"` | `"FlipVertical"` | `"FloppyDisk"` | `"FloppyDiskBack"` | `"FlowArrow"` | `"Flower"` | `"FlowerLotus"` | `"FlowerTulip"` | `"FlyingSaucer"` | `"Folder"` | `"FolderDashed"` | `"FolderLock"` | `"FolderMinus"` | `"FolderOpen"` | `"FolderPlus"` | `"FolderSimple"` | `"FolderSimpleDashed"` | `"FolderSimpleLock"` | `"FolderSimpleMinus"` | `"FolderSimplePlus"` | `"FolderSimpleStar"` | `"FolderSimpleUser"` | `"FolderStar"` | `"FolderUser"` | `"Folders"` | `"Football"` | `"FootballHelmet"` | `"Footprints"` | `"ForkKnife"` | `"FourK"` | `"FrameCorners"` | `"FramerLogo"` | `"Function"` | `"Funnel"` | `"FunnelSimple"` | `"FunnelSimpleX"` | `"FunnelX"` | `"GameController"` | `"Garage"` | `"GasCan"` | `"GasPump"` | `"Gauge"` | `"Gavel"` | `"Gear"` | `"GearFine"` | `"GearSix"` | `"GeminiLogo"` | `"GenderFemale"` | `"GenderIntersex"` | `"GenderMale"` | `"GenderNeuter"` | `"GenderNonbinary"` | `"GenderTransgender"` | `"Ghost"` | `"Gif"` | `"Gift"` | `"GitBranch"` | `"GitCommit"` | `"GitDiff"` | `"GitFork"` | `"GitMerge"` | `"GitPullRequest"` | `"GithubLogo"` | `"GitlabLogo"` | `"GitlabLogoSimple"` | `"Globe"` | `"GlobeHemisphereEast"` | `"GlobeHemisphereWest"` | `"GlobeSimple"` | `"GlobeSimpleX"` | `"GlobeStand"` | `"GlobeX"` | `"Goggles"` | `"Golf"` | `"GoodreadsLogo"` | `"GoogleCardboardLogo"` | `"GoogleChromeLogo"` | `"GoogleDriveLogo"` | `"GoogleLogo"` | `"GooglePhotosLogo"` | `"GooglePlayLogo"` | `"GooglePodcastsLogo"` | `"Gps"` | `"GpsFix"` | `"GpsSlash"` | `"Gradient"` | `"GraduationCap"` | `"Grains"` | `"GrainsSlash"` | `"Graph"` | `"GraphicsCard"` | `"GreaterThan"` | `"GreaterThanOrEqual"` | `"GridFour"` | `"GridNine"` | `"Guitar"` | `"HairDryer"` | `"Hamburger"` | `"Hammer"` | `"Hand"` | `"HandArrowDown"` | `"HandArrowUp"` | `"HandCoins"` | `"HandDeposit"` | `"HandEye"` | `"HandFist"` | `"HandGrabbing"` | `"HandHeart"` | `"HandPalm"` | `"HandPeace"` | `"HandPointing"` | `"HandSoap"` | `"HandSwipeLeft"` | `"HandSwipeRight"` | `"HandTap"` | `"HandWaving"` | `"HandWithdraw"` | `"Handbag"` | `"HandbagSimple"` | `"HandsClapping"` | `"HandsPraying"` | `"Handshake"` | `"HardDrive"` | `"HardDrives"` | `"HardHat"` | `"Hash"` | `"HashStraight"` | `"HeadCircuit"` | `"Headlights"` | `"Headphones"` | `"Headset"` | `"Heart"` | `"HeartBreak"` | `"HeartHalf"` | `"HeartStraight"` | `"HeartStraightBreak"` | `"Heartbeat"` | `"Hexagon"` | `"HighDefinition"` | `"HighHeel"` | `"Highlighter"` | `"HighlighterCircle"` | `"Hockey"` | `"Hoodie"` | `"Horse"` | `"Hospital"` | `"Hourglass"` | `"HourglassHigh"` | `"HourglassLow"` | `"HourglassMedium"` | `"HourglassSimple"` | `"HourglassSimpleHigh"` | `"HourglassSimpleLow"` | `"HourglassSimpleMedium"` | `"House"` | `"HouseLine"` | `"HouseSimple"` | `"HubspotLogo"` | `"Hurricane"` | `"IceCream"` | `"IdentificationBadge"` | `"IdentificationCard"` | `"Image"` | `"ImageBroken"` | `"ImageSquare"` | `"Images"` | `"ImagesSquare"` | `"Infinity"` | `"Info"` | `"InstagramLogo"` | `"Intersect"` | `"IntersectSquare"` | `"IntersectThree"` | `"Intersection"` | `"Invoice"` | `"Island"` | `"Jar"` | `"JarLabel"` | `"Jeep"` | `"JiraLogo"` | `"Joystick"` | `"Kanban"` | `"Key"` | `"KeyReturn"` | `"Keyboard"` | `"Keyhole"` | `"Knife"` | `"Ladder"` | `"LadderSimple"` | `"Lamp"` | `"LampPendant"` | `"Laptop"` | `"Lasso"` | `"LastfmLogo"` | `"Layout"` | `"Leaf"` | `"Lectern"` | `"Lego"` | `"LegoSmiley"` | `"LessThan"` | `"LessThanOrEqual"` | `"LetterCircleH"` | `"LetterCircleP"` | `"LetterCircleV"` | `"Lifebuoy"` | `"Lightbulb"` | `"LightbulbFilament"` | `"Lighthouse"` | `"Lightning"` | `"LightningA"` | `"LightningSlash"` | `"LineSegment"` | `"LineSegments"` | `"LineVertical"` | `"Link"` | `"LinkBreak"` | `"LinkSimple"` | `"LinkSimpleBreak"` | `"LinkSimpleHorizontal"` | `"LinkSimpleHorizontalBreak"` | `"LinkedinLogo"` | `"LinktreeLogo"` | `"LinuxLogo"` | `"List"` | `"ListBullets"` | `"ListChecks"` | `"ListDashes"` | `"ListHeart"` | `"ListMagnifyingGlass"` | `"ListNumbers"` | `"ListPlus"` | `"ListStar"` | `"Lock"` | `"LockKey"` | `"LockKeyOpen"` | `"LockLaminated"` | `"LockLaminatedOpen"` | `"LockOpen"` | `"LockSimple"` | `"LockSimpleOpen"` | `"Lockers"` | `"Log"` | `"MagicWand"` | `"Magnet"` | `"MagnetStraight"` | `"MagnifyingGlass"` | `"MagnifyingGlassMinus"` | `"MagnifyingGlassPlus"` | `"Mailbox"` | `"MapPin"` | `"MapPinArea"` | `"MapPinLine"` | `"MapPinPlus"` | `"MapPinSimple"` | `"MapPinSimpleArea"` | `"MapPinSimpleLine"` | `"MapTrifold"` | `"MarkdownLogo"` | `"MarkerCircle"` | `"Martini"` | `"MaskHappy"` | `"MaskSad"` | `"MastodonLogo"` | `"MathOperations"` | `"MatrixLogo"` | `"Medal"` | `"MedalMilitary"` | `"MediumLogo"` | `"Megaphone"` | `"MegaphoneSimple"` | `"MemberOf"` | `"Memory"` | `"MessengerLogo"` | `"MetaLogo"` | `"Meteor"` | `"Metronome"` | `"Microphone"` | `"MicrophoneSlash"` | `"MicrophoneStage"` | `"Microscope"` | `"MicrosoftExcelLogo"` | `"MicrosoftOutlookLogo"` | `"MicrosoftPowerpointLogo"` | `"MicrosoftTeamsLogo"` | `"MicrosoftWordLogo"` | `"Minus"` | `"MinusCircle"` | `"MinusSquare"` | `"Money"` | `"MoneyWavy"` | `"Monitor"` | `"MonitorArrowUp"` | `"MonitorPlay"` | `"Moon"` | `"MoonStars"` | `"Moped"` | `"MopedFront"` | `"Mosque"` | `"Motorcycle"` | `"Mountains"` | `"Mouse"` | `"MouseLeftClick"` | `"MouseMiddleClick"` | `"MouseRightClick"` | `"MouseScroll"` | `"MouseSimple"` | `"MusicNote"` | `"MusicNoteSimple"` | `"MusicNotes"` | `"MusicNotesMinus"` | `"MusicNotesPlus"` | `"MusicNotesSimple"` | `"NavigationArrow"` | `"Needle"` | `"Network"` | `"NetworkSlash"` | `"NetworkX"` | `"Newspaper"` | `"NewspaperClipping"` | `"NotEquals"` | `"NotMemberOf"` | `"NotSubsetOf"` | `"NotSupersetOf"` | `"Notches"` | `"Note"` | `"NoteBlank"` | `"NotePencil"` | `"Notebook"` | `"Notepad"` | `"Notification"` | `"NotionLogo"` | `"NuclearPlant"` | `"NumberCircleEight"` | `"NumberCircleFive"` | `"NumberCircleFour"` | `"NumberCircleNine"` | `"NumberCircleOne"` | `"NumberCircleSeven"` | `"NumberCircleSix"` | `"NumberCircleThree"` | `"NumberCircleTwo"` | `"NumberCircleZero"` | `"NumberEight"` | `"NumberFive"` | `"NumberFour"` | `"NumberNine"` | `"NumberOne"` | `"NumberSeven"` | `"NumberSix"` | `"NumberSquareEight"` | `"NumberSquareFive"` | `"NumberSquareFour"` | `"NumberSquareNine"` | `"NumberSquareOne"` | `"NumberSquareSeven"` | `"NumberSquareSix"` | `"NumberSquareThree"` | `"NumberSquareTwo"` | `"NumberSquareZero"` | `"NumberThree"` | `"NumberTwo"` | `"NumberZero"` | `"Numpad"` | `"Nut"` | `"NyTimesLogo"` | `"Octagon"` | `"OfficeChair"` | `"Onigiri"` | `"OpenAiLogo"` | `"Option"` | `"Orange"` | `"OrangeSlice"` | `"Oven"` | `"Package"` | `"PaintBrush"` | `"PaintBrushBroad"` | `"PaintBrushHousehold"` | `"PaintBucket"` | `"PaintRoller"` | `"Palette"` | `"Panorama"` | `"Pants"` | `"PaperPlane"` | `"PaperPlaneRight"` | `"PaperPlaneTilt"` | `"Paperclip"` | `"PaperclipHorizontal"` | `"Parachute"` | `"Paragraph"` | `"Parallelogram"` | `"Park"` | `"Password"` | `"Path"` | `"PatreonLogo"` | `"Pause"` | `"PauseCircle"` | `"PawPrint"` | `"PaypalLogo"` | `"Peace"` | `"Pen"` | `"PenNib"` | `"PenNibStraight"` | `"Pencil"` | `"PencilCircle"` | `"PencilLine"` | `"PencilRuler"` | `"PencilSimple"` | `"PencilSimpleLine"` | `"PencilSimpleSlash"` | `"PencilSlash"` | `"Pentagon"` | `"Pentagram"` | `"Pepper"` | `"Percent"` | `"Person"` | `"PersonArmsSpread"` | `"PersonSimple"` | `"PersonSimpleBike"` | `"PersonSimpleCircle"` | `"PersonSimpleHike"` | `"PersonSimpleRun"` | `"PersonSimpleSki"` | `"PersonSimpleSnowboard"` | `"PersonSimpleSwim"` | `"PersonSimpleTaiChi"` | `"PersonSimpleThrow"` | `"PersonSimpleWalk"` | `"Perspective"` | `"Phone"` | `"PhoneCall"` | `"PhoneDisconnect"` | `"PhoneIncoming"` | `"PhoneList"` | `"PhoneOutgoing"` | `"PhonePause"` | `"PhonePlus"` | `"PhoneSlash"` | `"PhoneTransfer"` | `"PhoneX"` | `"PhosphorLogo"` | `"Pi"` | `"PianoKeys"` | `"PicnicTable"` | `"PictureInPicture"` | `"PiggyBank"` | `"Pill"` | `"PingPong"` | `"PintGlass"` | `"PinterestLogo"` | `"Pinwheel"` | `"Pipe"` | `"PipeWrench"` | `"PixLogo"` | `"Pizza"` | `"Placeholder"` | `"Planet"` | `"Plant"` | `"Play"` | `"PlayCircle"` | `"PlayPause"` | `"Playlist"` | `"Plug"` | `"PlugCharging"` | `"Plugs"` | `"PlugsConnected"` | `"Plus"` | `"PlusCircle"` | `"PlusMinus"` | `"PlusSquare"` | `"PokerChip"` | `"PoliceCar"` | `"Polygon"` | `"Popcorn"` | `"Popsicle"` | `"PottedPlant"` | `"Power"` | `"Prescription"` | `"Presentation"` | `"PresentationChart"` | `"Printer"` | `"Prohibit"` | `"ProhibitInset"` | `"ProjectorScreen"` | `"ProjectorScreenChart"` | `"Pulse"` | `"PushPin"` | `"PushPinSimple"` | `"PushPinSimpleSlash"` | `"PushPinSlash"` | `"PuzzlePiece"` | `"QrCode"` | `"Question"` | `"QuestionMark"` | `"Queue"` | `"Quotes"` | `"Rabbit"` | `"Racquet"` | `"Radical"` | `"Radio"` | `"RadioButton"` | `"Radioactive"` | `"Rainbow"` | `"RainbowCloud"` | `"Ranking"` | `"ReadCvLogo"` | `"Receipt"` | `"ReceiptX"` | `"Record"` | `"Rectangle"` | `"RectangleDashed"` | `"Recycle"` | `"RedditLogo"` | `"Repeat"` | `"RepeatOnce"` | `"ReplitLogo"` | `"Resize"` | `"Rewind"` | `"RewindCircle"` | `"RoadHorizon"` | `"Robot"` | `"Rocket"` | `"RocketLaunch"` | `"Rows"` | `"RowsPlusBottom"` | `"RowsPlusTop"` | `"Rss"` | `"RssSimple"` | `"Rug"` | `"Ruler"` | `"Sailboat"` | `"Scales"` | `"Scan"` | `"ScanSmiley"` | `"Scissors"` | `"Scooter"` | `"Screencast"` | `"Screwdriver"` | `"Scribble"` | `"ScribbleLoop"` | `"Scroll"` | `"Seal"` | `"SealCheck"` | `"SealPercent"` | `"SealQuestion"` | `"SealWarning"` | `"Seat"` | `"Seatbelt"` | `"SecurityCamera"` | `"Selection"` | `"SelectionAll"` | `"SelectionBackground"` | `"SelectionForeground"` | `"SelectionInverse"` | `"SelectionPlus"` | `"SelectionSlash"` | `"Shapes"` | `"Share"` | `"ShareFat"` | `"ShareNetwork"` | `"Shield"` | `"ShieldCheck"` | `"ShieldCheckered"` | `"ShieldChevron"` | `"ShieldPlus"` | `"ShieldSlash"` | `"ShieldStar"` | `"ShieldWarning"` | `"ShippingContainer"` | `"ShirtFolded"` | `"ShootingStar"` | `"ShoppingBag"` | `"ShoppingBagOpen"` | `"ShoppingCart"` | `"ShoppingCartSimple"` | `"Shovel"` | `"Shower"` | `"Shrimp"` | `"Shuffle"` | `"ShuffleAngular"` | `"ShuffleSimple"` | `"Sidebar"` | `"SidebarSimple"` | `"Sigma"` | `"SignIn"` | `"SignOut"` | `"Signature"` | `"Signpost"` | `"SimCard"` | `"Siren"` | `"SketchLogo"` | `"SkipBack"` | `"SkipBackCircle"` | `"SkipForward"` | `"SkipForwardCircle"` | `"Skull"` | `"SkypeLogo"` | `"SlackLogo"` | `"Sliders"` | `"SlidersHorizontal"` | `"Slideshow"` | `"Smiley"` | `"SmileyAngry"` | `"SmileyBlank"` | `"SmileyMeh"` | `"SmileyMelting"` | `"SmileyNervous"` | `"SmileySad"` | `"SmileySticker"` | `"SmileyWink"` | `"SmileyXEyes"` | `"SnapchatLogo"` | `"Sneaker"` | `"SneakerMove"` | `"Snowflake"` | `"SoccerBall"` | `"Sock"` | `"SolarPanel"` | `"SolarRoof"` | `"SortAscending"` | `"SortDescending"` | `"SoundcloudLogo"` | `"Spade"` | `"Sparkle"` | `"SpeakerHifi"` | `"SpeakerHigh"` | `"SpeakerLow"` | `"SpeakerNone"` | `"SpeakerSimpleHigh"` | `"SpeakerSimpleLow"` | `"SpeakerSimpleNone"` | `"SpeakerSimpleSlash"` | `"SpeakerSimpleX"` | `"SpeakerSlash"` | `"SpeakerX"` | `"Speedometer"` | `"Sphere"` | `"Spinner"` | `"SpinnerBall"` | `"SpinnerGap"` | `"Spiral"` | `"SplitHorizontal"` | `"SplitVertical"` | `"SpotifyLogo"` | `"SprayBottle"` | `"Square"` | `"SquareHalf"` | `"SquareHalfBottom"` | `"SquareLogo"` | `"SquareSplitHorizontal"` | `"SquareSplitVertical"` | `"SquaresFour"` | `"Stack"` | `"StackMinus"` | `"StackOverflowLogo"` | `"StackPlus"` | `"StackSimple"` | `"Stairs"` | `"Stamp"` | `"StandardDefinition"` | `"Star"` | `"StarAndCrescent"` | `"StarFour"` | `"StarHalf"` | `"StarOfDavid"` | `"StatusActive"` | `"StatusArchived"` | `"StatusDisabled"` | `"StatusDraft"` | `"StatusTemplate"` | `"SteamLogo"` | `"SteeringWheel"` | `"Steps"` | `"Stethoscope"` | `"Sticker"` | `"Stool"` | `"Stop"` | `"StopCircle"` | `"Storefront"` | `"Strategy"` | `"StripeLogo"` | `"Student"` | `"SubsetOf"` | `"SubsetProperOf"` | `"Subtitles"` | `"SubtitlesSlash"` | `"Subtract"` | `"SubtractSquare"` | `"Subway"` | `"Suitcase"` | `"SuitcaseRolling"` | `"SuitcaseSimple"` | `"Sun"` | `"SunDim"` | `"SunHorizon"` | `"Sunglasses"` | `"SupersetOf"` | `"SupersetProperOf"` | `"Swap"` | `"Swatches"` | `"SwimmingPool"` | `"Sword"` | `"Synagogue"` | `"Syringe"` | `"TShirt"` | `"Table"` | `"Tabs"` | `"Tag"` | `"TagChevron"` | `"TagSimple"` | `"Target"` | `"Taxi"` | `"TeaBag"` | `"TelegramLogo"` | `"Television"` | `"TelevisionSimple"` | `"TennisBall"` | `"Tent"` | `"Terminal"` | `"TerminalWindow"` | `"TestTube"` | `"TextAUnderline"` | `"TextAa"` | `"TextAlignCenter"` | `"TextAlignJustify"` | `"TextAlignLeft"` | `"TextAlignRight"` | `"TextB"` | `"TextColumns"` | `"TextH"` | `"TextHFive"` | `"TextHFour"` | `"TextHOne"` | `"TextHSix"` | `"TextHThree"` | `"TextHTwo"` | `"TextIndent"` | `"TextItalic"` | `"TextOutdent"` | `"TextStrikethrough"` | `"TextSubscript"` | `"TextSuperscript"` | `"TextT"` | `"TextTSlash"` | `"TextUnderline"` | `"Textbox"` | `"Thermometer"` | `"ThermometerCold"` | `"ThermometerHot"` | `"ThermometerSimple"` | `"ThreadsLogo"` | `"ThreeD"` | `"ThumbsDown"` | `"ThumbsUp"` | `"Ticket"` | `"TidalLogo"` | `"TiktokLogo"` | `"Tilde"` | `"Timer"` | `"TipJar"` | `"Tipi"` | `"Tire"` | `"ToggleLeft"` | `"ToggleRight"` | `"Toilet"` | `"ToiletPaper"` | `"Toolbox"` | `"Tooth"` | `"Tornado"` | `"Tote"` | `"ToteSimple"` | `"Towel"` | `"Tractor"` | `"Trademark"` | `"TrademarkRegistered"` | `"TrafficCone"` | `"TrafficSign"` | `"TrafficSignal"` | `"Train"` | `"TrainRegional"` | `"TrainSimple"` | `"Tram"` | `"Translate"` | `"Trash"` | `"TrashSimple"` | `"Tray"` | `"TrayArrowDown"` | `"TrayArrowUp"` | `"TreasureChest"` | `"Tree"` | `"TreeEvergreen"` | `"TreePalm"` | `"TreeStructure"` | `"TreeStructureDown"` | `"TreeView"` | `"TrendDown"` | `"TrendUp"` | `"Triangle"` | `"TriangleDashed"` | `"Trolley"` | `"TrolleySuitcase"` | `"Trophy"` | `"Truck"` | `"TruckTrailer"` | `"TumblrLogo"` | `"TwitchLogo"` | `"TwitterLogo"` | `"Umbrella"` | `"UmbrellaSimple"` | `"Union"` | `"Unite"` | `"UniteSquare"` | `"Upload"` | `"UploadSimple"` | `"Usb"` | `"User"` | `"UserCheck"` | `"UserCircle"` | `"UserCircleCheck"` | `"UserCircleDashed"` | `"UserCircleGear"` | `"UserCircleMinus"` | `"UserCirclePlus"` | `"UserFocus"` | `"UserGear"` | `"UserList"` | `"UserMinus"` | `"UserPlus"` | `"UserRectangle"` | `"UserSound"` | `"UserSquare"` | `"UserSwitch"` | `"Users"` | `"UsersFour"` | `"UsersThree"` | `"Van"` | `"Vault"` | `"VectorThree"` | `"VectorTwo"` | `"Vibrate"` | `"Video"` | `"VideoCamera"` | `"VideoCameraSlash"` | `"VideoConference"` | `"Vignette"` | `"VinylRecord"` | `"VirtualReality"` | `"Virus"` | `"Visor"` | `"Voicemail"` | `"Volleyball"` | `"Wall"` | `"Wallet"` | `"Warehouse"` | `"Warning"` | `"WarningCircle"` | `"WarningDiamond"` | `"WarningOctagon"` | `"WashingMachine"` | `"Watch"` | `"WaveSawtooth"` | `"WaveSine"` | `"WaveSquare"` | `"WaveTriangle"` | `"Waveform"` | `"WaveformSlash"` | `"Waves"` | `"Webcam"` | `"WebcamSlash"` | `"WebhooksLogo"` | `"WechatLogo"` | `"WhatsappLogo"` | `"Wheelchair"` | `"WheelchairMotion"` | `"WifiHigh"` | `"WifiLow"` | `"WifiMedium"` | `"WifiNone"` | `"WifiSlash"` | `"WifiX"` | `"Wind"` | `"Windmill"` | `"WindowsLogo"` | `"Wine"` | `"WorkflowBuilderLogo"` | `"Wrench"` | `"X"` | `"XCircle"` | `"XLogo"` | `"XSquare"` | `"Yarn"` | `"YinYang"` | `"YoutubeLogo"`

Union of every icon name shipped with the SDK. Use it to constrain props that accept an icon (`icon: WBIcon`).

---

## 9. Videos

### Videos

*Source: `videos.mdx` — description: Video tutorials, walkthroughs, and conference talks from the Workflow Builder YouTube channel.*

Explore video tutorials, live demos, and conference talks from the [Workflow Builder YouTube channel](https://www.youtube.com/@workflowbuilder). Prefer to try it hands-on? [Open the live demo](https://app.workflowbuilder.io).

#### Getting Started

Start here if you're new to Workflow Builder.

- **Workflow Builder Demo** — See how to embed a production-ready workflow editor into your product. (YouTube `JA_8FOL7yVM`: https://www.youtube.com/watch?v=JA_8FOL7yVM)
- **Build Your Own Automation Platform** — Overview of the Workflow Builder SDK and how to build automation tools faster. (YouTube `MBqu_soMCSA`: https://www.youtube.com/watch?v=MBqu_soMCSA)
- **How to Add a New Custom Node** — Step-by-step guide to extending Workflow Builder with custom node types. (YouTube `v0Oy4VIAMok`: https://www.youtube.com/watch?v=v0Oy4VIAMok)

#### Design & Customization

Learn how to customize the look and architecture of your workflow editor.

- **Design System Walkthrough** — Explore the built-in design system and how to customize it for your brand. (YouTube `q2IiQh2uDEA`: https://www.youtube.com/watch?v=q2IiQh2uDEA)
- **Zero-Styling Development** — Automated design-to-code workflow with CSS tokens. (YouTube `4-qdEeEbvjI`: https://www.youtube.com/watch?v=4-qdEeEbvjI)
- **Plug and Play Design** — Modular React and plugin architecture for flexible UI composition. (YouTube `n3cMkcjoxsk`: https://www.youtube.com/watch?v=n3cMkcjoxsk)

#### Talks & Live Coding

Conference presentations and live coding sessions.

- **Workflow Builder at React Summit 2025** — Meet Workflow Builder during React Summit 2025 in Amsterdam. (YouTube `604iC5HIuGQ`: https://www.youtube.com/watch?v=604iC5HIuGQ)
- **Building a Workflow App with React Flow** — React Summit 2025 talk on building workflow apps with WB SDK and React Flow. (YouTube `wjt9keRw07A`: https://www.youtube.com/watch?v=wjt9keRw07A)
- **Building AI Workflow Editor UI** — Live coding session building an AI workflow editor with React Flow and WB SDK. (YouTube `aCBoYK-pwno`: https://www.youtube.com/watch?v=aCBoYK-pwno)

#### See also

- [What is Workflow Builder?](/overview/) - what Workflow Builder is and who embeds it
- [Quick Start: Standalone App](/get-started/quick-start/standalone-app/) - run Workflow Builder as a self-hosted React app

Didn't find what you were looking for? [Reach out to us](https://www.workflowbuilder.io/contact) and we'll help you out.

---

## 10. FAQ

### FAQ

*Source: `faq.md` — description: Frequently asked questions about Workflow Builder for developers.*

> **⚠️ main only — `isStartNode` does not exist in `@workflowbuilder/sdk@2.3.0`.** This page refers to `isStartNode` in prose and/or inside a saved-diagram JSON payload — not as TypeScript typed against the SDK, so nothing here would fail to compile. But the field is absent from 2.3.0: `grep isStartNode dist/index.d.ts` returns nothing, and the editor built from 2.3.0 neither writes nor preserves it.

#### General

1. **What is Workflow Builder?**
   Workflow Builder is a frontend SDK for building visual workflow editors inside your own product. It lets you embed a drag-and-drop workflow designer into your SaaS while keeping execution, pricing, and business logic fully in your backend.

2. **Is Workflow Builder a product or an SDK?**
   It is a white-label SDK, not a standalone SaaS product. You receive source code that becomes part of your application and can be customized to your domain.

3. **Who is Workflow Builder for?**
   Workflow Builder is built for SaaS companies adding workflow capabilities, AI/automation product teams, and engineering teams building visual configuration tools. It is not for end users looking for a ready-made automation tool.

4. **Why use Workflow Builder instead of building a workflow editor ourselves?**
   Building a basic drag-and-drop canvas takes days. Turning it into a production-ready workflow editor takes months. The complexity hides in details that only surface during real usage:
   - Edge routing that avoids overlapping nodes
   - Undo/redo across node moves, property edits, and connection changes
   - Keyboard shortcuts and accessibility (WCAG compliance)
   - State management that stays performant at hundreds of nodes
   - Serialization and deserialization with schema validation
   - A properties panel driven by configuration, not hardcoded per node type

   Workflow Builder ships all of this out of the box. You skip the infrastructure work and go straight to building the nodes and logic that are specific to your product.

5. **How is Workflow Builder different from n8n, Make, or Zapier?**
   n8n, Make, and Zapier are SaaS platforms with hosted execution for running workflows as a service. Their frontends are tightly coupled to their execution engines, databases, and APIs. You cannot extract the visual editor as a standalone component.

   Workflow Builder is a frontend SDK designed for teams that need an embedded workflow editor to build their own automation or AI-powered products. It serializes workflows to JSON that your execution engine consumes however you choose. There is no database and no runtime. The Community Edition is licensed under Apache 2.0. The Enterprise Edition uses a perpetual commercial license. Both editions allow embedding in your own product.

   If you need an embeddable editor inside your own product with your own execution layer, Workflow Builder gives you that without inheriting another product's architecture.

6. **How does Workflow Builder relate to React Flow?**
   Workflow Builder is built on top of [React Flow](https://reactflow.dev/) (@xyflow/react). It extends React Flow with a production-ready workflow editor layer: a node library, schema-driven properties panel, design system, serialization, and plugin architecture.

   If you've evaluated React Flow directly, Workflow Builder is the answer to "what would it take to turn React Flow into a shippable workflow editor." You keep full access to React Flow's API underneath - custom node renderers, viewport controls, edge routing - while starting from a complete editor rather than a blank canvas.

7. **What does the workflow JSON output look like?**
   Workflows serialize to a flat JSON structure with four fields:

   ```json
   {
     "name": "My Workflow",
     "layoutDirection": "DOWN",
     "nodes": [
       {
         "id": "440ccd46-...",
         "type": "node",
         "position": { "x": 18, "y": 144 },
         "data": {
           "properties": {
             "label": "Start Workflow",
             "title": "Trigger",
             "subtitle": "Initiate workflows"
           },
           "type": "trigger",
           "icon": "Lightning",
           "isStartNode": true
         }
       }
     ],
     "edges": [
       {
         "source": "440ccd46-...",
         "target": "da47caa9-...",
         "type": "labelEdge",
         "data": { "label": "Our website" }
       }
     ]
   }
   ```

   Node and edge types follow React Flow conventions. The `data.properties` object is where your custom per-node configuration lives - it maps directly to whatever your execution engine expects. The optional `data.isStartNode` flag marks the node your run begins at, so your engine can find the entry point without inferring it from the graph shape or matching on a node type.

8. **How do I add custom nodes?**
   Custom nodes are React components registered via a JSON Schema definition. The schema drives the properties panel automatically - you define fields, validation rules, and defaults, and Workflow Builder generates the configuration UI. See the [Add Custom Node Type](/guides/add-a-custom-node/) guide for a step-by-step tutorial.

9. **How customizable is the UI?**
   Workflow Builder is a fully white-label SDK, so you can adjust:
   - Colors, typography, layout
   - Dark / light mode
   - Node visuals
   - Panels and controls

   Once embedded, Workflow Builder can look and feel like your branded product.

10. **Can Workflow Builder support AI agents?**
    Yes. Workflow Builder is execution-agnostic - each node in the visual diagram maps directly to a step your backend processes. Teams use it to design agent pipelines, prompt chains, decision trees, and tool-calling flows. You define custom node types for your AI operations (LLM calls, retrieval steps, tool use) and Workflow Builder handles the visual modeling and configuration UI. Execution, retries, and orchestration stay in your backend.

#### Technical

11. **How do I install Workflow Builder?**
    Workflow Builder is not distributed as an npm package. You receive access to the source repository and clone it directly. See the [Quick Start](/get-started/quick-start/standalone-app/) guide.

12. **What technologies and libraries are used?**
    Workflow Builder is built on a modern, modular tech stack:
    - **`@workflowbuilder/ui`** - our component library (built on the headless Base UI) for customizable, accessible UIs.
    - **JSONForms** - enables dynamic creation of node properties through JSON Schema.
    - **React** - the frontend library for building the editor UI.
    - **Zustand** - lightweight state management, integrated with React Flow.
    - **React Flow (xyflow)** - the diagramming library for the canvas.

13. **Can workflows be created programmatically?**
    Yes. Because workflows are JSON, you can generate, modify, and version them programmatically via your APIs.

14. **How many nodes can the canvas handle?**
    For most workflow editors - up to a few hundred nodes - no special optimization is needed. Complex automation diagrams work well up to approximately 500 nodes.

    Performance depends on node complexity, edge count, routing strategy, and browser capability.

15. **Does Workflow Builder send data to external servers?**
    No. Workflow Builder is a frontend SDK that runs entirely in your application. It does not collect telemetry or send workflow data to any external server. All data stays within your infrastructure.

    This makes it suitable for environments with strict data residency requirements - healthcare, finance, government - where no third-party data processing is acceptable.

16. **Can the canvas, nodes, and panels be used independently?**
    Yes. Workflow Builder is built as a set of composable React components, not a monolithic application. You can use the canvas with your own sidebar, replace the properties panel with a custom implementation, or embed only specific components into an existing layout.

    Since you have the source code, you control which parts to use and which to replace. The plugin architecture provides defined extension points without requiring you to modify core components.

17. **What do we need to develop ourselves?**
    Workflow Builder handles the visual editor. You are responsible for building the execution engine, scheduling and retries, billing and limits, permissions logic, and AI calls and integrations.

#### Updates and Versioning

18. **What happens when a new major version is released?**
    Your integration does not break when we release a new version. You own the source code - it is in your repository, not pulled from a registry. New releases are delivered as source updates that you can review, diff, and adopt at your own pace.

    If you have customized nodes, styles, or plugins, those changes live in your codebase and are unaffected by our releases. When you choose to upgrade, you merge our changes into your fork the same way you would handle any dependency update - with full visibility into what changed.

19. **How do I prevent users from breaking production workflows?**
    Workflow Builder gives you the building blocks; safeguards are implemented on your side. Common patterns teams use:
    - Draft vs production environments
    - Workflow locking and versioning
    - Role-based permissions controlling who can edit or publish
    - Backend validation before execution

    Because you own the source code and the execution layer, you decide which guardrails fit your product.

#### Licensing

20. **What types of licenses do you offer?**
    Workflow Builder is available under two licensing models. Full ownership - OSS or perpetual license.
    - **Community Edition** - open source under the Apache 2.0 license, which allows commercial use.
    - **Enterprise Edition** - a production-ready, fully supported version built for organizations that need reliability, performance, and long-term scalability. Includes advanced features, dedicated support, customization options, and integration paths for real-world systems.

    This allows teams to start with the open-source edition and upgrade when their product requires advanced capabilities or enterprise support.

21. **Do we own the source code?**
    Yes. You can modify, extend, and maintain it.

22. **Is pricing subscription-based or one-time?**
    Enterprise is a one-time license fee (EUR 6,990). Community is free under Apache 2.0.

23. **Are there any usage limits or revenue sharing?**
    No built-in limits. No revenue sharing.

24. **Can we resell Workflow Builder as part of our SaaS?**
    Yes, under the commercial license.

25. **Is there a free trial or demo?**
    Yes — [open the live demo](https://app.workflowbuilder.io) to try it in your browser, or [contact us](https://www.workflowbuilder.io/contact) for a guided walkthrough.

#### See also

- [What is Workflow Builder?](/overview/) - what Workflow Builder is and who embeds it
- [Quick Start: Standalone App](/get-started/quick-start/standalone-app/) - run Workflow Builder as a self-hosted React app
- [Plugins](/plugins/) - optional plugins that extend Workflow Builder

---

## 11. Coverage, and what could not be read

### Read in full

- **74 content pages** from `apps/docs/src/content/docs/**` in the clone — every `.md` and
  `.mdx` file in the directory, nothing skipped. Verified mechanically: every fenced code block
  in this file is byte-identical to the source (0 files with a code-fence mismatch).
- **134 API reference pages** from the live site.

### Could not be read

| Page / data | Why |
| --- | --- |
| `/docs/api/core/`, `/docs/api/plugins/`, `/docs/api/components/`, `/docs/api/hooks/`, `/docs/api/store/`, `/docs/api/listeners/`, `/docs/api/forms/`, `/docs/api/integration/`, `/docs/api/types/`, `/docs/api/utilities/`, `/docs/api/constants/`, `/docs/api/i18n/`, `/docs/api/icons/` | **HTTP 404** — these 13 are sidebar group labels, not pages. No content was lost; every symbol page under them was fetched. |
| Any API symbol added on `main` after the live build | The clone has no `node_modules`, so `starlight-typedoc` could not be re-run to generate `main`'s API pages. Only `main`'s barrel (`packages/sdk/src/index.ts`) was diffable — that is how drift #2 was found. |
| UI Library prop tables and CSS-variable tables | Generated at docs-build time from `@workflowbuilder/ui` TypeDoc JSON. Not in the repo, and the section 404s live. |
| Built-in node Schemas tabs (UI Schema / Data Schema JSON) | Rendered from `apps/demo/src/app/data/nodes/*/{schema,uischema}.ts` at docs-build time. Demo-app source, not page content. |

### Method notes

- Appending `.md` to a docs URL **does not work** on this site — `…/paletteitem.md` returns the
  Azure Static Web Apps 404 page, as does `/docs/sitemap.md`. The API pages were fetched as HTML
  and converted with a linkedom-based walker; code blocks were reassembled from Expressive
  Code's `div.ec-line` elements (not `span.line`), which is what preserves blank lines inside
  examples.
- Live-site paths are lowercase: `/docs/api/types/paletteitem/` is 200, `/docs/api/Types/PaletteItem/` is 404.
