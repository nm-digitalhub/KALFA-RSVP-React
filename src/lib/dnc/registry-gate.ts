import 'server-only';

import { dncRegistryGateEnabled } from '@/lib/data/call-compliance-settings';
import type { createAdminClient } from '@/lib/supabase/admin';

import { checkRegistry, type RegistryCheck } from './registry-check';

// The national Do-Not-Call registry as one gate in a dial decision (openspec/changes/dnc-registry-dial-gate, D2/D4/D8).
// Called by evaluateSharedConsentGates (src/lib/data/console-calls.ts) after the cheap gates, so a dial already refused
// for opt-out, Shabbat or the daily window never reaches the registry.
//
// The policy says whether the call is marketing (Consumer Protection Law 16ב(א)):
//   not_applicable       — not a marketing call (RSVP, service, a guest of an event): never consulted, nothing recorded.
//   required             — a marketing call: checked before the provider is called.
//   exempt_if_requested  — a marketing call that is exempt when the person asked to be called (Sixth Schedule item 1):
//                          a request they submitted, or a call they placed to us that went unanswered (owner rulings
//                          11.10.2026). Without such a record it is checked like `required`.
//
// Every decision this gate makes is written to dnc_registry_checks BEFORE it returns ok — the record is the proof the
// law puts on the business, so a failed write holds the dial back (it waits, like an unavailable registry).

export type NationalRegistryPolicy = 'not_applicable' | 'required' | 'exempt_if_requested';

export type RegistryGateContext = {
  /** Which dial surface asked, e.g. 'sales_call', 'console_manual'. Recorded; no personal data. */
  dialPath: string;
  /** The callback request behind the call, when there is one. Its origin decides the exemption. */
  exemption?: { origin: string | null; ref: string } | null;
  jobId?: string | null;
  attemptId?: string | null;
};

export type RegistryGateRefusal = 'dnc' | 'registry_listed' | 'registry_unchecked' | 'registry_pending';

/** The callback-request origins that mean the person asked to be called. */
export const EXEMPT_ORIGINS: ReadonlySet<string> = new Set(['person_request', 'missed_call']);

type AdminClient = ReturnType<typeof createAdminClient>;

async function record(
  admin: AdminClient,
  phone: string,
  ctx: RegistryGateContext,
  decision: Omit<RegistryCheck, 'result'> & { result: RegistryCheck['result'] | 'exempt' },
  exemptionRef: string | null,
): Promise<boolean> {
  try {
    const { error } = await admin.from('dnc_registry_checks').insert({
      phone_e164: phone,
      checked_at: decision.checkedAt,
      result: decision.result,
      source: decision.source,
      transaction_id: decision.transactionId,
      error_code: decision.errorCode,
      failure: decision.failure,
      purpose: 'marketing',
      dial_path: ctx.dialPath,
      exemption_ref: exemptionRef,
      job_id: ctx.jobId ?? null,
      attempt_id: ctx.attemptId ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function evaluateRegistryGate(
  admin: AdminClient,
  phone: string,
  policy: NationalRegistryPolicy,
  ctx: RegistryGateContext,
): Promise<{ ok: true } | { ok: false; reason: RegistryGateRefusal }> {
  if (policy === 'not_applicable') return { ok: true };
  if (!(await dncRegistryGateEnabled())) return { ok: true };

  if (policy === 'exempt_if_requested' && ctx.exemption && EXEMPT_ORIGINS.has(ctx.exemption.origin ?? '')) {
    const recorded = await record(
      admin,
      phone,
      ctx,
      {
        result: 'exempt',
        source: 'none',
        transactionId: null,
        errorCode: null,
        failure: null,
        checkedAt: new Date().toISOString(),
      },
      ctx.exemption.ref,
    );
    return recorded ? { ok: true } : { ok: false, reason: 'registry_pending' };
  }

  const check = await checkRegistry(phone);
  if (!(await record(admin, phone, ctx, check, null))) return { ok: false, reason: 'registry_pending' };

  switch (check.result) {
    case 'registry_clear':
    case 'not_covered':
      return { ok: true };
    case 'local_blocked':
      return { ok: false, reason: 'dnc' };
    case 'registry_listed':
      return { ok: false, reason: 'registry_listed' };
    case 'registry_unchecked':
      return { ok: false, reason: 'registry_unchecked' };
    case 'registry_unavailable':
      return { ok: false, reason: 'registry_pending' };
  }
}
