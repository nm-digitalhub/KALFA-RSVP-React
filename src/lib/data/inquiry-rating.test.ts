import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRatingByToken, submitInquiryRating } from './inquiry-rating';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getRatingByToken', () => {
  it('resolves to { id } for a token that was sent a rating request', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: { id: 'c-1' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(getRatingByToken('a'.repeat(32))).resolves.toEqual({ id: 'c-1' });
    expect(builder.select).toHaveBeenCalledWith('id');
    expect(builder.eq).toHaveBeenCalledWith('rating_token', 'a'.repeat(32));
    expect(builder.not).toHaveBeenCalledWith('rating_requested_at', 'is', null);
  });

  it('fails closed to null on an unknown token (no row)', async () => {
    const { client } = createMockSupabase<{ id: string }>({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    await expect(getRatingByToken('unknown')).resolves.toBeNull();
  });

  it('fails closed to null on a DB error — never distinguishes from unknown', async () => {
    const { client } = createMockSupabase<{ id: string }>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    await expect(getRatingByToken('x')).resolves.toBeNull();
  });
});

describe('submitInquiryRating', () => {
  it('writes score/comment/rating_at and reports ok on a matching token', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: { id: 'c-1' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await submitInquiryRating('a'.repeat(32), 3, 'תודה');

    expect(result).toEqual({ ok: true });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ rating_score: 3, rating_comment: 'תודה', rating_at: expect.any(String) }),
    );
    expect(builder.eq).toHaveBeenCalledWith('rating_token', 'a'.repeat(32));
  });

  it('is re-submittable — a second call with a different score just overwrites', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: { id: 'c-1' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await submitInquiryRating('a'.repeat(32), 1, null);
    await submitInquiryRating('a'.repeat(32), 3, 'שינוי דעת');

    expect(builder.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ rating_score: 3, rating_comment: 'שינוי דעת' }),
    );
  });

  it('reports not-ok when the token matches no row (empty update result)', async () => {
    const { client } = createMockSupabase<{ id: string }>({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(submitInquiryRating('unknown', 2, null)).resolves.toEqual({ ok: false });
  });

  it('reports not-ok on a DB error', async () => {
    const { client } = createMockSupabase<{ id: string }>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(submitInquiryRating('x', 2, null)).resolves.toEqual({ ok: false });
  });
});
