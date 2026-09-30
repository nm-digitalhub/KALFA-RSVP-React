import { describe, expect, it } from 'vitest';

import { anySendValuePaths } from './template-route';
import { VALUE_LABELS, valueLabel } from './value-labels';

describe('VALUE_LABELS', () => {
  it('labels every value the sender has, and nothing it does not', () => {
    expect(Object.keys(VALUE_LABELS).sort()).toEqual([...new Set(anySendValuePaths())].sort());
  });

  it('an unlabelled path is still offered, under its id', () => {
    expect(valueLabel('event.new_value')).toEqual({ label: 'event.new_value', group: 'אחר', kind: 'text' });
  });
});
