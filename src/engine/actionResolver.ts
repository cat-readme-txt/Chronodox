// ============================================================
// CHRONODOX — Action Resolver
// Simultaneous action resolution engine
// ============================================================

import type {
  GameState, GameAction, Agent, PlayerId, TimePeriod, Notification, City,
} from '../types/game';
import { INTEL_COSTS, MAX_AGENTS_PER_PERIOD, TIME_ORDER } from '../types/game';
import { getConnectedCities, getNodeSiblings } from './mapGenerator';
import { spendIntel, canAfford } from './intelSystem';
import { applyCausalCollapseRules } from './collapseRules';
import { getAiDifficultyMultiplier, getAiDifficultyProfile } from './aiDifficulty';
import { extractHybridFeaturesFromRuntime, getHybridPolicyArtifact, scoreWithHybridPolicy } from './hybridPolicy';
import { getRewardableTimelineOwner, isAgentForcedExposed } from './timelineOccupation';

export interface ResolveActionOptions {
  bypassCostsAndLimits?: boolean;
  skipActionConsumption?: boolean;
}

let _agentCounter = 1000;
function newAgentId() { return `agent_${++_agentCounter}`; }
function newNotifId() { return `notif_${Date.now()}_${Math.random().toString(36).slice(2)}`; }

function pushNotif(
  state: GameState,
  notif: Omit<Notification, 'id' | 'round'>
): GameState {
  const full: Notification = { ...notif, id: newNotifId(), round: state.round };
  return { ...state, notifications: [...state.notifications, full] };
}

const INTEL_OPERATION_LABELS: Partial<Record<GameAction['type'], string>> = {
  TRAVERSE: 'traversal',
  LOCATE: 'locate sweep',
  STRIKE_REPORT: 'strike report',
  DEEP_COVER: 'deep cover',
  PREPARE_ACTION: 'prepare action',
  ENCRYPTION: 'encryption',
  RAPID_RECON: 'rapid recon',
  MULTI_TIMELINE_STRIKE: 'multi-strike upgrade',
};

function getOpponent(player: PlayerId): PlayerId {
  return player === 'P1' ? 'P2' : 'P1';
}

function rankAiCandidates(
  candidates: Array<{ score: number; action: GameAction }>,
  difficulty: string | null | undefined,
) {
  const profile = getAiDifficultyProfile(difficulty);
  const remaining = [...candidates].sort((left, right) => (
    (right.score + (Math.random() * profile.rankingNoise))
    - (left.score + (Math.random() * profile.rankingNoise))
  ));

  if (profile.sampleWindow <= 1) return remaining;

  const ordered: Array<{ score: number; action: GameAction }> = [];
  while (remaining.length > 0) {
    const windowSize = Math.min(profile.sampleWindow, remaining.length);
    const weights = Array.from({ length: windowSize }, (_, index) => Math.pow(profile.sampleDecay, index));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = Math.random() * totalWeight;
    let choiceIndex = 0;

    for (let index = 0; index < weights.length; index += 1) {
      roll -= weights[index];
      if (roll <= 0) {
        choiceIndex = index;
        break;
      }
    }

    ordered.push(remaining.splice(choiceIndex, 1)[0]);
  }

  return ordered;
}

function getCityNodeId(state: GameState, cityId: string) {
  return state.map.cities.get(cityId)?.nodeId;
}

function shareExactOrNodePosition(state: GameState, aCityId: string, bCityId: string) {
  if (aCityId === bCityId) return true;
  const aNode = getCityNodeId(state, aCityId);
  const bNode = getCityNodeId(state, bCityId);
  return Boolean(aNode && bNode && aNode === bNode);
}

function setVisionKnowledge(
  state: GameState,
  viewer: PlayerId,
  owner: PlayerId,
  agentId: string,
  knowledge: { revealed?: boolean; lastKnownCityId?: string | null; possibleCityIds?: string[] }
): GameState {
  const player = state.players[owner];
  const targetAgent = player.agents.find(agent => agent.id === agentId);
  if (!targetAgent) {
    const vision = { ...state.vision };
    const viewerVision = { ...vision[viewer] };
    viewerVision.revealedAgentIds = new Set([...viewerVision.revealedAgentIds].filter(id => id !== agentId));
    const nextPossible = new Map(viewerVision.possiblePositions);
    nextPossible.delete(agentId);
    viewerVision.possiblePositions = nextPossible;
    vision[viewer] = viewerVision;
    return { ...state, vision };
  }

  const nextAgent: Agent = {
    ...targetAgent,
    lastKnownCityId: knowledge.lastKnownCityId ?? targetAgent.lastKnownCityId,
    possibleCityIds: knowledge.possibleCityIds ?? targetAgent.possibleCityIds,
  };

  const vision = { ...state.vision };
  const viewerVision = { ...vision[viewer] };
  const revealedSet = new Set(viewerVision.revealedAgentIds);
  if (knowledge.revealed) revealedSet.add(agentId);
  else revealedSet.delete(agentId);
  viewerVision.revealedAgentIds = revealedSet;
  const nextPossible = new Map(viewerVision.possiblePositions);
  nextPossible.set(agentId, knowledge.possibleCityIds ?? nextAgent.possibleCityIds);
  viewerVision.possiblePositions = nextPossible;
  vision[viewer] = viewerVision;

  return {
    ...state,
    vision,
    players: {
      ...state.players,
      [owner]: {
        ...player,
        agents: player.agents.map(agent => agent.id === agentId ? nextAgent : agent),
      },
    },
  };
}

function revealAgentToViewer(state: GameState, viewer: PlayerId, owner: PlayerId, agentId: string, cityId: string): GameState {
  return setVisionKnowledge(state, viewer, owner, agentId, {
    revealed: true,
    lastKnownCityId: cityId,
    possibleCityIds: [cityId],
  });
}

