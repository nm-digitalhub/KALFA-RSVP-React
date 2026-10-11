import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { requireUser } from '@/lib/auth/dal';
import { getProfile, isProfilePhoneVerified, type ProfileDTO } from '@/lib/data/profiles';
import { currentConsent, getConsentWording, isMarketingConsentEnabled } from '@/lib/data/marketing-consent';
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
  // Decided here, against the Auth session user — the client never sees the
  // proof, only the answer.
  let phoneVerified = false;
  // null while marketing consent is switched off; otherwise the current state read from the ledger (never from the
  // browser) and the server wording the toggle shows.
  let marketingConsent: { granted: boolean; wording: string } | null = null;
  let loadError = false;

  try {
    const user = await requireUser();
    userEmail = user.email;
    [profile, settings, customerNumber] = await Promise.all([
      getProfile(),
      getUserSettings(),
      readSumitCustomerNumber(user.id),
    ]);
    phoneVerified = isProfilePhoneVerified(profile, user);
    if (await isMarketingConsentEnabled()) {
      const [consent, wording] = await Promise.all([currentConsent(user.id), getConsentWording()]);
      marketingConsent = { granted: consent === 'granted', wording: wording.text };
    }
  } catch (err) {
    unstable_rethrow(err);
    loadError = true;
  }

  return (
    <SettingsPageClient
      userEmail={userEmail}
      profile={profile}
      phoneVerified={phoneVerified}
      marketingConsent={marketingConsent}
      customerNumber={customerNumber}
      settings={settingsWithDefaults(settings)}
      loadError={loadError}
    />
  );
}
