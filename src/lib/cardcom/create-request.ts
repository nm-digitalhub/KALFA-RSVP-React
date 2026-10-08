import { DocumentToCreate, Operation, type CreateLowProfile } from './generated/models';

// Builds the request that opens a CardCom payment session (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md, 4.3).
// Pure: it reads nothing and sends nothing, so every rule of CardCom's integration guide can be pinned by a test.
//
// The rules, from the guide:
//   - Document.Products add up to Amount to the agora — so the AMOUNT is derived from the lines here, never typed;
//   - DocumentTypeToCreate is "Auto" and IsAllowEditDocument is true (CardCom's own settings pick the document type);
//   - the document needs a name; the operation is ChargeOnly (the package is paid in one charge);
//   - ReturnValue carries our operation id for reference only — the payment is matched by LowProfileId, never by it.
//
// The lines are the ones the caller read from the payment ledger on the server. A deduction (a credit applied to the
// price) cannot be a document product, so it is refused here rather than sent as a negative price: the caller refuses a
// customer with unspent credit before it gets this far.

export type CardcomLine = { description: string; quantity?: number; unitPrice: number };

export type CardcomCreateInput = {
  terminalNumber: number;
  apiName: string;
  /** The payment ledger operation this session pays for. */
  operationId: string;
  lines: readonly CardcomLine[];
  payer: { name: string; email: string; phone?: string | null };
  /** An absolute https URL CardCom reports to. */
  webhookUrl: string;
  /** Where the buyer lands after a redirect (3DS, Google Pay, a closed popup): the payment page, whatever the outcome. */
  returnUrl: string;
};

const toCents = (n: number) => Math.round(n * 100);
const hasMoreDecimals = (n: number, places: number) => Math.abs(n * 10 ** places - Math.round(n * 10 ** places)) > 1e-6;

export function buildCreateLowProfile(input: CardcomCreateInput): CreateLowProfile {
  const name = input.payer.name.trim();
  const apiName = input.apiName.trim();
  if (apiName === '' || name === '' || input.lines.length === 0) throw new Error('בקשת CardCom אינה תקינה');

  let totalCents = 0;
  const products = input.lines.map((line) => {
    const quantity = line.quantity ?? 1;
    if (
      line.description.trim() === '' ||
      !Number.isFinite(line.unitPrice) || line.unitPrice <= 0 || hasMoreDecimals(line.unitPrice, 2) ||
      !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)
    ) {
      throw new Error('בקשת CardCom אינה תקינה');
    }
    totalCents += toCents(line.unitPrice) * quantity;
    return { Description: line.description, UnitCost: line.unitPrice, Quantity: quantity };
  });

  const phone = input.payer.phone?.trim();
  return {
    TerminalNumber: input.terminalNumber,
    ApiName: apiName,
    Operation: Operation.ChargeOnly,
    ReturnValue: input.operationId,
    Amount: totalCents / 100,
    SuccessRedirectUrl: input.returnUrl,
    FailedRedirectUrl: input.returnUrl,
    WebHookUrl: input.webhookUrl,
    Language: 'he',
    ISOCoinId: 1,
    UIDefinition: {
      CardOwnerNameValue: name,
      CardOwnerEmailValue: input.payer.email,
      ...(phone ? { CardOwnerPhoneValue: phone } : {}),
    },
    Document: {
      DocumentTypeToCreate: DocumentToCreate.Auto,
      IsAllowEditDocument: true,
      Name: name,
      Email: input.payer.email,
      Language: 'he',
      Products: products,
    },
  };
}
