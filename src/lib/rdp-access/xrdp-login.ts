import type { createAdminClient } from '@/lib/supabase/admin';

import type { XrdpTicketConfig } from './config';
import { getActiveRdpGrant, RdpQueryError } from './queries';
import { createOnceGuard, verifyXrdpTicket } from './xrdp-ticket';

type AdminClient = ReturnType<typeof createAdminClient>;

// The decision behind the desktop's PAM line: "may this ticket log in as this account, right now?". The route that
// serves it (api/internal/rdp-gateway/xrdp-ticket) only authenticates the caller and parses the body; everything
// that decides is here, so it can be tested without HTTP.
//
// Everything is judged against what is true NOW, not against what was true when the file was downloaded:
//   - there must be an active, unexpired grant (revoking or ending it blocks every ticket already downloaded);
//   - the ticket must have been minted for THAT grant, ITS requester and THIS account (verifyXrdpTicket);
//   - the requester must still hold the staff permission that lets them request access at all;
//   - a ticket logs in once (per process; see createOnceGuard for what a restart does).
// The account is the server's configuration. A different `user` than that account is refused before the database
// is touched, so editing the username in the file cannot reach another account.
//
// The reason of a refusal is for the app's log and the tests. It never goes back to the caller.

export type XrdpLoginRefusal =
  | 'wrong_account'
  | 'no_active_grant'
  | 'grant_without_user'
  | 'no_permission'
  | 'shape'
  | 'expired'
  | 'mismatch'
  | 'used';

export type XrdpLoginDecision = { allow: true; grantId: string } | { allow: false; reason: XrdpLoginRefusal };

const PERMISSION_KEY = 'rdp.request';
const onceGuard = createOnceGuard();

export type XrdpLoginDeps = { admin: AdminClient; now: Date; once?: Pick<typeof onceGuard, 'consume'> };

/** Throws on a database failure: the caller answers "not now", never "allowed". */
export async function decideXrdpLogin(
  deps: XrdpLoginDeps,
  config: Pick<XrdpTicketConfig, 'ticketSecret' | 'account'>,
  input: { ticket: string; user: string },
): Promise<XrdpLoginDecision> {
  if (input.user !== config.account) return { allow: false, reason: 'wrong_account' };

  const grant = await getActiveRdpGrant(deps.admin, deps.now);
  if (grant === null) return { allow: false, reason: 'no_active_grant' };
  if (grant.user_id === null) return { allow: false, reason: 'grant_without_user' };

  const checked = verifyXrdpTicket(
    input.ticket,
    { secret: config.ticketSecret, grantId: grant.id, userId: grant.user_id, account: config.account },
    deps.now,
  );
  if (!checked.ok) return { allow: false, reason: checked.reason };

  const permission = await deps.admin.rpc('has_platform_permission_for_user', { _key: PERMISSION_KEY, _user_id: grant.user_id });
  if (permission.error) throw new RdpQueryError('xrdp_login_permission');
  if (permission.data !== true) return { allow: false, reason: 'no_permission' };

  if (!(deps.once ?? onceGuard).consume(checked.id, checked.expiresAt, deps.now)) return { allow: false, reason: 'used' };
  return { allow: true, grantId: grant.id };
}
