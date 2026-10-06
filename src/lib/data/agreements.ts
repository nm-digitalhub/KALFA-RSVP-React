import 'server-only';

import { randomUUID } from 'node:crypto';

import { requireUser } from '@/lib/auth/dal';
import { fillAuthorizedSet } from '@/lib/data/authorized-fill';
import { approveCampaign } from '@/lib/data/campaigns';
import { getCompanyLegal } from '@/lib/data/company';
import { requireOwnedEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import { getProfile } from '@/lib/data/profiles';
import { verifyOtp } from '@/lib/data/otp';
import { normalizePhone } from '@/lib/phone';
import { createAdminClient } from '@/lib/supabase/admin';
import { isPackageAgreementVersion, renderAgreementDocument } from '@/lib/agreements/template';
import { getActiveAgreementDoc, getApprovedPackageAgreementDoc } from '@/lib/data/agreements-doc';
import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import { agreementContent } from '@/lib/agreements/content';
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

function dataUrlToBytes(dataUrl: string): {
  bytes: Uint8Array;
  contentType: string;
} | null {
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { contentType: m[1], bytes: new Uint8Array(Buffer.from(m[2], 'base64')) };
}

// Everything that follows a recorded, approved agreement — the same for a signature and for a package approval:
// sales-conversion tracking, the ops alert, and the customer's copy by e-mail (§14ג(ב)). All best-effort: the approval
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
  kind: 'signed' | 'approved';
}): Promise<void> {
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
  // (no signer name/phone/IP/signature). Does not affect the approval or the
  // best-effort receipt email below.
  void sendSlackAlert({
    level: 'info',
    category: 'campaign_billing',
    source: 'agreement',
    title: ctx.kind === 'approved' ? 'תנאי חבילה אושרו' : 'הסכם קמפיין נחתם ואושר',
    fields: {
      campaign_id: ctx.campaignId,
      event_id: ctx.eventId,
      agreement_version: ctx.agreementVersion,
    },
  });

  // §14ג(ב): email the customer a link to the PDF. Best-effort — the agreement
  // is already stored and approved; a transient SMTP failure must not void a
  // completed signing. (A retry/queue can be added later.)
  if (ctx.userEmail) {
    try {
      const downloadUrl = await getAppUrl(
        `/app/events/${ctx.eventId}/campaign/${ctx.campaignId}/agreement`,
      );
      const sender = await getEmailSender();
      const { subject, html, text } = agreementEmail({
        signerName: ctx.signerName,
        eventName: ctx.eventName,
        companyName: ctx.companyName,
        downloadUrl,
        kind: ctx.kind,
      });
      // Link, not attachment — avoids recipient attachment scanners flagging it.
      await sender.send({ to: ctx.userEmail, subject, html, text });
    } catch (err) {
      // best-effort; the signed agreement remains stored and retrievable.
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
      'id, event_id, status, package_price, price_per_reached, max_contacts, max_charge_ceiling, base_price, included_reached, allowed_channels, start_at, close_at',
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
  // A fixed-price package is APPROVED by the customer ticking the box (recordPackageApproval), never signed: no drawn
  // signature, no phone code. Refused here whichever contract is active, before any code is burned.
  if (campaign.package_price != null) {
    return { ok: false, error: 'קמפיין חבילה מאושר באישור התנאים ולא בחתימה' };
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

  // The contract must be the one for the campaign's pricing model: a fixed-price package campaign is signed under the
  // package contract, a pay-per-result campaign under the pay-per-result one (close-charge follows the SIGNED version,
  // and the two contracts state different prices). Checked here — before the OTP is burned and before anything is
  // rendered or stored; approveCampaign enforces the same rule as the final guard. The active document is read
  // server-side, never taken from the client.
  const agreementDoc = await getActiveAgreementDoc();
  if (isPackageAgreementVersion(agreementDoc.version) !== (campaign.package_price != null)) {
    return {
      ok: false,
      error: 'ההסכם הפעיל אינו מתאים למודל התמחור של הקמפיין — פנו לתמיכה',
    };
  }

  const otpOk = await verifyOtp(e164, OTP_PURPOSE, input.otpCode);
  if (!otpOk) {
    return { ok: false, error: 'קוד האימות שגוי או שפג תוקפו. שלחו קוד חדש.' };
  }
  const otpVerifiedAt = new Date().toISOString();

  // Build the exact document → PDF → hash. The active agreement document
  // (version/status/optional custom body) was read server-side above — never
  // trusted from the client — so the recorded version matches what is actually
  // rendered. Admin-config tokens (raw strings) let a custom agreement body
  // reference the configured service/charge/hold/liability/retention values;
  // rendered version must match what is signed, so the company details and the
  // tokens are read server-side too.
  const [company, configTokens] = await Promise.all([
    getCompanyLegal(),
    getAgreementConfigTokens(),
  ]);
  const html = renderAgreementDocument(
    agreementContent(company, event.name, {
      pricePerReached: campaign.price_per_reached,
      maxContacts: campaign.max_contacts,
      ceiling: campaign.max_charge_ceiling,
      channels: campaign.allowed_channels,
      startAt: campaign.start_at,
      closeAt: campaign.close_at,
      baseFee: campaign.base_price ?? 0,
      includedReached: campaign.included_reached ?? 0,
    }),
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

  // Evidentiary record (service-role only — RLS denies every authenticated client). Refs + hash + verified phone, not bytes.
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

  await afterApproval({
    userId: user.id,
    userEmail: user.email,
    campaignId: campaign.id,
    eventId: campaign.event_id,
    eventName: event.name,
    companyName: company.name,
    signerName,
    agreementVersion: agreementDoc.version,
    kind: 'signed',
  });

  return { ok: true };
}

export type RecordPackageApprovalInput = {
  campaignId: string;
  // The version of the terms the customer was SHOWN. The server compares it with the active document, so terms that
  // changed between reading and approving are never approved unseen.
  termsVersion: string;
  ip: string | null;
  userAgent: string | null;
};

// The fixed-price package is approved, not signed: the customer reads the terms and ticks the box. No drawn signature
// and no phone code. What is recorded is the same evidence trail as a signature minus those two — who (the logged-in
// user), when, from which address and browser, which version, and the hash of the exact document (a PDF with an approval
// block, stored privately; the customer is sent a copy). The row goes in signed_agreements, so the rest of the system
// that reads the signed version (close-charge, the archive export, the download link) works unchanged.
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
      'id, event_id, status, package_price, contact_quota, max_contacts, allowed_channels, start_at, close_at',
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
  if (campaign.package_price == null) {
    return { ok: false, error: 'קמפיין זה נחתם בחתימה ואינו מאושר באישור תנאים' };
  }
  if (campaign.contact_quota == null) {
    return { ok: false, error: 'תנאי הקמפיין חסרים' };
  }

  // Ownership, then the same early rejections as the signature (before anything is rendered or stored).
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
      // A package campaign carries no per-reached formula (it snapshots 0): the contract quotes only the package.
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
    {
      signerName,
      verifiedPhone: null,
      signedDateText: formatIsraelDate(Date.now()),
      ip: input.ip,
      signatureDataUrl: null,
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

  // The list every send reads is empty until something fills it. Filling it HERE (and again at activation) keeps the
  // places in order of addition: otherwise a guest added after the approval would take the first place of an empty
  // list ahead of everyone who was added earlier. Best-effort: the approval is recorded and must not be undone by this.
  try {
    await fillAuthorizedSet(campaign.event_id, campaign.id, 'package_approval');
  } catch (err) {
    console.error('[package-approval] first fill failed (non-fatal; activation fills again)', {
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
    kind: 'approved',
  });

  return { ok: true };
}
