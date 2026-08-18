import type { MatchConfig, PlayerId } from '../types/game';
import type { SerializedGameState } from './gameSnapshot';

export type OnlineTransport = 'queue' | 'room';

export interface OnlinePresence {
  queueSeekers: number;
  waitingRooms: number;
  onlineNow: number;
}

export interface OnlineRoomSnapshot {
  roomCode: string;
  transport: OnlineTransport;
  revision: number;
  state: SerializedGameState;
  status: 'waiting' | 'countdown' | 'active';
  countdownStartAt: number | null;
  createdAt: number;
  readyPlayers: PlayerId[];
  connectedPlayers: PlayerId[];
  selections: Record<PlayerId, {
    selectedAgentId: string | null;
    selectedPeriod: string | null;
  }>;
  hostConnected: boolean;
  guestConnected: boolean;
  settings: MatchConfig;
}

export interface QueueJoinResponse {
  matched: boolean;
  ticketId?: string;
  roomCode?: string;
  playerId?: PlayerId;
  searchingCount: number;
}

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const API_BASE = env?.VITE_ONLINE_API_BASE?.replace(/\/$/, '') ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // ignore non-json failures
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function createOnlineClientId() {
  return `online_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function getPresence() {
  return request<OnlinePresence>('/presence', { method: 'GET' });
}

export function joinQueue(clientId: string, state: SerializedGameState) {
  return request<QueueJoinResponse>('/queue', {
    method: 'POST',
    body: JSON.stringify({ clientId, state }),
  });
}

export function joinQueueWithSettings(clientId: string, state: SerializedGameState, settings: MatchConfig) {
  return request<QueueJoinResponse>('/queue', {
    method: 'POST',
    body: JSON.stringify({ clientId, state, settings }),
  });
}

export function pollQueue(ticketId: string) {
  return request<QueueJoinResponse>(`/queue/${ticketId}`, { method: 'GET' });
}

export function cancelQueue(ticketId: string) {
  return request<{ ok: true }>(`/queue/${ticketId}`, { method: 'DELETE' });
}

export function createPrivateRoom(clientId: string, state: SerializedGameState, settings: MatchConfig) {
  return request<{ roomCode: string; playerId: PlayerId; revision: number }>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ clientId, state, settings }),
  });
}

export function joinPrivateRoom(clientId: string, roomCode: string) {
  return request<{ roomCode: string; playerId: PlayerId; revision: number }>(`/rooms/${normalizeRoomCode(roomCode)}/join`, {
    method: 'POST',
    body: JSON.stringify({ clientId }),
  });
}

export function getRoomSnapshot(roomCode: string) {
  return request<OnlineRoomSnapshot>(`/rooms/${normalizeRoomCode(roomCode)}/state`, { method: 'GET' });
}

export function pushRoomSnapshot(roomCode: string, clientId: string, revision: number, state: SerializedGameState) {
  return request<{ revision: number }>(`/rooms/${normalizeRoomCode(roomCode)}/state`, {
    method: 'POST',
    body: JSON.stringify({ clientId, revisionBase: revision, state }),
  });
}

export function setRoomReady(roomCode: string, clientId: string, ready: boolean) {
  return request<OnlineRoomSnapshot>(`/rooms/${normalizeRoomCode(roomCode)}/ready`, {
    method: 'POST',
    body: JSON.stringify({ clientId, ready }),
  });
}

export function updateRoomSettings(roomCode: string, clientId: string, settings: MatchConfig) {
  return request<OnlineRoomSnapshot>(`/rooms/${normalizeRoomCode(roomCode)}/settings`, {
    method: 'POST',
    body: JSON.stringify({ clientId, settings }),
  });
}

export function pushRoomPresence(
  roomCode: string,
  clientId: string,
  selectedAgentId: string | null,
  selectedPeriod: string | null,
) {
  return request<OnlineRoomSnapshot>(`/rooms/${normalizeRoomCode(roomCode)}/presence`, {
    method: 'POST',
    body: JSON.stringify({ clientId, selectedAgentId, selectedPeriod }),
  });
}

export function leaveRoom(roomCode: string, clientId: string) {
  return request<{ ok: true }>(`/rooms/${normalizeRoomCode(roomCode)}/leave`, {
    method: 'POST',
    body: JSON.stringify({ clientId }),
  });
}
