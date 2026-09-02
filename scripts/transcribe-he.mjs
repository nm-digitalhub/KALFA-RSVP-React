#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_NPX_ROOT = '/var/www/vhosts/kalfa.me/.npm/_npx';
const DEFAULT_MODEL = 'ggml-large-v3-turbo.bin';

function usage() {
  console.log(`Usage:
  npm run transcribe
  npm run transcribe -- <audio-file> [--out <output-base>] [--lang he] [--last <seconds>] [--channel mix|left|right]

Examples:
  npm run transcribe -- tmp/voximplant-logs/session-8132042022.mp3
  npm run transcribe -- tmp/voximplant-logs/session-8132042022.mp3 --last 40
  npm run transcribe -- tmp/voximplant-logs/session-8132042022.mp3 --channel left --out tmp/voximplant-logs/whisper/left
`);
}

function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : '';
}

function stripFlags(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) i += 1;
    } else {
      out.push(args[i]);
    }
  }
  return out;
}

function findWhisperRoot() {
  if (process.env.WHISPER_ROOT) return process.env.WHISPER_ROOT;
  const entries = existsSync(DEFAULT_NPX_ROOT) ? readdirSync(DEFAULT_NPX_ROOT) : [];
  for (const entry of entries) {
    const candidate = join(
      DEFAULT_NPX_ROOT,
      entry,
      'node_modules/nodejs-whisper/cpp/whisper.cpp',
    );
    if (existsSync(join(candidate, 'build/bin/whisper-cli'))) return candidate;
  }
  return null;
}

function recentAudioFiles() {
  const dirs = ['tmp/voximplant-logs', 'tmp/voximplant-logs/whisper', 'tmp'];
  const files = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (/\.(mp3|wav|m4a|flac|ogg)$/i.test(name)) files.push(join(dir, name));
    }
  }
  return [...new Set(files)].slice(0, 20);
}

async function askInteractively(args) {
  const rl = createInterface({ input, output });
  try {
    const files = recentAudioFiles();
    if (files.length > 0) {
      console.log('Recent audio files:');
      files.forEach((file, i) => console.log(`  ${i + 1}. ${file}`));
      console.log('');
    }
    const answer = await rl.question('Audio file path or number: ');
    const selected = /^\d+$/.test(answer.trim())
      ? files[Number(answer.trim()) - 1]
      : answer.trim();
    if (!selected) throw new Error('No audio file selected');
    const lang = (await rl.question('Language [he]: ')).trim() || 'he';
    const last = (await rl.question('Only last N seconds? [blank = full]: ')).trim();
    const channel = (await rl.question('Channel [mix/left/right, default mix]: ')).trim() || 'mix';
    const out = (await rl.question('Output base [auto]: ')).trim();
    args.push(selected, '--lang', lang, '--channel', channel);
    if (last) args.push('--last', last);
    if (out) args.push('--out', out);
  } finally {
    rl.close();
  }
}

function defaultOutputBase(audio, last, channel) {
  const name = basename(audio, extname(audio));
  const suffix = `${last ? `-last${last}s` : ''}${channel && channel !== 'mix' ? `-${channel}` : ''}`;
  return join(dirname(audio), 'whisper', `${name}${suffix}`);
}

function requireTool(name) {
  const res = spawnSync('sh', ['-c', 'command -v "$1"', 'sh', name], { encoding: 'utf8' });
  return res.status === 0;
}

function prepareInput(audio, opts) {
  if (!opts.last && (!opts.channel || opts.channel === 'mix')) return audio;
  if (!requireTool('ffmpeg')) {
    throw new Error('ffmpeg is required for --last or --channel');
  }
  const channel = opts.channel || 'mix';
  const dir = 'tmp/transcriptions';
  mkdirSync(dir, { recursive: true });
  const stem = basename(audio, extname(audio));
  const tmp = join(dir, `${stem}${opts.last ? `-last${opts.last}s` : ''}-${channel}.wav`);
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  if (opts.last) args.push('-sseof', `-${opts.last}`);
  args.push('-i', audio);
  if (channel === 'left') args.push('-map_channel', '0.0.0');
  if (channel === 'right') args.push('-map_channel', '0.0.1');
  args.push('-ar', '16000', '-ac', '1', tmp);
  const res = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`ffmpeg failed with exit code ${res.status}`);
  return tmp;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }
  if (stripFlags(args).length === 0) await askInteractively(args);

  const positional = stripFlags(args);
  const audio = positional[0] ? resolve(positional[0]) : '';
  if (!audio || !existsSync(audio)) throw new Error(`Audio file not found: ${audio || '(empty)'}`);

  const root = findWhisperRoot();
  if (!root) {
    throw new Error('Could not find whisper.cpp. Set WHISPER_ROOT to the whisper.cpp directory.');
  }
  const cli = join(root, 'build/bin/whisper-cli');
  const model = process.env.WHISPER_MODEL || join(root, 'models', DEFAULT_MODEL);
  if (!existsSync(cli)) throw new Error(`whisper-cli not found: ${cli}`);
  if (!existsSync(model)) throw new Error(`Whisper model not found: ${model}`);

  const lang = flag(args, 'lang') || 'he';
  const last = flag(args, 'last');
  const channel = flag(args, 'channel') || 'mix';
  if (!['mix', 'left', 'right'].includes(channel)) {
    throw new Error('--channel must be mix, left, or right');
  }
  const outBase = flag(args, 'out') || defaultOutputBase(audio, last, channel);
  mkdirSync(dirname(outBase), { recursive: true });

  const inputAudio = prepareInput(audio, { last, channel });
  const whisperArgs = [
    '-m',
    model,
    '-f',
    inputAudio,
    '-l',
    lang,
    '-osrt',
    '-otxt',
    '-of',
    outBase,
  ];

  console.log(`Transcribing: ${audio}`);
  if (inputAudio !== audio) console.log(`Prepared audio: ${inputAudio}`);
  console.log(`Output base: ${outBase}`);
  const res = spawnSync(cli, whisperArgs, { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
  console.log(`\nDone:
  ${outBase}.txt
  ${outBase}.srt`);
}

main().catch((e) => {
  console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
