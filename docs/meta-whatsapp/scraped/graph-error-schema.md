# WhatsApp Business Platform - Client WhatsApp Business Accounts API

Version

v23.0v24.0v25.0

Copy for LLM

[

View as Markdown](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/business/client-whatsapp-business-accounts-api/v25.0.md/)

[

Download OpenAPI spec](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/business/client-whatsapp-business-accounts-api/v25.0.openapi.yaml/)

Was this helpful?

API for retrieving client WhatsApp Business Accounts (WABAs) shared with a business.

This endpoint allows businesses to retrieve information about WhatsApp Business Accounts

that have been shared with them by other businesses or solution partners.

## Base URL

| 

https://graph.facebook.com

 |

## Endpoints

| 

GET

 | 

[/{Version}/{Business-ID}/client\_whatsapp\_business\_accounts](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/business/client-whatsapp-business-accounts-api#get-version-business-id-client-whatsapp-business-accounts)

 |

## GET /{Version}/{Business-ID}/client\_whatsapp\_business\_accounts

Retrieve a list of WhatsApp Business Accounts that have been shared with the specified business.

  

Use Cases:

-   Monitor shared WABA relationships and permissions
    
-   Verify WABA configuration and status information
    
-   Retrieve WABA details for business integrations
    
-   Manage multi-business WhatsApp messaging setups
    

  

Rate Limiting:

Standard Graph API rate limits apply. Use appropriate retry logic with exponential backoff.

  

Caching:

WABA information can be cached for moderate periods, but status information may change

frequently. Implement appropriate cache invalidation strategies.

### Request Syntax

**GET** /{Version}/{Business-ID}/client\_whatsapp\_business\_accounts

Try it

Select language

cURLJavaScriptPython

```shell
curl --request GET \  --url 'https://graph.facebook.com/{Version}/{Business-ID}/client_whatsapp_business_accounts' \  --header 'Authorization: Bearer <Token>' \  --header 'Content-Type: application/json' \  --data '{}'
```

Select status code

200400401403404422500

```json
{  "multiple_accounts": {    "summary": "Multiple client WhatsApp Business Accounts",    "value": {      "data": [        {          "id": "1234567890123456",          "name": "Client Business WABA A",          "account_review_status": "APPROVED",          "currency": "USD",          "country": "US",          "timezone_id": "1",          "business_verification_status": "VERIFIED",          "ownership_type": "CLIENT_OWNED",          "is_enabled_for_insights": true        },        {          "id": "2345678901234567",          "name": "Client Business WABA B",          "account_review_status": "PENDING",          "currency": "EUR",          "country": "DE",          "timezone_id": "5",          "business_verification_status": "PENDING",          "ownership_type": "AGENCY_OWNED",          "is_enabled_for_insights": false        }      ],      "paging": {        "cursors": {          "after": "QVFIUjNpUWpVWmRBd0Rn"        },        "next": "https://graph.facebook.com/v25.0/1234567890/client_whatsapp_business_accounts?after=QVFIUjNpUWpVWmRBd0Rn"      }    }  },  "single_account": {    "summary": "Single client WhatsApp Business Account",    "value": {      "data": [        {          "id": "1234567890123456",          "name": "Client Business WABA",          "account_review_status": "APPROVED",          "currency": "USD",          "country": "US",          "timezone_id": "1",          "business_verification_status": "VERIFIED",          "ownership_type": "CLIENT_OWNED"        }      ]    }  },  "empty_response": {    "summary": "No client WhatsApp Business Accounts",    "value": {      "data": []    }  }}
```

Header Parameters

User-Agentstring

The user agent string identifying the client software making the request.

Authorizationstring·required

Bearer token for API authentication. This should be a valid access token obtained through the appropriate OAuth flow or system user token.

Path Parameters

Versionstring·required

Graph API version to use for this request. Determines the API behavior and available features.

Business-IDstring·required

Your Business ID. This ID can be found in your Meta Business Suite URL

or through business management APIs.

Query Parameters

fieldsstring

Comma-separated list of fields to include in the response. If not specified,

default fields will be returned (id, name, currency, timezone\_id).

Available fields: id, name, account\_review\_status, purchase\_order\_number, audiences, ownership\_type, subscribed\_apps, business\_verification\_status, country, currency, timezone\_id, on\_behalf\_of\_business\_info, schedules, is\_enabled\_for\_insights, dcc\_config, message\_templates, phone\_numbers

business\_typearray of One of "STANDARD", "PREMIUM", "ENTERPRISE"

Filter results by WhatsApp Business Account type

limitinteger \[min: 1, max: 100\]

Maximum number of WhatsApp Business Accounts to return per page. Default is 25, maximum is 100.

afterstring

Cursor for pagination. Use this to get the next page of results.

beforestring

Cursor for pagination. Use this to get the previous page of results.

findstring

Find a specific WhatsApp Business Account by ID

Responses

200

Successfully retrieved client WhatsApp Business Accounts

Content Type: application/json

Schema: ClientWhatsAppBusinessAccountsResponse

Show child attributes

ClientWhatsAppBusinessAccountsResponse

dataarray of WhatsAppBusinessAccount

Array of client WhatsApp Business Accounts

Show child attributes

data\[\]WhatsAppBusinessAccount

WhatsApp Business Account details and configuration

Show child attributes

idstring·required

Unique identifier for the WhatsApp Business Account

namestring·required

Human-readable name of the WhatsApp Business Account

account\_review\_statusAccountReviewStatus

Review status of the WhatsApp Business Account

purchase\_order\_numberstring

Purchase order number associated with the account

audiencesarray of string

List of audience segments associated with the account

Show child attributes

audiences\[\]string

ownership\_typeOwnershipType

Type of ownership for the WhatsApp Business Account

subscribed\_appsarray of SubscribedApp

List of applications subscribed to this WABA

Show child attributes

subscribed\_apps\[\]SubscribedApp

Application subscribed to the WABA

Show child attributes

idstring

Application ID

namestring

Application name

business\_verification\_statusBusinessVerificationStatus

Verification status of the business associated with the WABA

countrystring

Country code where the WABA is registered

currencystring

Currency code for the WABA

timezone\_idstring

Timezone identifier for the WABA

on\_behalf\_of\_business\_infoOnBehalfOfBusinessInfo

Information about the business on whose behalf the WABA operates

Show child attributes

idstring

Business ID

namestring

Business name

schedulesarray of BusinessSchedule

Business hours and scheduling information

Show child attributes

schedules\[\]BusinessSchedule

Business hours schedule information

Show child attributes

day\_of\_weekOne of "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"

open\_timestring

Opening time in HH:MM format

close\_timestring

Closing time in HH:MM format

is\_enabled\_for\_insightsboolean

Whether insights are enabled for this WABA

dcc\_configDCCConfig

Data and Content Control configuration

Show child attributes

enabledboolean

Whether DCC is enabled

policy\_urlstring

URL to the DCC policy

message\_templatesarray of MessageTemplate

Message templates associated with the WABA

Show child attributes

message\_templates\[\]MessageTemplate

Message template information

Show child attributes

idstring

Template ID

namestring

Template name

statusOne of "APPROVED", "PENDING", "REJECTED", "DISABLED"

phone\_numbersarray of PhoneNumber

Phone numbers associated with the WABA

Show child attributes

phone\_numbers\[\]PhoneNumber

Phone number associated with the WABA

Show child attributes

idstring

Phone number ID

display\_phone\_numberstring

Formatted phone number for display

verified\_namestring

Verified business name for the phone number

pagingCursorPaging

Cursor-based pagination information

Show child attributes

cursorsobject

Show child attributes

beforestring

Cursor pointing to the start of the page of data

afterstring

Cursor pointing to the end of the page of data

previousstring

URL for the previous page of results

nextstring

URL for the next page of results

400

Bad Request - Invalid parameters or malformed request

Content Type: application/json

Schema: GraphAPIError

Show child attributes

GraphAPIError

errorobject·required

Show child attributes

messagestring·required

Human-readable error message

typestring·required

Error category type

codeinteger·required

Numeric error code

error\_subcodeinteger

More specific error subcode when available

fbtrace\_idstring

Unique identifier for debugging and support requests with Meta

is\_transientboolean

Indicates whether this error is temporary and the request should be retried

error\_user\_titlestring

User-friendly error title for display purposes

error\_user\_msgstring

User-friendly error message for display purposes

401

Unauthorized - Invalid or missing access token

Content Type: application/json

Schema: GraphAPIError

Show child attributes

GraphAPIError

errorobject·required

Show child attributes

messagestring·required

Human-readable error message

typestring·required

Error category type

codeinteger·required

Numeric error code

error\_subcodeinteger

More specific error subcode when available

fbtrace\_idstring

Unique identifier for debugging and support requests with Meta

is\_transientboolean

Indicates whether this error is temporary and the request should be retried

error\_user\_titlestring

User-friendly error title for display purposes

error\_user\_msgstring

User-friendly error message for display purposes

403

Forbidden - Insufficient permissions or access denied

Content Type: application/json

Schema: GraphAPIError

Show child attributes

GraphAPIError

errorobject·required

Show child attributes

messagestring·required

Human-readable error message

typestring·required

Error category type

codeinteger·required

Numeric error code

error\_subcodeinteger

More specific error subcode when available

fbtrace\_idstring

Unique identifier for debugging and support requests with Meta

is\_transientboolean

Indicates whether this error is temporary and the request should be retried

error\_user\_titlestring

User-friendly error title for display purposes

error\_user\_msgstring

User-friendly error message for display purposes

404

Not Found - Business ID does not exist or is not accessible

Content Type: application/json

Schema: GraphAPIError

Show child attributes

GraphAPIError

errorobject·required

Show child attributes

messagestring·required

Human-readable error message

typestring·required

Error category type

codeinteger·required

Numeric error code

error\_subcodeinteger

More specific error subcode when available

fbtrace\_idstring

Unique identifier for debugging and support requests with Meta

is\_transientboolean

Indicates whether this error is temporary and the request should be retried

error\_user\_titlestring

User-friendly error title for display purposes

error\_user\_msgstring

User-friendly error message for display purposes

422

Unprocessable Entity - Request parameters are valid but cannot be processed

Content Type: application/json

Schema: GraphAPIError

Show child attributes

GraphAPIError

errorobject·required

Show child attributes

messagestring·required

Human-readable error message

typestring·required

Error category type

codeinteger·required

Numeric error code

error\_subcodeinteger

More specific error subcode when available

fbtrace\_idstring

Unique identifier for debugging and support requests with Meta

is\_transientboolean

Indicates whether this error is temporary and the request should be retried

error\_user\_titlestring

User-friendly error title for display purposes

error\_user\_msgstring

User-friendly error message for display purposes

500

Internal Server Error - Unexpected server error

Content Type: application/json

Schema: GraphAPIError

Show child attributes

GraphAPIError

errorobject·required

Show child attributes

messagestring·required

Human-readable error message

typestring·required

Error category type

codeinteger·required

Numeric error code

error\_subcodeinteger

More specific error subcode when available

fbtrace\_idstring

Unique identifier for debugging and support requests with Meta

is\_transientboolean

Indicates whether this error is temporary and the request should be retried

error\_user\_titlestring

User-friendly error title for display purposes

error\_user\_msgstring

User-friendly error message for display purposes

Select language

cURLJavaScriptPython

```shell
curl --request GET \
  --url 'https://graph.facebook.com/{Version}/{Business-ID}/client_whatsapp_business_accounts' \
  --header 'Authorization: Bearer <Token>' \
  --header 'Content-Type: application/json' \
  --data '{}'
```

Select status code

200400401403404422500

```json
{
  "multiple_accounts": {
    "summary": "Multiple client WhatsApp Business Accounts",
    "value": {
      "data": [
        {
          "id": "1234567890123456",
          "name": "Client Business WABA A",
          "account_review_status": "APPROVED",
          "currency": "USD",
          "country": "US",
          "timezone_id": "1",
          "business_verification_status": "VERIFIED",
          "ownership_type": "CLIENT_OWNED",
          "is_enabled_for_insights": true
        },
        {
          "id": "2345678901234567",
          "name": "Client Business WABA B",
          "account_review_status": "PENDING",
          "currency": "EUR",
          "country": "DE",
          "timezone_id": "5",
          "business_verification_status": "PENDING",
          "ownership_type": "AGENCY_OWNED",
          "is_enabled_for_insights": false
        }
      ],
      "paging": {
        "cursors": {
          "after": "QVFIUjNpUWpVWmRBd0Rn"
        },
        "next": "https://graph.facebook.com/v25.0/1234567890/client_whatsapp_business_accounts?after=QVFIUjNpUWpVWmRBd0Rn"
      }
    }
  },
  "single_account": {
    "summary": "Single client WhatsApp Business Account",
    "value": {
      "data": [
        {
          "id": "1234567890123456",
          "name": "Client Business WABA",
          "account_review_status": "APPROVED",
          "currency": "USD",
          "country": "US",
          "timezone_id": "1",
          "business_verification_status": "VERIFIED",
          "ownership_type": "CLIENT_OWNED"
        }
      ]
    }
  },
  "empty_response": {
    "summary": "No client WhatsApp Business Accounts",
    "value": {
      "data": []
    }
  }
}
```

## Authentication

| 

**Scheme**

 | 

**Type**

 | 

**Location**

 |
| 

Bearer token















 | 

HTTP Bearer















 | 

Header: `Authorization`















 |

### Usage Examples

Bearer token:

Include `Authorization: Bearer your-token-here` in request headers

### Global Authentication Requirements

All endpoints require:

Bearer token
