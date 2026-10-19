import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/auth/platform-ability', () => ({ requirePlatformAction: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: vi.fn() }));
vi.mock('@/lib/data/channel-catalog', () => ({ getChannelCatalog: vi.fn() }));
vi.mock('@/lib/data/admin/packages', () => ({ getPackage: vi.fn(), getScheduleStepOptions: vi.fn() }));
vi.mock('../package-form', () => ({ PackageForm: () => <div data-marker="package-form" /> }));
vi.mock('../actions', () => ({ updatePackageAction: vi.fn() }));
vi.mock('./delete-package-form', () => ({ DeletePackageForm: () => <div data-marker="delete-form" /> }));

import { requirePlatformAction } from '@/lib/auth/platform-ability';
import { getChannelCatalog } from '@/lib/data/channel-catalog';
import { getPackage, getScheduleStepOptions } from '@/lib/data/admin/packages';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import EditPackagePage from './page';

// The package page (pilot-casl-package-permissions, design D4): its gate is `read Package`, and a refused
// caller is redirected before the package, or anything else, is read.

const ID = '12345678-1234-1234-1234-123456789abc';

async function render() {
  return renderToStaticMarkup(await EditPackagePage({ params: Promise.resolve({ id: ID }) }));
}

beforeEach(() => {
  vi.mocked(requirePlatformAction).mockReset().mockResolvedValue({ id: 'staff-1' } as never);
  vi.mocked(getPackage).mockReset().mockResolvedValue({
    name: 'בסיס',
    tier: 'basic',
    category: 'wedding',
    description: null,
    price_with_vat: 150,
    includes: [],
    active: true,
    sort_order: 0,
    contact_quota: null,
    channels: [],
    outreach_schedule: [],
  } as never);
  vi.mocked(getVoximplantConfig).mockReset().mockResolvedValue(null);
  vi.mocked(getChannelCatalog).mockReset().mockResolvedValue([] as never);
  vi.mocked(getScheduleStepOptions).mockReset().mockResolvedValue([] as never);
});

describe('/admin/packages/[id]', () => {
  it('is behind read Package', async () => {
    const html = await render();
    expect(requirePlatformAction).toHaveBeenCalledWith('read', 'Package');
    expect(getPackage).toHaveBeenCalledWith(ID);
    expect(html).toContain('data-marker="package-form"');
  });

  it('refuses before the package or any reader runs', async () => {
    vi.mocked(requirePlatformAction).mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    for (const reader of [getPackage, getVoximplantConfig, getChannelCatalog, getScheduleStepOptions]) {
      expect(reader).not.toHaveBeenCalled();
    }
  });
});
