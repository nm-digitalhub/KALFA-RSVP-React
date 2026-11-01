import { beforeEach, describe, expect, it, vi } from 'vitest';

// The platform RBAC actions: the owner gate runs BEFORE the input is validated (an action-level use() middleware), the
// id-only actions answer malformed input with the one message 'ערך לא תקין', and the role form and the console
// enrolment keep their own Hebrew messages.

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformOwner: vi.fn() }));
vi.mock('@/lib/data/admin/platform-roles', () => ({
  assignStaffRole: vi.fn(),
  blockConsoleAgent: vi.fn(),
  createPlatformRole: vi.fn(),
  enrollConsoleAgent: vi.fn(),
  removeConsoleAgent: vi.fn(),
  revokeStaffRole: vi.fn(),
  setRolePermission: vi.fn(),
  unblockConsoleAgent: vi.fn(),
}));

import { revalidatePath } from 'next/cache';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  assignStaffRole,
  blockConsoleAgent,
  createPlatformRole,
  enrollConsoleAgent,
  removeConsoleAgent,
  revokeStaffRole,
  setRolePermission,
  unblockConsoleAgent,
} from '@/lib/data/admin/platform-roles';
import { actionErrorMessage } from '@/lib/action-result';

import {
  assignStaffRoleAction,
  blockConsoleAgentAction,
  createPlatformRoleAction,
  enrollConsoleAgentAction,
  removeConsoleAgentAction,
  revokeStaffRoleAction,
  setRolePermissionAction,
  unblockConsoleAgentAction,
} from './actions';

const USER = '3b0ab9ec-c77b-4c75-b6e4-2c431c1d8cd0';
const ROLE = '11111111-1111-4111-8111-111111111111';
const PERMISSION = '22222222-2222-4222-8222-222222222222';

const REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/auth/login;307;' });

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformOwner).mockResolvedValue({ id: 'owner-1' } as never);
});

describe('the owner gate runs before the input is looked at', () => {
  it.each([
    ['setRolePermissionAction', () => setRolePermissionAction({ roleId: 'x', permissionId: 'y', granted: true })],
    ['createPlatformRoleAction', () => createPlatformRoleAction({}, fd({}))],
    ['assignStaffRoleAction', () => assignStaffRoleAction({ userId: 'x', roleId: 'y' })],
    ['revokeStaffRoleAction', () => revokeStaffRoleAction({ userId: 'x' })],
    ['enrollConsoleAgentAction', () => enrollConsoleAgentAction({ userId: 'x', displayName: '' })],
    ['removeConsoleAgentAction', () => removeConsoleAgentAction({ userId: 'x' })],
    ['blockConsoleAgentAction', () => blockConsoleAgentAction({ userId: 'x' })],
    ['unblockConsoleAgentAction', () => unblockConsoleAgentAction({ userId: 'x' })],
  ])('%s: a non-owner is redirected, never told what is wrong with the input', async (_name, call) => {
    vi.mocked(requirePlatformOwner).mockRejectedValue(REDIRECT);

    await expect(call()).rejects.toThrow('NEXT_REDIRECT');
  });
});

