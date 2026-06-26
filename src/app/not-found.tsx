import Link from 'next/link';

// Root not-found for unknown public routes.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold">הדף לא נמצא</h1>
      <p className="text-muted-foreground">הקישור שגוי או שהדף הוסר.</p>
      <Link
        href="/"
        className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        לדף הבית
      </Link>
    </main>
  );
}
