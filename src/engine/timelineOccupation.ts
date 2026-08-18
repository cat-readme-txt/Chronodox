import type { Agent, GameState, PlayerId, TimePeriod, TimelineOccupation } from '../types/game';
import {
  TIMELINE_OCCUPATION_ACTION_BONUS,
  TIMELINE_OCCUPATION_INTEL_BONUS,
} from '../types/game';

export interface TimelineVisualState {
  mode: 'neutral' | 'occupied' | 'contested';
  owner: PlayerId | null;
  foreignOwner: PlayerId | null;
  bonusActive: boolean;
}

export interface OccupationReward {
  owner: PlayerId;
  period: TimePeriod;
}

function getOpponent(player: PlayerId): PlayerId {
  return player === 'P1' ? 'P2' : 'P1';
}

function getAgentsInPeriod(state: GameState, period: TimePeriod) {
  return [...state.players.P1.agents, ...state.players.P2.agents].filter(agent => agent.currentPeriod === period);
}

function hasEnemyControlledCity(state: GameState, period: TimePeriod, owner: PlayerId) {
  return [...state.map.cities.values()].some(city =>
    city.period === period
    && !city.destroyed
    && city.controlledBy !== null
    && city.controlledBy !== owner,
  );
}

export function getExclusiveTimelineOwner(state: GameState, period: TimePeriod): PlayerId | null {
  const agents = getAgentsInPeriod(state, period);
  if (agents.length === 0) return null;
  const owners = new Set(agents.map(agent => agent.owner));
  return owners.size === 1 ? agents[0].owner : null;
}

export function getRewardableTimelineOwner(state: GameState, period: TimePeriod): PlayerId | null {
  const owner = getExclusiveTimelineOwner(state, period);
  if (!owner) return null;
  return hasEnemyControlledCity(state, period, owner) ? null : owner;
}

export function isAgentForcedExposed(agent: Agent) {
  return agent.forcedExposurePeriod === agent.currentPeriod && !agent.deepCoverActive;
}

export function getTimelineVisualState(state: GameState, period: TimePeriod): TimelineVisualState {
  const agents = getAgentsInPeriod(state, period);
  const occupation = state.timelineOccupations[period];
  const owners = [...new Set(agents.map(agent => agent.owner))];
  const cleanOwner = getRewardableTimelineOwner(state, period);

  if (cleanOwner) {
    return {
      mode: 'occupied',
      owner: cleanOwner,
      foreignOwner: null,
      bonusActive: occupation.owner === cleanOwner && occupation.bonusActive,
    };
  }

  if (occupation.disabledByForeignControl) {
    return {
      mode: 'neutral',
      owner: null,
      foreignOwner: null,
      bonusActive: false,
    };
  }

  if (owners.length > 1) {
    const owner = occupation.owner ?? owners[0] ?? null;
    const foreignOwner = owner ? getOpponent(owner) : owners[1] ?? null;
    return {
      mode: 'contested',
      owner,
      foreignOwner,
      bonusActive: false,
    };
  }

  return {
    mode: 'neutral',
    owner: null,
    foreignOwner: null,
    bonusActive: false,
  };
}

export function applyOccupationTrackingAfterTurn(
  state: GameState,
  completedPlayer: PlayerId,
): { state: GameState; rewards: OccupationReward[] } {
  const timelineOccupations: Record<TimePeriod, TimelineOccupation> = {
    PAST: { ...state.timelineOccupations.PAST },
    PRESENT: { ...state.timelineOccupations.PRESENT },
    FUTURE: { ...state.timelineOccupations.FUTURE },
  };
  const rewards: OccupationReward[] = [];

  for (const period of ['PAST', 'PRESENT', 'FUTURE'] as TimePeriod[]) {
    const previous = state.timelineOccupations[period];
    const cleanOwner = getRewardableTimelineOwner(state, period);

    if (cleanOwner) {
      const next = {
        owner: cleanOwner,
        pending: false,
        bonusActive: previous.owner === cleanOwner ? previous.bonusActive : false,
        disabledByForeignControl: false,
      };

      if (completedPlayer === cleanOwner) {
        next.pending = true;
      } else if (previous.owner === cleanOwner && previous.pending) {
        rewards.push({ owner: cleanOwner, period });
        next.bonusActive = true;
      }

      timelineOccupations[period] = next;
      continue;
    }

    const shouldDisable = Boolean(
      previous.owner
      && completedPlayer === previous.owner
      && hasEnemyControlledCity(state, period, previous.owner),
    );

    if (shouldDisable) {
      timelineOccupations[period] = {
        owner: null,
        pending: false,
        bonusActive: false,
        disabledByForeignControl: true,
      };
      continue;
    }

    if (previous.disabledByForeignControl) {
      timelineOccupations[period] = {
        owner: null,
        pending: false,
        bonusActive: false,
        disabledByForeignControl: true,
      };
      continue;
    }

    timelineOccupations[period] = {
      owner: previous.owner,
      pending: false,
      bonusActive: false,
      disabledByForeignControl: false,
    };
  }

  return {
    state: { ...state, timelineOccupations },
    rewards,
  };
}

export function applyOccupationRewards(
  state: GameState,
  rewards: OccupationReward[],
  grantActionPoints: boolean,
): GameState {
  if (rewards.length === 0) return state;

  let nextState = { ...state };

  for (const reward of rewards) {
    const player = nextState.players[reward.owner];
    nextState = {
      ...nextState,
      players: {
        ...nextState.players,
        [reward.owner]: {
          ...player,
          intel: {
            ...player.intel,
            [reward.period]: player.intel[reward.period] + TIMELINE_OCCUPATION_INTEL_BONUS,
          },
          agents: player.agents.map(agent => (
            grantActionPoints && agent.currentPeriod === reward.period
              ? { ...agent, actionsRemaining: agent.actionsRemaining + TIMELINE_OCCUPATION_ACTION_BONUS }
              : agent
          )),
        },
      },
      notifications: [
        ...nextState.notifications,
        {
          id: `notif_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          type: 'TIMELINE_OCCUPIED',
          message: `${reward.owner} held ${reward.period} uncontested and gained +${TIMELINE_OCCUPATION_INTEL_BONUS} intel plus +${TIMELINE_OCCUPATION_ACTION_BONUS} action for agents in that timeline.`,
          round: nextState.round,
          forPlayer: 'BOTH',
          period: reward.period,
        },
      ],
    };
  }

  return nextState;
}
