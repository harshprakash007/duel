/**
 * Web Audio API synthesizer for sound effects.
 * Synthesizes pure tones without external audio assets.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

export function playTone(
  frequency: number,
  durationSec: number,
  type: OscillatorType = 'sine',
  volume = 0.15,
): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + durationSec);
  } catch {
    // Gracefully ignore audio failures (e.g. autoplay policies)
  }
}

export function playMatchFound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
    setTimeout(() => playTone(freq, 0.25, 'triangle', 0.2), idx * 100);
  });
}

export function playCountdownTick(): void {
  playTone(800, 0.05, 'sine', 0.1);
}

export function playQuestionStart(): void {
  playTone(600, 0.1, 'sine', 0.15);
  setTimeout(() => playTone(880, 0.2, 'triangle', 0.2), 100);
}

export function playSolveAccepted(): void {
  playTone(523.25, 0.15, 'triangle', 0.2);
  setTimeout(() => playTone(659.25, 0.15, 'triangle', 0.2), 120);
  setTimeout(() => playTone(783.99, 0.35, 'triangle', 0.25), 240);
}

export function playPenalty(): void {
  playTone(220, 0.25, 'sawtooth', 0.15);
}

export function playVictory(): void {
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
    setTimeout(() => playTone(freq, 0.35, 'triangle', 0.25), idx * 130);
  });
}

export function playDefeat(): void {
  [440, 370, 311, 261.63].forEach((freq, idx) => {
    setTimeout(() => playTone(freq, 0.3, 'sawtooth', 0.12), idx * 140);
  });
}
