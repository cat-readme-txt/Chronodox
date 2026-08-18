import type { Agent, AiDifficulty, GameAction, GameState, PlayerId, TimePeriod } from '../types/game';
import { TIME_ORDER } from '../types/game';
import { parseAiDifficulty } from './aiDifficulty';
import { getConnectedCities, getNodeCitiesForPeriod } from './mapGenerator';

export interface TerminalCommandContext {
  game: GameState;
  localPlayer: PlayerId;
  selectedAgentId: string | null;
  selectedPeriod: TimePeriod;
}

export interface TerminalSuggestion {
  value: string;
  description: string;
}

export type ParsedTerminalCommand =
  | { kind: 'help' }
  | { kind: 'man'; command?: string }
  | { kind: 'pass' }
  | { kind: 'undo' }
  | { kind: 'exit' }
  | { kind: 'logout' }
  | { kind: 'passwd' }
  | { kind: 'clear' }
  | { kind: 'pwd' }
  | { kind: 'whoami' }
  | { kind: 'status' }
  | { kind: 'history' }
  | { kind: 'date' }
  | { kind: 'uname' }
  | { kind: 'intel' }
  | { kind: 'selfplay-run'; count: number; difficulty: AiDifficulty | null }
  | { kind: 'selfplay-status' }
  | { kind: 'training-status' }
  | { kind: 'training-audit' }
  | { kind: 'training-export' }
  | { kind: 'training-clear' }
  | { kind: 'queue' }
  | { kind: 'abort' }
  | { kind: 'repeat' }
  | { kind: 'tail'; count: number }
  | { kind: 'grep'; query: string }
  | { kind: 'echo'; text: string }
  | { kind: 'agents'; period?: TimePeriod; verbose?: boolean }
  | { kind: 'ls'; period?: TimePeriod; city?: string }
  | { kind: 'map'; period?: TimePeriod }
  | { kind: 'select'; period: TimePeriod; agentId: string }
  | { kind: 'use'; period: TimePeriod; agentId: string }
  | { kind: 'cd'; period: TimePeriod }
  | { kind: 'scan' }
  | { kind: 'routes'; city?: string }
  | { kind: 'locate-report' }
  | { kind: 'killfeed' }
  | { kind: 'node'; query?: string }
  | { kind: 'handoff-debug'; enabled: boolean }
  | { kind: 'add'; resource: 'intel' | 'action'; amount: number; period?: TimePeriod; agentId?: string }
  | { kind: 'action'; action: Omit<GameAction, 'id'>; summary: string }
  | { kind: 'invalid'; message: string };

const PERIOD_ALIASES: Record<string, TimePeriod> = {
  past: 'PAST',
  p: 'PAST',
  present: 'PRESENT',
  now: 'PRESENT',
  pr: 'PRESENT',
  future: 'FUTURE',
  f: 'FUTURE',
};

const ACTION_ALIASES: Record<string, GameAction['type']> = {
  move: 'MOVE',
  mv: 'MOVE',
  wait: 'WAIT',
  control: 'CONTROL',
  strike: 'STRIKE',
  traverse: 'TRAVERSE',
  travel: 'TRAVERSE',
  'multi-strike': 'MULTI_TIMELINE_STRIKE',
  'strike-upgrade': 'MULTI_TIMELINE_STRIKE',
  'upgrade-strike': 'MULTI_TIMELINE_STRIKE',
  locate: 'LOCATE',
  'deep-cover': 'DEEP_COVER',
  deepcover: 'DEEP_COVER',
  strikereport: 'STRIKE_REPORT',
  'strike-report': 'STRIKE_REPORT',
  encryption: 'ENCRYPTION',
  recon: 'RAPID_RECON',
  'rapid-recon': 'RAPID_RECON',
  rapidrecon: 'RAPID_RECON',
  prepare: 'PREPARE_ACTION',
  'prepare-action': 'PREPARE_ACTION',
};

const COMMAND_MANUALS: Record<string, string> = {
  help: 'help: show the public command reference.',
  man: 'man [command]: show detailed usage for one command.',
  clear: 'clear: wipe the terminal transcript and keep the shell banner.',
  pwd: 'pwd: print the current command context path.',
  whoami: 'whoami: print the current shell identity.',
  status: 'status: show round, turn, intel, selected period, and selected agent.',
  history: 'history: list recent raw commands without the shell prompt.',
  date: 'date: print real-world time and current round.',
  uname: 'uname: print a short CHRONODOX system signature.',
  intel: 'intel: print shared intel reserves for past, present, and future.',
  selfplay: [
    'selfplay:',
    '  selfplay run [n] [difficulty]    run headless AI-vs-AI matches locally and store them in the training dataset',
    '  selfplay status     show the latest self-play batch summary',
    'Legacy aliases still work: selfplay-run, selfplay-status.',
  ].join('\n'),
  training: [
    'training:',
    '  training status     show recorded learning-data totals',
    '  training audit      show clean-vs-tainted training match counts',
    '  training export     download the recorded learning dataset',
    '  training clear      clear the saved browser-side training archive',
    'Legacy aliases still work: training-status, training-audit, training-export.',
  ].join('\n'),
  'selfplay-run': 'selfplay run [n] [difficulty]: run n headless AI-vs-AI matches locally. Difficulty accepts easy, normal, or hard.',
  'selfplay-status': 'selfplay status: show the latest self-play batch summary.',
  'training-status': 'training-status: show stored learning-data counts for recorded matches.',
  'training-clear': 'training-clear: alias for training clear.',
  'training-audit': 'training-audit: show whether the current or stored matches were tainted by sudo/su usage.',
  'training-export': 'training-export: download the recorded learning dataset as JSON.',
  queue: 'queue: show pending turn-state items such as pass confirmation, turn-advance prompts, or AI activity.',
  abort: 'abort: cancel pending traversal, password prompt, pass confirmation, or next-round wait.',
  repeat: 'repeat: rerun the most recent non-repeat command.',
  undo: 'undo: revert the most recent in-turn action or purchase before the turn is passed.',
  tail: 'tail [n]: show the latest visible notifications. Default is 5.',
  grep: 'grep [text]: search terminal output and visible notifications for matching text.',
  echo: 'echo [text]: print text back into the shell output.',
  agents: 'agents [period] [--all]: list your agents. If omitted, period defaults to the selected context.',
  ls: 'ls [period]: list agents in a period. ls with a selected agent lists adjacent cities.',
  map: 'map [period]: list cities in one period. If omitted, period defaults to the selected context.',
  select: 'select [period] [agent-tag] or select [agent-tag]: select an agent from the shell. Agent tags like A1/A2 work globally.',
  use: 'use [agent-tag]: select an agent by tag, with period optional.',
  cd: 'cd [period]: change the shell period context.',
  scan: 'scan: summarize the selected agent, nearby routes, and local threats.',
  routes: 'routes [city]: show connected destinations from a city or the selected agent city.',
  'locate-report': 'locate-report: summarize currently revealed enemy positions and uncertainty.',
  killfeed: 'killfeed: show elimination, paradox, and collapse events only.',
  node: 'node [city]: show linked timeline cities for a shared traversal node.',
  handoff: 'handoff unlock or handoff lock: root-only testing toggle for the manual switch button in local 2P.',
  pass: 'pass: confirm and consume remaining actions as wait to continue immediately.',
  move: '[period] [agent-tag] move [city], [agent-tag] move [city], or move [city] with a selected agent.',
  wait: '[period] [agent-tag] wait, [agent-tag] wait, or wait with a selected agent.',
  control: '[period] [agent-tag] control, [agent-tag] control, or control with a selected agent.',
  strike: '[period] [agent-tag] strike, [agent-tag] strike, or strike with a selected agent.',
  traverse: '[period] [agent-tag] traverse [period], [agent-tag] traverse [period], or travel [period] with a selected agent.',
  'multi-strike': '[period] [agent-tag] multi-strike, [agent-tag] multi-strike, or multi-strike with a selected agent to buy the permanent strike upgrade.',
  locate: '[period] [agent-tag] locate, [agent-tag] locate, or locate with a selected agent.',
  'deep-cover': '[period] [agent-tag] deep-cover, [agent-tag] deep-cover, or deep-cover with a selected agent.',
  'strike-report': '[period] [agent-tag] strike-report, [agent-tag] strike-report, or strike-report with a selected agent.',
  encryption: '[period] [agent-tag] encryption, [agent-tag] encryption, or encryption with a selected agent.',
  recon: '[period] [agent-tag] recon, [agent-tag] recon, or recon with a selected agent.',
  prepare: '[period] [agent-tag] prepare, [agent-tag] prepare, or prepare with a selected agent.',
  exit: 'exit: leave the root shell when using su.',
  logout: 'logout: alias for exit.',
  su: 'su: request the root shell. Password required unless already authenticated.',
  sudo: 'sudo [command]: run one root-only command after password verification. The password itself is never shown in help.',
  passwd: 'passwd: root-only. Verify the current password, then enter a new root password.',
  add: 'add intel [period] [number] or add intel [number], and add action [period] [agent] [number] or add action [number]: root-only injection command using selected context when omitted.',
};

