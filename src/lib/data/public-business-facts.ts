import 'server-only';

import { buildBusinessFacts, type BusinessFacts } from '@/lib/fleet/business-facts';
import { listPackageOffers } from './package-offers';

// The ONE reader of the business facts: the /faq page's price card and its {{token}}s (src/lib/faq/tokens.ts), the
// event-type pages' cadence line, /admin/faq's preview, and the support-drafter (scripts/fleet-agent-cli.ts
// `business-facts` and `faq`). One read, so the site and a draft can never quote two different catalogues.
//
// The packages are listPackageOffers() — the SAME definition the purchase flow sells from (active, with a price and a
// quota, empty while the package switch is off) — so nothing is quoted that a customer cannot buy, and nothing is
// typed into code: every figure is a column of `packages`.
//
// Fail-safe: an error (including a missing/placeholder service-role key) resolves to `{ available: false }` rather
// than throwing — a public marketing page must never 500 because the catalogue is momentarily unreadable.
export async function getPublicBusinessFacts(): Promise<BusinessFacts> {
  try {
    const offers = await listPackageOffers();
    return buildBusinessFacts(
      offers.map((offer) => ({
        name: offer.name,
        price: offer.price,
        contact_quota: offer.contact_quota,
        channels: offer.channels,
        description: offer.description,
        includes: offer.includes,
        // `outreach_schedule` is a Json column holding touchpoint objects by contract (locked to what admin/packages.ts
        // writes). Keep only the two fields the facts expose, so a malformed row yields an empty cadence rather than
        // leaking shape.
        outreach_schedule: Array.isArray(offer.outreach_schedule)
          ? offer.outreach_schedule.map((tp) => ({ days_before: tp.days_before, channel: tp.channel }))
          : [],
      })),
    );
  } catch {
    return { available: false, reason: 'business facts read failed' };
  }
}
