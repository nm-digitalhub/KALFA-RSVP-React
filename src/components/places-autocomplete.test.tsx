// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlacesAutocomplete } from './places-autocomplete';

// The script loader is replaced with a loaded one; what is under test is the
// component's own typing → debounce → fetch path and its value ownership.
vi.mock('@/hooks/use-google-places-script', () => ({
  useGooglePlacesScript: () => ({
    apiKey: 'test-key',
    isLoaded: true,
    error: null,
    hasApiKey: true,
    GoogleMapsScript: null,
  }),
}));

const DEBOUNCE_MS = 300;

let fetchSuggestions: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchSuggestions = vi.fn(async () => ({ suggestions: [] }));
  (window as unknown as { google: unknown }).google = {
    maps: {
      importLibrary: vi.fn(async () => ({
        AutocompleteSessionToken: class {},
        AutocompleteSuggestion: { fetchAutocompleteSuggestions: fetchSuggestions },
      })),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as { google?: unknown }).google;
});

function input(): HTMLInputElement {
  return screen.getByRole('combobox') as HTMLInputElement;
}

async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('PlacesAutocomplete debounce', () => {
  it('coalesces fast typing into one fetch with the final input', async () => {
    render(<PlacesAutocomplete id="venue" debounceMs={DEBOUNCE_MS} />);

    fireEvent.change(input(), { target: { value: 'ת' } });
    await settle(100);
    fireEvent.change(input(), { target: { value: 'תל' } });
    await settle(100);
    fireEvent.change(input(), { target: { value: 'תל א' } });

    await settle(DEBOUNCE_MS - 1);
    expect(fetchSuggestions).not.toHaveBeenCalled();

    await settle(1);
    expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchSuggestions.mock.calls[0]![0]).toMatchObject({ input: 'תל א' });
  });

  it('cancels a pending fetch when the input is cleared', async () => {
    render(<PlacesAutocomplete id="venue" debounceMs={DEBOUNCE_MS} />);

    fireEvent.change(input(), { target: { value: 'חיפה' } });
    await settle(100);
    fireEvent.change(input(), { target: { value: '' } });

    await settle(DEBOUNCE_MS * 2);
    expect(fetchSuggestions).not.toHaveBeenCalled();
  });

  it('never fetches after unmount', async () => {
    const { unmount } = render(<PlacesAutocomplete id="venue" debounceMs={DEBOUNCE_MS} />);

    fireEvent.change(input(), { target: { value: 'ירושלים' } });
    unmount();

    await settle(DEBOUNCE_MS * 2);
    expect(fetchSuggestions).not.toHaveBeenCalled();
  });
});

describe('PlacesAutocomplete value ownership', () => {
  it('uncontrolled: starts from defaultValue and keeps what is typed', () => {
    const onValueChange = vi.fn();
    render(<PlacesAutocomplete id="venue" defaultValue="אולם" onValueChange={onValueChange} />);

    expect(input().value).toBe('אולם');
    fireEvent.change(input(), { target: { value: 'אולם הגן' } });

    expect(input().value).toBe('אולם הגן');
    expect(onValueChange).toHaveBeenCalledWith('אולם הגן');
  });

  it('controlled: reports the change but renders only the value prop', () => {
    const onValueChange = vi.fn();
    render(<PlacesAutocomplete id="venue" value="קבוע" onValueChange={onValueChange} />);

    fireEvent.change(input(), { target: { value: 'קבוע2' } });

    expect(onValueChange).toHaveBeenCalledWith('קבוע2');
    expect(input().value).toBe('קבוע');
  });
});
