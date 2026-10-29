import { isCardcomTestTerminal, usesLocalDatabase, type CardcomServerConfig } from '@/lib/data/cardcom-config';

// Which clearing company takes a fixed-price package purchase (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md,
// D1 and D4). The ONE place that decides — the payment page (which form to show), startCardcomPurchase and
// purchasePackage (SUMIT) all ask here, so they can never disagree: while it answers 'cardcom', the SUMIT purchase refuses.
// Pure apart from one build-time constant, the database address (usesLocalDatabase).
//
//   - SUMIT, the existing provider, unless the CardCom pilot is explicitly switched on (`enabled`);
//   - and on CardCom's published TEST terminal (1000), where nothing is charged, CardCom only for a platform admin who
//     may configure the integration. A customer stays on SUMIT: a "payment" that moves no money and still activates a
//     campaign must be impossible, whatever the switch says;
//   - except on a server that runs against a local database, which holds no real customer: there every buyer is on
//     CardCom's test terminal (owner, 29.10.2026). The switch still decides first.
export type PurchaseProvider = 'sumit' | 'cardcom';

export function resolvePurchaseProvider(config: CardcomServerConfig | null, mayUseTestTerminal: boolean): PurchaseProvider {
  if (!config || !config.enabled) return 'sumit';
  if (isCardcomTestTerminal(config.terminalNumber) && !mayUseTestTerminal && !usesLocalDatabase()) return 'sumit';
  return 'cardcom';
}
