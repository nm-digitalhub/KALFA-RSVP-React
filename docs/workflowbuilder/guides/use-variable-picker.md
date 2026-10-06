> מקור: https://www.workflowbuilder.io/docs/guides/use-variable-picker/
> נשמר: 2026-09-09

# Use Variable Picker

Guides
>
Use Variable Picker
Use Variable Picker

Insert references to data from earlier workflow steps into a downstream node's configuration using the variable picker.

The variable picker is a properties-panel control that lets you insert references to data from earlier workflow steps without hard-coding the value. Instead of a literal value, you point at an upstream node’s output (or the workflow’s trigger payload), and the real value is filled in when the workflow runs.

Where it works
Section titled “Where it works”

The picker is wired up on these built-in fields:

Node	Field	Picker
AI Agent	System prompt	Yes
Decision	Condition X and Y	Yes
Using the picker
Section titled “Using the picker”
Focus a supported field in the properties panel.
Type {{. A suggestions panel opens, grouped by upstream node, with each property’s label and description.
Pick a suggestion. The field shows a chip labeled {{ <Node Label> · <Property> }} (for example {{ Classify · Response }}). Continue typing around the chip to mix references with literal text. Press Esc or click outside to dismiss the panel.

The chip is the editor view; the diagram stores the raw form {{nodes.<nodeId>.<property>}}.

Suggestions come only from ancestor nodes - nodes reachable by following edges backward from the selected node. Each suggestion is built from the ancestor’s outputSchema, so a node only appears in the picker if it declares one.

Syntax
Section titled “Syntax”

A reference uses the form:

{{namespace.path}}

Paths use dot notation and can drill into nested keys of any object the upstream node emits:

{{nodes.ai-agent-1.response}}
{{nodes.trigger-1.payload.customer.email}}

A field can mix references with literal text:

Summarize the following request from {{nodes.trigger-1.payload.customer.name}}:


{{nodes.classify-1.response}}

The path syntax does not support array indexing, filters, or transforms - only nested key access on objects.

Namespaces
Section titled “Namespaces”

The SDK only stores these references as text on the diagram. Actual values are filled in later, when the workflow runs.

nodes.<nodeId>.<path>
Section titled “nodes.<nodeId>.<path>”

Output of an ancestor node, keyed by the node’s id. Surfaced in the picker. The available properties for each ancestor come from that node’s outputSchema.

For example, an AI Agent node emits response, tokensUsed, and model, so a downstream field can reference any of:

{{nodes.<ai-agent-id>.response}}
{{nodes.<ai-agent-id>.tokensUsed}}
{{nodes.<ai-agent-id>.model}}
trigger.<path>
Section titled “trigger.<path>”

The raw payload that started the current workflow run - exactly as it was received. Manual entry only - not surfaced in the picker today. Type the reference yourself:

{{trigger.orderId}}
{{trigger.customer.email}}

Typing {{ opens the suggestions panel, which only lists ancestor-node properties - keep typing past it to enter a trigger.* reference as plain text.

Note

trigger.<path> and nodes.<triggerNodeId>.<path> are not the same thing. trigger.<path> is the unprocessed input that started the run; nodes.<triggerNodeId>.<path> is whatever the trigger node emitted - which may transform or repackage the original payload.

variables.<path>
Section titled “variables.<path>”

Globals and secrets available at the start of each run. Manual entry only - not surfaced in the picker today. Type the reference yourself:

{{variables.apiBaseUrl}}
{{variables.tenantId}}

The set of available variables depends on how your workflow runner is configured.

Missing values
Section titled “Missing values”

A plain reference is strict: if the resolver cannot find the path in the execution context, the workflow run fails with Unresolved template reference: {{…}}. That is deliberate - a typo in a prompt template should be caught on the first run, not silently substituted with an empty string and shipped to the LLM.

For paths that may genuinely be absent some of the time (an optional trigger field, a node output that only exists on one branch of a decision), two opt-in modifiers let you declare a fallback:

Form	When path is missing
{{nodes.x.response}}	throws (strict)
{{nodes.x.response?}}	resolves to ''
{{nodes.x.response | default:'tbd'}}	resolves to 'tbd'
Hello, {{trigger.customer.name?}}!
Status: {{nodes.classify-1.label | default:'unclassified'}}

A modifier fires only when the resolved value is strictly undefined - i.e. the namespace, the node, or one of the dot-path segments does not exist on the live execution context. null, '', and 0 are real values: a node that emits { count: 0 } resolves {{nodes.x.count?}} to '0', not to the fallback. Pick the modifier deliberately when the absence of a value is what you want to handle.

The default:'…' syntax requires single quotes, and the value cannot contain a single quote. Use ? if you need an empty fallback.

Examples
Section titled “Examples”
Example 1: Pass an AI Agent’s response into the next AI Agent
Section titled “Example 1: Pass an AI Agent’s response into the next AI Agent”
Drop two AI Agent nodes onto the canvas and connect them: Classify -> Respond.
Configure Classify with a prompt that produces a category, e.g. “Classify the following request as one of: refund, support, sales.”
Open Respond. Focus the System prompt field and type {{.
From the picker, choose Classify · Response. The field renders a chip labeled {{ Classify · Response }}; the diagram stores it as {{nodes.<classify-id>.response}}.
Type the rest of the prompt around the chip. The editor view looks like this:
You are responding to a request that has been classified as: {{ Classify · Response }}.


Answer in two sentences, in the tone appropriate for that category.
Example 2: Branch on a value in the trigger payload
Section titled “Example 2: Branch on a value in the trigger payload”
Drop a Decision node downstream of your trigger.
Add a branch labeled High priority, with one condition.
In the condition’s X field, type the reference manually (the picker does not surface trigger.<path> today):
{{trigger.priority}}
Set the comparison operator to is equal.
Set the Y field to the literal high.
Add the picker to a custom node
Section titled “Add the picker to a custom node”
Make a field accept references
Section titled “Make a field accept references”

In the node’s UI schema, use VariableText (single-line) or VariableTextArea (multi-line) instead of Text / TextArea:

{
  type: 'VariableTextArea',
  scope: scope('properties.systemPrompt'),
  placeholder: 'Use {{ to insert variables',
  minRows: 5,
}

The control behaves like the matching plain control, except {{ opens the suggestions panel.

Expose the node’s outputs to downstream pickers
Section titled “Expose the node’s outputs to downstream pickers”

Add an outputSchema to the node’s PaletteItem. Each entry describes one output property the node will emit:

import type { PaletteItem } from '@workflowbuilder/sdk';


export const myNode: PaletteItem = {
  // ...label, type, schema, defaults, uischema
  outputSchema: {
    properties: {
      response: { type: 'string', label: 'Response', description: 'The text returned by the model' },
      tokensUsed: { type: 'number', label: 'Tokens Used' },
    },
  },
};

Without an outputSchema, the node never appears as a group in any downstream picker.

See also
Section titled “See also”
Add a custom node - register a new node type that participates in the picker
AI Agent node - uses the picker on the system prompt
Decision node - uses the picker on condition operands
Previous
Build a plugin
Next
Save Diagrams to Database

## בלוקי קוד

```
{{namespace.path}}
```

```
{{nodes.ai-agent-1.response}}
{{nodes.trigger-1.payload.customer.email}}
```

```
Summarize the following request from {{nodes.trigger-1.payload.customer.name}}:

{{nodes.classify-1.response}}
```

```
{{nodes.<ai-agent-id>.response}}
{{nodes.<ai-agent-id>.tokensUsed}}
{{nodes.<ai-agent-id>.model}}
```

```
{{trigger.orderId}}
{{trigger.customer.email}}
```

```
{{variables.apiBaseUrl}}
{{variables.tenantId}}
```

```
Hello, {{trigger.customer.name?}}!
Status: {{nodes.classify-1.label | default:'unclassified'}}
```

```
You are responding to a request that has been classified as: {{ Classify · Response }}.

Answer in two sentences, in the tone appropriate for that category.
```

```
{{trigger.priority}}
```

```
{
  type: 'VariableTextArea',
  scope: scope('properties.systemPrompt'),
  placeholder: 'Use {{ to insert variables',
  minRows: 5,
}
```

```
import type { PaletteItem } from '@workflowbuilder/sdk';

export const myNode: PaletteItem = {
  // ...label, type, schema, defaults, uischema
  outputSchema: {
    properties: {
      response: { type: 'string', label: 'Response', description: 'The text returned by the model' },
      tokensUsed: { type: 'number', label: 'Tokens Used' },
    },
  },
};
```


## קישורים חיצוניים

- [GitHub](https://github.com/synergycodes/workflowbuilder)
- [YouTube](https://www.youtube.com/@workflowbuilder)
- [Discord](https://discord.com/invite/FDMjRuarFb)
- [Contact Us](https://www.workflowbuilder.io/contact)
