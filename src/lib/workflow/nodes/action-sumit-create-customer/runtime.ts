// `action.sumit_create_customer` — the step handler. Server side: SDK-free, and
// it imports the shared step contract from `steps/shared`, never from
// `steps/index` (the registry imports this file, so that would be a cycle).
import { readString, type StepHandler, type StringKeyOf } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';

import type { SumitCreateCustomerConfig } from './definition';

/**
 * `action.sumit_create_customer` — create a customer card. No money moves.
 *
 * SUMIT is reached ONLY through `ctx.deps.accounting`, which the dry run swaps
 * for a recording stub — `sumit-accounting.test.ts` source-scans for that.
 */
export const sumitCreateCustomer: StepHandler = async (config, ctx) => {
  // The keys are checked against SumitCreateCustomerConfig at compile time; the
  // values are still read defensively, because the config is an unvalidated
  // jsonb row.
  const name = readString<SumitCreateCustomerConfig>(config, 'customerName').trim();
  if (!name) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "יצירת לקוח ב-SUMIT" חסר שם לקוח.',
    );
  }

  const optional = (key: StringKeyOf<SumitCreateCustomerConfig>): string | undefined => {
    const value = readString<SumitCreateCustomerConfig>(config, key).trim();
    return value ? value : undefined;
  };

  const result = await ctx.deps.accounting.createCustomer({
    name,
    email: optional('customerEmail'),
    phone: optional('customerPhone'),
    city: optional('city'),
    address: optional('address'),
    companyNumber: optional('companyNumber'),
    externalId: optional('externalId'),
    ...(typeof config.noVat === 'boolean' ? { noVat: config.noVat } : {}),
  });

  return { output: result };
};
