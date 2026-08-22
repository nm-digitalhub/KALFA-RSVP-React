import { createHash } from 'node:crypto';

// pgboss.job.id is a strict `uuid` column — a composite string like
// `meeting-confirm:<uuid>:<timestamp>` passed directly as boss.send()'s `id`
// throws 22P02 ("invalid input syntax for type uuid") at insert time. This
// is the exact bug found live 2026-08-22: enqueueMeetingConfirmDispatch had
// been silently failing on every single call since it was built (confirmed
// via worker error log), and enqueueSalesCallDispatch mirrored the same
// broken pattern before ever going live. The correct approach — already
// proven in src/lib/outreach/schedule.ts's own uuidv5() (detId/deferId,
// billing-critical, in production) — is to hash the composite string down
// into a real, deterministic UUIDv5. Same inputs → same id, so a duplicate
// enqueue is a silent no-op (ON CONFLICT DO NOTHING), exactly like every
// other deterministic-id queue in this codebase.
// Same fixed namespace constant as schedule.ts's own uuidv5() — the value
// itself is arbitrary (any fixed constant works), reused here purely for
// consistency across the codebase's deterministic-id helpers.
const UUID_NS = '5b1d0e3a-9b7c-4f2a-8e6d-0c1a2b3c4d5e';

export function deterministicJobId(name: string): string {
  const nsBytes = Buffer.from(UUID_NS.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC-4122 variant
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
