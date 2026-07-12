import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/types';

// Server-only resolver for the public post-event thank-you page (`/ty/[token]`).
// Reuses the SAME opaque per-event `gift_link_token` as the gift landing page
// (documented reuse — the token is not bound to a purpose, just to the event)
// but drops everything gift-specific: no payment provider, no CTA. Mirrors
// `getGiftByToken`'s fail-closed gating (unknown/inactive token → null, caller
// renders one generic message, never revealing which case occurred).

type EventType = Database['public']['Enums']['event_type'];

export interface ThankyouView {
  id: string;
  name: string;
  event_type: EventType;
  event_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  celebrants: Json | null;
  invite_image_path: string | null;
}

/**
 * Resolve an active event by its gift token for the thank-you page, or null for
 * any failure (unknown token, non-active event) — the caller renders one
 * generic message, never revealing which case occurred.
 */
export async function getThankyouByToken(token: string): Promise<ThankyouView | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('events')
    .select(
      'id, name, event_type, event_date, venue_name, venue_address, celebrants, invite_image_path, status',
    )
    .eq('gift_link_token', token)
    .maybeSingle();

  if (error || !data) return null;
  // Only a PUBLISHED event circulates a thank-you page — fail-closed exactly
  // like the gift page and the RSVP RPC. No payment-link gate here (unlike
  // gift): a thank-you page has nothing to redirect to.
  if (data.status !== 'active') return null;

  return {
    id: data.id,
    name: data.name,
    event_type: data.event_type,
    event_date: data.event_date,
    venue_name: data.venue_name,
    venue_address: data.venue_address,
    celebrants: data.celebrants,
    invite_image_path: data.invite_image_path,
  };
}
