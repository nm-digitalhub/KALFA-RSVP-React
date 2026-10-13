import 'server-only';

import { logActivity } from '@/lib/data/activity';
import { listEligibleBenefits, type EligibleBenefit } from '@/lib/data/coupon-benefits';
import { computeOfferOption, type OfferKind } from '@/lib/offers/pricing';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/phone';
import { deriveAssignmentDisplayStatus, type AssignmentDisplayStatus } from '@/lib/offers/assignment-display-status';
import { listOfferPackageChoices, listOffers } from './offers';

type AdminClient = ReturnType<typeof createAdminClient>;

// Staff assignment of a personal benefit (personal-coupons tasks 5.3/7.3, mockup ui/AssignNew.dc.html).
// The STAFF source: an assignment to a specific ACCOUNT, no phone proof needed (D13; the mockup's
// own note). The agent source (a sales call, D23's usage rules) is the 6.2 tool — it shares the
// frozen-options math here through computeOfferOption, never a second computation.
//
// What is frozen at assignment time (D3): kind, value, expiry (now + the offer's validity days),
// and one option per allowed package with the package's CURRENT list price and the computed final
// price. A later change to the offer or the package price never touches this assignment.
//
// D18's duplicate rule: a new assignment whose option set is IDENTICAL to an active one of the
// same account — the same packages, the same final price on each — does not stay: the one whose
// validity ends sooner is voided with an audited reason. Any other overlap leaves both active
// (best-price-per-package decides at binding).

export type StaffAssignmentResult = {
  assignmentId: string;
  /** The assignment the flow should SHOW: on a duplicate-void of the new row, the KEPT one. */
  keptAssignmentId: string;
  /** 'created' | 'existing' (an idempotent retry) — and whether the duplicate rule voided a row. */
  outcome: 'created' | 'existing';
  duplicateVoided: 'none' | 'new' | 'previous';
  expiresAt: string;
  options: { packageId: string; packageName: string; listPrice: number; finalPrice: number }[];
};

type OfferRow = {
  id: string;
  kind: string;
  value: number;
  validity_days: number;
  allow_staff: boolean;
  is_active: boolean;
  offer_packages: { package_id: string; value_override: number | null }[] | null;
};

export type VoidRefusal =
  | 'held_by_payment'
  | 'held_by_review'
  | 'held_by_approved_terms'
  | 'already_ended'
  | 'needs_investigation';
export type VoidResult = { outcome: 'voided' } | { outcome: 'refused'; reason: VoidRefusal };

// The staff void (admin-panel ד.3, spec §9): decided by ONE transaction
// (void_staff_coupon_assignment, migration 20261013002106) under locks in the canonical
// order — release + state + the void event commit together, the staff reason is REQUIRED
// (stored in meta.staff_reason), a no-op never answers success, and a repeat void writes
// no second event. This wrapper only gates, forwards and maps.
export async function voidStaffAssignment(assignmentId: string, staffReason: string): Promise<VoidResult> {
  const staff = await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();

  const reason = staffReason.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new Error('נדרשת סיבת ביטול (עד 500 תווים)');
  }

  const { data, error } = await admin.rpc('void_staff_coupon_assignment', {
    _staff_id: staff.id,
    _assignment_id: assignmentId,
    _staff_reason: reason,
  });
  if (error) {
    if ((error.message ?? '').includes('not found')) {
      const { notFound } = await import('next/navigation');
      notFound();
    }
    throw new Error('ביטול ההטבה נכשל');
  }
  const result = data as { outcome: 'voided' | 'refused'; reason?: VoidRefusal };
  if (result.outcome === 'voided') {
    await logActivity({ action: 'coupon.voided', meta: { assignmentId, by: 'staff' } });
    return { outcome: 'voided' };
  }
  return { outcome: 'refused', reason: result.reason ?? 'already_ended' };
}

export type ConfirmedOption = { packageId: string; listPrice: number; discountAmount: number; finalPrice: number };

