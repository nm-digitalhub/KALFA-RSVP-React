'use client';

import { useMemo } from 'react';
import { createMongoAbility, type RawRuleOf } from '@casl/ability';
import { AbilityProvider } from '@casl/react';

import type { PlatformAbility } from '@/lib/casl';

// The client side of the action map (openspec/changes/pilot-casl-package-permissions, design D5). The admin
// layout resolves the viewer's ability on the server and hands down its rules, which are plain JSON; this
// wrapper rebuilds the ability so <Can> and useAbility() below it decide from the same rules. It is a client
// component because @casl/react ships no 'use client' directive and is built on React context. Display only:
// every server entry point checks the action itself.
export function PlatformAbilityProvider({
  rules,
  children,
}: {
  rules: RawRuleOf<PlatformAbility>[];
  children: React.ReactNode;
}) {
  const ability = useMemo(() => createMongoAbility<PlatformAbility>(rules), [rules]);
  return <AbilityProvider value={ability}>{children}</AbilityProvider>;
}
