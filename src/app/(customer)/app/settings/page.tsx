import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { requireUser } from '@/lib/auth/dal';
import { getProfile, type ProfileDTO } from '@/lib/data/profiles';
import { readSumitCustomerNumber } from '@/lib/data/sumit-customers';
import {
  DEFAULT_USER_SETTINGS,
  getUserSettings,
  type UserSettingsDTO,
} from '@/lib/data/user-settings';
import { SettingsPageClient } from './settings-client';

export const metadata: Metadata = { title: 'הגדרות' };

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
  // The number SUMIT gave this account at its first payment. Read on the server for the VERIFIED user id; the
  // browser has no access to the table behind it.
  let customerNumber: number | null = null;
  let loadError = false;

  try {
    const user = await requireUser();
    userEmail = user.email;
    [profile, settings, customerNumber] = await Promise.all([
      getProfile(),
      getUserSettings(),
      readSumitCustomerNumber(user.id),
    ]);
  } catch (err) {
    unstable_rethrow(err);
    loadError = true;
  }

  return (
    <SettingsPageClient
      userEmail={userEmail}
      profile={profile}
      customerNumber={customerNumber}
      settings={settingsWithDefaults(settings)}
      loadError={loadError}
    />
  );
}
