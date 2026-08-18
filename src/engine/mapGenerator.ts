// ============================================================
// CHRONODOX — Map Generator
// Procedurally generates the three-timeline world
// ============================================================

import type { City, Route, MapState, TimePeriod } from '../types/game';

interface RawCity {
  name: string;
  x: number;
  y: number;
  isNode: boolean;
  nodeKey?: string;
}

interface SharedNodeSpec {
  nodeKey: string;
  x: number;
  y: number;
  periods: TimePeriod[];
}

interface LayoutSlot {
  anchorX: number;
  anchorY: number;
  jitterX: number;
  jitterY: number;
  isNode: boolean;
  nodeKey?: string;
}

const CITY_NAMES: Record<TimePeriod, string[]> = {
  PAST: ['Aegis', 'Caelum', 'Draven', 'Elarion', 'Ferros', 'Gorath', 'Halcyon', 'Ireth', 'Jorath', 'Karn', 'Lyra', 'Myrr'],
  PRESENT: ['Alpha', 'Bastion', 'Cirrus', 'Delphi', 'Errant', 'Forge', 'Glyph', 'Haven', 'Invoke', 'Juno', 'Kepler', 'Lattice'],
  FUTURE: ['Apex', 'Binary', 'Cipher', 'Delta', 'Epoch', 'Flux', 'Grid', 'Helix', 'Ion', 'Joule', 'Kilo', 'Lambda'],
};

const BOARD_BOUNDS = { minX: 0.1, maxX: 0.9, minY: 0.14, maxY: 0.84 };

const CITY_SLOTS: LayoutSlot[] = [
  { anchorX: 0.12, anchorY: 0.22, jitterX: 0.05, jitterY: 0.08, isNode: false },
  { anchorX: 0.16, anchorY: 0.50, jitterX: 0.06, jitterY: 0.09, isNode: false },
  { anchorX: 0.14, anchorY: 0.78, jitterX: 0.05, jitterY: 0.08, isNode: false },
  { anchorX: 0.34, anchorY: 0.16, jitterX: 0.07, jitterY: 0.06, isNode: false },
  { anchorX: 0.36, anchorY: 0.44, jitterX: 0.07, jitterY: 0.08, isNode: false },
  { anchorX: 0.36, anchorY: 0.82, jitterX: 0.07, jitterY: 0.06, isNode: false },
  { anchorX: 0.58, anchorY: 0.26, jitterX: 0.08, jitterY: 0.07, isNode: false },
  { anchorX: 0.60, anchorY: 0.56, jitterX: 0.08, jitterY: 0.08, isNode: false },
  { anchorX: 0.62, anchorY: 0.82, jitterX: 0.07, jitterY: 0.06, isNode: false },
  { anchorX: 0.86, anchorY: 0.24, jitterX: 0.04, jitterY: 0.07, isNode: false },
  { anchorX: 0.84, anchorY: 0.52, jitterX: 0.05, jitterY: 0.08, isNode: false },
  { anchorX: 0.86, anchorY: 0.78, jitterX: 0.04, jitterY: 0.07, isNode: false },
];

let _cityIdCounter = 0;
let _routeIdCounter = 0;

