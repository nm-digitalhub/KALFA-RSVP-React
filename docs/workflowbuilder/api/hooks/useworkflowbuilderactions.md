> מקור: https://www.workflowbuilder.io/docs/api/hooks/useworkflowbuilderactions/
> נשמר: 2026-09-09

# useWorkflowBuilderActions

**useWorkflowBuilderActions**(): [`WorkflowBuilderActions`](https://www.workflowbuilder.io/docs/api/hooks/workflowbuilderactions/)

Returns a stable object of action callbacks: every command the built-in `<WorkflowBuilder.TopBar />` offers, plus programmatic layout-direction control. Use it from a custom header / toolbar when omitting the bar.

Must be called from a descendant of `<WorkflowBuilder.Root>`; `save` reads the active integration via React context.

## Returns

[`WorkflowBuilderActions`](https://www.workflowbuilder.io/docs/api/hooks/workflowbuilderactions/)

## Example
```tsx
function MyToolbar() {
  const actions = useWorkflowBuilderActions();
  return <button onClick={actions.save}>Save</button>;
}

<WorkflowBuilder.Root>
  <MyToolbar />
  <WorkflowBuilder.Canvas />
</WorkflowBuilder.Root>
```
