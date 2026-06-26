import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import type { Database } from '@/lib/supabase/types';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

// DTO: only the columns the account screen needs. The profile row is keyed by
// the auth user id (profiles.id === auth.users.id); ownership is therefore the
// id itself, derived server-side from the verified session.
export type ProfileDTO = Pick<ProfileRow, 'id' | 'full_name' | 'phone' | 'updated_at'>;

// This string IS the DTO contract — the data functions return rows as-is.
const PROFILE_COLUMNS = 'id, full_name, phone, updated_at';

// Load the current user's profile, or null if no row exists yet (a profile is
// only materialised on first update). owner is the verified user id, never a
// browser-supplied value.
export async function getProfile(): Promise<ProfileDTO | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    throw new Error('טעינת הפרופיל נכשלה');
  }

  return data;
}

export interface UpdateProfileFields {
  full_name: string | null;
  phone: string | null;
}

// Upsert the current user's profile. `upsert({ id: user.id, ... })` handles the
// missing-row case (no profile yet) and the update case in one statement. The id
// is the verified user id, set server-side — it is never taken from the form.
export async function updateProfile(fields: UpdateProfileFields): Promise<ProfileDTO> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      full_name: fields.full_name,
      phone: fields.phone,
    })
    .select(PROFILE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('שמירת הפרופיל נכשלה');
  }

  await logActivity({
    action: 'profile.updated',
    meta: {
      fields: Object.keys(fields),
    },
  });

  return data;
}
