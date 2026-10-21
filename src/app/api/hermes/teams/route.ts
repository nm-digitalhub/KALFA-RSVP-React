// src/app/api/hermes/teams/route.ts

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

const HERMES_ENDPOINT = 'http://127.0.0.1:3978/api/messages';

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization');

  // Bot Framework requests are authenticated using Bearer tokens.
  // Hermes must still validate the token itself.
  if (!authorization?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const headers = new Headers({
    authorization,
  });

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers.set('content-type', contentType);
  }

  try {
    const upstream = await fetch(HERMES_ENDPOINT, {
      method: 'POST',
      headers,
      body: await request.arrayBuffer(),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });

    const responseHeaders = new Headers({
      'Cache-Control': 'no-store',
    });

    const upstreamContentType = upstream.headers.get('content-type');
    if (upstreamContentType) {
      responseHeaders.set('content-type', upstreamContentType);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response('Hermes gateway unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
