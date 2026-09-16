import { describe, expect, it, vi } from 'vitest';

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));

vi.mock('../actions', () => ({ saveWorkflowOAuthProviderAction: saveMock }));

import { saveMicrosoftWorkflowOAuthProviderAction } from './actions';

describe('saveMicrosoftWorkflowOAuthProviderAction', () => {
  it('submits through the existing action with the canonical Microsoft provider', async () => {
    saveMock.mockResolvedValueOnce({ notice: 'saved' });
    const submitted = new FormData();
    submitted.set('provider', 'attacker-controlled-provider');
    submitted.set('clientId', 'client-1');
    submitted.set('clientSecret', 'secret-1');
    submitted.set('enabled', 'on');

    await saveMicrosoftWorkflowOAuthProviderAction(null, submitted);

    const forwarded = saveMock.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(forwarded.entries())).toEqual({
      provider: 'microsoft',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      enabled: 'on',
    });
  });
});
