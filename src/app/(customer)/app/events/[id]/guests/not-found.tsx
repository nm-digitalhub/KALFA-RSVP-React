import Link from 'next/link';

// Shown when notFound() is triggered within the guests area (e.g. an event the
// current user does not own, or a missing guest).
export default function GuestsNotFound() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-bold">לא נמצא</h1>
      <p className="text-muted-foreground">
        ייתכן שהמוזמן או האירוע הוסר, או שאין לכם גישה אליו.
      </p>
      <Link
        href="/app/events"
        className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        חזרה לאירועים
      </Link>
    </div>
  );
}
