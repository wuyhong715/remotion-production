import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlan, parseRequest, splitFrames, validatePlan, verifyReceipt} from '../scripts/plan.mjs';

test('splits exactly, from zero, without overlap', () => {
  const chunks = splitFrames(10, 3);
  assert.deepEqual(chunks, [
    {id: '01', start: 0, end: 3},
    {id: '02', start: 4, end: 6},
    {id: '03', start: 7, end: 9},
  ]);
});

test('reduces shard count when there are fewer frames', () => {
  assert.equal(splitFrames(2, 15).length, 2);
  assert.deepEqual(splitFrames(1, 15), [{id: '01', start: 0, end: 0}]);
});

test('rejects 16 video jobs and malformed requests', () => {
  assert.throws(() => parseRequest('Demo', '16'), /1 to 15/);
  assert.throws(() => parseRequest('../Demo', '4'), /Remotion ID/);
  assert.throws(() => splitFrames(10, 0), /invalid/);
});

test('plan is deterministic and validates its boundaries', () => {
  const plan = makePlan({composition: 'Demo', requestedShards: 4, commit: 'a'.repeat(40), runId: 'local', startedAt: '2026-01-01T00:00:00Z', width: 640, height: 360, fps: 30, durationInFrames: 90});
  assert.deepEqual(validatePlan(plan), plan);
  const bad = structuredClone(plan);
  bad.chunks[1].start = bad.chunks[0].end;
  assert.throws(() => validatePlan(bad), /missing|duplicate|overlapping|out-of-range/);
});

test('covers the whole timeline at the hard limit and with one job', () => {
  assert.deepEqual(splitFrames(90, 1), [{id: '01', start: 0, end: 89}]);
  const chunks = splitFrames(91, 15);
  assert.equal(chunks.length, 15);
  assert.equal(chunks.at(-1).end, 90);
  assert.deepEqual(chunks.map(({start}, i) => start - (chunks[i - 1]?.end ?? -1)), Array(15).fill(1));
  for (const input of ['15.5', '01', '1e1', ' 4', '4\n', 'NaN']) assert.throws(() => parseRequest('Demo', input));
});

test('rejects absent, duplicated and out-of-bounds shards and mismatched receipts', () => {
  const plan = makePlan({composition: 'Demo', requestedShards: 4, commit: 'a'.repeat(40), runId: 'local', startedAt: '2026-01-01T00:00:00Z', width: 640, height: 360, fps: 30, durationInFrames: 90});
  for (const mutate of [
    (chunks) => chunks.pop(),
    (chunks) => {chunks[1] = chunks[0];},
    (chunks) => {chunks.at(-1).end++;},
  ]) {
    const bad = structuredClone(plan);
    mutate(bad.chunks);
    assert.throws(() => validatePlan(bad), /missing, duplicate, overlapping or out-of-range/);
  }
  const [chunk] = plan.chunks;
  const receipt = {version: 1, plan: 'hash', kind: 'video', chunk, elapsedMs: 1};
  assert.equal(verifyReceipt(receipt, 'hash', chunk), 1);
  assert.throws(() => verifyReceipt(receipt, 'stale', chunk), /receipt/);
  assert.throws(() => verifyReceipt(receipt, 'hash', plan.chunks[1]), /receipt/);
});

test('rejects odd dimensions and unsupported frame rates', () => {
  assert.throws(() => makePlan({composition: 'Demo', requestedShards: 1, commit: 'a'.repeat(40), runId: 'local', startedAt: '2026-01-01T00:00:00Z', width: 641, height: 360, fps: 30, durationInFrames: 90}), /dimensions/);
  assert.throws(() => makePlan({composition: 'Demo', requestedShards: 1, commit: 'a'.repeat(40), runId: 'local', startedAt: '2026-01-01T00:00:00Z', width: 640, height: 360, fps: 29, durationInFrames: 90}), /fps/);
});
