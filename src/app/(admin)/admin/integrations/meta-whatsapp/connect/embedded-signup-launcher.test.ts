// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { actionMock } = vi.hoisted(() => ({ actionMock: vi.fn() }));
vi.mock('./actions', () => ({ connectEmbeddedSignupAction: actionMock }));
// The SDK script is not loaded in tests; fire onReady as next/script would.
vi.mock('next/script', () => ({
  default: function Script({ onReady }: { onReady?: () => void }) {
    useEffect(() => onReady?.(), [onReady]);
    return null;
  },
}));

import { EmbeddedSignupLauncher } from './embedded-signup-launcher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type LoginCb = (r: { authResponse?: { code?: string } | null }) => void;
let loginCb: LoginCb | null;
let container: HTMLDivElement;
let root: Root;

function button(): HTMLButtonElement {
  return container.querySelector('button') as HTMLButtonElement;
}

async function post(origin: string, data: unknown) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { origin, data: JSON.stringify(data) }));
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  loginCb = null;
  window.FB = {
    init: vi.fn(),
    login: vi.fn((cb: LoginCb) => {
      loginCb = cb;
    }),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(EmbeddedSignupLauncher, { appId: "1", configId: "123456" })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.FB;
});

describe('EmbeddedSignupLauncher', () => {
  it('launches with the Coexistence featureType', async () => {
    await act(async () => button().click());
    const opts = vi.mocked(window.FB!.login).mock.calls[0][1];
    expect(opts.extras).toMatchObject({ featureType: 'whatsapp_business_app_onboarding' });
  });

  it('a callback without authResponse never calls the action', async () => {
    await act(async () => button().click());
    await act(async () => loginCb!({ authResponse: null }));
    expect(actionMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('החיבור בוטל');
    expect(button().disabled).toBe(false);
  });

  it('a Meta error message while the action is running keeps the button disabled', async () => {
    actionMock.mockReturnValue(new Promise(() => {})); // never settles
    await act(async () => button().click());
    await act(async () => loginCb!({ authResponse: { code: 'AQBhlXsctMxJ' } }));
    expect(actionMock).toHaveBeenCalledTimes(1);
    await post('https://www.facebook.com', {
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'CANCEL',
      data: { error_code: '1', session_id: 's' },
    });
    expect(button().disabled).toBe(true);
  });

  it('ignores a message from a spoofed origin', async () => {
    await act(async () => button().click());
    await post('https://evilfacebook.com', {
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'CANCEL',
      data: { current_step: 'PERMISSIONS' },
    });
    expect(container.textContent).not.toContain('החיבור בוטל');
    expect(button().disabled).toBe(true);
  });
});
