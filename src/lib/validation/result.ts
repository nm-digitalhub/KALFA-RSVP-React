import type { ZodIssue } from 'zod';

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

// Build FormState.fieldErrors from raw Zod issues, keyed by the dotted path
// (e.g. "outreach_schedule.0.message_key", "celebrants.groom") so the form can
// attach an error to the exact nested field. .flatten() only produces
// top-level keys — it cannot express this, so actions that need dotted keys
// use this instead (and merge with flatten() output where both appear).
export function issuesToFieldErrors(issues: ZodIssue[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join('.') || '_root';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function mergeFieldErrors(
  ...groups: (Record<string, string[]> | undefined)[]
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const group of groups) {
    if (!group) continue;
    for (const [key, messages] of Object.entries(group)) {
      (out[key] ??= []).push(...messages);
    }
  }
  return out;
}
