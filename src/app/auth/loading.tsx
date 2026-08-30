// Loading fallback for /auth/* (login, signup, forgot/reset-password,
// confirm) — no shared layout of its own, so a full-page centered skeleton.
export default function AuthLoading() {
  return (
    <div
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-8 w-40 animate-pulse rounded-md bg-border" />
      <div className="h-24 w-full animate-pulse rounded-lg bg-border" />
      <span className="sr-only">טוען…</span>
    </div>
  );
}
