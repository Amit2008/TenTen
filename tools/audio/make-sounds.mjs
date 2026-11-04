// Synthesizes the game's original sound effects (T22). Run: node tools/audio/make-sounds.mjs
// Output: public/content/releases/1.1.0/audio/*.wav, 44.1 kHz mono 16-bit PCM. Deterministic: same bytes every run.
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 44100;
const OUT = 'public/content/releases/1.1.0/audio';

/** One voice: frequency glide, attack and exponential decay, optional 2nd harmonic. Returns samples from `start`. */
function tone({ start = 0, length, from, to = from, decay, attack = 0.004, harmonic = 0, shape = Math.sin }) {
  const samples = new Float32Array(Math.round((start + length) * RATE));
  let phase = 0;
  for (let i = Math.round(start * RATE); i < samples.length; i++) {
    const t = i / RATE - start;
    const hz = from + (to - from) * Math.min(1, t / length);
    phase += (2 * Math.PI * hz) / RATE;
    const envelope = Math.min(1, t / attack) * Math.exp(-t / decay);
    samples[i] = envelope * (shape(phase) + harmonic * Math.sin(2 * phase));
  }
  return samples;
}

/** A soft rounded triangle: warmer than a square, still buzzy enough to read as "no". */
const triangle = (p) => (2 / Math.PI) * Math.asin(Math.sin(p));

/** Deterministic noise burst for the wooden attack of "place". */
function tap(length, decay) {
  const samples = new Float32Array(Math.round(length * RATE));
  let seed = 2026;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] = (seed / 2 ** 31 - 1) * Math.exp(-i / RATE / decay);
  }
  return samples;
}

/** Sums voices, normalizes the peak to `peak`, and fades the last 5 ms so nothing clicks. */
function mix(voices, peak) {
  const out = new Float32Array(Math.max(...voices.map(([v]) => v.length)));
  for (const [voice, gain] of voices) voice.forEach((s, i) => (out[i] += s * gain));
  const max = Math.max(...out.map(Math.abs));
  const fade = Math.round(0.005 * RATE);
  return out.map((s, i) => (s / max) * peak * Math.min(1, (out.length - 1 - i) / fade));
}

function wav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return b;
}

const note = (start, hz, length, decay) => [tone({ start, length, from: hz, decay, harmonic: 0.25 }), 1];

const sounds = {
  // Short rising blip: the piece lifts.
  pick: mix([[tone({ length: 0.07, from: 620, to: 820, decay: 0.025 }), 1]], 0.35),
  // Low wooden "tock": a falling tone under a brief noise tap.
  place: mix([[tone({ length: 0.14, from: 240, to: 170, decay: 0.035, harmonic: 0.3 }), 1], [tap(0.03, 0.006), 0.25]], 0.5),
  // Bright rising arpeggio (C major: C5 E5 G5 C6).
  clear: mix([note(0, 523.25, 0.5, 0.16), note(0.06, 659.25, 0.5, 0.16), note(0.12, 783.99, 0.5, 0.18), note(0.18, 1046.5, 0.5, 0.22)], 0.5),
  // Two soft low pulses: the piece goes back.
  invalid: mix([[tone({ length: 0.09, from: 170, decay: 0.03, shape: triangle }), 1], [tone({ start: 0.11, length: 0.09, from: 150, decay: 0.03, shape: triangle }), 1]], 0.4),
  // Slow falling minor phrase (G4 Eb4 C4).
  game_over: mix([note(0, 392, 0.3, 0.12), note(0.22, 311.13, 0.3, 0.12), note(0.44, 261.63, 0.6, 0.25)], 0.5),
};

mkdirSync(OUT, { recursive: true });
for (const [name, samples] of Object.entries(sounds)) {
  writeFileSync(`${OUT}/${name}.wav`, wav(samples));
  console.log(`${OUT}/${name}.wav  ${(samples.length / RATE).toFixed(2)} s`);
}
