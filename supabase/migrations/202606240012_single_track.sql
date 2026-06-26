-- KALFA offers a SINGLE service track for now (one canonical template; all
-- tracks include both channels). The admin can add more tracks later (Phase 6).
-- Keep the one track, deactivate the second placeholder.
update public.packages
set name = 'אישורי הגעה — וואטסאפ + שיחות AI',
    description = 'שירות אישורי הגעה מלא: פנייה לכל איש קשר בוואטסאפ ובשיחת AI, חיוב רק לפי אנשי קשר שהושגו ועד לתקרה המאושרת.'
where tier = 'outcome_whatsapp';

update public.packages
set active = false
where tier = 'outcome_full';
