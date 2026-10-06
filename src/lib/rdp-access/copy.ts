import { RDP_FILE_MIN_INTERVAL_SECONDS, RDP_REQUESTS_PER_HOUR, RDP_REQUEST_TTL_MINUTES } from './policy';
import type { RdpDisplayStatus } from './status';

// Every sentence of the remote-desktop screens that is not layout, kept apart from the logic so the screens can
// be translated later (Hebrew first; English and French follow). Nothing here names a database, a gateway answer
// or a secret: the screens show these fixed sentences and nothing the server said.

// ── Server Action refusals ───────────────────────────────────────────────────────────────────────

export type RequestRefusal =
  | 'already_pending'
  | 'has_active_grant'
  | 'rate_limited'
  | 'not_allowed'
  | 'invalid_reason'
  | 'invalid_minutes'
  | 'busy'
  | 'unexpected';

export const REQUEST_REFUSAL_TEXT: Record<RequestRefusal, string> = {
  already_pending: 'כבר יש לכם בקשה ממתינה או גישה פעילה. אין צורך לשלוח עוד אחת.',
  has_active_grant: 'כבר יש לכם בקשה ממתינה או גישה פעילה. אין צורך לשלוח עוד אחת.',
  rate_limited: `שלחתם ${RDP_REQUESTS_PER_HOUR} בקשות בשעה האחרונה. נסו שוב מאוחר יותר.`,
  not_allowed: 'אין לכם הרשאה לבקש גישה לשולחן העבודה.',
  invalid_reason: 'מטרת הגישה אינה תקינה. בדקו ושלחו שוב.',
  invalid_minutes: 'יש לבחור משך גישה מהרשימה.',
  busy: 'המערכת עסוקה כרגע. נסו שוב בעוד רגע.',
  unexpected: 'לא הצלחנו לשלוח את הבקשה. נסו שוב.',
};

export const TOO_MANY_ATTEMPTS_TEXT = 'ניסיתם הרבה פעמים. נסו שוב בעוד דקה.';
export const CANCEL_GONE_TEXT = 'הבקשה כבר אינה ממתינה. הדף התעדכן.';
export const END_GONE_TEXT = 'אין כרגע גישה פעילה. הדף התעדכן.';
export const GENERIC_FAILURE_TEXT = 'הפעולה לא הושלמה. נסו שוב.';

// ── Download refusals (the codes the file route answers with) ─────────────────────────────────────

export function downloadFailureText(code: string | null, maxFiles: number): string {
  switch (code) {
    case 'too_soon':
      return `אפשר להוריד קובץ חדש כל ${RDP_FILE_MIN_INTERVAL_SECONDS} שניות. נסו שוב בעוד רגע.`;
    case 'file_limit':
      return `הגעתם למכסת ההורדות של הגישה הזו (${maxFiles}). לחיבור נוסף צריך בקשה חדשה.`;
    case 'no_active_grant':
      return 'אין כרגע גישה פעילה. שלחו בקשה חדשה.';
    case 'gateway_unavailable':
      return 'שער ההתחברות אינו זמין כרגע. פנו לבעלים.';
    case 'rate_limited':
      return TOO_MANY_ATTEMPTS_TEXT;
    case 'unauthorized':
    case 'forbidden':
    case 'not_allowed':
      return 'אין לכם הרשאה להוריד את הקובץ. התחברו מחדש או פנו לבעלים.';
    case 'no_client_ip':
      return 'לא הצלחנו לזהות את הכתובת שלכם. פנו לבעלים.';
    default:
      return 'לא הצלחנו להכין את הקובץ. נסו שוב.';
  }
}

// ── Duration labels ──────────────────────────────────────────────────────────────────────────────

/** 30 → "30 דקות", 60 → "שעה", 120 → "שעתיים", 240 → "4 שעות", 90 → "שעה ו-30 דקות". */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const head = hours === 1 ? 'שעה' : hours === 2 ? 'שעתיים' : `${hours} שעות`;
  return rest === 0 ? head : `${head} ו-${rest} דקות`;
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────

