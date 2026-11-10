import { unstable_rethrow } from 'next/navigation';

import { buildContactsForEvent, reconcileCampaignSetForContact } from '@/lib/data/contacts';

// The step both guest imports (the file import and the WhatsApp one) run after
// their guests are committed. Not a Server Action: the importing action has
// already authorized the caller for this event before it gets here.
//
// Materializes the contacts table (billing source-of-truth) from the imported
// guests — the bulk path, so a one-time whole-event rebuild is appropriate — and
// admits each contact into an already-operational campaign's authorized set;
// otherwise a bulk-imported contact would be silently excluded forever.
// reconcileCampaignSetForContact is itself best-effort/never-throws (a cheap
// no-op when there is no operational campaign or the contact is already a
// member), so the loop only ever helps an eligible contact get admitted (a
// campaign with a package quota admits only until it is full).
//
// Best-effort as a whole: the guests are already committed, so a failure here
// must not report the import as failed. It is logged — the event id and the
// error message only, no guest data — so a failed rebuild or a missed admission
// is auditable; the worker's top-up repairs it.
export async function admitImportedContacts(eventId: string): Promise<void> {
  try {
    const { contactIds } = await buildContactsForEvent(eventId);
    for (const contactId of contactIds) {
      await reconcileCampaignSetForContact(eventId, 'add', contactId);
    }
  } catch (err) {
    unstable_rethrow(err);
    console.error(
      `[contacts] post-import contacts rebuild failed (event=${eventId}): ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    );
  }
}