function getPotentialExpansionCities(
  state: GameState,
  sourceCityIds: string[],
  viewer: PlayerId,
  allowViewerControlledCities = false,
  mode: 'standard' | 'traversal' = 'standard',
): string[] {
  const expanded = new Set<string>();

  for (const cityId of sourceCityIds) {
    const city = state.map.cities.get(cityId);
    if (!city || city.destroyed) continue;
    if (mode === 'traversal') {
      if (city.isNode && city.nodeId) {
        for (const siblingId of state.map.nodes.get(city.nodeId) ?? []) {
          if (siblingId === cityId) continue;
          const sibling = state.map.cities.get(siblingId);
          if (!sibling || sibling.destroyed || !sibling.isNode) continue;
          if (!allowViewerControlledCities && sibling.controlledBy === viewer) continue;
          expanded.add(siblingId);
        }
      }
      continue;
    }

    if (allowViewerControlledCities || city.controlledBy !== viewer) {
      expanded.add(cityId);
    }

    for (const nextCityId of getConnectedCities(state.map, cityId)) {
      const nextCity = state.map.cities.get(nextCityId);
      if (!nextCity || nextCity.destroyed) continue;
      if (!allowViewerControlledCities && nextCity.controlledBy === viewer) continue;
      expanded.add(nextCityId);
    }
  }

  return [...expanded];
}

function updateHiddenKnowledgeAfterAction(
  previousState: GameState,
  nextState: GameState,
  owner: PlayerId,
  agentId: string,
  actionType: GameAction['type']
): GameState {
  const viewer = getOpponent(owner);
  const expansionMode: 'standard' | 'traversal' =
    actionType === 'TRAVERSE'
      ? 'traversal'
      : 'standard';
  const previousAgent = previousState.players[owner].agents.find(agent => agent.id === agentId);
  const currentAgent = nextState.players[owner].agents.find(agent => agent.id === agentId);
  if (!previousAgent || !currentAgent) {
    return setVisionKnowledge(nextState, viewer, owner, agentId, { revealed: false, possibleCityIds: [] });
  }

  const currentCity = nextState.map.cities.get(currentAgent.cityId);
  if (!currentCity || isAgentForcedExposed(currentAgent) || !currentAgent.cover) {
    return revealAgentToViewer(nextState, viewer, owner, agentId, currentAgent.cityId);
  }

  if (actionType === 'CONTROL') {
    return revealAgentToViewer(nextState, viewer, owner, agentId, currentAgent.cityId);
  }

  if (currentCity.controlledBy === viewer) {
    if (currentAgent.deepCoverActive) {
      const nextPossibleCityIds = getPotentialExpansionCities(
        previousState,
        [previousAgent.lastKnownCityId ?? previousAgent.cityId],
        viewer,
        previousState.players[owner].deepCoverKnownToOpponent,
        expansionMode,
      );
      return setVisionKnowledge(nextState, viewer, owner, agentId, {
        revealed: false,
        lastKnownCityId: previousAgent.lastKnownCityId ?? previousAgent.cityId,
        possibleCityIds: nextPossibleCityIds,
      });
    }
    return revealAgentToViewer(nextState, viewer, owner, agentId, currentAgent.cityId);
  }

  const previousVision = previousState.vision[viewer];
  const basePositions = previousVision.revealedAgentIds.has(agentId)
    ? [previousAgent.cityId]
    : (previousVision.possiblePositions.get(agentId) ?? previousAgent.possibleCityIds ?? []);
  const fallbackBase = basePositions.length > 0
    ? basePositions
    : [previousAgent.lastKnownCityId ?? previousAgent.cityId];
  const nextPossibleCityIds = getPotentialExpansionCities(
    previousState,
    fallbackBase,
    viewer,
    previousState.players[owner].deepCoverKnownToOpponent,
    expansionMode,
  );

  return setVisionKnowledge(nextState, viewer, owner, agentId, {
    revealed: false,
    lastKnownCityId: previousAgent.lastKnownCityId ?? previousAgent.cityId,
    possibleCityIds: nextPossibleCityIds,
  });
}

function pruneVisionForMissingAgents(state: GameState): GameState {
  const allAgentIds = new Set([...state.players.P1.agents, ...state.players.P2.agents].map(agent => agent.id));
  const vision = { ...state.vision };
  for (const viewer of ['P1', 'P2'] as PlayerId[]) {
    const viewerVision = { ...vision[viewer] };
    viewerVision.revealedAgentIds = new Set([...viewerVision.revealedAgentIds].filter(id => allAgentIds.has(id)));
    const nextPossible = new Map<string, string[]>();
    for (const [agentId, cityIds] of viewerVision.possiblePositions.entries()) {
      if (allAgentIds.has(agentId)) nextPossible.set(agentId, cityIds.filter(cityId => state.map.cities.has(cityId)));
    }
    viewerVision.possiblePositions = nextPossible;
    vision[viewer] = viewerVision;
  }
  return { ...state, vision };
}

function revealOpponentsAtContactNode(state: GameState, viewer: PlayerId, owner: PlayerId, sourceCityId: string): GameState {
  let newState = state;
  const opponent = getOpponent(owner);
  const sourceCity = state.map.cities.get(sourceCityId);
  if (!sourceCity) return state;
  const enemyMatches = newState.players[opponent].agents.filter(enemy => shareExactOrNodePosition(newState, sourceCityId, enemy.cityId));
  for (const enemy of enemyMatches) {
    newState = revealAgentToViewer(newState, viewer, opponent, enemy.id, enemy.cityId);
  }
  return newState;
}

