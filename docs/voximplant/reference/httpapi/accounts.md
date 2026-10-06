# Accounts  (ref_folder)


## AddAccount  (api_method)

Adds a new <b>child</b> account.

_roles: Owner, Admin_

**Returns:** 

- `account_custom_data` — The custom data

- `account_email` — The unique email of the new account

- `account_first_name` — The first name

- `account_last_name` — The last name

- `account_name` — Account's name should be at least 5 and up to 20 characters long. Account's name should start with a letter and can contain latin characters in lowercase, digits, hyphen

- `account_notifications` — Whether Voximplant notifications are required. For a new child account, the default value is false

- `account_password` — The account password. Should be at least 8 characters long and contain at least one uppercase and lowercase letter, one number, and one special character

- `active` — Whether the child account is active (The admin permission required to activate the normal account only)

- `language_code` — The notification language code (2 symbols, ISO639-1). The following values are available: aa (Afar), ab (Abkhazian), af (Afrikaans), am (Amharic), ar (Arabic), as (Assamese), ay (Aymara), az (Azerbaijani), ba (Bashkir), be (Belarusian), bg (Bulgarian), bh (Bihari), bi (Bislama), bn (Bengali), bo (Tibetan), br (Breton), ca (Catalan), co (Corsican), cs (Czech), cy (Welch), da (Danish), de (German), dz (Bhutani), el (Greek), en (English), eo (Esperanto), es (Spanish), et (Estonian), eu (Basque), fa (Persian), fi (Finnish), fj (Fiji), fo (Faeroese), fr (French), fy (Frisian), ga (Irish), gd (Scots Gaelic), gl (Galician), gn (Guarani), gu (Gujarati), ha (Hausa), hi (Hindi), he (Hebrew), hr (Croatian), hu (Hungarian), hy (Armenian), ia (Interlingua), id (Indonesian), ie (Interlingue), ik (Inupiak), in (Indonesian), is (Icelandic), it (Italian), iu (Inuktitut), iw (Hebrew), ja (Japanese), ji (Yiddish), jw (Javanese), ka (Georgian), kk (Kazakh), kl (Greenlandic), km (Cambodian), kn (Kannada), ko (Korean), ks (Kashmiri), ku (Kurdish), ky (Kirghiz), la (Latin), ln (Lingala), lo (Laothian), lt (Lithuanian), lv (Latvian), mg (Malagasy), mi (Maori), mk (Macedonian), ml (Malayalam), mn (Mongolian), mo (Moldavian), mr (Marathi), ms (Malay), mt (Maltese), my (Burmese), na (Nauru), ne (Nepali), nl (Dutch), no (Norwegian), oc (Occitan), om (Oromo), or (Oriya), pa (Punjabi), pl (Polish), ps (Pashto), pt (Portuguese), qu (Quechua), rm (Rhaeto-Romance), rn (Kirundi), ro (Romanian), ru (Russian), rw (Kinyarwanda), sa (Sanskrit), sd (Sindhi), sg (Sangro), sh (Serbo-Croatian), si (Singhalese), sk (Slovak), sl (Slovenian), sm (Samoan), sn (Shona), so (Somali), sq (Albanian), sr (Serbian), ss (Siswati), st (Sesotho), su (Sudanese), sv (Swedish), sw (Swahili), ta (Tamil), te (Tegulu), tg (Tajik), th (Thai), ti (Tigrinya), tk (Turkmen), tl (Tagalog), tn (Setswana), to (Tonga), tr (Turkish), ts (Tsonga), tt (Tatar), tw (Twi), ug (Uigur), uk (Ukrainian), ur (Urdu), uz (Uzbek), vi (Vietnamese), vo (Volapuk), wo (Wolof), xh (Xhosa), yi (Yiddish), yo (Yoruba), za (Zhuang), zh (Chinese), zu (Zulu)

- `location` — The account location (timezone). Examples: America/Los_Angeles, Etc/GMT-8, Etc/GMT+10

- `min_balance_to_notify` — The minimum balance value to notify by email or SMS. The default value is $5

- `news_notifications` — Whether Voximplant news notifications are required. For a new child account, the default value is false

- `parent_account_api_key` — The parent account API key. <b>Required</b> unless <b>parent_account_password</b> or <b>session_id</b> is provided.

- `parent_account_email` — The parent account email. <b>Required</b> unless <b>parent_account_id</b> or <b>parent_account_name</b> is provided.

- `parent_account_id` — The parent account ID. <b>Required</b> unless <b>parent_account_name</b> or <b>parent_account_email</b> is provided.

- `parent_account_name` — The parent account name. <b>Required</b> unless <b>parent_account_id</b> or <b>parent_account_email</b> is provided.

- `parent_account_password` — The parent account password. <b>Required</b> unless <b>parent_account_api_key</b> or <b>session_id</b> is provided.

- `record_storage_id` — The record storage id. Can be used instead of the <b>record_storage_name</b> parameter

- `record_storage_name` — The record storage name. Can be used instead of the <b>record_storage_id</b> parameter

- `tariff_changing_notifications` — Whether Voximplant plan changing notifications are required. For a new child account, the default value is false


## ChangeAccountPlan  (api_method)

Configures the account's plan.<br><br>Please note that when you change the billing plan, we reserve the subscription fee and taxes for the upcoming month. Read more in the <a href='/docs/gettingstarted/billing'>Billing</a> page.

**Returns:** 

- `plan_subscription_template_id` — The new plan ID with a price larger than the current plan's (see [GetAvailablePlans](/docs/references/httpapi/accounts#getavailableplans))

- `plan_type` — The plan type to config. The possible values are IM, MAU


## CloneAccount  (api_method)

Clones a child account.

_roles: Admin_

**Returns:** 

- `account_custom_data` — The custom data

- `account_email` — The cloning account email. <b>Required</b> unless <b>account_id</b> or <b>account_name</b> is provided.

- `account_first_name` — The first name

- `account_id` — The cloning account ID. <b>Required</b> unless <b>account_name</b> or <b>account_email</b> is provided.

- `account_last_name` — The last name

- `account_name` — The cloning account name. <b>Required</b> unless <b>account_id</b> or <b>account_email</b> is provided.

