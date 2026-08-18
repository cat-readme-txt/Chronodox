// ============================================================
// CHRONODOX — Canvas Drawing Utilities
// ============================================================

import type { City, Route, Agent, TimePeriod, Reward, PlayerId } from '../types/game';
import type { TimelineVisualState } from '../engine/timelineOccupation';
import { TIME_ORDER } from '../types/game';

export interface DrawConfig {
  width: number;
  height: number;
  period: TimePeriod;
  localPlayer: PlayerId;
  selectedAgentId: string | null;
  remoteSelectedAgentId?: string | null;
  remoteSelectedPeriod?: TimePeriod | null;
  revealedAgentIds: Set<string>;
  possiblePositions?: Map<string, string[]>;
  nodeLinkCounts?: Map<string, number>;
}

// ─── THEME ──────────────────────────────────────────────────

const PERIOD_COLORS = {
  PAST:    { bg: '#07040f', grid: '#22143d', accent: '#8e63ff', node: '#d1b3ff', text: '#dbcaff' },
  PRESENT: { bg: '#051015', grid: '#153241', accent: '#19d3a2', node: '#82ffd9', text: '#b9ffee' },
  FUTURE:  { bg: '#0c0708', grid: '#3a1820', accent: '#ff7a45', node: '#ffd1a1', text: '#ffe0ca' },
};

const PLAYER_COLORS = {
  P1: { main: '#00d4ff', glow: '#00aaff44', dark: '#005577' },
  P2: { main: '#ff4466', glow: '#ff224466', dark: '#770022' },
};

interface BattleEffectRender {
  id: string;
  kind: 'strike' | 'death' | 'paradox';
  owner: PlayerId | null;
  period: TimePeriod;
  cityId: string;
  createdAt: number;
}

// ─── COORDINATE HELPERS ─────────────────────────────────────

export function toCanvasXY(city: City, w: number, h: number) {
  return { cx: city.x * w, cy: city.y * h };
}

function distancePointToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
  const t = Math.max(0, Math.min(1, projection));
  const nearestX = start.x + dx * t;
  const nearestY = start.y + dy * t;
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

function buildRoutePath(
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  control: { x: number; y: number } | null,
) {
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  if (control) {
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    return;
  }
  ctx.lineTo(end.x, end.y);
}

// ─── ROUTE DRAWING ──────────────────────────────────────────

