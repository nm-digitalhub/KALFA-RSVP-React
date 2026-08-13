import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { PageHeading } from '../../_components';
import { ConsolePhoneDev } from './_console-client';

// Stage-2 dev surface for the browser call-center: agent login only, zero
// telephony. Gate = console-agent membership itself (mirrors /api/agents/
// sdk-auth: being able to log in as yourself IS the membership — manage_voice
// would lock enrolled agents out of their own phone). The (admin) layout's
// requireAdmin already ran; console_me self-scopes to auth.uid().
export const metadata = { title: 'קונסולת נציג — התחברות' };

export default async function ConsoleDevPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: me } = await supabase
    .from('console_me')
    .select('vox_username, display_name')
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <PageHeading>קונסולת נציג</PageHeading>
        <p className="text-sm text-muted-foreground">
          התחברות ה-Web SDK של הטלפון בדפדפן (שלב 2 — ללא טלפוניה)
        </p>
      </div>
      {!me ? (
        <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          המשתמש הנוכחי אינו רשום כנציג מוקד. הרישום מתבצע בעמוד ניהול המשתמשים.
        </p>
      ) : !me.vox_username ? (
        <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          לנציג זה עדיין לא הוקצתה זהות טלפוניה. יש להריץ את ההקצאה מעמוד ניהול
          המשתמשים ולנסות שוב.
        </p>
      ) : (
        <ConsolePhoneDev
          voxUsername={me.vox_username}
          displayName={me.display_name ?? ''}
        />
      )}
    </div>
  );
}
