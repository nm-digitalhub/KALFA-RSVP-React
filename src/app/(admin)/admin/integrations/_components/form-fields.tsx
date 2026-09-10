'use client';

import { useState } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';

import { FieldError } from '@/components/forms';
import { HelpTip } from '@/components/help-tip';

// The four field primitives every provider page needs, lifted verbatim out of
// channels-client.tsx so the new /admin/integrations/<provider> pages and the old
// /admin/channels page render from ONE definition while both exist.
//
// Lifted, not rewritten: SecretField carries the masked+reveal convention the owner
// ruled on (2026-08-24 — masked + reveal stays, do not re-propose a DTO or a taint
// wrapper), and CopyRow's fallback path exists because navigator.clipboard is absent
// on plain HTTP. Retyping either would quietly drop a decision.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 flex items-center gap-1 text-sm font-medium';

export function Field({
  name,
  label,
  defaultValue,
  placeholder,
  hint,
  help,
  errors,
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  hint?: string;
  help?: string;
  errors?: string[];
}) {
  return (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label}
        {help ? <HelpTip text={help} /> : null}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClass}
      />
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError errors={errors} />
    </div>
  );
}

export function SecretField({
  name,
  label,
  defaultValue,
  hint,
  help,
}: {
  name: string;
  label: string;
  defaultValue: string;
  hint?: string;
  help?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label}
        {help ? <HelpTip text={help} /> : null}
      </label>
      <div className="relative">
        <input
          id={name}
          name={name}
          type={show ? 'text' : 'password'}
          defaultValue={defaultValue}
          autoComplete="off"
          className={`${inputClass} pe-10`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'הסתר' : 'הצג'}
          className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground transition hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className={labelClass}>{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          {value || '—'}
        </code>
        <button
          type="button"
          disabled={!value}
          onClick={() => {
            navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          aria-label="העתק"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-2 text-xs transition hover:bg-accent/40 disabled:opacity-50"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

export function StatusBadge({
  configured,
  enabled,
  liveGateOff,
}: {
  configured: boolean;
  enabled: boolean;
  liveGateOff?: boolean;
}) {
  const [text, cls] =
    enabled && liveGateOff
      ? [
          'מוגדר · דלוק · שיחות מושבתות',
          'bg-amber-500/10 text-amber-600 border-amber-500/30',
        ]
      : enabled
        ? ['פעיל', 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30']
        : configured
          ? ['מוגדר · כבוי', 'bg-amber-500/10 text-amber-600 border-amber-500/30']
          : ['לא מוגדר', 'bg-muted text-muted-foreground border-border'];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${cls}`}
    >
      {text}
    </span>
  );
}