export function drawRoutes(
  ctx: CanvasRenderingContext2D,
  routes: Route[],
  cities: Map<string, City>,
  config: DrawConfig
) {
  const theme = PERIOD_COLORS[config.period];
  const degreeByCityId = new Map<string, number>();

  for (const route of routes) {
    if (route.destroyed) continue;
    degreeByCityId.set(route.from, (degreeByCityId.get(route.from) ?? 0) + 1);
    degreeByCityId.set(route.to, (degreeByCityId.get(route.to) ?? 0) + 1);
  }

  for (const route of routes) {
    const from = cities.get(route.from);
    const to = cities.get(route.to);
    if (!from || !to) continue;

    const { cx: x1, cy: y1 } = toCanvasXY(from, config.width, config.height);
    const { cx: x2, cy: y2 } = toCanvasXY(to, config.width, config.height);
    const start = { x: x1, y: y1 };
    const end = { x: x2, y: y2 };
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    const normalX = length > 0 ? -dy / length : 0;
    const normalY = length > 0 ? dx / length : 0;
    const midpointX = (x1 + x2) / 2;
    const midpointY = (y1 + y2) / 2;
    const endpointDegreePressure = Math.max(0, (degreeByCityId.get(route.from) ?? 0) - 2)
      + Math.max(0, (degreeByCityId.get(route.to) ?? 0) - 2);

    let nearbyCityPressure = 0;
    for (const city of cities.values()) {
      if (city.id === route.from || city.id === route.to) continue;
      const cityPoint = { x: city.x * config.width, y: city.y * config.height };
      const segmentDistance = distancePointToSegment(cityPoint, start, end);
      if (segmentDistance < 28) {
        nearbyCityPressure += (28 - segmentDistance) / 28;
      }
    }

    const shouldCurve = length > 48 && (endpointDegreePressure > 0 || nearbyCityPressure > 0.35);
    const curveDirection = route.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 2 === 0 ? 1 : -1;
    const control = shouldCurve
      ? {
          x: midpointX + normalX * curveDirection * Math.min(30, 12 + endpointDegreePressure * 5 + nearbyCityPressure * 9),
          y: midpointY + normalY * curveDirection * Math.min(30, 12 + endpointDegreePressure * 5 + nearbyCityPressure * 9),
        }
      : null;

    if (route.destroyed) {
      ctx.save();
      ctx.strokeStyle = '#ff003344';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      buildRoutePath(ctx, start, end, control);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    ctx.save();
    const routeGradient = ctx.createLinearGradient(x1, y1, x2, y2);
    routeGradient.addColorStop(0, theme.grid);
    routeGradient.addColorStop(0.5, theme.accent + 'aa');
    routeGradient.addColorStop(1, theme.grid);

    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = routeGradient;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    buildRoutePath(ctx, start, end, control);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff14';
    ctx.lineWidth = 0.85;
    ctx.setLineDash([]);
    buildRoutePath(ctx, start, end, control);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.restore();
  }
}

// ─── CITY DRAWING ────────────────────────────────────────────

export function drawCities(
  ctx: CanvasRenderingContext2D,
  cities: City[],
  config: DrawConfig,
  rewards: Reward[],
  highlightedCityIds: string[] = [],
  tutorialMarkedCityIds: string[] = [],
) {
  const theme = PERIOD_COLORS[config.period];

  for (const city of cities) {
    const { cx, cy } = toCanvasXY(city, config.width, config.height);
    const isHighlighted = highlightedCityIds.includes(city.id);
    const isTutorialMarked = tutorialMarkedCityIds.includes(city.id);
    const hasReward = rewards.some(r => r.cityId === city.id);
    const isTraversalNode = Boolean(city.nodeId);
    const nodeLinkCount = city.nodeId ? (config.nodeLinkCounts?.get(city.nodeId) ?? 1) : 0;
    const isFullTraversalNode = nodeLinkCount >= 3;

    ctx.save();

    if (city.destroyed) {
      // Draw as X
      ctx.strokeStyle = '#ff003366';
      ctx.lineWidth = 2;
      const sz = 8;
      ctx.beginPath();
      ctx.moveTo(cx - sz, cy - sz); ctx.lineTo(cx + sz, cy + sz);
      ctx.moveTo(cx + sz, cy - sz); ctx.lineTo(cx - sz, cy + sz);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    const baseR = city.isNode ? (isFullTraversalNode ? 12 : (isTraversalNode ? 11 : 10)) : 9;
    const r = isHighlighted ? baseR + 3 : baseR;

    // Glow for nodes
    if (city.isNode) {
      ctx.shadowColor = isFullTraversalNode ? theme.node : (isTraversalNode ? theme.node + '88' : theme.accent);
      ctx.shadowBlur = isFullTraversalNode ? 18 : (isTraversalNode ? 10 : 10);
    }

    // Control indicator ring
    if (city.controlledBy) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = PLAYER_COLORS[city.controlledBy].main + '88';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Highlight ring
    if (isHighlighted) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (isTutorialMarked) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 18, 0, Math.PI * 2);
      ctx.strokeStyle = '#dff7ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
      ctx.strokeStyle = '#8fdfff';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(cx - (r + 22), cy);
      ctx.lineTo(cx + (r + 22), cy);
      ctx.moveTo(cx, cy - (r + 22));
      ctx.lineTo(cx, cy + (r + 22));
      ctx.strokeStyle = '#8fdfffcc';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#dff7ff';
      ctx.fill();
    }

    const shellGradient = ctx.createRadialGradient(cx, cy, 1, cx, cy, r + 8);
    shellGradient.addColorStop(0, city.isNode ? (isFullTraversalNode ? theme.node + '66' : (isTraversalNode ? theme.node + '38' : theme.accent + '50')) : theme.accent + '50');
    shellGradient.addColorStop(1, 'transparent');
    ctx.fillStyle = shellGradient;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    if (city.isNode) {
      for (let side = 0; side < 6; side += 1) {
        const angle = (-Math.PI / 2) + (Math.PI / 3) * side;
        const px = cx + Math.cos(angle) * (r + 1);
        const py = cy + Math.sin(angle) * (r + 1);
        if (side === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
    }

    ctx.fillStyle = city.isNode ? '#180f27dd' : '#08141bdd';
    ctx.fill();
    ctx.strokeStyle = city.isNode ? (isFullTraversalNode ? theme.node : (isTraversalNode ? theme.node : theme.accent)) : theme.accent;
    ctx.globalAlpha = city.isNode && isTraversalNode && !isFullTraversalNode ? 0.5 : 1;
    ctx.lineWidth = city.isNode ? (isFullTraversalNode ? 2.8 : (isTraversalNode ? 2.4 : 2.2)) : 1.8;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    if (city.isNode) {
      for (let side = 0; side < 6; side += 1) {
        const angle = (-Math.PI / 2) + (Math.PI / 3) * side;
        const px = cx + Math.cos(angle) * (r * 0.6);
        const py = cy + Math.sin(angle) * (r * 0.6);
        if (side === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
    }
    ctx.fillStyle = city.isNode ? (isFullTraversalNode ? theme.node + '33' : (isTraversalNode ? theme.node + '20' : theme.accent + '25')) : theme.accent + '25';
    ctx.fill();

    if (!city.isNode) {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy);
      ctx.lineTo(cx + r * 0.55, cy);
      ctx.strokeStyle = theme.text + '66';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r + 4.5, Math.PI * 0.12, Math.PI * 0.88);
      ctx.strokeStyle = theme.accent + '44';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (isTraversalNode) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = isFullTraversalNode ? theme.node + '80' : theme.node + '50';
      ctx.lineWidth = isFullTraversalNode ? 1.5 : 0.95;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Reward indicator
    if (hasReward) {
      ctx.beginPath();
      ctx.arc(cx + r - 2, cy - r + 2, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd700';
      ctx.fill();
    }

    // City name
    ctx.shadowBlur = 0;
    const label = city.name.substring(0, 10);
    const labelY = cy + r + 8;
    ctx.fillStyle = city.isNode ? (isTraversalNode ? (isFullTraversalNode ? theme.node : theme.node + '88') : theme.accent) : theme.text;
    ctx.strokeStyle = '#02030bdd';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.font = city.isNode ? '700 13px "Rajdhani"' : '700 12px "Rajdhani"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeText(label, cx, labelY);
    ctx.fillText(label, cx, labelY);

    ctx.restore();
  }
}

// ─── AGENT DRAWING ──────────────────────────────────────────

export function drawAgents(
  ctx: CanvasRenderingContext2D,
  agents: Agent[],
  cities: Map<string, City>,
  config: DrawConfig,
  perspective: PlayerId
) {
  const getVisibleAgentIdsByCity = () => {
    const byCity = new Map<string, Agent[]>();
    const visibleAgents = agents.filter(agent => {
      const city = cities.get(agent.cityId);
      if (!city || city.period !== config.period) return false;
      const isOwn = agent.owner === perspective;
      const isRevealed = !agent.cover || config.revealedAgentIds.has(agent.id) || isOwn;
      return isRevealed;
    });

    for (const agent of visibleAgents) {
      const list = byCity.get(agent.cityId) ?? [];
      list.push(agent);
      byCity.set(agent.cityId, list);
    }

    for (const [cityId, list] of byCity.entries()) {
      list.sort((a, b) =>
        a.createdAt - b.createdAt
        || TIME_ORDER.indexOf(a.period) - TIME_ORDER.indexOf(b.period)
        || a.id.localeCompare(b.id));
      byCity.set(cityId, list);
    }

    return byCity;
  };

    const pastOriginSymbol = '◆';

    const drawHiddenIdTag = (
    x: number,
    y: number,
    label: string,
    accent: string,
  ) => {
    const tagWidth = 16;
    const tagHeight = 10;
    const tagY = y + 12;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - tagWidth / 2 + 3, tagY);
    ctx.lineTo(x + tagWidth / 2 - 3, tagY);
    ctx.quadraticCurveTo(x + tagWidth / 2, tagY, x + tagWidth / 2, tagY + 3);
    ctx.lineTo(x + tagWidth / 2, tagY + tagHeight - 3);
    ctx.quadraticCurveTo(x + tagWidth / 2, tagY + tagHeight, x + tagWidth / 2 - 3, tagY + tagHeight);
    ctx.lineTo(x - tagWidth / 2 + 3, tagY + tagHeight);
    ctx.quadraticCurveTo(x - tagWidth / 2, tagY + tagHeight, x - tagWidth / 2, tagY + tagHeight - 3);
    ctx.lineTo(x - tagWidth / 2, tagY + 3);
    ctx.quadraticCurveTo(x - tagWidth / 2, tagY, x - tagWidth / 2 + 3, tagY);
    ctx.closePath();
    ctx.fillStyle = '#081018d9';
    ctx.fill();
    ctx.strokeStyle = accent + '88';
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.font = '700 8px "Rajdhani"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#02030bcc';
    ctx.lineWidth = 2;
    ctx.strokeText(label, x, tagY + tagHeight / 2 + 0.5);
    ctx.fillStyle = '#d6e6f7';
    ctx.fillText(label, x, tagY + tagHeight / 2 + 0.5);
    ctx.restore();
  };

  const drawLiveAgentTag = (
    x: number,
    y: number,
    label: string,
    accent: string,
  ) => {
    const tagWidth = 16;
    const tagHeight = 10;
    const tagY = y + 12;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - tagWidth / 2 + 3, tagY);
    ctx.lineTo(x + tagWidth / 2 - 3, tagY);
    ctx.quadraticCurveTo(x + tagWidth / 2, tagY, x + tagWidth / 2, tagY + 3);
    ctx.lineTo(x + tagWidth / 2, tagY + tagHeight - 3);
    ctx.quadraticCurveTo(x + tagWidth / 2, tagY + tagHeight, x + tagWidth / 2 - 3, tagY + tagHeight);
    ctx.lineTo(x - tagWidth / 2 + 3, tagY + tagHeight);
    ctx.quadraticCurveTo(x - tagWidth / 2, tagY + tagHeight, x - tagWidth / 2, tagY + tagHeight - 3);
    ctx.lineTo(x - tagWidth / 2, tagY + 3);
    ctx.quadraticCurveTo(x - tagWidth / 2, tagY, x - tagWidth / 2 + 3, tagY);
    ctx.closePath();
    ctx.fillStyle = '#d6e6f7';
    ctx.fill();
    ctx.strokeStyle = accent + '88';
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.font = '700 8px "Rajdhani"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#d6e6f7';
    ctx.lineWidth = 2;
    ctx.strokeText(label, x, tagY + tagHeight / 2 + 0.5);
    ctx.fillStyle = '#02030bcc';
    ctx.fillText(label, x, tagY + tagHeight / 2 + 0.5);
    ctx.restore();
  };

  const drawPastOriginBadge = (x: number, y: number) => {
    const badgeY = y + 4;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, badgeY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#20140aee';
    ctx.fill();
    ctx.strokeStyle = '#ffe0a6cc';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ffe0a6';
    ctx.font = '700 7px "Rajdhani"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const symbolMetrics = ctx.measureText(pastOriginSymbol);
    const symbolOffsetX = ((symbolMetrics.actualBoundingBoxLeft ?? 0) - (symbolMetrics.actualBoundingBoxRight ?? 0)) / 2;
    ctx.strokeStyle = '#02030bdd';
    ctx.lineWidth = 2;
    ctx.strokeText(pastOriginSymbol, x + symbolOffsetX, badgeY + 0.5);
    ctx.fillText(pastOriginSymbol, x + symbolOffsetX, badgeY + 0.5);
    ctx.restore();
  };

  const getAgentRenderIndex = (target: Agent) =>
    [...agents]
      .filter(agent => agent.owner === target.owner)
      .sort((a, b) =>
        a.createdAt - b.createdAt
        || TIME_ORDER.indexOf(a.period) - TIME_ORDER.indexOf(b.period)
        || a.id.localeCompare(b.id))
      .findIndex(agent => agent.id === target.id) + 1;

  const visibleAgentsByCity = getVisibleAgentIdsByCity();
  const hiddenMarkersByCity = new Map<string, string[]>();
  const liveTagOverlays: Array<{ x: number; y: number; label: string; accent: string }> = [];
  const pastOriginBadges: Array<{ x: number; y: number }> = [];

  for (const agent of agents) {
    const isOwn = agent.owner === perspective;
    const isRevealed = !agent.cover || config.revealedAgentIds.has(agent.id) || isOwn;
    if (isOwn || isRevealed) continue;

    const lastKnownCity = agent.lastKnownCityId ? cities.get(agent.lastKnownCityId) ?? null : null;
    if (lastKnownCity && lastKnownCity.period === config.period) {
      const entries = hiddenMarkersByCity.get(lastKnownCity.id) ?? [];
      entries.push(`last:${agent.id}:${lastKnownCity.id}`);
      hiddenMarkersByCity.set(lastKnownCity.id, entries);
    }

    const possibleCityIds = [...new Set(config.possiblePositions?.get(agent.id) ?? agent.possibleCityIds)];
    for (const cityId of possibleCityIds) {
      const possibleCity = cities.get(cityId);
      if (!possibleCity || possibleCity.period !== config.period || possibleCity.id === agent.lastKnownCityId) continue;
      const entries = hiddenMarkersByCity.get(possibleCity.id) ?? [];
      entries.push(`possible:${agent.id}:${possibleCity.id}`);
      hiddenMarkersByCity.set(possibleCity.id, entries);
    }
  }

  const getHiddenMarkerOffset = (cityId: string, markerKey: string) => {
    const markerKeys = hiddenMarkersByCity.get(cityId) ?? [];
    const markerIndex = markerKeys.indexOf(markerKey);
    if (markerIndex < 0) return 0;
    const visibleCount = (visibleAgentsByCity.get(cityId) ?? []).length;
    if (visibleCount === 0) {
      return markerKeys.length > 1 ? (markerIndex - (markerKeys.length - 1) / 2) * 14 : 0;
    }
    const visibleSpan = ((visibleCount - 1) / 2) * 14 + 16;
    return visibleSpan + markerIndex * 14;
  };

  for (const agent of agents) {
    const city = cities.get(agent.cityId);
    if (!city) continue;

    const isOwn = agent.owner === perspective;
    const isRevealed = !agent.cover || config.revealedAgentIds.has(agent.id) || isOwn;
    const isSelected = agent.id === config.selectedAgentId;
    const isRemoteSelected = agent.id === config.remoteSelectedAgentId && agent.owner !== perspective;
    const colors = PLAYER_COLORS[agent.owner];
    const agentIndex = getAgentRenderIndex(agent);
    const possibleCityIds = config.possiblePositions?.get(agent.id) ?? agent.possibleCityIds;

    if (!isOwn && !isRevealed) {
      const lastKnownCity = agent.lastKnownCityId ? cities.get(agent.lastKnownCityId) ?? null : null;
      if (lastKnownCity && lastKnownCity.period === config.period) {
        const { cx: ghostCityX, cy: ghostCityY } = toCanvasXY(lastKnownCity, config.width, config.height);
        const ghostX = ghostCityX + getHiddenMarkerOffset(lastKnownCity.id, `last:${agent.id}:${lastKnownCity.id}`);
        const ghostY = ghostCityY - 17;
        const ghostR = 8;

        ctx.save();
        ctx.globalAlpha = 0.32;
        ctx.shadowColor = colors.main;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(ghostX, ghostY + ghostR + 3);
        ctx.lineTo(ghostX + ghostR + 1, ghostY - ghostR * 0.9);
        ctx.lineTo(ghostX, ghostY - ghostR - 3);
        ctx.lineTo(ghostX - ghostR - 1, ghostY - ghostR * 0.9);
        ctx.closePath();
        ctx.fillStyle = colors.dark;
        ctx.fill();
        ctx.strokeStyle = colors.main;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ghostX, ghostY + ghostR * 1.15);
        ctx.lineTo(ghostX + ghostR * 0.58, ghostY - ghostR * 0.42);
        ctx.lineTo(ghostX, ghostY - ghostR * 1.12);
        ctx.lineTo(ghostX - ghostR * 0.58, ghostY - ghostR * 0.42);
        ctx.closePath();
        ctx.fillStyle = '#f5fbff';
        ctx.fill();
        ctx.restore();
        drawHiddenIdTag(ghostX, ghostY, `A${agentIndex}`, colors.main);
      }

      const possibleCities = [...new Set(possibleCityIds)]
        .map(cityId => cities.get(cityId))
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(
          candidate
          && candidate.period === config.period
          && candidate.id !== agent.lastKnownCityId,
        ));

      possibleCities.forEach((possibleCity) => {
        const stackOffset = getHiddenMarkerOffset(possibleCity.id, `possible:${agent.id}:${possibleCity.id}`);
        const { cx: px, cy: py } = toCanvasXY(possibleCity, config.width, config.height);
        ctx.save();
        ctx.globalAlpha = 0.86;
        ctx.translate(px + stackOffset, py - 15);
        ctx.shadowColor = colors.main;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fillStyle = colors.main + '18';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(10, 0);
        ctx.lineTo(0, 10);
        ctx.lineTo(-10, 0);
        ctx.closePath();
        ctx.fillStyle = '#09111bd8';
        ctx.fill();
        ctx.strokeStyle = colors.main + 'cc';
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-15, 0);
        ctx.lineTo(-9, 0);
        ctx.moveTo(9, 0);
        ctx.lineTo(15, 0);
        ctx.moveTo(0, -15);
        ctx.lineTo(0, -9);
        ctx.moveTo(0, 9);
        ctx.lineTo(0, 15);
        ctx.strokeStyle = colors.main + '70';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.fillStyle = '#eff6ff';
        ctx.font = '700 11px "Rajdhani"';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const qMetrics = ctx.measureText('?');
        const qOffsetX = ((qMetrics.actualBoundingBoxLeft ?? 0) - (qMetrics.actualBoundingBoxRight ?? 0)) / 2;
        const qOffsetY = ((qMetrics.actualBoundingBoxAscent ?? 0) - (qMetrics.actualBoundingBoxDescent ?? 0)) / 2;
        ctx.strokeStyle = '#02030bdd';
        ctx.lineWidth = 2;
        ctx.strokeText('?', qOffsetX, qOffsetY);
        ctx.fillText('?', qOffsetX, qOffsetY);
        ctx.restore();
        drawHiddenIdTag(px + stackOffset, py - 17, `A${agentIndex}`, colors.main);
      });

      continue;
    }

    if (city.period !== config.period) continue;

    const { cx, cy } = toCanvasXY(city, config.width, config.height);

    // Offset if multiple agents at same city
    const visibleCityAgents = visibleAgentsByCity.get(agent.cityId) ?? [agent];
    const tagIndex = Math.max(0, visibleCityAgents.findIndex(item => item.id === agent.id));
    const offsetX = (tagIndex - (visibleCityAgents.length - 1) / 2) * 14;
    const tagCenterX = cx + offsetX;
    const tagAnchorY = cy - 17;

    const ax = cx + offsetX;
    const ay = cy - 17;
    const agentR = 8;
    const periodRingBase = PERIOD_COLORS[agent.period].accent;
    const ringColor = agent.cover ? `${periodRingBase}77` : `${periodRingBase}cc`;

    ctx.save();

    // Glow
    ctx.shadowColor = colors.main;
    ctx.shadowBlur = isSelected ? 24 : (agent.cover ? 8 : 16);

    // Selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(ax, ay + 1, agentR + 9, 0, Math.PI * 2);
      ctx.strokeStyle = colors.main;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    if (isRemoteSelected) {
      ctx.beginPath();
      ctx.arc(ax, ay + 1, agentR + 12, 0, Math.PI * 2);
      ctx.strokeStyle = colors.main;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(ax, ay + agentR + 3);
    ctx.lineTo(ax + agentR + 1, ay - agentR * 0.9);
    ctx.lineTo(ax, ay - agentR - 3);
    ctx.lineTo(ax - agentR - 1, ay - agentR * 0.9);
    ctx.closePath();
    ctx.fillStyle = agent.cover ? colors.dark + 'cc' : colors.main + '55';
    ctx.fill();
    ctx.strokeStyle = colors.main;
    ctx.lineWidth = agent.cover ? 1.2 : 2.1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(ax, ay + agentR * 1.15);
    ctx.lineTo(ax + agentR * 0.58, ay - agentR * 0.42);
    ctx.lineTo(ax, ay - agentR * 1.12);
    ctx.lineTo(ax - agentR * 0.58, ay - agentR * 0.42);
    ctx.closePath();
    ctx.fillStyle = agent.cover ? colors.main + '88' : '#f5fbff';
    ctx.fill();

    if (isOwn) {
      ctx.beginPath();
      ctx.arc(ax, ay + 1, agentR + 6, 0, Math.PI * 2);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 1;
      ctx.setLineDash(agent.cover ? [2, 2] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (!isOwn) {
      ctx.beginPath();
      ctx.arc(ax, ay + 1, agentR + 6, 0, Math.PI * 2);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = agent.cover ? 0.8 : 1.35;
      ctx.setLineDash(agent.cover ? [2, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
    if (agent.period === 'PAST') pastOriginBadges.push({ x: tagCenterX, y: tagAnchorY });
    liveTagOverlays.push({ x: tagCenterX, y: tagAnchorY, label: `A${agentIndex}`, accent: colors.main });
  }

  for (const badge of pastOriginBadges) {
    drawPastOriginBadge(badge.x, badge.y);
  }

  for (const overlay of liveTagOverlays) {
    drawLiveAgentTag(overlay.x, overlay.y, overlay.label, overlay.accent);
  }
}

// ─── PERIOD HEADER ──────────────────────────────────────────

export function drawPeriodHeader(
  ctx: CanvasRenderingContext2D,
  period: TimePeriod,
  width: number,
  agentCounts: { P1: number; P2: number }
) {
  const theme = PERIOD_COLORS[period];
  const labels = { PAST: 'PAST', PRESENT: 'PRESENT', FUTURE: 'FUTURE' };

  ctx.save();
  const headerGradient = ctx.createLinearGradient(0, 0, width, 28);
  headerGradient.addColorStop(0, '#02040b');
  headerGradient.addColorStop(0.5, theme.bg);
  headerGradient.addColorStop(1, '#02040b');
  ctx.fillStyle = headerGradient;
  ctx.fillRect(0, 0, width, 28);

  ctx.strokeStyle = '#d8e4ff22';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 28);
  ctx.lineTo(width, 28);
  ctx.stroke();

  ctx.font = '700 13px "Orbitron"';
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#b6c8ff44';
  ctx.shadowBlur = 4;
  ctx.strokeStyle = '#010208ee';
  ctx.lineWidth = 3;
  ctx.strokeText(labels[period], width / 2, 14);
  ctx.fillText(labels[period], width / 2, 14);

  // Agent counts
  ctx.font = '700 10px "Rajdhani"';
  ctx.shadowBlur = 0;
  ctx.fillStyle = PLAYER_COLORS.P1.main;
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#02030bdd';
  ctx.lineWidth = 2;
  ctx.strokeText(`P1:${agentCounts.P1}`, 8, 14);
  ctx.fillText(`P1:${agentCounts.P1}`, 8, 14);

  ctx.fillStyle = PLAYER_COLORS.P2.main;
  ctx.textAlign = 'right';
  ctx.strokeText(`P2:${agentCounts.P2}`, width - 8, 14);
  ctx.fillText(`P2:${agentCounts.P2}`, width - 8, 14);

  ctx.restore();
}

// ─── BACKGROUND ─────────────────────────────────────────────

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  period: TimePeriod,
  width: number,
  height: number,
  visualState: TimelineVisualState,
  introAgeMs: number,
) {
  const theme = PERIOD_COLORS[period];
  const introProgress = Math.max(0, Math.min(1, introAgeMs / 650));
  const introAlpha = 1 - introProgress;
  const backgroundGradient = ctx.createLinearGradient(0, 0, width, height);
  backgroundGradient.addColorStop(0, theme.bg);
  backgroundGradient.addColorStop(0.55, '#07131a');
  backgroundGradient.addColorStop(1, '#020409');
  ctx.fillStyle = backgroundGradient;
  ctx.fillRect(0, 0, width, height);

  const glowA = ctx.createRadialGradient(width * 0.2, height * 0.18, 10, width * 0.2, height * 0.18, width * 0.5);
  glowA.addColorStop(0, theme.accent + '30');
  glowA.addColorStop(1, 'transparent');
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, width, height);

  const glowB = ctx.createRadialGradient(width * 0.78, height * 0.76, 10, width * 0.78, height * 0.76, width * 0.48);
  glowB.addColorStop(0, theme.node + '22');
  glowB.addColorStop(1, 'transparent');
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, width, height);

  if (visualState.mode === 'occupied' && visualState.owner) {
    const ownerColor = PLAYER_COLORS[visualState.owner].main;
    const occupationGlow = ctx.createLinearGradient(0, 0, width, height);
    occupationGlow.addColorStop(0, `${ownerColor}${visualState.bonusActive ? '30' : '24'}`);
    occupationGlow.addColorStop(0.55, `${ownerColor}${visualState.bonusActive ? '1c' : '14'}`);
    occupationGlow.addColorStop(1, `${ownerColor}08`);
    ctx.fillStyle = occupationGlow;
    ctx.fillRect(0, 0, width, height);

    const ownerHalo = ctx.createRadialGradient(width * 0.22, height * 0.25, 8, width * 0.22, height * 0.25, width * 0.62);
    ownerHalo.addColorStop(0, `${ownerColor}${visualState.bonusActive ? '36' : '28'}`);
    ownerHalo.addColorStop(1, 'transparent');
    ctx.fillStyle = ownerHalo;
    ctx.fillRect(0, 0, width, height);

    if (visualState.bonusActive) {
      const bonusHalo = ctx.createRadialGradient(width * 0.54, height * 0.22, 8, width * 0.54, height * 0.22, width * 0.48);
      bonusHalo.addColorStop(0, 'rgba(255,215,120,0.2)');
      bonusHalo.addColorStop(1, 'transparent');
      ctx.fillStyle = bonusHalo;
      ctx.fillRect(0, 0, width, height);
    }
  }

  if (visualState.mode === 'contested' && visualState.owner && visualState.foreignOwner) {
    const leftColor = PLAYER_COLORS[visualState.owner].main;
    const rightColor = PLAYER_COLORS[visualState.foreignOwner].main;
    const contestedGradient = ctx.createLinearGradient(0, 0, width, height);
    contestedGradient.addColorStop(0, `${leftColor}24`);
    contestedGradient.addColorStop(0.5, 'rgba(255,255,255,0.035)');
    contestedGradient.addColorStop(1, `${rightColor}24`);
    ctx.fillStyle = contestedGradient;
    ctx.fillRect(0, 0, width, height);

    const leftHalo = ctx.createRadialGradient(width * 0.18, height * 0.3, 10, width * 0.18, height * 0.3, width * 0.44);
    leftHalo.addColorStop(0, `${leftColor}26`);
    leftHalo.addColorStop(1, 'transparent');
    ctx.fillStyle = leftHalo;
    ctx.fillRect(0, 0, width, height);

    const rightHalo = ctx.createRadialGradient(width * 0.82, height * 0.7, 10, width * 0.82, height * 0.7, width * 0.44);
    rightHalo.addColorStop(0, `${rightColor}26`);
    rightHalo.addColorStop(1, 'transparent');
    ctx.fillStyle = rightHalo;
    ctx.fillRect(0, 0, width, height);
  }

  if (introAgeMs >= 0 && introAgeMs < 650) {
    const introRadius = width * (0.12 + introProgress * 0.7);
    const introGlow = ctx.createRadialGradient(width * 0.5, height * 0.5, 6, width * 0.5, height * 0.5, introRadius);
    introGlow.addColorStop(0, `rgba(255,255,255,${0.22 * introAlpha})`);
    introGlow.addColorStop(0.35, `rgba(255,255,255,${0.12 * introAlpha})`);
    introGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = introGlow;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.strokeStyle = theme.grid + '88';
  ctx.lineWidth = 0.45;
  const gridSize = 42;
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
/*
  ctx.strokeStyle = '#ffffff08';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    const y = height * (0.2 + i * 0.23);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(width * 0.25, y - 22, width * 0.6, y + 14, width, y - 12);
    ctx.stroke();
  }

  ctx.fillStyle = '#ffffff12';
  for (let i = 0; i < 18; i += 1) {
    const x = ((i * 53) % width) + 6;
    const y = ((i * 97) % height) + 10;
    ctx.fillRect(x, y, 1.2, 1.2);
  }*/
}

export function drawBattleEffects(
  ctx: CanvasRenderingContext2D,
  effects: BattleEffectRender[],
  cities: Map<string, City>,
  config: DrawConfig,
  timeMs: number,
) {
  for (const effect of effects) {
    if (effect.period !== config.period) continue;
    const city = cities.get(effect.cityId);
    if (!city) continue;
    const elapsed = timeMs - effect.createdAt;
    const progress = Math.max(0, Math.min(1, elapsed / 700));
    const { cx, cy } = toCanvasXY(city, config.width, config.height);

    ctx.save();

    if (effect.kind === 'strike') {
      const strikeColor = effect.owner ? PLAYER_COLORS[effect.owner].main : '#ffd580';
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 4);
      ctx.strokeStyle = strikeColor;
      ctx.lineWidth = 2.4;
      ctx.shadowColor = strikeColor;
      ctx.shadowBlur = 14;
      ctx.globalAlpha = 1 - progress;
      ctx.beginPath();
      ctx.moveTo(-20 + progress * 26, 18 - progress * 18);
      ctx.lineTo(-4 + progress * 28, 4 - progress * 22);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10 + progress * 20, 22 - progress * 18);
      ctx.lineTo(12 + progress * 16, -2 - progress * 20);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    if (effect.kind === 'death') {
      const deathColor = effect.owner ? PLAYER_COLORS[effect.owner].main : '#ffffff';
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = deathColor;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = deathColor;
      ctx.shadowBlur = 12;
      const radius = 10 + progress * 12;
      ctx.beginPath();
      ctx.arc(cx, cy - 14, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - radius * 0.7, cy - 14 - radius * 0.7);
      ctx.lineTo(cx + radius * 0.7, cy - 14 + radius * 0.7);
      ctx.moveTo(cx + radius * 0.7, cy - 14 - radius * 0.7);
      ctx.lineTo(cx - radius * 0.7, cy - 14 + radius * 0.7);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    if (effect.kind === 'paradox') {
      const explosionRadius = 8 + progress * 22;
      ctx.globalAlpha = 1 - progress;
      ctx.fillStyle = `rgba(255,140,80,${0.22 + (1 - progress) * 0.25})`;
      ctx.beginPath();
      ctx.arc(cx, cy, explosionRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,232,180,${0.85 - progress * 0.4})`;
      ctx.lineWidth = 1.7;
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI * 2 * i) / 6 + progress * 0.35;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * (4 + progress * 4), cy + Math.sin(angle) * (4 + progress * 4));
        ctx.lineTo(cx + Math.cos(angle) * (12 + progress * 12), cy + Math.sin(angle) * (12 + progress * 12));
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
