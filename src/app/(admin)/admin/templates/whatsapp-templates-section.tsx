'use client';

import { useMemo, useState, useTransition } from 'react';
import { JsonForms } from '@jsonforms/react';
import { createTranslator, type JsonSchema, type UISchemaElement } from '@jsonforms/core';
import { CalendarDays, Clock, Image as ImageIcon, Link2, MapPin, Type, User, type LucideIcon } from 'lucide-react';

import { FormError, FormNotice } from '@/components/forms';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { VALUE_PATH_FORMAT, valuePathControlEntry } from '@/components/jsonforms/value-path-control';
import type { MentionEntry } from '@/components/tiptap-ui/mention-dropdown-menu';
import type {
  AdminMetaTemplate,
  AdminStepRoute,
  AdminWhatsAppStep,
  WhatsAppTemplateAdmin,
} from '@/lib/data/admin/whatsapp-templates';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import { formatIsraelDateTime } from '@/lib/date';
import { valueLabel, type ValueKind } from '@/lib/whatsapp/value-labels';
import { EVENT_TYPES } from '@/lib/validation/schemas';

import {
  removeTemplateRouteAction,
  requestTemplateSyncAction,
  saveTemplateParametersAction,
  setTemplateRouteAction,
  type TemplateAdminActionResult,
} from './actions';

// Step 8b of docs/superpowers/plans/2026-09-30-whatsapp-templates-meta-mirror.md:
// which Meta template each WhatsApp step sends (per event type, text or with the
// invite image), and what fills each variable of those templates. Every write
// goes through a server action that re-checks permission and the template's
// variables on the server; this screen only presents and submits.

type EventType = (typeof EVENT_TYPES)[number];

const KIND_ICON: Record<ValueKind, LucideIcon> = {
  text: Type,
  person: User,
  date: CalendarDays,
  time: Clock,
  place: MapPin,
  link: Link2,
  image: ImageIcon,
};
// JSON Forms' own i18n: its validation message for a variable with no value
// is AJV's English "is a required property"; the key `error.required` replaces
// it for every field. Module-level, so the translator is stable.
const JSON_FORMS_I18N = {
  locale: 'he',
  translate: createTranslator((id, defaultMessage) => (id === 'error.required' ? 'צריך לבחור ערך' : defaultMessage)),
};

const GROUP_ORDER = ['פרטי האורח', 'פרטי האירוע', 'נוסח לברית', 'פרטי הליד', 'אחר'];

function valueEntries(paths: readonly string[], image: boolean): MentionEntry[] {
  return paths
    .map((id) => ({ id, ...valueLabel(id) }))
    .filter((v) => (v.kind === 'image') === image)
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
    .map((v) => ({ id: v.id, label: v.label, subtext: v.subtext, group: v.group, icon: KIND_ICON[v.kind] }));
}

function bodyText(components: unknown): string {
  if (!Array.isArray(components)) return '';
  const body = (components as Array<{ type?: string; text?: string }>).find((c) => c.type === 'BODY');
  return body?.text ?? '';
}

function hasImageHeader(t: AdminMetaTemplate): boolean {
  return t.parameters.some((p) => p.type === 'header');
}

function routeLabel(r: Pick<AdminStepRoute, 'eventType' | 'withMedia'>): string {
  const type = r.eventType ? EVENT_TYPE_LABELS[r.eventType] : 'ברירת מחדל';
  return r.withMedia ? `${type} · עם תמונה` : type;
}

// Existing shared messages: FormNotice (success), FormError (problems), Alert
// (a warning that did not block the save).
function Problems({ result }: { result: TemplateAdminActionResult | null }) {
  if (!result) return null;
  if (!result.ok) return <FormError message={result.problems.join(' · ')} />;
  if (result.warning) {
    return (
      <Alert>
        <AlertDescription>{result.warning}</AlertDescription>
      </Alert>
    );
  }
  return <FormNotice message="נשמר" />;
}

