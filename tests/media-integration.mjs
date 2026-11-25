import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runTool, streams} from '../scripts/media.mjs';
import {makePlan, writeJson} from '../scripts/plan.mjs';

// Browser-independent acceptance test: real H.264 segments and a real PCM/AAC mux.
const root = await mkdtemp(join(tmpdir(), 'remotion-mux-test-'));
const script = fileURLToPath(new URL('../scripts/assemble.mjs', import.meta.url));
const select = fileURLToPath(new URL('../scripts/actions-parts.mjs', import.meta.url));
const pkg = join(root, 'out/package');
const artifacts = join(root, 'out/downloads');
const output = join(root, 'out/final');
const commit = 'a'.repeat(40);
const runId = '123';
const plan = makePlan({composition: 'Demo', requestedShards: 4, commit, runId,
  startedAt: new Date().toISOString(), width: 64, height: 48, fps: 30, durationInFrames: 7});
await mkdir(pkg, {recursive: true});
await writeJson(join(pkg, 'manifest.json'), plan);
await writeJson(join(pkg, 'prepare.json'), {elapsedMs: 12});
const digest = createHash('sha256').update(await readFile(join(pkg, 'manifest.json'))).digest('hex');
const receipt = (kind, chunk) => ({version: 1, kind, plan: digest, ...(chunk ? {chunk} : {}), elapsedMs: 10});
const pcm = (samples) => {
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(48000, 24); data.writeUInt32LE(96000, 28); data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(3000 * Math.sin(i * Math.PI / 60)), 44 + 2 * i);
  return data;
};
for (const chunk of plan.chunks) {
  const dir = join(artifacts, `render-part-${runId}-${chunk.id === '04' ? 2 : 1}-${chunk.id}`);
  await mkdir(dir, {recursive: true});
  const raw = join(dir, 'frames.yuv');
  const bytes = plan.width * plan.height;
  const frames = [];
  for (let n = chunk.start; n <= chunk.end; n++) {
    const frame = Buffer.alloc(bytes * 1.5, 128);
    frame.fill(36 + n * 24, 0, bytes);
    frames.push(frame);
  }
  await writeFile(raw, Buffer.concat(frames));
  runTool('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'yuv420p', '-video_size', `${plan.width}x${plan.height}`,
    '-framerate', String(plan.fps), '-i', raw, '-c:v', 'libx264', '-preset', 'veryfast', '-bf', '0', '-video_track_timescale', '90000',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', join(dir, 'segment.mp4')]);
  // Keep only what the upload action would have received.
  await (await import('node:fs/promises')).unlink(raw);
  await writeJson(join(dir, 'receipt.json'), receipt('video', chunk));
}
const audio = join(artifacts, `render-part-${runId}-1-audio`);
await mkdir(audio, {recursive: true});
await writeFile(join(audio, 'full.wav'), pcm(plan.durationInFrames * 1600));
await writeJson(join(audio, 'receipt.json'), receipt('audio'));
const env = {...process.env, GITHUB_SHA: commit, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: '2'};
function invoke(entry) {
  const call = spawnSync(process.execPath, [entry], {cwd: root, env, encoding: 'utf8'});
  assert.equal(call.status, 0, `${call.stdout}\n${call.stderr}`);
}
invoke(select);
invoke(script);
const final = join(output, 'video.mp4');
const [video, mix] = streams(final);
assert.equal(video.nb_frames, String(plan.durationInFrames));
assert.equal(mix.codec_name, 'aac');
const decode = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-i', final, '-an', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', '-']);
assert.equal(decode.status, 0, decode.stderr.toString());
for (let i = 0; i < plan.durationInFrames; i++) {
  const brightness = decode.stdout[i * plan.width * plan.height * 1.5];
  assert.ok(Math.abs(brightness - (36 + i * 24)) <= 2, `wrong frame content at ${i}: ${brightness}`);
}
const bad = join(root, 'out/artifacts/chunk-04/receipt.json');
await writeJson(bad, {...receipt('video', plan.chunks[3]), plan: 'stale'});
const failed = spawnSync(process.execPath, [script], {cwd: root, env, encoding: 'utf8'});
assert.notEqual(failed.status, 0);
assert.match(failed.stderr, /unexpected receipt/);
console.log('Stream-copy mux, uneven shards including a 1-frame tail, mixed attempts, AAC and stale receipt rejection passed.');
