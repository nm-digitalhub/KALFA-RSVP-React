// One rule, one purpose. See the block comment above ruleIdAssignmentError for
// the measured failure this guards: a rule id reused across purposes places a
// REAL call that runs the other purpose's scenario, returns result:1, and is
// recorded as a successful dial.
import { describe, expect, it } from 'vitest';

import {
  DTMF_OUTCALL_RULE_ID,
  ruleIdAssignmentError,
  type RuleIdClaim,
} from '@/lib/validation/admin';

const CLAIMS: RuleIdClaim[] = [
  { field: 'voximplant_rule_id', label: 'שיחות RSVP', ruleId: '1520915' },
  { field: 'voximplant_meeting_confirm_rule_id', label: 'שיחות אישור פגישה', ruleId: '1523903' },
  { field: 'voximplant_sales_call_rule_id', label: 'שיחות סגירת מכירה', ruleId: '1523906' },
  { field: 'voximplant_call_me_now_rule_id', label: 'חייג אליי עכשיו', ruleId: '1523124' },
  { field: 'voice_purpose:feedback', label: 'ייעוד השיחה "משוב"', ruleId: null },
];

describe('ruleIdAssignmentError', () => {
  it('rejects a rule already claimed by another field, and names it', () => {
    const err = ruleIdAssignmentError('1520915', 'voximplant_meeting_confirm_rule_id', CLAIMS);
    expect(err).toBeTruthy();
    // The operator has to know WHICH purpose owns it, or the error is a dead end.
    expect(err).toContain('שיחות RSVP');
  });

  it('rejects the DTMF OutCall rule even though no field stores it', () => {
    // 1494311 appears in no column, so the uniqueness rule alone cannot see it.
    // This is why the guard needs two rules rather than one.
    expect(CLAIMS.some((c) => c.ruleId === DTMF_OUTCALL_RULE_ID)).toBe(false);
    expect(ruleIdAssignmentError(DTMF_OUTCALL_RULE_ID, 'voximplant_sales_call_rule_id', CLAIMS))
      .toContain('OutCall');
  });

  it('allows a field to keep the rule it already holds', () => {
    // Every save resubmits the field's current value; treating that as a clash
    // would make the panel unusable.
    expect(ruleIdAssignmentError('1523903', 'voximplant_meeting_confirm_rule_id', CLAIMS)).toBeNull();
  });

  it('allows an unclaimed rule', () => {
    expect(ruleIdAssignmentError('1530001', 'voice_purpose:feedback', CLAIMS)).toBeNull();
  });

  it('allows clearing a field — empty is a deliberate unset, not a clash', () => {
    expect(ruleIdAssignmentError('', 'voximplant_sales_call_rule_id', CLAIMS)).toBeNull();
    expect(ruleIdAssignmentError('   ', 'voximplant_sales_call_rule_id', CLAIMS)).toBeNull();
  });

  it('compares trimmed, so a stray space cannot smuggle a duplicate through', () => {
    expect(ruleIdAssignmentError(' 1520915 ', 'voximplant_sales_call_rule_id', CLAIMS)).toBeTruthy();
    const padded: RuleIdClaim[] = [
      { field: 'voximplant_rule_id', label: 'שיחות RSVP', ruleId: ' 1520915 ' },
    ];
    expect(ruleIdAssignmentError('1520915', 'voximplant_sales_call_rule_id', padded)).toBeTruthy();
  });

  it('ignores fields holding no rule', () => {
    // A null claim must never swallow an empty-ish submission into a false match.
    expect(ruleIdAssignmentError('1530002', 'voximplant_rule_id', CLAIMS)).toBeNull();
  });
});
