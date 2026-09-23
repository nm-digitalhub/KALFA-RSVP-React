'use client';

// Undo / redo — the vendor's plugin, mounted the way the vendor mounts it.
//
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Synergia Pro Sp. z o.o.
// Source: https://github.com/synergycodes/workflowbuilder
//   apps/demo/src/app/plugins/undo-redo/plugin-exports.ts
//   apps/demo/src/app/plugins/undo-redo/providers/undo-redo-provider.tsx
//   apps/demo/src/app/plugins/undo-redo/hooks/use-undo-redo-keyboard-handler.tsx
//   apps/demo/src/app/plugins/undo-redo/components/buttons-undo-redo/buttons-undo-redo.tsx
//   at commit b1f47943b723c628b6dd9f6cc67f160df58a55b8 (2026-09-22)
// License: https://www.apache.org/licenses/LICENSE-2.0
//
// MODIFIED (Apache-2.0 §4b) in exactly three places, each forced or measured.
// Everything else — the slots, the placement, the icons, the disabled rules, the
// keys — is the vendor's.
//
//   1. The buttons are `kalfa-workflow-appbar-button`, not `NavButton`.
//      FORCED: `NavButton` comes from `@workflowbuilder/ui`, which the vendor's
//      own package.json marks `publishConfig.access: public` and which npm
//      nonetheless answers with 404 — it exists only inside their monorepo.
//      `kalfa-workflow-appbar-button` is what `app-bar.tsx` already uses for the
//      two buttons it puts in this same app bar, so these match the bar they sit
//      in rather than introducing a third look.
//
//   2. The tooltips are Hebrew literals, not `t('plugins.undoRedo.*')`.
//      FORCED: the vendor reads them with `react-i18next`, which is installed
//      only under `@workflowbuilder/sdk/node_modules` and does not resolve from
//      this app (`require.resolve` → MODULE_NOT_FOUND). The app bar's other
//      buttons label themselves the same way.
//
//   3. The keyboard shortcuts do NOT pass `skipTarget: true`.
//      MEASURED in the shipped 2.3.0 hook (`Ci` in dist/index-*.js):
//        i.key === e && (t.skipTarget || UF(i.target)) && … && (i.preventDefault(), r(l))
//      With `skipTarget` the target test is skipped, so the hook fires inside a
//      text field too — and calls `preventDefault()`. Ctrl+Z while typing a
//      node's name in the properties panel would then KILL the browser's own
//      text undo and revert the whole diagram a step instead. Without it,
//      `UF(target)` limits the shortcut to the canvas, and a text field keeps
//      its native undo. `workflow-editor.tsx` already records this exact class
//      of bug for Escape ("closed the panel out from under the owner").
//
// ⚠️ TWO THINGS THE VENDOR'S CODE DOES THAT ITS DOCS DO NOT SAY, kept as-is:
//   * Redo is Ctrl/Cmd+Y. The docs page promises Ctrl+Shift+Z; the hook compares
//     `event.key === 'z'`, and with Shift held `key` is `'Z'`, so that combo
//     does nothing.
//   * The match is on `event.key`, not `event.code`. Under a Hebrew keyboard
//     layout the Z key may report `'ז'`. NOT VERIFIED — needs a browser.
import { Icon, registerComponentDecorator, registerFunctionDecorator, useKeyPress, useStore } from '@workflowbuilder/sdk';
import { type ReactNode, memo, useEffect } from 'react';

import { redo, trackFutureChangeDecorator, undo, useUndoRedoStore } from './undo-redo-store';

// From hooks/use-undo-redo-keyboard-handler.tsx — minus `skipTarget`, see (3).
function useUndoRedoKeyboardHandler() {
  const z = useKeyPress('z', { withControlOrMeta: true });
  const y = useKeyPress('y', { withControlOrMeta: true });

  useEffect(() => {
    if (z) {
      undo();
    }
  }, [z]);

  useEffect(() => {
    if (y) {
      redo();
    }
  }, [y]);
}

// From providers/undo-redo-provider.tsx, unchanged.
function UndoRedoProviderComponent({ children }: { children?: ReactNode }) {
  useUndoRedoKeyboardHandler();

  return children;
}

const UndoRedoProvider = memo(UndoRedoProviderComponent);

// From components/buttons-undo-redo/buttons-undo-redo.tsx — see (1) and (2).
function ButtonsUndoRedo() {
  const canUndo = useUndoRedoStore((store) => store.past.length > 0);
  const canRedo = useUndoRedoStore((store) => store.future.length > 0);
  const isReadOnlyMode = useStore((store) => store.isReadOnlyMode);

  return (
    <>
      <button
        type="button"
        className="kalfa-workflow-appbar-button"
        onClick={undo}
        disabled={!canUndo || isReadOnlyMode}
        aria-label="ביטול פעולה"
        title="ביטול פעולה (Ctrl+Z)"
      >
        <Icon name="ArrowUUpLeft" />
      </button>
      <button
        type="button"
        className="kalfa-workflow-appbar-button"
        onClick={redo}
        disabled={!canRedo || isReadOnlyMode}
        aria-label="ביצוע חוזר"
        title="ביצוע חוזר (Ctrl+Y)"
      >
        <Icon name="ArrowUUpRight" />
      </button>
    </>
  );
}

/**
 * From plugin-exports.ts. The same three registrations, into the same slots.
 *
 * `OptionalAppBarTools` wraps the SDK's own Save button inside the logo half of
 * the app bar (`c4` → `u4` in the 2.3.0 bundle), so `place: 'after'` puts these
 * immediately after Save — not in the controls row `app-bar.tsx` warns runs out
 * of width first on a phone.
 *
 * `OptionalHooks` is an invisible host (`xB` returns null); the provider mounts
 * beside it only to run the keyboard hook.
 *
 * MODIFIED: `name` on all three, where the vendor names only the buttons. The
 * registries are module-global and replace on a name match; `app-bar.tsx` names
 * both of its registrations for the same reason — without one, Fast Refresh
 * stacks a copy per edit, and a doubled `trackFutureChange` decorator would
 * record every step twice.
 *
 * NOT CARRIED OVER: `registerPluginTranslation`. It only fed the `t(...)` keys
 * that (2) replaces.
 */
export function undoRedoPlugin(): void {
  registerComponentDecorator('OptionalHooks', {
    content: UndoRedoProvider,
    name: 'kalfa-undo-redo-provider',
  });

  registerComponentDecorator('OptionalAppBarTools', {
    content: ButtonsUndoRedo,
    place: 'after',
    name: 'UndoRedo',
  });

  registerFunctionDecorator('trackFutureChange', {
    callback: trackFutureChangeDecorator,
    name: 'kalfa-undo-redo-history',
  });
}
