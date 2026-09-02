/// <reference types="google.maps" />
// tsconfig pins `types` to an explicit list, so the ambient @types/google.maps
// globals must be referenced where they are used (only here).
'use client';

import { MapPin } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

import { Input } from '@/components/ui/input';
import { useGooglePlacesScript } from '@/hooks/use-google-places-script';
import { cn } from '@/lib/utils';

// Google Places autocomplete on a plain text input, with our own suggestion
// list (design tokens, RTL, keyboard) — installed from the shadcn-google-maps
// registry (2.9.2026) and adapted for KALFA:
//   • the chosen place fills BOTH the venue name (this input) and, through
//     onPlaceSelect, the address field next to it (owner decision "א", 2.9);
//   • `name`/`id`/`required`/`autoComplete` reach the input so the value rides
//     in FormData like any other field and <label htmlFor> works;
//   • no API key or a failed script load → a plain, ENABLED input. The venue
//     is a required ingredient of every campaign send; Google must never be
//     able to block typing it;
//   • Hebrew copy; "Powered by Google" stays (Places ToS when no map is shown).
// Uses the Places API (New) data path: AutocompleteSuggestion +
// PlacePrediction.toPlace().fetchFields — one session token per typing burst,
// closed on selection (that is how Google bills a session).

const DEFAULT_DEBOUNCE_MS = 300;

// "Are we on the client after hydration?" without a setState-in-effect: false
// during SSR/hydration, true afterwards. The suggestion list is portaled to
// document.body, which does not exist on the server.
const subscribeNoop = () => () => {};
const useMounted = () => useSyncExternalStore(subscribeNoop, () => true, () => false);

export type SelectedPlace = {
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
};

// Pure: what the form gets from a chosen suggestion. Prefers the fetched place
// details; falls back to the prediction's own texts so a fetchFields failure
// still yields a usable name + address.
export function buildSelectedPlace(input: {
  displayName?: string | null;
  formattedAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
  mainText?: string | null;
  fullText: string;
}): SelectedPlace {
  const name = (input.displayName || input.mainText || input.fullText).trim();
  const address = (input.formattedAddress || input.fullText).trim();
  return {
    name,
    address,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    placeId: input.placeId ?? null,
  };
}

type AddressSuggestion = {
  id: string;
  label: string;
  prediction: google.maps.places.PlacePrediction;
};

export type PlacesAutocompleteProps = {
  id?: string;
  name?: string;
  required?: boolean;
  autoComplete?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onPlaceSelect: (place: SelectedPlace) => void;
  apiKey?: string;
  countryCode?: string | null;
  debounceMs?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  showPoweredByGoogle?: boolean;
};

