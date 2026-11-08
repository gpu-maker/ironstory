// AEGIS: Port Halcyon — HUD, menus, workbench, map, touch controls
(function () {
  'use strict';
  const D = window.GDATA, G = window.G, PART = G.PART;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isTouch = ('ontouchstart' in window) && window.matchMedia('(pointer: coarse)').matches;
  const UI = (G.UI = {});
  if (isTouch) document.body.classList.add('touch');
  const screen = $('screen');
  let modal = null; // 'pause' | 'bench' | 'map' | 'menu' ...

  // ---------- helpers ----------
  const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const fmtPlay = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + 'h ' : '') + m + 'm'; };
  function show(html, cls = '') { screen.className = 'screen ' + cls; screen.innerHTML = html; screen.style.display = 'flex'; }
  function hideScreen() { screen.style.display = 'none'; screen.innerHTML = ''; modal = null; G.paused = false; }
  UI.modalOpen = () => !!modal;
  function ask(text, yes) {
    const d = document.createElement('div'); d.className = 'ask';
    d.innerHTML = '<div class="menu-card"><p>' + esc(text) + '</p><div class="btns row"><button class="primary" data-a="y">Yes</button><button data-a="n">Cancel</button></div></div>';
    document.body.appendChild(d);
    d.addEventListener('click', (e) => { const a = e.target.dataset && e.target.dataset.a; if (!a) return; d.remove(); if (a === 'y') yes(); });
  }
  UI.ask = ask;
  function on(sel, ev, fn) { screen.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn)); }

  // ---------- pointer lock ----------
  let wantLock = false;
  function lock() { if (isTouch || !G.running) return; wantLock = true; const p = G.canvas.requestPointerLock && G.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); }
  const locked = () => document.pointerLockElement === G.canvas;
  document.addEventListener('pointerlockchange', () => {
    if (!locked()) { G.input.fire = [false, false]; if (G.running && !modal && !G.player.dead) openPause(); }
  });
  G.canvas.addEventListener('click', () => { G.audioInit(); if (G.running && !modal) lock(); });
  document.addEventListener('mousemove', (e) => { if (locked() && !modal) G.look(e.movementX || 0, e.movementY || 0); });
  document.addEventListener('mousedown', (e) => { if (locked() && !modal) { if (e.button === 0) G.input.fire[0] = true; if (e.button === 2) G.input.fire[1] = true; } });
  document.addEventListener('mouseup', (e) => { if (e.button === 0) G.input.fire[0] = false; if (e.button === 2) G.input.fire[1] = false; });
  document.addEventListener('contextmenu', (e) => { if (G.running) e.preventDefault(); });
  window.addEventListener('keydown', (e) => {
    if (!G.running) return;
    if (e.code === 'Escape') { if (modal === 'bench' || modal === 'map' || modal === 'sub' || modal === 'juno') { closeModal(false); } else if (modal === 'pause') { resume(); } else if (isTouch) openPause(); }
    else if (e.code === 'KeyM') { if (modal === 'map') closeModal(true); else if (!modal) openMap(); }
    else if (e.code === 'KeyE' && modal === 'bench') { if (document.activeElement && document.activeElement.tagName === 'INPUT') return; closeModal(true); }
    else if (e.code === 'KeyP' && !modal) { openPause(); }
    else if (e.code === 'KeyJ') { if (document.activeElement && document.activeElement.tagName === 'INPUT') return; if (modal === 'juno') closeModal(true); else if (!modal) UI.openJuno(); }
    else if (e.code === 'KeyX' && !modal) { G.settings.visorFx = ((G.settings.visorFx == null ? 2 : G.settings.visorFx) + 2) % 3; G.saveSettings(); applyVfx(); UI.toast('Visor FX ' + ['OFF', 'LO', 'HI'][G.settings.visorFx], 'info'); }
  });
  function closeModal(relock) { hideScreen(); if (relock) lock(); }
  function resume() { hideScreen(); lock(); }

  // ---------- toasts / subtitles / banner ----------
  UI.toast = function (text, kind = 'info') {
    if (UI.log && G.running) UI.log(text);
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
    $('toasts').appendChild(el);
    while ($('toasts').children.length > 6) $('toasts').firstChild.remove();
    setTimeout(() => el.classList.add('out'), 3200); setTimeout(() => el.remove(), 3800);
  };
  const subQ = []; let subT = 0;
  UI.say = function (who, text) { subQ.push([who, text]); };
  UI.sayLines = function (lines) { (lines || []).forEach((l) => subQ.push(l)); };
  let banT = 0;
  UI.banner = function (title, sub) { $('banner').innerHTML = '<h1>' + esc(title) + '</h1><p>' + esc(sub || '') + '</p>'; $('banner').classList.add('on'); banT = 3.8; };

  // ================= JUNO: AI co-pilot (voice, reactions, banter) =================
  const JUNO = (UI.juno = { recent: [], cd: {}, last: 0, voice: null });
  const LINES = {
    lowArmor: ['Armor under thirty percent, Rhea. I would love it if you stopped getting shot.', 'Plating is critical. Break line of sight and I will patch you up.', 'We are leaking integrity. Find cover, I have the repairs.'],
    energy: ['Reactor is running dry. Ease off the boost for a second.', 'Energy low. Hover and let the core breathe.'],
    overheat: ['That gauntlet is cooking. Give it a moment.', 'Overheat. The cooling fins are filing a complaint.', 'Too hot to fire. Switch hands while it vents.'],
    fast: ['Four hundred kilometers an hour. Your mother would be horrified.', 'Very fast, very stylish. Please mind the buildings.', 'Wind shear warnings are just suggestions, apparently.'],
    contact: ['Contacts ahead. Syndicate colors.', 'Hostiles on scope. Marking them now.', 'I count {n} hostiles. Your move.'],
    kill: ['Target down.', 'Neutralized. Nice.', 'One less Syndicate paycheck.', 'Clean hit.', 'He will be waking up with a headache.'],
    streak: ['Three in a row. Show-off.', 'That is a streak. Logging it for posterity.', 'Remind me never to annoy you.'],
    lance: ['Core Lance charged.', 'Lance is ready when you are.'],
    crate: ['Salvage secured. That is {n} of {t}.', 'Crate logged, {n} of {t}. Someone left good stuff on this roof.'],
    bench: ['New workbench online. I have added it to fast travel.', 'Found another workbench. I will keep the lights on for you.'],
    rare: ['Oh, that is a good one. {part}. Workbench, soon?', '{part}! I may be a little excited.', 'Grabbed a {part}. I already have ideas.'],
    down: ['Suit failure! Rebooting, hold on Rhea!'],
    respawn: ['Back online. Let us not do that again.', 'Reboot complete. All limbs accounted for.'],
    district: ['Entering {d}.'],
    rain: ['Rain is coming in. Roads will be slick and my sensors will be grumpy.', 'Storm front overhead. Lightning is mostly harmless to the suit. Mostly.'],
    clear: ['Skies are clearing.', 'Rain is moving off. Visibility back to normal.'],
    night: ['Night shift, Rhea. The city looks better from up here in the dark.', 'Sun is down. Switching optics to low-light.'],
    dawn: ['Morning already. We did not sleep, did we?', 'Sunrise. I will never get tired of that view.'],
    home: ['Welcome home, Rhea.', 'Hangar lights on. Make yourself at home.', 'Home sweet hangar. Your suits are where you left them.'],
    idle: ['Port Halcyon has forty five salvage crates. I counted. Twice.', 'Reminder: the workbench can rebuild anything if you have the parts. I am very good at it.', 'Your heart rate is steady. Mine would be too, if I had one.', 'Marrow used to steal my coffee mug at the old lab. I have not forgiven him.', 'A Rail Driver with a Lance Lens goes straight through people. Metaphorically. Mostly.', 'Thruster temperature nominal. Banter levels also nominal.', 'You know the sunset looks better from four hundred meters up.', 'If you are bored, I can read you the suit warranty. It is short. It says no.', 'Blackwater Rock was a prison for sixty years. Now it is mostly seagulls and bad decisions.', 'Green beacons are race starts. I have taken the liberty of calculating your gold times. You are welcome.', 'Shockwave tip: it knocks rockets out of the air. I am very proud of that one.'],
  };
  const DFLAV = { downtown: 'Downtown. Glass everywhere, try not to fly through any of it', midtown: 'Midtown', uptown: 'Uptown. Fancy rooftops', oldtown: 'Old Town. Narrow streets, low roofs', industrial: 'the Foundry District', harbor: 'the Harbor', park: 'Greenway Park. Very green. Very park', water: 'open water', sea: 'open sea. Port Halcyon is behind you', rock: 'Blackwater Rock. The old prison island', bridge: 'the Halcyon Bridge' };
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    return vs.find((v) => /samantha|zira|aria|jenny|female|serena|karen|tessa|moira|fiona|google us english/i.test(v.name)) || vs[0] || null;
  }
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => (JUNO.voice = pickVoice());
  JUNO.speak = function (text) {
    if (!G.settings.voice || !('speechSynthesis' in window)) return;
    try {
      if (speechSynthesis.pending || speechSynthesis.speaking) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); JUNO.voice = JUNO.voice || pickVoice(); if (JUNO.voice) u.voice = JUNO.voice;
      u.rate = 1.06; u.pitch = 1.08; u.volume = Math.min(1, G.settings.volume * 1.4); u.onstart = () => (JUNO.talking = true); u.onend = u.onerror = () => (JUNO.talking = false); speechSynthesis.speak(u);
    } catch (e) {}
  };
  JUNO.bark = function (key, vars, opts) {
    opts = opts || {};
    if (!G.running || (!G.settings.chatter && !opts.important)) return;
    const now = performance.now();
    if (!opts.important && (now - JUNO.last < 7000 || (JUNO.cd[key] && now < JUNO.cd[key]) || subQ.length > 1)) return;
    const pool = LINES[key]; if (!pool) return;
    let opts2 = pool.filter((l) => !JUNO.recent.includes(l)); if (!opts2.length) opts2 = pool;
    let line = opts2[(Math.random() * opts2.length) | 0];
    JUNO.recent.push(line); if (JUNO.recent.length > 12) JUNO.recent.shift();
    if (vars) for (const k in vars) line = line.split('{' + k + '}').join(vars[k]);
    JUNO.last = now; JUNO.cd[key] = now + (opts.cd || 25000);
    UI.say('J', line);
  };
  // watch the game state and react
  const W = { hpLow: false, enLow: false, over: [false, false], fastT: 0, dist: null, distT: 0, distCand: null, contacts: 0, kills: -1, killTimes: [], crates: -1, benches: -1, dead: false, idleT: 70, lanceWas: true };
  function junoWatch(dt) {
    const P = G.player, S = P.suit, st = G.state;
    if (W.kills < 0) { W.kills = st.stats.kills; W.crates = st.crates.length; W.benches = st.benches.length; }
    const hpR = P.hp / S.hp;
    if (hpR < 0.3 && !W.hpLow && !P.dead) { W.hpLow = true; JUNO.bark('lowArmor', null, { important: true, cd: 20000 }); } else if (hpR > 0.55) W.hpLow = false;
    if (P.energy < 15 && !W.enLow) { W.enLow = true; JUNO.bark('energy', null, { cd: 30000 }); } else if (P.energy > 50) W.enLow = false;
    for (let i = 0; i < 2; i++) { if (P.over[i] && !W.over[i]) JUNO.bark('overheat', null, { cd: 20000 }); W.over[i] = P.over[i]; }
    const kmh = P.vel.length() * 3.6; if (kmh > 400) { W.fastT += dt; if (W.fastT > 1.5) { JUNO.bark('fast', null, { cd: 90000 }); W.fastT = -999; } } else W.fastT = Math.max(0, W.fastT);
    const d = G.districtAt(P.pos.x, P.pos.z);
    if (d !== W.dist) { if (d === W.distCand) { W.distT += dt; if (W.distT > 3) { if (W.dist !== null) JUNO.bark('district', { d: DFLAV[d] || d }, { cd: 40000 }); W.dist = d; } } else { W.distCand = d; W.distT = 0; } }
    const near = G.enemies.filter((e) => e.alive && !e.passive && e.pos.distanceTo(P.pos) < 220).length;
    if (near > 0 && W.contacts === 0) JUNO.bark('contact', { n: near }, { cd: 45000 });
    W.contacts = near;
    if (st.stats.kills > W.kills) {
      const now = performance.now(); W.killTimes.push(now); W.killTimes = W.killTimes.filter((t) => now - t < 10000);
      if (W.killTimes.length >= 3) { JUNO.bark('streak', null, { cd: 40000 }); W.killTimes = []; } else if (Math.random() < 0.35) JUNO.bark('kill', null, { cd: 12000 });
      W.kills = st.stats.kills;
    }
    if (st.crates.length > W.crates) { W.crates = st.crates.length; JUNO.bark('crate', { n: W.crates, t: G.crates.length }, { cd: 5000, important: true }); }
    if (st.benches.length > W.benches) { W.benches = st.benches.length; JUNO.bark('bench', null, { important: true, cd: 5000 }); }
    if (P.dead && !W.dead) JUNO.bark('down', null, { important: true, cd: 1000 });
    if (!P.dead && W.dead) setTimeout(() => JUNO.bark('respawn', null, { important: true, cd: 1000 }), 400);
    W.dead = P.dead;
    const inHQ = G.inHQ(); if (inHQ && !W.inHQ) JUNO.bark('home', null, { important: true, cd: 60000 }); W.inHQ = inHQ;
    const lanceOk = P.lanceCd <= 0 && P.energy >= 50; if (lanceOk && !W.lanceWas && near > 0) JUNO.bark('lance', null, { cd: 60000 }); W.lanceWas = lanceOk;
    if (subT <= 0 && !subQ.length) { W.idleT -= dt; if (W.idleT <= 0) { W.idleT = 100 + Math.random() * 80; if (near === 0 && !G.mission.active) JUNO.bark('idle', null, { cd: 1000 }); } } else W.idleT = Math.max(W.idleT, 40);
  }
  {
    const orig = G.addPart;
    G.addPart = function (id, n, quiet) { orig(id, n, quiet); if (!quiet && G.PART[id].tier >= 3 && UI.juno) UI.juno.bark('rare', { part: G.PART[id].name }, { important: true, cd: 3000 }); };
  }
  // ================= ASK JUNO console =================
  const jcHistory = [];
  const EMCODE = { em_pulse: 'PULSE', em_micro: 'MSL', em_scatter: 'SCAT', em_rail: 'RAIL', em_arc: 'ARC', em_nova: 'NOVA', em_minigun: 'GUN' };
  function dirWord(to) {
    const P = G.player, brg = ((Math.atan2(to.x - P.pos.x, -(to.z - P.pos.z)) * 180) / Math.PI + 360) % 360;
    return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(brg / 45) % 8];
  }
  function inBuilds(id) { let n = 0; G.state.weapons.concat(G.state.suits).forEach((b) => Object.values(b.parts).forEach((x) => { if (x === id) n++; })); return n; }
  function partSources(id) {
    const p = PART[id], mi = G.state.missionIndex, base = 1 + Math.floor(mi / 2), own = G.state.inventory[id] || 0, inb = inBuilds(id);
    const out = [];
    out.push(own ? `You have ${own} spare ${p.name}${own > 1 ? 's' : ''}${inb ? ', plus ' + inb + ' inside your builds' : ''}.` : inb ? `No spare ${p.name}, but ${inb} ${inb > 1 ? 'are' : 'is'} inside your builds. Dismantle one to free it up.` : `You do not have a ${p.name} yet.`);
    D.MISSIONS.forEach((m, i) => { if (m.reward.includes(id)) out.push(i < mi ? `Mission ${i + 1}, ${m.title}, already gave you one.` : `Mission ${i + 1}, ${m.title}, rewards one${i === mi ? ', and that is your next mission' : ''}.`); });
    if (p.tier <= base) out.push('It is in the common loot pool right now. Any Syndicate soldier or gunner can drop it, and so can crates and raids.');
    else if (p.tier <= base + 1) out.push('Soldiers will not carry it yet, but salvage crates, stopped raids, convoy trucks and jammer towers can.');
    else if (p.tier >= 5) out.push('Tier 5 gear never drops. It only comes from the Act II bosses, as a mission reward.');
    else if (p.tier <= base + 2) out.push('Only the gunship carries gear that good right now. Keep pushing the story and it will start showing up in crates.');
    else out.push(`Tier ${p.tier} gear is not in circulation yet. After ${Math.max(0, 2 * (p.tier - 2))} story missions, crates and raids can start carrying it.`);
    return out.join(' ');
  }
  function nearestCrate() {
    let best = null, bd = Infinity;
    G.crates.forEach((c) => { if (G.state.crates.includes(c.id)) return; const d = c.pos.distanceTo(G.player.pos); if (d < bd) { bd = d; best = c; } });
    return best ? { c: best, d: bd } : null;
  }
  function junoAnswer(q) {
    const t = q.toLowerCase();
    let wp = null, a;
    const partHit = D.PARTS.map((p) => ({ p, sc: (t.includes(p.name.toLowerCase()) ? 3 : 0) + p.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && t.includes(w)).length })).sort((x, y) => y.sc - x.sc)[0];
    if (partHit && partHit.sc > 0) { a = partSources(partHit.p.id); const nc = nearestCrate(); if (nc && !(G.state.inventory[partHit.p.id] > 0)) { wp = nc.c.pos.clone(); a += ` The nearest salvage crate is ${Math.round(nc.d)} meters ${dirWord(nc.c.pos)}. I marked it.`; } }
    else if (/crate|salvage|loot/.test(t)) { const nc = nearestCrate(); if (nc) { wp = nc.c.pos.clone(); a = `Nearest salvage crate is ${Math.round(nc.d)} meters ${dirWord(nc.c.pos)}, up on a rooftop. Marked. You have found ${G.state.crates.length} of ${G.crates.length}.`; } else a = 'You found every crate in the city. I am genuinely impressed.'; }
    else if (/next|mission|quest|story|what (do|should)/.test(t)) {
      const M = G.mission;
      if (M.active) { const m = D.MISSIONS[M.idx]; a = `We are in ${m.title}. Current objective: ${G.objective.text}${G.objective.sub ? ' (' + G.objective.sub + ')' : ''}.`; wp = G.objective.wp && G.objective.wp.clone(); }
      else if (G.state.missionIndex < D.MISSIONS.length) { const m = D.MISSIONS[G.state.missionIndex]; a = `Next up is ${m.title}. ${m.desc} The yellow beacon is ${Math.round(G.objective.wp ? G.objective.wp.distanceTo(G.player.pos) : 0)} meters ${G.objective.wp ? dirWord(G.objective.wp) : 'away'}.`; wp = G.objective.wp && G.objective.wp.clone(); }
      else a = 'The story is done. Stop raids, hunt crates and build something ridiculous.';
    } else if (/bench|workbench|fabricat|build/.test(t)) {
      let best = null, bd = Infinity; G.benchObjs.forEach((b) => { const d = b.pos.distanceTo(G.player.pos); if (d < bd) { bd = d; best = b; } });
      wp = best.pos.clone(); a = `Closest workbench is ${best.b.name}, ${Math.round(bd)} meters ${dirWord(best.pos)}. Marked.`;
    } else if (/home|tower|hq|hangar|base/.test(t)) {
      wp = G.HQ.core.clone(); a = `AEGIS Tower is ${Math.round(G.HQ.core.distanceTo(G.player.pos))} meters ${dirWord(G.HQ.core)}. Fly in through the south hangar door at two hundred meters up. Marked.`;
    } else if (/tech|upgrade (my |the )?suit|suit upgrade|upgrades|skill/.test(t)) {
      const tp = G.state.tech; a = `You have ${tp.pts} Tech Point${tp.pts === 1 ? '' : 's'}. Spend them in the Upgrades tab at any workbench: armor, reactor, shield, shockwave, thrusters and the Core Lance, three levels each. Story missions give three, stopped raids one, every five salvage crates one, and race medals up to four per race.`;
    } else if (/race|ring|time trial|medal/.test(t)) {
      const open = G.RACES.filter((r) => G.state.missionIndex >= r.unlock);
      if (!open.length) a = 'Races open up after the first story mission.';
      else { const r = open.reduce((x, y) => (new THREE.Vector3(...x.start).distanceTo(G.player.pos) < new THREE.Vector3(...y.start).distanceTo(G.player.pos) ? x : y)); wp = new THREE.Vector3(...r.start); const rec = G.state.races[r.id]; a = `Closest race is ${r.name}, ${Math.round(wp.distanceTo(G.player.pos))} meters ${dirWord(wp)}. Fly into the green beacon and press E. Gold time is ${G.fmtRace(r.medals[0])}${rec && rec.best ? ', your best is ' + G.fmtRace(rec.best) : ''}. Marked.`; }
    } else if (/shield|dash|shock|abilit/.test(t)) a = 'Hold F for the shield: it soaks most damage but drains energy and you cannot fire through it. G is a shockwave: it knocks enemies flat, swats rockets and mines out of the air and pulls cloaked targets out of stealth. R dashes the way you are moving, and nothing can touch you for a split second.';
    else if (/vesper|hale|nightjar|blackwater|island|prison|bridge|walker/.test(t)) a = G.state.missionIndex < 8 ? 'Blackwater Rock is the old prison island south of the harbor, across the Halcyon Bridge. Closed for decades. I keep picking up odd signals from it.' : G.state.missionIndex < 12 ? 'Vesper Hale ran operations for Marrow. She has the Syndicate remnants holed up on Blackwater Rock, south across the Halcyon Bridge, and she flies a cloaking suit she calls the Nightjar.' : 'Blackwater Rock is ours now. The outpost workbench is by the north gate, and the Rock Run race starts out over the water east of the bridge.';
    else if (/better|upgrade|tier|rare|good (part|gear)/.test(t)) {
      a = `Right now drops go up to tier ${Math.min(4, 1 + Math.floor(G.state.missionIndex / 2))} from soldiers and tier ${Math.min(4, 2 + Math.floor(G.state.missionIndex / 2))} from crates, raids, trucks and jammers. Story missions hand out the best stuff, and every two missions raises the loot tier.`;
    } else if (/heat|overheat|cool/.test(t)) a = 'Heat comes from the emitter and the power cell. Liquid Loop and Cryo Sink cooling cut it a lot, a better reactor vents faster, and a damaged arm runs hotter.';
    else if (/energy|boost|reactor/.test(t)) a = 'Boost burns energy. Bigger reactors hold more, Surge and Starheart cores regenerate faster, and Grav Drive thrusters boost cheaply.';
    else if (/armor|health|heal|repair/.test(t)) a = 'Stay out of fire for five seconds and I start repairing armor and every body part. Heavier plating gives more armor but slows you.';
    else if (/hello|hi juno|hey|thank/.test(t)) a = pick2(['Hi Rhea. Ask me anything about parts, crates, workbenches or the mission.', 'Always happy to help. Mostly.', 'You are welcome. I will add it to your tab.']);
    else a = 'I did not catch that. Ask me where to find a part by name, or about crates, workbenches, the tower, or what to do next.';
    if (wp) G.junoWp = wp;
    return a;
  }
  function junoConsoleBody() {
    const groups = D.SLOTS.weapon.concat(D.SLOTS.suit).map((sl) => `<optgroup label="${sl.toUpperCase()}">${D.PARTS.filter((p) => p.slot === sl).map((p) => `<option value="${p.id}">${esc(p.name)} (have ${G.state.inventory[p.id] || 0})</option>`).join('')}</optgroup>`).join('');
    const quick = [['Where is the nearest crate?', 'crate'], ['What should I do next?', 'next'], ['Where is the nearest workbench?', 'bench'], ['How do I get better parts?', 'better'], ['How do suit upgrades work?', 'tech'], ['Where is the nearest race?', 'race'], ['How do my abilities work?', 'abilities'], ['Take me home', 'tower']];
    return `<div class="jc-grid">
      <div class="col"><h3>Quick questions</h3><div class="btns">${quick.map((q) => `<button data-q="${esc(q[0])}">${esc(q[0])}</button>`).join('')}</div></div>
      <div class="col"><h3>Where can I find…</h3><div class="jc-row"><select id="jcPart">${groups}</select><button id="jcFind" class="primary">Ask</button></div>
        <h3>Or type a question</h3><form id="jcForm" class="jc-row"><input id="jcInput" maxlength="120" placeholder="e.g. where do I get a Rail Driver?" autocomplete="off"><button class="primary">Ask</button></form>
        <p class="fine">Anything I mark shows up as a cyan JUNO marker on your HUD, compass and minimap.</p></div>
      <div class="col"><h3>Conversation</h3><div id="jcLog">${jcHistory.map(histHTML).join('') || '<p class="dim">Nothing yet. Ask away.</p>'}</div></div></div>`;
  }
  const histHTML = (h) => `<div class="jq">› ${esc(h.q)}</div><div class="ja">${esc(h.a)}</div>`;
  function wireJunoConsole() {
    const ask = (q) => {
      if (!q.trim()) return; const a = junoAnswer(q); jcHistory.push({ q, a }); while (jcHistory.length > 8) jcHistory.shift();
      const log = $('jcLog'); if (log) { log.innerHTML = jcHistory.map(histHTML).join(''); log.scrollTop = log.scrollHeight; }
      typeJuno(a); G.sfx('ui');
    };
    on('[data-q]', 'click', (e) => ask(e.target.dataset.q));
    on('#jcFind', 'click', () => ask('where can I find ' + PART[$('jcPart').value].name));
    on('#jcForm', 'submit', (e) => { e.preventDefault(); ask($('jcInput').value); $('jcInput').value = ''; });
  }
  UI.openJuno = function () {
    if (!G.running) return;
    modal = 'juno'; G.paused = true; G.input.fire = [false, false];
    if (document.pointerLockElement) document.exitPointerLock();
    show(`<div class="bench holo"><div class="bench-head"><div><span class="fab-tag">JUNO // ASSISTANT</span><h2>Ask JUNO</h2></div><button id="jcClose">Close (J)</button></div>
      <div class="juno-bar"><div class="orb talk"><i></i><i></i><i></i><i></i><i></i></div><div id="junoText"></div></div><div class="bench-body">${junoConsoleBody()}</div></div>`);
    on('#jcClose', 'click', () => closeModal(true));
    wireJunoConsole();
    typeJuno(pick2(['What do you need, Rhea?', 'Ask me where to find any part. I keep very good records.', 'Go on, ask. I have been waiting all day.']));
  };
  // ================= Talking to pedestrians =================
  const bubbles = [];
  UI.bubble = function (getPos, text, dur = 4) {
    const el = document.createElement('div'); el.className = 'bubble'; el.textContent = text;
    $('bubbles').appendChild(el); bubbles.push({ el, getPos, t: dur });
    while (bubbles.length > 5) { const b = bubbles.shift(); b.el.remove(); }
  };
  function updateBubbles(dt) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i]; b.t -= dt;
      const pos = b.getPos(); const pr = G.project(pos.setY(pos.y + 0.45));
      const dd = pos.distanceTo(G.camera.position);
      if (b.t <= 0 || modal) { b.el.remove(); bubbles.splice(i, 1); continue; }
      b.el.style.display = pr.behind || dd > 60 ? 'none' : 'block';
      b.el.style.transform = `translate(${pr.x}px, ${pr.y}px) translate(-50%, -100%) scale(${Math.max(0.6, Math.min(1, 14 / dd))})`;
      b.el.style.opacity = Math.min(1, b.t * 2);
    }
  }
  const TALK = {
    fan: ['No way, it is actually you! Can I get a photo?', 'My kid has your poster on the wall. Well, a drawing of you. Close enough.', 'AEGIS! You saved my cousin at the docks!', 'Is it hot in there? It looks hot in there.', 'Okay be honest, can you actually fly to the moon?'],
    grumble: ['Your thrusters set off every car alarm on my street last night.', 'Somebody has to pay for the window you flew through on Tuesday.', 'Heroes. Never use the crosswalk.', 'You know there is a speed limit, right? Even for the sky?'],
    lore: ['The Syndicate runs half the shipping in the harbor. Everybody knows it.', 'They say Marrow used to be a scientist. Now he is just mean.', 'My brother drives trucks. He quit when the Syndicate made him an offer.', 'Uptown never gets raided. Funny how that works.'],
    plea: ['Please, Syndicate thugs are raiding a block nearby! You have to help!', 'There is a raid going on, people are hiding in the shops. Please hurry!'],
  };
  UI.npcTalk = function (h) {
    const r = Math.random(); let line, actName = 'talk';
    if (G.crime.active && G.crime.pos && r < 0.45) {
      line = pick2(TALK.plea); G.junoWp = G.crime.pos.clone();
      setTimeout(() => JUNO.bark('contact', { n: G.crime.left }, { important: true, cd: 2000 }), 1800);
    } else if (r < 0.32) {
      const nc = nearestCrate();
      if (nc) {
        G.junoWp = nc.c.pos.clone();
        line = `I saw something shiny on a rooftop, about ${Math.round(nc.d / 10) * 10} meters ${dirWord(nc.c.pos)} of here.`;
        setTimeout(() => UI.say('J', 'That matches a salvage crate on my scans. Marked it.'), 1600);
      } else line = pick2(TALK.lore);
    } else if (r < 0.62) {
      line = pick2(TALK.fan); actName = Math.random() < 0.5 ? 'photo' : 'cheer';
      G.state.stats.fans = (G.state.stats.fans || 0) + 1;
      if (actName === 'photo') setTimeout(() => { const hp = h.head(); G.flash && G.flash(hp); }, 900);
    } else if (r < 0.82) line = pick2(TALK.lore);
    else line = pick2(TALK.grumble);
    h.setAct(actName, actName === 'talk' ? 4.5 : 3.5);
    UI.bubble(h.head, line, 5);
    logLine('Citizen: ' + line);
    G.sfx('ui');
  };
  // ---------- MAIN MENU ----------
  function latestSlot() {
    let best = null;
    for (let i = 0; i <= 3; i++) { const s = G.readSlot(i); if (s && (!best || s.saved > best.s.saved)) best = { i, s }; }
    return best;
  }
  UI.mainMenu = function () {
    $('hud').classList.add('hidden');
    modal = 'menu';
    const last = latestSlot();
    show(`<div class="menu-card title-card">
      <div class="logo">AEGIS</div><div class="logo-sub">PORT HALCYON</div>
      <div class="btns">
        ${last ? `<button id="bCont" class="primary">Continue <small>${last.i === 0 ? 'Autosave' : 'Slot ' + last.i} · Mission ${Math.min(last.s.missionIndex + 1, D.MISSIONS.length)}/${D.MISSIONS.length}</small></button>` : ''}
        <button id="bNew" class="${last ? '' : 'primary'}">New Game</button>
        <button id="bLoad">Load Game</button>
        <button id="bImport">Import Save File</button>
        <button id="bSet">Settings</button>
        <button id="bCtl">Controls</button>
        ${window.aegisDesktop ? '<button id="bQuit" class="danger">Quit to Desktop</button>' : ''}
      </div>
      <p class="fine">Offline single-player · saves stay ${window.aegisDesktop ? 'on this computer' : 'in this browser'} · v1.0${!window.aegisDesktop && /\/play\/?/.test(location.pathname) ? ' · <a href="../#download" style="color:#6fe6ff">Get the desktop app</a>' : ''}</p>
    </div>`, 'menu-bg');
    if (last) on('#bCont', 'click', () => startFrom(last.s));
    on('#bNew', 'click', () => {
      const go = () => startFrom(G.newState());
      if (last) ask('Start a new game? Your saves stay in their slots, but the autosave will be overwritten when you progress.', go); else go();
    });
    on('#bLoad', 'click', () => loadScreen(UI.mainMenu));
    on('#bImport', 'click', importSave);
    on('#bSet', 'click', () => settingsScreen(UI.mainMenu));
    on('#bCtl', 'click', () => controlsScreen(UI.mainMenu));
    on('#bQuit', 'click', () => window.aegisDesktop && window.aegisDesktop.quit());
  };
  function startFrom(state) {
    G.audioInit();
    hideScreen();
    G.startGame(state);
    if (!G.running) { UI.mainMenu(); return; }
    $('hud').classList.remove('hidden');
    if (isTouch) $('touch').classList.remove('hidden');
    bootSequence();
    lock();
  }
  function importSave() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { const s = G.validateState(JSON.parse(r.result)); if (!s) throw 0; startFrom(s); UI.toast('Save imported', 'info'); } catch (e) { UI.toast('That file is not a valid AEGIS save', 'bad'); } };
      r.readAsText(f);
    };
    inp.click();
  }
  function exportSave() {
    G.state.pos = [G.player.pos.x, G.player.pos.y, G.player.pos.z];
    const blob = new Blob([JSON.stringify(G.state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'aegis-save-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function slotInfo(s) {
    if (!s) return '<span class="dim">Empty</span>';
    const m = Math.min(s.missionIndex, D.MISSIONS.length);
    return `Mission ${m}/${D.MISSIONS.length} · ${fmtPlay(s.stats ? s.stats.time : 0)} · ${new Date(s.saved).toLocaleString()}`;
  }
  function loadScreen(back) {
    modal = modal || 'sub';
    let rows = '';
    for (let i = 0; i <= 3; i++) {
      const s = G.readSlot(i);
      rows += `<div class="slot"><b>${i === 0 ? 'Autosave' : 'Slot ' + i}</b><span>${slotInfo(s)}</span>
        ${s ? `<button data-load="${i}">Load</button><button class="danger" data-del="${i}">Delete</button>` : ''}</div>`;
    }
    show(`<div class="menu-card"><h2>Load Game</h2>${rows}<div class="btns row"><button id="bBack">Back</button></div></div>`, back === UI.mainMenu ? 'menu-bg' : '');
    on('[data-load]', 'click', (e) => { const s = G.readSlot(+e.target.dataset.load); if (s) startFrom(s); });
    on('[data-del]', 'click', (e) => { const n = +e.target.dataset.del; ask('Delete this save?', () => { G.deleteSlot(n); loadScreen(back); }); });
    on('#bBack', 'click', back);
  }
  function saveScreen(back) {
    let rows = '';
    for (let i = 1; i <= 3; i++) rows += `<div class="slot"><b>Slot ${i}</b><span>${slotInfo(G.readSlot(i))}</span><button data-save="${i}">Save here</button></div>`;
    const auto = G.readSlot(0);
    show(`<div class="menu-card"><h2>Save Game</h2>${G.mission.active ? '<p class="warn">You are mid-mission. Loading this save restarts the mission from its beacon.</p>' : ''}
      ${rows}<div class="slot"><b>Autosave</b><span>${slotInfo(auto)}</span></div>
      <div class="btns row"><button id="bExport">Export save file</button><button id="bBack">Back</button></div></div>`);
    on('[data-save]', 'click', (e) => { const n = +e.target.dataset.save; const go = () => { G.saveGame(n); saveScreen(back); }; if (G.readSlot(n)) ask('Overwrite slot ' + n + '?', go); else go(); });
    on('#bExport', 'click', exportSave);
    on('#bBack', 'click', back);
  }
  function settingsScreen(back) {
    const s = G.settings;
    show(`<div class="menu-card"><h2>Settings</h2>
      <label class="set">Mouse / touch sensitivity <input type="range" id="sSens" min="0.3" max="3" step="0.1" value="${s.sens}"><span id="sSensV">${s.sens}</span></label>
      <label class="set">Invert Y <input type="checkbox" id="sInv" ${s.invertY ? 'checked' : ''}></label>
      <label class="set">Fullscreen (F11) <button id="sFull" type="button">Toggle</button></label>
      <label class="set">First-person view (V) <input type="checkbox" id="sFp" ${s.fp ? 'checked' : ''}></label>
      <label class="set">Blood effects <input type="checkbox" id="sBlood" ${s.blood !== false ? 'checked' : ''}></label>
      <label class="set">JUNO voice (spoken lines) <input type="checkbox" id="sVoice" ${s.voice ? 'checked' : ''}></label>
      <label class="set">JUNO chatter (reactions &amp; banter) <input type="checkbox" id="sChat" ${s.chatter ? 'checked' : ''}></label>
      <label class="set">Time of day <select id="sTime">${[['dynamic', 'Dynamic (day/night cycle)'], ['dawn', 'Dawn'], ['day', 'Day'], ['sunset', 'Sunset'], ['night', 'Night']].map(([v, l]) => `<option value="${v}" ${s.timeMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="set">Weather <select id="sWeather">${[['dynamic', 'Dynamic (storms come and go)'], ['clear', 'Always clear'], ['rain', 'Always raining']].map(([v, l]) => `<option value="${v}" ${s.weather === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="set">View distance <select id="sView">${[1200, 1800, 2200, 3000].map((v) => `<option ${v === s.view ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="set">Volume <input type="range" id="sVol" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <label class="set">Graphics quality <select id="sQ">${[['0', 'Low (fastest)'], ['1', 'High (glow, shadows)'], ['2', 'Ultra (+ soft & long-range shadows, ambient occlusion, sun rays)'], ['3', 'Max (+ city reflections in water and wet streets)']].map(([v, l]) => `<option value="${v}" ${String(s.quality | 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="btns row"><button id="bBack" class="primary">Done</button></div></div>`, back === UI.mainMenu ? 'menu-bg' : '');
    const upd = () => {
      s.sens = +$('sSens').value; $('sSensV').textContent = s.sens; s.invertY = $('sInv').checked; s.view = +$('sView').value;
      s.volume = +$('sVol').value; s.fp = $('sFp').checked; s.voice = $('sVoice').checked; s.timeMode = $('sTime').value; s.weather = $('sWeather').value; s.blood = $('sBlood').checked; s.chatter = $('sChat').checked; if (!s.voice && 'speechSynthesis' in window) speechSynthesis.cancel(); s.quality = +$('sQ').value; G.saveSettings();
    };
    on('input,select', 'input', upd); on('input,select', 'change', upd);
    on('#sFull', 'click', toggleFullscreen);
    on('#bBack', 'click', back);
  }
  function controlsScreen(back) {
    const k = (a, b) => `<tr><td><kbd>${a}</kbd></td><td>${b}</td></tr>`;
    show(`<div class="menu-card"><h2>Controls</h2><table class="keys">
      ${k('Mouse', 'Look / aim')}${k('Left click', 'Primary weapon (hold)')}${k('Right click', 'Secondary weapon (hold)')}
      ${k('W A S D', 'Move / hover')}${k('Space', 'Fly up')}${k('C / Ctrl', 'Fly down / land')}
      ${k('Shift + W', 'Boost — fly where you look')}${k('Q', 'Core Lance (50 energy)')}${k('F (hold)', 'Energy shield — blocks most damage, drains energy, no firing')}${k('G', 'Shockwave — knock enemies back, swat rockets, break cloaks')}${k('R', 'Dash — quick burst in your move direction, dodges hits')}${k('E', 'Use workbench / talk to people / start a race · hold to defuse')}${k('E near a car', 'Lift it overhead · click or E again to throw it')}
      ${k('V', 'Switch first / third person')}${k('J', 'Ask JUNO (where to find parts, crates, what next)')}${k('1-9 / wheel', 'Swap primary weapon')}${k('X', 'Visor FX: HI / LO / OFF')}${k('M', 'City map / fast travel')}${k('Esc / P', 'Pause, save, settings')}</table>
      <p class="fine">Touch: left thumb moves, drag right side to look, buttons for fire / up / down / boost.</p>
      <p class="fine">Weapons build up heat. Overheat and they lock until they cool down.</p>
      <div class="btns row"><button id="bBack" class="primary">Back</button></div></div>`, back === UI.mainMenu ? 'menu-bg' : '');
    on('#bBack', 'click', back);
  }

  function toggleFullscreen() {
    if (window.aegisDesktop) { window.aegisDesktop.toggleFullscreen(); return; }
    try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {}
  }
  UI.toggleFullscreen = toggleFullscreen;
  // ---------- PAUSE ----------
  function openPause() {
    if (!G.running) return;
    modal = 'pause'; G.paused = true; G.input.fire = [false, false];
    if (document.pointerLockElement) document.exitPointerLock();
    const st = G.state.stats, m = G.mission;
    const done = Math.min(G.state.missionIndex, D.MISSIONS.length);
    const log = D.MISSIONS.map((x, i) => `<li class="${i < done ? 'done' : i === done ? 'cur' : ''}">${i + 1}. ${i <= done ? esc(x.title) : '???'}</li>`).join('');
    show(`<div class="menu-card wide"><h2>Paused</h2>
      <div class="cols"><div class="btns">
        <button id="pRes" class="primary">Resume</button><button id="pSave">Save Game</button><button id="pLoad">Load Game</button>
        <button id="pMap">Map</button><button id="pSet">Settings</button><button id="pCtl">Controls</button>
        ${m.active ? '<button id="pAb" class="danger">Abandon Mission</button>' : ''}${G.race && G.race.active ? '<button id="pAr" class="danger">Abandon Race</button>' : ''}
        <button id="pQuit">Quit to Title</button>${window.aegisDesktop ? '<button id="pDesk" class="danger">Quit to Desktop</button>' : ''}</div>
      <div class="log"><h3>Story</h3><ol>${log}</ol>
        <h3>Stats</h3><p>Play time ${fmtPlay(st.time)}<br>Enemies destroyed ${st.kills}<br>Crimes stopped ${st.crimes}<br>Builds crafted ${st.crafted}<br>Salvage crates ${G.state.crates.length}/${G.crates.length}<br>Workbenches ${G.state.benches.length}/${D.BENCHES.length}<br>Tech Points ${G.state.tech.pts} (${G.state.tech.earned} earned)<br>Race medals ${G.RACES.map((r) => ['–', 'B', 'S', 'G'][(G.state.races[r.id] || {}).medal | 0]).join(' ')}</p></div></div></div>`);
    on('#pRes', 'click', resume);
    on('#pDesk', 'click', () => ask('Quit the game? Unsaved progress since your last save is lost.', () => window.aegisDesktop.quit()));
    on('#pSave', 'click', () => saveScreen(openPause));
    on('#pLoad', 'click', () => loadScreen(openPause));
    on('#pMap', 'click', () => openMap());
    on('#pSet', 'click', () => settingsScreen(openPause));
    on('#pCtl', 'click', () => controlsScreen(openPause));
    on('#pAb', 'click', () => { G.abandonMission(); resume(); });
    on('#pAr', 'click', () => { G.abandonRace(); resume(); });
    on('#pQuit', 'click', () => ask('Quit to title? Unsaved progress since your last save is lost.', () => { hideScreen(); G.quitToMenu(); $('touch').classList.add('hidden'); UI.mainMenu(); }));
  }
  UI.openPause = openPause;

  // ---------- MAP ----------
  function openMap() {
    modal = 'map'; G.paused = true; G.input.fire = [false, false];
    if (document.pointerLockElement) document.exitPointerLock();
    show(`<div class="map-wrap"><canvas id="bigmap"></canvas>
      <div class="map-side"><h2>Port Halcyon</h2>
        <p class="legend"><i style="background:#3fe0ff"></i>Workbench (click to fast travel)<br><i style="background:#ffd040"></i>Mission / objective<br><i style="background:#40ff80"></i>Ring race start<br><i style="background:#ff3355"></i>Hostiles<br><i style="background:#ffa030"></i>Salvage crate (nearby)<br><i style="background:#fff"></i>You</p>
        <p class="fine">Crates found ${G.state.crates.length}/${G.crates.length}</p>
        <button id="mClose" class="primary">Close (M)</button></div></div>`);
    const c = $('bigmap');
    const H = G.WORLD.HALF, SOUTH = G.WORLD.SOUTH || H, worldW = G.WORLD.SIZE, worldH = H + SOUTH;
    const k = Math.min((window.innerWidth - (window.innerWidth > 700 ? 280 : 20)) / worldW, (window.innerHeight - 40) / worldH);
    c.width = Math.round(worldW * k); c.height = Math.round(worldH * k);
    const size = c.width;
    const g = c.getContext('2d');
    const X = (x) => (x + H) * k, Z = (z) => (z + H) * k;
    g.fillStyle = '#1b4a6a'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(G.mapCanvas, 0, 0, worldW * k, worldW * k);
    drawExtras(g, (x, z) => [X(x), Z(z)], k, true);
    G.RACES.forEach((r) => { if (G.state.missionIndex < r.unlock) return; g.fillStyle = '#40ff80'; g.beginPath(); g.arc(X(r.start[0]), Z(r.start[2]), 6, 0, 7); g.fill(); g.strokeStyle = '#000'; g.stroke(); g.fillStyle = '#c8ffd8'; g.font = '11px system-ui'; g.textAlign = 'center'; g.fillText(r.name, X(r.start[0]), Z(r.start[2]) - 10); });
    // labels
    g.font = 'bold ' + Math.max(10, size / 60) + 'px system-ui'; g.fillStyle = 'rgba(255,255,255,0.55)'; g.textAlign = 'center';
    [['DOWNTOWN', 0, -60], ['OLD TOWN', -1050, -600], ['INDUSTRIAL', 1000, -300], ['UPTOWN', 0, -1250], ['HARBOR', 0, 950], ['GREENWAY', -440, -40], ['MIDTOWN', -350, 600], ['AEGIS TOWER', -200, -395]].forEach(([t, x, z]) => g.fillText(t, X(x), Z(z)));
    const benches = [];
    G.benchObjs.forEach((b) => {
      const known = G.state.benches.includes(b.b.id);
      g.fillStyle = known ? '#3fe0ff' : '#557'; g.fillRect(X(b.pos.x) - 6, Z(b.pos.z) - 6, 12, 12);
      g.strokeStyle = '#000'; g.strokeRect(X(b.pos.x) - 6, Z(b.pos.z) - 6, 12, 12);
      if (known) { g.fillStyle = '#cff'; g.font = '11px system-ui'; g.fillText(b.b.name, X(b.pos.x), Z(b.pos.z) - 10); benches.push(b); }
    });
    const scanR = 250 * G.player.suit.scan;
    G.crates.forEach((cr) => { if (!G.state.crates.includes(cr.id) && cr.pos.distanceTo(G.player.pos) < scanR) { g.fillStyle = '#ffa030'; g.fillRect(X(cr.pos.x) - 3, Z(cr.pos.z) - 3, 6, 6); } });
    G.enemies.forEach((e) => { if (e.alive) { g.fillStyle = '#ff3355'; g.beginPath(); g.arc(X(e.pos.x), Z(e.pos.z), e.boss ? 7 : 3, 0, 7); g.fill(); } });
    if (G.objective.wp) { g.strokeStyle = '#ffd040'; g.lineWidth = 3; g.beginPath(); g.arc(X(G.objective.wp.x), Z(G.objective.wp.z), 10, 0, 7); g.stroke(); }
    const p = G.player; g.save(); g.translate(X(p.pos.x), Z(p.pos.z)); g.rotate(-p.yaw); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(-7, 8); g.closePath(); g.fill(); g.restore();
    c.addEventListener('click', (ev) => {
      const r = c.getBoundingClientRect(); const mx = (ev.clientX - r.left) * (c.width / r.width), my = (ev.clientY - r.top) * (c.height / r.height);
      const b = benches.find((b) => Math.hypot(X(b.pos.x) - mx, Z(b.pos.z) - my) < 16);
      if (b) ask('Fast travel to ' + b.b.name + '?', () => { if (G.fastTravel(b.b.id)) closeModal(true); });
    });
    on('#mClose', 'click', () => closeModal(true));
  }

  // ---------- WORKBENCH ----------
  let benchTab = 'weapon', editing = { weapon: null, suit: null }, draft = { weapon: null, suit: null }, curBench = null;
  let prev = null; // suit preview renderer
  UI.openBench = function (bench) {
    curBench = bench; modal = 'bench'; G.paused = true; G.input.fire = [false, false];
    if (document.pointerLockElement) document.exitPointerLock();
    G.sfx('ui');
    renderBench();
  };
  function owned(id) { return G.state.inventory[id] || 0; }
  function availFor(kind, id) {
    let n = owned(id);
    const ed = editing[kind] && findBuild(kind, editing[kind]);
    if (ed) Object.values(ed.parts).forEach((p) => { if (p === id) n++; });
    return n;
  }
  const findBuild = (kind, id) => (kind === 'weapon' ? G.state.weapons : G.state.suits).find((b) => b.id === id);
  function blankDraft(kind) {
    const slots = D.SLOTS[kind], parts = {};
    slots.forEach((s) => { const opts = D.PARTS.filter((p) => p.slot === s); parts[s] = (opts.find((p) => owned(p.id) > 0) || opts[0]).id; });
    return kind === 'weapon' ? { name: 'Custom Mk ' + (G.state.weapons.length + 1), parts, color: '#7dff9a' } : { name: 'AEGIS Custom ' + (G.state.suits.length + 1), parts, c1: '#3a3f4a', c2: '#e0a33a' };
  }
  function renderBench() {
    const tabs = [['weapon', 'Weapons'], ['suit', 'Suits'], ['upg', 'Upgrades' + (G.state.tech.pts ? ' · ' + G.state.tech.pts : '')], ['parts', 'Parts'], ['ask', 'Ask JUNO'], ['travel', 'Fast Travel'], ['save', 'Save']];
    let body = '';
    if (benchTab === 'weapon' || benchTab === 'suit') body = buildTab(benchTab);
    else if (benchTab === 'upg') body = upgTab();
    else if (benchTab === 'parts') body = partsTab();
    else if (benchTab === 'travel') body = travelTab();
    else if (benchTab === 'ask') body = junoConsoleBody();
    else body = `<div class="pad"><p>Save your progress at this workbench.</p><div class="btns row"><button id="wbSave" class="primary">Open save slots</button><button id="wbExport">Export save file</button></div></div>`;
    show(`<div class="bench holo"><div class="bench-head"><div><span class="fab-tag">JUNO // FABRICATION BAY</span><h2>${esc(curBench.name)}</h2></div><button id="wbClose">Close (E)</button></div>
      <div class="juno-bar"><div class="orb talk"><i></i><i></i><i></i><i></i><i></i></div><div id="junoText"></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${benchTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="bench-body">${body}</div></div>`);
    on('[data-tab]', 'click', (e) => { benchTab = e.target.dataset.tab; G.sfx('ui'); junoNote = null; renderBench(); });
    typeJuno(junoNote || tabGreeting());
    on('#wbClose', 'click', () => closeModal(true));
    if (benchTab === 'weapon' || benchTab === 'suit') wireBuild(benchTab);
    if (benchTab === 'ask') wireJunoConsole();
    if (benchTab === 'upg') {
      on('[data-upg]', 'click', (e) => { const id = e.target.dataset.upg; if (G.buyUpgrade(id)) { const u = D.UPGRADES.find((x) => x.id === id); junoNote = pick2([u.name + ' upgraded. I can feel the difference. Figuratively.', 'Installed. ' + u.name + ' is now level ' + G.upgradeLevel(id) + '.', 'Done. That is money well spent, if Tech Points were money.']); renderBench(); } });
      on('[data-race]', 'click', (e) => { const r = G.RACES.find((x) => x.id === e.target.dataset.race); G.junoWp = new THREE.Vector3(r.start[0], r.start[1], r.start[2]); junoNote = r.name + ' start is marked on your HUD. Green beacon, press E.'; renderBench(); });
    }
    if (benchTab === 'travel') on('[data-travel]', 'click', (e) => { if (G.fastTravel(e.target.dataset.travel)) closeModal(true); });
    if (benchTab === 'save') { on('#wbSave', 'click', () => saveScreen(() => { modal = 'bench'; renderBench(); })); on('#wbExport', 'click', exportSave); }
  }
  // ---------- JUNO fabrication helpers ----------
  let junoNote = null, typeTimer = null;
  const GOALS = { weapon: [['dmg', 'Max damage'], ['range', 'Long range'], ['crowd', 'Crowd control'], ['cool', 'Cool & steady']], suit: [['tank', 'Tank'], ['speed', 'Speed'], ['endurance', 'Endurance'], ['balanced', 'Balanced']] };
  function tabGreeting() {
    const g = {
      weapon: ['Weapons bench. Pick parts and I will run the numbers, or ask me for a design.', 'What are we building today, Rhea? I have opinions.'],
      suit: ['Suit fabrication. Plating, thrusters, reactor and helmet. Paint is your call.', 'Let us make you harder to hit. Or faster. Ideally both.'],
      parts: ['Here is everything in storage. Parts inside your builds are not counted, they are busy.'],
      upg: ['Suit upgrades. Spend Tech Points and they apply to every suit you build.', 'Tech Points come from missions, raids, crates and race medals. Spend them here.'],
      travel: ['Every workbench you have found is linked. Pick one and I will plot it.'],
      ask: ['Ask me where to find any part. I keep very good records.'],
      save: ['I back up automatically after missions, but a manual save never hurt anyone.'],
    }[benchTab] || ['Ready.'];
    return g[(Math.random() * g.length) | 0];
  }
  function typeJuno(text) {
    const el = $('junoText'); if (!el) return;
    clearInterval(typeTimer); let i = 0; el.textContent = '';
    typeTimer = setInterval(() => { i += 2; el.textContent = text.slice(0, i); if (i >= text.length) clearInterval(typeTimer); }, 16);
    clearTimeout(typeJuno.sp); typeJuno.sp = setTimeout(() => JUNO.speak(text), 350);
  }
  function weaponScore(w, goal) {
    const hps = w.heat * w.rate, sustain = Math.min(1, (w.cool * 1.2) / Math.max(hps, 1)), eff = w.dps * (0.4 + 0.6 * sustain);
    if (goal === 'dmg') return eff + w.explode * 3;
    if (goal === 'range') return eff * 0.4 + w.speed * 0.15 + (1 - Math.min(1, w.spread * 6)) * 80 + w.pierce * 20;
    if (goal === 'crowd') return eff * 0.5 + w.explode * 12 + w.chain * 25 + w.pierce * 10 + (w.count - 1) * 8 + w.homing * 8;
    return eff * 0.5 + sustain * 150 - hps * 0.3;
  }
  function suitScore(t, goal) {
    if (goal === 'tank') return t.hp + t.armor * 3;
    if (goal === 'speed') return t.boost + t.speed * 2 - t.armor * 0.2;
    if (goal === 'endurance') return t.energy + t.regen * 4 + t.coolBonus * 60 + t.boost * 0.1 - t.boostCost * 3;
    return t.hp * 0.5 + t.armor + t.boost * 0.3 + t.energy * 0.3 + t.regen;
  }
  function suggest(kind, goal) {
    const slots = D.SLOTS[kind], opts = slots.map((sl) => D.PARTS.filter((p) => p.slot === sl && availFor(kind, p.id) > 0).map((p) => p.id));
    if (opts.some((o) => !o.length)) return null;
    let best = null, bs = -Infinity; const cur = {};
    const rec = (i) => {
      if (i === slots.length) {
        const need = {}; for (const k in cur) need[cur[k]] = (need[cur[k]] || 0) + 1;
        for (const id in need) if (need[id] > availFor(kind, id)) return;
        const b = { parts: cur };
        const sc = kind === 'weapon' ? weaponScore(G.computeWeapon(b), goal) : suitScore(G.computeSuit(b), goal);
        if (sc > bs) { bs = sc; best = Object.assign({}, cur); } return;
      }
      for (const id of opts[i]) { cur[slots[i]] = id; rec(i + 1); }
    };
    rec(0); return best;
  }
  function advice(kind, d) {
    const ok = canBuild(kind); if (!ok.ok) return 'We are short on parts. ' + ok.msg.replace('Not enough parts: ', '') + '. Salvage crates and Syndicate gear are your best bet.';
    const notes = [];
    if (kind === 'weapon') {
      const w = G.computeWeapon(d), cur = G.player.w[0], hps = w.heat * w.rate;
      const dd = Math.round((w.dps / Math.max(1, cur.dps) - 1) * 100);
      if (Math.abs(dd) >= 10) notes.push(dd > 0 ? `That is ${dd}% more damage per second than your current primary.` : `About ${-dd}% less damage per second than your primary, so make the trade worth it.`);
      if (hps > 90) notes.push('Heat output is brutal. Fire in bursts or fit better cooling.');
      if (w.explode) notes.push('Explosive rounds, so keep some distance.');
      if (w.homing >= 2) notes.push('The seekers will do half the aiming for you.');
      if (w.pierce) notes.push(`Punches through ${w.pierce} targets. Line them up.`);
      if (w.chain) notes.push(`Arcs jump to ${w.chain} extra targets. Crowds will hate this.`);
      if (w.count >= 5) notes.push('Wide spread. Get close.');
      if (w.speed > 600 && w.spread < 0.01) notes.push('Fast and precise. A proper long-range build.');
      if (w.slow) notes.push('Cryo slows anything you hit by half.');
    } else {
      const t = G.computeSuit(d), cur = G.player.suit;
      if (t.armor >= 40) notes.push('Very tanky' + (t.boost < cur.boost ? ', though you will feel slower.' : '.'));
      if (t.boost >= 230) notes.push('That boost will rattle windows.');
      if (t.energy >= 200) notes.push('Huge energy reserve. Boost all day.');
      if (t.regen >= 34) notes.push('Fast reactor regen and better weapon cooling.');
      if (t.hp > cur.hp) notes.push(`+${t.hp - cur.hp} max armor over what you are wearing.`);
      if (t.scan > 1.2) notes.push('The helmet scanner will spot crates from further away.');
    }
    return notes.slice(0, 2).join(' ') || 'Solid, no surprises. I approve.';
  }
  function fabricate(kind) {
    if (!canBuild(kind).ok) return;
    const d = draft[kind]; d.name = ($('fName').value || 'Unnamed').slice(0, 28);
    const ov = document.createElement('div'); ov.className = 'fab';
    const steps = D.SLOTS[kind].map((sl) => sl.toUpperCase() + ' · ' + PART[d.parts[sl]].name);
    ov.innerHTML = `<div class="fab-box"><div class="fab-h">FABRICATING · ${esc(d.name)}</div><div class="fab-bar"><i></i></div><pre></pre></div>`;
    document.querySelector('.bench').appendChild(ov);
    const pre = ov.querySelector('pre'), bar = ov.querySelector('.fab-bar i'); let i = 0;
    typeJuno(pick2(['Spinning up the fabricator.', 'Printing. Do not touch anything hot.', 'On it. This is my favourite part.']));
    const tick = () => {
      if (i < steps.length) { pre.textContent += '✓ ' + steps[i++] + '\n'; bar.style.width = (i / steps.length) * 100 + '%'; G.sfx('ui'); setTimeout(tick, 230); }
      else setTimeout(() => { doBuild(kind); junoNote = pick2(['Done. Take it for a spin.', 'Fresh off the line. It is still warm.', 'Built and equipped-ready. Go break something. Something Syndicate.']); renderBench(); }, 300);
    };
    tick();
  }
  const pick2 = (a) => a[(Math.random() * a.length) | 0];
  function statRows(kind, b) {
    if (kind === 'weapon') {
      const w = G.computeWeapon(b);
      const bar = (label, v, max, txt) => `<div class="stat"><span>${label}</span><div class="sbar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div><b>${txt}</b></div>`;
      const traits = [];
      if (w.explode) traits.push('Explosive ' + w.explode.toFixed(0) + 'm'); if (w.homing) traits.push('Homing'); if (w.pierce) traits.push('Pierce ×' + w.pierce);
      if (w.chain) traits.push('Chain ×' + w.chain); if (w.slow) traits.push('Cryo slow'); if (w.count > 1) traits.push(w.count + ' shots');
      return bar('Damage', w.dmg, 180, w.dmg.toFixed(0)) + bar('Fire rate', w.rate, 25, w.rate.toFixed(1) + '/s') + bar('DPS', w.dps, 250, w.dps.toFixed(0)) +
        bar('Velocity', w.speed, 1100, w.speed.toFixed(0)) + bar('Accuracy', 1 - Math.min(1, w.spread * 6), 1, (100 - Math.min(100, w.spread * 600)).toFixed(0) + '%') +
        bar('Heat / shot', w.heat, 45, w.heat.toFixed(1)) + bar('Heat / sec', w.heat * w.rate, 120, (w.heat * w.rate).toFixed(0)) +
        `<div class="traits">${traits.map((t) => `<span>${t}</span>`).join('') || '<span class="dim">No special traits</span>'}</div>`;
    }
    const s = G.computeSuit(b);
    const bar = (label, v, max, txt) => `<div class="stat"><span>${label}</span><div class="sbar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div><b>${txt}</b></div>`;
    return bar('Health', s.hp, 200, s.hp) + bar('Armor', s.armor, 50, s.armor) + bar('Hover speed', s.speed, 70, s.speed.toFixed(0)) + bar('Boost speed', s.boost, 300, s.boost.toFixed(0)) +
      bar('Boost cost', s.boostCost, 30, s.boostCost + '/s') + bar('Energy', s.energy, 240, s.energy) + bar('Regen', s.regen, 45, s.regen + '/s') + bar('Weapon cooling', s.coolBonus, 1.8, '×' + s.coolBonus) + bar('Scanner', s.scan, 1.8, '×' + s.scan);
  }
  function buildTab(kind) {
    const list = kind === 'weapon' ? G.state.weapons : G.state.suits;
    const eq = G.state.equip;
    if (!draft[kind]) draft[kind] = blankDraft(kind);
    const d = draft[kind];
    const items = list.map((b) => {
      const tags = kind === 'weapon' ? (eq.primary === b.id ? '<em>PRIMARY</em>' : eq.secondary === b.id ? '<em>SECONDARY</em>' : '') : eq.suit === b.id ? '<em>EQUIPPED</em>' : '';
      const sub = kind === 'weapon' ? PART[b.parts.emitter].name + ' · ' + G.computeWeapon(b).dps.toFixed(0) + ' dps' : PART[b.parts.plating].name + ' · ' + PART[b.parts.thruster].name;
      const sw = kind === 'weapon' ? `<i class="sw" style="background:${esc(b.color)}"></i>` : `<i class="sw" style="background:linear-gradient(90deg,${esc(b.c1)} 50%,${esc(b.c2)} 50%)"></i>`;
      return `<div class="build ${editing[kind] === b.id ? 'editing' : ''}">${sw}<div class="bi"><b>${esc(b.name)}</b> ${tags}<br><small>${esc(sub)}</small></div>
        <div class="bb">${kind === 'weapon' ? `<button data-eq="primary" data-id="${b.id}">Primary</button><button data-eq="secondary" data-id="${b.id}">Secondary</button>` : `<button data-eq="suit" data-id="${b.id}">Equip</button>`}
        <button data-edit="${b.id}">Edit</button><button class="danger" data-dis="${b.id}">Dismantle</button></div></div>`;
    }).join('');
    const selects = D.SLOTS[kind].map((slot) => {
      const opts = D.PARTS.filter((p) => p.slot === slot).map((p) => {
        const n = availFor(kind, p.id);
        return `<option value="${p.id}" ${d.parts[slot] === p.id ? 'selected' : ''} ${n <= 0 && d.parts[slot] !== p.id ? 'disabled' : ''}>${p.name} (×${n})</option>`;
      }).join('');
      const cur = PART[d.parts[slot]];
      return `<label class="slotsel"><span>${slot}</span><select data-slot="${slot}">${opts}</select><small>${esc(cur.desc)}</small></label>`;
    }).join('');
    const colors = kind === 'weapon' ? `<label class="slotsel"><span>energy color</span><input type="color" id="fColor" value="${esc(d.color)}"></label>`
      : `<label class="slotsel"><span>primary paint</span><input type="color" id="fC1" value="${esc(d.c1)}"></label><label class="slotsel"><span>accent paint</span><input type="color" id="fC2" value="${esc(d.c2)}"></label>`;
    const ok = canBuild(kind);
    return `<div class="build-grid">
      <div class="col"><h3>Your ${kind === 'weapon' ? 'weapons' : 'suits'}</h3>${items}</div>
      <div class="col"><h3>${editing[kind] ? 'Editing build' : 'New build'}</h3>
        <div class="ask-juno"><span>Ask JUNO to design:</span>${GOALS[kind].map((g) => `<button data-goal="${g[0]}">${g[1]}</button>`).join('')}</div>
        <label class="slotsel"><span>name</span><input id="fName" maxlength="28" value="${esc(d.name)}"></label>
        ${selects}${colors}
        <div class="btns row"><button id="fBuild" class="primary" ${ok.ok ? '' : 'disabled'}>${editing[kind] ? 'Save changes' : 'Build'}</button>${editing[kind] ? '<button id="fCancel">Cancel edit</button>' : '<button id="fReset">Reset</button>'}</div>
        ${ok.ok ? '' : `<p class="warn">${esc(ok.msg)}</p>`}
      </div>
      <div class="col"><h3>Stats</h3>${kind === 'suit' ? '<canvas id="suitPrev" width="220" height="230"></canvas>' : ''}${statRows(kind, d)}</div></div>`;
  }
  function canBuild(kind) {
    const d = draft[kind], need = {};
    Object.values(d.parts).forEach((id) => (need[id] = (need[id] || 0) + 1));
    for (const id in need) if (need[id] > availFor(kind, id)) return { ok: false, msg: 'Not enough parts: ' + PART[id].name + ' (need ' + need[id] + ', have ' + availFor(kind, id) + ')' };
    return { ok: true };
  }
  function wireBuild(kind) {
    const d = draft[kind];
    on('[data-slot]', 'change', (e) => { d.parts[e.target.dataset.slot] = e.target.value; d.name = $('fName').value; junoNote = advice(kind, d); renderBench(); });
    on('#fName', 'input', (e) => (d.name = e.target.value));
    on('#fColor', 'input', (e) => (d.color = e.target.value));
    on('#fC1', 'input', (e) => { d.c1 = e.target.value; prevModel(); });
    on('#fC2', 'input', (e) => { d.c2 = e.target.value; prevModel(); });
    on('#fReset', 'click', () => { draft[kind] = blankDraft(kind); renderBench(); });
    on('#fCancel', 'click', () => { editing[kind] = null; draft[kind] = blankDraft(kind); renderBench(); });
    on('#fBuild', 'click', () => fabricate(kind));
    on('[data-goal]', 'click', (e) => {
      const g = e.target.dataset.goal, best = suggest(kind, g), label = GOALS[kind].find((x) => x[0] === g)[1];
      if (!best) { junoNote = 'I can\'t make that work with the parts we have. Go find more salvage and I\'ll try again.'; renderBench(); return; }
      draft[kind].parts = best; draft[kind].name = 'JUNO ' + label + (kind === 'weapon' ? ' Mk ' : ' ') + (((kind === 'weapon' ? G.state.weapons : G.state.suits).length) + 1);
      if (kind === 'weapon') draft[kind].color = { dmg: '#ff6a3a', range: '#9fd8ff', crowd: '#c77dff', cool: '#5fe3ff' }[g];
      junoNote = 'Here is my best ' + label.toLowerCase() + ' design from what you own. ' + advice(kind, draft[kind]);
      G.sfx('pick'); renderBench();
    });
    on('[data-eq]', 'click', (e) => {
      const slot = e.target.dataset.eq, id = e.target.dataset.id, eq = G.state.equip;
      if (slot === 'primary' && eq.secondary === id) eq.secondary = eq.primary;
      if (slot === 'secondary' && eq.primary === id) eq.primary = eq.secondary;
      eq[slot] = id; G.refreshLoadout(); G.sfx('ui'); UI.toast('Equipped ' + findBuild(kind, id).name, 'info'); junoNote = pick2(['Equipped. ', 'Swapped in. ']) + advice(kind, findBuild(kind, id)); renderBench();
    });
    on('[data-edit]', 'click', (e) => { const b = findBuild(kind, e.target.dataset.edit); editing[kind] = b.id; draft[kind] = JSON.parse(JSON.stringify(b)); renderBench(); });
    on('[data-dis]', 'click', (e) => {
      const id = e.target.dataset.dis, eq = G.state.equip;
      if (eq.primary === id || eq.secondary === id || eq.suit === id) { UI.toast('Unequip it first: equip another build in its place', 'bad'); return; }
      const b = findBuild(kind, id);
      ask('Dismantle "' + b.name + '"? Its parts go back into your inventory.', () => {
        Object.values(b.parts).forEach((p) => G.addPart(p, 1, true));
        const list = kind === 'weapon' ? G.state.weapons : G.state.suits; list.splice(list.indexOf(b), 1);
        if (editing[kind] === id) { editing[kind] = null; draft[kind] = blankDraft(kind); }
        UI.toast('Dismantled ' + b.name, 'info'); renderBench();
      });
    });
    if (kind === 'suit') prevModel();
  }
  function doBuild(kind) {
    const d = draft[kind]; d.name = ($('fName').value || 'Unnamed').slice(0, 28);
    if (!canBuild(kind).ok) return;
    const inv = G.state.inventory, list = kind === 'weapon' ? G.state.weapons : G.state.suits;
    let b = editing[kind] && findBuild(kind, editing[kind]);
    if (b) Object.values(b.parts).forEach((p) => (inv[p] = (inv[p] || 0) + 1));
    Object.values(d.parts).forEach((p) => (inv[p] -= 1));
    if (b) Object.assign(b, JSON.parse(JSON.stringify(d)), { id: b.id });
    else { b = Object.assign(JSON.parse(JSON.stringify(d)), { id: kind[0] + '_' + Date.now().toString(36) }); list.push(b); }
    UI.toast((editing[kind] ? 'Updated ' : 'Built ') + b.name, 'part');
    if (kind === 'weapon') G.notifyCraft(); else G.state.stats.crafted++;
    editing[kind] = null; draft[kind] = blankDraft(kind);
    G.refreshLoadout(); G.sfx('pick'); renderBench();
  }
  function prevModel() {
    const cv = $('suitPrev'); if (!cv) return;
    if (!prev) {
      prev = { r: new THREE.WebGLRenderer({ alpha: true, antialias: true }), scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(35, 220 / 230, 0.1, 50) };
      prev.r.setSize(220, 230); prev.scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x553344, 1)); const l = new THREE.DirectionalLight(0xffffff, 0.8); l.position.set(2, 3, -3); prev.scene.add(l);
      prev.cam.position.set(0, 1.5, -6.5); prev.cam.lookAt(0, 1.2, 0);
    }
    const d = draft.suit;
    if (prev.model) prev.scene.remove(prev.model.root);
    prev.model = G.makeSuitModel(d.c1, d.c2, PART[d.parts.helmet].s.style);
    prev.model.flames.forEach((f) => (f.visible = false));
    prev.scene.add(prev.model.root);
    cv.replaceWith(prev.r.domElement); prev.r.domElement.id = 'suitPrev';
  }
  function partsTab() {
    const groups = D.SLOTS.weapon.concat(D.SLOTS.suit);
    return '<div class="parts">' + groups.map((s) => `<div class="pgroup"><h3>${s}</h3>${D.PARTS.filter((p) => p.slot === s).map((p) =>
      `<div class="part t${p.tier} ${owned(p.id) ? '' : 'none'}"><b>${esc(p.name)}</b><span class="cnt">×${owned(p.id)}</span><br><small>Tier ${p.tier} · ${esc(p.desc)}</small></div>`).join('')}</div>`).join('') +
      '</div><p class="fine pad">Counts are spare parts. Parts in your builds are not counted here. Find more from enemies, salvage crates (rooftops), stopping crimes and story missions.</p>';
  }
  function upgTab() {
    const t = G.state.tech;
    const rows = D.UPGRADES.map((u) => {
      const l = G.upgradeLevel(u.id), c = G.upgradeCost(u.id);
      const pips = [0, 1, 2].map((i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('');
      return `<div class="upg"><div class="uh"><b>${esc(u.name)}</b><span class="pips">${pips}</span></div><small>${esc(u.desc)}</small>
        <button data-upg="${u.id}" ${c == null || t.pts < c ? 'disabled' : ''}>${c == null ? 'MAXED' : 'Upgrade · ' + c + ' TP'}</button></div>`;
    }).join('');
    const medal = ['No medal', 'Bronze', 'Silver', 'Gold'];
    const races = G.RACES.map((r) => {
      const rec = G.state.races[r.id] || {}, open = G.state.missionIndex >= r.unlock;
      const info = open ? (rec.best ? 'Best ' + G.fmtRace(rec.best) + ' · ' + medal[rec.medal | 0] : 'Not raced yet') + ' · Gold ' + G.fmtRace(r.medals[0]) + ' / Silver ' + G.fmtRace(r.medals[1]) + ' / Bronze ' + G.fmtRace(r.medals[2]) : 'Unlocks after mission ' + r.unlock;
      return `<div class="slot"><b>${open ? esc(r.name) : 'Locked race'}</b><span>${info}</span>${open ? `<button data-race="${r.id}">Mark start</button>` : ''}</div>`;
    }).join('');
    return `<div class="pad"><div class="tp">TECH POINTS <b>${t.pts}</b><small>${t.earned} earned in total</small></div>
      <p class="fine">Story missions +3 · raids stopped +1 · every 5 salvage crates +1 · race medals +1 bronze, +1 silver, +2 gold (first time each).</p>
      <div class="upgs">${rows}</div>
      <h3>Ring races</h3>${races}</div>`;
  }
  function travelTab() {
    return '<div class="pad">' + (G.mission.active ? '<p class="warn">Fast travel is disabled during missions.</p>' : '') + D.BENCHES.map((b) => {
      const known = G.state.benches.includes(b.id);
      return `<div class="slot"><b>${known ? esc(b.name) : 'Undiscovered workbench'}</b><span>${known ? '' : 'Explore to find it (look for blue light beams)'}</span>${known && b.id !== curBench.id ? `<button data-travel="${b.id}">Travel</button>` : ''}</div>`;
    }).join('') + '</div>';
  }

  // ---------- TOUCH CONTROLS ----------
  if (isTouch) {
    const t = G.input.touch, tc = $('touch');
    let stickId = null, sx = 0, sy = 0, lookId = null, lx = 0, ly = 0;
    const knob = $('knob'), stick = $('stick');
    tc.addEventListener('touchstart', (e) => {
      G.audioInit();
      for (const p of e.changedTouches) {
        const btn = p.target.closest && p.target.closest('[data-b]'); if (btn) continue;
        if (p.clientX < window.innerWidth * 0.4 && stickId === null) { stickId = p.identifier; sx = p.clientX; sy = p.clientY; stick.style.left = sx - 60 + 'px'; stick.style.top = sy - 60 + 'px'; stick.style.display = 'block'; }
        else if (lookId === null) { lookId = p.identifier; lx = p.clientX; ly = p.clientY; }
      }
    }, { passive: true });
    tc.addEventListener('touchmove', (e) => {
      for (const p of e.changedTouches) {
        if (p.identifier === stickId) { let dx = (p.clientX - sx) / 50, dy = (p.clientY - sy) / 50; const L = Math.hypot(dx, dy); if (L > 1) { dx /= L; dy /= L; } t.mx = dx; t.my = -dy; knob.style.transform = `translate(${dx * 40}px,${dy * 40}px)`; }
        if (p.identifier === lookId) { if (!modal) G.look((p.clientX - lx) * 2.2, (p.clientY - ly) * 2.2); lx = p.clientX; ly = p.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => { for (const p of e.changedTouches) { if (p.identifier === stickId) { stickId = null; t.mx = t.my = 0; stick.style.display = 'none'; knob.style.transform = ''; } if (p.identifier === lookId) lookId = null; } };
    tc.addEventListener('touchend', end); tc.addEventListener('touchcancel', end);
    tc.querySelectorAll('[data-b]').forEach((b) => {
      const k = b.dataset.b;
      const down = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('on');
        if (k === 'fire') G.input.fire[0] = true; else if (k === 'alt') G.input.fire[1] = true; else if (k === 'up') t.up = true; else if (k === 'down') t.down = true;
        else if (k === 'boost') t.boost = !t.boost; else if (k === 'lance') G.lance(); else if (k === 'use') { t.use = true; G.interact(); } else if (k === 'juno') UI.openJuno(); else if (k === 'map') openMap(); else if (k === 'pause') openPause();
        else if (k === 'shield') t.shield = true; else if (k === 'shock') G.shockwave(); else if (k === 'dash') G.dash(); };
      const up = (e) => { e.preventDefault(); if (k !== 'boost') b.classList.remove('on'); else b.classList.toggle('on', t.boost);
        if (k === 'fire') G.input.fire[0] = false; else if (k === 'alt') G.input.fire[1] = false; else if (k === 'up') t.up = false; else if (k === 'down') t.down = false; else if (k === 'shield') t.shield = false; else if (k === 'use') t.use = false; };
      b.addEventListener('touchstart', down, { passive: false }); b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
    });
  }

  // ---------- HUD per frame ----------
  // ---------- helmet HUD panels ----------
  let diagT = 0, questT = 0;
  const pct = (v) => Math.round(v * 100) + '%';
  const integColor = (v) => (v > 0.66 ? '#4dffa0' : v > 0.33 ? '#ffd040' : '#ff3355');
  function renderDiag() {
    const P = G.player, S = P.suit, I = P.integ;
    const sb = G.state.suits.find((x) => x.id === G.state.equip.suit) || G.state.suits[0];
    $('suitName').textContent = sb.name;
    ['head', 'torso', 'armL', 'armR', 'legL', 'legR'].forEach((k) => { const el = $('p-' + k); el.setAttribute('fill', integColor(I[k])); el.setAttribute('fill-opacity', (0.2 + 0.45 * I[k]).toFixed(2)); });
    const wb = (slot) => G.state.weapons.find((w) => w.id === G.state.equip[slot]) || { name: '-' };
    const legs = (I.legL + I.legR) / 2;
    const heatCol = (i) => (P.over[i] ? '#ff3355' : '#ffa030');
    const rows = [
      ['HELMET', PART[sb.parts.helmet].name, 'INTEGRITY ' + pct(I.head) + ' · SCAN ×' + S.scan, I.head, integColor(I.head)],
      ['PLATING', PART[sb.parts.plating].name, 'ARMOR ' + S.armor + ' · TORSO ' + pct(I.torso), P.hp / S.hp, integColor(Math.min(I.torso, P.hp / S.hp))],
      ['REACTOR', PART[sb.parts.reactor].name, 'ENERGY ' + Math.round(P.energy) + '/' + S.energy + ' · +' + S.regen + '/s', P.energy / S.energy, '#3fc8ff'],
      ['THRUSTERS', PART[sb.parts.thruster].name, (P.boosting ? 'BOOSTING · ' : 'TOP ' + Math.round(S.boost * 3.6) + ' KM/H · ') + 'LEGS ' + pct(legs) + (legs < 0.3 ? ' · SLOWED' : ''), legs, integColor(legs), legs < 0.3],
      ['R GAUNTLET', wb('primary').name, P.w[0].dps.toFixed(0) + ' DPS · HEAT ' + Math.round(P.heat[0]) + '%' + (P.over[0] ? ' · OVERHEAT' : '') + ' · ARM ' + pct(I.armR), P.heat[0] / 100, heatCol(0), P.over[0]],
      ['L GAUNTLET', wb('secondary').name, P.w[1].dps.toFixed(0) + ' DPS · HEAT ' + Math.round(P.heat[1]) + '%' + (P.over[1] ? ' · OVERHEAT' : '') + ' · ARM ' + pct(I.armL), P.heat[1] / 100, heatCol(1), P.over[1]],
      ['CORE LANCE', 'Chest beam · ' + P.lanceDmg + ' dmg', P.lanceCd > 0 ? 'RECHARGING ' + P.lanceCd.toFixed(1) + 's' : P.energy < P.lanceCost ? 'NEEDS ' + P.lanceCost + ' ENERGY' : 'READY · PRESS Q', P.lanceCd > 0 ? 1 - P.lanceCd / P.lanceMax : Math.min(1, P.energy / P.lanceCost), P.lanceCd <= 0 && P.energy >= P.lanceCost ? '#9ff6ff' : '#557'],
    ];
    $('partList').innerHTML = rows.map((r) => `<div class="prow ${r[5] ? 'warn' : ''}"><span class="pl">${r[0]}</span><span class="pn">${esc(r[1])}</span><span class="ps">${r[2]}</span><i class="pb"><b style="width:${Math.max(0, Math.min(1, r[3])) * 100}%;background:${r[4]}"></b></i></div>`).join('');
  }
  function renderQuest() {
    const M = G.mission, o = G.objective, n = D.MISSIONS.length;
    let kind, title, desc, steps;
    if (M.active) {
      const m = D.MISSIONS[M.idx];
      kind = (m.act === 2 ? 'ACT II · ' : 'MAIN QUEST · ') + (M.idx + 1) + '/' + n; title = m.title; desc = m.desc || '';
      steps = m.stages.map((st, i) => ({ t: st.text, s: i < M.stage ? 'done' : i === M.stage ? 'cur' : 'todo' }));
    } else if (G.race && G.race.active) {
      const r = G.race.def; kind = 'RING RACE'; title = r.name; desc = r.desc;
      const fr = G.fmtRace;
      steps = [{ t: G.race.count > 0 ? 'Get ready…' : 'Fly through the green rings', s: 'cur' }, { t: 'Gold ' + fr(r.medals[0]) + ' · Silver ' + fr(r.medals[1]) + ' · Bronze ' + fr(r.medals[2]), s: 'todo' }];
      const rec = G.state.races[r.id]; if (rec && rec.best) steps.push({ t: 'Personal best ' + fr(rec.best), s: 'todo' });
    } else if (G.crime.active) {
      kind = 'CRIME IN PROGRESS'; title = 'Syndicate Raid'; desc = 'Syndicate jet-troopers are shaking down a city block. Take them out before they get away.';
      steps = [{ t: 'Destroy the raiders', s: 'cur' }];
    } else if (G.state.missionIndex < n) {
      const m = D.MISSIONS[G.state.missionIndex];
      kind = 'NEXT QUEST · ' + (G.state.missionIndex + 1) + '/' + n; title = m.title; desc = m.desc || '';
      steps = [{ t: 'Fly into the yellow beacon to begin', s: 'cur' }];
    } else {
      kind = 'FREE ROAM'; title = 'Port Halcyon'; desc = 'The Syndicate is broken, but crime never sleeps. Stop raids, find salvage and build the ultimate suit.';
      const c = G.state.crates.length, cn = G.crates.length, b = G.state.benches.length;
      const golds = G.RACES.filter((r) => (G.state.races[r.id] || {}).medal === 3).length;
      steps = [{ t: 'Salvage crates ' + c + '/' + cn, s: c >= cn ? 'done' : 'cur' }, { t: 'Workbenches found ' + b + '/' + D.BENCHES.length, s: b >= D.BENCHES.length ? 'done' : 'cur' }, { t: 'Race golds ' + golds + '/' + G.RACES.length, s: golds >= G.RACES.length ? 'done' : 'cur' }, { t: 'Crimes stopped: ' + G.state.stats.crimes + ' · Tech Points ' + G.state.tech.pts, s: 'todo' }];
    }
    $('qKind').textContent = kind; $('qTitle').textContent = title; $('qDesc').textContent = desc;
    $('qSteps').innerHTML = steps.map((st) => `<li class="${st.s}">${esc(st.t)}${st.s === 'cur' && o.sub ? '<small>' + esc(o.sub) + '</small>' : ''}</li>`).join('');
    const mt = o.meter, qm = $('qMeter');
    if (mt) { qm.style.display = 'block'; qm.className = mt.warn ? 'warn' : ''; qm.innerHTML = `<span>${esc(mt.label)}</span><i><b style="width:${Math.round(mt.v * 100)}%"></b></i>`; } else qm.style.display = 'none';
  }
  const cc = $('compass'), cgx = cc.getContext('2d');
  function drawCompass() {
    const W = cc.width, H = cc.height, P = G.player, ppd = 3.2;
    const head = (((-P.yaw * 180) / Math.PI) % 360 + 360) % 360;
    cgx.clearRect(0, 0, W, H);
    const grd = cgx.createLinearGradient(0, 0, W, 0); grd.addColorStop(0, 'rgba(4,18,32,0)'); grd.addColorStop(0.5, 'rgba(4,18,32,.55)'); grd.addColorStop(1, 'rgba(4,18,32,0)');
    cgx.fillStyle = grd; cgx.fillRect(0, 0, W, 24);
    cgx.textAlign = 'center'; cgx.font = 'bold 11px system-ui';
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    const start = Math.floor((head - 70) / 5) * 5;
    for (let a = start; a <= head + 70; a += 5) {
      const x = W / 2 + (a - head) * ppd, an = ((a % 360) + 360) % 360, fade = 1 - Math.abs(a - head) / 72;
      cgx.globalAlpha = Math.max(0, fade);
      if (names[an] !== undefined) { cgx.fillStyle = an === 0 ? '#ffd040' : '#cfefff'; cgx.fillText(names[an], x, 13); }
      else { cgx.fillStyle = '#6fe6ff'; cgx.fillRect(x - 0.5, an % 15 === 0 ? 14 : 17, 1, an % 15 === 0 ? 8 : 5); }
    }
    cgx.globalAlpha = 1;
    const wp = G.objective.wp;
    if (wp) {
      const brg = (Math.atan2(wp.x - P.pos.x, -(wp.z - P.pos.z)) * 180) / Math.PI;
      const rel = ((brg - head + 540) % 360) - 180, x = W / 2 + Math.max(-70, Math.min(70, rel)) * ppd;
      cgx.fillStyle = '#ffd040'; cgx.beginPath(); cgx.moveTo(x, 22); cgx.lineTo(x + 5, 28); cgx.lineTo(x, 34); cgx.lineTo(x - 5, 28); cgx.closePath(); cgx.fill();
    }
    cgx.fillStyle = '#fff'; cgx.fillRect(W / 2 - 0.75, 0, 1.5, 24);
    cgx.font = 'bold 10px system-ui'; cgx.fillStyle = '#9ff6ff'; cgx.fillText(Math.round(head) + '°', W / 2, H - 1);
  }

  // ---------- AEGIS targeting overlay (canvas): reticle, horizon ladder, target lock, threat arrows, hit direction ----------
  const fx = $('hudfx'), fg = fx.getContext('2d');
  const ENAME = { trooper: 'SYNDICATE JET-TROOPER', turret: 'HEAVY GUNNER', truck: 'ARMORED TRANSPORT', jammer: 'JAMMER TOWER', gunship: 'SYNDICATE GUNSHIP', colossus: 'COBALT COLOSSUS', drone: 'DRONE' };
  const THREAT = { trooper: 1, turret: 2, truck: 1, jammer: 2, gunship: 3, colossus: 3, drone: 0 };
  function sizeFx() { const d = Math.min(window.devicePixelRatio || 1, 2); fx.width = innerWidth * d; fx.height = innerHeight * d; fg.setTransform(d, 0, 0, d, 0, 0); }
  window.addEventListener('resize', sizeFx); sizeFx();
  let scanT = 0, lastLock = null;
  function arcSeg(cx, cy, r, a0, a1, col, w) { fg.strokeStyle = col; fg.lineWidth = w; fg.beginPath(); fg.arc(cx, cy, r, a0, a1); fg.stroke(); }
  function drawFx(dt) {
    const W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2, P = G.player, now = performance.now();
    fg.clearRect(0, 0, W, H);
    if (modal || P.dead) return;
    fg.lineCap = 'round'; fg.font = '10px ui-monospace, Menlo, Consolas, monospace'; fg.textBaseline = 'middle';
    const fp = G.settings.fp, vfx = G.settings.visorFx == null ? 2 : G.settings.visorFx;
    if (G.junoWp) {
      const pr = G.project(G.junoWp), dd = Math.round(G.junoWp.distanceTo(P.pos));
      let x = pr.x, y = pr.y; if (pr.behind) { x = W - x; y = H - 60; } x = Math.max(40, Math.min(W - 40, x)); y = Math.max(70, Math.min(H - 60, y));
      fg.save(); fg.translate(x, y); fg.rotate(Math.PI / 4); fg.strokeStyle = '#3fe0ff'; fg.lineWidth = 2.5; fg.shadowColor = '#3fe0ff'; fg.shadowBlur = 8; fg.strokeRect(-8, -8, 16, 16); fg.restore();
      fg.textAlign = 'center'; fg.fillStyle = '#9ff6ff'; fg.fillText('JUNO · ' + dd + 'm', x, y + 20);
    }
    // horizon ladder
    if (fp && !P.grounded && vfx === 2) {
      const fov = G.camera.fov, ppd = H / fov, pd = P.pitch * 180 / Math.PI, roll = G.camRoll || 0;
      fg.save(); fg.translate(cx, cy); fg.rotate(-roll);
      for (let d = Math.ceil((pd - 22) / 10) * 10; d <= pd + 22; d += 10) {
        const y = (pd - d) * ppd, a = 0.55 * (1 - Math.abs(d - pd) / 24); if (a <= 0) continue;
        fg.strokeStyle = 'rgba(120,230,255,' + a + ')'; fg.lineWidth = 1;
        const w = d === 0 ? 150 : 70, gap = 60;
        fg.beginPath(); fg.moveTo(-gap - w, y); fg.lineTo(-gap, y); fg.moveTo(gap, y); fg.lineTo(gap + w, y);
        if (d !== 0) { const t = d > 0 ? 6 : -6; fg.moveTo(-gap - w, y); fg.lineTo(-gap - w, y + t); fg.moveTo(gap + w, y); fg.lineTo(gap + w, y + t); }
        fg.stroke();
        if (d !== 0) { fg.fillStyle = 'rgba(160,240,255,' + a + ')'; fg.textAlign = 'right'; fg.fillText(String(d), -gap - w - 6, y); }
      }
      fg.restore();
    }
    // reticle: heat arcs (right = primary, left = secondary), lance ring, centre pip
    const h0 = P.heat[0] / 100, h1 = P.heat[1] / 100, hot = (v, o) => (o ? '#ff3355' : v > 0.7 ? '#ffa030' : 'rgba(160,240,255,.9)');
    arcSeg(cx, cy, 24, -0.9, 0.9, 'rgba(160,240,255,.18)', 2); arcSeg(cx, cy, 24, Math.PI - 0.9, Math.PI + 0.9, 'rgba(160,240,255,.18)', 2);
    if (h0 > 0.01) arcSeg(cx, cy, 24, 0.9 - 1.8 * h0, 0.9, hot(h0, P.over[0]), 2.5);
    if (h1 > 0.01) arcSeg(cx, cy, 24, Math.PI - 0.9 + (1 - h1) * 1.8 * 0, Math.PI - 0.9 + 1.8 * h1, hot(h1, P.over[1]), 2.5);
    const lanceK = P.lanceCd > 0 ? 1 - P.lanceCd / 3 : Math.min(1, P.energy / 50);
    arcSeg(cx, cy, 31, -Math.PI / 2, -Math.PI / 2 + lanceK * Math.PI * 2, lanceK >= 1 && P.lanceCd <= 0 ? 'rgba(160,240,255,.55)' : 'rgba(160,240,255,.18)', 1);
    const tk = G.aimTarget ? '#ff3355' : 'rgba(200,250,255,.95)';
    fg.fillStyle = tk; fg.beginPath(); fg.arc(cx, cy, 1.8, 0, 7); fg.fill();
    fg.strokeStyle = tk; fg.lineWidth = 1.5; fg.beginPath();
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([x, y]) => { fg.moveTo(cx + x * 8, cy + y * 8); fg.lineTo(cx + x * 15, cy + y * 15); }); fg.stroke();
    if (G.hitMarker > 0) { fg.strokeStyle = '#fff'; fg.lineWidth = 2; fg.beginPath(); [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([x, y]) => { fg.moveTo(cx + x * 10, cy + y * 10); fg.lineTo(cx + x * 17, cy + y * 17); }); fg.stroke(); }
    // targets
    const lock = G.aimTarget && G.aimTarget.alive ? G.aimTarget : null;
    if (lock !== lastLock) { scanT = 0; lastLock = lock; if (lock) G.sfx('ui'); }
    scanT += dt;
    if (vfx > 0) G.enemies.forEach((e) => {
      if (!e.alive) return;
      const c = e.pos.clone(); c.y += e.hc; const dist = c.distanceTo(P.pos);
      if (dist > 450) return;
      const pr = G.project(c), on = !pr.behind && pr.x > 0 && pr.x < W && pr.y > 0 && pr.y < H;
      const col = e.passive ? 'rgba(160,240,255,.8)' : 'rgba(255,60,90,.9)';
      if (on) {
        const sz = Math.max(10, Math.min(110, (e.r * 1.4 * H) / (dist * 1.1 + 1)));
        const isLock = e === lock;
        fg.strokeStyle = isLock ? '#ffd040' : col; fg.lineWidth = isLock ? 2 : 1.3;
        const k = sz * 0.35; fg.beginPath();
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => { const x = pr.x + sx * sz, y = pr.y + sy * sz; fg.moveTo(x, y - sy * k); fg.lineTo(x, y); fg.lineTo(x - sx * k, y); });
        fg.stroke();
        if (isLock) {
          const a = now / 600, r = sz + 8; fg.save(); fg.translate(pr.x, pr.y); fg.rotate(a);
          fg.strokeStyle = 'rgba(255,208,64,.85)'; fg.lineWidth = 1.2; fg.beginPath();
          for (let i = 0; i < 4; i++) { const b = (i * Math.PI) / 2; fg.moveTo(Math.cos(b - 0.3) * r, Math.sin(b - 0.3) * r); fg.arc(0, 0, r, b - 0.3, b + 0.3); }
          fg.stroke(); fg.restore();
          // scan readout panel
          const tx = pr.x + sz + 18, ty = pr.y - sz, prog = Math.min(1, scanT / 0.5);
          fg.strokeStyle = 'rgba(255,208,64,.6)'; fg.lineWidth = 1; fg.beginPath(); fg.moveTo(pr.x + sz, pr.y - sz); fg.lineTo(tx - 4, ty); fg.lineTo(tx + 150 * prog, ty); fg.stroke();
          if (prog >= 1) {
            fg.textAlign = 'left'; fg.fillStyle = '#ffd040'; fg.fillText(ENAME[e.type] || e.type.toUpperCase(), tx, ty + 10);
            fg.fillStyle = 'rgba(200,245,255,.9)'; fg.fillText('RANGE ' + Math.round(dist) + 'm   HP ' + Math.max(0, Math.ceil(e.hp)), tx, ty + 23);
            const th = THREAT[e.type] || 1; fg.fillText('THREAT ' + '▮'.repeat(th) + '▯'.repeat(3 - th), tx, ty + 36);
            fg.fillStyle = 'rgba(255,255,255,.12)'; fg.fillRect(tx, ty + 46, 120, 3); fg.fillStyle = '#ff3355'; fg.fillRect(tx, ty + 46, 120 * Math.max(0, e.hp / e.maxHp), 3);
          } else { fg.textAlign = 'left'; fg.fillStyle = 'rgba(255,208,64,.8)'; fg.fillText('SCANNING' + '.'.repeat(1 + ((now / 150) | 0) % 3), tx, ty + 10); }
        } else if (dist < 180) {
          fg.textAlign = 'center'; fg.fillStyle = col; fg.fillText(Math.round(dist) + 'm', pr.x, pr.y + sz + 10);
          if (e.hp < e.maxHp) { fg.fillStyle = 'rgba(255,255,255,.15)'; fg.fillRect(pr.x - sz, pr.y - sz - 6, sz * 2, 2); fg.fillStyle = col; fg.fillRect(pr.x - sz, pr.y - sz - 6, sz * 2 * Math.max(0, e.hp / e.maxHp), 2); }
        }
      } else if (dist < 260 && !e.passive) {
        // off-screen threat arrow on an ellipse around the reticle
        let dx = pr.x - cx, dy = pr.y - cy; if (pr.behind) { dx = -dx; dy = -dy; if (Math.abs(dy) < 1) dy = 1; }
        const ang = Math.atan2(dy, dx), rx = W * 0.36, ry = H * 0.34;
        const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
        fg.save(); fg.translate(x, y); fg.rotate(ang); fg.fillStyle = 'rgba(255,60,90,' + (0.4 + 0.5 * (1 - dist / 260)) + ')';
        fg.beginPath(); fg.moveTo(12, 0); fg.lineTo(-6, -8); fg.lineTo(-2, 0); fg.lineTo(-6, 8); fg.closePath(); fg.fill(); fg.restore();
      }
    });
    // damage direction arcs
    const head = -P.yaw;
    G.hitDirs.forEach((h) => {
      const age = (now - h.t) / 1000; if (age > 1.2) return;
      const brg = Math.atan2(h.x - P.pos.x, -(h.z - P.pos.z));
      const rel = brg - head - Math.PI / 2;
      fg.strokeStyle = 'rgba(255,40,70,' + (1 - age / 1.2) * 0.9 + ')'; fg.lineWidth = 5;
      fg.beginPath(); fg.arc(cx, cy, 120, rel - 0.32, rel + 0.32); fg.stroke();
    });
  }
  function applyVfx() {
    const v = G.settings.visorFx == null ? 2 : G.settings.visorFx;
    document.body.classList.toggle('vfx-lo', v === 1); document.body.classList.toggle('vfx-off', v === 0);
    const c = $('vfxChip'); if (c) c.innerHTML = 'VISOR FX <b>' + ['OFF', 'LO', 'HI'][v] + '</b> <small>[X]</small>';
  }
  applyVfx();
  // weapon selector bar
  let wbarKey = '', clockT = 0;
  function renderWbar() {
    const eq = G.state.equip, P = G.player;
    const key = G.state.weapons.map((w) => w.id).join() + eq.primary + eq.secondary + P.over.join() + Math.round(P.heat[0] / 10) + Math.round(P.heat[1] / 10);
    if (key === wbarKey) return; wbarKey = key;
    $('wbar').innerHTML = G.state.weapons.slice(0, 9).map((w, i) => {
      const pr = w.id === eq.primary, se = w.id === eq.secondary, ht = pr ? P.heat[0] : se ? P.heat[1] : 0, ov = pr ? P.over[0] : se ? P.over[1] : false;
      return `<div class="ws ${pr ? 'p' : ''} ${se ? 's' : ''} ${ov ? 'ov' : ''}" data-w="${i}"><b>${i + 1}</b><span>${EMCODE[w.parts.emitter] || 'GUN'}</span><small>${pr ? 'L' : se ? 'R' : ''}</small><i style="width:${ht}%;background:${esc(w.color)}"></i></div>`;
    }).join('');
  }
  $('wbar').addEventListener('click', (e) => { const el = e.target.closest('[data-w]'); if (el && G.running) G.equipPrimary(+el.dataset.w); });
  // ---------- boot-up sequence & JUNO log ----------
  const logLines = [];
  function logLine(t) {
    const ts = new Date(); const stamp = String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0') + ':' + String(ts.getSeconds()).padStart(2, '0');
    logLines.push('<b>' + stamp + '</b> ' + esc(t)); while (logLines.length > 6) logLines.shift();
    $('log').innerHTML = logLines.map((l, i) => `<div class="${i < logLines.length - 3 ? 'old' : ''}">› ${l}</div>`).join('');
  }
  UI.log = logLine;
  function bootSequence() {
    const hud = $('hud'), b = $('boot');
    const lines = ['AEGIS FLIGHT OS  v2.4', '', 'JUNO ........... LINK ESTABLISHED', 'REACTOR ........ OUTPUT NOMINAL', 'THRUSTERS ...... CALIBRATED', 'GAUNTLETS ...... ARMED', 'OPTICS ......... ONLINE', '', '> ALL SYSTEMS GO'];
    b.innerHTML = '<pre></pre>'; b.className = 'on'; const pre = b.firstChild; let i = 0;
    hud.classList.remove('booting');
    const step = () => {
      if (i < lines.length) { pre.textContent += lines[i++] + '\n'; G.sfx('ui'); setTimeout(step, 140); }
      else { setTimeout(() => { b.classList.add('fade'); hud.classList.add('booting'); setTimeout(() => { b.className = ''; }, 650); setTimeout(() => hud.classList.remove('booting'), 2200); }, 350); }
    };
    step();
    logLine('JUNO online. Welcome back, Rhea.');
  }
  // shapes outside the city texture (Blackwater Rock, the bridge) from js/blackwater.js
  function drawExtras(g, tx, scale, labels) {
    (G.mapExtras || []).forEach((e) => {
      g.save();
      const path = (pts) => { g.beginPath(); pts.forEach(([x, z], i) => { const [a, b] = tx(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath(); };
      if (e.poly || e.rect) {
        path(e.poly || [[e.rect[0], e.rect[1]], [e.rect[2], e.rect[1]], [e.rect[2], e.rect[3]], [e.rect[0], e.rect[3]]]);
        if (e.fill) { g.fillStyle = e.fill; g.fill(); }
        if (e.stroke) { g.strokeStyle = e.stroke; g.lineWidth = e.width || 1.5; g.stroke(); }
      } else if (e.line) {
        g.strokeStyle = e.color; g.lineWidth = Math.max(1.5, e.width * scale); g.beginPath(); const [a, b] = tx(...e.line[0]), [c2, d2] = tx(...e.line[1]); g.moveTo(a, b); g.lineTo(c2, d2); g.stroke();
      } else if (e.dot) { const [a, b] = tx(...e.dot); g.fillStyle = e.color; g.beginPath(); g.arc(a, b, Math.max(2, e.r * scale), 0, 7); g.fill(); }
      else if (e.label && labels) { const [a, b] = tx(...e.at); g.font = 'bold 11px system-ui'; g.fillStyle = 'rgba(255,255,255,0.6)'; g.textAlign = 'center'; g.fillText(e.label, a, b); }
      g.restore();
    });
  }
  const mm = $('minimap'), mg = mm.getContext('2d');
  let mmT = 0;
  UI.frame = function (dt) {
    // subtitles
    if (subT > 0) { subT -= dt; if (subT <= 0) $('subtitle').classList.remove('on'); }
    if (subT <= 0 && subQ.length && G.running) {
      const [who, text] = subQ.shift();
      $('subtitle').innerHTML = `<b class="sp-${who}">${esc(D.SPEAK[who] || who)}:</b> ${esc(text)}`; if (who === 'J') { logLine('JUNO: ' + text); JUNO.speak(text); } $('subtitle').classList.add('on');
      subT = Math.max(2.6, text.length * 0.06) / (subQ.length > 3 ? 2 : 1);
    }
    if (prev && prev.model && modal === 'bench' && benchTab === 'suit' && document.getElementById('suitPrev')) { prev.model.root.rotation.y += dt * 0.8; prev.r.render(prev.scene, prev.cam); }
    if (banT > 0) { banT -= dt; if (banT <= 0) $('banner').classList.remove('on'); }
    if (!G.running) return;
    const P = G.player, S = P.suit;
    $('hpFill').style.width = (Math.max(0, P.hp) / S.hp) * 100 + '%';
    $('enFill').style.width = (Math.max(0, P.energy) / S.energy) * 100 + '%';
    $('hpTxt').textContent = Math.max(0, Math.ceil(P.hp)) + ' / ' + S.hp;
    $('enTxt').textContent = Math.max(0, Math.round(P.energy)) + ' / ' + S.energy;
    $('spdV').textContent = Math.round(P.vel.length() * 3.6);
    $('altV').textContent = Math.round(P.pos.y);
    diagT -= dt; if (diagT <= 0) { diagT = 0.12; renderDiag(); }
    questT -= dt; if (questT <= 0) { questT = 0.25; renderQuest(); }
    const o = G.objective;
    $('qTimer').textContent = o.timer != null ? fmtTime(o.timer) : '';
    drawCompass();
    drawFx(dt);
    updateBubbles(dt);
    renderWbar();
    if ((clockT -= dt) <= 0) { clockT = 0.5; $('clockChip').textContent = CLIMATE.label(); }
    junoWatch(dt);
    $('junoHud').classList.toggle('talk', subT > 0 && $('subtitle').innerHTML.indexOf('sp-J') > 0);
    const hudEl = $('hud'); if (G.hurtFlash > 0.25 && !hudEl.classList.contains('glitch')) { hudEl.classList.add('glitch'); setTimeout(() => hudEl.classList.remove('glitch'), 240); }
    // boss
    if (G.boss && G.boss.alive) { $('bossbar').style.display = 'block'; $('bossName').textContent = G.boss.boss; $('bossFill').style.width = (G.boss.hp / G.boss.maxHp) * 100 + '%'; } else $('bossbar').style.display = 'none';
    // waypoint
    const wp = $('waypoint');
    if (o.wp && !modal) {
      const pr = G.project(o.wp); const W = window.innerWidth, H = window.innerHeight; let x = pr.x, y = pr.y;
      if (pr.behind) { x = W - x; y = H - 40; }
      x = Math.min(W - 30, Math.max(30, x)); y = Math.min(H - 30, Math.max(60, y));
      wp.style.display = 'block'; wp.style.transform = `translate(${x}px,${y}px)`;
      $('wpDist').textContent = Math.round(o.wp.distanceTo(P.pos)) + 'm';
    } else wp.style.display = 'none';
    $('prompt').textContent = G.prompt; $('prompt').style.display = G.prompt && !modal ? 'block' : 'none';
    $('hitmark').style.opacity = G.hitMarker > 0 ? 1 : 0;
    $('crosshair').classList.toggle('target', !!G.aimTarget);
    const low = P.hp / S.hp < 0.3;
    $('hurt').style.opacity = Math.min(1, G.hurtFlash * 2.5 + (low ? 0.35 + Math.sin(performance.now() / 200) * 0.15 : 0));
    $('clicktoplay').style.display = !isTouch && !modal && !locked() && !P.dead ? 'flex' : 'none';
    mmT -= dt; if (mmT <= 0) { mmT = 1 / 30; drawMinimap(); }
    abT -= dt; if (abT <= 0) { abT = 0.05; $('abil').innerHTML = G.abilityHud().map((a) => `<div class="ab ${a.s}"><i style="height:${Math.round(a.f * 100)}%"></i><kbd>${a.k}</kbd><span>${a.n}</span>${a.t ? '<em>' + a.t + '</em>' : ''}</div>`).join(''); }
    $('lockWarn').classList.toggle('on', (G.lockWarn || 0) > 0);
    const df = G.defuse, dr = $('defuseRing');
    if (df && !modal) { dr.style.display = 'block'; $('dfArc').style.strokeDashoffset = (264 * (1 - df.prog)).toFixed(1); dr.classList.toggle('idle', !df.holding); } else dr.style.display = 'none';
    const bc = $('bigcount'), rc = G.race;
    if (rc && rc.active && rc.count > 0) { bc.textContent = Math.ceil(rc.count); bc.className = 'on'; } else if (rc && rc.go > 0) { bc.textContent = 'GO!'; bc.className = 'on go'; } else bc.className = '';
  };
  let abT = 0;
  function drawMinimap() {
    const P = G.player, R = 100, view = 650, z = (2 * R) / view, gk = G.mapScale;
    mg.save(); mg.clearRect(0, 0, 200, 200);
    mg.beginPath(); mg.arc(R, R, R - 2, 0, 7); mg.clip();
    mg.fillStyle = '#1b4a6a'; mg.fillRect(0, 0, 200, 200);
    mg.translate(R, R); mg.rotate(P.yaw);
    const px = G.toPx(P.pos.x), pz = G.toPx(P.pos.z);
    mg.drawImage(G.mapCanvas, px - view * gk / 2, pz - view * gk / 2, view * gk, view * gk, -R, -R, 2 * R, 2 * R);
    const W = (v) => [(v.x - P.pos.x) * z, (v.z - P.pos.z) * z];
    drawExtras(mg, (x, zz) => [(x - P.pos.x) * z, (zz - P.pos.z) * z], z, false);
    if (!G.race.active && !G.mission.active) G.RACES.forEach((r) => { if (G.state.missionIndex < r.unlock) return; const [x, y] = W({ x: r.start[0], z: r.start[2] }); if (Math.hypot(x, y) > R - 6) return; mg.fillStyle = '#40ff80'; mg.beginPath(); mg.arc(x, y, 4, 0, 7); mg.fill(); });
    const clampR = (x, y, r) => { const L = Math.hypot(x, y); return L > r ? [x / L * r, y / L * r] : [x, y]; };
    G.benchObjs.forEach((b) => { let [x, y] = clampR(...W(b.pos), R - 8); mg.fillStyle = G.state.benches.includes(b.b.id) ? '#3fe0ff' : '#667'; mg.fillRect(x - 4, y - 4, 8, 8); });
    const scanR = 250 * P.suit.scan;
    G.crates.forEach((c) => { if (!G.state.crates.includes(c.id) && c.pos.distanceTo(P.pos) < scanR) { const [x, y] = W(c.pos); mg.fillStyle = '#ffa030'; mg.fillRect(x - 2.5, y - 2.5, 5, 5); } });
    G.enemies.forEach((e) => { if (!e.alive) return; const [x, y] = clampR(...W(e.pos), R - 4); mg.fillStyle = '#ff3355'; mg.beginPath(); mg.arc(x, y, e.boss ? 5 : 2.5, 0, 7); mg.fill(); });
    if (G.junoWp) { const [x, y] = clampR(...W(G.junoWp), R - 8); mg.strokeStyle = '#3fe0ff'; mg.lineWidth = 2.5; mg.beginPath(); mg.arc(x, y, 7, 0, 7); mg.stroke(); }
    if (G.objective.wp) { const [x, y] = clampR(...W(G.objective.wp), R - 8); mg.strokeStyle = '#ffd040'; mg.lineWidth = 2.5; mg.beginPath(); mg.arc(x, y, 6, 0, 7); mg.stroke(); }
    mg.restore();
    mg.fillStyle = '#fff'; mg.beginPath(); mg.moveTo(R, R - 8); mg.lineTo(R + 6, R + 6); mg.lineTo(R - 6, R + 6); mg.closePath(); mg.fill();
    // north indicator
    mg.fillStyle = '#ffd040'; mg.font = 'bold 12px system-ui'; mg.textAlign = 'center'; mg.textBaseline = 'middle';
    mg.fillText('N', R + (R - 12) * Math.sin(P.yaw), R - (R - 12) * Math.cos(P.yaw));
    mg.textBaseline = 'alphabetic';
  }

  // boot
  G.boot();
  UI.mainMenu();
})();
