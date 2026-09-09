> מקור: https://www.workflowbuilder.io/docs/api/store/openmodal/
> נשמר: 2026-09-09

# openModal

**openModal**(`__namedParameters`): `void`

Open a modal dialog with the given content + optional title / icon / footer. Resolves through the editor’s modal registry (one modal at a time; calling `openModal` while one is already visible replaces it).

Use it from a plugin to render a confirmation dialog, a settings picker, or any custom UI gated behind a button.

## Parameters

### __namedParameters

`ModalProps`

## Returns

`void`
