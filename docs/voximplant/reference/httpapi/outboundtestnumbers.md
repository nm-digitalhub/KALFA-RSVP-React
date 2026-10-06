# OutboundTestNumbers  (ref_folder)


## ActivateOutboundTestPhoneNumber  (api_method)

Activates the phone number by the verification code.

**Returns:** 

- `verification_code` — The verification code, see the [VerifyOutboundTestPhoneNumber](/docs/references/httpapi/outboundtestnumbers#verifyoutboundtestphonenumber) function


## AddOutboundTestPhoneNumber  (api_method)

Adds a personal phone number to test outgoing calls. Only one personal phone number can be used. To replace it with another, delete the existing one first.

**Returns:** 

- `phone_number` — The personal phone number in the E.164 format


## DelOutboundTestPhoneNumber  (api_method)

Deletes the existing phone number.

**Returns:** 


## GetOutboundTestPhoneNumbers  (api_method)

Shows the phone number info.

**Returns:** 


## VerifyOutboundTestPhoneNumber  (api_method)

Starts a call to the added phone number and pronounces a verification code. You have only 5 verification attempts per day and 100 in total. 1 minute should pass between 2 attempts.

**Returns:** 
