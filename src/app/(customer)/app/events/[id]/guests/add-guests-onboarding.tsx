import Link from 'next/link';
import { FileSpreadsheet, Info, UserPlus } from 'lucide-react';

import { WhatsappIcon } from '@/components/icons/mdi-whatsapp';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  CAMPAIGN_STAGE_LABELS,
  CAMPAIGN_STAGE_VARIANTS,
  type CampaignStage,
} from '@/lib/data/event-labels';

// The guests page in its FIRST-RUN state: the event has no guest rows at all
// (`totals.rows === 0`), so instead of a filter bar with nothing to filter and a
// dashed "no guests" box, the page asks the one question that matters — how the
// owner wants to get their list in. Rendered INSTEAD of the whole guests
// content area; the app topbar/layout is untouched.
//
// Deliberately NOT shown for "the filter matched nothing" or "this page is past
// the last one" — both mean the event HAS guests (see page.tsx), and hiding the
// search there would trap an owner behind their own filter.
//
// `stage` is null when the viewer may see guests but not campaigns
// (getCampaignStageForEvent) — the badge is then simply omitted.
interface AddGuestsOnboardingProps {
  eventId: string;
  eventName: string;
  stage: CampaignStage | null;
}

interface OptionProps {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  /** The recommended path: filled button, tinted card, "הכי מהיר" tag. */
  primary?: boolean;
}

function Option({ href, icon, title, description, cta, primary }: OptionProps) {
  return (
    <div
      className={
        primary
          ? 'flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4'
          : 'flex flex-col gap-3 rounded-xl border border-border bg-card p-4'
      }
    >
      {primary ? <Badge variant="default" className="self-start">הכי מהיר</Badge> : null}
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/50 text-primary"
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {/* cn(), not buttonVariants({ className }): the raw cva fn concatenates
          without tailwind-merge, so the primary-toned border below would sit
          next to the outline variant's `border-border` and the winner would fall
          out of CSS order. cn() merges them deterministically.
          The purple outline itself is the reference design, not a workaround —
          the missing-border bug it once compensated for is fixed at the source
          in components/ui/button.tsx. */}
      <Link
        href={href}
        className={cn(
          buttonVariants({ variant: primary ? 'default' : 'outline' }),
          'h-11 w-full',
          !primary && 'border-primary/50 text-primary hover:text-primary',
        )}
      >
        {cta}
      </Link>
    </div>
  );
}

export function AddGuestsOnboarding({
  eventId,
  eventName,
  stage,
}: AddGuestsOnboardingProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">הוספת מוזמנים</h1>
        <p className="text-sm text-muted-foreground">{eventName}</p>
        {/* The real campaign stage, not a hardcoded "פעיל": an owner adding
            guests before the campaign is live should see that nothing is being
            sent yet. Same derived stage the manage and stats pages show. */}
        {stage ? (
          <Badge variant={CAMPAIGN_STAGE_VARIANTS[stage]}>
            {stage === 'active' ? 'הקמפיין פעיל' : CAMPAIGN_STAGE_LABELS[stage]}
          </Badge>
        ) : null}
      </div>

      <h2 className="text-center font-semibold">איך תרצו להוסיף מוזמנים?</h2>

      <div className="flex flex-col gap-3">
        <Option
          primary
          href={`/app/events/${eventId}/guests/import/whatsapp`}
          /* The registry component defaults to fill=none + stroke, but the MDI
             path is a SOLID glyph — stroking it outlines the silhouette twice.
             Fill it and drop the stroke; both are spread props, so the generated
             file stays untouched. */
          icon={<WhatsappIcon size={20} fill="currentColor" strokeWidth={0} />}
          title="ייבוא דרך WhatsApp"
          description="שלחו אנשי קשר או קובץ ל־KALFA וקבלו קישור לסקירה"
          cta="פתיחת וואטסאפ"
        />
        <Option
          href={`/app/events/${eventId}/guests/import`}
          icon={<FileSpreadsheet className="size-5" />}
          title="ייבוא מקובץ"
          description="CSV או Excel"
          cta="בחירת קובץ"
        />
        <Option
          href={`/app/events/${eventId}/guests/new`}
          icon={<UserPlus className="size-5" />}
          title="הוספה ידנית"
          description="הוסיפו מוזמן אחד בכל פעם"
          cta="מוזמן חדש"
        />
      </div>

      {/* The question every owner has at this exact moment: "if I upload my
          contacts, does KALFA start messaging them?" — answered before it is
          asked. True of every path above: each one ends in a review screen. */}
      <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
        <Info aria-hidden className="size-4 shrink-0 text-primary" />
        שום הודעה לא תישלח לפני שתאשרו את הרשימה.
      </p>

      <Link
        href={`/app/events/${eventId}`}
        className="text-center text-sm font-medium text-primary hover:underline"
      >
        אעשה זאת אחר כך
      </Link>
    </div>
  );
}
