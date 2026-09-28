'use client';

import { isAuthSessionMissingError, type OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { safeNextPath } from '@/lib/safe-next-path';
import { createClient } from '@/lib/supabase/client';

// From the Supabase UI Library `oauth-consent-nextjs` block, adapted: our
// browser client, Hebrew copy, and generic errors — Supabase's error text never
// reaches the screen. Every call runs as the signed-in user against Supabase
// Auth, which checks that the authorization_id belongs to that user.
//
// Flow (Supabase OAuth 2.1 server): no session → sign-in with the full consent
// URL in `next`; already consented → straight back to the client; otherwise
// show the request, and approve/deny return the client's redirect_url.

export type OAuthConsentDecision = 'approve' | 'deny';

export interface UseOAuthConsentOptions {
  authorizationId?: string | null;
  signInPath?: string;
}

const LOAD_FAILED = 'לא הצלחנו לטעון את בקשת ההרשאה. התחילו שוב מהאפליקציה שביקשה גישה.';
const MISSING_ID = 'חסר מזהה בקשה בקישור. התחילו שוב מהאפליקציה שביקשה גישה.';
const DECISION_FAILED = 'לא הצלחנו לשמור את ההחלטה. נסו שוב, או התחילו מחדש מהאפליקציה שביקשה גישה.';

const withNextParam = (path: string, next: string) => {
  const url = new URL(path, window.location.origin);
  const searchParams = new URLSearchParams(url.search);
  searchParams.set('next', next);
  url.search = searchParams.toString();
  return `${url.pathname}${url.search}${url.hash}`;
};

const useOAuthConsent = ({ authorizationId, signInPath = '/auth/login' }: UseOAuthConsentOptions) => {
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [decision, setDecision] = useState<OAuthConsentDecision | null>(null);
  const isDeciding = useRef(false);

  useEffect(() => {
    let active = true;

    const loadAuthorization = async () => {
      setIsLoading(true);
      setError(null);
      setDetails(null);
      setDecision(null);

      if (!authorizationId) {
        setError(MISSING_ID);
        setIsLoading(false);
        return;
      }

      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError && !isAuthSessionMissingError(userError)) {
        if (active) {
          setError(LOAD_FAILED);
          setIsLoading(false);
        }
        return;
      }

      if (!user) {
        const next = `${window.location.pathname}${window.location.search}`;
        if (active) {
          window.location.replace(withNextParam(safeNextPath(signInPath, '/auth/login'), next));
        }
        return;
      }

      const { data, error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (detailsError || !data) {
        if (active) {
          setError(LOAD_FAILED);
          setIsLoading(false);
        }
        return;
      }

      if (!('authorization_id' in data)) {
        // Consent was already given: Supabase hands back the client's URL.
        if (active) {
          window.location.replace(data.redirect_url);
        }
        return;
      }

      if (active) {
        setDetails(data);
        setIsLoading(false);
      }
    };

    void loadAuthorization();
    return () => {
      active = false;
    };
  }, [authorizationId, signInPath]);

  const decide = useCallback(
    async (action: OAuthConsentDecision) => {
      if (!authorizationId || isDeciding.current) return;

      isDeciding.current = true;
      setDecision(action);
      setError(null);
      const supabase = createClient();
      const result =
        action === 'approve'
          ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
          : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });

      if (result.error || !result.data?.redirect_url) {
        setError(DECISION_FAILED);
        setDecision(null);
        isDeciding.current = false;
        return;
      }

      window.location.assign(result.data.redirect_url);
    },
    [authorizationId],
  );

  return {
    details,
    email: details?.user.email ?? null,
    error,
    isLoading,
    decision,
    approve: () => decide('approve'),
    deny: () => decide('deny'),
  };
};

type UseOAuthConsentReturn = ReturnType<typeof useOAuthConsent>;

export { useOAuthConsent, type OAuthAuthorizationDetails, type UseOAuthConsentReturn };
