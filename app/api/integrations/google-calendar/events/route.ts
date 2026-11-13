import {NextRequest, NextResponse} from 'next/server';
import {owner, ownerBlob, ownerAccess} from '@/lib/intrigue-google-calendar';

// Read-only calendar browsing. All requests use the existing authenticated
// company-owner connection and never expose OAuth credentials to the browser.
const NO_CACHE = {'Cache-Control': 'private, no-store'};
const MAX_WINDOW_MS = 50 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 4;
const MAX_RESULTS_PER_PAGE = 250;
const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function json(value: unknown, status = 200) {
  return NextResponse.json(value, {status, headers: NO_CACHE});
}

function approvedGoogleLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1500) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' &&
      (url.hostname === 'calendar.google.com' ||
       (url.hostname === 'www.google.com' && url.pathname.startsWith('/calendar/')))) {
      return url.href;
    }
  } catch { /* ignore malformed or unexpected provider links */ }
  return undefined;
}

type RawEvent = {
  id?: string;
  summary?: string;
  status?: string;
  start?: {dateTime?: string; date?: string};
  end?: {dateTime?: string; date?: string};
  htmlLink?: string;
};

export async function GET(request: NextRequest) {
  const ctx = await owner();
  if (!ctx) return json({error: 'Company owner required'}, 403);

  const from = request.nextUrl.searchParams.get('from') || '';
  const to = request.nextUrl.searchParams.get('to') || '';
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);

  if (!isoUtc.test(from) || !isoUtc.test(to) ||
      !Number.isFinite(fromMs) || !Number.isFinite(toMs) ||
      new Date(fromMs).toISOString() !== from ||
      new Date(toMs).toISOString() !== to ||
      toMs <= fromMs || toMs - fromMs > MAX_WINDOW_MS) {
    return json({error: 'Provide a valid calendar window of at most 50 days'}, 400);
  }

  try {
    if (!await ownerBlob(ctx)) {
      return json({error: 'Connect Google Calendar first', connected: false}, 409);
    }
    const access = await ownerAccess(ctx);
    if (!access) throw new Error('Google Calendar authorization unavailable');

    const events: Array<{
      id: string; title: string; start: string; end: string;
      allDay: boolean; htmlLink?: string;
    }> = [];
    let nextPageToken: string | undefined;
    let page = 0;

    do {
      const params = new URLSearchParams({
        timeMin: from,
        timeMax: to,
        singleEvents: 'true',
        showDeleted: 'false',
        orderBy: 'startTime',
        maxResults: String(MAX_RESULTS_PER_PAGE),
        fields: 'nextPageToken,items(id,summary,status,start(dateTime,date),end(dateTime,date),htmlLink)',
      });
      if (nextPageToken) params.set('pageToken', nextPageToken);

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        {
          headers: {Authorization: `Bearer ${access}`},
          cache: 'no-store',
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!response.ok) throw new Error(`Google Calendar events unavailable (${response.status})`);
      const payload = await response.json() as {
        items?: RawEvent[];
        nextPageToken?: string;
      };
      if (!Array.isArray(payload.items)) throw new Error('Unexpected Google Calendar events response');

      for (const item of payload.items) {
        if (item.status === 'cancelled' || !item.id) continue;
        const allDay = !item.start?.dateTime && !!item.start?.date;
        const start = allDay ? item.start?.date : item.start?.dateTime;
        const end = allDay ? item.end?.date : item.end?.dateTime;
        if (!start || !end) continue;
        const link = approvedGoogleLink(item.htmlLink);
        const event = {
          id: item.id,
          title: (item.summary || 'Busy').slice(0, 120),
          start,
          end,
          allDay,
          ...(link ? {htmlLink: link} : {}),
        };
        events.push(event);
      }
      page += 1;
      nextPageToken = payload.nextPageToken;
    } while (nextPageToken && page < MAX_PAGES);

    return json({
      connected: true,
      from,
      to,
      events,
      truncated: !!nextPageToken,
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'Could not load calendar events',
    }, 502);
  }
}
