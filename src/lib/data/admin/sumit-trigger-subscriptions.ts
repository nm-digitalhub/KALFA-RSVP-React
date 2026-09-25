import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { getSumitServerConfig } from '@/lib/data/payments';
import {
  listSumitFolders,
  listSumitViews,
  SUMIT_TRIGGER_TYPES,
  SumitTriggerError,
  subscribeSumitTrigger,
  unsubscribeSumitTrigger,
  type SumitCredentials,
  type SumitNamedItem,
  type SumitTriggerType,
} from '@/lib/sumit/crm-triggers';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';
import { getAppOrigin } from '@/lib/url';
import { editorDiagramSchema } from '@/lib/workflow/adapter/editor-schema';
import * as sumitCardTriggerDefinition from '@/lib/workflow/nodes/trigger-sumit-card/definition';
import { hashWebhookToken, webhookHashesMatch, webhookUrlFor } from '@/lib/workflow/webhook-token';

// The SUMIT trigger node's registration in SUMIT, done by us instead of by hand.
//
// ⚠️ THE ADDRESS IS A SECRET AND SUMIT CANNOT LIST WHAT WE REGISTERED. In
// `address` mode the URL's path segment is the credential and the diagram stores
// only its hash; SUMIT's unsubscribe takes the URL itself and there is no
// "list triggers" call. So the URL is kept in Vault through the existing
// integration-credential store (`integrations_write_credential`, the same table
// Microsoft connections use), one row per registered node:
//   provider 'sumit', credential_kind 'trigger_url', secret = the URL,
//   metadata = { workflowId, nodeId, tokenHash, subscribed }.
// Every other reader of that table filters on its own provider, so these rows
// never appear anywhere else.
//
// WHEN SUMIT HOLDS THE TRIGGER: only while the workflow is ACTIVE. A disarmed
// workflow's address answers 404, and SUMIT suspends a trigger after five
// failures — so disarming unsubscribes, and arming subscribes again. The
// folder, view and change type are read from the SAVED diagram every time, so
// changing them on an active workflow re-registers on the next save.

const PROVIDER = 'sumit';
const KIND = 'trigger_url';
const HOOK_PATH = '/api/workflows/hook/';

type Registration = { folderId: string; viewId: string; changeType: SumitTriggerType };
type ConnectionMeta = {
  workflowId: string;
  nodeId: string;
  tokenHash: string;
  subscribed: Registration | null;
};

export type SumitListResult = { ok: true; items: SumitNamedItem[] } | { ok: false; message: string };
export type SumitRegisterResult = { ok: true; message: string } | { ok: false; message: string };

async function credentials(): Promise<SumitCredentials> {
  const cfg = await getSumitServerConfig();
  if (!cfg) throw new SumitTriggerError('פרטי החיבור ל-SUMIT לא הוגדרו בהגדרות');
  return cfg;
}

function messageOf(error: unknown): string {
  return error instanceof SumitTriggerError ? error.message : 'הפעולה מול SUMIT נכשלה';
}

// ---------------------------------------------------------------------------
// The editor's two lists
// ---------------------------------------------------------------------------