export const PAGE_TITLE = 'גישה לשולחן עבודה';

export const TRACK_STATIONS = [
  { id: 'request', label: 'בקשה' },
  { id: 'approval', label: 'אישור הבעלים' },
  { id: 'file', label: 'קובץ חיבור' },
  { id: 'connected', label: 'מחובר' },
] as const;
export type TrackStationId = (typeof TRACK_STATIONS)[number]['id'];

export const FORM_COPY = {
  reasonLabel: 'למה צריך גישה?',
  reasonHelp: 'בין 10 ל-500 תווים. בלי סיסמאות ומפתחות.',
  reasonPlaceholder: 'למשל: החלפת מפתח בשרת ובדיקת הלוגים של ה-worker',
  durationLabel: 'כמה זמן?',
  submit: 'שליחה לאישור',
  approvalWindow: `הבעלים מקבל התראה ומחליט. הבקשה תקפה ${RDP_REQUEST_TTL_MINUTES} דקות.`,
} as const;

export const PENDING_COPY = {
  title: 'ממתין להחלטת הבעלים',
  badge: 'ממתין לאישור',
  timerHint: 'עד שהבקשה פגה',
  liveHint: 'הדף מתעדכן לבד כשהבעלים מחליט',
  cancel: 'ביטול בקשה',
  purpose: 'מטרה',
  asked: 'משך מבוקש',
  sent: 'נשלחה',
  dialog: {
    title: 'לעצור את הבקשה?',
    body: 'הבעלים עדיין לא ענה. אחרי העצירה אין יותר המתנה, ותוכלו לשלוח בקשה חדשה בכל רגע.',
    validFor: 'הבקשה בתוקף עוד',
    keep: 'להמשיך להמתין',
    confirm: 'כן, לעצור את הבקשה',
    stoppedAt: 'המסלול נעצר בתחנה 2 מתוך 4',
  },
} as const;

export const ACTIVE_COPY = {
  title: 'גישה פעילה',
  approvedBy: 'אושר על ידי הבעלים',
  remaining: 'זמן שנותר',
  validUntil: 'בתוקף עד',
  downloads: 'הורדות',
  purpose: 'מטרה',
  download: 'הורדת קובץ חיבור',
  downloading: 'מכין קובץ…',
  fileValidity: 'הקובץ תקף 5 דקות מההורדה',
  fileReady: 'הקובץ ירד. פתחו אותו עכשיו; הוא תקף 5 דקות.',
  end: 'סיום גישה',
  shared: 'שולחן העבודה משותף.',
  sharedBody: 'חיבור שלכם ינתק את מי שמחובר אליו כרגע.',
  deviceTitle: 'מאיפה מתחברים?',
  endDialog: {
    title: 'לסיים את הגישה?',
    body: 'החיבורים הפתוחים שלכם ייסגרו בתוך דקה בערך, ולחיבור נוסף תצטרכו בקשה חדשה.',
    keep: 'להמשיך בגישה',
    confirm: 'כן, לסיים את הגישה',
  },
} as const;

export type DeviceId = 'windows' | 'mac' | 'mobile' | 'linux';
export const DEVICES: ReadonlyArray<{ id: DeviceId; label: string; steps: readonly string[] }> = [
  { id: 'windows', label: 'Windows', steps: ['פותחים את הקובץ שהורד.', 'מאשרים את החיבור כשהמערכת שואלת.', 'שולחן העבודה נפתח.'] },
  { id: 'mac', label: 'macOS', steps: ['מתקינים את Windows App.', 'פותחים את הקובץ שהורד.', 'שולחן העבודה נפתח.'] },
  { id: 'mobile', label: 'iOS ו-Android', steps: ['מתקינים את Windows App.', 'פותחים את הקובץ שהורד.', 'שולחן העבודה נפתח.'] },
  { id: 'linux', label: 'Linux', steps: ['פותחים את הקובץ ב-Remmina או ב-xfreerdp.', 'מאשרים את החיבור כשהמערכת שואלת.', 'שולחן העבודה נפתח.'] },
];

