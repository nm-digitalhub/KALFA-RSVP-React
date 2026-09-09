# Workflow Builder - AI Agent Orchestration: Patterns, Platforms, and Who Draws the Graph

"Orchestration" means three different things depending on who's saying it, and the problem is that people say it as if it means one thing. Ask a platform engineer and you'll hear about retries and crash recovery. Ask the person building the agent and you'll hear about state and branching logic. Ask whoever has to sign off on what the agent is about to do, and – increasingly – you'll hear that nobody's built them a good answer yet.

All three are legitimate. Conflating them is how orchestration decisions get made without anyone deciding who owns the third one.

## Layer 1: does the process survive?

The oldest layer here is a distributed-systems problem with an AI-shaped label on it: if a step fails halfway through – a timeout, a crashed worker, an API returning a 500 – does the process recover, or does it just die?

This is where Temporal, Inngest, Restate, and Camunda sit. 

-   **Temporal** is the most established, running some of the most demanding durable-execution workloads in the industry, with a deterministic-replay model that's genuinely demanding to learn but extremely reliable once internalized.
-   **Inngest and Restate** trade some of that maturity and operational weight for a faster path to a working durable function. A real, concrete example? One team used Inngest specifically to manage video migration queues, valuing how much orchestration complexity it hid while still leaving enough surface area to implement unusual domain-specific logic without fighting the framework. 
-   **Camunda** comes from an entirely different lineage (BPMN-based business process orchestration) and fits organizations that already run it for compliance-heavy processes and want the same governance discipline extended to agentic ones, rather than introducing a second, code-first paradigm alongside it.

Temporal, Inngest, and Restate deliberately treat the work inside a step largely as an application concern: they persist progress, retry failures, and resume execution without deciding the agent’s internal reasoning. Camunda is the partial exception. Its BPMN-based model can govern process logic around agents, including tool calls, human review, and guardrails. Even so, the distinction still matters: durable execution and agent decision-making are separate architectural concerns, even when one platform spans parts of both.

## Layer 2: what does the agent do next?

This layer decides an agent’s behavior: which tool to call, which branch to take and when to loop back. LangGraph, CrewAI, Microsoft Agent Framework and Mastra are four prominent examples, while OpenAI Agents SDK belongs in the same discussion. We cover the tradeoffs between them in detail in our framework comparison.

The OpenAI SDK’s documented Temporal integration also makes the layered architecture unusually explicit: the SDK can handle agent logic while Temporal provides durable execution underneath.. 

**The short version: the runtime and the agent framework may work together, but they are not doing the same job.**

LangGraph models an agent as an explicit state graph with native checkpointing and human-in-the-loop support, which pays off once a workflow needs durable state or may wait on a person for hours. CrewAI’s role-based framing can get a multi-agent prototype in front of stakeholders quickly. Microsoft Agent Framework combines orchestration ideas developed in AutoGen with the enterprise foundations of Semantic Kernel, adding a graph-based workflow API across .NET and Python. Mastra is a natural fit for TypeScript teams that do not want to introduce Python just to ship an agent feature. OpenAI Agents SDK offers a smaller set of primitives around agents, tools, handoffs, guardrails and sessions, with durable integrations available when a run needs to survive long waits or process restarts.

What these tools have in common is more important than what separates them: the workflow logic still lives in code a developer wrote and a developer can inspect. That is fine until someone who is not that developer needs to interact with it.

There's a real, ongoing debate in the community about whether this layer should exist as a separate framework at all. Some teams evaluating LangChain, LangGraph, and the OpenAI Agents SDK in parallel have ended up building their own internal orchestration code rather than adopting any framework wholesale; while explicitly keeping the graph-based mental model, because they found the concept useful even when they didn't want the packaging around it. 

That's an extremely useful data point. The value some teams get from these frameworks isn't the framework itself, it's the conceptual model of explicit state and transitions, which can be extracted and reimplemented on your own terms. It also means "agent orchestration" didn't invent orchestration; more mature workflow engines existed long before agents did, and for some problems, they're still the better fit.

### Before orchestrating agents, define what's actually autonomous

