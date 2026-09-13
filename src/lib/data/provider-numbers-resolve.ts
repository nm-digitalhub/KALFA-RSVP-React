import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { NumberRole } from '@/lib/validation/provider-numbers';

// Runtime resolution of "which phone number plays this role". Read by send paths and
// by the worker, NOT by the admin panel — the panel reads the admin DAL next door.
//
// ⚠️ NO `next/headers`, DIRECTLY OR TRANSITIVELY. This module is bundled into the
// worker, which has no request. `.dependency-cruiser.cjs` enforces it as
// `worker-no-request-scoped-next` and `worker:deps` runs on every `pretest`, so a
// stray import of the cookie client fails the suite rather than the 3am job. That is
// also why it uses createAdminClient (service_role) rather than createClient.
//
// FAIL-SAFE, NOT FAIL-LOUD, and the distinction is deliberate: a null answer means
// "no number is assigned to this role" and the caller falls back to whatever it used
// before this table existed. Throwing here would take down a send for a lookup that
// has a perfectly good default. Mirrors outreach-config.ts.
//
// The database guarantees at most one row per role — provider_number_roles' PRIMARY
// KEY is `role` alone, not (role, number_id). So "which number is the RSVP sender"
// has exactly one answer by construction, and maybeSingle() cannot be surprised by a
// second row. Reassignment is an upsert on that key, not an insert plus a cleanup.

export interface ResolvedNumber {
  e164: string | null;
  providerRef: string | null;
}

export async function resolveNumberForRole(
  role: NumberRole,
): Promise<ResolvedNumber | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('provider_number_roles')
      .select('provider_numbers(e164, provider_ref, is_active)')
      .eq('role', role)
      .maybeSingle();

    if (error || !data) return null;

    const number = (data as { provider_numbers: unknown }).provider_numbers as
      | { e164: string | null; provider_ref: string | null; is_active: boolean }
      | null;
    if (!number) return null;

    // A deactivated number keeps its role row on purpose — the assignment is still
    // the admin's stated intent, and clearing it on deactivation would silently lose
    // the wiring. Runtime must not USE it, so the answer here is null, same as
    // "unassigned". The panel is where the difference is visible.
    if (!number.is_active) return null;

    return { e164: number.e164, providerRef: number.provider_ref };
  } catch {
    return null;
  }
}

// STRICT twin of resolveNumberForRole, for callers where "no answer" and "could
// not ask" must NOT collapse into the same value.
//
// Why it exists. The fail-safe above is right for a SEND path: a lookup that
// falls over should not take down a send that has a perfectly good default. It
// is wrong for the inbound ROUTER (classifyInboundChannel), where a null import
// number means "legacy — route everything to the RSVP path", and the RSVP path
// is the one that bills. A transient read error there would silently send
// import-number traffic back through insertInteraction + recordReached — the
// exact 2026-09-03 defect (a message to the new number billed against a CLOSED
// brit campaign) re-armed by a fail-safe pointing the wrong way.
//
// So: a query error THROWS. In the worker that lands in handleWebhook's catch →
// markWebhookEventFailed → retried on the next drain, which is the correct
// outcome for a database hiccup. null still means what it always meant — no row
// for this role, or a row whose number is deactivated.
export async function resolveNumberForRoleStrict(
  role: NumberRole,
): Promise<ResolvedNumber | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('provider_number_roles')
    .select('provider_numbers(e164, provider_ref, is_active)')
    .eq('role', role)
    .maybeSingle();

  if (error) {
    throw new Error(`resolveNumberForRoleStrict(${role}) failed`, {
      cause: error,
    });
  }
  if (!data) return null;

  const number = (data as { provider_numbers: unknown }).provider_numbers as
    | { e164: string | null; provider_ref: string | null; is_active: boolean }
    | null;
  if (!number || !number.is_active) return null;

  return { e164: number.e164, providerRef: number.provider_ref };
}
