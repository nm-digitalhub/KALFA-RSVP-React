import { isCardcomTestTerminal, usesLocalDatabase, type CardcomServerConfig } from '@/lib/data/cardcom-config';

// Whether a fixed-price package purchase is open to this buyer (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md,
// D1 and D4). CardCom is the only clearing company; the payment page (which screen to show) and startCardcomPurchase
// both ask here, so they can never disagree. Pure apart from one build-time constant, the database address
// (usesLocalDatabase).
//
//   - closed unless the CardCom switch is explicitly on (`enabled`);
//   - on CardCom's published TEST terminal (1000), where nothing is charged, open only to a platform admin who may
//     configure the integration: a "payment" that moves no money and still activates a campaign must be impossible for
//     a customer, whatever the switch says;
//   - except on a server that runs against a local database, which holds no real customer: there every buyer is on
//     CardCom's test terminal (owner, 29.10.2026). The switch still decides first.
export function cardcomTakesPurchase(config: CardcomServerConfig | null, mayUseTestTerminal: boolean): boolean {
  if (!config || !config.enabled) return false;
  if (isCardcomTestTerminal(config.terminalNumber) && !mayUseTestTerminal && !usesLocalDatabase()) return false;
  return true;
}