export const ENDED_REASON_TEXT: Record<string, string> = {
  expired: 'הזמן שאושר נגמר',
  ended_by_user: 'סיימתם את הגישה',
  revoked_by_owner: 'הבעלים ביטל את הגישה',
  access_removed: 'ההרשאה לגישה הוסרה',
};

export const OUTCOME_COPY = {
  denied: { title: 'הבקשה נדחתה', noteLabel: 'הערת הבעלים:' },
  expired: { title: 'הבקשה פגה ללא מענה', body: `הבעלים לא הגיב תוך ${RDP_REQUEST_TTL_MINUTES} דקות. אפשר לשלוח בקשה חדשה.` },
  cancelled: { title: 'הבקשה בוטלה', body: 'אפשר לשלוח בקשה חדשה בכל רגע.' },
  ended: { title: 'הגישה הסתיימה', closed: 'החיבורים הפתוחים נסגרים. לחיבור נוסף צריך בקשה חדשה.' },
  newRequest: 'בקשה חדשה',
} as const;

export function filesDownloadedText(count: number): string {
  if (count === 0) return 'לא הורדו קבצים';
  if (count === 1) return 'קובץ אחד הורד';
  return `${count} קבצים הורדו`;
}

// ── The owner's read-only screens ────────────────────────────────────────────────────────────────

export const OWNER_STATUS_LABEL: Record<RdpDisplayStatus, string> = {
  pending: 'ממתינה',
  active: 'פעילה',
  ended: 'הסתיימה',
  denied: 'נדחתה',
  expired: 'פגה',
  cancelled: 'בוטלה',
};

export const OWNER_TERMINAL_COMMAND = 'npm run rdp:access -- watch';

// What each audit event means, in one line. An unknown kind is shown by its own code, never hidden: the list is
// the application-side source of truth (events.ts) and a new kind would otherwise vanish from the owner's timeline.
export const EVENT_KIND_TEXT: Record<string, string> = {
  requested: 'הבקשה נשלחה',
  cancelled: 'הבקשה בוטלה על ידי המבקש',
  approved: 'הבעלים אישר',
  denied: 'הבעלים דחה',
  request_expired: 'הבקשה פגה ללא מענה',
  grant_expired: 'הזמן שאושר נגמר',
  file_issued: 'קובץ חיבור הורד',
  file_refused: 'הורדת קובץ נדחתה',
  file_failed: 'הכנת הקובץ נכשלה',
  grant_ended: 'המבקש סיים את הגישה',
  grant_revoked: 'הבעלים ביטל את הגישה',
  tunnel_check: 'בדיקת חיבור מהשער',
  tunnel_closed: 'חיבור נסגר',
  access_removed: 'ההרשאה הוסרה מהמבקש',
  disconnect_ok: 'ניתוק חיבורים: הצליח',
  disconnect_failed: 'ניתוק חיבורים: נכשל',
};

// Outcomes that say something the sentence does not already say. For the rest the outcome only repeats the kind
// ("הבעלים אישר · approved"), so it is left out of the timeline.
const OUTCOME_ADDS_INFO: ReadonlySet<string> = new Set(['file_refused', 'file_failed', 'disconnect_failed', 'tunnel_closed']);

/** One timeline line: the sentence for the kind, plus the outcome only where it adds information. */
export function describeEventLine(kind: string, outcome: string | null): string {
  const text = EVENT_KIND_TEXT[kind] ?? kind;
  if (kind === 'tunnel_check') {
    if (outcome === 'allow') return `${text}: הותר`;
    const reason = outcome?.replace(/^deny:/, '');
    return `${text}: נדחה${reason ? ` (${reason})` : ''}`;
  }
  return outcome && (OUTCOME_ADDS_INFO.has(kind) || !(kind in EVENT_KIND_TEXT)) ? `${text} · ${outcome}` : text;
}
