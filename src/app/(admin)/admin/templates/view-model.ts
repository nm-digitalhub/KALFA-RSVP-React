// What the WhatsApp templates screens show, computed on the server from
// loadWhatsAppTemplateAdmin — PURE, so every rule here is testable without a
// page. The step and template states come from template-status.ts, the same
// rule the sender uses.

import type { AdminMetaTemplate, AdminWhatsAppStep, WhatsAppTemplateAdmin } from '@/lib/data/admin/whatsapp-templates';
import type { MessageTemplate } from '@/lib/data/message-templates';
import { formatIsraelDateTime } from '@/lib/date';
import type { TemplateRouteRow } from '@/lib/whatsapp/template-route';
import { journeyRank } from '@/lib/whatsapp/journey-order';
import { metaComponents, parameterCoverageProblems } from '@/lib/whatsapp/template-route';
import { isAwaitingMeta, stepOutcome, templateIssues, type Issue, type StepOutcome } from '@/lib/whatsapp/template-status';

// Sent to leads, not to an event's guests: shown apart from the guest journey.
export const NON_GUEST_STEPS = new Set(['sales_signup_link']);

export function hasImageHeader(t: AdminMetaTemplate): boolean {
  return t.parameters.some((p) => p.type === 'header');
}

function lookups(data: WhatsAppTemplateAdmin) {
  const templatesById = new Map(data.templates.map((t) => [t.id, t]));
  const liveByNameLanguage = new Map(
    data.templates.filter((t) => t.status !== 'DELETED').map((t) => [`${t.name}|${t.language}`, t]),
  );
  return { templatesById, liveByNameLanguage };
}

function routeRows(step: AdminWhatsAppStep): TemplateRouteRow[] {
  return step.routes.map((r) => ({
    message_key: step.messageKey,
    event_type: r.eventType,
    with_media: r.withMedia,
    whatsapp_template_id: r.templateId,
  }));
}

export type JourneyRow = {
  step: AdminWhatsAppStep;
  outcome: StepOutcome<AdminMetaTemplate>;
  /** Templates that could take this step's route for the chosen audience. */
  eligible: AdminMetaTemplate[];
};

export function journey(
  data: WhatsAppTemplateAdmin,
  eventType: string | null,
  withImage: boolean,
): { guest: JourneyRow[]; other: JourneyRow[] } {
  const { templatesById, liveByNameLanguage } = lookups(data);
  const eligible = data.templates.filter((t) => t.status === 'APPROVED' && hasImageHeader(t) === withImage);
  const rows = data.steps.map((step) => {
    // Judged as if on, so an inactive step still shows which template it would
    // send and what stands in the way of switching it on.
    const judged = stepOutcome({
      messageKey: step.messageKey,
      active: true,
      routes: routeRows(step),
      templatesById,
      liveByNameLanguage,
      eventType,
      withImage,
      valuePaths: step.valuePaths,
    });
    const outcome: StepOutcome<AdminMetaTemplate> = step.active
      ? judged
      : {
          ...judged,
          state: 'inactive',
          issues: [{ level: 'block', code: 'inactive', title: 'השלב כבוי — אורחים לא מקבלים אותו' }, ...judged.issues],
        };
    return { step, outcome, eligible };
  });
  return {
    guest: rows
      .filter((r) => !NON_GUEST_STEPS.has(r.step.messageKey))
      .sort((a, b) => journeyRank(a.step.messageKey) - journeyRank(b.step.messageKey)),
    other: rows.filter((r) => NON_GUEST_STEPS.has(r.step.messageKey)),
  };
}

export type TemplateUse = { messageKey: string; label: string; eventType: string | null; withMedia: boolean };

export function usesOf(data: WhatsAppTemplateAdmin, templateId: string): TemplateUse[] {
  return data.steps.flatMap((s) =>
    s.routes
      .filter((r) => r.templateId === templateId)
      .map((r) => ({ messageKey: s.messageKey, label: s.label, eventType: r.eventType, withMedia: r.withMedia })),
  );
}

