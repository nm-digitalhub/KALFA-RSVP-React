import 'server-only';

import { createSafeActionClient, returnServerError } from 'next-safe-action';

import { errorDetail } from '@/lib/error-detail';

// The one client every Server Action is built from (next-safe-action, docs: concepts/action-client, concepts/error-handling).
//
// What the browser gets back is a SafeActionResult, at most one of:
//   - validationErrors: the input or bound-argument schema failed. Flattened ({ formErrors, fieldErrors }), the shape
//     the old FormState.fieldErrors had. The schemas carry the Hebrew messages.
//   - serverError: a string the customer may read (below).
//   - data: what the action returned ({ notice } for most forms).
// redirect() / notFound() are re-thrown to Next.js untouched.
//
// serverError comes from two places:
//   - returnUserError(message): an expected business failure, sent as given (docs: returnServerError, typed alias);
//   - handleServerError: anything the action throws. The data layer throws its customer-facing messages in Hebrew, and
//     none of them carries a provider's error text (src/lib/data: 542 Hebrew throws, 0 interpolating `error.message`,
//     measured 30.10.2026). Those reach the customer unchanged, exactly as the actions' old `err.message` did. Any
//     other message (provider or internal text, in English) is replaced by GENERIC_ACTION_ERROR: the docs' warning
//     against returning `e.message` blindly.
//
// Every thrown failure is LOGGED, the Hebrew ones too, with the error the data layer attached as `cause` (the
// Supabase/Postgres code — errorDetail). The customer's line says what failed; the log keeps why. Before this, a
// Hebrew message was shown and nothing was written, so a failing RPC left no trace at all (owner, 30.10.2026).
// returnUserError is an expected outcome (a wrong password, a refused request) and is not logged.

export const GENERIC_ACTION_ERROR = 'הפעולה נכשלה. נסו שוב.';

const HEBREW = /[֐-׿]/;

export const actionClient = createSafeActionClient({
  defaultValidationErrorsShape: 'flattened',
  handleServerError(error) {
    console.error(`[action] ${error.name}: ${errorDetail(error)}`);
    return HEBREW.test(error.message) ? error.message : GENERIC_ACTION_ERROR;
  },
});

export const returnUserError: (message: string) => never = returnServerError;