const HELP_LINES = [
  'help: show command reference',
  'man [command]: show detailed usage for one command',
  'clear: clear terminal transcript',
  'pwd: show current command context',
  'whoami: show current shell identity',
  'status: show round, turn, intel, and selection state',
  'history: show recent raw commands',
  'date: show real time and current round',
  'uname: show terminal system signature',
  'intel: show intel pools',
  'Operators: cmd1 | cmd2, cmd1 ; cmd2, cmd1 && cmd2, cmd1 || cmd2',
  'queue: show pending turn-state information',
  'abort: cancel pending traversal/password/pass state',
  'repeat: rerun the last command',
  'undo: revert the most recent in-turn action before the turn ends',
  'su: request the root shell',
  'sudo [command]: run a single root-only command',
  'passwd: root-only password change flow',
  'add intel [period] [number] or add intel [number], and add action [period] [agent] [number] or add action [number]: root-only inject command',
  'tail [n]: show latest visible notifications',
  'grep [text]: search shell output and notifications',
  'echo [text]: print a line of text',
  'agents [period] [--all]: list your agents (defaults to selected period)',
  'ls [period]: list agents in a timeline',
  'map [period]: list cities in a timeline (defaults to selected period)',
  'select [period] [agent-tag] or select [agent-tag]: select an agent from the terminal',
  'use [agent-tag]: select an agent by tag in any period',
  'cd [period]: change the shell period context',
  'scan: summarize the selected agent and local situation',
  'routes [city]: show connected destinations',
  'locate-report: summarize known enemy locations',
  'killfeed: show elimination and collapse events',
  'node [city]: show linked timeline cities for a traversal node',
  'handoff unlock|lock: root-only local-2P testing toggle for manual switching',
  'pass: confirm and consume remaining actions as WAIT to continue immediately',
  '[period] [agent-tag] move [city], [agent-tag] move [city], or move [city]',
  '[period] [agent-tag] wait, [agent-tag] wait, or wait',
  '[period] [agent-tag] control, [agent-tag] control, or control',
  '[period] [agent-tag] strike, [agent-tag] strike, or strike',
  '[period] [agent-tag] traverse [period], [agent-tag] traverse [period], or travel [period]',
  '[period] [agent-tag] multi-strike, [agent-tag] multi-strike, or multi-strike',
  '[period] [agent-tag] locate, [agent-tag] locate, or locate',
  '[period] [agent-tag] deep-cover, [agent-tag] deep-cover, or deep-cover',
  '[period] [agent-tag] strike-report, [agent-tag] strike-report, or strike-report',
  '[period] [agent-tag] encryption, [agent-tag] encryption, or encryption',
  '[period] [agent-tag] recon, [agent-tag] recon, or recon',
  '[period] [agent-tag] prepare, [agent-tag] prepare, or prepare',
  'exit/logout: leave root shell when using su',
  '=========== AI Training Commands ===========',
  'selfplay run [n] [difficulty]: run headless AI-vs-AI matches for training',
  'selfplay status: show latest self-play batch summary',
  'selfplay-run [n]: legacy alias for selfplay run [n]',
  'selfplay-status: legacy alias for selfplay status',
  'training status: show recorded AI-training dataset totals',
  'training audit: show clean-vs-tainted training match counts',
  'training export: download the recorded AI-training dataset',
  'training clear: clear the saved browser training archive',
  'training-status: show recorded AI-training dataset totals',
  'training-audit: show clean-vs-tainted training match counts',
  'training-export: download the recorded AI-training dataset',
  'training-clear: clear the saved browser training archive',
  '=========== Common Aliases ===========',
  'mv: alias for move',
  'travel: alias for traverse',
  'strike-upgrade / upgrade-strike: aliases for multi-strike',
  'deepcover: alias for deep-cover',
  'strikereport: alias for strike-report',
  'rapid-recon: alias for recon',
];

function normalizeToken(token: string) {
  return token.trim().toLowerCase();
}

