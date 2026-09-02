import 'server-only';

import { randomUUID } from 'node:crypto';

import { requireUser } from '@/lib/auth/dal';
import { approveCampaign } from '@/lib/data/campaigns';
import { getCompanyLegal } from '@/lib/data/company';
import { requireOwnedEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import { getProfile } from '@/lib/data/profiles';
import { verifyOtp } from '@/lib/data/otp';
import { normalizePhone } from '@/lib/phone';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderAgreementDocument } from '@/lib/agreements/template';
import { getActiveAgreementDoc } from '@/lib/data/agreements-doc';
import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import { renderAgreementPdf, sha256Hex } from '@/lib/agreements/pdf';
import { uploadLegalDoc } from '@/lib/storage/legal-docs';
import { getEmailSender } from '@/lib/email/sender';
import { agreementEmail } from '@/lib/email/templates';
import { getAppUrl } from '@/lib/url';
import { formatIsraelDate } from '@/lib/date';
import { sendSlackAlert } from '@/lib/alerts/slack';

// Orchestrates the signed-agreement step of campaign approval: verify the phone
// OTP (identity), render the full Hebrew PDF, hash it, store the PDF + signature
// in the private bucket, persist an evidentiary signed_agreements row (incl. the
// verified phone, IP, user-agent, content hash), then transition the campaign to
// approved. Identity is via OTP — no ID photo. Never log the code/signature.

const OTP_PURPOSE = 'agreement_signing';

export type RecordAgreementInput = {
  campaignId: string;
  otpCode: string; // the code the signer entered
  signatureDataUrl: string; // "data:image/png;base64,…" from signature_pad
  tosVersion: string;
  ip: string | null;
  userAgent: string | null;
};

export type RecordAgreementResult =
  | { ok: true }
  | { ok: false; error: string };

function fmtDate(iso: string | null): string {
  if (!iso) return 'לא הוגדר';
  return formatIsraelDate(iso) || 'לא הוגדר';
}

function dataUrlToBytes(dataUrl: string): {
  bytes: Uint8Array;
  contentType: string;
} | null {
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { contentType: m[1], bytes: new Uint8Array(Buffer.from(m[2], 'base64')) };
}

// Read the agreement version the customer actually signed for a campaign (the
// latest signature, by signed_at). The close-charge D5 guard uses this to bind
// the base-fee charge to the signed contract. Returns null when nothing was
// signed (→ the guard treats it as not-base-fee, the safe default).
export async function getSignedAgreementVersion(
  campaignId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('signed_agreements')
    .select('agreement_version')
    .eq('campaign_id', campaignId)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // THROW on a real DB error — never let it collapse into the same null as
  // "no signature": the close-charge D5 guard routes a thrown read to
  // charge_review, so a transient glitch can't terminally suppress a legit
  // v4 signer's base (mirrors the summary/credit read guards).
  if (error) throw new Error('קריאת גרסת ההסכם החתום נכשלה');
  return (data?.agreement_version as string | undefined) ?? null;
}

