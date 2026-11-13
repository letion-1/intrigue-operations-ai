'use client';

import {useEffect, useMemo, useState} from 'react';
const CALENDAR_UI_CSS = String.raw`
/* Scoped calendar presentation: no changes to global dashboard, booking forms or APIs. */
.icv {
  --icv-bg: #fffdf9;
  --icv-panel: #f9f5ec;
  --icv-panel-alt: #f3eadb;
  --icv-border: #e2d8c8;
  --icv-text: #192d40;
  --icv-muted: #607080;
  --icv-gold: #b78e45;
  --icv-gold-strong: #9e6f22;
  --icv-chip: #efe3ce;
  --icv-chip-text: #58451f;
  --icv-selected: #fcf0d9;
  --icv-focus: #bb9142;
  color: var(--icv-text);
  background: var(--icv-bg);
  border: 1px solid var(--icv-border);
  border-radius: 18px;
  margin-top: 20px;
  min-width: 0;
  max-width: 100%;
  padding: 20px;
  box-shadow: 0 12px 32px rgb(31 34 40 / 5%);
}
[data-intrigue-theme="dark"] .icv {
  --icv-bg: #0c1d30;
  --icv-panel: #14293e;
  --icv-panel-alt: #1a3549;
  --icv-border: #375169;
  --icv-text: #f4eee5;
  --icv-muted: #b5c5d3;
  --icv-gold: #d0aa62;
  --icv-gold-strong: #f0ca81;
  --icv-chip: #294359;
  --icv-chip-text: #f4ddb3;
  --icv-selected: #203c50;
  --icv-focus: #dfb971;
  box-shadow: none;
}
.icv *, .icv *::before, .icv *::after { box-sizing: border-box; }
.icv button { font: inherit; cursor: pointer; }
.icv button:focus-visible, .icv a:focus-visible, .icv__month-scroll:focus-visible {
  outline: 3px solid var(--icv-focus); outline-offset: 2px;
}
.icv__header, .icv__toolbar, .icv__agenda-heading, .icv__day-top {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
}
.icv__header { flex-wrap: wrap; }
.icv__heading { min-width: 0; }
.icv__eyebrow { font-size: 10px; font-weight: 800; letter-spacing: .13em; color: var(--icv-gold-strong); }
.icv__heading h4 { font-size: 23px; line-height: 1.25; font-weight: 700; letter-spacing: -.03em; margin: 5px 0 2px; color: var(--icv-text); }
.icv__heading p { margin: 0; font-size: 12px; color: var(--icv-muted); overflow-wrap: anywhere; }
.icv__view-switch { display: flex; gap: 3px; padding: 4px; border-radius: 11px; background: var(--icv-panel); border: 1px solid var(--icv-border); }
.icv__view-switch button { color: var(--icv-text); border: 0; border-radius: 8px; background: transparent; min-width: 65px; padding: 9px 12px; font-size: 12px; font-weight: 700; }
.icv__view-switch button.icv__switch-active { background: var(--icv-gold); color: #172437; }
.icv__view-switch button:not(.icv__switch-active):hover { background: var(--icv-panel-alt); }
.icv__toolbar { margin: 21px 0 13px; flex-wrap: wrap; }
.icv__toolbar h5 { font-size: 17px; font-weight: 700; margin: 0; color: var(--icv-text); }
.icv__nav { display: flex; align-items: center; gap: 5px; }
.icv__nav button { border: 1px solid var(--icv-border); border-radius: 8px; background: var(--icv-bg); color: var(--icv-text); min-width: 33px; height: 34px; font-size: 24px; line-height: 1; }
.icv__nav button:hover { background: var(--icv-panel); }
.icv__nav .icv__today { font-size: 12px; font-weight: 700; padding: 0 12px; }
.icv__read-only { border: 1px solid var(--icv-border); border-radius: 100px; padding: 5px 9px; color: var(--icv-muted); font-size: 10px; font-weight: 700; }
.icv__notice { border-radius: 9px; padding: 10px 12px; margin: 0 0 10px; color: var(--icv-text); background: var(--icv-panel); font-size: 12px; }
.icv__notice-error { border: 1px solid #d46a59; }
.icv__month-scroll { border-radius: 12px; border: 1px solid var(--icv-border); overflow-x: auto; max-width: 100%; }
.icv__weekdays, .icv__month-grid { min-width: 740px; display: grid; grid-template-columns: repeat(7,minmax(0,1fr)); }
.icv__weekdays { background: var(--icv-panel); border-bottom: 1px solid var(--icv-border); }
.icv__weekdays > div { color: var(--icv-muted); font-size: 11px; font-weight: 800; text-align: center; padding: 12px 4px; }
.icv__day { min-width: 0; height: 124px; padding: 9px 7px; text-align: left; border: 0; border-right: 1px solid var(--icv-border); border-bottom: 1px solid var(--icv-border); background: var(--icv-bg); color: var(--icv-text); display: flex; flex-direction: column; gap: 8px; position: relative; }
.icv__day:nth-child(7n) { border-right: 0; }
.icv__day:hover { background: var(--icv-panel); }
.icv__day-selected, .icv__day-selected:hover { background: var(--icv-selected); box-shadow: inset 0 0 0 2px var(--icv-gold); }
.icv__day-outside { opacity: .52; }
.icv__day-top { width: 100%; min-height: 24px; }
.icv__date { display: inline-flex; width: 27px; height: 27px; border-radius: 50%; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; color: var(--icv-text); }
.icv__date-today { background: var(--icv-gold); color: #142334; }
.icv__day-count { font-size: 11px; font-weight: 800; color: var(--icv-muted); background: var(--icv-panel); min-width: 23px; padding: 3px 6px; border-radius: 100px; text-align: center; }
.icv__day-events { width: 100%; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.icv__month-chip { display: flex; align-items: start; min-width: 0; max-width: 100%; border-radius: 5px; background: var(--icv-chip); color: var(--icv-chip-text); padding: 5px; gap: 5px; font-size: 10px; line-height: 1.3; font-weight: 650; }
.icv__month-chip > span:last-child { min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.icv__chip-dot { background: var(--icv-gold); width: 5px; height: 5px; flex: 0 0 5px; border-radius: 50%; margin-top: 4px; }
.icv__day-more { font-size: 10px; color: var(--icv-muted); font-weight: 700; }
.icv__selected-agenda { margin-top: 16px; background: var(--icv-panel); border: 1px solid var(--icv-border); border-radius: 12px; padding: 16px; }
.icv__agenda-heading { margin-bottom: 12px; flex-wrap: wrap; }
.icv__agenda-heading h6 { margin: 4px 0 0; font-size: 18px; font-weight: 700; color: var(--icv-text); }
.icv__agenda-count { color: var(--icv-muted); font-size: 12px; }
.icv__agenda-events { display: grid; gap: 9px; }
.icv__agenda-event { display: flex; align-items: flex-start; gap: 13px; background: var(--icv-bg); border: 1px solid var(--icv-border); border-radius: 10px; padding: 13px 14px; min-width: 0; }
.icv__event-time { min-width: 104px; flex: 0 0 104px; color: var(--icv-gold-strong); font-weight: 800; font-size: 12px; line-height: 1.6; }
.icv__event-copy { min-width: 0; flex: 1; }
.icv__event-title { display: block; color: var(--icv-text); font-size: 14px; line-height: 1.5; font-weight: 650; overflow-wrap: anywhere; }
.icv__event-link { text-decoration: underline; text-decoration-color: var(--icv-gold); text-underline-offset: 3px; }
.icv__empty, .icv__empty-inline { font-size: 13px; color: var(--icv-muted); margin: 0; padding: 10px 0; }
.icv__week-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit,minmax(min(100%,280px),1fr)); }
.icv__week-card { border: 1px solid var(--icv-border); border-radius: 12px; padding: 14px; background: var(--icv-panel); min-width: 0; }
.icv__week-today { border-color: var(--icv-gold); }
.icv__week-heading { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; border: 0; padding: 0 0 11px; background: transparent; color: var(--icv-text); border-bottom: 1px solid var(--icv-border); }
.icv__week-heading strong { font-size: 14px; }
.icv__week-heading span { color: var(--icv-muted); font-size: 11px; }
.icv__week-items { display: grid; gap: 8px; padding-top: 12px; }
.icv__week-items .icv__agenda-event { display: block; padding: 10px; }
.icv__week-items .icv__event-time { display: block; margin-bottom: 5px; }
.icv__week-items .icv__event-title { font-size: 13px; }
.icv__list { max-height: 630px; overflow-y: auto; background: var(--icv-panel); border: 1px solid var(--icv-border); border-radius: 12px; padding: 16px; }
.icv__list-day + .icv__list-day { border-top: 1px solid var(--icv-border); padding-top: 16px; margin-top: 16px; }
.icv__list-day h6 { font-size: 14px; font-weight: 800; color: var(--icv-text); margin: 0 0 9px; }
.icv__footer { margin: 13px 0 0; line-height: 1.6; color: var(--icv-muted); font-size: 11px; }
@media (max-width: 650px) {
  .icv { padding: 14px; }
  .icv__header { align-items: flex-start; }
  .icv__view-switch { width: 100%; justify-content: space-around; }
  .icv__view-switch button { flex: 1; }
  .icv__toolbar h5 { order: -1; width: 100%; }
  .icv__read-only { margin-left: auto; }
  .icv__agenda-event { display: block; }
  .icv__event-time { display: block; margin-bottom: 4px; }
}
`;

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  htmlLink?: string;
};
type CalendarView = 'month' | 'week' | 'list';
type Props = {
  timezone: string;
  connected: boolean;
  refreshKey: number;
  previewEvents: Array<{id: string; title: string; start: string}>;
};

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dateFromKey = (key: string) => new Date(`${key}T12:00:00.000Z`);
const keyFromDate = (date: Date) => date.toISOString().slice(0, 10);

