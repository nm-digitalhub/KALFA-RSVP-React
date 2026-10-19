// src/lib/auth/platform-ability.ts
import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { hasPlatformPermission, requirePlatformPermission, requireUser } from '@/lib/auth/dal';
import {
  buildPlatformAbility,
  platformActionKey,
  PLATFORM_ACTION_PAIRS,
  type PlatformAbility,
  type PlatformSubject,
  type PlatformAction,
  type PlatformPermissionKey
} from '@/lib/casl';

/**
 * Resolves the user's platform ability based on active DB grants.
 * Memoized per render pass via React cache().
 */
export const getPlatformAbility = cache(async (): Promise<PlatformAbility> => {
  const heldKeys = new Set<string>();

  const distinctKeys = Array.from(new Set(PLATFORM_ACTION_PAIRS.map((p) => p.key)));

  const checks = await Promise.all(
    distinctKeys.map(async (key) => ({
      key,
      hasIt: await hasPlatformPermission(key),
    }))
  );

  checks.forEach(({ key, hasIt }) => {
    if (hasIt) {
      heldKeys.add(key);
    }
  });

  return buildPlatformAbility(heldKeys);
});

/**
 * Server enforcement gate for a single admin action.
 * Resolves the key through the map and delegates to requirePlatformPermission.
 * Returns the authenticated user.
 */
export async function requirePlatformAction<S extends PlatformSubject>(
  action: PlatformAction<S>,
  subject: S
) {
  const neededKey = platformActionKey(action, subject);
  return await requirePlatformPermission(neededKey);
}

/**
 * Helper structural type to safely hold mapped pairs without losing generic validation
 */
export interface SafeActionPair<S extends PlatformSubject = PlatformSubject> {
  subject: S;
  action: PlatformAction<S>;
}

/**
 * Server enforcement gate for hybrid actions serving multiple entry points.
 * Returns the authenticated user, or redirects to /auth/login or /access-denied.
 */
export async function requireAnyPlatformAction(
  pairs: SafeActionPair[]
) {
  // הגנה ראשונה (The Floor): וידוא שהמשתמש מחובר בכלל, למניעת ניתוב שגוי ל-/access-denied
  const user = await requireUser();

  if (pairs.length === 0) {
    redirect('/access-denied');
  }

  // מיפוי נקי ללא any וללא השלכות lint
  const mappedKeys = pairs.map((p) => platformActionKey(p.action, p.subject));
  const distinctKeys: PlatformPermissionKey[] = Array.from(new Set(mappedKeys));

  // אופטימיזציה: אם כל הפעולות דורשות את אותו המפתח, נשתמש בנתיב המהיר של requirePlatformPermission
  if (distinctKeys.length === 1 && distinctKeys[0]) {
    return await requirePlatformPermission(distinctKeys[0]);
  }

  const results = await Promise.all(distinctKeys.map((key) => hasPlatformPermission(key)));
  const isGranted = results.some((hasKey) => hasKey === true);

  if (!isGranted) {
    redirect('/access-denied');
  }

  return user;
}
