'use server';

import type { FormState } from '@/lib/validation/result';

import { saveWorkflowOAuthProviderAction } from '../actions';

/**
 * Pin this provider-specific screen to the registry's canonical Microsoft id.
 * The shared action remains the single validation/write path; this adapter only
 * prevents a browser from choosing a different provider for this fixed form.
 */
export async function saveMicrosoftWorkflowOAuthProviderAction(
  previousState: FormState,
  submitted: FormData,
): Promise<FormState> {
  const canonical = new FormData();
  canonical.set('provider', 'microsoft');
  canonical.set('clientId', String(submitted.get('clientId') ?? ''));
  canonical.set('clientSecret', String(submitted.get('clientSecret') ?? ''));
  if (submitted.get('enabled') === 'on') canonical.set('enabled', 'on');

  return saveWorkflowOAuthProviderAction(previousState, canonical);
}
