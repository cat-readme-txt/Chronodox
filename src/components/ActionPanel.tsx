import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useGameStore } from '../store/gameStore';
import type { ActionType, City, TimePeriod } from '../types/game';
import { CONTROLLED_CITY_INTEL, INTEL_COSTS, TIMELINE_OCCUPATION_ACTION_BONUS, TIMELINE_OCCUPATION_INTEL_BONUS } from '../types/game';
import { getNodeCitiesForPeriod } from '../engine/mapGenerator';

type HoverInfo = {
  title: string;
  accent: string;
  rect: DOMRect;
  lines: string[];
};

const PERIOD_ACCENT: Record<TimePeriod, string> = {
  PAST: '#7b4fd4',
  PRESENT: '#00c8a0',
  FUTURE: '#ff6b35',
};

const MAIN_ACTIONS: ActionType[] = ['WAIT', 'CONTROL', 'STRIKE', 'TRAVERSE', 'LOCATE'];
const SHOP_ACTIONS: ActionType[] = [
  'DEEP_COVER',
  'STRIKE_REPORT',
  'RAPID_RECON',
  'PREPARE_ACTION',
  'ENCRYPTION',
  'MULTI_TIMELINE_STRIKE',
];

const ACTION_META: Record<ActionType, { label: string; accent: string; cost?: number; summary: string }> = {
  MOVE: { label: 'MOVE', accent: '#00c8a0', summary: 'Move to a connected city from the map.' },
  WAIT: { label: 'WAIT', accent: '#7b4fd4', summary: 'Hold position and try to restore cover.' },
  CONTROL: { label: 'CONTROL', accent: '#ff9a66', summary: 'Capture the current city and reveal yourself.' },
  STRIKE: { label: 'STRIKE', accent: '#ff4466', summary: 'Attack the current city. With upgrade, strike all linked overlaps.' },
  TRAVERSE: { label: 'TRAVERSE', accent: '#b87fff', cost: INTEL_COSTS.TRAVERSE, summary: 'Travel through a shared node into another timeline.' },
  LOCATE: { label: 'LOCATE', accent: '#00d4ff', cost: INTEL_COSTS.LOCATE, summary: 'Reveal enemy operatives in the selected timeline.' },
  DEEP_COVER: { label: 'DEEP COVER', accent: '#7b4fd4', cost: INTEL_COSTS.DEEP_COVER, summary: 'Block reveals on this operative until the turn ends.' },
  STRIKE_REPORT: { label: 'STRIKE REPORT', accent: '#00d4ff', cost: INTEL_COSTS.STRIKE_REPORT, summary: 'Expose enemy strikers for the rest of the round.' },
  PREPARE_ACTION: { label: 'PREPARE ACTION', accent: '#ffd700', cost: INTEL_COSTS.PREPARE_ACTION, summary: 'Bank +1 action for next round.' },
  ENCRYPTION: { label: 'ENCRYPTION', accent: '#c8d6e5', cost: INTEL_COSTS.ENCRYPTION, summary: 'Hide future intel-purchase names from the enemy feed.' },
  RAPID_RECON: { label: 'RAPID RECON', accent: '#00d4ff', cost: INTEL_COSTS.RAPID_RECON, summary: 'Instantly collapse uncertainty on enemy contact this round.' },
  MULTI_TIMELINE_STRIKE: { label: 'MULTI-STRIKE UPGRADE', accent: '#ffcf6b', cost: INTEL_COSTS.MULTI_TIMELINE_STRIKE, summary: 'Permanently upgrade every strike into a cross-timeline strike.' },
};

