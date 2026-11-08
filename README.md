# AEGIS: Port Halcyon

An open-world armored-suit flying game. Fly an original powered suit in first person over a big city at sunset, play an 8-mission story, talk to the people on the streets, and build custom weapons and suits with your AI co-pilot, JUNO.

It comes in **two versions** built from the same game code:

| | Website version | Desktop version |
|---|---|---|
| **How you play** | Open the GitHub Pages site and click **Play in your browser** | Download and run the app from the site or the repo's **Releases** |
| **Install** | Nothing | Windows installer or portable `.exe`, macOS `.dmg`, Linux `AppImage`, or the offline zip |
| **Saves** | In your browser | On your computer |
| **Extras** | Touch controls on phones and tablets | Its own window, fullscreen (F11 or Alt+Enter), Quit to Desktop |

There are no servers, accounts or online features. Everything runs on your device.

## Put it on GitHub (one-time setup)

1. Create a new GitHub repository and upload **everything in this folder**, keeping the folders (`game/`, `web/`, `desktop/`, `.github/`).
2. **Website:** go to **Settings → Pages**, and under *Build and deployment* set **Source** to **GitHub Actions**. The *Website (GitHub Pages)* workflow runs on every push to `main`. Your site will be at `https://<your-username>.github.io/<repo-name>/`, with the game at `/play/`.
3. **Desktop downloads:** create a release:
   - On GitHub, open **Releases → Draft a new release**, type a new tag such as `v1.0.0`, and publish it. Or push a tag with git: `git tag v1.0.0 && git push origin v1.0.0`.
   - The *Desktop app* workflow then builds Windows, macOS and Linux versions (about 10 minutes) and attaches them to that release, along with `AEGIS-offline.zip`.
   - The download buttons on the website always point to the newest release.
   - You can also run the workflow manually from the **Actions** tab. The builds then appear as downloadable workflow artifacts instead of a release.

The desktop apps aren't code-signed. The first time you open one, Windows SmartScreen may need **More info → Run anyway**, and macOS may need **right-click → Open**.

## Play without GitHub

