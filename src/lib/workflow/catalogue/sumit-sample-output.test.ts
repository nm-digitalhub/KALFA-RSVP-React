import { describe, expect, it } from 'vitest';

import { buildPaletteItems, SUMIT_HOLD_FIELDS_OUTPUT } from './schemas';
import { sumitCardOutputFromSample } from './sumit-sample-output';

// The SUMIT trigger's picker fields, derived from a real stored call.
//
// What this file holds: the fields come from the SAMPLE (so a folder we never
// measured still gets a list), VALUES never survive (only keys and types), the
// holds folder keeps its measured labels, and a hostile body cannot turn its
// keys into anything the picker would offer as a broken or dangerous path.

/** A release as the live webhook stored it, personal values replaced. */
const HOLD_BODY = {
  Type: 'CreateOrUpdate',
  Folder: 1076735289,
  EntityID: 2385274662,
  Properties: {
    Billing_Date: ['2026-09-23T17:05:20+03:00'],
    Billing_Amount: [1],
    Billing_Status: [1],
    Billing_Currency: [1],
    Billing_Customer: [{ ID: 11, Name: 'לקוח לדוגמה', Status: 0, Version: 6, SchemaID: 1076734599 }],
    Billing_PaymentMethod: [{ ID: 22, Name: 'כרטיס אשראי (0000)', Status: 0, Version: 0, SchemaID: 1076735281 }],
    Billing_CreditGuyTransaction: [{ ID: 33, Name: '23/09/2026 17:05', Status: 0, Version: 0, SchemaID: 1076735182 }],
  },
};

/** SUMIT help article 10442304's shape: another company, another folder. */
const OTHER_FOLDER_BODY = {
  Folder: 440486517,
  EntityID: 632049688,
  Type: 'CreateOrUpdate',
  Properties: {
    Billing_Amount: [11.8],
    Billing_ExternalIdentifier: ['2025-01-22T11:12:28+02:00'],
    Billing_PaymentSource: [{ Version: 1, Status: 0, SchemaID: 440485932, ID: 632049680, Name: 'טריגר לדוגמה' }],
  },
};

describe('a folder we never measured gets its fields from the call itself', () => {
  const out = sumitCardOutputFromSample(OTHER_FOLDER_BODY)!;

  it('offers exactly what was seen, typed from the value', () => {
    expect(out['properties.Billing_Amount.0']).toMatchObject({ type: 'number' });
    expect(out['properties.Billing_ExternalIdentifier.0']).toMatchObject({ type: 'datetime' });
    expect(out['properties.Billing_PaymentSource.0.Name']).toMatchObject({ type: 'string' });
    expect(out['properties.Billing_PaymentSource.0.ID']).toMatchObject({ type: 'number' });
  });

  it('⚠️ drops SUMIT’s reference bookkeeping — Version, Status, SchemaID', () => {
    for (const key of Object.keys(out)) expect(key).not.toMatch(/\.\d+\.(Version|Status|SchemaID)$/);
  });

  it('⚠️ does NOT borrow the holds folder’s labels for a same-named field', () => {
    expect(out['properties.Billing_Amount.0']?.label).not.toMatch(/תפיסות מסגרת/);
    expect(out.holdStatus).toBeUndefined();
  });

  it('keeps the base fields every call has', () => {
    expect(Object.keys(out).slice(0, 5)).toEqual(['folder', 'entityId', 'changeType', 'properties', 'body']);
  });
});

describe('the holds folder keeps its measured list — the sample only adds', () => {
  const out = sumitCardOutputFromSample(HOLD_BODY)!;

  it('every measured field is still offered, including ones this release did not carry', () => {
    for (const key of Object.keys(SUMIT_HOLD_FIELDS_OUTPUT)) expect(out, key).toHaveProperty([key]);
    expect(out['properties.Billing_PaymentDocument.0.Name']?.label).toMatch(/\(תפיסות מסגרת\)$/);
  });

  it('a field seen in the call wears its measured label and type, not a guessed one', () => {
    expect(out['properties.Billing_Amount.0']).toEqual(SUMIT_HOLD_FIELDS_OUTPUT['properties.Billing_Amount.0']);
  });
});

describe('⚠️ values never survive — keys and types only', () => {
  it('no personal value appears anywhere in the output', () => {
    const text = JSON.stringify(sumitCardOutputFromSample(HOLD_BODY));
    expect(text).not.toContain('לקוח לדוגמה');
    expect(text).not.toContain('0000');
    expect(text).not.toContain('2385274662');
  });
});

describe('⚠️ a hostile body — the call is unsigned', () => {
  it('prototype-chain names never become a path, and no prototype is touched', () => {
    const body = JSON.parse(
      '{"Folder":1,"Properties":{"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}},"ok":[1]}}',
    );
    const out = sumitCardOutputFromSample(body)!;
    expect(Object.keys(out).some((k) => /__proto__|constructor|prototype/.test(k))).toBe(false);
    expect(out['properties.ok.0']).toMatchObject({ type: 'number' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('a key the template grammar cannot express is not offered', () => {
    const out = sumitCardOutputFromSample({ Properties: { 'bad key': [1], 'x}}{{y': [2], good_key: [3] } })!;
    expect(Object.keys(out).filter((k) => k.startsWith('properties.'))).toEqual(['properties.good_key.0']);
  });

  it('a flood of keys is capped', () => {
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`f${i}`, [i]]));
    const out = sumitCardOutputFromSample({ Properties: many })!;
    expect(Object.keys(out).filter((k) => k.startsWith('properties.')).length).toBe(80);
  });
});

describe('not a SUMIT card → null, and the fixed list stays', () => {
  it.each([
    ['nothing', undefined],
    ['a string', 'json=…'],
    ['no Properties', { Folder: 1 }],
    ['Properties an array', { Properties: [1] }],
    ['Properties empty', { Properties: {} }],
  ])('%s', (_label, body) => {
    expect(sumitCardOutputFromSample(body)).toBeNull();
  });
});

describe('the palette uses the sample when there is one', () => {
  const sumitOf = (items: ReturnType<typeof buildPaletteItems>) => items.find((i) => i.type === 'trigger.sumit_card')!;

  it('with a sample: those fields', () => {
    const output = sumitCardOutputFromSample(OTHER_FOLDER_BODY)!;
    const schema = sumitOf(buildPaletteItems([], [], [], [], [], [], output)).outputSchema!;
    expect(schema.type === 'default' ? Object.keys(schema.properties) : []).toContain(
      'properties.Billing_ExternalIdentifier.0',
    );
  });

  it('without one: the fixed list, exactly as before', () => {
    const schema = sumitOf(buildPaletteItems()).outputSchema!;
    expect(schema.type === 'default' ? Object.keys(schema.properties) : []).toContain('properties.Billing_Amount.0');
    expect(schema.type === 'default' ? Object.keys(schema.properties) : []).not.toContain(
      'properties.Billing_ExternalIdentifier.0',
    );
  });
});