function parseSelfPlayRunArgs(args: string[]) {
  let count = 10;
  let difficulty: AiDifficulty | null = null;

  for (const token of args) {
    const parsedDifficulty = parseAiDifficulty(token);
    if (parsedDifficulty) {
      difficulty = parsedDifficulty;
      continue;
    }
    const parsedCount = Number(token);
    if (Number.isFinite(parsedCount) && parsedCount > 0) {
      count = Math.floor(parsedCount);
      continue;
    }
    return { error: 'Use: selfplay run [n] [difficulty]. Difficulty may be easy, normal, or hard.' };
  }

  return { count, difficulty };
}

function parsePeriod(token?: string): TimePeriod | null {
  if (!token) return null;
  return PERIOD_ALIASES[normalizeToken(token)] ?? null;
}

function sortAgents(agents: Agent[]) {
  return [...agents].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function getPlayerAgents(context: TerminalCommandContext) {
  return context.game.players[context.localPlayer].agents;
}

export function getAgentsForPeriod(context: TerminalCommandContext, period: TimePeriod) {
  return sortAgents(getPlayerAgents(context).filter(agent => agent.currentPeriod === period));
}

function getOrderedPlayerAgents(context: TerminalCommandContext) {
  return [...getPlayerAgents(context)].sort((a, b) =>
    a.createdAt - b.createdAt
    || TIME_ORDER.indexOf(a.period) - TIME_ORDER.indexOf(b.period)
    || a.id.localeCompare(b.id));
}

function getAgentAliasIndex(context: TerminalCommandContext, target: Agent) {
  return getOrderedPlayerAgents(context).findIndex(agent => agent.id === target.id);
}

export function getSelectedAgent(context: TerminalCommandContext) {
  return context.selectedAgentId
    ? getPlayerAgents(context).find(agent => agent.id === context.selectedAgentId) ?? null
    : null;
}

function getContextPeriod(context: TerminalCommandContext) {
  return getSelectedAgent(context)?.currentPeriod ?? context.selectedPeriod;
}

function getImplicitSelectedAgent(context: TerminalCommandContext, period?: TimePeriod) {
  const selected = getSelectedAgent(context);
  if (!selected) return null;
  if (period && selected.currentPeriod !== period) return null;
  return selected;
}

export function formatAgentAlias(agent: Agent, _index: number, context?: TerminalCommandContext) {
  if (!context) return agent.id;
  const aliasIndex = getAgentAliasIndex(context, agent);
  return aliasIndex >= 0 ? `A${aliasIndex + 1}` : agent.id;
}

function resolveAgentToken(context: TerminalCommandContext, period?: TimePeriod, token?: string): Agent | null {
  if (!token) return null;
  const normalized = normalizeToken(token);
  const agents = period ? getAgentsForPeriod(context, period) : getOrderedPlayerAgents(context);

  if (/^a\d+$/.test(normalized)) {
    const index = Number(normalized.slice(1)) - 1;
    const aliased = getOrderedPlayerAgents(context)[index] ?? null;
    if (!aliased) return null;
    return period ? (aliased.currentPeriod === period ? aliased : null) : aliased;
  }

  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized) - 1;
    return agents[index] ?? null;
  }

  const selected = context.selectedAgentId
    ? agents.find(agent => agent.id === context.selectedAgentId) ?? null
    : null;
  if (normalized === 'selected') return selected;

  return agents.find(agent => normalizeToken(agent.id) === normalized) ?? null;
}

function formatAgentName(agent: Agent, context: TerminalCommandContext) {
  const alias = formatAgentAlias(agent, 0, context);
  return `${alias} ${agent.period}->${agent.currentPeriod}`;
}

export function findCityByName(context: TerminalCommandContext, period: TimePeriod, rawName: string) {
  const needle = normalizeToken(rawName);
  return [...context.game.map.cities.values()].find(city =>
    city.period === period && normalizeToken(city.name) === needle
  ) ?? null;
}

function getTraversalDestinationsForAgent(context: TerminalCommandContext, agent: Agent) {
  const sourceCity = context.game.map.cities.get(agent.cityId);
  if (!sourceCity?.isNode || !sourceCity.nodeId) return [];

  return (['PAST', 'PRESENT', 'FUTURE'] as TimePeriod[])
    .filter(period => period !== agent.currentPeriod)
    .map(period => ({
      period,
      city: getNodeCitiesForPeriod(context.game.map, sourceCity.nodeId!, period) ?? null,
    }))
    .filter(option => Boolean(option.city && !option.city.destroyed));
}

function resolveActionFromSelection(
  context: TerminalCommandContext,
  tokens: string[],
  normalized: string[],
): ParsedTerminalCommand | null {
  const selectedAgent = getSelectedAgent(context);
  if (!selectedAgent) return null;

  const actionType = ACTION_ALIASES[normalized[0]];
  if (!actionType) return null;

  if (actionType === 'MOVE') {
    const cityName = tokens.slice(1).join(' ');
    if (!cityName) return { kind: 'invalid', message: 'Use: move [city name].' };
    const targetCity = findCityByName(context, selectedAgent.currentPeriod, cityName);
    if (!targetCity || targetCity.destroyed) return { kind: 'invalid', message: `No city named "${cityName}" in ${selectedAgent.currentPeriod}.` };
    const connected = getConnectedCities(context.game.map, selectedAgent.cityId);
    if (!connected.includes(targetCity.id)) {
      return { kind: 'invalid', message: `${targetCity.name} is not adjacent to ${context.game.map.cities.get(selectedAgent.cityId)?.name ?? 'current city'}.` };
    }
    const action: Omit<GameAction, 'id'> = {
      type: 'MOVE',
      agentId: selectedAgent.id,
      owner: context.localPlayer,
      targetCityId: targetCity.id,
    };
    return { kind: 'action', action, summary: `${formatAgentName(selectedAgent, context)} moving to ${targetCity.name}` };
  }

  if (actionType === 'TRAVERSE') {
    const destinations = getTraversalDestinationsForAgent(context, selectedAgent);
    if (destinations.length === 0) {
      return { kind: 'invalid', message: 'Traversal requires a shared node with at least one linked destination timeline.' };
    }
    const targetPeriod = parsePeriod(normalized[1]);
    if (!targetPeriod) {
      return { kind: 'invalid', message: `Use: ${normalized[0]} [past|present|future].` };
    }
    if (!destinations.some(option => option.period === targetPeriod)) {
      return { kind: 'invalid', message: `${targetPeriod} is not reachable from this node.` };
    }
    const action: Omit<GameAction, 'id'> = {
      type: actionType,
      agentId: selectedAgent.id,
      owner: context.localPlayer,
      targetPeriod,
    };
    return { kind: 'action', action, summary: `${formatAgentName(selectedAgent, context)} ${normalized[0]} ${targetPeriod}` };
  }

  const action: Omit<GameAction, 'id'> = {
    type: actionType,
    agentId: selectedAgent.id,
    owner: context.localPlayer,
  };
  return { kind: 'action', action, summary: `${formatAgentName(selectedAgent, context)} ${normalized[0]}` };
}

