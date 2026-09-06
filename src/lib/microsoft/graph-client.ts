import 'server-only';

import { ClientCertificateCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

// The one place a Microsoft Graph client is built. Vendor-named on purpose,
// the same way `src/lib/supabase/` is: this is client construction, not a
// domain — the domains that use it (calendar, mail intake) stay named for what
// they do.
//
// Two properties are load-bearing and easy to lose by rebuilding a client per
// call: MSAL caches and refreshes tokens PER CREDENTIAL INSTANCE, and the SDK's
// middleware handles Graph's 429s with its own retry/backoff before a failure
// ever reaches calling code. Graph throttles at 10,000 requests / 10 min and
// only 4 concurrent per app+mailbox, so both matter. A hand-rolled `fetch`
// wrapper would silently drop them.
//
// The app authenticates ONCE as itself with a certificate; a mailbox address is
// only ever an argument naming WHICH mailbox to act on, never a credential.

// Read LAZILY, never at module scope. The worker loads .env.local from its own
// module body (worker/main.ts loadEnv()), and imports are evaluated BEFORE that
// body runs — so a module-level `process.env.X` here captures '' and every call
// afterwards fails with graph_config_missing, mapped to auth_failed. That is
// exactly what happened: the calendar sync failed silently in the worker every
// 10 minutes while working perfectly under `node --env-file=`.
function env(name: string): string {
  return process.env[name] ?? '';
}

let cachedClient: Client | null = null;

/** Throws `graph_config_missing` when the app identity is not configured. */
export function graphClient(): Client {
  if (cachedClient) return cachedClient;
  const tenantId = env('MS_GRAPH_TENANT_ID');
  const clientId = env('MS_GRAPH_CLIENT_ID');
  const certPath = env('MS_GRAPH_CERT_PATH');
  if (!tenantId || !clientId || !certPath) {
    throw new Error('graph_config_missing');
  }
  const credential = new ClientCertificateCredential(tenantId, clientId, certPath);
  cachedClient = Client.initWithMiddleware({
    authProvider: new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    }),
  });
  return cachedClient;
}

/** True when the app identity is configured at all — for health surfaces. */
export function graphConfigured(): boolean {
  return Boolean(
    env('MS_GRAPH_TENANT_ID') && env('MS_GRAPH_CLIENT_ID') && env('MS_GRAPH_CERT_PATH'),
  );
}

let cachedArchiveClient: Client | null = null;

/**
 * The LEAST-PRIVILEGE identity for the SharePoint contracts archive jobs
 * (scripts/sharepoint-archive-identity.cjs). That app holds a single Graph
 * permission, `Sites.Selected`, which grants nothing on its own — access is
 * granted per site, and only on the two archive sites. The main identity
 * above holds Sites.FullControl.All and directory-write roles, so the
 * unattended nightly job that touches customer PII should not use it.
 *
 * Falls back to graphClient() when MS_ARCHIVE_* is not configured, so the
 * jobs keep working before/while the identity is rolled out. Callers do not
 * branch: the fallback is the safe default, not a silent downgrade of intent.
 */
export function archiveGraphClient(): Client {
  if (cachedArchiveClient) return cachedArchiveClient;
  const tenantId = env('MS_ARCHIVE_TENANT_ID');
  const clientId = env('MS_ARCHIVE_CLIENT_ID');
  const certPath = env('MS_ARCHIVE_CERT_PATH');
  if (!tenantId || !clientId || !certPath) return graphClient();
  const credential = new ClientCertificateCredential(tenantId, clientId, certPath);
  cachedArchiveClient = Client.initWithMiddleware({
    authProvider: new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    }),
  });
  return cachedArchiveClient;
}

/** Which identity the archive jobs will actually use — for logs and health surfaces. */
export function archiveIdentity(): 'dedicated' | 'shared' {
  return env('MS_ARCHIVE_TENANT_ID') && env('MS_ARCHIVE_CLIENT_ID') && env('MS_ARCHIVE_CERT_PATH')
    ? 'dedicated'
    : 'shared';
}

/**
 * The mailbox this deployment reads. Named separately from the calendar's
 * `exchange_connections` row because mail intake is not a per-connection
 * feature — there is one business mailbox, and pointing it somewhere else is a
 * deployment decision rather than an admin one.
 */
export function primaryMailbox(): string {
  const mailbox = env('MS_GRAPH_PRIMARY_MAILBOX');
  if (!mailbox) throw new Error('graph_mailbox_missing');
  return mailbox;
}

/** `/users/{mailbox}` with the address escaped for use in a Graph path. */
export function mailboxPath(mailbox: string): string {
  return `/users/${encodeURIComponent(mailbox)}`;
}
