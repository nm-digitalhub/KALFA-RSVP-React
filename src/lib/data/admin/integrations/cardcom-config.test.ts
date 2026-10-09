import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, logActivityMock } = vi.hoisted(() => ({ permMock: vi.fn(), logActivityMock: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/activity', () => ({ logActivity: logActivityMock }));

import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

let fake: FakeTableClient;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }));

import { readCardcomAdminConfig, saveCardcomConfig, UNCONFIGURED_CARDCOM } from './cardcom-config';

// The admin side of the CardCom connection: one read for the settings page, one write for its form. Neither secret (the
// API password, the document report secret) leaves in either direction as a value: the read answers "is one stored" as a
// boolean, and the write hands each to its vault function and logs only that one was submitted.

const SECRET_ID = '99999999-8888-4777-8666-555555555555';
const row = (over: TableRow = {}): TableRow => ({
  id: true,
  terminal_number: 1001,
  api_name: 'kalfa-api',
  enabled: true,
  api_password_secret: SECRET_ID,
  updated_at: '2026-10-07T10:00:00.000Z',
  ...over,
});
const input = (over: Partial<Parameters<typeof saveCardcomConfig>[0]> = {}) => ({
  terminalNumber: 1001,
  apiName: 'kalfa-api',
  apiPassword: 'new-password',
  documentReportSecret: '',
  enabled: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ id: 'session-user' });
  fake = createFakeTableClient({ cardcom_config: [row()] }, { cardcom_config_save: () => ({ data: null }) });
});

describe('readCardcomAdminConfig', () => {
  it('asks for the read permission before anything else', async () => {
    await readCardcomAdminConfig();
    expect(permMock).toHaveBeenCalledWith('integrations.read');
  });

  it('describes the connection, and turns the vault secret id into a boolean', async () => {
    const view = await readCardcomAdminConfig();
    expect(view).toEqual({
      exists: true,
      terminalNumber: 1001,
      apiName: 'kalfa-api',
      enabled: true,
      hasPassword: true,
      hasDocumentReportSecret: false,
      isTestTerminal: false,
      updatedAt: '2026-10-07T10:00:00.000Z',
    });
    expect(JSON.stringify(view)).not.toContain(SECRET_ID);
  });

  it('says whether the document report secret is saved, from a boolean the database answers', async () => {
    fake = createFakeTableClient({ cardcom_config: [row()] }, { cardcom_document_report_secret_exists: () => ({ data: true }) });
    expect((await readCardcomAdminConfig()).hasDocumentReportSecret).toBe(true);
    expect(fake.rpcCalls).toEqual([{ fn: 'cardcom_document_report_secret_exists', args: undefined }]);
  });

  it('marks the published test terminal', async () => {
    fake = createFakeTableClient({ cardcom_config: [row({ terminal_number: 1000 })] });
    expect((await readCardcomAdminConfig()).isTestTerminal).toBe(true);
  });

  it('says there is no password when none is stored', async () => {
    fake = createFakeTableClient({ cardcom_config: [row({ api_password_secret: null, enabled: false })] });
    expect(await readCardcomAdminConfig()).toMatchObject({ exists: true, hasPassword: false, enabled: false });
  });

  it('reports "not configured" when nothing was saved, and when the read fails — never a throw', async () => {
    fake = createFakeTableClient({ cardcom_config: [] });
    expect(await readCardcomAdminConfig()).toEqual(UNCONFIGURED_CARDCOM);
    fake = createFakeTableClient({ cardcom_config: [row()] });
    fake.fail('cardcom_config', '42501');
    expect(await readCardcomAdminConfig()).toEqual(UNCONFIGURED_CARDCOM);
  });
});

