// AEGIS: Port Halcyon — Act II systems
//  • suit abilities: Shield (hold F), Shockwave (G), Dash (R)
//  • suit upgrades bought with Tech Points
//  • new enemies: sniper, rocketeer, riot shield trooper, flak battery, Ironback walker, Nightjar (boss)
//  • new mission stages: chase (tail a courier) and defuse (hold E on charges)
//  • ring races with medals and saved best times
// Loads after main.js and uses the internals it shares on G.X.
(function () {
  'use strict';
  const G = window.G, D = window.GDATA, X = G.X, V3 = THREE.Vector3;
  const { P, M, input, enemies, scene } = X;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const tmp = new V3(), tmp2 = new V3(), tmp3 = new V3();
  const say = (w, t) => G.UI && G.UI.say(w, t);
  const toast = (t, k) => G.UI && G.UI.toast(t, k);
  const once = {};
  const hint = (key, who, text) => { if (once[key]) return; once[key] = true; say(who, text); };
  const add = (o) => { scene.add(o); return o; };
  const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.4), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  // objects that belong to an enemy (lasers, markers) and leave with it
  const deco = [];
  function attach(e, obj) { deco.push({ e, obj }); return obj; }
  // objects that belong to the running mission (bombs, the courier)
  const mdeco = [];
  function mAdd(obj) { mdeco.push(obj); return add(obj); }

  // ======================================================================
  // UPGRADES & TECH POINTS
  // ======================================================================
  const UPG = {}; D.UPGRADES.forEach((u) => (UPG[u.id] = u));
  const lvl = (id) => (G.state && G.state.tech && G.state.tech.up[id]) | 0;
  G.upgradeLevel = lvl;
  const AB = (G.AB = { shockCd: 0, dashCd: 0, dashT: 0, invuln: 0, shieldHit: 0, shieldOn: 0 });
  function abilityNumbers() {
    const sh = lvl('shield'), sk = lvl('shock'), th = lvl('thrust'), la = lvl('lance');
    AB.shieldDrain = 24 * (1 - 0.2 * sh); AB.shieldBlock = 0.8 + 0.05 * sh; AB.reflect = sh >= 3 ? 0.35 : 0;
    AB.shockR = 18 * (1 + 0.2 * sk); AB.shockDmg = 45 * (1 + 0.3 * sk); AB.shockMax = 8 - 1.2 * sk; AB.shockCost = 35; AB.stun = sk >= 3;
    AB.dashMax = 2.5 - 0.4 * th; AB.dashCost = 15;
    P.lanceDmg = Math.round(170 * (1 + 0.25 * la)); P.lanceMax = 3 - 0.5 * la; P.lanceCost = 50 - 6 * la;
  }
  G.applyUpgrades = function (s) {
    const a = lvl('armor'), r = lvl('reactor'), t = lvl('thrust');
    s.hp = Math.round(s.hp * (1 + 0.08 * a)); s.armor += 6 * a;
    s.energy = Math.round(s.energy * (1 + 0.12 * r)); s.regen = Math.round(s.regen * (1 + 0.1 * r) * 10) / 10;
    s.speed *= 1 + 0.07 * t; s.boost *= 1 + 0.07 * t; s.boostCost *= 1 - 0.1 * t;
    abilityNumbers();
    return s;
  };
  G.upgradeCost = (id) => { const u = UPG[id], l = lvl(id); return l >= u.cost.length ? null : u.cost[l]; };
  G.buyUpgrade = function (id) {
    const t = G.state.tech, c = G.upgradeCost(id);
    if (c == null) { toast('Already at max level', 'info'); return false; }
    if (t.pts < c) { toast('Not enough Tech Points (' + t.pts + '/' + c + ')', 'bad'); return false; }
    t.pts -= c; t.up[id] = lvl(id) + 1;
    G.refreshLoadout(); X.sfx('pick');
    toast(UPG[id].name + ' → level ' + t.up[id], 'part');
    return true;
  };
  G.awardTech = function (n, why) {
    if (!G.state || n <= 0) return;
    const t = G.state.tech; t.pts += n; t.earned += n;
    toast('+' + n + ' Tech Point' + (n > 1 ? 's' : '') + (why ? ' · ' + why : ''), 'part');
    if (!once.techHint) hint('techHint', 'J', 'Tech Points banked. Spend them on suit upgrades at any workbench, Upgrades tab.');
  };
  G.onMissionComplete = function () { G.awardTech(3, 'mission complete'); };
  G.onCrate = function () {
    const t = G.state.tech, want = Math.floor(G.state.crates.length / 5);
    if (want > t.crateTP) { const d = want - t.crateTP; t.crateTP = want; G.awardTech(d, 'every 5 crates'); }
  };

  // ======================================================================
  // ABILITIES
  // ======================================================================
  // shield bubble: fresnel rim + hex lattice + hit flare
  const shieldU = { uT: { value: 0 }, uHit: { value: 0 }, uA: { value: 0 } };
  const shieldMesh = add(new THREE.Mesh(new THREE.SphereGeometry(2.25, 40, 24), new THREE.ShaderMaterial({
    uniforms: shieldU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - wp.xyz; vP = position; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uT, uHit, uA; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = f * f;
        vec3 p = normalize(vP);
        vec2 uv = vec2(atan(p.z, p.x) * 3.8197, asin(clamp(p.y, -1.0, 1.0)) * 3.8197);
        uv.x += 0.5 * mod(floor(uv.y), 2.0);
        vec2 c = abs(fract(uv) - 0.5);
        float hex = smoothstep(0.43, 0.5, max(c.x * 1.15 + c.y * 0.55, c.y));
        float scan = smoothstep(0.96, 1.0, sin(p.y * 9.0 - uT * 4.0) * 0.5 + 0.5);
        float a = (0.02 + f * 0.75 + hex * 0.14 + scan * 0.08) * uA + uHit * (0.2 + hex * 0.5);
        gl_FragColor = vec4(vec3(0.35, 0.85, 1.0) * (0.9 + uHit * 2.0), a);
      }`,
  })));
  shieldMesh.visible = false; shieldMesh.renderOrder = 5; shieldMesh.frustumCulled = false;
  // shockwave visuals
  const fx = [];
  const ringGeo = new THREE.TorusGeometry(1, 0.06, 6, 64), sphGeo = new THREE.SphereGeometry(1, 24, 14);
  function shockFx(c, R) {
    const ring = add(new THREE.Mesh(ringGeo, additive(0x9ff6ff, 0.9))); ring.position.copy(c); ring.rotation.x = Math.PI / 2;
    const ring2 = add(new THREE.Mesh(ringGeo, additive(0x5fc8ff, 0.7))); ring2.position.copy(c);
    ring2.lookAt(X.camera.position);
    const sph = add(new THREE.Mesh(sphGeo, additive(0x8fe8ff, 0.35))); sph.position.copy(c);
    fx.push({ objs: [ring, ring2, sph], t: 0, life: 0.55, R, kind: 'shock' });
  }
  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.t += dt; const k = f.t / f.life, e = 1 - Math.pow(1 - k, 3);
      if (f.kind === 'shock') {
        f.objs[0].scale.setScalar(f.R * e); f.objs[1].scale.setScalar(f.R * e * 0.85); f.objs[2].scale.setScalar(f.R * e * 0.9);
        f.objs[0].material.opacity = 0.9 * (1 - k); f.objs[1].material.opacity = 0.7 * (1 - k); f.objs[2].material.opacity = 0.35 * (1 - k) * (1 - k);
      } else if (f.kind === 'stomp') {
        f.objs[0].scale.setScalar(f.R * e); f.objs[0].material.opacity = 0.8 * (1 - k);
      }
      if (k >= 1) { f.objs.forEach((o) => { scene.remove(o); o.material.dispose(); }); fx.splice(i, 1); }
    }
  }
  function shockwave() {
    if (P.dead || AB.shockCd > 0) return;
    if (P.energy < AB.shockCost) { toast('Shockwave needs ' + AB.shockCost + ' energy', 'bad'); return; }
    P.energy -= AB.shockCost; AB.shockCd = AB.shockMax;
    const c = P.pos.clone(); c.y += 1.1;
    const R = AB.shockR;
    shockFx(c, R); X.burst(c, 46, 0x9ff6ff, R * 2.4, 0.7, 0.5); X.sfx('shock', 1); G.shake = Math.max(G.shake || 0, 1.1);
    for (const e of enemies) {
      if (!e.alive) continue;
      tmp.copy(e.pos); tmp.y += e.hc;
      const d = tmp.distanceTo(c); if (d > R + e.r) continue;
      const k = 1 - clamp(d / (R + e.r), 0, 1) * 0.6;
      X.damageEnemy(e, AB.shockDmg * k, true);
      if (e.onShock) e.onShock(e);
      if (!e.heavy) {
        e.vel.add(tmp.sub(c).normalize().multiplyScalar(40 * k + 18)); e.knock = 1.2;
        if (e.human) e.flinch = 0.5;
        if (AB.stun) e.slowT = Math.max(e.slowT, 2.5);
      }
    }
    // hostile bolts and rockets inside the wave are swatted out of the air
    X.clearShots((s) => { if (s.friendly || s.p.distanceTo(c) > R * 1.4) return false; X.burst(s.p, 4, 0x9ff6ff, 8, 0.3, 0.2); return true; });
    X.blastCars(c, R * 0.8, 35);
    if (G.onBoom) G.onBoom(c);
  }
  function dash() {
    if (P.dead || AB.dashCd > 0) return;
    if (P.energy < AB.dashCost) { toast('Dash needs ' + AB.dashCost + ' energy', 'bad'); return; }
    P.energy -= AB.dashCost; AB.dashCd = AB.dashMax; AB.dashT = 0.32; AB.invuln = 0.38;
    const k = input.keys, t = input.touch;
    const mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + t.mx, mz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) + t.my;
    const fwd = new V3(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
    const right = new V3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    const dir = Math.abs(mx) + Math.abs(mz) > 0.1 ? fwd.clone().multiplyScalar(mz).addScaledVector(right, mx) : fwd.clone();
    if (P.grounded && dir.y < 0) dir.y = 0;
    dir.normalize();
    P.vel.addScaledVector(dir, 95);
    X.camera.fov += 12; X.camera.updateProjectionMatrix();
    X.sfx('dash', 0.9);
    const o = P.pos.clone(); o.y += 1.1;
    for (let i = 0; i < 18; i++) X.particle(o.clone().addScaledVector(dir, -i * 0.4), dir.clone().multiplyScalar(-rand(5, 20)).add(new V3(rand(-2, 2), rand(-2, 2), rand(-2, 2))), rand(0.2, 0.45), rand(0.3, 0.6), 0x8fe8ff, 3);
  }
  G.ability = function (code) {
    if (code === 'KeyG') shockwave();
    else if (code === 'KeyR') dash();
    // shield (F) is a hold: polled every frame in updateAbilities
  };
  G.shockwave = shockwave; G.dash = dash;
  // damage passing through the shield / dash
  G.dmgFilter = function (dmg, from) {
    if (AB.invuln > 0) { if (!once.dodge) { once.dodge = true; toast('Dodged!', 'info'); } return 0; }
    if (P.shielding) {
      AB.shieldHit = 1; X.sfx('shieldHit', 0.7);
      if (from) { const c = P.pos.clone(); c.y += 1.1; const d = tmp.subVectors(from, c).normalize(); X.burst(c.addScaledVector(d, 2.2), 6, 0x9ff6ff, 8, 0.35, 0.25); }
      P.energy = Math.max(0, P.energy - dmg * 0.3);
      return dmg * (1 - AB.shieldBlock);
    }
    return dmg;
  };
  // Shield Matrix level 3: some bolts bounce back at whoever fired them
  G.reflectShot = function (s) {
    if (!P.shielding || !AB.reflect || s.fuse || Math.random() > AB.reflect) return false;
    s.friendly = true; s.hit = new Set(); s.dmg *= 1.5; s.life = 3; s.color = new THREE.Color(0x9ff6ff).multiplyScalar(2.6);
    const own = s.owner && s.owner.alive ? s.owner : null;
    const sp = s.v.length();
    if (own) { s.v.subVectors(tmp.copy(own.pos).setY(own.pos.y + own.hc), s.p).setLength(sp); s.target = own; s.homing = 3; } else s.v.negate();
    AB.shieldHit = 1; X.sfx('shieldHit', 0.9);
    return true;
  };
  function updateAbilities(dt) {
    AB.shockCd = Math.max(0, AB.shockCd - dt); AB.dashCd = Math.max(0, AB.dashCd - dt);
    AB.dashT = Math.max(0, AB.dashT - dt); AB.invuln = Math.max(0, AB.invuln - dt);
    const want = !!(input.keys.KeyF || input.touch.shield) && !P.dead && !(G.UI && G.UI.modalOpen()) && !(G.carry && G.carry.car >= 0);
    if (want && !P.shielding && P.energy > 8) { P.shielding = true; X.sfx('shield', 0.8); hint('shield1', 'J', 'Shield up. It drains energy and you cannot fire through it.'); }
    if (P.shielding) {
      P.energy -= AB.shieldDrain * dt;
      if (P.energy <= 0) { P.energy = 0; P.shielding = false; toast('Shield collapsed: out of energy', 'bad'); }
      if (!want) P.shielding = false;
    }
    AB.shieldOn += ((P.shielding ? 1 : 0) - AB.shieldOn) * clamp(dt * 12, 0, 1);
    AB.shieldHit = Math.max(0, AB.shieldHit - dt * 3);
    shieldU.uT.value += dt; shieldU.uA.value = AB.shieldOn; shieldU.uHit.value = AB.shieldHit;
    shieldMesh.visible = AB.shieldOn > 0.02 && !P.dead;
    shieldMesh.position.set(P.pos.x, P.pos.y + 1.1, P.pos.z); shieldMesh.scale.setScalar(0.85 + 0.15 * AB.shieldOn);
    document.body.classList.toggle('shielding', !!P.shielding);
    document.body.classList.toggle('dashing', AB.dashT > 0);
    if (AB.dashT > 0 && Math.random() < 0.8) X.particle(P.pos.clone().setY(P.pos.y + 1.1), P.vel.clone().multiplyScalar(-0.15), 0.3, 0.5, 0x8fe8ff, 3);
  }
  G.abilityHud = function () {
    const lanceReady = P.lanceCd <= 0 && P.energy >= P.lanceCost;
    return [
      { k: 'Q', n: 'LANCE', f: P.lanceCd > 0 ? 1 - P.lanceCd / P.lanceMax : Math.min(1, P.energy / P.lanceCost), s: lanceReady ? 'ready' : P.lanceCd > 0 ? 'cool' : 'low', t: P.lanceCd > 0 ? P.lanceCd.toFixed(1) : '' },
      { k: 'F', n: 'SHIELD', f: P.shielding ? 1 : Math.min(1, P.energy / 8), s: P.shielding ? 'active' : P.energy > 8 ? 'ready' : 'low', t: P.shielding ? Math.round(AB.shieldBlock * 100) + '%' : '' },
      { k: 'G', n: 'SHOCK', f: AB.shockCd > 0 ? 1 - AB.shockCd / AB.shockMax : Math.min(1, P.energy / AB.shockCost), s: AB.shockCd > 0 ? 'cool' : P.energy >= AB.shockCost ? 'ready' : 'low', t: AB.shockCd > 0 ? AB.shockCd.toFixed(1) : '' },
      { k: 'R', n: 'DASH', f: AB.dashCd > 0 ? 1 - AB.dashCd / AB.dashMax : Math.min(1, P.energy / AB.dashCost), s: AB.dashT > 0 ? 'active' : AB.dashCd > 0 ? 'cool' : P.energy >= AB.dashCost ? 'ready' : 'low', t: AB.dashCd > 0 ? AB.dashCd.toFixed(1) : '' },
    ];
  };

  // ======================================================================
  // ENEMIES
  // ======================================================================
  const E = G.EXT.enemy;
  function soldierGroup(kind, standing) {
    const h = X.makeSoldier(kind); const g = new THREE.Group();
    h.root.position.y = standing ? 0 : -1.05; h.root.rotation.y = Math.PI; g.add(h.root);
    return { h, g };
  }
  function aimPose(h, e, tgt, baseY) {
    const dyT = tgt.y - (e.pos.y + baseY), dh = Math.hypot(tgt.x - e.pos.x, tgt.z - e.pos.z), ap = Math.atan2(dyT, dh);
    return ap;
  }
  const laserGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  function setBeam(m, a, b, w) {
    const L = a.distanceTo(b); m.position.addVectors(a, b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new V3(0, 1, 0), tmp3.subVectors(b, a).normalize()); m.scale.set(w, L, w);
  }

  // ---- SNIPER: rooftop marksman. Red laser for ~1.6 s, then a heavy round at where the laser points.
  E.sniper = {
    make() {
      const { h, g } = soldierGroup('gunner', true);
      h.m1.color.setHex(0x2f3329); h.m2.color.setHex(0x4a4f40);
      const rifle = h.palmR.parent, { M, DK } = h.mk;
      M(X.cylG(0.013, 0.013, 0.55), DK, 0, -0.66, -0.03, rifle);
      M(X.cylG(0.024, 0.024, 0.2), DK, 0, -0.14, -0.088, rifle);
      M(X.rbox(0.035, 0.012, 0.035, 0.005), X.glowM(0xff3030, 3), 0, -0.25, -0.088, rifle);
      h.palmR.position.y = -0.95;
      // ghillie hood
      M(new THREE.SphereGeometry(0.16, 10, 8, 0, TAU, 0, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: 0x3a3f2e, roughness: 1 }), 0, 0.12, 0.01, h.head, 1, 1.05, 1.1);
      const laser = add(new THREE.Mesh(laserGeo, additive(0xff2020, 0.0))); laser.visible = false; laser.frustumCulled = false;
      return { g, model: h, bm: h.m1, human: true, hp: 60, r: 1.2, hc: 1.15, drop: 0.5, laser, aggroR: 460, state: 'idle', fireT: rand(1.2, 3), aim: null, deco: [laser] };
    },
    update(e, dt, tgt, sl, distP) {
      const h = e.model;
      e.g.lookAt(tgt.x, e.pos.y, tgt.z);
      const ap = aimPose(h, e, tgt, 1.5);
      const r = e.state === 'charge' ? 1 : 0.3;
      h.armR.rotation.set(0.25 + (1.2 + ap) * r, 0, -0.12); h.elbowR.rotation.x = 0.12 + 0.4 * (1 - r);
      h.armL.rotation.set(0.2 + (1.1 + ap) * r, 0, 0.5 * r); h.elbowL.rotation.x = 0.55;
      h.legR.rotation.x = 0.18; h.legL.rotation.x = -0.12; h.kneeL.rotation.x = -0.25; h.kneeR.rotation.x = -0.1;
      e.flinch = Math.max(0, (e.flinch || 0) - dt); h.body.rotation.x = -e.flinch * 2; h.head.rotation.x = -ap * 0.5;
      if (!e.aggro) { e.laser.visible = false; return; }
      e.g.updateMatrixWorld(true);
      const mz = h.palmR.getWorldPosition(new V3());
      if (e.state === 'idle') {
        e.laser.visible = false;
        e.fireT -= dt * sl;
        if (e.fireT <= 0) {
          if (distP < 460 && X.los(mz, tgt) && !P.dead) {
            e.state = 'charge'; e.chargeT = 1.6; e.aim = tgt.clone().add(new V3(rand(-6, 6), rand(-3, 3), rand(-6, 6)));
            X.sfx('charge', 0.9, e.pos);
            hint('sniper', 'J', 'Sniper lock! Red laser means a shot in under two seconds. Shield, dash, or break line of sight.');
          } else e.fireT = 0.8;
        }
      } else {
        e.chargeT -= dt * sl;
        e.aim.lerp(tgt, clamp(dt * 3.2, 0, 1));
        const d = tmp.subVectors(e.aim, mz).normalize();
        const L = X.rayWorld(mz, d, 620);
        const end = mz.clone().addScaledVector(d, L);
        const k = 1 - clamp(e.chargeT / 1.6, 0, 1);
        e.laser.visible = true; setBeam(e.laser, mz, end, 0.04 + 0.05 * k);
        e.laser.material.opacity = 0.35 + 0.5 * k + (Math.sin(performance.now() / 30) > 0 ? 0.15 * k : 0);
        if (mz.distanceTo(tgt) > 4 && d.dot(tmp2.subVectors(tgt, mz).normalize()) > 0.9995) G.lockWarn = 0.15;
        if (e.chargeT <= 0) {
          X.enemyShot(mz, mz.clone().addScaledVector(d, 50), 900, 30, { size: 0.45, color: 0xffd8a0, sound: 'snipe', owner: e, life: 1.1 });
          X.burst(mz, 7, 0xffaa55, 10, 0.25, 0.15);
          e.state = 'idle'; e.fireT = rand(2.6, 4); e.laser.visible = false;
        }
      }
    },
  };

  // ---- ROCKETEER: jet-trooper with a shoulder launcher. Keeps its distance, fires slow homing rockets.
  E.rocketeer = {
    make() {
      const { h, g } = soldierGroup('trooper');
      h.m1.color.setHex(0x3a2c24);
      const { M, DK } = h.mk;
      const tube = M(X.cylG(0.085, 0.085, 0.78), DK, 0.2, 1.6, 0.02); tube.rotation.x = Math.PI / 2;
      M(X.cylG(0.09, 0.09, 0.04), X.glowM(0xff8030, 2.5), 0.2, 1.6, -0.38).rotation.x = Math.PI / 2;
      const tip = new THREE.Object3D(); tip.position.set(0.2, 1.6, -0.45); h.body.add(tip);
      return { g, model: h, bm: h.m1, human: true, flyer: true, hp: 70, r: 1.35, hc: 0, drop: 0.4, orbitR: rand(70, 110), alt: rand(18, 38), orbitA: rand(0, TAU), maxSpd: 30, fireT: rand(2, 4), tip,
        fire(e, dt, tgt) {
          e.fireT -= dt; if (e.fireT > 0) return;
          e.fireT = rand(3.8, 5.2);
          if (e.pos.distanceTo(tgt) < 330 && X.los(e.pos, tgt)) {
            const mz = e.tip.getWorldPosition(new V3());
            X.enemyShot(mz, tgt.clone().add(new V3(0, 6, 0)), 60, 16, { homing: 1.25, explode: 6, size: 1, color: 0xffaa33, sound: 'missile', owner: e, life: 6.5 });
            X.burst(mz, 8, 0xffaa55, 8, 0.5, 0.3); X.burst(mz, 5, 0x555555, 4, 1, 0.8);
            hint('rocket', 'J', 'Rockets inbound. They home in, but a shockwave swats them down.');
          }
        } };
    },
  };

  // ---- RIOT: jet-trooper behind a ballistic shield. Blocks shots from the front; flank, blast or shock him.
  E.riot = {
    make() {
      const { h, g } = soldierGroup('trooper');
      h.m1.color.setHex(0x1f2a3c);
      const { M } = h.mk;
      const sm = new THREE.MeshStandardMaterial({ color: 0x1a2430, metalness: 0.35, roughness: 0.18, transparent: true, opacity: 0.82 });
      const shield = M(X.rbox(0.82, 1.15, 0.07, 0.03), sm, -0.02, 1.22, -0.42);
      M(X.rbox(0.36, 0.05, 0.08, 0.01), X.glowM(0xffa020, 2.4), -0.02, 1.56, -0.42);
      M(X.rbox(0.84, 0.05, 0.09, 0.01), X.glowM(0x3355ff, 2), -0.02, 0.68, -0.42);
      return { g, model: h, bm: h.m1, human: true, flyer: true, hp: 95, r: 1.4, hc: 0, drop: 0.45, orbitR: rand(16, 28), alt: rand(2, 8), orbitA: rand(0, TAU), maxSpd: 26, fireT: rand(1.5, 2.5), shield, face: new V3(0, 0, 1),
        pose(e, dt, tgt) {
          e.face.set(tgt.x - e.pos.x, 0, tgt.z - e.pos.z).normalize();
          const hm = e.model; hm.armL.rotation.set(0.9, 0, 0.35); hm.elbowL.rotation.x = 1.3;
          e.shield.rotation.x = e.knock > 0 ? 0.9 : 0; e.shield.position.y = e.knock > 0 ? 0.9 : 1.22;
        },
        onShot(e, seg) {
          if (e.knock > 0) return 1.3;
          if (seg.x * e.face.x + seg.z * e.face.z < -0.3) { hint('riot', 'J', 'That shield is bulletproof from the front. Get around him, use explosives, or knock him off balance with G.'); return 0; }
          return 1.3;
        },
        fire(e, dt, tgt) {
          e.fireT -= dt; if (e.fireT > 0) return;
          e.fireT = rand(1.6, 2.4);
          if (e.pos.distanceTo(tgt) < 140 && X.los(e.pos, tgt)) { const mz = e.model.palmR.getWorldPosition(new V3()); for (let i = 0; i < 3; i++) setTimeout(() => { if (e.alive) X.enemyShot(e.model.palmR.getWorldPosition(new V3()), tgt, 140, 5, { spread: 0.03, size: 0.45, owner: e }); }, i * 110); X.burst(mz, 3, 0xffaa55, 6, 0.15, 0.12); }
        } };
    },
  };

  // ---- FLAK BATTERY (AA): twin-barrel anti-air gun with proximity-fused shells.
  E.aa = {
    make() {
      const g = new THREE.Group(), bm = X.metal(0x4a4e44, 0.6, 0.5), dk = X.metal(0x1e2022, 0.8, 0.35);
      const conc = new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.95 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4, 1.6, 12), conc); base.position.y = 0.8; g.add(base);
      [0, 1, 2, 3, 4, 5, 6, 7].forEach((i) => { const a = (i / 8) * TAU; const sb = new THREE.Mesh(X.rbox(1.6, 0.9, 0.9, 0.2), new THREE.MeshStandardMaterial({ color: 0x6b6248, roughness: 1 })); sb.position.set(Math.cos(a) * 4.6, 0.45, Math.sin(a) * 4.6); sb.rotation.y = -a; g.add(sb); });
      const head = new THREE.Group(); head.position.y = 1.6; g.add(head);
      const turr = new THREE.Mesh(X.rbox(3, 1.8, 3.4, 0.3), bm); turr.position.y = 0.9; head.add(turr);
      const shieldP = new THREE.Mesh(X.rbox(3.4, 1.6, 0.25, 0.08), bm); shieldP.position.set(0, 1.3, 1.6); head.add(shieldP);
      const barrels = new THREE.Group(); barrels.position.set(0, 1.4, 0.6); head.add(barrels);
      const muzzles = [];
      [-0.55, 0.55].forEach((x) => {
        const b = new THREE.Mesh(X.cylG(0.16, 0.2, 4.2), dk); b.rotation.x = Math.PI / 2; b.position.set(x, 0, 2.2); barrels.add(b);
        const br = new THREE.Mesh(X.cylG(0.26, 0.26, 0.5), dk); br.rotation.x = Math.PI / 2; br.position.set(x, 0, 4.2); barrels.add(br);
        const mz = new THREE.Object3D(); mz.position.set(x, 0, 4.6); barrels.add(mz); muzzles.push(mz);
      });
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 6, 0, TAU, 0, Math.PI / 2), dk); dish.rotation.x = -Math.PI / 2.4; dish.position.set(-1.2, 2.3, -1.2); head.add(dish);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), X.glowM(0xff2030, 3)); light.position.set(1.2, 2.1, -1.3); head.add(light);
      return { g, bm, head, barrels, muzzles, light, hp: 420, r: 4.2, hc: 2.4, drop: 1, dropTier: 2, aggroR: 540, fireT: rand(1, 2), heavy: true, mi: 0, recoil: 0 };
    },
    update(e, dt, tgt, sl, distP) {
      e.head.rotation.y = Math.atan2(tgt.x - e.pos.x, tgt.z - e.pos.z);
      const dh = Math.hypot(tgt.x - e.pos.x, tgt.z - e.pos.z);
      e.barrels.rotation.x = -clamp(Math.atan2(tgt.y - e.pos.y - 3, dh), -0.1, 1.3);
      e.recoil = Math.max(0, e.recoil - dt * 4); e.barrels.position.z = 0.6 - e.recoil * 0.5;
      e.light.visible = Math.sin(e.t * 8) > 0;
      if (!e.aggro) return;
      e.fireT -= dt * sl;
      if (e.fireT <= 0) {
        e.fireT = rand(0.9, 1.5);
        if (distP < 540 && !P.dead) {
          e.g.updateMatrixWorld(true);
          const mz = e.muzzles[e.mi++ % 2].getWorldPosition(new V3());
          const flight = mz.distanceTo(tgt) / 160;
          const lead = tgt.clone().addScaledVector(P.vel, flight * 0.7);
          if (X.los(mz, lead)) {
            X.enemyShot(mz, lead, 160, 13, { explode: 6, fuse: 9, size: 0.8, color: 0xffc070, sound: 'flak', owner: e, life: flight + rand(0.05, 0.35), spread: 0.025 });
            X.burst(mz, 6, 0xffcc66, 12, 0.6, 0.15); X.burst(mz, 4, 0x444444, 5, 1.2, 0.8); e.recoil = 1;
          }
        }
      }
    },
  };

  // ---- IRONBACK WALKER (mini-boss): two-legged Syndicate mech. Cannons, missile pod, stomp. Weak point: back vents.
  E.walker = {
    make() {
      const g = new THREE.Group(), A = X.metal(0x3b4048, 0.75, 0.35), B = X.metal(0x22262c, 0.8, 0.3), Y = X.metal(0xc9a23a, 0.5, 0.45);
      const glowR = X.glowM(0xff2a30, 3), glowO = X.glowM(0xff8a20, 3);
      const body = new THREE.Group(); body.position.y = 9.2; g.add(body);
      const mk = (geo, mat, x, y, z, par) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); (par || body).add(m); return m; };
      mk(X.rbox(4.2, 1.6, 3.2, 0.4), B, 0, -1.6, 0);                 // pelvis
      mk(X.rbox(6, 3.4, 5, 0.6), A, 0, 0.8, 0);                       // hull
      mk(X.rbox(5.2, 0.5, 4.4, 0.2), Y, 0, 2.7, 0);                   // top plate
      mk(X.rbox(3.6, 0.45, 0.2, 0.08), glowR, 0, 1.3, 2.55);          // visor slit
      mk(X.rbox(4.6, 1.2, 0.5, 0.2), B, 0, 0.1, 2.5);                 // chin armor
      const vents = [];
      [-1.3, 1.3].forEach((x) => { vents.push(mk(X.rbox(1.6, 1.6, 0.25, 0.1), glowO, x, 0.9, -2.58)); mk(X.rbox(1.9, 0.2, 0.5, 0.05), B, x, 1.85, -2.5); mk(X.rbox(1.9, 0.2, 0.5, 0.05), B, x, -0.05, -2.5); });
      const pod = new THREE.Group(); pod.position.set(0, 3.4, -0.6); body.add(pod);
      mk(X.rbox(3, 1.4, 2.2, 0.2), B, 0, 0, 0, pod);
      for (let i = 0; i < 6; i++) mk(X.cylG(0.2, 0.2, 0.1), glowO, -0.9 + (i % 3) * 0.9, 0.73, -0.4 + Math.floor(i / 3) * 0.8, pod);
      const guns = [];
      [-1, 1].forEach((sd) => {
        const arm = new THREE.Group(); arm.position.set(sd * 3.8, 0.6, 0.4); body.add(arm);
        mk(X.rbox(1.6, 1.8, 3.2, 0.3), A, 0, 0, 0, arm);
        [-0.35, 0.35].forEach((y) => { const b = mk(X.cylG(0.18, 0.22, 3.4), B, 0, y, 2.6, arm); b.rotation.x = Math.PI / 2; });
        const mz = new THREE.Object3D(); mz.position.set(0, 0, 4.4); arm.add(mz); guns.push({ arm, mz });
      });
      const legs = [];
      [-1, 1].forEach((sd) => {
        const hip = new THREE.Group(); hip.position.set(sd * 2.4, 7.6, 0); g.add(hip);
        mk(X.rbox(1.6, 1.6, 1.6, 0.4), B, 0, 0, 0, hip);
        const thigh = mk(X.rbox(1.3, 4.2, 1.5, 0.3), A, 0, -2.0, 0.5, hip); thigh.rotation.x = -0.35;
        const knee = new THREE.Group(); knee.position.set(0, -3.8, 1.3); hip.add(knee);
        mk(new THREE.SphereGeometry(0.85, 12, 8), B, 0, 0, 0, knee);
        const shin = mk(X.rbox(1.1, 4.0, 1.2, 0.3), A, 0, -1.9, -0.6, knee); shin.rotation.x = 0.3;
        mk(X.rbox(0.5, 1.6, 0.4, 0.1), Y, 0, -1.5, 0.1, knee);
        const foot = new THREE.Group(); foot.position.set(0, -3.7, -1.2); knee.add(foot);
        mk(X.rbox(2.2, 0.6, 3.4, 0.2), B, 0, -0.1, 0.4, foot);
        legs.push({ hip, knee, foot, sd });
      });
      return { g, bm: A, body, legs, guns, pod, vents, hp: 1800, r: 5.4, hc: 9.6, drop: 1, dropTier: 2, heavy: true, armored: true, aggroR: 600, boss: 'Ironback Walker', yaw: 0, walkT: 0, atkT: 3, atk: null, phase: 1, stompT: 0 };
    },
    update(e, dt, tgt, sl, distP) {
      const toP = tmp.set(tgt.x - e.pos.x, 0, tgt.z - e.pos.z); const dH = toP.length(); toP.normalize();
      // turn toward the player
      const want = Math.atan2(toP.x, toP.z); let dy = want - e.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      e.yaw += clamp(dy, -0.9 * dt * sl, 0.9 * dt * sl); e.g.rotation.y = e.yaw;
      const fwd = tmp2.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
      // walk: keep 25–60 m away, stay on solid ground (it will not walk off the bridge)
      let move = 0;
      if (!e.atk || e.atk === 'cannon') { if (dH > 60) move = 1; else if (dH < 25) move = -0.6; }
      if (move) {
        const sp = 7 * sl * move, nx = e.pos.x + fwd.x * sp * dt, nz = e.pos.z + fwd.z * sp * dt;
        const gh = G.groundHeight(nx, nz, e.pos.y + 3);
        if (Math.abs(gh - e.pos.y) < 2.5 && tmp3.set(nx, 0, nz).distanceTo(tmp.set(e.home.x, 0, e.home.z)) < 420) { e.pos.x = nx; e.pos.z = nz; e.walkT += dt * sl * 2.6 * Math.abs(move); }
      }
      e.pos.y = G.groundHeight(e.pos.x, e.pos.z, e.pos.y + 3);
      e.g.position.copy(e.pos);
      // legs (reverse-jointed gait)
      e.legs.forEach((L, i) => {
        const ph = e.walkT + i * Math.PI, sw = Math.sin(ph);
        let lift = Math.max(0, Math.cos(ph)) * (move ? 1 : 0);
        if (e.atk === 'stomp' && i === 0) lift = e.atkTime < 0.9 ? Math.min(1, e.atkTime / 0.5) * 1.6 : 0;
        L.hip.rotation.x = sw * 0.32 * (move ? 1 : 0) - lift * 0.45; L.knee.rotation.x = lift * 0.7; L.foot.rotation.x = -lift * 0.2;
      });
      e.body.position.y = 9.2 + Math.abs(Math.sin(e.walkT)) * 0.25 * (move ? 1 : 0);
      e.body.rotation.z = Math.sin(e.walkT) * 0.03;
      // aim cannons
      const pitch = Math.atan2(tgt.y - (e.pos.y + 9.6), Math.max(1, dH));
      e.guns.forEach((gu) => (gu.arm.rotation.x = -clamp(pitch, -0.4, 1.1)));
      e.vents.forEach((v) => v.material.color.setRGB(2.6 + Math.sin(e.t * 5) * 0.6, 0.9, 0.2));
      // phases
      if (e.phase === 1 && e.hp < e.maxHp * 0.5) {
        e.phase = 2; say('J', 'It is calling for backup. Keep hitting those vents.');
        for (let k = 0; k < 3; k++) X.spawnEnemy(k ? 'trooper' : 'rocketeer', e.pos.clone().add(new V3(rand(-30, 30), 25, rand(-30, 30))), { aggro: true, mission: true, drop: 0.3 });
      }
      // attacks
      e.atkT -= dt * sl;
      if (!e.atk && e.atkT <= 0 && !P.dead) {
        const close = dH < 17 && tgt.y < e.pos.y + 14;
        e.atk = close ? 'stomp' : pick(['cannon', 'cannon', 'missiles']);
        e.atkTime = 0; e.shots = e.atk === 'cannon' ? 10 + e.phase * 4 : 6 + e.phase * 2; e.sT = 0;
        if (e.atk === 'stomp') { X.sfx('servo', 1, e.pos); hint('stomp', 'J', 'It is going to stomp! Get some altitude!'); }
      }
      if (e.atk) {
        e.atkTime += dt * sl; e.sT -= dt * sl;
        if (e.atk === 'cannon' && e.sT <= 0 && e.shots > 0) {
          e.sT = 0.12; e.shots--; e.g.updateMatrixWorld(true);
          const mz = e.guns[e.shots % 2].mz.getWorldPosition(new V3());
          X.enemyShot(mz, tgt, 175, 9, { spread: 0.035, size: 0.8, color: 0xff5530, owner: e, sound: 'mg' }); X.burst(mz, 3, 0xffaa55, 8, 0.5, 0.12);
        }
        if (e.atk === 'missiles' && e.sT <= 0 && e.shots > 0) {
          e.sT = 0.22; e.shots--; e.g.updateMatrixWorld(true);
          const mz = e.pod.getWorldPosition(new V3()); mz.y += 1;
          X.enemyShot(mz, tgt.clone().add(new V3(rand(-10, 10), 25, rand(-10, 10))), 58, 12, { homing: 1.3, explode: 5, size: 1, color: 0xffaa33, sound: 'missile', owner: e, life: 7 });
        }
        if (e.atk === 'stomp' && !e.stomped && e.atkTime >= 0.9) {
          e.stomped = true;
          const c = e.pos.clone().addScaledVector(fwd, 2); c.y += 0.5;
          X.explosion(c.clone(), 6, 0xffb060); X.sfx('stomp', 1.2, c); G.shake = 1.6;
          const ring = add(new THREE.Mesh(ringGeo, additive(0xffb060, 0.8))); ring.position.copy(c); ring.rotation.x = Math.PI / 2;
          fx.push({ objs: [ring], t: 0, life: 0.5, R: 22, kind: 'stomp' });
          const pd = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
          if (pd < 22 && P.pos.y < c.y + 8) { X.damagePlayer(30 * (1 - pd / 30), c); P.vel.add(new V3(P.pos.x - c.x, 0, P.pos.z - c.z).setLength(45)); P.vel.y += 22; }
          X.blastCars(c, 22, 60);
        }
        const done = e.atk === 'stomp' ? e.atkTime > 1.5 : e.shots <= 0;
        if (done) { e.atk = null; e.stomped = false; e.atkT = rand(1.4, 2.6) / (e.phase === 2 ? 1.4 : 1); }
      }
    },
    // shots that hit its back (the reactor vents) do extra damage
    onShot(e, seg, hp) {
      const f = tmp3.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
      const rel = (hp.x - e.pos.x) * f.x + (hp.z - e.pos.z) * f.z;
      if (rel < -1.4) { X.burst(hp, 6, 0xff9a40, 12, 0.4, 0.3); return 1.9; }
      return 0.85;
    },
  };

  // ---- NIGHTJAR (Act II boss): Vesper Hale's stealth suit. Fast strafing, cloaks, blade volleys, mines, talon dives.
  E.nightjar = {
    make() {
      const m = X.makeSuitModel('#17121f', '#5b2f92', 1, 0xc070ff, 1.32);
      const g = new THREE.Group(); g.add(m.root);
      const wingM = X.metal(0x221a30, 0.8, 0.25), edge = X.glowM(0xc070ff, 2.6);
      [-1, 1].forEach((sd) => {
        const w = new THREE.Group(); w.position.set(sd * 0.12, 1.45, 0.16); w.rotation.set(0.25, sd * 0.35, sd * 0.95); m.body.add(w);
        const blade = new THREE.Mesh(X.rbox(0.09, 0.95, 0.03, 0.01), wingM); blade.position.y = 0.45; w.add(blade);
        const e2 = new THREE.Mesh(X.rbox(0.02, 0.9, 0.035, 0.008), edge); e2.position.set(sd * 0.05, 0.45, 0); w.add(e2);
      });
      m.m1.emissive = new THREE.Color(0);
      return { g, model: m, bm: m.m1, hp: 2600, r: 2.2, hc: 1.7, drop: 1, dropTier: 2, armored: true, aggroR: 900, boss: 'Vesper Hale — Nightjar', orbitA: rand(0, TAU), dir: 1, atkT: 2.5, atk: null, cloakT: 7, cloaked: false, stunT: 0, phase: 1, shimmerT: 0 };
    },
    update(e, dt, tgt, sl, distP) {
      const m = e.model;
      e.stunT = Math.max(0, e.stunT - dt);
      const ratio = e.hp / e.maxHp, ph = ratio > 0.6 ? 1 : ratio > 0.3 ? 2 : 3;
      if (ph !== e.phase) {
        e.phase = ph; e.invuln = 1.2;
        if (ph === 2) { say('V', 'Clever. Let us see how you handle company.'); for (let k = 0; k < 3; k++) X.spawnEnemy('drone', e.pos.clone().add(new V3(rand(-25, 25), rand(5, 15), rand(-25, 25))), { aggro: true, mission: true, drop: 0.3 }); }
        if (ph === 3) { say('V', 'Enough games!'); for (let k = 0; k < 2; k++) X.spawnEnemy('rocketeer', e.pos.clone().add(new V3(rand(-40, 40), 20, rand(-40, 40))), { aggro: true, mission: true, drop: 0.3 }); }
      }
      const toP = tmp.subVectors(tgt, e.pos); const d = toP.length(); toP.normalize();
      // cloak cycle
      e.cloakT -= dt * sl;
      if (!e.cloaked && e.cloakT <= 0 && !e.atk && e.stunT <= 0) { e.cloaked = true; e.cloakT = 4.2; X.sfx('cloak', 0.9, e.pos); hint('cloak', 'J', 'She is gone from optics! A shockwave will force her out of cloak.'); }
      else if (e.cloaked && e.cloakT <= 0) { decloak(e); e.atk = 'dive'; e.atkTime = 0; e.diveDir = toP.clone(); X.sfx('cloak', 0.9, e.pos); toast('Nightjar diving!', 'bad'); }
      // movement
      if (e.stunT > 0) e.vel.multiplyScalar(Math.exp(-4 * dt));
      else if (e.atk === 'dive') {
        e.vel.copy(e.diveDir).multiplyScalar(140);
        if (d < 6 && !e.hitDone) { e.hitDone = true; X.damagePlayer(26, e.pos); P.vel.addScaledVector(e.diveDir, 60); G.shake = 1.4; }
      } else {
        e.orbitA += dt * (e.cloaked ? 1.2 : 0.7) * e.dir * sl;
        if (Math.random() < dt * 0.25) e.dir *= -1;
        const R = e.cloaked ? 30 : 55 + Math.sin(e.t * 0.6) * 15;
        const want = tmp2.set(tgt.x + Math.cos(e.orbitA) * R, Math.max(tgt.y + 8 + Math.sin(e.t) * 12, 30), tgt.z + Math.sin(e.orbitA) * R);
        if (want.distanceTo(e.home) > 380) want.sub(e.home).setLength(380).add(e.home);
        const acc = want.sub(e.pos);
        e.vel.lerp(acc.clampLength(0, 70 * sl), clamp(dt * 2.5, 0, 1));
      }
      e.pos.addScaledVector(e.vel, dt);
      if (e.pos.y < 6) e.pos.y = 6;
      const c = tmp3.copy(e.pos); c.y += e.hc; X.collideSphere(c, 2, e.vel); e.pos.set(c.x, c.y - e.hc, c.z);
      e.g.position.copy(e.pos);
      e.g.rotation.y = Math.atan2(-toP.x, -toP.z);
      const sp = e.vel.length();
      m.body.rotation.x = -clamp(sp / 140, 0, 0.9); m.legR.rotation.x = 0.2; m.kneeR.rotation.x = -0.5; m.legL.rotation.x = 0.05; m.kneeL.rotation.x = -0.25;
      m.armR.rotation.x = e.atk === 'volley' ? Math.PI / 2 + 0.1 : 0.2; m.armL.rotation.x = e.atk ? Math.PI / 2 : 0.2; m.armR.rotation.z = 0.35 - (e.atk ? 0.35 : 0); m.armL.rotation.z = -0.35 + (e.atk ? 0.35 : 0);
      m.flames.forEach((f) => f.scale.set(1, 1 + Math.random() * 1.3, 1));
      // cloaked: only a faint shimmer
      e.g.visible = !e.cloaked || Math.random() < 0.04;
      if (e.cloaked) { e.shimmerT -= dt; if (e.shimmerT <= 0) { e.shimmerT = 0.06; X.particle(e.pos.clone().add(new V3(rand(-1, 1), 1.5 + rand(-1, 1), rand(-1, 1))), e.vel.clone().multiplyScalar(-0.1), 0.35, 0.35, 0x553a77, 0.5); } }
      // attacks
      e.atkT -= dt * sl;
      if (!e.atk && !e.cloaked && e.stunT <= 0 && e.atkT <= 0 && !P.dead) {
        e.atk = ph === 1 ? pick(['volley', 'volley', 'mines']) : pick(['volley', 'mines', 'dive']);
        e.atkTime = 0; e.shots = e.atk === 'volley' ? 3 + ph : 3 + ph; e.sT = 0; e.hitDone = false;
        if (e.atk === 'dive') { e.diveDir = toP.clone(); toast('Nightjar diving!', 'bad'); X.burst(e.pos.clone().setY(e.pos.y + 1.6), 20, 0xc070ff, 12, 0.6, 0.4); }
      }
      if (e.atk) {
        e.atkTime += dt * sl; e.sT -= dt * sl;
        const hand = new V3(); e.g.updateMatrixWorld(true); m.palmR.getWorldPosition(hand);
        if (e.atk === 'volley' && e.sT <= 0 && e.shots > 0) {
          e.sT = 0.32; e.shots--;
          const side = new V3(-toP.z, 0, toP.x);
          for (let k = -2; k <= 2; k++) X.enemyShot(hand, tgt.clone().addScaledVector(side, k * 3.2), 215, 8, { size: 0.55, color: 0xd080ff, owner: e, quiet: k !== 0 });
        }
        if (e.atk === 'mines' && e.sT <= 0 && e.shots > 0) {
          e.sT = 0.35; e.shots--;
          X.enemyShot(e.pos.clone().setY(e.pos.y + 1), tgt.clone().add(new V3(rand(-12, 12), rand(-4, 8), rand(-12, 12))), 22, 18, { homing: 0.55, explode: 7, fuse: 6, size: 1.3, color: 0xa040ff, owner: e, life: 8, sound: 'beep' });
        }
        const done = e.atk === 'dive' ? e.atkTime > 1.1 : e.shots <= 0;
        if (done) { e.atk = null; e.atkT = rand(1.2, 2.4) / (0.7 + ph * 0.3); e.vel.multiplyScalar(0.3); if (e.cloakT > 9 - ph * 2) e.cloakT = 9 - ph * 2; }
      }
    },
    onShot(e) { if (e.cloaked) return 0.25; if (e.stunT > 0) return 1.5; return 1; },
    onShock(e) { if (e.cloaked || e.atk === 'dive') { decloak(e); e.stunT = 2.2; e.atk = null; say('J', 'She is exposed! Hit her now!'); } },
    onLance(e) { if (e.cloaked) { decloak(e); e.stunT = 1.5; } },
  };
  function decloak(e) { e.cloaked = false; e.cloakT = 9 - e.phase * 2; e.g.visible = true; X.burst(e.pos.clone().setY(e.pos.y + 1.6), 24, 0xc070ff, 14, 0.5, 0.4); }

  // ======================================================================
  // MISSION STAGES: chase and defuse
  // ======================================================================
  const ST = G.EXT.stage;
  ST.chase = {
    start(s) {
      const { h, g } = soldierGroup('trooper');
      const caseM = new THREE.Mesh(X.rbox(0.5, 0.36, 0.13, 0.03), X.metal(0x2a2d33, 0.8, 0.3)); caseM.position.set(0, -0.32, 0); h.wristL.add(caseM);
      const lock = new THREE.Mesh(X.rbox(0.12, 0.05, 0.14, 0.01), X.glowM(0x3fe0ff, 3)); lock.position.set(0, -0.12, 0); caseM.add(lock);
      h.armL.rotation.set(0.1, 0, -0.1);
      mAdd(g);
      const p0 = s.path[0];
      M.ch = { g, h, pos: new V3(...p0), i: 1, lostT: 0, spookT: 0, pauseT: 0, esc: false, look: 0, vel: new V3() };
      g.position.copy(M.ch.pos);
      G.objective.meter = { v: 1, label: 'SIGNAL' };
    },
    update(s, Ms, dt) {
      const c = M.ch; if (!c) return;
      const path = s.path, dist = P.pos.distanceTo(c.pos);
      if (c.i < path.length) {
        const tgt = tmp.set(...path[c.i]);
        let sp = s.speed * (dist > s.far * 0.8 ? 0.65 : dist < s.near * 1.6 ? 1.2 : 1);
        if (c.pauseT > 0) { c.pauseT -= dt; sp = 0; c.look += dt * 2; }
        const to = tmp2.subVectors(tgt, c.pos); const L = to.length();
        if (L < 4) {
          c.i++;
          if (c.i === 5) { c.pauseT = 2.6; say('J', 'He has stopped. Checking his tail. Keep your distance.'); }
          if (c.i === 3 && !c.esc) { c.esc = true; for (let k = 0; k < 3; k++) X.spawnEnemy('drone', c.pos.clone().add(new V3(rand(-20, 20), 15, rand(-20, 20))), { mission: true, aggro: true, drop: 0.3 }); say('J', 'Syndicate escort drones. Do not let them drag you off the courier.'); }
        } else { c.vel.lerp(to.multiplyScalar(sp / L), clamp(dt * 3, 0, 1)); c.pos.addScaledVector(c.vel, dt); }
        const h = c.h; c.g.position.copy(c.pos);
        const yaw = c.pauseT > 0 ? Math.sin(c.look) * 2.4 : Math.atan2(c.vel.x, c.vel.z); c.g.rotation.y = yaw;
        h.body.rotation.x = clamp(c.vel.length() / 70, 0, 0.6); h.flames.forEach((f) => f.scale.set(1, 1.5 + Math.random(), 1));
        h.armR.rotation.set(0.3, 0, 0.15); h.legR.rotation.x = 0.2; h.kneeR.rotation.x = -0.5;
        // signal rules
        let warn = '';
        if (dist > s.far) { c.lostT += dt; warn = 'SIGNAL WEAK · ' + Math.max(0, 8 - c.lostT).toFixed(1) + 's'; if (c.lostT > 8) return G.failMission('Lost the courier signal'); }
        else c.lostT = Math.max(0, c.lostT - dt * 2);
        if (dist < s.near) { c.spookT += dt; warn = 'TOO CLOSE · back off'; if (c.spookT > 3) return G.failMission('The courier spotted you and burned the case'); if (c.spookT > 1.2) hint('spook', 'J', 'Too close, Rhea! He will make you.'); }
        else c.spookT = Math.max(0, c.spookT - dt);
        G.objective.sub = warn || 'Tailing · ' + Math.round(dist) + ' m';
        G.objective.meter = { v: clamp(1 - Math.max(c.lostT / 8, c.spookT / 3), 0, 1), label: warn ? 'SIGNAL' : 'SIGNAL', warn: !!warn };
        G.objective.wp = c.pos.clone().setY(c.pos.y + 2);
      } else {
        // landed at the drop point
        c.g.position.y = G.groundHeight(c.pos.x, c.pos.z, c.pos.y) + 1.05; c.h.body.rotation.x = 0; c.h.flames.forEach((f) => (f.visible = false));
        G.objective.meter = null;
        G.nextStage();
      }
    },
  };
  // bombs on the bridge deck
  function makeBomb() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(X.rbox(1.2, 0.6, 0.8, 0.08), X.metal(0x2a2c30, 0.6, 0.5)); base.position.y = 0.3; g.add(base);
    const pack = new THREE.MeshStandardMaterial({ color: 0x8a7a50, roughness: 0.9 });
    [-0.35, 0, 0.35].forEach((x) => { const c = new THREE.Mesh(X.cylG(0.13, 0.13, 0.75), pack); c.rotation.x = Math.PI / 2; c.position.set(x, 0.75, 0); g.add(c); });
    const screen = new THREE.Mesh(X.rbox(0.42, 0.2, 0.05, 0.02), X.glowM(0xff2020, 2.4)); screen.position.set(0, 0.42, 0.42); g.add(screen);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), X.glowM(0xff2020, 3.2)); light.position.set(0.45, 0.68, 0.3); g.add(light);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 40, 8, 1, true), additive(0xff3030, 0.18)); pillar.position.y = 20; g.add(pillar);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.06, 4, 40), additive(0xff4040, 0.7)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    return { g, screen, light, pillar, ring };
  }
  ST.defuse = {
    start(s) {
      M.df = { bombs: s.bombs.map((p) => { const b = makeBomb(); b.g.position.set(...p); mAdd(b.g); return Object.assign(b, { pos: new V3(...p), done: false, prog: 0 }); }), left: s.time, waveT: 4, wave: 0, beepT: 0 };
      G.objective.timer = s.time;
    },
    update(s, Ms, dt) {
      const df = M.df; if (!df) return;
      df.left -= dt; G.objective.timer = Math.max(0, df.left);
      if (df.left <= 0) {
        df.bombs.forEach((b, i) => { if (!b.done) setTimeout(() => X.explosion(b.pos.clone().setY(b.pos.y + 1), 14, 0xffa040), i * 250); });
        return G.failMission('The charges detonated');
      }
      const urgent = df.left < 30;
      let near = null, nd = Infinity, nearestUndone = null, nud = Infinity;
      df.bombs.forEach((b) => {
        if (b.done) return;
        const blink = Math.sin(performance.now() / (urgent ? 70 : 180)) > 0;
        b.light.visible = blink; b.ring.scale.setScalar(1 + 0.15 * Math.sin(performance.now() / 150));
        const d = b.pos.distanceTo(P.pos);
        if (d < nud) { nud = d; nearestUndone = b; }
        if (d < 7 && d < nd) { nd = d; near = b; }
      });
      df.beepT -= dt; if (df.beepT <= 0 && nearestUndone && nud < 80) { df.beepT = urgent ? 0.45 : 1; X.sfx('beep', 0.5, nearestUndone.pos); }
      const holding = !!(input.keys.KeyE || input.touch.use) && !P.dead;
      df.bombs.forEach((b) => { if (!b.done && b !== near) b.prog = Math.max(0, b.prog - dt * 0.5); });
      if (near && holding) {
        near.prog += dt / 2.6;
        if (Math.random() < 0.4) X.particle(near.pos.clone().add(new V3(rand(-0.4, 0.4), 0.6, 0.4)), new V3(rand(-2, 2), rand(1, 3), rand(-2, 2)), 0.25, 0.15, 0x9ff6ff, 2);
        if (near.prog >= 1) {
          near.done = true; near.prog = 1; near.screen.material.color.setRGB(0.2, 2.6, 0.6); near.light.material.color.setRGB(0.2, 2.6, 0.6); near.light.visible = true; near.pillar.visible = false; near.ring.visible = false;
          X.sfx('defuse', 1); const n = df.bombs.filter((b) => b.done).length;
          toast('Charge defused (' + n + '/' + df.bombs.length + ')', 'info');
          if (n < df.bombs.length) say('J', pick(['Charge safe. Next one.', 'Disarmed. Keep moving.', 'That one will not be going anywhere.']));
        }
      }
      G.defuse = near && !near.done ? { prog: near.prog, holding } : null;
      const done = df.bombs.filter((b) => b.done).length;
      G.objective.sub = done + ' / ' + df.bombs.length + ' charges defused';
      if (nearestUndone) G.objective.wp = nearestUndone.pos.clone().setY(nearestUndone.pos.y + 1.5);
      // waves of attackers come up the deck
      df.waveT -= dt;
      if (df.waveT <= 0 && df.wave < s.waves.length) {
        df.waveT = 28; const type = s.waves[df.wave++];
        const end = Math.random() < 0.5 ? 1120 : 1900;
        for (let k = 0; k < 4; k++) X.spawnEnemy(type, new V3(300 + rand(-40, 40), rand(35, 60), end + rand(-30, 30)), { mission: true, aggro: true, drop: 0.25 });
        toast('Syndicate reinforcements on the bridge', 'bad');
      }
      if (done >= df.bombs.length) { G.defuse = null; X.clearEnemies((e) => e.mission); G.objective.timer = null; G.nextStage(); }
    },
  };
  G.onMissionCleanup = function () {
    mdeco.forEach((o) => scene.remove(o)); mdeco.length = 0;
    M.ch = null; M.df = null; G.defuse = null; G.objective.meter = null;
  };
  G.onMissionStart = function () { if (G.race.active) endRace(null, 'Race cancelled: mission started'); };

  // ======================================================================
  // RACES
  // ======================================================================
  const race = (G.race = { active: false, def: null, i: 0, t: 0, count: 0, rings: [], starts: [] });
  const RING_R = 7;
  D.RACES.forEach((r) => {
    let L = 0, prev = new V3(...r.start); r.rings.forEach((p) => { const v = new V3(...p); L += v.distanceTo(prev); prev = v; });
    r.length = Math.round(L);
    const q = (x) => Math.round(x * 2) / 2;
    r.medals = [q(L / 115 + 2), q(L / 85 + 3), q(L / 60 + 4)]; // gold, silver, bronze (seconds)
  });
  G.RACES = D.RACES;
  const ringMat = (c, o) => additive(c, o);
  const ringGeoR = new THREE.TorusGeometry(RING_R, 0.42, 8, 48), discGeo = new THREE.CircleGeometry(RING_R - 0.3, 40);
  function buildStarts() {
    race.starts.forEach((s) => scene.remove(s.g)); race.starts = [];
    D.RACES.forEach((r) => {
      const g = new THREE.Group(); g.position.set(...r.start);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 260, 14, 1, true), ringMat(0x40ff80, 0.13)); col.position.y = 130 - r.start[1]; g.add(col);
      const ring = new THREE.Mesh(ringGeoR, ringMat(0x40ff80, 0.9)); g.add(ring);
      const disc = new THREE.Mesh(discGeo, ringMat(0x40ff80, 0.07)); ring.add(disc);
      const nx = new V3(...r.rings[0]); ring.lookAt(nx);
      add(g); race.starts.push({ r, g, ring });
    });
  }
  const unlocked = (r) => G.state && G.state.missionIndex >= r.unlock;
  function nearStart() {
    if (!G.state || M.active || race.active || P.dead) return null;
    for (const s of race.starts) if (unlocked(s.r) && s.g.position.distanceTo(P.pos) < 16) return s;
    return null;
  }
  const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
  G.fmtRace = fmt;
  function startRace(s) {
    const r = s.r;
    race.active = true; race.def = r; race.i = 0; race.t = 0; race.count = 3.2; race.lastBeep = 4;
    race.rings = r.rings.map((p, i) => {
      const m = add(new THREE.Mesh(ringGeoR, ringMat(i === r.rings.length - 1 ? 0xffd040 : 0x40ff80, 0.0))); m.position.set(...p);
      const nx = r.rings[i + 1] ? new V3(...r.rings[i + 1]) : new V3(...p).add(new V3(...p).sub(new V3(...(r.rings[i - 1] || r.start))));
      const pv = new V3(...(r.rings[i - 1] || r.start));
      m.lookAt(tmp.copy(m.position).add(nx.clone().sub(pv).normalize()));
      const disc = new THREE.Mesh(discGeo, ringMat(0x40ff80, 0.0)); m.add(disc); m.userData.disc = disc;
      return m;
    });
    P.pos.set(...r.start); P.vel.set(0, 0, 0);
    const f = tmp.set(...r.rings[0]).sub(P.pos); P.yaw = Math.atan2(-f.x, -f.z); P.pitch = Math.atan2(f.y, Math.hypot(f.x, f.z));
    G.UI.banner(r.name, 'Fly through every ring. Gold ' + fmt(r.medals[0]) + ' · Silver ' + fmt(r.medals[1]) + ' · Bronze ' + fmt(r.medals[2]));
    if (G.crime.active) toast('The raid can wait 30 seconds', 'info');
  }
  function endRace(medal, reason) {
    race.rings.forEach((m) => { scene.remove(m); m.material.dispose(); }); race.rings = [];
    race.active = false; G.objective.timer = null; G.objective.meter = null; race.count = 0;
    if (reason) toast(reason, 'info');
  }
  G.abandonRace = () => { if (race.active) endRace(null, 'Race abandoned'); };
  function finishRace() {
    const r = race.def, t = race.t;
    const rec = G.state.races[r.id] || (G.state.races[r.id] = { best: null, medal: 0 });
    const medal = t <= r.medals[0] ? 3 : t <= r.medals[1] ? 2 : t <= r.medals[2] ? 1 : 0;
    const pb = rec.best == null || t < rec.best;
    if (pb) rec.best = Math.round(t * 10) / 10;
    const names = ['NO MEDAL', 'BRONZE', 'SILVER', 'GOLD'];
    G.UI.banner(names[medal] + ' · ' + fmt(t), r.name + (pb ? ' · NEW PERSONAL BEST' : ' · best ' + fmt(rec.best)));
    X.sfx(medal ? 'defuse' : 'ui', 1);
    if (medal > rec.medal) {
      let tp = 0; for (let m = rec.medal + 1; m <= medal; m++) tp += m === 3 ? 2 : 1;
      if (medal === 3) G.addPart(X.randomPartId(2), 1);
      rec.medal = medal; G.awardTech(tp, names[medal].toLowerCase() + ' medal');
      say('J', medal === 3 ? 'Gold. I would clap if I had hands.' : medal === 2 ? 'Silver. Gold is ' + (t - r.medals[0]).toFixed(1) + ' seconds away.' : 'Bronze. A start. Thrusters and Overdrive upgrades will help.');
    } else if (!medal) say('J', 'Too slow for a medal. Bronze needs ' + fmt(r.medals[2]) + '.');
    endRace(medal);
    setTimeout(() => G.saveGame(0), 400);
  }
  function updateRace(dt) {
    race.starts.forEach((s) => { const on = unlocked(s.r) && !race.active && !M.active; s.g.visible = on; if (on) s.ring.rotation.z += dt * 0.6; });
    if (!race.active) return;
    const r = race.def;
    if (race.count > 0) {
      race.count -= dt;
      P.pos.set(...r.start); P.vel.set(0, 0, 0);
      const n = Math.ceil(race.count);
      if (n < race.lastBeep && n > 0) { race.lastBeep = n; X.sfx('count', 0.8); }
      if (race.count <= 0) { X.sfx('count', 1.2); race.go = 0.8; }
    } else race.t += dt;
    race.go = Math.max(0, (race.go || 0) - dt);
    race.rings.forEach((m, i) => {
      const cur = i === race.i, next = i === race.i + 1;
      m.visible = i >= race.i;
      m.material.opacity = cur ? 0.95 : next ? 0.45 : 0.18;
      m.userData.disc.material.opacity = cur ? 0.08 + 0.04 * Math.sin(performance.now() / 120) : 0;
      m.scale.setScalar(cur ? 1 + 0.04 * Math.sin(performance.now() / 160) : 1);
    });
    const ring = race.rings[race.i];
    if (race.count <= 0 && ring) {
      const d = ring.position.distanceTo(tmp.copy(P.pos).setY(P.pos.y + 1));
      if (d < RING_R + 1.5) {
        X.sfx('ring', 1); X.burst(ring.position, 20, race.i === race.rings.length - 1 ? 0xffd040 : 0x40ff80, 18, 0.6, 0.4);
        race.i++;
        if (race.i >= race.rings.length) return finishRace();
      } else if (d > 650) return endRace(null, 'Race abandoned: too far off course');
    }
    G.objective.text = r.name; G.objective.sub = 'Ring ' + Math.min(race.i + 1, race.rings.length) + ' / ' + race.rings.length;
    G.objective.timer = race.t; G.objective.wp = ring ? ring.position.clone() : null;
    const tGold = r.medals[0];
    G.objective.meter = { v: clamp(1 - race.t / r.medals[2], 0, 1), label: race.t <= tGold ? 'GOLD PACE' : race.t <= r.medals[1] ? 'SILVER PACE' : race.t <= r.medals[2] ? 'BRONZE PACE' : 'NO MEDAL', warn: race.t > r.medals[1] };
  }

  // ======================================================================
  // INTERACT / PROMPTS / FRAME
  // ======================================================================
  G.interactHook = function () {
    if (M.active && M.df) { const near = M.df.bombs.some((b) => !b.done && b.pos.distanceTo(P.pos) < 7); if (near) return true; }
    const s = nearStart(); if (s) { startRace(s); return true; }
    return false;
  };
  G.promptHook = function () {
    if (M.active && M.df && G.defuse) { G.prompt = 'Hold E — Defuse charge ' + Math.round(G.defuse.prog * 100) + '%'; return; }
    const s = nearStart();
    if (s) { const rec = G.state.races[s.r.id]; G.prompt = 'Press E — Race: ' + s.r.name + (rec && rec.best ? ' · best ' + fmt(rec.best) + ' ' + ['', '🥉', '🥈', '🥇'][rec.medal] : ''); }
  };
  G.onPlayerDie = function () { P.shielding = false; if (race.active) endRace(null, 'Race failed'); };
  G.extStart = function (st) {
    abilityNumbers();
    AB.shockCd = AB.dashCd = AB.invuln = 0; P.shielding = false;
    buildStarts(); endRace(null);
    if (!st.seenAbil) {
      st.seenAbil = true;
      setTimeout(() => { if (!G.running) return; say('J', 'Firmware update installed: hold F for a shield, G for a shockwave, R to dash.'); if (st.missionIndex >= 1) say('J', 'Ring races are marked with green beacons. Medals earn Tech Points for suit upgrades.'); }, 9000);
    }
  };
  G.extReset = function () {
    endRace(null); G.onMissionCleanup();
    deco.forEach((d) => scene.remove(d.obj)); deco.length = 0;
    race.starts.forEach((s) => scene.remove(s.g)); race.starts = [];
    shieldMesh.visible = false; P.shielding = false; document.body.classList.remove('shielding', 'dashing');
  };
  G.extUpdate = function (dt) {
    updateAbilities(dt);
    updateRace(dt);
    updateFx(dt);
    G.lockWarn = Math.max(0, (G.lockWarn || 0) - dt);
    // enemy-owned objects (sniper lasers) leave with their enemy
    for (const e of enemies) if (e.deco && !e._decoReg) { e._decoReg = true; e.deco.forEach((o) => attach(e, o)); }
    for (let i = deco.length - 1; i >= 0; i--) { const d = deco[i]; if (!d.e.alive || enemies.indexOf(d.e) < 0) { scene.remove(d.obj); deco.splice(i, 1); } }
  };
  // walker & nightjar go out with a bang
  const baseDeath = { walker: 1, nightjar: 1 };
  G.EXT.onKill = function (e) {
    if (!baseDeath[e.type]) return;
    const c = e.pos.clone().setY(e.pos.y + e.hc);
    for (let k = 0; k < 6; k++) setTimeout(() => X.explosion(c.clone().add(new V3(rand(-5, 5), rand(-3, 4), rand(-5, 5))), rand(5, 10), pick([0xffa040, 0xff7030, 0xc070ff])), k * 180);
  };
})();
