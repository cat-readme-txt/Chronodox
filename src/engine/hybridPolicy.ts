import type { AiDifficulty, GameAction, GameState, PlayerId, TimePeriod } from '../types/game';
import type {
  TrainingAgentSnapshot,
  TrainingCitySnapshot,
  TrainingExample,
  TrainingStateSnapshot,
} from './aiTraining';
import { DEFAULT_AI_DIFFICULTY } from '../types/game';
import hybridPolicyArtifactEasy from '../data/hybridPolicyArtifact.easy.json';
import hybridPolicyArtifactNormal from '../data/hybridPolicyArtifact.normal.json';
import hybridPolicyArtifactHard from '../data/hybridPolicyArtifact.hard.json';

export const HYBRID_FEATURE_NAMES = [
  'bias',
  'round_norm',
  'player_intel_past',
  'player_intel_present',
  'player_intel_future',
  'opponent_intel_past',
  'opponent_intel_present',
  'opponent_intel_future',
  'player_agent_count',
  'opponent_agent_count',
  'controlled_city_delta',
  'destroyed_city_count',
  'rewards_in_play',
  'agent_actions_remaining',
  'agent_cover',
  'agent_origin_past',
  'agent_origin_present',
  'agent_origin_future',
  'agent_current_past',
  'agent_current_present',
  'agent_current_future',
  'action_move',
  'action_wait',
  'action_control',
  'action_strike',
  'action_traverse',
  'action_fake_traverse',
  'action_locate',
  'action_strike_report',
  'action_deep_cover',
  'action_prepare',
  'action_encryption',
  'action_rapid_recon',
  'action_multi_timeline_strike',
  'target_period_past',
  'target_period_present',
  'target_period_future',
  'agent_is_past_origin',
  'player_agent_advantage',
  'same_node_enemy_pressure',
  'destination_enemy_pressure',
  'paradox_risk',
  'control_opportunity',
  'traversal_leverage',
  'past_origin_survival_importance',
  'player_past_origin_count',
  'opponent_past_origin_count',
  'revealed_enemy_count',
  'hidden_enemy_count',
  'uncertainty_pressure',
  'strike_viability',
  'multi_timeline_strike_viability',
  'target_is_node',
  'target_has_reward',
  'target_controlled_by_player',
  'target_controlled_by_opponent',
  'target_controlled_neutral',
  'contact_reveal_chance',
  'same_node_allied_support',
] as const;

export type HybridFeatureName = typeof HYBRID_FEATURE_NAMES[number];
export type HybridArtifactDifficulty = AiDifficulty | 'mixed';

export interface HybridPolicyArtifact {
  version: number;
  enabled: boolean;
  blend: number;
  trainedAt: string | null;
  sampleCount: number;
  mse: number | null;
  difficulty?: HybridArtifactDifficulty | null;
  featureNames: HybridFeatureName[];
  weights: number[];
}

const RAW_HYBRID_POLICY_ARTIFACTS: Record<AiDifficulty, HybridPolicyArtifact> = {
  easy: hybridPolicyArtifactEasy as HybridPolicyArtifact,
  normal: hybridPolicyArtifactNormal as HybridPolicyArtifact,
  hard: hybridPolicyArtifactHard as HybridPolicyArtifact,
};

const normalizedArtifactCache = new Map<AiDifficulty, HybridPolicyArtifact>();

interface SnapshotContext {
  snapshot: TrainingStateSnapshot;
  player: PlayerId;
  opponent: PlayerId;
  actingAgent: TrainingAgentSnapshot;
  targetCity: TrainingCitySnapshot | null;
  sourceCity: TrainingCitySnapshot | null;
  targetPeriod: TimePeriod | null;
  targetCityId: string | null;
}

function periodFlags(period: TimePeriod) {
  return {
    past: period === 'PAST' ? 1 : 0,
    present: period === 'PRESENT' ? 1 : 0,
    future: period === 'FUTURE' ? 1 : 0,
  };
}

