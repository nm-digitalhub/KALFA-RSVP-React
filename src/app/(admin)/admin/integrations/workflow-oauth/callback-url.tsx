'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';

// The one value an operator must carry OUT of this screen and INTO Microsoft.
//
// ⚠️ IT WAS NOWHERE IN THE PRODUCT. Registering the app in Entra requires a
// Redirect URI that matches ours EXACTLY — Microsoft's protocol reference says
// it "must exactly match one of the redirect URIs you registered", and a
// mismatch fails with AADSTS50011 before any of our code runs. Until now the
// only way to learn the value was to read `oauth-flow.ts` and combine
// `INTEGRATION_OAUTH_CALLBACK_PATH` with `APP_ORIGIN` by hand.
//
// n8n shows the same field in its credential modal (`CopyInput` for
// `oAuthCallbackUrl`) — but only in CUSTOM mode, because in managed mode the app
// registration is theirs. Ours is always the operator's, so it always shows.
//
// NOT REDACTED, deliberately. n8n blurs it behind a reveal; this value is not a
// secret — it travels in plain sight in every authorization request, and the
// whole job here is to read it and paste it somewhere else.

export function OAuthCallbackUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      // Reverts on its own: a permanent ✓ would claim the clipboard still holds
      // this value long after the operator has copied something else.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A blocked clipboard is not a failure worth interrupting for — the value
      // is on screen and selectable, which is the fallback that always works.
    }
  };

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
      <p className="text-sm font-medium">כתובת ההפניה (Redirect URI)</p>
      <div className="flex flex-wrap items-center gap-2">
        <code dir="ltr" className="flex-1 break-all rounded bg-background px-2 py-1 text-xs">
          {url}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'הועתק' : 'העתקה'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        רשמו אותה ב-Microsoft Entra תחת <strong>Authentication → Redirect URIs</strong>, מסוג{' '}
        <strong>Web</strong>. ההתאמה חייבת להיות מדויקת — כתובת שונה נדחית בשגיאת AADSTS50011 עוד
        לפני שהבקשה מגיעה אלינו.
      </p>
    </div>
  );
}
