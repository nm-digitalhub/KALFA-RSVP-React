'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Unified submit control: renders via the shared Button (Base UI defaults to
// type="button", so type="submit" is required) and keeps the useFormStatus
// pending behavior. Full-width by default (the dominant form-CTA case, so the
// dozens of existing forms are untouched); the one-off inline case overrides via
// the standard `className` prop (tailwind-merge lets `w-auto` win over `w-full`).
export function SubmitButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className={cn('w-full', className)}>
      {pending ? 'רגע…' : children}
    </Button>
  );
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="mt-1 text-sm text-destructive">{errors[0]}</p>;
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="rounded-md bg-success/10 px-3 py-2 text-sm text-success"
    >
      {message}
    </p>
  );
}

// Compact select styling for the composed date/time controls — single source
// (used by TimeSelect24 and DateSelectIL; keep in sync with `inputClass`
// patterns used by the event forms).
export const compactSelectClass =
  'rounded-md border border-border bg-transparent px-2 py-2 disabled:cursor-not-allowed disabled:opacity-60';
