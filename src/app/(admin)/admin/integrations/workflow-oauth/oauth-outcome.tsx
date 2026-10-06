import { CheckCircle2, CircleAlert } from 'lucide-react';

export function OAuthOutcome({ value }: { value: string | undefined }) {
  if (value === 'connected') {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg border border-success/20 bg-success/10 p-4 text-sm text-success"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        חשבון Microsoft 365 חובר בהצלחה.
      </div>
    );
  }

  if (value === 'failed') {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        החיבור ל-Microsoft 365 נכשל. נסו שוב או בדקו את הגדרת הספק.
      </div>
    );
  }

  return null;
}