export function getHelpLines() {
  return HELP_LINES;
}

export function getManualLines(command?: string) {
  if (!command) {
    return [
      'man [command]',
      'Use `help` for the public command list.',
    ];
  }
  const key = normalizeToken(command);
  const line = COMMAND_MANUALS[key];
  return line ? line.split('\n') : [`No manual entry for ${command}.`];
}

export function parseTerminalCommand(rawInput: string, context: TerminalCommandContext): ParsedTerminalCommand {
  const input = rawInput.trim();
  if (!input) return { kind: 'invalid', message: 'No command entered.' };

  const tokens = input.split(/\s+/);
  const normalized = tokens.map(normalizeToken);

  if (normalized[0] === 'help') return { kind: 'help' };
  if (normalized[0] === 'man') return { kind: 'man', command: tokens[1] };
  if (normalized[0] === 'clear') return { kind: 'clear' };
  if (normalized[0] === 'pwd') return { kind: 'pwd' };
  if (normalized[0] === 'whoami') return { kind: 'whoami' };
  if (normalized[0] === 'status') return { kind: 'status' };
  if (normalized[0] === 'history') return { kind: 'history' };
  if (normalized[0] === 'date') return { kind: 'date' };
  if (normalized[0] === 'uname') return { kind: 'uname' };
  if (normalized[0] === 'intel') return { kind: 'intel' };
  if (normalized[0] === 'selfplay-run') {
    const parsed = parseSelfPlayRunArgs(tokens.slice(1));
    return 'error' in parsed
      ? { kind: 'invalid', message: parsed.error ?? 'Use: selfplay run [n] [difficulty].' }
      : { kind: 'selfplay-run', ...parsed };
  }
  if (normalized[0] === 'selfplay-status') return { kind: 'selfplay-status' };
  if (normalized[0] === 'selfplay') {
    if (normalized[1] === 'run') {
      const parsed = parseSelfPlayRunArgs(tokens.slice(2));
      return 'error' in parsed
        ? { kind: 'invalid', message: parsed.error ?? 'Use: selfplay run [n] [difficulty].' }
        : { kind: 'selfplay-run', ...parsed };
    }
    if (normalized[1] === 'status') return { kind: 'selfplay-status' };
    return { kind: 'invalid', message: 'Use: selfplay run [n] [difficulty] or selfplay status.' };
  }
  if (normalized[0] === 'training') {
    if (normalized[1] === 'status') return { kind: 'training-status' };
    if (normalized[1] === 'audit') return { kind: 'training-audit' };
    if (normalized[1] === 'export') return { kind: 'training-export' };
    if (normalized[1] === 'clear') return { kind: 'training-clear' };
    return { kind: 'invalid', message: 'Use: training status, training audit, training export, or training clear.' };
  }
  if (normalized[0] === 'training-status') return { kind: 'training-status' };
  if (normalized[0] === 'training-audit') return { kind: 'training-audit' };
  if (normalized[0] === 'training-export') return { kind: 'training-export' };
  if (normalized[0] === 'queue') return { kind: 'queue' };
  if (normalized[0] === 'abort') return { kind: 'abort' };
  if (normalized[0] === 'repeat') return { kind: 'repeat' };
  if (normalized[0] === 'undo') return { kind: 'undo' };
  if (normalized[0] === 'pass') return { kind: 'pass' };
  if (normalized[0] === 'next') return { kind: 'invalid', message: 'Command renamed. Use: pass.' };
  if (normalized[0] === 'exit') return { kind: 'exit' };
  if (normalized[0] === 'logout') return { kind: 'logout' };
  if (normalized[0] === 'passwd') return { kind: 'passwd' };
  if (normalized[0] === 'echo') return { kind: 'echo', text: rawInput.slice(rawInput.indexOf('echo') + 4).trimStart() };
  if (normalized[0] === 'grep') {
    const query = rawInput.slice(rawInput.indexOf('grep') + 4).trim();
    return query ? { kind: 'grep', query } : { kind: 'invalid', message: 'Use: grep [text].' };
  }
  if (normalized[0] === 'tail') {
    const maybeCount = Number(tokens[1] === '-n' ? tokens[2] : tokens[1]);
    return { kind: 'tail', count: Number.isFinite(maybeCount) && maybeCount > 0 ? Math.floor(maybeCount) : 5 };
  }
  if (normalized[0] === 'agents') {
    const matchedPeriodToken = normalized.find(token => parsePeriod(token) !== null);
    return {
      kind: 'agents',
      period: matchedPeriodToken ? parsePeriod(matchedPeriodToken) ?? undefined : getContextPeriod(context),
      verbose: normalized.includes('--all'),
    };
  }
  if (normalized[0] === 'map') {
    return { kind: 'map', period: parsePeriod(normalized[1]) ?? getContextPeriod(context) };
  }
  if (normalized[0] === 'cd') {
    const period = parsePeriod(normalized[1]);
    return period ? { kind: 'cd', period } : { kind: 'invalid', message: 'Use: cd [past|present|future].' };
  }
  if (normalized[0] === 'select') {
    const explicitPeriod = parsePeriod(normalized[1]);
    const agentToken = explicitPeriod ? normalized[2] : normalized[1];
    const agentLabel = explicitPeriod ? tokens[2] : tokens[1];
    const agent = resolveAgentToken(context, explicitPeriod ?? undefined, agentToken);
    if (!agent) {
      return {
        kind: 'invalid',
        message: explicitPeriod
          ? `No controllable agent matched "${agentLabel ?? ''}" in ${explicitPeriod}.`
          : `No controllable agent matched "${agentLabel ?? ''}".`,
      };
    }
    return { kind: 'select', period: explicitPeriod ?? agent.currentPeriod, agentId: agent.id };
  }
  if (normalized[0] === 'use') {
    const agent = resolveAgentToken(context, undefined, normalized[1]);
    if (!agent) return { kind: 'invalid', message: `No controllable agent matched "${tokens[1] ?? ''}".` };
    return { kind: 'use', period: agent.currentPeriod, agentId: agent.id };
  }
  if (normalized[0] === 'ls') {
    const maybePeriod = parsePeriod(normalized[1]);
    if (maybePeriod) return { kind: 'ls', period: maybePeriod };
    return { kind: 'ls', city: tokens.slice(1).join(' ') || undefined };
  }
  if (normalized[0] === 'scan') return { kind: 'scan' };
  if (normalized[0] === 'routes') return { kind: 'routes', city: tokens.slice(1).join(' ') || undefined };
  if (normalized[0] === 'locate-report') return { kind: 'locate-report' };
  if (normalized[0] === 'killfeed') return { kind: 'killfeed' };
  if (normalized[0] === 'node') return { kind: 'node', query: tokens.slice(1).join(' ') || undefined };
  if (normalized[0] === 'handoff') {
    if (normalized[1] === 'unlock') return { kind: 'handoff-debug', enabled: true };
    if (normalized[1] === 'lock') return { kind: 'handoff-debug', enabled: false };
    return { kind: 'invalid', message: 'Use: handoff unlock or handoff lock.' };
  }
  if (normalized[0] === 'add') {
    const resource = normalized[1];
    if (resource === 'intel') {
      const explicitPeriod = parsePeriod(normalized[2]);
      const period = explicitPeriod ?? getContextPeriod(context);
      const amountToken = explicitPeriod ? tokens[3] : tokens[2];
      const amount = Number(amountToken);
      if (!Number.isFinite(amount)) {
        return { kind: 'invalid', message: 'Use: add intel [past|present|future] [number] or add intel [number].' };
      }
      return { kind: 'add', resource, period, amount };
    }
    if (resource === 'action') {
      const explicitPeriod = parsePeriod(normalized[2]);
      const period = explicitPeriod ?? getContextPeriod(context);
      const selectedAgent = getImplicitSelectedAgent(context, period);

      if (!explicitPeriod && selectedAgent && Number.isFinite(Number(tokens[2]))) {
        return { kind: 'add', resource, period, agentId: selectedAgent.id, amount: Number(tokens[2]) };
      }

      const agentToken = explicitPeriod ? normalized[3] : normalized[2];
      const amountToken = explicitPeriod ? tokens[4] : tokens[3];
      const agent = resolveAgentToken(context, explicitPeriod ?? undefined, agentToken) ?? selectedAgent;
      const amount = Number(amountToken);
      if (!agent || !Number.isFinite(amount)) {
        return { kind: 'invalid', message: 'Use: add action [past|present|future] [agent] [number], add action [agent] [number], or add action [number].' };
      }
      return { kind: 'add', resource, period: explicitPeriod ?? agent.currentPeriod, agentId: agent.id, amount };
    }
    return { kind: 'invalid', message: 'Use: add intel [past|present|future] [number], add intel [number], add action [past|present|future] [agent] [number], add action [agent] [number], or add action [number].' };
  }

  const selectedAction = resolveActionFromSelection(context, tokens, normalized);
  if (selectedAction) return selectedAction;

  const period = parsePeriod(normalized[0]);
  if (!period) {
    const tagAgent = resolveAgentToken(context, undefined, normalized[0]);
    const tagAction = ACTION_ALIASES[normalized[1]];
    if (!tagAgent || !tagAction) {
      return { kind: 'invalid', message: 'Command must start with a period, an agent tag like A1, a known command, or use a selected agent context.' };
    }

    if (tagAction === 'MOVE') {
      const cityName = tokens.slice(2).join(' ');
      if (!cityName) return { kind: 'invalid', message: 'Use: [agent-tag] move [city name] or move [city name].' };
      const targetCity = findCityByName(context, tagAgent.currentPeriod, cityName);
      if (!targetCity || targetCity.destroyed) return { kind: 'invalid', message: `No city named "${cityName}" in ${tagAgent.currentPeriod}.` };
      const connected = getConnectedCities(context.game.map, tagAgent.cityId);
      if (!connected.includes(targetCity.id)) {
        return { kind: 'invalid', message: `${targetCity.name} is not adjacent to ${context.game.map.cities.get(tagAgent.cityId)?.name ?? 'current city'}.` };
      }
      return {
        kind: 'action',
        action: { type: 'MOVE', agentId: tagAgent.id, owner: context.localPlayer, targetCityId: targetCity.id },
        summary: `${formatAgentName(tagAgent, context)} moving to ${targetCity.name}`,
      };
    }

    if (tagAction === 'TRAVERSE') {
      const destinations = getTraversalDestinationsForAgent(context, tagAgent);
      if (destinations.length === 0) {
        return { kind: 'invalid', message: 'Traversal requires a shared node with at least one linked destination timeline.' };
      }
      const targetPeriod = parsePeriod(normalized[2]);
      if (!targetPeriod) {
        return { kind: 'invalid', message: `Use: ${tokens[0]} ${tokens[1]} [past|present|future].` };
      }
      if (!destinations.some(option => option.period === targetPeriod)) {
        return { kind: 'invalid', message: `${targetPeriod} is not reachable from this node.` };
      }
      return {
        kind: 'action',
        action: { type: tagAction, agentId: tagAgent.id, owner: context.localPlayer, targetPeriod },
        summary: `${formatAgentName(tagAgent, context)} ${normalized[1]} ${targetPeriod}`,
      };
    }

    return {
      kind: 'action',
      action: { type: tagAction, agentId: tagAgent.id, owner: context.localPlayer },
      summary: `${formatAgentName(tagAgent, context)} ${normalized[1]}`,
    };
  }

  const selectedAgent = getImplicitSelectedAgent(context, period);
  const implicitAgentCommand = selectedAgent && Boolean(ACTION_ALIASES[normalized[1]]);
  const agent = implicitAgentCommand ? selectedAgent : resolveAgentToken(context, period, normalized[1]);
  if (!agent) {
    return { kind: 'invalid', message: `No controllable agent matched "${tokens[1] ?? ''}" in ${period}.` };
  }

  const opToken = implicitAgentCommand ? normalized[1] : normalized[2];
  const actionType = ACTION_ALIASES[opToken];
  if (!actionType) {
    return { kind: 'invalid', message: `Unknown operation "${(implicitAgentCommand ? tokens[1] : tokens[2]) ?? ''}".` };
  }

  if (actionType === 'MOVE') {
    const cityName = tokens.slice(implicitAgentCommand ? 2 : 3).join(' ');
    if (!cityName) return { kind: 'invalid', message: 'Use: [period] [agent] move [city name], [period] move [city name], or move [city name].' };
    const targetCity = findCityByName(context, period, cityName);
    if (!targetCity || targetCity.destroyed) return { kind: 'invalid', message: `No city named "${cityName}" in ${period}.` };
    const connected = getConnectedCities(context.game.map, agent.cityId);
    if (!connected.includes(targetCity.id)) {
      return { kind: 'invalid', message: `${targetCity.name} is not adjacent to ${context.game.map.cities.get(agent.cityId)?.name ?? 'current city'}.` };
    }
    const action: Omit<GameAction, 'id'> = {
      type: 'MOVE',
      agentId: agent.id,
      owner: context.localPlayer,
      targetCityId: targetCity.id,
    };
    return { kind: 'action', action, summary: `${formatAgentName(agent, context)} moving to ${targetCity.name}` };
  }

  if (actionType === 'TRAVERSE') {
    const destinations = getTraversalDestinationsForAgent(context, agent);
    if (destinations.length === 0) {
      return { kind: 'invalid', message: 'Traversal requires a shared node with at least one linked destination timeline.' };
    }
    const targetPeriod = parsePeriod(implicitAgentCommand ? normalized[2] : normalized[3]);
    if (!targetPeriod) {
      return { kind: 'invalid', message: `Use: [period] [agent] ${opToken} [past|present|future], [period] ${opToken} [past|present|future], or ${opToken} [past|present|future].` };
    }
    if (!destinations.some(option => option.period === targetPeriod)) {
      return { kind: 'invalid', message: `${targetPeriod} is not reachable from this node.` };
    }
    const action: Omit<GameAction, 'id'> = {
      type: actionType,
      agentId: agent.id,
      owner: context.localPlayer,
      targetPeriod,
    };
    return { kind: 'action', action, summary: `${formatAgentName(agent, context)} ${opToken} ${targetPeriod}` };
  }

  const action: Omit<GameAction, 'id'> = {
    type: actionType,
    agentId: agent.id,
    owner: context.localPlayer,
  };
  return { kind: 'action', action, summary: `${formatAgentName(agent, context)} ${opToken}` };
}

