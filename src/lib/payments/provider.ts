import { isCardcomTestTerminal, type CardcomServerConfig } from '@/lib/data/cardcom-config';

// Which clearing company takes a fixed-price package purchase (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md,
// D1 and D4). Pure, and the ONE place that decides — the payment page (which form to show), the purchase route (which
// path to take) and the purchase module itself all ask here, so they can never disagree.
//
//   - SUMIT, the existing provider, unless the CardCom pilot is explicitly switched on (`enabled`);
//   - and on CardCom's published TEST terminal (1000), where nothing is charged, CardCom only for a platform admin who
//     may configure the integration. A customer stays on SUMIT: a "payment" that moves no money and still activates a
//     campaign must be impossible, whatever the switch says.
export type PurchaseProvider = 'sumit' | 'cardcom';

export function resolvePurchaseProvider(config: CardcomServerConfig | null, mayUseTestTerminal: boolean): PurchaseProvider {
  if (!config || !config.enabled) return 'sumit';
  if (isCardcomTestTerminal(config.terminalNumber) && !mayUseTestTerminal) return 'sumit';
  return 'cardcom';
}
