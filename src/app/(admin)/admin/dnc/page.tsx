import { listCallDnc } from '@/lib/data/admin/call-dnc';
import { PageHeading } from '../_components';
import { DncClient } from './dnc-client';

const sectionClass = 'space-y-4 rounded-lg border border-border bg-card p-5';

// Admin: Do-Not-Call list for the Voximplant AI-call channel. requireAdmin() is
// enforced in the data layer (and by the admin-only RLS policy on
// call_dnc_list). Adding a phone here blocks every future AI call to it.
export default async function AdminDncPage() {
  const entries = await listCallDnc();

  return (
    <div className="space-y-6">
      <PageHeading>רשימת חסימה לשיחות (DNC)</PageHeading>

      <section className={sectionClass}>
        <div>
          <h2 className="text-lg font-semibold">חסימת מספרים משיחות AI</h2>
          <p className="text-sm text-muted-foreground">
            מספר שנוסף לכאן לא יקבל שיחות אישור-הגעה אוטומטיות. השתמשו בכך לבקשות
            הסרה ולתלונות. החסימה חלה על ערוץ השיחות בלבד.
          </p>
        </div>
        <DncClient entries={entries} />
      </section>
    </div>
  );
}
