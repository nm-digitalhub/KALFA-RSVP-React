// @vitest-environment jsdom
import { UPDATE_DATA, type Middleware } from '@jsonforms/core';
import { JsonForms } from '@jsonforms/react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useMemo } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OAUTH_POPUP_CHANNEL,
  OAUTH_POPUP_TAG,
} from '@/lib/integrations/oauth-popup-constants';
import { INTEGRATION_CONNECTION_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

// ── the two mocks, and why each one cannot be the real thing ─────────────────
//
// `useRouter`: jsdom has no App Router mounted, and the real hook throws
// ("invariant expected app router to be mounted"). A stable object, like the
// real `publicAppRouterInstance`.
//
// `useWorkflowBuilderActions`: its `save` comes from the SDK's save context,
// whose provider (`e4` in the 2.3.0 bundle) is not exported and is only mounted
// by `<WorkflowBuilder.Root>` — React Flow, the palette, the store bootstrap —
// which cannot render in jsdom. Outside it, the context default logs "Missing
// onSave callback" and resolves 'error'. Everything else from the SDK is real:
// `withJsonFormsControlProps`, `JsonFormsDispatch`, `FormControlWithLabel`.
const mocks = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
  save: vi.fn<() => Promise<'success' | 'error' | 'alreadyStarted'>>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@workflowbuilder/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@workflowbuilder/sdk')>()),
  useWorkflowBuilderActions: () => ({ save: mocks.save }),
}));

import {
  integrationConnectionRenderer,
  OAUTH_POPUP_TIMEOUT_MS,
  OAuthConnectionProvider,
} from './integration-connection-control';

// ── fixtures ─────────────────────────────────────────────────────────────────

function schemaWith(ids: string[]) {
  return {
    type: 'object',
    properties: {
      connectionId: {
        type: 'string',
        options: ids.map((value) => ({ value, label: value })),
      },
    },
  };
}

const uischema = {
  type: 'Control',
  scope: '#/properties/connectionId',
  label: 'חיבור Microsoft 365',
  options: {
    format: INTEGRATION_CONNECTION_FORMAT,
    provider: 'microsoft',
    capability: 'mail.send',
  },
};

type Data = { connectionId?: string };

/** Stable, like the panel's: a new `data` object would re-sync JsonForms' core. */
const NO_DATA: Data = {};

/**
 * The properties panel, reduced to what matters here.
 *
 * ⚠️ WRITES ARE RECORDED BY A JSONFORMS MIDDLEWARE, NOT BY `onChange`. JsonForms
 * reports `onChange` through a lodash `debounce(…, 10)` on REAL timers, so a
 * test reading it has to wait an unknown amount of wall-clock time — which is
 * what made the selection case flaky under a loaded full-suite run. The
 * middleware sees each `UPDATE_DATA` synchronously, at the moment the
 * control's `handleChange` dispatches it, so no assertion waits on a clock.
 */
function Editor({ ids, onWrite }: { ids: string[]; onWrite: (data: Data) => void }) {
  const key = ids.join(',');
  const schema = useMemo(() => schemaWith(key === '' ? [] : key.split(',')), [key]);
  const middleware = useMemo<Middleware>(
    () => (state, action, reducer) => {
      const next = reducer(state, action);
      if (action.type === UPDATE_DATA) onWrite(next.data as Data);
      return next;
    },
    [onWrite],
  );
  return (
    <OAuthConnectionProvider
      workflowId="wf-1"
      canConnectMicrosoft
      unavailableReason={null}
      hasConnections
    >
      <JsonForms
        schema={schema}
        uischema={uischema}
        data={NO_DATA}
        renderers={[integrationConnectionRenderer]}
        middleware={middleware}
      />
    </OAuthConnectionProvider>
  );
}

function editor(ids: string[], onWrite: (data: Data) => void) {
  return <Editor ids={ids} onWrite={onWrite} />;
}

/** A BroadcastChannel we can speak on and inspect. */
class FakeChannel {
  static instances: FakeChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();
  constructor(readonly name: string) {
    FakeChannel.instances.push(this);
  }
}

// Text queries, not `getByRole`: role queries compute the accessibility tree on
// every call (the first one measured 242ms cold here), which is what turned a
// loaded full-suite run into 5-second timeouts. Nothing asserted needs a role.
const connectButton = (): HTMLButtonElement => {
  const button = screen.getByText(/חיבור חשבון חדש|שומר ופותח/).closest('button');
  expect(button).not.toBeNull();
  return button!;
};
const alertText = (): string =>
  Array.from(document.querySelectorAll('[role="alert"]'))
    .map((node) => node.textContent ?? '')
    .join(' ');
const ours = (connectionId: string) => ({ tag: OAUTH_POPUP_TAG, ok: true, connectionId });

function postToWindow(data: unknown, origin = window.location.origin) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  });
}

function postToChannel(data: unknown) {
  const channel = FakeChannel.instances.find((c) => c.name === OAUTH_POPUP_CHANNEL);
  expect(channel, 'the control should have opened the OAuth channel').toBeDefined();
  act(() => {
    channel!.onmessage?.(new MessageEvent('message', { data }));
  });
}