function moveDays(key: string, count: number) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + count);
  return keyFromDate(date);
}
function moveMonths(key: string, count: number) {
  const [year, month] = key.split('-').map(Number);
  return keyFromDate(new Date(Date.UTC(year, month - 1 + count, 1, 12)));
}
function weekStart(key: string) {
  return moveDays(key, -((dateFromKey(key).getUTCDay() + 6) % 7));
}
function zonedDateKey(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = (name: string) => parts.find(part => part.type === name)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch { return keyFromDate(date); }
}
function formatDate(key: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', ...options}).format(dateFromKey(key));
}
function timeLabel(event: CalendarEvent, timezone: string) {
  if (event.allDay) return 'All day';
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return 'Time unavailable';
  const end = event.end ? new Date(event.end) : null;
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    return end && !Number.isNaN(end.getTime())
      ? `${fmt.format(start)}–${fmt.format(end)}` : fmt.format(start);
  } catch {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    return fmt.format(start);
  }
}
function occursOn(event: CalendarEvent, key: string, timezone: string) {
  if (event.allDay) {
    const from = event.start.slice(0, 10);
    const toExclusive = event.end?.slice(0, 10) || moveDays(from, 1);
    return from <= key && key < toExclusive;
  }
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return false;
  const startKey = zonedDateKey(start, timezone);
  const end = event.end ? new Date(event.end) : null;
  const last = end && !Number.isNaN(end.getTime())
    ? zonedDateKey(new Date(Math.max(start.getTime(), end.getTime() - 1)), timezone)
    : startKey;
  return startKey <= key && key <= last;
}
function trustedEventLink(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && (
      url.hostname === 'calendar.google.com' ||
      (url.hostname === 'www.google.com' && url.pathname.startsWith('/calendar/'))
    )) return url.href;
  } catch { /* reject invalid links */ }
  return null;
}
function titleOf(event: CalendarEvent) {
  return typeof event.title === 'string' && event.title.trim()
    ? event.title.trim() : 'Busy event';
}

