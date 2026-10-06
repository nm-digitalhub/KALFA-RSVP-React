> מקור: https://www.workflowbuilder.io/docs/node-schemas/form-layouts/
> נשמר: 2026-09-09

# Form layouts

Node Schemas
>
Form layouts
Form layouts

Container element types that arrange child elements — VerticalLayout, HorizontalLayout, Group, Accordion. Plus the two text-only label types.

Layouts are container elements that group child elements into a visual structure. Unlike controls, they don’t bind to a property — they just arrange other elements.

Every layout accepts:

Prop	Type	Required	Notes
type	string literal	yes	One of 'VerticalLayout', 'HorizontalLayout', 'Group', 'Accordion'.
elements	UISchema[]	yes	Child elements rendered inside this container. Can be controls, other layouts, or labels. (UISchema is the alias re-exported from the barrel; internally UISchema = UISchemaElement.)
rule	object	no	Conditional show/hide/enable/disable. JsonForms rule shape. See Conditional fields.

Type-specific props are listed under each layout below.

VerticalLayout
Section titled “VerticalLayout”

Stacks children top-to-bottom. The default container — most uischemas wrap their root in VerticalLayout.

{
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: '#/properties/label' },
    { type: 'Text', scope: '#/properties/url' },
    { type: 'Switch', scope: '#/properties/retryOnFailure' },
  ],
}
HorizontalLayout
Section titled “HorizontalLayout”

Arranges children left-to-right in a CSS grid row.

Prop	Type	Required	Notes
layoutColumns	string	no	CSS grid-auto-columns value — controls each child’s width. Examples: '1fr 2fr' (first child half the width of the second), '100px 1fr', 'auto' (default — children size themselves).
{
  type: 'HorizontalLayout',
  layoutColumns: '1fr 1fr',
  elements: [
    { type: 'Text', scope: '#/properties/firstName' },
    { type: 'Text', scope: '#/properties/lastName' },
  ],
}
Group
Section titled “Group”

Rendered as a labeled section with a header and a border around its children. Use it to visually group related fields.

Prop	Type	Required	Notes
label	string	yes	Section header shown at the top.
{
  type: 'Group',
  label: 'Authentication',
  elements: [
    { type: 'Text', scope: '#/properties/username' },
    { type: 'Text', scope: '#/properties/password', inputType: 'password' },
  ],
}
Accordion
Section titled “Accordion”

Collapsible labeled section — header + chevron, body hidden by default. Useful for advanced or rarely-used fields that shouldn’t crowd the default property panel view.

Prop	Type	Required	Notes
label	string	yes	Header text shown next to the expand chevron.
{
  type: 'Accordion',
  label: 'Advanced',
  elements: [
    { type: 'Switch', scope: '#/properties/debugMode' },
    { type: 'TextArea', scope: '#/properties/customHeaders', minRows: 3 },
  ],
}
Labels
Section titled “Labels”

Text-only elements that don’t bind to a property. Use them when the property panel needs a heading, divider, or static guidance.

Label
Section titled “Label”

Plain text label — uses the editor’s default body styling.

Prop	Type	Required	Notes
text	string	yes	The label text.
required	boolean	no	Append a * to indicate the following section contains required fields.
size	ItemSize	no	Visual size — 'small', 'medium' (default), 'large'. Type re-exported from overflow-ui.
{ type: 'Label', text: 'Connection details' }
RichText
Section titled “RichText”

Same as Label, but renders Markdown — bold, italics, inline links. Useful for short instructional copy that needs formatting.

Prop	Type	Required	Notes
text	string	yes	Markdown source.
required	boolean	no	Same semantics as Label.
size	ItemSize	no	Same semantics as Label.
{
  type: 'RichText',
  text: 'See the [authentication guide](https://example.com/auth) for setup steps.',
}
Combining layouts
Section titled “Combining layouts”

Layouts nest freely — a typical uischema is a VerticalLayout at the root with Accordions for advanced sections and HorizontalLayouts for paired fields:

{
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: '#/properties/label' },
    {
      type: 'HorizontalLayout',
      elements: [
        { type: 'Text', scope: '#/properties/firstName' },
        { type: 'Text', scope: '#/properties/lastName' },
      ],
    },
    {
      type: 'Accordion',
      label: 'Advanced',
      elements: [
        { type: 'Switch', scope: '#/properties/debugMode' },
        { type: 'TextArea', scope: '#/properties/customHeaders', minRows: 3 },
      ],
    },
  ],
}
See also
Section titled “See also”
Form overview — overview that pairs the UI layer with the data-schema layer
Form controls — input fields placed inside these layouts
Add a custom node — full walk-through of authoring schema.ts + uischema.ts
UISchema — auto-generated type reference
Previous
Form controls
Next
Built-in Nodes Overview

## בלוקי קוד

```
{
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: '#/properties/label' },
    { type: 'Text', scope: '#/properties/url' },
    { type: 'Switch', scope: '#/properties/retryOnFailure' },
  ],
}
```

```
{
  type: 'HorizontalLayout',
  layoutColumns: '1fr 1fr',
  elements: [
    { type: 'Text', scope: '#/properties/firstName' },
    { type: 'Text', scope: '#/properties/lastName' },
  ],
}
```

```
{
  type: 'Group',
  label: 'Authentication',
  elements: [
    { type: 'Text', scope: '#/properties/username' },
    { type: 'Text', scope: '#/properties/password', inputType: 'password' },
  ],
}
```

```
{
  type: 'Accordion',
  label: 'Advanced',
  elements: [
    { type: 'Switch', scope: '#/properties/debugMode' },
    { type: 'TextArea', scope: '#/properties/customHeaders', minRows: 3 },
  ],
}
```

```
{ type: 'Label', text: 'Connection details' }
```

```
{
  type: 'RichText',
  text: 'See the [authentication guide](https://example.com/auth) for setup steps.',
}
```

```
{
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: '#/properties/label' },
    {
      type: 'HorizontalLayout',
      elements: [
        { type: 'Text', scope: '#/properties/firstName' },
        { type: 'Text', scope: '#/properties/lastName' },
      ],
    },
    {
      type: 'Accordion',
      label: 'Advanced',
      elements: [
        { type: 'Switch', scope: '#/properties/debugMode' },
        { type: 'TextArea', scope: '#/properties/customHeaders', minRows: 3 },
      ],
    },
  ],
}
```


## קישורים חיצוניים

- [GitHub](https://github.com/synergycodes/workflowbuilder)
- [YouTube](https://www.youtube.com/@workflowbuilder)
- [Discord](https://discord.com/invite/FDMjRuarFb)
- [Contact Us](https://www.workflowbuilder.io/contact)
- [rule shape](https://jsonforms.io/docs/uischema/rules/)
