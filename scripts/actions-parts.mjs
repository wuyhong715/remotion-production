import {mkdir, readdir, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {readPlan} from './plan.mjs';

const runId = process.env.GITHUB_RUN_ID;
if (!/^\d+$/.test(runId ?? '')) throw new Error('invalid Actions run ID');
const {plan} = await readPlan('out/package', {runId, commit: process.env.GITHUB_SHA});
const selected = new Map();
const roots = await readdir('out/downloads', {withFileTypes: true});
const pattern = new RegExp(`^render-part-${runId}-(\\d+)-(\\d{2}|audio)$`);
const currentAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
if (!Number.isSafeInteger(currentAttempt) || currentAttempt < 1) throw new Error('invalid Actions attempt');
for (const dir of roots) {
  const match = dir.name.match(pattern);
  if (!dir.isDirectory() || !match) throw new Error(`unexpected artifact directory: ${dir.name}`);
  const id = match[2];
  if (id !== 'audio' && !plan.chunks.some((c) => c.id === id)) throw new Error(`unexpected artifact shard: ${id}`);
  const attempt = Number(match[1]);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > currentAttempt) {
    throw new Error(`bad artifact attempt for ${dir.name}`);
  }
  const prior = selected.get(id);
  if (prior?.attempt === attempt) throw new Error(`duplicate artifact for ${id}, attempt ${attempt}`);
  if (!prior || prior.attempt < attempt) selected.set(id, {attempt, name: dir.name});
}

await mkdir('out/artifacts', {recursive: true});
for (const id of [...plan.chunks.map((c) => c.id), 'audio']) {
  const entry = selected.get(id);
  if (!entry) throw new Error(`missing artifact for ${id}`);
  const source = join('out/downloads', entry.name);
  const files = await readdir(source, {withFileTypes: true});
  const wanted = id === 'audio' ? ['full.wav', 'receipt.json'] : ['segment.mp4', 'receipt.json'];
  if (files.length !== wanted.length || !files.every((f) => f.isFile() && wanted.includes(f.name))) {
    throw new Error(`unexpected files in ${entry.name}`);
  }
  // assemble.mjs checks every receipt against the exact manifest byte digest.
  await rename(source, join('out/artifacts', id === 'audio' ? 'audio' : `chunk-${id}`));
}
