// AEGIS: Port Halcyon — ambient life: seabird flocks over the harbor, the bridge, the island and the park.
// Birds wheel around their roost, flap and glide, and scatter when something explodes nearby.
(function () {
  'use strict';
  const G = window.G, X = G.X, V3 = THREE.Vector3, scene = X.scene;
  const rand = (a, b) => a + Math.random() * (b - a);
  // gull: two swept wings (tips raised) + body + tail. Flapping = scaling Y between +1 and -1 flips the wing tips up and down.
  const P = [
    0, 0, 0.32, 0, 0, -0.12, -0.55, 0.12, 0.05,   -0.55, 0.12, 0.05, 0, 0, -0.12, -1.0, 0.32, -0.12,
    0, 0, 0.32, 0.55, 0.12, 0.05, 0, 0, -0.12,    0.55, 0.12, 0.05, 1.0, 0.32, -0.12, 0, 0, -0.12,
    0, 0.02, 0.42, 0.07, 0, 0.05, -0.07, 0, 0.05,  0, 0.02, -0.12, -0.12, 0, -0.38, 0.12, 0, -0.38,
  ];
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0xe8e6e0, side: THREE.DoubleSide });
  const FLOCKS = [
    { c: [80, 40, 1060], n: 16, r: [25, 70], sea: true }, { c: [180, 55, 2170], n: 18, r: [40, 110], sea: true },
    { c: [300, 140, 1500], n: 10, r: [20, 60], sea: true }, { c: [-480, 38, -40], n: 12, r: [20, 55] }, { c: [-1000, 45, -200], n: 10, r: [20, 50] },
    { c: [700, 35, 1180], n: 12, r: [30, 80], sea: true },
  ];
  const birds = [];
  FLOCKS.forEach((f, fi) => { f.center = new V3(...f.c); f.scare = 0; for (let i = 0; i < f.n; i++) birds.push({ f, a: rand(0, Math.PI * 2), r: rand(f.r[0], f.r[1]), h: rand(-10, 12), w: rand(0.18, 0.4) * (Math.random() < 0.25 ? -1 : 1), ph: rand(0, 10), flap: rand(5, 8), s: rand(1.3, 1.7), pos: new V3() }); });
  const mesh = new THREE.InstancedMesh(geo, mat, birds.length); mesh.frustumCulled = false; scene.add(mesh);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), sc = new V3();
  const prevBoom = G.onBoom;
  G.onBoom = function (pos) { if (prevBoom) prevBoom(pos); FLOCKS.forEach((f) => { if (f.center.distanceTo(pos) < 160) f.scare = 7; }); };
  let gullT = 4;
  function update(dt, now) {
    const cam = X.camera.position, t = now / 1000;
    FLOCKS.forEach((f) => (f.scare = Math.max(0, f.scare - dt)));
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i], f = b.f, k = f.scare / 7;
      b.a += b.w * dt * (1 + k * 1.5);
      const r = b.r * (1 + k * 1.6);
      const y = f.center.y + b.h + Math.sin(t * 0.7 + b.ph) * 4 + k * 40;
      b.pos.set(f.center.x + Math.cos(b.a) * r, y, f.center.z + Math.sin(b.a) * r);
      // flap in bursts, glide in between (always flapping hard when scared)
      const flapping = k > 0.1 || Math.sin(t * 0.5 + b.ph) > 0.1;
      const wing = flapping ? Math.sin(t * b.flap * (1 + k) + b.ph) : 0.75;
      e.set(0, Math.atan2(-b.w * Math.sin(b.a), b.w * Math.cos(b.a)), Math.sign(b.w) * 0.35);
      q.setFromEuler(e); sc.set(b.s, b.s * wing, b.s);
      m4.compose(b.pos, q, sc); mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // occasional gull cries near the sea flocks
    gullT -= dt;
    if (gullT <= 0 && G.running && !G.paused) {
      gullT = rand(4, 11);
      let best = null, bd = 220; FLOCKS.forEach((f) => { if (!f.sea) return; const d = f.center.distanceTo(cam); if (d < bd) { bd = d; best = f; } });
      if (best) { const bb = birds.find((b) => b.f === best); X.sfx('gull', rand(0.25, 0.5), bb.pos); }
    }
  }
  const prev = G.extAlways;
  G.extAlways = function (dt, now) { if (prev) prev(dt, now); update(dt, now); };
})();
