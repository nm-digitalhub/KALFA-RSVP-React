"""Structured Hebrew legal-term translator for Israeli small-business, freelance, and consumer contexts."""

from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher, get_close_matches
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence


@dataclass(frozen=True)
class LegalSource:
    """Israeli legal or regulatory source used for verification."""

    name_he: str
    name_en: str
    citation: str
    url: str
    source_type: str = "official"
    verification_note: str = "Verify the current consolidated Hebrew source before relying on it."


@dataclass(frozen=True)
class LegalTermEntry:
    """Glossary entry for one Israeli Hebrew legal or regulatory term."""

    key: str
    hebrew: str
    english: str
    plain_english: str
    plain_hebrew: str
    area: str
    risk_level: str
    aliases: Sequence[str] = field(default_factory=tuple)
    business_context: str = ""
    consumer_context: str = ""
    freelancer_context: str = ""
    common_mistakes: Sequence[str] = field(default_factory=tuple)
    ask_for: Sequence[str] = field(default_factory=tuple)
    sources: Sequence[LegalSource] = field(default_factory=tuple)


@dataclass(frozen=True)
class TranslationResult:
    """Structured result returned by sync and async lookup methods."""

    request_id: str
    query: str
    language: str
    matched_key: Optional[str]
    matched_hebrew: Optional[str]
    english: Optional[str]
    plain_english: str
    plain_hebrew: str
    area: Optional[str]
    risk_level: str
    confidence: float
    citations: Sequence[Mapping[str, str]]
    next_questions: Sequence[str]
    warnings: Sequence[str]
    suggestions: Sequence[str] = field(default_factory=tuple)

    def to_dict(self) -> Dict[str, Any]:
        """Return a JSON-ready dictionary."""
        return asdict(self)

    def to_json(self, *, ensure_ascii: bool = False, indent: Optional[int] = 2) -> str:
        """Return a JSON string."""
        return json.dumps(self.to_dict(), ensure_ascii=ensure_ascii, indent=indent)


OFFICIAL_SOURCES: Dict[str, LegalSource] = {
    "legislation": LegalSource(
        "מאגר החקיקה הלאומי",
        "National Legislation Database",
        "הכנסת, מאגר החקיקה הלאומי",
        "https://main.knesset.gov.il/activity/legislation/laws/pages/lawhome.aspx",
    ),
    "reshumot": LegalSource(
        "רשומות",
        "Official Gazette",
        "משרד המשפטים, רשומות",
        "https://www.gov.il/he/departments/official_publications",
    ),
    "tax": LegalSource(
        "רשות המסים בישראל",
        "Israel Tax Authority",
        "רשות המסים בישראל",
        "https://www.gov.il/he/departments/israel_tax_authority",
    ),
    "consumer_authority": LegalSource(
        "הרשות להגנת הצרכן ולסחר הוגן",
        "Consumer Protection and Fair Trade Authority",
        "הרשות להגנת הצרכן ולסחר הוגן",
        "https://www.gov.il/he/departments/consumer_protection_and_fair_trade_authority",
    ),
    "privacy_authority": LegalSource(
        "הרשות להגנת הפרטיות",
        "Privacy Protection Authority",
        "הרשות להגנת הפרטיות",
        "https://www.gov.il/he/departments/the_privacy_protection_authority",
    ),
    "courts": LegalSource(
        "הרשות השופטת",
        "Israel Courts Authority",
        "הרשות השופטת",
        "https://www.gov.il/he/departments/the_judicial_authority",
    ),
    "enforcement": LegalSource(
        "רשות האכיפה והגבייה",
        "Enforcement and Collection Authority",
        "רשות האכיפה והגבייה",
        "https://www.gov.il/he/departments/enforcement_and_collection_authority",
    ),
    "vat_law": LegalSource(
        "חוק מס ערך מוסף, תשלו-1975",
        "Value Added Tax Law, 1975",
        "חוק מס ערך מוסף, תשלו-1975",
        "https://main.knesset.gov.il/apps/legislation/main/laws/2001068",
    ),
    "income_tax": LegalSource(
        "פקודת מס הכנסה [נוסח חדש]",
        "Income Tax Ordinance [New Version]",
        "פקודת מס הכנסה [נוסח חדש]",
        "https://www.gov.il/BlobFolder/legalinfo/law_pkudat_mas_hachnasa/he/LegalInformation_kesher_%D7%A4%D7%A7%D7%95%D7%93%D7%AA%20%D7%9E%D7%A1%20%D7%94%D7%9B%D7%A0%D7%A1%D7%94%20%5B%D7%A0%D7%95%D7%A1%D7%97%20%D7%97%D7%93%D7%A9%5D%20-%20%D7%9C%D7%90%20%D7%9E%D7%A8%D7%95%D7%91%D7%93.pdf",
    ),
    "consumer_law": LegalSource(
        "חוק הגנת הצרכן, תשמא-1981",
        "Consumer Protection Law, 1981",
        "חוק הגנת הצרכן, תשמא-1981",
        "https://m.knesset.gov.il/Activity/Legislation/Laws/Pages/LawPrimary.aspx?lawitemid=2000237&st=lawlawsvalidity&t=lawlaws",
    ),
    "contracts_law": LegalSource(
        "חוק החוזים (חלק כללי), תשלג-1973",
        "Contracts Law (General Part), 1973",
        "חוק החוזים (חלק כללי), תשלג-1973",
        "https://main.knesset.gov.il/apps/legislation/main/laws/2000292",
    ),
    "remedies_law": LegalSource(
        "חוק החוזים (תרופות בשל הפרת חוזה), תשלא-1970",
        "Contracts Remedies Law, 1970",
        "חוק החוזים (תרופות בשל הפרת חוזה), תשלא-1970",
        "https://m.knesset.gov.il/activity/legislation/laws/pages/lawprimary.aspx?lawitemid=2000293&st=lawlawskey&t=lawlaws",
    ),
    "standard_contracts": LegalSource(
        "חוק החוזים האחידים, תשמג-1982",
        "Standard Contracts Law, 1982",
        "חוק החוזים האחידים, תשמג-1982",
        "https://main.knesset.gov.il/Activity/Legislation/Laws/pages/lawprimary.aspx?lawitemid=2000295&st=lawlaws&t=lawlaws",
    ),
    "sale_law": LegalSource(
        "חוק המכר, תשכח-1968",
        "Sale Law, 1968",
        "חוק המכר, תשכח-1968",
        "https://main.knesset.gov.il/apps/legislation/main/laws/2000390",
    ),
    "minimum_wage": LegalSource(
        "חוק שכר מינימום, תשמז-1987",
        "Minimum Wage Law, 1987",
        "חוק שכר מינימום, תשמז-1987",
        "https://main.knesset.gov.il/Activity/Legislation/Laws/pages/lawprimary.aspx?lawitemid=2001419&st=lawlaws&t=lawlaws",
    ),
    "work_hours": LegalSource(
        "חוק שעות עבודה ומנוחה, תשיא-1951",
        "Hours of Work and Rest Law, 1951",
        "חוק שעות עבודה ומנוחה, תשיא-1951",
        "https://main.knesset.gov.il/apps/legislation/main/laws/2000019",
    ),
    "annual_leave": LegalSource(
        "חוק חופשה שנתית, תשיא-1951",
        "Annual Leave Law, 1951",
        "חוק חופשה שנתית, תשיא-1951",
        "https://main.knesset.gov.il/apps/legislation/main/laws/2000658",
    ),
    "severance": LegalSource(
        "חוק פיצויי פיטורים, תשכג-1963",
        "Severance Pay Law, 1963",
        "חוק פיצויי פיטורים, תשכג-1963",
        "https://main.knesset.gov.il/Activity/Legislation/Laws/pages/lawbill.aspx?lawitemid=148301&t=lawreshumot",
    ),
    "privacy_law": LegalSource(
        "חוק הגנת הפרטיות, תשמא-1981",
        "Protection of Privacy Law, 1981",
        "חוק הגנת הפרטיות, תשמא-1981",
        "https://main.knesset.gov.il/Activity/Legislation/Laws/pages/lawprimary.aspx?lawitemid=2000234",
    ),
    "defamation_law": LegalSource(
        "חוק איסור לשון הרע, תשכה-1965",
        "Defamation Law, 1965",
        "חוק איסור לשון הרע, תשכה-1965",
        "https://main.knesset.gov.il/apps/legislation/main/laws/2000089",
    ),
    "companies_law": LegalSource(
        "חוק החברות, תשנט-1999",
        "Companies Law, 1999",
        "חוק החברות, תשנט-1999",
        "https://main.knesset.gov.il/Activity/Legislation/Laws/pages/lawprimary.aspx?lawitemid=2000289",
    ),
    "pledge_law": LegalSource(
        "חוק המשכון, תשכז-1967",
        "Pledge Law, 1967",
        "חוק המשכון, תשכז-1967",
        "https://m.knesset.gov.il/Activity/Legislation/Laws/Pages/LawPrimary.aspx?lawitemid=2000427&st=lawlaws&t=lawlaws",
    ),
    "guarantee_law": LegalSource(
        "חוק הערבות, תשכז-1967",
        "Guarantee Law, 1967",
        "חוק הערבות, תשכז-1967",
        "https://main.knesset.gov.il/Activity/Legislation/Laws/pages/lawprimary.aspx?lawitemid=2000489",
    ),
}


