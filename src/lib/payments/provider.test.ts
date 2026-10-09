import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { CARDCOM_TEST_TERMINAL } from '@/lib/data/cardcom-config';
import { LEDGER_TEST_TERMINAL } from '@/test/ledger-stamp-trigger';

import { resolvePurchaseProvider } from './provider';

// Which clearing company takes a package purchase. SUMIT unless the CardCom pilot is explicitly on — and on CardCom's
// published test terminal (1000), where nothing is charged, only for someone who may configure the integration:
// everyone else keeps paying through SUMIT, never through a "payment" that moves no money and still activates a campaign.

const cfg = (over = {}) => ({ terminalNumber: 1001, apiName: 'x', enabled: true, ...over });

describe('resolvePurchaseProvider', () => {
  it('is SUMIT when CardCom is not configured', () => {
    expect(resolvePurchaseProvider(null, false)).toBe('sumit');
  });

  it('is SUMIT while the pilot switch is off', () => {
    expect(resolvePurchaseProvider(cfg({ enabled: false }), true)).toBe('sumit');
  });

  it('is CardCom on a real terminal, for everyone', () => {
    expect(resolvePurchaseProvider(cfg(), false)).toBe('cardcom');
    expect(resolvePurchaseProvider(cfg(), true)).toBe('cardcom');
  });

  it('on the test terminal is CardCom only for a platform admin; a customer stays on SUMIT', () => {
    expect(resolvePurchaseProvider(cfg({ terminalNumber: 1000 }), true)).toBe('cardcom');
    expect(resolvePurchaseProvider(cfg({ terminalNumber: 1000 }), false)).toBe('sumit');
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
