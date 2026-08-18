// ============================================================
// CHRONODOX — Intel System
// ============================================================

import type { GameState, PlayerId, TimePeriod } from '../types/game';
import { BASE_INTEL_PER_ROUND, CONTROLLED_CITY_INTEL } from '../types/game';

export function generateIntel(state: GameState): GameState {
  const newState = { ...state };
  const periods: TimePeriod[] = ['PAST', 'PRESENT', 'FUTURE'];

  for (const pid of ['P1', 'P2'] as PlayerId[]) {
    const player = { ...newState.players[pid] };
    const intel = { ...player.intel };

    for (const period of periods) {
      // Base intel for having at least one agent
      const hasAgent = player.agents.some(a => a.currentPeriod === period);
      if (!hasAgent) continue;

      let gained = BASE_INTEL_PER_ROUND;

      // Count controlled cities in this period
      const controlled = [...state.map.cities.values()].filter(
        c => c.period === period && c.controlledBy === pid && !c.destroyed
      ).length;
      gained += controlled * CONTROLLED_CITY_INTEL;

      intel[period] += gained;
    }

    player.intel = intel;
    newState.players[pid] = player;
  }

  return newState;
}

export function canAfford(
  state: GameState,
  pid: PlayerId,
  period: TimePeriod,
  cost: number
): boolean {
  return state.players[pid].intel[period] >= cost;
}

export function spendIntel(
  state: GameState,
  pid: PlayerId,
  period: TimePeriod,
  amount: number
): GameState {
  const newState = { ...state };
  const player = { ...newState.players[pid] };
  player.intel = { ...player.intel, [period]: player.intel[period] - amount };
  newState.players[pid] = player;
  return newState;
}

export function addIntel(
  state: GameState,
  pid: PlayerId,
  period: TimePeriod,
  amount: number
): GameState {
  const newState = { ...state };
  const player = { ...newState.players[pid] };
  player.intel = { ...player.intel, [period]: player.intel[period] + amount };
  newState.players[pid] = player;
  return newState;
}