function describeAction(
  type: ActionType,
  context: {
    currentPeriod: TimePeriod;
    intel: number;
    ownedUpgrade: boolean;
  },
) {
  switch (type) {
    case 'WAIT':
      return {
        title: 'WAIT',
        lines: [
          'Effect: stay in place and attempt to hide again.',
          'Counters: direct pursuit and uncontrolled overextension.',
          'Countered by: LOCATE, enemy-controlled cities, strike report, and occupied-timeline exposure.',
          'Data: costs 0 intel and 1 action.',
        ],
      };
    case 'CONTROL':
      return {
        title: 'CONTROL',
        lines: [
          `Effect: claim this city and generate +${CONTROLLED_CITY_INTEL} intel each intel phase while it stays yours.`,
          'Counters: neutral cities, enemy staging routes, and timeline occupation pressure.',
          'Countered by: enemy CONTROL on the same city or direct elimination.',
          'Data: costs 0 intel and reveals the operative.',
        ],
      };
    case 'STRIKE':
      return {
        title: 'STRIKE',
        lines: [
          context.ownedUpgrade
            ? 'Effect: attack the current city and every overlapped node city tied to it.'
            : 'Effect: attack the current city only.',
          'Counters: exposed enemies holding your lane or shared-node stackups.',
          'Countered by: DEEP COVER before detection, movement, and STRIKE REPORT exposing the attacker.',
          `Data: costs 0 intel. Multi-strike upgrade is ${context.ownedUpgrade ? 'active' : 'inactive'}.`,
        ],
      };
    case 'TRAVERSE':
      return {
        title: 'TRAVERSE',
        lines: [
          'Effect: move through a shared node into another timeline.',
          'Counters: local encirclement and timeline isolation.',
          'Countered by: node denial, paradox risk, and occupied-timeline exposure on arrival.',
          `Data: costs ${INTEL_COSTS.TRAVERSE} intel from ${context.currentPeriod}.`,
        ],
      };
    case 'LOCATE':
      return {
        title: 'LOCATE',
        lines: [
          'Effect: reveal enemy operatives in this timeline unless DEEP COVER blocks it.',
          'Counters: hidden stacks and bluff movement.',
          'Countered by: DEEP COVER and rapid relocation after detection.',
          `Data: costs ${INTEL_COSTS.LOCATE} intel from ${context.currentPeriod}.`,
        ],
      };
    case 'DEEP_COVER':
      return {
        title: 'DEEP COVER',
        lines: [
          'Effect: harden one operative against reveal effects for the rest of the turn.',
          'Counters: LOCATE, occupied-timeline forced exposure, and enemy-controlled city reveals.',
          'Countered by: waiting it out, direct strikes, and contact after the effect expires.',
          `Data: costs ${INTEL_COSTS.DEEP_COVER} intel. Applies to the selected agent only.`,
        ],
      };
    case 'STRIKE_REPORT':
      return {
        title: 'STRIKE REPORT',
        lines: [
          'Effect: any enemy strike this round exposes the striker.',
          'Counters: hit-and-hide play.',
          'Countered by: ENCRYPTION hiding the purchase name and non-strike pressure.',
          `Data: costs ${INTEL_COSTS.STRIKE_REPORT} intel and lasts until round end.`,
        ],
      };
    case 'PREPARE_ACTION':
      return {
        title: 'PREPARE ACTION',
        lines: [
          'Effect: gain +1 action next round.',
          'Counters: tempo deficits and long setup turns.',
          'Countered by: immediate enemy aggression before the next round opens.',
          `Data: costs ${INTEL_COSTS.PREPARE_ACTION} intel and is player-wide.`,
        ],
      };
    case 'ENCRYPTION':
      return {
        title: 'ENCRYPTION',
        lines: [
          'Effect: hides the exact names of your future shop/intel purchases from the enemy feed.',
          'Counters: information leaks from the announcement log.',
          'Countered by: inference from board state and revealed movement anyway.',
          `Data: costs ${INTEL_COSTS.ENCRYPTION} intel and lasts until round end.`,
        ],
      };
    case 'RAPID_RECON':
      return {
        title: 'RAPID RECON',
        lines: [
          'Effect: landing on enemy contact immediately collapses uncertainty on that contact.',
          'Counters: hidden contact at nodes and fast enemy screen plays.',
          'Countered by: DEEP COVER and avoiding contact lanes.',
          `Data: costs ${INTEL_COSTS.RAPID_RECON} intel and lasts until round end.`,
        ],
      };
    case 'MULTI_TIMELINE_STRIKE':
      return {
        title: 'MULTI-STRIKE UPGRADE',
        lines: [
          'Effect: permanently upgrades every future STRIKE into a cross-timeline strike.',
          'Counters: overlapped enemy node formations and split-timeline defenses.',
          'Countered by: avoiding overlapped node cities, DEEP COVER, and eliminating the upgraded agents first.',
          `Data: costs ${INTEL_COSTS.MULTI_TIMELINE_STRIKE} intel. Status: ${context.ownedUpgrade ? 'already owned' : 'available'}.`,
        ],
      };
    default:
      return { title: ACTION_META[type].label, lines: [ACTION_META[type].summary] };
  }
}

function describeMapLocation(location: City) {
  if (location.isNode && location.nodeId) {
    return {
      title: `${location.name} · SHARED NODE`,
      lines: [
        'Shared node. Agents standing here can TRAVERSE into the same node in other timelines.',
        'Use: staging for cross-timeline repositioning, interception, and overlap pressure.',
        `Data: linked node ${location.nodeId}. Control still grants +${CONTROLLED_CITY_INTEL} intel if held.`,
      ],
    };
  }

  return {
    title: `${location.name} · CITY`,
    lines: [
      `Standard city. CONTROL it to generate +${CONTROLLED_CITY_INTEL} intel each intel phase while you hold it.`,
      'Use: lane control, intel income, strike staging, and route denial.',
      `Data: current control ${location.controlledBy ?? 'neutral'}.`,
    ],
  };
}

