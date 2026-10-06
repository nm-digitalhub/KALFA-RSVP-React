'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { JsonForms } from '@jsonforms/react';
import { createTranslator, type JsonSchema, type UISchemaElement } from '@jsonforms/core';
import { CalendarDays, Clock, Image as ImageIcon, Link2, MapPin, RefreshCw, Type, User, type LucideIcon } from 'lucide-react';

import { FormError, FormNotice } from '@/components/forms';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { VALUE_PATH_FORMAT, valuePathControlEntry } from '@/components/jsonforms/value-path-control';
import type { MentionEntry } from '@/components/tiptap-ui/mention-dropdown-menu';
import type { AdminTemplateParameter } from '@/lib/data/admin/whatsapp-templates';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import { valueLabel, type ValueKind } from '@/lib/whatsapp/value-labels';
import { EVENT_TYPES } from '@/lib/validation/schemas';

import {
  acknowledgeWhatsAppCategoryAction,
  removeTemplateRouteAction,
  requestTemplateSyncAction,
  saveTemplateParametersAction,
  setStepActiveAction,
  setTemplateRouteAction,
  type TemplateAdminActionResult,
} from './actions';

// The interactive pieces of the WhatsApp templates screens. The pages are
// Server Components that compute every state (view-model.ts); these only
// submit, and every write is re-checked on the server.

type EventType = (typeof EVENT_TYPES)[number];

// Existing shared messages: FormNotice (success), FormError (problems), Alert
// (a warning that did not block the save).
export function ActionResult({ result, success = 'נשמר' }: { result: TemplateAdminActionResult | null; success?: string }) {
  if (!result) return null;
  if (!result.ok) return <FormError message={result.problems.join(' · ')} />;
  if (result.warning) {
    return (
      <Alert>
        <AlertDescription>{result.warning}</AlertDescription>
      </Alert>
    );
  }
  return <FormNotice message={success} />;
}

export function SyncButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TemplateAdminActionResult | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await requestTemplateSyncAction()))}
      >
        <RefreshCw aria-hidden />
        {pending ? 'מבקש…' : 'סנכרון מול Meta'}
      </Button>
      <ActionResult result={result} success="הבקשה נשלחה — הסנכרון רץ ברקע, רעננו בעוד דקה" />
    </div>
  );
}

