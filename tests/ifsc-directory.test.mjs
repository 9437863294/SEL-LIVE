import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchLabel, createIfscDirectory, normaliseIfsc, parseIfscRecord } from '../src/lib/ifsc-directory.ts';

/** Verbatim from https://ifsc.razorpay.com/FDRL0007777, 2026-11-12 (the IFSC on employee 70's bank record). */
const FDRL0007777 = {
  MICR: null,
  CENTRE: 'KOCHI',
  DISTRICT: 'KOCHI',
  STATE: 'KERALA',
  CITY: 'ERNAKULAM',
  BRANCH: 'NEO BANKING - JUPITER',
  BANK: 'Federal Bank',
  BANKCODE: 'FDRL',
  IFSC: 'FDRL0007777',
};

/** A fetch that answers from a table and records every URL it was asked for. */
function fakeFetch(table) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const code = String(url).split('/').pop();
    const answer = table[code];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) return new Response(JSON.stringify('Not Found'), { status: 404 });
    if (typeof answer === 'number') return new Response('busy', { status: answer });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { impl, calls };
}

test('normaliseIfsc accepts only a well-formed IFSC, in canonical form', () => {
  assert.equal(normaliseIfsc(' fdrl0007777 '), 'FDRL0007777');
  assert.equal(normaliseIfsc('SBIN0001234'), 'SBIN0001234');
  for (const bad of ['', null, undefined, 207, 'FDRL007777', 'FDRL1007777', 'FDRL0007777X', '../etc/passwd']) {
    assert.equal(normaliseIfsc(bad), null, `${String(bad)} is not an IFSC`);
  }
});

test('the directory answer becomes a branch, labelled with its city', () => {
  const entry = parseIfscRecord('FDRL0007777', FDRL0007777);
  assert.deepEqual(entry, { ifsc: 'FDRL0007777', bank: 'Federal Bank', branch: 'NEO BANKING - JUPITER', city: 'ERNAKULAM', state: 'KERALA' });
  assert.equal(branchLabel(entry), 'NEO BANKING - JUPITER, ERNAKULAM');
  // The city is not repeated when the branch name already carries it.
  assert.equal(branchLabel({ ...entry, branch: 'ERNAKULAM MAIN' }), 'ERNAKULAM MAIN');
  assert.equal(branchLabel({ ...entry, city: null }), 'NEO BANKING - JUPITER');
  assert.equal(parseIfscRecord('FDRL0007777', 'Not Found'), null);
  assert.equal(parseIfscRecord('FDRL0007777', { BANK: 'Federal Bank' }), null, 'no branch, no record');
});

test('branchNames looks each IFSC up once and keys the answer canonically', async () => {
  const { impl, calls } = fakeFetch({ FDRL0007777 });
  const directory = createIfscDirectory({ fetchImpl: impl });
  const names = await directory.branchNames(['FDRL0007777', 'fdrl0007777', ' FDRL0007777', 207, null, 'not an ifsc']);
  assert.deepEqual(names, { FDRL0007777: 'NEO BANKING - JUPITER, ERNAKULAM' });
  assert.deepEqual(calls, ['https://ifsc.razorpay.com/FDRL0007777'], 'duplicates merged, malformed codes never sent');
  await directory.branchNames(['FDRL0007777']);
  assert.equal(calls.length, 1, 'a found branch is cached');
});

test('an unknown IFSC is remembered for a day; a failure is retried after ten minutes', async () => {
  let clock = 0;
  const { impl, calls } = fakeFetch({ SBIN0009999: 503, HDFC0001111: new Error('socket hang up') });
  const directory = createIfscDirectory({ fetchImpl: impl, now: () => clock });

  assert.deepEqual(await directory.branchNames(['ABCD0000000', 'SBIN0009999', 'HDFC0001111']), {}, 'never throws');
  assert.equal(calls.length, 3);

  clock += 11 * 60 * 1000;
  await directory.branchNames(['ABCD0000000', 'SBIN0009999', 'HDFC0001111']);
  assert.deepEqual(calls.slice(3).sort(), ['https://ifsc.razorpay.com/HDFC0001111', 'https://ifsc.razorpay.com/SBIN0009999'], 'failures are asked again; the 404 is not');

  clock += 25 * 60 * 60 * 1000;
  await directory.branchNames(['ABCD0000000']);
  assert.equal(calls.at(-1), 'https://ifsc.razorpay.com/ABCD0000000', 'an unknown code is asked again the next day');
});

test('lookups that overlap share one request', async () => {
  const { impl, calls } = fakeFetch({ FDRL0007777 });
  const directory = createIfscDirectory({ fetchImpl: impl });
  const [a, b] = await Promise.all([directory.lookup('FDRL0007777'), directory.lookup('fdrl0007777')]);
  assert.equal(a.branch, 'NEO BANKING - JUPITER');
  assert.equal(b, a);
  assert.equal(calls.length, 1);
});