export async function createStaffAssignment({
  userId,
  offerId,
  idempotencyKey,
  confirmedOptions,
}: {
  userId: string;
  offerId: string;
  idempotencyKey: string;
  /** The preview the staff member confirmed — validated INSIDE the create transaction. */
  confirmedOptions?: ConfirmedOption[];
}): Promise<StaffAssignmentResult> {
  const staff = await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();

  // The offer, server-side (D14): nothing about the discount is accepted from the browser.
  const { data: offerRow, error: offerError } = await admin
    .from('offers')
    .select('id, kind, value, validity_days, allow_staff, is_active, offer_packages(package_id, value_override)')
    .eq('id', offerId)
    .maybeSingle();
  if (offerError) throw new Error('טעינת ההצעה נכשלה');
  const offer = offerRow as OfferRow | null;
  if (!offer || !offer.is_active) throw new Error('ההצעה אינה פעילה');
  if (!offer.allow_staff) throw new Error('ההצעה אינה מוקצית על ידי צוות');
  const allowed = offer.offer_packages ?? [];
  if (allowed.length === 0) throw new Error('להצעה אין חבילות');

  // The terms, from the packages' CURRENT prices via the one shared computation. These are
  // what the RPC receives as the confirmed preview — SERVER-computed; when the staff member
  // confirmed a preview, it must match these exactly or the answer is the re-confirm error.
  const { data: packages, error: packagesError } = await admin
    .from('packages')
    .select('id, name, price_with_vat')
    .in('id', allowed.map((p) => p.package_id));
  if (packagesError || !packages || packages.length !== allowed.length) {
    throw new Error('טעינת חבילות ההצעה נכשלה');
  }
  const byId = new Map(packages.map((p) => [p.id, p]));
  const kind: OfferKind = offer.kind === 'amount' ? 'amount' : 'percent';
  const options = allowed.map((p) => {
    const pkg = byId.get(p.package_id)!;
    const price = Number(pkg.price_with_vat);
    const { discountAmount, finalPrice } = computeOfferOption(
      price,
      kind,
      Number(p.value_override ?? offer.value),
    );
    if (finalPrice <= 0) throw new Error(`ההצעה מביאה את החבילה "${pkg.name}" למחיר אפס או שלילי`);
    return {
      packageId: p.package_id,
      packageName: pkg.name,
      listPrice: price,
      discountAmount,
      finalPrice,
    };
  });

  // A confirmed preview that differs from today's terms refuses BEFORE the transaction —
  // the same comparison runs again inside the RPC under locks (ד.2), so a race between
  // this check and the commit still refuses there.
  if (confirmedOptions) {
    const agorot = (n: number) => Math.round(n * 100);
    const byPackage = new Map(confirmedOptions.map((o) => [o.packageId, o]));
    const drifted =
      confirmedOptions.length !== options.length ||
      options.some((o) => {
        const c = byPackage.get(o.packageId);
        return (
          !c ||
          agorot(c.listPrice) !== agorot(o.listPrice) ||
          agorot(c.discountAmount) !== agorot(o.discountAmount) ||
          agorot(c.finalPrice) !== agorot(o.finalPrice)
        );
      });
    if (drifted) throw new Error('תנאי ההצעה השתנו. בדקו ואשרו מחדש.');
  }

  // ONE transaction (create_staff_coupon_assignment, migration 20261013001527): assignment +
  // frozen options + the 'assigned' event + the in-transaction preview validation + the
  // duplicate rule. No TS-side compensation remains — a failure at any step persists nothing.
  const { data, error } = await admin.rpc('create_staff_coupon_assignment', {
    _staff_id: staff.id,
    _user_id: userId,
    _offer_id: offerId,
    _idempotency_key: idempotencyKey,
    _confirmed_options: options.map(({ packageId, listPrice, discountAmount, finalPrice }) => ({
      package_id: packageId,
      list_price: listPrice,
      discount_amount: discountAmount,
      final_price: finalPrice,
    })),
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('terms changed')) throw new Error('תנאי ההצעה השתנו. בדקו ואשרו מחדש.');
    if (msg.includes('key already used')) {
      throw new Error('מפתח הפעולה כבר שימש להקצאה אחרת — יש לפתוח הקצאה חדשה');
    }
    if (msg.includes('account not found')) throw new Error('החשבון לא נמצא');
    if (msg.includes('offer unavailable') || msg.includes('not staff-assignable')) {
      throw new Error('ההצעה אינה זמינה להקצאה');
    }
    throw new Error('הקצאת ההטבה נכשלה');
  }
  const result = data as {
    assignment_id: string;
    kept_assignment_id: string;
    outcome: 'created' | 'existing';
    duplicate_voided: 'none' | 'new' | 'previous';
    expires_at: string;
  };

  if (result.outcome === 'existing') {
    // The idempotent replay answers the STORED promise — never today's computation.
    const { data: stored } = await admin
      .from('coupon_assignment_options')
      .select('package_id, list_price, final_price, packages(name)')
      .eq('assignment_id', result.assignment_id);
    return {
      assignmentId: result.assignment_id,
      keptAssignmentId: result.kept_assignment_id,
      outcome: 'existing',
      duplicateVoided: 'none',
      expiresAt: result.expires_at,
      options: ((stored ?? []) as { package_id: string; list_price: number; final_price: number; packages: { name: string } | null }[]).map(
        (o) => ({
          packageId: o.package_id,
          packageName: o.packages?.name ?? '',
          listPrice: Number(o.list_price),
          finalPrice: Number(o.final_price),
        }),
      ),
    };
  }

  await logActivity({
    action: 'coupon.assigned',
    meta: {
      assignmentId: result.assignment_id,
      offerId: offer.id,
      targetUserId: userId,
      packageIds: options.map((o) => o.packageId),
    },
  });
  if (result.duplicate_voided !== 'none') {
    await logActivity({
      action: 'coupon.voided_duplicate',
      meta: {
        assignmentId: result.duplicate_voided === 'new' ? result.assignment_id : result.kept_assignment_id,
        keptAssignmentId: result.kept_assignment_id,
      },
    });
  }

  return {
    assignmentId: result.assignment_id,
    keptAssignmentId: result.kept_assignment_id,
    outcome: 'created',
    duplicateVoided: result.duplicate_voided,
    expiresAt: result.expires_at,
    options: options.map(({ packageId, packageName, listPrice, finalPrice }) => ({
      packageId,
      packageName,
      listPrice,
      finalPrice,
    })),
  };
}

