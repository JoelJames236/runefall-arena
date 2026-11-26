// Fully synthesized audio: generative orchestral-style music and per-ability sound
// effects built from oscillators, filtered noise and a generated reverb.

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor() { this.ctx = null; this.track = null; this.musicVol = 0.6; this.sfxVol = 0.8; this.listener = { x: 0, z: 0, yaw: 0 }; this.last = {}; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createDynamicsCompressor();
    this.master.threshold.value = -14; this.master.ratio.value = 4;
    this.master.connect(C.destination);
    this.music = C.createGain(); this.music.gain.value = this.musicVol * 0.5; this.music.connect(this.master);
    this.sfx = C.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    this.reverb = C.createConvolver(); this.reverb.buffer = this.makeIR(3.2, 2.2);
    this.revSend = C.createGain(); this.revSend.gain.value = 0.9; this.revSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.sfxRev = C.createGain(); this.sfxRev.gain.value = 0.35; this.sfxRev.connect(this.reverb);
    this.noiseBuf = this.makeNoise();
    this.trackGains = {};
    this.scheduler = setInterval(() => this.schedule(), 50);
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.1);
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.1);
  }

  makeIR(sec, decay) {
    const C = this.ctx, len = Math.floor(C.sampleRate * sec), buf = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return buf;
  }
  makeNoise() {
    const C = this.ctx, len = C.sampleRate * 2, buf = C.createBuffer(1, len, C.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ------------------------------------------------------------ primitives
  env(g, t, a, peak, d, sustain = 0, rel = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (rel) { g.gain.setTargetAtTime(peak * sustain, t + a, d / 3); g.gain.setTargetAtTime(0.0001, t + a + d, rel / 4); }
    else g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  osc(type, f, t, dur, peak, dest, o = {}) {
    const C = this.ctx, os = C.createOscillator(), g = C.createGain();
    os.type = type; os.frequency.setValueAtTime(f, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.glide || dur));
    if (o.detune) os.detune.value = o.detune;
    let node = os;
    if (o.lp) { const fl = C.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; fl.Q.value = o.q || 0.7; os.connect(fl); node = fl; }
    node.connect(g); g.connect(dest);
    if (o.rev) g.connect(o.rev);
    this.env(g, t, o.a ?? 0.005, peak, dur, o.s, o.r);
    os.start(t); os.stop(t + dur + (o.r || 0) + 0.1);
    return os;
  }
  noise(t, dur, peak, dest, o = {}) {
    const C = this.ctx, src = C.createBufferSource(), f = C.createBiquadFilter(), g = C.createGain();
    src.buffer = this.noiseBuf; src.loop = true;
    f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f || 1000, t); f.Q.value = o.q ?? 1;
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    if (o.rev) g.connect(o.rev);
    this.env(g, t, o.a ?? 0.005, peak, dur);
    src.start(t, Math.random()); src.stop(t + dur + 0.1);
  }

  // spatial output node for a world position
  spatial(pos) {
    const C = this.ctx;
    const g = C.createGain(), p = C.createStereoPanner();
    let vol = 1, pan = 0;
    if (pos) {
      const L = this.listener, dx = pos.x - L.x, dz = pos.z - L.z, d = Math.hypot(dx, dz);
      vol = Math.max(0.25, 1 / (1 + d * 0.04));
      const rx = -Math.cos(L.yaw), rz = Math.sin(L.yaw);
      pan = d > 0.5 ? Math.max(-0.8, Math.min(0.8, (dx * rx + dz * rz) / d)) : 0;
    }
    g.gain.value = vol; p.pan.value = pan;
    g.connect(p); p.connect(this.sfx); g.connect(this.sfxRev);
    return g;
  }

  // ------------------------------------------------------------ SFX
  play(name, pos, opts = {}) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < 0.03) return; // dedupe bursts
    this.last[name] = now;
    const t = now + 0.005, o = this.spatial(pos), R = this.sfxRev;
    switch (name) {
      case 'ui_click': this.osc('triangle', 880, t, 0.08, 0.15, o, { to: 1320 }); break;
      case 'ui_hover': this.osc('sine', 1200, t, 0.05, 0.05, o); break;
      case 'error': this.osc('square', 140, t, 0.12, 0.05, o, { lp: 600 }); break;
      case 'cast_frost': case 'cast_arcane': case 'cast_holy': case 'cast_nature': case 'cast_fire': {
        const base = { cast_frost: 900, cast_arcane: 500, cast_holy: 660, cast_nature: 300, cast_fire: 400 }[name];
        this.noise(t, 0.6, 0.12, o, { f: base * 2, to: base * 5, q: 3, a: 0.2 });
        this.osc('sine', base, t, 0.7, 0.07, o, { to: base * 1.5, a: 0.25 });
        if (name === 'cast_holy') { this.osc('sine', base * 1.25, t, 0.8, 0.05, o, { a: 0.3 }); this.osc('sine', base * 1.5, t, 0.8, 0.05, o, { a: 0.35 }); }
        break; }
      case 'frost_lance': this.noise(t, 0.35, 0.3, o, { f: 3000, to: 6000, q: 2 }); this.osc('sine', 1600, t, 0.3, 0.1, o, { to: 900 }); break;
      case 'frost_hit': this.noise(t, 0.4, 0.4, o, { f: 5000, to: 1500, q: 1.5 }); this.osc('triangle', 2400, t, 0.15, 0.08, o); this.osc('triangle', 3100, t + 0.03, 0.15, 0.06, o); break;
      case 'fire_cast': case 'flame_burst': this.noise(t, 0.4, 0.45, o, { type: 'lowpass', f: 600, to: 3000, q: 1, a: 0.02 }); this.osc('sawtooth', 120, t, 0.3, 0.08, o, { to: 60, lp: 500 }); break;
      case 'fire_hit': this.noise(t, 0.5, 0.5, o, { type: 'lowpass', f: 2500, to: 300 }); this.osc('sine', 110, t, 0.35, 0.3, o, { to: 45 }); break;
      case 'glacial_nova': this.noise(t, 0.9, 0.5, o, { f: 6000, to: 1200, q: 0.8 }); this.osc('sine', 1800, t, 0.6, 0.12, o, { to: 600 }); this.osc('triangle', 2700, t + 0.05, 0.5, 0.06, o, { to: 1200 }); break;
      case 'arcane_shift': case 'blink': this.osc('sine', 300, t, 0.25, 0.25, o, { to: 1800 }); this.noise(t, 0.2, 0.2, o, { f: 2000, to: 8000, q: 2 }); break;
      case 'mana_ward': this.osc('sine', 440, t, 0.8, 0.12, o, { to: 660, rev: R }); this.osc('sine', 554, t + 0.05, 0.8, 0.1, o, { rev: R }); this.noise(t, 0.6, 0.12, o, { f: 1500, q: 5, a: 0.1 }); break;
      case 'arcane_comet': this.osc('sawtooth', 200, t, 0.8, 0.15, o, { to: 80, lp: 1200 }); this.noise(t, 0.9, 0.3, o, { f: 800, to: 200, q: 1.5, a: 0.1 }); break;
      case 'arcane_hit': this.noise(t, 1.2, 0.6, o, { type: 'lowpass', f: 3000, to: 200 }); this.osc('sine', 90, t, 1.0, 0.6, o, { to: 30 }); this.osc('sine', 880, t, 0.6, 0.12, o, { to: 220, rev: R }); break;
      case 'melee_hit': this.noise(t, 0.12, 0.5, o, { type: 'highpass', f: 1500 }); this.osc('sine', 160, t, 0.12, 0.35, o, { to: 60 }); break;
      case 'melee_heavy': this.noise(t, 0.2, 0.6, o, { type: 'lowpass', f: 2500, to: 400 }); this.osc('sine', 120, t, 0.25, 0.5, o, { to: 40 }); this.osc('triangle', 1900, t, 0.1, 0.08, o); break;
      case 'swing': this.noise(t, 0.18, 0.25, o, { f: 600, to: 2400, q: 1.5, a: 0.04 }); break;
      case 'dagger': this.noise(t, 0.1, 0.3, o, { f: 3000, to: 6000, q: 2 }); this.osc('triangle', 2600, t, 0.08, 0.06, o); break;
      case 'shield': this.osc('sine', 523, t, 0.6, 0.18, o, { rev: R }); this.osc('sine', 1340, t, 0.4, 0.12, o); this.osc('sine', 2130, t, 0.3, 0.08, o); this.noise(t, 0.08, 0.4, o, { type: 'highpass', f: 2000 }); break;
      case 'stun': this.osc('triangle', 1800, t, 0.15, 0.1, o, { to: 2400 }); this.osc('triangle', 2400, t + 0.12, 0.15, 0.08, o, { to: 1800 }); this.osc('sine', 200, t, 0.2, 0.3, o, { to: 80 }); break;
      case 'charge': this.noise(t, 0.5, 0.35, o, { type: 'lowpass', f: 300, to: 1200, a: 0.1 }); this.osc('sawtooth', 90, t, 0.5, 0.12, o, { lp: 400 }); break;
      case 'warcry': this.osc('sawtooth', 160, t, 0.5, 0.15, o, { to: 120, lp: 900 }); this.osc('sawtooth', 240, t, 0.5, 0.1, o, { to: 180, lp: 900 }); this.noise(t, 0.4, 0.15, o, { f: 600, q: 2 }); break;
      case 'tempest': this.noise(t, 1.0, 0.35, o, { f: 800, to: 2000, q: 3, a: 0.1 }); this.osc('sawtooth', 110, t, 1.0, 0.08, o, { lp: 600 }); break;
      case 'stealth': this.noise(t, 0.6, 0.3, o, { f: 400, to: 4000, q: 2, a: 0.5 }); this.osc('sine', 200, t, 0.5, 0.08, o, { to: 100, a: 0.3 }); break;
      case 'shadow': this.osc('sine', 150, t, 0.4, 0.3, o, { to: 600 }); this.noise(t, 0.3, 0.25, o, { f: 600, to: 200, q: 3 }); break;
      case 'mark': this.osc('sawtooth', 110, t, 0.8, 0.12, o, { to: 55, lp: 700, rev: R }); this.osc('sine', 660, t, 0.6, 0.08, o, { to: 330, rev: R }); break;
      case 'mark_pop': this.noise(t, 0.7, 0.5, o, { type: 'lowpass', f: 2000, to: 200 }); this.osc('sine', 80, t, 0.6, 0.5, o, { to: 30 }); this.osc('square', 220, t, 0.3, 0.06, o, { to: 110, lp: 1000 }); break;
      case 'holy_bolt': this.osc('sine', 880, t, 0.4, 0.12, o, { to: 1320, rev: R }); this.osc('sine', 1100, t, 0.4, 0.08, o, { rev: R }); this.noise(t, 0.3, 0.15, o, { f: 4000, q: 2 }); break;
      case 'holy_hit': this.osc('sine', 1320, t, 0.5, 0.12, o, { rev: R }); this.osc('sine', 1760, t, 0.5, 0.08, o, { rev: R }); this.noise(t, 0.2, 0.25, o, { f: 3000, to: 800 }); break;
      case 'heal': [523, 659, 784, 1047].forEach((f, i) => this.osc('sine', f, t + i * 0.06, 1.0, 0.09, o, { rev: R, a: 0.02 })); break;
      case 'aegis': this.osc('sine', 392, t, 1.0, 0.12, o, { rev: R, a: 0.05 }); this.osc('sine', 587, t + 0.05, 1.0, 0.1, o, { rev: R }); this.osc('sine', 784, t + 0.1, 0.9, 0.08, o, { rev: R }); break;
      case 'seraph': this.noise(t, 0.6, 0.25, o, { f: 2000, to: 6000, q: 1, a: 0.05 }); [784, 988, 1175].forEach((f, i) => this.osc('sine', f, t + i * 0.05, 0.5, 0.06, o, { rev: R })); break;
      case 'blinding': this.noise(t, 0.8, 0.4, o, { f: 6000, to: 2000, q: 0.5 }); [523, 659, 784, 1047, 1319].forEach((f, i) => this.osc('triangle', f, t, 1.2, 0.07, o, { rev: R })); break;
      case 'halo': this.noise(t, 1.0, 0.35, o, { f: 1000, to: 5000, q: 1 }); [392, 494, 587, 784].forEach((f, i) => this.osc('sawtooth', f, t + i * 0.04, 1.2, 0.05, o, { lp: 2500, rev: R })); this.osc('sine', 98, t, 0.8, 0.4, o, { to: 49 }); break;
      case 'lightning': this.noise(t, 0.35, 0.7, o, { type: 'highpass', f: 2500 }); for (let i = 0; i < 5; i++) this.noise(t + Math.random() * 0.25, 0.05, 0.5, o, { type: 'highpass', f: 4000 }); this.osc('sine', 70, t, 0.6, 0.5, o, { to: 35 }); break;
      case 'magma': this.noise(t, 0.4, 0.4, o, { type: 'lowpass', f: 400, to: 1500 }); this.osc('sawtooth', 70, t, 0.4, 0.15, o, { lp: 300 }); break;
      case 'totem': this.osc('sine', 80, t, 0.5, 0.6, o, { to: 40 }); this.noise(t, 0.25, 0.4, o, { type: 'lowpass', f: 800, to: 150 }); this.osc('triangle', 220, t, 0.3, 0.08, o); break;
      case 'quake': this.noise(t, 1.2, 0.8, o, { type: 'lowpass', f: 400, to: 60 }); this.osc('sine', 55, t, 1.2, 0.9, o, { to: 25 }); this.osc('sawtooth', 40, t, 0.8, 0.2, o, { lp: 200 }); break;
      case 'stoneskin': this.osc('sine', 196, t, 0.8, 0.15, o, { rev: R }); this.noise(t, 0.6, 0.25, o, { type: 'lowpass', f: 600 }); break;
      case 'gale': this.noise(t, 0.5, 0.45, o, { f: 500, to: 3000, q: 1.2, a: 0.03 }); break;
      case 'spirit': this.noise(t, 1.0, 0.45, o, { type: 'lowpass', f: 300, to: 3000, a: 0.2 }); this.osc('sawtooth', 110, t, 1.0, 0.12, o, { to: 220, lp: 800 }); break;
      case 'spirit_bolt': this.noise(t, 0.2, 0.2, o, { type: 'lowpass', f: 1500, to: 600 }); break;
      case 'interrupt': this.osc('square', 300, t, 0.12, 0.1, o, { to: 150, lp: 1500 }); this.noise(t, 0.15, 0.3, o, { f: 1500 }); break;
      case 'immune': this.osc('sine', 1500, t, 0.3, 0.08, o, { to: 2200 }); break;
      case 'jump': this.noise(t, 0.12, 0.06, o, { f: 500, q: 1 }); break;
      case 'death': this.osc('sine', 220, t, 1.4, 0.2, o, { to: 55, rev: R }); this.noise(t, 1.0, 0.25, o, { type: 'lowpass', f: 1200, to: 100 }); break;
      case 'tick': this.osc('sine', 660, t, 0.15, 0.25, o, { rev: R }); this.osc('sine', 990, t, 0.12, 0.08, o); break;
      case 'gong': [110, 165.4, 233, 311, 419].forEach((f, i) => this.osc('sine', f, t, 2.5 - i * 0.3, 0.25 / (i + 1), o, { rev: R })); this.noise(t, 0.4, 0.3, o, { type: 'lowpass', f: 800, to: 100 }); this.osc('sine', 60, t, 0.8, 0.5, o, { to: 40 }); break;
      case 'victory': this.fanfare(t, o, [62, 66, 69, 74, 78, 81], true); break;
      case 'defeat': this.fanfare(t, o, [62, 61, 57, 53, 50], false); break;
      case 'round_win': [69, 74, 78].forEach((n, i) => this.osc('sawtooth', NOTE(n), t + i * 0.12, 0.6, 0.08, o, { lp: 2000, rev: R })); break;
      case 'round_lose': [62, 58, 55].forEach((n, i) => this.osc('sawtooth', NOTE(n), t + i * 0.15, 0.7, 0.07, o, { lp: 1200, rev: R })); break;
      case 'auto_mage': this.osc('sine', 700, t, 0.18, 0.12, o, { to: 1400 }); this.noise(t, 0.12, 0.12, o, { f: 3000, to: 5000, q: 3 }); break;
      case 'auto_priest': this.osc('sine', 1046, t, 0.25, 0.08, o, { rev: R }); this.osc('sine', 1318, t + 0.03, 0.22, 0.06, o, { rev: R }); break;
      case 'auto_shaman': this.noise(t, 0.12, 0.35, o, { type: 'highpass', f: 3500 }); this.osc('square', 220, t, 0.06, 0.05, o, { to: 110, lp: 2000 }); break;
      case 'spark_hit': this.osc('triangle', 1600, t, 0.12, 0.07, o, { to: 900 }); this.noise(t, 0.08, 0.15, o, { f: 4000 }); break;
      case 'zap_hit': this.noise(t, 0.1, 0.4, o, { type: 'highpass', f: 4000 }); break;
      case 'crit': this.noise(t, 0.15, 0.5, o, { type: 'lowpass', f: 3000, to: 400 }); this.osc('sine', 90, t, 0.25, 0.5, o, { to: 40 }); this.osc('triangle', 2200, t, 0.12, 0.06, o, { to: 1500 }); break;
      case 'crowd': this.crowd(t, opts.big ? 2.8 : 1.6, opts.big ? 0.35 : 0.18); break;
    }
  }

  fanfare(t, o, notes, major) {
    notes.forEach((n, i) => {
      const tt = t + i * (major ? 0.14 : 0.25);
      this.osc('sawtooth', NOTE(n), tt, major ? 0.5 : 0.7, 0.12, o, { lp: 2400, rev: this.sfxRev });
      this.osc('sawtooth', NOTE(n - 12), tt, major ? 0.5 : 0.7, 0.08, o, { lp: 1200, detune: 6 });
    });
    const end = t + notes.length * (major ? 0.14 : 0.25);
    const chord = major ? [62, 66, 69, 74] : [50, 53, 57];
    chord.forEach(n => this.osc('sawtooth', NOTE(n), end, 2.2, 0.06, o, { lp: 1800, rev: this.sfxRev, a: 0.05 }));
    this.osc('sine', 55, end, 1.2, 0.4, o, { to: 40 });
  }

  crowd(t, dur, peak) {
    const C = this.ctx, g = C.createGain(); g.connect(this.sfx); g.connect(this.sfxRev);
    for (let i = 0; i < 6; i++) this.noise(t + Math.random() * 0.3, dur * (0.6 + Math.random() * 0.4), peak * 0.4, g, { f: 600 + Math.random() * 1500, q: 2, a: 0.25 });
  }

  // ------------------------------------------------------------ Music
  setTrack(name) {
    if (!this.ctx || this.track === name) return;
    const C = this.ctx, now = C.currentTime;
    if (this.trackGain) { const old = this.trackGain; old.gain.setTargetAtTime(0.0001, now, 0.6); setTimeout(() => old.disconnect(), 4000); }
    this.track = name;
    if (!name) { this.trackGain = null; return; }
    const g = C.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.setTargetAtTime(1, now + 0.2, 0.8);
    g.connect(this.music); const send = C.createGain(); send.gain.value = 0.5; g.connect(send); send.connect(this.revSend);
    this.trackGain = g;
    this.beat = 0; this.nextT = now + 0.1;
  }

  schedule() {
    if (!this.ctx || !this.track || !this.trackGain) return;
    const C = this.ctx;
    while (this.nextT < C.currentTime + 0.2) {
      if (this.track === 'menu') this.menuBeat(this.beat, this.nextT);
      else if (this.track === 'arena') this.arenaBeat(this.beat, this.nextT);
      const bpm = this.track === 'arena' ? 126 : 66;
      this.nextT += 60 / bpm / 2; // eighth notes
      this.beat++;
    }
  }

  // Menu: slow, cinematic D minor — strings, choir pad, horn melody, harp, timpani
  menuBeat(b, t) {
    const out = this.trackGain;
    const prog = [[50, 57, 62, 65], [46, 53, 58, 62], [41, 53, 57, 60], [48, 55, 60, 64]]; // Dm Bb F C
    const bar = Math.floor(b / 8), step = b % 8;
    const chord = prog[bar % 4];
    const len = 60 / 66 * 4;
    if (step === 0) {
      // strings pad
      for (const n of chord.slice(1)) for (const d of [-7, 7]) this.osc('sawtooth', NOTE(n), t, len * 0.9, 0.018, out, { a: 1.2, s: 0.8, r: 1.8, lp: 1300, detune: d });
      // low strings / bass
      this.osc('sawtooth', NOTE(chord[0] - 12), t, len, 0.05, out, { a: 0.6, s: 0.8, r: 1.5, lp: 380 });
      this.osc('sine', NOTE(chord[0] - 12), t, len, 0.06, out, { a: 0.5, s: 0.8, r: 1.5 });
      // timpani roll on phrase start
      if (bar % 2 === 0) { this.osc('sine', NOTE(chord[0] - 24) * 2, t, 1.2, 0.35, out, { to: NOTE(chord[0] - 24) * 1.6, glide: 0.4 }); this.noise(t, 0.3, 0.08, out, { type: 'lowpass', f: 300 }); }
      // choir "aah": formant-filtered tones
      if (bar % 4 >= 2) for (const n of [chord[2] + 12, chord[3] + 12]) this.osc('triangle', NOTE(n), t, len * 0.95, 0.012, out, { a: 1.5, s: 0.9, r: 2, lp: 1100, q: 4 });
    }
    // harp arpeggio
    const arp = [chord[1], chord[2], chord[3], chord[2] + 12, chord[3] + 12, chord[2] + 12, chord[3], chord[2]];
    this.osc('triangle', NOTE(arp[step] + 12), t, 0.9, 0.022, out, { a: 0.003 });
    // horn melody (8-bar phrase)
    const melody = [
      [62, 0, 4], [65, 4, 2], [64, 6, 2], [62, 8, 6], [58, 14, 2],
      [60, 16, 4], [57, 20, 4], [60, 24, 3], [62, 27, 1], [64, 28, 4],
    ];
    const phraseStep = b % 64;
    if (Math.floor(b / 64) % 2 === 1) for (const [n, s, d] of melody) if (s * 2 === phraseStep) {
      const dur = d * 60 / 66;
      this.osc('sawtooth', NOTE(n), t, dur, 0.035, out, { a: 0.15, s: 0.8, r: 0.6, lp: 900 });
      this.osc('sawtooth', NOTE(n - 12), t, dur, 0.02, out, { a: 0.15, s: 0.8, r: 0.6, lp: 600, detune: 5 });
    }
  }

  // Arena: driving 126 bpm — staccato string ostinato, taiko drums, brass stabs
  arenaBeat(b, t) {
    const out = this.trackGain;
    const prog = [[50, 57, 62, 65], [50, 57, 62, 65], [46, 53, 58, 62], [45, 52, 57, 61]]; // Dm Dm Bb A
    const bar = Math.floor(b / 8), step = b % 8;
    const chord = prog[bar % 4];
    const sec = 60 / 126 / 2;
    // ostinato strings (8ths)
    const pat = [0, 2, 1, 2, 0, 2, 1, 3];
    const n = chord[pat[step]];
    this.osc('sawtooth', NOTE(n), t, sec * 0.8, 0.028, out, { a: 0.005, lp: 1800 });
    this.osc('sawtooth', NOTE(n), t, sec * 0.8, 0.02, out, { a: 0.005, lp: 1800, detune: 9 });
    // bass
    if (step % 2 === 0) this.osc('sawtooth', NOTE(chord[0] - 12), t, sec * 1.6, 0.06, out, { lp: 300 });
    // taiko
    const kick = [1, 0, 0, 1, 0, 0, 1, 0][step], tom = [0, 0, 1, 0, 0, 1, 0, 1][step];
    if (kick) { this.osc('sine', 70, t, 0.4, 0.4, out, { to: 38 }); this.noise(t, 0.12, 0.12, out, { type: 'lowpass', f: 400 }); }
    if (tom && bar % 2 === 1) { this.osc('sine', 140, t, 0.25, 0.18, out, { to: 90 }); }
    if (step === 4) this.noise(t, 0.12, 0.05, out, { type: 'highpass', f: 3000 });
    // brass stabs at chord change & pad
    if (step === 0) {
      for (const m of chord.slice(1)) this.osc('sawtooth', NOTE(m), t, 0.35, 0.03, out, { a: 0.02, lp: 1500 });
      for (const m of chord.slice(1)) this.osc('sawtooth', NOTE(m), t, sec * 8, 0.01, out, { a: 0.6, s: 0.7, r: 0.6, lp: 900, detune: -6 });
      if (bar % 8 === 0) { this.osc('sine', 55, t, 1.2, 0.3, out, { to: 40 }); this.noise(t, 0.8, 0.08, out, { type: 'lowpass', f: 2000, to: 200 }); }
    }
    // heroic horn line every other 8 bars
    if (Math.floor(bar / 8) % 2 === 1 && step === 0) {
      const line = [74, 72, 70, 69];
      this.osc('sawtooth', NOTE(line[bar % 4]), t, sec * 7, 0.03, out, { a: 0.08, s: 0.8, r: 0.3, lp: 1400 });
      this.osc('sawtooth', NOTE(line[bar % 4] - 12), t, sec * 7, 0.02, out, { a: 0.08, s: 0.8, r: 0.3, lp: 900 });
    }
  }
}

