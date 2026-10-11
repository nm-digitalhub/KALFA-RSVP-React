import 'server-only';

import { randomUUID } from 'node:crypto';

import { requireUser } from '@/lib/auth/dal';
import { fillAuthorizedSet } from '@/lib/data/authorized-fill';
import { approveCampaign } from '@/lib/data/campaigns';
import { getCompanyLegal } from '@/lib/data/company';
import { requireOwnedEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import { getProfile } from '@/lib/data/profiles';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderAgreementDocument } from '@/lib/agreements/template';
import { getApprovedPackageAgreementDoc } from '@/lib/data/agreements-doc';
import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import { agreementContent } from '@/lib/agreements/content';
import { renderAgreementPdf, sha256Hex } from '@/lib/agreements/pdf';
import { uploadLegalDoc } from '@/lib/storage/legal-docs';
import { getEmailSender } from '@/lib/email/sender';
import { agreementEmail } from '@/lib/email/templates';
import { getAppUrl } from '@/lib/url';
import { formatIsraelDate } from '@/lib/date';
import { sendSlackAlert } from '@/lib/alerts/slack';

// The package-terms approval: render the full Hebrew terms PDF, hash it, store it in the private bucket, persist an
// evidentiary signed_agreements row (IP, user-agent, content hash), then transition the campaign to approved.

export type RecordAgreementResult =
  | { ok: true }
  | { ok: false; error: string };

