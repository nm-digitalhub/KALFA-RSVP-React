// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { Can } from '@casl/react';
import type { RawRuleOf } from '@casl/ability';
import { afterEach, describe, expect, it } from 'vitest';

import { buildPlatformAbility, PLATFORM_ACTIONS, type PlatformAbility } from '@/lib/casl';
import { PlatformAbilityProvider } from './platform-ability-provider';

// The client side of the action map (pilot-casl-package-permissions, design D5): the server hands the viewer's
// rules to this provider, and <Can> under it decides from the same rules. Display only — the server gate stays
// binding.

afterEach(cleanup);

type Rules = RawRuleOf<PlatformAbility>[];

function renderDeleteControl(rules: Rules) {
  return render(
    <PlatformAbilityProvider rules={rules}>
      <Can<PlatformAbility> I="delete" a="Package">
        <button type="button">מחיקת חבילה</button>
      </Can>
    </PlatformAbilityProvider>,
  );
}

const deleteButton = () => screen.queryByRole('button', { name: 'מחיקת חבילה' });

describe('PlatformAbilityProvider', () => {
  it('shows a <Can> child to a viewer whose rules allow the action', () => {
    renderDeleteControl(buildPlatformAbility(new Set([PLATFORM_ACTIONS.Package.delete])).rules);
    expect(deleteButton()).not.toBeNull();
  });

  it('hides a <Can> child from a viewer whose rules do not allow the action', () => {
    renderDeleteControl(buildPlatformAbility(new Set()).rules);
    expect(deleteButton()).toBeNull();
  });

  it('decides per action: rules that allow reading a package do not allow deleting it', () => {
    renderDeleteControl([{ action: 'read', subject: 'Package' }]);
    expect(deleteButton()).toBeNull();
  });

  it('follows new rules when the server sends them', () => {
    const { rerender } = renderDeleteControl([]);
    expect(deleteButton()).toBeNull();
    rerender(
      <PlatformAbilityProvider rules={[{ action: 'delete', subject: 'Package' }]}>
        <Can<PlatformAbility> I="delete" a="Package">
          <button type="button">מחיקת חבילה</button>
        </Can>
      </PlatformAbilityProvider>,
    );
    expect(deleteButton()).not.toBeNull();
  });
});
