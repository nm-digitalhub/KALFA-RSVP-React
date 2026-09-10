'use client';

// Where the properties panel's open/closed flag lives, and why it is a module
// store rather than `useState` in the layout.
//
// The buttons that drive it are rendered by the SDK, not by us: they are
// injected into the app bar through `registerComponentDecorator`, which is
// registered at MODULE scope and mounted by the SDK's own tree. There is no
// props path from `WorkflowEditorLayout` down to a slot's content, so the two
// sides have to meet in a store.
//
// The palette's flag is NOT here — the SDK already owns that one
// (`useStore(s => s.isSidebarExpanded)` / `toggleSidebar`), and duplicating it
// would give us two sources of truth for the same panel.
import { create } from 'zustand';

type PanelsStore = {
  /** Whether the properties panel is showing. Only meaningful with a selection. */
  isPropertiesOpen: boolean;
  /**
   * Whether the editor is narrow enough that the panels are overlays rather
   * than columns. Written by the layout's ResizeObserver, read by the app-bar
   * buttons so opening one panel closes the other only when they would overlap.
   */
  isCompact: boolean;
};

export const usePanelsStore = create<PanelsStore>()(() => ({
  isPropertiesOpen: false,
  isCompact: false,
}));

export function setPropertiesOpen(isPropertiesOpen: boolean) {
  usePanelsStore.setState({ isPropertiesOpen });
}

export function setEditorCompact(isCompact: boolean) {
  usePanelsStore.setState({ isCompact });
}

export function resetPanels() {
  usePanelsStore.setState({ isPropertiesOpen: false });
}
