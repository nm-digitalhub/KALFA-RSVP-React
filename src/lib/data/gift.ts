import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/types';

// Server-only resolver for the public gift landing page (`/g/[token]`). The
// opaque per-event `gift_link_token` IS the capability — no session. Mirrors the
// `get_rsvp_by_token` privacy stance: fail-closed gating, and the raw
// `gift_payment_url` NEVER leaves the server (only the coarse provider tag does;
// the redirect itself happens in `/g/[token]/go`).

type EventType = Database['public']['Enums']['event_type'];
export type GiftProvider = 'bit' | 'paybox' | 'other';

export interface GiftView {
  id: string;
  name: string;
  event_type: EventType;
  event_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  celebrants: Json | null;
  invite_image_path: string | null;
  giftProvider: GiftProvider;
}

// Same derivation as the get_rsvp_by_token RPC — icon selection only.
function deriveProvider(url: string): GiftProvider {
  const u = url.toLowerCase();
  if (u.includes('bitpay.co.il') || u.includes('//bit.')) return 'bit';
  if (u.includes('paybox')) return 'paybox';
  return 'other';
}

/**
 * Resolve an active event by its gift token for public display, or null for any
 * failure (unknown token, non-active event, missing/invalid payment link) — the
 * caller renders one generic message, never revealing which case occurred.
 */
export async function getGiftByToken(token: string): Promise<GiftView | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('events')
    .select(
      'id, name, event_type, event_date, venue_name, venue_address, celebrants, invite_image_path, status, gift_payment_url',
    )
    .eq('gift_link_token', token)
    .maybeSingle();

  if (error || !data) return null;

  const url = typeof data.gift_payment_url === 'string' ? data.gift_payment_url.trim() : '';
  // Only a PUBLISHED event with a valid https payment link circulates a gift
  // page — fail-closed exactly like the redirect route and the RSVP RPC.
  if (data.status !== 'active' || !/^https:\/\//i.test(url)) return null;

  return {
    id: data.id,
    name: data.name,
    event_type: data.event_type,
    event_date: data.event_date,
    venue_name: data.venue_name,
    venue_address: data.venue_address,
    celebrants: data.celebrants,
    invite_image_path: data.invite_image_path,
    giftProvider: deriveProvider(url),
  };
}
