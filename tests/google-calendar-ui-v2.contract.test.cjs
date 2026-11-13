'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

const root = process.cwd();
const component = path.join(root, 'app/dashboard/google-calendar-event-view.tsx');
const settings = path.join(root, 'app/dashboard/google-calendar-voice.tsx');
const source = fs.readFileSync(component, 'utf8');

function compile() {
  const result = ts.transpileModule(source, {
    fileName: component,
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) || [];
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  return result.outputText;
}

test('v2 component is valid TypeScript JSX', () => {
  assert.ok(compile().includes('GoogleCalendarEventView'));
});

test('view controls and full-title agenda are visible and keyboard usable', () => {
  for (const token of [
    "'month'", "'week'", "'list'", 'Month', 'Week', 'Agenda', 'Today',
    'icv__event-title', 'icv__agenda-events', 'icv__selected-agenda',
    'aria-label="Calendar navigation"', 'aria-pressed', 'onClick={() => selectDay(day)}',
    'target="_blank" rel="noopener noreferrer"',
  ]) assert.ok(source.includes(token), `Missing ${token}`);
});

test('light and dark modes each have explicit accessible color tokens', () => {
  assert.match(source, /\[data-intrigue-theme=\\?"dark\\?"\] \.icv/);
  assert.match(source, /--icv-bg:/);
  assert.match(source, /--icv-text:/);
  assert.match(source, /\.icv__event-title \{/);
  assert.match(source, /overflow-wrap: anywhere/);
  assert.match(source, /@media \(max-width: 650px\)/);
});

test('no changes to existing Google OAuth/booking controls or endpoint', () => {
  const settingsText = fs.readFileSync(settings, 'utf8');
  for (const token of ['GoogleCalendarEventView', 'Save Google booking settings', 'Reconnect Google Calendar', 'google_book_appointment']) {
    assert.ok(settingsText.includes(token), `Missing existing booking setting: ${token}`);
  }
  assert.doesNotMatch(source, /fetch\([^\n]*method: ?['"](?:POST|PUT|DELETE)/);
  assert.ok(source.includes('/api/integrations/google-calendar/events?'));
});

test('timezone conversion, month navigation and nonempty titles remain correct', () => {
  const output = compile();
  const m = {exports: {}};
  const scope = {
    module: m, exports: m.exports, Date, Intl, URL, console,
    require(name) {
      if (name === 'react') return {};
      if (name === 'react/jsx-runtime') return {jsx() {}, jsxs() {}, Fragment: {}};
      throw Error('Unexpected module ' + name);
    },
  };
  vm.runInNewContext(output + '\nmodule.exports._calendarHelpers={moveDays,moveMonths,weekStart,zonedDateKey,occursOn,titleOf,timeLabel};', scope);
  const h = m.exports._calendarHelpers;
  assert.equal(h.weekStart('2026-11-13'), '2026-11-09');
  assert.equal(h.moveMonths('2026-01-16', -1), '2025-12-01');
  assert.equal(h.zonedDateKey(new Date('2026-11-13T23:30:00Z'), 'Europe/Berlin'), '2026-11-14');
  assert.equal(h.titleOf({title: ''}), 'Busy event');
  assert.equal(h.titleOf({title: '  Team meeting  '}), 'Team meeting');
  assert.equal(h.timeLabel({allDay:true}, 'Europe/Berlin'), 'All day');
  const multiDay = {allDay:true,start:'2026-11-13',end:'2026-11-15'};
  assert.equal(h.occursOn(multiDay,'2026-11-14','Europe/Berlin'), true);
  assert.equal(h.occursOn(multiDay,'2026-11-15','Europe/Berlin'), false);
});
