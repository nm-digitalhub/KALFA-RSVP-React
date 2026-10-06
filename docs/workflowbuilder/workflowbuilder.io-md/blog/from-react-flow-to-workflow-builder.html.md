# Workflow Builder - From React Flow to Workflow Builder: what you keep, and what you gain

Workflow Builder is a React SDK built on React Flow (`@xyflow/react`) – a superset, not a replacement. If you have built on React Flow, the worry is fair: does a higher-level SDK take away the control you have today? It does not. Workflow Builder is a layer on top of React Flow, not a fork; the canvas underneath is still `<ReactFlow>`, and React Flow stays a peer dependency you install and own.

Anything you can do in React Flow, you can still do in Workflow Builder. On top, you get the editor layer you would otherwise build yourself – a properties panel, undo / redo, a node palette, persistence, and more.

## Can you still do everything you did in React Flow?

Yes. Almost everything you reach for in a React Flow editor works the same way inside Workflow Builder, because React Flow is still doing the work. Here is how the common building blocks map across:

What you do in React Flow

Status

In Workflow Builder

Render custom nodes

This changes

Start from 7 built-in node templates (trigger, action, conditional, decision, delay, notification, AI agent), or write your own as a node template with a schema for its data

Build custom edges (`EdgeProps`)

Same as React Flow

`EdgeProps` straight from React Flow, plus ready components like labeled and self-connecting edges

Configure the canvas and handle events (zoom, pan, fit view, `onNodeClick`, `onPaneClick`)

Same as React Flow

Props pass straight through to the underlying `<ReactFlow>`

Manage graph state (read and update)

This changes

Workflow Builder sits above React Flow and owns its state – the SDK store is the source of truth, and you read and update the graph through it. React Flow's hooks (`useReactFlow`, `useNodes`) stay available for reading and inspecting the live canvas

Build the core editor layer yourself

New in WB

A node library, a schema-driven properties panel, a drag-and-drop palette, read-only mode, and typed persistence (localStorage, REST, or callback)

Wire up editor basics yourself

New in WB

Undo / redo and copy / paste ship as free, open plugins on the public plugin API

Graph state is the one area that works differently. Workflow Builder runs React Flow in controlled mode and owns the graph in its own store, so the store is the source of truth: you read and update the graph through the SDK's actions. React Flow's hooks still return the live canvas state for reads and inspection, but the store – not direct `nodes` / `edges` mutation – is how you drive changes. Keeping state in a dedicated store is also a performance choice: it follows the patterns Synergy Codes' [guide to optimizing React Flow performance](https://www.synergycodes.com/webbook/guide-to-optimize-react-flow-project-performance) recommends for keeping larger graphs responsive.

Everything else passes through. You hand React Flow props to Workflow Builder, and they land on the underlying canvas untouched. When you build nodes, edges, or plugins, you still import `Handle`, `Position`, and `EdgeProps` from `@xyflow/react` – same package, same docs, same upgrade path. And when you need the raw canvas API for something the SDK does not surface, it is still reachable.

## What you gain on top

Workflow Builder adds the layer React Flow deliberately leaves to you – the part that turns a working canvas into a product. React Flow gives you a fast, flexible renderer. It does not give you a properties panel, history, or a palette, because those are application concerns. That is precisely the layer you would build by hand, and it is what Workflow Builder ships ready.

The table above lists what that layer includes. What a list cannot show is why each piece is worth having ready – most of it is work that looks small and turns out not to be:

-   **A node library** – the built-in node types (trigger, action, conditional, decision, delay, notification, AI agent) mean you are not modeling and styling the common workflow primitives from zero. You extend or replace them instead of inventing them.
-   **A schema-driven properties panel** – one schema drives the form, its validation, and the node's data shape, so they stay in sync as nodes evolve instead of drifting apart across three hand-maintained places.
-   **Undo / redo** – history is one of those features that looks simple and rarely is. You get a working implementation, built on a public change-tracking primitive, to keep as-is, swap for your own model, or drop.
-   **A node palette** – a ready drag-and-drop panel for adding nodes to the canvas, already connected to the store so dropped nodes land in the graph correctly.
-   **Read-only mode** – locking the canvas for viewers while keeping full inspection is state you would otherwise thread through every interaction by hand.
-   **A typed workflow document** – instead of persisting loose JSON and hoping it loads back correctly, the graph has one canonical, typed shape, older formats are migrated forward, and saving to localStorage, a REST endpoint, or a callback is a thin adapter on top.

React Flow renders a canvas but leaves the surrounding UI to you. Workflow Builder ships the same component library and design system it is built on, so the editor and the controls around it share one consistent look out of the box. It is fully tokenized, with theming and white-label support, so you can override tokens to make the editor match the app it is embedded in. That is polish React Flow leaves entirely to you.

The layer is **plugin-first**: optional features register through a public plugin API and can be added or removed without breaking the editor. The same plugin surface that builds the reference undo / redo also lets you add toolbar buttons, inject UI into known slots, and ship your own translations.

