// ============================================================
// CHRONODOX — Causal Collapse Rules
// ============================================================

import type { GameState, PlayerId, Notification } from '../types/game';

function makeNotif(message: string, forPlayer: PlayerId | 'BOTH'): Notification {
  return {
    id: `notif_${Date.now()}_${Math.random()}`,
    type: 'CAUSAL_COLLAPSE',
    message,
    round: 0,
    forPlayer,
  };
}

/**
 * Check win conditions after eliminations.
 */
export function applyCausalCollapseRules(state: GameState): GameState {
  let newState = { ...state };
  const notifications: Notification[] = [];

  for (const pid of ['P1', 'P2'] as PlayerId[]) {
    const opponent = pid === 'P1' ? 'P2' : 'P1';

    // PRIMARY WIN CONDITION: all past-origin agents eliminated
    const pastOriginAgents = newState.players[pid].agents.filter(a => a.period === 'PAST');
    if (pastOriginAgents.length === 0) {
      newState.winner = opponent;
      newState.winnerReason = `${pid} has no surviving past-origin agents remaining.`;
      notifications.push(makeNotif(`${pid}'s past-origin agents have all been eliminated. TIMELINE COLLAPSED.`, 'BOTH'));
      newState.notifications = [...newState.notifications, ...notifications];
      return newState;
    }

  }

  // ALL agents dead = game over
  const p1Total = newState.players.P1.agents.length;
  const p2Total = newState.players.P2.agents.length;
  if (p1Total === 0 && p2Total === 0) {
    newState.winner = null; // draw
    newState.winnerReason = 'All agents were eliminated.';
    notifications.push(makeNotif('All agents eliminated. DRAW.', 'BOTH'));
  } else if (p1Total === 0) {
    newState.winner = 'P2';
    newState.winnerReason = 'P1 has no agents remaining.';
    notifications.push(makeNotif('P1 all agents eliminated. P2 WINS.', 'BOTH'));
  } else if (p2Total === 0) {
    newState.winner = 'P1';
    newState.winnerReason = 'P2 has no agents remaining.';
    notifications.push(makeNotif('P2 all agents eliminated. P1 WINS.', 'BOTH'));
  }

  newState.notifications = [...newState.notifications, ...notifications];
  return newState;
}
