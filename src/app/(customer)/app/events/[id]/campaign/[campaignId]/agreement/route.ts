import { requireUser } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { downloadLegalDoc } from '@/lib/storage/legal-docs';

// Authenticated download of the signed-agreement PDF (owner-only). The signed
// agreement is emailed as a LINK to this route (not an attachment), so it isn't
// flagged by recipient attachment scanners. The proxy gates /app; we also verify
// ownership here and stream the private-bucket PDF via the service-role client.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const { id, campaignId } = await params;
  const user = await requireUser();
  const admin = createAdminClient();

  const { data: event } = await admin
    .from('events')
    .select('id, owner_id')
    .eq('id', id)
    .maybeSingle();
  if (!event || event.owner_id !== user.id) {
    return new Response('Not found', { status: 404 });
  }

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, event_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (!campaign || campaign.event_id !== id) {
    return new Response('Not found', { status: 404 });
  }

  const { data: agreement } = await admin
    .from('signed_agreements')
    .select('pdf_ref')
    .eq('campaign_id', campaignId)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!agreement?.pdf_ref) {
    return new Response('Not found', { status: 404 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await downloadLegalDoc(agreement.pdf_ref);
  } catch {
    return new Response('Not found', { status: 404 });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="KALFA-agreement.pdf"',
      'Cache-Control': 'private, no-store',
    },
  });
}
