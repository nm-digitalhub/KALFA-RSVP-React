import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { OwnerAgentAuditRow } from '@/lib/data/admin/owner-agent';

import { AuditTable } from './audit-table';

// The audit codes are a pattern in the database, not a closed list: known codes
// get a Hebrew label, an unknown one is shown raw (never blank).

function row(stage: string, outcome: string, reasonCode: string | null): OwnerAgentAuditRow {
  return {
    id: `${stage}-${outcome}-${reasonCode}`,
    occurredAt: '2026-09-28T05:00:00Z',
    staffUserId: null,
    stage,
    outcome,
    reasonCode,
    toolNames: [],
    steps: null,
    latencyMs: null,
  };
}

const render = (rows: OwnerAgentAuditRow[]) => renderToStaticMarkup(createElement(AuditTable, { rows, staffNames: new Map() }));

describe('AuditTable labels', () => {
  it('labels the new stages, outcomes and reasons in Hebrew', () => {
    const html = render([
      row('report', 'sent', 'template_fallback'),
      row('identity', 'bsuid_revoked', 'user_changed_user_id'),
      row('route', 'reaction_received', 'feedback_up'),
      row('agent', 'media_rejected', 'media_too_large'),
      row('agent', 'unknown_action', 'followup_used'),
      row('report', 'skipped', 'no_permissions'),
    ]);
    for (const label of [
      'דוח יזום',
      'דוח נשלח',
      'נשלח כתבנית אחרי שהחלון נסגר',
      'זיהוי',
      'קישור מזהה בוטל',
      'המשתמש החליף מזהה',
      'התקבלה תגובה',
      'משוב חיובי',
      'מדיה נדחתה',
      'קובץ גדול מדי',
      'לחיצה לא מזוהה',
      'ההצעה כבר נוצלה',
      'אין הרשאות לנתוני הדוח',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('keeps old non_text rows labelled', () => {
    expect(render([row('agent', 'gated', 'non_text')])).toContain('לא טקסט');
  });

  it('shows an unknown code raw, and a report_* outcome as a report outcome', () => {
    const html = render([row('future_stage', 'something_new', 'brand_new_reason'), row('report', 'report_paused', null)]);
    expect(html).toContain('future_stage');
    expect(html).toContain('something_new');
    expect(html).toContain('brand_new_reason');
    expect(html).toContain('דוח: paused');
  });
});
