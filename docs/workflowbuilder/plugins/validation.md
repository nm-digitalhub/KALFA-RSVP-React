> מקור: https://www.workflowbuilder.io/docs/plugins/validation/
> נשמר: 2026-09-09

# Validation

Plugins
>
Validation
Validation

Additional logic for working with JSON forms, adding diagram-based validation for detecting broken references and missing edges.

Enterprise

This plugin is available with the Enterprise license. Contact us to request a demo or discuss licensing.

This plugin adds diagram-based validation on top of @jsonforms validation using additionalErrors property (more).

It detects structural errors in the diagram - for example, when a node references a variable computed in a previous node but the connection to that node has been removed, or when required edges are missing.

Because it builds on @jsonforms, diagram errors behave like standard form validation errors (such as empty required fields), giving a consistent validation experience across forms and the canvas.

Use cases
Section titled “Use cases”
Detect when a node uses variables from a previous node but is no longer connected to it.
Flag missing required edges between nodes.
Surface diagram-level errors alongside form-level validation in a unified way.
See also
Section titled “See also”
Properties sidebar - schema-driven forms in the properties panel
Conditional node - branching node that uses validation to verify references
Decision node - branching node with multi-way routing
Previous
Flow Runner
Next
Download PDF

## קישורים חיצוניים

- [GitHub](https://github.com/synergycodes/workflowbuilder)
- [YouTube](https://www.youtube.com/@workflowbuilder)
- [Discord](https://discord.com/invite/FDMjRuarFb)
- [Contact Us](https://www.workflowbuilder.io/contact)
- [more](https://jsonforms.io/docs/validation#external-validation-errors)
