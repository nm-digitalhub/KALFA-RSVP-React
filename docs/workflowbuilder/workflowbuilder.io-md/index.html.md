# Workflow Builder - React SDK for Embedding Workflow Editors

## Embed a production-ready workflow editor in your React app

NPM package for the editor, Apache 2.0 reference back-end, swappable engine integrations. Ship in days, not months. Build with your team or with ours.

![license](https://img.shields.io/github/license/synergycodes/workflowbuilder?style=flat-square) ![GitHub Stars](https://img.shields.io/github/stars/synergycodes/workflowbuilder?style=flat-square&logo=github&logoColor=white&color=5360f9) Apache 2.0 - commercial use OK, no copyleft

TRUSTED BY ENTERPRISE TEAMS

What you get with WB 2.0

## Three composable blocks.    
One SDK to install, a reference stack to fork.

The editor installs from npm. The reference back-end and engine adapter are open-source code you fork - not packaged products. Temporal ships as the reference adapter today.

Visual workflow editor

The React canvas, properties panel, smart edge routing, ELK auto-layout, JSON serialization. Drag-and-drop nodes with TypeScript schemas. Drops into your app via NPM.

Back-end-agnostic - bring your own API or use our reference back-end below.

```
npm install @workflowbuilder/sdk
```

Reference back-end

Engine-agnostic HTTP API, graph runner, three port interfaces. A reference implementation to fork - not an installable package. Apache 2.0, public GitHub, free forever.

```
git clone … && pnpm install && pnpm infra:up && pnpm dev:backend && pnpm dev:worker
```

Engine integrations

Plug your own execution engine into the reference back-end. Temporal ships as the reference adapter; integrate any other engine through the same workflow engine ports.

```
Temporal adapter · engine-agnostic ports
```

Decide before you build

## In-house from scratch, or build on Workflow Builder?

Both paths ship a workflow editor. One costs 14-25 weeks of canvas work before you touch domain logic. The other starts on day one.

![Team working together in a modern office](https://s3.amazonaws.com/webflow-prod-assets/67121c7b454e7d1dfb641e68/6a3cd76fee4fad5b2829de6a_Photo_banner.jpg)

**Build in-house**canvas first, product later14-25 weeks

Canvas Edge routing Auto-layout Schema panel Serialization

**Build on Workflow Builder**product from day one

![Workflow Builder](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698b0a2429787236d85b9760_WorkflowBuilder_logo_nav.svg)

Time saved

Build in-house only when

You have **engineers to spare** for the canvas

You can afford **14-25 weeks** before domain logic gets attention

You have an **existing canvas team** owning React Flow, D3, or custom graph code

Your editor needs are **highly bespoke** and React SDK conventions would block you

You prefer building auto-layout, edge routing, schema panels **from scratch**

Choose Workflow Builder when

You need a production editor, **fast**

You want to spend engineering hours on **domain logic**, not canvas plumbing

You need schema-driven panels, smart routing, auto-layout **out of the box**

You want **back-end flexibility** – your own engine, Temporal, or our reference

You want the **source code yours** to fork or replace (Apache 2.0 Community + Enterprise license)

**The moment when WB pays off:** when you realize the canvas is the generic part and domain logic is where the product lives.

Built by experts. Designed for enterprise.

## Diagramming experts.  
15+ years of workflow product engineering.

We do not just ship a React SDK - we have been building workflow products for B2B SaaS since 2011. Workflow Builder is what we use to ship those products faster.

![Workflow Builder team working together](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3d022ad8e8ec29af3f202d_Photo_group.jpg)

![Quote](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6973529c0075a134da950191_Quote.svg)

Workflow Builder gave us a complete, proven foundation. Our team went straight to building what is unique about our product. That saved us roughly EUR 50,000 and months of trial and error.

Adam Lewkowicz · CTO at MessageFlow (Vercom)

15+

Years building workflow tools

200+

Workflow products delivered

20+

Industries shipped to production

**EUR 6,990**

Enterprise license, one-time

Design your workflow interface

## The workflow builder UI components that ship on day one

The workflow builders before you spent 14-25 weeks rebuilding the canvas before touching domain logic. Workflow Builder ships those pieces on npm install so your team starts on domain logic.

-   ![Workflow canvas showing a Black Friday Deals automation with triggers, actions, delays, and conditions.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698c30679bb2ca3de19e002d_Visual%20Workflow%20Canvas.avif)
    
    ### Visual Workflow Canvas
    
    Pan, zoom, multi-select, lasso, marquee. The foundation every workflow editor needs, tuned for 500+ nodes performance.  
    
-   ![Workflow editor screen showing nodes library with trigger, action, delay, conditional, and decision nodes.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698c30679c48eddd52428623_Node%20Library.avif)
    
    ### Custom nodes & node library
    
    Drag-and-drop React components from a configurable node library. Bring your design system, your icons, your interaction patterns.  
    
-   ![Workflow diagram with steps: Start Workflow, Check Client Source conditional, branching to Partner Website.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698c306770f0bea587c5e291_Dynamic%20Properties%20Panel.avif)
    
    ### Schema-driven properties panel
    
    Define your TypeScript node schemas, get a typed properties panel automatically. JSON Schema in, validated form out.
    
-   ![Flowchart with delay steps 'Wait for 2 Days' and 'Wait for 7 Days' leading to 'Is the Order Placed?' check.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698c3066f6e852188db89342_Smart%20Edge%20Routing.avif)
    
    ### ‍**Smart edge routing**
    
    Automatic edge routing avoids overlaps and reads cleanly at any zoom level. No manual layout work.
    
-   ![Workflow interface showing connected task blocks including 'Second Registration Check' and 'Send Welcome Email'.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698c3066f73755720c44e619_Elk%20Layout.avif)
    
    ### ELK auto-layout
    
    One-click auto-layout powered by ELK. Vertical, horizontal, layered - your call.
    
-   ![Flowchart showing Decisions linked to nodes with titles and subtitles, one with a lightning bolt icon.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698c30666e1347e45bc84b9d_Edge%20Reshaping.avif)
    
    ### Edge Reshaping
    
    Interactive handles let users adjust edge paths to taste. Pinch curves, drag waypoints, snap to grid.
    
-   ![Code snippet showing JSON changes: retries updated from 2 to 5 and timeout set to 30 in workflow.json.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3d138f7c903e02a5c820b9_JSON_feature.jpg)
    
    ### JSON serialization
    
    Workflow state in, workflow state out. Back-end-agnostic, version-control friendly, easy to diff.
    
-   ![Workflow UI showing nodes library, save button, and decision nodes for push notifications or email reminders.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698c30672eed17a831725361_Auto-save%20Functionality.avif)
    
    ### Auto-save and persistence
    
    Local-storage or your API endpoint - the editor saves as users type. No data loss on page refresh.
    
-   ![User interface showing Nodes Library with Custom node and Trigger options plus top toolbar icons.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3d13353998cbd794a48622_Undo%2Credo.png)
    
    ### Undo, redo, copy, paste
    
    Full history stack with multi-node selection. Keyboard shortcuts wired in. Production-grade editing UX.
    
-   ![User interface showing a workflow block labeled Notify Customer with toggle icons for light mode and structure view.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/698c306782d1249e183f2bad_Read-only%20mode.avif)
    
    ### Read-only Mode
    
    Display workflows to viewers without edit permissions. Same canvas, locked controls. Perfect for review queues and audit trails.
    

Built on a real design system

## A production design system, not just a UI kit

Workflow Builder ships on a full design system: design tokens (color, typography, spacing, radii), every editor component, and its variants and states. The same system lives in code (in the SDK) and in Figma for designers (Enterprise), so design and build never drift.

Design tokensEvery editor componentVariants and statesTheming – light and darkExample flows

Proof in production

## Case studies from teams who shipped on Workflow Builder

B2B SaaS teams across AI, data, and messaging use Workflow Builder as the editor layer of their product. Here are three of them.

Plura AI

### AI workflow editor for healthcare PMs

Plura AI embedded the visual workflow editor to let product teams design AI agent workflows visually. They ship the editor, their back-end runs the agents.

![Flowchart diagram of an AI-assisted call handling process showing AI conversations, external requests, ending calls, and knowledge base integration.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6978723a995f0f941eeeae5c_Plura.avif)

Athena Intelligence

### Code-first AI workflows for analyst teams

Athena Intelligence runs LangGraph behind a Workflow Builder canvas. End users see a visual graph; back-end runs Python agents and tools. Schema-driven properties panel handles every tool config.

![Screenshot of a contract summary workflow in plura.ai with a sidebar of document assets, a flowchart of steps including input, review, and report generation, and a results panel showing sales data.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6978723a0a6b08b69c2b113e_ee65a9d76e1243c042d52bbc3138087f_Athena.png)

Vercom

### Workflow automation for B2B messaging

Vercom shipped customer-facing workflow automation inside their messaging platform - email + SMS + push, with conditional branches and AI scoring nodes. Built on Workflow Builder in weeks, not months.

![Flowchart diagram of an AI-assisted call handling process showing AI conversations, external requests, ending calls, and knowledge base integration.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a1dd9f28afb5ba03f61f49d_97967ea3e53965f5cca4b5360dfa847a_Vercom.jpg)

Two ways to ship

## Built with you, or built for you

Buy the license and ship with your team. Or partner with the Workflow Builder team and let our engineers integrate it end-to-end into your product.

Build with your team

### Pick your tier – Community or Enterprise

Your engineers ship the product. Pick the level of source code and tooling you need.

Community Edition

freeApache 2.0

Full three-block stack on GitHub. Commercial use OK, white-label OK, no copyleft.

Enterprise Edition

EUR 6,990one-time

Source code access to advanced canvas plugins (edge routing, ELK layout, edge reshaping) and the design system in Figma.

Build with the Workflow Builder team

### Our AI engineering team ships it for you

The engineers who built the React SDK, available as an AI-driven engineering team. Two ways to engage:

Setup Sprint kickoff

2-4 weeksWe hand off

2-4 week kickoff to architect, set up, and transfer to your team.

End-to-end delivery

Project-basedWe own delivery

We own the build from discovery to production.

![Workflow interface showing an AI agent using GPT-4o with tools and memory, with conditional checks and actions like notifying platform, customer, waiting 24 hours, and sending email.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6979bc605f2b9b58e4b5117b_CTA_WB.avif)

CASE STUDIES

Frequently asked

## Questions teams ask before they pick WB

-   Is Workflow Builder the same as Builder.io?
    
    No. Builder.io is a visual page builder for marketing sites. Workflow Builder is a React SDK for embedding production workflow editors into B2B SaaS products. Different category, different buyer, different problem.
    
-   Is Workflow Builder a React Flow alternative?
    
    Yes and no. Workflow Builder is built on React Flow - not a replacement for it. If you want a raw node-based library to compose yourself, React Flow is the right choice. If you want a production-ready workflow editor with edge routing, auto-layout, schema-driven properties panel, and a production design system out of the box, Workflow Builder is the alternative you are looking for. [See the full comparison →](https://www.workflowbuilder.io/compare/react-flow)
    
-   What is included in the Enterprise license?
    
    EUR 6,990 one-time gets you source code access to Enterprise-only components - advanced canvas plugins (edge routing, ELK layout, edge reshaping, and more) and the design system in Figma. Community Edition (Apache 2.0) is free on GitHub and already includes the visual workflow editor, reference back-end, and Temporal adapter - white-label use is allowed on both editions. [See pricing details →](https://www.workflowbuilder.io/pricing)
    
-   Do I have to use Temporal for the back-end?
    
    No. Workflow Builder ships with three composable blocks: the editor (NPM), the reference back-end (GitHub, Apache 2.0), and engine integrations (swappable). Temporal is our reference adapter - you can integrate another execution engine without rewriting the editor, using the same port interfaces. [See engine integrations →](https://www.workflowbuilder.io/reference-stack)
    
-   Is the reference back-end open source?
    
-   How is this different from n8n or Zapier?
    
    n8n and Zapier are workflow automation products - they host the back-end, host the editor, you bring your account. Workflow Builder is a React SDK you embed in your product. You own the back-end, the data, the UX, the customer relationship. Different buyer, different problem. [See WB vs n8n →](https://www.workflowbuilder.io/compare/n8n)
    
-   What makes this workflow builder tool production-ready?
    
    A workflow builder UI library gives you a canvas. A production workflow builder tool ships the rest - schema-driven properties panels, smart edge routing, ELK auto-layout, JSON serialization, plugin architecture, theming, performance at 500+ nodes. That is the layer teams typically spend 14-25 weeks building on top of a library. Workflow Builder is library plus production layer in one React SDK. Used in production by Vercom, Athena Intelligence, and Plura AI.
    

### Take the blocks you need.

Start with the editor on npm. Add the reference back-end when you need execution.  
Talk to us when you want a partner to ship it for you.