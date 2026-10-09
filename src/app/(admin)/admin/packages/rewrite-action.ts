'use server';

import { unstable_rethrow } from 'next/navigation';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { packageBaseSchema } from '@/lib/validation/admin';
import { runPackageCopy, PackageCopyError } from '@/lib/ai/package-copy';
import type { PackageCopyField, PackageCopyResult } from './package-copy-types';

function validCopy(field: PackageCopyField, text: string): boolean {
  // The payload ceiling also bounds oversized inputs with thousands of blank lines.
  if (!text.trim() || text.length > 12_000) return false;
  return field === 'description'
    ? packageBaseSchema.shape.description.safeParse(text).success
    : packageBaseSchema.shape.includes.safeParse(text).success;
}

export async function rewritePackageCopyAction(
  field: unknown, rawText: unknown,
): Promise<PackageCopyResult> {
  // Outside the catch: auth redirects must keep their normal Next.js behavior.
  const user = await requirePlatformPermission('manage_billing');
  if ((field !== 'description' && field !== 'includes') || typeof rawText !== 'string') {
    return { ok: false, error: 'בקשת הניסוח אינה תקינה.' };
  }
  const text = rawText.replace(/\r\n?/g, '\n').trim();
  if (rawText.length > 12_000 || !validCopy(field, text)) {
    return { ok: false, error: 'יש להזין טקסט בגבולות האורך של שדה החבילה.' };
  }
  try {
    const output = (await runPackageCopy(field, text, user.id)).replace(/\r\n?/g, '\n').trim();
    if (!validCopy(field, output)) {
      return { ok: false, error: 'הניסוח שהתקבל אינו מתאים למגבלות השדה. נסו שוב.' };
    }
    if (field === 'includes') {
      const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
      const before = lines(text);
      const after = lines(output);
      if (before.length !== after.length) {
        return { ok: false, error: 'הניסוח שינה את מספר הפריטים. נסו שוב.' };
      }
      return { ok: true, text: after.join('\n') };
    }
    return { ok: true, text: output };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof PackageCopyError) {
      if (err.code === 'busy') return { ok: false, error: 'יש בקשת ניסוח פעילה. נסו שוב בעוד רגע.' };
      if (err.code === 'timeout') return { ok: false, error: 'הניסוח ארך יותר מדי זמן. נסו שוב.' };
      if (err.code === 'not_found') return { ok: false, error: 'שירות הניסוח אינו זמין בשרת כרגע.' };
    }
    return { ok: false, error: 'לא ניתן לשפר את הניסוח כרגע. נסו שוב.' };
  }
}
