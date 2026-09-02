import { describe, expect, it } from 'vitest';

import { buildSelectedPlace } from '@/components/places-autocomplete';

// The one pure seam of the autocomplete: how a chosen Google suggestion becomes
// the two form values (venue name + address). Everything else in the component
// is browser + Google runtime and is verified in the browser.
describe('buildSelectedPlace', () => {
  it('prefers the fetched place details: displayName → name, formattedAddress → address', () => {
    expect(
      buildSelectedPlace({
        displayName: 'אולמי פביליון',
        formattedAddress: 'הרצל 12, ראשון לציון',
        lat: 31.97,
        lng: 34.8,
        placeId: 'ChIJ123',
        mainText: 'אולמי פביליון',
        fullText: 'אולמי פביליון, הרצל 12, ראשון לציון',
      }),
    ).toEqual({
      name: 'אולמי פביליון',
      address: 'הרצל 12, ראשון לציון',
      lat: 31.97,
      lng: 34.8,
      placeId: 'ChIJ123',
    });
  });

  it('falls back to the prediction texts when details are missing (fetchFields failed)', () => {
    expect(
      buildSelectedPlace({
        mainText: 'אולמי פביליון',
        fullText: 'אולמי פביליון, הרצל 12, ראשון לציון',
        placeId: 'ChIJ123',
      }),
    ).toEqual({
      name: 'אולמי פביליון',
      address: 'אולמי פביליון, הרצל 12, ראשון לציון',
      lat: null,
      lng: null,
      placeId: 'ChIJ123',
    });
  });

  it('uses the full prediction text as the name when there is no main text either', () => {
    const r = buildSelectedPlace({ fullText: 'הרצל 12, ראשון לציון' });
    expect(r.name).toBe('הרצל 12, ראשון לציון');
    expect(r.address).toBe('הרצל 12, ראשון לציון');
    expect(r.placeId).toBeNull();
  });

  it('treats empty strings as missing and trims whitespace', () => {
    expect(
      buildSelectedPlace({
        displayName: '',
        formattedAddress: '  רחוב 1, תל אביב  ',
        mainText: ' בית הכנסת הגדול ',
        fullText: 'x',
      }),
    ).toMatchObject({ name: 'בית הכנסת הגדול', address: 'רחוב 1, תל אביב' });
  });
});
