import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { MUSIC_TRACKS } from '../config/audio';
import { useGameStore } from '../store/gameStore';

export function SettingsScreen() {
  const [showTrackChooser, setShowTrackChooser] = useState(false);
  const {
    settingsOpen, closeSettings, brightness, setBrightness,
    homeMusicTrackId, gameMusicTrackId, setHomeMusicTrack, setGameMusicTrack, musicVolume, setMusicVolume,
    sfxVolume, setSfxVolume, muteAllAudio, setMuteAllAudio,
    terminalMode, setTerminalMode, playSoundEffect,
  } = useGameStore();

  return (
    <AnimatePresence>
      {settingsOpen && (
        <motion.div
          className="absolute inset-0 z-50 bg-[#02050bf0] backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ x: '-100%', opacity: 0.7 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '-100%', opacity: 0.7 }}
            transition={{ type: 'spring', damping: 26, stiffness: 240 }}
            className="relative h-full w-full max-w-3xl border-r border-[#ffffff12] bg-[linear-gradient(180deg,#071019,#04060d)] p-6 shadow-[20px_0_80px_rgba(0,0,0,0.45)]"
            id="settings-panel"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <div className="font-['Orbitron'] text-xl tracking-[0.3em] text-[#d7ecff]">SETTINGS</div>
                <div className="mt-1 font-['Share_Tech_Mono'] text-[11px] text-[#ffffff55]">
                  Mission environment controls
                </div>
              </div>
              <button
                type="button"
                onClick={closeSettings}
                className="rounded border border-[#ffffff22] px-3 py-2 text-[11px] font-['Share_Tech_Mono'] text-[#ffffff88] transition-colors hover:text-white"
                id="settings-close"
              >
                CLOSE
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-[#7b4fd444] bg-[#0b1120cc] p-4">
                <div className="font-['Orbitron'] text-[11px] tracking-[0.24em] text-[#c9a8ff]">DISPLAY</div>
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between font-['Share_Tech_Mono'] text-[11px] text-[#ffffff88]">
                    <span>Brightness</span>
                    <span>{Math.round(brightness * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="70"
                    max="130"
                    value={Math.round(brightness * 100)}
                    onPointerDown={() => playSoundEffect('ui_click')}
                    onChange={(event) => setBrightness(Number(event.target.value) / 100)}
                    className="w-full accent-[#00d4ff]"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-[#00c8a033] bg-[#051018] p-4">
                <div className="font-['Orbitron'] text-[11px] tracking-[0.24em] text-[#8bf5da]">TERMINAL</div>
                <label className="mt-4 flex items-center justify-between rounded-xl border border-[#00c8a033] bg-[#04101a] px-4 py-3">
                  <div>
                    <div className="font-['Orbitron'] text-[11px] tracking-[0.18em] text-[#8bf5da]">TERMINAL MODE</div>
                    <div className="mt-1 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff55]">
                      Bottom terminal replaces the right-side command board
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTerminalMode(!terminalMode)}
                    className="rounded-full border px-3 py-1 text-[10px] font-['Orbitron'] tracking-[0.18em]"
                    id="settings-terminal-mode"
                    style={{
                      borderColor: terminalMode ? '#00c8a0' : '#ffffff22',
                      color: terminalMode ? '#8bf5da' : '#ffffff66',
                      backgroundColor: terminalMode ? '#00c8a01a' : 'transparent',
                    }}
                  >
                    {terminalMode ? 'ONLINE' : 'OFFLINE'}
                  </button>
                </label>
              </div>

              <div className="rounded-2xl border border-[#00d4ff33] bg-[#081018cc] p-4">
                <div className="font-['Orbitron'] text-[11px] tracking-[0.24em] text-[#8fdfff]">AUDIO</div>
                <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] leading-relaxed text-[#ffffff5f]">
                  Music volume and mute govern every ambient channel. Open the soundtrack drawer to choose home and mission tracks without using vertical space.
                </div>
                <button
                  type="button"
                  onClick={() => setShowTrackChooser(current => !current)}
                  className="mt-4 w-full rounded-xl border border-[#8df5df55] bg-[#061610cc] px-4 py-3 text-left transition-colors hover:bg-[#0a2318]"
                >
                  <div className="font-['Orbitron'] text-[10px] tracking-[0.16em] text-[#8df5df]">
                    {showTrackChooser ? 'HIDE SOUNDTRACK DRAWER' : 'OPEN SOUNDTRACK DRAWER'}
                  </div>
                  <div className="mt-1 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff60]">
                    Home: {MUSIC_TRACKS.find(track => track.id === homeMusicTrackId)?.label ?? 'Unknown'} | Mission: {MUSIC_TRACKS.find(track => track.id === gameMusicTrackId)?.label ?? 'Unknown'}
                  </div>
                </button>
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between font-['Share_Tech_Mono'] text-[11px] text-[#ffffff88]">
                    <span>Volume</span>
                    <span>{Math.round(musicVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(musicVolume * 100)}
                    onPointerDown={() => playSoundEffect('ui_click')}
                    onChange={(event) => setMusicVolume(Number(event.target.value) / 100)}
                    className="w-full accent-[#ff6b35]"
                  />
                </div>
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between font-['Share_Tech_Mono'] text-[11px] text-[#ffffff88]">
                    <span>SFX Volume</span>
                    <span>{Math.round(sfxVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(sfxVolume * 100)}
                    onPointerDown={() => playSoundEffect('ui_click')}
                    onChange={(event) => setSfxVolume(Number(event.target.value) / 100)}
                    className="w-full accent-[#00c8a0]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setMuteAllAudio(!muteAllAudio)}
                  className="mt-5 w-full rounded-xl border px-4 py-3 text-left transition-all"
                  style={{
                    borderColor: muteAllAudio ? '#ff6b3577' : '#ffffff18',
                    background: muteAllAudio ? '#ff6b3514' : '#07101988',
                  }}
                >
                  <div className="font-['Orbitron'] text-[11px] tracking-[0.16em] text-[#dff7ff]">
                    {muteAllAudio ? 'UNMUTE ALL AUDIO' : 'MUTE ALL AUDIO'}
                  </div>
                  <div className="mt-1 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff60]">
                    Controls music, sound effects, and upcoming audio layers together
                  </div>
                </button>
              </div>
            </div>

            <AnimatePresence>
              {showTrackChooser && (
                <motion.div
                  initial={{ opacity: 0, x: 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  className="absolute right-[-22rem] top-6 z-10 w-[20rem] rounded-[24px] border border-[#ffffff16] bg-[#07101ae8] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.48)]"
                >
                  <div className="font-['Orbitron'] text-[11px] tracking-[0.24em] text-[#dff7ff]">SOUNDTRACK DRAWER</div>
                  <div className="mt-2 font-['Share_Tech_Mono'] text-[10px] leading-relaxed text-[#ffffff60]">
                    Choose separate ambient channels for the home screen and live missions.
                  </div>
                  <div className="mt-4">
                    <div className="font-['Orbitron'] text-[10px] tracking-[0.16em] text-[#8df5df]">HOME CHANNEL</div>
                    <div className="mt-2 space-y-2">
                      {MUSIC_TRACKS.map(track => (
                        <button
                          key={`drawer-home-${track.id}`}
                          type="button"
                          onClick={() => setHomeMusicTrack(track.id)}
                          className="w-full rounded-xl border px-3 py-3 text-left transition-all"
                          style={{
                            borderColor: homeMusicTrackId === track.id ? '#8df5df77' : '#ffffff18',
                            background: homeMusicTrackId === track.id ? '#061610cc' : '#07101988',
                          }}
                        >
                          <div className="font-['Orbitron'] text-[11px] tracking-[0.14em] text-[#dff7ff]">{track.label}</div>
                          <div className="mt-1 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff60]">{track.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="font-['Orbitron'] text-[10px] tracking-[0.16em] text-[#8fdfff]">MISSION CHANNEL</div>
                    <div className="mt-2 space-y-2">
                      {MUSIC_TRACKS.map(track => (
                        <button
                          key={`drawer-game-${track.id}`}
                          type="button"
                          onClick={() => setGameMusicTrack(track.id)}
                          className="w-full rounded-xl border px-3 py-3 text-left transition-all"
                          style={{
                            borderColor: gameMusicTrackId === track.id ? '#00d4ff77' : '#ffffff18',
                            background: gameMusicTrackId === track.id ? '#00d4ff12' : '#07101988',
                          }}
                        >
                          <div className="font-['Orbitron'] text-[11px] tracking-[0.14em] text-[#dff7ff]">{track.label}</div>
                          <div className="mt-1 font-['Share_Tech_Mono'] text-[10px] text-[#ffffff60]">{track.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
