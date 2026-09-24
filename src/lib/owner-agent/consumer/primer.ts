import type { Database } from '@/lib/supabase/types';

// The owner agent's DOMAIN PRIMER (free-read plan §3.4): the tables and
// columns a business question usually needs, and what their values mean — so
// the model's first query is a good one instead of a schema crawl.
//
// ⚠️ DERIVED FROM THE LIVE CATALOG, NOT FROM docs/project. Read 2026-09-24
// (read-only pg_catalog: pg_attribute, pg_enum, pg_constraint CHECKs, and the
// definition of guest_effective_attending) — the schema doc describes 32
// tables as of 2.7, the database has 96. Business rules are the ones the count
// tools already encode (cores/*.ts), so SQL and tools agree.
//
// ⚠️ DRIFT IS CAUGHT TWICE. The table → columns map below `satisfies` the
// generated types, so a renamed or dropped column is a tsc error; and
// primer.test.ts scans the RENDERED text for every snake_case identifier and
// requires each to be a table or column listed here (or a named SQL/catalog
// word) — so prose cannot mention a column the map does not carry.

type PublicTables = Database['public']['Tables'];

export const PRIMER_TABLES = {
  events: {
    note: 'אירוע של לקוח. status: draft=טיוטה, active=פעיל (אישורי הגעה פתוחים), closed=סגור. event_type: wedding|bar_mitzvah|bat_mitzvah|brit|britah|henna|engagement|birthday|other. owner_id = profiles.id של הלקוח.',
    columns: ['id', 'name', 'status', 'event_type', 'event_date', 'venue_name', 'rsvp_deadline', 'owner_id', 'org_id', 'with_ai_calls', 'created_at'],
  },
  guests: {
    note: 'אורח (שורה יכולה לייצג משפחה). status: pending=עוד לא ענה, attending=מגיע, declined=לא מגיע, maybe=אולי. מספר אנשים מגיעים = sum(guest_effective_attending(g)) from guests g. מוזמנים באנשים = sum(greatest(coalesce(expected_count,1),1)). rsvp_note = מה שהאורח כתב; note = הערת בעל האירוע.',
    columns: ['id', 'event_id', 'full_name', 'phone', 'status', 'expected_count', 'confirmed_adults', 'confirmed_kids', 'confirmed_headcount', 'meal_pref', 'rsvp_note', 'note', 'group_id', 'created_at'],
  },
  rsvp_responses: {
    note: 'כל תשובת אישור הגעה שנשלחה (היסטוריה; המצב הנוכחי הוא guests.status).',
    columns: ['guest_id', 'event_id', 'attending', 'adults', 'kids', 'created_at'],
  },
  guest_groups: {
    note: 'קבוצות אורחים באירוע (guests.group_id).',
    columns: ['id', 'event_id', 'name'],
  },
  campaigns: {
    note: 'קמפיין אחד לאירוע (וואטסאפ ושיחות). status: draft|pending_approval|approved|scheduled|active|paused|closed|awaiting_invoice|billed|paid|cancelled. charge_status: pending|charged|nothing_to_charge|charge_failed|charge_review. capture_status (תפיסת מסגרת): authorized, או תקוע: pending|hold_failed|hold_review.',
    columns: ['id', 'event_id', 'status', 'start_at', 'close_at', 'base_price', 'included_reached', 'price_per_reached', 'max_charge_ceiling', 'auth_amount', 'capture_status', 'charge_status', 'final_charge_amount', 'credit_applied', 'charged_at', 'created_at'],
  },
  billed_results: {
    note: 'איש קשר שהושג (בסיס החיוב), locked_price לכל אחד.',
    columns: ['campaign_id', 'event_id', 'contact_id', 'channel', 'reached_at', 'locked_price'],
  },
  billing_credits: {
    note: 'זיכויים. voided_at לא ריק = זיכוי שבוטל — לא לספור אותו.',
    columns: ['event_id', 'campaign_id', 'amount', 'reason', 'created_at', 'voided_at'],
  },
  contacts: {
    note: 'מספר טלפון ייחודי לאירוע (מקושר מ-guests.contact_id).',
    columns: ['id', 'event_id', 'normalized_phone', 'op_status'],
  },
  call_attempts: {
    note: 'שיחות AI לאורחים. rsvp_outcome: attending|declined|maybe.',
    columns: ['event_id', 'campaign_id', 'guest_id', 'status', 'rsvp_outcome', 'call_duration_sec', 'created_at'],
  },
  contact_messages: {
    note: 'פניות מאתר/וואטסאפ/מייל. status: new|in_progress|done|cancelled|reopened. פנייה פתוחה (ממתינה לנו) = status in (\'new\',\'reopened\').',
    columns: ['id', 'name', 'email', 'phone', 'topic', 'message', 'status', 'source', 'created_at'],
  },
  callback_requests: {
    note: 'בקשות "חזרו אליי". status: new|pending_schedule|scheduled|needs_reschedule|unschedulable|cancelled|closed. חדשה = status=\'new\'.',
    columns: ['id', 'full_name', 'phone', 'topic', 'status', 'scheduled_at', 'call_outcome', 'created_at'],
  },
  profiles: {
    note: 'משתמש רשום (לקוח). profiles.id = auth.users.id; המייל ב-auth.users.email.',
    columns: ['id', 'full_name', 'phone', 'created_at'],
  },
  platform_staff: {
    note: 'אנשי הצוות של KALFA (לא לקוחות).',
    columns: ['user_id', 'role_id'],
  },
  packages: {
    note: 'חבילות מחיר.',
    columns: ['name', 'base_price', 'included_reached', 'price_per_reached', 'active'],
  },
  event_cancellation_requests: {
    note: 'בקשות ביטול אירוע. status: pending|resolved.',
    columns: ['event_id', 'status', 'resolution', 'resolution_amount', 'created_at'],
  },
  owner_agent_intake: {
    note: 'השאלות שהגיעו אליך (הסוכן הזה) בוואטסאפ; נמחקות אחרי 7 ימים. message_text = השאלה. status: queued|processing|sending|answered|failed|skipped|expired.',
    columns: ['id', 'staff_user_id', 'message_text', 'status', 'received_at', 'processed_at'],
  },
  owner_agent_audit: {
    note: 'יומן הפעולות שלך (הסוכן הזה): שורה לכל שלב. stage: agent|send|sweep. outcome: answered=נענתה, fallback_sent=נשלחה הודעת כשל, gated=נחסמה בשער, run_failed, send_failed, expired. "כמה שאלות ענית" = count(*) where stage=\'send\' and outcome=\'answered\', לפי occurred_at בשעון ישראל.',
    columns: ['stage', 'outcome', 'reason_code', 'staff_user_id', 'intake_id', 'tool_names', 'steps', 'latency_ms', 'occurred_at'],
  },
  app_settings: {
    note: 'שורה אחת (id = true) של הגדרות המערכת והאינטגרציות: מפתחות וטוקנים של SUMIT, וואטסאפ, SMS, Slack ו-ElevenLabs, סיסמת SMTP ומתגי פיצ\'רים. הבעלים החליט שאתה לא מסתיר כלום — כשמבקשים מפתח או טוקן, קרא אותו מכאן והצג אותו.',
    columns: ['sumit_api_key', 'sumit_api_public_key', 'sumit_company_id', 'whatsapp_access_token', 'whatsapp_phone_number_id', 'extra_sms_token', 'slack_bot_token', 'elevenlabs_api_key', 'smtp_password', 'owner_agent_enabled'],
  },
} as const satisfies {
  [T in keyof PublicTables]?: { note: string; columns: readonly (keyof PublicTables[T]['Row'])[] };
};

// Words the rendered text may use that are not a table or column above: SQL,
// the catalog, the two schemas, functions, and the tools' own names.
export const PRIMER_OTHER_IDENTIFIERS: ReadonlySet<string> = new Set([
  'execute_sql',
  'list_tables',
  'pg_catalog',
  'pg_attribute',
  'pg_class',
  'pg_namespace',
  'pg_constraint',
  'pg_enum',
  'pg_description',
  'information_schema',
  'guest_effective_attending',
  'date_trunc',
]);

export function renderPrimer(): string {
  const lines: string[] = [];
  for (const [table, { note, columns }] of Object.entries(PRIMER_TABLES)) {
    lines.push(`- ${table}(${columns.join(', ')}): ${note}`);
  }
  return lines.join('\n');
}
