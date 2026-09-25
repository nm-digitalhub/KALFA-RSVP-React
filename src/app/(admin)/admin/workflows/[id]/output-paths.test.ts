import { describe, expect, it } from 'vitest';

import { outputPaths, referenceFor } from './output-paths';

describe('outputPaths — the fields of a step output a template can print', () => {
  it('flattens objects and arrays into `.0` template paths, leaves only', () => {
    const paths = outputPaths({
      entityId: 2389662651,
      holdStatus: null,
      properties: { Billing_PaymentsCount: ['מאושר'], Billing_Description: [{ ID: 1, Name: 'כרטיס אשראי (9429)' }] },
    });
    expect([...paths]).toEqual([
      'entityId',
      'holdStatus',
      'properties.Billing_PaymentsCount.0',
      'properties.Billing_Description.0.ID',
      'properties.Billing_Description.0.Name',
    ]);
    // an object is not a leaf
    expect(paths.has('properties.Billing_Description.0')).toBe(false);
  });

  it('skips empty containers and keys the template grammar cannot express', () => {
    expect([...outputPaths({ meta: {}, list: [], 'bad key': 1, ok: true })]).toEqual(['ok']);
  });

  it('a non-object output has no fields', () => {
    expect(outputPaths('done').size).toBe(0);
    expect(outputPaths(null).size).toBe(0);
  });

  it('builds the stored reference form', () => {
    expect(referenceFor('0f829409', 'properties.Billing_PaymentsCount.0')).toBe(
      '{{nodes.0f829409.properties.Billing_PaymentsCount.0}}',
    );
  });
});
