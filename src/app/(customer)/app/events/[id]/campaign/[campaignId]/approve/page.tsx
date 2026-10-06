import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCampaign } from '@/lib/data/campaigns';
import { requireOwnedEvent } from '@/lib/data/events';

export const metadata: Metadata = { title: 'חתימה על ההסכם' };

// Signing now happens INSIDE the setup flow (/setup, the "קריאת ההסכם וחתימה" step),
// so a campaign that is waiting for a signature sends the owner there — old links
// keep working. What stays here is the page for a campaign that is NOT waiting.
export default async function ApproveCampaignPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  const campaign = await getCampaign(campaignId);
  if (campaign.event_id !== id) notFound();
  await requireOwnedEvent(id);

  if (campaign.status === 'pending_approval') redirect(`/app/events/${id}/setup`);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">חתימה על ההסכם</h1>
        <Link
          href={`/app/events/${id}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden="true">→</span>
          חזרה לאירוע
        </Link>
      </div>
      <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
        {campaign.status === 'approved'
          ? 'ההסכם נחתם בהצלחה. כעת יש להשלים אמצעי תשלום.'
          : 'הקמפיין אינו ממתין לאישור ולכן לא ניתן לחתום עליו כעת.'}
      </p>
      {campaign.status === 'approved' ? (
        <Link
          href={`/app/events/${id}/campaign/${campaignId}/payment`}
          className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          המשך לאמצעי התשלום
        </Link>
      ) : null}
    </div>
  );
}
