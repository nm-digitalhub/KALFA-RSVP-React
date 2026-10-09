import { createInstance } from 'i18next';

import {
  Acquire,
  Brand,
  CardInfo,
  CardNumberEntryMode,
  DealType,
  DocumentType,
  Issuer,
  PaymentType,
} from '@/lib/cardcom/generated/models';

// The provider's technical values on a payment operation (CardCom's enum names, our own `provider` and `source` keys), in
// the viewer's language. The staff facts of the payments list showed them raw — "Receipt", "Debit", "Standard", "app".
//
// Through i18next, already a dependency (the workflow editor's SDK uses it), so English and French are a resource each
// when the app gets them. Its OWN instance (createInstance), never the shared default: that one belongs to the workflow
// SDK, which switches it to Hebrew in the browser (lib/workflow/i18n-he.ts), and a module-global language is not something
// a server render for one request may change. `initAsync: false` makes `t` usable the moment this module loads.
//
// Each map is keyed by the generated CardCom enum it translates, so a value CardCom adds fails type-checking here until
// it has a name. A value with no entry — a SUMIT numeric brand/issuer code, a provider value nobody mapped — is shown as
// it was stored (`defaultValue`): unknown stays visibly unknown, never guessed.

const HE = {
  provider: { cardcom: 'קארדקום', sumit: 'סאמיט' } satisfies Record<'cardcom' | 'sumit', string>,
  source: {
    app: 'המערכת',
    provider_sync: 'סנכרון מחברת הסליקה',
    manual_backfill: 'הזנה ידנית',
  } satisfies Record<'app' | 'provider_sync' | 'manual_backfill', string>,
  documentType: {
    Error: 'שגיאה',
    TaxInvoiceAndReceipt: 'חשבונית מס קבלה',
    TaxInvoiceAndReceiptRefund: 'חשבונית מס קבלה זיכוי',
    Receipt: 'קבלה',
    ReceiptRefund: 'קבלה זיכוי',
    Quote: 'הצעת מחיר',
    Order: 'הזמנה',
    SiteCustomerOrder: 'אישור הזמנה מאתר',
    SiteCustomerOrderRefund: 'אישור הזמנה מאתר זיכוי',
    DeliveryNote: 'תעודת משלוח',
    DeliveryNoteRefund: 'תעודת החזרה',
    ProformaInvoice: 'חשבון עסקה',
    DemandForPayment: 'דרישת תשלום',
    DemandForPaymentRefund: 'דרישת תשלום זיכוי',
    TaxInvoice: 'חשבונית מס',
    TaxInvoiceRefund: 'חשבונית מס זיכוי',
    ReceiptForTaxInvoice: 'קבלה לחשבונית מס',
    DonationReceipt: 'קבלה על תרומה',
    DonationReceiptRefund: 'קבלה על תרומה זיכוי',
    ReceiptForTaxInvoiceRefund: 'קבלה לחשבונית מס זיכוי',
  } satisfies Record<DocumentType, string>,
  dealType: {
    Information: 'בירור',
    Debit: 'חיוב',
    Discharge: 'פריקה',
    ForcedCharge: 'חיוב מאולץ',
    CashBack: 'משיכת מזומן',
    CashTransaction: 'עסקת מזומן',
    Recurring: 'הוראת קבע',
    BalanceQuery: 'בירור יתרה',
    Cancel: 'ביטול',
    Refund: 'זיכוי',
    Recharge: 'טעינה',
  } satisfies Record<DealType, string>,
  paymentType: {
    Unknown: 'לא ידוע',
    Standard: 'רגיל',
    SpecialCredits: 'קרדיט מיוחד',
    ImmediateCharge: 'חיוב מיידי',
    CreditClub: 'קרדיט מועדון',
    SuperCredit: 'סופר קרדיט',
    InstallmentCredit: 'תשלומי קרדיט',
    Payments: 'תשלומים',
    ClubPatments: 'תשלומי מועדון',
  } satisfies Record<PaymentType, string>,
  acquirer: {
    Unknown: 'לא ידוע',
    Isracard: 'ישראכרט',
    CAL: 'כאל',
    Diners: 'דיינרס',
    AmericanExpress: 'אמריקן אקספרס',
    Laumicard: 'מקס (לאומי קארד)',
    CardCom: 'קארדקום',
    PayPal: 'PayPal',
    Upay: 'Upay',
    PayMe: 'PayMe',
  } satisfies Record<Acquire, string>,
  cardBrand: {
    PrivateCard: 'כרטיס פרטי',
    MasterCard: 'מאסטרקארד',
    Visa: 'ויזה',
    Maestro: 'מאסטרו',
    AmericanExpress: 'אמריקן אקספרס',
    Isracard: 'ישראכרט',
    JBC: 'JCB',
    Discover: 'דיסקבר',
    Diners: 'דיינרס',
  } satisfies Record<Brand, string>,
  cardIssuer: {
    NonIsrael: 'חו״ל',
    Isracard: 'ישראכרט',
    CAL: 'כאל',
    Diners: 'דיינרס',
    AmericanExpress: 'אמריקן אקספרס',
    JCB: 'JCB',
    Laumicard: 'מקס (לאומי קארד)',
  } satisfies Record<Issuer, string>,
  entryMode: {
    MagneticStip: 'פס מגנטי',
    SelfService: 'שירות עצמי',
    GasStationSelfService: 'שירות עצמי בתחנת דלק',
    Contactless: 'ללא מגע',
    EmvContactless: 'שבב ללא מגע',
    MobileContactless: 'נייד ללא מגע',
    EmvMobileContactless: 'נייד ללא מגע (שבב)',
    MobileNumber: 'מספר נייד',
    Emv: 'שבב',
    Phone: 'טלפון',
    SignatureOnly: 'חתימה בלבד',
    Internet: 'אינטרנט',
    Fallback: 'גיבוי',
    EmptyCandidateList: 'רשימת מועמדים ריקה',
  } satisfies Record<CardNumberEntryMode, string>,
  cardInfo: {
    Israeli: 'ישראלי',
    NonIsraeli: 'זר',
    FuelCard: 'כרטיס דלק',
    ImmediateChargeCard: 'כרטיס חיוב מיידי',
    GiftCard: 'כרטיס מתנה',
  } satisfies Record<CardInfo, string>,
};

export type ProviderValueField = keyof typeof HE;

const i18n = createInstance();
void i18n.init({
  lng: 'he',
  fallbackLng: 'he',
  initAsync: false,
  // Values are looked up as `<field>.<value>`; a stored value is never a namespace.
  nsSeparator: false,
  interpolation: { escapeValue: false },
  resources: { he: { translation: HE } },
});

/** The viewer-language name of a stored provider value, or the value itself when it has no name. */
export function providerValueLabel(field: ProviderValueField, value: string): string {
  // A stored value with the key separator in it can only be an unknown one: shown as stored.
  if (value.includes('.')) return value;
  return i18n.t(`${field}.${value}`, { defaultValue: value });
}

// Kept beside the maps so a test can prove every generated enum value has a name.
export const PROVIDER_VALUE_ENUMS = {
  documentType: DocumentType,
  dealType: DealType,
  paymentType: PaymentType,
  acquirer: Acquire,
  cardBrand: Brand,
  cardIssuer: Issuer,
  entryMode: CardNumberEntryMode,
  cardInfo: CardInfo,
} as const;
