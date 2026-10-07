import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getActiveRdpGrant = vi.fn();
vi.mock('./queries', async (importActual) => ({
  ...(await importActual<typeof import('./queries')>()),
  getActiveRdpGrant: (...a: unknown[]) => getActiveRdpGrant(...a),
}));

import { decideXrdpLogin } from './xrdp-login';
import { createOnceGuard, mintXrdpTicket } from './xrdp-ticket';

const NOW = new Date('2026-10-07T10:00:00.000Z');
const GRANT = '01a11371-4346-7ea0-8317-7fe978b09bce';
const STAFF = '11111111-1111-4111-8111-111111111111';
const CONFIG = { ticketSecret: 't'.repeat(40), account: 'desktopuser' };
const mint = (over: Partial<{ grantId: string; userId: string; account: string; secret: string }> = {}, at = NOW) =>
  mintXrdpTicket({ secret: CONFIG.ticketSecret, grantId: GRANT, userId: STAFF, account: CONFIG.account, ...over }, at);

const rpc = vi.fn();
const admin = { rpc: (...a: unknown[]) => rpc(...a) } as never;
const decide = (ticket: string, user = CONFIG.account, now = NOW, once = createOnceGuard()) =>
  decideXrdpLogin({ admin, now, once }, CONFIG, { ticket, user });

beforeEach(() => {
  getActiveRdpGrant.mockReset();
  rpc.mockReset();
  getActiveRdpGrant.mockResolvedValue({ id: GRANT, user_id: STAFF, status: 'active' });
  rpc.mockResolvedValue({ data: true, error: null });
});

describe('decideXrdpLogin', () => {
  it('allows the ticket of the active grant for the configured account, and checks the live permission', async () => {
    await expect(decide(mint())).resolves.toEqual({ allow: true, grantId: GRANT });
    expect(rpc).toHaveBeenCalledWith('has_platform_permission_for_user', { _key: 'rdp.request', _user_id: STAFF });
  });

  it('refuses another account than the configured one before touching the database', async () => {
    for (const user of ['root', 'someoneelse', 'DesktopUser']) {
      await expect(decide(mint(), user)).resolves.toEqual({ allow: false, reason: 'wrong_account' });
    }
    expect(getActiveRdpGrant).not.toHaveBeenCalled();
  });

  it('refuses every ticket once there is no active grant: revoking blocks files already downloaded', async () => {
    const ticket = mint();
    getActiveRdpGrant.mockResolvedValue(null);
    await expect(decide(ticket)).resolves.toEqual({ allow: false, reason: 'no_active_grant' });
  });

  it('refuses a ticket from an earlier grant after another one was approved', async () => {
    const ticket = mint({ grantId: '01a11371-4346-7ea0-8317-7fe978b09bcf' });
    await expect(decide(ticket)).resolves.toEqual({ allow: false, reason: 'mismatch' });
  });

  it('refuses a ticket minted for a different requester than the grant holder', async () => {
    const ticket = mint({ userId: '22222222-2222-4222-8222-222222222222' });
    await expect(decide(ticket)).resolves.toEqual({ allow: false, reason: 'mismatch' });
  });

  it('refuses a ticket minted for another account or with another secret', async () => {
    await expect(decide(mint({ account: 'root' }))).resolves.toEqual({ allow: false, reason: 'mismatch' });
    await expect(decide(mint({ secret: 'x'.repeat(40) }))).resolves.toEqual({ allow: false, reason: 'mismatch' });
  });

  it('refuses an expired ticket', async () => {
    const later = new Date(NOW.getTime() + 301_000);
    await expect(decide(mint(), CONFIG.account, later)).resolves.toEqual({ allow: false, reason: 'expired' });
  });

  it('refuses when the grant has no requester recorded', async () => {
    getActiveRdpGrant.mockResolvedValue({ id: GRANT, user_id: null, status: 'active' });
    await expect(decide(mint())).resolves.toEqual({ allow: false, reason: 'grant_without_user' });
  });

  it('refuses when the requester no longer holds the staff permission', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(decide(mint())).resolves.toEqual({ allow: false, reason: 'no_permission' });
  });

  it('treats anything but a literal true from the permission check as no permission', async () => {
    for (const data of [null, 'true', 1, undefined]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(decide(mint())).resolves.toEqual({ allow: false, reason: 'no_permission' });
    }
  });

  it('lets a ticket in once and refuses it the second time', async () => {
    const once = createOnceGuard();
    const ticket = mint();
    await expect(decide(ticket, CONFIG.account, NOW, once)).resolves.toMatchObject({ allow: true });
    await expect(decide(ticket, CONFIG.account, NOW, once)).resolves.toEqual({ allow: false, reason: 'used' });
  });

  it('does not use up a ticket that was refused for another reason', async () => {
    const once = createOnceGuard();
    const ticket = mint();
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(decide(ticket, CONFIG.account, NOW, once)).resolves.toMatchObject({ allow: false });
    await expect(decide(ticket, CONFIG.account, NOW, once)).resolves.toMatchObject({ allow: true });
  });

  it('throws, rather than allows, when the database fails', async () => {
    getActiveRdpGrant.mockRejectedValue(new Error('down'));
    await expect(decide(mint())).rejects.toThrow();
    getActiveRdpGrant.mockResolvedValue({ id: GRANT, user_id: STAFF });
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(decide(mint())).rejects.toThrow();
  });

  it('never puts the ticket in a thrown error', async () => {
    const ticket = mint();
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(decide(ticket)).rejects.not.toThrow(ticket);
  });
});
