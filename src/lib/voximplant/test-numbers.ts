import { normalizePhone } from '@/lib/phone';

// The numbers an operator script may dial on its own say-so (openspec/changes/dnc-registry-dial-gate, D10).
//
// The ops scripts in scripts/voximplant/ reach the provider directly, outside every consent and Do-Not-Call gate, and
// several take a free --to. A destination that is not a product record's own number is therefore allowed only when it
// is on this list: server env VOX_TEST_NUMBERS, comma-separated, each normalized to E.164. An empty or missing list
// allows nothing.

export function testNumberAllowlist(raw: string | undefined = process.env.VOX_TEST_NUMBERS): ReadonlySet<string> {
  const numbers = (raw ?? '')
    .split(',')
    .map((n) => normalizePhone(n.trim()))
    .filter((n): n is string => n !== null);
  return new Set(numbers);
}

/** The E.164 form of `rawTo` when it is on the allowlist; null otherwise. */
export function allowedTestDestination(rawTo: string, allowlist: ReadonlySet<string> = testNumberAllowlist()): string | null {
  const phone = normalizePhone(rawTo);
  return phone && allowlist.has(phone) ? phone : null;
}
