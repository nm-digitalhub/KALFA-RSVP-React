import 'server-only';

import { daysUntil } from '@/lib/date';

import { graphClient, graphConfigured, primaryMailbox } from './graph-client';

// Passive health check for the Microsoft 365 app identity.
//
// ⚠️ IT ASKS MICROSOFT, NOT OUR OWN TABLE, AND THAT IS THE WHOLE POINT.
// The obvious source was `exchange_connections`, and both of its readers are wrong
// for a status surface:
//
//   • listMyExchangeConnections() returns only the CALLER's rows. A card built on it
//     reads "not configured" because YOU have no mailbox, while a colleague has
//     three — the same class of lie as `null` rendered as `false`.
//   • listAllExchangeConnectionsForDebug() is org-wide but gated on
//     requirePlatformOwner(), which REDIRECTS. Composing a card from it ejects every
//     non-owner from the admin area.
//
// So `src/lib/ops/integrations.ts` deliberately carries no Microsoft row and says
// "anything composing a Microsoft card must read the dedicated source". Graph IS
// that source: the app authenticates as itself with a certificate, so what it
// reports is the tenant's state rather than one admin's slice of it.
//
// Read-only. Three GETs, no mail sent, no calendar touched, no customer data read —
// /organization is our own tenant, the mailbox probe selects three non-content
// fields, and the application read returns our own app registration.
//
// THE CERTIFICATE EXPIRY IS THE REASON THIS EXISTS. Everything Microsoft in this
// system authenticates with one certificate, and nothing watches its expiry. When it
// lapses, calendar sync and mail intake stop — not loudly, but as `auth_failed` in a
// worker log. Measured 2026-09-10: the app holds ONE credential
// (CN=KALFA Calendar Service, valid to 2031-08-14) and ZERO client secrets, which is
// the good state; a password credential appearing here later is worth seeing.
//
// It reads the expiry from GRAPH rather than from the local PEM on purpose. The two
// can disagree — a certificate rotated on disk but never uploaded to the app
// registration still parses locally and still fails every token request. Microsoft's
// copy is the one that decides.

export interface MicrosoftHealthOk {
  ok: true;
  /** Our own tenant, as Microsoft names it. */
  organization: string | null;
  /** The domains this tenant has verified — where mail can legitimately come from. */
  verifiedDomains: string[];
  /** The mailbox this deployment reads, and whether Graph can actually resolve it. */
  mailbox: string | null;
  mailboxResolves: boolean;
  /** The app registration's certificate, AS MICROSOFT HOLDS IT. */
  certName: string | null;
  certExpiresAt: string | null;
  certDaysRemaining: number | null;
  /**
   * Client secrets on the app registration. Certificate auth is what this app uses;
   * a password credential appearing is a change worth noticing, not a detail.
   */
  clientSecretCount: number | null;
}

export type MicrosoftHealthFailure =
  /** MS_GRAPH_TENANT_ID / CLIENT_ID / CERT_PATH are not all set. */
  | 'not_configured'
  /** The certificate was rejected, or the app has no consented permission. */
  | 'auth_failed'
  /** Answered, but not in a shape this code recognises. */
  | 'unexpected_response'
  /** Network, timeout, or a Graph fault. */
  | 'unreachable';

export interface MicrosoftHealthError {
  ok: false;
  kind: MicrosoftHealthFailure;
  /** Hebrew, safe to render. NEVER carries a token or a raw Graph body. */
  message: string;
}

export type MicrosoftHealth = MicrosoftHealthOk | MicrosoftHealthError;

const MESSAGES: Record<MicrosoftHealthFailure, string> = {
  not_configured: 'זהות האפליקציה מול Microsoft אינה מוגדרת',
  auth_failed: 'Microsoft דחתה את זהות האפליקציה — בדקו את התעודה ואת ההרשאות',
  unexpected_response: 'Microsoft ענתה בתבנית לא מוכרת',
  unreachable: 'לא ניתן להגיע ל-Microsoft Graph',
};

