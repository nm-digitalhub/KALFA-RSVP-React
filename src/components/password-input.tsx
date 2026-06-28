'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';

// Password input with a show/hide toggle (eye). Forwards all standard input
// props, so it drops in wherever a `<input type="password">` was used and keeps
// its name/value/required/autoComplete behavior. The toggle button is
// type="button" (never submits) and RTL-aware (logical `pe-10` / `end-0`).
export function PasswordInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={show ? 'text' : 'password'}
        className={cn(
          'w-full rounded-md border border-border bg-transparent px-3 py-2 pe-10',
          className,
        )}
      />
      <button
        type="button"
        onClick={() => setShow((value) => !value)}
        aria-label={show ? 'הסתרת סיסמה' : 'הצגת סיסמה'}
        aria-pressed={show}
        className="absolute inset-y-0 end-0 grid w-10 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
