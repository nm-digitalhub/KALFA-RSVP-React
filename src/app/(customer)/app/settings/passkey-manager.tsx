'use client';

import { KeyRound, Trash2 } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { formatIsraelDate } from '@/lib/date';
import { createClient } from '@/lib/supabase/client';

interface PasskeyRow {
  id: string;
  friendly_name?: string | null;
  created_at: string;
  last_used_at?: string | null;
}

// WebAuthn passkey management for the signed-in user (register / list / delete).
// Runs the ceremony in the browser via the passkey-enabled browser client
// (src/lib/supabase/client.ts). Supabase Auth stores the credential; there is no
// app table or migration involved.
export function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Shared loader used by the handlers (event context — setState after await is
  // fine there). The mount effect below uses a .then() continuation instead, so
  // no setState runs synchronously during the effect (react-hooks/set-state-in-
  // effect), mirroring push-notification-manager.tsx.
  async function refresh() {
    const supabase = createClient();
    const { data, error } = await supabase.auth.passkey.list();
    if (error) {
      setMessage('טעינת ה-passkeys נכשלה.');
      setLoaded(true);
      return;
    }
    setPasskeys((data ?? []) as PasskeyRow[]);
    setLoaded(true);
  }

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.passkey
      .list()
      .then(({ data, error }) => {
        if (error) {
          setMessage('טעינת ה-passkeys נכשלה.');
        } else {
          setPasskeys((data ?? []) as PasskeyRow[]);
        }
        setLoaded(true);
      })
      .catch(() => {
        setMessage('טעינת ה-passkeys נכשלה.');
        setLoaded(true);
      });
  }, []);

  function registerPasskey() {
    startTransition(async () => {
      setMessage(null);
      const supabase = createClient();
      const { error } = await supabase.auth.registerPasskey();
      if (error) {
        const msg = (error.message ?? '').toLowerCase();
        if (
          msg.includes('cancel') ||
          msg.includes('abort') ||
          msg.includes('not allowed') ||
          msg.includes('timed out')
        ) {
          return; // user dismissed the prompt — not an error
        }
        if (msg.includes('already')) {
          setMessage('המכשיר הזה כבר רשום כ-passkey לחשבון.');
          return;
        }
        setMessage('יצירת ה-passkey נכשלה. ודאו שהדפדפן תומך ונסו שוב.');
        return;
      }
      await refresh();
      setMessage('נוצר passkey חדש למכשיר הזה.');
    });
  }

  function deletePasskey(passkeyId: string) {
    startTransition(async () => {
      setMessage(null);
      const supabase = createClient();
      const { error } = await supabase.auth.passkey.delete({ passkeyId });
      if (error) {
        setMessage('מחיקת ה-passkey נכשלה. נסו שוב.');
        return;
      }
      await refresh();
      setMessage('ה-passkey הוסר.');
    });
  }

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 text-primary" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium">מפתחות גישה (Passkeys)</p>
          <p className="text-sm text-muted-foreground">
            התחברות ללא סיסמה עם טביעת אצבע, זיהוי פנים או קוד המכשיר. מאובטח יותר
            ועמיד בפני פישינג.
          </p>
        </div>
      </div>

      {loaded && passkeys.length > 0 ? (
        <ul className="space-y-2">
          {passkeys.map((pk) => (
            <li
              key={pk.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">
                  {pk.friendly_name?.trim() || 'Passkey'}
                </span>
                <span className="block text-xs text-muted-foreground">
                  נוצר {formatIsraelDate(pk.created_at)}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => deletePasskey(pk.id)}
                disabled={pending}
                aria-label="מחיקת passkey"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : loaded ? (
        <p className="text-sm text-muted-foreground">עדיין לא נוצרו passkeys לחשבון.</p>
      ) : null}

      <Button type="button" onClick={registerPasskey} disabled={pending}>
        {pending ? 'רק רגע…' : 'יצירת passkey חדש'}
      </Button>

      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
