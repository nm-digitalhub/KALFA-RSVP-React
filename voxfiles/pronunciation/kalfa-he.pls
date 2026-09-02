<?xml version="1.0" encoding="UTF-8"?>
<!--
  KALFA — מילון הגייה עברי, לכל סוכני הקול (מכירות / אישורי הגעה / אישור פגישה).

  חוקי phoneme ב-IPA. נתמכים ב-eleven_v3, שהוא המודל שלנו
  (eleven_v3_conversational).

  תעתיק עברית ישראלית מודרנית:
    ר = ʁ (ענבלית)   ח = χ   ע = ʔ (או נבלעת)   צ = ts
    ההטעמה כמעט תמיד מלרע — ˈ לפני ההברה המוטעמת.

  ה-grapheme הוא הכתיב הלא-מנוקד — זה מה שה-LLM מייצר בפועל.

  מקור לכל שורה:
    נגבים  — שיבוש שהבעלים שמע בשיחה חיה, 2026-09-01.
    קלפה   — שם המותג, מנוקד בפרומפט מאז תחילת הסוכן.
    השאר   — הומוגרפים שקריאה שגויה שלהם משנה משמעות בהקשר כספי/משפטי.
             לא נכללו מילים שקריאתן חד-משמעית ממילא.
-->
<lexicon version="1.0"
      xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:schemaLocation="http://www.w3.org/2005/01/pronunciation-lexicon
        http://www.w3.org/TR/2007/CR-pronunciation-lexicon-20071212/pls.xsd"
      alphabet="ipa" xml:lang="he-IL">

  <!-- קָלְפָה — שם המותג. לא "קַלְפָּה", לא "קְלִיפָּה". -->
  <lexeme>
    <grapheme>קלפה</grapheme>
    <phoneme>kalˈfa</phoneme>
  </lexeme>

  <!-- נִגְבִּים — נלקח תשלום. השיבוש שדווח: "נְגָבִים". -->
  <lexeme>
    <grapheme>נגבים</grapheme>
    <phoneme>niɡˈbim</phoneme>
  </lexeme>

  <!-- דְּמֵי — "דמי הפעלה". לא "דָּמַי". -->
  <lexeme>
    <grapheme>דמי</grapheme>
    <phoneme>dmej</phoneme>
  </lexeme>

  <!-- הַפְעָלָה — דמי הפעלה חד-פעמיים. -->
  <lexeme>
    <grapheme>הפעלה</grapheme>
    <phoneme>hafʔaˈla</phoneme>
  </lexeme>

  <!-- תּוֹקְפּוֹ — תוקף של הצעה. לא "תּוֹקְפוֹ" (תוקף אותו). -->
  <lexeme>
    <grapheme>תוקפו</grapheme>
    <phoneme>tokˈpo</phoneme>
  </lexeme>

  <!-- אַחְרָיוּת — נאמר בגילוי המשפטי. -->
  <lexeme>
    <grapheme>אחריות</grapheme>
    <phoneme>aχʁaˈjut</phoneme>
  </lexeme>

  <!-- עוֹסֵק — "מספר עוסק". לא "עָסַק". -->
  <lexeme>
    <grapheme>עוסק</grapheme>
    <phoneme>oˈsek</phoneme>
  </lexeme>

  <!-- בִּיטּוּל — זכות הביטול תוך 14 יום, חובה חוקית. -->
  <lexeme>
    <grapheme>ביטול</grapheme>
    <phoneme>biˈtul</phoneme>
  </lexeme>

  <!-- הֶסְכֵּם — חוזה. לא "הִסְכִּים". -->
  <lexeme>
    <grapheme>הסכם</grapheme>
    <phoneme>hesˈkem</phoneme>
  </lexeme>

  <!-- הֶחְזֵר — החזר כספי. לא "הֶחְזִיר". -->
  <lexeme>
    <grapheme>החזר</grapheme>
    <phoneme>heχˈzeʁ</phoneme>
  </lexeme>

</lexicon>