// Everything that follows a recorded, approved agreement: sales-conversion tracking, the ops alert, and the customer's
// copy by e-mail (§14ג(ב)). All best-effort: the approval
// is already stored and committed, and none of this may undo it.
async function afterApproval(ctx: {
  userId: string;
  userEmail: string | null | undefined;
  campaignId: string;
  eventId: string;
  eventName: string;
  companyName: string;
  signerName: string;
  agreementVersion: string;
}): Promise<void> {
  // Sales-closing-agent conversion tracking (owner decision 2026-08-22):
  // "signup completed" for that tracking means THIS moment — approved
  // package terms — not bare account creation. Best-effort, never
  // blocks the (already-committed) approval: a missed write here only
  // degrades a reporting number, never the agreement itself. Claimed only
  // once (signup_completed_at IS NULL) so a later approval on a different
  // campaign never overwrites the first real conversion moment.
  try {
    const admin = createAdminClient();
    const { data: signerProfile } = await admin
      .from('profiles')
      .select('sales_referral_attempt_id')
      .eq('id', ctx.userId)
      .maybeSingle();
    if (signerProfile?.sales_referral_attempt_id) {
      await admin
        .from('sales_call_attempts')
        .update({ signup_completed_at: new Date().toISOString() })
        .eq('id', signerProfile.sales_referral_attempt_id)
        .is('signup_completed_at', null);
    }
  } catch (err) {
    // Best-effort — see comment above. Still worth a trace: without this, a
    // real failure here would be undiagnosable.
    console.error('[agreement] sales-conversion tracking write failed', {
      campaignId: ctx.campaignId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Additive ops alert (fire-and-forget, fail-safe): non-PII ids + version only
  // (no approver name or IP). Does not affect the approval or the
  // best-effort receipt email below.
  void sendSlackAlert({
    level: 'info',
    category: 'campaign_billing',
    source: 'agreement',
    title: 'תנאי חבילה אושרו',
    fields: {
      campaign_id: ctx.campaignId,
      event_id: ctx.eventId,
      agreement_version: ctx.agreementVersion,
    },
  });

  // §14ג(ב): email the customer a link to the PDF. Best-effort — the agreement
  // is already stored and approved; a transient SMTP failure must not void a
  // completed approval. (A retry/queue can be added later.)
  if (ctx.userEmail) {
    try {
      const downloadUrl = await getAppUrl(
        `/app/events/${ctx.eventId}/campaign/${ctx.campaignId}/agreement`,
      );
      const sender = await getEmailSender();
      const { subject, html, text } = (await agreementEmail({
        signerName: ctx.signerName,
        eventName: ctx.eventName,
        companyName: ctx.companyName,
        downloadUrl,
      }));
      // Link, not attachment — avoids recipient attachment scanners flagging it.
      await sender.send({ to: ctx.userEmail, subject, html, text });
    } catch (err) {
      // best-effort; the approval PDF remains stored and retrievable.
      // Still worth a trace — see the sales-tracking catch above. The deeper
      // provider-specific reason (Resend/SMTP) is already logged inside
      // getEmailSender()'s sender; this records WHICH step failed (config,
      // URL, template render, or send) with campaign context — never the
      // signer's name/phone/email.
      console.error('[agreement] receipt email failed', {
        campaignId: ctx.campaignId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export type RecordPackageApprovalInput = {
  campaignId: string;
  // The version of the terms the customer was SHOWN. The server compares it with the active document, so terms that
  // changed between reading and approving are never approved unseen.
  termsVersion: string;
  ip: string | null;
  userAgent: string | null;
};

// The package terms are approved, not signed: the customer reads the terms and ticks the box. What is recorded is the
// evidence trail — who (the logged-in user), when, from which address and browser, which version, and the hash of the exact document (a PDF with an approval
// block, stored privately; the customer is sent a copy). The row goes in signed_agreements, which the archive export and
// the download link read.
export async function recordPackageApproval(
  input: RecordPackageApprovalInput,
): Promise<RecordAgreementResult> {
  const user = await requireUser();
  const admin = createAdminClient();

  const profile = await getProfile();
  const signerName = profile?.full_name?.trim() || user.email || 'לקוח KALFA';

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select(
      'id, event_id, status, package_price, contact_quota, allowed_channels, start_at, close_at',
    )
    .eq('id', input.campaignId)
    .maybeSingle();
  if (error) return { ok: false, error: 'טעינת הקמפיין נכשלה' };
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }
  if (campaign.status !== 'pending_approval') {
    return { ok: false, error: 'ניתן לאשר רק קמפיין הממתין לאישור' };
  }
  if (campaign.package_price == null || campaign.contact_quota == null) {
    return { ok: false, error: 'תנאי הקמפיין חסרים' };
  }

  // Ownership, then the early rejections (before anything is rendered or stored).
  const event = await requireOwnedEvent(campaign.event_id);
  if (isPastEventDay(event.event_date)) {
    return { ok: false, error: 'האירוע כבר חלף — לא ניתן לאשר תנאים לאירוע שמועדו עבר' };
  }
  if (event.status !== 'active') {
    return {
      ok: false,
      error: 'פרטי האירוע טרם אושרו — לא ניתן לאשר את התנאים לפני אישור הפרטים',
    };
  }

  // The package contract is read server-side: the admin-approved document, and the one the customer was shown.
  const agreementDoc = await getApprovedPackageAgreementDoc();
  if (!agreementDoc) {
    return { ok: false, error: 'הסכם החבילה טרם הופעל — פנו לתמיכה' };
  }
  if (input.termsVersion !== agreementDoc.version) {
    return { ok: false, error: 'נוסח התנאים עודכן. קראו שוב ואשרו.' };
  }

  const [company, configTokens] = await Promise.all([
    getCompanyLegal(),
    getAgreementConfigTokens(),
  ]);
  const html = renderAgreementDocument(
    agreementContent(company, event.name, {
      channels: campaign.allowed_channels,
      startAt: campaign.start_at,
      closeAt: campaign.close_at,
      packagePrice: campaign.package_price,
      contactQuota: campaign.contact_quota,
    }),
    {
      approverName: signerName,
      approvedDateText: formatIsraelDate(Date.now()),
      ip: input.ip,
    },
    agreementDoc,
    configTokens,
  );
  const pdfBytes = await renderAgreementPdf(html);
  const contentHash = sha256Hex(pdfBytes);

  const pdfPath = `${campaign.event_id}/${campaign.id}/agreement-${randomUUID()}.pdf`;
  await uploadLegalDoc(pdfPath, pdfBytes, 'application/pdf');

  const { error: insErr } = await admin.from('signed_agreements').insert({
    campaign_id: campaign.id,
    event_id: campaign.event_id,
    signer_user_id: user.id,
    agreement_version: agreementDoc.version,
    ip: input.ip,
    user_agent: input.userAgent,
    signature_ref: null,
    content_hash: contentHash,
    pdf_ref: pdfPath,
    verified_phone: null,
    otp_verified_at: null,
  });
  if (insErr) return { ok: false, error: 'שמירת האישור נכשלה' };

  // Lock the campaign as approved (status-guarded, race-safe) with the version actually shown.
  await approveCampaign(campaign.id, agreementDoc.version);

  // The list every send reads is empty until something fills it. This is the only fill of the guests added BEFORE the
  // approval, in order of addition; a guest added after it is admitted by reconcileCampaignSetForContact (contacts.ts)
  // up to the package quota. Best-effort: the approval is recorded and must not be undone by this.
  try {
    await fillAuthorizedSet(campaign.event_id, campaign.id, 'package_approval');
  } catch (err) {
    console.error('[package-approval] first fill failed (non-fatal; the approval stands)', {
      campaignId: campaign.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await afterApproval({
    userId: user.id,
    userEmail: user.email,
    campaignId: campaign.id,
    eventId: campaign.event_id,
    eventName: event.name,
    companyName: company.name,
    signerName,
    agreementVersion: agreementDoc.version,
  });

  return { ok: true };
}
