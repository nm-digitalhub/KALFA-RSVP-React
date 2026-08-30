'use client';

import { useActionState, useState } from 'react';
import { Frown, Meh, Smile } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FormError, FormNotice } from '@/components/forms';

import { submitRatingAction } from './actions';

// Three-point CSAT picker + optional comment. Built from shadcn's own
// composition for this exact shape (reui c-rating-9's shell: Card + rating +
// adaptive copy + Textarea + gated submit) with c-rating-8's plain-button
// icon-picker pattern instead of the star control, and lucide icons (Frown/
// Meh/Smile — already used elsewhere in the app, e.g. not-found.tsx) instead
// of emoji: a real web page doesn't have email's rendering constraints, so it
// gets the sharper, on-brand icon instead of a platform emoji glyph.
const OPTIONS = [
  { score: 1 as const, Icon: Frown, label: 'לא היה טוב', tone: 'destructive' as const },
  { score: 2 as const, Icon: Meh, label: 'בסדר', tone: 'warning' as const },
  { score: 3 as const, Icon: Smile, label: 'מצוין', tone: 'success' as const },
];

const FEEDBACK: Record<1 | 2 | 3, string> = {
  1: 'מצטערים לשמוע — תודה שספרת לנו',
  2: 'תודה על המשוב, נמשיך להשתפר',
  3: 'שמחים לשמוע! 🎉',
};

const TONE_CLASS: Record<'destructive' | 'warning' | 'success', string> = {
  destructive: 'border-destructive bg-destructive/10 text-destructive',
  warning: 'border-warning bg-warning/15 text-warning-foreground',
  success: 'border-success bg-success/10 text-success',
};

export function RatingForm({
  token,
  initialScore = null,
}: {
  token: string;
  initialScore?: 1 | 2 | 3 | null;
}) {
  const [state, formAction, pending] = useActionState(
    submitRatingAction.bind(null, token),
    null,
  );
  const [selected, setSelected] = useState<1 | 2 | 3 | null>(initialScore);

  if (state?.notice) {
    return (
      <Card className="mx-auto w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-success/15 text-success">
            ✓
          </div>
          <h1 className="text-base font-semibold">תודה על הדירוג!</h1>
          <p className="text-sm text-muted-foreground">זה עוזר לנו להשתפר לפעם הבאה</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardContent className="space-y-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-base font-semibold">איך היה השירות שקיבלת?</h1>
          <div className="flex gap-2" role="group" aria-label="דירוג שירות">
            {OPTIONS.map(({ score, Icon, label, tone }) => (
              <button
                key={score}
                type="button"
                aria-pressed={selected === score}
                aria-label={label}
                onClick={() => setSelected(score)}
                className={`flex size-16 items-center justify-center rounded-xl border-2 text-muted-foreground transition-all ${
                  selected === score
                    ? `scale-110 ${TONE_CLASS[tone]}`
                    : 'border-border hover:bg-muted'
                }`}
              >
                <Icon className="size-7" aria-hidden="true" />
              </button>
            ))}
          </div>
          {selected && (
            <p className="text-xs font-medium text-muted-foreground">{FEEDBACK[selected]}</p>
          )}
        </div>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="score" value={selected ?? ''} />
          <div className="space-y-1.5">
            <Label htmlFor="comment">רוצה להוסיף הערה? (לא חובה)</Label>
            <Textarea id="comment" name="comment" rows={3} maxLength={500} placeholder="ספר/י לנו קצת יותר…" />
          </div>
          <FormError message={state?.error} />
          <FormNotice message={state?.notice} />
          <Button type="submit" disabled={!selected || pending} className="w-full">
            {pending ? 'שולח…' : 'שליחת הדירוג'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