This is not theoretical. The demo app ships two full, open plugins built on the public plugin API – [copy / paste and undo / redo](https://github.com/synergycodes/workflowbuilder/tree/main/apps/demo/src/app/plugins) – which prove the plugin API works and show the pattern you'd follow for your own. Heavier diagram operations – smart edge routing and node avoidance, edge reshaping, ELK auto-layout, and PDF export – are Enterprise features delivered through Overflow, and the other folders in the demo are placeholders.

Some of the heavier features sit in the Enterprise Edition, and it is worth being clear about the line. The open SDK exposes layout-direction control and fit-view helpers. Production-grade **ELK auto-layout**, **smart edge routing**, on-canvas **edge reshaping**, **PDF export**, and an in-browser **flow runner** are delivered through Overflow in the [Enterprise Edition](https://www.workflowbuilder.io/blog/edge-routing-in-workflow-editors-technical-deep-dive). Either way, React Flow stays the renderer underneath – these features layer on top, they do not replace it.

So the trade is the opposite of the one developers fear. You keep React Flow's full range, and you add the editor features that are surprisingly hard to build well. If something is possible in React Flow, it is possible in a Workflow Builder editor – plus a great deal you would otherwise build yourself.

## When does moving from React Flow to Workflow Builder make sense?

A React Flow prototype that works eventually has to [become a product](https://www.workflowbuilder.io/blog/from-react-flow-templates-to-production-when-a-workflow-editor-becomes-a-real-product-feature) – and that is when the properties panel, undo / redo, palette, and persistence stop being nice-to-haves. The choice at that point is whether to build the editor layer around React Flow yourself or start from one that already exists.

Adopting Workflow Builder does not mean rebuilding the canvas. It does mean changing where two things live. You mount `<WorkflowBuilder.Root>` instead of rendering `<ReactFlow>` yourself, and graph state moves into the SDK store. Your edge components carry over unchanged. Your custom nodes are rewritten as node templates, with their data described as a schema – that is the real migration work, and it is honest to call it work. What transfers is your React Flow knowledge; what changes is where the nodes and state live.

Because the SDK sits on React Flow instead of forking it, you are not locked in. React Flow stays underneath, the raw canvas stays reachable, and you keep its API and upgrade path. Backing out still means unwinding the node and state changes you made, but you are building on the library you already know, not a fork you would have to escape.

[Workflow Builder](https://www.workflowbuilder.io/) is a production-ready React SDK for embedding visual workflow editors, built by Synergy Codes on top of React Flow. It ships as Community Edition (open source, Apache 2.0) and Enterprise Edition, and the team spent the [14–25 weeks of canvas work](https://www.workflowbuilder.io/blog/build-vs-buy-workflow-editor-hidden-cost-react-flow) so you can start from the layer above. If you are weighing a React Flow workflow editor against building one from scratch, that head start is the whole point.

The open-source Community Edition is a solid start on its own, and enough to ship many editors. If you are building something more complex, Synergy Codes also runs [discovery workshops](https://www.workflowbuilder.io/consulting) to shape the product with your team – optional help, not a prerequisite for using the SDK.

FAQ

-   What is Workflow Builder built on?
    
    Workflow Builder is a React SDK built on React Flow (`@xyflow/react`), kept as a peer dependency. You install React Flow yourself, and the SDK mounts its editor inside React Flow's own provider, so it extends React Flow rather than replacing it.
    
-   Is Workflow Builder a replacement for React Flow?
    
    No. Workflow Builder is a superset: it adds a workflow editor layer on top of React Flow without taking anything away. When you use Workflow Builder, React Flow still handles the canvas. You can read the [Workflow Builder vs React Flow comparison](https://www.workflowbuilder.io/compare/react-flow) for the build-vs-buy view.
    
-   Do React Flow hooks and props still work?
    
    Yes. React Flow hooks such as `useReactFlow` and `useNodes` behave as they do in a plain React Flow app, and React Flow props pass through to the underlying canvas. The main difference is that you update the graph through the SDK store instead of mutating `nodes` and `edges` directly.
    
-   What do you gain over plain React Flow?
    
    A ready editor layer: a schema-driven properties panel, undo / redo, a drag-and-drop node palette, a typed workflow document, and a plugin system for extending the editor. These are the features you would otherwise build by hand on top of the canvas.
    
-   What does it take to move an existing React Flow app to Workflow Builder?
    
    You mount `<WorkflowBuilder.Root>` instead of rendering `<ReactFlow>`, and graph state moves into the SDK store. Edge components carry over unchanged. Custom nodes are rewritten as node templates with their data described as a schema. React Flow stays underneath, so you keep its API and upgrade path rather than being locked into a fork.
    
-   Can I still reach the raw React Flow canvas when I need to?
    
    Yes. Workflow Builder forwards React Flow props to the underlying canvas, so the lower-level API stays available for cases the SDK does not surface directly.
    

Frontend Engineer at Synergy Codes, specializing in interactive diagramming interfaces and visual process editors. Builds workflow editors, diagram canvases, and node-based UIs for B2B products with 7+ years of hands-on experience in React, Angular, TypeScript, and diagramming libraries like GoJS. A committed Claude Code power user and enthusiastic token spender, applying AI-assisted workflows to ship frontend features faster.

## Articles you might be interested in

## A clean core, everything else a plugin: how Workflow Builder stays extensible

Undo/redo, auto-layout, edge routing, even workflow execution – every headline feature in Workflow Builder ships as a plugin on the same public API you get for your own code. Here's how that works, and why.

Aug 3, 2026

## LangGraph vs LangChain: which one for production agents?

Choosing between LangGraph and LangChain for production agents? Discover when to use LangChain's create\_agent loop and when explicit graph state is required.

Jul 30, 2026

## Best AI agent frameworks in 2026: a comparison for production teams

Comparing the best AI agent frameworks in 2026: LangGraph, CrewAI, Microsoft Agent Framework, OpenAI Agents SDK, and Mastra. Evaluate state management, HITL, and stack-fit for production.

Jul 30, 2026