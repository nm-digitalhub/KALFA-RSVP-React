'use client';

import { useRef, useState } from 'react';

import { FieldError } from '@/components/forms';
import { PasswordInput } from '@/components/password-input';
import {
  STRENGTH_LABELS,
  STRENGTH_BAR_COLORS,
  loadPasswordScorer,
  type PasswordScore,
} from '@/lib/password-strength';

// Password input with a live strength meter. The input keeps name="password"
// so it submits normally with the signup form; scoring is best-effort UI
// feedback (the server Zod min(8) check is the gate) and the heavy engine is
// lazy-loaded on first keystroke.
export function PasswordField({ fieldErrors }: { fieldErrors?: string[] }) {
  const [value, setValue] = useState('');
  const [score, setScore] = useState<PasswordScore | null>(null);
  const scorerRef = useRef<((pw: string) => PasswordScore) | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const password = event.target.value;
    setValue(password);
    if (password === '') {
      setScore(null);
      return;
    }
    if (!scorerRef.current) {
      try {
        scorerRef.current = await loadPasswordScorer();
      } catch {
        // The meter is a nicety — a failed load must never block typing.
        return;
      }
    }
    setScore(scorerRef.current(password));
  }

  return (
    <div>
      <label htmlFor="password" className="mb-1 block text-sm font-medium">
        סיסמה
      </label>
      <PasswordInput
        id="password"
        name="password"
        autoComplete="new-password"
        required
        value={value}
        onChange={handleChange}
        aria-describedby="password-strength"
      />
      <FieldError errors={fieldErrors} />

      {score !== null ? (
        <div id="password-strength" className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              className={`h-full transition-all ${STRENGTH_BAR_COLORS[score]}`}
              style={{ width: `${((score + 1) / 5) * 100}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            חוזק הסיסמה: {STRENGTH_LABELS[score]}
          </p>
        </div>
      ) : null}
    </div>
  );
}