/** A template's problems: its own, plus a missing value for any step that sends it. */
export function templateProblems(data: WhatsAppTemplateAdmin, t: AdminMetaTemplate): Issue[] {
  const issues = templateIssues(t);
  const rows = t.parameters
    .filter((p) => p.source_path !== null)
    .map((p) => ({ ...p, source_path: p.source_path as string }));
  const seen = new Set<string>();
  for (const use of usesOf(data, t.id)) {
    const step = data.steps.find((s) => s.messageKey === use.messageKey);
    if (!step) continue;
    for (const problem of parameterCoverageProblems(t.components, rows, step.valuePaths)) {
      if (problem.startsWith('התבנית כוללת') || seen.has(problem)) continue;
      seen.add(problem);
      issues.push({ level: 'block', code: `mapping:${problem}`, title: problem });
    }
  }
  return issues;
}

export const CATALOG_FILTERS = ['all', 'attention', 'pending', 'rejected', 'stopped', 'deleted', 'unused'] as const;
export type CatalogFilter = (typeof CATALOG_FILTERS)[number];

export const CATALOG_FILTER_LABELS: Record<CatalogFilter, string> = {
  all: 'הכול',
  attention: 'דורשות טיפול',
  pending: 'ממתינות לאישור',
  rejected: 'נדחו',
  stopped: 'מושהות או מושבתות',
  deleted: 'נמחקו ב-Meta',
  unused: 'לא בשימוש',
};

export type CatalogRow = { template: AdminMetaTemplate; uses: TemplateUse[]; issues: Issue[] };

function matches(row: CatalogRow, filter: CatalogFilter): boolean {
  const s = row.template.status;
  switch (filter) {
    case 'all':
      return true;
    case 'attention':
      return row.uses.length > 0 && row.issues.length > 0;
    case 'pending':
      return isAwaitingMeta(s);
    case 'rejected':
      return s === 'REJECTED';
    case 'stopped':
      // Anything Meta stopped that is not waiting, rejected or deleted —
      // e.g. PAUSED or DISABLED, and any status it adds later.
      return s !== 'APPROVED' && !isAwaitingMeta(s) && s !== 'REJECTED' && s !== 'DELETED';
    case 'deleted':
      return s === 'DELETED';
    case 'unused':
      return row.uses.length === 0;
  }
}

function bodyText(components: unknown): string {
  return metaComponents(components).find((c) => c.type === 'BODY')?.text ?? '';
}

export function catalog(
  data: WhatsAppTemplateAdmin,
  opts: { filter: CatalogFilter; q: string; page: number; pageSize: number },
): { rows: CatalogRow[]; total: number; counts: Record<CatalogFilter, number> } {
  const all: CatalogRow[] = data.templates.map((t) => ({
    template: t,
    uses: usesOf(data, t.id),
    issues: templateProblems(data, t),
  }));
  const counts = Object.fromEntries(CATALOG_FILTERS.map((f) => [f, all.filter((r) => matches(r, f)).length])) as Record<
    CatalogFilter,
    number
  >;
  const q = opts.q.trim().toLowerCase();
  const filtered = all
    .filter((r) => matches(r, opts.filter))
    .filter((r) => !q || r.template.name.toLowerCase().includes(q) || bodyText(r.template.components).includes(opts.q.trim()))
    // What needs attention first, then by name.
    .sort((a, b) => Number(b.issues.length > 0) - Number(a.issues.length > 0) || a.template.name.localeCompare(b.template.name));
  const start = (opts.page - 1) * opts.pageSize;
  return { rows: filtered.slice(start, start + opts.pageSize), total: filtered.length, counts };
}

/**
 * Meta's advance notice (about 24 hours) that it will move a template to
 * another category. The webhook records it on the step's row in
 * message_templates, matched by the template's name, so it is read from there.
 */
export function pendingReclassification(
  stepRows: readonly Pick<MessageTemplate, 'channel' | 'name' | 'language' | 'pending_category_change_at' | 'pending_correct_category'>[],
  template: Pick<AdminMetaTemplate, 'name' | 'language'>,
): Issue | null {
  const row = stepRows.find(
    (r) => r.channel === 'whatsapp' && r.name === template.name && r.language === template.language && r.pending_category_change_at,
  );
  if (!row?.pending_category_change_at) return null;
  return {
    level: 'warn',
    code: 'category_pending',
    title: `Meta תסווג אותה מחדש${row.pending_correct_category ? ` כ-${row.pending_correct_category}` : ''} ב-${formatIsraelDateTime(row.pending_category_change_at)}`,
    detail: 'אחרי השינוי Meta תחייב ותגביל אותה לפי הקטגוריה החדשה.',
  };
}
