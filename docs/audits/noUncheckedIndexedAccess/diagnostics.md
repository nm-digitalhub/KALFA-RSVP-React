# רישום מלא של אבחנות noUncheckedIndexedAccess

מקור: [הפלט המקורי](../../../noUncheckedIndexedAccess.md). הרישום משמר את סדר הפלט, כולל כפילויות ושורות המשך. מזהה D מציין הופעה בפלט, לא באג נפרד. `log` הוא טווח שורות בקובץ הפלט; `source` הוא שורה ועמודה בקובץ המקור.

| ID | תחום | קובץ מקור | source | log | קוד | הודעה מלאה |
| --- | --- | --- | --- | --- | --- | --- |
| D0001 | ui-scripts | `scripts/analyze-call-audio.ts` | 72:32 | 1-1 | TS2532 | Object is possibly 'undefined'. |
| D0002 | ui-scripts | `scripts/analyze-call-audio.ts` | 72:46 | 2-2 | TS2532 | Object is possibly 'undefined'. |
| D0003 | ui-scripts | `scripts/analyze-call-audio.ts` | 73:29 | 3-3 | TS2532 | Object is possibly 'undefined'. |
| D0004 | ui-scripts | `scripts/analyze-call-audio.ts` | 73:52 | 4-4 | TS2532 | Object is possibly 'undefined'. |
| D0005 | ui-scripts | `scripts/analyze-call-audio.ts` | 75:35 | 5-5 | TS2532 | Object is possibly 'undefined'. |
| D0006 | ui-scripts | `scripts/analyze-call-audio.ts` | 81:19 | 6-7 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D0007 | ui-scripts | `scripts/analyze-call-audio.ts` | 81:64 | 8-8 | TS18048 | 'start' is possibly 'undefined'. |
| D0008 | ui-scripts | `scripts/analyze-call-pitch.ts` | 51:25 | 9-10 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D0009 | ui-scripts | `scripts/analyze-call-pitch.ts` | 51:33 | 11-11 | TS2532 | Object is possibly 'undefined'. |
| D0010 | ui-scripts | `scripts/analyze-call-pitch.ts` | 51:44 | 12-12 | TS2532 | Object is possibly 'undefined'. |
| D0011 | ui-scripts | `scripts/analyze-call-pitch.ts` | 56:3 | 13-14 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D0012 | ui-scripts | `scripts/analyze-call-pitch.ts` | 116:24 | 15-16 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0013 | ui-scripts | `scripts/analyze-call-prosody.ts` | 30:11 | 17-17 | TS18048 | 'h' is possibly 'undefined'. |
| D0014 | ui-scripts | `scripts/analyze-call-prosody.ts` | 30:23 | 18-18 | TS18048 | 'm' is possibly 'undefined'. |
| D0015 | ui-scripts | `scripts/analyze-call-prosody.ts` | 30:43 | 19-20 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0016 | ui-scripts | `scripts/analyze-call-prosody.ts` | 44:23 | 21-22 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0017 | ui-scripts | `scripts/analyze-call-prosody.ts` | 51:28 | 23-23 | TS2532 | Object is possibly 'undefined'. |
| D0018 | ui-scripts | `scripts/analyze-call-prosody.ts` | 88:3 | 24-25 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D0019 | ui-scripts | `scripts/analyze-call-prosody.ts` | 110:28 | 26-26 | TS18048 | 'u' is possibly 'undefined'. |
| D0020 | ui-scripts | `scripts/analyze-call-prosody.ts` | 111:15 | 27-27 | TS18048 | 'u' is possibly 'undefined'. |
| D0021 | ui-scripts | `scripts/analyze-call-prosody.ts` | 111:23 | 28-28 | TS18048 | 'u' is possibly 'undefined'. |
| D0022 | ui-scripts | `scripts/analyze-call-prosody.ts` | 112:27 | 29-30 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0023 | ui-scripts | `scripts/analyze-call-prosody.ts` | 114:94 | 31-31 | TS18048 | 'u' is possibly 'undefined'. |
| D0024 | ui-scripts | `scripts/analyze-call-prosody.ts` | 126:15 | 32-32 | TS18048 | 'u' is possibly 'undefined'. |
| D0025 | ui-scripts | `scripts/gen-staff-table-rls.ts` | 84:16 | 33-33 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D0026 | ui-scripts | `scripts/gen-staff-table-rls.ts` | 98:15 | 34-34 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D0027 | ui-scripts | `scripts/send-email-file.ts` | 60:43 | 35-35 | TS2532 | Object is possibly 'undefined'. |
| D0028 | ui-scripts | `scripts/verify-graph-edges.ts` | 50:26 | 36-36 | TS2532 | Object is possibly 'undefined'. |
| D0029 | ui-scripts | `scripts/verify-graph-provider.ts` | 34:26 | 37-37 | TS2532 | Object is possibly 'undefined'. |
| D0030 | ui-scripts | `scripts/voximplant/migrate-scenarios-to-application.ts` | 556:56 | 38-39 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0031 | ui-scripts | `scripts/voximplant/migrate-scenarios-to-application.ts` | 585:5 | 40-45 | TS2322 | Type '{ ruleIds: (number &#124; undefined)[]; ruleNames: (string &#124; undefined)[]; scenarioName: string; scenarioId: number; }[]' is not assignable to type 'Target[]'.<br>  Type '{ ruleIds: (number &#124; undefined)[]; ruleNames: (string &#124; undefined)[]; scenarioName: string; scenarioId: number; }' is not assignable to type 'Target'.<br>    Types of property 'ruleIds' are incompatible.<br>      Type '(number &#124; undefined)[]' is not assignable to type 'number[]'.<br>        Type 'number &#124; undefined' is not assignable to type 'number'.<br>          Type 'undefined' is not assignable to type 'number'. |
| D0032 | ui-scripts | `scripts/voximplant/outreach-call.ts` | 132:17 | 46-46 | TS2532 | Object is possibly 'undefined'. |
| D0033 | ui-scripts | `scripts/voximplant/rotate-console-agent-secret.ts` | 38:14 | 47-47 | TS2532 | Object is possibly 'undefined'. |
| D0034 | ui-scripts | `scripts/voximplant/rotate-console-agent-secret.ts` | 39:66 | 48-48 | TS2532 | Object is possibly 'undefined'. |
| D0035 | ui-scripts | `scripts/whatsapp-template-gate.ts` | 70:59 | 49-50 | TS2322 | Type 'Json &#124; undefined' is not assignable to type 'Json'.<br>  Type 'undefined' is not assignable to type 'Json'. |
| D0036 | ui-scripts | `scripts/whatsapp-template-gate.ts` | 77:71 | 51-52 | TS2322 | Type 'Json &#124; undefined' is not assignable to type 'string &#124; number &#124; boolean &#124; Json[] &#124; { [x: string]: string &#124; number &#124; boolean &#124; Json[] &#124; ... &#124; null &#124; undefined; } &#124; null'.<br>  Type 'undefined' is not assignable to type 'string &#124; number &#124; boolean &#124; Json[] &#124; { [x: string]: string &#124; number &#124; boolean &#124; Json[] &#124; ... &#124; null &#124; undefined; } &#124; null'. |
| D0037 | ui-scripts | `scripts/whatsapp-template-gate.ts` | 111:11 | 53-57 | TS2322 | Type '{ lead: { full_name: string; signup_ref: string; }; } &#124; { event: { event_type: "wedding" &#124; "bar_mitzvah" &#124; "bat_mitzvah" &#124; "brit" &#124; "britah" &#124; "henna" &#124; "engagement" &#124; "birthday" &#124; "other"; ... 5 more ...; gift_link_token: string; }; guestFirstName: string; }' is not assignable to type 'WhatsAppSendValues'.<br>  Type '{ event: { event_type: "wedding" &#124; "bar_mitzvah" &#124; "bat_mitzvah" &#124; "brit" &#124; "britah" &#124; "henna" &#124; "engagement" &#124; "birthday" &#124; "other"; celebrants: Json &#124; undefined; event_date: string; venue_name: string; venue_address: string; gift_payment_url: string; gift_link_token: string; }; guestFirstName: string; }' is not assignable to type 'WhatsAppSendValues'.<br>    The types of 'event.celebrants' are incompatible between these types.<br>      Type 'Json &#124; undefined' is not assignable to type 'Json'.<br>        Type 'undefined' is not assignable to type 'Json'. |
| D0038 | tests | `src/app/(admin)/admin/agreement/page.test.tsx` | 62:20 | 58-58 | TS2532 | Object is possibly 'undefined'. |
| D0039 | ui-scripts | `src/app/(admin)/admin/analytics/_sections.tsx` | 253:32 | 59-59 | TS2532 | Object is possibly 'undefined'. |
| D0040 | ui-scripts | `src/app/(admin)/admin/assignments/list-params.ts` | 22:38 | 60-60 | TS2532 | Object is possibly 'undefined'. |
| D0041 | ui-scripts | `src/app/(admin)/admin/assignments/void-refusals.ts` | 17:47 | 61-62 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string &#124; null'.<br>  Type 'undefined' is not assignable to type 'string &#124; null'. |
| D0042 | tests | `src/app/(admin)/admin/calendar/op-tracker.test.ts` | 66:20 | 63-63 | TS2532 | Object is possibly 'undefined'. |
| D0043 | ui-scripts | `src/app/(admin)/admin/callbacks/policy/actions.ts` | 61:13 | 64-64 | TS2532 | Object is possibly 'undefined'. |
| D0044 | ui-scripts | `src/app/(admin)/admin/callbacks/policy/policy-form.tsx` | 43:13 | 65-65 | TS2532 | Object is possibly 'undefined'. |
| D0045 | tests | `src/app/(admin)/admin/callbacks/reschedule-form.test.tsx` | 61:20 | 66-66 | TS2532 | Object is possibly 'undefined'. |
| D0046 | tests | `src/app/(admin)/admin/cancellations/sort-menu.test.tsx` | 17:12 | 67-67 | TS2532 | Object is possibly 'undefined'. |
| D0047 | tests | `src/app/(admin)/admin/cancellations/sort-menu.test.tsx` | 18:12 | 68-68 | TS2532 | Object is possibly 'undefined'. |
| D0048 | ui-scripts | `src/app/(admin)/admin/cancellations/sort-menu.tsx` | 28:34 | 69-69 | TS18048 | 'current' is possibly 'undefined'. |
| D0049 | ui-scripts | `src/app/(admin)/admin/cancellations/sort-menu.tsx` | 31:14 | 70-70 | TS18048 | 'current' is possibly 'undefined'. |
| D0050 | ui-scripts | `src/app/(admin)/admin/cancellations/sort-menu.tsx` | 32:47 | 71-71 | TS18048 | 'current' is possibly 'undefined'. |
| D0051 | tests | `src/app/(admin)/admin/fleet/actions.test.ts` | 144:12 | 72-72 | TS2532 | Object is possibly 'undefined'. |
| D0052 | ui-scripts | `src/app/(admin)/admin/fleet/fleet-stream.tsx` | 119:27 | 73-73 | TS2532 | Object is possibly 'undefined'. |
| D0053 | ui-scripts | `src/app/(admin)/admin/fleet/fleet-stream.tsx` | 120:26 | 74-74 | TS2532 | Object is possibly 'undefined'. |
| D0054 | tests | `src/app/(admin)/admin/integrations/actions.test.ts` | 295:19 | 75-75 | TS2532 | Object is possibly 'undefined'. |
| D0055 | tests | `src/app/(admin)/admin/integrations/meta-whatsapp/connect/embedded-signup-launcher.test.ts` | 59:18 | 76-76 | TS2532 | Object is possibly 'undefined'. |
| D0056 | tests | `src/app/(admin)/admin/integrations/owner-agent/actions.test.ts` | 141:66 | 77-78 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0057 | ui-scripts | `src/app/(admin)/admin/integrations/owner-agent/audit-table.tsx` | 156:36 | 79-79 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D0058 | tests | `src/app/(admin)/admin/integrations/workflow-oauth-actions.test.ts` | 98:20 | 80-80 | TS2532 | Object is possibly 'undefined'. |
| D0059 | tests | `src/app/(admin)/admin/integrations/workflow-oauth/actions.test.ts` | 20:23 | 81-81 | TS2532 | Object is possibly 'undefined'. |
| D0060 | ui-scripts | `src/app/(admin)/admin/offers/offer-form.tsx` | 101:13 | 82-90 | TS2345 | Argument of type '(prev: Record&lt;string, PackageRowState&gt;) =&gt; { [x: string]: PackageRowState &#124; { checked?: boolean &#124; undefined; override?: string &#124; undefined; }; }' is not assignable to parameter of type 'SetStateAction&lt;Record&lt;string, PackageRowState&gt;&gt;'.<br>  Type '(prev: Record&lt;string, PackageRowState&gt;) =&gt; { [x: string]: PackageRowState &#124; { checked?: boolean &#124; undefined; override?: string &#124; undefined; }; }' is not assignable to type '(prevState: Record&lt;string, PackageRowState&gt;) =&gt; Record&lt;string, PackageRowState&gt;'.<br>    Type '{ [x: string]: PackageRowState &#124; { checked?: boolean &#124; undefined; override?: string &#124; undefined; }; }' is not assignable to type 'Record&lt;string, PackageRowState&gt;'.<br>      'string' index signatures are incompatible.<br>        Type 'PackageRowState &#124; { checked?: boolean &#124; undefined; override?: string &#124; undefined; }' is not assignable to type 'PackageRowState'.<br>          Type '{ checked?: boolean &#124; undefined; override?: string &#124; undefined; }' is not assignable to type 'PackageRowState'.<br>            Types of property 'checked' are incompatible.<br>              Type 'boolean &#124; undefined' is not assignable to type 'boolean'.<br>                Type 'undefined' is not assignable to type 'boolean'. |
| D0061 | tests | `src/app/(admin)/admin/packages/actions.test.ts` | 196:25 | 91-91 | TS2532 | Object is possibly 'undefined'. |
| D0062 | tests | `src/app/(admin)/admin/packages/actions.test.ts` | 231:25 | 92-92 | TS2532 | Object is possibly 'undefined'. |
| D0063 | tests | `src/app/(admin)/admin/packages/package-form.test.tsx` | 155:12 | 93-93 | TS2532 | Object is possibly 'undefined'. |
| D0064 | tests | `src/app/(admin)/admin/packages/package-form.test.tsx` | 177:12 | 94-94 | TS2532 | Object is possibly 'undefined'. |
| D0065 | tests | `src/app/(admin)/admin/packages/package-form.test.tsx` | 231:21 | 95-96 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'Element &#124; Node &#124; Document &#124; Window'.<br>  Type 'undefined' is not assignable to type 'Element &#124; Node &#124; Document &#124; Window'. |
| D0066 | ui-scripts | `src/app/(admin)/admin/roles/roles-client.tsx` | 203:5 | 97-97 | TS2532 | Object is possibly 'undefined'. |
| D0067 | tests | `src/app/(admin)/admin/settings/actions.test.ts` | 66:21 | 98-98 | TS2532 | Object is possibly 'undefined'. |
| D0068 | tests | `src/app/(admin)/admin/workflows/[id]/export-diagram.test.ts` | 167:12 | 99-99 | TS2532 | Object is possibly 'undefined'. |
| D0069 | tests | `src/app/(customer)/app/events/[id]/actions.test.ts` | 85:19 | 100-100 | TS2532 | Object is possibly 'undefined'. |
| D0070 | tests | `src/app/(customer)/app/events/[id]/actions.test.ts` | 92:19 | 101-101 | TS2532 | Object is possibly 'undefined'. |
| D0071 | tests | `src/app/(customer)/app/events/[id]/actions.test.ts` | 100:19 | 102-102 | TS2532 | Object is possibly 'undefined'. |
| D0072 | tests | `src/app/(customer)/app/events/[id]/actions.test.ts` | 111:19 | 103-103 | TS2532 | Object is possibly 'undefined'. |
| D0073 | tests | `src/app/(customer)/app/events/[id]/actions.test.ts` | 118:19 | 104-104 | TS2532 | Object is possibly 'undefined'. |
| D0074 | tests | `src/app/(customer)/app/events/[id]/actions.test.ts` | 149:19 | 105-105 | TS2532 | Object is possibly 'undefined'. |
| D0075 | tests | `src/app/(customer)/app/events/[id]/actions.test.ts` | 160:19 | 106-106 | TS2532 | Object is possibly 'undefined'. |
| D0076 | tests | `src/app/(customer)/app/events/[id]/actions.test.ts` | 189:19 | 107-107 | TS2532 | Object is possibly 'undefined'. |
| D0077 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 118:12 | 108-108 | TS2532 | Object is possibly 'undefined'. |
| D0078 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 119:12 | 109-109 | TS2532 | Object is possibly 'undefined'. |
| D0079 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 144:12 | 110-110 | TS2532 | Object is possibly 'undefined'. |
| D0080 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 145:12 | 111-111 | TS2532 | Object is possibly 'undefined'. |
| D0081 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 210:12 | 112-112 | TS2532 | Object is possibly 'undefined'. |
| D0082 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 211:12 | 113-113 | TS2532 | Object is possibly 'undefined'. |
| D0083 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 229:12 | 114-114 | TS2532 | Object is possibly 'undefined'. |
| D0084 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 230:12 | 115-115 | TS2532 | Object is possibly 'undefined'. |
| D0085 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 324:23 | 116-116 | TS2532 | Object is possibly 'undefined'. |
| D0086 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 407:12 | 117-117 | TS2532 | Object is possibly 'undefined'. |
| D0087 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 528:12 | 118-118 | TS2532 | Object is possibly 'undefined'. |
| D0088 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 536:12 | 119-119 | TS2532 | Object is possibly 'undefined'. |
| D0089 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 552:12 | 120-120 | TS2532 | Object is possibly 'undefined'. |
| D0090 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 568:12 | 121-121 | TS2532 | Object is possibly 'undefined'. |
| D0091 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 568:46 | 122-122 | TS2532 | Object is possibly 'undefined'. |
| D0092 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 594:12 | 123-123 | TS2532 | Object is possibly 'undefined'. |
| D0093 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 636:23 | 124-124 | TS2532 | Object is possibly 'undefined'. |
| D0094 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 677:12 | 125-125 | TS2532 | Object is possibly 'undefined'. |
| D0095 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 678:12 | 126-126 | TS2532 | Object is possibly 'undefined'. |
| D0096 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 694:12 | 127-127 | TS2532 | Object is possibly 'undefined'. |
| D0097 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 776:23 | 128-128 | TS2532 | Object is possibly 'undefined'. |
| D0098 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 859:18 | 129-129 | TS2532 | Object is possibly 'undefined'. |
| D0099 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 870:18 | 130-130 | TS2532 | Object is possibly 'undefined'. |
| D0100 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 882:23 | 131-131 | TS2532 | Object is possibly 'undefined'. |
| D0101 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 900:23 | 132-132 | TS2532 | Object is possibly 'undefined'. |
| D0102 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 908:23 | 133-133 | TS2532 | Object is possibly 'undefined'. |
| D0103 | tests | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/cardcom-open-fields-form.test.tsx` | 925:23 | 134-134 | TS2532 | Object is possibly 'undefined'. |
| D0104 | tests | `src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.test.ts` | 77:12 | 135-135 | TS2532 | Object is possibly 'undefined'. |
| D0105 | tests | `src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.test.ts` | 78:19 | 136-136 | TS2532 | Object is possibly 'undefined'. |
| D0106 | tests | `src/app/(customer)/app/events/[id]/guests/guests-actions.test.ts` | 68:12 | 137-137 | TS2532 | Object is possibly 'undefined'. |
| D0107 | tests | `src/app/(customer)/app/events/[id]/guests/guests-actions.test.ts` | 105:12 | 138-138 | TS2532 | Object is possibly 'undefined'. |
| D0108 | ui-scripts | `src/app/(customer)/app/events/[id]/guests/import/import-actions.ts` | 143:3 | 139-139 | TS18048 | 'header' is possibly 'undefined'. |
| D0109 | ui-scripts | `src/app/(customer)/app/events/[id]/guests/import/whatsapp/actions.ts` | 126:52 | 140-140 | TS18048 | 'row' is possibly 'undefined'. |
| D0110 | ui-scripts | `src/app/(customer)/app/events/[id]/guests/import/whatsapp/actions.ts` | 127:63 | 141-141 | TS18048 | 'row' is possibly 'undefined'. |
| D0111 | ui-scripts | `src/app/(customer)/app/events/[id]/guests/import/whatsapp/actions.ts` | 128:67 | 142-142 | TS18048 | 'row' is possibly 'undefined'. |
| D0112 | tests | `src/app/(customer)/app/events/[id]/setup-confirm-form.test.tsx` | 37:22 | 143-144 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'Element'.<br>  Type 'undefined' is not assignable to type 'Element'. |
| D0113 | tests | `src/app/(customer)/app/events/[id]/setup-confirm-form.test.tsx` | 38:22 | 145-146 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'Element'.<br>  Type 'undefined' is not assignable to type 'Element'. |
| D0114 | tests | `src/app/(customer)/app/events/[id]/setup-confirm-form.test.tsx` | 41:22 | 147-148 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'Element'.<br>  Type 'undefined' is not assignable to type 'Element'. |
| D0115 | tests | `src/app/(customer)/app/events/[id]/setup-confirm-form.test.tsx` | 44:22 | 149-150 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'Element'.<br>  Type 'undefined' is not assignable to type 'Element'. |
| D0116 | tests | `src/app/(customer)/app/events/[id]/setup-confirm-form.test.tsx` | 56:16 | 151-151 | TS2532 | Object is possibly 'undefined'. |
| D0117 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 16:3 | 152-157 | TS2322 | Type '{ key: "details" &#124; "pay" &#124; "confirm" &#124; "live" &#124; "sign"; label: string; state: SetupStepState &#124; undefined; hint: string &#124; undefined; }[]' is not assignable to type 'SetupStepView[]'.<br>  Type '{ key: "details" &#124; "pay" &#124; "confirm" &#124; "live" &#124; "sign"; label: string; state: SetupStepState &#124; undefined; hint: string &#124; undefined; }' is not assignable to type 'SetupStepView'.<br>    Type '{ key: "details" &#124; "pay" &#124; "confirm" &#124; "live" &#124; "sign"; label: string; state: SetupStepState &#124; undefined; hint: string &#124; undefined; }' is not assignable to type 'SetupStep'.<br>      Types of property 'state' are incompatible.<br>        Type 'SetupStepState &#124; undefined' is not assignable to type 'SetupStepState'.<br>          Type 'undefined' is not assignable to type 'SetupStepState'. |
| D0118 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 29:12 | 158-158 | TS2532 | Object is possibly 'undefined'. |
| D0119 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 30:12 | 159-159 | TS2532 | Object is possibly 'undefined'. |
| D0120 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 37:12 | 160-160 | TS2532 | Object is possibly 'undefined'. |
| D0121 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 38:12 | 161-161 | TS2532 | Object is possibly 'undefined'. |
| D0122 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 39:12 | 162-162 | TS2532 | Object is possibly 'undefined'. |
| D0123 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 40:12 | 163-163 | TS2532 | Object is possibly 'undefined'. |
| D0124 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 52:12 | 164-164 | TS2532 | Object is possibly 'undefined'. |
| D0125 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 53:12 | 165-165 | TS2532 | Object is possibly 'undefined'. |
| D0126 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 54:12 | 166-166 | TS2532 | Object is possibly 'undefined'. |
| D0127 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 55:12 | 167-167 | TS2532 | Object is possibly 'undefined'. |
| D0128 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 68:5 | 168-173 | TS2322 | Type '{ key: "details" &#124; "pay" &#124; "package" &#124; "confirm" &#124; "live" &#124; "sign"; label: string; state: SetupStepState &#124; undefined; }[]' is not assignable to type 'SetupStepView[]'.<br>  Type '{ key: "details" &#124; "pay" &#124; "package" &#124; "confirm" &#124; "live" &#124; "sign"; label: string; state: SetupStepState &#124; undefined; }' is not assignable to type 'SetupStepView'.<br>    Type '{ key: "details" &#124; "pay" &#124; "package" &#124; "confirm" &#124; "live" &#124; "sign"; label: string; state: SetupStepState &#124; undefined; }' is not assignable to type 'SetupStep'.<br>      Types of property 'state' are incompatible.<br>        Type 'SetupStepState &#124; undefined' is not assignable to type 'SetupStepState'.<br>          Type 'undefined' is not assignable to type 'SetupStepState'. |
| D0129 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 78:12 | 174-174 | TS2532 | Object is possibly 'undefined'. |
| D0130 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 79:12 | 175-175 | TS2532 | Object is possibly 'undefined'. |
| D0131 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 80:12 | 176-176 | TS2532 | Object is possibly 'undefined'. |
| D0132 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 102:14 | 177-177 | TS2532 | Object is possibly 'undefined'. |
| D0133 | tests | `src/app/(customer)/app/events/[id]/setup-stepper.test.tsx` | 125:14 | 178-178 | TS2532 | Object is possibly 'undefined'. |
| D0134 | ui-scripts | `src/app/(customer)/app/events/[id]/setup-stepper.tsx` | 92:13 | 179-179 | TS18048 | 'active' is possibly 'undefined'. |
| D0135 | tests | `src/app/(customer)/app/events/[id]/setup/page.test.tsx` | 102:9 | 180-180 | TS2532 | Object is possibly 'undefined'. |
| D0136 | tests | `src/app/(customer)/app/events/[id]/setup/page.test.tsx` | 105:35 | 181-181 | TS2532 | Object is possibly 'undefined'. |
| D0137 | tests | `src/app/(customer)/app/events/actions.test.ts` | 202:11 | 182-182 | TS2488 | Type '[eventId: string, bytes: Uint8Array&lt;ArrayBufferLike&gt;, contentType: string] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D0138 | tests | `src/app/(customer)/app/events/actions.test.ts` | 206:7 | 183-184 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0139 | ui-scripts | `src/app/(customer)/app/page.tsx` | 38:50 | 185-185 | TS2532 | Object is possibly 'undefined'. |
| D0140 | tests | `src/app/(customer)/app/settings/actions.test.ts` | 207:12 | 186-186 | TS2532 | Object is possibly 'undefined'. |
| D0141 | ui-scripts | `src/app/(customer)/app/team/roles/org-roles-client.tsx` | 219:5 | 187-187 | TS2532 | Object is possibly 'undefined'. |
| D0142 | tests | `src/app/(public)/(site)/site-metadata.test.ts` | 39:45 | 188-189 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0143 | tests | `src/app/(public)/(site)/site-metadata.test.ts` | 53:16 | 190-191 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string &#124; null'.<br>  Type 'undefined' is not assignable to type 'string &#124; null'. |
| D0144 | tests | `src/app/(public)/(site)/site-metadata.test.ts` | 55:18 | 192-192 | TS18048 | 'meta' is possibly 'undefined'. |
| D0145 | tests | `src/app/(public)/(site)/site-metadata.test.ts` | 56:19 | 193-194 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string &#124; null'.<br>  Type 'undefined' is not assignable to type 'string &#124; null'. |
| D0146 | tests | `src/app/(public)/r/[token]/meal-pref-toggle.test.ts` | 23:52 | 195-196 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0147 | tests | `src/app/(public)/r/[token]/meal-pref-toggle.test.ts` | 33:25 | 197-197 | TS2532 | Object is possibly 'undefined'. |
| D0148 | tests | `src/app/(public)/r/[token]/meal-pref-toggle.test.ts` | 36:9 | 198-198 | TS2532 | Object is possibly 'undefined'. |
| D0149 | tests | `src/app/(public)/r/[token]/meal-pref-toggle.test.ts` | 37:24 | 199-199 | TS2532 | Object is possibly 'undefined'. |
| D0150 | ui-scripts | `src/app/(public)/r/[token]/rsvp-form.tsx` | 440:22 | 200-200 | TS2532 | Object is possibly 'undefined'. |
| D0151 | tests | `src/app/(public)/r/[token]/rsvp-privacy.test.ts` | 41:52 | 201-202 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0152 | tests | `src/app/(public)/r/[token]/rsvp-privacy.test.ts` | 52:25 | 203-203 | TS2532 | Object is possibly 'undefined'. |
| D0153 | tests | `src/app/(public)/r/[token]/rsvp-privacy.test.ts` | 55:9 | 204-204 | TS2532 | Object is possibly 'undefined'. |
| D0154 | tests | `src/app/(public)/r/[token]/rsvp-privacy.test.ts` | 56:24 | 205-205 | TS2532 | Object is possibly 'undefined'. |
| D0155 | tests | `src/app/api/calls/[callAttemptId]/agent-command/route.test.ts` | 154:11 | 206-206 | TS2488 | Type '[sessionUrl: URL, envelope: SessionCommandEnvelope] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D0156 | tests | `src/app/api/calls/[callAttemptId]/end/route.test.ts` | 130:12 | 207-207 | TS2532 | Object is possibly 'undefined'. |
| D0157 | tests | `src/app/api/campaigns/[id]/purchase/cardcom/route.test.ts` | 67:12 | 208-208 | TS2532 | Object is possibly 'undefined'. |
| D0158 | tests | `src/app/api/campaigns/[id]/purchase/cardcom/route.test.ts` | 70:12 | 209-209 | TS2532 | Object is possibly 'undefined'. |
| D0159 | tests | `src/app/api/campaigns/[id]/purchase/cardcom/route.test.ts` | 76:12 | 210-210 | TS2532 | Object is possibly 'undefined'. |
| D0160 | tests | `src/app/api/campaigns/[id]/purchase/cardcom/route.test.ts` | 79:12 | 211-211 | TS2532 | Object is possibly 'undefined'. |
| D0161 | tests | `src/app/api/campaigns/[id]/purchase/cardcom/route.test.ts` | 86:12 | 212-212 | TS2532 | Object is possibly 'undefined'. |
| D0162 | tests | `src/app/api/campaigns/[id]/purchase/route.test.ts` | 125:12 | 213-213 | TS2532 | Object is possibly 'undefined'. |
| D0163 | tests | `src/app/api/campaigns/[id]/purchase/route.test.ts` | 130:12 | 214-214 | TS2532 | Object is possibly 'undefined'. |
| D0164 | tests | `src/app/api/campaigns/[id]/purchase/settle/route.test.ts` | 69:12 | 215-215 | TS2532 | Object is possibly 'undefined'. |
| D0165 | tests | `src/app/api/campaigns/[id]/purchase/settle/route.test.ts` | 71:12 | 216-216 | TS2532 | Object is possibly 'undefined'. |
| D0166 | tests | `src/app/api/campaigns/[id]/purchase/settle/route.test.ts` | 73:12 | 217-217 | TS2532 | Object is possibly 'undefined'. |
| D0167 | tests | `src/app/api/campaigns/[id]/purchase/settle/route.test.ts` | 75:12 | 218-218 | TS2532 | Object is possibly 'undefined'. |
| D0168 | tests | `src/app/api/campaigns/[id]/purchase/settle/route.test.ts` | 80:12 | 219-219 | TS2532 | Object is possibly 'undefined'. |
| D0169 | tests | `src/app/api/campaigns/[id]/purchase/settle/route.test.ts` | 82:12 | 220-220 | TS2532 | Object is possibly 'undefined'. |
| D0170 | tests | `src/app/api/campaigns/[id]/purchase/settle/route.test.ts` | 87:12 | 221-221 | TS2532 | Object is possibly 'undefined'. |
| D0171 | tests | `src/app/api/campaigns/[id]/purchase/settle/route.test.ts` | 89:12 | 222-222 | TS2532 | Object is possibly 'undefined'. |
| D0172 | tests | `src/app/api/campaigns/[id]/purchase/settle/route.test.ts` | 91:12 | 223-223 | TS2532 | Object is possibly 'undefined'. |
| D0173 | tests | `src/app/api/campaigns/[id]/purchase/settle/route.test.ts` | 112:12 | 224-224 | TS2532 | Object is possibly 'undefined'. |
| D0174 | tests | `src/app/api/cardcom/document-webhook/route.test.ts` | 92:12 | 225-225 | TS2532 | Object is possibly 'undefined'. |
| D0175 | tests | `src/app/api/cardcom/document-webhook/route.test.ts` | 98:12 | 226-226 | TS2532 | Object is possibly 'undefined'. |
| D0176 | tests | `src/app/api/cardcom/webhook/route.test.ts` | 105:12 | 227-227 | TS2532 | Object is possibly 'undefined'. |
| D0177 | tests | `src/app/api/elevenlabs/rsvp-sales-call-dispatch/pcw_id/route.test.ts` | 116:27 | 228-228 | TS2532 | Object is possibly 'undefined'. |
| D0178 | tests | `src/app/api/elevenlabs/rsvp/update/route.test.ts` | 136:27 | 229-229 | TS2532 | Object is possibly 'undefined'. |
| D0179 | tests | `src/app/api/events/[eventId]/outreach-call/route.test.ts` | 133:11 | 230-230 | TS2488 | Type 'any[] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D0180 | tests | `src/app/api/events/[eventId]/outreach-call/route.test.ts` | 159:12 | 231-231 | TS2532 | Object is possibly 'undefined'. |
| D0181 | tests | `src/app/api/events/[eventId]/outreach-call/route.test.ts` | 255:12 | 232-232 | TS2532 | Object is possibly 'undefined'. |
| D0182 | backend | `src/app/api/events/[eventId]/outreach-call/route.ts` | 147:17 | 233-233 | TS18048 | 'campaign' is possibly 'undefined'. |
| D0183 | tests | `src/app/api/integrations/oauth/route.test.ts` | 115:20 | 234-234 | TS2532 | Object is possibly 'undefined'. |
| D0184 | tests | `src/app/api/integrations/oauth/route.test.ts` | 192:20 | 235-235 | TS2532 | Object is possibly 'undefined'. |
| D0185 | tests | `src/app/api/integrations/oauth/route.test.ts` | 210:20 | 236-236 | TS2532 | Object is possibly 'undefined'. |
| D0186 | tests | `src/app/api/integrations/oauth/route.test.ts` | 322:12 | 237-237 | TS2532 | Object is possibly 'undefined'. |
| D0187 | tests | `src/app/api/integrations/oauth/route.test.ts` | 341:12 | 238-238 | TS2532 | Object is possibly 'undefined'. |
| D0188 | tests | `src/app/api/mcp/route.test.ts` | 251:12 | 239-239 | TS2532 | Object is possibly 'undefined'. |
| D0189 | tests | `src/app/api/mcp/route.test.ts` | 266:12 | 240-240 | TS2532 | Object is possibly 'undefined'. |
| D0190 | tests | `src/app/api/voximplant/console/event/route.test.ts` | 95:19 | 241-241 | TS2532 | Object is possibly 'undefined'. |
| D0191 | tests | `src/app/api/voximplant/console/event/route.test.ts` | 110:19 | 242-242 | TS2532 | Object is possibly 'undefined'. |
| D0192 | tests | `src/app/api/voximplant/console/event/route.test.ts` | 271:19 | 243-243 | TS2532 | Object is possibly 'undefined'. |
| D0193 | backend | `src/app/api/voximplant/ctx/[token]/route.ts` | 43:10 | 244-244 | TS2532 | Object is possibly 'undefined'. |
| D0194 | tests | `src/app/api/webhooks/resend/route.test.ts` | 122:19 | 245-245 | TS2532 | Object is possibly 'undefined'. |
| D0195 | tests | `src/app/api/webhooks/resend/route.test.ts` | 147:30 | 246-246 | TS2532 | Object is possibly 'undefined'. |
| D0196 | tests | `src/app/api/webhooks/resend/route.test.ts` | 159:12 | 247-247 | TS18048 | 'row' is possibly 'undefined'. |
| D0197 | tests | `src/app/api/webhooks/resend/route.test.ts` | 162:12 | 248-248 | TS18048 | 'row' is possibly 'undefined'. |
| D0198 | tests | `src/app/api/webhooks/resend/route.test.ts` | 164:21 | 249-249 | TS18048 | 'row' is possibly 'undefined'. |
| D0199 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 113:10 | 250-250 | TS2532 | Object is possibly 'undefined'. |
| D0200 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 159:12 | 251-251 | TS2532 | Object is possibly 'undefined'. |
| D0201 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 380:12 | 252-252 | TS2532 | Object is possibly 'undefined'. |
| D0202 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 496:12 | 253-253 | TS2532 | Object is possibly 'undefined'. |
| D0203 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 497:12 | 254-254 | TS2532 | Object is possibly 'undefined'. |
| D0204 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 504:12 | 255-255 | TS2532 | Object is possibly 'undefined'. |
| D0205 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 504:42 | 256-256 | TS2532 | Object is possibly 'undefined'. |
| D0206 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 514:12 | 257-257 | TS18048 | 'row' is possibly 'undefined'. |
| D0207 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 518:12 | 258-258 | TS18048 | 'row' is possibly 'undefined'. |
| D0208 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 555:12 | 259-259 | TS2532 | Object is possibly 'undefined'. |
| D0209 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 569:12 | 260-260 | TS2532 | Object is possibly 'undefined'. |
| D0210 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 638:12 | 261-261 | TS18048 | 'first' is possibly 'undefined'. |
| D0211 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 639:12 | 262-262 | TS18048 | 'first' is possibly 'undefined'. |
| D0212 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 644:12 | 263-263 | TS2532 | Object is possibly 'undefined'. |
| D0213 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 644:46 | 264-264 | TS18048 | 'first' is possibly 'undefined'. |
| D0214 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 655:12 | 265-265 | TS2532 | Object is possibly 'undefined'. |
| D0215 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 662:12 | 266-266 | TS2532 | Object is possibly 'undefined'. |
| D0216 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 690:12 | 267-267 | TS18048 | 'row' is possibly 'undefined'. |
| D0217 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 691:12 | 268-268 | TS18048 | 'row' is possibly 'undefined'. |
| D0218 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 705:12 | 269-269 | TS2532 | Object is possibly 'undefined'. |
| D0219 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 725:21 | 270-270 | TS2532 | Object is possibly 'undefined'. |
| D0220 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 741:12 | 271-271 | TS2532 | Object is possibly 'undefined'. |
| D0221 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 756:19 | 272-272 | TS2532 | Object is possibly 'undefined'. |
| D0222 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 767:12 | 273-273 | TS2532 | Object is possibly 'undefined'. |
| D0223 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 1255:16 | 274-274 | TS2532 | Object is possibly 'undefined'. |
| D0224 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 1281:18 | 275-275 | TS2532 | Object is possibly 'undefined'. |
| D0225 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 1286:18 | 276-276 | TS2532 | Object is possibly 'undefined'. |
| D0226 | tests | `src/app/api/webhooks/whatsapp/route.test.ts` | 1369:12 | 277-277 | TS2532 | Object is possibly 'undefined'. |
| D0227 | backend | `src/app/api/webhooks/whatsapp/route.ts` | 106:9 | 278-279 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0228 | tests | `src/app/auth/actions.test.ts` | 253:17 | 280-280 | TS2532 | Object is possibly 'undefined'. |
| D0229 | tests | `src/app/auth/signup/signup-form.test.tsx` | 19:12 | 281-281 | TS18048 | 'marketing' is possibly 'undefined'. |
| D0230 | tests | `src/app/auth/signup/signup-form.test.tsx` | 20:12 | 282-282 | TS18048 | 'marketing' is possibly 'undefined'. |
| D0231 | tests | `src/components/add-to-calendar.test.ts` | 61:12 | 283-283 | TS2532 | Object is possibly 'undefined'. |
| D0232 | tests | `src/components/add-to-calendar.test.ts` | 62:12 | 284-284 | TS2532 | Object is possibly 'undefined'. |
| D0233 | tests | `src/components/add-to-calendar.test.ts` | 63:12 | 285-285 | TS2532 | Object is possibly 'undefined'. |
| D0234 | tests | `src/components/admin-nav-coverage.test.ts` | 127:32 | 286-287 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0235 | tests | `src/components/admin-nav-coverage.test.ts` | 127:43 | 288-289 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0236 | ui-scripts | `src/components/console/softphone-panel.tsx` | 613:20 | 290-290 | TS2532 | Object is possibly 'undefined'. |
| D0237 | ui-scripts | `src/components/date-select-il.tsx` | 75:38 | 291-292 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0238 | ui-scripts | `src/components/date-select-il.tsx` | 75:59 | 293-294 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0239 | tests | `src/components/jsonforms/value-path-control.test.ts` | 196:16 | 295-296 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'HTMLElement'.<br>  Type 'undefined' is not assignable to type 'HTMLElement'. |
| D0240 | tests | `src/components/jsonforms/value-path-control.test.ts` | 196:60 | 297-298 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'HTMLElement'.<br>  Type 'undefined' is not assignable to type 'HTMLElement'. |
| D0241 | tests | `src/components/jsonforms/value-path-control.test.ts` | 197:16 | 299-300 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'HTMLElement'.<br>  Type 'undefined' is not assignable to type 'HTMLElement'. |
| D0242 | tests | `src/components/jsonforms/value-path-control.test.ts` | 197:61 | 301-302 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'HTMLElement'.<br>  Type 'undefined' is not assignable to type 'HTMLElement'. |
| D0243 | ui-scripts | `src/components/org-switcher.tsx` | 38:10 | 303-303 | TS18048 | 'active' is possibly 'undefined'. |
| D0244 | ui-scripts | `src/components/org-switcher.tsx` | 49:84 | 304-304 | TS18048 | 'active' is possibly 'undefined'. |
| D0245 | ui-scripts | `src/components/org-switcher.tsx` | 52:16 | 305-305 | TS18048 | 'active' is possibly 'undefined'. |
| D0246 | ui-scripts | `src/components/org-switcher.tsx` | 73:31 | 306-306 | TS18048 | 'active' is possibly 'undefined'. |
| D0247 | ui-scripts | `src/components/reui/event-calendar/event-calendar-lib.tsx` | 420:13 | 307-307 | TS18048 | 'row' is possibly 'undefined'. |
| D0248 | ui-scripts | `src/components/reui/event-calendar/event-calendar-lib.tsx` | 429:7 | 308-308 | TS2532 | Object is possibly 'undefined'. |
| D0249 | ui-scripts | `src/components/reui/event-calendar/event-calendar-month-view.tsx` | 343:51 | 309-310 | TS2345 | Argument of type 'Date &#124; undefined' is not assignable to parameter of type 'Date'.<br>  Type 'undefined' is not assignable to type 'Date'. |
| D0250 | ui-scripts | `src/components/reui/event-calendar/event-calendar-month-view.tsx` | 347:5 | 311-312 | TS2345 | Argument of type 'Date &#124; undefined' is not assignable to parameter of type 'Date'.<br>  Type 'undefined' is not assignable to type 'Date'. |
| D0251 | ui-scripts | `src/components/reui/event-calendar/event-calendar-month-view.tsx` | 382:60 | 313-314 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D0252 | ui-scripts | `src/components/reui/event-calendar/event-calendar-month-view.tsx` | 496:29 | 315-316 | TS2345 | Argument of type 'Date &#124; undefined' is not assignable to parameter of type 'Date'.<br>  Type 'undefined' is not assignable to type 'Date'. |
| D0253 | ui-scripts | `src/components/reui/event-calendar/event-calendar-month-view.tsx` | 518:25 | 317-318 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D0254 | ui-scripts | `src/components/reui/event-calendar/event-calendar-month-view.tsx` | 521:11 | 319-320 | TS2322 | Type 'Set&lt;string&gt; &#124; undefined' is not assignable to type 'Set&lt;string&gt;'.<br>  Type 'undefined' is not assignable to type 'Set&lt;string&gt;'. |
| D0255 | ui-scripts | `src/components/reui/event-calendar/event-calendar-month-view.tsx` | 610:23 | 321-322 | TS2322 | Type 'Date &#124; undefined' is not assignable to type 'Date'.<br>  Type 'undefined' is not assignable to type 'Date'. |
| D0256 | tests | `src/components/reui/event-calendar/event-calendar-recurrence.test.ts` | 474:14 | 323-323 | TS2532 | Object is possibly 'undefined'. |
| D0257 | tests | `src/components/reui/event-calendar/event-calendar-recurrence.test.ts` | 480:14 | 324-324 | TS2532 | Object is possibly 'undefined'. |
| D0258 | ui-scripts | `src/components/reui/event-calendar/event-calendar-recurrence.tsx` | 509:7 | 325-325 | TS2532 | Object is possibly 'undefined'. |
| D0259 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 455:17 | 326-326 | TS2532 | Object is possibly 'undefined'. |
| D0260 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 463:58 | 327-327 | TS2532 | Object is possibly 'undefined'. |
| D0261 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 495:30 | 328-328 | TS18048 | 'o' is possibly 'undefined'. |
| D0262 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 496:28 | 329-329 | TS18048 | 'o' is possibly 'undefined'. |
| D0263 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 497:27 | 330-330 | TS18048 | 'o' is possibly 'undefined'. |
| D0264 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 498:24 | 331-331 | TS18048 | 'o' is possibly 'undefined'. |
| D0265 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 499:27 | 332-332 | TS18048 | 'o' is possibly 'undefined'. |
| D0266 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 500:25 | 333-333 | TS18048 | 'o' is possibly 'undefined'. |
| D0267 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 564:34 | 334-335 | TS2345 | Argument of type 'Date &#124; undefined' is not assignable to parameter of type 'Date'.<br>  Type 'undefined' is not assignable to type 'Date'. |
| D0268 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 565:32 | 336-337 | TS2345 | Argument of type 'Date &#124; undefined' is not assignable to parameter of type 'Date'.<br>  Type 'undefined' is not assignable to type 'Date'. |
| D0269 | ui-scripts | `src/components/reui/event-calendar/event-calendar-time-grid.tsx` | 673:23 | 338-339 | TS2322 | Type 'Date &#124; undefined' is not assignable to type 'Date'.<br>  Type 'undefined' is not assignable to type 'Date'. |
| D0270 | ui-scripts | `src/components/time-select-24.tsx` | 47:40 | 340-341 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0271 | tests | `src/components/tiptap-ui/mention-dropdown-menu/mention-dropdown-menu.test.ts` | 105:12 | 342-342 | TS2532 | Object is possibly 'undefined'. |
| D0272 | tests | `src/components/tiptap-ui/mention-dropdown-menu/mention-dropdown-menu.test.ts` | 108:62 | 343-343 | TS2532 | Object is possibly 'undefined'. |
| D0273 | tests | `src/components/tiptap-ui/mention-dropdown-menu/mention-dropdown-menu.test.ts` | 201:19 | 344-345 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'HTMLElement'.<br>  Type 'undefined' is not assignable to type 'HTMLElement'. |
| D0274 | tests | `src/components/tiptap-ui/mention-dropdown-menu/mention-dropdown-menu.test.ts` | 203:19 | 346-347 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'HTMLElement'.<br>  Type 'undefined' is not assignable to type 'HTMLElement'. |
| D0275 | tests | `src/components/tiptap-ui/mention-dropdown-menu/mention-dropdown-menu.test.ts` | 249:23 | 348-349 | TS2345 | Argument of type 'HTMLElement &#124; undefined' is not assignable to parameter of type 'Element'.<br>  Type 'undefined' is not assignable to type 'Element'. |
| D0276 | tests | `src/components/tiptap-ui/mention-dropdown-menu/mention-dropdown-menu.test.ts` | 284:12 | 350-350 | TS2532 | Object is possibly 'undefined'. |
| D0277 | tests | `src/components/tiptap-ui/mention-dropdown-menu/mention-dropdown-menu.test.ts` | 334:62 | 351-351 | TS2532 | Object is possibly 'undefined'. |
| D0278 | tests | `src/instrumentation.test.ts` | 228:12 | 352-352 | TS2532 | Object is possibly 'undefined'. |
| D0279 | tests | `src/instrumentation.test.ts` | 241:12 | 353-353 | TS2532 | Object is possibly 'undefined'. |
| D0280 | tests | `src/instrumentation.test.ts` | 258:12 | 354-354 | TS2532 | Object is possibly 'undefined'. |
| D0281 | tests | `src/instrumentation.test.ts` | 271:12 | 355-355 | TS2532 | Object is possibly 'undefined'. |
| D0282 | tests | `src/instrumentation.test.ts` | 391:12 | 356-356 | TS2532 | Object is possibly 'undefined'. |
| D0283 | tests | `src/lib/agreements/link-url.test.ts` | 41:30 | 357-357 | TS2532 | Object is possibly 'undefined'. |
| D0284 | tests | `src/lib/agreements/pdf-html.test.ts` | 193:12 | 358-358 | TS18048 | 'block' is possibly 'undefined'. |
| D0285 | tests | `src/lib/agreements/pdf-html.test.ts` | 216:12 | 359-359 | TS18048 | 'block' is possibly 'undefined'. |
| D0286 | tests | `src/lib/agreements/pdf-html.test.ts` | 243:7 | 360-360 | TS2532 | Object is possibly 'undefined'. |
| D0287 | backend | `src/lib/agreements/pdf-html.ts` | 177:37 | 361-362 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0288 | backend | `src/lib/agreements/pdf-html.ts` | 181:19 | 363-363 | TS2532 | Object is possibly 'undefined'. |
| D0289 | backend | `src/lib/agreements/pdf-html.ts` | 206:5 | 364-365 | TS2322 | Type 'T &#124; undefined' is not assignable to type 'T'.<br>  'T' could be instantiated with an arbitrary type which could be unrelated to 'T &#124; undefined'. |
| D0290 | backend | `src/lib/agreements/pdf-html.ts` | 207:5 | 366-367 | TS2322 | Type 'T &#124; undefined' is not assignable to type 'T'.<br>  'T' could be instantiated with an arbitrary type which could be unrelated to 'T &#124; undefined'. |
| D0291 | backend | `src/lib/agreements/pdf-html.ts` | 208:5 | 368-369 | TS2322 | Type 'T &#124; undefined' is not assignable to type 'T'.<br>  'T' could be instantiated with an arbitrary type which could be unrelated to 'T &#124; undefined'. |
| D0292 | backend | `src/lib/agreements/pdf-html.ts` | 209:5 | 370-371 | TS2322 | Type 'T &#124; undefined' is not assignable to type 'T'.<br>  'T' could be instantiated with an arbitrary type which could be unrelated to 'T &#124; undefined'. |
| D0293 | backend | `src/lib/agreements/pdf-html.ts` | 399:11 | 372-372 | TS2532 | Object is possibly 'undefined'. |
| D0294 | tests | `src/lib/ai/package-copy-skills.test.ts` | 22:21 | 373-373 | TS2532 | Object is possibly 'undefined'. |
| D0295 | tests | `src/lib/ai/package-copy.test.ts` | 25:21 | 374-374 | TS2532 | Object is possibly 'undefined'. |
| D0296 | tests | `src/lib/ai/package-copy.test.ts` | 45:28 | 375-375 | TS2532 | Object is possibly 'undefined'. |
| D0297 | tests | `src/lib/ai/package-copy.test.ts` | 45:55 | 376-376 | TS2532 | Object is possibly 'undefined'. |
| D0298 | tests | `src/lib/ai/package-copy.test.ts` | 55:28 | 377-377 | TS2532 | Object is possibly 'undefined'. |
| D0299 | tests | `src/lib/ai/package-copy.test.ts` | 55:55 | 378-378 | TS2532 | Object is possibly 'undefined'. |
| D0300 | tests | `src/lib/alerts/slack.test.ts` | 80:10 | 379-379 | TS2532 | Object is possibly 'undefined'. |
| D0301 | tests | `src/lib/analytics/ga4-mappers.test.ts` | 123:12 | 380-380 | TS2532 | Object is possibly 'undefined'. |
| D0302 | tests | `src/lib/analytics/ga4-mappers.test.ts` | 201:12 | 381-381 | TS2532 | Object is possibly 'undefined'. |
| D0303 | tests | `src/lib/analytics/ga4-mappers.test.ts` | 280:12 | 382-382 | TS2532 | Object is possibly 'undefined'. |
| D0304 | tests | `src/lib/analytics/ga4-mappers.test.ts` | 281:12 | 383-383 | TS2532 | Object is possibly 'undefined'. |
| D0305 | tests | `src/lib/analytics/ga4-mappers.test.ts` | 411:12 | 384-384 | TS2532 | Object is possibly 'undefined'. |
| D0306 | tests | `src/lib/analytics/ga4-mappers.test.ts` | 412:12 | 385-385 | TS2532 | Object is possibly 'undefined'. |
| D0307 | tests | `src/lib/analytics/ga4-requests.test.ts` | 74:12 | 386-386 | TS2532 | Object is possibly 'undefined'. |
| D0308 | tests | `src/lib/analytics/ga4-requests.test.ts` | 81:14 | 387-387 | TS2532 | Object is possibly 'undefined'. |
| D0309 | tests | `src/lib/analytics/ga4-requests.test.ts` | 92:19 | 388-388 | TS2532 | Object is possibly 'undefined'. |
| D0310 | tests | `src/lib/analytics/ga4-requests.test.ts` | 106:12 | 389-389 | TS18048 | 'top' is possibly 'undefined'. |
| D0311 | tests | `src/lib/analytics/ga4-requests.test.ts` | 107:22 | 390-390 | TS18048 | 'top' is possibly 'undefined'. |
| D0312 | tests | `src/lib/analytics/ga4-requests.test.ts` | 112:7 | 391-391 | TS18048 | 'top' is possibly 'undefined'. |
| D0313 | tests | `src/lib/analytics/ga4-requests.test.ts` | 120:12 | 392-392 | TS18048 | 'sources' is possibly 'undefined'. |
| D0314 | tests | `src/lib/analytics/ga4-requests.test.ts` | 128:12 | 393-393 | TS2532 | Object is possibly 'undefined'. |
| D0315 | tests | `src/lib/analytics/ga4-requests.test.ts` | 134:12 | 394-394 | TS18048 | 'events' is possibly 'undefined'. |
| D0316 | tests | `src/lib/analytics/ga4-requests.test.ts` | 135:12 | 395-395 | TS18048 | 'events' is possibly 'undefined'. |
| D0317 | tests | `src/lib/analytics/ga4-requests.test.ts` | 141:12 | 396-396 | TS18048 | 'funnel' is possibly 'undefined'. |
| D0318 | tests | `src/lib/analytics/ga4-requests.test.ts` | 142:12 | 397-397 | TS18048 | 'funnel' is possibly 'undefined'. |
| D0319 | tests | `src/lib/analytics/ga4-requests.test.ts` | 143:12 | 398-398 | TS18048 | 'funnel' is possibly 'undefined'. |
| D0320 | tests | `src/lib/analytics/ga4-requests.test.ts` | 144:12 | 399-399 | TS18048 | 'funnel' is possibly 'undefined'. |
| D0321 | tests | `src/lib/analytics/ga4-requests.test.ts` | 151:12 | 400-400 | TS18048 | 'notFound' is possibly 'undefined'. |
| D0322 | tests | `src/lib/analytics/ga4-requests.test.ts` | 152:12 | 401-401 | TS18048 | 'notFound' is possibly 'undefined'. |
| D0323 | tests | `src/lib/analytics/ga4-requests.test.ts` | 153:12 | 402-402 | TS18048 | 'notFound' is possibly 'undefined'. |
| D0324 | tests | `src/lib/analytics/ga4-requests.test.ts` | 154:12 | 403-403 | TS18048 | 'notFound' is possibly 'undefined'. |
| D0325 | tests | `src/lib/analytics/ga4-requests.test.ts` | 165:12 | 404-404 | TS2532 | Object is possibly 'undefined'. |
| D0326 | tests | `src/lib/analytics/ga4-requests.test.ts` | 192:12 | 405-405 | TS2532 | Object is possibly 'undefined'. |
| D0327 | tests | `src/lib/analytics/ga4-requests.test.ts` | 193:12 | 406-406 | TS2532 | Object is possibly 'undefined'. |
| D0328 | tests | `src/lib/analytics/ga4-requests.test.ts` | 194:12 | 407-407 | TS2532 | Object is possibly 'undefined'. |
| D0329 | tests | `src/lib/analytics/ga4-requests.test.ts` | 195:12 | 408-408 | TS2532 | Object is possibly 'undefined'. |
| D0330 | tests | `src/lib/analytics/ga4-requests.test.ts` | 205:12 | 409-409 | TS18048 | 'campaigns' is possibly 'undefined'. |
| D0331 | tests | `src/lib/analytics/ga4-requests.test.ts` | 210:12 | 410-410 | TS18048 | 'campaigns' is possibly 'undefined'. |
| D0332 | tests | `src/lib/analytics/ga4-requests.test.ts` | 222:12 | 411-411 | TS18048 | 'campaignLeads' is possibly 'undefined'. |
| D0333 | tests | `src/lib/analytics/ga4-requests.test.ts` | 227:12 | 412-412 | TS18048 | 'campaignLeads' is possibly 'undefined'. |
| D0334 | tests | `src/lib/analytics/ga4-requests.test.ts` | 228:12 | 413-413 | TS18048 | 'campaignLeads' is possibly 'undefined'. |
| D0335 | tests | `src/lib/analytics/ga4-requests.test.ts` | 229:12 | 414-414 | TS18048 | 'campaignLeads' is possibly 'undefined'. |
| D0336 | tests | `src/lib/analytics/ga4-requests.test.ts` | 238:12 | 415-415 | TS2532 | Object is possibly 'undefined'. |
| D0337 | tests | `src/lib/analytics/ga4-requests.test.ts` | 241:12 | 416-416 | TS2532 | Object is possibly 'undefined'. |
| D0338 | tests | `src/lib/analytics/ga4-requests.test.ts` | 268:37 | 417-417 | TS18048 | 'req' is possibly 'undefined'. |
| D0339 | tests | `src/lib/analytics/ga4-requests.test.ts` | 276:19 | 418-418 | TS18048 | 'req' is possibly 'undefined'. |
| D0340 | tests | `src/lib/analytics/ga4-requests.test.ts` | 283:7 | 419-419 | TS18048 | 'topPages' is possibly 'undefined'. |
| D0341 | tests | `src/lib/analytics/ga4-requests.test.ts` | 286:7 | 420-420 | TS18048 | 'funnel' is possibly 'undefined'. |
| D0342 | tests | `src/lib/analytics/ga4-requests.test.ts` | 291:12 | 421-421 | TS2532 | Object is possibly 'undefined'. |
| D0343 | tests | `src/lib/analytics/ga4-requests.test.ts` | 292:12 | 422-422 | TS2532 | Object is possibly 'undefined'. |
| D0344 | tests | `src/lib/analytics/ga4-requests.test.ts` | 293:12 | 423-423 | TS2532 | Object is possibly 'undefined'. |
| D0345 | tests | `src/lib/analytics/ga4-requests.test.ts` | 294:12 | 424-424 | TS2532 | Object is possibly 'undefined'. |
| D0346 | tests | `src/lib/analytics/ga4-requests.test.ts` | 302:12 | 425-425 | TS2532 | Object is possibly 'undefined'. |
| D0347 | tests | `src/lib/analytics/ga4-requests.test.ts` | 303:12 | 426-426 | TS2532 | Object is possibly 'undefined'. |
| D0348 | tests | `src/lib/analytics/ga4-requests.test.ts` | 304:12 | 427-427 | TS2532 | Object is possibly 'undefined'. |
| D0349 | tests | `src/lib/analytics/ga4-requests.test.ts` | 305:12 | 428-428 | TS2532 | Object is possibly 'undefined'. |
| D0350 | tests | `src/lib/auth/admin-data-layer-coverage.test.ts` | 79:19 | 429-430 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0351 | tests | `src/lib/auth/admin-data-layer-coverage.test.ts` | 364:22 | 431-432 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0352 | tests | `src/lib/auth/admin-data-layer-coverage.test.ts` | 373:37 | 433-433 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D0353 | tests | `src/lib/auth/admin-data-layer-coverage.test.ts` | 381:22 | 434-434 | TS7006 | Parameter 'pair' implicitly has an 'any' type. |
| D0354 | tests | `src/lib/auth/admin-data-layer-coverage.test.ts` | 809:9 | 435-435 | TS18048 | 'd.kind' is possibly 'undefined'. |
| D0355 | tests | `src/lib/auth/admin-data-layer-coverage.test.ts` | 810:18 | 436-437 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0356 | tests | `src/lib/auth/admin-data-layer-coverage.test.ts` | 817:20 | 438-439 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0357 | backend | `src/lib/auth/console-agent.ts` | 36:14 | 440-440 | TS2532 | Object is possibly 'undefined'. |
| D0358 | tests | `src/lib/auth/console-findings.local-it.test.ts` | 88:12 | 441-441 | TS2532 | Object is possibly 'undefined'. |
| D0359 | tests | `src/lib/auth/console-findings.local-it.test.ts` | 90:22 | 442-442 | TS2532 | Object is possibly 'undefined'. |
| D0360 | tests | `src/lib/auth/console-findings.local-it.test.ts` | 118:20 | 443-443 | TS2532 | Object is possibly 'undefined'. |
| D0361 | tests | `src/lib/auth/console-findings.local-it.test.ts` | 119:18 | 444-444 | TS2532 | Object is possibly 'undefined'. |
| D0362 | tests | `src/lib/auth/console-findings.local-it.test.ts` | 124:19 | 445-445 | TS2532 | Object is possibly 'undefined'. |
| D0363 | tests | `src/lib/auth/console-findings.local-it.test.ts` | 157:12 | 446-446 | TS2532 | Object is possibly 'undefined'. |
| D0364 | tests | `src/lib/auth/console-findings.local-it.test.ts` | 159:20 | 447-447 | TS2532 | Object is possibly 'undefined'. |
| D0365 | tests | `src/lib/auth/console-findings.local-it.test.ts` | 160:18 | 448-448 | TS2532 | Object is possibly 'undefined'. |
| D0366 | tests | `src/lib/auth/console-findings.local-it.test.ts` | 337:82 | 449-449 | TS2532 | Object is possibly 'undefined'. |
| D0367 | tests | `src/lib/auth/console-views.local-it.test.ts` | 82:13 | 450-450 | TS2532 | Object is possibly 'undefined'. |
| D0368 | tests | `src/lib/auth/console-views.local-it.test.ts` | 83:22 | 451-451 | TS2532 | Object is possibly 'undefined'. |
| D0369 | tests | `src/lib/auth/console-views.local-it.test.ts` | 85:5 | 452-452 | TS2532 | Object is possibly 'undefined'. |
| D0370 | tests | `src/lib/auth/console-views.local-it.test.ts` | 122:21 | 453-453 | TS2532 | Object is possibly 'undefined'. |
| D0371 | tests | `src/lib/auth/console-views.local-it.test.ts` | 123:19 | 454-454 | TS2532 | Object is possibly 'undefined'. |
| D0372 | tests | `src/lib/auth/console-views.local-it.test.ts` | 128:21 | 455-455 | TS2532 | Object is possibly 'undefined'. |
| D0373 | tests | `src/lib/auth/console-views.local-it.test.ts` | 145:14 | 456-456 | TS2532 | Object is possibly 'undefined'. |
| D0374 | tests | `src/lib/auth/console-views.local-it.test.ts` | 147:22 | 457-457 | TS2532 | Object is possibly 'undefined'. |
| D0375 | tests | `src/lib/auth/console-views.local-it.test.ts` | 148:20 | 458-458 | TS2532 | Object is possibly 'undefined'. |
| D0376 | tests | `src/lib/auth/console-views.local-it.test.ts` | 225:12 | 459-459 | TS2532 | Object is possibly 'undefined'. |
| D0377 | tests | `src/lib/auth/console-views.local-it.test.ts` | 238:26 | 460-460 | TS18048 | 'r.value' is possibly 'undefined'. |
| D0378 | tests | `src/lib/auth/console-views.local-it.test.ts` | 277:25 | 461-461 | TS2532 | Object is possibly 'undefined'. |
| D0379 | tests | `src/lib/auth/console-views.local-it.test.ts` | 278:31 | 462-462 | TS2532 | Object is possibly 'undefined'. |
| D0380 | tests | `src/lib/auth/console-views.local-it.test.ts` | 279:31 | 463-463 | TS2532 | Object is possibly 'undefined'. |
| D0381 | tests | `src/lib/auth/console-views.local-it.test.ts` | 280:35 | 464-464 | TS2532 | Object is possibly 'undefined'. |
| D0382 | tests | `src/lib/auth/console-views.local-it.test.ts` | 281:32 | 465-465 | TS2532 | Object is possibly 'undefined'. |
| D0383 | tests | `src/lib/auth/console-views.local-it.test.ts` | 291:50 | 466-466 | TS2532 | Object is possibly 'undefined'. |
| D0384 | tests | `src/lib/auth/console-views.local-it.test.ts` | 344:44 | 467-467 | TS2532 | Object is possibly 'undefined'. |
| D0385 | tests | `src/lib/auth/console-views.local-it.test.ts` | 353:50 | 468-468 | TS2532 | Object is possibly 'undefined'. |
| D0386 | tests | `src/lib/auth/console-views.local-it.test.ts` | 356:50 | 469-469 | TS2532 | Object is possibly 'undefined'. |
| D0387 | tests | `src/lib/auth/console-views.local-it.test.ts` | 357:50 | 470-470 | TS2532 | Object is possibly 'undefined'. |
| D0388 | tests | `src/lib/auth/console-views.local-it.test.ts` | 365:58 | 471-471 | TS2532 | Object is possibly 'undefined'. |
| D0389 | tests | `src/lib/auth/console-views.local-it.test.ts` | 415:25 | 472-472 | TS2532 | Object is possibly 'undefined'. |
| D0390 | tests | `src/lib/auth/console-views.local-it.test.ts` | 416:23 | 473-473 | TS2532 | Object is possibly 'undefined'. |
| D0391 | tests | `src/lib/auth/console-views.local-it.test.ts` | 417:22 | 474-474 | TS2532 | Object is possibly 'undefined'. |
| D0392 | tests | `src/lib/auth/console-views.local-it.test.ts` | 418:20 | 475-475 | TS2532 | Object is possibly 'undefined'. |
| D0393 | tests | `src/lib/auth/console-views.local-it.test.ts` | 419:24 | 476-476 | TS2532 | Object is possibly 'undefined'. |
| D0394 | tests | `src/lib/auth/console-views.local-it.test.ts` | 423:17 | 477-477 | TS2532 | Object is possibly 'undefined'. |
| D0395 | tests | `src/lib/auth/console-views.local-it.test.ts` | 424:20 | 478-478 | TS2532 | Object is possibly 'undefined'. |
| D0396 | tests | `src/lib/auth/console-views.local-it.test.ts` | 425:18 | 479-479 | TS2532 | Object is possibly 'undefined'. |
| D0397 | tests | `src/lib/auth/console-views.local-it.test.ts` | 428:15 | 480-480 | TS2532 | Object is possibly 'undefined'. |
| D0398 | tests | `src/lib/auth/console-views.local-it.test.ts` | 429:19 | 481-481 | TS2532 | Object is possibly 'undefined'. |
| D0399 | tests | `src/lib/auth/console-views.local-it.test.ts` | 458:17 | 482-482 | TS2532 | Object is possibly 'undefined'. |
| D0400 | tests | `src/lib/auth/console-views.local-it.test.ts` | 474:27 | 483-483 | TS2532 | Object is possibly 'undefined'. |
| D0401 | tests | `src/lib/auth/console-views.local-it.test.ts` | 475:29 | 484-484 | TS2532 | Object is possibly 'undefined'. |
| D0402 | tests | `src/lib/auth/console-views.local-it.test.ts` | 476:28 | 485-485 | TS2532 | Object is possibly 'undefined'. |
| D0403 | tests | `src/lib/auth/console-views.local-it.test.ts` | 477:30 | 486-486 | TS2532 | Object is possibly 'undefined'. |
| D0404 | tests | `src/lib/auth/console-views.local-it.test.ts` | 606:12 | 487-487 | TS18048 | 'r' is possibly 'undefined'. |
| D0405 | tests | `src/lib/auth/console-views.local-it.test.ts` | 607:11 | 488-488 | TS18048 | 'r' is possibly 'undefined'. |
| D0406 | tests | `src/lib/auth/console-views.local-it.test.ts` | 608:11 | 489-489 | TS18048 | 'r' is possibly 'undefined'. |
| D0407 | tests | `src/lib/auth/console-views.local-it.test.ts` | 609:11 | 490-490 | TS18048 | 'r' is possibly 'undefined'. |
| D0408 | tests | `src/lib/auth/console-views.local-it.test.ts` | 609:80 | 491-491 | TS18048 | 'r' is possibly 'undefined'. |
| D0409 | tests | `src/lib/auth/console-views.local-it.test.ts` | 674:7 | 492-492 | TS2532 | Object is possibly 'undefined'. |
| D0410 | tests | `src/lib/auth/console-views.local-it.test.ts` | 708:11 | 493-493 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D0411 | tests | `src/lib/auth/console-views.local-it.test.ts` | 739:13 | 494-494 | TS18048 | 'pol' is possibly 'undefined'. |
| D0412 | tests | `src/lib/auth/console-views.local-it.test.ts` | 739:23 | 495-495 | TS18048 | 'pol' is possibly 'undefined'. |
| D0413 | tests | `src/lib/auth/permissions.local-it.test.ts` | 352:41 | 496-497 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0414 | tests | `src/lib/auth/permissions.local-it.test.ts` | 353:48 | 498-499 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0415 | backend | `src/lib/auth/platform-ability.ts` | 85:9 | 500-502 | TS2322 | Type '("campaigns.runstate" &#124; "events.mark_test" &#124; "events.purge_test" &#124; "integrations.manage" &#124; "integrations.read" &#124; "manage_billing" &#124; "manage_settings" &#124; "manage_staff" &#124; "manage_voice" &#124; ... 8 more ... &#124; undefined)[]' is not assignable to type '("campaigns.runstate" &#124; "events.mark_test" &#124; "events.purge_test" &#124; "integrations.manage" &#124; "integrations.read" &#124; "manage_billing" &#124; "manage_settings" &#124; "manage_staff" &#124; "manage_voice" &#124; ... 7 more ... &#124; "view_webhooks")[]'.<br>  Type '"campaigns.runstate" &#124; "events.mark_test" &#124; "events.purge_test" &#124; "integrations.manage" &#124; "integrations.read" &#124; "manage_billing" &#124; "manage_settings" &#124; "manage_staff" &#124; "manage_voice" &#124; ... 8 more ... &#124; undefined' is not assignable to type '"campaigns.runstate" &#124; "events.mark_test" &#124; "events.purge_test" &#124; "integrations.manage" &#124; "integrations.read" &#124; "manage_billing" &#124; "manage_settings" &#124; "manage_staff" &#124; "manage_voice" &#124; ... 7 more ... &#124; "view_webhooks"'.<br>    Type 'undefined' is not assignable to type '"campaigns.runstate" &#124; "events.mark_test" &#124; "events.purge_test" &#124; "integrations.manage" &#124; "integrations.read" &#124; "manage_billing" &#124; "manage_settings" &#124; "manage_staff" &#124; "manage_voice" &#124; ... 7 more ... &#124; "view_webhooks"'. |
| D0416 | backend | `src/lib/auth/staff-table-permissions.ts` | 156:13 | 503-504 | TS2322 | Type '"campaigns.runstate" &#124; "events.mark_test" &#124; "events.purge_test" &#124; "integrations.manage" &#124; "integrations.read" &#124; "manage_billing" &#124; "manage_settings" &#124; "manage_staff" &#124; "manage_voice" &#124; ... 8 more ... &#124; undefined' is not assignable to type '"campaigns.runstate" &#124; "events.mark_test" &#124; "events.purge_test" &#124; "integrations.manage" &#124; "integrations.read" &#124; "manage_billing" &#124; "manage_settings" &#124; "manage_staff" &#124; "manage_voice" &#124; ... 7 more ... &#124; "view_webhooks"'.<br>  Type 'undefined' is not assignable to type '"campaigns.runstate" &#124; "events.mark_test" &#124; "events.purge_test" &#124; "integrations.manage" &#124; "integrations.read" &#124; "manage_billing" &#124; "manage_settings" &#124; "manage_staff" &#124; "manage_voice" &#124; ... 7 more ... &#124; "view_webhooks"'. |
| D0417 | tests | `src/lib/auth/staff-table-rls.test.ts` | 61:9 | 505-505 | TS2532 | Object is possibly 'undefined'. |
| D0418 | tests | `src/lib/auth/staff-table-rls.test.ts` | 62:27 | 506-506 | TS2532 | Object is possibly 'undefined'. |
| D0419 | tests | `src/lib/auth/staff-table-rls.test.ts` | 63:12 | 507-507 | TS2532 | Object is possibly 'undefined'. |
| D0420 | tests | `src/lib/auth/staff-table-rls.test.ts` | 64:12 | 508-508 | TS2532 | Object is possibly 'undefined'. |
| D0421 | tests | `src/lib/auth/staff-table-rls.test.ts` | 67:10 | 509-509 | TS2532 | Object is possibly 'undefined'. |
| D0422 | tests | `src/lib/auth/staff-table-rls.test.ts` | 113:14 | 510-510 | TS2532 | Object is possibly 'undefined'. |
| D0423 | tests | `src/lib/auth/staff-table-rls.test.ts` | 168:18 | 511-511 | TS2532 | Object is possibly 'undefined'. |
| D0424 | backend | `src/lib/auth/staff-table-rls.ts` | 287:28 | 512-512 | TS18048 | 'f' is possibly 'undefined'. |
| D0425 | backend | `src/lib/auth/staff-table-rls.ts` | 288:72 | 513-513 | TS18048 | 'f' is possibly 'undefined'. |
| D0426 | backend | `src/lib/auth/staff-table-rls.ts` | 288:127 | 514-514 | TS18048 | 'f' is possibly 'undefined'. |
| D0427 | backend | `src/lib/auth/staff-table-rls.ts` | 289:68 | 515-515 | TS18048 | 'f' is possibly 'undefined'. |
| D0428 | backend | `src/lib/auth/staff-table-rls.ts` | 292:46 | 516-516 | TS18048 | 'f' is possibly 'undefined'. |
| D0429 | backend | `src/lib/auth/staff-table-rls.ts` | 293:46 | 517-517 | TS18048 | 'f' is possibly 'undefined'. |
| D0430 | backend | `src/lib/auth/staff-table-rls.ts` | 295:14 | 518-518 | TS18048 | 'f' is possibly 'undefined'. |
| D0431 | backend | `src/lib/auth/staff-table-rls.ts` | 296:36 | 519-519 | TS18048 | 'f' is possibly 'undefined'. |
| D0432 | backend | `src/lib/auth/staff-table-rls.ts` | 299:14 | 520-520 | TS18048 | 'f' is possibly 'undefined'. |
| D0433 | backend | `src/lib/auth/staff-table-rls.ts` | 300:35 | 521-521 | TS18048 | 'f' is possibly 'undefined'. |
| D0434 | backend | `src/lib/auth/staff-table-rls.ts` | 321:15 | 522-522 | TS18048 | 'f' is possibly 'undefined'. |
| D0435 | backend | `src/lib/auth/staff-table-rls.ts` | 322:55 | 523-523 | TS18048 | 'f' is possibly 'undefined'. |
| D0436 | backend | `src/lib/auth/staff-table-rls.ts` | 322:83 | 524-524 | TS18048 | 'f' is possibly 'undefined'. |
| D0437 | backend | `src/lib/auth/staff-table-rls.ts` | 336:59 | 525-525 | TS18048 | 'f' is possibly 'undefined'. |
| D0438 | backend | `src/lib/auth/staff-table-rls.ts` | 337:44 | 526-526 | TS18048 | 'f' is possibly 'undefined'. |
| D0439 | backend | `src/lib/auth/staff-table-rls.ts` | 337:60 | 527-527 | TS18048 | 'f' is possibly 'undefined'. |
| D0440 | backend | `src/lib/auth/staff-table-rls.ts` | 342:83 | 528-528 | TS18048 | 'f' is possibly 'undefined'. |
| D0441 | backend | `src/lib/auth/staff-table-rls.ts` | 342:136 | 529-529 | TS18048 | 'f' is possibly 'undefined'. |
| D0442 | tests | `src/lib/auth/staff-table-sql-consistency.test.ts` | 26:3 | 530-532 | TS2322 | Type '(string &#124; undefined)[]' is not assignable to type 'string[]'.<br>  Type 'string &#124; undefined' is not assignable to type 'string'.<br>    Type 'undefined' is not assignable to type 'string'. |
| D0443 | tests | `src/lib/auth/staff-table-sql-consistency.test.ts` | 48:32 | 533-534 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0444 | tests | `src/lib/auth/staff-table-sql-consistency.test.ts` | 49:28 | 535-536 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0445 | tests | `src/lib/auth/staff-table-sql-consistency.test.ts` | 65:26 | 537-538 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0446 | backend | `src/lib/calendar/event-calendar.ts` | 130:11 | 539-540 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D0447 | backend | `src/lib/calendar/event-calendar.ts` | 130:14 | 541-542 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D0448 | backend | `src/lib/calendar/event-calendar.ts` | 130:17 | 543-544 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D0449 | tests | `src/lib/callbacks/activity-timeline.test.ts` | 64:14 | 545-545 | TS18048 | 'slot' is possibly 'undefined'. |
| D0450 | tests | `src/lib/callbacks/activity-timeline.test.ts` | 123:12 | 546-546 | TS18048 | 'entry' is possibly 'undefined'. |
| D0451 | backend | `src/lib/callbacks/policy-config-admin.ts` | 45:22 | 547-547 | TS2532 | Object is possibly 'undefined'. |
| D0452 | tests | `src/lib/callbacks/schedule-policy.test.ts` | 18:29 | 548-548 | TS18048 | 'h' is possibly 'undefined'. |
| D0453 | tests | `src/lib/callbacks/schedule-policy.test.ts` | 18:38 | 549-549 | TS18048 | 'm' is possibly 'undefined'. |
| D0454 | backend | `src/lib/callbacks/schedule-policy.ts` | 103:36 | 550-550 | TS18048 | 'h' is possibly 'undefined'. |
| D0455 | backend | `src/lib/callbacks/schedule-policy.ts` | 103:45 | 551-551 | TS18048 | 'm' is possibly 'undefined'. |
| D0456 | backend | `src/lib/cardcom/document-types.ts` | 55:75 | 552-553 | TS2322 | Type 'DocumentType &#124; undefined' is not assignable to type 'DocumentType &#124; null'.<br>  Type 'undefined' is not assignable to type 'DocumentType &#124; null'. |
| D0457 | tests | `src/lib/cardcom/mutator.test.ts` | 53:12 | 554-554 | TS2532 | Object is possibly 'undefined'. |
| D0458 | tests | `src/lib/cardcom/mutator.test.ts` | 54:12 | 555-555 | TS2532 | Object is possibly 'undefined'. |
| D0459 | tests | `src/lib/cardcom/mutator.test.ts` | 55:12 | 556-556 | TS2532 | Object is possibly 'undefined'. |
| D0460 | tests | `src/lib/cardcom/mutator.test.ts` | 56:12 | 557-557 | TS2532 | Object is possibly 'undefined'. |
| D0461 | tests | `src/lib/cardcom/mutator.test.ts` | 57:24 | 558-558 | TS2532 | Object is possibly 'undefined'. |
| D0462 | tests | `src/lib/cardcom/open-fields.test.ts` | 251:12 | 559-559 | TS2532 | Object is possibly 'undefined'. |
| D0463 | tests | `src/lib/cardcom/open-fields.test.ts` | 252:24 | 560-560 | TS2532 | Object is possibly 'undefined'. |
| D0464 | tests | `src/lib/cardcom/open-fields.test.ts` | 253:13 | 561-561 | TS2532 | Object is possibly 'undefined'. |
| D0465 | tests | `src/lib/casl-pilot-static.test.ts` | 58:3 | 562-566 | TS2322 | Type '{ name: string &#124; undefined; body: string; }[]' is not assignable to type '{ name: string; body: string; }[]'.<br>  Type '{ name: string &#124; undefined; body: string; }' is not assignable to type '{ name: string; body: string; }'.<br>    Types of property 'name' are incompatible.<br>      Type 'string &#124; undefined' is not assignable to type 'string'.<br>        Type 'undefined' is not assignable to type 'string'. |
| D0466 | tests | `src/lib/consent/analytics-gate.test.ts` | 69:12 | 567-567 | TS18048 | 'categories.analytics' is possibly 'undefined'. |
| D0467 | tests | `src/lib/consent/analytics-gate.test.ts` | 70:12 | 568-568 | TS18048 | 'categories.analytics' is possibly 'undefined'. |
| D0468 | tests | `src/lib/consent/analytics-gate.test.ts` | 74:12 | 569-569 | TS18048 | 'categories.necessary' is possibly 'undefined'. |
| D0469 | tests | `src/lib/consent/analytics-gate.test.ts` | 75:12 | 570-570 | TS18048 | 'categories.necessary' is possibly 'undefined'. |
| D0470 | tests | `src/lib/consent/analytics-gate.test.ts` | 79:23 | 571-571 | TS18048 | 'categories.analytics' is possibly 'undefined'. |
| D0471 | tests | `src/lib/consent/analytics-gate.test.ts` | 108:12 | 572-572 | TS18048 | 'categories.marketing' is possibly 'undefined'. |
| D0472 | tests | `src/lib/consent/analytics-gate.test.ts` | 109:12 | 573-573 | TS18048 | 'categories.marketing' is possibly 'undefined'. |
| D0473 | tests | `src/lib/consent/analytics-gate.test.ts` | 113:12 | 574-574 | TS18048 | 'categories.analytics' is possibly 'undefined'. |
| D0474 | tests | `src/lib/consent/analytics-gate.test.ts` | 114:12 | 575-575 | TS18048 | 'categories.marketing' is possibly 'undefined'. |
| D0475 | tests | `src/lib/consent/analytics-gate.test.ts` | 118:23 | 576-576 | TS18048 | 'categories.marketing' is possibly 'undefined'. |
| D0476 | tests | `src/lib/csv.test.ts` | 109:12 | 577-577 | TS2532 | Object is possibly 'undefined'. |
| D0477 | tests | `src/lib/data/admin/access-log-view.test.ts` | 73:12 | 578-578 | TS18048 | 'e' is possibly 'undefined'. |
| D0478 | tests | `src/lib/data/admin/access-log-view.test.ts` | 74:12 | 579-579 | TS18048 | 'e' is possibly 'undefined'. |
| D0479 | tests | `src/lib/data/admin/access-log-view.test.ts` | 75:12 | 580-580 | TS18048 | 'e' is possibly 'undefined'. |
| D0480 | tests | `src/lib/data/admin/activity.test.ts` | 246:20 | 581-581 | TS2532 | Object is possibly 'undefined'. |
| D0481 | tests | `src/lib/data/admin/activity.test.ts` | 264:20 | 582-582 | TS2532 | Object is possibly 'undefined'. |
| D0482 | backend | `src/lib/data/admin/activity.ts` | 114:42 | 583-584 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0483 | tests | `src/lib/data/admin/call-dnc.test.ts` | 57:21 | 585-585 | TS2532 | Object is possibly 'undefined'. |
| D0484 | tests | `src/lib/data/admin/callbacks.test.ts` | 290:12 | 586-586 | TS2532 | Object is possibly 'undefined'. |
| D0485 | tests | `src/lib/data/admin/callbacks.test.ts` | 335:12 | 587-587 | TS2532 | Object is possibly 'undefined'. |
| D0486 | tests | `src/lib/data/admin/channels.test.ts` | 78:21 | 588-588 | TS2532 | Object is possibly 'undefined'. |
| D0487 | tests | `src/lib/data/admin/cookie-consent.test.ts` | 103:21 | 589-589 | TS2532 | Object is possibly 'undefined'. |
| D0488 | tests | `src/lib/data/admin/cookie-consent.test.ts` | 123:21 | 590-590 | TS2532 | Object is possibly 'undefined'. |
| D0489 | tests | `src/lib/data/admin/cookie-consent.test.ts` | 141:21 | 591-591 | TS2532 | Object is possibly 'undefined'. |
| D0490 | tests | `src/lib/data/admin/cookie-consent.test.ts` | 152:21 | 592-592 | TS2532 | Object is possibly 'undefined'. |
| D0491 | tests | `src/lib/data/admin/cookie-consent.test.ts` | 195:21 | 593-593 | TS2532 | Object is possibly 'undefined'. |
| D0492 | tests | `src/lib/data/admin/coupon-assignments.test.ts` | 323:23 | 594-594 | TS18048 | 'calls.payment_operations' is possibly 'undefined'. |
| D0493 | tests | `src/lib/data/admin/coupon-assignments.test.ts` | 324:12 | 595-595 | TS18048 | 'guardCall' is possibly 'undefined'. |
| D0494 | tests | `src/lib/data/admin/coupon-assignments.test.ts` | 325:12 | 596-596 | TS18048 | 'guardCall' is possibly 'undefined'. |
| D0495 | tests | `src/lib/data/admin/events.test.ts` | 105:37 | 597-598 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0496 | tests | `src/lib/data/admin/faq.test.ts` | 37:38 | 599-600 | TS2345 | Argument of type 'Result &#124; undefined' is not assignable to parameter of type 'QueryResult&lt;unknown&gt;'.<br>  Type 'undefined' is not assignable to type 'QueryResult&lt;unknown&gt;'. |
| D0497 | tests | `src/lib/data/admin/faq.test.ts` | 42:24 | 601-602 | TS2345 | Argument of type 'Result &#124; undefined' is not assignable to parameter of type 'Result'.<br>  Type 'undefined' is not assignable to type 'QueryResult&lt;unknown&gt;'. |
| D0498 | tests | `src/lib/data/admin/faq.test.ts` | 188:25 | 603-603 | TS2532 | Object is possibly 'undefined'. |
| D0499 | tests | `src/lib/data/admin/fleet.test.ts` | 215:23 | 604-604 | TS2532 | Object is possibly 'undefined'. |
| D0500 | tests | `src/lib/data/admin/fleet.test.ts` | 216:12 | 605-605 | TS18048 | 'handoffIn' is possibly 'undefined'. |
| D0501 | tests | `src/lib/data/admin/fleet.test.ts` | 217:12 | 606-606 | TS18048 | 'handoffIn' is possibly 'undefined'. |
| D0502 | tests | `src/lib/data/admin/fleet.test.ts` | 235:12 | 607-607 | TS2532 | Object is possibly 'undefined'. |
| D0503 | tests | `src/lib/data/admin/fleet.test.ts` | 263:35 | 608-608 | TS2532 | Object is possibly 'undefined'. |
| D0504 | tests | `src/lib/data/admin/fleet.test.ts` | 288:12 | 609-609 | TS2532 | Object is possibly 'undefined'. |
| D0505 | tests | `src/lib/data/admin/integrations/cardcom-config.test.ts` | 121:12 | 610-610 | TS2532 | Object is possibly 'undefined'. |
| D0506 | tests | `src/lib/data/admin/integrations/cardcom-config.test.ts` | 122:12 | 611-611 | TS2532 | Object is possibly 'undefined'. |
| D0507 | tests | `src/lib/data/admin/integrations/cardcom-config.test.ts` | 127:12 | 612-612 | TS2532 | Object is possibly 'undefined'. |
| D0508 | tests | `src/lib/data/admin/integrations/cardcom-config.test.ts` | 128:12 | 613-613 | TS2532 | Object is possibly 'undefined'. |
| D0509 | tests | `src/lib/data/admin/integrations/cardcom-config.test.ts` | 140:12 | 614-614 | TS2532 | Object is possibly 'undefined'. |
| D0510 | tests | `src/lib/data/admin/integrations/cardcom-config.test.ts` | 178:12 | 615-615 | TS2532 | Object is possibly 'undefined'. |
| D0511 | tests | `src/lib/data/admin/integrations/cardcom-config.test.ts` | 179:12 | 616-616 | TS2532 | Object is possibly 'undefined'. |
| D0512 | tests | `src/lib/data/admin/integrations/index.test.ts` | 123:12 | 617-617 | TS18048 | 'cards.voximplant' is possibly 'undefined'. |
| D0513 | tests | `src/lib/data/admin/integrations/index.test.ts` | 124:12 | 618-618 | TS18048 | 'cards.elevenlabs' is possibly 'undefined'. |
| D0514 | tests | `src/lib/data/admin/integrations/index.test.ts` | 125:12 | 619-619 | TS2532 | Object is possibly 'undefined'. |
| D0515 | tests | `src/lib/data/admin/integrations/index.test.ts` | 126:12 | 620-620 | TS18048 | 'cards.slack' is possibly 'undefined'. |
| D0516 | tests | `src/lib/data/admin/integrations/index.test.ts` | 132:12 | 621-621 | TS2532 | Object is possibly 'undefined'. |
| D0517 | tests | `src/lib/data/admin/integrations/index.test.ts` | 133:12 | 622-622 | TS18048 | 'cards.slack' is possibly 'undefined'. |
| D0518 | tests | `src/lib/data/admin/integrations/index.test.ts` | 134:12 | 623-623 | TS2532 | Object is possibly 'undefined'. |
| D0519 | tests | `src/lib/data/admin/integrations/index.test.ts` | 135:12 | 624-624 | TS18048 | 'cards.voximplant' is possibly 'undefined'. |
| D0520 | tests | `src/lib/data/admin/integrations/index.test.ts` | 160:12 | 625-625 | TS2532 | Object is possibly 'undefined'. |
| D0521 | tests | `src/lib/data/admin/integrations/index.test.ts` | 168:12 | 626-626 | TS18048 | 'cards.voximplant' is possibly 'undefined'. |
| D0522 | tests | `src/lib/data/admin/integrations/index.test.ts` | 214:12 | 627-627 | TS18048 | 'cards.voximplant' is possibly 'undefined'. |
| D0523 | tests | `src/lib/data/admin/integrations/index.test.ts` | 215:12 | 628-628 | TS18048 | 'cards.slack' is possibly 'undefined'. |
| D0524 | tests | `src/lib/data/admin/integrations/index.test.ts` | 221:12 | 629-629 | TS18048 | 'cards.voximplant' is possibly 'undefined'. |
| D0525 | tests | `src/lib/data/admin/integrations/index.test.ts` | 248:12 | 630-630 | TS2532 | Object is possibly 'undefined'. |
| D0526 | tests | `src/lib/data/admin/integrations/index.test.ts` | 264:12 | 631-631 | TS2532 | Object is possibly 'undefined'. |
| D0527 | tests | `src/lib/data/admin/integrations/index.test.ts` | 286:7 | 632-633 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0528 | tests | `src/lib/data/admin/integrations/index.test.ts` | 338:12 | 634-634 | TS2532 | Object is possibly 'undefined'. |
| D0529 | tests | `src/lib/data/admin/integrations/meta-status.test.ts` | 62:7 | 635-636 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0530 | tests | `src/lib/data/admin/integrations/meta-status.test.ts` | 82:12 | 637-637 | TS2532 | Object is possibly 'undefined'. |
| D0531 | tests | `src/lib/data/admin/integrations/meta-status.test.ts` | 88:12 | 638-638 | TS2532 | Object is possibly 'undefined'. |
| D0532 | tests | `src/lib/data/admin/integrations/meta-status.test.ts` | 171:12 | 639-639 | TS2532 | Object is possibly 'undefined'. |
| D0533 | tests | `src/lib/data/admin/integrations/number-registration.test.ts` | 170:12 | 640-640 | TS18048 | 'read' is possibly 'undefined'. |
| D0534 | tests | `src/lib/data/admin/integrations/number-registration.test.ts` | 171:35 | 641-641 | TS18048 | 'read' is possibly 'undefined'. |
| D0535 | tests | `src/lib/data/admin/integrations/oauth-provider-config.test.ts` | 177:20 | 642-642 | TS2532 | Object is possibly 'undefined'. |
| D0536 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 75:12 | 643-643 | TS2532 | Object is possibly 'undefined'. |
| D0537 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 76:12 | 644-644 | TS2532 | Object is possibly 'undefined'. |
| D0538 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 77:12 | 645-645 | TS2532 | Object is possibly 'undefined'. |
| D0539 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 86:12 | 646-646 | TS2532 | Object is possibly 'undefined'. |
| D0540 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 96:12 | 647-647 | TS2532 | Object is possibly 'undefined'. |
| D0541 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 123:12 | 648-648 | TS2532 | Object is possibly 'undefined'. |
| D0542 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 208:18 | 649-649 | TS2532 | Object is possibly 'undefined'. |
| D0543 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 314:18 | 650-650 | TS2532 | Object is possibly 'undefined'. |
| D0544 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 337:18 | 651-651 | TS2532 | Object is possibly 'undefined'. |
| D0545 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 521:18 | 652-652 | TS2532 | Object is possibly 'undefined'. |
| D0546 | tests | `src/lib/data/admin/integrations/provider-numbers.test.ts` | 534:18 | 653-653 | TS2532 | Object is possibly 'undefined'. |
| D0547 | tests | `src/lib/data/admin/integrations/send-policy.test.ts` | 138:18 | 654-654 | TS2532 | Object is possibly 'undefined'. |
| D0548 | tests | `src/lib/data/admin/integrations/whatsapp-es.test.ts` | 119:60 | 655-656 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0549 | tests | `src/lib/data/admin/integrations/whatsapp-es.test.ts` | 174:35 | 657-657 | TS2532 | Object is possibly 'undefined'. |
| D0550 | tests | `src/lib/data/admin/integrations/whatsapp-es.test.ts` | 176:27 | 658-658 | TS2532 | Object is possibly 'undefined'. |
| D0551 | tests | `src/lib/data/admin/integrations/whatsapp-es.test.ts` | 250:12 | 659-659 | TS18048 | 'row' is possibly 'undefined'. |
| D0552 | backend | `src/lib/data/admin/integrations/whatsapp-es.ts` | 228:7 | 660-661 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0553 | backend | `src/lib/data/admin/integrations/whatsapp-es.ts` | 241:21 | 662-662 | TS2532 | Object is possibly 'undefined'. |
| D0554 | backend | `src/lib/data/admin/integrations/whatsapp-es.ts` | 242:15 | 663-663 | TS2532 | Object is possibly 'undefined'. |
| D0555 | backend | `src/lib/data/admin/integrations/whatsapp-es.ts` | 249:32 | 664-665 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0556 | backend | `src/lib/data/admin/integrations/whatsapp-es.ts` | 265:5 | 666-667 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0557 | tests | `src/lib/data/admin/offers.test.ts` | 119:12 | 668-668 | TS18048 | 'calls.offers' is possibly 'undefined'. |
| D0558 | tests | `src/lib/data/admin/offers.test.ts` | 119:12 | 669-669 | TS2532 | Object is possibly 'undefined'. |
| D0559 | tests | `src/lib/data/admin/offers.test.ts` | 120:12 | 670-670 | TS2532 | Object is possibly 'undefined'. |
| D0560 | tests | `src/lib/data/admin/offers.test.ts` | 153:12 | 671-671 | TS18048 | 'calls.offer_packages' is possibly 'undefined'. |
| D0561 | tests | `src/lib/data/admin/offers.test.ts` | 153:12 | 672-672 | TS2532 | Object is possibly 'undefined'. |
| D0562 | tests | `src/lib/data/admin/offers.test.ts` | 206:12 | 673-673 | TS18048 | 'calls.offers' is possibly 'undefined'. |
| D0563 | tests | `src/lib/data/admin/offers.test.ts` | 206:12 | 674-674 | TS2532 | Object is possibly 'undefined'. |
| D0564 | tests | `src/lib/data/admin/offers.test.ts` | 207:12 | 675-675 | TS18048 | 'calls.offers' is possibly 'undefined'. |
| D0565 | tests | `src/lib/data/admin/offers.test.ts` | 207:12 | 676-676 | TS2532 | Object is possibly 'undefined'. |
| D0566 | tests | `src/lib/data/admin/offers.test.ts` | 231:12 | 677-677 | TS18048 | 'calls.offer_packages' is possibly 'undefined'. |
| D0567 | tests | `src/lib/data/admin/offers.test.ts` | 231:12 | 678-678 | TS2532 | Object is possibly 'undefined'. |
| D0568 | tests | `src/lib/data/admin/offers.test.ts` | 232:12 | 679-679 | TS18048 | 'calls.offer_packages' is possibly 'undefined'. |
| D0569 | tests | `src/lib/data/admin/offers.test.ts` | 232:12 | 680-680 | TS2532 | Object is possibly 'undefined'. |
| D0570 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 175:34 | 681-681 | TS18048 | 'rows' is possibly 'undefined'. |
| D0571 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 180:12 | 682-682 | TS18048 | 'rows' is possibly 'undefined'. |
| D0572 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 190:12 | 683-683 | TS18048 | 'fake.tables.owner_agent_allowlist' is possibly 'undefined'. |
| D0573 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 190:12 | 684-684 | TS2532 | Object is possibly 'undefined'. |
| D0574 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 214:12 | 685-685 | TS18048 | 'fake.tables.owner_agent_allowlist' is possibly 'undefined'. |
| D0575 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 214:12 | 686-686 | TS2532 | Object is possibly 'undefined'. |
| D0576 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 215:12 | 687-687 | TS18048 | 'fake.tables.owner_agent_report_subscription' is possibly 'undefined'. |
| D0577 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 215:12 | 688-688 | TS2532 | Object is possibly 'undefined'. |
| D0578 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 221:12 | 689-689 | TS18048 | 'fake.tables.owner_agent_report_subscription' is possibly 'undefined'. |
| D0579 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 257:35 | 690-690 | TS18048 | 'fake.tables.owner_agent_report_subscription' is possibly 'undefined'. |
| D0580 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 297:12 | 691-691 | TS18048 | 'fake.tables.app_settings' is possibly 'undefined'. |
| D0581 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 297:12 | 692-692 | TS2532 | Object is possibly 'undefined'. |
| D0582 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 306:12 | 693-693 | TS18048 | 'fake.tables.app_settings' is possibly 'undefined'. |
| D0583 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 327:12 | 694-694 | TS18048 | 'fake.tables.app_settings' is possibly 'undefined'. |
| D0584 | tests | `src/lib/data/admin/owner-agent-reports.test.ts` | 338:12 | 695-695 | TS18048 | 'fake.tables.app_settings' is possibly 'undefined'. |
| D0585 | tests | `src/lib/data/admin/owner-agent.test.ts` | 180:12 | 696-696 | TS18048 | 'builders.app_settings' is possibly 'undefined'. |
| D0586 | tests | `src/lib/data/admin/owner-agent.test.ts` | 223:12 | 697-697 | TS18048 | 'builders.provider_numbers' is possibly 'undefined'. |
| D0587 | tests | `src/lib/data/admin/owner-agent.test.ts` | 374:22 | 698-698 | TS18048 | 'builders.owner_agent_audit' is possibly 'undefined'. |
| D0588 | tests | `src/lib/data/admin/owner-agent.test.ts` | 374:22 | 699-699 | TS2532 | Object is possibly 'undefined'. |
| D0589 | tests | `src/lib/data/admin/owner-agent.test.ts` | 380:12 | 700-700 | TS18048 | 'builders.owner_agent_audit' is possibly 'undefined'. |
| D0590 | tests | `src/lib/data/admin/owner-agent.test.ts` | 381:12 | 701-701 | TS18048 | 'builders.owner_agent_audit' is possibly 'undefined'. |
| D0591 | tests | `src/lib/data/admin/owner-agent.test.ts` | 404:12 | 702-702 | TS18048 | 'builders.app_settings' is possibly 'undefined'. |
| D0592 | tests | `src/lib/data/admin/owner-agent.test.ts` | 419:12 | 703-703 | TS18048 | 'builders.provider_numbers' is possibly 'undefined'. |
| D0593 | tests | `src/lib/data/admin/owner-agent.test.ts` | 420:12 | 704-704 | TS18048 | 'builders.provider_numbers' is possibly 'undefined'. |
| D0594 | tests | `src/lib/data/admin/owner-agent.test.ts` | 421:12 | 705-705 | TS18048 | 'builders.app_settings' is possibly 'undefined'. |
| D0595 | tests | `src/lib/data/admin/owner-agent.test.ts` | 433:12 | 706-706 | TS18048 | 'builders.provider_numbers' is possibly 'undefined'. |
| D0596 | tests | `src/lib/data/admin/owner-agent.test.ts` | 434:12 | 707-707 | TS18048 | 'builders.app_settings' is possibly 'undefined'. |
| D0597 | tests | `src/lib/data/admin/owner-agent.test.ts` | 444:12 | 708-708 | TS18048 | 'builders.app_settings' is possibly 'undefined'. |
| D0598 | tests | `src/lib/data/admin/owner-agent.test.ts` | 457:12 | 709-709 | TS18048 | 'builders.app_settings' is possibly 'undefined'. |
| D0599 | tests | `src/lib/data/admin/owner-agent.test.ts` | 476:12 | 710-710 | TS18048 | 'builders.app_settings' is possibly 'undefined'. |
| D0600 | tests | `src/lib/data/admin/owner-agent.test.ts` | 477:12 | 711-711 | TS18048 | 'builders.app_settings' is possibly 'undefined'. |
| D0601 | tests | `src/lib/data/admin/owner-agent.test.ts` | 492:12 | 712-712 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0602 | tests | `src/lib/data/admin/owner-agent.test.ts` | 524:12 | 713-713 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0603 | tests | `src/lib/data/admin/owner-agent.test.ts` | 556:12 | 714-714 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0604 | tests | `src/lib/data/admin/owner-agent.test.ts` | 557:12 | 715-715 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0605 | tests | `src/lib/data/admin/owner-agent.test.ts` | 571:12 | 716-716 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0606 | tests | `src/lib/data/admin/owner-agent.test.ts` | 587:12 | 717-717 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0607 | tests | `src/lib/data/admin/owner-agent.test.ts` | 607:12 | 718-718 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0608 | tests | `src/lib/data/admin/owner-agent.test.ts` | 613:12 | 719-719 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0609 | tests | `src/lib/data/admin/owner-agent.test.ts` | 614:12 | 720-720 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0610 | tests | `src/lib/data/admin/owner-agent.test.ts` | 615:12 | 721-721 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0611 | tests | `src/lib/data/admin/owner-agent.test.ts` | 649:12 | 722-722 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0612 | tests | `src/lib/data/admin/owner-agent.test.ts` | 655:12 | 723-723 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0613 | tests | `src/lib/data/admin/owner-agent.test.ts` | 667:12 | 724-724 | TS18048 | 'builders.owner_agent_allowlist' is possibly 'undefined'. |
| D0614 | backend | `src/lib/data/admin/owner-agent.ts` | 223:26 | 725-726 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0615 | backend | `src/lib/data/admin/owner-agent.ts` | 497:35 | 727-727 | TS2532 | Object is possibly 'undefined'. |
| D0616 | backend | `src/lib/data/admin/owner-agent.ts` | 536:20 | 728-728 | TS2532 | Object is possibly 'undefined'. |
| D0617 | backend | `src/lib/data/admin/owner-agent.ts` | 563:78 | 729-729 | TS2532 | Object is possibly 'undefined'. |
| D0618 | tests | `src/lib/data/admin/packages.test.ts` | 554:19 | 730-730 | TS2532 | Object is possibly 'undefined'. |
| D0619 | tests | `src/lib/data/admin/payment-review.test.ts` | 189:25 | 731-731 | TS2532 | Object is possibly 'undefined'. |
| D0620 | tests | `src/lib/data/admin/payment-review.test.ts` | 204:12 | 732-732 | TS2532 | Object is possibly 'undefined'. |
| D0621 | tests | `src/lib/data/admin/payment-review.test.ts` | 237:14 | 733-733 | TS2532 | Object is possibly 'undefined'. |
| D0622 | tests | `src/lib/data/admin/payment-review.test.ts` | 250:12 | 734-734 | TS2532 | Object is possibly 'undefined'. |
| D0623 | tests | `src/lib/data/admin/payment-review.test.ts` | 263:14 | 735-735 | TS2532 | Object is possibly 'undefined'. |
| D0624 | tests | `src/lib/data/admin/payment-review.test.ts` | 276:12 | 736-736 | TS2532 | Object is possibly 'undefined'. |
| D0625 | tests | `src/lib/data/admin/payment-review.test.ts` | 289:7 | 737-737 | TS2532 | Object is possibly 'undefined'. |
| D0626 | tests | `src/lib/data/admin/payment-review.test.ts` | 376:12 | 738-738 | TS18048 | 'item' is possibly 'undefined'. |
| D0627 | tests | `src/lib/data/admin/payment-review.test.ts` | 401:14 | 739-739 | TS2532 | Object is possibly 'undefined'. |
| D0628 | tests | `src/lib/data/admin/payment-review.test.ts` | 465:14 | 740-740 | TS2532 | Object is possibly 'undefined'. |
| D0629 | tests | `src/lib/data/admin/payment-review.test.ts` | 472:14 | 741-741 | TS2532 | Object is possibly 'undefined'. |
| D0630 | tests | `src/lib/data/admin/payment-review.test.ts` | 473:14 | 742-742 | TS2532 | Object is possibly 'undefined'. |
| D0631 | tests | `src/lib/data/admin/payment-review.test.ts` | 479:14 | 743-743 | TS2532 | Object is possibly 'undefined'. |
| D0632 | tests | `src/lib/data/admin/payment-review.test.ts` | 486:12 | 744-744 | TS2532 | Object is possibly 'undefined'. |
| D0633 | tests | `src/lib/data/admin/platform-roles.test.ts` | 61:24 | 745-746 | TS2345 | Argument of type 'Result &#124; undefined' is not assignable to parameter of type 'Result'.<br>  Type 'undefined' is not assignable to type 'Result'. |
| D0634 | tests | `src/lib/data/admin/platform-roles.test.ts` | 168:12 | 747-747 | TS18048 | 'builders.platform_role_permissions' is possibly 'undefined'. |
| D0635 | tests | `src/lib/data/admin/platform-roles.test.ts` | 197:12 | 748-748 | TS18048 | 'builders.platform_role_permissions' is possibly 'undefined'. |
| D0636 | tests | `src/lib/data/admin/platform-roles.test.ts` | 328:12 | 749-749 | TS18048 | 'builders.console_agents' is possibly 'undefined'. |
| D0637 | tests | `src/lib/data/admin/platform-roles.test.ts` | 347:12 | 750-750 | TS18048 | 'builders.console_agents' is possibly 'undefined'. |
| D0638 | tests | `src/lib/data/admin/platform-roles.test.ts` | 370:12 | 751-751 | TS18048 | 'builders.console_agents' is possibly 'undefined'. |
| D0639 | tests | `src/lib/data/admin/platform-roles.test.ts` | 462:12 | 752-752 | TS18048 | 'builders.console_agents' is possibly 'undefined'. |
| D0640 | tests | `src/lib/data/admin/platform-roles.test.ts` | 539:12 | 753-753 | TS18048 | 'builders.platform_staff' is possibly 'undefined'. |
| D0641 | tests | `src/lib/data/admin/platform-roles.test.ts` | 559:12 | 754-754 | TS18048 | 'builders.platform_staff' is possibly 'undefined'. |
| D0642 | tests | `src/lib/data/admin/platform-roles.test.ts` | 580:12 | 755-755 | TS18048 | 'builders.platform_staff' is possibly 'undefined'. |
| D0643 | tests | `src/lib/data/admin/platform-roles.test.ts` | 611:12 | 756-756 | TS18048 | 'builders.platform_roles' is possibly 'undefined'. |
| D0644 | tests | `src/lib/data/admin/relocation.test.ts` | 222:19 | 757-757 | TS2532 | Object is possibly 'undefined'. |
| D0645 | tests | `src/lib/data/admin/settings.test.ts` | 183:3 | 758-758 | TS2532 | Object is possibly 'undefined'. |
| D0646 | tests | `src/lib/data/admin/sumit-trigger-subscriptions.test.ts` | 131:12 | 759-759 | TS2532 | Object is possibly 'undefined'. |
| D0647 | tests | `src/lib/data/admin/sumit-trigger-subscriptions.test.ts` | 161:12 | 760-760 | TS2532 | Object is possibly 'undefined'. |
| D0648 | tests | `src/lib/data/admin/sumit-trigger-subscriptions.test.ts` | 179:12 | 761-761 | TS2532 | Object is possibly 'undefined'. |
| D0649 | tests | `src/lib/data/admin/sumit-trigger-subscriptions.test.ts` | 198:12 | 762-762 | TS2532 | Object is possibly 'undefined'. |
| D0650 | tests | `src/lib/data/admin/users.test.ts` | 220:12 | 763-763 | TS2532 | Object is possibly 'undefined'. |
| D0651 | tests | `src/lib/data/admin/voice-ops.test.ts` | 130:12 | 764-764 | TS18048 | 'row' is possibly 'undefined'. |
| D0652 | tests | `src/lib/data/admin/voice-ops.test.ts` | 131:12 | 765-765 | TS18048 | 'row' is possibly 'undefined'. |
| D0653 | tests | `src/lib/data/admin/voice-ops.test.ts` | 132:12 | 766-766 | TS18048 | 'row' is possibly 'undefined'. |
| D0654 | tests | `src/lib/data/admin/voice-ops.test.ts` | 136:12 | 767-767 | TS18048 | 'row' is possibly 'undefined'. |
| D0655 | tests | `src/lib/data/admin/voice-ops.test.ts` | 195:12 | 768-768 | TS2532 | Object is possibly 'undefined'. |
| D0656 | tests | `src/lib/data/admin/voximplant-channel.test.ts` | 101:21 | 769-769 | TS2532 | Object is possibly 'undefined'. |
| D0657 | tests | `src/lib/data/admin/voximplant-channel.test.ts` | 130:21 | 770-770 | TS2532 | Object is possibly 'undefined'. |
| D0658 | tests | `src/lib/data/admin/voximplant-channel.test.ts` | 201:12 | 771-771 | TS2532 | Object is possibly 'undefined'. |
| D0659 | tests | `src/lib/data/admin/voximplant-channel.wiring.test.ts` | 67:12 | 772-772 | TS18048 | 'pending' is possibly 'undefined'. |
| D0660 | tests | `src/lib/data/admin/voximplant-channel.wiring.test.ts` | 69:12 | 773-773 | TS18048 | 'pending' is possibly 'undefined'. |
| D0661 | tests | `src/lib/data/admin/voximplant-channel.wiring.test.ts` | 72:12 | 774-774 | TS18048 | 'pending' is possibly 'undefined'. |
| D0662 | tests | `src/lib/data/admin/voximplant-channel.wiring.test.ts` | 77:12 | 775-775 | TS2532 | Object is possibly 'undefined'. |
| D0663 | tests | `src/lib/data/admin/voximplant-channel.wiring.test.ts` | 111:12 | 776-776 | TS2532 | Object is possibly 'undefined'. |
| D0664 | tests | `src/lib/data/admin/voximplant-channel.wiring.test.ts` | 112:12 | 777-777 | TS2532 | Object is possibly 'undefined'. |
| D0665 | tests | `src/lib/data/admin/webhook-inbox.test.ts` | 173:20 | 778-778 | TS2532 | Object is possibly 'undefined'. |
| D0666 | backend | `src/lib/data/admin/whatsapp-templates.ts` | 281:25 | 779-779 | TS2532 | Object is possibly 'undefined'. |
| D0667 | tests | `src/lib/data/agent-benefits.test.ts` | 122:12 | 780-780 | TS18048 | 'calls.coupon_assignments' is possibly 'undefined'. |
| D0668 | tests | `src/lib/data/agent-benefits.test.ts` | 122:12 | 781-781 | TS2532 | Object is possibly 'undefined'. |
| D0669 | tests | `src/lib/data/agent-benefits.test.ts` | 131:12 | 782-782 | TS18048 | 'calls.coupon_assignment_options' is possibly 'undefined'. |
| D0670 | tests | `src/lib/data/agent-benefits.test.ts` | 131:12 | 783-783 | TS2532 | Object is possibly 'undefined'. |
| D0671 | tests | `src/lib/data/agent-benefits.test.ts` | 134:12 | 784-784 | TS18048 | 'calls.coupon_assignment_events' is possibly 'undefined'. |
| D0672 | tests | `src/lib/data/agent-benefits.test.ts` | 134:12 | 785-785 | TS2532 | Object is possibly 'undefined'. |
| D0673 | tests | `src/lib/data/agent-benefits.test.ts` | 137:12 | 786-786 | TS18048 | 'calls.activity_log' is possibly 'undefined'. |
| D0674 | tests | `src/lib/data/agent-benefits.test.ts` | 137:12 | 787-787 | TS2532 | Object is possibly 'undefined'. |
| D0675 | tests | `src/lib/data/agent-benefits.test.ts` | 152:12 | 788-788 | TS18048 | 'calls.activity_log' is possibly 'undefined'. |
| D0676 | tests | `src/lib/data/agent-benefits.test.ts` | 152:12 | 789-789 | TS2532 | Object is possibly 'undefined'. |
| D0677 | tests | `src/lib/data/agent-benefits.test.ts` | 197:12 | 790-790 | TS18048 | 'calls.coupon_assignments' is possibly 'undefined'. |
| D0678 | tests | `src/lib/data/agent-benefits.test.ts` | 197:12 | 791-791 | TS2532 | Object is possibly 'undefined'. |
| D0679 | tests | `src/lib/data/agent-benefits.test.ts` | 221:12 | 792-792 | TS18048 | 'calls.coupon_assignments' is possibly 'undefined'. |
| D0680 | tests | `src/lib/data/agent-benefits.test.ts` | 221:12 | 793-793 | TS2532 | Object is possibly 'undefined'. |
| D0681 | tests | `src/lib/data/agent-benefits.test.ts` | 222:12 | 794-794 | TS18048 | 'calls.coupon_assignment_events' is possibly 'undefined'. |
| D0682 | tests | `src/lib/data/agent-benefits.test.ts` | 222:12 | 795-795 | TS2532 | Object is possibly 'undefined'. |
| D0683 | tests | `src/lib/data/agent-benefits.test.ts` | 244:12 | 796-796 | TS18048 | 'calls.activity_log' is possibly 'undefined'. |
| D0684 | tests | `src/lib/data/agent-benefits.test.ts` | 244:12 | 797-797 | TS2532 | Object is possibly 'undefined'. |
| D0685 | tests | `src/lib/data/agent-benefits.test.ts` | 282:12 | 798-798 | TS18048 | 'calls.activity_log' is possibly 'undefined'. |
| D0686 | tests | `src/lib/data/agent-benefits.test.ts` | 282:12 | 799-799 | TS2532 | Object is possibly 'undefined'. |
| D0687 | tests | `src/lib/data/agent-benefits.test.ts` | 371:24 | 800-800 | TS18048 | 'calls.coupon_assignments' is possibly 'undefined'. |
| D0688 | tests | `src/lib/data/agreement-archive.test.ts` | 149:19 | 801-801 | TS18048 | 'fields.ArchiveNotes' is possibly 'undefined'. |
| D0689 | tests | `src/lib/data/agreements.test.ts` | 108:11 | 802-802 | TS2488 | Type '[input: AgreementPdfInput] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D0690 | tests | `src/lib/data/agreements.test.ts` | 126:12 | 803-803 | TS2532 | Object is possibly 'undefined'. |
| D0691 | tests | `src/lib/data/call-callbacks.test.ts` | 132:12 | 804-804 | TS2532 | Object is possibly 'undefined'. |
| D0692 | tests | `src/lib/data/call-dispatch-status.test.ts` | 190:12 | 805-805 | TS2532 | Object is possibly 'undefined'. |
| D0693 | tests | `src/lib/data/call-dispatch-status.test.ts` | 191:12 | 806-806 | TS2532 | Object is possibly 'undefined'. |
| D0694 | tests | `src/lib/data/call-dispatch-status.test.ts` | 230:12 | 807-807 | TS2532 | Object is possibly 'undefined'. |
| D0695 | tests | `src/lib/data/call-dispatch-status.test.ts` | 249:12 | 808-808 | TS2532 | Object is possibly 'undefined'. |
| D0696 | tests | `src/lib/data/call-dispatch-status.test.ts` | 261:12 | 809-809 | TS2532 | Object is possibly 'undefined'. |
| D0697 | tests | `src/lib/data/call-dispatch-status.test.ts` | 262:33 | 810-810 | TS2532 | Object is possibly 'undefined'. |
| D0698 | tests | `src/lib/data/call-dispatch-status.test.ts` | 298:5 | 811-813 | TS2322 | Type '(string &#124; undefined)[]' is not assignable to type 'string[]'.<br>  Type 'string &#124; undefined' is not assignable to type 'string'.<br>    Type 'undefined' is not assignable to type 'string'. |
| D0699 | tests | `src/lib/data/call-dispatch-status.test.ts` | 298:16 | 814-814 | TS2532 | Object is possibly 'undefined'. |
| D0700 | tests | `src/lib/data/callback-scheduling.test.ts` | 192:11 | 815-815 | TS2488 | Type '[cfg: ExchangeConnectionConfig, appointmentId: string, update: AppointmentUpdate] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D0701 | tests | `src/lib/data/callback-scheduling.test.ts` | 458:12 | 816-816 | TS2532 | Object is possibly 'undefined'. |
| D0702 | backend | `src/lib/data/callback-scheduling.ts` | 116:11 | 817-817 | TS18048 | 'row' is possibly 'undefined'. |
| D0703 | backend | `src/lib/data/callback-scheduling.ts` | 118:23 | 818-818 | TS18048 | 'row' is possibly 'undefined'. |
| D0704 | backend | `src/lib/data/callback-scheduling.ts` | 123:21 | 819-819 | TS18048 | 'row' is possibly 'undefined'. |
| D0705 | tests | `src/lib/data/campaign-status.test.ts` | 124:38 | 820-821 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0706 | tests | `src/lib/data/campaigns.test.ts` | 335:12 | 822-822 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0707 | tests | `src/lib/data/campaigns.test.ts` | 336:12 | 823-823 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0708 | tests | `src/lib/data/campaigns.test.ts` | 339:12 | 824-824 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0709 | tests | `src/lib/data/campaigns.test.ts` | 455:12 | 825-825 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0710 | tests | `src/lib/data/campaigns.test.ts` | 458:12 | 826-826 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0711 | tests | `src/lib/data/campaigns.test.ts` | 469:12 | 827-827 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0712 | tests | `src/lib/data/campaigns.test.ts` | 746:12 | 828-828 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0713 | tests | `src/lib/data/campaigns.test.ts` | 747:12 | 829-829 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0714 | tests | `src/lib/data/campaigns.test.ts` | 751:12 | 830-830 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0715 | tests | `src/lib/data/campaigns.test.ts` | 763:12 | 831-831 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0716 | tests | `src/lib/data/campaigns.test.ts` | 773:12 | 832-832 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0717 | tests | `src/lib/data/campaigns.test.ts` | 785:12 | 833-833 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0718 | tests | `src/lib/data/campaigns.test.ts` | 808:12 | 834-834 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0719 | tests | `src/lib/data/campaigns.test.ts` | 809:12 | 835-835 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0720 | tests | `src/lib/data/campaigns.test.ts` | 829:12 | 836-836 | TS18048 | 'builders.payment_operations' is possibly 'undefined'. |
| D0721 | tests | `src/lib/data/campaigns.test.ts` | 830:12 | 837-837 | TS18048 | 'builders.payment_operations' is possibly 'undefined'. |
| D0722 | tests | `src/lib/data/campaigns.test.ts` | 831:12 | 838-838 | TS18048 | 'builders.payment_operations' is possibly 'undefined'. |
| D0723 | tests | `src/lib/data/campaigns.test.ts` | 832:12 | 839-839 | TS18048 | 'builders.payment_operations' is possibly 'undefined'. |
| D0724 | tests | `src/lib/data/campaigns.test.ts` | 834:12 | 840-840 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0725 | tests | `src/lib/data/campaigns.test.ts` | 835:12 | 841-841 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0726 | tests | `src/lib/data/campaigns.test.ts` | 862:12 | 842-842 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0727 | tests | `src/lib/data/campaigns.test.ts` | 872:12 | 843-843 | TS18048 | 'past.campaigns' is possibly 'undefined'. |
| D0728 | tests | `src/lib/data/campaigns.test.ts` | 880:12 | 844-844 | TS18048 | 'draft.campaigns' is possibly 'undefined'. |
| D0729 | tests | `src/lib/data/campaigns.test.ts` | 892:12 | 845-845 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0730 | tests | `src/lib/data/campaigns.test.ts` | 904:12 | 846-846 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0731 | tests | `src/lib/data/campaigns.test.ts` | 922:12 | 847-847 | TS18048 | 'builders.campaigns' is possibly 'undefined'. |
| D0732 | tests | `src/lib/data/campaigns.test.ts` | 1327:12 | 848-848 | TS18048 | 'b.campaigns' is possibly 'undefined'. |
| D0733 | tests | `src/lib/data/campaigns.test.ts` | 1328:12 | 849-849 | TS18048 | 'b.campaigns' is possibly 'undefined'. |
| D0734 | tests | `src/lib/data/campaigns.test.ts` | 1335:18 | 850-850 | TS18048 | 'b.events' is possibly 'undefined'. |
| D0735 | tests | `src/lib/data/campaigns.test.ts` | 1335:49 | 851-852 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0736 | tests | `src/lib/data/campaigns.test.ts` | 1336:56 | 853-854 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0737 | tests | `src/lib/data/campaigns.test.ts` | 1336:62 | 855-855 | TS18048 | 'b.campaigns' is possibly 'undefined'. |
| D0738 | tests | `src/lib/data/campaigns.test.ts` | 1347:14 | 856-856 | TS18048 | 'b.campaigns' is possibly 'undefined'. |
| D0739 | tests | `src/lib/data/campaigns.test.ts` | 1356:12 | 857-857 | TS18048 | 'b.campaigns' is possibly 'undefined'. |
| D0740 | tests | `src/lib/data/campaigns.test.ts` | 1376:12 | 858-858 | TS18048 | 'b.campaigns' is possibly 'undefined'. |
| D0741 | tests | `src/lib/data/campaigns.test.ts` | 1388:12 | 859-859 | TS18048 | 'b.campaigns' is possibly 'undefined'. |
| D0742 | tests | `src/lib/data/campaigns.test.ts` | 1395:12 | 860-860 | TS18048 | 'b.campaigns' is possibly 'undefined'. |
| D0743 | tests | `src/lib/data/campaigns.test.ts` | 1406:12 | 861-861 | TS18048 | 'b.campaigns' is possibly 'undefined'. |
| D0744 | tests | `src/lib/data/cardcom-document-processing.test.ts` | 53:19 | 862-862 | TS2532 | Object is possibly 'undefined'. |
| D0745 | tests | `src/lib/data/cardcom-document-processing.test.ts` | 75:12 | 863-863 | TS2532 | Object is possibly 'undefined'. |
| D0746 | tests | `src/lib/data/cardcom-document-processing.test.ts` | 81:12 | 864-864 | TS2532 | Object is possibly 'undefined'. |
| D0747 | backend | `src/lib/data/console-agent-provisioning.ts` | 59:3 | 865-866 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0748 | backend | `src/lib/data/console-agent-provisioning.ts` | 59:19 | 867-867 | TS2532 | Object is possibly 'undefined'. |
| D0749 | backend | `src/lib/data/console-agent-provisioning.ts` | 68:15 | 868-868 | TS2532 | Object is possibly 'undefined'. |
| D0750 | backend | `src/lib/data/console-agent-provisioning.ts` | 69:6 | 869-870 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0751 | backend | `src/lib/data/console-agent-provisioning.ts` | 69:16 | 871-872 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0752 | tests | `src/lib/data/console-calls.test.ts` | 604:12 | 873-873 | TS2532 | Object is possibly 'undefined'. |
| D0753 | tests | `src/lib/data/console-calls.test.ts` | 703:14 | 874-874 | TS18048 | 'b.insert.mock.calls.length' is possibly 'undefined'. |
| D0754 | tests | `src/lib/data/console-calls.test.ts` | 718:20 | 875-875 | TS18048 | 'b.gte.mock.calls.length' is possibly 'undefined'. |
| D0755 | tests | `src/lib/data/console-calls.test.ts` | 731:14 | 876-876 | TS18048 | 'b.insert.mock.calls.length' is possibly 'undefined'. |
| D0756 | tests | `src/lib/data/console-calls.test.ts` | 747:14 | 877-877 | TS18048 | 'b.insert.mock.calls.length' is possibly 'undefined'. |
| D0757 | tests | `src/lib/data/console-calls.test.ts` | 1316:19 | 878-878 | TS2532 | Object is possibly 'undefined'. |
| D0758 | backend | `src/lib/data/console-calls.ts` | 167:30 | 879-879 | TS18048 | 'h' is possibly 'undefined'. |
| D0759 | backend | `src/lib/data/console-calls.ts` | 167:39 | 880-880 | TS18048 | 'm' is possibly 'undefined'. |
| D0760 | backend | `src/lib/data/console-calls.ts` | 3403:3 | 881-882 | TS2322 | Type 'IdentifiedCaller &#124; undefined' is not assignable to type 'IdentifiedCaller &#124; null'.<br>  Type 'undefined' is not assignable to type 'IdentifiedCaller &#124; null'. |
| D0761 | backend | `src/lib/data/console-sdk-auth.ts` | 90:33 | 883-884 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0762 | tests | `src/lib/data/contacts.test.ts` | 256:21 | 885-885 | TS2532 | Object is possibly 'undefined'. |
| D0763 | tests | `src/lib/data/contacts.test.ts` | 278:21 | 886-886 | TS2532 | Object is possibly 'undefined'. |
| D0764 | tests | `src/lib/data/coupon-benefits.test.ts` | 85:12 | 887-887 | TS2532 | Object is possibly 'undefined'. |
| D0765 | tests | `src/lib/data/coupon-benefits.test.ts` | 86:12 | 888-888 | TS18048 | 'calls.coupon_assignments' is possibly 'undefined'. |
| D0766 | tests | `src/lib/data/coupon-benefits.test.ts` | 86:12 | 889-889 | TS2532 | Object is possibly 'undefined'. |
| D0767 | tests | `src/lib/data/coupon-benefits.test.ts` | 102:12 | 890-890 | TS2532 | Object is possibly 'undefined'. |
| D0768 | tests | `src/lib/data/coupon-benefits.test.ts` | 103:12 | 891-891 | TS18048 | 'calls.coupon_assignments' is possibly 'undefined'. |
| D0769 | tests | `src/lib/data/coupon-benefits.test.ts` | 103:12 | 892-892 | TS2532 | Object is possibly 'undefined'. |
| D0770 | tests | `src/lib/data/coupon-benefits.test.ts` | 105:12 | 893-893 | TS18048 | 'calls.coupon_assignments' is possibly 'undefined'. |
| D0771 | tests | `src/lib/data/coupon-benefits.test.ts` | 105:12 | 894-894 | TS2532 | Object is possibly 'undefined'. |
| D0772 | tests | `src/lib/data/coupon-benefits.test.ts` | 160:19 | 895-895 | TS18048 | 'calls.coupon_assignments' is possibly 'undefined'. |
| D0773 | tests | `src/lib/data/coupon-benefits.test.ts` | 161:12 | 896-896 | TS18048 | 'claim' is possibly 'undefined'. |
| D0774 | tests | `src/lib/data/coupon-benefits.test.ts` | 164:12 | 897-897 | TS18048 | 'claim' is possibly 'undefined'. |
| D0775 | tests | `src/lib/data/coupon-benefits.test.ts` | 351:12 | 898-898 | TS18048 | 'calls.coupon_assignments' is possibly 'undefined'. |
| D0776 | tests | `src/lib/data/coupon-benefits.test.ts` | 351:12 | 899-899 | TS2532 | Object is possibly 'undefined'. |
| D0777 | tests | `src/lib/data/coupon-benefits.test.ts` | 352:12 | 900-900 | TS18048 | 'calls.coupon_assignments' is possibly 'undefined'. |
| D0778 | tests | `src/lib/data/coupon-benefits.test.ts` | 352:12 | 901-901 | TS2532 | Object is possibly 'undefined'. |
| D0779 | backend | `src/lib/data/coupon-benefits.ts` | 139:21 | 902-902 | TS2532 | Object is possibly 'undefined'. |
| D0780 | tests | `src/lib/data/elevenlabs-analysis-processing.test.ts` | 83:27 | 903-903 | TS2532 | Object is possibly 'undefined'. |
| D0781 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 83:17 | 904-904 | TS2532 | Object is possibly 'undefined'. |
| D0782 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 99:17 | 905-905 | TS2532 | Object is possibly 'undefined'. |
| D0783 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 108:12 | 906-906 | TS2532 | Object is possibly 'undefined'. |
| D0784 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 114:17 | 907-907 | TS2532 | Object is possibly 'undefined'. |
| D0785 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 124:12 | 908-908 | TS2532 | Object is possibly 'undefined'. |
| D0786 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 152:17 | 909-909 | TS2532 | Object is possibly 'undefined'. |
| D0787 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 164:17 | 910-910 | TS2532 | Object is possibly 'undefined'. |
| D0788 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 193:17 | 911-911 | TS2532 | Object is possibly 'undefined'. |
| D0789 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 236:12 | 912-912 | TS2532 | Object is possibly 'undefined'. |
| D0790 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 243:12 | 913-913 | TS2532 | Object is possibly 'undefined'. |
| D0791 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 249:12 | 914-914 | TS2532 | Object is possibly 'undefined'. |
| D0792 | tests | `src/lib/data/elevenlabs-analysis.test.ts` | 256:12 | 915-915 | TS2532 | Object is possibly 'undefined'. |
| D0793 | tests | `src/lib/data/elevenlabs-quota.test.ts` | 168:12 | 916-916 | TS2532 | Object is possibly 'undefined'. |
| D0794 | tests | `src/lib/data/elevenlabs-status.test.ts` | 22:12 | 917-917 | TS2532 | Object is possibly 'undefined'. |
| D0795 | tests | `src/lib/data/elevenlabs-status.test.ts` | 23:19 | 918-918 | TS2532 | Object is possibly 'undefined'. |
| D0796 | tests | `src/lib/data/elevenlabs-status.test.ts` | 62:12 | 919-919 | TS2532 | Object is possibly 'undefined'. |
| D0797 | tests | `src/lib/data/elevenlabs-status.test.ts` | 102:12 | 920-920 | TS2532 | Object is possibly 'undefined'. |
| D0798 | tests | `src/lib/data/elevenlabs-status.test.ts` | 103:12 | 921-921 | TS2532 | Object is possibly 'undefined'. |
| D0799 | tests | `src/lib/data/elevenlabs-status.test.ts` | 105:12 | 922-922 | TS2532 | Object is possibly 'undefined'. |
| D0800 | tests | `src/lib/data/elevenlabs-status.test.ts` | 122:12 | 923-923 | TS2532 | Object is possibly 'undefined'. |
| D0801 | tests | `src/lib/data/event-cancellation.test.ts` | 437:54 | 924-925 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0802 | tests | `src/lib/data/event-cancellation.test.ts` | 438:39 | 926-927 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0803 | tests | `src/lib/data/event-cancellation.test.ts` | 439:56 | 928-929 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0804 | tests | `src/lib/data/event-cancellation.test.ts` | 498:30 | 930-930 | TS2532 | Object is possibly 'undefined'. |
| D0805 | tests | `src/lib/data/event-cancellation.test.ts` | 644:56 | 931-932 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0806 | tests | `src/lib/data/event-date.test.ts` | 387:24 | 933-933 | TS18048 | 'p.year' is possibly 'undefined'. |
| D0807 | tests | `src/lib/data/event-date.test.ts` | 387:33 | 934-934 | TS18048 | 'p.month' is possibly 'undefined'. |
| D0808 | tests | `src/lib/data/event-date.test.ts` | 387:47 | 935-935 | TS18048 | 'p.day' is possibly 'undefined'. |
| D0809 | tests | `src/lib/data/event-date.test.ts` | 387:55 | 936-936 | TS18048 | 'p.hour' is possibly 'undefined'. |
| D0810 | tests | `src/lib/data/event-date.test.ts` | 387:64 | 937-937 | TS18048 | 'p.minute' is possibly 'undefined'. |
| D0811 | tests | `src/lib/data/event-date.test.ts` | 415:33 | 938-938 | TS2532 | Object is possibly 'undefined'. |
| D0812 | backend | `src/lib/data/event-date.ts` | 155:16 | 939-939 | TS18048 | 'year' is possibly 'undefined'. |
| D0813 | backend | `src/lib/data/event-date.ts` | 156:17 | 940-940 | TS18048 | 'month' is possibly 'undefined'. |
| D0814 | backend | `src/lib/data/event-date.ts` | 157:15 | 941-941 | TS18048 | 'day' is possibly 'undefined'. |
| D0815 | backend | `src/lib/data/event-date.ts` | 158:16 | 942-942 | TS18048 | 'hour' is possibly 'undefined'. |
| D0816 | backend | `src/lib/data/event-date.ts` | 159:18 | 943-943 | TS18048 | 'minute' is possibly 'undefined'. |
| D0817 | tests | `src/lib/data/event-exchange-sync.test.ts` | 88:11 | 944-944 | TS2488 | Type '[cfg: ExchangeConnectionConfig, draft: AppointmentDraft] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D0818 | backend | `src/lib/data/event-exchange-sync.ts` | 92:11 | 945-945 | TS18048 | 'row' is possibly 'undefined'. |
| D0819 | backend | `src/lib/data/event-exchange-sync.ts` | 94:23 | 946-946 | TS18048 | 'row' is possibly 'undefined'. |
| D0820 | backend | `src/lib/data/event-exchange-sync.ts` | 96:21 | 947-947 | TS18048 | 'row' is possibly 'undefined'. |
| D0821 | tests | `src/lib/data/event-lifecycle.model.test.ts` | 96:98 | 948-949 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0822 | tests | `src/lib/data/event-lifecycle.test.ts` | 31:38 | 950-951 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0823 | tests | `src/lib/data/event-lifecycle.test.ts` | 173:68 | 952-953 | TS2345 | Argument of type '"unreadable" &#124; OperationRow[] &#124; undefined' is not assignable to parameter of type '"unreadable" &#124; readonly OperationRow[]'.<br>  Type 'undefined' is not assignable to type '"unreadable" &#124; readonly OperationRow[]'. |
| D0824 | tests | `src/lib/data/event-lifecycle.test.ts` | 226:68 | 954-954 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D0825 | tests | `src/lib/data/event-lifecycle.test.ts` | 228:56 | 955-955 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D0826 | tests | `src/lib/data/event-lifecycle.test.ts` | 254:72 | 956-957 | TS2345 | Argument of type 'OperationRow[] &#124; undefined' is not assignable to parameter of type '"unreadable" &#124; readonly OperationRow[]'.<br>  Type 'undefined' is not assignable to type '"unreadable" &#124; readonly OperationRow[]'. |
| D0827 | tests | `src/lib/data/event-lifecycle.test.ts` | 255:72 | 958-959 | TS2345 | Argument of type 'OperationRow[] &#124; undefined' is not assignable to parameter of type '"unreadable" &#124; readonly OperationRow[]'.<br>  Type 'undefined' is not assignable to type '"unreadable" &#124; readonly OperationRow[]'. |
| D0828 | tests | `src/lib/data/event-lifecycle.test.ts` | 259:72 | 960-961 | TS2345 | Argument of type 'OperationRow[] &#124; undefined' is not assignable to parameter of type '"unreadable" &#124; readonly OperationRow[]'.<br>  Type 'undefined' is not assignable to type '"unreadable" &#124; readonly OperationRow[]'. |
| D0829 | tests | `src/lib/data/event-lifecycle.test.ts` | 260:72 | 962-963 | TS2345 | Argument of type 'OperationRow[] &#124; undefined' is not assignable to parameter of type '"unreadable" &#124; readonly OperationRow[]'.<br>  Type 'undefined' is not assignable to type '"unreadable" &#124; readonly OperationRow[]'. |
| D0830 | backend | `src/lib/data/event-lifecycle.ts` | 108:3 | 964-965 | TS2322 | Type '"unavailable" &#124; "setup" &#124; "management" &#124; undefined' is not assignable to type 'EventMode'.<br>  Type 'undefined' is not assignable to type 'EventMode'. |
| D0831 | backend | `src/lib/data/event-lifecycle.ts` | 115:35 | 966-967 | TS2322 | Type 'StateNode&lt;MachineContext, { type: "event.published"; } &#124; { type: "event.close"; }, MetaObject, MetaObject&gt; &#124; undefined' is not assignable to type 'AnyStateNode'.<br>  Type 'undefined' is not assignable to type 'StateNode&lt;any, any, any, any&gt;'. |
| D0832 | backend | `src/lib/data/event-lifecycle.ts` | 115:56 | 968-968 | TS18048 | 'eventLifecycleMachine.root.states.open' is possibly 'undefined'. |
| D0833 | tests | `src/lib/data/event-stats.test.ts` | 152:7 | 969-970 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0834 | tests | `src/lib/data/events.test.ts` | 456:19 | 971-971 | TS2532 | Object is possibly 'undefined'. |
| D0835 | tests | `src/lib/data/events.test.ts` | 474:19 | 972-972 | TS2532 | Object is possibly 'undefined'. |
| D0836 | tests | `src/lib/data/events.test.ts` | 511:19 | 973-973 | TS2532 | Object is possibly 'undefined'. |
| D0837 | tests | `src/lib/data/events.test.ts` | 599:19 | 974-974 | TS2532 | Object is possibly 'undefined'. |
| D0838 | tests | `src/lib/data/events.test.ts` | 624:19 | 975-975 | TS2532 | Object is possibly 'undefined'. |
| D0839 | tests | `src/lib/data/events.test.ts` | 642:19 | 976-976 | TS2532 | Object is possibly 'undefined'. |
| D0840 | tests | `src/lib/data/events.test.ts` | 746:19 | 977-977 | TS2532 | Object is possibly 'undefined'. |
| D0841 | tests | `src/lib/data/events.test.ts` | 793:19 | 978-978 | TS2532 | Object is possibly 'undefined'. |
| D0842 | tests | `src/lib/data/events.test.ts` | 839:19 | 979-979 | TS2532 | Object is possibly 'undefined'. |
| D0843 | tests | `src/lib/data/events.test.ts` | 863:19 | 980-980 | TS2532 | Object is possibly 'undefined'. |
| D0844 | backend | `src/lib/data/exchange-connections.ts` | 381:23 | 981-982 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0845 | backend | `src/lib/data/exchange-connections.ts` | 392:25 | 983-984 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0846 | backend | `src/lib/data/exchange-connections.ts` | 418:25 | 985-986 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0847 | backend | `src/lib/data/exchange-connections.ts` | 436:25 | 987-988 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0848 | backend | `src/lib/data/exchange-connections.ts` | 503:25 | 989-990 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0849 | backend | `src/lib/data/exchange-connections.ts` | 553:25 | 991-992 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0850 | backend | `src/lib/data/exchange-connections.ts` | 602:25 | 993-994 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0851 | backend | `src/lib/data/exchange-connections.ts` | 636:25 | 995-996 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0852 | backend | `src/lib/data/exchange-connections.ts` | 652:25 | 997-998 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0853 | backend | `src/lib/data/exchange-connections.ts` | 727:25 | 999-1000 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0854 | tests | `src/lib/data/guests-seq.integration.test.ts` | 43:77 | 1001-1002 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0855 | tests | `src/lib/data/guests.test.ts` | 241:20 | 1003-1003 | TS2532 | Object is possibly 'undefined'. |
| D0856 | tests | `src/lib/data/guests.test.ts` | 263:20 | 1004-1004 | TS2532 | Object is possibly 'undefined'. |
| D0857 | tests | `src/lib/data/guests.test.ts` | 276:20 | 1005-1005 | TS2532 | Object is possibly 'undefined'. |
| D0858 | tests | `src/lib/data/guests.test.ts` | 288:20 | 1006-1006 | TS2532 | Object is possibly 'undefined'. |
| D0859 | tests | `src/lib/data/guests.test.ts` | 297:20 | 1007-1007 | TS2532 | Object is possibly 'undefined'. |
| D0860 | tests | `src/lib/data/guests.test.ts` | 377:21 | 1008-1008 | TS2532 | Object is possibly 'undefined'. |
| D0861 | tests | `src/lib/data/guests.test.ts` | 442:21 | 1009-1009 | TS2532 | Object is possibly 'undefined'. |
| D0862 | tests | `src/lib/data/guests.test.ts` | 634:18 | 1010-1010 | TS2532 | Object is possibly 'undefined'. |
| D0863 | tests | `src/lib/data/guests.test.ts` | 690:21 | 1011-1011 | TS2532 | Object is possibly 'undefined'. |
| D0864 | tests | `src/lib/data/guests.test.ts` | 709:21 | 1012-1012 | TS2532 | Object is possibly 'undefined'. |
| D0865 | tests | `src/lib/data/guests.test.ts` | 847:12 | 1013-1013 | TS2532 | Object is possibly 'undefined'. |
| D0866 | tests | `src/lib/data/guests.test.ts` | 857:40 | 1014-1014 | TS2532 | Object is possibly 'undefined'. |
| D0867 | tests | `src/lib/data/guests.test.ts` | 871:12 | 1015-1015 | TS2532 | Object is possibly 'undefined'. |
| D0868 | tests | `src/lib/data/guests.test.ts` | 872:12 | 1016-1016 | TS2532 | Object is possibly 'undefined'. |
| D0869 | tests | `src/lib/data/guests.test.ts` | 882:12 | 1017-1017 | TS2532 | Object is possibly 'undefined'. |
| D0870 | tests | `src/lib/data/guests.test.ts` | 883:12 | 1018-1018 | TS2532 | Object is possibly 'undefined'. |
| D0871 | backend | `src/lib/data/guests.ts` | 918:63 | 1019-1019 | TS2532 | Object is possibly 'undefined'. |
| D0872 | backend | `src/lib/data/guests.ts` | 924:74 | 1020-1020 | TS2532 | Object is possibly 'undefined'. |
| D0873 | tests | `src/lib/data/headcount.test.ts` | 35:36 | 1021-1021 | TS18048 | 'calls.update' is possibly 'undefined'. |
| D0874 | tests | `src/lib/data/headcount.test.ts` | 61:17 | 1022-1022 | TS18048 | 'calls.update' is possibly 'undefined'. |
| D0875 | tests | `src/lib/data/headcount.test.ts` | 85:17 | 1023-1023 | TS18048 | 'calls.update' is possibly 'undefined'. |
| D0876 | tests | `src/lib/data/headcount.test.ts` | 135:17 | 1024-1024 | TS18048 | 'calls.update' is possibly 'undefined'. |
| D0877 | backend | `src/lib/data/headcount.ts` | 110:9 | 1025-1025 | TS18048 | 'guest' is possibly 'undefined'. |
| D0878 | backend | `src/lib/data/headcount.ts` | 116:38 | 1026-1026 | TS18048 | 'guest' is possibly 'undefined'. |
| D0879 | backend | `src/lib/data/headcount.ts` | 124:37 | 1027-1027 | TS18048 | 'guest' is possibly 'undefined'. |
| D0880 | backend | `src/lib/data/headcount.ts` | 125:17 | 1028-1028 | TS18048 | 'guest' is possibly 'undefined'. |
| D0881 | backend | `src/lib/data/headcount.ts` | 140:15 | 1029-1029 | TS18048 | 'guest' is possibly 'undefined'. |
| D0882 | tests | `src/lib/data/inquiries.test.ts` | 170:21 | 1030-1030 | TS2532 | Object is possibly 'undefined'. |
| D0883 | tests | `src/lib/data/inquiries.test.ts` | 199:21 | 1031-1031 | TS2532 | Object is possibly 'undefined'. |
| D0884 | tests | `src/lib/data/inquiries.test.ts` | 243:17 | 1032-1032 | TS2532 | Object is possibly 'undefined'. |
| D0885 | tests | `src/lib/data/inquiries.test.ts` | 259:17 | 1033-1033 | TS2532 | Object is possibly 'undefined'. |
| D0886 | tests | `src/lib/data/inquiry-followup.test.ts` | 369:19 | 1034-1034 | TS2532 | Object is possibly 'undefined'. |
| D0887 | tests | `src/lib/data/inquiry-followup.test.ts` | 380:19 | 1035-1035 | TS2532 | Object is possibly 'undefined'. |
| D0888 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 204:12 | 1036-1036 | TS2532 | Object is possibly 'undefined'. |
| D0889 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 205:12 | 1037-1037 | TS2532 | Object is possibly 'undefined'. |
| D0890 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 206:12 | 1038-1038 | TS2532 | Object is possibly 'undefined'. |
| D0891 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 247:28 | 1039-1039 | TS2532 | Object is possibly 'undefined'. |
| D0892 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 262:12 | 1040-1040 | TS2532 | Object is possibly 'undefined'. |
| D0893 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 271:19 | 1041-1041 | TS2532 | Object is possibly 'undefined'. |
| D0894 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 291:12 | 1042-1042 | TS2532 | Object is possibly 'undefined'. |
| D0895 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 292:12 | 1043-1043 | TS2532 | Object is possibly 'undefined'. |
| D0896 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 302:12 | 1044-1044 | TS2532 | Object is possibly 'undefined'. |
| D0897 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 501:14 | 1045-1045 | TS2532 | Object is possibly 'undefined'. |
| D0898 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 524:14 | 1046-1046 | TS2532 | Object is possibly 'undefined'. |
| D0899 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 555:14 | 1047-1047 | TS2532 | Object is possibly 'undefined'. |
| D0900 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 564:21 | 1048-1048 | TS2532 | Object is possibly 'undefined'. |
| D0901 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 592:14 | 1049-1049 | TS2532 | Object is possibly 'undefined'. |
| D0902 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 593:14 | 1050-1050 | TS2532 | Object is possibly 'undefined'. |
| D0903 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 621:19 | 1051-1051 | TS2532 | Object is possibly 'undefined'. |
| D0904 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 622:14 | 1052-1052 | TS2532 | Object is possibly 'undefined'. |
| D0905 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 647:21 | 1053-1053 | TS2532 | Object is possibly 'undefined'. |
| D0906 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 673:14 | 1054-1054 | TS2532 | Object is possibly 'undefined'. |
| D0907 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 674:14 | 1055-1055 | TS2532 | Object is possibly 'undefined'. |
| D0908 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 675:14 | 1056-1056 | TS2532 | Object is possibly 'undefined'. |
| D0909 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 701:14 | 1057-1057 | TS2532 | Object is possibly 'undefined'. |
| D0910 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 752:21 | 1058-1058 | TS2532 | Object is possibly 'undefined'. |
| D0911 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 770:21 | 1059-1059 | TS2532 | Object is possibly 'undefined'. |
| D0912 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 848:14 | 1060-1060 | TS2532 | Object is possibly 'undefined'. |
| D0913 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 853:14 | 1061-1061 | TS2532 | Object is possibly 'undefined'. |
| D0914 | tests | `src/lib/data/inquiry-mail-intake.test.ts` | 882:21 | 1062-1062 | TS2532 | Object is possibly 'undefined'. |
| D0915 | backend | `src/lib/data/inquiry-mail-intake.ts` | 102:18 | 1063-1063 | TS2532 | Object is possibly 'undefined'. |
| D0916 | backend | `src/lib/data/instagram-token-refresh.ts` | 87:43 | 1064-1065 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0917 | backend | `src/lib/data/instagram-token-refresh.ts` | 106:28 | 1066-1067 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0918 | backend | `src/lib/data/instagram-token-refresh.ts` | 107:35 | 1068-1069 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0919 | backend | `src/lib/data/instagram-token-refresh.ts` | 108:24 | 1070-1071 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D0920 | tests | `src/lib/data/marketing-consent.test.ts` | 78:12 | 1072-1072 | TS18048 | 'written' is possibly 'undefined'. |
| D0921 | tests | `src/lib/data/marketing-contact-sync.test.ts` | 139:29 | 1073-1073 | TS2532 | Object is possibly 'undefined'. |
| D0922 | tests | `src/lib/data/meeting-confirm-dispatch.test.ts` | 397:18 | 1074-1074 | TS2532 | Object is possibly 'undefined'. |
| D0923 | tests | `src/lib/data/meeting-confirm-dispatch.test.ts` | 411:18 | 1075-1075 | TS2532 | Object is possibly 'undefined'. |
| D0924 | tests | `src/lib/data/message-templates.test.ts` | 288:21 | 1076-1076 | TS2532 | Object is possibly 'undefined'. |
| D0925 | tests | `src/lib/data/orgs-role-permissions.test.ts` | 54:24 | 1077-1078 | TS2345 | Argument of type 'Result &#124; undefined' is not assignable to parameter of type 'Result'.<br>  Type 'undefined' is not assignable to type 'Result'. |
| D0926 | tests | `src/lib/data/orgs-role-permissions.test.ts` | 190:12 | 1079-1079 | TS18048 | 'builders.organization_role_permissions' is possibly 'undefined'. |
| D0927 | tests | `src/lib/data/orgs-role-permissions.test.ts` | 207:12 | 1080-1080 | TS18048 | 'builders.organization_role_permissions' is possibly 'undefined'. |
| D0928 | tests | `src/lib/data/orgs-role-permissions.test.ts` | 236:12 | 1081-1081 | TS18048 | 'builders.organization_role_permissions' is possibly 'undefined'. |
| D0929 | tests | `src/lib/data/orgs-role-permissions.test.ts` | 237:12 | 1082-1082 | TS18048 | 'builders.organization_role_permissions' is possibly 'undefined'. |
| D0930 | tests | `src/lib/data/orgs-role-permissions.test.ts` | 309:12 | 1083-1083 | TS18048 | 'builders.organization_role_permissions' is possibly 'undefined'. |
| D0931 | tests | `src/lib/data/orgs-role-permissions.test.ts` | 362:12 | 1084-1084 | TS18048 | 'builders.organization_role_permissions' is possibly 'undefined'. |
| D0932 | tests | `src/lib/data/orgs-role-permissions.test.ts` | 363:12 | 1085-1085 | TS18048 | 'builders.organization_role_permissions' is possibly 'undefined'. |
| D0933 | tests | `src/lib/data/orgs-role-permissions.test.ts` | 365:12 | 1086-1086 | TS18048 | 'builders.organization_role_permissions' is possibly 'undefined'. |
| D0934 | backend | `src/lib/data/outreach-calls.ts` | 297:41 | 1087-1087 | TS2532 | Object is possibly 'undefined'. |
| D0935 | tests | `src/lib/data/outreach-engine.test.ts` | 220:19 | 1088-1088 | TS2532 | Object is possibly 'undefined'. |
| D0936 | tests | `src/lib/data/outreach-engine.test.ts` | 241:19 | 1089-1089 | TS2532 | Object is possibly 'undefined'. |
| D0937 | tests | `src/lib/data/outreach-engine.test.ts` | 606:24 | 1090-1090 | TS2532 | Object is possibly 'undefined'. |
| D0938 | backend | `src/lib/data/outreach-engine.ts` | 805:48 | 1091-1092 | TS2345 | Argument of type 'Touchpoint &#124; undefined' is not assignable to parameter of type 'Touchpoint'.<br>  Type 'undefined' is not assignable to type 'Touchpoint'. |
| D0939 | backend | `src/lib/data/outreach-engine.ts` | 822:53 | 1093-1093 | TS18048 | 'tp' is possibly 'undefined'. |
| D0940 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 127:12 | 1094-1094 | TS18048 | 'j' is possibly 'undefined'. |
| D0941 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 129:51 | 1095-1095 | TS18048 | 'j' is possibly 'undefined'. |
| D0942 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 130:12 | 1096-1096 | TS18048 | 'j' is possibly 'undefined'. |
| D0943 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 130:46 | 1097-1097 | TS18048 | 'j' is possibly 'undefined'. |
| D0944 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 148:12 | 1098-1098 | TS2532 | Object is possibly 'undefined'. |
| D0945 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 148:38 | 1099-1099 | TS18048 | 'oldJob' is possibly 'undefined'. |
| D0946 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 149:12 | 1100-1100 | TS2532 | Object is possibly 'undefined'. |
| D0947 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 150:12 | 1101-1101 | TS18048 | 'oldJob' is possibly 'undefined'. |
| D0948 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 168:12 | 1102-1102 | TS2532 | Object is possibly 'undefined'. |
| D0949 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 169:18 | 1103-1103 | TS2532 | Object is possibly 'undefined'. |
| D0950 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 170:18 | 1104-1104 | TS2532 | Object is possibly 'undefined'. |
| D0951 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 216:12 | 1105-1105 | TS2532 | Object is possibly 'undefined'. |
| D0952 | tests | `src/lib/data/outreach-schedule.local-it.test.ts` | 226:12 | 1106-1106 | TS2532 | Object is possibly 'undefined'. |
| D0953 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 93:19 | 1107-1107 | TS2532 | Object is possibly 'undefined'. |
| D0954 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 113:14 | 1108-1108 | TS18048 | 'a' is possibly 'undefined'. |
| D0955 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 114:23 | 1109-1109 | TS18048 | 'a' is possibly 'undefined'. |
| D0956 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 120:23 | 1110-1110 | TS18048 | 'a' is possibly 'undefined'. |
| D0957 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 125:23 | 1111-1111 | TS18048 | 'a' is possibly 'undefined'. |
| D0958 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 146:14 | 1112-1112 | TS18048 | 'a' is possibly 'undefined'. |
| D0959 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 147:14 | 1113-1113 | TS18048 | 'a' is possibly 'undefined'. |
| D0960 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 164:14 | 1114-1114 | TS18048 | 'a' is possibly 'undefined'. |
| D0961 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 165:14 | 1115-1115 | TS18048 | 'a' is possibly 'undefined'. |
| D0962 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 166:14 | 1116-1116 | TS18048 | 'a' is possibly 'undefined'. |
| D0963 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 167:14 | 1117-1117 | TS18048 | 'a' is possibly 'undefined'. |
| D0964 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 168:14 | 1118-1118 | TS18048 | 'a' is possibly 'undefined'. |
| D0965 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 188:14 | 1119-1119 | TS18048 | 'a' is possibly 'undefined'. |
| D0966 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 193:14 | 1120-1120 | TS2532 | Object is possibly 'undefined'. |
| D0967 | tests | `src/lib/data/outreach-serial-flow.integration.test.ts` | 206:23 | 1121-1121 | TS18048 | 'a' is possibly 'undefined'. |
| D0968 | tests | `src/lib/data/outreach.test.ts` | 328:20 | 1122-1122 | TS2532 | Object is possibly 'undefined'. |
| D0969 | tests | `src/lib/data/outreach.test.ts` | 364:12 | 1123-1123 | TS2532 | Object is possibly 'undefined'. |
| D0970 | tests | `src/lib/data/outreach.test.ts` | 501:12 | 1124-1124 | TS2532 | Object is possibly 'undefined'. |
| D0971 | tests | `src/lib/data/outreach.test.ts` | 536:37 | 1125-1126 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D0972 | tests | `src/lib/data/outreach.test.ts` | 564:12 | 1127-1127 | TS2532 | Object is possibly 'undefined'. |
| D0973 | tests | `src/lib/data/outreach.worker-cookies.test.ts` | 199:12 | 1128-1128 | TS2532 | Object is possibly 'undefined'. |
| D0974 | tests | `src/lib/data/payment-orphans.local-it.test.ts` | 159:12 | 1129-1129 | TS2532 | Object is possibly 'undefined'. |
| D0975 | tests | `src/lib/data/payment-orphans.local-it.test.ts` | 168:12 | 1130-1130 | TS2532 | Object is possibly 'undefined'. |
| D0976 | tests | `src/lib/data/payment-orphans.local-it.test.ts` | 174:12 | 1131-1131 | TS2532 | Object is possibly 'undefined'. |
| D0977 | tests | `src/lib/data/payment-orphans.local-it.test.ts` | 176:12 | 1132-1132 | TS2532 | Object is possibly 'undefined'. |
| D0978 | tests | `src/lib/data/payment-orphans.test.ts` | 68:19 | 1133-1133 | TS2532 | Object is possibly 'undefined'. |
| D0979 | tests | `src/lib/data/payment-orphans.test.ts` | 78:19 | 1134-1134 | TS2532 | Object is possibly 'undefined'. |
| D0980 | tests | `src/lib/data/payment-orphans.test.ts` | 90:12 | 1135-1135 | TS2532 | Object is possibly 'undefined'. |
| D0981 | tests | `src/lib/data/payment-orphans.test.ts` | 116:12 | 1136-1136 | TS2532 | Object is possibly 'undefined'. |
| D0982 | tests | `src/lib/data/payment-orphans.test.ts` | 139:12 | 1137-1137 | TS2532 | Object is possibly 'undefined'. |
| D0983 | tests | `src/lib/data/payment-orphans.test.ts` | 160:12 | 1138-1138 | TS2532 | Object is possibly 'undefined'. |
| D0984 | tests | `src/lib/data/payment-orphans.test.ts` | 191:12 | 1139-1139 | TS2532 | Object is possibly 'undefined'. |
| D0985 | tests | `src/lib/data/payment-orphans.test.ts` | 201:12 | 1140-1140 | TS2532 | Object is possibly 'undefined'. |
| D0986 | tests | `src/lib/data/payment-orphans.test.ts` | 208:12 | 1141-1141 | TS2532 | Object is possibly 'undefined'. |
| D0987 | tests | `src/lib/data/reconcile.integration.test.ts` | 85:19 | 1142-1142 | TS2532 | Object is possibly 'undefined'. |
| D0988 | tests | `src/lib/data/reconcile.integration.test.ts` | 114:26 | 1143-1143 | TS2532 | Object is possibly 'undefined'. |
| D0989 | tests | `src/lib/data/reconcile.integration.test.ts` | 212:30 | 1144-1144 | TS2532 | Object is possibly 'undefined'. |
| D0990 | tests | `src/lib/data/reconcile.integration.test.ts` | 239:21 | 1145-1145 | TS2532 | Object is possibly 'undefined'. |
| D0991 | tests | `src/lib/data/reconcile.integration.test.ts` | 325:21 | 1146-1146 | TS2532 | Object is possibly 'undefined'. |
| D0992 | tests | `src/lib/data/schedule-options.test.ts` | 48:12 | 1147-1147 | TS2532 | Object is possibly 'undefined'. |
| D0993 | tests | `src/lib/data/signup-confirmation-reminder.test.ts` | 140:19 | 1148-1148 | TS2532 | Object is possibly 'undefined'. |
| D0994 | tests | `src/lib/data/sumit-customers.test.ts` | 58:12 | 1149-1149 | TS2532 | Object is possibly 'undefined'. |
| D0995 | tests | `src/lib/data/tax-ceiling.test.ts` | 50:19 | 1150-1150 | TS2532 | Object is possibly 'undefined'. |
| D0996 | tests | `src/lib/data/tax-ceiling.test.ts` | 62:12 | 1151-1151 | TS2532 | Object is possibly 'undefined'. |
| D0997 | tests | `src/lib/data/tax-ceiling.test.ts` | 68:12 | 1152-1152 | TS2532 | Object is possibly 'undefined'. |
| D0998 | backend | `src/lib/data/tax-ceiling.ts` | 35:26 | 1153-1153 | TS2532 | Object is possibly 'undefined'. |
| D0999 | tests | `src/lib/data/template-health-processing.test.ts` | 87:12 | 1154-1154 | TS2532 | Object is possibly 'undefined'. |
| D1000 | tests | `src/lib/data/template-health-processing.test.ts` | 92:12 | 1155-1155 | TS2532 | Object is possibly 'undefined'. |
| D1001 | tests | `src/lib/data/template-health-processing.test.ts` | 104:12 | 1156-1156 | TS2532 | Object is possibly 'undefined'. |
| D1002 | tests | `src/lib/data/template-health-processing.test.ts` | 152:12 | 1157-1157 | TS2532 | Object is possibly 'undefined'. |
| D1003 | tests | `src/lib/data/template-health-processing.test.ts` | 153:12 | 1158-1158 | TS2532 | Object is possibly 'undefined'. |
| D1004 | tests | `src/lib/data/template-health-processing.test.ts` | 154:12 | 1159-1159 | TS2532 | Object is possibly 'undefined'. |
| D1005 | tests | `src/lib/data/template-health-processing.test.ts` | 166:12 | 1160-1160 | TS2532 | Object is possibly 'undefined'. |
| D1006 | tests | `src/lib/data/template-health-processing.test.ts` | 171:12 | 1161-1161 | TS2532 | Object is possibly 'undefined'. |
| D1007 | tests | `src/lib/data/template-health-processing.test.ts` | 199:12 | 1162-1162 | TS2532 | Object is possibly 'undefined'. |
| D1008 | tests | `src/lib/data/template-health-processing.test.ts` | 200:12 | 1163-1163 | TS2532 | Object is possibly 'undefined'. |
| D1009 | tests | `src/lib/data/template-health-processing.test.ts` | 215:12 | 1164-1164 | TS2532 | Object is possibly 'undefined'. |
| D1010 | tests | `src/lib/data/template-health-processing.test.ts` | 216:12 | 1165-1165 | TS2532 | Object is possibly 'undefined'. |
| D1011 | tests | `src/lib/data/template-health-processing.test.ts` | 229:12 | 1166-1166 | TS2532 | Object is possibly 'undefined'. |
| D1012 | tests | `src/lib/data/template-health-processing.test.ts` | 265:12 | 1167-1167 | TS2532 | Object is possibly 'undefined'. |
| D1013 | tests | `src/lib/data/template-health-processing.test.ts` | 280:12 | 1168-1168 | TS2532 | Object is possibly 'undefined'. |
| D1014 | tests | `src/lib/data/template-health-processing.test.ts` | 289:12 | 1169-1169 | TS2532 | Object is possibly 'undefined'. |
| D1015 | tests | `src/lib/data/template-health-processing.test.ts` | 341:15 | 1170-1170 | TS2532 | Object is possibly 'undefined'. |
| D1016 | tests | `src/lib/data/template-health-sync.test.ts` | 116:12 | 1171-1171 | TS2532 | Object is possibly 'undefined'. |
| D1017 | tests | `src/lib/data/template-health-sync.test.ts` | 132:12 | 1172-1172 | TS2532 | Object is possibly 'undefined'. |
| D1018 | tests | `src/lib/data/template-health-sync.test.ts` | 175:12 | 1173-1173 | TS2532 | Object is possibly 'undefined'. |
| D1019 | tests | `src/lib/data/template-health-sync.test.ts` | 203:12 | 1174-1174 | TS2532 | Object is possibly 'undefined'. |
| D1020 | tests | `src/lib/data/template-health-sync.test.ts` | 265:46 | 1175-1175 | TS2532 | Object is possibly 'undefined'. |
| D1021 | tests | `src/lib/data/template-health-sync.test.ts` | 269:26 | 1176-1176 | TS2532 | Object is possibly 'undefined'. |
| D1022 | tests | `src/lib/data/unconfirmed-signup-cleanup.test.ts` | 100:19 | 1177-1177 | TS2532 | Object is possibly 'undefined'. |
| D1023 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 31:12 | 1178-1178 | TS18048 | 'a' is possibly 'undefined'. |
| D1024 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 32:12 | 1179-1179 | TS18048 | 'a' is possibly 'undefined'. |
| D1025 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 51:12 | 1180-1180 | TS2532 | Object is possibly 'undefined'. |
| D1026 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 61:12 | 1181-1181 | TS2532 | Object is possibly 'undefined'. |
| D1027 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 67:12 | 1182-1182 | TS2532 | Object is possibly 'undefined'. |
| D1028 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 68:12 | 1183-1183 | TS2532 | Object is possibly 'undefined'. |
| D1029 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 71:12 | 1184-1184 | TS2532 | Object is possibly 'undefined'. |
| D1030 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 77:12 | 1185-1185 | TS2532 | Object is possibly 'undefined'. |
| D1031 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 78:12 | 1186-1186 | TS2532 | Object is possibly 'undefined'. |
| D1032 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 111:12 | 1187-1187 | TS2532 | Object is possibly 'undefined'. |
| D1033 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 116:12 | 1188-1188 | TS18048 | 'a' is possibly 'undefined'. |
| D1034 | tests | `src/lib/data/voximplant-account-callback.test.ts` | 135:12 | 1189-1189 | TS2532 | Object is possibly 'undefined'. |
| D1035 | tests | `src/lib/data/webhook-processing.test.ts` | 244:7 | 1190-1191 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D1036 | tests | `src/lib/data/webhook-processing.test.ts` | 668:19 | 1192-1192 | TS2532 | Object is possibly 'undefined'. |
| D1037 | tests | `src/lib/data/webhook-processing.test.ts` | 686:27 | 1193-1193 | TS2532 | Object is possibly 'undefined'. |
| D1038 | tests | `src/lib/data/webhook-processing.test.ts` | 707:14 | 1194-1194 | TS2532 | Object is possibly 'undefined'. |
| D1039 | tests | `src/lib/data/webhook-processing.test.ts` | 713:19 | 1195-1195 | TS2532 | Object is possibly 'undefined'. |
| D1040 | tests | `src/lib/data/webhook-processing.test.ts` | 883:19 | 1196-1196 | TS2532 | Object is possibly 'undefined'. |
| D1041 | backend | `src/lib/data/webhook-processing.ts` | 446:40 | 1197-1197 | TS18048 | 'guest' is possibly 'undefined'. |
| D1042 | backend | `src/lib/data/webhook-processing.ts` | 452:56 | 1198-1198 | TS18048 | 'guest' is possibly 'undefined'. |
| D1043 | backend | `src/lib/data/webhook-processing.ts` | 458:32 | 1199-1199 | TS18048 | 'guest' is possibly 'undefined'. |
| D1044 | tests | `src/lib/data/whatsapp-import.test.ts` | 328:12 | 1200-1200 | TS2532 | Object is possibly 'undefined'. |
| D1045 | tests | `src/lib/data/whatsapp-import.test.ts` | 516:12 | 1201-1201 | TS2532 | Object is possibly 'undefined'. |
| D1046 | tests | `src/lib/data/whatsapp-import.test.ts` | 539:12 | 1202-1202 | TS2532 | Object is possibly 'undefined'. |
| D1047 | tests | `src/lib/data/whatsapp-import.test.ts` | 565:11 | 1203-1203 | TS2488 | Type '[cfg: { phoneNumberId: string; accessToken: string; appSecret: string &#124; null; }, params: { to: string; body: string; }, opts?: SendOptions &#124; undefined] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D1048 | tests | `src/lib/data/whatsapp-import.test.ts` | 640:12 | 1204-1204 | TS2532 | Object is possibly 'undefined'. |
| D1049 | tests | `src/lib/data/whatsapp-import.test.ts` | 654:12 | 1205-1205 | TS2532 | Object is possibly 'undefined'. |
| D1050 | tests | `src/lib/data/whatsapp-import.test.ts` | 665:12 | 1206-1206 | TS2532 | Object is possibly 'undefined'. |
| D1051 | tests | `src/lib/data/whatsapp-import.test.ts` | 674:12 | 1207-1207 | TS2532 | Object is possibly 'undefined'. |
| D1052 | backend | `src/lib/data/whatsapp-import.ts` | 260:3 | 1208-1208 | TS2532 | Object is possibly 'undefined'. |
| D1053 | backend | `src/lib/data/whatsapp-import.ts` | 271:53 | 1209-1209 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D1054 | backend | `src/lib/data/whatsapp-import.ts` | 276:62 | 1210-1210 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D1055 | backend | `src/lib/data/whatsapp-import.ts` | 278:24 | 1211-1211 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D1056 | backend | `src/lib/data/whatsapp-import.ts` | 280:44 | 1212-1212 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D1057 | backend | `src/lib/data/whatsapp-import.ts` | 544:21 | 1213-1213 | TS18048 | 'ownerEvent' is possibly 'undefined'. |
| D1058 | backend | `src/lib/data/whatsapp-import.ts` | 552:15 | 1214-1214 | TS18048 | 'ownerEvent' is possibly 'undefined'. |
| D1059 | backend | `src/lib/data/whatsapp-import.ts` | 569:27 | 1215-1216 | TS2345 | Argument of type 'ImportEvent &#124; undefined' is not assignable to parameter of type 'ImportEvent'.<br>  Type 'undefined' is not assignable to type 'ImportEvent'. |
| D1060 | backend | `src/lib/data/widget-sdk-auth.ts` | 61:50 | 1217-1218 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1061 | backend | `src/lib/date.ts` | 151:13 | 1219-1219 | TS2532 | Object is possibly 'undefined'. |
| D1062 | backend | `src/lib/date.ts` | 151:51 | 1220-1220 | TS2532 | Object is possibly 'undefined'. |
| D1063 | backend | `src/lib/date.ts` | 188:27 | 1221-1227 | TS2769 | No overload matches this call.<br>  Overload 1 of 2, '(year: number, monthIndex?: number &#124; undefined, date?: number &#124; undefined, hours?: number &#124; undefined, minutes?: number &#124; undefined, seconds?: number &#124; undefined, ms?: number &#124; undefined): number', gave the following error.<br>    Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number'.<br>      Type 'undefined' is not assignable to type 'number'.<br>  Overload 2 of 2, '(year: number, monthIndex: number, date?: number &#124; undefined, hours?: number &#124; undefined, minutes?: number &#124; undefined, seconds?: number &#124; undefined, ms?: number &#124; undefined): number', gave the following error.<br>    Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number'.<br>      Type 'undefined' is not assignable to type 'number'. |
| D1064 | backend | `src/lib/date.ts` | 188:30 | 1228-1228 | TS18048 | 'm' is possibly 'undefined'. |
| D1065 | backend | `src/lib/date.ts` | 198:26 | 1229-1235 | TS2769 | No overload matches this call.<br>  Overload 1 of 2, '(year: number, monthIndex?: number &#124; undefined, date?: number &#124; undefined, hours?: number &#124; undefined, minutes?: number &#124; undefined, seconds?: number &#124; undefined, ms?: number &#124; undefined): number', gave the following error.<br>    Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number'.<br>      Type 'undefined' is not assignable to type 'number'.<br>  Overload 2 of 2, '(year: number, monthIndex: number, date?: number &#124; undefined, hours?: number &#124; undefined, minutes?: number &#124; undefined, seconds?: number &#124; undefined, ms?: number &#124; undefined): number', gave the following error.<br>    Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number'.<br>      Type 'undefined' is not assignable to type 'number'. |
| D1066 | backend | `src/lib/date.ts` | 198:30 | 1236-1236 | TS18048 | 'tm' is possibly 'undefined'. |
| D1067 | tests | `src/lib/dnc/mutator.test.ts` | 40:11 | 1237-1237 | TS2488 | Type '[input: string &#124; URL &#124; Request, init?: RequestInit &#124; undefined] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D1068 | tests | `src/lib/dnc/registry-check.test.ts` | 58:36 | 1238-1238 | TS2532 | Object is possibly 'undefined'. |
| D1069 | backend | `src/lib/email/health.ts` | 163:19 | 1239-1239 | TS2532 | Object is possibly 'undefined'. |
| D1070 | tests | `src/lib/email/run-health-check.test.ts` | 111:18 | 1240-1240 | TS2532 | Object is possibly 'undefined'. |
| D1071 | tests | `src/lib/email/run-health-check.test.ts` | 129:12 | 1241-1241 | TS2532 | Object is possibly 'undefined'. |
| D1072 | tests | `src/lib/email/sender.test.ts` | 93:21 | 1242-1242 | TS2532 | Object is possibly 'undefined'. |
| D1073 | tests | `src/lib/email/sender.test.ts` | 112:21 | 1243-1243 | TS2532 | Object is possibly 'undefined'. |
| D1074 | tests | `src/lib/email/sender.test.ts` | 127:21 | 1244-1244 | TS2532 | Object is possibly 'undefined'. |
| D1075 | tests | `src/lib/email/sender.test.ts` | 135:21 | 1245-1245 | TS2532 | Object is possibly 'undefined'. |
| D1076 | tests | `src/lib/email/sender.test.ts` | 143:12 | 1246-1246 | TS2532 | Object is possibly 'undefined'. |
| D1077 | tests | `src/lib/email/sender.test.ts` | 153:12 | 1247-1247 | TS2532 | Object is possibly 'undefined'. |
| D1078 | tests | `src/lib/email/sender.test.ts` | 201:21 | 1248-1248 | TS2532 | Object is possibly 'undefined'. |
| D1079 | tests | `src/lib/email/sender.test.ts` | 218:21 | 1249-1249 | TS2532 | Object is possibly 'undefined'. |
| D1080 | tests | `src/lib/email/sender.test.ts` | 231:21 | 1250-1250 | TS2532 | Object is possibly 'undefined'. |
| D1081 | tests | `src/lib/email/sender.test.ts` | 241:21 | 1251-1251 | TS2532 | Object is possibly 'undefined'. |
| D1082 | tests | `src/lib/exchange-ews/graph-impl.test.ts` | 141:12 | 1252-1252 | TS2532 | Object is possibly 'undefined'. |
| D1083 | tests | `src/lib/exchange-ews/provider.test.ts` | 82:38 | 1253-1254 | TS2322 | Type '{ showAs: "tentative"; start: Date; end: Date; } &#124; { showAs: "working_elsewhere"; start: Date; end: Date; } &#124; { showAs: "oof"; start: Date; end: Date; } &#124; { showAs: "busy"; start: Date; end: Date; } &#124; undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'.<br>  Type 'undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'. |
| D1084 | tests | `src/lib/exchange-ews/provider.test.ts` | 82:48 | 1255-1256 | TS2322 | Type '{ showAs: "tentative"; start: Date; end: Date; } &#124; { showAs: "working_elsewhere"; start: Date; end: Date; } &#124; { showAs: "oof"; start: Date; end: Date; } &#124; { showAs: "busy"; start: Date; end: Date; } &#124; undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'.<br>  Type 'undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'. |
| D1085 | tests | `src/lib/exchange-ews/provider.test.ts` | 82:58 | 1257-1258 | TS2322 | Type '{ showAs: "tentative"; start: Date; end: Date; } &#124; { showAs: "working_elsewhere"; start: Date; end: Date; } &#124; { showAs: "oof"; start: Date; end: Date; } &#124; { showAs: "busy"; start: Date; end: Date; } &#124; undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'.<br>  Type 'undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'. |
| D1086 | tests | `src/lib/exchange-ews/provider.test.ts` | 82:68 | 1259-1260 | TS2322 | Type '{ showAs: "tentative"; start: Date; end: Date; } &#124; { showAs: "working_elsewhere"; start: Date; end: Date; } &#124; { showAs: "oof"; start: Date; end: Date; } &#124; { showAs: "busy"; start: Date; end: Date; } &#124; undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'.<br>  Type 'undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'. |
| D1087 | tests | `src/lib/exchange-ews/provider.test.ts` | 85:38 | 1261-1262 | TS2322 | Type '{ showAs: "tentative"; start: Date; end: Date; } &#124; { showAs: "working_elsewhere"; start: Date; end: Date; } &#124; { showAs: "oof"; start: Date; end: Date; } &#124; { showAs: "busy"; start: Date; end: Date; } &#124; undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'.<br>  Type 'undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'. |
| D1088 | tests | `src/lib/exchange-ews/provider.test.ts` | 85:48 | 1263-1264 | TS2322 | Type '{ showAs: "tentative"; start: Date; end: Date; } &#124; { showAs: "working_elsewhere"; start: Date; end: Date; } &#124; { showAs: "oof"; start: Date; end: Date; } &#124; { showAs: "busy"; start: Date; end: Date; } &#124; undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'.<br>  Type 'undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'. |
| D1089 | tests | `src/lib/exchange-ews/provider.test.ts` | 85:58 | 1265-1266 | TS2322 | Type '{ showAs: "tentative"; start: Date; end: Date; } &#124; { showAs: "working_elsewhere"; start: Date; end: Date; } &#124; { showAs: "oof"; start: Date; end: Date; } &#124; { showAs: "busy"; start: Date; end: Date; } &#124; undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'.<br>  Type 'undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'. |
| D1090 | tests | `src/lib/exchange-ews/provider.test.ts` | 86:38 | 1267-1268 | TS2322 | Type '{ showAs: "tentative"; start: Date; end: Date; } &#124; { showAs: "working_elsewhere"; start: Date; end: Date; } &#124; { showAs: "oof"; start: Date; end: Date; } &#124; { showAs: "busy"; start: Date; end: Date; } &#124; undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'.<br>  Type 'undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'. |
| D1091 | tests | `src/lib/exchange-ews/provider.test.ts` | 86:48 | 1269-1270 | TS2322 | Type '{ showAs: "tentative"; start: Date; end: Date; } &#124; { showAs: "working_elsewhere"; start: Date; end: Date; } &#124; { showAs: "oof"; start: Date; end: Date; } &#124; { showAs: "busy"; start: Date; end: Date; } &#124; undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'.<br>  Type 'undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'. |
| D1092 | tests | `src/lib/exchange-ews/provider.test.ts` | 87:38 | 1271-1272 | TS2322 | Type '{ showAs: "tentative"; start: Date; end: Date; } &#124; { showAs: "working_elsewhere"; start: Date; end: Date; } &#124; { showAs: "oof"; start: Date; end: Date; } &#124; { showAs: "busy"; start: Date; end: Date; } &#124; undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'.<br>  Type 'undefined' is not assignable to type '{ start: Date; end: Date; showAs: AppointmentShowAs; }'. |
| D1093 | tests | `src/lib/faq/json-ld.test.ts` | 30:13 | 1273-1273 | TS2532 | Object is possibly 'undefined'. |
| D1094 | tests | `src/lib/faq/json-ld.test.ts` | 31:50 | 1274-1274 | TS2532 | Object is possibly 'undefined'. |
| D1095 | tests | `src/lib/faq/json-ld.test.ts` | 45:12 | 1275-1275 | TS2532 | Object is possibly 'undefined'. |
| D1096 | tests | `src/lib/faq/page-model.test.ts` | 103:20 | 1276-1276 | TS2532 | Object is possibly 'undefined'. |
| D1097 | tests | `src/lib/faq/page-model.test.ts` | 122:12 | 1277-1277 | TS2532 | Object is possibly 'undefined'. |
| D1098 | tests | `src/lib/faq/page-model.test.ts` | 146:12 | 1278-1278 | TS2532 | Object is possibly 'undefined'. |
| D1099 | backend | `src/lib/fleet/agent-avatars.ts` | 28:53 | 1279-1280 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string &#124; null'.<br>  Type 'undefined' is not assignable to type 'string &#124; null'. |
| D1100 | backend | `src/lib/fleet/business-facts.ts` | 83:68 | 1281-1281 | TS2532 | Object is possibly 'undefined'. |
| D1101 | backend | `src/lib/fleet/business-facts.ts` | 83:103 | 1282-1282 | TS2532 | Object is possibly 'undefined'. |
| D1102 | backend | `src/lib/fleet/business-facts.ts` | 98:20 | 1283-1283 | TS18048 | 'first' is possibly 'undefined'. |
| D1103 | backend | `src/lib/fleet/business-facts.ts` | 99:81 | 1284-1284 | TS18048 | 'first' is possibly 'undefined'. |
| D1104 | backend | `src/lib/fleet/business-facts.ts` | 100:7 | 1285-1285 | TS18048 | 'first' is possibly 'undefined'. |
| D1105 | tests | `src/lib/fleet/conversation.test.ts` | 55:12 | 1286-1286 | TS18048 | 'verdict' is possibly 'undefined'. |
| D1106 | tests | `src/lib/fleet/conversation.test.ts` | 55:42 | 1287-1287 | TS18048 | 'verdict' is possibly 'undefined'. |
| D1107 | tests | `src/lib/fleet/conversation.test.ts` | 55:50 | 1288-1289 | TS2339 | Property 'text' does not exist on type 'ConversationEvent'.<br>  Property 'text' does not exist on type 'MessageEvent'. |
| D1108 | tests | `src/lib/fleet/conversation.test.ts` | 56:12 | 1290-1290 | TS18048 | 'verdict' is possibly 'undefined'. |
| D1109 | tests | `src/lib/fleet/conversation.test.ts` | 56:42 | 1291-1291 | TS18048 | 'verdict' is possibly 'undefined'. |
| D1110 | tests | `src/lib/fleet/conversation.test.ts` | 56:50 | 1292-1293 | TS2339 | Property 'verdict' does not exist on type 'ConversationEvent'.<br>  Property 'verdict' does not exist on type 'MessageEvent'. |
| D1111 | tests | `src/lib/fleet/conversation.test.ts` | 57:12 | 1294-1294 | TS18048 | 'verdict' is possibly 'undefined'. |
| D1112 | tests | `src/lib/fleet/conversation.test.ts` | 77:12 | 1295-1295 | TS2532 | Object is possibly 'undefined'. |
| D1113 | tests | `src/lib/fleet/conversation.test.ts` | 92:12 | 1296-1296 | TS18048 | 'verdict' is possibly 'undefined'. |
| D1114 | tests | `src/lib/fleet/conversation.test.ts` | 92:42 | 1297-1297 | TS18048 | 'verdict' is possibly 'undefined'. |
| D1115 | tests | `src/lib/fleet/conversation.test.ts` | 92:50 | 1298-1299 | TS2339 | Property 'text' does not exist on type 'ConversationEvent'.<br>  Property 'text' does not exist on type 'MessageEvent'. |
| D1116 | tests | `src/lib/fleet/conversation.test.ts` | 94:12 | 1300-1300 | TS18048 | 'verdict' is possibly 'undefined'. |
| D1117 | tests | `src/lib/fleet/conversation.test.ts` | 94:42 | 1301-1301 | TS18048 | 'verdict' is possibly 'undefined'. |
| D1118 | tests | `src/lib/fleet/conversation.test.ts` | 94:50 | 1302-1303 | TS2339 | Property 'verdict' does not exist on type 'ConversationEvent'.<br>  Property 'verdict' does not exist on type 'MessageEvent'. |
| D1119 | tests | `src/lib/fleet/conversation.test.ts` | 95:12 | 1304-1304 | TS18048 | 'completion' is possibly 'undefined'. |
| D1120 | tests | `src/lib/fleet/conversation.test.ts` | 95:48 | 1305-1305 | TS18048 | 'completion' is possibly 'undefined'. |
| D1121 | tests | `src/lib/fleet/conversation.test.ts` | 95:59 | 1306-1307 | TS2339 | Property 'text' does not exist on type 'ConversationEvent'.<br>  Property 'text' does not exist on type 'MessageEvent'. |
| D1122 | tests | `src/lib/fleet/conversation.test.ts` | 102:12 | 1308-1308 | TS18048 | 'line' is possibly 'undefined'. |
| D1123 | tests | `src/lib/fleet/conversation.test.ts` | 102:38 | 1309-1309 | TS18048 | 'line' is possibly 'undefined'. |
| D1124 | tests | `src/lib/fleet/conversation.test.ts` | 102:43 | 1310-1311 | TS2339 | Property 'text' does not exist on type 'ConversationEvent'.<br>  Property 'text' does not exist on type 'MessageEvent'. |
| D1125 | tests | `src/lib/fleet/conversation.test.ts` | 110:12 | 1312-1312 | TS2532 | Object is possibly 'undefined'. |
| D1126 | tests | `src/lib/fleet/conversation.test.ts` | 110:44 | 1313-1313 | TS2532 | Object is possibly 'undefined'. |
| D1127 | tests | `src/lib/fleet/conversation.test.ts` | 110:54 | 1314-1315 | TS2339 | Property 'text' does not exist on type 'ConversationEvent'.<br>  Property 'text' does not exist on type 'MessageEvent'. |
| D1128 | tests | `src/lib/fleet/conversation.test.ts` | 135:12 | 1316-1316 | TS18048 | 'inLine' is possibly 'undefined'. |
| D1129 | tests | `src/lib/fleet/conversation.test.ts` | 135:40 | 1317-1317 | TS18048 | 'inLine' is possibly 'undefined'. |
| D1130 | tests | `src/lib/fleet/conversation.test.ts` | 135:47 | 1318-1319 | TS2339 | Property 'link' does not exist on type 'ConversationEvent'.<br>  Property 'link' does not exist on type 'MessageEvent'. |
| D1131 | tests | `src/lib/fleet/conversation.test.ts` | 148:12 | 1320-1320 | TS2532 | Object is possibly 'undefined'. |
| D1132 | tests | `src/lib/fleet/conversation.test.ts` | 148:44 | 1321-1321 | TS2532 | Object is possibly 'undefined'. |
| D1133 | tests | `src/lib/fleet/conversation.test.ts` | 148:54 | 1322-1323 | TS2339 | Property 'replyToTitle' does not exist on type 'ConversationEvent'.<br>  Property 'replyToTitle' does not exist on type 'VerdictEvent'. |
| D1134 | tests | `src/lib/fleet/conversation.test.ts` | 213:12 | 1324-1324 | TS2532 | Object is possibly 'undefined'. |
| D1135 | tests | `src/lib/fleet/conversation.test.ts` | 213:39 | 1325-1325 | TS2532 | Object is possibly 'undefined'. |
| D1136 | tests | `src/lib/fleet/conversation.test.ts` | 213:48 | 1326-1327 | TS2339 | Property 'label' does not exist on type 'StreamItem'.<br>  Property 'label' does not exist on type '{ type: "group"; key: string; author: ContentAuthor; events: BubbleEvent[]; }'. |
| D1137 | tests | `src/lib/fleet/conversation.test.ts` | 272:12 | 1328-1328 | TS2532 | Object is possibly 'undefined'. |
| D1138 | backend | `src/lib/fleet/conversation.ts` | 118:32 | 1329-1330 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1139 | backend | `src/lib/fleet/conversation.ts` | 118:47 | 1331-1332 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1140 | backend | `src/lib/fleet/conversation.ts` | 376:30 | 1333-1333 | TS18048 | 'e' is possibly 'undefined'. |
| D1141 | backend | `src/lib/fleet/conversation.ts` | 380:68 | 1334-1334 | TS18048 | 'e' is possibly 'undefined'. |
| D1142 | backend | `src/lib/fleet/conversation.ts` | 386:26 | 1335-1336 | TS2345 | Argument of type 'ConversationEvent &#124; undefined' is not assignable to parameter of type 'ConversationEvent'.<br>  Type 'undefined' is not assignable to type 'ConversationEvent'. |
| D1143 | backend | `src/lib/fleet/conversation.ts` | 388:52 | 1337-1338 | TS2345 | Argument of type 'ConversationEvent &#124; undefined' is not assignable to parameter of type 'ConversationEvent'.<br>  Type 'undefined' is not assignable to type 'ConversationEvent'. |
| D1144 | backend | `src/lib/fleet/conversation.ts` | 388:79 | 1339-1339 | TS2532 | Object is possibly 'undefined'. |
| D1145 | backend | `src/lib/fleet/conversation.ts` | 391:59 | 1340-1340 | TS2532 | Object is possibly 'undefined'. |
| D1146 | backend | `src/lib/fleet/conversation.ts` | 398:9 | 1341-1341 | TS18048 | 'e' is possibly 'undefined'. |
| D1147 | backend | `src/lib/fleet/conversation.ts` | 399:41 | 1342-1342 | TS18048 | 'e' is possibly 'undefined'. |
| D1148 | backend | `src/lib/fleet/conversation.ts` | 399:48 | 1343-1344 | TS2322 | Type 'ConversationEvent &#124; undefined' is not assignable to type 'SystemEvent'.<br>  Type 'undefined' is not assignable to type 'SystemEvent'. |
| D1149 | backend | `src/lib/fleet/conversation.ts` | 405:33 | 1345-1346 | TS2345 | Argument of type 'ConversationEvent &#124; undefined' is not assignable to parameter of type 'BubbleEvent'.<br>  Type 'undefined' is not assignable to type 'BubbleEvent'. |
| D1150 | backend | `src/lib/fleet/conversation.ts` | 407:64 | 1347-1347 | TS18048 | 'e' is possibly 'undefined'. |
| D1151 | backend | `src/lib/fleet/conversation.ts` | 408:25 | 1348-1349 | TS2345 | Argument of type 'ConversationEvent &#124; undefined' is not assignable to parameter of type 'BubbleEvent'.<br>  Type 'undefined' is not assignable to type 'BubbleEvent'. |
| D1152 | backend | `src/lib/fleet/conversation.ts` | 410:46 | 1350-1350 | TS18048 | 'e' is possibly 'undefined'. |
| D1153 | backend | `src/lib/fleet/conversation.ts` | 410:72 | 1351-1352 | TS2322 | Type 'ConversationEvent &#124; undefined' is not assignable to type 'BubbleEvent'.<br>  Type 'undefined' is not assignable to type 'BubbleEvent'. |
| D1154 | backend | `src/lib/fleet/conversation.ts` | 411:18 | 1353-1354 | TS2345 | Argument of type '{ type: "group"; key: string; author: ContentAuthor; events: BubbleEvent[]; } &#124; null' is not assignable to parameter of type 'StreamItem'.<br>  Type 'null' is not assignable to type 'StreamItem'. |
| D1155 | backend | `src/lib/fleet/housekeeping-pr.ts` | 176:18 | 1355-1355 | TS2532 | Object is possibly 'undefined'. |
| D1156 | backend | `src/lib/fleet/publish-social.ts` | 166:29 | 1356-1357 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1157 | backend | `src/lib/fleet/publish-social.ts` | 166:60 | 1358-1359 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1158 | tests | `src/lib/fleet/tier0-design-settings.test.ts` | 57:14 | 1360-1360 | TS2532 | Object is possibly 'undefined'. |
| D1159 | tests | `src/lib/fleet/tier0-design-settings.test.ts` | 58:14 | 1361-1361 | TS2532 | Object is possibly 'undefined'. |
| D1160 | tests | `src/lib/fleet/tier0-design-settings.test.ts` | 65:12 | 1362-1362 | TS2532 | Object is possibly 'undefined'. |
| D1161 | tests | `src/lib/integrations/oauth-flow.test.ts` | 193:12 | 1363-1363 | TS2532 | Object is possibly 'undefined'. |
| D1162 | tests | `src/lib/integrations/oauth-flow.test.ts` | 199:12 | 1364-1364 | TS2532 | Object is possibly 'undefined'. |
| D1163 | tests | `src/lib/integrations/oauth-flow.test.ts` | 217:12 | 1365-1365 | TS2532 | Object is possibly 'undefined'. |
| D1164 | tests | `src/lib/integrations/oauth-flow.test.ts` | 223:12 | 1366-1366 | TS2532 | Object is possibly 'undefined'. |
| D1165 | tests | `src/lib/integrations/oauth-flow.test.ts` | 224:12 | 1367-1367 | TS2532 | Object is possibly 'undefined'. |
| D1166 | tests | `src/lib/integrations/oauth-flow.test.ts` | 249:12 | 1368-1368 | TS2532 | Object is possibly 'undefined'. |
| D1167 | backend | `src/lib/microsoft/subscriptions.ts` | 149:32 | 1369-1369 | TS18048 | 'keep' is possibly 'undefined'. |
| D1168 | backend | `src/lib/microsoft/subscriptions.ts` | 151:32 | 1370-1370 | TS18048 | 'keep' is possibly 'undefined'. |
| D1169 | backend | `src/lib/microsoft/subscriptions.ts` | 151:52 | 1371-1371 | TS18048 | 'keep' is possibly 'undefined'. |
| D1170 | backend | `src/lib/microsoft/subscriptions.ts` | 153:43 | 1372-1372 | TS18048 | 'keep' is possibly 'undefined'. |
| D1171 | tests | `src/lib/next-route-exports.test.ts` | 74:55 | 1373-1374 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1172 | tests | `src/lib/next-route-exports.test.ts` | 83:27 | 1375-1375 | TS2532 | Object is possibly 'undefined'. |
| D1173 | tests | `src/lib/next-route-exports.test.ts` | 87:24 | 1376-1376 | TS2532 | Object is possibly 'undefined'. |
| D1174 | backend | `src/lib/ops/db-health.ts` | 77:26 | 1377-1377 | TS18048 | 'row' is possibly 'undefined'. |
| D1175 | backend | `src/lib/ops/db-health.ts` | 78:23 | 1378-1378 | TS18048 | 'row' is possibly 'undefined'. |
| D1176 | backend | `src/lib/ops/db-health.ts` | 79:24 | 1379-1379 | TS18048 | 'row' is possibly 'undefined'. |
| D1177 | backend | `src/lib/ops/db-health.ts` | 80:24 | 1380-1380 | TS18048 | 'row' is possibly 'undefined'. |
| D1178 | backend | `src/lib/ops/db-health.ts` | 81:28 | 1381-1381 | TS18048 | 'row' is possibly 'undefined'. |
| D1179 | backend | `src/lib/ops/db-health.ts` | 82:20 | 1382-1382 | TS18048 | 'row' is possibly 'undefined'. |
| D1180 | tests | `src/lib/ops/integrations.test.ts` | 123:12 | 1383-1383 | TS2532 | Object is possibly 'undefined'. |
| D1181 | tests | `src/lib/ops/integrations.test.ts` | 124:12 | 1384-1384 | TS2532 | Object is possibly 'undefined'. |
| D1182 | tests | `src/lib/ops/integrations.test.ts` | 139:12 | 1385-1385 | TS18048 | 'off.elevenlabs' is possibly 'undefined'. |
| D1183 | tests | `src/lib/ops/integrations.test.ts` | 143:12 | 1386-1386 | TS18048 | 'on.elevenlabs' is possibly 'undefined'. |
| D1184 | tests | `src/lib/ops/integrations.test.ts` | 150:12 | 1387-1387 | TS18048 | 'items.voximplant' is possibly 'undefined'. |
| D1185 | tests | `src/lib/ops/integrations.test.ts` | 151:12 | 1388-1388 | TS18048 | 'items.voximplant' is possibly 'undefined'. |
| D1186 | tests | `src/lib/ops/integrations.test.ts` | 158:12 | 1389-1389 | TS18048 | 'items.elevenlabs' is possibly 'undefined'. |
| D1187 | tests | `src/lib/ops/integrations.test.ts` | 158:43 | 1390-1390 | TS18048 | 'items.elevenlabs' is possibly 'undefined'. |
| D1188 | tests | `src/lib/ops/integrations.test.ts` | 159:12 | 1391-1391 | TS18048 | 'items.ga4' is possibly 'undefined'. |
| D1189 | tests | `src/lib/ops/integrations.test.ts` | 159:36 | 1392-1392 | TS18048 | 'items.ga4' is possibly 'undefined'. |
| D1190 | tests | `src/lib/ops/integrations.test.ts` | 165:12 | 1393-1393 | TS18048 | 'items.ga4' is possibly 'undefined'. |
| D1191 | tests | `src/lib/ops/integrations.test.ts` | 173:12 | 1394-1394 | TS18048 | 'items.voximplant' is possibly 'undefined'. |
| D1192 | tests | `src/lib/ops/integrations.test.ts` | 174:12 | 1395-1395 | TS18048 | 'items.elevenlabs' is possibly 'undefined'. |
| D1193 | tests | `src/lib/ops/integrations.test.ts` | 175:12 | 1396-1396 | TS18048 | 'items.whatsapp' is possibly 'undefined'. |
| D1194 | tests | `src/lib/ops/pm2-jlist.test.ts` | 72:25 | 1397-1397 | TS2532 | Object is possibly 'undefined'. |
| D1195 | tests | `src/lib/ops/queue-schedule.test.ts` | 35:65 | 1398-1398 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D1196 | tests | `src/lib/ops/queue-schedule.test.ts` | 45:25 | 1399-1399 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D1197 | tests | `src/lib/outreach/enqueue.test.ts` | 40:11 | 1400-1400 | TS2488 | Type '[string, OutreachStepJob, Record&lt;string, unknown&gt;] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D1198 | tests | `src/lib/outreach/enqueue.test.ts` | 61:12 | 1401-1401 | TS2532 | Object is possibly 'undefined'. |
| D1199 | tests | `src/lib/outreach/enqueue.test.ts` | 64:12 | 1402-1402 | TS2532 | Object is possibly 'undefined'. |
| D1200 | backend | `src/lib/outreach/send-policy.ts` | 47:10 | 1403-1403 | TS18048 | 'h' is possibly 'undefined'. |
| D1201 | backend | `src/lib/outreach/send-policy.ts` | 47:19 | 1404-1404 | TS18048 | 'm' is possibly 'undefined'. |
| D1202 | tests | `src/lib/outreach/send-window.calendar.test.ts` | 24:50 | 1405-1405 | TS18048 | 'h' is possibly 'undefined'. |
| D1203 | tests | `src/lib/outreach/send-window.calendar.test.ts` | 24:59 | 1406-1406 | TS18048 | 'm' is possibly 'undefined'. |
| D1204 | tests | `src/lib/outreach/send-window.calendar.test.ts` | 118:19 | 1407-1407 | TS2532 | Object is possibly 'undefined'. |
| D1205 | tests | `src/lib/outreach/send-window.test.ts` | 24:10 | 1408-1408 | TS18048 | 'h' is possibly 'undefined'. |
| D1206 | tests | `src/lib/outreach/send-window.test.ts` | 24:19 | 1409-1409 | TS18048 | 'm' is possibly 'undefined'. |
| D1207 | backend | `src/lib/outreach/send-window.ts` | 40:36 | 1410-1410 | TS18048 | 'h' is possibly 'undefined'. |
| D1208 | backend | `src/lib/outreach/send-window.ts` | 40:45 | 1411-1411 | TS18048 | 'm' is possibly 'undefined'. |
| D1209 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 59:12 | 1412-1412 | TS2532 | Object is possibly 'undefined'. |
| D1210 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 136:12 | 1413-1413 | TS2532 | Object is possibly 'undefined'. |
| D1211 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 147:16 | 1414-1414 | TS2532 | Object is possibly 'undefined'. |
| D1212 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 148:12 | 1415-1415 | TS2532 | Object is possibly 'undefined'. |
| D1213 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 149:12 | 1416-1416 | TS2532 | Object is possibly 'undefined'. |
| D1214 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 149:12 | 1417-1417 | TS2532 | Object is possibly 'undefined'. |
| D1215 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 150:16 | 1418-1418 | TS2532 | Object is possibly 'undefined'. |
| D1216 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 150:16 | 1419-1419 | TS2532 | Object is possibly 'undefined'. |
| D1217 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 151:12 | 1420-1420 | TS2532 | Object is possibly 'undefined'. |
| D1218 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 151:12 | 1421-1421 | TS2532 | Object is possibly 'undefined'. |
| D1219 | tests | `src/lib/owner-agent/consumer/reply-text.test.ts` | 157:12 | 1422-1422 | TS2532 | Object is possibly 'undefined'. |
| D1220 | backend | `src/lib/owner-agent/consumer/reply-text.ts` | 149:62 | 1423-1424 | TS2345 | Argument of type 'TurnPart &#124; undefined' is not assignable to parameter of type 'TurnPart'.<br>  Type 'undefined' is not assignable to type 'TurnPart'. |
| D1221 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 65:21 | 1425-1434 | TS2769 | No overload matches this call.<br>  Overload 1 of 3, '(pattern: string &#124; RegExp, flags?: string &#124; undefined): RegExp', gave the following error.<br>    Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string &#124; RegExp'.<br>      Type 'undefined' is not assignable to type 'string &#124; RegExp'.<br>  Overload 2 of 3, '(pattern: string &#124; RegExp): RegExp', gave the following error.<br>    Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string &#124; RegExp'.<br>      Type 'undefined' is not assignable to type 'string &#124; RegExp'.<br>  Overload 3 of 3, '(pattern: string, flags?: string &#124; undefined): RegExp', gave the following error.<br>    Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>      Type 'undefined' is not assignable to type 'string'. |
| D1222 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 187:33 | 1435-1435 | TS18048 | 'w.db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1223 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 189:35 | 1436-1436 | TS18048 | 'w.db.tables.app_settings' is possibly 'undefined'. |
| D1224 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 203:19 | 1437-1437 | TS2532 | Object is possibly 'undefined'. |
| D1225 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 219:11 | 1438-1438 | TS2488 | Type '[s: WhatsAppSender, p: { to: string; body: string; retryBudgetMs?: number &#124; undefined; }] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D1226 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 228:12 | 1439-1439 | TS2532 | Object is possibly 'undefined'. |
| D1227 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 237:23 | 1440-1440 | TS2532 | Object is possibly 'undefined'. |
| D1228 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 246:12 | 1441-1441 | TS2532 | Object is possibly 'undefined'. |
| D1229 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 256:12 | 1442-1442 | TS2532 | Object is possibly 'undefined'. |
| D1230 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 262:54 | 1443-1443 | TS2532 | Object is possibly 'undefined'. |
| D1231 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 264:59 | 1444-1444 | TS2532 | Object is possibly 'undefined'. |
| D1232 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 265:64 | 1445-1445 | TS2532 | Object is possibly 'undefined'. |
| D1233 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 267:68 | 1446-1446 | TS2532 | Object is possibly 'undefined'. |
| D1234 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 267:68 | 1447-1447 | TS2532 | Object is possibly 'undefined'. |
| D1235 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 269:68 | 1448-1448 | TS18048 | 'w.db.tables.owner_agent_allowlist' is possibly 'undefined'. |
| D1236 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 269:68 | 1449-1449 | TS2532 | Object is possibly 'undefined'. |
| D1237 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 274:15 | 1450-1450 | TS18048 | 'w.db.tables.owner_agent_allowlist' is possibly 'undefined'. |
| D1238 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 274:15 | 1451-1451 | TS2532 | Object is possibly 'undefined'. |
| D1239 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 279:15 | 1452-1452 | TS2532 | Object is possibly 'undefined'. |
| D1240 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 279:15 | 1453-1453 | TS2532 | Object is possibly 'undefined'. |
| D1241 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 285:15 | 1454-1454 | TS18048 | 'w.db.tables.owner_agent_allowlist' is possibly 'undefined'. |
| D1242 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 285:15 | 1455-1455 | TS2532 | Object is possibly 'undefined'. |
| D1243 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 287:64 | 1456-1456 | TS2532 | Object is possibly 'undefined'. |
| D1244 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 296:23 | 1457-1457 | TS2532 | Object is possibly 'undefined'. |
| D1245 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 316:12 | 1458-1458 | TS2532 | Object is possibly 'undefined'. |
| D1246 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 355:12 | 1459-1459 | TS2532 | Object is possibly 'undefined'. |
| D1247 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 361:61 | 1460-1460 | TS2532 | Object is possibly 'undefined'. |
| D1248 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 362:55 | 1461-1461 | TS2532 | Object is possibly 'undefined'. |
| D1249 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 363:66 | 1462-1462 | TS18048 | 'w.db.tables.owner_agent_allowlist' is possibly 'undefined'. |
| D1250 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 363:66 | 1463-1463 | TS2532 | Object is possibly 'undefined'. |
| D1251 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 379:7 | 1464-1464 | TS2532 | Object is possibly 'undefined'. |
| D1252 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 384:12 | 1465-1465 | TS2532 | Object is possibly 'undefined'. |
| D1253 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 399:14 | 1466-1466 | TS2532 | Object is possibly 'undefined'. |
| D1254 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 402:14 | 1467-1467 | TS2532 | Object is possibly 'undefined'. |
| D1255 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 406:25 | 1468-1468 | TS2532 | Object is possibly 'undefined'. |
| D1256 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 414:12 | 1469-1469 | TS2532 | Object is possibly 'undefined'. |
| D1257 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 415:12 | 1470-1470 | TS2532 | Object is possibly 'undefined'. |
| D1258 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 423:12 | 1471-1471 | TS2532 | Object is possibly 'undefined'. |
| D1259 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 424:12 | 1472-1472 | TS2532 | Object is possibly 'undefined'. |
| D1260 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 541:12 | 1473-1473 | TS2532 | Object is possibly 'undefined'. |
| D1261 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 557:12 | 1474-1474 | TS2532 | Object is possibly 'undefined'. |
| D1262 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 564:12 | 1475-1475 | TS2532 | Object is possibly 'undefined'. |
| D1263 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 579:27 | 1476-1476 | TS2532 | Object is possibly 'undefined'. |
| D1264 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 579:27 | 1477-1478 | TS2345 | Argument of type 'TableRow &#124; undefined' is not assignable to parameter of type 'TableRow'.<br>  Type 'undefined' is not assignable to type 'TableRow'. |
| D1265 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 587:12 | 1479-1479 | TS2532 | Object is possibly 'undefined'. |
| D1266 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 593:5 | 1480-1480 | TS18048 | 'w.db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1267 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 593:5 | 1481-1481 | TS2532 | Object is possibly 'undefined'. |
| D1268 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 601:12 | 1482-1482 | TS2532 | Object is possibly 'undefined'. |
| D1269 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 605:12 | 1483-1483 | TS2532 | Object is possibly 'undefined'. |
| D1270 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 609:12 | 1484-1484 | TS2532 | Object is possibly 'undefined'. |
| D1271 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 615:7 | 1485-1485 | TS18048 | 'w.db.tables.owner_agent_allowlist' is possibly 'undefined'. |
| D1272 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 615:7 | 1486-1486 | TS2532 | Object is possibly 'undefined'. |
| D1273 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 619:5 | 1487-1487 | TS18048 | 'w.db.tables.owner_agent_allowlist' is possibly 'undefined'. |
| D1274 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 619:5 | 1488-1488 | TS2532 | Object is possibly 'undefined'. |
| D1275 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 622:12 | 1489-1489 | TS2532 | Object is possibly 'undefined'. |
| D1276 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 631:12 | 1490-1490 | TS2532 | Object is possibly 'undefined'. |
| D1277 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 641:12 | 1491-1491 | TS2532 | Object is possibly 'undefined'. |
| D1278 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 655:12 | 1492-1492 | TS2532 | Object is possibly 'undefined'. |
| D1279 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 671:12 | 1493-1493 | TS2532 | Object is possibly 'undefined'. |
| D1280 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 672:12 | 1494-1494 | TS2532 | Object is possibly 'undefined'. |
| D1281 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 676:12 | 1495-1495 | TS2532 | Object is possibly 'undefined'. |
| D1282 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 756:12 | 1496-1496 | TS2532 | Object is possibly 'undefined'. |
| D1283 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 756:12 | 1497-1497 | TS2532 | Object is possibly 'undefined'. |
| D1284 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 757:27 | 1498-1498 | TS2532 | Object is possibly 'undefined'. |
| D1285 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 757:27 | 1499-1500 | TS2345 | Argument of type 'TableRow &#124; undefined' is not assignable to parameter of type 'TableRow'.<br>  Type 'undefined' is not assignable to type 'TableRow'. |
| D1286 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 773:5 | 1501-1501 | TS18048 | 'w.db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1287 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 773:5 | 1502-1502 | TS2532 | Object is possibly 'undefined'. |
| D1288 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 787:19 | 1503-1503 | TS18048 | 'w.db.tables.owner_agent_allowlist' is possibly 'undefined'. |
| D1289 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 787:19 | 1504-1510 | TS2769 | No overload matches this call.<br>  Overload 1 of 4, '(target: {}, source: { approval_kind: string; staff_user_id: string &#124; null; e164: string; }): { approval_kind: string; staff_user_id: string &#124; null; e164: string; }', gave the following error.<br>    Argument of type 'TableRow &#124; undefined' is not assignable to parameter of type '{}'.<br>      Type 'undefined' is not assignable to type '{}'.<br>  Overload 2 of 4, '(target: object, ...sources: any[]): any', gave the following error.<br>    Argument of type 'TableRow &#124; undefined' is not assignable to parameter of type 'object'.<br>      Type 'undefined' is not assignable to type 'object'. |
| D1290 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 798:12 | 1511-1511 | TS2532 | Object is possibly 'undefined'. |
| D1291 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 799:12 | 1512-1512 | TS2532 | Object is possibly 'undefined'. |
| D1292 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 807:12 | 1513-1513 | TS2532 | Object is possibly 'undefined'. |
| D1293 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 816:12 | 1514-1514 | TS2532 | Object is possibly 'undefined'. |
| D1294 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 817:12 | 1515-1515 | TS2532 | Object is possibly 'undefined'. |
| D1295 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 819:12 | 1516-1516 | TS2532 | Object is possibly 'undefined'. |
| D1296 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 826:7 | 1517-1517 | TS18048 | 'w.db.tables.owner_agent_allowlist' is possibly 'undefined'. |
| D1297 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 826:7 | 1518-1518 | TS2532 | Object is possibly 'undefined'. |
| D1298 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 899:12 | 1519-1519 | TS2532 | Object is possibly 'undefined'. |
| D1299 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 900:12 | 1520-1520 | TS2532 | Object is possibly 'undefined'. |
| D1300 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 901:12 | 1521-1521 | TS2532 | Object is possibly 'undefined'. |
| D1301 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 966:11 | 1522-1522 | TS2488 | Type '[sender: WhatsAppSender, request: MediaDownloadRequest] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D1302 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 980:19 | 1523-1523 | TS2532 | Object is possibly 'undefined'. |
| D1303 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 988:23 | 1524-1524 | TS2532 | Object is possibly 'undefined'. |
| D1304 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 996:12 | 1525-1525 | TS2532 | Object is possibly 'undefined'. |
| D1305 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1012:12 | 1526-1526 | TS2532 | Object is possibly 'undefined'. |
| D1306 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1013:12 | 1527-1527 | TS2532 | Object is possibly 'undefined'. |
| D1307 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1014:12 | 1528-1528 | TS2532 | Object is possibly 'undefined'. |
| D1308 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1022:12 | 1529-1529 | TS2532 | Object is possibly 'undefined'. |
| D1309 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1029:12 | 1530-1530 | TS2532 | Object is possibly 'undefined'. |
| D1310 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1037:12 | 1531-1531 | TS2532 | Object is possibly 'undefined'. |
| D1311 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1038:12 | 1532-1532 | TS2532 | Object is possibly 'undefined'. |
| D1312 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1047:12 | 1533-1533 | TS2532 | Object is possibly 'undefined'. |
| D1313 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1048:12 | 1534-1534 | TS2532 | Object is possibly 'undefined'. |
| D1314 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1057:12 | 1535-1535 | TS2532 | Object is possibly 'undefined'. |
| D1315 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1065:12 | 1536-1536 | TS2532 | Object is possibly 'undefined'. |
| D1316 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1073:12 | 1537-1537 | TS2532 | Object is possibly 'undefined'. |
| D1317 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1079:12 | 1538-1538 | TS2532 | Object is possibly 'undefined'. |
| D1318 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1086:7 | 1539-1539 | TS2532 | Object is possibly 'undefined'. |
| D1319 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1105:20 | 1540-1540 | TS2532 | Object is possibly 'undefined'. |
| D1320 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1110:12 | 1541-1541 | TS2532 | Object is possibly 'undefined'. |
| D1321 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1123:12 | 1542-1542 | TS2532 | Object is possibly 'undefined'. |
| D1322 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1126:12 | 1543-1543 | TS2532 | Object is possibly 'undefined'. |
| D1323 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1127:27 | 1544-1544 | TS2532 | Object is possibly 'undefined'. |
| D1324 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1127:27 | 1545-1546 | TS2345 | Argument of type 'TableRow &#124; undefined' is not assignable to parameter of type 'TableRow'.<br>  Type 'undefined' is not assignable to type 'TableRow'. |
| D1325 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1147:12 | 1547-1547 | TS2532 | Object is possibly 'undefined'. |
| D1326 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1158:11 | 1548-1548 | TS2488 | Type '[sender: WhatsAppSender, params: FollowupButtonsSend] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D1327 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1172:12 | 1549-1549 | TS2532 | Object is possibly 'undefined'. |
| D1328 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1182:18 | 1550-1550 | TS2532 | Object is possibly 'undefined'. |
| D1329 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1182:18 | 1551-1551 | TS2532 | Object is possibly 'undefined'. |
| D1330 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1184:16 | 1552-1552 | TS2532 | Object is possibly 'undefined'. |
| D1331 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1185:12 | 1553-1553 | TS2532 | Object is possibly 'undefined'. |
| D1332 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1195:12 | 1554-1554 | TS2532 | Object is possibly 'undefined'. |
| D1333 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1257:20 | 1555-1555 | TS2532 | Object is possibly 'undefined'. |
| D1334 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1282:14 | 1556-1556 | TS2532 | Object is possibly 'undefined'. |
| D1335 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1283:29 | 1557-1557 | TS2532 | Object is possibly 'undefined'. |
| D1336 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1283:29 | 1558-1559 | TS2345 | Argument of type 'TableRow &#124; undefined' is not assignable to parameter of type 'TableRow'.<br>  Type 'undefined' is not assignable to type 'TableRow'. |
| D1337 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1304:12 | 1560-1560 | TS2532 | Object is possibly 'undefined'. |
| D1338 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1321:22 | 1561-1561 | TS2532 | Object is possibly 'undefined'. |
| D1339 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1321:22 | 1562-1562 | TS2532 | Object is possibly 'undefined'. |
| D1340 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1322:5 | 1563-1563 | TS18048 | 'first.db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1341 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1338:12 | 1564-1564 | TS2532 | Object is possibly 'undefined'. |
| D1342 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1356:34 | 1565-1565 | TS18048 | 'w.db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1343 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1375:12 | 1566-1566 | TS2532 | Object is possibly 'undefined'. |
| D1344 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1382:20 | 1567-1567 | TS2532 | Object is possibly 'undefined'. |
| D1345 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1391:23 | 1568-1568 | TS18048 | 'rows' is possibly 'undefined'. |
| D1346 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1408:12 | 1569-1569 | TS2532 | Object is possibly 'undefined'. |
| D1347 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1409:12 | 1570-1570 | TS2532 | Object is possibly 'undefined'. |
| D1348 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1418:12 | 1571-1571 | TS2532 | Object is possibly 'undefined'. |
| D1349 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1439:22 | 1572-1572 | TS18048 | 'w.db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1350 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1450:12 | 1573-1573 | TS2532 | Object is possibly 'undefined'. |
| D1351 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1463:12 | 1574-1574 | TS2532 | Object is possibly 'undefined'. |
| D1352 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1464:12 | 1575-1575 | TS2532 | Object is possibly 'undefined'. |
| D1353 | tests | `src/lib/owner-agent/consumer/reply.test.ts` | 1474:12 | 1576-1576 | TS2532 | Object is possibly 'undefined'. |
| D1354 | tests | `src/lib/owner-agent/consumer/retention.test.ts` | 170:12 | 1577-1577 | TS18048 | 'db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1355 | tests | `src/lib/owner-agent/consumer/retention.test.ts` | 252:14 | 1578-1578 | TS2532 | Object is possibly 'undefined'. |
| D1356 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 45:12 | 1579-1579 | TS18048 | 'db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1357 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 45:12 | 1580-1580 | TS2532 | Object is possibly 'undefined'. |
| D1358 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 47:12 | 1581-1581 | TS18048 | 'db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1359 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 47:12 | 1582-1582 | TS2532 | Object is possibly 'undefined'. |
| D1360 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 55:12 | 1583-1583 | TS18048 | 'db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1361 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 61:12 | 1584-1584 | TS18048 | 'db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1362 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 61:12 | 1585-1585 | TS2532 | Object is possibly 'undefined'. |
| D1363 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 63:12 | 1586-1586 | TS18048 | 'db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1364 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 63:12 | 1587-1587 | TS2532 | Object is possibly 'undefined'. |
| D1365 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 153:12 | 1588-1588 | TS18048 | 'db.tables.owner_agent_audit' is possibly 'undefined'. |
| D1366 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 267:37 | 1589-1589 | TS18048 | 'db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1367 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 316:12 | 1590-1590 | TS18048 | 'db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1368 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 317:12 | 1591-1591 | TS18048 | 'db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1369 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 317:12 | 1592-1592 | TS2532 | Object is possibly 'undefined'. |
| D1370 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 333:12 | 1593-1593 | TS18048 | 'db.tables.owner_agent_audit' is possibly 'undefined'. |
| D1371 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 341:12 | 1594-1594 | TS18048 | 'db.tables.app_settings' is possibly 'undefined'. |
| D1372 | tests | `src/lib/owner-agent/consumer/store.test.ts` | 341:12 | 1595-1595 | TS2532 | Object is possibly 'undefined'. |
| D1373 | tests | `src/lib/owner-agent/consumer/sweep.test.ts` | 84:39 | 1596-1596 | TS18048 | 'db.tables.owner_agent_intake' is possibly 'undefined'. |
| D1374 | tests | `src/lib/owner-agent/consumer/sweep.test.ts` | 96:12 | 1597-1597 | TS18048 | 'db.tables.owner_agent_audit' is possibly 'undefined'. |
| D1375 | tests | `src/lib/owner-agent/consumer/sweep.test.ts` | 107:30 | 1598-1598 | TS18048 | 'db.tables.owner_agent_audit' is possibly 'undefined'. |
| D1376 | tests | `src/lib/owner-agent/cores/billing.test.ts` | 183:24 | 1599-1599 | TS2532 | Object is possibly 'undefined'. |
| D1377 | backend | `src/lib/owner-agent/cores/billing.ts` | 80:30 | 1600-1600 | TS18048 | 'row' is possibly 'undefined'. |
| D1378 | backend | `src/lib/owner-agent/cores/billing.ts` | 81:36 | 1601-1601 | TS18048 | 'row' is possibly 'undefined'. |
| D1379 | backend | `src/lib/owner-agent/cores/billing.ts` | 82:37 | 1602-1602 | TS18048 | 'row' is possibly 'undefined'. |
| D1380 | backend | `src/lib/owner-agent/cores/billing.ts` | 83:36 | 1603-1603 | TS18048 | 'row' is possibly 'undefined'. |
| D1381 | tests | `src/lib/owner-agent/cores/campaigns.test.ts` | 122:12 | 1604-1604 | TS2532 | Object is possibly 'undefined'. |
| D1382 | tests | `src/lib/owner-agent/cores/inquiries.test.ts` | 83:29 | 1605-1605 | TS2532 | Object is possibly 'undefined'. |
| D1383 | backend | `src/lib/owner-agent/cores/rsvp.ts` | 68:34 | 1606-1606 | TS18048 | 'row' is possibly 'undefined'. |
| D1384 | backend | `src/lib/owner-agent/cores/rsvp.ts` | 68:79 | 1607-1607 | TS18048 | 'row' is possibly 'undefined'. |
| D1385 | tests | `src/lib/owner-agent/cores/web-traffic.test.ts` | 103:17 | 1608-1608 | TS2532 | Object is possibly 'undefined'. |
| D1386 | tests | `src/lib/owner-agent/cores/web-traffic.test.ts` | 106:12 | 1609-1609 | TS2532 | Object is possibly 'undefined'. |
| D1387 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 112:5 | 1610-1611 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1388 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 113:5 | 1612-1613 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1389 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 114:5 | 1614-1615 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1390 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 115:5 | 1616-1617 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1391 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 116:5 | 1618-1619 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1392 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 117:5 | 1620-1621 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1393 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 118:5 | 1622-1623 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1394 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 119:5 | 1624-1625 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1395 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 120:5 | 1626-1627 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1396 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 121:5 | 1628-1629 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1397 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 122:5 | 1630-1631 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1398 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 123:5 | 1632-1633 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1399 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 124:24 | 1634-1634 | TS18048 | 'failed' is possibly 'undefined'. |
| D1400 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 129:7 | 1635-1636 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1401 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 130:7 | 1637-1638 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1402 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 131:7 | 1639-1640 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1403 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 132:7 | 1641-1642 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1404 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 133:7 | 1643-1644 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1405 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 134:7 | 1645-1646 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1406 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 135:32 | 1647-1647 | TS18048 | 'total' is possibly 'undefined'. |
| D1407 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 135:41 | 1648-1648 | TS18048 | 'unacknowledged' is possibly 'undefined'. |
| D1408 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 135:58 | 1649-1649 | TS18048 | 'sent' is possibly 'undefined'. |
| D1409 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 135:65 | 1650-1650 | TS18048 | 'delivered' is possibly 'undefined'. |
| D1410 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 135:77 | 1651-1651 | TS18048 | 'read' is possibly 'undefined'. |
| D1411 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 135:84 | 1652-1652 | TS18048 | 'failed' is possibly 'undefined'. |
| D1412 | backend | `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 137:5 | 1653-1654 | TS2322 | Type 'number &#124; undefined' is not assignable to type 'number'.<br>  Type 'undefined' is not assignable to type 'number'. |
| D1413 | tests | `src/lib/owner-agent/delivery.test.ts` | 69:19 | 1655-1655 | TS2532 | Object is possibly 'undefined'. |
| D1414 | tests | `src/lib/owner-agent/delivery.test.ts` | 77:17 | 1656-1656 | TS2532 | Object is possibly 'undefined'. |
| D1415 | tests | `src/lib/owner-agent/intake.test.ts` | 228:12 | 1657-1657 | TS2532 | Object is possibly 'undefined'. |
| D1416 | tests | `src/lib/owner-agent/intake.test.ts` | 260:19 | 1658-1658 | TS2532 | Object is possibly 'undefined'. |
| D1417 | tests | `src/lib/owner-agent/intake.test.ts` | 271:12 | 1659-1659 | TS2532 | Object is possibly 'undefined'. |
| D1418 | tests | `src/lib/owner-agent/intake.test.ts` | 401:19 | 1660-1660 | TS2532 | Object is possibly 'undefined'. |
| D1419 | tests | `src/lib/owner-agent/intake.test.ts` | 402:95 | 1661-1661 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D1420 | tests | `src/lib/owner-agent/intake.test.ts` | 414:12 | 1662-1662 | TS2532 | Object is possibly 'undefined'. |
| D1421 | tests | `src/lib/owner-agent/intake.test.ts` | 415:12 | 1663-1663 | TS2532 | Object is possibly 'undefined'. |
| D1422 | tests | `src/lib/owner-agent/intake.test.ts` | 428:12 | 1664-1664 | TS2532 | Object is possibly 'undefined'. |
| D1423 | tests | `src/lib/owner-agent/intake.test.ts` | 488:12 | 1665-1665 | TS2532 | Object is possibly 'undefined'. |
| D1424 | tests | `src/lib/owner-agent/intake.test.ts` | 577:12 | 1666-1666 | TS2532 | Object is possibly 'undefined'. |
| D1425 | tests | `src/lib/owner-agent/intake.test.ts` | 583:12 | 1667-1667 | TS2532 | Object is possibly 'undefined'. |
| D1426 | tests | `src/lib/owner-agent/intake.test.ts` | 783:12 | 1668-1668 | TS2532 | Object is possibly 'undefined'. |
| D1427 | tests | `src/lib/owner-agent/intake.test.ts` | 784:12 | 1669-1669 | TS2532 | Object is possibly 'undefined'. |
| D1428 | tests | `src/lib/owner-agent/intake.test.ts` | 819:19 | 1670-1670 | TS2532 | Object is possibly 'undefined'. |
| D1429 | tests | `src/lib/owner-agent/intake.test.ts` | 826:5 | 1671-1674 | TS2322 | Type '{ bsuid: string; bsuid_bound_at: string; bound_from_e164: string; id?: string &#124; undefined; e164?: string &#124; undefined; staff_user_id?: string &#124; null &#124; undefined; enabled?: boolean &#124; undefined; approval_kind?: string; parent_bsuid?: string &#124; null; }' is not assignable to type 'FakeAllowlistRow'.<br>  Types of property 'id' are incompatible.<br>    Type 'string &#124; undefined' is not assignable to type 'string'.<br>      Type 'undefined' is not assignable to type 'string'. |
| D1430 | tests | `src/lib/owner-agent/intake.test.ts` | 828:12 | 1675-1675 | TS2532 | Object is possibly 'undefined'. |
| D1431 | tests | `src/lib/owner-agent/intake.test.ts` | 900:5 | 1676-1676 | TS2532 | Object is possibly 'undefined'. |
| D1432 | tests | `src/lib/owner-agent/intake.test.ts` | 915:12 | 1677-1677 | TS2532 | Object is possibly 'undefined'. |
| D1433 | tests | `src/lib/owner-agent/intake.test.ts` | 921:5 | 1678-1678 | TS2532 | Object is possibly 'undefined'. |
| D1434 | tests | `src/lib/owner-agent/intake.test.ts` | 926:12 | 1679-1679 | TS2532 | Object is possibly 'undefined'. |
| D1435 | tests | `src/lib/owner-agent/intake.test.ts` | 927:12 | 1680-1680 | TS2532 | Object is possibly 'undefined'. |
| D1436 | tests | `src/lib/owner-agent/intake.test.ts` | 933:19 | 1681-1681 | TS2532 | Object is possibly 'undefined'. |
| D1437 | tests | `src/lib/owner-agent/intake.test.ts` | 949:12 | 1682-1682 | TS2532 | Object is possibly 'undefined'. |
| D1438 | tests | `src/lib/owner-agent/intake.test.ts` | 970:19 | 1683-1683 | TS2532 | Object is possibly 'undefined'. |
| D1439 | tests | `src/lib/owner-agent/intake.test.ts` | 995:12 | 1684-1684 | TS2532 | Object is possibly 'undefined'. |
| D1440 | tests | `src/lib/owner-agent/intake.test.ts` | 1005:12 | 1685-1685 | TS2532 | Object is possibly 'undefined'. |
| D1441 | tests | `src/lib/owner-agent/intake.test.ts` | 1010:12 | 1686-1686 | TS2532 | Object is possibly 'undefined'. |
| D1442 | tests | `src/lib/owner-agent/mcp/server.test.ts` | 83:10 | 1687-1687 | TS2532 | Object is possibly 'undefined'. |
| D1443 | tests | `src/lib/owner-agent/mcp/server.test.ts` | 84:10 | 1688-1688 | TS2532 | Object is possibly 'undefined'. |
| D1444 | tests | `src/lib/owner-agent/reports/model-content.test.ts` | 46:19 | 1689-1689 | TS2532 | Object is possibly 'undefined'. |
| D1445 | tests | `src/lib/owner-agent/reports/report.test.ts` | 219:12 | 1690-1690 | TS2532 | Object is possibly 'undefined'. |
| D1446 | tests | `src/lib/owner-agent/reports/report.test.ts` | 391:12 | 1691-1691 | TS2532 | Object is possibly 'undefined'. |
| D1447 | tests | `src/lib/owner-agent/reports/report.test.ts` | 476:12 | 1692-1692 | TS2532 | Object is possibly 'undefined'. |
| D1448 | tests | `src/lib/owner-agent/reports/report.test.ts` | 486:12 | 1693-1693 | TS2532 | Object is possibly 'undefined'. |
| D1449 | tests | `src/lib/owner-agent/reports/report.test.ts` | 504:12 | 1694-1694 | TS2532 | Object is possibly 'undefined'. |
| D1450 | tests | `src/lib/owner-agent/reports/report.test.ts` | 524:12 | 1695-1695 | TS2532 | Object is possibly 'undefined'. |
| D1451 | tests | `src/lib/owner-agent/reports/report.test.ts` | 536:12 | 1696-1696 | TS2532 | Object is possibly 'undefined'. |
| D1452 | tests | `src/lib/owner-agent/reports/report.test.ts` | 553:12 | 1697-1697 | TS2532 | Object is possibly 'undefined'. |
| D1453 | tests | `src/lib/owner-agent/reports/report.test.ts` | 587:12 | 1698-1698 | TS2532 | Object is possibly 'undefined'. |
| D1454 | tests | `src/lib/owner-agent/reports/report.test.ts` | 600:12 | 1699-1699 | TS2532 | Object is possibly 'undefined'. |
| D1455 | tests | `src/lib/owner-agent/reports/report.test.ts` | 613:19 | 1700-1700 | TS2532 | Object is possibly 'undefined'. |
| D1456 | tests | `src/lib/owner-agent/reports/report.test.ts` | 631:12 | 1701-1701 | TS2532 | Object is possibly 'undefined'. |
| D1457 | tests | `src/lib/owner-agent/reports/store.test.ts` | 33:12 | 1702-1702 | TS18048 | 'fake.tables.owner_agent_report_run' is possibly 'undefined'. |
| D1458 | tests | `src/lib/owner-agent/reports/store.test.ts` | 33:12 | 1703-1703 | TS2532 | Object is possibly 'undefined'. |
| D1459 | tests | `src/lib/owner-agent/reports/store.test.ts` | 35:12 | 1704-1704 | TS18048 | 'fake.tables.owner_agent_report_run' is possibly 'undefined'. |
| D1460 | tests | `src/lib/owner-agent/reports/store.test.ts` | 209:12 | 1705-1705 | TS18048 | 'fake.tables.owner_agent_audit' is possibly 'undefined'. |
| D1461 | tests | `src/lib/owner-agent/reports/tick.test.ts` | 137:12 | 1706-1706 | TS2532 | Object is possibly 'undefined'. |
| D1462 | tests | `src/lib/owner-agent/runner.test.ts` | 260:12 | 1707-1707 | TS18048 | 'call' is possibly 'undefined'. |
| D1463 | tests | `src/lib/owner-agent/runner.test.ts` | 261:12 | 1708-1708 | TS18048 | 'call' is possibly 'undefined'. |
| D1464 | tests | `src/lib/owner-agent/runner.test.ts` | 266:12 | 1709-1709 | TS18048 | 'call' is possibly 'undefined'. |
| D1465 | tests | `src/lib/owner-agent/runner.test.ts` | 277:12 | 1710-1710 | TS18048 | 'call' is possibly 'undefined'. |
| D1466 | tests | `src/lib/owner-agent/runner.test.ts` | 277:22 | 1711-1711 | TS18048 | 'call' is possibly 'undefined'. |
| D1467 | tests | `src/lib/owner-agent/runner.test.ts` | 298:19 | 1712-1712 | TS18048 | 'call' is possibly 'undefined'. |
| D1468 | tests | `src/lib/owner-agent/runner.test.ts` | 300:12 | 1713-1713 | TS18048 | 'call' is possibly 'undefined'. |
| D1469 | tests | `src/lib/owner-agent/runner.test.ts` | 301:12 | 1714-1714 | TS18048 | 'call' is possibly 'undefined'. |
| D1470 | tests | `src/lib/owner-agent/runner.test.ts` | 302:12 | 1715-1715 | TS18048 | 'call' is possibly 'undefined'. |
| D1471 | tests | `src/lib/owner-agent/runner.test.ts` | 303:12 | 1716-1716 | TS18048 | 'call' is possibly 'undefined'. |
| D1472 | tests | `src/lib/owner-agent/runner.test.ts` | 306:14 | 1717-1717 | TS18048 | 'call' is possibly 'undefined'. |
| D1473 | tests | `src/lib/owner-agent/runner.test.ts` | 308:28 | 1718-1718 | TS18048 | 'call' is possibly 'undefined'. |
| D1474 | tests | `src/lib/owner-agent/runner.test.ts` | 308:28 | 1719-1720 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1475 | tests | `src/lib/owner-agent/runner.test.ts` | 308:38 | 1721-1721 | TS18048 | 'call' is possibly 'undefined'. |
| D1476 | tests | `src/lib/owner-agent/runner.test.ts` | 313:16 | 1722-1722 | TS18048 | 'mcp.mcpServers.supabase' is possibly 'undefined'. |
| D1477 | tests | `src/lib/owner-agent/runner.test.ts` | 321:12 | 1723-1723 | TS18048 | 'call' is possibly 'undefined'. |
| D1478 | tests | `src/lib/owner-agent/runner.test.ts` | 322:12 | 1724-1724 | TS18048 | 'call' is possibly 'undefined'. |
| D1479 | tests | `src/lib/owner-agent/runner.test.ts` | 328:12 | 1725-1725 | TS18048 | 'call' is possibly 'undefined'. |
| D1480 | tests | `src/lib/owner-agent/runner.test.ts` | 329:12 | 1726-1726 | TS18048 | 'call' is possibly 'undefined'. |
| D1481 | tests | `src/lib/owner-agent/runner.test.ts` | 330:12 | 1727-1727 | TS18048 | 'call' is possibly 'undefined'. |
| D1482 | tests | `src/lib/owner-agent/runner.test.ts` | 335:12 | 1728-1728 | TS18048 | 'call' is possibly 'undefined'. |
| D1483 | tests | `src/lib/owner-agent/runner.test.ts` | 340:12 | 1729-1729 | TS18048 | 'call' is possibly 'undefined'. |
| D1484 | tests | `src/lib/owner-agent/runner.test.ts` | 341:12 | 1730-1730 | TS18048 | 'call' is possibly 'undefined'. |
| D1485 | tests | `src/lib/owner-agent/runner.test.ts` | 348:12 | 1731-1731 | TS18048 | 'call' is possibly 'undefined'. |
| D1486 | tests | `src/lib/owner-agent/runner.test.ts` | 356:12 | 1732-1732 | TS18048 | 'call' is possibly 'undefined'. |
| D1487 | tests | `src/lib/owner-agent/runner.test.ts` | 363:12 | 1733-1733 | TS18048 | 'call' is possibly 'undefined'. |
| D1488 | tests | `src/lib/owner-agent/runner.test.ts` | 371:12 | 1734-1734 | TS18048 | 'call' is possibly 'undefined'. |
| D1489 | tests | `src/lib/owner-agent/runner.test.ts` | 372:12 | 1735-1735 | TS18048 | 'call' is possibly 'undefined'. |
| D1490 | tests | `src/lib/owner-agent/runner.test.ts` | 373:12 | 1736-1736 | TS18048 | 'call' is possibly 'undefined'. |
| D1491 | tests | `src/lib/owner-agent/runner.test.ts` | 375:28 | 1737-1737 | TS18048 | 'call' is possibly 'undefined'. |
| D1492 | tests | `src/lib/owner-agent/runner.test.ts` | 375:28 | 1738-1739 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1493 | tests | `src/lib/owner-agent/runner.test.ts` | 375:38 | 1740-1740 | TS18048 | 'call' is possibly 'undefined'. |
| D1494 | tests | `src/lib/owner-agent/runner.test.ts` | 378:12 | 1741-1741 | TS18048 | 'mcp.mcpServers.owner_agent' is possibly 'undefined'. |
| D1495 | tests | `src/lib/owner-agent/runner.test.ts` | 379:12 | 1742-1742 | TS18048 | 'mcp.mcpServers.supabase' is possibly 'undefined'. |
| D1496 | tests | `src/lib/owner-agent/runner.test.ts` | 407:12 | 1743-1743 | TS18048 | 'call' is possibly 'undefined'. |
| D1497 | tests | `src/lib/owner-agent/runner.test.ts` | 663:16 | 1744-1744 | TS18048 | 'call' is possibly 'undefined'. |
| D1498 | tests | `src/lib/owner-agent/runner.test.ts` | 664:12 | 1745-1745 | TS18048 | 'call' is possibly 'undefined'. |
| D1499 | tests | `src/lib/owner-agent/runner.test.ts` | 665:12 | 1746-1746 | TS18048 | 'call' is possibly 'undefined'. |
| D1500 | tests | `src/lib/owner-agent/runner.test.ts` | 666:12 | 1747-1747 | TS18048 | 'call' is possibly 'undefined'. |
| D1501 | tests | `src/lib/owner-agent/runner.test.ts` | 667:12 | 1748-1748 | TS18048 | 'call' is possibly 'undefined'. |
| D1502 | tests | `src/lib/owner-agent/runner.test.ts` | 668:23 | 1749-1749 | TS18048 | 'call' is possibly 'undefined'. |
| D1503 | tests | `src/lib/owner-agent/runner.test.ts` | 680:21 | 1750-1750 | TS18048 | 'call' is possibly 'undefined'. |
| D1504 | tests | `src/lib/owner-agent/runner.test.ts` | 691:33 | 1751-1751 | TS18048 | 'call' is possibly 'undefined'. |
| D1505 | tests | `src/lib/owner-agent/runner.test.ts` | 698:12 | 1752-1752 | TS18048 | 'call' is possibly 'undefined'. |
| D1506 | tests | `src/lib/owner-agent/runner.test.ts` | 699:12 | 1753-1753 | TS18048 | 'call' is possibly 'undefined'. |
| D1507 | tests | `src/lib/owner-agent/runner.test.ts` | 699:28 | 1754-1754 | TS18048 | 'call' is possibly 'undefined'. |
| D1508 | tests | `src/lib/owner-agent/runner.test.ts` | 699:59 | 1755-1755 | TS18048 | 'call' is possibly 'undefined'. |
| D1509 | tests | `src/lib/owner-agent/runner.test.ts` | 705:14 | 1756-1756 | TS18048 | 'call' is possibly 'undefined'. |
| D1510 | tests | `src/lib/owner-agent/runner.test.ts` | 706:14 | 1757-1757 | TS18048 | 'call' is possibly 'undefined'. |
| D1511 | tests | `src/lib/owner-agent/runner.test.ts` | 707:14 | 1758-1758 | TS18048 | 'call' is possibly 'undefined'. |
| D1512 | tests | `src/lib/owner-agent/runner.test.ts` | 737:16 | 1759-1759 | TS18048 | 'call' is possibly 'undefined'. |
| D1513 | tests | `src/lib/owner-agent/runner.test.ts` | 738:12 | 1760-1760 | TS18048 | 'call' is possibly 'undefined'. |
| D1514 | tests | `src/lib/owner-agent/runner.test.ts` | 744:12 | 1761-1761 | TS18048 | 'call' is possibly 'undefined'. |
| D1515 | tests | `src/lib/owner-agent/runner.test.ts` | 744:22 | 1762-1762 | TS18048 | 'call' is possibly 'undefined'. |
| D1516 | tests | `src/lib/owner-agent/runner.test.ts` | 749:12 | 1763-1763 | TS18048 | 'call' is possibly 'undefined'. |
| D1517 | tests | `src/lib/owner-agent/runner.test.ts` | 750:12 | 1764-1764 | TS18048 | 'call' is possibly 'undefined'. |
| D1518 | tests | `src/lib/owner-agent/runner.test.ts` | 750:22 | 1765-1765 | TS18048 | 'call' is possibly 'undefined'. |
| D1519 | tests | `src/lib/owner-agent/runner.test.ts` | 812:12 | 1766-1766 | TS18048 | 'call' is possibly 'undefined'. |
| D1520 | tests | `src/lib/owner-agent/runner.test.ts` | 813:12 | 1767-1767 | TS18048 | 'call' is possibly 'undefined'. |
| D1521 | tests | `src/lib/owner-agent/runner.test.ts` | 814:12 | 1768-1768 | TS18048 | 'call' is possibly 'undefined'. |
| D1522 | tests | `src/lib/owner-agent/runner.test.ts` | 821:14 | 1769-1769 | TS18048 | 'call' is possibly 'undefined'. |
| D1523 | tests | `src/lib/owner-agent/runner.test.ts` | 827:12 | 1770-1770 | TS18048 | 'call' is possibly 'undefined'. |
| D1524 | backend | `src/lib/owner-agent/runner.ts` | 421:17 | 1771-1771 | TS2532 | Object is possibly 'undefined'. |
| D1525 | tests | `src/lib/owner-agent/tools/tools.test.ts` | 390:31 | 1772-1773 | TS2322 | Type 'JsonNode &#124; undefined' is not assignable to type 'JsonNode'.<br>  Type 'undefined' is not assignable to type 'JsonNode'. |
| D1526 | tests | `src/lib/owner-agent/tools/tools.test.ts` | 425:12 | 1774-1774 | TS18048 | 'props.range' is possibly 'undefined'. |
| D1527 | tests | `src/lib/owner-agent/tools/tools.test.ts` | 426:12 | 1775-1775 | TS18048 | 'props.range' is possibly 'undefined'. |
| D1528 | tests | `src/lib/owner-agent/tools/tools.test.ts` | 427:25 | 1776-1776 | TS18048 | 'props.range' is possibly 'undefined'. |
| D1529 | tests | `src/lib/owner-agent/tools/tools.test.ts` | 427:52 | 1777-1777 | TS18048 | 'props.range' is possibly 'undefined'. |
| D1530 | tests | `src/lib/payments/campaign-payments-view.test.ts` | 38:22 | 1778-1778 | TS2532 | Object is possibly 'undefined'. |
| D1531 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 161:9 | 1779-1779 | TS2532 | Object is possibly 'undefined'. |
| D1532 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 233:108 | 1780-1780 | TS2532 | Object is possibly 'undefined'. |
| D1533 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 238:18 | 1781-1781 | TS2532 | Object is possibly 'undefined'. |
| D1534 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 244:20 | 1782-1782 | TS2532 | Object is possibly 'undefined'. |
| D1535 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 248:12 | 1783-1783 | TS2532 | Object is possibly 'undefined'. |
| D1536 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 253:18 | 1784-1784 | TS2532 | Object is possibly 'undefined'. |
| D1537 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 255:50 | 1785-1785 | TS2532 | Object is possibly 'undefined'. |
| D1538 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 261:12 | 1786-1786 | TS2532 | Object is possibly 'undefined'. |
| D1539 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 267:12 | 1787-1787 | TS2532 | Object is possibly 'undefined'. |
| D1540 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 275:12 | 1788-1788 | TS2532 | Object is possibly 'undefined'. |
| D1541 | tests | `src/lib/payments/cardcom-purchase.test.ts` | 290:7 | 1789-1789 | TS2532 | Object is possibly 'undefined'. |
| D1542 | tests | `src/lib/payments/cardcom-refund.test.ts` | 83:19 | 1790-1790 | TS2532 | Object is possibly 'undefined'. |
| D1543 | tests | `src/lib/payments/cardcom-refund.test.ts` | 88:19 | 1791-1791 | TS2532 | Object is possibly 'undefined'. |
| D1544 | tests | `src/lib/payments/cardcom-refund.test.ts` | 136:19 | 1792-1792 | TS2532 | Object is possibly 'undefined'. |
| D1545 | tests | `src/lib/payments/cardcom-refund.test.ts` | 159:21 | 1793-1794 | TS2345 | Argument of type 'number &#124; undefined' is not assignable to parameter of type 'number &#124; bigint'.<br>  Type 'undefined' is not assignable to type 'number &#124; bigint'. |
| D1546 | tests | `src/lib/payments/cardcom-refund.test.ts` | 190:12 | 1795-1795 | TS2532 | Object is possibly 'undefined'. |
| D1547 | tests | `src/lib/payments/cardcom-refund.test.ts` | 240:12 | 1796-1796 | TS2532 | Object is possibly 'undefined'. |
| D1548 | tests | `src/lib/payments/cardcom-refund.test.ts` | 262:12 | 1797-1797 | TS2532 | Object is possibly 'undefined'. |
| D1549 | tests | `src/lib/payments/cardcom-refund.test.ts` | 376:12 | 1798-1798 | TS2532 | Object is possibly 'undefined'. |
| D1550 | tests | `src/lib/payments/cardcom-refund.test.ts` | 401:12 | 1799-1799 | TS2532 | Object is possibly 'undefined'. |
| D1551 | tests | `src/lib/payments/cardcom-refund.test.ts` | 415:12 | 1800-1800 | TS2532 | Object is possibly 'undefined'. |
| D1552 | tests | `src/lib/payments/cardcom-refund.test.ts` | 442:12 | 1801-1801 | TS2532 | Object is possibly 'undefined'. |
| D1553 | tests | `src/lib/payments/cardcom-refund.test.ts` | 444:12 | 1802-1802 | TS2532 | Object is possibly 'undefined'. |
| D1554 | tests | `src/lib/payments/cardcom-refund.test.ts` | 452:12 | 1803-1803 | TS2532 | Object is possibly 'undefined'. |
| D1555 | tests | `src/lib/payments/cardcom-refund.test.ts` | 491:12 | 1804-1804 | TS2532 | Object is possibly 'undefined'. |
| D1556 | tests | `src/lib/payments/cardcom-refund.test.ts` | 512:12 | 1805-1805 | TS2532 | Object is possibly 'undefined'. |
| D1557 | tests | `src/lib/payments/cardcom-settle.test.ts` | 84:12 | 1806-1806 | TS2532 | Object is possibly 'undefined'. |
| D1558 | tests | `src/lib/payments/cardcom-settle.test.ts` | 85:12 | 1807-1807 | TS2532 | Object is possibly 'undefined'. |
| D1559 | tests | `src/lib/payments/cardcom-settle.test.ts` | 109:14 | 1808-1808 | TS2532 | Object is possibly 'undefined'. |
| D1560 | tests | `src/lib/payments/cardcom-settle.test.ts` | 110:14 | 1809-1809 | TS2532 | Object is possibly 'undefined'. |
| D1561 | tests | `src/lib/payments/cardcom-settle.test.ts` | 122:14 | 1810-1810 | TS2532 | Object is possibly 'undefined'. |
| D1562 | tests | `src/lib/payments/cardcom-settle.test.ts` | 128:14 | 1811-1811 | TS2532 | Object is possibly 'undefined'. |
| D1563 | tests | `src/lib/payments/cardcom-settle.test.ts` | 134:14 | 1812-1812 | TS2532 | Object is possibly 'undefined'. |
| D1564 | tests | `src/lib/payments/cardcom-settle.test.ts` | 152:138 | 1813-1813 | TS2532 | Object is possibly 'undefined'. |
| D1565 | tests | `src/lib/payments/cardcom-settle.test.ts` | 187:7 | 1814-1814 | TS2532 | Object is possibly 'undefined'. |
| D1566 | tests | `src/lib/payments/cardcom-settle.test.ts` | 225:12 | 1815-1815 | TS2532 | Object is possibly 'undefined'. |
| D1567 | tests | `src/lib/payments/cardcom-settle.test.ts` | 226:12 | 1816-1816 | TS2532 | Object is possibly 'undefined'. |
| D1568 | tests | `src/lib/payments/cardcom-settle.test.ts` | 234:12 | 1817-1817 | TS2532 | Object is possibly 'undefined'. |
| D1569 | tests | `src/lib/payments/cardcom-settle.test.ts` | 258:12 | 1818-1818 | TS2532 | Object is possibly 'undefined'. |
| D1570 | tests | `src/lib/payments/cardcom-settle.test.ts` | 259:12 | 1819-1819 | TS2532 | Object is possibly 'undefined'. |
| D1571 | tests | `src/lib/payments/cardcom-settle.test.ts` | 266:142 | 1820-1820 | TS2532 | Object is possibly 'undefined'. |
| D1572 | tests | `src/lib/payments/cardcom-settle.test.ts` | 280:12 | 1821-1821 | TS2532 | Object is possibly 'undefined'. |
| D1573 | tests | `src/lib/payments/cardcom-settle.test.ts` | 291:12 | 1822-1822 | TS2532 | Object is possibly 'undefined'. |
| D1574 | tests | `src/lib/payments/cardcom-settle.test.ts` | 300:25 | 1823-1823 | TS2532 | Object is possibly 'undefined'. |
| D1575 | tests | `src/lib/payments/cardcom-settle.test.ts` | 311:19 | 1824-1824 | TS2532 | Object is possibly 'undefined'. |
| D1576 | tests | `src/lib/payments/cardcom-settle.test.ts` | 312:19 | 1825-1825 | TS2532 | Object is possibly 'undefined'. |
| D1577 | tests | `src/lib/payments/cardcom-settle.test.ts` | 318:19 | 1826-1826 | TS2532 | Object is possibly 'undefined'. |
| D1578 | tests | `src/lib/payments/cardcom-settle.test.ts` | 319:19 | 1827-1827 | TS2532 | Object is possibly 'undefined'. |
| D1579 | tests | `src/lib/payments/cardcom-settle.test.ts` | 328:19 | 1828-1828 | TS2532 | Object is possibly 'undefined'. |
| D1580 | tests | `src/lib/payments/cardcom-settle.test.ts` | 329:19 | 1829-1829 | TS2532 | Object is possibly 'undefined'. |
| D1581 | tests | `src/lib/payments/cardcom-settle.test.ts` | 336:19 | 1830-1830 | TS2532 | Object is possibly 'undefined'. |
| D1582 | tests | `src/lib/payments/cardcom-settle.test.ts` | 348:12 | 1831-1831 | TS2532 | Object is possibly 'undefined'. |
| D1583 | tests | `src/lib/payments/cardcom-settle.test.ts` | 354:12 | 1832-1832 | TS2532 | Object is possibly 'undefined'. |
| D1584 | tests | `src/lib/payments/cardcom-settle.test.ts` | 360:19 | 1833-1833 | TS2532 | Object is possibly 'undefined'. |
| D1585 | tests | `src/lib/payments/cardcom-settle.test.ts` | 366:12 | 1834-1834 | TS2532 | Object is possibly 'undefined'. |
| D1586 | tests | `src/lib/payments/cardcom-settle.test.ts` | 381:12 | 1835-1835 | TS2532 | Object is possibly 'undefined'. |
| D1587 | tests | `src/lib/payments/cardcom-settle.test.ts` | 421:12 | 1836-1836 | TS2532 | Object is possibly 'undefined'. |
| D1588 | tests | `src/lib/payments/cardcom-settle.test.ts` | 428:12 | 1837-1837 | TS2532 | Object is possibly 'undefined'. |
| D1589 | tests | `src/lib/payments/cardcom-settle.test.ts` | 434:12 | 1838-1838 | TS2532 | Object is possibly 'undefined'. |
| D1590 | tests | `src/lib/payments/cardcom-settle.test.ts` | 449:12 | 1839-1839 | TS2532 | Object is possibly 'undefined'. |
| D1591 | tests | `src/lib/payments/cardcom-settle.test.ts` | 489:14 | 1840-1840 | TS2532 | Object is possibly 'undefined'. |
| D1592 | tests | `src/lib/payments/cardcom-settle.test.ts` | 494:14 | 1841-1841 | TS2532 | Object is possibly 'undefined'. |
| D1593 | tests | `src/lib/payments/cardcom-settle.test.ts` | 495:14 | 1842-1842 | TS2532 | Object is possibly 'undefined'. |
| D1594 | tests | `src/lib/payments/cardcom-settle.test.ts` | 503:16 | 1843-1843 | TS2532 | Object is possibly 'undefined'. |
| D1595 | tests | `src/lib/payments/cardcom-settle.test.ts` | 514:21 | 1844-1844 | TS2532 | Object is possibly 'undefined'. |
| D1596 | tests | `src/lib/payments/cardcom-settle.test.ts` | 515:21 | 1845-1845 | TS2532 | Object is possibly 'undefined'. |
| D1597 | tests | `src/lib/payments/cardcom-settle.test.ts` | 551:14 | 1846-1846 | TS2532 | Object is possibly 'undefined'. |
| D1598 | tests | `src/lib/payments/cardcom-settle.test.ts` | 552:21 | 1847-1847 | TS2532 | Object is possibly 'undefined'. |
| D1599 | tests | `src/lib/payments/cardcom-settle.test.ts` | 591:14 | 1848-1848 | TS2532 | Object is possibly 'undefined'. |
| D1600 | tests | `src/lib/payments/cardcom-settle.test.ts` | 630:14 | 1849-1849 | TS2532 | Object is possibly 'undefined'. |
| D1601 | tests | `src/lib/payments/cardcom-settle.test.ts` | 631:21 | 1850-1850 | TS2532 | Object is possibly 'undefined'. |
| D1602 | tests | `src/lib/payments/cardcom-settle.test.ts` | 632:21 | 1851-1851 | TS2532 | Object is possibly 'undefined'. |
| D1603 | tests | `src/lib/payments/cardcom-settle.test.ts` | 649:14 | 1852-1852 | TS2532 | Object is possibly 'undefined'. |
| D1604 | tests | `src/lib/payments/cardcom-settle.test.ts` | 668:19 | 1853-1853 | TS2532 | Object is possibly 'undefined'. |
| D1605 | tests | `src/lib/payments/cardcom-settle.test.ts` | 674:19 | 1854-1854 | TS2532 | Object is possibly 'undefined'. |
| D1606 | tests | `src/lib/payments/cardcom-settle.test.ts` | 680:19 | 1855-1855 | TS2532 | Object is possibly 'undefined'. |
| D1607 | tests | `src/lib/payments/cardcom-settle.test.ts` | 686:19 | 1856-1856 | TS2532 | Object is possibly 'undefined'. |
| D1608 | tests | `src/lib/payments/cardcom-settle.test.ts` | 704:19 | 1857-1857 | TS2532 | Object is possibly 'undefined'. |
| D1609 | tests | `src/lib/payments/cardcom-settle.test.ts` | 711:19 | 1858-1858 | TS2532 | Object is possibly 'undefined'. |
| D1610 | tests | `src/lib/payments/cardcom-settle.test.ts` | 718:19 | 1859-1859 | TS2532 | Object is possibly 'undefined'. |
| D1611 | tests | `src/lib/payments/ledger.test.ts` | 49:12 | 1860-1860 | TS2532 | Object is possibly 'undefined'. |
| D1612 | tests | `src/lib/payments/ledger.test.ts` | 60:12 | 1861-1861 | TS2532 | Object is possibly 'undefined'. |
| D1613 | tests | `src/lib/payments/ledger.test.ts` | 76:12 | 1862-1862 | TS2532 | Object is possibly 'undefined'. |
| D1614 | tests | `src/lib/payments/ledger.test.ts` | 77:12 | 1863-1863 | TS2532 | Object is possibly 'undefined'. |
| D1615 | tests | `src/lib/payments/ledger.test.ts` | 124:12 | 1864-1864 | TS2532 | Object is possibly 'undefined'. |
| D1616 | tests | `src/lib/payments/ledger.test.ts` | 131:12 | 1865-1865 | TS2532 | Object is possibly 'undefined'. |
| D1617 | tests | `src/lib/payments/ledger.test.ts` | 132:12 | 1866-1866 | TS2532 | Object is possibly 'undefined'. |
| D1618 | tests | `src/lib/payments/ledger.test.ts` | 133:12 | 1867-1867 | TS2532 | Object is possibly 'undefined'. |
| D1619 | tests | `src/lib/payments/ledger.test.ts` | 139:12 | 1868-1868 | TS2532 | Object is possibly 'undefined'. |
| D1620 | tests | `src/lib/payments/ledger.test.ts` | 157:12 | 1869-1869 | TS2532 | Object is possibly 'undefined'. |
| D1621 | tests | `src/lib/payments/ledger.test.ts` | 163:19 | 1870-1870 | TS2532 | Object is possibly 'undefined'. |
| D1622 | tests | `src/lib/payments/ledger.test.ts` | 179:12 | 1871-1871 | TS2532 | Object is possibly 'undefined'. |
| D1623 | tests | `src/lib/payments/ledger.test.ts` | 180:12 | 1872-1872 | TS2532 | Object is possibly 'undefined'. |
| D1624 | tests | `src/lib/payments/ledger.test.ts` | 200:24 | 1873-1873 | TS2532 | Object is possibly 'undefined'. |
| D1625 | tests | `src/lib/payments/ledger.test.ts` | 201:12 | 1874-1874 | TS2532 | Object is possibly 'undefined'. |
| D1626 | tests | `src/lib/payments/ledger.test.ts` | 272:19 | 1875-1875 | TS2532 | Object is possibly 'undefined'. |
| D1627 | tests | `src/lib/payments/package-purchase.test.ts` | 146:3 | 1876-1876 | TS2532 | Object is possibly 'undefined'. |
| D1628 | tests | `src/lib/payments/package-purchase.test.ts` | 147:3 | 1877-1877 | TS2532 | Object is possibly 'undefined'. |
| D1629 | tests | `src/lib/payments/package-purchase.test.ts` | 177:5 | 1878-1878 | TS2532 | Object is possibly 'undefined'. |
| D1630 | tests | `src/lib/payments/package-purchase.test.ts` | 178:5 | 1879-1879 | TS2532 | Object is possibly 'undefined'. |
| D1631 | tests | `src/lib/payments/package-purchase.test.ts` | 179:5 | 1880-1880 | TS2532 | Object is possibly 'undefined'. |
| D1632 | tests | `src/lib/payments/package-purchase.test.ts` | 347:23 | 1881-1881 | TS2532 | Object is possibly 'undefined'. |
| D1633 | tests | `src/lib/payments/package-purchase.test.ts` | 363:18 | 1882-1882 | TS2532 | Object is possibly 'undefined'. |
| D1634 | tests | `src/lib/payments/package-purchase.test.ts` | 370:20 | 1883-1883 | TS2532 | Object is possibly 'undefined'. |
| D1635 | tests | `src/lib/payments/package-purchase.test.ts` | 379:12 | 1884-1884 | TS2532 | Object is possibly 'undefined'. |
| D1636 | tests | `src/lib/payments/package-purchase.test.ts` | 414:46 | 1885-1885 | TS2532 | Object is possibly 'undefined'. |
| D1637 | tests | `src/lib/payments/package-purchase.test.ts` | 421:92 | 1886-1886 | TS2532 | Object is possibly 'undefined'. |
| D1638 | tests | `src/lib/payments/package-purchase.test.ts` | 428:12 | 1887-1887 | TS2532 | Object is possibly 'undefined'. |
| D1639 | tests | `src/lib/payments/package-purchase.test.ts` | 436:12 | 1888-1888 | TS2532 | Object is possibly 'undefined'. |
| D1640 | tests | `src/lib/payments/package-purchase.test.ts` | 444:12 | 1889-1889 | TS2532 | Object is possibly 'undefined'. |
| D1641 | tests | `src/lib/payments/package-purchase.test.ts` | 453:12 | 1890-1890 | TS2532 | Object is possibly 'undefined'. |
| D1642 | tests | `src/lib/payments/package-purchase.test.ts` | 467:12 | 1891-1891 | TS2532 | Object is possibly 'undefined'. |
| D1643 | tests | `src/lib/payments/package-purchase.test.ts` | 479:12 | 1892-1892 | TS2532 | Object is possibly 'undefined'. |
| D1644 | tests | `src/lib/payments/package-purchase.test.ts` | 503:12 | 1893-1893 | TS2532 | Object is possibly 'undefined'. |
| D1645 | tests | `src/lib/payments/package-refund.test.ts` | 156:11 | 1894-1894 | TS2488 | Type '[officeGuyAppsBillingMVCAPIPaymentsControllerPaymentsChargeRequest?: OfficeGuyAppsBillingMVCAPIPaymentsControllerPaymentsChargeRequest &#124; undefined, options?: Init &#124; undefined] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D1646 | tests | `src/lib/payments/package-refund.test.ts` | 220:12 | 1895-1895 | TS2532 | Object is possibly 'undefined'. |
| D1647 | tests | `src/lib/payments/package-refund.test.ts` | 227:12 | 1896-1896 | TS2532 | Object is possibly 'undefined'. |
| D1648 | tests | `src/lib/payments/package-refund.test.ts` | 263:9 | 1897-1897 | TS18048 | 'db.tables.payment_operations' is possibly 'undefined'. |
| D1649 | tests | `src/lib/payments/package-refund.test.ts` | 398:12 | 1898-1898 | TS2532 | Object is possibly 'undefined'. |
| D1650 | tests | `src/lib/payments/provider.test.ts` | 55:47 | 1899-1900 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1651 | backend | `src/lib/queue/deterministic-id.ts` | 23:14 | 1901-1901 | TS2532 | Object is possibly 'undefined'. |
| D1652 | backend | `src/lib/queue/deterministic-id.ts` | 24:14 | 1902-1902 | TS2532 | Object is possibly 'undefined'. |
| D1653 | tests | `src/lib/queue/web-sender.test.ts` | 122:5 | 1903-1903 | TS2722 | Cannot invoke an object which is possibly 'undefined'. |
| D1654 | tests | `src/lib/rdp-access/xrdp-ticket.test.ts` | 80:49 | 1904-1905 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1655 | tests | `src/lib/realtime/permission-changes.test.ts` | 76:12 | 1906-1906 | TS2532 | Object is possibly 'undefined'. |
| D1656 | tests | `src/lib/realtime/permission-changes.test.ts` | 77:12 | 1907-1907 | TS2532 | Object is possibly 'undefined'. |
| D1657 | tests | `src/lib/realtime/permission-changes.test.ts` | 93:5 | 1908-1908 | TS2532 | Object is possibly 'undefined'. |
| D1658 | tests | `src/lib/realtime/permission-changes.test.ts` | 103:5 | 1909-1909 | TS2532 | Object is possibly 'undefined'. |
| D1659 | tests | `src/lib/relocation/cli-support.test.ts` | 83:5 | 1910-1910 | TS2532 | Object is possibly 'undefined'. |
| D1660 | tests | `src/lib/relocation/cli-support.test.ts` | 83:5 | 1911-1911 | TS2532 | Object is possibly 'undefined'. |
| D1661 | tests | `src/lib/relocation/elevenlabs-relocate.test.ts` | 68:17 | 1912-1912 | TS18048 | 'target' is possibly 'undefined'. |
| D1662 | tests | `src/lib/relocation/elevenlabs-relocate.test.ts` | 68:36 | 1913-1913 | TS18048 | 'target' is possibly 'undefined'. |
| D1663 | tests | `src/lib/relocation/elevenlabs-relocate.test.ts` | 73:85 | 1914-1914 | TS18048 | 'target' is possibly 'undefined'. |
| D1664 | tests | `src/lib/relocation/elevenlabs-relocate.test.ts` | 73:110 | 1915-1915 | TS18048 | 'target' is possibly 'undefined'. |
| D1665 | tests | `src/lib/relocation/elevenlabs-relocate.test.ts` | 74:90 | 1916-1916 | TS18048 | 'target' is possibly 'undefined'. |
| D1666 | tests | `src/lib/relocation/elevenlabs-relocate.test.ts` | 76:61 | 1917-1917 | TS18048 | 'target' is possibly 'undefined'. |
| D1667 | tests | `src/lib/relocation/elevenlabs-relocate.test.ts` | 125:12 | 1918-1918 | TS2532 | Object is possibly 'undefined'. |
| D1668 | tests | `src/lib/relocation/elevenlabs-relocate.test.ts` | 126:12 | 1919-1919 | TS2532 | Object is possibly 'undefined'. |
| D1669 | tests | `src/lib/relocation/elevenlabs-relocate.test.ts` | 127:13 | 1920-1920 | TS2532 | Object is possibly 'undefined'. |
| D1670 | tests | `src/lib/relocation/elevenlabs-relocate.test.ts` | 128:36 | 1921-1921 | TS2532 | Object is possibly 'undefined'. |
| D1671 | tests | `src/lib/relocation/engine.test.ts` | 87:12 | 1922-1922 | TS18048 | 'c1' is possibly 'undefined'. |
| D1672 | tests | `src/lib/relocation/engine.test.ts` | 88:12 | 1923-1923 | TS18048 | 'c1' is possibly 'undefined'. |
| D1673 | tests | `src/lib/relocation/engine.test.ts` | 89:12 | 1924-1924 | TS18048 | 'c2' is possibly 'undefined'. |
| D1674 | tests | `src/lib/relocation/engine.test.ts` | 97:5 | 1925-1925 | TS2532 | Object is possibly 'undefined'. |
| D1675 | tests | `src/lib/relocation/engine.test.ts` | 97:5 | 1926-1926 | TS2532 | Object is possibly 'undefined'. |
| D1676 | tests | `src/lib/relocation/engine.test.ts` | 114:12 | 1927-1927 | TS2532 | Object is possibly 'undefined'. |
| D1677 | tests | `src/lib/relocation/engine.test.ts` | 114:12 | 1928-1928 | TS2532 | Object is possibly 'undefined'. |
| D1678 | tests | `src/lib/relocation/engine.test.ts` | 155:5 | 1929-1929 | TS18048 | 'c1' is possibly 'undefined'. |
| D1679 | tests | `src/lib/relocation/engine.test.ts` | 156:5 | 1930-1930 | TS18048 | 'c2' is possibly 'undefined'. |
| D1680 | tests | `src/lib/relocation/engine.test.ts` | 157:5 | 1931-1931 | TS18048 | 'c3' is possibly 'undefined'. |
| D1681 | tests | `src/lib/relocation/engine.test.ts` | 163:12 | 1932-1932 | TS18048 | 'c1' is possibly 'undefined'. |
| D1682 | tests | `src/lib/relocation/engine.test.ts` | 164:12 | 1933-1933 | TS18048 | 'c2' is possibly 'undefined'. |
| D1683 | tests | `src/lib/relocation/engine.test.ts` | 165:12 | 1934-1934 | TS18048 | 'c3' is possibly 'undefined'. |
| D1684 | tests | `src/lib/relocation/engine.test.ts` | 175:18 | 1935-1935 | TS2532 | Object is possibly 'undefined'. |
| D1685 | tests | `src/lib/relocation/engine.test.ts` | 176:5 | 1936-1936 | TS18048 | 'step' is possibly 'undefined'. |
| D1686 | tests | `src/lib/relocation/engine.test.ts` | 177:5 | 1937-1937 | TS18048 | 'step' is possibly 'undefined'. |
| D1687 | tests | `src/lib/relocation/engine.test.ts` | 181:12 | 1938-1938 | TS18048 | 'step' is possibly 'undefined'. |
| D1688 | backend | `src/lib/relocation/engine.ts` | 406:19 | 1939-1939 | TS2532 | Object is possibly 'undefined'. |
| D1689 | tests | `src/lib/relocation/env-rewrite.test.ts` | 108:25 | 1940-1940 | TS2532 | Object is possibly 'undefined'. |
| D1690 | tests | `src/lib/relocation/env-validation.test.ts` | 47:12 | 1941-1941 | TS18048 | 'byKey.NEXT_PUBLIC_VAPID_PUBLIC_KEY' is possibly 'undefined'. |
| D1691 | tests | `src/lib/relocation/env-validation.test.ts` | 48:12 | 1942-1942 | TS18048 | 'byKey.VAPID_PRIVATE_KEY' is possibly 'undefined'. |
| D1692 | tests | `src/lib/relocation/env-validation.test.ts` | 49:12 | 1943-1943 | TS18048 | 'byKey.SUMIT_API_KEY' is possibly 'undefined'. |
| D1693 | tests | `src/lib/relocation/env-validation.test.ts` | 50:12 | 1944-1944 | TS18048 | 'byKey.SUMIT_API_KEY' is possibly 'undefined'. |
| D1694 | tests | `src/lib/relocation/external.test.ts` | 98:12 | 1945-1945 | TS2532 | Object is possibly 'undefined'. |
| D1695 | tests | `src/lib/relocation/external.test.ts` | 99:12 | 1946-1946 | TS2532 | Object is possibly 'undefined'. |
| D1696 | tests | `src/lib/relocation/external.test.ts` | 100:41 | 1947-1947 | TS2532 | Object is possibly 'undefined'. |
| D1697 | backend | `src/lib/relocation/install-steps.ts` | 440:49 | 1948-1949 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1698 | tests | `src/lib/relocation/meta-templates.test.ts` | 51:25 | 1950-1951 | TS2345 | Argument of type '({ id?: string &#124; undefined; ad_account_id?: string &#124; undefined; ad_adset_id?: string &#124; undefined; ad_campaign_id?: string &#124; undefined; ad_id?: string &#124; undefined; bid_spec?: { bid_strategy?: string &#124; undefined; bid_amount?: number &#124; undefined; } &#124; undefined; ... 21 more ...; sub_category?: "ORDER_DETAILS" &#124; ... 7 mo...' is not assignable to parameter of type 'Pick&lt;MetaTemplate, "components"&gt;'.<br>  Type 'undefined' is not assignable to type 'Pick&lt;MetaTemplate, "components"&gt;'. |
| D1699 | tests | `src/lib/relocation/meta-templates.test.ts` | 113:12 | 1952-1952 | TS2532 | Object is possibly 'undefined'. |
| D1700 | tests | `src/lib/relocation/meta-templates.test.ts` | 114:12 | 1953-1953 | TS2532 | Object is possibly 'undefined'. |
| D1701 | tests | `src/lib/relocation/meta-templates.test.ts` | 115:12 | 1954-1954 | TS2532 | Object is possibly 'undefined'. |
| D1702 | tests | `src/lib/relocation/meta-templates.test.ts` | 119:12 | 1955-1955 | TS2532 | Object is possibly 'undefined'. |
| D1703 | tests | `src/lib/relocation/meta-templates.test.ts` | 180:12 | 1956-1956 | TS2532 | Object is possibly 'undefined'. |
| D1704 | tests | `src/lib/relocation/meta-templates.test.ts` | 181:12 | 1957-1957 | TS2532 | Object is possibly 'undefined'. |
| D1705 | tests | `src/lib/relocation/meta-templates.test.ts` | 182:36 | 1958-1958 | TS2532 | Object is possibly 'undefined'. |
| D1706 | backend | `src/lib/relocation/pm2.ts` | 56:23 | 1959-1960 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1707 | backend | `src/lib/relocation/pm2.ts` | 71:36 | 1961-1962 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1708 | backend | `src/lib/relocation/pm2.ts` | 84:16 | 1963-1963 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D1709 | backend | `src/lib/relocation/pm2.ts` | 121:23 | 1964-1965 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1710 | backend | `src/lib/relocation/preflight.ts` | 108:22 | 1966-1966 | TS2532 | Object is possibly 'undefined'. |
| D1711 | tests | `src/lib/relocation/setup-form.test.ts` | 61:3 | 1967-1969 | TS2322 | Type '(string &#124; undefined)[]' is not assignable to type 'string[]'.<br>  Type 'string &#124; undefined' is not assignable to type 'string'.<br>    Type 'undefined' is not assignable to type 'string'. |
| D1712 | tests | `src/lib/relocation/setup-form.test.ts` | 87:21 | 1970-1971 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1713 | tests | `src/lib/relocation/setup-form.test.ts` | 98:25 | 1972-1978 | TS2769 | No overload matches this call.<br>  Overload 1 of 2, '(input: string &#124; URL &#124; Request, init?: RequestInit &#124; undefined): Promise&lt;Response&gt;', gave the following error.<br>    Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string &#124; URL &#124; Request'.<br>      Type 'undefined' is not assignable to type 'string &#124; URL &#124; Request'.<br>  Overload 2 of 2, '(input: URL &#124; RequestInfo, init?: RequestInit &#124; undefined): Promise&lt;Response&gt;', gave the following error.<br>    Argument of type 'string &#124; undefined' is not assignable to parameter of type 'URL &#124; RequestInfo'.<br>      Type 'undefined' is not assignable to type 'URL &#124; RequestInfo'. |
| D1714 | tests | `src/lib/relocation/setup-form.test.ts` | 99:28 | 1979-1979 | TS18048 | 'base' is possibly 'undefined'. |
| D1715 | backend | `src/lib/relocation/steps.ts` | 618:54 | 1980-1981 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1716 | backend | `src/lib/relocation/steps.ts` | 698:11 | 1982-1983 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1717 | backend | `src/lib/relocation/steps.ts` | 882:11 | 1984-1985 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1718 | backend | `src/lib/relocation/steps.ts` | 883:11 | 1986-1987 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1719 | backend | `src/lib/relocation/steps.ts` | 996:77 | 1988-1988 | TS2532 | Object is possibly 'undefined'. |
| D1720 | backend | `src/lib/relocation/steps.ts` | 996:115 | 1989-1989 | TS2532 | Object is possibly 'undefined'. |
| D1721 | backend | `src/lib/relocation/steps.ts` | 1067:54 | 1990-1991 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1722 | backend | `src/lib/relocation/steps.ts` | 1094:54 | 1992-1993 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1723 | backend | `src/lib/relocation/steps.ts` | 1118:54 | 1994-1995 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1724 | tests | `src/lib/relocation/voximplant-relocate.test.ts` | 23:31 | 1996-1997 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1725 | backend | `src/lib/relocation/voximplant-relocate.ts` | 133:31 | 1998-1999 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string &#124; null'.<br>  Type 'undefined' is not assignable to type 'string &#124; null'. |
| D1726 | tests | `src/lib/relocation/worker-db-sites.test.ts` | 58:19 | 2000-2001 | TS2345 | Argument of type 'NewExpression &#124; undefined' is not assignable to parameter of type 'NewExpression'.<br>  Type 'undefined' is not assignable to type 'NewExpression'. |
| D1727 | tests | `src/lib/security/rate-limit.test.ts` | 8:23 | 2002-2003 | TS2322 | Type 'string &#124; null &#124; undefined' is not assignable to type 'string &#124; null'.<br>  Type 'undefined' is not assignable to type 'string &#124; null'. |
| D1728 | tests | `src/lib/seo/technical-watch.test.ts` | 104:9 | 2004-2005 | TS2322 | Type 'TechnicalWatchStep &#124; undefined' is not assignable to type 'TechnicalWatchStep'.<br>  Type 'undefined' is not assignable to type 'TechnicalWatchStep'. |
| D1729 | tests | `src/lib/seo/technical-watch.test.ts` | 106:9 | 2006-2007 | TS2322 | Type 'TechnicalWatchStep &#124; undefined' is not assignable to type 'TechnicalWatchStep'.<br>  Type 'undefined' is not assignable to type 'TechnicalWatchStep'. |
| D1730 | tests | `src/lib/sms/extra-client.test.ts` | 115:12 | 2008-2008 | TS2532 | Object is possibly 'undefined'. |
| D1731 | tests | `src/lib/sms/extra-client.test.ts` | 116:12 | 2009-2009 | TS2532 | Object is possibly 'undefined'. |
| D1732 | tests | `src/lib/sms/extra-client.test.ts` | 117:12 | 2010-2010 | TS2532 | Object is possibly 'undefined'. |
| D1733 | tests | `src/lib/sms/extra-client.test.ts` | 118:12 | 2011-2011 | TS2532 | Object is possibly 'undefined'. |
| D1734 | tests | `src/lib/sms/extra-client.test.ts` | 125:12 | 2012-2012 | TS2532 | Object is possibly 'undefined'. |
| D1735 | tests | `src/lib/sms/run-key-check.test.ts` | 86:18 | 2013-2013 | TS2532 | Object is possibly 'undefined'. |
| D1736 | tests | `src/lib/sms/run-key-check.test.ts` | 94:18 | 2014-2014 | TS2532 | Object is possibly 'undefined'. |
| D1737 | tests | `src/lib/sms/run-key-check.test.ts` | 104:12 | 2015-2015 | TS2532 | Object is possibly 'undefined'. |
| D1738 | tests | `src/lib/sumit/crm-triggers.test.ts` | 24:12 | 2016-2016 | TS2532 | Object is possibly 'undefined'. |
| D1739 | tests | `src/lib/sumit/crm-triggers.test.ts` | 25:23 | 2017-2017 | TS2532 | Object is possibly 'undefined'. |
| D1740 | tests | `src/lib/sumit/crm-triggers.test.ts` | 30:23 | 2018-2018 | TS2532 | Object is possibly 'undefined'. |
| D1741 | tests | `src/lib/sumit/crm-triggers.test.ts` | 37:23 | 2019-2019 | TS2532 | Object is possibly 'undefined'. |
| D1742 | tests | `src/lib/sumit/crm-triggers.test.ts` | 39:12 | 2020-2020 | TS2532 | Object is possibly 'undefined'. |
| D1743 | tests | `src/lib/sumit/generated-api.test.ts` | 36:12 | 2021-2021 | TS2532 | Object is possibly 'undefined'. |
| D1744 | tests | `src/lib/sumit/generated-api.test.ts` | 37:24 | 2022-2022 | TS2532 | Object is possibly 'undefined'. |
| D1745 | tests | `src/lib/sumit/generated-api.test.ts` | 38:30 | 2023-2023 | TS2532 | Object is possibly 'undefined'. |
| D1746 | tests | `src/lib/sumit/generated-api.test.ts` | 65:30 | 2024-2024 | TS2532 | Object is possibly 'undefined'. |
| D1747 | tests | `src/lib/sumit/mutator.test.ts` | 67:12 | 2025-2025 | TS2532 | Object is possibly 'undefined'. |
| D1748 | tests | `src/lib/sumit/mutator.test.ts` | 68:12 | 2026-2026 | TS2532 | Object is possibly 'undefined'. |
| D1749 | tests | `src/lib/sumit/mutator.test.ts` | 69:12 | 2027-2027 | TS2532 | Object is possibly 'undefined'. |
| D1750 | tests | `src/lib/sumit/mutator.test.ts` | 70:24 | 2028-2028 | TS2532 | Object is possibly 'undefined'. |
| D1751 | tests | `src/lib/sumit/mutator.test.ts` | 71:30 | 2029-2029 | TS2532 | Object is possibly 'undefined'. |
| D1752 | tests | `src/lib/sumit/mutator.test.ts` | 80:33 | 2030-2030 | TS2532 | Object is possibly 'undefined'. |
| D1753 | tests | `src/lib/sumit/mutator.test.ts` | 180:30 | 2031-2031 | TS2532 | Object is possibly 'undefined'. |
| D1754 | tests | `src/lib/sumit/raw-charge.test.ts` | 8:16 | 2032-2032 | TS2532 | Object is possibly 'undefined'. |
| D1755 | tests | `src/lib/sumit/raw-charge.test.ts` | 41:12 | 2033-2033 | TS2532 | Object is possibly 'undefined'. |
| D1756 | tests | `src/lib/sumit/raw-charge.test.ts` | 337:29 | 2034-2034 | TS2532 | Object is possibly 'undefined'. |
| D1757 | tests | `src/lib/supabase/console-view-grants.test.ts` | 68:3 | 2035-2037 | TS2322 | Type '(string &#124; undefined)[]' is not assignable to type 'string[]'.<br>  Type 'string &#124; undefined' is not assignable to type 'string'.<br>    Type 'undefined' is not assignable to type 'string'. |
| D1758 | tests | `src/lib/supabase/console-view-grants.test.ts` | 104:40 | 2038-2039 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1759 | tests | `src/lib/supabase/console-view-grants.test.ts` | 105:40 | 2040-2041 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1760 | tests | `src/lib/supabase/console-view-grants.test.ts` | 153:18 | 2042-2043 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1761 | tests | `src/lib/supabase/rdp-access-migration.test.ts` | 97:42 | 2044-2045 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1762 | tests | `src/lib/supabase/rdp-access-migration.test.ts` | 121:14 | 2046-2046 | TS2532 | Object is possibly 'undefined'. |
| D1763 | tests | `src/lib/supabase/rdp-access-migration.test.ts` | 171:11 | 2047-2047 | TS2532 | Object is possibly 'undefined'. |
| D1764 | tests | `src/lib/supabase/rdp-access-migration.test.ts` | 212:43 | 2048-2049 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1765 | tests | `src/lib/supabase/retire-user-roles-consumers-migration.test.ts` | 28:40 | 2050-2051 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1766 | tests | `src/lib/supabase/retire-user-roles-stage-2-migration.test.ts` | 14:40 | 2052-2053 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1767 | tests | `src/lib/supabase/retire-user-roles-stage-2-migration.test.ts` | 30:12 | 2054-2054 | TS2532 | Object is possibly 'undefined'. |
| D1768 | backend | `src/lib/testing/local-integration.ts` | 552:48 | 2055-2055 | TS2538 | Type 'undefined' cannot be used as an index type. |
| D1769 | backend | `src/lib/text/substitute-tokens.ts` | 17:38 | 2056-2060 | TS2769 | No overload matches this call.<br>  The last overload gave the following error.<br>    Argument of type '(whole: string, key: string) =&gt; string &#124; undefined' is not assignable to parameter of type '(substring: string, ...args: any[]) =&gt; string'.<br>      Type 'string &#124; undefined' is not assignable to type 'string'.<br>        Type 'undefined' is not assignable to type 'string'. |
| D1770 | backend | `src/lib/text/substitute-tokens.ts` | 25:3 | 2061-2063 | TS2322 | Type '(string &#124; undefined)[]' is not assignable to type 'string[]'.<br>  Type 'string &#124; undefined' is not assignable to type 'string'.<br>    Type 'undefined' is not assignable to type 'string'. |
| D1771 | tests | `src/lib/validation/admin.test.ts` | 342:30 | 2064-2064 | TS2532 | Object is possibly 'undefined'. |
| D1772 | tests | `src/lib/validation/admin.test.ts` | 369:30 | 2065-2065 | TS2532 | Object is possibly 'undefined'. |
| D1773 | tests | `src/lib/validation/campaigns.test.ts` | 67:28 | 2066-2066 | TS2532 | Object is possibly 'undefined'. |
| D1774 | tests | `src/lib/validation/send-policy-form.test.ts` | 26:34 | 2067-2076 | TS2769 | No overload matches this call.<br>  Overload 1 of 3, '(name: string, value: string &#124; Blob): void', gave the following error.<br>    Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string &#124; Blob'.<br>      Type 'undefined' is not assignable to type 'string &#124; Blob'.<br>  Overload 2 of 3, '(name: string, value: string): void', gave the following error.<br>    Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>      Type 'undefined' is not assignable to type 'string'.<br>  Overload 3 of 3, '(name: string, blobValue: Blob, filename?: string &#124; undefined): void', gave the following error.<br>    Argument of type 'string &#124; undefined' is not assignable to parameter of type 'Blob'.<br>      Type 'undefined' is not assignable to type 'Blob'. |
| D1775 | tests | `src/lib/validation/vox-payloads.test.ts` | 198:12 | 2077-2077 | TS2532 | Object is possibly 'undefined'. |
| D1776 | tests | `src/lib/validation/vox-payloads.test.ts` | 199:12 | 2078-2078 | TS2532 | Object is possibly 'undefined'. |
| D1777 | tests | `src/lib/validation/vox-payloads.test.ts` | 200:12 | 2079-2079 | TS2532 | Object is possibly 'undefined'. |
| D1778 | tests | `src/lib/validation/vox-payloads.test.ts` | 201:12 | 2080-2080 | TS2532 | Object is possibly 'undefined'. |
| D1779 | tests | `src/lib/validation/vox-payloads.test.ts` | 202:12 | 2081-2081 | TS2532 | Object is possibly 'undefined'. |
| D1780 | tests | `src/lib/validation/vox-payloads.test.ts` | 217:12 | 2082-2082 | TS2532 | Object is possibly 'undefined'. |
| D1781 | tests | `src/lib/validation/vox-payloads.test.ts` | 221:12 | 2083-2083 | TS2532 | Object is possibly 'undefined'. |
| D1782 | tests | `src/lib/validation/vox-payloads.test.ts` | 233:12 | 2084-2084 | TS2532 | Object is possibly 'undefined'. |
| D1783 | tests | `src/lib/validation/vox-payloads.test.ts` | 234:12 | 2085-2085 | TS2532 | Object is possibly 'undefined'. |
| D1784 | tests | `src/lib/validation/vox-payloads.test.ts` | 235:12 | 2086-2086 | TS2532 | Object is possibly 'undefined'. |
| D1785 | tests | `src/lib/voximplant/call-history-normalize.test.ts` | 227:12 | 2087-2087 | TS2532 | Object is possibly 'undefined'. |
| D1786 | tests | `src/lib/voximplant/call-history-normalize.test.ts` | 386:9 | 2088-2089 | TS2322 | Type 'CallHistoryLeg &#124; undefined' is not assignable to type 'CallHistoryLeg'.<br>  Type 'undefined' is not assignable to type 'CallHistoryLeg'. |
| D1787 | backend | `src/lib/voximplant/cli-support.ts` | 88:9 | 2090-2090 | TS18048 | 'a' is possibly 'undefined'. |
| D1788 | backend | `src/lib/voximplant/cli-support.ts` | 89:20 | 2091-2091 | TS18048 | 'a' is possibly 'undefined'. |
| D1789 | backend | `src/lib/voximplant/cli-support.ts` | 105:24 | 2092-2093 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1790 | backend | `src/lib/voximplant/cli-support.ts` | 733:18 | 2094-2094 | TS18048 | 'headerRaw' is possibly 'undefined'. |
| D1791 | backend | `src/lib/voximplant/cli-support.ts` | 762:28 | 2095-2095 | TS2532 | Object is possibly 'undefined'. |
| D1792 | backend | `src/lib/voximplant/cli-support.ts` | 775:19 | 2096-2096 | TS18048 | 'headerRaw' is possibly 'undefined'. |
| D1793 | backend | `src/lib/voximplant/cli-support.ts` | 775:19 | 2097-2097 | TS2532 | Object is possibly 'undefined'. |
| D1794 | tests | `src/lib/voximplant/core.test.ts` | 111:12 | 2098-2098 | TS2532 | Object is possibly 'undefined'. |
| D1795 | tests | `src/lib/voximplant/core.test.ts` | 112:12 | 2099-2099 | TS2532 | Object is possibly 'undefined'. |
| D1796 | tests | `src/lib/voximplant/core.test.ts` | 113:12 | 2100-2100 | TS2532 | Object is possibly 'undefined'. |
| D1797 | tests | `src/lib/voximplant/core.test.ts` | 114:12 | 2101-2101 | TS2532 | Object is possibly 'undefined'. |
| D1798 | tests | `src/lib/voximplant/core.test.ts` | 168:12 | 2102-2102 | TS2532 | Object is possibly 'undefined'. |
| D1799 | tests | `src/lib/voximplant/core.test.ts` | 169:12 | 2103-2103 | TS2532 | Object is possibly 'undefined'. |
| D1800 | tests | `src/lib/voximplant/core.test.ts` | 170:12 | 2104-2104 | TS2532 | Object is possibly 'undefined'. |
| D1801 | tests | `src/lib/voximplant/core.test.ts` | 184:19 | 2105-2106 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1802 | tests | `src/lib/voximplant/core.test.ts` | 185:19 | 2107-2108 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1803 | tests | `src/lib/voximplant/core.test.ts` | 190:12 | 2109-2109 | TS18048 | 'sig' is possibly 'undefined'. |
| D1804 | tests | `src/lib/voximplant/core.test.ts` | 269:21 | 2110-2111 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1805 | tests | `src/lib/whatsapp/client.test.ts` | 65:21 | 2112-2112 | TS2532 | Object is possibly 'undefined'. |
| D1806 | tests | `src/lib/whatsapp/client.test.ts` | 82:21 | 2113-2113 | TS2532 | Object is possibly 'undefined'. |
| D1807 | tests | `src/lib/whatsapp/client.test.ts` | 108:21 | 2114-2114 | TS2532 | Object is possibly 'undefined'. |
| D1808 | backend | `src/lib/whatsapp/client.ts` | 236:27 | 2115-2116 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string &#124; Currency &#124; DateTime'.<br>  Type 'undefined' is not assignable to type 'string &#124; Currency &#124; DateTime'. |
| D1809 | tests | `src/lib/whatsapp/debug-token.test.ts` | 33:32 | 2117-2117 | TS2532 | Object is possibly 'undefined'. |
| D1810 | tests | `src/lib/whatsapp/debug-token.test.ts` | 45:12 | 2118-2118 | TS2532 | Object is possibly 'undefined'. |
| D1811 | tests | `src/lib/whatsapp/embedded-signup/graph.test.ts` | 31:25 | 2119-2119 | TS2532 | Object is possibly 'undefined'. |
| D1812 | tests | `src/lib/whatsapp/embedded-signup/graph.test.ts` | 82:23 | 2120-2120 | TS2532 | Object is possibly 'undefined'. |
| D1813 | tests | `src/lib/whatsapp/embedded-signup/graph.test.ts` | 123:20 | 2121-2122 | TS2345 | Argument of type 'any[] &#124; undefined' is not assignable to parameter of type 'unknown[]'.<br>  Type 'undefined' is not assignable to type 'unknown[]'. |
| D1814 | tests | `src/lib/whatsapp/embedded-signup/graph.test.ts` | 129:20 | 2123-2124 | TS2345 | Argument of type 'any[] &#124; undefined' is not assignable to parameter of type 'unknown[]'.<br>  Type 'undefined' is not assignable to type 'unknown[]'. |
| D1815 | tests | `src/lib/whatsapp/embedded-signup/graph.test.ts` | 135:20 | 2125-2126 | TS2345 | Argument of type 'any[] &#124; undefined' is not assignable to parameter of type 'unknown[]'.<br>  Type 'undefined' is not assignable to type 'unknown[]'. |
| D1816 | tests | `src/lib/whatsapp/health.test.ts` | 68:24 | 2127-2127 | TS2532 | Object is possibly 'undefined'. |
| D1817 | tests | `src/lib/whatsapp/phone-numbers.test.ts` | 61:20 | 2128-2128 | TS2532 | Object is possibly 'undefined'. |
| D1818 | tests | `src/lib/whatsapp/phone-numbers.test.ts` | 68:24 | 2129-2129 | TS2532 | Object is possibly 'undefined'. |
| D1819 | tests | `src/lib/whatsapp/phone-numbers.test.ts` | 78:19 | 2130-2130 | TS2532 | Object is possibly 'undefined'. |
| D1820 | tests | `src/lib/whatsapp/phone-numbers.test.ts` | 79:18 | 2131-2131 | TS2532 | Object is possibly 'undefined'. |
| D1821 | tests | `src/lib/whatsapp/phone-numbers.test.ts` | 95:19 | 2132-2132 | TS2532 | Object is possibly 'undefined'. |
| D1822 | tests | `src/lib/whatsapp/phone-numbers.test.ts` | 157:19 | 2133-2133 | TS2532 | Object is possibly 'undefined'. |
| D1823 | tests | `src/lib/whatsapp/phone-numbers.test.ts` | 158:18 | 2134-2134 | TS2532 | Object is possibly 'undefined'. |
| D1824 | tests | `src/lib/whatsapp/phone-numbers.test.ts` | 202:12 | 2135-2135 | TS2532 | Object is possibly 'undefined'. |
| D1825 | tests | `src/lib/whatsapp/run-health-check.test.ts` | 97:21 | 2136-2136 | TS2532 | Object is possibly 'undefined'. |
| D1826 | tests | `src/lib/whatsapp/run-health-check.test.ts` | 111:18 | 2137-2137 | TS2532 | Object is possibly 'undefined'. |
| D1827 | tests | `src/lib/whatsapp/subscriptions.test.ts` | 105:32 | 2138-2138 | TS2532 | Object is possibly 'undefined'. |
| D1828 | tests | `src/lib/whatsapp/template-route.test.ts` | 130:51 | 2139-2140 | TS2322 | Type '{ type: string; sub_type: string &#124; null; index: number &#124; null; position: number; source_path: string; } &#124; undefined' is not assignable to type 'Pick&lt;TemplateParameterRow, "index" &#124; "position" &#124; "source_path" &#124; "sub_type" &#124; "type"&gt;'.<br>  Type 'undefined' is not assignable to type 'Pick&lt;TemplateParameterRow, "index" &#124; "position" &#124; "source_path" &#124; "sub_type" &#124; "type"&gt;'. |
| D1829 | tests | `src/lib/whatsapp/template-route.test.ts` | 130:72 | 2141-2142 | TS2322 | Type '{ type: string; sub_type: string &#124; null; index: number &#124; null; position: number; source_path: string; } &#124; undefined' is not assignable to type 'Pick&lt;TemplateParameterRow, "index" &#124; "position" &#124; "source_path" &#124; "sub_type" &#124; "type"&gt;'.<br>  Type 'undefined' is not assignable to type 'Pick&lt;TemplateParameterRow, "index" &#124; "position" &#124; "source_path" &#124; "sub_type" &#124; "type"&gt;'. |
| D1830 | tests | `src/lib/whatsapp/template-route.test.ts` | 130:106 | 2143-2144 | TS2322 | Type '{ type: string; sub_type: string &#124; null; index: number &#124; null; position: number; source_path: string; } &#124; undefined' is not assignable to type 'Pick&lt;TemplateParameterRow, "index" &#124; "position" &#124; "source_path" &#124; "sub_type" &#124; "type"&gt;'.<br>  Type 'undefined' is not assignable to type 'Pick&lt;TemplateParameterRow, "index" &#124; "position" &#124; "source_path" &#124; "sub_type" &#124; "type"&gt;'. |
| D1831 | backend | `src/lib/whatsapp/template-route.ts` | 219:26 | 2145-2146 | TS2345 | Argument of type 'string &#124; undefined' is not assignable to parameter of type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1832 | tests | `src/lib/workflow/catalogue/templates.test.ts` | 646:14 | 2147-2147 | TS18048 | 'suffix' is possibly 'undefined'. |
| D1833 | tests | `src/lib/workflow/catalogue/templates.test.ts` | 646:39 | 2148-2148 | TS18048 | 'suffix' is possibly 'undefined'. |
| D1834 | tests | `src/lib/workflow/portability.test.ts` | 203:26 | 2149-2155 | TS2769 | No overload matches this call.<br>  Overload 1 of 2, '(o: ArrayLike&lt;string&gt; &#124; { [s: string]: string; }): string[]', gave the following error.<br>    Argument of type 'RemovedBinding &#124; undefined' is not assignable to parameter of type 'ArrayLike&lt;string&gt; &#124; { [s: string]: string; }'.<br>      Type 'undefined' is not assignable to type 'ArrayLike&lt;string&gt; &#124; { [s: string]: string; }'.<br>  Overload 2 of 2, '(o: {}): any[]', gave the following error.<br>    Argument of type 'RemovedBinding &#124; undefined' is not assignable to parameter of type '{}'.<br>      Type 'undefined' is not assignable to type '{}'. |
| D1835 | tests | `src/lib/workflow/steps/ai-agent.test.ts` | 64:14 | 2156-2156 | TS2532 | Object is possibly 'undefined'. |
| D1836 | tests | `src/lib/workflow/steps/ai-agent.test.ts` | 84:12 | 2157-2157 | TS2532 | Object is possibly 'undefined'. |
| D1837 | tests | `src/lib/workflow/steps/ai-agent.test.ts` | 98:33 | 2158-2158 | TS2532 | Object is possibly 'undefined'. |
| D1838 | tests | `src/lib/workflow/steps/guest-field-callback.test.ts` | 98:12 | 2159-2159 | TS2532 | Object is possibly 'undefined'. |
| D1839 | tests | `src/lib/workflow/steps/guest-field-callback.test.ts` | 150:12 | 2160-2160 | TS2532 | Object is possibly 'undefined'. |
| D1840 | tests | `src/lib/workflow/steps/sumit-accounting.test.ts` | 100:12 | 2161-2161 | TS2532 | Object is possibly 'undefined'. |
| D1841 | tests | `src/lib/workflow/steps/sumit-accounting.test.ts` | 115:12 | 2162-2162 | TS2532 | Object is possibly 'undefined'. |
| D1842 | tests | `src/lib/workflow/steps/sumit-accounting.test.ts` | 126:12 | 2163-2163 | TS2532 | Object is possibly 'undefined'. |
| D1843 | tests | `src/lib/workflow/steps/sumit-accounting.test.ts` | 141:18 | 2164-2164 | TS2532 | Object is possibly 'undefined'. |
| D1844 | tests | `src/lib/workflow/steps/webhook.test.ts` | 61:12 | 2165-2165 | TS2532 | Object is possibly 'undefined'. |
| D1845 | tests | `src/lib/workflow/steps/webhook.test.ts` | 82:12 | 2166-2166 | TS2532 | Object is possibly 'undefined'. |
| D1846 | tests | `src/lib/workflow/steps/webhook.test.ts` | 93:12 | 2167-2167 | TS2532 | Object is possibly 'undefined'. |
| D1847 | tests | `src/lib/workflow/steps/webhook.test.ts` | 94:7 | 2168-2168 | TS2532 | Object is possibly 'undefined'. |
| D1848 | tests | `src/lib/workflow/steps/webhook.test.ts` | 104:12 | 2169-2169 | TS2532 | Object is possibly 'undefined'. |
| D1849 | tests | `src/lib/workflow/steps/webhook.test.ts` | 105:7 | 2170-2170 | TS2532 | Object is possibly 'undefined'. |
| D1850 | tests | `src/lib/workflow/template-send.test.ts` | 77:12 | 2171-2171 | TS2532 | Object is possibly 'undefined'. |
| D1851 | tests | `src/lib/workflow/template-send.test.ts` | 84:12 | 2172-2172 | TS2532 | Object is possibly 'undefined'. |
| D1852 | backend | `src/lib/workflow/voice-agent-actions.ts` | 27:15 | 2173-2173 | TS2532 | Object is possibly 'undefined'. |
| D1853 | backend | `src/lib/workflow/voice-agent-actions.ts` | 28:15 | 2174-2174 | TS2532 | Object is possibly 'undefined'. |
| D1854 | tests | `src/lib/workflow/webhook-trigger.test.ts` | 186:21 | 2175-2175 | TS2532 | Object is possibly 'undefined'. |
| D1855 | tests | `src/lib/workflow/webhook-trigger.test.ts` | 197:21 | 2176-2176 | TS2532 | Object is possibly 'undefined'. |
| D1856 | tests | `src/lib/workflow/webhook-trigger.test.ts` | 205:12 | 2177-2177 | TS2532 | Object is possibly 'undefined'. |
| D1857 | tests | `src/lib/workflow/webhook-trigger.test.ts` | 211:12 | 2178-2178 | TS2532 | Object is possibly 'undefined'. |
| D1858 | tests | `src/lib/workflow/webhook-trigger.test.ts` | 243:12 | 2179-2179 | TS2532 | Object is possibly 'undefined'. |
| D1859 | tests | `src/lib/workflow/webhook-trigger.test.ts` | 250:12 | 2180-2180 | TS2532 | Object is possibly 'undefined'. |
| D1860 | tests | `src/lib/workflow/webhook-trigger.test.ts` | 341:21 | 2181-2181 | TS2532 | Object is possibly 'undefined'. |
| D1861 | tests | `src/lib/workflow/webhook-trigger.test.ts` | 348:12 | 2182-2182 | TS2532 | Object is possibly 'undefined'. |
| D1862 | tests | `src/lib/workflow/webhook-trigger.test.ts` | 571:27 | 2183-2183 | TS2532 | Object is possibly 'undefined'. |
| D1863 | tests | `src/lib/workflow/webhook-trigger.test.ts` | 643:27 | 2184-2184 | TS2532 | Object is possibly 'undefined'. |
| D1864 | tests | `src/proxy.test.ts` | 43:37 | 2185-2186 | TS2322 | Type 'string &#124; undefined' is not assignable to type 'string'.<br>  Type 'undefined' is not assignable to type 'string'. |
| D1865 | tests | `src/proxy.test.ts` | 175:13 | 2187-2187 | TS2488 | Type '[input: string &#124; URL &#124; Request, init?: RequestInit &#124; undefined] &#124; undefined' must have a '[Symbol.iterator]()' method that returns an iterator. |
| D1866 | tests | `src/test/fake-table-client.ts` | 170:58 | 2188-2188 | TS18048 | 'f' is possibly 'undefined'. |
| D1867 | tests | `src/test/fake-table-client.ts` | 170:85 | 2189-2189 | TS18048 | 'f' is possibly 'undefined'. |
| D1868 | tests | `src/test/fake-table-client.ts` | 297:47 | 2190-2190 | TS18048 | 'f' is possibly 'undefined'. |
| D1869 | tests | `src/test/fake-table-client.ts` | 297:74 | 2191-2191 | TS18048 | 'f' is possibly 'undefined'. |
| D1870 | tests | `src/test/fake-table-client.ts` | 311:74 | 2192-2192 | TS18048 | 'f' is possibly 'undefined'. |
| D1871 | tests | `src/test/fake-table-client.ts` | 311:101 | 2193-2193 | TS18048 | 'f' is possibly 'undefined'. |
| D1872 | backend | `worker/main.ts` | 490:53 | 2194-2195 | TS2345 | Argument of type 'Touchpoint &#124; undefined' is not assignable to parameter of type 'Touchpoint'.<br>  Type 'undefined' is not assignable to type 'Touchpoint'. |
