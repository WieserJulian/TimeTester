import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, hoursInput, spanErrors, spansHours } from './src/format.ts';

test('parseHours accepts decimal, clock and unit forms', () => {
  const near = (s: string, v: number) => assert.ok(Math.abs(parseHours(s)! - v) < 1e-3, `${s} -> ${parseHours(s)}`);
  near('9.25', 9.25); near('9,5', 9.5); near('.5', 0.5); near('9', 9);
  near('9:10', 9 + 10 / 60); near('0:45', 0.75); near('9:05', 9 + 5 / 60);
  near('9h10', 9 + 10 / 60); near('9h 10m', 9 + 10 / 60); near('9H10MIN', 9 + 10 / 60); near('9h', 9); near('1.5h', 1.5);
  near('45m', 0.75); near('90 min', 1.5); near(' 9:10 ', 9 + 10 / 60);
  for (const s of ['', '0', '0:00', '9:60', '9h75m', 'abc', '9:1:2', '-1', '9.', '1e3']) assert.equal(parseHours(s), s === '9.' ? 9 : null, s);
});

test('hoursInput round-trips', () => {
  assert.equal(hoursInput(2.5), '2.5');
  assert.equal(hoursInput(9 + 10 / 60), '9:10');
  assert.equal(hoursInput(undefined), '');
  for (const n of [9 + 10 / 60, 0.3, 7.77, 2.25]) assert.ok(Math.abs(parseHours(hoursInput(n))! - n) < 1 / 120);
});

test('spanErrors flags backwards and overlapping ranges, not unfinished ones', () => {
  const s = (a: string) => a.split(',').map((r) => { const [from, to] = r.split('-'); return { from, to }; });
  assert.deepEqual(spanErrors(s('09:00-12:00,13:00-17:30')), ['', '']);
  assert.deepEqual(spanErrors(s('09:00-12:00,12:00-13:00')), ['', '']); // touching is fine
  assert.deepEqual(spanErrors(s('10:00-09:00,09:00-09:00')), ['To must be after From', 'To must be after From']);
  assert.deepEqual(spanErrors(s('09:00-12:00,11:00-13:00,14:00-')), ['Overlaps another range', 'Overlaps another range', '']);
  assert.equal(spansHours(s('09:00-12:00,13:00-17:30,10:00-09:00')), 7.5);
});
