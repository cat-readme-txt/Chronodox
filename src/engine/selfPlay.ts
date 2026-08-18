import type { AiDifficulty, GameAction, GameState, MatchConfig, PlayerId } from '../types/game';
import { DEFAULT_AI_DIFFICULTY, DEFAULT_TURN_TIMER_SECONDS } from '../types/game';
import {
  applyTurnBoundaryVision,
  collectRewards,
  endRoundCleanup,
  generateAIActions,
  resolveSingleAction,
  spawnRewards,
} from './actionResolver';
import { normalizeAiDifficulty } from './aiDifficulty';
import { buildCompletedTrainingMatch, recordTrainingExample, startTrainingMatch, type PersistedTrainingMatch } from './aiTraining';
import { createInitialState } from './gameFactory';
import { generateIntel } from './intelSystem';

export interface SelfPlaySummary {
  matches: number;
  p1Wins: number;
  p2Wins: number;
  draws: number;
  averageRounds: number;
  aiDifficulty: AiDifficulty;
}

export interface SelfPlayBatchResult {
  summary: SelfPlaySummary;
  matches: PersistedTrainingMatch[];
}

export interface SelfPlayProgressSnapshot extends SelfPlaySummary {
  completed: number;
  total: number;
  elapsedMs: number;
  etaMs: number | null;
}

export interface RunSelfPlayBatchOptions {
  count?: number;
  maxRounds?: number;
  aiDifficulty?: AiDifficulty;
  onMatchComplete?: (progress: SelfPlayProgressSnapshot) => void;
}

let _selfPlayActionCounter = 0;

function makeActionId() {
  return `selfplay_action_${++_selfPlayActionCounter}`;
}

function playerHasActionsLeft(state: GameState, pid: PlayerId): boolean {
  return state.players[pid].agents.some(a => a.actionsRemaining > 0);
}

function advanceRound(state: GameState): GameState {
  let s = endRoundCleanup(state);
  s = collectRewards(s);
  s = generateIntel(s);
  s = spawnRewards(s);

  return {
    ...s,
    round: s.round + 1,
    phase: s.winner ? 'GAME_OVER' : 'ACTION_ASSIGN',
    players: {
      P1: {
        ...s.players.P1,
        agents: s.players.P1.agents.map(a => ({
          ...a,
          actionsRemaining: 3 + s.players.P1.extraActionsNextRound,
        })),
        extraActionsNextRound: 0,
      },
      P2: {
        ...s.players.P2,
        agents: s.players.P2.agents.map(a => ({
          ...a,
          actionsRemaining: 3 + s.players.P2.extraActionsNextRound,
        })),
        extraActionsNextRound: 0,
      },
    },
  };
}

function buildSelfPlayMatchConfig(aiDifficulty: AiDifficulty): MatchConfig {
  return {
    turnTimerEnabled: false,
    turnTimerSeconds: DEFAULT_TURN_TIMER_SECONDS,
    aiDifficulty,
  };
}

function resolveHeadlessAiAction(state: GameState, player: PlayerId, aiDifficulty: AiDifficulty) {
  const resolvedCandidate = generateAIActions(state, player, aiDifficulty)
    .filter(action => {
      const agent = state.players[player].agents.find(item => item.id === action.agentId);
      return Boolean(agent && agent.actionsRemaining > 0);
    })
    .map(action => ({ action, nextState: resolveSingleAction(state, action) }))
    .find(result => result.nextState !== state);

  if (resolvedCandidate) return resolvedCandidate;

  const fallbackAgent = state.players[player].agents.find(agent => agent.actionsRemaining > 0);
  if (!fallbackAgent) return null;
  const fallbackAction: GameAction = {
    id: makeActionId(),
    type: 'WAIT',
    owner: player,
    agentId: fallbackAgent.id,
  };
  const nextState = resolveSingleAction(state, fallbackAction);
  return nextState !== state ? { action: fallbackAction, nextState } : null;
}

export function runSelfPlayBatch(options?: RunSelfPlayBatchOptions): SelfPlayBatchResult {
  const count = Math.max(1, Math.floor(options?.count ?? 10));
  const maxRounds = Math.max(1, Math.floor(options?.maxRounds ?? 40));
  const aiDifficulty = normalizeAiDifficulty(options?.aiDifficulty ?? DEFAULT_AI_DIFFICULTY);
  let p1Wins = 0;
  let p2Wins = 0;
  let draws = 0;
  let totalRounds = 0;
  const matches: PersistedTrainingMatch[] = [];
  const startedAt = Date.now();

  for (let matchIndex = 0; matchIndex < count; matchIndex += 1) {
    let state = createInitialState(buildSelfPlayMatchConfig(aiDifficulty));
    let session: ReturnType<typeof startTrainingMatch> | null = startTrainingMatch('vs_ai', aiDifficulty);
    let safetyTurns = 0;

    while (!state.winner && state.round <= maxRounds && safetyTurns < maxRounds * 2) {
      const actor = state.currentTurn;
      let localSteps = 0;

      while (!state.winner && playerHasActionsLeft(state, actor) && localSteps < 24) {
        const resolved = resolveHeadlessAiAction(state, actor, aiDifficulty);
        if (!resolved) break;
        session = recordTrainingExample(session, state, resolved.action);
        state = resolved.nextState;
        localSteps += 1;
      }

      if (state.winner) break;

      if (actor === 'P1') {
        state = { ...applyTurnBoundaryVision(state), currentTurn: 'P2' };
      } else {
        state = { ...applyTurnBoundaryVision(advanceRound(state)), currentTurn: 'P1' };
      }
      safetyTurns += 1;
    }

    const completedMatch = buildCompletedTrainingMatch(session, state);
    if (completedMatch) matches.push(completedMatch);
    totalRounds += state.round;
    if (state.winner === 'P1') p1Wins += 1;
    else if (state.winner === 'P2') p2Wins += 1;
    else draws += 1;

    if (options?.onMatchComplete) {
      const completed = matchIndex + 1;
      const elapsedMs = Date.now() - startedAt;
      const avgMsPerMatch = elapsedMs / completed;
      options.onMatchComplete({
        matches: completed,
        p1Wins,
        p2Wins,
        draws,
        averageRounds: Number((totalRounds / completed).toFixed(2)),
        aiDifficulty,
        completed,
        total: count,
        elapsedMs,
        etaMs: completed < count ? Math.max(0, Math.round(avgMsPerMatch * (count - completed))) : 0,
      });
    }
  }

  return {
    summary: {
      matches: count,
      p1Wins,
      p2Wins,
      draws,
      averageRounds: Number((totalRounds / count).toFixed(2)),
      aiDifficulty,
    },
    matches,
  };
}
