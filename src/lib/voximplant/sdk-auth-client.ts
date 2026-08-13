/**
 * Browser helper: exchange a Web SDK one-time key for a login hash via
 * POST /api/agents/sdk-auth, authenticated with the caller's own Supabase
 * session (Bearer). The password never reaches the browser — the server
 * signs the hash; this only relays the caller's session token to it.
 *
 * BROWSER ONLY (uses the browser Supabase client). Shared by the stage-2 dev
 * login page (admin/voice/console/_console-client.tsx) and the stage-3
 * softphone panel — extracted here so the two never drift on this contract.
 */

import { createClient } from '@/lib/supabase/client';

export async function fetchConsoleSdkAuthHash(oneTimeKey: string): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('אין session פעיל — יש להתחבר מחדש למערכת');

  const res = await fetch('/api/agents/sdk-auth', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ one_time_key: oneTimeKey }),
    cache: 'no-store',
  });
  if (res.status === 409) {
    throw new Error('לא הוקצתה זהות מוקד לנציג זה');
  }
  if (!res.ok) {
    throw new Error('חתימת ההתחברות נכשלה');
  }
  const body = (await res.json()) as { hash?: string };
  if (!body.hash) throw new Error('חתימת ההתחברות נכשלה');
  return body.hash;
}
