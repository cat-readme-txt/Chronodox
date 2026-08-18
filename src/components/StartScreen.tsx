// ============================================================
// CHRONODOX — Start Screen
// ============================================================

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import {
  DEFAULT_AI_DIFFICULTY,
  DEFAULT_TURN_TIMER_SECONDS,
  MAX_TURN_TIMER_SECONDS,
  MIN_TURN_TIMER_SECONDS,
  type AiDifficulty,
  type MatchConfig,
} from '../types/game';
import { AI_DIFFICULTY_OPTIONS, getAiDifficultyLabel } from '../engine/aiDifficulty';

function clampTimerSeconds(seconds: number) {
  if (!Number.isFinite(seconds)) return DEFAULT_TURN_TIMER_SECONDS;
  return Math.min(MAX_TURN_TIMER_SECONDS, Math.max(MIN_TURN_TIMER_SECONDS, Math.round(seconds)));
}

function createMatchConfig(
  turnTimerEnabled: boolean,
  turnTimerSeconds: number,
  aiDifficulty: AiDifficulty = DEFAULT_AI_DIFFICULTY,
): MatchConfig {
  return {
    turnTimerEnabled,
    turnTimerSeconds: clampTimerSeconds(turnTimerSeconds),
    aiDifficulty,
  };
}

function formatTimerLabel(enabled: boolean, seconds: number) {
  if (!enabled) return 'NO TURN TIMER';
  const clamped = clampTimerSeconds(seconds);
  return `TURN TIMER ${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, '0')}`;
}

