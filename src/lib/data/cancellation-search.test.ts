import { describe, expect, it } from 'vitest';

import { cancellationSearch } from './cancellation-search';

describe('cancellationSearch', () => {
  it.each([undefined, null, '', '   ', 'א'.repeat(81), ['CX-1']])('%j is no search', (raw) => {
    expect(cancellationSearch(raw)).toBeNull();
  });

  it('a full reference is matched as its stored code', () => {
    expect(cancellationSearch(' cx-7k4q-92xm ')).toEqual({ likeCode: '7K4Q-92XM', likeText: 'cx-7k4q-92xm' });
  });

  it('a habit "#" in front is ignored for the code', () => {
    expect(cancellationSearch('#7K4Q')?.likeCode).toBe('7K4Q');
  });

  it('an event name is kept as typed', () => {
    expect(cancellationSearch('חתונה')).toEqual({ likeCode: 'חתונה', likeText: 'חתונה' });
  });

  it('LIKE wildcards typed by staff match themselves', () => {
    expect(cancellationSearch('50%_off\\')).toEqual({ likeCode: '50\\%\\_OFF\\\\', likeText: '50\\%\\_off\\\\' });
  });
});
