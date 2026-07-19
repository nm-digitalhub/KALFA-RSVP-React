import { Check, X } from 'lucide-react';

import {
  getAppSettings,
  getInfraConfigStatus,
} from '@/lib/data/admin/settings';
import { PageHeading } from '../_components';
import { SettingsForm } from './settings-form';

const sectionClass = 'space-y-4 rounded-lg border border-border bg-card p-5';

// Admin system settings. requirePlatformPermission('manage_settings') is enforced in the data layer (and the
// /admin layout). Manages the clearing master switch + SUMIT provider keys
// (edited via the form, masked with reveal), and shows a read-only health view
// of the infra config that stays in env.
export default async function AdminSettingsPage() {
  const [settings, infra] = await Promise.all([
    getAppSettings(),
    getInfraConfigStatus(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeading>הגדרות מערכת</PageHeading>

      <section className={sectionClass}>
        <div>
          <h2 className="text-lg font-semibold">סליקה (SUMIT)</h2>
          <p className="text-sm text-muted-foreground">
            מתג ראשי להפעלת תשלומים, ומפתחות שירות הסליקה. כל ערך ניתן לעריכה
            בנפרד; המפתחות מוצגים מוסכים עם כפתור חשיפה.
          </p>
        </div>
        <SettingsForm settings={settings} />
      </section>

      <section className={sectionClass}>
        <div>
          <h2 className="text-lg font-semibold">תצורת תשתית (env)</h2>
          <p className="text-sm text-muted-foreground">
            ערכים אלה נשארים בקובץ הסביבה ולא נערכים מכאן: מפתח ה-service-role הוא
            המפתח שמאבטח את ה-DB עצמו, ו-APP_ORIGIN הוא הגדרת פריסה. מוצג סטטוס
            בלבד.
          </p>
        </div>
        <ul className="divide-y divide-border rounded-md border border-border">
          {infra.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {item.key}
                </p>
              </div>
              {item.configured ? (
                <span className="flex shrink-0 items-center gap-1 text-sm text-green-700">
                  <Check className="size-4" aria-hidden /> מוגדר
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-sm text-red-700">
                  <X className="size-4" aria-hidden /> חסר
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
