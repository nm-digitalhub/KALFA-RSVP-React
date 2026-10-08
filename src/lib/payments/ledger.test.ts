import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';
import { withLedgerStamp } from '@/test/ledger-stamp-trigger';
import { beginOperation, completeOperation, currentCard, getOperation, latestOperation, loadOperations, OperationStateError, recordOperation, refundsOfRequest } from './ledger';

// What the BEFORE INSERT trigger does in the database: it snapshots the registry's once_per_campaign flag onto the
// row (once_slot), and the partial unique index only looks at rows that carry it. A double with no trigger would let
// every "once per campaign" test pass for the wrong reason. It also stamps the row the way the trigger does (is_test from the
// terminal, a child from its parent), so a test of the stamp cannot pass for the wrong reason either.
const ONCE_KINDS = new Set(['authorize', 'charge', 'package_purchase']);
const trigger = { beforeInsert: withLedgerStamp((_table: string, row: TableRow) => ({ ...row, once_slot: ONCE_KINDS.has(String(row.kind)) })) };

describe('ledger writes', () => {
  it('recordOperation inserts one row and returns its id', async () => {
    const db = createFakeTableClient({ payment_operations: [] });
    const id = await recordOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'authorize', outcome: 'succeeded', amount: 200, providerAuthRef: '055528' });
    expect(id).toBeTruthy();
    expect(db.rows('payment_operations')).toMatchObject([{ campaign_id: 'c1', kind: 'authorize', outcome: 'succeeded', amount: 200, source: 'app' }]);
  });
  it('a charge after a succeeded charge is rejected by once_uq', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'b', campaign_id: 'c1', kind: 'charge', outcome: 'succeeded', once_slot: true }] }, {}, { ...trigger, uniqueIndexes: [{ columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } }] });
    expect(await beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 120 })).toEqual({ alreadyInProgress: true });
  });
  it('a charge after a REVIEW charge is rejected too (SUMIT may have charged); after a failed one it is allowed', async () => {
    const idx = { ...trigger, uniqueIndexes: [{ columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } }] };
    const reviewed = createFakeTableClient({ payment_operations: [{ id: 'r', campaign_id: 'c1', kind: 'charge', outcome: 'review', once_slot: true }] }, {}, idx);
    expect(await beginOperation(reviewed.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 120 })).toEqual({ alreadyInProgress: true });
    const failed = createFakeTableClient({ payment_operations: [{ id: 'f', campaign_id: 'c1', kind: 'charge', outcome: 'failed', once_slot: true }] }, {}, idx);
    expect('id' in (await beginOperation(failed.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 120 }))).toBe(true);
  });
  it('beginOperation acquires the lock; a second begin for the same campaign+kind reports alreadyInProgress (23505)', async () => {
    const db = createFakeTableClient({ payment_operations: [] }, {}, { uniqueIndexes: [{ columns: ['campaign_id', 'kind'], where: { outcome: 'pending' } }] });
    const a = await beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 120 });
    const b = await beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 120 });
    expect('id' in a).toBe(true);
    expect(b).toEqual({ alreadyInProgress: true });
  });
  it('completeOperation can keep provider extras in meta (the caller passes the merged meta back)', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending', meta: { provider: 'cardcom', payerUserId: 'u1' } }] });
    await completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'succeeded', amount: 149, meta: { provider: 'cardcom', payerUserId: 'u1', cardcom_document_type: 'Receipt' } });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', meta: { provider: 'cardcom', payerUserId: 'u1', cardcom_document_type: 'Receipt' } });
  });
  it('completeOperation leaves meta alone when none is given', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending', meta: { provider: 'cardcom' } }] });
    await completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'failed' });
    expect(db.rows('payment_operations')[0].meta).toEqual({ provider: 'cardcom' });
  });
  it('completeOperation finishes the pending row once; completing it again throws', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'charge', outcome: 'pending' }] });
    await completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'succeeded', amount: 120, providerDocument: { id: 7, number: 1, url: 'u' } });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', amount: 120, provider_document_id: 7 });
    await expect(completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'failed' })).rejects.toThrow();
  });
  it('compare-and-set: an admin resolve (from review) cannot touch a row that is still pending, and vice versa', async () => {
    const pending = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'charge', outcome: 'pending' }] });
    await expect(completeOperation(pending.client as never, 'p1', { from: 'review', outcome: 'succeeded', amount: 120 })).rejects.toThrow();
    expect(pending.rows('payment_operations')[0].outcome).toBe('pending');
    const reviewed = createFakeTableClient({ payment_operations: [{ id: 'r1', campaign_id: 'c1', kind: 'charge', outcome: 'review' }] });
    await expect(completeOperation(reviewed.client as never, 'r1', { from: 'pending', outcome: 'failed' })).rejects.toThrow();
    await completeOperation(reviewed.client as never, 'r1', { from: 'review', outcome: 'succeeded', amount: 120, providerDocument: { id: 9, number: 2, url: 'u' }, note: 'confirmed in SUMIT by admin' });
    expect(reviewed.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', provider_document_id: 9 });
  });
  it('the authorize completion attaches the payment method created after SUMIT answered', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'a1', campaign_id: 'c1', kind: 'authorize', outcome: 'pending', card_token_ref: null }] });
    await completeOperation(db.client as never, 'a1', { from: 'pending', outcome: 'succeeded', amount: 200, card: { methodType: '1', tokenRef: 'tok', expMonth: 7, expYear: 2031, last4: '9183', mask: 'XXXXXXXXXXXX9183', citizenSecretId: 's-1' }, providerAuthRef: '055528' });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', card_token_ref: 'tok', card_last4: '9183', citizen_id_secret: 's-1', provider_auth_ref: '055528' });
  });
  it('a provider other than SUMIT records what it says about the card, its token and the Vault id of the holder ID, in the card columns', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending', card_token_ref: null }] });
    await completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'succeeded', amount: 200, cardFacts: { last4: '0008', expMonth: 12, expYear: 2030, brand: 'Visa', issuer: 'CAL', tokenRef: 'tok-cardcom', citizenSecretId: 'secret-1' } });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', card_last4: '0008', card_exp_month: 12, card_exp_year: 2030, card_brand: 'Visa', card_issuer: 'CAL', card_token_ref: 'tok-cardcom', citizen_id_secret: 'secret-1' });
    // The provider gives neither a payment-method type nor a mask: nothing is invented for them.
    expect(db.rows('payment_operations')[0].payment_method_type ?? null).toBeNull();
    expect(db.rows('payment_operations')[0].card_mask ?? null).toBeNull();
  });
  it('the provider\'s record of the payment goes to its own columns, and an absent one writes nothing', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p3', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending', provider_rrn: 'kept' }] });
    await completeOperation(db.client as never, 'p3', {
      from: 'pending', outcome: 'succeeded', amount: 200,
      paymentFacts: { cardOwnerName: 'Dana', cardOwnerEmail: 'd@example.com', cardOwnerPhone: '050', cardName: 'Gold', cardInfo: 'Israeli', cardFirstDigits: '458028', cardIsAbroad: false, numberOfPayments: 1, couponNumber: '74', uniqueId: 'u-1', rrn: null, acquirer: 'Laumicard', paymentType: 'Standard', entryMode: 'Phone', dealType: 'Debit', accountId: null, authDescription: 'ok' },
    });
    expect(db.rows('payment_operations')[0]).toMatchObject({
      card_owner_name: 'Dana', card_owner_email: 'd@example.com', card_owner_phone: '050', card_name: 'Gold', card_info: 'Israeli', card_first_digits: '458028',
      card_is_abroad: false, number_of_payments: 1, provider_coupon_number: '74', provider_unique_id: 'u-1', provider_acquirer: 'Laumicard',
      provider_payment_type: 'Standard', provider_entry_mode: 'Phone', provider_deal_type: 'Debit', provider_auth_description: 'ok',
    });
    const other = createFakeTableClient({ payment_operations: [{ id: 'p4', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending', card_owner_name: 'Kept' }] });
    await completeOperation(other.client as never, 'p4', { from: 'pending', outcome: 'succeeded', amount: 200, paymentFacts: null });
    expect(other.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', card_owner_name: 'Kept' });
  });
  it('no card facts writes no card column: an unset field never overwrites what the row holds', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p2', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending', card_last4: '1111' }] });
    await completeOperation(db.client as never, 'p2', { from: 'pending', outcome: 'succeeded', amount: 200, cardFacts: null });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', card_last4: '1111' });
  });
  it('loadOperations joins the effect from the registry and maps to OperationRow', async () => {
    const db = createFakeTableClient({
      payment_operations: [{ id: 'a', campaign_id: 'c1', kind: 'authorize', outcome: 'succeeded', amount: '200', credit_applied: '0', occurred_at: '2026-09-01T00:00:00Z', recorded_at: '2026-09-01T00:00:01Z', payment_operation_kinds: { effect: 'commit' } }],
    });
    expect(await loadOperations(db.client as never, 'c1')).toEqual([{ kind: 'authorize', effect: 'commit', outcome: 'succeeded', amount: 200, credit: 0, occurredAt: '2026-09-01T00:00:00Z', recordedAt: '2026-09-01T00:00:01Z' }]);
  });
  it('loadOperations reads the credit of an operation that has no lines from credit_applied (numeric may arrive as a string)', async () => {
    const db = createFakeTableClient({
      payment_operations: [{ id: 'c', campaign_id: 'c1', kind: 'charge', outcome: 'succeeded', amount: '0', credit_applied: '84', occurred_at: '2026-09-02T00:00:00Z', recorded_at: '2026-09-02T00:00:01Z', payment_operation_kinds: { effect: 'collect' } }],
    });
    expect(await loadOperations(db.client as never, 'c1')).toEqual([{ kind: 'charge', effect: 'collect', outcome: 'succeeded', amount: 0, credit: 84, occurredAt: '2026-09-02T00:00:00Z', recordedAt: '2026-09-02T00:00:01Z' }]);
  });
});