// ── The staff list (admin-panel change, AD3; spec §6) ───────────────────────

export type AssignmentListFilters = {
  /** Exact email (resolved to the account) or exact phone — never a partial search. */
  q?: string;
  /** A display bucket, or 'guard' for the "דורש בדיקה" entry. */
  status?: 'waiting' | 'bound' | 'consumed' | 'cancelled' | 'expired' | 'guard';
  source?: 'agent' | 'staff';
  offer?: string;
  sort?: 'newest' | 'oldest' | 'expiry';
  page?: number;
};

export type StaffAssignmentListRow = {
  id: string;
  createdAt: string;
  expiresAt: string;
  display: AssignmentDisplayStatus;
  offerTitle: string;
  target: { name: string | null; email: string | null; phoneMasked: string | null; claimed: boolean };
  sourceKind: 'agent' | 'staff';
};

export type StaffAssignmentList = {
  rows: StaffAssignmentListRow[];
  /** Total of the FILTERED set — never the page length. */
  total: number;
  page: number;
  pageSize: number;
  /** D10 over the WHOLE dataset via pricing_round_id; null when the check failed. */
  globalGuardCount: number | null;
  guardCheckStatus: 'ok' | 'failed';
};

const LIST_PAGE_SIZE = 25;

// The caller sees most of a number, never all of it: +9725…123 keeps the prefix and last 3.
function maskPhone(phone: string): string {
  if (phone.length <= 8) return phone;
  return `${phone.slice(0, 5)}…${phone.slice(-3)}`;
}

// Invalid parameters normalize to defaults (spec §6) — a crafted URL can shape nothing here.
type NormalizedFilters = Omit<AssignmentListFilters, 'sort' | 'page'> & {
  sort: NonNullable<AssignmentListFilters['sort']>;
  page: number;
};

function normalizeFilters(filters: AssignmentListFilters): NormalizedFilters {
  const statuses = ['waiting', 'bound', 'consumed', 'cancelled', 'expired', 'guard'] as const;
  const sources = ['agent', 'staff'] as const;
  const sorts = ['newest', 'oldest', 'expiry'] as const;
  const page = Number.isInteger(filters.page) && (filters.page as number) >= 1 ? (filters.page as number) : 1;
  return {
    q: filters.q?.trim() || undefined,
    status: statuses.includes(filters.status as never) ? filters.status : undefined,
    source: sources.includes(filters.source as never) ? filters.source : undefined,
    offer: /^[0-9a-f-]{36}$/i.test(filters.offer ?? '') ? filters.offer : undefined,
    sort: sorts.includes(filters.sort as never) ? (filters.sort as 'newest') : 'newest',
    page,
  };
}

type ListRpcRow = {
  id: string;
  created_at: string;
  expires_at: string;
  state: string;
  end_reason: string | null;
  offer_title: string | null;
  user_id: string | null;
  phone_e164: string | null;
  source_kind: 'agent' | 'staff';
  total_count: number;
};

