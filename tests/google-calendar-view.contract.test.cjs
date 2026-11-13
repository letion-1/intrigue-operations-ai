'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const routeFile = 'app/api/integrations/google-calendar/events/route.ts';
const viewerFile = 'app/dashboard/google-calendar-event-view.tsx';
const settingsFile = 'app/dashboard/google-calendar-voice.tsx';

function compile(source, fileName) {
  const result = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) || [];
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  return result.outputText;
}

function routeHarness({allow = true, connected = true, pages = null} = {}) {
  const calls = [];
  let connectionChecks = 0;
  const fetchStub = async (url, options) => {
    calls.push({url: String(url), options});
    assert.match(String(url), /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary\/events\?/);
    assert.equal(options.headers.Authorization, 'Bearer test-access');
    assert.equal(options.cache, 'no-store');
    const page = pages ? pages[calls.length - 1] : {items: [
      {id: 'a', summary: 'Meeting', start: {dateTime: '2026-11-16T10:00:00+01:00'}, end: {dateTime: '2026-11-16T10:30:00+01:00'}, htmlLink: 'https://calendar.google.com/calendar/u/0/r/eventedit/a'},
      {id: 'b', summary: 'All day', start: {date: '2026-11-17'}, end: {date: '2026-11-18'}},
    ]};
    return {ok: true, json: async () => page};
  };
  const module = {exports: {}};
  const sandbox = {
    module,
    exports: module.exports,
    require(name) {
      if (name === 'next/server') return {NextResponse: {json: (value, opts) => ({status: opts.status, value, headers: opts.headers})}};
      if (name === '@/lib/intrigue-google-calendar') return {
        owner: async () => allow ? {workspace: 'workspace-a'} : null,
        ownerBlob: async () => {connectionChecks++; return connected ? 'encrypted-blob' : null;},
        ownerAccess: async () => 'test-access',
      };
      throw new Error('Unexpected import ' + name);
    },
    URL, URLSearchParams, AbortSignal, Date, Error, console,
    fetch: fetchStub,
  };
  vm.runInNewContext(compile(read(routeFile), routeFile), sandbox, {filename: routeFile});
  const makeRequest = (from = '2026-11-01T00:00:00.000Z', to = '2026-12-01T00:00:00.000Z') => ({
    nextUrl: {searchParams: new URLSearchParams({from, to})},
  });
  return {GET: module.exports.GET, makeRequest, calls, connectionChecks: () => connectionChecks};
}

test('new route is read-only, workspace-owner authenticated and returns private no-store data', async () => {
  const h = routeHarness({allow: false});
  const r = await h.GET(h.makeRequest());
  assert.equal(r.status, 403);
  assert.equal(h.calls.length, 0);
  assert.equal(r.headers['Cache-Control'], 'private, no-store');
  assert.match(read(routeFile), /owner\(\)/);
  assert.doesNotMatch(read(routeFile), /export async function (POST|PUT|DELETE)/);
});

