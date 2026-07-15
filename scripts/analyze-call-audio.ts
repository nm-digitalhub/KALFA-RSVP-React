// Tier-0 acoustic analysis for AI voice-call QA — turns "NEEDS_AUDIO" pacing /
// volume / dead-air / clipping parameters into evidence-scored metrics, using
// ffmpeg/ffprobe only (NO external API, NO Python, deterministic). The JSON it
// emits is the "acoustic evidence pack" fed to the voice-call-qa-analyst agent's
// Phase 2, alongside the transcript + call metadata.
//
// Usage:
//   npx tsx scripts/analyze-call-audio.ts <audio.mp3> [--script <ref.txt>] \
//     [--transcript <stt.txt>] [--json <out.json>] [--silence-db -35] [--min-sil 0.4]
//
// - --script    : the EXACT text the TTS was supposed to say (reference).
// - --transcript: the STT text actually heard (e.g. Groq Whisper output).
//   When both are given, a token diff flags likely mis-pronounced / unclear words.
//
// Requires ffmpeg + ffprobe on PATH. Prints a human summary to stderr and the
// full JSON to stdout (or to --json). Never touches the network.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

interface Pause {
  start: number;
  end: number;
  duration: number;
  kind: 'leading' | 'trailing' | 'inter-turn' | 'dead-air';
}

function ff(args: string[]): string {
  // ffmpeg writes its analysis to STDERR; `-f null -` discards the audio output.
  // spawnSync returns both streams (execFileSync returns only stdout, which is empty here).
  const res = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args, '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return res.stderr ?? '';
}