describe('saveCardcomConfig', () => {
  it('asks for the manage permission and hands the form values to the vault function, the session user as author', async () => {
    await expect(saveCardcomConfig(input())).resolves.toEqual({ ok: true });
    expect(permMock).toHaveBeenCalledWith('integrations.manage');
    expect(fake.rpcCalls).toEqual([
      {
        fn: 'cardcom_config_save',
        args: { p_terminal_number: 1001, p_api_name: 'kalfa-api', p_api_password: 'new-password', p_enabled: true, p_updated_by: 'session-user' },
      },
    ]);
  });

  it('keeps the stored password when the field is blank, and the switch can still be turned on', async () => {
    await expect(saveCardcomConfig(input({ apiPassword: '' }))).resolves.toEqual({ ok: true });
    expect(fake.rpcCalls[0].args).toMatchObject({ p_api_password: '', p_enabled: true });
  });

  it('refuses to switch on without a password, stored or typed, and sends nothing', async () => {
    fake = createFakeTableClient({ cardcom_config: [row({ api_password_secret: null, enabled: false })] }, { cardcom_config_save: () => ({ data: null }) });
    await expect(saveCardcomConfig(input({ apiPassword: '' }))).resolves.toEqual({ ok: false, reason: 'password_required' });
    expect(fake.rpcCalls).toEqual([]);
    expect(logActivityMock).not.toHaveBeenCalled();
  });

  it('refuses to switch on a connection that was never saved and has no password', async () => {
    fake = createFakeTableClient({ cardcom_config: [] }, { cardcom_config_save: () => ({ data: null }) });
    await expect(saveCardcomConfig(input({ apiPassword: '' }))).resolves.toEqual({ ok: false, reason: 'password_required' });
  });

  it('may save a switched-off connection without a password', async () => {
    fake = createFakeTableClient({ cardcom_config: [] }, { cardcom_config_save: () => ({ data: null }) });
    await expect(saveCardcomConfig(input({ apiPassword: '', enabled: false }))).resolves.toEqual({ ok: true });
    expect(fake.rpcCalls).toHaveLength(1);
  });

  it('writes an audit entry that says a password was submitted, never what it was', async () => {
    await saveCardcomConfig(input({ apiPassword: 'super-secret' }));
    expect(logActivityMock).toHaveBeenCalledWith({
      action: 'admin.cardcom_config.saved',
      meta: { terminalNumber: 1001, enabled: true, passwordSubmitted: true, documentReportSecretSubmitted: false },
    });
    expect(JSON.stringify(logActivityMock.mock.calls)).not.toContain('super-secret');
  });

  it('saves a typed document report secret through its vault function, and logs only that one was submitted', async () => {
    fake = createFakeTableClient(
      { cardcom_config: [row()] },
      { cardcom_config_save: () => ({ data: null }), cardcom_document_report_secret_save: () => ({ data: null }) },
    );
    const secret = 'A1b2C3d4E5f6G7h8I9j0K1l2';
    await expect(saveCardcomConfig(input({ documentReportSecret: secret }))).resolves.toEqual({ ok: true });
    expect(fake.rpcCalls.map((c) => c.fn)).toEqual(['cardcom_config_save', 'cardcom_document_report_secret_save']);
    expect(fake.rpcCalls[1].args).toEqual({ p_secret: secret });
    expect(logActivityMock.mock.calls[0][0].meta).toMatchObject({ documentReportSecretSubmitted: true });
    expect(JSON.stringify(logActivityMock.mock.calls)).not.toContain(secret);
  });

  it('a blank document report secret keeps the stored one: its vault function is not called', async () => {
    await saveCardcomConfig(input({ documentReportSecret: '' }));
    expect(fake.rpcCalls.map((c) => c.fn)).toEqual(['cardcom_config_save']);
  });

  it('throws when the save fails, so the form can say so', async () => {
    fake.fail('rpc:cardcom_config_save', '42501');
    await expect(saveCardcomConfig(input())).rejects.toBeTruthy();
    expect(logActivityMock).not.toHaveBeenCalled();
  });
});
