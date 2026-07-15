/**
 * analyze-call-prosody.ts — per-utterance intonation (prosody) analysis of the AI
 * agent's speech in a call recording. Reads the VoxEngine session log to find the
 * recording start (t0) and each agent media window + spoken text, slices the agent
 * channel per utterance, and measures the F0 (pitch) contour of each:
 *   - meanHz               central pitch of the utterance
 *   - startHz / endHz      mean pitch of the first/last third
 *   - deltaSemitones       endHz vs startHz → terminal intonation direction
 *   - contour              ↗ rising / ↘ falling / → flat (threshold ±1.5 semitones)
 *   - rangeSemitones       p5..p95 span = within-utterance expressiveness
 * Rising terminal contour normally marks a question; falling marks a statement/close.
 *
 * Usage: npx tsx scripts/analyze-call-prosody.ts <recording.mp3> <session.log> [--channel agent|guest]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Pitchfinder from 'pitchfinder';

const SR = 16000;
const FRAME = 1024;
const HOP = 256;
const F0_MIN = 70;
const F0_MAX = 400;

function tsToSec(ts: string): number {
  const [h, m, s] = ts.split(':');
  return +h * 3600 + +m * 60 + parseFloat(s);
}

type Utt = { text: string; start: number; end: number };

function parseLog(logPath: string): { t0: number; utts: Utt[] } {
  const lines = readFileSync(logPath, 'utf8').split('\n');
  let t0 = 0;
  const utts: Utt[] = [];
  let pendingStart = 0;
  let pendingText = '';
  for (const line of lines) {
    const tsMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d+)/);
    if (!tsMatch) continue;
    const t = tsToSec(tsMatch[1]);
    if (t0 === 0 && line.includes('Call.RecordStarted')) t0 = t;
    if (line.includes('AGENT_MEDIA_STARTED')) {
      pendingStart = t;
      pendingText = '';
    } else if (line.includes('[VoiceAgentTest] AGENT: ')) {
      const j = line.match(/agent_response":"([^"]*(?:\\.[^"]*)*)"/);
      if (j) pendingText = j[1].replace(/\\n/g, ' ').trim();
    } else if (line.includes('AGENT_MEDIA_ENDED') && pendingStart) {
      utts.push({ text: pendingText, start: pendingStart, end: t });
      pendingStart = 0;
    }
  }
  return { t0, utts };
}

function sliceF0(mp3: string, channel: string, from: number, dur: number): number[] {
  if (dur <= 0.15) return [];
  const map = channel === 'guest' ? '0.0.0' : '0.0.1';
  const dir = mkdtempSync(join(tmpdir(), 'pros-'));
  const raw = join(dir, 'a.f32');
  try {
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-ss', from.toFixed(3), '-t', dur.toFixed(3),
      '-i', mp3, '-map_channel', map, '-ac', '1', '-ar', String(SR), '-f', 'f32le', raw,
    ]);
    const buf = readFileSync(raw);
    const pcm = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
    const detect = Pitchfinder.YIN({ sampleRate: SR, threshold: 0.15 });
    const f0: number[] = [];
    for (let i = 0; i + FRAME <= pcm.length; i += HOP) {
      const p = detect(pcm.subarray(i, i + FRAME));
      if (p && p >= F0_MIN && p <= F0_MAX) f0.push(p);
    }
    return f0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const st = (a: number, b: number) => (a > 0 && b > 0 ? 12 * Math.log2(b / a) : 0);

const args = process.argv.slice(2);
const mp3 = args[0];
const log = args[1];
const channel = args.includes('--channel') ? args[args.indexOf('--channel') + 1] : 'agent';
if (!mp3 || !log) {
  console.error('usage: tsx scripts/analyze-call-prosody.ts <recording.mp3> <session.log> [--channel agent|guest]');
  process.exit(1);
}

const { t0, utts } = parseLog(log);
if (!t0) {
  console.error('could not find Call.RecordStarted in log');
  process.exit(1);
}

console.log(`t0=${t0.toFixed(3)}s · ${utts.length} agent utterances · channel=${channel}\n`);
for (let i = 0; i < utts.length; i++) {
  const u = utts[i];
  const from = Math.max(0, u.start - t0);
  const dur = u.end - u.start;
  const f0 = sliceF0(mp3, channel, from, dur);
  if (f0.length < 4) {
    console.log(`#${i + 1} [${from.toFixed(1)}s +${dur.toFixed(1)}s] (too little voiced)  "${u.text}"`);
    continue;
  }
  const third = Math.max(1, Math.floor(f0.length / 3));
  const startHz = mean(f0.slice(0, third));
  const endHz = mean(f0.slice(-third));
  const delta = st(startHz, endHz);
  const contour = delta > 1.5 ? '↗ rising' : delta < -1.5 ? '↘ falling' : '→ flat';
  const range = st(pct(f0, 5), pct(f0, 95));
  console.log(
    `#${i + 1} [${from.toFixed(1)}s +${dur.toFixed(1)}s]  ${contour}  ` +
      `Δ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}st | mean ${mean(f0).toFixed(0)}Hz | range ${range.toFixed(1)}st\n` +
      `    "${u.text}"`,
  );
}
