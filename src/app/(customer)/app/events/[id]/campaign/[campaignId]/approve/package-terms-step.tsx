import { agreementContent, fmtAgreementDate } from '@/lib/agreements/content';
import { renderAgreementBody, AGREEMENT_CSS, CHANNEL_LABELS } from '@/lib/agreements/template';
import type { OwnerCampaign } from '@/lib/data/campaigns';
import type { OwnedEvent } from '@/lib/data/events';
import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import { getApprovedPackageAgreementDoc } from '@/lib/data/agreements-doc';
import { getCompanyLegal } from '@/lib/data/company';
import { isPastEventDay } from '@/lib/data/event-date';
import { formatAmount } from '@/lib/format';

import { approvePackageTermsAction } from '../../campaign-actions';
import { AgreementSheet } from './agreement-sheet';
import { ApprovePackageTermsForm } from './approve-package-terms-form';

// The setup flow's "אישור תנאי החבילה" step for a fixed-price package campaign: the key terms, the full terms in a
// sheet, and the two-box approval. It replaces the signing step (AgreementStep) for this model — there is no signature
// and no phone code. The caller has already proven ownership and that the campaign is waiting for approval.
//
// Every figure comes from the campaign SNAPSHOT (never the live package), so the summary can never disagree with the
// document that is recorded. No approval is offered unless the package contract is approved by the admin.

const NOTICE = 'rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning';

export async function PackageTermsStep({
  eventId,
  campaign,
  event,
}: {
  eventId: string;
  campaign: OwnerCampaign;
  event: Pick<OwnedEvent, 'name' | 'event_date'>;
}) {
  const [company, doc, configTokens] = await Promise.all([
    getCompanyLegal(),
    getApprovedPackageAgreementDoc(),
    getAgreementConfigTokens(),
  ]);

  if (campaign.package_price == null || campaign.contact_quota == null || !doc) {
    return (
      <p role="status" className={NOTICE}>
        תנאי החבילה אינם זמינים לאישור כעת — פנו לתמיכה.
      </p>
    );
  }

  const termsHtml = renderAgreementBody(
    agreementContent(company, event.name, {
      pricePerReached: 0,
      maxContacts: campaign.max_contacts ?? 0,
      ceiling: 0,
      channels: campaign.allowed_channels,
      startAt: campaign.start_at,
      closeAt: campaign.close_at,
      baseFee: 0,
      includedReached: 0,
      packagePrice: campaign.package_price,
      contactQuota: campaign.contact_quota,
    }),
    doc,
    configTokens,
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        אלו עיקרי התנאים. קראו את התנאים המלאים לפני האישור. האישור נעשה בסימון התיבות, והתשלום בשלב הבא.
      </p>

      {/* Global CSS for the terms — styles the (portaled) sheet content too. */}
      <style dangerouslySetInnerHTML={{ __html: AGREEMENT_CSS }} />

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
        <h2 className="font-semibold">עיקרי התנאים</h2>
        <dl className="grid grid-cols-1 gap-y-1 sm:grid-cols-2 sm:gap-y-1.5">
          <dt className="text-muted-foreground">מחיר החבילה</dt>
          <dd>
            <strong>{formatAmount(campaign.package_price)}</strong> — תשלום אחד, מחיר סופי; לא נגבה מע״מ
          </dd>
          <dt className="text-muted-foreground">מכסת אנשי קשר</dt>
          <dd>עד {campaign.contact_quota.toLocaleString('he-IL')} אנשי קשר</dd>
          <dt className="text-muted-foreground">ערוצים</dt>
          <dd>{campaign.allowed_channels.map((c) => CHANNEL_LABELS[c] ?? c).join(', ')}</dd>
          <dt className="text-muted-foreground">חלון</dt>
          <dd>
            {fmtAgreementDate(campaign.start_at)} – {fmtAgreementDate(campaign.close_at)}
          </dd>
        </dl>
        <p className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">
          המחיר קבוע ואינו תלוי במספר אנשי הקשר שהשיבו. אנשי קשר מעבר למכסה ממתינים ואינם מקבלים פנייה.
        </p>
        <AgreementSheet html={termsHtml} />
      </section>

      {isPastEventDay(event.event_date) ? (
        <p className={NOTICE}>מועד האירוע כבר חלף — לא ניתן לאשר תנאים ולהפעיל אישורי הגעה לאירוע שעבר.</p>
      ) : (
        <ApprovePackageTermsForm
          action={approvePackageTermsAction.bind(null, eventId, campaign.id)}
          termsVersion={doc.version}
        />
      )}
    </div>
  );
}
