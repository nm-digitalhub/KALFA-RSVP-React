import 'server-only';

import { randomUUID } from 'node:crypto';

import { requireUser } from '@/lib/auth/dal';
import { approveCampaign } from '@/lib/data/campaigns';
import { getCompanyLegal } from '@/lib/data/company';
import { requireOwnedEvent } from '@/lib/data/events';
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
  return new Date(iso).toLocaleDateString('he-IL');
}

function dataUrlToBytes(dataUrl: string): {
  bytes: Uint8Array;
  contentType: string;
} | null {
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { contentType: m[1], bytes: new Uint8Array(Buffer.from(m[2], 'base64')) };
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
      'id, event_id, status, price_per_reached, max_contacts, max_charge_ceiling, allowed_channels, start_at, close_at',
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
    },
    {
      signerName,
      verifiedPhone: e164,
      signedDateText: new Date().toLocaleDateString('he-IL'),
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

  // §14ג(ב): email the signed PDF to the customer. Best-effort — the agreement
  // is already stored and approved; a transient SMTP failure must not void a
  // completed signing. (A retry/queue can be added later.)
  if (user.email) {
    try {
      const origin = process.env.APP_ORIGIN ?? '';
      const downloadUrl = `${origin}/app/events/${campaign.event_id}/campaign/${campaign.id}/agreement`;
      const sender = await getEmailSender();
      const { subject, html, text } = agreementEmail({
        signerName,
        eventName: event.name,
        companyName: company.name,
        downloadUrl,
      });
      // Link, not attachment — avoids recipient attachment scanners flagging it.
      await sender.send({ to: user.email, subject, html, text });
    } catch {
      // best-effort; the signed agreement remains stored and retrievable.
    }
  }

  return { ok: true };
}