function num(re: RegExp, text: string): number | null {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main(): void {
  const audio = process.argv[2];
  if (!audio || audio.startsWith('--')) {
    console.error('usage: analyze-call-audio.ts <audio> [--script f] [--transcript f] [--json out]');
    process.exit(1);
  }
  const silenceDb = arg('--silence-db', '-35')!;
  const minSil = arg('--min-sil', '0.4')!;
  const DEAD_AIR = 2.0; // seconds — a pause beyond this is flagged (may be legit input-wait)

  // --- duration ---
  const duration = Number(
    execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', audio,
    ], { encoding: 'utf8' }).trim(),
  );

  // --- silence / pauses ---
  const silTxt = ff(['-i', audio, '-af', `silencedetect=noise=${silenceDb}dB:d=${minSil}`]);
  const starts = [...silTxt.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...silTxt.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)]
    .map((m) => ({ end: Number(m[1]), dur: Number(m[2]) }));
  const pauses: Pause[] = [];
  for (let i = 0; i < ends.length; i++) {
    const start = starts[i] ?? ends[i].end - ends[i].dur;
    const p = { start, end: ends[i].end, duration: ends[i].dur };
    const kind: Pause['kind'] =
      start <= 0.05 ? 'leading' : ends[i].dur >= DEAD_AIR ? 'dead-air' : 'inter-turn';
    pauses.push({ ...p, kind });
  }
  // a trailing silence_start with no matching end = silence to EOF
  if (starts.length > ends.length) {
    const start = starts[starts.length - 1];
    pauses.push({ start, end: duration, duration: +(duration - start).toFixed(3), kind: 'trailing' });
  }
  const totalSilence = +pauses.reduce((s, p) => s + p.duration, 0).toFixed(3);
  const voiced = +(duration - totalSilence).toFixed(3);
  const deadAir = pauses.filter((p) => p.kind === 'dead-air');

  // --- volume / clipping ---
  const volTxt = ff(['-i', audio, '-af', 'volumedetect']);
  const meanVol = num(/mean_volume:\s*(-?[\d.]+)\s*dB/, volTxt);
  const maxVol = num(/max_volume:\s*(-?[\d.]+)\s*dB/, volTxt);
  const clipping = maxVol !== null && maxVol >= -1.0;

  // --- loudness (EBU R128) ---
  const lufsTxt = ff(['-i', audio, '-af', 'ebur128=framelog=quiet']);
  const lufs = num(/I:\s*(-?[\d.]+)\s*LUFS/, lufsTxt);
  const lra = num(/LRA:\s*([\d.]+)\s*LU/, lufsTxt);

  // --- astats: flat_factor is a flatline/glitch hint. (Overall RMS/peak are read
  // from volumedetect above — astats reports PER-CHANNEL, and a stereo call record
  // splits guest vs bot into separate channels, so its per-channel RMS is misleading.)
  const statTxt = ff(['-i', audio, '-af', 'astats=metadata=1:reset=0']);
  const flatFactor = num(/Flat factor:\s*([\d.]+)/, statTxt);

  // --- speaking rate (needs a transcript for the word count) ---
  const transcriptPath = arg('--transcript');
  const scriptPath = arg('--script');
  const readWords = (p?: string): string[] =>
    p ? (readFileSync(p, 'utf8').match(/[\p{L}\p{N}']+/gu) ?? []) : [];
  const transcriptWords = readWords(transcriptPath);
  const scriptWords = readWords(scriptPath);
  const wordsPerMin = transcriptWords.length && voiced ? +(transcriptWords.length / voiced * 60).toFixed(1) : null;

  // --- script-fidelity diff → pronunciation/clarity suspects ---
  let fidelity: null | { suspects: string[]; missingFromCall: string[]; matchRate: number } = null;
  if (transcriptWords.length && scriptWords.length) {
    const norm = (w: string) => w.replace(/["'׳״]/g, '');
    const scriptSet = new Set(scriptWords.map(norm));
    const transSet = new Set(transcriptWords.map(norm));
    const suspects = [...transSet].filter((w) => !scriptSet.has(w)); // heard but not in script → likely mis-said/mis-heard
    const missing = [...scriptSet].filter((w) => !transSet.has(w)); // in script but not heard
    const matched = [...scriptSet].filter((w) => transSet.has(w)).length;
    fidelity = {
      suspects,
      missingFromCall: missing,
      matchRate: +(matched / scriptSet.size).toFixed(2),
    };
  }

  // --- anchor hints (map metrics → rubric bands so the QA agent has evidence) ---
  const flags: string[] = [];
  for (const p of deadAir) flags.push(`dead-air ${p.duration}s @ ${p.start.toFixed(1)}s (rubric C1: >2s)`);
  if (clipping) flags.push(`clipping: max_volume ${maxVol}dB (near 0)`);
  if (lufs !== null && lufs < -20) flags.push(`quiet: ${lufs} LUFS (telephony target ~ -16)`);
  if (lufs !== null && lufs > -14) flags.push(`hot: ${lufs} LUFS`);
  if (flatFactor !== null && flatFactor > 5) flags.push(`possible flatline/glitch: flat_factor ${flatFactor}`);
  if (fidelity?.suspects.length) flags.push(`pronunciation suspects (heard≠script): ${fidelity.suspects.join(', ')}`);

  const result = {
    audio,
    duration_sec: duration,
    voiced_sec: voiced,
    silence_sec: totalSilence,
    pauses,
    dead_air: deadAir,
    volume: { mean_db: meanVol, max_db: maxVol, clipping },
    loudness: { integrated_lufs: lufs, lra },
    astats: { flat_factor: flatFactor },
    speaking_rate_wpm: wordsPerMin,
    script_fidelity: fidelity,
    flags,
  };

  // human summary → stderr; JSON → stdout / file
  console.error('=== acoustic analysis (Tier 0) ===');
  console.error(`duration ${duration}s · voiced ${voiced}s · silence ${totalSilence}s · pauses ${pauses.length}`);
  console.error(`volume mean ${meanVol}dB max ${maxVol}dB${clipping ? ' ⚠CLIPPING' : ''} · loudness ${lufs} LUFS (LRA ${lra})`);
  if (wordsPerMin) console.error(`speaking rate ~${wordsPerMin} wpm`);
  if (fidelity) console.error(`script match ${(fidelity.matchRate * 100).toFixed(0)}% · suspects: ${fidelity.suspects.join(', ') || '—'}`);
  if (flags.length) console.error('flags:\n  - ' + flags.join('\n  - '));

  const outJson = arg('--json');
  const json = JSON.stringify(result, null, 2);
  if (outJson) {
    writeFileSync(outJson, json);
    console.error(`\nwrote JSON → ${outJson}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

main();
