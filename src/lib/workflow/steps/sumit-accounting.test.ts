import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STEP_HANDLERS, type StepContext } from './index';

// The two SUMIT accounting nodes.
//
// ⚠️ THE PROPERTY THIS FILE EXISTS FOR is the last test: a dry run must not
// reach SUMIT. The editor's "הרצת בדיקה" panel promises "לא נשלחת הודעה ולא
// משתנים אורחים", and the owner's explicit decision (2026-09-22) was that a
// document node must say what it WOULD issue and issue nothing. That holds only
// because the handler goes through `ctx.deps.accounting`, which the dry run
// swaps for a recording stub — so a future edit that imports
// `@/lib/sumit/accounting` directly would silently start writing to the real
// books from a test button.

function ctxWith(accounting: Partial<StepContext['deps']['accounting']>): StepContext {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    nodeId: 'node-1',
    trigger: { eventId: 'e1', contactId: 'c1', message_text: '', button_payload: '' },
    deps: {
      guests: {} as StepContext['deps']['guests'],
      alerts: {} as StepContext['deps']['alerts'],
      webhook: {} as StepContext['deps']['webhook'],
      integrations: {} as StepContext['deps']['integrations'],
      accounting: accounting as StepContext['deps']['accounting'],
    },
  } as StepContext;
}

const DOC_RESULT = {
  documentId: 5001,
  documentNumber: 1002,
  customerId: 77,
  documentDownloadUrl: 'https://example.invalid/doc',
};

