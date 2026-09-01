import type { Metadata } from 'next';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getCallbackPolicyForAdmin } from '@/lib/callbacks/policy-config-admin';
import { PageHeading } from '../../_components';
import { CallbackPolicyForm } from './policy-form';

export const metadata: Metadata = { title: 'מדיניות תזמון שיחות חוזרות' };

// Admin: the callback-scheduling policy (schedule-policy.ts's admin-editable
// counterpart) — business hours per weekday, minimum notice, horizon, call
// duration, daily cap, and the post-motzash-shabbat resume delay. A change
// here affects only NEW scheduling decisions; already-booked appointments are
// untouched (see getCallbackPolicy's own fail-safe-to-default comment).
export default async function AdminCallbackPolicyPage() {
  await requirePlatformPermission('manage_settings');
  const values = await getCallbackPolicyForAdmin();

  return (
    <div className="space-y-6">
      <PageHeading>מדיניות תזמון שיחות חוזרות</PageHeading>
      <p className="text-sm text-muted-foreground">
        קובע מתי ואיך המערכת משבצת שיחות חוזרות ביומן. שינוי כאן משפיע רק על
        שיבוצים חדשים — פגישות שכבר נקבעו אינן מושפעות.
      </p>
      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <CallbackPolicyForm values={values} />
      </section>
    </div>
  );
}
