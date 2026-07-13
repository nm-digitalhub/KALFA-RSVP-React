'use client';

import { KeyRound } from 'lucide-react';
import { useState, useTransition } from 'react';

import { createClient } from '@/lib/supabase/client';

// Passwordless sign-in via WebAuthn passkey. signInWithPasskey() runs the full
// discoverable-credential ceremony (the authenticator picks the account — no
// email needed). On success the @supabase/ssr browser client has written the
// session cookies, so a hard navigation to /app lets the server pick up the
// session (mirrors the password login's redirect('/app')).
export function PasskeySignInButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPasskey();
      if (signInError) {
        // User dismissed the OS/browser passkey prompt — not a real failure, so
        // don't show an alarming message; let them try again or use a password.
        const msg = (signInError.message ?? '').toLowerCase();
        if (
          msg.includes('cancel') ||
          msg.includes('abort') ||
          msg.includes('not allowed') ||
          msg.includes('timed out')
        ) {
          return;
        }
        setError('ההתחברות עם passkey נכשלה. נסו שוב או התחברו עם סיסמה.');
        return;
      }
      window.location.assign('/app');
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-transparent px-3 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-60"
      >
        <KeyRound className="size-4" aria-hidden />
        {pending ? 'מתחבר…' : 'התחברות עם passkey'}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