// The global D10 guard (AD4): succeeded package payments whose pricing round carries a
// non-consumed assignment — attributed ONLY via pricing_round_id, over the whole dataset.
// A failed check is reported as failed, never as "no exceptions".
async function countGlobalGuard(admin: AdminClient): Promise<{ count: number | null; status: 'ok' | 'failed' }> {
  const { count, error } = await admin
    .from('payment_operations')
    .select('id, campaign_pricing!inner(coupon_assignment_id, coupon_assignments!inner(id, state))', {
      count: 'exact',
      head: true,
    })
    .eq('kind', 'package_purchase')
    .eq('outcome', 'succeeded')
    .neq('campaign_pricing.coupon_assignments.state', 'consumed');
  if (error || typeof count !== 'number') return { count: null, status: 'failed' };
  return { count, status: 'ok' };
}

// Every filter, the sort and the pagination run in SQL (admin_list_coupon_assignments,
// migration 20261012234733) — never limit(200) + in-memory. The q term resolves to an
// account (exact email) or an exact normalized phone BEFORE the query; an email that
// matches no account is an honest empty result.
export async function listStaffAssignments(
  rawFilters: AssignmentListFilters = {},
): Promise<StaffAssignmentList> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const filters = normalizeFilters(rawFilters);

  let qUserId: string | null = null;
  let qPhone: string | null = null;
  if (filters.q) {
    const phone = normalizePhone(filters.q);
    if (phone) {
      qPhone = phone;
    } else {
      const account = await findAccountByEmail(filters.q);
      if (!account) {
        const guard = await countGlobalGuard(admin);
        return {
          rows: [], total: 0, page: 1, pageSize: LIST_PAGE_SIZE,
          globalGuardCount: guard.count, guardCheckStatus: guard.status,
        };
      }
      qUserId = account.id;
    }
  }

  const callList = async (page: number) => {
    const { data, error } = await admin.rpc('admin_list_coupon_assignments', {
      _user_id: qUserId,
      _phone: qPhone,
      _status: filters.status ?? null,
      _source: filters.source ?? null,
      _offer_id: filters.offer ?? null,
      _sort: filters.sort,
      _page: page,
      _page_size: LIST_PAGE_SIZE,
    });
    if (error) throw new Error('טעינת ההטבות נכשלה');
    return (data ?? []) as ListRpcRow[];
  };

  let page = filters.page;
  let rows = await callList(page);
  let total = rows[0]?.total_count ?? 0;
  if (rows.length === 0 && page > 1) {
    // Out-of-range page: correct to the last page while keeping the filters (spec §6).
    const probe = await callList(1);
    total = probe[0]?.total_count ?? 0;
    page = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
    rows = page === 1 ? probe : await callList(page);
  }

  // Names batched from profiles; emails only for claimed rows still missing a name —
  // bounded by the page size, never a serial pass over the whole table.
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', userIds);
    for (const p of profiles ?? []) {
      if (typeof p.full_name === 'string' && p.full_name.trim() !== '') nameById.set(p.id, p.full_name);
    }
  }
  const emailById = new Map<string, string | null>();
  await Promise.all(
    userIds
      .filter((id) => !nameById.has(id))
      .map(async (id) => {
        const { data: u } = await admin.auth.admin.getUserById(id);
        emailById.set(id, u?.user?.email ?? null);
      }),
  );

  const out: StaffAssignmentListRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    display: deriveAssignmentDisplayStatus({
      state: r.state,
      expiresAt: r.expires_at,
      endReason: r.end_reason,
    }),
    offerTitle: r.offer_title ?? '',
    target: {
      name: r.user_id ? (nameById.get(r.user_id) ?? null) : null,
      email: r.user_id ? (emailById.get(r.user_id) ?? null) : null,
      phoneMasked: r.phone_e164 ? maskPhone(r.phone_e164) : null,
      claimed: r.user_id !== null,
    },
    sourceKind: r.source_kind,
  }));

  const guard = await countGlobalGuard(admin);
  return {
    rows: out,
    total,
    page,
    pageSize: LIST_PAGE_SIZE,
    globalGuardCount: guard.count,
    guardCheckStatus: guard.status,
  };
}

