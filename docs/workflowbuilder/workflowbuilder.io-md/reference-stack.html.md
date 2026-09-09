# Workflow Builder Reference Stack — Open Source, Apache 2.0

What is in the repo

## Three apps. One command.

Clone github.com/synergycodes/workflowbuilder, run pnpm install && pnpm dev:ai-studio, get a working three-block stack. Each app is independently swappable.

REFERENCE ARCHITECTURE

## Swap any block: replace the editor, fork the back-end, change the engine - contracts stay the same.

### packages/sdk

React · Visual editorEditor SDK · host: apps/demo

### apps/backend

\+ packages/execution-coreReference Backend · Apache 2.0

### apps/execution-worker

Engine Integration

TemporalInngestCamundaStep Functions

Temporal ships today implement the 3 ports to swap in any engine

packages/sdk + apps/demo

The editor SDK (packages/sdk), with a reference React host in apps/demo. Properties panel, custom nodes for AI agents and human tasks, JSON serialization. Talks to the reference back-end over HTTP.

```
npm install @workflowbuilder/sdk
```

apps/backend + packages/execution-core

Engine-agnostic HTTP API and graph runner. Reads workflow JSON from the editor, coordinates execution through the engine port, streams progress back. Stateless by default.

```
pnpm dev:backend
```

apps/execution-worker

Reference Temporal worker implementing the engine port. Replace with your Inngest, Camunda, AWS Step Functions worker - the back-end does not change.

```
pnpm dev:worker
```