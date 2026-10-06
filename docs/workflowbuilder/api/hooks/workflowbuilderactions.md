> מקור: https://www.workflowbuilder.io/docs/api/hooks/workflowbuilderactions/
> נשמר: 2026-09-09

# WorkflowBuilderActions

**WorkflowBuilderActions** = `object`

Imperative action surface for a custom layout that omits `<WorkflowBuilder.TopBar />`. Mirrors every command the built-in app bar exposes (`save`, modal openers, read-only and theme toggles) and adds programmatic layout-direction control, which the bar itself does not offer.

Stable across renders while the active integration and the mounted React Flow instance are stable (layout actions close over the fit-view callback, which is keyed on that instance).

## Properties

### openExport

**openExport**: () => `void`

Open the export-diagram modal.

#### Returns

`void`

---

### openImport

**openImport**: () => `void`

Open the import-diagram modal.

#### Returns

`void`

---

### openSettings

**openSettings**: () => `void`

Open the built-in workflow settings modal.

#### Returns

`void`

---

### save

**save**: () => `Promise`<[`DidSaveStatus`](https://www.workflowbuilder.io/docs/api/integration/didsavestatus/)>

Persist the current diagram through the active integration strategy.

#### Returns

`Promise`<[`DidSaveStatus`](https://www.workflowbuilder.io/docs/api/integration/didsavestatus/)>

---

### setLayoutDirection

**setLayoutDirection**: (`direction`) => `void`

Set the diagram layout direction (`'RIGHT'` ↔ `'DOWN'`). Idempotent: setting the same direction twice is a no-op. Position reflow is only offered on [toggleLayoutDirection](https://www.workflowbuilder.io/docs/api/hooks/workflowbuilderactions/#togglelayoutdirection), where it is unambiguous.

#### Parameters

##### direction

[`LayoutDirection`](https://www.workflowbuilder.io/docs/api/types/layoutdirection/)

#### Returns

`void`

---

### setReadOnly

**setReadOnly**: (`value`) => `void`

Set read-only mode explicitly.

#### Parameters

##### value

`boolean`

#### Returns

`void`

---

### setTheme

**setTheme**: (`theme`) => `void`

Set the editor theme explicitly.

#### Parameters

##### theme

`Theme`

#### Returns

`void`

---

### toggleDarkMode

**toggleDarkMode**: () => `void`

Flip the editor theme between `'light'` and `'dark'`.

#### Returns

`void`

---

### toggleLayoutDirection

**toggleLayoutDirection**: (`options?`) => `void`

Flip the diagram layout direction. Pass `options.flipPositions` to also reflow node coordinates and/or `options.fitView` to re-fit the view afterwards.

#### Parameters

##### options?

[`LayoutChangeOptions`](https://www.workflowbuilder.io/docs/api/hooks/layoutchangeoptions/)

#### Returns

`void`

---

### toggleReadOnly

**toggleReadOnly**: () => `void`

Flip read-only mode.

#### Returns

`void`
