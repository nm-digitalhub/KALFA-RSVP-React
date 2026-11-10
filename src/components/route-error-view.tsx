// No 'use client' here on purpose: this is not an entry file. It is imported only by
// error.tsx boundaries, which are Client Components themselves, and it takes a
// function prop (`retry`) that a client entry file could not declare.
import { useVersionSkewReload } from '@/components/use-version-skew-reload';
import { isVersionSkewError } from '@/lib/version-skew';

// What every route error boundary (error.tsx) renders: a generic, privacy-safe
// message — never the raw error or stack — with a retry button. A
// stale-deployment Server Action error triggers a one-time reload instead
// (useVersionSkewReload) and shows the "updated" message while it happens.
//
// The texts default to Hebrew; a boundary on a translated surface passes its
// own (its t() calls stay in that boundary's file, where the extractor reads
// them).

export type RouteErrorTexts = {
  updatedTitle: string;
  reloading: string;
  title: string;
  body: string;
  retry: string;
};

const HEBREW_TEXTS: RouteErrorTexts = {
  updatedTitle: 'המערכת התעדכנה',
  reloading: 'הדף נטען מחדש…',
  title: 'משהו השתבש',
  body: 'אירעה תקלה בטעינת הדף. אפשר לנסות שוב, ואם הבעיה נמשכת נסו שוב מאוחר יותר.',
  retry: 'נסו שוב',
};

const RETRY_BUTTON_CLASS =
  'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90';

// The look of a second action beside the retry button (a link home, or back to login).
export const routeErrorSecondaryActionClass =
  'rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent';

export function RouteErrorView({
  error,
  retry,
  texts = HEBREW_TEXTS,
  as: Wrapper = 'div',
  retryClassName = RETRY_BUTTON_CLASS,
  secondaryAction,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  texts?: RouteErrorTexts;
  // 'main' for a boundary with no layout around it to supply the landmark.
  as?: 'div' | 'main';
  retryClassName?: string;
  // A way out besides retrying; shown next to the retry button.
  secondaryAction?: React.ReactNode;
}) {
  useVersionSkewReload(error);
  if (isVersionSkewError(error)) {
    return (
      <Wrapper className="mx-auto max-w-md space-y-4 py-16 text-center">
        <h1 className="text-xl font-bold">{texts.updatedTitle}</h1>
        <p className="text-muted-foreground">{texts.reloading}</p>
      </Wrapper>
    );
  }

  const retryButton = (
    <button type="button" onClick={() => retry()} className={retryClassName}>
      {texts.retry}
    </button>
  );

  return (
    <Wrapper className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-bold">{texts.title}</h1>
      <p className="text-muted-foreground">{texts.body}</p>
      {secondaryAction ? (
        <div className="flex items-center justify-center gap-3">
          {retryButton}
          {secondaryAction}
        </div>
      ) : (
        retryButton
      )}
    </Wrapper>
  );
}

// The retry button of a boundary whose only action it is, sized to a 44px touch target.
export const routeErrorTouchRetryClass = `min-h-11 ${RETRY_BUTTON_CLASS}`;
