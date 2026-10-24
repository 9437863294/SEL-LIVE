import test from 'node:test';
import assert from 'node:assert/strict';
// `vehicle-management.ts` imports nothing, which is why these rules live there and can be tested
// directly rather than through the map component that draws them.
import {
  cleanTripPath,
  computeTripDistanceKmFromPoints,
  detectTripStops,
  summariseTrip,
  tripSpeedBand,
  tripSpeedSegments,
} from '../src/lib/vehicle-management.ts';

/** A fix, with the fields a test cares about. ~111m per 0.001° of latitude. */
const at = (minutes, lat, lng, extra = {}) => ({
  lat,
  lng,
  accuracyMeters: 10,
  recordedAtIso: new Date(Date.UTC(2026, 9, 24, 9, minutes, 0)).toISOString(),
  ...extra,
});

/* ------------------------------------------------------------------------------------------------
 * Cleaning the path
 * ---------------------------------------------------------------------------------------------- */

test('a clean drive keeps every fix', () => {
  const points = [at(0, 20.0, 85.0), at(1, 20.01, 85.0), at(2, 20.02, 85.0)];
  const result = cleanTripPath(points);
  assert.equal(result.points.length, 3);
  assert.equal(result.rawCount, 3);
});

test('a fix with hopeless accuracy is dropped, and counted as such', () => {
  // The reason matters: a sparse path with "3 dropped for accuracy" is explainable, one that is
  // merely sparse is not.
  const points = [at(0, 20.0, 85.0), at(1, 20.01, 85.0, { accuracyMeters: 500 }), at(2, 20.02, 85.0)];
  const result = cleanTripPath(points);
  assert.equal(result.points.length, 2);
  assert.equal(result.dropped.accuracy, 1);
});

test('jitter around a stationary vehicle collapses to one point', () => {
  // Parked with a wandering fix. Drawn raw, this is a scribble.
  const points = [
    at(0, 20.0, 85.0),
    at(1, 20.00002, 85.00002),
    at(2, 20.00001, 84.99998),
    at(3, 20.00003, 85.00001),
  ];
  const result = cleanTripPath(points);
  assert.equal(result.points.length, 1);
  assert.equal(result.dropped.jitter, 3);
});

test('a teleport no vehicle could make is dropped', () => {
  // One minute, several hundred kilometres: a tower-triangulated fix, not a drive.
  const points = [at(0, 20.0, 85.0), at(1, 25.0, 85.0), at(2, 20.001, 85.0)];
  const result = cleanTripPath(points);
  assert.equal(result.dropped['implausible-jump'], 1);
  assert.ok(!result.points.some((point) => point.lat === 25.0));
});

test('a rejected fix does not drag the next good one out with it', () => {
  // Compared against the last *kept* point: comparing against the rejected one would make the
  // following legitimate fix look like a teleport back.
  const points = [at(0, 20.0, 85.0), at(1, 25.0, 85.0), at(2, 20.01, 85.0)];
  const result = cleanTripPath(points);
  assert.equal(result.points.length, 2);
  assert.equal(result.points[1].lat, 20.01);
});

test('an invalid coordinate is dropped rather than drawn at the origin', () => {
  const points = [at(0, 20.0, 85.0), at(1, 999, 85.0), at(2, Number.NaN, 85.0), at(3, 20.01, 85.0)];
  const result = cleanTripPath(points);
  assert.equal(result.dropped.invalid, 2);
  assert.equal(result.points.length, 2);
});

test('cleaning first recovers distance an interleaved outlier loses', () => {
  /*
    `computeTripDistanceKmFromPoints` walks consecutive *raw* pairs, so one bad fix spoils the legs
    on both sides of it: the leg into the outlier is rejected, and so is the leg out of it — even
    though the two good fixes either side are a perfectly ordinary 1.1 km apart.

    Cleaning the path first removes the outlier, and the real leg between the surviving points is
    counted. The cleaned figure is the more accurate of the two.

    Left as a separate step rather than folded into the distance function: that figure feeds driver
    claims, and changing what a trip is worth is not something to do as a side effect of a map fix.
  */
  const points = [
    at(0, 20.0, 85.0),
    at(1, 20.00002, 85.0),
    at(2, 20.01, 85.0),
    at(3, 25.0, 85.0),
    at(4, 20.02, 85.0),
  ];
  const raw = computeTripDistanceKmFromPoints(points);
  const cleaned = computeTripDistanceKmFromPoints(cleanTripPath(points).points);

  assert.ok(cleaned > raw, `cleaned ${cleaned} should exceed raw ${raw}`);
  // Three fixes roughly 1.1 km apart: about 2.2 km, and certainly not the 550 km the outlier spans.
  assert.ok(cleaned > 2.1 && cleaned < 2.4, `got ${cleaned}`);
});

