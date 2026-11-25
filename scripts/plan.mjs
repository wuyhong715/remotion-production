import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const VIDEO_LIMIT = 15;
export const SAMPLE_RATE = 48_000;
export const SUPPORTED_FPS = [24, 25, 30, 50, 60];
const positiveInteger = (n) => Number.isSafeInteger(n) && n > 0;

export function parseRequest(composition, rawShards) {
  if (typeof composition !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(composition)) {
    throw new Error('composition must be a Remotion ID (letters, numbers and hyphens)');
  }
  if (typeof rawShards !== 'string' || !/^(?:[1-9]|1[0-5])$/.test(rawShards)) {
    throw new Error(`shards must be an integer from 1 to ${VIDEO_LIMIT} (video jobs only)`);
  }
  return {composition, requestedShards: Number(rawShards)};
}

export function splitFrames(total, requestedShards) {
  if (!positiveInteger(total) || !positiveInteger(requestedShards) || requestedShards > VIDEO_LIMIT) {
    throw new Error('invalid frame count or shard count');
  }
  const count = Math.min(total, requestedShards);
  const base = Math.floor(total / count);
  const extra = total % count;
  let start = 0;
  return Array.from({length: count}, (_, i) => {
    const length = base + Number(i < extra);
    const chunk = {id: String(i + 1).padStart(2, '0'), start, end: start + length - 1};
    start += length;
    return chunk;
  });
}

export function makePlan({composition, requestedShards, commit, runId, startedAt, width, height, fps, durationInFrames}) {
  parseRequest(composition, String(requestedShards));
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit) || typeof runId !== 'string' || !/^(?:local|[0-9]+)$/.test(runId)) {
    throw new Error('invalid commit or workflow run identity');
  }
  if (typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) throw new Error('invalid start time');
  if (![width, height].every((n) => positiveInteger(n) && n % 2 === 0) || !SUPPORTED_FPS.includes(fps)) {
    throw new Error(`composition requires even dimensions and fps in ${SUPPORTED_FPS.join(', ')}`);
  }
  if (!positiveInteger(durationInFrames) || !Number.isSafeInteger(durationInFrames * (SAMPLE_RATE / fps))) {
    throw new Error('invalid composition duration');
  }
  return {version: 1, composition, requestedShards, commit, runId, startedAt, width, height, fps, durationInFrames,
    chunks: splitFrames(durationInFrames, requestedShards)};
}

export function validatePlan(plan) {
  if (plan?.version !== 1) throw new Error('unsupported render plan version');
  const expected = makePlan(plan);
  if (plan.requestedShards !== expected.requestedShards || !Array.isArray(plan.chunks) || plan.chunks.length !== expected.chunks.length ||
      !expected.chunks.every((c, i) => c.id === plan.chunks[i]?.id && c.start === plan.chunks[i]?.start && c.end === plan.chunks[i]?.end)) {
    throw new Error('render plan has a missing, duplicate, overlapping or out-of-range chunk');
  }
  return expected;
}

export async function readPlan(dir, {commit, runId} = {}) {
  const bytes = await readFile(join(dir, 'manifest.json'));
  const plan = validatePlan(JSON.parse(bytes));
  if ((commit && plan.commit !== commit) || (runId && plan.runId !== runId)) {
    throw new Error('manifest does not belong to this commit/workflow run');
  }
  return {plan, digest: createHash('sha256').update(bytes).digest('hex')};
}

export function verifyReceipt(receipt, digest, chunk) {
  if (receipt?.version !== 1 || receipt.plan !== digest || receipt.kind !== (chunk ? 'video' : 'audio') ||
      !Number.isFinite(receipt.elapsedMs) || receipt.elapsedMs < 0 ||
      (chunk && (receipt.chunk?.id !== chunk.id || receipt.chunk.start !== chunk.start || receipt.chunk.end !== chunk.end))) {
    throw new Error(`unexpected receipt for ${chunk ? `chunk ${chunk.id}` : 'audio'}`);
  }
  return receipt.elapsedMs;
}

export const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
