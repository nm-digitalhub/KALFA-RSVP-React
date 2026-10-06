import { CircleAlert, Image as ImageIcon, TriangleAlert } from 'lucide-react';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TemplatePreview } from '@/lib/whatsapp/template-preview';
import { statusLabel, statusTone, type Issue, type StatusTone } from '@/lib/whatsapp/template-status';

// Server-rendered pieces shared by the WhatsApp templates screens. Colours are
// the app's tokens (success / warning / destructive / muted), so dark mode and
// contrast follow the rest of the admin.

const TONE_VARIANT: Record<StatusTone, BadgeVariant> = {
  ok: 'success',
  warn: 'warning',
  bad: 'destructive',
  muted: 'neutral',
};

export function StatusBadge({ status }: { status: string | null }) {
  return <Badge variant={TONE_VARIANT[statusTone(status)]}>{statusLabel(status)}</Badge>;
}

/** Problems first (they stop sends), then warnings. */
export function IssueList({ issues, className }: { issues: Issue[]; className?: string }) {
  if (issues.length === 0) return null;
  const ordered = [...issues].sort((a, b) => Number(a.level !== 'block') - Number(b.level !== 'block'));
  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {ordered.map((issue) => (
        <li
          key={issue.code}
          className={cn(
            'flex gap-2 rounded-md px-2.5 py-2 text-sm',
            issue.level === 'block' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
          )}
        >
          {issue.level === 'block' ? (
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{issue.title}</span>
            {issue.detail ? <span className="text-xs leading-5 opacity-90">{issue.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Every header kind the spec has, except the two drawn on their own.
const HEADER_KIND: Record<Exclude<NonNullable<TemplatePreview['header']>['kind'], 'text' | 'IMAGE'>, string> = {
  VIDEO: 'סרטון בכותרת',
  DOCUMENT: 'מסמך בכותרת',
  LOCATION: 'מיקום בכותרת',
};

/** The message as a guest sees it, with the examples submitted to Meta. */
export function WhatsAppPreview({ preview }: { preview: TemplatePreview }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="ms-6 flex max-w-sm flex-col gap-2 rounded-lg bg-card p-2 shadow-sm">
        {preview.header?.kind === 'IMAGE' ? (
          <div className="flex h-28 items-center justify-center gap-2 rounded-md bg-muted text-sm text-muted-foreground">
            <ImageIcon className="size-4" aria-hidden />
            תמונת ההזמנה של האירוע
          </div>
        ) : preview.header?.kind === 'text' ? (
          <p className="px-1 font-semibold">{preview.header.text}</p>
        ) : preview.header ? (
          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{HEADER_KIND[preview.header.kind]}</div>
        ) : null}
        <p className="px-1 text-sm leading-6 whitespace-pre-wrap wrap-anywhere">{preview.body}</p>
        {preview.footer ? <p className="px-1 text-xs text-muted-foreground">{preview.footer}</p> : null}
        {preview.buttons.length > 0 ? (
          <div className="flex flex-col border-t border-border">
            {preview.buttons.map((b, i) => (
              <span key={i} className="border-b border-border py-2 text-center text-sm font-medium text-info last:border-b-0">
                {b.text}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">בדוגמאות שהוגשו ל-Meta עם התבנית. אורח יקבל את הערכים של האירוע שלו.</p>
    </div>
  );
}