describe('malformed input on the id-only actions', () => {
  it.each([
    ['setRolePermissionAction', () => setRolePermissionAction({ roleId: 'x', permissionId: PERMISSION, granted: true })],
    ['assignStaffRoleAction', () => assignStaffRoleAction({ userId: USER, roleId: 'x' })],
    ['revokeStaffRoleAction', () => revokeStaffRoleAction({ userId: 'x' })],
    ['removeConsoleAgentAction', () => removeConsoleAgentAction({ userId: 'x' })],
    ['blockConsoleAgentAction', () => blockConsoleAgentAction({ userId: 'x' })],
    ['unblockConsoleAgentAction', () => unblockConsoleAgentAction({ userId: 'x' })],
  ])('%s answers "ערך לא תקין" and writes nothing', async (_name, call) => {
    const result = await call();

    expect(actionErrorMessage(result)).toBe('ערך לא תקין');
    for (const write of [setRolePermission, assignStaffRole, revokeStaffRole, removeConsoleAgent, blockConsoleAgent, unblockConsoleAgent]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});

describe('setRolePermissionAction', () => {
  it('toggles the cell and revalidates the roles page', async () => {
    const result = await setRolePermissionAction({ roleId: ROLE, permissionId: PERMISSION, granted: false });

    expect(setRolePermission).toHaveBeenCalledWith(ROLE, PERMISSION, false);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/roles');
    expect(result).toEqual({ data: { notice: 'נשמר' } });
  });

  it("shows the data layer's own Hebrew refusal", async () => {
    vi.mocked(setRolePermission).mockRejectedValue(new Error('הרשאות בעל המערכת קבועות'));

    expect(await setRolePermissionAction({ roleId: ROLE, permissionId: PERMISSION, granted: true })).toEqual({
      serverError: 'הרשאות בעל המערכת קבועות',
    });
  });
});

describe('createPlatformRoleAction', () => {
  it('creates the role from the trimmed fields', async () => {
    const result = await createPlatformRoleAction({}, fd({ name: ' support_agent ', label: ' נציג תמיכה ' }));

    expect(createPlatformRole).toHaveBeenCalledWith('support_agent', 'נציג תמיכה');
    expect(result).toEqual({ data: { notice: 'התפקיד נוצר' } });
  });

  it('reads absent fields as empty and answers on each field in Hebrew', async () => {
    const result = await createPlatformRoleAction({}, fd({}));

    expect(result).toEqual({
      validationErrors: {
        formErrors: [],
        fieldErrors: {
          name: ['שם קצר מדי', 'שם התפקיד באנגלית קטנה, ספרות וקו תחתון בלבד'],
          label: ['תווית קצרה מדי'],
        },
      },
    });
    expect(createPlatformRole).not.toHaveBeenCalled();
  });
});

describe('assignStaffRoleAction / revokeStaffRoleAction', () => {
  it('assigns the role and revalidates both screens', async () => {
    const result = await assignStaffRoleAction({ userId: USER, roleId: ROLE });

    expect(assignStaffRole).toHaveBeenCalledWith(USER, ROLE);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/users/${USER}`);
    expect(result).toEqual({ data: { notice: 'התפקיד הוקצה' } });
  });

  it("surfaces the last-owner guard's own message", async () => {
    vi.mocked(revokeStaffRole).mockRejectedValue(new Error('לא ניתן להסיר את בעל המערכת האחרון'));

    expect(await revokeStaffRoleAction({ userId: USER })).toEqual({ serverError: 'לא ניתן להסיר את בעל המערכת האחרון' });
  });
});

describe('enrollConsoleAgentAction', () => {
  it('answers a too-short display name with its own message, at the top of the section', async () => {
    const result = await enrollConsoleAgentAction({ userId: USER, displayName: ' ד ' });

    expect(actionErrorMessage(result)).toBe('שם התצוגה קצר מדי');
    expect(enrollConsoleAgent).not.toHaveBeenCalled();
  });

  it('a display name the calls system rejected (157) lands on the field, with the form-level message above it', async () => {
    vi.mocked(enrollConsoleAgent).mockResolvedValue({ ok: false, reason: 'api_failed', voxErrorCode: 157 } as never);

    const result = await enrollConsoleAgentAction({ userId: USER, displayName: 'דנה' });

    expect(result).toEqual({
      validationErrors: {
        formErrors: ['הוספת הנציג נכשלה — שם התצוגה נדחה על ידי מערכת השיחות.'],
        fieldErrors: { displayName: ['שם התצוגה נדחה על ידי מערכת השיחות — נסו שם אחר.'] },
      },
    });
  });

  it('any other provisioning failure means the enrolment did not happen', async () => {
    vi.mocked(enrollConsoleAgent).mockResolvedValue({ ok: false, reason: 'not_configured' } as never);

    expect(await enrollConsoleAgentAction({ userId: USER, displayName: 'דנה' })).toEqual({
      serverError: 'הוספת הנציג נכשלה — לא ניתן היה ליצור עבורו זהות במערכת השיחות (not_configured). נסו שוב.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('enrols with the trimmed name', async () => {
    vi.mocked(enrollConsoleAgent).mockResolvedValue({ ok: true, voxUsername: 'u', alreadyProvisioned: false } as never);

    expect(await enrollConsoleAgentAction({ userId: USER, displayName: ' דנה ' })).toEqual({
      data: { notice: 'הנציג נוסף למוקד' },
    });
    expect(enrollConsoleAgent).toHaveBeenCalledWith(USER, 'דנה');
  });
});

describe('removeConsoleAgentAction / blockConsoleAgentAction / unblockConsoleAgentAction', () => {
  it('a failed Voximplant deletion reads as a real failure', async () => {
    vi.mocked(removeConsoleAgent).mockResolvedValue({ ok: false, reason: 'api_failed', voxUsername: 'agent-7' });

    expect(await removeConsoleAgentAction({ userId: USER })).toEqual({
      serverError:
        'הסרת הנציג נכשלה — מחיקת הזהות שלו ב-Voximplant (agent-7) לא הצליחה (api_failed). הנציג עדיין רשום במוקד. נסו שוב.',
    });
  });

  it('an agent with no identity has nothing to block', async () => {
    vi.mocked(blockConsoleAgent).mockResolvedValue({ ok: false, reason: 'not_provisioned' });

    expect(await blockConsoleAgentAction({ userId: USER })).toEqual({
      serverError: 'לנציג זה אין זהות במערכת השיחות — אין מה לחסום.',
    });
  });

  it('unblocks and says so', async () => {
    vi.mocked(unblockConsoleAgent).mockResolvedValue({ ok: true });

    expect(await unblockConsoleAgentAction({ userId: USER })).toEqual({ data: { notice: 'החסימה בוטלה' } });
  });
});