function applyGuaranteedVisionForViewer(state: GameState, viewer: PlayerId): GameState {
  let newState = state;
  const opponent = getOpponent(viewer);
  const viewerAgents = newState.players[viewer].agents;

  for (const enemy of newState.players[opponent].agents) {
    const enemyCity = newState.map.cities.get(enemy.cityId);
    if (!enemyCity) continue;

    const inControlledCity = enemyCity.controlledBy === viewer && !enemy.deepCoverActive;
    const sharesAgentPosition = viewerAgents.some(agent => shareExactOrNodePosition(newState, agent.cityId, enemy.cityId));
    const forcedExposure = isAgentForcedExposed(enemy);

    if (inControlledCity || sharesAgentPosition || forcedExposure) {
      newState = revealAgentToViewer(newState, viewer, opponent, enemy.id, enemy.cityId);
      continue;
    }

    const currentPossible = newState.vision[viewer].possiblePositions.get(enemy.id) ?? enemy.possibleCityIds;
    const filteredPossible = currentPossible.filter(cityId => {
      const possibleCity = newState.map.cities.get(cityId);
      if (!possibleCity || possibleCity.destroyed) return false;
      if (possibleCity.controlledBy === viewer && !newState.players[opponent].deepCoverKnownToOpponent) return false;
      if (viewerAgents.some(agent => shareExactOrNodePosition(newState, agent.cityId, cityId))) return false;
      return true;
    });

    if (filteredPossible.length !== currentPossible.length) {
      newState = setVisionKnowledge(newState, viewer, opponent, enemy.id, {
        revealed: false,
        lastKnownCityId: enemy.lastKnownCityId,
        possibleCityIds: filteredPossible,
      });
    }
  }

  return newState;
}

function pushIntelOperationNotif(state: GameState, owner: PlayerId, actionType: GameAction['type']): GameState {
  const label = INTEL_OPERATION_LABELS[actionType];
  if (!label) return state;
  const opponent = getOpponent(owner);
  const encrypted = state.players[owner].encryptionActive;
  let newState = pushNotif(state, {
    type: 'INTEL_OPERATION',
    message: `${owner} spent intel on ${label}`,
    forPlayer: owner,
  });
  newState = pushNotif(newState, {
    type: 'INTEL_OPERATION',
    message: encrypted ? `${owner} spent intel on an operation` : `${owner} spent intel on ${label}`,
    forPlayer: opponent,
  });
  return newState;
}

// ─── COMPUTE POSSIBLE POSITIONS ─────────────────────────────

function computePossiblePositions(agent: Agent, map: GameState['map']): string[] {
  if (!agent.cover) return [agent.cityId]; // revealed
  const reachable = new Set<string>([agent.cityId]);
  const connected = getConnectedCities(map, agent.cityId);
  for (const c of connected) reachable.add(c);
  return [...reachable];
}

function getPeriodIndex(period: TimePeriod) {
  return TIME_ORDER.indexOf(period);
}

function findTraversalTargetCity(state: GameState, sourceCity: City, targetPeriod: TimePeriod): City | undefined {
  if (!sourceCity.nodeId) return undefined;
  const nodeIds = state.map.nodes.get(sourceCity.nodeId) ?? [];
  return nodeIds
    .map(id => state.map.cities.get(id)!)
    .find(c => c.period === targetPeriod && !c.destroyed);
}

function hasSameOwnerDuplicateAtCityPeriod(state: GameState, owner: PlayerId, cityId: string): boolean {
  const counts = new Map<TimePeriod, number>();
  for (const agent of state.players[owner].agents) {
    if (agent.cityId !== cityId) continue;
    counts.set(agent.period, (counts.get(agent.period) ?? 0) + 1);
  }
  return [...counts.values()].some(count => count > 1);
}

function compareAgentOriginPeriodDesc(a: Agent, b: Agent) {
  return getPeriodIndex(b.period) - getPeriodIndex(a.period);
}

function exposeAgentToOpponent(state: GameState, owner: PlayerId, agentId: string, cityId?: string): GameState {
  const opponent = owner === 'P1' ? 'P2' : 'P1';
  const player = state.players[owner];
  const targetAgent = player.agents.find(agent => agent.id === agentId);
  if (!targetAgent) return state;

  const exposedAgent: Agent = {
    ...targetAgent,
    cover: false,
    lastKnownCityId: cityId ?? targetAgent.cityId,
  };

  const vision = { ...state.vision };
  const opponentVision = { ...vision[opponent] };
  opponentVision.revealedAgentIds = new Set([...opponentVision.revealedAgentIds, agentId]);
  vision[opponent] = opponentVision;

  return {
    ...state,
    vision,
    players: {
      ...state.players,
      [owner]: {
        ...player,
        agents: player.agents.map(agent => agent.id === agentId ? exposedAgent : agent),
      },
    },
  };
}

function applyParadoxAtCity(state: GameState, cityId: string): GameState {
  const sourceCity = state.map.cities.get(cityId);
  if (!sourceCity || sourceCity.destroyed) return state;

  const city = { ...sourceCity, destroyed: true };
  const newCities = new Map(state.map.cities);
  newCities.set(cityId, city);

  const newRoutes = state.map.routes.map(r =>
    r.from === cityId || r.to === cityId ? { ...r, destroyed: true } : r
  );

  let newState: GameState = {
    ...state,
    map: { ...state.map, cities: newCities, routes: newRoutes },
    players: {
      P1: {
        ...state.players.P1,
        agents: state.players.P1.agents.filter(a => a.cityId !== cityId),
      },
      P2: {
        ...state.players.P2,
        agents: state.players.P2.agents.filter(a => a.cityId !== cityId),
      },
    },
  };

  newState = pushNotif(newState, {
    type: 'PARADOX_OCCURRED',
    message: `PARADOX at ${city.name}! City and all connected routes destroyed.`,
    forPlayer: 'BOTH',
  });

  return newState;
}

// ─── PARADOX CHECK ──────────────────────────────────────────

function checkAndApplyParadoxes(state: GameState): GameState {
  let newState = { ...state };

  const cityIds = [...newState.map.cities.keys()];
  for (const cityId of cityIds) {
    const city = newState.map.cities.get(cityId);
    if (!city || city.destroyed) continue;

    for (const pid of ['P1', 'P2'] as PlayerId[]) {
      if (hasSameOwnerDuplicateAtCityPeriod(newState, pid, cityId)) {
        newState = applyParadoxAtCity(newState, cityId);
        break;
      }
    }
  }

  return newState;
}

function hasAccessToAction(state: GameState, owner: PlayerId, period: TimePeriod, cost: number, options?: ResolveActionOptions) {
  return options?.bypassCostsAndLimits ? true : canAfford(state, owner, period, cost);
}

function spendActionIntel(state: GameState, owner: PlayerId, period: TimePeriod, cost: number, options?: ResolveActionOptions) {
  return options?.bypassCostsAndLimits ? state : spendIntel(state, owner, period, cost);
}

