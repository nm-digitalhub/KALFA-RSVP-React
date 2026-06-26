// Shared form state for Server Actions used with React's useActionState.
// `null` is the initial (untouched) state.
export type FormState =
  | {
      error?: string;
      notice?: string;
      fieldErrors?: Record<string, string[] | undefined>;
    }
  | null;

// Typed result object for non-form domain operations.
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
