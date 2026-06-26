import Link from 'next/link';

import { requireOwnedEvent } from '@/lib/data/events';
import { listCampaignTemplates } from '@/lib/data/campaigns';
import { countUniqueContactsForEvent } from '@/lib/data/contacts';
import { NewCampaignForm } from './new-campaign-form';

export default async function NewCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Ownership gate (404 otherwise) — the form's action re-checks server-side.
  const event = await requireOwnedEvent(id);
  const [templates, uniqueContacts] = await Promise.all([
    listCampaignTemplates(),
    countUniqueContactsForEvent(id),
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">קמפיין חדש</h1>
        <Link
          href={`/app/events/${id}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden="true">→</span>
          חזרה לאירוע
        </Link>
      </div>

      <p className="text-sm text-muted-foreground">
        אירוע: <strong>{event.name}</strong>. הגדירו את תנאי הקמפיין — תחויבו רק
        על אנשי קשר ייחודיים שהושגו (תגובת וואטסאפ אמיתית או מענה אנושי בשיחה), עד
        לתקרה.
      </p>

      <NewCampaignForm
        eventId={id}
        templates={templates}
        uniqueContacts={uniqueContacts}
      />
    </div>
  );
}
