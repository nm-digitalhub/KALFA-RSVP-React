import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';

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
    .select('id, label')
    .eq('provider', 'microsoft')
    .eq('status', 'active')
    .contains('scopes', ['Mail.Send'])
    .order('label', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw new Error('טעינת חיבורי Microsoft הפעילים נכשלה');

  return (data ?? []).map((row) => ({
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
    mailSendReady: row.status === 'active' && row.scopes.includes('Mail.Send'),
  }));
}
