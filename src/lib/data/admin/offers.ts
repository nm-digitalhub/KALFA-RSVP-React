import 'server-only';

import { notFound } from 'next/navigation';

import { logActivity } from '@/lib/data/activity';
import { computeOfferOption } from '@/lib/offers/pricing';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import type { Tables } from '@/lib/supabase/types';
import type { OfferInput } from '@/lib/validation/admin';

// Admin: offers CRUD (personal-coupons D14/D23) — the staff-managed source of every benefit,
// managed under `manage_billing` like the packages. `offers`/`offer_packages` carry NO grants to
// anon or authenticated (the migration's access rule), so every read and write here goes through
// the service-role client STRICTLY AFTER the requirePlatformPermission gate — the same order the
// packages module uses for message_templates.
//
// Assignments FREEZE the offer's terms (D3): editing or deleting an offer must never touch
// `coupon_assignments` / `coupon_assignment_options`, and nothing in this module does — an
// assignment keeps the kind, value and prices it was created with, whatever the offer becomes.

type OfferRow = Tables<'offers'>;

export type AdminOfferPackage = {
  package_id: string;
  value_override: number | null;
};

export type AdminOffer = Pick<
  OfferRow,
  | 'id'
  | 'title'
  | 'kind'
  | 'value'
  | 'validity_days'
  | 'allow_agent'
  | 'allow_staff'
  | 'agent_objections'
  | 'may_replace'
  | 'is_active'
  | 'created_at'
> & { packages: AdminOfferPackage[] };

export const OFFER_COLUMNS =
  'id, title, kind, value, validity_days, allow_agent, allow_staff, agent_objections, may_replace, is_active, created_at, offer_packages(package_id, value_override)';

/** The package choices the offer form shows: the whole (small) catalogue with price and state. */
export type OfferPackageChoice = {
  id: string;
  name: string;
  price_with_vat: number;
  active: boolean;
};

// The payment builder refuses a non-positive product line, so the offers screen refuses an offer
// that floors any allowed package's final price at zero or below (D14). Thrown by create/update —
// the single enforcement point — and mapped to a field error by the actions.
export class OfferFloorError extends Error {
  readonly packageName: string;
  constructor(packageName: string, finalPrice: number) {
    super(
      `ההצעה מביאה את החבילה "${packageName}" למחיר ${finalPrice <= 0 ? 'אפס או שלילי' : 'לא תקין'} — כל חבילה בהצעה חייבת להישאר במחיר חיובי`,
    );
    this.name = 'OfferFloorError';
    this.packageName = packageName;
  }
}

type OfferJoinedRow = Omit<AdminOffer, 'packages'> & {
  offer_packages: AdminOfferPackage[] | null;
};

function toAdminOffer(row: OfferJoinedRow): AdminOffer {
  const { offer_packages, ...offer } = row;
  return { ...offer, packages: offer_packages ?? [] };
}

// List all offers (active and inactive) for the admin list, newest first. Not paginated: like the
// packages catalogue, staff manage the full (small) set at once.
export async function listOffers(): Promise<AdminOffer[]> {
  await requirePlatformPermission('manage_billing');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('offers')
    .select(OFFER_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error('טעינת ההצעות נכשלה');
  }

  return ((data ?? []) as OfferJoinedRow[]).map(toAdminOffer);
}

// Fetch one offer by id; notFound() (404) if it does not exist.
export async function getOffer(id: string): Promise<AdminOffer> {
  await requirePlatformPermission('manage_billing');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('offers')
    .select(OFFER_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error('טעינת ההצעה נכשלה');
  }
  if (!data) {
    notFound();
  }
  return toAdminOffer(data as OfferJoinedRow);
}

// The whole package catalogue for the form, in catalogue order. The form shows the active ones and
// any inactive one the offer already allows (never hiding stored state), with its price so the
// final-price preview is computed from real numbers.
export async function listOfferPackageChoices(): Promise<OfferPackageChoice[]> {
  await requirePlatformPermission('manage_billing');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('packages')
    .select('id, name, price_with_vat, active')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new Error('טעינת החבילות נכשלה');
  }
  return data ?? [];
}

// D14's refusal, computed exactly as the assign path will freeze it (the shared
// computeOfferOption): every allowed package's final price must stay positive. Also validates that
// every submitted package id exists — a vanished id is refused, not silently dropped.
async function assertPositiveFloors(input: OfferInput): Promise<void> {
  const admin = createAdminClient();
  const ids = input.packages.map((p) => p.package_id);
  const { data, error } = await admin
    .from('packages')
    .select('id, name, price_with_vat')
    .in('id', ids);

  if (error) {
    throw new Error('בדיקת מחירי החבילות נכשלה');
  }
  const byId = new Map((data ?? []).map((p) => [p.id, p]));
  for (const allowed of input.packages) {
    const pkg = byId.get(allowed.package_id);
    if (!pkg) {
      throw new Error('אחת החבילות שנבחרו אינה קיימת עוד');
    }
    const { finalPrice } = computeOfferOption(
      pkg.price_with_vat,
      input.kind,
      allowed.value_override ?? input.value,
    );
    if (finalPrice <= 0) {
      throw new OfferFloorError(pkg.name, finalPrice);
    }
  }
}

