import 'server-only';

import { computeOfferOption, type OfferKind } from '@/lib/offers/pricing';
import { createAdminClient } from '@/lib/supabase/admin';

// The sales agent's discount (personal-coupons task 6.2, D9/D14/D16/D23): the server-side brain of
// `apply_discount_tier`. The agent only REPORTS the customer's objection; everything else — which
// offer, which packages, which prices — is decided here, from the staff-managed offers table, and
// durably recorded BEFORE anything is promised (the spec's "an offer is promised only after it is
// saved"). No caller-sent price, value or package is ever read.
//
// Identity is the resolved sales_call_attempts row (the route's guard) — there is no user session,
// so the audit rows are service-role inserts with no user id, and the one-time claim to an account
// happens later, at package choice (task 5.2), never here.
//
// D16: one ACTIVE assignment per phone. A further call for the phone returns THAT assignment with
// its existing options and expiry — no new assignment, no renewed validity — except a controlled
// escalation (D23): an offer explicitly marked may_replace, that worsens no shared package's
// promised final price, while the old assignment is not bound into approved terms or held by a
// package payment. The replaced assignment is closed into history, never deleted.

export type AgentDiscountOption = {
  package_id: string;
  package_name: string;
  list_price: number;
  final_price: number;
};

export type AgentDiscountAnswer =
  | {
      status: 'offer';
      offer: { id: string; title: string };
      options: AgentDiscountOption[];
      expiresAt: string;
    }
  | { status: 'no_offer' };

type AdminClient = ReturnType<typeof createAdminClient>;

type OfferRow = {
  id: string;
  title: string;
  kind: string;
  value: number;
  validity_days: number;
  may_replace: boolean;
  agent_objections: string[];
  created_at: string;
  offer_packages: { package_id: string; value_override: number | null }[] | null;
};

type AssignmentRow = {
  id: string;
  offer_id: string;
  state: string;
  bound_campaign_id: string | null;
  expires_at: string;
  offers: { title: string } | null;
  coupon_assignment_options:
    | { package_id: string; list_price: number; final_price: number; packages: { name: string } | null }[]
    | null;
};

const ASSIGNMENT_COLUMNS =
  'id, offer_id, state, bound_campaign_id, expires_at, offers(title), coupon_assignment_options(package_id, list_price, final_price, packages(name))';

// D23's matching: the offer's agent_objections are FREE VALUES the staff wrote; the agent's report
// is the customer's words. An offer with NO objection values answers any reported objection (a
// general offer); otherwise one of its values must appear in the report, or the report in it,
// case-insensitively. The report is a claim recorded for audit — never proof, never a price input.
function offerMatchesObjection(objections: string[], reason: string): boolean {
  if (objections.length === 0) return true;
  const report = reason.trim().toLowerCase();
  if (report === '') return false;
  return objections.some((value) => {
    const needle = value.trim().toLowerCase();
    return needle !== '' && (report.includes(needle) || needle.includes(report));
  });
}

type ComputedOffer = {
  offer: OfferRow;
  explicitMatch: boolean;
  options: (AgentDiscountOption & { discount_amount: number })[];
};

