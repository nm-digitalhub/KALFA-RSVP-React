// Reading a Server Action's result in a form (client and server safe). Every action is built from
// src/lib/safe-action.ts, so its result has at most one of serverError, validationErrors (flattened) or data.

export type ActionFormResult = {
  serverError?: string;
  validationErrors?: { formErrors: string[]; fieldErrors: Partial<Record<string, string[]>> };
};

// The one message a form shows above its submit button: the server's, else the first validation message. A form whose
// old action answered a failed parse with one form-level error (FormState.error) shows the same text in the same place.
export function actionErrorMessage(result: ActionFormResult | null | undefined): string | undefined {
  if (!result) return undefined;
  if (result.serverError) return result.serverError;
  const ve = result.validationErrors;
  if (!ve) return undefined;
  return ve.formErrors[0] ?? Object.values(ve.fieldErrors).find((messages) => messages?.length)?.[0];
}

// The form-level message of a form that shows field messages under its own fields (its old action answered a failed
// parse with fieldErrors, not one error): the server's or a form-level one only, so a field's message is never shown a
// second time above the button, and a hidden field's message never appears.
export function actionFormError(result: ActionFormResult | null | undefined): string | undefined {
  if (!result) return undefined;
  return result.serverError ?? result.validationErrors?.formErrors[0];
}