**A distinction worth making explicit, because it changes what "orchestration" even needs to solve: a workflow is predefined orchestration, where the sequence of steps is fixed in advance.** 

An agent is something that dynamically directs its own process based on what it discovers along the way. A recurring observation in infrastructure discussions is that a lot of what gets marketed today as "agents" is, structurally, much closer to a workflow with a handful of non-deterministic steps embedded in it, not a swarm of independently reasoning agents. That's not a criticism. It's usually the right call. But it means the honest first question for any orchestration decision isn't "how do I orchestrate my agents," it's "which parts of this process are actually supposed to be autonomous, and which parts just look that way because an LLM happens to be involved."

That question has a very concrete, recent illustration. 

One practitioner building a coordination layer over several parallel coding-agent workers described trying direct agent-to-agent communication first – letting the agents negotiate and hand off work among themselves – and finding it became very hard to control. 

The fix was defining the task graph centrally, with a coordinator that routed structured outputs between workers rather than letting the agents structure that coordination themselves. They were using LangGraph underneath, and still built another orchestration layer on top of it – which is itself a useful data point: adopting a framework for agent logic doesn't mean that framework owns the entire orchestration problem, especially the coordination and hand-off layer between multiple agents.

This tracks with a broader pattern from production discussions: agents tend to actually work reliably once they're bounded closer to a targeted workflow for a specific use case, rather than left fully open-ended. The more production-critical a process becomes, the more teams tend to put explicit boundaries around agent autonomy, which is exactly the deterministic-to-dynamic spectrum this piece keeps returning to.

## Layer 3: the human interface for durable execution

This layer is easy to miss because most runtime vendors and framework maintainers stop at execution or developer-facing control. Camunda is an important exception: BPMN gives process teams a visual way to model and operate workflows, and the Camunda ecosystem also includes an embeddable BPMN toolkit. The remaining distinction is not simply visual versus code. It is the difference between a process-modeling tool or toolkit and a product-facing, white-label interface that a software company can place inside its own application for operators, reviewers or customers.

Once an agent moves from a developer's local environment into a product other people actually use, a new question shows up: who can see the workflow, who can adjust it, and who has to approve what it's about to do? A support lead adjusting an escalation threshold without filing a ticket. A compliance officer reviewing an approval path before it goes live. A customer who was sold a configurable AI feature and is looking at a support ticket instead of an interface.

Human intervention is, in fact, one of the clearest reasons explicit graph-based orchestration earns its complexity in the first place. A document moving through several review stages, an analyst correcting output mid-flow, trying an alternative path, rewinding to a specific state and continuing from there… that's the exact scenario where an explicit, inspectable graph stops being ceremony and starts being the feature. 

But being able to model that state explicitly in code is a different achievement from letting a non-developer actually operate it. Layer 2 solves the first. Nothing in layers 1 or 2 solves the second, because neither was built to.

There's a useful spectrum worth naming explicitly here, one that shows up repeatedly in how practitioners actually talk about this: fully deterministic orchestration on one end, where a runtime enforces every transition and the model only generates content within tightly bounded steps, and fully dynamic agent autonomy on the other, where the flow itself has to adapt based on what the agent discovers as it goes. Most production systems live somewhere in between, and where a given workflow sits on that spectrum changes what "who draws the graph" even means for it. A tightly bounded workflow might only need a human to approve specific gated actions. A more dynamic one needs someone who can actually see and reshape the structure itself.

That is the role of a visual authoring surface: representing the workflow, whatever runtime or framework sits underneath it, in a form that an authorized non-developer can inspect and edit. We call this the human interface for durable execution: the runtime keeps the process alive, the framework determines what the agent does next, and the interface is where the people accountable for the process can see, shape and approve it.

Workflow Builder is built specifically for that layer. It is an embeddable, white-label frontend SDK rather than a standalone orchestration engine. It stays engine-agnostic through public workflow-engine ports: the reference backend ships with a working Temporal adapter, while LangGraph and other runtimes can be connected by implementing the same interface for the project.

