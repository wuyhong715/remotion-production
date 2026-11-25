import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {SAMPLE_RATE} from './plan.mjs';

export const VIDEO_CLOCK = 90_000;

export function runTool(tool, args) {
  const bin = process.env[tool.toUpperCase()] || tool;
  const result = spawnSync(bin, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (result.error) throw new Error(`${bin}: ${result.error.message}`, {cause: result.error});
  if (result.status !== 0) throw new Error(`${bin} failed (${result.status ?? result.signal}):\n${result.stderr}`);
  return result.stdout;
}

const probe = (file, args) => JSON.parse(runTool('ffprobe', ['-v', 'error', ...args, '-of', 'json', file]));
export const streams = (file) => probe(file, ['-show_streams']).streams;

export function verifyVideo(file, plan, frames, {final = false} = {}) {
  const tracks = streams(file);
  const video = tracks.find((s) => s.codec_type === 'video');
  const audio = tracks.find((s) => s.codec_type === 'audio');
  const label = final ? 'final video' : 'video shard';
  if (tracks.length !== (final ? 2 : 1) || !video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' ||
      video.width !== plan.width || video.height !== plan.height || video.time_base !== `1/${VIDEO_CLOCK}` || Number(video.has_b_frames) !== 0 ||
      video.avg_frame_rate !== `${plan.fps}/1` || Number(video.nb_frames) !== frames || Number(video.start_pts) !== 0) {
    throw new Error(`${label}: unexpected streams, size, frame rate, duration or frame count (${file})`);
  }
  const frameStep = VIDEO_CLOCK / plan.fps;
  if (Number(video.duration_ts) !== frames * frameStep) throw new Error(`${label}: wrong video stream length (${file})`);
  const {frames: decoded = []} = probe(file, ['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=key_frame,best_effort_timestamp']);
  if (decoded.length !== frames || decoded[0]?.key_frame !== 1 ||
      !decoded.every((frame, i) => Number(frame.best_effort_timestamp) === i * frameStep)) {
    throw new Error(`${label}: missing keyframe or non-contiguous presentation timestamps (${file})`);
  }
  // AAC packet timestamps may have an initial encoder-delay packet; check the edited stream duration.
  if (final && (!audio || audio.codec_name !== 'aac' || Number(audio.sample_rate) !== SAMPLE_RATE ||
      !Number.isFinite(Number(audio.start_time)) || Math.abs(Number(audio.start_time)) > 0.001 ||
      !Number.isFinite(Number(audio.duration)) || Math.abs(Number(audio.duration) - frames / plan.fps) > 1024 / SAMPLE_RATE)) {
    throw new Error('final video: AAC audio is missing or its duration does not match the video');
  }
  return ['profile', 'level', 'sample_aspect_ratio', 'color_range', 'color_space', 'color_transfer', 'color_primaries']
    .map((key) => video[key] ?? null);
}

export function verifyWave(file, plan) {
  const tracks = streams(file);
  const [track] = tracks;
  const samples = plan.durationInFrames * (SAMPLE_RATE / plan.fps);
  if (tracks.length !== 1 || track.codec_type !== 'audio' || track.codec_name !== 'pcm_s16le' ||
      Number(track.sample_rate) !== SAMPLE_RATE || track.time_base !== `1/${SAMPLE_RATE}` || Number(track.duration_ts) !== samples) {
    throw new Error(`full WAV must be exactly ${samples} samples of ${SAMPLE_RATE} Hz PCM (${file})`);
  }
}

export function concatManifest(chunks, fps) {
  const at = (frame) => Math.round(frame / fps * 1_000_000);
  const lines = ['ffconcat version 1.0'];
  for (const chunk of chunks) {
    lines.push(`file chunk-${chunk.id}/segment.mp4`, `duration ${((at(chunk.end + 1) - at(chunk.start)) / 1_000_000).toFixed(6)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function mux({concat, wave, output, plan}) {
  runTool('ffmpeg', [
    '-v', 'error', '-xerror', '-nostdin', '-y', '-f', 'concat', '-safe', '1', '-i', concat,
    '-i', wave, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-video_track_timescale', String(VIDEO_CLOCK), '-movflags', '+faststart', output,
  ]);
  verifyVideo(output, plan, plan.durationInFrames, {final: true});
  runTool('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
}

export const segmentPath = (parts, id) => join(parts, `chunk-${id}`, 'segment.mp4');