- **Browser, no install:** open `game/index.html` in any modern browser.
- **Desktop app from source:** install [Node.js](https://nodejs.org), then run `cd desktop`, `npm install` and `npm start`. Use `npm run dist` to build installers for your own OS into `desktop/dist/`.

## Project layout

```
game/                 the game itself (shared by both versions)
  index.html, style.css, favicon.png
  js/three.min.js     three.js r150 (3D library, MIT)
  js/data.js          parts, missions, dialogue, workbench locations (easy to mod)
  js/graphics.js      graphics engine: renderer, shadows, sky, shaders, particles, post-processing
  js/audio.js         audio engine: 3D sound, city reverb, all sounds synthesized in code
  js/environment.js   world clock (day/night) and weather (rain, lightning, thunder)
  js/main.js          world, flight, combat, enemies, crowd, missions, saves
  js/act2.js          Act II: suit abilities, upgrades, new enemies and bosses, chase/defuse missions, ring races
  js/blackwater.js    Blackwater Rock (prison island fortress, lighthouse) and the Halcyon Bridge
  js/life.js          ambient life: seabird flocks (they scatter at explosions) and gull calls
  js/ui.js            menus, helmet HUD, map, workbench, JUNO, touch controls
web/                  website: landing page with Play and Download buttons (+ screenshots)
desktop/              desktop app (Electron): main.js, preload.js, icon, build settings
.github/workflows/    pages.yml (website) and desktop.yml (desktop builds and releases)
```

## Day, night and weather

- **Day/night cycle:** a full day takes 16 minutes, and saves remember the time. Sunrise turns to a blue noon, then a golden sunset, then a moonlit night with the city lit up. Street lamps and car headlights switch on at dusk, and more windows light up after dark.
- **Weather:** storms roll in and clear up on their own. You get rain, darker skies, wetter and shinier streets, and lightning with thunder that arrives late depending on how far away the strike was.
- Both can be set in **Settings → Time of day / Weather** (dynamic, or locked to dawn, day, sunset or night, always clear, or always raining).

## City life

- **Busier streets:** up to 380 pedestrians on Ultra. Some stand in groups of two to four chatting, laughing and checking their phones, and they scatter when a fight or explosion gets close.
- **Throw cars:** walk up to a car, press E to lift it overhead, then click to throw it. It flies at the crosshair and explodes on impact, damaging and knocking back enemies around it. Lifting drains a little energy, and you can't fire or shield while your hands are full.
- **Birds:** gull flocks circle the harbor, the bridge towers, the island and the parks. They call when you fly close and scatter when something blows up.

## Destruction

Cars take damage from your weapons and from explosions. Wreck one and it explodes, flips, burns and smokes. Nearby cars can go up in a chain reaction, and pedestrians run. Wrecks get towed away (respawn) once you've moved on.

## Sound

All sound is generated in code with the Web Audio API, so there are no audio files and it works offline:

- **3D positional audio:** you hear where things are. Distant sounds get muffled, echo off the buildings, and arrive late, at the speed of sound.
- **Layered sounds:**
  - **Weapons** have a sharp attack, a body and a tail.
  - **Explosions** have a deep pressure thump, a blast and debris crackle.
  - **Rifle shots** crack and then roll off the buildings.
  - **Armor hits** ring with a metallic clang.
- **Thrusters:** jet rumble, hiss and turbine whine rise with your speed, and get louder when you boost.
- **City soundscape:**
  - wind that grows with speed and altitude
  - street traffic hum, muffled high up or indoors
  - distant car horns, and a siren at an active raid
  - crowd murmur near people
  - footsteps when you walk, and a thud when you land

## Controls

| Input | Action |
|---|---|
| Mouse | Look / aim |
| Left click (hold) | Primary weapon |
| Right click (hold) | Secondary weapon |
| W A S D | Move / hover |
| Space | Fly up |
| C / Ctrl | Fly down / land |
| Shift + W | Boost (fly where you look) |
| Q | Core Lance (chest beam, 50 energy) |
| F (hold) | Energy shield: blocks most damage, drains energy, you can't fire through it |
| G | Shockwave: knocks enemies back, swats rockets and mines out of the air, breaks cloaks |
| R | Dash: a quick burst in the direction you're moving; you can't be hit for a split second |
| E | Use a workbench / talk to people / start a race. Hold E to defuse a charge |
| E next to a car | Lift it overhead. Click (or E again) to throw it at whatever is under the crosshair |
| V | Switch first-person / third-person view |
| J | Ask JUNO (where to find parts, crates, workbenches, what to do next) |
| 1–9 / mouse wheel | Swap primary weapon |
| X | Visor FX: HI / LO / OFF |
| M | City map (click a workbench to fast travel) |
| Esc / P | Pause, save, load, settings |

Phones and tablets get on-screen controls: a stick, look-drag, and buttons for fire, alt fire, up, down, boost, use, lance, shield, shockwave and dash.

## Helmet HUD

- **Suit diagnostics (top left):** every suit part with its installed component and live stats. The helmet shows integrity and scanner range, the plating shows armor and torso integrity, the reactor shows energy and regen, the thrusters show speed and leg integrity, and each gauntlet shows its weapon's DPS, heat and arm integrity, plus the Core Lance charge. A body diagram turns yellow, then red, as each part takes damage. Badly damaged legs slow you down and damaged arms overheat faster. Parts repair themselves when you stay out of combat.
- **Quest panel (top right):** the current quest's name and description, with a checklist of objectives and live progress and timers. Between missions it shows the next quest, any crime in progress, or your free-roam progress.
- **Compass** with heading and an objective marker, plus speed and altitude readouts beside the crosshair.

## JUNO, your AI co-pilot

- JUNO speaks her lines out loud using your browser's built-in text-to-speech, so it works offline and needs no audio files. Turn her voice or chatter off in **Settings**.
- She reacts to what's happening: low armor, overheating, an empty reactor, nearby hostiles, kill streaks, entering a new district, rare parts, crates, new workbenches, going down and rebooting. When things are quiet she makes small talk.
- A voice indicator and a running JUNO log sit in the bottom-left of the HUD.
- **Workbench = JUNO's fabrication bay.** She comments on every part you pick by comparing it to your current gear, and **Ask JUNO to design** builds the best weapon (Max damage, Long range, Crowd control, Cool & steady) or suit (Tank, Speed, Endurance, Balanced) from the parts you own. Building plays a short fabrication sequence.

## AEGIS Tower

Rhea's headquarters stands downtown. Fly in through the south hangar door, 200 m up, onto the landing pad. Inside are a workbench, display pods holding your suit builds, and JUNO's core. Press E at the core to talk to her. The tower's workbench is unlocked from the start, so you can always fast travel home.

## Ask JUNO

Press **J** anywhere, or use the **Ask JUNO** tab at a workbench or JUNO's core in the tower. Pick any part or type a question like *"where do I get a Rail Driver?"*. JUNO tells you how many you own, which story mission rewards it, and which enemies, crates or raids can drop it at your current progress. She marks the nearest salvage crate with a cyan JUNO marker on your HUD, compass and minimap. She also answers questions about the next mission, the nearest workbench, the way home, heat, energy and repairs.

## Targeting HUD

A weapon bar at the bottom center shows every weapon build: L is your primary, R is your secondary, and each slot shows live heat. A **VISOR FX** toggle (X) switches the visor effects between HI, LO and OFF. When the suit comes online it boots up and the HUD panels power on. Enemies get tracking brackets with their range and health. The one under your crosshair gets locked and scanned, showing its type, health and threat level. Red arrows point to enemies off-screen, and red arcs show which way you were hit. The reticle shows each gauntlet's heat and the Core Lance charge, and in flight a pitch ladder shows your angle.

## Graphics

All rendering lives in its own engine file, `game/js/graphics.js`, built on three.js. Pick a quality tier in **Settings → Graphics quality**:

- **Low**: fastest, no post-processing. Phones start here.
- **High**: real-time sun shadows, bloom glow, wet reflective streets, glass reflections, soft particles, lens streaks when boosting.
- **Ultra** (default on desktop): everything in High plus 4096 shadows with **contact-hardening soft edges** (sharp where an object meets the ground, softer further away), a **long-range shadow map of the whole city** (distant towers and the island throw shadows across the skyline), **ambient occlusion** (corners, doorways, gaps and the bases of objects darken naturally), sun rays, lens flare, 8× anti-aliasing and full-resolution rendering.
- **Max**: everything in Ultra plus **real-time city reflections** in the sea and on wet streets (the skyline, the bridge, lit windows and traffic in rain), full-resolution ambient occlusion and a sharper long-range shadow map. It renders the scene twice per frame, so it needs a strong graphics card.

**Trees** have layered, lumpy canopies with leaf texture, darker undersides, light glowing through the leaves when the sun is behind them, and branches that sway in the wind (more in storms). Parks also have conifers.

Realism features: a fake 3D room behind every window (ceilings, floors and walls that shift with the camera), brick, stone and concrete facades with weathering, a natural sunset sky, film-style tone mapping, rooftop parapets, curbs, street trees and cars with metallic paint.

**People:** the streets are filled with pedestrians who walk the sidewalks, stop to idle, and run from gunfire and explosions. Walk up to anyone and press **E** to talk. Fans want photos, some people tip you off to a nearby salvage crate (JUNO marks it), some beg for help with a raid in progress, and some just complain. People wave or cheer when you land near them, stumble if you bump into them, and cheer after you stop a raid or finish a mission. Civilians can't be hurt.

**Blood:** hits on Syndicate soldiers spray blood, and downed soldiers leave a pool. Turn it off in **Settings → Blood effects**. There are more of them at higher quality settings. Syndicate soldiers have real faces, with eyes, brows, beards and hair under their helmets.

The city mixes many building shapes: round and octagonal towers, twisting towers, stepped "wedding-cake" towers with pyramid caps, twin towers joined by a sky bridge, L- and U-shaped blocks, domed civic buildings, Old Town houses with pitched roofs and church steeples, sawtooth-roof factories, grain silos, arched warehouses and harbor cranes.


You get bloom glow, reflective glass towers, an animated sea, sunset clouds and stars, street lamps, traffic headlights, blinking rooftop beacons and polished metal armor. Boosting adds lens streaks. If it runs slowly, lower **Settings → Graphics quality**. Phones start on Low.

## Story

Engineer Rhea Kade and her AI, JUNO, defend Port Halcyon from the Cobalt Syndicate. The Syndicate's leader, Silas Marrow, stole Rhea's Starheart reactor designs to build his own war suit.

1. **First Flight**: flight tutorial
2. **Workbench Online**: build your first custom weapon
3. **Dockside Raid**: drones and rooftop turrets at the docks
4. **Iron Convoy**: stop armored trucks before they escape
5. **Blackout**: defend the power station against waves of enemies
6. **Data Trail**: recover 4 guarded data cores in Old Town
7. **Skyhook**: destroy jammer towers, then a gunship boss
8. **Cobalt Colossus**: final 3-phase boss fight on top of Cobalt Tower

**Act II: The Nightjar.** Marrow's head of operations, Vesper Hale, has gathered the Syndicate remnants on **Blackwater Rock**, an old prison island south of the harbor, across the **Halcyon Bridge**.

9. **Aftershock**: rooftop snipers (watch for the red laser), rocket troopers and riot-shield troopers
10. **Ghost Signal**: tail a courier across the city. Stay in signal range, but don't get close enough to be spotted
11. **Bridge Siege**: defuse four demolition charges on the bridge against the clock (hold E), then bring down the Ironback walker. Its weak point is the reactor vents on its back
12. **Blackwater**: knock out four flak batteries on the island, then fight Hale in the Nightjar, a stealth suit that cloaks. A shockwave or the Core Lance knocks her out of cloak

Act II rewards are tier 5 parts that never drop anywhere else (Vortex Launcher, Mirror Lattice, Eclipse Core, Nightjar Drive).

After each mission, fly into the **yellow beacon** to start the next one. Between missions (from mission 3 on), Syndicate raids pop up around the city. There are also **45 salvage crates** on rooftops. Your helmet's scanner range decides how far away you can see them.

## Suit abilities and upgrades

Every suit has three abilities on top of its weapons and the Core Lance: **Shield** (hold F), **Shockwave** (G) and **Dash** (R). They show in the ability strip above the weapon bar.

**Tech Points** buy suit upgrades in the **Upgrades** tab at any workbench. You earn them from story missions (+3), stopped raids (+1), every 5 salvage crates (+1) and race medals (+1 bronze, +1 silver, +2 gold, the first time you earn each). There are six upgrade lines with three levels each: Armor Systems, Reactor Tuning, Shield Matrix (level 3 reflects bolts back at the shooter), Shockwave Emitter (level 3 stuns), Thruster Overdrive and Lance Capacitor. Upgrades apply to every suit you build. Old saves get Tech Points for the progress they already have.

## Ring races

Green light beacons mark four ring races: **Harbor Sprint** (through both bridge towers and under the deck), **Downtown Slalom** (street canyons), **Skyline Circuit** (over the Uptown spires) and **Rock Run** (round Blackwater Rock, unlocked after Act II). Fly to a beacon, press E, and fly through every ring. Medal times are shown before the start; your best time and medal are saved.

## Workbenches and crafting

There are 7 workbenches out in the world (look for the blue light beams), including one at the Blackwater Rock outpost, plus the hangar inside AEGIS Tower. At any of them you can:

- **Build weapons** from 5 slots: Emitter, Power Cell, Lens, Modifier and Cooling. Emitters set the base weapon: pulse blaster, micro-missiles, scatter, rail driver, arc caster, nova mortar or minigun. Other parts add damage, fire rate, homing, explosions, piercing, chain lightning, cryo slow and heat control. You can also pick the energy color.
- **Build suits** from 4 slots: Plating, Thrusters, Reactor and Helmet, with your own two-color paint. You get a live 3D preview.
- **Equip** any weapon build as primary or secondary, and any suit build.
- **Edit or dismantle** builds. Dismantling returns every part.
- **Fast travel** to any workbench you've discovered, and **save**.

**The only limit is your parts.** Each build uses real parts from your inventory. If you own two Rail Drivers, you can have two rail weapons. Parts drop from enemies, salvage crates, stopped raids and mission rewards, and better parts unlock as the story goes on.

## Modding

All game content is in `game/js/data.js`:
- To add a part, add an entry to `PARTS` with a `slot`, `tier` and stats. It will show up in the workbench and in the loot pool automatically.
- To add or change a mission, edit `MISSIONS`. The stage types are `goto`, `craft`, `kill`, `convoy`, `defend`, `collect`, `destroy`, `boss`, `chase` and `defuse`. Enemy types for `kill` stages include `trooper`, `turret`, `drone`, `sniper`, `rocketeer` and `riot`, and a `mix` list spawns several types. Bosses can be `gunship`, `colossus`, `walker` or `nightjar`.
- To add a race, add an entry to `RACES` with a start point and a list of rings. Medal times are worked out from the course length.
- Upgrade costs are in `UPGRADES`.
- To move a workbench, edit `BENCHES`. The city keeps that block clear for it.

## Credits

- Game code: MIT license (see `LICENSE`).
- [three.js](https://threejs.org) © 2010-2023 three.js authors, MIT license.
- All characters, the city and the story are original. Sound effects are generated in code at runtime, so there are no audio files.
