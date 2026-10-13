// All sound is synthesised with Web Audio: no samples, no files.
// Music: an original lo-fi boom-bap loop, A minor, ~88 BPM, four bars.

const STEPS = 64; // 4 bars of 16ths
const SWING = 0.2; // fraction of a 16th that odd steps are pushed back
const LOOKAHEAD = 0.12; // seconds scheduled ahead
const TICK_MS = 30;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const N = { A3: 57, C4: 60, D4: 62, E4: 64, G4: 67, A4: 69, C5: 72, D5: 74, E5: 76, G5: 79,
  F3: 53, D3: 50, E3: 52, Gs3: 56, B3: 59 };

// Per-bar chord voicings and bass roots (Hz).
const CHORDS = [
  [N.A3, N.C4, N.E4, N.G4], // Am7
  [N.F3, N.A3, N.C4, N.E4], // Fmaj7
  [N.D3, N.F3, N.A3, N.C4], // Dm7
  [N.E3, N.Gs3, N.B3, N.D4] // E7
];
const BASS = [55, 87.31, 73.42, 82.41];

// Drum patterns per bar, 16 steps each. 1 = hit, 2 = ghost/soft.
const KICK = [
  '1000001000100000',
  '1000001000100100',
  '1000001000100000',
  '1001001000100010'
];
const SNARE = [
  '0000100000001000',
  '0000100000001000',
  '0000100000001000',
  '0000100000001010'
];
const OPEN = ['0000000000000010', '0000000000000000', '0000000000000010', '0000000000000000'];

// Lead riff: one note name per step ('' = rest), 16 steps per bar.
const LEAD = [
  ['E5', '', '', 'D5', '', 'C5', '', '', 'A4', '', '', 'C5', '', 'D5', '', ''],
  ['C5', '', '', 'A4', '', '', 'G4', '', 'A4', '', '', '', '', '', '', ''],
  ['D5', '', '', 'E5', '', '', 'G5', '', 'E5', '', 'D5', '', 'C5', '', '', ''],
  ['E5', '', '', '', 'D5', '', 'C5', '', 'A4', '', '', '', '', '', '', '']
];

