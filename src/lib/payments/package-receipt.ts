// The line a package purchase prints on its receipt, whichever clearing company takes the payment. Customer-facing: it
// names the product, not the price or any term (and never the provider).
//
// The product is the package the customer bought: its name, read on the server from the campaign's package
// (campaigns.template_id → packages.name). RECEIPT_DESCRIPTION is the fallback when that name is missing, empty or longer
// than a provider accepts for a product line (CardCom: 250).
export const RECEIPT_DESCRIPTION = 'KALFA — חבילת אישורי הגעה לאירוע';

const MAX_LINE = 250;

export function receiptLineFor(packageName: string | null | undefined): string {
  const name = typeof packageName === 'string' ? packageName.trim() : '';
  return name !== '' && name.length <= MAX_LINE ? name : RECEIPT_DESCRIPTION;
}
