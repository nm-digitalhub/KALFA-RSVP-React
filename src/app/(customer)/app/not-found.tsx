import Link from 'next/link';

// Shown when notFound() is called within the customer area.
export default function CustomerNotFound() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-bold">הדף לא נמצא</h1>
      <p className="text-muted-foreground">ייתכן שהפריט הוסר או שהקישור שגוי.</p>
      <Link
        href="/app"
        className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        חזרה לאירועים
      </Link>
    </div>
  );
}
