import Link from 'next/link';

import { requireEventAccess } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import type { StagedRow } from '@/lib/data/whatsapp-import';
import {
  confirmWhatsappImportAction,
  discardWhatsappImportAction,
} from './actions';
import { StagingActions } from './staging-client';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Review screen for guest lists sent to the business WhatsApp (CSV documents
// or shared contact cards). Nothing lands in the guest list until confirmed
// here; reads ride the staging RLS (guests.view/create per phase 3).
export default async function WhatsappImportPage({ params }: PageProps) {
  const { id: eventId } = await params;
  await requireEventAccess(eventId, 'guests', 'create');

  const supabase = await createClient();
  const { data: pending } = await supabase
    .from('guest_import_staging')
    .select('id, source, file_name, rows, row_count, error_rows, created_at')
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ייבוא מוואטסאפ</h1>
        <Link
          href={`/app/events/${eventId}/guests`}
          className="text-sm text-muted-foreground hover:underline"
        >
          חזרה למוזמנים
        </Link>
      </div>

      {(pending ?? []).length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          אין רשימות ממתינות. שלחו קובץ CSV או שתפו אנשי קשר לוואטסאפ העסקי —
          והרשימה תופיע כאן לאישור.
        </p>
      ) : null}

      {(pending ?? []).map((s) => {
        const rows = (s.rows ?? []) as StagedRow[];
        const errorCount = Array.isArray(s.error_rows) ? s.error_rows.length : 0;
        return (
          <section key={s.id} className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">
                {s.source === 'whatsapp_document'
                  ? `קובץ${s.file_name ? `: ${s.file_name}` : ''}`
                  : 'אנשי קשר ששותפו'}
              </h2>
              <span className="text-xs text-muted-foreground">
                {s.row_count} שורות{errorCount ? ` · ${errorCount} שגיאות` : ''}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-right text-muted-foreground">
                    <th className="py-1 pe-3 font-medium">שם</th>
                    <th className="py-1 pe-3 font-medium">טלפון</th>
                    <th className="py-1 pe-3 font-medium">כמות</th>
                    <th className="py-1 font-medium">קבוצה</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1 pe-3">{r.full_name}</td>
                      <td className="py-1 pe-3" dir="ltr">{r.phone ?? '—'}</td>
                      <td className="py-1 pe-3">{r.expected_count ?? '—'}</td>
                      <td className="py-1">{r.group || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 50 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  מוצגות 50 הראשונות מתוך {rows.length}.
                </p>
              ) : null}
            </div>

            <StagingActions
              confirm={confirmWhatsappImportAction.bind(null, eventId, s.id)}
              discard={discardWhatsappImportAction.bind(null, eventId, s.id)}
            />
          </section>
        );
      })}
    </div>
  );
}