// An EXACT-email account lookup (AD6): one indexed SQL query (admin_lookup_account_by_email,
// migration 20261013000428) — a user beyond any provider page limit is still found, and a
// lookup FAILURE throws (the callers show a failure, never "not found").
export async function findAccountByEmail(
  email: string,
): Promise<{ id: string; email: string; name: string | null } | null> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const needle = email.trim();
  if (!needle) return null;
  const { data, error } = await admin.rpc('admin_lookup_account_by_email', { _email: needle });
  if (error) throw new Error('חיפוש החשבון נכשל');
  const hit = (data ?? [])[0] as { id: string; email: string; full_name: string | null } | undefined;
  return hit ? { id: hit.id, email: hit.email, name: hit.full_name } : null;
}

// The assign screen's account step (spec §8): found / not_found / unavailable are THREE
// distinct answers — a failed lookup is never presented as a missing account — and a found
// account comes with a short list of its ACTIVE benefits for the staff member to see.
export type RecipientLookup =
  | {
      status: 'found';
      account: { id: string; email: string; name: string | null };
      activeBenefits: { summary: string; expiresAt: string }[];
    }
  | { status: 'not_found' }
  | { status: 'unavailable' };

export async function lookupStaffAssignmentRecipient(email: string): Promise<RecipientLookup> {
  await requirePlatformPermission('manage_billing');
  try {
    const account = await findAccountByEmail(email);
    if (!account) return { status: 'not_found' };

    const admin = createAdminClient();
    let activeBenefits: { summary: string; expiresAt: string }[] = [];
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(account.id);
      const eligible: EligibleBenefit[] = authUser?.user
        ? await listEligibleBenefits(authUser.user)
        : await listEligibleBenefits({ id: account.id, phone: undefined, phone_confirmed_at: undefined });
      activeBenefits = eligible
        .filter((b) => Date.parse(b.expiresAt) > Date.now())
        .map((b) => ({
          summary: (b.options ?? []).map((o) => `${o.finalPrice}₪`).join(', '),
          expiresAt: b.expiresAt,
        }));
    } catch {
      activeBenefits = [];
    }
    return { status: 'found', account, activeBenefits };
  } catch {
    return { status: 'unavailable' };
  }
}

// ── The assign form's offer choices (task 7.3, mockup ui/AssignNew.dc.html) ──
// Precomputed HERE, with the same computeOfferOption createStaffAssignment freezes, so the preview
// the staff member reads is exactly what the customer gets. Shown: active, staff-allowed offers
// with at least one allowed package — and, like the agent path, an offer that floors any package
// at zero or below is not assignable.

export type AssignableOffer = {
  id: string;
  title: string;
  /** "5%" or the formatted amount — the select's label next to the title. */
  valueLabel: string;
  /** The expiry the assignment WOULD get if created now — an ESTIMATE until assignment. */
  expiresLabel: string;
  options: { name: string; listPrice: string; finalPrice: string }[];
  /** The raw terms the form echoes back as the CONFIRMED preview (ג.2/ד.2). */
  rawOptions: ConfirmedOption[];
};

export async function listAssignableOffers(
  format: { currency: (amount: number) => string; date: (value: Date) => string },
): Promise<AssignableOffer[]> {
  await requirePlatformPermission('manage_billing');
  const [offers, choices] = await Promise.all([listOffers(), listOfferPackageChoices()]);
  const byPackage = new Map(choices.map((c) => [c.id, { name: c.name, price: c.price_with_vat }]));
  const nowMs = Date.now();

  const assignable: AssignableOffer[] = [];
  for (const offer of offers) {
    if (!offer.is_active || !offer.allow_staff || offer.packages.length === 0) continue;
    const kind: OfferKind = offer.kind === 'amount' ? 'amount' : 'percent';
    const options: AssignableOffer['options'] = [];
    const rawOptions: ConfirmedOption[] = [];
    let honorable = true;
    for (const allowed of offer.packages) {
      const pkg = byPackage.get(allowed.package_id);
      if (!pkg) {
        honorable = false;
        break;
      }
      const { discountAmount, finalPrice } = computeOfferOption(pkg.price, kind, Number(allowed.value_override ?? offer.value));
      if (finalPrice <= 0) {
        honorable = false;
        break;
      }
      options.push({
        name: pkg.name,
        listPrice: format.currency(pkg.price),
        finalPrice: format.currency(finalPrice),
      });
      rawOptions.push({
        packageId: allowed.package_id,
        listPrice: pkg.price,
        discountAmount,
        finalPrice,
      });
    }
    if (!honorable || options.length === 0) continue;

    assignable.push({
      id: offer.id,
      title: offer.title,
      valueLabel: kind === 'percent' ? `${Number(offer.value)}%` : format.currency(Number(offer.value)),
      expiresLabel: format.date(new Date(nowMs + offer.validity_days * 24 * 60 * 60 * 1000)),
      options,
      rawOptions,
    });
  }
  return assignable;
}