function actionFlags(action: GameAction['type']) {
  return {
    MOVE: action === 'MOVE' ? 1 : 0,
    WAIT: action === 'WAIT' ? 1 : 0,
    CONTROL: action === 'CONTROL' ? 1 : 0,
    STRIKE: action === 'STRIKE' ? 1 : 0,
    TRAVERSE: action === 'TRAVERSE' ? 1 : 0,
    FAKE_TRAVERSE: 0,
    LOCATE: action === 'LOCATE' ? 1 : 0,
    STRIKE_REPORT: action === 'STRIKE_REPORT' ? 1 : 0,
    DEEP_COVER: action === 'DEEP_COVER' ? 1 : 0,
    PREPARE_ACTION: action === 'PREPARE_ACTION' ? 1 : 0,
    ENCRYPTION: action === 'ENCRYPTION' ? 1 : 0,
    RAPID_RECON: action === 'RAPID_RECON' ? 1 : 0,
    MULTI_TIMELINE_STRIKE: action === 'MULTI_TIMELINE_STRIKE' ? 1 : 0,
  };
}

function buildCityMap(snapshot: TrainingStateSnapshot) {
  return new Map((snapshot.mapCities ?? []).map(city => [city.id, city]));
}

function getSnapshotPlayer(snapshot: TrainingStateSnapshot): PlayerId {
  return snapshot.currentTurn === 'P1' || snapshot.currentTurn === 'P2'
    ? snapshot.currentTurn
    : 'P1';
}

function getOpponent(player: PlayerId): PlayerId {
  return player === 'P1' ? 'P2' : 'P1';
}

function shareExactOrNodePosition(
  cityMap: Map<string, TrainingCitySnapshot>,
  aCityId: string,
  bCityId: string,
) {
  if (aCityId === bCityId) return true;
  const a = cityMap.get(aCityId);
  const b = cityMap.get(bCityId);
  return Boolean(a?.nodeId && b?.nodeId && a.nodeId === b.nodeId);
}

function countNodeOccupants(
  cityMap: Map<string, TrainingCitySnapshot>,
  agents: TrainingAgentSnapshot[],
  cityId: string,
) {
  return agents.filter(agent => shareExactOrNodePosition(cityMap, agent.cityId, cityId)).length;
}

function resolveTraversalTargetCity(
  snapshot: TrainingStateSnapshot,
  sourceAgent: TrainingAgentSnapshot,
  targetPeriod: TimePeriod | undefined,
) {
  if (!targetPeriod || !sourceAgent.nodeId) return null;
  return (snapshot.mapCities ?? []).find(city => (
    !city.destroyed
    && city.nodeId === sourceAgent.nodeId
    && city.period === targetPeriod
  )) ?? null;
}

function resolveTargetCity(
  snapshot: TrainingStateSnapshot,
  action: Pick<GameAction, 'type' | 'agentId' | 'targetPeriod' | 'targetCityId'>,
  actingAgent: TrainingAgentSnapshot,
) {
  const cityMap = buildCityMap(snapshot);
  if (action.targetCityId) return cityMap.get(action.targetCityId) ?? null;
  if (action.type === 'TRAVERSE') {
    return resolveTraversalTargetCity(snapshot, actingAgent, action.targetPeriod);
  }
  return cityMap.get(actingAgent.cityId) ?? null;
}

function collectPossibleCityCount(agents: TrainingAgentSnapshot[]) {
  return agents.reduce((sum, agent) => sum + (agent.possibleCityIds?.length ?? 0), 0);
}

function buildSnapshotContext(
  snapshot: TrainingStateSnapshot,
  action: Pick<GameAction, 'type' | 'agentId' | 'targetPeriod' | 'targetCityId'>,
): SnapshotContext | null {
  const actingAgent = snapshot.playerAgents.find(item => item.id === action.agentId);
  if (!actingAgent) return null;

  const player = getSnapshotPlayer(snapshot);
  const opponent = getOpponent(player);
  const cityMap = buildCityMap(snapshot);
  const sourceCity = cityMap.get(actingAgent.cityId) ?? null;
  const targetCity = resolveTargetCity(snapshot, action, actingAgent);

  return {
    snapshot,
    player,
    opponent,
    actingAgent,
    sourceCity,
    targetCity,
    targetPeriod: action.targetPeriod ?? null,
    targetCityId: targetCity?.id ?? action.targetCityId ?? null,
  };
}

function computeSameNodeEnemyPressure(context: SnapshotContext) {
  const cityMap = buildCityMap(context.snapshot);
  return countNodeOccupants(cityMap, context.snapshot.opponentAgents, context.actingAgent.cityId);
}

function computeDestinationEnemyPressure(context: SnapshotContext) {
  if (!context.targetCityId) return 0;
  const cityMap = buildCityMap(context.snapshot);
  return countNodeOccupants(cityMap, context.snapshot.opponentAgents, context.targetCityId);
}