// The agent-allowed offers whose rules match the reported objection, each with its options
// computed from the packages' CURRENT prices (the shared computeOfferOption — what an assignment
// freezes). An offer that floors any allowed package at zero or below cannot be honored (the
// payment builder refuses a non-positive line) and is skipped. Ranking: an EXPLICIT objection
// match beats a catch-all; ties go to the newest offer.
async function matchingOffers(admin: AdminClient, reason: string): Promise<ComputedOffer[]> {
  const { data, error } = await admin
    .from('offers')
    .select(
      'id, title, kind, value, validity_days, may_replace, agent_objections, created_at, offer_packages(package_id, value_override)',
    )
    .eq('is_active', true)
    .eq('allow_agent', true);
  if (error || !data) return [];

  const offers = (data as OfferRow[]).filter(
    (o) => (o.offer_packages ?? []).length > 0 && offerMatchesObjection(o.agent_objections, reason),
  );
  if (offers.length === 0) return [];

  const packageIds = [...new Set(offers.flatMap((o) => (o.offer_packages ?? []).map((p) => p.package_id)))];
  const { data: packages, error: pkgError } = await admin
    .from('packages')
    .select('id, name, price_with_vat')
    .in('id', packageIds);
  if (pkgError || !packages) return [];
  const byId = new Map(packages.map((p) => [p.id, p]));

  const computed: ComputedOffer[] = [];
  for (const offer of offers) {
    const kind: OfferKind = offer.kind === 'amount' ? 'amount' : 'percent';
    const options: ComputedOffer['options'] = [];
    let honorable = true;
    for (const allowed of offer.offer_packages ?? []) {
      const pkg = byId.get(allowed.package_id);
      if (!pkg) {
        honorable = false;
        break;
      }
      const price = Number(pkg.price_with_vat);
      const { discountAmount, finalPrice } = computeOfferOption(
        price,
        kind,
        Number(allowed.value_override ?? offer.value),
      );
      if (finalPrice <= 0) {
        honorable = false;
        break;
      }
      options.push({
        package_id: allowed.package_id,
        package_name: pkg.name,
        list_price: price,
        final_price: finalPrice,
        discount_amount: discountAmount,
      });
    }
    if (honorable && options.length > 0) {
      computed.push({ offer, explicitMatch: offer.agent_objections.length > 0, options });
    }
  }

  return computed.sort(
    (a, b) =>
      Number(b.explicitMatch) - Number(a.explicitMatch) ||
      Date.parse(b.offer.created_at) - Date.parse(a.offer.created_at),
  );
}

function toAnswer(row: AssignmentRow): AgentDiscountAnswer {
  return {
    status: 'offer',
    offer: { id: row.offer_id, title: row.offers?.title ?? '' },
    options: (row.coupon_assignment_options ?? []).map((o) => ({
      package_id: o.package_id,
      package_name: o.packages?.name ?? '',
      list_price: Number(o.list_price),
      final_price: Number(o.final_price),
    })),
    expiresAt: row.expires_at,
  };
}

// The audit row (task 6.2): a SERVICE-ROLE activity insert — there is no session user to satisfy
// logActivity. The reported objection is kept (the spec's audit requirement); the row stores no
// payment data. A failed audit write is loud, never fatal: the assignment row and its events table
// are the primary record.
async function recordAgentDiscountActivity(
  admin: AdminClient,
  meta: Record<string, string | undefined>,
): Promise<void> {
  const { error } = await admin.from('activity_log').insert({
    action: 'coupon.agent_discount',
    user_id: null,
    meta,
  });
  if (error) {
    console.error('[agent-benefits] activity insert failed', { error: error.message });
  }
}

