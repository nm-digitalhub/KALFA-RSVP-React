import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));
vi.mock('@/lib/data/admin/integrations/whatsapp-es', () => ({
  connectViaEmbeddedSignup: connectMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { connectEmbeddedSignupAction } from './actions';

beforeEach(() => vi.clearAllMocks());

describe('connectEmbeddedSignupAction', () => {
  it('rejects malformed input without calling the domain', async () => {
    await expect(connectEmbeddedSignupAction({ code: 'x', finishEvent: 'NOPE' } as never)).resolves.toEqual({
      validationErrors: { formErrors: ['נתוני החיבור אינם תקינים'], fieldErrors: {} },
    });
    await expect(connectEmbeddedSignupAction(null as never)).resolves.toMatchObject({
      validationErrors: { formErrors: ['נתוני החיבור אינם תקינים'] },
    });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('passes a valid code and finish event through', async () => {
    connectMock.mockResolvedValue({ ok: false, message: 'm' });
    const input = { code: 'AQBhlXsctMxJ', finishEvent: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' } as const;
    await connectEmbeddedSignupAction(input);
    expect(connectMock).toHaveBeenCalledWith(input);
  });

  it('an unexpected throw becomes a safe message', async () => {
    connectMock.mockRejectedValue(new Error('internal detail'));
    await expect(
      connectEmbeddedSignupAction({
        code: 'AQBhlXsctMxJ',
        finishEvent: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      }),
    ).resolves.toEqual({ serverError: 'החיבור נכשל. נסו שוב.' });
  });
});