function ClockworkOrnament({
  side,
  primary,
  secondary,
}: {
  side: 'left' | 'right';
  primary: string;
  secondary: string;
}) {
  const edgeClass = side === 'left' ? 'left-0' : 'right-0';
  const sideOffset = side === 'left' ? 'left-0' : 'right-0';
  const petalAngles = Array.from({ length: 18 }, (_, index) => index * 20);
  const innerAngles = Array.from({ length: 12 }, (_, index) => index * 30);
  const arcAngles = Array.from({ length: 8 }, (_, index) => index * 45);
  const bloomTransform = side === 'left' ? 'translate(-50%, -50%)' : 'translate(50%, -50%)';

  return (
    <div className={`absolute ${edgeClass} top-1/2 -translate-y-1/2 pointer-events-none`}>
      <div className="relative h-[38rem] w-[min(34vw,26rem)]">
        <motion.div
          className={`absolute top-1/2 ${sideOffset} h-[26rem] w-[26rem] -translate-y-1/2`}
          style={{ transform: bloomTransform }}
          animate={{ rotate: side === 'left' ? 360 : -360, scale: [0.98, 1.04, 0.98] }}
          transition={{
            rotate: { duration: 40, repeat: Infinity, ease: 'linear' },
            scale: { duration: 8, repeat: Infinity, ease: 'easeInOut' },
          }}
        >
          <svg viewBox="0 0 420 420" className="h-full w-full overflow-visible">
            <defs>
              <radialGradient id={`bloom-fill-${side}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={secondary} stopOpacity="0.14" />
                <stop offset="52%" stopColor={primary} stopOpacity="0.06" />
                <stop offset="100%" stopColor={primary} stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="210" cy="210" r="132" fill={`url(#bloom-fill-${side})`} />
            {petalAngles.map((angle, index) => (
              <g key={`outer-${side}-${angle}`} transform={`rotate(${angle} 210 210)`}>
                <ellipse
                  cx="210"
                  cy="92"
                  rx={index % 3 === 0 ? 22 : 16}
                  ry={index % 2 === 0 ? 86 : 72}
                  fill="none"
                  stroke={index % 2 === 0 ? primary : secondary}
                  strokeOpacity={index % 3 === 0 ? 0.34 : 0.2}
                  strokeWidth={index % 4 === 0 ? 1.2 : 0.9}
                />
              </g>
            ))}
            {innerAngles.map((angle, index) => (
              <g key={`inner-${side}-${angle}`} transform={`rotate(${angle} 210 210)`}>
                <path
                  d="M210 132 C226 154 236 178 210 212 C184 178 194 154 210 132Z"
                  fill="none"
                  stroke={index % 2 === 0 ? secondary : primary}
                  strokeOpacity={0.28}
                  strokeWidth={1}
                />
              </g>
            ))}
            {arcAngles.map((angle, index) => (
              <g key={`arc-${side}-${angle}`} transform={`rotate(${angle} 210 210)`}>
                <line
                  x1="210"
                  y1="148"
                  x2="210"
                  y2="46"
                  stroke={index % 2 === 0 ? primary : secondary}
                  strokeOpacity="0.18"
                  strokeWidth="0.9"
                />
              </g>
            ))}
            <circle cx="210" cy="210" r="18" fill={secondary} fillOpacity="0.16" />
            <circle cx="210" cy="210" r="8" fill={primary} fillOpacity="0.4" />
          </svg>
        </motion.div>

        <motion.div
          className={`absolute top-1/2 ${sideOffset} h-[26rem] w-[26rem] -translate-y-1/2`}
          style={{ transform: bloomTransform }}
          animate={{ rotate: side === 'left' ? -360 : 360, scale: [1.03, 0.95, 1.03] }}
          transition={{
            rotate: { duration: 24, repeat: Infinity, ease: 'linear' },
            scale: { duration: 7, repeat: Infinity, ease: 'easeInOut' },
          }}
        >
          <svg viewBox="0 0 420 420" className="h-full w-full overflow-visible">
            {petalAngles.map((angle, index) => (
              <g key={`mesh-${side}-${angle}`} transform={`rotate(${angle + 10} 210 210)`}>
                <path
                  d="M210 118 L252 210 L210 302 L168 210 Z"
                  fill="none"
                  stroke={index % 2 === 0 ? 'rgba(255,255,255,0.14)' : primary}
                  strokeOpacity={index % 2 === 0 ? 0.14 : 0.14}
                  strokeWidth={0.8}
                />
              </g>
            ))}
          </svg>
        </motion.div>

      </div>
    </div>
  );
}

interface StartScreenProps {
  onStart: (mode: 'vs_ai' | 'local_2p', matchConfig?: MatchConfig) => void;
  onContinueSavedVsAi: () => void;
  onStartNewVsAi: (matchConfig?: MatchConfig) => void;
  onStartTutorial: () => void;
  onStartOnlineQueue: (matchConfig: MatchConfig) => void | Promise<void>;
  onCreateOnlineRoom: (matchConfig: MatchConfig) => void | Promise<void>;
  onJoinOnlineRoom: (roomCode: string) => void | Promise<void>;
  onCancelOnline: () => void | Promise<void>;
  onlineStatus: {
    loading: boolean;
    error: string | null;
    queueSeekers: number | null;
    mode: 'idle' | 'queue' | 'room-host';
    ticketId: string | null;
    roomCode: string | null;
    message: string | null;
  };
  hasSavedVsAiGame: boolean;
}

export function StartScreen({
  onStart,
  onContinueSavedVsAi,
  onStartNewVsAi,
  onStartTutorial,
  onStartOnlineQueue,
  onCreateOnlineRoom,
  onJoinOnlineRoom,
  onCancelOnline,
  onlineStatus,
  hasSavedVsAiGame,
}: StartScreenProps) {
  const { openSettings, playSoundEffect } = useGameStore();
  const [hovered, setHovered] = useState<string | null>(null);
  const [showLocalOptions, setShowLocalOptions] = useState(false);
  const [showVsAiOptions, setShowVsAiOptions] = useState(false);
  const [showVsAiResumePrompt, setShowVsAiResumePrompt] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [vsAiDifficulty, setVsAiDifficulty] = useState<AiDifficulty>(DEFAULT_AI_DIFFICULTY);
  const [vsAiTurnTimerEnabled, setVsAiTurnTimerEnabled] = useState(false);
  const [vsAiTurnTimerSeconds, setVsAiTurnTimerSeconds] = useState(DEFAULT_TURN_TIMER_SECONDS);
  const [localTurnTimerEnabled, setLocalTurnTimerEnabled] = useState(true);
  const [localTurnTimerSeconds, setLocalTurnTimerSeconds] = useState(DEFAULT_TURN_TIMER_SECONDS);
  const [queueTurnTimerEnabled, setQueueTurnTimerEnabled] = useState(true);
  const [queueTurnTimerSeconds, setQueueTurnTimerSeconds] = useState(DEFAULT_TURN_TIMER_SECONDS);
  const [roomTurnTimerEnabled, setRoomTurnTimerEnabled] = useState(true);
  const [roomTurnTimerSeconds, setRoomTurnTimerSeconds] = useState(DEFAULT_TURN_TIMER_SECONDS);

  const handleStart = (mode: 'vs_ai' | 'local_2p', matchConfig?: MatchConfig) => {
    if (mode === 'vs_ai' && hasSavedVsAiGame) {
      playSoundEffect('ui_click');
      setShowVsAiResumePrompt(current => !current);
      return;
    }
    if (mode === 'vs_ai') {
      playSoundEffect('ui_click');
      setShowVsAiOptions(current => !current);
      return;
    }
    if (mode === 'local_2p') {
      playSoundEffect('ui_click');
      setShowLocalOptions(current => !current);
      return;
    }
    onStart(mode, matchConfig);
  };

  const launchVsAi = () => {
    const config = createMatchConfig(vsAiTurnTimerEnabled, vsAiTurnTimerSeconds, vsAiDifficulty);
    setShowVsAiOptions(false);
    if (hasSavedVsAiGame) {
      onStartNewVsAi(config);
      return;
    }
    onStart('vs_ai', config);
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start relative overflow-hidden"
      style={{
        background: `
          radial-gradient(circle at 50% -8%, rgba(0,212,255,0.18), transparent 20%),
          radial-gradient(circle at 18% 20%, rgba(123,79,212,0.22), transparent 28%),
          radial-gradient(circle at 84% 26%, rgba(0,200,160,0.18), transparent 24%),
          linear-gradient(180deg, #02040b 0%, #07111f 46%, #050811 100%)
        `,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_62%)] pointer-events-none" />
      <div className="absolute right-6 top-6 z-20">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              playSoundEffect('ui_click');
              onStartTutorial();
            }}
            className="rounded border border-[#ffffff22] bg-[#0a111bcc] px-3 py-2 font-['Share_Tech_Mono'] text-[11px] text-[#ffffff88] transition-colors hover:text-white"
          >
            TUTORIAL
          </button>
          <button
            type="button"
            onClick={() => {
              playSoundEffect('ui_click');
              openSettings();
            }}
            className="rounded border border-[#ffffff22] bg-[#0a111bcc] px-3 py-2 font-['Share_Tech_Mono'] text-[11px] text-[#ffffff88] transition-colors hover:text-white"
          >
            SETTINGS
          </button>
        </div>
      </div>
      <div className="absolute inset-0 pointer-events-none opacity-18"
        style={{
          backgroundImage: `
            radial-gradient(circle at 12% 18%, rgba(255,255,255,0.14) 0 1px, transparent 1.5px),
            radial-gradient(circle at 76% 16%, rgba(255,255,255,0.12) 0 1px, transparent 1.5px),
            radial-gradient(circle at 20% 72%, rgba(255,255,255,0.10) 0 1px, transparent 1.5px),
            radial-gradient(circle at 82% 76%, rgba(255,255,255,0.10) 0 1px, transparent 1.5px),
            linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.22) 100%)
          `,
        }}
      />

      <div className="absolute inset-0 opacity-6"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '160px 160px',
        }}
      />

      <div className="absolute inset-0 pointer-events-none opacity-12"
        style={{
          backgroundImage: `
            repeating-linear-gradient(90deg, transparent 0 220px, rgba(0,212,255,0.025) 220px 221px),
            repeating-linear-gradient(0deg, transparent 0 220px, rgba(123,79,212,0.018) 220px 221px)
          `,
        }}
      />

      <ClockworkOrnament side="left" primary="#00d4ff" secondary="#7b4fd4" />
      <ClockworkOrnament side="right" primary="#00c8a0" secondary="#ff6b35" />

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        className="relative z-10 mt-24 mb-20 flex flex-col items-center max-w-3xl w-full px-8"
      >
        <div
          className="absolute inset-0 rounded-[32px] border border-[#ffffff14] pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.012))',
            boxShadow: '0 30px 120px rgba(0,0,0,0.58)',
          }}
        />
        <div className="absolute inset-x-6 top-6 h-px bg-gradient-to-r from-transparent via-[#ffffff1f] to-transparent pointer-events-none" />
        <div className="absolute inset-y-10 left-8 w-px bg-gradient-to-b from-transparent via-[#7b4fd444] to-transparent pointer-events-none" />
        <div className="absolute inset-y-10 right-8 w-px bg-gradient-to-b from-transparent via-[#00c8a044] to-transparent pointer-events-none" />

        <div className="relative w-full flex flex-col items-center px-10 pt-12 pb-24">
        <div className="mb-4 flex items-center gap-3 text-[10px] font-['Rajdhani'] uppercase tracking-[0.42em] text-[#ffffff50]">
          <span className="h-px w-12 bg-gradient-to-r from-transparent to-[#7b4fd4]" />
          Temporal Operations Command
          <span className="h-px w-12 bg-gradient-to-l from-transparent to-[#00c8a0]" />
        </div>
        {/* Title */}
        <div
          className="font-['Orbitron'] font-black text-7xl text-center mb-2 tracking-widest"
          style={{
            background: 'linear-gradient(90deg, #7b4fd4, #00c8a0, #ff6b35)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: 'none',
          }}
        >
          CHRONODOX
        </div>

        <div className="text-center text-[#ffffff45] font-['Share_Tech_Mono'] mb-4 tracking-[0.35em] text-xs">
          CLASSIFIED CHRONO-ESPIONAGE SIMULATION
        </div>

        <div className="mb-12 flex items-center gap-3 text-[10px] font-['Rajdhani'] uppercase tracking-[0.28em] text-[#ffffff55]">
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-[#7b4fd4]" />
          Infiltrate timelines. Hide intent. Secure the origin.
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-[#ff6b35]" />
        </div>

        <div className="w-full mb-12 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'Status', value: 'Secure Channel', tint: '#7b4fd4' },
            { label: 'Network', value: 'Three Timelines Synced', tint: '#00c8a0' },
            { label: 'Directive', value: 'Begin Operation', tint: '#ff6b35' },
          ].map(card => (
            <div
              key={card.label}
              className="rounded-[22px] border px-4 py-4"
              style={{
                borderColor: card.tint + '44',
                background: `linear-gradient(180deg, ${card.tint}14, rgba(255,255,255,0.02))`,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              <div className="font-['Rajdhani'] text-[10px] uppercase tracking-[0.28em] text-[#ffffff40] mb-2">{card.label}</div>
              <div className="font-['Orbitron'] text-sm tracking-[0.14em]" style={{ color: card.tint }}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Mode buttons */}
        <div className="flex gap-4 w-full">
          {[
            { mode: 'vs_ai' as const, label: 'VS AI', sub: 'Single player', color: '#00c8a0' },
            { mode: 'local_2p' as const, label: 'LOCAL 2P', sub: 'In-person or online', color: '#7b4fd4' },
          ].map(({ mode, label, sub, color }) => (
            <motion.button
              key={mode}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onHoverStart={() => setHovered(mode)}
              onHoverEnd={() => setHovered(null)}
              onClick={() => handleStart(mode)}
              className="flex-1 py-5 rounded-lg font-['Orbitron'] font-bold tracking-widest transition-all relative overflow-hidden"
              style={{
                border: `1px solid ${color}`,
                color,
                background: hovered === mode
                  ? `linear-gradient(180deg, ${color}26, rgba(255,255,255,0.04))`
                  : `linear-gradient(180deg, ${color}10, rgba(255,255,255,0.02))`,
                boxShadow: hovered === mode ? `0 0 30px ${color}33` : '0 12px 28px rgba(0,0,0,0.18)',
              }}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-50" />
              <div className="text-base">{label}</div>
              <div className="text-[10px] opacity-50 font-['Share_Tech_Mono'] mt-1">{sub}</div>
            </motion.button>
          ))}
        </div>
        {showLocalOptions && (
          <div className="mt-5 hidden w-full rounded-[22px] border border-[#ffffff18] bg-[#08101aca] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <button
                type="button"
                onClick={() => onStart('local_2p', createMatchConfig(localTurnTimerEnabled, localTurnTimerSeconds))}
                className="rounded-[18px] border border-[#7b4fd466] bg-[#7b4fd414] px-4 py-4 text-left transition-colors hover:bg-[#7b4fd424]"
              >
                <div className="font-['Orbitron'] text-sm tracking-[0.14em] text-[#d6c3ff]">PLAY IN PERSON</div>
                <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff66]">One machine. Pass the terminal after each turn window.</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  playSoundEffect('ui_click');
                  void onStartOnlineQueue(createMatchConfig(queueTurnTimerEnabled, queueTurnTimerSeconds));
                }}
                disabled={onlineStatus.loading}
                className="rounded-[18px] border border-[#00c8a066] bg-[#00c8a014] px-4 py-4 text-left transition-colors hover:bg-[#00c8a024] disabled:cursor-wait disabled:opacity-60"
              >
                <div className="font-['Orbitron'] text-sm tracking-[0.14em] text-[#b8ffee]">ONLINE QUEUE</div>
                <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff66]">Match with anyone currently searching on the host.</div>
                <div className="mt-3 rounded border border-[#ffb36655] bg-[#2a1608aa] px-3 py-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffd7b3]">
                  {onlineStatus.queueSeekers === null
                    ? 'Warning: queue traffic is unknown until the host responds.'
                    : `Warning: only ${onlineStatus.queueSeekers} operative${onlineStatus.queueSeekers === 1 ? '' : 's'} currently searching. A match may take time.`}
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  playSoundEffect('ui_click');
                  void onCreateOnlineRoom(createMatchConfig(roomTurnTimerEnabled, roomTurnTimerSeconds));
                }}
                disabled={onlineStatus.loading}
                className="rounded-[18px] border border-[#ff6b3566] bg-[#ff6b3512] px-4 py-4 text-left transition-colors hover:bg-[#ff6b3522] disabled:cursor-wait disabled:opacity-60"
              >
                <div className="font-['Orbitron'] text-sm tracking-[0.14em] text-[#ffd1c1]">HOST PRIVATE ROOM</div>
                <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff66]">Generate a room code and share it with a known opponent.</div>
              </button>
            </div>
            <div className="mt-4 rounded-[18px] border border-[#ffffff14] bg-[#050c14cc] p-4">
              <div className="font-['Orbitron'] text-xs tracking-[0.16em] text-[#f3f6ff]">JOIN PRIVATE ROOM</div>
              <div className="mt-3 flex flex-col gap-3 md:flex-row">
                <input
                  value={roomCodeInput}
                  onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  placeholder="ROOM CODE"
                  className="flex-1 rounded border border-[#ffffff22] bg-[#02060dcc] px-4 py-3 font-['Share_Tech_Mono'] text-sm tracking-[0.24em] text-white outline-none placeholder:text-[#ffffff33]"
                />
                <button
                  type="button"
                  onClick={() => {
                    playSoundEffect('ui_click');
                    void onJoinOnlineRoom(roomCodeInput);
                  }}
                  disabled={onlineStatus.loading || roomCodeInput.trim().length !== 6}
                  className="rounded border border-[#ffffff22] bg-[#dff7ff12] px-5 py-3 font-['Orbitron'] text-xs tracking-[0.18em] text-[#dff7ff] transition-colors hover:bg-[#dff7ff20] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  JOIN ROOM
                </button>
              </div>
            </div>

            {(onlineStatus.mode !== 'idle' || onlineStatus.error) && (
              <div className="mt-4 rounded-[18px] border border-[#ffffff18] bg-[#030912d9] p-4">
                <div className="font-['Orbitron'] text-xs tracking-[0.16em] text-[#dff7ff]">ONLINE STATUS</div>
                <div className="mt-2 font-['Share_Tech_Mono'] text-[11px] leading-relaxed text-[#dbe9ffbb]">
                  {onlineStatus.error ?? onlineStatus.message ?? 'Standing by for network activity.'}
                </div>
                {onlineStatus.roomCode && (
                  <div className="mt-3 font-['Orbitron'] text-lg tracking-[0.26em] text-[#ffcf8a]">{onlineStatus.roomCode}</div>
                )}
                {onlineStatus.mode !== 'idle' && (
                  <button
                    type="button"
                    onClick={() => {
                      playSoundEffect('ui_click');
                      void onCancelOnline();
                    }}
                    className="mt-4 rounded border border-[#ffffff22] px-4 py-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff77] transition-colors hover:text-white"
                  >
                    CANCEL ONLINE MATCHING
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            playSoundEffect('ui_click');
            onStartTutorial();
          }}
          className="mt-8 rounded-lg border border-[#ffffff22] bg-[#09111ac4] px-5 py-3 font-['Share_Tech_Mono'] text-[11px] tracking-[0.24em] text-[#dbe9ff88] transition-colors hover:text-white"
        >
          START GUIDED TUTORIAL
        </button>
        </div>
      </motion.div>

      <AnimateMenuModal
        open={showVsAiOptions}
        onClose={() => setShowVsAiOptions(false)}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-['Orbitron'] text-sm tracking-[0.18em] text-[#8df5df]">VS AI DEPLOYMENT</div>
            <div className="mt-1 font-['Share_Tech_Mono'] text-[11px] text-[#ffffff66]">
              Choose the hostile command profile and optional turn timer before insertion.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              playSoundEffect('ui_click');
              setShowVsAiOptions(false);
            }}
            className="rounded border border-[#ffffff22] px-3 py-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff77] transition-colors hover:text-white"
          >
            CLOSE
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {AI_DIFFICULTY_OPTIONS.map(option => {
            const active = vsAiDifficulty === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  playSoundEffect('ui_click');
                  setVsAiDifficulty(option.value);
                }}
                className="rounded-[18px] border px-4 py-4 text-left transition-colors"
                style={{
                  borderColor: active ? `${option.accent}aa` : `${option.accent}44`,
                  background: active
                    ? `linear-gradient(180deg, ${option.accent}22, rgba(255,255,255,0.04))`
                    : `linear-gradient(180deg, ${option.accent}10, rgba(255,255,255,0.02))`,
                  boxShadow: active ? `0 0 24px ${option.accent}22` : 'none',
                }}
              >
                <div className="font-['Orbitron'] text-sm tracking-[0.14em]" style={{ color: option.accent }}>{option.label}</div>
                <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] leading-relaxed text-[#ffffff88]">{option.summary}</div>
                <div className="mt-3 font-['Share_Tech_Mono'] text-[10px] leading-relaxed text-[#ffffff55]">{option.detail}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-[22px] border border-[#ffffff18] bg-[linear-gradient(180deg,#09111be8,#050a12f4)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)]">
            <MatchSettingCard
              title="VS AI TIMER"
              enabled={vsAiTurnTimerEnabled}
              seconds={vsAiTurnTimerSeconds}
              onToggle={() => setVsAiTurnTimerEnabled(current => !current)}
              onAdjust={(delta) => setVsAiTurnTimerSeconds(current => clampTimerSeconds(current + delta))}
              onSecondsChange={(value) => setVsAiTurnTimerSeconds(clampTimerSeconds(value))}
              detail="Optional live clock for solo matches. Expired AI or player actions resolve as WAIT."
              className="h-full border-[#8df5df22] bg-[#08111acc]"
            />
            <div className="flex h-full flex-col rounded-[18px] border border-[#ffcf8a22] bg-[#0a121dd6] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div>
                <div className="font-['Orbitron'] text-xs tracking-[0.16em] text-[#f3f6ff]">Deployment Summary</div>
                <div className="mt-3 font-['Share_Tech_Mono'] text-[11px] leading-relaxed text-[#dbe9ff88]">
                  AI difficulty is set to {getAiDifficultyLabel(vsAiDifficulty)}. Live solo play will load that preset&apos;s matching learned artifact and keep using the corresponding runtime command profile unless you override it from the terminal.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  playSoundEffect('ui_click');
                  launchVsAi();
                }}
                className="mt-5 w-full rounded border border-[#8df5df55] bg-[#061610cc] px-5 py-3 font-['Orbitron'] text-xs tracking-[0.18em] text-[#8df5df] transition-colors hover:bg-[#0a2318]"
              >
                {hasSavedVsAiGame ? 'START NEW TIMELINE' : 'DEPLOY VS AI'}
              </button>
            </div>
          </div>
        </div>
      </AnimateMenuModal>

      <AnimateMenuModal
        open={showVsAiResumePrompt && hasSavedVsAiGame}
        onClose={() => setShowVsAiResumePrompt(false)}
      >
        <div className="font-['Orbitron'] text-sm tracking-[0.18em] text-[#8fdfff]">SAVED OPERATION DETECTED</div>
        <div className="mt-2 font-['Share_Tech_Mono'] text-[11px] leading-relaxed text-[#dbe9ff88]">
          Command has a suspended VS AI mission on file. Resume the live operation or scrub it and deploy into a fresh timeline.
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              playSoundEffect('ui_click');
              setShowVsAiResumePrompt(false);
              onContinueSavedVsAi();
            }}
            className="rounded-[18px] border border-[#00d4ff66] bg-[#00d4ff14] px-4 py-4 text-left transition-colors hover:bg-[#00d4ff22]"
          >
            <div className="font-['Orbitron'] text-sm tracking-[0.14em] text-[#dff7ff]">CONTINUE OPERATION</div>
            <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff66]">Return to the suspended match exactly where you left it.</div>
          </button>
          <button
            type="button"
            onClick={() => {
              playSoundEffect('ui_click');
              setShowVsAiResumePrompt(false);
              setShowVsAiOptions(true);
            }}
            className="rounded-[18px] border border-[#ff6b3566] bg-[#ff6b3512] px-4 py-4 text-left transition-colors hover:bg-[#ff6b3522]"
          >
            <div className="font-['Orbitron'] text-sm tracking-[0.14em] text-[#ffd1c1]">START NEW TIMELINE</div>
            <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff66]">Discard the suspended mission, choose a fresh AI difficulty, and begin from round one.</div>
          </button>
        </div>
      </AnimateMenuModal>

      <AnimateMenuModal
        open={showLocalOptions}
        onClose={() => setShowLocalOptions(false)}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-['Orbitron'] text-sm tracking-[0.18em] text-[#d9cbff]">LOCAL 2P CHANNEL</div>
            <div className="mt-1 font-['Share_Tech_Mono'] text-[11px] text-[#ffffff66]">
              Choose desk-side handoff, open queue matching, or a private room code.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              playSoundEffect('ui_click');
              setShowLocalOptions(false);
            }}
            className="rounded border border-[#ffffff22] px-3 py-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff77] transition-colors hover:text-white"
          >
            CLOSE
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              playSoundEffect('ui_click');
              setShowLocalOptions(false);
              onStart('local_2p', createMatchConfig(localTurnTimerEnabled, localTurnTimerSeconds));
            }}
            className="rounded-[18px] border border-[#7b4fd466] bg-[#7b4fd414] px-4 py-4 text-left transition-colors hover:bg-[#7b4fd424]"
          >
            <div className="font-['Orbitron'] text-sm tracking-[0.14em] text-[#d6c3ff]">PLAY IN PERSON</div>
            <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff66]">One machine. Pass the terminal after each turn window.</div>
          </button>
          <button
            type="button"
            onClick={() => {
              playSoundEffect('ui_click');
              setShowLocalOptions(false);
              void onStartOnlineQueue(createMatchConfig(queueTurnTimerEnabled, queueTurnTimerSeconds));
            }}
            disabled={onlineStatus.loading}
            className="rounded-[18px] border border-[#00c8a066] bg-[#00c8a014] px-4 py-4 text-left transition-colors hover:bg-[#00c8a024] disabled:cursor-wait disabled:opacity-60"
          >
            <div className="font-['Orbitron'] text-sm tracking-[0.14em] text-[#b8ffee]">ONLINE QUEUE</div>
            <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff66]">Match with anyone currently searching on the host.</div>
            <div className="mt-3 rounded border border-[#ffb36655] bg-[#2a1608aa] px-3 py-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffd7b3]">
              {onlineStatus.queueSeekers === null
                ? 'Warning: queue traffic is unknown until the host responds.'
                : `Warning: only ${onlineStatus.queueSeekers} operative${onlineStatus.queueSeekers === 1 ? '' : 's'} currently searching. A match may take time.`}
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              playSoundEffect('ui_click');
              setShowLocalOptions(false);
              void onCreateOnlineRoom(createMatchConfig(roomTurnTimerEnabled, roomTurnTimerSeconds));
            }}
            disabled={onlineStatus.loading}
            className="rounded-[18px] border border-[#ff6b3566] bg-[#ff6b3512] px-4 py-4 text-left transition-colors hover:bg-[#ff6b3522] disabled:cursor-wait disabled:opacity-60"
          >
            <div className="font-['Orbitron'] text-sm tracking-[0.14em] text-[#ffd1c1]">HOST PRIVATE ROOM</div>
            <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff66]">Generate a room code and share it with a known opponent.</div>
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <MatchSettingCard
            title="IN-PERSON TIMER"
            enabled={localTurnTimerEnabled}
            seconds={localTurnTimerSeconds}
            onToggle={() => setLocalTurnTimerEnabled(current => !current)}
            onAdjust={(delta) => setLocalTurnTimerSeconds(current => clampTimerSeconds(current + delta))}
            onSecondsChange={(value) => setLocalTurnTimerSeconds(clampTimerSeconds(value))}
            detail="Expired actions convert to WAIT. Set the exact clock used for desk-side local play."
          />
          <MatchSettingCard
            title="QUEUE TIMER"
            enabled={queueTurnTimerEnabled}
            seconds={queueTurnTimerSeconds}
            onToggle={() => setQueueTurnTimerEnabled(current => !current)}
            onAdjust={(delta) => setQueueTurnTimerSeconds(current => clampTimerSeconds(current + delta))}
            onSecondsChange={(value) => setQueueTurnTimerSeconds(clampTimerSeconds(value))}
            detail="Queue pairing only matches operatives who picked the same timer rule and duration."
          />
          <MatchSettingCard
            title="PRIVATE ROOM TIMER"
            enabled={roomTurnTimerEnabled}
            seconds={roomTurnTimerSeconds}
            onToggle={() => setRoomTurnTimerEnabled(current => !current)}
            onAdjust={(delta) => setRoomTurnTimerSeconds(current => clampTimerSeconds(current + delta))}
            onSecondsChange={(value) => setRoomTurnTimerSeconds(clampTimerSeconds(value))}
            detail="Host decides this rule. Guests can review the exact clock after joining the room."
          />
        </div>

        <div className="mt-4 rounded-[18px] border border-[#ffffff14] bg-[#050c14cc] p-4">
          <div className="font-['Orbitron'] text-xs tracking-[0.16em] text-[#f3f6ff]">JOIN PRIVATE ROOM</div>
          <div className="mt-3 flex flex-col gap-3 md:flex-row">
            <input
              value={roomCodeInput}
              onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="ROOM CODE"
              className="flex-1 rounded border border-[#ffffff22] bg-[#02060dcc] px-4 py-3 font-['Share_Tech_Mono'] text-sm tracking-[0.24em] text-white outline-none placeholder:text-[#ffffff33]"
            />
            <button
              type="button"
              onClick={() => {
                playSoundEffect('ui_click');
                void onJoinOnlineRoom(roomCodeInput);
              }}
              disabled={onlineStatus.loading || roomCodeInput.trim().length !== 6}
              className="rounded border border-[#ffffff22] bg-[#dff7ff12] px-5 py-3 font-['Orbitron'] text-xs tracking-[0.18em] text-[#dff7ff] transition-colors hover:bg-[#dff7ff20] disabled:cursor-not-allowed disabled:opacity-50"
            >
              JOIN ROOM
            </button>
          </div>
        </div>

        {(onlineStatus.mode !== 'idle' || onlineStatus.error) && (
          <div className="mt-4 rounded-[18px] border border-[#ffffff18] bg-[#030912d9] p-4">
            <div className="font-['Orbitron'] text-xs tracking-[0.16em] text-[#dff7ff]">ONLINE STATUS</div>
            <div className="mt-2 font-['Share_Tech_Mono'] text-[11px] leading-relaxed text-[#dbe9ffbb]">
              {onlineStatus.error ?? onlineStatus.message ?? 'Standing by for network activity.'}
            </div>
            {onlineStatus.roomCode && (
              <div className="mt-3 font-['Orbitron'] text-lg tracking-[0.26em] text-[#ffcf8a]">{onlineStatus.roomCode}</div>
            )}
            {onlineStatus.mode !== 'idle' && (
              <button
                type="button"
                onClick={() => {
                  playSoundEffect('ui_click');
                  void onCancelOnline();
                }}
                className="mt-4 rounded border border-[#ffffff22] px-4 py-2 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff77] transition-colors hover:text-white"
              >
                CANCEL ONLINE MATCHING
              </button>
            )}
          </div>
        )}
      </AnimateMenuModal>

    </div>
  );
}

