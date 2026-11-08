// AEGIS: Port Halcyon — Blackwater Rock and the Halcyon Bridge
// The world outside the city grid: a suspension bridge from the harbor to an old prison island
// (Vesper Hale's fortress in Act II), with a lighthouse, watchtowers and searchlights.
// Collision goes through G.addSolid (main.js), so flight, landing, shots and the walker all work here.
(function () {
  'use strict';
  const G = window.G, X = G.X, V3 = THREE.Vector3, scene = X.scene;
  const added = [];
  const add = (o) => { scene.add(o); added.push(o); return o; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- tiny deterministic noise ----------
  const hash = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
  function vnoise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    const l = (a, b, t) => a + (b - a) * t;
    const c = (dx, dy, dz) => hash(ix + dx, iy + dy, iz + dz);
    return l(l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy), l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
  }
  const fbm = (x, y, z) => vnoise(x, y, z) * 0.55 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.15;

  // ---------- rock: a collision box dressed as weathered cliff ----------
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0, envMap: GFX.ENV || null, envMapIntensity: 0.25 });
  function rock(x0, z0, x1, z1, top, opts = {}) {
    G.addSolid(x0, -5, z0, x1, top, z1);
    const w = x1 - x0, d = z1 - z0, h = top + 4;
    const geo = new THREE.BoxGeometry(w, h, d, Math.max(4, Math.ceil(w / 6)), Math.max(3, Math.ceil(h / 3.5)), Math.max(4, Math.ceil(d / 6)));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    geo.translate(cx, h / 2 - 4, cz);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const taper = opts.taper == null ? 2.5 : opts.taper, amp = opts.amp || 3.2;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n1 = fbm(x * 0.045, y * 0.07, z * 0.045), n2 = fbm(x * 0.09 + 7, y * 0.05, z * 0.09 + 3);
      const hk = clamp((y + 4) / h, 0, 1);
      // side vertices: push out/in along the face normal (noise), flare at the waterline, lean in at the top
      const dx = (x - cx) / (w / 2), dz = (z - cz) / (d / 2), onSide = Math.max(Math.abs(dx), Math.abs(dz)) > 0.999;
      if (onSide) {
        const nx = Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) : 0, nz = nx ? 0 : Math.sign(dz);
        const push = (n1 - 0.5) * amp * 2 + (0.5 - hk) * 2 * taper;
        x += nx * push; z += nz * push;
        // break up the straight edges along the face too
        const along = (n2 - 0.5) * amp; if (nx) z += along * 0.6; else x += along * 0.6;
      }
      const isTop = y > top - 0.05, topAmp = opts.topAmp == null ? 1 : opts.topAmp;
      if (isTop) y = top - (opts.sink || 0) + (n2 - 0.5) * 2.2 * topAmp; else if (y > -3.9) y += (n2 - 0.5) * 2.5;
      pos.setXYZ(i, x, y, z);
      // colour: wet dark band, grey-brown cliff, mossy top
      const v = 0.75 + n2 * 0.5;
      let r = 0.27 * v, g = 0.255 * v, b = 0.235 * v;
      if (y < 1.5) { r *= 0.45; g *= 0.47; b *= 0.5; }
      else if (y < 3) { r *= 0.7; g *= 0.72; b *= 0.72; }
      if (isTop) { const gr = vnoise(x * 0.05, 3, z * 0.05); r = (0.17 + 0.05 * (1 - gr)) * v; g = (0.18 + 0.05 * gr) * v; b = (0.14 + 0.02 * (1 - gr)) * v; }
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = add(new THREE.Mesh(geo, rockMat)); m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // ---------- fortress buildings: instanced facade boxes (same shader as the city) ----------
  const FB = []; // [cx,cy,cz,sx,sy,sz,color,win]
  function fbox(x0, y0, z0, x1, y1, z1, color, win, solid = true) {
    FB.push([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color, win]);
    if (solid) G.addSolid(x0, y0, z0, x1, y1, z1);
  }
  const STONE = 0x8a8478, STONE2 = 0x75706a, CONC = 0x8a877e, BRICK = 0x7a4a3a, WALL = 5; // 5 = dressed stone without windows
  const TOP = 22;

  // ===================== BLACKWATER ROCK =====================
  // plateau + ledges + lighthouse knoll + offshore boulders
  rock(-80, 1930, 440, 2400, TOP, { amp: 3.6, topAmp: 0, sink: 0.3 });
  rock(-125, 1990, -80, 2330, 8, { amp: 4.5, topAmp: 2.4 });
  rock(440, 1980, 485, 2290, 6, { amp: 4.5, topAmp: 2.2 });
  rock(60, 2400, 430, 2450, 9, { amp: 4.5, topAmp: 2.4 });
  rock(-60, 1895, 250, 1930, 11, { amp: 4, topAmp: 2.2 });
  rock(340, 1900, 430, 1930, 9, { amp: 4, topAmp: 2.2 });
  rock(-40, 2400, 60, 2490, 30, { amp: 2.6, topAmp: 0.8 });
  // prison yard: cracked concrete with painted lines, inside the walls
  {
    const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
    g.fillStyle = '#55534e'; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 2600; i++) { const r = Math.random() * 26 + 2; g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,38,34' : '150,146,138'},${Math.random() * 0.07})`; g.beginPath(); g.arc(Math.random() * 1024, Math.random() * 1024, r, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(50,48,44,0.55)'; g.lineWidth = 2; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 1024); g.moveTo(0, i * 128); g.lineTo(1024, i * 128); g.stroke(); }
    for (let k = 0; k < 40; k++) { let x = Math.random() * 1024, y = Math.random() * 1024, a = Math.random() * 6.3; g.strokeStyle = 'rgba(25,24,22,0.6)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); for (let j = 0; j < 14; j++) { a += (Math.random() - 0.5) * 1.2; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); } g.stroke(); }
    for (let k = 0; k < 9; k++) { g.fillStyle = `rgba(20,18,16,${0.15 + Math.random() * 0.2})`; g.beginPath(); g.ellipse(Math.random() * 1024, Math.random() * 1024, 20 + Math.random() * 40, 12 + Math.random() * 25, Math.random() * 3, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(200,170,60,0.55)'; for (let i = 0; i < 1024; i += 46) g.fillRect(i, 500, 26, 6);
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3.5, 3.3); tex.anisotropy = GFX.MAX_ANISO || 4;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(480, 446), new THREE.MeshStandardMaterial({ map: tex, color: 0xa8a49c, roughness: 0.95, metalness: 0 }));
    yard.rotation.x = -Math.PI / 2; yard.position.set(180, TOP + 0.04, 2171); yard.receiveShadow = true; add(yard);
  }
  rock(520, 2060, 542, 2086, 7, { amp: 2 }); rock(-172, 2150, -150, 2174, 5, { amp: 2 }); rock(232, 2470, 252, 2494, 6, { amp: 2 }); rock(-110, 1940, -92, 1960, 4, { amp: 1.5 });

  // perimeter walls with a gate for the bridge
  const WY = TOP + 11;
  fbox(-66, TOP, 1942, 260, WY, 1948, STONE, WALL); fbox(340, TOP, 1942, 426, WY, 1948, STONE, WALL);
  fbox(60, TOP, 2394, 426, WY, 2400, STONE, WALL);
  fbox(-66, TOP, 1948, -60, WY, 2386, STONE, WALL);
  fbox(420, TOP, 1948, 426, WY, 2394, STONE, WALL);
  fbox(-60, TOP, 2380, 60, WY - 3, 2386, STONE, WALL); // inner wall by the knoll
  // merlons along the wall tops
  const merl = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(L / 6); for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; fbox(x - 1.3, WY, z - 1.3, x + 1.3, WY + 1.8, z + 1.3, STONE2, WALL, false); } };
  merl(-63, 1945, 258, 1945); merl(342, 1945, 423, 1945); merl(62, 2397, 423, 2397); merl(-63, 1950, -63, 2384); merl(423, 1950, 423, 2392);
  // watchtowers (corners + gate)
  const tower = (x, z, s, h) => { fbox(x - s, TOP, z - s, x + s, TOP + h, z + s, STONE, 4); fbox(x - s - 1, TOP + h, z - s - 1, x + s + 1, TOP + h + 1.2, z + s + 1, STONE2, 0); };
  tower(-63, 1945, 7, 24); tower(423, 1945, 7, 24); tower(423, 2397, 7, 24); tower(-63, 2383, 7, 24); tower(255, 1945, 6, 20); tower(345, 1945, 6, 20);
  // gate arch over the bridge entry
  fbox(262, TOP + 14, 1942, 338, TOP + 19, 1948, STONE2, WALL);
  // cell blocks, admin hall + guard tower, hangar, guard post
  fbox(40, TOP, 2110, 200, TOP + 22, 2160, STONE, 4); fbox(38, TOP + 22, 2108, 202, TOP + 23.2, 2162, STONE2, 0, false);
  fbox(220, TOP, 2110, 380, TOP + 18, 2160, STONE, 4); fbox(218, TOP + 18, 2108, 382, TOP + 19.2, 2162, STONE2, 0, false);
  fbox(110, TOP, 2230, 270, TOP + 30, 2290, BRICK, 3); fbox(108, TOP + 30, 2228, 272, TOP + 31.2, 2292, STONE2, 0, false);
  fbox(175, TOP + 30, 2245, 205, TOP + 58, 2275, STONE, 4);
  fbox(60, TOP, 1965, 90, TOP + 8, 1985, CONC, 1);
  fbox(300, TOP, 2200, 400, TOP + 9, 2260, 0x5a6066, 1);
  fbox(-40, TOP, 2200, 20, TOP + 12, 2250, CONC, 1);
  // build the instanced facade mesh
  {
    const geo = new THREE.BoxGeometry(1, 1, 1), wa = new Float32Array(FB.length);
    FB.forEach((d, i) => (wa[i] = d[7]));
    geo.setAttribute('aWin', new THREE.InstancedBufferAttribute(wa, 1));
    const im = new THREE.InstancedMesh(geo, GFX.facadeMaterial(false), FB.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    FB.forEach((d, i) => { m.makeScale(d[3], d[4], d[5]); m.setPosition(d[0], d[1], d[2]); im.setMatrixAt(i, m); im.setColorAt(i, c.setHex(d[6])); });
    im.castShadow = true; im.frustumCulled = false; add(im);
  }
  // roofs & dressing
  const metalDark = X.metal(0x3a3f45, 0.7, 0.4);
  {
    // guard tower pyramid roof
    const pr = new THREE.Mesh(new THREE.ConeGeometry(23, 12, 4, 1), new THREE.MeshStandardMaterial({ color: 0x3d4652, roughness: 0.7, metalness: 0.3 }));
    pr.rotation.y = Math.PI / 4; pr.position.set(190, TOP + 64, 2260); pr.castShadow = true; add(pr);
    G.addSolid(180, TOP + 58, 2250, 200, TOP + 64, 2270);
    // hangar barrel roof
    const hr = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 100, 24, 1, false, 0, Math.PI), metalDark);
    hr.rotation.z = Math.PI / 2; hr.scale.set(0.4, 1, 1); hr.position.set(350, TOP + 9, 2230); hr.castShadow = true; add(hr);
    G.addSolid(300, TOP + 9, 2205, 400, TOP + 20, 2255);
    // hangar door glow
    const door = new THREE.Mesh(new THREE.PlaneGeometry(40, 8), X.glowM(0x6a3aa0, 1.2)); door.position.set(350, TOP + 4.5, 2199.8); door.rotation.y = Math.PI; add(door);
    // helipad
    const pad = new THREE.Mesh(new THREE.CircleGeometry(12, 40), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.8 })); pad.rotation.x = -Math.PI / 2; pad.position.set(360, TOP + 0.08, 2330); add(pad);
    const padR = new THREE.Mesh(new THREE.RingGeometry(10.5, 11.3, 40), X.glowM(0xffd040, 1.2)); padR.rotation.x = -Math.PI / 2; padR.position.set(360, TOP + 0.1, 2330); add(padR);
    // courtyard containers and crates
    const cm = [0x6a3a2a, 0x2f4a6a, 0x4a5a3a, 0x6a6a6a];
    [[0, 2040, 0], [12, 2040, 1], [-24, 2320, 2], [250, 2050, 3], [262, 2050, 0], [400, 2080, 1]].forEach(([x, z, k], i) => {
      const box = new THREE.Mesh(X.rbox(6, 6, 14, 0.15), new THREE.MeshStandardMaterial({ color: cm[k], roughness: 0.75, metalness: 0.3 }));
      box.position.set(x, TOP + 3, z); box.rotation.y = i % 2 ? 0.1 : -0.05; box.castShadow = true; add(box); G.addSolid(x - 3, TOP, z - 7, x + 3, TOP + 6, z + 7);
    });
    // floodlight masts
    [[100, 2060], [330, 2060], [40, 2320], [300, 2330]].forEach(([x, z]) => {
      const p = new THREE.Mesh(X.cylG(0.3, 0.4, 18), metalDark); p.position.set(x, TOP + 9, z); add(p);
      const hd = new THREE.Mesh(X.rbox(2.6, 1, 1, 0.1), X.glowM(0xfff0d0, 2.2)); hd.position.set(x, TOP + 18, z); add(hd);
    });
  }
  // searchlights on the watchtowers (sweeping beams, brighter at night)
  // soft light shafts: brightest near the lamp and along the axis, fading toward the edges and the far end
  const shaftMat = (col) => new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(col) }, uI: { value: 0.2 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying float vA; varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - wp.xyz; vA = uv.y; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uI; varying float vA; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float along = pow(vA, 2.2); gl_FragColor = vec4(uCol * uI * edge * along, 1.0); }`,
  });
  const beamMat = shaftMat(0xfff2d6);
  const beamGeo = new THREE.ConeGeometry(9, 160, 20, 1, true); beamGeo.translate(0, -80, 0); beamGeo.rotateX(-Math.PI / 2);
  const searchlights = [[-63, 1945, -0.75], [423, 1945, 0.75], [423, 2397, 0.25], [-63, 2383, -0.25]].map(([x, z, base], i) => {
    const g = new THREE.Group(); g.position.set(x, TOP + 26.5, z); g.rotation.order = 'YXZ'; add(g);
    const lamp = new THREE.Mesh(X.cylG(0.9, 1.1, 1.2), metalDark); lamp.rotation.x = Math.PI / 2; g.add(lamp);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.85, 16), X.glowM(0xfff4d8, 3)); lens.position.z = 0.62; g.add(lens);
    const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.z = 0.6; g.add(beam);
    return { g, phase: i * 1.7, base: base * Math.PI };
  });

  // ===================== LIGHTHOUSE =====================
  const LH = { x: 10, z: 2450, y: 30 };
  {
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6 }), red = new THREE.MeshStandardMaterial({ color: 0xa82a22, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const y0 = LH.y + i * 7, r0 = 5 - i * 0.24, r1 = 5 - (i + 1) * 0.24;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 7, 28), i % 2 ? red : white); s.position.set(LH.x, y0 + 3.5, LH.z); s.castShadow = true; add(s);
    }
    const gal = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 0.6, 28), metalDark); gal.position.set(LH.x, LH.y + 42.3, LH.z); add(gal);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 5, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x223040, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.35 })); glass.position.set(LH.x, LH.y + 45, LH.z); add(glass);
    LH.lamp = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), X.glowM(0xfff2c8, 3.5)); LH.lamp.position.set(LH.x, LH.y + 45, LH.z); add(LH.lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.8, 4.5, 16), red); cap.position.set(LH.x, LH.y + 49.8, LH.z); add(cap);
    G.addSolid(LH.x - 4.6, LH.y, LH.z - 4.6, LH.x + 4.6, LH.y + 52, LH.z + 4.6);
    const bg = new THREE.ConeGeometry(6, 220, 20, 1, true); bg.translate(0, -110, 0); bg.rotateX(-Math.PI / 2);
    LH.beam = new THREE.Group(); LH.beam.position.copy(LH.lamp.position); add(LH.beam);
    const bm = shaftMat(0xfff0c8); LH.beamMat = bm;
    [0, Math.PI].forEach((a) => { const b = new THREE.Mesh(bg, bm); b.rotation.y = a + Math.PI; LH.beam.add(b); });
    // keeper's cottage
    G.addSolid(22, LH.y, 2428, 42, LH.y + 7, 2446);
    const ch = new THREE.Mesh(X.rbox(20, 7, 18, 0.3), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 })); ch.position.set(32, LH.y + 3.5, 2437); ch.castShadow = true; add(ch);
    const rf = new THREE.Mesh(new THREE.ConeGeometry(15, 5, 4), red); rf.rotation.y = Math.PI / 4; rf.scale.set(1, 1, 0.85); rf.position.set(32, LH.y + 9.5, 2437); add(rf);
  }

  // ===================== HALCYON BRIDGE =====================
  const BX = 300, BW = 13, DECK = 22.4, Z0 = 1064, Z1 = 1940;
  G.BRIDGE = { x: BX, w: BW, deck: DECK, z0: Z0, z1: Z1 };
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8e8b84, roughness: 0.9 });
  const steel = X.metal(0x7a2e22, 0.55, 0.45); // weathered red steel
  {
    // asphalt with lane markings
    const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#2b2c2f'; g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.06})`; g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
    g.fillStyle = '#d8d0b0'; g.fillRect(6, 0, 3, 256); g.fillRect(119, 0, 3, 256);
    g.fillStyle = '#d8b030'; g.fillRect(62, 0, 2, 256); g.fillRect(65, 0, 2, 256);
    g.fillStyle = '#d8d0b0'; for (let y = 0; y < 256; y += 64) { g.fillRect(34, y, 2, 32); g.fillRect(92, y, 2, 32); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, (Z1 - Z0) / 50); tex.anisotropy = GFX.MAX_ANISO || 4;
    const asphalt = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.05 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(BW * 2, 2, Z1 - Z0), [concrete, concrete, asphalt, concrete, concrete, concrete]);
    deck.position.set(BX, DECK - 1, (Z0 + Z1) / 2); deck.receiveShadow = true; deck.castShadow = true; add(deck);
    G.addSolid(BX - BW, DECK - 2, Z0, BX + BW, DECK, Z1);
    // jersey barriers and rails
    [-1, 1].forEach((sd) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, Z1 - Z0), concrete); b.position.set(BX + sd * (BW - 0.45), DECK + 0.5, (Z0 + Z1) / 2); add(b);
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, Z1 - Z0), steel); r.position.set(BX + sd * (BW - 0.1), DECK + 1.9, (Z0 + Z1) / 2); add(r);
      const gird = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.4, Z1 - Z0), steel); gird.position.set(BX + sd * (BW - 1.4), DECK - 4.2, (Z0 + Z1) / 2); gird.castShadow = true; add(gird);
    });
    // cross beams under the deck
    const cb = new THREE.InstancedMesh(new THREE.BoxGeometry(BW * 2 - 2, 1.2, 1.2), steel, Math.floor((Z1 - Z0) / 20));
    for (let i = 0; i < cb.count; i++) cb.setMatrixAt(i, new THREE.Matrix4().makeTranslation(BX, DECK - 5.6, Z0 + 10 + i * 20));
    add(cb);
    // posts every 4 m along the rail
    const nPost = Math.floor((Z1 - Z0) / 4) * 2, posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), steel, nPost);
    for (let i = 0; i < nPost; i++) posts.setMatrixAt(i, new THREE.Matrix4().makeTranslation(BX + (i % 2 ? 1 : -1) * (BW - 0.1), DECK + 1.2, Z0 + 2 + Math.floor(i / 2) * 4));
    add(posts);
  }
  // north abutment + piers
  G.addSolid(BX - 16, 0, 1052, BX + 16, DECK, 1100);
  { const ab = new THREE.Mesh(X.rbox(32, DECK, 48, 0.5), concrete); ab.position.set(BX, DECK / 2, 1076); ab.castShadow = true; add(ab); }
  [1215, 1790].forEach((z) => {
    [-6.5, 6.5].forEach((dx) => { const p = new THREE.Mesh(X.rbox(5, DECK + 2, 5, 0.4), concrete); p.position.set(BX + dx, (DECK - 2) / 2 - 1, z); p.castShadow = true; add(p); G.addSolid(BX + dx - 2.5, -3, z - 2.5, BX + dx + 2.5, DECK - 6, z + 2.5); });
    const cap = new THREE.Mesh(X.rbox(BW * 2 + 2, 2, 6, 0.3), concrete); cap.position.set(BX, DECK - 6.5, z); add(cap);
  });
  // towers
  const TOWER_Z = [1350, 1650], TOPY = 128;
  TOWER_Z.forEach((tz) => {
    [-1, 1].forEach((sd) => {
      const lx = BX + sd * 15;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(8, TOPY + 3, 8), steel); leg.position.set(lx, (TOPY - 3) / 2, tz); leg.castShadow = true; add(leg);
      G.addSolid(lx - 4, -3, tz - 4, lx + 4, TOPY, tz + 4);
      // vertical rib detail
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.2, TOPY - 6, 8.6), X.metal(0x5e231a, 0.55, 0.5)); rib.position.set(lx + sd * -4.1, TOPY / 2, tz); add(rib);
      const lt = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), X.glowM(0xff2020, 3)); lt.position.set(lx, TOPY + 2.6, tz); add(lt); (G.BRIDGE.lights || (G.BRIDGE.lights = [])).push(lt);
    });
    [[66, 72], [118, 124]].forEach(([y0, y1]) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(22, y1 - y0, 6), steel); b.position.set(BX, (y0 + y1) / 2, tz); b.castShadow = true; add(b);
      G.addSolid(BX - 11, y0, tz - 3, BX + 11, y1, tz + 3);
    });
    const capB = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 10), X.metal(0x5e231a, 0.55, 0.5)); capB.position.set(BX, TOPY + 1, tz); add(capB);
  });
  // main cables (parabolic spans) + hangers
  const cableY = (z) => {
    if (z <= TOWER_Z[0]) { const t = (z - (Z0 + 6)) / (TOWER_Z[0] - Z0 - 6); return DECK + 2 + (TOPY + 1 - DECK - 2) * t * t; }
    if (z >= TOWER_Z[1]) { const t = ((Z1 - 6) - z) / (Z1 - 6 - TOWER_Z[1]); return DECK + 2 + (TOPY + 1 - DECK - 2) * t * t; }
    const m = (TOWER_Z[0] + TOWER_Z[1]) / 2, t = (z - m) / (TOWER_Z[1] - m); return 34 + (TOPY + 1 - 34) * t * t;
  };
  {
    const cm = X.metal(0x9aa0a8, 0.85, 0.3);
    [-1, 1].forEach((sd) => {
      const pts = []; for (let z = Z0 + 6; z <= Z1 - 6; z += 6) pts.push(new V3(BX + sd * 15, cableY(z), z));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.7, 6, false), cm); add(tube);
    });
    const hv = [];
    for (let z = Z0 + 18; z < Z1 - 12; z += 12) { if (TOWER_Z.some((t) => Math.abs(t - z) < 6)) continue; const y = cableY(z); [-1, 1].forEach((sd) => hv.push(BX + sd * 15, y, z, BX + sd * 13.2, DECK + 0.6, z)); }
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hv, 3));
    add(new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: 0x8a9098 })));
  }
  // deck lamps
  {
    const n = Math.floor((Z1 - Z0) / 36) * 2;
    const poles = new THREE.InstancedMesh(X.cylG(0.12, 0.16, 8), X.metal(0x2a2c30, 0.6, 0.5), n);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.25, 0.6), X.glowM(0xffc888, 1.9), n);
    for (let i = 0; i < n; i++) {
      const sd = i % 2 ? 1 : -1, z = Z0 + 20 + Math.floor(i / 2) * 36;
      poles.setMatrixAt(i, new THREE.Matrix4().makeTranslation(BX + sd * (BW - 0.6), DECK + 4, z));
      heads.setMatrixAt(i, new THREE.Matrix4().makeTranslation(BX + sd * (BW - 1.6), DECK + 8, z));
    }
    add(poles); add(heads); G.BRIDGE.lampHeads = heads;
  }
  // abandoned cars on the closed bridge
  {
    const cols = [0xdddddd, 0x8a1a1a, 0x1a3a8a, 0x222222, 0xc9b23a, 0x556677];
    [[293, 1180, 0.2], [306, 1240, -0.1], [294, 1395, 0.5], [305, 1520, 3.0], [293, 1690, -0.3], [307, 1730, 0.15], [295, 1860, 0.7]].forEach(([x, z, r], i) => {
      const g = new THREE.Group(); g.position.set(x, DECK, z); g.rotation.y = r; add(g);
      const body = new THREE.Mesh(X.rbox(1.9, 0.8, 4.4, 0.2), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], metalness: 0.6, roughness: 0.35 })); body.position.y = 0.65; body.castShadow = true; g.add(body);
      const cab = new THREE.Mesh(X.rbox(1.7, 0.6, 2.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x0c1218, metalness: 0.9, roughness: 0.1 })); cab.position.set(0, 1.3, -0.2); g.add(cab);
      [-1, 1].forEach((a) => [-1, 1].forEach((b) => { const w = new THREE.Mesh(X.cylG(0.34, 0.34, 0.25), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })); w.rotation.z = Math.PI / 2; w.position.set(a * 0.95, 0.34, b * 1.4); g.add(w); }));
    });
  }

  // ===================== MAP, DISTRICTS, ANIMATION =====================
  const ISLAND = [[-125, 1990], [-80, 1930], [-60, 1895], [250, 1895], [340, 1900], [430, 1900], [440, 1930], [485, 1980], [485, 2290], [440, 2300], [440, 2400], [430, 2450], [60, 2450], [60, 2490], [-40, 2490], [-40, 2400], [-80, 2400], [-125, 2330]];
  G.mapExtras = [
    { poly: ISLAND, fill: '#4a4840', stroke: '#2a2924' },
    { poly: [[-66, 1942], [426, 1942], [426, 2400], [-66, 2400]], stroke: '#9a958a', width: 2 },
    { rect: [40, 2110, 200, 2160], fill: '#77736a' }, { rect: [220, 2110, 380, 2160], fill: '#77736a' }, { rect: [110, 2230, 270, 2290], fill: '#7a5a4a' }, { rect: [300, 2200, 400, 2260], fill: '#5a6066' },
    { line: [[BX, Z0], [BX, Z1]], width: BW * 2, color: '#6d6f74' },
    { dot: [LH.x, LH.z], r: 6, color: '#ffe8a0' },
    { label: 'BLACKWATER ROCK', at: [180, 2500] }, { label: 'HALCYON BRIDGE', at: [BX + 120, 1500] },
  ];
  G.WORLD.SOUTH = 2560; // map extent south of the city grid
  const baseDistrict = G.districtAt;
  G.districtAt = function (x, z) {
    if (x > -130 && x < 490 && z > 1890 && z < 2495) return 'rock';
    if (Math.abs(x - BX) < BW + 4 && z > 1100 && z <= 1890) return 'bridge';
    return baseDistrict(x, z);
  };
  // everything solid out here also throws long shadows in the far cascade
  added.forEach((o) => { if (o.castShadow) GFX.farCaster(o); });
  const prev = G.extAlways;
  G.extAlways = function (dt, now) {
    if (prev) prev(dt, now);
    const env = GFX.envState || { dayK: 0 }, night = 1 - (env.dayK || 0) * 0.85;
    const t = now / 1000;
    LH.beam.rotation.y = t * 0.6; LH.beamMat.uniforms.uI.value = 0.06 + 0.5 * night;
    beamMat.uniforms.uI.value = 0.04 + 0.3 * night;
    searchlights.forEach((s) => { s.g.rotation.y = s.base + Math.sin(t * 0.25 + s.phase) * 1.2; s.g.rotation.x = 0.35 + Math.sin(t * 0.4 + s.phase) * 0.12; });
    const blink = Math.sin(now / 420) > 0.3;
    (G.BRIDGE.lights || []).forEach((l) => (l.visible = blink));
  };
})();
