import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampRange,
  currentPeriod,
  describeRange,
  fyPeriods,
  fyStartOf,
  matchPreset,
  periodLabel,
  periodSpan,
  periodsBetween,
  RANGE_PRESETS,
  resolvePreset,
  selectablePeriods,
  shiftPeriod,
} from '../src/lib/site-account-statement-period-range.ts';

/** September 2026 — mid-FY, so FY-relative presets have months on both sides. */
const TODAY = '2026-09';

describe('shiftPeriod', () => {
  it('moves within a year', () => {
    assert.equal(shiftPeriod('2026-09', 1), '2026-10');
    assert.equal(shiftPeriod('2026-09', -2), '2026-07');
  });

  it('rolls the year over in both directions', () => {
    assert.equal(shiftPeriod('2026-12', 1), '2027-01');
    assert.equal(shiftPeriod('2026-01', -1), '2025-12');
    assert.equal(shiftPeriod('2026-01', -13), '2024-12');
    assert.equal(shiftPeriod('2026-12', 13), '2028-01');
  });

  it('is a no-op for zero and leaves junk alone', () => {
    assert.equal(shiftPeriod('2026-09', 0), '2026-09');
    assert.equal(shiftPeriod('', 1), '');
    assert.equal(shiftPeriod('nonsense', 1), 'nonsense');
  });
});

describe('periodSpan', () => {
  it('counts inclusively', () => {
    assert.equal(periodSpan('2026-09', '2026-09'), 1);
    assert.equal(periodSpan('2026-04', '2026-09'), 6);
    assert.equal(periodSpan('2026-04', '2027-03'), 12);
  });
});

describe('periodsBetween', () => {
  it('lists every month inclusively', () => {
    assert.deepEqual(periodsBetween('2026-07', '2026-10'), ['2026-07', '2026-08', '2026-09', '2026-10']);
    assert.deepEqual(periodsBetween('2026-09', '2026-09'), ['2026-09']);
  });

  it('crosses a financial year boundary', () => {
    // The whole reason the range filter exists: this was not expressible before.
    assert.deepEqual(periodsBetween('2026-02', '2026-05'), ['2026-02', '2026-03', '2026-04', '2026-05']);
  });

  it('tolerates an inverted range by ordering it', () => {
    assert.deepEqual(periodsBetween('2026-10', '2026-08'), ['2026-08', '2026-09', '2026-10']);
  });

  it('caps absurd ranges so the report cannot be asked to render decades', () => {
    assert.equal(periodsBetween('1990-01', '2090-01').length, 120);
    assert.equal(periodsBetween('2026-01', '2030-01', 6).length, 6);
  });

  it('returns nothing for a missing bound', () => {
    assert.deepEqual(periodsBetween('', '2026-09'), []);
    assert.deepEqual(periodsBetween('2026-09', ''), []);
  });
});

describe('fyStartOf / fyPeriods', () => {
  it('puts April onwards in the year that starts the FY', () => {
    assert.equal(fyStartOf('2026-04'), 2026);
    assert.equal(fyStartOf('2026-12'), 2026);
  });

  it('puts January to March in the previous FY', () => {
    assert.equal(fyStartOf('2026-03'), 2025);
    assert.equal(fyStartOf('2026-01'), 2025);
  });

  it('lists an FY April first, March last', () => {
    const months = fyPeriods(2026);
    assert.equal(months.length, 12);
    assert.equal(months[0], '2026-04');
    assert.equal(months[11], '2027-03');
  });
});

describe('resolvePreset', () => {
  const at = (key) => resolvePreset(key, TODAY);

  it('resolves single-month presets', () => {
    assert.deepEqual(at('thisMonth'), { from: '2026-09', to: '2026-09' });
    assert.deepEqual(at('lastMonth'), { from: '2026-08', to: '2026-08' });
  });

  it('counts rolling windows inclusive of the current month', () => {
    // "Last 3 months" in September means July, August, September — not April to June.
    assert.deepEqual(at('last3'), { from: '2026-07', to: '2026-09' });
    assert.equal(periodSpan(at('last3').from, at('last3').to), 3);
    assert.equal(periodSpan(at('last6').from, at('last6').to), 6);
    assert.equal(periodSpan(at('last12').from, at('last12').to), 12);
  });

  it('resolves FY presets against the Indian financial year', () => {
    assert.deepEqual(at('fyToDate'), { from: '2026-04', to: '2026-09' });
    assert.deepEqual(at('thisFy'),   { from: '2026-04', to: '2027-03' });
    assert.deepEqual(at('lastFy'),   { from: '2025-04', to: '2026-03' });
  });

  it('resolves FY presets correctly from inside January to March', () => {
    // February 2026 belongs to FY 2025-26, so "this FY" must not jump forward a year.
    assert.deepEqual(resolvePreset('thisFy', '2026-02'), { from: '2025-04', to: '2026-03' });
    assert.deepEqual(resolvePreset('fyToDate', '2026-02'), { from: '2025-04', to: '2026-02' });
    assert.deepEqual(resolvePreset('lastFy', '2026-02'), { from: '2024-04', to: '2025-03' });
  });

  it('gives custom no range of its own', () => {
    assert.equal(at('custom'), null);
  });

  it('resolves every preset in the list except custom', () => {
    for (const { key } of RANGE_PRESETS) {
      const resolved = resolvePreset(key, TODAY);
      if (key === 'custom') assert.equal(resolved, null);
      else assert.ok(resolved && resolved.from <= resolved.to, `${key} produced an inverted or empty range`);
    }
  });
});

