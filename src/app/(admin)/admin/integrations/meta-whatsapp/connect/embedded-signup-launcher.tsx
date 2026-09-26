'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { EsConnectResult } from '@/lib/data/admin/integrations/whatsapp-es';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';
import {
  isMetaOrigin,
  parseSessionEvent,
  type FinishEvent,
} from '@/lib/whatsapp/embedded-signup/session-event';

import { connectEmbeddedSignupAction } from './actions';

// Meta's Embedded Signup popup, configured for Coexistence
// (onboarding-business-app-users §Step 2: `featureType:
// 'whatsapp_business_app_onboarding'` in `extras`).
//
// ⚠️ THE CODE LIVES 30 SECONDS. The FB.login callback calls the Server Action
// immediately — no confirmation screen, and no waiting for the session message.
// The server derives the account from the token, so nothing here is needed for
// correctness; the message event only drives what this screen says.
//
// No console.log of the code or the response: Meta's sample logs both "for
// testing" and says to remove it.

type FbLoginResponse = { authResponse?: { code?: string } | null };

type FacebookSdk = {
  init(params: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (response: FbLoginResponse) => void,
    options: {
      config_id: string;
      response_type: 'code';
      override_default_response_type: true;
      extras: Record<string, unknown>;
    },
  ): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}

const COEXISTENCE: FinishEvent = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';

// Meta's abandoned-flow screen names (errors.md), in the admin's language.
const STEP_LABELS: Record<string, string> = {
  BUSINESS_ACCOUNT_SELECTION: 'בחירת התיק העסקי',
  WABA_PHONE_PROFILE_PICKER: 'בחירת חשבון WhatsApp Business',
  WHATSAPP_BUSINESS_PROFILE_SETUP: 'יצירת חשבון WhatsApp Business',
  PHONE_NUMBER_SETUP: 'הוספת המספר',
  PHONE_NUMBER_VERIFICATION: 'אימות המספר',
  PERMISSIONS: 'אישור ההרשאות',
};

type State =
  | { kind: 'loading' }
  | { kind: 'idle' }
  | { kind: 'sdk-failed' }
  | { kind: 'popup' }
  | { kind: 'connecting' }
  | { kind: 'cancelled'; step: string | null }
  | { kind: 'meta-error'; errorCode: string | null; sessionId: string | null }
  | { kind: 'done'; result: EsConnectResult };

export function EmbeddedSignupLauncher({ appId, configId }: { appId: string; configId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  // The session message may arrive before or after the login callback; a ref
  // so the callback reads the latest value without re-binding.
  const finishRef = useRef<FinishEvent | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isMetaOrigin(event.origin)) return;
      const parsed = parseSessionEvent(event.data);
      if (!parsed) return;
      if (parsed.kind === 'finish') {
        finishRef.current = parsed.event;
      } else if (parsed.kind === 'cancel') {
        setState((s) => (s.kind === 'popup' ? { kind: 'cancelled', step: parsed.currentStep } : s));
      } else {
        // Only while the popup is open. Once the action is running, its result
        // decides the screen — leaving 'connecting' here would re-enable the
        // button and let a second connect spend the one-shot sync again.
        setState((s) =>
          s.kind === 'popup'
            ? { kind: 'meta-error', errorCode: parsed.errorCode, sessionId: parsed.sessionId }
            : s,
        );
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function initSdk() {
    if (!window.FB) {
      setState({ kind: 'sdk-failed' });
      return;
    }
    window.FB.init({ appId, autoLogAppEvents: false, xfbml: false, version: GRAPH_API_VERSION });
    setState((s) => (s.kind === 'loading' ? { kind: 'idle' } : s));
  }

  function launch() {
    const fb = window.FB;
    if (!fb) {
      setState({ kind: 'sdk-failed' });
      return;
    }
    finishRef.current = null;
    setState({ kind: 'popup' });
    fb.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          // Declined or closed before the end: no code, nothing to send.
          setState((s) => (s.kind === 'popup' ? { kind: 'cancelled', step: null } : s));
          return;
        }
        setState({ kind: 'connecting' });
        void connectEmbeddedSignupAction({
          code,
          // This button launches only the Coexistence flow; the server
          // re-derives everything else from the token.
          finishEvent: finishRef.current ?? COEXISTENCE,
        })
          .then((result) => setState({ kind: 'done', result }))
          .catch(() =>
            setState({ kind: 'done', result: { ok: false, message: 'החיבור נכשל. נסו שוב.' } }),
          );
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      },
    );
  }

  const busy = state.kind === 'loading' || state.kind === 'popup' || state.kind === 'connecting';

  return (
    <div className="space-y-4">
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
        onReady={initSdk}
        onError={() => setState({ kind: 'sdk-failed' })}
      />

      <Button
        type="button"
        onClick={launch}
        disabled={busy || state.kind === 'sdk-failed'}
        className="min-h-11"
      >
        {state.kind === 'popup'
          ? 'החלון של Meta פתוח…'
          : state.kind === 'connecting'
            ? 'מחבר…'
            : 'חיבור עם Meta'}
      </Button>

      <div aria-live="polite">
        {state.kind === 'sdk-failed' ? (
          <Alert variant="destructive">
            <AlertTitle>לא ניתן לטעון את רכיב ההתחברות של Meta</AlertTitle>
            <AlertDescription>רעננו את העמוד. אם זה חוזר, ייתכן שחוסם פרסומות חוסם את connect.facebook.net.</AlertDescription>
          </Alert>
        ) : null}

        {state.kind === 'cancelled' ? (
          <Alert>
            <AlertTitle>החיבור בוטל</AlertTitle>
            <AlertDescription>
              {state.step
                ? `החלון נסגר בשלב: ${STEP_LABELS[state.step] ?? state.step}.`
                : 'החלון נסגר לפני סיום התהליך.'}{' '}
              שום דבר לא חובר.
            </AlertDescription>
          </Alert>
        ) : null}

        {state.kind === 'meta-error' ? (
          <Alert variant="destructive">
            <AlertTitle>Meta דיווחה על שגיאה בתהליך</AlertTitle>
            <AlertDescription>
              לפנייה לתמיכה של Meta: קוד שגיאה {state.errorCode ?? 'לא ידוע'}, מזהה סשן{' '}
              <span dir="ltr">{state.sessionId ?? 'לא ידוע'}</span>.
            </AlertDescription>
          </Alert>
        ) : null}

        {state.kind === 'done' && !state.result.ok ? (
          <Alert variant="destructive">
            <AlertTitle>החיבור לא הושלם</AlertTitle>
            <AlertDescription>{state.result.message}</AlertDescription>
          </Alert>
        ) : null}

        {state.kind === 'done' && state.result.ok ? (
          <Alert>
            <AlertTitle>
              המספר <span dir="ltr">{state.result.display}</span> חובר
            </AlertTitle>
            <AlertDescription>
              <p>
                {state.result.isOnBizApp && state.result.platformType === 'CLOUD_API'
                  ? 'Meta מאשרת שהמספר פעיל גם באפליקציית WhatsApp Business וגם ב-Cloud API.'
                  : 'Meta עדיין לא מאשרת שהמספר פעיל בשני המקומות. בדקו שוב בעוד כמה דקות.'}
              </p>
              <p>
                סנכרון אנשי קשר: {state.result.sync.contacts === 'requested' ? 'הופעל' : 'נכשל'} ·
                סנכרון היסטוריה: {state.result.sync.history === 'requested' ? 'הופעל' : 'נכשל'}.
              </p>
              <p>השאירו את אפליקציית WhatsApp Business פתוחה בטלפון — הסנכרון נמשך כמה דקות.</p>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
