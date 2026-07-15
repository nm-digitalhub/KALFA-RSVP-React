/**
 * analyze-call-pitch.ts — objective "monotone vs expressive" measurement for the
 * AI voice-RSVP agent. Decodes one channel of a call recording to mono PCM (via
 * ffmpeg), runs a pitch tracker (pitchfinder YIN) over overlapping frames, and
 * reports the F0 contour statistics that quantify prosody:
 *   - voicedRatio: fraction of frames with a detected pitch (speech activity)
 *   - meanHz / medianHz: central pitch
 *   - stdHz, cv (=std/mean): raw spread
 *   - semitoneRange: 12*log2(p95/p5) — perceptual pitch span, the key number
 *   - semitoneStd: std of per-frame semitones vs the median (expressiveness)
 * A flat/robotic delivery has a small semitoneRange + low semitoneStd; natural
 * expressive Hebrew speech spans several semitones.
 *
 * Usage: npx tsx scripts/analyze-call-pitch.ts <recording.mp3> [--channel agent|guest|mono]
 *   channel: stereo call recordings are guest=left(0), agent=right(1). Default agent.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Pitchfinder from 'pitchfinder';

const SAMPLE_RATE = 16000;
const FRAME = 1024; // ~64ms
const HOP = 256; // ~16ms
const F0_MIN = 70; // Hz — below = not voiced pitch
const F0_MAX = 400; // Hz — above = noise/harmonic error

function decodeChannel(mp3: string, channel: string): Float32Array {
  const map =
    channel === 'guest' ? '0.0.0' : channel === 'mono' ? '' : '0.0.1'; // default agent
  const dir = mkdtempSync(join(tmpdir(), 'pitch-'));
  const raw = join(dir, 'a.f32');
  try {
    const args = ['-y', '-loglevel', 'error', '-i', mp3];
    if (map) args.push('-map_channel', map);
    args.push('-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', raw);
    execFileSync('ffmpeg', args);
    const buf = readFileSync(raw);
    return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function analyze(mp3: string, channel: string) {
  const pcm = decodeChannel(mp3, channel);
  const detect = Pitchfinder.YIN({ sampleRate: SAMPLE_RATE, threshold: 0.15 });
  const f0: number[] = [];
  let frames = 0;
  for (let i = 0; i + FRAME <= pcm.length; i += HOP) {
    frames++;
    const p = detect(pcm.subarray(i, i + FRAME));
    if (p && p >= F0_MIN && p <= F0_MAX) f0.push(p);
  }
  const durationSec = pcm.length / SAMPLE_RATE;
  const voicedRatio = frames ? f0.length / frames : 0;
  const mean = f0.length ? f0.reduce((a, b) => a + b, 0) / f0.length : 0;
  const med = median(f0);
  const std = f0.length
    ? Math.sqrt(f0.reduce((a, b) => a + (b - mean) ** 2, 0) / f0.length)
    : 0;
  const p5 = percentile(f0, 5);
  const p95 = percentile(f0, 95);
  const semitoneRange = p5 > 0 ? 12 * Math.log2(p95 / p5) : 0;
  const semis = med > 0 ? f0.map((h) => 12 * Math.log2(h / med)) : [];
  const semitoneStd = semis.length
    ? Math.sqrt(semis.reduce((a, b) => a + b * b, 0) / semis.length)
    : 0;

  return {
    file: mp3.split('/').pop(),
    channel,
    durationSec: +durationSec.toFixed(1),
    voicedRatio: +voicedRatio.toFixed(2),
    meanHz: +mean.toFixed(1),
    medianHz: +med.toFixed(1),
    stdHz: +std.toFixed(1),
    cv: mean ? +(std / mean).toFixed(3) : 0,
    semitoneRange: +semitoneRange.toFixed(1),
    semitoneStd: +semitoneStd.toFixed(2),
  };
}

function verdict(r: ReturnType<typeof analyze>): string {
  // Heuristics for TTS/voice prosody. Natural expressive speech: semitoneRange
  // ~10-16, semitoneStd ~2.5-4. Flat/robotic: range < 7, std < 2.
  if (r.semitoneRange < 7 || r.semitoneStd < 2) return 'MONOTONE (flat)';
  if (r.semitoneRange < 10 || r.semitoneStd < 2.5) return 'somewhat flat';
  return 'expressive';
}

const args = process.argv.slice(2);
const mp3 = args.find((a) => !a.startsWith('--'));
const channel = (() => {
  const i = args.indexOf('--channel');
  return i >= 0 ? args[i + 1] : 'agent';
})();
if (!mp3) {
  console.error('usage: tsx scripts/analyze-call-pitch.ts <recording.mp3> [--channel agent|guest|mono]');
  process.exit(1);
}
const r = analyze(mp3, channel);
console.log(JSON.stringify({ ...r, verdict: verdict(r) }, null, 2));