function normalizeForcedExposure(agent: Agent): Agent {
  if (agent.deepCoverActive || agent.forcedExposurePeriod !== agent.currentPeriod) {
    return { ...agent, forcedExposurePeriod: null };
  }
  if (isAgentForcedExposed(agent)) {
    return {
      ...agent,
      cover: false,
      lastKnownCityId: agent.cityId,
    };
  }
  return agent;
}

function syncForcedExposureForAgent(state: GameState, owner: PlayerId, agentId: string): GameState {
  const player = state.players[owner];
  const agent = player.agents.find(item => item.id === agentId);
  if (!agent) return state;

  const normalized = normalizeForcedExposure(agent);
  let nextState = state;
  if (normalized !== agent) {
    nextState = {
      ...state,
      players: {
        ...state.players,
        [owner]: {
          ...player,
          agents: player.agents.map(item => item.id === agentId ? normalized : item),
        },
      },
    };
  }

  if (isAgentForcedExposed(normalized)) {
    return exposeAgentToOpponent(nextState, owner, agentId, normalized.cityId);
  }

  return nextState;
}

// ─── TEMPORAL STABILITY RULE ────────────────────────────────

function enforceTemporalStability(state: GameState, pid: PlayerId, period: TimePeriod): GameState {
  const agents = state.players[pid].agents.filter(a => a.currentPeriod === period);
  if (agents.length <= MAX_AGENTS_PER_PERIOD) return state;

  // Remove oldest agent (lowest createdAt)
  const sorted = [...agents].sort((a, b) => a.createdAt - b.createdAt);
  const toRemove = sorted[0];
  const newAgents = state.players[pid].agents.filter(a => a.id !== toRemove.id);
  return {
    ...state,
    players: {
      ...state.players,
      [pid]: { ...state.players[pid], agents: newAgents },
    },
  };
}

// ─── INDIVIDUAL ACTION HANDLERS ─────────────────────────────

function resolveMove(state: GameState, action: GameAction): GameState {
  const { agentId, owner, targetCityId } = action;
  if (!targetCityId) return state;

  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;

  const connected = getConnectedCities(state.map, agent.cityId);
  if (!connected.includes(targetCityId)) return state; // invalid move

  const targetCity = state.map.cities.get(targetCityId);
  if (!targetCity || targetCity.destroyed) return state;

  // Update agent position
  const updatedAgent: Agent = {
    ...agent,
    cityId: targetCityId,
    lastKnownCityId: agent.cover ? agent.lastKnownCityId : targetCityId,
    cover: true, // moving restores cover
    possibleCityIds: [],
  };

  // If landing on opponent-controlled city, reveal position
  let revealedAgent = updatedAgent;
  if (targetCity.controlledBy && targetCity.controlledBy !== owner && !agent.deepCoverActive) {
    revealedAgent = { ...updatedAgent, cover: false, lastKnownCityId: targetCityId };
  }
  revealedAgent = normalizeForcedExposure(revealedAgent);

  const newAgents = state.players[owner].agents.map(a => a.id === agentId ? revealedAgent : a);
  let newState = {
    ...state,
    players: {
      ...state.players,
      [owner]: { ...state.players[owner], agents: newAgents },
    },
  };

  if (targetCity.controlledBy && targetCity.controlledBy !== owner && !agent.deepCoverActive) {
    newState = exposeAgentToOpponent(newState, owner, agentId, targetCityId);
  }
  newState = syncForcedExposureForAgent(newState, owner, agentId);

  if (newState.players[owner].rapidReconActive) {
    newState = revealOpponentsAtContactNode(newState, owner, owner, targetCityId);
  }

  if (hasSameOwnerDuplicateAtCityPeriod(newState, owner, targetCityId)) {
    newState = applyParadoxAtCity(newState, targetCityId);
  }

  return newState;
}

function resolveWait(state: GameState, action: GameAction): GameState {
  const { agentId, owner } = action;
  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;

  const updatedAgent: Agent = {
    ...agent,
    cover: true,
    lastKnownCityId: agent.cityId,
    possibleCityIds: computePossiblePositions(agent, state.map),
  };

  const newAgents = state.players[owner].agents.map(a => a.id === agentId ? updatedAgent : a);
  return syncForcedExposureForAgent({
    ...state,
    players: { ...state.players, [owner]: { ...state.players[owner], agents: newAgents } },
  }, owner, agentId);
}

function resolveControl(state: GameState, action: GameAction): GameState {
  const { agentId, owner } = action;
  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;

  const newCities = new Map(state.map.cities);
  const city = newCities.get(agent.cityId);
  if (!city || city.destroyed) return state;

  newCities.set(city.id, { ...city, controlledBy: owner });

  let newState = {
    ...state,
    map: { ...state.map, cities: newCities },
  };

  newState = exposeAgentToOpponent(newState, owner, agentId, city.id);
  newState = revealOpponentsAtContactNode(newState, owner, owner, city.id);
  newState = syncForcedExposureForAgent(newState, owner, agentId);

  newState = pushNotif(newState, {
    type: 'CITY_CONTROLLED',
    message: `${owner} captured ${city.name} (${city.period})`,
    forPlayer: 'BOTH',
  });

  return newState;
}

