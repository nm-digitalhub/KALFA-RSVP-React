import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

// The project's convention (oauth-flow.ts:16, event-exchange-sync.ts:39 …).
type AdminClient = ReturnType<typeof createAdminClient>;

export type CardDetails = { methodType: string | null; tokenRef: string; expMonth: number | null; expYear: number | null; last4: string | null; mask: string | null; citizenSecretId: string | null };

// The card lives on the payment operation where the provider returned it (a hold, or a simple charge — SUMIT
// saves a reusable token unless CardTokenNotNeeded=true). The ת"ז SUMIT needs on every saved-token charge
// (capture.ts, CreditCard_CitizenID) goes to vault.secrets; the row keeps only the secret's uuid.
export function cardFromSumit(
  pm: { Type?: unknown; CreditCard_Token?: string | null; CreditCard_ExpirationMonth?: number | null; CreditCard_ExpirationYear?: number | null; CreditCard_LastDigits?: string | null; CreditCard_CardMask?: string | null } | null | undefined,
): Omit<CardDetails, 'citizenSecretId'> | null {
  if (!pm?.CreditCard_Token) return null;
  return {
    methodType: pm.Type == null ? null : String(pm.Type),
    tokenRef: pm.CreditCard_Token,
    expMonth: pm.CreditCard_ExpirationMonth ?? null,
    expYear: pm.CreditCard_ExpirationYear ?? null,
    last4: pm.CreditCard_LastDigits ?? null,
    mask: pm.CreditCard_CardMask ?? null,
  };
}

export async function saveCitizenId(admin: AdminClient, campaignId: string, citizenId: string | null): Promise<string | null> {
  if (!citizenId) return null;
  const { data, error } = await admin.rpc('payment_citizen_id_write', { p_citizen_id: citizenId, p_campaign_id: campaignId });
  if (error || typeof data !== 'string') throw new Error('שמירת פרטי הכרטיס נכשלה');
  return data;
}

export async function readCitizenId(admin: AdminClient, operationId: string): Promise<string | null> {
  const { data, error } = await admin.rpc('payment_citizen_id', { p_operation_id: operationId });
  if (error) return null;
  return typeof data === 'string' ? data : null;
}
