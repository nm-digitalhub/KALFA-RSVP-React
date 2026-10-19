import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/auth/platform-ability', () => ({ requirePlatformAction: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: vi.fn() }));
vi.mock('@/lib/data/channel-catalog', () => ({ getChannelCatalog: vi.fn() }));
vi.mock('@/lib/data/admin/packages', () => ({ getScheduleStepOptions: vi.fn(), getSuggestedSchedule: vi.fn() }));
vi.mock('../package-form', () => ({ PackageForm: () => <div data-marker="package-form" /> }));
vi.mock('../actions', () => ({ createPackageAction: vi.fn() }));

import { requirePlatformAction } from '@/lib/auth/platform-ability';
import { getChannelCatalog } from '@/lib/data/channel-catalog';
import { getScheduleStepOptions, getSuggestedSchedule } from '@/lib/data/admin/packages';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import NewPackagePage from './page';

// The new-package page (pilot-casl-package-permissions, design D4): its gate is `create Package`, and a
// refused caller is redirected before any reader runs.

async function render() {
  return renderToStaticMarkup(await NewPackagePage());
}

beforeEach(() => {
  vi.mocked(requirePlatformAction).mockReset().mockResolvedValue({ id: 'staff-1' } as never);
  vi.mocked(getVoximplantConfig).mockReset().mockResolvedValue(null);
  vi.mocked(getChannelCatalog).mockReset().mockResolvedValue([] as never);
  vi.mocked(getScheduleStepOptions).mockReset().mockResolvedValue([] as never);
  vi.mocked(getSuggestedSchedule).mockReset().mockResolvedValue(null);
});

describe('/admin/packages/new', () => {
  it('is behind create Package', async () => {
    const html = await render();
    expect(requirePlatformAction).toHaveBeenCalledWith('create', 'Package');
    expect(html).toContain('data-marker="package-form"');
  });

  it('refuses before any reader runs', async () => {
    vi.mocked(requirePlatformAction).mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    for (const reader of [getVoximplantConfig, getChannelCatalog, getScheduleStepOptions, getSuggestedSchedule]) {
      expect(reader).not.toHaveBeenCalled();
    }
  });
});
