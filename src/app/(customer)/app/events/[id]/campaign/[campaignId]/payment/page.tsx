import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCampaign } from '@/lib/data/campaigns';
import { requireOwnedEvent } from '@/lib/data/events';
import { getPaymentsEnabled } from '@/lib/data/payments';

// Card-capture step of campaign approval (route A: capture an authorization hold
// up to the ceiling at approval, charge the actual at close). The real SUMIT J5
// hold is NOT wired yet — this step is intentionally fail-closed: it renders the
// next-step information and NEVER calls SUMIT until the hold path is built and
// payments are explicitly enabled.

function ils(n: number | null): string {
  if (n == null) return '—';
  return `₪${n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function CampaignPaymentPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  const campaign = await getCampaign(campaignId);
  if (campaign.event_id !== id) notFound();
  await requireOwnedEvent(id);

  // The agreement must be signed (campaign approved) before the payment step.
  if (campaign.status === 'pending_approval') {
    redirect(`/app/events/${id}/campaign/${campaignId}/approve`);
  }

  // Config gate (fail-closed). The live card form / J5 hold is only rendered once
  // payments are enabled AND the hold path is implemented; until then this stays
  // informational and makes no provider call.
  const paymentsEnabled = await getPaymentsEnabled();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">אמצעי תשלום</h1>
        <Link
          href={`/app/events/${id}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden="true">→</span>
          חזרה לאירוע
        </Link>
      </div>

      <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
        ✓ ההסכם נחתם והקמפיין אושר.
      </p>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
        <h2 className="font-semibold">תפיסת מסגרת אשראי</h2>
        <p>
          להפעלת הקמפיין נתפוס מסגרת אשראי עד{' '}
          <strong>{ils(campaign.max_charge_ceiling)}</strong> (תקרת החיוב). זוהי
          תפיסה בלבד — <strong>החיוב בפועל</strong> ייעשה בסגירת הקמפיין, לפי מספר
          אנשי הקשר שהושגו בפועל, ולכל היותר עד התקרה.
        </p>

        <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
          {paymentsEnabled
            ? 'שלב קליטת אמצעי התשלום (תפיסת מסגרת) ייפתח כאן בקרוב. נעדכן אותך כשהוא יהיה זמין.'
            : 'שלב קליטת אמצעי התשלום מופעל בנפרד. ניצור איתך קשר להשלמת תפיסת מסגרת האשראי.'}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        עד להשלמת אמצעי התשלום הקמפיין אינו מופעל ולא יישלחו פניות.
      </p>
    </div>
  );
}
