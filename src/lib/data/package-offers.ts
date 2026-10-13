import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPackageModelEnabled } from '@/lib/data/payments';
import type { Enums } from '@/lib/supabase/types';

// The fixed-price package catalogue, read with the service role and nothing request-scoped. It lives apart from
// campaigns.ts (which re-exports it, so every existing import keeps working) because campaigns.ts pulls in the auth
// layer, which cannot be loaded by the worker or the CLI scripts (dependency-cruiser rule
// worker-no-request-scoped-next) — and the public business facts, which both of those read, only need the packages.

type Channel = Enums<'campaign_channel'>;

// A single touchpoint in the event-anchored outreach schedule (§10) — a friendly
// drip leading up to the event to maximize reached contacts.
export type OutreachTouchpoint = {
  days_before: number; // days before the event date
  channel: Channel;
  message_key: string; // references an approved WhatsApp template / call script
};

// The fixed-price package catalogue (docs/superpowers/plans/2026-10-04-package-payment-plan.md, P-F): active packages
// that carry a contact quota (the packages action refuses a per-reached price, so no package carries one).
//
// The whole catalogue is behind the package switch: while it is off this is empty without a read, so nothing can be
// offered, and createCampaign below cannot snapshot one. Fail-closed like every money switch.
export type PackageOffer = {
  id: string;
  name: string;
  // The package's own price (packages.price_with_vat — the final consumer price; the business is VAT-exempt).
  price: number;
  contact_quota: number;
  description: string | null;
  // What the package includes, one line each (packages.includes — a JSON array of strings).
  includes: string[];
  channels: Channel[];
  outreach_schedule: OutreachTouchpoint[];
};

export async function listPackageOffers(): Promise<PackageOffer[]> {
  if (!(await getPackageModelEnabled())) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('packages')
    .select('id, name, price_with_vat, contact_quota, description, includes, channels, outreach_schedule')
    .eq('active', true)
    .not('contact_quota', 'is', null)
    .order('sort_order', { ascending: true });
  if (error) throw new Error('טעינת החבילות נכשלה');
  return (data ?? [])
    .filter(
      (p) =>
        p.contact_quota != null &&
        p.contact_quota >= 1 &&
        Number(p.price_with_vat) > 0 &&
        (p.channels ?? []).length > 0,
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price_with_vat),
      contact_quota: p.contact_quota as number,
      description: p.description,
      includes: Array.isArray(p.includes)
        ? p.includes.filter((x): x is string => typeof x === 'string')
        : [],
      channels: p.channels ?? [],
      outreach_schedule: (p.outreach_schedule as OutreachTouchpoint[] | null) ?? [],
    }));
}

// One offer by id; null when it is not an offer (the switch is off, inactive, legacy, not sellable).
export async function getPackageOffer(packageId: string): Promise<PackageOffer | null> {
  return (await listPackageOffers()).find((o) => o.id === packageId) ?? null;
}