test('an empty path is handled rather than thrown on', () => {
  const result = cleanTripPath([]);
  assert.deepEqual(result.points, []);
  assert.equal(result.rawCount, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Stops
 * ---------------------------------------------------------------------------------------------- */

test('a long pause in one place is a stop', () => {
  const points = [
    at(0, 20.0, 85.0),
    at(10, 20.05, 85.0),
    at(12, 20.05, 85.0),
    at(25, 20.0501, 85.0),
    at(30, 20.1, 85.0),
  ];
  const stops = detectTripStops(points);
  assert.equal(stops.length, 1);
  assert.ok(stops[0].minutes >= 15, `got ${stops[0].minutes}`);
});

test('a pause shorter than the threshold is traffic, not a stop', () => {
  const points = [at(0, 20.0, 85.0), at(1, 20.0, 85.0), at(2, 20.05, 85.0)];
  assert.deepEqual(detectTripStops(points, { minMinutes: 3 }), []);
});

test('a creeping vehicle is not reported as one long stop', () => {
  // The bug a rolling centre would introduce: each fix within the radius of the *last* one, so a
  // vehicle inching down a road reports a stop that moved. Anchoring to where the stop began means
  // a stop is a place.
  const points = [];
  for (let index = 0; index <= 20; index += 1) {
    // ~55 m per step: inside a 60 m radius of the previous fix, far outside it of the first.
    points.push(at(index * 2, 20.0 + index * 0.0005, 85.0));
  }
  const stops = detectTripStops(points, { radiusMeters: 60, minMinutes: 5 });
  assert.equal(stops.length, 0, `creep reported as ${stops.length} stop(s)`);
});

test('two separate stops are both found, with their own places and durations', () => {
  const points = [
    at(0, 20.0, 85.0),
    at(10, 20.0, 85.0),
    at(20, 20.1, 85.0),
    at(35, 20.1, 85.0),
    at(40, 20.2, 85.0),
  ];
  const stops = detectTripStops(points, { minMinutes: 5 });
  assert.equal(stops.length, 2);
  assert.ok(Math.abs(stops[0].lat - 20.0) < 1e-9);
  assert.ok(Math.abs(stops[1].lat - 20.1) < 1e-9);
  assert.ok(stops[1].minutes >= 15);
});

test('a point with no timestamp ends a stop rather than silently extending it', () => {
  // Duration is the whole claim a stop makes; a fix that cannot date itself must not lengthen one.
  const points = [
    at(0, 20.0, 85.0),
    { lat: 20.0, lng: 85.0, accuracyMeters: 10 },
    at(60, 20.0, 85.0),
  ];
  const stops = detectTripStops(points, { minMinutes: 5 });
  assert.equal(stops.length, 0);
});

test('a stop records how many fixes support it', () => {
  // A ninety-minute stop evidenced by two fixes is a weaker claim than one evidenced by ninety.
  const points = [at(0, 20.0, 85.0), at(30, 20.0, 85.0), at(60, 20.2, 85.0)];
  const stops = detectTripStops(points, { minMinutes: 5 });
  assert.equal(stops[0].samples, 2);
});

/* ------------------------------------------------------------------------------------------------
 * The summary
 * ---------------------------------------------------------------------------------------------- */

test('idle time is subtracted from elapsed to give moving time', () => {
  const points = [
    at(0, 20.0, 85.0),
    at(20, 20.0, 85.0),
    at(40, 20.2, 85.0),
  ];
  const summary = summariseTrip(points, { minMinutes: 5 });
  assert.equal(summary.elapsedMinutes, 40);
  assert.ok(summary.idleMinutes >= 20, `idle ${summary.idleMinutes}`);
  assert.ok(summary.movingMinutes <= 20, `moving ${summary.movingMinutes}`);
});

test('the average is over moving time, not elapsed', () => {
  // A van that drove 20 km in 20 minutes and then parked for three hours averaged 60 km/h, not 6.
  const points = [at(0, 20.0, 85.0), at(20, 20.18, 85.0), at(200, 20.18, 85.0)];
  const summary = summariseTrip(points, { minMinutes: 5 });
  assert.ok(summary.averageMovingKmph > 30, `got ${summary.averageMovingKmph}`);
});

test('top speed prefers what the device reported', () => {
  const points = [
    at(0, 20.0, 85.0, { speedKmph: 42 }),
    at(1, 20.01, 85.0, { speedKmph: 88 }),
    at(2, 20.02, 85.0, { speedKmph: 51 }),
  ];
  assert.equal(summariseTrip(points).topKmph, 88);
});

test('top speed falls back to the distance between fixes when the device reports none', () => {
  // Common on cheap handsets, and a blank top speed makes the whole summary useless.
  const points = [at(0, 20.0, 85.0), at(1, 20.01, 85.0)];
  assert.ok(summariseTrip(points).topKmph > 0);
});

test('a trip with one fix summarises to zeroes rather than NaN', () => {
  const summary = summariseTrip([at(0, 20.0, 85.0)]);
  assert.equal(summary.distanceKm, 0);
  assert.equal(summary.elapsedMinutes, 0);
  assert.equal(summary.averageMovingKmph, 0);
  assert.deepEqual(summary.stops, []);
});

/* ------------------------------------------------------------------------------------------------
 * Speed bands
 * ---------------------------------------------------------------------------------------------- */

test('speed bands split at the thresholds the colours use', () => {
  assert.equal(tripSpeedBand(0), 'stopped');
  assert.equal(tripSpeedBand(1.9), 'stopped');
  assert.equal(tripSpeedBand(10), 'slow');
  assert.equal(tripSpeedBand(40), 'normal');
  assert.equal(tripSpeedBand(80), 'fast');
  assert.equal(tripSpeedBand(Number.NaN), 'stopped');
});

test('segments are derived from the stretch, not the device reading', () => {
  // A stretch covered slowly is slow even if the device happened to report a sprint at one end.
  const points = [at(0, 20.0, 85.0, { speedKmph: 90 }), at(60, 20.01, 85.0, { speedKmph: 90 })];
  const segments = tripSpeedSegments(points);
  assert.equal(segments.length, 1);
  assert.ok(segments[0].kmph < 5, `got ${segments[0].kmph}`);
  assert.equal(segments[0].band, 'stopped');
});

test('one point yields no segments', () => {
  assert.deepEqual(tripSpeedSegments([at(0, 20.0, 85.0)]), []);
});