function toOfferWritable(input: OfferInput): {
  title: string;
  kind: string;
  value: number;
  validity_days: number;
  allow_agent: boolean;
  allow_staff: boolean;
  agent_objections: string[];
  may_replace: boolean;
  is_active: boolean;
} {
  return {
    title: input.title,
    kind: input.kind,
    value: input.value,
    validity_days: input.validity_days,
    allow_agent: input.allow_agent,
    allow_staff: input.allow_staff,
    agent_objections: input.agent_objections,
    may_replace: input.may_replace,
    is_active: input.is_active,
  };
}

function offerChangedFields(previous: AdminOffer, next: OfferInput): string[] {
  return [
    previous.title !== next.title ? 'title' : null,
    previous.kind !== next.kind ? 'kind' : null,
    Number(previous.value) !== next.value ? 'value' : null,
    previous.validity_days !== next.validity_days ? 'validity_days' : null,
    previous.allow_agent !== next.allow_agent ? 'allow_agent' : null,
    previous.allow_staff !== next.allow_staff ? 'allow_staff' : null,
    JSON.stringify(previous.agent_objections) !== JSON.stringify(next.agent_objections)
      ? 'agent_objections'
      : null,
    previous.may_replace !== next.may_replace ? 'may_replace' : null,
    previous.is_active !== next.is_active ? 'is_active' : null,
    JSON.stringify(previous.packages.map((p) => [p.package_id, Number(p.value_override ?? 0)]).sort()) !==
    JSON.stringify(next.packages.map((p) => [p.package_id, Number(p.value_override ?? 0)]).sort())
      ? 'packages'
      : null,
  ].filter((value): value is string => value !== null);
}

// Create an offer with its allowed packages. Two statements (offers, then offer_packages) — on a
// package-insert failure the fresh offer row is removed so a half-created offer is never left
// behind.
export async function createOffer(input: OfferInput): Promise<{ id: string }> {
  const user = await requirePlatformPermission('manage_billing');
  await assertPositiveFloors(input);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('offers')
    .insert({ ...toOfferWritable(input), created_by: user.id })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error('יצירת ההצעה נכשלה');
  }

  const { error: packagesError } = await admin.from('offer_packages').insert(
    input.packages.map((p) => ({
      offer_id: data.id,
      package_id: p.package_id,
      value_override: p.value_override,
    })),
  );
  if (packagesError) {
    await admin.from('offers').delete().eq('id', data.id);
    throw new Error('יצירת ההצעה נכשלה');
  }

  await logActivity({
    action: 'offer.created',
    meta: {
      offerId: data.id,
      offerTitle: input.title,
      kind: input.kind,
      value: input.value,
      packageCount: input.packages.length,
    },
  });

  return { id: data.id };
}

// Update an offer and replace its allowed-packages set. Existing assignments are untouched by
// design (D3's freeze) — only `offers` and `offer_packages` are written.
export async function updateOffer(id: string, input: OfferInput): Promise<void> {
  await requirePlatformPermission('manage_billing');
  await assertPositiveFloors(input);

  const previous = await getOffer(id);

  const admin = createAdminClient();
  const { error } = await admin.from('offers').update(toOfferWritable(input)).eq('id', id);
  if (error) {
    throw new Error('עדכון ההצעה נכשל');
  }

  // Replace the allowed set: delete-then-insert. offer_packages has no dependents (assignments
  // freeze their own options), so the replacement can never orphan anything.
  const { error: clearError } = await admin.from('offer_packages').delete().eq('offer_id', id);
  if (clearError) {
    throw new Error('עדכון ההצעה נכשל');
  }
  const { error: packagesError } = await admin.from('offer_packages').insert(
    input.packages.map((p) => ({
      offer_id: id,
      package_id: p.package_id,
      value_override: p.value_override,
    })),
  );
  if (packagesError) {
    throw new Error('עדכון ההצעה נכשל');
  }

  await logActivity({
    action: 'offer.updated',
    meta: {
      offerId: id,
      offerTitle: input.title,
      changedFields: offerChangedFields(previous, input),
    },
  });
}

// Delete an offer. An offer that ever produced an assignment is protected by the RESTRICT FK —
// the admin is told to deactivate instead.
export async function deleteOffer(id: string): Promise<void> {
  await requirePlatformPermission('manage_billing');

  const previous = await getOffer(id);

  const admin = createAdminClient();
  const { error } = await admin.from('offers').delete().eq('id', id);
  if (error) {
    // 23503 = foreign_key_violation — coupon_assignments reference this offer (RESTRICT).
    if (error.code === '23503') {
      throw new Error('לא ניתן למחוק הצעה שכבר הוקצו ממנה הטבות. אפשר לסמן אותה כלא פעילה.');
    }
    throw new Error('מחיקת ההצעה נכשלה');
  }

  await logActivity({
    action: 'offer.deleted',
    meta: {
      offerId: id,
      offerTitle: previous.title,
      kind: previous.kind,
      value: Number(previous.value),
    },
  });
}
