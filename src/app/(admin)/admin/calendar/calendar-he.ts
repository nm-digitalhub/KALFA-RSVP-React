import type { EventCalendarI18nOverrides } from '@/components/reui/event-calendar/event-calendar-i18n';

// Full Hebrew i18n for the ReUI event calendar. The component ships English
// defaults only (measured — event-calendar-i18n.tsx has no built-in he pack);
// every label the admin can see is overridden here. The merge is shallow PER
// SECTION KEY (EventCalendarI18nOverrides), so the format overrides below
// still flow into the component's smart default title/time functions instead
// of replacing them. viewShortcuts stays on the English defaults on purpose —
// M/W/D/A are keyboard keys, not display text.
export const CALENDAR_I18N_HE: EventCalendarI18nOverrides = {
  labels: {
    today: 'היום',
    previous: 'הקודם',
    next: 'הבא',
    addEvent: 'אירוע חדש',
    allDay: 'כל היום',
    more: (count: number) => `‎+${count} נוספים`,
    noEvents: 'אין אירועים בטווח המוצג',
    loading: 'טוען אירועים',
    event: 'אירוע',
    events: (count: number) => (count === 1 ? 'אירוע אחד' : `${count} אירועים`),
    selectView: 'בחירת תצוגה',
    week: (weekNumber: number) => `שבוע ${weekNumber}`,
    resources: 'משאבים',
    goToDate: 'מעבר לתאריך',
    dropNotAllowed: 'לא ניתן להעביר לכאן',
    continues: 'ממשיך',
    timeFrom: (time: string) => `מ-${time}`,
    timeUntil: (time: string) => `עד ${time}`,
    toggleDayEvents: (count: number) => (count === 1 ? 'אירוע אחד' : `${count} אירועים`),
    eventDetails: (title: string) => `פרטי האירוע ${title}`,
    moreCompact: (count: number) => `‎+${count}`,
    timeRange: (from: string, to: string) => `${from}–${to}`,
  },
  viewNames: {
    month: 'חודש',
    week: 'שבוע',
    day: 'יום',
    days: (count: number) => (count === 1 ? 'יום אחד' : `${count} ימים`),
    agenda: 'סדר יום',
    resource: 'משאבים',
  },
  // Israel runs a 24-hour clock; the component defaults are 12-hour ("h:mm a").
  // Date words render in Hebrew via the date-fns `he` locale passed to the
  // calendar; the "ב" in the patterns is a literal (non-ASCII chars pass
  // through date-fns format strings untouched).
  formats: {
    dayTitle: 'EEEE, d בMMMM yyyy',
    agendaDayHeader: 'EEEE, d בMMMM',
    moreDayHeader: 'EEEE, d בMMMM',
    timeGutter: 'HH:mm',
    timeGutterMinute: 'HH:mm',
    eventTime: 'HH:mm',
  },
};
