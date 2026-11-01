'use server';

import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { requireAnyPlatformAction } from '@/lib/auth/platform-ability';
import { PACKAGE_FORM_ACTIONS } from '@/lib/casl';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { packageBaseSchema } from '@/lib/validation/admin';
import { runPackageCopy, PackageCopyError } from '@/lib/ai/package-copy';
import type { PackageCopyField } from './package-copy-types';

function validCopy(field: PackageCopyField, text: string): boolean {
  // The payload ceiling also bounds oversized inputs with thousands of blank lines.
  if (!text.trim() || text.length > 12_000) return false;
  return field === 'description'
    ? packageBaseSchema.shape.description.safeParse(text).success
    : packageBaseSchema.shape.includes.safeParse(text).success;
}

// Called as rewritePackageCopyAction(field, text). The caller's right comes first, in a middleware that runs before any
// input is looked at; neither argument has a schema of its own, so both arrive as they were sent and are checked in
// the body, with the messages the editor shows.
export const rewritePackageCopyAction = actionClient
  .use(async ({ next }) => {
    // Outside any catch: auth redirects must keep their normal Next.js behavior.
    const user = await requireAnyPlatformAction(PACKAGE_FORM_ACTIONS);
    return next({ ctx: { userId: user.id } });
  })
  .bindArgsSchemas([z.unknown()])
  .inputSchema(z.unknown())
  .action(async ({ parsedInput: rawText, bindArgsParsedInputs: [field], ctx: { userId } }) => {
    if ((field !== 'description' && field !== 'includes') || typeof rawText !== 'string') {
      returnUserError('בקשת הניסוח אינה תקינה.');
    }
    const text = rawText.replace(/\r\n?/g, '\n').trim();
    if (rawText.length > 12_000 || !validCopy(field, text)) {
      returnUserError('יש להזין טקסט בגבולות האורך של שדה החבילה.');
    }
    let output: string;
    try {
      output = (await runPackageCopy(field, text, userId)).replace(/\r\n?/g, '\n').trim();
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof PackageCopyError) {
        if (err.code === 'busy') returnUserError('יש בקשת ניסוח פעילה. נסו שוב בעוד רגע.');
        if (err.code === 'timeout') returnUserError('הניסוח ארך יותר מדי זמן. נסו שוב.');
        if (err.code === 'not_found') returnUserError('שירות הניסוח אינו זמין בשרת כרגע.');
      }
      returnUserError('לא ניתן לשפר את הניסוח כרגע. נסו שוב.');
    }
    if (!validCopy(field, output)) {
      returnUserError('הניסוח שהתקבל אינו מתאים למגבלות השדה. נסו שוב.');
    }
    if (field === 'includes') {
      const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
      const before = lines(text);
      const after = lines(output);
      if (before.length !== after.length) {
        returnUserError('הניסוח שינה את מספר הפריטים. נסו שוב.');
      }
      return { text: after.join('\n') };
    }
    return { text: output };
  });