- `language_code` — The notification language code (2 symbols, ISO639-1). The following values are available: aa (Afar), ab (Abkhazian), af (Afrikaans), am (Amharic), ar (Arabic), as (Assamese), ay (Aymara), az (Azerbaijani), ba (Bashkir), be (Belarusian), bg (Bulgarian), bh (Bihari), bi (Bislama), bn (Bengali), bo (Tibetan), br (Breton), ca (Catalan), co (Corsican), cs (Czech), cy (Welch), da (Danish), de (German), dz (Bhutani), el (Greek), en (English), eo (Esperanto), es (Spanish), et (Estonian), eu (Basque), fa (Persian), fi (Finnish), fj (Fiji), fo (Faeroese), fr (French), fy (Frisian), ga (Irish), gd (Scots Gaelic), gl (Galician), gn (Guarani), gu (Gujarati), ha (Hausa), hi (Hindi), he (Hebrew), hr (Croatian), hu (Hungarian), hy (Armenian), ia (Interlingua), id (Indonesian), ie (Interlingue), ik (Inupiak), in (Indonesian), is (Icelandic), it (Italian), iu (Inuktitut), iw (Hebrew), ja (Japanese), ji (Yiddish), jw (Javanese), ka (Georgian), kk (Kazakh), kl (Greenlandic), km (Cambodian), kn (Kannada), ko (Korean), ks (Kashmiri), ku (Kurdish), ky (Kirghiz), la (Latin), ln (Lingala), lo (Laothian), lt (Lithuanian), lv (Latvian), mg (Malagasy), mi (Maori), mk (Macedonian), ml (Malayalam), mn (Mongolian), mo (Moldavian), mr (Marathi), ms (Malay), mt (Maltese), my (Burmese), na (Nauru), ne (Nepali), nl (Dutch), no (Norwegian), oc (Occitan), om (Oromo), or (Oriya), pa (Punjabi), pl (Polish), ps (Pashto), pt (Portuguese), qu (Quechua), rm (Rhaeto-Romance), rn (Kirundi), ro (Romanian), ru (Russian), rw (Kinyarwanda), sa (Sanskrit), sd (Sindhi), sg (Sangro), sh (Serbo-Croatian), si (Singhalese), sk (Slovak), sl (Slovenian), sm (Samoan), sn (Shona), so (Somali), sq (Albanian), sr (Serbian), ss (Siswati), st (Sesotho), su (Sudanese), sv (Swedish), sw (Swahili), ta (Tamil), te (Tegulu), tg (Tajik), th (Thai), ti (Tigrinya), tk (Turkmen), tl (Tagalog), tn (Setswana), to (Tonga), tr (Turkish), ts (Tsonga), tt (Tatar), tw (Twi), ug (Uigur), uk (Ukrainian), ur (Urdu), uz (Uzbek), vi (Vietnamese), vo (Volapuk), wo (Wolof), xh (Xhosa), yi (Yiddish), yo (Yoruba), za (Zhuang), zh (Chinese), zu (Zulu)

- `location` — The account location (timezone). Examples: America/Los_Angeles, Etc/GMT-8, Etc/GMT+10

- `new_account_email` — The new account email

- `new_account_name` — The new account's name should be at least 5 and up to 20 characters long. Account's name should start with a letter and can contain latin characters in lowercase, digits, hyphen

- `new_account_password` — The new account password. Should be at least 8 characters long and contain at least one uppercase and lowercase letter, one number, and one special character

- `parent_account_api_key` — The parent account API key. <b>Required</b> unless <b>parent_account_password</b> or <b>session_id</b> is provided.

- `parent_account_password` — The parent account password. <b>Required</b> unless <b>parent_account_api_key</b> or <b>session_id</b> is provided.


## GetAccountDocuments  (api_method)