function baseSuggestions(): TerminalSuggestion[] {
  return [
    { value: 'help', description: 'Show command reference' },
    { value: 'man', description: 'Show one command manual' },
    { value: 'status', description: 'Show shell and mission state' },
    { value: 'pwd', description: 'Show current context' },
    { value: 'whoami', description: 'Show current shell identity' },
    { value: 'clear', description: 'Clear transcript' },
    { value: 'date', description: 'Show current date and round' },
    { value: 'uname', description: 'Show system signature' },
    { value: 'intel', description: 'Show intel pools' },
    { value: 'selfplay run 10 normal', description: 'Run 10 headless AI-vs-AI matches on normal' },
    { value: 'selfplay status', description: 'Show latest self-play batch summary' },
    { value: 'training status', description: 'Show recorded learning-data totals' },
    { value: 'training audit', description: 'Show taint status for training data' },
    { value: 'training export', description: 'Download recorded learning data' },
    { value: 'queue', description: 'Show pending state' },
    { value: 'abort', description: 'Cancel pending prompt/state' },
    { value: 'repeat', description: 'Rerun last command' },
    { value: 'undo', description: 'Revert the most recent in-turn action' },
    { value: 'passwd', description: 'Change the root password' },
    { value: 'add intel past 20', description: 'Root inject intel into a timeline' },
    { value: 'add action A1 2', description: 'Root inject actions into an agent by tag' },
    { value: 'tail', description: 'Show latest notifications' },
    { value: 'grep', description: 'Search shell output' },
    { value: 'echo', description: 'Print text' },
    { value: 'history', description: 'Show recent commands' },
    { value: 'agents', description: 'List your agents' },
    { value: 'map', description: 'List cities' },
    { value: 'select', description: 'Select agent from shell' },
    { value: 'use', description: 'Use an agent in current period' },
    { value: 'cd', description: 'Change shell period' },
    { value: 'ls', description: 'List agents or adjacent cities' },
    { value: 'scan', description: 'Summarize selected agent context' },
    { value: 'routes', description: 'Show connected destinations' },
    { value: 'locate-report', description: 'Summarize enemy location intel' },
    { value: 'killfeed', description: 'Show elimination events' },
    { value: 'node', description: 'Show linked traversal nodes' },
    { value: 'pass', description: 'Confirm and consume remaining waits' },
    { value: 'past', description: 'Start a timeline command' },
    { value: 'present', description: 'Start a timeline command' },
    { value: 'future', description: 'Start a timeline command' },
  ];
}

