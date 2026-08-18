// ============================================================
// CHRONODOX — TimelineCanvas
// Canvas component for a single time period
// ============================================================

import { useRef, useEffect, useCallback } from 'react';
import type { TimePeriod, City } from '../types/game';
import { useGameStore } from '../store/gameStore';
import { getCitiesByPeriod, getRoutesByPeriod, getConnectedCities } from '../engine/mapGenerator';
import {
  drawBackground, drawRoutes, drawCities, drawAgents, drawPeriodHeader,
  toCanvasXY, drawBattleEffects,
} from './drawUtils';
import { getTimelineVisualState } from '../engine/timelineOccupation';

interface TimelineCanvasProps {
  period: TimePeriod;
  width: number;
  height: number;
}

export function TimelineCanvas({ period, width, height }: TimelineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastVisualSignatureRef = useRef<string | null>(null);
  const backgroundIntroStartedAtRef = useRef(Date.now());
  const {
    game, localPlayer, selectedAgentId, remoteSelectedAgentId, remoteSelectedPeriod, selectAgent, inspectCity, executeActionNow, tutorialMarkedCityIds, battleEffects,
  } = useGameStore();
  const showRemotePresence = game.currentTurn !== localPlayer;
  const timelineVisualState = getTimelineVisualState(game, period);
  const visualSignature = `${timelineVisualState.mode}:${timelineVisualState.owner ?? 'none'}:${timelineVisualState.foreignOwner ?? 'none'}:${timelineVisualState.bonusActive ? 'bonus' : 'plain'}`;
  const periodBattleEffects = battleEffects.filter(effect => effect.period === period);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const drawWidth = rect.width || width;
    const drawHeight = rect.height || height;
    const dpr = window.devicePixelRatio || 1;
    const now = Date.now();
    const targetWidth = Math.max(1, Math.round(drawWidth * dpr));
    const targetHeight = Math.max(1, Math.round(drawHeight * dpr));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { map, rewards, vision } = game;
    const cities = getCitiesByPeriod(map, period);
    const routes = getRoutesByPeriod(map, period);
    const nodeLinkCounts = new Map(
      [...map.nodes.entries()].map(([nodeId, cityIds]) => [nodeId, cityIds.length]),
    );
    const introAgeMs = now - backgroundIntroStartedAtRef.current;

    // Determine which agents are visible / revealed
    const myVision = vision[localPlayer];

    // Compute which cities are reachable from selected agent
    let highlightedCityIds: string[] = [];
    if (selectedAgentId) {
      const selectedAgent = game.players[localPlayer].agents.find(
        a => a.id === selectedAgentId && a.currentPeriod === period
      );
      if (selectedAgent) {
        highlightedCityIds = getConnectedCities(map, selectedAgent.cityId);
      }
    }

    // Draw
    drawBackground(ctx, period, drawWidth, drawHeight, timelineVisualState, introAgeMs);
    drawRoutes(ctx, routes, map.cities, {
      width: drawWidth, height: drawHeight, period, localPlayer, selectedAgentId,
      remoteSelectedAgentId: showRemotePresence ? remoteSelectedAgentId : null,
      remoteSelectedPeriod: showRemotePresence ? remoteSelectedPeriod : null,
      revealedAgentIds: myVision.revealedAgentIds, possiblePositions: myVision.possiblePositions, nodeLinkCounts,
    });
    drawCities(ctx, cities, {
      width: drawWidth, height: drawHeight, period, localPlayer, selectedAgentId,
      remoteSelectedAgentId: showRemotePresence ? remoteSelectedAgentId : null,
      remoteSelectedPeriod: showRemotePresence ? remoteSelectedPeriod : null,
      revealedAgentIds: myVision.revealedAgentIds, possiblePositions: myVision.possiblePositions, nodeLinkCounts,
    }, rewards, highlightedCityIds, tutorialMarkedCityIds);

    // Draw agents from both players
    const allAgents = [
      ...game.players.P1.agents,
      ...game.players.P2.agents,
    ];
    drawAgents(ctx, allAgents, map.cities, {
      width: drawWidth, height: drawHeight, period, localPlayer, selectedAgentId,
      remoteSelectedAgentId: showRemotePresence ? remoteSelectedAgentId : null,
      remoteSelectedPeriod: showRemotePresence ? remoteSelectedPeriod : null,
      revealedAgentIds: myVision.revealedAgentIds, possiblePositions: myVision.possiblePositions, nodeLinkCounts,
    }, localPlayer);
    drawBattleEffects(ctx, periodBattleEffects, map.cities, {
      width: drawWidth, height: drawHeight, period, localPlayer, selectedAgentId,
      remoteSelectedAgentId: showRemotePresence ? remoteSelectedAgentId : null,
      remoteSelectedPeriod: showRemotePresence ? remoteSelectedPeriod : null,
      revealedAgentIds: myVision.revealedAgentIds, possiblePositions: myVision.possiblePositions, nodeLinkCounts,
    }, now);

    // Header
    const p1Count = game.players.P1.agents.filter(a => a.currentPeriod === period).length;
    const p2Count = game.players.P2.agents.filter(a => a.currentPeriod === period).length;
    drawPeriodHeader(ctx, period, drawWidth, { P1: p1Count, P2: p2Count });

  }, [game, period, width, height, localPlayer, selectedAgentId, remoteSelectedAgentId, remoteSelectedPeriod, timelineVisualState, tutorialMarkedCityIds, periodBattleEffects, showRemotePresence]);

  useEffect(() => {
    if (lastVisualSignatureRef.current === visualSignature) return;
    lastVisualSignatureRef.current = visualSignature;
    backgroundIntroStartedAtRef.current = Date.now();
    render();
  }, [render, visualSignature]);

  useEffect(() => {
    let frameId = 0;
    let cancelled = false;
    const animateUntil = Date.now() + 700;
    const tick = () => {
      if (cancelled) return;
      render();
      const shouldContinue = periodBattleEffects.length > 0 || Date.now() < animateUntil;
      if (shouldContinue) {
        frameId = window.requestAnimationFrame(tick);
      }
    };
    tick();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [render, periodBattleEffects.length, visualSignature]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(() => {
      render();
    });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, [render]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const drawWidth = rect.width || width;
    const drawHeight = rect.height || height;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const { map } = game;
    const cities = getCitiesByPeriod(map, period);

    // Find clicked city
    let clickedCity: City | null = null;
    for (const city of cities) {
      if (city.destroyed) continue;
      const { cx, cy } = toCanvasXY(city, drawWidth, drawHeight);
      const r = city.isNode ? 12 : 9;
      if (Math.hypot(mx - cx, my - cy) <= r + 5) {
        clickedCity = city;
        break;
      }
    }

    if (!clickedCity) {
      selectAgent(null);
      return;
    }

    // Find agent in clicked city owned by local player
    const myAgentsAtCity = game.players[localPlayer].agents.filter(
      a => a.cityId === clickedCity!.id && a.currentPeriod === period
    );

    if (myAgentsAtCity.length > 0) {
      const agent = myAgentsAtCity[0];
      if (selectedAgentId === agent.id) {
        selectAgent(null); // deselect
      } else {
        selectAgent(agent.id);
      }
      return;
    }

    if (!selectedAgentId) {
      inspectCity(clickedCity.id, period);
      return;
    }

    // If an agent is selected, try to move there
    if (selectedAgentId) {
      const agent = game.players[localPlayer].agents.find(a => a.id === selectedAgentId);
      if (agent && agent.currentPeriod === period) {
        const connected = getConnectedCities(map, agent.cityId);
        if (connected.includes(clickedCity.id)) {
          executeActionNow({
            type: 'MOVE',
            agentId: selectedAgentId,
            owner: localPlayer,
            targetCityId: clickedCity.id,
          });
        }
      }
    }
  }, [game, period, width, height, localPlayer, selectedAgentId, selectAgent, inspectCity, executeActionNow]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onClick={handleClick}
      className="cursor-crosshair block"
      style={{ imageRendering: 'auto' }}
    />
  );
}
