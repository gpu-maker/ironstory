// AEGIS: Port Halcyon — graphics engine (built on three.js)
// Owns the renderer, camera, lights + shadows, sky, environment reflections, all custom
// shaders (facades, ground, sea), soft particles, and the post-processing stack
// (bloom, sun rays, lens flare, boost streaks, grading). Quality tiers: 0 Low, 1 High, 2 Ultra.
window.GFX = (function () {
  'use strict';
  const V3 = THREE.Vector3;
  const IS_TOUCH = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window);

  // ---------- renderer / scene / camera ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game').appendChild(renderer.domElement);
  const gl2 = renderer.capabilities.isWebGL2;
  const MAX_SAMPLES = gl2 ? renderer.getContext().getParameter(renderer.getContext().MAX_SAMPLES) || 4 : 0;
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6a4a5e);
  scene.fog = new THREE.Fog(0x6a4a5e, 440, 2200);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.2, 3000);

  // ---------- lights (low golden-hour sun with a shadow camera that follows the player) ----------
  const hemi = new THREE.HemisphereLight(0x8fa6d8, 0x3a2e2a, 0.75);
  scene.add(hemi);
  const SUN_DIR = new V3(-0.7, 0.24, 0.55).normalize();
  const sun = new THREE.DirectionalLight(0xffb070, 1.35);
  sun.position.copy(SUN_DIR);
  sun.castShadow = false;
  sun.shadow.mapSize.set(2048, 2048);
  const SH = 170;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 2200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  // ---------- shared uniforms + GLSL library ----------
  const U = {
    sunDir: { value: SUN_DIR }, uTime: { value: 0 },
    uShadowMap: { value: null }, uShadowMatrix: { value: sun.shadow.matrix }, uShadowOn: { value: 0 }, uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
    uWet: { value: 0 },
    uKeyDir: { value: new V3().copy(SUN_DIR) }, uKeyCol: { value: new THREE.Color(1.15, 0.78, 0.52) },
    uAmbSky: { value: new THREE.Color(0.30, 0.36, 0.50) }, uAmbGnd: { value: new THREE.Color(0.20, 0.18, 0.20) },
    uDayK: { value: 0 }, uDuskK: { value: 1 }, uNightK: { value: 0 }, uMoonDir: { value: new V3(0.4, 0.5, -0.6).normalize() },
    uLamps: { value: 1 }, uLitBias: { value: 0 }, uRain: { value: 0 }, uCloud: { value: 0 }, uFlash: { value: 0 }, uWetAmt: { value: 0.45 },
    // soft shadows (contact hardening), the far shadow cascade and planar reflections
    uSoft: { value: 0 }, uShadowRange: { value: 2199 }, uShadowTexelW: { value: 340 / 2048 },
    uFarMap: { value: null }, uFarMatrix: { value: new THREE.Matrix4() }, uFarOn: { value: 0 }, uFarTexel: { value: 1 / 2048 }, uFarRange: { value: 7000 },
    uRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
  };
  const fogMats = [];
  const GLSL_LIB = `
    #include <packing>
    uniform vec3 sunDir; uniform float uTime;
    uniform sampler2D uShadowMap; uniform mat4 uShadowMatrix; uniform float uShadowOn; uniform vec2 uShadowTexel; uniform float uWet;
    uniform vec3 uKeyDir; uniform vec3 uKeyCol; uniform vec3 uAmbSky; uniform vec3 uAmbGnd; uniform vec3 uMoonDir;
    uniform float uDayK, uDuskK, uNightK, uLamps, uLitBias, uRain, uCloud, uFlash, uWetAmt;
    float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),f.x), mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),f.x), f.y); }
    float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s; }
    vec3 skyCol(vec3 d){ d = normalize(d); float h=d.y;
      float s=max(dot(d,sunDir),0.0);
      vec3 horD = mix(vec3(0.50,0.46,0.58), vec3(1.0,0.58,0.30), pow(s, 2.5));
      vec3 dusk = mix(horD, vec3(0.07,0.13,0.30), pow(smoothstep(-0.02, 0.65, h), 0.55));
      dusk = mix(dusk, vec3(0.86,0.52,0.42), smoothstep(0.18, 0.0, abs(h - 0.06)) * 0.25 * (1.0 - s));
      vec3 day = mix(vec3(0.72,0.82,0.93), vec3(0.19,0.40,0.80), pow(smoothstep(-0.02, 0.8, h), 0.5));
      day += vec3(1.0,0.95,0.85) * pow(s, 6.0) * 0.22;
      vec3 night = mix(vec3(0.075,0.065,0.08), vec3(0.008,0.012,0.035), pow(smoothstep(-0.02, 0.5, h), 0.6));
      night += vec3(0.17,0.09,0.05) * smoothstep(0.25, 0.0, h) * 0.6;
      vec3 c = dusk * uDuskK + day * uDayK + night * uNightK;
      float sunUp = smoothstep(-0.08, 0.03, sunDir.y);
      c += vec3(1.0,0.62,0.32)*pow(s,8.0)*0.45*(1.0-smoothstep(0.0,0.5,h)) * uDuskK;
      c += vec3(1.0,0.8,0.6)*pow(s,64.0)*0.5*sunUp;
      vec3 grey = mix(vec3(0.46,0.49,0.54) * (0.3 + 0.7 * (uDayK + 0.5 * uDuskK)), vec3(0.035,0.04,0.055), uNightK);
      c = mix(c, grey * (0.72 + 0.28 * smoothstep(-0.1, 0.6, h)), uCloud * 0.85);
      c += vec3(0.62,0.66,0.85) * uFlash * 0.9;
      if (h < 0.0) c = mix(c, c * 0.62, smoothstep(0.0, -0.15, h));
      return c; }
    vec3 fogMix(vec3 col, vec3 wp, float dist, float fn, float ff){
      vec3 d = normalize(wp - cameraPosition); d.y = max(d.y, 0.0)*0.5+0.015;
      float f = smoothstep(fn, ff, dist);
      float hf = exp(-max(wp.y,0.0)*0.004);
      f = clamp(f*(0.7+0.4*hf),0.0,1.0);
      return mix(col, skyCol(d), f); }
    uniform float uSoft, uShadowRange, uShadowTexelW;
    uniform sampler2D uFarMap; uniform mat4 uFarMatrix; uniform float uFarOn, uFarTexel, uFarRange;
    uniform sampler2D uRefl; uniform mat4 uReflMat; uniform float uReflOn;
    float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    float sdep(sampler2D m, vec2 uv){ return unpackRGBAToDepth(texture2D(m, uv)); }
    // far cascade: one low-res map of the whole city, so distant towers still throw shadows
    float farShadow(vec3 wp, vec3 n){
      if (uFarOn < 0.5) return 1.0;
      float nl = dot(n, uKeyDir);
      float tanT = clamp(sqrt(max(1.0 - nl * nl, 0.0)) / max(abs(nl), 0.05), 0.0, 5.0);
      vec4 sc = uFarMatrix * vec4(wp + n * 1.6 + uKeyDir * 1.0, 1.0); vec3 p = sc.xyz / sc.w;
      if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
      float b = (1.5 + 2.2 * tanT) / uFarRange;
      float rot = ign(gl_FragCoord.xy) * 6.2832, s = 0.0;
      for (int i = 0; i < 6; i++) { float fi = float(i); float r = sqrt((fi + 0.5) / 6.0) * 1.6; float a = fi * 2.39996 + rot;
        s += step(p.z - b, sdep(uFarMap, p.xy + vec2(cos(a), sin(a)) * r * uFarTexel)); }
      return s / 6.0;
    }
    // near cascade around the player. Ultra/Max: contact-hardening soft shadows (blocker search + wide
    // rotated disc filter with receiver-slope bias). High: 3x3 PCF.
    float sunShadow(vec3 wp, vec3 n){
      if (uShadowOn < 0.5) return 1.0;
      float nl = dot(n, uKeyDir), slope = 1.0 - abs(nl);
      float tanT = clamp(sqrt(max(1.0 - nl * nl, 0.0)) / max(abs(nl), 0.05), 0.0, 6.0);
      bool soft = uSoft > 0.5;
      vec3 off = soft ? n * (0.3 + 0.7 * slope) + uKeyDir * 0.25 : n * (0.9 + 1.6 * slope) + uKeyDir * 0.6;
      vec4 sc = uShadowMatrix * vec4(wp + off, 1.0);
      vec3 p = sc.xyz / sc.w;
      float fs = farShadow(wp, n);
      if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return fs;
      float edge = smoothstep(0.0, 0.08, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)));
      float s = 0.0;
      if (soft) {
        float rot = ign(gl_FragCoord.xy) * 6.2832;
        float bs = 0.0, bn = 0.0, sb = (0.35 + 10.0 * uShadowTexelW * tanT) / uShadowRange;
        for (int i = 0; i < 8; i++) { float fi = float(i); float r = sqrt((fi + 0.5) / 8.0) * 10.0; float a = fi * 2.39996 + rot;
          float d = sdep(uShadowMap, p.xy + vec2(cos(a), sin(a)) * r * uShadowTexel); if (d < p.z - sb) { bs += d; bn += 1.0; } }
        if (bn < 0.5) s = 1.0;
        else {
          float distW = (p.z - bs / bn) * uShadowRange;               // metres between blocker and receiver
          float rad = clamp(distW * 0.016 / uShadowTexelW, 1.3, 10.0);  // penumbra grows with that distance
          float b = (0.25 + rad * uShadowTexelW * tanT) / uShadowRange;
          for (int i = 0; i < 16; i++) { float fi = float(i); float r = sqrt((fi + 0.5) / 16.0) * rad; float a = fi * 2.39996 + rot + 0.7;
            s += step(p.z - b, sdep(uShadowMap, p.xy + vec2(cos(a), sin(a)) * r * uShadowTexel)); }
          s /= 16.0;
        }
      } else {
        for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) s += step(p.z - 0.0018, sdep(uShadowMap, p.xy + vec2(float(x), float(y)) * uShadowTexel * 1.5));
        s /= 9.0;
      }
      return mix(fs, s, edge);
    }
    // planar reflection of the city (sea + wet streets). rgb = reflection, a = 1 when available
    vec4 planarRefl(vec3 wp, vec2 distort){
      if (uReflOn < 0.5) return vec4(0.0);
      vec4 rc = uReflMat * vec4(wp, 1.0); vec2 uv = rc.xy / rc.w + distort;
      float inside = step(0.0, rc.w) * smoothstep(0.0, 0.03, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
      return vec4(texture2D(uRefl, clamp(uv, 0.002, 0.998)).rgb, inside);
    }
  `;
  const VS_WORLD = 'varying vec3 vW; varying float vD; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }';

  // ---------- sky ----------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: GLSL_LIB + `varying vec3 vP;
      void main(){ vec3 d=normalize(vP); vec3 c=skyCol(d); float h=d.y;
        float s=max(dot(d,sunDir),0.0);
        float sunUp = smoothstep(-0.05, 0.03, sunDir.y) * (1.0 - uCloud * 0.9);
        c += (vec3(1.0,0.78,0.55)*pow(s,900.0)*2.2 + vec3(1.0,0.6,0.3)*pow(s,60.0)*0.45 * uDuskK) * sunUp;
        float mn = dot(d, uMoonDir);
        c += (vec3(0.92,0.94,1.0) * smoothstep(0.99955, 0.9997, mn) * 1.6 + vec3(0.5,0.6,0.8) * pow(max(mn, 0.0), 300.0) * 0.12) * uNightK * (1.0 - uCloud * 0.85);
        if(h>0.0){
          vec2 cp=d.xz/(h+0.12)*1.2 + vec2(uTime*0.004, uTime*0.002);
          float cl=fbm(cp*1.5); cl=smoothstep(0.5-0.38*uCloud,0.8-0.3*uCloud,cl)*smoothstep(0.0,0.18,h);
          float hi=fbm(cp*0.6+vec2(uTime*0.002,0.0)+9.0); hi=smoothstep(0.55,0.75,hi)*smoothstep(0.1,0.4,h)*0.5;
          vec3 ccD = mix(vec3(1.0,0.52,0.36), vec3(0.26,0.2,0.34), smoothstep(0.02,0.35,h)) + vec3(1.0,0.6,0.35)*pow(s,4.0)*0.7;
          vec3 ccY = mix(vec3(0.95,0.95,0.97), vec3(0.78,0.8,0.86), smoothstep(0.1,0.6,h)) + vec3(1.0,0.95,0.85)*pow(s,6.0)*0.3;
          vec3 ccN = vec3(0.05,0.055,0.08) + vec3(0.12,0.07,0.04) * smoothstep(0.3, 0.0, h);
          vec3 cc = ccD * uDuskK + ccY * uDayK + ccN * uNightK;
          cc = mix(cc, cc * vec3(0.55,0.57,0.62), uCloud) + vec3(0.7,0.72,0.9) * uFlash;
          c = mix(c, cc, cl*0.85);
          c = mix(c, mix(vec3(0.95,0.6,0.55), vec3(1.0), uDayK), hi*0.35*(1.0-uNightK*0.8));
          float st = step(0.9972, h21(floor(d.xz/(h+0.3)*420.0))) * smoothstep(0.25,0.6,h) * (1.0-cl);
          c += vec3(st)*0.9*(0.6+0.4*sin(uTime*3.0+h21(floor(d.xz*99.0))*20.0)) * (uNightK + uDuskK * 0.35) * (1.0 - uCloud);
        }
        gl_FragColor=vec4(c,1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2800, 32, 16), skyMat);
  sky.renderOrder = -1; scene.add(sky);

  // ---------- environment map (sky + distant warm city lights) for metals ----------
  let ENV;
  {
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
    let seed = 7; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 120; i++) {
      const a = R() * Math.PI * 2, y = -3 + R() * 7;
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.5 + R() * 3, 0.6 + R() * 2.5, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.08 + R() * 0.06, 0.8, 0.55 + R() * 0.2) }));
      m.position.set(Math.cos(a) * 40, y, Math.sin(a) * 40); m.lookAt(0, y, 0); es.add(m);
    }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(45, 24), new THREE.MeshBasicMaterial({ color: 0x15131c }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -6; es.add(floor);
    const pm = new THREE.PMREMGenerator(renderer);
    ENV = pm.fromScene(es, 0.02).texture;
    pm.dispose();
  }


  // ---------- time of day + weather ----------
  // hours: 0..24 (6 = sunrise, 12 = noon, 18 = sunset). rain: 0..1. flash: lightning 0..1.
  const RISE = new V3(0.7, 0, -0.55).normalize(), envState = { hours: 17, rain: 0, flash: 0, lamps: 1, dayK: 0, nightK: 0, duskK: 1, indoors: false };
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();
  const lerp3 = (a, b, c, wa, wb, wc) => [a[0] * wa + b[0] * wb + c[0] * wc, a[1] * wa + b[1] * wb + c[1] * wc, a[2] * wa + b[2] * wb + c[2] * wc];
  function setEnvironment(hours, rain, flash, indoors) {
    envState.hours = hours; envState.rain = rain; envState.flash = flash; envState.indoors = indoors;
    const ang = ((hours - 6) / 24) * Math.PI * 2;
    SUN_DIR.set(RISE.x * Math.cos(ang), Math.sin(ang) * 0.92, RISE.z * Math.cos(ang) + Math.sin(ang) * 0.32).normalize();
    U.uMoonDir.value.set(-SUN_DIR.x * 0.8 + 0.1, Math.max(0.25, -SUN_DIR.y), -SUN_DIR.z * 0.8).normalize();
    const e = SUN_DIR.y;
    const dayK = THREE.MathUtils.smoothstep(e, 0.12, 0.45), nightK = 1 - THREE.MathUtils.smoothstep(e, -0.18, 0.02);
    const duskK = Math.max(0, 1 - dayK - nightK);
    Object.assign(envState, { dayK, nightK, duskK });
    U.uDayK.value = dayK; U.uDuskK.value = duskK; U.uNightK.value = nightK;
    // key light: sun while it is up, moon at night
    const sunUp = e > -0.04, keyDir = sunUp ? SUN_DIR : U.uMoonDir.value;
    U.uKeyDir.value.copy(keyDir);
    const sunK = THREE.MathUtils.smoothstep(e, -0.04, 0.06);
    const kc = sunUp ? lerp3([1.15, 0.78, 0.52], [1.45, 1.38, 1.28], [0, 0, 0], 1 - dayK, dayK, 0).map((v) => v * sunK) : [0.13 * nightK, 0.17 * nightK, 0.28 * nightK];
    const rainDim = 1 - 0.78 * rain;
    U.uKeyCol.value.setRGB(kc[0] * rainDim + flash * 1.5, kc[1] * rainDim + flash * 1.6, kc[2] * rainDim + flash * 2.0);
    const as = lerp3([0.30, 0.36, 0.50], [0.52, 0.6, 0.74], [0.05, 0.065, 0.12], duskK, dayK, nightK);
    const ag = lerp3([0.20, 0.18, 0.20], [0.34, 0.32, 0.3], [0.04, 0.04, 0.06], duskK, dayK, nightK);
    const grey = 0.5 * rain;
    U.uAmbSky.value.setRGB(as[0] * (1 - grey) + 0.3 * grey * (1 - nightK) + flash * 0.4, as[1] * (1 - grey) + 0.32 * grey * (1 - nightK) + flash * 0.4, as[2] * (1 - grey) + 0.36 * grey * (1 - nightK) + flash * 0.5);
    U.uAmbGnd.value.setRGB(ag[0], ag[1], ag[2]);
    envState.lamps = Math.min(1, 1 - dayK * (1 - rain * 0.6));
    U.uLamps.value = envState.lamps;
    U.uLitBias.value = 0.3 * dayK - 0.13 * nightK;
    U.uRain.value = indoors ? 0 : rain; U.uCloud.value = Math.max(rain, 0); U.uFlash.value = flash;
    U.uWetAmt.value = Math.max(0.35 + 0.3 * nightK, rain);
    // three.js lights for the PBR materials (suit, enemies, props)
    sun.color.setRGB(Math.max(0.01, U.uKeyCol.value.r), Math.max(0.01, U.uKeyCol.value.g), Math.max(0.01, U.uKeyCol.value.b)); sun.intensity = 1.0;
    hemi.color.setRGB(U.uAmbSky.value.r * 2.2, U.uAmbSky.value.g * 2.2, U.uAmbSky.value.b * 2.2); hemi.groundColor.setRGB(ag[0] * 2, ag[1] * 2, ag[2] * 2);
    // fog / background colour approximates the horizon
    const hz = lerp3([0.56, 0.47, 0.55], [0.74, 0.82, 0.92], [0.09, 0.075, 0.085], duskK, dayK, nightK);
    const g2 = rain * 0.8; const gr = nightK > 0.5 ? 0.05 : 0.45;
    scene.fog.color.setRGB(hz[0] * (1 - g2) + gr * g2, hz[1] * (1 - g2) + gr * g2, hz[2] * (1 - g2) + (gr + 0.04) * g2); scene.background.copy(scene.fog.color);
    post.exposure = (1.0 * dayK + 1.25 * duskK + 1.9 * nightK) * (1 + rain * 0.25) - flash * 0.3;
    post.strength = 0.55 + 0.35 * nightK;
    rainMat.uniforms.uRain.value = indoors ? 0 : rain;
  }
  // rain streaks: thousands of segments that wrap around the camera (computed on the GPU)
  const RN = 7000;
  const rainMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uRain: { value: 0 }, uCam: { value: new V3() } }, transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 seed; attribute float endv; uniform float uTime, uRain; uniform vec3 uCam; varying float vA;
      void main(){
        vec3 box = vec3(90.0, 60.0, 90.0);
        vec3 p = seed * box; p.y -= uTime * (26.0 + seed.x * 10.0); p.x += uTime * 4.0;
        p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
        p += vec3(-0.12, 1.0, 0.0) * endv * (0.7 + seed.z * 0.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = (seed.y < uRain ? 1.0 : 0.0) * (1.0 - smoothstep(20.0, 45.0, length(p - uCam))) * (0.4 + 0.6 * endv);
        gl_Position = projectionMatrix * mv; if (vA <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.72, 0.78, 0.9, 0.42 * vA); }',
  });
  {
    const pos = new Float32Array(RN * 6), seed = new Float32Array(RN * 6), endv = new Float32Array(RN * 2);
    for (let i = 0; i < RN; i++) { const a = Math.random(), b = Math.random(), c = Math.random(); for (let k = 0; k < 2; k++) { seed.set([a, b, c], (i * 2 + k) * 3); endv[i * 2 + k] = k; } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 3)); g.setAttribute('endv', new THREE.BufferAttribute(endv, 1));
    const rainMesh = new THREE.LineSegments(g, rainMat); rainMesh.frustumCulled = false; rainMesh.renderOrder = 4; scene.add(rainMesh);
  }

  // ---------- material helpers ----------
  function glowM(hex, k = 2.5, extra) { return new THREE.MeshBasicMaterial(Object.assign({ color: new THREE.Color(hex).multiplyScalar(k) }, extra || {})); }
  function metal(c, metalness = 0.75, roughness = 0.35) { return new THREE.MeshStandardMaterial({ color: c, metalness, roughness, envMap: ENV, envMapIntensity: 1.3, emissive: 0x000000 }); }

  // Building facade shader. Windows are laid out in each building's own local space, so
  // rotated (twisting) towers and round towers get correct window grids.
  // Building facade shader: procedural brick / stone / concrete / glass, edge AO, weathering,
  // and "interior mapping" (fake 3D rooms behind every window). Windows are laid out in each
  // building's local space, so rotated and round towers get correct grids.
  function facadeMaterial(round) {
    const m = new THREE.ShaderMaterial({
      defines: round ? { ROUND: 1 } : {},
      extensions: { derivatives: true },
      uniforms: Object.assign({ fogNear: { value: 400 }, fogFar: { value: 2200 } }, U),
      vertexShader: `attribute float aWin;
        varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vD; varying float vWin; varying vec3 vL; varying vec3 vLN; varying vec3 vS; varying vec3 vCen; varying vec3 vT;
        void main(){
          vec4 w = modelMatrix * instanceMatrix * vec4(position,1.0);
          vS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vL = position * vS; vLN = normal;
          vCen = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
          vW = w.xyz; vN = normalize(mat3(instanceMatrix) * (normal / vS));
          #ifdef ROUND
            vec3 tl = normalize(vec3(-position.z, 0.0, position.x) + vec3(1e-5));
          #else
            vec3 tl = abs(normal.x) > 0.5 ? vec3(0.0,0.0,1.0) : vec3(1.0,0.0,0.0);
          #endif
          vT = normalize(mat3(instanceMatrix) * tl);
          #ifdef USE_INSTANCING_COLOR
            vC = instanceColor;
          #else
            vC = vec3(0.6);
          #endif
          vWin = aWin;
          vec4 mv = viewMatrix * w; vD = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: GLSL_LIB + `uniform float fogNear; uniform float fogFar;
        varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vD; varying float vWin; varying vec3 vL; varying vec3 vLN; varying vec3 vS; varying vec3 vCen; varying vec3 vT;
        // ray-march-free interior mapping: room = one window cell wide/high, 1.3 cells deep
        vec3 room(vec2 f, vec2 id, vec3 rd, vec2 gs, vec3 T, vec3 n, float lit, vec3 litC, float bh){
          vec3 d = vec3(dot(rd, T) / gs.x, rd.y / gs.y, dot(rd, -n) / gs.x);
          d.z = max(d.z, 0.02);
          vec3 p = vec3(f, 0.0); float depth = 1.3;
          float tx = d.x > 0.0 ? (1.0 - p.x) / d.x : -p.x / min(d.x, -1e-4);
          float ty = d.y > 0.0 ? (1.0 - p.y) / d.y : -p.y / min(d.y, -1e-4);
          float tz = depth / d.z;
          float t = min(tx, min(ty, tz)); vec3 hp = p + d * t;
          float rn = h21(id + bh * 13.0);
          vec3 wall = mix(vec3(0.78,0.72,0.64), vec3(0.62,0.68,0.74), step(0.5, rn)) * (0.85 + 0.15 * h21(id + 3.7));
          vec3 c;
          if (t == tz) {
            c = wall * 0.95;
            if (hp.y < 0.32) c *= 0.55;                                      // furniture silhouettes
            if (abs(hp.x - 0.5) < 0.18 && hp.y > 0.45 && hp.y < 0.75 && rn > 0.4) c = mix(c, vec3(0.3,0.45,0.6), 0.6); // picture / screen
          } else if (t == ty) {
            c = d.y > 0.0 ? vec3(0.92,0.9,0.85) : mix(vec3(0.36,0.25,0.17), vec3(0.42,0.42,0.44), step(0.55, rn));
          } else c = wall * 0.82;
          float fall = 1.0 - (hp.z / depth) * 0.45;
          vec3 light = lit > 0.5 ? litC * (d.y > 0.0 && t == ty ? 1.25 : 1.0) : vec3(0.035, 0.04, 0.06);
          return c * light * fall;
        }
        void main(){
          vec3 n = normalize(vN);
          vec3 v = normalize(cameraPosition - vW);
          vec3 rd = -v;
          float shd = sunShadow(vW, n);
          float sunL = max(dot(n, uKeyDir), 0.0) * shd;
          vec3 amb = mix(uAmbGnd, uAmbSky, n.y * 0.5 + 0.5);
          vec3 light = amb + uKeyCol * sunL;
          float ao = mix(0.45, 1.0, smoothstep(0.0, 26.0, vW.y));
          float bh = h21(floor(vCen.xz * 0.37 + 0.5));
          #ifdef ROUND
            float u = atan(vL.z, vL.x) * vS.x + 100.0; float fw = 1e4;
          #else
            float u = abs(vLN.x) > 0.5 ? vL.z + vS.z*0.5 : vL.x + vS.x*0.5;
            float fw = abs(vLN.x) > 0.5 ? vS.z : vS.x;
          #endif
          float edge = min(u, fw - u);
          float edgeAO = mix(0.78, 1.0, smoothstep(0.0, 1.6, edge));
          vec3 alb = vC;
          float far = clamp(smoothstep(0.08, 0.3, fwidth(vW.y) * 2.0) + smoothstep(250.0, 500.0, vD), 0.0, 1.0);
          // weathering: vertical rain streaks and grime near the ground
          float streak = vnoise(vec2(u * 0.35, vW.y * 0.025 + bh * 9.0));
          alb *= 1.0 - 0.14 * smoothstep(0.45, 0.85, streak) * (1.0 - far * 0.6);
          alb *= mix(0.82, 1.0, smoothstep(0.0, 6.0, vW.y));
          if (n.y > 0.5) {
            // roof: gravel / membrane with seams
            alb = vC * (0.5 + 0.22 * vnoise(vW.xz * 0.6) + 0.1 * vnoise(vW.xz * 4.0));
            vec2 t = fract(vW.xz / 3.0); if (t.x < 0.03 || t.y < 0.03) alb *= 0.85;
            alb *= 1.0 - 0.35 * uRain;
            gl_FragColor = vec4(fogMix(alb * (amb + uKeyCol * max(dot(n, uKeyDir), 0.0) * shd), vW, vD, fogNear, fogFar), 1.0);
            return;
          }
          if (vWin > 2.5 && vWin < 3.5) {          // brick
            vec2 bc = vec2(u / 0.5, vW.y / 0.22); bc.x += step(1.0, mod(floor(bc.y), 2.0)) * 0.5;
            vec2 bf = fract(bc); float mortar = step(0.07, bf.x) * step(0.12, bf.y);
            vec3 brick = alb * (0.82 + 0.3 * h21(floor(bc)));
            alb = mix(alb, mix(vec3(0.58,0.55,0.5), brick, mortar), 1.0 - far);
          } else if (vWin > 3.5) {                  // dressed stone
            vec2 sc = vec2(u / 1.4, vW.y / 0.7); sc.x += step(1.0, mod(floor(sc.y), 2.0)) * 0.5;
            vec2 sf = fract(sc); float j = step(0.02, sf.x) * step(0.04, sf.y);
            alb = mix(alb, alb * (0.88 + 0.18 * h21(floor(sc))) * mix(0.75, 1.0, j), 1.0 - far);
          } else if (vWin > 0.5 && vWin < 1.5) {    // concrete panels
            vec2 pc = fract(vec2(u / 6.0, vW.y / 3.6));
            alb *= mix(0.86, 1.0, step(0.012, pc.x) * step(0.02, pc.y) + far) * (0.94 + 0.1 * vnoise(vec2(u, vW.y) * 0.7));
          }
          alb *= 1.0 - 0.3 * uRain;
          vec3 col = alb * light * ao * edgeAO;
          if (vWin > 0.5 && vWin < 4.5) {          // windows (type 5 = plain dressed stone, no windows)
            bool glass = vWin > 1.5 && vWin < 2.5;
            vec2 gs = glass ? vec2(2.4, 3.6) : vec2(vWin > 2.5 ? 3.2 : 4.0, 3.6);
            vec2 g = vec2(u/gs.x, vW.y/gs.y); vec2 f = fract(g); vec2 id = floor(g);
            float fwg = max(fwidth(g.x), fwidth(g.y));
            float detail = 1.0 - smoothstep(0.18, 0.5, fwg);
            float fine = 1.0 - smoothstep(0.04, 0.12, fwg);
            vec2 wlo = glass ? vec2(0.04, 0.06) : vec2(0.2, 0.28), whi = glass ? vec2(0.96, 0.97) : vec2(0.8, 0.86);
            float win = step(wlo.x,f.x)*step(f.x,whi.x)*step(wlo.y,f.y)*step(f.y,whi.y);
            float rnd = h21(id + vec2(bh*61.0, step(0.5, abs(vLN.z))*13.0 + bh*7.0));
            float lit = step((glass ? 0.74 : 0.62) + uLitBias, rnd);
            vec3 litC = mix(vec3(1.0,0.74,0.42), vec3(0.78,0.88,1.0), step(0.85, h21(id.yx+3.1+bh))) * (0.75+0.45*h21(id+1.7));
            litC *= 0.92 + 0.08*sin(uTime*(2.0+rnd*6.0) + rnd*40.0) * step(0.97, h21(id+5.5));
            vec2 wf = clamp((f - wlo) / (whi - wlo), 0.0, 1.0);
            vec3 inside = room(wf, id, rd, gs * (whi - wlo), normalize(vT), n, lit, litC, bh);
            vec3 r = reflect(rd, n);
            float fr = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
            vec3 refl = skyCol(vec3(r.x, abs(r.y) * 0.8 + 0.02, r.z));
            refl += uKeyCol * pow(max(dot(r, uKeyDir), 0.0), 60.0) * 1.2 * shd;
            float rk = glass ? mix(0.25, 0.9, fr) : mix(0.08, 0.7, fr);
            vec3 pane = mix(inside, refl * 0.85, rk);
            float blinds = step(0.6, h21(id + 9.3)) * step(0.5, fract(wf.y * 9.0)) * (lit > 0.5 ? 0.25 : 0.5) * fine;
            pane *= 1.0 - blinds;
            float frame = 1.0 - fine * (glass ? 0.7 * (1.0 - step(0.025, abs(f.x - 0.5))) : 0.75 * (1.0 - step(0.03, abs(wf.x - 0.5))) * step(0.35, wf.y));
            pane *= frame;
            // window reveal shadow (depth of the opening)
            float reveal = glass ? 1.0 : mix(0.55, 1.0, smoothstep(0.0, 0.08, wf.y)) * mix(0.7, 1.0, smoothstep(0.0, 0.06, min(wf.x, 1.0 - wf.x)));
            pane *= reveal;
            if (vW.y < 4.6 && !glass) {
              float sf = fract(u/7.0);
              win = step(0.06, sf)*step(sf, 0.94)*step(0.5, vW.y)*step(vW.y, 3.7);
              vec3 shop = mix(vec3(1.0,0.84,0.58), vec3(0.6,0.95,1.0), step(0.7, h21(vec2(floor(u/7.0), 2.0+bh))))*0.85*mix(0.6,1.0,vW.y/3.7);
              pane = mix(shop, refl, fr * 0.6);
            }
            float wAmt = win * step(0.4, vW.y);
            if (glass) { col = mix(alb * light * 0.6, pane, 0.92); col = mix(col, pane, wAmt); }
            else {
              col = mix(col, pane, wAmt);
              col *= 1.0 - step(fract(vW.y / 14.4), 0.03) * 0.3;                       // floor cornices
              float sill = step(abs(f.y - wlo.y + 0.03), 0.025) * step(wlo.x - 0.03, f.x) * step(f.x, whi.x + 0.03);
              col = mix(col, alb * 1.25 * light, sill);
            }
            vec3 avgC = mix(refl * 0.6, litC, glass ? 0.22 : 0.33) * 0.55 + alb * light * 0.3;
            float lumWin = glass ? 0.0 : 0.0;
            col = mix(col, avgC, max(1.0 - detail, smoothstep(900.0, 1700.0, vD)) * step(0.6, vW.y));
          }
          col = fogMix(col, vW, vD, fogNear, fogFar);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    fogMats.push(m);
    return m;
  }

  function groundMaterial(lotTex) {
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({ lotMap: { value: lotTex }, fogNear: { value: 400 }, fogFar: { value: 2200 } }, U),
      vertexShader: VS_WORLD,
      fragmentShader: GLSL_LIB + `uniform sampler2D lotMap; uniform float fogNear, fogFar; varying vec3 vW; varying float vD;
        void main(){
          vec2 w=vW.xz; vec2 l=mod(w+1440.0, 80.0); vec2 e=min(l, 80.0-l);
          vec2 uv=(w+1440.0)/2880.0;
          vec3 lot=texture2D(lotMap, vec2(uv.x, 1.0-uv.y)).rgb;
          float n=vnoise(w*0.6)*0.5+vnoise(w*2.3)*0.3;
          bool rX=e.x<5.0, rZ=e.y<5.0;
          vec3 col; float wet = 0.0;
          if(rX||rZ){
            col=vec3(0.11,0.115,0.13)*(0.8+n*0.4); wet = 1.0;
            if(rX&&!rZ&&e.y>8.0&&e.x<0.14&&fract(w.y/9.0)<0.55) col=vec3(0.85,0.64,0.2);
            if(rZ&&!rX&&e.x>8.0&&e.y<0.14&&fract(w.x/9.0)<0.55) col=vec3(0.85,0.64,0.2);
            if(rX&&!rZ&&abs(e.x-4.5)<0.1&&e.y>8.0) col=vec3(0.55);
            if(rZ&&!rX&&abs(e.y-4.5)<0.1&&e.x>8.0) col=vec3(0.55);
            if(rX&&!rZ&&e.y<7.8&&e.x<4.3&&fract(w.x/1.4)<0.5) col=vec3(0.72);
            if(rZ&&!rX&&e.x<7.8&&e.y<4.3&&fract(w.y/1.4)<0.5) col=vec3(0.72);
          } else if(e.x<8.0||e.y<8.0){
            col=vec3(0.36,0.36,0.39)*(0.88+n*0.2); wet = 0.35;
            vec2 t=fract(w/2.0); if(t.x<0.05||t.y<0.05) col*=0.8;
            if(min(e.x,e.y)<5.35) col=vec3(0.52);
          } else col=lot*(0.85+n*0.3);
          float shd = sunShadow(vW, vec3(0.0,1.0,0.0));
          col *= mix(uAmbGnd, uAmbSky, 0.7) * 1.25 + uKeyCol * 0.2 * shd;
          vec2 a=l-vec2(6.5); vec2 b=l-vec2(6.5,40.0); vec2 c=l-vec2(40.0,6.5);
          float g=exp(-dot(a,a)/30.0)+exp(-dot(b,b)/30.0)+exp(-dot(c,c)/30.0);
          col+=vec3(1.0,0.72,0.42)*g*0.5*uLamps;
          if (uWet > 0.5 && wet > 0.0) {
            wet *= uWetAmt;
            // wet asphalt: rippled sky reflection, sun glint and stretched lamp highlights
            float puddle = smoothstep(0.45, 0.7, vnoise(w*0.08)) * 0.6 + 0.4;
            vec3 nn = normalize(vec3((vnoise(w*3.0)-0.5)*0.08, 1.0, (vnoise(w*3.0+7.0)-0.5)*0.08));
            vec3 v = normalize(cameraPosition - vW); vec3 r = reflect(-v, nn);
            float fr = 0.03 + 0.97*pow(1.0 - max(dot(nn, v), 0.0), 5.0);
            vec3 refl = skyCol(vec3(r.x, abs(r.y), r.z)) * 0.55 + vec3(1.0,0.72,0.42)*g*0.4*uLamps;
            vec4 pr = planarRefl(vW, nn.xz * 0.35);
            refl = mix(refl, pr.rgb * (0.5 + 0.4 * uRain) + vec3(1.0,0.72,0.42)*g*0.3*uLamps, pr.a);
            col = mix(col, refl, fr * wet * puddle * (0.6 + 0.35 * uRain));
            col += uKeyCol*pow(max(dot(r, uKeyDir),0.0), 120.0)*1.2*wet*puddle*shd;
            col += vec3(0.02) * uRain * step(0.97, h21(floor(w * 2.0) + floor(uTime * 8.0))) * wet;
          }
          col=fogMix(col, vW, vD, fogNear, fogFar);
          gl_FragColor=vec4(col,1.0);
        }`,
    });
    fogMats.push(m); return m;
  }

  function seaMaterial() {
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({ fogNear: { value: 400 }, fogFar: { value: 2200 } }, U),
      vertexShader: VS_WORLD,
      fragmentShader: GLSL_LIB + `uniform float fogNear, fogFar; varying vec3 vW; varying float vD;
        void main(){
          vec2 p=vW.xz; float t=uTime;
          vec2 g=vec2(cos(p.x*0.06+t*0.9)*0.06+cos((p.x+p.y)*0.15+t*1.4)*0.05+(vnoise(p*0.35+t*0.3)-0.5)*0.16+(vnoise(p*1.7-t*0.8)-0.5)*0.05,
                      cos(p.y*0.08-t*0.7)*0.06+cos((p.x-p.y)*0.13+t*1.2)*0.05+(vnoise(p*0.35-t*0.25+5.0)-0.5)*0.16+(vnoise(p*1.7+t*0.7+3.0)-0.5)*0.05);
          vec3 n=normalize(vec3(g.x,1.0,g.y));
          vec3 v=normalize(cameraPosition-vW);
          float fr=0.04+0.96*pow(1.0-max(dot(n,v),0.0),5.0);
          vec3 r=reflect(-v,n); r.y=abs(r.y);
          vec3 deep = mix(vec3(0.02,0.05,0.09), vec3(0.04,0.12,0.16), smoothstep(-0.2, 0.3, g.x+g.y));
          vec3 rc = skyCol(r)*0.9;
          vec4 pr = planarRefl(vW, n.xz * 0.07);
          rc = mix(rc, pr.rgb * 0.92, pr.a);
          vec3 col=mix(deep, rc, clamp(fr*1.2+0.12,0.0,1.0));
          col+=uKeyCol*pow(max(dot(r,uKeyDir),0.0),300.0)*1.4;
          float foam = smoothstep(0.62, 0.8, vnoise(p*0.9 + t*0.4)) * 0.06; col += foam;
          col=fogMix(col, vW, vD, fogNear, fogFar);
          gl_FragColor=vec4(col,1.0);
        }`,
    });
    fogMats.push(m); return m;
  }

  // ---------- soft particles (two layers: additive glow and alpha smoke) ----------
  function makeParticles(max, additive) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcol', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('psize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('palpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } }, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec3 pcol; attribute float psize; attribute float palpha; uniform float uScale; varying vec3 vC; varying float vA;
        void main(){ vC = pcol; vA = palpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(256.0, psize * uScale / max(-mv.z, 0.2)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: additive
        ? `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 1.6) * vA; gl_FragColor = vec4(vC * a, a); }`
        : `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, r) * vA * 0.55; gl_FragColor = vec4(vC, a); }`,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = additive ? 3 : 2;
    scene.add(pts);
    let n = 0;
    return {
      begin() { n = 0; },
      push(p, c, s, a) { if (n >= max) return; pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z; col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b; size[n] = s; alpha[n] = a; n++; },
      end() { geo.setDrawRange(0, n); for (const k of ['position', 'pcol', 'psize', 'palpha']) geo.attributes[k].needsUpdate = true; mat.uniforms.uScale.value = (renderer.domElement.height / renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360)); },
    };
  }
  const particles = { glow: makeParticles(1600, true), smoke: makeParticles(900, false) };

  // ---------- post-processing ----------
  const post = { on: false, boost: 0, rays: false, flare: false, strength: 0.55 };
  {
    const type = gl2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const RT = (o) => new THREE.WebGLRenderTarget(4, 4, Object.assign({ type, depthBuffer: false }, o || {}));
    post.rt = RT({ depthBuffer: true, samples: gl2 ? 4 : 0 });
    if (gl2) { post.rt.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType); post.rt.depthTexture.format = THREE.DepthFormat; }
    // ambient occlusion targets (half or full resolution)
    post.ao = [RT(), RT()]; post.aoOn = false; post.aoFull = false;
    // planar reflection target (sea + wet streets)
    post.refl = new THREE.WebGLRenderTarget(4, 4, { type, depthBuffer: true }); post.reflOn = false;
    post.levels = [0, 1, 2, 3].map(() => [RT(), RT()]);
    post.rays = RT();
    post.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    post.scene = new THREE.Scene();
    post.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); post.quad.frustumCulled = false; post.scene.add(post.quad);
    const vs = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }';
    const mk = (u, fs) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: vs, fragmentShader: fs, depthTest: false, depthWrite: false });
    post.bright = mk({ tex: { value: null }, th: { value: 0.95 } }, 'uniform sampler2D tex; uniform float th; varying vec2 vUv; void main(){ vec3 c=min(texture2D(tex,vUv).rgb, vec3(3.0)); float l=max(c.r,max(c.g,c.b)); float k=smoothstep(th, th+0.7, l); gl_FragColor=vec4(c*k,1.0); }');
    post.blur = mk({ tex: { value: null }, dir: { value: new THREE.Vector2() } }, `uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
      void main(){ vec3 c=texture2D(tex,vUv).rgb*0.227;
        c+=texture2D(tex,vUv+dir*1.385).rgb*0.316; c+=texture2D(tex,vUv-dir*1.385).rgb*0.316;
        c+=texture2D(tex,vUv+dir*3.231).rgb*0.07; c+=texture2D(tex,vUv-dir*3.231).rgb*0.07;
        gl_FragColor=vec4(c,1.0); }`);
    // sun rays: radial blur of the bright sky toward the sun's screen position
    post.raysMat = mk({ tex: { value: null }, sun: { value: new THREE.Vector2(0.5, 0.5) }, amt: { value: 0 } }, `uniform sampler2D tex; uniform vec2 sun; uniform float amt; varying vec2 vUv;
      void main(){ vec2 d = (vUv - sun) * (1.0/48.0) * 0.9; vec2 uv = vUv; float w = 1.0; vec3 acc = vec3(0.0);
        for (int i = 0; i < 48; i++) { uv -= d; vec3 s = texture2D(tex, uv).rgb; acc += s * w; w *= 0.955; }
        gl_FragColor = vec4(acc * (amt / 16.0), 1.0); }`);
    // SSAO: view-space positions from the depth buffer, normals from the nearer neighbours (no halos at edges),
    // 16 samples in a golden-angle hemisphere, range-checked, fading out with distance.
    post.ssao = mk({ tDepth: { value: null }, proj: { value: new THREE.Matrix4() }, invProj: { value: new THREE.Matrix4() }, res: { value: new THREE.Vector2(1, 1) }, intensity: { value: 1.1 } },
      `uniform sampler2D tDepth; uniform mat4 proj, invProj; uniform vec2 res; uniform float intensity; varying vec2 vUv;
      vec3 vpos(vec2 uv){ float z = texture2D(tDepth, uv).r; vec4 p = invProj * vec4(vec3(uv, z) * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
      float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void main(){
        float d0 = texture2D(tDepth, vUv).r; if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
        vec3 P = vpos(vUv); vec2 px = 1.0 / res;
        vec3 Pr = vpos(vUv + vec2(px.x, 0.0)), Pl = vpos(vUv - vec2(px.x, 0.0)), Pu = vpos(vUv + vec2(0.0, px.y)), Pd = vpos(vUv - vec2(0.0, px.y));
        vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
        vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
        vec3 N = normalize(cross(dx, dy));
        vec3 T = normalize(abs(N.y) < 0.99 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0))), B = cross(N, T);
        float dist = -P.z, radius = mix(0.9, 5.5, smoothstep(6.0, 160.0, dist));
        float rot = ign(gl_FragCoord.xy) * 6.2832, occ = 0.0;
        for (int i = 0; i < 16; i++) {
          float fi = float(i), r = (fi + 0.5) / 16.0, a = rot + fi * 2.39996;
          vec3 h = vec3(cos(a) * r, sin(a) * r, sqrt(max(1.0 - r * r, 0.0)));
          vec3 S = P + (T * h.x + B * h.y + N * h.z) * radius * mix(0.15, 1.0, r * r);
          vec4 sp = proj * vec4(S, 1.0); vec2 suv = sp.xy / sp.w * 0.5 + 0.5;
          if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
          float sz = vpos(suv).z;
          float range = smoothstep(0.0, 1.0, radius / max(abs(P.z - sz), 0.001));
          occ += step(S.z + 0.04 * radius, sz) * range;
        }
        float ao = clamp(1.0 - occ / 16.0 * intensity, 0.0, 1.0);
        ao = mix(ao, 1.0, smoothstep(220.0, 420.0, dist));
        gl_FragColor = vec4(vec3(ao), 1.0);
      }`);
    post.aoBlur = mk({ tAO: { value: null }, tDepth: { value: null }, dir: { value: new THREE.Vector2() }, invProj: { value: new THREE.Matrix4() } },
      `uniform sampler2D tAO, tDepth; uniform vec2 dir; uniform mat4 invProj; varying vec2 vUv;
      float vz(vec2 uv){ float z = texture2D(tDepth, uv).r; vec4 p = invProj * vec4(vec3(uv, z) * 2.0 - 1.0, 1.0); return p.z / p.w; }
      void main(){
        float z0 = vz(vUv), sum = 0.0, wsum = 0.0;
        for (int i = -3; i <= 3; i++) {
          vec2 uv = vUv + dir * float(i) * 1.5; float z = vz(uv);
          float w = exp(-float(i * i) * 0.18) * exp(-abs(z - z0) / max(0.15, abs(z0) * 0.012));
          sum += texture2D(tAO, uv).r * w; wsum += w;
        }
        gl_FragColor = vec4(vec3(sum / max(wsum, 1e-4)), 1.0);
      }`);
    post.comp = mk({ tScene: { value: null }, b0: { value: null }, b1: { value: null }, b2: { value: null }, b3: { value: null }, tRays: { value: null }, strength: { value: 0.55 }, boost: { value: 0 }, seed: { value: 0 },
      sunUv: { value: new THREE.Vector2(0.5, 0.5) }, flare: { value: 0 }, rays: { value: 0 }, aspect: { value: 1 }, exposure: { value: 1.25 }, tAO: { value: null }, aoAmt: { value: 0 } },
      `uniform sampler2D tScene,b0,b1,b2,b3,tRays,tAO; uniform float strength, boost, seed, flare, rays, aspect, exposure, aoAmt; uniform vec2 sunUv; varying vec2 vUv;
      float ring(vec2 p, vec2 c, float r, float w){ float d = length((p - c) * vec2(aspect, 1.0)); return smoothstep(w, 0.0, abs(d - r)); }
      float disc(vec2 p, vec2 c, float r){ float d = length((p - c) * vec2(aspect, 1.0)); return smoothstep(r, r * 0.4, d); }
      void main(){
        vec2 uv=vUv; vec2 d=uv-0.5; float r=length(d);
        vec3 c;
        if(boost>0.02){
          float ca=boost*0.006*r;
          c=vec3(texture2D(tScene,uv-d*ca).r, texture2D(tScene,uv).g, texture2D(tScene,uv+d*ca).b);
          vec3 acc=c; for(int i=1;i<6;i++){ acc+=texture2D(tScene, uv-d*float(i)*0.014*boost).rgb; }
          c=mix(c, acc/6.0, smoothstep(0.12,0.55,r)*boost);
        } else c=texture2D(tScene,uv).rgb;
        if (aoAmt > 0.0) c *= mix(1.0, texture2D(tAO, uv).r, aoAmt);
        vec3 bl=texture2D(b0,uv).rgb*0.55+texture2D(b1,uv).rgb*0.75+texture2D(b2,uv).rgb*0.95+texture2D(b3,uv).rgb*1.15;
        c+=bl*strength;
        if (rays > 0.0) c += texture2D(tRays, uv).rgb * vec3(1.0, 0.78, 0.55) * rays;
        if (flare > 0.0) {
          vec2 axis = vec2(0.5) - sunUv; vec3 fl = vec3(0.0);
          fl += vec3(1.0,0.6,0.3) * disc(uv, sunUv + axis*0.55, 0.035) * 0.25;
          fl += vec3(0.4,0.8,1.0) * disc(uv, sunUv + axis*1.15, 0.06) * 0.14;
          fl += vec3(0.6,1.0,0.6) * disc(uv, sunUv + axis*1.5, 0.02) * 0.3;
          fl += vec3(1.0,0.5,0.8) * ring(uv, sunUv + axis*1.85, 0.11, 0.012) * 0.18;
          fl += vec3(1.0,0.8,0.6) * ring(uv, sunUv, 0.16, 0.02) * 0.08;
          float streak = smoothstep(0.012, 0.0, abs(uv.y - sunUv.y)) * smoothstep(0.6, 0.0, abs(uv.x - sunUv.x)); fl += vec3(1.0,0.75,0.5) * streak * 0.25;
          c += fl * flare;
        }
        // filmic (ACES fit) in linear space, then back to display
        vec3 lin = pow(max(c, 0.0), vec3(2.2)) * exposure;
        lin = clamp((lin*(2.51*lin+0.03))/(lin*(2.43*lin+0.59)+0.14), 0.0, 1.0);
        c = pow(lin, vec3(1.0/2.2));
        float l=dot(c,vec3(0.299,0.587,0.114)); c=mix(vec3(l),c,1.06);
        c += vec3(0.008, 0.004, 0.012) * (1.0 - l);
        c*=1.0-dot(d,d)*(0.55+boost*0.5);
        c+=(fract(sin(dot(uv*vec2(1.0+seed,1.3),vec2(12.9898,78.233)))*43758.5453)-0.5)*0.022;
        gl_FragColor=vec4(max(c,0.0),1.0); }`);
  }
  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    const pr = renderer.getPixelRatio(), w = Math.max(4, Math.floor(window.innerWidth * pr)), h = Math.max(4, Math.floor(window.innerHeight * pr));
    post.rt.setSize(w, h);
    post.levels.forEach((L, i) => { const k = 2 << i; L[0].setSize(Math.max(2, (w / k) | 0), Math.max(2, (h / k) | 0)); L[1].setSize(Math.max(2, (w / k) | 0), Math.max(2, (h / k) | 0)); });
    post.raysRT && post.raysRT.setSize(Math.max(2, (w / 4) | 0), Math.max(2, (h / 4) | 0));
    const ak = post.aoFull ? 1 : 2; post.ao.forEach((r) => r.setSize(Math.max(2, (w / ak) | 0), Math.max(2, (h / ak) | 0)));
    post.ssao.uniforms.res.value.set(Math.max(2, (w / ak) | 0), Math.max(2, (h / ak) | 0));
    post.refl.setSize(Math.max(2, (w / 2) | 0), Math.max(2, (h / 2) | 0));
    post.comp.uniforms.aspect.value = w / h;
  }
  post.raysRT = post.rays; post.rays = false;
  window.addEventListener('resize', resize);
  function pass(mat, target) { post.quad.material = mat; renderer.setRenderTarget(target); renderer.render(post.scene, post.cam); }

  // ---------- far shadow cascade: the whole city from the key light, re-rendered when the sun or moon moves ----------
  const FAR_LAYER = 2;
  const far = { rt: null, size: 0, cam: new THREE.OrthographicCamera(-2500, 2500, 2500, -2500, 1, 7000), mat: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    last: new V3(), center: new V3(0, 0, 560), dirty: true, on: false };
  far.cam.layers.set(FAR_LAYER);
  const farCaster = (o) => { o.traverse((c) => c.layers.enable(FAR_LAYER)); far.dirty = true; return o; };
  const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const _cc = new THREE.Color();
  function renderFar() {
    if (!far.on) return;
    const k = U.uKeyDir.value;
    if (!far.dirty && far.last.dot(k) > 0.99997) return;
    far.last.copy(k); far.dirty = false;
    far.cam.position.copy(far.center).addScaledVector(k, 3500); far.cam.up.set(0, 1, 0); if (Math.abs(k.y) > 0.98) far.cam.up.set(0, 0, 1);
    far.cam.lookAt(far.center); far.cam.updateMatrixWorld(); far.cam.updateProjectionMatrix();
    const bg = scene.background, fog = scene.fog, au = renderer.shadowMap.autoUpdate, ca = renderer.getClearAlpha(); renderer.getClearColor(_cc);
    scene.background = null; scene.fog = null; scene.overrideMaterial = far.mat; renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0xffffff, 1); renderer.setRenderTarget(far.rt); renderer.clear(); renderer.render(scene, far.cam);
    scene.background = bg; scene.fog = fog; scene.overrideMaterial = null; renderer.shadowMap.autoUpdate = au; renderer.setClearColor(_cc, ca);
    U.uFarMatrix.value.copy(BIAS).multiply(far.cam.projectionMatrix).multiply(far.cam.matrixWorldInverse);
    U.uFarMap.value = far.rt.texture;
  }
  // ---------- planar reflections: a mirrored camera with an oblique near plane on y = 0 ----------
  const reflCam = new THREE.PerspectiveCamera();
  const reflectHide = scene.children.filter((o) => o.material === rainMat);
  const _rp = new THREE.Plane(), _cp = new THREE.Vector4(), _q4 = new THREE.Vector4(), _rv = new V3(), _ru = new V3(), _rt = new V3();
  function renderReflection() {
    if (!post.reflOn || envState.indoors || camera.position.y < 0.5) { U.uReflOn.value = 0; return; }
    reflCam.copy(camera, false); reflCam.near = 0.5;
    reflCam.position.set(camera.position.x, -camera.position.y, camera.position.z);
    camera.getWorldDirection(_rv); _rv.y = -_rv.y;
    _ru.set(0, 1, 0).applyQuaternion(camera.quaternion); _ru.y = -_ru.y;
    reflCam.up.copy(_ru); reflCam.lookAt(_rt.copy(reflCam.position).add(_rv));
    reflCam.updateMatrixWorld(); reflCam.projectionMatrix.copy(camera.projectionMatrix);
    // oblique clip: nothing below the water line is drawn into the reflection
    _rp.setFromNormalAndCoplanarPoint(_rt.set(0, 1, 0), _rv.set(0, 0, 0)); _rp.applyMatrix4(reflCam.matrixWorldInverse);
    _cp.set(_rp.normal.x, _rp.normal.y, _rp.normal.z, _rp.constant);
    const e = reflCam.projectionMatrix.elements;
    _q4.set((Math.sign(_cp.x) + e[8]) / e[0], (Math.sign(_cp.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    _cp.multiplyScalar(2 / _cp.dot(_q4));
    e[2] = _cp.x; e[6] = _cp.y; e[10] = _cp.z + 1; e[14] = _cp.w;
    reflCam.projectionMatrixInverse.copy(reflCam.projectionMatrix).invert();
    U.uReflMat.value.copy(BIAS).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
    const vis = reflectHide.map((o) => o.visible); reflectHide.forEach((o) => (o.visible = false));
    const skyP = sky.position.clone(); sky.position.copy(reflCam.position);
    const au = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    U.uReflOn.value = 0;
    renderer.setRenderTarget(post.refl); renderer.render(scene, reflCam);
    renderer.shadowMap.autoUpdate = au; sky.position.copy(skyP); reflectHide.forEach((o, i) => (o.visible = vis[i]));
    U.uRefl.value = post.refl.texture; U.uReflOn.value = 1;
  }

  // ---------- quality tiers ----------
  // 0 Low · 1 High (glow, shadows) · 2 Ultra (+ soft shadows, far shadows, ambient occlusion, sun rays, lens flare)
  // 3 Max (+ city reflections in water and wet streets, full-res ambient occlusion, 4096 far shadows)
  let quality = 1;
  function setQuality(q, opts) {
    quality = q;
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(dpr, q >= 2 ? 2 : q === 1 ? (IS_TOUCH ? 1.25 : 1.5) : 0.8));
    post.on = q >= 1;
    post.rays = q >= 2; post.flare = q >= 2;
    post.rt.samples = gl2 ? (q >= 2 ? Math.min(8, MAX_SAMPLES || 4) : 4) : 0;
    const shadows = q >= 1;
    renderer.shadowMap.enabled = shadows; sun.castShadow = shadows; U.uShadowOn.value = shadows ? 1 : 0;
    const ms = q >= 2 ? (IS_TOUCH ? 2048 : 4096) : 2048;
    if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    U.uShadowTexel.value.set(1 / ms, 1 / ms); U.uShadowTexelW.value = (2 * SH) / ms;
    U.uSoft.value = q >= 2 ? 1 : 0;
    // far cascade
    far.on = q >= 2 && gl2;
    const fs = q >= 3 ? 4096 : 2048;
    if (far.on && (!far.rt || far.size !== fs)) { if (far.rt) far.rt.dispose(); far.rt = new THREE.WebGLRenderTarget(fs, fs, { depthBuffer: true }); far.size = fs; far.dirty = true; }
    U.uFarOn.value = far.on ? 1 : 0; U.uFarTexel.value = 1 / fs; U.uFarRange.value = far.cam.far - far.cam.near;
    // ambient occlusion + reflections
    post.aoOn = q >= 2 && gl2; post.aoFull = q >= 3;
    post.reflOn = q >= 3; if (!post.reflOn) U.uReflOn.value = 0;
    U.uWet.value = q >= 1 ? 1 : 0;
    scene.traverse((o) => { if (o.material) { const ms2 = Array.isArray(o.material) ? o.material : [o.material]; ms2.forEach((m) => (m.needsUpdate = true)); } });
    if (opts && opts.view) { scene.fog.far = opts.view; scene.fog.near = opts.view * 0.2; }
    fogMats.forEach((m) => { m.uniforms.fogFar.value = scene.fog.far; m.uniforms.fogNear.value = scene.fog.near * 1.4; });
    resize();
  }

  // ---------- per-frame ----------
  const _sp = new V3(), _focus = new V3();
  function update(dt, now, focus) {
    U.uTime.value = now / 1000;
    sky.position.copy(camera.position);
    rainMat.uniforms.uCam.value.copy(camera.position);
    if (sun.castShadow && focus) {
      // keep the shadow camera centred on the player, snapped to texels to avoid shimmering
      const texel = (2 * SH) / sun.shadow.mapSize.x;
      _focus.set(Math.round(focus.x / texel) * texel, Math.round(focus.y / texel) * texel, Math.round(focus.z / texel) * texel);
      sun.target.position.copy(_focus); sun.position.copy(_focus).addScaledVector(U.uKeyDir.value, 900);
      sun.target.updateMatrixWorld();
    }
  }
  const _ip = new THREE.Matrix4();
  function render() {
    if (sun.castShadow) U.uShadowMap.value = sun.shadow.map ? sun.shadow.map.texture : null;
    if (!post.on) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    renderFar();
    renderReflection();
    renderer.setRenderTarget(post.rt); renderer.render(scene, camera);
    if (post.aoOn && post.rt.depthTexture) {
      _ip.copy(camera.projectionMatrix).invert();
      const su = post.ssao.uniforms; su.tDepth.value = post.rt.depthTexture; su.proj.value.copy(camera.projectionMatrix); su.invProj.value.copy(_ip);
      pass(post.ssao, post.ao[0]);
      const bu = post.aoBlur.uniforms; bu.tDepth.value = post.rt.depthTexture; bu.invProj.value.copy(_ip);
      bu.tAO.value = post.ao[0].texture; bu.dir.value.set(1 / post.ao[0].width, 0); pass(post.aoBlur, post.ao[1]);
      bu.tAO.value = post.ao[1].texture; bu.dir.value.set(0, 1 / post.ao[1].height); pass(post.aoBlur, post.ao[0]);
      post.comp.uniforms.tAO.value = post.ao[0].texture; post.comp.uniforms.aoAmt.value = envState.indoors ? 0.6 : 0.85;
    } else post.comp.uniforms.aoAmt.value = 0;
    if (sun.castShadow) U.uShadowMap.value = sun.shadow.map ? sun.shadow.map.texture : null;
    post.bright.uniforms.tex.value = post.rt.texture; pass(post.bright, post.levels[0][0]);
    for (let i = 0; i < 4; i++) {
      const L = post.levels[i], src = i === 0 ? L[0] : post.levels[i - 1][0];
      post.blur.uniforms.tex.value = src.texture; post.blur.uniforms.dir.value.set(1 / src.width, 0); pass(post.blur, L[1]);
      post.blur.uniforms.tex.value = L[1].texture; post.blur.uniforms.dir.value.set(0, 1 / L[1].height); pass(post.blur, L[0]);
    }
    const u = post.comp.uniforms;
    // sun on screen?
    _sp.copy(camera.position).addScaledVector(SUN_DIR, 2000).project(camera);
    const facing = camera.getWorldDirection(new V3()).dot(SUN_DIR);
    const sx = _sp.x * 0.5 + 0.5, sy = _sp.y * 0.5 + 0.5;
    const sunVis = THREE.MathUtils.smoothstep(SUN_DIR.y, -0.04, 0.04) * (1 - envState.rain * 0.9);
    const onScr = sunVis * (facing > 0 ? Math.max(0, 1 - Math.max(0, Math.abs(sx - 0.5) - 0.5) * 4 - Math.max(0, Math.abs(sy - 0.5) - 0.5) * 4) : 0);
    u.sunUv.value.set(sx, sy);
    if (post.rays && onScr > 0) {
      post.raysMat.uniforms.tex.value = post.levels[1][0].texture; post.raysMat.uniforms.sun.value.set(sx, sy); post.raysMat.uniforms.amt.value = 1.0;
      pass(post.raysMat, post.raysRT); u.tRays.value = post.raysRT.texture; u.rays.value = 0.55 * onScr;
    } else u.rays.value = 0;
    u.flare.value = post.flare && facing > 0 && sx > 0 && sx < 1 && sy > 0 && sy < 1 ? onScr : 0;
    u.tScene.value = post.rt.texture; u.b0.value = post.levels[0][0].texture; u.b1.value = post.levels[1][0].texture; u.b2.value = post.levels[2][0].texture; u.b3.value = post.levels[3][0].texture;
    u.boost.value = post.boost; u.seed.value = Math.random(); u.strength.value = post.strength; u.exposure.value = post.exposure || 1.25;
    pass(post.comp, null);
  }

  return {
    setEnvironment, envState, renderer, scene, camera, sun, hemi, SUN_DIR, U, fogMats, GLSL_LIB, VS_WORLD, skyMat, sky, ENV, post, particles,
    farCaster, reflectHide, markFarDirty: () => (far.dirty = true), far,
    glowM, metal, facadeMaterial, groundMaterial, seaMaterial, setQuality, update, render, resize, IS_TOUCH, MAX_ANISO,
    get quality() { return quality; },
  };
})();
