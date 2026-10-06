> מקור: https://www.workflowbuilder.io/docs/node-schemas/form-controls/
> נשמר: 2026-09-09

# Form controls

Node Schemas
>
Form controls
Form controls

Every built-in control element accepted by a node's uischema, with props and an example for each.

Controls are leaf elements that bind to a property in a node’s schema.ts via scope. The control type decides how the editor renders that property in the property panel — text input, select, switch, date picker, and so on.

Every control accepts:

Prop	Type	Required	Notes
type	string literal	yes	One of the values listed below.
scope	string	yes	JsonPointer-style path into schema.ts. Use getScope to build it from a typed dot-path.
rule	object	no	Conditional show/hide/enable/disable. JsonForms rule shape. See Conditional fields.
errorIndicatorEnabled	boolean	no	Default true. Set to false to suppress the per-field error icon.

Type-specific props are listed under each control below.

Text
Section titled “Text”

Single-line text input, bound to a string property.

Prop	Type	Required	Notes
inputType	string	no	HTML input type (e.g. 'email', 'url', 'password'). Defaults to 'text'.
placeholder	string	no	Empty-state hint.
{ type: 'Text', scope: '#/properties/label', placeholder: 'Node title' }
TextArea
Section titled “TextArea”

Multi-line text input, bound to a string property.

Prop	Type	Required	Notes
placeholder	string	no	Empty-state hint.
minRows	number	no	Minimum visible rows before scroll appears.
{ type: 'TextArea', scope: '#/properties/description', minRows: 3 }
Switch
Section titled “Switch”

On/off toggle, bound to a boolean property.

{ type: 'Switch', scope: '#/properties/retryOnFailure' }
Select
Section titled “Select”

Dropdown picker, bound to a string property. Options come from the property’s options array in schema.ts:

schema.ts
{
  method: {
    type: 'string',
    options: [
      { label: 'GET', value: 'GET' },
      { label: 'POST', value: 'POST' },
    ],
  },
}
uischema.ts
{ type: 'Select', scope: '#/properties/method' }
DatePicker
Section titled “DatePicker”

Calendar picker, bound to a date property. The schema field is declared as type: 'string' and serialised as an ISO 8601 string at the JSON layer, but the renderer receives — and the handleChange callback emits — a JavaScript Date object.

{ type: 'DatePicker', scope: '#/properties/scheduledFor' }
DynamicConditions
Section titled “DynamicConditions”

Composer for an array of comparison rows — used in nodes that branch on upstream values. Each row is a DynamicCondition with two operands, a ComparisonOperator, and a logical join ('AND' / 'OR').

The x and y operands accept literal strings or {{nodes.<id>.<output>}} placeholders that resolve against upstream node outputs at runtime.

schema.ts
{
  conditions: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        x: { type: 'string' },
        y: { type: 'string' },
        comparisonOperator: { type: 'string' },
        logicalOperator: { type: 'string' },
      },
    },
  },
}
uischema.ts
{ type: 'DynamicConditions', scope: '#/properties/conditions' }
DecisionBranches
Section titled “DecisionBranches”

Composer for an array of named branches — used by decision-style nodes. Each branch has its own label, source handle, and a list of DynamicCondition rows. Renders one collapsible panel per branch with full add / remove / reorder UI.

{ type: 'DecisionBranches', scope: '#/properties/branches' }
AiTools
Section titled “AiTools”

Repeater control for the tools array on AI-agent nodes — each row is { id, sourceHandle, tool, description, apiKey }. Surface specific to the demo’s AI-agent node; only relevant if you ship a similarly-shaped node type.

{ type: 'AiTools', scope: '#/properties/tools' }
VariableText
Section titled “VariableText”

Single-line text input that also accepts {{nodes.<id>.<output>}} placeholders. Renders an inline picker that suggests upstream node outputs as the user types {{. Bound to a string property.

Prop	Type	Required	Notes
placeholder	string	no	Empty-state hint.
{ type: 'VariableText', scope: '#/properties/url', placeholder: 'https://...' }
VariableTextArea
Section titled “VariableTextArea”

Multi-line variant of VariableText. Same {{...}} placeholder behaviour.

Prop	Type	Required	Notes
placeholder	string	no	Empty-state hint.
minRows	number	no	Minimum visible rows before scroll appears.
{ type: 'VariableTextArea', scope: '#/properties/messageBody', minRows: 4 }
MessageOnError
Section titled “MessageOnError”

Inline message that surfaces when a node-level validation error matches the scope. Renders nothing if there’s no error on that property — useful for context-specific guidance (“This input requires an upstream variable”) next to the affected field.

Prop	Type	Required	Notes
text	string	no	Override the auto-derived error text. If omitted, the message comes from the validation error itself.
{
  type: 'MessageOnError',
  scope: '#/properties/missingPreviousVariable',
  text: 'This field needs a variable from an upstream node.',
}
See also
Section titled “See also”
Form overview — overview that pairs the UI layer with the data-schema layer
Form layouts — containers that group these controls into a layout
Add a custom node — full walk-through of authoring schema.ts + uischema.ts
Custom JsonForms control — how to add element types not on this page
UISchema, getScope — auto-generated type reference
Previous
Form overview
Next
Form layouts

## בלוקי קוד

```
{ type: 'Text', scope: '#/properties/label', placeholder: 'Node title' }
```

```
{ type: 'TextArea', scope: '#/properties/description', minRows: 3 }
```

```
{ type: 'Switch', scope: '#/properties/retryOnFailure' }
```

```
{
  method: {
    type: 'string',
    options: [
      { label: 'GET', value: 'GET' },
      { label: 'POST', value: 'POST' },
    ],
  },
}
```

```
{ type: 'Select', scope: '#/properties/method' }
```

```
{ type: 'DatePicker', scope: '#/properties/scheduledFor' }
```

```
{
  conditions: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        x: { type: 'string' },
        y: { type: 'string' },
        comparisonOperator: { type: 'string' },
        logicalOperator: { type: 'string' },
      },
    },
  },
}
```

```
{ type: 'DynamicConditions', scope: '#/properties/conditions' }
```

```
{ type: 'DecisionBranches', scope: '#/properties/branches' }
```

```
{ type: 'AiTools', scope: '#/properties/tools' }
```

```
{ type: 'VariableText', scope: '#/properties/url', placeholder: 'https://...' }
```

```
{ type: 'VariableTextArea', scope: '#/properties/messageBody', minRows: 4 }
```

```
{
  type: 'MessageOnError',
  scope: '#/properties/missingPreviousVariable',
  text: 'This field needs a variable from an upstream node.',
}
```


## קישורים חיצוניים

- [GitHub](https://github.com/synergycodes/workflowbuilder)
- [YouTube](https://www.youtube.com/@workflowbuilder)
- [Discord](https://discord.com/invite/FDMjRuarFb)
- [Contact Us](https://www.workflowbuilder.io/contact)
- [rule shape](https://jsonforms.io/docs/uischema/rules/)