We go into that distinction in full in our [**LangGraph Studio guide**](http://workflowbuilder.io/blog/langgraph-studio-guide)**.**

## **Abstractions have to EARN their complexity**

It's worth taking the skeptical position seriously before accepting any of the above. There's a persistent and well-argued camp that believes agent frameworks (and to some extent, agent-specific orchestration in general) arrived before the underlying patterns were actually stable enough to abstract well. The core objection is tthat a meaningful share of real LLM applications still reduce to structured generation and ordinary application code, and wrapping that in framework abstractions before the patterns have proven durable adds complexity and lock-in without a clear return.

That skepticism is healthy, and it leads to a useful discipline: the first orchestration decision is sometimes to not introduce an orchestrator yet. If your workflow is a handful of sequential calls with limited branching, none of the three layers above may earn their cost. Layer 1 and Layer 2 tooling exist because certain workflows genuinely need durability and explicit state – not because every AI feature automatically qualifies as one of them. The same logic extends to Layer 3: a visual authoring layer is worth adopting when someone other than the original developer genuinely needs to see or touch the workflow, not as a default feature to bolt onto every agent by habit.

## **Execution, governance, and UX don't have to live in the same place**

A growing number of teams are building lightweight governance layers (cost limits, step limits, allow/deny policies, kill switches) as a control plane that sits alongside an agent framework rather than inside it. That's a healthy architectural instinct. It means execution ownership, policy ownership, and interface ownership can be three separate decisions made by three different parts of an organization, instead of one bundled choice that whoever picked the framework has to own alone.

That separation matters more now than it did even a year ago, because the compliance stakes have gone up. Enterprise AI guidance increasingly treats agentic systems as needing more than standard observability – runtime-level monitoring, reasoning traces that can be audited after the fact, stress testing, independent safety guardrails, and real controls over what credentials and systems an agent can touch. Once that's the bar, the graph stops being purely a developer artifact. It becomes an audit artifact, a policy artifact, and – increasingly – a product artifact that has to be shown to someone outside engineering entirely.

## **What the data says about where this actually stands**

The urgency here isn't hypothetical. Gartner has projected that as much as 40% of enterprise applications will include task-specific AI agents by the end of 2026, up from under 5% just a year earlier – and separately, that by 2027 roughly a third of agentic AI deployments will combine multiple specialized agents to handle more complex tasks, which only makes the orchestration question more urgent, not less.

At the same time, Gartner has also projected that over 40% of agentic AI projects could be canceled before the end of 2027, citing escalating costs, unclear business value, and inadequate risk controls – and, in a separate and more recent forecast, that roughly 40% of enterprises may scale back or withdraw autonomous AI agents by 2027 specifically because governance gaps only surface after a production incident, not before.

A [2026 Camunda-sponsored survey](https://camunda.com/state-of-agentic-orchestration-and-automation/) of 1,150 senior IT leaders and enterprise architects adds a useful, if vendor-affiliated, data point: 71% of organizations report using AI agents in some form, but only 11% of agentic AI use cases from the prior year actually reached production, and 73% acknowledge a real gap between their agentic AI vision and where they actually are. The same survey found 85% of respondents don't believe their organization has reached the process maturity agentic orchestration actually requires. Those numbers should be read as a survey commissioned by an orchestration vendor, not a neutral census – but even discounted for that, the direction is consistent with the independent Gartner projections above: adoption intent is far ahead of production reality, and the gap tends to show up as a governance and operability problem rather than a model-capability one.

## **Putting the three layers together**

1.  Your runtime choice answers whether this survives infrastructure failure. 
2.  Your framework choice answers how the agent decides what to do next. 
3.  Your visual layer choice answers who, besides the original developer, can see or touch any of it.

Most teams make the first two decisions carefully and arrive at the third by accident – usually months after launch, when someone asks "can I change this?" and the honest answer is "not without an engineer." Given how much data now points to governance and operability, not model quality, as the actual point of failure for agentic projects, that third decision deserves to be made on purpose, not discovered under pressure during a compliance review.

## Where this fits into your stack

If you're evaluating orchestration today, treat it as three separate decisions rather than one bundled choice. Get the runtime and framework right for your workload to cover the tradeoffs there in depth – and then decide deliberately who gets to see and shape the graph, before a customer or an auditor forces the question.

‍