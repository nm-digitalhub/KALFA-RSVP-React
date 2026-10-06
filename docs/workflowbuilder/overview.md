> מקור: https://www.workflowbuilder.io/docs/overview/
> נשמר: 2026-09-09

# What Is Workflow Builder?

Workflow Builder is a React SDK that gives you a production-ready workflow editor on day one. Embed drag-and-drop workflow UIs into your product. Open-source Community Edition available.

![Workflow Builder - canvas, node palette, and properties panel](https://www.workflowbuilder.io/docs/_astro/wb-overview._nn89qL3_Z25StCt.webp)
Workflow Builder is a React SDK for building and embedding visual workflow editors into your application. It is available in open-source and enterprise editions.

It provides a ready-made workflow editor UI, including canvas, nodes, edges, layout, forms, and configuration panels, so you don’t have to build workflow UX from scratch.

Workflow Builder focuses exclusively on the **frontend editor layer**. Execution, orchestration, and business logic remain fully under your control.

Ready to try it? Start with the [Quick Start guide](https://www.workflowbuilder.io/docs/get-started/quick-start/standalone-app/).

## Key features

- Visual workflow canvas with drag-and-drop interactions

- [Node library](https://www.workflowbuilder.io/docs/overview/features/node-library/) with triggers, actions, conditions, branching, and delays

- [Dynamic properties panel](https://www.workflowbuilder.io/docs/overview/features/properties-sidebar/) driven by JSON Schema

- [Auto-save](https://www.workflowbuilder.io/docs/overview/features/diagram-state-management/) to local storage or external API

- Read-only mode for viewing without edit permissions

- [Flow Runner](https://www.workflowbuilder.io/docs/plugins/flow-runner/) for graph traversal and step-by-step execution

- Zoom in / out for navigating workflows at any scale

- [Auto-layout](https://www.workflowbuilder.io/docs/plugins/elk-layout/) for automatic node and edge positioning

- [Smart edge routing](https://www.workflowbuilder.io/docs/plugins/avoid-nodes-edges/) that avoids collision with nodes

- [Edge reshaping](https://www.workflowbuilder.io/docs/plugins/reshapable-edges/) for fine-tuning connection paths on the canvas

## Scope

Workflow Builder focuses exclusively on the frontend editor layer. The SDK outputs workflow definitions as JSON that your own backend consumes and executes. For in-editor execution, the optional [Flow Runner](https://www.workflowbuilder.io/docs/plugins/flow-runner/) plugin (Enterprise) can traverse the workflow graph and run node functions directly.

## Typical use cases

Workflow Builder is commonly used to:

- embed workflow editors into B2B SaaS products

- build visual rule engines and configuration tools

- design AI agent and automation workflow platforms

- serve as a foundation for workflow-driven products and standalone apps

## Live demo

[Open the live demo](https://app.workflowbuilder.io) to try Workflow Builder in your browser, or [contact us](https://www.workflowbuilder.io/contact) for a guided walkthrough.

## See also

- [Architecture](https://www.workflowbuilder.io/docs/overview/architecture/) - tech stack, monorepo layout, plugin system, data model

- [Built-in Nodes](https://www.workflowbuilder.io/docs/nodes/) - all built-in node types

- [Plugins](https://www.workflowbuilder.io/docs/plugins/) - optional plugins that extend Workflow Builder

- [Videos](https://www.workflowbuilder.io/docs/videos/) - walkthroughs and live coding sessions

- [FAQ](https://www.workflowbuilder.io/docs/faq/) - frequently asked questions

[Next Diagram State Management](https://www.workflowbuilder.io/docs/overview/features/diagram-state-management/)
