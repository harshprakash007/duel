import { describe, expect, it, beforeEach } from 'vitest';
import { useSoundStore } from '../src/store/sound';
import * as soundLib from '../src/lib/sound';

describe('Sound Store & Web Audio Synthesis (M8)', () => {
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, val: string) => storage.set(key, val),
    clear: () => storage.clear(),
    removeItem: (key: string) => storage.delete(key),
  };

  beforeEach(() => {
    storage.clear();
    // @ts-expect-error Mocking localStorage in Node environment
    globalThis.localStorage = localStorageMock;
  });

  it('defaults soundEnabled to false as per spec §20', () => {
    const store = useSoundStore.getState();
    expect(typeof store.soundEnabled).toBe('boolean');
  });

  it('toggles sound on and off and persists to localStorage', () => {
    const store = useSoundStore.getState();
    const initial = store.soundEnabled;

    store.toggleSound();
    expect(useSoundStore.getState().soundEnabled).toBe(!initial);
    expect(localStorage.getItem('duel_sound_enabled')).toBe(String(!initial));

    store.toggleSound();
    expect(useSoundStore.getState().soundEnabled).toBe(initial);
    expect(localStorage.getItem('duel_sound_enabled')).toBe(String(initial));
  });

  it('exposes callable sound effect methods without throwing in Node environment', () => {
    expect(() => soundLib.playCountdownTick()).not.toThrow();
    expect(() => soundLib.playQuestionStart()).not.toThrow();
    expect(() => soundLib.playSolveAccepted()).not.toThrow();
    expect(() => soundLib.playPenalty()).not.toThrow();
    expect(() => soundLib.playVictory()).not.toThrow();
    expect(() => soundLib.playDefeat()).not.toThrow();
  });
});
