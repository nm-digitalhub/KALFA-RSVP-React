import { Command, InvalidArgumentError } from 'commander';

import { RDP_MINUTES_MAX, RDP_MINUTES_MIN, RDP_NOTE_MAX } from '../policy';
import type { RdpStatusFilter } from '../queries';
import {
  cmdApprove,
  cmdDeny,
  cmdList,
  cmdRevoke,
  cmdShow,
  cmdStatus,
  type CliContext,
  type ExitCode,
} from './commands';

// The commander definition of the owner CLI. Thin by design: it parses and validates the arguments and hands them
// to the command functions, nothing else. The context is created lazily (makeContext) so `--help` and argument
// errors never need the environment or a database connection.

export type ProgramDeps = {
  makeContext: () => CliContext;
  watch: (ctx: CliContext, intervalSeconds: number) => Promise<ExitCode>;
  /** Receives the exit code of the command that ran. */
  setExitCode: (code: ExitCode) => void;
  /** Applied to the root before the subcommands are created, so they inherit it (commander copies settings at creation). */
  configure?: (root: Command) => Command;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseMinutes(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < RDP_MINUTES_MIN || parsed > RDP_MINUTES_MAX) {
    throw new InvalidArgumentError(`יש להזין מספר שלם של דקות בין ${RDP_MINUTES_MIN} ל-${RDP_MINUTES_MAX}`);
  }
  return parsed;
}

function parseNote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > RDP_NOTE_MAX) throw new InvalidArgumentError(`ההערה ארוכה מדי (עד ${RDP_NOTE_MAX} תווים)`);
  return trimmed;
}

function parseOwnerId(value: string): string {
  if (!UUID.test(value)) throw new InvalidArgumentError('יש להזין מזהה משתמש מלא (uuid)');
  return value.toLowerCase();
}

function parseStatus(value: string): RdpStatusFilter {
  if (value === 'pending' || value === 'active' || value === 'all') return value;
  throw new InvalidArgumentError('הערכים האפשריים: pending, active, all');
}

function parseInterval(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 60) {
    throw new InvalidArgumentError('יש להזין מספר שלם של שניות בין 2 ל-60');
  }
  return parsed;
}

export function buildProgram(deps: ProgramDeps): Command {
  const run = async (fn: (ctx: CliContext) => Promise<ExitCode>) => {
    deps.setExitCode(await fn(deps.makeContext()));
  };

  const program = (deps.configure ?? ((root: Command) => root))(new Command())
    .name('rdp-access')
    .description('אישור בקשות גישה לשולחן העבודה מרחוק (הפעלה בשרת, בבעלי המערכת בלבד)')
    .showHelpAfterError();

  program
    .command('watch')
    .description('מסך אינטראקטיבי: בקשות ממתינות, אישור ודחייה במקשים')
    .option('--interval <seconds>', 'כל כמה שניות לרענן', parseInterval, 5)
    .action((opts: { interval: number }) => run((ctx) => deps.watch(ctx, opts.interval)));

  program
    .command('list')
    .description('רשימת בקשות')
    .option('--status <status>', 'pending | active | all', parseStatus, 'pending')
    .option('--json', 'פלט JSON', false)
    .action((opts: { status: RdpStatusFilter; json: boolean }) => run((ctx) => cmdList(ctx, opts)));

  program
    .command('show')
    .description('פרטי בקשה והיסטוריית האירועים שלה')
    .argument('<id>', 'מזהה הבקשה, מלא או לפחות 4 תווים ראשונים')
    .action((id: string) => run((ctx) => cmdShow(ctx, id)));

  program
    .command('status')
    .description('גישה פעילה, בקשות ממתינות והגדרות השער (בלי ערכי סודות)')
    .action(() => run((ctx) => cmdStatus(ctx)));

  program
    .command('approve')
    .description('אישור בקשה. בלי --minutes מאושר המשך שהתבקש')
    .argument('<id>', 'מזהה הבקשה, מלא או לפחות 4 תווים ראשונים')
    .option('--minutes <minutes>', `משך הגישה בדקות (${RDP_MINUTES_MIN}-${RDP_MINUTES_MAX})`, parseMinutes)
    .option('--note <text>', 'הערה שתישמר עם ההחלטה', parseNote, '')
    .option('--as <userId>', 'הבעלים המאשר, כשיש כמה בעלים', parseOwnerId)
    .option('--yes', 'בלי שאלת אישור', false)
    .action((id: string, opts: { minutes?: number; note: string; as?: string; yes: boolean }) =>
      run((ctx) => cmdApprove(ctx, { id, ...opts })),
    );

  program
    .command('deny')
    .description('דחיית בקשה')
    .argument('<id>', 'מזהה הבקשה, מלא או לפחות 4 תווים ראשונים')
    .option('--note <text>', 'הערה שתישמר עם ההחלטה', parseNote, '')
    .option('--as <userId>', 'הבעלים המחליט, כשיש כמה בעלים', parseOwnerId)
    .option('--yes', 'בלי שאלת אישור', false)
    .action((id: string, opts: { note: string; as?: string; yes: boolean }) => run((ctx) => cmdDeny(ctx, { id, ...opts })));

  program
    .command('revoke')
    .description('ביטול הגישה הפעילה וניתוק החיבורים החיים')
    .option('--reason <text>', 'סיבה שתישמר עם הביטול', parseNote, '')
    .option('--as <userId>', 'הבעלים המבטל, כשיש כמה בעלים', parseOwnerId)
    .option('--yes', 'בלי שאלת אישור', false)
    .action((opts: { reason: string; as?: string; yes: boolean }) => run((ctx) => cmdRevoke(ctx, opts)));

  return program;
}