function fail(kind: MicrosoftHealthFailure): MicrosoftHealthError {
  return { ok: false, kind, message: MESSAGES[kind] };
}

interface GraphOrganization {
  displayName?: string;
  verifiedDomains?: Array<{ name?: string }>;
}

interface GraphKeyCredential {
  displayName?: string;
  endDateTime?: string;
}

interface GraphApplication {
  keyCredentials?: GraphKeyCredential[];
  passwordCredentials?: unknown[];
}

/**
 * Graph errors carry a `statusCode` on the SDK's error object. 401/403 mean the
 * identity or its consent, which an admin can act on; everything else is transport.
 */
function classify(err: unknown): MicrosoftHealthFailure {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  if (status === 401 || status === 403) return 'auth_failed';
  return 'unreachable';
}

export async function checkMicrosoftHealth(
  now: Date = new Date(),
): Promise<MicrosoftHealth> {
  if (!graphConfigured()) return fail('not_configured');

  const clientId = process.env.MS_GRAPH_CLIENT_ID ?? '';
  let mailbox: string | null = null;
  try {
    mailbox = primaryMailbox();
  } catch {
    // A missing MS_GRAPH_PRIMARY_MAILBOX is not an auth problem and must not read as
    // one — the identity can be perfectly healthy with no mailbox pointed at it.
    mailbox = null;
  }

  const client = graphClient();

  let org: GraphOrganization | null = null;
  try {
    const res = (await client
      .api('/organization')
      .select('displayName,verifiedDomains')
      .get()) as { value?: GraphOrganization[] };
    org = res?.value?.[0] ?? null;
  } catch (err) {
    return fail(classify(err));
  }
  if (!org) return fail('unexpected_response');

  // A mailbox that no longer resolves is the failure mode that looks like nothing:
  // the identity still authenticates, and only the reads against that mailbox stop.
  let mailboxResolves = false;
  if (mailbox) {
    try {
      await client
        .api(`/users/${encodeURIComponent(mailbox)}`)
        .select('displayName,mail,accountEnabled')
        .get();
      mailboxResolves = true;
    } catch {
      mailboxResolves = false;
    }
  }

  // Best-effort: Application.Read.All is consented on this tenant (measured
  // 2026-09-10) but a tenant that has not granted it must still get a working card,
  // with the certificate fields blank rather than the whole check failing.
  let certName: string | null = null;
  let certExpiresAt: string | null = null;
  let clientSecretCount: number | null = null;
  try {
    const res = (await client
      .api('/applications')
      .filter(`appId eq '${clientId}'`)
      .select('keyCredentials,passwordCredentials')
      .get()) as { value?: GraphApplication[] };
    const app = res?.value?.[0];
    if (app) {
      // The credential that expires LAST is the one that keeps the app alive; an
      // older overlapping certificate during a rotation must not read as the
      // deadline.
      const newest = (app.keyCredentials ?? [])
        .filter((k) => typeof k.endDateTime === 'string')
        .sort((a, b) => String(b.endDateTime).localeCompare(String(a.endDateTime)))[0];
      certName = newest?.displayName ?? null;
      certExpiresAt = newest?.endDateTime ?? null;
      clientSecretCount = (app.passwordCredentials ?? []).length;
    }
  } catch {
    // Leave the certificate fields null — "we could not read the expiry" is a
    // different fact from "it expires never", and the card renders it as such.
  }

  return {
    ok: true,
    organization: org.displayName ?? null,
    verifiedDomains: (org.verifiedDomains ?? [])
      .map((d) => d.name)
      .filter((n): n is string => typeof n === 'string'),
    mailbox,
    mailboxResolves,
    certName,
    certExpiresAt,
    // Graph returns a full ISO timestamp; daysUntil takes the calendar date, and the
    // hours are noise at this resolution.
    certDaysRemaining: certExpiresAt ? daysUntil(certExpiresAt.slice(0, 10), now) : null,
    clientSecretCount,
  };
}
