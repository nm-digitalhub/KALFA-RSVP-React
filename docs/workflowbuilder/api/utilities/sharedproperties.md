> מקור: https://www.workflowbuilder.io/docs/api/utilities/sharedproperties/
> נשמר: 2026-09-09

# sharedProperties

`const` **sharedProperties**: `BaseNodePropertiesSchema`

Reusable schema fragment for the properties every node carries by default: `label` and `description`. Spread this into a custom `NodeSchema['properties']` to avoid redeclaring them per node type.
