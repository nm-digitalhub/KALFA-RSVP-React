'use server';

// Server Action for the agreement-config section of the /admin/agreement page.
// Validates the 7 values with an inline Zod schema (all trimmed strings — these
// are free-form config the agreement reads live, so coercion is intentionally
// avoided here) and writes them to the singleton app_settings row.
//
// Authorization: requireAdmin() gates the write, and the write goes through the
// request-scoped cookie session client (createClient) — NOT the service-role
// client — so the app_settings_admin_all RLS policy still applies. This mirrors
// updateCompanySettings()/updateAppSettings(), which write the same row the same
// way; RLS is kept as a defence-in-depth layer rather than being bypassed.
//
// camelCase form keys (matching the getAgreementConfigForAdmin() prop shape) are
// mapped to the snake_case agr_* columns on save.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import type { FormState } from '@/lib/validation/result';

// The app_settings singleton is keyed by a constant boolean id (see
// src/lib/data/admin/settings.ts).
const SETTINGS_ID = true;

// All 7 values are trimmed strings. Empty is allowed (an intentional unset →
// stored as NULL below), matching the company/app-settings save behaviour.
const agreementConfigSchema = z.object({
  serviceActivationWindow: z.string().trim(),
  offerValidityDays: z.string().trim(),
  chargeWindowDays: z.string().trim(),
  holdReleaseDays: z.string().trim(),
  liabilityCap: z.string().trim(),
  retentionDays: z.string().trim(),
  recordRetentionMonths: z.string().trim(),
});

// Re-throw Next.js control-flow signals (redirect/notFound) so they are not
// swallowed by the catch — same guard used by the other admin actions.
function isNextControlFlow(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    ((err as { digest: string }).digest.startsWith('NEXT_REDIRECT') ||
      (err as { digest: string }).digest === 'NEXT_NOT_FOUND')
  );
}

export async function saveAgreementConfigAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = agreementConfigSchema.safeParse({
    serviceActivationWindow: formData.get('serviceActivationWindow') ?? '',
    offerValidityDays: formData.get('offerValidityDays') ?? '',
    chargeWindowDays: formData.get('chargeWindowDays') ?? '',
    holdReleaseDays: formData.get('holdReleaseDays') ?? '',
    liabilityCap: formData.get('liabilityCap') ?? '',
    retentionDays: formData.get('retentionDays') ?? '',
    recordRetentionMonths: formData.get('recordRetentionMonths') ?? '',
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await requireAdmin();
    const supabase = await createClient();

    // The form is prefilled with current values, so every save submits all 7
    // fields. Empty → null (intentional unset).
    const { error } = await supabase
      .from('app_settings')
      .update({
        agr_service_activation_window: parsed.data.serviceActivationWindow || null,
        agr_offer_validity_days: parsed.data.offerValidityDays || null,
        agr_charge_window_days: parsed.data.chargeWindowDays || null,
        agr_hold_release_days: parsed.data.holdReleaseDays || null,
        agr_liability_cap: parsed.data.liabilityCap || null,
        agr_retention_days: parsed.data.retentionDays || null,
        agr_record_retention_months: parsed.data.recordRetentionMonths || null,
      })
      .eq('id', SETTINGS_ID);

    if (error) {
      return { error: 'עדכון הגדרות החוזה נכשל. נסו שוב.' };
    }
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { error: 'עדכון הגדרות החוזה נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/agreement');
  return { notice: 'הגדרות החוזה נשמרו' };
}
