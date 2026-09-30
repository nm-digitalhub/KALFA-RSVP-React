# JSON Forms 3.8.0: capability map for KALFA

Written 2026-09-30 as the evidence base for the admin screen (WhatsApp template routes). The owner's rule: use built-in pieces first, and write custom code only where nothing ready exists.

**Labels.** VERIFIED means the claim was checked against the cited file or URL, which was read in full. INFERRED means the claim depends on something not read in full (see [Coverage](#10-coverage)).

Installed versions (VERIFIED, `package.json` and `node_modules/*/package.json`, plus `npm ls`):

| Package | Version | Note |
|---|---|---|
| `@jsonforms/core` | 3.8.0 (pinned exact) | depends on `ajv ^8.18.0`, `ajv-formats ^2.1.0`, `lodash`, `@types/json-schema` |
| `@jsonforms/react` | 3.8.0 (pinned exact) | peer `@jsonforms/core 3.8.0`, `react ^16.12 \|\| ^17 \|\| ^18 \|\| ^19`; `react-redux` is an *optional* peer |
| `react` / `react-dom` | 19.3.0 installed (`^19.2.8` declared) | inside the peer range |
| `ajv` | 8.20.0, deduped across the tree | one copy |
| `@workflowbuilder/sdk` | 2.3.0 | depends on `@jsonforms/core ^3.4.0` and `@jsonforms/react ^3.4.0`, resolved to the same deduped 3.8.0 copy |
| `@jsonforms/vanilla-renderers`, `@jsonforms/material-renderers` | **not installed** | |

---

## 0. The main finding

**Outside the workflow editor, no visual renderer is installed.**

- `@jsonforms/core` ships no UI at all. It is state, testers, mappers and i18n (VERIFIED, every `core/lib/**/*.d.ts`).
- `@jsonforms/react` ships the bindings (`JsonForms`, `JsonFormsDispatch`, the HOCs, `useJsonForms`), plus one visual component: `UnknownRenderer`, a red `<div>` reading "No applicable renderer found." or "No applicable cell found." (VERIFIED, `react/lib/*.d.ts` + `jsonforms-react.esm.js` lines 34–41).
- `@workflowbuilder/sdk` has internal renderers (Text, Select, Switch, TextArea, DatePicker, VariableText, VariableTextArea, DecisionBranches, AiTools, DynamicConditions, MessageOnError, Accordion, …), but it **does not export them as a renderer set**. The only way to use them is through `<WorkflowBuilder.Root>` and its properties panel (VERIFIED, `sdk/dist/index.d.ts`: no `renderers`/`cells` array export; `WorkflowBuilderJsonFormConfig` only *adds* renderers).
- The SDK exports the JSON Forms plumbing again (testers, HOCs, `JsonFormsDispatch`, `useJsonForms`, `FormControlWithLabel`), backed by the same deduped 3.8.0 copy.

- `@workflowbuilder/ui` 0.1.0 (vendored; Base UI) is a **component library, not a renderer set**. Our editor's custom JSON Forms controls wrap its `Input`, `Checkbox` and `Button` (§6.1). It has no combobox or autocomplete, and outside the editor it needs `html[data-theme]` for its colour tokens.

So a `<JsonForms>` placed on a normal admin page renders `UnknownRenderer` for every element until a renderer set is supplied. There are three ways to supply one, and each needs a decision:
1. write a small shadcn/Base-UI renderer set in the repo;
2. install `@jsonforms/vanilla-renderers@3.8.0` (peer-compatible with React 19; plain HTML plus CSS classes; needs approval);
3. use an unvetted third-party set (see §5.3).

---

## 1. Core concepts

### 1.1 UI schema element types (VERIFIED, `core/lib/models/uischema.d.ts`)

| Type | Interface | Fields |
|---|---|---|
| `Control` | `ControlElement` | `scope` (required, JSON pointer such as `#/properties/x`), `label?: string \| boolean \| {text?, show?}`, `i18n?`, `options?`, `rule?` |
| `VerticalLayout` | `VerticalLayout` | `elements[]`, `options?`, `rule?` |
| `HorizontalLayout` | `HorizontalLayout` | same |
| `Group` | `GroupLayout` | `elements[]`, `label?`, `i18n?` |
| `Categorization` | `Categorization` | `label` (required by the type), `elements: (Category \| Categorization)[]` (nesting allowed, so it can be a tree) |
| `Category` | `Category` | `label` (required), `elements[]`, `i18n?` |
| `Label` | `LabelElement` | `text` (required), `i18n?` |

- `UISchemaElement` is the union of the types above plus `BaseUISchemaElement` (`{type: string; rule?; options?}`), so custom `type` strings are allowed. 3.6 renamed the old `UISchemaElement` to `BaseUISchemaElement` (VERIFIED, MIGRATION.md §3.6).
- **`ListWithDetail` is not a core type.** It exists only in `@jsonforms/material-renderers`, as `rankWith(4, and(uiTypeIs('ListWithDetail'), isObjectArray))` (VERIFIED, `material-renderers/src/additional/MaterialListWithDetailRenderer.tsx@v3.8.0` lines 181–184). Core just routes it through `BaseUISchemaElement`.

### 1.2 Scope
- `scope` is a JSON pointer into the **schema** (`#/properties/a/properties/b`).
- The data path is derived by `toDataPath` / `composeWithUi` (`'#/properties/foo/properties/bar'` becomes `'foo.bar'`) (VERIFIED, `util/path.d.ts`, `util/uischema.d.ts`).
- Array children get paths like `list.0.name` (`Paths.compose`).

### 1.3 `options` keys that core itself reads
Most options are renderer-specific, as the docs say (VERIFIED, uischema.mdx). The core source reads these (VERIFIED by grep of `core/lib/jsonforms-core.esm.js`):

| Key | Read by | Meaning |
|---|---|---|
| `options.detail` | `findUISchema`, `findUiControl`, `isObjectArrayWithNesting` | `'DEFAULT'`, `'GENERATE(D)'`, `'REGISTERED'`, or an inline UI schema for array items |
| `options.readonly` / `options.readOnly` | `isInherentlyEnabled` / `isInherentlyReadonly` | marks the element read-only |
| `options.format` | `isDateControl`, `isTimeControl`, `isDateTimeControl`, `isNumberFormatControl` testers | e.g. `'date'`, `'time'`, `'date-time'` |
| `options.multi` | `isMultiLineControl` | multi-line text |
| `options.slider` | `isRangeControl` | range control |

- Documented renderer options (VERIFIED, controls.mdx, multiple-choice.mdx) are **not** read by core: `showSortButtons`, `elementLabelProp`, `format: 'radio'`, `autocomplete`, `restrict`, `trim`, `focus`, `hideRequiredAsterisk`, `showUnfocusedDescription`.
- The official renderer sets merge them as `merge({}, config, uischema.options)` (VERIFIED, `MaterialEnumControl.tsx`, `MaterialAnyOfStringOrEnumControl.tsx@v3.8.0`).
- `configDefault` (VERIFIED, `configDefault.d.ts`) is `{restrict:false, trim:false, showUnfocusedDescription:false, hideRequiredAsterisk:false, separateReadonlyFromDisabled:false}`.
- **Docs gap:** react.mdx lists only the first four keys. `separateReadonlyFromDisabled` is in the d.ts only.

### 1.4 Rules (VERIFIED, `uischema.d.ts`; `util/runtime.d.ts`)

**Effects (`RuleEffect`):** `HIDE`, `SHOW`, `ENABLE`, `DISABLE`, **`READONLY`, `WRITABLE`**. The last two are in the 3.8 d.ts but missing from `rules.mdx`, which lists four effects.

**Conditions:**
- `SchemaBasedCondition {scope, schema, failWhenUndefined?}`, the documented form.
- `LeafCondition {type:'LEAF', scope, expectedValue}`.
- `OrCondition` / `AndCondition {type:'OR'|'AND', conditions[]}`.
- `ValidateFunctionCondition {scope, validate(ctx) => boolean}`, where `ctx = {data, fullData, path, uischemaElement, config}`.

`rules.mdx` documents only the schema-based form.

**Runtime helpers:** `isVisible`, `isEnabled`, `isReadonly`, `evalVisibility`, `evalEnablement`, `evalReadonly`, `hasShowRule`, `hasEnableRule`, `hasReadonlyRule`.

### 1.5 Readonly (VERIFIED: readonly.mdx; `mappers/util.d.ts`; `jsonforms-core.esm.js` `isInherentlyEnabled`)

Order that decides whether an element is enabled:
1. the form-wide `readonly` prop;
2. an `ENABLE`/`DISABLE` rule;
3. `options.readonly`/`readOnly`;
4. `config.readonly`;
5. schema `readOnly: true`;
6. the parent.

With the default `separateReadonlyFromDisabled: false`, read-only is reported as `enabled=false`. Renderers also receive a separate `readonly` prop from `isInherentlyReadonly`. The repo's `header-rows-control.tsx` records that the SDK's built-in controls ignore `readonly` (not re-verified here).

### 1.6 Labels (VERIFIED, labels.mdx)
1. UI schema `label`;
2. schema `title`;
3. `startCase(propertyName)`, which produces **English**.

`oneOf: [{const, title}]` gives labelled enum options.

---

## 2. `<JsonForms>` props: the full list (VERIFIED, `react/lib/JsonForms.d.ts`, `JsonFormsInitStateProps & JsonFormsReactProps`)

| Prop | Type | Behaviour |
|---|---|---|
| `data` | `any` (**required**) | Controlled input. Any identity change dispatches `UPDATE_CORE` (VERIFIED, `jsonforms-react.esm.js` `JsonFormsStateProvider`) |
| `schema` | `JsonSchema` | Generated from `data` when omitted (`Generate.jsonSchema`) |
| `uischema` | `UISchemaElement` | Generated when omitted (`Generate.uiSchema`) |
| `renderers` | `JsonFormsRendererRegistryEntry[]` (**required**) | `{tester, renderer}` |
| `cells` | `JsonFormsCellRendererRegistryEntry[]` | `{tester, cell}`. Cells are input-only renderers used by tables (and by vanilla controls) |
| `onChange` | `({data, errors}) => void` | Called once after initial validation and then on each change. **Debounced by 10 ms** (VERIFIED, `debounce(..., 10)` in the react bundle) |
| `config` | `any` | Form-wide option defaults, merged with `configDefault` |
| `readonly` | `boolean` | Form-wide read-only |
| `validationMode` | `'ValidateAndShow' \| 'ValidateAndHide' \| 'NoValidation'` | Default is `ValidateAndShow` |
| `additionalErrors` | `ajv.ErrorObject[]` | External (server) errors, see §2.1 |
| `ajv` | `Ajv` | Custom instance. Default is `createAjv()` = `new Ajv({allErrors:true, verbose:true, strict:false})` plus `addFormats` (VERIFIED, validation.mdx) |
| `i18n` | `{locale?, translate?, translateError?}` | See §2.2 |
| `middleware` | `(state, action, defaultReducer) => JsonFormsCore` | Intercepts the core reducer (`INIT`, `UPDATE_CORE`, `UPDATE_DATA`, …) (VERIFIED, middleware.mdx; `reducers/middleware.d.ts`) |
| `uischemas` | `{tester: UISchemaTester, uischema}[]` | Registry for detail UI schemas (arrays and objects) |

### 2.1 `additionalErrors` (server errors on a field) (VERIFIED: validation.mdx; `getErrorsAt` + `getControlPath` in `jsonforms-core.esm.js`)
- They are **merged with the AJV errors**. In `ValidateAndHide` mode *only* the additional errors are shown. `NoValidation` still shows them.
- Mapping to a control: `instancePath` (or `dataPath`) has `/` replaced by `.`, a leading `.` stripped, and is decoded. It must **equal** the control's data path.
  - For `required` / `dependencies` errors, `params.missingProperty` is appended.
  - For `additionalProperties`, `params.additionalProperty` is appended.
- Shape for a variable field at `variables.0.value`:
  ```ts
  { instancePath: '/variables/0/value', message: 'שדה לא קיים', schemaPath: '', keyword: '', params: {} }
  ```
- `keyword` must **not** be `additionalProperties`, `allOf`, `anyOf` or `oneOf`, because errors with those keywords are filtered out (`filteredErrorKeywords`).
- **Reset gotcha (VERIFIED in code; see open issue/PR #2478):** every change to `data`, `schema`, `uischema`, `ajv`, `validationMode` or `additionalErrors` dispatches `updateCore(data, …)` using the *prop* `data`. If the host does not feed `onChange` data back into `data`, a new `additionalErrors` array replaces what the user typed with the stale prop data. The host must:
  - keep `data` controlled through `onChange`;
  - memoize `additionalErrors`, `schema`, `uischema`, `config` and `i18n`.

### 2.2 i18n (VERIFIED: i18n.mdx; `store/i18nTypes.d.ts`; `i18n/*.d.ts`; MIGRATION.md §3.8)
- **Keys:**
  - `<i18nKey>.label` and `<i18nKey>.description`, where `i18nKey` comes from UI schema `i18n`, then schema `i18n`, then the data path with array indices dropped;
  - for errors: `<key>.error.custom`, `<key>.error.<keyword>`, `error.<keyword>`, then the AJV message;
  - for enums: `<key>.<value>`;
  - for Group, Category and Label: `<i18n>.label` / `<i18n>.text`.
- **3.8 gotcha:** `Translator` is now a generic conditional type. Build it with `createTranslator((id, defaultMessage, values) => …)`; a plain arrow function annotated as `Translator` no longer compiles.
- Return `undefined` when there is no translation and `defaultMessage` is `undefined`.
- `translate` must be stable (memoized).
- The official renderer sets keep **hard-coded English strings** in places (issue #1826, closed). Array and combinator texts are translatable through `ArrayTranslationEnum` / `CombinatorTranslationEnum` keys (VERIFIED, `i18n/arrayTranslations.d.ts`, `combinatorTranslations.d.ts`).

### 2.3 Other exports worth knowing (VERIFIED, core d.ts)
- **Actions:** `init`, `updateCore`, `update(path, updater)`, `updateErrors`, `setAjv`, `setSchema`, `setUISchema`, `setValidationMode`, `setConfig`, `registerRenderer`, `registerCell`, `registerUISchema`, `setLocale`, `setTranslator`, `updateI18n`, `registerDefaultData`.
- **Utilities:** `createAjv`, `validate`, `Resolve.schema/data`, `Paths.compose`, `composePaths`, `toDataPath`, `encode`/`decode`, `getPropPath`, `findUiControl`, `createDefaultValue`, `computeLabel`, `showAsRequired`, `isDescriptionHidden`, `createCombinatorRenderInfos`, `Generate.*`, `Id.createId` (overridable), `convertDateToString`, `defaultDateFormat`.

---

## 3. Testers and ranking (VERIFIED, `core/lib/testers/testers.d.ts`)

- A tester is `(uischema, schema, context: {rootSchema, config}) => boolean`. A ranked tester returns a number, and `NOT_APPLICABLE = -1`.
- The renderer with the **highest rank wins**.
- Official controls rank around 1–5. The docs raise custom renderers to 3 (tutorial); the repo uses 5000.

| Helper | Meaning |
|---|---|
| `rankWith(rank, tester)` | Returns `rank` when the tester matches, otherwise -1 |
| `withIncreasedRank(by, rankedTester)` | Adds `by` to an existing ranked tester's result |
| `and(...t)` / `or(...t)` / `not(t)` | Boolean composition |
| `isControl` | Element `type === 'Control'` (type guard) |
| `uiTypeIs(type)` | Element `type` equals the value |
| `optionIs(name, value)` | `uischema.options[name] === value` (false when there are no options) |
| `hasOption(name)` | The option key exists |
| `scopeEndsWith(s)` | The control scope ends with the string |
| `scopeEndIs(s)` | The last scope segment equals the string |
| `schemaMatches(pred)` | Resolves the control's sub-schema and applies `pred(schema, rootSchema)` |
| `schemaSubPathMatches(subPath, pred)` | The same, on a sub-path of the resolved schema |
| `schemaTypeIs(type)` | The resolved sub-schema's `type` includes the value |
| `formatIs(fmt)` | The resolved sub-schema's `format` equals the value |
| `isBooleanControl`, `isIntegerControl`, `isNumberControl`, `isStringControl` | Control plus a primitive type |
| `isObjectControl` | Control on an object schema |
| `isAllOfControl` / `isAnyOfControl` / `isOneOfControl` | Control on a combinator |
| `isEnumControl` | Control whose schema has `enum` or `const` (VERIFIED, `isEnumSchema` in the esm bundle) |
| `isOneOfEnumControl` | Control plus `oneOf` of `{const,title}` |
| `isMultiLineControl` | Control with `options.multi === true` (it does not check the type) |
| `isDateControl` / `isTimeControl` / `isDateTimeControl` | Format in the schema *or* in `options.format` |
| `isObjectArray` / `isObjectArrayControl` / `isArrayObjectControl` | Array of objects (the last is a synonym) |
| `isObjectArrayWithNesting` | Object array with nested arrays/objects or `options.detail` |
| `isPrimitiveArrayControl` | Array of primitives |
| `isRangeControl` | Number or integer with min, max and default, plus `options.slider` |
| `isNumberFormatControl` | Integer plus `options.format` |
| `isCategorization`, `isCategory`, `hasCategory`, `categorizationHasCategory` | Categorization helpers |

The SDK re-exports: `rankWith`, `and`, `or`, `not`, `isControl`, `isLayout`, `optionIs`, `uiTypeIs`, `schemaMatches`, `schemaTypeIs`, `scopeEndsWith`, `formatIs` and `RuleEffect` (VERIFIED, `sdk/dist/index.d.ts`).

---

## 4. React bindings (VERIFIED, `react/lib/*.d.ts` + `core/lib/mappers/*.d.ts`)

### 4.1 Components
| Export | Purpose |
|---|---|
| `JsonForms` | Standalone root |
| `JsonFormsDispatch` | Renders a nested UI schema subtree inside a custom renderer (`OwnPropsOfJsonFormsRenderer`: `uischema, schema, path, enabled, readonly, visible, renderers, cells, uischemas`) |
| `ResolvedJsonFormsDispatch` | **Deprecated in 3.x** per the d.ts. The tutorials still recommend it; follow the d.ts |
| `DispatchCell` / `Dispatch` | Cell dispatch |
| `JsonFormsStateProvider`, `JsonFormsContext` | Context plumbing |
| `Control` (class) | Base class with `handleChange`, `onFocus` and `onBlur` |
| `RendererComponent`, `UnknownRenderer` | |
| `JsonFormsReduxContext` / `jsonformsReducer` | In `react/lib/redux`; legacy, deprecated since 2.5 |

### 4.2 Hooks
- **`useJsonForms()` is the only hook.** It returns `{core: {data, schema, uischema, errors, additionalErrors, ajv, validationMode}, renderers, cells, config, uischemas, readonly, i18n: {locale, translate, translateError}, dispatch}`.
- `dispatch(Actions.update(path, updater))` writes any path, which is how a renderer reaches a *sibling* field.
- There is no `useControl`-style hook. The HOCs below are the API.

### 4.3 HOCs: what each one gives the wrapped component
| HOC | Wrapped component receives |
|---|---|
| `withJsonFormsControlProps(C, memoize=true)` | `ControlProps` = `data, path, handleChange(path, value), errors: string, label, description, required, enabled, readonly, visible, id, schema, rootSchema, uischema, config, i18nKeyPrefix, renderers, cells` |
| `withJsonFormsEnumProps` | the above plus `options: {label, value}[]` from `enum` (translated) |
| `withJsonFormsOneOfEnumProps` | the above plus `options` from `oneOf[{const,title}]` |
| `withJsonFormsMultiEnumProps` | the above plus `addItem(path, value)`, `removeItem(path, value)` (array of enums) |
| `withJsonFormsLayoutProps` | `LayoutProps` = `uischema, schema, path, enabled, visible, direction, label, config, renderers, cells` (the children are `uischema.elements`) |
| `withJsonFormsArrayControlProps` | `ArrayControlProps` = control props plus `arraySchema, childErrors, addItem, removeItems, moveUp, moveDown, uischemas` |
| `withJsonFormsArrayLayoutProps` | `ArrayLayoutProps` = `data` is the **length**, plus `arraySchema, minItems?, disableAdd?, disableRemove?` and the array dispatchers |
| `withJsonFormsDetailProps` | `StatePropsOfControlWithDetail` (control props plus `uischemas`) |
| `withJsonFormsMasterListItemProps` | `index, selected, path, enabled, schema, uischema, childLabelProp, childLabel, handleSelect, removeItem, translations, disableRemove` |
| `withJsonFormsOneOfProps` / `AnyOfProps` / `AllOfProps` | `CombinatorRendererProps` (`indexOfFittingSchema`, `uischemas`, …) |
| `withJsonFormsCellProps` / `EnumCellProps` / `OneOfEnumCellProps` / `DispatchCellProps` | cell props (`isValid`, `data`, `path`, `handleChange`, `options`) |
| `withJsonFormsLabelProps` | `text, visible, config, renderers, cells, uischema` |
| `withJsonFormsRendererProps` / `withContextToJsonFormsRendererProps` | root renderer props |
| `withJsonFormsContext` | raw `{ctx}` |
| `withTranslateProps` | `t`, `locale` |
| `withArrayTranslationProps` | `translations: ArrayTranslations` |

`ctxTo*` / `ctxDispatchTo*` are the functions the HOCs use internally. They are exported for hand-written connections.

### 4.4 How a custom control reads and writes
- **Read** `data` for the value, `errors` for the combined message string (already translated), `enabled`/`readonly` for state, and `label`/`required`/`description` for the header.
- **Write** with `handleChange(path, value)`. Writing `undefined` **unsets** the key.
- **Other fields:** `useJsonForms().core.data` reads the whole form, and `handleChange(siblingPath, …)` writes a sibling. This is the documented dynamic-enum pattern (VERIFIED, `tutorial/dynamic-enum.mdx`), and the repo's `sumit-folder-control.tsx` uses it.
- **Runtime-only inputs** (e.g. a dynamic suggestion list) reach renderers through React Context or `config`. `config` is visible to testers and to renderers (docs: dynamic-enum uses Context).

### 4.5 Path-writing gotcha in 3.8 (VERIFIED, `jsonforms-core.esm.js` imports `lodash/fp/set` and `lodash/fp/unset`)
- `UPDATE_DATA` writes with `lodash/fp/set` / `unset`.
- A **numeric segment creates an array only when the container is missing** (VERIFIED by running `lodash/fp/set`): `set('vars.1','x',{})` gives `{"vars":[null,"x"]}`, but `set('vars.1','x',{vars:{}})` gives `{"vars":{"1":"x"}}`. So `{"1": …}` keys survive only if the parent object is always initialised.
- Bracket syntax is interpreted.
- 3.9 (unreleased on npm as of 2026-09-30; master MIGRATION.md) changes this to literal segments.
- **For Meta positional variables (`{{1}}`, `{{2}}`):** do not rely on `{"1": …}` keys unless the parent object is always pre-initialised. The safer shapes are an array of `{key, value}` or a non-numeric key such as `v1`.

---

## 5. Ready renderer sets

### 5.1 In the installed packages
None. See §0.

### 5.2 Official sets (not installed)

Sources:
- `renderer-sets.js` (the website's feature table), VERIFIED;
- `vanilla-renderers/src/renderers.ts@v3.8.0` and `material-renderers/src/index.ts@v3.8.0`, VERIFIED;
- `package.json@v3.8.0` for both packages, VERIFIED.

Every tester below was extracted from the `@v3.8.0` source of both packages: all 126 `.ts`/`.tsx` files under `packages/{vanilla,material}-renderers/src` were downloaded, and every exported `*Tester` was read (VERIFIED). A higher rank wins.

**`@jsonforms/vanilla-renderers@3.8.0`**
- **Peers:** `@jsonforms/core 3.8.0`, `@jsonforms/react 3.8.0`, React 16–19. **React 19 OK. No UI-library dependency.**
- **Styling:** CSS class ids that `JsonFormsStyleContext` can override (`Styles.md`).

| Kind | Renderer | Tester |
|---|---|---|
| control | `InputControl` (label + a cell dispatched by rank + validation text) | `rankWith(1, isControl)` |
| control | `RadioGroupControl` | `rankWith(3, and(isEnumControl, optionIs('format','radio')))` |
| control | `OneOfRadioGroupControl` | `rankWith(3, and(isOneOfEnumControl, optionIs('format','radio')))` |
| complex | `TableArrayControl` (array as an HTML table) | `rankWith(3, or(isObjectArrayControl, isPrimitiveArrayControl))` |
| complex | `ArrayControl` (nested array) | `rankWith(4, isObjectArrayWithNesting)` |
| complex | `LabelRenderer` | `rankWith(1, uiTypeIs('Label'))` |
| complex | `Categorization` | `rankWith(1, and(uiTypeIs('Categorization'), <has a Category>))` |
| layout | `GroupLayout` | `rankWith(1, uiTypeIs('Group'))` |
| layout | `VerticalLayout` | `rankWith(1, uiTypeIs('VerticalLayout'))` |
| layout | `HorizontalLayout` | `rankWith(1, uiTypeIs('HorizontalLayout'))` |
| cell | `BooleanCell` | `rankWith(2, isBooleanControl)` |
| cell | `DateCell` | `rankWith(2, isDateControl)` |
| cell | `DateTimeCell` | `rankWith(2, isDateTimeControl)` |
| cell | `EnumCell` (`<select>`) | `rankWith(2, isEnumControl)` |
| cell | `IntegerCell` | `rankWith(2, isIntegerControl)` |
| cell | `NumberCell` | `rankWith(2, isNumberControl)` |
| cell | `NumberFormatCell` (exported, **not** in `vanillaCells`) | `rankWith(4, isNumberFormatControl)` |
| cell | `OneOfEnumCell` (`<select>`) | `rankWith(2, isOneOfEnumControl)` |
| cell | `SliderCell` | `rankWith(4, isRangeControl)` |
| cell | `TextAreaCell` | `rankWith(2, isMultiLineControl)` |
| cell | `TextCell` | `rankWith(1, isStringControl)` |
| cell | `TimeCell` | `rankWith(2, isTimeControl)` |

**`@jsonforms/material-renderers@3.8.0`**
- **Peers:** `@mui/material ^7`, `@mui/icons-material ^7`, `@mui/x-date-pickers ^8`, `@emotion/react`, `@emotion/styled`, React 16–19.
- It depends on `dayjs 1.10.7` and `@date-io/dayjs`.
- **It brings MUI and Emotion into the app, and this repo uses neither.** 3.9 moves it to MUI v9.
- `Unwrapped` exports the unconnected components.

| Kind | Renderer | Tester |
|---|---|---|
| control | `MaterialTextControl` | `rankWith(1, isStringControl)` |
| control | `MaterialBooleanControl` | `rankWith(2, isBooleanControl)` |
| control | `MaterialBooleanToggleControl` | `rankWith(3, and(isBooleanControl, optionIs('toggle', true)))` |
| control | `MaterialIntegerControl` | `rankWith(2, isIntegerControl)` |
| control | `MaterialNumberControl` | `rankWith(2, isNumberControl)` |
| control | `MaterialNativeControl` | `rankWith(2, or(isDateControl, isTimeControl))` |
| control | `MaterialDateControl` | `rankWith(4, isDateControl)` |
| control | `MaterialTimeControl` | `rankWith(4, isTimeControl)` |
| control | `MaterialDateTimeControl` | `rankWith(2, isDateTimeControl)` |
| control | `MaterialSliderControl` | `rankWith(4, isRangeControl)` |
| control | `MaterialEnumControl` (**MUI Autocomplete by default**; Select when `options.autocomplete === false`) | `rankWith(2, isEnumControl)` |
| control | `MaterialOneOfEnumControl` (autocomplete / select) | `rankWith(5, isOneOfEnumControl)` |
| control | `MaterialRadioGroupControl` | `rankWith(20, and(isEnumControl, optionIs('format','radio')))` |
| control | `MaterialOneOfRadioGroupControl` | `rankWith(20, and(isOneOfEnumControl, optionIs('format','radio')))` |
| control | `MaterialAnyOfStringOrEnumControl` (free text + `<datalist>`) | `rankWith(5, and(uiTypeIs('Control'), schemaMatches(anyOf has string + string-enum)))` |
| complex | `MaterialArrayControlRenderer` (table) | `rankWith(3, or(isObjectArrayControl, isPrimitiveArrayControl))` |
| complex | `MaterialObjectRenderer` | `rankWith(2, isObjectControl)` |
| complex | `MaterialAllOfRenderer` | `rankWith(3, isAllOfControl)` |
| complex | `MaterialAnyOfRenderer` (tabs) | `rankWith(3, isAnyOfControl)` |
| complex | `MaterialOneOfRenderer` (tabs) | `rankWith(3, isOneOfControl)` |
| complex | `MaterialEnumArrayRenderer` (multi-select checkboxes) | `rankWith(5, and(uiTypeIs('Control'), array + uniqueItems + items are enum/oneOf))` |
| layout | `MaterialVerticalLayout` | `rankWith(1, uiTypeIs('VerticalLayout'))` |
| layout | `MaterialHorizontalLayout` | `rankWith(2, uiTypeIs('HorizontalLayout'))` |
| layout | `MaterialGroupLayout` | `rankWith(1, uiTypeIs('Group'))` |
| layout | `MaterialCategorizationLayout` (tabs) | `rankWith(1, isSingleLevelCategorization)` |
| layout | `MaterialCategorizationStepperLayout` | `rankWith(2, and(uiTypeIs('Categorization'), categorizationHasCategory, optionIs('variant','stepper')))` |
| layout | `MaterialArrayLayout` (expandable panels) | `rankWith(4, isObjectArrayWithNesting)` |
| additional | `MaterialLabelRenderer` | `rankWith(1, uiTypeIs('Label'))` |
| additional | `MaterialListWithDetailRenderer` | `rankWith(4, and(uiTypeIs('ListWithDetail'), isObjectArray))` |
| cell | `MaterialTextCell` | `rankWith(1, isStringControl)` |
| cell | `MaterialBooleanCell` | `rankWith(2, isBooleanControl)` |
| cell | `MaterialBooleanToggleCell` | `rankWith(3, and(isBooleanControl, optionIs('toggle', true)))` |
| cell | `MaterialDateCell` | `rankWith(2, isDateControl)` |
| cell | `MaterialTimeCell` | `rankWith(2, isTimeControl)` |
| cell | `MaterialEnumCell` | `rankWith(2, isEnumControl)` |
| cell | `MaterialOneOfEnumCell` | `rankWith(2, isOneOfEnumControl)` |
| cell | `MaterialIntegerCell` | `rankWith(2, isIntegerControl)` |
| cell | `MaterialNumberCell` | `rankWith(2, isNumberControl)` |
| cell | `MaterialNumberFormatCell` | `rankWith(4, isNumberFormatControl)` |

**Combobox / autocomplete / suggestions in the official sets:**
- Material `MaterialEnumControl` renders **MUI Autocomplete by default** for `enum`, and `MuiSelect` only when `options.autocomplete === false` (VERIFIED, `MaterialEnumControl.tsx@v3.8.0`). The same holds for oneOf enums per the feature table.
- Material `MaterialAnyOfStringOrEnumControl` is **free text plus `<datalist>` suggestions** for schemas of the form `anyOf: [{type:'string'}, {type:'string', enum:[…]}]`, at rank 5 (VERIFIED, source read in full).
  - It suggests for the *whole field value*.
  - There is no trigger character and no insertion at the cursor.
- Vanilla has no autocomplete.
- **No official set has a trigger-character (`{`) mention/suggestion input.**

### 5.3 Third-party sets (UNVETTED third-party code; npm registry search, 2026-09-30)
| Package | Latest | Maintenance | Compatibility | Coverage |
|---|---|---|---|---|
| `@fragno-dev/jsonforms-shadcn-renderers` | 0.0.2 (+ ~200 canary builds, the last on 2026-09-29) | active but pre-1.0 | peer React 18/19. Lists `@jsonforms/core`/`react ^3.7.0` as **dependencies**, not peers, so there is a duplicate-copy risk. Imports `@/components/ui/{button,calendar,card,checkbox,field,input,label,popover,radio-group,select,slider,switch,tabs,textarea}` from the host; this repo has **no `field.tsx` and no `slider.tsx`**, and its `ui/*` is Base-UI-based shadcn, so API fit is INFERRED/unchecked | Supported: text, textarea, number, boolean, switch, date/time, enum select/radio, oneOf select, object, layouts, categorization, label. **Not supported:** array table, list-with-detail, multi-select, anyOf/oneOf combinators, autocomplete (fragno.dev docs page) |
| `@great-expectations/jsonforms-antd-renderers` | 2.3.5 (2026-04-17) | maintained | peer `react ^17 \|\| ^18`, so **incompatible with React 19**; needs antd 5 | n/a |
| `@abgov/jsonforms-components` | 2.79.0 | active | Government of Alberta design system | not applicable |

No Radix-only or Base-UI JSON Forms renderer set was found.

### 5.4 Every published `@jsonforms/*` package
Source: the npm registry search API, `https://registry.npmjs.org/-/v1/search?text=%40jsonforms&size=250`, filtered to the `@jsonforms/` scope, 2026-09-30 (VERIFIED). The `text=scope:jsonforms` form of the query returned 0 results, and the npmjs.com HTML search page was not used.

| Package | Latest | Published | Description |
|---|---|---|---|
| `@jsonforms/core` | 3.8.0 | 2026-06-16 | Core module of JSON Forms (installed) |
| `@jsonforms/react` | 3.8.0 | 2026-06-16 | React module of JSON Forms (installed) |
| `@jsonforms/vanilla-renderers` | 3.8.0 | 2026-06-16 | Default (plain HTML) React renderer set |
| `@jsonforms/material-renderers` | 3.8.0 | 2026-06-16 | Material UI React renderer set |
| `@jsonforms/examples` | 3.8.0 | 2026-06-16 | Example schemas and data |
| `@jsonforms/angular` | 3.8.0 | 2026-06-16 | Angular module |
| `@jsonforms/angular-material` | 3.8.0 | 2026-06-16 | Angular Material renderer set |
| `@jsonforms/vue` | 3.8.0 | 2026-06-16 | Vue 3 module |
| `@jsonforms/vue-vanilla` | 3.8.0 | 2026-06-16 | Vue 3 vanilla renderers |
| `@jsonforms/vue-vuetify` | 3.8.0 | 2026-06-16 | Vue 3 Vuetify renderers (preview) |
| `@jsonforms/vue2` | 3.1.0 | 2023-06-20 | Vue 2 module (dropped after 3.1) |
| `@jsonforms/vue2-vanilla` | 3.1.0 | 2023-06-20 | Vue 2 vanilla renderers (dropped) |
| `@jsonforms/vue2-vuetify` | 3.0.0 | 2022-10-31 | Vue 2 Vuetify renderers (dropped) |
| `@jsonforms/material-tree-renderer` | 2.3.2 | 2019-11-29 | Material tree renderer (2.x only, abandoned) |
| `@jsonforms/ionic-renderers` | 2.3.2 | 2019-11-29 | Ionic renderer set (2.x only, abandoned) |
| `@jsonforms/webcomponent` | 2.3.2 | 2019-11-29 | Web-component module (2.x only, abandoned) |
| `@jsonforms/i18n` | 2.0.0-rc.4 | 2018-03-12 | Old i18n module (abandoned; i18n now lives in core) |

**Conclusion.** For React 3.8 there are only two official renderer sets, vanilla and material. There is no official shadcn, Radix or Base UI set.

---

## 6. What this repo already has

All the renderers below are registered **only** in `WorkflowBuilder.Root jsonForm.renderers` (`src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:174-191`: 7 renderers, no cells). They import from `@workflowbuilder/sdk`, which is the same JSON Forms instance, and they use the editor's `@workflowbuilder/ui` components (not the app's shadcn). All testers are `rankWith(5000, optionIs('format', <FORMAT>))`, with the constants in `src/lib/workflow/catalogue/ui-formats.ts`.

| Renderer (file) | Tester | HOC | Depends on | Reusable outside the editor? |
|---|---|---|---|---|
| `checkboxListRenderer` (`checkbox-list-control.tsx`) | `optionIs('format','kalfa-checkbox-list')` | `withJsonFormsControlProps` | `FormControlWithLabel` (SDK), `Checkbox` (`@workflowbuilder/ui`), `options.choices` | **In principle.** No editor hooks, but it carries the editor's visual tokens, and its `{value}`-object storage and "absent ≠ empty" rules are workflow-specific |
| `headerRowsRenderer` (`header-rows-control.tsx`) | `…'kalfa-header-rows'` | `withJsonFormsControlProps` | `useSecretsStore` (editor Zustand), `@workflowbuilder/ui` Input/Button | **No as-is** (secrets store). It is a good *pattern* for "editable rows plus a datalist of suggestions" |
| `integrationConnectionRenderer` (`integration-connection-control.tsx`) | `and(optionIs('format','integration-connection'), optionIs('provider','microsoft'), optionIs('capability','mail.send'))` | `withJsonFormsControlProps` | `useWorkflowBuilderActions` (SDK), `JsonFormsDispatch` to the **SDK Select**, `OAuthConnectionProvider` | **No.** It is editor-bound |
| `sumitFolderRenderer` (`sumit-folder-control.tsx`) | `…'kalfa-sumit-folder'` | `withJsonFormsControlProps` | `useJsonForms`, `JsonFormsDispatch` to the **SDK Select**, server actions | **No** (the SDK Select exists only inside Root). It is the reference pattern for dynamic, server-loaded options and dependent reset |
| `webhookTokenRenderer` (`webhook-token-control.tsx`) | `…'webhook-token'` | `withJsonFormsControlProps` | `useSingleSelectedElement`, `useParams` | **No.** It is editor-bound |
| `nodeRunRenderer` (`node-run-control.tsx`) | `…'kalfa-node-run'` | `withJsonFormsLabelProps` | `useSingleSelectedElement`, execution store | **No.** It is editor-bound |
| `triggerSwitchRenderer` (`trigger-switch-control.tsx`) | `…'kalfa-trigger-switch'` | `withJsonFormsLabelProps` | `useSingleSelectedElement`, `useStore`, `setStoreNodes` | **No.** It is editor-bound |

**`output-paths.ts`** (read in full):
- `outputPaths(output)` flattens an object with `flat` into the leaf dot-paths that match `/^[\w.-]+$/`. **It is generic and reusable** for building a list of value paths.
- `referenceFor(nodeId, path)` builds `{{nodes.<id>.<path>}}`, which is **specific to the workflow template grammar**.

**SDK pieces** (VERIFIED, d.ts; behaviour INFERRED from minified excerpts of `dist/index-CEBfv0NZ.js`):
- **`VariableText` / `VariableTextArea`** are the SDK's mention inputs. They are built on `react-mentions-ts` (a declared SDK dependency; 5.4.7 installed transitively, peer `react >=19`, `clsx`, `cva`, `tailwind-merge`).
  - The trigger is **`{{`**, not `{`.
  - The suggestion groups come from the **selected diagram node's upstream variables** in the SDK store (`useSingleSelectedElement` → `Cs(nodeId, …)`).
  - The component is not exported. **It cannot be reused on a standalone page.**
- **`FormControlWithLabel`** (exported) is a label wrapper with a required marker. It is styled for the editor.
- **`SyntaxHighlighterLazy`** (exported) is a code editor.
- The SDK UI schema adds the editor-only types `Accordion`, `RichText` and `MessageOnError`, plus `errorIndicatorEnabled` / `disabled` on controls.

### 6.1 `@workflowbuilder/ui` 0.1.0: the component library our JSON Forms controls already use

**Where it comes from and how it is wired** (VERIFIED):
- **Package:** installed from `file:vendor/workflowbuilder-ui-0.1.0.tgz` (`package.json:121`).
- **Base UI:** its declared `@base-ui/react 1.7.0` is overridden to the app's copy (`package.json` overrides). `npm ls` shows one deduped `@base-ui/react@1.8.0`, so the app's `DirectionProvider` and its Base UI context reach its popups.
- **Peers and dependencies:** peers are `react` and `react-dom` 18/19. Dependencies are `@phosphor-icons/react` and `react-textarea-autosize`. Its `CHANGELOG.md` is headed `[1.0.0]` although the package is 0.1.0.
- **Styles:** every stylesheet sits under `@layer ui.base, ui.component`, so unlayered app CSS always wins (`css-layers.md`).
- **Tokens:** `tokens.css` defines 394 `--wb-ds-*` primitives at `:root`, but **the 448 semantic/component tokens only exist under `html[data-theme='light'|'dark']`**. `--wb-public-*` variables are per-component overrides.
- **Where it is used today:** the workflow editor imports `@workflowbuilder/ui/tokens.css`, and the SDK sets `html[data-theme]` itself. On any other page `<html>` has `lang="he" dir="rtl"` but no `data-theme` (`src/app/layout.tsx:75`). **Outside the editor its components would render with undefined colour tokens** unless a `data-theme` is set on `<html>`.
- **Controls built on it:** our JSON Forms controls that use it are `checkbox-list-control` (`Checkbox`), `header-rows-control` (`Input` and `Button`), `integration-connection-control` (`Button`, while the select itself is the SDK Select), `trigger-switch-control` (`Button`) and `webhook-token-control` (`Button`). `sumit-folder-control` and `node-run-control` use none of it; they use the SDK Select through `JsonFormsDispatch`, or plain markup.

**The components** (props VERIFIED from every `dist/components/*/**.d.ts` and `shared/types/*.d.ts`):
- **RTL:** measured by counting physical (`left`/`right`, `margin-left`, …) against logical (`*-inline-*`) declarations in `dist/assets/*.css`. No component accepts a `dir` prop. Components that spread HTML attributes forward `dir` to their DOM.
- **Search:** a searchable/filterable mode was looked for in the d.ts files and the bundle.

| Component | Props (beyond the spread HTML attributes) | RTL | Searchable? |
|---|---|---|---|
| `Accordion` | `label`, `children`, `isOpen`, `onToggleOpen`, `defaultOpen`, `icon` + div attributes | no physical properties in its CSS; neutral | – |
| `Avatar` | `username`, `imageUrl`, `size` | neutral | – |
| `Button` | `variant` (primary/secondary/critical/success/ghost-*), `size` xl–xs, `shape` default/square/round, `prefixIcon`, `suffixIcon`, `isLoading`, `tooltip`, `tooltipType`; icon-only form requires `aria-label` | physical declarations are a full-cover overlay and a symmetric pair of loader dots; neutral | – |
| `NavButton` | `size` xl–xxxs, `variant` square/round/plain, `isSelected`, `prefixIcon`, `suffixIcon` | **logical properties** (15) | – |
| `Checkbox` | `size`, `indeterminate`, `checked` + input attributes | the check mark is centred with `left:50%` (symmetric, fine) | – |
| `Chip` | `label`, `variant` solid/outline, `size` s–xl, `prefixIcon`, `onClose`, `closeLabel` + span attributes | **logical properties** | – |
| `Collapsible` | `isExpanded`, `defaultExpanded`, `onToggle`, `expandLabel`, `collapseLabel`; `Collapsible.Button`, `Collapsible.Content` | neutral | – |
| `DatePicker` | `value`, `defaultValue`, `type` default/range/multiple, `valueFormat` (date-fns), `placeholder`, `minDate`, `maxDate`, `onChange`, `disabled`, `readOnly`, `label`, `helperText`, `state`, `isRequired`, `error`, `inputSize`, `id`, `aria-*` | **the only component with `[dir=rtl]` rules** (react-day-picker) plus logical properties | – |
| `EdgeLabel`, `useEdgeStyle` | diagram edges: `size`, `isHovered`, `type`, `state` | n/a | – |
| `Input` | `FieldControlProps`: `state` default/critical/success/read-only, `size` l/m/s/xs, `prefixIcon`, `suffixIcon`, `onClear`, `clearLabel`, `label`, `helperText`, `isRequired` + input attributes | no physical properties; `dir` passes through | **no.** A native `list=` datalist works because the attributes are spread (as `header-rows-control` does) |
| `TextArea` | `minRows`, `maxRows`, `size` l/m/s, `style` + `FieldControlProps` + textarea attributes | neutral | no |
| `Menu` (+ `Menu.TriggerButton`) | `items: {label, icon, disabled, tone, selected, onClick, type:'item'\|'separator'}[]`, `size`, `placement` (physical `left`/`right` sides), `open`, `onOpenChange`, `offset`, `children` (trigger) | the shared `list-item.css` (menu and select rows) uses `margin-left:auto` (**not mirrored**); `placement` names physical sides | **no filtering** |
| `Modal` | `title`, `subtitle`, `children`, `footer`, `size` regular/large, `footerVariant`, `open`, `onClose`, `closeLabel`, `icon` + div attributes | its physical declarations are a full-cover overlay (`top:0;right:0;bottom:0;left:0`) and `left:50%` centring, both symmetric; neutral in practice (INFERRED from the CSS only) | – |
| `NodePanel` / `NodeIcon` / `NodeDescription` / `NodeAsPortWrapper` | diagram node parts | physical | n/a |
| `Radio` | `size`, `checked`, `name`, `value`, `onChange` + input attributes | centred dot (fine) | – |
| `SegmentPicker` (+ `.Item`) | `value` or `defaultValue`, `onChange(event, value)`, `size`, `shape`, `className`; items take `value`, `prefixIcon`, `suffixIcon` | neutral (items follow the DOM order) | – |
| `Select` | `items: {value, label, icon, disabled, type}[]`, `value`, `defaultValue`, `onChange(event, value)`, `placeholder`, `size`, `error`, `disabled`, `name`, `required`, `label`, `helperText`, `state`, `isRequired`, `id`, `className`. **Does not spread other props** | the value text has `text-align:left` (**wrong in RTL**) | **no.** Base UI `Select` with no filter or search |
| `Separator` | none | `border-left`/`border-right: none` (symmetric) | – |
| `Snackbar` | `variant` success/error/warning/info/default, `title`, `subtitle`, `buttonLabel`, `onButtonClick`, `close`, `onClose` | `margin-left:auto` and `text-align:left` (**not mirrored**) | – |
| `Status` | `status: 'invalid'`, `className` | placed with `right:` (**not mirrored**) | – |
| `Switch`, `IconSwitch` | `size`, `checked`, `disabled`, `onChange(checked, event)`, `thumbChildren`, `trackChildren` (+ Base UI Switch root props); IconSwitch adds `icon`, `IconChecked`, `variant` | the thumb is positioned with `left:` (**the toggle direction is not mirrored**) | – |
| `Tooltip` (+ `.Trigger`, `.Content`) | `placement` (physical sides), `open`, `initialOpen`, `onOpenChange`; `Content` takes `tooltipType` default/blue | placement is physical | – |

**Verdict on search.** `@workflowbuilder/ui` has **no combobox or autocomplete**. `Select` and `Menu` cannot filter. However, the app's own `@base-ui/react@1.8.0` (a direct dependency) ships unstyled `combobox` and `autocomplete` primitives:
- `Autocomplete.Root` takes `mode` (list/both/inline/none), `filter`, `filteredItems`, a controlled `value`, `onValueChange`, `open`, `onOpenChange` and `openOnInputClick` (VERIFIED, `@base-ui/react/autocomplete/root/AutocompleteRoot.d.ts`, prop names only).
- Whether they can be driven to open on a typed `{` at the cursor is **INFERRED, not tested**.

**Verdict on RTL.** The inputs (`Input`, `TextArea`, `Checkbox`, `Radio`, `Chip`, `NavButton`, `DatePicker`) are safe in RTL. `Select` (left-aligned value), `Switch` (thumb positioned with `left:` in `icon-switch.css`), the `Menu`/`Select` rows, `Snackbar`, `Status` and the `Menu`/`Tooltip` placement names use physical properties, and `sdk-overrides.css` already records that the SDK has no RTL at all. These need unlayered overrides, which win over its `@layer ui.*` rules.

### 6.2 App primitives (shadcn on Base UI)

**App primitives already present** (`src/components/ui/`): `table`, `select`, `command` (cmdk 1.1.1 is a direct dependency), `popover`, `input`, `textarea`, `label`, `badge`, `button`, `card`, `tabs`, `checkbox`, `switch`, `radio-group`, `direction` (Base UI DirectionProvider), `scroll-area`. **There is no `combobox`, `field` or `slider` file.** Base UI's unstyled `Combobox` and `Autocomplete` primitives are installed (1.8.0), and the shadcn CLI could add a styled one (not done; needs approval).

---

## 7. Fit for the template-routes admin screen

Preference order, per the owner:
1. **`@workflowbuilder/ui`**, which our JSON Forms controls already use;
2. **our shadcn components** (`src/components/ui/*`, on Base UI);
3. **custom** code.

In every row, JSON Forms itself supplies the data binding, validation and error routing. The question is only what draws each piece.

| Need | JSON Forms side (built-in) | 1. `@workflowbuilder/ui` | 2. Our shadcn / Base UI | 3. Custom left |
|---|---|---|---|---|
| Table/list of routes per step × event type × with/without image | array of objects: `isObjectArrayControl` + `withJsonFormsArrayControlProps` (`addItem`, `removeItems`, `moveUp`, `moveDown`, `childErrors`) | **no table component** | `ui/table.tsx` | an array-table renderer over `ui/table` (≈1 component). Alternatively render the table in plain React and put one small form per row |
| Pick an approved template from the mirror rows | runtime `oneOf:[{const:id,title:name}]` + `isOneOfEnumControl` + `withJsonFormsOneOfEnumProps` (hands over `options`) | **`Select`** (`items`, `value`, `onChange`, `label`, `helperText`, `state`, `isRequired`). Not searchable, and its value is left-aligned in RTL | `ui/select.tsx`; for search, Base UI `Combobox` (installed) or `ui/command` + `ui/popover` | a ~20-line control renderer. If the list is long enough to need search, use the shadcn/Base UI combobox path |
| Read-only display of the Meta template content | `Label` element, or a `Control` with `options.readonly` / a `READONLY` rule; `withJsonFormsLabelProps` / `withJsonFormsControlProps` (`readonly`, `enabled`) | `TextArea`/`Input` with `state="read-only"` + `readOnly`, or plain text | `ui/textarea` `readOnly`, `ui/card` | a trivial label / read-only renderer |
| One input per template variable; typing `{` opens a searchable list of value paths passed in at runtime | the value binding is built-in (`handleChange`); the runtime path list is passed through React Context or `config` | `Input` with `FieldControlProps`, which forwards `list=` for a **whole-field** datalist (the `header-rows-control` pattern). **No trigger-character or searchable popup** | Base UI `Autocomplete` (`mode`, `filter`, controlled `open` and `value`: a `{`-trigger is possible but INFERRED); `ui/command` + `ui/popover` | **the one genuinely new control.** A `{`-triggered, filterable path picker that inserts at the cursor. The path list can come from the generic `outputPaths()`. `react-mentions-ts` (SDK transitive dependency) is an alternative that needs approval |
| Hebrew labels and RTL | labels from UI schema `label` or schema `title`; a `createTranslator` for AJV error texts | the inputs are RTL-safe; the `Select`, `Switch`, `Menu` and `Snackbar` physical CSS needs unlayered overrides; **`data-theme` must be set on `<html>`** or its colour tokens are undefined outside the editor | `DirectionProvider` is already at the root; the shadcn primitives are RTL-configured (`components.json` `rtl: true`, per the `layout.tsx` comment) | logical CSS in our own renderers; a Hebrew error translator |
| Server validation errors on a field | `additionalErrors` with `instancePath` = `/`-joined data path, shown in every mode | `Input`/`Select`/`TextArea` `state="critical"` + `helperText` show the message | `aria-invalid` + text | none beyond passing `errors` to the component |
| Save button and "sync now" | not JSON Forms; `onChange` gives `{data, errors}` to enable Save | `Button` (`variant`, `isLoading`, `prefixIcon`) | `ui/button` | the host page calls Server Actions |

**Net:**
- JSON Forms supplies state, validation, rules, i18n keys, error routing and the HOCs.
- **Neither JSON Forms nor the SDK nor `@workflowbuilder/ui` provides a ready renderer set for a standalone page.** A thin set must be written: text, select/oneOf, read-only/label, the layouts and an array table.
  - With `@workflowbuilder/ui`, each piece is a small wrapper over `Input`, `Select`, `TextArea` and `Button`. That matches the editor controls, but it needs `data-theme` plus the RTL overrides.
  - With shadcn, each piece matches the rest of the admin UI.
- **The `{`-trigger path input is the only piece nothing provides.**
- The alternative is to install `@jsonforms/vanilla-renderers@3.8.0` (React 19 OK) and override just the controls that need a look. That needs approval, and it brings unstyled HTML plus its CSS-class model.

---

## 8. Gotchas for 3.8.0

1. **`"use client"` is required.** The react bundle has no directive and uses `useState`, `useReducer`, `useEffect` and `useContext` (VERIFIED, `jsonforms-react.esm.js` line 1). `<JsonForms>` and every renderer must live in a Client Component. Pass only serialisable schema, UI schema and data from the Server Component. Keep renderer arrays at module scope (stable identity).
2. **React 19 is OK.** The peer range includes `^19.0.0`. The React 19 type break (`ReducerAction`, issue #2572) is absent in the installed 3.8.0 d.ts and bundle (VERIFIED, grep count 0).
3. **Only one AJV (8.20.0)**, deduped. The default instance is `strict:false`, `allErrors`, `verbose`, plus `ajv-formats` 2.x. Pass a custom `ajv` only if needed (for example `ajv-errors`, which is not installed).
4. **Identity churn triggers re-validation and resets.** `data`, `schema`, `uischema`, `ajv`, `validationMode` and `additionalErrors` changes all dispatch `UPDATE_CORE` (§2.1). Memoize them all, and memoize `i18n.translate`.
5. **`onChange` is debounced by 10 ms** and also fires once on mount with the initial validation.
6. **Numeric path segments** become arrays through `lodash/fp/set` when the parent container is missing (§4.5).
7. **`Translator`** must be built with `createTranslator` (MIGRATION.md §3.8).
8. **Read-only is disabled by default.** Set `config.separateReadonlyFromDisabled: true` if the renderers should distinguish the two. The `READONLY`/`WRITABLE` rule effects exist but are undocumented on the site.
9. **`ResolvedJsonFormsDispatch` is deprecated in the d.ts** even though the tutorials still recommend it. Use `JsonFormsDispatch`.
10. **`$ref`:** core resolves basic internal refs only. External refs must be resolved before they are passed in (ref-resolving.mdx).
11. **One JSON Forms copy.** Custom renderers must import from the same `@jsonforms/react` instance as the root. Today the SDK and the app resolve to one deduped copy. A third-party set that declares `@jsonforms/*` as *dependencies* (fragno) could break this.
12. **Unknown elements render `UnknownRenderer`** (a red "No applicable renderer found."), which is visible in the UI rather than an error. A missing renderer is silent in tests unless they assert against it.
13. **Hebrew labels.** Without a UI schema `label`, schema `title` or i18n entry, the label is English `startCase(key)`. The repo test `palette-defaults.test.ts` already guards this for the workflow editor.
14. **`@workflowbuilder/ui` outside the editor** needs `html[data-theme]` (its semantic tokens exist only there) and `import '@workflowbuilder/ui/tokens.css'`. The SDK sets `data-theme` only inside the editor. Its `@layer ui.*` rules lose to any unlayered CSS, which makes overrides easy.
15. **3.9 (on master, not on npm yet) changes data paths to literal segments and moves material to MUI v9.** Pin to 3.8.0 as now.

---

## 9. Source index

- **Package files:** `node_modules/@jsonforms/{core,react}/{package.json,README.md,lib/**/*.d.ts}`; targeted reads of `core/lib/jsonforms-core.esm.js` (reducer, errors, readonly, control mapper) and `react/lib/jsonforms-react.esm.js` (state provider, `JsonForms`).
- **Docs source:** `github.com/eclipsesource/jsonforms2-website` (`master`), `content/docs/**/*.mdx`, `src/sidebars/docs.js`, `src/components/docs/renderer-sets.js`.
- **Renderer sources:** `github.com/eclipsesource/jsonforms` at tag `v3.8.0`: `packages/{vanilla,material}-renderers/{package.json,src/index.ts}`, `vanilla-renderers/src/{renderers.ts,controls/index.ts,cells/index.ts}`, `README.md`, `Styles.md`, `material-renderers/src/controls/{MaterialEnumControl,MaterialAnyOfStringOrEnumControl}.tsx`; `MIGRATION.md` (master).
- **npm registry API:** `/-/v1/search` and package documents; `fragno.dev/docs/forms/shadcn-renderer`.
- **Seed:** `github.com/eclipsesource/jsonforms-react-seed` (HEAD): README, `package.json` and every file under `src/`. Its custom-renderer example is `RatingControl` + `rankWith(3, scopeEndsWith('rating'))` over `materialRenderers`, and its UI schema uses a `LEAF` rule. It pins `@jsonforms/*` 3.8.0 and React 18.
- **ROADMAP.md (master):** H2/2026 is bug fixes on 3.x; 4.0 topics are possibly in 2027.
- **`@workflowbuilder/ui`:** `node_modules/@workflowbuilder/ui/{README.md,css-layers.md,CHANGELOG.md,package.json,dist/**/*.d.ts,dist/assets/*.css,dist/tokens.css}`.
- **GitHub issues:** #1770, #1826, #2404, #2405, #2464, #2478, #2572.

---

## 10. Coverage

### Installed packages
| File | Status |
|---|---|
| `@jsonforms/core/package.json`, `README.md` | fully read |
| `@jsonforms/react/package.json`, `README.md` | fully read |
| `core/lib/index.d.ts`, `configDefault.d.ts` | fully read |
| `core/lib/actions/{actions,index}.d.ts` | fully read |
| `core/lib/generators/{Generate,index,schema,uischema}.d.ts` | fully read |
| `core/lib/i18n/{arrayTranslations,combinatorTranslations,i18nUtil,index,selectors}.d.ts` | fully read |
| `core/lib/mappers/{cell,combinators,index,renderer,util}.d.ts` | fully read (`renderer.d.ts`, 460 lines, in one pass) |
| `core/lib/models/{index,jsonSchema,uischema}.d.ts` | fully read |
| `core/lib/models/{jsonSchema4,jsonSchema7,draft4}.d.ts` | fully read, in two passes (code lines, then doc-comment lines) |
| `core/lib/reducers/*.d.ts` (cells, config, core, default-data, i18n, index, middleware, reducers, renderers, uischemas) | fully read |
| `core/lib/store/{i18nTypes,index,jsonFormsCore,store,type}.d.ts` | fully read |
| `core/lib/testers/{index,testers}.d.ts` | fully read |
| `core/lib/util/*.d.ts` (Formatted, defaultDateFormat, errors, helpers, ids, index, label, path, resolvers, runtime, schema, uischema, util, validator) | fully read |
| `react/lib/{Control,DispatchCell,JsonForms,JsonFormsContext,Renderer,UnknownRenderer,index}.d.ts`, `redux/{JsonFormsReduxContext,index}.d.ts` | fully read |
| `core/lib/jsonforms-core.esm.js` | partial, targeted reads (grep plus the reducer, errors, readonly and control-mapper sections). Claims about it cite the function read |
| `react/lib/jsonforms-react.esm.js` | partial: lines 1–5, 60–135 and 360–395 read |

### Workflow SDK
| File | Status |
|---|---|
| `@workflowbuilder/sdk/package.json` | fully read |
| `sdk/dist/index.d.ts` (2452 lines) | **partial:** the JSON Forms sections read (lines 40–240, 395–410, 490–660, 740–900, 1095–1120, 1280–1300, 1400–1480, 1535–1720, 1760–1775, 1960–2020, 2175–2260, 2355–2375) plus a grep of every `export`. Non-form sections (diagram, store, plugins) not read, as out of scope |
| `sdk/dist/index-CEBfv0NZ.js` (1 MB, minified) | **not read in full**: excerpts around `VariableText`, `"{{"` and the Text/TextArea renderers. Every claim about its behaviour is INFERRED |

### Repo files
| File | Status |
|---|---|
| `package.json` (dependencies, overrides) | read (relevant lines) |
| `workflows/[id]/checkbox-list-control.tsx`, `trigger-switch-control.tsx`, `header-rows-control.tsx`, `integration-connection-control.tsx`, `sumit-folder-control.tsx`, `webhook-token-control.tsx`, `node-run-control.tsx`, `output-paths.ts` | fully read |
| `workflows/[id]/workflow-editor.tsx` | lines 168–200 only (the renderer registry) |
| `src/lib/workflow/catalogue/ui-formats.ts` | lines 1–60 read (all format constants) |
| `src/components/ui/` | directory listing only |
| `src/app/layout.tsx` | lines 75–84 (`<html>` attributes, `DirectionProvider`) |
| `workflows/[id]/workflow-editor.tsx` | also lines 1–60 (imports: `tokens.css`, `sdk-overrides.css`) |
| `workflows/[id]/sdk-overrides.css` | lines 110–170 plus a grep for tokens/layers/dir. Not read in full |

### `@workflowbuilder/ui` 0.1.0
| File | Status |
|---|---|
| `package.json`, `README.md`, `css-layers.md`, `CHANGELOG.md` | fully read |
| `dist/index.d.ts` and all 88 `dist/components/**/*.d.ts` + `dist/shared/**/*.d.ts` files | fully read |
| `dist/assets/*.css` (25 files) | scanned by pattern for physical vs logical direction properties and `[dir=rtl]`; the matching rules printed and read. Not read line by line |
| `dist/tokens.css` | selectors and variable counts per block extracted; values not read |
| `dist/chunks/*.js` | grepped for Base UI imports and combobox/filter/search; not read |
| `@base-ui/react/autocomplete/root/AutocompleteRoot.d.ts`, `combobox/root/AriaCombobox.d.ts` | prop names grepped only (INFERRED beyond names) |

### Official docs (jsonforms.io, read as raw MDX from `eclipsesource/jsonforms2-website@master`; that repo has no version tags)
Every page in `src/sidebars/docs.js` was fully read:
- `what-is-jsonforms`, `architecture`, `getting-started`;
- `uischema/uischema`, `uischema/controls`, `uischema/layouts`, `uischema/rules`;
- `labels`, `i18n`, `renderer-sets` (plus its `renderer-sets.js` table), `ref-resolving`, `readonly`, `validation`, `date-time-picker`, `multiple-choice`, `middleware`;
- `tutorial/create-app`, `tutorial/custom-layouts`, `tutorial/custom-renderers`, `tutorial/dynamic-enum`, `tutorial/multiple-forms`;
- `api`, `integrations/react`, `integrations/angular`, `integrations/vue`;
- `deprecated/available-actions`, `deprecated/redux`, `deprecated/ref-resolving-legacy`, `deprecated/store`.

### Linked from the docs
| Target | Status |
|---|---|
| `MIGRATION.md` (master, 556 lines) | fully read, every section from 3.9 to 1.x |
| `ROADMAP.md` (master) | fully read |
| `jsonforms-react-seed` (HEAD): `README.md`, `package.json`, `vite.config.mts`, `src/{App.tsx,App.css,App.test.tsx,main.tsx,ratingControlTester.ts,schema.json,uischema.json}`, `src/components/{Header,JsonFormsDemo,Rating,RatingControl}.tsx` | fully read. Not read: lockfile, lint/prettier/CI configs and `public/` assets (not relevant) |
| `vanilla-renderers/README.md`, `Styles.md` @v3.8.0 | fully read |
| `vanilla-renderers/src/{index,renderers,controls/index,cells/index}.ts` @v3.8.0 | fully read |
| `material-renderers/src/index.ts`, `MaterialEnumControl.tsx`, `MaterialAnyOfStringOrEnumControl.tsx` @v3.8.0 | fully read |
| All 126 source files of `packages/{vanilla,material}-renderers/src` @v3.8.0 (11,321 lines) | downloaded. **Every exported tester read** (the table in §5.2). Component bodies other than the files listed above were **not** read line by line, so claims about their rendering come from the tester, the feature table or the file name (INFERRED) |
| Doc example components (`src/components/docs/*.js` other than `renderer-sets.js`, including the i18n `ValuesTable`) | **not read.** They render live examples; the prose is in the MDX |
| Demo pages linked from the docs (`/examples/layouts#…`, `/examples/categorization`, `/examples/gen-both-schemas`, `/examples/gen-uischema`) and outbound references (ROADMAP.md, the JSON Schema spec, understanding-json-schema, lodash `get`, the AJV, ajv-errors and ajv-i18n sites, Material UI, dayjs, the JSON Forms discourse board) | **not read.** Live demos and external references, not capability sources |
| Typedoc API pages (`api.mdx` links) | **not read.** The installed d.ts files are the primary source and were read in full |
| Angular and Vue seed repositories | **not read.** Not React |
| Vue and Angular package READMEs, Material UI and `json-refs` / `json-schema-ref-parser` sites | **not read.** Out of scope (React only) |
| GitHub issues #1770, #1826, #2478, #2572 | title and body read (not comment threads). #2404, #2405 and #2464: titles only |
| npm `@jsonforms/*` list (registry search API) | fully read; all 17 packages in §5.4. The npmjs.com HTML page was not used |
| npm: fragno shadcn, antd, abgov packages | registry metadata read; fragno README and docs "Supported Features" read; package source **not** inspected, so all claims about its code are INFERRED/unvetted |
