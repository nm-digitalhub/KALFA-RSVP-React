'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { setQueueActive, syncQueueMembers } from '@/lib/data/console-queues';
import { actionClient, returnUserError } from '@/lib/safe-action';

// Queue membership/activation is an ADMIN decision, not self-service (mirrors
// the migration's RLS: console_queues/console_agent_queues grant zero write
// access to `authenticated`; only these service-role Server Actions, gated on
// manage_voice, ever write them).
//
// The staff gate runs BEFORE the form is validated: a pre-validation middleware (`use()` runs before `inputSchema`).
const manageVoiceClient = actionClient.use(async ({ next }) => {
  await requirePlatformPermission('manage_voice');
  return next();
});

// Any invalid field answers with the one form-level message.
const INVALID_INPUT = 'קלט לא תקין.';
const uuid = z.uuid();

const toggleQueueActiveInput = zfd.formData({
  queue_id: z.uuid({ error: INVALID_INPUT }),
  // Checkbox convention (OutreachMasterSwitch precedent): present ("on") when
  // checked, absent (undefined) when unchecked.
  is_active: z.string({ error: INVALID_INPUT }).optional(),
});

export const toggleQueueActiveAction = manageVoiceClient
  .inputSchema(toggleQueueActiveInput)
  .stateAction(async ({ parsedInput }) => {
    const isActive = parsedInput.is_active === 'on';

    try {
      await setQueueActive(parsedInput.queue_id, isActive);
      await logActivity({
        action: 'admin.voice.queue_toggle',
        meta: { queue_id: parsedInput.queue_id, is_active: isActive },
      });
      revalidatePath('/admin/voice/queues');
      return { notice: isActive ? 'המחלקה הופעלה.' : 'המחלקה הושבתה.' };
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('העדכון נכשל. נסו שוב.');
    }
  });

const updateQueueMembersInput = zfd.formData({
  queue_id: z.uuid({ error: INVALID_INPUT }),
  // One checkbox per agent, all named `agent_id`. Checked as a whole list: the flattened result keeps one level only,
  // so an error on a single item would be dropped and the form would show nothing.
  agent_id: zfd.repeatable(
    z.custom<string[]>(
      (ids) => Array.isArray(ids) && ids.every((id) => uuid.safeParse(id).success),
      { error: INVALID_INPUT },
    ),
  ),
});

export const updateQueueMembersAction = manageVoiceClient
  .inputSchema(updateQueueMembersInput)
  .stateAction(async ({ parsedInput: { queue_id, agent_id: agentIds } }) => {
    try {
      await syncQueueMembers(queue_id, agentIds);
      await logActivity({
        action: 'admin.voice.queue_members_update',
        meta: { queue_id, agent_count: agentIds.length },
      });
      revalidatePath('/admin/voice/queues');
      return { notice: 'חברי המחלקה עודכנו.' };
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון החברים נכשל. נסו שוב.');
    }
  });
