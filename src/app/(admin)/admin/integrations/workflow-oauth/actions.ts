'use server';

import { saveWorkflowOAuthProviderAction } from '../actions';

type SaveWorkflowOAuthProviderResult = Awaited<ReturnType<typeof saveWorkflowOAuthProviderAction>>;

/**
 * Pin this provider-specific screen to the registry's canonical Microsoft id.
 * The shared action remains the single validation/write path; this adapter only
 * prevents a browser from choosing a different provider for this fixed form.
 * It is a plain pass-through, not an actionClient action: the shared action already validates and returns the
 * next-safe-action result, and wrapping it again would nest that result under `data`.
 */
export async function saveMicrosoftWorkflowOAuthProviderAction(
  previousState: SaveWorkflowOAuthProviderResult,
  submitted: FormData,
): Promise<SaveWorkflowOAuthProviderResult> {
  const canonical = new FormData();
  canonical.set('provider', 'microsoft');
  canonical.set('clientId', String(submitted.get('clientId') ?? ''));
  canonical.set('clientSecret', String(submitted.get('clientSecret') ?? ''));
  if (submitted.get('enabled') === 'on') canonical.set('enabled', 'on');

  return saveWorkflowOAuthProviderAction(previousState, canonical);
}