function TemplateSelect({
  value,
  templates,
  onChange,
  disabled,
  label,
}: {
  value: string | null;
  templates: AdminMetaTemplate[];
  onChange: (id: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const selected = templates.find((t) => t.id === value);
  return (
    <Select value={value ?? ''} onValueChange={(next) => typeof next === 'string' && next && onChange(next)} disabled={disabled}>
      <SelectTrigger aria-label={label} className="min-w-0 flex-1">
        <SelectValue>{selected ? `${selected.name} (${selected.language})` : 'בחרו תבנית מאושרת'}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {templates.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            <span className="flex flex-col items-start">
              <span className="font-medium" dir="ltr">
                {t.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {t.language} · {t.category ?? '—'}
                {t.rsvpQuickReplies ? ' · כפתורי אישור הגעה' : ''}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RouteRow({
  step,
  route,
  templates,
}: {
  step: AdminWhatsAppStep;
  route: AdminStepRoute;
  templates: AdminMetaTemplate[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TemplateAdminActionResult | null>(null);
  const eligible = templates.filter((t) => t.status === 'APPROVED' && hasImageHeader(t) === route.withMedia);
  const isDefault = route.eventType === null && !route.withMedia;
  const target = { messageKey: step.messageKey, eventType: route.eventType, withMedia: route.withMedia };

  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-28 text-sm font-medium">{routeLabel(route)}</span>
        <TemplateSelect
          label={`תבנית עבור ${routeLabel(route)}`}
          value={route.templateId}
          templates={eligible}
          disabled={pending}
          onChange={(templateId) =>
            startTransition(async () => setResult(await setTemplateRouteAction({ ...target, templateId })))
          }
        />
        {!isDefault ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => startTransition(async () => setResult(await removeTemplateRouteAction(target)))}
          >
            הסרה
          </Button>
        ) : null}
      </div>
      <Problems result={result} />
    </li>
  );
}

function AddRoute({ step, templates }: { step: AdminWhatsAppStep; templates: AdminMetaTemplate[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TemplateAdminActionResult | null>(null);
  const [eventType, setEventType] = useState<EventType | 'default'>('default');
  const [withMedia, setWithMedia] = useState(false);
  const taken = (t: EventType | 'default', media: boolean) =>
    step.routes.some((r) => (r.eventType ?? 'default') === t && r.withMedia === media);
  const eligible = templates.filter((t) => t.status === 'APPROVED' && hasImageHeader(t) === withMedia);

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">מסלול נוסף:</span>
        <Select value={eventType} onValueChange={(v) => typeof v === 'string' && setEventType(v as EventType | 'default')}>
          <SelectTrigger aria-label="סוג אירוע למסלול" className="w-40">
            <SelectValue>{eventType === 'default' ? 'ברירת מחדל' : EVENT_TYPE_LABELS[eventType]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">ברירת מחדל</SelectItem>
            {EVENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {EVENT_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={withMedia} onCheckedChange={(checked) => setWithMedia(checked === true)} />
          עם תמונת הזמנה
        </label>
        <TemplateSelect
          label="תבנית למסלול הנוסף"
          value={null}
          templates={eligible}
          disabled={pending || taken(eventType, withMedia)}
          onChange={(templateId) =>
            startTransition(async () =>
              setResult(
                await setTemplateRouteAction({
                  messageKey: step.messageKey,
                  eventType: eventType === 'default' ? null : eventType,
                  withMedia,
                  templateId,
                }),
              ),
            )
          }
        />
      </div>
      {taken(eventType, withMedia) ? (
        <p className="text-xs text-muted-foreground">למסלול הזה כבר יש תבנית — שנו אותה בשורה שלו.</p>
      ) : null}
      <Problems result={result} />
    </div>
  );
}

function slotKey(p: { type: string; sub_type: string | null; index: number | null; position: number }) {
  return `${p.type}_${p.sub_type ?? ''}_${p.index ?? ''}_${p.position}`;
}

function slotLabel(p: { type: string; position: number }) {
  if (p.type === 'header') return 'תמונת הכותרת';
  if (p.type === 'button') return 'סיומת הקישור בכפתור';
  return `{{${p.position}}}`;
}

function TemplateVariables({ template, valuePaths }: { template: AdminMetaTemplate; valuePaths: string[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TemplateAdminActionResult | null>(null);
  const initial = useMemo(
    () => Object.fromEntries(template.parameters.map((p) => [slotKey(p), p.source_path ?? undefined])),
    [template.parameters],
  );
  const [data, setData] = useState<Record<string, string | undefined>>(initial);

  // One schema for the template; one Control per variable (a Control can be
  // the root of <JsonForms>, which needs no layout renderer).
  const schema = useMemo<JsonSchema>(
    () => ({
      type: 'object',
      properties: Object.fromEntries(template.parameters.map((p) => [slotKey(p), { type: 'string' }])),
      required: template.parameters.map(slotKey),
    }),
    [template.parameters],
  );
  const controls = useMemo(
    () =>
      template.parameters.map((p) => ({
        key: slotKey(p),
        uischema: {
          type: 'Control',
          scope: `#/properties/${slotKey(p)}`,
          label: slotLabel(p),
          options: { format: VALUE_PATH_FORMAT, values: valueEntries(valuePaths, p.type === 'header') },
        } as UISchemaElement,
      })),
    [template.parameters, valuePaths],
  );
  const renderers = useMemo(() => [valuePathControlEntry], []);
  const dirty = template.parameters.some((p) => (data[slotKey(p)] ?? null) !== (p.source_path ?? null));

  const save = () =>
    startTransition(async () =>
      setResult(
        await saveTemplateParametersAction({
          templateId: template.id,
          values: template.parameters.map((p) => ({
            type: p.type,
            sub_type: p.sub_type,
            index: p.index,
            position: p.position,
            source_path: data[slotKey(p)] ?? '',
          })),
        }),
      ),
    );

  return (
    <div className="flex flex-col gap-3 rounded-md bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium" dir="ltr">
          {template.name}
        </span>
        <Badge variant="outline">{template.language}</Badge>
        <Badge variant={template.status === 'APPROVED' ? 'secondary' : 'destructive'}>
          {template.status ?? '—'}
        </Badge>
        {template.category ? <Badge variant="outline">{template.category}</Badge> : null}
      </div>
      {bodyText(template.components) ? (
        <p className="rounded-md border border-border bg-background p-2.5 text-sm leading-6 whitespace-pre-wrap">
          {bodyText(template.components)}
        </p>
      ) : null}
      {template.unsupported.length > 0 ? (
        <ul role="alert" className="list-inside list-disc text-xs text-destructive">
          {template.unsupported.map((u) => (
            <li key={u}>התבנית כוללת {u}, שהמערכת עדיין לא יודעת למלא</li>
          ))}
        </ul>
      ) : null}
      {template.parameters.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין בתבנית משתנים למלא.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {controls.map((c) => (
            <JsonForms
              key={c.key}
              schema={schema}
              uischema={c.uischema}
              data={data}
              renderers={renderers}
              i18n={JSON_FORMS_I18N}
              validationMode="ValidateAndShow"
              readonly={pending}
              onChange={({ data: next }) => setData(next as Record<string, string | undefined>)}
            />
          ))}
        </div>
      )}
      {template.parameters.length > 0 ? (
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" disabled={pending || !dirty} onClick={save}>
            {pending ? 'שומר…' : 'שמירת המשתנים'}
          </Button>
          <Problems result={result} />
        </div>
      ) : null}
    </div>
  );
}

function StepCard({ step, templates }: { step: AdminWhatsAppStep; templates: AdminMetaTemplate[] }) {
  const routes = [...step.routes].sort(
    (a, b) =>
      Number(a.eventType !== null) - Number(b.eventType !== null) ||
      (a.eventType ?? '').localeCompare(b.eventType ?? '') ||
      Number(a.withMedia) - Number(b.withMedia),
  );
  const used = [...new Set(routes.map((r) => r.templateId))]
    .map((id) => templates.find((t) => t.id === id))
    .filter((t): t is AdminMetaTemplate => !!t);

  return (
    <section aria-labelledby={`step-${step.messageKey}`} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 id={`step-${step.messageKey}`} className="text-base font-semibold">
          {step.label}
        </h3>
        <span className="text-xs text-muted-foreground" dir="ltr">
          {step.messageKey}
        </span>
        {!step.active ? <Badge variant="outline">כבוי</Badge> : null}
      </header>
      <ul className="flex flex-col gap-2">
        {routes.map((r) => (
          <RouteRow key={`${r.eventType ?? 'default'}-${r.withMedia}`} step={step} route={r} templates={templates} />
        ))}
      </ul>
      <AddRoute step={step} templates={templates} />
      {used.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h4 className="text-sm font-medium">המשתנים בתבניות של השלב</h4>
          {used.map((t) => (
            <TemplateVariables key={t.id} template={t} valuePaths={step.valuePaths} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function WhatsAppTemplatesSection({ data }: { data: WhatsAppTemplateAdmin }) {
  const [pending, startTransition] = useTransition();
  const [syncResult, setSyncResult] = useState<TemplateAdminActionResult | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => setSyncResult(await requestTemplateSyncAction()))}
        >
          {pending ? 'מבקש…' : 'סנכרון מול Meta עכשיו'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {data.lastSyncedAt
            ? `סונכרן לאחרונה: ${formatIsraelDateTime(data.lastSyncedAt)}`
            : 'עוד לא סונכרן'}
        </span>
        {syncResult?.ok ? (
          <FormNotice message="הבקשה נשלחה — הסנכרון רץ ברקע, רעננו בעוד דקה" />
        ) : (
          <Problems result={syncResult} />
        )}
      </div>
      {data.steps.map((step) => (
        <StepCard key={step.messageKey} step={step} templates={data.templates} />
      ))}
    </div>
  );
}
