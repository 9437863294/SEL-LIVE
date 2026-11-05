import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configFromDesign,
  designFromConfig,
  numberFor,
  previewParts,
  runningNumberOf,
  seriesStem,
  staleFixedYear,
} from '../src/lib/daily-requisition-serial.ts';
import { allocateReceptionNos, counterStart, fillFyTokens, formatReceptionNo, fyStartOf } from '../src/lib/daily-requisition-import.ts';

const NOV_2026 = new Date(2026, 10, 5);
const APR_2027 = new Date(2027, 3, 2);
const OLD = { prefix: 'SEL\\REC\\', format: '2025-26\\', suffix: '', startingIndex: 7340 };

test('a document saved before this page reads as parts and writes back unchanged', () => {
  const d = designFromConfig(OLD, NOV_2026);
  assert.equal(d.separator, '\\');
  assert.equal(d.prefix, 'SEL\\REC');
  assert.equal(d.fyMode, 'fixed');
  assert.equal(d.fyText, '2025-26');
  assert.equal(d.digits, 4);
  assert.equal(d.next, 7340);
  const back = configFromDesign(d, NOV_2026);
  assert.deepEqual(
    { prefix: back.prefix, format: back.format, suffix: back.suffix, startingIndex: back.startingIndex },
    { prefix: OLD.prefix, format: OLD.format, suffix: OLD.suffix, startingIndex: OLD.startingIndex },
  );
  assert.equal(numberFor(d, 7340, NOV_2026), 'SEL\\REC\\2025-26\\7340');
  assert.equal(formatReceptionNo(OLD, 7340), 'SEL\\REC\\2025-26\\7340', 'the allocator reads the old document as before');
});

test('an old fixed year is spotted, with the token that writes it the same way', () => {
  assert.deepEqual(staleFixedYear(designFromConfig(OLD, NOV_2026), NOV_2026), { stored: '2025-26', current: '2026-27', token: '{FY}' });
  assert.equal(staleFixedYear(designFromConfig({ ...OLD, format: '2026-27\\' }, NOV_2026), NOV_2026), null);
  assert.deepEqual(staleFixedYear(designFromConfig({ ...OLD, format: '25-26/' }, NOV_2026), NOV_2026)?.token, '{FY2}');
  assert.equal(staleFixedYear(designFromConfig({ ...OLD, format: 'ABC\\' }, NOV_2026), NOV_2026), null, 'not a year at all');
});

test('an automatic year rolls over on 1 April', () => {
  const auto = { prefix: 'SEL/REC/', format: '{FY}/', suffix: '', startingIndex: 64 };
  assert.equal(formatReceptionNo(auto, 64, NOV_2026), 'SEL/REC/2026-27/0064');
  assert.equal(formatReceptionNo(auto, 64, APR_2027), 'SEL/REC/2027-28/0064');
  assert.equal(fillFyTokens('{FY2} {FYS}', NOV_2026), '26-27 FY27');
  assert.equal(fyStartOf(new Date(2027, 2, 31)), 2026);
});

test('the counter starts again at 1 in a new financial year, only with an automatic year', () => {
  const resetting = { prefix: 'R/', format: '{FY}/', suffix: '', startingIndex: 900, resetEvery: 'fy', counterFy: 2026 };
  assert.equal(counterStart(resetting, NOV_2026), 900);
  const april = allocateReceptionNos(resetting, 2, APR_2027);
  assert.deepEqual(april.receptionNos, ['R/2027-28/0001', 'R/2027-28/0002']);
  assert.deepEqual(april.update, { startingIndex: 3, counterFy: 2027 });
  // Fixed text would repeat last year's numbers, so it never restarts.
  const fixed = { ...resetting, format: '2026-27/' };
  assert.equal(counterStart(fixed, APR_2027), 900);
  assert.deepEqual(allocateReceptionNos(OLD, 1).update, { startingIndex: 7341 }, 'an old document writes only the counter');
});

test('digits pad the running number, 4 by default', () => {
  assert.equal(formatReceptionNo({ prefix: 'X-', digits: 6 }, 64), 'X-000064');
  assert.equal(formatReceptionNo({ prefix: 'X-', digits: 9 }, 64), 'X-0064', 'out of range falls back to 4');
});

test('the editor writes one separator between parts and enforces what is safe', () => {
  const d = { ...designFromConfig(OLD, NOV_2026), separator: '/', fyMode: 'auto', fyToken: '{FY}', suffixOn: true, suffix: 'A', resetEvery: 'fy', next: 64 };
  const c = configFromDesign(d, NOV_2026);
  assert.deepEqual(c, { prefix: 'SEL\\REC/', format: '{FY}/', suffix: '/A', startingIndex: 64, digits: 4, resetEvery: 'fy', counterFy: 2026 });
  assert.equal(numberFor(d, 64, NOV_2026), 'SEL\\REC/2026-27/0064/A');
  assert.deepEqual(previewParts(d, 64, NOV_2026).map((p) => p.text), ['SEL\\REC', '2026-27', '0064', 'A']);
  assert.equal(configFromDesign({ ...d, fyMode: 'fixed', fyText: '2026-27' }, NOV_2026).resetEvery, 'never');
});

test('a Reception No is read back as its running number, or refused when it is another series', () => {
  const d = designFromConfig({ prefix: 'SEL/REC/', format: '{FY}/', suffix: '/A', startingIndex: 64 }, NOV_2026);
  assert.equal(seriesStem(d, NOV_2026), 'SEL/REC/2026-27/');
  assert.equal(runningNumberOf('SEL/REC/2026-27/0063/A', d, NOV_2026), 63);
  assert.equal(runningNumberOf('SEL/REC/2025-26/0063/A', d, NOV_2026), null);
  assert.equal(runningNumberOf('SEL/REC/2026-27/00x3/A', d, NOV_2026), null);
});