// Ability → sound mapping for 'ab' events and impacts.
export const AB_SOUND = {
  frost_lance: 'frost_lance', flame_burst: 'flame_burst', glacial_nova: 'glacial_nova', arcane_shift: 'arcane_shift', mana_ward: 'mana_ward', arcane_comet: 'arcane_comet',
  viper_strike: 'dagger', gutting_edge: 'melee_heavy', skull_crack: 'stun', shadow_leap: 'shadow', fade: 'stealth', death_mark: 'mark',
  rending_blow: 'melee_heavy', crippling_slash: 'swing', bull_rush: 'charge', iron_bulwark: 'shield', shield_slam: 'shield', steel_tempest: 'tempest',
  rending_axes: 'melee_heavy', headtaker: 'mark_pop', axe_throw: 'swing', skull_leap: 'warcry', undying_rage: 'mark', berserk: 'warcry',
  skullsplitter: 'melee_heavy', ground_breaker: 'quake', iron_hide: 'mark',
  fireball: 'flame_burst', frostbite: 'frost_lance', blazing_step: 'gale', meteor: 'arcane_comet', flame_ring: 'magma',
  sacred_bolt: 'holy_bolt', mend: 'heal', divine_aegis: 'aegis', seraph_step: 'seraph', blinding_light: 'blinding', halo_judgment: 'halo',
  lightning_lash: 'lightning', magma_burst: 'magma', quake_totem: 'totem', gale_dash: 'gale', stoneskin_totem: 'stoneskin', fire_spirit: 'spirit',
};
export const HIT_SOUND = { frostbite: 'frost_hit', fireball: 'fire_hit', fire_bolt: 'fire_hit', frost_lance: 'frost_hit', flame_burst: 'fire_hit', arcane_comet: 'arcane_hit', sacred_bolt: 'holy_hit', magma_burst: 'fire_hit', spirit_bolt: 'fire_hit', arcane_bolt: 'spark_hit', holy_spark: 'spark_hit', static_bolt: 'zap_hit' };
export const CAST_SOUND = { frost: 'cast_frost', arcane: 'cast_arcane', holy: 'cast_holy', nature: 'cast_nature', fire: 'cast_fire' };
