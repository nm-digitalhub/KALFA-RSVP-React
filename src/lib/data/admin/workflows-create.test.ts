import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, adminMock, insertMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  adminMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));

import { createWorkflow } from './workflows';

// The defect, MEASURED on the live table: fifteen workflows named "Hhh"/"Hhhjj"
// created between 04:29:27 and 04:29:44 on 2026-09-10 — seventeen seconds. The
// create form used a bare submit button, so it stayed clickable for the whole
// round-trip and every further click was another INSERT.
//
// The button is pending-aware now, but a disabled button cannot stop a genuine
// double POST, and this is a table an admin then cleans by hand.

type Row = { id: string; definition: unknown; created_at: string };

/** `recent` is what the duplicate probe finds; insert returns a fresh id. */
function mockDb(recent: Row[]) {
  const probe = {
    select: () => probe,
    eq: () => probe,
    gte: () => probe,
    order: () => probe,
    limit: async () => ({ data: recent, error: null }),
  };
  adminMock.mockReturnValue({
    from: () => ({
      ...probe,
      insert: (values: unknown) => {
        insertMock(values);
        return {
          select: () => ({ single: async () => ({ data: { id: 'new-id' }, error: null }) }),
        };
      },
    }),
  });
}

const justNow = () => new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ id: 'u1' });
  mockDb([]);
});

describe('createWorkflow — the ordinary path', () => {
  it('inserts when nothing matches', async () => {
    await expect(createWorkflow('תהליך חדש')).resolves.toBe('new-id');
    expect(insertMock).toHaveBeenCalledWith({ name: 'תהליך חדש', definition: {} });
  });

  it('trims the name', async () => {
    await createWorkflow('  שם  ');
    expect(insertMock).toHaveBeenCalledWith({ name: 'שם', definition: {} });
  });

  it('refuses an empty name before touching the table', async () => {
    await expect(createWorkflow('   ')).rejects.toThrow(/ריק/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('requires manage_settings', async () => {
    await createWorkflow('x');
    expect(permMock).toHaveBeenCalledWith('manage_settings');
  });
});

describe('createWorkflow — a double submit does not leave a second empty row', () => {
  it('returns the UNTOUCHED workflow created seconds ago instead of inserting', async () => {
    mockDb([{ id: 'first-click', definition: {}, created_at: justNow() }]);
    await expect(createWorkflow('Hhh')).resolves.toBe('first-click');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('treats a definition with no `nodes` key as untouched', async () => {
    mockDb([{ id: 'first-click', definition: { name: 'x' }, created_at: justNow() }]);
    await expect(createWorkflow('Hhh')).resolves.toBe('first-click');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('a null definition is untouched too', async () => {
    mockDb([{ id: 'first-click', definition: null, created_at: justNow() }]);
    await expect(createWorkflow('Hhh')).resolves.toBe('first-click');
  });
});

describe('createWorkflow — what it must NOT swallow', () => {
  it('a recent workflow that HAS a diagram is not reused', async () => {
    // Someone deliberately making a second workflow beside one they just drew
    // must get a second workflow.
    mockDb([
      { id: 'has-diagram', definition: { nodes: [{ id: 'n1' }], edges: [] }, created_at: justNow() },
    ]);
    await expect(createWorkflow('Hhh')).resolves.toBe('new-id');
    expect(insertMock).toHaveBeenCalled();
  });

  it('an EMPTY diagram still counts as touched — nodes: [] is a saved canvas', async () => {
    // The owner cleared the canvas and saved. That is a decision, not an
    // abandoned click.
    mockDb([{ id: 'cleared', definition: { nodes: [], edges: [] }, created_at: justNow() }]);
    await expect(createWorkflow('Hhh')).resolves.toBe('new-id');
  });

  it('an old empty draft of the same name is never silently reused', async () => {
    // The 60-second window is what keeps last week's abandoned "Hhh" from
    // hijacking a deliberate new one. The probe filters by created_at, so an old
    // row simply never reaches the candidate check.
    mockDb([]);
    await expect(createWorkflow('Hhh')).resolves.toBe('new-id');
    expect(insertMock).toHaveBeenCalled();
  });
});
