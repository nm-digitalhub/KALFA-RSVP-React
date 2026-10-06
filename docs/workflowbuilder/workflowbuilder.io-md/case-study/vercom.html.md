# Workflow-based RCS campaign builder: Vercom case study

## Challenge

!["Vercom" logo](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b806f2f51f36474e4c5949_Vercom_logo.svg)!["MessageFlow" logo](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b806f2614ec250635bb22e_Messageflow_logo.svg)

Vercom S.A., the company behind the enterprise messaging platform MessageFlow, needed a visual workflow builder for RCS (Rich Communication Services) marketing campaigns. Their enterprise clients required a no-code solution to design complex customer journeys without developer dependency.

Because RCS operates within the broader CPaaS ecosystem (combining carrier infrastructure, data orchestration, personalization, and compliance at scale) the several-month initiative required a full cross-functional team to deliver an enterprise-grade solution.

Open source couldn't scale

Existing libraries lacked RCS-specific features and couldn't handle enterprise complexity.  While open‑source works for experimentation, enterprise teams like Vercom need proven architecture backed by domain experts and long‑term product reliability – which Workflow Builder delivered out of the box.

Integration constraints

The solution had to embed into Vercom's existing CPaaS platform and backend systems

Brand consistency required

Generic white-label tools wouldn't work, the interface needed to match Vercom's design system

Usability for marketing teams

Non-technical users needed to build campaigns independently, with intuitive UX and guided configuration

Foundation over framework

Vercom chose Workflow Builder as their starting point, production-ready components instead of building from scratch

## RCS-specific node types

Purpose-built workflow nodes for marketing campaign automation

## Static & dynamic carousels

Pre-designed product showcases or API-driven content pulled in real-time from inventory systems

![A diagram built with six nodes connected to each other with dashed lines.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b806fc9ce0a3b8efc82044_Static%E2%80%AFCarousel.avif)

## Decision & validation logic

Conditional routing based on user responses, with Speedway validation to catch campaign errors before launch

![A diagram built with six nodes connected to each other with dashed lines.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b806fcec514301c537945f_820cbd548e5138e82fe09530d779f052_Speedway%E2%80%AFLogic%E2%80%AFFlow.jpg)

## API integration nodes

Connect to Vercom's backend for real-time data, CRM triggers, and system actions

![A single node of a diagram presenting an external request option.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b806fc4fc114b688dc55a6_98fa86f2c3889041214c88e6b28e08b1_API%20integration%20nodes.jpg)

## Global campaign settings

Centralized panel for campaign-wide variables, audience filters, and fallback logic

![A single node of a diagram presenting an external request option.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b806fc40d44879bbcd5b0e_Global%E2%80%AFPanel%E2%80%AF.avif)

![A single node of a diagram presenting an external request option.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b806fc65fd3b5fc8ca4bfd_Axiom%20design%20system.avif)

## Branded design system

Workflow Builder Design System tokens adapted to Vercom's visual identity

![A single node of a diagram presenting an external request option.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b806fc04b4ed2334f5c605_Token-based.avif)

## Token-based theming

Colors, typography, spacing, and components customized to match Vercom's platform

![A single node of a diagram presenting an external request option.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b806fc7ee4662741848501_Embedded%20experience.avif)

## Native platform feel

RCS Flow Studio launches from Vercom's dashboard with zero visual disconnect

## Guided configuration for marketers

Built-in contextual help and inline tips eliminate the need for training manuals

Self-explaining interface

Every node includes configuration hints, examples, and validation feedback

Visual campaign preview

Marketers see how carousels and messages appear on mobile before sending

![A single node of a diagram presenting an external request option.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b806fce7407166a9c427d7_Contextual%20help%20and%20tips.avif)

![Quote icon](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6973529c0075a134da950191_Quote.svg)

I was looking for solutions that weren't just code libraries. I needed something built by people who'd solved this problem before. When I found Workflow Builder, I saw real case studies, not just documentation.

Adam Lewkowicz

Founder & CTO,Vercom

## Solution

Workflow Builder's React SDK delivered a foundation that Vercom customized for RCS campaigns:

### Design token flexibility

Workflow Builder Design System enabling complete brand customization without rebuilding components

![A single node with a text on it informing that in Workflow Builder users can build custom nodes wih unique properties.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b807045f261e463e6a73e3_Design_tokens.avif)

### Backend-agnostic integration

Clean API layer connecting to Vercom's existing CPaaS infrastructure and RCS services

![Two linked to each other nodes.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b80704109e305f418daf31_API.avif)

![Two linked to each other nodes.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b807047d85cc7e5e9d1c6e_RF.avif)

### React Flow foundation

Proven node architecture handling rendering, connections, and state management

### Production-ready components

Pre-built panels, forms, and interactions that work out of the box

![A fragment of Workflow Builder's UI presenting a sidebar with features and functionalities, top navigation bar, a logotype, and part of a workflow diagram built on canvas.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/69b807048d58446de99e4aa4_COmponents.avif)

Workflow Builder is a frontend-first foundation for creating complex workflow editors, designed for seamless integration with any backend. It delivers everything needed to design workflows faster (from drag-and-drop nodes to fully customizable layouts) and is powered by 15 years of diagramming expertise from the team behind it.

[

Schedule expert consultation



](https://www.workflowbuilder.io/contact)

## **Outcome**

Vercom shipped RCS Flow Studio ahead of schedule and within budget, using Workflow Builder to cut development by months and free up their frontend team for other core projects.

It's a flagship validation of Workflow Builder’s ability to power complex, large-scale enterprise products like Vercom’s MessageFlow platform, with confidence and scalability at their core.

Delivered before backend integration

Development finished ahead of Vercom's own backend team.

Category-first RCS solution

RCS Flow Studio is setting a competitive standard as the most user‑friendly tool on the market.

Maximum quality score

The client gave the project the highest score in their internal quality assessment.

### Technology

**Frontend:** React, TypeScript

**Foundation:** Workflow Builder SDK (React Flow, JSON Forms, Vite)

**Integration:** REST API to Vercom's CPaaS backend

**Design:** Custom token-based theme (Workflow Builder Design System → Vercom)

**Deployment:** Embedded in Vercom's existing platform

## Are you…

![A fragment of Workflow Builder's UI presenting a sidebar with features and functionalities, top navigation bar, a logotype, and part of a workflow diagram built on canvas.](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6817caa338697d8a1f46b9ae_workflow_builder.jpg)

![icon of a check mark](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/67c0321e1f8276da8258e5cb_check.svg)

### Looking for a unified tool that brings your planning and execution together?

![icon of a check mark](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/67c0321e1f8276da8258e5cb_check.svg)

### In need of a flexible solution to manage complex, AI-driven workflows effortlessly?

![icon of a check mark](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/67c0321e1f8276da8258e5cb_check.svg)

### Ready to power your team up with an intuitive, scalable platform?

**Schedule expert consultation** and discover how our Workflow Builder can change your business.