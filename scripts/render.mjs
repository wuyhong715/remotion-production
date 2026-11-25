import {performance} from 'node:perf_hooks';
import {appendFile, mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {makePlan, parseRequest, readPlan, SAMPLE_RATE, writeJson} from './plan.mjs';

const [operation] = process.argv.slice(2);
const env = process.env;
const commit = env.GITHUB_SHA ?? '0'.repeat(40);
const runId = env.GITHUB_RUN_ID ?? 'local';
const packageDir = resolve(env.RENDER_PACKAGE ?? 'out/package');
const serveUrl = join(packageDir, 'bundle');
const browser = {
  chromiumOptions: {gl: 'swangle'},
  ...(env.CHROME_EXECUTABLE ? {browserExecutable: env.CHROME_EXECUTABLE} : {}),
  logLevel: 'warn',
};
const started = performance.now();

async function prepare() {
  const request = parseRequest(env.COMPOSITION ?? 'Demo', env.SHARDS ?? '4');
  const startedAt = new Date().toISOString();
  await mkdir(packageDir, {recursive: true});
  await bundle({entryPoint: resolve('src/index.ts'), outDir: serveUrl});
  const {width, height, fps, durationInFrames} = await selectComposition({serveUrl, id: request.composition, ...browser});
  const plan = makePlan({...request, commit, runId, startedAt, width, height, fps, durationInFrames});
  await writeJson(join(packageDir, 'manifest.json'), plan);
  await writeJson(join(packageDir, 'prepare.json'), {elapsedMs: Math.round(performance.now() - started)});
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `matrix=${JSON.stringify({include: plan.chunks})}\n`);
  console.log(JSON.stringify(plan, null, 2));
}

async function render(kind) {
  const {plan, digest} = await readPlan(packageDir, {commit, runId});
  const chunk = kind === 'video' ? plan.chunks.find((part) => part.id === env.CHUNK_ID) : undefined;
  if (kind === 'video' && !chunk) throw new Error('CHUNK_ID is not present in the render plan');
  const outputDir = resolve(env.RENDER_PARTS ?? 'out/artifacts', chunk ? `chunk-${chunk.id}` : 'audio');
  await mkdir(outputDir, {recursive: true});
  const composition = await selectComposition({serveUrl, id: plan.composition, ...browser});
  for (const key of ['width', 'height', 'fps', 'durationInFrames']) {
    if (composition[key] !== plan[key]) throw new Error(`composition ${key} differs from plan`);
  }
  let last = -1;
  await renderMedia({
    serveUrl, composition, ...browser, overwrite: true, hardwareAcceleration: 'disable',
    outputLocation: join(outputDir, chunk ? 'segment.mp4' : 'full.wav'),
    concurrency: 2,
    onProgress: ({progress}) => {
      const step = Math.floor(10 * progress);
      if (step > last) { last = step; console.log(`${kind} ${step * 10}%`); }
    },
    ...(chunk ? {
      codec: 'h264', muted: true, frameRange: [chunk.start, chunk.end],
      pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 85, crf: 18,
      x264Preset: 'veryfast', colorSpace: 'bt709',
      // Avoid per-shard decode reordering, including a one-frame tail shard.
      ffmpegOverride: ({args}) => args.includes('libx264') ? [...args.slice(0, -1), '-bf', '0', args.at(-1)] : args,
    } : {codec: 'wav', muted: false, enforceAudioTrack: true, sampleRate: SAMPLE_RATE}),
  });
  await writeJson(join(outputDir, 'receipt.json'), {
    version: 1, kind, plan: digest, ...(chunk ? {chunk} : {}), elapsedMs: Math.round(performance.now() - started),
  });
}

if (operation === 'prepare') await prepare();
else if (operation === 'video' || operation === 'audio') await render(operation);
else throw new Error('expected prepare, video or audio');
