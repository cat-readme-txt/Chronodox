import {
  DEFAULT_AI_DIFFICULTY,
  DEFAULT_TURN_TIMER_SECONDS,
  type Agent,
  type GameState,
  type MatchConfig,
  type PlayerId,
  type TimePeriod,
} from '../types/game';
import { generateMap } from './mapGenerator';

const DEFAULT_MATCH_CONFIG: MatchConfig = {
  turnTimerEnabled: false,
  turnTimerSeconds: DEFAULT_TURN_TIMER_SECONDS,
  aiDifficulty: DEFAULT_AI_DIFFICULTY,
};

export function makeInitialAgent(
  id: string,
  owner: PlayerId,
  period: TimePeriod,
  cityId: string,
  isPastAgent: boolean,
  round: number,
): Agent {
  return {
    id,
    owner,
    period,
    cityId,
    currentPeriod: period,
    isPastAgent,
    cover: false,
    lastKnownCityId: cityId,
    possibleCityIds: [cityId],
    actionsRemaining: 3,
    deepCoverActive: false,
    forcedExposurePeriod: null,
    createdAt: round,
  };
}

export function createInitialState(matchConfig: MatchConfig = DEFAULT_MATCH_CONFIG): GameState {
  const map = generateMap();
  const cities = [...map.cities.values()];
  const nonNodeCities = (period: TimePeriod) => cities.filter(c => c.period === period && !c.isNode);

  const pickLeftmost = (period: TimePeriod) =>
    [...nonNodeCities(period)].sort((a, b) => a.x - b.x || a.y - b.y)[0]!;

  const pickRightmost = (period: TimePeriod) =>
    [...nonNodeCities(period)].sort((a, b) => b.x - a.x || a.y - b.y)[0]!;

  const p1Cities = {
    PAST: pickLeftmost('PAST'),
    PRESENT: pickLeftmost('PRESENT'),
    FUTURE: pickLeftmost('FUTURE'),
  };
  const p2Cities = {
    PAST: pickRightmost('PAST'),
    PRESENT: pickRightmost('PRESENT'),
    FUTURE: pickRightmost('FUTURE'),
  };

  return {
    map,
    players: {
      P1: {
        id: 'P1',
        agents: [
          makeInitialAgent('p1_past', 'P1', 'PAST', p1Cities.PAST.id, true, 0),
          makeInitialAgent('p1_present', 'P1', 'PRESENT', p1Cities.PRESENT.id, false, 0),
          makeInitialAgent('p1_future', 'P1', 'FUTURE', p1Cities.FUTURE.id, false, 0),
        ],
        intel: { PAST: 10, PRESENT: 10, FUTURE: 10 },
        encryptionActive: false,
        strikeReportActive: false,
        rapidReconActive: false,
        multiTimelineStrikeActive: false,
        deepCoverKnownToOpponent: false,
        extraActionsNextRound: 0,
        pendingActions: [],
      },
      P2: {
        id: 'P2',
        agents: [
          makeInitialAgent('p2_past', 'P2', 'PAST', p2Cities.PAST.id, true, 0),
          makeInitialAgent('p2_present', 'P2', 'PRESENT', p2Cities.PRESENT.id, false, 0),
          makeInitialAgent('p2_future', 'P2', 'FUTURE', p2Cities.FUTURE.id, false, 0),
        ],
        intel: { PAST: 10, PRESENT: 10, FUTURE: 10 },
        encryptionActive: false,
        strikeReportActive: false,
        rapidReconActive: false,
        multiTimelineStrikeActive: false,
        deepCoverKnownToOpponent: false,
        extraActionsNextRound: 0,
        pendingActions: [],
      },
    },
    matchConfig: { ...matchConfig },
    round: 1,
    phase: 'ACTION_ASSIGN',
    currentTurn: 'P1',
    turnDeadlineAt: null,
    notifications: [],
    rewards: [],
    winner: null,
    winnerReason: null,
    vision: {
      P1: { revealedAgentIds: new Set(), possiblePositions: new Map() },
      P2: { revealedAgentIds: new Set(), possiblePositions: new Map() },
    },
    timelineOccupations: {
      PAST: { owner: null, pending: false, bonusActive: false, disabledByForeignControl: false },
      PRESENT: { owner: null, pending: false, bonusActive: false, disabledByForeignControl: false },
      FUTURE: { owner: null, pending: false, bonusActive: false, disabledByForeignControl: false },
    },
    log: ['Game started'],
  };
}
