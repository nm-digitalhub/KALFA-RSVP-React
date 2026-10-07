// Every sentence the owner CLI prints, in one place (user-facing text kept apart from the logic, so the
// commands can be tested without asserting on prose and a language can be added later).

export const CLI_TEXT = {
  noOwner: 'לא נמצא בעלים במערכת',
  ambiguousOwner: 'נמצאו כמה בעלים. יש לציין אחד עם --as <מזהה>',
  notOwner: 'המזהה שצוין ב---as אינו בעלים',
  invalidId: 'מזהה לא תקין. נדרשים לפחות 4 תווים הקסדצימליים',
  notFound: 'לא נמצאה בקשה כזו',
  ambiguousId: 'המזהה מתאים ליותר מבקשה אחת. יש להקליד יותר תווים',
  notPending: 'הבקשה כבר אינה ממתינה',
  expired: 'הבקשה פגה',
  declined: 'בוטל, לא נעשה שינוי',
  noActiveGrant: 'אין כרגע גישה פעילה',
  gatewayNotConfigured: 'השער אינו מוגדר. חסרים או לא תקינים:',
  ticketLoginOn: 'כניסה לשולחן עם כרטיס: מוגדרת',
  ticketLoginOff: 'כניסה לשולחן עם כרטיס: כבויה',
  ticketLoginBroken: 'כניסה לשולחן עם כרטיס: מוגדרת חלקית, לא יונפק קובץ. חסרים או לא תקינים:',
  staleTunnelsNotCleared: 'לא ניתן לוודא שאין חיבורים ישנים בשער, ולכן האישור לא בוצע:',
  approved: 'הגישה אושרה',
  denied: 'הבקשה נדחתה',
  revoked: 'הגישה בוטלה',
  tunnelsCut: 'החיבורים החיים נותקו',
  tunnelsNotCut: 'הגישה בוטלה במסד אך ניתוק החיבורים לא אושר. ה-sweep ינסה שוב כל דקה. אם השער לא מגיב: sudo systemctl stop rdpgw',
  grantConflict: 'כבר יש גישה פעילה אחרת. יש לבטל אותה קודם:',
  notAllowed: 'לא בוצע, ראו את הסיבה:',
  unexpected: 'תשובה לא צפויה מהמסד. לא בוצע שינוי',
  noPending: 'אין בקשות ממתינות',
  watchNeedsTty: 'watch דורש טרמינל אינטראקטיבי. אפשר להשתמש ב-list וב-approve',
  confirmApprove: 'לאשר גישה?',
  confirmDeny: 'לדחות את הבקשה?',
  confirmRevoke: 'לבטל את הגישה הפעילה?',
} as const;

// outcome (from the SQL functions) -> sentence, for the outcomes that are neither success nor handled inline
export const OUTCOME_TEXT: Record<string, string> = {
  not_owner: 'המשתמש שנבחר אינו בעלים',
  invalid_minutes: 'משך לא תקין',
  invalid_target: 'יעד לא תקין בהגדרות השער',
  invalid_verdict: 'החלטה לא תקינה',
  requester_not_allowed: 'למבקש כבר אין הרשאה לבקש גישה',
  busy: 'המסד עסוק. יש לנסות שוב',
  unexpected: CLI_TEXT.unexpected,
};
