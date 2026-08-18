// ============================================================
// CHRONODOX — Zustand Game Store (Real-Time Mode)
// ============================================================

import { create } from 'zustand';
import type {
  AiDifficulty, GameState, GameAction, PlayerId, TimePeriod, Agent, ActionType, GameMode, MatchConfig,
} from '../types/game';
import { DEFAULT_AI_DIFFICULTY, DEFAULT_TURN_TIMER_SECONDS, MAX_TURN_TIMER_SECONDS, MIN_TURN_TIMER_SECONDS } from '../types/game';
import { getConnectedCities, getNodeCitiesForPeriod } from '../engine/mapGenerator';
import { addIntel, generateIntel } from '../engine/intelSystem';
import {
  resolveSingleAction, endRoundCleanup, applyTurnBoundaryVision,
  spawnRewards, collectRewards, generateAIActions,
} from '../engine/actionResolver';
import type { ResolveActionOptions } from '../engine/actionResolver';
import { applyOccupationRewards, applyOccupationTrackingAfterTurn } from '../engine/timelineOccupation';
import type { SoundEffectId, MusicTrackId } from '../config/audio';
import { DEFAULT_MUSIC_TRACK_ID } from '../config/audio';
import {
  buildTerminalSuggestions, findCityByName, formatAgentRoster, formatMapListing, getHelpLines, getManualLines, getSelectedAgent, parseTerminalCommand,
} from '../engine/terminal';
import {
  appendTrainingMatches,
  clearTrainingDataset,
  downloadCleanTrainingDataset,
  downloadTrainingDataset,
  finalizeTrainingMatch,
  getTrainingDatasetSummary,
  getTrainingStorageStatus,
  markTrainingSessionTainted,
  recordTrainingExample,
  startTrainingMatch,
} from '../engine/aiTraining';
import { createInitialState } from '../engine/gameFactory';
import { getAiDifficultyLabel, normalizeAiDifficulty } from '../engine/aiDifficulty';
import { runSelfPlayBatch } from '../engine/selfPlay';
import { GUIDED_TUTORIAL_STEPS } from '../tutorial/guidedTutorial';
import {
  getTutorialActionEvent as mapTutorialActionEvent,
  getTutorialEventForTerminalInput,
  TUTORIAL_EVENT_DESCRIPTIONS,
  type TutorialEvent,
} from '../tutorial/tutorialEvents';
import type { OnlineTransport } from '../network/onlineClient';

export interface TerminalEntry {
  id: string;
  kind: 'input' | 'output' | 'system' | 'error';
  text: string;
  round: number;
}

interface PlayerShellSession {
  terminalHistory: TerminalEntry[];
  sudoAuthenticated: boolean;
  suMode: boolean;
  terminalAwaitingPassword: boolean;
  pendingPrivilegedInput: string | null;
  pendingPassConfirmation: boolean;
}

interface PendingTraversalAction {
  type: Extract<ActionType, 'TRAVERSE'>;
  agentId: string;
  owner: PlayerId;
}

interface TraversalEffect {
  id: string;
  sourcePeriod: TimePeriod;
  targetPeriod: TimePeriod;
}

interface BattleEffect {
  id: string;
  kind: 'strike' | 'death' | 'paradox';
  owner: PlayerId | null;
  period: TimePeriod;
  cityId: string;
  createdAt: number;
}

interface TurnUndoSnapshot {
  game: GameState;
  selectedAgentId: string | null;
  selectedPeriod: TimePeriod;
  inspectedCityId: string | null;
}

export interface ActionEffectCue {
  token: number;
  kind:
    | 'paradox'
    | 'strike-hit'
    | 'strike-miss'
    | 'multi-strike-hit'
    | 'multi-strike-miss'
    | 'rapid-recon'
    | 'strike-report'
    | 'deep-cover'
    | 'prepare-action'
    | 'encryption';
  owner: PlayerId;
  period: TimePeriod | null;
}

interface TutorialSessionSnapshot {
  game: GameState;
  localPlayer: PlayerId;
  selectedAgentId: string | null;
  selectedPeriod: TimePeriod;
  gameMode: GameMode;
  aiTurnInProgress: boolean;
  aiActivePeriod: TimePeriod | null;
  traversalEffects: TraversalEffect[];
  battleEffects: BattleEffect[];
  intelFeedOpen: boolean;
  collapsingPeriods: TimePeriod[];
  pendingTraversalAction: PendingTraversalAction | null;
  lastActionFeedback: string | null;
  settingsOpen: boolean;
  terminalMode: boolean;
  terminalHistory: TerminalEntry[];
  playerShellSessions: Record<PlayerId, PlayerShellSession>;
  sudoPassword: string;
  sudoAuthenticated: boolean;
  suMode: boolean;
  terminalAwaitingPassword: boolean;
  pendingPrivilegedInput: string | null;
  pendingPassConfirmation: boolean;
  awaitingNextRound: boolean;
  autoNextDeadline: number | null;
  inspectedCityId: string | null;
  turnUndoStack: TurnUndoSnapshot[];
  matchConfig: MatchConfig;
  localTurnHandoffPlayer: PlayerId | null;
  turnTimeoutNotice: string | null;
  debugLocalSwitchEnabled: boolean;
}

interface ChronodoxStore {
  game: GameState;
  localPlayer: PlayerId;
  selectedAgentId: string | null;
  selectedPeriod: TimePeriod;
  remoteSelectedAgentId: string | null;
  remoteSelectedPeriod: TimePeriod | null;
  gameMode: GameMode;
  onlineRoomCode: string | null;
  onlineTransport: OnlineTransport | null;
  onlineRevision: number;
  onlineOpponentConnected: boolean;
  onlineSyncError: string | null;
  aiTurnInProgress: boolean;
  aiActivePeriod: TimePeriod | null;
  traversalEffects: TraversalEffect[];
  battleEffects: BattleEffect[];
  intelFeedOpen: boolean;
  collapsingPeriods: TimePeriod[];
  pendingTraversalAction: PendingTraversalAction | null;
  lastActionFeedback: string | null;
  settingsOpen: boolean;
  guidedTutorialActive: boolean;
  tutorialOpen: boolean;
  tutorialSectionIndex: number;
  tutorialFocusIds: string[] | null;
  tutorialMarkedCityIds: string[];
  tutorialTraversalLockedPeriod: TimePeriod | null;
  tutorialPendingCompletionMode: 'restore' | 'menu' | null;
  tutorialMenuReturnToken: number;
  actionEffectCue: ActionEffectCue | null;
  trainingStorageNotice: string | null;
  brightness: number;
  homeMusicTrackId: MusicTrackId;
  gameMusicTrackId: MusicTrackId;
  musicVolume: number;
  sfxVolume: number;
  muteAllAudio: boolean;
  soundEffectCue: { id: SoundEffectId; token: number } | null;
  terminalMode: boolean;
  terminalHistory: TerminalEntry[];
  playerShellSessions: Record<PlayerId, PlayerShellSession>;
  sudoPassword: string;
  sudoAuthenticated: boolean;
  suMode: boolean;
  terminalAwaitingPassword: boolean;
  pendingPrivilegedInput: string | null;
  pendingPassConfirmation: boolean;
  awaitingNextRound: boolean;
  autoNextDeadline: number | null;
  inspectedCityId: string | null;
  turnUndoStack: TurnUndoSnapshot[];
  matchConfig: MatchConfig;
  localTurnHandoffPlayer: PlayerId | null;
  turnTimeoutNotice: string | null;
  debugLocalSwitchEnabled: boolean;

  initGame: (mode: GameMode, sudoPassword?: string, matchConfig?: MatchConfig) => void;
  loadOnlineGame: (game: GameState, options: {
    localPlayer: PlayerId;
    roomCode: string;
    transport: OnlineTransport;
    revision: number;
    opponentConnected: boolean;
    matchConfig: MatchConfig;
  }) => void;
  applyRemoteOnlineGame: (game: GameState, revision: number, opponentConnected: boolean) => void;
  applyRemoteOnlinePresence: (selectedAgentId: string | null, selectedPeriod: TimePeriod | null) => void;
  setOnlineSyncError: (message: string | null) => void;
  selectAgent: (agentId: string | null) => void;
  inspectCity: (cityId: string | null, period?: TimePeriod) => void;
  selectPeriod: (period: TimePeriod) => void;
  toggleIntelFeed: () => void;
  closeIntelFeed: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openTutorial: (sectionIndex?: number) => void;
  closeTutorial: () => void;
  setTutorialSection: (sectionIndex: number) => void;
  startGuidedTutorial: (options?: { restoreOnExit?: boolean }) => void;
  continueTutorialStep: () => void;
  completeTutorialPostGameOver: () => void;
  resolveGameOverChoice: (choice: 'menu' | 'restore' | 'new' | 'replay') => void;
  returnToMenu: () => void;
  setBrightness: (value: number) => void;
  setHomeMusicTrack: (trackId: MusicTrackId) => void;
  setGameMusicTrack: (trackId: MusicTrackId) => void;
  setMusicVolume: (value: number) => void;
  setSfxVolume: (value: number) => void;
  setMuteAllAudio: (muted: boolean) => void;
  setTerminalMode: (enabled: boolean) => void;
  playSoundEffect: (id: SoundEffectId) => void;
  acknowledgeLocalHandoff: () => void;
  dismissTurnTimeoutNotice: () => void;
  handleTurnTimerExpired: () => void;
  openTraversalPicker: (type: Extract<ActionType, 'TRAVERSE'>) => void;
  closeTraversalPicker: () => void;
  confirmTraversalTarget: (targetPeriod: TimePeriod) => void;
  executeActionNow: (action: Omit<GameAction, 'id'>, options?: ResolveActionOptions) => void;
  appendTerminalMessage: (text: string, kind?: TerminalEntry['kind']) => void;
  submitTerminalInput: (input: string) => void;
  advanceByNextCommand: (automatic?: boolean) => void;
  undoLastTurnAction: () => void;
  switchLocalPlayer: () => void;
}

let _actionCounter = 0;
let _terminalEntryCounter = 0;
let _soundCueCounter = 0;
let _traversalEffectCounter = 0;
let _actionEffectCounter = 0;
let _battleEffectCounter = 0;
const AI_ACTION_DELAY_MS = 800;
const COLLAPSE_ANIMATION_MS = 900;
const AUTO_NEXT_DELAY_MS = 3000;
const TRAVERSAL_ANIMATION_MS = 850;
const BATTLE_EFFECT_ANIMATION_MS = 750;
const MAX_SELFPLAY_MATCHES = 200;
const MAX_SELFPLAY_ROUNDS = 40;

function makeActionId() { return `action_${++_actionCounter}`; }
function makeTerminalEntry(text: string, kind: TerminalEntry['kind'], round: number): TerminalEntry {
  return { id: `term_${++_terminalEntryCounter}`, text, kind, round };
}
function createSessionPassword() {
  return 'root';
}
function trimTerminalHistory(history: TerminalEntry[]) {
  return history.slice(-240);
}

function cloneTerminalHistoryEntries(history: TerminalEntry[]) {
  return history.map(entry => ({ ...entry }));
}

function clonePlayerShellSession(session: PlayerShellSession): PlayerShellSession {
  return {
    terminalHistory: cloneTerminalHistoryEntries(session.terminalHistory),
    sudoAuthenticated: session.sudoAuthenticated,
    suMode: session.suMode,
    terminalAwaitingPassword: session.terminalAwaitingPassword,
    pendingPrivilegedInput: session.pendingPrivilegedInput,
    pendingPassConfirmation: session.pendingPassConfirmation,
  };
}

function clonePlayerShellSessions(sessions: Record<PlayerId, PlayerShellSession>) {
  return {
    P1: clonePlayerShellSession(sessions.P1),
    P2: clonePlayerShellSession(sessions.P2),
  };
}

function createTerminalBootstrapHistory(round: number, lines?: string[]) {
  const bootstrapLines = lines ?? ['Temporal shell initialized.', 'Type help for command syntax.'];
  return trimTerminalHistory(bootstrapLines.map(line => makeTerminalEntry(line, 'system', round)));
}

function createPlayerShellSession(round: number, lines?: string[]): PlayerShellSession {
  return {
    terminalHistory: createTerminalBootstrapHistory(round, lines),
    sudoAuthenticated: false,
    suMode: false,
    terminalAwaitingPassword: false,
    pendingPrivilegedInput: null,
    pendingPassConfirmation: false,
  };
}

function createPlayerShellSessions(
  round: number,
  initialLines?: Partial<Record<PlayerId, string[]>>,
): Record<PlayerId, PlayerShellSession> {
  return {
    P1: createPlayerShellSession(round, initialLines?.P1),
    P2: createPlayerShellSession(round, initialLines?.P2),
  };
}

function captureActiveShellSession(state: {
  terminalHistory: TerminalEntry[];
  sudoAuthenticated: boolean;
  suMode: boolean;
  terminalAwaitingPassword: boolean;
  pendingPrivilegedInput: string | null;
  pendingPassConfirmation: boolean;
}): PlayerShellSession {
  return {
    terminalHistory: cloneTerminalHistoryEntries(state.terminalHistory),
    sudoAuthenticated: state.sudoAuthenticated,
    suMode: state.suMode,
    terminalAwaitingPassword: state.terminalAwaitingPassword,
    pendingPrivilegedInput: state.pendingPrivilegedInput,
    pendingPassConfirmation: state.pendingPassConfirmation,
  };
}

function applyShellSession(session: PlayerShellSession) {
  return {
    terminalHistory: cloneTerminalHistoryEntries(session.terminalHistory),
    sudoAuthenticated: session.sudoAuthenticated,
    suMode: session.suMode,
    terminalAwaitingPassword: session.terminalAwaitingPassword,
    pendingPrivilegedInput: session.pendingPrivilegedInput,
    pendingPassConfirmation: session.pendingPassConfirmation,
  };
}

function cloneTurnUndoSnapshot(snapshot: TurnUndoSnapshot): TurnUndoSnapshot {
  return {
    game: cloneTutorialGameState(snapshot.game),
    selectedAgentId: snapshot.selectedAgentId,
    selectedPeriod: snapshot.selectedPeriod,
    inspectedCityId: snapshot.inspectedCityId,
  };
}

function cloneTurnUndoStack(stack: TurnUndoSnapshot[]) {
  return stack.map(cloneTurnUndoSnapshot);
}

function normalizeTurnTimerSeconds(value?: number | null) {
  if (!Number.isFinite(value)) return DEFAULT_TURN_TIMER_SECONDS;
  return Math.min(MAX_TURN_TIMER_SECONDS, Math.max(MIN_TURN_TIMER_SECONDS, Math.round(value as number)));
}

function normalizeMatchConfig(config?: Partial<MatchConfig>): MatchConfig {
  return {
    turnTimerEnabled: Boolean(config?.turnTimerEnabled),
    turnTimerSeconds: normalizeTurnTimerSeconds(config?.turnTimerSeconds),
    aiDifficulty: normalizeAiDifficulty(config?.aiDifficulty ?? DEFAULT_AI_DIFFICULTY),
  };
}

function getTurnDeadline(matchConfig: MatchConfig) {
  return matchConfig.turnTimerEnabled ? Date.now() + (matchConfig.turnTimerSeconds * 1000) : null;
}

function withTurnDeadline(game: GameState, matchConfig: MatchConfig): GameState {
  return {
    ...game,
    matchConfig: { ...matchConfig },
    turnDeadlineAt: getTurnDeadline(matchConfig),
  };
}

let _aiTurnTimer: ReturnType<typeof window.setTimeout> | null = null;
let _autoNextTimer: ReturnType<typeof window.setTimeout> | null = null;
const _collapseTimers = new Map<TimePeriod, number>();
const _traversalEffectTimers = new Map<string, number>();
const _battleEffectTimers = new Map<string, number>();
let _trainingSession: ReturnType<typeof startTrainingMatch> | null = startTrainingMatch('vs_ai', DEFAULT_AI_DIFFICULTY);
let _lastSelfPlaySummary: {
  matches: number;
  p1Wins: number;
  p2Wins: number;
  draws: number;
  averageRounds: number;
  aiDifficulty: AiDifficulty;
  saved: boolean;
  storageError: string | null;
} | null = null;
let _tutorialReturnSnapshot: TutorialSessionSnapshot | null = null;
let _tutorialRestoreOnExit = false;
const _tutorialDemoTimers = new Set<number>();
let _tutorialMenuReturnCounter = 0;
let _tutorialLastTraverseTargetPeriod: TimePeriod | null = null;
let _tutorialAiDemoPlan: ReturnType<typeof findBestAiTutorialNodePlan> = null;
let _tutorialSourceGameMode: GameMode = 'vs_ai';
let _tutorialIntroReturnIndex: number | null = null;