export async function listSumitFoldersForEditor(): Promise<SumitListResult> {
  await requirePlatformPermission('manage_settings');
  try {
    return { ok: true, items: await listSumitFolders(await credentials()) };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function listSumitViewsForEditor(folderId: string): Promise<SumitListResult> {
  await requirePlatformPermission('manage_settings');
  if (!/^\d{1,19}$/.test(folderId)) return { ok: false, message: 'מזהה תיקייה לא תקין' };
  try {
    return { ok: true, items: await listSumitViews(await credentials(), folderId) };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

// ---------------------------------------------------------------------------
// Reading the saved diagram
// ---------------------------------------------------------------------------

type SumitNode = { id: string; tokenHash: string; registration: Registration | null };

function sumitNodesOf(definition: unknown): Map<string, SumitNode> {
  const out = new Map<string, SumitNode>();
  const parsed = editorDiagramSchema.safeParse(definition);
  if (!parsed.success) return out;
  for (const node of parsed.data.nodes) {
    if (node.data.type !== sumitCardTriggerDefinition.type) continue;
    const p = (node.data.properties ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const folderId = str(p.folderId);
    const viewId = str(p.viewId);
    const changeType = str(p.changeType);
    const registration =
      /^\d+$/.test(folderId) && /^\d+$/.test(viewId) && (SUMIT_TRIGGER_TYPES as readonly string[]).includes(changeType)
        ? { folderId, viewId, changeType: changeType as SumitTriggerType }
        : null;
    out.set(node.id, { id: node.id, tokenHash: str(p.tokenHash), registration });
  }
  return out;
}

function sameRegistration(a: Registration | null, b: Registration | null): boolean {
  if (!a || !b) return a === b;
  return a.folderId === b.folderId && a.viewId === b.viewId && a.changeType === b.changeType;
}

async function loadWorkflow(workflowId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('workflows')
    .select('is_active, definition')
    .eq('id', workflowId)
    .maybeSingle();
  if (error) throw new Error('קריאת התהליך נכשלה');
  return data;
}

type ConnectionRow = { id: string; meta: ConnectionMeta };

async function loadConnections(workflowId: string): Promise<ConnectionRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('integration_connections')
    .select('id, metadata')
    .eq('provider', PROVIDER)
    .eq('credential_kind', KIND)
    .eq('status', 'active')
    .eq('metadata->>workflowId', workflowId);
  if (error) throw new Error('קריאת רישומי SUMIT נכשלה');
  return (data ?? []).map((row) => ({ id: row.id, meta: row.metadata as unknown as ConnectionMeta }));
}

async function readUrl(connectionId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('integrations_read_credential', {
    p_connection_id: connectionId,
    p_expected_provider: PROVIDER,
    p_expected_kind: KIND,
  });
  if (error || typeof data !== 'string') return null;
  return data;
}

async function updateConnection(
  id: string,
  patch: { meta?: ConnectionMeta; status?: 'revoked'; lastError?: string | null },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('integration_connections')
    .update({
      ...(patch.meta ? { metadata: patch.meta as unknown as Json } : {}),
      ...(patch.status ? { status: patch.status, vault_secret_id: null } : {}),
      ...(patch.lastError !== undefined ? { last_error: patch.lastError } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error('עדכון רישום SUMIT נכשל');
}

// ---------------------------------------------------------------------------
// Bringing SUMIT in line with the saved diagram
// ---------------------------------------------------------------------------

/**
 * Make SUMIT hold exactly the triggers this workflow should have right now.
 *
 * Returns the problems, in Hebrew, for the caller to show; never throws for a
 * SUMIT failure, because arming, disarming and saving must not fail on account
 * of a third party. A failed call is recorded on the row (`last_error`) and
 * retried on the next sync.
 */
export async function syncSumitTriggers(workflowId: string): Promise<string[]> {
  const connections = await loadConnections(workflowId);
  if (connections.length === 0) return [];

  const workflow = await loadWorkflow(workflowId);
  const nodes = sumitNodesOf(workflow?.definition);
  const problems: string[] = [];
  let creds: SumitCredentials | null = null;

  for (const { id, meta } of connections) {
    const node = nodes.get(meta.nodeId);
    // The address this row holds is no longer the node's: the node was deleted,
    // or a new address was minted without registering it. Either way this row
    // must leave SUMIT and be retired.
    const stale = !node || !webhookHashesMatch(node.tokenHash, meta.tokenHash);
    const target = !stale && workflow?.is_active ? (node?.registration ?? null) : null;
    if (!stale && sameRegistration(meta.subscribed, target)) continue;

    try {
      creds ??= await credentials();
      const url = await readUrl(id);
      if (!url) throw new SumitTriggerError('הכתובת השמורה לא נמצאה');
      if (meta.subscribed) {
        await unsubscribeSumitTrigger(creds, url);
        meta.subscribed = null;
      }
      if (target) {
        await subscribeSumitTrigger(creds, { url, folderId: target.folderId, viewId: target.viewId, triggerType: target.changeType });
        meta.subscribed = target;
      }
      await updateConnection(id, { meta, lastError: null, ...(stale ? { status: 'revoked' } : {}) });
    } catch (error) {
      const message = messageOf(error);
      problems.push(`רישום הטריגר ב-SUMIT: ${message}`);
      // Keep what IS true about SUMIT's side, so the next sync starts from it.
      await updateConnection(id, { meta, lastError: message }).catch(() => undefined);
    }
  }
  return problems;
}

/** Take every trigger of this workflow out of SUMIT and retire the rows — before deleting it. */
export async function retireSumitTriggers(workflowId: string): Promise<string[]> {
  const connections = await loadConnections(workflowId);
  const problems: string[] = [];
  let creds: SumitCredentials | null = null;
  for (const { id, meta } of connections) {
    try {
      if (meta.subscribed) {
        creds ??= await credentials();
        const url = await readUrl(id);
        if (url) await unsubscribeSumitTrigger(creds, url);
      }
      await updateConnection(id, { meta: { ...meta, subscribed: null }, status: 'revoked' });
    } catch (error) {
      problems.push(`ביטול הטריגר ב-SUMIT: ${messageOf(error)}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The editor's "רישום ב-SUMIT" button
// ---------------------------------------------------------------------------

/**
 * Register the address the owner just minted for one SUMIT trigger node.
 *
 * ⚠️ THE URL COMES FROM THE BROWSER AND IS NOT TRUSTED. SUMIT will POST card
 * data (customer names, card digits) to whatever URL we register, so it must be
 * THIS app's hook address AND its path segment must hash to the tokenHash in the
 * SAVED diagram. Anything else — another host, another path, an unsaved address —
 * is refused before SUMIT is called.
 */
export async function registerSumitTrigger(
  workflowId: string,
  nodeId: string,
  url: string,
): Promise<SumitRegisterResult> {
  const user = await requirePlatformPermission('manage_settings');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: 'כתובת לא תקינה' };
  }
  const origin = await getAppOrigin();
  if (parsed.origin !== origin || !parsed.pathname.startsWith(HOOK_PATH) || parsed.search || parsed.hash) {
    return { ok: false, message: 'אפשר לרשום רק את כתובת התהליך של האתר הזה' };
  }
  const segment = decodeURIComponent(parsed.pathname.slice(HOOK_PATH.length));
  if (!segment || segment.includes('/')) return { ok: false, message: 'כתובת לא תקינה' };
  const canonicalUrl = webhookUrlFor(origin, segment);

  const workflow = await loadWorkflow(workflowId);
  if (!workflow) return { ok: false, message: 'התהליך לא נמצא' };
  const node = sumitNodesOf(workflow.definition).get(nodeId);
  if (!node) return { ok: false, message: 'הטריגר לא נמצא בתהליך השמור. שמרו ונסו שוב.' };
  const tokenHash = await hashWebhookToken(segment);
  if (!node.tokenHash || !webhookHashesMatch(node.tokenHash, tokenHash)) {
    return { ok: false, message: 'הכתובת החדשה עוד לא נשמרה. חכו רגע לשמירה ונסו שוב.' };
  }
  if (!node.registration) {
    return { ok: false, message: 'בחרו תיקייה, תצוגה ושינוי לפני הרישום.' };
  }

  // The node's previous address, if any, leaves SUMIT first: two registrations
  // for one node would deliver every change twice.
  const previous = (await loadConnections(workflowId)).filter((c) => c.meta.nodeId === nodeId);
  if (previous.length > 0) {
    const creds = await credentials().catch(() => null);
    for (const { id, meta } of previous) {
      try {
        if (meta.subscribed && creds) {
          const oldUrl = await readUrl(id);
          if (oldUrl) await unsubscribeSumitTrigger(creds, oldUrl);
        }
        await updateConnection(id, { meta: { ...meta, subscribed: null }, status: 'revoked' });
      } catch (error) {
        return { ok: false, message: `ביטול הכתובת הקודמת ב-SUMIT נכשל: ${messageOf(error)}` };
      }
    }
  }

  const admin = createAdminClient();
  const meta: ConnectionMeta = { workflowId, nodeId, tokenHash, subscribed: null };
  const { error } = await admin.rpc('integrations_write_credential', {
    p_provider: PROVIDER,
    p_credential_kind: KIND,
    p_label: `SUMIT trigger ${workflowId.slice(0, 8)}/${nodeId}`,
    p_scopes: [],
    p_metadata: meta as unknown as Json,
    p_secret: canonicalUrl,
    // Never expires: it lives until the node gets a new address or leaves the workflow.
    p_expires_at: null,
    p_created_by: user.id,
  });
  if (error) return { ok: false, message: 'שמירת הכתובת נכשלה' };

  const problems = workflow.is_active ? await syncSumitTriggers(workflowId) : [];

  try {
    await logActivity({
      action: 'admin.workflow.sumit_trigger_registered',
      // Ids and SUMIT ids only — never the URL, which is the credential.
      meta: { workflowId, nodeId, folderId: node.registration.folderId, viewId: node.registration.viewId },
    });
  } catch {
    // Audit only.
  }

  if (problems.length > 0) return { ok: false, message: problems.join(' · ') };
  return {
    ok: true,
    message: workflow.is_active
      ? 'הטריגר נרשם ב-SUMIT.'
      : 'הכתובת נשמרה. הטריגר יירשם ב-SUMIT כשתפעילו את התהליך.',
  };
}
