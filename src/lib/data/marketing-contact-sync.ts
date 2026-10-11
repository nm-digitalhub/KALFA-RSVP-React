import 'server-only';

import {
  currentConsent,
  isMarketingConsentEnabled,
  latestConsentForEmail,
  recordConsent,
} from '@/lib/data/marketing-consent';
import { resendMarketingContacts, type MarketingContactsClient } from '@/lib/email/marketing-contacts';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import {
  MARKETING_CONTACT_SYNC_RETRY,
  QUEUES,
  type MarketingContactSyncJob,
} from '@/lib/queue/queues';
import { getWebJobSender } from '@/lib/queue/web-sender';
import { createAdminClient } from '@/lib/supabase/admin';

// Keeps Resend's marketing contact list in line with the consent ledger (openspec change marketing-email-consent,
// spec marketing-contact-sync, design D5).
//
// The ledger is the record; Resend follows it — with one exception that protects the customer: a contact Resend
// holds as unsubscribed is never turned back on by a job that does not carry `resubscribe` (a grant the customer has
// just made). Any other job that finds Resend unsubscribed while the ledger says granted records that unsubscribe as
// a withdrawal, because it means the customer unsubscribed through an email and the webhook has not landed yet.
//
// CUSTOMERS ONLY: addresses come from Auth (auth.users) and the ledger, never from guests or event contacts.

type AdminClient = ReturnType<typeof createAdminClient>;

export interface SyncDeps {
  admin: AdminClient;
  contacts: MarketingContactsClient;
}

function defaultDeps(): SyncDeps {
  return { admin: createAdminClient(), contacts: resendMarketingContacts() };
}

export type SyncOutcome = 'subscribed' | 'unsubscribed' | 'unchanged' | 'no_user' | 'resend_unsubscribe_recorded';

async function ledgerAddresses(admin: AdminClient, userId: string): Promise<string[]> {
  const { data, error } = await admin.from('marketing_consent_events').select('email').eq('user_id', userId);
  if (error) throw new Error('marketing_consent_read_failed');
  return [...new Set((data ?? []).map((r) => r.email.toLowerCase()))];
}

export async function syncMarketingContact(
  job: MarketingContactSyncJob,
  deps: SyncDeps = defaultDeps(),
): Promise<SyncOutcome> {
  const { admin, contacts } = deps;
  const { data: auth, error: authError } = await admin.auth.admin.getUserById(job.userId);
  if (authError) {
    if (authError.status === 404 || authError.code === 'user_not_found') return 'no_user';
    throw new Error('auth_user_read_failed');
  }
  const user = auth.user;
  const email = user.email?.toLowerCase() ?? null;
  const confirmed = Boolean(email && user.email_confirmed_at);

  // Older addresses of this customer (an email change): never left subscribed.
  for (const old of await ledgerAddresses(admin, job.userId)) {
    if (old === email) continue;
    const contact = await contacts.get(old);
    if (contact && !contact.unsubscribed) await contacts.setUnsubscribed(old, true);
  }

  if (!email) return 'unchanged';
  const consent = await currentConsent(job.userId, admin);
  const want = consent === 'granted' && confirmed;
  const contact = await contacts.get(email);

  if (!want) {
    if (contact && !contact.unsubscribed) {
      await contacts.setUnsubscribed(email, true);
      return 'unsubscribed';
    }
    return 'unchanged';
  }

  if (!contact) {
    await contacts.create(email, false);
    return 'subscribed';
  }
  if (!contact.unsubscribed) return 'unchanged';
  if (job.resubscribe) {
    await contacts.setUnsubscribed(email, false);
    return 'subscribed';
  }
  // Resend says unsubscribed, the ledger says granted, and nobody just granted: the customer unsubscribed through an
  // email. Record it rather than override it.
  await recordConsent({ userId: job.userId, email, action: 'withdraw', source: 'provider_unsubscribe' }, admin);
  return 'resend_unsubscribe_recorded';
}

// Enqueue a sync for one customer. Deterministic per user, flag and minute, so a burst of changes collapses into one
// job. A queue failure is reported to the caller, who logs it — the daily reconcile catches it either way.
export async function enqueueMarketingContactSync(job: MarketingContactSyncJob, now: Date = new Date()): Promise<void> {
  const boss = await getWebJobSender();
  const minute = now.toISOString().slice(0, 16);
  await boss.send(QUEUES.marketingContactSync, job, {
    id: deterministicJobId(`marketing-contact-sync:${job.userId}:${job.resubscribe ? 'r' : 'n'}:${minute}`),
    ...MARKETING_CONTACT_SYNC_RETRY,
  });
}