function resolveStrike(state: GameState, action: GameAction): GameState {
  const { agentId, owner } = action;
  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;

  const opponent = owner === 'P1' ? 'P2' : 'P1';
  const sourceCity = state.map.cities.get(agent.cityId);
  if (!sourceCity) return state;

  let newState = state;
  const targetCityIds = state.players[owner].multiTimelineStrikeActive && sourceCity.nodeId
    ? (state.map.nodes.get(sourceCity.nodeId) ?? []).filter(cityId => {
        const city = state.map.cities.get(cityId);
        return Boolean(city && !city.destroyed);
      })
    : [sourceCity.id];

  const killedAgents: Agent[] = [];
  for (const cityId of targetCityIds) {
    const enemyAgentsAtCity = newState.players[opponent].agents
      .filter(a => a.cityId === cityId)
      .sort(compareAgentOriginPeriodDesc);

    if (enemyAgentsAtCity.length === 0) continue;
    const killed = enemyAgentsAtCity[0];
    killedAgents.push(killed);
    newState.players[opponent] = {
      ...newState.players[opponent],
      agents: newState.players[opponent].agents.filter(a => a.id !== killed.id),
    };
  }

  if (killedAgents.length > 0) {
    const label = state.players[owner].multiTimelineStrikeActive ? 'MULTI-DIMENSIONAL STRIKE' : 'STRIKE';
    newState = pushNotif(newState, {
      type: 'AGENT_ELIMINATED',
      message: `${owner} ${label}: ${killedAgents.length} enemy agent${killedAgents.length === 1 ? '' : 's'} eliminated in ${agent.currentPeriod}`,
      forPlayer: 'BOTH',
    });

    if (state.players[opponent].strikeReportActive) {
      const striker = state.players[owner].agents.find(a => a.id === agentId);
      if (striker) {
        newState = exposeAgentToOpponent(newState, owner, agentId, striker.cityId);
      }
    }
  } else {
    // No enemy hit — still notify
    newState = pushNotif(newState, {
      type: 'STRIKE_OCCURRED',
      message: `Strike occurred in ${agent.currentPeriod} (missed)`,
      forPlayer: 'BOTH',
    });
  }

  return applyCausalCollapseRules(newState);
}

function resolveTraverse(state: GameState, action: GameAction, options?: ResolveActionOptions): GameState {
  const { agentId, owner, targetPeriod } = action;
  if (!targetPeriod) return state;

  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;
  if (agent.currentPeriod === targetPeriod) return state;

  const sourceCity = state.map.cities.get(agent.cityId);
  if (!sourceCity?.isNode || !sourceCity.nodeId) return state;

  const cost = INTEL_COSTS.TRAVERSE;
  if (!hasAccessToAction(state, owner, agent.currentPeriod, cost, options)) return state;

  const targetCity = findTraversalTargetCity(state, sourceCity, targetPeriod);
  if (!targetCity) return state;

  let newState = spendActionIntel(state, owner, agent.currentPeriod, cost, options);
  const opponent = getOpponent(owner);
  const movingForward = getPeriodIndex(targetPeriod) > getPeriodIndex(agent.currentPeriod);
  const occupiedByOpponent = getRewardableTimelineOwner(state, targetPeriod) === opponent;
  const enteredUnderDeepCover = agent.deepCoverActive;

  if (movingForward) {
    const newAgent: Agent = {
      id: newAgentId(),
      owner,
      period: agent.period,
      currentPeriod: targetPeriod,
      cityId: targetCity.id,
      isPastAgent: false,
      cover: true,
      lastKnownCityId: null,
      possibleCityIds: [targetCity.id],
      actionsRemaining: 0,
      deepCoverActive: agent.deepCoverActive,
      forcedExposurePeriod: occupiedByOpponent && !enteredUnderDeepCover ? targetPeriod : null,
      createdAt: state.round,
    };

    newState.players[owner] = {
      ...newState.players[owner],
      agents: [...newState.players[owner].agents, newAgent],
    };

    if (hasSameOwnerDuplicateAtCityPeriod(newState, owner, targetCity.id)) {
      newState = applyParadoxAtCity(newState, targetCity.id);
    } else {
      newState = enforceTemporalStability(newState, owner, targetPeriod);
    }
  } else {
    newState.players[owner] = {
      ...newState.players[owner],
      agents: newState.players[owner].agents.map(a =>
        a.id === agentId
          ? {
              ...a,
              cityId: targetCity.id,
              currentPeriod: targetPeriod,
              cover: occupiedByOpponent && !enteredUnderDeepCover ? false : true,
              lastKnownCityId: a.cover ? a.lastKnownCityId : targetCity.id,
              possibleCityIds: [],
              forcedExposurePeriod: occupiedByOpponent && !enteredUnderDeepCover ? targetPeriod : null,
            }
          : a
      ),
    };

    if (hasSameOwnerDuplicateAtCityPeriod(newState, owner, targetCity.id)) {
      newState = applyParadoxAtCity(newState, targetCity.id);
    }
  }

  // Notify opponent (no timeline info)
  newState = pushNotif(newState, {
    type: 'TRAVERSAL_DETECTED',
    message: `Traversal detected at ${sourceCity.nodeId} toward ${targetPeriod}`,
    forPlayer: owner === 'P1' ? 'P2' : 'P1',
    nodeId: sourceCity.nodeId,
    period: targetPeriod,
  });
  newState = pushNotif(newState, {
    type: 'TRAVERSAL_DETECTED',
    message: `${owner} initiated traversal at ${sourceCity.nodeId} toward ${targetPeriod}`,
    forPlayer: owner,
    nodeId: sourceCity.nodeId,
    period: targetPeriod,
  });

  const landingCity = movingForward ? targetCity.id : targetCity.id;
  if (newState.players[owner].rapidReconActive) {
    newState = revealOpponentsAtContactNode(newState, owner, owner, landingCity);
  }

  const landedAgentId = movingForward
    ? newState.players[owner].agents[newState.players[owner].agents.length - 1]?.id
    : agentId;
  if (landedAgentId) {
    newState = syncForcedExposureForAgent(newState, owner, landedAgentId);
  }

  return newState;
}

function resolveLocate(state: GameState, action: GameAction, options?: ResolveActionOptions): GameState {
  const { agentId, owner } = action;
  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;

  const cost = INTEL_COSTS.LOCATE;
  if (!hasAccessToAction(state, owner, agent.currentPeriod, cost, options)) return state;

  let newState = spendActionIntel(state, owner, agent.currentPeriod, cost, options);
  const opponent = owner === 'P1' ? 'P2' : 'P1';

  // Reveal all enemy agents in same timeline (unless deep cover)
  const revealed = newState.players[opponent].agents
    .filter(a => a.currentPeriod === agent.currentPeriod && !a.deepCoverActive)
    .map(a => a.id);

  const vision = { ...newState.vision };
  const myVision = { ...vision[owner] };
  myVision.revealedAgentIds = new Set([...myVision.revealedAgentIds, ...revealed]);
  vision[owner] = myVision;
  newState.vision = vision;

  newState = pushIntelOperationNotif(newState, owner, action.type);

  return newState;
}

