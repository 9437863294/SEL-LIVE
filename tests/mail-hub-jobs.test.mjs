import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryMailJobQueue, completionPatch, isClaimable, planEnqueue, runMailWorker } from '../src/lib/mail-hub/jobs.ts';
import { manualClock } from './mail-hub-fakes.mjs';

test('duplicate enqueues with one dedupe key collapse into one queued job at the earliest time', async () => {
  const clock = manualClock();
  const queue = new MemoryMailJobQueue(clock);
  const later = new Date(clock().getTime() + 60_000).toISOString();
  await queue.enqueue({ type: 'sync', accountId: 'a', dedupeKey: 'sync:a', runAt: later });
  const second = await queue.enqueue({ type: 'sync', accountId: 'a', dedupeKey: 'sync:a' });
  const third = await queue.enqueue({ type: 'sync', accountId: 'a', dedupeKey: 'sync:a' });
  assert.equal(queue.jobs.size, 1);
  assert.equal(second.action, 'update');
  assert.equal(third.action, 'noop');
  assert.equal([...queue.jobs.values()][0].runAt, clock().toISOString());
});

test('a notification that arrives while its job runs makes the job run once more', async () => {
  const clock = manualClock();
  const queue = new MemoryMailJobQueue(clock);
  await queue.enqueue({ type: 'sync', accountId: 'a', dedupeKey: 'sync:a' });
  let runs = 0;
  const summary = await runMailWorker({
    queue,
    now: clock,
    handlers: {
      sync: async () => {
        runs += 1;
        if (runs === 1) await queue.enqueue({ type: 'sync', accountId: 'a', dedupeKey: 'sync:a' });
        return { kind: 'done' };
      },
    },
  });
  assert.equal(runs, 2);
  assert.equal(summary.done, 2);
  assert.equal([...queue.jobs.values()][0].status, 'done');
});

test('a job whose worker died is reclaimed after its lease expires', async () => {
  const clock = manualClock();
  const queue = new MemoryMailJobQueue(clock);
  await queue.enqueue({ type: 'send.outbound', dedupeKey: 'send:o1' });
  const [claimed] = await queue.claim(5, clock(), 60_000);
  assert.equal(claimed.status, 'running');
  assert.equal((await queue.claim(5, clock(), 60_000)).length, 0, 'the live lease is respected');
  clock.advance(61_000);
  const [reclaimed] = await queue.claim(5, clock(), 60_000);
  assert.equal(reclaimed.id, claimed.id);
  assert.equal(reclaimed.attempts, 2);
});

test('continue does not spend attempts; retries back off; exhausted jobs are dead-lettered', () => {
  const now = new Date('2026-09-24T09:00:00.000Z');
  const running = { id: 'j', type: 'sync', accountId: 'a', payload: {}, status: 'running', runAt: now.toISOString(), attempts: 3, maxAttempts: 3, leaseUntil: null, rerun: false, lastError: null, createdAt: '', updatedAt: '' };

  const continued = completionPatch(running, { kind: 'continue', delayMs: 0 }, now);
  assert.equal(continued.status, 'queued');
  assert.equal(continued.attempts, 2);

  const retried = completionPatch({ ...running, attempts: 1 }, { kind: 'retry', error: 'x', retryAfterMs: 120_000 }, now, () => 0);
  assert.equal(retried.status, 'queued');
  assert.ok(Date.parse(retried.runAt) - now.getTime() >= 120_000, 'Retry-After is a floor');

  const dead = completionPatch(running, { kind: 'retry', error: 'still broken' }, now);
  assert.equal(dead.status, 'dead');
  assert.equal(dead.lastError, 'still broken');
});

test('done and dead jobs can be enqueued again; queued ones are only claimable when due', () => {
  const now = new Date('2026-09-24T09:00:00.000Z');
  const done = { id: 'k', status: 'done', runAt: now.toISOString(), payload: {}, rerun: false };
  assert.equal(planEnqueue(done, 'k', { type: 'sync' }, now).action, 'create');
  const future = { status: 'queued', runAt: new Date(now.getTime() + 1000).toISOString() };
  assert.equal(isClaimable(future, now), false);
  assert.equal(isClaimable({ ...future, runAt: now.toISOString() }, now), true);
});

test('a throwing handler is retried and reported, and the worker keeps going', async () => {
  const clock = manualClock();
  const queue = new MemoryMailJobQueue(clock);
  await queue.enqueue({ type: 'sync', dedupeKey: 'bad' });
  await queue.enqueue({ type: 'notify.sweep', dedupeKey: 'good' });
  const summary = await runMailWorker({
    queue,
    now: clock,
    handlers: {
      sync: async () => {
        throw new Error('boom');
      },
      'notify.sweep': async () => ({ kind: 'done' }),
    },
  });
  assert.equal(summary.retried, 1);
  assert.equal(summary.done, 1);
  assert.deepEqual(summary.errors.map((entry) => entry.error), ['boom']);
  assert.equal(queue.jobs.get('k_bad').status, 'queued');
});
