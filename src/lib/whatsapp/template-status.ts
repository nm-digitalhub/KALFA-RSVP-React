// What the admin screen says about a WhatsApp template and about a step, read
// from the Meta mirror — PURE (no I/O, no 'server-only'), so the data layer
// and the screen share it.
//
// Every state the mirror can hold is handled, not only the ones today's rows
// show: a status Meta adds later is shown under its own name and treated as
// "not sendable" (the sender's rule, decideRoutedTemplate), never guessed.

import type { components } from '@/lib/whatsapp/generated/message-templates';
import {
  decideRoutedTemplate,
  parameterCoverageProblems,
  pickTemplateRoute,
  type RoutedTemplateDecision,
  type TemplateRouteRow,
} from '@/lib/whatsapp/template-route';

/** Category drift: Meta's live category differs from the one we asked for. */
export function isCategoryDowngraded(requestedCategory: string, category: string | null): boolean {
  if (!category) return false;
  return category !== requestedCategory;
}

type Schemas = components['schemas'];
export type MetaTemplateStatus = Schemas['WhatsAppBusinessHSMStatus'];
export type MetaQualityScore = Schemas['WhatsAppBusinessHSMQualityScore'];
export type MetaRejectionReason = Schemas['WhatsAppBusinessHSMRejectionReason'];

const has = <K extends string>(labels: Record<K, string>, key: string): key is K =>
  Object.prototype.hasOwnProperty.call(labels, key);

// Hebrew names for every status in Meta's spec. Typed by the generated enum, so
// a status Meta adds (and `npm run meta:types` picks up) fails to compile until
// it is named here; a status not yet in the spec still shows as sent.
const STATUS_LABELS: Record<MetaTemplateStatus, string> = {
  APPROVED: 'מאושרת',
  PENDING: 'ממתינה לאישור',
  IN_APPEAL: 'בערעור',
  REJECTED: 'נדחתה',
  PAUSED: 'מושהית',
  DISABLED: 'מושבתת',
  PENDING_DELETION: 'בתהליך מחיקה',
  DELETED: 'נמחקה ב-Meta',
  LIMIT_EXCEEDED: 'חרגה ממגבלה',
  ARCHIVED: 'בארכיון',
};

export function statusLabel(status: string | null): string {
  if (!status) return 'לא ידוע';
  return has(STATUS_LABELS, status) ? STATUS_LABELS[status] : status;
}

/**
 * The score out of the mirrored `quality_score` column — Meta's
 * `MessageTemplate.quality_score` object (`{ score, date }`). Read, not cast:
 * the column is jsonb, so a malformed value is simply no score.
 */
export function mirroredQualityScore(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('score' in value)) return null;
  return typeof value.score === 'string' ? value.score : null;
}

// Why Meta rejected a template, in Hebrew — every reason in the spec.
const REJECTION_LABELS: Record<Exclude<MetaRejectionReason, 'NONE'>, string> = {
  ABUSIVE_CONTENT: 'תוכן פוגעני',
  CATEGORY_NOT_AVAILABLE: 'הקטגוריה לא זמינה לחשבון',
  INCORRECT_CATEGORY: 'קטגוריה שגויה',
  INVALID_FORMAT: 'מבנה לא תקין',
  PROMOTIONAL: 'תוכן שיווקי בתבנית שאינה שיווקית',
  SCAM: 'חשד להונאה',
  TAG_CONTENT_MISMATCH: 'התוכן לא מתאים לקטגוריה',
};

/** Meta's rejection reason in Hebrew; none (or NONE) → null; one not in the spec → as sent. */
export function rejectionLabel(reason: string | null): string | null {
  if (!reason || reason === 'NONE') return null;
  return has(REJECTION_LABELS, reason) ? REJECTION_LABELS[reason] : reason;
}

export type StatusTone = 'ok' | 'warn' | 'bad' | 'muted';

// How each status reads at a glance — every one in the spec, typed by it.
const STATUS_TONES: Record<MetaTemplateStatus, StatusTone> = {
  APPROVED: 'ok',
  PENDING: 'warn',
  IN_APPEAL: 'warn',
  REJECTED: 'bad',
  PAUSED: 'bad',
  DISABLED: 'bad',
  PENDING_DELETION: 'bad',
  DELETED: 'bad',
  LIMIT_EXCEEDED: 'bad',
  ARCHIVED: 'bad',
};

/** Sendable, on its way, or stopped; a status not in the spec reads as stopped. */
export function statusTone(status: string | null): StatusTone {
  if (!status) return 'muted';
  return has(STATUS_TONES, status) ? STATUS_TONES[status] : 'bad';
}

/** Statuses a template waits in before Meta decides (it may still be approved). */
export function isAwaitingMeta(status: string | null): boolean {
  return statusTone(status) === 'warn';
}

export type Issue = { level: 'block' | 'warn'; code: string; title: string; detail?: string };

export type TemplateHealthInput = {
  status: string | null;
  category: string | null;
  requestedCategory: string | null;
  qualityScore: string | null;
  rejectedReason: string | null;
  unsupported: string[];
};

