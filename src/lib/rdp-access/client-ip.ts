import { isIP } from 'node:net';

// The staff member's address as the PUBLIC proxy saw it.
//
// It is read from x-real-ip, which nginx sets from the socket on every request, and NEVER from x-forwarded-for:
// the client can put anything at the front of that chain (getClientIp in security/rate-limit.ts takes the first
// element, which is fine for a rate-limit bucket and wrong for anything that is recorded or bound to a token).
// A value that is not a literal IP address is treated as unknown, so attacker-shaped text never reaches the
// audit log, the database or the gateway's X-Forwarded-For header.

export function rdpClientIp(get: (name: string) => string | null): string | null {
  const value = get('x-real-ip')?.trim();
  if (!value || isIP(value) === 0) return null;
  return value;
}
