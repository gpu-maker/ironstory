// AEGIS: Port Halcyon — audio engine (Web Audio, everything synthesized, no sound files)
// 3D positional sound (HRTF), air absorption + speed-of-sound delay for distant events,
// a procedurally generated city reverb, layered weapon/explosion/thruster sounds and a
// living ambient soundscape (traffic, wind, horns, sirens, crowds, footsteps).
window.AUDIO = (function () {
  'use strict';
  const A = { ctx: null, master: null };
  let ctx, bus, wet, comp, white, brown, pink, listenerPos = { x: 0, y: 0, z: 0 };
  const L = {}; // looping layers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);

  function makeNoise(kind, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let b0 = 0, b1 = 0, b2 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w;
        else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      }
    }
    return buf;
  }
  // city impulse response: early reflections off nearby walls + a long diffuse tail
  function makeIR() {
    const sec = 2.6, len = Math.floor(ctx.sampleRate * sec), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) { const t = i / ctx.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / sec, 3.2) * 0.5; }
      for (let k = 0; k < 9; k++) { const at = Math.floor(ctx.sampleRate * rand(0.02, 0.22)); const a = rand(0.25, 0.6) * (ch ? 0.9 : 1); for (let j = 0; j < 220; j++) d[at + j] += (Math.random() * 2 - 1) * a * (1 - j / 220); }
    }
    return ir;
  }

  function init(volume) {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    try {
      ctx = A.ctx = new (window.AudioContext || window.webkitAudioContext)();
      A.master = ctx.createGain(); A.master.gain.value = volume == null ? 0.6 : volume;
      comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
      A.master.connect(comp); comp.connect(ctx.destination);
      bus = ctx.createGain(); bus.connect(A.master);
      const conv = ctx.createConvolver(); conv.buffer = makeIR();
      wet = ctx.createGain(); wet.gain.value = 0.32; wet.connect(conv); conv.connect(A.master);
      white = makeNoise('white', 2); brown = makeNoise('brown', 4); pink = makeNoise('pink', 3);
      startLoops();
    } catch (e) { A.ctx = null; }
  }
  function setVolume(v) { if (A.master) A.master.gain.setTargetAtTime(v, ctx.currentTime, 0.05); }

  // ---------- routing ----------
  function dist(p) { return Math.hypot(p.x - listenerPos.x, p.y - listenerPos.y, p.z - listenerPos.z); }
  // returns { node, delay } — connect sources to node; node is spatialized + air-absorbed
  function route(pos, wetAmt = 0.25) {
    const g = ctx.createGain();
    const send = ctx.createGain(); send.gain.value = wetAmt; g.connect(send); send.connect(wet);
    if (!pos) { g.connect(bus); return { node: g, delay: 0, d: 0 }; }
    const d = dist(pos);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp(18000 * Math.exp(-d / 260), 700, 18000);
    const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 8; pan.maxDistance = 3000; pan.rolloffFactor = 0.9;
    if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z; } else pan.setPosition(pos.x, pos.y, pos.z);
    g.connect(lp); lp.connect(pan); pan.connect(bus);
    send.gain.value = wetAmt * (1 + Math.min(2.5, d / 120));   // distant sounds are mostly echo
    return { node: g, delay: Math.min(1.6, d / 343), d };       // speed of sound
  }
  // ---------- building blocks ----------
  function env(gainNode, t, a, peak, dec, sustainTo = 0.0001) {
    const g = gainNode.gain; g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.exponentialRampToValueAtTime(sustainTo, t + a + dec);
  }
  function noise(out, t, buf, type, f0, f1, q, a, peak, dec) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + a + dec);
    const g = ctx.createGain(); env(g, t, a, peak, dec);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 1.5); s.stop(t + a + dec + 0.05);
  }
  function tone(out, t, wave, f0, f1, a, peak, dec, filt) {
    const o = ctx.createOscillator(); o.type = wave; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + a + dec);
    const g = ctx.createGain(); env(g, t, a, peak, dec);
    let n = o; if (filt) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filt; o.connect(f); n = f; }
    n.connect(g); g.connect(out); o.start(t); o.stop(t + a + dec + 0.05);
  }

  // ---------- one-shot sounds ----------
  function play(type, vol = 1, pos) {
    if (!A.ctx || ctx.state !== 'running') return;
    if (pos && dist(pos) > 1400) return;
    const r = route(pos, { boom: 0.35, enemy: 0.3, mg: 0.25, rail: 0.3, missile: 0.2 }[type] || 0.12);
    const t = ctx.currentTime + 0.005 + r.delay, o = r.node; o.gain.value = vol;
    switch (type) {
      case 'pew': // repulsor bolt: sharp transient, falling energy body, sub kick
        noise(o, t, white, 'bandpass', 3800, 2000, 1.2, 0.002, 0.35, 0.03);
        tone(o, t, 'sawtooth', rand(1300, 1500), 190, 0.003, 0.12, 0.13, 3200);
        tone(o, t, 'square', 700, 120, 0.002, 0.05, 0.1, 1800);
        tone(o, t, 'sine', 140, 48, 0.002, 0.35, 0.09);
        break;
      case 'missile': // launch thump + rushing rocket motor
        tone(o, t, 'sine', 110, 40, 0.004, 0.5, 0.18);
        noise(o, t, white, 'lowpass', 900, 300, 0.7, 0.005, 0.35, 0.15);
        noise(o, t + 0.03, white, 'bandpass', 700, 2600, 1.5, 0.06, 0.3, 0.55);
        noise(o, t + 0.03, brown, 'lowpass', 500, 900, 0.7, 0.05, 0.4, 0.6);
        break;
      case 'rail': // supersonic crack + electrical zap + coil whine
        noise(o, t, white, 'highpass', 2500, 2500, 0.7, 0.001, 0.8, 0.04);
        tone(o, t, 'sawtooth', 2600, 70, 0.002, 0.16, 0.38, 6000);
        tone(o, t, 'square', 90, 45, 0.002, 0.25, 0.2, 600);
        tone(o, t - 0.12 < ctx.currentTime ? t : t - 0.12, 'sine', 3000, 9000, 0.1, 0.02, 0.05);
        break;
      case 'boom': { // explosion: pressure thump, blast, debris crackle; far = mostly low rumble + echo
        const far = clamp(r.d / 300, 0, 1);
        tone(o, t, 'sine', 75, 26, 0.004, 1.0, 1.1);
        noise(o, t, white, 'lowpass', 3500 * (1 - far * 0.8), 120, 0.6, 0.003, 0.9, 1.6);
        noise(o, t, brown, 'lowpass', 400, 80, 0.7, 0.01, 1.0, 2.2);
        for (let k = 0; k < 7; k++) noise(o, t + rand(0.08, 0.9), white, 'bandpass', rand(1500, 4500), rand(800, 2000), 2, 0.002, rand(0.04, 0.12) * (1 - far), rand(0.03, 0.09));
        break;
      }
      case 'hit': // projectile impact on armor/metal
        noise(o, t, white, 'bandpass', 2600, 1800, 3, 0.001, 0.3, 0.05);
        tone(o, t, 'triangle', rand(700, 900), 500, 0.001, 0.12, 0.08);
        break;
      case 'flesh': // impact on a soldier: dull thud
        noise(o, t, brown, 'lowpass', 900, 250, 0.8, 0.002, 0.7, 0.09);
        tone(o, t, 'sine', 95, 55, 0.002, 0.35, 0.08);
        break;
      case 'enemy': // rifle shot: crack, body, rolling tail
        noise(o, t, white, 'highpass', 1800, 1800, 0.7, 0.001, 0.55, 0.018);
        noise(o, t, white, 'bandpass', 900, 500, 0.9, 0.002, 0.45, 0.09);
        noise(o, t + 0.01, brown, 'lowpass', 500, 120, 0.7, 0.01, 0.35, 0.45);
        break;
      case 'mg':
        noise(o, t, white, 'highpass', 2200, 2200, 0.7, 0.001, 0.35, 0.012);
        noise(o, t, white, 'bandpass', 700, 400, 1, 0.002, 0.25, 0.06);
        break;
      case 'hurt': // armor struck: metallic clang
        [523, 787, 1241, 1630].forEach((f, i) => tone(o, t, 'sine', f * rand(0.98, 1.02), f * 0.97, 0.001, 0.12 / (i + 1), 0.35 + i * 0.05));
        noise(o, t, white, 'bandpass', 3000, 1500, 2, 0.001, 0.3, 0.06);
        tone(o, t, 'sine', 110, 60, 0.002, 0.4, 0.12);
        break;
      case 'pick': // pickup chime
        tone(o, t, 'sine', 988, 988, 0.005, 0.18, 0.4); tone(o, t + 0.07, 'sine', 1318, 1318, 0.005, 0.15, 0.5); tone(o, t + 0.07, 'triangle', 2637, 2637, 0.005, 0.03, 0.3);
        break;
      case 'lance': // core lance: charge whine into a roaring beam
        tone(o, t, 'sine', 300, 1800, 0.12, 0.08, 0.05);
        tone(o, t + 0.1, 'sawtooth', 110, 90, 0.01, 0.25, 0.7, 1400);
        tone(o, t + 0.1, 'sawtooth', 221, 180, 0.01, 0.15, 0.6, 2400);
        noise(o, t + 0.1, white, 'bandpass', 2500, 600, 1.5, 0.01, 0.35, 0.7);
        tone(o, t + 0.1, 'sine', 60, 35, 0.01, 0.6, 0.6);
        break;
      case 'thunder': { // crack overhead, then a long rolling rumble
        const near = vol > 0.9;
        if (near) noise(o, t, white, 'highpass', 1500, 600, 0.6, 0.002, 0.5, 0.25);
        noise(o, t + (near ? 0.05 : 0), brown, 'lowpass', 900, 60, 0.6, 0.08, 1.0, 4.5);
        tone(o, t, 'sine', 55, 28, 0.15, 0.5, 3.2);
        for (let k = 0; k < 5; k++) noise(o, t + rand(0.2, 2.5), brown, 'lowpass', rand(300, 600), 80, 0.7, 0.1, rand(0.3, 0.6), rand(0.8, 1.6));
        break;
      }
      case 'car': // car explosion: blast + glass + tyre pop
        tone(o, t, 'sine', 80, 30, 0.004, 0.9, 0.9);
        noise(o, t, white, 'lowpass', 3000, 150, 0.6, 0.003, 0.8, 1.3);
        for (let k = 0; k < 10; k++) noise(o, t + rand(0.02, 0.5), white, 'bandpass', rand(3000, 7000), rand(2500, 5000), 4, 0.001, rand(0.05, 0.15), rand(0.05, 0.15));
        break;
      case 'ui': tone(o, t, 'sine', 1900, 1900, 0.002, 0.06, 0.03); tone(o, t + 0.02, 'sine', 2600, 2600, 0.002, 0.03, 0.03); break;
      case 'step': noise(o, t, brown, 'lowpass', rand(500, 800), 200, 0.8, 0.002, 0.35, 0.07); noise(o, t, white, 'bandpass', 2400, 1200, 1.5, 0.001, 0.05, 0.03); break;
      case 'land': noise(o, t, brown, 'lowpass', 600, 120, 0.7, 0.003, 0.9, 0.25); tone(o, t, 'sine', 70, 35, 0.003, 0.6, 0.2); noise(o, t, white, 'bandpass', 2000, 900, 1.2, 0.002, 0.15, 0.1); break;
      case 'horn': { const f = rand(380, 460); tone(o, t, 'square', f, f, 0.01, 0.06, rand(0.25, 0.6), 1600); tone(o, t, 'square', f * 1.25, f * 1.25, 0.01, 0.05, rand(0.25, 0.6), 1600); break; }
      case 'shield': // energy bubble forming: rising shimmer over a soft thump
        tone(o, t, 'sine', 180, 520, 0.12, 0.25, 0.25); tone(o, t + 0.03, 'triangle', 900, 1500, 0.1, 0.06, 0.3);
        noise(o, t, white, 'highpass', 5000, 7000, 0.6, 0.08, 0.08, 0.3); tone(o, t, 'sine', 90, 50, 0.005, 0.3, 0.15); break;
      case 'shieldHit': // bolt splashing on the shield: bright ping + fizz
        tone(o, t, 'sine', rand(1500, 1800), 900, 0.001, 0.14, 0.18); tone(o, t, 'triangle', 3200, 2400, 0.001, 0.05, 0.12);
        noise(o, t, white, 'bandpass', 4200, 2500, 2, 0.001, 0.22, 0.16); break;
      case 'shock': // shockwave: pressure thump, rushing air, crackle
        tone(o, t, 'sine', 95, 28, 0.004, 1.0, 0.9); tone(o, t, 'square', 140, 40, 0.004, 0.12, 0.3, 500);
        noise(o, t, white, 'lowpass', 4000, 180, 0.6, 0.004, 0.75, 0.9); noise(o, t + 0.02, pink, 'bandpass', 900, 3000, 1.2, 0.05, 0.4, 0.5);
        for (let k = 0; k < 5; k++) noise(o, t + rand(0.05, 0.4), white, 'bandpass', rand(2500, 6000), 2000, 3, 0.001, 0.08, 0.05); break;
      case 'dash': // thruster burst whoosh
        noise(o, t, pink, 'bandpass', 500, 2600, 1.4, 0.02, 0.55, 0.3); noise(o, t, white, 'highpass', 3000, 6000, 0.6, 0.01, 0.15, 0.2);
        tone(o, t, 'sine', 160, 70, 0.005, 0.35, 0.22); break;
      case 'charge': // sniper laser lock: thin rising whine with ticks
        tone(o, t, 'sine', 1100, 2600, 0.05, 0.05, 1.4); for (let k = 0; k < 5; k++) tone(o, t + k * 0.3, 'square', 2400, 2400, 0.001, 0.03, 0.03, 4000); break;
      case 'snipe': // heavy rifle: hard supersonic crack, deep body, long echoing tail
        noise(o, t, white, 'highpass', 1500, 1500, 0.7, 0.001, 1.0, 0.03); noise(o, t, white, 'bandpass', 700, 300, 0.8, 0.002, 0.7, 0.15);
        tone(o, t, 'sine', 120, 45, 0.002, 0.5, 0.25); noise(o, t + 0.02, brown, 'lowpass', 600, 90, 0.7, 0.02, 0.6, 1.3); break;
      case 'flak': // flak gun: big punchy thump with a crackling tail
        tone(o, t, 'sine', 120, 38, 0.003, 0.8, 0.35); noise(o, t, white, 'lowpass', 2200, 200, 0.6, 0.002, 0.7, 0.4);
        noise(o, t + 0.03, brown, 'lowpass', 500, 90, 0.7, 0.01, 0.5, 0.9); break;
      case 'servo': // heavy hydraulics
        tone(o, t, 'sawtooth', 110, 260, 0.08, 0.12, 0.6, 900); noise(o, t, white, 'bandpass', 1400, 2400, 4, 0.05, 0.12, 0.5);
        noise(o, t + 0.5, white, 'highpass', 4000, 4000, 0.7, 0.01, 0.15, 0.25); break;
      case 'stomp': // walker foot slamming down
        tone(o, t, 'sine', 60, 22, 0.003, 1.2, 1.3); noise(o, t, brown, 'lowpass', 700, 60, 0.7, 0.003, 1.0, 1.6);
        noise(o, t, white, 'lowpass', 3000, 300, 0.6, 0.002, 0.6, 0.5); [220, 331, 467].forEach((f) => tone(o, t, 'sine', f, f * 0.96, 0.002, 0.06, 0.7)); break;
      case 'cloak': // stealth field: reverse whoosh into silence
        noise(o, t, pink, 'bandpass', 3200, 400, 2, 0.25, 0.35, 0.35); tone(o, t, 'sine', 700, 180, 0.2, 0.08, 0.4); break;
      case 'gull': { // seagull: a few falling, raspy cries
        const n = 2 + ((Math.random() * 3) | 0), f = rand(1500, 2100);
        for (let k = 0; k < n; k++) { const tk = t + k * rand(0.16, 0.26); tone(o, tk, 'sawtooth', f * 1.15, f * 0.7, 0.01, 0.05, 0.16, 3200); tone(o, tk, 'sine', f, f * 0.62, 0.01, 0.06, 0.18); noise(o, tk, white, 'bandpass', f, f * 0.8, 6, 0.01, 0.02, 0.12); }
        break; }
      case 'beep': tone(o, t, 'square', 2100, 2100, 0.002, 0.06, 0.07, 5000); tone(o, t, 'sine', 4200, 4200, 0.002, 0.02, 0.05); break;
      case 'defuse': [784, 988, 1318].forEach((f, i) => { tone(o, t + i * 0.09, 'sine', f, f, 0.004, 0.16, 0.35); tone(o, t + i * 0.09, 'triangle', f * 2, f * 2, 0.004, 0.03, 0.2); }); break;
      case 'ring': tone(o, t, 'sine', 1318, 1318, 0.003, 0.18, 0.3); tone(o, t + 0.05, 'sine', 1976, 1976, 0.003, 0.14, 0.4); noise(o, t, white, 'highpass', 6000, 8000, 0.7, 0.002, 0.08, 0.2); break;
      case 'count': { const f = vol > 1 ? 1760 : 880; tone(o, t, 'sine', f, f, 0.003, 0.25, vol > 1 ? 0.6 : 0.2); tone(o, t, 'triangle', f * 2, f * 2, 0.003, 0.05, 0.15); break; }
      default: tone(o, t, 'sine', 800, 600, 0.002, 0.05, 0.05);
    }
  }

  // ---------- looping layers ----------
  function loop(buf, type, freq, q) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = 1;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(f); f.connect(g); s.start(0, Math.random() * 2);
    return { s, f, g };
  }
  function startLoops() {
    const toBus = (x, wetAmt = 0.1) => { x.g.connect(bus); const sd = ctx.createGain(); sd.gain.value = wetAmt; x.g.connect(sd); sd.connect(wet); return x; };
    // jet thrusters: rumble + hiss + turbine whine
    L.rumble = toBus(loop(brown, 'lowpass', 160, 0.7));
    L.hiss = toBus(loop(white, 'highpass', 3500, 0.5));
    L.whineO = ctx.createOscillator(); L.whineO.type = 'sawtooth'; L.whineO.frequency.value = 400;
    L.whineF = ctx.createBiquadFilter(); L.whineF.type = 'bandpass'; L.whineF.Q.value = 6; L.whineF.frequency.value = 900;
    L.whineG = ctx.createGain(); L.whineG.gain.value = 0; L.whineO.connect(L.whineF); L.whineF.connect(L.whineG); L.whineG.connect(bus); L.whineO.start();
    // wind past the helmet
    L.wind = toBus(loop(pink, 'bandpass', 700, 0.6), 0.05);
    // distant city traffic hum (muffled by height / indoors)
    L.traffic = toBus(loop(brown, 'lowpass', 260, 0.7), 0.3);
    L.trafficHiss = toBus(loop(pink, 'bandpass', 1100, 0.4), 0.3);
    // crowd murmur: pink noise through voice-like formant bands with slow amplitude wobble
    L.crowd = [380, 820, 1500].map((f) => toBus(loop(pink, 'bandpass', f, 3.5), 0.2));
    L.crowdLFO = ctx.createOscillator(); L.crowdLFO.frequency.value = 0.37; L.crowdLFOG = ctx.createGain(); L.crowdLFOG.gain.value = 0;
    L.crowdLFO.connect(L.crowdLFOG); L.crowd.forEach((c) => L.crowdLFOG.connect(c.g.gain)); L.crowdLFO.start();
    // siren (positioned at the raid)
    L.sirenO = ctx.createOscillator(); L.sirenO.type = 'triangle'; L.sirenO.frequency.value = 700;
    L.sirenLFO = ctx.createOscillator(); L.sirenLFO.frequency.value = 0.55; L.sirenDepth = ctx.createGain(); L.sirenDepth.gain.value = 220;
    L.sirenLFO.connect(L.sirenDepth); L.sirenDepth.connect(L.sirenO.frequency);
    L.sirenG = ctx.createGain(); L.sirenG.gain.value = 0;
    L.sirenPan = ctx.createPanner(); L.sirenPan.panningModel = 'HRTF'; L.sirenPan.distanceModel = 'inverse'; L.sirenPan.refDistance = 40; L.sirenPan.rolloffFactor = 1;
    const sLP = ctx.createBiquadFilter(); sLP.type = 'lowpass'; sLP.frequency.value = 2200;
    L.sirenO.connect(sLP); sLP.connect(L.sirenG); L.sirenG.connect(L.sirenPan); L.sirenPan.connect(bus);
    const sW = ctx.createGain(); sW.gain.value = 0.6; L.sirenG.connect(sW); sW.connect(wet);
    L.sirenO.start(); L.sirenLFO.start();
    // rain: hiss on the suit + distant patter
    L.rainHi = toBus(loop(white, 'highpass', 5000, 0.4), 0.15);
    L.rainLo = toBus(loop(pink, 'bandpass', 1400, 0.5), 0.3);
    // shield hum: narrow resonant band + a slow tremolo
    L.shield = toBus(loop(pink, 'bandpass', 880, 9), 0.2);
    L.shieldO = ctx.createOscillator(); L.shieldO.type = 'sine'; L.shieldO.frequency.value = 110; L.shieldOG = ctx.createGain(); L.shieldOG.gain.value = 0;
    L.shieldO.connect(L.shieldOG); L.shieldOG.connect(bus); L.shieldO.start();
  }
  function setRain(r) { if (!A.ctx || !L.rainHi) return; set(L.rainHi.g.gain, r * 0.09, 0.8); set(L.rainLo.g.gain, r * 0.22, 0.8); }
  const set = (param, v, tc = 0.12) => param.setTargetAtTime(v, ctx.currentTime, tc);
  let stepT = 0, hornT = 6, wasGround = true, prevVy = 0;
  // state: { cam:{pos,fwd,up}, speed, vy, alt, boosting, grounded, walking, indoors, people, siren:{x,y,z}|null, running }
  function update(dt, st) {
    if (!A.ctx || ctx.state !== 'running') return;
    const li = ctx.listener, c = st.cam;
    listenerPos = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
    if (li.positionX) {
      li.positionX.value = c.pos.x; li.positionY.value = c.pos.y; li.positionZ.value = c.pos.z;
      li.forwardX.value = c.fwd.x; li.forwardY.value = c.fwd.y; li.forwardZ.value = c.fwd.z; li.upX.value = c.up.x; li.upY.value = c.up.y; li.upZ.value = c.up.z;
    } else { li.setPosition(c.pos.x, c.pos.y, c.pos.z); li.setOrientation(c.fwd.x, c.fwd.y, c.fwd.z, c.up.x, c.up.y, c.up.z); }
    if (!st.running) { [L.rumble.g, L.hiss.g, L.whineG, L.wind.g, L.traffic.g, L.trafficHiss.g, L.sirenG, L.crowdLFOG, L.shield.g, L.shieldOG].concat(L.crowd.map((x) => x.g)).forEach((g) => set(g.gain || g, 0, 0.3)); return; }
    set(L.shield.g.gain, st.shield ? 0.11 : 0, 0.06); set(L.shieldOG.gain, st.shield ? 0.025 : 0, 0.06); L.shield.f.frequency.value = 860 + Math.sin(ctx.currentTime * 7) * 60;
    const sp = st.speed, flying = !st.grounded, boost = st.boosting ? 1 : 0;
    // thrusters
    const thr = flying ? clamp(0.18 + sp / 160, 0, 1) : 0;
    set(L.rumble.g.gain, thr * (0.55 + 0.45 * boost) * 0.9); set(L.rumble.f.frequency, 120 + sp * 1.4 + boost * 120);
    set(L.hiss.g.gain, thr * (0.05 + 0.12 * boost)); set(L.hiss.f.frequency, 2500 + sp * 10);
    set(L.whineG.gain, thr * 0.03 * (0.5 + boost)); set(L.whineO.frequency, 320 + sp * 3.2 + boost * 260, 0.25); set(L.whineF.frequency, 700 + sp * 6, 0.25);
    // wind grows with airspeed and altitude
    const windAmt = clamp(sp / 260, 0, 1) * 0.7 + clamp(st.alt / 400, 0, 1) * 0.12;
    set(L.wind.g.gain, windAmt * 0.6, 0.3); set(L.wind.f.frequency, 400 + sp * 9, 0.3); L.wind.f.Q.value = 0.5 + Math.random() * 0.1;
    // city hum: loudest at street level, muffled indoors / high up
    const cityK = st.indoors ? 0.15 : clamp(1 - st.alt / 350, 0.12, 1);
    set(L.traffic.g.gain, 0.22 * cityK, 0.5); set(L.trafficHiss.g.gain, 0.03 * cityK, 0.5); set(L.traffic.f.frequency, st.indoors ? 140 : 260, 0.5);
    // crowd murmur near pedestrians
    const crowdK = st.indoors ? 0 : clamp(st.people / 12, 0, 1) * clamp(1 - st.alt / 40, 0, 1);
    L.crowd.forEach((x, i) => set(x.g.gain, crowdK * [0.05, 0.035, 0.015][i], 0.4)); set(L.crowdLFOG.gain, crowdK * 0.02, 0.4);
    // raid siren
    if (st.siren) {
      if (L.sirenPan.positionX) { L.sirenPan.positionX.value = st.siren.x; L.sirenPan.positionY.value = 8; L.sirenPan.positionZ.value = st.siren.z; } else L.sirenPan.setPosition(st.siren.x, 8, st.siren.z);
      set(L.sirenG.gain, 0.12, 0.8);
    } else set(L.sirenG.gain, 0, 1.2);
    // footsteps and landing
    if (st.grounded && st.walking) { stepT -= dt * clamp(sp / 4, 0.6, 2.4); if (stepT <= 0) { stepT = 0.42; play('step', 0.55); } } else stepT = 0.1;
    if (st.grounded && !wasGround && prevVy < -6) play('land', clamp(-prevVy / 40, 0.3, 1));
    wasGround = st.grounded; prevVy = st.vy;
    // distant car horns at street level
    hornT -= dt; if (hornT <= 0) { hornT = rand(7, 22); if (st.alt < 120 && !st.indoors) play('horn', rand(0.3, 0.7), { x: c.pos.x + rand(-180, 180), y: 1, z: c.pos.z + rand(-180, 180) }); }
  }
  A.init = init; A.play = play; A.update = update; A.setVolume = setVolume; A.setRain = setRain;
  return A;
})();
