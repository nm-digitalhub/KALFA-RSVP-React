// The one-line message a guest token page (/r /g /ty) shows in place of its
// content: `warning` when the request was rate-limited, `error` for a link that
// cannot be used. The text is the caller's — one generic sentence per case, so
// the page never reveals WHY a link is not valid.
const TONE_CLASS = {
  warning: 'rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800',
  error: 'rounded-md bg-red-50 px-3 py-2 text-sm text-red-700',
} as const;

export function GuestAlert({
  tone,
  children,
}: {
  tone: keyof typeof TONE_CLASS;
  children: React.ReactNode;
}) {
  return (
    <p role="alert" className={TONE_CLASS[tone]}>
      {children}
    </p>
  );
}
