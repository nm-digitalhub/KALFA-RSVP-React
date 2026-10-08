import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

let fake: FakeTableClient;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }));

import { CARDCOM_TEST_TERMINAL, getCardcomApiPassword, getCardcomServerConfig, isCardcomTestTerminal } from './cardcom-config';

// The server-side reader of the CardCom connection (the cardcom_config table, a closed table: only the service role
// reads it). Every reader is fail-closed: any error, a missing row or a value that makes no sense resolves to "not
// configured", never to a throw — a customer page must not crash because clearing is unset.

const row = (over: TableRow = {}): TableRow => ({ id: true, terminal_number: 1001, api_name: 'kalfa-api', enabled: true, ...over });

beforeEach(() => {
  fake = createFakeTableClient({ cardcom_config: [row()] }, { cardcom_api_password: () => ({ data: 'the-password' }) });
});

describe('getCardcomServerConfig', () => {
  it('returns the terminal, the API name and the switch', async () => {
    await expect(getCardcomServerConfig()).resolves.toEqual({ terminalNumber: 1001, apiName: 'kalfa-api', enabled: true });
  });

  it('reports a switched-off connection as such, still configured', async () => {
    fake = createFakeTableClient({ cardcom_config: [row({ enabled: false })] });
    await expect(getCardcomServerConfig()).resolves.toEqual({ terminalNumber: 1001, apiName: 'kalfa-api', enabled: false });
  });

  it('is null when nothing was ever saved', async () => {
    fake = createFakeTableClient({ cardcom_config: [] });
    await expect(getCardcomServerConfig()).resolves.toBeNull();
  });

  it('is null, not a throw, when the read fails', async () => {
    fake.fail('cardcom_config', '42501');
    await expect(getCardcomServerConfig()).resolves.toBeNull();
  });

  it.each([
    ['a terminal that is not a positive whole number', { terminal_number: 0 }],
    ['a terminal that is not a number', { terminal_number: 'abc' }],
    ['a blank API name', { api_name: '  ' }],
    ['a switch that is not a boolean', { enabled: 'yes' }],
  ])('is null for %s', async (_label, over) => {
    fake = createFakeTableClient({ cardcom_config: [row(over)] });
    await expect(getCardcomServerConfig()).resolves.toBeNull();
  });

  it('reads one row only: the singleton', async () => {
    await getCardcomServerConfig();
    expect(fake.ops[0]).toMatchObject({ table: 'cardcom_config', op: 'select', filters: [['eq', 'id', true]] });
  });
});

describe('getCardcomApiPassword', () => {
  it('returns the password the vault function decrypts', async () => {
    await expect(getCardcomApiPassword()).resolves.toBe('the-password');
    expect(fake.rpcCalls.map((c) => c.fn)).toEqual(['cardcom_api_password']);
  });

  it('is null when none is stored', async () => {
    fake = createFakeTableClient({}, { cardcom_api_password: () => ({ data: null }) });
    await expect(getCardcomApiPassword()).resolves.toBeNull();
  });

  it('is null, not a throw, when the call fails or answers with something that is not text', async () => {
    fake.fail('rpc:cardcom_api_password', '42501');
    await expect(getCardcomApiPassword()).resolves.toBeNull();
    fake = createFakeTableClient({}, { cardcom_api_password: () => ({ data: 42 }) });
    await expect(getCardcomApiPassword()).resolves.toBeNull();
  });

  it('treats an empty password as none', async () => {
    fake = createFakeTableClient({}, { cardcom_api_password: () => ({ data: '' }) });
    await expect(getCardcomApiPassword()).resolves.toBeNull();
  });
});

describe('isCardcomTestTerminal', () => {
  it("is true for CardCom's published test terminal and only for it", () => {
    expect(CARDCOM_TEST_TERMINAL).toBe(1000);
    expect(isCardcomTestTerminal(1000)).toBe(true);
    expect(isCardcomTestTerminal(1001)).toBe(false);
    expect(isCardcomTestTerminal(1)).toBe(false);
  });
});
