// Which of the guests page's four screens to render. Pure and isomorphic, kept
// out of page.tsx on the setup-steps.ts precedent ("kept out of the component so
// the whole decision table is unit-tested").
//
// The distinction this exists to protect: "the screen is empty" has three
// causes, and only ONE of them means the owner has no guests.
//   - the event genuinely has none            → onboarding
//   - a filter matched nothing                → the filters MUST stay on screen,
//                                               or the owner cannot clear the
//                                               filter that emptied the list
//   - the page is past the last one           → same, minus the filter copy
// `pageItems === 0` alone cannot tell them apart; `totalRows` (event-wide,
// filter-independent) can.
export type GuestsView = 'onboarding' | 'no-matches' | 'empty-page' | 'list';

export interface GuestsViewInput {
  /** Guest ROWS in the whole event — `getGuestTotals().rows`, never the filtered count. */
  totalRows: number;
  /** Rows returned for the current page + filters — `listGuests().items.length`. */
  pageItems: number;
  hasActiveFilters: boolean;
}

export function guestsView({
  totalRows,
  pageItems,
  hasActiveFilters,
}: GuestsViewInput): GuestsView {
  if (totalRows === 0) return 'onboarding';
  if (pageItems > 0) return 'list';
  return hasActiveFilters ? 'no-matches' : 'empty-page';
}
