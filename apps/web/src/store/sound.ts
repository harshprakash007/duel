import { create } from 'zustand';
import * as soundLib from '../lib/sound';

interface SoundState {
  soundEnabled: boolean;
  toggleSound: () => void;
  play: (fn: keyof typeof soundLib) => void;
}

const STORAGE_KEY = 'duel_sound_enabled';

export const useSoundStore = create<SoundState>((set, get) => {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  const initialEnabled = stored === 'true'; // Default false as per blueprint §20

  return {
    soundEnabled: initialEnabled,
    toggleSound: () => {
      const next = !get().soundEnabled;
      set({ soundEnabled: next });
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, String(next));
      }
      if (next) {
        soundLib.playTone(880, 0.1, 'sine', 0.1);
      }
    },
    play: (effectName) => {
      if (!get().soundEnabled) return;
      const fn = soundLib[effectName];
      if (typeof fn === 'function') {
        (fn as () => void)();
      }
    },
  };
});
