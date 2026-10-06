# Visual editor for Temporal workflows

Workflow Builder + Temporal

Temporal runs the durable workflow. Workflow Builder gives your end-users the canvas. Mount a React-embedded editor on top of your Temporal backend in 1 day and let PMs, ops, and customers author flows - without writing Go, Java, or Python. WB Reference backend ships with a Temporal adapter on day one.

![Software interface showing Python code on the left and a workflow diagram on the right for client source checking.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3bfbea55d6948690d01f0d_hero-Temporal.avif)

For Temporal teams that need an editor inside their product - not just Temporal Web UI for engineers.

Senior Frontend Engineer at Synergy Codes. Builds React-based workflow editors and embeddable SDKs for B2B SaaS products. Featured interview on justjoin.it.

[LinkedIn](https://pl.linkedin.com/in/jlibrowski) · [GitHub](https://github.com/librowski-synergy) · [Interview on justjoin.it](https://justjoin.it/blog/okiem-programisty-jak-wyglada-zycie-frontend-developera-w-finlandii-wywiad-z-janem-librowskim)

Technical review by Łukasz Jaźwa, CTO of Synergy Codes.

Published:May 26, 2026· Last reviewed:May 26, 2026· Last updated:May 26, 2026

Workflow Builder is a Synergy Codes product. Facts about competitors are sourced from public documentation. [Contact us](https://www.workflowbuilder.io/contact) to report an error and we will correct it shortly.

At a glance

## Temporal for the runtime, Workflow Builder for the editor

**Temporal** is the industry-standard durable execution platform from Temporal Technologies - MIT-licensed, 8 official SDKs (Go, Java, Python, TypeScript, .NET, PHP, Ruby, Rust), battle-tested at Snap, DoorDash, OpenAI, Cloudflare, GitLab, and many others. It runs your workflow state machine with deterministic replay, signals, and queries.

**Workflow Builder** is a headless React SDK that mounts an editor canvas inside your product - visual authoring, end-user friendly, no Go, Python, or Rust required. It gives your authors the surface.

**Together:** Temporal runs the workflow. Workflow Builder lets non-developers author, inspect, and approve the flows. The Temporal adapter ships as part of the WB Reference backend - source-available alongside the Enterprise license, not an open npm package - so the wiring is configuration on day one, not new engineering.

The 1-line summary: Temporal for the runtime, Workflow Builder for the editor.

Last updated: May 2026 · Sources: Temporal public docs, GitHub repository, WB Reference backend source.

The pairing problem

## Temporal runs the workflow. Who builds the UI for your end-users?

Temporal is the right tool for durable execution at scale. Sagas, compensation, retries, deterministic replay, signals, queries, child workflows - all first-class. If your team runs long-running workflows that absolutely must complete (payment flows, KYC, multi-day onboarding, agent backends), Temporal earns its place.

**_The editor is your problem. Your PM cannot author a workflow in Go. Your ops team cannot tune a saga in their IDE. Your customer cannot see the long-running job their workflow kicked off, let alone change it. Temporal Web UI is an engineer-oriented operations console - search executions, send signals, terminate stuck workflows, reset state, inspect event history. Excellent for ops and debugging, but not packaged as a product UI for the non-developers who actually use your product._**

**_Workflow Builder fills that gap. The canvas lives inside your application. The end-user authors flows visually. The output is a typed JSON graph definition. The WB Reference backend adapter translates that to Temporal Workflow definitions and runs them. You keep the Temporal runtime you already trust, and add the editor your customers expect._**

Integration architecture

## How Temporal and Workflow Builder fit together

WB canvas in your product

→

Typed JSON graph definition

→

WB Reference backend Temporal adapter (ships day one)

→

Temporal Workflow execution: signals + queries + child workflows

1.  **Your product mounts the WB React component** - one import, one component.
2.  **End-users build flows on the canvas** - drag-drop nodes, connect edges, fill custom node form schemas.
3.  **WB outputs a typed JSON graph definition** on save.
4.  **The WB Reference backend Temporal adapter translates JSON to Temporal Workflow + Activity definitions** - this adapter ships day one.
5.  **Temporal executes** with full durable execution (deterministic replay, signals, queries, sagas, compensation).

Layer

Temporal

Workflow Builder

Durable execution engine

Yes

No

Visual canvas

No

Yes

Deterministic replay

Yes

No

End-user authoring

No

Yes

Signals + Queries (external influence)

Yes

UI for them

Custom node form schemas

No

Yes

Child workflows + sagas + compensation

Yes

UI for them

Multi-language SDK (Go / Java / Python / TS / .NET / PHP / Ruby / Rust)

Yes

n/a (editor is React-only)

Temporal Web UI (engineer-oriented ops console)

Yes

n/a (business-facing authoring)

Theme + design system control

No

Yes

Purely additive

## What Workflow Builder adds to your Temporal stack

+

**Visual canvas for non-developers** - PMs, ops, customers can author workflows without writing Go, Java, or Python.

+

**Embeddable React component** - mount it in your product, in your design system, on your URL.

+

**Custom node form schemas** - typed inputs end-users fill in (model, retry policy, compensation handler, signal payload, anything).

+

**Production UX baked in** - undo / redo, edge routing, auto-layout, minimap, snap-to-grid.

+

**Theme tokens** - CSS variables that match your product's design system.

+

**No Go, Python, or Rust required** for authors - the JSON contract is the only thing they touch indirectly.

+

**Generic node shapes** - data, approval, HITL, and domain-specific nodes are first-class, not workarounds.

**What you keep from Temporal:** the runtime, the deterministic replay, the signals + queries, the saga + compensation primitives, the 8 worker SDKs (Go / Java / Python / TS / .NET / PHP / Ruby / Rust), and the Temporal Web UI for engineering ops.

Code example

## Code example: from canvas to Temporal in 30 lines

The minimum wiring. Adapt to your worker language, your data shape, your storage.

Frontend (React + TypeScript)

```
import { WorkflowBuilder } from '@workflowbuilder/sdk';
import type { PaletteItemOrGroup } from '@workflowbuilder/sdk';

const nodeTypes: PaletteItemOrGroup[] = [
  { type: 'activity', label: 'Activity', category: 'Execution' },
  { type: 'signal-wait', label: 'Wait for signal', category: 'Human-in-the-loop' },
  { type: 'approval-gate', label: 'Approval gate', category: 'Human-in-the-loop' },
  { type: 'compensation', label: 'Compensation', category: 'Saga' },
  { type: 'child-workflow', label: 'Child workflow', category: 'Orchestration' },
];

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
  return (
    <WorkflowBuilder.Root
      name={`workflow-${workflowId}`}
      nodeTypes={nodeTypes}
      integration={{
        strategy: 'api',
        endpoints: {
          load: `/api/workflows/${workflowId}`,
          save: `/api/workflows/${workflowId}`,
        },
      }}
    />
  );
}
```

The WB Reference backend ports-and-adapters pattern: a generic **runGraph** topological runner consumes the JSON graph; Temporal **proxyActivities** are injected as the ActivityRunnerPort, signals and queries go through the EventEmitterPort. Your workflow entry-point is a thin runWorkflow(input) that delegates to runGraph.

Backend (TypeScript + Temporal Workflow)

```
// apps/execution-worker/src/engines/temporal/workflows/run-workflow.ts (shape)
import { proxyActivities } from '@temporalio/workflow';
import { runGraph } from '@workflow-builder/execution-core/workflow';
import type { WorkflowExecutionInput } from '@workflow-builder/execution-core';

export async function runWorkflow(input: WorkflowExecutionInput) {
  const activities = proxyActivities<typeof import('./activities')>({
    startToCloseTimeout: '5 minutes',
  });

  return runGraph(input.graph, {
    runActivity: (node) => activities[node.handler](node.input),
    emit: (event) => /* signal / query bridge */ undefined,
  });
}
```

Backend (start client)

```
// apps/backend/src/engine/temporal-engine.ts (start client)
import { Client, Connection } from '@temporalio/client';

const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
const client = new Client({ connection, namespace: 'default' });

const handle = await client.workflow.start('runWorkflow', {
  taskQueue: 'workflow-execution',
  workflowId: `wb-${workflowId}-${Date.now()}`,
  args: [{ graph: graphJson }],
});
```

The full reference adapter lives in apps/execution-worker and apps/backend inside the WB Reference backend - source-available alongside the Enterprise license. See Quick start below.

Use cases

## Where Temporal + Workflow Builder pays off

### Human-in-the-loop approval flows

Temporal ships signals and queries - external systems can send data into a running workflow without breaking determinism. In code, that is defineSignal and setHandler. For your end-user, it is a flow on a canvas with an approval gate node, a reviewer assignment, and a notification step. Workflow Builder exposes the node types; the adapter maps them to Temporal signals. PMs author the approval flow; Temporal executes it with full durable replay. The reviewer never sees Go.

### Customer-facing workflow builders

Your B2B SaaS sells workflow automation. Your customers - operations teams, line-of-business owners, compliance officers - need to configure their own workflows. They are not developers. You can either build a custom canvas (3-6 months of engineering before you add a single activity) or embed Workflow Builder and run customer-authored workflows on Temporal. The adapter is already in the Reference backend.

### Visual production view for non-engineers

Temporal Web UI is an engineer-oriented operations console - search executions, view event history, send signals, terminate stuck workflows, reset state. Excellent for ops and debugging. Your product team also needs to see what is happening in business terms: which step is running, where the workflow paused waiting for a signal, what data flowed through the approval gate. Workflow Builder lives in your product and renders the same workflow mental model for non-engineers - business-facing surface, same source-of-truth state.

### Long-running orchestration UI (KYC, billing, onboarding)

Multi-day workflows - KYC checks, subscription billing cycles, customer onboarding - are Temporal's sweet spot. They are also impossible for a PM to reason about by reading Go code. Workflow Builder renders the topology - which activity calls which, where the saga compensates, where the workflow waits for a human. Product teams author and modify the flow without reading code.

Canonical pairing pattern

## Athena Intelligence: visual editor on top of a durable backend

Athena's specific backend is a custom Python runtime, not Temporal, but the architectural pattern is identical - end-users author flows on a visual canvas inside the Athena product, and the backend translates and executes. The Temporal pairing inherits the same shape, with the bonus that the WB Reference backend ships the Temporal adapter on day one.

[Athena Intelligence](https://www.workflowbuilder.io/case-study/athena-intelligence) is a US-based, VC-backed AI platform for legal and renewable-energy data intelligence. Their customers - enterprise analysts, not developers - need to build multi-step pipelines without writing Python. Before Workflow Builder, Athena offered a Python SDK on a lambda-style runtime. End-users had to write code. That model did not scale to the non-developer customers the platform was built for.

3 days

From first call to a working integration inside their product

1 day

Of engineering to ship the white-label editor in their stack

1 week

For follow-up form-logic and theme adjustments

If you are running Temporal as the durable execution runtime, the integration is even faster - the adapter ships in the WB Reference backend, so the wiring is configuration, not new engineering.

Pricing

## Pricing: pair without paying twice

### Temporal

**OSS:** free under MIT, self-host, no Sustainable Use restrictions (requires Postgres or Cassandra + worker fleet).

**Temporal Cloud - Dev:** free, no SLA.

**Growth:** $200/mo, 1M actions included, additional ~$0.00025/action.

**Business:** ~$2,000/mo + actions + storage.

**Enterprise / Mission Critical:** custom, six-figure ARR, SSO included.

Real-world mid-market (10-100M actions/mo): . **$2,000-$12,000/mo**

**3-year cost (Team tier):** $159 x 36 = $5,724 for one workspace. Enterprise self-host with SSO and multi-workspace: custom, typically four to five figures per year.

### Workflow Builder

Enterprise license: **EUR 6,990 one-time**

React SDK + reference backend with Temporal adapter included.

Self-host on Apache 2.0: free, no addendum, white-label allowed.

No per-workspace, per-seat, or per-execution fee on the editor side.

**Watch the action multiplier:** workflows generate 10-50x more actions than initial estimates (heartbeats, signals, child workflows, retries). Cost optimization is mandatory reading before production.

For a single-workspace internal tool, both are in similar bands at 3 years. For multi-tenant SaaS, white-label, or customer-facing B2B: Workflow Builder is the only one of the two whose license permits the business model.  
‍[**See full Workflow Builder pricing**](https://www.workflowbuilder.io/pricing).

Quick start

## Three steps to your first Temporal flow

1

### Read the integration guide

The Temporal adapter pattern, the JSON contract, and the node-type registry. [Open the docs](https://synergy-codes.gitbook.io/workflow-builder/).

2

### Clone the reference repository

The WB Reference backend ships a working Temporal adapter - a sample canvas plus a TypeScript worker that compiles and runs end-to-end. [View on GitHub](https://github.com/synergycodes/workflowbuilder).

3

### Book an architecture review

30 minutes with our team. We sketch the integration shape on a call. No slides. [Book here](#cta-final).

CASE STUDIES

FAQ

## Temporal + Workflow Builder, answered

-   Does Workflow Builder replace Temporal?
    
    No. They pair. Temporal runs the durable workflow engine - deterministic replay, signals + queries, sagas + compensation, child workflows, multi-language workers. Workflow Builder is the editor your end-users author on. The WB Reference backend ships a Temporal adapter on day one - this is documented integration, not a roadmap promise. Both ship MIT or Apache 2.0, both self-host, no vendor lock-in on either side.
    
-   Can I use Workflow Builder without Temporal?
    
    Yes. Workflow Builder is runtime-agnostic. Temporal is the first (and currently the only) runtime adapter shipping in the WB Reference backend, but the WorkflowEnginePort contract lets you wire your own backend (LangGraph, Inngest, custom executor) by implementing one TypeScript interface - no separate adapter package required.
    
-   Temporal is the industry-standard durable execution platform from Temporal Technologies, licensed under MIT. It models long-running workflows as code with deterministic replay, signals, queries, sagas, and compensation. Eight official SDKs - Go, Java, Python, TypeScript, .NET, PHP, Ruby, Rust. It runs in production at Snap, DoorDash, OpenAI, Cloudflare, GitLab, and many others. It is a backend runtime and library - not a product UI for end-users.
    
-   Why does Temporal need a visual editor?
    
    Temporal workflows are written in Go, Java, Python, TypeScript, .NET, PHP, Ruby, or Rust code. That works for backend engineers. It does not work for the PM who needs to design an approval flow, the ops team tuning a saga, or the customer who buys your workflow automation product and expects to configure it. Temporal Web UI is an engineer-oriented operations console, not a product UI for non-developer authors.
    
-   How does Workflow Builder integrate with Temporal?
    
    The WB Reference backend ships a Temporal adapter. Workflow Builder exports a typed JSON graph definition; the adapter translates that into Temporal Workflow + Activity definitions, including signal handlers, compensation chains, and child workflow invocations. Compile your worker, register the adapter-generated workflow, and run.
    
-   Does Temporal Web UI do this already?
    
    Temporal Web UI is an engineer-oriented operations console - search workflows, view event history, send signals, terminate stuck workflows, reset state. Excellent for ops and debugging. It is not embeddable in your product, not designed for non-developers to author workflows, and not packaged as a customer-facing surface. Workflow Builder fills that gap.
    
-   Can end-users author HITL flows visually?
    
    Yes. Workflow Builder exposes node types for approval gates, signal waits, and pause-resume. Authors drag the nodes onto the canvas; the Temporal adapter maps them to defineSignal + setHandler primitives. End-users never see Go or TypeScript. The reviewer gets a notification, opens the inbox you build, approves or rejects, and the Temporal workflow continues with the signal value.
    
-   What does Workflow Builder cost when paired with Temporal?
    
    EUR 6,990 one-time for the Workflow Builder Enterprise license. That includes the React SDK and the reference backend with the Temporal adapter shipping day one. You also get production UX features (undo/redo, edge routing, auto-layout, minimap, theming) that would take hundreds of engineering hours to build to production quality. Temporal charges separately on the runtime side. No double-billing on the same dimension.
    

### Ready to add a visual editor to your Temporal workflows?

A 30-minute architecture review will tell you whether Workflow Builder fits your Temporal setup. We will sketch the adapter on a call. No slides. The Temporal adapter is already in the Reference backend.