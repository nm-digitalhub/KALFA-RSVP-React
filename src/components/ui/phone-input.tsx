"use client";

import { forwardRef, useMemo, useRef, useState } from "react";
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
// The same metadata object `libphonenumber-js` itself loads (its "min" set),
// so importing it here shares one copy rather than adding a second.
import metadata from "libphonenumber-js/min/metadata";
import { CircleFlag } from "react-circle-flags";
import { ChevronDownIcon, GlobeIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { PHONE_INPUT_MAX } from "@/lib/constants";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// A phone field that shows WHICH COUNTRY the typed number belongs to, with a
// searchable country list behind the flag. Adapted from the
// shadcn-country-dropdown recipe (its PhoneInput and CountryDropdown folded
// into one control), with the input handling replaced — see the three notes
// below, each of which is a product decision this codebase already made.
//
// 1. IT NEVER REWRITES WHAT WAS TYPED. The upstream recipe forces a leading
//    "+" on every keystroke and then snaps the visible text to E.164. Both are
//    wrong here: an owner typing the Israeli `0501234567` would get
//    `+0501234567` (a number that exists nowhere), and rewriting the value
//    contradicts migration 20260908220424 — `guests.phone` deliberately keeps
//    the owner's own formatting, while the generated `phone_digits` column is
//    what normalises for search. The ONE place the value changes on its own is
//    picking a country from the list, which is a direct user action.
//
// 2. THE FLAG REPORTS THE COUNTRY, NOT VALIDITY. For a number typed WITHOUT a
//    country code it uses the same `parsePhoneNumberFromString(v, 'IL')` call
//    `normalizePhone` / `isAcceptablePhoneInput` make in src/lib/phone.ts, and
//    waits for a valid number — otherwise it would confirm the very mistake it
//    exists to catch (see the country derivation below). For a number that
//    starts with "+" it answers as soon as the calling code is complete, which
//    is a statement the owner made, not a guess. Either way this component
//    exposes NO schema of its own: the server-side gate stays the single
//    source of truth for what may be saved.
//
// 3. IT LOGS NOTHING. Phone numbers are personal data (CLAUDE.md), so there is
//    no console output here, not even in development.

// Flags are self-hosted from public/country-flags (npm run flags:sync).
// react-circle-flags otherwise fetches them from its own public CDN, which
// would mean a third-party request from every page that shows guest data.
// The trailing slash is required — the library concatenates
// `${cdnUrl}${code}.svg` with no separator.
const FLAG_BASE = "/country-flags/";

// Hebrew country names, the same mechanism src/lib/analytics/ga4-mappers.ts
// already uses. Avoids a country-name dependency that only ships English.
const regionNames = new Intl.DisplayNames(["he"], { type: "region" });
const englishNames = new Intl.DisplayNames(["en"], { type: "region" });

const countryNameOf = (code: CountryCode) => regionNames.of(code) ?? code;

// The list the picker offers: every country libphonenumber can parse, named in
// Hebrew and sorted the way a Hebrew reader expects. Israel is pinned to the
// top because it is the answer for almost every guest — scrolling past 240
// countries to reach the common case would be the wrong default.
// Built once at module load: the set is static, and rebuilding it per render
// would sort 245 strings on every keystroke.
const COUNTRY_OPTIONS = getCountries()
  .map((code) => ({
    code,
    name: countryNameOf(code),
    // Searchable in English too — an owner may well type "france".
    englishName: englishNames.of(code) ?? code,
    callingCode: getCountryCallingCode(code),
  }))
  .sort((a, b) => {
    if (a.code === "IL") return -1;
    if (b.code === "IL") return 1;
    return a.name.localeCompare(b.name, "he");
  });

// Calling code → the countries that share it, MAIN COUNTRY FIRST. That order
// is what makes "+1 is 🇺🇸" and "+44 is 🇬🇧" the right answer even though 25
// and 4 countries respectively share those codes.
const COUNTRIES_BY_CALLING_CODE = metadata.country_calling_codes;

// Which country an international number belongs to, from its calling code
// alone. Longest match wins, so "+972" resolves to Israel and is never
// mistaken for a "+97" that does not exist.
function countryForCallingCode(international: string): CountryCode | null {
  const digits = international.replace(/^\+/, "").replace(/\D/g, "");
  if (!digits) return null;
  for (let length = Math.min(3, digits.length); length >= 1; length--) {
    const sharing = COUNTRIES_BY_CALLING_CODE[digits.slice(0, length)];
    if (sharing?.length) return sharing[0] as CountryCode;
  }
  return null;
}

export type PhoneInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  // Which country a number typed WITHOUT a country code belongs to. Israel
  // throughout the product, hence the default — but the assumption is stated
  // here rather than buried in the parse call, because it is the one thing
  // that decides how a bare `0501234567` is read. A value starting with "+"
  // ignores it: libphonenumber documents defaultCountry as consulted only
  // when the input carries no country information of its own.
  defaultCountry?: CountryCode;
};

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput(
    {
      className,
      defaultValue,
      value,
      onChange,
      defaultCountry = "IL",
      disabled,
      ...props
    },
    ref,
  ) {
    // Works both uncontrolled (guest form: defaultValue + FormData) and
    // controlled (call-me-now widget: useState). `value` decides which.
    const [typed, setTyped] = useState(String(defaultValue ?? ""));
    const [pickerOpen, setPickerOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const text = value === undefined ? typed : String(value);

    // The flag answers "which country is this number in", and the two forms of
    // input answer it at different moments — which is why this is not one rule.
    const country = useMemo(() => {
      const trimmed = text.trim();
      if (trimmed === "") return null;

      // INTERNATIONAL FORM. The text names its own country, so the flag can
      // appear the moment the calling code is complete — typing "+33" is
      // already an unambiguous statement, and waiting for all ten digits
      // before acknowledging it is what made the field feel unresponsive.
      // AsYouType answers first because it knows when a prefix is still
      // ambiguous; the calling-code lookup then resolves the codes it leaves
      // undecided ("+44", "+1") to their main country.
      if (/^(\+|00)/.test(trimmed)) {
        const international = trimmed.replace(/^00/, "+");
        const formatter = new AsYouType();
        formatter.input(international);
        return formatter.country ?? countryForCallingCode(international);
      }

      // NATIONAL FORM. Nothing in the text names a country, so an eager flag
      // would be ASSERTING defaultCountry rather than reporting it: the parser
      // returns IL for "12" and for "33756982370" — the French number missing
      // its "+", the exact input the server rejects with "add a country code".
      // Requiring a number this country actually has is what stops the field
      // from confirming the one mistake it exists to catch.
      const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
      return parsed?.isValid() ? (parsed.country ?? null) : null;
    }, [text, defaultCountry]);

    const countryName = country ? countryNameOf(country) : "מדינה לא מזוהה";

    // Push a new value out through BOTH paths, so the field behaves the same
    // whether the parent controls it or not. The event carries the real input
    // node, so a parent reading `e.target.value` (the call-me-now widget) sees
    // the new value rather than a synthetic stand-in.
    const emit = (next: string) => {
      setTyped(next);
      const node = inputRef.current;
      if (!node) return;
      node.value = next;
      onChange?.({
        target: node,
        currentTarget: node,
      } as React.ChangeEvent<HTMLInputElement>);
    };

    // Picking a country rewrites the country code and KEEPS the digits already
    // typed, so switching from a wrong country does not make the owner retype
    // the number. This is the only self-initiated change to the value, and it
    // is a direct response to a click.
    const applyCountry = (next: CountryCode) => {
      const callingCode = getCountryCallingCode(next);
      const parsed = parsePhoneNumberFromString(text.trim(), defaultCountry);
      const national =
        parsed?.nationalNumber ??
        text
          .trim()
          .replace(/^(\+|00)\d{1,4}/, "")
          .replace(/\D/g, "");
      emit(national ? `+${callingCode} ${national}` : `+${callingCode} `);
      setPickerOpen(false);
      // Return the caret to where the owner is actually going to type next.
      requestAnimationFrame(() => inputRef.current?.focus());
    };

    return (
      <div>
        {/* A phone number is read left-to-right in every locale, and so is the
            flag that labels it — so this row stays LTR inside the RTL page.
            The label and the hint below it remain RTL. */}
        <div
          dir="ltr"
          className={cn(
            "flex min-h-11 w-full items-center rounded-md border border-border bg-transparent pe-3",
            "focus-within:ring-2 focus-within:ring-ring/50",
            disabled && "opacity-50",
            className,
          )}
        >
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              // A real button: reachable by keyboard, announced as a control,
              // and — the reason it exists — a 44px touch target on mobile,
              // where a 16px flag would be unhittable.
              type="button"
              disabled={disabled}
              aria-label={`בחירת מדינה — כעת ${countryName}`}
              // The divider is what makes this read as a control rather than
              // decoration sitting inside the text field.
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-s-md border-e border-border ps-3 pe-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none"
            >
              {country ? (
                <CircleFlag
                  countryCode={country.toLowerCase()}
                  cdnUrl={FLAG_BASE}
                  height={20}
                  width={20}
                  alt=""
                  // shrink-0 is load-bearing: the img is a flex child, and
                  // without it a narrow field squeezes its width only,
                  // rendering the round flag as an ellipse (seen on mobile).
                  className="size-5 shrink-0 rounded-full"
                />
              ) : (
                <GlobeIcon className="size-5 shrink-0 text-muted-foreground" />
              )}
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
              {/* The list is Hebrew, so it reads RTL even though the field
                  above it is LTR. */}
              <Command dir="rtl">
                <CommandInput placeholder="חיפוש מדינה…" />
                <CommandList>
                  <CommandEmpty>לא נמצאה מדינה</CommandEmpty>
                  {COUNTRY_OPTIONS.map((option) => (
                    <CommandItem
                      key={option.code}
                      value={option.code}
                      // Findable by Hebrew name, English name, ISO code and
                      // dialling code — an owner may type any of them.
                      keywords={[
                        option.name,
                        option.englishName,
                        option.code,
                        option.callingCode,
                        `+${option.callingCode}`,
                      ]}
                      onSelect={() => applyCountry(option.code)}
                    >
                      <CircleFlag
                        countryCode={option.code.toLowerCase()}
                        cdnUrl={FLAG_BASE}
                        height={20}
                        width={20}
                        alt=""
                        className="size-5 shrink-0 rounded-full"
                      />
                      <span className="truncate">{option.name}</span>
                      <span
                        dir="ltr"
                        className="shrink-0 text-xs text-muted-foreground tabular-nums"
                      >
                        +{option.callingCode}
                      </span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <input
            {...props}
            ref={(node) => {
              inputRef.current = node;
              if (typeof ref === "function") ref(node);
              else if (ref) ref.current = node;
            }}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            disabled={disabled}
            maxLength={PHONE_INPUT_MAX}
            value={text}
            onChange={(e) => {
              setTyped(e.target.value);
              onChange?.(e);
            }}
            className="h-10 w-full border-none bg-transparent p-0 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
        </div>
        {/* Only surfaced for a foreign number: for an Israeli one the flag is
            already unambiguous, and repeating "ישראל" under every guest is
            noise. A wrong country code is exactly what this catches. */}
        {country && country !== "IL" ? (
          <p className="mt-1 text-xs text-muted-foreground">{countryName}</p>
        ) : null}
      </div>
    );
  },
);
