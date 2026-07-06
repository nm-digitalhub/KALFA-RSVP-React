import Link from 'next/link';

import { requireEventAccess } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { findImportMatches, type ImportMatch } from '@/lib/data/guests';
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

  // Per staging list, detect incoming rows that are the SAME person as an
  // existing guest (by phone, or by name when the existing one is phone-less) —
  // surfaced on the review screen as per-field merge choices.
  const pendingList = pending ?? [];
  const matchesByStaging = new Map<string, ImportMatch[]>();
  await Promise.all(
    pendingList.map(async (s) => {
      const rows = (s.rows ?? []) as StagedRow[];
      matchesByStaging.set(s.id, await findImportMatches(eventId, rows));
    }),
  );

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

      {pendingList.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          אין רשימות ממתינות. שלחו קובץ CSV או שתפו אנשי קשר לוואטסאפ העסקי —
          והרשימה תופיע כאן לאישור.
        </p>
      ) : null}

      {pendingList.map((s) => {
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
              {/* px (not pe) on every cell: the phone cell is dir="ltr", which
                  FLIPS its inline end — one-sided padding left its digits flush
                  against the quantity column, visually fusing "1" + "05…" into
                  one number. Symmetric padding + nowrap keeps columns apart. */}
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-border text-right text-muted-foreground">
                    <th className="px-3 py-1 font-medium">שם</th>
                    <th className="px-3 py-1 font-medium">טלפון</th>
                    <th className="px-3 py-1 font-medium">כמות</th>
                    <th className="px-3 py-1 font-medium">קבוצה</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-3 py-1">{r.full_name}</td>
                      {/* text-end (right, in this LTR cell) keeps the digits
                          aligned under the right-aligned RTL header. */}
                      <td className="px-3 py-1 text-end" dir="ltr">{r.phone ?? '—'}</td>
                      <td className="px-3 py-1">{r.expected_count ?? '—'}</td>
                      <td className="px-3 py-1">{r.group || '—'}</td>
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
              matches={matchesByStaging.get(s.id) ?? []}
            />
          </section>
        );
      })}
    </div>
  );
}