function computeSameNodeAlliedSupport(context: SnapshotContext) {
  if (!context.targetCityId) return 0;
  const cityMap = buildCityMap(context.snapshot);
  return Math.max(0, countNodeOccupants(cityMap, context.snapshot.playerAgents, context.targetCityId) - 1);
}

function computeParadoxRisk(context: SnapshotContext) {
  if (!context.targetCity) return 0;
  return context.snapshot.playerAgents.some(agent => (
    agent.id !== context.actingAgent.id
    && agent.originPeriod === context.actingAgent.originPeriod
    && agent.currentPeriod === context.targetCity!.period
    && agent.cityId === context.targetCity!.id
  )) ? 1 : 0;
}

function computeControlOpportunity(context: SnapshotContext, actionType: GameAction['type']) {
  if (!context.targetCity) return 0;
  if (actionType === 'CONTROL') {
    return context.targetCity.controlledBy === context.player ? 0 : 1;
  }
  if (actionType === 'MOVE' || actionType === 'TRAVERSE') {
    if (context.targetCity.controlledBy === context.opponent) return 1;
    if (context.targetCity.controlledBy === null) return 0.6;
  }
  return 0;
}

function computeTraversalLeverage(context: SnapshotContext, actionType: GameAction['type']) {
  const targetCity = context.targetCity;
  if (!targetCity) return 0;
  const isTraversalVector = actionType === 'TRAVERSE' || (actionType === 'MOVE' && targetCity.nodeId);
  if (!isTraversalVector || !targetCity.nodeId) return 0;
  const linkedCities = (context.snapshot.mapCities ?? []).filter(city => city.nodeId === targetCity.nodeId && !city.destroyed);
  const distinctPeriods = new Set(linkedCities.map(city => city.period)).size;
  const opponentPresence = context.snapshot.opponentAgents.filter(agent => agent.nodeId === targetCity.nodeId).length;
  return (distinctPeriods - 1) + opponentPresence * 0.5;
}

function computePastOriginSurvivalImportance(context: SnapshotContext) {
  const pastOriginCount = context.snapshot.playerAgents.filter(agent => agent.originPeriod === 'PAST').length;
  if (context.actingAgent.originPeriod !== 'PAST') return 0;
  if (pastOriginCount <= 1) return 1.5;
  if (pastOriginCount === 2) return 1;
  return 0.5;
}

function computeStrikeViability(context: SnapshotContext) {
  return computeSameNodeEnemyPressure(context);
}

function computeMultiTimelineStrikeViability(context: SnapshotContext) {
  if (!context.sourceCity?.nodeId) return 0;
  const distinctPeriods = new Set(
    context.snapshot.opponentAgents
      .filter(agent => agent.nodeId === context.sourceCity!.nodeId)
      .map(agent => agent.currentPeriod),
  ).size;
  return distinctPeriods;
}

function computeUncertaintyPressure(context: SnapshotContext) {
  const hiddenEnemyCount = context.snapshot.opponentAgents.filter(agent => agent.cover).length;
  const possibleCount = collectPossibleCityCount(context.snapshot.opponentAgents);
  return hiddenEnemyCount + possibleCount * 0.25;
}

function computeContactRevealChance(context: SnapshotContext, actionType: GameAction['type']) {
  if (!context.targetCity) return 0;
  if (actionType !== 'MOVE' && actionType !== 'TRAVERSE' && actionType !== 'CONTROL') return 0;
  if (context.targetCity.controlledBy === context.opponent) return 1;
  const destinationEnemies = computeDestinationEnemyPressure(context);
  if (destinationEnemies > 0) return 1;
  if (context.targetCity.nodeId) {
    const enemyOnNode = context.snapshot.opponentAgents.some(agent => agent.nodeId === context.targetCity!.nodeId);
    if (enemyOnNode) return 1;
  }
  return 0;
}

