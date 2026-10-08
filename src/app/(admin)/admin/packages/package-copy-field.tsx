'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { LoaderCircle, WandSparkles } from 'lucide-react';

import { FieldError } from '@/components/forms';
import { Button } from '@/components/ui/button';
import {
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea,
} from '@/components/ui/input-group';
import { rewritePackageCopyAction } from './rewrite-action';
import type { PackageCopyField } from './package-copy-types';

export function PackageCopyField({
  field, label, initialValue, rows, errors,
}: {
  field: PackageCopyField;
  label: string;
  initialValue: string;
  rows: number;
  errors?: string[];
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const version = useRef(0);
  const running = useRef(false);
  const mounted = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const { pending } = useFormStatus();
  const errorId = `${field}-copy-error`;
  const fieldErrorId = `${field}-field-error`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; version.current += 1; };
  }, []);

  function change(next: string) {
    version.current += 1;
    setValue(next);
    setProposal(null);
    setError(null);
    setStatus('');
  }

  async function rewrite() {
    if (running.current || pending || !value.trim()) return;
    const requestVersion = version.current;
    running.current = true;
    setBusy(true);
    setProposal(null);
    setError(null);
    setStatus('מנסח...');
    try {
      const result = await rewritePackageCopyAction(field, value);
      if (!mounted.current) return;
      if (version.current !== requestVersion) {
        setStatus('הטקסט השתנה. אפשר לבקש ניסוח חדש.');
        return;
      }
      if (result.ok) {
        setProposal(result.text);
        setStatus('הצעת הניסוח מוכנה.');
      } else {
        setError(result.error);
        setStatus('');
      }
    } catch {
      if (mounted.current && version.current === requestVersion) {
        setError('לא ניתן לשפר את הניסוח כרגע. נסו שוב.');
        setStatus('');
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function apply() {
    if (proposal === null || pending) return;
    change(proposal);
    setStatus('הניסוח הוחל. לשמירה יש לשמור את החבילה.');
    input.current?.focus();
  }

  return (
    <div className="space-y-2" dir="rtl">
      <label htmlFor={field} className="block text-sm font-medium">{label}</label>
      <InputGroup className="h-auto">
        <InputGroupTextarea
          ref={input}
          id={field}
          name={field}
          rows={rows}
          value={value}
          onChange={(event) => change(event.target.value)}
          readOnly={pending}
          aria-invalid={Boolean(errors?.length || error)}
          aria-describedby={[
            errors?.length ? fieldErrorId : '', error ? errorId : '',
          ].filter(Boolean).join(' ') || undefined}
          className="w-full px-3 text-start"
        />
        <InputGroupAddon align="block-end" className="justify-end">
          <InputGroupButton
            type="button"
            size="icon-sm"
            className="min-h-11 min-w-11 text-primary"
            onClick={rewrite}
            disabled={busy || pending || !value.trim()}
            aria-label={`שפר ניסוח: ${label}`}
            title="שפר ניסוח"
            aria-busy={busy}
          >
            {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              : <WandSparkles aria-hidden="true" className="size-4" />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FieldError errors={errors} id={fieldErrorId} />
      {error ? <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p> : null}
      <p role="status" aria-live="polite" className={status ? 'text-xs text-muted-foreground' : 'sr-only'}>
        {status}
      </p>
      {proposal !== null ? (
        <section aria-label={`הצעת ניסוח: ${label}`} className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium">הצעת ניסוח</p>
          <p className="whitespace-pre-wrap break-words text-sm">{proposal}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={apply}>החל ניסוח</Button>
            <Button type="button" variant="outline" onClick={() => {
              setProposal(null);
              setStatus('ההצעה בוטלה. הטקסט המקורי נשמר.');
              input.current?.focus();
            }}>ביטול</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