function AnimateMenuModal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#000000b5] px-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-3xl rounded-[28px] border border-[#ffffff18] bg-[#08101aea] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.42)]"
            onClick={(event) => event.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MatchSettingCard({
  title,
  enabled,
  seconds,
  onToggle,
  onAdjust,
  onSecondsChange,
  detail,
  className,
}: {
  title: string;
  enabled: boolean;
  seconds: number;
  onToggle: () => void;
  onAdjust: (delta: number) => void;
  onSecondsChange: (value: number) => void;
  detail: string;
  className?: string;
}) {
  const [draftSeconds, setDraftSeconds] = useState(String(seconds));

  useEffect(() => {
    setDraftSeconds(String(seconds));
  }, [seconds]);

  const commitDraftSeconds = () => {
    if (draftSeconds.trim() === '') {
      setDraftSeconds(String(seconds));
      return;
    }

    const parsed = Number(draftSeconds);
    const isValid = Number.isInteger(parsed) && parsed >= MIN_TURN_TIMER_SECONDS && parsed <= MAX_TURN_TIMER_SECONDS;
    if (!isValid) {
      setDraftSeconds(String(seconds));
      return;
    }

    onSecondsChange(parsed);
  };

  return (
    <div className={`rounded-[18px] border border-[#ffffff14] bg-[#050c14cc] p-4 ${className ?? ''}`}>
      <div className="font-['Orbitron'] text-xs tracking-[0.16em] text-[#f3f6ff]">{title}</div>
      <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] leading-relaxed text-[#ffffff66]">{detail}</div>
      <button
        type="button"
        onClick={onToggle}
        className="mt-3 rounded border border-[#8df5df55] bg-[#061610cc] px-4 py-2 font-['Orbitron'] text-xs tracking-[0.16em] text-[#8df5df] transition-colors hover:bg-[#0a2318]"
      >
        {formatTimerLabel(enabled, seconds)}
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[-15, -30, 15, 30].map(delta => (
          <button
            key={delta}
            type="button"
            disabled={!enabled}
            onClick={() => onAdjust(delta)}
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
          disabled={!enabled}
          value={draftSeconds}
          onChange={(event) => setDraftSeconds(event.target.value)}
          onBlur={commitDraftSeconds}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitDraftSeconds();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              setDraftSeconds(String(seconds));
              event.currentTarget.blur();
            }
          }}
          className="mt-2 w-full rounded border border-[#ffffff22] bg-[#02060dcc] px-3 py-2 font-['Share_Tech_Mono'] text-[11px] text-white outline-none disabled:cursor-not-allowed disabled:opacity-35"
        />
      </label>
    </div>
  );
}
