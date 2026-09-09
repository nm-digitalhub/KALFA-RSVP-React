> מקור: https://www.workflowbuilder.io/docs/api/components/optionalnodecontent/
> נשמר: 2026-09-09

# OptionalNodeContent

`const` **OptionalNodeContent**: `MemoExoticComponent`<(`props`) => `Element`>

Plugin slot mounted inside every node body. By default renders its children unchanged; plugins can attach extra UI here via [registerComponentDecorator](https://www.workflowbuilder.io/docs/api/plugins/registercomponentdecorator/) keyed `'OptionalNodeContent'`.

The slot receives `nodeId` so decorators can scope their content to specific nodes (e.g. show a status badge only on certain types).
