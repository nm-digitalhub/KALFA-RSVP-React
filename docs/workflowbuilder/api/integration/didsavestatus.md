> מקור: https://www.workflowbuilder.io/docs/api/integration/didsavestatus/
> נשמר: 2026-09-09

# DidSaveStatus

**DidSaveStatus** = `"error"` | `"success"` | `"alreadyStarted"`

Resolution of a save attempt — three documented values: `'success'` (committed), `'error'` (failed), `'alreadyStarted'` (a save was already in flight and the new request was coalesced).

Today’s runtime treats every non-empty resolution as “the save finished” and surfaces the success-style snackbar — so all three variants currently look identical at the UI layer. Throw from the save callback (rather than resolving to `'error'`) if you need an error snackbar specifically.
