> מקור: https://www.workflowbuilder.io/docs/plugins/
> נשמר: 2026-09-09

# Plugins Overview

Optional plugins that extend Workflow Builder with auto-layout, edge routing, copy-paste, PDF export, flow execution, and more.

Workflow Builder uses a plugin system to keep the core lightweight while offering powerful optional features. Each plugin can be enabled with a single import and removed without breaking anything. Only the plugins you use end up in the bundle.

| Plugin | What it does |
|---|---|
| Undo / Redo | Session history. Step backwards and forwards through edits |
| Copy & Paste | Cut, copy, and paste nodes and edges with keyboard shortcuts |
| Avoid Nodes & Edges | Automatic orthogonal edge routing around nodes (WASM + Worker) |
| Auto Layout | One-click node arrangement powered by the ELK layout engine |
| Reshapable Edges | Drag handles on edges to manually adjust connection paths |
| Widgets | Attach rich content blocks directly on node cards |
| Flow Runner | Reference implementation: parse and execute a workflow diagram |
| Validation | Diagram-based validation for JSON forms. |
| Download PDF | Export the current diagram as a PDF file |

## What you can do with plugins

Plugins can hook into almost every part of the editor without touching core code:

- **Toolbar and app bar** - add buttons, controls, or status indicators

- **Diagram canvas** - register custom edge types, inject content inside nodes, wrap the React Flow container

- **Properties panel** - add tabs, sections, or controls to the node/edge properties sidebar

- **Node palette and templates** - extend the node library with new node types or pre-built workflow templates

- **Menu items** - add entries to the three-dot control menu

- **State tracking** - observe and react to diagram changes (e.g. for undo/redo or analytics)

- **Translations** - register i18n strings so plugins work in all supported languages

The plugin system is fully extensible. You can build your own plugins using the same API the built-in ones use.

## See also

- [Architecture](https://www.workflowbuilder.io/docs/overview/architecture/) - tech stack, monorepo layout, plugin system, data model

- [Built-in Nodes](https://www.workflowbuilder.io/docs/nodes/) - all built-in node types

Some plugins require the Enterprise license. [Contact us](https://www.workflowbuilder.io/contact) to request a guided demo or discuss licensing.

[Previous AI Agent](https://www.workflowbuilder.io/docs/nodes/ai-agent/)
[Next Undo / Redo](https://www.workflowbuilder.io/docs/plugins/undo-redo/)
