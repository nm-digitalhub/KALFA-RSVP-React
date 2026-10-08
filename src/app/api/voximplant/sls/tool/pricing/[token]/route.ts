import { NextResponse } from 'next/server';

import { listPackageOffers } from '@/lib/data/campaigns';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';

// POST /api/voximplant/sls/tool/pricing/{token}
//
// The sales-closing agent's `get_pricing` tool (script draft §3) — read-only,
// no parameters.
//
// Returns the fixed-price package catalogue: every package the customer can
// actually buy, each with its one-time price and its contact quota. The list is
// listPackageOffers() — the SAME definition the purchase flow sells from (an
// active package that carries a quota and a price, empty while the package
// switch is off, and a package that also carries a per-reached rate is not an
// offer) — so the agent can never quote a package the customer cannot buy. A
// package is recognised by its fixed price and quota, never by a per-reached
// rate.
//
// `price` is packages.price_with_vat read as-is: KALFA's owner is an עוסק פטור,
// the price is final and no VAT is added, so it is never derived from another
// number. `contact_quota` is the number of contacts the campaign may approach,
// whether or not they answer (agreement v6 §3).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

const unavailable = () =>
  NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardSalesToolRequest(req, token, {
    scope: 'vox-sls-pricing',
    maxBodyBytes: MAX_BODY_BYTES,
  });
  if (!guard.ok) return bad(guard.status);

  let offers: Awaited<ReturnType<typeof listPackageOffers>>;
  try {
    offers = await listPackageOffers();
  } catch {
    // The agent must hear "no price available" rather than an HTTP error in the
    // middle of a sentence, and never a guessed number. The message is logged
    // without the error object (it can carry database detail).
    console.error('[sls-pricing] package catalogue read failed');
    return unavailable();
  }
  if (offers.length === 0) return unavailable();

  return NextResponse.json(
    {
      available: true,
      packages: offers.map((offer) => ({
        package_name: offer.name,
        price: offer.price,
        contact_quota: offer.contact_quota,
        channels: offer.channels,
        includes: offer.includes,
      })),
    },
    { status: 200, headers: NO_STORE },
  );
}
