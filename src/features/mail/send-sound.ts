import { useEffect, useRef } from 'react';

const sounds = {
  send: [
    { offset: 0, from: 980, peak: 1630, to: 1260, duration: .12, gain: .065 },
    { offset: .13, from: 1390, peak: 2110, to: 1710, duration: .12, gain: .065 },
  ],
  archive: [{ offset: 0, from: 420, peak: 590, to: 510, duration: .105, gain: .052 }],
  trash: [
    { offset: 0, from: 295, peak: 270, to: 135, duration: .15, gain: .06 },
    { offset: .022, from: 170, peak: 138, to: 82, duration: .125, gain: .032 },
  ],
};

export function useMailSounds() {
  const audio = useRef<AudioContext | null>(null);
  const resume = useRef<Promise<void> | undefined>(undefined);

  useEffect(() => () => {
    const context = audio.current;
    audio.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }, []);

  function prepare() {
    try {
      if (!window.AudioContext) return;
      const context = audio.current ??= new AudioContext();
      if (context.state !== 'running') resume.current = context.resume().catch(() => {});
    } catch {
      // Browsers can make audio unavailable. Mail actions still work in silence.
    }
  }

  async function play(effect: keyof typeof sounds) {
    const context = audio.current;
    if (context && context.state !== 'running') await resume.current;
    if (context?.state !== 'running') return;

    const start = context.currentTime + 0.015;
    for (const { offset, from, peak, to, duration, gain } of sounds[effect]) {
      const time = start + offset;
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.frequency.setValueAtTime(from, time);
      tone.frequency.exponentialRampToValueAtTime(peak, time + duration * .375);
      tone.frequency.exponentialRampToValueAtTime(to, time + duration);
      volume.gain.setValueAtTime(.001, time);
      volume.gain.linearRampToValueAtTime(gain, time + duration * .23);
      volume.gain.exponentialRampToValueAtTime(.001, time + duration);
      tone.connect(volume).connect(context.destination);
      tone.onended = () => { tone.disconnect(); volume.disconnect(); };
      tone.start(time);
      tone.stop(time + duration + .005);
    }
  }

  return { prepare, play };
}