/** Problems with a template on its own (not tied to a step). */
export function templateIssues(t: TemplateHealthInput): Issue[] {
  const issues: Issue[] = [];
  if (t.status !== 'APPROVED') {
    const reason = rejectionLabel(t.rejectedReason);
    issues.push({
      level: 'block',
      code: `status:${t.status ?? 'unknown'}`,
      title: `${statusLabel(t.status)} — לא נשלחת`,
      detail:
        isAwaitingMeta(t.status)
          ? 'אפשר לשייך לשלב רק אחרי ש-Meta תאשר.'
          : reason
            ? `סיבה מ-Meta: ${reason}`
            : undefined,
    });
  }
  // Compared with Meta's own values (MetaQualityScore); no cast: a score not in
  // the spec is simply not a warning.
  const warnQuality: readonly MetaQualityScore[] = ['RED', 'YELLOW'];
  if (warnQuality.some((q) => q === t.qualityScore)) {
    issues.push({
      level: 'warn',
      code: `quality:${t.qualityScore}`,
      title: t.qualityScore === 'RED' ? 'איכות נמוכה ב-Meta' : 'איכות בינונית ב-Meta',
      detail: 'Meta עלולה להשהות תבנית באיכות נמוכה, ואז השלב שמשתמש בה יפסיק להישלח.',
    });
  }
  if (t.requestedCategory && isCategoryDowngraded(t.requestedCategory, t.category)) {
    issues.push({
      level: 'warn',
      code: 'category',
      title: `Meta סיווגה כ-${t.category} (הוגשה כ-${t.requestedCategory})`,
      detail:
        t.category === 'MARKETING'
          ? 'Meta מחייבת אותה בתעריף שיווקי ומגבילה כמה הודעות שיווקיות אדם מקבל — חלק מהאורחים עלולים לא לקבל אותה.'
          : undefined,
    });
  }
  for (const u of t.unsupported) {
    issues.push({ level: 'block', code: `unsupported:${u}`, title: `כוללת ${u}, שהמערכת עדיין לא יודעת למלא` });
  }
  return issues;
}

export type StepTemplate = TemplateHealthInput & {
  id: string;
  name: string;
  language: string;
  components: unknown;
  parameters: Array<{ type: string; sub_type: string | null; index: number | null; position: number; source_path: string | null }>;
};

export type StepOutcome<T extends StepTemplate> = {
  state: 'inactive' | 'no_route' | 'blocked' | 'sends';
  route: TemplateRouteRow | null;
  /** The route is this event type's own, or the step's default. */
  source: 'own' | 'default' | null;
  /** Asked for the image version, but the step has none: the text one goes. */
  imageFallback: boolean;
  decision: RoutedTemplateDecision<T> | null;
  issues: Issue[];
};

/**
 * What a guest of `eventType` gets at this step — the sender's order exactly:
 * an inactive step sends nothing; the route is picked like the sender picks it;
 * the routed template goes through decideRoutedTemplate; then every variable
 * must have a value this step has.
 */
export function stepOutcome<T extends StepTemplate>(input: {
  messageKey: string;
  active: boolean;
  routes: readonly TemplateRouteRow[];
  templatesById: ReadonlyMap<string, T>;
  /** Live (not DELETED) templates by `${name}|${language}`, for the twin rule. */
  liveByNameLanguage: ReadonlyMap<string, T>;
  eventType: string | null;
  withImage: boolean;
  valuePaths: readonly string[];
}): StepOutcome<T> {
  const { messageKey, eventType, withImage } = input;
  const base = { route: null, source: null, imageFallback: false, decision: null } as const;
  if (!input.active) {
    return { ...base, state: 'inactive', issues: [{ level: 'block', code: 'inactive', title: 'השלב כבוי — לא נשלח' }] };
  }
  const route = pickTemplateRoute(input.routes, messageKey, eventType, withImage);
  if (!route) {
    return { ...base, state: 'no_route', issues: [{ level: 'block', code: 'no_route', title: 'אין לשלב תבנית — לא נשלח' }] };
  }
  const source = route.event_type === null ? 'default' : 'own';
  const imageFallback = withImage && !route.with_media;
  const routed = input.templatesById.get(route.whatsapp_template_id) ?? null;
  const twin = routed?.status === 'DELETED' ? input.liveByNameLanguage.get(`${routed.name}|${routed.language}`) ?? null : null;
  const decision = decideRoutedTemplate(routed, twin);

  const issues: Issue[] = [];
  if (decision.deletedOriginal && decision.send) {
    issues.push({
      level: 'warn',
      code: 'deleted_twin',
      title: 'התבנית נמחקה ב-Meta ונוצרה מחדש — נשלחת הגרסה החדשה',
      detail: 'עדכנו את השיוך לגרסה החדשה.',
    });
  }
  if (!decision.send) {
    issues.push(
      decision.reason === 'deleted_no_twin'
        ? { level: 'block', code: 'deleted', title: 'התבנית נמחקה ב-Meta — השלב לא נשלח' }
        : decision.reason === 'missing'
          ? { level: 'block', code: 'missing', title: 'התבנית לא נמצאה — השלב לא נשלח' }
          : {
              level: 'block',
              code: `status:${decision.template?.status ?? 'unknown'}`,
              title: `התבנית ${statusLabel(decision.template?.status ?? null)} — השלב לא נשלח`,
              detail: 'אין מעבר לתבנית אחרת: בחרו תבנית מאושרת לשלב.',
            },
    );
  }
  const template = decision.template;
  if (template) {
    // Status is already covered above; add the rest (quality, category, unsupported).
    issues.push(...templateIssues(template).filter((i) => !i.code.startsWith('status:')));
    const rows = template.parameters
      .filter((p) => p.source_path !== null)
      .map((p) => ({ ...p, source_path: p.source_path as string }));
    for (const problem of parameterCoverageProblems(template.components, rows, input.valuePaths)) {
      if (problem.startsWith('התבנית כוללת')) continue; // reported as "unsupported" above
      issues.push({ level: 'block', code: `mapping:${problem}`, title: problem });
    }
  }
  const blocked = issues.some((i) => i.level === 'block');
  return { state: blocked ? 'blocked' : 'sends', route, source, imageFallback, decision, issues };
}
