// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { SortMenu } from './sort-menu';

afterEach(cleanup);

describe('SortMenu', () => {
  it('opens a list of the orders, each a link, the current one marked', async () => {
    const user = userEvent.setup();
    render(<SortMenu sort="newest" hrefs={{ oldest: '/admin/cancellations', newest: '/admin/cancellations?sort=newest' }} />);
    await user.click(screen.getByRole('button', { name: 'מיון: החדשות קודם' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['הישנות קודם', 'החדשות קודם']);
    expect(items[0].getAttribute('href')).toBe('/admin/cancellations');
    expect(items[1].getAttribute('aria-current')).toBe('true');
  });
});
