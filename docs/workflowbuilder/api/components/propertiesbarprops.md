> מקור: https://www.workflowbuilder.io/docs/api/components/propertiesbarprops/
> נשמר: 2026-09-09

# PropertiesBarProps

**PropertiesBarProps** = `PropertiesBarBaseProps` & `object`

Props accepted by PropertiesBar.

Provide localized labels (`headerLabel`, `deleteNodeLabel`, `deleteEdgeLabel`), the active tab + change handler, the delete handler, and an optional `tabs` array for extra tabs alongside the default “Properties” tab.

## Type Declaration

### deleteEdgeLabel

**deleteEdgeLabel**: `string`

### deleteNodeLabel

**deleteNodeLabel**: `string`

### headerLabel

**headerLabel**: `string`

### onDeleteClick

**onDeleteClick**: () => `void`

#### Returns

`void`

### onMenuHeaderClick?

`optional` **onMenuHeaderClick?**: () => `void`

#### Returns

`void`

### onTabChange

**onTabChange**: (`tab`) => `void`

#### Parameters

##### tab

`string`

#### Returns

`void`

### tabs?

`optional` **tabs?**: `PropertiesBarTab`[]
