import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs } from './ics.ts';

const cal = (...events: string[]) => ['BEGIN:VCALENDAR', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e.trim().split('\n'), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

test('single timed event, all-day and free events skipped, long lines unfolded', () => {
  const text = cal(
    'UID:1\nDTSTART:20260922T090000\nDTEND:20260922T103000\nSUMMARY:Planning\\, Q4',
    'UID:2\nDTSTART;VALUE=DATE:20260923\nDTEND;VALUE=DATE:20260924\nSUMMARY:Holiday',
    'UID:3\nDTSTART:20260924T090000\nDURATION:PT1H\nTRANSP:TRANSPARENT\nSUMMARY:Free',
    'UID:4\nDTSTART:20260925T140000\nDURATION:PT45M\nSUMMARY:Very long\n  title',
  );
  assert.deepEqual(parseIcs(text, '2026-09-21', '2026-09-27'), [
    { date: '2026-09-22', start: '09:00', hours: 1.5, title: 'Planning, Q4' },
    { date: '2026-09-25', start: '14:00', hours: 0.75, title: 'Very long title' },
  ]);
});

test('weekly with BYDAY, EXDATE, moved and cancelled occurrences, window', () => {
  const text = cal(
    'UID:s\nDTSTART:20260907T090000\nDTEND:20260907T093000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\nEXDATE:20260923T090000\nSUMMARY:Standup',
    'UID:s\nRECURRENCE-ID:20260921T090000\nDTSTART:20260921T110000\nDTEND:20260921T113000\nSUMMARY:Standup (moved)',
    'UID:s\nRECURRENCE-ID:20260928T090000\nDTSTART:20260928T090000\nDTEND:20260928T093000\nSTATUS:CANCELLED\nSUMMARY:Standup',
  );
  assert.deepEqual(parseIcs(text, '2026-09-21', '2026-10-04').map((e) => `${e.date} ${e.start} ${e.title}`), [
    '2026-09-21 11:00 Standup (moved)', // 09:00 replaced
    // 09-23 excluded by EXDATE, 09-28 cancelled
    '2026-09-30 09:00 Standup',
  ]);
});

test('daily with COUNT and INTERVAL, weekly UNTIL, monthly', () => {
  const daily = cal('UID:d\nDTSTART:20260921T080000\nDTEND:20260921T090000\nRRULE:FREQ=DAILY;INTERVAL=2;COUNT=3\nSUMMARY:Gym');
  assert.deepEqual(parseIcs(daily, '2026-09-01', '2026-12-31').map((e) => e.date), ['2026-09-21', '2026-09-23', '2026-09-25']);
  const weekly = cal('UID:w\nDTSTART:20260901T100000\nDTEND:20260901T110000\nRRULE:FREQ=WEEKLY;UNTIL=20260915T235959Z\nSUMMARY:1:1');
  assert.deepEqual(parseIcs(weekly, '2026-09-01', '2026-12-31').map((e) => e.date), ['2026-09-01', '2026-09-08', '2026-09-15']);
  const monthly = cal('UID:m\nDTSTART:20260915T100000\nDTEND:20260915T120000\nRRULE:FREQ=MONTHLY\nSUMMARY:Review');
  assert.deepEqual(parseIcs(monthly, '2026-10-01', '2026-11-30').map((e) => e.date), ['2026-10-15', '2026-11-15']);
});