function buildFeatureVectorFromSnapshot(
  snapshot: TrainingStateSnapshot,
  action: Pick<GameAction, 'type' | 'agentId' | 'targetPeriod' | 'targetCityId'>,
) {
  const context = buildSnapshotContext(snapshot, action);
  if (!context) return null;

  const { actingAgent, targetCity } = context;
  const origin = periodFlags(actingAgent.originPeriod);
  const current = periodFlags(actingAgent.currentPeriod);
  const target = action.targetPeriod ? periodFlags(action.targetPeriod) : { past: 0, present: 0, future: 0 };
  const flags = actionFlags(action.type);
  const playerAgentAdvantage = snapshot.playerAgents.length - snapshot.opponentAgents.length;
  const controlledCityDelta = context.player === 'P1'
    ? snapshot.controlledCityCounts.P1 - snapshot.controlledCityCounts.P2
    : snapshot.controlledCityCounts.P2 - snapshot.controlledCityCounts.P1;
  const playerPastOriginCount = snapshot.playerAgents.filter(agent => agent.originPeriod === 'PAST').length;
  const opponentPastOriginCount = snapshot.opponentAgents.filter(agent => agent.originPeriod === 'PAST').length;
  const revealedEnemyIds = new Set(snapshot.revealedOpponentAgentIds ?? []);
  const revealedEnemyCount = snapshot.opponentAgents.filter(agent => revealedEnemyIds.has(agent.id)).length;
  const hiddenEnemyCount = Math.max(0, snapshot.opponentAgents.length - revealedEnemyCount);
  const sameNodeEnemyPressure = computeSameNodeEnemyPressure(context);
  const destinationEnemyPressure = computeDestinationEnemyPressure(context);
  const paradoxRisk = computeParadoxRisk(context);
  const controlOpportunity = computeControlOpportunity(context, action.type);
  const traversalLeverage = computeTraversalLeverage(context, action.type);
  const pastOriginSurvivalImportance = computePastOriginSurvivalImportance(context);
  const uncertaintyPressure = computeUncertaintyPressure(context);
  const strikeViability = computeStrikeViability(context);
  const multiTimelineStrikeViability = computeMultiTimelineStrikeViability(context);
  const contactRevealChance = computeContactRevealChance(context, action.type);
  const sameNodeAlliedSupport = computeSameNodeAlliedSupport(context);

  return [
    1,
    snapshot.round / 50,
    snapshot.playerIntel.PAST / 100,
    snapshot.playerIntel.PRESENT / 100,
    snapshot.playerIntel.FUTURE / 100,
    snapshot.opponentIntel.PAST / 100,
    snapshot.opponentIntel.PRESENT / 100,
    snapshot.opponentIntel.FUTURE / 100,
    snapshot.playerAgents.length / 10,
    snapshot.opponentAgents.length / 10,
    controlledCityDelta / 10,
    snapshot.destroyedCityCount / 20,
    snapshot.rewardsInPlay / 10,
    actingAgent.actionsRemaining / 6,
    actingAgent.cover ? 1 : 0,
    origin.past,
    origin.present,
    origin.future,
    current.past,
    current.present,
    current.future,
    flags.MOVE,
    flags.WAIT,
    flags.CONTROL,
    flags.STRIKE,
    flags.TRAVERSE,
    flags.FAKE_TRAVERSE,
    flags.LOCATE,
    flags.STRIKE_REPORT,
    flags.DEEP_COVER,
    flags.PREPARE_ACTION,
    flags.ENCRYPTION,
    flags.RAPID_RECON,
    flags.MULTI_TIMELINE_STRIKE,
    target.past,
    target.present,
    target.future,
    actingAgent.originPeriod === 'PAST' ? 1 : 0,
    playerAgentAdvantage / 10,
    sameNodeEnemyPressure / 4,
    destinationEnemyPressure / 4,
    paradoxRisk,
    controlOpportunity,
    traversalLeverage / 4,
    pastOriginSurvivalImportance,
    playerPastOriginCount / 5,
    opponentPastOriginCount / 5,
    revealedEnemyCount / 5,
    hiddenEnemyCount / 5,
    uncertaintyPressure / 10,
    strikeViability / 4,
    multiTimelineStrikeViability / 3,
    targetCity?.isNode ? 1 : 0,
    targetCity?.hasReward ? 1 : 0,
    targetCity?.controlledBy === context.player ? 1 : 0,
    targetCity?.controlledBy === context.opponent ? 1 : 0,
    targetCity?.controlledBy === null ? 1 : 0,
    contactRevealChance,
    sameNodeAlliedSupport / 4,
  ];
}

