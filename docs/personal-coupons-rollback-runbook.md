# Runbook: נסיגה ממודל ההטבות האישיות (personal-coupons D8)

**הכלל:** חזרה לקוד של שלב 1 (לפני סבבי התמחור/ההטבות) מותרת **רק כל עוד אף קמפיין לא
נושא הטבה**. ברגע שהטבה ראשונה נקשרה — הנסיגה סגורה: הקוד הישן לא יודע להציג או לכבד
מחיר מוזל, וההקצאות והמחירים המוזלים נשארים במסד. כיבוי מתג הקופונים **אינו** פותח את
הנסיגה מחדש.

## השאילתה החוסמת — להריץ לפני כל נסיגה

```sql
-- כל קמפיין שנושא הטבה: קשורה/מומשה עליו, או רשומה בסבב תמחור כלשהו שלו.
select c.id as campaign_id, e.name as event_name, a.id as assignment_id, a.state
from public.campaigns c
join public.events e on e.id = c.event_id
join public.coupon_assignments a
  on a.bound_campaign_id = c.id and a.state in ('bound', 'consumed')
union
select c.id, e.name, p.coupon_assignment_id, 'in-round'
from public.campaign_pricing p
join public.campaigns c on c.id = p.campaign_id
join public.events e on e.id = c.event_id
where p.coupon_assignment_id is not null;
```

- **0 שורות** → נסיגה אפשרית.
- **יש שורות** → אלה הקמפיינים החוסמים. אין נסיגה בלי החלטה פרטנית לכל אחד (ההטבה
  והמחיר המוזל שלו הם התחייבות ללקוח).

הערות: הקשירה דרך `bound_campaign_id` תופסת גם הטבה שקושרה וטרם מומשה; הזרוע השנייה
תופסת גם סבבים היסטוריים (superseded) שנשאו הטבה — מחיר מוזל ששולם נשאר עובדה גם אחרי
החלפה. הקצאות שאינן קשורות לקמפיין (`assigned` בלבד) אינן חוסמות — הקוד הישן פשוט לא
יציג אותן.

אומת 13.10.2026 על המסד המקומי (openspec/changes/personal-coupons/verification-8-2.md):
קמפיין זרוע עם הטבה קשורה מופיע; קמפיין ביקורת בלי הטבה לא מופיע; הקצאות לא-קשורות לא
מופיעות.
