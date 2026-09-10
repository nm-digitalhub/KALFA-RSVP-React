// The card's warning threshold, in its own module so a CLIENT component can import it
// without dragging in run-key-check.ts — that file is `server-only` and pulls the Slack
// client and the service-role Supabase client behind it.
//
// Deliberately DIFFERENT from the alert threshold that lives beside the queue:
// the card warns at 60 days so whoever opens the panel can plan a renewal, while Slack
// fires at 30 so it is not nagged for two months about a date nobody can act on yet.
// One threshold would have to be either a useless warning or a long nag.
export const EXTRA_KEY_WARN_DAYS = 60;
