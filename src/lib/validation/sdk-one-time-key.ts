import { z } from 'zod';

// Body of the Voximplant SDK one-time-key signing routes: /api/agents/sdk-auth (a signed-in console agent) and
// /api/widget/sdk-auth (the public widget's shared identity). The two routes keep separate gates and separate
// signers; only the shape of the key is the same.
//
// Voximplant's key is an opaque token. Bounded and charset-restricted so a hostile body cannot become a long or
// structured input to the hash.
export const sdkOneTimeKeyBodySchema = z.strictObject({
  one_time_key: z
    .string()
    .trim()
    .min(8)
    .max(256)
    .regex(/^[A-Za-z0-9._~+/=-]+$/, 'one_time_key has unexpected characters'),
});