describe('matchPreset', () => {
  it('recognises a range that a preset would have produced', () => {
    assert.equal(matchPreset({ from: '2026-09', to: '2026-09' }, TODAY), 'thisMonth');
    assert.equal(matchPreset({ from: '2026-04', to: '2027-03' }, TODAY), 'thisFy');
    assert.equal(matchPreset({ from: '2026-07', to: '2026-09' }, TODAY), 'last3');
  });

  it('falls back to custom for anything else', () => {
    assert.equal(matchPreset({ from: '2026-05', to: '2026-08' }, TODAY), 'custom');
  });
});

describe('clampRange', () => {
  it('leaves a valid range untouched', () => {
    const range = { from: '2026-04', to: '2026-09' };
    assert.deepEqual(clampRange(range, 'from'), range);
    assert.deepEqual(clampRange(range, 'to'), range);
  });

  it('drags the other end along rather than producing an empty report', () => {
    // An empty table reads as "no data for this period", which is a different and wrong answer.
    assert.deepEqual(clampRange({ from: '2026-11', to: '2026-09' }, 'from'), { from: '2026-11', to: '2026-11' });
    assert.deepEqual(clampRange({ from: '2026-11', to: '2026-09' }, 'to'), { from: '2026-09', to: '2026-09' });
  });

  it('never yields a range that produces no months', () => {
    const clamped = clampRange({ from: '2027-01', to: '2026-01' }, 'from');
    assert.ok(periodsBetween(clamped.from, clamped.to).length >= 1);
  });
});

describe('periodLabel / describeRange', () => {
  it('labels a month readably', () => {
    assert.equal(periodLabel('2026-09'), 'Sep 2026');
    assert.equal(periodLabel('2026-01'), 'Jan 2026');
  });

  it('returns junk unchanged rather than rendering "undefined NaN"', () => {
    assert.equal(periodLabel('nonsense'), 'nonsense');
    assert.equal(periodLabel('2026-13'), '2026-13');
  });

  it('collapses a single month to just that month', () => {
    assert.equal(describeRange({ from: '2026-09', to: '2026-09' }), 'Sep 2026');
  });

  it('names a full financial year as one', () => {
    // "FY 2026-27" tells a budget reader more than "Apr 2026 – Mar 2027".
    assert.equal(describeRange({ from: '2026-04', to: '2027-03' }), 'FY 2026-27');
  });

  it('spells out any other range with its length', () => {
    assert.equal(describeRange({ from: '2026-04', to: '2026-09' }), 'Apr 2026 – Sep 2026 (6 months)');
    assert.equal(describeRange({ from: '2026-08', to: '2026-09' }), 'Aug 2026 – Sep 2026 (2 months)');
  });
});

describe('selectablePeriods', () => {
  it('covers the data and the current financial year', () => {
    const options = selectablePeriods(['2025-06', '2026-02'], TODAY);
    assert.ok(options.includes('2025-06'), 'earliest data month missing');
    assert.ok(options.includes('2026-02'), 'later data month missing');
    assert.ok(options.includes('2026-04'), 'current FY start missing');
    assert.ok(options.includes('2027-03'), 'current FY end missing');
    assert.ok(options.includes(TODAY), 'current month missing');
  });

  it('still offers a usable list when there is no data at all', () => {
    const options = selectablePeriods([], TODAY);
    assert.ok(options.length > 12);
    assert.ok(options.includes(TODAY));
  });

  it('comes back sorted and free of duplicates', () => {
    const options = selectablePeriods(['2026-02', '2025-06', '2026-02'], TODAY);
    assert.deepEqual(options, [...options].sort());
    assert.equal(new Set(options).size, options.length);
  });
});

describe('currentPeriod', () => {
  it('formats from local-time components', () => {
    assert.equal(currentPeriod(new Date(2026, 8, 24, 23, 59)), '2026-09');
    assert.equal(currentPeriod(new Date(2026, 0, 1, 0, 0)), '2026-01');
  });
});
