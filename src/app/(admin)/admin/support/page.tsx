import { requirePlatformPermission } from '@/lib/auth/dal';

import { PageHeading } from '../_components';
import { SupportClient } from './support-client';

export const metadata = { title: 'תמיכת לקוחות' };

// Dedicated, READ-ONLY customer-support surface. Gated on the
// 'view_customer_data' platform permission — a staff member without it is
// redirected to /app before this page renders anything. The actual reads (and
// the required break-glass reason + audit log) happen in the server actions
// (./actions.ts) invoked from the client below; this page only renders the
// lookup form + the read-only result view.
export default async function AdminSupportPage() {
  await requirePlatformPermission('view_customer_data');

  return (
    <div className="space-y-6">
      <div>
        <PageHeading>תמיכת לקוחות</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          צפייה בנתוני אירוע ואורחים (ללא נתוני חיוב) לצורך תמיכה. כל צפייה
          מחייבת סיבה ומתועדת ביומן ביקורת.
        </p>
      </div>

      <SupportClient />
    </div>
  );
}
