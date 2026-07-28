// Outlook's category palette.
//
// TWO CLAIMS OF DIFFERENT STRENGTH LIVE HERE — do not conflate them.
//
// 1. INDEX → NAME is authoritative. The mailbox's master category list stores
//    `color="N"`, and N is `OlCategoryColor` minus one. Confirmed two ways on
//    28.07.2026: the enumeration published by Microsoft (Red=1, Orange=2,
//    Peach=3, Yellow=4, Green=5, Teal=6, Olive=7, Blue=8, Purple=9 …), and the
//    live list read out of this mailbox, which carries exactly
//    Red=0, Orange=1, Yellow=3, Green=4, Blue=7, Purple=8 — the same sequence
//    shifted by one, including the gaps where Peach, Teal and Olive sit.
//
// 2. NAME → HEX is OURS, and it is an approximation. Microsoft does not publish
//    RGB values for these categories; its own documentation calls the constants
//    "approximations of the actual colors" and directs callers to read
//    CategoryBorderColor / CategoryGradientTopColor at runtime — properties of
//    the Outlook COM object model, which EWS does not expose. So the swatch
//    shown to the owner is the colour FAMILY Outlook named, not a pixel match
//    to what Outlook draws. Anyone tempted to "fix" a shade here should know
//    there is no authoritative value to fix it to.
//
// Indices beyond what a mailbox actually uses are still listed: the list is the
// user's to edit in Outlook, and an unknown index must degrade to "no colour"
// rather than to a wrong one.

export type OutlookCategoryColor = {
  /** The English colour name Outlook gives this slot. */
  name: string;
  /** Hebrew label for the picker. */
  label: string;
  /** Approximate swatch — see note 2 above. */
  hex: string;
};

export const OUTLOOK_CATEGORY_COLORS: readonly OutlookCategoryColor[] = [
  { name: 'Red', label: 'אדום', hex: '#e5484d' },
  { name: 'Orange', label: 'כתום', hex: '#f76b15' },
  { name: 'Peach', label: 'אפרסק', hex: '#ffb27a' },
  { name: 'Yellow', label: 'צהוב', hex: '#f5d90a' },
  { name: 'Green', label: 'ירוק', hex: '#46a758' },
  { name: 'Teal', label: 'טורקיז', hex: '#12a594' },
  { name: 'Olive', label: 'זית', hex: '#a8b545' },
  { name: 'Blue', label: 'כחול', hex: '#3e63dd' },
  { name: 'Purple', label: 'סגול', hex: '#8e4ec6' },
  { name: 'Maroon', label: 'בורדו', hex: '#c2298a' },
  { name: 'Steel', label: 'פלדה', hex: '#8da4c0' },
  { name: 'Dark Steel', label: 'פלדה כהה', hex: '#5a7290' },
  { name: 'Gray', label: 'אפור', hex: '#9ca3af' },
  { name: 'Dark Gray', label: 'אפור כהה', hex: '#5f6672' },
  { name: 'Black', label: 'שחור', hex: '#2b2f36' },
  { name: 'Dark Red', label: 'אדום כהה', hex: '#a32a2e' },
  { name: 'Dark Orange', label: 'כתום כהה', hex: '#b04a0b' },
  { name: 'Dark Peach', label: 'אפרסק כהה', hex: '#c9825a' },
  { name: 'Dark Yellow', label: 'צהוב כהה', hex: '#b39a06' },
  { name: 'Dark Green', label: 'ירוק כהה', hex: '#2f7a3e' },
  { name: 'Dark Teal', label: 'טורקיז כהה', hex: '#0d7a6d' },
  { name: 'Dark Olive', label: 'זית כהה', hex: '#7a8531' },
  { name: 'Dark Blue', label: 'כחול כהה', hex: '#2c47a0' },
  { name: 'Dark Purple', label: 'סגול כהה', hex: '#68389a' },
  { name: 'Dark Maroon', label: 'בורדו כהה', hex: '#8f1e65' },
];

/**
 * The swatch for a stored colour index, or null when there is no colour.
 *
 * Null covers three real cases that must all render the same neutral marker: a
 * category the owner created without a colour, an index this table does not
 * know (a newer Outlook palette), and a category name carried by an appointment
 * that is absent from the mailbox's list altogether.
 */
export function categoryColorHex(colorIndex: number | null | undefined): string | null {
  if (colorIndex === null || colorIndex === undefined) return null;
  return OUTLOOK_CATEGORY_COLORS[colorIndex]?.hex ?? null;
}
