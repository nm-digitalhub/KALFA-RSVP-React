import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getCampaign } from '@/lib/data/campaigns';
import { getCompanyLegal } from '@/lib/data/company';
import { requireOwnedEvent } from '@/lib/data/events';
import { getProfile } from '@/lib/data/profiles';
import {
  renderAgreementBody,
  AGREEMENT_CSS,
} from '@/lib/agreements/template';
import { SignAgreementForm } from './sign-agreement-form';
import { AgreementSheet } from './agreement-sheet';

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'וואטסאפ',
  call: 'שיחה טלפונית (AI)',
};

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('he-IL') : 'לא הוגדר';
}

function ils(n: number | null): string {
  if (n == null) return '—';
  return `₪${n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function ApproveCampaignPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  const campaign = await getCampaign(campaignId);
  if (campaign.event_id !== id) notFound();

  const [event, company, profile] = await Promise.all([
    requireOwnedEvent(id),
    getCompanyLegal(),
    getProfile(),
  ]);

  const backLink = (
    <Link
      href={`/app/events/${id}`}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <span aria-hidden="true">→</span>
      חזרה לאירוע
    </Link>
  );

  if (campaign.status !== 'pending_approval') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">אישור קמפיין</h1>
          {backLink}
        </div>
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {campaign.status === 'approved'
            ? 'ההסכם נחתם והקמפיין אושר.'
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

  const agreementHtml = renderAgreementBody({
    company,
    eventName: event.name,
    pricePerReached: campaign.price_per_reached ?? 0,
    maxContacts: campaign.max_contacts ?? 0,
    ceiling: campaign.max_charge_ceiling ?? 0,
    channels: campaign.allowed_channels,
    windowText: `${fmtDate(campaign.start_at)} – ${fmtDate(campaign.close_at)}`,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">אישור וחתימה על ההסכם</h1>
        {backLink}
      </div>

      <p className="text-sm text-muted-foreground">
        אלו עיקרי התנאים. קראו את ההסכם המלא לפני החתימה; החתימה מחייבת אימות
        הטלפון שלכם בקוד חד‑פעמי.
      </p>

      {/* Global CSS for the agreement — styles the (portaled) sheet content too. */}
      <style dangerouslySetInnerHTML={{ __html: AGREEMENT_CSS }} />

      {/* Concise summary on the page; full agreement opens in a slide-in panel. */}
      <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
        <h2 className="font-semibold">עיקרי התנאים</h2>
        <dl className="grid grid-cols-2 gap-y-1.5">
          <dt className="text-muted-foreground">מחיר לאיש קשר שהושג</dt>
          <dd>{ils(campaign.price_per_reached)} (כולל מע״מ)</dd>
          <dt className="text-muted-foreground">תקרת חיוב מרבית</dt>
          <dd>
            <strong>{ils(campaign.max_charge_ceiling)}</strong>
          </dd>
          <dt className="text-muted-foreground">אנשי קשר</dt>
          <dd>{campaign.max_contacts ?? '—'}</dd>
          <dt className="text-muted-foreground">ערוצים</dt>
          <dd>
            {campaign.allowed_channels
              .map((c) => CHANNEL_LABELS[c] ?? c)
              .join(', ')}
          </dd>
          <dt className="text-muted-foreground">חלון</dt>
          <dd>
            {fmtDate(campaign.start_at)} – {fmtDate(campaign.close_at)}
          </dd>
        </dl>
        <p className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">
          חיוב רק על איש קשר שהושג (תגובה אנושית), פעם אחת לכל איש קשר, עד התקרה.
        </p>
        <AgreementSheet html={agreementHtml} />
      </section>

      {profile?.phone ? (
        <SignAgreementForm
          eventId={id}
          campaignId={campaignId}
          signerName={profile.full_name?.trim() || 'לקוח KALFA'}
          phone={profile.phone}
        />
      ) : (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          כדי לחתום נדרש מספר טלפון בפרופיל (לאימות בקוד חד‑פעמי). הוסיפו טלפון
          ב{' '}
          <a href="/app/settings" className="underline">
            הגדרות החשבון
          </a>
          .
        </p>
      )}
    </div>
  );
}
