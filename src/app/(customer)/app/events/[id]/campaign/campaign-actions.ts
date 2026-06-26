'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requireUser } from '@/lib/auth/dal';
import { createCampaign } from '@/lib/data/campaigns';
import { recordSignedAgreement } from '@/lib/data/agreements';
import { getProfile } from '@/lib/data/profiles';
import { requestOtp } from '@/lib/data/otp';
import { AGREEMENT_VERSION } from '@/lib/agreements/template';
import {
  campaignTermsSchema,
  approveCampaignSchema,
} from '@/lib/validation/campaigns';
import type { FormState } from '@/lib/validation/result';

const OTP_PURPOSE = 'agreement_signing';

// Re-throw Next.js control-flow signals (redirect/notFound) so catching domain
// errors does not swallow them.
function isNextSignal(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    ((err as { digest: string }).digest.startsWith('NEXT_REDIRECT') ||
      (err as { digest: string }).digest === 'NEXT_NOT_FOUND')
  );
}

// eventId is bound on the client (createCampaignAction.bind(null, eventId)).
export async function createCampaignAction(
  eventId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = campaignTermsSchema.safeParse({
    template_id: formData.get('template_id'),
    start_at: formData.get('start_at') || undefined,
    close_at: formData.get('close_at') || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  let created: Awaited<ReturnType<typeof createCampaign>>;
  try {
    created = await createCampaign(eventId, parsed.data);
  } catch (err) {
    if (isNextSignal(err)) throw err;
    return { error: 'יצירת הקמפיין נכשלה. נסו שוב.' };
  }

  revalidatePath(`/app/events/${eventId}/campaign`);
  redirect(`/app/events/${eventId}/campaign/${created.id}/approve`);
}

// Step 1 of signing: send an OTP to the signer's phone (identity verification).
// Authenticated owner only; rate-limited inside requestOtp.
export async function requestSigningOtpAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _formData;
  let phone: string | null;
  try {
    await requireUser();
    const profile = await getProfile();
    phone = profile?.phone ?? null;
  } catch (err) {
    if (isNextSignal(err)) throw err;
    return { error: 'נדרשת התחברות.' };
  }

  if (!phone) {
    return { error: 'לא נמצא מספר טלפון בפרופיל. עדכנו טלפון בהגדרות החשבון.' };
  }
  const res = await requestOtp(phone, OTP_PURPOSE);
  if (!res.ok) {
    return { error: res.error ?? 'שליחת קוד האימות נכשלה.' };
  }
  return { notice: 'קוד אימות נשלח בהודעת SMS לטלפון שבפרופיל.' };
}

// Step 2: verify OTP + sign the agreement + record consents, then approve the
// campaign. eventId and campaignId are bound on the client. Sensitive — the
// signature and code are never logged here.
export async function signAgreementAction(
  eventId: string,
  campaignId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  // Consents (the three explicit affirmations). tos_version is set server-side
  // to the rendered agreement version — never trusted from the client.
  const consents = approveCampaignSchema.safeParse({
    campaign_id: campaignId,
    tos_version: AGREEMENT_VERSION,
    terms_accepted: formData.get('terms_accepted') === 'on',
    privacy_accepted: formData.get('privacy_accepted') === 'on',
    authorization_accepted: formData.get('authorization_accepted') === 'on',
  });
  if (!consents.success) {
    return { fieldErrors: consents.error.flatten().fieldErrors };
  }

  const signature = String(formData.get('signature') ?? '');
  if (!signature.startsWith('data:image/')) {
    return { fieldErrors: { signature: ['יש לחתום בתיבת החתימה'] } };
  }

  const otpCode = String(formData.get('otp_code') ?? '').trim();
  if (!/^\d{6}$/.test(otpCode)) {
    return { fieldErrors: { otp_code: ['יש להזין את קוד האימות (6 ספרות)'] } };
  }

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = h.get('user-agent');

  // signerName + phone are derived server-side from the profile in
  // recordSignedAgreement — never from the client.
  let result: Awaited<ReturnType<typeof recordSignedAgreement>>;
  try {
    result = await recordSignedAgreement({
      campaignId,
      otpCode,
      signatureDataUrl: signature,
      tosVersion: AGREEMENT_VERSION,
      ip,
      userAgent,
    });
  } catch (err) {
    if (isNextSignal(err)) throw err;
    return { error: 'שמירת ההסכם נכשלה. נסו שוב.' };
  }
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath(`/app/events/${eventId}/campaign`);
  // Route A: after signing, proceed to the card-capture (payment-method) step.
  redirect(`/app/events/${eventId}/campaign/${campaignId}/payment`);
}
