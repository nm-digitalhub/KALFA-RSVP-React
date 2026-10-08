// What staff read when CardCom places a payment on another terminal than the one it was opened on. One place, because two screens say it -
// the card, which hides the approval button, and the server, which refuses the approval - and they must not drift apart.
//
// The warning in the middle is the point: marking the row "failed" opens the pay-once lock, so the customer can be charged again, and
// a refund of a row that did not succeed cannot be made from the system - money that was really taken has to go back in CardCom's own
// panel BEFORE the row is marked.
export const TERMINAL_CONFLICT_NOTICE =
  'המסוף ש-CardCom דיווחה שונה מהמסוף שבו נפתח התשלום, ולכן אי אפשר לאשר אותו כגבייה מכאן. ' +
  'בדקו בלוח של CardCom לאן הגיע הכסף. אם נמצא חיוב שנגבה, יש להחזיר אותו ידנית בלוח של CardCom לפני הסימון: ' +
  'אחרי שהפעולה מסומנת ככושלת הלקוח יכול לשלם שוב, ואי אפשר להחזיר אותה מהמערכת. ' +
  'אחר כך סמנו ככושלת עם הערה על מה שמצאתם.';