// ── The assignment detail (admin-panel change, AD5; spec §7) ─────────────────
// One reader for /admin/assignments/[id]: every section the screen shows, allowedActions
// as DISPLAY-ONLY advice (the void re-decides under locks), and SECTION-LEVEL failure
// markers — a failed side read never takes down the main record. Payments are attributed
// through THIS assignment's pricing rounds (pricing_round_id), never by campaign ranking.

const EVENT_ACTION_LABELS: Record<string, string> = {
  assigned: 'הוקצתה',
  bound: 'שויכה לאירוע',
  moved: 'הועברה לחבילה אחרת',
  released: 'שוחררה מהאירוע',
  unbound_no_option: 'שוחררה — לחבילה אין אפשרות בהטבה',
  voided: 'בוטלה',
  consumed: 'מומשה',
  supersede_opened: 'נפתח עדכון תנאים',
};

type Unavailable = 'unavailable';

export type StaffAssignmentDetail = {
  assignment: {
    id: string;
    createdAt: string;
    expiresAt: string;
    state: string;
    display: AssignmentDisplayStatus;
    /** The SAVED terms — never the offer's current values. */
    kind: 'percent' | 'amount';
    value: number;
    offerId: string | null;
    /** The offer's CURRENT title — a description, not a frozen snapshot (spec §7). */
    offerTitle: string | null;
  };
  recipient:
    | {
        userId: string | null;
        name: string | null;
        email: string | null;
        phoneMasked: string | null;
        claimed: boolean;
        claimedAt: string | null;
      }
    | Unavailable;
  source:
    | { kind: 'agent'; callAttemptId: string; callbackRequestId: string | null; objectionReason: string | null }
    | { kind: 'staff'; assignedById: string; assignedByName: string | null }
    | { kind: 'unknown' };
  frozenOptions:
    | { packageId: string; packageName: string; listPrice: number; discountAmount: number; finalPrice: number }[]
    | Unavailable;
  currentBinding:
    | {
        campaignId: string;
        eventId: string | null;
        eventName: string | null;
        packageId: string | null;
        packageName: string | null;
        roundPrice: number | null;
        locked: boolean;
      }
    | null
    | Unavailable;
  paymentAttempts:
    | { id: string; roundVersion: number | null; amount: number; at: string; outcome: string }[]
    | Unavailable;
  history:
    | { at: string; actionLabel: string; known: boolean; rawAction: string; actorLabel: string; reason: string | null }[]
    | Unavailable;
  allowedActions: {
    canVoid: boolean;
    blockReason:
      | 'held_by_payment'
      | 'held_by_review'
      | 'held_by_approved_terms'
      | 'already_ended'
      | 'consumption_exception'
      | null;
  };
  warnings: string[];
};

