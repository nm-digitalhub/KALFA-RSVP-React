// Vendored from ueberdosis/tiptap-ui-components (MIT, Copyright (c) 2025 Tiptap),
// apps/web/src/hooks/use-menu-navigation.ts on main, 2026-09-30. One change: the reset on a
// new query moved from an effect to React's "adjust state on prop change" pattern
// (react-hooks/set-state-in-effect); same behaviour, no cascading render.
// Additions: `tabBehavior` ("navigate", upstream's, is the default; "select"
// makes Tab pick the active item like Enter). The selection resets on EVERY query
// change — upstream skips an empty query, so going back to the bare trigger or
// reopening the menu kept the old row — and an index past the end of a shorter
// list falls back to the first row instead of pointing at nothing.
// Upstream: https://github.com/ueberdosis/tiptap-ui-components

"use client"

import * as React from "react"
import type { Editor } from "@tiptap/react"

type Orientation = "horizontal" | "vertical" | "both"

interface MenuNavigationOptions<T> {
  /**
   * The Tiptap editor instance, if using with a Tiptap editor.
   */
  editor?: Editor | null
  /**
   * Reference to the container element for handling keyboard events.
   */
  containerRef?: React.RefObject<HTMLElement | null>
  /**
   * Search query that affects the selected item.
   */
  query?: string
  /**
   * Array of items to navigate through.
   */
  items: T[]
  /**
   * Callback fired when an item is selected.
   */
  onSelect?: (item: T) => void
  /**
   * Callback fired when the menu should close.
   */
  onClose?: () => void
  /**
   * The navigation orientation of the menu.
   * @default "vertical"
   */
  orientation?: Orientation
  /**
   * Whether to automatically select the first item when the menu opens.
   * @default true
   */
  autoSelectFirstItem?: boolean
  /**
   * What Tab does while the menu has items: move the selection (upstream
   * behaviour) or pick the active item like Enter.
   * @default "navigate"
   */
  tabBehavior?: "navigate" | "select"
}

/**
 * Hook that implements keyboard navigation for dropdown menus and command palettes.
 *
 * Handles arrow keys, tab, home/end, enter for selection, and escape to close.
 * Works with both Tiptap editors and regular DOM elements.
 *
 * @param options - Configuration options for the menu navigation
 * @returns Object containing the selected index and a setter function
 */
export function useMenuNavigation<T>({
  editor,
  containerRef,
  query,
  items,
  onSelect,
  onClose,
  orientation = "vertical",
  autoSelectFirstItem = true,
  tabBehavior = "navigate",
}: MenuNavigationOptions<T>) {
  const initialIndex = autoSelectFirstItem ? 0 : -1
  const [selectedIndex, setSelectedIndex] = React.useState<number>(initialIndex)

  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevQuery, setPrevQuery] = React.useState(query)
  if (query !== prevQuery) {
    setPrevQuery(query)
    setSelectedIndex(initialIndex)
  }
  // Never an index outside the current list.
  const activeIndex = selectedIndex < items.length ? selectedIndex : initialIndex

  React.useEffect(() => {
    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      if (!items.length) return false

      const moveNext = () =>
        setSelectedIndex(activeIndex === -1 ? 0 : (activeIndex + 1) % items.length)

      const movePrev = () =>
        setSelectedIndex(
          activeIndex === -1 ? items.length - 1 : (activeIndex - 1 + items.length) % items.length
        )

      switch (event.key) {
        case "ArrowUp": {
          if (orientation === "horizontal") return false
          event.preventDefault()
          movePrev()
          return true
        }

        case "ArrowDown": {
          if (orientation === "horizontal") return false
          event.preventDefault()
          moveNext()
          return true
        }

        case "ArrowLeft": {
          if (orientation === "vertical") return false
          event.preventDefault()
          movePrev()
          return true
        }

        case "ArrowRight": {
          if (orientation === "vertical") return false
          event.preventDefault()
          moveNext()
          return true
        }

        case "Tab": {
          if (tabBehavior === "select") {
            if (event.shiftKey || activeIndex === -1 || !items[activeIndex]) return false
            event.preventDefault()
            onSelect?.(items[activeIndex])
            return true
          }
          event.preventDefault()
          if (event.shiftKey) {
            movePrev()
          } else {
            moveNext()
          }
          return true
        }

        case "Home": {
          event.preventDefault()
          setSelectedIndex(0)
          return true
        }

        case "End": {
          event.preventDefault()
          setSelectedIndex(items.length - 1)
          return true
        }

        case "Enter": {
          if (event.isComposing) return false
          event.preventDefault()
          if (activeIndex !== -1 && items[activeIndex]) {
            onSelect?.(items[activeIndex])
          }
          return true
        }

        case "Escape": {
          event.preventDefault()
          onClose?.()
          return true
        }

        default:
          return false
      }
    }

    let targetElement: HTMLElement | null = null

    if (editor) {
      targetElement = editor.view.dom
    } else if (containerRef?.current) {
      targetElement = containerRef.current
    }

    if (targetElement) {
      targetElement.addEventListener("keydown", handleKeyboardNavigation, true)

      return () => {
        targetElement?.removeEventListener(
          "keydown",
          handleKeyboardNavigation,
          true
        )
      }
    }

    return undefined
  }, [
    editor,
    containerRef,
    items,
    activeIndex,
    onSelect,
    onClose,
    orientation,
    tabBehavior,
  ])

  return {
    selectedIndex: items.length ? activeIndex : undefined,
    setSelectedIndex,
  }
}
