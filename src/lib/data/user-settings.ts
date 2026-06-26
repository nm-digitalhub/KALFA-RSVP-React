import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import type { Database } from '@/lib/supabase/types';

export type UserSettingsRow = Database['public']['Tables']['user_settings']['Row'];

export type UserSettingsDTO = Pick<
  UserSettingsRow,
  | 'user_id'
  | 'event_updates'
  | 'reminder_updates'
  | 'billing_updates'
  | 'updated_at'
>;

const SETTINGS_COLUMNS =
  'user_id, event_updates, reminder_updates, billing_updates, updated_at';

export const DEFAULT_USER_SETTINGS: Omit<
  UserSettingsDTO,
  'user_id' | 'updated_at'
> = {
  event_updates: true,
  reminder_updates: true,
  billing_updates: true,
};

export async function getUserSettings(): Promise<UserSettingsDTO | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('user_settings')
    .select(SETTINGS_COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    throw new Error('טעינת ההגדרות נכשלה');
  }

  return data;
}

export interface UpdateUserSettingsFields {
  event_updates: boolean;
  reminder_updates: boolean;
  billing_updates: boolean;
}

export async function updateUserSettings(
  fields: UpdateUserSettingsFields,
): Promise<UserSettingsDTO> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, ...fields })
    .select(SETTINGS_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('שמירת ההגדרות נכשלה');
  }

  await logActivity({
    action: 'settings.updated',
    meta: {
      fields: Object.keys(fields),
    },
  });

  return data;
}
