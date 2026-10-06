# Workflow Builder FAQ - Pricing, License, Integration, AI

FAQ

Twenty+ answers to the questions we hear most from CTOs, tech leads, and product managers evaluating Workflow Builder.

Design tokensEvery editor componentVariants and statesTheming – light and darkExample flows

Product basics

-   What is Workflow Builder?
    
    Workflow Builder is a production-ready React SDK for embedding visual workflow editors into your B2B SaaS product. It ships three composable blocks - the visual workflow editor (React SDK on NPM), an Apache 2.0 reference back-end on GitHub, and swappable engine integrations starting with Temporal. [See the homepage →](https://www.workflowbuilder.io/)
    
-   Is Workflow Builder the same as Builder.io?
    
    No. Builder.io is a visual page builder for marketing sites. Workflow Builder is a React SDK for embedding production workflow editors into B2B SaaS products. Different category, different buyer, different problem.
    
-   Is Workflow Builder open source?
    
-   What is included in Community vs Enterprise?
    
    Community Edition (Apache 2.0, free) includes Visual workflow editor NPM, reference back-end, Temporal adapter, three port interfaces, docker compose dev environment. Enterprise Edition (EUR 6,990) adds source code access to Enterprise-only components, Flow Runner plugin, Figma Kit, advanced canvas plugins (ELK auto-layout, smart edge routing, edge reshaping), and priority GitHub issues. Enterprise SLA available on-demand. [See full pricing →](https://www.workflowbuilder.io/pricing)
    
-   Does Workflow Builder work without a back-end?
    
    Yes for the editor alone - the visual workflow editor (NPM SDK) is back-end-agnostic and emits JSON. For end-to-end execution you need a back-end - either ours (the reference implementation in the public repo) or your own. The editor and back-end talk over HTTP.
    

Pricing & licensing

-   How does the EUR 6,990 Enterprise license work?
    
    One-time payment, perpetual license per organization, unlimited developers. Gets you source code access to Enterprise-only components, Flow Runner, Figma Kit, advanced canvas plugins, premium docs, and priority GitHub issues. Enterprise SLA is available on-demand. [See pricing details →](https://www.workflowbuilder.io/pricing)
    
-   Is the Enterprise license a subscription or one-time?
    
    One-time, per organization, unlimited developers. Perpetual license to use the Enterprise components in your products. No annual renewal required.
    
-   Do you offer an Enterprise SLA?
    
    Yes, on-demand. Enterprise SLA is available for Enterprise Edition customers - [contact sales](https://www.workflowbuilder.io/contact) to discuss your requirements. Response times, escalation paths, and coverage hours are negotiated individually based on your team size, deployment scale, and operational needs.
    
-   Can I use Workflow Builder Community in a commercial product?
    
    Yes. Apache 2.0 is a liberal license. Commercial use is OK, modification is OK, no copyleft. You can build and sell a product on top of Workflow Builder Community Edition without a commercial license.
    
-   Will Apache 2.0 ever change to BSL or SSPL?
    
    No. Apache 2.0 is our hard commit. We watched the MongoDB SSPL, Elastic SSPL, HashiCorp BSL, and Redis SAL relicensing events. Workflow Builder Community Edition stays Apache 2.0, perpetually. [See the open source story →](https://www.workflowbuilder.io/open-source)
    

Technical integration

-   Yes. Workflow Builder is a React SDK. Built on React Flow. If your app is React, you can embed it natively. If your app uses another framework, you would wrap the editor in an iframe or web component - but that is friction we do not optimize for.
    
-   Not strictly required, but strongly recommended. The schema-driven properties panel uses TypeScript schemas to auto-generate form UI - JavaScript works but you lose the type safety on node schemas. All examples and docs are in TypeScript.
    
-   Yes. One React component per node type. Schema-driven properties panel auto-generates the configuration UI from your TypeScript schemas. You ship custom nodes for AI agents, tool calls, prompts, approvals - whatever your product exposes. [See code examples →](https://www.workflowbuilder.io/for-developers)
    
-   Yes. There is no hosted version. You install the NPM package in your app, optionally clone the reference back-end to run alongside, and host it on your infrastructure. Apache 2.0 covers self-hosting commercial use.
    
-   Does it perform at 500+ nodes?
    
    Yes. React Flow is the base and we have optimized rendering on top. Virtualization, smart edge routing, lazy node loading. We have shipped editors handling 500+ node workflows in customer products.
    
-   Can I swap Temporal for Inngest, Camunda, or my own engine?
    
    Yes. Temporal ships as the reference adapter, but the reference back-end is engine-agnostic by design. Implement the three port interfaces (WorkflowEnginePort, ActivityRunnerPort, EventEmitterPort) and you can run Inngest, Camunda, AWS Step Functions, Cloudflare Workflows, or your own in-house engine. The Temporal adapter is ~120 lines of TypeScript as a reference. [See engine integrations →](https://www.workflowbuilder.io/reference-stack)
    
-   What is in the reference stack and how do I run it?
    
    The reference stack is three apps - frontend (Visual workflow editor), back-end (engine-agnostic HTTP API + graph runner), and a Temporal worker. Clone [github.com/synergycodes/workflowbuilder](https://github.com/synergycodes/workflowbuilder) and run docker compose up to get the full three-block stack running end-to-end in 5 minutes. Same code powers our AI Studio demo. All Apache 2.0. [See the reference stack →](https://www.workflowbuilder.io/reference-stack)
    

Comparison

-   How is Workflow Builder different from React Flow?
    
    Workflow Builder is built on React Flow - it is not a replacement. React Flow is a node-based library you compose yourself. Workflow Builder is a production-ready workflow editor with schema-driven panels, smart routing, auto-layout, plugin system, and JSON serialization out of the box. [Full comparison →](https://www.workflowbuilder.io/compare/react-flow)
    
-   How is Workflow Builder different from n8n?
    
    n8n is a workflow automation product - it hosts the back-end, hosts the editor, you bring your account. Workflow Builder is a React SDK you embed in your product. You own the back-end, the data, the UX, the customer relationship. [Full comparison →](https://www.workflowbuilder.io/compare/n8n)
    
-   How does this compare to building from scratch?
    
    Building a comparable editor from scratch takes 14-25 weeks of canvas work before you touch domain logic. Schema-driven panels, smart edge routing, auto-layout, undo/redo, performance at scale - all solved. Workflow Builder is what you skip when you want to spend that time on what your product does.
    

AI workflows

-   How do I integrate Workflow Builder with LangChain or LangGraph?
    
    Workflow Builder is the UI layer; LangGraph is your back-end. Your code defines the agent and tool primitives, Workflow Builder gives end-users a visual canvas to compose them. The graph serializes to JSON, your back-end reads it and instantiates the LangGraph graph. Use the three port interfaces to plug LangGraph in instead of Temporal. [See AI workflows page →](https://www.workflowbuilder.io/ai-agent-workflows)
    
-   Does Workflow Builder support OpenAI Assistants?
    
    Yes. You implement an Assistant node in code, Workflow Builder gives end-users a visual workflow editor to compose Assistant calls with other agents and tools. WB does not call OpenAI - your back-end does. Streaming responses surface back to the canvas via SSE.
    
-   Can I stream agent responses and progress to the canvas?
    
    Yes. The EventEmitterPort streams SSE events from your back-end to the canvas - node started, token chunk, node completed, validation result. Real-time agent reasoning visualization, no polling.
    

Working with the team

-   Can the Workflow Builder team build it for us?
    
    Yes. Beyond the self-serve SDK, the team that built Workflow Builder offers partner-led delivery - a 2-4 week Workflow Setup Sprint (EUR 15-25k) to kickstart your integration, or full end-to-end delivery (EUR 50-200k+) where we own the build to production. 15 years of workflow product engineering, 200+ products since 2011, a team of 70+ specialists across engineering, design, and strategy. [Meet the team →](https://www.workflowbuilder.io/consulting)
    
-   Do the Setup Sprint and end-to-end services require Enterprise?
    
    Yes. Both partner-led options layer on top of an Enterprise Edition license (EUR 6,990). Our team works in the same codebase as you, with full source access. Community-only customers can self-serve; partner-led delivery starts with Enterprise. The Enterprise license is yours perpetually, even after the engagement ends. [See consulting scope →](https://www.workflowbuilder.io/consulting)
    
-   What does the Workflow Setup Sprint include?
    
    A 2-4 week kickoff sprint: 1-day discovery workshop, architecture review (your stack + WB integration), AI dev environment setup with Claude skills and scaffolding tools, integration plan with your back-end, transfer to your team, plus 30 days of post-handover support. We are not building dependencies - we transfer capability. Your team owns the code when we leave. [See pricing →](https://www.workflowbuilder.io/pricing)
    

### Still have questions?

Talk to the team that built Workflow Builder. We respond within 24 hours.