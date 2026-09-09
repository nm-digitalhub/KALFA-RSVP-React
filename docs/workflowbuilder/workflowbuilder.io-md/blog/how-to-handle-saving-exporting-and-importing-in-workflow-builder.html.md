# Workflow Builder - How to handle saving, exporting, and importing in Workflow Builder

Various demos lead to the same question: _“Why can’t I save or export this workflow?”_ The buttons are there, but nothing happens — surely something’s broken?

Here’s the truth: nothing is broken. Workflow Builder isn’t hiding functions behind a paywall or burying them in obscure menus. What you’re seeing is **deliberate design**. Workflow Builder is a **frontend-first SDK**. It gives you the editor, the drag-and-drop canvas, and the JSON definition of a workflow. What it doesn’t do is store, execute, or export for you.

This is not a limitation but a feature. By leaving persistence and execution to your backend, Workflow Builder stays **backend-agnostic**. It avoids locking you into a single system and instead ensures you can integrate it with _any_ backend, database, or orchestration engine.

So let’s break down how saving, exporting, and importing really work — and why this architecture is an advantage, not a gap.

## **Workflow Builder’s frontend-first design**

Workflow Builder is built on **React and React Flow**. It’s responsible for everything the user sees: the canvas, the nodes, the connections, the property sidebar. But behind the scenes, every diagram translates into **JSON**.

That JSON includes:

-   The nodes on the canvas.
-   Their properties (labels, fields, dropdowns).
-   The connections linking them.

That JSON is your integration contract. It’s precise, lightweight, and easy to parse.

And because Workflow Builder is **backend-agnostic**, it doesn’t ship with a fixed database or execution layer. Instead, it hands the JSON back to you. You choose whether to push it into PostgreSQL, MongoDB, or S3. You decide whether it gets executed by Prefect, LangFlow, or your own Node.js API.

This split sometimes makes newcomers uneasy — they expect the frontend to “just save” for them. But that expectation is backwards. By not dictating storage or execution, Workflow Builder stays flexible enough to serve ERP systems, AI platforms, HR tech, and everything in between.

**Key takeaway:** workflows are always JSON first. Everything else — storage, orchestration, versioning — lives in your stack.

### Saving workflows

The most basic question: _how do I save what I’ve built?_

#### How saving works in practice

-   **Frontend:** every time a workflow changes, Workflow Builder generates a JSON representation.
-   **Backend:** it’s your job to take that JSON and persist it — in a relational database, in object storage, or even in a document store.

In the demo app, the “save” button is just a placeholder. It writes to local storage, showing that JSON exists, but it’s not real persistence. In production, your backend must catch that JSON and store it properly.

#### Why this matters

This pattern is powerful because it avoids assumptions. One client might need strict version control for audits. Another might just dump JSON into a lightweight store. A rigid built-in save function wouldn’t serve both cases.

#### Best practice: versioning

Treat workflow JSON like code. Don’t just overwrite it — store versions. That way you can:

-   Roll back when a workflow breaks.
-   Show change history for compliance.
-   Audit accounting or MRP logic step by step.

**Insight:** saving isn’t missing. It’s delegated to your backend so it fits your architecture, not someone else’s.

### Exporting workflows

Export is saving’s cousin: instead of persisting JSON internally, you package it for external use.

#### How exporting works

-   Workflow Builder already contains the logic to generate JSON snapshots.
-   Your backend (or a frontend service) decides what to do with that JSON.

#### Common export patterns include:

-   **Downloadable files:** let users grab JSON as a .json or .zip.
-   **API handoffs:** send the JSON to another system via REST.
-   **Compliance reports:** transform JSON into a PDF or CSV for auditors.

#### Why exporting is client-side

Because export formats vary wildly across industries. A healthcare company might need HIPAA-compliant PDFs. A SaaS startup might want raw JSON to share between devs. Workflow Builder leaves this open because no single format works for everyone.

### Importing workflows

Import closes the loop: taking stored JSON and loading it back into Workflow Builder.

#### How importing works

-   Your backend provides JSON from storage.
-   Workflow Builder parses it and reconstructs the canvas.
-   UI can simply import the file uploaded by the user.

The result is a perfectly replicated diagram. For programmatically generated workflows, this becomes even more valuable: you can build workflows in code, then render them visually for users.

#### Automatic layout

When you import large or messy workflows, Workflow Builder includes an **auto-layout feature**. It arranges nodes horizontally or vertically, so the canvas stays readable instead of collapsing into a tangle.

This makes Workflow Builder not just a design tool, but also a **visualization layer** for workflows created elsewhere in your system.

### Addressing “missing or hidden functions”

This is where confusion creeps in.

#### Why features look missing

In demo versions, “save” or “export” buttons might look like they don’t work. That’s because they’re just placeholders. They demonstrate the flow but stop short of real persistence or execution.

#### What’s actually happening

The **underlying JSON logic is already in the source code**. It’s fully functional. Developers just need to connect it to their backend — usually a matter of wiring a few lines of integration code.

#### Why it’s designed this way

Workflow Builder is not a SaaS with a hidden backend. It’s an SDK. The point is to let you decide where and how workflows are stored and executed.

**Opinionated stance:** what looks “missing” is actually Workflow Builder refusing to lock you into someone else’s backend.

### Easy integration with other systems

The whole point of the JSON-first model is flexibility. And in practice, it works.

#### Proven integrations from clients

-   **Prefect:** for orchestrating AI or data pipelines.
-   **YJS, Windmill, LangFlow:** for real-time collaboration or AI agent flows.
-   **Custom APIs:** companies often build bespoke endpoints to handle workflow actions.
-   **Node.js/TypeScript backends:** a natural match for teams already in the JavaScript ecosystem.

#### Extensibility baked in

-   Node properties defined via **JSON forms** → extend without rewriting code.
-   Components are modular → add your own node types or custom inputs.
-   Full source code + docs included in the license → internal teams can self-integrate.

#### Embedding flexibility

Workflow Builder drops seamlessly into React apps. For Angular or Vue, you can package it as a web component and embed it the same way.

#### Optional vendor support

Synergy Codes also offers technical sessions and custom development for teams that want help connecting JSON to backend orchestration engines.

## 3 mistakes teams make with save/export/import

1.  **Assuming demo placeholders mean features are missing.** The JSON is there — you just need to wire it up.
2.  **Skipping version control.** Overwriting JSON without history kills audits and debugging.
3.  **Letting the frontend handle persistence or API calls.** This is a security and compliance nightmare. Always push execution to the backend.

## Conclusion: JSON is the single source of truth

Workflow Builder isn’t hiding functionality. It’s exposing flexibility.

Every workflow is JSON. That JSON can be saved, exported, imported, versioned, and executed in whatever way fits your architecture. It’s why Workflow Builder works equally well in ERP systems, AI orchestration platforms, and SaaS apps.

Best practices are clear:

-   Save JSON in your backend with version control.
-   Export it in the formats your industry needs.
-   Import it cleanly with auto-layout for readability.
-   Treat demo placeholders as gateways, not gaps.

If you expect the frontend to store and execute for you, you’ll be frustrated. If you embrace Workflow Builder as a **JSON-first SDK**, you’ll see why it scales, why it integrates, and why it becomes a native part of your system — not someone else’s.

## ‍