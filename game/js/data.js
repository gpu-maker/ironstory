// AEGIS: Port Halcyon — game data (parts, story, missions)
// Everything here is plain data so it's easy to mod.
window.GDATA = (function () {
  // ---------- PARTS ----------
  // Weapon slots: emitter, cell, lens, mod, cooling
  // Suit slots: plating, thruster, reactor, helmet
  // Stats are combined in G.computeWeapon / G.computeSuit (main.js)
  const PARTS = [
    // EMITTERS — define the base weapon
    { id: 'em_pulse', slot: 'emitter', name: 'Pulse Emitter', tier: 1, desc: 'Balanced wrist blaster.', s: { dmg: 12, rate: 6, speed: 260, count: 1, spread: 0.012, heat: 4, size: 0.5 } },
    { id: 'em_micro', slot: 'emitter', name: 'Micro-Missile Rack', tier: 1, desc: 'Slow, explosive, lightly homing.', s: { dmg: 30, rate: 1.6, speed: 120, count: 2, spread: 0.08, heat: 12, size: 0.7, explode: 6, homing: 1.2 } },
    { id: 'em_scatter', slot: 'emitter', name: 'Scatter Projector', tier: 2, desc: 'Close-range spread of bolts.', s: { dmg: 7, rate: 2.5, speed: 220, count: 7, spread: 0.09, heat: 11, size: 0.4 } },
    { id: 'em_rail', slot: 'emitter', name: 'Rail Driver', tier: 2, desc: 'Hypersonic slug, punches through.', s: { dmg: 70, rate: 0.9, speed: 700, count: 1, spread: 0.0, heat: 22, size: 0.35, pierce: 3 } },
    { id: 'em_arc', slot: 'emitter', name: 'Arc Caster', tier: 3, desc: 'Lightning that jumps between targets.', s: { dmg: 16, rate: 4, speed: 300, count: 1, spread: 0.02, heat: 7, size: 0.5, chain: 3 } },
    { id: 'em_nova', slot: 'emitter', name: 'Nova Mortar', tier: 3, desc: 'Huge, slow plasma bomb.', s: { dmg: 110, rate: 0.6, speed: 90, count: 1, spread: 0.0, heat: 30, size: 1.4, explode: 16 } },
    { id: 'em_minigun', slot: 'emitter', name: 'Shoulder Minigun', tier: 4, desc: 'A storm of small rounds.', s: { dmg: 5, rate: 22, speed: 320, count: 1, spread: 0.04, heat: 2.2, size: 0.3 } },
    { id: 'em_storm', slot: 'emitter', name: 'Storm Needler', tier: 4, desc: 'Rapid hypersonic needles that punch through one target.', s: { dmg: 9, rate: 12, speed: 560, count: 1, spread: 0.008, heat: 3, size: 0.3, pierce: 1 } },
    { id: 'em_vortex', slot: 'emitter', name: 'Vortex Launcher', tier: 5, desc: 'Three seeking plasma charges per shot. Taken from the Ironback walker.', s: { dmg: 42, rate: 1.2, speed: 140, count: 3, spread: 0.12, heat: 14, size: 0.8, explode: 8, homing: 2 } },

    // POWER CELLS — damage / rate / heat trade-offs
    { id: 'ce_std', slot: 'cell', name: 'Standard Cell', tier: 1, desc: 'No trade-offs.', s: { dmgMul: 1, rateMul: 1, heatMul: 1 } },
    { id: 'ce_over', slot: 'cell', name: 'Overcharged Cell', tier: 2, desc: '+40% damage, +50% heat.', s: { dmgMul: 1.4, rateMul: 1, heatMul: 1.5 } },
    { id: 'ce_rapid', slot: 'cell', name: 'Rapid Cycle Cell', tier: 2, desc: '+45% fire rate, -15% damage.', s: { dmgMul: 0.85, rateMul: 1.45, heatMul: 1.1 } },
    { id: 'ce_fusion', slot: 'cell', name: 'Micro-Fusion Cell', tier: 4, desc: '+60% damage, +20% rate.', s: { dmgMul: 1.6, rateMul: 1.2, heatMul: 1.3 } },

    // LENSES — accuracy, velocity, pierce, extra shots
    { id: 'le_none', slot: 'lens', name: 'Open Aperture', tier: 1, desc: 'No lens.', s: {} },
    { id: 'le_focus', slot: 'lens', name: 'Focusing Lens', tier: 1, desc: 'Tighter spread, faster shots.', s: { spreadMul: 0.4, speedMul: 1.3 } },
    { id: 'le_split', slot: 'lens', name: 'Splitter Prism', tier: 2, desc: '+2 projectiles, wider spread, -25% dmg.', s: { countAdd: 2, spreadMul: 2.2, dmgMul: 0.75 } },
    { id: 'le_lance', slot: 'lens', name: 'Lance Lens', tier: 3, desc: '+2 pierce, +60% velocity.', s: { pierceAdd: 2, speedMul: 1.6 } },
    { id: 'le_hex', slot: 'lens', name: 'Hex Collimator', tier: 4, desc: '+25% damage, +50% velocity, very tight spread.', s: { dmgMul: 1.25, speedMul: 1.5, spreadMul: 0.3 } },

    // MODIFIERS — special behaviour
    { id: 'mo_none', slot: 'mod', name: 'No Modifier', tier: 1, desc: '—', s: {} },
    { id: 'mo_seek', slot: 'mod', name: 'Seeker Chip', tier: 1, desc: 'Shots home in on targets.', s: { homingAdd: 2.5 } },
    { id: 'mo_blast', slot: 'mod', name: 'Blast Shell', tier: 2, desc: 'Shots explode on impact.', s: { explodeAdd: 7 } },
    { id: 'mo_chain', slot: 'mod', name: 'Arc Coupler', tier: 3, desc: 'Shots chain to 2 more targets.', s: { chainAdd: 2 } },
    { id: 'mo_cryo', slot: 'mod', name: 'Cryo Coil', tier: 3, desc: 'Hits slow enemies by 50%.', s: { slow: 1 } },
    { id: 'mo_overload', slot: 'mod', name: 'Overload Chip', tier: 4, desc: 'Shots burst on impact and arc to one more target.', s: { explodeAdd: 5, chainAdd: 1 } },

    // COOLING — heat
    { id: 'co_passive', slot: 'cooling', name: 'Passive Fins', tier: 1, desc: 'Basic cooling.', s: { heatMul: 1, coolMul: 1 } },
    { id: 'co_liquid', slot: 'cooling', name: 'Liquid Loop', tier: 2, desc: '-30% heat per shot.', s: { heatMul: 0.7, coolMul: 1.2 } },
    { id: 'co_cryo', slot: 'cooling', name: 'Cryo Sink', tier: 3, desc: '-50% heat, vents fast.', s: { heatMul: 0.5, coolMul: 1.8 } },
    { id: 'co_void', slot: 'cooling', name: 'Void Sink', tier: 4, desc: '-65% heat, vents very fast.', s: { heatMul: 0.35, coolMul: 2.4 } },

    // SUIT: PLATING — armor vs speed
    { id: 'pl_light', slot: 'plating', name: 'Composite Shell', tier: 1, desc: 'Light, low armor.', s: { armor: 10, hp: 100, speedMul: 1.05 } },
    { id: 'pl_titan', slot: 'plating', name: 'Titanium Weave', tier: 2, desc: 'Solid all-rounder.', s: { armor: 25, hp: 130, speedMul: 1.0 } },
    { id: 'pl_heavy', slot: 'plating', name: 'Bastion Plate', tier: 3, desc: 'Tanky, slower.', s: { armor: 45, hp: 180, speedMul: 0.85 } },
    { id: 'pl_nano', slot: 'plating', name: 'Nanoweave Lattice', tier: 4, desc: 'Strong and light.', s: { armor: 40, hp: 160, speedMul: 1.1 } },
    { id: 'pl_mirror', slot: 'plating', name: 'Mirror Lattice', tier: 5, desc: 'Reflective plating from the Ironback walker. Heavy armor, no speed cost.', s: { armor: 55, hp: 200, speedMul: 1.05 } },

    // SUIT: THRUSTERS
    { id: 'th_std', slot: 'thruster', name: 'Mk I Boot Jets', tier: 1, desc: 'Gets you airborne.', s: { speed: 38, boost: 110, boostCost: 22 } },
    { id: 'th_vector', slot: 'thruster', name: 'Vector Jets', tier: 2, desc: 'Agile and quicker.', s: { speed: 48, boost: 150, boostCost: 20 } },
    { id: 'th_ram', slot: 'thruster', name: 'Ramjet Boosters', tier: 3, desc: 'Blistering boost speed.', s: { speed: 46, boost: 230, boostCost: 26 } },
    { id: 'th_grav', slot: 'thruster', name: 'Grav Drive', tier: 4, desc: 'Fast and efficient.', s: { speed: 58, boost: 260, boostCost: 14 } },
    { id: 'th_night', slot: 'thruster', name: 'Nightjar Drive', tier: 5, desc: "Vesper Hale's silent drive. The fastest thrusters in the city.", s: { speed: 64, boost: 300, boostCost: 12 } },

    // SUIT: REACTOR
    { id: 're_arc', slot: 'reactor', name: 'Chest Reactor v1', tier: 1, desc: 'Basic energy core.', s: { energy: 100, regen: 18, coolBonus: 1 } },
    { id: 're_dense', slot: 'reactor', name: 'Dense Core', tier: 2, desc: 'More capacity.', s: { energy: 150, regen: 20, coolBonus: 1.1 } },
    { id: 're_surge', slot: 'reactor', name: 'Surge Core', tier: 3, desc: 'Fast regen, cools weapons.', s: { energy: 130, regen: 34, coolBonus: 1.35 } },
    { id: 're_star', slot: 'reactor', name: 'Starheart Core', tier: 4, desc: 'The prototype Marrow stole.', s: { energy: 220, regen: 40, coolBonus: 1.6 } },
    { id: 're_eclipse', slot: 'reactor', name: 'Eclipse Core', tier: 5, desc: "Hale's reactor, tuned from the Starheart notes.", s: { energy: 260, regen: 48, coolBonus: 1.8 } },

    // SUIT: HELMET (mostly looks + scanner range)
    { id: 'he_classic', slot: 'helmet', name: 'Visor Helm', tier: 1, desc: 'Clean single visor.', s: { scan: 1.0, style: 0 } },
    { id: 'he_crest', slot: 'helmet', name: 'Crested Helm', tier: 2, desc: 'Fin crest, better scanner.', s: { scan: 1.3, style: 1 } },
    { id: 'he_horn', slot: 'helmet', name: 'Ram Helm', tier: 3, desc: 'Swept horns, long-range scanner.', s: { scan: 1.6, style: 2 } },
  ];

  const SLOTS = {
    weapon: ['emitter', 'cell', 'lens', 'mod', 'cooling'],
    suit: ['plating', 'thruster', 'reactor', 'helmet'],
  };

  // Parts you start with (counts). Your starting builds use some of them.
  const START_INVENTORY = {
    em_pulse: 2, em_micro: 1, ce_std: 3, le_none: 3, le_focus: 1, mo_none: 3, mo_seek: 1,
    co_passive: 3, pl_light: 1, th_std: 1, re_arc: 1, he_classic: 1,
  };

  const START_WEAPONS = [
    { id: 'w_start1', name: 'Mk I Repulsor', parts: { emitter: 'em_pulse', cell: 'ce_std', lens: 'le_focus', mod: 'mo_none', cooling: 'co_passive' }, color: '#5fe3ff' },
    { id: 'w_start2', name: 'Mk I Micro-Missiles', parts: { emitter: 'em_micro', cell: 'ce_std', lens: 'le_none', mod: 'mo_seek', cooling: 'co_passive' }, color: '#ffb347' },
  ];
  const START_SUITS = [
    { id: 's_start', name: 'AEGIS Mk I', parts: { plating: 'pl_light', thruster: 'th_std', reactor: 're_arc', helmet: 'he_classic' }, c1: '#2b3a4a', c2: '#3fd0c9' },
  ];

  // ---------- WORKBENCHES ----------
  const BENCHES = [
    { id: 'b_harbor', name: 'Harbor Garage', pos: [-220, 0, 1010] },
    { id: 'b_down', name: 'Downtown Lab', pos: [130, 0, -120] },
    { id: 'b_old', name: 'Old Town Workshop', pos: [-1010, 0, -90] },
    { id: 'b_ind', name: 'Foundry Bay', pos: [1010, 0, 330] },
    { id: 'b_up', name: 'Uptown Hangar', pos: [-170, 0, -1100] },
    { id: 'b_park', name: 'Greenway Bunker', pos: [-520, 0, 40] },
    { id: 'b_hq', name: 'AEGIS Tower Hangar', pos: [-184, 200, -348], indoor: true },
    { id: 'b_rock', name: 'Blackwater Outpost', pos: [40, 22, 2000] },
  ];

  // ---------- STORY ----------
  // Hero: Rhea Kade, engineer. AI: JUNO. Villain: Silas Marrow, Cobalt Syndicate.
  // Act II villain: Vesper Hale, Marrow's lieutenant, flying the Nightjar stealth suit from Blackwater Rock.
  const SPEAK = { J: 'JUNO', R: 'Rhea', M: 'Marrow', D: 'Det. Okafor', V: 'Vesper Hale' };

  // Stage types: goto, craft, kill, convoy, defend, collect, destroy, boss, chase, defuse (chase/defuse live in act2.js)
  // kill.spawn.type can be any enemy type, incl. Act II: sniper, rocketeer, riot. A 'mix' array spawns several types.
  const MISSIONS = [
    {
      id: 'm1', title: 'First Flight', desc: "Your new AEGIS suit is finally ready. Take it for a test flight over the harbor and learn to hover, climb and boost.", reward: ['le_focus', 'mo_blast'],
      intro: [['J', 'Systems online. Good evening, Rhea. Shall we see if the boots work this time?'], ['R', 'Ha. Run the flight check, JUNO.'], ['J', 'Hold Space to climb, WASD to move, Shift to boost. Follow the markers.']],
      stages: [
        { type: 'goto', text: 'Fly to the marker over the harbor', pos: [-220, 60, 860], r: 25 },
        { type: 'goto', text: 'Boost (Shift) to the crane tower', pos: [200, 90, 1000], r: 25 },
        { type: 'goto', text: 'Land at the Harbor Garage workbench', pos: [-220, 2, 1010], r: 16, say: [['J', 'That is the garage. Your workbenches are hidden all over Port Halcyon.']] },
      ],
      outro: [['R', 'Flight is solid. Now let’s give this thing some teeth.']],
    },
    {
      id: 'm2', title: 'Workbench Online', desc: "Workbenches let you build gear from any parts you own. Build your first custom weapon, then try it on practice drones.", reward: ['em_scatter', 'ce_over'],
      intro: [['J', 'Press E at a workbench. Combine any parts you own into a new weapon.'], ['J', 'Each build uses the actual parts. Dismantle a build to get them back.']],
      stages: [
        { type: 'craft', text: 'Build a new weapon at the workbench (E)' },
        { type: 'kill', text: 'Test it: destroy the practice drones', spawn: { type: 'drone', n: 4, center: [-220, 40, 920], r: 60, passive: true } },
      ],
      outro: [['D', 'Kade? Detective Okafor. Cobalt Syndicate jet-troopers are hitting the docks. You flying or not?'], ['R', 'On my way.']],
    },
    {
      id: 'm3', title: 'Dockside Raid', desc: "Cobalt Syndicate jet-troopers are raiding the container docks. Drive them off and take out the gunners covering them from the rooftops.", reward: ['co_liquid', 'th_vector', 'pl_titan'],
      intro: [['J', 'Multiple armed jet-troopers at the container yard. Syndicate colors.']],
      stages: [
        { type: 'goto', text: 'Reach the container docks', pos: [520, 40, 1000], r: 60 },
        { type: 'kill', text: 'Take down the Syndicate jet-troopers', spawn: { type: 'trooper', n: 8, center: [520, 45, 1000], r: 90 } },
        { type: 'kill', text: 'Take out the rooftop gunners', spawn: { type: 'turret', n: 3, center: [520, 0, 960], r: 110 } },
      ],
      outro: [['J', 'One of those troopers was carrying your old reactor schematics, Rhea.'], ['R', 'Marrow. He stole the Starheart designs when he fired me.'], ['M', 'Rhea Kade. Still playing with toys? Stay out of my city.']],
    },
    {
      id: 'm4', title: 'Iron Convoy', desc: "Armored Syndicate trucks are moving stolen parts across Midtown. Destroy every truck before the convoy escapes.", reward: ['em_rail', 'le_lance'],
      intro: [['D', 'Syndicate armored trucks are moving stolen parts through Midtown. Stop them before they reach the bridge.']],
      stages: [
        { type: 'convoy', text: 'Destroy the armored convoy before it escapes', start: [-680, 0, 563], dir: [1, 0, 0], n: 3, escort: 3, length: 1500 },
      ],
      outro: [['J', 'Salvaging their cargo. Rail Driver components, still in the box.'], ['R', 'Christmas came early.']],
    },
    {
      id: 'm5', title: 'Blackout', desc: "The Syndicate is attacking the Foundry power station. Hold the line until the assault breaks, or half the city goes dark.", reward: ['re_dense', 'em_arc', 'co_cryo'],
      intro: [['J', 'The Foundry power station is under attack. If it falls, half the city goes dark.']],
      stages: [
        { type: 'goto', text: 'Get to the power station', pos: [880, 40, 120], r: 70 },
        { type: 'defend', text: 'Defend the power station', pos: [880, 0, 120], hp: 600, duration: 75, waves: ['trooper', 'trooper', 'turret', 'trooper'] },
      ],
      outro: [['D', 'Lights stayed on. The city owes you, Kade.'], ['J', 'I traced their uplink. Data cores are hidden in Old Town.']],
    },
    {
      id: 'm6', title: 'Data Trail', desc: "Four guarded data cores hidden in Old Town hold the Syndicate's plans. Recover all of them.", reward: ['mo_chain', 'he_crest', 'ce_rapid'],
      intro: [['J', 'Four Syndicate data cores, each guarded. Grab them all.']],
      stages: [
        { type: 'collect', text: 'Recover the data cores', items: [[-1150, 0, -400], [-880, 0, 160], [-1250, 0, 380], [-760, 0, -620]], guards: 3 },
      ],
      outro: [['J', 'Decrypted. Marrow is finishing a suit of his own: the Cobalt Colossus.'], ['R', 'Built from my designs. Where is he?'], ['J', 'Jammer towers are hiding his location. Uptown rooftops.']],
    },
    {
      id: 'm7', title: 'Skyhook', desc: "Jammer towers in Uptown are hiding Marrow's location. Bring them down, then deal with the gunship sent to stop you.", reward: ['th_ram', 'pl_heavy', 'em_nova', 'mo_cryo'],
      intro: [['J', 'Three jammer towers. Destroy them and his signal will be exposed.']],
      stages: [
        { type: 'destroy', text: 'Destroy the jammer towers', targets: [[-600, 0, -1000], [150, 0, -880], [520, 0, -1180]] },
        { type: 'boss', text: 'Shoot down the Syndicate gunship', boss: 'gunship', pos: [0, 210, -1000] },
      ],
      outro: [['J', 'Signal unmasked. He is at the top of Cobalt Tower, downtown.'], ['M', 'Come, then. Let me show you what your designs could really do.'], ['R', 'JUNO, everything we have.']],
    },
    {
      id: 'm8', title: 'Cobalt Colossus', desc: "Marrow has finished a war suit built from your stolen designs. End this at the top of Cobalt Tower.", reward: ['re_star', 'em_minigun', 'pl_nano', 'th_grav', 'ce_fusion', 'he_horn'],
      intro: [['J', 'Cobalt Tower ahead. Colossus signature detected. Be careful, Rhea.']],
      stages: [
        { type: 'goto', text: 'Fly to the top of Cobalt Tower', pos: [40, 360, 40], r: 60 },
        { type: 'boss', text: 'Defeat Marrow in the Cobalt Colossus', boss: 'colossus', pos: [40, 380, 40] },
      ],
      outro: [['M', 'Impossible... it was MY suit...'], ['R', 'No. It was always mine.'], ['J', 'Starheart core recovered. Port Halcyon is safe.'], ['D', 'Good work, Kade. The city is yours to watch now.'], ['J', 'Act I complete. Something is still moving out there, though. A new yellow beacon just lit up in Midtown.']],
    },
    // ===================== ACT II: THE NIGHTJAR =====================
    {
      id: 'm9', act: 2, title: 'Aftershock', start: [-160, 0, 400], desc: "Weeks after Marrow fell, Syndicate snipers and rocket crews are hitting police checkpoints in Midtown. Someone is organizing what is left of them.", reward: ['em_storm', 'co_void'],
      intro: [['D', 'Kade. Three checkpoints hit in an hour. Snipers on the roofs, rockets from the street.'], ['J', 'Watch for red laser sights. That is a sniper charging. Hold F to raise your shield, or R to dash out of the line.'], ['R', 'New toys for everyone, then.']],
      stages: [
        { type: 'goto', text: 'Reach the Midtown checkpoint', pos: [-160, 30, 400], r: 50 },
        { type: 'kill', text: 'Take out the rooftop snipers', spawn: { type: 'sniper', n: 4, center: [-160, 0, 400], r: 170 }, say: [['J', 'Four sniper nests. Their lasers give them away.']] },
        { type: 'kill', text: 'Break the rocket and riot squad', spawn: { mix: ['rocketeer', 'rocketeer', 'rocketeer', 'riot', 'riot', 'trooper', 'trooper'], n: 7, center: [-160, 40, 400], r: 90 }, say: [['J', 'Riot shields block shots from the front. Flank them, use explosives, or knock them flat with a shockwave. Press G.']] },
      ],
      outro: [['V', 'Marrow was a showman. I am not. Stay on the ground, Kade, and nobody else gets hurt.'], ['R', 'Who is that?'], ['J', 'Vesper Hale. Marrow\u2019s head of operations. She vanished the night he fell.'], ['J', 'Her message bounced through a courier relay. If we catch a courier, we catch her.']],
    },
    {
      id: 'm10', act: 2, title: 'Ghost Signal', start: [560, 0, -400], desc: "A Syndicate courier is carrying Vesper Hale's orders across the city. Tail him without losing the signal or spooking him, then hit the drop point.", reward: ['le_hex', 'mo_overload'],
      intro: [['J', 'Courier located. Industrial district, moving soon.'], ['J', 'Stay within signal range but do not crowd him. If he spots you, he burns the case.']],
      stages: [
        { type: 'goto', text: 'Find the courier in the Foundry District', pos: [560, 40, -400], r: 60 },
        { type: 'chase', text: 'Tail the courier: stay in range, do not get too close', path: [[560, 45, -400], [560, 50, -80], [240, 60, -80], [240, 60, 160], [-80, 55, 160], [-80, 60, 480], [-400, 50, 480], [-400, 40, 800], [-640, 30, 800], [-640, 24, 960]], speed: 34, far: 190, near: 30 },
        { type: 'kill', text: 'Ambush at the drop point: clear the Syndicate crew', spawn: { mix: ['riot', 'riot', 'rocketeer', 'trooper', 'trooper', 'trooper'], n: 6, center: [-640, 30, 960], r: 70 }, say: [['J', 'Drop point. And a welcome party.']] },
      ],
      outro: [['J', 'The courier case holds bridge schematics. Demolition charges, Rhea. The Halcyon Bridge.'], ['D', 'That bridge carries eleven thousand cars a day. I am closing it now.'], ['R', 'Keep it closed. I will deal with the charges.']],
    },
    {
      id: 'm11', act: 2, title: 'Bridge Siege', start: [300, 0, 1080], desc: "Hale's crews have wired the Halcyon Bridge with demolition charges. Defuse every charge before the timer runs out, then deal with whatever is guarding the deck.", reward: ['em_vortex', 'pl_mirror'],
      intro: [['J', 'Four charges on the Halcyon Bridge deck. Hold E next to a charge to defuse it.'], ['J', 'The timer is real, Rhea. So are the people shooting at you.']],
      stages: [
        { type: 'goto', text: 'Get to the Halcyon Bridge', pos: [300, 40, 1180], r: 60 },
        { type: 'defuse', text: 'Defuse the demolition charges (hold E)', bombs: [[300, 22.4, 1290], [292, 22.4, 1470], [308, 22.4, 1560], [296, 22.4, 1760]], time: 170, waves: ['trooper', 'rocketeer', 'riot', 'rocketeer', 'trooper'] },
        { type: 'boss', text: 'Bring down the Ironback walker', boss: 'walker', pos: [300, 22, 1820], say: [['J', 'Something heavy just climbed onto the deck. That is a Syndicate walker.'], ['J', 'Its reactor vents are on the back. Get behind it.']] },
      ],
      outro: [['J', 'Bridge secure. The walker logs point south, to Blackwater Rock.'], ['V', 'You are persistent. Come to the Rock, then. I saved you a seat.'], ['R', 'The old prison island. Of course.']],
    },
    {
      id: 'm12', act: 2, title: 'Blackwater', start: [300, 0, 1880], desc: "Blackwater Rock, the old prison island, is Vesper Hale's fortress. Knock out the anti-air batteries, then face Hale in the Nightjar stealth suit.", reward: ['re_eclipse', 'th_night', 'he_horn'],
      intro: [['J', 'Blackwater Rock. Four flak batteries cover the island. They will shred us on approach.'], ['R', 'Then we go in low and fast.']],
      stages: [
        { type: 'goto', text: 'Cross the bridge to Blackwater Rock', pos: [200, 60, 1960], r: 80 },
        { type: 'destroy', text: 'Destroy the anti-air batteries', aa: [[-30, 22, 2070], [290, 40, 2145], [80, 22, 2370], [140, 52, 2262]], say: [['J', 'Flak bursts near you, not on you. Keep moving, or shield through it.']] },
        { type: 'boss', text: 'Defeat Vesper Hale in the Nightjar', boss: 'nightjar', pos: [200, 90, 2200], say: [['V', 'Marrow built a tank. I built something you will never see coming.'], ['J', 'She cloaks. A shockwave or the Core Lance will knock her out of it.']] },
      ],
      outro: [['V', 'Marrow said you were just an engineer...'], ['R', 'I am. That is the problem, for people like you.'], ['J', 'Nightjar drive and Eclipse core recovered. That was the last of the Syndicate command.'], ['D', 'Port Halcyon owes you twice now, Kade.'], ['J', 'Act II complete. The Rock is ours: there is a workbench at the old guard post, and the Rock Run race is open.']],
    },
  ];

  // ---------- RACES (ring time trials) ----------
  // Rings are flown in order. Medal times are worked out from the course length in act2.js.
  const RACES = [
    { id: 'r_harbor', name: 'Harbor Sprint', unlock: 1, desc: 'Low and fast along the docks, then through both bridge towers and under the deck.', start: [-400, 16, 1040],
      rings: [[-240, 14, 1040], [-80, 18, 1040], [80, 14, 1040], [240, 14, 1040], [240, 12, 1170], [300, 40, 1240], [300, 45, 1350], [340, 12, 1420], [300, 9, 1500], [260, 16, 1560], [300, 40, 1600], [300, 45, 1650], [300, 34, 1840]] },
    { id: 'r_down', name: 'Downtown Slalom', unlock: 3, desc: 'Street-level canyons between the downtown towers.', start: [-480, 40, 0],
      rings: [[-320, 36, 0], [-160, 30, 0], [-80, 40, 0], [-80, 34, -160], [-80, 46, -320], [80, 38, -320], [240, 30, -320], [240, 42, -160], [240, 34, 0], [240, 30, 160], [80, 40, 160], [-80, 50, 160], [-80, 70, 60]] },
    { id: 'r_sky', name: 'Skyline Circuit', unlock: 5, desc: 'A high-altitude loop over the Uptown spires and the AEGIS Tower.', start: [-560, 170, -720],
      rings: [[-400, 190, -880], [-200, 240, -960], [0, 280, -1040], [240, 220, -960], [400, 180, -800], [320, 260, -560], [80, 300, -420], [-200, 260, -300], [-360, 200, -480], [-520, 160, -600]] },
    { id: 'r_rock', name: 'Rock Run', unlock: 12, desc: 'Under the bridge, round the island past the lighthouse, then over the prison walls into the yard.', start: [560, 16, 1200],
      rings: [[460, 10, 1380], [300, 9, 1420], [140, 12, 1600], [-160, 12, 1900], [-170, 14, 2240], [-80, 20, 2530], [150, 18, 2520], [380, 16, 2500], [520, 20, 2330], [520, 30, 2120], [440, 50, 2000], [300, 40, 2010], [110, 34, 2030]] },
  ];

  // ---------- SUIT UPGRADES (spend Tech Points at any workbench) ----------
  // Tech Points: +3 per story mission, +1 per crime stopped, +1 per 5 salvage crates, +1/+1/+2 for bronze/silver/gold race medals.
  const UPGRADES = [
    { id: 'armor', name: 'Armor Systems', desc: '+8% max armor and +6 armor rating per level.', cost: [2, 3, 4] },
    { id: 'reactor', name: 'Reactor Tuning', desc: '+12% energy capacity and +10% regen per level.', cost: [2, 3, 4] },
    { id: 'shield', name: 'Shield Matrix', desc: 'Shield (F) drains 20% less and blocks more per level. Level 3 reflects bolts back at the shooter.', cost: [2, 3, 4] },
    { id: 'shock', name: 'Shockwave Emitter', desc: 'Shockwave (G): +20% radius, +30% damage, shorter cooldown. Level 3 stuns.', cost: [2, 3, 4] },
    { id: 'thrust', name: 'Thruster Overdrive', desc: '+7% speed and boost, -10% boost cost, faster Dash (R) per level.', cost: [2, 3, 4] },
    { id: 'lance', name: 'Lance Capacitor', desc: 'Core Lance (Q): +25% damage, faster recharge, lower energy cost per level.', cost: [2, 3, 4] },
  ];

  return { PARTS, SLOTS, START_INVENTORY, START_WEAPONS, START_SUITS, BENCHES, MISSIONS, SPEAK, RACES, UPGRADES };
})();