export function ActionPanel() {
  const {
    game,
    localPlayer,
    selectedAgentId,
    inspectedCityId,
    executeActionNow,
    advanceByNextCommand,
    undoLastTurnAction,
    lastActionFeedback,
    pendingTraversalAction,
    openTraversalPicker,
    closeTraversalPicker,
    confirmTraversalTarget,
    aiTurnInProgress,
    awaitingNextRound,
    localTurnHandoffPlayer,
    playSoundEffect,
    tutorialTraversalLockedPeriod,
    turnUndoStack,
    gameMode,
  } = useGameStore();
  const [shopOpen, setShopOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [passConfirmOpen, setPassConfirmOpen] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectionCardRef = useRef<HTMLDivElement>(null);
  const [panelRect, setPanelRect] = useState<DOMRect | null>(null);
  const [selectionCardRect, setSelectionCardRect] = useState<DOMRect | null>(null);

  const player = game.players[localPlayer];
  const selectedAgent = selectedAgentId
    ? [...game.players.P1.agents, ...game.players.P2.agents].find(agent => agent.id === selectedAgentId)
    : null;
  const agentPeriod = selectedAgent?.currentPeriod ?? 'PAST';
  const agentIntel = player.intel[agentPeriod];
  const actionsLeft = selectedAgent?.actionsRemaining ?? 0;
  const selectedCity = selectedAgent ? game.map.cities.get(selectedAgent.cityId) : null;
  const inspectedCity = inspectedCityId ? game.map.cities.get(inspectedCityId) ?? null : null;

  useEffect(() => {
    if (!shopOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShopOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shopOpen]);

  useEffect(() => {
    if (!rosterOpen) return undefined;
    const updateRect = () => {
      if (!panelRef.current) return;
      setPanelRect(panelRef.current.getBoundingClientRect());
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRosterOpen(false);
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [rosterOpen]);

  useEffect(() => {
    if (!passConfirmOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPassConfirmOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [passConfirmOpen]);

  useEffect(() => {
    if (!inspectedCity) {
      setSelectionCardRect(null);
      return undefined;
    }
    const updateRect = () => {
      if (!selectionCardRef.current) return;
      setSelectionCardRect(selectionCardRef.current.getBoundingClientRect());
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [inspectedCity]);

  const traversalDestinations = selectedAgent && selectedCity?.nodeId
    ? (['PAST', 'PRESENT', 'FUTURE'] as TimePeriod[]).map(period => {
        const city = period === selectedAgent.currentPeriod
          ? null
          : getNodeCitiesForPeriod(game.map, selectedCity.nodeId!, period);
        return {
          period,
          city,
          enabled: period !== selectedAgent.currentPeriod && Boolean(city && !city.destroyed),
        };
      })
    : [];

  const hasTraversalDestination = traversalDestinations.some(option => option.enabled);
  const canPass = !aiTurnInProgress
    && !(gameMode === 'online_2p' && game.currentTurn !== localPlayer)
    && !(gameMode === 'local_2p' && localTurnHandoffPlayer)
    && (awaitingNextRound || player.agents.some(agent => agent.actionsRemaining > 0));
  const canUndo = !aiTurnInProgress
    && !(gameMode === 'online_2p' && game.currentTurn !== localPlayer)
    && !(gameMode === 'local_2p' && localTurnHandoffPlayer)
    && turnUndoStack.length > 0;

  useEffect(() => {
    if (!canPass && passConfirmOpen) {
      setPassConfirmOpen(false);
    }
  }, [canPass, passConfirmOpen]);

  const canExecute = (type: ActionType) => {
    if (!selectedAgent || !selectedAgentId) return false;
    if (aiTurnInProgress) return false;
    if (selectedAgent.owner !== localPlayer) return false;
    if (selectedAgent.actionsRemaining <= 0) return false;
    const cost = INTEL_COSTS[type as keyof typeof INTEL_COSTS] ?? 0;
    if (agentIntel < cost) return false;
    if (type === 'TRAVERSE') {
      if (!selectedCity?.isNode || !selectedCity.nodeId) return false;
      if (!hasTraversalDestination) return false;
    }
    if (type === 'MULTI_TIMELINE_STRIKE' && player.multiTimelineStrikeActive) return false;
    return true;
  };

  const handleHover = (event: MouseEvent<HTMLElement>, title: string, accent: string, lines: string[]) => {
    setHoverInfo({
      title,
      accent,
      rect: event.currentTarget.getBoundingClientRect(),
      lines,
    });
  };

  const handleAction = (type: ActionType) => {
    if (!selectedAgentId || !selectedAgent) return;
    playSoundEffect('ui_click');
    if (type === 'TRAVERSE') {
      openTraversalPicker('TRAVERSE');
      return;
    }
    if (SHOP_ACTIONS.includes(type)) {
      setShopOpen(false);
    }
    setRosterOpen(false);
    executeActionNow({ type, agentId: selectedAgentId, owner: localPlayer });
  };

  const handlePass = () => {
    if (!canPass) return;
    playSoundEffect('ui_click');
    setShopOpen(false);
    setRosterOpen(false);
    setPassConfirmOpen(true);
  };

  const handleUndo = () => {
    if (!canUndo) return;
    playSoundEffect('ui_click');
    setShopOpen(false);
    setRosterOpen(false);
    setPassConfirmOpen(false);
    undoLastTurnAction();
  };

  const hoverContext = {
    currentPeriod: agentPeriod,
    intel: agentIntel,
    ownedUpgrade: player.multiTimelineStrikeActive,
  };

  const renderActionButton = (type: ActionType, scope: 'main' | 'shop') => {
    const meta = ACTION_META[type];
    const enabled = canExecute(type);
    const detail = describeAction(type, hoverContext);

    return (
      <motion.button
        key={type}
        type="button"
        whileTap={enabled ? { scale: 0.97 } : {}}
        disabled={!enabled}
        id={`${scope === 'shop' ? 'shop-action' : 'action'}-${type.toLowerCase().replace(/_/g, '-')}`}
        onClick={() => handleAction(type)}
        onMouseEnter={(event) => handleHover(event, detail.title, meta.accent, detail.lines)}
        onMouseLeave={() => setHoverInfo(current => current?.title === detail.title ? null : current)}
        className="rounded-[16px] border px-3 py-3 text-left transition-all"
        style={{
          borderColor: enabled ? `${meta.accent}66` : '#ffffff14',
          background: enabled
            ? `linear-gradient(160deg, ${meta.accent}18, rgba(6, 12, 20, 0.82))`
            : 'rgba(5, 9, 14, 0.72)',
          color: enabled ? meta.accent : '#ffffff3a',
          boxShadow: enabled ? `0 0 18px ${meta.accent}18` : 'none',
          cursor: enabled ? 'pointer' : 'not-allowed',
        }}
      >
        <div className="font-['Orbitron'] text-[10px] tracking-[0.16em]">{meta.label}</div>
        <div className="mt-1 font-['Share_Tech_Mono'] text-[9px] text-[#ffffff9a]">{meta.summary}</div>
        <div className="mt-2 flex items-center justify-between font-['Share_Tech_Mono'] text-[8px] uppercase tracking-[0.12em]">
          <span>{scope === 'shop' ? 'Shop Ability' : 'Immediate Action'}</span>
          <span>{meta.cost ? `${meta.cost} intel` : '0 intel'}</span>
        </div>
      </motion.button>
    );
  };

  const renderPassActionButton = () => (
    <motion.button
      key="PASS"
      type="button"
      whileTap={canPass ? { scale: 0.97 } : {}}
      disabled={!canPass}
      id="action-pass"
      onClick={handlePass}
      onMouseEnter={(event) => handleHover(
        event,
        'PASS',
        '#ff9a66',
        [
          'Effect: confirms ending this command window by spending all remaining actions as WAIT.',
          'Counters: wasted leftover actions and slow manual cleanup when you are ready to hand over the turn.',
          'Countered by: your own confirmation step only. Once committed, the waits are locked in.',
          `Data: costs 0 intel and consumes every remaining action for ${localPlayer}.`,
        ],
      )}
      onMouseLeave={() => setHoverInfo(current => current?.title === 'PASS' ? null : current)}
      className="rounded-[16px] border px-3 py-3 text-left transition-all"
      style={{
        borderColor: canPass ? '#ff9a6666' : '#ffffff14',
        background: canPass
          ? 'linear-gradient(160deg, rgba(255,154,102,0.18), rgba(6, 12, 20, 0.82))'
          : 'rgba(5, 9, 14, 0.72)',
        color: canPass ? '#ffb27c' : '#ffffff3a',
        boxShadow: canPass ? '0 0 18px rgba(255,154,102,0.16)' : 'none',
        cursor: canPass ? 'pointer' : 'not-allowed',
      }}
    >
      <div className="font-['Orbitron'] text-[10px] tracking-[0.16em]">PASS</div>
      <div className="mt-1 font-['Share_Tech_Mono'] text-[9px] text-[#ffffff9a]">
        End the window by converting the remaining actions into WAIT.
      </div>
      <div className="mt-2 flex items-center justify-between font-['Share_Tech_Mono'] text-[8px] uppercase tracking-[0.12em]">
        <span>Immediate Action</span>
        <span>0 intel</span>
      </div>
    </motion.button>
  );

  const inspectedOverlayInfo = inspectedCity && selectionCardRect
    ? {
        title: describeMapLocation(inspectedCity).title,
        accent: PERIOD_ACCENT[inspectedCity.period],
        rect: selectionCardRect,
        lines: describeMapLocation(inspectedCity).lines,
      }
    : null;
  const activeOverlayInfo = hoverInfo ?? inspectedOverlayInfo;

  return (
    <>
      <div ref={panelRef} className="flex h-full min-h-0 flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {(['PAST', 'PRESENT', 'FUTURE'] as TimePeriod[]).map(period => (
            <button
              key={period}
              type="button"
              onMouseEnter={(event) => handleHover(
                event,
                `${period} INTEL`,
                PERIOD_ACCENT[period],
                [
                  `Pool: ${player.intel[period]} intel currently banked in ${period}.`,
                  `Income: +2 base when you keep any agent there, plus +${CONTROLLED_CITY_INTEL} per controlled city.`,
                  `Bonus: uncontested occupation can add +${TIMELINE_OCCUPATION_INTEL_BONUS} more after the opposing turn.`,
                ],
              )}
              onMouseLeave={() => setHoverInfo(current => current?.title === `${period} INTEL` ? null : current)}
              className="rounded-[16px] border border-[#ffffff18] bg-[#07101acc] px-3 py-3 text-left"
            >
              <div className="font-['Share_Tech_Mono'] text-[9px]" style={{ color: PERIOD_ACCENT[period] }}>{period}</div>
              <div className="mt-1 font-['Orbitron'] text-xl" style={{ color: PERIOD_ACCENT[period] }}>{player.intel[period]}</div>
            </button>
          ))}
          <button
            type="button"
            onMouseEnter={(event) => handleHover(
              event,
              'TURN STATUS',
              localPlayer === 'P1' ? '#00d4ff' : '#ff4466',
              [
                `Round ${game.round}. ${gameMode === 'online_2p' ? (game.currentTurn === localPlayer ? 'Your command window is active.' : 'Remote command window is active.') : `${localPlayer} currently has command.`}`,
                `Actions left on selected agent: ${actionsLeft}.`,
                `Occupation bonus: +${TIMELINE_OCCUPATION_ACTION_BONUS} action to agents in a fully held timeline after the opposing turn.`,
              ],
            )}
            onMouseLeave={() => setHoverInfo(current => current?.title === 'TURN STATUS' ? null : current)}
            className="rounded-[16px] border border-[#ffffff18] bg-[#07101acc] px-3 py-3 text-left"
          >
            <div className="font-['Share_Tech_Mono'] text-[9px] text-[#ffffff88]">ROUND {game.round}</div>
            <div className="mt-1 font-['Orbitron'] text-[11px] tracking-[0.14em]" style={{ color: localPlayer === 'P1' ? '#00d4ff' : '#ff4466' }}>
              {gameMode === 'online_2p'
                ? game.currentTurn === localPlayer ? 'YOUR WINDOW' : 'REMOTE WINDOW'
                : `${localPlayer} TURN`}
            </div>
          </button>
        </div>

        <div
          ref={selectionCardRef}
          onMouseEnter={(event) => handleHover(
            event,
            selectedAgent ? 'SELECTED OPERATIVE' : inspectedCity ? 'MAP LOCATION' : 'SELECTED OPERATIVE',
            inspectedCity ? PERIOD_ACCENT[inspectedCity.period] : PERIOD_ACCENT[agentPeriod],
            selectedAgent
              ? [
                  `Agent: ${selectedAgent.period} origin operating in ${selectedAgent.currentPeriod}.`,
                  `Actions: ${actionsLeft} remaining. Occupation can add +${TIMELINE_OCCUPATION_ACTION_BONUS} if this timeline stays fully held.`,
                  `Cover: ${selectedAgent.cover ? 'hidden' : 'revealed'}. Deep cover blocks most reveal tools for this turn.`,
                ]
              : inspectedCity
                ? describeMapLocation(inspectedCity).lines
                : ['Select an operative to see actions, travel options, and shop purchases.'],
          )}
          onMouseLeave={() => setHoverInfo(current => ['SELECTED OPERATIVE', 'MAP LOCATION'].includes(current?.title ?? '') ? null : current)}
          className="rounded-[18px] border border-[#ffffff18] bg-[#07101acc] p-3 font-['Share_Tech_Mono']"
        >
          {selectedAgent ? (
            <>
              <div className="text-[10px] text-[#ffffff55]">SELECTED OPERATIVE</div>
              <div className="mt-1 flex items-center justify-between">
                <div className="text-[11px]" style={{ color: PERIOD_ACCENT[selectedAgent.currentPeriod] }}>
                  {selectedAgent.isPastAgent ? 'PAST PRIME' : 'FIELD AGENT'} · {selectedAgent.period} {'->'} {selectedAgent.currentPeriod}
                </div>
                <div className="rounded-full border border-[#ffffff18] px-2 py-1 text-[9px] text-[#ffffffaa]">
                  {actionsLeft} ACT
                </div>
              </div>
              <div className="mt-2 text-[9px] text-[#ffffff77]">
                {selectedCity?.name ?? 'Unknown city'} · {selectedAgent.cover ? 'cover intact' : 'cover exposed'}
              </div>
            </>
          ) : inspectedCity ? (
            <>
              <div className="text-[10px] text-[#ffffff55]">{inspectedCity.isNode ? 'SELECTED NODE' : 'SELECTED CITY'}</div>
              <div className="mt-1 flex items-center justify-between">
                <div className="text-[11px]" style={{ color: PERIOD_ACCENT[inspectedCity.period] }}>
                  {inspectedCity.name}
                </div>
                <div className="rounded-full border border-[#ffffff18] px-2 py-1 text-[9px] text-[#ffffffaa]">
                  {inspectedCity.period}
                </div>
              </div>
              <div className="mt-2 text-[9px] text-[#ffffff77]">
                Description open in side overlay.
              </div>
            </>
          ) : (
            <div className="text-[10px] text-[#ffffff55]">Select an operative on the map to issue commands.</div>
          )}
        </div>

        <AnimatePresence>
          {lastActionFeedback && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="rounded-[14px] border border-[#ff9a6644] bg-[#ff9a6610] px-3 py-2 font-['Share_Tech_Mono'] text-[9px] text-[#ffb27c]"
            >
              {lastActionFeedback}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pendingTraversalAction && selectedAgent && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              id="traversal-picker"
              className="rounded-[18px] border border-[#b87fff44] bg-[#0d0818] p-3"
            >
              <div className="flex items-center justify-between">
                <div className="font-['Orbitron'] text-[10px] tracking-[0.16em] text-[#d7c1ff]">TRAVERSE DESTINATION</div>
                <button type="button" onClick={closeTraversalPicker} className="font-['Share_Tech_Mono'] text-[9px] text-[#ffffff88]">
                  CLOSE
                </button>
              </div>
              <div className="mt-2 font-['Share_Tech_Mono'] text-[9px] text-[#ffffff7a]">
                Shared nodes open real timeline travel only. Deep cover before entry blocks occupied-timeline forced exposure.
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {traversalDestinations.map(option => (
                  <button
                    key={option.period}
                    id={`traversal-option-${option.period.toLowerCase()}`}
                    type="button"
                    disabled={!option.enabled}
                    onClick={() => {
                      if (!option.enabled) return;
                      playSoundEffect('ui_click');
                      confirmTraversalTarget(option.period);
                    }}
                    className="rounded-[14px] border px-2 py-2 text-left"
                    style={{
                      borderColor: option.enabled ? `${PERIOD_ACCENT[option.period]}66` : '#ffffff14',
                      background: option.enabled ? `${PERIOD_ACCENT[option.period]}14` : 'transparent',
                      color: option.enabled ? PERIOD_ACCENT[option.period] : '#ffffff33',
                      opacity: tutorialTraversalLockedPeriod && option.period !== tutorialTraversalLockedPeriod ? 0.45 : 1,
                    }}
                  >
                    <div className="font-['Orbitron'] text-[10px]">{option.period}</div>
                    <div className="mt-1 font-['Share_Tech_Mono'] text-[8px] text-[#ffffff88]">
                      {option.city?.name ?? 'Unavailable'}
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="rounded-[18px] border border-[#ffffff18] bg-[#07101acc] p-3">
          <div className="flex items-center justify-between">
            <div className="font-['Orbitron'] text-[10px] tracking-[0.16em] text-[#ffffff7a]">FIELD ACTIONS</div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              id="action-undo"
              disabled={!canUndo}
              onClick={handleUndo}
              onMouseEnter={(event) => handleHover(
                event,
                'UNDO',
                '#8df5df',
                [
                  'Effect: reverts the most recent action or purchase made in this turn window.',
                  'Limit: only works before the turn is passed or ends. Earlier turns stay locked.',
                  `Data: ${turnUndoStack.length} undo ${turnUndoStack.length === 1 ? 'step' : 'steps'} currently available.`,
                ],
              )}
              onMouseLeave={() => setHoverInfo(current => current?.title === 'UNDO' ? null : current)}
              className="rounded-[14px] border px-3 py-2 font-['Orbitron'] text-[10px] tracking-[0.18em] transition-all"
              style={{
                borderColor: canUndo ? '#8df5df66' : '#ffffff14',
                background: canUndo ? 'linear-gradient(160deg, rgba(141,245,223,0.2), rgba(9,14,20,0.86))' : 'rgba(5, 9, 14, 0.72)',
                color: canUndo ? '#bffbf1' : '#ffffff3a',
                cursor: canUndo ? 'pointer' : 'not-allowed',
                boxShadow: canUndo ? '0 0 18px rgba(141,245,223,0.16)' : 'none',
              }}
            >
              UNDO
            </button>
            <button
              type="button"
              id="action-roster"
              onClick={() => {
                playSoundEffect('ui_click');
                setRosterOpen(true);
                if (panelRef.current) setPanelRect(panelRef.current.getBoundingClientRect());
              }}
              onMouseEnter={(event) => handleHover(
                event,
                'ROSTER',
                '#8fdfff',
                [
                  'Effect: opens the full operative roster in a side drawer.',
                  'Shows: every agent, current city, period alignment, and remaining actions.',
                  'Use it when the compact control panel view would otherwise crowd agent management.',
                ],
              )}
              onMouseLeave={() => setHoverInfo(current => current?.title === 'ROSTER' ? null : current)}
              className="rounded-[14px] border border-[#8fdfff55] bg-[#8fdfff16] px-3 py-2 font-['Orbitron'] text-[10px] tracking-[0.18em] text-[#8fdfff]"
            >
              ROSTER
            </button>
            <button
              type="button"
              id="action-shop"
              onClick={() => {
                playSoundEffect('ui_click');
                setShopOpen(true);
              }}
              onMouseEnter={(event) => handleHover(
                event,
                'SHOP',
                '#ffcf6b',
                [
                  'Effect: opens the add-on ability market for long-tail tactical upgrades.',
                  'Contains: DEEP COVER, STRIKE REPORT, RAPID RECON, PREPARE ACTION, ENCRYPTION, and the multi-strike upgrade.',
                  'Counterplay: deny intel generation so the opponent cannot afford future upgrades.',
                ],
              )}
              onMouseLeave={() => setHoverInfo(current => current?.title === 'SHOP' ? null : current)}
              className="rounded-[14px] border border-[#ffcf6b66] bg-[#ffcf6b18] px-3 py-2 font-['Orbitron'] text-[10px] tracking-[0.18em] text-[#ffcf6b]"
            >
              SHOP
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {MAIN_ACTIONS.map(type => renderActionButton(type, 'main'))}
            {renderPassActionButton()}
          </div>
          <div className="mt-2 font-['Share_Tech_Mono'] text-[8px] text-[#ffffff55]">
            MOVE is map-driven: click a highlighted connected city.
          </div>
        </div>
      </div>

      <AnimatePresence>
        {rosterOpen && panelRect && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[90] bg-[rgba(0,0,0,0.16)]"
              onClick={() => setRosterOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, x: 22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 22 }}
              className="fixed z-[91] overflow-hidden rounded-[24px] border border-[#8fdfff44] bg-[#08111ae8] shadow-[0_24px_100px_rgba(0,0,0,0.42)]"
              style={{
                width: 320,
                top: Math.max(16, panelRect.top),
                height: Math.max(320, Math.min(window.innerHeight - Math.max(16, panelRect.top) - 16, panelRect.height)),
                left: Math.max(16, panelRect.left - 332),
              }}
            >
              <div className="flex h-full min-h-0 flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-['Orbitron'] text-sm tracking-[0.18em] text-[#8fdfff]">OPERATIVE ROSTER</div>
                    <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] leading-relaxed text-[#ffffff88]">
                      Full agent list for this player without compressing the action controls.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRosterOpen(false)}
                    className="rounded-[12px] border border-[#ffffff22] px-3 py-2 font-['Orbitron'] text-[10px] tracking-[0.16em] text-[#ffffffb8]"
                  >
                    CLOSE
                  </button>
                </div>
                <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {player.agents.map(agent => {
                    const city = game.map.cities.get(agent.cityId);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => {
                          useGameStore.getState().selectAgent(selectedAgentId === agent.id ? null : agent.id);
                          setRosterOpen(false);
                        }}
                        className="rounded-[16px] border px-3 py-3 text-left font-['Share_Tech_Mono'] text-[10px]"
                        style={{
                          borderColor: selectedAgentId === agent.id ? `${PERIOD_ACCENT[agent.currentPeriod]}88` : `${PERIOD_ACCENT[agent.currentPeriod]}22`,
                          background: selectedAgentId === agent.id ? `${PERIOD_ACCENT[agent.currentPeriod]}16` : 'rgba(5, 10, 16, 0.72)',
                          color: PERIOD_ACCENT[agent.currentPeriod],
                        }}
                      >
                        <div className="font-['Orbitron'] text-[10px] tracking-[0.14em]">
                          {agent.isPastAgent ? 'PAST PRIME' : 'FIELD AGENT'} · {agent.period} {'->'} {agent.currentPeriod}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10px] text-[#ffffffc4]">
                          <span>{city?.name ?? 'Unknown city'}</span>
                          <span>{agent.actionsRemaining} ACT</span>
                        </div>
                        <div className="mt-1 text-[9px] text-[#ffffff72]">
                          {agent.cover ? 'Cover intact' : 'Cover exposed'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {passConfirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[92] flex items-center justify-center bg-[rgba(0,0,0,0.54)] px-6 backdrop-blur-[4px]"
            onClick={() => setPassConfirmOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-md rounded-[24px] border border-[#ff9a6644] bg-[#08111ae8] p-5 shadow-[0_24px_100px_rgba(0,0,0,0.42)]"
            >
              <div className="font-['Orbitron'] text-sm tracking-[0.18em] text-[#ffb27c]">CONFIRM PASS</div>
              <div className="mt-3 font-['Share_Tech_Mono'] text-[11px] leading-relaxed text-[#ffffffb8]">
                Spend every remaining action for {localPlayer} as WAIT and advance the turn window?
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPassConfirmOpen(false)}
                  className="rounded-[12px] border border-[#ffffff22] px-3 py-2 font-['Orbitron'] text-[10px] tracking-[0.16em] text-[#ffffffb8]"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPassConfirmOpen(false);
                    advanceByNextCommand(false);
                  }}
                  className="rounded-[12px] border border-[#ff9a6666] bg-[#ff9a661a] px-3 py-2 font-['Orbitron'] text-[10px] tracking-[0.16em] text-[#ffb27c]"
                >
                  CONFIRM
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shopOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[92] flex items-center justify-center bg-[rgba(0,0,0,0.62)] px-6 backdrop-blur-[6px]"
            onClick={() => setShopOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-3xl rounded-[28px] border border-[#ffcf6b44] bg-[#08111ae8] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.42)]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-['Orbitron'] text-lg tracking-[0.18em] text-[#ffcf6b]">TACTICAL SHOP</div>
                  <div className="mt-2 font-['Share_Tech_Mono'] text-[11px] text-[#ffffff88]">
                    Add-on abilities reshape future turns. They do not move the agent immediately, but they change what happens next.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShopOpen(false)}
                  className="rounded-[14px] border border-[#ffffff22] px-3 py-2 font-['Orbitron'] text-[10px] tracking-[0.16em] text-[#ffffffb8]"
                >
                  CLOSE
                </button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {SHOP_ACTIONS.map(type => renderActionButton(type, 'shop'))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeOverlayInfo && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="pointer-events-none fixed z-[95] max-w-[320px] rounded-[18px] border border-[#ffffff22] bg-[rgba(0,0,0,0.92)] px-4 py-3 text-white shadow-[0_20px_60px_rgba(0,0,0,0.42)]"
            style={(() => {
              const panelWidth = 320;
              const gap = 14;
              const preferredLeft = activeOverlayInfo.rect.left - panelWidth - gap;
              const fallbackLeft = activeOverlayInfo.rect.right + gap;
              const left = preferredLeft >= 16
                ? preferredLeft
                : Math.min(fallbackLeft, window.innerWidth - panelWidth - 16);
              return {
                left,
                top: Math.max(16, Math.min(activeOverlayInfo.rect.top, window.innerHeight - 220)),
              };
            })()}
          >
            <div className="font-['Orbitron'] text-[11px] tracking-[0.16em]" style={{ color: activeOverlayInfo.accent }}>
              {activeOverlayInfo.title}
            </div>
            <div className="mt-2 flex flex-col gap-2 font-['Share_Tech_Mono'] text-[10px] leading-relaxed text-[#ffffffde]">
              {activeOverlayInfo.lines.map(line => <div key={line}>{line}</div>)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
