import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiDifficulty } from '../src/types/game';
import type { PersistedTrainingMatch, TrainingExample } from '../src/engine/aiTraining';
import { getAiDifficultyLabel, parseAiDifficulty } from '../src/engine/aiDifficulty';
import {
  HYBRID_FEATURE_NAMES,
  extractHybridFeaturesFromExample,
  type HybridPolicyArtifact,
} from '../src/engine/hybridPolicy';

type TrainingDifficultyTarget = AiDifficulty | 'all';

const DEFAULT_ARTIFACT_OUTPUTS: Record<AiDifficulty, string> = {
  easy: 'src/data/hybridPolicyArtifact.easy.json',
  normal: 'src/data/hybridPolicyArtifact.normal.json',
  hard: 'src/data/hybridPolicyArtifact.hard.json',
};

function parseArgs(argv: string[]) {
  let input = 'training-data';
  let output: string | null = null;
  let outputSpecified = false;
  let epochs = 8;
  let lr = 0.08;
  let blend = 12;
  let difficulty: TrainingDifficultyTarget = 'all';

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input' || token === '-i') {
      input = argv[i + 1] ?? input;
      i += 1;
      continue;
    }
    if (token === '--output' || token === '-o') {
      output = argv[i + 1] ?? output;
      outputSpecified = true;
      i += 1;
      continue;
    }
    if (token === '--epochs') {
      epochs = Number(argv[i + 1] ?? epochs);
      i += 1;
      continue;
    }
    if (token === '--lr') {
      lr = Number(argv[i + 1] ?? lr);
      i += 1;
      continue;
    }
    if (token === '--blend') {
      blend = Number(argv[i + 1] ?? blend);
      i += 1;
      continue;
    }
    if (token === '--difficulty' || token === '-d') {
      const rawDifficulty = (argv[i + 1] ?? '').trim().toLowerCase();
      if (rawDifficulty === 'all' || rawDifficulty === 'a') {
        difficulty = 'all';
      } else {
        const parsedDifficulty = parseAiDifficulty(rawDifficulty);
        if (!parsedDifficulty) {
          throw new Error('Invalid --difficulty value. Use easy, normal, hard, or all.');
        }
        difficulty = parsedDifficulty;
      }
      i += 1;
    }
  }

  return {
    input,
    output,
    outputSpecified,
    epochs: Number.isFinite(epochs) && epochs > 0 ? epochs : 8,
    lr: Number.isFinite(lr) && lr > 0 ? lr : 0.08,
    blend: Number.isFinite(blend) && blend > 0 ? blend : 12,
    difficulty,
  };
}

async function collectFiles(inputPath: string): Promise<string[]> {
  const stats = await readdir(inputPath, { withFileTypes: true }).catch(() => null);
  if (!stats) return [inputPath];
  return stats
    .filter(entry => entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.jsonl')))
    .map(entry => path.join(inputPath, entry.name));
}

function parseMatchPayload(text: string, filePath: string): PersistedTrainingMatch[] {
  if (filePath.endsWith('.jsonl')) {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line) as PersistedTrainingMatch);
  }

  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed as PersistedTrainingMatch[];
  if (Array.isArray(parsed.matches)) return parsed.matches as PersistedTrainingMatch[];
  return [parsed as PersistedTrainingMatch];
}

function buildExamples(matches: PersistedTrainingMatch[], difficulty: AiDifficulty | null) {
  const examples: Array<{ features: number[]; reward: number }> = [];

  for (const match of matches) {
    if (match.tainted) continue;
    if (difficulty && match.aiDifficulty !== difficulty) continue;
    for (const example of match.examples) {
      const features = extractHybridFeaturesFromExample(example as TrainingExample);
      if (!features) continue;
      examples.push({ features, reward: example.reward });
    }
  }

  return examples;
}

function resolveTrainingTargets(args: ReturnType<typeof parseArgs>) {
  if (args.difficulty === 'all') {
    if (args.outputSpecified) {
      throw new Error('Do not pass --output with --difficulty all. Train the three default artifact files together instead.');
    }
    return (Object.entries(DEFAULT_ARTIFACT_OUTPUTS) as Array<[AiDifficulty, string]>).map(([difficulty, outputPath]) => ({
      difficulty,
      outputPath,
    }));
  }

  return [{
    difficulty: args.difficulty,
    outputPath: args.output ?? DEFAULT_ARTIFACT_OUTPUTS[args.difficulty],
  }];
}

function dot(weights: number[], features: number[]) {
  let score = 0;
  for (let i = 0; i < features.length; i += 1) score += (weights[i] ?? 0) * features[i];
  return score;
}

function trainLinearModel(
  examples: Array<{ features: number[]; reward: number }>,
  epochs: number,
  lr: number,
) {
  const weights = new Array(HYBRID_FEATURE_NAMES.length).fill(0);

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const example of examples) {
      const prediction = dot(weights, example.features);
      const error = prediction - example.reward;
      for (let i = 0; i < weights.length; i += 1) {
        weights[i] -= lr * error * example.features[i];
      }
    }
  }

  const mse = examples.reduce((sum, example) => {
    const error = dot(weights, example.features) - example.reward;
    return sum + error * error;
  }, 0) / Math.max(1, examples.length);

  return { weights, mse };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const inputPath = path.resolve(projectRoot, args.input);
  const files = await collectFiles(inputPath);

  const matches: PersistedTrainingMatch[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    matches.push(...parseMatchPayload(content, file));
  }

  const targets = resolveTrainingTargets(args);
  const preparedTargets = targets.map(target => ({
    ...target,
    examples: buildExamples(matches, target.difficulty),
  }));
  const missingTargets = preparedTargets.filter(target => target.examples.length === 0);
  if (missingTargets.length > 0) {
    const missingLabel = missingTargets.map(target => getAiDifficultyLabel(target.difficulty)).join(', ');
    throw new Error(`No clean training examples were found for ${missingLabel}. Generate matching self-play data first.`);
  }

  for (const target of preparedTargets) {
    const outputPath = path.resolve(projectRoot, target.outputPath);
    const { weights, mse } = trainLinearModel(target.examples, args.epochs, args.lr);
    const artifact: HybridPolicyArtifact = {
      version: 1,
      enabled: true,
      blend: args.blend,
      trainedAt: new Date().toISOString(),
      sampleCount: target.examples.length,
      mse,
      difficulty: target.difficulty,
      featureNames: [...HYBRID_FEATURE_NAMES],
      weights,
    };

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(artifact, null, 2), 'utf8');

    console.log(`Hybrid policy trained on ${target.examples.length} examples.`);
    console.log(`difficulty_filter=${getAiDifficultyLabel(target.difficulty)}`);
    console.log(`mse=${mse.toFixed(6)}`);
    console.log(`artifact=${outputPath}`);
  }
}

main().catch((error) => {
  console.error('Hybrid training failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
