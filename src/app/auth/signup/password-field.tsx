'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';

import { FieldError } from '@/components/forms';
import { PasswordInput } from '@/components/password-input';
import { PASSWORD_REQUIREMENTS } from '@/lib/password-strength';
import { cn } from '@/lib/utils';

// Password input with a live, always-visible requirements checklist — each
// item is exactly the rule newPasswordField (and, behind it, the live
// Supabase project config) will actually enforce, so nothing shown here can
// mislead about whether a password will be accepted. Checked synchronously
// on every keystroke (plain regex tests, no heavy async scorer needed) and
// stays visible before typing starts, unlike a placeholder that disappears
// once the field has a value.
export function PasswordField({ fieldErrors }: { fieldErrors?: string[] }) {
  const [value, setValue] = useState('');

  return (
    <div>
      <label htmlFor="password" className="mb-1 block text-sm font-medium">
        סיסמה
      </label>
      <PasswordInput
        id="password"
        name="password"
        autoComplete="new-password"
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-describedby="password-requirements"
        className="py-3"
      />
      <FieldError errors={fieldErrors} />

      <ul id="password-requirements" className="mt-2 flex flex-col gap-1" aria-live="polite">
        {PASSWORD_REQUIREMENTS.map((requirement) => {
          const met = requirement.test(value);
          return (
            <li
              key={requirement.id}
              className={cn(
                'flex items-center gap-1.5 text-xs',
                met ? 'text-success' : 'text-muted-foreground',
              )}
            >
              {met ? (
                <Check className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <X className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              {requirement.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
