> מקור: https://www.workflowbuilder.io/docs/node-schemas/form-overview/
> נשמר: 2026-09-09

# Form overview

Node Schemas
>
Form overview
Form overview

How a node's uischema describes the form rendered in the property panel — controls, layouts, labels.

A node’s uischema.ts declares the form rendered in the property panel when that node is selected. It’s a tree of elements; each element’s type decides how its branch renders — a text input, a select, a switch, a horizontal row, an accordion, and so on. This page introduces the shape; the two reference pages below catalogue every built-in element type with its props and a copy-pasteable example.

Three element families:

Family	What it does
Controls	Input fields bound to a property — Text, Select, Switch, DynamicConditions, …
Layouts	Containers that arrange child elements — VerticalLayout, HorizontalLayout, Group, Accordion.
Labels	Text-only elements that don’t bind to a property — Label, RichText.
Quick example
Section titled “Quick example”
import type { UISchema } from '@workflowbuilder/sdk';


export const uischema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: '#/properties/label' },
    { type: 'Select', scope: '#/properties/method' },
    {
      type: 'Accordion',
      label: 'Advanced',
      elements: [
        { type: 'Switch', scope: '#/properties/retryOnFailure' },
        { type: 'TextArea', scope: '#/properties/headers', minRows: 3 },
      ],
    },
  ],
};

The element’s scope is a JsonPointer-style path into the matching schema.ts — use getScope to build it from a typed dot-path instead of writing the string by hand.

Custom element types
Section titled “Custom element types”

Element types not on these pages (e.g. 'ColorPicker', your own) require a custom JsonForms renderer — see Custom JsonForms control.

Conditional rendering
Section titled “Conditional rendering”

Every element accepts an optional rule field that shows / hides / enables / disables it based on other property values. The shape is the same as JsonForms’s rule object — see the conditional-fields walk-through in Add a custom node.

See also
Section titled “See also”
Data schema — the JSON-Schema half: types, validation, options
Form controls — every built-in control type with its props and an example
Form layouts — VerticalLayout, HorizontalLayout, Group, Accordion
Add a custom node — full walk-through of authoring schema.ts + uischema.ts
UISchema, getScope — auto-generated type reference
Previous
Data schema
Next
Form controls

## בלוקי קוד

```
import type { UISchema } from '@workflowbuilder/sdk';

export const uischema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: '#/properties/label' },
    { type: 'Select', scope: '#/properties/method' },
    {
      type: 'Accordion',
      label: 'Advanced',
      elements: [
        { type: 'Switch', scope: '#/properties/retryOnFailure' },
        { type: 'TextArea', scope: '#/properties/headers', minRows: 3 },
      ],
    },
  ],
};
```


## קישורים חיצוניים

- [GitHub](https://github.com/synergycodes/workflowbuilder)
- [YouTube](https://www.youtube.com/@workflowbuilder)
- [Discord](https://discord.com/invite/FDMjRuarFb)
- [Contact Us](https://www.workflowbuilder.io/contact)
- [rule object](https://jsonforms.io/docs/uischema/rules/)