function actionSuggestions() {
  return [
    { value: 'move', description: 'Move to an adjacent city' },
    { value: 'wait', description: 'Hide and hold position' },
    { value: 'control', description: 'Capture the current city' },
    { value: 'strike', description: 'Attack at the current city' },
    { value: 'travel', description: 'Traverse to another timeline' },
    { value: 'multi-strike', description: 'Buy the permanent strike upgrade' },
    { value: 'locate', description: 'Reveal enemies in the current timeline' },
    { value: 'deep-cover', description: 'Harden against detection' },
    { value: 'strike-report', description: 'Reveal enemy strikers this round' },
    { value: 'encryption', description: 'Obscure intel activity' },
    { value: 'recon', description: 'Rapid recon sweep' },
    { value: 'prepare', description: '+1 action next round' },
  ];
}

export function buildTerminalSuggestions(rawInput: string, context: TerminalCommandContext): TerminalSuggestion[] {
  const input = rawInput.trimStart();
  const tokens = input.split(/\s+/).filter(Boolean);
  const normalized = tokens.map(normalizeToken);

  if (tokens.length === 0) return baseSuggestions();

  if (normalized[0] === 'sudo') return [];

  if (['help', 'pass', 'undo', 'exit', 'logout', 'clear', 'pwd', 'whoami', 'status', 'history', 'date', 'uname', 'intel', 'selfplay-status', 'training-status', 'training-audit', 'training-export', 'queue', 'abort', 'repeat', 'scan', 'locate-report', 'killfeed', 'passwd'].includes(normalized[0])) {
    return [];
  }

  if (normalized[0] === 'selfplay') {
    if (!normalized[1]) {
      return [
        { value: 'selfplay run 10 normal', description: 'Run 10 headless AI-vs-AI matches on normal' },
        { value: 'selfplay status', description: 'Show latest self-play batch summary' },
      ];
    }
    if (normalized[1] === 'run') {
      return [
        { value: 'selfplay run 10 easy', description: 'Run 10 AI-vs-AI matches on easy' },
        { value: 'selfplay run 25 normal', description: 'Run 25 AI-vs-AI matches on normal' },
        { value: 'selfplay run 50 hard', description: 'Run 50 AI-vs-AI matches on hard' },
        { value: 'selfplay run 100 hard', description: 'Run 100 AI-vs-AI matches on hard' },
      ];
    }
    if (normalized[1] === 'status') return [];
  }

  if (normalized[0] === 'selfplay-run') {
    return [
      { value: 'selfplay-run 10 easy', description: 'Run 10 AI-vs-AI matches on easy' },
      { value: 'selfplay-run 25 normal', description: 'Run 25 AI-vs-AI matches on normal' },
      { value: 'selfplay-run 50 hard', description: 'Run 50 AI-vs-AI matches on hard' },
      { value: 'selfplay-run 100 hard', description: 'Run 100 AI-vs-AI matches on hard' },
    ];
  }

  if (normalized[0] === 'training') {
    if (!normalized[1]) {
      return [
        { value: 'training status', description: 'Show recorded learning-data totals' },
        { value: 'training audit', description: 'Show clean-vs-tainted training match counts' },
        { value: 'training export', description: 'Download recorded learning data' },
        { value: 'training clear', description: 'Clear saved browser-side training data' },
      ];
    }
    if (['status', 'audit', 'export'].includes(normalized[1])) return [];
  }

  if (normalized[0] === 'add') {
    if (normalized[1] === 'intel') {
      if (!parsePeriod(normalized[2]) && !Number.isFinite(Number(tokens[2]))) {
        return (['past', 'present', 'future'] as const).map(period => ({
          value: `add intel ${period}`,
          description: `Inject intel into ${period.toUpperCase()}`,
        }));
      }
      if (!parsePeriod(normalized[2]) && Number.isFinite(Number(tokens[2]))) {
        return [];
      }
      return [10, 20, 40].map(amount => ({
        value: `add intel ${normalized[2]} ${amount}`,
        description: `Inject ${amount} intel`,
      }));
    }
    if (normalized[1] === 'action') {
      const selectedAgent = getImplicitSelectedAgent(context);
      if (selectedAgent && Number.isFinite(Number(tokens[2]))) {
        return [];
      }
      const period = parsePeriod(normalized[2]);
      if (!period) {
        const contextPeriod = getContextPeriod(context);
        return [
          ...(selectedAgent ? [1, 2, 3].map(amount => ({
            value: `add action ${amount}`,
            description: `Inject ${amount} actions into selected agent`,
          })) : []),
          ...getAgentsForPeriod(context, contextPeriod).map((agent, index) => ({
            value: `add action ${formatAgentAlias(agent, index, context)}`,
            description: `Target ${agent.period}->${agent.currentPeriod} in ${contextPeriod}`,
          })),
          ...(['past', 'present', 'future'] as const).map(item => ({
            value: `add action ${item}`,
            description: `Target ${item.toUpperCase()} agent`,
          })),
        ];
      }
      if (!normalized[3]) {
        return getAgentsForPeriod(context, period).map((agent, index) => ({
          value: `add action ${normalized[2]} ${formatAgentAlias(agent, index, context)}`,
          description: `${agent.period}->${agent.currentPeriod} at ${context.game.map.cities.get(agent.cityId)?.name ?? 'unknown'}`,
        }));
      }
      return [1, 2, 3].map(amount => ({
        value: `add action ${normalized[2]} ${normalized[3]} ${amount}`,
        description: `Inject ${amount} actions`,
      }));
    }
    return [
      { value: 'add intel past 20', description: 'Inject intel into a timeline' },
      { value: 'add action A1 2', description: 'Inject actions into a specific agent' },
    ];
  }

  if (normalized[0] === 'man') {
    return Object.keys(COMMAND_MANUALS).map(command => ({
      value: `man ${command}`,
      description: COMMAND_MANUALS[command].split('\n')[0],
    }));
  }

  if (normalized[0] === 'agents') {
    return [
      { value: 'agents', description: `List agents in ${getContextPeriod(context)}` },
      ...(['past', 'present', 'future'] as const).map(period => ({
        value: `agents ${period}`,
        description: `List controllable agents in ${period.toUpperCase()}`,
      })),
      { value: 'agents --all', description: 'List all agents with richer detail' },
    ];
  }

  if (normalized[0] === 'map' || normalized[0] === 'cd') {
    return [
      ...(normalized[0] === 'map' ? [{ value: 'map', description: `List cities in ${getContextPeriod(context)}` }] : []),
      ...(['past', 'present', 'future'] as const).map(period => ({
        value: `${normalized[0]} ${period}`,
        description: `${normalized[0] === 'cd' ? 'Change to' : 'List'} ${period.toUpperCase()}`,
      })),
    ];
  }

  if (normalized[0] === 'select') {
    const period = parsePeriod(normalized[1]);
    if (!period) {
      const contextPeriod = getContextPeriod(context);
      return [
        ...getAgentsForPeriod(context, contextPeriod).map((agent, index) => ({
          value: `select ${formatAgentAlias(agent, index, context)}`,
          description: `Select ${agent.period}->${agent.currentPeriod} in ${contextPeriod}`,
        })),
        ...(['past', 'present', 'future'] as const).map(item => ({
          value: `select ${item}`,
          description: `Select an agent from ${item.toUpperCase()}`,
        })),
      ];
    }
    return getAgentsForPeriod(context, period).map((agent, index) => ({
      value: `select ${normalized[1]} ${formatAgentAlias(agent, index, context)}`,
      description: `${agent.period}->${agent.currentPeriod} at ${context.game.map.cities.get(agent.cityId)?.name ?? 'unknown'}`,
    }));
  }

  if (normalized[0] === 'use') {
    return getAgentsForPeriod(context, context.selectedPeriod).map((agent, index) => ({
      value: `use ${formatAgentAlias(agent, index, context)}`,
      description: `${agent.period}->${agent.currentPeriod} at ${context.game.map.cities.get(agent.cityId)?.name ?? 'unknown'}`,
    }));
  }

  if (normalized[0] === 'ls') {
    const selected = getSelectedAgent(context);
    if (selected) {
      const connected = getConnectedCities(context.game.map, selected.cityId)
        .map(id => context.game.map.cities.get(id))
        .filter((city): city is NonNullable<typeof city> => Boolean(city));
      return [
        ...(['past', 'present', 'future'] as const).map(item => ({
          value: `ls ${item}`,
          description: `List agents in ${item.toUpperCase()}`,
        })),
        ...connected.map(city => ({
          value: `ls ${city.name}`,
          description: `Inspect adjacency around ${city.name}`,
        })),
      ];
    }
    return (['past', 'present', 'future'] as const).map(item => ({
      value: `ls ${item}`,
      description: `List agents in ${item.toUpperCase()}`,
    }));
  }

  if (normalized[0] === 'routes' || normalized[0] === 'node') {
    return [...context.game.map.cities.values()]
      .filter(city => city.period === context.selectedPeriod)
      .slice(0, 12)
      .map(city => ({
        value: `${normalized[0]} ${city.name}`,
        description: `${normalized[0] === 'routes' ? 'Show routes from' : 'Inspect node at'} ${city.name}`,
      }));
  }

  if (normalized[0] === 'tail') {
    return [5, 10, 20].map(count => ({ value: `tail ${count}`, description: `Show latest ${count} visible notifications` }));
  }

  if (normalized[0] === 'grep') {
    return [{ value: 'grep strike', description: 'Search for strike lines' }];
  }

  if (normalized[0] === 'echo') {
    return [{ value: 'echo ready', description: 'Print a shell line' }];
  }

  const selectedAction = getSelectedAgent(context) && ACTION_ALIASES[normalized[0]];
  if (selectedAction) {
    if (selectedAction === 'MOVE') {
      const selectedAgent = getSelectedAgent(context)!;
      const connected = getConnectedCities(context.game.map, selectedAgent.cityId)
        .map(id => context.game.map.cities.get(id))
        .filter((city): city is NonNullable<typeof city> => Boolean(city));
      return connected.map(city => ({
        value: `${normalized[0]} ${city.name}`,
        description: `Adjacent move to ${city.name}`,
      }));
    }
    if (selectedAction === 'TRAVERSE') {
      const selectedAgent = getSelectedAgent(context)!;
      return getTraversalDestinationsForAgent(context, selectedAgent).map(option => ({
        value: `${normalized[0]} ${option.period.toLowerCase()}`,
        description: `Traverse to ${option.period}`,
      }));
    }
    return [];
  }

  const period = parsePeriod(normalized[0]);
  if (!period) {
    return baseSuggestions().filter(item => item.value.startsWith(normalized[0]));
  }

  if (tokens.length === 1) {
    return getAgentsForPeriod(context, period).map((agent, index) => ({
      value: `${normalized[0]} ${formatAgentAlias(agent, index, context)}`,
      description: `${agent.period}->${agent.currentPeriod} at ${context.game.map.cities.get(agent.cityId)?.name ?? 'unknown'}`,
    }));
  }

  const implicitAgentCommand = Boolean(getImplicitSelectedAgent(context, period) && ACTION_ALIASES[normalized[1]]);
  const agent = implicitAgentCommand ? getImplicitSelectedAgent(context, period) : resolveAgentToken(context, period, normalized[1]);
  if (!agent) {
    return getAgentsForPeriod(context, period).map((candidate, index) => ({
      value: `${normalized[0]} ${formatAgentAlias(candidate, index, context)}`,
      description: `${candidate.period}->${candidate.currentPeriod} at ${context.game.map.cities.get(candidate.cityId)?.name ?? 'unknown'}`,
    }));
  }

  if (!implicitAgentCommand && tokens.length === 2) {
    return actionSuggestions().map(item => ({
      value: `${normalized[0]} ${normalized[1]} ${item.value}`,
      description: item.description,
    }));
  }

  const op = ACTION_ALIASES[implicitAgentCommand ? normalized[1] : normalized[2]];
  if (!op) {
    return actionSuggestions()
      .filter(item => item.value.startsWith((implicitAgentCommand ? normalized[1] : normalized[2]) ?? ''))
      .map(item => ({
        value: implicitAgentCommand
          ? `${normalized[0]} ${item.value}`
          : `${normalized[0]} ${normalized[1]} ${item.value}`,
        description: item.description,
      }));
  }

  if (op === 'MOVE') {
    const connected = getConnectedCities(context.game.map, agent.cityId)
      .map(id => context.game.map.cities.get(id))
      .filter((city): city is NonNullable<typeof city> => Boolean(city));
    return connected.map(city => ({
      value: implicitAgentCommand ? `${normalized[0]} move ${city.name}` : `${normalized[0]} ${normalized[1]} move ${city.name}`,
      description: `Adjacent move to ${city.name}`,
    }));
  }

  if (op === 'TRAVERSE') {
    return getTraversalDestinationsForAgent(context, agent).map(option => ({
      value: implicitAgentCommand
        ? `${normalized[0]} ${normalized[1]} ${option.period.toLowerCase()}`
        : `${normalized[0]} ${normalized[1]} ${normalized[2]} ${option.period.toLowerCase()}`,
      description: `Traverse to ${option.period}`,
    }));
  }

  return [];
}