function resolveDeepCover(state: GameState, action: GameAction, options?: ResolveActionOptions): GameState {
  const { agentId, owner } = action;
  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;

  const cost = INTEL_COSTS.DEEP_COVER;
  if (!hasAccessToAction(state, owner, agent.currentPeriod, cost, options)) return state;

  let newState = spendActionIntel(state, owner, agent.currentPeriod, cost, options);
  const updatedAgent = { ...agent, deepCoverActive: true, forcedExposurePeriod: null };
  newState.players[owner] = {
    ...newState.players[owner],
    agents: newState.players[owner].agents.map(a => a.id === agentId ? updatedAgent : a),
  };

  newState = pushIntelOperationNotif(newState, owner, action.type);

  return syncForcedExposureForAgent(newState, owner, agentId);
}

function resolvePrepareAction(state: GameState, action: GameAction, options?: ResolveActionOptions): GameState {
  const { agentId, owner } = action;
  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;

  const cost = INTEL_COSTS.PREPARE_ACTION;
  if (!hasAccessToAction(state, owner, agent.currentPeriod, cost, options)) return state;

  let newState = spendActionIntel(state, owner, agent.currentPeriod, cost, options);
  newState.players[owner] = {
    ...newState.players[owner],
    extraActionsNextRound: newState.players[owner].extraActionsNextRound + 1,
  };

  newState = pushIntelOperationNotif(newState, owner, action.type);

  return newState;
}

function resolveStrikeReport(state: GameState, action: GameAction, options?: ResolveActionOptions): GameState {
  const { agentId, owner } = action;
  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;

  const cost = INTEL_COSTS.STRIKE_REPORT;
  if (!hasAccessToAction(state, owner, agent.currentPeriod, cost, options)) return state;

  let newState = spendActionIntel(state, owner, agent.currentPeriod, cost, options);
  newState.players[owner] = {
    ...newState.players[owner],
    strikeReportActive: true,
  };
  newState = pushIntelOperationNotif(newState, owner, action.type);
  return newState;
}

function resolveEncryption(state: GameState, action: GameAction, options?: ResolveActionOptions): GameState {
  const { agentId, owner } = action;
  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;

  const cost = INTEL_COSTS.ENCRYPTION;
  if (!hasAccessToAction(state, owner, agent.currentPeriod, cost, options)) return state;

  let newState = spendActionIntel(state, owner, agent.currentPeriod, cost, options);
  newState.players[owner] = {
    ...newState.players[owner],
    encryptionActive: true,
  };
  newState = pushIntelOperationNotif(newState, owner, action.type);
  return newState;
}

function resolveRapidRecon(state: GameState, action: GameAction, options?: ResolveActionOptions): GameState {
  const { agentId, owner } = action;
  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;

  const cost = INTEL_COSTS.RAPID_RECON;
  if (!hasAccessToAction(state, owner, agent.currentPeriod, cost, options)) return state;

  let newState = spendActionIntel(state, owner, agent.currentPeriod, cost, options);
  newState.players[owner] = {
    ...newState.players[owner],
    rapidReconActive: true,
  };
  newState = pushIntelOperationNotif(newState, owner, action.type);
  return newState;
}

function resolveMultiTimelineStrike(state: GameState, action: GameAction): GameState {
  const { agentId, owner } = action;
  const agent = state.players[owner].agents.find(a => a.id === agentId);
  if (!agent) return state;
  if (state.players[owner].multiTimelineStrikeActive) return state;
  const cost = INTEL_COSTS.MULTI_TIMELINE_STRIKE;
  if (!hasAccessToAction(state, owner, agent.currentPeriod, cost)) return state;

  let newState = spendActionIntel(state, owner, agent.currentPeriod, cost);
  newState.players[owner] = {
    ...newState.players[owner],
    multiTimelineStrikeActive: true,
  };
  return pushIntelOperationNotif(newState, owner, action.type);
}

// ─── SINGLE ACTION RESOLVER (real-time mode) ────────────────
// Resolves one action immediately. Cover/vision cleared at end-of-round only.

export function resolveSingleAction(state: GameState, action: GameAction, options?: ResolveActionOptions): GameState {
  let newState = { ...state };

  switch (action.type) {
    case 'MOVE':               newState = resolveMove(newState, action); break;
    case 'WAIT':               newState = resolveWait(newState, action); break;
    case 'CONTROL':            newState = resolveControl(newState, action); break;
    case 'STRIKE':             newState = resolveStrike(newState, action); break;
    case 'TRAVERSE':           newState = resolveTraverse(newState, action, options); break;
    case 'LOCATE':             newState = resolveLocate(newState, action, options); break;
    case 'DEEP_COVER':         newState = resolveDeepCover(newState, action, options); break;
    case 'PREPARE_ACTION':     newState = resolvePrepareAction(newState, action, options); break;
    case 'STRIKE_REPORT':      newState = resolveStrikeReport(newState, action, options); break;
    case 'ENCRYPTION':         newState = resolveEncryption(newState, action, options); break;
    case 'RAPID_RECON':        newState = resolveRapidRecon(newState, action, options); break;
    case 'MULTI_TIMELINE_STRIKE': newState = resolveMultiTimelineStrike(newState, action); break;
  }

  if (newState === state) {
    return state;
  }

  // Always check paradoxes immediately after each action
  newState = checkAndApplyParadoxes(newState);

  if (!options?.bypassCostsAndLimits) {
    newState = updateHiddenKnowledgeAfterAction(state, newState, action.owner, action.agentId, action.type);
  }

  // Decrement actionsRemaining for the acting agent
  const { owner, agentId } = action;
  if (!options?.skipActionConsumption && !options?.bypassCostsAndLimits) {
    newState.players[owner] = {
      ...newState.players[owner],
      agents: newState.players[owner].agents.map(a =>
        a.id === agentId
          ? { ...a, actionsRemaining: Math.max(0, a.actionsRemaining - 1) }
          : a
      ),
    };
  }

  return pruneVisionForMissingAgents(newState);
}

