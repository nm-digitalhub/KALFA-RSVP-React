import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import {
  listActivity,
  recentActivity,
  ACTIVITY_COLUMNS,
  ACTIVITY_ACTION_OPTIONS,
  ACTIVITY_ENTITY_OPTIONS,
  describeActivity,
  listActivityActorOptions,
  resolveActivityActors,
  type ActivityEntry,
} from './activity';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

function row(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'a-1',
    action: 'event.created',
    event_id: 'e-1',
    user_id: 'u-1',
    meta: { count: 3 },
    created_at: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(adminUser());
});

describe('listActivity', () => {
  it('selects the DTO columns from activity_log with a count', async () => {
    const { client, builder } = createMockSupabase<ActivityEntry[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await listActivity();

    expect(client.from).toHaveBeenCalledWith('activity_log');
    expect(builder.select).toHaveBeenCalledWith(ACTIVITY_COLUMNS, {
      count: 'exact',
    });
    expect(result.total).toBe(1);
  });

  it('does NOT query when the admin gate redirects', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<ActivityEntry[]>({
      data: [],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(listActivity()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('recentActivity', () => {
  it('ranges over the clamped limit window', async () => {
    const { client, builder } = createMockSupabase<ActivityEntry[]>({
      data: [row()],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await recentActivity(5);

    expect(builder.range).toHaveBeenCalledWith(0, 4);
  });

  it('throws a safe error on failure', async () => {
    const { client } = createMockSupabase<ActivityEntry[]>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(recentActivity()).rejects.toThrow('טעינת היומן נכשלה');
  });
});

describe('listActivity filters', () => {
  it('applies action, actor and date filters', async () => {
    const { client, builder } = createMockSupabase<ActivityEntry[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await listActivity({
      action: 'guest.created',
      userId: 'u-1',
      from: '2026-06-20',
      to: '2026-06-22',
    });

    expect(builder.eq).toHaveBeenCalledWith('action', 'guest.created');
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'u-1');
    expect(builder.gte).toHaveBeenCalledWith(
      'created_at',
      '2026-06-20T00:00:00.000Z',
    );
    expect(builder.lte).toHaveBeenCalledWith(
      'created_at',
      '2026-06-22T23:59:59.999Z',
    );
  });
});

describe('listActivity entity facet', () => {
  it('narrows to the action codes of a known entity', async () => {
    const { client, builder } = createMockSupabase<ActivityEntry[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await listActivity({ entity: 'guest' });

    expect(builder.in).toHaveBeenCalledWith(
      'action',
      expect.arrayContaining([
        'guest.created',
        'guest.updated',
        'guest.deleted',
        'guest.contact_status_updated',
        // The plural bulk-import action folds onto the singular guest entity.
        'guests.imported',
      ]),
    );
  });

  it('ignores an unknown entity value', async () => {
    const { client, builder } = createMockSupabase<ActivityEntry[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await listActivity({ entity: 'spaceship' });

    expect(builder.in).not.toHaveBeenCalled();
  });
});

describe('listActivity search', () => {
  it('builds a sanitised or() filter across action and meta keys', async () => {
    const { client, builder } = createMockSupabase<ActivityEntry[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await listActivity({ search: 'מתנה' });

    expect(builder.or).toHaveBeenCalledTimes(1);
    const filter = vi.mocked(builder.or).mock.calls[0][0] as string;
    expect(filter).toContain('action.ilike.*מתנה*');
    expect(filter).toContain('meta->>packageName.ilike.*מתנה*');
    expect(filter).toContain('meta->>guestId.ilike.*מתנה*');
  });

  it('strips PostgREST control chars so search cannot inject extra clauses', async () => {
    const { client, builder } = createMockSupabase<ActivityEntry[]>({
      data: [],
      error: null,
      count: 0,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await listActivity({ search: 'a,b)c*%"\\' });

    const filter = vi.mocked(builder.or).mock.calls[0][0] as string;
    // Every comma in the filter is a clause separator we control; the cleaned
    // term ('abc') must contribute none, so the clause count stays fixed.
    expect(filter.split(',')).toHaveLength(7);
    expect(filter).toContain('action.ilike.*abc*');
  });

  it('ignores a whitespace-only search term', async () => {
    const { client, builder } = createMockSupabase<ActivityEntry[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await listActivity({ search: '   ' });

    expect(builder.or).not.toHaveBeenCalled();
  });
});

describe('describeActivity', () => {
  it('formats a guest creation entry for the admin journal', () => {
    const entry: ActivityEntry = {
      id: 'a-2',
      action: 'guest.created',
      event_id: 'e-1',
      user_id: 'u-1',
      meta: { guestId: 'g-1', status: 'maybe', fields: ['full_name'] },
      created_at: '2026-06-20T10:00:00.000Z',
    };

    const display = describeActivity(entry, new Map([['u-1', 'דנה כהן']]));

    expect(display.actionLabel).toBe('מוזמן נוסף');
    expect(display.actorLabel).toBe('דנה כהן');
    expect(display.summary).toContain('מוזמן');
  });
});

describe('resolveActivityActors', () => {
  it('resolves profile names in batch for admin rows', async () => {
    const { client, builder } = createMockSupabase<
      Array<{ id: string; full_name: string | null }>
    >({
      data: [
        { id: 'u-1', full_name: 'דנה כהן' },
        { id: 'u-2', full_name: null },
      ],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const actors = await resolveActivityActors(['u-1', 'u-2', 'u-1']);

    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(builder.select).toHaveBeenCalledWith('id, full_name');
    expect(builder.in).toHaveBeenCalledWith('id', ['u-1', 'u-2']);
    expect(actors.get('u-1')).toBe('דנה כהן');
    expect(actors.get('u-2')).toBe('משתמש #u-2');
  });
});

describe('listActivityActorOptions', () => {
  it('returns sorted actor options from recent activity rows', async () => {
    // Models both shapes the two sequential queries return: the activity rows
    // carry `user_id`, the profile rows carry `id`/`full_name`. Every field is
    // therefore optional on the shared union.
    type OptionRow = {
      user_id?: string | null;
      id?: string;
      full_name?: string | null;
    };

    const { client, builder } = createMockSupabase<Array<OptionRow>>({
      data: [{ user_id: 'u-2' }, { user_id: 'u-1' }],
      error: null,
    });
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((onFulfilled) =>
        onFulfilled({ data: [{ user_id: 'u-2' }, { user_id: 'u-1' }], error: null }),
      )
      .mockImplementationOnce((onFulfilled) =>
        onFulfilled({
          data: [
            { id: 'u-2', full_name: 'משה לוי' },
            { id: 'u-1', full_name: 'דנה כהן' },
          ],
          error: null,
        }),
      );
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const options = await listActivityActorOptions(2);

    expect(builder.select).toHaveBeenCalledWith('user_id');
    expect(builder.select).toHaveBeenCalledWith('id, full_name');
    expect(options).toEqual([
      { id: 'u-1', label: 'דנה כהן' },
      { id: 'u-2', label: 'משה לוי' },
    ]);
  });
});

describe('activity action labels', () => {
  it('exposes the curated filter options', () => {
    expect(ACTIVITY_ACTION_OPTIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'event.created' }),
        expect.objectContaining({ value: 'package.deleted' }),
      ]),
    );
  });
});

describe('activity entity options', () => {
  it('exposes the derived target-entity facet', () => {
    expect(ACTIVITY_ENTITY_OPTIONS).toEqual(
      expect.arrayContaining([
        { value: 'event', label: 'אירוע' },
        { value: 'guest', label: 'מוזמנים' },
        { value: 'package', label: 'חבילות' },
      ]),
    );
  });

  it('folds the plural import action onto the guest entity (no stray facet)', () => {
    expect(ACTIVITY_ENTITY_OPTIONS.some((option) => option.value === 'guests')).toBe(
      false,
    );
  });
});
