import Link from 'next/link';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getQueueMemberIds, listAllConsoleAgents, listQueuesForAdmin } from '@/lib/data/console-queues';
import { PageHeading } from '../../_components';
import { QueuesClient } from './queues-client';

export const metadata = { title: 'מחלקות — מוקד שיחות AI' };

// Admin management surface for department queues (plan §10 extension point:
// "מחלקות (נקודת הרחבה = ring-order בשרת)"). NOT SmartQueue — a plain
// admin-managed grouping of console_agents that the inbound ring order
// consults first (see console-queues.ts / route-inbound's integration).

export default async function VoiceQueuesPage() {
  // Optimistic gate: redirect early instead of rendering an empty page. The
  // real enforcement is per-function/per-action in the DAL and Server Actions.
  await requirePlatformPermission('manage_voice');

  const [queues, agents] = await Promise.all([listQueuesForAdmin(), listAllConsoleAgents()]);
  const memberIdsByQueue: Record<string, string[]> = {};
  await Promise.all(
    queues.map(async (q) => {
      memberIdsByQueue[q.id] = await getQueueMemberIds(q.id);
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>מחלקות (תורים)</PageHeading>
        <Link href="/admin/voice" className="text-sm font-medium text-primary hover:underline">
          ← חזרה למוקד
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        שיחה נכנסת מנותבת תחילה לחברי המחלקה הפעילה שנבחרה, ורק לאחר מכן לכל
        נציג זמין אחר (מודל fallback — לא בחירה בלעדית). שיוך המחלקה לשיחה
        נכנסת הוא כרגע ברירת מחדל קבועה (&quot;תמיכה&quot;) — אין עדיין ניתוב IVR לפי מקש
        חיוג; זו נקודת הרחבה מוכנה לעתיד.
      </p>
      {queues.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין מחלקות מוגדרות.</p>
      ) : (
        <QueuesClient queues={queues} agents={agents} memberIdsByQueue={memberIdsByQueue} />
      )}
    </div>
  );
}
