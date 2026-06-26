import Link from 'next/link';

import { requireOwnedEvent } from '@/lib/data/events';
import { CSV_MAX_ROWS } from '@/lib/constants';
import { importGuestsAction } from './import-actions';
import { ImportForm } from './import-form';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ImportGuestsPage({ params }: PageProps) {
  const { id: eventId } = await params;
  await requireOwnedEvent(eventId);

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

      <div className="space-y-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <p>קובץ CSV עם שורת כותרת. עמודות נתמכות:</p>
        <ul className="list-inside list-disc">
          <li>
            <span className="font-medium text-foreground">שם</span> (name) —
            חובה
          </li>
          <li>
            <span className="font-medium text-foreground">טלפון</span> (phone) —
            רשות
          </li>
          <li>
            <span className="font-medium text-foreground">קבוצה</span> (group) —
            רשות; קבוצה שאינה קיימת תיווצר אוטומטית
          </li>
        </ul>
        <p>עד {CSV_MAX_ROWS} שורות לקובץ.</p>
      </div>

      <ImportForm action={action} />
    </div>
  );
}