// A row is born with the terminal its payment session was ASKED to open on; the database gives it its class (is_test) once, from that
// terminal, and freezes both; CardCom's own report of the terminal (the echo) is written when the row is completed. The application
// writes the stamp in exactly one place - the insert - and never writes the class at all.
describe('the stamp: provider and terminal at birth, the class from the database, the echo at completion', () => {
  const BORN = { campaignId: 'c1', eventId: 'e1', kind: 'package_purchase', amount: 100 } as const;
  const empty = () => createFakeTableClient({ payment_operations: [] }, {}, trigger);

  it('a new CardCom row carries the provider and the terminal it was asked to open on', async () => {
    const db = empty();
    await beginOperation(db.client as never, { ...BORN, provider: 'cardcom', providerTerminal: 1001 });
    expect(db.ops[0].patch).toMatchObject({ provider: 'cardcom', provider_terminal: 1001 });
    expect(db.rows('payment_operations')[0]).toMatchObject({ provider: 'cardcom', provider_terminal: 1001 });
  });

  it('a row that says nothing about them writes neither column, so the database default applies', async () => {
    const db = empty();
    await beginOperation(db.client as never, { ...BORN });
    expect(db.ops[0].patch).not.toHaveProperty('provider');
    expect(db.ops[0].patch).not.toHaveProperty('provider_terminal');
    expect(db.ops[0].patch).not.toHaveProperty('provider_terminal_echo');
  });

  it('recordOperation (a row born already finished) carries the stamp too', async () => {
    const db = empty();
    await recordOperation(db.client as never, { ...BORN, outcome: 'succeeded', provider: 'cardcom', providerTerminal: 1000 });
    expect(db.ops[0].patch).toMatchObject({ provider: 'cardcom', provider_terminal: 1000 });
  });

  it('the class is the database\'s alone: the terminal decides it, and the application never sends it', async () => {
    const db = createFakeTableClient({ payment_operations: [] }, {}, { ...trigger, uniqueIndexes: [] });
    await beginOperation(db.client as never, { ...BORN, kind: 'package_upgrade', provider: 'cardcom', providerTerminal: 1000 });
    await beginOperation(db.client as never, { ...BORN, kind: 'charge', provider: 'cardcom', providerTerminal: 1001 });
    await beginOperation(db.client as never, { ...BORN, kind: 'authorize' });
    expect(db.rows('payment_operations').map((r) => r.is_test)).toEqual([true, false, false]);
    for (const op of db.ops) expect(op.patch).not.toHaveProperty('is_test');
  });

  it('even a caller that tries to send the class (against the types) cannot: it is not written, on insert or on completion', async () => {
    const db = empty();
    const begun = await beginOperation(db.client as never, { ...BORN, isTest: true, is_test: true } as never);
    if (!('id' in begun)) throw new Error('expected an id');
    await completeOperation(db.client as never, begun.id, { from: 'pending', outcome: 'succeeded', isTest: true, is_test: true } as never);
    for (const op of db.ops) expect(op.patch).not.toHaveProperty('is_test');
    expect(db.rows('payment_operations')[0].is_test).toBe(false);
  });

  it('a completion cannot touch the stamp: provider and terminal are not written, even if a caller passes them (against the types)', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending', provider: 'cardcom', provider_terminal: 1000, is_test: true }] });
    await completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'succeeded', amount: 100, provider: 'sumit', providerTerminal: 1001, providerTerminalEcho: 1000 } as never);
    const patch = db.ops[0].patch ?? {};
    expect(patch).not.toHaveProperty('provider');
    expect(patch).not.toHaveProperty('provider_terminal');
    expect(patch).not.toHaveProperty('is_test');
    expect(db.rows('payment_operations')[0]).toMatchObject({ provider: 'cardcom', provider_terminal: 1000, is_test: true });
  });

  it('a completion writes the echo CardCom reported, in its own column', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending' }] });
    await completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'succeeded', amount: 100, providerTerminalEcho: 1000 });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', provider_terminal_echo: 1000 });
  });

  it('a completion with no echo writes no echo column: nothing the row already holds is overwritten', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending', provider_terminal_echo: 1000 }] });
    await completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'failed' });
    expect(db.ops[0].patch).not.toHaveProperty('provider_terminal_echo');
    expect(db.rows('payment_operations')[0].provider_terminal_echo).toBe(1000);
  });

  it('a human resolution from review can carry the echo too', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'r1', campaign_id: 'c1', kind: 'package_purchase', outcome: 'review' }] });
    await completeOperation(db.client as never, 'r1', { from: 'review', outcome: 'failed', providerTerminalEcho: 1001 });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'failed', provider_terminal_echo: 1001 });
  });

  it('loadOperations passes the class the database gave a row on as isTest, and says nothing for a row of real money', async () => {
    const at = { occurred_at: '2026-10-01T00:00:00Z', recorded_at: '2026-10-01T00:00:01Z', credit_applied: '0', payment_operation_kinds: { effect: 'collect' } };
    const db = createFakeTableClient({
      payment_operations: [
        { id: 't', campaign_id: 'c1', kind: 'package_purchase', outcome: 'succeeded', amount: '100', is_test: true, ...at },
        { id: 'r', campaign_id: 'c1', kind: 'package_upgrade', outcome: 'succeeded', amount: '50', is_test: false, ...at },
      ],
    });
    const rows = await loadOperations(db.client as never, 'c1');
    expect(rows[0]).toMatchObject({ kind: 'package_purchase', isTest: true });
    expect(rows[1]).toMatchObject({ kind: 'package_upgrade' });
    expect('isTest' in rows[1]).toBe(false);
    expect(db.ops[0].columns).toContain('is_test');
  });
});