async function insertAssignment(
  admin: AdminClient,
  {
    callAttemptId,
    phoneE164,
    candidate,
    objectionReason,
  }: {
    callAttemptId: string;
    phoneE164: string;
    candidate: ComputedOffer;
    objectionReason: string;
  },
): Promise<{ id: string; expiresAt: string } | 'conflict' | 'failed'> {
  const expiresAt = new Date(
    Date.now() + candidate.offer.validity_days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const kind: OfferKind = candidate.offer.kind === 'amount' ? 'amount' : 'percent';

  const { data, error } = await admin
    .from('coupon_assignments')
    .insert({
      offer_id: candidate.offer.id,
      sales_call_attempt_id: callAttemptId,
      phone_e164: phoneE164,
      kind,
      value: Number(candidate.offer.value),
      expires_at: expiresAt,
      idempotency_key: callAttemptId,
    })
    .select('id')
    .single();
  if (error) {
    // 23505: one-per-call or one-active-per-phone — a concurrent writer won; the caller re-reads.
    return error.code === '23505' ? 'conflict' : 'failed';
  }

  const { error: optionsError } = await admin.from('coupon_assignment_options').insert(
    candidate.options.map((o) => ({
      assignment_id: data.id,
      package_id: o.package_id,
      list_price: o.list_price,
      discount_amount: o.discount_amount,
      final_price: o.final_price,
    })),
  );
  if (optionsError) {
    // An assignment without its frozen options is not a promise we can keep — remove it.
    await admin.from('coupon_assignments').delete().eq('id', data.id);
    return 'failed';
  }

  await admin.from('coupon_assignment_events').insert({
    assignment_id: data.id,
    action: 'assigned',
    actor_user_id: null,
    reason: objectionReason,
  });

  return { id: data.id, expiresAt };
}

// Whether the active assignment may be REPLACED by the candidate (D23's controlled escalation).
// Refusals, in order: the offer does not allow replacing; the assignment is bound into APPROVED
// terms (locked round) or its campaign holds a package payment (pending/review/succeeded); a
// shared package's promised final price would rise; or nothing would actually change.
async function escalationAllowed(
  admin: AdminClient,
  active: AssignmentRow,
  candidate: ComputedOffer,
): Promise<'replace' | 'keep'> {
  if (!candidate.offer.may_replace) return 'keep';
  if (candidate.offer.id === active.offer_id) return 'keep';

  if (active.state === 'bound' && active.bound_campaign_id) {
    const { data: payment, error: payError } = await admin
      .from('payment_operations')
      .select('id')
      .eq('campaign_id', active.bound_campaign_id)
      .eq('kind', 'package_purchase')
      .in('outcome', ['pending', 'review', 'succeeded'])
      .limit(1)
      .maybeSingle();
    if (payError || payment) return 'keep';

    const { data: round, error: roundError } = await admin
      .from('campaign_pricing')
      .select('id, locked_at')
      .eq('campaign_id', active.bound_campaign_id)
      .is('superseded_at', null)
      .maybeSingle();
    if (roundError || (round && round.locked_at !== null)) return 'keep';
  }

  // No shared package's promised price may rise — and at least one must actually improve, or the
  // "escalation" is churn for nothing and the existing promise stands.
  const oldByPackage = new Map(
    (active.coupon_assignment_options ?? []).map((o) => [o.package_id, Number(o.final_price)]),
  );
  let improves = false;
  for (const option of candidate.options) {
    const promised = oldByPackage.get(option.package_id);
    if (promised === undefined) continue;
    if (option.final_price > promised) return 'keep';
    if (option.final_price < promised) improves = true;
  }
  return improves ? 'replace' : 'keep';
}

/**
 * The whole decision, in the spec's order: the SAME call's assignment is answered as-is
 * (idempotent per source); then the phone's active assignment is returned unchanged — or
 * replaced, only under D23's escalation rules; an expired active row is voided and a fresh
 * assignment follows; and when nothing can be assigned or recorded, the answer is no_offer —
 * nothing is promised that was not durably written first.
 */
export async function applyAgentDiscount({
  callAttemptId,
  phoneE164,
  objectionReason,
}: {
  callAttemptId: string;
  phoneE164: string;
  objectionReason: string;
}): Promise<AgentDiscountAnswer> {
  const admin = createAdminClient();

  // 1. One assignment per sales call, whatever package is discussed (D3): a repeated tool call in
  //    the same call answers the existing assignment with the same options and prices.
  const { data: own, error: ownError } = await admin
    .from('coupon_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('sales_call_attempt_id', callAttemptId)
    .maybeSingle();
  if (ownError) return { status: 'no_offer' };
  if (own && ['assigned', 'bound', 'consumed'].includes((own as unknown as AssignmentRow).state)) {
    return toAnswer(own as unknown as AssignmentRow);
  }

  // 2. The phone's ACTIVE assignment (D16).
  const { data: activeRows, error: activeError } = await admin
    .from('coupon_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('phone_e164', phoneE164)
    .in('state', ['assigned', 'bound'])
    .limit(1);
  if (activeError) return { status: 'no_offer' };
  const active = (activeRows?.[0] ?? null) as AssignmentRow | null;

  if (active && Date.parse(active.expires_at) > Date.now()) {
    const candidates = await matchingOffers(admin, objectionReason);
    for (const candidate of candidates) {
      if ((await escalationAllowed(admin, active, candidate)) !== 'replace') continue;

      // Release, void, insert frozen options, history and re-bind are ONE RPC transaction.
      // The RPC rechecks live state after row locks; the earlier read is only a quick precheck.
      let replacementId: string | null = null;
      try {
        const { data, error } = await admin.rpc('replace_sales_coupon_assignment', {
          _old_assignment_id: active.id,
          _call_attempt_id: callAttemptId,
          _phone_e164: phoneE164,
          _offer_id: candidate.offer.id,
          _objection_reason: objectionReason,
          _options: candidate.options.map((option) => ({
            package_id: option.package_id,
            list_price: option.list_price,
            discount_amount: option.discount_amount,
            final_price: option.final_price,
          })),
        });
        if (!error && typeof data === 'string') replacementId = data;
      } catch {
        // The response may have been lost AFTER commit. Never advertise the cached old row.
      }

      // Reread the durable state on success AND failure. A rollback retains the old promise;
      // an unknown-but-committed result exposes the new one, without another replacement write.
      const { data: latest, error: latestError } = await admin
        .from('coupon_assignments')
        .select(ASSIGNMENT_COLUMNS)
        .eq('phone_e164', phoneE164)
        .in('state', ['assigned', 'bound'])
        .limit(1)
        .maybeSingle();
      const durable = latest as AssignmentRow | null;
      if (latestError || !durable || Date.parse(durable.expires_at) <= Date.now()
          || !durable.coupon_assignment_options?.length) return { status: 'no_offer' };

      await recordAgentDiscountActivity(admin, {
        callAttemptId,
        objectionReason,
        outcome: replacementId === durable.id ? 'escalated' : 'replacement_state_reread',
        assignmentId: durable.id,
        replacedAssignmentId: active.id,
      });
      return toAnswer(durable);
    }

    // No allowed escalation: the existing assignment IS the answer — same options, same expiry.
    await recordAgentDiscountActivity(admin, {
      callAttemptId,
      objectionReason,
      outcome: 'existing_returned',
      assignmentId: active.id,
    });
    return toAnswer(active);
  }

  // 3. An EXPIRED row still occupies the one-active-per-phone slot (the partial unique index):
  //    void it here, in the assign path, before creating the new one — the schema's own rule.
  if (active) {
    await admin
      .from('coupon_assignments')
      .update({ state: 'void' })
      .eq('id', active.id)
      .in('state', ['assigned', 'bound']);
    await admin.from('coupon_assignment_events').insert({
      assignment_id: active.id,
      action: 'voided',
      actor_user_id: null,
      reason: 'expired',
    });
  }

  // 4. A fresh assignment from the best-matching offer.
  const candidates = await matchingOffers(admin, objectionReason);
  const candidate = candidates[0];
  if (!candidate) {
    await recordAgentDiscountActivity(admin, { callAttemptId, objectionReason, outcome: 'no_offer' });
    return { status: 'no_offer' };
  }

  const written = await insertAssignment(admin, { callAttemptId, phoneE164, candidate, objectionReason });
  if (written === 'conflict') {
    // A concurrent writer took the phone's slot or this call's slot — answer whatever it wrote.
    const { data: again } = await admin
      .from('coupon_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .eq('phone_e164', phoneE164)
      .in('state', ['assigned', 'bound'])
      .limit(1);
    const row = (again?.[0] ?? null) as AssignmentRow | null;
    if (row) return toAnswer(row);
    return { status: 'no_offer' };
  }
  if (written === 'failed') {
    await recordAgentDiscountActivity(admin, { callAttemptId, objectionReason, outcome: 'write_failed' });
    return { status: 'no_offer' };
  }

  await recordAgentDiscountActivity(admin, {
    callAttemptId,
    objectionReason,
    outcome: 'assigned',
    offerId: candidate.offer.id,
    assignmentId: written.id,
  });
  return {
    status: 'offer',
    offer: { id: candidate.offer.id, title: candidate.offer.title },
    options: candidate.options.map(({ package_id, package_name, list_price, final_price }) => ({
      package_id,
      package_name,
      list_price,
      final_price,
    })),
    expiresAt: written.expiresAt,
  };
}
