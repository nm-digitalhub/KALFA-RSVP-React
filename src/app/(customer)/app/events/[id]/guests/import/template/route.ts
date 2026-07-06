import { NextResponse } from 'next/server';
import { unstable_rethrow } from 'next/navigation';

import { requireEventAccess } from '@/lib/data/events';

import {
  buildTemplateCsv,
  TEMPLATE_DOWNLOAD_FILENAME,
} from '../template-content';

// GET /app/events/[id]/guests/import/template — the ready-made import
// template. No guest data leaves the server here; ownership is still enforced
// for consistency with every other event-scoped handler.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await requireEventAccess(id, 'guests', 'create');
  } catch (err) {
    unstable_rethrow(err);
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(buildTemplateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // RFC 5987 filename* carries the Hebrew name; the plain filename is an
      // ASCII fallback for agents that ignore filename*.
      'Content-Disposition': `attachment; filename="kalfa-guests-template.csv"; filename*=UTF-8''${encodeURIComponent(TEMPLATE_DOWNLOAD_FILENAME)}`,
    },
  });
}
