import type { GameState, MapState, VisionData } from '../types/game';

export interface SerializedVisionData {
  revealedAgentIds: string[];
  possiblePositions: Array<[string, string[]]>;
}

export interface SerializedMapState {
  cities: Array<[string, MapState['cities'] extends Map<string, infer T> ? T : never]>;
  routes: MapState['routes'];
  nodes: Array<[string, string[]]>;
}

export interface SerializedGameState extends Omit<GameState, 'map' | 'vision'> {
  map: SerializedMapState;
  vision: {
    P1: SerializedVisionData;
    P2: SerializedVisionData;
  };
}

function serializeVisionData(vision: VisionData): SerializedVisionData {
  return {
    revealedAgentIds: [...vision.revealedAgentIds],
    possiblePositions: [...vision.possiblePositions.entries()].map(([agentId, cityIds]) => [agentId, [...cityIds]]),
  };
}

function deserializeVisionData(vision: SerializedVisionData): VisionData {
  return {
    revealedAgentIds: new Set(vision.revealedAgentIds),
    possiblePositions: new Map(vision.possiblePositions.map(([agentId, cityIds]) => [agentId, [...cityIds]])),
  };
}

export function serializeGameState(state: GameState): SerializedGameState {
  return {
    ...state,
    map: {
      cities: [...state.map.cities.entries()].map(([cityId, city]) => [cityId, { ...city }]),
      routes: state.map.routes.map(route => ({ ...route })),
      nodes: [...state.map.nodes.entries()].map(([nodeId, cityIds]) => [nodeId, [...cityIds]]),
    },
    vision: {
      P1: serializeVisionData(state.vision.P1),
      P2: serializeVisionData(state.vision.P2),
    },
  };
}

export function deserializeGameState(state: SerializedGameState): GameState {
  return {
    ...state,
    map: {
      cities: new Map(state.map.cities.map(([cityId, city]) => [cityId, { ...city }])),
      routes: state.map.routes.map(route => ({ ...route })),
      nodes: new Map(state.map.nodes.map(([nodeId, cityIds]) => [nodeId, [...cityIds]])),
    },
    vision: {
      P1: deserializeVisionData(state.vision.P1),
      P2: deserializeVisionData(state.vision.P2),
    },
  };
}
