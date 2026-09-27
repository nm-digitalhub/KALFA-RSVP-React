'use client';

import { useVersionSkewReload } from '@/components/use-version-skew-reload';
import { Button } from '@/components/ui/button';
import { isVersionSkewError } from '@/lib/version-skew';

// Error boundary for the conversation pane: the list (layout) stays usable.
// Generic Hebrew only — never error.message or a stack (plan D8).
export default function FleetConversationError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useVersionSkewReload(error);
  if (isVersionSkewError(error)) {
    return (
      <div className="space-y-2 rounded-xl border border-border p-8 text-center">
        <p className="font-semibold">המערכת התעדכנה</p>
        <p className="text-sm text-muted-foreground">הדף נטען מחדש…</p>
      </div>
    );
  }
  return (
    <div role="alert" className="space-y-3 rounded-xl border border-border p-8 text-center">
      <p className="font-semibold">טעינת השיחה נכשלה</p>
      <p className="text-sm text-muted-foreground">אפשר לנסות שוב. אם זה חוזר, נסו שוב מאוחר יותר.</p>
      <Button type="button" onClick={() => retry()}>
        נסה שוב
      </Button>
    </div>
  );
}
