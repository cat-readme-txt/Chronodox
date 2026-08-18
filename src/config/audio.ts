export type MusicTrackId = 'silent' | 'starbound_solitude' | 'phantom_veil' | 'neon_ghostline';
export type SoundEffectId =
  | 'ui_click'
  | 'move_click'
  | 'stomp_impact'
  | 'warp_slide'
  | 'invalid_buzz'
  | 'paradox_alarm'
  | 'mission_success'
  | 'match_found_voice';

export interface MusicTrack {
  id: MusicTrackId;
  label: string;
  src: string | null;
  description: string;
}

export interface SoundEffect {
  id: SoundEffectId;
  src: string;
  label: string;
  startOffset?: number;
}

export const MUSIC_TRACKS: MusicTrack[] = [
  {
    id: 'silent',
    label: 'Silent Channel',
    src: null,
    description: 'No background transmission',
  },
  {
    id: 'starbound_solitude',
    label: 'Starbound Solitude',
    src: '/chronodox-menu-bgm.mp3',
    description: 'A distant, lonely drift through cold signal noise',
  },
  {
    id: 'phantom_veil',
    label: 'Phantom Veil',
    src: '/chronodox-phantom-veil.mp3',
    description: 'Slow-burn covert synth pulse',
  },
  {
    id: 'neon_ghostline',
    label: 'Neon Ghostline',
    src: '/chronodox-neon-ghostline.mp3',
    description: 'Sharper futurewave pursuit line',
  },
];

export const CONTEXT_MUSIC = {
  menu: {
    id: 'context_menu',
    src: '/chronodox-menu-bgm.mp3',
    label: 'Menu Channel',
  },
  matchFound: {
    id: 'context_match_found',
    src: '/chronodox-match-found-war.mp3',
    label: 'Match Found Staging',
  },
} as const;

export const SOUND_EFFECTS: SoundEffect[] = [
  { id: 'ui_click', src: '/chronodox-ui-select.wav', label: 'UI Select', startOffset: 0.006 },
  { id: 'move_click', src: '/chronodox-move-click.wav', label: 'Move Click' },
  { id: 'stomp_impact', src: '/chronodox-stomp-impact.wav', label: 'Stomp Impact' },
  { id: 'warp_slide', src: '/chronodox-warp-slide.wav', label: 'Warp Slide' },
  { id: 'invalid_buzz', src: '/chronodox-invalid-buzz.wav', label: 'Invalid Buzz' },
  { id: 'paradox_alarm', src: '/chronodox-paradox-occurred.mp3', label: 'Paradox Alarm' },
  { id: 'mission_success', src: '/chronodox-success-fanfare.mp3', label: 'Mission Success' },
  { id: 'match_found_voice', src: '/chronodox-match-found-voice.mp3', label: 'Match Found Voice' },
];

export const DEFAULT_MUSIC_TRACK_ID: MusicTrackId = 'starbound_solitude';
