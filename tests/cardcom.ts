import { randomUUID } from 'node:crypto';

import type { Route } from '@playwright/test';

import { OPEN_FIELDS_ORIGIN } from '@/lib/cardcom/open-fields';

// CardCom, played by the test, so no E2E run ever reaches the provider. Two halves:
//   - the SERVER's calls (LowProfile/Create when the payment form opens, LowProfile/GetLpResult when the purchase is
//     settled) reach `answer` through Next's test mode (next.onFetch, tests/fixtures.ts);
//   - the BROWSER's Open Fields frames are served by `frame` through page.route. The master frame behaves like
//     CardCom's own OpenFields.js (read 29.10.2026): it remembers the LowProfile code from `init`, answers `init` with
//     `initialized`, and on `doTransaction` posts to its ChargeLowProfileDeal endpoint, then tells the page
//     `HandleSubmit` (or `HandleEror`). Served under CardCom's origin, its messages pass the page's origin check.
// A session counts as paid only after the buyer pressed "pay" in the form, so the settlement path is the real one.

type Session = { terminal: number; operation: string; amount: number; returnValue: string; paid: boolean };

// CardCom's documented GetLpResult answer for a paid ChargeAndCreateToken session ("Step 1+2 – Creating a payment page &
// sending a request to retrieve transaction details", docs/cardcom/response (2).md). Only the values that belong to THIS
// session are replaced: its id, terminal, operation, return value and amount.
function paidAnswer(lowProfileId: string, s: Session) {
  const token = '4cf8e168-261e-4613-8d20-000332986b24';
  return {
    ResponseCode: 0,
    Description: 'The transaction was successful',
    TerminalNumber: s.terminal,
    LowProfileId: lowProfileId,
    TranzactionId: 209413394,
    ReturnValue: s.returnValue,
    Operation: s.operation,
    UIValues: {
      CardOwnerEmail: 'testsite@test.co.il',
      CardOwnerName: 'Card Owner',
      CardOwnerPhone: '039436100',
      CardOwnerIdentityNumber: '040617649',
      NumOfPayments: 1,
      CardYear: 2027,
      CardMonth: 10,
      IsAbroadCard: false,
    },
    DocumentInfo: {
      ResponseCode: 0,
      Description: 'The transaction was successful',
      DocumentType: 'TaxInvoiceAndReceipt',
      DocumentNumber: 593032,
      AccountId: 0,
      DocumentUrl: null,
    },
    TokenInfo: {
      Token: token,
      TokenExDate: '20271101',
      CardYear: 2027,
      CardMonth: 10,
      TokenApprovalNumber: '12345',
      CardOwnerIdentityNumber: '040617649',
    },
    SuspendedInfo: null,
    TranzactionInfo: {
      ResponseCode: 0,
      Description: 'The transaction was successful',
      TranzactionId: 209413394,
      TerminalNumber: s.terminal,
      Amount: s.amount,
      CoinId: 1,
      CouponNumber: '38038259',
      CreateDate: '2025-05-06T10:48:21',
      Last4CardDigits: 0,
      Last4CardDigitsString: '0000',
      FirstCardDigits: 458000,
      JParameter: '0',
      CardMonth: 10,
      CardYear: 27,
      ApprovalNumber: '12345',
      NumberOfPayments: 1,
      CardInfo: 'Israeli',
      CardOwnerName: 'Card Owner',
      CardOwnerPhone: '039436100',
      CardOwnerEmail: 'testsite@test.co.il',
      CardOwnerIdentityNumber: '040617649',
      Token: token,
      CardName: 'ויזה רגיל',
      DocumentNumber: 593032,
      DocumentType: 'TaxInvoiceAndReceipt',
      Brand: 'Visa',
      Acquire: 'Laumicard',
      Issuer: 'CAL',
      PaymentType: 'Standard',
      CardNumberEntryMode: 'Phone',
      DealType: 'Debit',
      IsRefund: false,
      DocumentUrl: null,
      IsAbroadCard: false,
    },
    ExternalPaymentVector: 'NoneOrUnknown',
    Country: 'IL',
  };
}

const MASTER_FRAME = `<!doctype html><html><body><script>
let code = null;
window.addEventListener('message', async (event) => {
  const m = event.data || {};
  if (m.action === 'init') {
    code = m.lowProfileCode;
    window.parent.postMessage({ action: 'initialized', lowProfileCode: code }, '*');
  }
  if (m.action === 'doTransaction') {
    const res = await fetch('/api/OpenFields/ChargeLowProfileDeal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lowProfileCode: code }),
    });
    const json = await res.json();
    window.parent.postMessage(json.IsSuccess
      ? { action: 'HandleSubmit', lowProfileCode: code, data: json }
      : { action: 'HandleEror', lowProfileCode: code, isError: true, message: json.Description, ResponseCode: json.ResponseCode }, '*');
  }
});
</script></body></html>`;

const EMPTY_FRAME = '<!doctype html><html><body></body></html>';

export class CardcomServer {
  readonly sessions = new Map<string, Session>();

  // The server's fetch to CardCom's API (Next test mode). Anything else of CardCom's is refused.
  async answer(request: Request): Promise<Response | 'abort'> {
    const { pathname } = new URL(request.url);
    if (request.method === 'POST' && pathname === '/api/v11/LowProfile/Create') {
      const body = (await request.json()) as { TerminalNumber: number; Operation: string; Amount: number; ReturnValue: string };
      const lowProfileId = randomUUID();
      this.sessions.set(lowProfileId, {
        terminal: body.TerminalNumber,
        operation: body.Operation,
        amount: body.Amount,
        returnValue: body.ReturnValue,
        paid: false,
      });
      return Response.json({ ResponseCode: 0, Description: 'OK', LowProfileId: lowProfileId, Url: `${OPEN_FIELDS_ORIGIN}/External/LowProfile.aspx?LowProfileCode=${lowProfileId}` });
    }
    if (request.method === 'POST' && pathname === '/api/v11/LowProfile/GetLpResult') {
      const { LowProfileId } = (await request.json()) as { LowProfileId: string };
      const session = this.sessions.get(LowProfileId);
      if (session?.paid) return Response.json(paidAnswer(LowProfileId, session));
      // CardCom's answer for a session nobody paid (measured on terminal 1000, see cardcom-settle.ts CARDCOM_PENDING_CODES).
      return Response.json({ ResponseCode: 5119, Description: 'עסקה ממתינה או לא הושלמה', LowProfileId });
    }
    return 'abort';
  }

  // The browser's requests to CardCom's origin: the Open Fields frames and the master frame's charge call.
  async frame(route: Route): Promise<void> {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/api/openfields/master') return route.fulfill({ contentType: 'text/html', body: MASTER_FRAME });
    if (['/api/openfields/cardNumber', '/api/openfields/CVV', '/api/openfields/reCaptcha', '/api/openfields/GooglePay'].includes(pathname)) {
      return route.fulfill({ contentType: 'text/html', body: EMPTY_FRAME });
    }
    if (pathname === '/External/OpenFields/3DS.js') return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (request.method() === 'POST' && pathname === '/api/OpenFields/ChargeLowProfileDeal') {
      const { lowProfileCode } = request.postDataJSON() as { lowProfileCode: string };
      const session = this.sessions.get(lowProfileCode);
      if (!session) return route.fulfill({ json: { IsSuccess: false, ResponseCode: 5119, Description: 'unknown session' } });
      session.paid = true;
      return route.fulfill({ json: { IsSuccess: true, ResponseCode: 0, LowProfileId: lowProfileCode } });
    }
    return route.abort();
  }
}
