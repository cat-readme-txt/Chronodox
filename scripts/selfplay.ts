import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiDifficulty } from '../src/types/game';
import { DEFAULT_AI_DIFFICULTY } from '../src/types/game';
import { getAiDifficultyLabel, parseAiDifficulty } from '../src/engine/aiDifficulty';
import { runSelfPlayBatch } from '../src/engine/selfPlay';
import type { PersistedTrainingMatch } from '../src/engine/aiTraining';

function parseArgs(argv: string[]) {
  let matches = 100;
  let maxRounds = 40;
  let out = 'training-data';
  let prefix = 'selfplay';
  let difficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--matches' || token === '-m') {
      matches = Number(argv[i + 1] ?? matches);
      i += 1;
      continue;
    }
    if (token === '--max-rounds') {
      maxRounds = Number(argv[i + 1] ?? maxRounds);
      i += 1;
      continue;
    }
    if (token === '--out' || token === '-o') {
      out = argv[i + 1] ?? out;
      i += 1;
      continue;
    }
    if (token === '--prefix') {
      prefix = argv[i + 1] ?? prefix;
      i += 1;
      continue;
    }
    if (token === '--difficulty' || token === '-d') {
      const parsedDifficulty = parseAiDifficulty(argv[i + 1] ?? '');
      if (!parsedDifficulty) {
        throw new Error('Invalid --difficulty value. Use easy, normal, or hard.');
      }
      difficulty = parsedDifficulty;
      i += 1;
    }
  }

  return {
    matches: Number.isFinite(matches) && matches > 0 ? Math.floor(matches) : 100,
    maxRounds: Number.isFinite(maxRounds) && maxRounds > 0 ? Math.floor(maxRounds) : 40,
    out,
    prefix,
    difficulty,
  };
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function renderProgressLine(progress: {
  completed: number;
  total: number;
  elapsedMs: number;
  etaMs: number | null;
  p1Wins: number;
  p2Wins: number;
  draws: number;
  averageRounds: number;
}) {
  const width = 28;
  const ratio = progress.total <= 0 ? 0 : progress.completed / progress.total;
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  const bar = `${'='.repeat(filled)}${'-'.repeat(width - filled)}`;
  const percent = `${Math.round(ratio * 100)}`.padStart(3, ' ');
  const etaLabel = progress.etaMs === null ? '--:--' : formatDuration(progress.etaMs);
  return `[${bar}] ${percent}% ${progress.completed}/${progress.total} elapsed=${formatDuration(progress.elapsedMs)} eta=${etaLabel} AI=${progress.aiDifficulty.toUpperCase()} P1=${progress.p1Wins} P2=${progress.p2Wins} D=${progress.draws} avgR=${progress.averageRounds}`;
}

function writeChunked(stream: ReturnType<typeof createWriteStream>, chunk: string) {
  return new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      stream.off('error', handleError);
      reject(error);
    };

    stream.on('error', handleError);
    const canContinue = stream.write(chunk, 'utf8', () => {
      stream.off('error', handleError);
      resolve();
    });

    if (!canContinue) {
      stream.once('drain', () => {
        stream.off('error', handleError);
        resolve();
      });
    }
  });
}

function finishStream(stream: ReturnType<typeof createWriteStream>) {
  return new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.end(() => resolve());
  });
}

async function writeMatchesJson(
  filePath: string,
  generatedAt: string,
  summary: ReturnType<typeof runSelfPlayBatch>['summary'],
  matches: PersistedTrainingMatch[],
) {
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  await writeChunked(stream, '{\n');
  await writeChunked(stream, `  "generatedAt": ${JSON.stringify(generatedAt)},\n`);
  await writeChunked(stream, `  "summary": ${JSON.stringify(summary, null, 2).replace(/\n/g, '\n  ')},\n`);
  await writeChunked(stream, '  "matches": [\n');

  for (let i = 0; i < matches.length; i += 1) {
    const serialized = JSON.stringify(matches[i], null, 2).replace(/\n/g, '\n    ');
    await writeChunked(stream, `    ${serialized}${i < matches.length - 1 ? ',' : ''}\n`);
  }

  await writeChunked(stream, '  ]\n');
  await writeChunked(stream, '}\n');
  await finishStream(stream);
}

async function writeMatchesJsonl(filePath: string, matches: PersistedTrainingMatch[]) {
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  for (const match of matches) {
    await writeChunked(stream, `${JSON.stringify(match)}\n`);
  }
  await finishStream(stream);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const interactive = Boolean(process.stdout.isTTY);
  let lastProgressLine = '';
  const result = runSelfPlayBatch({
    count: args.matches,
    maxRounds: args.maxRounds,
    aiDifficulty: args.difficulty,
    onMatchComplete: progress => {
      lastProgressLine = renderProgressLine(progress);
      if (interactive) {
        process.stdout.write(`\r${lastProgressLine}`);
      } else if (
        progress.completed === progress.total
        || progress.completed === 1
        || progress.completed % Math.max(1, Math.floor(progress.total / 10)) === 0
      ) {
        console.log(lastProgressLine);
      }
    },
  });

  if (interactive && lastProgressLine) {
    process.stdout.write('\n');
  }

  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.resolve(projectRoot, args.out);
  await mkdir(outDir, { recursive: true });

  const base = `${args.prefix}-${args.difficulty}-${stamp}-${result.summary.matches}m`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const jsonlPath = path.join(outDir, `${base}.jsonl`);

  await writeMatchesJson(jsonPath, now.toISOString(), result.summary, result.matches);
  await writeMatchesJsonl(jsonlPath, result.matches);

  console.log(`Self-play complete: ${result.summary.matches} matches`);
  console.log(`difficulty=${getAiDifficultyLabel(result.summary.aiDifficulty)}`);
  console.log(`P1 wins=${result.summary.p1Wins} P2 wins=${result.summary.p2Wins} draws=${result.summary.draws}`);
  console.log(`average_rounds=${result.summary.averageRounds}`);
  console.log(`json=${jsonPath}`);
  console.log(`jsonl=${jsonlPath}`);
}

main().catch((error) => {
  console.error('Self-play runner failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