export default function GoogleCalendarEventView({timezone, connected, refreshKey, previewEvents}: Props) {
  const [view, setView] = useState<CalendarView>('month');
  const [cursor, setCursor] = useState(() => keyFromDate(new Date()));
  const [selected, setSelected] = useState(() => keyFromDate(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [limited, setLimited] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const localToday = zonedDateKey(new Date(), timezone);
    setCursor(localToday);
    setSelected(localToday);
  }, [timezone]);

  const range = useMemo(() => {
    let keys: string[];
    if (view === 'week') {
      const start = weekStart(cursor);
      keys = Array.from({length: 7}, (_, index) => moveDays(start, index));
    } else if (view === 'list') {
      const [year, month] = cursor.split('-').map(Number);
      const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
      keys = Array.from({length: dayCount}, (_, index) => `${cursor.slice(0, 7)}-${String(index + 1).padStart(2, '0')}`);
    } else {
      const first = weekStart(`${cursor.slice(0, 7)}-01`);
      const [year, month] = cursor.split('-').map(Number);
      const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const offset = (dateFromKey(`${cursor.slice(0, 7)}-01`).getUTCDay() + 6) % 7;
      const cells = Math.ceil((dayCount + offset) / 7) * 7;
      keys = Array.from({length: cells}, (_, index) => moveDays(first, index));
    }
    const from = new Date(`${moveDays(keys[0], -1)}T00:00:00.000Z`).toISOString();
    const to = new Date(`${moveDays(keys[keys.length - 1], 3)}T00:00:00.000Z`).toISOString();
    return {keys, from, to};
  }, [cursor, view]);

  useEffect(() => {
    if (!connected) { setEvents([]); setError(''); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setLimited(false); setTruncated(false);
    const params = new URLSearchParams({from: range.from, to: range.to});
    void (async () => {
      try {
        const response = await fetch(`/api/integrations/google-calendar/events?${params}`, {
          cache: 'no-store', signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not load calendar');
        if (!Array.isArray(payload.events)) throw new Error('Invalid calendar response');
        if (controller.signal.aborted) return;
        setEvents(payload.events);
        setTruncated(Boolean(payload.truncated));
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not load calendar');
        setEvents(previewEvents);
        setLimited(true);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [connected, range.from, range.to, refreshKey]);

  const eventDays = useMemo(() => {
    const output = new Map<string, CalendarEvent[]>();
    for (const key of range.keys) output.set(key, []);
    for (const event of events) {
      for (const key of range.keys) {
        if (occursOn(event, key, timezone)) output.get(key)?.push(event);
      }
    }
    for (const day of output.values()) {
      day.sort((a, b) => Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) ||
        (Date.parse(a.start) || 0) - (Date.parse(b.start) || 0));
    }
    return output;
  }, [events, range.keys, timezone]);

  const today = zonedDateKey(new Date(), timezone);
  const selectedEvents = eventDays.get(selected) || [];
  const periodTitle = view === 'week'
    ? `${formatDate(range.keys[0], {day: 'numeric', month: 'short'})} – ${formatDate(range.keys[6], {day: 'numeric', month: 'short', year: 'numeric'})}`
    : formatDate(cursor, {month: 'long', year: 'numeric'});

  function selectDay(key: string) {
    setSelected(key);
    // Selecting an adjacent-month day keeps the detail pane in sync with its month.
    if (key.slice(0, 7) !== cursor.slice(0, 7) && view !== 'week') setCursor(key);
  }
  function move(direction: number) {
    const next = view === 'week' ? moveDays(cursor, 7 * direction) : moveMonths(cursor, direction);
    setCursor(next);
    setSelected(next);
  }
  function goToday() {
    const next = zonedDateKey(new Date(), timezone);
    setCursor(next); setSelected(next);
  }
  function agendaEvent(event: CalendarEvent, index: number) {
    const link = trustedEventLink(event.htmlLink);
    const heading = titleOf(event);
    return <div className="icv__agenda-event" key={`${event.id}-${index}`}>
      <span className="icv__event-time">{timeLabel(event, timezone)}</span>
      <div className="icv__event-copy">
        {link
          ? <a href={link} target="_blank" rel="noopener noreferrer" className="icv__event-title icv__event-link">{heading}</a>
          : <span className="icv__event-title">{heading}</span>}
      </div>
    </div>;
  }

  return <section className="icv" aria-label="Google Calendar event viewer">
    <style>{CALENDAR_UI_CSS}</style>
    <div className="icv__header">
      <div className="icv__heading">
        <div className="icv__eyebrow">CONNECTED CALENDAR</div>
        <h4>Schedule</h4>
        <p>Google Calendar <span aria-hidden="true">·</span> {timezone}</p>
      </div>
      <div className="icv__view-switch" role="group" aria-label="Calendar view">
        {(['month', 'week', 'list'] as CalendarView[]).map(mode => <button
          key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}
          className={view === mode ? 'icv__switch-active' : ''}
        >{mode === 'month' ? 'Month' : mode === 'week' ? 'Week' : 'Agenda'}</button>)}
      </div>
    </div>

    <div className="icv__toolbar">
      <div className="icv__nav" aria-label="Calendar navigation">
        <button type="button" onClick={() => move(-1)} aria-label="Previous period">‹</button>
        <button type="button" onClick={goToday} className="icv__today">Today</button>
        <button type="button" onClick={() => move(1)} aria-label="Next period">›</button>
      </div>
      <h5 aria-live="polite">{periodTitle}</h5>
      <span className="icv__read-only">View only</span>
    </div>

    {!connected && <p className="icv__notice">Connect Google Calendar above to see events.</p>}
    {loading && <p className="icv__notice" role="status">Updating events…</p>}
    {error && <p className="icv__notice icv__notice-error" role="alert">{error}. {limited ? 'Showing a limited upcoming-event preview.' : ''}</p>}
    {truncated && <p className="icv__notice" role="status">This period has more than 1,000 events. The current view shows the first 1,000.</p>}

    {view === 'month' && <div className="icv__month-scroll" tabIndex={0} aria-label="Month calendar, scroll horizontally on narrow screens">
      <div className="icv__weekdays" aria-hidden="true">{weekdays.map(day => <div key={day}>{day}</div>)}</div>
      <div className="icv__month-grid">
        {range.keys.map(day => {
          const dayEvents = eventDays.get(day) || [];
          const chosen = selected === day;
          return <button key={day} type="button" onClick={() => selectDay(day)}
            aria-label={`${formatDate(day, {weekday: 'long', day: 'numeric', month: 'long'})}, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`}
            aria-pressed={chosen}
            className={`icv__day ${day.slice(0, 7) !== cursor.slice(0, 7) ? 'icv__day-outside ' : ''}${chosen ? 'icv__day-selected ' : ''}`}>
            <span className="icv__day-top">
              <span className={`icv__date ${day === today ? 'icv__date-today' : ''}`}>{Number(day.slice(-2))}</span>
              {dayEvents.length > 0 && <span className="icv__day-count">{dayEvents.length}</span>}
            </span>
            <span className="icv__day-events">
              {dayEvents.slice(0, 2).map((event, index) => <span className="icv__month-chip" key={`${event.id}-${index}`} title={`${timeLabel(event, timezone)} · ${titleOf(event)}`}>
                <span className="icv__chip-dot" aria-hidden="true"/>
                <span>{titleOf(event)}</span>
              </span>)}
              {dayEvents.length > 2 && <span className="icv__day-more">+{dayEvents.length - 2} more</span>}
            </span>
          </button>;
        })}
      </div>
    </div>}

    {view === 'week' && <div className="icv__week-grid">
      {range.keys.map(day => {
        const dayEvents = eventDays.get(day) || [];
        return <div className={`icv__week-card ${day === today ? 'icv__week-today' : ''}`} key={day}>
          <div className="icv__week-heading">
            <strong>{formatDate(day, {weekday: 'long', day: 'numeric'})}</strong>
            <span>{dayEvents.length} event{dayEvents.length === 1 ? '' : 's'}</span>
          </div>
          <div className="icv__week-items">
            {dayEvents.map(agendaEvent)}
            {dayEvents.length === 0 && <p className="icv__empty-inline">No events</p>}
          </div>
        </div>;
      })}
    </div>}

    {view === 'list' && <div className="icv__list">
      {range.keys.filter(day => (eventDays.get(day) || []).length > 0).map(day => <div className="icv__list-day" key={day}>
        <h6>{formatDate(day, {weekday: 'long', day: 'numeric', month: 'long'})}</h6>
        <div className="icv__agenda-events">{(eventDays.get(day) || []).map(agendaEvent)}</div>
      </div>)}
      {!loading && range.keys.every(day => !(eventDays.get(day) || []).length) && <p className="icv__empty">No events this month.</p>}
    </div>}

    {view === 'month' && <div className="icv__selected-agenda">
      <div className="icv__agenda-heading">
        <div><span className="icv__eyebrow">SELECTED DAY</span><h6>{formatDate(selected, {weekday: 'long', day: 'numeric', month: 'long'})}</h6></div>
        <span className="icv__agenda-count">{selectedEvents.length} event{selectedEvents.length === 1 ? '' : 's'}</span>
      </div>
      {selectedEvents.length > 0
        ? <div className="icv__agenda-events">{selectedEvents.map(agendaEvent)}</div>
        : <p className="icv__empty">Nothing scheduled on this day.</p>}
    </div>}
    <p className="icv__footer">Events are read-only here. Ava's booking permissions are controlled by the Google Calendar settings above. Times use {timezone}.</p>
  </section>;
}
