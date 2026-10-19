import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMongoAbility } from '@casl/ability';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/auth/platform-ability', () => ({ requirePlatformAction: vi.fn(), getPlatformAbility: vi.fn() }));
vi.mock('@/lib/data/admin/packages', () => ({ listPackages: vi.fn() }));

import { getPlatformAbility, requirePlatformAction } from '@/lib/auth/platform-ability';
import { listPackages } from '@/lib/data/admin/packages';
import type { PlatformAbility } from '@/lib/casl';
import AdminPackagesPage from './page';

// The list page (pilot-casl-package-permissions, design D4/D5): the page gate is `read Package`, and the
// "חבילה חדשה" link follows `create Package` from the same ability. The rules are written as rules, not
// as keys, so a viewer who may read but not create can be modelled even while both bind to one key.

const readOnly = () => createMongoAbility<PlatformAbility>([{ action: 'read', subject: 'Package' }]);
const readAndCreate = () =>
  createMongoAbility<PlatformAbility>([
    { action: 'read', subject: 'Package' },
    { action: 'create', subject: 'Package' },
  ]);

async function render() {
  return renderToStaticMarkup(await AdminPackagesPage());
}

beforeEach(() => {
  vi.mocked(requirePlatformAction).mockReset().mockResolvedValue({ id: 'staff-1' } as never);
  vi.mocked(getPlatformAbility).mockReset().mockResolvedValue(readAndCreate());
  vi.mocked(listPackages).mockReset().mockResolvedValue([]);
});

describe('/admin/packages', () => {
  it('is behind read Package', async () => {
    await render();
    expect(requirePlatformAction).toHaveBeenCalledWith('read', 'Package');
  });

  it('refuses before any package is read', async () => {
    vi.mocked(requirePlatformAction).mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    expect(listPackages).not.toHaveBeenCalled();
  });

  it('shows the new-package link to a viewer who may create a package', async () => {
    const html = await render();
    expect(html).toContain('href="/admin/packages/new"');
    expect(html).toContain('חבילה חדשה');
  });

  it('hides the new-package link from a viewer who may only read packages', async () => {
    vi.mocked(getPlatformAbility).mockResolvedValue(readOnly());
    const html = await render();
    expect(html).not.toContain('href="/admin/packages/new"');
    expect(html).not.toContain('חבילה חדשה');
  });
});
