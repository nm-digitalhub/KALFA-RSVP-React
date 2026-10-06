> מקור: https://www.workflowbuilder.io/docs/api/
> נשמר: 2026-09-09

# API Reference

Auto-generated reference for every public export from @workflowbuilder/sdk.

This section is the **auto-generated reference** for every public export from `@workflowbuilder/sdk`. Each page is built from the TSDoc comment on the source declaration — when the SDK changes, these pages change with it.

For walkthroughs, integration patterns, and design rationale, see the hand-written [Get Started](https://www.workflowbuilder.io/docs/get-started/quick-start/wb-as-react-component/) and [Guides](https://www.workflowbuilder.io/docs/guides/) sections instead. They explain how to use the editor; this reference catalogs every symbol the SDK exposes.

## Categories
````````````````````````````````````````````````````````
| Section | What’s in it |
|---|---|
| Core | WorkflowBuilder compound component, WorkflowBuilderRoot, and the props / plugin / integration types it accepts. |
| Plugins | The three register* extension points + their option types. |
| Components | UI building blocks — edge / node primitives, plus *Props types you reach for when typing decorators on built-in slots (DiagramContainerProps, PropertiesBarProps, …). |
| Hooks | React hooks (useStore selectors, useFitView, change-tracker, …). |
| Store | One-shot store accessors (getStoreNodes / setStoreNodes, selection helpers, openModal). |
| Listeners | Diagram event hooks — addNodeChangedListener, addNodeDragStartListener and their pairs. |
| Forms | Form-authoring helpers (getScope, DynamicCondition) + re-exported JsonForms primitives for custom renderers (withJsonForms*Props, testers, ControlProps, …). |
| Integration | Persistence-strategy types and save-callback shapes. |
| Types | Domain types — NodeData, NodeSchema, UISchema, PaletteItem, … |
| Utilities | Reusable schema fragments + small helpers (getHandleId, sharedProperties, DeepPartial). |
| Constants | Edge-routing constants and reserved keys. |
| i18n | TranslationKey for type-safe t(...) calls. |
| Icons | Icon component + WBIcon name union. |

## How this is generated

The pages in this section are produced by [`starlight-typedoc`](https://starlight-typedoc.vercel.app) at `astro build` time. Source: [packages/sdk/src/index.ts](https://github.com/synergycodes/workflowbuilder/blob/master/packages/sdk/src/index.ts) (the SDK’s curated barrel) and the TSDoc comments on every declaration it re-exports.

Strict mode is on — adding a new public export to the barrel without a TSDoc comment **fails the docs build**. So if you’re reading this page and a symbol you expect isn’t here, that’s a bug, not an oversight: please file an issue.