def _src(*keys: str) -> Sequence[LegalSource]:
    return tuple(OFFICIAL_SOURCES[key] for key in keys)


GLOSSARY: Sequence[LegalTermEntry] = (
    LegalTermEntry(
        key="cheshbonit_mas",
        hebrew="חשבונית מס",
        english="VAT tax invoice",
        plain_english="A document issued by a VAT-registered business that records a taxable supply and supports input VAT deduction when the legal conditions are met.",
        plain_hebrew="מסמך שמוציא עוסק מורשה או חברה עבור עסקה חייבת במע״מ, ומשמש בסיס לניכוי מס תשומות כאשר מתקיימים התנאים בדין.",
        area="tax",
        risk_level="medium",
        aliases=("tax invoice", "invoice with vat", "חשבונית", "חשבונית עסקה", "vat invoice"),
        business_context="Use for VAT reporting, bookkeeping, and customer documentation. Confirm that required details appear before recording input tax.",
        consumer_context="Do not treat it as proof of payment unless it also states that payment was received.",
        freelancer_context="Issue only when required by VAT status and transaction timing rules.",
        common_mistakes=("Treating a pro forma invoice as a VAT invoice.", "Deducting input VAT from an incomplete document."),
        ask_for=("VAT registration status", "invoice number", "date", "supplier identity", "VAT amount"),
        sources=_src("vat_law", "tax"),
    ),
    LegalTermEntry(
        key="kabala",
        hebrew="קבלה",
        english="receipt",
        plain_english="A document confirming that payment was received. It is not always the same as a VAT invoice.",
        plain_hebrew="מסמך המאשר שהתקבל תשלום. קבלה אינה בהכרח חשבונית מס ואינה תמיד מאפשרת ניכוי מע״מ.",
        area="tax",
        risk_level="medium",
        aliases=("receipt", "proof of payment", "אישור תשלום"),
        business_context="Keep receipts with payment records and bank reconciliation.",
        consumer_context="Use as proof that money was paid.",
        freelancer_context="Issue when payment is received, according to bookkeeping instructions.",
        common_mistakes=("Using a receipt alone as a VAT deduction document.",),
        ask_for=("payment date", "payment method", "payer name", "amount in ₪"),
        sources=_src("tax", "vat_law"),
    ),
    LegalTermEntry(
        key="cheshbonit_mas_kabala",
        hebrew="חשבונית מס קבלה",
        english="combined VAT invoice and receipt",
        plain_english="A combined document that records both a taxable supply and receipt of payment.",
        plain_hebrew="מסמך משולב המתעד גם עסקה חייבת במע״מ וגם קבלת תשלום.",
        area="tax",
        risk_level="medium",
        aliases=("invoice receipt", "tax invoice receipt", "חשבונית קבלה"),
        business_context="Useful when payment and invoice issuance happen at the same time.",
        consumer_context="Treat as both invoice evidence and payment confirmation when properly completed.",
        freelancer_context="Common for service providers paid immediately.",
        common_mistakes=("Issuing it before payment when receipt details are not final.",),
        ask_for=("VAT rate", "paid amount", "payment method", "transaction date"),
        sources=_src("vat_law", "tax"),
    ),
    LegalTermEntry(
        key="osek_patur",
        hebrew="עוסק פטור",
        english="VAT-exempt dealer",
        plain_english="A small business status under Israeli VAT rules. The business normally does not charge VAT and generally cannot deduct input VAT.",
        plain_hebrew="מעמד של עסק קטן לפי דיני מע״מ. בדרך כלל אין גביית מע״מ מלקוחות ואין ניכוי מס תשומות.",
        area="tax",
        risk_level="high",
        aliases=("vat exempt", "exempt dealer", "small exempt business", "עוסק זעיר"),
        business_context="Check annual turnover limits and sector exclusions before using this status.",
        consumer_context="A seller with this status should not add VAT as a separate charge.",
        freelancer_context="Monitor turnover before crossing the threshold into VAT registration.",
        common_mistakes=("Charging VAT despite exempt status.", "Calling the status tax-free for all taxes."),
        ask_for=("annual turnover", "occupation type", "VAT registration confirmation"),
        sources=_src("vat_law", "tax"),
    ),
    LegalTermEntry(
        key="osek_murshe",
        hebrew="עוסק מורשה",
        english="authorized VAT dealer",
        plain_english="A VAT-registered business that normally charges VAT on taxable transactions and may deduct input VAT subject to law.",
        plain_hebrew="עסק הרשום במע״מ, גובה מע״מ בעסקאות חייבות, ועשוי לנכות מס תשומות בהתאם לדין.",
        area="tax",
        risk_level="high",
        aliases=("authorized dealer", "vat registered", "registered dealer"),
        business_context="Report VAT periodically and keep valid tax invoices.",
        consumer_context="VAT may appear as part of the price or as a separate line, depending on the transaction.",
        freelancer_context="Plan cash flow because VAT collected is not business income.",
        common_mistakes=("Treating collected VAT as revenue.",),
        ask_for=("VAT file number", "reporting frequency", "invoice details"),
        sources=_src("vat_law", "tax"),
    ),
    LegalTermEntry(
        key="nikui_mas_bamakor",
        hebrew="ניכוי מס במקור",
        english="withholding tax at source",
        plain_english="Tax withheld by the payer before transferring payment to the supplier, employee, or service provider.",
        plain_hebrew="מס שהמשלם מנכה לפני העברת התמורה לספק, לעובד או לנותן שירות.",
        area="tax",
        risk_level="high",
        aliases=("withholding tax", "tax withholding", "אישור ניכוי מס", "ניכוי במקור"),
        business_context="Check the supplier withholding certificate before payment.",
        consumer_context="Usually relevant when paying service providers in a business context.",
        freelancer_context="Keep certificates current to prevent excessive deductions.",
        common_mistakes=("Ignoring certificate expiry date.", "Deducting according to an old rate."),
        ask_for=("certificate expiry", "withholding rate", "payer identity", "gross amount in ₪"),
        sources=_src("income_tax", "tax"),
    ),
    LegalTermEntry(
        key="mikdamot_mas",
        hebrew="מקדמות מס הכנסה",
        english="income tax advance payments",
        plain_english="Periodic advance payments on expected income tax liability.",
        plain_hebrew="תשלומים תקופתיים על חשבון חבות צפויה במס הכנסה.",
        area="tax",
        risk_level="medium",
        aliases=("tax advances", "advance income tax", "מקדמות"),
        business_context="Set aside cash monthly and reconcile with annual tax return.",
        consumer_context="Relevant mainly for self-employed activity or rental and other taxable income.",
        freelancer_context="Track payment vouchers and online confirmations.",
        common_mistakes=("Assuming advances replace the annual return.",),
        ask_for=("assessment year", "advance rate", "reported turnover"),
        sources=_src("income_tax", "tax"),
    ),
    LegalTermEntry(
        key="heskem_hitkashrut",
        hebrew="הסכם התקשרות",
        english="service engagement agreement",
        plain_english="A contract that defines the commercial relationship, deliverables, price, timetable, liability, cancellation, and dispute terms.",
        plain_hebrew="חוזה שמגדיר את מערכת היחסים העסקית, התוצרים, המחיר, לוחות הזמנים, האחריות, הביטול ויישוב המחלוקות.",
        area="contracts",
        risk_level="high",
        aliases=("service agreement", "engagement agreement", "contract", "חוזה שירות", "התקשרות"),
        business_context="Use before starting work and include scope, payment, tax documents, confidentiality, and termination.",
        consumer_context="Read cancellation, warranty, and limitation clauses before signing.",
        freelancer_context="Clarify milestones, revisions, intellectual property, and late payment.",
        common_mistakes=("Starting work without scope and payment milestones.",),
        ask_for=("signed version", "scope of work", "payment schedule", "termination clause"),
        sources=_src("contracts_law", "remedies_law"),
    ),
    LegalTermEntry(
        key="hafar_yisodit",
        hebrew="הפרה יסודית",
        english="fundamental breach",
        plain_english="A serious contract breach that may justify stronger remedies, including cancellation, depending on the contract and law.",
        plain_hebrew="הפרה חמורה של חוזה שעשויה להצדיק סעדים משמעותיים יותר, לרבות ביטול, לפי החוזה והדין.",
        area="contracts",
        risk_level="high",
        aliases=("material breach", "serious breach", "breach of contract", "הפרה מהותית"),
        business_context="Document the breach, notice, loss, and cure period before escalating.",
        consumer_context="Check whether the seller failed to supply an essential part of the transaction.",
        freelancer_context="Use written notices before stopping work or cancelling.",
        common_mistakes=("Calling every delay a fundamental breach.",),
        ask_for=("contract clause", "dates", "notice sent", "loss evidence"),
        sources=_src("contracts_law", "remedies_law"),
    ),
    LegalTermEntry(
        key="pitzui_muscam",
        hebrew="פיצוי מוסכם",
        english="agreed compensation clause",
        plain_english="A contractual amount set in advance as compensation for breach, subject to judicial review in some cases.",
        plain_hebrew="סכום שנקבע מראש בחוזה כפיצוי על הפרה, בכפוף לאפשרות ביקורת שיפוטית במקרים מסוימים.",
        area="contracts",
        risk_level="high",
        aliases=("liquidated damages", "agreed damages", "פיצויים מוסכמים"),
        business_context="Check whether the amount is proportional to expected damage.",
        consumer_context="Large cancellation penalties may require closer review.",
        freelancer_context="Use clear triggers and avoid punitive wording.",
        common_mistakes=("Assuming the amount is always automatically enforceable.",),
        ask_for=("clause wording", "breach type", "contract value", "actual damage"),
        sources=_src("remedies_law", "contracts_law"),
    ),
    LegalTermEntry(
        key="tnai_mekapeach",
        hebrew="תנאי מקפח",
        english="unfairly prejudicial standard contract term",
        plain_english="A term in a standard contract that creates unfair imbalance against the customer and may be cancelled or changed.",
        plain_hebrew="תניה בחוזה אחיד שיוצרת חוסר איזון בלתי הוגן לרעת הלקוח ועשויה להתבטל או להשתנות.",
        area="contracts",
        risk_level="high",
        aliases=("unfair term", "unfair standard term", "סעיף מקפח", "חוזה אחיד"),
        business_context="Review templates for one-sided limits on liability, venue, cancellation, and unilateral changes.",
        consumer_context="Flag terms that remove basic remedies or impose unreasonable penalties.",
        freelancer_context="Check marketplace and platform terms before accepting.",
        common_mistakes=("Assuming every harsh term is automatically void.",),
        ask_for=("full contract", "consumer or business status", "specific clause"),
        sources=_src("standard_contracts", "contracts_law"),
    ),
    LegalTermEntry(
        key="bitul_iska",
        hebrew="ביטול עסקה",
        english="transaction cancellation",
        plain_english="A cancellation right or process that may come from consumer law, contract terms, or a specific sector rule.",
        plain_hebrew="זכות או תהליך לביטול עסקה לפי דיני צרכנות, תנאי החוזה או כלל ענפי מסוים.",
        area="consumer",
        risk_level="medium",
        aliases=("cancel transaction", "cancellation", "refund", "ביטול הזמנה"),
        business_context="Publish clear cancellation rules and issue refunds within the required process.",
        consumer_context="Check date, purchase channel, product category, use condition, and cancellation fee.",
        freelancer_context="Include cancellation rules for services and deposits.",
        common_mistakes=("Assuming every purchase can be cancelled after use.",),
        ask_for=("purchase date", "delivery date", "product or service type", "price in ₪"),
        sources=_src("consumer_law", "consumer_authority"),
    ),
    LegalTermEntry(
        key="iska_meker_rachok",
        hebrew="עסקת מכר מרחוק",
        english="distance sale transaction",
        plain_english="A consumer transaction made without face-to-face presence, often online, by phone, or similar remote means.",
        plain_hebrew="עסקה צרכנית שנעשית ללא נוכחות פיזית משותפת, למשל באינטרנט או בטלפון.",
        area="consumer",
        risk_level="medium",
        aliases=("distance sale", "online sale", "internet purchase", "עסקה באינטרנט", "מכר מרחוק"),
        business_context="Provide required pre-sale details and cancellation instructions.",
        consumer_context="Cancellation periods and disclosure duties may differ from in-store purchases.",
        freelancer_context="Applies when selling services remotely to consumers.",
        common_mistakes=("Treating all online purchases as identical despite product exceptions.",),
        ask_for=("order date", "disclosure page", "delivery date", "consumer age or disability status if relevant"),
        sources=_src("consumer_law", "consumer_authority"),
    ),
    LegalTermEntry(
        key="iska_berochlut",
        hebrew="עסקה ברוכלות",
        english="door-to-door or off-premises sale",
        plain_english="A consumer transaction initiated outside the seller business premises, often at the consumer home or workplace.",
        plain_hebrew="עסקה צרכנית שנעשית מחוץ לבית העסק, לעיתים בבית הצרכן או במקום העבודה.",
        area="consumer",
        risk_level="medium",
        aliases=("door to door sale", "off premises sale", "רוכלות"),
        business_context="Keep scripts and written disclosures aligned with consumer protection requirements.",
        consumer_context="Extra cancellation protections may apply in certain cases.",
        freelancer_context="Relevant when selling services at a client home or temporary stand.",
        common_mistakes=("Ignoring special protection for vulnerable consumers.",),
        ask_for=("where signed", "who initiated contact", "seller documents", "cancellation request date"),
        sources=_src("consumer_law", "consumer_authority"),
    ),
    LegalTermEntry(
        key="hodaa_mukdemet",
        hebrew="הודעה מוקדמת",
        english="advance notice",
        plain_english="Required notice before dismissal or resignation, usually calculated by employment status and length of service.",
        plain_hebrew="הודעה הנדרשת לפני פיטורים או התפטרות, בדרך כלל לפי סוג ההעסקה ומשך העבודה.",
        area="employment",
        risk_level="high",
        aliases=("notice period", "advance termination notice", "notice before dismissal", "תקופת הודעה מוקדמת"),
        business_context="Calculate notice correctly and document the termination process.",
        consumer_context="Relevant when employing domestic workers or service employees.",
        freelancer_context="Distinguish employment notice from contractual termination notice.",
        common_mistakes=("Using a contractor clause for an employee.",),
        ask_for=("start date", "end date", "salary basis", "termination letter"),
        sources=_src("severance", "work_hours"),
    ),
    LegalTermEntry(
        key="pitzuei_piturim",
        hebrew="פיצויי פיטורים",
        english="severance pay",
        plain_english="Payment that may be owed after qualifying termination of employment, subject to statutory and pension arrangement rules.",
        plain_hebrew="תשלום שעשוי להגיע לעובד לאחר סיום עבודה מזכה, בכפוף לדין ולהסדרים פנסיוניים.",
        area="employment",
        risk_level="high",
        aliases=("severance", "dismissal compensation", "פיצויים"),
        business_context="Check employment period, salary components, pension releases, and termination reason.",
        consumer_context="Relevant when employing household workers.",
        freelancer_context="May matter if contractor relationship is reclassified as employment.",
        common_mistakes=("Assuming every resignation excludes severance.",),
        ask_for=("employment dates", "last salary", "pension reports", "termination reason"),
        sources=_src("severance"),
    ),
    LegalTermEntry(
        key="schar_minimum",
        hebrew="שכר מינימום",
        english="minimum wage",
        plain_english="The statutory wage floor for employees, updated by law and official publications.",
        plain_hebrew="רף השכר החוקי לעובדים, המתעדכן לפי הדין והפרסומים הרשמיים.",
        area="employment",
        risk_level="high",
        aliases=("minimum salary", "minimum hourly wage", "שכר שעתי מינימלי"),
        business_context="Verify current monthly and hourly amounts before payroll approval.",
        consumer_context="Relevant when employing domestic help or caregivers.",
        freelancer_context="Not a direct contractor rate, but relevant to misclassification risk.",
        common_mistakes=("Using an outdated rate.",),
        ask_for=("pay period", "hours worked", "age", "employment type"),
        sources=_src("minimum_wage", "reshumot"),
    ),
    LegalTermEntry(
        key="shaot_nosafot",
        hebrew="שעות נוספות",
        english="overtime hours",
        plain_english="Hours beyond statutory daily or weekly limits that may require enhanced pay.",
        plain_hebrew="שעות מעבר למכסה היומית או השבועית בדין, שעשויות לחייב תשלום מוגדל.",
        area="employment",
        risk_level="high",
        aliases=("overtime", "extra hours", "שעות עבודה נוספות"),
        business_context="Keep attendance records and calculate overtime separately from base salary.",
        consumer_context="Relevant for household employment where hours are tracked.",
        freelancer_context="Clarify whether a project fee includes extra rounds or urgent work.",
        common_mistakes=("Rolling overtime into a global salary without checking legal limits.",),
        ask_for=("daily hours", "weekly hours", "attendance report", "salary structure"),
        sources=_src("work_hours"),
    ),
    LegalTermEntry(
        key="chufsha_shnatit",
        hebrew="חופשה שנתית",
        english="annual leave",
        plain_english="Paid vacation entitlement for employees, calculated by seniority, work pattern, and statutory rules.",
        plain_hebrew="זכאות לחופשה בתשלום לעובדים, לפי ותק, דפוס עבודה וכללי הדין.",
        area="employment",
        risk_level="medium",
        aliases=("vacation days", "paid leave", "ימי חופשה"),
        business_context="Track accrual, use, and redemption at employment end.",
        consumer_context="Relevant for domestic workers and caregivers.",
        freelancer_context="Usually not applicable unless employment status exists.",
        common_mistakes=("Deleting accrued days without lawful basis.",),
        ask_for=("seniority", "work days per week", "leave balance", "pay slips"),
        sources=_src("annual_leave"),
    ),
    LegalTermEntry(
        key="maagar_meida",
        hebrew="מאגר מידע",
        english="database under privacy law",
        plain_english="A collection of personal data that may trigger privacy obligations, registration or notification duties, governance, and security controls.",
        plain_hebrew="אוסף מידע אישי שעשוי ליצור חובות פרטיות, רישום או דיווח, ניהול ואבטחת מידע.",
        area="privacy",
        risk_level="high",
        aliases=("database", "personal data database", "מאגר לקוחות", "רשימת לקוחות"),
        business_context="Map what personal data is collected, why, who accesses it, and how it is secured.",
        consumer_context="Ask what data is kept and for what purpose.",
        freelancer_context="Client lists, mailing lists, and CRM exports may count as regulated data.",
        common_mistakes=("Treating a spreadsheet of customers as harmless because it is small.",),
        ask_for=("data categories", "number of records", "access roles", "security controls"),
        sources=_src("privacy_law", "privacy_authority"),
    ),
    LegalTermEntry(
        key="heskama",
        hebrew="הסכמה",
        english="consent",
        plain_english="Permission to collect, use, or disclose personal information, assessed by context, notice, purpose, and voluntariness.",
        plain_hebrew="הרשאה לאיסוף, שימוש או מסירת מידע אישי, הנבחנת לפי ההקשר, היידוע, המטרה והרצון החופשי.",
        area="privacy",
        risk_level="high",
        aliases=("privacy consent", "opt in", "permission", "אישור שימוש במידע"),
        business_context="Use clear notices and keep evidence for marketing and data sharing.",
        consumer_context="Review whether consent was bundled with unrelated terms.",
        freelancer_context="Do not reuse client data for marketing without proper basis.",
        common_mistakes=("Assuming silence is always consent.",),
        ask_for=("privacy notice", "checkbox text", "data purpose", "withdrawal route"),
        sources=_src("privacy_law", "privacy_authority"),
    ),
    LegalTermEntry(
        key="lashon_hara",
        hebrew="לשון הרע",
        english="defamation",
        plain_english="A publication that may harm a person or business reputation, subject to statutory defenses and context.",
        plain_hebrew="פרסום שעלול לפגוע בשם טוב של אדם או עסק, בכפוף להגנות ולנסיבות לפי הדין.",
        area="civil",
        risk_level="high",
        aliases=("defamation", "libel", "slander", "bad review", "ביקורת שלילית"),
        business_context="Before threatening a reviewer, preserve the publication and assess truth, public interest, and damages.",
        consumer_context="Give factual reviews and avoid unsupported accusations.",
        freelancer_context="Be careful with public disputes about clients or suppliers.",
        common_mistakes=("Treating every negative review as defamation.",),
        ask_for=("exact publication", "date", "platform", "audience", "evidence of truth"),
        sources=_src("defamation_law"),
    ),
    LegalTermEntry(
        key="hotzaa_lapoal",
        hebrew="הוצאה לפועל",
        english="enforcement proceedings",
        plain_english="A state enforcement system for collecting judgments, bills, and certain debts.",
        plain_hebrew="מערכת אכיפה ממלכתית לגביית פסקי דין, שטרות וחובות מסוימים.",
        area="debt",
        risk_level="critical",
        aliases=("enforcement office", "debt enforcement", "execution office", "הוצלפ"),
        business_context="Use only with enforceable documents and after checking notice requirements.",
        consumer_context="Respond quickly to warnings, deadlines, and payment orders.",
        freelancer_context="May be used for unpaid invoices when legal requirements are met.",
        common_mistakes=("Ignoring a warning letter because the debt is disputed.",),
        ask_for=("case number", "warning date", "debt amount in ₪", "judgment or bill"),
        sources=_src("enforcement"),
    ),
    LegalTermEntry(
        key="hatraa_lifnei_halichim",
        hebrew="התראה לפני נקיטת הליכים",
        english="pre-action warning notice",
        plain_english="A warning sent before legal or enforcement steps, usually demanding payment or corrective action by a deadline.",
        plain_hebrew="אזהרה לפני פתיחה בהליך משפטי או הליך גבייה, בדרך כלל עם דרישת תשלום או תיקון עד מועד נקוב.",
        area="debt",
        risk_level="high",
        aliases=("demand letter", "warning before legal action", "מכתב התראה", "דרישת חוב"),
        business_context="State the debt basis, deadline, evidence, and contact route without threats that exceed the law.",
        consumer_context="Do not ignore it; check sender authority, debt basis, and deadline.",
        freelancer_context="Use it to create a clear record before escalation.",
        common_mistakes=("Sending a vague threat without invoice, agreement, or due date.",),
        ask_for=("notice date", "deadline", "debt documents", "sender identity"),
        sources=_src("enforcement", "contracts_law"),
    ),
    LegalTermEntry(
        key="tvia_ktana",
        hebrew="תביעה קטנה",
        english="small claim",
        plain_english="A simplified court process for claims up to the statutory limit, usually designed for individuals and certain straightforward disputes.",
        plain_hebrew="הליך משפטי פשוט יחסית לתביעות עד תקרה הקבועה בדין, בדרך כלל למחלוקות ישירות ופשוטות.",
        area="procedure",
        risk_level="medium",
        aliases=("small claims", "small claims court", "בית משפט לתביעות קטנות"),
        business_context="Check whether the claimant type and amount fit the small-claims track.",
        consumer_context="Useful for consumer disputes when evidence is organized.",
        freelancer_context="May help collect modest unpaid amounts, subject to eligibility.",
        common_mistakes=("Filing without checking the current monetary limit.",),
        ask_for=("claim amount in ₪", "defendant details", "evidence", "prior demand"),
        sources=_src("courts"),
    ),
    LegalTermEntry(
        key="ktav_hagana",
        hebrew="כתב הגנה",
        english="statement of defense",
        plain_english="The written response to a claim, including factual admissions, denials, defenses, and attached evidence when required.",
        plain_hebrew="תגובה כתובה לכתב תביעה, הכוללת הודאות, הכחשות, טענות הגנה וצירוף ראיות לפי הצורך.",
        area="procedure",
        risk_level="critical",
        aliases=("defense pleading", "defence", "response to claim", "כתב תשובה"),
        business_context="Calendar the deadline immediately and attach organized documents.",
        consumer_context="Missing the deadline may lead to judgment without full hearing.",
        freelancer_context="Use a timeline, invoices, messages, and delivery proof.",
        common_mistakes=("Writing only a story without responding to numbered claims.",),
        ask_for=("service date", "court track", "claim file", "deadline"),
        sources=_src("courts"),
    ),
    LegalTermEntry(
        key="chevra_baam",
        hebrew="חברה בע״מ",
        english="limited liability company",
        plain_english="A company whose shareholders generally have limited liability, subject to company law and exceptions such as guarantees or veil-lifting.",
        plain_hebrew="חברה שבעלי מניותיה נהנים בדרך כלל מאחריות מוגבלת, בכפוף לדיני החברות ולחריגים כגון ערבות אישית או הרמת מסך.",
        area="companies",
        risk_level="high",
        aliases=("limited company", "ltd", "company limited", "חברה בעמ", "בעמ"),
        business_context="Check company registry details, signatory authority, and guarantees before contracting.",
        consumer_context="Know the legal entity behind the seller or service provider.",
        freelancer_context="Contract with the correct legal entity and not only a brand name.",
        common_mistakes=("Assuming a director is personally liable without a guarantee or legal basis.",),
        ask_for=("company number", "signatory name", "registry extract", "personal guarantee"),
        sources=_src("companies_law"),
    ),
    LegalTermEntry(
        key="arvut_ishit",
        hebrew="ערבות אישית",
        english="personal guarantee",
        plain_english="A personal promise to pay or perform another party debt or obligation if that party fails to do so.",
        plain_hebrew="התחייבות אישית לשלם או לקיים חיוב של גורם אחר אם אותו גורם לא יעמוד בו.",
        area="finance",
        risk_level="critical",
        aliases=("personal guaranty", "guarantee", "ערבות", "guarantor"),
        business_context="Do not sign without amount limits, expiry, notice rules, and release conditions.",
        consumer_context="A guarantee can expose personal assets even when the debt belongs to another person or company.",
        freelancer_context="Avoid guaranteeing client or company obligations unless the risk is fully priced.",
        common_mistakes=("Signing as a director and accidentally adding a personal guarantee.",),
        ask_for=("guaranteed amount in ₪", "debtor identity", "expiry", "notice obligations"),
        sources=_src("guarantee_law", "contracts_law"),
    ),
    LegalTermEntry(
        key="shibud",
        hebrew="שעבוד",
        english="security interest",
        plain_english="A legal charge over an asset used to secure a debt or obligation.",
        plain_hebrew="זכות בטוחה בנכס שנועדה להבטיח חוב או התחייבות.",
        area="finance",
        risk_level="high",
        aliases=("lien", "charge", "security", "בטוחה"),
        business_context="Check registration, asset description, priority, and release conditions.",
        consumer_context="A financed asset may be subject to restrictions until the debt is paid.",
        freelancer_context="Do not accept pledged equipment as collateral without registry checks.",
        common_mistakes=("Ignoring priority between competing creditors.",),
        ask_for=("asset details", "registry extract", "secured amount in ₪", "release letter"),
        sources=_src("pledge_law", "companies_law"),
    ),
)


