// ============================================================
// CHRONODOX — Game HUD
// ============================================================

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';

export function GameHUD() {
  const {
    game, localPlayer, remoteSelectedAgentId, remoteSelectedPeriod, switchLocalPlayer, gameMode, onlineRoomCode, onlineOpponentConnected,
    toggleIntelFeed, intelFeedOpen, aiTurnInProgress, openSettings, openTutorial, startGuidedTutorial, guidedTutorialActive, tutorialSectionIndex, terminalMode, playSoundEffect,
    matchConfig, debugLocalSwitchEnabled,
  } = useGameStore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  const p1 = game.players.P1;
  const p2 = game.players.P2;
  const showRemotePresence = gameMode === 'online_2p' && game.currentTurn !== localPlayer;
  const remotePlayer = localPlayer === 'P1' ? 'P2' : 'P1';
  const remoteFocusLabel = showRemotePresence && (remoteSelectedAgentId || remoteSelectedPeriod)
    ? `${remotePlayer}${remoteSelectedPeriod ? ` ${remoteSelectedPeriod}` : ''}${remoteSelectedAgentId ? ` · ${remoteSelectedAgentId.toUpperCase()}` : ''}`
    : null;
  const turnSecondsRemaining = game.turnDeadlineAt
    ? Math.max(0, Math.ceil((game.turnDeadlineAt - now) / 1000))
    : null;

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-[#ffffff11]"
      style={{ background: 'linear-gradient(90deg, #0a0612, #060d12, #060812)' }}>

      <div className="flex items-center gap-3">
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={openSettings}
          className="rounded border border-[#ffffff22] px-2.5 py-1 text-[10px] font-['Share_Tech_Mono'] text-[#ffffff88] transition-colors hover:text-white"
          id="hud-settings"
        >
          SETTINGS
        </motion.button>
        {gameMode === 'vs_ai' && (
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              playSoundEffect('ui_click');
              window.dispatchEvent(new CustomEvent('chronodox:pause-vs-ai'));
            }}
            className="rounded border border-[#ffffff22] px-2.5 py-1 text-[10px] font-['Share_Tech_Mono'] text-[#ffffff88] transition-colors hover:text-white"
          >
            PAUSE TO HQ
          </motion.button>
        )}
        {gameMode === 'local_2p' && (
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              playSoundEffect('ui_click');
              window.dispatchEvent(new CustomEvent('chronodox:return-local-match'));
            }}
            className="rounded border border-[#ffffff22] px-2.5 py-1 text-[10px] font-['Share_Tech_Mono'] text-[#ffffff88] transition-colors hover:text-white"
          >
            RETURN TO HQ
          </motion.button>
        )}
        {gameMode === 'online_2p' && (
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              playSoundEffect('ui_click');
              window.dispatchEvent(new CustomEvent('chronodox:exit-online-match'));
            }}
            className="rounded border border-[#ff446633] px-2.5 py-1 text-[10px] font-['Share_Tech_Mono'] text-[#ffb3bf] transition-colors hover:text-white"
          >
            RETURN TO HQ
          </motion.button>
        )}
        {(gameMode === 'vs_ai' || guidedTutorialActive) && (
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              if (guidedTutorialActive || tutorialSectionIndex > 0) openTutorial(tutorialSectionIndex);
              else startGuidedTutorial({ restoreOnExit: true });
            }}
            className="rounded border border-[#ffffff22] px-2.5 py-1 text-[10px] font-['Share_Tech_Mono'] text-[#ffffff88] transition-colors hover:text-white"
            id="hud-tutorial"
          >
            TUTORIAL
          </motion.button>
        )}
        <div className="font-['Orbitron'] font-black text-lg tracking-widest"
          style={{ background: 'linear-gradient(90deg, #7b4fd4, #00c8a0, #ff6b35)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          CHRONODOX
        </div>
      </div>

      {/* Center: Round + Phase */}
      <div className="flex items-center gap-4 text-xs font-['Share_Tech_Mono']">
        <div className="text-[#ffffff44]">ROUND</div>
        <div className="text-white font-bold text-base font-['Orbitron']">{game.round}</div>
        <div className="px-2 py-0.5 rounded text-[10px] font-['Orbitron'] tracking-wider"
          style={{ border: '1px solid #00c8a066', color: '#00c8a0', backgroundColor: '#00c8a011' }}>
          {game.phase}
        </div>
        {terminalMode && (
          <div className="px-2 py-0.5 rounded text-[10px] font-['Orbitron'] tracking-wider border border-[#00d4ff44] text-[#8fdfff] bg-[#00d4ff11]">
            TERMINAL
          </div>
        )}
        {gameMode === 'online_2p' && onlineRoomCode && (
          <div className="px-2 py-0.5 rounded text-[10px] font-['Orbitron'] tracking-wider border border-[#ffcf8a55] text-[#ffcf8a] bg-[#ffcf8a14]">
            ROOM {onlineRoomCode} {onlineOpponentConnected ? 'LIVE' : 'WAIT'}
          </div>
        )}
        {remoteFocusLabel && (
          <div className="px-2 py-0.5 rounded text-[10px] font-['Orbitron'] tracking-wider border border-[#ffcf8a55] text-[#ffcf8a] bg-[#ffcf8a14]">
            REMOTE FOCUS {remoteFocusLabel}
          </div>
        )}
        {matchConfig.turnTimerEnabled && turnSecondsRemaining !== null && (
          <div className="px-2 py-0.5 rounded text-[10px] font-['Orbitron'] tracking-wider border border-[#8df5df55] text-[#8df5df] bg-[#061610cc]">
            TURN CLOCK {Math.floor(turnSecondsRemaining / 60)}:{String(turnSecondsRemaining % 60).padStart(2, '0')}
          </div>
        )}
      </div>

      {/* Player indicators */}
      <div className="flex items-center gap-3">
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={toggleIntelFeed}
          className="px-2 py-1 rounded text-[10px] font-['Share_Tech_Mono'] border transition-colors"
          id="hud-feed"
          style={{
            borderColor: intelFeedOpen ? '#ffd70066' : '#ffffff22',
            color: intelFeedOpen ? '#ffd700' : '#ffffff88',
            backgroundColor: intelFeedOpen ? '#ffd70012' : 'transparent',
          }}
        >
          FEED {game.notifications.length}
        </motion.button>

        {/* P1 */}
        <div className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] font-['Share_Tech_Mono'] border transition-all ${localPlayer === 'P1' ? 'border-[#00d4ff]' : 'border-[#ffffff11]'}`}>
          <span style={{ color: '#00d4ff' }}>P1</span>
          <span className="text-[#ffffff44]">★ {p1.agents.filter(a => a.isPastAgent).length > 0 ? 'ALIVE' : 'DEAD'}</span>
          <span className="text-[#ffffff33]">| {p1.agents.length} agents</span>
          {(gameMode !== 'online_2p' || game.currentTurn === 'P1') && (
            <span className="text-[#ffffff22]">
              {p1.agents.reduce((s, a) => s + a.actionsRemaining, 0)} acts
            </span>
          )}
        </div>

        {/* Switch in 2P mode */}
        {gameMode === 'local_2p' && debugLocalSwitchEnabled && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={switchLocalPlayer}
            className="px-2 py-1 rounded text-[10px] font-['Share_Tech_Mono'] border border-[#ffffff22] text-[#ffffff66] hover:text-white transition-colors"
          >
            ⇄ SWITCH
          </motion.button>
        )}

        {/* P2 */}
        <div className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] font-['Share_Tech_Mono'] border transition-all ${localPlayer === 'P2' ? 'border-[#ff4466]' : 'border-[#ffffff11]'}`}>
          <span style={{ color: '#ff4466' }}>P2 {gameMode === 'vs_ai' ? '(AI)' : gameMode === 'online_2p' ? '(REMOTE)' : ''}</span>
          {aiTurnInProgress && <span className="text-[#ff9a66]">THINKING</span>}
          <span className="text-[#ffffff44]">★ {p2.agents.filter(a => a.isPastAgent).length > 0 ? 'ALIVE' : 'DEAD'}</span>
          <span className="text-[#ffffff33]">| {p2.agents.length} agents</span>
          {(gameMode !== 'online_2p' || game.currentTurn === 'P2') && (
            <span className="text-[#ffffff22]">
              {p2.agents.reduce((s, a) => s + a.actionsRemaining, 0)} acts
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