test('invalid, excessively long, and reversed ranges are refused before provider calls', async () => {
  const h = routeHarness();
  for (const [a,b] of [
    ['wrong', '2026-12-01T00:00:00.000Z'],
    ['2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
    ['2026-11-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z'],
    ['2026-11-30T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
  ]) assert.equal((await h.GET(h.makeRequest(a,b))).status, 400);
  assert.equal(h.calls.length, 0);
});

test('disconnected calendar is rejected without provider requests', async () => {
  const h = routeHarness({connected: false});
  const r = await h.GET(h.makeRequest());
  assert.equal(r.status, 409);
  assert.equal(r.value.connected, false);
  assert.equal(h.calls.length, 0);
});

test('range-limited events include timed and all-day events without exposing OAuth credentials', async () => {
  const h = routeHarness();
  const response = await h.GET(h.makeRequest());
  assert.equal(response.status, 200);
  assert.equal(response.value.events.length, 2);
  assert.equal(response.value.events[0].allDay, false);
  assert.equal(response.value.events[1].allDay, true);
  assert.equal(response.value.events[1].end, '2026-11-18');
  assert.equal(response.value.truncated, false);
  assert.doesNotMatch(JSON.stringify(response.value), /test-access|encrypted-blob/);
  const params = new URL(h.calls[0].url).searchParams;
  assert.equal(params.get('timeMin'), '2026-11-01T00:00:00.000Z');
  assert.equal(params.get('timeMax'), '2026-12-01T00:00:00.000Z');
  assert.equal(params.get('singleEvents'), 'true');
});

test('pagination is bounded, with truncation disclosed', async () => {
  const pages = Array.from({length: 4}, (_, i) => ({
    items: [{id: 'evt-' + i, start: {date: '2026-11-20'}, end: {date: '2026-11-21'}}],
    nextPageToken: 'next-' + i,
  }));
  const h = routeHarness({pages});
  const response = await h.GET(h.makeRequest());
  assert.equal(response.value.events.length, 4);
  assert.equal(response.value.truncated, true);
  assert.equal(h.calls.length, 4);
});

test('viewer supports month/week/list navigation, timezone-aware event layout and click-through', () => {
  const text = read(viewerFile);
  compile(text, viewerFile);
  for (const expected of ["'month'", "'week'", "'list'", 'eventDays', 'aria-pressed', 'timeZone', 'Today']) {
    assert.ok(text.includes(expected), `missing ${expected}`);
  }
  assert.match(text, /onClick=\{\(\) => setView\(mode\)\}/);
  assert.match(text, /target="_blank" rel="noopener noreferrer"/);
  assert.match(text, /readonly|read-only/i);
  assert.match(text, /AbortController/);
});

test('existing Google Calendar booking controls are retained and only the events list changes', () => {
  const text = read(settingsFile);
  compile(text, settingsFile);
  assert.match(text, /GoogleCalendarEventView/);
  assert.match(text, /eventRefreshKey/);
  assert.match(text, /Save Google booking settings/);
  assert.match(text, /Enable real Google Calendar event creation/);
  assert.match(text, /Reconnect Google Calendar/);
  assert.match(text, /google_check_availability, google_book_appointment/);
});

test('calendar date layout handles week start, timezones, DST and exclusive all-day end', () => {
  const js = compile(read(viewerFile), viewerFile);
  const mod = {exports: {}};
  const sandbox = {
    module: mod, exports: mod.exports, Date, Intl, URL, console,
    require(name) {
      if (name === 'react') return {};
      if (name === 'react/jsx-runtime') return {jsx() {}, jsxs() {}, Fragment: {}};
      throw Error('Unexpected module ' + name);
    },
  };
  vm.runInNewContext(js + '\nmodule.exports.__helpers = {weekStart, moveMonths, zonedDateKey, occursOn};', sandbox);
  const {weekStart, moveMonths, zonedDateKey, occursOn} = mod.exports.__helpers;
  assert.equal(weekStart('2026-11-13'), '2026-11-09');
  assert.equal(moveMonths('2026-01-16', -1), '2025-12-01');
  assert.equal(zonedDateKey(new Date('2026-11-13T23:30:00.000Z'), 'Europe/Berlin'), '2026-11-14');
  const allDay = {id: 'all-day', title: 'Holiday', allDay: true, start: '2026-11-13', end: '2026-11-15'};
  assert.equal(occursOn(allDay, '2026-11-13', 'Europe/Berlin'), true);
  assert.equal(occursOn(allDay, '2026-11-14', 'Europe/Berlin'), true);
  assert.equal(occursOn(allDay, '2026-11-15', 'Europe/Berlin'), false);
  const late = {id: 'late', title: 'After midnight', start: '2026-11-13T23:30:00+01:00', end: '2026-11-14T01:00:00+01:00'};
  assert.equal(occursOn(late, '2026-11-13', 'Europe/Berlin'), true);
  assert.equal(occursOn(late, '2026-11-14', 'Europe/Berlin'), true);
});
