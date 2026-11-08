// AEGIS: Port Halcyon — world clock and weather.
// Drives the graphics engine (sun/moon, sky, lamps, rain) and the audio engine (rain, thunder).
// Settings: time mode (dynamic / dawn / day / sunset / night) and weather (dynamic / clear / rain).
window.CLIMATE = (function () {
  'use strict';
  const PRESET = { dawn: 6.3, day: 12.5, sunset: 17.1, night: 22.5 };
  const S = { hours: 17.1, rain: 0, rainTarget: 0, weatherT: 90, flash: 0, flashT: 0, nextBolt: 8, boltQueue: [], lastNight: null, lastRain: false };
  const HOUR_SECONDS = 40; // one in-game hour = 40 real seconds (a full day is 16 minutes)

  function settings() { return (window.G && G.settings) || {}; }
  function update(dt, ctx) {
    const st = settings();
    const mode = st.timeMode || 'dynamic', weather = st.weather || 'dynamic';
    // --- clock
    if (mode === 'dynamic') { if (ctx.running) S.hours = (S.hours + dt / HOUR_SECONDS) % 24; }
    else { const tgt = PRESET[mode] || 17.1; S.hours += (tgt - S.hours) * Math.min(1, dt * 2); }
    // --- weather: occasional storms that roll in and clear up
    if (weather === 'clear') S.rainTarget = 0;
    else if (weather === 'rain') S.rainTarget = 1;
    else if (ctx.running) {
      S.weatherT -= dt;
      if (S.weatherT <= 0) { const storm = S.rainTarget < 0.5 && Math.random() < 0.45; S.rainTarget = storm ? 0.75 + Math.random() * 0.25 : 0; S.weatherT = storm ? 120 + Math.random() * 120 : 150 + Math.random() * 200; }
    }
    S.rain += (S.rainTarget - S.rain) * Math.min(1, dt * 0.08);
    if (Math.abs(S.rain - S.rainTarget) < 0.002) S.rain = S.rainTarget;
    // --- lightning during heavy rain
    S.flash = Math.max(0, S.flash - dt * 5);
    if (S.rain > 0.65 && ctx.running) {
      S.nextBolt -= dt;
      if (S.nextBolt <= 0) {
        S.nextBolt = 6 + Math.random() * 16;
        S.flash = 1; S.boltQueue.push(0.12 + Math.random() * 0.1);
        const dist = 300 + Math.random() * 2500;
        setTimeout(() => window.AUDIO && AUDIO.play('thunder', Math.max(0.3, 1.2 - dist / 3000)), (dist / 343) * 1000);
      }
    }
    for (let i = S.boltQueue.length - 1; i >= 0; i--) { S.boltQueue[i] -= dt; if (S.boltQueue[i] <= 0) { S.flash = Math.max(S.flash, 0.7); S.boltQueue.splice(i, 1); } }
    GFX.setEnvironment(S.hours, S.rain, S.flash, !!ctx.indoors);
    if (window.AUDIO && AUDIO.setRain) AUDIO.setRain(ctx.indoors ? S.rain * 0.25 : S.rain);
    // --- JUNO remarks when the weather or the light changes
    const night = GFX.envState.nightK > 0.6;
    if (ctx.running && window.G && G.UI && G.UI.juno) {
      if (S.lastNight !== null && night !== S.lastNight) G.UI.juno.bark(night ? 'night' : 'dawn', null, { cd: 120000 });
      const raining = S.rain > 0.4;
      if (raining !== S.lastRain) G.UI.juno.bark(raining ? 'rain' : 'clear', null, { cd: 120000 });
      S.lastRain = raining;
    }
    S.lastNight = night;
  }
  function clock() { const h = Math.floor(S.hours), m = Math.floor((S.hours - h) * 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
  function label() { return clock() + (S.rain > 0.4 ? ' · RAIN' : GFX.envState.nightK > 0.6 ? ' · NIGHT' : ''); }
  function setHours(h) { S.hours = ((h % 24) + 24) % 24; }
  return { update, clock, label, setHours, get hours() { return S.hours; }, get rain() { return S.rain; }, state: S };
})();
