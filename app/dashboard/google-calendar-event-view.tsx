'use client';

import {useEffect, useMemo, useState} from 'react';

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  htmlLink?: string;
};
type View = 'month' | 'week' | 'list';
type Props = {
  timezone: string;
  connected: boolean;
  refreshKey: number;
  previewEvents: Array<{id: string; title: string; start: string}>;
};

const DAY_MS = 86400000;
const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const control = 'rounded-lg border border-[#987940] px-3 py-1.5 text-xs font-semibold text-[#f2dfb6] hover:bg-[#c6a455]/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#deb765]';

function dateFromKey(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`);
}
function keyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function moveDays(key: string, count: number): string {
  const d = dateFromKey(key);
  d.setUTCDate(d.getUTCDate() + count);
  return keyFromDate(d);
}
function moveMonths(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  return keyFromDate(new Date(Date.UTC(year, month - 1 + delta, 1, 12)));
}
function weekStart(key: string): string {
  const weekday = (dateFromKey(key).getUTCDay() + 6) % 7;
  return moveDays(key, -weekday);
}
function zonedDateKey(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const part = (type: string) => parts.find(p => p.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return keyFromDate(date);
  }
}
function dayTitle(key: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(dateFromKey(key));
}
function monthTitle(key: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', month: 'long', year: 'numeric',
  }).format(dateFromKey(key));
}
function timedLabel(event: CalendarEvent, timeZone: string): string {
  if (event.allDay) return 'All day';
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return 'Time unavailable';
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const begin = fmt.format(start);
  const end = event.end ? new Date(event.end) : null;
  return end && !Number.isNaN(end.getTime())
    ? `${begin}–${fmt.format(end)}`
    : begin;
}
function occursOn(event: CalendarEvent, key: string, timezone: string): boolean {
  if (event.allDay) {
    const from = event.start.slice(0, 10);
    const toExclusive = event.end?.slice(0, 10) || moveDays(from, 1);
    return from <= key && key < toExclusive;
  }
  const fromDate = new Date(event.start);
  if (Number.isNaN(fromDate.getTime())) return false;
  const startDay = zonedDateKey(fromDate, timezone);
  const endDate = event.end ? new Date(event.end) : null;
  const endDay = endDate && !Number.isNaN(endDate.getTime())
    ? zonedDateKey(new Date(Math.max(fromDate.getTime(), endDate.getTime() - 1)), timezone)
    : startDay;
  return startDay <= key && key <= endDay;
}
function safeEventLink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' &&
        (url.hostname === 'calendar.google.com' ||
         (url.hostname === 'www.google.com' && url.pathname.startsWith('/calendar/')))) {
      return url.href;
    }
  } catch { /* ignore malformed links */ }
  return null;
}

export default function GoogleCalendarEventView({timezone, connected, refreshKey, previewEvents}: Props) {
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => keyFromDate(new Date()));
  const [selected, setSelected] = useState(() => keyFromDate(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [limited, setLimited] = useState(false);
  const [truncated, setTruncated] = useState(false);

  // Set the initial day to the configured company's timezone after hydration.
  useEffect(() => {
    const today = zonedDateKey(new Date(), timezone);
    setCursor(today);
    setSelected(today);
  }, [timezone]);

  const window = useMemo(() => {
    const start = view === 'week'
      ? weekStart(cursor)
      : weekStart(`${cursor.slice(0, 7)}-01`);
    const days = view === 'week' ? 7 : 42;
    const keys = Array.from({length: days}, (_, index) => moveDays(start, index));
    // UTC padding ensures that all local-zone boundary events are retrieved,
    // even when the company's timezone changes offset for daylight saving.
    const from = new Date(`${moveDays(start, -1)}T00:00:00.000Z`).toISOString();
    const to = new Date(`${moveDays(start, days + 2)}T00:00:00.000Z`).toISOString();
    return {keys, from, to};
  }, [cursor, view]);

  useEffect(() => {
    if (!connected) return;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    setLimited(false);
    setTruncated(false);
    const query = new URLSearchParams({from: window.from, to: window.to});
    void (async () => {
      try {
        const response = await fetch(`/api/integrations/google-calendar/events?${query}`, {
          cache: 'no-store', signal: abort.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not load calendar');
        if (!Array.isArray(payload.events)) throw new Error('Invalid calendar event response');
        if (abort.signal.aborted) return;
        setEvents(payload.events);
        setTruncated(Boolean(payload.truncated));
      } catch (cause) {
        if (abort.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not load full calendar');
        // The older settings endpoint provides only eight upcoming events.
        // Keep them accessible, but clearly distinguish this from a full view.
        setEvents(previewEvents);
        setLimited(true);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [connected, window.from, window.to, refreshKey]);

  const eventDays = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const key of window.keys) map.set(key, []);
    for (const event of events) {
      for (const key of window.keys) {
        if (occursOn(event, key, timezone)) map.get(key)?.push(event);
      }
    }
    for (const day of map.values()) {
      day.sort((a, b) => Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) ||
        Date.parse(a.start) - Date.parse(b.start));
    }
    return map;
  }, [events, timezone, window.keys]);

  const today = zonedDateKey(new Date(), timezone);
  const currentMonth = cursor.slice(0, 7);
  const label = view === 'week'
    ? `${dayTitle(window.keys[0])} – ${dayTitle(window.keys[6])}`
    : monthTitle(cursor);
  const selectedEvents = eventDays.get(selected) || [];

  const move = (direction: number) => {
    const next = view === 'week' ? moveDays(cursor, 7 * direction) : moveMonths(cursor, direction);
    setCursor(next);
    setSelected(next);
  };
  const goToday = () => {
    const next = zonedDateKey(new Date(), timezone);
    setCursor(next);
    setSelected(next);
  };

  function eventRow(event: CalendarEvent, index: number) {
    const link = safeEventLink(event.htmlLink);
    return <div key={`${event.id}-${index}`} className="flex min-w-0 flex-col gap-1 rounded-lg border border-[#41556b] bg-[#14293d] px-2.5 py-2 text-xs text-[#f5f0e8]">
      <div className="break-words font-semibold">{link
        ? <a href={link} target="_blank" rel="noopener noreferrer" className="underline decoration-[#c6a455]/70 hover:text-[#f1d28c]">{event.title}</a>
        : event.title}</div>
      <div className="text-[#bacbd7]">{timedLabel(event, timezone)}</div>
    </div>;
  }

  return <section className="mt-5 rounded-xl border border-[#41556b] bg-[#0c192a] p-3 sm:p-4" aria-label="Google Calendar event viewer">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h4 className="text-sm font-semibold text-[#f1d28c]">Google Calendar</h4>
        <p className="mt-1 text-xs text-[#a8bfce]">Live events · {timezone} · Primary calendar</p>
      </div>
      <div role="group" aria-label="Calendar view" className="inline-flex gap-1 rounded-lg border border-[#41556b] p-1">
        {(['month', 'week', 'list'] as View[]).map(mode => <button
          key={mode} type="button" onClick={() => setView(mode)}
          aria-pressed={view === mode}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${view === mode ? 'bg-[#c6a455] text-[#0c192a]' : 'text-[#c8d5dc] hover:bg-[#23384b]'}`}
        >{mode === 'month' ? 'Month' : mode === 'week' ? 'Week' : 'List'}</button>)}
      </div>
    </div>

    <div className="my-4 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={control} onClick={() => move(-1)} aria-label="Previous period">←</button>
        <button type="button" className={control} onClick={goToday}>Today</button>
        <button type="button" className={control} onClick={() => move(1)} aria-label="Next period">→</button>
      </div>
      <span className="text-sm font-semibold text-[#f4e5c6]" aria-live="polite">{label}</span>
    </div>

    {loading && <p role="status" className="mb-3 text-xs text-[#b8d3e2]">Loading Google Calendar events…</p>}
    {error && <p role="alert" className="mb-3 rounded-lg border border-[#e48f80]/60 bg-[#522b30]/30 p-2 text-xs text-[#ffc0b6]">{error}. {limited ? 'Showing only the limited upcoming events from the existing connection.' : ''}</p>}
    {truncated && <p role="status" className="mb-3 text-xs text-[#f1d28c]">This period contains more than 1,000 events. Only the first 1,000 are displayed.</p>}

    {view === 'month' && <div className="overflow-x-auto rounded-lg border border-[#41556b]">
      <div className="grid min-w-[665px] grid-cols-7 bg-[#14293d] text-center text-xs font-semibold text-[#e2cc9e]">
        {weekdayLabels.map(day => <div key={day} className="border-b border-[#41556b] px-2 py-2">{day}</div>)}
      </div>
      <div className="grid min-w-[665px] grid-cols-7">
        {window.keys.map(day => {
          const dayEvents = eventDays.get(day) || [];
          const selectedDay = selected === day;
          return <button key={day} type="button" onClick={() => setSelected(day)}
            aria-pressed={selectedDay} aria-label={`${dayTitle(day)}, ${dayEvents.length} events`}
            className={`flex min-h-[96px] min-w-0 flex-col gap-1 border-b border-r border-[#32485d] px-1.5 py-1.5 text-left transition hover:bg-[#243d51] ${selectedDay ? 'bg-[#30465a] ring-2 ring-inset ring-[#dab66a]' : 'bg-[#102237]'} ${day.slice(0, 7) === currentMonth ? '' : 'opacity-50'}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${day === today ? 'bg-[#c6a455] text-[#0b1928]' : 'text-[#d7e4eb]'}`}>{Number(day.slice(-2))}</span>
            {dayEvents.slice(0, 2).map((event, index) => <span key={`${event.id}-${index}`} className="w-full truncate rounded bg-[#314a62] px-1.5 py-0.5 text-[10px] text-[#f6ddb0]" title={event.title}>{event.allDay ? '• ' : ''}{event.title}</span>)}
            {dayEvents.length > 2 && <span className="text-[10px] text-[#d6e4ed]">+{dayEvents.length - 2} more</span>}
          </button>;
        })}
      </div>
    </div>}

    {view === 'week' && <div className="overflow-x-auto rounded-lg border border-[#41556b]">
      <div className="grid min-w-[665px] grid-cols-7">
        {window.keys.map((day, index) => <div key={day} className={`min-h-[170px] border-r border-[#41556b] p-1.5 ${day === today ? 'bg-[#1c3445]' : 'bg-[#102237]'}`}>
          <button type="button" className={`mb-2 w-full rounded-md px-1 py-2 text-center text-xs font-semibold ${day === selected ? 'bg-[#c6a455] text-[#0b1928]' : 'text-[#f0ddaf] hover:bg-[#253e51]'}`} onClick={() => setSelected(day)}>
            {weekdayLabels[index]} {Number(day.slice(-2))}
          </button>
          <div className="space-y-1.5">
            {(eventDays.get(day) || []).slice(0, 5).map(eventRow)}
            {(eventDays.get(day) || []).length > 5 && <button type="button" onClick={() => setSelected(day)} className="text-xs text-[#f1d28c]">+{(eventDays.get(day) || []).length - 5} more below</button>}
          </div>
        </div>)}
      </div>
    </div>}

    {view === 'list' && <div className="max-h-[480px] space-y-3 overflow-y-auto rounded-lg border border-[#41556b] bg-[#102237] p-3">
      {window.keys.filter(day => (eventDays.get(day) || []).length > 0).map(day => <div key={day}>
        <h5 className="mb-2 text-xs font-semibold text-[#f1d28c]">{dayTitle(day)}</h5>
        <div className="grid gap-1.5 sm:grid-cols-2">{(eventDays.get(day) || []).map(eventRow)}</div>
      </div>)}
      {events.length === 0 && !loading && <p className="text-sm text-[#a8bfce]">No events in this period.</p>}
      {events.length > 0 && window.keys.every(day => !(eventDays.get(day) || []).length) && <p className="text-sm text-[#a8bfce]">No events in this period.</p>}
    </div>}

    {view !== 'list' && <div className="mt-4 rounded-lg border border-[#41556b] bg-[#12283b] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-sm font-semibold text-[#f1d28c]">{dayTitle(selected)}</h5>
        <span className="text-xs text-[#a9bdcb]">{selectedEvents.length} event{selectedEvents.length === 1 ? '' : 's'}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">{selectedEvents.map(eventRow)}</div>
      {!selectedEvents.length && <p className="text-xs text-[#a9bdcb]">No events scheduled for this day.</p>}
    </div>}
    <p className="mt-3 text-xs leading-5 text-[#91aabc]">Read-only event view. Bookings are controlled by the Google Calendar settings above. Times display in {timezone}. On small screens, scroll the calendar grid horizontally.</p>
  </section>;
}