// ─── END-OF-ROUND CLEANUP ────────────────────────────────────
// Called once after all players have exhausted their actions.

export function endRoundCleanup(state: GameState): GameState {
  let newState = { ...state };

  // Clear deep cover flags
  for (const pid of ['P1', 'P2'] as PlayerId[]) {
    newState.players[pid] = {
      ...newState.players[pid],
      agents: newState.players[pid].agents.map(a => normalizeForcedExposure({ ...a, deepCoverActive: false })),
      encryptionActive: false,
      strikeReportActive: false,
      rapidReconActive: false,
      deepCoverKnownToOpponent: false,
    };
  }

  return pruneVisionForMissingAgents(newState);
}

export function applyTurnBoundaryVision(state: GameState): GameState {
  let newState = applyGuaranteedVisionForViewer(state, 'P1');
  newState = applyGuaranteedVisionForViewer(newState, 'P2');
  return pruneVisionForMissingAgents(newState);
}

// ─── MAIN RESOLVER ──────────────────────────────────────────

export function resolveActions(state: GameState, allActions: GameAction[]): GameState {
  let newState = { ...state };

  // Shuffle to simulate simultaneity (in a real networked game both sides submit simultaneously)
  const shuffled = [...allActions].sort(() => Math.random() - 0.5);

  for (const action of shuffled) {
    switch (action.type) {
      case 'MOVE':              newState = resolveMove(newState, action); break;
      case 'WAIT':              newState = resolveWait(newState, action); break;
      case 'CONTROL':           newState = resolveControl(newState, action); break;
      case 'STRIKE':            newState = resolveStrike(newState, action); break;
      case 'TRAVERSE':          newState = resolveTraverse(newState, action); break;
      case 'LOCATE':            newState = resolveLocate(newState, action); break;
      case 'DEEP_COVER':        newState = resolveDeepCover(newState, action); break;
      case 'PREPARE_ACTION':    newState = resolvePrepareAction(newState, action); break;
      case 'MULTI_TIMELINE_STRIKE': newState = resolveMultiTimelineStrike(newState, action); break;
    }
  }

  // Check paradoxes after all actions resolve
  newState = checkAndApplyParadoxes(newState);

  // Clear deep cover after turn
  for (const pid of ['P1', 'P2'] as PlayerId[]) {
    newState.players[pid] = {
      ...newState.players[pid],
      agents: newState.players[pid].agents.map(a => normalizeForcedExposure({ ...a, deepCoverActive: false })),
      rapidReconActive: false,
      deepCoverKnownToOpponent: false,
    };
  }

  return pruneVisionForMissingAgents(newState);
}

// ─── REWARD SPAWNER ─────────────────────────────────────────

export function spawnRewards(state: GameState): GameState {
  const newState = { ...state };
  const rewards = [...newState.rewards];

  // Increment uncollected caches
  for (const reward of rewards) {
    if (reward.type === 'INTEL_CACHE' && reward.amount < 30) {
      reward.amount = Math.min(30, reward.amount + 10);
    }
    reward.uncollectedRounds += 1;
  }

  // Chance to spawn new reward on empty, non-destroyed city
  const allCities = [...state.map.cities.values()].filter(
    c => !c.destroyed && !rewards.some(r => r.cityId === c.id)
  );

  if (allCities.length > 0 && Math.random() < 0.3) {
    const city = allCities[Math.floor(Math.random() * allCities.length)];
    const type = Math.random() < 0.7 ? 'INTEL_CACHE' : 'EXTRA_ACTION';
    rewards.push({
      id: `reward_${Date.now()}`,
      cityId: city.id,
      type,
      amount: 10,
      uncollectedRounds: 0,
    });
  }

  return { ...newState, rewards };
}

export function collectRewards(state: GameState): GameState {
  let newState = { ...state };

  for (const pid of ['P1', 'P2'] as PlayerId[]) {
    for (const agent of newState.players[pid].agents) {
      const rewardIdx = newState.rewards.findIndex(r => r.cityId === agent.cityId);
      if (rewardIdx === -1) continue;

      const reward = newState.rewards[rewardIdx];
      newState.rewards = newState.rewards.filter((_, i) => i !== rewardIdx);

      if (reward.type === 'INTEL_CACHE') {
        newState = {
          ...newState,
          players: {
            ...newState.players,
            [pid]: {
              ...newState.players[pid],
              intel: {
                ...newState.players[pid].intel,
                [agent.currentPeriod]: newState.players[pid].intel[agent.currentPeriod] + reward.amount,
              },
            },
          },
        };
      } else if (reward.type === 'EXTRA_ACTION') {
        newState.players[pid] = {
          ...newState.players[pid],
          extraActionsNextRound: newState.players[pid].extraActionsNextRound + 1,
        };
      }
    }
  }

  return newState;
}

// ─── AI OPPONENT (simple heuristic for single-player) ───────