function snapshotFromRuntime(state: GameState, action: GameAction): TrainingStateSnapshot | null {
  const actingPlayer = action.owner;
  const opponent = actingPlayer === 'P1' ? 'P2' : 'P1';
  const controlledCityCounts = {
    P1: [...state.map.cities.values()].filter(city => city.controlledBy === 'P1').length,
    P2: [...state.map.cities.values()].filter(city => city.controlledBy === 'P2').length,
  };

  return {
    round: state.round,
    currentTurn: actingPlayer,
    playerIntel: { ...state.players[actingPlayer].intel },
    opponentIntel: { ...state.players[opponent].intel },
    playerAgents: state.players[actingPlayer].agents.map(agent => ({
      id: agent.id,
      owner: agent.owner,
      originPeriod: agent.period,
      currentPeriod: agent.currentPeriod,
      cityId: agent.cityId,
      cityName: state.map.cities.get(agent.cityId)?.name ?? '??',
      nodeId: state.map.cities.get(agent.cityId)?.nodeId ?? null,
      cover: agent.cover,
      actionsRemaining: agent.actionsRemaining,
      isPastAgent: agent.isPastAgent,
      lastKnownCityId: agent.lastKnownCityId,
      possibleCityIds: [...agent.possibleCityIds],
    })),
    opponentAgents: state.players[opponent].agents.map(agent => ({
      id: agent.id,
      owner: agent.owner,
      originPeriod: agent.period,
      currentPeriod: agent.currentPeriod,
      cityId: agent.cityId,
      cityName: state.map.cities.get(agent.cityId)?.name ?? '??',
      nodeId: state.map.cities.get(agent.cityId)?.nodeId ?? null,
      cover: agent.cover,
      actionsRemaining: agent.actionsRemaining,
      isPastAgent: agent.isPastAgent,
      lastKnownCityId: agent.lastKnownCityId,
      possibleCityIds: [...agent.possibleCityIds],
    })),
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

export function extractHybridFeaturesFromRuntime(state: GameState, action: GameAction) {
  const snapshot = snapshotFromRuntime(state, action);
  return snapshot ? buildFeatureVectorFromSnapshot(snapshot, action) : null;
}

export function extractHybridFeaturesFromExample(example: TrainingExample) {
  return buildFeatureVectorFromSnapshot(example.state, {
    type: example.actionType,
    agentId: example.agentId,
    targetPeriod: example.targetPeriod,
    targetCityId: example.targetCityId,
  });
}

function normalizeArtifact(
  rawArtifact: HybridPolicyArtifact,
  fallbackDifficulty: AiDifficulty,
): HybridPolicyArtifact {
  const oldNames = rawArtifact.featureNames ?? [];
  const oldWeights = rawArtifact.weights ?? [];
  const oldIndex = new Map(oldNames.map((name, index) => [name, index]));
  const weights = HYBRID_FEATURE_NAMES.map(name => {
    const index = oldIndex.get(name);
    return index === undefined ? 0 : (oldWeights[index] ?? 0);
  });
  const normalizedDifficulty = rawArtifact.difficulty === 'easy'
    || rawArtifact.difficulty === 'normal'
    || rawArtifact.difficulty === 'hard'
    || rawArtifact.difficulty === 'mixed'
    ? rawArtifact.difficulty
    : fallbackDifficulty;

  return {
    version: rawArtifact.version ?? 1,
    enabled: rawArtifact.enabled ?? false,
    blend: rawArtifact.blend ?? 1,
    trainedAt: rawArtifact.trainedAt ?? null,
    sampleCount: rawArtifact.sampleCount ?? 0,
    mse: rawArtifact.mse ?? null,
    difficulty: normalizedDifficulty,
    featureNames: [...HYBRID_FEATURE_NAMES],
    weights,
  };
}

export function getHybridPolicyArtifact(difficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY): HybridPolicyArtifact {
  const cachedArtifact = normalizedArtifactCache.get(difficulty);
  if (cachedArtifact) return cachedArtifact;

  const normalizedArtifact = normalizeArtifact(
    RAW_HYBRID_POLICY_ARTIFACTS[difficulty] ?? RAW_HYBRID_POLICY_ARTIFACTS[DEFAULT_AI_DIFFICULTY],
    difficulty,
  );
  normalizedArtifactCache.set(difficulty, normalizedArtifact);
  return normalizedArtifact;
}

export function scoreWithHybridPolicy(features: number[], artifact: HybridPolicyArtifact) {
  return features.reduce((sum, value, index) => sum + value * (artifact.weights[index] ?? 0), 0);
}
