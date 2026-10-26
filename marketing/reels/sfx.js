// Synthesised sound effects for reels. Every sound is generated from code (seeded noise and
// oscillators), so the output is deterministic and free of licensing issues.
// mix(events, duration) → 16-bit stereo WAV buffer, where events = [[time, name, gain?], ...].
const SR = 44100;

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296 * 2 - 1; }; }
const TAU = Math.PI * 2;

// render a sound of `dur` seconds from a per-sample function f(t, p) where p = t / dur
function make(dur, f) { const n = Math.round(dur * SR), out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = f(i / SR, i / n); return out; }
// band-limited noise: one-pole low-pass then high-pass, cutoffs may vary over time
function bandNoise(dur, seed, lo, hi, amp) {
  const r = rng(seed); let lp = 0, lp2 = 0;
  return make(dur, (t, p) => {
    const a = 1 - Math.exp(-TAU * hi(p) / SR), b = 1 - Math.exp(-TAU * lo(p) / SR);
    lp += a * (r() - lp); lp2 += b * (lp - lp2);
    return (lp - lp2) * amp(t, p);
  });
}
// a decaying sine "bell" partial
const bell = (freq, decay) => t => Math.sin(TAU * freq * t) * Math.exp(-t * decay);

const SOUNDS = {
  whoosh: () => bandNoise(0.5, 1, p => 200 + 600 * Math.sin(Math.PI * p), p => 900 + 3500 * Math.sin(Math.PI * p), (t, p) => Math.pow(Math.sin(Math.PI * p), 2) * 1.2),
  swipe: () => bandNoise(0.25, 2, () => 900, p => 2500 + 3000 * p, (t, p) => Math.sin(Math.PI * p) * 1.0),
  pop: () => make(0.12, t => Math.sin(TAU * (260 * t + 700 / 40 * (1 - Math.exp(-t * 40)))) * Math.exp(-t * 38) * 0.85),
  tick: () => make(0.05, t => Math.sin(TAU * 2400 * t) * Math.exp(-t * 110) * 0.65),
  // rising chirp 380 → 900 Hz over 0.2 s
  hop: () => make(0.2, (t, p) => Math.sin(TAU * (380 * t + 520 * t * t / 0.4)) * Math.sin(Math.PI * p) * 0.3),
  thud: () => { const r = rng(3); return make(0.3, t => (Math.sin(TAU * 95 * t) * 0.9 + r() * Math.exp(-t * 300) * 0.4) * Math.exp(-t * 16)); },
  tap: () => { const r = rng(4); return make(0.05, t => (r() * Math.exp(-t * 600) * 0.5 + Math.sin(TAU * 1600 * t) * Math.exp(-t * 180) * 0.35)); },
  flip: () => bandNoise(0.45, 5, () => 1200, () => 5000, (t, p) => Math.sin(Math.PI * p) * (0.6 + 0.4 * Math.sin(TAU * 28 * t)) * 1.4),
  scratch: () => { const j = rng(6); let g = 0; return bandNoise(0.55, 7, () => 2200, () => 6000, (t, p) => { if (Math.round(t * SR) % 1500 === 0) g = 0.4 + 0.6 * Math.abs(j()); return g * Math.min(1, p * 8, (1 - p) * 8) * 0.9; }); },
  stamp: () => { const r = rng(8); return make(0.28, t => (Math.sin(TAU * 130 * t) * Math.exp(-t * 22) + r() * Math.exp(-t * 120) * 0.6) * 0.8); },
  ding: () => make(1.0, t => 0.22 * (bell(1046.5, 5)(t) + bell(1568, 6)(t) + (t > 0.09 ? bell(1318.5, 5)(t - 0.09) + bell(2093, 7)(t - 0.09) : 0))),
  wrong: () => make(0.36, t => { const f = t < 0.14 ? 330 : 233, tt = t < 0.14 ? t : t - 0.14; return Math.tanh(3 * Math.sin(TAU * f * t)) * Math.exp(-tt * 9) * 0.16; }),
  sparkle: () => make(0.8, t => [1046.5, 1318.5, 1568, 2093].reduce((s, f, i) => s + (t > i * 0.06 ? bell(f, 7)(t - i * 0.06) : 0), 0) * 0.16),
  shuffle: () => { const a = SOUNDS.flip(), out = new Float32Array(a.length + Math.round(0.24 * SR)); [0, 0.08, 0.16, 0.24].forEach(o => a.forEach((v, i) => { out[i + Math.round(o * SR)] += v * 0.6; })); return out; },
};
const cache = {};

function mix(events, duration) {
  const n = Math.ceil(duration * SR), buf = new Float32Array(n);
  for (const [at, name, gain = 1] of events) {
    if (!SOUNDS[name]) throw new Error(`unknown sound "${name}"`);
    const s = cache[name] || (cache[name] = SOUNDS[name]()), start = Math.round(at * SR);
    for (let i = 0; i < s.length && start + i < n; i++) if (start + i >= 0) buf[start + i] += s[i] * gain;
  }
  // gentle limiter, then normalise to about -3 dBFS (headroom for AAC)
  let peak = 0; for (let i = 0; i < n; i++) { buf[i] = Math.tanh(buf[i] * 1.2); peak = Math.max(peak, Math.abs(buf[i])); }
  const k = peak > 0 ? 0.7 / peak : 1;
  const wav = Buffer.alloc(44 + n * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(Math.max(-1, Math.min(1, buf[i] * k)) * 32767); wav.writeInt16LE(v, 44 + i * 4); wav.writeInt16LE(v, 46 + i * 4); }
  return wav;
}

module.exports = { mix, SOUNDS: Object.keys(SOUNDS) };
