import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { CARDCOM_TEST_TERMINAL } from '@/lib/data/cardcom-config';
import { LEDGER_TEST_TERMINAL } from '@/test/ledger-stamp-trigger';

import { cardcomTakesPurchase } from './provider';

// Whether a package purchase is open to this buyer. Closed unless the CardCom switch is explicitly on — and on CardCom's
// published test terminal (1000), where nothing is charged, open only to someone who may configure the integration: a
// customer never gets a "payment" that moves no money and still activates a campaign. The one exception is a server on a
// local database (no real customer there): every buyer is on the test terminal.

const HOSTED_DB = 'https://abcdefghijklmnopqrst.supabase.co';
const LOCAL_DB = 'http://127.0.0.1:54321';

const cfg = (over = {}) => ({ terminalNumber: 1001, apiName: 'x', enabled: true, saveCardOnPurchase: false, googlePayMode: 'off' as const, ...over });

describe('cardcomTakesPurchase', () => {
  // The hosted project unless a case says otherwise: the database address is the one input that is not an argument.
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED_DB));
  afterEach(() => vi.unstubAllEnvs());

  it('is closed when CardCom is not configured', () => {
    expect(cardcomTakesPurchase(null, false)).toBe(false);
  });

  it('is closed while the switch is off', () => {
    expect(cardcomTakesPurchase(cfg({ enabled: false }), true)).toBe(false);
  });

  it('is open on a real terminal, for everyone', () => {
    expect(cardcomTakesPurchase(cfg(), false)).toBe(true);
    expect(cardcomTakesPurchase(cfg(), true)).toBe(true);
  });

  it('on the test terminal is open only to a platform admin; a customer is refused', () => {
    expect(cardcomTakesPurchase(cfg({ terminalNumber: 1000 }), true)).toBe(true);
    expect(cardcomTakesPurchase(cfg({ terminalNumber: 1000 }), false)).toBe(false);
  });

  it('on a local database the test terminal is open to every buyer', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', LOCAL_DB);
    expect(cardcomTakesPurchase(cfg({ terminalNumber: 1000 }), false)).toBe(true);
    expect(cardcomTakesPurchase(cfg({ terminalNumber: 1000 }), true)).toBe(true);
  });

  it('on a local database the switch still decides first', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', LOCAL_DB);
    expect(cardcomTakesPurchase(cfg({ terminalNumber: 1000, enabled: false }), false)).toBe(false);
    expect(cardcomTakesPurchase(null, false)).toBe(false);
  });
});

// The terminal that moves no money is ONE number, and three places hold it: the customer gate in the code (CARDCOM_TEST_TERMINAL), the
// ledger double the tests use, and the database function that gives every payment row its class (payment_is_test_terminal). The code
// cannot ask the database on every gate, so the constant stays - and this pins the three together by reading the migration that
// DEFINES the function. Adding a terminal is a reviewed migration that edits the function; it must edit this test in the same change.
describe('the no-money terminal is one number, in the code, the test double and the database', () => {
  const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
  const definers = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => /create\s+(or\s+replace\s+)?function\s+public\.payment_is_test_terminal/i.test(readFileSync(join(MIGRATIONS, f), 'utf8')));

  it('is defined by a migration', () => {
    expect(definers.length).toBeGreaterThan(0);
  });

  it('the newest definition compares the terminal with exactly CARDCOM_TEST_TERMINAL', () => {
    const sql = readFileSync(join(MIGRATIONS, definers[definers.length - 1]), 'utf8');
    const from = sql.search(/create\s+(or\s+replace\s+)?function\s+public\.payment_is_test_terminal/i);
    const body = sql.slice(from, sql.indexOf('$$;', from));
    // A different shape (a list of terminals) is a deliberate change: this fails loudly so the constant and the double are revisited.
    const found = /coalesce\(\s*p_terminal\s*=\s*(\d+)\s*,\s*false\s*\)/.exec(body);
    expect(found, 'payment_is_test_terminal changed shape: update CARDCOM_TEST_TERMINAL, the ledger double and this test together').not.toBeNull();
    expect(Number(found?.[1])).toBe(CARDCOM_TEST_TERMINAL);
    expect(Number(found?.[1])).toBe(LEDGER_TEST_TERMINAL);
  });
});