Gets the account documents and the verification states.<br><br>This method will be deprecated in the next versions. We recommend to use the [GetAccountVerifications](/docs/references/httpapi/accounts#getaccountverifications) method to get all the verifications and statuses for the account.

_roles: Owner, Admin, Accountant, Payer_

**Returns:** 

- `child_account_id` — The child account ID list separated by semicolons (;). Use the 'all' value to select all child accounts

- `children_verifications_only` — Whether to get the children account verifications only

- `from_unverified_hold_until` — Unverified subscriptions hold until the date (from ...) in the following format: YYYY-MM-DD

- `to_unverified_hold_until` — Unverified subscriptions hold until the date (... to) in the following format: YYYY-MM-DD

- `verification_name` — The required account verification name to filter

- `verification_status` — The account verification status list separated by semicolons (;). The following values are possible: REQUIRED, IN_PROGRESS, VERIFIED

- `with_details` — Whether to view the uploaded document statuses. (The flag is ignored with the child_account_id=all)


## GetAccountInfo  (api_method)

Gets the account's info such as account_id, account_name, account_email etc.

**Returns:** 

- `return_live_balance` — Whether to get the account's live balance


## GetAccountPlans  (api_method)

Gets the account plans with packages.

**Returns:** 

- `plan_subscription_template_id` — The plan ID list separated by semicolons (;)

- `plan_type` — The plan type list separated by semicolons (;). The possible values are IM, MAU


## GetAccountVerifications  (api_method)

Gets all RU verifications for the specified account.

_roles: Owner, Admin, Accountant, Payer_

**Returns:** 

- `account_id` — Account ID to check verifications for


## GetAvailablePlans  (api_method)

Gets the allowed plans to change.

**Returns:** 

- `plan_subscription_template_id` — The plan ID list separated by semicolons (;)

- `plan_type` — The plan type list separated by semicolons (;). The possible values are IM, MAU


## GetChildrenAccounts  (api_method)

Gets the info about all children accounts.

_roles: Owner_

**Returns:** 

- `active` — Whether the filter is active

- `brief_output` — Whether to output the account_id only

- `child_account_email` — The child account email to filter. You need to specify at least one of the following parameters: `child_account_id`, `child_account_name`, `child_account_email`

- `child_account_id` — The account ID list separated by semicolons (;). You need to specify at least one of the following parameters: `child_account_id`, `child_account_name`, `child_account_email`

- `child_account_name` — The child account name to filter. You need to specify at least one of the following parameters: `child_account_id`, `child_account_name`, `child_account_email`

- `count` — The maximum returning record count. The default value applies to the full output only and is capped at 1000; with <b>brief_output</b> or <b>medium_output</b> all the records are returned unless this parameter is set

- `frozen` — Whether the filter is frozen

- `ignore_invalid_accounts` — Whether to ignore the invalid 'child_account_id' items

- `medium_output` — Whether to output the account_id, account_name, account_email only

- `offset` — The first <b>N</b> records are skipped in the output

- `order_by` — The following values are available: 'child_account_id', 'child_account_name' and 'child_account_email'

- `return_live_balance` — Whether to get the user live balance


## GetCurrencyRate  (api_method)

Gets the exchange rate on selected date (per USD).

**Returns:** 

- `currency` — The currency code list separated by semicolons (;). Examples: RUR, KZT, EUR, USD

- `date` — The date, format: YYYY-MM-DD


## GetMoneyAmountToCharge  (api_method)

Get the recommended money amount to charge.

_roles: Owner, Admin, Accountant, Payer_

**Returns:** 

- `charge_date` — The next charge date, format: YYYY-MM-DD

- `currency` — The currency name. Examples: USD, RUR, EUR


## GetResourcePrice  (api_method)

Gets the resource price. If the resource is not specified, returns all available resources with prices.

**Returns:** 

- `price_group_id` — The price group ID list separated by semicolons (;)

- `price_group_name` — The price group name template to filter

- `resource_param` — The resource parameter list separated by semicolons (;). Example: a phone number list

- `resource_type` — The resource type list separated by semicolons (;). The possible values are: <ul><li><strong>A2P_SMS_E212</strong> — Service SMS</li><li><strong>ASR</strong> — Speech recognition</li><li><strong>ASR_AWS</strong> — Speech recognition by Amazon</li><li><strong>ASR_DEEPGRAM</strong> — Speech recognition by Deepgram</li><li><strong>ASR_GOOGLE_ENHANCED</strong> — Speech recognition by Google</li><li><strong>ASR_SMARTSPEECH</strong> — Speech recognition by SmartSpeech</li><li><strong>ASR_YANDEX</strong> — Speech recognition by Yandex</li><li><strong>AUDIOHDCONFERENCE</strong> — HD audio conferencing</li><li><strong>AUDIOHDRECORD</strong> — HD audio call recording</li><li><strong>AUDIORECORD</strong> — Audio call recording</li><li><strong>CALLSESSION</strong> — Simultaneous sessions per account</li><li><strong>DIALOGFLOW</strong> — Dialogflow ES</li><li><strong>DIALOGFLOW_CX</strong> — Dialogflow CX</li><li><strong>IM_OVERRUN</strong> — Exceeding instant messages</li><li><strong>KV_STORAGE</strong> — Key-value storage</li><li><strong>MAU_OVERRUN</strong> — Exceeding monthly active users</li><li><strong>NLU</strong> — Avatar requests</li><li><strong>PSTN_IN_ALASKA</strong> — Incoming phone calls to Alaska phone numbers</li><li><strong>PSTN_IN_GB</strong> — Incoming phone calls to United Kingdom phone numbers</li><li><strong>PSTN_IN_GEO_AE</strong> — Incoming geographical phone calls to UAE phone numbers</li><li><strong>PSTN_IN_GEO_AO</strong> — Incoming geographical phone calls to Angola phone numbers</li><li><strong>PSTN_IN_GEO_BH</strong> — Incoming geographical phone calls to Bahrain phone numbers</li><li><strong>PSTN_IN_GEO_BR</strong> — Incoming geographical phone calls to Brazil phone numbers</li><li><strong>PSTN_IN_GEO_CN</strong> — Incoming geographical phone calls to China phone numbers</li><li><strong>PSTN_IN_GEO_EC</strong> — Incoming geographical phone calls to Ecuador phone numbers</li><li><strong>PSTN_IN_GEO_IN</strong> — Incoming geographical phone calls to India phone numbers</li><li><strong>PSTN_IN_GEO_JO</strong> — Incoming geographical phone calls to Jordan phone numbers</li><li><strong>PSTN_IN_GEO_JP</strong> — Incoming geographical phone calls to Japan phone numbers</li><li><strong>PSTN_IN_GEO_KG</strong> — Incoming geographical phone calls to Kyrgyzstan phone numbers</li><li><strong>PSTN_IN_GEO_KH</strong> — Incoming geographical phone calls to Cambodia phone numbers</li><li><strong>PSTN_IN_GEO_MA</strong> — Incoming geographical phone calls to Morocco phone numbers</li><li><strong>PSTN_IN_GEO_NG</strong> — Incoming geographical phone calls to Nigeria phone numbers</li><li><strong>PSTN_IN_GEO_PE</strong> — Incoming geographical phone calls to Peru phone numbers</li><li><strong>PSTN_IN_GEO_PH</strong> — Incoming geographical phone calls to Philippines phone numbers</li><li><strong>PSTN_IN_GEO_PK</strong> — Incoming geographical phone calls to Pakistan phone numbers</li><li><strong>PSTN_IN_GEO_PY</strong> — Incoming geographical phone calls to Paraguay phone numbers</li><li><strong>PSTN_IN_GEO_RS</strong> — Incoming geographical phone calls to Serbia phone numbers</li><li><strong>PSTN_IN_GEO_SA</strong> — Incoming geographical phone calls to Saudi Arabia phone numbers</li><li><strong>PSTN_IN_GEO_UG</strong> — Incoming geographical phone calls to Uganda phone numbers</li><li><strong>PSTN_IN_GEO_UY</strong> — Incoming geographical phone calls to Uruguay phone numbers</li><li><strong>PSTN_IN_GEO_UZ</strong> — Incoming geographical phone calls to Uzbekistan phone numbers</li><li><strong>PSTN_IN_GEO_VN</strong> — Incoming geographical phone calls to Vietnam phone numbers</li><li><strong>PSTN_IN_GEOGRAPHIC</strong> — Incoming geographical phone calls</li><li><strong>PSTN_IN_MOB_AU</strong> — Incoming mobile phone calls to Australia phone numbers</li><li><strong>PSTN_IN_MOB_BD</strong> — Incoming mobile phone calls to Bangladesh phone numbers</li><li><strong>PSTN_IN_MOB_BE</strong> — Incoming mobile phone calls to Belgium phone numbers</li><li><strong>PSTN_IN_MOB_BR</strong> — Incoming mobile phone calls to Brazil phone numbers</li><li><strong>PSTN_IN_MOB_CA</strong> — Incoming mobile phone calls to Canada phone numbers</li><li><strong>PSTN_IN_MOB_CO</strong> — Incoming mobile phone calls to Colombia phone numbers</li><li><strong>PSTN_IN_MOB_DK</strong> — Incoming mobile phone calls to Denmark phone numbers</li><li><strong>PSTN_IN_MOB_EG</strong> — Incoming mobile phone calls to Egypt phone numbers</li><li><strong>PSTN_IN_MOB_FI</strong> — Incoming mobile phone calls to Finland phone numbers</li><li><strong>PSTN_IN_MOB_GB</strong> — Incoming mobile phone calls to United Kingdom phone numbers</li><li><strong>PSTN_IN_MOB_HK</strong> — Incoming mobile phone calls to Hong Kong phone numbers</li><li><strong>PSTN_IN_MOB_ID</strong> — Incoming mobile phone calls to Indonesia phone numbers</li><li><strong>PSTN_IN_MOB_IL</strong> — Incoming mobile phone calls to Israel phone numbers</li><li><strong>PSTN_IN_MOB_IN</strong> — Incoming mobile phone calls to India phone numbers</li><li><strong>PSTN_IN_MOB_KZ</strong> — Incoming mobile phone calls to Kazakhstan phone numbers</li><li><strong>PSTN_IN_MOB_LA</strong> — Incoming mobile phone calls to Laos phone numbers</li><li><strong>PSTN_IN_MOB_LV</strong> — Incoming mobile phone calls to Latvia phone numbers</li><li><strong>PSTN_IN_MOB_MU</strong> — Incoming mobile phone calls to Mauritius phone numbers</li><li><strong>PSTN_IN_MOB_MX</strong> — Incoming mobile phone calls to Mexico phone numbers</li><li><strong>PSTN_IN_MOB_MY</strong> — Incoming mobile phone calls to Malaysia phone numbers</li><li><strong>PSTN_IN_MOB_NI</strong> — Incoming mobile phone calls to Nicaragua phone numbers</li><li><strong>PSTN_IN_MOB_NL</strong> — Incoming mobile phone calls to the Netherlands phone numbers</li><li><strong>PSTN_IN_MOB_NP</strong> — Incoming mobile phone calls to Nepal phone numbers</li><li><strong>PSTN_IN_MOB_PE</strong> — Incoming mobile phone calls to Peru phone numbers</li><li><strong>PSTN_IN_MOB_PL</strong> — Incoming mobile phone calls to Poland phone numbers</li><li><strong>PSTN_IN_MOB_PR</strong> — Incoming mobile phone calls to Puerto Rico phone numbers</li><li><strong>PSTN_IN_MOB_PT</strong> — Incoming mobile phone calls to Portugal phone numbers</li><li><strong>PSTN_IN_MOB_RU</strong> — Incoming mobile phone calls to Russia phone numbers</li><li><strong>PSTN_IN_MOB_SE</strong> — Incoming mobile phone calls to Sweden phone numbers</li><li><strong>PSTN_IN_MOB_US</strong> — Incoming mobile phone calls to the United States phone numbers</li><li><strong>PSTN_IN_NATIONAL_AM</strong> — Incoming national phone calls to Armenia phone numbers</li><li><strong>PSTN_IN_NATIONAL_BO</strong> — Incoming national phone calls to Bolivia phone numbers</li><li><strong>PSTN_IN_NATIONAL_HN</strong> — Incoming national phone calls to Honduras phone numbers</li><li><strong>PSTN_IN_NATIONAL_JM</strong> — Incoming national phone calls to Jamaica phone numbers</li><li><strong>PSTN_IN_RU</strong> — Incoming phone calls to Russia phone numbers</li><li><strong>PSTN_IN_RU_TOLLFREE</strong> — Incoming toll-free phone calls to Russia phone numbers</li><li><strong>PSTN_IN_SC_AU</strong> — Incoming phone calls to Australia phone numbers</li><li><strong>PSTN_IN_STAR_RU</strong> — Incoming phone calls to Russia phone numbers</li><li><strong>PSTN_IN_TF_AR</strong> — Incoming toll-free phone calls to Argentina phone numbers</li><li><strong>PSTN_IN_TF_AT</strong> — Incoming toll-free phone calls to Austria phone numbers</li><li><strong>PSTN_IN_TF_AU</strong> — Incoming toll-free phone calls to Australia phone numbers</li><li><strong>PSTN_IN_TF_BE</strong> — Incoming toll-free phone calls to Belgium phone numbers</li><li><strong>PSTN_IN_TF_BG</strong> — Incoming toll-free phone calls to Bulgaria phone numbers</li><li><strong>PSTN_IN_TF_BH</strong> — Incoming toll-free phone calls to Bahrain phone numbers</li><li><strong>PSTN_IN_TF_BR</strong> — Incoming toll-free phone calls to Brazil phone numbers</li><li><strong>PSTN_IN_TF_BY</strong> — Incoming toll-free phone calls to Belarus phone numbers</li><li><strong>PSTN_IN_TF_CA</strong> — Incoming toll-free phone calls to Canada phone numbers</li><li><strong>PSTN_IN_TF_CH</strong> — Incoming toll-free phone calls to Switzerland phone numbers</li><li><strong>PSTN_IN_TF_CL</strong> — Incoming toll-free phone calls to Chile phone numbers</li><li><strong>PSTN_IN_TF_CO</strong> — Incoming toll-free phone calls to Colombia phone numbers</li><li><strong>PSTN_IN_TF_CR</strong> — Incoming toll-free phone calls to Costa Rica phone numbers</li><li><strong>PSTN_IN_TF_CY</strong> — Incoming toll-free phone calls to Cyprus phone numbers</li><li><strong>PSTN_IN_TF_CZ</strong> — Incoming toll-free phone calls to Czechia phone numbers</li><li><strong>PSTN_IN_TF_DE</strong> — Incoming toll-free phone calls to Germany phone numbers</li><li><strong>PSTN_IN_TF_DK</strong> — Incoming toll-free phone calls to Denmark phone numbers</li><li><strong>PSTN_IN_TF_DO</strong> — Incoming toll-free phone calls to Dominican Republic phone numbers</li><li><strong>PSTN_IN_TF_EC</strong> — Incoming toll-free phone calls to Ecuador phone numbers</li><li><strong>PSTN_IN_TF_EE</strong> — Incoming toll-free phone calls to Estonia phone numbers</li><li><strong>PSTN_IN_TF_EG</strong> — Incoming toll-free phone calls to Egypt phone numbers</li><li><strong>PSTN_IN_TF_ES</strong> — Incoming toll-free phone calls to Spain phone numbers</li><li><strong>PSTN_IN_TF_FI</strong> — Incoming toll-free phone calls to Finland phone numbers</li><li><strong>PSTN_IN_TF_FR</strong> — Incoming toll-free phone calls to France phone numbers</li><li><strong>PSTN_IN_TF_GB</strong> — Incoming toll-free phone calls to the United Kingdom phone numbers</li><li><strong>PSTN_IN_TF_GF</strong> — Incoming toll-free phone calls to French Guiana phone numbers</li><li><strong>PSTN_IN_TF_GP</strong> — Incoming toll-free phone calls to Guadeloupe phone numbers</li><li><strong>PSTN_IN_TF_HK</strong> — Incoming toll-free phone calls to Hong Kong phone numbers</li><li><strong>PSTN_IN_TF_HR</strong> — Incoming toll-free phone calls to Croatia phone numbers</li><li><strong>PSTN_IN_TF_HU</strong> — Incoming toll-free phone calls to Hungary phone numbers</li><li><strong>PSTN_IN_TF_ID</strong> — Incoming toll-free phone calls to Indonesia phone numbers</li><li><strong>PSTN_IN_TF_IE</strong> — Incoming toll-free phone calls to Ireland phone numbers</li><li><strong>PSTN_IN_TF_IL</strong> — Incoming toll-free phone calls to Israel phone numbers</li><li><strong>PSTN_IN_TF_IN</strong> — Incoming toll-free phone calls to India phone numbers</li><li><strong>PSTN_IN_TF_IS</strong> — Incoming toll-free phone calls to Iceland phone numbers</li><li><strong>PSTN_IN_TF_IT</strong> — Incoming toll-free phone calls to Italy phone numbers</li><li><strong>PSTN_IN_TF_KE</strong> — Incoming toll-free phone calls to Kenya phone numbers</li><li><strong>PSTN_IN_TF_KR</strong> — Incoming toll-free phone calls to South Korea phone numbers</li><li><strong>PSTN_IN_TF_KW</strong> — Incoming toll-free phone calls to Kuwait phone numbers</li><li><strong>PSTN_IN_TF_KZ</strong> — Incoming toll-free phone calls to Kazakhstan phone numbers</li><li><strong>PSTN_IN_TF_LT</strong> — Incoming toll-free phone calls to Lithuania phone numbers</li><li><strong>PSTN_IN_TF_LV</strong> — Incoming toll-free phone calls to Latvia phone numbers</li><li><strong>PSTN_IN_TF_MC</strong> — Incoming toll-free phone calls to Monaco phone numbers</li><li><strong>PSTN_IN_TF_MK</strong> — Incoming toll-free phone calls to North Macedonia phone numbers</li><li><strong>PSTN_IN_TF_MQ</strong> — Incoming toll-free phone calls to Martinique phone numbers</li><li><strong>PSTN_IN_TF_MT</strong> — Incoming toll-free phone calls to Malta phone numbers</li><li><strong>PSTN_IN_TF_MX</strong> — Incoming toll-free phone calls to Mexico phone numbers</li><li><strong>PSTN_IN_TF_NL</strong> — Incoming toll-free phone calls to the Netherlands phone numbers</li><li><strong>PSTN_IN_TF_NZ</strong> — Incoming toll-free phone calls to New Zealand phone numbers</li><li><strong>PSTN_IN_TF_OM</strong> — Incoming toll-free phone calls to Oman phone numbers</li><li><strong>PSTN_IN_TF_PA</strong> — Incoming toll-free phone calls to Panama phone numbers</li><li><strong>PSTN_IN_TF_PE</strong> — Incoming toll-free phone calls to Peru phone numbers</li><li><strong>PSTN_IN_TF_PK</strong> — Incoming toll-free phone calls to Pakistan phone numbers</li><li><strong>PSTN_IN_TF_PR</strong> — Incoming toll-free phone calls to Puerto Rico phone numbers</li><li><strong>PSTN_IN_TF_QA</strong> — Incoming toll-free phone calls to Qatar phone numbers</li><li><strong>PSTN_IN_TF_RE</strong> — Incoming toll-free phone calls to Reunion phone numbers</li><li><strong>PSTN_IN_TF_RO</strong> — Incoming toll-free phone calls to Romania phone numbers</li><li><strong>PSTN_IN_TF_RS</strong> — Incoming toll-free phone calls to Serbia phone numbers</li><li><strong>PSTN_IN_TF_SA</strong> — Incoming toll-free phone calls to Saudi Arabia phone numbers</li><li><strong>PSTN_IN_TF_SE</strong> — Incoming toll-free phone calls to Sweden phone numbers</li><li><strong>PSTN_IN_TF_SI</strong> — Incoming toll-free phone calls to Slovenia phone numbers</li><li><strong>PSTN_IN_TF_SK</strong> — Incoming toll-free phone calls to Slovakia phone numbers</li><li><strong>PSTN_IN_TF_TH</strong> — Incoming toll-free phone calls to Thailand phone numbers</li><li><strong>PSTN_IN_TF_UA</strong> — Incoming toll-free phone calls to Ukraine phone numbers</li><li><strong>PSTN_IN_TF_UG</strong> — Incoming toll-free phone calls to Uganda phone numbers</li><li><strong>PSTN_IN_TF_US</strong> — Incoming toll-free phone calls to the United States phone numbers</li><li><strong>PSTN_IN_TF_VE</strong> — Incoming toll-free phone calls to Venezuela phone numbers</li><li><strong>PSTN_IN_TF_YT</strong> — Incoming toll-free phone calls to Mayotte phone numbers</li><li><strong>PSTN_IN_TF_ZA</strong> — Incoming toll-free phone calls to South Africa phone numbers</li><li><strong>PSTN_IN_US</strong> — Incoming phone calls to the United States phone numbers</li><li><strong>PSTN_INTERNATIONAL</strong> — Outgoing international calls</li><li><strong>PSTN_OUT_INCOUNTRY</strong> — Outgoing domestic phone calls</li><li><strong>PSTN_OUT_LOCAL_RU</strong> — Outgoing domestic phone calls in Russia</li><li><strong>PSTNOUT</strong> — Outgoing phone calls</li><li><strong>PSTNOUT_EEA</strong> — Outgoing phone calls to EEA</li><li><strong>PSTNOUT_LOCAL</strong> — Outgoing local phone calls</li><li><strong>RELAYED_TRAFFIC</strong> — TURN server relayed traffic</li><li><strong>SIPIN</strong> — Incoming SIP calls</li><li><strong>SIPOUT</strong> — Outgoing SIP calls</li><li><strong>SIPREFER</strong> — Call transfer via SIP REFER</li><li><strong>SMS_IN_MOB_AU</strong> — Incoming SMS to Australia phone numbers</li><li><strong>SMS_IN_MOB_BE</strong> — Incoming SMS to Belgium phone numbers</li><li><strong>SMS_IN_MOB_BR</strong> — Incoming SMS to Brazil phone numbers</li><li><strong>SMS_IN_MOB_CA</strong> — Incoming SMS to Canada phone numbers</li><li><strong>SMS_IN_MOB_CL</strong> — Incoming SMS to Chile phone numbers</li><li><strong>SMS_IN_MOB_CO</strong> — Incoming SMS to Colombia phone numbers</li><li><strong>SMS_IN_MOB_DK</strong> — Incoming SMS to Denmark phone numbers</li><li><strong>SMS_IN_MOB_FI</strong> — Incoming SMS to Finland phone numbers</li><li><strong>SMS_IN_MOB_FR</strong> — Incoming SMS to France phone numbers</li><li><strong>SMS_IN_MOB_GB</strong> — Incoming SMS to the United Kingdom phone numbers</li><li><strong>SMS_IN_MOB_HK</strong> — Incoming SMS to Hong Kong phone numbers</li><li><strong>SMS_IN_MOB_IL</strong> — Incoming SMS to Israel phone numbers</li><li><strong>SMS_IN_MOB_LV</strong> — Incoming SMS to Latvia phone numbers</li><li><strong>SMS_IN_MOB_MU</strong> — Incoming SMS to Mauritius phone numbers</li><li><strong>SMS_IN_MOB_MX</strong> — Incoming SMS to Mexico phone numbers</li><li><strong>SMS_IN_MOB_MY</strong> — Incoming SMS to Malaysia phone numbers</li><li><strong>SMS_IN_MOB_NL</strong> — Incoming SMS to the Netherlands phone numbers</li><li><strong>SMS_IN_MOB_PE</strong> — Incoming SMS to Peru phone numbers</li><li><strong>SMS_IN_MOB_PL</strong> — Incoming SMS to Poland phone numbers</li><li><strong>SMS_IN_MOB_PR</strong> — Incoming SMS to Puerto Rico phone numbers</li><li><strong>SMS_IN_MOB_PT</strong> — Incoming SMS to Portugal phone numbers</li><li><strong>SMS_IN_MOB_RU</strong> — Incoming SMS to Russia phone numbers</li><li><strong>SMS_IN_MOB_SE</strong> — Incoming SMS to Sweden phone numbers</li><li><strong>SMS_IN_MOB_TH</strong> — Incoming SMS to Thailand phone numbers</li><li><strong>SMS_IN_MOB_TR</strong> — Incoming SMS to Turkey phone numbers</li><li><strong>SMS_IN_MOB_US</strong> — Incoming SMS to the United States phone numbers</li><li><strong>SMSINPUT</strong> — Incoming SMS</li><li><strong>SMSOUT</strong> — Outgoing SMS</li><li><strong>SMSOUT_INTERNATIONAL</strong> — International outgoing SMS</li><li><strong>SMSOUT_RU_INTERNATIONAL</strong> — International outgoing SMS from Russia</li><li><strong>TRANSCRIPTION</strong> — Speech transcription</li><li><strong>TTS_CARTESIA</strong> — Text-to-speech by Cartesia</li><li><strong>TTS_ELEVENLABS</strong> — Text-to-speech by ElevenLabs</li><li><strong>TTS_GOOGLE_REALTIME</strong> — Realtime text-to-speech by Google</li><li><strong>TTS_INWORLD</strong> — Text-to-speech by Inworld</li><li><strong>TTS_SMARTSPEECH</strong> — Text-to-speech by SmartSpeech</li><li><strong>TTS_TEXT_CUSTOM_CREDENTIALS</strong> — Text-to-speech with custom credentials</li><li><strong>TTS_TEXT_GOOGLE</strong> — Text-to-speech by Google</li><li><strong>TTS_TINKOFF</strong> — Text-to-speech by T-bank</li><li><strong>TTS_YANDEX_NEURAL</strong> — Text-to-speech by Yandex</li><li><strong>VIDEOCALL</strong> — Video calls</li><li><strong>VIDEOCONFCALL_IN</strong> — Incoming video conference</li><li><strong>VIDEOCONFCALL_OUT</strong> — Outgoing video conference</li><li><strong>VIDEOCONFRECORD</strong> — Video conference recording per minute</li><li><strong>VIDEOPARTRECORD</strong> — Video conference member recording per minute</li><li><strong>VIDEORECORD</strong> — Video call recording</li><li><strong>VOICEMAILDETECTION</strong> — Voicemail detection</li><li><strong>VOIPIN</strong> — Incoming VoIP calls</li><li><strong>VOIPOUT</strong> — Outgoing VoIP calls</li><li><strong>WAB_VOICE_IN</strong> — Incoming WhatsApp Business calls</li><li><strong>WAB_VOICE_OUT_CONNECTOR</strong> — Outgoing WhatsApp Business calls</li><li><strong>WEBSOCKET_AUDIO</strong> — Audio via WebSockets</li><li><strong>YANDEXASR</strong> — Speech recognition by Yandex</li></ul>


## GetSubscriptionPrice  (api_method)

Gets the subscription template price.

**Returns:** 

- `count` — The maximum returning record count

- `offset` — The first <b>N</b> records are skipped in the output

- `subscription_template_id` — The subscription template ID list separated by semicolons (;)

- `subscription_template_name` — The subscription template name  (example: SIP registration, Phone GB, Phone RU 495, ...)

- `subscription_template_type` — The subscription template type. The following values are possible: PHONE_NUM, SIP_REGISTRATION


## SetAccountInfo  (api_method)

Edits the account's profile.

_roles: Owner, Admin, Developer, Accountant, Payer_

**Returns:** 

- `account_custom_data` — The custom data

- `account_first_name` — The first name

- `account_last_name` — The last name

- `account_notifications` — Whether Voximplant notifications are required

- `billing_address_address` — The valid address that needs to be specified to pay for any services. You cannot delete it later, only change

- `billing_address_country_code` — The billing address country code (2 symbols, ISO 3166-1 alpha-2). The following values are available: AF (Afghanistan), AL (Albania), DZ (Algeria), AS (American Samoa), AD (Andorra), AO (Angola), AI (Anguilla), AQ (Antarctica), AG (Antigua and Barbuda), AR (Argentina), AM (Armenia), AW (Aruba), AU (Australia), AT (Austria), AZ (Azerbaijan), BH (Bahrain), BD (Bangladesh), BB (Barbados), BY (Belarus), BE (Belgium), BZ (Belize), BJ (Benin), BM (Bermuda), BT (Bhutan), BO (Bolivia), BA (Bosnia and Herzegovina), BW (Botswana), BV (Bouvet Island), BR (Brazil), IO (British Indian Ocean Territory), BN (Brunei), BG (Bulgaria), BF (Burkina Faso), BI (Burundi), KH (Cambodia), CM (Cameroon), CA (Canada), CV (Cape Verde), KY (Cayman Islands), CF (Central African Republic), TD (Chad), CL (Chile), CN (China), CX (Christmas Island), CO (Colombia), KM (Comoros), CG (Congo), CK (Cook Islands), CR (Costa Rica), HR (Croatia), CU (Cuba), CY (Cyprus), CZ (Czech Republic), DK (Denmark), DJ (Djibouti), DM (Dominica), DO (Dominican Republic), EC (Ecuador), EG (Egypt), SV (El Salvador), GQ (Equatorial Guinea), ER (Eritrea), EE (Estonia), ET (Ethiopia), FO (Faroe Islands), FJ (Fiji Islands), FI (Finland), FR (France), GF (French Guiana), PF (French Polynesia), TF (French Southern and Antarctic Lands), GA (Gabon), GE (Georgia), DE (Germany), GH (Ghana), GI (Gibraltar), GR (Greece), GL (Greenland), GD (Grenada), GP (Guadeloupe), GU (Guam), GT (Guatemala), GG (Guernsey), GN (Guinea), GY (Guyana), HT (Haiti), HM (Heard Island and McDonald Islands), HN (Honduras), HU (Hungary), IS (Iceland), IN (India), ID (Indonesia), IR (Iran), IQ (Iraq), IE (Ireland), IL (Israel), IT (Italy), JM (Jamaica), JP (Japan), JE (Jersey), JO (Jordan), KZ (Kazakhstan), KE (Kenya), KI (Kiribati), KR (Korea), KW (Kuwait), KG (Kyrgyzstan), LA (Laos), LV (Latvia), LB (Lebanon), LS (Lesotho), LR (Liberia), LY (Libya), LI (Liechtenstein), LT (Lithuania), LU (Luxembourg), MG (Madagascar), MW (Malawi), MY (Malaysia), MV (Maldives), ML (Mali), MT (Malta), MH (Marshall Islands), MQ (Martinique), MR (Mauritania), MU (Mauritius), YT (Mayotte), MX (Mexico), FM (Micronesia), MD (Moldova), MC (Monaco), MN (Mongolia), ME (Montenegro), MS (Montserrat), MA (Morocco), MZ (Mozambique), MM (Myanmar), NA (Namibia), NR (Nauru), NP (Nepal), NL (Netherlands), AN (Netherlands Antilles), NC (New Caledonia), NZ (New Zealand), NI (Nicaragua), NE (Niger), NG (Nigeria), NU (Niue), NF (Norfolk Island), KP (North Korea), MP (Northern Mariana Islands), NO (Norway), OM (Oman), PK (Pakistan), PW (Palau), PS (Palestinian Authority), PA (Panama), PG (Papua New Guinea), PY (Paraguay), PE (Peru), PH (Philippines), PN (Pitcairn Islands), PL (Poland), PT (Portugal), PR (Puerto Rico), QA (Qatar), RE (Reunion), RO (Romania), RU (Russia), RW (Rwanda), WS (Samoa), SM (San Marino), SA (Saudi Arabia), SN (Senegal), RS (Serbia), SC (Seychelles), SL (Sierra Leone), SG (Singapore), SK (Slovakia), SI (Slovenia), SB (Solomon Islands), SO (Somalia), ZA (South Africa), GS (South Georgia and the South Sandwich Islands), ES (Spain), LK (Sri Lanka), SD (Sudan), SR (Suriname), SZ (Swaziland), SE (Sweden), CH (Switzerland), SY (Syria), ST (Sao Tome and Principe), TW (Taiwan), TJ (Tajikistan), TZ (Tanzania), TH (Thailand), TG (Togo), TK (Tokelau), TO (Tonga), TT (Trinidad and Tobago), TN (Tunisia), TR (Turkey), TM (Turkmenistan), TC (Turks and Caicos Islands), TV (Tuvalu), UG (Uganda), UA (Ukraine), AE (United Arab Emirates), GB (United Kingdom), US (United States), UY (Uruguay), UZ (Uzbekistan), VU (Vanuatu), VA (Vatican City), VE (Venezuela), VN (Vietnam), VI (Virgin Islands), WF (Wallis and Futuna), EH (Western Sahara), YE (Yemen), ZM (Zambia), ZW (Zimbabwe), AX (Aland Islands)

- `billing_address_name` — The company or businessman name

- `billing_address_phone` — The office phone number

- `billing_address_zip` — The office ZIP

- `callback_salt` — If salt string is specified, each HTTP request made by the Voximplant cloud toward the <b>callback_url</b> has a <b>salt</b> field set to MD5 hash of account information and salt. That hash can be used be a developer to ensure that HTTP request is made by the Voximplant cloud

- `callback_url` — If URL is specified, Voximplant cloud makes HTTP POST requests to it when something happens. For a full list of reasons see the <b>type</b> field of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure. The HTTP request has a JSON-encoded body that conforms to the [AccountCallbacks](/docs/references/httpapi/structure/accountcallbacks) structure

- `language_code` — The notification language code (2 symbols, ISO639-1). The following values are available: aa (Afar), ab (Abkhazian), af (Afrikaans), am (Amharic), ar (Arabic), as (Assamese), ay (Aymara), az (Azerbaijani), ba (Bashkir), be (Belarusian), bg (Bulgarian), bh (Bihari), bi (Bislama), bn (Bengali), bo (Tibetan), br (Breton), ca (Catalan), co (Corsican), cs (Czech), cy (Welch), da (Danish), de (German), dz (Bhutani), el (Greek), en (English), eo (Esperanto), es (Spanish), et (Estonian), eu (Basque), fa (Persian), fi (Finnish), fj (Fiji), fo (Faeroese), fr (French), fy (Frisian), ga (Irish), gd (Scots Gaelic), gl (Galician), gn (Guarani), gu (Gujarati), ha (Hausa), hi (Hindi), he (Hebrew), hr (Croatian), hu (Hungarian), hy (Armenian), ia (Interlingua), id (Indonesian), ie (Interlingue), ik (Inupiak), in (Indonesian), is (Icelandic), it (Italian), iu (Inuktitut), iw (Hebrew), ja (Japanese), ji (Yiddish), jw (Javanese), ka (Georgian), kk (Kazakh), kl (Greenlandic), km (Cambodian), kn (Kannada), ko (Korean), ks (Kashmiri), ku (Kurdish), ky (Kirghiz), la (Latin), ln (Lingala), lo (Laothian), lt (Lithuanian), lv (Latvian), mg (Malagasy), mi (Maori), mk (Macedonian), ml (Malayalam), mn (Mongolian), mo (Moldavian), mr (Marathi), ms (Malay), mt (Maltese), my (Burmese), na (Nauru), ne (Nepali), nl (Dutch), no (Norwegian), oc (Occitan), om (Oromo), or (Oriya), pa (Punjabi), pl (Polish), ps (Pashto), pt (Portuguese), qu (Quechua), rm (Rhaeto-Romance), rn (Kirundi), ro (Romanian), ru (Russian), rw (Kinyarwanda), sa (Sanskrit), sd (Sindhi), sg (Sangro), sh (Serbo-Croatian), si (Singhalese), sk (Slovak), sl (Slovenian), sm (Samoan), sn (Shona), so (Somali), sq (Albanian), sr (Serbian), ss (Siswati), st (Sesotho), su (Sudanese), sv (Swedish), sw (Swahili), ta (Tamil), te (Tegulu), tg (Tajik), th (Thai), ti (Tigrinya), tk (Turkmen), tl (Tagalog), tn (Setswana), to (Tonga), tr (Turkish), ts (Tsonga), tt (Tatar), tw (Twi), ug (Uigur), uk (Ukrainian), ur (Urdu), uz (Uzbek), vi (Vietnamese), vo (Volapuk), wo (Wolof), xh (Xhosa), yi (Yiddish), yo (Yoruba), za (Zhuang), zh (Chinese), zu (Zulu)

- `location` — The account location (timezone). Examples: America/Los_Angeles, Etc/GMT-8, Etc/GMT+10

- `min_balance_to_notify` — The minimum balance value to notify by email or SMS

- `new_account_email` — The new account email

- `new_account_password` — The new account password. Should be at least 8 characters long and contain at least one uppercase and lowercase letter, one number, and one special character

- `news_notifications` — Whether to receive the emails about the Voximplant news

- `send_js_error` — Whether to receive the emails about a JS scenario error

- `store_inbound_sms` — Whether to store incoming message texts. Default value is false

- `store_outbound_sms` — Whether to store outgoing message texts. Default value is false

- `tariff_changing_notifications` — Whether to receive the emails about the Voximplant plan changing


## SetChildAccountInfo  (api_method)

Edits the account's profile.

**Returns:** 

- `account_notifications` — Whether Voximplant notifications are required

- `active` — Whether to enable the child account

- `callback_salt` — If salt string is specified, each HTTP request made by the Voximplant cloud toward the <b>callback_url</b> has a <b>salt</b> field set to MD5 hash of account information and salt. That hash can be used be a developer to ensure that HTTP request is made by the Voximplant cloud

- `callback_url` — Custom URL to send callbacks from this child account

- `can_use_restricted` — Whether to allow use restricted directions

- `child_account_email` — The child account email list separated by semicolons (;). <b>Required</b> unless <b>child_account_id</b> or <b>child_account_name</b> is provided.

- `child_account_id` — The child account ID list separated by semicolons (;). Use the 'all' value to select all child accounts. <b>Required</b> unless <b>child_account_name</b> or <b>child_account_email</b> is provided.

- `child_account_name` — The child account name list separated by semicolons (;). <b>Required</b> unless <b>child_account_id</b> or <b>child_account_email</b> is provided.

- `language_code` — The notification language code (2 symbols, ISO639-1). The following values are available: aa (Afar), ab (Abkhazian), af (Afrikaans), am (Amharic), ar (Arabic), as (Assamese), ay (Aymara), az (Azerbaijani), ba (Bashkir), be (Belarusian), bg (Bulgarian), bh (Bihari), bi (Bislama), bn (Bengali), bo (Tibetan), br (Breton), ca (Catalan), co (Corsican), cs (Czech), cy (Welch), da (Danish), de (German), dz (Bhutani), el (Greek), en (English), eo (Esperanto), es (Spanish), et (Estonian), eu (Basque), fa (Persian), fi (Finnish), fj (Fiji), fo (Faeroese), fr (French), fy (Frisian), ga (Irish), gd (Scots Gaelic), gl (Galician), gn (Guarani), gu (Gujarati), ha (Hausa), hi (Hindi), he (Hebrew), hr (Croatian), hu (Hungarian), hy (Armenian), ia (Interlingua), id (Indonesian), ie (Interlingue), ik (Inupiak), in (Indonesian), is (Icelandic), it (Italian), iu (Inuktitut), iw (Hebrew), ja (Japanese), ji (Yiddish), jw (Javanese), ka (Georgian), kk (Kazakh), kl (Greenlandic), km (Cambodian), kn (Kannada), ko (Korean), ks (Kashmiri), ku (Kurdish), ky (Kirghiz), la (Latin), ln (Lingala), lo (Laothian), lt (Lithuanian), lv (Latvian), mg (Malagasy), mi (Maori), mk (Macedonian), ml (Malayalam), mn (Mongolian), mo (Moldavian), mr (Marathi), ms (Malay), mt (Maltese), my (Burmese), na (Nauru), ne (Nepali), nl (Dutch), no (Norwegian), oc (Occitan), om (Oromo), or (Oriya), pa (Punjabi), pl (Polish), ps (Pashto), pt (Portuguese), qu (Quechua), rm (Rhaeto-Romance), rn (Kirundi), ro (Romanian), ru (Russian), rw (Kinyarwanda), sa (Sanskrit), sd (Sindhi), sg (Sangro), sh (Serbo-Croatian), si (Singhalese), sk (Slovak), sl (Slovenian), sm (Samoan), sn (Shona), so (Somali), sq (Albanian), sr (Serbian), ss (Siswati), st (Sesotho), su (Sudanese), sv (Swedish), sw (Swahili), ta (Tamil), te (Tegulu), tg (Tajik), th (Thai), ti (Tigrinya), tk (Turkmen), tl (Tagalog), tn (Setswana), to (Tonga), tr (Turkish), ts (Tsonga), tt (Tatar), tw (Twi), ug (Uigur), uk (Ukrainian), ur (Urdu), uz (Uzbek), vi (Vietnamese), vo (Volapuk), wo (Wolof), xh (Xhosa), yi (Yiddish), yo (Yoruba), za (Zhuang), zh (Chinese), zu (Zulu)

- `location` — The child account location (timezone). Examples: America/Los_Angeles, Etc/GMT-8, Etc/GMT+10

- `min_balance_to_notify` — The minimum balance value to notify by email or SMS

- `new_child_account_email` — The new child account email

- `new_child_account_password` — The new child account password. Should be at least 8 characters long and contain at least one uppercase and lowercase letter, one number, and one special character

- `news_notifications` — Whether to receive the emails about the Voximplant news

- `support_bank_card` — Whether to allow the bank card payments

- `support_invoice` — Whether to allow the bank invoices

- `support_robokassa` — Whether to allow the robokassa payments

- `tariff_changing_notifications` — Whether to receive the emails about the Voximplant plan changing
