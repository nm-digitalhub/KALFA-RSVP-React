// Graph's error envelope — every Graph API answers a failure with this shape.
// The type is generated from Meta's published spec (`npm run meta:types`); it is
// identical in every WhatsApp spec, so it is taken from one of them. No
// 'server-only': tsx CLIs (relocation) and the worker read it too.

import type { components } from '@/lib/whatsapp/generated/whatsapp-business-account';

export type GraphApiError = components['schemas']['GraphAPIError'];

/**
 * A response body that may carry Graph's error. It is parsed off the wire, so
 * every field of the error may be missing (and `is_transient` is read with the
 * project's rule: only `true` counts).
 */
export type GraphErrorBody = { error?: Partial<GraphApiError['error']> | null };
