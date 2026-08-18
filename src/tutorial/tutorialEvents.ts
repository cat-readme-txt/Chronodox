import type { ActionType } from '../types/game';

export type TutorialEvent =
  | 'select-agent'
  | 'open-feed'
  | 'close-feed'
  | 'open-settings'
  | 'close-settings'
  | 'enable-terminal'
  | 'disable-terminal'
  | 'terminal-help'
  | 'terminal-training-status'
  | 'ai-demo-complete'
  | 'paradox-traverse'
  | 'continue-info'
  | 'move:traverse-node'
  | 'move:multi-strike-node'
  | 'move:final-strike-city'
  | `action:${ActionType}`;

export const TUTORIAL_EVENT_DESCRIPTIONS: Record<TutorialEvent, string> = {
  'select-agent': 'Select an agent',
  'open-feed': 'Open the intel feed',
  'close-feed': 'Close the intel feed',
  'open-settings': 'Open settings',
  'close-settings': 'Close settings',
  'enable-terminal': 'Enable terminal mode',
  'disable-terminal': 'Disable terminal mode',
  'terminal-help': 'Run `help` in the terminal',
  'terminal-training-status': 'Run `training status` in the terminal',
  'ai-demo-complete': 'Observe the enemy demo turn',
  'paradox-traverse': 'Traverse into the same destination period again to trigger a paradox',
  'continue-info': 'Continue after reading the tutorial note',
  'move:traverse-node': 'Move to the highlighted traversal node',
  'move:multi-strike-node': 'Move to the highlighted node',
  'move:final-strike-city': 'Move onto the highlighted enemy city',
  'action:MOVE': 'Perform MOVE',
  'action:WAIT': 'Perform WAIT',
  'action:CONTROL': 'Perform CONTROL',
  'action:STRIKE': 'Perform STRIKE',
  'action:TRAVERSE': 'Perform TRAVERSE',
  'action:LOCATE': 'Perform LOCATE',
  'action:STRIKE_REPORT': 'Perform STRIKE REPORT',
  'action:DEEP_COVER': 'Perform DEEP COVER',
  'action:PREPARE_ACTION': 'Perform PREPARE ACTION',
  'action:ENCRYPTION': 'Perform ENCRYPTION',
  'action:RAPID_RECON': 'Perform RAPID RECON',
  'action:MULTI_TIMELINE_STRIKE': 'Perform MULTI-T STRIKE',
};

export function getTutorialActionEvent(type: ActionType): TutorialEvent {
  return `action:${type}`;
}

export function getTutorialEventForTerminalInput(rawInput: string): TutorialEvent | null {
  const normalized = rawInput.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized === 'help') return 'terminal-help';
  if (normalized === 'training status') return 'terminal-training-status';
  return null;
}
