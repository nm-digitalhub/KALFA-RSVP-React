import { describe, expect, it } from 'vitest';

import {
  applyFix,
  branchNameFor,
  buildPrMetadata,
  findPrEligibleEntry,
  parseKnownIssues,
  prHeadPrefixFor,
  runMechanicalCheck,
  validateApprovalVerdict,
  type KnownIssueEntry,
  type PrEligibleEntry,
} from './housekeeping-pr';

function detectOnlyEntry(overrides: Partial<KnownIssueEntry> = {}): KnownIssueEntry {
  return {
    id: 'detect-only-entry',
    title: 'כותרת',
    category: 'docs-drift',
    target_file: 'roles/example.md',
    remediation_kind: 'detect-only',
    check: { type: 'custom', file: 'roles/example.md', match: 'בדוק ידנית' },
    fix: { type: 'none' },
    status: 'open',
    stale_after_days: 5,
    notes: 'תיקון ידני',
    ...overrides,
  };
}

function prEligibleEntry(overrides: Partial<KnownIssueEntry> = {}): KnownIssueEntry {
  return {
    id: 'docs-drift-entry',
    title: 'תיאור סחיפה',
    category: 'docs-drift',
    target_file: 'docs/fleet/03-example.md',
    remediation_kind: 'pr-eligible',
    check: { type: 'contains_line', file: 'docs/fleet/03-example.md', match: 'ישן' },
    fix: { type: 'replace_line', file: 'docs/fleet/03-example.md', match: 'ישן', replace: 'חדש' },
    status: 'open',
    stale_after_days: 5,
    notes: 'החלף ישן בחדש',
    ...overrides,
  };
}

describe('parseKnownIssues', () => {
  it('parses a well-formed catalog', () => {
    const entries = parseKnownIssues([detectOnlyEntry(), prEligibleEntry()]);
    expect(entries).toHaveLength(2);
  });

  it('throws on a non-array payload', () => {
    expect(() => parseKnownIssues({ not: 'an array' })).toThrow();
  });

  it('throws when a replace_line fix is missing match', () => {
    const bad = {
      ...prEligibleEntry(),
      fix: { type: 'replace_line', file: 'docs/fleet/x.md', replace: 'y' },
    };
    expect(() => parseKnownIssues([bad])).toThrow();
  });
});

describe('findPrEligibleEntry', () => {
  it('rejects an unknown catalog-id', () => {
    const result = findPrEligibleEntry([detectOnlyEntry()], 'does-not-exist');
    expect(result.ok).toBe(false);
  });

  it('rejects a detect-only entry', () => {
    const entry = detectOnlyEntry();
    const result = findPrEligibleEntry([entry], entry.id);
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining('detect-only'),
    });
  });

  it('rejects fix.type="none" even if mismarked pr-eligible', () => {
    const entry = detectOnlyEntry({ remediation_kind: 'pr-eligible' });
    const result = findPrEligibleEntry([entry], entry.id);
    expect(result.ok).toBe(false);
  });

  it('rejects a pr-eligible entry whose fix.file escapes docs/fleet/** (defense in depth)', () => {
    const entry = prEligibleEntry({
      fix: { type: 'replace_line', file: '.claude/fleet/fleet.json', match: 'a', replace: 'b' },
    });
    const result = findPrEligibleEntry([entry], entry.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('docs/fleet/');
  });

  it('rejects a pr-eligible entry with a custom (non-mechanical) check', () => {
    const entry = prEligibleEntry({
      check: { type: 'custom', file: 'docs/fleet/03-example.md', match: 'ישן' },
    });
    const result = findPrEligibleEntry([entry], entry.id);
    expect(result.ok).toBe(false);
  });

  it('accepts a well-formed pr-eligible entry and narrows fix.match to a string', () => {
    const entry = prEligibleEntry();
    const result = findPrEligibleEntry([entry], entry.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const narrowed: PrEligibleEntry = result.entry;
      expect(narrowed.fix.match).toBe('ישן');
    }
  });
});