describe('operation lines — how the money of one operation is composed', () => {
  const OP = { campaignId: 'c1', eventId: 'e1', kind: 'package_purchase' } as const;
  const empty = () => createFakeTableClient({ payment_operations: [], payment_operation_lines: [] });

  it('beginOperation writes the pending operation first, then its lines numbered in order; credit is the negative lines', async () => {
    const db = empty();
    const begun = await beginOperation(db.client as never, {
      ...OP,
      amount: 70,
      lines: [{ description: 'חבילה', unitPrice: 100 }, { description: 'קרדיט', unitPrice: -30 }],
    });
    if (!('id' in begun)) throw new Error('expected an id');
    expect(db.rows('payment_operations')).toMatchObject([{ id: begun.id, outcome: 'pending', amount: 70, credit_applied: 30 }]);
    expect(db.rows('payment_operation_lines')).toMatchObject([
      { operation_id: begun.id, line_no: 1, description: 'חבילה', quantity: 1, unit_price: 100 },
      { operation_id: begun.id, line_no: 2, description: 'קרדיט', quantity: 1, unit_price: -30 },
    ]);
    expect(db.ops.map((o) => `${o.op}:${o.table}`)).toEqual(['insert:payment_operations', 'insert:payment_operation_lines']);
  });

  it('a quantity multiplies the price, in whole cents: 3 x 0.10 is exactly 0.30, not 0.30000000000000004', async () => {
    const db = empty();
    const begun = await beginOperation(db.client as never, { ...OP, amount: 0.3, lines: [{ description: 'x', quantity: 3, unitPrice: 0.1 }] });
    expect('id' in begun).toBe(true);
    expect(db.rows('payment_operation_lines')).toMatchObject([{ quantity: 3, unit_price: 0.1 }]);
  });

  it('an amount that is not the sum of the lines is refused BEFORE anything is written', async () => {
    const db = empty();
    await expect(beginOperation(db.client as never, { ...OP, amount: 90, lines: [{ description: 'חבילה', unitPrice: 100 }] })).rejects.toThrow();
    expect(db.ops).toHaveLength(0);
  });

  it('a creditApplied that is not the sum of the negative lines is refused BEFORE anything is written', async () => {
    const db = empty();
    await expect(
      beginOperation(db.client as never, { ...OP, amount: 70, creditApplied: 5, lines: [{ description: 'חבילה', unitPrice: 100 }, { description: 'קרדיט', unitPrice: -30 }] }),
    ).rejects.toThrow();
    expect(db.ops).toHaveLength(0);
  });

  it.each([
    ['a blank description', { description: '   ', unitPrice: 10 }],
    ['a price that is not a number', { description: 'x', unitPrice: Number.NaN }],
    ['a price with more than two decimals', { description: 'x', unitPrice: 10.005 }],
    ['a zero quantity', { description: 'x', quantity: 0, unitPrice: 10 }],
    ['a negative quantity', { description: 'x', quantity: -1, unitPrice: 10 }],
    ['a quantity with more than three decimals', { description: 'x', quantity: 1.0005, unitPrice: 10 }],
  ])('%s is refused before anything is written', async (_name, line) => {
    const db = empty();
    await expect(beginOperation(db.client as never, { ...OP, amount: 10, lines: [line] })).rejects.toThrow();
    expect(db.ops).toHaveLength(0);
  });

  it('an empty list of lines is the same as no lines: only the operation is written', async () => {
    const db = empty();
    const begun = await beginOperation(db.client as never, { ...OP, amount: 120, lines: [] });
    expect('id' in begun).toBe(true);
    expect(db.ops.map((o) => `${o.op}:${o.table}`)).toEqual(['insert:payment_operations']);
    expect(db.rows('payment_operations')).toMatchObject([{ amount: 120, credit_applied: 0 }]);
  });

  it('when the lines cannot be written the operation is closed as failed — the provider is never called for it — and the error is thrown', async () => {
    const db = empty();
    db.fail('payment_operation_lines', '23514', 'insert');
    await expect(beginOperation(db.client as never, { ...OP, amount: 100, lines: [{ description: 'חבילה', unitPrice: 100 }] })).rejects.toThrow();
    expect(db.rows('payment_operations')).toMatchObject([{ outcome: 'failed' }]);
    expect(String(db.rows('payment_operations')[0].note)).not.toBe('');
    expect(db.rows('payment_operation_lines')).toHaveLength(0);
  });

  it('a lock lost to a second begin never writes lines for the loser', async () => {
    const db = createFakeTableClient({ payment_operations: [], payment_operation_lines: [] }, {}, { uniqueIndexes: [{ table: 'payment_operations', columns: ['campaign_id', 'kind'], where: { outcome: 'pending' } }] });
    const lines = [{ description: 'חבילה', unitPrice: 100 }];
    await beginOperation(db.client as never, { ...OP, amount: 100, lines });
    expect(await beginOperation(db.client as never, { ...OP, amount: 100, lines })).toEqual({ alreadyInProgress: true });
    expect(db.rows('payment_operation_lines')).toHaveLength(1);
  });

  it('loadOperations takes the credit from the negative lines when the operation has lines', async () => {
    const db = createFakeTableClient({
      payment_operations: [{ id: 'c', campaign_id: 'c1', kind: 'package_purchase', outcome: 'succeeded', amount: '70', credit_applied: '30', occurred_at: '2026-09-02T00:00:00Z', recorded_at: '2026-09-02T00:00:01Z', payment_operation_kinds: { effect: 'collect' }, payment_operation_lines: [{ line_total: '100' }, { line_total: '-30' }] }],
    });
    expect(await loadOperations(db.client as never, 'c1')).toMatchObject([{ amount: 70, credit: 30 }]);
  });

  it('loadOperations: lines with no negative line mean no credit', async () => {
    const db = createFakeTableClient({
      payment_operations: [{ id: 'c', campaign_id: 'c1', kind: 'package_purchase', outcome: 'succeeded', amount: '100', credit_applied: '0', occurred_at: '2026-09-02T00:00:00Z', recorded_at: '2026-09-02T00:00:01Z', payment_operation_kinds: { effect: 'collect' }, payment_operation_lines: [{ line_total: '100' }] }],
    });
    expect(await loadOperations(db.client as never, 'c1')).toMatchObject([{ amount: 100, credit: 0 }]);
  });
});

