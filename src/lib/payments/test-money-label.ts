// An alert about TEST money says so, so that nobody reads a test run as revenue, or as trouble with a customer's money. One place,
// so every module that alerts about a payment marks a test payment the same way. Pure.
export const TEST_MONEY_MARK = '[בדיקה]';

export const labelTestMoney = (title: string, isTest: boolean): string => (isTest ? `${TEST_MONEY_MARK} ${title}` : title);