function makeId(prefix: string) {
  return `${prefix}_${++_cityIdCounter}`;
}
function makeRouteId() {
  return `R_${++_routeIdCounter}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function randomInRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function distance(a: Pick<RawCity, 'x' | 'y'>, b: Pick<RawCity, 'x' | 'y'>) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(
  point: Pick<RawCity, 'x' | 'y'>,
  a: Pick<RawCity, 'x' | 'y'>,
  b: Pick<RawCity, 'x' | 'y'>,
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(point, a);
  const projection = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  const t = Math.max(0, Math.min(1, projection));
  const nearest = { x: a.x + dx * t, y: a.y + dy * t };
  return distance(point, nearest);
}

function angleBetween(
  center: Pick<RawCity, 'x' | 'y'>,
  a: Pick<RawCity, 'x' | 'y'>,
  b: Pick<RawCity, 'x' | 'y'>,
) {
  const ax = a.x - center.x;
  const ay = a.y - center.y;
  const bx = b.x - center.x;
  const by = b.y - center.y;
  const magA = Math.hypot(ax, ay);
  const magB = Math.hypot(bx, by);
  if (magA === 0 || magB === 0) return Math.PI;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (magA * magB)));
  return Math.acos(cosine);
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sampleFromSlot(slot: LayoutSlot): RawCity {
  return {
    name: '',
    x: clamp(randomInRange(slot.anchorX - slot.jitterX, slot.anchorX + slot.jitterX), BOARD_BOUNDS.minX, BOARD_BOUNDS.maxX),
    y: clamp(randomInRange(slot.anchorY - slot.jitterY, slot.anchorY + slot.jitterY), BOARD_BOUNDS.minY, BOARD_BOUNDS.maxY),
    isNode: slot.isNode,
    nodeKey: slot.nodeKey,
  };
}

function sampleFreePoint(
  existing: RawCity[],
  options: { isNode: boolean; slot?: LayoutSlot; minDistance?: number; attempts?: number; nodeKey?: string }
): RawCity {
  const attempts = options.attempts ?? 40;
  const minDistance = options.minDistance ?? (options.isNode ? 0.14 : 0.1);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = options.slot
      ? sampleFromSlot({ ...options.slot, isNode: options.isNode, nodeKey: options.nodeKey })
      : {
          name: '',
          x: randomInRange(BOARD_BOUNDS.minX, BOARD_BOUNDS.maxX),
          y: randomInRange(BOARD_BOUNDS.minY, BOARD_BOUNDS.maxY),
          isNode: options.isNode,
          nodeKey: options.nodeKey,
        };

    if (!existing.some(item => distance(item, candidate) < minDistance)) {
      return candidate;
    }
  }

  return options.slot
    ? sampleFromSlot({ ...options.slot, isNode: options.isNode, nodeKey: options.nodeKey })
    : {
        name: '',
        x: randomInRange(BOARD_BOUNDS.minX, BOARD_BOUNDS.maxX),
        y: randomInRange(BOARD_BOUNDS.minY, BOARD_BOUNDS.maxY),
        isNode: options.isNode,
        nodeKey: options.nodeKey,
      };
}

function deriveSeedFraction(seed: number, salt: number) {
  const raw = Math.sin((seed + salt) * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

function choosePairPeriods(seed: number, index: number): [TimePeriod, TimePeriod] {
  const pairs: [TimePeriod, TimePeriod][] = [
    ['PAST', 'PRESENT'],
    ['PRESENT', 'FUTURE'],
    ['PAST', 'FUTURE'],
  ];
  const offset = Math.floor(deriveSeedFraction(seed, index + 1.3) * pairs.length);
  return pairs[(offset + index) % pairs.length];
}

function buildSharedNodeSpecs(seed: number): SharedNodeSpec[] {
  const specs: SharedNodeSpec[] = [];
  const occupied: RawCity[] = [];
  const fullSharedCount = 1 + Math.floor(seed * 3);
  const includePairShared = seed >= 0.34;
  const pairSharedCount = includePairShared
    ? 1 + Math.floor(deriveSeedFraction(seed, 7.1) * 3)
    : 0;
  const totalSharedCount = fullSharedCount + pairSharedCount;

  for (let i = 0; i < totalSharedCount; i += 1) {
    const candidate = sampleFreePoint(occupied, {
      isNode: true,
      minDistance: 0.2,
      attempts: 70,
      nodeKey: `NODE_${i + 1}`,
    });
    occupied.push(candidate);

    const periods = i < fullSharedCount
      ? (['PAST', 'PRESENT', 'FUTURE'] as TimePeriod[])
      : choosePairPeriods(seed, i - fullSharedCount);

    specs.push({
      nodeKey: `NODE_${i + 1}`,
      x: candidate.x,
      y: candidate.y,
      periods,
    });
  }

  return specs;
}

function computeNonNodeCount(periodNodeCount: number, sharedNodeCount: number) {
  const baseline = 6 + Math.max(0, 3 - periodNodeCount);
  const variation = randomInt(0, 2);
  return Math.min(CITY_SLOTS.length, baseline + Math.max(0, 2 - sharedNodeCount) + variation);
}

function sampleLayout(period: TimePeriod, sharedNodeSpecs: SharedNodeSpec[]): RawCity[] {
  const layout: RawCity[] = sharedNodeSpecs
    .filter(spec => spec.periods.includes(period))
    .map(spec => ({
      name: '',
      x: spec.x,
      y: spec.y,
      isNode: true,
      nodeKey: spec.nodeKey,
    }));
  const nonNodeCount = computeNonNodeCount(layout.length, sharedNodeSpecs.length);

  for (const slot of shuffle(CITY_SLOTS).slice(0, nonNodeCount)) {
    layout.push(sampleFreePoint(layout, { isNode: false, slot, minDistance: 0.1 }));
  }

  return layout.sort((a, b) => a.x - b.x || a.y - b.y);
}

function buildRoutes(cities: City[]): Route[] {
  const edges = new Set<string>();
  const indexById = new Map(cities.map((city, index) => [city.id, index]));
  const degreeById = new Map(cities.map(city => [city.id, 0]));
  const neighborsById = new Map(cities.map(city => [city.id, [] as string[]]));
  const MIN_ENDPOINT_ANGLE = Math.PI / 7.5;
  const MAX_SEGMENT_PROXIMITY = 0.055;

  const edgeCrowdingPenalty = (aIndex: number, bIndex: number) => {
    const from = cities[aIndex];
    const to = cities[bIndex];
    let penalty = 0;
    for (let i = 0; i < cities.length; i += 1) {
      if (i === aIndex || i === bIndex) continue;
      const city = cities[i];
      const endpointDistance = Math.min(distance(city, from), distance(city, to));
      if (endpointDistance < 0.085) {
        penalty += (0.085 - endpointDistance) * 1.2;
      }
      const segmentDistance = distancePointToSegment(city, from, to);
      if (segmentDistance < MAX_SEGMENT_PROXIMITY) {
        penalty += (MAX_SEGMENT_PROXIMITY - segmentDistance) * 2.1;
      }
    }
    return penalty;
  };

  const respectsAngularSpacing = (aIndex: number, bIndex: number) => {
    const from = cities[aIndex];
    const to = cities[bIndex];
    const fromNeighbors = neighborsById.get(from.id) ?? [];
    const toNeighbors = neighborsById.get(to.id) ?? [];

    for (const neighborId of fromNeighbors) {
      const neighbor = cities[indexById.get(neighborId)!];
      if (angleBetween(from, neighbor, to) < MIN_ENDPOINT_ANGLE) return false;
    }
    for (const neighborId of toNeighbors) {
      const neighbor = cities[indexById.get(neighborId)!];
      if (angleBetween(to, neighbor, from) < MIN_ENDPOINT_ANGLE) return false;
    }
    return true;
  };

  const addEdge = (aIndex: number, bIndex: number, strictAngles = true) => {
    if (aIndex === bIndex) return;
    const [low, high] = aIndex < bIndex ? [aIndex, bIndex] : [bIndex, aIndex];
    const from = cities[low];
    const to = cities[high];
    const key = `${from.id}:${to.id}`;
    if (edges.has(key)) return;
    if ((degreeById.get(from.id) ?? 0) >= 4 || (degreeById.get(to.id) ?? 0) >= 4) return;
    if (strictAngles && !respectsAngularSpacing(low, high)) return;
    edges.add(key);
    degreeById.set(from.id, (degreeById.get(from.id) ?? 0) + 1);
    degreeById.set(to.id, (degreeById.get(to.id) ?? 0) + 1);
    neighborsById.get(from.id)?.push(to.id);
    neighborsById.get(to.id)?.push(from.id);
  };

  const sorted = cities
    .map((city, index) => ({ city, index }))
    .sort((a, b) => a.city.x - b.city.x || a.city.y - b.city.y);

  for (let i = 1; i < sorted.length; i += 1) {
    addEdge(sorted[i - 1].index, sorted[i].index, false);
  }

  const candidates: Array<{ fromIndex: number; toIndex: number; score: number }> = [];
  for (let i = 0; i < cities.length; i += 1) {
    const nearest = cities
      .map((candidate, index) => ({
        index,
        dist: index === i ? Number.POSITIVE_INFINITY : distance(cities[i], candidate),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, cities[i].isNode ? 4 : 3);

    for (const candidate of nearest) {
      if (candidate.dist < 0.4) {
        const from = cities[i];
        const to = cities[candidate.index];
        const nodeBonus = from.isNode || to.isNode ? 0.03 : 0;
        const centerBias = Math.abs((from.y + to.y) * 0.5 - 0.5) * 0.04;
        const crowdPenalty = edgeCrowdingPenalty(i, candidate.index);
        candidates.push({
          fromIndex: i,
          toIndex: candidate.index,
          score: candidate.dist + crowdPenalty - nodeBonus + centerBias,
        });
      }
    }
  }

  candidates
    .sort((a, b) => a.score - b.score)
    .forEach(candidate => {
      addEdge(candidate.fromIndex, candidate.toIndex, true);
    });

  return [...edges].map(edge => {
    const [fromId, toId] = edge.split(':');
    const fromIndex = indexById.get(fromId)!;
    const toIndex = indexById.get(toId)!;
    return {
      id: makeRouteId(),
      from: cities[fromIndex].id,
      to: cities[toIndex].id,
      period: cities[fromIndex].period,
      destroyed: false,
    };
  });
}

function buildPeriodMap(period: TimePeriod, names: string[], layout: RawCity[]): { cities: City[]; routes: Route[] } {
  const cities: City[] = layout.map((raw, i) => ({
    id: makeId(`C_${period}`),
    name: names[i] ?? `City${i}`,
    x: raw.x,
    y: raw.y,
    period,
    isNode: raw.isNode,
    nodeId: raw.nodeKey,
    destroyed: false,
    controlledBy: null,
  }));

  return { cities, routes: buildRoutes(cities) };
}

export function generateMap(): MapState {
  _cityIdCounter = 0;
  _routeIdCounter = 0;

  const periods: TimePeriod[] = ['PAST', 'PRESENT', 'FUTURE'];
  const allCities = new Map<string, City>();
  const allRoutes: Route[] = [];
  const nodes = new Map<string, string[]>();
  const sharedNodeSeed = Math.random();
  const sharedTraversalNodes = buildSharedNodeSpecs(sharedNodeSeed);

  // Build each period
  for (const period of periods) {
    const layout = sampleLayout(period, sharedTraversalNodes);
    const { cities, routes } = buildPeriodMap(period, shuffle(CITY_NAMES[period]), layout);
    for (const c of cities) {
      allCities.set(c.id, c);
      if (c.isNode && c.nodeId) {
        const existing = nodes.get(c.nodeId) ?? [];
        existing.push(c.id);
        nodes.set(c.nodeId, existing);
      }
    }
    allRoutes.push(...routes);
  }

  return { cities: allCities, routes: allRoutes, nodes };
}

// ─── UTILITY HELPERS ────────────────────────────────────────

export function getCitiesByPeriod(map: MapState, period: TimePeriod): City[] {
  return [...map.cities.values()].filter(c => c.period === period);
}

export function getRoutesByPeriod(map: MapState, period: TimePeriod): Route[] {
  return map.routes.filter(r => {
    const from = map.cities.get(r.from);
    return from?.period === period;
  });
}

export function getConnectedCities(map: MapState, cityId: string): string[] {
  const connected: string[] = [];
  for (const route of map.routes) {
    if (route.destroyed) continue;
    if (route.from === cityId) connected.push(route.to);
    if (route.to === cityId) connected.push(route.from);
  }
  // filter out destroyed cities
  return connected.filter(id => !map.cities.get(id)?.destroyed);
}

export function getNodeCitiesForPeriod(map: MapState, nodeId: string, period: TimePeriod): City | undefined {
  const cityIds = map.nodes.get(nodeId) ?? [];
  return cityIds.map(id => map.cities.get(id)!).find(c => c.period === period);
}

export function getSharedNodeId(map: MapState, cityId: string): string | undefined {
  const city = map.cities.get(cityId);
  return city?.nodeId;
}

/** Returns all city IDs at the same node across all periods */
export function getNodeSiblings(map: MapState, cityId: string): string[] {
  const city = map.cities.get(cityId);
  if (!city?.nodeId) return [];
  const siblings = map.nodes.get(city.nodeId) ?? [];
  return siblings.filter(id => id !== cityId);
}
