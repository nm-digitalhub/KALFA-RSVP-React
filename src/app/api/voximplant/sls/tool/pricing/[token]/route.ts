import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';

// POST /api/voximplant/sls/tool/pricing/{token}
//
// The sales-closing agent's `get_pricing` tool (script draft §3) — read-only,
// no parameters. Same canonical-package selection as getPublicBusinessFacts
// (active, priced, lowest sort_order) but reads `price_with_vat` directly
// from the row instead of computing it: KALFA's owner is an עוסק פטור
// (VAT-exempt dealer — buildBusinessFacts's own summary text states
// "המחיר סופי, ללא מע״מ"), so a naive *1.18 calculation would assert a VAT
// charge that does not legally apply. Whatever `packages.price_with_vat`
// actually holds is read verbatim, never derived.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

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

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('packages')
    .select('name, base_price, included_reached, price_per_reached, price_with_vat')
    .eq('active', true)
    .not('price_per_reached', 'is', null)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { available: false },
      { status: 200, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      available: true,
      package_name: data.name,
      base_price: data.base_price ?? 0,
      included_reached: data.included_reached ?? 0,
      price_per_reached: data.price_per_reached ?? 0,
      price_with_vat: data.price_with_vat,
    },
    { status: 200, headers: NO_STORE },
  );
}
