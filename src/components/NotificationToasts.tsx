// ============================================================
// CHRONODOX — Notification Toasts
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';

const TOAST_COLORS: Record<string, string> = {
  TRAVERSAL_DETECTED: '#b87fff',
  STRIKE_OCCURRED: '#ff4466',
  PARADOX_OCCURRED: '#ff6b00',
  AGENT_ELIMINATED: '#ff2244',
  CAUSAL_COLLAPSE: '#ff0000',
  CITY_CONTROLLED: '#00c8a0',
  REWARD_COLLECTED: '#ffd700',
};

const TOAST_LIMIT = 4;
const TOAST_LIFETIME_MS = 3600;

export function NotificationToasts() {
  const { game, localPlayer } = useGameStore();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const timerIdsRef = useRef<Map<string, number>>(new Map());

  const notifications = useMemo(
    () => game.notifications.filter(n => n.forPlayer === 'BOTH' || n.forPlayer === localPlayer),
    [game.notifications, localPlayer]
  );

  useEffect(() => {
    for (const notification of notifications) {
      if (timerIdsRef.current.has(notification.id)) continue;

      const timeoutId = window.setTimeout(() => {
        setHiddenIds(current => {
          const next = new Set(current);
          next.add(notification.id);
          return next;
        });
        timerIdsRef.current.delete(notification.id);
      }, TOAST_LIFETIME_MS);

      timerIdsRef.current.set(notification.id, timeoutId);
    }
  }, [notifications]);

  useEffect(() => () => {
    for (const timeoutId of timerIdsRef.current.values()) {
      window.clearTimeout(timeoutId);
    }
    timerIdsRef.current.clear();
  }, []);

  const visibleToasts = notifications
    .filter(notification => !hiddenIds.has(notification.id))
    .slice(-TOAST_LIMIT)
    .reverse();

  return (
    <div className="pointer-events-none fixed top-[58px] left-1/2 z-40 flex w-full max-w-xl -translate-x-1/2 flex-col gap-2 px-4">
      <AnimatePresence initial={false}>
        {visibleToasts.map(notification => {
          const color = TOAST_COLORS[notification.type] ?? '#ffffff88';
          return (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -18, scale: 0.98 }}
              transition={{ duration: 0.22 }}
              className="rounded border px-3 py-2 text-[10px] font-['Share_Tech_Mono'] shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
              style={{
                borderColor: color + '88',
                backgroundColor: '#071018ee',
                color,
              }}
            >
              <span className="mr-2 opacity-60">R{notification.round}</span>
              {notification.message}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