let popup: { location: { href: string }; close: ReturnType<typeof vi.fn> };
let openSpy: ReturnType<typeof vi.spyOn>;

/** Renders, clicks connect, and lets the save resolve. */
async function startConnecting(onWrite: (data: Data) => void = () => {}) {
  const view = render(editor(['c-old'], onWrite));
  await act(async () => {
    fireEvent.click(connectButton());
  });
  return view;
}

// ONE-TIME COST, PAID OUTSIDE ANY TEST. The first render in a worker initialises
// React, JsonForms' Ajv and the SDK renderers — measured 175ms idle, and several
// seconds in a CPU-starved full-suite run, where it landed inside whichever test
// ran first and timed it out. Warming here keeps every test's budget its own.
beforeAll(() => {
  render(editor(['c-old'], () => {}));
  connectButton();
  cleanup();
});

afterAll(() => {
  cleanup();
});

beforeEach(() => {
  FakeChannel.instances = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  popup = { location: { href: 'about:blank' }, close: vi.fn() };
  openSpy = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  mocks.save.mockResolvedValue('success');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.router.refresh.mockReset();
  mocks.save.mockReset();
});

// ── the flow ─────────────────────────────────────────────────────────────────

describe('OAuth popup flow (runtime)', () => {
  it('a blocked popup says so and saves nothing', async () => {
    openSpy.mockReturnValue(null);
    render(editor(['c-old'], () => {}));

    await act(async () => {
      fireEvent.click(connectButton());
    });

    expect(alertText()).toContain('הדפדפן חסם');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('opens the window first, saves, then sends it to the start route', async () => {
    await startConnecting();

    expect(openSpy).toHaveBeenCalledWith('about:blank', 'kalfa-oauth', expect.any(String));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toContain('/api/integrations/oauth/start?');
    expect(connectButton()).toHaveProperty('disabled', true);
  });

  it('⚠️ success over postMessage refreshes, then selects the new connection once it exists', async () => {
    const writes: Data[] = [];
    const record = (data: Data) => writes.push(data);
    const { rerender } = await startConnecting(record);

    postToWindow(ours('c-new'));

    expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
    // Not yet: the option does not exist until the refresh lands. Writes are
    // recorded synchronously, so an empty list here means nothing was written.
    expect(writes).toEqual([]);

    // The refresh lands: the server render now offers the new connection.
    rerender(editor(['c-old', 'c-new'], record));

    // `rerender` runs inside act, which flushes the schema sync and the control's
    // apply-effect before returning — so the write is already recorded.
    expect(writes).toEqual([{ connectionId: 'c-new' }]);
    expect(connectButton()).toHaveProperty('disabled', false);
  });

  it('success over BroadcastChannel alone is enough', async () => {
    await startConnecting();

    postToChannel(ours('c-new'));

    expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  });

  it('⚠️ a report on BOTH channels is handled once', async () => {
    await startConnecting();

    // Both inside ONE act: they arrive before React re-renders and runs the
    // cleanup, which is the case the `settled` guard exists for (measured live:
    // 25ms apart). Posted in separate acts, the cleanup alone would hide it.
    const channel = FakeChannel.instances.find((c) => c.name === OAUTH_POPUP_CHANNEL)!;
    act(() => {
      channel.onmessage?.(new MessageEvent('message', { data: ours('c-new') }));
      window.dispatchEvent(
        new MessageEvent('message', { data: ours('c-new'), origin: window.location.origin }),
      );
    });

    expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  });

  it('⚠️ ignores a correctly-shaped message from another origin', async () => {
    await startConnecting();

    postToWindow(ours('c-evil'), 'https://evil.example');

    expect(mocks.router.refresh).not.toHaveBeenCalled();
    expect(connectButton()).toHaveProperty('disabled', true);
  });

  it('a reported failure is shown, and nothing is refreshed', async () => {
    await startConnecting();

    postToWindow({ tag: OAUTH_POPUP_TAG, ok: false, reason: 'denied' });

    expect(mocks.router.refresh).not.toHaveBeenCalled();
    expect(alertText()).toContain('החיבור לא הושלם');
  });

  it('times out after five minutes of silence', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await startConnecting();

    act(() => {
      vi.advanceTimersByTime(OAUTH_POPUP_TIMEOUT_MS);
    });

    expect(alertText()).toContain('לא הושלם בזמן');
    expect(connectButton()).toHaveProperty('disabled', false);
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });

  it('a failed save closes the popup and never navigates it', async () => {
    mocks.save.mockResolvedValue('error');

    await startConnecting();

    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toBe('about:blank');
    expect(alertText()).toContain('לא ניתן היה לשמור');
    // Connecting ended, so the channel opened for it is closed again.
    expect(FakeChannel.instances.every((c) => c.close.mock.calls.length === 1)).toBe(true);
  });

  it('a throwing save is handled the same way', async () => {
    mocks.save.mockRejectedValue(new Error('network'));

    await startConnecting();

    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(alertText()).toContain('לא ניתן היה לשמור');
  });

  it('⚠️ unmounting while connecting removes the listener, closes the channel and stops the timer', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    const { unmount } = await startConnecting();
    const channel = FakeChannel.instances[0]!;

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', { data: ours('c-new'), origin: window.location.origin }),
    );
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });
});
