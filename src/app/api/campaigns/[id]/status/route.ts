import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { activateCampaign, pauseCampaign } from '@/lib/data/campaigns';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/campaigns/{id}/status   body: { action: 'activate' | 'pause' }
//
// Console (Bearer/staff) campaign lifecycle control. This route is a THIN wrapper:
// it authorizes the caller (requireConsoleAgent + manage_voice) and then calls the
// SAME canonical transitions the web uses — activateCampaign / pauseCampaign — via
// their 'console' authz mode. That keeps the console path byte-identical to the web:
// the guarded status transition, the J5-hold requirement (capture_status must be
// 'authorized' to activate), the past/active-event gating, the auto-thankyou default
// seeding, and the ops alert all run through the one canonical implementation — no
// duplicated (and drift-prone) transition logic here.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const uuidSchema = z.string().uuid();
const bodySchema = z.strictObject({ action: z.enum(['activate', 'pause']) });

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!(await callerHasPlatformPermission(auth.ctx.supabase, 'manage_voice'))) {
    return json({ error: 'אין הרשאה' }, 403);
  }

  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return json({ error: 'מזהה קמפיין לא תקין' }, 400);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  const { action } = parsed.data;

  // Existence pre-check with the service-role client, so the canonical transition
  // never reaches notFound() — which renders a 404 PAGE (not JSON) in a Route
  // Handler. Returns a clean JSON 404 instead.
  const admin = createAdminClient();
  const { data: campaign, error: cErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (cErr) return json({ error: 'טעינת הקמפיין נכשלה' }, 500);
  if (!campaign) return json({ error: 'הקמפיין לא נמצא' }, 404);

  try {
    if (action === 'pause') await pauseCampaign(id, 'console');
    else await activateCampaign(id, 'console');
  } catch (e) {
    // The canonical transition throws safe, user-facing Hebrew messages for
    // business-rule failures (wrong current status, missing J5 hold, past or
    // inactive event). Surface the message; the client shows it verbatim.
    const message = e instanceof Error ? e.message : 'שינוי מצב הקמפיין נכשל';
    return json({ error: message }, 409);
  }

  return json({ ok: true, status: action === 'pause' ? 'paused' : 'active' }, 200);
}
