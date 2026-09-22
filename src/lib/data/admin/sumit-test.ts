import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { recordStaffAccess } from '@/lib/data/admin/access-log';

// Support for the /admin/sumit-test diagnostic: charging a REAL saved card token
// that a past J5 hold stored, instead of re-typing card details.
//
// WHY THE TOKEN IS NEVER SENT TO THE BROWSER. The picker renders labels and
// campaign ids only; the form posts the campaign id and this module resolves the
// token server-side at charge time. A token in the DOM is a token in a screenshot,
// a browser history entry and any extension reading the page — and it is reusable
// against the live gateway. The manual-entry path still exists for a token that
// came from somewhere else; that is the operator's own paste, not something this
// screen hands them.
//
// Reading one is a TARGETED read of one identified customer's payment instrument,
// so resolveSavedCardForCampaign records a staff-access row before returning it
// (fail-closed: no audit row, no token). Listing the candidates is not — it
// returns no card data at all.

export type ChargeableCampaign = {
  campaignId: string;
  /** Display only: event name + date. Never any card data. */
  label: string;
};

// Campaigns whose J5 hold stored a COMPLETE payment method. Incomplete rows are
// filtered out here rather than offered and rejected later: SUMIT needs the
// token, both expiry parts and the CitizenID together, and a half-stored card
// can only produce a confusing live decline.
export async function listChargeableCampaigns(): Promise<ChargeableCampaign[]> {
  await requirePlatformPermission('manage_billing');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('id, created_at, events!inner(name, event_date)')
    .not('card_token_ref', 'is', null)
    .not('card_exp_month', 'is', null)
    .not('card_exp_year', 'is', null)
    .not('card_citizen_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error('טעינת הקמפיינים לבדיקה נכשלה');

  return (data ?? []).map((row) => {
    // The embedded row comes back as an object for an !inner one-to-one join;
    // narrow defensively rather than trust the generated shape.
    const ev = row.events as unknown as { name?: string; event_date?: string } | null;
    const name = ev?.name?.trim() || 'אירוע ללא שם';
    const date = ev?.event_date ? ev.event_date.slice(0, 10) : '';
    return {
      campaignId: row.id,
      label: date ? `${name} · ${date}` : name,
    };
  });
}

export type SavedCard = {
  cardToken: string;
  expMonth: number;
  expYear: number;
  citizenId: string;
  /** The hold's SUMIT customer, so a test charge reuses it instead of creating one. */
  sumitCustomerId: number | null;
};

// Resolve one campaign's stored card for a diagnostic charge. Audited, then
// returned — never logged, never rendered, and the caller must not echo it back
// to the browser (the POC's safe-preview projection already redacts tokens).
export async function resolveSavedCardForCampaign(
  campaignId: string,
): Promise<SavedCard | null> {
  const staff = await requirePlatformPermission('manage_billing');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select(
      'id, event_id, card_token_ref, card_exp_month, card_exp_year, card_citizen_id, sumit_customer_id, events!inner(owner_id)',
    )
    .eq('id', campaignId)
    .maybeSingle();

  if (error) throw new Error('טעינת אמצעי התשלום נכשלה');
  if (
    !data?.card_token_ref ||
    data.card_exp_month == null ||
    data.card_exp_year == null ||
    !data.card_citizen_id
  ) {
    return null;
  }

  const owner = data.events as unknown as { owner_id?: string } | null;
  const ownerId = owner?.owner_id;
  if (!ownerId) {
    // No owner to attribute the access to ⇒ no audit row can be written ⇒ the
    // read does not happen. Same fail-closed rule recordStaffAccess enforces.
    throw new Error('לא ניתן לזהות את בעל הקמפיין — הגישה בוטלה');
  }

  await recordStaffAccess({
    staffId: staff.id,
    permission: 'manage_billing',
    subjectType: 'campaign',
    subjectId: campaignId,
    ownerId,
    eventId: data.event_id,
  });

  return {
    cardToken: data.card_token_ref,
    expMonth: Number(data.card_exp_month),
    expYear: Number(data.card_exp_year),
    citizenId: data.card_citizen_id,
    sumitCustomerId: data.sumit_customer_id ?? null,
  };
}
