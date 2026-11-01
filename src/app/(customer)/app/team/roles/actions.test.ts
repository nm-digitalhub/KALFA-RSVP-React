import { beforeEach, describe, expect, it, vi } from 'vitest';

// The org role-permission actions: the owner gate runs before the input is read, a malformed input is answered with
// the one Hebrew message the matrix shows, and a data-layer refusal reaches it unchanged.

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireActiveOrg: vi.fn(), requireOrgOwner: vi.fn() }));
vi.mock('@/lib/data/orgs', () => ({
  setOrgRolePermission: vi.fn(),
  resetOrgRolePermissionsToDefault: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { requireActiveOrg, requireOrgOwner } from '@/lib/auth/dal';
import { resetOrgRolePermissionsToDefault, setOrgRolePermission } from '@/lib/data/orgs';
import { resetOrgRolePermissionsAction, setOrgRolePermissionAction } from './actions';

const ROLE = '11111111-1111-4111-8111-111111111111';
const PERMISSION = '22222222-2222-4222-8222-222222222222';
const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app/team;307;',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireActiveOrg).mockResolvedValue({ orgId: 'org-1', roleId: 'r', roleName: 'owner' });
  vi.mocked(requireOrgOwner).mockResolvedValue({ id: 'u-1' } as never);
});

describe('setOrgRolePermissionAction', () => {
  it('writes the cell for the caller’s own org and answers with the notice', async () => {
    const result = await setOrgRolePermissionAction({ roleId: ROLE, permissionId: PERMISSION, granted: true });

    expect(requireOrgOwner).toHaveBeenCalledWith('org-1');
    expect(setOrgRolePermission).toHaveBeenCalledWith('org-1', ROLE, PERMISSION, true);
    expect(revalidatePath).toHaveBeenCalledWith('/app/team/roles');
    expect(result).toEqual({ data: { notice: 'נשמר' } });
  });

  it.each([
    [{ roleId: 'x', permissionId: PERMISSION, granted: true }, 'roleId'],
    [{ roleId: ROLE, permissionId: '', granted: true }, 'permissionId'],
    [{ roleId: ROLE, permissionId: PERMISSION, granted: 'yes' }, 'granted'],
  ])('answers a malformed input %j with ‘ערך לא תקין’ and writes nothing', async (input, field) => {
    const result = await setOrgRolePermissionAction(input as never);

    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { [field]: ['ערך לא תקין'] } } });
    expect(setOrgRolePermission).not.toHaveBeenCalled();
  });

  it('a non-object input is the same message', async () => {
    const result = await setOrgRolePermissionAction(null as never);

    expect(result).toEqual({ validationErrors: { formErrors: ['ערך לא תקין'], fieldErrors: {} } });
  });

  it('the owner gate runs BEFORE the input is read: a non-owner is redirected even with a malformed input', async () => {
    vi.mocked(requireOrgOwner).mockRejectedValue(NEXT_REDIRECT);

    await expect(setOrgRolePermissionAction({ roleId: 'x' } as never)).rejects.toThrow('NEXT_REDIRECT');
    expect(setOrgRolePermission).not.toHaveBeenCalled();
  });

  it('passes the data layer’s own Hebrew refusal through', async () => {
    vi.mocked(setOrgRolePermission).mockRejectedValue(new Error('לא ניתן לשנות את הרשאות הבעלים — הן קבועות'));

    const result = await setOrgRolePermissionAction({ roleId: ROLE, permissionId: PERMISSION, granted: false });

    expect(result).toEqual({ serverError: 'לא ניתן לשנות את הרשאות הבעלים — הן קבועות' });
  });
});

describe('resetOrgRolePermissionsAction', () => {
  it('resets the role in the caller’s own org and answers with the notice', async () => {
    const result = await resetOrgRolePermissionsAction({ roleId: ROLE });

    expect(resetOrgRolePermissionsToDefault).toHaveBeenCalledWith('org-1', ROLE);
    expect(result).toEqual({ data: { notice: 'התפקיד אופס לברירת המחדל' } });
  });

  it('answers a malformed role id with ‘ערך לא תקין’', async () => {
    const result = await resetOrgRolePermissionsAction({ roleId: 'owner' });

    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { roleId: ['ערך לא תקין'] } } });
    expect(resetOrgRolePermissionsToDefault).not.toHaveBeenCalled();
  });

  it('the active-org gate runs BEFORE the input is read', async () => {
    vi.mocked(requireActiveOrg).mockRejectedValue(NEXT_REDIRECT);

    await expect(resetOrgRolePermissionsAction({ roleId: 'owner' })).rejects.toThrow('NEXT_REDIRECT');
    expect(requireOrgOwner).not.toHaveBeenCalled();
  });

  it('passes the data layer’s own Hebrew refusal through', async () => {
    vi.mocked(resetOrgRolePermissionsToDefault).mockRejectedValue(new Error('איפוס ההרשאות נכשל'));

    const result = await resetOrgRolePermissionsAction({ roleId: ROLE });

    expect(result).toEqual({ serverError: 'איפוס ההרשאות נכשל' });
  });
});
