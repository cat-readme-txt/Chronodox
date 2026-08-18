import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { GUIDED_TUTORIAL_STEPS } from '../tutorial/guidedTutorial';

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function TutorialOverlay() {
  const {
    tutorialOpen,
    tutorialSectionIndex,
    closeTutorial,
    tutorialFocusIds,
    tutorialMarkedCityIds,
    game,
    selectedAgentId,
    continueTutorialStep,
    pendingTraversalAction,
    lastActionFeedback,
    tutorialTraversalLockedPeriod,
    playSoundEffect,
  } = useGameStore();
  const [highlightRect, setHighlightRect] = useState<HighlightRect | null>(null);

  const tutorialComplete = tutorialSectionIndex >= GUIDED_TUTORIAL_STEPS.length;
  const step = useMemo(
    () => (!tutorialComplete ? GUIDED_TUTORIAL_STEPS[tutorialSectionIndex] : null),
    [tutorialComplete, tutorialSectionIndex],
  );
  const panelAtTop = Boolean(
    highlightRect
    && !tutorialComplete
    && (highlightRect.top + highlightRect.height > window.innerHeight * 0.55),
  );
  const selectedAgent = selectedAgentId
    ? game.players.P1.agents.find(agent => agent.id === selectedAgentId) ?? null
    : null;
  const canContinueInfoStep = Boolean(step && step.expectedEvent === 'continue-info');

  const resolvedTargetIds = useMemo(() => {
    if (!step) return null;
    if (tutorialFocusIds && tutorialFocusIds.length > 0) return tutorialFocusIds;
    if (
      pendingTraversalAction
      && tutorialTraversalLockedPeriod
      && step.expectedEvent === 'paradox-traverse'
    ) {
      return [`traversal-option-${tutorialTraversalLockedPeriod.toLowerCase()}`];
    }
    if (
      pendingTraversalAction
      && (step.expectedEvent === 'action:TRAVERSE' || step.expectedEvent === 'paradox-traverse')
    ) {
      return ['traversal-picker'];
    }
    return [step.targetId];
  }, [pendingTraversalAction, step, tutorialFocusIds, tutorialTraversalLockedPeriod]);

  useEffect(() => {
    if (!tutorialOpen || tutorialComplete || !step || !resolvedTargetIds || resolvedTargetIds.length === 0) {
      setHighlightRect(null);
      return;
    }

    const updateRect = () => {
      const elements = resolvedTargetIds
        .map(id => document.getElementById(id))
        .filter((element): element is HTMLElement => Boolean(element));
      if (elements.length === 0) {
        setHighlightRect(null);
        return;
      }
      const rects = elements.map(element => element.getBoundingClientRect());
      const leftEdge = Math.min(...rects.map(rect => rect.left));
      const topEdge = Math.min(...rects.map(rect => rect.top));
      const rightEdge = Math.max(...rects.map(rect => rect.right));
      const bottomEdge = Math.max(...rects.map(rect => rect.bottom));
      const padding = 10;
      const maxWidth = window.innerWidth;
      const maxHeight = window.innerHeight;
      const left = Math.max(8, leftEdge - padding);
      const top = Math.max(8, topEdge - padding);
      const right = Math.min(maxWidth - 8, rightEdge + padding);
      const bottom = Math.min(maxHeight - 8, bottomEdge + padding);
      setHighlightRect({
        left,
        top,
        width: Math.max(24, right - left),
        height: Math.max(24, bottom - top),
      });
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    const resizeObserver = new ResizeObserver(updateRect);
    resolvedTargetIds
      .map(id => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element))
      .forEach(element => resizeObserver.observe(element));
    const rafId = window.requestAnimationFrame(updateRect);
    const intervalId = window.setInterval(updateRect, 80);
    const timeoutIds = [
      window.setTimeout(updateRect, 60),
      window.setTimeout(updateRect, 240),
      window.setTimeout(updateRect, 520),
      window.setTimeout(updateRect, 760),
      window.setTimeout(updateRect, 980),
    ];
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(rafId);
      window.clearInterval(intervalId);
      timeoutIds.forEach(timeoutId => window.clearTimeout(timeoutId));
    };
  }, [tutorialOpen, tutorialComplete, step, resolvedTargetIds, pendingTraversalAction, lastActionFeedback]);

  return (
    <AnimatePresence>
      {tutorialOpen && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-[85]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {!tutorialComplete && !highlightRect ? (
            <div className="absolute inset-0 bg-[#01040ab3]" />
          ) : null}

          {highlightRect && !tutorialComplete && (
            <motion.div
              className="absolute rounded-2xl border-2 border-[#8fdfff] shadow-[0_0_28px_rgba(143,223,255,0.32)]"
              initial={false}
              animate={{
                left: highlightRect.left,
                top: highlightRect.top,
                width: highlightRect.width,
                height: highlightRect.height,
              }}
              style={{ boxShadow: '0 0 0 9999px rgba(1,4,10,0.70), 0 0 28px rgba(143,223,255,0.32)' }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            />
          )}

          {tutorialComplete ? (
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="pointer-events-auto max-w-2xl rounded-[28px] border border-[#00d4ff33] bg-[linear-gradient(180deg,#071019,#04060d)] p-8 text-center shadow-[0_24px_100px_rgba(0,0,0,0.45)]"
              >
                <div className="font-['Orbitron'] text-2xl tracking-[0.22em] text-[#dff7ff]">TUTORIAL COMPLETE</div>
                <div className="mt-4 font-['Share_Tech_Mono'] text-[13px] leading-7 text-[#d9e7ffbb]">
                  You have walked through the live interaction flow for movement, control, intel, traversal, strikes, settings, terminal mode, and training inspection.
                  You can reopen the tutorial later, or continue into normal play and use the feed, terminal, and settings as reference.
                </div>
                <button
                  type="button"
                  onClick={closeTutorial}
                  className="mt-6 rounded border border-[#00d4ff55] bg-[#00d4ff14] px-5 py-3 font-['Share_Tech_Mono'] text-[11px] tracking-[0.22em] text-[#dff7ff] pointer-events-auto"
                >
                  CLOSE TUTORIAL
                </button>
              </motion.div>
            </div>
          ) : (
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className={[
                'pointer-events-none absolute inset-x-0 flex justify-center px-6',
                panelAtTop ? 'top-0 pt-6' : 'bottom-0 pb-6',
              ].join(' ')}
            >
              <div className="pointer-events-auto w-full max-w-4xl rounded-[26px] border border-[#ffffff1c] bg-[linear-gradient(180deg,#071019,#04060d)] px-6 py-5 shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-['Orbitron'] text-[11px] tracking-[0.26em] text-[#8df5df]">
                      STEP {tutorialSectionIndex + 1} / {GUIDED_TUTORIAL_STEPS.length}
                    </div>
                    <div className="mt-2 font-['Orbitron'] text-xl tracking-[0.08em] text-white">
                      {step?.title}
                    </div>
                    <div className="mt-3 rounded-2xl border border-[#8fdfff2a] bg-[#09131cc2] px-4 py-4 font-['Share_Tech_Mono'] text-[13px] leading-7 text-[#d9e7ffcc]">
                      {step?.subtitle}
                    </div>
                    <div className="mt-3 font-['Share_Tech_Mono'] text-[11px] text-[#ffffff55]">
                      {canContinueInfoStep
                        ? 'Read the briefing, then proceed when you are ready.'
                        : 'Carry out the highlighted move to advance the operation.'}
                    </div>
                    {canContinueInfoStep && (
                      <button
                        type="button"
                        onClick={() => {
                          playSoundEffect('ui_click');
                          continueTutorialStep();
                        }}
                        className="mt-4 rounded border border-[#8fdfff55] bg-[#00d4ff14] px-4 py-2 font-['Share_Tech_Mono'] text-[11px] tracking-[0.18em] text-[#dff7ff]"
                      >
                        PROCEED
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={closeTutorial}
                    className="rounded border border-[#ffffff22] px-3 py-2 font-['Share_Tech_Mono'] text-[11px] text-[#ffffff88]"
                  >
                    EXIT
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