export interface ReconcileResult {
  synced: number;
  removed: number;
  failed: number;
}

// Daily: every customer in the ledger is synced again — a grant that never reached Resend, and a withdrawal Resend
// still holds as subscribed (a sync that ran out of retries) — and a grant whose account no longer exists becomes an
// `account_removed` withdrawal plus an unsubscribe.
export async function runMarketingContactReconcile(deps?: SyncDeps): Promise<ReconcileResult> {
  const result: ReconcileResult = { synced: 0, removed: 0, failed: 0 };
  if (!(await isMarketingConsentEnabled())) return result;
  const d = deps ?? defaultDeps();

  const { data, error } = await d.admin
    .from('marketing_consent_events')
    .select('user_id, email, action, occurred_at')
    .not('user_id', 'is', null)
    .order('occurred_at', { ascending: false });
  if (error) throw new Error('marketing_consent_read_failed');

  const latest = new Map<string, { email: string; action: string }>();
  for (const row of data ?? []) {
    if (row.user_id && !latest.has(row.user_id)) latest.set(row.user_id, { email: row.email, action: row.action });
  }

  for (const [userId, last] of latest) {
    try {
      const outcome = await syncMarketingContact({ userId }, d);
      if (outcome === 'no_user' && last.action === 'grant') {
        await recordConsent({ userId, email: last.email, action: 'withdraw', source: 'account_removed' }, d.admin);
        const contact = await d.contacts.get(last.email.toLowerCase());
        if (contact && !contact.unsubscribed) await d.contacts.setUnsubscribed(last.email.toLowerCase(), true);
        result.removed++;
      } else {
        result.synced++;
      }
    } catch {
      result.failed++;
    }
  }
  return result;
}

// A provider event about one address (openspec change marketing-email-consent, design D6/D7). Only a withdrawal can come
// from the provider — consent is granted only by the customer, through our forms.
export type ProviderEventOutcome = 'not_a_customer' | 'not_granted' | 'stale' | 'recorded' | 'duplicate' | 'ignored';

// contact.updated: `unsubscribed: true` on an address whose latest ledger row is a grant OLDER than the event becomes
// a provider_unsubscribe withdrawal. Our own pushes come back here too: an unsubscribe we pushed finds the withdrawal
// already latest ('not_granted'); a resubscribe we pushed reports unsubscribed: false ('ignored').
export async function recordProviderUnsubscribe(event: {
  email: string;
  unsubscribed: boolean;
  updatedAt: string | null;
  eventId: string;
}): Promise<ProviderEventOutcome> {
  if (!event.unsubscribed) return 'ignored';
  const admin = createAdminClient();
  const latest = await latestConsentForEmail(event.email, admin);
  if (!latest) return 'not_a_customer';
  if (latest.action !== 'grant') return 'not_granted';
  if (event.updatedAt && Date.parse(event.updatedAt) <= Date.parse(latest.occurredAt)) return 'stale';
  const result = await recordConsent(
    {
      userId: latest.userId,
      email: event.email,
      action: 'withdraw',
      source: 'provider_unsubscribe',
      providerEventId: event.eventId,
    },
    admin,
  );
  return result === 'duplicate' ? 'duplicate' : 'recorded';
}

// email.complained: a complaint about ANY KALFA email ends marketing consent for that address (design D7), and the
// contact is unsubscribed at Resend through the sync job.
export async function recordProviderComplaint(event: { email: string; eventId: string }): Promise<ProviderEventOutcome> {
  const admin = createAdminClient();
  const latest = await latestConsentForEmail(event.email, admin);
  if (!latest) return 'not_a_customer';
  if (latest.action !== 'grant') return 'not_granted';
  const result = await recordConsent(
    {
      userId: latest.userId,
      email: event.email,
      action: 'withdraw',
      source: 'provider_complaint',
      providerEventId: event.eventId,
    },
    admin,
  );
  if (result === 'recorded') await enqueueMarketingContactSync({ userId: latest.userId });
  return result === 'duplicate' ? 'duplicate' : 'recorded';
}
