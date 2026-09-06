import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { listEvents } from '@/lib/data/events';
import { cn } from '@/lib/utils';

// The only state this route ever renders is the welcome screen — every other
// case is a server-side redirect that never paints.
export const metadata: Metadata = { title: 'ברוכים הבאים' };

// /app is a routing node, not a dashboard. A per-event B2C product has no
// portfolio to survey: the customer belongs on their event, and a counters
// screen in front of it is an extra click on every single visit.
//
// The redirect is thrown during the server render and returned as a 303 before
// any HTML reaches the browser, so there is no intermediate paint and no
// client-side navigation to flicker.
export default async function AppEntryPage() {
  // ONE query decides all three branches: `limit: 2` distinguishes 0 / 1 / 2+
  // AND carries the id the single-event redirect needs. No count query, and no
  // campaign query — the destination never depends on campaign state.
  //
  // This decision must stay ahead of every other await, so the common case
  // (customer with one event) costs exactly one query.
  //
  // "How many events" means how many are VISIBLE AFTER RLS, not how many are
  // owned: listEvents deliberately does not filter by owner_id, because an
  // app-side owner filter would blank the list for an org member whom RLS does
  // allow. Verified against live data: a user who owns nothing but sees 4
  // shared events must land on "האירועים שלי", not on the welcome screen.
  const rows = await listEvents({ limit: 2 });

  // Exactly one visible event → that event IS the workspace, whatever its
  // status. The event page is the single canonical URL and picks its own mode
  // (setup / work / summary); routing must not fork on status.
  if (rows.length === 1) redirect(`/app/events/${rows[0].id}`);
  if (rows.length >= 2) redirect('/app/events');

  // Nothing visible → stay here and ask the one question that matters.
  //
  // Deliberately no further data access. Beyond the wasted query, any call that
  // reaches requireActiveOrg (dal.ts) redirects to /app and would loop forever:
  // a user without an active org is a real state, since the personal org is
  // created only by ensurePersonalOrg when the first event is created.
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-10 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">בואו נתחיל</h1>
        {/* Addressed to the moment, not to the reader: an org member with no
            shared events reaches this screen too, so nothing here may assume
            "new user". */}
        <p className="text-sm text-muted-foreground">
          כל אירוע מתנהל בעמוד אחד — הוספת מוזמנים, שליחת הזמנות ומעקב אחר אישורי הגעה.
        </p>
      </div>

      {/* cn(), not buttonVariants({ className }): the exported cva fn
          concatenates without tailwind-merge (see components/ui/button.tsx). */}
      <Link href="/app/events/new" className={cn(buttonVariants(), 'h-11 w-full')}>
        יצירת האירוע הראשון
      </Link>
    </div>
  );
}
