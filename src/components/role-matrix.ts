import { useState, useTransition } from 'react';

// Mechanics shared by the two role × permission matrix editors — the platform
// (staff) screen at /admin/roles and the organization (customer) screen at
// /app/team/roles. Only what is identical and knows nothing about either side
// lives here: the screens themselves stay separate components, each with its own
// DTOs, lock rules, wording and Server Action.

// Groups items by a string key, preserving first-appearance order (the data
// layers already order permissions by sort_order).
export function groupInOrder<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    let i = index.get(key);
    if (i === undefined) {
      i = groups.length;
      index.set(key, i);
      groups.push({ key, items: [] });
    }
    groups[i].items.push(item);
  }
  return groups;
}

// The lookup key of one (role, permission) cell.
export function grantKey(roleId: string, permissionId: string): string {
  return `${roleId}:${permissionId}`;
}

// Fast lookup: is (role, permission) currently granted? Built from the
// role id → permission ids map both matrices arrive as.
export function grantedKeySet(granted: Record<string, string[]>): Set<string> {
  const set = new Set<string>();
  for (const [roleId, permissionIds] of Object.entries(granted)) {
    for (const permissionId of permissionIds) set.add(grantKey(roleId, permissionId));
  }
  return set;
}

// One SERVER-VERIFIED switch: it flips optimistically, awaits `save`, and
// reverts + reports the message if the server rejects. `save` resolves to the
// error message, or to nothing on success (success is silent).
export function useOptimisticGrant(
  initialChecked: boolean,
  save: (granted: boolean) => Promise<string | undefined>,
  onError: (message: string | null) => void,
): { checked: boolean; pending: boolean; onChange: (next: boolean) => void } {
  const [checked, setChecked] = useState(initialChecked);
  const [pending, startTransition] = useTransition();

  const onChange = (next: boolean): void => {
    setChecked(next); // optimistic
    onError(null);
    startTransition(async () => {
      const message = await save(next);
      if (message) {
        setChecked(!next); // revert
        onError(message);
      }
    });
  };

  return { checked, pending, onChange };
}