function stripPromptFromHistoryEntry(text: string) {
  const match = text.match(/^(?:password:|[^ ]+@chronodox(?:-[^:]+)?:~[#\$])\s+(.*)$/);
  return match ? match[1] : text;
}

function normalizeTerminalRepeatCandidate(text: string) {
  const normalized = text.trim().toLowerCase();
  return normalized !== '' && normalized !== 'repeat';
}

function getVisibleNotifications(state: GameState, localPlayer: PlayerId) {
  return state.notifications.filter(notification => notification.forPlayer === 'BOTH' || notification.forPlayer === localPlayer);
}

function clearAiTurnTimer() {
  if (_aiTurnTimer !== null) {
    window.clearTimeout(_aiTurnTimer);
    _aiTurnTimer = null;
  }
}

function clearAutoNextTimer() {
  if (_autoNextTimer !== null) {
    window.clearTimeout(_autoNextTimer);
    _autoNextTimer = null;
  }
}

function clearCollapseTimers() {
  for (const timeoutId of _collapseTimers.values()) {
    window.clearTimeout(timeoutId);
  }
  _collapseTimers.clear();
}

function clearTraversalEffectTimers() {
  for (const timeoutId of _traversalEffectTimers.values()) {
    window.clearTimeout(timeoutId);
  }
  _traversalEffectTimers.clear();
}

function clearBattleEffectTimers() {
  for (const timeoutId of _battleEffectTimers.values()) {
    window.clearTimeout(timeoutId);
  }
  _battleEffectTimers.clear();
}

function countAgentsInOriginPeriod(state: GameState, period: TimePeriod) {
  return [...state.players.P1.agents, ...state.players.P2.agents].filter(agent => agent.period === period).length;
}

function findNewCollapsedPeriods(previous: GameState, next: GameState): TimePeriod[] {
  return (['PAST', 'PRESENT', 'FUTURE'] as TimePeriod[]).filter(period =>
    countAgentsInOriginPeriod(previous, period) > 0 && countAgentsInOriginPeriod(next, period) === 0,
  );
}

function cloneTutorialGameState(state: GameState): GameState {
  return {
    ...state,
    map: {
      cities: new Map([...state.map.cities.entries()].map(([id, city]) => [id, { ...city }])),
      routes: state.map.routes.map(route => ({ ...route })),
      nodes: new Map([...state.map.nodes.entries()].map(([nodeId, cityIds]) => [nodeId, [...cityIds]])),
    },
    players: {
      P1: {
        ...state.players.P1,
        agents: state.players.P1.agents.map(agent => ({ ...agent, possibleCityIds: [...agent.possibleCityIds] })),
        intel: { ...state.players.P1.intel },
        deepCoverKnownToOpponent: state.players.P1.deepCoverKnownToOpponent,
        pendingActions: [...state.players.P1.pendingActions],
      },
      P2: {
        ...state.players.P2,
        agents: state.players.P2.agents.map(agent => ({ ...agent, possibleCityIds: [...agent.possibleCityIds] })),
        intel: { ...state.players.P2.intel },
        deepCoverKnownToOpponent: state.players.P2.deepCoverKnownToOpponent,
        pendingActions: [...state.players.P2.pendingActions],
      },
    },
    notifications: state.notifications.map(notification => ({ ...notification })),
    rewards: state.rewards.map(reward => ({ ...reward })),
    vision: {
      P1: {
        revealedAgentIds: new Set(state.vision.P1.revealedAgentIds),
        possiblePositions: new Map([...state.vision.P1.possiblePositions.entries()].map(([id, cityIds]) => [id, [...cityIds]])),
      },
      P2: {
        revealedAgentIds: new Set(state.vision.P2.revealedAgentIds),
        possiblePositions: new Map([...state.vision.P2.possiblePositions.entries()].map(([id, cityIds]) => [id, [...cityIds]])),
      },
    },
    log: [...state.log],
  };
}

function cloneTutorialSessionSnapshot(snapshot: TutorialSessionSnapshot): TutorialSessionSnapshot {
  return {
    ...snapshot,
    game: cloneTutorialGameState(snapshot.game),
    traversalEffects: snapshot.traversalEffects.map(effect => ({ ...effect })),
    battleEffects: snapshot.battleEffects.map(effect => ({ ...effect })),
    collapsingPeriods: [...snapshot.collapsingPeriods],
    pendingTraversalAction: snapshot.pendingTraversalAction ? { ...snapshot.pendingTraversalAction } : null,
    terminalHistory: cloneTerminalHistoryEntries(snapshot.terminalHistory),
    playerShellSessions: clonePlayerShellSessions(snapshot.playerShellSessions),
    turnUndoStack: cloneTurnUndoStack(snapshot.turnUndoStack),
  };
}

function normalizeTutorialVisibility(state: GameState): GameState {
  const normalizeAgentForViewer = (
    viewer: PlayerId,
    owner: PlayerId,
    agent: Agent,
  ) => {
    const city = state.map.cities.get(agent.cityId);
    const shouldBeRevealed = Boolean(
      city
      && city.controlledBy
      && city.controlledBy !== owner
      && !agent.deepCoverActive,
    );
    return {
      agent: {
        ...agent,
        cover: !shouldBeRevealed,
        lastKnownCityId: shouldBeRevealed ? agent.cityId : agent.lastKnownCityId,
      },
      shouldBeRevealedToViewer: viewer !== owner && shouldBeRevealed,
    };
  };

  const p1Agents = state.players.P1.agents.map(agent => normalizeAgentForViewer('P2', 'P1', agent).agent);
  const p2Agents = state.players.P2.agents.map(agent => normalizeAgentForViewer('P1', 'P2', agent).agent);

  const p1RevealedToP2 = new Set(
    p1Agents
      .filter(agent => {
        const city = state.map.cities.get(agent.cityId);
        return Boolean(city && city.controlledBy === 'P2' && !agent.deepCoverActive);
      })
      .map(agent => agent.id),
  );

  const p2RevealedToP1 = new Set(
    p2Agents
      .filter(agent => {
        const city = state.map.cities.get(agent.cityId);
        return Boolean(city && city.controlledBy === 'P1' && !agent.deepCoverActive);
      })
      .map(agent => agent.id),
  );

  return {
    ...state,
    players: {
      ...state.players,
      P1: { ...state.players.P1, agents: p1Agents },
      P2: { ...state.players.P2, agents: p2Agents },
    },
    vision: {
      P1: {
        ...state.vision.P1,
        revealedAgentIds: p2RevealedToP1,
      },
      P2: {
        ...state.vision.P2,
        revealedAgentIds: p1RevealedToP2,
      },
    },
  };
}

function clearTutorialDemoTimers() {
  for (const timeoutId of _tutorialDemoTimers.values()) {
    window.clearTimeout(timeoutId);
  }
  _tutorialDemoTimers.clear();
}

function findFirstAdjacentCity(state: GameState, cityId: string) {
  return getConnectedCities(state.map, cityId)
    .map(id => state.map.cities.get(id))
    .find((city): city is NonNullable<typeof city> => Boolean(city && !city.destroyed)) ?? null;
}

function findSharedNodeCity(state: GameState, period: TimePeriod) {
  return [...state.map.cities.values()].find(city =>
    city.period === period
    && city.isNode
    && !city.destroyed
    && city.nodeId
    && (state.map.nodes.get(city.nodeId)?.length ?? 0) > 1,
  ) ?? null;
}

function findFullSharedNodeCity(state: GameState, period: TimePeriod) {
  return [...state.map.cities.values()].find(city =>
    city.period === period
    && city.isNode
    && !city.destroyed
    && city.nodeId
    && (state.map.nodes.get(city.nodeId)?.length ?? 0) >= 3,
  ) ?? null;
}

function getTutorialSharedNodeOptions(state: GameState) {
  return [...state.map.cities.values()].filter(city =>
    city.isNode
    && !city.destroyed
    && city.nodeId
    && city.period !== 'PAST'
    && Boolean([...state.map.cities.values()].find(other => other.nodeId === city.nodeId && other.period === 'PAST' && !other.destroyed)),
  );
}

function findShortestPathInPeriod(state: GameState, startCityId: string, targetCityId: string): string[] | null {
  if (startCityId === targetCityId) return [startCityId];
  const queue: string[] = [startCityId];
  const previous = new Map<string, string | null>([[startCityId, null]]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of getConnectedCities(state.map, current)) {
      const city = state.map.cities.get(next);
      if (!city || city.destroyed) continue;
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === targetCityId) {
        const path = [next];
        let cursor: string | null = current;
        while (cursor) {
          path.unshift(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path;
      }
      queue.push(next);
    }
  }

  return null;
}

function findBestAiTutorialNodePlan(state: GameState) {
  const candidates = state.players.P2.agents.filter(agent =>
    agent.currentPeriod !== 'PAST'
    && !state.map.cities.get(agent.cityId)?.destroyed,
  );

  let best:
    | {
        agentId: string;
        sourcePeriod: TimePeriod;
        path: string[];
        targetNodeId: string;
        targetCityId: string;
        pastCityId: string;
      }
    | null = null;

  for (const agent of candidates) {
    for (const nodeCity of getTutorialSharedNodeOptions(state).filter(city => city.period === agent.currentPeriod)) {
      const path = findShortestPathInPeriod(state, agent.cityId, nodeCity.id);
      if (!path) continue;
      const pastCity = [...state.map.cities.values()].find(city =>
        city.nodeId === nodeCity.nodeId && city.period === 'PAST' && !city.destroyed,
      );
      if (!pastCity) continue;
      if (!best || path.length < best.path.length) {
        best = {
          agentId: agent.id,
          sourcePeriod: agent.currentPeriod,
          path,
          targetNodeId: nodeCity.nodeId!,
          targetCityId: nodeCity.id,
          pastCityId: pastCity.id,
        };
      }
    }
  }

  return best;
}

function getStoredTutorialAiDemoPlan(state: GameState) {
  if (!_tutorialAiDemoPlan) return null;
  const enemyAgent = state.players.P2.agents.find(agent => agent.id === _tutorialAiDemoPlan?.agentId);
  const targetCity = state.map.cities.get(_tutorialAiDemoPlan.targetCityId);
  const pastCity = state.map.cities.get(_tutorialAiDemoPlan.pastCityId);
  if (
    !enemyAgent
    || enemyAgent.cityId !== _tutorialAiDemoPlan.targetCityId
    || !targetCity
    || targetCity.destroyed
    || !pastCity
    || pastCity.destroyed
  ) {
    return null;
  }
  return _tutorialAiDemoPlan;
}

function resolveTutorialAiDemoPlan(state: GameState) {
  return getStoredTutorialAiDemoPlan(state) ?? findBestAiTutorialNodePlan(state);
}

function playerHasActionsLeft(state: GameState, pid: PlayerId): boolean {
  return state.players[pid].agents.some(a => a.actionsRemaining > 0);
}

function advanceRound(state: GameState, gameMode: GameMode): GameState {
  let s = endRoundCleanup(state);
  s = collectRewards(s);
  s = generateIntel(s);
  s = spawnRewards(s);

  s = {
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

  return s;
}

export const useGameStore = create<ChronodoxStore>((set, get) => {
  const appendTerminalLines = (lines: string[], kind: TerminalEntry['kind'] = 'output') => {
    if (lines.length === 0) return;
    set(state => ({
      terminalHistory: trimTerminalHistory([
        ...state.terminalHistory,
        ...lines.map(line => makeTerminalEntry(line, kind, state.game.round)),
      ]),
    }));
  };

  const swapLocalShellSession = (nextPlayer: PlayerId) => {
    set(state => {
      const playerShellSessions = clonePlayerShellSessions(state.playerShellSessions);
      playerShellSessions[state.localPlayer] = captureActiveShellSession(state);
      return {
        playerShellSessions,
        localPlayer: nextPlayer,
        ...applyShellSession(playerShellSessions[nextPlayer]),
      };
    });
  };

  const pushUndoSnapshot = (game: GameState) => {
    const state = get();
    const snapshot: TurnUndoSnapshot = {
      game: cloneTutorialGameState(game),
      selectedAgentId: state.selectedAgentId,
      selectedPeriod: state.selectedPeriod,
      inspectedCityId: state.inspectedCityId,
    };
    set(current => ({
      turnUndoStack: [...current.turnUndoStack, snapshot].slice(-24),
    }));
  };

  const clearUndoStack = () => {
    if (get().turnUndoStack.length === 0) return;
    set({ turnUndoStack: [] });
  };

  const recordTrainingAction = (state: GameState, action: GameAction) => {
    _trainingSession = recordTrainingExample(_trainingSession, state, action);
  };

  const taintTrainingSession = (reason: string) => {
    _trainingSession = markTrainingSessionTainted(_trainingSession, reason);
  };

  const finalizeTrainingSession = (state: GameState) => {
    if (!_trainingSession) return;
    const result = finalizeTrainingMatch(_trainingSession, state);
    _trainingSession = null;
    const warningPrefix = 'Training archive nearing browser storage limit.';
    if (result.saveResult.ok) {
      void getTrainingStorageStatus().then(status => {
        if (!status.nearCapacity) return;
        const ratio = status.usageRatio !== null ? `${Math.round(status.usageRatio * 100)}%` : 'high';
        set({
          trainingStorageNotice: `${warningPrefix} Usage ${ratio}. Run \`training export\` or \`training clear\` soon.`,
        });
      });
      return;
    }
    set({
      trainingStorageNotice: `Training archive could not be saved: ${result.saveResult.error ?? 'unknown storage error'}. Run \`training export\` or \`training clear\`.`,
    });
  };

  const runSelfPlayMatches = (requestedCount: number, requestedDifficulty?: AiDifficulty | null) => {
    const count = Math.max(1, Math.min(MAX_SELFPLAY_MATCHES, Math.floor(requestedCount) || 10));
    const aiDifficulty = normalizeAiDifficulty(requestedDifficulty ?? get().matchConfig.aiDifficulty);
    const { summary, matches } = runSelfPlayBatch({
      count,
      maxRounds: MAX_SELFPLAY_ROUNDS,
      aiDifficulty,
    });

    const saveResult = appendTrainingMatches(matches);

    _lastSelfPlaySummary = {
      ...summary,
      saved: saveResult.ok,
      storageError: saveResult.error ?? null,
    };

    return _lastSelfPlaySummary;
  };

  const currentTutorialStep = (state = get()) =>
    state.guidedTutorialActive ? GUIDED_TUTORIAL_STEPS[state.tutorialSectionIndex] ?? null : null;

  const canLocalOperate = (state = get()) => {
    if (state.gameMode === 'local_2p' && state.localTurnHandoffPlayer) return false;
    if (state.gameMode !== 'online_2p') return true;
    return state.game.currentTurn === state.localPlayer;
  };

  const snapshotTutorialReturnState = (): TutorialSessionSnapshot => {
    const state = get();
    return {
      game: cloneTutorialGameState(state.game),
      localPlayer: state.localPlayer,
      selectedAgentId: state.selectedAgentId,
      selectedPeriod: state.selectedPeriod,
      inspectedCityId: state.inspectedCityId,
      gameMode: state.gameMode,
      aiTurnInProgress: state.aiTurnInProgress,
      aiActivePeriod: state.aiActivePeriod,
      traversalEffects: state.traversalEffects.map(effect => ({ ...effect })),
      battleEffects: state.battleEffects.map(effect => ({ ...effect })),
      intelFeedOpen: state.intelFeedOpen,
      collapsingPeriods: [...state.collapsingPeriods],
      pendingTraversalAction: state.pendingTraversalAction ? { ...state.pendingTraversalAction } : null,
      lastActionFeedback: state.lastActionFeedback,
      settingsOpen: state.settingsOpen,
      terminalMode: state.terminalMode,
      terminalHistory: cloneTerminalHistoryEntries(state.terminalHistory),
      playerShellSessions: {
        ...clonePlayerShellSessions(state.playerShellSessions),
        [state.localPlayer]: captureActiveShellSession(state),
      },
      sudoPassword: state.sudoPassword,
      sudoAuthenticated: state.sudoAuthenticated,
      suMode: state.suMode,
      terminalAwaitingPassword: state.terminalAwaitingPassword,
      pendingPrivilegedInput: state.pendingPrivilegedInput,
      pendingPassConfirmation: state.pendingPassConfirmation,
      awaitingNextRound: state.awaitingNextRound,
      autoNextDeadline: state.autoNextDeadline,
      turnUndoStack: cloneTurnUndoStack(state.turnUndoStack),
      matchConfig: state.matchConfig,
      localTurnHandoffPlayer: state.localTurnHandoffPlayer,
      turnTimeoutNotice: state.turnTimeoutNotice,
      debugLocalSwitchEnabled: state.debugLocalSwitchEnabled,
    };
  };

  const restoreTutorialReturnState = () => {
    if (!_tutorialReturnSnapshot || !_tutorialRestoreOnExit) return false;
    const snapshot = cloneTutorialSessionSnapshot(_tutorialReturnSnapshot);
    _tutorialAiDemoPlan = null;
    _tutorialLastTraverseTargetPeriod = null;
    _tutorialIntroReturnIndex = null;
    clearAiTurnTimer();
    clearAutoNextTimer();
    clearCollapseTimers();
    clearTraversalEffectTimers();
    clearBattleEffectTimers();
    clearTutorialDemoTimers();
    set({
      ...snapshot,
      tutorialOpen: false,
      guidedTutorialActive: false,
      tutorialSectionIndex: 0,
      tutorialFocusIds: null,
      tutorialMarkedCityIds: [],
      tutorialTraversalLockedPeriod: null,
      tutorialPendingCompletionMode: null,
      actionEffectCue: null,
      soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
    });
    _tutorialReturnSnapshot = null;
    _tutorialRestoreOnExit = false;
    return true;
  };

const resetTutorialPlayerResources = (game: GameState): GameState => ({
  ...game,
  timelineOccupations: {
    PAST: { owner: null, pending: false, bonusActive: false, disabledByForeignControl: false },
    PRESENT: { owner: null, pending: false, bonusActive: false, disabledByForeignControl: false },
    FUTURE: { owner: null, pending: false, bonusActive: false, disabledByForeignControl: false },
  },
  players: {
      P1: {
        ...game.players.P1,
        intel: { PAST: 120, PRESENT: 120, FUTURE: 120 },
        encryptionActive: false,
        strikeReportActive: false,
        rapidReconActive: false,
        multiTimelineStrikeActive: false,
        deepCoverKnownToOpponent: false,
        extraActionsNextRound: 0,
        pendingActions: [],
        agents: game.players.P1.agents.map(agent => ({
          ...agent,
          actionsRemaining: 3,
          cover: false,
          deepCoverActive: false,
          forcedExposurePeriod: null,
        })),
      },
      P2: {
        ...game.players.P2,
        intel: { PAST: 120, PRESENT: 120, FUTURE: 120 },
        encryptionActive: false,
        strikeReportActive: false,
        rapidReconActive: false,
        multiTimelineStrikeActive: false,
        deepCoverKnownToOpponent: false,
        extraActionsNextRound: 0,
        pendingActions: [],
        agents: game.players.P2.agents.map(agent => ({
          ...agent,
          actionsRemaining: 3,
          cover: false,
          deepCoverActive: false,
          forcedExposurePeriod: null,
        })),
      },
    },
  });

  const prepareGuidedTutorialScenario = (
    stepIndex: number,
    baseGame?: GameState,
    baseSelectedAgentId?: string | null,
    baseSelectedPeriod?: TimePeriod,
    baseSettingsOpen = false,
    baseIntelFeedOpen = false,
    baseTerminalMode = false,
  ) => {
    const step = GUIDED_TUTORIAL_STEPS[stepIndex];
    let game = cloneTutorialGameState(baseGame ?? createInitialState());
    game = resetTutorialPlayerResources(game);
    game.currentTurn = 'P1';
    game.phase = 'ACTION_ASSIGN';
    if (!baseGame && game.notifications.length === 0) {
      game.notifications = [
        {
          id: 'tutorial_notif_1',
          type: 'CITY_CONTROLLED',
          message: 'Tutorial feed sample: controlled cities generate intel.',
          round: game.round,
          forPlayer: 'BOTH',
        },
        {
          id: 'tutorial_notif_2',
          type: 'TRAVERSAL_DETECTED',
          message: 'Tutorial feed sample: traversal alerts appear here as well.',
          round: game.round,
          forPlayer: 'BOTH',
        },
      ];
    }

    const p1Past = game.players.P1.agents.find(agent => agent.id === 'p1_past')!;
    const p2Past = game.players.P2.agents.find(agent => agent.id === 'p2_past')!;
    const p2Present = game.players.P2.agents.find(agent => agent.id === 'p2_present')!;
    const p2Future = game.players.P2.agents.find(agent => agent.id === 'p2_future')!;
    const currentSelectedAgent = baseSelectedAgentId
      ? game.players.P1.agents.find(agent => agent.id === baseSelectedAgentId) ?? null
      : null;
    const sharedNodePast = findFullSharedNodeCity(game, 'PAST') ?? findSharedNodeCity(game, 'PAST');
    const linkedPresent = sharedNodePast?.nodeId
      ? [...game.map.cities.values()].find(city => city.nodeId === sharedNodePast.nodeId && city.period === 'PRESENT' && !city.destroyed) ?? null
      : null;
    const linkedFuture = sharedNodePast?.nodeId
      ? [...game.map.cities.values()].find(city => city.nodeId === sharedNodePast.nodeId && city.period === 'FUTURE' && !city.destroyed) ?? null
      : null;

    let selectedAgentId: string | null = currentSelectedAgent?.id ?? p1Past.id;
    let settingsOpen = baseSettingsOpen;
    let intelFeedOpen = baseIntelFeedOpen;
    let terminalMode = baseTerminalMode;
    let selectedPeriod: TimePeriod = baseSelectedPeriod ?? currentSelectedAgent?.currentPeriod ?? p1Past.currentPeriod;
    let tutorialFocusIds: string[] | null = null;
    let tutorialMarkedCityIds: string[] = [];

    if (step.expectedEvent === 'select-agent') {
      selectedAgentId = null;
      selectedPeriod = 'PAST';
    }

    if (step.expectedEvent === 'action:CONTROL' && selectedAgentId) {
      const selectedAgent = game.players.P1.agents.find(agent => agent.id === selectedAgentId) ?? null;
      const currentCity = selectedAgent ? game.map.cities.get(selectedAgent.cityId) : null;
      if (currentCity?.controlledBy === 'P1') {
        game.map.cities.set(currentCity.id, { ...currentCity, controlledBy: null });
      }
    }

    if (step.expectedEvent === 'action:STRIKE') {
      const selectedAgent = game.players.P1.agents.find(agent => agent.id === selectedAgentId) ?? p1Past;
      p2Past.cityId = selectedAgent.cityId;
      p2Past.currentPeriod = selectedAgent.currentPeriod;
    }

    if (step.expectedEvent === 'action:MULTI_TIMELINE_STRIKE') {
      if (linkedPresent) {
        p2Present.cityId = linkedPresent.id;
        p2Present.currentPeriod = linkedPresent.period;
      }
      if (linkedFuture) {
        p2Future.cityId = linkedFuture.id;
        p2Future.currentPeriod = linkedFuture.period;
      }
    }

    if (step.expectedEvent === 'open-feed') {
      intelFeedOpen = false;
    }
    if (step.expectedEvent === 'close-feed') {
      intelFeedOpen = true;
    }
    if (step.expectedEvent === 'open-settings') {
      settingsOpen = false;
    } else if (step.expectedEvent === 'close-settings' || step.targetId.startsWith('settings-')) {
      settingsOpen = true;
    }
    if (step.expectedEvent === 'enable-terminal') {
      settingsOpen = true;
    }
    if (step.expectedEvent === 'disable-terminal') {
      settingsOpen = true;
    }
    if (step.targetId === 'terminal-shell' || step.expectedEvent.startsWith('terminal-')) {
      settingsOpen = false;
    }

    if (step.id === 'ai-demo') {
      tutorialFocusIds = ['period-past', 'period-present', 'period-future'];
    }

    if (step.id === 'move-traverse-node' && sharedNodePast) {
      tutorialMarkedCityIds = [sharedNodePast.id];
    }

    if (step.id === 'traverse-node-info' && sharedNodePast) {
      tutorialMarkedCityIds = [sharedNodePast.id];
    }

    if (step.id === 'move-multi-strike-node') {
      const plan = resolveTutorialAiDemoPlan(game);
      if (plan) {
        _tutorialAiDemoPlan = plan;
        tutorialMarkedCityIds = [plan.pastCityId];
      }
    }

    if (step.id === 'multi-strike-node-info') {
      const plan = resolveTutorialAiDemoPlan(game);
      if (plan) {
        _tutorialAiDemoPlan = plan;
        tutorialMarkedCityIds = [plan.pastCityId];
      }
    }

    if (step.id === 'multi-strike') {
      const plan = resolveTutorialAiDemoPlan(game);
      if (plan) {
        _tutorialAiDemoPlan = plan;
        const enemyCity = game.map.cities.get(plan.targetCityId);
        tutorialFocusIds = ['action-shop', 'period-past', `period-${enemyCity?.period.toLowerCase() ?? 'present'}`];
        tutorialMarkedCityIds = [plan.pastCityId, plan.targetCityId];
      }
    }

    if (step.id === 'collapse-info') {
      tutorialFocusIds = ['period-past'];
    }

    if (step.id === 'move-strike-city') {
      const selectedAgent = game.players.P1.agents.find(agent => agent.id === selectedAgentId) ?? p1Past;
      const currentEnemyCity = game.map.cities.get(p2Past.cityId);
      if (!currentEnemyCity || currentEnemyCity.destroyed || currentEnemyCity.period !== 'PAST') {
        const moveTarget = findFirstAdjacentCity(game, selectedAgent.cityId);
        if (moveTarget) {
          p2Past.cityId = moveTarget.id;
          p2Past.currentPeriod = moveTarget.period;
        }
      }
      tutorialMarkedCityIds = [p2Past.cityId];
    }

    if (step.id === 'strike-final') {
      tutorialFocusIds = ['action-strike', 'period-past'];
      tutorialMarkedCityIds = [p1Past.cityId, p2Past.cityId];
    }

    return {
      game: normalizeTutorialVisibility(game),
      selectedAgentId,
      selectedPeriod,
      terminalMode,
      settingsOpen,
      intelFeedOpen,
      tutorialFocusIds,
      tutorialMarkedCityIds,
    };
  };

  const applyGuidedTutorialScenario = (
    stepIndex: number,
    baseGame?: GameState,
    baseSelectedAgentId?: string | null,
    baseSelectedPeriod?: TimePeriod,
    baseSettingsOpen?: boolean,
    baseIntelFeedOpen?: boolean,
    baseTerminalMode?: boolean,
  ) => {
    const scenario = prepareGuidedTutorialScenario(
      stepIndex,
      baseGame,
      baseSelectedAgentId,
      baseSelectedPeriod,
      baseSettingsOpen,
      baseIntelFeedOpen,
      baseTerminalMode,
    );
    clearAiTurnTimer();
    clearAutoNextTimer();
    clearTutorialDemoTimers();
    set({
      game: scenario.game,
      localPlayer: 'P1',
      gameMode: 'local_2p',
      remoteSelectedAgentId: null,
      remoteSelectedPeriod: null,
      onlineRoomCode: null,
      onlineTransport: null,
      onlineRevision: 0,
      onlineOpponentConnected: false,
      onlineSyncError: null,
      aiTurnInProgress: false,
      aiActivePeriod: null,
      selectedAgentId: scenario.selectedAgentId,
      selectedPeriod: scenario.selectedPeriod,
      intelFeedOpen: scenario.intelFeedOpen,
      settingsOpen: scenario.settingsOpen,
      terminalMode: scenario.terminalMode,
      pendingTraversalAction: null,
      lastActionFeedback: null,
      tutorialOpen: true,
      guidedTutorialActive: true,
      tutorialSectionIndex: stepIndex,
      tutorialFocusIds: scenario.tutorialFocusIds,
      tutorialMarkedCityIds: scenario.tutorialMarkedCityIds,
      tutorialTraversalLockedPeriod: null,
      tutorialPendingCompletionMode: null,
      awaitingNextRound: false,
      autoNextDeadline: null,
      soundEffectCue: null,
    });
    const nextStep = GUIDED_TUTORIAL_STEPS[stepIndex];
    if (isTutorialFreeMoveStep({
      ...get(),
      game: scenario.game,
      tutorialSectionIndex: stepIndex,
      guidedTutorialActive: true,
    })) {
      const expectedTargetCityId = (() => {
        if (nextStep?.expectedEvent === 'move:traverse-node') {
          return (findFullSharedNodeCity(scenario.game, 'PAST') ?? findSharedNodeCity(scenario.game, 'PAST'))?.id ?? null;
        }
        if (nextStep?.expectedEvent === 'move:multi-strike-node') {
          return resolveTutorialAiDemoPlan(scenario.game)?.pastCityId ?? null;
        }
        if (nextStep?.expectedEvent === 'move:final-strike-city') {
          return scenario.game.players.P2.agents.find(agent => agent.id === 'p2_past')?.cityId ?? null;
        }
        return null;
      })();
      const selectedAgent = scenario.selectedAgentId
        ? scenario.game.players.P1.agents.find(agent => agent.id === scenario.selectedAgentId) ?? null
        : null;
      if (
        expectedTargetCityId
        && selectedAgent
        && selectedAgent.cityId === expectedTargetCityId
      ) {
        const timeoutId = window.setTimeout(() => applyGuidedTutorialScenario(
          stepIndex + 1,
          scenario.game,
          scenario.selectedAgentId,
          scenario.selectedPeriod,
          scenario.settingsOpen,
          scenario.intelFeedOpen,
          scenario.terminalMode,
        ), 20);
        _tutorialDemoTimers.add(timeoutId);
        return;
      }
    }
    if (GUIDED_TUTORIAL_STEPS[stepIndex]?.id === 'ai-demo') {
      const timeoutId = window.setTimeout(() => {
        const state = get();
        const plan = findBestAiTutorialNodePlan(state.game);
        if (!plan) {
          _tutorialAiDemoPlan = null;
          markGuidedTutorialEvent('ai-demo-complete');
          return;
        }

        _tutorialAiDemoPlan = plan;
        appendTerminalLines([`Enemy analysis: ${plan.agentId} routed to shared node ${plan.targetNodeId}.`], 'system');
        set({
          aiTurnInProgress: true,
          aiActivePeriod: plan.sourcePeriod,
          selectedAgentId: null,
          tutorialFocusIds: ['period-past', 'period-present', 'period-future'],
        });

        const steps = plan.path.slice(1);
        if (steps.length === 0) {
          set({ aiTurnInProgress: false, aiActivePeriod: null });
          markGuidedTutorialEvent('ai-demo-complete');
          return;
        }

        steps.forEach((cityId, index) => {
          const moveTimeoutId = window.setTimeout(() => {
            const live = get();
            const agent = live.game.players.P2.agents.find(item => item.id === plan.agentId);
            if (!agent) return;
            appendTerminalLines([`Enemy analysis step ${index + 1}: committing shortest-path move.`], 'system');
            let nextState = resolveSingleAction(live.game, {
              id: makeActionId(),
              type: 'MOVE',
              owner: 'P2',
              agentId: plan.agentId,
              targetCityId: cityId,
            }, { bypassCostsAndLimits: true });
            nextState = resetTutorialPlayerResources(nextState);
            const destinationCity = nextState.map.cities.get(cityId);
            set({
              game: nextState,
              aiTurnInProgress: index < steps.length - 1,
              aiActivePeriod: index < steps.length - 1 ? plan.sourcePeriod : null,
              tutorialMarkedCityIds: [],
              tutorialTraversalLockedPeriod: null,
            });
            appendTerminalLines([`Enemy move: ${plan.agentId} -> ${destinationCity?.name ?? cityId}.`], 'system');
            if (index === steps.length - 1) {
              appendTerminalLines(['Enemy turn complete. Shared node contact established across timelines.'], 'system');
              markGuidedTutorialEvent('ai-demo-complete');
            }
          }, 1400 * (index + 1));
          _tutorialDemoTimers.add(moveTimeoutId);
        });
      }, 250);
      _tutorialDemoTimers.add(timeoutId);
    }
  };

  const finishGuidedTutorial = () => {
    clearTutorialDemoTimers();
    _tutorialLastTraverseTargetPeriod = null;
    _tutorialAiDemoPlan = null;
    _tutorialIntroReturnIndex = null;
    if (restoreTutorialReturnState()) return;
    _tutorialReturnSnapshot = null;
    _tutorialRestoreOnExit = false;
    requestTutorialMenuReturn();
  };

  const requestTutorialMenuReturn = () => {
    _tutorialMenuReturnCounter += 1;
    set({
      tutorialMenuReturnToken: _tutorialMenuReturnCounter,
      tutorialPendingCompletionMode: null,
      actionEffectCue: null,
      soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
    });
  };

  const restartGuidedTutorialFromOutcome = () => {
    _tutorialLastTraverseTargetPeriod = null;
    _tutorialAiDemoPlan = null;
    if (_tutorialRestoreOnExit && _tutorialReturnSnapshot) {
      const snapshot = cloneTutorialSessionSnapshot(_tutorialReturnSnapshot);
      applyGuidedTutorialScenario(
        0,
        snapshot.game,
        snapshot.selectedAgentId,
        snapshot.selectedPeriod,
        snapshot.settingsOpen,
        snapshot.intelFeedOpen,
        snapshot.terminalMode,
      );
      return;
    }
    applyGuidedTutorialScenario(0);
  };

  const finalizeTutorialCompletion = (choice: 'menu' | 'restore' | 'new' | 'replay') => {
    if (choice === 'restore' && _tutorialRestoreOnExit) {
      restoreTutorialReturnState();
      return;
    }
    if (choice === 'replay') {
      restartGuidedTutorialFromOutcome();
      return;
    }
    if (choice === 'new') {
      const mode = _tutorialReturnSnapshot?.gameMode ?? _tutorialSourceGameMode;
      _tutorialReturnSnapshot = null;
      _tutorialRestoreOnExit = false;
      _tutorialAiDemoPlan = null;
      _tutorialLastTraverseTargetPeriod = null;
      get().initGame(mode);
      return;
    }
    _tutorialReturnSnapshot = null;
    _tutorialRestoreOnExit = false;
    _tutorialAiDemoPlan = null;
    _tutorialLastTraverseTargetPeriod = null;
    requestTutorialMenuReturn();
  };

  const blockTutorialOperation = (event?: TutorialEvent | null) => {
    const step = currentTutorialStep();
    const detail = step ? TUTORIAL_EVENT_DESCRIPTIONS[step.expectedEvent] : 'Follow the highlighted tutorial step';
    get().playSoundEffect('invalid_buzz');
    set({
      lastActionFeedback: event && event !== step?.expectedEvent
        ? `Tutorial expects: ${detail}`
        : detail,
    });
  };

  const emitActionEffect = (kind: ActionEffectCue['kind'], owner: PlayerId, period: TimePeriod | null) => {
    set({
      actionEffectCue: {
        token: ++_actionEffectCounter,
        kind,
        owner,
        period,
      },
    });
  };

  const emitActionEffectsFromResult = (previous: GameState, next: GameState, action: GameAction) => {
    const previousAllAgents = [...previous.players.P1.agents, ...previous.players.P2.agents];
    const nextAgentIds = new Set([...next.players.P1.agents, ...next.players.P2.agents].map(agent => agent.id));
    const nextNotifications = next.notifications.slice(previous.notifications.length);
    const paradoxTriggered = nextNotifications.some(notification => notification.type === 'PARADOX_OCCURRED');

    const newlyDestroyedCities = [...next.map.cities.values()].filter(city => {
      const previousCity = previous.map.cities.get(city.id);
      return Boolean(previousCity && !previousCity.destroyed && city.destroyed);
    });
    for (const city of newlyDestroyedCities) {
      triggerBattleEffect('paradox', null, city.period, city.id);
    }

    const eliminatedAgents = previousAllAgents.filter(agent => !nextAgentIds.has(agent.id));
    for (const agent of eliminatedAgents) {
      triggerBattleEffect('death', agent.owner, agent.currentPeriod, agent.cityId);
    }

    if (paradoxTriggered) {
      get().playSoundEffect('paradox_alarm');
      emitActionEffect('paradox', action.owner, previous.players[action.owner].agents.find(agent => agent.id === action.agentId)?.currentPeriod ?? null);
      return;
    }

    const actingAgent = previous.players[action.owner].agents.find(agent => agent.id === action.agentId);
    if (action.type === 'STRIKE' && actingAgent) {
      triggerBattleEffect('strike', action.owner, actingAgent.currentPeriod, actingAgent.cityId);
      emitActionEffect('strike-hit', action.owner, actingAgent.currentPeriod);
      return;
    }

    switch (action.type) {
      case 'RAPID_RECON':
        emitActionEffect('rapid-recon', action.owner, previous.players[action.owner].agents.find(agent => agent.id === action.agentId)?.currentPeriod ?? null);
        break;
      case 'STRIKE_REPORT':
        emitActionEffect('strike-report', action.owner, previous.players[action.owner].agents.find(agent => agent.id === action.agentId)?.currentPeriod ?? null);
        break;
      case 'DEEP_COVER':
        emitActionEffect('deep-cover', action.owner, previous.players[action.owner].agents.find(agent => agent.id === action.agentId)?.currentPeriod ?? null);
        break;
      case 'PREPARE_ACTION':
        emitActionEffect('prepare-action', action.owner, previous.players[action.owner].agents.find(agent => agent.id === action.agentId)?.currentPeriod ?? null);
        break;
      case 'ENCRYPTION':
        emitActionEffect('encryption', action.owner, previous.players[action.owner].agents.find(agent => agent.id === action.agentId)?.currentPeriod ?? null);
        break;
      default:
        break;
    }
  };

  const getTutorialExpectedMoveTarget = (state = get()) => {
    const step = currentTutorialStep(state);
    if (!step) return null;
    if (step.expectedEvent === 'move:multi-strike-node') {
      const plan = resolveTutorialAiDemoPlan(state.game);
      return plan?.pastCityId ?? null;
    }
    if (step.expectedEvent === 'move:traverse-node') {
      return (findFullSharedNodeCity(state.game, 'PAST') ?? findSharedNodeCity(state.game, 'PAST'))?.id ?? null;
    }
    if (step.expectedEvent === 'move:final-strike-city') {
      return state.game.players.P2.agents.find(agent => agent.id === 'p2_past')?.cityId ?? null;
    }
    return null;
  };

  const getTutorialActionEvent = (action: Omit<GameAction, 'id'> | GameAction, state = get()): TutorialEvent | null => {
    const step = currentTutorialStep(state);
    if (!step) return mapTutorialActionEvent(action.type);
    if (action.type === 'MOVE') {
      if (
        step.expectedEvent === 'move:traverse-node'
        || step.expectedEvent === 'move:multi-strike-node'
        || step.expectedEvent === 'move:final-strike-city'
      ) {
        const expectedTargetCityId = getTutorialExpectedMoveTarget(state);
        return action.targetCityId && expectedTargetCityId && action.targetCityId === expectedTargetCityId
          ? step.expectedEvent
          : null;
      }
      return mapTutorialActionEvent('MOVE');
    }
    if (action.type === 'TRAVERSE' && step.expectedEvent === 'paradox-traverse') {
      return action.targetPeriod && _tutorialLastTraverseTargetPeriod && action.targetPeriod === _tutorialLastTraverseTargetPeriod
        ? 'paradox-traverse'
        : null;
    }
    return mapTutorialActionEvent(action.type);
  };

  const isTutorialFreeMoveStep = (state = get()) => {
    const expectedEvent = currentTutorialStep(state)?.expectedEvent;
    return expectedEvent === 'move:traverse-node'
      || expectedEvent === 'move:multi-strike-node'
      || expectedEvent === 'move:final-strike-city';
  };

  const guardTutorialEvent = (event: TutorialEvent) => {
    const step = currentTutorialStep();
    if (!step) return true;
    if (step.expectedEvent === event) return true;
    blockTutorialOperation(event);
    return false;
  };

  const markGuidedTutorialEvent = (
    event: TutorialEvent,
    transitionState?: {
      game?: GameState;
      selectedAgentId?: string | null;
      selectedPeriod?: TimePeriod;
      settingsOpen?: boolean;
      intelFeedOpen?: boolean;
      terminalMode?: boolean;
    },
  ) => {
    const state = get();
    if (!state.guidedTutorialActive || !state.tutorialOpen) return;
    const step = GUIDED_TUTORIAL_STEPS[state.tutorialSectionIndex];
    if (!step || step.expectedEvent !== event) return;
    const nextIndex = step.id === 'close-settings-actions' && _tutorialIntroReturnIndex !== null
      ? _tutorialIntroReturnIndex
      : state.tutorialSectionIndex + 1;
    if (step.id === 'close-settings-actions' && _tutorialIntroReturnIndex !== null) {
      _tutorialIntroReturnIndex = null;
    }
    if (nextIndex >= GUIDED_TUTORIAL_STEPS.length) {
      const hasCompletedMission = Boolean(
        transitionState?.game?.winner === 'P1'
        && (transitionState.game.players.P2.agents.filter(agent => agent.period === 'PAST').length ?? 0) === 0,
      );
      if (!hasCompletedMission) return;
      return;
    }
    const nextGame = cloneTutorialGameState(transitionState?.game ?? state.game);
    const nextSelectedAgentId = transitionState?.selectedAgentId ?? state.selectedAgentId;
    const nextSelectedPeriod = transitionState?.selectedPeriod ?? state.selectedPeriod;
    const nextSettingsOpen = transitionState?.settingsOpen ?? state.settingsOpen;
    const nextIntelFeedOpen = transitionState?.intelFeedOpen ?? state.intelFeedOpen;
    const nextTerminalMode = transitionState?.terminalMode ?? state.terminalMode;
    window.setTimeout(() => applyGuidedTutorialScenario(
      nextIndex,
      nextGame,
      nextSelectedAgentId,
      nextSelectedPeriod,
      nextSettingsOpen,
      nextIntelFeedOpen,
      nextTerminalMode,
    ), 360);
  };

  const registerCollapsedPeriods = (previous: GameState, next: GameState) => {
    void previous;
    void next;
  };

  const retainSelectedAgent = (state: GameState, selectedAgentId: string | null, localPlayer: PlayerId) => {
    if (!selectedAgentId) return null;
    const stillAlive = state.players[localPlayer].agents.find(agent => agent.id === selectedAgentId);
    if (!stillAlive || stillAlive.actionsRemaining <= 0) return null;
    return selectedAgentId;
  };

  const finishAiTurn = (stateForAi: GameState) => {
    clearAiTurnTimer();
    clearUndoStack();
    const occupationSettled = applyOccupationTrackingAfterTurn(stateForAi, 'P2');
    const advanced: GameState = withTurnDeadline(
      {
        ...applyTurnBoundaryVision(
          applyOccupationRewards(advanceRound(occupationSettled.state, 'vs_ai'), occupationSettled.rewards, true),
        ),
        currentTurn: 'P1',
      },
      normalizeMatchConfig(stateForAi.matchConfig),
    );
    set({
      game: advanced,
      aiTurnInProgress: false,
      aiActivePeriod: null,
      selectedAgentId: null,
      inspectedCityId: null,
      pendingTraversalAction: null,
      tutorialTraversalLockedPeriod: null,
      pendingPassConfirmation: false,
      awaitingNextRound: false,
      autoNextDeadline: null,
      lastActionFeedback: null,
      localPlayer: 'P1',
      localTurnHandoffPlayer: null,
      turnTimeoutNotice: null,
    });
    appendTerminalLines([`Round ${advanced.round} ready. Awaiting commands.`], 'system');
  };

  const startAiTurn = (stateForAi: GameState) => {
    clearUndoStack();
    const stepAiTurn = (currentState: GameState) => {
      if (currentState.winner || currentState.phase === 'GAME_OVER') {
        clearAiTurnTimer();
        set({
          game: { ...currentState, phase: 'GAME_OVER' },
          aiTurnInProgress: false,
          aiActivePeriod: null,
          selectedAgentId: null,
          inspectedCityId: null,
          pendingTraversalAction: null,
          tutorialTraversalLockedPeriod: null,
          pendingPassConfirmation: false,
          awaitingNextRound: false,
          autoNextDeadline: null,
          lastActionFeedback: null,
        });
        return;
      }

      if (!playerHasActionsLeft(currentState, 'P2')) {
        finishAiTurn(currentState);
        return;
      }

      const nextAiAction = generateAIActions(currentState, 'P2').find(aiAction => {
        const aiAgent = currentState.players.P2.agents.find(agent => agent.id === aiAction.agentId);
        return Boolean(aiAgent && aiAgent.actionsRemaining > 0);
      });

      if (!nextAiAction) {
        finishAiTurn(currentState);
        return;
      }

      recordTrainingAction(currentState, nextAiAction);
      const steppedState = resolveSingleAction(currentState, nextAiAction);
      registerCollapsedPeriods(currentState, steppedState);
      emitActionEffectsFromResult(currentState, steppedState, nextAiAction);
      if (nextAiAction.type === 'MOVE' && steppedState !== currentState) {
        get().playSoundEffect('move_click');
      }
      if (nextAiAction.type === 'TRAVERSE' && steppedState !== currentState) {
        const sourcePeriod = currentState.players.P2.agents.find(agent => agent.id === nextAiAction.agentId)?.currentPeriod;
        if (sourcePeriod && nextAiAction.targetPeriod) {
          triggerTraversalEffect(sourcePeriod, nextAiAction.targetPeriod);
        }
      }

      const actingPeriod = currentState.players.P2.agents.find(agent => agent.id === nextAiAction.agentId)?.currentPeriod ?? null;
      set({
        game: { ...steppedState, currentTurn: 'P2' },
        aiTurnInProgress: true,
        aiActivePeriod: actingPeriod,
        selectedAgentId: null,
        inspectedCityId: null,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        pendingPassConfirmation: false,
        lastActionFeedback: null,
        turnTimeoutNotice: null,
      });

      appendTerminalLines([`AI ${nextAiAction.type.toLowerCase().replace(/_/g, ' ')} executed in ${actingPeriod ?? 'UNKNOWN'}.`], 'system');

      _aiTurnTimer = window.setTimeout(() => {
        stepAiTurn(steppedState);
      }, AI_ACTION_DELAY_MS);
    };

    clearAiTurnTimer();
    set({
      game: withTurnDeadline({ ...stateForAi, currentTurn: 'P2' }, normalizeMatchConfig(stateForAi.matchConfig)),
      aiTurnInProgress: true,
      aiActivePeriod: null,
      selectedAgentId: null,
      inspectedCityId: null,
      pendingTraversalAction: null,
      tutorialTraversalLockedPeriod: null,
      pendingPassConfirmation: false,
      awaitingNextRound: false,
      autoNextDeadline: null,
      lastActionFeedback: null,
      localTurnHandoffPlayer: null,
      turnTimeoutNotice: null,
    });
    appendTerminalLines([`Advancing into hostile turn window. AI ${getAiDifficultyLabel(stateForAi.matchConfig.aiDifficulty)}.`], 'system');
    _aiTurnTimer = window.setTimeout(() => {
      stepAiTurn(stateForAi);
    }, AI_ACTION_DELAY_MS);
  };

  const proceedAfterTurnEnd = (stateForAdvance: GameState, actor: PlayerId) => {
    clearAutoNextTimer();
    clearUndoStack();
    const occupationSettled = applyOccupationTrackingAfterTurn(stateForAdvance, actor);

    const { gameMode } = get();
    if (gameMode === 'vs_ai' && actor === 'P1') {
      startAiTurn(applyTurnBoundaryVision(applyOccupationRewards(occupationSettled.state, occupationSettled.rewards, true)));
      return;
    }

    if (gameMode === 'local_2p') {
      if (actor === 'P1') {
      const handoffState = withTurnDeadline(
        {
          ...applyTurnBoundaryVision(applyOccupationRewards(occupationSettled.state, occupationSettled.rewards, true)),
          currentTurn: 'P2',
        },
        normalizeMatchConfig(stateForAdvance.matchConfig),
      );
      set({
        game: handoffState,
        selectedAgentId: null,
        inspectedCityId: null,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        pendingPassConfirmation: false,
        awaitingNextRound: false,
        autoNextDeadline: null,
        lastActionFeedback: null,
        localTurnHandoffPlayer: 'P2',
        turnTimeoutNotice: null,
        });
        appendTerminalLines(['P1 turn complete. Terminal handed to P2.'], 'system');
        return;
      }

      const advanced = withTurnDeadline(
        {
          ...applyTurnBoundaryVision(
            applyOccupationRewards(advanceRound(occupationSettled.state, gameMode), occupationSettled.rewards, true),
          ),
          currentTurn: 'P1' as const,
        },
        normalizeMatchConfig(stateForAdvance.matchConfig),
      );
      set({
        game: advanced,
        selectedAgentId: null,
        inspectedCityId: null,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        pendingPassConfirmation: false,
        awaitingNextRound: false,
        autoNextDeadline: null,
        lastActionFeedback: null,
        localTurnHandoffPlayer: 'P1',
        turnTimeoutNotice: null,
      });
      appendTerminalLines([`Round ${advanced.round} ready. P1 terminal live.`], 'system');
      return;
    }

    if (gameMode === 'online_2p') {
      if (actor === 'P1') {
        set({
          game: withTurnDeadline(
            {
              ...applyTurnBoundaryVision(applyOccupationRewards(occupationSettled.state, occupationSettled.rewards, true)),
              currentTurn: 'P2',
            },
            normalizeMatchConfig(stateForAdvance.matchConfig),
          ),
          selectedAgentId: null,
          inspectedCityId: null,
          pendingTraversalAction: null,
          tutorialTraversalLockedPeriod: null,
          pendingPassConfirmation: false,
          awaitingNextRound: false,
          autoNextDeadline: null,
          lastActionFeedback: null,
          turnTimeoutNotice: null,
        });
        appendTerminalLines(['Turn sent. Awaiting the rival operative response window.'], 'system');
        return;
      }

      const advanced = withTurnDeadline(
        {
          ...applyTurnBoundaryVision(
            applyOccupationRewards(advanceRound(occupationSettled.state, gameMode), occupationSettled.rewards, true),
          ),
          currentTurn: 'P1' as const,
        },
        normalizeMatchConfig(stateForAdvance.matchConfig),
      );
      set({
        game: advanced,
        selectedAgentId: null,
        inspectedCityId: null,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        pendingPassConfirmation: false,
        awaitingNextRound: false,
        autoNextDeadline: null,
        lastActionFeedback: null,
        turnTimeoutNotice: null,
      });
      appendTerminalLines([`Round ${advanced.round} opened. Your command window is ready.`], 'system');
    }
  };

  const promptForNextRound = (stateForAdvance: GameState, actor: PlayerId) => {
    clearAutoNextTimer();
    const deadline = Date.now() + AUTO_NEXT_DELAY_MS;
    const message = actor === 'P1'
      ? 'Actions exhausted. Type pass to continue, or auto-advance will trigger in 3s.'
      : 'Turn exhausted. Type pass to continue, or auto-advance will trigger in 3s.';

    set({
      game: stateForAdvance,
      awaitingNextRound: true,
      autoNextDeadline: deadline,
      pendingTraversalAction: null,
      tutorialTraversalLockedPeriod: null,
      pendingPassConfirmation: false,
      lastActionFeedback: null,
    });
    appendTerminalLines([message], 'system');

    _autoNextTimer = window.setTimeout(() => {
      get().advanceByNextCommand(true);
    }, AUTO_NEXT_DELAY_MS);
  };

  const finishLocalAction = (
    previousState: GameState,
    nextState: GameState,
    actor: PlayerId,
    selectedAgentId: string | null,
    actionTriggeredByNext = false,
  ) => {
    registerCollapsedPeriods(previousState, nextState);

    if (nextState.winner) {
      finalizeTrainingSession(nextState);
      clearAiTurnTimer();
      clearAutoNextTimer();
      const tutorialMissionComplete = get().guidedTutorialActive
        && nextState.winner === 'P1'
        && nextState.players.P2.agents.filter(agent => agent.period === 'PAST').length === 0;
      set({
        game: { ...nextState, phase: 'GAME_OVER' },
        selectedAgentId: null,
        inspectedCityId: null,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        aiTurnInProgress: false,
        aiActivePeriod: null,
        tutorialFocusIds: tutorialMissionComplete ? null : get().tutorialFocusIds,
        tutorialMarkedCityIds: tutorialMissionComplete ? [] : get().tutorialMarkedCityIds,
        tutorialOpen: tutorialMissionComplete ? false : get().tutorialOpen,
        guidedTutorialActive: tutorialMissionComplete ? false : get().guidedTutorialActive,
        tutorialPendingCompletionMode: tutorialMissionComplete ? (_tutorialRestoreOnExit ? 'restore' : 'menu') : get().tutorialPendingCompletionMode,
        pendingPassConfirmation: false,
        awaitingNextRound: false,
        autoNextDeadline: null,
        lastActionFeedback: null,
        localTurnHandoffPlayer: null,
        turnTimeoutNotice: null,
      });
      return;
    }

    const { gameMode, localPlayer, terminalMode } = get();

    if (!playerHasActionsLeft(nextState, actor)) {
      if (terminalMode && !actionTriggeredByNext && actor === localPlayer) {
        promptForNextRound(nextState, actor);
        return;
      }

      proceedAfterTurnEnd(nextState, actor);
      return;
    }

    set({
      game: nextState,
      selectedAgentId: retainSelectedAgent(nextState, selectedAgentId, localPlayer),
      inspectedCityId: null,
      pendingTraversalAction: null,
      tutorialTraversalLockedPeriod: null,
      aiActivePeriod: null,
      pendingPassConfirmation: false,
      awaitingNextRound: false,
      autoNextDeadline: null,
      lastActionFeedback: null,
      localTurnHandoffPlayer: null,
      turnTimeoutNotice: null,
    });
  };

  const applyRootAdd = (resource: 'intel' | 'action', amount: number, period?: TimePeriod, agentId?: string) => {
    const { game, localPlayer, selectedPeriod } = get();

    if (resource === 'intel') {
      const targetPeriod = period ?? selectedPeriod;
      const newState = addIntel(game, localPlayer, targetPeriod, amount);
      pushUndoSnapshot(game);
      clearAutoNextTimer();
      set({
        game: newState,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        pendingPassConfirmation: false,
        awaitingNextRound: false,
        autoNextDeadline: null,
        inspectedCityId: null,
        lastActionFeedback: null,
      });
      appendTerminalLines([`Injected ${amount} intel into ${targetPeriod}.`], 'system');
      return;
    }

    if (!period || !agentId) {
      appendTerminalLines(['Use: add action [past|present|future] [agent] [number].'], 'error');
      return;
    }

    const targetAgent = game.players[localPlayer].agents.find(agent => agent.id === agentId && agent.currentPeriod === period);
    if (!targetAgent) {
      appendTerminalLines([`Agent ${agentId} not found in ${period}.`], 'error');
      return;
    }

    const newState: GameState = {
      ...game,
      players: {
        ...game.players,
        [localPlayer]: {
          ...game.players[localPlayer],
          agents: game.players[localPlayer].agents.map(agent =>
            agent.id === agentId
              ? { ...agent, actionsRemaining: agent.actionsRemaining + amount }
              : agent,
          ),
        },
      },
    };

    pushUndoSnapshot(game);
    clearAutoNextTimer();
    set({
      game: newState,
      selectedAgentId: agentId,
      selectedPeriod: period,
      pendingTraversalAction: null,
      tutorialTraversalLockedPeriod: null,
      pendingPassConfirmation: false,
      awaitingNextRound: false,
      autoNextDeadline: null,
      inspectedCityId: null,
      lastActionFeedback: null,
    });
    appendTerminalLines([`Injected ${amount} actions into ${targetAgent.id} (${period}).`], 'system');
  };

  const resetTranscript = () => {
    set(state => ({
      terminalHistory: [makeTerminalEntry('Temporal shell initialized.', 'system', state.game.round)],
    }));
  };

  const triggerTraversalEffect = (sourcePeriod: TimePeriod, targetPeriod: TimePeriod) => {
    const id = `traversal_${++_traversalEffectCounter}`;
    set(state => ({
      traversalEffects: [...state.traversalEffects, { id, sourcePeriod, targetPeriod }],
      soundEffectCue: { id: 'warp_slide', token: ++_soundCueCounter },
    }));
    const timeoutId = window.setTimeout(() => {
      _traversalEffectTimers.delete(id);
      set(state => ({
        traversalEffects: state.traversalEffects.filter(effect => effect.id !== id),
      }));
    }, TRAVERSAL_ANIMATION_MS);
    _traversalEffectTimers.set(id, timeoutId);
  };

  const triggerBattleEffect = (
    kind: BattleEffect['kind'],
    owner: PlayerId | null,
    period: TimePeriod,
    cityId: string,
  ) => {
    const id = `battle_${++_battleEffectCounter}`;
    const createdAt = Date.now();
    set(state => ({
      battleEffects: [...state.battleEffects, { id, kind, owner, period, cityId, createdAt }],
    }));
    const timeoutId = window.setTimeout(() => {
      _battleEffectTimers.delete(id);
      set(state => ({
        battleEffects: state.battleEffects.filter(effect => effect.id !== id),
      }));
    }, BATTLE_EFFECT_ANIMATION_MS);
    _battleEffectTimers.set(id, timeoutId);
  };

  const currentContext = () => {
    const state = get();
    return {
      game: state.game,
      localPlayer: state.localPlayer,
      selectedAgentId: state.selectedAgentId,
      selectedPeriod: state.selectedPeriod,
    };
  };

  const recentCommandHistory = () =>
    get().terminalHistory
      .filter(entry => entry.kind === 'input')
      .map(entry => stripPromptFromHistoryEntry(entry.text));

  const renderReadableCommand = (
    parsed: ReturnType<typeof parseTerminalCommand>,
    context: { game: GameState; localPlayer: PlayerId; selectedAgentId: string | null; selectedPeriod: TimePeriod },
    viaRootShell = false,
    pipedInput?: string[],
  ): { handled: boolean; success: boolean; lines: string[]; kind: TerminalEntry['kind'] } => {
    const { game, localPlayer, selectedPeriod } = context;

    if (parsed.kind === 'help') {
      return { handled: true, success: true, lines: getHelpLines(), kind: 'output' };
    }

    if (parsed.kind === 'man') {
      return { handled: true, success: true, lines: getManualLines(parsed.command), kind: 'output' };
    }

    if (parsed.kind === 'pwd') {
      const selected = getSelectedAgent(context);
      return {
        handled: true,
        success: true,
        lines: [`/round/${game.round}/${selectedPeriod.toLowerCase()}${selected ? `/${selected.id}` : ''}`],
        kind: 'output',
      };
    }

    if (parsed.kind === 'whoami') {
      return { handled: true, success: true, lines: [viaRootShell ? 'root' : localPlayer.toLowerCase()], kind: 'output' };
    }

    if (parsed.kind === 'status') {
      const selected = getSelectedAgent(context);
      return {
        handled: true,
        success: true,
        lines: [
          `round=${game.round} turn=${game.currentTurn} mode=${get().gameMode}`,
          ...(get().gameMode === 'vs_ai' ? [`ai_difficulty=${getAiDifficultyLabel(game.matchConfig.aiDifficulty)}`] : []),
          `selected_period=${selectedPeriod}`,
          `selected_agent=${selected ? `${selected.id} ${selected.period}->${selected.currentPeriod}` : 'none'}`,
          `intel past=${game.players[localPlayer].intel.PAST} present=${game.players[localPlayer].intel.PRESENT} future=${game.players[localPlayer].intel.FUTURE}`,
        ],
        kind: 'output',
      };
    }

    if (parsed.kind === 'history') {
      const history = recentCommandHistory().slice(-12);
      return {
        handled: true,
        success: true,
        lines: history.length > 0 ? history : ['No command history.'],
        kind: 'output',
      };
    }

    if (parsed.kind === 'date') {
      return {
        handled: true,
        success: true,
        lines: [`${new Date().toString()}`, `game-round=${game.round}`],
        kind: 'output',
      };
    }

    if (parsed.kind === 'uname') {
      return { handled: true, success: true, lines: ['CHRONODOX temporal-ops shell v0.1'], kind: 'output' };
    }

    if (parsed.kind === 'intel') {
      return {
        handled: true,
        success: true,
        lines: [
          `PAST ${game.players[localPlayer].intel.PAST}`,
          `PRESENT ${game.players[localPlayer].intel.PRESENT}`,
          `FUTURE ${game.players[localPlayer].intel.FUTURE}`,
        ],
        kind: 'output',
      };
    }

    if (parsed.kind === 'selfplay-status') {
      return {
        handled: true,
        success: true,
        lines: _lastSelfPlaySummary
          ? [
              `matches=${_lastSelfPlaySummary.matches}`,
              `difficulty=${getAiDifficultyLabel(_lastSelfPlaySummary.aiDifficulty)}`,
              `p1_wins=${_lastSelfPlaySummary.p1Wins}`,
              `p2_wins=${_lastSelfPlaySummary.p2Wins}`,
              `draws=${_lastSelfPlaySummary.draws}`,
              `average_rounds=${_lastSelfPlaySummary.averageRounds}`,
              `saved=${_lastSelfPlaySummary.saved ? 'yes' : 'no'}`,
              `storage_error=${_lastSelfPlaySummary.storageError ?? 'none'}`,
            ]
          : ['No self-play batch has been run yet.'],
        kind: 'output',
      };
    }

    if (parsed.kind === 'training-status') {
      const summary = getTrainingDatasetSummary();
      return {
        handled: true,
        success: true,
        lines: [
          `matches=${summary.matchCount}`,
          `clean_matches=${summary.cleanMatchCount}`,
          `tainted_matches=${summary.taintedMatchCount}`,
          `examples=${summary.exampleCount}`,
          `clean_examples=${summary.cleanExampleCount}`,
          `last_completed_at=${summary.lastCompletedAt ?? 'none'}`,
        ],
        kind: 'output',
      };
    }

    if (parsed.kind === 'training-audit') {
      const summary = getTrainingDatasetSummary();
      return {
        handled: true,
        success: true,
        lines: [
          `current_session_tainted=${_trainingSession?.tainted ? 'yes' : 'no'}`,
          `current_session_reasons=${_trainingSession?.taintReasons.join(', ') || 'none'}`,
          `stored_clean_matches=${summary.cleanMatchCount}`,
          `stored_tainted_matches=${summary.taintedMatchCount}`,
          'Clean exports exclude tainted sudo/su matches.',
        ],
        kind: 'output',
      };
    }

    if (parsed.kind === 'training-clear') {
      const result = clearTrainingDataset();
      if (result.ok) {
        set({ trainingStorageNotice: null });
        return {
          handled: true,
          success: true,
          lines: ['Saved browser-side training archive cleared. New completed matches will start a fresh archive.'],
          kind: 'system',
        };
      }
      return {
        handled: true,
        success: false,
        lines: [`Could not clear training archive: ${result.error ?? 'unknown storage error'}`],
        kind: 'error',
      };
    }

    if (parsed.kind === 'queue') {
      const state = get();
      return {
        handled: true,
        success: true,
        lines: [
          `current_turn=${state.game.currentTurn}`,
          `ai_turn_in_progress=${state.aiTurnInProgress ? 'yes' : 'no'}`,
          `pending_pass_confirmation=${state.pendingPassConfirmation ? 'yes' : 'no'}`,
          `awaiting_next_round=${state.awaitingNextRound ? 'yes' : 'no'}`,
          `available_undos=${state.turnUndoStack.length}`,
          `pending_traversal=${state.pendingTraversalAction ? `${state.pendingTraversalAction.type}:${state.pendingTraversalAction.agentId}` : 'none'}`,
        ],
        kind: 'output',
      };
    }

    if (parsed.kind === 'tail') {
      const sourceLines = pipedInput ?? getVisibleNotifications(game, localPlayer).map(notification => `R${notification.round} ${notification.message}`);
      const count = Math.max(1, parsed.count);
      return {
        handled: true,
        success: true,
        lines: sourceLines.slice(-count).length > 0 ? sourceLines.slice(-count) : ['No visible notifications.'],
        kind: 'output',
      };
    }

    if (parsed.kind === 'grep') {
      const needle = parsed.query.toLowerCase();
      const sourceLines = pipedInput ?? [
        ...get().terminalHistory.map(entry => entry.text),
        ...getVisibleNotifications(game, localPlayer).map(notification => notification.message),
      ];
      const lines = sourceLines.filter(line => line.toLowerCase().includes(needle));
      return {
        handled: true,
        success: lines.length > 0,
        lines: lines.length > 0 ? lines.slice(-20) : [`No matches for "${parsed.query}".`],
        kind: lines.length > 0 ? 'output' : 'error',
      };
    }

    if (parsed.kind === 'echo') {
      return { handled: true, success: true, lines: [parsed.text], kind: 'output' };
    }

    if (parsed.kind === 'agents') {
      return { handled: true, success: true, lines: formatAgentRoster(context, parsed.period, parsed.verbose), kind: 'output' };
    }

    if (parsed.kind === 'ls') {
      if (parsed.period) {
        return { handled: true, success: true, lines: formatAgentRoster(context, parsed.period), kind: 'output' };
      }
      if (parsed.city) {
        const sourceCity = findCityByName(context, selectedPeriod, parsed.city);
        if (!sourceCity) {
          return { handled: true, success: false, lines: [`No city named "${parsed.city}" in ${selectedPeriod}.`], kind: 'error' };
        }
        const adjacent = game.map.routes
          .filter(route => !route.destroyed && (route.from === sourceCity.id || route.to === sourceCity.id))
          .map(route => game.map.cities.get(route.from === sourceCity.id ? route.to : route.from)?.name ?? '??');
        return { handled: true, success: true, lines: [`${sourceCity.name}: ${adjacent.join(', ') || 'no routes'}`], kind: 'output' };
      }
      const selected = getSelectedAgent(context);
      if (!selected) {
        return { handled: true, success: false, lines: ['No selected agent. Use select/use first or ls [period].'], kind: 'error' };
      }
      const currentCity = game.map.cities.get(selected.cityId);
      const adjacent = [...new Set([
        currentCity?.name,
        ...game.map.routes
          .filter(route => !route.destroyed && (route.from === selected.cityId || route.to === selected.cityId))
          .map(route => game.map.cities.get(route.from === selected.cityId ? route.to : route.from)?.name ?? '??'),
      ])].filter((name): name is string => Boolean(name));
      return { handled: true, success: true, lines: adjacent, kind: 'output' };
    }

    if (parsed.kind === 'map') {
      return { handled: true, success: true, lines: formatMapListing(context, parsed.period), kind: 'output' };
    }

    if (parsed.kind === 'scan') {
      const selected = getSelectedAgent(context);
      if (!selected) {
        return { handled: true, success: false, lines: ['No selected agent. Use select/use first.'], kind: 'error' };
      }
      const city = game.map.cities.get(selected.cityId);
      const connected = game.map.routes
        .filter(route => !route.destroyed && (route.from === selected.cityId || route.to === selected.cityId))
        .map(route => game.map.cities.get(route.from === selected.cityId ? route.to : route.from)?.name ?? '??');
      const opponent = localPlayer === 'P1' ? 'P2' : 'P1';
      const visibleEnemies = game.players[opponent].agents.filter(agent =>
        agent.currentPeriod === selected.currentPeriod && game.vision[localPlayer].revealedAgentIds.has(agent.id),
      );
      return {
        handled: true,
        success: true,
        lines: [
          `agent=${selected.id} ${selected.period}->${selected.currentPeriod}`,
          `city=${city?.name ?? '??'} node=${city?.nodeId ?? 'none'} cover=${selected.cover ? 'hidden' : 'revealed'}`,
          `routes=${connected.join(', ') || 'none'}`,
          `visible_enemies_here=${visibleEnemies.length}`,
        ],
        kind: 'output',
      };
    }

    if (parsed.kind === 'routes') {
      const selected = getSelectedAgent(context);
      const city = parsed.city
        ? findCityByName(context, selected?.currentPeriod ?? selectedPeriod, parsed.city)
        : (selected ? game.map.cities.get(selected.cityId) ?? null : null);
      if (!city) {
        return { handled: true, success: false, lines: ['No route source city found. Use routes [city] or select an agent.'], kind: 'error' };
      }
      const routes = game.map.routes
        .filter(route => !route.destroyed && (route.from === city.id || route.to === city.id))
        .map(route => game.map.cities.get(route.from === city.id ? route.to : route.from)?.name ?? '??');
      return { handled: true, success: true, lines: [`${city.name}: ${routes.join(', ') || 'no routes'}`], kind: 'output' };
    }

    if (parsed.kind === 'locate-report') {
      const opponent = localPlayer === 'P1' ? 'P2' : 'P1';
      const revealed = game.players[opponent].agents
        .filter(agent => game.vision[localPlayer].revealedAgentIds.has(agent.id))
        .map(agent => {
          const city = game.map.cities.get(agent.cityId);
          return `${agent.id} ${agent.period}->${agent.currentPeriod} @ ${city?.name ?? '??'}`;
        });
      return {
        handled: true,
        success: true,
        lines: revealed.length > 0 ? revealed : ['No enemy agents currently revealed.'],
        kind: 'output',
      };
    }

    if (parsed.kind === 'killfeed') {
      const lines = getVisibleNotifications(game, localPlayer)
        .filter(notification => ['AGENT_ELIMINATED', 'PARADOX_OCCURRED', 'CAUSAL_COLLAPSE'].includes(notification.type))
        .slice(-12)
        .map(notification => `R${notification.round} ${notification.message}`);
      return {
        handled: true,
        success: true,
        lines: lines.length > 0 ? lines : ['No killfeed events logged.'],
        kind: 'output',
      };
    }

    if (parsed.kind === 'node') {
      const selected = getSelectedAgent(context);
      const city = parsed.query
        ? findCityByName(context, selected?.currentPeriod ?? selectedPeriod, parsed.query)
        : (selected ? game.map.cities.get(selected.cityId) ?? null : null);
      if (!city?.nodeId) {
        return { handled: true, success: false, lines: ['No shared traversal node found for that city/context.'], kind: 'error' };
      }
      const siblings = (game.map.nodes.get(city.nodeId) ?? [])
        .map(id => game.map.cities.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map(item => `${item.period}:${item.name}${item.destroyed ? ' [destroyed]' : ''}`);
      return { handled: true, success: true, lines: [`${city.nodeId}: ${siblings.join(' | ')}`], kind: 'output' };
    }

    return { handled: false, success: false, lines: [], kind: 'output' };
  };

  const tokenizeShellOperators = (raw: string) => {
    const tokens: string[] = [];
    let buffer = '';

    for (let i = 0; i < raw.length; i += 1) {
      const pair = raw.slice(i, i + 2);
      if (pair === '&&' || pair === '||') {
        if (buffer.trim()) tokens.push(buffer.trim());
        buffer = '';
        tokens.push(pair);
        i += 1;
        continue;
      }
      if (raw[i] === ';' || raw[i] === '|') {
        if (buffer.trim()) tokens.push(buffer.trim());
        buffer = '';
        tokens.push(raw[i]);
        continue;
      }
      buffer += raw[i];
    }

    if (buffer.trim()) tokens.push(buffer.trim());
    return tokens;
  };

  const runShellReadableExpression = (raw: string) => {
    const tokens = tokenizeShellOperators(raw);
    if (tokens.length === 0 || !tokens.some(token => ['|', '&&', '||', ';'].includes(token))) {
      return false;
    }

    const runPipeline = (pipelineTokens: string[]) => {
      const commands: string[] = [];
      let current = '';
      for (const token of pipelineTokens) {
        if (token === '|') {
          if (!current.trim()) {
            return { success: false, lines: ['Invalid pipeline syntax.'], kind: 'error' as const };
          }
          commands.push(current.trim());
          current = '';
          continue;
        }
        current += `${current ? ' ' : ''}${token}`;
      }
      if (!current.trim()) {
        return { success: false, lines: ['Invalid pipeline syntax.'], kind: 'error' as const };
      }
      commands.push(current.trim());

      let pipedInput: string[] | undefined;
      let finalKind: TerminalEntry['kind'] = 'output';

      for (const command of commands) {
        const parsed = parseTerminalCommand(command, currentContext());
        const rendered = renderReadableCommand(parsed, currentContext(), get().suMode, pipedInput);
        if (!rendered.handled) {
          return {
            success: false,
            lines: [`Operator expressions currently support read-only shell commands only. "${command}" must be run directly.`],
            kind: 'error' as const,
          };
        }
        pipedInput = rendered.lines;
        finalKind = rendered.kind;
        if (!rendered.success && command !== commands[commands.length - 1]) {
          return { success: false, lines: rendered.lines, kind: rendered.kind };
        }
      }

      return {
        success: finalKind !== 'error',
        lines: pipedInput ?? [],
        kind: finalKind,
      };
    };

    const statements: string[][] = [];
    let currentStatement: string[] = [];
    for (const token of tokens) {
      if (token === ';') {
        if (currentStatement.length > 0) statements.push(currentStatement);
        currentStatement = [];
      } else {
        currentStatement.push(token);
      }
    }
    if (currentStatement.length > 0) statements.push(currentStatement);

    for (const statement of statements) {
      let currentChunk: string[] = [];
      let logicalOp: '&&' | '||' | null = null;
      let lastSuccess = true;

      const flushChunk = () => {
        if (currentChunk.length === 0) return lastSuccess;
        const shouldRun = logicalOp === null || (logicalOp === '&&' ? lastSuccess : !lastSuccess);
        if (!shouldRun) {
          currentChunk = [];
          return lastSuccess;
        }
        const result = runPipeline(currentChunk);
        if (result.lines.length > 0) appendTerminalLines(result.lines, result.kind);
        lastSuccess = result.success;
        currentChunk = [];
        return lastSuccess;
      };

      for (const token of statement) {
        if (token === '&&' || token === '||') {
          flushChunk();
          logicalOp = token;
        } else {
          currentChunk.push(token);
        }
      }
      flushChunk();
    }

    return true;
  };

  const handleParsedCommand = (
    parsed: ReturnType<typeof parseTerminalCommand>,
    context: { game: GameState; localPlayer: PlayerId; selectedAgentId: string | null; selectedPeriod: TimePeriod },
    options: { privileged: boolean; viaRootShell: boolean },
  ) => {
    const { game, localPlayer, selectedPeriod } = context;

    const readable = renderReadableCommand(parsed, context, options.viaRootShell);
    if (readable.handled) {
      appendTerminalLines(readable.lines, readable.kind);
      return;
    }

    if (parsed.kind === 'invalid') {
      appendTerminalLines([parsed.message], 'error');
      return;
    }

    if (parsed.kind === 'clear') {
      resetTranscript();
      return;
    }


    if (parsed.kind === 'selfplay-run') {
      const summary = runSelfPlayMatches(parsed.count, parsed.difficulty);
      appendTerminalLines([
        `Self-play complete: ${summary.matches} match${summary.matches === 1 ? '' : 'es'}.`,
        `difficulty=${getAiDifficultyLabel(summary.aiDifficulty)}`,
        `P1 wins=${summary.p1Wins} P2 wins=${summary.p2Wins} draws=${summary.draws}`,
        `average_rounds=${summary.averageRounds}`,
        `saved=${summary.saved ? 'yes' : 'no'}`,
        ...(summary.storageError ? [`storage_error=${summary.storageError}`] : []),
      ], 'system');
      return;
    }

    if (parsed.kind === 'training-export') {
      const exported = downloadTrainingDataset();
      const cleanExported = downloadCleanTrainingDataset();
      appendTerminalLines(
        [
          exported && cleanExported
            ? 'Training dataset downloads started: full export and clean export.'
            : 'Training dataset export unavailable in this environment.',
        ],
        exported && cleanExported ? 'system' : 'error',
      );
      return;
    }

    if (parsed.kind === 'abort') {
      clearAutoNextTimer();
      set({
        pendingTraversalAction: null,
        terminalAwaitingPassword: false,
        pendingPrivilegedInput: null,
        pendingPassConfirmation: false,
        awaitingNextRound: false,
        autoNextDeadline: null,
      });
      appendTerminalLines(['Pending shell state cancelled.'], 'system');
      return;
    }

    if (parsed.kind === 'repeat') {
      const lastCommand = [...recentCommandHistory()].reverse().find(command => normalizeTerminalRepeatCandidate(command));
      if (!lastCommand) {
        appendTerminalLines(['No repeatable command found.'], 'error');
        return;
      }
      appendTerminalLines([`Repeating: ${lastCommand}`], 'system');
      get().submitTerminalInput(lastCommand);
      return;
    }

    if (parsed.kind === 'passwd') {
      if (!options.viaRootShell && !options.privileged) {
        appendTerminalLines(['passwd is root-only. Use sudo passwd or run it under su.'], 'error');
        return;
      }
      set({
        terminalAwaitingPassword: true,
        pendingPrivilegedInput: '__passwd_current__',
      });
      appendTerminalLines(['Current password:'], 'system');
      return;
    }

    if (parsed.kind === 'select' || parsed.kind === 'use') {
      set({ selectedAgentId: parsed.agentId, selectedPeriod: parsed.period });
      appendTerminalLines([`Selected ${parsed.agentId} in ${parsed.period}.`], 'system');
      return;
    }

    if (parsed.kind === 'cd') {
      set({ selectedPeriod: parsed.period });
      appendTerminalLines([`Context period set to ${parsed.period}.`], 'system');
      return;
    }

    if (parsed.kind === 'exit' || parsed.kind === 'logout') {
      if (get().suMode) {
        set({ suMode: false });
        appendTerminalLines(['Root shell released.'], 'system');
      } else {
        appendTerminalLines(['No active root shell.'], 'error');
      }
      return;
    }

    if (parsed.kind === 'add') {
      if (!options.viaRootShell && !options.privileged) {
        appendTerminalLines(['add is root-only. Use sudo or su.'], 'error');
        return;
      }
      applyRootAdd(parsed.resource, parsed.amount, parsed.period, parsed.agentId);
      return;
    }

    if (parsed.kind === 'handoff-debug') {
      if (!options.viaRootShell && !options.privileged) {
        appendTerminalLines(['handoff is root-only. Use sudo handoff unlock/lock or run it under su.'], 'error');
        return;
      }
      set({
        debugLocalSwitchEnabled: parsed.enabled,
      });
      appendTerminalLines([
        parsed.enabled
          ? 'Manual local handoff switching unlocked for testing.'
          : 'Manual local handoff switching locked.',
      ], 'system');
      return;
    }

    if (parsed.kind === 'pass') {
      if (!canLocalOperate()) {
        appendTerminalLines([
          get().gameMode === 'local_2p'
            ? 'Pass the console before issuing more orders.'
            : 'Stand by. It is the other operative’s turn.',
        ], 'error');
        return;
      }
      if (!get().awaitingNextRound && !playerHasActionsLeft(get().game, get().localPlayer)) {
        appendTerminalLines(['No remaining actions to pass through.'], 'error');
        return;
      }
      set({ pendingPassConfirmation: true });
      appendTerminalLines(['Confirm pass? Enter Yes/y to commit the remaining actions as WAIT. Any other input cancels.'], 'system');
      return;
    }

    if (parsed.kind === 'undo') {
      get().undoLastTurnAction();
      return;
    }

    if (get().awaitingNextRound && !options.privileged) {
      appendTerminalLines(['Enter pass to continue, or abort the pending state first.'], 'error');
      return;
    }

    if (parsed.kind !== 'action') {
      appendTerminalLines([`Unsupported command state for "${parsed.kind}".`], 'error');
      return;
    }

    appendTerminalLines([parsed.summary], 'system');
    get().executeActionNow(parsed.action, options.privileged ? { bypassCostsAndLimits: true } : undefined);
  };

  return {
    game: createInitialState(),
    localPlayer: 'P1',
    selectedAgentId: null,
    selectedPeriod: 'PAST',
    remoteSelectedAgentId: null,
    remoteSelectedPeriod: null,
    gameMode: 'vs_ai',
    onlineRoomCode: null,
    onlineTransport: null,
    onlineRevision: 0,
    onlineOpponentConnected: false,
    onlineSyncError: null,
    aiTurnInProgress: false,
    aiActivePeriod: null,
    traversalEffects: [],
    battleEffects: [],
    intelFeedOpen: false,
    collapsingPeriods: [],
    pendingTraversalAction: null,
    lastActionFeedback: null,
    settingsOpen: false,
    guidedTutorialActive: false,
    tutorialOpen: false,
    tutorialSectionIndex: 0,
    tutorialFocusIds: null,
    tutorialMarkedCityIds: [],
    tutorialTraversalLockedPeriod: null,
    tutorialPendingCompletionMode: null,
    tutorialMenuReturnToken: 0,
    actionEffectCue: null,
    trainingStorageNotice: null,
    brightness: 1,
    homeMusicTrackId: DEFAULT_MUSIC_TRACK_ID,
    gameMusicTrackId: DEFAULT_MUSIC_TRACK_ID,
    musicVolume: 0.45,
    sfxVolume: 0.34,
    muteAllAudio: false,
    soundEffectCue: null,
    terminalMode: false,
    terminalHistory: [],
    playerShellSessions: createPlayerShellSessions(1),
    sudoPassword: createSessionPassword(),
    sudoAuthenticated: false,
    suMode: false,
    terminalAwaitingPassword: false,
    pendingPrivilegedInput: null,
    pendingPassConfirmation: false,
    awaitingNextRound: false,
    autoNextDeadline: null,
    inspectedCityId: null,
    turnUndoStack: [],
    matchConfig: normalizeMatchConfig(),
    localTurnHandoffPlayer: null,
    turnTimeoutNotice: null,
    debugLocalSwitchEnabled: false,

    initGame: (mode, sudoPassword, matchConfig) => {
      finalizeTrainingSession(get().game);
      clearAiTurnTimer();
      clearAutoNextTimer();
      clearCollapseTimers();
      clearTraversalEffectTimers();
      clearBattleEffectTimers();
      clearTutorialDemoTimers();
      _tutorialReturnSnapshot = null;
      _tutorialRestoreOnExit = false;
      const normalizedMatchConfig = normalizeMatchConfig(matchConfig);
      const game = withTurnDeadline(createInitialState(normalizedMatchConfig), normalizedMatchConfig);
      const playerShellSessions = createPlayerShellSessions(game.round);
      _trainingSession = startTrainingMatch(mode, mode === 'vs_ai' ? normalizedMatchConfig.aiDifficulty : null);
      set({
          game,
        localPlayer: 'P1',
        selectedAgentId: null,
        selectedPeriod: 'PAST',
        remoteSelectedAgentId: null,
        remoteSelectedPeriod: null,
        gameMode: mode,
        onlineRoomCode: null,
        onlineTransport: null,
        onlineRevision: 0,
        onlineOpponentConnected: false,
        onlineSyncError: null,
        aiTurnInProgress: false,
        aiActivePeriod: null,
        traversalEffects: [],
        battleEffects: [],
        intelFeedOpen: false,
        collapsingPeriods: [],
        pendingTraversalAction: null,
        lastActionFeedback: null,
        settingsOpen: false,
        guidedTutorialActive: false,
        tutorialOpen: false,
        tutorialSectionIndex: 0,
        tutorialFocusIds: null,
        tutorialMarkedCityIds: [],
        tutorialTraversalLockedPeriod: null,
        tutorialPendingCompletionMode: null,
        tutorialMenuReturnToken: _tutorialMenuReturnCounter,
        actionEffectCue: null,
        trainingStorageNotice: null,
        terminalHistory: cloneTerminalHistoryEntries(playerShellSessions.P1.terminalHistory),
        playerShellSessions,
        sudoPassword: sudoPassword?.trim() || 'root',
        sudoAuthenticated: false,
        suMode: false,
        terminalAwaitingPassword: false,
        pendingPrivilegedInput: null,
        pendingPassConfirmation: false,
        awaitingNextRound: false,
        autoNextDeadline: null,
        matchConfig: normalizedMatchConfig,
        localTurnHandoffPlayer: null,
        turnTimeoutNotice: null,
        debugLocalSwitchEnabled: false,
        soundEffectCue: null,
        inspectedCityId: null,
        turnUndoStack: [],
      });
    },

    loadOnlineGame: (game, options) => {
      finalizeTrainingSession(get().game);
      clearAiTurnTimer();
      clearAutoNextTimer();
      clearCollapseTimers();
      clearTraversalEffectTimers();
      clearBattleEffectTimers();
      clearTutorialDemoTimers();
      _tutorialReturnSnapshot = null;
      _tutorialRestoreOnExit = false;
      _trainingSession = startTrainingMatch('online_2p', null);
      const normalizedMatchConfig = normalizeMatchConfig(options.matchConfig ?? game.matchConfig);
      const playerShellSessions = createPlayerShellSessions(game.round, {
        [options.localPlayer]: ['Temporal shell initialized.', `Connected to room ${options.roomCode}. Mission channel open.`],
      });
      const activeShellSession = playerShellSessions[options.localPlayer];
      set({
        game: {
          ...game,
          matchConfig: normalizedMatchConfig,
        },
        localPlayer: options.localPlayer,
        selectedAgentId: null,
        selectedPeriod: 'PAST',
        remoteSelectedAgentId: null,
        remoteSelectedPeriod: null,
        gameMode: 'online_2p',
        onlineRoomCode: options.roomCode,
        onlineTransport: options.transport,
        onlineRevision: options.revision,
        onlineOpponentConnected: options.opponentConnected,
        onlineSyncError: null,
        aiTurnInProgress: false,
        aiActivePeriod: null,
        traversalEffects: [],
        battleEffects: [],
        intelFeedOpen: false,
        collapsingPeriods: [],
        pendingTraversalAction: null,
        lastActionFeedback: null,
        settingsOpen: false,
        guidedTutorialActive: false,
        tutorialOpen: false,
        tutorialSectionIndex: 0,
        tutorialFocusIds: null,
        tutorialMarkedCityIds: [],
        tutorialTraversalLockedPeriod: null,
        tutorialPendingCompletionMode: null,
        tutorialMenuReturnToken: _tutorialMenuReturnCounter,
        actionEffectCue: null,
        trainingStorageNotice: null,
        terminalHistory: cloneTerminalHistoryEntries(activeShellSession.terminalHistory),
        playerShellSessions,
        sudoPassword: 'root',
        sudoAuthenticated: activeShellSession.sudoAuthenticated,
        suMode: activeShellSession.suMode,
        terminalAwaitingPassword: activeShellSession.terminalAwaitingPassword,
        pendingPrivilegedInput: activeShellSession.pendingPrivilegedInput,
        pendingPassConfirmation: activeShellSession.pendingPassConfirmation,
        awaitingNextRound: false,
        autoNextDeadline: null,
        inspectedCityId: null,
        turnUndoStack: [],
        matchConfig: normalizedMatchConfig,
        localTurnHandoffPlayer: null,
        turnTimeoutNotice: null,
        debugLocalSwitchEnabled: false,
        soundEffectCue: null,
      });
    },

    applyRemoteOnlineGame: (game, revision, opponentConnected) => {
      set(state => {
        if (state.gameMode !== 'online_2p' || revision <= state.onlineRevision) return state;
        return {
          game,
          matchConfig: normalizeMatchConfig(game.matchConfig),
          onlineRevision: revision,
          onlineOpponentConnected: opponentConnected,
          onlineSyncError: null,
          aiTurnInProgress: false,
          aiActivePeriod: null,
          pendingTraversalAction: null,
          tutorialTraversalLockedPeriod: null,
          pendingPassConfirmation: false,
          awaitingNextRound: false,
          autoNextDeadline: null,
          inspectedCityId: null,
          turnUndoStack: [],
          localTurnHandoffPlayer: null,
          turnTimeoutNotice: null,
          selectedAgentId: state.selectedAgentId
            && game.players[state.localPlayer].agents.some(agent => agent.id === state.selectedAgentId)
            ? state.selectedAgentId
            : null,
        };
      });
    },

    applyRemoteOnlinePresence: (selectedAgentId, selectedPeriod) => set(state => {
      if (state.gameMode !== 'online_2p') return state;
      return {
        remoteSelectedAgentId: selectedAgentId,
        remoteSelectedPeriod: selectedPeriod,
      };
    }),

    setOnlineSyncError: (message) => set(state => ({
      onlineSyncError: message,
      lastActionFeedback: message === null
        ? (state.onlineSyncError === state.lastActionFeedback ? null : state.lastActionFeedback)
        : message,
    })),

    selectAgent: (agentId) => {
      if (!canLocalOperate()) {
        set({ lastActionFeedback: 'Stand by. It is the other operative’s turn.' });
        return;
      }
      if (get().guidedTutorialActive) {
        if (!agentId || !guardTutorialEvent('select-agent')) return;
      }
      const selectedAgent = agentId
        ? [...get().game.players.P1.agents, ...get().game.players.P2.agents].find(agent => agent.id === agentId) ?? null
        : null;
      set({
        selectedAgentId: agentId,
        inspectedCityId: null,
        selectedPeriod: selectedAgent?.currentPeriod ?? get().selectedPeriod,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
      });
      if (agentId && get().guidedTutorialActive) markGuidedTutorialEvent('select-agent');
    },

    inspectCity: (cityId, period) => {
      if (!canLocalOperate()) {
        set({ lastActionFeedback: 'Stand by. It is the other operative’s turn.' });
        return;
      }
      const city = cityId ? get().game.map.cities.get(cityId) ?? null : null;
      set({
        selectedAgentId: null,
        inspectedCityId: city?.id ?? null,
        selectedPeriod: period ?? city?.period ?? get().selectedPeriod,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
      });
    },

    selectPeriod: (period) => set({ selectedPeriod: period }),

    toggleIntelFeed: () => {
      const nextOpen = !get().intelFeedOpen;
      if (nextOpen && get().guidedTutorialActive && !guardTutorialEvent('open-feed')) return;
      set(state => ({
        intelFeedOpen: !state.intelFeedOpen,
        soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
      }));
      if (nextOpen && get().guidedTutorialActive) markGuidedTutorialEvent('open-feed');
    },

    closeIntelFeed: () => {
      if (get().guidedTutorialActive && !guardTutorialEvent('close-feed')) return;
      set({
        intelFeedOpen: false,
        soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
      });
      if (get().guidedTutorialActive) markGuidedTutorialEvent('close-feed');
    },

    openSettings: () => {
      if (get().guidedTutorialActive && !guardTutorialEvent('open-settings')) return;
      set({
        settingsOpen: true,
        soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
      });
      if (get().guidedTutorialActive) markGuidedTutorialEvent('open-settings');
    },

    closeSettings: () => {
      if (get().guidedTutorialActive && !guardTutorialEvent('close-settings')) return;
      set({
        settingsOpen: false,
        soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
      });
      if (get().guidedTutorialActive) markGuidedTutorialEvent('close-settings');
    },

    openTutorial: (sectionIndex = 0) => set({
      tutorialOpen: true,
      tutorialSectionIndex: Math.max(0, sectionIndex),
      soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
    }),

    closeTutorial: () => {
      if (get().guidedTutorialActive) {
        finishGuidedTutorial();
        return;
      }
      set({
        tutorialOpen: false,
        guidedTutorialActive: false,
        tutorialFocusIds: null,
        tutorialMarkedCityIds: [],
        tutorialTraversalLockedPeriod: null,
        soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
      });
    },

    setTutorialSection: (sectionIndex) => set({
      tutorialSectionIndex: Math.max(0, sectionIndex),
      soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
    }),

    startGuidedTutorial: (options) => {
      if (get().gameMode === 'online_2p') {
        set({ lastActionFeedback: 'Guided training is offline-only. Leave the room to run it.' });
        return;
      }
      const restoreOnExit = Boolean(options?.restoreOnExit);
      const state = get();
      _tutorialLastTraverseTargetPeriod = null;
      _tutorialAiDemoPlan = null;
      _tutorialIntroReturnIndex = null;
      _tutorialSourceGameMode = restoreOnExit ? state.gameMode : 'vs_ai';
      _tutorialReturnSnapshot = restoreOnExit ? snapshotTutorialReturnState() : null;
      _tutorialRestoreOnExit = restoreOnExit;
      const startsWithTerminalShutdown = restoreOnExit && state.terminalMode;
      if (startsWithTerminalShutdown) {
        _tutorialIntroReturnIndex = 0;
      }
      applyGuidedTutorialScenario(
        startsWithTerminalShutdown ? GUIDED_TUTORIAL_STEPS.findIndex(step => step.id === 'settings-return') : 0,
        restoreOnExit ? cloneTutorialGameState(state.game) : undefined,
        restoreOnExit ? state.selectedAgentId : null,
        restoreOnExit ? state.selectedPeriod : 'PAST',
        restoreOnExit ? state.settingsOpen : false,
        restoreOnExit ? state.intelFeedOpen : false,
        restoreOnExit ? state.terminalMode : false,
      );
    },

    continueTutorialStep: () => {
      const state = get();
      const step = currentTutorialStep(state);
      if (!step) return;
      markGuidedTutorialEvent(step.expectedEvent, {
        game: state.game,
        selectedAgentId: state.selectedAgentId,
        selectedPeriod: state.selectedPeriod,
        settingsOpen: state.settingsOpen,
        intelFeedOpen: state.intelFeedOpen,
        terminalMode: state.terminalMode,
      });
    },

    completeTutorialPostGameOver: () => {
      if (!get().tutorialPendingCompletionMode) return;
      finalizeTutorialCompletion(get().tutorialPendingCompletionMode === 'restore' ? 'restore' : 'menu');
    },

    resolveGameOverChoice: (choice) => {
      if (get().tutorialPendingCompletionMode) {
        finalizeTutorialCompletion(choice);
        return;
      }
      if (choice === 'menu') {
        requestTutorialMenuReturn();
        return;
      }
      if (choice === 'new') {
        if (get().gameMode === 'online_2p') {
          requestTutorialMenuReturn();
          return;
        }
        get().initGame(get().gameMode);
      }
    },

    returnToMenu: () => {
      requestTutorialMenuReturn();
    },

    setBrightness: (value) => set({ brightness: value }),

    setHomeMusicTrack: (trackId) => set({
      homeMusicTrackId: trackId,
      soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
    }),

    setGameMusicTrack: (trackId) => set({
      gameMusicTrackId: trackId,
      soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
    }),

    setMusicVolume: (value) => set({ musicVolume: value }),

    setSfxVolume: (value) => set({ sfxVolume: value }),

    setMuteAllAudio: (muted) => set({
      muteAllAudio: muted,
      soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
    }),

    setTerminalMode: (enabled) => {
      if (get().guidedTutorialActive) {
        const event: TutorialEvent = enabled ? 'enable-terminal' : 'disable-terminal';
        if (!guardTutorialEvent(event)) return;
      }
      set({
        terminalMode: enabled,
        soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
      });
      if (get().guidedTutorialActive) {
        markGuidedTutorialEvent(enabled ? 'enable-terminal' : 'disable-terminal');
      }
    },

    playSoundEffect: (id) => set({ soundEffectCue: { id, token: ++_soundCueCounter } }),

    acknowledgeLocalHandoff: () => {
      const { localTurnHandoffPlayer, gameMode } = get();
      if (gameMode !== 'local_2p' || !localTurnHandoffPlayer) return;
      swapLocalShellSession(localTurnHandoffPlayer);
      set({
        localTurnHandoffPlayer: null,
        selectedAgentId: null,
        inspectedCityId: null,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        aiActivePeriod: null,
        lastActionFeedback: null,
        soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
      });
    },

    dismissTurnTimeoutNotice: () => set({
      turnTimeoutNotice: null,
      soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
    }),

    handleTurnTimerExpired: () => {
      const { game, localPlayer, gameMode, matchConfig, localTurnHandoffPlayer } = get();
      if (!matchConfig.turnTimerEnabled || !game.turnDeadlineAt || Date.now() < game.turnDeadlineAt) return;
      if (gameMode === 'online_2p' && game.currentTurn !== localPlayer) return;
      if (gameMode === 'local_2p' && localTurnHandoffPlayer) return;

      let consumed = 0;
      let newState = game;
      const actingPlayer = game.currentTurn;

      for (const agent of [...newState.players[actingPlayer].agents]) {
        let currentAgent = newState.players[actingPlayer].agents.find(item => item.id === agent.id);
        while (currentAgent && currentAgent.actionsRemaining > 0) {
          const waitAction: GameAction = {
            id: makeActionId(),
            type: 'WAIT',
            owner: actingPlayer,
            agentId: currentAgent.id,
          };
          recordTrainingAction(newState, waitAction);
          newState = resolveSingleAction(newState, waitAction);
          consumed += 1;
          currentAgent = newState.players[actingPlayer].agents.find(item => item.id === agent.id);
        }
      }

      appendTerminalLines([
        `Turn timer expired. Consumed ${consumed} remaining action${consumed === 1 ? '' : 's'} as WAIT.`,
      ], 'system');
      finishLocalAction(game, newState, actingPlayer, get().selectedAgentId, true);
      set({
        turnTimeoutNotice: `${actingPlayer} ran out of time. Remaining actions were committed as WAIT and the mission advanced.`,
      });
    },

    openTraversalPicker: (type) => {
      if (get().guidedTutorialActive) {
        const step = currentTutorialStep();
        if (step?.expectedEvent === 'paradox-traverse') {
          if (!_tutorialLastTraverseTargetPeriod) {
            blockTutorialOperation('action:TRAVERSE');
            return;
          }
        } else {
          const tutorialEvent = getTutorialActionEvent({ type, agentId: '', owner: 'P1' });
          if (!tutorialEvent || !guardTutorialEvent(tutorialEvent)) return;
        }
      }
      const { game, localPlayer, selectedAgentId, aiTurnInProgress } = get();
      if (!canLocalOperate()) {
        set({ lastActionFeedback: 'Stand by. The hostile timeline is acting.' });
        return;
      }
      if (aiTurnInProgress) return;
      if (!selectedAgentId) return;

      const agent = game.players[localPlayer].agents.find(a => a.id === selectedAgentId);
      if (!agent || agent.actionsRemaining <= 0) return;
      const sourceCity = game.map.cities.get(agent.cityId);
      if (!sourceCity?.isNode || !sourceCity.nodeId) {
        set({ lastActionFeedback: 'Traversal requires standing on a shared node', pendingTraversalAction: null });
        return;
      }
      const hasDestination = (['PAST', 'PRESENT', 'FUTURE'] as TimePeriod[]).some(period =>
        period !== agent.currentPeriod && Boolean(getNodeCitiesForPeriod(game.map, sourceCity.nodeId!, period)?.destroyed === false),
      );
      if (!hasDestination) {
        set({ lastActionFeedback: 'This node has no linked destination timelines', pendingTraversalAction: null });
        return;
      }

      set({
        pendingTraversalAction: {
          type,
          agentId: selectedAgentId,
          owner: localPlayer,
        },
        tutorialTraversalLockedPeriod: currentTutorialStep()?.expectedEvent === 'paradox-traverse'
          ? _tutorialLastTraverseTargetPeriod
          : null,
        lastActionFeedback: null,
      });
    },

    closeTraversalPicker: () => set({ pendingTraversalAction: null, tutorialTraversalLockedPeriod: null }),

    confirmTraversalTarget: (targetPeriod) => {
      const { pendingTraversalAction, tutorialTraversalLockedPeriod } = get();
      if (!pendingTraversalAction) return;
      if (tutorialTraversalLockedPeriod && targetPeriod !== tutorialTraversalLockedPeriod) {
        get().playSoundEffect('invalid_buzz');
        set({
          lastActionFeedback: `Tutorial expects: choose ${tutorialTraversalLockedPeriod}`,
        });
        return;
      }

      set({ pendingTraversalAction: null, tutorialTraversalLockedPeriod: null });
      get().executeActionNow({
        type: pendingTraversalAction.type,
        agentId: pendingTraversalAction.agentId,
        owner: pendingTraversalAction.owner,
        targetPeriod,
      });
    },

    executeActionNow: (actionData, options) => {
      const {
        game, localPlayer, aiTurnInProgress, selectedAgentId, gameMode,
      } = get();

      if (game.winner || game.phase === 'GAME_OVER' || aiTurnInProgress) return;
      if (!canLocalOperate() && !options?.bypassCostsAndLimits) {
        set({ lastActionFeedback: gameMode === 'local_2p' ? 'Pass the console before issuing more orders.' : 'Stand by. It is the other operative’s turn.' });
        return;
      }
      if (get().awaitingNextRound && !options?.bypassCostsAndLimits) {
        set({ lastActionFeedback: 'Type pass to continue to the next turn window' });
        return;
      }

      const action: GameAction = { ...actionData, id: makeActionId() };
      const tutorialActionEvent = getTutorialActionEvent(action);
      if (get().guidedTutorialActive) {
        const allowFreeMove = action.type === 'MOVE' && isTutorialFreeMoveStep();
        if (!allowFreeMove && (!tutorialActionEvent || !guardTutorialEvent(tutorialActionEvent))) return;
      }
      const agent = game.players[action.owner].agents.find(a => a.id === action.agentId);
      if (!agent) return;

      if (action.type === 'CONTROL') {
        const city = game.map.cities.get(agent.cityId);
        if (city && city.controlledBy === action.owner) {
          get().playSoundEffect('invalid_buzz');
          set({
            lastActionFeedback: `${city.name} is already under your control`,
            pendingTraversalAction: null,
          });
          return;
        }
      }

      if (!options?.bypassCostsAndLimits && agent.actionsRemaining <= 0) {
        set({ lastActionFeedback: 'No actions remaining for this agent', pendingTraversalAction: null });
        return;
      }

      let newState = resolveSingleAction(game, action, options);
      if (newState === game) {
        set({ lastActionFeedback: 'Action could not be resolved', pendingTraversalAction: null });
        return;
      }
      pushUndoSnapshot(game);
      recordTrainingAction(game, action);
      const nextNotifications = newState.notifications.slice(game.notifications.length);
      const paradoxTriggered = nextNotifications.some(notification => notification.type === 'PARADOX_OCCURRED');
      emitActionEffectsFromResult(game, newState, action);
      if (get().guidedTutorialActive) {
        newState = resetTutorialPlayerResources(newState);
      }
      if (action.type === 'MOVE') {
        get().playSoundEffect('move_click');
      }
      if (action.type === 'TRAVERSE' && action.targetPeriod) {
        triggerTraversalEffect(agent.currentPeriod, action.targetPeriod);
      }

      if (options?.bypassCostsAndLimits && playerHasActionsLeft(newState, localPlayer)) {
        clearAutoNextTimer();
      }

      finishLocalAction(game, newState, action.owner, selectedAgentId, false);
      let resolvedTutorialEvent = tutorialActionEvent;
      if (action.type === 'TRAVERSE') {
        if (resolvedTutorialEvent === 'action:TRAVERSE' && action.targetPeriod) {
          _tutorialLastTraverseTargetPeriod = action.targetPeriod;
        }
        if (resolvedTutorialEvent === 'paradox-traverse' && !paradoxTriggered) {
          resolvedTutorialEvent = null;
        }
      }

      if (resolvedTutorialEvent) {
        const nextSelectedAgentId = retainSelectedAgent(newState, selectedAgentId, localPlayer);
        const nextSelectedAgent = nextSelectedAgentId
          ? newState.players[localPlayer].agents.find(agent => agent.id === nextSelectedAgentId) ?? null
          : null;
        markGuidedTutorialEvent(resolvedTutorialEvent, {
          game: newState,
          selectedAgentId: nextSelectedAgentId,
          selectedPeriod: nextSelectedAgent?.currentPeriod ?? get().selectedPeriod,
          settingsOpen: get().settingsOpen,
          intelFeedOpen: get().intelFeedOpen,
          terminalMode: get().terminalMode,
        });
      }
    },

    appendTerminalMessage: (text, kind = 'system') => {
      appendTerminalLines([text], kind);
    },

    submitTerminalInput: (input) => {
      const raw = input.trim();
      if (!raw) return;

      const {
        localPlayer,
        terminalAwaitingPassword,
        pendingPrivilegedInput,
        pendingPassConfirmation,
        sudoPassword,
        suMode,
      } = get();
      const prompt = terminalAwaitingPassword
        ? 'password:'
        : suMode
          ? `root@chronodox-${localPlayer.toLowerCase()}:~#`
          : `${localPlayer.toLowerCase()}@chronodox:~$`;

      appendTerminalLines([terminalAwaitingPassword ? `${prompt} ********` : `${prompt} ${raw}`], 'input');

      const tutorialInputEvent = getTutorialEventForTerminalInput(raw);
      if (get().guidedTutorialActive) {
        const step = currentTutorialStep();
        if (!step || !tutorialInputEvent || step.expectedEvent !== tutorialInputEvent) {
          blockTutorialOperation(tutorialInputEvent);
          return;
        }
      }

      if (pendingPassConfirmation) {
        set({ pendingPassConfirmation: false });
        if (['y', 'yes'].includes(raw.toLowerCase())) {
          get().advanceByNextCommand(false);
        } else {
          appendTerminalLines(['Pass cancelled.'], 'system');
        }
        return;
      }

      if (terminalAwaitingPassword) {
        if (pendingPrivilegedInput === '__passwd_current__') {
          if (raw !== sudoPassword) {
            set({ terminalAwaitingPassword: false, pendingPrivilegedInput: null });
            appendTerminalLines(['Current password incorrect.'], 'error');
            return;
          }

          set({ pendingPrivilegedInput: '__passwd_new__' });
          appendTerminalLines(['Enter new password:'], 'system');
          return;
        }

        if (pendingPrivilegedInput === '__passwd_new__') {
          if (raw.trim().length === 0) {
            set({ terminalAwaitingPassword: false, pendingPrivilegedInput: null });
            appendTerminalLines(['Password change cancelled.'], 'error');
            return;
          }

          set({
            sudoPassword: raw.trim(),
            terminalAwaitingPassword: false,
            pendingPrivilegedInput: null,
            sudoAuthenticated: false,
            suMode: false,
          });
          appendTerminalLines(['Root password updated.'], 'system');
          return;
        }

        if (raw !== sudoPassword) {
          set({ terminalAwaitingPassword: false, pendingPrivilegedInput: null });
          appendTerminalLines(['Authentication failed.'], 'error');
          return;
        }

        set({ terminalAwaitingPassword: false, sudoAuthenticated: true });

        if (pendingPrivilegedInput === '__su__') {
          set({ pendingPrivilegedInput: null, suMode: true });
          appendTerminalLines(['Root shell acquired.'], 'system');
          return;
        }

        set({ pendingPrivilegedInput: null });
        if (pendingPrivilegedInput) {
          const prefixed = pendingPrivilegedInput;
          if (!runShellReadableExpression(prefixed)) {
            const parsed = parseTerminalCommand(prefixed, currentContext());
            handleParsedCommand(parsed, currentContext(), { privileged: true, viaRootShell: get().suMode });
          }
        }
        return;
      }

      if (raw.toLowerCase() === 'su') {
        taintTrainingSession('su shell used');
        if (get().sudoAuthenticated) {
          set({ suMode: true });
          appendTerminalLines(['Root shell acquired.'], 'system');
        } else {
          set({ terminalAwaitingPassword: true, pendingPrivilegedInput: '__su__' });
          appendTerminalLines(['Root password required.'], 'system');
        }
        return;
      }

      const sudoPrefix = /^sudo\s+/i;
      if (sudoPrefix.test(raw)) {
        taintTrainingSession('sudo command used');
        const privilegedInput = raw.replace(sudoPrefix, '').trim();
        if (!privilegedInput) {
          appendTerminalLines(['sudo requires a command.'], 'error');
          return;
        }
        if (get().sudoAuthenticated) {
          if (!runShellReadableExpression(privilegedInput)) {
            const parsed = parseTerminalCommand(privilegedInput, currentContext());
            handleParsedCommand(parsed, currentContext(), { privileged: true, viaRootShell: get().suMode });
          }
          return;
        }

        set({ terminalAwaitingPassword: true, pendingPrivilegedInput: privilegedInput });
        appendTerminalLines([`[sudo] password for ${localPlayer}:`], 'system');
        return;
      }

      if (runShellReadableExpression(raw)) return;

      const parsed = parseTerminalCommand(raw, currentContext());
      handleParsedCommand(parsed, currentContext(), { privileged: suMode, viaRootShell: suMode });
      if (tutorialInputEvent && get().guidedTutorialActive) {
        markGuidedTutorialEvent(tutorialInputEvent);
      }
    },

    advanceByNextCommand: (_automatic = false) => {
      const { game, localPlayer, awaitingNextRound, gameMode } = get();

      if (get().pendingPassConfirmation) {
        set({ pendingPassConfirmation: false });
      }

      if (!canLocalOperate()) {
        set({ lastActionFeedback: gameMode === 'local_2p' ? 'Pass the console before issuing more orders.' : 'Stand by. It is the other operative’s turn.' });
        return;
      }

      if (awaitingNextRound || !playerHasActionsLeft(game, localPlayer)) {
        proceedAfterTurnEnd(game, game.currentTurn);
        return;
      }

      let consumed = 0;
      let newState = game;

      for (const agent of [...newState.players[localPlayer].agents]) {
        let currentAgent = newState.players[localPlayer].agents.find(item => item.id === agent.id);
        while (currentAgent && currentAgent.actionsRemaining > 0) {
          const waitAction: GameAction = {
            id: makeActionId(),
            type: 'WAIT',
            owner: localPlayer,
            agentId: currentAgent.id,
          };
          recordTrainingAction(newState, waitAction);
          newState = resolveSingleAction(newState, waitAction);
          consumed += 1;
          currentAgent = newState.players[localPlayer].agents.find(item => item.id === agent.id);
        }
      }

      appendTerminalLines([`Consumed ${consumed} remaining action${consumed === 1 ? '' : 's'} as WAIT.`], 'system');
      finishLocalAction(game, newState, localPlayer, get().selectedAgentId, true);
    },

    undoLastTurnAction: () => {
      const {
        turnUndoStack, gameMode, guidedTutorialActive,
      } = get();

      if (guidedTutorialActive) {
        set({ lastActionFeedback: 'Undo is disabled during guided tutorial.' });
        return;
      }

      if (!canLocalOperate()) {
        set({ lastActionFeedback: gameMode === 'local_2p' ? 'Pass the console before issuing more orders.' : 'Stand by. It is the other operative’s turn.' });
        return;
      }

      const snapshot = turnUndoStack[turnUndoStack.length - 1];
      if (!snapshot) {
        set({ lastActionFeedback: 'No undo available in this turn window.' });
        return;
      }

      clearAutoNextTimer();
      set({
        game: cloneTutorialGameState(snapshot.game),
        selectedAgentId: snapshot.selectedAgentId,
        selectedPeriod: snapshot.selectedPeriod,
        inspectedCityId: snapshot.inspectedCityId,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        pendingPassConfirmation: false,
        awaitingNextRound: false,
        autoNextDeadline: null,
        localTurnHandoffPlayer: null,
        turnTimeoutNotice: null,
        lastActionFeedback: 'Last action undone.',
        turnUndoStack: turnUndoStack.slice(0, -1).map(cloneTurnUndoSnapshot),
      });
      appendTerminalLines(['Reverted the most recent in-turn action.'], 'system');
    },

    switchLocalPlayer: () => {
      if (get().gameMode === 'online_2p') {
        set({ lastActionFeedback: 'Online rooms pin each operative to their own terminal.' });
        return;
      }
      if (!get().debugLocalSwitchEnabled) {
        set({ lastActionFeedback: 'Manual handoff switching is locked. Use sudo handoff unlock in the terminal for testing.' });
        return;
      }
      if (get().guidedTutorialActive) {
        blockTutorialOperation(null);
        return;
      }
      const { localPlayer } = get();
      swapLocalShellSession(localPlayer === 'P1' ? 'P2' : 'P1');
      set({
        selectedAgentId: null,
        inspectedCityId: null,
        pendingTraversalAction: null,
        tutorialTraversalLockedPeriod: null,
        turnUndoStack: [],
        aiActivePeriod: null,
        soundEffectCue: { id: 'ui_click', token: ++_soundCueCounter },
      });
    },
  };
});

export function useTerminalSuggestions(input: string) {
  const game = useGameStore(state => state.game);
  const localPlayer = useGameStore(state => state.localPlayer);
  const selectedAgentId = useGameStore(state => state.selectedAgentId);
  const selectedPeriod = useGameStore(state => state.selectedPeriod);
  return buildTerminalSuggestions(input, { game, localPlayer, selectedAgentId, selectedPeriod });
}
