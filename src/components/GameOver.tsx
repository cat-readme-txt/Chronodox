// ============================================================
// CHRONODOX — GameOver Screen
// ============================================================

import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';

export function GameOver() {
  const {
    game,
    playSoundEffect,
    tutorialPendingCompletionMode,
    resolveGameOverChoice,
    trainingStorageNotice,
  } = useGameStore();
  const hasPlayedSuccessRef = useRef(false);

  useEffect(() => {
    if (game.phase !== 'GAME_OVER') {
      hasPlayedSuccessRef.current = false;
      return;
    }
    if (game.winner !== 'P1') return;
    if (hasPlayedSuccessRef.current) return;
    hasPlayedSuccessRef.current = true;
    playSoundEffect('mission_success');
  }, [game.phase, game.winner, playSoundEffect]);

  if (game.phase !== 'GAME_OVER') return null;

  const winnerColor = game.winner === 'P1' ? '#00d4ff' : game.winner === 'P2' ? '#ff4466' : '#ffffff';
  const winnerLabel = game.winner === 'P1'
    ? 'MISSION ACCOMPLISHED'
    : game.winner === 'P2'
      ? 'MISSION LOST'
      : 'MISSION STALEMATE';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: '#000000cc', backdropFilter: 'blur(8px)' }}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
        className="text-center border border-[#ffffff22] rounded-lg p-16"
        style={{ background: 'linear-gradient(135deg, #0a0612, #060d12)' }}
      >
        {/* Glitch title */}
        <motion.div
          animate={{ opacity: [1, 0.8, 1], x: [0, -1, 1, 0] }}
          transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 3 }}
          className="font-['Orbitron'] font-black text-5xl mb-3 tracking-widest"
          style={{ color: winnerColor, textShadow: `0 0 40px ${winnerColor}66` }}
        >
          {winnerLabel}
        </motion.div>

        <div className="text-[#ffffff33] font-['Share_Tech_Mono'] text-sm mb-2 tracking-widest">
          TEMPORAL OPERATION COMPLETE
        </div>
        <div className="text-[#ffffff22] font-['Share_Tech_Mono'] text-xs mb-10">
          ROUND {game.round} — {game.notifications.length} FIELD REPORTS LOGGED
        </div>
        {game.winnerReason && (
          <div className="max-w-[32rem] mx-auto mb-8 text-[#d9e7ffbb] font-['Share_Tech_Mono'] text-[11px] leading-relaxed">
            {game.winnerReason}
          </div>
        )}
        {trainingStorageNotice && (
          <div className="max-w-[34rem] mx-auto mb-8 rounded border border-[#ffb36677] bg-[#2a1408cc] px-4 py-3 text-left font-['Share_Tech_Mono'] text-[11px] leading-relaxed text-[#ffd7b3]">
            <div className="font-['Orbitron'] text-[10px] tracking-[0.22em] text-[#ffb366]">ARCHIVE WARNING</div>
            <div className="mt-2">{trainingStorageNotice}</div>
          </div>
        )}

        {/* Stats */}
        <div className="flex gap-8 justify-center mb-10 text-xs font-['Share_Tech_Mono']">
          <div className="text-center">
            <div className="text-[#00d4ff] text-lg font-bold font-['Orbitron']">
              {game.players.P1.agents.length}
            </div>
            <div className="text-[#ffffff33]">P1 AGENTS</div>
          </div>
          <div className="text-center">
            <div className="text-[#ff4466] text-lg font-bold font-['Orbitron']">
              {game.players.P2.agents.length}
            </div>
            <div className="text-[#ffffff33]">P2 AGENTS</div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {tutorialPendingCompletionMode === 'restore' && (
            <motion.button
              whileHover={{ scale: 1.03, boxShadow: '0 0 26px #00d4ff33' }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                playSoundEffect('ui_click');
                resolveGameOverChoice('restore');
              }}
              className="px-6 py-4 rounded font-['Orbitron'] font-bold text-sm tracking-widest transition-all"
              style={{ border: '1px solid #00d4ff', color: '#dff7ff', background: '#00d4ff14' }}
            >
              RETURN TO LIVE OP
            </motion.button>
          )}
          <motion.button
            whileHover={{ scale: 1.03, boxShadow: '0 0 26px #7b4fd444' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              playSoundEffect('ui_click');
              resolveGameOverChoice('new');
            }}
            className="px-6 py-4 rounded font-['Orbitron'] font-bold text-sm tracking-widest transition-all"
            style={{ border: '1px solid #7b4fd4', color: '#c9a8ff', background: '#7b4fd411' }}
          >
            START NEW TIMELINE
          </motion.button>
          {tutorialPendingCompletionMode && (
            <motion.button
              whileHover={{ scale: 1.03, boxShadow: '0 0 26px #8df5df33' }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                playSoundEffect('ui_click');
                resolveGameOverChoice('replay');
              }}
              className="px-6 py-4 rounded font-['Orbitron'] font-bold text-sm tracking-widest transition-all"
              style={{ border: '1px solid #8df5df', color: '#dffdfa', background: '#8df5df12' }}
            >
              RUN TUTORIAL AGAIN
            </motion.button>
          )}
          <motion.button
            whileHover={{ scale: 1.03, boxShadow: '0 0 26px #ffffff22' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              playSoundEffect('ui_click');
              resolveGameOverChoice('menu');
            }}
            className="px-6 py-4 rounded font-['Orbitron'] font-bold text-sm tracking-widest transition-all"
            style={{ border: '1px solid #ffffff33', color: '#f0f3ff', background: '#ffffff10' }}
          >
            RETURN TO HQ
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
