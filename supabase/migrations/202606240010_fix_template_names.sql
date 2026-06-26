-- Correction: EVERY service track includes BOTH channels — WhatsApp AND AI calls
-- (§1: KALFA provides RSVP via the two channels together). The earlier seed names
-- wrongly implied a WhatsApp-only track. Tracks differ by service level (attempts/
-- reminders/price), NOT by channel. (Prices remain placeholders pending KALFA's
-- real commercial pricing via the admin templates screen.)
update public.packages
set name = 'מסלול בסיסי — אישורי הגעה (וואטסאפ + שיחות AI)',
    description = 'פנייה משולבת בוואטסאפ ובשיחת AI, סבב תזכורות אחד. חיוב רק לפי אנשי קשר שהושגו.'
where tier = 'outcome_whatsapp';

update public.packages
set name = 'מסלול מורחב — אישורי הגעה (וואטסאפ + שיחות AI)',
    description = 'פנייה משולבת בוואטסאפ ובשיחת AI, מספר סבבי תזכורות והסלמה. חיוב רק לפי אנשי קשר שהושגו.'
where tier = 'outcome_full';
