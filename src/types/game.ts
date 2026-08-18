// ============================================================
// CHRONODOX — Core Types
// ============================================================

export type TimePeriod = 'PAST' | 'PRESENT' | 'FUTURE';
export type PlayerId = 'P1' | 'P2';
export type GameMode = 'vs_ai' | 'local_2p' | 'online_2p';
export type GamePhase = 'SETUP' | 'INTEL_GEN' | 'ACTION_ASSIGN' | 'RESOLVING' | 'NOTIFICATIONS' | 'REWARD_SPAWN' | 'GAME_OVER';
export type AiDifficulty = 'easy' | 'normal' | 'hard';
export interface MatchConfig {
  turnTimerEnabled: boolean;
  turnTimerSeconds: number;
  aiDifficulty: AiDifficulty;
}

// ─── MAP STRUCTURES ──────────────────────────────────────────

export interface City {
  id: string;
  name: string;
  x: number;       // canvas x position (0-1 normalized)
  y: number;       // canvas y position (0-1 normalized)
  period: TimePeriod;
  isNode: boolean;
  nodeId?: string; // shared across timelines if isNode
  destroyed: boolean;
  controlledBy: PlayerId | null;
}

export interface Route {
  id: string;
  from: string;    // City id
  to: string;      // City id
  period: TimePeriod;
  destroyed: boolean;
}

// ─── AGENTS ─────────────────────────────────────────────────

export interface Agent {
  id: string;
  owner: PlayerId;
  period: TimePeriod; // origin timeline identity
  currentPeriod: TimePeriod; // current location timeline
  cityId: string;
  isPastAgent: boolean;   // The root agent — must be protected
  cover: boolean;          // true = hidden
  lastKnownCityId: string | null;
  possibleCityIds: string[]; // cities opponent thinks agent could be at
  actionsRemaining: number;
  deepCoverActive: boolean;
  forcedExposurePeriod: TimePeriod | null;
  createdAt: number; // round number — for TEMPORAL STABILITY RULE
}

// ─── INTEL ──────────────────────────────────────────────────

export interface IntelState {
  [key: string]: number; // PlayerId_TimePeriod => intel amount
}

// ─── ACTIONS ────────────────────────────────────────────────

export type ActionType =
  | 'MOVE'
  | 'WAIT'
  | 'CONTROL'
  | 'STRIKE'
  | 'TRAVERSE'
  | 'LOCATE'
  | 'STRIKE_REPORT'
  | 'DEEP_COVER'
  | 'PREPARE_ACTION'
  | 'ENCRYPTION'
  | 'RAPID_RECON'
  | 'MULTI_TIMELINE_STRIKE';

export interface GameAction {
  id: string;
  type: ActionType;
  agentId: string;
  owner: PlayerId;
  targetCityId?: string;
  targetPeriod?: TimePeriod;
}

// ─── REWARDS ────────────────────────────────────────────────

export type RewardType = 'INTEL_CACHE' | 'EXTRA_ACTION';

export interface Reward {
  id: string;
  cityId: string;
  type: RewardType;
  amount: number;    // for INTEL_CACHE (10, 20, 30)
  uncollectedRounds: number;
}

// ─── NOTIFICATIONS ──────────────────────────────────────────

export type NotificationType =
  | 'TRAVERSAL_DETECTED'
  | 'STRIKE_OCCURRED'
  | 'PARADOX_OCCURRED'
  | 'AGENT_ELIMINATED'
  | 'CAUSAL_COLLAPSE'
  | 'CITY_CONTROLLED'
  | 'REWARD_COLLECTED'
  | 'INTEL_OPERATION'
  | 'TIMELINE_OCCUPIED';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  round: number;
  forPlayer: PlayerId | 'BOTH';
  nodeId?: string;    // for traversal
  period?: TimePeriod;
}

// ─── VISION ─────────────────────────────────────────────────

export interface VisionData {
  revealedAgentIds: Set<string>;  // agents whose exact position is known
  possiblePositions: Map<string, string[]>; // agentId -> possible cityIds
}

// ─── FULL GAME STATE ────────────────────────────────────────

export interface MapState {
  cities: Map<string, City>;
  routes: Route[];
  nodes: Map<string, string[]>; // nodeId -> cityIds across periods
}

export interface TimelineOccupation {
  owner: PlayerId | null;
  pending: boolean;
  bonusActive: boolean;
  disabledByForeignControl: boolean;
}

export interface PlayerState {
  id: PlayerId;
  agents: Agent[];
  intel: { PAST: number; PRESENT: number; FUTURE: number };
  encryptionActive: boolean;
  strikeReportActive: boolean;
  rapidReconActive: boolean;
  multiTimelineStrikeActive: boolean;
  deepCoverKnownToOpponent: boolean;
  extraActionsNextRound: number;
  pendingActions: GameAction[];  // actions queued this round
}

export interface GameState {
  map: MapState;
  players: { P1: PlayerState; P2: PlayerState };
  matchConfig: MatchConfig;
  round: number;
  phase: GamePhase;
  currentTurn: PlayerId;  // for action assignment
  turnDeadlineAt: number | null;
  notifications: Notification[];
  rewards: Reward[];
  winner: PlayerId | null;
  winnerReason: string | null;
  vision: { P1: VisionData; P2: VisionData };
  timelineOccupations: Record<TimePeriod, TimelineOccupation>;
  log: string[];  // debug / history
}

// ─── CONSTANTS ───────────────────────────────────────────────

export const INTEL_COSTS = {
  TRAVERSE: 20,
  ENCRYPTION: 25,
  RAPID_RECON: 40,
  LOCATE: 10,
  STRIKE_REPORT: 10,
  DEEP_COVER: 20,
  PREPARE_ACTION: 40,
  MULTI_TIMELINE_STRIKE: 15,
} as const;

export const MAX_AGENTS_PER_PERIOD = 3;
export const BASE_INTEL_PER_ROUND = 2;
export const CONTROLLED_CITY_INTEL = 2;
export const TIMELINE_OCCUPATION_INTEL_BONUS = 20;
export const TIMELINE_OCCUPATION_ACTION_BONUS = 1;
export const DEFAULT_TURN_TIMER_SECONDS = 60;
export const MIN_TURN_TIMER_SECONDS = 15;
export const MAX_TURN_TIMER_SECONDS = 600;
export const DEFAULT_AI_DIFFICULTY: AiDifficulty = 'normal';
export const AI_DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  easy: 'EASY',
  normal: 'NORMAL',
  hard: 'HARD',
};

export const TIME_ORDER: TimePeriod[] = ['PAST', 'PRESENT', 'FUTURE'];
