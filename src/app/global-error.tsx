'use client';

import { useVersionSkewReload } from '@/components/use-version-skew-reload';
import { isVersionSkewError } from '@/lib/version-skew';

// Replaces the root layout when an error is thrown in it. Must render its own
// <html>/<body>. Uses inline styles so it renders even if the app stylesheet is
// not loaded. Generic, privacy-safe message only. Also the fallback for routes
// without their own boundary (e.g. public RSVP): a stale-deployment Server
// Action error triggers a one-time reload instead (useVersionSkewReload).
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useVersionSkewReload(error);
  const skew = isVersionSkewError(error);
  return (
    <html lang="he" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#ffffff',
          color: '#0a0a0a',
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            {skew ? 'המערכת התעדכנה' : 'משהו השתבש'}
          </h1>
          <p style={{ color: '#6b7280', marginBottom: 16 }}>
            {skew ? 'הדף נטען מחדש…' : 'אירעה תקלה בלתי צפויה. אנא נסו שוב.'}
          </p>
          {skew ? null : (
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              borderRadius: 6,
              background: '#4f46e5',
              color: '#ffffff',
              border: 'none',
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            נסו שוב
          </button>
          )}
        </div>
      </body>
    </html>
  );
}
