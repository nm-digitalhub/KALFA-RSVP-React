import Link from 'next/link';

import { requireEventAccess } from '@/lib/data/events';
import { CSV_MAX_ROWS } from '@/lib/constants';
import { importGuestsAction } from './import-actions';
import { ImportForm } from './import-form';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ImportGuestsPage({ params }: PageProps) {
  const { id: eventId } = await params;
  await requireEventAccess(eventId, 'guests', 'create');

  // Bind the event id server-side; the action re-verifies ownership.
  const action = importGuestsAction.bind(null, eventId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ייבוא מוזמנים מקובץ</h1>
        <Link
          href={`/app/events/${eventId}/guests`}
          className="text-sm text-muted-foreground hover:underline"
        >
          חזרה
        </Link>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>קובץ CSV עם שורת כותרת. עמודות נתמכות:</p>
          <a
            href={`/app/events/${eventId}/guests/import/template`}
            className="rounded-md border border-border px-3 py-1.5 font-medium text-primary transition-colors hover:bg-muted"
          >
            הורדת תבנית מוכנה ↓
          </a>
        </div>
        <ul className="list-inside list-disc">
          <li>
            <span className="font-medium text-foreground">שם מלא</span> (name)
            — חובה; שורה אחת = הזמנה אחת (למשל ״משפחת כהן״)
          </li>
          <li>
            <span className="font-medium text-foreground">טלפון</span> (phone) —
            רשות; משפחה יכולה לחלוק מספר אחד
          </li>
          <li>
            <span className="font-medium text-foreground">כמות</span> (count) —
            רשות; כמה אנשים כלולים בהזמנה
          </li>
          <li>
            <span className="font-medium text-foreground">קבוצה</span> (group) —
            רשות; קבוצה שאינה קיימת תיווצר אוטומטית
          </li>
        </ul>
        <ul className="list-inside list-disc border-t border-border pt-2">
          <li>עורכים באקסל? שמרו בשם בפורמט ״CSV UTF-8״. קידוד עברית ישן (ANSI) מזוהה ומתוקן אוטומטית.</li>
          <li>טלפון שאיבד את ה־0 המוביל באקסל (למשל ‎501234567‎) מתוקן אוטומטית בייבוא.</li>
          <li>קובצי ‎.xlsx אינם נתמכים — יש לשמור אותם קודם כ־CSV.</li>
        </ul>
        <p>עד {CSV_MAX_ROWS} שורות לקובץ.</p>
      </div>

      <ImportForm action={action} />
    </div>
  );
}
