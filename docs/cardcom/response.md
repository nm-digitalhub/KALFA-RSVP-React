Step 3 – Token Charging / Frame Capture / Direct Interface Credit Card Charging. (Do Transaction) – מרכז תמיכה למפתחים               

[דלג לתוכן העיקרי](#main-content)

 [![דף הבית במרכז התמיכה של מרכז תמיכה למפתחים](/hc/theming_assets/01JY3EYD9JHX10BHMPX3SEXP5T) מרכז תמיכה למפתחים](/hc/he "דף הבית") | [מרכז התמיכה קארדקום](https://support.cardcom.solutions/hc/he) | [ממשקים Name To Value (API 10)](https://cardcomapinametovalue.zendesk.com/hc/he)

 

מאמרים בקטגוריית המשנה הזאת

*   [Partial / Full Transaction Refund by Transaction ID (Refund By Transaction ID)](/hc/he/articles/28988986351762-Partial-Full-Transaction-Refund-by-Transaction-ID-Refund-By-Transaction-ID)
*   [Step 3 – Token Charging / Frame Capture / Direct Interface Credit Card Charging. (Do Transaction)](/hc/he/articles/28452352778770-Step-3-Token-Charging-Frame-Capture-Direct-Interface-Credit-Card-Charging-Do-Transaction)
*   [Step 1+2 – Creating a payment page & sending a request to retrieve transaction details (Iframe/Redirect)](/hc/he/articles/28448202810514-Step-1-2-Creating-a-payment-page-sending-a-request-to-retrieve-transaction-details-Iframe-Redirect)

# Step 3 – Token Charging / Frame Capture / Direct Interface Credit Card Charging. (Do Transaction)

![](https://support.cardcom.solutions/system/photos/27160828654610/קארדקום_זנדסק.png)

[דניאל.ע תמיכה קארדקום](/hc/he/profiles/19169135635474-%D7%93%D7%A0%D7%99%D7%90%D7%9C-%D7%A2-%D7%AA%D7%9E%D7%99%D7%9B%D7%94-%D7%A7%D7%90%D7%A8%D7%93%D7%A7%D7%95%D7%9D)

לפני שנה עודכן

עקובאין עדיין עוקבים

**When to use this function?**

This function is typically used after steps 1 and 2.

Businesses that want to create subscriptions, work with tokens, and frame captures will use this function.

Additionally, the function is intended for performing charges in a direct interface model.

* * *

**What is a "direct interface"?**

A direct interface is intended for closed and secure systems or closed native applications (iOS / Android). Charging via a direct interface is done without redirecting to Cardcom’s PCI-compliant payment page.

Important to note: The direct interface model is **not** intended for websites (WEB). For such systems, the "low profile" module should be used.

On the WEB, a PCI standard is mandatory in the direct interface; without it, the business is vulnerable to hacks and fraud.

In applications, PCI compliance is less critical because hacking an app does not mean hacking the details of all other customers.

* * *

**Direct Interface Charging Process**

When working with the direct interface, it is impossible to obtain Cardcom’s PCI certification, so PCI certification must be obtained directly from the credit company. Additionally, credit card details must not be stored in the system but only transferred through the interface. Also, storing the CVV is forbidden.

* * *

**Common operations in the "Do Transaction" function**

With the "Do Transaction" function, you can perform the following actions:

*   Charging and refunding tokens.
    
*   Recurring charging of a token (standing orders).
    
*   Charging and releasing a frame captured in the first step.
    
*   Charging using credit card details (direct interface).
    

__Note:__ For token charging, the terminal must not require CVV from credit companies.  
Such a terminal does not verify the card’s expiry date (only requires it to be in the future), does not check CVV, and ID verification is optional depending on the agreement with the credit company.

* * *

**Requirements & Necessary models**

*   Terminal without CVV requirement – for the token model.
    
*   Token model – for token charging and refunding.
    
*   Direct interface model – for performing transactions in a closed iOS system.
    

* * *

**Step 3 – Token Charging & Credit Card Charging – Do Transaction**

Below is the link to the function in JSON format.  
Request method: POST.

**Do Transaction**  
`https://secure.cardcom.solutions/api/v11/Transactions/Transaction`

* * *

**Parameters required to be passed to the Do Transaction function:**

Legend:

*   Red parameter – mandatory
    
*   Bold parameter – recommended
    
*   Parameter not red or bold – optional
    

**Number**

**Parameter Name**

**Example Values**

**Description**

1

TerminalNumber

1000

The terminal performing the operation. This parameter must be obtained from the merchant.

2

ApiName

test2025

Interface username. This parameter must be obtained from the merchant.

3

Amount

100

The amount to charge.

4

**CardNumber**

"4580000000000000"

Credit card number for charging.

5

**Token**

"4cf8e168-261e-4613-8d20-000332986b24"

The token for charging.

6

CardExpirationMMYY

"1226"

Expiration date of the token — mandatory.

7

**CVV2**

"078"

Three-digit security code of the credit card.

8

**ExternalUniqTranId**

"h9rZs#4VxTp!7kLb0wUeG3zC"

External unique transaction ID. It is essential to send your unique transaction ID to prevent duplicate transactions. If the same external unique transaction ID is sent again, you will receive error code 608. See 'ExternalUniqTranIdResponse'.

9

ExternalUniqTranIdResponse

boolean - true / false

false – will return error code 608 if the same 'ExternalUniqTranId' is used again. true – will not charge the card but will return the original transaction response.

10

NumOfPayments

12

Number of payments for the transaction.

11

CardOwnerInformation

Object containing parameters: **Phone:** "0522222222" — Customer phone number.

**FullName:** "Daniel Test" — Customer full name.

**IdentityNumber:** "321654987" — Customer ID number.

**CardOwnerEmail:** "[test@gmail.com](mailto:test@gmail.com)" — Customer email.

**AvsZip:** "string" — AVS active only on EMV terminals (EMV terminals are those opened from 9/2017 onwards; otherwise contact Cardcom support for upgrade). Customer zip code.

**AvsAddress:** "string" — AVS active only on EMV terminals. Customer address.

**AvsCity:** "string" — AVS active only on EMV terminals. Customer city.

 

12

ISOCoinId

1 – Shekel 2 – Dollar

Currency code for charging the transaction. For additional currency codes – see currency codes list.

13

CustomFields

Array of objects containing: Id (integer) – e.g. 1 Value (string) – e.g. "Sample value"

Custom fields, useful to pass additional transaction information for reporting and data collection.Id – identifier number of the custom field.Value – value of the custom field.This is an array containing objects.

### Values of the `Advanced` Object (14)

*   🔴 Red parameter – Required
    
*   **Bold parameter** – Recommended
    
*   Regular (not red or bold) – Optional
    

Number

Parameter Name

Example Values

Description

1

ApiPassword

"kzFKfohEvL6AOF8aMEJz"

API password, intended for refunds and cancellations of transactions.

2

IsRefund

boolean - true / false

Indicates whether this was a refund transaction.

3

ISOCoinName

ILS / USD / EUR

Equivalent to the ISOCoinId parameter; here the currency name is provided instead of the numeric currency code.

4

JValidateType

(integer) - 2 / 5

Type of action to perform on the credit card / token. 2 - J2: Perform card validation only. 5 - J5: Perform credit hold and credit check.

5

SapakMutav

(string) / 1234

Customer number for working with "Rav Mutav" system.

6

CreditType

1 - Regular charge 6 - Installment credit

If this parameter is not provided, a regular charge or regular installments will be performed. **Note:** 1. Credit card companies limit the minimum number of installments to 3, which we adjust automatically. 2. Credit companies restrict minimum amounts for credit transactions; amounts must be suitable or the customer will be redirected to a failure page.

7

**MTI**

420 (fixed value)

Parameter for releasing credit hold. Must be sent with the approval number, which is the Cardcom transaction number of the actual hold. (ApprovalNumber)

8

AccountIdToGetCardNumber

123

Set this parameter to the AccountID (customer card identifier). This will provide the card number and expiration date from the account. To get account info for the invoice, send AccountID in the document object: Document.AdvancedDefinition.AccountID and set Document.AdvancedDefinition.IsLoadInfoFromAccountID=true.

9

**ApprovalNumber**

12345

One-time approval number received when creating a token with J5 validation in step 1. To charge a credit hold made in step 1, send this approval number together with the token and amount to charge.

10

FirstPayment

50

Optional - amount of the first installment payment! Amounts are in agorot (hundredths of a shekel) – see note at end of table.

11

ConstPayment

20

Optional - amount of subsequent installment payments! Amounts are in agorot – see note at end of table.

12

**IsAutoRecurringPayment**

boolean - true / false

When TRUE, the charge type changes to recurring payment interface type instead of low profile — but this does not create a recurring payment order. Mainly intended for replacements so that the charge is marked as recurring and the card is added to the replacement service.Send as true only if the terminal is defined as a recurring payment terminal at the credit company and Shva BA.If the terminal is defined as telephone/regular without CVV, do not send this parameter.The recurring payment terminal is used to receive replacement files from credit companies; transactions will appear to the cardholder as recurring payment transactions. Updates replacement files from credit companies.No card type restriction for recurring payments; the system detects card type and acts accordingly (e.g., postal card, immediate charge, etc.).

13

IsCreateToken

boolean - true / false

Whether to create a token from the credit card details.

14

SendNote

boolean - true / false

Whether to send a note/receipt of the transaction performed.

### Values of the `Document` Object (15)

*   🔴 Red parameter – Required
    
*   **Bold parameter** – Recommended
    
*   Regular (not red or bold) – Optional
    

Number

**Parameter Name**

**Example Values**

**Description**

1

**DocumentTypeToCreate**

"Auto" – automatic (based on settings 3→4) "TaxInvoiceAndReceipt" – Tax invoice + receipt "TaxInvoiceAndReceiptRefund" – Credit tax invoice + refund "Receipt" – NGO receipt "ReceiptRefund" – NGO refund "Quote" – Quote "Order" – Order "OrderConfirmation" – Website order confirmation "OrderConfirmationRefund" – Refund for order confirmation "DeliveryNote" – Delivery note "DeliveryNoteRefund" – Return note "ProformaInvoice" – Proforma invoice "DemandForPayment" – Payment demand "DemandForPaymentRefund" – Cancel payment demand "ProformaDealInvoice" – Proforma receipt "ProformaDealInvoiceRefund" – Proforma refund "TaxInvoice" – Tax invoice "ProformaInvoiceRefund" – Proforma refund "TaxInvoiceRefund" – Tax invoice credit "ReceiptForTaxInvoice" – Receipt for invoice "DonationReceipt" – Donation receipt "DonationReceiptRefund" – Refund donation receipt "ReceiptForTaxInvoiceRefund" – Refund for invoice

Type of document to generate.

2

**Name**

"Mr Test"

Customer name.

3

TaxId

040617640

Customer ID or company registration number.

4

**Email**

[israel@gmail.com](mailto:israel@gmail.com) _(you may separate multiple emails with a semicolon ;)_

Email address where the document will be sent.

5

IsSendByEmail

true / false

Should the document be sent via email?

6

AddressLine1

"Saharov 22"

Customer address – line 1.

7

AddressLine2

"P.O. 1234"

Customer address – line 2.

8

City

Reshin-Le-Zion

City

9

Mobile

03-9619611

Landline number

10

Phone

0549876543

Mobile number _(used for SMS if applicable)_

11

Comments

Example: _One-year warranty from invoice date_ _(up to 250 characters)_

Comments to appear at the bottom of the document.

12

IsVatFree

true = 0% VAT false = 18% VAT

Is the document VAT-exempt (e.g. for international clients)?

13

DepartmentId

123 _(int)_

Department code used for reporting and accounting. Refer to the department setup in the portal.

14

**AdvancedDefinition**

**Object with internal parameters:**

• `IsAutoCreateUpdateAccount` (bool):    – false: All customers assigned to "Miscellaneous Customers"   – true: New customer card created or linked by logic

• `AccountForeignKey` (string): e.g. "300" – accounting foreign key

• `SiteUniqueId` (string): Unique website ID (informational)

• **`AccountID` (int): e.g. 123 – system customer ID**

• `IsLoadInfoFromAccountID` (bool): If true, pulls data from customer card using AccountID ℹ️ Logic: If customer card not found, system searches by foreign key → unique ID → email.

 

15

**Products**

**Array of objects:** • `ProductID` (string): e.g. "ZZASA-AASSA-12" – item code or SKU

• `Description` (string): e.g. "Online Course"

• `Quantity` (int): e.g. 2 – number of items

• `UnitCost` (float): e.g. 50.57 – price per unit • `TotalLineCost` (float): e.g. 101.14 – useful for rounding precision

• `IsVatFree` (bool): true/false – is item VAT-exempt? ℹ️ For multiple items, use: `InvoiceLines1.ProductID=AAA` `InvoiceLines2.ProductID=BBB`

 

16

ExternalId

"ABC123XYZ" _(string)_

External system identifier (document level only). Not saved in customer profile.

17

ManualNumber

585177

Manual document number. ⚠️ Requires special permission. Used in rare cases instead of auto-numbering.

18

DocumentDateDDMMYYYY

"05/03/2025"

Document issue date.

19

ValueDate

"12/03/2025"

Document value date _(used for journal deposits)_.

20

Language

"he" / "en"

Document language.

21

IsSendSMS

true / false _(boolean)_

Should the document be sent via SMS? _(Requires SMS module)_

### RESPONSE of `DoTransaction`

After sending a **POST** request to this function, the following values will be returned in the **RESPONSE**:

Number

**Parameter Name**

**Example Values**

**Description**

1

ResponseCode

0

0 = Success, any other = error (development error).

2

Description

"Transaction completed successfully"

Response description. If different from this, transaction did not succeed.

3

TranzactionId

654354685

Unique transaction ID for credit card charge. (Int64 / BigInt)

4

TerminalNumber

1001

Terminal number

5

Amount

100.50

Charge amount

6

CoinId

1 – Shekel2 – DollarRefer to full currency code list

Transaction currency

7

CouponNumber

38022395

Voucher number (can be used for reconciliation)

8

CreateDate

"2025-03-12T08:46:45"

Transaction creation date

9

Last4CardDigits

5796 _(int)_

Last 4 digits of card

10

Last4CardDigitsString

"5796" _(string)_

Last 4 digits of card

11

FirstCardDigits

440066

First 6 digits of card

12

JParameter

0 – default by credit company2 – checksum validation only5 – Approval request from credit company

Type of card validation

13

CardMonth

12

Card expiry month

14

CardYear

2021

Card expiry year

15

ApprovalNumber

009491B

Approval code (mandatory for J5 transactions)

16

FirstPaymentAmount

50.00

First payment amount

17

ConstPaymentAmount

20.00

Amount for following payments

18

NumberOfPayments

5

Total number of payments

19

CardInfo

"Israeli", "NonIsraeli", "FuelCard", "ImmediateChargeCard", "GiftCard"

Card type

20

CardOwnerName

"daniel"

Cardholder's name

21

CardOwnerPhone

"0522222222"

Cardholder's phone number

22

CardOwnerEmail

"[test@gmail.com](mailto:test@gmail.com)"

Cardholder's email

23

CardOwnerIdentityNumber

"213654987"

Cardholder's ID number

24

Token

"4cf8e168-261e-4613-8d20-000332986b24"

Token number – should be saved in DB

25

CardName

"Visa Regular"

Card name

26

SapakMutav

1234

Merchant number in multi-merchant setup

27

Uid

"21121517002429612920744"

Unique transaction identifier. Will change if token used for a new charge/refund

28

ConcentrationNumber

(number)

Deposit/concentration batch number

29

DocumentNumber

300394

Document number

30

DocumentType

Same options as in document creation (see above: "Auto", "TaxInvoice", etc.)

Document type

31

Rrn

"500301575449"

Credit company identifier (RRN)

32

Brand

"PrivateCard", "MasterCard", "Visa", "Maestro", "AmericanExpress", "Isracard", "JBC", "Discover", "Diners"

Card brand

33

Acquire

"Unknown", "Isracard", "CAL", "Diners", "AmericanExpress", "Laumicard", "CardCom", "PayPal", "Upay", "PayMe"

Acquirer (processor)

34

Issuer

"NonIsrael", "Isracard", "CAL", "Diners", "AmericanExpress", "JCB", "Laumicard"

Issuing company

35

PaymentType

"Unknown", "Standard", "SpecialCredits", "ImmediateCharge", "CreditClub", "SuperCredit", "InstallmentCredit", "Payments", "ClubPayments"

Credit type

36

CardNumberEntryMode

"MagneticStrip", "SelfService", "GasStationSelfService", "Contactless", "EmvContactless", "MobileContactless", "EmvMobileContactless", "Internet", etc.

Entry method: internet, swipe, EMV, phone, etc.

37

DealType

"Information", "Debit", "Discharge", "ForcedCharge", "CashBack", "CashTransaction", "Recurring", "BalanceQuery", "Cancel", "Refund", "Recharge"

Type and origin of deal – charge, cancel, refund, etc.

38

IsRefund

true / false

Was it a refund transaction?

39

DocumentUrl

(URL)

Direct link to the generated document

40

CustomFields

Array of objects: – `Id`: 20 – `Value`: "value"

Custom fields for additional metadata

41

IsAbroadCard

true / false

Is this an international card?

### Below are example codes for using tokens.

### ✅ **Charging a token created in Step 1**

```auto
{
  "TerminalNumber": 1001,
  "ApiName": "test2025",
  "Amount": 200,
  "Token": "4cf8e168-261e-4613-8d20-000332986b24",
  "CardExpirationMMYY": "0628",
  "ExternalUniqTranId": "h7rZ3#קV3Tp!7kLb0wUeG3zC",
  "ExternalUniqUniqTranIdResponse": false,
  "NumOfPayments": 1
}
```

### ✅ **Charging a token + Document generation**

```auto
{
  "TerminalNumber": 1001,
  "ApiName": "test2025",
  "Amount": 200,
  "Token": "4cf8e168-261e-4613-8d20-000332986b24",
  "CardExpirationMMYY": "0628",
  "ExternalUniqTranId": "h7rZ3#קV3Tp!7kL-b0wUeG3zC",
  "ExternalUniqUniqTranIdResponse": false,
  "NumOfPayments": 1,
  "Document": {
    "DocumentTypeToCreate": "TaxInvoiceAndReceipt",
    "Name": "תעבוד",
    "TaxId": "040617640",
    "Email": "test@gmail.com",
    "IsSendByEmail": false,
    "IsVatFree": false,
    "Products": [
      {
        "Description": "hey",
        "Quantity": 1,
        "UnitCost": 200
      }
    ]
  }
}
```

### ✅ **Charging a captured authorization hold**

```auto
{
  "TerminalNumber": 1001,
  "ApiName": "test2025",
  "Amount": 200,
  "Token": "4cf8e168-261e-4613-8d20-000332986b24",
  "CardExpirationMMYY": "1225",
  "ExternalUniqTranId": "h7rZ3#קV3Tp4!76-kLb0wUeG3zC",
  "ExternalUniqUniqTranIdResponse": false,
  "NumOfPayments": 1,
  "Advanced": {
    "ApprovalNumber": 204394904
  }
}
```

### ✅ **Charging a captured authorization hold + Document generation**

```auto
{
  "TerminalNumber": 1001,
  "ApiName": "test2025",
  "Amount": 200,
  "Token": "4cf8e168-261e-4613-8d20-000332986b24",
  "CardExpirationMMYY": "1225",
  "ExternalUniqTranId": "h7rZ3#קV3Tp4!76-kLb0wUeG3zC",
  "ExternalUniqUniqTranIdResponse": false,
  "NumOfPayments": 1,
  "Advanced": {
    "ApprovalNumber": 204394904
  },
  "Document": {
    "DocumentTypeToCreate": "TaxInvoiceAndReceipt",
    "Name": "תעבוד",
    "TaxId": "040617640",
    "Email": "test@gmail.com",
    "Products": [
      {
        "Description": "hey",
        "Quantity": 1,
        "UnitCost": 30
      }
    ]
  }
}
```

### ✅ **Releasing a captured authorization hold**

```auto
{
  "TerminalNumber": 1001,
  "ApiName": "test2025",
  "Amount": 200,
  "Token": "4cf8e168-261e-4613-8d20-000332986b24",
  "CardExpirationMMYY": "1225",
  "ExternalUniqTranId": "h7rZ3#קV3Tp4!76-kLb0wUeG3zC",
  "ExternalUniqUniqTranIdResponse": false,
  "NumOfPayments": 1,
  "Advanced": {
    "ApprovalNumber": 204394904,
    "MTI": 420
  }
}
```

### ✅ **Credit charge (direct interface)**

```auto
{
  "TerminalNumber": 1001,
  "ApiName": "test2025",
  "Amount": 200,
  "CardNumber": "4580000000000000",
  "CardExpirationMMYY": "0628",
  "CVV2": "569",
  "ExternalUniqTranId": "h7rZs#4V3Tp!7kLb0wUeG3zC",
  "ExternalUniqUniqTranIdResponse": false,
  "NumOfPayments": 1
}
```

### ✅ **Credit charge + Document generation**

```auto
{
  "TerminalNumber": 1001,
  "ApiName": "test2025",
  "Amount": 200,
  "CardNumber": "4580000000000000",
  "CardExpirationMMYY": "0628",
  "CVV2": "569",
  "ExternalUniqTranId": "h7rZs#4V3Tp!7kLb0wUeG3zC",
  "ExternalUniqUniqTranIdResponse": false,
  "NumOfPayments": 1,
  "Document": {
    "DocumentTypeToCreate": "TaxInvoiceAndReceipt",
    "Name": "בדיקה",
    "TaxId": "040617640",
    "Email": "t@t.com",
    "IsSendByEmail": false,
    "IsVatFree": false,
    "Products": [
      {
        "Description": "מוצר בדיקה",
        "Quantity": 1,
        "UnitCost": 200
      }
    ]
  }
}
```

## מאמרים קשורים

*   [Step 1+2 – Creating a payment page & sending a request to retrieve transaction details (Iframe/Redirect)](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCJLkBZ3fGToYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCBJiYZTgGToLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSIBgS9oYy9oZS9hcnRpY2xlcy8yODQ0ODIwMjgxMDUxNC1TdGVwLTEtMi1DcmVhdGluZy1hLXBheW1lbnQtcGFnZS1zZW5kaW5nLWEtcmVxdWVzdC10by1yZXRyaWV2ZS10cmFuc2FjdGlvbi1kZXRhaWxzLUlmcmFtZS1SZWRpcmVjdAY7CFQ6CXJhbmtpBg%3D%3D--3cf35e40787158667847cc02e1d2f2c523bb1b18)
*   [שלב 1+2 - יצירת דף לתשלום & שליחת בקשה לקבלת פרטי עסקה (Iframe/ Redirect)](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCJJ%2FvFP6FjoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCBJiYZTgGToLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSICHwEvaGMvaGUvYXJ0aWNsZXMvMjUyNjQ0MDI0OTc0MjYtJUQ3JUE5JUQ3JTlDJUQ3JTkxLTEtMi0lRDclOTklRDclQTYlRDclOTklRDclQTglRDclQUEtJUQ3JTkzJUQ3JUEzLSVENyU5QyVENyVBQSVENyVBOSVENyU5QyVENyU5NSVENyU5RC0lRDclQTklRDclOUMlRDclOTklRDclOTclRDclQUEtJUQ3JTkxJUQ3JUE3JUQ3JUE5JUQ3JTk0LSVENyU5QyVENyVBNyVENyU5MSVENyU5QyVENyVBQS0lRDclQTQlRDclQTglRDclOTglRDclOTktJUQ3JUEyJUQ3JUExJUQ3JUE3JUQ3JTk0LUlmcmFtZS1SZWRpcmVjdAY7CFQ6CXJhbmtpBw%3D%3D--7ce93d51102ae12fcc0925926a791ca6d24d291a)
*   [שלב 3 - חיוב של אסימון \\ תפיסת מסגרת \\ חיוב פרטי אשראי בממשק ישיר. (Do Transaction)](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCJKNK3L7FjoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCBJiYZTgGToLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSICVAEvaGMvaGUvYXJ0aWNsZXMvMjUyNjkyMDgwNTkyODItJUQ3JUE5JUQ3JTlDJUQ3JTkxLTMtJUQ3JTk3JUQ3JTk5JUQ3JTk1JUQ3JTkxLSVENyVBOSVENyU5Qy0lRDclOTAlRDclQTElRDclOTklRDclOUUlRDclOTUlRDclOUYtJUQ3JUFBJUQ3JUE0JUQ3JTk5JUQ3JUExJUQ3JUFBLSVENyU5RSVENyVBMSVENyU5MiVENyVBOCVENyVBQS0lRDclOTclRDclOTklRDclOTUlRDclOTEtJUQ3JUE0JUQ3JUE4JUQ3JTk4JUQ3JTk5LSVENyU5MCVENyVBOSVENyVBOCVENyU5MCVENyU5OS0lRDclOTElRDclOUUlRDclOUUlRDclQTklRDclQTctJUQ3JTk5JUQ3JUE5JUQ3JTk5JUQ3JUE4LURvLVRyYW5zYWN0aW9uBjsIVDoJcmFua2kI--cb6e570b9fe3f3a690c98c580f0135a74b1ab875)
*   [Partial / Full Transaction Refund by Transaction ID (Refund By Transaction ID)](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCJLgO4ZdGjoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCBJiYZTgGToLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSJuL2hjL2hlL2FydGljbGVzLzI4OTg4OTg2MzUxNzYyLVBhcnRpYWwtRnVsbC1UcmFuc2FjdGlvbi1SZWZ1bmQtYnktVHJhbnNhY3Rpb24tSUQtUmVmdW5kLUJ5LVRyYW5zYWN0aW9uLUlEBjsIVDoJcmFua2kJ--2551d59bdd86047386743fe39143d0abf018c2c2)
*   [מידע לביצוע טסטים (למתכנת)](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCBJS%2BFWQGDoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCBJiYZTgGToLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSIBoC9oYy9oZS9hcnRpY2xlcy8yNzAwODE5NjY5NDU0Ni0lRDclOUUlRDclOTklRDclOTMlRDclQTItJUQ3JTlDJUQ3JTkxJUQ3JTk5JUQ3JUE2JUQ3JTk1JUQ3JUEyLSVENyU5OCVENyVBMSVENyU5OCVENyU5OSVENyU5RC0lRDclOUMlRDclOUUlRDclQUElRDclOUIlRDclQTAlRDclQUEGOwhUOglyYW5raQo%3D--28fff40cc4066014e3251b086b4aaf0ea262e2b4)

## הערות

0 הערות

[היכנס למערכת](https://cardcomsupporthelp.zendesk.com/access?locale=he&brand_id=25139821419794&return_to=https%3A%2F%2Fcardcomapi.zendesk.com%2Fhc%2Fhe%2Farticles%2F28452352778770-Step-3-Token-Charging-Frame-Capture-Direct-Interface-Credit-Card-Charging-Do-Transaction) כדי להגיב.

[מופעל על ידי Zendesk](https://www.zendesk.com/service/help-center/?utm_source=helpcenter&utm_medium=poweredbyzendesk&utm_campaign=text&utm_content=%D7%A7%D7%90%D7%A8%D7%93%D7%A7%D7%95%D7%9D)