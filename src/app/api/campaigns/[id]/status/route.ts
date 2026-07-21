import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { activateCampaign, pauseCampaign } from '@/lib/data/campaigns';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/campaigns/{id}/status   body: { action: 'activate' | 'pause' }
//
// Console (Bearer/staff) control over a campaign's RUN STATE. Two transitions,
// and only two:
//
//   pause    : active → paused    a safety stop
//   activate : paused → active    REVIVAL of a campaign the owner already ran
//
// It does NOT re-implement the lifecycle. It resolves the actor, then calls the
// same pauseCampaign / activateCampaign the web Server Actions call, passing a
// `console` actor. Every guard those carry — the J5 hold, the past-event refusal,
// the active-event requirement, the Slack ops alert, the auto-thankyou seed —
// therefore applies here by construction rather than by remembering to copy it.
// An earlier draft of this route did copy the logic, and silently lost the
// past-event guard in the process; see campaigns.ts for why the guards are no
// longer welded to the cookie ownership check.
//
// Authority is `campaigns.runstate`, NOT `manage_voice`: pausing a campaign also
// stops its WhatsApp sends, so granting it under a key documented as
// "ניהול מוקד שיחות AI" would misdescribe what the catalogue hands out. See
// migration 20260721183855.
//
// FIRST activation (approved/scheduled → active) is deliberately unreachable
// here — that is the owner's commercial commitment and stays an owner action on
// the web. activateCampaign narrows the from-set for a console actor, so this
// route cannot widen it even if it tried.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const uuidSchema = z.uuid();
const bodySchema = z.strictObject({ action: z.enum(['activate', 'pause']) });

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

// The domain layer throws Hebrew, user-safe messages for every refusal a caller
// can legitimately hit (wrong current status, past event, unpublished event).
// They are all "the request was understood but the state forbids it" → 409. Any
// other error is ours, and must not leak: 500 with a generic message.
const CONFLICT_MESSAGES = new Set([
  'לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי',
  'האירוע כבר חלף — לא ניתן לבצע פעולה זו עבור אירוע שמועדו עבר',
  'יש לפרסם את האירוע לפני אישורי הגעה',
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!(await callerHasPlatformPermission(auth.ctx.supabase, 'campaigns.runstate'))) {
    return json({ error: 'אין הרשאה' }, 403);
  }

  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return json({ error: 'מזהה קמפיין לא תקין' }, 400);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  const { action } = parsed.data;

  // Resolve the campaign and its owner BEFORE acting. Two reasons: the audit row
  // needs owner_id, and transitionCampaignStatus answers a missing campaign with
  // Next's notFound(), which in a Route Handler would surface as an HTML error
  // page instead of the JSON this API promises.
  const admin = createAdminClient();
  const { data: campaign, error: cErr } = await admin
    .from('campaigns')
    .select('id, event_id, events!inner(owner_id)')
    .eq('id', id)
    .maybeSingle();
  if (cErr) return json({ error: 'טעינת הקמפיין נכשלה' }, 500);
  if (!campaign) return json({ error: 'הקמפיין לא נמצא' }, 404);

  const actor = { kind: 'console' as const, staffUserId: auth.ctx.userId };

  try {
    if (action === 'pause') {
      await pauseCampaign(id, actor);
    } else {
      await activateCampaign(id, actor);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (CONFLICT_MESSAGES.has(message)) return json({ error: message }, 409);
    console.error(`[campaign-runstate] ${action} failed (campaign=${id})`);
    return json({ error: 'עדכון מצב הקמפיין נכשל' }, 500);
  }

  // Audit AFTER the transition succeeded, so the trail records what happened and
  // not what was attempted. Deliberately not fail-closed the way an audited READ
  // is: the state has already changed, and throwing here would report failure for
  // work that was done. A failed audit is logged loudly instead.
  try {
    await recordStaffAccess({
      staffId: auth.ctx.userId,
      permission: 'campaigns.runstate',
      subjectType: 'campaign',
      subjectId: id,
      ownerId: campaign.events.owner_id,
      eventId: campaign.event_id,
      reason: action === 'pause' ? 'השהיית קמפיין מהקונסולה' : 'החייאת קמפיין מהקונסולה',
    });
  } catch {
    console.error(`[campaign-runstate] AUDIT WRITE FAILED (campaign=${id} action=${action})`);
  }

  return json({ ok: true, status: action === 'pause' ? 'paused' : 'active' }, 200);
}
