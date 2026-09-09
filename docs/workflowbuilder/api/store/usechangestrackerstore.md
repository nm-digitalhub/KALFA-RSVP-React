> מקור: https://www.workflowbuilder.io/docs/api/store/usechangestrackerstore/
> נשמר: 2026-09-09

# useChangesTrackerStore

`const` **useChangesTrackerStore**: `UseBoundStore`<`WithDevtools`<`StoreApi`<`ChangesTrackerStore`>>>

Zustand store that emits a tick every time a tracked diagram change is about to happen. Subscribe with `useChangesTrackerStore((s) => s.lastChangeName)` (or other fields) to react to changes — useful for undo/redo plugins, autosave, audit logging, and so on.

State shape: `{ lastChangeName, lastChangeParams, lastChangeTimestamp }` — the timestamp is the cheapest field to subscribe to when you only care about “something changed”.
