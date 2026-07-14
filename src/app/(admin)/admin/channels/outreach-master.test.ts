import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
// Stub every server-only DAL that actions.ts imports so this Node suite can load.
vi.mock('@/lib/data/admin/channels', () => ({
  updateWhatsAppChannelConfig: vi.fn(),
  testWhatsAppConnection: vi.fn(),
}));
vi.mock('@/lib/data/admin/voximplant-channel', () => ({
  updateVoximplantChannelConfig: vi.fn(),
  testVoximplantConnection: vi.fn(),
}));
vi.mock('@/lib/data/admin/outreach-master', () => ({
  getOutreachMasterState: vi.fn(),
  setOutreachEnabled: vi.fn(),
}));

import {
  getOutreachMasterState,
  setOutreachEnabled,
} from '@/lib/data/admin/outreach-master';
import type { OutreachMasterState } from '@/lib/data/admin/outreach-master';
import { updateOutreachMasterSwitchAction } from './actions';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function state(partial: Partial<OutreachMasterState>): OutreachMasterState {
  return {
    enabled: false,
    whatsappConfigured: false,
    voximplantConfigured: false,
    anyChannelReady: false,
    ...partial,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('updateOutreachMasterSwitchAction — fail-closed enable guard', () => {
  it('blocks enable when no channel is ready and never calls setOutreachEnabled', async () => {
    vi.mocked(getOutreachMasterState).mockResolvedValue(
      state({ anyChannelReady: false }),
    );

    const result = await updateOutreachMasterSwitchAction(
      null,
      fd({ outreach_enabled: 'on' }),
    );

    expect(result).toEqual({
      error:
        'לא ניתן להפעיל פנייה ללא ערוץ מוגדר אחד לפחות. הגדירו ושמרו ערוץ תחילה.',
    });
    expect(setOutreachEnabled).not.toHaveBeenCalled();
  });

  it('enables when at least one channel is ready', async () => {
    vi.mocked(getOutreachMasterState).mockResolvedValue(
      state({ whatsappConfigured: true, anyChannelReady: true }),
    );
    vi.mocked(setOutreachEnabled).mockResolvedValue();

    const result = await updateOutreachMasterSwitchAction(
      null,
      fd({ outreach_enabled: 'on' }),
    );

    expect(setOutreachEnabled).toHaveBeenCalledWith(true);
    expect(result).toEqual({ notice: 'פנייה לאורחים מופעלת' });
  });

  it('always allows disabling — no readiness check', async () => {
    vi.mocked(setOutreachEnabled).mockResolvedValue();

    const result = await updateOutreachMasterSwitchAction(null, fd({}));

    expect(getOutreachMasterState).not.toHaveBeenCalled();
    expect(setOutreachEnabled).toHaveBeenCalledWith(false);
    expect(result).toEqual({ notice: 'פנייה לאורחים כבויה' });
  });
});