/** The audience the journey shows: an event type (or the default), text or with the invite image. */
export function EventTypePicker({ value, withImage }: { value: EventType | null; withImage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (next: string) => {
    const params = new URLSearchParams();
    if (next !== 'default') params.set('event', next);
    if (withImage) params.set('media', '1');
    const query = params.toString();
    startTransition(() => router.push(query ? `/admin/templates?${query}` : '/admin/templates'));
  };
  return (
    <Select value={value ?? 'default'} onValueChange={(v) => typeof v === 'string' && go(v)} disabled={pending}>
      <SelectTrigger aria-label="סוג אירוע" className="h-10 w-full sm:w-56 md:h-9">
        <SelectValue className="min-w-0 flex-1 truncate text-start">
          {value ? EVENT_TYPE_LABELS[value] : 'ברירת מחדל (כל סוג בלי מסלול משלו)'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">ברירת מחדל (כל סוג בלי מסלול משלו)</SelectItem>
        {EVENT_TYPES.map((t) => (
          <SelectItem key={t} value={t}>
            {EVENT_TYPE_LABELS[t]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StepActiveSwitch({ messageKey, active, label }: { messageKey: string; active: boolean; label: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TemplateAdminActionResult | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      {/* Not wrapped in a <label>: Base UI then names the switch by the label's
          text alone ("כבוי"), dropping the step. The ::after widens the 20px
          switch to a ~44px touch target. */}
      <div className="flex min-h-10 items-center gap-2 text-sm">
        <Switch
          checked={active}
          disabled={pending}
          aria-label={`${label} — ${active ? 'פעיל' : 'כבוי'}`}
          className="relative after:absolute after:-inset-3"
          onCheckedChange={(next) => startTransition(async () => setResult(await setStepActiveAction({ messageKey, active: next })))}
        />
        <span aria-hidden>{active ? 'פעיל' : 'כבוי'}</span>
      </div>
      {result && !result.ok ? <FormError message={result.problems.join(' · ')} /> : null}
    </div>
  );
}

export type TemplateOption = { id: string; name: string; language: string; category: string | null };

/**
 * Point this step's route for the chosen audience at another template, or drop
 * the audience's own route so it goes back to the step's default.
 */
export function RouteControl({
  messageKey,
  eventType,
  withMedia,
  currentTemplateId,
  hasOwnRoute,
  options,
  audienceLabel,
}: {
  messageKey: string;
  eventType: EventType | null;
  withMedia: boolean;
  currentTemplateId: string | null;
  hasOwnRoute: boolean;
  options: TemplateOption[];
  audienceLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TemplateAdminActionResult | null>(null);
  // The template just picked: a newly approved one has no values yet, and the
  // refusal links straight to where they are filled.
  const [tried, setTried] = useState<string | null>(null);
  const target = { messageKey, eventType, withMedia };
  const canRevert = hasOwnRoute && (eventType !== null || withMedia);
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={hasOwnRoute ? (currentTemplateId ?? '') : ''}
        disabled={pending}
        onValueChange={(next) =>
          typeof next === 'string' &&
          next &&
          startTransition(async () => {
            setTried(next);
            setResult(await setTemplateRouteAction({ ...target, templateId: next }));
          })
        }
      >
        <SelectTrigger aria-label={`תבנית עבור ${audienceLabel}`} className="h-10 w-full min-w-0 md:h-9">
          <SelectValue className="min-w-0 flex-1 truncate text-start">
            {hasOwnRoute ? 'החלפת התבנית' : `בחירת תבנית ל${audienceLabel}`}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <span className="flex flex-col items-start">
                <span className="font-medium" dir="ltr">
                  {t.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.language} · {t.category ?? '—'}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canRevert ? (
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          disabled={pending}
          onClick={() => startTransition(async () => setResult(await removeTemplateRouteAction(target)))}
        >
          חזרה לברירת המחדל של השלב
        </Button>
      ) : null}
      <ActionResult result={result} />
      {result && !result.ok && tried && result.problems.some((p) => p.startsWith('חסר ערך')) ? (
        <Link href={`/admin/templates/${tried}`} className="flex min-h-10 items-center text-sm font-medium text-primary underline">
          למילוי המשתנים של התבנית
        </Link>
      ) : null}
    </div>
  );
}

export function AcknowledgeCategoryButton({ templateId, observedCategory }: { templateId: string; observedCategory: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TemplateAdminActionResult | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => setResult(await acknowledgeWhatsAppCategoryAction({ templateId, observedCategory })))
        }
      >
        אישור הקטגוריה {observedCategory}
      </Button>
      <ActionResult
        result={result}
        success={`הקטגוריה ${observedCategory} אושרה — ההתראה תיפסק. החיוב והמגבלות של הקטגוריה נשארים.`}
      />
    </div>
  );
}

// --- Variables --------------------------------------------------------------

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

function slotKey(p: { type: string; sub_type: string | null; index: number | null; position: number }) {
  return `${p.type}_${p.sub_type ?? ''}_${p.index ?? ''}_${p.position}`;
}

export function slotLabel(p: { type: string; position: number }) {
  if (p.type === 'header') return 'תמונת הכותרת';
  if (p.type === 'button') return 'סיומת הקישור בכפתור';
  return `{{${p.position}}}`;
}

/** What fills each variable of one template, picked with "{" (the value-path control). */
export function TemplateVariables({
  templateId,
  parameters,
  valuePaths,
}: {
  templateId: string;
  parameters: AdminTemplateParameter[];
  valuePaths: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TemplateAdminActionResult | null>(null);
  const initial = useMemo(
    () => Object.fromEntries(parameters.map((p) => [slotKey(p), p.source_path ?? undefined])),
    [parameters],
  );
  const [data, setData] = useState<Record<string, string | undefined>>(initial);

  // One schema for the template; one Control per variable (a Control can be
  // the root of <JsonForms>, which needs no layout renderer).
  const schema = useMemo<JsonSchema>(
    () => ({
      type: 'object',
      properties: Object.fromEntries(parameters.map((p) => [slotKey(p), { type: 'string' }])),
      required: parameters.map(slotKey),
    }),
    [parameters],
  );
  const controls = useMemo(
    () =>
      parameters.map((p) => ({
        key: slotKey(p),
        uischema: {
          type: 'Control',
          scope: `#/properties/${slotKey(p)}`,
          label: slotLabel(p),
          options: { format: VALUE_PATH_FORMAT, values: valueEntries(valuePaths, p.type === 'header') },
        } as UISchemaElement,
      })),
    [parameters, valuePaths],
  );
  const renderers = useMemo(() => [valuePathControlEntry], []);
  const dirty = parameters.some((p) => (data[slotKey(p)] ?? null) !== (p.source_path ?? null));

  const save = () =>
    startTransition(async () =>
      setResult(
        await saveTemplateParametersAction({
          templateId,
          values: parameters.map((p) => ({
            type: p.type,
            sub_type: p.sub_type,
            index: p.index,
            position: p.position,
            source_path: data[slotKey(p)] ?? '',
          })),
        }),
      ),
    );

  if (parameters.length === 0) return <p className="text-sm text-muted-foreground">אין בתבנית משתנים למלא.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
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
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={pending || !dirty} onClick={save}>
          {pending ? 'שומר…' : 'שמירת המשתנים'}
        </Button>
        <ActionResult result={result} />
      </div>
    </div>
  );
}
