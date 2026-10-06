import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { loadWhatsAppTemplateAdmin } from '@/lib/data/admin/whatsapp-templates';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import { EVENT_TYPES } from '@/lib/validation/schemas';
import { anySendValuePaths } from '@/lib/whatsapp/template-route';
import { templatePreview } from '@/lib/whatsapp/template-preview';
import { isCategoryDowngraded } from '@/lib/whatsapp/template-status';
import { IssueList, StatusBadge, WhatsAppPreview } from '../template-admin-parts';
import { AcknowledgeCategoryButton, TemplateVariables } from '../template-admin-client';
import { listMessageTemplates } from '@/lib/data/message-templates';
import { pendingReclassification, templateProblems, usesOf } from '../view-model';

export const metadata: Metadata = { title: 'תבנית WhatsApp' };

type EventType = (typeof EVENT_TYPES)[number];

// One Meta template: how it reads, its state, what fills its variables and
// where it is sent. The id is Meta's (digits only); anything else is not a template.
export default async function AdminTemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  await requirePlatformPermission('manage_settings');
  const { templateId } = await params;
  if (!/^\d{1,32}$/.test(templateId)) notFound();
  const [data, stepRows] = await Promise.all([loadWhatsAppTemplateAdmin(), listMessageTemplates()]);
  const template = data.templates.find((t) => t.id === templateId);
  if (!template) notFound();

  const uses = usesOf(data, template.id);
  const pending = pendingReclassification(stepRows, template);
  const issues = pending ? [...templateProblems(data, template), pending] : templateProblems(data, template);
  // A variable may take only a value every step sending it has; unused = any value.
  const stepPaths = [...new Set(uses.map((u) => u.messageKey))]
    .map((key) => data.steps.find((s) => s.messageKey === key)?.valuePaths ?? [])
    .filter((p) => p.length > 0);
  const valuePaths = stepPaths.length > 0 ? stepPaths.reduce((a, b) => a.filter((p) => b.includes(p))) : anySendValuePaths();
  const drift =
    template.requestedCategory && template.category && isCategoryDowngraded(template.requestedCategory, template.category);

  return (
    <div className="space-y-6">
      <Link href="/admin/templates" className="flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-4" aria-hidden />
        חזרה לתבניות
      </Link>

      <header className="space-y-2">
        <h1 dir="ltr" className="text-start text-xl font-bold break-all">
          {template.name}
        </h1>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={template.status} />
          {template.category ? <Badge variant="outline">{template.category}</Badge> : null}
          <Badge variant="outline">{template.language}</Badge>
          {template.rsvpQuickReplies ? <Badge variant="info">כפתורי אישור הגעה</Badge> : null}
        </div>
      </header>

      <IssueList issues={issues} />
      {drift && template.category ? (
        <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
          <p>
            אם הסיווג של Meta צפוי, אשרו אותו כדי שההתראה תיפסק. זה לא משנה את החיוב — Meta ממשיכה לחייב לפי הקטגוריה שלה.
          </p>
          <AcknowledgeCategoryButton templateId={template.id} observedCategory={template.category} />
        </div>
      ) : null}

      <section aria-labelledby="preview" className="space-y-2">
        <h2 id="preview" className="text-base font-semibold">
          תצוגה מקדימה
        </h2>
        <WhatsAppPreview preview={templatePreview(template.components)} />
      </section>

      <section aria-labelledby="variables" className="space-y-2">
        <h2 id="variables" className="text-base font-semibold">
          מה ממלא כל משתנה
        </h2>
        <p className="text-sm text-muted-foreground">
          הקלידו {'{'} בשדה כדי לבחור ערך מהאירוע. נוסח ההודעה מאושר ב-Meta ולא נערך כאן.
        </p>
        {template.unsupported.length > 0 ? null : (
          <TemplateVariables templateId={template.id} parameters={template.parameters} valuePaths={valuePaths} />
        )}
      </section>

      <section aria-labelledby="uses" className="space-y-2">
        <h2 id="uses" className="text-base font-semibold">
          איפה נשלחת
        </h2>
        {uses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            לא משויכת לאף שלב. {template.status === 'APPROVED' ? 'אפשר לשייך אותה ממסע האורח.' : 'אפשר לשייך רק תבנית מאושרת.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {uses.map((u) => {
              const q = new URLSearchParams();
              if (u.eventType) q.set('event', u.eventType);
              if (u.withMedia) q.set('media', '1');
              const qs = q.toString();
              return (
                <li key={`${u.messageKey}-${u.eventType ?? 'default'}-${u.withMedia}`}>
                  <Link
                    href={qs ? `/admin/templates?${qs}` : '/admin/templates'}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted/50"
                  >
                    <span className="font-medium">{u.label}</span>
                    <span className="text-muted-foreground">
                      {u.eventType ? EVENT_TYPE_LABELS[u.eventType as EventType] : 'ברירת מחדל'}
                      {u.withMedia ? ' · עם תמונה' : ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