export async function recordSignedAgreement(
  input: RecordAgreementInput,
): Promise<RecordAgreementResult> {
  const user = await requireUser();
  const admin = createAdminClient();

  // Identity comes from the authenticated user's PROFILE — never client input.
  const profile = await getProfile();
  const signerName = profile?.full_name?.trim() || user.email || 'לקוח KALFA';
  const e164 = normalizePhone(profile?.phone);
  if (!e164) {
    return {
      ok: false,
      error: 'לא נמצא מספר טלפון תקין בפרופיל. עדכנו מספר טלפון בהגדרות החשבון.',
    };
  }

  const sig = dataUrlToBytes(input.signatureDataUrl);
  if (!sig) return { ok: false, error: 'חתימה לא תקינה' };

  // Read campaign terms + guard status.
  const { data: campaign, error } = await admin
    .from('campaigns')
    .select(
      'id, event_id, status, price_per_reached, max_contacts, max_charge_ceiling, base_price, included_reached, allowed_channels, start_at, close_at',
    )
    .eq('id', input.campaignId)
    .maybeSingle();
  if (error) return { ok: false, error: 'טעינת הקמפיין נכשלה' };
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }
  if (campaign.status !== 'pending_approval') {
    return { ok: false, error: 'ניתן לחתום רק על קמפיין הממתין לאישור' };
  }
  if (
    campaign.price_per_reached == null ||
    campaign.max_contacts == null ||
    campaign.max_charge_ceiling == null
  ) {
    return { ok: false, error: 'תנאי הקמפיין חסרים' };
  }

  // Ownership (also yields the event name) + identity (OTP).
  const event = await requireOwnedEvent(campaign.event_id);

  // L1: reject a past event BEFORE burning the OTP / rendering the PDF / writing a
  // signed_agreements row (the later approveCampaign would also reject it, but
  // only after all that side-effecting work).
  if (isPastEventDay(event.event_date)) {
    return {
      ok: false,
      error: 'האירוע כבר חלף — לא ניתן לחתום על הסכם לאירוע שמועדו עבר',
    };
  }
  // R9: every commercial campaign action requires event.status='active'. Same
  // early-reject placement as the past-event guard above (approveCampaign at
  // the end of this function would also reject it, but only after the OTP/PDF
  // work already ran).
  if (event.status !== 'active') {
    return {
      ok: false,
      error: 'פרטי האירוע טרם אושרו — לא ניתן לחתום על ההסכם לפני אישור הפרטים',
    };
  }

  const otpOk = await verifyOtp(e164, OTP_PURPOSE, input.otpCode);
  if (!otpOk) {
    return { ok: false, error: 'קוד האימות שגוי או שפג תוקפו. שלחו קוד חדש.' };
  }
  const otpVerifiedAt = new Date().toISOString();

  // Build the exact document → PDF → hash. The active agreement document
  // (version/status/optional custom body) is read server-side — never trusted
  // from the client — so the recorded version matches what is actually rendered.
  // Admin-config tokens (raw strings) let a custom agreement body reference the
  // configured service/charge/hold/liability/retention values; rendered version
  // must match what is signed, so all three are read server-side together.
  const [company, agreementDoc, configTokens] = await Promise.all([
    getCompanyLegal(),
    getActiveAgreementDoc(),
    getAgreementConfigTokens(),
  ]);
  const html = renderAgreementDocument(
    {
      company: {
        name: company.name,
        id: company.id,
        address: company.address,
        contactPhone: company.contactPhone,
        contactEmail: company.contactEmail,
        privacyUrl: company.privacyUrl,
        termsUrl: company.termsUrl,
        warrantyText: company.warrantyText,
      },
      eventName: event.name,
      pricePerReached: campaign.price_per_reached,
      maxContacts: campaign.max_contacts,
      ceiling: campaign.max_charge_ceiling,
      channels: campaign.allowed_channels,
      windowText: `${fmtDate(campaign.start_at)} – ${fmtDate(campaign.close_at)}`,
      baseFee: campaign.base_price ?? 0,
      includedReached: campaign.included_reached ?? 0,
    },
    {
      signerName,
      verifiedPhone: e164,
      signedDateText: formatIsraelDate(Date.now()),
      ip: input.ip,
      signatureDataUrl: input.signatureDataUrl,
    },
    agreementDoc,
    configTokens,
  );
  const pdfBytes = await renderAgreementPdf(html);
  const contentHash = sha256Hex(pdfBytes);

  // Store artifacts (private bucket, service-role) under an event/campaign path.
  const base = `${campaign.event_id}/${campaign.id}`;
  const uuid = randomUUID();
  const sigPath = `${base}/signature-${uuid}.png`;
  const pdfPath = `${base}/agreement-${uuid}.pdf`;
  await uploadLegalDoc(sigPath, sig.bytes, sig.contentType);
  await uploadLegalDoc(pdfPath, pdfBytes, 'application/pdf');

  // Evidentiary record (admin-only RLS). Refs + hash + verified phone, not bytes.
  const { error: insErr } = await admin.from('signed_agreements').insert({
    campaign_id: campaign.id,
    event_id: campaign.event_id,
    signer_user_id: user.id,
    agreement_version: agreementDoc.version,
    ip: input.ip,
    user_agent: input.userAgent,
    signature_ref: sigPath,
    content_hash: contentHash,
    pdf_ref: pdfPath,
    verified_phone: e164,
    otp_verified_at: otpVerifiedAt,
  });
  if (insErr) return { ok: false, error: 'שמירת ההסכם החתום נכשלה' };

  // Lock the campaign as approved (status-guarded, race-safe). The version is
  // the server-read active document's version (not the client-supplied one).
  await approveCampaign(campaign.id, agreementDoc.version);

  // Sales-closing-agent conversion tracking (owner decision 2026-08-22):
  // "signup completed" for that tracking means THIS moment — a signed,
  // approved agreement — not bare account creation. Best-effort, never
  // blocks the (already-committed) approval: a missed write here only
  // degrades a reporting number, never the agreement itself. Claimed only
  // once (signup_completed_at IS NULL) so a later re-sign on a different
  // campaign never overwrites the first real conversion moment.
  try {
    const admin = createAdminClient();
    const { data: signerProfile } = await admin
      .from('profiles')
      .select('sales_referral_attempt_id')
      .eq('id', user.id)
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
    // real failure here was previously undiagnosable (the same blind spot
    // fixed for the campaign-hold path on 2026-08-30).
    console.error('[agreement] sales-conversion tracking write failed', {
      campaignId: campaign.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Additive ops alert (fire-and-forget, fail-safe): non-PII ids + version only
  // (no signer name/phone/IP/signature). Does not affect the approval or the
  // best-effort receipt email below.
  void sendSlackAlert({
    level: 'info',
    category: 'campaign_billing',
    source: 'agreement',
    title: 'הסכם קמפיין נחתם ואושר',
    fields: {
      campaign_id: campaign.id,
      event_id: campaign.event_id,
      agreement_version: agreementDoc.version,
    },
  });

  // §14ג(ב): email the signed PDF to the customer. Best-effort — the agreement
  // is already stored and approved; a transient SMTP failure must not void a
  // completed signing. (A retry/queue can be added later.)
  if (user.email) {
    try {
      const downloadUrl = await getAppUrl(
        `/app/events/${campaign.event_id}/campaign/${campaign.id}/agreement`,
      );
      const sender = await getEmailSender();
      const { subject, html, text } = agreementEmail({
        signerName,
        eventName: event.name,
        companyName: company.name,
        downloadUrl,
      });
      // Link, not attachment — avoids recipient attachment scanners flagging it.
      await sender.send({ to: user.email, subject, html, text });
    } catch (err) {
      // best-effort; the signed agreement remains stored and retrievable.
      // Still worth a trace — see the sales-tracking catch above. The deeper
      // provider-specific reason (Resend/SMTP) is already logged inside
      // getEmailSender()'s sender; this records WHICH step failed (config,
      // URL, template render, or send) with campaign context — never the
      // signer's name/phone/email.
      console.error('[agreement] receipt email failed', {
        campaignId: campaign.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true };
}
