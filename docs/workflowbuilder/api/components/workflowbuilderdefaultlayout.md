> מקור: https://www.workflowbuilder.io/docs/api/components/workflowbuilderdefaultlayout/
> נשמר: 2026-09-09

# WorkflowBuilderDefaultLayout

**WorkflowBuilderDefaultLayout**(): `Element`

Default editor layout — floating overlay with top bar, left palette, right properties panel, and a full-screen canvas underneath. Rendered automatically by `<WorkflowBuilder.Root>` when no children are passed.

Mount it explicitly when you need to mix it with custom overlays:
```tsx
<WorkflowBuilder.Root>
  <WorkflowBuilder.DefaultLayout />
  <MyToast />
</WorkflowBuilder.Root>
```
## Returns

`Element`
