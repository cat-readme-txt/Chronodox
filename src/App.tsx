// ============================================================
// CHRONODOX — App Root
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { StartScreen } from './components/StartScreen';
import { GameHUD } from './components/GameHUD';
import { TimelineCanvas } from './canvas/TimelineCanvas';
import { ActionPanel } from './components/ActionPanel';
import { NotificationFeed } from './components/NotificationFeed';
import { GameOver } from './components/GameOver';
import {
  DEFAULT_AI_DIFFICULTY,
  DEFAULT_TURN_TIMER_SECONDS,
  MAX_TURN_TIMER_SECONDS,
  MIN_TURN_TIMER_SECONDS,
  type MatchConfig,
  type PlayerId,
  type TimePeriod,
} from './types/game';
import { useGameStore } from './store/gameStore';
import { NotificationToasts } from './components/NotificationToasts';
import { SettingsScreen } from './components/SettingsScreen';
import { GameTerminal } from './components/GameTerminal';
import { CONTEXT_MUSIC, MUSIC_TRACKS, SOUND_EFFECTS } from './config/audio';
import { TutorialOverlay } from './components/TutorialOverlay';
import { MatchmakingLobby } from './components/MatchmakingLobby';
import { createInitialState } from './engine/gameFactory';
import { normalizeAiDifficulty } from './engine/aiDifficulty';
import {
  cancelQueue,
  createOnlineClientId,
  createPrivateRoom,
  getPresence,
  getRoomSnapshot,
  joinPrivateRoom,
  joinQueueWithSettings,
  leaveRoom,
  normalizeRoomCode,
  pollQueue,
  pushRoomPresence,
  pushRoomSnapshot,
  setRoomReady,
  updateRoomSettings,
} from './network/onlineClient';
import type { OnlineRoomSnapshot, OnlineTransport } from './network/onlineClient';
import { deserializeGameState, serializeGameState } from './network/gameSnapshot';
const PERIODS: TimePeriod[] = ['PAST', 'PRESENT', 'FUTURE'];
const VS_AI_SAVE_KEY = 'chronodox_vs_ai_save_v1';

interface SavedVsAiSnapshot {
  game: ReturnType<typeof serializeGameState>;
  selectedAgentId: string | null;
  selectedPeriod: TimePeriod;
  terminalMode: boolean;
  intelFeedOpen: boolean;
}

interface NetworkAlertState {
  message: string;
  actionLabel: string;
  action: 'home' | 'queue' | 'dismiss';
  joinedAt?: number;
  settings?: MatchConfig;
}

interface ExitMatchPromptState {
  roomCode: string;
  countdownEndsAt: number;
}

interface LocalTurnTimeoutPromptState {
  message: string;
}

function clampAudioVolume(value: number) {
  return Math.min(1, Math.max(0, value));
}

function normalizeMatchSettings(settings?: Partial<MatchConfig> | null): MatchConfig {
  const rawSeconds = settings?.turnTimerSeconds;
  const turnTimerSeconds = Number.isFinite(rawSeconds)
    ? Math.min(MAX_TURN_TIMER_SECONDS, Math.max(MIN_TURN_TIMER_SECONDS, Math.round(rawSeconds as number)))
    : DEFAULT_TURN_TIMER_SECONDS;
  return {
    turnTimerEnabled: Boolean(settings?.turnTimerEnabled),
    turnTimerSeconds,
    aiDifficulty: normalizeAiDifficulty(settings?.aiDifficulty ?? DEFAULT_AI_DIFFICULTY),
  };
}

// Canvas dimensions — will scale via CSS to fill container
const DEFAULT_CANVAS = { width: 380, height: 520 };

function ResponsiveTimelineCanvas({ period }: { period: TimePeriod }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(DEFAULT_CANVAS);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frameRef} className="h-full w-full">
      <TimelineCanvas period={period} width={size.width} height={size.height} />
    </div>
  );
}

