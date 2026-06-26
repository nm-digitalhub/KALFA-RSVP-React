import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Subscribe to the viewport via useSyncExternalStore so we read external state
// without a synchronous setState inside an effect (React 19 / react-hooks rule).
// The server snapshot is `false`, so SSR renders the desktop layout.
function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
