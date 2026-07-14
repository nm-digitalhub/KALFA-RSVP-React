import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/channels', () => ({
  updateWhatsAppChannelConfig: vi.fn(),
  testWhatsAppConnection: vi.fn(),
}));
// actions.ts now also imports the Voximplant channel + outreach-master DALs
// (both `server-only`). Stub them so importing './actions' doesn't pull the
// server-only guard into this Node test suite.
vi.mock('@/lib/data/admin/voximplant-channel', () => ({
  updateVoximplantChannelConfig: vi.fn(),
  testVoximplantConnection: vi.fn(),
}));
vi.mock('@/lib/data/admin/outreach-master', () => ({
  getOutreachMasterState: vi.fn(),
  setOutreachEnabled: vi.fn(),
}));

import { updateWhatsAppChannelConfig } from '@/lib/data/admin/channels';
import { updateWhatsAppChannelAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FIELDS = {
  whatsapp_phone_number_id: '',
  whatsapp_waba_id: '',
  whatsapp_access_token: '',
  whatsapp_app_secret: '',
  whatsapp_verify_token: '',
};

beforeEach(() => vi.clearAllMocks());

describe('updateWhatsAppChannelAction — Next.js control-flow signals (requireAdmin)', () => {
  it('propagates a NEXT_REDIRECT from updateWhatsAppChannelConfig instead of returning { error }', async () => {
    vi.mocked(updateWhatsAppChannelConfig).mockRejectedValue(NEXT_REDIRECT);

    await expect(
      updateWhatsAppChannelAction(null, fd(FIELDS)),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateWhatsAppChannelConfig).mockRejectedValue(new Error('db down'));

    const result = await updateWhatsAppChannelAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'עדכון הגדרות הערוץ נכשל. נסו שוב.' });
  });
});
