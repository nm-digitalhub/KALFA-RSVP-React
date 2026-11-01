import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';

// Provider boundary only: the owner's review-link reply is the one call that
// would leave the machine. Everything else — profiles, Supabase Auth
// (auth.admin.getUserById), events, guest_import_staging — is the real local stack.
vi.mock('@/lib/whatsapp/client', () => ({
  sendWhatsAppText: vi.fn(async () => ({ kind: 'accepted', providerId: 'wamid.it-reply' })),
}));

import type { WhatsAppChannel } from '@/lib/data/outreach-config';
import {
  type AuthUser,
  FixtureScope,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from '@/lib/testing/local-integration';
import { sendWhatsAppText } from '@/lib/whatsapp/client';

// TS-INTEGRATION: the REAL stageWhatsAppImport — the sender is identified by the
// phone they PROVED through Supabase Auth's OTP, never by the number a profile
// merely carries (profiles.phone is copied from the signup form unchecked).
// MEASURED in production 2026-10-30: 14 lists had been staged to an account whose
// profile carried the sender's number while a different account had proved it.
const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;

// Legacy mode (the import role unassigned): the RSVP number stages and replies.
const CHANNEL: WhatsAppChannel = {
  phoneNumberId: 'p-it',
  wabaId: null,
  accessToken: 'local-it',
  appSecret: null,
  verifyToken: null,
  importPhoneNumberId: null,
  importDisplayNumber: null,
};

describe.skipIf(!RUN)('stageWhatsAppImport — the sender is the account that proved the number (local DB)', () => {
  let pool: Pool;
  let scope: FixtureScope;
  let stage: typeof import('@/lib/data/whatsapp-import').stageWhatsAppImport;

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me');
    pool = newPool(ENV!, 'whatsapp-import', 4);
    scope = new FixtureScope(pool);
    stage = (await import('@/lib/data/whatsapp-import')).stageWhatsAppImport;
  });
  afterAll(async () => {
    try {
      // guest_import_staging cascades from events, so the fixture cleanup covers it.
      await scope.cleanup();
    } finally {
      await pool.end();
    }
  });

  // A number no other row holds: auth.users.phone is unique.
  function freshNumber(): { local: string; e164: string; digits: string } {
    const n = String(Number.parseInt(randomUUID().replace(/-/g, '').slice(0, 8), 16) % 10_000_000).padStart(7, '0');
    return { local: `058${n}`, e164: `+97258${n}`, digits: `97258${n}` };
  }

  // A real GoTrue user (scope.createAuthUser) with one active event; both are
  // removed by the scope's cleanup (events are expanded from their owner).
  async function hostWithActiveEvent(): Promise<{ user: AuthUser; eventId: string }> {
    const user = await scope.createAuthUser(ENV!);
    const eventId = randomUUID();
    await scope.track(
      pool.query(
        `insert into public.events (id, name, owner_id, event_date) values ($1, $2, $3, now() + interval '30 days')`,
        [eventId, user.tag, user.id],
      ),
    );
    await scope.track(pool.query(`update public.events set status = 'active' where id = $1`, [eventId]));
    return { user, eventId };
  }

  // The profile's display copy, as the signup trigger or a phone change writes it.
  const carries = (user: AuthUser, phone: string) =>
    scope.track(pool.query('update public.profiles set phone = $2 where id = $1', [user.id, phone]));

  // What a passed phone_change OTP leaves in Auth, set through Auth's own admin
  // API — never a direct write to auth.users.
  const proves = async (user: AuthUser, e164: string) => {
    const admin = createSupabaseClient(ENV!.supabaseUrl, ENV!.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await scope.track(admin.auth.admin.updateUserById(user.id, { phone: e164, phone_confirm: true }));
    if (error) throw new Error(`proves: Auth refused (${error.message})`);
  };

  const stagedOn = async (eventId: string) =>
    (await pool.query('select sender_phone from public.guest_import_staging where event_id = $1', [eventId])).rows;

  const contactsFrom = (digits: string) => ({
    id: `wamid.it.${randomUUID().slice(0, 8)}`,
    type: 'contacts',
    from: digits,
    contacts: [{ name: { formatted_name: 'IT Guest' }, phones: [{ phone: '+972501112233' }] }],
  });

  it('the list goes to the account that proved the number, not to one that only typed it at signup', async () => {
    const number = freshNumber();
    const impostor = await hostWithActiveEvent();
    const owner = await hostWithActiveEvent();
    await carries(impostor.user, number.local); // typed at signup, never proved
    await carries(owner.user, number.e164);
    await proves(owner.user, number.e164);

    const consumed = await scope.track(
      stage({ phone_number_id: CHANNEL.phoneNumberId, payload: contactsFrom(number.digits) }, CHANNEL),
    );

    expect(consumed).toBe(true);
    expect(await stagedOn(owner.eventId)).toEqual([{ sender_phone: number.e164 }]);
    expect(await stagedOn(impostor.eventId)).toEqual([]);
  });

  it('a number nobody proved is not an import: nothing staged, nothing sent', async () => {
    const number = freshNumber();
    const unproved = await hostWithActiveEvent();
    await carries(unproved.user, number.local);
    vi.mocked(sendWhatsAppText).mockClear();

    const consumed = await scope.track(
      stage({ phone_number_id: CHANNEL.phoneNumberId, payload: contactsFrom(number.digits) }, CHANNEL),
    );

    expect(consumed).toBe(false);
    expect(await stagedOn(unproved.eventId)).toEqual([]);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });
});