export function generateAIActions(state: GameState, aiPlayer: PlayerId, difficulty = state.matchConfig.aiDifficulty): GameAction[] {
  const ai = state.players[aiPlayer];
  const opponent = getOpponent(aiPlayer);
  const candidates: Array<{ score: number; action: GameAction }> = [];
  const visibleEnemyIds = state.vision[aiPlayer].revealedAgentIds;
  const hybridArtifact = getHybridPolicyArtifact(difficulty);
  const difficultyProfile = getAiDifficultyProfile(difficulty);

  const canUseIntel = (period: TimePeriod, type: keyof typeof INTEL_COSTS) => ai.intel[period] >= INTEL_COSTS[type];
  const addCandidate = (score: number, action: GameAction) => {
    const adjustedScore = action.type === 'WAIT'
      ? score + difficultyProfile.waitBias
      : score * getAiDifficultyMultiplier(action.type, difficulty);
    let learnedBonus = 0;
    if (hybridArtifact.enabled) {
      const features = extractHybridFeaturesFromRuntime(state, action);
      if (features) {
        learnedBonus = scoreWithHybridPolicy(features, hybridArtifact)
          * hybridArtifact.blend
          * difficultyProfile.learnedBlendMultiplier;
      }
    }
    candidates.push({ score: adjustedScore + learnedBonus, action });
  };

  for (const agent of ai.agents) {
    if (agent.actionsRemaining <= 0) continue;

    const city = state.map.cities.get(agent.cityId);
    if (!city || city.destroyed) continue;

    const actionBaseId = `ai_action_${agent.id}_${Date.now()}`;
    const connected = getConnectedCities(state.map, agent.cityId)
      .map(cityId => state.map.cities.get(cityId))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate && !candidate.destroyed));
    const enemies = state.players[opponent].agents;
    const localStrikeEnemies = enemies.filter(enemy => enemy.cityId === agent.cityId);
    const overlapEnemies = enemies.filter(enemy => shareExactOrNodePosition(state, agent.cityId, enemy.cityId));
    const periodEnemies = enemies.filter(enemy => enemy.currentPeriod === agent.currentPeriod);
    const visiblePeriodEnemies = periodEnemies.filter(enemy => visibleEnemyIds.has(enemy.id));

    if (localStrikeEnemies.length > 0 || (ai.multiTimelineStrikeActive && overlapEnemies.length > 0)) {
      addCandidate(100, { id: `${actionBaseId}_strike`, type: 'STRIKE', agentId: agent.id, owner: aiPlayer });
    }

    if (!ai.multiTimelineStrikeActive && city.isNode && city.nodeId && canUseIntel(agent.currentPeriod, 'MULTI_TIMELINE_STRIKE')) {
      addCandidate(58 + overlapEnemies.length * 10, { id: `${actionBaseId}_multi_strike_upgrade`, type: 'MULTI_TIMELINE_STRIKE', agentId: agent.id, owner: aiPlayer });
    }

    if (city.controlledBy !== aiPlayer) {
      addCandidate(city.controlledBy === opponent ? 82 : 68, { id: `${actionBaseId}_control`, type: 'CONTROL', agentId: agent.id, owner: aiPlayer });
    }

    if (!ai.strikeReportActive && canUseIntel(agent.currentPeriod, 'STRIKE_REPORT')) {
      addCandidate(overlapEnemies.length > 0 ? 64 : 40, { id: `${actionBaseId}_strike_report`, type: 'STRIKE_REPORT', agentId: agent.id, owner: aiPlayer });
    }

    if (!ai.encryptionActive && canUseIntel(agent.currentPeriod, 'ENCRYPTION')) {
      addCandidate(38, { id: `${actionBaseId}_encryption`, type: 'ENCRYPTION', agentId: agent.id, owner: aiPlayer });
    }

    if (!ai.rapidReconActive && canUseIntel(agent.currentPeriod, 'RAPID_RECON')) {
      const nearEnemy = connected.some(targetCity => enemies.some(enemy => shareExactOrNodePosition(state, targetCity.id, enemy.cityId)));
      addCandidate(nearEnemy ? 60 : 34, { id: `${actionBaseId}_rapid_recon`, type: 'RAPID_RECON', agentId: agent.id, owner: aiPlayer });
    }

    if (!agent.deepCoverActive && !agent.cover && canUseIntel(agent.currentPeriod, 'DEEP_COVER')) {
      addCandidate(66, { id: `${actionBaseId}_deep_cover`, type: 'DEEP_COVER', agentId: agent.id, owner: aiPlayer });
    }

    if (visiblePeriodEnemies.length === 0 && periodEnemies.length > 0 && canUseIntel(agent.currentPeriod, 'LOCATE')) {
      addCandidate(48, { id: `${actionBaseId}_locate`, type: 'LOCATE', agentId: agent.id, owner: aiPlayer });
    }

    if (agent.actionsRemaining <= 2 && canUseIntel(agent.currentPeriod, 'PREPARE_ACTION')) {
      addCandidate(22, { id: `${actionBaseId}_prepare`, type: 'PREPARE_ACTION', agentId: agent.id, owner: aiPlayer });
    }

    if (city.isNode && city.nodeId) {
      for (const targetPeriod of TIME_ORDER) {
        if (targetPeriod === agent.currentPeriod) continue;
        const targetCity = findTraversalTargetCity(state, city, targetPeriod);
        if (!targetCity || targetCity.destroyed) continue;
        if (canUseIntel(agent.currentPeriod, 'TRAVERSE')) {
          const pressure = enemies.filter(enemy => enemy.currentPeriod === targetPeriod && shareExactOrNodePosition(state, targetCity.id, enemy.cityId)).length;
          const targetValue = targetCity.controlledBy === opponent ? 72 : targetCity.controlledBy === null ? 50 : 28;
          addCandidate(targetValue + pressure * 10, {
            id: `${actionBaseId}_traverse_${targetPeriod}`,
            type: 'TRAVERSE',
            agentId: agent.id,
            owner: aiPlayer,
            targetPeriod,
          });
        }
      }
    }

    for (const targetCity of connected) {
      const enemyPressure = enemies.filter(enemy => shareExactOrNodePosition(state, targetCity.id, enemy.cityId)).length;
      const rewardHere = state.rewards.some(reward => reward.cityId === targetCity.id);
      const moveScore = 16
        + (targetCity.controlledBy === opponent ? 24 : targetCity.controlledBy === null ? 9 : 0)
        + (targetCity.isNode ? 12 : 0)
        + (rewardHere ? 18 : 0)
        + enemyPressure * (ai.rapidReconActive ? 16 : 8);
      addCandidate(moveScore, {
        id: `${actionBaseId}_move_${targetCity.id}`,
        type: 'MOVE',
        agentId: agent.id,
        owner: aiPlayer,
        targetCityId: targetCity.id,
      });
    }

    addCandidate(4, { id: `${actionBaseId}_wait`, type: 'WAIT', agentId: agent.id, owner: aiPlayer });
  }

  return rankAiCandidates(candidates, difficulty).map(candidate => candidate.action);
}
