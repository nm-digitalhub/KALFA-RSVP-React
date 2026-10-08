import { z } from 'zod';

import {
  RDP_MINUTES_PRESETS,
  RDP_REASON_MAX,
  RDP_REASON_MIN,
  isValidRdpTarget,
  OS_ACCOUNT_PATTERN,
  type RdpMinutesPreset,
} from '@/lib/rdp-access/policy';
import { XRDP_TICKET_PATTERN } from '@/lib/rdp-access/xrdp-ticket';

// Input shapes for the remote-desktop approval flow. Every bound comes from rdp-access/policy.ts, which
// mirrors the CHECKs of 20261006164315_rdp_access_approval.sql, so a value that passes here cannot be
// refused by the database with a constraint error the form has no field to attach to.

/** Messages the staff form may show. Anything else is replaced by the action's generic sentence. */
export const RDP_ACCESS_ERRORS = {
  reasonRequired: 'יש לכתוב את מטרת הגישה',
  reasonTooShort: `מטרת הגישה קצרה מדי (לפחות ${RDP_REASON_MIN} תווים)`,
  reasonTooLong: `מטרת הגישה ארוכה מדי (עד ${RDP_REASON_MAX} תווים)`,
  minutesInvalid: 'יש לבחור משך גישה מהרשימה',
} as const;

function isPreset(value: number): value is RdpMinutesPreset {
  return (RDP_MINUTES_PRESETS as readonly number[]).includes(value);
}

/** The staff request form. `minutes` arrives as a string from FormData and must be one of the presets. */
export const rdpRequestFormSchema = z.object({
  reason: z
    .string({ error: RDP_ACCESS_ERRORS.reasonRequired })
    .trim()
    .min(RDP_REASON_MIN, { error: RDP_ACCESS_ERRORS.reasonTooShort })
    .max(RDP_REASON_MAX, { error: RDP_ACCESS_ERRORS.reasonTooLong }),
  minutes: z.coerce.number({ error: RDP_ACCESS_ERRORS.minutesInvalid }).refine(isPreset, {
    error: RDP_ACCESS_ERRORS.minutesInvalid,
  }),
});
export type RdpRequestForm = z.infer<typeof rdpRequestFormSchema>;

/**
 * The per-tunnel grant check the gateway posts to the app's internal route. Strict: an unknown key is
 * refused, so the contract cannot silently grow. The PAA token is deliberately NOT part of it.
 */
export const rdpGatewayCheckBodySchema = z.strictObject({
  user: z.string().min(1).max(256),
  clientIp: z.union([z.ipv4(), z.ipv6()]),
  target: z.string().refine(isValidRdpTarget),
  tunnelId: z.string().max(64).optional(),
  rdgConnectionId: z.string().max(64).optional(),
});
export type RdpGatewayCheckBody = z.infer<typeof rdpGatewayCheckBodySchema>;

/**
 * What the desktop's login helper posts for one login attempt. Strict, and both values are shape-checked: a
 * password that is not shaped like a ticket never gets as far as the database, and an account that is not shaped
 * like an account name is refused before it is compared with anything.
 */
export const xrdpTicketCheckBodySchema = z.strictObject({
  ticket: z.string().regex(XRDP_TICKET_PATTERN),
  user: z.string().regex(OS_ACCOUNT_PATTERN),
});
export type XrdpTicketCheckBody = z.infer<typeof xrdpTicketCheckBodySchema>;
