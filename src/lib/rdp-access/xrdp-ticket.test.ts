import { describe, expect, it } from 'vitest';

import {
  createOnceGuard,
  mintXrdpTicket,
  verifyXrdpTicket,
  XRDP_LOGON_MAX_CHARS,
  XRDP_TICKET_PATTERN,
  XRDP_TICKET_PREFIX,
  type XrdpTicketBinding,
} from './xrdp-ticket';

const NOW = new Date('2026-10-07T00:00:00.000Z');
const BINDING: XrdpTicketBinding = {
  secret: 's'.repeat(40),
  grantId: '01a11371-4346-7ea0-8317-7fe978b09bce',
  userId: '11111111-1111-4111-8111-111111111111',
  account: 'kalfa.me',
};
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe('mintXrdpTicket', () => {
  it('has a fixed short shape that fits the connection cookie with room to spare', () => {
    const ticket = mintXrdpTicket(BINDING, NOW);
    expect(ticket).toMatch(XRDP_TICKET_PATTERN);
    expect(ticket.startsWith(XRDP_TICKET_PREFIX)).toBe(true);
    expect(ticket).toHaveLength(41);
    expect(BINDING.account.length + 1 + ticket.length).toBeLessThan(XRDP_LOGON_MAX_CHARS);
  });

  it('is different every time, even for the same binding and instant', () => {
    expect(new Set(Array.from({ length: 50 }, () => mintXrdpTicket(BINDING, NOW))).size).toBe(50);
  });

  it('does not contain the grant, the user, the account or the secret in readable form', () => {
    const ticket = mintXrdpTicket(BINDING, NOW);
    const decoded = Buffer.from(ticket.slice(3), 'base64url').toString('latin1');
    for (const secretThing of [BINDING.secret, BINDING.grantId, BINDING.userId, BINDING.account]) {
      expect(ticket).not.toContain(secretThing);
      expect(decoded).not.toContain(secretThing);
    }
  });
});

describe('verifyXrdpTicket', () => {
  it('accepts the ticket for the grant, requester and account it was minted for, until it expires', () => {
    const ticket = mintXrdpTicket(BINDING, NOW);
    const ok = verifyXrdpTicket(ticket, BINDING, at(10));
    expect(ok).toMatchObject({ ok: true, expiresAt: at(300) });
    expect(ok.ok && ok.id).toMatch(/^[0-9a-f]{32}$/);
    expect(verifyXrdpTicket(ticket, BINDING, at(299)).ok).toBe(true);
  });

  it('refuses it at and after the expiry (5 minutes from the download)', () => {
    const ticket = mintXrdpTicket(BINDING, NOW);
    expect(verifyXrdpTicket(ticket, BINDING, at(300))).toEqual({ ok: false, reason: 'expired' });
    expect(verifyXrdpTicket(ticket, BINDING, at(3600))).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses it for a different grant, requester, account or secret: this is what makes revoking work', () => {
    const ticket = mintXrdpTicket(BINDING, NOW);
    for (const other of [
      { ...BINDING, grantId: '01a11371-4346-7ea0-8317-7fe978b09bcf' },
      { ...BINDING, userId: '22222222-2222-4222-8222-222222222222' },
      { ...BINDING, account: 'root' },
      { ...BINDING, account: 'Kalfa.me' },
      { ...BINDING, secret: 'x'.repeat(40) },
    ]) {
      expect(verifyXrdpTicket(ticket, other, at(10))).toEqual({ ok: false, reason: 'mismatch' });
    }
  });

  it('refuses a ticket that was changed in any position', () => {
    const ticket = mintXrdpTicket(BINDING, NOW);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = XRDP_TICKET_PREFIX.length; i < ticket.length; i += 1) {
      // Flip the character's top bit. Every base64url character carries its top bit as data, so the decoded bytes
      // always change. Swapping in 'A' or 'B' instead left the bytes identical whenever the last character was
      // one of A-P: its four trailing bits are padding, so the test failed on about one run in four.
      const flipped = alphabet[alphabet.indexOf(ticket[i]) ^ 32];
      const changed = ticket.slice(0, i) + flipped + ticket.slice(i + 1);
      const result = verifyXrdpTicket(changed, BINDING, at(10));
      expect(result.ok, `position ${i}`).toBe(false);
    }
  });

  it('refuses a ticket whose expiry was pushed forward, even if everything else is intact', () => {
    const ticket = mintXrdpTicket(BINDING, NOW);
    const body = Buffer.from(ticket.slice(3), 'base64url');
    body.writeUInt32BE(body.readUInt32BE(8) + 3600, 8);
    const forged = XRDP_TICKET_PREFIX + body.toString('base64url');
    expect(verifyXrdpTicket(forged, BINDING, at(10)).ok).toBe(false);
  });

  it('refuses anything that is not shaped like a ticket, before any computation', () => {
    for (const bad of ['', 'k1.', 'k1.' + 'A'.repeat(37), 'k1.' + 'A'.repeat(39), 'k2.' + 'A'.repeat(38), 'k1.' + '!'.repeat(38), 'password123', 'k1.' + 'A'.repeat(38) + '\n']) {
      expect(verifyXrdpTicket(bad, BINDING, at(10))).toEqual({ ok: false, reason: 'shape' });
    }
  });

  it('refuses a ticket from the future beyond what this app would mint', () => {
    const early = mintXrdpTicket(BINDING, at(7200));
    expect(verifyXrdpTicket(early, BINDING, NOW)).toEqual({ ok: false, reason: 'mismatch' });
  });
});

describe('createOnceGuard', () => {
  it('lets a ticket through once and refuses it afterwards', () => {
    const guard = createOnceGuard();
    expect(guard.consume('a', at(300), NOW)).toBe(true);
    expect(guard.consume('a', at(300), at(1))).toBe(false);
    expect(guard.consume('b', at(300), at(1))).toBe(true);
  });

  it('forgets a ticket only after it has expired anyway', () => {
    const guard = createOnceGuard();
    guard.consume('a', at(300), NOW);
    expect(guard.consume('a', at(300), at(299))).toBe(false);
    expect(guard.consume('a', at(600), at(301))).toBe(true);
  });

  it('refuses to grow without bound instead of forgetting a ticket that is still valid', () => {
    const guard = createOnceGuard(3);
    expect([1, 2, 3, 4].map((n) => guard.consume(`t${n}`, at(300), NOW))).toEqual([true, true, true, false]);
    expect(guard.consume('t1', at(300), at(1))).toBe(false);
  });
});