describe('reading one operation, and the refunds of one cancellation request', () => {
  const row = (over: TableRow = {}): TableRow => ({
    id: 'o1', campaign_id: 'c1', kind: 'package_purchase', outcome: 'succeeded', amount: '120', meta: { payerUserId: 'u1' },
    provider_document_id: null, provider_document_number: null, provider_document_url: null, ...over,
  });

  it('getOperation returns the row with its meta and document, amounts as numbers', async () => {
    const db = createFakeTableClient({ payment_operations: [row({ provider_document_id: 7, provider_document_number: 40106, provider_document_url: 'u' })] });
    expect(await getOperation(db.client as never, 'o1')).toEqual({
      id: 'o1', kind: 'package_purchase', outcome: 'succeeded', amount: 120, meta: { payerUserId: 'u1' },
      document: { id: 7, number: 40106, url: 'u' },
    });
  });

  it('getOperation: no document → null; unknown id → null', async () => {
    const db = createFakeTableClient({ payment_operations: [row()] });
    expect((await getOperation(db.client as never, 'o1'))?.document).toBeNull();
    expect(await getOperation(db.client as never, 'nope')).toBeNull();
  });

  it('getOperation: a meta that is not an object is read as empty, never trusted', async () => {
    const db = createFakeTableClient({ payment_operations: [row({ meta: 'oops' })] });
    expect((await getOperation(db.client as never, 'o1'))?.meta).toEqual({});
  });

  it('getOperation throws when the ledger cannot be read', async () => {
    const db = createFakeTableClient({ payment_operations: [row()] });
    db.fail('payment_operations', '57014', 'select');
    await expect(getOperation(db.client as never, 'o1')).rejects.toThrow();
  });

  it('refundsOfRequest: only the refunds of THIS campaign that carry THIS request id', async () => {
    const db = createFakeTableClient({
      payment_operations: [
        row({ id: 'r1', kind: 'refund', outcome: 'failed', amount: 50, meta: { cancellation_request_id: 'req1' } }),
        row({ id: 'r2', kind: 'refund', outcome: 'succeeded', amount: 70, meta: { cancellation_request_id: 'req1' } }),
        row({ id: 'r3', kind: 'refund', outcome: 'succeeded', amount: 10, meta: { cancellation_request_id: 'req2' } }),
        row({ id: 'r4', kind: 'refund', outcome: 'succeeded', amount: 10, campaign_id: 'other', meta: { cancellation_request_id: 'req1' } }),
        row({ id: 'p1', kind: 'package_purchase', outcome: 'succeeded', meta: { cancellation_request_id: 'req1' } }),
        row({ id: 'r5', kind: 'refund', outcome: 'succeeded', amount: 5, meta: {} }),
      ],
    });
    const found = await refundsOfRequest(db.client as never, 'c1', 'req1');
    expect(found.map((r) => [r.id, r.outcome, r.amount])).toEqual([['r1', 'failed', 50], ['r2', 'succeeded', 70]]);
  });

  it('refundsOfRequest: none → empty list; a read failure throws', async () => {
    const db = createFakeTableClient({ payment_operations: [] });
    expect(await refundsOfRequest(db.client as never, 'c1', 'req1')).toEqual([]);
    db.fail('payment_operations', '57014', 'select');
    await expect(refundsOfRequest(db.client as never, 'c1', 'req1')).rejects.toThrow();
  });
});

