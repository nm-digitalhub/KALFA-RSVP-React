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

    const sumitImports = [...source.matchAll(/from\s+['"]([^'"]*sumit[^'"]*)['"]/g)].map(
      (m) => m[1],
    );
    expect(
      sumitImports,
      'a step handler must reach SUMIT through ctx.deps.accounting — a direct ' +
        'import bypasses the dry-run stub and would issue real documents from ' +
        'the editor’s test button',
    ).toEqual([]);
  });

  it('both handlers are registered, so the scan above is not guarding an empty set', () => {
    expect(typeof STEP_HANDLERS['action.sumit_create_document']).toBe('function');
    expect(typeof STEP_HANDLERS['action.sumit_create_customer']).toBe('function');
  });
});
