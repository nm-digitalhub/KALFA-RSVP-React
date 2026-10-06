import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/event-cancellation', () => ({
  resolveCancellationRequest: vi.fn(),
}));

import { resolveCancellationRequest } from '@/lib/data/event-cancellation';
import { resolveCancellationRequestAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe('resolveCancellationRequestAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves full_cancellation successfully', async () => {
    vi.mocked(resolveCancellationRequest).mockResolvedValue(undefined);
    const action = resolveCancellationRequestAction.bind(null, 'r1');
    const result = await action(
      null,
      fd({ resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' }),
    );
    expect(resolveCancellationRequest).toHaveBeenCalledWith('r1', {
      resolution: 'full_cancellation',
      resolutionNote: 'בוטל במלואו',
    });
    expect(result?.notice).toBeDefined();
  });

  it('requires resolutionAmount for partial_charge', async () => {
    const action = resolveCancellationRequestAction.bind(null, 'r1');
    const result = await action(
      null,
      fd({ resolution: 'partial_charge', resolutionNote: 'חיוב חלקי' }),
    );
    expect(result?.fieldErrors?.resolutionAmount).toBeDefined();
    expect(resolveCancellationRequest).not.toHaveBeenCalled();
  });

  it('passes a percentage fee through as a number, with no amount', async () => {
    vi.mocked(resolveCancellationRequest).mockResolvedValue(undefined);
    const action = resolveCancellationRequestAction.bind(null, 'r1');
    const result = await action(
      null,
      fd({ resolution: 'partial_charge', resolutionPercent: '5', resolutionNote: 'דמי ביטול באחוזים' }),
    );
    expect(resolveCancellationRequest).toHaveBeenCalledWith('r1', {
      resolution: 'partial_charge',
      resolutionPercent: 5,
      resolutionNote: 'דמי ביטול באחוזים',
    });
    expect(result?.notice).toBeDefined();
  });

  it('refuses an amount and a percentage together, on the percentage field, and calls nothing', async () => {
    const action = resolveCancellationRequestAction.bind(null, 'r1');
    const result = await action(
      null,
      fd({ resolution: 'partial_charge', resolutionAmount: '30', resolutionPercent: '5', resolutionNote: 'שניהם יחד' }),
    );
    expect(result?.fieldErrors?.resolutionPercent).toBeDefined();
    expect(resolveCancellationRequest).not.toHaveBeenCalled();
  });

  it('treats an empty percentage box as absent, so the amount alone is accepted', async () => {
    vi.mocked(resolveCancellationRequest).mockResolvedValue(undefined);
    const action = resolveCancellationRequestAction.bind(null, 'r1');
    await action(
      null,
      fd({ resolution: 'partial_charge', resolutionAmount: '30', resolutionPercent: '', resolutionNote: 'סכום בלבד' }),
    );
    expect(resolveCancellationRequest).toHaveBeenCalledWith('r1', {
      resolution: 'partial_charge',
      resolutionAmount: 30,
      resolutionNote: 'סכום בלבד',
    });
  });

  it('resolves declined successfully', async () => {
    vi.mocked(resolveCancellationRequest).mockResolvedValue(undefined);
    const action = resolveCancellationRequestAction.bind(null, 'r1');
    const result = await action(
      null,
      fd({ resolution: 'declined', resolutionNote: 'לא ניתן לאשר' }),
    );
    expect(result?.notice).toBeDefined();
  });

  it('re-throws a Next.js control-flow signal instead of swallowing it', async () => {
    vi.mocked(resolveCancellationRequest).mockRejectedValue(NEXT_REDIRECT);
    const action = resolveCancellationRequestAction.bind(null, 'r1');
    await expect(
      action(null, fd({ resolution: 'declined', resolutionNote: 'טקסט תקין' })),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('surfaces the data-layer error message on failure', async () => {
    vi.mocked(resolveCancellationRequest).mockRejectedValue(new Error('בקשה זו כבר טופלה'));
    const action = resolveCancellationRequestAction.bind(null, 'r1');
    const result = await action(
      null,
      fd({ resolution: 'declined', resolutionNote: 'טקסט תקין' }),
    );
    expect(result?.error).toBe('בקשה זו כבר טופלה');
  });
});