export function formatAgentRoster(context: TerminalCommandContext, period?: TimePeriod, verbose = false) {
  const periods = period ? [period] : (['PAST', 'PRESENT', 'FUTURE'] as TimePeriod[]);
  const lines: string[] = [];

  for (const currentPeriod of periods) {
    const agents = getAgentsForPeriod(context, currentPeriod);
    lines.push(`${currentPeriod}:`);
    if (agents.length === 0) {
      lines.push('  none');
      continue;
    }
    for (const [index, agent] of agents.entries()) {
      const city = context.game.map.cities.get(agent.cityId);
      if (verbose) {
        lines.push(`  ${formatAgentAlias(agent, index, context)}  ${agent.period}->${agent.currentPeriod}  ${city?.name ?? '??'}  act=${agent.actionsRemaining}  cover=${agent.cover ? 'hidden' : 'revealed'}  past=${agent.period === 'PAST' ? 'yes' : 'no'}`);
      } else {
        lines.push(`  ${formatAgentAlias(agent, index, context)}  ${agent.period}->${agent.currentPeriod}  ${city?.name ?? '??'}  ${agent.actionsRemaining} act`);
      }
    }
  }

  return lines;
}

export function formatMapListing(context: TerminalCommandContext, period?: TimePeriod) {
  const periods = period ? [period] : (['PAST', 'PRESENT', 'FUTURE'] as TimePeriod[]);
  const lines: string[] = [];

  for (const currentPeriod of periods) {
    lines.push(`${currentPeriod}:`);
    const cities = [...context.game.map.cities.values()]
      .filter(city => city.period === currentPeriod)
      .sort((a, b) => a.x - b.x || a.y - b.y);
    for (const city of cities) {
      const tags = [
        city.isNode ? `node${city.nodeId ? `:${city.nodeId}` : ''}` : 'city',
        city.destroyed ? 'destroyed' : null,
        city.controlledBy ? `ctrl:${city.controlledBy}` : null,
      ].filter(Boolean).join(', ');
      lines.push(`  ${city.name}  (${tags || 'neutral'})`);
    }
  }

  return lines;
}
