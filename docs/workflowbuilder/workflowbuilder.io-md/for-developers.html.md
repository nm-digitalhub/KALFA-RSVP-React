# Workflow Builder React SDK - npm install for developers

For developers

## Workflow Builder for developers – React SDK, NPM package, reference back-end

Build a production workflow editor without rebuilding the canvas.  
npm install @workflowbuilder/sdk to embed the editor, clone the repo for the full reference stack with Temporal integration.

![license](https://img.shields.io/github/license/synergycodes/workflowbuilder?style=flat-square) ![GitHub Stars](https://img.shields.io/github/stars/synergycodes/workflowbuilder?style=flat-square&logo=github&logoColor=white&color=5360f9)

![Four people working on laptops around a wooden table in a rustic room with a hanging light fixture.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3a6694fcbf2114d5549836_Hero_For_developers.jpg)

![Workflow Builder editor canvas with agent nodes](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3b663b0b01528fc5a77d2d_f2ca0f8886db4c49217a155ae36d5367_Asset_WB_1_For_developers.jpg)

Two ways to ship

## Pick the level of integration that fits your team

Embed only the editor via NPM, or clone the full reference stack with editor + back-end + Temporal worker. Same React SDK, same JSON, same custom node API.

A: Just the editor (NPM)

```
npm install @workflowbuilder/sdk
```

Drop the visual workflow editor into your existing React app. You have your own back-end and execution engine? Wire the editor to your APIs over HTTP. The canvas does not assume anything about your runtime.

B: Full reference stack

```
git clone https://github.com/synergycodes/workflowbuilder
cd workflowbuilder
pnpm install && pnpm dev:ai-studio
```

Frontend + reference back-end + Temporal worker running end-to-end in minutes. Same code powers the AI Studio demo. Fork the back-end if you want; swap the Temporal worker for another engine through the three port interfaces - swappable by design, proven with Temporal.

Code examples

## From install to a running editor

The essentials to get the editor rendering. Full, copy-paste examples for custom nodes, persistence, and theming live in the docs.

1Install

Add the SDK with your package manager.

npmpnpmyarn

terminal

npm install @workflowbuilder/sdk
\# or
pnpm add @workflowbuilder/sdk
\# or
yarn add @workflowbuilder/sdk

2Basic usage

Mount the editor and wire one save handler.

<WorkflowBuilder.Root>integration

App.tsx

import { WorkflowBuilder } from '@workflowbuilder/sdk';
import '@workflowbuilder/sdk/style.css';

export default function App() {
  return (
    <WorkflowBuilder.Root
      name="my-workflow"
      layoutDirection="DOWN"
      nodeTypes={\[\]}
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

3Extend

Custom nodes, persistence, theming.

defineNodeTemplate()\--wb-\*

extend.ts

// Typed custom nodes
const task = defineNodeTemplate({ type: 'task' });

// Persistence: 'props' | 'api' | 'localStorage'
integration={{ strategy: 'api' }}

// Theme the canvas with CSS variables
:root { \--wb-node-bg: #fff; }

Key features

## 13 production features that ship with the React SDK

Everything the canvas teams typically spend 14-25 weeks building from scratch. Community Edition covers the foundation; Enterprise adds advanced canvas plugins, Flow Runner, and Figma Kit.

-   ### Visual Workflow Canvas
    
    Pan, zoom, multi-select, lasso, marquee. Tuned for 500+ nodes performance. Community.
    
-   ### Custom nodes & node library
    
    Drag-and-drop React components from a configurable node library. Bring your design system, icons, interaction patterns. Community.
    
-   ![Workflow diagram with steps: Start Workflow, Check Client Source conditional, branching to Partner Website.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698c306770f0bea587c5e291_Dynamic%20Properties%20Panel.avif)
    
    ###  Schema-driven properties panel
    
    Define TypeScript node schemas, get a typed properties panel automatically. JSON Schema in, validated form out. Community.
    
-   ![Code snippet showing JSON changes: retries updated from 2 to 5 and timeout set to 30 in workflow.json.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3d138f7c903e02a5c820b9_JSON_feature.jpg)
    
    ###  JSON serialization
    
    Workflow state in, workflow state out. Back-end-agnostic, version-control friendly, easy to diff. Community.
    
-   ###  Auto-save and persistence
    
    Local-storage or your API endpoint - the editor saves as users type. No data loss on page refresh. Community.
    
-   ![User interface showing a workflow block labeled Notify Customer with toggle icons for light mode and structure view.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698c306782d1249e183f2bad_Read-only%20mode.avif)
    
    ### Read-only mode
    
    Display workflows to viewers without edit permissions. Same canvas, locked controls. Perfect for review queues and audit trails. Community.
    
-   ![User interface showing a toolbar, a panel with a plus button, and a simple flowchart diagram.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3d133634a1e63bbe0c7484_Plugin%20architecture.png)
    
    ###  Plugin architecture
    
    Extend the editor without forking core. Add canvas tools, side panels, command palette items, custom toolbars. Community.
    
-   ![Code snippet showing object properties and types: type NodeType, id string, connect Edge, data TData.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3d36a91ebdcecb8c61be9b_TypeScript-first%20API.png)
    
    ### TypeScript-first API
    
    Full type definitions for every public API. Autocomplete in your IDE for every node, schema, and plugin signature. Community.
    
-   ### Smart edge routing
    
    Automatic routing avoids overlaps and reads cleanly at any zoom level. No manual layout. Enterprise.
    
-   ### ELK auto-layout
    
    One-click auto-layout powered by ELK. Vertical, horizontal, layered. Enterprise.
    
-   ### Edge Reshaping
    
    Interactive handles let users adjust edge paths. Drag waypoints, snap to grid. Enterprise.
    
-   ![User interface showing Nodes Library with Custom node and Trigger options plus top toolbar icons.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3d13353998cbd794a48622_Undo%2Credo.png)
    
    ###  Undo, redo, copy, paste
    
    Full history stack with multi-node selection. Keyboard shortcuts wired in. Production-grade editing UX. Community.
    
-   ![Dashboard UI kit with buttons, toggles, charts, modals, calendar, input fields, and icons in blue and grey tones.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3d1335a3457778dd725b98_Theming%20%26%20Figma%20Kit.png)
    
    ### Theming & Figma Kit
    
    Theme the canvas via design tokens. Figma Kit included with Enterprise - 1:1 components for design-first teams. Theming Community, Figma Kit Enterprise.
    

![Workflow Builder editor canvas with AI agent nodes](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3adeb08be61263737d3877_Asset_WB_for_devs.jpg)

BUILD OR BUY?

Best fit when

## You should reach for Workflow Builder if...

![AI Head Circuit icon](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a0704c48b7b189bf3fc4027_RocketLaunch.svg)

You ship a production workflow editor in a B2B SaaS

Schema-driven properties panels, smart edge routing, auto-layout, plugin system, JSON serialization - skip the 14-25 weeks of canvas plumbing and focus on domain logic. Production-ready means real customers, real complexity, not a tutorial demo.

![Users icon](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a0704c40f2ddd1a8922fc50_Code.svg)

You want full source code and Apache 2.0 license

Community Edition is Apache 2.0 on public GitHub. Commercial use OK, no copyleft, no relicensing. Enterprise adds source code access to Enterprise-only components, Flow Runner plugin, Figma Kit. Either way - your code stays your code.

![AI Head Circuit icon](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a0704c43adf4b94be9fff92_TreeStructure.svg)

You have an existing back-end

Wire the editor to your APIs over HTTP. Your engine, your activities, your runtime. The reference back-end exists for teams that do not have one yet - skip it if you do.

![Users icon](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a266f5d691c69495d21f970_ap-reason-1-frame-corners-white-48.svg)

You want to swap execution engines without rewriting the UI

Temporal ships today as the reference adapter. Three main port interfaces (WorkflowEnginePort, ActivityRunnerPort, EventEmitterPort), plus a LoggerPort, let you integrate another engine without changing the editor or JSON - swappable by design, proven with Temporal.

COMPARE WITH ALTERNATIVES

Built in the open

## Apache 2.0, public GitHub

Workflow Builder is developed in the open. Star the repo, file issues, send PRs, follow releases. The full three-block stack ships in Community Edition.

Commercial use, no copyleft, no relicensing

Editor, reference back-end and worker, all open

Your code stays your code

AboutPublic

Embed a production workflow editor into your React app. Editor + reference back-end + execution worker.

[workflowbuilder.io](https://workflowbuilder.io/)

reacttypescriptworkflow-engineno-codeapache-2.0

![Group of people working on laptops at a wooden table, one person wearing headphones coding.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3ad742e70953083600b306_Photo_developers.jpg)

Join the dev community

## Build with us in the open

Star the repo, ask questions on Discord, install from npm.  Workflow Builder is built **by developers, for developers.**

GitHub

Star the repo, file issues, send PRs, follow releases. Apache 2.0 Community Edition, full three-block stack.

Discord

Ask integration questions, share what you build, get help from the team and other developers shipping workflow editors.

npm package

Install the visual workflow editor from npm. npm install @workflowbuilder/sdk and embed the editor in minutes.