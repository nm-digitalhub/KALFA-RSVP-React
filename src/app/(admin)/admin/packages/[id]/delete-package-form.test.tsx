// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { RawRuleOf } from '@casl/ability';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The Server Action needs the server; the form only binds it. Its own refusal is proven in actions.test.ts.
vi.mock('../actions', () => ({ deletePackageAction: vi.fn() }));

import { PlatformAbilityProvider } from '@/components/platform-ability-provider';
import type { PlatformAbility } from '@/lib/casl';
import { DeletePackageForm } from './delete-package-form';

// The delete control (pilot-casl-package-permissions, design D5) is shown only to a viewer whose rules allow
// `delete Package`. Display only: deletePackageAction checks the same action itself.

afterEach(cleanup);

function renderUnder(rules: RawRuleOf<PlatformAbility>[]) {
  return render(
    <PlatformAbilityProvider rules={rules}>
      <DeletePackageForm id="12345678-1234-1234-1234-123456789abc" name="בסיס" />
    </PlatformAbilityProvider>,
  );
}

const deleteButton = () => screen.queryByRole('button', { name: 'מחיקת החבילה' });

describe('DeletePackageForm', () => {
  it('is shown to a viewer who may delete a package', () => {
    renderUnder([{ action: 'delete', subject: 'Package' }]);
    expect(deleteButton()).not.toBeNull();
  });

  it('is not rendered at all for a viewer who may read and update but not delete', () => {
    const { container } = renderUnder([
      { action: 'read', subject: 'Package' },
      { action: 'update', subject: 'Package' },
    ]);
    expect(deleteButton()).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('is not rendered for a viewer with no rules', () => {
    renderUnder([]);
    expect(deleteButton()).toBeNull();
  });
});
