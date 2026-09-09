> מקור: https://www.workflowbuilder.io/docs/api/constants/variable_nodes_key/
> נשמר: 2026-09-09

# VARIABLE_NODES_KEY

`const` **VARIABLE_NODES_KEY**: `"nodes"` = `'nodes'`

Reserved key under which the variable-text control looks up the available upstream nodes when expanding `{{nodes.*}}` placeholders. Plugins that compose alternative variable sources should namespace their own keys to avoid colliding with this reserved value.