export function PlacesAutocomplete({
  id,
  name,
  required = false,
  autoComplete = 'off',
  value,
  defaultValue = '',
  onValueChange,
  onPlaceSelect,
  apiKey,
  countryCode = 'IL',
  debounceMs = DEFAULT_DEBOUNCE_MS,
  placeholder = 'הקלידו שם מקום או כתובת',
  disabled = false,
  className,
  inputClassName,
  showPoweredByGoogle = true,
}: PlacesAutocompleteProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const debounceTimeoutRef = useRef<number | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const inputValue = isControlled ? value : internalValue;

  const { isLoaded, error, hasApiKey, GoogleMapsScript } = useGooglePlacesScript({ apiKey });
  // Graceful degradation: without a key, or once the script failed, this is a
  // plain input — no script, no icon, no attribution, never disabled by us.
  const autocompleteActive = hasApiKey && !error;

  const [open, setOpen] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const mounted = useMounted();

  // Viewport coordinates (position: fixed), so the same math is right in RTL —
  // getBoundingClientRect().left is the physical left edge either way. The rect
  // is taken at the moment the list OPENS (an event, not an effect) and kept in
  // sync by the resize/scroll listeners below.
  const updateDropdownRect = useCallback(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    const rect = input.getBoundingClientRect();
    setDropdownRect({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  const openSuggestions = useCallback(() => {
    updateDropdownRect();
    setOpen(true);
  }, [updateDropdownRect]);

  useEffect(() => {
    if (!open) {
      return;
    }
    window.addEventListener('resize', updateDropdownRect);
    window.addEventListener('scroll', updateDropdownRect, true);
    return () => {
      window.removeEventListener('resize', updateDropdownRect);
      window.removeEventListener('scroll', updateDropdownRect, true);
    };
  }, [open, updateDropdownRect]);

  const setInputValue = useCallback(
    (nextValue: string) => {
      if (!isControlled) {
        setInternalValue(nextValue);
      }
      onValueChange?.(nextValue);
    },
    [isControlled, onValueChange],
  );

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const closeSuggestions = useCallback(() => {
    setSuggestions([]);
    setOpen(false);
    setDropdownRect(null);
    setActiveIndex(-1);
  }, []);

  const fetchSuggestions = useCallback(
    async (input: string) => {
      const trimmedInput = input.trim();
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (!trimmedInput || !isLoaded || !window.google?.maps) {
        sessionTokenRef.current = null;
        closeSuggestions();
        return;
      }

      setLoadingSuggestions(true);

      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } =
          await window.google.maps.importLibrary('places');

        if (!AutocompleteSuggestion || requestId !== requestIdRef.current) {
          return;
        }

        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }

        const { suggestions: googleSuggestions } =
          await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: trimmedInput,
            includedRegionCodes: countryCode ? [countryCode] : [],
            region: countryCode ?? '',
            sessionToken: sessionTokenRef.current,
          });

        if (requestId !== requestIdRef.current) {
          return;
        }

        const nextSuggestions = googleSuggestions
          .map((suggestion, index) => {
            const prediction = suggestion.placePrediction;
            const label = prediction?.text?.text;
            if (!prediction || !label) {
              return null;
            }
            return { id: `${prediction.placeId ?? label}-${index}`, label, prediction };
          })
          .filter((suggestion): suggestion is AddressSuggestion => Boolean(suggestion));

        setSuggestions(nextSuggestions);
        if (nextSuggestions.length > 0) {
          openSuggestions();
          setActiveIndex(0);
        } else {
          setOpen(false);
          setDropdownRect(null);
          setActiveIndex(-1);
        }
      } catch {
        closeSuggestions();
      } finally {
        if (requestId === requestIdRef.current) {
          setLoadingSuggestions(false);
        }
      }
    },
    [closeSuggestions, countryCode, isLoaded, openSuggestions],
  );

  const queueFetchSuggestions = useCallback(
    (input: string) => {
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current);
      }
      requestIdRef.current += 1;
      setLoadingSuggestions(false);

      if (!input.trim()) {
        sessionTokenRef.current = null;
        closeSuggestions();
        return;
      }

      debounceTimeoutRef.current = window.setTimeout(() => {
        debounceTimeoutRef.current = null;
        void fetchSuggestions(input);
      }, debounceMs);
    },
    [closeSuggestions, debounceMs, fetchSuggestions],
  );

  const handleSelectSuggestion = useCallback(
    async (suggestion: AddressSuggestion) => {
      const { prediction } = suggestion;
      closeSuggestions();
      // Show the place NAME in this input right away (the full prediction text
      // carries the address too); refined once details arrive.
      setInputValue(prediction.mainText?.text ?? suggestion.label);

      try {
        const place = prediction.toPlace?.();
        if (!place) {
          onPlaceSelect(
            buildSelectedPlace({
              mainText: prediction.mainText?.text,
              fullText: suggestion.label,
              placeId: prediction.placeId,
            }),
          );
          return;
        }

        await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });

        const selected = buildSelectedPlace({
          displayName: place.displayName,
          formattedAddress: place.formattedAddress,
          lat: place.location?.lat() ?? null,
          lng: place.location?.lng() ?? null,
          placeId: prediction.placeId,
          mainText: prediction.mainText?.text,
          fullText: suggestion.label,
        });
        setInputValue(selected.name);
        onPlaceSelect(selected);
      } catch {
        onPlaceSelect(
          buildSelectedPlace({
            mainText: prediction.mainText?.text,
            fullText: suggestion.label,
            placeId: prediction.placeId,
          }),
        );
      } finally {
        // A selection ends the billing session; the next keystroke opens a new one.
        sessionTokenRef.current = null;
      }
    },
    [closeSuggestions, onPlaceSelect, setInputValue],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1 >= suggestions.length ? 0 : current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 < 0 ? suggestions.length - 1 : current - 1));
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      const suggestion = suggestions[activeIndex];
      if (suggestion) {
        void handleSelectSuggestion(suggestion);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  if (!autocompleteActive) {
    return (
      <Input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        required={required}
        autoComplete={autoComplete}
        value={inputValue}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => setInputValue(event.target.value)}
        className={cn(inputClassName, className)}
      />
    );
  }

  return (
    <div className={cn('relative w-full', className)}>
      {GoogleMapsScript ? <GoogleMapsScript /> : null}

      <div className="relative">
        <MapPin
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 start-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          id={id}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          required={required}
          autoComplete={autoComplete}
          value={inputValue}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => {
            const nextValue = event.target.value;
            setInputValue(nextValue);
            queueFetchSuggestions(nextValue);
          }}
          onFocus={() => {
            if (suggestions.length > 0) {
              openSuggestions();
            }
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={handleKeyDown}
          // The caller's classes first, then ours — `ps-9`/`pe-*` must win over a
          // caller's `px-*` or the icon and the attribution overlap the text.
          className={cn(inputClassName, 'ps-9', showPoweredByGoogle && 'pe-32')}
        />
        {showPoweredByGoogle ? (
          <span className="pointer-events-none absolute top-1/2 end-3 -translate-y-1/2 text-[10px] font-medium whitespace-nowrap text-muted-foreground">
            Powered by Google
          </span>
        ) : null}
      </div>

      {mounted && open && dropdownRect
        ? createPortal(
            <div
              id={listboxId}
              role="listbox"
              dir="rtl"
              style={{
                position: 'fixed',
                top: dropdownRect.top,
                left: dropdownRect.left,
                width: dropdownRect.width,
              }}
              className="z-200 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl ring-1 ring-border/50"
            >
              <div className="max-h-64 overflow-y-auto bg-popover p-1">
                {suggestions.map((suggestion, index) => {
                  const primary = suggestion.prediction.mainText?.text ?? suggestion.label;
                  const secondary = suggestion.prediction.secondaryText?.text ?? '';
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={suggestion.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => void handleSelectSuggestion(suggestion)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-start transition-colors',
                        isActive ? 'bg-accent text-accent-foreground' : 'bg-popover hover:bg-accent',
                      )}
                    >
                      <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{primary}</span>
                        {secondary ? (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {secondary}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              {loadingSuggestions ? (
                <div className="border-t border-border bg-popover px-3 py-2 text-xs text-muted-foreground">
                  טוען הצעות…
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