describe('validateApprovalVerdict', () => {
  it('rejects a missing row', () => {
    expect(validateApprovalVerdict(null)).toMatch(/not found/);
  });

  it('rejects a row from another role', () => {
    const err = validateApprovalVerdict({ role: 'ops-monitor', kind: 'approval', status: 'approved' });
    expect(err).toMatch(/fleet-maintainer/);
  });

  it('rejects a non-approval kind', () => {
    const err = validateApprovalVerdict({
      role: 'fleet-maintainer',
      kind: 'question',
      status: 'approved',
    });
    expect(err).toMatch(/approval/);
  });

  it('rejects a still-pending request', () => {
    const err = validateApprovalVerdict({
      role: 'fleet-maintainer',
      kind: 'approval',
      status: 'pending',
    });
    expect(err).toMatch(/pending/);
  });

  it('rejects a denied request', () => {
    const err = validateApprovalVerdict({
      role: 'fleet-maintainer',
      kind: 'approval',
      status: 'denied',
    });
    expect(err).not.toBeNull();
  });

  it('accepts an approved request', () => {
    const err = validateApprovalVerdict({
      role: 'fleet-maintainer',
      kind: 'approval',
      status: 'approved',
    });
    expect(err).toBeNull();
  });

  it('hints about ack ordering when the verdict was already consumed', () => {
    const err = validateApprovalVerdict({
      role: 'fleet-maintainer',
      kind: 'approval',
      status: 'consumed',
    });
    expect(err).toMatch(/ack/);
  });
});

describe('runMechanicalCheck', () => {
  it('contains_line: issue present when the match string is found', () => {
    expect(runMechanicalCheck({ type: 'contains_line', match: 'ישן' }, 'שורה עם ישן בפנים')).toBe(true);
  });

  it('contains_line: issue resolved when the match string is gone', () => {
    expect(runMechanicalCheck({ type: 'contains_line', match: 'ישן' }, 'שורה עם חדש בפנים')).toBe(false);
  });

  it('absent_line: issue present when the required string is missing', () => {
    expect(runMechanicalCheck({ type: 'absent_line', match: 'נדרש' }, 'שורה בלי זה')).toBe(true);
  });

  it('absent_line: issue resolved when the required string is present', () => {
    expect(runMechanicalCheck({ type: 'absent_line', match: 'נדרש' }, 'שורה עם נדרש בפנים')).toBe(false);
  });
});

describe('applyFix', () => {
  it('replace_line replaces the matched line only', () => {
    const result = applyFix(
      { type: 'replace_line', file: 'x', match: 'ישן', replace: 'חדש' },
      'שורה ראשונה\nשורה עם ישן בפנים\nשורה אחרונה',
    );
    expect(result).toEqual({
      ok: true,
      content: 'שורה ראשונה\nשורה עם חדש בפנים\nשורה אחרונה',
    });
  });

  it('delete_line removes the matched line entirely', () => {
    const result = applyFix(
      { type: 'delete_line', file: 'x', match: 'למחוק' },
      'שורה ראשונה\nשורה למחוק\nשורה אחרונה',
    );
    expect(result).toEqual({ ok: true, content: 'שורה ראשונה\nשורה אחרונה' });
  });

  it('fails when the match text is no longer present', () => {
    const result = applyFix(
      { type: 'replace_line', file: 'x', match: 'לא-קיים', replace: 'חדש' },
      'תוכן שלא מכיל את המחרוזת',
    );
    expect(result.ok).toBe(false);
  });
});

describe('branchNameFor / prHeadPrefixFor', () => {
  it('formats a UTC YYYYMMDD branch name and a matching prefix', () => {
    const fixed = new Date(Date.UTC(2026, 7, 9, 23, 59));
    expect(branchNameFor('my-catalog-id', fixed)).toBe('fleet/maintenance-my-catalog-id-20260809');
    expect(prHeadPrefixFor('my-catalog-id')).toBe('fleet/maintenance-my-catalog-id-');
    expect(branchNameFor('my-catalog-id', fixed).startsWith(prHeadPrefixFor('my-catalog-id'))).toBe(true);
  });
});

describe('buildPrMetadata', () => {
  it('includes the catalog id, category and notes', () => {
    const entry = prEligibleEntry();
    const found = findPrEligibleEntry([entry], entry.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const meta = buildPrMetadata(found.entry);
    expect(meta.title).toContain(entry.title);
    expect(meta.body).toContain(entry.id);
    expect(meta.body).toContain(entry.notes);
    expect(meta.commitMessage).toContain(entry.id);
  });
});
