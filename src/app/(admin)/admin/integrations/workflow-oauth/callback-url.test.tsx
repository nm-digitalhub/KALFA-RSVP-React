// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The inspector module also exports server-action wiring; only CopyButton is
// under test here.
vi.mock('../../webhooks/actions', () => ({ reprocessWebhookEventAction: vi.fn() }));

import { CopyButton } from '../../webhooks/webhook-inspector-client';
import { OAuthCallbackUrl } from './callback-url';

// Copy buttons on @mantine/hooks useClipboard: a ✓ only after the write really
// succeeded, reverting on its own; a failed or impossible copy never claims ✓
// and never throws out of the click handler.
const URL = 'https://beta.kalfa.me/api/oauth/callback';

let writeText: ReturnType<typeof vi.fn>;

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  writeText = vi.fn(async () => {});
  setClipboard({ writeText });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // jsdom has no clipboard of its own; leave it absent again.
  Reflect.deleteProperty(navigator, 'clipboard');
});

async function click(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

describe('OAuthCallbackUrl copy', () => {
  it('writes the URL, shows ✓, and reverts after 2s', async () => {
    render(<OAuthCallbackUrl url={URL} />);

    await click('העתקה');
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(screen.getByRole('button', { name: 'הועתק' })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(screen.getByRole('button', { name: 'הועתק' })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole('button', { name: 'העתקה' })).toBeTruthy();
  });

  it('with no clipboard API (plain HTTP) shows no ✓ and does not throw', async () => {
    setClipboard(undefined);
    Reflect.deleteProperty(navigator, 'clipboard');
    render(<OAuthCallbackUrl url={URL} />);

    await click('העתקה');
    expect(screen.getByRole('button', { name: 'העתקה' })).toBeTruthy();
  });

  it('a second copy restarts the revert timer', async () => {
    render(<OAuthCallbackUrl url={URL} />);

    await click('העתקה');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await click('הועתק');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByRole('button', { name: 'הועתק' })).toBeTruthy();
  });
});

describe('webhook CopyButton copy', () => {
  it('shows ✓ on success and reverts after 1.5s', async () => {
    render(<CopyButton value="evt_1" label="העתקת מזהה" />);

    await click('העתקת מזהה');
    expect(writeText).toHaveBeenCalledWith('evt_1');
    expect(document.querySelector('.lucide-check')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(document.querySelector('.lucide-check')).toBeNull();
  });

  it('a rejected write shows no ✓, even right after a successful one', async () => {
    render(<CopyButton value="evt_1" label="העתקת מזהה" />);

    await click('העתקת מזהה');
    expect(document.querySelector('.lucide-check')).not.toBeNull();

    writeText.mockRejectedValueOnce(new Error('denied'));
    await click('העתקת מזהה');
    expect(document.querySelector('.lucide-check')).toBeNull();
  });
});
