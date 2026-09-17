import { Validator } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';

import { RSVP_STATUSES } from '@/lib/constants';
import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';

import { normalizeLegacyProperties } from './normalize-legacy-properties';

const node = (type: string, properties: Record<string, unknown>) => ({
  id: 'n1',
  position: { x: 0, y: 0 },
  data: { type, properties },
});

describe('normalizeLegacyProperties', () => {

  it('repairs the pre-lifecycle RSVP status collision', () => {
    for (const status of RSVP_STATUSES) {
      const legacy = node('action.update_guest_status', { status });

      const [repaired] = normalizeLegacyProperties([legacy], PALETTE_ITEMS);

      expect(repaired!.data.properties).toMatchObject({
        status: 'active',
        rsvpStatus: status,
      });
    }
  });

  it('repairs legacy RSVP status into a shape accepted by the current schema', () => {
    const schema = PALETTE_ITEMS.find(
      (item) => item.type === 'action.update_guest_status',
    )!.schema;

    for (const status of RSVP_STATUSES) {
      const [repaired] = normalizeLegacyProperties(
        [
          node('action.update_guest_status', {
            label: 'עדכון סטטוס',
            description: 'בדיקה',
            status,
          }),
        ],
        PALETTE_ITEMS,
      );

      expect(
        new Validator(schema as object).validate(
          repaired!.data.properties,
        ).valid,
      ).toBe(true);
    }
  });

  it('does not reinterpret SDK lifecycle status as RSVP status', () => {
    for (const status of ['active', 'draft', 'disabled']) {
      const current = node('action.update_guest_status', { status });

      expect(normalizeLegacyProperties([current], PALETTE_ITEMS)[0]).toBe(current);
    }
  });

  it('does not overwrite an explicit current rsvpStatus', () => {
    const current = node('action.update_guest_status', {
      status: 'disabled',
      rsvpStatus: 'declined',
    });

    expect(normalizeLegacyProperties([current], PALETTE_ITEMS)[0]).toBe(current);
  });

  it('does not apply the status alias to another node type', () => {
    const other = node('action.notify_team', { status: 'attending' });

    expect(normalizeLegacyProperties([other], PALETTE_ITEMS)[0]).toBe(other);
  });


  it('⚠️ repairs the exact shape stored on the live ARMED workflow', () => {
    // "קליטת רשימת אורחים מוואטסאפ", is_active = true, stored with bare strings.
    // Its stored `errors` reads: Instance type "string" is invalid. Expected
    // "object" — an armed workflow marked invalid while running correctly,
    // because `matchesKind` accepts both shapes and the schema does not.
    const [repaired] = normalizeLegacyProperties(
      [node('trigger.whatsapp_inbound', { label: 't', messageKinds: ['text', 'button'] })],
      PALETTE_ITEMS,
    );

    expect(repaired!.data.properties.messageKinds).toEqual([
      { value: 'text' },
      { value: 'button' },
    ]);
  });

  it('⚠️ the repaired value passes the schema the editor validates against', () => {
    // The whole point, asserted against the real schema rather than by eye.
    const schema = PALETTE_ITEMS.find((i) => i.type === 'trigger.whatsapp_inbound')!.schema;

    const before = { label: 'ט', description: 'ת', messageKinds: ['text'] };
    expect(new Validator(schema as object).validate(before).valid).toBe(false);

    const [repaired] = normalizeLegacyProperties(
      [node('trigger.whatsapp_inbound', before)],
      PALETTE_ITEMS,
    );
    expect(
      new Validator(schema as object).validate(repaired!.data.properties).valid,
    ).toBe(true);
  });

  it('leaves the current object shape untouched, by reference', () => {
    const current = node('trigger.whatsapp_inbound', {
      messageKinds: [{ value: 'text' }],
    });
    expect(normalizeLegacyProperties([current], PALETTE_ITEMS)[0]).toBe(current);
  });

  it('repairs a mixed array without disturbing the objects in it', () => {
    const [repaired] = normalizeLegacyProperties(
      [node('trigger.whatsapp_inbound', { messageKinds: [{ value: 'text' }, 'button'] })],
      PALETTE_ITEMS,
    );
    expect(repaired!.data.properties.messageKinds).toEqual([
      { value: 'text' },
      { value: 'button' },
    ]);
  });

  it('covers every array-of-objects field, not a hardcoded list', () => {
    // `days` on the schedule trigger is the second one, and it was never named
    // in this module — the fields come from each node type's own schema.
    const [repaired] = normalizeLegacyProperties(
      [node('trigger.schedule', { time: '09:00', days: ['sunday', 'monday'] })],
      PALETTE_ITEMS,
    );
    expect(repaired!.data.properties.days).toEqual([
      { value: 'sunday' },
      { value: 'monday' },
    ]);
  });

  it('⚠️ a numeric STRING becomes a number — the second schema-stricter case', () => {
    // `maxGuests: '25'` runs correctly: the handler reads `Number(rawMax)` and
    // `findArmBlockers` coerces the same way. Only the schema objects, because
    // it declares `type: 'number'`. A working node wearing an error badge.
    const [repaired] = normalizeLegacyProperties(
      [node('action.start_for_each_guest', { maxGuests: '25' })],
      PALETTE_ITEMS,
    );
    expect(repaired!.data.properties.maxGuests).toBe(25);
  });

  it('⚠️ the repaired number passes the schema, and the string did not', () => {
    const schema = PALETTE_ITEMS.find((i) => i.type === 'action.start_for_each_guest')!.schema;
    const check = (v: unknown) =>
      new Validator(schema as object).validate({
        label: 'לכל אורח',
        description: 'ת',
        targetWorkflowId: 'wf-child',
        maxGuests: v,
      }).valid;

    expect(check('25')).toBe(false);
    expect(check(25)).toBe(true);
  });

  it('leaves a blank string alone — the required check is what should speak', () => {
    const blank = node('action.start_for_each_guest', { maxGuests: '' });
    expect(normalizeLegacyProperties([blank], PALETTE_ITEMS)[0]).toBe(blank);
  });

  it('leaves a string that is not entirely a number — reading 25 out of it would invent intent', () => {
    const messy = node('action.start_for_each_guest', { maxGuests: '25 guests' });
    expect(normalizeLegacyProperties([messy], PALETTE_ITEMS)[0]).toBe(messy);
  });

  it('leaves a value that is already a number, by reference', () => {
    const fine = node('action.start_for_each_guest', { maxGuests: 25 });
    expect(normalizeLegacyProperties([fine], PALETTE_ITEMS)[0]).toBe(fine);
  });

  it('leaves a node type the palette does not know', () => {
    const unknown = node('action.from_the_future', { messageKinds: ['text'] });
    expect(normalizeLegacyProperties([unknown], PALETTE_ITEMS)[0]).toBe(unknown);
  });

  it('leaves a non-array value alone rather than guessing at it', () => {
    const odd = node('trigger.whatsapp_inbound', { messageKinds: 'text' });
    expect(normalizeLegacyProperties([odd], PALETTE_ITEMS)[0]).toBe(odd);
  });
  it('is idempotent after repairing legacy RSVP status', () => {
    const legacy = node('action.update_guest_status', { status: 'attending' });
    const [once] = normalizeLegacyProperties([legacy], PALETTE_ITEMS);
    const [twice] = normalizeLegacyProperties([once!], PALETTE_ITEMS);
    expect(once).not.toBe(legacy);
    expect(twice).toBe(once);
  });

  it('is idempotent after normalizing a numeric string', () => {
    const legacy = node('action.start_for_each_guest', { maxGuests: '25' });
    const [once] = normalizeLegacyProperties([legacy], PALETTE_ITEMS);
    const [twice] = normalizeLegacyProperties([once!], PALETTE_ITEMS);
    expect(once).not.toBe(legacy);
    expect(twice).toBe(once);
  });


  // -------------------------------------------------------------------------
  // The Microsoft mail backfill, and the boundary that keeps it narrow.
  // -------------------------------------------------------------------------

  it('backfills the Microsoft mail options a diagram saved before they existed', () => {
    const legacy = node('action.microsoft_send_email', {
      connectionId: 'c1', to: 'a@x.com', subject: 'נושא', body: 'תוכן',
    });
    const [out] = normalizeLegacyProperties([legacy], PALETTE_ITEMS);

    expect(out!.data.properties).toMatchObject({
      contentType: 'Text',
      importance: 'normal',
      saveToSentItems: true,
    });
  });

  it('⚠️ shows what the runtime already does, and nothing more', () => {
    // Each backfilled value is the fallback `steps/index.ts` applies when the
    // field is absent, so this changes what the panel SHOWS and never what the
    // run DOES. If the handler's defaults ever change, these must change with
    // them or the panel starts lying again — in the other direction.
    const [out] = normalizeLegacyProperties(
      [node('action.microsoft_send_email', { connectionId: 'c1', to: 'a@x.com', subject: 's', body: 'b' })],
      PALETTE_ITEMS,
    );
    const p = out!.data.properties as Record<string, unknown>;

    expect(p.contentType).toBe('Text');       // transport: record.contentType === 'HTML' ? 'HTML' : 'Text'
    expect(p.importance).toBe('normal');      // transport: 'high' | 'low' ? … : 'normal'
    expect(p.saveToSentItems).toBe(true);     // handler: typeof … === 'boolean' ? … : true
  });

  it('never overwrites a value the owner chose', () => {
    const chosen = node('action.microsoft_send_email', {
      connectionId: 'c1', to: 'a@x.com', subject: 's', body: 'b',
      contentType: 'HTML', importance: 'high', saveToSentItems: false,
    });
    const [out] = normalizeLegacyProperties([chosen], PALETTE_ITEMS);

    // Nothing to fill → the same object back, by identity.
    expect(out).toBe(chosen);
  });

  it('⚠️ leaves action.update_guest_status without an rsvpStatus ALONE', () => {
    // THE BOUNDARY THIS FILE'S NARROWNESS EXISTS FOR, pinned so a future tidy-up
    // cannot widen the backfill into "fill every missing property".
    //
    // Live data was checked before the Microsoft branch was written: two stored
    // nodes of this type carry no `rsvpStatus`. A default there would invent an
    // RSVP decision the owner never made — and it would reach the row on its
    // own, because the SDK auto-saves on `beforeunload` with no condition.
    //
    // The legacy `status` repair above is a different thing: it MOVES a value
    // the owner did choose out of a key the SDK later claimed. It never invents.
    const bare = node('action.update_guest_status', { label: 'עדכון' });
    const [out] = normalizeLegacyProperties([bare], PALETTE_ITEMS);

    expect(out).toBe(bare);
    expect(Object.hasOwn(out!.data.properties, 'rsvpStatus')).toBe(false);
  });

  it('touches no other node type', () => {
    // Every type in the palette except the Microsoft one, with only the two
    // identity fields set. None may gain a property.
    for (const item of PALETTE_ITEMS) {
      if (item.type === 'action.microsoft_send_email') continue;
      const bare = node(item.type, { label: 'x', description: 'y' });
      const [out] = normalizeLegacyProperties([bare], PALETTE_ITEMS);
      expect(Object.keys(out!.data.properties), item.type).toEqual(['label', 'description']);
    }
  });

  it('is idempotent after the Microsoft backfill', () => {
    const legacy = node('action.microsoft_send_email', {
      connectionId: 'c1', to: 'a@x.com', subject: 's', body: 'b',
    });
    const [once] = normalizeLegacyProperties([legacy], PALETTE_ITEMS);
    const [twice] = normalizeLegacyProperties([once!], PALETTE_ITEMS);

    expect(once).not.toBe(legacy);
    expect(twice).toBe(once);
  });

});
