# Microsoft 365 OAuth from a workflow node

## Goal

The Microsoft 365 email node must support an n8n-like connection flow inside
its properties form:

1. Choose an existing Microsoft workflow connection.
2. Or save the workflow and connect a new Microsoft 365 account.
3. Complete the existing delegated OAuth flow.
4. Return to the same workflow.
5. Reload the server-provided connection options and continue editing.

The workflow JSON persists only `properties.connectionId`, whose value is the
UUID of an `integration_connections` row.

## Existing contracts verified

- The installed editor is `@workflowbuilder/sdk@2.3.0`.
- Node properties are rendered by JsonForms.
- The SDK publicly re-exports `JsonFormsDispatch`, `optionIs`, `rankWith`,
  `withJsonFormsControlProps`, and `useWorkflowBuilderActions`.
- The SDK does not export its built-in Select React component.
- Consumer renderers registered through `WorkflowBuilder.Root.jsonForm` are
  evaluated before built-in renderers.
- `useWorkflowBuilderActions().save()` must run below
  `WorkflowBuilder.Root` and returns `success`, `error`, or `alreadyStarted`.
- The existing OAuth entry point is `/api/integrations/oauth/start`.
- The OAuth start route and `oauth-flow.ts` remain authoritative for RBAC,
  provider resolution, capabilities/scopes, state, PKCE, redirect URI, the
  Microsoft authorization URL, and connection persistence.
- The callback already returns to a sanitized same-app `redirectTo` with only
  the generic `oauth=connected` or `oauth=failed` outcome.
- Microsoft connection options are loaded server-side and mapped to safe
  `{ label, value }` objects. `value` is the UUID persisted in `connectionId`.

## Decision

Use one narrow Custom JsonForms renderer registered through
`@workflowbuilder/sdk`. Do not use a WorkflowBuilder component plugin.

This is a field-level interaction. A `PropertiesBar` plugin can only decorate
or wrap the whole panel and does not receive the JsonForms field contract. A
renderer is mounted at `connectionId`, retains JsonForms ownership of the
value, and can place the connection action immediately next to the picker.

The UISchema control remains `type: 'Select'` and carries declarative renderer
configuration:

```ts
options: {
  format: 'integration-connection',
  provider: 'microsoft',
  capability: 'mail.send',
}
```

The renderer delegates the actual field to the SDK's built-in Select using
`JsonFormsDispatch`. Before dispatch it removes `format`, `provider`, and
`capability` from the delegated UISchema. Removing `format` is mandatory:
otherwise the nested dispatch would select the same custom renderer again and
recurse.

No component imports from `@jsonforms/core` or `@jsonforms/react`. The SDK's
re-exports must be used so the renderer consumes the same React context and
renderer registry as WorkflowBuilder.

## Flow

```text
Microsoft email node
  -> integrationConnectionRenderer
     -> SDK built-in Select
        -> handleChange(path, connection UUID)
     -> Connect new account
        -> useWorkflowBuilderActions().save()
        -> only continue when status === success
        -> /api/integrations/oauth/start
           provider=microsoft
           capability=mail.send
           redirectTo=/admin/workflows/<workflow-id>
        -> existing openid-client OAuth flow
        -> Microsoft login and consent
        -> existing callback
        -> same workflow with oauth=connected or oauth=failed
        -> Server Component reloads safe Microsoft connection options
```

## Server/client boundary

The workflow page reads:

- safe active Microsoft connection options;
- the safe provider configuration status;
- whether the current user has `integrations.manage`.

The client receives only:

- `{ label, value }` connection options;
- a boolean indicating whether a new connection may be started;
- a display-only unavailability reason;
- the workflow ID used in the same-app return path.

The client must never receive provider secrets, Vault IDs, access tokens,
refresh tokens, scopes, token payloads, or full connection rows.

The start route independently enforces `integrations.manage`; the client-side
disabled state is UX, not authorization.

## Save and redirect rules

- Saving before OAuth is required, not optional.
- Do not redirect when `save()` throws or returns anything other than
  `success`.
- Show a generic local save failure and let the user retry.
- Use the existing start route; do not construct a Microsoft authorization URL.
- Do not implement PKCE, state, scopes, callback exchange, or refresh logic in
  the renderer or editor.

## Callback outcome

The workflow page reads `searchParams.oauth` and shows only generic success or
failure notices. Internal OAuth errors do not enter the query string or UI.

The callback will not be changed to return a connection UUID. Consequently the
new connection appears in the refreshed Select but is not automatically
selected. This deliberately avoids changing the OAuth protocol contract for a
minor UX improvement.

## Implementation plan

1. Add the shared `integration-connection` UISchema format constant.
2. Mark only the Microsoft `connectionId` Select with the format, provider, and
   capability configuration.
3. Add the renderer and a narrow context carrying safe workflow/start state.
4. Strip the custom marker before delegating to `JsonFormsDispatch`.
5. Require a successful SDK save before navigating to the existing start route.
6. Register the renderer in the existing `jsonForm.renderers` array.
7. Read safe provider readiness and `integrations.manage` on the workflow Server
   Component and pass only the derived client state.
8. Return OAuth to the current workflow and render its generic outcome there.
9. Keep the existing admin OAuth configuration page; it configures the provider
   but is no longer required as the place from which an account connection must
   be initiated.
10. Add tests for renderer matching/delegation, recursion prevention, exact
    start-route parameters, save-before-redirect behavior, UISchema metadata,
    safe server props, and generic callback notices.
11. Run targeted Vitest, TypeScript, scoped ESLint, the existing workflow tests,
    and the production build. Browser-check the properties panel if the local
    environment can authenticate an admin session.

## Non-goals

- No WorkflowBuilder component plugin for this feature.
- No custom OAuth runtime.
- No second Microsoft authentication mechanism.
- No change to callback payloads or OAuth protocol behavior.
- No automatic selection of the newly created connection.
- No persistence of labels or credential material in workflow JSON.

## Validation record

Validated on 2026-09-16 against the installed Next.js 16.3.4,
`@workflowbuilder/sdk` 2.3.0, and JsonForms 3.8.0 contracts:

- Targeted OAuth, connection, renderer, catalogue, route, and Microsoft step
  tests: 59 passed.
- Workflow/editor regression suite: 63 test files and 853 tests passed.
- `npm run typecheck`: passed.
- Scoped ESLint for the changed application/data/catalogue files: passed.
- `npm run build`: passed, including webpack compilation, TypeScript, page data,
  static generation, and route tracing. `/admin/workflows/[id]`, the existing
  OAuth start/callback handlers, and `/admin/integrations/workflow-oauth` are all
  present as dynamic routes in the production route manifest.
- Client-boundary inspection: the renderer imports only React, UI components,
  SDK exports, and the inert UISchema format constant. It imports no Supabase,
  server-only DAL, Vault, credential accessor, or OAuth protocol module.
- Return-path inspection: the callback redirects to the stored sanitized
  workflow path with a generic outcome; the Server Component performs a fresh
  `listActiveMicrosoftWorkflowConnections()` read and rebuilds the live Select
  options. The connect handler does not call `handleChange`, so returning from
  OAuth does not mutate workflow JSON.

Not yet validated end-to-end against Microsoft Entra/Graph:

- interactive consent;
- callback against a real tenant;
- credential/connection creation in the deployed database;
- immediate appearance of that real connection in the Select;
- a real delegated `POST /me/sendMail` execution.

Those checks require an enabled Microsoft provider configuration and a test
account capable of granting `Mail.Send`.
