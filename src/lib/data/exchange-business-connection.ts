import 'server-only';

import { resolveMailboxPassword } from '@/lib/exchange-ews/mailbox-credential';
import type { ExchangeConnectionConfig } from '@/lib/exchange-ews/types';
import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

export type LoadedBusinessConnection = { id: string; config: ExchangeConnectionConfig };

/**
 * The single verified connection unattended, service-role code writes through
 * (the callback scheduler, the event calendar sync).
 *
 * Unattended code must not guess between mailboxes, so this refuses rather than
 * picks when the answer is ambiguous: exactly one verified connection, or
 * nothing happens. If per-org mode ever puts several verified rows in the
 * table, this is the function that has to learn which one is "the business".
 */
export async function loadBusinessExchangeConnection(
  admin: AdminClient,
): Promise<{ ok: true; connection: LoadedBusinessConnection } | { ok: false; reason: string }> {
  const { data, error } = await admin
    .from('exchange_connections')
    .select(
      'id, user_id, mailbox_email, auth_method, status, credential_ciphertext, credential_iv, credential_auth_tag, encryption_key_version',
    )
    .eq('status', 'verified')
    .limit(2);

  if (error) return { ok: false, reason: 'connection_lookup_failed' };
  if (!data || data.length === 0) return { ok: false, reason: 'no_verified_connection' };
  if (data.length > 1) return { ok: false, reason: 'ambiguous_connection' };

  const row = data[0];
  let password: string;
  try {
    password = resolveMailboxPassword();
  } catch {
    // Fail closed, exactly as the request-bound loader does.
    return { ok: false, reason: 'decrypt_failed' };
  }

  return {
    ok: true,
    connection: {
      id: row.id,
      config: {
        mailboxEmail: row.mailbox_email,
        password,
        // Narrowed, not cast: the column is plain text, and an unexpected value
        // must not reach the provider. The value is inert: graph-impl.ts
        // ignores authMethod.
        authMethod: row.auth_method === 'basic' ? 'basic' : 'ntlm',
      },
    },
  };
}
