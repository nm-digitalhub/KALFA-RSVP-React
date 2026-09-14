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
