import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { FaqItemRow } from '@/lib/faq/page-model';

// PUBLIC reader for the /faq page. Uses the normal cookie-session SSR client
// (not service-role) deliberately: `faq_items_public_read` (RLS,
// anon+authenticated, `published = true`) is what actually gates this read —
// routing it through the service-role client would bypass the very policy
// this table exists to exercise. Works identically for a signed-out visitor
// (PostgREST runs as `anon`) and a signed-in one.
//
// `.eq('published', true)` is redundant with the RLS policy but kept
// explicit: it documents the intent at the call site instead of leaving it
// implicit in a policy a reader of this file may not have open, and it means
// this function behaves the same even if ever called with an elevated
// client by mistake.
export async function getPublishedFaqItems(): Promise<FaqItemRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('faq_items')
    .select('item_key, category, question, answer, sort_order')
    .eq('published', true)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw new Error('טעינת השאלות הנפוצות נכשלה');
  return (data ?? []) as FaqItemRow[];
}
