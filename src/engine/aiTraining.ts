import type { ActionType, AiDifficulty, GameAction, GameState, PlayerId, TimePeriod } from '../types/game';

export interface TrainingAgentSnapshot {
  id: string;
  owner: PlayerId;
  originPeriod: TimePeriod;
  currentPeriod: TimePeriod;
  cityId: string;
  cityName: string;
  nodeId: string | null;
  cover: boolean;
  actionsRemaining: number;
  isPastAgent: boolean;
  lastKnownCityId?: string | null;
  possibleCityIds?: string[];
}

export interface TrainingCitySnapshot {
  id: string;
  period: TimePeriod;
  isNode: boolean;
  nodeId: string | null;
  controlledBy: PlayerId | null;
  destroyed: boolean;
  connections: string[];
  hasReward: boolean;
}

export interface TrainingStateSnapshot {
  round: number;
  currentTurn: PlayerId;
  playerIntel: { PAST: number; PRESENT: number; FUTURE: number };
  opponentIntel: { PAST: number; PRESENT: number; FUTURE: number };
  playerAgents: TrainingAgentSnapshot[];
  opponentAgents: TrainingAgentSnapshot[];
  controlledCityCounts: Record<PlayerId, number>;
  destroyedCityCount: number;
  rewardsInPlay: number;
  mapCities?: TrainingCitySnapshot[];
  revealedOpponentAgentIds?: string[];
}

export interface TrainingExample {
  step: number;
  actingPlayer: PlayerId;
  round: number;
  actionType: ActionType;
  agentId: string;
  targetCityId?: string;
  targetPeriod?: TimePeriod;
  state: TrainingStateSnapshot;
  reward: number;
}

export interface PersistedTrainingMatch {
  id: string;
  mode: 'vs_ai' | 'local_2p' | 'online_2p';
  aiDifficulty: AiDifficulty | null;
  createdAt: string;
  completedAt: string;
  rounds: number;
  winner: PlayerId | null;
  tainted: boolean;
  taintReasons: string[];
  examples: TrainingExample[];
}

export interface ActiveTrainingMatch {
  id: string;
  mode: 'vs_ai' | 'local_2p' | 'online_2p';
  aiDifficulty: AiDifficulty | null;
  createdAt: string;
  tainted: boolean;
  taintReasons: string[];
  examples: TrainingExample[];
}

export interface TrainingDatasetSummary {
  matchCount: number;
  cleanMatchCount: number;
  taintedMatchCount: number;
  exampleCount: number;
  cleanExampleCount: number;
  lastCompletedAt: string | null;
}

export interface TrainingSaveResult {
  ok: boolean;
  error?: string;
}

export interface TrainingStorageStatus {
  matchCount: number;
  datasetBytes: number;
  quotaBytes: number | null;
  usageBytes: number | null;
  usageRatio: number | null;
  nearCapacity: boolean;
}

const STORAGE_KEY = 'chronodox.ai.training.v1';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function cloneIntel(intel: { PAST: number; PRESENT: number; FUTURE: number }) {
  return { PAST: intel.PAST, PRESENT: intel.PRESENT, FUTURE: intel.FUTURE };
}

function encodeAgentSnapshot(state: GameState, agentId: string): TrainingAgentSnapshot | null {
  const agent = [...state.players.P1.agents, ...state.players.P2.agents].find(item => item.id === agentId);
  if (!agent) return null;
  const city = state.map.cities.get(agent.cityId);
  if (!city) return null;

  return {
    id: agent.id,
    owner: agent.owner,
    originPeriod: agent.period,
    currentPeriod: agent.currentPeriod,
    cityId: agent.cityId,
    cityName: city.name,
    nodeId: city.nodeId ?? null,
    cover: agent.cover,
    actionsRemaining: agent.actionsRemaining,
    isPastAgent: agent.isPastAgent,
    lastKnownCityId: agent.lastKnownCityId,
    possibleCityIds: [...agent.possibleCityIds],
  };
}

function encodeStateForPlayer(state: GameState, actingPlayer: PlayerId): TrainingStateSnapshot {
  const opponent = actingPlayer === 'P1' ? 'P2' : 'P1';
  const controlledCityCounts: Record<PlayerId, number> = {
    P1: [...state.map.cities.values()].filter(city => city.controlledBy === 'P1').length,
    P2: [...state.map.cities.values()].filter(city => city.controlledBy === 'P2').length,
  };

  return {
    round: state.round,
    currentTurn: state.currentTurn,
    playerIntel: cloneIntel(state.players[actingPlayer].intel),
    opponentIntel: cloneIntel(state.players[opponent].intel),
    playerAgents: state.players[actingPlayer].agents
      .map(agent => encodeAgentSnapshot(state, agent.id))
      .filter((snapshot): snapshot is TrainingAgentSnapshot => Boolean(snapshot)),
    opponentAgents: state.players[opponent].agents
      .map(agent => encodeAgentSnapshot(state, agent.id))
      .filter((snapshot): snapshot is TrainingAgentSnapshot => Boolean(snapshot)),
    controlledCityCounts,
    destroyedCityCount: [...state.map.cities.values()].filter(city => city.destroyed).length,
    rewardsInPlay: state.rewards.length,
    mapCities: [...state.map.cities.values()].map(city => ({
      id: city.id,
      period: city.period,
      isNode: city.isNode,
      nodeId: city.nodeId ?? null,
      controlledBy: city.controlledBy,
      destroyed: city.destroyed,
      connections: state.map.routes
        .filter(route => !route.destroyed && (route.from === city.id || route.to === city.id))
        .map(route => route.from === city.id ? route.to : route.from),
      hasReward: state.rewards.some(reward => reward.cityId === city.id),
    })),
    revealedOpponentAgentIds: [...state.vision[actingPlayer].revealedAgentIds]
      .filter(agentId => state.players[opponent].agents.some(agent => agent.id === agentId)),
  };
}

