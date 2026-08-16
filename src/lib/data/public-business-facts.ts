import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { buildBusinessFacts, type BusinessFacts, type PackageFacts } from '@/lib/fleet/business-facts';
import { getBaseOveragePricingEnabled } from './payments';

// PUBLIC-SAFE reader of the business facts the /faq page's price card (and
// the {base_price}/{included_reached}/{overage}/{channels_list} FAQ tokens,
// src/lib/faq/tokens.ts) quote. Mirrors cmdBusinessFacts() in
// scripts/fleet-agent-cli.ts:1398-1423 exactly (same package query, same
// gate read, same buildBusinessFacts() call) — this is the first APP reader
// of that logic; the CLI stays the fleet-facing one.
//
// Uses the SERVICE-ROLE client deliberately, for BOTH reads: `packages` does
// have a public RLS policy (packages_public_read, verified live), but
// `app_settings` (which holds the base_overage_pricing_enabled gate) does
// not — it is has_role('admin') only, same as every other app_settings
// reader (see payments.ts). One client for both keeps this in lockstep with
// the CLI's logic instead of splitting into a public client for one query
// and a service-role client for the other.
//
// Fail-safe like every payments.ts reader: an error (including a missing/
// placeholder service-role key) resolves to `{ available: false }` rather
// than throwing — a public marketing page must never 500 because pricing
// config is momentarily unreadable.
export async function getPublicBusinessFacts(): Promise<BusinessFacts> {
  try {
    const admin = createAdminClient();
    const gateOn = await getBaseOveragePricingEnabled();
    // The canonical campaign package — same selection as cmdBusinessFacts()
    // and resolveCanonicalTemplate (active, priced, lowest sort_order first).
    const { data, error } = await admin
      .from('packages')
      .select('name, price_per_reached, base_price, included_reached, channels')
      .eq('active', true)
      .not('price_per_reached', 'is', null)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const pkg: PackageFacts | null = data
      ? {
          name: data.name,
          price_per_reached: Number(data.price_per_reached ?? 0),
          base_price: Number(data.base_price ?? 0),
          included_reached: Number(data.included_reached ?? 0),
          channels: (data.channels ?? []) as string[],
        }
      : null;

    return buildBusinessFacts(gateOn, pkg);
  } catch {
    return { available: false, reason: 'business facts read failed' };
  }
}
