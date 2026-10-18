// Who is offered Google Pay on the CardCom package payment form (openspec/changes/add-google-pay-cardcom, design D1 and D2).
// Pure — no DOM, no database — so the rule that decides whether money-moving UI is shown is a function of its inputs and is
// unit-tested. The setting itself lives on `cardcom_config.google_pay_mode`; this module only knows its three positions and what
// each one means for a buyer.
//
//   off     nobody is offered it (the column's default: nothing changes until the owner moves it);
//   admins  only someone who may configure the integration (the same people who may use CardCom's test terminal) — the real-money
//           acceptance runs here, on production, without exposing any buyer;
//   all     every buyer whose purchase goes through CardCom.

export const GOOGLE_PAY_MODES = ['off', 'admins', 'all'] as const;
export type GooglePayMode = (typeof GOOGLE_PAY_MODES)[number];

// A stored value that is none of the three (a column the database already refuses to hold, a row from before the column
// existed, a type that makes no sense) is "off": the feature fails closed and the card form is untouched.
export function parseGooglePayMode(value: unknown): GooglePayMode {
  return GOOGLE_PAY_MODES.find((mode) => mode === value) ?? 'off';
}

export type GooglePayOfferInput = {
  mode: GooglePayMode;
  /** The purchase is taken through CardCom (never the SUMIT fallback form). */
  usesCardcom: boolean;
  /** The buyer may configure the integration (the page's `mayUseTestTerminal`). */
  mayConfigureIntegration: boolean;
  /**
   * The save-card setting is on: the session asks CardCom for ChargeAndCreateToken, and settlement parks a confirmed charge
   * that comes back with no token. Whether a wallet payment returns a token is unverified (design D8), so the wallet is withheld.
   */
  saveCardOnPurchase: boolean;
};

export function isGooglePayOffered({ mode, usesCardcom, mayConfigureIntegration, saveCardOnPurchase }: GooglePayOfferInput): boolean {
  if (!usesCardcom || saveCardOnPurchase) return false;
  if (mode === 'all') return true;
  if (mode === 'admins') return mayConfigureIntegration;
  return false;
}
