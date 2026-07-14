// ── KEYLESS BACKEND: procedural music synth (server-only, Node Buffer) ───────
// Runs inside /api/generate when there's no REPLICATE_API_TOKEN. It turns the
// prompt + instrument tags into real audio, and uses an absolute time base
// (step * seconds) so consecutive chunks are consecutive bars of the SAME chord
// progression — i.e. it evolves and stays continuous across the seam, exactly
// like the real continuation loop. Swap in a token and the route uses MusicGen
// instead; nothing else changes.

type SynthArgs = { prompt: string; seconds: number; step: number };

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// deterministic white noise in [-1,1] from an integer index
function hashNoise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export function synthesizeWav({ prompt, seconds, step }: SynthArgs): Buffer {
  const sr = 22050;
  const p = (prompt || "").toLowerCase();
  const has = (re: RegExp) => re.test(p);

  // instrument tags → layers
  const bass = has(/bass/);
  const drums = has(/drum|beat|kick|percuss/);
  const keys = has(/piano|keys|rhodes/);
  const synth = has(/synth|pad/);
  const guitar = has(/guitar/);
  const strings = has(/string|violin|orchestr|cello/);
  const crackle = has(/vinyl|lo-?fi|crackle|tape/);

  // tempo: explicit "N bpm" wins, else infer from mood words
  let bpm = 90;
  const m = p.match(/(\d{2,3})\s*bpm/);
  if (m) bpm = Math.min(180, Math.max(50, parseInt(m[1], 10)));
  else if (has(/intense|energetic|fast|dnb|techno|hard|driving/)) bpm = 140;
  else if (has(/chill|mellow|lo-?fi|slow|ambient|calm|dream/)) bpm = 75;

  const major = has(/happy|bright|uplift|major|joy|sunny|hopeful/);
  const brightness = has(/bright|intense|synth|energetic|hard/) ? 1 : 0.4;
  const padLevel = synth || strings ? 0.12 : 0.055; // always some harmonic bed

  const beat = 60 / bpm;
  const bar = beat * 4;

  // [bass root, then chord tones] per step of a 4-chord loop
  const minorProg = [
    [45, 57, 60, 64], // Am
    [41, 53, 57, 60], // F
    [48, 55, 60, 64], // C
    [43, 55, 59, 62], // G
  ];
  const majorProg = [
    [48, 60, 64, 67], // C
    [43, 55, 59, 62], // G
    [45, 57, 60, 64], // Am
    [41, 53, 57, 60], // F
  ];
  const prog = major ? majorProg : minorProg;

  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const t0 = step * seconds; // absolute start → continuity across chunks

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const T = t0 + t;
    const ci = ((Math.floor(T / bar) % prog.length) + prog.length) % prog.length;
    const chord = prog[ci];
    let v = 0;

    // BASS — plucked root each beat
    if (bass) {
      const f = midiToFreq(chord[0]);
      const ph = T % beat;
      const env = Math.exp(-ph * 4);
      v += 0.5 * env * (Math.sin(2 * Math.PI * f * T) + 0.3 * Math.sin(4 * Math.PI * f * T));
    }

    // PAD — sustained chord bed (always on, quiet; louder if synth/strings tagged)
    {
      let s = 0;
      for (let k = 1; k < chord.length; k++) {
        const f = midiToFreq(chord[k]);
        s += Math.sin(2 * Math.PI * f * T) + brightness * 0.4 * Math.sin(4 * Math.PI * f * T);
      }
      const lfo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.2 * T);
      v += padLevel * lfo * s;
    }

    // KEYS — plucky arpeggio over the chord
    if (keys) {
      const sub = beat / 2;
      const idx = Math.floor(T / sub) % 3;
      const f = midiToFreq(chord[1 + idx]);
      const env = Math.exp(-(T % sub) * 6);
      v += 0.28 * env * Math.sin(2 * Math.PI * f * T);
    }

    // GUITAR — offbeat pluck, octave up
    if (guitar) {
      const idx = Math.floor(T / beat) % 3;
      const f = midiToFreq(chord[1 + idx] + 12);
      const env = Math.exp(-((T + beat / 2) % beat) * 5);
      v += 0.22 * env * (Math.sin(2 * Math.PI * f * T) + 0.25 * Math.sin(6 * Math.PI * f * T));
    }

    // DRUMS — kick every beat, hats on 8ths, snare on 2 & 4
    if (drums) {
      const kph = T % beat;
      if (kph < 0.18) {
        const env = Math.exp(-kph * 32);
        const f = 50 + 90 * Math.exp(-kph * 30);
        v += 0.8 * env * Math.sin(2 * Math.PI * f * kph);
      }
      const hph = T % (beat / 2);
      if (hph < 0.04) v += 0.12 * Math.exp(-hph * 90) * hashNoise(i);
      const bph = T % bar;
      const near = Math.min(Math.abs(bph - beat), Math.abs(bph - 3 * beat));
      if (near < 0.05) {
        const env = Math.exp(-near * 40);
        v += 0.35 * env * (hashNoise(i) * 0.8 + Math.sin(2 * Math.PI * 180 * T) * 0.2);
      }
    }

    // vinyl crackle / lo-fi hiss
    if (crackle) {
      if (hashNoise(i * 7) > 0.985) v += 0.15 * hashNoise(i * 13);
      v += 0.006 * hashNoise(i * 3);
    }

    out[i] = v;
  }

  // soft clip
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 0.9);

  // 8ms edge fades so chunk boundaries never click (crossfade covers the rest)
  const fade = Math.floor(sr * 0.008);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[n - 1 - i] *= g;
  }

  return encodeWav(out, sr);
}

function encodeWav(samples: Float32Array, sr: number): Buffer {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s * 32767) | 0, off);
    off += 2;
  }
  return buf;
}