export async function getStaffAssignmentDetail(id: string): Promise<StaffAssignmentDetail | null> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('coupon_assignments')
    .select(
      'id, created_at, expires_at, state, kind, value, user_id, phone_e164, claimed_at, sales_call_attempt_id, assigned_by, bound_campaign_id, offer_id, offers(title), coupon_assignment_options(package_id, list_price, discount_amount, final_price, packages(name))',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('טעינת ההטבה נכשלה');
  if (!data) return null;
  type BaseRow = {
    id: string; created_at: string; expires_at: string; state: string; kind: string; value: number;
    user_id: string | null; phone_e164: string | null; claimed_at: string | null;
    sales_call_attempt_id: string | null; assigned_by: string | null; bound_campaign_id: string | null;
    offer_id: string | null; offers: { title: string } | null;
    coupon_assignment_options:
      | { package_id: string; list_price: number; discount_amount: number; final_price: number; packages: { name: string } | null }[]
      | null;
  };
  const row = data as unknown as BaseRow;
  const warnings: string[] = [];

  // History first — the display status needs the recorded end reason.
  let history: StaffAssignmentDetail['history'];
  let endReason: string | null = null;
  const actorIds = new Set<string>();
  const { data: events, error: evError } = await admin
    .from('coupon_assignment_events')
    .select('at, action, actor_user_id, reason')
    .eq('assignment_id', id)
    .order('at', { ascending: true })
    .order('id', { ascending: true });
  if (evError) {
    history = 'unavailable';
  } else {
    const rows = (events ?? []) as { at: string; action: string; actor_user_id: string | null; reason: string | null }[];
    for (const e of rows) if (e.actor_user_id) actorIds.add(e.actor_user_id);
    const lastVoid = [...rows].reverse().find((e) => e.action === 'voided');
    endReason = lastVoid?.reason ?? null;
    const actorNames = new Map<string, string>();
    if (actorIds.size > 0) {
      const { data: profs } = await admin.from('profiles').select('id, full_name').in('id', [...actorIds]);
      for (const p of profs ?? []) if (p.full_name) actorNames.set(p.id, p.full_name);
    }
    history = rows.map((e) => ({
      at: e.at,
      rawAction: e.action,
      known: e.action in EVENT_ACTION_LABELS,
      actionLabel: EVENT_ACTION_LABELS[e.action] ?? 'פעולה נוספת',
      // A missing actor is NEVER attributed to the agent — it is a system write (spec §7).
      actorLabel: e.actor_user_id ? (actorNames.get(e.actor_user_id) ?? 'איש צוות') : 'מערכת',
      reason: e.reason,
    }));
  }

  const display = deriveAssignmentDisplayStatus({ state: row.state, expiresAt: row.expires_at, endReason });

  // Recipient — account fields fail soft: "פרטי החשבון אינם זמינים", never "טרם נרשם".
  let recipient: StaffAssignmentDetail['recipient'];
  try {
    let name: string | null = null;
    let email: string | null = null;
    if (row.user_id) {
      const { data: prof } = await admin.from('profiles').select('full_name').eq('id', row.user_id).maybeSingle();
      name = prof?.full_name ?? null;
      const { data: u, error: uErr } = await admin.auth.admin.getUserById(row.user_id);
      if (uErr) throw uErr;
      email = u?.user?.email ?? null;
    }
    recipient = {
      userId: row.user_id,
      name,
      email,
      phoneMasked: row.phone_e164 ? maskPhone(row.phone_e164) : null,
      claimed: row.user_id !== null,
      claimedAt: row.claimed_at,
    };
  } catch {
    recipient = 'unavailable';
  }

  // Source — the agent's objection reason only when the history recorded it (spec §7).
  let source: StaffAssignmentDetail['source'] = { kind: 'unknown' };
  if (row.sales_call_attempt_id) {
    let callbackRequestId: string | null = null;
    try {
      const { data: attempt } = await admin
        .from('sales_call_attempts')
        .select('callback_request_id')
        .eq('id', row.sales_call_attempt_id)
        .maybeSingle();
      callbackRequestId = attempt?.callback_request_id ?? null;
    } catch {
      callbackRequestId = null;
    }
    const assignedEvent = history !== 'unavailable' ? history.find((e) => e.rawAction === 'assigned') : undefined;
    source = {
      kind: 'agent',
      callAttemptId: row.sales_call_attempt_id,
      callbackRequestId,
      objectionReason: assignedEvent?.reason ?? null,
    };
  } else if (row.assigned_by) {
    let assignedByName: string | null = null;
    try {
      const { data: prof } = await admin.from('profiles').select('full_name').eq('id', row.assigned_by).maybeSingle();
      assignedByName = prof?.full_name ?? null;
    } catch {
      assignedByName = null;
    }
    source = { kind: 'staff', assignedById: row.assigned_by, assignedByName };
  }

  // Frozen options — from coupon_assignment_options ONLY; empty is a data-quality warning,
  // never zero prices or catalogue prices as a substitute (spec §7).
  const frozenOptions = (row.coupon_assignment_options ?? []).map((o) => ({
    packageId: o.package_id,
    packageName: o.packages?.name ?? '',
    listPrice: Number(o.list_price),
    discountAmount: Number(o.discount_amount),
    finalPrice: Number(o.final_price),
  }));
  if (frozenOptions.length === 0) {
    warnings.push('להטבה אין אפשרויות מחיר שמורות — תקלת נתונים הדורשת בדיקה.');
  }

  // The assignment's OWN pricing rounds → its payment attempts (pricing_round_id attribution).
  let paymentAttempts: StaffAssignmentDetail['paymentAttempts'];
  let exceptionHere = false;
  let roundsById = new Map<string, number | null>();
  try {
    const { data: rounds, error: rErr } = await admin
      .from('campaign_pricing')
      .select('id, version')
      .eq('coupon_assignment_id', id);
    if (rErr) throw rErr;
    roundsById = new Map((rounds ?? []).map((r) => [r.id as string, (r.version as number) ?? null]));
    if (roundsById.size === 0) {
      paymentAttempts = [];
    } else {
      const { data: pays, error: pErr } = await admin
        .from('payment_operations')
        .select('id, amount, outcome, occurred_at, pricing_round_id')
        .in('pricing_round_id', [...roundsById.keys()])
        .eq('kind', 'package_purchase')
        .order('occurred_at', { ascending: true });
      if (pErr) throw pErr;
      const rows2 = (pays ?? []) as { id: string; amount: number; outcome: string; occurred_at: string; pricing_round_id: string | null }[];
      paymentAttempts = rows2.map((p) => ({
        id: p.id,
        roundVersion: p.pricing_round_id ? (roundsById.get(p.pricing_round_id) ?? null) : null,
        amount: Number(p.amount),
        at: p.occurred_at,
        outcome: p.outcome,
      }));
      exceptionHere = rows2.some((p) => p.outcome === 'succeeded') && row.state !== 'consumed';
      if (exceptionHere) {
        warnings.push('תשלום שהצליח משויך להטבה הזאת אך היא לא סומנה כמומשה — דורש בדיקה.');
      }
    }
  } catch {
    paymentAttempts = 'unavailable';
  }

  // The current binding — the chosen package is matched by package_id, never by name.
  let currentBinding: StaffAssignmentDetail['currentBinding'] = null;
  let heldBy: 'payment' | 'review' | 'approved_terms' | null = null;
  if (row.bound_campaign_id) {
    try {
      const { data: campaign, error: cErr } = await admin
        .from('campaigns')
        .select('id, template_id, events(id, name), packages(name)')
        .eq('id', row.bound_campaign_id)
        .maybeSingle();
      if (cErr) throw cErr;
      const c = campaign as unknown as {
        id: string; template_id: string | null;
        events: { id: string; name: string } | null; packages: { name: string } | null;
      } | null;
      const { data: round, error: roundErr } = await admin
        .from('campaign_pricing')
        .select('package_price, locked_at')
        .eq('campaign_id', row.bound_campaign_id)
        .is('superseded_at', null)
        .maybeSingle();
      if (roundErr) throw roundErr;
      currentBinding = {
        campaignId: row.bound_campaign_id,
        eventId: c?.events?.id ?? null,
        eventName: c?.events?.name ?? null,
        packageId: c?.template_id ?? null,
        packageName: c?.packages?.name ?? null,
        roundPrice: round?.package_price != null ? Number(round.package_price) : null,
        locked: round?.locked_at != null,
      };
      if (round?.locked_at != null) heldBy = 'approved_terms';

      // An OPEN campaign payment can block actions even when it is not this assignment's
      // payment (spec §7) — campaign-level only for the HOLD, never for the exception.
      const { data: open, error: oErr } = await admin
        .from('payment_operations')
        .select('outcome')
        .eq('campaign_id', row.bound_campaign_id)
        .eq('kind', 'package_purchase')
        .in('outcome', ['pending', 'review'])
        .limit(1)
        .maybeSingle();
      if (oErr) throw oErr;
      if (open?.outcome === 'pending') heldBy = 'payment';
      else if (open?.outcome === 'review') heldBy = 'review';
      if (open && display.key === 'expired') {
        warnings.push('תוקף ההטבה פג. התשלום הפתוח כפוף לתנאים שנשמרו בעת פתיחתו.');
      }
    } catch {
      currentBinding = 'unavailable';
    }
  }

  const ended = row.state === 'consumed' || row.state === 'void';
  const allowedActions: StaffAssignmentDetail['allowedActions'] = ended
    ? { canVoid: false, blockReason: 'already_ended' }
    : exceptionHere
      ? { canVoid: false, blockReason: 'consumption_exception' }
      : heldBy === 'payment'
        ? { canVoid: false, blockReason: 'held_by_payment' }
        : heldBy === 'review'
          ? { canVoid: false, blockReason: 'held_by_review' }
          : heldBy === 'approved_terms'
            ? { canVoid: false, blockReason: 'held_by_approved_terms' }
            : { canVoid: true, blockReason: null };

  return {
    assignment: {
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      state: row.state,
      display,
      kind: row.kind === 'amount' ? 'amount' : 'percent',
      value: Number(row.value),
      offerId: row.offer_id,
      offerTitle: row.offers?.title ?? null,
    },
    recipient,
    source,
    frozenOptions,
    currentBinding,
    paymentAttempts,
    history,
    allowedActions,
    warnings,
  };
}
