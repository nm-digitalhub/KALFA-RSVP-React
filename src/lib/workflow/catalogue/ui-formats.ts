// Names that join a uischema element to the custom JsonForms renderer that draws
// it.
//
// Its own module, and deliberately tiny, because the two ends live on opposite
// sides of a boundary that must not be crossed the other way: `schemas.ts` is
// catalogue data, the renderer is a React component, and neither should import
// the other. A shared constant is the whole contract.
//
// Matched with the SDK's `optionIs('format', …)` tester. See
// header-rows-control.tsx.

/** An editable list of `{ name, value }` HTTP header rows. */
export const HEADER_ROWS_FORMAT = 'kalfa-header-rows';

/** A multi-select stored as an open array of strings. */
export const CHECKBOX_LIST_FORMAT = 'kalfa-checkbox-list';

/** A stored connection UUID plus the workflow-local "connect account" action. */
export const INTEGRATION_CONNECTION_FORMAT = 'integration-connection';

/** A generated webhook token: shown once, stored only as its hash. */
export const WEBHOOK_TOKEN_FORMAT = 'webhook-token';

/**
 * A read-only report of what the selected node did on the run being watched.
 *
 * ⚠️ NOT A FIELD, AND DELIBERATELY A `Label`. It edits nothing and stores
 * nothing — the uischema element is the SDK's own `LabelElement`, the closest
 * thing its closed union has to "render something here", and the renderer
 * replaces it wholesale. `text` is therefore never drawn; it exists because the
 * type requires one.
 */
export const NODE_RUN_FORMAT = 'kalfa-node-run';
