'use server';

// Server Action for the agreement-config section of the /admin/agreement page.
// Validates the values with an inline Zod schema (all trimmed strings — these
// are free-form config the agreement reads live, so coercion is intentionally
// avoided here) and writes them to the singleton app_settings row.
//
// Authorization: requirePlatformPermission('manage_settings') gates the write, and the write goes through the
// request-scoped cookie session client (createClient) — NOT the service-role
// client — so the app_settings_admin_all RLS policy still applies. This mirrors
// updateCompanySettings() (company_profile, policy company_profile_admin_all) and
// updateAppSettings(), which write the same way under the same permission; RLS is
// kept as a defence-in-depth layer rather than being bypassed.
//
// camelCase form keys (matching the getAgreementConfigForAdmin() prop shape) are
// mapped to the snake_case agr_* columns on save.

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { createClient } from '@/lib/supabase/server';

// The app_settings singleton is keyed by a constant boolean id (see
// src/lib/data/admin/settings.ts).
const SETTINGS_ID = true;

// All values are trimmed strings. Empty is allowed (an intentional unset →
// stored as NULL below), matching the company/app-settings save behaviour. A
// field the form did not send reads as empty, as it always has.
const agreementConfigValue = z.string().trim().prefault('');

const agreementConfigSchema = zfd.formData({
  serviceActivationWindow: agreementConfigValue,
  offerValidityDays: agreementConfigValue,
  liabilityCap: agreementConfigValue,
  retentionDays: agreementConfigValue,
  recordRetentionMonths: agreementConfigValue,
});

export const saveAgreementConfigAction = actionClient
  .inputSchema(agreementConfigSchema)
  .stateAction(async ({ parsedInput }) => {
    let saved = false;
    try {
      // `manage_settings`, not the retired coarse `requireAdmin()` flag. The agreement config decides the
      // terms a customer approves.
      await requirePlatformPermission('manage_settings');
      const supabase = await createClient();

      // The form is prefilled with current values, so every save submits every
      // field. Empty → null (intentional unset).
      const { error } = await supabase
        .from('app_settings')
        .update({
          agr_service_activation_window: parsedInput.serviceActivationWindow || null,
          agr_offer_validity_days: parsedInput.offerValidityDays || null,
          agr_liability_cap: parsedInput.liabilityCap || null,
          agr_retention_days: parsedInput.retentionDays || null,
          agr_record_retention_months: parsedInput.recordRetentionMonths || null,
        })
        .eq('id', SETTINGS_ID);
      saved = !error;
    } catch (err) {
      unstable_rethrow(err);
    }
    if (!saved) returnUserError('עדכון הגדרות החוזה נכשל. נסו שוב.');

    revalidatePath('/admin/agreement');
    return { notice: 'הגדרות החוזה נשמרו' };
  });
