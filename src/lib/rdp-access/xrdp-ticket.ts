import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { RDP_FILE_VALID_MINUTES } from './policy';

// The short-lived ticket that lets a staff member into the shared desktop (xrdp) without typing a Linux password.
//
// WHAT IT IS. A 41-character code the app puts into the downloaded .rdp file, in the username field after a 0x1F
// separator (`kalfa.me<0x1F>k1.xxxx`). xrdp (enable_token_login) hands everything after the separator to PAM as the
// "password"; a PAM line then asks the app, over loopback, whether it is valid. xrdp and PAM validate nothing by
// themselves.
//
// WHAT IT PROVES. Nothing is stored. The code is a keyed MAC (HMAC-SHA256, 128 bits) over the grant, the requester
// and the Linux account, plus an expiry and a random nonce. The check recomputes the MAC from the grant that is
// active RIGHT NOW, so:
//   - it is bound to one requester, one grant and one account: a ticket from another grant, user or account fails;
//   - revoking or ending the grant (or approving another one) breaks every ticket already downloaded, at once;
//   - it expires 5 minutes after the download, like the gateway's own token;
//   - it carries no secret an attacker could read: it is a MAC, not an encrypted payload.
//
// WHAT IT IS NOT. It is not a password: anyone who holds a valid ticket can use it until it expires, is used (see
// createOnceGuard) or the grant ends. The gateway token that sits in the same file is bound to the client address;
// this one cannot be, because xrdp sees the gateway, not the client.
//
// SIZE. The whole connection cookie (host, user, separator, ticket) must stay under ~255 bytes (rdpgw issue 106), so
// the ticket is short on purpose; a JWT does not fit.

export const XRDP_TICKET_PREFIX = 'k1.';
/** `k1.` + 28 bytes (8 nonce, 4 expiry, 16 MAC) as base64url without padding. */
export const XRDP_TICKET_PATTERN = /^k1\.[A-Za-z0-9_-]{38}$/;
/** Longest `account + separator + ticket` the file may carry, with room for the client's own cookie parts. */
export const XRDP_LOGON_MAX_CHARS = 120;

const NONCE_BYTES = 8;
const EXPIRY_BYTES = 4;
const MAC_BYTES = 16;
const TTL_SECONDS = RDP_FILE_VALID_MINUTES * 60;
/** A ticket whose expiry lies further ahead than this is not one this app minted. */
const MAX_FUTURE_SECONDS = TTL_SECONDS + 60;

export type XrdpTicketBinding = {
  secret: string;
  grantId: string;
  userId: string;
  account: string;
};

function mac(binding: XrdpTicketBinding, expirySeconds: number, nonce: Buffer): Buffer {
  const input = ['kalfa-xrdp-ticket/v1', binding.grantId, binding.userId, binding.account, String(expirySeconds), nonce.toString('hex')].join('\0');
  return createHmac('sha256', binding.secret).update(input).digest().subarray(0, MAC_BYTES);
}

/** Mints a ticket valid for the same 5 minutes as the gateway token. */
export function mintXrdpTicket(binding: XrdpTicketBinding, now: Date): string {
  const expiry = Math.floor(now.getTime() / 1000) + TTL_SECONDS;
  const nonce = randomBytes(NONCE_BYTES);
  const expiryBytes = Buffer.alloc(EXPIRY_BYTES);
  expiryBytes.writeUInt32BE(expiry);
  const body = Buffer.concat([nonce, expiryBytes, mac(binding, expiry, nonce)]);
  return XRDP_TICKET_PREFIX + body.toString('base64url');
}

export type XrdpTicketCheck =
  | { ok: true; /** Identifies this exact ticket (its MAC), for the one-use guard. Safe to log. */ id: string; expiresAt: Date }
  | { ok: false; reason: 'shape' | 'expired' | 'mismatch' };

/**
 * Checks a presented ticket against what is true NOW. The caller supplies the active grant, its requester and the
 * account the login is for; a ticket minted for anything else fails with `mismatch`.
 */
export function verifyXrdpTicket(ticket: string, binding: XrdpTicketBinding, now: Date): XrdpTicketCheck {
  if (!XRDP_TICKET_PATTERN.test(ticket)) return { ok: false, reason: 'shape' };
  const body = Buffer.from(ticket.slice(XRDP_TICKET_PREFIX.length), 'base64url');
  if (body.length !== NONCE_BYTES + EXPIRY_BYTES + MAC_BYTES) return { ok: false, reason: 'shape' };

  const nonce = body.subarray(0, NONCE_BYTES);
  const expiry = body.readUInt32BE(NONCE_BYTES);
  const presented = body.subarray(NONCE_BYTES + EXPIRY_BYTES);

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (expiry <= nowSeconds) return { ok: false, reason: 'expired' };
  if (expiry - nowSeconds > MAX_FUTURE_SECONDS) return { ok: false, reason: 'mismatch' };

  const expected = mac(binding, expiry, nonce);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return { ok: false, reason: 'mismatch' };
  return { ok: true, id: presented.toString('hex'), expiresAt: new Date(expiry * 1000) };
}

/**
 * Remembers which tickets were already used, so one ticket logs in once. In memory and per process: a restart forgets
 * (the ticket then works again until it expires, at most 5 minutes). It is a second line, not the first: the MAC and
 * the live grant are what decide.
 */
export function createOnceGuard(maxEntries = 1000): { consume: (id: string, expiresAt: Date, now: Date) => boolean } {
  const used = new Map<string, number>();
  return {
    /** True the first time an id is seen (and records it), false afterwards. */
    consume(id, expiresAt, now) {
      for (const [key, expiry] of used) if (expiry <= now.getTime()) used.delete(key);
      if (used.has(id)) return false;
      // a full table means a flood: refuse to grow rather than forget a ticket that is still valid
      if (used.size >= maxEntries) return false;
      used.set(id, expiresAt.getTime());
      return true;
    },
  };
}
