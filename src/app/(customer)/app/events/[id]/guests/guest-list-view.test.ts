import { describe, expect, it } from 'vitest';

import { guestsView } from './guest-list-view';

describe('guestsView', () => {
  it('shows the onboarding screen only when the event has no guest rows at all', () => {
    expect(guestsView({ totalRows: 0, pageItems: 0, hasActiveFilters: false })).toBe(
      'onboarding',
    );
  });

  it('still shows onboarding when a filter is set but the event is genuinely empty', () => {
    // A stale ?status= in the URL must not downgrade a first-run event to the
    // dashed "no matches" box — there is nothing to un-filter.
    expect(guestsView({ totalRows: 0, pageItems: 0, hasActiveFilters: true })).toBe(
      'onboarding',
    );
  });

  it('never shows onboarding when a filter emptied a non-empty list', () => {
    // The regression this guards: hiding the search box behind an onboarding
    // screen would trap the owner behind the filter that emptied the list.
    expect(guestsView({ totalRows: 62, pageItems: 0, hasActiveFilters: true })).toBe(
      'no-matches',
    );
  });

  it('never shows onboarding on a page past the last one', () => {
    expect(guestsView({ totalRows: 62, pageItems: 0, hasActiveFilters: false })).toBe(
      'empty-page',
    );
  });

  it('shows the list whenever the current page has rows', () => {
    expect(guestsView({ totalRows: 62, pageItems: 25, hasActiveFilters: false })).toBe(
      'list',
    );
    expect(guestsView({ totalRows: 62, pageItems: 3, hasActiveFilters: true })).toBe(
      'list',
    );
  });

  it('treats a single guest as a populated list, not a first run', () => {
    expect(guestsView({ totalRows: 1, pageItems: 1, hasActiveFilters: false })).toBe(
      'list',
    );
  });
});
