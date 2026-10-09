import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { slackMock } = vi.hoisted(() => ({ slackMock: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: slackMock }));

import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

let fake: FakeTableClient;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }));

import type { WebhookInboxRow } from '@/lib/data/webhooks';
import { processCardcomDocumentRow } from './cardcom-document-processing';

// The worker's half of the CardCom document report: a document that is on a CardCom row of our payment ledger needs
// nothing; any other document is reported to staff (owner 8.10.2026), with ids and amounts only.

const ledgerRow = (over: TableRow = {}): TableRow => ({
  id: 'op-1', provider: 'cardcom', provider_document_number: 1006, provider_terminal: 172204, ...over,
});

const inboxRow = (payload: Record<string, string>): WebhookInboxRow =>
  ({ id: 'inbox-1', provider: 'cardcom', event_kind: 'cardcom_document', dedupe_key: 'x', payload }) as unknown as WebhookInboxRow;

const REPORT = {
  DocType: '3',
  DocNumber: '1006',
  // Dotted names, as CardCom actually sends them (the first real report, 8.10.2026).
  'ExtReadInvoiceHead.TerminalNumber': '172204',
  'ExtReadInvoiceHead.TotalIncludeVAT': '1',
  'ExtReadInvoiceHead.CustName': 'ישראל ישראלי',
  'ExtShvaParams.CardHolderIdentityNumber': '040000000',
  InvoiceCreatorUserID: '83',
};

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeTableClient({ payment_operations: [ledgerRow()] });
});

describe('processCardcomDocumentRow', () => {
  it('a document on our CardCom payment needs nothing more', async () => {
    await processCardcomDocumentRow(inboxRow(REPORT));
    expect(slackMock).not.toHaveBeenCalled();
  });

  it('a document with no payment of ours is reported to staff, ids and amounts only', async () => {
    await processCardcomDocumentRow(inboxRow({ ...REPORT, DocNumber: '2000' }));
    expect(slackMock).toHaveBeenCalledTimes(1);
    const alert = slackMock.mock.calls[0][0];
    expect(alert).toMatchObject({ level: 'warn', category: 'campaign_billing', source: 'cardcom-document-webhook' });
    expect(alert.title).toContain('2000');
    expect(alert.fields).toMatchObject({ document_type: '3', document_number: '2000', terminal: '172204', total: '1', created_by_user: '83' });
    expect(JSON.stringify(alert)).not.toContain('040000000');
    expect(JSON.stringify(alert)).not.toContain('ישראל');
  });

  it('a document of another terminal with the same number is not ours', async () => {
    await processCardcomDocumentRow(inboxRow({ ...REPORT, 'ExtReadInvoiceHead.TerminalNumber': '1000' }));
    expect(slackMock).toHaveBeenCalledTimes(1);
  });

  it('a document of another provider with the same number is not ours', async () => {
    fake = createFakeTableClient({ payment_operations: [ledgerRow({ provider: 'sumit' })] });
    await processCardcomDocumentRow(inboxRow(REPORT));
    expect(slackMock).toHaveBeenCalledTimes(1);
  });

  it('a report with no readable number is still reported', async () => {
    await processCardcomDocumentRow(inboxRow({ DocType: '3' }));
    expect(slackMock).toHaveBeenCalledTimes(1);
    expect(slackMock.mock.calls[0][0].fields.document_number).toBe('');
  });

  it('throws when the ledger cannot be read, so the worker tries again', async () => {
    fake.fail('payment_operations', '57014');
    await expect(processCardcomDocumentRow(inboxRow(REPORT))).rejects.toThrow();
    expect(slackMock).not.toHaveBeenCalled();
  });
});
