import 'server-only';

// SUMIT's trigger module, driven from our side: list the CRM folders and their
// views, and register / remove a trigger that POSTs a card change to a URL.
//
// Endpoints and bodies are from SUMIT's own swagger (src/lib/sumit/types.generated.ts):
//   POST /crm/schema/listfolders/      { Credentials, NameFilter? }        → Data.Folders[{ ID, Name }]
//   POST /crm/views/listviews/         { Credentials, FolderID }           → Data.Views[{ ID, Name }]
//   POST /triggers/triggers/subscribe/ { Credentials, URL, Folder, View, TriggerType }
//   POST /triggers/triggers/unsubscribe/ { Credentials, URL }
//
// ⚠️ SUMIT HAS NO "LIST TRIGGERS" ENDPOINT. A registration cannot be enumerated
// afterwards, so whoever subscribes must remember the URL to unsubscribe it —
// see src/lib/data/admin/sumit-trigger-subscriptions.ts, which keeps it in Vault.
//
// ⚠️ THE URL IS A CREDENTIAL. In `address` mode the path segment IS the secret,
// so it is never logged and never put into an error message here.

const BASE = 'https://api.sumit.co.il';
const TIMEOUT_MS = 60_000;

/** SUMIT's own change types for a trigger (swagger: TriggerType). */
export const SUMIT_TRIGGER_TYPES = ['CreateOrUpdate', 'Create', 'Update', 'Archive', 'Delete'] as const;
export type SumitTriggerType = (typeof SUMIT_TRIGGER_TYPES)[number];

export type SumitCredentials = { companyId: number; apiKey: string };
export type SumitNamedItem = { id: string; name: string };

type SumitEnvelope<T> = {
  // Numeric at runtime (0 = success), not the swagger's "Success (0)" string —
  // measured, see docs/sumit-response-capture-and-audit.md.
  Status?: unknown;
  UserErrorMessage?: string | null;
  Data?: T | null;
};

/** A SUMIT call that failed. The message is safe to show: it never carries the URL. */
export class SumitTriggerError extends Error {}

async function post<T>(path: string, creds: SumitCredentials, body: Record<string, unknown>): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Credentials: { CompanyID: creds.companyId, APIKey: creds.apiKey }, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SumitTriggerError('SUMIT לא ענתה');
  }
  if (!res.ok) throw new SumitTriggerError(`SUMIT החזירה שגיאה (HTTP ${res.status})`);
  let json: SumitEnvelope<T>;
  try {
    json = (await res.json()) as SumitEnvelope<T>;
  } catch {
    throw new SumitTriggerError('תשובה לא קריאה מ-SUMIT');
  }
  if (Number(json.Status) !== 0) {
    // SUMIT's own user-facing message is shown as-is: it is about our request
    // (a missing module, a wrong folder), never about the URL we sent.
    throw new SumitTriggerError(json.UserErrorMessage?.trim() || 'SUMIT דחתה את הבקשה');
  }
  return json.Data ?? null;
}

function toItems(rows: Array<{ ID?: number | null; Name?: string | null }> | null | undefined): SumitNamedItem[] {
  return (rows ?? [])
    .filter((r) => r.ID != null)
    .map((r) => ({ id: String(r.ID), name: r.Name?.trim() || String(r.ID) }));
}

export async function listSumitFolders(creds: SumitCredentials): Promise<SumitNamedItem[]> {
  const data = await post<{ Folders?: Array<{ ID?: number; Name?: string | null }> | null }>(
    '/crm/schema/listfolders/',
    creds,
    {},
  );
  return toItems(data?.Folders);
}

export async function listSumitViews(creds: SumitCredentials, folderId: string): Promise<SumitNamedItem[]> {
  const data = await post<{ Views?: Array<{ ID?: number; Name?: string | null }> | null }>(
    '/crm/views/listviews/',
    creds,
    { FolderID: Number(folderId) },
  );
  return toItems(data?.Views);
}

export async function subscribeSumitTrigger(
  creds: SumitCredentials,
  input: { url: string; folderId: string; viewId: string; triggerType: SumitTriggerType },
): Promise<void> {
  await post('/triggers/triggers/subscribe/', creds, {
    URL: input.url,
    // `Folder` is a string and `View` a number in SUMIT's own schema — kept as declared.
    Folder: input.folderId,
    View: Number(input.viewId),
    TriggerType: input.triggerType,
  });
}

export async function unsubscribeSumitTrigger(creds: SumitCredentials, url: string): Promise<void> {
  await post('/triggers/triggers/unsubscribe/', creds, { URL: url });
}