describe('action.sumit_create_document', () => {
  const handler = STEP_HANDLERS['action.sumit_create_document'];

  it('passes the document through and returns SUMIT’s four fields as the node output', async () => {
    const createDocument = vi.fn().mockResolvedValue(DOC_RESULT);
    const result = await handler(
      { documentType: 'Receipt', customerName: 'דנה כהן', customerEmail: 'dana@example.com' },
      ctxWith({ createDocument }),
    );

    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Receipt', customerName: 'דנה כהן' }),
    );
    // Returned WHOLE so a later node can reference {{nodes.<id>.documentId}}.
    expect(result.output).toEqual(DOC_RESULT);
  });

  it('refuses a document type outside the catalogue rather than sending it', async () => {
    const createDocument = vi.fn();
    // `Invoice` is חשבונית מס — a real SUMIT type this business (עוסק פטור)
    // may not issue, so it is absent from SUMIT_DOCUMENT_TYPES on purpose.
    await expect(
      handler({ documentType: 'Invoice', customerName: 'דנה' }, ctxWith({ createDocument })),
    ).rejects.toThrow();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('refuses a blank customer name', async () => {
    const createDocument = vi.fn();
    await expect(
      handler({ documentType: 'Receipt', customerName: '   ' }, ctxWith({ createDocument })),
    ).rejects.toThrow(/שם לקוח/);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it.each([
    ['a name with no price', { itemName: 'שירות', itemUnitPrice: 0 }],
    ['a price with no name', { itemName: '', itemUnitPrice: 200 }],
  ])('refuses a half-filled item line (%s)', async (_label, item) => {
    const createDocument = vi.fn();
    await expect(
      handler(
        { documentType: 'Receipt', customerName: 'דנה', ...item },
        ctxWith({ createDocument }),
      ),
    ).rejects.toThrow(/שורת הפריט/);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('sends no items at all when both item fields are blank — a receipt may carry none', async () => {
    const createDocument = vi.fn().mockResolvedValue(DOC_RESULT);
    await handler(
      { documentType: 'Receipt', customerName: 'דנה', itemName: '', itemUnitPrice: 0 },
      ctxWith({ createDocument }),
    );
    expect(createDocument.mock.calls[0][0]).not.toHaveProperty('items');
  });

  it('sends a complete item line with its quantity', async () => {
    const createDocument = vi.fn().mockResolvedValue(DOC_RESULT);
    await handler(
      {
        documentType: 'Receipt',
        customerName: 'דנה',
        itemName: 'דמי הפעלה',
        itemUnitPrice: 200,
        itemQuantity: 2,
      },
      ctxWith({ createDocument }),
    );
    expect(createDocument.mock.calls[0][0].items).toEqual([
      { name: 'דמי הפעלה', quantity: 2, unitPrice: 200 },
    ]);
  });

  it('defaults a missing or invalid quantity to 1 rather than sending NaN', async () => {
    const createDocument = vi.fn().mockResolvedValue(DOC_RESULT);
    await handler(
      { documentType: 'Receipt', customerName: 'דנה', itemName: 'פריט', itemUnitPrice: 50 },
      ctxWith({ createDocument }),
    );
    expect(createDocument.mock.calls[0][0].items[0].quantity).toBe(1);
  });

  it('omits blank optional fields instead of sending empty strings', async () => {
    const createDocument = vi.fn().mockResolvedValue(DOC_RESULT);
    await handler(
      {
        documentType: 'Receipt',
        customerName: 'דנה',
        customerEmail: '  ',
        customerPhone: '',
        documentDescription: '',
      },
      ctxWith({ createDocument }),
    );
    const sent = createDocument.mock.calls[0][0];
    // undefined, not '' — SUMIT must never have to tell a deliberately-blank
    // field from one that resolved to nothing.
    expect(sent.customerEmail).toBeUndefined();
    expect(sent.customerPhone).toBeUndefined();
    expect(sent.description).toBeUndefined();
  });
});

describe('action.sumit_create_customer', () => {
  const handler = STEP_HANDLERS['action.sumit_create_customer'];

  it('creates the customer and returns both fields SUMIT answers with', async () => {
    const createCustomer = vi
      .fn()
      .mockResolvedValue({ customerId: 42, customerHistoryUrl: 'https://example.invalid/c' });
    const result = await handler(
      { customerName: 'דנה כהן', customerEmail: 'dana@example.com', noVat: true },
      ctxWith({ createCustomer }),
    );

    expect(createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'דנה כהן', email: 'dana@example.com', noVat: true }),
    );
    expect(result.output).toEqual({ customerId: 42, customerHistoryUrl: 'https://example.invalid/c' });
  });

  it('refuses a blank name', async () => {
    const createCustomer = vi.fn();
    await expect(
      handler({ customerName: '' }, ctxWith({ createCustomer })),
    ).rejects.toThrow(/שם לקוח/);
    expect(createCustomer).not.toHaveBeenCalled();
  });
});

/** SUMIT-named modules a step may import because they are data, not a client. */
const PURE_SUMIT_MODULES = ['@/lib/sumit/hold-status'];

describe('⚠️ the step layer never reaches SUMIT except through the port', () => {
  // THE ACTUAL GUARANTEE, and it cannot be expressed with a mock: a handler that
  // imported `@/lib/sumit/*` directly would still pass every test above while
  // writing to the real books from the editor's "הרצת בדיקה" button — the dry
  // run only swaps PORTS, so a direct import walks straight past it
  // (engine/dry-run.ts: "a dry run is NOT a second implementation… only the
  // ports are swapped").
  //
  // Source-scanned rather than mocked, for the same reason
  // admin-data-layer-coverage.test.ts scans: the thing being guarded is what the
  // file IMPORTS, and only the file can answer that.
  it('steps/index.ts imports nothing from src/lib/sumit', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');

    // Anti-no-op: if the file moves, fail loudly rather than pass on an empty read.
    expect(source.length).toBeGreaterThan(1000);

    const sumitImports = [...source.matchAll(/from\s+['"]([^'"]*sumit[^'"]*)['"]/g)]
      .map((m) => m[1])
      // ONE named exception, and the next test is what earns it: `hold-status`
      // is data — the holds folder id and what its status codes mean — with no
      // import and no I/O, so it cannot reach SUMIT from a dry run or anywhere.
      .filter((path) => !PURE_SUMIT_MODULES.includes(path!));
    expect(
      sumitImports,
      'a step handler must reach SUMIT through ctx.deps.accounting — a direct ' +
        'import bypasses the dry-run stub and would issue real documents from ' +
        'the editor’s test button',
    ).toEqual([]);
  });

  it('⚠️ the one exception stays PURE — no import, no fetch, nothing that could reach SUMIT', () => {
    for (const path of PURE_SUMIT_MODULES) {
      const file = join(__dirname, '..', '..', '..', path.replace('@/', ''), '') + '.ts';
      const source = readFileSync(file, 'utf8');
      expect(source.length, file).toBeGreaterThan(200);
      expect(source, `${path} must import nothing`).not.toMatch(/^\s*import\b/m);
      expect(source, `${path} must do no I/O`).not.toMatch(/\b(fetch|XMLHttpRequest|require)\s*\(/);
    }
  });

  it('both handlers are registered, so the scan above is not guarding an empty set', () => {
    expect(typeof STEP_HANDLERS['action.sumit_create_document']).toBe('function');
    expect(typeof STEP_HANDLERS['action.sumit_create_customer']).toBe('function');
  });
});

describe('the chaining starter actually chains', () => {
  // The template that demonstrates node-output references is only worth
  // shipping if the reference it carries is REAL. A typo'd path renders the
  // same on the canvas and fails at run time with the token in the message —
  // after the customer has already been created.
  it('the document node references the customer node’s customerId, and that field is on its outputSchema', async () => {
    const { DIAGRAM_TEMPLATES } = await import('@/lib/workflow/catalogue/templates');
    const { PALETTE_ITEMS } = await import('@/lib/workflow/catalogue/schemas');

    const template = DIAGRAM_TEMPLATES.find(
      (t) => t.value.name === 'יצירת לקוח והפקת מסמך עבורו',
    );
    expect(template, 'the chaining starter must exist').toBeDefined();

    const nodes = template!.value.diagram.nodes;
    const customerNode = nodes.find(
      (n) => (n.data as { type?: string }).type === 'action.sumit_create_customer',
    );
    const documentNode = nodes.find(
      (n) => (n.data as { type?: string }).type === 'action.sumit_create_document',
    );
    expect(customerNode).toBeDefined();
    expect(documentNode).toBeDefined();

    const reference = (
      (documentNode!.data as { properties?: Record<string, unknown> }).properties ?? {}
    ).customerExternalId;

    // Points at THAT node's id — not a name retyped into both nodes, which is
    // how the two would drift apart.
    expect(reference).toBe(`{{nodes.${customerNode!.id}.customerId}}`);

    // And the field it names is actually published by the customer node, so the
    // variable picker offers it and the resolver can satisfy it.
    const customerPalette = PALETTE_ITEMS.find(
      (i) => i.type === 'action.sumit_create_customer',
    );
    // NodeOutputSchema is a union — 'default' carries `properties`, 'variant'
    // carries `variants` instead. Narrowed rather than cast, so a node that
    // switches to the variant shape fails here loudly instead of silently
    // reporting an empty property list.
    const outputSchema = customerPalette?.outputSchema;
    expect(outputSchema?.type, 'the create-customer node publishes a default output schema').toBe(
      'default',
    );
    const published =
      outputSchema?.type === 'default' ? Object.keys(outputSchema.properties) : [];
    expect(
      published,
      'customerId must be on the create-customer node’s outputSchema',
    ).toContain('customerId');
  });
});
