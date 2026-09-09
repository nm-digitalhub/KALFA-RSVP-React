> מקור: https://www.workflowbuilder.io/docs/api/components/projectselectionprops/
> נשמר: 2026-09-09

# ProjectSelectionProps

**ProjectSelectionProps** = `object`

Props accepted by ProjectSelection. Use this when typing a `registerComponentDecorator<ProjectSelectionProps>('ProjectSelection', …)` call.

## Properties

### onDuplicateClick?

`optional` **onDuplicateClick?**: () => `void`

Optional handler for the kebab menu’s “Duplicate to Drafts” item. The item is rendered only when this is provided — omit it and the item is absent.

#### Returns

`void`
