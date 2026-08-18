import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import {
  DEFAULT_AI_DIFFICULTY,
  DEFAULT_TURN_TIMER_SECONDS,
  MAX_TURN_TIMER_SECONDS,
  MIN_TURN_TIMER_SECONDS,
  type MatchConfig,
  type PlayerId,
} from '../types/game';

interface MatchmakingLobbyProps {
  mode: 'queue-search' | 'room';
  transport?: 'queue' | 'room';
  roomCode?: string | null;
  queueSeekers?: number | null;
  onlineNow?: number | null;
  joinedAt: number;
  localReady?: boolean;
  opponentReady?: boolean;
  countdownEndsAt?: number | null;
  matchFound?: boolean;
  message: string;
  error?: string | null;
  busy?: boolean;
  readyEnabled?: boolean;
  settings?: MatchConfig | null;
  localPlayer?: PlayerId | null;
  partnerJoined?: boolean;
  settingsBusy?: boolean;
  onReady?: () => void;
  onUpdateSettings?: (settings: MatchConfig) => void | Promise<void>;
  onLeave: () => void;
  allowLeave?: boolean;
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatMatchRule(settings?: MatchConfig | null) {
  if (!settings?.turnTimerEnabled) return 'NO TURN TIMER';
  const seconds = Number.isFinite(settings.turnTimerSeconds) ? settings.turnTimerSeconds : DEFAULT_TURN_TIMER_SECONDS;
  return `TURN TIMER ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function clampTimerSeconds(seconds: number) {
  if (!Number.isFinite(seconds)) return DEFAULT_TURN_TIMER_SECONDS;
  return Math.min(MAX_TURN_TIMER_SECONDS, Math.max(MIN_TURN_TIMER_SECONDS, Math.round(seconds)));
}

function normalizeLobbySettings(settings?: MatchConfig | null): MatchConfig {
  return {
    turnTimerEnabled: Boolean(settings?.turnTimerEnabled),
    turnTimerSeconds: clampTimerSeconds(settings?.turnTimerSeconds ?? DEFAULT_TURN_TIMER_SECONDS),
    aiDifficulty: settings?.aiDifficulty ?? DEFAULT_AI_DIFFICULTY,
  };
}

export function MatchmakingLobby({
  mode,
  transport = 'room',
  roomCode,
  queueSeekers,
  onlineNow,
  joinedAt,
  localReady = false,
  opponentReady = false,
  countdownEndsAt,
  matchFound = false,
  message,
  error,
  busy = false,
  readyEnabled = true,
  settings = null,
  localPlayer = null,
  partnerJoined = false,
  settingsBusy = false,
  onReady,
  onUpdateSettings,
  onLeave,
  allowLeave = true,
}: MatchmakingLobbyProps) {
  const { playSoundEffect } = useGameStore();
  const [now, setNow] = useState(Date.now());
  const [draftSettings, setDraftSettings] = useState(() => normalizeLobbySettings(settings));
  const [syncedSettings, setSyncedSettings] = useState(() => normalizeLobbySettings(settings));
  const [draftSeconds, setDraftSeconds] = useState(() => String(normalizeLobbySettings(settings).turnTimerSeconds));
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const nextSynced = normalizeLobbySettings(settings);
    const syncedChanged =
      nextSynced.turnTimerEnabled !== syncedSettings.turnTimerEnabled
      || nextSynced.turnTimerSeconds !== syncedSettings.turnTimerSeconds;
    if (!syncedChanged) return;

    const draftIsDirty =
      draftSettings.turnTimerEnabled !== syncedSettings.turnTimerEnabled
      || draftSettings.turnTimerSeconds !== syncedSettings.turnTimerSeconds;

    setSyncedSettings(nextSynced);
    if (!draftIsDirty) {
      setDraftSettings(nextSynced);
      setDraftSeconds(String(nextSynced.turnTimerSeconds));
    }
  }, [draftSettings, settings, syncedSettings]);

  useEffect(() => {
    setDraftSeconds(current => (
      current.trim() === '' ? current : String(draftSettings.turnTimerSeconds)
    ));
  }, [draftSettings.turnTimerSeconds]);

  const elapsed = formatElapsed(now - joinedAt);
  const countdownValue = countdownEndsAt
    ? Math.max(0, Math.ceil((countdownEndsAt - now) / 1000))
    : null;
  const title = mode === 'queue-search' ? 'MATCHMAKING QUEUE' : 'STAGING ROOM';
  const showQueueMetrics = (mode === 'queue-search' || transport === 'queue') && !matchFound;
  const partnerStatus = !partnerJoined ? 'AWAITING JOIN' : (opponentReady ? 'READY' : 'STANDBY');
  const hostCanEditSettings = mode === 'room' && transport === 'room' && localPlayer === 'P1' && Boolean(onUpdateSettings);
  const draftIsDirty =
    draftSettings.turnTimerEnabled !== syncedSettings.turnTimerEnabled
    || draftSettings.turnTimerSeconds !== syncedSettings.turnTimerSeconds;

  const resolveDraftSettings = (): MatchConfig | null => {
    if (draftSeconds.trim() === '') {
      setDraftSeconds(String(draftSettings.turnTimerSeconds));
      return null;
    }

    const parsed = Number(draftSeconds);
    const isValid = Number.isInteger(parsed) && parsed >= MIN_TURN_TIMER_SECONDS && parsed <= MAX_TURN_TIMER_SECONDS;
    if (!isValid) {
      setDraftSeconds(String(draftSettings.turnTimerSeconds));
      return null;
    }

    return { ...draftSettings, turnTimerSeconds: parsed };
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 py-12 text-white"
      style={{
        background: `
          radial-gradient(circle at top left, rgba(123,79,212,0.22), transparent 28%),
          radial-gradient(circle at 82% 16%, rgba(0,200,160,0.18), transparent 24%),
          radial-gradient(circle at 50% 110%, rgba(255,107,53,0.18), transparent 30%),
          linear-gradient(180deg, #03040b 0%, #07101c 48%, #04050c 100%)
        `,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-3xl rounded-[32px] border border-[#ffffff16] bg-[#07101ad9] p-8 shadow-[0_30px_120px_rgba(0,0,0,0.42)] backdrop-blur"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.42em] text-[#ffffff55]">Temporal Operations Command</div>
            <div className="mt-3 font-['Orbitron'] text-3xl tracking-[0.22em] text-[#f4f7ff]">{title}</div>
            <div className="mt-3 font-['Share_Tech_Mono'] text-[12px] leading-relaxed text-[#dbe9ff99]">
              {error ?? message}
            </div>
          </div>
          {allowLeave ? (
            <button
              type="button"
              onClick={() => {
                playSoundEffect('ui_click');
                onLeave();
              }}
              className="rounded border border-[#ffffff22] px-4 py-2 font-['Share_Tech_Mono'] text-[11px] tracking-[0.2em] text-[#ffffff88] transition-colors hover:text-white"
            >
              RETURN TO HOME
            </button>
          ) : (
            <div className="rounded border border-[#ffcf8a33] bg-[#ffcf8a10] px-4 py-2 font-['Share_Tech_Mono'] text-[10px] tracking-[0.16em] text-[#ffcf8a]">
              HOST ROOM LOCKED
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {showQueueMetrics ? (
            <>
              <div className="rounded-[22px] border border-[#00c8a044] bg-[#00c8a012] p-4">
                <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.32em] text-[#ffffff44]">Queue Time</div>
                <div className="mt-2 font-['Orbitron'] text-2xl text-[#b8ffee]">{elapsed}</div>
              </div>
              <div className="rounded-[22px] border border-[#ffb36655] bg-[#2a1608aa] p-4">
                <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.32em] text-[#ffffff44]">Searching Now</div>
                <div className="mt-2 font-['Orbitron'] text-2xl text-[#ffd7b3]">{queueSeekers ?? '--'}</div>
              </div>
              <div className="rounded-[22px] border border-[#7b4fd455] bg-[#7b4fd414] p-4">
                <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.32em] text-[#ffffff44]">Online Now</div>
                <div className="mt-2 font-['Orbitron'] text-2xl text-[#d5c1ff]">{onlineNow ?? '--'}</div>
              </div>
              <div className="rounded-[22px] border border-[#8df5df55] bg-[#061610cc] p-4 md:col-span-3">
                <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.32em] text-[#ffffff44]">Mission Rule</div>
                <div className="mt-2 font-['Orbitron'] text-lg text-[#8df5df]">{formatMatchRule(settings)}</div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-[22px] border border-[#ffcf8a55] bg-[#ffcf8a12] p-4">
                <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.32em] text-[#ffffff44]">
                  {transport === 'queue' ? 'Your Status' : 'Room Code'}
                </div>
                <div className="mt-2 font-['Orbitron'] text-lg text-[#ffcf8a]">
                  {transport === 'queue' ? (localReady ? 'READY' : 'STANDBY') : (roomCode ?? '------')}
                </div>
              </div>
              <div className="rounded-[22px] border border-[#00c8a044] bg-[#00c8a012] p-4">
                <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.32em] text-[#ffffff44]">
                  {transport === 'queue' ? 'Partner Status' : 'Your Status'}
                </div>
                <div className="mt-2 font-['Orbitron'] text-lg text-[#b8ffee]">
                  {transport === 'queue' ? (opponentReady ? 'READY' : 'STANDBY') : (localReady ? 'READY' : 'STANDBY')}
                </div>
              </div>
              <div className="rounded-[22px] border border-[#7b4fd455] bg-[#7b4fd414] p-4">
                <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.32em] text-[#ffffff44]">
                  {transport === 'queue' ? 'Mission Rule' : 'Partner Status'}
                </div>
                <div className="mt-2 font-['Orbitron'] text-lg text-[#d5c1ff]">
                  {transport === 'queue'
                    ? formatMatchRule(settings)
                    : partnerStatus}
                </div>
              </div>
              {transport !== 'queue' && (
                <div className="rounded-[22px] border border-[#8df5df55] bg-[#061610cc] p-4 md:col-span-3">
                  <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.32em] text-[#ffffff44]">Mission Rule</div>
                  <div className="mt-2 font-['Orbitron'] text-lg text-[#8df5df]">{formatMatchRule(settings)}</div>
                </div>
              )}
            </>
          )}
        </div>

        {mode === 'room' && transport === 'room' && (
          <div className="mt-6 rounded-[24px] border border-[#ffffff18] bg-[#050b12cc] p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.34em] text-[#ffffff55]">Room Timer Control</div>
                <div className="mt-2 font-['Share_Tech_Mono'] text-[11px] leading-relaxed text-[#dbe9ff88]">
                  {hostCanEditSettings
                    ? 'The host may keep adjusting the room timer before insertion. Confirming a new value resets the ready check for both operatives.'
                    : 'The host controls the room timer. Confirmed changes appear here automatically.'}
                </div>
              </div>
              <div className="rounded border border-[#8df5df33] bg-[#06161099] px-3 py-2 font-['Share_Tech_Mono'] text-[10px] tracking-[0.16em] text-[#8df5df]">
                {formatMatchRule(draftIsDirty ? draftSettings : settings)}
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <button
                  type="button"
                      disabled={!hostCanEditSettings || settingsBusy}
                  onClick={() => setDraftSettings(current => ({ ...current, turnTimerEnabled: !current.turnTimerEnabled }))}
                  className="rounded border border-[#8df5df55] bg-[#061610cc] px-4 py-2 font-['Orbitron'] text-xs tracking-[0.16em] text-[#8df5df] transition-colors hover:bg-[#0a2318] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {formatMatchRule(draftSettings)}
                </button>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[-15, -30, 15, 30].map(delta => (
                    <button
                      key={delta}
                      type="button"
                      disabled={!hostCanEditSettings || settingsBusy || !draftSettings.turnTimerEnabled}
                      onClick={() => setDraftSettings(current => ({
                        ...current,
                        turnTimerSeconds: clampTimerSeconds(current.turnTimerSeconds + delta),
                      }))}
                      className="rounded border border-[#ffffff22] px-2 py-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff88] transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {delta > 0 ? `+${delta}s` : `${delta}s`}
                    </button>
                  ))}
                </div>
                <label className="mt-3 block font-['Share_Tech_Mono'] text-[10px] text-[#ffffff66]">
                  Exact Seconds
                  <input
                    type="number"
                    min={MIN_TURN_TIMER_SECONDS}
                    max={MAX_TURN_TIMER_SECONDS}
                    step={1}
                    disabled={!hostCanEditSettings || settingsBusy || !draftSettings.turnTimerEnabled}
                    value={draftSeconds}
                    onChange={(event) => setDraftSeconds(event.target.value)}
                    onBlur={() => {
                      const nextDraft = resolveDraftSettings();
                      if (nextDraft) setDraftSettings(nextDraft);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        const nextDraft = resolveDraftSettings();
                        if (nextDraft) setDraftSettings(nextDraft);
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        setDraftSeconds(String(draftSettings.turnTimerSeconds));
                        event.currentTarget.blur();
                      }
                    }}
                    className="mt-2 w-full rounded border border-[#ffffff22] bg-[#02060dcc] px-3 py-2 font-['Share_Tech_Mono'] text-[11px] text-white outline-none disabled:cursor-not-allowed disabled:opacity-35"
                  />
                </label>
              </div>

              {hostCanEditSettings ? (
                <button
                  type="button"
                  disabled={settingsBusy || !draftIsDirty}
                  onClick={() => {
                    const nextDraft = resolveDraftSettings();
                    if (!nextDraft) return;
                    setDraftSettings(nextDraft);
                    playSoundEffect('ui_click');
                    void onUpdateSettings?.(nextDraft);
                  }}
                  className="rounded border border-[#ffcf8a55] bg-[#ffcf8a14] px-5 py-3 font-['Orbitron'] text-xs tracking-[0.18em] text-[#ffcf8a] transition-colors hover:bg-[#ffcf8a22] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {settingsBusy ? 'UPDATING TIMER...' : 'CONFIRM TIMER'}
                </button>
              ) : (
                <div className="rounded border border-[#ffffff18] bg-[#08101acc] px-4 py-3 font-['Share_Tech_Mono'] text-[10px] leading-relaxed text-[#dbe9ff88]">
                  Waiting for the host to confirm any rule changes before launch.
                </div>
              )}
            </div>
          </div>
        )}

        {matchFound && (
          <div className="mt-6 rounded-[22px] border border-[#8df5df55] bg-[#061610cc] px-5 py-4 text-center">
            <div className="font-['Orbitron'] text-lg tracking-[0.22em] text-[#8df5df]">MATCH FOUND</div>
            <div className="mt-2 font-['Share_Tech_Mono'] text-[11px] text-[#dffdfa99]">
              Another operative is on the line. Confirm ready when you are set.
            </div>
          </div>
        )}

        {mode === 'room' && (
          <div className="mt-8 rounded-[24px] border border-[#ffffff18] bg-[#050b12cc] p-6 text-center">
            <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.34em] text-[#ffffff55]">
              {countdownValue !== null ? 'Launch Window' : 'Ready Check'}
            </div>
            {countdownValue !== null && (
              <>
                <div className="mt-3 font-['Orbitron'] text-6xl text-[#dff7ff]">{countdownValue}</div>
                <div className="mt-2 font-['Share_Tech_Mono'] text-[11px] text-[#dbe9ff88]">
                  {countdownValue > 0
                    ? 'Countdown live. Either operative may still cancel ready until insertion completes.'
                    : 'Insertion imminent. Stand by for blackout.'}
                </div>
              </>
            )}
            {countdownValue === null ? (
              <div className="mt-3 font-['Share_Tech_Mono'] text-[12px] leading-relaxed text-[#dbe9ff99]">
                Confirm you are in position. The match begins only after both operatives mark themselves ready.
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                playSoundEffect('ui_click');
                onReady?.();
              }}
              disabled={!onReady || busy || !readyEnabled || countdownValue === 0}
              className="mt-5 rounded border border-[#dff7ff55] bg-[#dff7ff14] px-6 py-3 font-['Orbitron'] text-sm tracking-[0.18em] text-[#dff7ff] transition-colors hover:bg-[#dff7ff20] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {localReady ? 'CANCEL READY' : 'READY'}
            </button>
            {!readyEnabled && (
              <div className="mt-3 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff66]">
                Waiting for the room to finish linking both operatives.
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
