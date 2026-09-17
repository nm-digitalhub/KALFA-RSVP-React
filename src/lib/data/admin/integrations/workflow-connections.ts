import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  MICROSOFT_MAIL_CAPABILITY,
  microsoftProvider,
} from '@/lib/integrations/providers/microsoft';
import { grantSatisfies } from '@/lib/integrations/scopes';

export type AdminMicrosoftWorkflowConnection = {
  label: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** Reduced from the stored scopes; the scopes themselves never leave this module. */
  mailSendReady: boolean;
};

/**
 * The active Microsoft connections a workflow author may select.
 *
 * This reader deliberately returns display metadata only. Tokens, Vault ids,
 * scopes, provider metadata, and the full connection row never cross the RSC
 * boundary; the workflow persists only the returned UUID in `connectionId`.
 */
export async function listActiveMicrosoftWorkflowConnections(): Promise<
  Array<{ label: string; value: string }>
> {
  await requirePlatformPermission('integrations.read');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('integration_connections')
    // ⚠️ `scopes` IS SELECTED AND FILTERED IN JS, not by `.contains('scopes',
    // ['Mail.Send'])` as this used to be. That filter ran a Postgres array
    // containment on a hard-coded literal, and the provider does not answer in
    // that spelling: Microsoft's token response echoes
    // `https://graph.microsoft.com/mail.send`. A perfectly good connection
    // therefore matched NOTHING and VANISHED FROM THE PICKER — worse than the
    // wrong badge the same literal caused next door, because the author saw an
    // empty list and no reason for it.
    //
    // Filtering here costs nothing: the rows are per-deployment mailboxes, not
    // a table that grows. And the scopes still stop at this module — only
    // `{label, value}` crosses the RSC boundary, as the note above promises.
    .select('id, label, scopes')
    .eq('provider', 'microsoft')
    .eq('status', 'active')
    .order('label', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw new Error('טעינת חיבורי Microsoft הפעילים נכשלה');

  return (data ?? [])
    .filter((row) =>
      grantSatisfies(
        // `?? []` because a row with no scopes must be EXCLUDED, never a
        // crash. The filter moved out of SQL, where a null array simply failed
        // to match; in JS it reaches `.map` and takes the caller down.
        row.scopes ?? [],
        microsoftProvider.capabilities[MICROSOFT_MAIL_CAPABILITY],
        microsoftProvider.oauth.scopeResources ?? [],
      ),
    )
    .map((row) => ({
      label: row.label,
      value: row.id,
    }));
}

/**
 * Safe admin status projection for Microsoft workflow connections.
 *
 * The query needs `scopes` to answer whether a connection is actually ready for
 * the mail node, but collapses it to one boolean before returning. Connection
 * ids, tokens, Vault references, provider metadata and error payloads are not
 * selected and therefore cannot enter the RSC payload.
 */
export async function listMicrosoftWorkflowConnectionsForAdmin(): Promise<
  AdminMicrosoftWorkflowConnection[]
> {
  await requirePlatformPermission('integrations.read');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('integration_connections')
    .select('label, status, created_at, updated_at, scopes')
    .eq('provider', 'microsoft')
    .order('created_at', { ascending: false });

  if (error) throw new Error('טעינת חיבורי Microsoft נכשלה');

  return (data ?? []).map((row) => ({
    label: row.label,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mailSendReady:
      row.status === 'active' &&
      grantSatisfies(
        // `?? []` because a row with no scopes must be EXCLUDED, never a
        // crash. The filter moved out of SQL, where a null array simply failed
        // to match; in JS it reaches `.map` and takes the caller down.
        row.scopes ?? [],
        microsoftProvider.capabilities[MICROSOFT_MAIL_CAPABILITY],
        microsoftProvider.oauth.scopeResources ?? [],
      ),
  }));
}