const ROW = { campaign_id: 'c1', recorded_at: '2026-09-01T00:00:00Z' };

describe('card and lookup helpers', () => {
  it('currentCard → the latest SUCCEEDED operation that holds a token, of ANY kind', async () => {
    const db = createFakeTableClient({
      payment_operations: [
        { ...ROW, id: 'old', kind: 'authorize', outcome: 'succeeded', card_token_ref: 'tok-old', card_exp_month: 7, card_exp_year: 2031, card_last4: '9183', card_mask: 'XXXXXXXXXXXX9183', payment_method_type: '1', citizen_id_secret: 's-old', occurred_at: '2026-09-01T00:00:00Z' },
        { ...ROW, id: 'new', kind: 'package_purchase', outcome: 'succeeded', card_token_ref: 'tok-new', card_exp_month: 8, card_exp_year: 2032, card_last4: '1111', card_mask: 'XXXXXXXXXXXX1111', payment_method_type: '1', citizen_id_secret: 's-new', occurred_at: '2026-09-02T00:00:00Z' },
        { ...ROW, id: 'failed', kind: 'package_upgrade', outcome: 'failed', card_token_ref: 'tok-failed', occurred_at: '2026-09-03T00:00:00Z' },
        { ...ROW, id: 'no-card', kind: 'refund', outcome: 'succeeded', card_token_ref: null, occurred_at: '2026-09-04T00:00:00Z' },
        { ...ROW, id: 'other', campaign_id: 'c2', kind: 'charge', outcome: 'succeeded', card_token_ref: 'tok-other', occurred_at: '2026-09-05T00:00:00Z' },
      ],
    });
    expect(await currentCard(db.client as never, 'c1')).toEqual({
      operationId: 'new', methodType: '1', tokenRef: 'tok-new', expMonth: 8, expYear: 2032, last4: '1111', mask: 'XXXXXXXXXXXX1111', citizenSecretId: 's-new',
    });
  });
  it('currentCard → null when no succeeded operation holds a token', async () => {
    const db = createFakeTableClient({ payment_operations: [{ ...ROW, id: 'a', kind: 'refund', outcome: 'succeeded', card_token_ref: null, occurred_at: '2026-09-01T00:00:00Z' }] });
    expect(await currentCard(db.client as never, 'c1')).toBeNull();
  });
  it('latestOperation → the newest row of a kind, optionally of one outcome; null when there is none', async () => {
    const db = createFakeTableClient({
      payment_operations: [
        { ...ROW, id: 'u1', kind: 'package_upgrade', outcome: 'succeeded', occurred_at: '2026-09-01T00:00:00Z' },
        { ...ROW, id: 'u2', kind: 'package_upgrade', outcome: 'failed', occurred_at: '2026-09-02T00:00:00Z' },
      ],
    });
    expect(await latestOperation(db.client as never, 'c1', 'package_upgrade')).toEqual({ id: 'u2' });
    expect(await latestOperation(db.client as never, 'c1', 'package_upgrade', 'succeeded')).toEqual({ id: 'u1' });
    expect(await latestOperation(db.client as never, 'c1', 'refund')).toBeNull();
  });
  it('loadOperations refuses an effect it does not know — money code fails closed instead of guessing', async () => {
    const db = createFakeTableClient({
      payment_operations: [{ ...ROW, id: 'x', kind: 'mystery', outcome: 'succeeded', amount: 5, occurred_at: '2026-09-01T00:00:00Z', payment_operation_kinds: { effect: 'teleport' } }],
    });
    await expect(loadOperations(db.client as never, 'c1')).rejects.toThrow();
  });
  it('beginOperation: only 23505 means "already in progress" — any other database error is thrown', async () => {
    const db = createFakeTableClient({ payment_operations: [] });
    db.fail('payment_operations', '40001', 'insert');
    await expect(beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', amount: 1 })).rejects.toThrow('רישום פעולת התשלום נכשל');
  });
  it('recordOperation on a duplicate also throws: a one-shot write that cannot be recorded must not look recorded', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'a', campaign_id: 'c1', kind: 'charge', outcome: 'succeeded', once_slot: true }] }, {}, { ...trigger, uniqueIndexes: [{ columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } }] });
    await expect(recordOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'charge', outcome: 'succeeded', amount: 1 })).rejects.toThrow();
  });
});

describe('completeOperation failures are told apart', () => {
  it('a row that is not in the expected state throws OperationStateError — a caller can treat it as "someone else got there first"', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'charge', outcome: 'succeeded' }] });
    await expect(completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'failed' })).rejects.toBeInstanceOf(OperationStateError);
  });
  it('a database error is NOT an OperationStateError — it must never be mistaken for a lost race', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'p1', campaign_id: 'c1', kind: 'charge', outcome: 'pending' }] });
    db.fail('payment_operations', '40001', 'update');
    const err = await completeOperation(db.client as never, 'p1', { from: 'pending', outcome: 'succeeded' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(OperationStateError);
  });
});

describe('a document known only by its number', () => {
  it('an admin who read the receipt number off the provider screen records it without an internal id', async () => {
    const db = createFakeTableClient({ payment_operations: [{ id: 'r1', campaign_id: 'c1', kind: 'charge', outcome: 'review' }] });
    await completeOperation(db.client as never, 'r1', { from: 'review', outcome: 'succeeded', amount: 120, providerDocument: { id: null, number: 40106, url: null } });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', provider_document_id: null, provider_document_number: 40106, provider_document_url: null });
  });
});
