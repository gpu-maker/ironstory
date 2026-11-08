// AEGIS: Port Halcyon — engine, world, player, combat, missions, saves
(function () {
  'use strict';
  const D = window.GDATA;
  const G = (window.G = {});
  const V3 = THREE.Vector3;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const tmp = new V3(), tmp2 = new V3(), tmp3 = new V3();
  // Extension registry: act2.js adds enemy types (make/update) and mission stage types (start/update/cleanup).
  G.EXT = { enemy: {}, stage: {} };

  // ================= PARTS & BUILDS =================
  const PART = {};
  D.PARTS.forEach((p) => (PART[p.id] = p));
  G.PART = PART;

  G.computeWeapon = function (b) {
    const e = PART[b.parts.emitter].s, c = PART[b.parts.cell].s, l = PART[b.parts.lens].s,
      m = PART[b.parts.mod].s, co = PART[b.parts.cooling].s;
    const w = {
      dmg: e.dmg * (c.dmgMul || 1) * (l.dmgMul || 1),
      rate: e.rate * (c.rateMul || 1),
      speed: e.speed * (l.speedMul || 1),
      count: e.count + (l.countAdd || 0),
      spread: e.spread * (l.spreadMul || 1) + (l.countAdd ? 0.02 : 0),
      heat: e.heat * (c.heatMul || 1) * (co.heatMul || 1),
      cool: 28 * (co.coolMul || 1),
      pierce: (e.pierce || 0) + (l.pierceAdd || 0),
      explode: (e.explode || 0) + (m.explodeAdd || 0),
      homing: (e.homing || 0) + (m.homingAdd || 0),
      chain: (e.chain || 0) + (m.chainAdd || 0),
      slow: m.slow || 0,
      size: e.size,
      color: b.color || '#5fe3ff',
    };
    w.dps = w.dmg * w.count * w.rate;
    return w;
  };
  G.computeSuit = function (b) {
    const pl = PART[b.parts.plating].s, th = PART[b.parts.thruster].s, re = PART[b.parts.reactor].s, he = PART[b.parts.helmet].s;
    return {
      hp: pl.hp, armor: pl.armor, speed: th.speed * pl.speedMul, boost: th.boost * pl.speedMul,
      boostCost: th.boostCost, energy: re.energy, regen: re.regen, coolBonus: re.coolBonus, scan: he.scan, style: he.style,
    };
  };
  // Upgrades (act2.js) wrap the base suit numbers; the workbench preview uses the raw parts.
  G.suitStats = function (b) { const s = G.computeSuit(b); return G.applyUpgrades ? G.applyUpgrades(s) : s; };

  // ================= STATE / SAVES =================
  G.newState = function () {
    return {
      v: 1,
      inventory: Object.assign({}, D.START_INVENTORY),
      weapons: JSON.parse(JSON.stringify(D.START_WEAPONS)),
      suits: JSON.parse(JSON.stringify(D.START_SUITS)),
      equip: { primary: 'w_start1', secondary: 'w_start2', suit: 's_start' },
      missionIndex: 0, benches: ['b_harbor', 'b_hq'], crates: [],
      stats: { kills: 0, crimes: 0, time: 0, crafted: 0 },
      tech: { pts: 0, earned: 0, up: {}, crateTP: 0 }, races: {},
      pos: [-220, 2, 1010], yaw: 0, saved: Date.now(),
    };
  };
  G.settings = { sens: 1, invertY: false, view: 2200, volume: 0.6, quality: 1, fp: true, voice: true, chatter: true, blood: true, timeMode: 'dynamic', weather: 'dynamic' };
  try { Object.assign(G.settings, JSON.parse(localStorage.getItem('aegis.settings') || '{}')); } catch (e) {}
  G.saveSettings = function () { try { localStorage.setItem('aegis.settings', JSON.stringify(G.settings)); } catch (e) {} applySettings(); };

  const slotKey = (n) => 'aegis.slot.' + n;
  G.saveGame = function (slot) {
    if (!G.state) return false;
    G.state.pos = [P.pos.x, Math.max(2, P.pos.y), P.pos.z]; G.state.hours = CLIMATE.hours;
    G.state.yaw = P.yaw;
    G.state.saved = Date.now();
    try { localStorage.setItem(slotKey(slot), JSON.stringify(G.state)); } catch (e) { G.UI.toast('Save failed: storage full or blocked', 'bad'); return false; }
    G.UI.toast(slot === 0 ? 'Autosaved' : 'Saved to slot ' + slot, 'info');
    return true;
  };
  G.readSlot = function (slot) {
    try { const s = localStorage.getItem(slotKey(slot)); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  };
  G.deleteSlot = function (slot) { try { localStorage.removeItem(slotKey(slot)); } catch (e) {} };
  G.validateState = function (s) {
    if (!s || typeof s !== 'object' || !s.inventory || !s.weapons || !s.suits || !s.equip) return null;
    const base = G.newState();
    const out = Object.assign(base, s);
    if (out.benches && !out.benches.includes('b_hq')) out.benches = out.benches.concat('b_hq');
    out.stats = Object.assign(G.newState().stats, s.stats || {});
    out.tech = Object.assign(G.newState().tech, s.tech || {}); out.tech.up = Object.assign({}, out.tech.up || {});
    out.races = Object.assign({}, s.races || {});
    // drop builds referencing unknown parts (e.g. modded save)
    out.weapons = out.weapons.filter((w) => D.SLOTS.weapon.every((k) => PART[w.parts[k]]));
    out.suits = out.suits.filter((w) => D.SLOTS.suit.every((k) => PART[w.parts[k]]));
    if (!out.weapons.find((w) => w.id === out.equip.primary)) out.equip.primary = out.weapons[0] && out.weapons[0].id;
    if (!out.weapons.find((w) => w.id === out.equip.secondary)) out.equip.secondary = out.weapons[1] ? out.weapons[1].id : out.equip.primary;
    if (!out.suits.find((w) => w.id === out.equip.suit)) out.equip.suit = out.suits[0] && out.suits[0].id;
    if (!out.equip.primary || !out.equip.suit) return null;
    if (!s.tech) { const t = out.tech; t.earned = t.pts = out.missionIndex * 3 + (out.stats.crimes | 0) + Math.floor((out.crates || []).length / 5); t.crateTP = Math.floor((out.crates || []).length / 5); }
    return out;
  };

  // ================= RENDERER (see js/graphics.js) =================
  const { renderer, scene, camera, sun, SUN_DIR, U, fogMats, GLSL_LIB, VS_WORLD, ENV, post, glowM, metal } = GFX;
  G.canvas = renderer.domElement; G.camera = camera; G.sky = GFX.sky;
  const IS_TOUCH = GFX.IS_TOUCH;
  if (localStorage.getItem('aegis.settings') === null) G.settings.quality = IS_TOUCH ? 0 : 2;
  function applySettings() {
    GFX.setQuality(G.settings.quality | 0, { view: G.settings.view });
    if (G.crowd) G.crowd.setDensity(G.settings.quality | 0);
    document.body.classList.toggle('tp', !G.settings.fp);
    AUDIO.setVolume(G.settings.volume);
  }

  // ================= WORLD =================
  const CELL = 80, N = 36, SIZE = CELL * N, HALF = SIZE / 2, ROAD = 16, LOT = CELL - ROAD;
  G.WORLD = { CELL, N, SIZE, HALF };
  const cells = [];
  const boxes = []; // {x0,y0,z0,x1,y1,z1}
  const roofs = [];
  function cellIdx(x, z) {
    const cx = Math.floor((x + HALF) / CELL), cz = Math.floor((z + HALF) / CELL);
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return -1;
    return cz * N + cx;
  }
  function district(cx, cz) {
    const x = -HALF + (cx + 0.5) * CELL, z = -HALF + (cz + 0.5) * CELL;
    if (cz >= 32) return 'water';
    if (cz >= 29) return 'harbor';
    if (cx >= 11 && cx <= 13 && cz >= 14 && cz <= 19) return 'park';
    if (Math.hypot(x, z + 60) < 430) return 'downtown';
    if (x > 560) return 'industrial';
    if (x < -640) return 'oldtown';
    if (z < -700) return 'uptown';
    return 'midtown';
  }
  const special = {};
  const markSpecial = (p, kind) => { const i = cellIdx(p[0], p[2]); if (i >= 0 && !special[i]) special[i] = kind; };
  markSpecial([40, 0, 40], 'tower');
  markSpecial([-200, 0, -360], 'hq');
  markSpecial([880, 0, 120], 'power');
  markSpecial([300, 0, 1080], 'plaza'); // Halcyon Bridge landing (js/blackwater.js)
  D.BENCHES.forEach((b) => markSpecial(b.pos, 'plaza'));
  D.MISSIONS.forEach((m) => m.stages.forEach((s) => {
    if (s.items) s.items.forEach((p) => markSpecial(p, 'plaza'));
    if (s.targets) s.targets.forEach((p) => markSpecial(p, 'plaza'));
  }));

  const instData = []; // [cx,cy,cz,sx,sy,sz,color,win]
  const hsh = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
  function addBox(cell, x0, z0, x1, z1, y0, y1, color, win = 1, solid = true) {
    if (win === 1 && y0 < 1) {
      const r = hsh(x0, z0), d = cell.d;
      if (d === 'oldtown' || (d === 'midtown' && r < 0.55) || (d === 'harbor' && r < 0.4) || (d === 'industrial' && r < 0.35)) win = 3;
      else if (d === 'uptown' && r < 0.6) win = 4;
    } else if (win === 1 && y0 >= 1) { const below = instData.length && instData[instData.length - 1]; if (below && below[7] >= 3 && Math.abs(below[0] - (x0 + x1) / 2) < (x1 - x0)) win = below[7]; }
    instData.push([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color, win]);
    if (solid) { const b = { x0, y0, z0, x1, y1, z1 }; boxes.push(b); cell.boxes.push(b); }
  }
  const PAL = {
    downtown: [0x5a6a82, 0x4a5a70, 0x6f7f96, 0x3d4a5e, 0x7a8698, 0x556677],
    midtown: [0x8a7360, 0x7c6a5a, 0x9b8b78, 0x6b6f78, 0x8e8580, 0x6e5a4e],
    uptown: [0xa49a8a, 0x8f969e, 0x7d8a8f, 0xb0a593],
    oldtown: [0x8c4f3c, 0x9a5c45, 0x7d4a3a, 0xa36b4f, 0x6e4637],
    industrial: [0x5c6358, 0x6b6b60, 0x52585e, 0x726a5a],
    harbor: [0x6a6e74, 0x5f6b72, 0x7a7466],
  };
  const CONT = [0xb5452f, 0x2f6fb5, 0x3a9a5a, 0xc9a23a, 0x8a3ab5, 0xd06a2a];
  const trees = [];
  const W = mulberry(1337);
  const wr = (a, b) => a + W() * (b - a);
  const wpick = (arr) => arr[(W() * arr.length) | 0];
  function addRoof(x0, z0, x1, z1, y) { roofs.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, y, w: x1 - x0, d: z1 - z0 }); }
  const tanks = [], beacons = [];
  function roofProps(cell, x0, z0, x1, z1, y, tall) {
    if (x1 - x0 > 12 && z1 - z0 > 12) {
      const n = (W() * 3.2) | 0;
      for (let i = 0; i < n; i++) { const px = wr(x0 + 2, x1 - 6), pz = wr(z0 + 2, z1 - 6), s = wr(2.5, 4.5); addBox(cell, px, pz, px + s, pz + s * 0.8, y, y + wr(1.2, 2.4), 0x8a8f96, 0, false); }
      if (!tall && W() < 0.3) tanks.push([wr(x0 + 4, x1 - 4), y, wr(z0 + 4, z1 - 4)]);
    }
  }
  function building(cell, x0, z0, x1, z1, h, color, setback, win = 1) {
    addBox(cell, x0, z0, x1, z1, 0, h, color, win);
    let top = h, a0 = x0, b0 = z0, a1 = x1, b1 = z1;
    if (setback && h > 120 && x1 - x0 > 30 && z1 - z0 > 30) {
      const i = wr(5, 9), h2 = h + wr(20, 70);
      addBox(cell, x0 + i, z0 + i, x1 - i, z1 - i, h, h2, color, win);
      a0 = x0 + i; b0 = z0 + i; a1 = x1 - i; b1 = z1 - i; top = h2;
      if (W() < 0.5) { const ah = h2 + wr(15, 35), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; addBox(cell, cx - 0.6, cz - 0.6, cx + 0.6, cz + 0.6, h2, ah, 0x9a9a9a, 0, false); beacons.push([cx, ah + 0.6, cz]); }
    }
    addRoof(a0, b0, a1, b1, top);
    if (a1 - a0 > 8 && b1 - b0 > 8) {
      const pc = 0x9a958c, ph = 1.1, t = 0.45;
      addBox(cell, a0, b0, a1, b0 + t, top, top + ph, pc, 0, false); addBox(cell, a0, b1 - t, a1, b1, top, top + ph, pc, 0, false);
      addBox(cell, a0, b0 + t, a0 + t, b1 - t, top, top + ph, pc, 0, false); addBox(cell, a1 - t, b0 + t, a1, b1 - t, top, top + ph, pc, 0, false);
    }
    roofProps(cell, a0, b0, a1, b1, top, top > 100);
    if (top > 140) beacons.push([a0 + 1, top + 0.6, b0 + 1], [a1 - 1, top + 0.6, b1 - 1]);
  }
  function splitLot(cell, x0, z0, nx, nz, hmin, hmax, pal, gap) {
    const w = (LOT - gap * (nx - 1)) / nx, d = (LOT - gap * (nz - 1)) / nz;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const bx = x0 + i * (w + gap), bz = z0 + j * (d + gap);
      const ins = wr(0, 3);
      building(cell, bx + ins, bz + ins, bx + w - ins, bz + d - ins, wr(hmin, hmax), wpick(pal), false);
    }
  }
  // ---------- extra building shapes (instanced: round, octagonal, rotated slabs, gable roofs, pyramids, domes) ----------
  const SHP = { cyl: [], oct: [], boxr: [], gable: [], pyr: [], dome: [] };
  const _shQ = new THREE.Quaternion(), _shE = new THREE.Euler(), _shM = new THREE.Matrix4();
  function addShape(kind, x, y, z, sx, sy, sz, color, win, rotY = 0, rotZ = 0) {
    _shE.set(0, rotY, rotZ); _shQ.setFromEuler(_shE);
    SHP[kind].push([new THREE.Matrix4().compose(new V3(x, y, z), _shQ.clone(), new V3(sx, sy, sz)), color, win]);
  }
  function solid(cell, x0, z0, x1, z1, y0, y1) { const b = { x0, y0, z0, x1, y1, z1 }; boxes.push(b); cell.boxes.push(b); }
  const ROOFC = [0x8a3a28, 0x7a3020, 0x3d4652, 0x4a3a30, 0x5f2f22, 0x34404a];
  function roundTower(cell, cx, cz, r, h, color, glass) {
    const w = glass ? 2 : 1;
    addShape('cyl', cx, h / 2, cz, r, h, r, color, w); solid(cell, cx - r * 0.8, cz - r * 0.8, cx + r * 0.8, cz + r * 0.8, 0, h);
    let top = h, rt = r;
    if (W() < 0.65) { const r2 = r * wr(0.6, 0.8), h2 = wr(15, 50); addShape('cyl', cx, h + h2 / 2, cz, r2, h2, r2, color, w); solid(cell, cx - r2 * 0.8, cz - r2 * 0.8, cx + r2 * 0.8, cz + r2 * 0.8, h, h + h2); top = h + h2; rt = r2; }
    addShape('cyl', cx, top + 0.7, cz, rt * 1.03, 1.4, rt * 1.03, 0x8a93a3, 0);
    if (W() < 0.5) { const sh = wr(20, 45); addShape('cyl', cx, top + sh / 2, cz, 0.7, sh, 0.7, 0xb0b8c4, 0); beacons.push([cx, top + sh + 0.6, cz]); }
    else if (W() < 0.5) { addShape('dome', cx, top + 1.4, cz, rt * 0.9, rt * 0.5, rt * 0.9, 0x5a7a8a, 0); solid(cell, cx - rt * 0.6, cz - rt * 0.6, cx + rt * 0.6, cz + rt * 0.6, top, top + rt * 0.3); }
    addRoof(cx - rt * 0.5, cz - rt * 0.5, cx + rt * 0.5, cz + rt * 0.5, top + 1.4);
    if (top > 140) beacons.push([cx + rt * 0.9, top + 1.6, cz]);
  }
  function octTower(cell, cx, cz, r, h, color) {
    const tiers = 2 + ((W() * 2) | 0); let y = 0, rr = r;
    for (let t = 0; t < tiers; t++) {
      const th = t === tiers - 1 ? h - y : h * wr(0.35, 0.5); if (th <= 4) break;
      addShape('oct', cx, y + th / 2, cz, rr, th, rr, color, W() < 0.5 ? 2 : 1, Math.PI / 8); solid(cell, cx - rr * 0.82, cz - rr * 0.82, cx + rr * 0.82, cz + rr * 0.82, y, y + th);
      y += th; rr *= wr(0.72, 0.86);
    }
    addShape('pyr', cx, y, cz, rr * 1.3, wr(8, 22), rr * 1.3, 0x7f8a99, 0, Math.PI / 4); solid(cell, cx - rr * 0.5, cz - rr * 0.5, cx + rr * 0.5, cz + rr * 0.5, y, y + 4);
    addRoof(cx - rr * 0.4, cz - rr * 0.4, cx + rr * 0.4, cz + rr * 0.4, y + 4);
    if (y > 140) beacons.push([cx, y + 0.6, cz]);
  }
  function twistTower(cell, cx, cz, side, h, color) {
    const slab = 7.2, n = Math.max(6, Math.floor(h / slab)), tw = wr(0.025, 0.05) * (W() < 0.5 ? 1 : -1), win = W() < 0.7 ? 2 : 1;
    for (let i = 0; i < n; i++) addShape('boxr', cx, i * slab + slab / 2, cz, side, slab - 0.05, side, color, win, i * tw);
    for (let i = 0; i < n; i += 3) addShape('boxr', cx, i * slab + 0.15, cz, side + 0.8, 0.3, side + 0.8, 0x9aa4b2, 0, i * tw);
    const top = n * slab, hs = side * 0.36;
    solid(cell, cx - hs, cz - hs, cx + hs, cz + hs, 0, top);
    addShape('boxr', cx, top + 0.6, cz, side * 0.6, 1.2, side * 0.6, 0x7f8a99, 0, n * tw);
    addRoof(cx - hs * 0.8, cz - hs * 0.8, cx + hs * 0.8, cz + hs * 0.8, top + 1.2);
    beacons.push([cx, top + 1.8, cz]);
  }
  function steppedTower(cell, x0, z0, x1, z1, h, color, win) {
    const tiers = 3 + ((W() * 2) | 0); let y = 0, a0 = x0, b0 = z0, a1 = x1, b1 = z1;
    for (let t = 0; t < tiers; t++) {
      const th = t === tiers - 1 ? Math.max(12, h - y) : h * wr(0.3, 0.42);
      addBox(cell, a0, b0, a1, b1, y, y + th, color, win);
      addBox(cell, a0 - 0.4, b0 - 0.4, a1 + 0.4, b1 + 0.4, y + th - 0.8, y + th, 0x8a93a3, 0, false);
      y += th; const ins = Math.min((a1 - a0) * 0.14, wr(3, 6)); a0 += ins; b0 += ins; a1 -= ins; b1 -= ins;
      if (a1 - a0 < 10) break;
    }
    const cx = (a0 + a1) / 2, cz = (b0 + b1) / 2, ph = wr(10, 30);
    addShape('pyr', cx, y, cz, a1 - a0, ph, b1 - b0, W() < 0.5 ? 0x8a93a3 : 0x4a5a6a, 0); solid(cell, cx - (a1 - a0) * 0.25, cz - (b1 - b0) * 0.25, cx + (a1 - a0) * 0.25, cz + (b1 - b0) * 0.25, y, y + ph * 0.45);
    addRoof(a0, b0, a1, b1, y);
    if (W() < 0.6) { addShape('cyl', cx, y + ph + 10, cz, 0.5, 20, 0.5, 0xb0b8c4, 0); beacons.push([cx, y + ph + 20.6, cz]); }
  }
  function twinTowers(cell, x0, z0, x1, z1, color, win) {
    const h1 = wr(140, 230), h2 = h1 * wr(0.8, 1.0), w = (x1 - x0 - 12) / 2;
    building(cell, x0 + 2, z0 + 8, x0 + 2 + w, z1 - 8, h1, color, true, win);
    building(cell, x1 - 2 - w, z0 + 8, x1 - 2, z1 - 8, h2, color, true, win);
    const by = Math.min(h1, h2) * wr(0.55, 0.75), cz = (z0 + z1) / 2;
    addBox(cell, x0 + 2 + w, cz - 4, x1 - 2 - w, cz + 4, by, by + 6, 0x34485e, 2);
    addBox(cell, x0 + 2 + w, cz - 4.4, x1 - 2 - w, cz + 4.4, by - 0.6, by, 0x8a93a3, 0);
  }
  function lShape(cell, x0, z0, x1, z1, h, pal) {
    const c = wpick(pal), t = wr(22, 30), h2 = h * wr(0.7, 1.3);
    if (W() < 0.5) { building(cell, x0 + 2, z0 + 2, x1 - 2, z0 + t, h, c, false); building(cell, x0 + 2, z0 + t + 0.01, x0 + t, z1 - 2, h2, c, false); }
    else { building(cell, x0 + 2, z1 - t, x1 - 2, z1 - 2, h, c, false); building(cell, x1 - t, z0 + 2, x1 - 2, z1 - t - 0.01, h2, c, false); }
  }
  function uShape(cell, x0, z0, x1, z1, h, pal) {
    const c = wpick(pal), t = wr(16, 20);
    building(cell, x0 + 2, z0 + 2, x0 + t, z1 - 2, h, c, false);
    building(cell, x1 - t, z0 + 2, x1 - 2, z1 - 2, h, c, false);
    building(cell, x0 + t + 0.01, z0 + 2, x1 - t - 0.01, z0 + t, h * wr(0.6, 0.9), c, false);
    trees.push([(x0 + x1) / 2, (z0 + z1) / 2 + 10, wr(5, 8)]);
  }
  function gableHouse(cell, x0, z0, x1, z1, h, color, roofC) {
    addBox(cell, x0, z0, x1, z1, 0, h, color, 1);
    const along = x1 - x0 >= z1 - z0, rh = Math.min(x1 - x0, z1 - z0) * wr(0.35, 0.55), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (along) addShape('gable', cx, h, cz, x1 - x0 + 1, rh, z1 - z0 + 1.2, roofC, 0, 0);
    else addShape('gable', cx, h, cz, z1 - z0 + 1, rh, x1 - x0 + 1.2, roofC, 0, Math.PI / 2);
    solid(cell, x0 + (x1 - x0) * 0.2, z0 + (z1 - z0) * 0.2, x1 - (x1 - x0) * 0.2, z1 - (z1 - z0) * 0.2, h, h + rh * 0.5);
    if (W() < 0.3) { const ch = wr(2, 3.5); addBox(cell, x0 + 2, z0 + 2, x0 + 3.4, z0 + 3.4, h, h + rh * 0.6 + ch, 0x5a3a30, 0, false); }
  }
  function steeple(cell, cx, cz, color) {
    const s = 7, h = wr(26, 36);
    addBox(cell, cx - s, cz - s, cx + s, cz + s, 0, h, color, 1);
    addShape('pyr', cx, h, cz, s * 2.2, wr(16, 24), s * 2.2, 0x3d4652, 0);
    solid(cell, cx - s * 0.5, cz - s * 0.5, cx + s * 0.5, cz + s * 0.5, h, h + 6);
  }
  function domeBuilding(cell, x0, z0, x1, z1, h, color) {
    building(cell, x0 + 4, z0 + 4, x1 - 4, z1 - 4, h, color, false);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.min(x1 - x0, z1 - z0) * wr(0.24, 0.32), dh = wr(4, 9);
    addShape('cyl', cx, h + dh / 2, cz, r, dh, r, color, 1); solid(cell, cx - r * 0.75, cz - r * 0.75, cx + r * 0.75, cz + r * 0.75, h, h + dh);
    addShape('dome', cx, h + dh, cz, r * 1.02, r * wr(0.8, 1.0), r * 1.02, W() < 0.5 ? 0x5f9a86 : 0xb8b2a2, 0);
    solid(cell, cx - r * 0.55, cz - r * 0.55, cx + r * 0.55, cz + r * 0.55, h + dh, h + dh + r * 0.6);
    addShape('cyl', cx, h + dh + r + 2, cz, 0.3, 4, 0.3, 0xd0c080, 0);
  }
  function sawtooth(cell, x0, z0, x1, z1, h, color) {
    addBox(cell, x0, z0, x1, z1, 0, h, color, 1);
    const n = Math.max(3, Math.round((z1 - z0) / 9)), d = (z1 - z0) / n;
    for (let i = 0; i < n; i++) addShape('gable', (x0 + x1) / 2, h, z0 + d * (i + 0.5), x1 - x0, wr(3.5, 5), d, wpick([0x6a6e74, 0x5c6168, 0x7a7466]), 0, 0);
    solid(cell, x0 + 1, z0 + 1, x1 - 1, z1 - 1, h, h + 2);
  }
  function silos(cell, x0, z0, x1, z1) {
    const n = 2 + ((W() * 3) | 0), r = wr(4, 6), h = wr(20, 36), sx = x0 + 6 + r;
    for (let i = 0; i < n; i++) {
      const cx = sx + i * (r * 2 + 1.5); if (cx + r > x1 - 3) break; const cz = z0 + 10 + r;
      addShape('cyl', cx, h / 2, cz, r, h, r, 0xa8aaa6, 0); addShape('dome', cx, h, cz, r, r * 0.45, r, 0x8a8c88, 0);
      solid(cell, cx - r * 0.8, cz - r * 0.8, cx + r * 0.8, cz + r * 0.8, 0, h + r * 0.3);
      for (let k = 1; k < 4; k++) addShape('cyl', cx, (h * k) / 4, cz, r * 1.02, 0.4, r * 1.02, 0x6a6c68, 0);
    }
    building(cell, x0 + 4, z1 - 22, x1 - 4, z1 - 4, wr(8, 14), wpick(PAL.industrial), false);
  }
  function arched(cell, x0, z0, x1, z1, h, color) {
    addBox(cell, x0, z0, x1, z1, 0, h, color, 1);
    const r = (z1 - z0) / 2;
    addShape('cyl', (x0 + x1) / 2, h, (z0 + z1) / 2, r, x1 - x0, r * 0.55, 0x6f767e, 0, 0, Math.PI / 2);
    solid(cell, x0, z0 + r * 0.4, x1, z1 - r * 0.4, h, h + r * 0.35);
  }
  function crane(cell, x0, z0) {
    const lx = x0 + 10, lz = z0 + 40, H = wr(30, 42), Y = 0xd0a020;
    [[0, 0], [12, 0], [0, 12], [12, 12]].forEach(([dx, dz]) => addBox(cell, lx + dx, lz + dz, lx + dx + 1.4, lz + dz + 1.4, 0, H, Y, 0));
    addBox(cell, lx - 1, lz - 1, lx + 14.4, lz + 14.4, H, H + 2.5, Y, 0);
    addBox(cell, lx + 5, lz + 13, lx + 9, lz + 50, H + 1, H + 3, Y, 0, false);
    addBox(cell, lx + 5.5, lz - 12, lx + 8.5, lz + 1, H + 1, H + 3, Y, 0, false);
    addBox(cell, lx + 4, lz - 12, lx + 10, lz - 6, H - 4, H + 1, 0x8a8a80, 0, false);
    beacons.push([lx + 7, H + 3.6, lz + 49]);
  }
  for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
    const idx = cz * N + cx;
    const d = special[idx] || district(cx, cz);
    const cell = { d, boxes: [] };
    cells[idx] = cell;
    const x0 = -HALF + cx * CELL + ROAD / 2, z0 = -HALF + cz * CELL + ROAD / 2, x1 = x0 + LOT, z1 = z0 + LOT;
    switch (d) {
      case 'downtown': {
        const r = W(), cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2, col = wpick(PAL.downtown);
        if (r < 0.16) roundTower(cell, cxm, czm, wr(20, 28), wr(110, 250), col, W() < 0.75);
        else if (r < 0.28) octTower(cell, cxm, czm, wr(24, 29), wr(120, 240), col);
        else if (r < 0.4) twistTower(cell, cxm, czm, wr(30, 38), wr(140, 270), col);
        else if (r < 0.52) steppedTower(cell, x0 + 2, z0 + 2, x1 - 2, z1 - 2, wr(130, 250), col, W() < 0.5 ? 2 : 1);
        else if (r < 0.6) twinTowers(cell, x0, z0, x1, z1, col, W() < 0.6 ? 2 : 1);
        else if (r < 0.8) { const i2 = wr(2, 8); building(cell, x0 + i2, z0 + i2, x1 - i2, z1 - i2, wr(90, 250), col, true, W() < 0.45 ? 2 : 1); }
        else if (W() < 0.5) { building(cell, x0 + 2, z0 + 2, x0 + 30, z1 - 2, wr(60, 200), col, true, W() < 0.45 ? 2 : 1); roundTower(cell, x0 + 48, czm, 13, wr(70, 180), wpick(PAL.downtown), true); }
        else { building(cell, x0 + 2, z0 + 2, x1 - 2, z0 + 30, wr(60, 180), col, true, W() < 0.45 ? 2 : 1); building(cell, x0 + 2, z0 + 34, x1 - 2, z1 - 2, wr(70, 210), wpick(PAL.downtown), true, W() < 0.45 ? 2 : 1); }
        break;
      }
      case 'midtown': {
        const r = W();
        if (r < 0.16) lShape(cell, x0, z0, x1, z1, wr(25, 70), PAL.midtown);
        else if (r < 0.28) uShape(cell, x0, z0, x1, z1, wr(20, 55), PAL.midtown);
        else if (r < 0.36) roundTower(cell, (x0 + x1) / 2, (z0 + z1) / 2, wr(18, 24), wr(35, 90), wpick(PAL.midtown), false);
        else if (r < 0.44) { gableHouse(cell, x0 + 2, z0 + 2, x0 + 30, z1 - 2, wr(14, 24), wpick(PAL.midtown), wpick(ROOFC)); building(cell, x0 + 34, z0 + 2, x1 - 2, z1 - 2, wr(25, 70), wpick(PAL.midtown), false); }
        else splitLot(cell, x0, z0, W() < 0.5 ? 2 : 1, 2, 18, 80, PAL.midtown, 4);
        break;
      }
      case 'uptown': {
        const r = W();
        if (r < 0.18) domeBuilding(cell, x0, z0, x1, z1, wr(18, 34), wpick(PAL.uptown));
        else if (r < 0.36) octTower(cell, (x0 + x1) / 2, (z0 + z1) / 2, wr(18, 26), wr(50, 130), wpick(PAL.uptown));
        else if (r < 0.52) steppedTower(cell, x0 + 4, z0 + 4, x1 - 4, z1 - 4, wr(50, 120), wpick(PAL.uptown), 1);
        else if (r < 0.62) lShape(cell, x0, z0, x1, z1, wr(30, 90), PAL.uptown);
        else splitLot(cell, x0, z0, W() < 0.6 ? 1 : 2, W() < 0.5 ? 1 : 2, 30, 130, PAL.uptown, 6);
        break;
      }
      case 'oldtown': {
        if (W() < 0.12) { steeple(cell, x0 + 14, z0 + 14, wpick(PAL.oldtown)); gableHouse(cell, x0 + 26, z0 + 4, x1 - 2, z1 - 4, wr(10, 16), wpick(PAL.oldtown), wpick(ROOFC)); break; }
        const nx = W() < 0.5 ? 2 : 3, nz = 2, gap = 2, w = (LOT - gap * (nx - 1)) / nx, dd = (LOT - gap * (nz - 1)) / nz;
        for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
          const bx = x0 + a * (w + gap), bz = z0 + b * (dd + gap), ins = wr(0, 2.5);
          if (W() < 0.72) gableHouse(cell, bx + ins, bz + ins, bx + w - ins, bz + dd - ins, wr(7, 18), wpick(PAL.oldtown), wpick(ROOFC));
          else building(cell, bx + ins, bz + ins, bx + w - ins, bz + dd - ins, wr(8, 24), wpick(PAL.oldtown), false);
        }
        break;
      }
      case 'industrial': {
        const r = W();
        if (r < 0.3) sawtooth(cell, x0 + 4, z0 + 4, x1 - 4, z1 - 4, wr(8, 14), wpick(PAL.industrial));
        else if (r < 0.5) silos(cell, x0, z0, x1, z1);
        else if (r < 0.68) arched(cell, x0 + 4, z0 + 6, x1 - 4, z1 - 6, wr(6, 10), wpick(PAL.industrial));
        else {
          const h = wr(10, 22);
          building(cell, x0 + 4, z0 + 4, x1 - 4, z1 - wr(4, 20), h, wpick(PAL.industrial), false);
          if (W() < 0.4) { const cxp = x0 + wr(10, 50), czp = z0 + wr(10, 40), ch = h + wr(25, 50); addBox(cell, cxp - 2.5, czp - 2.5, cxp + 2.5, czp + 2.5, h, ch, 0x55504a, 0); beacons.push([cxp, ch + 0.5, czp]); }
        }
        break;
      }
      case 'harbor': {
        if (cz === 31 && W() < 0.45) { crane(cell, x0, z0); break; }
        const r = W();
        if (r < 0.3) building(cell, x0 + 4, z0 + 6, x1 - 4, z1 - 6, wr(8, 16), wpick(PAL.harbor), false);
        else if (r < 0.5) arched(cell, x0 + 4, z0 + 8, x1 - 4, z1 - 8, wr(6, 9), wpick(PAL.harbor));
        else {
          for (let r2 = 0; r2 < 4; r2++) for (let c = 0; c < 6; c++) {
            if (W() < 0.3) continue;
            const stack = 1 + ((W() * 3) | 0);
            const bx = x0 + 4 + c * 9.5, bz = z0 + 6 + r2 * 14;
            for (let s2 = 0; s2 < stack; s2++) addBox(cell, bx, bz, bx + 8, bz + 12, s2 * 2.8, s2 * 2.8 + 2.7, wpick(CONT), 0);
            addRoof(bx, bz, bx + 8, bz + 12, stack * 2.8);
          }
        }
        break;
      }
      case 'park': for (let t = 0; t < 22; t++) trees.push([wr(x0, x1), wr(z0, z1), wr(5, 11)]); break;
      case 'tower': {
        addBox(cell, x0 + 8, z0 + 8, x1 - 8, z1 - 8, 0, 340, 0x2a3a6a, 2);
        addBox(cell, x0 + 18, z0 + 18, x1 - 18, z1 - 18, 340, 352, 0x1a2242, 0);
        addRoof(x0 + 8, z0 + 8, x1 - 8, z1 - 8, 340);
        break;
      }
      case 'hq': {
        // AEGIS Tower: Rhea's HQ. Glass shaft, hollow hangar deck at 200 m with a south landing pad, crown + spire.
        const A = -228, B = -172, C = -388, Dz = -332, GL = 0x2c3e55, MT = 0x3a404c;
        addBox(cell, A, C, B, Dz, 0, 200, GL, 2);
        addBox(cell, -212, Dz, -188, -304, 196.5, 200, MT, 0);                 // landing pad
        addBox(cell, A, C, A + 4, Dz, 200, 216, MT, 0); addBox(cell, B - 4, C, B, Dz, 200, 216, MT, 0);   // side walls
        addBox(cell, A + 4, C, B - 4, C + 4, 200, 216, MT, 0);                   // back wall
        addBox(cell, A + 4, Dz - 4, -210, Dz, 200, 216, MT, 0); addBox(cell, -190, Dz - 4, B - 4, Dz, 200, 216, MT, 0); // front wall
        addBox(cell, -210, Dz - 4, -190, Dz, 212, 216, MT, 0);                   // door lintel
        addBox(cell, A, C, B, Dz, 216, 220, MT, 0);                              // ceiling slab
        addBox(cell, A + 3, C + 3, B - 3, Dz - 3, 220, 300, GL, 2);
        addBox(cell, A + 9, C + 9, B - 9, Dz - 9, 300, 322, 0x24344a, 2);
        addBox(cell, -201.5, -361.5, -198.5, -358.5, 322, 362, 0xaab4c4, 0, false);
        beacons.push([-200, 362.8, -360], [A + 4, 300.6, C + 4], [B - 4, 300.6, Dz - 4]);
        addRoof(A + 9, C + 9, B - 9, Dz - 9, 322);
        break;
      }
      case 'power': {
        addBox(cell, 875, 115, 885, 125, 0, 10, 0x777766, 0);
        addBox(cell, 856, 100, 868, 112, 0, 34, 0x8a8a80, 0);
        addBox(cell, 892, 128, 904, 140, 0, 34, 0x8a8a80, 0);
        break;
      }
      default: break; // plaza, water
    }
  }
  // curbs (raised edge between sidewalk and road) and street trees along sidewalks
  const curbs = [];
  for (let cz = 0; cz < 32; cz++) for (let cx = 0; cx < N; cx++) {
    const c = cells[cz * N + cx]; if (!c || c.d === 'water') continue;
    const bx = -HALF + cx * CELL, bz = -HALF + cz * CELL;
    curbs.push([bx + 5, bz + 5, bx + 75, bz + 5.3], [bx + 5, bz + 74.7, bx + 75, bz + 75], [bx + 5, bz + 5.3, bx + 5.3, bz + 74.7], [bx + 74.7, bz + 5.3, bx + 75, bz + 74.7]);
    if (['midtown', 'uptown', 'downtown', 'oldtown', 'plaza'].includes(c.d)) {
      for (let k = 14; k <= 66; k += 13) {
        if (Math.abs(k - 40) < 5) continue;
        if (hsh(bx + k, bz) < 0.75) trees.push([bx + k, bz + 73.5, 4 + hsh(bz, bx + k) * 3, 1]);
        if (hsh(bx, bz + k) < 0.75) trees.push([bx + 73.5, bz + k, 4 + hsh(bz + k, bx) * 3, 1]);
      }
    }
  }
  G.roofs = roofs;
  G.districtAt = (x, z) => { const cx = Math.floor((x + HALF) / CELL), cz = Math.floor((z + HALF) / CELL); if (cx < 0 || cz < 0 || cx >= N || cz >= N) return 'sea'; return district(cx, cz); };
  G.cells = cells;

  // Building instanced mesh with procedural facade shader (windows, glass, storefronts, reflections)
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  const winAttr = new Float32Array(instData.length);
  instData.forEach((d, i) => (winAttr[i] = d[7]));
  bGeo.setAttribute('aWin', new THREE.InstancedBufferAttribute(winAttr, 1));
  const bMat = GFX.facadeMaterial(false);
  {
    const im = new THREE.InstancedMesh(bGeo, bMat, instData.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    instData.forEach((d, i) => {
      m.makeScale(d[3], d[4], d[5]); m.setPosition(d[0], d[1], d[2]);
      im.setMatrixAt(i, m); im.setColorAt(i, c.setHex(d[6]));
    });
    im.frustumCulled = false; im.castShadow = true;
    scene.add(im); GFX.farCaster(im);
    // extra shapes
    const gableGeo = (() => {
      const P = [-.5, 0, .5, .5, 0, .5, .5, 1, 0, -.5, 0, .5, .5, 1, 0, -.5, 1, 0, -.5, 0, -.5, -.5, 1, 0, .5, 1, 0, -.5, 0, -.5, .5, 1, 0, .5, 0, -.5,
        -.5, 0, -.5, -.5, 0, .5, -.5, 1, 0, .5, 0, .5, .5, 0, -.5, .5, 1, 0];
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
    })();
    const pyrGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); pyrGeo.rotateY(Math.PI / 4); pyrGeo.translate(0, 0.5, 0);
    const domeGeo = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const GEO = { cyl: [new THREE.CylinderGeometry(1, 1, 1, 32, 1), true], oct: [new THREE.CylinderGeometry(1, 1, 1, 8, 1), true], boxr: [new THREE.BoxGeometry(1, 1, 1), false], gable: [gableGeo, false], pyr: [pyrGeo, false], dome: [domeGeo, false] };
    const roundMat = GFX.facadeMaterial(true);
    for (const k in SHP) {
      const list = SHP[k]; if (!list.length) continue;
      const geo = GEO[k][0].clone(), wa = new Float32Array(list.length);
      list.forEach((d, i2) => (wa[i2] = d[2]));
      geo.setAttribute('aWin', new THREE.InstancedBufferAttribute(wa, 1));
      const mesh = new THREE.InstancedMesh(geo, GEO[k][1] ? roundMat : bMat, list.length);
      list.forEach((d, i2) => { mesh.setMatrixAt(i2, d[0]); mesh.setColorAt(i2, c.setHex(d[1])); });
      mesh.frustumCulled = false; mesh.castShadow = true; scene.add(mesh); GFX.farCaster(mesh);
    }
    // rooftop water tanks
    const tk = new THREE.InstancedMesh(new THREE.CylinderGeometry(2, 2, 3.5, 12), new THREE.MeshLambertMaterial({ color: 0x6e5240 }), tanks.length);
    const tr = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 1.4, 12), new THREE.MeshLambertMaterial({ color: 0x4a3a30 }), tanks.length);
    const tl = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 2.2, 3.4), new THREE.MeshLambertMaterial({ color: 0x2a2a2e }), tanks.length);
    tanks.forEach((t, i) => {
      m.makeTranslation(t[0], t[1] + 4, t[2]); tk.setMatrixAt(i, m);
      m.makeTranslation(t[0], t[1] + 6.4, t[2]); tr.setMatrixAt(i, m);
      m.makeTranslation(t[0], t[1] + 1.1, t[2]); tl.setMatrixAt(i, m);
    });
    tk.castShadow = tr.castShadow = tl.castShadow = true;
    scene.add(tk, tr, tl);
    // blinking aircraft-warning lights
    const bm = glowM(0xff2030, 3, { fog: false });
    const bi = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 8, 6), bm, beacons.length);
    beacons.forEach((b, i) => { m.makeTranslation(b[0], b[1], b[2]); bi.setMatrixAt(i, m); });
    bi.frustumCulled = false; scene.add(bi);
    G.beaconMat = bm;
  }
  // Trees
  {
    // Canopies: several lumpy leaf clumps with soft "spherical" normals, darker inside and underneath,
    // procedural leaf breakup, wind sway, and light glowing through the leaves when the sun is behind them.
    const lumpy = (geo, cx, cy, cz, amp, seed) => { const pp = geo.attributes.position, v = new V3(); for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); const k = 1 + (hsh(Math.round(v.x * 30) + seed, Math.round(v.y * 30 + v.z * 17)) - 0.5) * amp; pp.setXYZ(i, cx + v.x * k, cy + v.y * k, cz + v.z * k); } return geo; };
    function buildCanopy(clumps, seg, norm) {
      const P = [], Nn = [], C = [], I = []; let base = 0;
      clumps.forEach(([cx, cy, cz, r], ci) => {
        const g = lumpy(new THREE.SphereGeometry(r, seg, Math.max(5, seg - 2)), cx, cy, cz, 0.42, ci * 7);
        g.computeVertexNormals();
        const pp = g.attributes.position, nn = g.attributes.normal, v = new V3(), sn = new V3();
        for (let i = 0; i < pp.count; i++) {
          v.fromBufferAttribute(pp, i); sn.copy(v).normalize();
          const n0 = new V3().fromBufferAttribute(nn, i).multiplyScalar(0.4).addScaledVector(sn, 0.6).normalize();
          P.push(v.x / norm, v.y / norm, v.z / norm); Nn.push(n0.x, n0.y, n0.z);
          const ao = THREE.MathUtils.smoothstep(v.y, -0.9, 0.9) * 0.55 + 0.45, out = THREE.MathUtils.smoothstep(v.length(), 0.4, 1.4);
          const k = ao * (0.72 + 0.28 * out);
          C.push(k * 0.92, k, k * 0.85);
        }
        const ix = g.index.array; for (let i = 0; i < ix.length; i++) I.push(ix[i] + base);
        base += pp.count;
      });
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); out.setIndex(I);
      return out;
    }
    const broadGeo = buildCanopy([[0, 0, 0, 1.0], [0.62, 0.12, 0.22, 0.74], [-0.58, 0.08, -0.26, 0.72], [0.12, 0.5, -0.5, 0.66], [-0.2, 0.55, 0.48, 0.64], [0.4, -0.28, -0.52, 0.58], [-0.45, -0.25, 0.42, 0.56]], 9, 1.45);
    // conifer: four drooping tiers
    const coniGeo = (() => {
      const P = [], Nn = [], C = [], I = []; let base = 0;
      [[0, 0.62, 0.42], [0.3, 0.5, 0.36], [0.58, 0.36, 0.3], [0.82, 0.2, 0.22]].forEach(([y, r, h], ti) => {
        const g = new THREE.ConeGeometry(r, h, 11, 2, true); g.translate(0, (y - 0.5) * 1.6 + h / 2, 0);
        const pp = g.attributes.position, v = new V3();
        for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); const rr = Math.hypot(v.x, v.z); if (rr > r * 0.7) v.y -= 0.06 + 0.05 * hsh(i, ti); const k = 1 + (hsh(Math.round(v.x * 40), Math.round(v.z * 40) + ti) - 0.5) * 0.25; pp.setXYZ(i, v.x * k, v.y, v.z * k); }
        g.computeVertexNormals();
        const nn = g.attributes.normal;
        for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); P.push(v.x, v.y, v.z); Nn.push(nn.getX(i), nn.getY(i) * 0.6 + 0.4, nn.getZ(i)); const k = 0.55 + 0.45 * THREE.MathUtils.smoothstep(Math.hypot(v.x, v.z), 0.0, 0.5); C.push(k * 0.85, k, k * 0.9); }
        const ix = g.index.array; for (let i = 0; i < ix.length; i++) I.push(ix[i] + base); base += pp.count;
      });
      const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); out.setIndex(I);
      return out;
    })();
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMap: ENV, envMapIntensity: 0.35, side: THREE.DoubleSide });
    leafMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = GFX.U.uTime; sh.uniforms.uKeyDir = GFX.U.uKeyDir; sh.uniforms.uKeyCol = GFX.U.uKeyCol; sh.uniforms.uRain = GFX.U.uRain;
      sh.vertexShader = 'uniform float uTime, uRain; varying vec3 vLeafP; varying vec3 vLeafW;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ipos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float ph = dot(ipos.xz, vec2(0.071, 0.113)), wind = 1.0 + uRain * 2.5;
        float sway = (sin(uTime * 1.25 + ph) * 0.6 + sin(uTime * 3.1 + ph * 1.7 + position.y * 3.0 + position.x * 2.0) * 0.3) * smoothstep(-0.8, 1.0, position.y);
        transformed.x += sway * 0.045 * wind; transformed.z += sway * 0.03 * wind;
        vLeafP = position * 3.3 + ipos * 0.37;
        vLeafW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = 'uniform vec3 uKeyDir, uKeyCol; varying vec3 vLeafP; varying vec3 vLeafW;\nfloat lh(vec3 p){ p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\nfloat ln3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(lh(i), lh(i + vec3(1,0,0)), f.x), mix(lh(i + vec3(0,1,0)), lh(i + vec3(1,1,0)), f.x), f.y), mix(mix(lh(i + vec3(0,0,1)), lh(i + vec3(1,0,1)), f.x), mix(lh(i + vec3(0,1,1)), lh(i + vec3(1,1,1)), f.x), f.y), f.z); }\n'
        + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float lf = ln3(vLeafP * 2.4) * 0.6 + ln3(vLeafP * 6.1) * 0.4;
          diffuseColor.rgb *= 0.62 + 0.75 * lf;`)
          .replace('#include <output_fragment>', `#include <output_fragment>
          vec3 Vw = normalize(cameraPosition - vLeafW);
          float back = pow(max(dot(-Vw, uKeyDir), 0.0), 3.0);
          gl_FragColor.rgb += diffuseColor.rgb * uKeyCol * back * 0.6 * smoothstep(-0.05, 0.15, uKeyDir.y);`);
    };
    const broadL = trees.filter((t) => !(!t[3] && hsh(t[0], t[1]) < 0.35)), coniL = trees.filter((t) => !t[3] && hsh(t[0], t[1]) < 0.35);
    const cone = new THREE.InstancedMesh(broadGeo, leafMat, broadL.length), cone2 = new THREE.InstancedMesh(coniGeo, leafMat, coniL.length);
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x3e2e22, roughness: 0.95 });
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.3, 1, 8), barkMat, trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), cc = new THREE.Color();
    let bi2 = 0, ci2 = 0;
    trees.forEach((t, i) => {
      const s = t[2], conifer = !t[3] && hsh(t[0], t[1]) < 0.35, th = conifer ? 1.6 : 2.6;
      q.setFromAxisAngle(new V3(0, 1, 0), hsh(t[1], t[0]) * 6.28);
      if (conifer) {
        m.compose(new V3(t[0], th + s * 0.75, t[1]), q, new V3(s * 0.5, s * 1.05, s * 0.5)); cone2.setMatrixAt(ci2, m);
        cone2.setColorAt(ci2++, cc.setHSL(0.36 + hsh(t[0] * 3, t[1]) * 0.05, 0.32 + hsh(t[1], t[0] * 2) * 0.12, 0.13 + hsh(t[0], t[1] * 5) * 0.04));
      } else {
        const sq = 0.9 + hsh(t[0] * 7, t[1]) * 0.25;
        m.compose(new V3(t[0], th + s * 0.52, t[1]), q, new V3(s * 0.58 * sq, s * 0.5, s * 0.58 / sq)); cone.setMatrixAt(bi2, m);
        cone.setColorAt(bi2++, cc.setHSL(0.21 + hsh(t[0] * 3, t[1]) * 0.09, 0.38 + hsh(t[1], t[0] * 2) * 0.18, 0.2 + hsh(t[0], t[1] * 5) * 0.07));
      }
      m.makeScale(1, th + s * 0.3, 1); m.setPosition(t[0], (th + s * 0.3) / 2, t[1]); trunk.setMatrixAt(i, m);
    });
    cone.castShadow = cone2.castShadow = trunk.castShadow = true; cone.receiveShadow = cone2.receiveShadow = true;
    scene.add(cone, cone2, trunk);
    const curbMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.9 }), curbs.length);
    curbs.forEach((b, i) => { m.makeScale(b[2] - b[0], 0.16, b[3] - b[1]); m.setPosition((b[0] + b[2]) / 2, 0.08, (b[1] + b[3]) / 2); curbMesh.setMatrixAt(i, m); });
    curbMesh.receiveShadow = true; scene.add(curbMesh);
  }

  // Ground texture (also used for the maps)
  const GC = 2048, gk = GC / SIZE;
  const toPx = (v) => (v + HALF) * gk;
  const ground = document.createElement('canvas');
  ground.width = ground.height = GC;
  {
    const g = ground.getContext('2d');
    g.fillStyle = '#24262b'; g.fillRect(0, 0, GC, GC);
    const lotCol = { park: '#2e5a33', plaza: '#666a73', harbor: '#4a4c50', industrial: '#44463f', tower: '#3a4466', power: '#4d4b40' };
    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
      const c = cells[cz * N + cx];
      const x0 = -HALF + cx * CELL + ROAD / 2, z0 = -HALF + cz * CELL + ROAD / 2;
      g.fillStyle = '#4b4e56'; g.fillRect(toPx(x0 - 3), toPx(z0 - 3), (LOT + 6) * gk, (LOT + 6) * gk);
      g.fillStyle = lotCol[c.d] || '#3b3e45'; g.fillRect(toPx(x0), toPx(z0), LOT * gk, LOT * gk);
      if (c.d === 'plaza') { g.strokeStyle = '#7b7f88'; g.lineWidth = 1; for (let k = 1; k < 8; k++) { g.beginPath(); g.moveTo(toPx(x0 + k * 8), toPx(z0)); g.lineTo(toPx(x0 + k * 8), toPx(z0 + LOT)); g.stroke(); } }
    }
    g.strokeStyle = '#a8913a'; g.lineWidth = 0.8; g.setLineDash([4, 5]);
    for (let k = 1; k < N; k++) {
      const L = toPx(-HALF + k * CELL);
      g.beginPath(); g.moveTo(L, 0); g.lineTo(L, toPx(32 * CELL - HALF)); g.stroke();
      if (k < 32) { g.beginPath(); g.moveTo(0, L); g.lineTo(GC, L); g.stroke(); }
    }
    g.setLineDash([]);
    g.fillStyle = '#1b4a6a'; g.fillRect(0, toPx(32 * CELL - HALF - 4), GC, GC);
  }
  const groundTex = new THREE.CanvasTexture(ground);
  {
    const LAND_Z = 32 * CELL - HALF - 4;
    const gmat = GFX.groundMaterial(groundTex);
    groundTex.anisotropy = GFX.MAX_ANISO;
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, LAND_Z + HALF), gmat);
    gm.rotation.x = -Math.PI / 2; gm.position.set(0, 0, (LAND_Z - HALF) / 2); scene.add(gm);
    const smat = GFX.seaMaterial();
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), smat);
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.3; scene.add(sea);
    GFX.reflectHide.push(gm, sea); // they are the mirror
    gm.receiveShadow = true;
    // street lamps
    const lamps = [];
    for (let cz = 0; cz < 32; cz++) for (let cx = 0; cx < N; cx++) {
      const x = -HALF + cx * CELL, z = -HALF + cz * CELL;
      lamps.push([x + 6.5, z + 6.5], [x + 6.5, z + 40], [x + 40, z + 6.5]);
    }
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 7, 5), new THREE.MeshLambertMaterial({ color: 0x25262b }), lamps.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 0.22, 0.5), glowM(0xffc888, 1.9), lamps.length); G.lampHeadMat = head.material;
    const m = new THREE.Matrix4();
    lamps.forEach((l, i) => { m.makeTranslation(l[0], 3.5, l[1]); pole.setMatrixAt(i, m); m.makeTranslation(l[0], 7.05, l[1]); head.setMatrixAt(i, m); });
    pole.castShadow = true;
    scene.add(pole, head);
  }
  // Minimap canvas = ground + building footprints
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = mapCanvas.height = GC;
  {
    const g = mapCanvas.getContext('2d');
    g.drawImage(ground, 0, 0);
    boxes.forEach((b) => {
      const h = b.y1; const v = clamp(90 + h * 0.5, 90, 200) | 0;
      g.fillStyle = `rgb(${v},${v + 5},${v + 18})`;
      g.fillRect(toPx(b.x0), toPx(b.z0), (b.x1 - b.x0) * gk, (b.z1 - b.z0) * gk);
    });
  }
  G.mapCanvas = mapCanvas; G.toPx = toPx; G.mapScale = gk;

  // Power station visuals and Cobalt Tower crown
  {
    const mat = new THREE.MeshLambertMaterial({ color: 0x9a9a90 });
    [[862, 106], [898, 134]].forEach(([x, z]) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 34, 12, 1, true), mat);
      t.position.set(x, 17, z); scene.add(t);
    });
    const coil = new THREE.Mesh(new THREE.TorusGeometry(6, 0.6, 6, 20), glowM(0x66ccff, 2.5));
    coil.position.set(880, 13, 120); coil.rotation.x = Math.PI / 2; scene.add(coil);
    G.powerCoil = coil;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(26, 1, 6, 40), glowM(0x3355ff, 2.4));
    ring.position.set(40, 354, 40); ring.rotation.x = Math.PI / 2; scene.add(ring);
    G.towerRing = ring;
  }

  // Collision helpers
  // Extra solids outside the city grid (Blackwater Rock, the Halcyon Bridge): bucketed by 80 m cells.
  const XB = new Map(); let xbCount = 0;
  const xkey = (ix, iz) => (ix + 512) * 4096 + (iz + 512);
  G.addSolid = function (x0, y0, z0, x1, y1, z1) {
    const b = { x0, y0, z0, x1, y1, z1 }; xbCount++;
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
      const k = xkey(ix, iz); let a = XB.get(k); if (!a) XB.set(k, (a = [])); a.push(b);
    }
    return b;
  };
  const xbAt = (x, z) => (xbCount ? XB.get(xkey(Math.floor(x / CELL), Math.floor(z / CELL))) : null);
  function solidAt(x, y, z) {
    if (y < 0) return true;
    const xb = xbAt(x, z);
    if (xb) for (let k = 0; k < xb.length; k++) { const b = xb[k]; if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.y1) return true; }
    const i = cellIdx(x, z); if (i < 0) return false;
    const bs = cells[i].boxes;
    for (let k = 0; k < bs.length; k++) { const b = bs[k]; if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.y1) return true; }
    return false;
  }
  G.solidAt = solidAt;
  // Push a sphere out of buildings. Returns +1 if landed on top, 1 if hit side, 0 none.
  const _xbSeen = new Set();
  function collideSphere(p, r, vel) {
    let res = 0;
    const cx = Math.floor((p.x + HALF) / CELL), cz = Math.floor((p.z + HALF) / CELL);
    const lists = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= N || z >= N) continue;
      lists.push(cells[z * N + x].boxes);
    }
    if (xbCount) {
      _xbSeen.clear(); const xl = [];
      for (let ix = Math.floor((p.x - r) / CELL); ix <= Math.floor((p.x + r) / CELL); ix++) for (let iz = Math.floor((p.z - r) / CELL); iz <= Math.floor((p.z + r) / CELL); iz++) {
        const a = XB.get(xkey(ix, iz)); if (a) a.forEach((b) => { if (!_xbSeen.has(b)) { _xbSeen.add(b); xl.push(b); } });
      }
      if (xl.length) lists.push(xl);
    }
    for (const bs of lists) {
      for (let k = 0; k < bs.length; k++) {
        const b = bs[k];
        if (p.x > b.x0 - r && p.x < b.x1 + r && p.z > b.z0 - r && p.z < b.z1 + r && p.y > b.y0 - r && p.y < b.y1 + r) {
          const pen = [p.x - (b.x0 - r), b.x1 + r - p.x, p.y - (b.y0 - r), b.y1 + r - p.y, p.z - (b.z0 - r), b.z1 + r - p.z];
          let mi = 0; for (let q = 1; q < 6; q++) if (pen[q] < pen[mi]) mi = q;
          if (mi === 0) { p.x = b.x0 - r; if (vel && vel.x > 0) vel.x = 0; }
          else if (mi === 1) { p.x = b.x1 + r; if (vel && vel.x < 0) vel.x = 0; }
          else if (mi === 2) { p.y = b.y0 - r; if (vel && vel.y > 0) vel.y = 0; }
          else if (mi === 3) { p.y = b.y1 + r; if (vel && vel.y < 0) vel.y = 0; res = 2; }
          else if (mi === 4) { p.z = b.z0 - r; if (vel && vel.z > 0) vel.z = 0; }
          else { p.z = b.z1 + r; if (vel && vel.z < 0) vel.z = 0; }
          if (!res) res = 1;
        }
      }
    }
    return res;
  }
  function rayWorld(o, d, maxD) {
    const step = 2.5;
    for (let t = step; t < maxD; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (solidAt(x, y, z)) {
        let a = t - step, b = t;
        for (let i = 0; i < 5; i++) { const m = (a + b) / 2; if (solidAt(o.x + d.x * m, o.y + d.y * m, o.z + d.z * m)) b = m; else a = m; }
        return a;
      }
    }
    return maxD;
  }
  const _losV = new V3();
  function los(a, b) { _losV.subVectors(b, a); const L = _losV.length(); _losV.divideScalar(L || 1); return rayWorld(a, _losV, L) >= L - 0.5; }
  G.groundHeight = function (x, z, maxY = Infinity) {
    const i = cellIdx(x, z); let h = 0;
    const xb = xbAt(x, z);
    if (xb) xb.forEach((b) => { if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.y1 <= maxY + 0.6) h = Math.max(h, b.y1); });
    if (i < 0) return h;
    cells[i].boxes.forEach((b) => { if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.y1 <= maxY + 0.6) h = Math.max(h, b.y1); });
    return h;
  };
  G.rayWorld = (o, d, maxD) => rayWorld(o, d, maxD);
  G.collideSphere = (p, r, v) => collideSphere(p, r, v);

  // Traffic
  const cars = [];
  const carGeo = rbox(1, 1, 1, 0.18);
  const carMesh = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ metalness: 0.6, roughness: 0.32, envMap: ENV, envMapIntensity: 1.2 }), 160);
  const cabMesh = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.08, envMap: ENV, envMapIntensity: 1.6 }), 160);
  cabMesh.frustumCulled = false; cabMesh.castShadow = true; scene.add(cabMesh);
  {
    const c = new THREE.Color();
    for (let i = 0; i < 160; i++) {
      const axisX = i % 2 === 0, k = 1 + ((W() * (N - 1)) | 0), dir = W() < 0.5 ? 1 : -1;
      const L = -HALF + k * CELL;
      if (axisX && L > 32 * CELL - HALF - 10) { i--; continue; }
      cars.push({ axisX, line: L + dir * 3.5, s: wr(-HALF, HALF), v: dir * wr(10, 18), hp: 60, wreck: false, roll: 0, burn: 0, x: 0, z: 0 });
      carMesh.setColorAt(cars.length - 1, c.setHex(wpick([0xdddddd, 0x222222, 0x8a1a1a, 0x1a3a8a, 0xc9b23a, 0x556677, 0x777777])));
    }
    carMesh.frustumCulled = false; carMesh.castShadow = true; scene.add(carMesh);
  }
  const carLights = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), cars.length * 2);
  {
    const hc = new THREE.Color(2.8, 2.6, 2.2), tc = new THREE.Color(2.6, 0.15, 0.1);
    for (let i = 0; i < cars.length; i++) { carLights.setColorAt(i * 2, hc); carLights.setColorAt(i * 2 + 1, tc); }
    carLights.frustumCulled = false; scene.add(carLights);
  }
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _p = new V3(), _up = new V3(0, 1, 0);
  // destructible traffic: cars take damage, explode, burn, then get towed (respawn) later
  const carColor = new THREE.Color(), WRECK = new THREE.Color(0x1b1816), _eu = new THREE.Euler(), _qc = new THREE.Quaternion();
  function respawnCar(c, i) {
    const axisX = c.axisX, k = 1 + ((Math.random() * (N - 1)) | 0), dir = Math.random() < 0.5 ? 1 : -1, L = -HALF + k * CELL;
    if (axisX && L > 32 * CELL - HALF - 10) return respawnCar(c, i);
    Object.assign(c, { line: L + dir * 3.5, v: dir * rand(10, 18), hp: 60, wreck: false, roll: 0, burn: 0, free: false, held: false, thrown: false });
    c.s = (axisX ? P.pos.x : P.pos.z) + (Math.random() < 0.5 ? -1 : 1) * rand(400, 700);
    carMesh.setColorAt(i, carColor.setHex(pick(CAR_COLS))); cabMesh.setColorAt(i, carColor.setHex(0x0c1218));
    carMesh.instanceColor.needsUpdate = true; cabMesh.instanceColor.needsUpdate = true;
  }
  const CAR_COLS = [0xdddddd, 0x222222, 0x8a1a1a, 0x1a3a8a, 0xc9b23a, 0x556677, 0x777777];
  cabMesh.setColorAt(0, new THREE.Color(0x0c1218)); for (let i = 1; i < 160; i++) cabMesh.setColorAt(i, new THREE.Color(0x0c1218));
  function damageCar(c, i, dmg, from) {
    if (c.wreck) return;
    c.hp -= dmg;
    if (c.hp <= 0) {
      c.wreck = true; c.burn = 30; c.roll = (Math.random() < 0.5 ? 1 : -1) * rand(0.25, Math.PI); c.vy = 7; c.lift = 0;
      carMesh.setColorAt(i, WRECK); cabMesh.setColorAt(i, WRECK); carMesh.instanceColor.needsUpdate = true; cabMesh.instanceColor.needsUpdate = true;
      const at = new V3(c.x, (c.free ? c.pos.y : 0) + 1.2, c.z);
      setTimeout(() => { explosion(at, 7, 0xff8030); sfx('car', 1, at); burst(at, 18, 0x9fb4c8, 14, 0.25, 0.9); }, 0);
    } else burst(new V3(c.x, 1, c.z), 4, 0xffcc88, 6, 0.25, 0.25);
  }
  G.cars = cars;
  function carsHit(p0, p1, rad) { // returns index of a car hit by the segment p0->p1
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]; if (c.wreck || c.free) continue;
      if (Math.abs(c.x - p1.x) > 8 || Math.abs(c.z - p1.z) > 8 || p1.y > 4) continue;
      const dx = p1.x - c.x, dz = p1.z - c.z, hx = c.axisX ? 2.5 : 1.2, hz = c.axisX ? 1.2 : 2.5;
      if (Math.abs(dx) < hx + rad && Math.abs(dz) < hz + rad && p1.y < 2.2 + rad) return i;
    }
    return -1;
  }
  function blastCars(pos, radius, dmg) {
    for (let i = 0; i < cars.length; i++) { const c = cars[i]; if (c.wreck || c.held || c.thrown) continue; const d = Math.hypot(c.x - pos.x, c.z - pos.z); if (d < radius + 3 && pos.y < radius + 4) setTimeout(() => damageCar(c, i, dmg * (1 - d / (radius + 3) * 0.6)), 120 + d * 15); }
  }
  // ---- lift & throw: a car becomes a free body while held, flying, or lying where it landed ----
  const carry = (G.carry = { car: -1 });
  const _qy = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _eu2 = new THREE.Euler();
  function nearestCar(maxD) {
    let bi = -1, bd = maxD;
    for (let i = 0; i < cars.length; i++) { const c = cars[i]; if (c.wreck || c.free) continue; const d = Math.hypot(c.x - P.pos.x, c.z - P.pos.z); if (d < bd) { bd = d; bi = i; } }
    return bi >= 0 && P.pos.y < 7 ? { i: bi, d: bd } : null;
  }
  G.nearestCar = nearestCar;
  G.liftCar = function (i) {
    const c = cars[i]; if (!c || c.wreck || c.free || P.dead) return false;
    c.free = true; c.held = true; c.thrown = false;
    c.pos = new V3(c.x, 0.72, c.z); c.vel = new V3(); c.spin = new V3(); c.flyT = 0;
    c.q = new THREE.Quaternion().setFromEuler(_eu2.set(0, c.axisX ? (c.v > 0 ? 0 : Math.PI) : (c.v > 0 ? -Math.PI / 2 : Math.PI / 2), 0));
    carry.car = i; P.shielding = false;
    sfx('servo', 0.8, c.pos); burst(c.pos, 10, 0x9fb4c8, 6, 0.4, 0.5);
    if (G.onBoom) G.onBoom(c.pos);
    if (G.UI && !G._carHint) { G._carHint = true; G.UI.say('J', 'You are holding a car. Click or press E to throw it. Please aim at the bad people.'); }
    return true;
  };
  G.throwCar = function (weak) {
    const c = cars[carry.car]; carry.car = -1; if (!c) return;
    c.held = false; c.thrown = true; c.flyT = 0;
    if (weak) { c.vel.copy(P.vel).multiplyScalar(0.5); }
    else {
      // aim at whatever is under the crosshair, lofted so gravity brings it onto the target
      const aim = aimPoint(), dir = aim.clone().sub(c.pos); const D = Math.min(dir.length(), 400); dir.normalize();
      c.vel.copy(dir).multiplyScalar(78); c.vel.y += 10 * (D / 78); c.vel.addScaledVector(P.vel, 0.4);
    }
    c.spin.set(rand(-2.5, 2.5), rand(-1, 1), rand(-1.5, 1.5));
    sfx('dash', 1); if (!weak) sfx('missile', 0.5);
    if (G.settings.fp) VM.kick[0] = VM.kick[1] = 0.12;
  };
  function carImpact(c, i) {
    const at = c.pos.clone(); at.y = Math.max(at.y, 0.8);
    c.thrown = false; c.vel.set(0, 0, 0);
    explosion(at.clone(), 9, 0xff8030); sfx('car', 1.2, at); burst(at, 22, 0x9fb4c8, 16, 0.3, 0.9);
    for (const e of enemies) {
      if (!e.alive) continue; const d = tmp.copy(e.pos).setY(e.pos.y + e.hc).distanceTo(at);
      if (d < 13 + e.r) { damageEnemy(e, 260 * (1 - d / (16 + e.r)), true); if (!e.heavy) { e.vel.add(tmp.sub(at).setLength(30)); e.knock = 1; } }
    }
    c.pos.y = G.groundHeight(c.pos.x, c.pos.z, c.pos.y + 1) + 0.72;
    _eu2.setFromQuaternion(c.q); c.q.setFromEuler(_eu2.set(Math.random() < 0.5 ? Math.PI : rand(-0.4, 0.4), _eu2.y, rand(-0.3, 0.3)));
    c.hp = 0; c.wreck = true; c.burn = 30; c.lift = 0; c.vy = 0;
    carMesh.setColorAt(i, WRECK); cabMesh.setColorAt(i, WRECK); carMesh.instanceColor.needsUpdate = true; cabMesh.instanceColor.needsUpdate = true;
  }
  function updateFreeCar(c, i, dt) {
    if (c.held) {
      if (P.dead) { G.throwCar(true); return; }
      const look = tmp.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
      const want = tmp2.copy(P.pos).addScaledVector(look, G.settings.fp ? 3.6 : 0.4); want.y += G.settings.fp ? 3.4 : 3.3;
      c.pos.lerp(want, clamp(dt * 14, 0, 1));
      _qy.setFromEuler(_eu2.set(0, P.yaw + Math.PI / 2, 0)); c.q.slerp(_qy, clamp(dt * 10, 0, 1));
      P.energy = Math.max(0, P.energy - 3 * dt); if (P.energy <= 0) { G.throwCar(true); G.UI.toast('Too heavy: out of energy', 'bad'); }
    } else if (c.thrown) {
      c.flyT += dt; c.vel.y -= 20 * dt;
      const prev = c.pos.clone(); c.pos.addScaledVector(c.vel, dt);
      _qs.setFromEuler(_eu2.set(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt)); c.q.multiply(_qs);
      if (Math.random() < 0.6) particle(c.pos, new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)), 0.4, 0.6, 0x666666, 2);
      let hit = c.flyT > 7 || solidAt(c.pos.x, c.pos.y, c.pos.z) || c.pos.y < G.groundHeight(c.pos.x, c.pos.z, prev.y + 1) + 0.7;
      if (!hit) for (const e of enemies) { if (e.alive && tmp.copy(e.pos).setY(e.pos.y + e.hc).distanceTo(c.pos) < e.r + 2.6) { hit = true; break; } }
      if (!hit) for (let k = 0; k < cars.length; k++) { const o = cars[k]; if (k !== i && !o.wreck && !o.free && c.pos.y < 3 && Math.abs(o.x - c.pos.x) < 3 && Math.abs(o.z - c.pos.z) < 3) { hit = true; break; } }
      if (hit) { if (solidAt(c.pos.x, c.pos.y, c.pos.z)) c.pos.copy(prev); carImpact(c, i); }
    }
    c.x = c.pos.x; c.z = c.pos.z;
    const ls = new V3(4.6, 0.9, 2.0);
    _m4.compose(c.pos, c.q, ls); carMesh.setMatrixAt(i, _m4);
    const cab = new V3(-0.25, 0.73, 0).applyQuaternion(c.q).add(c.pos);
    _m4.compose(cab, c.q, ls.set(2.5, 0.72, 1.8)); cabMesh.setMatrixAt(i, _m4);
    _m4.makeScale(0, 0, 0); carLights.setMatrixAt(i * 2, _m4); carLights.setMatrixAt(i * 2 + 1, _m4);
  }
  function updateCars(dt) {
    const zmax = 32 * CELL - HALF - 8;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.free && !c.wreck) { updateFreeCar(c, i, dt); continue; }
      if (!c.wreck) { c.s += c.v * dt; const hi = c.axisX ? HALF : zmax; if (c.s > hi) c.s = -HALF; if (c.s < -HALF) c.s = hi; }
      else {
        c.burn -= dt; c.vy -= 22 * dt; c.lift = Math.max(0, c.lift + c.vy * dt); if (c.lift === 0) c.vy = 0;
        if (c.burn > 0 && Math.random() < dt * 30) {
          const fp = new V3(c.x + rand(-1.2, 1.2), (c.free ? c.pos.y : 0) + 1.4 + c.lift, c.z + rand(-1.2, 1.2));
          particle(fp, new V3(rand(-0.5, 0.5), rand(2, 4), rand(-0.5, 0.5)), rand(0.4, 0.8), rand(0.5, 1.0), Math.random() < 0.7 ? 0xff7a20 : 0xffc040, 1.5);
          if (Math.random() < 0.5) particle(fp.clone().setY(fp.y + 1), new V3(rand(-0.6, 0.6), rand(2, 4), rand(-0.6, 0.6)), rand(1.8, 3.2), rand(1.2, 2.2), 0x2a2a2a, 0.4);
        }
        if (c.burn < -25 && Math.hypot(c.x - P.pos.x, c.z - P.pos.z) > 150) { respawnCar(c, i); continue; }
        if (c.free) { updateFreeCar(c, i, dt); continue; }
      }
      if (c.axisX) { _p.set(c.s, 0.72, c.line); _s.set(4.6, 0.9, 2.0); } else { _p.set(c.line, 0.72, c.s); _s.set(2.0, 0.9, 4.6); }
      c.x = _p.x; c.z = _p.z;
      if (c.wreck) {
        _p.y += c.lift + Math.abs(Math.sin(c.roll)) * 0.5;
        _eu.set(c.axisX ? c.roll : 0, 0, c.axisX ? 0 : c.roll); _qc.setFromEuler(_eu);
        _m4.compose(_p, _qc, _s); carMesh.setMatrixAt(i, _m4);
        const cab = new V3(0, 0.75, 0).applyQuaternion(_qc).add(_p);
        _m4.compose(cab, _qc, c.axisX ? _s.set(2.5, 0.72, 1.8) : _s.set(1.8, 0.72, 2.5)); cabMesh.setMatrixAt(i, _m4);
        _m4.makeScale(0, 0, 0); carLights.setMatrixAt(i * 2, _m4); carLights.setMatrixAt(i * 2 + 1, _m4);
        continue;
      }
      _m4.makeScale(_s.x, _s.y, _s.z); _m4.setPosition(_p); carMesh.setMatrixAt(i, _m4);
      { const sg2 = Math.sign(c.v) * -0.25; if (c.axisX) { _m4.makeScale(2.5, 0.72, 1.8); _m4.setPosition(_p.x + sg2, 1.45, _p.z); } else { _m4.makeScale(1.8, 0.72, 2.5); _m4.setPosition(_p.x, 1.45, _p.z + sg2); } cabMesh.setMatrixAt(i, _m4); }
      const sg = Math.sign(c.v);
      for (let k = 0; k < 2; k++) {
        const off = (k === 0 ? 2.32 : -2.32) * sg;
        if (c.axisX) { _m4.makeScale(0.12, 0.22, 1.6); _m4.setPosition(_p.x + off, 0.9, _p.z); }
        else { _m4.makeScale(1.6, 0.22, 0.12); _m4.setPosition(_p.x, 0.9, _p.z + off); }
        carLights.setMatrixAt(i * 2 + k, _m4);
      }
    }
    carMesh.instanceMatrix.needsUpdate = true; cabMesh.instanceMatrix.needsUpdate = true; carLights.instanceMatrix.needsUpdate = true;
    // headlights / street lamps follow the time of day
    const lk = 0.25 + 0.75 * (GFX.envState.lamps || 0);
    carLights.material.color.setScalar(lk);
    if (G.lampHeadMat) G.lampHeadMat.color.setRGB(1.9 * 1.0 * (0.12 + 0.88 * GFX.envState.lamps), 1.9 * 0.78 * (0.12 + 0.88 * GFX.envState.lamps), 1.9 * 0.53 * (0.12 + 0.88 * GFX.envState.lamps));
  }

  // ================= PEDESTRIANS (instanced crowd walking the sidewalks) =================
  const G0 = G;
  const crowd = (() => {
    const MAXN = 420;
    function merge(list) {
      const pos = [], nor = [];
      list.forEach((g) => { const ng = g.index ? g.toNonIndexed() : g; ng.computeVertexNormals(); pos.push(...ng.attributes.position.array); nor.push(...ng.attributes.normal.array); });
      const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return out;
    }
    const T = (g, x, y, z, sx = 1, sy = 1, sz = 1) => { g.scale(sx, sy, sz); g.translate(x, y, z); return g; };
    const sph = (r, ws = 12, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
    const cyl = (a, b, h, sg = 10) => new THREE.CylinderGeometry(a, b, h, sg);
    // body parts (pivot at the joint; limbs hang along -Y)
    const G = {
      torso: merge([T(cyl(0.18, 0.14, 0.36), 0, 1.36, 0, 1, 1, 0.65), T(sph(1), 0, 1.5, 0, 0.19, 0.07, 0.11), T(sph(1), 0, 1.18, 0, 0.145, 0.08, 0.1)]),
      hips: merge([T(cyl(0.145, 0.16, 0.16), 0, 1.03, 0, 1, 1, 0.7), T(sph(1), -0.065, 0.95, 0.03, 0.08, 0.08, 0.075), T(sph(1), 0.065, 0.95, 0.03, 0.08, 0.08, 0.075)]),
      head: merge([T(cyl(0.045, 0.05, 0.1), 0, 1.6, 0), T(sph(1, 16, 12), 0, 1.72, 0, 0.095, 0.115, 0.105), T(sph(1), 0, 1.66, -0.035, 0.068, 0.055, 0.07), T(sph(1, 6, 4), 0, 1.71, -0.1, 0.016, 0.024, 0.02),
        T(sph(1, 6, 4), -0.095, 1.71, 0.005, 0.016, 0.028, 0.012), T(sph(1, 6, 4), 0.095, 1.71, 0.005, 0.016, 0.028, 0.012)]),
      hair: merge([T(sph(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 1.735, 0.012, 0.102, 0.11, 0.112), T(sph(1), 0, 1.72, 0.05, 0.095, 0.09, 0.07)]),
      uarm: merge([T(cyl(0.055, 0.042, 0.28), 0, -0.14, 0), T(sph(0.058), 0, 0, 0)]),
      farm: merge([T(cyl(0.042, 0.032, 0.25), 0, -0.13, 0), T(new THREE.BoxGeometry(0.03, 0.09, 0.075), 0, -0.3, 0), T(sph(0.042), 0, 0, 0)]),
      thigh: merge([T(cyl(0.08, 0.056, 0.45), 0, -0.22, 0), T(sph(0.08), 0, 0, 0)]),
      shin: merge([T(cyl(0.056, 0.04, 0.42), 0, -0.21, 0), T(sph(1), 0, -0.12, 0.012, 0.052, 0.1, 0.052)]),
      shoe: merge([T(new THREE.BoxGeometry(0.095, 0.07, 0.25), 0, -0.45, -0.045)]),
    };
    // fix hair geometry built with extra sphere params
    G.hair = merge([T(new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 1.735, 0.012, 0.102, 0.11, 0.112), T(sph(1), 0, 1.72, 0.05, 0.095, 0.09, 0.07)]);
    const PARTS = { torso: 1, hips: 1, head: 1, hair: 1, uarm: 2, farm: 2, thigh: 2, shin: 2, shoe: 2 };
    const mats = {}, meshes = {};
    for (const k in PARTS) {
      mats[k] = new THREE.MeshStandardMaterial({ roughness: k === 'shoe' ? 0.5 : 0.8, metalness: 0, envMap: ENV, envMapIntensity: 0.4 });
      const m = new THREE.InstancedMesh(G[k], mats[k], MAXN * PARTS[k]); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; GFX.reflectHide.push(m);
      for (let ii = 0; ii < MAXN * PARTS[k]; ii++) m.setColorAt(ii, new THREE.Color(0x888888));
      m.count = 0;
      scene.add(m); meshes[k] = m;
    }
    const SKIN = [0xf1c8a8, 0xe0b090, 0xd9a47e, 0xb57b55, 0x8d5a3b, 0x6a4430, 0x4e3324];
    const SHIRT = [0xd8d8d8, 0x2a3a5a, 0x7a1f2a, 0x2f5a3a, 0xc9a23a, 0x3a3a3a, 0x8a6a4a, 0x5a7aa8, 0xa84a3a, 0xe8e0d0, 0x4a2a5a, 0x1a1a1a];
    const PANTS = [0x2a3448, 0x1a1a1e, 0x4a4a52, 0x6a5a40, 0x30384a, 0x5a4a3a, 0x222a3a];
    const HAIRC = [0x14100c, 0x2a1a10, 0x4a2e18, 0x7a5a32, 0xb08a50, 0x3a3a3a, 0x8a8a8a];
    const SHOE = [0x111111, 0x3a2a1a, 0xe8e8e8, 0x222a3a, 0x5a3a2a];
    const people = [];
    const sideOff = [7.3, -7.3];
    const groups = []; // idle groups: 2–4 people chatting on the sidewalk
    function place(p, near) {
      p.grp = null; p.faceT = 0; p.act = null;
      const P0g = near || new V3();
      const open = groups.find((g) => g.n < g.size && Math.hypot(g.x - P0g.x, g.z - P0g.z) < 200);
      if (open && Math.random() < 0.6) {
        const a = (open.n / open.size) * Math.PI * 2 + rand(-0.3, 0.3), r = rand(0.6, 0.85);
        p.axisX = open.axisX; p.line = open.line + Math.sin(a) * r; p.s = open.s + Math.cos(a) * r;
        p.grp = open; open.n++; p.dir = 1; p.base = 1.2; p.v = 0; p.ph = Math.random() * 10; p.scale = rand(0.92, 1.08); p.panic = 0; p.idle = 0;
        p.faceX = open.x; p.faceZ = open.z; p.faceT = 1e9;
        return;
      }
      p.axisX = Math.random() < 0.5;
      const P0 = near || new V3();
      // pick a sidewalk line near the target point
      const k = Math.round(((p.axisX ? P0.z : P0.x) + HALF) / CELL + (Math.random() - 0.5) * 4.5);
      const kc = clamp(k, 1, p.axisX ? 31 : N - 1);
      p.line = -HALF + kc * CELL + sideOff[Math.random() < 0.5 ? 0 : 1];
      p.s = (p.axisX ? P0.x : P0.z) + rand(-170, 170);
      if (!p.axisX) p.s = Math.min(p.s, 32 * CELL - HALF - 12);
      p.dir = Math.random() < 0.5 ? 1 : -1; p.base = rand(1.05, 1.6); p.v = p.base; p.ph = Math.random() * 10;
      p.scale = rand(0.92, 1.08) * (Math.random() < 0.5 ? 1 : 0.94);
      p.panic = 0; p.idle = Math.random() < 0.12 ? rand(2, 8) : 0;
      if (Math.random() < 0.08) {
        const g = { axisX: p.axisX, line: p.line, s: p.s, n: 0, size: 2 + ((Math.random() * 3) | 0) };
        g.x = g.axisX ? g.s : g.line; g.z = g.axisX ? g.line : g.s;
        groups.push(g); if (groups.length > 14) groups.shift();
        const a = rand(0, Math.PI * 2), r = rand(0.6, 0.85);
        p.line = g.line + Math.sin(a) * r; p.s = g.s + Math.cos(a) * r; p.grp = g; g.n = 1; p.v = 0; p.idle = 0;
        p.faceX = g.x; p.faceZ = g.z; p.faceT = 1e9;
      }
    }
    function colorize(i, p) {
      const c = new THREE.Color();
      const skin = c.clone().setHex(pick(SKIN)), shirt = c.clone().setHex(pick(SHIRT)), pants = c.clone().setHex(pick(PANTS));
      const longSleeve = Math.random() < 0.55, shoe = c.clone().setHex(pick(SHOE)), hair = c.clone().setHex(pick(HAIRC));
      meshes.torso.setColorAt(i, shirt); meshes.hips.setColorAt(i, pants); meshes.head.setColorAt(i, skin); meshes.hair.setColorAt(i, hair);
      for (let s2 = 0; s2 < 2; s2++) { meshes.uarm.setColorAt(i * 2 + s2, shirt); meshes.farm.setColorAt(i * 2 + s2, longSleeve ? shirt : skin); meshes.thigh.setColorAt(i * 2 + s2, pants); meshes.shin.setColorAt(i * 2 + s2, pants); meshes.shoe.setColorAt(i * 2 + s2, shoe); }
    }
    const mRoot = new THREE.Matrix4(), mA = new THREE.Matrix4(), mB = new THREE.Matrix4(), mC = new THREE.Matrix4(), qY = new THREE.Quaternion(), qX = new THREE.Quaternion(), vX = new V3(1, 0, 0), vY = new V3(0, 1, 0), one = new V3(1, 1, 1);
    const joint = (out, parent, px, py, pz, ax) => { qX.setFromAxisAngle(vX, ax); mA.compose(tmp.set(px, py, pz), qX, one); return out.multiplyMatrices(parent, mA); };
    let target = 160, lastBoom = null;
    G0.onBoom = (pos) => { lastBoom = { pos: pos.clone(), t: performance.now() }; };
    let nearIdx = -1, nearD = 1e9, wasGrounded = true, airMax = 0, bumpCd = 0;
    const headPos = (p) => new V3(p.axisX ? p.s : p.line, 1.85 * p.scale, p.axisX ? p.line : p.s);
    function face(p, t, dur) { p.faceX = t.x; p.faceZ = t.z; p.faceT = dur; }
    function act(p, a, dur) { p.act = a; p.actT = dur; p.actK = 0; if (p.idle < dur) p.idle = dur; }
    function update(dt, focus) {
      if (!focus) return;
      const PL = G0.player;
      nearIdx = -1; nearD = 1e9; bumpCd -= dt; let nearCount = 0;
      // landing near people: they look, wave or cheer
      if (!PL.grounded) airMax = Math.max(airMax, PL.pos.y);
      const landed = PL.grounded && !wasGrounded && airMax > 8; wasGrounded = PL.grounded; if (PL.grounded) airMax = 0;
      while (people.length < target) { const p = {}; place(p, focus); people.push(p); colorize(people.length - 1, p); }
      const n = Math.min(people.length, target);
      const now = performance.now();
      const threats = G0.enemies.filter((e) => e.alive && e.aggro && !e.passive);
      for (let i = 0; i < n; i++) {
        const p = people[i];
        const x = p.axisX ? p.s : p.line, z = p.axisX ? p.line : p.s;
        if (Math.abs(x - focus.x) > 260 || Math.abs(z - focus.z) > 260) { place(p, focus); colorize(i, p); continue; }
        // panic: run away from fights and explosions
        let danger = null;
        if (lastBoom && now - lastBoom.t < 5000 && Math.hypot(lastBoom.pos.x - x, lastBoom.pos.z - z) < 70) danger = lastBoom.pos;
        if (!danger && (i + ((now / 500) | 0)) % 8 === 0) for (const e of threats) if (Math.hypot(e.pos.x - x, e.pos.z - z) < 90) { danger = e.pos; break; }
        if (danger) { p.panic = 6; p.dir = Math.sign((p.axisX ? x - danger.x : z - danger.z) || 1); p.idle = 0; if (p.grp) { p.grp = null; p.faceT = 0; p.act = null; } }
        // idle groups chat: someone talks, others laugh, nod or check their phones
        if (p.grp && !p.act && Math.random() < dt * 0.5) act(p, pick(['talk', 'talk', 'laugh', 'look', 'phone']), rand(2, 4.5));
        else if (!p.grp && p.idle > 1.5 && !p.act && Math.random() < dt * 0.6) act(p, 'phone', Math.min(p.idle, rand(2, 5)));
        p.panic = Math.max(0, p.panic - dt);
        const dxp = x - focus.x, dzp = z - focus.z, d2 = dxp * dxp + dzp * dzp; if (d2 < 30 * 30) nearCount++;
        if (d2 < nearD && Math.abs(PL.pos.y - 0) < 4) { nearD = d2; nearIdx = i; }
        if (landed && d2 < 22 * 22 && !p.panic) { face(p, focus, 5); const r = Math.random(); act(p, r < 0.4 ? 'wave' : r < 0.65 ? 'cheer' : 'look', 4 + Math.random() * 2); }
        if (PL.grounded && d2 < 0.85 * 0.85 && PL.pos.y < 3 && bumpCd <= 0) {
          p.s += (p.axisX ? Math.sign(dxp || 1) : Math.sign(dzp || 1)) * 0.6; act(p, 'stumble', 1.2); face(p, focus, 3); bumpCd = 1.5;
          if (G0.UI && Math.random() < 0.7) G0.UI.bubble(() => headPos(p), pick(['Hey! Watch it!', 'Ow! Personal space, please.', 'Do those boots come with brakes?', 'Excuse YOU.']), 2.5);
        }
        if (p.faceT > 0) p.faceT -= dt;
        if (p.actT > 0) { p.actT -= dt; p.actK += dt; if (p.actT <= 0) p.act = null; }
        const want = p.grp || p.idle > 0 || p.act ? 0 : p.panic > 0 ? 5.2 : p.base;
        p.v += (want - p.v) * clamp(dt * 3, 0, 1);
        if (p.idle > 0) { p.idle -= dt; if (p.idle <= 0 && Math.random() < 0.5) p.dir *= -1; }
        else if (Math.random() < dt * 0.01) p.idle = rand(2, 7);
        p.s += p.dir * p.v * dt;
        const lim = p.axisX ? HALF - 4 : 32 * CELL - HALF - 12; if (p.s > lim || p.s < -HALF + 4) p.dir *= -1;
        const run = clamp((p.v - 1.6) / 3.4, 0, 1), sp = p.v;
        p.ph += dt * (sp * 2.9 + (sp > 0.05 ? 1.2 : 0));
        const sw = sp > 0.05 ? Math.sin(p.ph) : 0, amp = 0.32 + 0.45 * run, bob = Math.abs(Math.sin(p.ph)) * (0.025 + 0.05 * run) * (sp > 0.05 ? 1 : 0);
        let yaw = p.axisX ? (p.dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (p.dir > 0 ? Math.PI : 0);
        if (p.faceT > 0 && !p.panic) yaw = Math.atan2(-(p.faceX - x), -(p.faceZ - z));
        const stumble = p.act === 'stumble' ? Math.sin(Math.min(1, p.actK / 1.2) * Math.PI) * 0.35 : 0;
        qY.setFromAxisAngle(vY, yaw); qX.setFromAxisAngle(vX, -0.12 * run);
        if (stumble) qX.setFromAxisAngle(vX, stumble);
        if (p.act === 'laugh') qX.setFromAxisAngle(vX, -0.08 - Math.abs(Math.sin(p.actK * 13)) * 0.06);
        else if (p.act === 'phone') qX.setFromAxisAngle(vX, 0.07);
        mRoot.compose(tmp2.set(x, bob + (p.act === 'cheer' ? Math.abs(Math.sin(p.actK * 7)) * 0.12 : p.act === 'laugh' ? Math.abs(Math.sin(p.actK * 13)) * 0.02 : 0), z), qY.multiply(qX), tmp3.set(p.scale, p.scale, p.scale));
        meshes.torso.setMatrixAt(i, mRoot); meshes.hips.setMatrixAt(i, mRoot); meshes.head.setMatrixAt(i, mRoot); meshes.hair.setMatrixAt(i, mRoot);
        for (let s2 = 0; s2 < 2; s2++) {
          const sd = s2 ? -1 : 1, ph = s2 ? -sw : sw;
          // arms swing opposite to legs; elbows bend more when running
          let ua = -ph * amp * 0.9, fa = 0.25 + 1.1 * run + Math.max(0, -ph) * 0.3;
          if (p.act === 'wave' && s2 === 0) { ua = 2.7; fa = 0.5 + Math.sin(p.actK * 11) * 0.45; }
          else if (p.act === 'cheer') { ua = 2.9 + Math.sin(p.actK * 7) * 0.15; fa = 0.2; }
          else if (p.act === 'talk') { ua = 0.25 + (s2 ? 0 : Math.max(0, Math.sin(p.actK * 3)) * 0.5); fa = 1.2 + Math.sin(p.actK * 5 + s2) * 0.3; }
          else if (p.act === 'photo') { ua = 1.35; fa = 0.9; }
          else if (p.act === 'phone') { ua = s2 ? 0.05 : 0.75; fa = s2 ? 0.2 : 1.85; }
          else if (p.act === 'laugh') { ua = 0.12; fa = 1.35 + Math.sin(p.actK * 13 + s2) * 0.12; }
          else if (p.act === 'stumble') { ua = -0.6; fa = 0.6; }
          joint(mB, mRoot, sd * 0.2, 1.49, 0, ua); meshes.uarm.setMatrixAt(i * 2 + s2, mB);
          joint(mC, mB, 0, -0.28, 0, fa); meshes.farm.setMatrixAt(i * 2 + s2, mC);
          joint(mB, mRoot, sd * 0.095, 0.95, 0, ph * amp); meshes.thigh.setMatrixAt(i * 2 + s2, mB);
          joint(mC, mB, 0, -0.45, 0, -Math.max(0, -Math.cos(p.ph + (s2 ? Math.PI : 0))) * (0.6 + 0.7 * run) * (sp > 0.05 ? 1 : 0)); meshes.shin.setMatrixAt(i * 2 + s2, mC); meshes.shoe.setMatrixAt(i * 2 + s2, mC);
        }
      }
      G0.crowdNear = nearCount;
      for (const k in meshes) { meshes[k].count = n * PARTS[k]; meshes[k].instanceMatrix.needsUpdate = true; if (meshes[k].instanceColor) meshes[k].instanceColor.needsUpdate = true; }
    }
    function setDensity(q) { target = [110, 240, 380, 420][q] || 240; }
    function nearest() { return nearIdx >= 0 && nearD < 4.5 * 4.5 ? people[nearIdx] : null; }
    function talk(p, focus) { face(p, focus, 7); act(p, 'talk', 4); p.panic = 0; return { head: () => headPos(p), setAct: (a, d) => act(p, a, d) }; }
    function cheerAround(pos, r) {
      people.forEach((p) => { const x = p.axisX ? p.s : p.line, z = p.axisX ? p.line : p.s; if (Math.hypot(x - pos.x, z - pos.z) < r) { p.panic = 0; face(p, G0.player.pos, 5); act(p, Math.random() < 0.6 ? 'cheer' : 'wave', 3 + Math.random() * 3); } });
    }
    function clear() { people.length = 0; groups.length = 0; for (const k in meshes) meshes[k].count = 0; }
    return { update, setDensity, clear, nearest, talk, cheerAround, people };
  })();
  G.crowd = crowd;

  // ================= AUDIO (see js/audio.js) =================
  const A = (G.audio = AUDIO);
  function audioInit() { AUDIO.init(G.settings.volume); }
  G.audioInit = audioInit;
  function sfx(type, vol = 1, at) { AUDIO.play(type, vol, at); }
  G.sfx = sfx;

  // ================= EFFECTS =================
  const MAXP = 1200;
  const parts = [];
  const PG = GFX.particles.glow, PS = GFX.particles.smoke;
  const _c = new THREE.Color();
  function particle(pos, vel, life, size, color, drag = 1.5, grav = 0) {
    if (parts.length >= MAXP) parts.shift();
    const col = new THREE.Color(color); const lum = col.r + col.g + col.b;
    parts.push({ p: pos.clone(), v: vel, life, max: life, size, color: col, drag, grav, glow: lum < 1 ? 1 : lum > 3 ? 1 : 2.2, smoke: lum < 1.05 });
  }
  function burst(pos, n, color, speed = 20, size = 0.6, life = 0.6) {
    for (let i = 0; i < n; i++) particle(pos, new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.3, 1) * speed), rand(life * 0.5, life), size, color, 2);
  }
  const flashes = [];
  G.flash = (pos) => { particle(pos.clone().add(new V3(0, -0.25, 0)), new V3(), 0.18, 1.6, 0xffffff, 0); particle(pos, new V3(), 0.12, 0.6, 0xbfe8ff, 0); sfx('hit', 0.3, pos); };
  const flashGeo = new THREE.SphereGeometry(1, 12, 8);
  G.explosion = (p, r) => explosion(p, r);
  function explosion(pos, radius, color = 0xffa040) {
    if (radius >= 3) blastCars(pos, radius, 40 + radius * 8);
    burst(pos, 14 + radius * 2, color, radius * 4, 0.9, 0.8);
    burst(pos, 8, 0x3a3a3a, radius * 1.5, 1.8, 1.6);
    const m = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.copy(pos); scene.add(m); flashes.push({ m, t: 0, r: Math.max(radius, 2) });
    sfx('boom', clamp(radius / 10, 0.3, 1.2), pos);
    if (G.onBoom) G.onBoom(pos);
    G.shake = Math.max(G.shake || 0, clamp(6 - pos.distanceTo(P.pos) / 20, 0, 1.2));
  }
  const beams = [];
  function beam(a, b, color, width = 0.3, life = 0.15) {
    const L = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(width, width, L, 6, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.addVectors(a, b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(_up, tmp.subVectors(b, a).normalize());
    scene.add(m); beams.push({ m, t: 0, life });
  }
  function arc(a, b, color) {
    // jagged lightning
    let prev = a.clone();
    for (let i = 1; i <= 5; i++) {
      const p = a.clone().lerp(b, i / 5); if (i < 5) p.add(new V3(rand(-2, 2), rand(-2, 2), rand(-2, 2)));
      beam(prev, p, color, 0.18, 0.18); prev = p;
    }
  }
  function updateEffects(dt) {
    blood.update(dt);
    for (let i = fallers.length - 1; i >= 0; i--) {
      const f = fallers[i]; f.t += dt;
      if (!f.onGround) {
        f.vel.y -= 22 * dt; f.g.position.addScaledVector(f.vel, dt);
        f.g.rotation.x += f.spin.x * dt; f.g.rotation.z += f.spin.z * dt;
        const gh = G.groundHeight(f.g.position.x, f.g.position.z);
        if (f.g.position.y < gh + 0.3) { f.g.position.y = gh + 0.3; f.onGround = true; f.g.rotation.set(Math.PI / 2 * (f.spin.x > 0 ? 1 : -1), f.g.rotation.y, 0); blood.decal(new V3(f.g.position.x, gh, f.g.position.z), rand(2.2, 3.4), true); }
        if (Math.random() < 0.5) particle(f.g.position, new V3(0, 2, 0), 1, 0.7, 0x333333, 1);
      } else if (f.g.children[0] && f.g.children[0].rotation && f.t < 0.6) { /* settle */ }
      if (f.t > 6) { scene.remove(f.g); fallers.splice(i, 1); }
    }
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.life -= dt;
      if (q.life <= 0) { parts.splice(i, 1); continue; }
      q.v.multiplyScalar(Math.exp(-q.drag * dt)); q.v.y -= q.grav * dt; q.p.addScaledVector(q.v, dt);
    }
    PG.begin(); PS.begin();
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i], k = q.life / q.max;
      if (q.drop) PS.push(q.p, q.color, q.size * 1.8, 1.0);
      else if (q.smoke) PS.push(q.p, q.color, q.size * (2.2 - k) * 1.6, Math.min(1, k * 1.6));
      else PG.push(q.p, _c.copy(q.color).multiplyScalar((0.5 + 0.5 * k) * q.glow), q.size * (0.6 + k) * 1.7, Math.min(1, k * 2));
      n++;
    }
    PG.end(); PS.end();
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i]; f.t += dt; const k = f.t / 0.35;
      f.m.scale.setScalar(f.r * (0.4 + k)); f.m.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) { scene.remove(f.m); f.m.material.dispose(); flashes.splice(i, 1); }
    }
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i]; b.t += dt; b.m.material.opacity = Math.max(0, 1 - b.t / b.life);
      if (b.t >= b.life) { scene.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); beams.splice(i, 1); }
    }
  }

  // ================= MODELS =================
  // Rounded box geometry (smooth normals) for armor panels
  function rbox(w, h, d, r) {
    const key = w + ',' + h + ',' + d + ',' + r;
    const geoCache = rbox.cache || (rbox.cache = {});
    if (geoCache[key]) return geoCache[key];
    r = Math.min(r, w / 2, h / 2, d / 2);
    const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4), p = g.attributes.position, n = g.attributes.normal, v = new V3(), c = new V3();
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); c.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
      const o = v.sub(c); if (o.lengthSq() < 1e-8) o.set(0, 1, 0); o.normalize();
      n.setXYZ(i, o.x, o.y, o.z); p.setXYZ(i, c.x + o.x * r, c.y + o.y * r, c.z + o.z * r);
    }
    return (geoCache[key] = g);
  }
  // ---------- Humanoid builder: real skeleton (shoulder/elbow/wrist, hip/knee, neck) ----------
  const gc2 = {};
  const capG = (r, len) => gc2['c' + r + len] || (gc2['c' + r + len] = new THREE.CapsuleGeometry(r, len, 4, 12));
  const cylG = (a, b, h) => gc2['y' + a + b + h] || (gc2['y' + a + b + h] = new THREE.CylinderGeometry(a, b, h, 14));
  const sphG = gc2.s || (gc2.s = new THREE.SphereGeometry(1, 20, 14));
  function makeHumanoid(o) {
    const kind = o.kind; // 'suit' | 'colossus' | 'trooper' | 'gunner'
    const armored = kind === 'suit' || kind === 'colossus';
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const A1 = new THREE.MeshStandardMaterial({ color: o.c1, metalness: armored ? 0.7 : 0.3, roughness: armored ? 0.3 : 0.6, envMap: ENV, envMapIntensity: 1.3, emissive: 0x000000 });
    const A2 = new THREE.MeshStandardMaterial({ color: o.c2, metalness: armored ? 0.85 : 0.4, roughness: armored ? 0.22 : 0.5, envMap: ENV, envMapIntensity: 1.5 });
    const UN = new THREE.MeshStandardMaterial({ color: o.under || 0x1a1d22, metalness: 0.15, roughness: 0.75, envMap: ENV, envMapIntensity: 0.5 });
    const SK = new THREE.MeshStandardMaterial({ color: o.skin || 0xc89a7a, metalness: 0, roughness: 0.65 });
    const DK = new THREE.MeshStandardMaterial({ color: 0x111316, metalness: 0.5, roughness: 0.5, envMap: ENV });
    const glow = glowM(o.glow || 0x9ff6ff, armored ? 1.5 : 2.6);
    const M = (geo, mat, x, y, z, par, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (sx) m.scale.set(sx, sy, sz); (par || body).add(m); return m; };
    // --- torso ---
    M(sphG, UN, 0, 0.98, 0, body, 0.17, 0.11, 0.12);
    M(cylG(0.14, 0.125, 0.24), UN, 0, 1.14, 0, body, 1, 1, 0.75);
    const chest = armored ? M(sphG, UN, 0, 1.42, 0, body, 0.2, 0.2, 0.135) : M(cylG(0.19, 0.145, 0.34), UN, 0, 1.38, 0, body, 1, 1, 0.66);
    if (!armored) {
      M(sphG, UN, 0, 1.52, 0, body, 0.2, 0.07, 0.12);                                  // shoulder line / trapezius
      [-1, 1].forEach((sd) => M(sphG, UN, sd * 0.07, 0.94, 0.04, body, 0.085, 0.09, 0.08)); // hips / glutes
    }
    let core = chest;
    if (armored) {
      M(sphG, A1, 0, 1.43, -0.008, body, 0.215, 0.19, 0.145);
      M(rbox(0.3, 0.15, 0.05, 0.025), A2, 0, 1.47, -0.128);
      core = M(rbox(0.16, 0.022, 0.02, 0.008), glow, 0, 1.5, -0.142);
      [-1, 1].forEach((sd) => { const c = M(rbox(0.07, 0.016, 0.018, 0.006), glow, sd * 0.05, 1.445, -0.15); c.rotation.z = sd * 0.5; });
      M(rbox(0.17, 0.07, 0.04, 0.018), A1, 0, 1.23, -0.1); M(rbox(0.15, 0.07, 0.04, 0.018), A1, 0, 1.14, -0.095);
      M(cylG(0.172, 0.168, 0.06), A2, 0, 0.99, 0, body, 1, 1, 0.8);
      M(rbox(0.26, 0.3, 0.1, 0.03), A1, 0, 1.42, 0.15);
      [-1, 1].forEach((sd) => { const n = M(cylG(0.03, 0.038, 0.06), DK, sd * 0.07, 1.26, 0.19); M(rbox(0.016, 0.12, 0.012, 0.005), glow, sd * 0.17, 1.43, -0.11); });
    } else {
      M(rbox(0.38, 0.34, 0.27, 0.06), A1, 0, 1.36, 0);                 // tactical vest
      [-0.09, 0, 0.09].forEach((x) => M(rbox(0.07, 0.08, 0.04, 0.012), A2, x, 1.28, -0.15)); // pouches
      M(cylG(0.17, 0.17, 0.05), DK, 0, 1.0, 0, body, 1, 1, 0.78);          // belt
    }
    // --- neck & head ---
    M(cylG(0.045, 0.055, 0.1), armored ? UN : SK, 0, 1.62, 0);
    const head = new THREE.Group(); head.position.set(0, 1.66, 0); body.add(head);
    if (armored) {
      M(sphG, A1, 0, 0.115, 0.005, head, 0.118, 0.135, 0.13);
      M(rbox(0.17, 0.15, 0.07, 0.035), A2, 0, 0.08, -0.095, head);
      M(rbox(0.15, 0.028, 0.02, 0.01), glow, 0, 0.135, -0.13, head);
      [-1, 1].forEach((sd) => { const e = M(cylG(0.03, 0.03, 0.02), A2, sd * 0.118, 0.11, 0.01, head); e.rotation.z = Math.PI / 2; });
      if (o.style === 1) M(rbox(0.02, 0.07, 0.17, 0.01), A2, 0, 0.255, 0.02, head);
      if (o.style === 2) [-1, 1].forEach((sd) => { const h = M(rbox(0.025, 0.025, 0.15, 0.012), A2, sd * 0.075, 0.23, 0.05, head); h.rotation.set(-0.6, sd * 0.35, 0); });
    } else {
      M(sphG, SK, 0, 0.11, 0, head, 0.1, 0.12, 0.108);                    // skull / face
      M(sphG, SK, 0, 0.04, -0.035, head, 0.07, 0.06, 0.075);              // jaw
      M(sphG, SK, 0, 0.1, -0.1, head, 0.018, 0.026, 0.02);                 // nose
      [-1, 1].forEach((sd) => M(sphG, SK, sd * 0.1, 0.1, 0.01, head, 0.018, 0.03, 0.015)); // ears
      const EW = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.3 }), IR = new THREE.MeshStandardMaterial({ color: pick([0x3a2a1a, 0x2a4a6a, 0x3a5a3a, 0x1a1410]), roughness: 0.2 });
      const HAIR = new THREE.MeshStandardMaterial({ color: pick([0x1a1410, 0x3a2614, 0x5a3a1a, 0x8a6a3a, 0x2a2a2a]), roughness: 0.85 });
      const LIP = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.skin || 0xc89a7a).multiplyScalar(0.72), roughness: 0.6 });
      [-1, 1].forEach((sd) => {
        M(sphG, EW, sd * 0.036, 0.115, -0.088, head, 0.017, 0.012, 0.01);          // eye white
        M(sphG, IR, sd * 0.036, 0.115, -0.096, head, 0.008, 0.008, 0.005);         // iris
        const br = M(rbox(0.035, 0.007, 0.012, 0.003), HAIR, sd * 0.037, 0.141, -0.094, head); br.rotation.z = -sd * 0.12; // brow
        M(sphG, SK, sd * 0.055, 0.075, -0.07, head, 0.03, 0.025, 0.03);             // cheeks
      });
      M(rbox(0.04, 0.009, 0.012, 0.004), LIP, 0, 0.045, -0.093, head);           // lips
      if (Math.random() < 0.4) M(sphG, HAIR, 0, 0.035, -0.035, head, 0.078, 0.06, 0.08); // stubble / beard
      [-1, 1].forEach((sd) => M(sphG, HAIR, sd * 0.088, 0.13, 0.03, head, 0.03, 0.05, 0.06)); // hair at the temples
      M(sphG, HAIR, 0, 0.12, 0.05, head, 0.1, 0.09, 0.08);                         // hair at the back
      M(sphG, A1, 0, 0.175, 0.012, head, 0.125, 0.092, 0.13);                      // combat helmet
      M(rbox(0.26, 0.014, 0.21, 0.007), A1, 0, 0.135, 0.02, head);                  // helmet rim
      M(rbox(0.15, 0.035, 0.035, 0.014), DK, 0, 0.2, -0.1, head);                    // goggles pushed up
      M(rbox(0.05, 0.016, 0.02, 0.006), glow, 0.06, 0.2, -0.118, head);              // helmet comms light
    }
    // --- arms: shoulder > elbow > wrist ---
    const arm = (sd) => {
      const a = new THREE.Group(); a.position.set(sd * 0.205, 1.5, 0); body.add(a);
      M(sphG, armored ? A2 : UN, 0, 0, 0, a, 0.07, 0.07, 0.07);
      if (armored) M(capG(0.05, 0.2), UN, 0, -0.15, 0, a); else { M(cylG(0.058, 0.044, 0.28), UN, 0, -0.15, 0, a); M(sphG, UN, 0, -0.1, 0.012, a, 0.052, 0.07, 0.05); }
      if (armored) { M(sphG, A2, sd * 0.02, 0.02, 0, a, 0.095, 0.08, 0.1); M(capG(0.057, 0.11), A1, 0, -0.15, 0, a); }
      else M(sphG, A1, sd * 0.01, 0.0, 0, a, 0.075, 0.06, 0.08);
      const el = new THREE.Group(); el.position.y = -0.3; a.add(el);
      M(sphG, UN, 0, 0, 0, el, 0.048, 0.048, 0.048);
      if (armored) M(capG(0.044, 0.19), UN, 0, -0.13, 0, el); else { M(cylG(0.046, 0.034, 0.25), SK, 0, -0.13, 0, el); M(sphG, SK, 0, -0.07, 0, el, 0.045, 0.07, 0.045); }
      let emitter;
      if (armored) {
        M(cylG(0.062, 0.05, 0.2), A2, 0, -0.14, 0, el);
        M(rbox(0.012, 0.12, 0.012, 0.005), glow, 0, -0.14, -0.06, el);
        emitter = M(cylG(0.022, 0.022, 0.05), glow, 0, -0.25, -0.05, el);   // wrist-mounted emitter
      } else { M(cylG(0.05, 0.047, 0.08), UN, 0, -0.06, 0, el); }
      const wr = new THREE.Group(); wr.position.y = -0.28; el.add(wr);
      const HM = armored ? A1 : DK;
      M(rbox(0.032, 0.09, 0.08, 0.013), HM, 0, -0.05, 0, wr);
      for (let i = 0; i < 4; i++) { const f = M(capG(0.0095, 0.045), HM, 0, -0.115, (i - 1.5) * 0.019, wr); f.rotation.z = -sd * 0.35; }
      const th = M(capG(0.011, 0.035), HM, -sd * 0.008, -0.05, -0.05, wr); th.rotation.x = 0.6;
      if (!emitter) { emitter = new THREE.Object3D(); emitter.position.set(0, -0.08, 0); wr.add(emitter); }
      return { a, el, wr, emitter };
    };
    const R = arm(1), L = arm(-1);
    // --- legs: hip > knee ---
    const leg = (sd) => {
      const l = new THREE.Group(); l.position.set(sd * 0.105, 0.95, 0); body.add(l);
      if (armored) { M(capG(0.072, 0.3), UN, 0, -0.22, 0, l); M(capG(0.078, 0.17), A1, 0, -0.2, -0.006, l); }
      else { M(cylG(0.082, 0.058, 0.46), UN, 0, -0.22, 0, l); M(sphG, UN, 0, -0.12, 0, l, 0.08, 0.13, 0.08); }
      const kn = new THREE.Group(); kn.position.y = -0.45; l.add(kn);
      M(sphG, armored ? A2 : A1, 0, 0, -0.045, kn, 0.06, 0.06, 0.04);
      if (armored) M(capG(0.056, 0.3), UN, 0, -0.2, 0, kn); else { M(cylG(0.058, 0.04, 0.42), UN, 0, -0.2, 0, kn); M(sphG, UN, 0, -0.13, 0.015, kn, 0.055, 0.1, 0.055); }
      if (armored) M(cylG(0.068, 0.056, 0.3), A2, 0, -0.2, -0.004, kn);
      else M(cylG(0.062, 0.066, 0.14), DK, 0, -0.36, 0, kn);
      M(rbox(0.1, 0.075, 0.25, 0.03), armored ? A1 : DK, 0, -0.45, -0.05, kn);
      return { l, kn };
    };
    const LR = leg(1), LL = leg(-1);
    // --- thruster flames (feet, wrists) ---
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 2.2, 2.6), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const flameGeo = gc2.fl || (gc2.fl = (() => { const g = new THREE.ConeGeometry(0.06, 0.5, 10, 1, true); g.rotateX(Math.PI); g.translate(0, -0.25, 0); return g; })());
    const flames = [];
    const mkFlame = (par, x, y, z) => { const f = new THREE.Mesh(flameGeo, flameMat); f.position.set(x, y, z); const c = new THREE.Mesh(flameGeo, coreMat); c.scale.set(0.45, 0.5, 0.45); f.add(c); par.add(f); flames.push(f); return f; };
    if (armored) { mkFlame(LR.kn, 0, -0.49, -0.02); mkFlame(LL.kn, 0, -0.49, -0.02); mkFlame(R.wr, 0, -0.03, 0); mkFlame(L.wr, 0, -0.03, 0); }
    root.scale.setScalar(o.scale || 1);
    root.traverse((m) => { if (m.isMesh && !m.material.transparent && !(m.material.isMeshBasicMaterial)) { m.castShadow = true; m.receiveShadow = true; } });
    return { root, body, head, core, armR: R.a, armL: L.a, elbowR: R.el, elbowL: L.el, wristR: R.wr, wristL: L.wr, palmR: R.emitter, palmL: L.emitter,
      legR: LR.l, legL: LL.l, kneeR: LR.kn, kneeL: LL.kn, flames, flameMat, m1: A1, m2: A2, glow, mk: { M, A1, A2, DK, UN, glow, flameMat, coreMat, mkFlame } };
  }
  function makeSuitModel(c1, c2, style, glowColor = 0x9ff6ff, scale = 1.18) {
    return makeHumanoid({ kind: glowColor === 0x9ff6ff ? 'suit' : 'colossus', c1, c2, style, glow: glowColor, under: 0x1b1f26, scale });
  }
  G.makeSuitModel = makeSuitModel;
  const SKIN = [0xf1c8a8, 0xd9a47e, 0xb57b55, 0x8d5a3b, 0x5e3b27];
  function makeSoldier(kind) {
    const h = makeHumanoid({ kind, c1: kind === 'gunner' ? 0x3a3a2e : 0x2c3140, c2: 0x47506a, under: kind === 'gunner' ? 0x2e3326 : 0x252a35, skin: pick(SKIN), glow: 0xff2a3a, scale: 1.12 });
    const { M, A1, DK, mkFlame } = h.mk;
    // rifle in the right hand (points along the hand's -Y)
    const rifle = new THREE.Group(); h.wristR.add(rifle); rifle.position.set(0, -0.06, -0.02);
    M(rbox(0.045, 0.36, 0.08, 0.012), DK, 0, -0.1, -0.02, rifle);
    M(cylG(0.012, 0.012, 0.22), DK, 0, -0.38, -0.03, rifle);
    M(rbox(0.035, 0.06, 0.1, 0.01), DK, 0, 0.05, 0.03, rifle);
    M(rbox(0.04, 0.05, 0.03, 0.01), glowM(0xff2a3a, 2), 0, -0.05, -0.07, rifle);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.5, -0.03); rifle.add(muzzle);
    h.palmR = muzzle;
    if (kind === 'trooper') {
      M(rbox(0.28, 0.36, 0.14, 0.04), A1, 0, 1.38, 0.19);
      [-1, 1].forEach((sd) => { M(cylG(0.035, 0.045, 0.08), DK, sd * 0.08, 1.17, 0.21); mkFlame(h.body, sd * 0.08, 1.13, 0.21); });
      h.flameMat.color.setRGB(2.6, 1.3, 0.5);
    }
    return h;
  }
  function emat(c) { return metal(c, 0.7, 0.38); }
  function makeDrone() {
    const g = new THREE.Group(), bm = emat(0x2a2633);
    const b = new THREE.Mesh(new THREE.OctahedronGeometry(1.3, 0), bm); b.scale.set(1, 0.6, 1.3); g.add(b);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), glowM(0xff2a4a, 3)); eye.position.set(0, 0, 1.4); g.add(eye);
    const rm = glowM(0xff6a3a, 2);
    [[1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]].forEach(([x, z]) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.08, 4, 12), rm); r.rotation.x = Math.PI / 2; r.position.set(x, 0.2, z); g.add(r); });
    return { g, bm };
  }
  function makeTurret() {
    const g = new THREE.Group(), bm = emat(0x3a3442);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, 1.4, 8), bm); base.position.y = 0.7; g.add(base);
    const head = new THREE.Group(); head.position.y = 2; g.add(head);
    head.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 1.8), bm));
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 2.4), metal(0x1a1a1a, 0.8, 0.3)); bar.position.z = 1.6; head.add(bar);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.05), glowM(0xff2a4a, 3)); eye.position.set(0, 0.2, 0.92); head.add(eye);
    return { g, bm, head };
  }
  function makeTruck() {
    const g = new THREE.Group(), bm = emat(0x22304a);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.6, 8), bm); cargo.position.set(0, 2.4, 1.6); g.add(cargo);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 2.6), bm); cab.position.set(0, 1.9, -3.6); g.add(cab);
    const l = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.25, 0.1), glowM(0xff2a2a, 3)); l.position.set(0, 4.25, 1.6); g.add(l);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.45, 0.4, 7), glowM(0x3355ff, 2)); stripe.position.set(0, 2.4, 1.6); g.add(stripe);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.0, 0.08), new THREE.MeshStandardMaterial({ color: 0x1a2a3a, metalness: 0.9, roughness: 0.1, envMap: ENV, transparent: true, opacity: 0.55 })); glass.position.set(0, 2.55, -4.92); g.add(glass);
    const drv = makeSoldier('gunner'); drv.root.scale.setScalar(1.25); drv.root.position.set(0.7, 0.9, -4.0); drv.legR.rotation.x = drv.legL.rotation.x = 1.4; drv.kneeR.rotation.x = drv.kneeL.rotation.x = -1.4;
    drv.armR.rotation.x = drv.armL.rotation.x = 0.9; drv.wristR.children[drv.wristR.children.length - 1].visible = false; g.add(drv.root);
    return { g, bm };
  }
  function makeJammer() {
    const g = new THREE.Group(), bm = emat(0x3a3a46);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3.5, 40, 6), bm); t.position.y = 20; g.add(t);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 6, 0, TAU, 0, Math.PI / 2), bm); dish.position.y = 41; g.add(dish);
    const light = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), glowM(0xff2040, 3)); light.position.y = 45; g.add(light);
    [10, 20, 30].forEach((y) => { const r = new THREE.Mesh(new THREE.TorusGeometry(3.4 - y * 0.05, 0.25, 4, 12), glowM(0xff4060, 2)); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r); });
    return { g, bm, light };
  }
  function makeGunship() {
    const g = new THREE.Group(), bm = emat(0x252038);
    const body = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 16), bm); g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(3, 6, 6), bm); nose.rotation.x = Math.PI / 2; nose.position.z = 11; g.add(nose);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(22, 0.8, 4), bm); wing.position.set(0, 1, 1); g.add(wing);
    const rm = new THREE.MeshBasicMaterial({ color: 0xff5530, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const rotors = [];
    [-11, 11].forEach((x) => { const r = new THREE.Mesh(new THREE.CircleGeometry(4.5, 16), rm); r.rotation.x = -Math.PI / 2; r.position.set(x, 1.6, 1); g.add(r); rotors.push(r); });
    const eye = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 0.2), glowM(0xff2a4a, 3)); eye.position.set(0, 0.8, 8.1); g.add(eye);
    return { g, bm };
  }

  // ================= PLAYER =================
  const P = (G.player = {
    pos: new V3(-220, 2, 1010), vel: new V3(), yaw: 0, pitch: -0.12, hp: 100, energy: 100, heat: [0, 0], over: [false, false], cd: [0, 0],
    lanceCd: 0, lastHurt: 0, grounded: false, model: null, suit: null, w: [null, null], boosting: false, dead: false,
    integ: { head: 1, torso: 1, armL: 1, armR: 1, legL: 1, legR: 1 },
  });
  function equippedWeapon(slot) { const id = G.state.equip[slot]; return G.state.weapons.find((w) => w.id === id) || G.state.weapons[0]; }
  function equippedSuit() { return G.state.suits.find((s) => s.id === G.state.equip.suit) || G.state.suits[0]; }
  // First-person arms (the "viewmodel"), parented to the camera
  const VM = { group: new THREE.Group(), armR: null, armL: null, fR: null, fL: null, kick: [0, 0], roll: 0, lyaw: 0, lpitch: 0, sx: 0, sy: 0, raise: [0, 0] };
  camera.add(VM.group); scene.add(camera);
  function buildViewModel(sb, style) {
    if (VM.armR) { VM.group.remove(VM.armR); VM.group.remove(VM.armL); }
    const mm = makeSuitModel(sb.c1, sb.c2, style);
    mm.glow.color.multiplyScalar(0.45);
    VM.armR = mm.armR; VM.armL = mm.armL; VM.fR = mm.flames[2]; VM.fL = mm.flames[3]; VM.palmR = mm.palmR; VM.palmL = mm.palmL; VM.elR = mm.elbowR; VM.elL = mm.elbowL; VM.wrR = mm.wristR; VM.wrL = mm.wristL;
    [VM.armR, VM.armL].forEach((a, i) => { a.rotation.order = 'YXZ'; VM.group.add(a); const el = i ? mm.elbowL : mm.elbowR; a.children.forEach((c) => { if (c !== el) c.visible = false; }); });
    VM.group.scale.setScalar(1.0);
  }
  function animateVM(dt) {
    const t = performance.now() / 1000;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    const walk = P.grounded ? clamp(hs / 15, 0, 1) : 0;
    let dyaw = P.yaw - VM.lyaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); const dp = P.pitch - VM.lpitch;
    VM.lyaw = P.yaw; VM.lpitch = P.pitch;
    VM.sx += (clamp(dyaw * 3, -0.08, 0.08) - VM.sx) * clamp(dt * 8, 0, 1);
    VM.sy += (clamp(-dp * 3, -0.06, 0.06) - VM.sy) * clamp(dt * 8, 0, 1);
    VM.group.position.set(VM.sx, VM.sy + Math.sin(t * 9) * 0.02 * walk + Math.sin(t * 1.6) * 0.006, 0);
    [VM.armR, VM.armL].forEach((a, i) => {
      const side = i === 0 ? 1 : -1, firing = input.fire[i] || carry.car >= 0;
      VM.raise[i] += ((firing ? 1 : 0) - VM.raise[i]) * clamp(dt * 12, 0, 1);
      VM.kick[i] = Math.max(0, VM.kick[i] - dt * 0.6);
      const r = VM.raise[i];
      const idle = P.boosting ? Math.PI / 2 - 0.7 : Math.PI / 2 + 0.0;
      a.rotation.x = idle + (Math.PI / 2 + 0.3 - idle) * r;
      a.rotation.y = side * (0.04 + 0.12 * r);
      a.position.set(side * (0.3 - 0.05 * r), -0.32, 0.08 + VM.kick[i]);
      (i ? VM.elL : VM.elR).rotation.x = 0.15 * (1 - r); (i ? VM.wrL : VM.wrR).rotation.x = 0.25 * (1 - r);
    });
    const thrust = P.boosting ? 1.6 : 0;
    [VM.fR, VM.fL].forEach((f, i) => { f.visible = thrust > 0 && !input.fire[i]; f.scale.set(1, thrust * (0.8 + Math.random() * 0.4), 1); });
  }
  G.refreshLoadout = function () {
    const sb = equippedSuit();
    const old = P.suit;
    P.suit = G.suitStats(sb);
    P.w = [G.computeWeapon(equippedWeapon('primary')), G.computeWeapon(equippedWeapon('secondary'))];
    if (!old) { P.hp = P.suit.hp; P.energy = P.suit.energy; } else { P.hp = Math.min(P.hp * P.suit.hp / old.hp, P.suit.hp); P.energy = Math.min(P.energy, P.suit.energy); }
    if (P.model) scene.remove(P.model.root);
    P.model = makeSuitModel(sb.c1, sb.c2, P.suit.style);
    scene.add(P.model.root);
    buildViewModel(sb, P.suit.style);
    G.refreshPods();
  };

  // ================= INPUT =================
  const input = (G.input = { keys: {}, fire: [false, false], touch: { mx: 0, my: 0, up: false, down: false, boost: false } });
  window.addEventListener('keydown', (e) => {
    input.keys[e.code] = true;
    if (G.running && !G.paused && !G.UI.modalOpen()) {
      if (e.code === 'KeyE') G.interact();
      if (e.code === 'KeyQ') G.lance();
      if ((e.code === 'KeyF' || e.code === 'KeyG' || e.code === 'KeyR') && !e.repeat && G.ability) G.ability(e.code);
      if (/^Digit[1-9]$/.test(e.code)) G.equipPrimary(+e.code.slice(5) - 1);
      if (e.code === 'KeyV') { G.settings.fp = !G.settings.fp; G.saveSettings(); G.UI.toast(G.settings.fp ? 'First-person view' : 'Third-person view', 'info'); }
    }
    if (e.code === 'Space' || e.code.startsWith('Arrow')) { if (G.running && !G.UI.modalOpen()) e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });
  window.addEventListener('blur', () => { input.keys = {}; input.fire = [false, false]; });
  window.addEventListener('wheel', (e) => { if (G.running && !G.paused && document.pointerLockElement) G.cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
  G.look = function (dx, dy) {
    const s = 0.0022 * G.settings.sens;
    P.yaw -= dx * s;
    P.pitch -= dy * s * (G.settings.invertY ? -1 : 1);
    P.pitch = clamp(P.pitch, -1.45, 1.35);
  };

  // ================= PROJECTILES =================
  const MAXB = 700;
  const shots = [];
  const shotMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), MAXB);
  shotMesh.frustumCulled = false; scene.add(shotMesh); shotMesh.setColorAt(0, new THREE.Color());
  function spawnShot(o) { if (shots.length >= MAXB) shots.shift(); shots.push(o); return o; }

  const enemies = (G.enemies = []);
  function nearestEnemy(pos, maxD, dir) {
    let best = null, bd = maxD;
    for (const e of enemies) {
      if (!e.alive) continue;
      tmp2.copy(e.pos).y += e.hc;
      const d = tmp2.distanceTo(pos);
      if (d < bd) { if (dir) { tmp.subVectors(tmp2, pos).normalize(); if (tmp.dot(dir) < 0.5) continue; } bd = d; best = e; }
    }
    return best;
  }
  function aimPoint() {
    const o = camera.position, d = camera.getWorldDirection(new V3());
    const minT = G.settings.fp ? 0.5 : o.distanceTo(P.pos) + 1;
    let best = 900, hit = null;
    for (const e of enemies) {
      if (!e.alive) continue;
      tmp.copy(e.pos); tmp.y += e.hc; tmp.sub(o);
      const t = tmp.dot(d); if (t < minT || t > best) continue;
      const dist2 = tmp.lengthSq() - t * t; const r = e.r * 1.6;
      if (dist2 < r * r) { best = t; hit = e; }
    }
    // step the world ray from just in front of the player
    const s = o.clone().addScaledVector(d, minT);
    const tw = rayWorld(s, d, best - minT) + minT;
    if (tw < best) { best = tw; hit = null; }
    G.aimTarget = hit;
    return o.clone().addScaledVector(d, best);
  }
  function fireWeapon(slot) {
    const w = P.w[slot];
    const fp = G.settings.fp;
    const arm = slot === 0 ? (fp ? VM.armR : P.model.armR) : (fp ? VM.armL : P.model.armL);
    if (fp) VM.kick[slot] = 0.07;
    const origin = new V3(); (slot === 0 ? (fp ? VM.palmR : P.model.palmR) : (fp ? VM.palmL : P.model.palmL)).getWorldPosition(origin);
    const aim = aimPoint();
    let dir0 = tmp.subVectors(aim, origin).normalize().clone();
    if (fp) { origin.addScaledVector(dir0, 1.4); dir0 = tmp.subVectors(aim, origin).normalize().clone(); }
    for (let i = 0; i < w.count; i++) {
      const d = dir0.clone();
      if (w.spread > 0) { d.x += rand(-1, 1) * w.spread; d.y += rand(-1, 1) * w.spread; d.z += rand(-1, 1) * w.spread; d.normalize(); }
      spawnShot({ friendly: true, p: origin.clone(), v: d.multiplyScalar(w.speed), dmg: w.dmg, pierce: w.pierce, explode: w.explode, homing: w.homing, chain: w.chain, slow: w.slow, size: w.size, color: new THREE.Color(w.color).multiplyScalar(2.6), life: 3.5, hit: new Set(), target: G.aimTarget });
    }
    burst(origin, 3, w.color, 8, fp ? 0.15 : 0.4, 0.15);
    sfx(w.explode ? 'missile' : w.pierce >= 3 ? 'rail' : 'pew', 0.8);
  }
  G.equipPrimary = function (i) {
    const w = G.state.weapons[i]; if (!w) return;
    const eq = G.state.equip; if (eq.secondary === w.id) eq.secondary = eq.primary;
    eq.primary = w.id; G.refreshLoadout(); sfx('ui');
  };
  G.cycleWeapon = function (dir) {
    const ws = G.state.weapons; if (ws.length < 2) return;
    let i = ws.findIndex((w) => w.id === G.state.equip.primary);
    for (let k = 0; k < ws.length; k++) { i = (i + dir + ws.length) % ws.length; if (ws[i].id !== G.state.equip.secondary) break; }
    G.equipPrimary(i);
  };
  P.lanceCost = 50; P.lanceMax = 3; P.lanceDmg = 170;
  G.lance = function () {
    if (P.lanceCd > 0 || P.energy < P.lanceCost || P.dead) { if (P.energy < P.lanceCost) G.UI.toast('Core Lance needs ' + P.lanceCost + ' energy', 'bad'); return; }
    P.energy -= P.lanceCost; P.lanceCd = P.lanceMax;
    const o = new V3(); P.model.core.getWorldPosition(o);
    const aim = aimPoint(); const d = tmp.subVectors(aim, o).normalize().clone();
    const L = rayWorld(o, d, 700); const end = o.clone().addScaledVector(d, L);
    beam(o, end, 0x9ff6ff, 0.9, 0.45); beam(o, end, 0xffffff, 0.35, 0.45);
    for (const e of enemies) {
      if (!e.alive) continue;
      tmp.copy(e.pos); tmp.y += e.hc; tmp.sub(o);
      const t = clamp(tmp.dot(d), 0, L); const dist = tmp.addScaledVector(d, -t).length();
      if (dist < e.r + 2.5) { damageEnemy(e, P.lanceDmg, true); if (e.onLance) e.onLance(e); }
    }
    explosion(end, 5, 0x9ff6ff); sfx('lance'); G.shake = 1;
  };

  function damageEnemy(e, dmg, fromPlayer) {
    if (!e.alive || e.invuln > 0) return;
    e.hp -= dmg; e.flash = 0.1; e.aggro = true;
    if (fromPlayer) { G.hitMarker = 0.12; sfx('hit', 0.5); }
    if (e.onHit) e.onHit(e);
    if (e.hp <= 0) killEnemy(e);
  }
  G.damageEnemy = damageEnemy;

  // ================= BLOOD (sprays, drips, pools) — toggle in Settings =================
  const blood = (() => {
    const mk = (spiky) => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const r = (a) => Math.random() * a;
      g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 128, 128);
      const base = (x, y, rad, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(70,4,6,${a})`); gr.addColorStop(0.7, `rgba(95,8,10,${a * 0.9})`); gr.addColorStop(1, 'rgba(90,6,8,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); };
      base(64, 64, spiky ? 26 : 50, 0.95);
      for (let i = 0; i < (spiky ? 22 : 9); i++) { const a = r(6.3), d = spiky ? 20 + r(38) : 25 + r(20); base(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, spiky ? 2 + r(6) : 8 + r(14), 0.9); }
      const t = new THREE.CanvasTexture(c); return t;
    };
    const texPool = mk(false), texSplat = mk(true);
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const decals = [];
    function decal(pos, size, pool) {
      if (!G.settings.blood) return;
      if (decals.length > 46) { const o = decals.shift(); scene.remove(o.m); o.m.material.dispose(); }
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: pool ? texPool : texSplat, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.92 }));
      m.position.set(pos.x, pos.y + 0.03 + decals.length * 0.0005, pos.z); m.rotation.y = Math.random() * 6.3; m.renderOrder = 1;
      m.scale.setScalar(pool ? 0.2 : size); scene.add(m);
      decals.push({ m, t: 0, grow: pool ? size : 0, pool });
    }
    function spray(at, dir, n) {
      if (!G.settings.blood) return;
      for (let i = 0; i < n; i++) {
        const v = new V3(rand(-1, 1), rand(0, 1.2), rand(-1, 1)).multiplyScalar(rand(1.5, 4));
        if (dir) v.addScaledVector(dir, rand(3, 9));
        parts.push({ p: at.clone(), v, life: rand(0.5, 1.1), max: 1, size: rand(0.08, 0.2), color: new THREE.Color(rand(0.32, 0.45), 0.02, 0.03), drag: 0.8, grav: 18, glow: 1, smoke: true, drop: true });
      }
      const gh = G.groundHeight(at.x, at.z, at.y);
      if (at.y - gh < 14 && Math.random() < 0.7) decal(new V3(at.x + rand(-1, 1), gh, at.z + rand(-1, 1)), rand(0.6, 1.4), false);
    }
    function update(dt) {
      for (let i = decals.length - 1; i >= 0; i--) {
        const d = decals[i]; d.t += dt;
        if (d.pool && d.t < 4) d.m.scale.setScalar(0.2 + (d.grow - 0.2) * (1 - Math.pow(1 - d.t / 4, 2)));
        if (d.t > 40) d.m.material.opacity = Math.max(0, 0.92 - (d.t - 40) / 8);
        if (d.t > 48) { scene.remove(d.m); d.m.material.dispose(); decals.splice(i, 1); }
      }
    }
    return { spray, decal, update };
  })();
  const fallers = [];
  function killEnemy(e) {
    e.alive = false;
    if (e.human && !e.armored) {
      const at = e.pos.clone().setY(e.pos.y + e.hc);
      burst(at, 14, 0xffaa55, 10, 0.4, 0.5); burst(at, 8, 0x3a3a3a, 4, 1.2, 1.4); sfx('boom', 0.4, at);
      if (e.model.flames) e.model.flames.forEach((f) => (f.visible = false));
      if (G.settings.blood) blood.spray(at, null, 14);
      fallers.push({ g: e.g, vel: e.vel.clone().multiplyScalar(0.3).add(new V3(rand(-3, 3), 4, rand(-3, 3))), spin: new V3(rand(-3, 3), rand(-2, 2), rand(-3, 3)), t: 0, onGround: e.type === 'turret' });
      if (e.type === 'turret') blood.decal(new V3(e.pos.x, G.groundHeight(e.pos.x, e.pos.z, e.pos.y + 1), e.pos.z - 0.4), rand(2, 3), true);
    } else {
      scene.remove(e.g);
      explosion(tmp.copy(e.pos).setY(e.pos.y + e.hc).clone(), e.r * 2.2);
    }
    G.state.stats.kills++;
    if (G.EXT.onKill) G.EXT.onKill(e);
    if (e.drop && Math.random() < e.drop) dropPart(e.pos.clone().setY(e.pos.y + e.hc), e.dropTier || 0);
    if (e.onDeath) e.onDeath(e);
  }

  function updateShots(dt) {
    let n = 0;
    const pc = tmp3.copy(P.pos); pc.y += 1.2;
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.life -= dt;
      if (s.life <= 0) { if (s.fuse && !s.friendly) explosion(s.p.clone(), 4, 0xff7a30); shots.splice(i, 1); continue; }
      if (s.homing > 0) {
        let tgt = null;
        if (s.friendly) { if (!s.target || !s.target.alive) s.target = nearestEnemy(s.p, 220, tmp2.copy(s.v).normalize()); tgt = s.target ? tmp.copy(s.target.pos).setY(s.target.pos.y + s.target.hc) : null; }
        else tgt = pc;
        if (tgt) { const sp = s.v.length(); const want = tmp2.subVectors(tgt, s.p).normalize().multiplyScalar(sp); s.v.lerp(want, clamp(s.homing * dt, 0, 1)).setLength(sp); }
        if (Math.random() < 0.5) particle(s.p, new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)), 0.4, 0.5, 0x888888, 2);
      }
      const prev = s.p.clone();
      s.p.addScaledVector(s.v, dt);
      const seg = tmp2.subVectors(s.p, prev); const segL = seg.length(); seg.divideScalar(segL || 1);
      let dead = false;
      if (s.friendly) {
        for (const e of enemies) {
          if (!e.alive || s.hit.has(e)) continue;
          tmp.copy(e.pos); tmp.y += e.hc; tmp.sub(prev);
          const t = clamp(tmp.dot(seg), 0, segL); const dd = tmp.addScaledVector(seg, -t).length();
          if (dd < e.r + s.size * 0.5) {
            s.hit.add(e);
            const hp = prev.clone().addScaledVector(seg, t);
            const mul = e.onShot ? e.onShot(e, seg, hp, s) : 1;
            if (mul === 0) { burst(hp, 7, 0xffe2a0, 16, 0.3, 0.25); sfx('hit', 0.6, hp); if (s.explode) impact(s, hp, null); dead = true; break; }
            s.dmgMul = mul; impact(s, hp, e); s.dmgMul = 1;
            if (s.pierce > 0) s.pierce--; else { dead = true; break; }
          }
        }
      } else {
        // enemy shot hits player or defend target
        const t = clamp(tmp.subVectors(pc, prev).dot(seg), 0, segL); const dd = tmp.subVectors(pc, prev).addScaledVector(seg, -t).length();
        if (dd < 1.4 + s.size * 0.4 && !P.dead && G.reflectShot && G.reflectShot(s)) { continue; }
        if (dd < 1.4 + s.size * 0.4 && !P.dead) { damagePlayer(s.dmg, prev.clone().addScaledVector(s.v, -0.15)); if (s.explode) explosion(s.p.clone(), s.explode, 0xff5530); else burst(s.p, 5, 0xff4040, 10, 0.4, 0.3); dead = true; }
        else if (M.station && s.p.distanceTo(M.station.pos) < 16) { M.station.hp -= s.dmg; burst(s.p, 6, 0xff4040, 10, 0.5, 0.3); dead = true; }
        else if (s.fuse && s.p.distanceTo(pc) < s.fuse && !P.dead) { explosion(s.p.clone(), s.explode || 6, 0xff7a30); const dd2 = s.p.distanceTo(pc); damagePlayer(s.dmg * clamp(1.2 - dd2 / s.fuse, 0.3, 1), s.p.clone()); dead = true; }
      }
      if (!dead && s.friendly && s.p.y < 5) { const ci = carsHit(prev, s.p, s.size * 0.4); if (ci >= 0) { damageCar(cars[ci], ci, s.dmg); impact(s, prev, null); dead = true; } }
      if (!dead && solidAt(s.p.x, s.p.y, s.p.z)) {
        if (s.friendly) impact(s, prev, null); else if (s.explode) explosion(prev, s.explode * 0.6, 0xff5530); else burst(prev, 4, 0xff8040, 8, 0.4, 0.3);
        dead = true;
      }
      if (dead) { shots.splice(i, 1); continue; }
    }
    for (let i = 0; i < shots.length && n < MAXB; i++) {
      const s = shots[i];
      s.age = (s.age || 0) + 0.016; const fade = clamp(s.age / 0.12, 0.15, 1);
      const len = clamp(s.v.length() * 0.012, 0.8, 6) * fade;
      _q.setFromUnitVectors(_up, tmp.copy(s.v).normalize());
      _m4.compose(s.p, _q, _s.set(s.size * 0.5 * fade, len * (s.size + 0.3), s.size * 0.5 * fade));
      shotMesh.setMatrixAt(n, _m4); shotMesh.setColorAt(n, s.color); n++;
    }
    shotMesh.count = n; shotMesh.instanceMatrix.needsUpdate = true; if (shotMesh.instanceColor) shotMesh.instanceColor.needsUpdate = true;
  }
  function impact(s, at, e) {
    if (e) {
      if (e.human && !e.armored) { sfx('flesh', 0.8, at); blood.spray(at, tmp.copy(s.v).normalize().clone(), 7 + Math.min(10, s.dmg / 6)); e.flinch = 0.25; }
      damageEnemy(e, s.dmg * (s.dmgMul || 1), true);
      if (s.slow) e.slowT = 3;
      if (s.chain > 0) {
        let from = e, left = s.chain; const done = new Set([e]);
        while (left-- > 0) {
          const fp = tmp.copy(from.pos).setY(from.pos.y + from.hc).clone();
          let nx = null, nd = 45;
          for (const o of enemies) { if (!o.alive || done.has(o)) continue; const d = o.pos.distanceTo(fp); if (d < nd) { nd = d; nx = o; } }
          if (!nx) break;
          done.add(nx); const np = nx.pos.clone().setY(nx.pos.y + nx.hc);
          arc(fp, np, 0x9fd8ff); damageEnemy(nx, s.dmg * 0.6, true); from = nx;
        }
      }
    }
    if (s.explode) {
      explosion(at.clone(), s.explode, s.color.clone().multiplyScalar(0.4).getHex());
      for (const o of enemies) { if (!o.alive || o === e) continue; const d = tmp.copy(o.pos).setY(o.pos.y + o.hc).distanceTo(at); if (d < s.explode + o.r) damageEnemy(o, s.dmg * (1 - (d / (s.explode + o.r)) * 0.6), true); }
    } else burst(at, 5, s.color, 10, 0.4, 0.25);
  }
  function enemyShot(from, to, speed, dmg, opts = {}) {
    const d = tmp.subVectors(to, from).normalize();
    if (opts.spread) { d.x += rand(-1, 1) * opts.spread; d.y += rand(-1, 1) * opts.spread; d.z += rand(-1, 1) * opts.spread; d.normalize(); }
    const sh = spawnShot({ friendly: false, p: from.clone(), v: d.clone().multiplyScalar(speed), dmg, size: opts.size || 0.6, color: new THREE.Color(opts.color || 0xff3355).multiplyScalar(2.6), life: opts.life || 4, homing: opts.homing || 0, explode: opts.explode || 0, fuse: opts.fuse || 0, owner: opts.owner || null });
    if (!opts.quiet) sfx(opts.sound || (opts.size && opts.size < 0.5 ? 'mg' : 'enemy'), 0.7, from);
    return sh;
  }
  G.hitDirs = [];
  function damagePlayer(dmg, from) {
    if (P.dead || G.godMode) return;
    if (G.dmgFilter) { dmg = G.dmgFilter(dmg, from); if (dmg <= 0) return; }
    if (from) { G.hitDirs.push({ x: from.x, z: from.z, t: performance.now() }); if (G.hitDirs.length > 6) G.hitDirs.shift(); }
    const real = dmg * (100 / (100 + P.suit.armor));
    P.hp -= real; P.lastHurt = 0; G.hurtFlash = 0.3; sfx('hurt', 0.6);
    { const r = Math.random(), k = r < 0.12 ? 'head' : r < 0.47 ? 'torso' : r < 0.6 ? 'armL' : r < 0.73 ? 'armR' : r < 0.87 ? 'legL' : 'legR';
      P.integ[k] = Math.max(0, P.integ[k] - (real / P.suit.hp) * 3.2); }
    if (P.hp <= 0) playerDie();
  }

  // ================= ENEMIES =================
  function spawnEnemy(type, pos, opts = {}) {
    let e;
    const base = { type, pos: pos.clone(), vel: new V3(), alive: true, t: Math.random() * 10, fireT: rand(1, 3), slowT: 0, flash: 0, invuln: 0, aggro: !!opts.aggro, home: pos.clone(), seed: Math.random() * 100, dir: Math.random() < 0.5 ? 1 : -1, passive: !!opts.passive };
    if (type === 'drone') { const m = makeDrone(); e = Object.assign(base, m, { hp: 40, r: 1.7, hc: 0, drop: 0.25, orbitR: rand(28, 50), alt: rand(6, 20), orbitA: Math.random() * TAU }); }
    else if (type === 'trooper') {
      const h = makeSoldier('trooper'); const g = new THREE.Group(); h.root.position.y = -1.05; h.root.rotation.y = Math.PI; g.add(h.root);
      e = Object.assign(base, { g, model: h, bm: h.m1, human: true, hp: 45, r: 1.3, hc: 0, drop: 0.3, orbitR: rand(28, 50), alt: rand(6, 20), orbitA: Math.random() * TAU });
    }
    else if (type === 'turret') {
      // heavy gunner: a soldier manning a tripod-mounted gun behind sandbags
      const g = new THREE.Group(), head = new THREE.Group(); head.position.y = 0; g.add(head);
      const bag = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.35, 6, 16, Math.PI * 1.2), new THREE.MeshStandardMaterial({ color: 0x6e6248, roughness: 0.95 }));
      bag.rotation.x = -Math.PI / 2; bag.rotation.z = -Math.PI * 0.1 + Math.PI / 2 - Math.PI * 0.6; bag.position.set(0, 0.3, 0.4); head.add(bag);
      const gm = metal(0x22252a, 0.8, 0.35);
      [0, 2.1, 4.2].forEach((a) => { const leg = new THREE.Mesh(cylG(0.03, 0.03, 1.3), gm); leg.position.set(Math.cos(a) * 0.3, 0.6, 0.6 + Math.sin(a) * 0.3); leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); head.add(leg); });
      const gun = new THREE.Group(); gun.position.set(0, 1.25, 0.6); head.add(gun);
      const recv = new THREE.Mesh(rbox(0.22, 0.24, 0.7, 0.04), gm); gun.add(recv);
      const brl = new THREE.Mesh(cylG(0.05, 0.05, 1.1), gm); brl.rotation.x = Math.PI / 2; brl.position.z = 0.85; gun.add(brl);
      const sh = new THREE.Mesh(rbox(0.6, 0.5, 0.04, 0.02), new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.8, metalness: 0.2 })); sh.position.set(0, 0.1, 0.3); gun.add(sh);
      const muzzle = new THREE.Object3D(); muzzle.position.z = 1.45; gun.add(muzzle);
      const h = makeSoldier('gunner'); h.root.position.set(0, 0, -0.35); h.root.rotation.y = Math.PI; head.add(h.root);
      h.armR.rotation.set(1.15, 0, -0.15); h.elbowR.rotation.x = 0.45; h.armL.rotation.set(1.15, 0, 0.15); h.elbowL.rotation.x = 0.45;
      h.wristR.children.forEach((c) => { if (c.type === 'Group') c.visible = false; });
      h.kneeR.rotation.x = -0.25; h.legR.rotation.x = 0.15; h.body.rotation.x = 0.12;
      e = Object.assign(base, { g, head, model: h, bm: h.m1, muzzle, human: true, hp: 90, r: 1.6, hc: 1.2, drop: 0.55 });
    }
    else if (type === 'truck') { const m = makeTruck(); e = Object.assign(base, m, { hp: 320, r: 4.2, hc: 2.2, drop: 1, dropTier: 1 }); }
    else if (type === 'jammer') { const m = makeJammer(); e = Object.assign(base, m, { hp: 350, r: 5, hc: 22, drop: 1, dropTier: 1, spawnT: 8 }); }
    else if (type === 'gunship') { const m = makeGunship(); e = Object.assign(base, m, { hp: 1100, r: 7, hc: 0, drop: 1, dropTier: 2, boss: 'Syndicate Gunship', orbitA: 0 }); }
    else if (type === 'colossus') {
      const m = makeSuitModel('#151a33', '#2f4fb5', 2, 0xff3040, 2.9);
      e = Object.assign(base, { g: m.root, model: m, bm: m.m1, hp: 3600, r: 3.6, hc: 3.2, drop: 0, boss: 'Silas Marrow — Cobalt Colossus', phase: 1, atkT: 3, atk: null, atkTime: 0, armored: true });
      m.m1.emissive = new THREE.Color(0);
    }
    else if (G.EXT.enemy[type]) { const def = G.EXT.enemy[type]; e = Object.assign(base, def.make(base, opts)); ['onShot', 'onShock', 'onLance'].forEach((k) => { if (def[k] && !e[k]) e[k] = def[k]; }); }
    if (type === 'drone' || type === 'trooper') e.flyer = true;
    e.maxHp = e.hp = e.hp * (opts.hpMul || 1);
    Object.assign(e, opts);
    e.g.position.copy(e.pos);
    e.g.traverse((m) => { if (m.isMesh && !m.material.transparent) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(e.g);
    enemies.push(e);
    return e;
  }
  G.spawnEnemy = spawnEnemy;
  function clearEnemies(filter) {
    for (let i = enemies.length - 1; i >= 0; i--) { const e = enemies[i]; if (!filter || filter(e)) { scene.remove(e.g); e.alive = false; enemies.splice(i, 1); } }
  }
  function updateEnemies(dt) {
    const pc = tmp3.copy(P.pos); pc.y += 1.2;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!e.alive) { enemies.splice(i, 1); continue; }
      e.t += dt; e.invuln -= dt;
      const sl = e.slowT > 0 ? 0.5 : 1; e.slowT -= dt;
      if (e.flash > 0) { e.flash -= dt; e.bm.emissive.setHex(e.flash > 0 ? 0xff6666 : (e.slowT > 0 ? 0x2266aa : 0)); }
      const tgt = e.target || pc;
      const distP = e.pos.distanceTo(P.pos);
      if (!e.aggro && !e.passive && distP < (e.aggroR || (e.flyer ? 200 : 230))) e.aggro = true;
      if (e.flyer) {
        let desired;
        if (e.passive || !e.aggro) desired = tmp.set(e.home.x + Math.cos(e.t * 0.4 + e.seed) * 25, e.home.y + Math.sin(e.t * 0.9 + e.seed) * 4, e.home.z + Math.sin(e.t * 0.4 + e.seed) * 25);
        else { e.orbitA += dt * 0.5 * e.dir; desired = tmp.set(tgt.x + Math.cos(e.orbitA) * e.orbitR, tgt.y + e.alt, tgt.z + Math.sin(e.orbitA) * e.orbitR); }
        const acc = tmp2.subVectors(desired, e.pos); const L = acc.length();
        if (L > 0.1) e.vel.addScaledVector(acc.divideScalar(L), 55 * dt);
        e.vel.multiplyScalar(Math.exp(-1.4 * dt)); if (e.vel.length() > (e.maxSpd || 38) * sl) e.vel.setLength((e.maxSpd || 38) * sl);
        if (e.knock > 0) e.knock -= dt;
        e.pos.addScaledVector(e.vel, dt * sl);
        if (e.pos.y < 3) e.pos.y = 3;
        collideSphere(e.pos, e.r, e.vel);
        e.g.position.copy(e.pos); e.g.lookAt(tgt.x, e.pos.y, tgt.z);
        e.g.rotation.z = Math.sin(e.t * 2) * (e.human ? 0.06 : 0.15);
        if (e.human) {
          const h = e.model, dyT = tgt.y - e.pos.y, dh = Math.hypot(tgt.x - e.pos.x, tgt.z - e.pos.z), ap = Math.atan2(dyT, dh);
          const aiming = e.aggro && !e.passive;
          h.armR.rotation.set(aiming ? 1.45 + ap : 0.3, 0, aiming ? -0.12 : 0.15); h.elbowR.rotation.x = aiming ? 0.12 : 0.4;
          h.armL.rotation.set(aiming ? 1.25 + ap : 0.2, 0, aiming ? 0.55 : -0.15); h.elbowL.rotation.x = aiming ? 0.55 : 0.4;
          h.legR.rotation.x = 0.25 + Math.sin(e.t * 1.7) * 0.08; h.kneeR.rotation.x = -0.55; h.legL.rotation.x = -0.05; h.kneeL.rotation.x = -0.25;
          e.flinch = Math.max(0, (e.flinch || 0) - dt);
          h.body.rotation.x = clamp(e.vel.length() / 120, 0, 0.35) - e.flinch * 2.2; h.head.rotation.x = -ap * 0.5 - e.flinch * 2;
          h.flames.forEach((f) => f.scale.set(1, 1.4 + Math.random() * 0.8, 1));
        }
        if (e.pose) e.pose(e, dt, tgt);
        if (e.aggro && !e.passive && e.fire) e.fire(e, dt * sl, tgt);
        else if (e.aggro && !e.passive) {
          e.fireT -= dt * sl;
          if (e.fireT <= 0) { e.fireT = rand(1.3, 2.4); if (e.pos.distanceTo(tgt) < 180 && los(e.pos, tgt)) { const mz = e.human ? e.model.palmR.getWorldPosition(new V3()) : e.pos; enemyShot(mz, tgt, 120, 6, { spread: 0.03 }); if (e.human) burst(mz, 3, 0xffaa55, 6, 0.15, 0.12); } }
        }
      } else if (e.type === 'turret') {
        e.head.lookAt(tgt.x, e.pos.y, tgt.z);
        if (e.aggro) {
          e.fireT -= dt * sl;
          if (e.fireT <= 0) {
            const from = e.pos.clone(); from.y += 2;
            if (from.distanceTo(tgt) < 220 && los(from, tgt)) { e.burst = 3; e.fireT = rand(2.4, 3.2); } else e.fireT = 0.6;
          }
          if (e.burst > 0) { e.bT = (e.bT || 0) - dt; if (e.bT <= 0) { e.bT = 0.18; e.burst--; const from = e.muzzle ? e.muzzle.getWorldPosition(new V3()) : e.pos.clone().setY(e.pos.y + 2); enemyShot(from, tgt, 150, 7, { spread: 0.02 }); burst(from, 3, 0xffaa55, 6, 0.2, 0.12); } }
        }
      } else if (e.type === 'truck') {
        const sp = 14 * sl;
        e.pos.addScaledVector(e.dirV, sp * dt); e.travel += sp * dt;
        e.g.position.copy(e.pos); e.g.rotation.y = Math.atan2(-e.dirV.x, -e.dirV.z);
        if (Math.random() < dt * 8) particle(e.pos.clone().addScaledVector(e.dirV, -6).setY(1), new V3(0, 2, 0), 1, 0.8, 0x444444, 1);
      } else if (e.type === 'jammer') {
        if (Math.sin(e.t * 6) > 0) e.light.material.color.setRGB(3, 0.3, 0.5); else e.light.material.color.setRGB(0.35, 0, 0.05);
        if (distP < 300) { e.spawnT -= dt; if (e.spawnT <= 0) { e.spawnT = 16; if (enemies.filter((x) => x.alive && (x.type === 'drone' || x.type === 'trooper')).length < 7) spawnEnemy('trooper', e.pos.clone().setY(48), { aggro: true, mission: true, drop: 0.2 }); } }
      } else if (e.type === 'gunship') {
        e.orbitA += dt * 0.18 * sl;
        const c = e.home;
        const want = tmp.set(c.x + Math.cos(e.orbitA) * 140, c.y + Math.sin(e.t * 0.5) * 15, c.z + Math.sin(e.orbitA) * 140);
        e.vel.subVectors(want, e.pos).multiplyScalar(0.8);
        e.pos.addScaledVector(e.vel, dt);
        e.g.position.copy(e.pos); e.g.lookAt(pc.x, e.pos.y, pc.z);
        e.fireT -= dt * sl;
        if (e.fireT <= 0) {
          e.fireT = rand(3, 4.5);
          if (distP < 400) for (let k = 0; k < 4; k++) setTimeout(() => { if (e.alive) enemyShot(e.pos.clone().setY(e.pos.y - 2), tmp2.copy(P.pos).setY(P.pos.y + 1), 75, 12, { homing: 1.6, explode: 5, size: 1, color: 0xffaa33, spread: 0.3 }); }, k * 200);
        }
        e.mgT = (e.mgT || 0) - dt;
        if (e.mgT <= 0 && distP < 300) { e.mgT = 0.12; if (Math.sin(e.t * 1.2) > 0.3) enemyShot(e.pos.clone().setY(e.pos.y - 2), pc, 190, 3, { spread: 0.04, size: 0.4, color: 0xffee55 }); }
      } else if (e.type === 'colossus') updateColossus(e, dt, pc, sl);
      else if (G.EXT.enemy[e.type]) G.EXT.enemy[e.type].update(e, dt, tgt, sl, distP);
    }
  }
  function updateColossus(e, dt, pc, sl) {
    const ratio = e.hp / e.maxHp;
    const newPhase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (newPhase !== e.phase) {
      e.phase = newPhase; e.invuln = 2.5;
      G.UI.say('M', newPhase === 2 ? 'You think you can beat me with scraps? Troopers, now!' : 'Enough! Full power to the Starheart!');
      for (let k = 0; k < (newPhase === 2 ? 3 : 4); k++) spawnEnemy('trooper', e.pos.clone().add(new V3(rand(-20, 20), 10, rand(-20, 20))), { aggro: true, mission: true, drop: 0.3 });
      explosion(e.pos.clone().setY(e.pos.y + 3), 8, 0x3355ff);
    }
    const m = e.model;
    const toP = tmp.subVectors(pc, e.pos); const dP = toP.length(); toP.normalize();
    // movement
    if (e.atk === 'charge') {
      e.vel.copy(e.chargeDir).multiplyScalar(130);
      if (dP < 7 && !e.hitDone) { e.hitDone = true; damagePlayer(28, e.pos); P.vel.addScaledVector(e.chargeDir, 80); G.shake = 1.5; }
    } else {
      const ideal = 45 + Math.sin(e.t * 0.7) * 10;
      const want = tmp2.copy(toP).multiplyScalar(dP - ideal);
      const side = new V3(-toP.z, 0, toP.x).multiplyScalar(Math.sin(e.t * 0.5) * 30);
      want.add(side); want.y += (pc.y + 6 - e.pos.y);
      e.vel.lerp(want.clampLength(0, 45 * sl), clamp(dt * 2, 0, 1));
    }
    e.pos.addScaledVector(e.vel, dt);
    if (e.pos.distanceTo(e.home) > 260) e.pos.sub(e.home).setLength(260).add(e.home);
    if (e.pos.y < 3) e.pos.y = 3;
    collideSphere(tmp2.copy(e.pos).setY(e.pos.y + e.hc), 4, e.vel); e.pos.set(tmp2.x, tmp2.y - e.hc, tmp2.z);
    e.g.position.copy(e.pos); e.g.rotation.y = Math.atan2(-toP.x, -toP.z);
    m.armR.rotation.x = e.atk ? Math.PI / 2 + 0.05 : 0.25; m.armL.rotation.x = e.atk === 'missiles' ? Math.PI / 2 + 0.05 : 0.25;
    m.armR.rotation.z = e.atk ? 0 : 0.3; m.armL.rotation.z = e.atk === 'missiles' ? 0 : -0.3; m.elbowR.rotation.x = e.atk ? 0 : 0.35; m.elbowL.rotation.x = e.atk === 'missiles' ? 0 : 0.35;
    m.legR.rotation.x = 0.2; m.kneeR.rotation.x = -0.45; m.kneeL.rotation.x = -0.2; m.body.rotation.x = e.atk === 'charge' ? 0.6 : 0.08;
    m.flames.forEach((f) => (f.scale.y = 1 + Math.random()));
    // attacks
    e.atkT -= dt * sl;
    if (!e.atk && e.atkT <= 0) {
      const opts = e.phase === 1 ? ['barrage', 'missiles'] : ['barrage', 'missiles', 'charge'];
      e.atk = pick(opts); e.atkTime = 0; e.shotsLeft = e.atk === 'barrage' ? 8 + e.phase * 2 : 5 + e.phase;
      if (e.atk === 'charge') { e.chargeDir = toP.clone(); e.hitDone = false; G.UI.toast('Colossus charging!', 'bad'); }
    }
    if (e.atk) {
      e.atkTime += dt; e.sT = (e.sT || 0) - dt;
      const hand = new V3(); m.palmR.getWorldPosition(hand);
      if (e.atk === 'barrage' && e.sT <= 0 && e.shotsLeft > 0) { e.sT = 0.14; e.shotsLeft--; enemyShot(hand, pc, 160, 8, { spread: 0.05, size: 0.9, color: 0xff2a40 }); }
      if (e.atk === 'missiles' && e.sT <= 0 && e.shotsLeft > 0) { e.sT = 0.25; e.shotsLeft--; const lh = new V3(); m.palmL.getWorldPosition(lh); enemyShot(lh, pc.clone().add(new V3(0, 15, 0)), 70, 12, { homing: 1.4, explode: 5, size: 1, color: 0xffaa33, spread: 0.5 }); }
      const done = e.atk === 'charge' ? e.atkTime > 1.1 : e.shotsLeft <= 0;
      if (done) { e.atk = null; e.atkT = rand(1.5, 3) / (0.7 + e.phase * 0.3); e.vel.multiplyScalar(0.2); }
    }
  }

  // ================= PICKUPS / CRATES / BENCHES =================
  const pickups = [];
  const pickGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  function makePickup(pos, kind, data, color) {
    const m = new THREE.Mesh(pickGeo, glowM(color, 1.6));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.08, 4, 16), glowM(color, 2.4)); m.add(ring);
    m.position.copy(pos); scene.add(m);
    const pu = { m, pos: pos.clone(), kind, data, alive: true, t: Math.random() * 6, base: pos.y };
    pickups.push(pu); return pu;
  }
  function randomPartId(bonusTier) {
    const maxTier = clamp(1 + Math.floor(G.state.missionIndex / 2) + bonusTier, 1, 4);
    const pool = []; D.PARTS.forEach((p) => { if (p.tier <= maxTier) for (let k = 0; k < 5 - p.tier; k++) pool.push(p.id); });
    return pick(pool);
  }
  function dropPart(pos, bonusTier) { makePickup(pos, 'part', randomPartId(bonusTier), 0x7dff9a); }
  G.addPart = function (id, n = 1, quiet) {
    G.state.inventory[id] = (G.state.inventory[id] || 0) + n;
    if (!quiet) G.UI.toast('+' + n + ' ' + PART[id].name, 'part');
  };
  // crates on rooftops
  const crates = [];
  {
    const R = mulberry(777);
    const cand = roofs.filter((r) => r.y > 6 && r.w > 6);
    for (let i = 0; i < 45 && cand.length; i++) {
      const r = cand.splice((R() * cand.length) | 0, 1)[0];
      crates.push({ id: i, pos: new V3(r.x, r.y + 0.8, r.z) });
    }
  }
  G.crates = crates;
  function spawnCrates() {
    pickups.filter((p) => p.kind === 'crate').forEach((p) => { scene.remove(p.m); p.alive = false; });
    crates.forEach((c) => { if (!G.state.crates.includes(c.id)) { const pu = makePickup(c.pos, 'crate', c.id, 0xffa030); pu.m.scale.set(1.6, 1, 1.1); } });
  }
  // benches
  const benchObjs = [];
  D.BENCHES.forEach((b) => {
    const g = new THREE.Group(); g.position.set(b.pos[0], b.pos[1] || 0, b.pos[2]);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 0.6, 32), metal(0x3a4252, 0.6, 0.4)); plat.position.y = 0.3; g.add(plat);
    const table = new THREE.Mesh(rbox(5, 1.2, 2.4, 0.15), metal(0x5a6070, 0.8, 0.3)); table.position.set(0, 1.2, -3); g.add(table);
    const holo = new THREE.Mesh(new THREE.TorusKnotGeometry(0.7, 0.18, 48, 6), glowM(0x3fe0ff, 1.4, { wireframe: true })); holo.position.set(0, 3, -3); g.add(holo);
    const beamM = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 260, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x3fe0ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beamM.position.y = 130; g.add(beamM);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8.5, 0.2, 4, 40), glowM(0x3fe0ff, 1.3)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.7; g.add(ring);
    if (b.indoor) beamM.visible = false;
    scene.add(g); benchObjs.push({ b, g, holo, pos: new V3(b.pos[0], (b.pos[1] || 0) + 1, b.pos[2]) });
  });
  G.benchObjs = benchObjs;
  // ---------- AEGIS Tower interior ----------
  const HQ = (G.HQ = { core: new V3(-200, 204, -372), min: new V3(-224, 199, -384), max: new V3(-176, 216, -332), pods: [], podModels: [] });
  {
    const g = new THREE.Group(); scene.add(g);
    const lightM = glowM(0xdff6ff, 1.6);
    for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(40, 0.15, 1.2), lightM); l.position.set(-200, 215.8, -378 + i * 13); g.add(l); }
    const padRing = new THREE.Mesh(new THREE.TorusGeometry(6, 0.18, 4, 40), glowM(0xffd040, 1.6)); padRing.rotation.x = Math.PI / 2; padRing.position.set(-200, 200.1, -318); g.add(padRing);
    for (let i = 0; i < 6; i++) { const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 3), glowM(0x3fe0ff, 1.8)); s2.position.set(-211.5 + (i % 2) * 23, 200.15, -330 + Math.floor(i / 2) * 9); g.add(s2); }
    // JUNO core: pedestal + rotating holographic lattice and rings
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.6, 1.6, 24), metal(0x2a303a, 0.8, 0.3)); ped.position.set(HQ.core.x, 200.8, HQ.core.z); g.add(ped);
    const lat = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), glowM(0x3fe0ff, 1.6, { wireframe: true })); lat.position.copy(HQ.core); g.add(lat);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), glowM(0x9ff6ff, 2.4)); inner.position.copy(HQ.core); g.add(inner);
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.05, 6, 48), glowM(0x3fe0ff, 2)); r1.position.copy(HQ.core); g.add(r1);
    const r2 = r1.clone(); r2.scale.setScalar(1.25); g.add(r2);
    HQ.spin = [lat, r1, r2]; HQ.inner = inner;
    // suit display pods on the west wall
    for (let i = 0; i < 4; i++) {
      const pz = -378 + i * 9.5, pos = new V3(-219, 200, pz);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.5, 24), metal(0x2a303a, 0.8, 0.3)); base.position.set(pos.x, 200.25, pz); g.add(base);
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.6, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x3fe0ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      glass.position.set(pos.x, 202.3, pz); g.add(glass);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 4, 32), glowM(0x3fe0ff, 1.6)); halo.rotation.x = Math.PI / 2; halo.position.set(pos.x, 204.1, pz); g.add(halo);
      const fl = halo.clone(); fl.position.y = 200.55; g.add(fl);
      HQ.pods.push(pos);
    }
  }
  G.refreshPods = function () {
    HQ.podModels.forEach((m) => scene.remove(m.root)); HQ.podModels = [];
    (G.state ? G.state.suits : []).slice(0, 4).forEach((sb, i) => {
      const m = makeSuitModel(sb.c1, sb.c2, PART[sb.parts.helmet].s.style, 0x9ff6ff, 1.25);
      m.flames.forEach((f) => (f.visible = false)); m.armR.rotation.z = 0.12; m.armL.rotation.z = -0.12; m.elbowR.rotation.x = m.elbowL.rotation.x = 0.15;
      m.root.position.set(HQ.pods[i].x, 200.5, HQ.pods[i].z); m.root.rotation.y = -Math.PI / 2; scene.add(m.root); HQ.podModels.push(m);
    });
  };
  G.inHQ = () => P.pos.x > HQ.min.x && P.pos.x < HQ.max.x && P.pos.z > HQ.min.z && P.pos.z < HQ.max.z && P.pos.y > HQ.min.y && P.pos.y < HQ.max.y;
  // Mission marker
  const markerG = new THREE.Group();
  {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 300, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    col.position.y = 150; markerG.add(col);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.4, 6, 30), glowM(0xffd040, 2.2)); ring.rotation.x = Math.PI / 2; ring.position.y = 1; markerG.add(ring);
    markerG.userData.ring = ring;
    scene.add(markerG); markerG.visible = false;
  }
  // Goto waypoint ring
  const wpRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.8 }));
  scene.add(wpRing); wpRing.visible = false;

  function updatePickups(dt) {
    const pc = tmp3.copy(P.pos); pc.y += 1;
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      if (!p.alive) { pickups.splice(i, 1); continue; }
      p.t += dt; p.m.rotation.y += dt * 2; p.m.position.y = p.base + Math.sin(p.t * 3) * 0.3;
      const d = p.m.position.distanceTo(pc);
      if (p.kind === 'part' && d < 22) { p.m.position.lerp(pc, clamp(dt * 6, 0, 1)); p.base = p.m.position.y; }
      if (d < (p.kind === 'crate' ? 5 : 3.5) && !P.dead) {
        p.alive = false; scene.remove(p.m); sfx('pick');
        if (p.kind === 'part') G.addPart(p.data);
        else if (p.kind === 'crate') {
          G.state.crates.push(p.data);
          const n = 1 + (Math.random() < 0.4 ? 1 : 0); const id = randomPartId(1);
          G.UI.toast('Salvage crate ' + G.state.crates.length + '/' + crates.length, 'info'); G.addPart(id, n);
          if (G.onCrate) G.onCrate();
        } else if (p.kind === 'core') { M.collected++; G.UI.toast('Data core recovered (' + M.collected + '/' + M.need + ')', 'info'); }
        if (p.onPick) p.onPick();
      }
    }
  }

  // ================= MISSIONS =================
  const M = (G.mission = { active: false, idx: 0, stage: -1, s: null, timer: 0, station: null, killLeft: 0, collected: 0, need: 0 });
  G.objective = { text: '', sub: '', wp: null, timer: null };
  G.boss = null;
  function missionStartPos(i) {
    const m = D.MISSIONS[i]; if (!m) return null;
    if (m.start) return new V3(m.start[0], m.start[1] || 0, m.start[2]);
    if (i === 1) return new V3(-220, 0, 1010);
    const s = m.stages[0];
    if (s.pos) return new V3(s.pos[0], 0, s.pos[2]).add(new V3(0, 0, 0));
    if (s.start) return new V3(s.start[0] - 120, 0, s.start[2]);
    if (s.items) return new V3(-1010, 0, -90);
    if (s.targets) return new V3(s.targets[0][0], 0, s.targets[0][2] + 140);
    return new V3(0, 0, 0);
  }
  G.missionStartPos = missionStartPos;
  G.startMission = function (i) {
    const m = D.MISSIONS[i]; if (!m) return;
    M.active = true; M.idx = i; M.stage = -1; M.fails = 0;
    G.UI.banner(m.act === 2 && (i === 0 || D.MISSIONS[i - 1].act !== 2) ? 'ACT II — THE NIGHTJAR' : 'MISSION ' + (i + 1), m.act === 2 && (i === 0 || D.MISSIONS[i - 1].act !== 2) ? 'Mission ' + (i + 1) + ': ' + m.title : m.title);
    if (G.onMissionStart) G.onMissionStart(i);
    G.UI.sayLines(m.intro);
    nextStage();
  };
  function cleanupMission() {
    if (G.onMissionCleanup) G.onMissionCleanup(M);
    clearEnemies((e) => e.mission);
    pickups.filter((p) => p.kind === 'core').forEach((p) => { p.alive = false; scene.remove(p.m); });
    M.station = null; G.boss = null; wpRing.visible = false; G.objective.wp = null; G.objective.timer = null; G.objective.sub = '';
  }
  function nextStage() {
    M.stage++;
    const m = D.MISSIONS[M.idx];
    if (M.stage >= m.stages.length) return completeMission();
    const s = (M.s = m.stages[M.stage]);
    G.objective.text = s.text; G.objective.sub = ''; G.objective.timer = null; G.objective.wp = null;
    if (s.say) G.UI.sayLines(s.say);
    M.timer = 0;
    if (s.type === 'goto') G.objective.wp = new V3(...s.pos);
    else if (s.type === 'craft') { M.craftFlag = false; G.objective.wp = nearestBench().pos.clone(); }
    else if (s.type === 'kill') {
      M.killLeft = s.spawn.n;
      const c = new V3(...s.spawn.center);
      const ROOFED = { turret: 1, sniper: 1 };
      const rs = roofs.filter((r) => Math.hypot(r.x - c.x, r.z - c.z) < s.spawn.r && r.y > 12 && r.y < 160 && r.w > 5 && r.d > 5).sort(() => Math.random() - 0.5);
      for (let k = 0; k < s.spawn.n; k++) {
        const type = s.spawn.mix ? s.spawn.mix[k % s.spawn.mix.length] : s.spawn.type;
        if (ROOFED[type]) { const r = rs.pop(); const p = r ? new V3(r.x, r.y, r.z) : c.clone().add(new V3(rand(-40, 40), 0, rand(-40, 40))); spawnEnemy(type, p, { mission: true, onDeath: killCount }); }
        else spawnEnemy(type, c.clone().add(new V3(rand(-s.spawn.r, s.spawn.r) * 0.6, rand(-5, 10), rand(-s.spawn.r, s.spawn.r) * 0.6)), { mission: true, passive: s.spawn.passive, onDeath: killCount, aggro: false });
      }
      G.objective.wp = c;
    } else if (s.type === 'convoy') {
      M.killLeft = s.n;
      const dir = new V3(...s.dir).normalize();
      for (let k = 0; k < s.n; k++) {
        const t = spawnEnemy('truck', new V3(...s.start).addScaledVector(dir, -k * 16), { mission: true, dirV: dir, travel: -k * 16, onDeath: killCount });
        t.onHit = () => enemies.forEach((e) => { if (e.mission) e.aggro = true; });
      }
      for (let k = 0; k < s.escort; k++) spawnEnemy('trooper', new V3(...s.start).add(new V3(rand(-30, 10), 20, rand(-15, 15))), { mission: true, aggro: true });
    } else if (s.type === 'defend') {
      M.station = { pos: new V3(s.pos[0], 12, s.pos[2]), hp: s.hp, max: s.hp };
      M.waveT = 0; M.wave = 0; G.objective.wp = M.station.pos.clone();
    } else if (s.type === 'collect') {
      M.collected = 0; M.need = s.items.length;
      s.items.forEach((it) => {
        const p = new V3(it[0], 1.5, it[2]);
        makePickup(p, 'core', null, 0x40a0ff).m.scale.setScalar(1.5);
        for (let k = 0; k < s.guards; k++) spawnEnemy(k === 0 ? 'turret' : 'trooper', p.clone().add(new V3(rand(-14, 14), k === 0 ? 0 : 14, rand(-14, 14))), { mission: true });
      });
    } else if (s.type === 'destroy') {
      const list = s.targets || s.aa; M.killLeft = list.length;
      list.forEach((t) => spawnEnemy(s.aa ? 'aa' : 'jammer', new V3(t[0], s.aa ? t[1] : 0, t[2]), { mission: true, target: null, onDeath: killCount, destroyTarget: true }));
    } else if (s.type === 'boss') {
      const b = spawnEnemy(s.boss, new V3(...s.pos), { mission: true, aggro: true, onDeath: () => { G.boss = null; M.bossDead = true; } });
      M.bossDead = false; G.boss = b;
      if (s.boss === 'colossus') G.UI.say('M', 'Behold, Rhea. Your genius, perfected.');
    } else if (G.EXT.stage[s.type]) G.EXT.stage[s.type].start(s, M);
  }
  function killCount() { M.killLeft--; }
  function nearestBench() {
    let best = benchObjs[0], bd = Infinity;
    benchObjs.forEach((b) => { const d = b.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = b; } });
    return best;
  }
  G.nearestBench = nearestBench;
  G.notifyCraft = function () { M.craftFlag = true; G.state.stats.crafted++; };
  function completeMission() {
    crowd.cheerAround(P.pos, 120);
    const m = D.MISSIONS[M.idx];
    cleanupMission();
    M.active = false;
    G.objective.text = ''; G.objective.sub = '';
    G.UI.banner('MISSION COMPLETE', m.title);
    m.reward.forEach((id) => G.addPart(id, 1));
    G.UI.sayLines(m.outro);
    if (G.onMissionComplete) G.onMissionComplete(M.idx);
    G.state.missionIndex = Math.max(G.state.missionIndex, M.idx + 1);
    sfx('pick');
    setTimeout(() => G.saveGame(0), 600);
  }
  function failMission(reason) {
    cleanupMission(); M.active = false; G.objective.text = '';
    G.UI.banner('MISSION FAILED', reason);
    G.UI.toast('Return to the yellow marker to retry', 'info');
  }
  G.abandonMission = function () { if (M.active) failMission('Mission abandoned'); };
  function updateMission(dt) {
    // mission marker for next mission
    const next = G.state.missionIndex;
    const racing = G.race && G.race.active;
    if (!M.active && next < D.MISSIONS.length && !racing) {
      const sp = missionStartPos(next);
      markerG.visible = true; markerG.position.copy(sp); markerG.userData.ring.rotation.z += dt;
      G.objective.text = 'Next: ' + D.MISSIONS[next].title; G.objective.sub = 'Fly into the yellow beacon'; G.objective.wp = sp.clone().setY(2);
      if (next === 0 || Math.hypot(P.pos.x - sp.x, P.pos.z - sp.z) < 12 && P.pos.y < 60) G.startMission(next);
    } else markerG.visible = false;
    if (!M.active) {
      if (racing) return;
      if (next >= D.MISSIONS.length && !crime.active) { G.objective.text = 'Free roam'; G.objective.sub = 'Stop crimes, find crates, build gear'; G.objective.wp = null; }
      return;
    }
    const s = M.s; M.timer += dt;
    wpRing.visible = false;
    if (s.type === 'goto') {
      const wp = G.objective.wp;
      wpRing.visible = true; wpRing.position.copy(wp); wpRing.scale.setScalar(s.r * 0.6); wpRing.lookAt(P.pos); wpRing.rotation.z += dt;
      if (P.pos.distanceTo(wp) < s.r) nextStage();
    } else if (s.type === 'craft') { G.objective.sub = 'Workbench: ' + nearestBench().b.name; if (M.craftFlag) nextStage(); }
    else if (s.type === 'kill' || s.type === 'destroy') {
      const total = s.type === 'kill' ? s.spawn.n : (s.targets || s.aa).length;
      G.objective.sub = total - M.killLeft + ' / ' + total;
      const alive = enemies.filter((e) => e.mission && e.alive && (s.type !== 'destroy' || e.destroyTarget));
      if (alive.length) { const near = alive.reduce((a, b) => (a.pos.distanceTo(P.pos) < b.pos.distanceTo(P.pos) ? a : b)); G.objective.wp = near.pos.clone().setY(near.pos.y + near.hc); }
      if (M.killLeft <= 0) { if (s.type === 'destroy') clearEnemies((e) => e.mission && (e.type === 'drone' || e.type === 'trooper')); nextStage(); }
    } else if (s.type === 'convoy') {
      const trucks = enemies.filter((e) => e.type === 'truck' && e.alive);
      G.objective.sub = s.n - M.killLeft + ' / ' + s.n + ' trucks';
      if (trucks.length) {
        G.objective.wp = trucks[0].pos.clone().setY(4);
        const maxT = Math.max(...trucks.map((t) => t.travel));
        G.objective.timer = Math.max(0, (s.length - maxT) / 14);
        if (maxT > s.length) return failMission('The convoy escaped');
      }
      if (M.killLeft <= 0) nextStage();
    } else if (s.type === 'defend') {
      const st = M.station;
      G.objective.timer = Math.max(0, s.duration - M.timer);
      G.objective.sub = 'Station integrity ' + Math.max(0, Math.round((st.hp / st.max) * 100)) + '%';
      M.waveT -= dt;
      if (M.waveT <= 0 && M.wave < s.waves.length) {
        M.waveT = s.duration / s.waves.length; const type = s.waves[M.wave++];
        const ang = Math.random() * TAU;
        for (let k = 0; k < (type === 'turret' ? 3 : 5); k++) {
          if (type === 'turret') { const a = ang + k * 2; spawnEnemy('turret', new V3(st.pos.x + Math.cos(a) * 70, 0, st.pos.z + Math.sin(a) * 70), { mission: true, aggro: true, target: st.pos }); }
          else spawnEnemy('trooper', new V3(st.pos.x + Math.cos(ang) * 200 + rand(-20, 20), 40, st.pos.z + Math.sin(ang) * 200 + rand(-20, 20)), { mission: true, aggro: true, target: Math.random() < 0.65 ? st.pos : null, orbitR: rand(20, 40) });
        }
        G.UI.toast('Wave ' + M.wave + ' incoming', 'bad');
      }
      if (G.powerCoil) G.powerCoil.material.color.setHex(st.hp / st.max > 0.3 ? 0x66ccff : 0xff5544).multiplyScalar(2.5);
      if (st.hp <= 0) return failMission('The power station was destroyed');
      if (M.timer >= s.duration) { clearEnemies((e) => e.mission); nextStage(); }
    } else if (s.type === 'collect') {
      G.objective.sub = M.collected + ' / ' + M.need;
      const cores = pickups.filter((p) => p.kind === 'core' && p.alive);
      if (cores.length) { const near = cores.reduce((a, b) => (a.pos.distanceTo(P.pos) < b.pos.distanceTo(P.pos) ? a : b)); G.objective.wp = near.pos.clone(); }
      if (M.collected >= M.need) { clearEnemies((e) => e.mission); nextStage(); }
    } else if (s.type === 'boss') {
      if (G.boss) G.objective.wp = G.boss.pos.clone().setY(G.boss.pos.y + G.boss.hc);
      if (M.bossDead) { clearEnemies((e) => e.mission); nextStage(); }
    } else if (G.EXT.stage[s.type]) G.EXT.stage[s.type].update(s, M, dt);
  }
  G.nextStage = () => nextStage();
  G.failMission = (r) => failMission(r);

  // ================= FREE-ROAM CRIMES =================
  const crime = (G.crime = { active: false, t: 40, pos: null, left: 0 });
  function updateCrime(dt) {
    if (M.active || G.state.missionIndex < 2) { return; }
    if (!crime.active && G.race && G.race.active) return;
    if (!crime.active) {
      crime.t -= dt;
      if (crime.t <= 0) {
        const a = Math.random() * TAU, d = rand(250, 600);
        const x = clamp(P.pos.x + Math.cos(a) * d, -HALF + 100, HALF - 100), z = clamp(P.pos.z + Math.sin(a) * d, -HALF + 100, 32 * CELL - HALF - 60);
        crime.pos = new V3(x, 30, z); crime.active = true; crime.left = 0;
        const n = 3 + ((Math.random() * 3) | 0) + Math.min(3, G.state.missionIndex >> 1);
        for (let k = 0; k < n; k++) { crime.left++; spawnEnemy('trooper', crime.pos.clone().add(new V3(rand(-25, 25), rand(-5, 15), rand(-25, 25))), { crime: true, hpMul: 1 + G.state.missionIndex * 0.1, onDeath: () => crime.left-- }); }
        if (G.state.missionIndex >= 4) { const rs = roofs.filter((r) => Math.hypot(r.x - x, r.z - z) < 80 && r.y > 5); if (rs.length) { crime.left++; const r = pick(rs); spawnEnemy('turret', new V3(r.x, r.y, r.z), { crime: true, onDeath: () => crime.left-- }); } }
        G.UI.toast('Crime in progress: Syndicate raid', 'bad'); G.UI.say('D', pick(['Kade, Syndicate jet-troopers are shaking down a block. Marked on your map.', 'Got a report of a Syndicate raid. Can you handle it?', 'Another Syndicate crew. Check your map.']));
      }
    } else {
      G.objective.text = 'Stop the Syndicate raid'; G.objective.sub = crime.left + ' hostiles left'; G.objective.wp = crime.pos;
      if (crime.left <= 0) {
        crime.active = false; crime.t = rand(70, 120); G.state.stats.crimes++; crowd.cheerAround(crime.pos, 160);
        G.UI.toast('Raid stopped! Crimes stopped: ' + G.state.stats.crimes, 'info');
        G.addPart(randomPartId(1), 1);
        if (G.awardTech) G.awardTech(1, 'raid stopped');
      }
    }
  }

  // ================= INTERACT / FAST TRAVEL =================
  G.prompt = '';
  G.interact = function () {
    if (carry.car >= 0) { G.throwCar(); return; }
    if (G.interactHook && G.interactHook()) return;
    if (P.pos.distanceTo(HQ.core) < 9) { G.UI.openJuno(); return; }
    const np = crowd.nearest(), nc = nearestCar(6.5);
    const npD = np ? Math.hypot(np.axisX ? np.s - P.pos.x : np.line - P.pos.x, np.axisX ? np.line - P.pos.z : np.s - P.pos.z) : Infinity;
    if (nc && nc.d < npD && nearestBench().pos.distanceTo(P.pos) >= 16) { G.liftCar(nc.i); return; }
    if (np && nearestBench().pos.distanceTo(P.pos) >= 16) { G.UI.npcTalk(crowd.talk(np, P.pos)); return; }
    const b = nearestBench();
    if (b.pos.distanceTo(P.pos) < 16) { if (!G.state.benches.includes(b.b.id)) G.state.benches.push(b.b.id); G.UI.openBench(b.b); }
  };
  G.fastTravel = function (id) {
    if (M.active) { G.UI.toast('Can’t fast travel during a mission', 'bad'); return false; }
    const b = benchObjs.find((x) => x.b.id === id); if (!b || !G.state.benches.includes(id)) return false;
    P.pos.set(b.pos.x, b.pos.y, b.pos.z + 6); P.vel.set(0, 0, 0);
    G.UI.toast('Fast travel: ' + b.b.name, 'info'); return true;
  };

  // ================= PLAYER UPDATE =================
  function playerDie() {
    P.dead = true; P.deadT = 3; P.hp = 0;
    explosion(P.pos.clone().setY(P.pos.y + 1), 6, 0x9ff6ff);
    P.model.root.visible = false;
    G.UI.banner('SUIT FAILURE', 'Rebooting…');
    if (M.active) { const i = M.idx; cleanupMission(); M.active = false; M.retry = i; }
    if (G.onPlayerDie) G.onPlayerDie();
    if (carry.car >= 0) G.throwCar(true);
  }
  function respawn() {
    P.dead = false; P.model.root.visible = true;
    let best = null, bd = Infinity;
    benchObjs.forEach((b) => { if (!G.state.benches.includes(b.b.id)) return; const d = b.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = b; } });
    best = best || benchObjs[0];
    P.pos.set(best.pos.x, best.pos.y, best.pos.z + 6); P.vel.set(0, 0, 0);
    P.hp = P.suit.hp; P.energy = P.suit.energy; P.heat = [0, 0]; for (const k in P.integ) P.integ[k] = 1;
    if (M.retry != null) { G.UI.toast('Mission reset. Return to the yellow beacon to retry.', 'info'); M.retry = null; }
  }
  const camState = { dist: 8, pos: new V3() };
  function updatePlayer(dt) {
    if (P.dead) { P.deadT -= dt; if (P.deadT <= 0) respawn(); return; }
    const s = P.suit, k = input.keys, t = input.touch;
    const fwd = tmp.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    const right = tmp2.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    let mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + t.mx, mz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) + t.my;
    const up = (k.Space || t.up ? 1 : 0) - (k.KeyC || k.ControlLeft || t.down ? 1 : 0);
    const moving = Math.abs(mx) + Math.abs(mz) > 0.1;
    const wantBoost = (k.ShiftLeft || k.ShiftRight || t.boost) && moving && mz > 0;
    P.boosting = wantBoost && P.energy > 2;
    const target = new V3();
    if (P.boosting) {
      const look = new V3(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
      target.copy(look).multiplyScalar(s.boost).addScaledVector(right, mx * s.speed);
      target.y += up * s.speed * 0.8;
      P.energy -= s.boostCost * dt;
    } else {
      target.addScaledVector(fwd, mz * s.speed).addScaledVector(right, mx * s.speed);
      target.y = up * s.speed * 0.85;
    }
    if ((P.integ.legL + P.integ.legR) / 2 < 0.3) target.multiplyScalar(0.85);
    const resp = P.boosting ? 1.6 : 3.5;
    P.vel.lerp(target, 1 - Math.exp(-resp * dt));
    if (P.grounded && up <= 0 && !P.boosting) P.vel.y = Math.min(P.vel.y, 0);
    P.pos.addScaledVector(P.vel, dt);
    // collisions (sphere at chest)
    const c = new V3(P.pos.x, P.pos.y + 1.1, P.pos.z);
    const hit = collideSphere(c, 1.1, P.vel);
    P.pos.set(c.x, c.y - 1.1, c.z);
    P.grounded = hit === 2;
    if (P.pos.y <= 0) { P.pos.y = 0; if (P.vel.y < 0) P.vel.y = 0; P.grounded = true; }
    if (P.pos.y > 800) { P.pos.y = 800; P.vel.y = Math.min(0, P.vel.y); }
    const lim = HALF + 250, limS = 2720;
    if (Math.abs(P.pos.x) > lim || P.pos.z < -lim || P.pos.z > limS) { P.pos.x = clamp(P.pos.x, -lim, lim); P.pos.z = clamp(P.pos.z, -lim, limS); if (!G._edgeT || G._edgeT < 0) { G.UI.toast('Turning back: leaving Port Halcyon', 'info'); G._edgeT = 4; } }
    G._edgeT = (G._edgeT || 0) - dt;
    if (!P.boosting) P.energy = Math.min(s.energy, P.energy + s.regen * dt * (P.vel.length() < 5 ? 1.5 : 1));
    P.lastHurt += dt; if (P.lastHurt > 5) { P.hp = Math.min(s.hp, P.hp + 8 * dt); for (const k in P.integ) P.integ[k] = Math.min(1, P.integ[k] + dt * 0.07); }
    P.lanceCd -= dt;
    // carrying a car: slower, hands busy, click to throw
    if (carry.car >= 0) { P.vel.multiplyScalar(Math.exp(-1.2 * dt)); if (input.fire[0] || input.fire[1]) { input.fire = [false, false]; G.throwCar(); } }
    // weapons
    for (let i = 0; i < 2; i++) {
      const w = P.w[i];
      P.cd[i] -= dt;
      P.heat[i] = Math.max(0, P.heat[i] - w.cool * s.coolBonus * dt * (input.fire[i] ? 0.5 : 1.3));
      if (P.over[i] && P.heat[i] < 35) P.over[i] = false;
      if (input.fire[i] && !P.over[i] && P.cd[i] <= 0 && !P.shielding && carry.car < 0) {
        P.cd[i] = 1 / w.rate; P.heat[i] += w.heat * ((i === 0 ? P.integ.armR : P.integ.armL) < 0.3 ? 1.3 : 1);
        if (P.heat[i] >= 100) { P.heat[i] = 100; P.over[i] = true; G.UI.toast((i ? 'Secondary' : 'Primary') + ' overheated!', 'bad'); }
        fireWeapon(i);
      }
    }
    animatePlayer(dt);
    // audio
    // (sound layers are driven from the frame loop via AUDIO.update)
    // bench discovery & prompt
    G.prompt = '';
    benchObjs.forEach((b) => {
      const d = b.pos.distanceTo(P.pos);
      if (d < 70 && !G.state.benches.includes(b.b.id)) { G.state.benches.push(b.b.id); G.UI.toast('Workbench discovered: ' + b.b.name, 'info'); }
      if (d < 16) G.prompt = 'Press E — ' + b.b.name;
    });
    if (P.pos.distanceTo(HQ.core) < 9) G.prompt = 'Press E — Talk to JUNO';
    else if (carry.car >= 0) G.prompt = 'Click or E — Throw car';
    else if (!G.prompt) { const nc = nearestCar(6.5), np = crowd.nearest(); const npD = np ? Math.hypot(np.axisX ? np.s - P.pos.x : np.line - P.pos.x, np.axisX ? np.line - P.pos.z : np.s - P.pos.z) : Infinity;
      if (nc && nc.d < npD) G.prompt = 'Press E — Lift car'; else if (np) G.prompt = 'Press E — Talk'; }
    if (G.promptHook) G.promptHook();
    if (G.junoWp && G.junoWp.distanceTo(P.pos) < 10) { G.junoWp = null; G.UI.toast('JUNO waypoint reached', 'info'); }
    G.state.stats.time += dt;
  }
  const blob = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.65)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); return m;
  })();
  function animatePlayer(dt) {
    const m = P.model; m.root.position.copy(P.pos);
    { const gh = G.groundHeight(P.pos.x, P.pos.z, P.pos.y), gy = gh, hgt = P.pos.y - gy;
      blob.visible = !P.dead; blob.position.set(P.pos.x, gy + 0.08, P.pos.z); const sc = clamp(2.4 - hgt * 0.03, 0.6, 2.4); blob.scale.set(sc, sc, 1); blob.material.opacity = clamp(1 - hgt / 70, 0, 1); }
    post.boost += ((P.boosting ? clamp(Math.hypot(P.vel.x, P.vel.y, P.vel.z) / 160, 0.3, 1) : 0) - post.boost) * clamp(dt * 4, 0, 1);
    const hs = Math.hypot(P.vel.x, P.vel.z);
    const firing = input.fire[0] || input.fire[1];
    const facing = moving() || firing || P.boosting ? P.yaw : m.root.rotation.y;
    let dy = facing - m.root.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.root.rotation.y += dy * clamp(dt * 10, 0, 1);
    const air = !P.grounded;
    const lean = air ? clamp(hs / (P.suit.boost * 0.9), 0, 1) : 0;
    const diveP = P.boosting ? clamp(-P.pitch, -0.6, 1.2) : 0;
    const targetLean = firing ? Math.min(lean, 0.3) : lean * (1.25 + diveP * 0.3);
    m.body.rotation.x += (-targetLean - m.body.rotation.x) * clamp(dt * 6, 0, 1);
    const tt = performance.now() / 1000;
    const walk = !air ? clamp(hs / 15, 0, 1) : 0;
    const sw = Math.sin(tt * 9);
    if (!air) {
      m.legR.rotation.x = sw * 0.55 * walk; m.legL.rotation.x = -sw * 0.55 * walk;
      m.kneeR.rotation.x = -Math.max(0, -sw) * 0.9 * walk - 0.03; m.kneeL.rotation.x = -Math.max(0, sw) * 0.9 * walk - 0.03;
    } else {
      m.legR.rotation.x = 0.12 + lean * 0.1 + Math.sin(tt * 2) * 0.04; m.kneeR.rotation.x = -0.35 + lean * 0.25;
      m.legL.rotation.x = -0.02 + Math.sin(tt * 2 + 1) * 0.04; m.kneeL.rotation.x = -0.15 + lean * 0.1;
    }
    const aimX = Math.PI / 2 + P.pitch + targetLean;
    const rest = air ? -0.3 * lean + 0.1 : (walk ? -sw * 0.4 * walk : 0.05);
    m.armR.rotation.x = input.fire[0] ? aimX : rest;
    m.armL.rotation.x = input.fire[1] ? aimX : (air ? rest : sw * 0.4 * walk + 0.05);
    m.armR.rotation.z = input.fire[0] ? 0 : (air ? 0.3 * (1 - lean) + 0.06 : 0.08);
    m.armL.rotation.z = input.fire[1] ? 0 : (air ? -0.3 * (1 - lean) - 0.06 : -0.08);
    m.elbowR.rotation.x = input.fire[0] ? 0 : 0.25 + 0.2 * walk; m.elbowL.rotation.x = input.fire[1] ? 0 : 0.25 + 0.2 * walk;
    m.wristR.rotation.x = air && !input.fire[0] ? -0.3 * lean : 0; m.wristL.rotation.x = air && !input.fire[1] ? -0.3 * lean : 0;
    if (carry.car >= 0) { m.armR.rotation.set(2.95, 0, 0.28); m.armL.rotation.set(2.95, 0, -0.28); m.elbowR.rotation.x = m.elbowL.rotation.x = 0.35; m.wristR.rotation.x = m.wristL.rotation.x = 0; }
    m.head.rotation.x = clamp(-P.pitch * 0.4 + targetLean * 0.6, -0.5, 0.8);
    m.body.position.y = Math.sin(tt * 1.5) * 0.008 + (walk ? Math.abs(sw) * 0.03 : 0);
    const thrust = air ? (P.boosting ? 2.2 : 0.7 + Math.min(1, hs / 40)) : 0;
    m.flames.forEach((f, i) => { f.visible = thrust > 0 && !(i >= 2 && (input.fire[i - 2])); f.scale.set(1, thrust * (0.8 + Math.random() * 0.4), 1); });
    if (P.boosting) m.flameMat.color.setRGB(2.8, 1.7, 0.7); else m.flameMat.color.setRGB(0.9, 2.2, 2.6);
    if (air && Math.random() < (P.boosting ? 1 : 0.3)) {
      const fp = new V3(); m.flames[(Math.random() * 2) | 0].getWorldPosition(fp);
      particle(fp, P.vel.clone().multiplyScalar(-0.1).add(new V3(0, -3, 0)), 0.35, P.boosting ? 0.6 : 0.35, P.boosting ? 0xffb060 : 0x8fe8ff, 3);
    }
  }
  function moving() { const k = input.keys; return k.KeyW || k.KeyA || k.KeyS || k.KeyD || Math.abs(input.touch.mx) + Math.abs(input.touch.my) > 0.1; }
  function updateCamera(dt) {
    const fp = G.settings.fp;
    if (P.model) P.model.root.visible = !fp && !P.dead;
    VM.group.visible = fp && !P.dead && G.running;
    if (fp) {
      const hs = Math.hypot(P.vel.x, P.vel.z), walk = P.grounded ? clamp(hs / 15, 0, 1) : 0, t = performance.now() / 1000;
      camera.position.set(P.pos.x, P.pos.y + 2.05 + Math.sin(t * 9) * 0.05 * walk, P.pos.z);
      const strafe = (input.keys.KeyD ? 1 : 0) - (input.keys.KeyA ? 1 : 0) + input.touch.mx;
      VM.roll += ((-strafe * (P.boosting ? 0.12 : 0.035)) - VM.roll) * clamp(dt * 4, 0, 1);
      camera.rotation.order = 'YXZ'; camera.rotation.set(P.pitch, P.yaw, VM.roll); G.camRoll = VM.roll;
      if (G.shake > 0) { camera.position.add(new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(G.shake * 0.12)); G.shake = Math.max(0, G.shake - dt * 3); }
      const fovT = P.boosting ? 90 : 76; camera.fov += (fovT - camera.fov) * clamp(dt * 3, 0, 1); camera.updateProjectionMatrix();
      if (!P.dead && dt > 0) animateVM(dt);
      return;
    }
    const look = new V3(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
    const right = new V3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    const want = P.boosting ? 13 : 8.5;
    camState.dist += (want - camState.dist) * clamp(dt * 3, 0, 1);
    const pivot = P.pos.clone().add(new V3(0, 2.0, 0)).addScaledVector(right, 1.3);
    const back = look.clone().negate();
    const d = Math.min(camState.dist, rayWorld(pivot, back, camState.dist + 1) - 0.8);
    const cp = pivot.clone().addScaledVector(back, Math.max(1.5, d));
    if (cp.y < 0.6) cp.y = 0.6;
    if (G.shake > 0) { cp.add(new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(G.shake * 0.35)); G.shake = Math.max(0, G.shake - dt * 3); }
    camera.position.copy(cp);
    camera.lookAt(pivot.clone().addScaledVector(look, 20));
    const fovT = P.boosting ? 82 : 70; camera.fov += (fovT - camera.fov) * clamp(dt * 3, 0, 1); camera.updateProjectionMatrix();
    G.sky.position.copy(camera.position);
  }
  // attract-mode camera for the main menu
  function menuCamera(t) {
    const a = t * 0.00005;
    camera.position.set(Math.cos(a) * 650, 260, Math.sin(a) * 650 - 60);
    camera.lookAt(0, 80, -60); G.sky.position.copy(camera.position); VM.group.visible = false;
  }

  // ================= GAME FLOW =================
  G.running = false; G.paused = false;
  G.startGame = function (state) {
    const st = G.validateState(state); if (!st) { G.UI.toast('That save could not be loaded', 'bad'); return; }
    // reset world state
    clearEnemies(); shots.length = 0; pickups.forEach((p) => scene.remove(p.m)); pickups.length = 0;
    M.active = false; M.station = null; G.boss = null; crime.active = false; crime.t = 45;
    G.state = st;
    CLIMATE.setHours(st.hours != null ? st.hours : 17.1);
    P.suit = null; G.refreshLoadout();
    P.pos.set(st.pos[0], st.pos[1], st.pos[2]); P.vel.set(0, 0, 0); P.yaw = st.yaw || 0; P.pitch = -0.1; P.dead = false;
    spawnCrates();
    G.junoWp = null;
    G.running = true; G.paused = false;
    G._autoT = 0;
    if (G.extStart) G.extStart(st);
  };
  G.quitToMenu = function () {
    if (carry.car >= 0) G.throwCar(true);
    G.running = false; crowd.clear(); clearEnemies(); shots.length = 0; fallers.forEach((f) => scene.remove(f.g)); fallers.length = 0; if (P.model) scene.remove(P.model.root); P.model = null; blob.visible = false; post.boost = 0;
    markerG.visible = false; wpRing.visible = false;
    pickups.forEach((p) => scene.remove(p.m)); pickups.length = 0;
    if (G.extReset) G.extReset();
  };

  // test helper: advance the simulation without rendering (used by the headless test scripts)
  G._step = function (dt, n = 1) { for (let i = 0; i < n; i++) { crowd.update(dt, P.pos); updatePlayer(dt); updateEnemies(dt); updateShots(dt); updatePickups(dt); updateMission(dt); updateCrime(dt); updateCars(dt); updateEffects(dt); if (G.extUpdate) G.extUpdate(dt); } };
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (G.running) {
      if (!G.paused) {
        crowd.update(dt, P.pos);
        updatePlayer(dt); updateEnemies(dt); updateShots(dt); updatePickups(dt); updateMission(dt); updateCrime(dt); updateCars(dt); updateEffects(dt);
        if (G.extUpdate) G.extUpdate(dt);
        benchObjs.forEach((b) => (b.holo.rotation.y += dt));
        HQ.spin[0].rotation.y += dt * 0.6; HQ.spin[0].rotation.x += dt * 0.25; HQ.spin[1].rotation.x += dt * 0.9; HQ.spin[2].rotation.y += dt * 0.7; HQ.spin[2].rotation.z += dt * 0.4;
        HQ.inner.scale.setScalar(1 + Math.sin(now / 300) * 0.08 + (G.UI.juno && G.UI.juno.talking ? Math.random() * 0.25 : 0));
        if (G.towerRing) G.towerRing.rotation.z += dt * 0.3;
        G._autoT += dt; if (G._autoT > 180) { G._autoT = 0; if (!M.active) G.saveGame(0); }
      }
      updateCamera(G.paused ? 0 : dt);
      G.hitMarker = Math.max(0, (G.hitMarker || 0) - dt); G.hurtFlash = Math.max(0, (G.hurtFlash || 0) - dt);
    } else { updateCars(dt); menuCamera(now); }
    if (G.extAlways) G.extAlways(dt, now);
    CLIMATE.update(dt, { running: G.running && !G.paused, indoors: G.running && G.inHQ ? G.inHQ() : false });
    GFX.update(dt, now, G.running ? P.pos : null);
    if (AUDIO.ctx) {
      const fwd = camera.getWorldDirection(tmp2).clone(), up = new V3(0, 1, 0).applyQuaternion(camera.quaternion);
      AUDIO.update(dt, { cam: { pos: camera.position, fwd, up }, running: G.running && !G.paused && !P.dead, speed: P.vel.length(), vy: P.vel.y, alt: P.pos.y,
        boosting: P.boosting, grounded: P.grounded, walking: P.grounded && Math.hypot(P.vel.x, P.vel.z) > 1.5, indoors: G.inHQ ? G.inHQ() : false,
        people: G.crowdNear || 0, siren: G.crime && G.crime.active ? G.crime.pos : null, shield: !!P.shielding });
    }
    if (G.beaconMat) { const k = Math.sin(now / 350) > 0.2 ? 3 : 0.25; G.beaconMat.color.setRGB(k, k * 0.08, k * 0.1); }
    if (!G.running || G.paused) post.boost *= 0.9;
    GFX.render();
    if (G.UI) G.UI.frame(dt);
  }
  G.boot = function () { applySettings(); requestAnimationFrame(frame); };

  // internals shared with js/act2.js and js/blackwater.js
  G.X = { P, M, VM, input, enemies, shots, pickups, cars, crowd, blood, fallers, roofs, camera, scene, HQ, benchObjs,
    spawnEnemy, clearEnemies, damagePlayer, damageEnemy, killEnemy, enemyShot, spawnShot, explosion, burst, particle, beam, arc, sfx, los, rayWorld, solidAt, collideSphere,
    makePickup, makeHumanoid, makeSoldier, makeSuitModel, glowM, metal, rbox, cylG, emat, killCount, nearestBench, aimPoint, blastCars, randomPartId, clearShots: (f) => { for (let i = shots.length - 1; i >= 0; i--) if (f(shots[i])) shots.splice(i, 1); } };

  // projection helper for HUD markers
  G.project = function (v) {
    const p = v.clone().project(camera);
    const behind = tmp.subVectors(v, camera.position).dot(camera.getWorldDirection(tmp2)) < 0;
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, behind };
  };
})();
