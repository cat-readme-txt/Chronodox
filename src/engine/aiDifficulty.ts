import type { ActionType, AiDifficulty } from '../types/game';
import { AI_DIFFICULTY_LABELS, DEFAULT_AI_DIFFICULTY } from '../types/game';

export interface AiDifficultyOption {
  value: AiDifficulty;
  label: string;
  summary: string;
  detail: string;
  accent: string;
}

export interface AiDifficultyProfile {
  difficulty: AiDifficulty;
  label: string;
  tacticalMultiplier: number;
  strategicMultiplier: number;
  waitBias: number;
  learnedBlendMultiplier: number;
  rankingNoise: number;
  sampleWindow: number;
  sampleDecay: number;
}

const AI_DIFFICULTY_ALIASES: Record<string, AiDifficulty> = {
  easy: 'easy',
  e: 'easy',
  normal: 'normal',
  n: 'normal',
  medium: 'normal',
  standard: 'normal',
  hard: 'hard',
  h: 'hard',
};

const AI_DIFFICULTY_PROFILES: Record<AiDifficulty, AiDifficultyProfile> = {
  easy: {
    difficulty: 'easy',
    label: AI_DIFFICULTY_LABELS.easy,
    tacticalMultiplier: 0.94,
    strategicMultiplier: 0.8,
    waitBias: 8,
    learnedBlendMultiplier: 0.4,
    rankingNoise: 4.5,
    sampleWindow: 6,
    sampleDecay: 0.72,
  },
  normal: {
    difficulty: 'normal',
    label: AI_DIFFICULTY_LABELS.normal,
    tacticalMultiplier: 1,
    strategicMultiplier: 1,
    waitBias: 0,
    learnedBlendMultiplier: 1,
    rankingNoise: 0.75,
    sampleWindow: 2,
    sampleDecay: 0.18,
  },
  hard: {
    difficulty: 'hard',
    label: AI_DIFFICULTY_LABELS.hard,
    tacticalMultiplier: 1.04,
    strategicMultiplier: 1.12,
    waitBias: -1.5,
    learnedBlendMultiplier: 1.18,
    rankingNoise: 0.15,
    sampleWindow: 1,
    sampleDecay: 0.01,
  },
};

const STRATEGIC_ACTIONS = new Set<ActionType>([
  'LOCATE',
  'STRIKE_REPORT',
  'DEEP_COVER',
  'PREPARE_ACTION',
  'ENCRYPTION',
  'RAPID_RECON',
  'MULTI_TIMELINE_STRIKE',
]);

export const AI_DIFFICULTY_OPTIONS: AiDifficultyOption[] = [
  {
    value: 'easy',
    label: AI_DIFFICULTY_LABELS.easy,
    summary: 'More forgiving and more likely to drift away from the best line.',
    detail: 'Uses wider sampling, weaker strategic follow-through, and more idle turns.',
    accent: '#8fdfff',
  },
  {
    value: 'normal',
    label: AI_DIFFICULTY_LABELS.normal,
    summary: 'Balanced play with some variety and the full hybrid policy enabled.',
    detail: 'Best default for most matches and mixed-difficulty training batches.',
    accent: '#8df5df',
  },
  {
    value: 'hard',
    label: AI_DIFFICULTY_LABELS.hard,
    summary: 'Sharper action ordering, stronger strategy bonuses, and less hesitation.',
    detail: 'Most consistent preset for tougher live matches and stronger self-play datasets.',
    accent: '#ffcf8a',
  },
];

export function parseAiDifficulty(value?: string | null): AiDifficulty | null {
  if (!value) return null;
  return AI_DIFFICULTY_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function normalizeAiDifficulty(value?: string | null): AiDifficulty {
  return parseAiDifficulty(value) ?? DEFAULT_AI_DIFFICULTY;
}

export function getAiDifficultyLabel(value?: string | null) {
  return AI_DIFFICULTY_LABELS[normalizeAiDifficulty(value)];
}

export function getAiDifficultyProfile(value?: string | null) {
  return AI_DIFFICULTY_PROFILES[normalizeAiDifficulty(value)];
}

export function getAiDifficultyMultiplier(actionType: ActionType, difficulty?: string | null) {
  const profile = getAiDifficultyProfile(difficulty);
  if (actionType === 'WAIT') return 1;
  return STRATEGIC_ACTIONS.has(actionType)
    ? profile.strategicMultiplier
    : profile.tacticalMultiplier;
}