function loadStoredMatches(): PersistedTrainingMatch[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredMatches(matches: PersistedTrainingMatch[]): TrainingSaveResult {
  if (!canUseStorage()) {
    return { ok: false, error: 'Browser storage is unavailable.' };
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown storage error';
    return { ok: false, error: message };
  }
}

function estimateDatasetBytes(matches: PersistedTrainingMatch[]) {
  return new Blob([JSON.stringify(matches)]).size;
}

export function startTrainingMatch(
  mode: 'vs_ai' | 'local_2p' | 'online_2p',
  aiDifficulty: AiDifficulty | null = null,
): ActiveTrainingMatch {
  return {
    id: `training_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    mode,
    aiDifficulty,
    createdAt: new Date().toISOString(),
    tainted: false,
    taintReasons: [],
    examples: [],
  };
}

export function markTrainingSessionTainted(
  session: ActiveTrainingMatch | null,
  reason: string,
): ActiveTrainingMatch | null {
  if (!session) return null;
  if (session.taintReasons.includes(reason)) return session;
  return {
    ...session,
    tainted: true,
    taintReasons: [...session.taintReasons, reason],
  };
}

export function recordTrainingExample(
  session: ActiveTrainingMatch | null,
  state: GameState,
  action: GameAction,
): ActiveTrainingMatch | null {
  if (!session) return null;
  const nextExample: TrainingExample = {
    step: session.examples.length + 1,
    actingPlayer: action.owner,
    round: state.round,
    actionType: action.type,
    agentId: action.agentId,
    targetCityId: action.targetCityId,
    targetPeriod: action.targetPeriod,
    state: encodeStateForPlayer(state, action.owner),
    reward: 0,
  };

  return {
    ...session,
    examples: [...session.examples, nextExample],
  };
}

export function buildCompletedTrainingMatch(
  session: ActiveTrainingMatch | null,
  finalState: GameState,
): PersistedTrainingMatch | null {
  if (!session) return null;
  if (session.examples.length === 0) return null;
  const examples = session.examples.map(example => ({
    ...example,
    reward:
      finalState.winner === null
        ? 0
        : finalState.winner === example.actingPlayer
          ? 1
          : -1,
  }));

  const completed: PersistedTrainingMatch = {
    id: session.id,
    mode: session.mode,
    aiDifficulty: session.aiDifficulty,
    createdAt: session.createdAt,
    completedAt: new Date().toISOString(),
    rounds: finalState.round,
    winner: finalState.winner,
    tainted: session.tainted,
    taintReasons: [...session.taintReasons],
    examples,
  };

  return completed;
}

export function appendTrainingMatches(matches: PersistedTrainingMatch[]): TrainingSaveResult {
  if (matches.length === 0) return { ok: true };
  return saveStoredMatches([...loadStoredMatches(), ...matches]);
}

export function finalizeTrainingMatch(
  session: ActiveTrainingMatch | null,
  finalState: GameState,
): { completed: PersistedTrainingMatch | null; saveResult: TrainingSaveResult } {
  const completed = buildCompletedTrainingMatch(session, finalState);
  if (!completed) return { completed: null, saveResult: { ok: true } };
  const saveResult = appendTrainingMatches([completed]);
  return { completed, saveResult };
}

export function getTrainingDatasetSummary(): TrainingDatasetSummary {
  const matches = loadStoredMatches();
  const cleanMatches = matches.filter(match => !match.tainted);
  return {
    matchCount: matches.length,
    cleanMatchCount: cleanMatches.length,
    taintedMatchCount: matches.length - cleanMatches.length,
    exampleCount: matches.reduce((sum, match) => sum + match.examples.length, 0),
    cleanExampleCount: cleanMatches.reduce((sum, match) => sum + match.examples.length, 0),
    lastCompletedAt: matches.length > 0 ? matches[matches.length - 1].completedAt : null,
  };
}

export async function getTrainingStorageStatus(): Promise<TrainingStorageStatus> {
  const matches = loadStoredMatches();
  const datasetBytes = estimateDatasetBytes(matches);
  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;

  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null;
      usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null;
    } catch {
      quotaBytes = null;
      usageBytes = null;
    }
  }

  const usageRatio = quotaBytes && usageBytes ? usageBytes / quotaBytes : null;
  const remainingBytes = quotaBytes && usageBytes ? quotaBytes - usageBytes : null;
  const nearCapacity = Boolean(
    (usageRatio !== null && usageRatio >= 0.85)
    || (remainingBytes !== null && remainingBytes <= Math.max(datasetBytes, 512_000))
  );

  return {
    matchCount: matches.length,
    datasetBytes,
    quotaBytes,
    usageBytes,
    usageRatio,
    nearCapacity,
  };
}

export function clearTrainingDataset(): TrainingSaveResult {
  return saveStoredMatches([]);
}

export function exportTrainingDataset(): string {
  return JSON.stringify(loadStoredMatches(), null, 2);
}

export function exportCleanTrainingDataset(): string {
  return JSON.stringify(loadStoredMatches().filter(match => !match.tainted), null, 2);
}

export function downloadTrainingDataset(filename = `chronodox-training-${Date.now()}.json`) {
  if (typeof document === 'undefined') return false;
  const payload = exportTrainingDataset();
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

export function downloadCleanTrainingDataset(filename = `chronodox-training-clean-${Date.now()}.json`) {
  if (typeof document === 'undefined') return false;
  const payload = exportCleanTrainingDataset();
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