export function createAudio() {
  let ctx = null;
  let master, musicBus, sfxBus, noiseBuf;
  let muted = false;
  let playing = false;
  let timer = null;
  let step = 0;
  let nextTime = 0;
  let level = 0;
  try { muted = localStorage.getItem('cali-muted') === '1'; } catch { /* storage unavailable */ }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.7;
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    musicBus.connect(comp);
    sfxBus.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function resume() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ---------- voices ----------
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function tone(bus, t, { type = 'sine', freq, to, a = 0.005, d = 0.15, peak = 0.3, lp }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
    env(g, t, a, peak, d);
    let out = o;
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      o.connect(f);
      out = f;
    }
    out.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }

  function noise(bus, t, { d = 0.1, peak = 0.2, type = 'highpass', freq = 6000, q = 0.7 }) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, 0.002, peak, d);
    s.connect(f);
    f.connect(g);
    g.connect(bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + d + 0.05);
  }

  const kick = (t) => {
    tone(musicBus, t, { freq: 140, to: 42, d: 0.28, peak: 0.9 });
    noise(musicBus, t, { d: 0.02, peak: 0.12, type: 'lowpass', freq: 800 });
  };
  const snare = (t, soft) => {
    const p = soft ? 0.18 : 0.5;
    noise(musicBus, t, { d: 0.16, peak: p, type: 'bandpass', freq: 1900, q: 0.8 });
    tone(musicBus, t, { type: 'triangle', freq: 210, to: 150, d: 0.1, peak: p * 0.7 });
  };
  const hat = (t, accent, open) =>
    noise(musicBus, t, { d: open ? 0.22 : 0.04, peak: open ? 0.14 : accent ? 0.12 : 0.06, freq: 7500 });

  // Rhodes-ish stab: sine plus a bell-like partial, through a soft lowpass.
  const chord = (t, notes, len) => {
    for (const m of notes) {
      const f = mtof(m);
      tone(musicBus, t, { freq: f, a: 0.008, d: len, peak: 0.07, lp: 1800 });
      tone(musicBus, t, { type: 'triangle', freq: f * 2, a: 0.004, d: len * 0.35, peak: 0.02, lp: 2600 });
    }
  };
  const bass = (t, f, len) =>
    tone(musicBus, t, { freq: f, a: 0.01, d: len, peak: 0.42, lp: 300 });
  const lead = (t, m, len) => {
    const f = mtof(m);
    tone(musicBus, t, { type: 'square', freq: f, a: 0.006, d: len, peak: 0.05, lp: 2400 });
    tone(musicBus, t, { type: 'triangle', freq: f, a: 0.006, d: len, peak: 0.07 });
  };

  // ---------- sequencer ----------
  function secPerStep() {
    const bpm = Math.min(88 + level * 2, 112);
    return 60 / bpm / 4;
  }

  function scheduleStep(i, t) {
    const bar = Math.floor(i / 16);
    const s = i % 16;
    const len = secPerStep();
    if (KICK[bar][s] === '1') kick(t);
    if (SNARE[bar][s] === '1') snare(t, false);
    // Ghost snare just before the backbeat on the last bar.
    if (bar === 3 && s === 14) snare(t, true);
    if (s % 2 === 0) hat(t, s % 4 === 0, false);
    if (OPEN[bar][s] === '1') hat(t, true, true);
    if (s === 0) bass(t, BASS[bar], len * 6);
    if (s === 6) bass(t, BASS[bar], len * 3);
    if (s === 10) bass(t, BASS[bar] * (bar === 3 ? 1.5 : 1), len * 4);
    if (s === 2 || s === 7 || s === 10) chord(t, CHORDS[bar], len * (s === 2 ? 4 : 2.5));
    const note = LEAD[bar][s];
    if (note) lead(t, N[note], len * 2.2);
    // Vinyl dust.
    if (Math.random() < 0.08) noise(musicBus, t + Math.random() * len, { d: 0.01, peak: 0.05, freq: 3000 });
  }

  function pump() {
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      const swing = step % 2 === 1 ? secPerStep() * SWING : 0;
      scheduleStep(step, nextTime + swing);
      nextTime += secPerStep();
      step = (step + 1) % STEPS;
    }
  }

  function startMusic() {
    resume();
    if (!ctx || playing) return;
    playing = true;
    step = 0;
    nextTime = ctx.currentTime + 0.08;
    timer = setInterval(pump, TICK_MS);
  }
  function stopMusic() {
    playing = false;
    clearInterval(timer);
    timer = null;
  }

  // ---------- sound effects ----------
  const sfxTable = {
    move: (t) => tone(sfxBus, t, { type: 'square', freq: 220, d: 0.025, peak: 0.05, lp: 1500 }),
    rotate: (t) => tone(sfxBus, t, { type: 'square', freq: 440, to: 660, d: 0.05, peak: 0.07, lp: 2500 }),
    lock: (t) => {
      tone(sfxBus, t, { freq: 110, to: 55, d: 0.12, peak: 0.5 });
      noise(sfxBus, t, { d: 0.05, peak: 0.1, type: 'lowpass', freq: 1200 });
    },
    clear: (t) => [0, 4, 7, 12].forEach((s, i) =>
      tone(sfxBus, t + i * 0.06, { type: 'square', freq: mtof(69 + s), d: 0.12, peak: 0.07, lp: 3000 })),
    tetris: (t) => {
      // Rising siren sweep, then a big stab.
      tone(sfxBus, t, { type: 'sawtooth', freq: 220, to: 1760, a: 0.01, d: 0.45, peak: 0.1, lp: 3000 });
      [0, 4, 7, 12, 16].forEach((s, i) =>
        tone(sfxBus, t + 0.4 + i * 0.07, { type: 'square', freq: mtof(69 + s), d: 0.2, peak: 0.08, lp: 3500 }));
      kick(t + 0.4);
    },
    levelup: (t) => [0, 3, 7, 10, 14].forEach((s, i) =>
      tone(sfxBus, t + i * 0.08, { type: 'triangle', freq: mtof(64 + s), d: 0.25, peak: 0.12 })),
    gameover: (t) => [0, -2, -5, -9, -14].forEach((s, i) =>
      tone(sfxBus, t + i * 0.22, { type: 'triangle', freq: mtof(69 + s), d: 0.4, peak: 0.16, lp: 1500 })),
    start: (t) => [0, 7, 12].forEach((s, i) =>
      tone(sfxBus, t + i * 0.07, { type: 'square', freq: mtof(60 + s), d: 0.15, peak: 0.07, lp: 3000 }))
  };

  function sfx(name) {
    if (!ctx || ctx.state !== 'running') return;
    const fn = sfxTable[name];
    if (fn) fn(ctx.currentTime + 0.005);
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('cali-muted', m ? '1' : '0'); } catch { /* storage unavailable */ }
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.02);
  }

  return {
    resume, startMusic, stopMusic, sfx,
    setLevel: (l) => { level = l; },
    setMuted,
    toggleMute: () => { setMuted(!muted); return muted; },
    get muted() { return muted; },
    // Duck the music while paused without losing the loop position.
    pause: () => { if (ctx && ctx.state === 'running') ctx.suspend(); },
    unpause: () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  };
}
