import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import sumitTransformer from './transformer';

// The transformer runs on SUMIT's own OpenAPI document before Orval generates the client. Every case below is a
// correction that was measured against the live API (docs/sumit-response-capture-and-audit.md §7 and the 6.10.2026
// read-only checks), so each one is pinned against the REAL spec file and not a hand-made fixture.

type Spec = Parameters<typeof sumitTransformer>[0];
type Obj = Record<string, unknown>;

const SPEC_PATH = new URL('../../../../openapi/sumit.openapi.json', import.meta.url);
const original = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as Spec;
const out = await sumitTransformer(original);

const schema = (name: string) => (out.components?.schemas?.[name] ?? {}) as Obj;
const operations = () =>
  Object.entries(out.paths ?? {}).flatMap(([path, item]) =>
    Object.values((item ?? {}) as Record<string, unknown>)
      .filter((op): op is Obj => typeof op === 'object' && op !== null && 'responses' in op)
      .map((op) => ({ path, op })),
  );
const mediaTypes = (content: unknown) => Object.keys((content ?? {}) as Obj);

function walk(value: unknown, visit: (node: Obj) => void) {
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
  else if (value && typeof value === 'object') {
    visit(value as Obj);
    Object.values(value as Obj).forEach((v) => walk(v, visit));
  }
}

describe('sumitTransformer', () => {
  it('does not mutate the document it was given', () => {
    const request = original.components?.schemas?.['Accounting_Documents_GetPDF_Request'] as Obj;
    expect((request.properties as Obj).Credentials).toBeDefined();
  });

  it('removes Credentials from every request schema, so the mutator is the only place that adds it', () => {
    for (const [name, s] of Object.entries(out.components?.schemas ?? {})) {
      const { properties, required } = s as { properties?: Obj; required?: string[] };
      expect(properties && 'Credentials' in properties, name).toBeFalsy();
      expect(required?.includes('Credentials'), name).toBeFalsy();
    }
  });

  it('keeps the request fields that are not credentials', () => {
    const properties = schema('Accounting_Documents_GetPDF_Request').properties as Obj;
    expect(Object.keys(properties).sort()).toEqual(['DocumentID', 'DocumentNumber', 'DocumentType', 'Original']);
  });

  it('turns every "Name (N)" string enum into an integer enum, which is what the live API takes', () => {
    const left: string[] = [];
    walk(out, (node) => {
      if (Array.isArray(node.enum) && node.enum.some((v) => /^\w+ \(\d+\)$/.test(String(v)))) {
        left.push(JSON.stringify(node.enum).slice(0, 60));
      }
    });
    expect(left).toEqual([]);
  });

  it('maps the response Status to the numbers the live API returns, with the vendor names', () => {
    expect(schema('Teva.Common.ResponseStatus')).toMatchObject({
      type: 'integer',
      enum: [0, 1, 2],
      'x-enumNames': ['Success', 'BusinessError', 'TechnicalError'],
    });
  });

  it('maps PaymentMethod.Type to the number 1 for a card (a label is rejected)', () => {
    expect(schema('OfficeGuy.Apps.Billing.MVC.API.Typed.PaymentMethodType')).toMatchObject({
      type: 'integer',
      enum: [0, 1, 2],
      'x-enumNames': ['Other', 'CreditCard', 'DirectDebit'],
    });
  });

  it('maps DocumentType to 0..22 exactly as SUMIT\'s help article lists it', () => {
    const documentType = schema('Accounting_Typed_DocumentType');
    expect(documentType.enum).toEqual(Array.from({ length: 23 }, (_, i) => i));
    const names = documentType['x-enumNames'] as string[];
    expect([names[0], names[1], names[3], names[8], names[22]]).toEqual([
      'Invoice',
      'InvoiceAndReceipt',
      'ProformaInvoice',
      'Order',
      'SupplierPayment',
    ]);
  });

  it('describes the getpdf answer as a binary PDF (the spec only says "OK")', () => {
    const getPdf = operations().find((o) => o.path === '/accounting/documents/getpdf/');
    const content = ((getPdf?.op.responses as Obj)['200'] as Obj).content as Obj;
    expect(Object.keys(content)).toEqual(['application/pdf']);
    expect((content['application/pdf'] as Obj).schema).toEqual({ type: 'string', format: 'binary' });
  });

  it('keeps one JSON media type per request and response, so the generated header is application/json', () => {
    for (const { path, op } of operations()) {
      const request = mediaTypes((op.requestBody as Obj | undefined)?.content);
      if (request.includes('application/json')) expect(request, path).toEqual(['application/json']);
      if (path === '/accounting/documents/getpdf/') continue;
      for (const response of Object.values((op.responses ?? {}) as Record<string, Obj>)) {
        const types = mediaTypes(response.content);
        if (types.includes('application/json')) expect(types, path).toEqual(['application/json']);
      }
    }
  });

  it('leaves the multipart operations alone (the mutator refuses them)', () => {
    const multipart = operations().filter((o) => mediaTypes((o.op.requestBody as Obj | undefined)?.content).includes('multipart/form-data'));
    expect(multipart.length).toBeGreaterThan(0);
    for (const { op } of multipart) expect(mediaTypes((op.requestBody as Obj).content)).toContain('multipart/form-data');
  });
});
