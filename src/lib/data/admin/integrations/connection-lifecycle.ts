import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Ending and renaming a connection.
 *
 * ⚠️ SEPARATE FROM `workflow-connections.ts` ON PURPOSE. That module READS, and
 * is gated on `integrations.read` so a workflow author who may not manage
 * integrations can still pick an account. These are WRITES that end or rename
 * something other workflows may be using, and they are gated on
 * `integrations.manage`. Putting them in one file would make the weaker gate
 * the obvious one to copy.
 *
 * Every function here is a thin call into an RPC. The rules — what may be
 * deleted, what a label may contain, what happens to the Vault secret — live in
 * `20260917035001_integration_connection_lifecycle.sql`, because a check that
 * lives in TypeScript is a check a direct database call walks past.
 */

export type ConnectionLifecycleResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: string };

/**
 * End a connection: status becomes `revoked` and the Vault secret is destroyed.
 *
 * `changed: false` means it was already revoked. That is a normal answer, not a
 * failure — a second click, or two people pressing at once.
 *
 * ⚠️ THE ROW SURVIVES, and callers must not read that as an incomplete job. A
 * diagram holds this uuid inside `definition` jsonb with no foreign key to
 * enforce it, so a deleted row would leave an armed workflow pointing at
 * nothing. Kept, the editor recognises it and says the connection is no longer
 * available — see `selectedConnectionUnavailable`.
 */
export async function disconnectIntegrationConnection(
  connectionId: string,
): Promise<ConnectionLifecycleResult> {
  await requirePlatformPermission('integrations.manage');

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('integrations_disconnect_credential', {
    p_connection_id: connectionId,
  });

  if (error) return { ok: false, reason: 'ניתוק החיבור נכשל.' };
  return { ok: true, changed: data === true };
}

/**
 * Rename a connection.
 *
 * ⚠️ THE LABEL IS NOT VALIDATED HERE, and that is deliberate rather than an
 * omission. Empty, whitespace-only and over-long are refused by the RPC, which
 * raises — so they arrive as `error` below. Repeating the rules in TypeScript
 * would create a second definition of "valid" that drifts from the one the
 * database actually enforces, and would still not protect a direct RPC call.
 */
export async function renameIntegrationConnection(
  connectionId: string,
  label: string,
): Promise<ConnectionLifecycleResult> {
  await requirePlatformPermission('integrations.manage');

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('integrations_rename_credential', {
    p_connection_id: connectionId,
    p_label: label,
  });

  if (error) {
    // 22023 is the RPC's own refusal — a blank or over-long label. Anything
    // else is an infrastructure failure and must not read as a user mistake.
    const invalid = error.code === '22023';
    return {
      ok: false,
      reason: invalid
        ? 'שם החיבור חייב להיות בין תו אחד ל-200 תווים.'
        : 'שינוי שם החיבור נכשל.',
    };
  }
  return { ok: true, changed: data === true };
}

/**
 * Remove a connection entirely.
 *
 * ⚠️ REFUSED WHILE ACTIVE OR REFERENCED, and both refusals come from the
 * database. `integrations_delete_credential` counts every workflow whose
 * definition names this uuid — armed or draft — because a draft someone is
 * still writing is not a free row to reclaim.
 *
 * Exposed for completeness; the node UI offers disconnect, not delete. Ending a
 * connection is the operation a workflow author needs, and it is the one that
 * destroys the token. Deleting is housekeeping for a screen that lists
 * connections, once one exists.
 */
export async function deleteIntegrationConnection(
  connectionId: string,
): Promise<ConnectionLifecycleResult> {
  await requirePlatformPermission('integrations.manage');

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('integrations_delete_credential', {
    p_connection_id: connectionId,
  });

  if (error) {
    if (error.code === '23503') {
      return { ok: false, reason: 'החיבור עדיין בשימוש בתהליך קיים. הסירו אותו משם תחילה.' };
    }
    if (error.code === '22023') {
      return { ok: false, reason: 'יש לנתק את החיבור לפני מחיקתו.' };
    }
    return { ok: false, reason: 'מחיקת החיבור נכשלה.' };
  }
  return { ok: true, changed: data === true };
}
