'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { setQueueActive, syncQueueMembers } from '@/lib/data/console-queues';
import type { FormState } from '@/lib/validation/result';

// Queue membership/activation is an ADMIN decision, not self-service (task
// brief — mirrors the migration's RLS: console_queues/console_agent_queues
// grant zero write access to `authenticated`; only these service-role Server
// Actions, gated on manage_voice, ever write them).

const toggleQueueActiveSchema = z.object({
  queue_id: z.string().uuid(),
  // Checkbox convention (OutreachMasterSwitch precedent): present ("on") when
  // checked, absent (undefined) when unchecked.
  is_active: z.string().optional(),
});

export async function toggleQueueActiveAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformPermission('manage_voice');
  const parsed = toggleQueueActiveSchema.safeParse({
    queue_id: formData.get('queue_id'),
    is_active: formData.get('is_active') ?? undefined,
  });
  if (!parsed.success) return { error: 'קלט לא תקין.' };
  const isActive = parsed.data.is_active === 'on';

  try {
    await setQueueActive(parsed.data.queue_id, isActive);
    await logActivity({
      action: 'admin.voice.queue_toggle',
      meta: { queue_id: parsed.data.queue_id, is_active: isActive },
    });
    revalidatePath('/admin/voice/queues');
    return { notice: isActive ? 'המחלקה הופעלה.' : 'המחלקה הושבתה.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'העדכון נכשל. נסו שוב.' };
  }
}

const updateQueueMembersSchema = z.object({
  queue_id: z.string().uuid(),
  agent_ids: z.array(z.string().uuid()),
});

export async function updateQueueMembersAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformPermission('manage_voice');
  const parsed = updateQueueMembersSchema.safeParse({
    queue_id: formData.get('queue_id'),
    agent_ids: formData.getAll('agent_id'),
  });
  if (!parsed.success) return { error: 'קלט לא תקין.' };

  try {
    await syncQueueMembers(parsed.data.queue_id, parsed.data.agent_ids);
    await logActivity({
      action: 'admin.voice.queue_members_update',
      meta: { queue_id: parsed.data.queue_id, agent_count: parsed.data.agent_ids.length },
    });
    revalidatePath('/admin/voice/queues');
    return { notice: 'חברי המחלקה עודכנו.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון החברים נכשל. נסו שוב.' };
  }
}