_HEBREW_NIQQUD_RE = re.compile(r"[\u0591-\u05BD\u05BF-\u05C7]")
_WORD_RE = re.compile(r"[\w\u0590-\u05FF]+", re.UNICODE)


def normalize_text(value: str) -> str:
    """Normalize Hebrew and English text for matching."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    text = _HEBREW_NIQQUD_RE.sub("", text)
    replacements = {
        "\u05F3": "",
        "\u05F4": "",
        "'": "",
        '"': "",
        "’": "",
        "‘": "",
        "“": "",
        "”": "",
        "״": "",
        "׳": "",
        "־": "-",
        "–": "-",
        "—": "-",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = text.lower()
    text = re.sub(r"[^0-9a-z\u0590-\u05FF]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _request_id(query: str) -> str:
    normalized = normalize_text(query)
    total = sum((index + 1) * ord(char) for index, char in enumerate(normalized))
    return f"hlt-{total % 1_000_000:06d}"


def _source_dicts(sources: Iterable[LegalSource]) -> List[Dict[str, str]]:
    return [
        {
            "name_he": source.name_he,
            "name_en": source.name_en,
            "citation": source.citation,
            "url": source.url,
            "source_type": source.source_type,
            "verification_note": source.verification_note,
        }
        for source in sources
    ]


class HebrewLegalTermTranslator:
    """Lookup, explain, and search Israeli Hebrew legal terms."""

    def __init__(self, entries: Optional[Sequence[LegalTermEntry]] = None) -> None:
        self.entries: Sequence[LegalTermEntry] = tuple(entries or GLOSSARY)
        self._by_key: Dict[str, LegalTermEntry] = {entry.key: entry for entry in self.entries}
        self._index: Dict[str, LegalTermEntry] = {}
        for entry in self.entries:
            variants = {entry.key, entry.hebrew, entry.english, *entry.aliases}
            for variant in variants:
                normalized = normalize_text(variant)
                if normalized:
                    self._index[normalized] = entry

    def explain(self, query: str, *, language: str = "en", context: Optional[str] = None) -> TranslationResult:
        """Explain one term in English or Hebrew."""
        if not query or not str(query).strip():
            raise ValueError("query must not be empty")
        language = self._validate_language(language)
        normalized = normalize_text(query)
        entry = self._index.get(normalized) or self._by_key.get(str(query).strip())
        confidence = 1.0 if entry else 0.0

        if entry is None:
            scored = self._score_entries(query, area=None)
            if scored and scored[0][0] >= 0.63:
                confidence, entry = scored[0]
            else:
                suggestions = tuple(item.key for _, item in scored[:5])
                warning = "No exact glossary match. Verify the term against the source document and request more context."
                return TranslationResult(
                    request_id=_request_id(query),
                    query=query,
                    language=language,
                    matched_key=None,
                    matched_hebrew=None,
                    english=None,
                    plain_english="No reliable match was found in the local glossary.",
                    plain_hebrew="לא נמצא במילון המקומי מונח תואם ברמת ודאות מספקת.",
                    area=None,
                    risk_level="unknown",
                    confidence=0.0,
                    citations=[],
                    next_questions=("Provide the full sentence or document clause.", "Specify whether the matter is tax, consumer, employment, contract, privacy, debt, or procedure."),
                    warnings=(warning,),
                    suggestions=suggestions,
                )

        context_warning = self._context_warning(entry, context)
        warnings: List[str] = [
            "This is legal information, not legal advice. Verify the current Israeli source text before relying on the result."
        ]
        if context_warning:
            warnings.append(context_warning)

        return TranslationResult(
            request_id=_request_id(query),
            query=query,
            language=language,
            matched_key=entry.key,
            matched_hebrew=entry.hebrew,
            english=entry.english,
            plain_english=entry.plain_english,
            plain_hebrew=entry.plain_hebrew,
            area=entry.area,
            risk_level=entry.risk_level,
            confidence=round(float(confidence), 2),
            citations=_source_dicts(entry.sources),
            next_questions=tuple(entry.ask_for),
            warnings=tuple(warnings),
            suggestions=tuple(item.key for _, item in self._score_entries(query, area=entry.area)[1:4]),
        )

    async def async_explain(self, query: str, *, language: str = "en", context: Optional[str] = None) -> TranslationResult:
        """Asynchronously explain one term."""
        await asyncio.sleep(0)
        return self.explain(query, language=language, context=context)

    def batch_explain(self, queries: Sequence[str], *, language: str = "en", context: Optional[str] = None) -> List[TranslationResult]:
        """Explain several terms while preserving input order."""
        return [self.explain(query, language=language, context=context) for query in queries]

    async def async_batch_explain(self, queries: Sequence[str], *, language: str = "en", context: Optional[str] = None) -> List[TranslationResult]:
        """Asynchronously explain several terms."""
        await asyncio.sleep(0)
        return self.batch_explain(queries, language=language, context=context)

    def search(self, query: str, *, area: Optional[str] = None, limit: int = 10) -> List[Dict[str, Any]]:
        """Search terms by Hebrew, English, alias, area, and practical context."""
        if limit < 1:
            raise ValueError("limit must be at least 1")
        scored = self._score_entries(query, area=area)
        return [
            {
                "key": entry.key,
                "hebrew": entry.hebrew,
                "english": entry.english,
                "area": entry.area,
                "risk_level": entry.risk_level,
                "confidence": round(score, 2),
            }
            for score, entry in scored[:limit]
            if score > 0
        ]

    async def async_search(self, query: str, *, area: Optional[str] = None, limit: int = 10) -> List[Dict[str, Any]]:
        """Asynchronously search terms."""
        await asyncio.sleep(0)
        return self.search(query, area=area, limit=limit)

    def explain_text(self, text: str, *, max_terms: int = 10, language: str = "en") -> List[TranslationResult]:
        """Detect glossary terms inside a longer Hebrew or bilingual text."""
        if max_terms < 1:
            raise ValueError("max_terms must be at least 1")
        language = self._validate_language(language)
        normalized_text = f" {normalize_text(text)} "
        tokens = _WORD_RE.findall(normalized_text)
        matches: List[tuple[int, LegalTermEntry]] = []
        seen: set[str] = set()

        for entry in self.entries:
            variants = sorted({entry.hebrew, entry.english, *entry.aliases}, key=len, reverse=True)
            for variant in variants:
                normalized_variant = normalize_text(variant)
                if not normalized_variant:
                    continue
                position = normalized_text.find(f" {normalized_variant} ")
                if position < 0 and " " not in normalized_variant:
                    for token in tokens:
                        if token == normalized_variant or (len(token) > 2 and token[0] in "והבכלמש" and token[1:] == normalized_variant):
                            position = normalized_text.find(token)
                            break
                if position >= 0 and entry.key not in seen:
                    matches.append((position, entry))
                    seen.add(entry.key)
                    break

        matches.sort(key=lambda item: item[0])
        return [self.explain(entry.key, language=language) for _, entry in matches[:max_terms]]

    async def async_explain_text(self, text: str, *, max_terms: int = 10, language: str = "en") -> List[TranslationResult]:
        """Asynchronously detect and explain terms inside a longer text."""
        await asyncio.sleep(0)
        return self.explain_text(text, max_terms=max_terms, language=language)

    def list_terms(self, *, area: Optional[str] = None) -> List[Dict[str, str]]:
        """List glossary terms, optionally filtered by area."""
        return [
            {"key": entry.key, "hebrew": entry.hebrew, "english": entry.english, "area": entry.area, "risk_level": entry.risk_level}
            for entry in self.entries
            if area is None or entry.area == area
        ]

    def source_index(self) -> Dict[str, Dict[str, str]]:
        """Return a source catalog used by the glossary."""
        return {
            key: {
                "name_he": source.name_he,
                "name_en": source.name_en,
                "citation": source.citation,
                "url": source.url,
                "source_type": source.source_type,
            }
            for key, source in OFFICIAL_SOURCES.items()
        }

    def render_markdown(self, result: TranslationResult) -> str:
        """Render one result as Markdown."""
        return result_to_markdown(result)

    def validate_payload(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        """Validate a structured request payload for local use."""
        errors: List[Dict[str, str]] = []
        query = payload.get("query")
        language = payload.get("language", "en")
        context = payload.get("context")
        if not isinstance(query, str) or not query.strip():
            errors.append({"field": "query", "message": "query must be a non-empty string"})
        if language not in {"en", "he"}:
            errors.append({"field": "language", "message": "language must be en or he"})
        if context is not None and context not in {"business", "consumer", "freelancer", "employment", "privacy", "debt", "procedure", "tax", "contracts"}:
            errors.append({"field": "context", "message": "context is not recognized"})
        return {"valid": not errors, "errors": errors}

    def explain_payload(self, payload: Mapping[str, Any]) -> TranslationResult:
        """Validate and execute a structured lookup payload."""
        validation = self.validate_payload(payload)
        if not validation["valid"]:
            joined = "; ".join(f"{item['field']}: {item['message']}" for item in validation["errors"])
            raise ValueError(joined)
        return self.explain(str(payload["query"]), language=str(payload.get("language", "en")), context=payload.get("context"))

    @staticmethod
    def _validate_language(language: str) -> str:
        if language not in {"en", "he"}:
            raise ValueError("language must be en or he")
        return language

    @staticmethod
    def _context_warning(entry: LegalTermEntry, context: Optional[str]) -> Optional[str]:
        if context is None:
            return None
        if context == "consumer" and not entry.consumer_context:
            return "Consumer context was requested, but this term is not primarily a consumer term."
        if context == "freelancer" and not entry.freelancer_context:
            return "Freelancer context was requested, but this term may require a business or employment review."
        if context == "business" and not entry.business_context:
            return "Business context was requested, but this term may require a narrower area review."
        return None

    def _score_entries(self, query: str, *, area: Optional[str]) -> List[tuple[float, LegalTermEntry]]:
        normalized_query = normalize_text(query)
        query_tokens = set(_WORD_RE.findall(normalized_query))
        results: List[tuple[float, LegalTermEntry]] = []

        for entry in self.entries:
            if area and entry.area != area:
                continue
            variants = [entry.key, entry.hebrew, entry.english, *entry.aliases]
            normalized_variants = [normalize_text(variant) for variant in variants]
            exact = 1.0 if normalized_query in normalized_variants else 0.0
            substring = 0.0
            for variant in normalized_variants:
                if not variant:
                    continue
                if normalized_query and normalized_query in variant:
                    substring = max(substring, min(0.92, len(normalized_query) / max(len(variant), 1)))
                if variant and variant in normalized_query:
                    substring = max(substring, min(0.92, len(variant) / max(len(normalized_query), 1)))
            variant_tokens = set()
            for variant in normalized_variants:
                variant_tokens.update(_WORD_RE.findall(variant))
            token_score = len(query_tokens & variant_tokens) / max(len(query_tokens | variant_tokens), 1) if query_tokens else 0.0
            fuzzy = max((SequenceMatcher(None, normalized_query, variant).ratio() for variant in normalized_variants if variant), default=0.0)
            context_blob = normalize_text(" ".join([
                entry.area,
                entry.business_context,
                entry.consumer_context,
                entry.freelancer_context,
                " ".join(entry.common_mistakes),
                " ".join(entry.ask_for),
            ]))
            context_tokens = set(_WORD_RE.findall(context_blob))
            context_score = min(0.45, len(query_tokens & context_tokens) / max(len(query_tokens), 1)) if query_tokens else 0.0
            score = max(exact, substring, token_score, fuzzy * 0.82, context_score)
            if score > 0:
                results.append((score, entry))

        if normalized_query and not results:
            keys = [entry.key for entry in self.entries]
            close = get_close_matches(normalized_query, keys, n=5, cutoff=0.3)
            for key in close:
                results.append((0.31, self._by_key[key]))

        results.sort(key=lambda item: (-item[0], item[1].hebrew))
        return results


def result_to_markdown(result: TranslationResult) -> str:
    """Render a translation result as concise Markdown."""
    if result.matched_key is None:
        suggestions = ", ".join(result.suggestions) if result.suggestions else "none"
        warnings = "\n".join(f"- {warning}" for warning in result.warnings)
        return f"## No reliable match\n\nQuery: `{result.query}`\n\nSuggestions: {suggestions}\n\n{warnings}"

    explanation = result.plain_hebrew if result.language == "he" else result.plain_english
    citation_lines = "\n".join(
        f"- {item['name_en']} / {item['name_he']}: {item['citation']} ({item['url']})"
        for item in result.citations
    )
    next_lines = "\n".join(f"- {item}" for item in result.next_questions)
    warning_lines = "\n".join(f"- {item}" for item in result.warnings)
    return (
        f"## {result.matched_hebrew} — {result.english}\n\n"
        f"Request ID: `{result.request_id}`\n\n"
        f"Area: `{result.area}`  \n"
        f"Risk: `{result.risk_level}`  \n"
        f"Confidence: `{result.confidence}`\n\n"
        f"{explanation}\n\n"
        f"### Verify against\n{citation_lines}\n\n"
        f"### Ask for\n{next_lines}\n\n"
        f"### Warnings\n{warning_lines}"
    )


__all__ = [
    "GLOSSARY",
    "OFFICIAL_SOURCES",
    "HebrewLegalTermTranslator",
    "LegalSource",
    "LegalTermEntry",
    "TranslationResult",
    "normalize_text",
    "result_to_markdown",
]
