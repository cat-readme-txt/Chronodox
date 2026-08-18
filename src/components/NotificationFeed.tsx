// ============================================================
// CHRONODOX — NotificationFeed
// ============================================================

import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import type { Notification } from '../types/game';

const NOTIF_COLORS: Record<string, string> = {
  TRAVERSAL_DETECTED: '#b87fff',
  STRIKE_OCCURRED:    '#ff4466',
  PARADOX_OCCURRED:   '#ff6b00',
  AGENT_ELIMINATED:   '#ff2244',
  CAUSAL_COLLAPSE:    '#ff0000',
  CITY_CONTROLLED:    '#00c8a0',
  REWARD_COLLECTED:   '#ffd700',
  INTEL_OPERATION:    '#8fdfff',
};

function NotifItem({ notif }: { notif: Notification }) {
  const color = NOTIF_COLORS[notif.type] ?? '#ffffff88';
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="px-2 py-1.5 rounded mb-1 text-[9px] font-['Share_Tech_Mono'] border-l-2"
      style={{ borderColor: color, backgroundColor: color + '0f', color: color }}
    >
      <span className="opacity-50 mr-1">R{notif.round}</span>
      {notif.message}
    </motion.div>
  );
}

export function NotificationFeed() {
  const { game, localPlayer, closeIntelFeed } = useGameStore();
  const notifications = [...game.notifications]
    .filter(n => n.forPlayer === 'BOTH' || n.forPlayer === localPlayer)
    .reverse();

  return (
    <div className="h-full flex flex-col p-3">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="font-['Orbitron'] text-[10px] text-[#ffffff55]">
          INTEL FEED
        </div>
        <button
          id="feed-close"
          type="button"
          onClick={closeIntelFeed}
          className="text-[9px] font-['Share_Tech_Mono'] text-[#ffffff55] hover:text-white"
        >
          CLOSE
        </button>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        <AnimatePresence mode="popLayout">
          {notifications.length === 0 ? (
            <div className="text-[9px] text-[#ffffff22] font-['Share_Tech_Mono'] px-1 italic">
              No events detected
            </div>
          ) : notifications.map(n => (
            <NotifItem key={n.id} notif={n} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
