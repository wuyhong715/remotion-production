import {appendFile, mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {readPlan, verifyReceipt, writeJson} from './plan.mjs';
import {concatManifest, mux, segmentPath, verifyVideo, verifyWave} from './media.mjs';

const started = performance.now();
const env = process.env;
const packageDir = resolve(env.RENDER_PACKAGE ?? 'out/package');
const parts = resolve(env.RENDER_PARTS ?? 'out/artifacts');
const outputDir = resolve(env.RENDER_OUTPUT ?? 'out/final');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const {plan, digest} = await readPlan(packageDir, {commit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID});
const prepare = await json(join(packageDir, 'prepare.json'));
if (!Number.isFinite(prepare.elapsedMs) || prepare.elapsedMs < 0) throw new Error('invalid preparation time');

const expected = plan.chunks.map(({id}) => `chunk-${id}`);
const actual = (await readdir(parts, {withFileTypes: true})).filter((d) => d.name.startsWith('chunk-'));
if (actual.length !== expected.length || !actual.every((d) => d.isDirectory() && expected.includes(d.name))) {
  throw new Error('missing or unexpected video shard directories');
}
let fingerprint;
const chunks = [];
for (const chunk of plan.chunks) {
  const elapsedMs = verifyReceipt(await json(join(parts, `chunk-${chunk.id}`, 'receipt.json')), digest, chunk);
  const video = verifyVideo(segmentPath(parts, chunk.id), plan, chunk.end - chunk.start + 1);
  const key = JSON.stringify(video);
  if (fingerprint && key !== fingerprint) throw new Error(`shard ${chunk.id} encoding differs from the other shards`);
  fingerprint = key;
  chunks.push({...chunk, elapsedMs});
}
const audio = verifyReceipt(await json(join(parts, 'audio', 'receipt.json')), digest);
const wave = join(parts, 'audio', 'full.wav');
verifyWave(wave, plan);
const concat = join(parts, 'video.ffconcat');
await writeFile(concat, concatManifest(plan.chunks, plan.fps));
await mkdir(outputDir, {recursive: true});
const pending = join(outputDir, '.video.pending.mp4');
mux({concat, wave, output: pending, plan});
await rename(pending, join(outputDir, 'video.mp4'));
const report = {
  ...plan, chunks,
  elapsedMs: {prepare: prepare.elapsedMs, audio, assemble: Math.round(performance.now() - started),
    fromPrepareStart: Date.now() - Date.parse(plan.startedAt)},
};
await writeJson(join(outputDir, 'report.json'), report);
if (env.GITHUB_STEP_SUMMARY) {
  const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
  await appendFile(env.GITHUB_STEP_SUMMARY, [
    `### ${plan.composition} · ${plan.width} × ${plan.height} · ${plan.fps} fps`,
    `- ${plan.durationInFrames} frames, ${chunks.length} video jobs and one audio job`,
    `- Prepare: ${seconds(prepare.elapsedMs)}; slowest video shard: ${seconds(Math.max(...chunks.map((c) => c.elapsedMs)))}; audio: ${seconds(audio)}; assemble/verify: ${seconds(report.elapsedMs.assemble)}`,
    `- From prepare script start: ${seconds(report.elapsedMs.fromPrepareStart)} (excludes time before prepare)`,
    '',
  ].join('\n') + '\n');
}
console.log(`Validated ${plan.durationInFrames} frames and full-length audio: ${join(outputDir, 'video.mp4')}`);