export default function App() {
  const readSavedVsAiSnapshot = (): SavedVsAiSnapshot | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(VS_AI_SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as SavedVsAiSnapshot;
    } catch {
      return null;
    }
  };

  const writeSavedVsAiSnapshot = (snapshot: SavedVsAiSnapshot | null) => {
    if (typeof window === 'undefined') return;
    if (!snapshot) {
      window.sessionStorage.removeItem(VS_AI_SAVE_KEY);
      return;
    }
    window.sessionStorage.setItem(VS_AI_SAVE_KEY, JSON.stringify(snapshot));
  };

  const [started, setStarted] = useState(false);
  const [launchTransition, setLaunchTransition] = useState<'darkening' | 'revealing' | null>(null);
  const [musicFadeLevel, setMusicFadeLevel] = useState(1);
  const [musicSwitchLevel, setMusicSwitchLevel] = useState(1);
  const [transitionBlackAlpha, setTransitionBlackAlpha] = useState(0);
  const [onlineStatus, setOnlineStatus] = useState<{
    loading: boolean;
    error: string | null;
    queueSeekers: number | null;
    mode: 'idle' | 'queue' | 'room-host';
    ticketId: string | null;
    roomCode: string | null;
    message: string | null;
  }>({
    loading: false,
    error: null,
    queueSeekers: null,
    mode: 'idle',
    ticketId: null,
    roomCode: null,
    message: null,
  });
  const [onlineLobby, setOnlineLobby] = useState<
    | { screen: 'idle' }
    | {
        screen: 'queue-search';
        joinedAt: number;
        ticketId: string;
        settings: MatchConfig;
        queueSeekers: number | null;
        onlineNow: number | null;
        error: string | null;
      }
    | {
        screen: 'room';
        roomCode: string;
        transport: OnlineTransport;
        localPlayer: PlayerId;
        joinedAt: number;
        settings: MatchConfig;
        queueSeekers: number | null;
        onlineNow: number | null;
        snapshot: OnlineRoomSnapshot | null;
        error: string | null;
        readyBusy: boolean;
        settingsBusy: boolean;
        starting: boolean;
      }
  >({ screen: 'idle' });
  const [hasSavedVsAiGame, setHasSavedVsAiGame] = useState(() => Boolean(readSavedVsAiSnapshot()));
  const [networkAlert, setNetworkAlert] = useState<NetworkAlertState | null>(null);
  const [exitMatchPrompt, setExitMatchPrompt] = useState<ExitMatchPromptState | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const uiClickRef = useRef<HTMLAudioElement>(null);
  const moveClickRef = useRef<HTMLAudioElement>(null);
  const stompRef = useRef<HTMLAudioElement>(null);
  const warpRef = useRef<HTMLAudioElement>(null);
  const invalidBuzzRef = useRef<HTMLAudioElement>(null);
  const paradoxRef = useRef<HTMLAudioElement>(null);
  const successRef = useRef<HTMLAudioElement>(null);
  const matchFoundVoiceRef = useRef<HTMLAudioElement>(null);
  const launchStartTimeoutRef = useRef<number | null>(null);
  const launchEndTimeoutRef = useRef<number | null>(null);
  const blackoutHoldTimeoutRef = useRef<number | null>(null);
  const musicFadeFrameRef = useRef<number | null>(null);
  const musicSwitchFrameRef = useRef<number | null>(null);
  const activeMusicIdRef = useRef<string | null>(null);
  const musicSwitchLevelRef = useRef(1);
  const matchFoundAnnouncedRef = useRef(false);
  const onlineClientIdRef = useRef(createOnlineClientId());
  const onlinePollTimerRef = useRef<number | null>(null);
  const roomPollTimerRef = useRef<number | null>(null);
  const queuePollGenerationRef = useRef(0);
  const roomPollGenerationRef = useRef(0);
  const lastPublishedOnlineSnapshotRef = useRef<string | null>(null);
  const onlineStartTriggeredRef = useRef(false);
  const networkAlertSignatureRef = useRef<string | null>(null);
  const handledTutorialMenuReturnTokenRef = useRef(0);
  const {
    intelFeedOpen, game, selectedAgentId, aiActivePeriod, collapsingPeriods,
    localPlayer, brightness, homeMusicTrackId, gameMusicTrackId, musicVolume, terminalMode, selectedPeriod, remoteSelectedPeriod,
    muteAllAudio, sfxVolume, soundEffectCue, initGame, playSoundEffect, traversalEffects, startGuidedTutorial, tutorialMenuReturnToken,
    gameMode, onlineRoomCode, onlineRevision, onlineOpponentConnected, loadOnlineGame, applyRemoteOnlineGame, applyRemoteOnlinePresence, setOnlineSyncError,
    matchConfig, localTurnHandoffPlayer, turnTimeoutNotice, acknowledgeLocalHandoff, dismissTurnTimeoutNotice, handleTurnTimerExpired,
  } = useGameStore();

  const allAgents = [...game.players.P1.agents, ...game.players.P2.agents];
  const selectedAgent = selectedAgentId ? allAgents.find(agent => agent.id === selectedAgentId && agent.owner === localPlayer) : null;
  const visiblePeriods = PERIODS;
  const columnWidth = '33.333%';
  const selectedHomeTrack = useMemo(() => MUSIC_TRACKS.find(track => track.id === homeMusicTrackId) ?? MUSIC_TRACKS[0], [homeMusicTrackId]);
  const selectedGameTrack = useMemo(() => MUSIC_TRACKS.find(track => track.id === gameMusicTrackId) ?? MUSIC_TRACKS[0], [gameMusicTrackId]);
  const lobbyMatchFound = onlineLobby.screen === 'room' && (onlineLobby.snapshot?.connectedPlayers.length ?? 0) >= 2;
  const targetMusic = useMemo(() => {
    if (!started) {
      if (lobbyMatchFound) {
        return CONTEXT_MUSIC.matchFound;
      }
      return {
        id: `home_${selectedHomeTrack.id}`,
        src: selectedHomeTrack.src,
        label: selectedHomeTrack.label,
      };
    }
    return {
      id: `game_${selectedGameTrack.id}`,
      src: selectedGameTrack.src,
      label: selectedGameTrack.label,
    };
  }, [lobbyMatchFound, selectedGameTrack.id, selectedGameTrack.label, selectedGameTrack.src, selectedHomeTrack.id, selectedHomeTrack.label, selectedHomeTrack.src, started]);

  const clearQueuePoll = () => {
    queuePollGenerationRef.current += 1;
    if (onlinePollTimerRef.current !== null) {
      window.clearTimeout(onlinePollTimerRef.current);
      onlinePollTimerRef.current = null;
    }
  };

  const clearRoomPoll = () => {
    roomPollGenerationRef.current += 1;
    if (roomPollTimerRef.current !== null) {
      window.clearTimeout(roomPollTimerRef.current);
      roomPollTimerRef.current = null;
    }
  };

  const resetStoreForHomeScreen = () => {
    const homeMatchConfig = normalizeMatchSettings({ turnTimerEnabled: false, turnTimerSeconds: DEFAULT_TURN_TIMER_SECONDS });
    useGameStore.setState({
      game: createInitialState(homeMatchConfig),
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
      actionEffectCue: null,
      terminalMode: false,
      terminalHistory: [],
      sudoAuthenticated: false,
      suMode: false,
      terminalAwaitingPassword: false,
      pendingPrivilegedInput: null,
      pendingPassConfirmation: false,
      awaitingNextRound: false,
      autoNextDeadline: null,
      inspectedCityId: null,
      turnUndoStack: [],
      matchConfig: homeMatchConfig,
      localTurnHandoffPlayer: null,
      turnTimeoutNotice: null,
      debugLocalSwitchEnabled: false,
    });
  };

  const resetOnlineUiState = () => {
    clearQueuePoll();
    clearRoomPoll();
    lastPublishedOnlineSnapshotRef.current = null;
    onlineStartTriggeredRef.current = false;
    networkAlertSignatureRef.current = null;
    applyRemoteOnlinePresence(null, null);
    setOnlineSyncError(null);
    setNetworkAlert(null);
    setExitMatchPrompt(null);
    setOnlineLobby({ screen: 'idle' });
    setOnlineStatus({
      loading: false,
      error: null,
      queueSeekers: null,
      mode: 'idle',
      ticketId: null,
      roomCode: null,
      message: null,
    });
  };

  const returnWaitingRoomToHomeSilently = () => {
    clearQueuePoll();
    clearRoomPoll();
    lastPublishedOnlineSnapshotRef.current = null;
    onlineStartTriggeredRef.current = false;
    networkAlertSignatureRef.current = null;
    applyRemoteOnlinePresence(null, null);
    setNetworkAlert(null);
    setExitMatchPrompt(null);
    setOnlineLobby({ screen: 'idle' });
    setOnlineStatus(state => ({
      ...state,
      loading: false,
      error: null,
      mode: 'idle',
      ticketId: null,
      roomCode: null,
      message: null,
    }));
    void refreshPresence();
  };

  const transitionToHomeScreen = () => {
    if (launchTransition) return;
    setMusicFadeLevel(0);
    setTransitionBlackAlpha(0);
    setLaunchTransition('darkening');
    launchStartTimeoutRef.current = window.setTimeout(() => {
      if (onlineRoomCode) {
        void leaveRoom(onlineRoomCode, onlineClientIdRef.current).catch(() => {});
      }
      resetStoreForHomeScreen();
      resetOnlineUiState();
      setStarted(false);
      setTransitionBlackAlpha(1);
    }, 900);
    launchEndTimeoutRef.current = window.setTimeout(() => {
      setLaunchTransition(null);
      setMusicFadeLevel(1);
      setTransitionBlackAlpha(0);
    }, 1500);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = clampAudioVolume(musicVolume * musicFadeLevel * musicSwitchLevel);
    audio.muted = muteAllAudio;
    if (!targetMusic.src) {
      audio.pause();
      return;
    }
  }, [musicFadeLevel, musicSwitchLevel, musicVolume, muteAllAudio, targetMusic.id, targetMusic.src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !targetMusic.src || muteAllAudio) return;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }, [muteAllAudio, targetMusic.id, targetMusic.src]);

  useEffect(() => {
    musicSwitchLevelRef.current = musicSwitchLevel;
  }, [musicSwitchLevel]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const cancelSwitchAnimation = () => {
      if (musicSwitchFrameRef.current !== null) {
        window.cancelAnimationFrame(musicSwitchFrameRef.current);
        musicSwitchFrameRef.current = null;
      }
    };

    const animateSwitchLevel = (from: number, to: number, duration: number, onComplete?: () => void) => {
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        setMusicSwitchLevel(from + ((to - from) * progress));
        if (progress < 1) {
          musicSwitchFrameRef.current = window.requestAnimationFrame(step);
          return;
        }
        musicSwitchFrameRef.current = null;
        onComplete?.();
      };
      musicSwitchFrameRef.current = window.requestAnimationFrame(step);
    };

    if (activeMusicIdRef.current === targetMusic.id) {
      if (audio.src !== (targetMusic.src ? new URL(targetMusic.src, document.baseURI).toString() : '')) {
        audio.src = targetMusic.src ?? '';
      }
      return;
    }

    cancelSwitchAnimation();
    const swapToTarget = () => {
      activeMusicIdRef.current = targetMusic.id;
      audio.src = targetMusic.src ?? '';
      audio.currentTime = 0;
      if (!targetMusic.src) {
        audio.pause();
        setMusicSwitchLevel(1);
        return;
      }
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
      setMusicSwitchLevel(0);
      animateSwitchLevel(0, 1, targetMusic.id === CONTEXT_MUSIC.matchFound.id ? 900 : 700);
    };

    if (!activeMusicIdRef.current || !audio.src) {
      swapToTarget();
      return;
    }

    animateSwitchLevel(musicSwitchLevelRef.current, 0, activeMusicIdRef.current === CONTEXT_MUSIC.matchFound.id ? 700 : 450, swapToTarget);

    return cancelSwitchAnimation;
  }, [targetMusic.id, targetMusic.src]);

  useEffect(() => () => {
    if (launchStartTimeoutRef.current !== null) window.clearTimeout(launchStartTimeoutRef.current);
    if (blackoutHoldTimeoutRef.current !== null) window.clearTimeout(blackoutHoldTimeoutRef.current);
    if (launchEndTimeoutRef.current !== null) window.clearTimeout(launchEndTimeoutRef.current);
    if (musicFadeFrameRef.current !== null) window.cancelAnimationFrame(musicFadeFrameRef.current);
    if (musicSwitchFrameRef.current !== null) window.cancelAnimationFrame(musicSwitchFrameRef.current);
    clearQueuePoll();
    clearRoomPoll();
  }, []);

  useEffect(() => {
    if (tutorialMenuReturnToken === 0 || tutorialMenuReturnToken === handledTutorialMenuReturnTokenRef.current) return;
    handledTutorialMenuReturnTokenRef.current = tutorialMenuReturnToken;
    if (!started) {
      if (onlineRoomCode) {
        void leaveRoom(onlineRoomCode, onlineClientIdRef.current).catch(() => {});
      }
      resetOnlineUiState();
      setStarted(false);
      setLaunchTransition(null);
      setMusicFadeLevel(1);
      setTransitionBlackAlpha(0);
      return;
    }
    transitionToHomeScreen();
  }, [launchTransition, onlineRoomCode, setOnlineSyncError, started, tutorialMenuReturnToken]);

  useEffect(() => {
    if (!soundEffectCue) return;
    if (muteAllAudio || sfxVolume <= 0) return;

    const soundMap = {
      ui_click: uiClickRef.current,
      move_click: moveClickRef.current,
      stomp_impact: stompRef.current,
      warp_slide: warpRef.current,
      invalid_buzz: invalidBuzzRef.current,
      paradox_alarm: paradoxRef.current,
      mission_success: successRef.current,
      match_found_voice: matchFoundVoiceRef.current,
    };
    const audio = soundMap[soundEffectCue.id];
    const soundConfig = SOUND_EFFECTS.find(effect => effect.id === soundEffectCue.id);
    if (!audio) return;
    audio.currentTime = soundConfig?.startOffset ?? 0;
    audio.volume = clampAudioVolume(sfxVolume);
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }, [muteAllAudio, sfxVolume, soundEffectCue]);

  useEffect(() => {
    if (!lobbyMatchFound) {
      matchFoundAnnouncedRef.current = false;
      return;
    }
    if (matchFoundAnnouncedRef.current || muteAllAudio || sfxVolume <= 0) return;
    const audio = matchFoundVoiceRef.current;
    if (!audio) return;
    matchFoundAnnouncedRef.current = true;
    audio.currentTime = 0;
    audio.volume = clampAudioVolume(sfxVolume);
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }, [lobbyMatchFound, muteAllAudio, sfxVolume]);

  useEffect(() => {
    const retryPlayback = () => {
      const audio = audioRef.current;
      if (!audio || !targetMusic.src || muteAllAudio) return;
      if (!audio.paused) return;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    };

    window.addEventListener('pointerdown', retryPlayback, { passive: true });
    window.addEventListener('keydown', retryPlayback);
    return () => {
      window.removeEventListener('pointerdown', retryPlayback);
      window.removeEventListener('keydown', retryPlayback);
    };
  }, [muteAllAudio, targetMusic.id, targetMusic.src]);

  const handleStart = (mode: 'vs_ai' | 'local_2p', requestedMatchConfig?: MatchConfig) => {
    if (launchTransition) return;
    const normalizedMatchConfig = normalizeMatchSettings(requestedMatchConfig);
    resetOnlineUiState();
    if (mode === 'vs_ai') {
      writeSavedVsAiSnapshot(null);
      setHasSavedVsAiGame(false);
    }
    playSoundEffect('stomp_impact');
    setMusicFadeLevel(0);
    setTransitionBlackAlpha(0);
    setLaunchTransition('darkening');
    launchStartTimeoutRef.current = window.setTimeout(() => {
      initGame(mode, 'root', normalizedMatchConfig);
      setStarted(true);
      setLaunchTransition('revealing');
      setTransitionBlackAlpha(1);
      const fadeStart = performance.now();
      const fadeDuration = 1900;
      const stepFade = (now: number) => {
        const progress = Math.min(1, (now - fadeStart) / fadeDuration);
        setMusicFadeLevel(progress);
        setTransitionBlackAlpha(1 - progress);
        if (progress < 1) {
          musicFadeFrameRef.current = window.requestAnimationFrame(stepFade);
        } else {
          musicFadeFrameRef.current = null;
          setTransitionBlackAlpha(0);
        }
      };
      if (musicFadeFrameRef.current !== null) window.cancelAnimationFrame(musicFadeFrameRef.current);
      blackoutHoldTimeoutRef.current = window.setTimeout(() => {
        musicFadeFrameRef.current = window.requestAnimationFrame(stepFade);
      }, 100);
    }, 2000);
    launchEndTimeoutRef.current = window.setTimeout(() => {
      setLaunchTransition(null);
      setMusicFadeLevel(1);
      setTransitionBlackAlpha(0);
    }, 4000);
  };

  const handleStartTutorial = () => {
    if (launchTransition) return;
    resetOnlineUiState();
    playSoundEffect('stomp_impact');
    setMusicFadeLevel(0);
    setTransitionBlackAlpha(0);
    setLaunchTransition('darkening');
    launchStartTimeoutRef.current = window.setTimeout(() => {
      startGuidedTutorial({ restoreOnExit: false });
      setStarted(true);
      setLaunchTransition('revealing');
      setTransitionBlackAlpha(1);
      const fadeStart = performance.now();
      const fadeDuration = 1900;
      const stepFade = (now: number) => {
        const progress = Math.min(1, (now - fadeStart) / fadeDuration);
        setMusicFadeLevel(progress);
        setTransitionBlackAlpha(1 - progress);
        if (progress < 1) {
          musicFadeFrameRef.current = window.requestAnimationFrame(stepFade);
        } else {
          musicFadeFrameRef.current = null;
          setTransitionBlackAlpha(0);
        }
      };
      if (musicFadeFrameRef.current !== null) window.cancelAnimationFrame(musicFadeFrameRef.current);
      blackoutHoldTimeoutRef.current = window.setTimeout(() => {
        musicFadeFrameRef.current = window.requestAnimationFrame(stepFade);
      }, 100);
    }, 2000);
    launchEndTimeoutRef.current = window.setTimeout(() => {
      setLaunchTransition(null);
      setMusicFadeLevel(1);
      setTransitionBlackAlpha(0);
    }, 4000);
  };

  const handleStartNewVsAi = (requestedMatchConfig?: MatchConfig) => {
    writeSavedVsAiSnapshot(null);
    setHasSavedVsAiGame(false);
    handleStart('vs_ai', requestedMatchConfig);
  };

  const handlePauseVsAiToHome = () => {
    if (!started || gameMode !== 'vs_ai') return;
    writeSavedVsAiSnapshot({
      game: serializeGameState(game),
      selectedAgentId,
      selectedPeriod,
      terminalMode,
      intelFeedOpen,
    });
    setHasSavedVsAiGame(true);
    resetOnlineUiState();
    setStarted(false);
    setLaunchTransition(null);
    setMusicFadeLevel(1);
    setTransitionBlackAlpha(0);
    setExitMatchPrompt(null);
  };

  const handleContinueSavedVsAi = () => {
    const snapshot = readSavedVsAiSnapshot();
    if (!snapshot || launchTransition) return;
    resetOnlineUiState();
    playSoundEffect('stomp_impact');
    setMusicFadeLevel(0);
    setTransitionBlackAlpha(0);
    setLaunchTransition('darkening');
    launchStartTimeoutRef.current = window.setTimeout(() => {
      const restoredGame = deserializeGameState(snapshot.game);
      const restoredMatchConfig = normalizeMatchSettings(restoredGame.matchConfig);
      useGameStore.setState({
        game: { ...restoredGame, matchConfig: restoredMatchConfig },
        localPlayer: 'P1',
        selectedAgentId: snapshot.selectedAgentId,
        selectedPeriod: snapshot.selectedPeriod,
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
        intelFeedOpen: snapshot.intelFeedOpen,
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
        soundEffectCue: null,
        terminalMode: snapshot.terminalMode,
        terminalHistory: [],
        pendingPassConfirmation: false,
        sudoAuthenticated: false,
        suMode: false,
        terminalAwaitingPassword: false,
        pendingPrivilegedInput: null,
        awaitingNextRound: false,
        autoNextDeadline: null,
        inspectedCityId: null,
        turnUndoStack: [],
        matchConfig: restoredMatchConfig,
      });
      setStarted(true);
      setLaunchTransition('revealing');
      setTransitionBlackAlpha(1);
      const fadeStart = performance.now();
      const fadeDuration = 1900;
      const stepFade = (now: number) => {
        const progress = Math.min(1, (now - fadeStart) / fadeDuration);
        setMusicFadeLevel(progress);
        setTransitionBlackAlpha(1 - progress);
        if (progress < 1) {
          musicFadeFrameRef.current = window.requestAnimationFrame(stepFade);
        } else {
          musicFadeFrameRef.current = null;
          setTransitionBlackAlpha(0);
        }
      };
      if (musicFadeFrameRef.current !== null) window.cancelAnimationFrame(musicFadeFrameRef.current);
      blackoutHoldTimeoutRef.current = window.setTimeout(() => {
        musicFadeFrameRef.current = window.requestAnimationFrame(stepFade);
      }, 100);
    }, 2000);
    launchEndTimeoutRef.current = window.setTimeout(() => {
      setLaunchTransition(null);
      setMusicFadeLevel(1);
      setTransitionBlackAlpha(0);
    }, 4000);
  };

  useEffect(() => {
    const handlePauseEvent = () => {
      handlePauseVsAiToHome();
    };
    window.addEventListener('chronodox:pause-vs-ai', handlePauseEvent);
    return () => window.removeEventListener('chronodox:pause-vs-ai', handlePauseEvent);
  }, [gameMode, intelFeedOpen, selectedAgentId, selectedPeriod, started, terminalMode]);

  useEffect(() => {
    const handleReturnLocalMatch = () => {
      if (!started || gameMode !== 'local_2p') return;
      transitionToHomeScreen();
    };
    window.addEventListener('chronodox:return-local-match', handleReturnLocalMatch);
    return () => window.removeEventListener('chronodox:return-local-match', handleReturnLocalMatch);
  }, [gameMode, started]);

  useEffect(() => {
    const handleExitOnlineMatch = () => {
      if (!started || gameMode !== 'online_2p' || !onlineRoomCode) return;
      setExitMatchPrompt({
        roomCode: onlineRoomCode,
        countdownEndsAt: Date.now() + 5000,
      });
    };
    window.addEventListener('chronodox:exit-online-match', handleExitOnlineMatch);
    return () => window.removeEventListener('chronodox:exit-online-match', handleExitOnlineMatch);
  }, [gameMode, onlineRoomCode, started]);

  useEffect(() => {
    if (started && gameMode === 'vs_ai' && game.phase === 'GAME_OVER') {
      writeSavedVsAiSnapshot(null);
      setHasSavedVsAiGame(false);
    }
  }, [game.phase, gameMode, started]);

  useEffect(() => {
    if (!started || !matchConfig.turnTimerEnabled || !game.turnDeadlineAt || game.phase === 'GAME_OVER') return;
    const delay = Math.max(0, game.turnDeadlineAt - Date.now());
    const timeout = window.setTimeout(() => {
      handleTurnTimerExpired();
    }, delay + 10);
    return () => window.clearTimeout(timeout);
  }, [game.currentTurn, game.phase, game.round, game.turnDeadlineAt, handleTurnTimerExpired, matchConfig.turnTimerEnabled, started]);

  const refreshPresence = async () => {
    try {
      const presence = await getPresence();
      setOnlineStatus(state => ({ ...state, queueSeekers: presence.queueSeekers }));
      setOnlineLobby(state => {
        if (state.screen === 'queue-search' || state.screen === 'room') {
          return { ...state, queueSeekers: presence.queueSeekers, onlineNow: presence.onlineNow };
        }
        return state;
      });
    } catch {
      setOnlineStatus(state => ({ ...state, queueSeekers: null }));
    }
  };

  const beginLaunchTransition = (midpoint: () => void) => {
    if (launchTransition) return;
    playSoundEffect('stomp_impact');
    setMusicFadeLevel(0);
    setTransitionBlackAlpha(0);
    setLaunchTransition('darkening');
    launchStartTimeoutRef.current = window.setTimeout(() => {
      midpoint();
      setLaunchTransition('revealing');
      setTransitionBlackAlpha(1);
      const fadeStart = performance.now();
      const fadeDuration = 1900;
      const stepFade = (now: number) => {
        const progress = Math.min(1, (now - fadeStart) / fadeDuration);
        setMusicFadeLevel(progress);
        setTransitionBlackAlpha(1 - progress);
        if (progress < 1) {
          musicFadeFrameRef.current = window.requestAnimationFrame(stepFade);
        } else {
          musicFadeFrameRef.current = null;
          setTransitionBlackAlpha(0);
        }
      };
      if (musicFadeFrameRef.current !== null) window.cancelAnimationFrame(musicFadeFrameRef.current);
      blackoutHoldTimeoutRef.current = window.setTimeout(() => {
        musicFadeFrameRef.current = window.requestAnimationFrame(stepFade);
      }, 100);
    }, 2000);
    launchEndTimeoutRef.current = window.setTimeout(() => {
      setLaunchTransition(null);
      setMusicFadeLevel(1);
      setTransitionBlackAlpha(0);
    }, 4000);
  };

  const startOnlineMatch = (roomCode: string, transport: OnlineTransport, localOnlinePlayer: PlayerId, snapshot: OnlineRoomSnapshot) => {
    if (onlineStartTriggeredRef.current) return;
    onlineStartTriggeredRef.current = true;
    beginLaunchTransition(() => {
      lastPublishedOnlineSnapshotRef.current = JSON.stringify(snapshot.state);
      loadOnlineGame(deserializeGameState(snapshot.state), {
        localPlayer: localOnlinePlayer,
        roomCode,
        transport,
        revision: snapshot.revision,
        opponentConnected: snapshot.connectedPlayers.length >= 2,
        matchConfig: snapshot.settings,
      });
      const remotePlayer = localOnlinePlayer === 'P1' ? 'P2' : 'P1';
      applyRemoteOnlinePresence(
        snapshot.selections[remotePlayer].selectedAgentId,
        (snapshot.selections[remotePlayer].selectedPeriod as TimePeriod | null) ?? null,
      );
      setOnlineLobby({ screen: 'idle' });
      setStarted(true);
    });
  };

  const returnHomeWithNotice = (message: string) => {
    setOnlineSyncError(null);
    clearQueuePoll();
    clearRoomPoll();
    lastPublishedOnlineSnapshotRef.current = null;
    onlineStartTriggeredRef.current = false;
    networkAlertSignatureRef.current = null;
    applyRemoteOnlinePresence(null, null);
    setOnlineSyncError(null);
    resetStoreForHomeScreen();
    setNetworkAlert(null);
    setExitMatchPrompt(null);
    setOnlineLobby({ screen: 'idle' });
    setOnlineStatus(state => ({
      ...state,
      loading: false,
      error: message,
      mode: 'idle',
      ticketId: null,
      roomCode: null,
      message: null,
    }));
    setStarted(false);
    setLaunchTransition(null);
    setMusicFadeLevel(1);
    setTransitionBlackAlpha(0);
  };

  const showNetworkAlert = (alert: NetworkAlertState) => {
    clearQueuePoll();
    clearRoomPoll();
    setNetworkAlert(alert);
  };

  const showNetworkAlertOnce = (signature: string, alert: NetworkAlertState) => {
    if (networkAlertSignatureRef.current === signature) return;
    networkAlertSignatureRef.current = signature;
    showNetworkAlert(alert);
  };

  const returnQueueToSearching = async (joinedAt: number, notice: string, settings: MatchConfig) => {
    clearQueuePoll();
    clearRoomPoll();
    lastPublishedOnlineSnapshotRef.current = null;
      onlineStartTriggeredRef.current = false;
      try {
      const initialState = serializeGameState(createInitialState(settings));
      const response = await joinQueueWithSettings(onlineClientIdRef.current, initialState, settings);
      const presence = await getPresence().catch(() => null);
      if (response.matched && response.roomCode && response.playerId) {
        setOnlineLobby({
          screen: 'room',
          roomCode: response.roomCode,
          transport: 'queue',
          localPlayer: response.playerId,
          joinedAt,
          settings,
          queueSeekers: response.searchingCount,
          onlineNow: presence?.onlineNow ?? null,
          snapshot: null,
          error: notice,
          readyBusy: false,
          settingsBusy: false,
          starting: false,
        });
        return;
      }
      if (!response.ticketId) {
        throw new Error('Queue ticket was not recreated.');
      }
      setOnlineLobby({
        screen: 'queue-search',
        joinedAt,
        ticketId: response.ticketId,
        settings,
        queueSeekers: response.searchingCount,
        onlineNow: presence?.onlineNow ?? null,
        error: notice,
      });
    } catch (error) {
      returnHomeWithNotice(error instanceof Error ? error.message : 'Unable to return to matchmaking.');
    }
  };

  const handleNetworkAlertAction = () => {
    if (!networkAlert) return;
    const alert = networkAlert;
    setNetworkAlert(null);
    if (alert.action === 'home') {
      returnHomeWithNotice(alert.message);
      return;
    }
    if (alert.action === 'queue') {
      void returnQueueToSearching(
        alert.joinedAt ?? Date.now(),
        alert.message,
        normalizeMatchSettings(
          alert.settings ?? (onlineLobby.screen === 'room' || onlineLobby.screen === 'queue-search'
            ? onlineLobby.settings
            : { turnTimerEnabled: false, turnTimerSeconds: DEFAULT_TURN_TIMER_SECONDS }),
        ),
      );
    }
  };

  const handleConfirmOnlineMatchExit = () => {
    if (!exitMatchPrompt) return;
    const roomCode = exitMatchPrompt.roomCode;
    setExitMatchPrompt(null);
    returnHomeWithNotice('You withdrew from the live operation and returned to command.');
    void leaveRoom(roomCode, onlineClientIdRef.current).catch(() => {});
  };

  useEffect(() => {
    if (started) return;
    void refreshPresence();
    const timer = window.setInterval(() => {
      void refreshPresence();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [started]);

  const handleStartOnlineQueue = async (settings: MatchConfig) => {
    if (launchTransition) return;
    setOnlineStatus(state => ({ ...state, loading: true, error: null }));
    try {
      const normalizedSettings = normalizeMatchSettings(settings);
      const initialState = serializeGameState(createInitialState(normalizedSettings));
      const response = await joinQueueWithSettings(onlineClientIdRef.current, initialState, normalizedSettings);
      const presence = await getPresence().catch(() => null);
      setOnlineStatus(state => ({
        ...state,
        loading: false,
        error: null,
        queueSeekers: response.searchingCount,
      }));
      if (response.matched && response.roomCode && response.playerId) {
        setOnlineLobby({
          screen: 'room',
          roomCode: response.roomCode,
          transport: 'queue',
          localPlayer: response.playerId,
          joinedAt: Date.now(),
          settings: normalizedSettings,
          queueSeekers: response.searchingCount,
          onlineNow: presence?.onlineNow ?? null,
            snapshot: null,
            error: null,
            readyBusy: false,
            settingsBusy: false,
            starting: false,
          });
        return;
      }
      if (!response.ticketId) {
        throw new Error('Queue ticket was not created.');
      }
      setOnlineLobby({
        screen: 'queue-search',
        joinedAt: Date.now(),
        ticketId: response.ticketId,
        settings: normalizedSettings,
        queueSeekers: response.searchingCount,
        onlineNow: presence?.onlineNow ?? null,
        error: null,
      });
    } catch (error) {
      setOnlineStatus(state => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to enter the queue.',
      }));
    }
  };

  const handleCreateOnlineRoom = async (settings: MatchConfig) => {
    if (launchTransition) return;
    setOnlineStatus(state => ({ ...state, loading: true, error: null }));
    try {
      const normalizedSettings = normalizeMatchSettings(settings);
      const initialState = serializeGameState(createInitialState(normalizedSettings));
      const response = await createPrivateRoom(onlineClientIdRef.current, initialState, normalizedSettings);
      setOnlineStatus(state => ({
        ...state,
        loading: false,
        error: null,
      }));
      setOnlineLobby({
        screen: 'room',
        roomCode: response.roomCode,
        transport: 'room',
        localPlayer: response.playerId,
        joinedAt: Date.now(),
        settings: normalizedSettings,
        queueSeekers: null,
        onlineNow: null,
        snapshot: null,
        error: null,
        readyBusy: false,
        settingsBusy: false,
        starting: false,
      });
    } catch (error) {
      setOnlineStatus(state => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to create room.',
      }));
    }
  };

  const handleJoinOnlineRoom = async (roomCode: string) => {
    if (launchTransition) return;
    setOnlineStatus(state => ({ ...state, loading: true, error: null }));
    try {
      const normalizedRoomCode = normalizeRoomCode(roomCode);
      const response = await joinPrivateRoom(onlineClientIdRef.current, normalizedRoomCode);
      setOnlineStatus(state => ({
        ...state,
        loading: false,
        error: null,
      }));
      setOnlineLobby({
        screen: 'room',
        roomCode: response.roomCode,
        transport: 'room',
        localPlayer: response.playerId,
        joinedAt: Date.now(),
        settings: normalizeMatchSettings({ turnTimerEnabled: false, turnTimerSeconds: DEFAULT_TURN_TIMER_SECONDS }),
        queueSeekers: null,
        onlineNow: null,
        snapshot: null,
        error: null,
        readyBusy: false,
        settingsBusy: false,
        starting: false,
      });
    } catch (error) {
      setOnlineStatus(state => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to join room.',
      }));
    }
  };

  const handleCancelOnline = async () => {
    clearQueuePoll();
    clearRoomPoll();
    if (onlineLobby.screen === 'queue-search') {
      await cancelQueue(onlineLobby.ticketId).catch(() => {});
    }
    if (onlineLobby.screen === 'room') {
      await leaveRoom(onlineLobby.roomCode, onlineClientIdRef.current).catch(() => {});
    }
    onlineStartTriggeredRef.current = false;
    resetStoreForHomeScreen();
    setNetworkAlert(null);
    setExitMatchPrompt(null);
    setOnlineLobby({ screen: 'idle' });
    setOnlineStatus(state => ({
      ...state,
      loading: false,
      error: null,
      mode: 'idle',
      ticketId: null,
      roomCode: null,
      message: null,
    }));
    void refreshPresence();
  };

  const handleToggleReady = async () => {
    if (onlineLobby.screen !== 'room' || !onlineLobby.snapshot) return;
    setOnlineLobby(state => state.screen === 'room' ? { ...state, readyBusy: true, error: null } : state);
    const readyPlayers = new Set(onlineLobby.snapshot.readyPlayers);
    const nextReady = !readyPlayers.has(onlineLobby.localPlayer);
    try {
      const snapshot = await setRoomReady(onlineLobby.roomCode, onlineClientIdRef.current, nextReady);
      setOnlineLobby(state => state.screen === 'room' ? { ...state, snapshot, readyBusy: false, error: null } : state);
    } catch (error) {
      setOnlineLobby(state => state.screen === 'room' ? {
        ...state,
        readyBusy: false,
        error: error instanceof Error ? error.message : 'Ready signal failed.',
      } : state);
    }
  };

  const handleUpdateRoomSettings = async (settings: MatchConfig) => {
    if (onlineLobby.screen !== 'room' || onlineLobby.transport !== 'room' || onlineLobby.localPlayer !== 'P1') return;
    setOnlineLobby(state => state.screen === 'room' ? { ...state, settingsBusy: true, error: null } : state);
    try {
      const snapshot = await updateRoomSettings(
        onlineLobby.roomCode,
        onlineClientIdRef.current,
        normalizeMatchSettings(settings),
      );
      setOnlineLobby(state => state.screen === 'room' ? {
        ...state,
        snapshot,
        settings: snapshot.settings,
        settingsBusy: false,
        error: null,
      } : state);
    } catch (error) {
      setOnlineLobby(state => state.screen === 'room' ? {
        ...state,
        settingsBusy: false,
        error: error instanceof Error ? error.message : 'Room settings update failed.',
      } : state);
    }
  };

  useEffect(() => {
    if (started || onlineLobby.screen !== 'queue-search') return;
    clearQueuePoll();
    const ticketId = onlineLobby.ticketId;
    const pollGeneration = queuePollGenerationRef.current;

    const poll = async () => {
      try {
        const response = await pollQueue(ticketId);
        if (queuePollGenerationRef.current !== pollGeneration) return;
        const presence = await getPresence().catch(() => null);
        if (queuePollGenerationRef.current !== pollGeneration) return;
        setOnlineLobby(state => state.screen === 'queue-search' ? {
          ...state,
          queueSeekers: response.searchingCount,
          onlineNow: presence?.onlineNow ?? state.onlineNow,
          error: null,
        } : state);
        if (response.matched && response.roomCode && response.playerId) {
          clearQueuePoll();
          const joinedAt = onlineLobby.screen === 'queue-search' ? onlineLobby.joinedAt : Date.now();
          setOnlineLobby({
            screen: 'room',
            roomCode: response.roomCode,
            transport: 'queue',
            localPlayer: response.playerId,
            joinedAt,
            settings: onlineLobby.settings,
            queueSeekers: response.searchingCount,
            onlineNow: presence?.onlineNow ?? null,
            snapshot: null,
            error: null,
            readyBusy: false,
            settingsBusy: false,
            starting: false,
          });
          return;
        }
      } catch (error) {
        if (queuePollGenerationRef.current !== pollGeneration) return;
        setOnlineLobby(state => state.screen === 'queue-search' ? {
          ...state,
          error: error instanceof Error ? error.message : 'Queue polling failed.',
        } : state);
      }
      if (queuePollGenerationRef.current !== pollGeneration) return;
      onlinePollTimerRef.current = window.setTimeout(poll, 2000);
    };

    void poll();
    return clearQueuePoll;
  }, [onlineLobby.screen, onlineLobby.screen === 'queue-search' ? onlineLobby.ticketId : null, started]);

  useEffect(() => {
    if (started || onlineLobby.screen !== 'room') return;
    clearRoomPoll();
    const roomCode = onlineLobby.roomCode;
    const transport = onlineLobby.transport;
    const localOnlinePlayer = onlineLobby.localPlayer;
    const joinedAt = onlineLobby.joinedAt;
    const hadRemoteConnected = (onlineLobby.snapshot?.connectedPlayers.length ?? 0) >= 2;
    const pollGeneration = roomPollGenerationRef.current;

    const poll = async () => {
      try {
        const snapshot = await getRoomSnapshot(roomCode);
        if (roomPollGenerationRef.current !== pollGeneration) return;
        const remoteConnected = localOnlinePlayer === 'P1' ? snapshot.guestConnected : snapshot.hostConnected;
        setOnlineLobby(state => state.screen === 'room' ? {
          ...state,
          snapshot,
          settings: snapshot.settings,
          error: null,
        } : state);
        const remotePlayer = localOnlinePlayer === 'P1' ? 'P2' : 'P1';
        applyRemoteOnlinePresence(
          snapshot.selections[remotePlayer].selectedAgentId,
          (snapshot.selections[remotePlayer].selectedPeriod as TimePeriod | null) ?? null,
        );
        if (remoteConnected) {
          networkAlertSignatureRef.current = null;
        }
        if (!remoteConnected) {
          const shouldTreatAsDeparture = transport === 'queue' || hadRemoteConnected;
          if (shouldTreatAsDeparture) {
            if (transport === 'queue') {
              showNetworkAlertOnce(`waiting:${roomCode}:queue-left`, {
                message: 'Other operative left the queue room. Return to match finding to continue the operation.',
                actionLabel: 'RETURN TO MATCH FINDING',
                action: 'queue',
                joinedAt,
                settings: snapshot.settings,
              });
            } else {
              if (localOnlinePlayer === 'P1') {
                setOnlineLobby(state => state.screen === 'room' ? {
                  ...state,
                  snapshot,
                  error: 'Guest left the private room. Room remains open for another operative.',
                } : state);
                showNetworkAlertOnce(`waiting:${roomCode}:guest-left`, {
                  message: 'Your guest left the private room. The room remains under your control and ready for a new operative.',
                  actionLabel: 'ACKNOWLEDGE',
                  action: 'dismiss',
                });
              } else {
                returnWaitingRoomToHomeSilently();
              }
            }
            return;
          }
        }
        if (snapshot.status === 'active') {
          clearRoomPoll();
          startOnlineMatch(roomCode, transport, localOnlinePlayer, snapshot);
          return;
        }
      } catch (error) {
        if (roomPollGenerationRef.current !== pollGeneration) return;
        const message = error instanceof Error ? error.message : 'Room polling failed.';
        if (transport === 'queue') {
          showNetworkAlertOnce(`waiting:${roomCode}:queue-left`, {
            message: 'Other operative left the queue room. Return to match finding to continue the operation.',
            actionLabel: 'RETURN TO MATCH FINDING',
            action: 'queue',
            joinedAt,
            settings: normalizeMatchSettings(
              onlineLobby.screen === 'room'
                ? onlineLobby.settings
                : { turnTimerEnabled: false, turnTimerSeconds: DEFAULT_TURN_TIMER_SECONDS },
            ),
          });
        } else if (message.includes('was not found')) {
          if (localOnlinePlayer === 'P1') {
            showNetworkAlertOnce(`waiting:${roomCode}:guest-left`, {
              message: 'Your guest left the private room. The room remains under your control and ready for a new operative.',
              actionLabel: 'ACKNOWLEDGE',
              action: 'dismiss',
            });
          } else {
            returnWaitingRoomToHomeSilently();
            return;
          }
        } else {
          setOnlineLobby(state => state.screen === 'room' ? {
            ...state,
            error: message,
          } : state);
        }
      }
      if (roomPollGenerationRef.current !== pollGeneration) return;
      roomPollTimerRef.current = window.setTimeout(poll, 1000);
    };

    void poll();
    return clearRoomPoll;
  }, [
    onlineLobby.screen,
    onlineLobby.screen === 'room' ? onlineLobby.roomCode : null,
    onlineLobby.screen === 'room' ? onlineLobby.transport : null,
    onlineLobby.screen === 'room' ? onlineLobby.localPlayer : null,
    onlineLobby.screen === 'room' ? onlineLobby.joinedAt : null,
    onlineLobby.screen === 'room' ? onlineLobby.snapshot?.connectedPlayers.length ?? 0 : null,
    started,
  ]);

  useEffect(() => {
    if (!started || gameMode !== 'online_2p' || !onlineRoomCode) return;
    clearRoomPoll();
    const pollGeneration = roomPollGenerationRef.current;

    const poll = async () => {
      try {
        const snapshot = await getRoomSnapshot(onlineRoomCode);
        if (roomPollGenerationRef.current !== pollGeneration) return;
        const remoteConnected = localPlayer === 'P1' ? snapshot.guestConnected : snapshot.hostConnected;
        if (remoteConnected) {
          networkAlertSignatureRef.current = null;
        }
        if (!remoteConnected) {
          showNetworkAlertOnce(`active:${onlineRoomCode}:remote-left`, {
            message: 'The remote operative has left the mission. Return to command to debrief and reopen the channel.',
            actionLabel: 'RETURN TO HOME',
            action: 'home',
          });
          return;
        }
        if (snapshot.revision > onlineRevision) {
          lastPublishedOnlineSnapshotRef.current = JSON.stringify(snapshot.state);
          applyRemoteOnlineGame(
            deserializeGameState(snapshot.state),
            snapshot.revision,
            snapshot.connectedPlayers.length >= 2,
          );
        }
        const remotePlayer = localPlayer === 'P1' ? 'P2' : 'P1';
        applyRemoteOnlinePresence(
          snapshot.selections[remotePlayer].selectedAgentId,
          (snapshot.selections[remotePlayer].selectedPeriod as TimePeriod | null) ?? null,
        );
      } catch (error) {
        if (roomPollGenerationRef.current !== pollGeneration) return;
        const message = error instanceof Error ? error.message : 'Online sync interrupted.';
        if (message.includes('was not found')) {
          showNetworkAlertOnce(`active:${onlineRoomCode}:remote-left`, {
            message: 'The remote operative has left the mission. Return to command to debrief and reopen the channel.',
            actionLabel: 'RETURN TO HOME',
            action: 'home',
          });
          return;
        }
        setOnlineSyncError(message);
      }
      if (roomPollGenerationRef.current !== pollGeneration) return;
      roomPollTimerRef.current = window.setTimeout(poll, 1200);
    };

    void poll();
    return clearRoomPoll;
  }, [applyRemoteOnlineGame, gameMode, onlineRevision, onlineRoomCode, setOnlineSyncError, started]);

  useEffect(() => {
    if (!started || gameMode !== 'online_2p' || !onlineRoomCode) return;
    const snapshot = serializeGameState(game);
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastPublishedOnlineSnapshotRef.current) return;

    void pushRoomSnapshot(onlineRoomCode, onlineClientIdRef.current, onlineRevision, snapshot)
      .then(response => {
        lastPublishedOnlineSnapshotRef.current = serialized;
        applyRemoteOnlineGame(game, response.revision, onlineOpponentConnected);
      })
      .catch(error => {
        setOnlineSyncError(error instanceof Error ? error.message : 'Unable to publish your move.');
      });
  }, [applyRemoteOnlineGame, game, gameMode, onlineOpponentConnected, onlineRevision, onlineRoomCode, setOnlineSyncError, started]);

  useEffect(() => {
    const roomCode = started
      ? (gameMode === 'online_2p' ? onlineRoomCode : null)
      : (onlineLobby.screen === 'room' ? onlineLobby.roomCode : null);
    if (!roomCode) return;
    const activePlayer = started
      ? localPlayer
      : (onlineLobby.screen === 'room' ? onlineLobby.localPlayer : null);
    if (!activePlayer) return;

    void pushRoomPresence(
      roomCode,
      onlineClientIdRef.current,
      selectedAgentId,
      selectedAgentId ? selectedPeriod : null,
    ).catch(() => {});
  }, [gameMode, localPlayer, onlineLobby, onlineRoomCode, selectedAgentId, selectedPeriod, started]);

  if (!started) {
    const queueLobby = onlineLobby.screen === 'queue-search' ? onlineLobby : null;
    const roomLobby = onlineLobby.screen === 'room' ? onlineLobby : null;
    const localReady = roomLobby?.snapshot?.readyPlayers.includes(roomLobby.localPlayer) ?? false;
    const opponentReady = roomLobby?.snapshot
      ? roomLobby.snapshot.readyPlayers.some(playerId => playerId !== roomLobby.localPlayer)
      : false;
    const partnerJoined = roomLobby?.snapshot
      ? (roomLobby.localPlayer === 'P1' ? roomLobby.snapshot.guestConnected : roomLobby.snapshot.hostConnected)
      : false;
    const countdownEndsAt = roomLobby?.snapshot?.countdownStartAt
      ? roomLobby.snapshot.countdownStartAt + 3000
      : null;
    const roomConnected = (roomLobby?.snapshot?.connectedPlayers.length ?? 0) >= 2;
    const matchFound = roomLobby?.transport === 'queue' && roomConnected;

    return (
      <div
        className="min-h-screen text-white"
        style={{ filter: `brightness(${brightness})` }}
      >
        <audio
          ref={audioRef}
          loop
          preload="auto"
          autoPlay
          playsInline
          muted={muteAllAudio}
        />
        <audio ref={uiClickRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'ui_click')?.src} />
        <audio ref={moveClickRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'move_click')?.src} />
        <audio ref={stompRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'stomp_impact')?.src} />
        <audio ref={warpRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'warp_slide')?.src} />
        <audio ref={invalidBuzzRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'invalid_buzz')?.src} />
        <audio ref={paradoxRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'paradox_alarm')?.src} />
        <audio ref={successRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'mission_success')?.src} />
        <audio ref={matchFoundVoiceRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'match_found_voice')?.src} />
        {queueLobby ? (
          <MatchmakingLobby
            mode="queue-search"
            joinedAt={queueLobby.joinedAt}
            queueSeekers={queueLobby.queueSeekers}
            onlineNow={queueLobby.onlineNow}
            settings={queueLobby.settings}
            message="Scanning the channel for another operative. Returning home will cancel the queue."
            error={queueLobby.error}
            onLeave={() => { void handleCancelOnline(); }}
          />
        ) : roomLobby ? (
          <MatchmakingLobby
            mode="room"
            transport={roomLobby.transport}
            roomCode={roomLobby.roomCode}
            queueSeekers={roomLobby.transport === 'queue' ? roomLobby.queueSeekers : null}
            onlineNow={roomLobby.transport === 'queue' ? roomLobby.onlineNow : null}
            joinedAt={roomLobby.joinedAt}
            settings={roomLobby.settings}
            localReady={localReady}
            opponentReady={opponentReady}
            localPlayer={roomLobby.localPlayer}
            partnerJoined={partnerJoined}
            countdownEndsAt={countdownEndsAt}
            matchFound={matchFound}
            message={
              roomLobby.transport === 'queue'
                ? 'Match locked. Both operatives must mark ready before insertion.'
                : `Room ${roomLobby.roomCode} is active. Both operatives must mark ready before insertion.`
            }
            error={roomLobby.error}
            busy={roomLobby.readyBusy}
            settingsBusy={roomLobby.settingsBusy}
            readyEnabled={roomConnected && !(countdownEndsAt !== null && countdownEndsAt <= Date.now())}
            onReady={() => { void handleToggleReady(); }}
            onUpdateSettings={(nextSettings) => { void handleUpdateRoomSettings(nextSettings); }}
            onLeave={() => { void handleCancelOnline(); }}
            allowLeave
          />
        ) : (
          <StartScreen
            onStart={handleStart}
            onContinueSavedVsAi={handleContinueSavedVsAi}
            onStartNewVsAi={handleStartNewVsAi}
            onStartTutorial={handleStartTutorial}
            onStartOnlineQueue={handleStartOnlineQueue}
            onCreateOnlineRoom={handleCreateOnlineRoom}
            onJoinOnlineRoom={handleJoinOnlineRoom}
            onCancelOnline={handleCancelOnline}
            onlineStatus={onlineStatus}
            hasSavedVsAiGame={hasSavedVsAiGame}
          />
        )}
        <SettingsScreen />
        <TutorialOverlay />
        <AnimatePresence>
          {networkAlert && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[95] flex items-center justify-center bg-[#000000aa] px-6"
            >
              <motion.div
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                className="w-full max-w-xl rounded-[28px] border border-[#ffcf8a55] bg-[#07101ae8] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.42)]"
              >
                <div className="font-['Orbitron'] text-lg tracking-[0.18em] text-[#ffcf8a]">CHANNEL UPDATE</div>
                <div className="mt-3 font-['Share_Tech_Mono'] text-[12px] leading-relaxed text-[#dbe9ff99]">
                  {networkAlert.message}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    playSoundEffect('ui_click');
                    handleNetworkAlertAction();
                  }}
                  className="mt-5 rounded border border-[#ffcf8a55] bg-[#ffcf8a14] px-5 py-3 font-['Orbitron'] text-sm tracking-[0.16em] text-[#ffcf8a] transition-colors hover:bg-[#ffcf8a22]"
                >
                  {networkAlert.actionLabel}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {launchTransition === 'darkening' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.9, ease: 'easeInOut' }}
              className="fixed inset-0 z-[90] pointer-events-none"
              style={{ background: '#000000' }}
            />
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col text-white select-none"
      style={{ background: '#050510', height: '100vh', overflow: 'hidden', filter: `brightness(${brightness})` }}
    >
      <audio
        ref={audioRef}
        loop
        preload="auto"
        autoPlay
        playsInline
        muted={muteAllAudio}
      />
      <audio ref={uiClickRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'ui_click')?.src} />
      <audio ref={moveClickRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'move_click')?.src} />
      <audio ref={stompRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'stomp_impact')?.src} />
      <audio ref={warpRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'warp_slide')?.src} />
      <audio ref={invalidBuzzRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'invalid_buzz')?.src} />
      <audio ref={paradoxRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'paradox_alarm')?.src} />
      <audio ref={successRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'mission_success')?.src} />
      <audio ref={matchFoundVoiceRef} preload="auto" src={SOUND_EFFECTS.find(effect => effect.id === 'match_found_voice')?.src} />
      <GameHUD />
      <NotificationToasts />
      <SettingsScreen />
      <TutorialOverlay />
      <AnimatePresence>
        {exitMatchPrompt && (
          <ExitMatchPrompt
            countdownEndsAt={exitMatchPrompt.countdownEndsAt}
            onCancel={() => {
              playSoundEffect('ui_click');
              setExitMatchPrompt(null);
            }}
            onConfirm={() => {
              playSoundEffect('ui_click');
              void handleConfirmOnlineMatchExit();
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {networkAlert && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[95] flex items-center justify-center bg-[#000000aa] px-6"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-xl rounded-[28px] border border-[#ff446655] bg-[#07101ae8] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.42)]"
            >
              <div className="font-['Orbitron'] text-lg tracking-[0.18em] text-[#ff9aa8]">CHANNEL LOST</div>
              <div className="mt-3 font-['Share_Tech_Mono'] text-[12px] leading-relaxed text-[#dbe9ff99]">
                {networkAlert.message}
              </div>
              <button
                type="button"
                onClick={() => {
                  playSoundEffect('ui_click');
                  handleNetworkAlertAction();
                }}
                className="mt-5 rounded border border-[#ff446655] bg-[#ff446614] px-5 py-3 font-['Orbitron'] text-sm tracking-[0.16em] text-[#ffd7dd] transition-colors hover:bg-[#ff446622]"
              >
                {networkAlert.actionLabel}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {turnTimeoutNotice && (
          <CenterPrompt
            title="TURN WINDOW EXPIRED"
            accent="#ffcf8a"
            body={turnTimeoutNotice}
            buttonLabel="PROCEED"
            onConfirm={() => {
              playSoundEffect('ui_click');
              dismissTurnTimeoutNotice();
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {localTurnHandoffPlayer && !turnTimeoutNotice && (
          <CenterPrompt
            title="PASS THE CONSOLE"
            accent={localTurnHandoffPlayer === 'P1' ? '#00d4ff' : '#ff4466'}
            body={`Hand the command terminal to ${localTurnHandoffPlayer === 'P1' ? 'Blue Operative' : 'Red Operative'}. Once the screen is clear and secure, the receiving operative should press PROCEED.`}
            buttonLabel="PROCEED"
            strongerCover
            onConfirm={() => {
              playSoundEffect('ui_click');
              acknowledgeLocalHandoff();
            }}
          />
        )}
      </AnimatePresence>

      {/* Main game area */}
      <div className="flex flex-1 overflow-hidden min-h-0 relative">

        <div className="flex flex-1 gap-2 p-2 min-w-0 justify-center items-stretch">
          <AnimatePresence initial={false}>
            {visiblePeriods.map(period => {
              const isSelectedPeriod = selectedAgent?.currentPeriod === period;
              const isAiPeriod = aiActivePeriod === period;
              const localSelectionColor = localPlayer === 'P1' ? '#00d4ff' : '#ff4466';
              const remoteSelectionColor = localPlayer === 'P1' ? '#ff4466' : '#00d4ff';
              const showRemotePresence = gameMode === 'online_2p' && game.currentTurn !== localPlayer;
              const isRemotePeriod = showRemotePresence && remoteSelectedPeriod === period;
              const borderColor = isSelectedPeriod
                ? localSelectionColor
                : isAiPeriod
                  ? '#ffb366'
                  : isRemotePeriod
                    ? remoteSelectionColor
                  : '#ffffff0f';

              return (
                <motion.div
                  key={period}
                  layout
                  initial={collapsingPeriods.includes(period) ? { opacity: 1, scale: 1 } : false}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    boxShadow: isSelectedPeriod
                      ? `0 0 0 1px ${localSelectionColor}aa, 0 0 28px ${localSelectionColor}22`
                      : isAiPeriod
                        ? '0 0 0 1px rgba(255,179,102,0.75), 0 0 28px rgba(255,179,102,0.22)'
                        : isRemotePeriod
                          ? `0 0 0 1px ${remoteSelectionColor}aa, 0 0 22px ${remoteSelectionColor}22`
                        : 'none',
                  }}
                  exit={collapsingPeriods.includes(period) ? {
                    opacity: 0,
                    scale: 0.88,
                    filter: 'brightness(1.65)',
                    transition: { duration: 0.42, ease: 'easeInOut' },
                  } : { opacity: 0 }}
                  className="rounded overflow-hidden border relative flex-shrink-0"
                  id={`period-${period.toLowerCase()}`}
                  style={{ minWidth: 0, width: columnWidth, maxWidth: columnWidth, borderColor }}
                >
                  <AnimatePresence>
                    {traversalEffects
                      .filter(effect => effect.sourcePeriod === period || effect.targetPeriod === period)
                      .map(effect => {
                        const entering = effect.targetPeriod === period;
                        return (
                          <motion.div
                            key={effect.id}
                            initial={{ opacity: 0, scale: entering ? 0.86 : 1.08 }}
                            animate={{ opacity: [0, entering ? 0.78 : 0.48, 0], scale: entering ? [0.86, 1.02, 1.16] : [1.08, 1.01, 0.94] }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.82, ease: 'easeOut' }}
                            className="absolute inset-0 z-10 pointer-events-none"
                            style={{
                              background: entering
                                ? 'radial-gradient(circle at 50% 50%, rgba(125,220,255,0.22), rgba(125,220,255,0.08) 30%, rgba(0,0,0,0) 65%)'
                                : 'radial-gradient(circle at 50% 50%, rgba(180,120,255,0.16), rgba(180,120,255,0.05) 32%, rgba(0,0,0,0) 68%)',
                              mixBlendMode: 'screen',
                            }}
                          />
                        );
                      })}
                  </AnimatePresence>
                  {collapsingPeriods.includes(period) && (
                    <motion.div
                      initial={{ opacity: 0.15 }}
                      animate={{ opacity: [0.2, 0.65, 0.2] }}
                      transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }}
                      className="absolute inset-0 z-10 pointer-events-none"
                      style={{
                        background: 'radial-gradient(circle at 50% 50%, rgba(255,120,80,0.45), rgba(255,40,0,0.08) 55%, rgba(0,0,0,0) 75%)',
                        mixBlendMode: 'screen',
                      }}
                    />
                  )}
                  <ResponsiveTimelineCanvas period={period} />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        <div
          className="flex flex-col border-l border-[#ffffff0f]"
          style={{ width: '320px', minWidth: '320px' }}
        >
          <div className="flex-1 overflow-hidden p-2 min-h-0">
            {terminalMode ? <GameTerminal /> : <ActionPanel />}
          </div>
        </div>

        {intelFeedOpen && (
          <div className="absolute inset-y-0 right-0 w-[320px] border-l border-[#ffffff0f] bg-[#050510f2] backdrop-blur-sm">
            <NotificationFeed />
          </div>
        )}
      </div>

      <GameOver />
      <AnimatePresence>
        {launchTransition === 'darkening' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeInOut' }}
            className="fixed inset-0 z-[90] pointer-events-none"
            style={{ background: '#000000' }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {launchTransition === 'revealing' && (
          <motion.div
            initial={false}
            animate={{ opacity: transitionBlackAlpha }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.08, ease: 'linear' }}
            className="fixed inset-0 z-[85] pointer-events-none"
            style={{ background: '#000000' }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ExitMatchPrompt({
  countdownEndsAt,
  onCancel,
  onConfirm,
}: {
  countdownEndsAt: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(interval);
  }, []);

  const secondsRemaining = Math.max(0, Math.ceil((countdownEndsAt - now) / 1000));
  const confirmEnabled = secondsRemaining === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[96] flex items-center justify-center bg-[#000000bb] px-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="w-full max-w-xl rounded-[28px] border border-[#ff446655] bg-[#07101ae8] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.42)]"
      >
        <div className="font-['Orbitron'] text-lg tracking-[0.18em] text-[#ffb3bf]">WITHDRAW FROM MISSION</div>
        <div className="mt-3 font-['Share_Tech_Mono'] text-[12px] leading-relaxed text-[#dbe9ff99]">
          Returning to command will dismantle this live room, end the current operation for both operatives, and send your counterpart back to home as well.
        </div>
        <div className="mt-4 rounded border border-[#ffffff18] bg-[#050b12cc] px-4 py-3 font-['Share_Tech_Mono'] text-[11px] text-[#ffcf8a]">
          {confirmEnabled
            ? 'Withdrawal timer complete. You may now continue to home.'
            : `Hold position for ${secondsRemaining} second${secondsRemaining === 1 ? '' : 's'} before the withdrawal can be confirmed.`}
        </div>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-[#ffffff22] px-5 py-3 font-['Orbitron'] text-sm tracking-[0.16em] text-[#dff7ff] transition-colors hover:bg-[#ffffff10]"
          >
            STAY IN MATCH
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmEnabled}
            className="rounded border border-[#ff446655] bg-[#ff446614] px-5 py-3 font-['Orbitron'] text-sm tracking-[0.16em] text-[#ffd7dd] transition-colors hover:bg-[#ff446622] disabled:cursor-not-allowed disabled:opacity-50"
          >
            CONTINUE TO HOME
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CenterPrompt({
  title,
  accent,
  body,
  buttonLabel,
  strongerCover = false,
  onConfirm,
}: {
  title: string;
  accent: string;
  body: string;
  buttonLabel: string;
  strongerCover?: boolean;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[96] flex items-center justify-center px-6"
      style={{
        background: strongerCover ? 'rgba(1, 2, 6, 0.97)' : 'rgba(0, 0, 0, 0.78)',
        backdropFilter: strongerCover ? 'blur(24px) saturate(0.2)' : 'blur(10px)',
      }}
    >
      {strongerCover && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 opacity-35" style={{
            backgroundImage: 'repeating-linear-gradient(180deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 8px)',
          }} />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04),rgba(0,0,0,0.82)_55%)]" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-[#ffffff10]" />
        </div>
      )}
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="w-full max-w-xl rounded-[28px] border p-6 shadow-[0_30px_120px_rgba(0,0,0,0.42)]"
        style={{ borderColor: `${accent}66`, background: '#07101ae8' }}
      >
        <div className="font-['Orbitron'] text-lg tracking-[0.18em]" style={{ color: accent }}>{title}</div>
        <div className="mt-3 font-['Share_Tech_Mono'] text-[12px] leading-relaxed text-[#dbe9ff99]">
          {body}
        </div>
        <button
          type="button"
          onClick={onConfirm}
          className="mt-5 rounded border px-5 py-3 font-['Orbitron'] text-sm tracking-[0.16em] transition-colors hover:bg-[#ffffff10]"
          style={{ borderColor: `${accent}66`, color: accent, background: `${accent}14` }}
        >
          {buttonLabel}
        </button>
      </motion.div>
    </motion.div>
  );
}
