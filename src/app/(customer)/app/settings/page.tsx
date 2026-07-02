import { unstable_rethrow } from 'next/navigation';
import { requireUser } from '@/lib/auth/dal';
import { getProfile, type ProfileDTO } from '@/lib/data/profiles';
import { listOrders, type OrderListItem } from '@/lib/data/orders';
import {
  DEFAULT_USER_SETTINGS,
  getUserSettings,
  type UserSettingsDTO,
} from '@/lib/data/user-settings';
import { SettingsPageClient } from './settings-client';

function settingsWithDefaults(settings: UserSettingsDTO | null): UserSettingsDTO {
  return {
    user_id: settings?.user_id ?? '',
    updated_at: settings?.updated_at ?? '',
    event_updates: settings?.event_updates ?? DEFAULT_USER_SETTINGS.event_updates,
    reminder_updates:
      settings?.reminder_updates ?? DEFAULT_USER_SETTINGS.reminder_updates,
    billing_updates: settings?.billing_updates ?? DEFAULT_USER_SETTINGS.billing_updates,
  };
}

export default async function SettingsPage() {
  let userEmail: string | undefined;
  let profile: ProfileDTO | null = null;
  let settings: UserSettingsDTO | null = null;
  let orders: OrderListItem[] = [];
  let loadError = false;

  try {
    const user = await requireUser();
    userEmail = user.email;
    [profile, settings, orders] = await Promise.all([
      getProfile(),
      getUserSettings(),
      listOrders({ limit: 3 }),
    ]);
  } catch (err) {
    unstable_rethrow(err);
    loadError = true;
  }

  return (
    <SettingsPageClient
      userEmail={userEmail}
      profile={profile}
      settings={settingsWithDefaults(settings)}
      orders={orders}
      loadError={loadError}
    />
  );
}
