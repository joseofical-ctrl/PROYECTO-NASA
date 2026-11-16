// Generates the 16 public/minigames/*.html files from minijuegos_origen/*.html + new-minigames.cjs
// Applies React bridge integration, role badges, live threat state sync, UX polish, and smooth victory exit.
const fs = require('fs')
const path = require('path')
const { getNewMinigames } = require('./new-minigames.cjs')

const SRC = path.join(__dirname, '..', 'minijuegos_origen')
const OUT = path.join(__dirname, '..', 'public', 'minigames')
fs.mkdirSync(OUT, { recursive: true })

function stripOldInjections(html) {
  return html
    .replace(/\s*<style data-mg-safe-css="1">[\s\S]*?<\/style>/g, '')
    .replace(/\s*<script>\s*\/\* === (?:Puente con la Estación Espacial|Space Station Bridge) \(iframe -> React\) === \*\/[\s\S]*?<\/script>/g, '')
    .replace(/\s*\/\* === THREAT_SYNC_START === \*\/[\s\S]*?\/\* === THREAT_SYNC_END === \*\//g, '')
    .replace(/\s*\/\* === VERIFY_SYS_START === \*\/[\s\S]*?\/\* === VERIFY_SYS_END === \*\//g, '')
}

function readFirstAvailable(candidates, fallbackOutName) {
  for (const f of candidates) {
    const p = path.join(SRC, f)
    if (fs.existsSync(p)) {
      return stripOldInjections(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))
    }
  }
  if (fallbackOutName) {
    const outPath = path.join(OUT, fallbackOutName)
    if (fs.existsSync(outPath)) {
      return stripOldInjections(fs.readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n'))
    }
  }
  throw new Error('Source file not found among: ' + candidates.join(', '))
}

function replaceOnce(src, find, repl, label) {
  const idx = typeof find === 'string' ? src.indexOf(find) : src.search(find)
  if (idx < 0) throw new Error('Patch not applied: ' + label)
  return src.replace(find, () => repl)
}

function injectInsideMainScript(src, snippet) {
  const idx = src.lastIndexOf('</script>')
  if (idx < 0) throw new Error('Main closing </script> not found')
  return src.slice(0, idx) + '\n' + snippet + '\n' + src.slice(idx)
}

const VICTORY_BUTTON_LABELS = {
  dock: '[ ✔ SEAL AIRLOCK & CONFIRM DOCKING ]',
  comet: '[ ✔ DEACTIVATE TURRET & RETURN TO BRIDGE ]',
  gyro: '[ ✔ LOCK CMG GIMBALS & EXIT ]',
  debris: '[ ✔ CONFIRM CLEAR TRAJECTORY ]',
  eps: '[ ✔ LOCK EPS MATRIX & CLOSE CONSOLE ]',
  eclss: '[ ✔ SEAL ECLSS PARAMETERS & EXIT ]',
  reactor: '[ ✔ STABILIZE CRYOGENIC FLOW ]',
  pcb: '[ ✔ CLOSE PCB BREAKERS & FINISH ]',
  nav: '[ ✔ LOCK HOHMANN ORBIT & CONTINUE ]',
  lander: '[ ✔ TRANSMIT PROBE SAMPLES & EXIT ]',
  spectro: '[ ✔ SAVE CHEMICAL SPECTRUM & ACCEPT ]',
  thermal: '[ ✔ SEND THERMAL CAPTURE & CLOSE ]',
  telecom: '[ ✔ LOCK DSN FREQUENCY & ACCEPT ]',
  cyber: '[ ✔ SEAL FIREWALL 8080 & CONTINUE ]',
  hga: '[ ✔ LOCK HGA BEAM & RETURN ]',
  decrypt: '[ ✔ AUTHORIZE QUANTUM CRC KEY ]',
}

const liveThreatSyncScript = (gameId) => `
        /* === THREAT_SYNC_START === */
        (function () {
          var initialDiffApplied = false;
          var initialSeedApplied = false;
          function seededUnit(seedVal, salt) {
            var x = Math.sin((seedVal || 1) * 12.9898 + (salt || 0) * 78.233) * 43758.5453;
            return x - Math.floor(x);
          }

          function applyLiveThreatState(data) {
            if (!data || typeof data !== 'object') return;
            try {
              var gid = '${gameId}';
              var nDiff = Number(data.diff);
              if (!initialDiffApplied && isFinite(nDiff) && nDiff >= 1 && nDiff <= 3) {
                initialDiffApplied = true;
                var dInt = Math.round(nDiff);
                var ds = document.getElementById('diffSelect') || document.getElementById('difficulty-select');
                if (ds) ds.value = String(dInt);
                if (typeof changeDifficulty === 'function') {
                  changeDifficulty(dInt);
                } else if (typeof setupDifficulty === 'function') {
                  setupDifficulty(dInt);
                } else if (typeof setupScenario === 'function') {
                  setupScenario(dInt);
                } else if (typeof applyDifficulty === 'function') {
                  applyDifficulty(dInt);
                }
              }

              var nAlt = Number(data.alt);
              var nHull = Number(data.hull);
              var nBat = Number(data.battery);
              var nO2 = Number(data.o2);
              var nSig = Number(data.signal);
              var nOrbit = Number(data.orbit);

              if (gid === 'lander' && isFinite(nAlt) && nAlt > 20 && nAlt <= 500 && typeof altitude === 'number') {
                altitude = Math.max(45, Math.round(nAlt));
                if (typeof velocity === 'number') {
                  velocity = Math.max(8, +(11 + (500 - altitude) * 0.015).toFixed(1));
                }
              }
              if (gid === 'comet' && isFinite(nHull) && nHull > 15 && nHull <= 100 && typeof hull === 'number') {
                hull = Math.round(nHull);
              }
              if (gid === 'eps' && isFinite(nBat) && nBat > 10 && nBat <= 100 && typeof battery === 'object' && battery) {
                battery.cur = Math.max(6, Math.round((nBat / 100) * battery.cap));
                if (typeof inEclipse === 'boolean' && nBat < 96) inEclipse = true;
              }
              if (gid === 'eclss' && isFinite(nO2) && nO2 > 10 && nO2 < 100 && typeof o2Val === 'number') {
                o2Val = +(16.6 + (nO2 / 100) * 4.4).toFixed(2);
                if (typeof co2Val === 'number') {
                  co2Val = +(0.04 + ((100 - nO2) / 100) * 0.85).toFixed(2);
                }
                if (typeof pressVal === 'number') {
                  pressVal = +(91 + (nO2 / 100) * 10.3).toFixed(1);
                }
              }
              if (gid === 'dock' && isFinite(nOrbit) && nOrbit > 15 && nOrbit < 100 && typeof state === 'object' && state && state.pos) {
                state.pos.z = Math.min(68, +(state.pos.z + (100 - nOrbit) * 0.22).toFixed(1));
              }
              if (gid === 'nav' && isFinite(nOrbit) && nOrbit > 15 && nOrbit < 100 && typeof orbitState === 'object' && orbitState) {
                var driftKm = Math.round((100 - nOrbit) * 0.45);
                if (orbitState.altitude < orbitState.targetAlt) {
                  orbitState.altitude = Math.max(290, orbitState.altitude - driftKm);
                } else {
                  orbitState.altitude = Math.min(820, orbitState.altitude + driftKm);
                }
                orbitState.deltaV = 15;
              }
              if (gid === 'telecom' && isFinite(nSig) && nSig > 15 && nSig < 100 && typeof userFreq === 'number') {
                var offset = Math.round((100 - nSig) * 0.25);
                userFreq = Math.max(10, Math.min(100, userFreq + (userFreq < 50 ? -offset : offset)));
                var sf = document.getElementById('sliderFreq');
                if (sf) sf.value = String(userFreq);
              }
              if (gid === 'cyber' && isFinite(nSig) && nSig > 15 && nSig <= 100 && typeof shieldIntegrity === 'number') {
                shieldIntegrity = Math.max(40, Math.min(100, Math.round(nSig)));
              }

              var nAttempt = Number(data.attempt);
              var nSeed = Number(data.seed);
              if (!initialSeedApplied && ((isFinite(nAttempt) && nAttempt >= 2) || (isFinite(nSeed) && nSeed > 0 && nAttempt >= 1))) {
                initialSeedApplied = true;
                var seedVal = isFinite(nSeed) && nSeed > 0 ? nSeed : (Math.round(nAttempt || 2) * 97 + 13);
                if (nAttempt >= 2) {
                  if (gid === 'nav' && typeof orbitState === 'object' && orbitState) {
                    var candAlt = Math.round(340 + seededUnit(seedVal, 1) * 410);
                    if (Math.abs(candAlt - orbitState.altitude) < 90) {
                      candAlt = orbitState.altitude > 520 ? Math.max(320, orbitState.altitude - 140) : Math.min(780, orbitState.altitude + 140);
                    }
                    orbitState.targetAlt = candAlt;
                    if (typeof sats !== 'undefined' && Array.isArray(sats) && sats[0]) {
                      sats[0].targetAlt = candAlt;
                      if (sats[1]) {
                        sats[1].targetAlt = Math.max(300, Math.min(820, candAlt + (seededUnit(seedVal, 2) > 0.5 ? 55 : -55)));
                      }
                      if (typeof refreshSatSelectors === 'function') refreshSatSelectors();
                    }
                  } else if (gid === 'telecom') {
                    if (typeof targetFreq === 'number') targetFreq = Math.round(28 + seededUnit(seedVal, 1) * 58);
                    if (typeof targetGain === 'number') targetGain = Math.round(30 + seededUnit(seedVal, 2) * 56);
                  } else if (gid === 'eps') {
                    if (typeof inEclipse === 'boolean') inEclipse = true;
                    if (typeof battery === 'object' && battery) {
                      battery.cur = Math.min(battery.cur, Math.round(battery.cap * (0.48 + seededUnit(seedVal, 1) * 0.24)));
                    }
                  } else if (gid === 'eclss') {
                    if (typeof o2Val === 'number') o2Val = +(18.5 + seededUnit(seedVal, 1) * 1.4).toFixed(2);
                    if (typeof co2Val === 'number') co2Val = +(0.25 + seededUnit(seedVal, 2) * 0.35).toFixed(2);
                  } else if (gid === 'dock' && typeof state === 'object' && state && state.pos) {
                    state.pos.x = +((seededUnit(seedVal, 1) - 0.5) * 0.44).toFixed(2);
                    state.pos.y = +((seededUnit(seedVal, 2) - 0.5) * 0.40).toFixed(2);
                    state.pos.z = 10.0;
                    if (state.vel) { state.vel.x = 0.0; state.vel.y = 0.0; state.vel.z = -0.85; }
                    if (state.rot) { state.rot.yaw = 0.2; state.rot.pitch = -0.2; state.rot.roll = 0.1; }
                  } else if (gid === 'lander' && typeof altitude === 'number') {
                    altitude = Math.round(150 + seededUnit(seedVal, 1) * 30);
                    if (typeof velocity === 'number') velocity = +(4.5 + seededUnit(seedVal, 2) * 3.0).toFixed(1);
                  } else if (gid === 'comet' && typeof hull === 'number') {
                    hull = Math.round(78 + seededUnit(seedVal, 1) * 18);
                  } else if (gid === 'cyber' && typeof shieldIntegrity === 'number') {
                    shieldIntegrity = Math.round(75 + seededUnit(seedVal, 1) * 20);
                  } else if (gid === 'gyro' && typeof omega === 'object' && omega) {
                    omega.pitch = (seededUnit(seedVal, 1) > 0.5 ? 1 : -1) * +(0.09 + seededUnit(seedVal, 2) * 0.06).toFixed(2);
                    omega.roll = (seededUnit(seedVal, 3) > 0.5 ? 1 : -1) * +(0.09 + seededUnit(seedVal, 4) * 0.06).toFixed(2);
                    omega.yaw = (seededUnit(seedVal, 5) > 0.5 ? 1 : -1) * +(0.07 + seededUnit(seedVal, 6) * 0.05).toFixed(2);
                  } else if (gid === 'debris' && typeof targetTime === 'number') {
                    targetTime = Math.round(8 + seededUnit(seedVal, 1) * 2);
                  } else if (gid === 'reactor' && typeof cores !== 'undefined' && Array.isArray(cores)) {
                    for (var ci = 0; ci < cores.length; ci++) {
                      cores[ci] = Math.round(560 + seededUnit(seedVal, ci + 1) * 75);
                    }
                  } else if (gid === 'spectro' && typeof SAMPLES !== 'undefined' && Array.isArray(SAMPLES)) {
                    for (var si = 0; si < SAMPLES.length; si++) {
                      SAMPLES[si].freq = Math.round(200 + seededUnit(seedVal, si * 2 + 1) * 580);
                      SAMPLES[si].heat = Math.round(25 + seededUnit(seedVal, si * 2 + 2) * 60);
                    }
                  } else if (gid === 'hga') {
                    if (typeof satAz === 'number') satAz = Math.round(seededUnit(seedVal, 1) * 340);
                    if (typeof satEl === 'number') satEl = Math.round(35 + seededUnit(seedVal, 2) * 35);
                    if (typeof satPol === 'number') satPol = [-35, -20, 20, 30, -25, 35][Math.floor(seededUnit(seedVal, 3) * 6)];
                  }
                }
              }
              if (typeof updateSliders === 'function') updateSliders();
              if (typeof updateOptics === 'function') updateOptics();
              if (typeof updateDish === 'function') updateDish();
              if (typeof updateUI === 'function') updateUI();
            } catch (err) {}
          }

          function readSearchParams() {
            if (typeof URLSearchParams === 'undefined') return {};
            var qs = new URLSearchParams(window.location.search || '');
            var obj = {};
            qs.forEach(function (v, k) { obj[k] = v; });
            return obj;
          }

          window.addEventListener('load', function () {
            window.setTimeout(function () {
              applyLiveThreatState(readSearchParams());
            }, 35);
          });

          window.addEventListener('message', function (e) {
            if (e.data && e.data.type === 'THREAT_SYNC') {
              applyLiveThreatState(e.data);
            }
          });
        })();
        /* === THREAT_SYNC_END === */
`

const bridge = (gameId) => `
<script>
/* === Space Station Bridge (iframe -> React) === */
(function () {
  var wonPending = false;
  var victorySent = false;
  var failReported = false;

  function showConsoleHudNotice(msg, kind) {
    if (typeof window.__setVerifyBanner === 'function') {
      window.__setVerifyBanner(msg, kind === 'ok', 2200);
      return;
    }
    try {
      var el = document.getElementById('verifyFeedbackBanner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'verifyFeedbackBanner';
        el.style.cssText = 'position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:99999;max-width:92vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:5px 14px;font-family:"Courier New",monospace;font-size:11.5px;font-weight:bold;border-radius:4px;pointer-events:none;transition:all 0.2s;';
        document.body.appendChild(el);
      }
      var isOk = kind === 'ok';
      el.textContent = String(msg || '');
      el.style.border = isOk ? '1px solid #00ff88' : '1px solid #fbbf24';
      el.style.background = isOk ? 'rgba(2,44,34,0.94)' : 'rgba(48,28,4,0.94)';
      el.style.color = isOk ? '#86efac' : '#fde68a';
      el.style.display = 'block';
    } catch (e) {}
  }
  window.__showConsoleHudNotice = showConsoleHudNotice;
  window.alert = function (msg) { showConsoleHudNotice(msg, 'warn'); };

  function notifyVictory() {
    if (victorySent) return;
    victorySent = true;
    wonPending = false;
    var payload = { type: 'MINIGAME_COMPLETE', game: '${gameId}', success: true };
    try { window.parent.postMessage(payload, '*'); } catch (e) {}
    try { window.parent.postMessage({ type: 'minigame-complete', game: '${gameId}', success: true }, '*'); } catch (e) {}
  }
  window.__notifyVictoryNow = notifyVictory;

  function notifyFailure() {
    if (failReported || wonPending || victorySent) return;
    failReported = true;
    try { window.parent.postMessage({ type: 'MINIGAME_FAILED', game: '${gameId}' }, '*'); } catch (e) {}
  }
  window.__notifyFailureNow = notifyFailure;

  function closeFrameNow() {
    try { window.parent.postMessage({ type: 'minigame-close', game: '${gameId}' }, '*'); } catch (err) {}
  }
  window.__closeFrameNow = closeFrameNow;

  function updateDebriefActionButton(isVictory) {
    var modal = document.getElementById('debriefModal');
    if (!modal) return;
    var btn =
      modal.querySelector('button[data-solved-btn="1"]') ||
      modal.querySelector('button[onclick*="nextLevel"]');
    if (!btn) return;
    btn.setAttribute('data-solved-btn', '1');
    if (!btn.hasAttribute('data-orig-label')) {
      btn.setAttribute('data-orig-label', btn.textContent || 'NEXT LEVEL');
    }
    if (!btn.hasAttribute('data-bridge-click')) {
      btn.setAttribute('data-bridge-click', '1');
      btn.addEventListener('click', function () {
        if (wonPending) {
          modal.style.display = 'none';
          notifyVictory();
          closeFrameNow();
        }
      });
    }
    if (isVictory) {
      btn.textContent = ${JSON.stringify(VICTORY_BUTTON_LABELS[gameId] || '[ ✔ RETURN TO STATION (SYSTEM STABILIZED) ]')};
      btn.style.background = 'linear-gradient(180deg, #059669 0%, #047857 100%)';
      btn.style.borderColor = '#00ff88';
      btn.style.color = '#ffffff';
      btn.style.fontWeight = 'bold';
      btn.style.boxShadow = '0 0 14px rgba(0, 255, 136, 0.45)';
    } else {
      btn.textContent = btn.getAttribute('data-orig-label') || 'RETRY';
      btn.style.background = '#1e293b';
      btn.style.borderColor = '#475569';
      btn.style.color = '#e2e8f0';
      btn.style.boxShadow = 'none';
    }
  }

  function markPendingWin() {
    wonPending = true;
    updateDebriefActionButton(true);
    try { window.parent.postMessage({ type: 'MINIGAME_WON_PENDING', game: '${gameId}' }, '*'); } catch (e) {}
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (wonPending) notifyVictory();
      closeFrameNow();
    }
  });

  // 1) Minijuegos nuevos: completeMission(...) y failMission(...)
  var origComplete = window.completeMission;
  if (typeof origComplete === 'function') {
    window.completeMission = function (arg0) {
      var r = origComplete.apply(this, arguments);
      if (arg0 !== false) markPendingWin();
      else {
        wonPending = false;
        updateDebriefActionButton(false);
        notifyFailure();
      }
      return r;
    };
  }

  var origFail = window.failMission;
  if (typeof origFail === 'function') {
    window.failMission = function () {
      wonPending = false;
      updateDebriefActionButton(false);
      notifyFailure();
      return origFail.apply(this, arguments);
    };
  }

  // 2) Minijuegos v2: showDebriefModal(success, ...)
  var origDebrief = window.showDebriefModal;
  if (typeof origDebrief === 'function') {
    window.showDebriefModal = function (success) {
      var r = origDebrief.apply(this, arguments);
      if (success === true) {
        markPendingWin();
      } else {
        wonPending = false;
        updateDebriefActionButton(false);
        notifyFailure();
      }
      return r;
    };
  }

  // 3) Botón final del informe técnico: al ganar, notifica MINIGAME_COMPLETE y cierra el modal al instante
  ['nextLevel', 'nextLevelOrFinish'].forEach(function (fnName) {
    var origNext = window[fnName];
    window[fnName] = function () {
      if (wonPending) {
        var modal = document.getElementById('debriefModal');
        if (modal) modal.style.display = 'none';
        notifyVictory();
        closeFrameNow();
        return;
      }
      if (typeof origNext === 'function') {
        return origNext.apply(this, arguments);
      }
    };
  });

  // Reinicio limpio si reintenta
  ['resetMission', 'setupScenario', 'setupDifficulty', 'closeModalAndRetry'].forEach(function (fnName) {
    var origFn = window[fnName];
    if (typeof origFn === 'function') {
      window[fnName] = function () {
        wonPending = false;
        victorySent = false;
        failReported = false;
        updateDebriefActionButton(false);
        return origFn.apply(this, arguments);
      };
    }
  });

  // 4) Auto-resize universal del <canvas> principal + ResizeObserver + vigilancia por frame
  var MINI_CANVAS_SKIP = { satCanvas1: true, satCanvas2: true, trendCanvas: true };
  function ensureMainCanvasesSized() {
    try {
      var list = document.querySelectorAll('canvas');
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || MINI_CANVAS_SKIP[c.id]) continue;
        var pw = c.parentElement ? c.parentElement.clientWidth : 0;
        var ph = c.parentElement ? c.parentElement.clientHeight : 0;
        if (c.width < 100 || c.height < 100) {
          c.width = Math.max(480, pw >= 100 ? pw : Math.floor((window.innerWidth || 960) * 0.55));
          c.height = Math.max(320, ph >= 100 ? ph : Math.floor((window.innerHeight || 640) * 0.70));
        } else if (pw >= 120 && ph >= 120 && (Math.abs(c.width - pw) > 4 || Math.abs(c.height - ph) > 4)) {
          c.width = pw;
          c.height = ph;
        }
      }
    } catch (e) {}
  }

  function installCanvasObservers() {
    ensureMainCanvasesSized();
    try {
      if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(function () {
          ensureMainCanvasesSized();
        });
        var canvases = document.querySelectorAll('canvas');
        for (var i = 0; i < canvases.length; i++) {
          var c = canvases[i];
          if (c && !MINI_CANVAS_SKIP[c.id] && c.parentElement) {
            ro.observe(c.parentElement);
          }
        }
      }
    } catch (e) {}
    var watchFrames = 0;
    function frameGuard() {
      ensureMainCanvasesSized();
      watchFrames++;
      if (watchFrames < 90) {
        requestAnimationFrame(frameGuard);
      }
    }
    requestAnimationFrame(frameGuard);
  }

  installCanvasObservers();
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'REQUEST_VERIFY_MINIGAME') {
      if (typeof window.__verifyAndConfirmMinigame === 'function') {
        window.__verifyAndConfirmMinigame();
      }
    }
  });
  window.addEventListener('DOMContentLoaded', ensureMainCanvasesSized);
  window.addEventListener('resize', ensureMainCanvasesSized);
  window.addEventListener('load', function () {
    try { window.focus(); } catch (e) {}
    ensureMainCanvasesSized();
    window.setTimeout(ensureMainCanvasesSized, 60);
    window.setTimeout(ensureMainCanvasesSized, 240);
  });
})();
</script>
`

const verifySystemScript = (gameId) => `
        /* === VERIFY_SYS_START === */
        (function () {
          var manualHoldUntil = 0;

          function playVerifyWarnTone() {
            try {
              var Ctx = window.AudioContext || window.webkitAudioContext;
              if (!Ctx) return;
              if (!window.__mgVerifyAudio) window.__mgVerifyAudio = new Ctx();
              var ctx = window.__mgVerifyAudio;
              if (ctx.state === 'suspended') ctx.resume();
              var now = ctx.currentTime;
              var osc = ctx.createOscillator();
              var gain = ctx.createGain();
              osc.type = 'triangle';
              osc.frequency.setValueAtTime(240, now);
              osc.frequency.exponentialRampToValueAtTime(175, now + 0.16);
              gain.gain.setValueAtTime(0.11, now);
              gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start(now);
              osc.stop(now + 0.19);
            } catch (e) {}
          }

          function playVerifySuccessTone() {
            try {
              var Ctx = window.AudioContext || window.webkitAudioContext;
              if (!Ctx) return;
              if (!window.__mgVerifyAudio) window.__mgVerifyAudio = new Ctx();
              var ctx = window.__mgVerifyAudio;
              if (ctx.state === 'suspended') ctx.resume();
              var now = ctx.currentTime;
              var osc = ctx.createOscillator();
              var gain = ctx.createGain();
              osc.type = 'triangle';
              osc.frequency.setValueAtTime(660, now);
              osc.frequency.setValueAtTime(880, now + 0.08);
              gain.gain.setValueAtTime(0.14, now);
              gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start(now);
              osc.stop(now + 0.25);
            } catch (e) {}
          }

          function setVerifyBanner(msg, isOk, holdMs) {
            try {
              var modal = document.getElementById('debriefModal');
              var el = document.getElementById('verifyFeedbackBanner');
              if (modal && modal.style.display === 'flex') {
                if (el) el.style.display = 'none';
                return;
              }
              if (!el) {
                el = document.createElement('div');
                el.id = 'verifyFeedbackBanner';
                el.style.cssText = 'position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:99999;max-width:92vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:5px 14px;font-family:"Courier New",monospace;font-size:11.5px;font-weight:bold;border-radius:4px;pointer-events:none;transition:all 0.18s;';
                document.body.appendChild(el);
              }
              if (holdMs) manualHoldUntil = Date.now() + holdMs;
              el.textContent = String(msg || '').replace(/\\s+/g, ' ').trim();
              el.style.border = isOk ? '1px solid #00ff88' : '1px solid #fbbf24';
              el.style.background = isOk ? 'rgba(2,44,34,0.94)' : 'rgba(48,28,4,0.94)';
              el.style.color = isOk ? '#86efac' : '#fde68a';
              el.style.display = el.textContent ? 'block' : 'none';
            } catch (e) {}
          }
          window.__setVerifyBanner = setVerifyBanner;

          function showStepAmber(msg) {
            playVerifyWarnTone();
            setVerifyBanner(msg, false, 2400);
            return false;
          }

          function approveVerifiedSystem(okMsg) {
            playVerifySuccessTone();
            setVerifyBanner(okMsg, true, 3000);
            if (window.__notifyVictoryNow) window.__notifyVictoryNow();
            return true;
          }

          var NEW_OK_LABELS = {
            gyro: '✔ CMG GIMBALS STABILIZED',
            debris: '✔ KESSLER CORRIDOR CLEARED',
            reactor: '✔ REACTOR CORES COOLED',
            pcb: '✔ PCB CIRCUITS ROUTED PROPERLY',
            spectro: '✔ SPECTROMETRY COMPLETED',
            thermal: '✔ MULTISPECTRAL SCAN VALIDATED',
            hga: '✔ PARABOLIC HGA / DSN LINK CONFIRMED',
            decrypt: '✔ QUANTUM CHANNEL DECRYPTED'
          };

          function evalVerifyStatus(gid) {
            switch (gid) {
              case 'dock': {
                if (typeof state !== 'object' || !state || !state.pos) return { ready: true, okMsg: '✔ APAS DOCKING VERIFIED' };
                var lat = Math.hypot(state.pos.x, state.pos.y);
                return {
                  ready: lat <= 1.50,
                  needMsg: 'Center lateral offset <= 1.50m (current ' + lat.toFixed(2) + 'm) using WASD/Arrows',
                  okMsg: '✔ Ready: offset ' + lat.toFixed(2) + 'm — Press [ CONFIRM ] above',
                  onApprove: function () { state.pos.z = 0; state.isEnded = true; }
                };
              }
              case 'comet': {
                if (typeof hull === 'number' && hull <= 0) {
                  return { ready: false, needMsg: 'Hull at 0%: press RESET above' };
                }
                var sc = typeof score === 'number' ? score : 0;
                return {
                  ready: sc >= 3,
                  needMsg: 'Destroy ' + (3 - sc) + ' more meteorite(s) by clicking to confirm (' + sc + '/3)',
                  okMsg: '✔ Ready: ' + sc + ' meteorites destroyed — Press [ CONFIRM ] above',
                  onApprove: function () { if (typeof isMissionEnded !== 'undefined') isMissionEnded = true; }
                };
              }
              case 'eps': {
                if (typeof state !== 'object' || !state || !Array.isArray(state.loads)) return { ready: true, okMsg: '✔ EPS MATRIX NOMINAL' };
                var sv = state.loads[0] && state.loads[0].active ? state.loads[0].power : 0;
                var bat = Math.round(state.battery || 0);
                var okEps = sv >= 50 && state.battery > 15;
                return {
                  ready: okEps,
                  needMsg: sv < 50 ? 'Raise Life Support >= 50 MW or press AUTO-BALANCE' : 'Battery <= 15% (' + bat + '%): press AUTO-BALANCE LOADS',
                  okMsg: '✔ Ready: Life Support ' + sv + ' MW & Battery ' + bat + '% — Press [ CONFIRM ] above',
                  onApprove: function () { state.isEnded = true; }
                };
              }
              case 'eclss': {
                var o2Ok = typeof o2Val !== 'number' || (o2Val >= 18.0 && o2Val <= 26.0);
                var co2Ok = typeof co2Val !== 'number' || co2Val < 1.2;
                var actOk = (typeof activeScrub === 'number' && activeScrub === 1) || (typeof isSealed === 'boolean' && isSealed);
                var msgNeed = !o2Ok
                  ? 'Adjust O2 between 18% and 26% or press AUTO-STABILIZE'
                  : !co2Ok
                    ? 'Reduce CO2 < 1.2% with Canister B or AUTO-STABILIZE'
                    : 'Switch to Canister B or seal airlock to confirm';
                return {
                  ready: o2Ok && co2Ok && actOk,
                  needMsg: msgNeed,
                  okMsg: '✔ Ready: gases nominal and airlock/scrubber OK — Press [ CONFIRM ] above',
                  onApprove: function () { if (typeof isEnded !== 'undefined') isEnded = true; }
                };
              }
              case 'nav': {
                if (typeof isBurning !== 'undefined' && isBurning) {
                  return { ready: false, needMsg: 'Wait 1s for orbital burn to complete' };
                }
                if (typeof orbitState !== 'object' || !orbitState) return { ready: true, okMsg: '✔ HOHMANN ORBIT NOMINAL' };
                var navErr = Math.abs(orbitState.altitude - orbitState.targetAlt);
                var recSigned = Math.round((orbitState.targetAlt - orbitState.altitude) / 0.95);
                var curSigned = orbitState.vector === 'prograde' ? orbitState.deltaV : -orbitState.deltaV;
                var dvDiff = Math.abs(curSigned - recSigned);
                var okNav = Boolean(orbitState.done || navErr <= 45 || dvDiff <= 35);
                return {
                  ready: okNav,
                  needMsg: 'Set Δv near ' + (recSigned >= 0 ? '+' : '-') + Math.abs(recSigned) + ' m/s (±35 m/s) and confirm',
                  okMsg: '✔ Ready: Δv impulse aligned — Press [ CONFIRM ] above',
                  onApprove: function () { orbitState.altitude = orbitState.targetAlt; orbitState.done = true; orbitState.isEnded = true; }
                };
              }
              case 'lander': {
                var vel = typeof velocity === 'number' ? velocity : 0;
                return {
                  ready: vel < 10.0,
                  needMsg: 'Brake with [SPACE] below 10.0 m/s (current ' + vel.toFixed(1) + ' m/s)',
                  okMsg: '✔ Ready: velocity ' + vel.toFixed(1) + ' m/s — Press [ CONFIRM ] above',
                  onApprove: function () {
                    if (typeof altitude !== 'undefined') altitude = 0;
                    if (typeof updateUI === 'function') updateUI();
                    if (typeof isMissionEnded !== 'undefined') isMissionEnded = true;
                  }
                };
              }
              case 'telecom': {
                var fDiff = Math.abs(userFreq - targetFreq);
                var gDiff = Math.abs(userGain - targetGain);
                return {
                  ready: fDiff <= 25 && gDiff <= 20,
                  needMsg: 'Set Freq ~' + targetFreq + ' Hz (±25) and Gain ~' + targetGain + '% (±20)',
                  okMsg: '✔ Ready: DSN signal synchronized — Press [ CONFIRM ] above',
                  onApprove: function () { if (typeof isMissionEnded !== 'undefined') isMissionEnded = true; }
                };
              }
              case 'cyber': {
                if (typeof shieldIntegrity === 'number' && shieldIntegrity <= 0) {
                  return { ready: false, needMsg: 'Shield at 0%: press RESET above' };
                }
                var pc = typeof packetsChecked === 'number' ? packetsChecked : 0;
                return {
                  ready: pc >= 3,
                  needMsg: 'Filter ' + (3 - pc) + ' more packet(s) (green ALLOW / red BLOCK)',
                  okMsg: '✔ Ready: ' + pc + ' packets filtered — Press [ CONFIRM ] above',
                  onApprove: function () { if (typeof isMissionEnded !== 'undefined') isMissionEnded = true; }
                };
              }
              case 'gyro':
              case 'debris':
              case 'reactor':
              case 'pcb':
              case 'spectro':
              case 'thermal':
              case 'hga':
              case 'decrypt': {
                if (gid === 'debris' && typeof hull === 'number' && hull <= 0) return { ready: false, needMsg: 'Hull at 0%: press RESET above' };
                if (gid === 'pcb' && typeof battery === 'number' && battery <= 0) return { ready: false, needMsg: 'Battery depleted: press RESET above' };
                if (gid === 'reactor' && typeof pressure === 'number' && pressure >= 105) return { ready: false, needMsg: 'Overpressure: press RESET above' };
                var interacted = (window.__mgAdjustCount || 0) >= 1;
                var mTime = typeof missionTime === 'number' ? missionTime : 0;
                var okNew = interacted || mTime >= 4.0;
                return {
                  ready: okNew,
                  needMsg: 'Make 1 adjustment (or press AUTO-CALIBRATE / operate ' + Math.max(0.5, 4.0 - mTime).toFixed(1) + 's)',
                  okMsg: '✔ Ready: system calibrated — Press [ CONFIRM ] above',
                  onApprove: function () { if (typeof isEnded !== 'undefined') isEnded = true; }
                };
              }
            }
            return { ready: true, okMsg: '✔ SYSTEM VERIFIED' };
          }

          function refreshLiveVerifyBanner() {
            if (Date.now() < manualHoldUntil) return;
            try {
              var st = evalVerifyStatus('${gameId}');
              setVerifyBanner(st.ready ? st.okMsg : ('⚡ ' + st.needMsg), st.ready, 0);
            } catch (e) {}
          }

          function verifyAndConfirmMinigame() {
            var gid = '${gameId}';
            try {
              var st = evalVerifyStatus(gid);
              if (!st.ready) return showStepAmber('⚡ ' + (st.needMsg || 'Complete the indicated step'));
              if (typeof st.onApprove === 'function') st.onApprove();
              return approveVerifiedSystem(NEW_OK_LABELS[gid] || st.okMsg || '✔ SYSTEM STABILIZED');
            } catch (err) {}
            return false;
          }

          window.__verifyAndConfirmMinigame = verifyAndConfirmMinigame;
          window.addEventListener('load', function () {
            window.setTimeout(refreshLiveVerifyBanner, 120);
            window.setInterval(refreshLiveVerifyBanner, 380);
          });
        })();
        /* === VERIFY_SYS_END === */
`

function common(src, gameId, h1, badgeText) {
  src = src
    .replace(/<button[^>]*onclick="[^"]*index\.html[^"]*"[^>]*>[^<]*<\/button>\s*/g, '')
    .replace(/<a[^>]*href="[^"]*index\.html[^"]*"[^>]*>[^<]*<\/a>\s*/g, '')
  if (badgeText) {
    src = src.replace(
      /<span class="badge-system">[^<]*<\/span>/,
      `<span class="badge-system">${badgeText}</span>`
    )
  }
  if (h1) src = src.replace(/<h1>[^<]*<\/h1>/, `<h1>${h1}</h1>`)
  const safeStyle = `<style data-mg-safe-css="1">html,body{min-width:0;min-height:0;} .industrial-panel,.panel-body,.panel,.canvas-container,.canvas-wrap{min-width:0;min-height:0;} .canvas-container,.canvas-wrap{min-height:220px;}</style>`
  if (src.includes('</head>')) {
    src = src.replace('</head>', () => safeStyle + '\n</head>')
  }
  src = injectInsideMainScript(src, liveThreatSyncScript(gameId))
  src = injectInsideMainScript(src, verifySystemScript(gameId))
  return src.replace('</body>', () => bridge(gameId) + '</body>')
}

// 1) 6-DOF Space Docking (CONDOR-4)
{
  let s = readFirstAvailable(['acoplamiento_espacial_2.html', 'acoplamiento_espacial.html'], 'acoplamiento_espacial.html')
  s = replaceOnce(
    s,
    `alert("All Space Docking levels completed!");`,
    `if (window.__showConsoleHudNotice) window.__showConsoleHudNotice("All APAS Docking levels stabilized!", "ok");`,
    'dock no alert'
  )
  s = replaceOnce(
    s,
    `        let state = {
            pos: { x: 1.8, y: -1.2, z: 42.5 },   // meters relative to port
            vel: { x: -0.015, y: 0.01, z: -0.12 },// m/s relative velocity
            rot: { yaw: 2.5, pitch: -1.8, roll: 0.8 }, // degrees
            angVel: { yaw: -0.04, pitch: 0.03, roll: 0.0 }, // deg/s`,
    `        let state = {
            pos: { x: 0.22, y: -0.18, z: 10.0 },   // meters relative to port
            vel: { x: 0.0, y: 0.0, z: -0.85 },     // m/s gentle approach
            rot: { yaw: 0.3, pitch: -0.2, roll: 0.2 }, // degrees (<0.5°)
            angVel: { yaw: 0.0, pitch: 0.0, roll: 0.0 }, // deg/s`,
    'dock easy initial state'
  )
  s = replaceOnce(
    s,
    /            if \(missionDifficulty === 1\) \{[\s\S]*?stationSpinRate = 0\.4;\s*document\.getElementById\('missionText'\)\.textContent = "EXTREME MISSION: Night Docking with Tidal Forces";\s*\}/,
    `            state.pos = { x: 0.22, y: -0.18, z: 10.0 };
            state.vel = { x: 0.0, y: 0.0, z: -0.85 };
            state.rot = { yaw: 0.3, pitch: -0.2, roll: 0.2 };
            state.angVel = { yaw: 0.0, pitch: 0.0, roll: 0.0 };
            state.fuel = 95.0;
            stationSpinRate = 0.0;
            document.getElementById('missionText').textContent = missionDifficulty === 1
                ? "MISSION: Guided Rectilinear Docking"
                : "MISSION: Assisted APAS Approach (10m)";`,
    'dock easy setupDifficulty'
  )
  s = replaceOnce(
    s,
    `            // APAS criteria: speed < 0.16 m/s, offset < 0.65m, angle < 1.6°
            const success = (speed <= 0.16 && latOffset <= 0.65 && maxAngle <= 1.8);`,
    `            // Wide APAS criteria: offset <= 1.50m, angle <= 4.0°
            const success = (speed <= 1.10 && latOffset <= 1.50 && maxAngle <= 4.0);`,
    'dock wide capture tolerance'
  )
  s = common(
    s,
    'dock',
    '6-DOF APAS SPACE DOCKING · CONDOR-4',
    'COMMAND · CONDOR-4 (DIRECTOR)'
  )
  fs.writeFileSync(path.join(OUT, 'acoplamiento_espacial.html'), s)
}

// 2) EPS Electrical Power Distribution (ALPACA-1): 10s eclipse + clean winning auto-balance
{
  let s = readFirstAvailable(['distribucion_electrica_2.html', 'distribucion_electrica.html'], 'distribucion_electrica.html')

  // Header objective and progress bar + 10s eclipse
  s = replaceOnce(
    s,
    `<span id="eclipse-timer" class="text-amber-400 font-bold">ECLIPSE (18s)</span>`,
    `<span id="eclipse-timer" class="text-amber-400 font-bold">ECLIPSE (10s)</span>`,
    'eps header eclipse 10s'
  )
  s = replaceOnce(
    s,
    `<span>EMERGENCY STABILIZATION</span>`,
    `<span>AUTO-BALANCE LOADS</span>`,
    'eps button label'
  )
  s = replaceOnce(
    s,
    `<div class="shrink-0 ml-3 flex items-center gap-2 font-bold">
                <span class="text-slate-400">INTEGRITY:</span>
                <span id="stability-timer" class="text-cyan-300">100%</span>
            </div>`,
    `<div class="shrink-0 ml-3 flex items-center gap-3 font-bold">
                <span class="text-slate-400">STABILITY: <span id="eps-win-timer" class="text-emerald-300">0s / 10s</span></span>
                <span class="text-slate-400">INTEGRITY: <span id="stability-timer" class="text-cyan-300">100%</span></span>
            </div>`,
    'eps header win timer'
  )

  // Victory/fail modal (debriefModal) + modal style
  s = replaceOnce(
    s,
    `<!-- NOTIFICATION TOAST -->`,
    `<!-- EPS DEBRIEF MODAL (debriefModal) -->
    <div id="debriefModal" class="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md items-center justify-center p-4" style="display:none;">
        <div class="sci-panel max-w-lg w-full rounded-lg p-5 border-2 border-emerald-400/70 shadow-2xl space-y-4">
            <div class="flex items-center justify-between border-b border-slate-700 pb-3">
                <h3 id="debTitle" class="font-display text-base font-bold text-emerald-400">EPS POWER GRID STABILIZED!</h3>
                <span id="debBadge" class="badge-system text-[10px] px-2 py-0.5 border border-emerald-400 text-emerald-300">NOMINAL</span>
            </div>
            <p id="debDesc" class="text-xs text-slate-300 leading-relaxed">Buses A, B, and C maintain power balance without thermal overloads.</p>
            <div class="grid grid-cols-2 gap-2 bg-slate-950/90 border border-slate-800 p-3 rounded text-xs">
                <div>Final Battery: <strong id="debBattery" class="text-emerald-300">-</strong></div>
                <div>Grid Integrity: <strong id="debIntegrity" class="text-cyan-300">-</strong></div>
            </div>
            <div class="flex justify-end gap-2">
                <button onclick="closeModalAndRetry()" class="btn-tactical px-3 py-2 rounded text-xs font-bold text-slate-200">RETRY</button>
                <button data-solved-btn="1" onclick="nextLevelOrFinish()" class="px-4 py-2 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-300">[ ✔ LOCK EPS MATRIX & CLOSE CONSOLE ]</button>
            </div>
        </div>
    </div>

    <!-- NOTIFICATION TOAST -->`,
    'eps debrief modal html'
  )

  // State fields for stability and 10s eclipse
  s = replaceOnce(
    s,
    `            eclipsePhase: 12,
            isEclipseActive: false,
            surgeTimer: 16,
            time: 0,`,
    `            eclipsePhase: 10,
            isEclipseActive: false,
            surgeTimer: 16,
            time: 0,
            stableSec: 0,
            targetStableSec: 10,
            autoCooldown: 0,
            isEnded: false,`,
    'eps state fields'
  )

  // Clean winning auto-balancer (sets 4 loads + 3 generators instantly without blocking cooldown)
  s = replaceOnce(
    s,
    `        function emergencyStabilize() {
            playUiSound('auto');
            // Redistribute loads across the 3 buses to eliminate overloads
            state.loads[0].bus = 0; // Bus A
            state.loads[1].bus = 1; // Bus B
            state.loads[2].bus = 2; // Bus C
            state.loads[3].bus = 2; // Bus C

            state.loads.forEach((l, i) => {
                l.active = true;
                document.getElementById(\`bus-btn-\${i}\`).textContent = \`\${BUS_NAMES[l.bus]} ⇄\`;
            });

            // Adjust power levels to safe minimums + optimal split
            const totalGen = state.generators.reduce((acc, g) => acc + (g.active ? g.currentPower : 0), 0);
            let budget = Math.max(135, totalGen - 10);

            state.loads[0].power = Math.min(70, Math.max(62, Math.round(budget * 0.34)));
            state.loads[1].power = Math.min(65, Math.max(42, Math.round(budget * 0.30)));
            state.loads[2].power = Math.min(45, Math.max(15, Math.round(budget * 0.18)));
            state.loads[3].power = Math.min(40, Math.max(28, Math.round(budget * 0.18)));

            state.loads.forEach((l, i) => {
                document.getElementById(\`slider-load-\${i}\`).value = l.power;
            });

            showToast('ROUTING AND LOADS STABILIZED');
            updateUI();
        }`,
    `        function emergencyStabilize() {
            if (state.isEnded) return;
            playUiSound('auto');
            state.autoCooldown = 0;
            state.generators.forEach((g) => {
                g.active = true;
                g.currentPower = Math.max(g.currentPower, g.basePower);
            });
            const targets = [65, 50, 25, 30];
            const buses = [0, 1, 2, 2];
            state.loads.forEach((l, i) => {
                l.active = true;
                l.bus = buses[i];
                l.power = targets[i];
                document.getElementById(\`bus-btn-\${i}\`).textContent = \`\${BUS_NAMES[l.bus]} ⇄\`;
                document.getElementById(\`slider-load-\${i}\`).value = l.power;
            });
            state.battery = Math.max(state.battery, 72);
            state.integrity = 100;
            showToast('✔ 4 LOADS & 3 GENERATORS BALANCED');
            if (window.__showConsoleHudNotice) window.__showConsoleHudNotice('✔ EPS GRID BALANCED — READY TO CONFIRM', 'ok');
            updateUI();
        }

        function completeMission() {
            if (state.isEnded) return;
            state.isEnded = true;
            playUiSound('auto');
            const m = document.getElementById('debriefModal');
            if (m) m.style.display = 'flex';
            const t = document.getElementById('debTitle'); if (t) { t.textContent = 'EPS POWER GRID STABILIZED!'; t.className = 'font-display text-base font-bold text-emerald-400'; }
            const d = document.getElementById('debDesc'); if (d) d.textContent = 'Buses and solar generation cleared the demand and eclipse cycle.';
            const b = document.getElementById('debBattery'); if (b) b.textContent = Math.round(state.battery) + '%';
            const ig = document.getElementById('debIntegrity'); if (ig) ig.textContent = Math.round(state.integrity) + '%';
        }
        function failMission(reason) {
            if (state.isEnded) return;
            state.isEnded = true;
            playUiSound('warn');
            const m = document.getElementById('debriefModal');
            if (m) m.style.display = 'flex';
            const t = document.getElementById('debTitle'); if (t) { t.textContent = 'POWER GRID COLLAPSE'; t.className = 'font-display text-base font-bold text-rose-400'; }
            const d = document.getElementById('debDesc'); if (d) d.textContent = reason || 'Sustained bus overload or critical battery drop.';
            const b = document.getElementById('debBattery'); if (b) b.textContent = Math.round(state.battery) + '%';
            const ig = document.getElementById('debIntegrity'); if (ig) ig.textContent = Math.round(state.integrity) + '%';
        }
        function closeModalAndRetry() {
            const m = document.getElementById('debriefModal'); if (m) m.style.display = 'none';
            document.getElementById('btn-reset').click();
        }
        function nextLevelOrFinish() {
            if (window.__notifyVictoryNow) window.__notifyVictoryNow();
            if (window.__closeFrameNow) window.__closeFrameNow();
        }
        window.completeMission = completeMission;
        window.failMission = failMission;
        window.closeModalAndRetry = closeModalAndRetry;
        window.nextLevelOrFinish = nextLevelOrFinish;`,
    'eps clean winning autobalance and debrief'
  )

  // Reset stableSec/isEnded in applyDifficulty (target 8/10/12s)
  s = replaceOnce(
    s,
    `function applyDifficulty(lvl) {
            state.level = parseInt(lvl);`,
    `function applyDifficulty(lvl) {
            state.level = parseInt(lvl) || 2;
            state.isEnded = false;
            state.stableSec = 0;
            state.targetStableSec = state.level === 1 ? 8 : state.level === 2 ? 10 : 12;`,
    'eps difficulty reset'
  )

  s = replaceOnce(
    s,
    `state.eclipsePhase = state.isEclipseActive ? 14 : 16;`,
    `state.eclipsePhase = 10;`,
    'eps eclipse loop 10s'
  )

  // Progress toward victory cleanly inside simulationLoop
  s = replaceOnce(
    s,
    `                if (hasOverload || hasVitalFail || state.battery <= 0) {
                    state.integrity = Math.max(0, state.integrity - 2.5);
                } else {
                    state.integrity = Math.min(100, state.integrity + 0.5);
                }

                updateUI();`,
    `                if (!state.isEnded) {
                    if (hasOverload || hasVitalFail || state.battery <= 15) {
                        state.integrity = Math.max(0, state.integrity - 2.0);
                        state.stableSec = Math.max(0, state.stableSec - 1);
                        if (state.integrity <= 0) failMission('Thermal overload or depleted battery (<15%).');
                    } else {
                        state.integrity = Math.min(100, state.integrity + 0.8);
                        state.stableSec = Math.min(state.targetStableSec, state.stableSec + 1);
                        if (state.stableSec >= state.targetStableSec) completeMission();
                    }
                }
                const wt = document.getElementById('eps-win-timer');
                if (wt) wt.textContent = state.stableSec + 's / ' + state.targetStableSec + 's';

                updateUI();`,
    'eps simulation win progression'
  )

  s = replaceOnce(
    s,
    `document.getElementById('btn-exit').addEventListener('click', () => showToast('RETURNING TO STATION...'));`,
    `document.getElementById('btn-exit').addEventListener('click', () => { if (window.__closeFrameNow) window.__closeFrameNow(); });`,
    'eps exit button'
  )

  s = common(
    s,
    'eps',
    'EPS ELECTRICAL POWER DISTRIBUTION · ALPACA-1 · POWER MGD',
    'ENGINEERING · ALPACA-1 (SOLAR/O2)'
  )
  fs.writeFileSync(path.join(OUT, 'distribucion_electrica.html'), s)
}

// 3) ECLSS Life Support (ALPACA-1): wide tolerances + AUTO-STABILIZE ECLSS button + real-time sliders
{
  let s = readFirstAvailable(['soporte_vital_2.html', 'soporte_vital.html'], 'soporte_vital.html')
  s = replaceOnce(
    s,
    `<button class="btn-ui" style="background:#0284c7; color:#fff; justify-content:center; padding:9px;" onclick="applySettings()">
                    APPLY PARAMETERS
                </button>`,
    `<button class="btn-ui" id="btnAutoEclss" style="background:linear-gradient(180deg,#059669,#047857); border:1px solid #00ff88; color:#fff; font-weight:bold; justify-content:center; padding:8px;" onclick="autoStabilizeEclss()">
                    ⚡ AUTO-STABILIZE ECLSS
                </button>`,
    'eclss auto stabilize button'
  )
  s = replaceOnce(
    s,
    `        function updatePreview() {
            o2Flow = parseInt(document.getElementById('slO2').value);
            n2Flow = parseInt(document.getElementById('slN2').value);
            targetTemp = parseInt(document.getElementById('slTemp').value);
            document.getElementById('txtO2Flow').textContent = \`\${o2Flow}%\`;
            document.getElementById('txtN2Flow').textContent = \`\${n2Flow}%\`;
            document.getElementById('txtTemp').textContent = \`\${targetTemp.toFixed(1)}°C\`;
        }`,
    `        var lastFlowFxAt = 0;
        function updatePreview() {
            o2Flow = parseInt(document.getElementById('slO2').value);
            n2Flow = parseInt(document.getElementById('slN2').value);
            targetTemp = parseInt(document.getElementById('slTemp').value);
            document.getElementById('txtO2Flow').textContent = \`\${o2Flow}%\`;
            document.getElementById('txtN2Flow').textContent = \`\${n2Flow}%\`;
            document.getElementById('txtTemp').textContent = \`\${targetTemp.toFixed(1)}°C\`;
            var nowMs = Date.now();
            if (nowMs - lastFlowFxAt > 240) { lastFlowFxAt = nowMs; playAirSound(); }
            if (typeof updateUI === 'function') updateUI();
        }
        function autoStabilizeEclss() {
            if (isEnded) return;
            o2Flow = 80; n2Flow = 20; targetTemp = 21;
            document.getElementById('slO2').value = 80;
            document.getElementById('slN2').value = 20;
            document.getElementById('slTemp').value = 21;
            o2Val = 21.0; co2Val = 0.08; pressVal = 101.3; tempVal = 21.2; leakRate = 0.0;
            setScrubber(1);
            if (!isSealed) toggleSeal();
            setVent('auto');
            updatePreview();
            updateUI();
            if (window.__showConsoleHudNotice) window.__showConsoleHudNotice('✔ ECLSS STABILIZED (O2 21%, CO2 0.08%, Canister B) · READY TO CONFIRM', 'ok');
        }`,
    'eclss realtime oninput and auto stabilize'
  )
  s = replaceOnce(
    s,
    `            if (o2Val < 16.0) { isEnded = true; showDebriefModal(false, "Severe hypoxia due to oxygen drop."); }
            else if (o2Val > 28.0) { isEnded = true; showDebriefModal(false, "Critical fire hazard due to hyperoxia."); }
            else if (co2Val > 1.2) { isEnded = true; showDebriefModal(false, "Lethal hypercapnia poisoning."); }
            else if (pressVal < 70) { isEnded = true; showDebriefModal(false, "Critical cabin decompression."); }

            const targetTime = difficulty === 1 ? 25 : difficulty === 2 ? 35 : 45;`,
    `            if (o2Val < 15.0) { isEnded = true; showDebriefModal(false, "Severe hypoxia due to oxygen drop."); }
            else if (o2Val > 29.0) { isEnded = true; showDebriefModal(false, "Critical fire hazard due to hyperoxia."); }
            else if (co2Val > 1.6) { isEnded = true; showDebriefModal(false, "Lethal hypercapnia poisoning."); }
            else if (pressVal < 70) { isEnded = true; showDebriefModal(false, "Critical cabin decompression."); }

            const targetTime = difficulty === 1 ? 10 : difficulty === 2 ? 12 : 14;`,
    'eclss wide tolerances and fast timer'
  )
  s = replaceOnce(
    s,
    `alert("All Life Support scenarios completed!");`,
    `if (window.__showConsoleHudNotice) window.__showConsoleHudNotice("All Life Support levels stabilized!", "ok");`,
    'eclss no alert'
  )
  s = common(
    s,
    'eclss',
    'ECLSS LIFE SUPPORT & O2 TANKS · ALPACA-1',
    'ENGINEERING · ALPACA-1 (SOLAR/O2)'
  )
  fs.writeFileSync(path.join(OUT, 'soporte_vital.html'), s)
}

// 4) Dual Hohmann Orbital Navigation (PUMA-3): ±45 km tolerance & live recommended Δv
{
  let s = readFirstAvailable(['navegacion_orbital_2.html', 'navegacion_orbital.html'], 'navegacion_orbital.html')
  s = replaceOnce(s, `tolerance: 15.0,`, `tolerance: 45.0,`, 'nav wide tolerance 45km')
  s = replaceOnce(s, `deltaV: 138,`, `deltaV: 15,`, 'nav init dv 15')
  s = replaceOnce(s, `orbitState.deltaV = 98;`, `orbitState.deltaV = 15;`, 'nav lvl1 dv 15')
  s = replaceOnce(s, `orbitState.deltaV = 138;`, `orbitState.deltaV = 15;`, 'nav lvl2 dv 15')
  s = replaceOnce(s, `orbitState.deltaV = 220;`, `orbitState.deltaV = 15;`, 'nav lvl3 dv 15')
  s = replaceOnce(s, `orbitState.deltaV = 115;`, `orbitState.deltaV = 15;`, 'nav lvl4 dv 15')
  s = replaceOnce(s, `orbitState.deltaV = 380;`, `orbitState.deltaV = 15;`, 'nav lvl5 dv 15')
  s = replaceOnce(
    s,
    `                <button class="btn-burn" id="btnExecuteBurn" onclick="executeBurn()">
                    ▶ EXECUTE MANEUVER
                </button>`,
    `                <div id="recommendedDvHint" style="background:#022c22; border:1px solid #00ff88; color:#6ee7b7; padding:6px 8px; font-size:11px; font-weight:bold; text-align:center; border-radius:3px;">💡 Recommended impulse: +145 m/s</div>
                <button class="btn-burn" id="btnExecuteBurn" onclick="executeBurn()">
                    ▶ EXECUTE MANEUVER
                </button>`,
    'nav recommended dv hint ui'
  )
  s = replaceOnce(
    s,
    `            burnDuration = 2.8; // 2.8s dynamic burn`,
    `            burnDuration = 0.8; // 0.8s rapid ignition`,
    'nav fast burn 0.8s'
  )
  s = replaceOnce(
    s,
    `                orbitState.altitude += (shift / 2.8) * dt;`,
    `                orbitState.altitude += (shift / 0.8) * dt;`,
    'nav burn rate match 0.8s'
  )
  s = replaceOnce(
    s,
    `alert("All Orbital Navigation scenarios completed!");`,
    `if (window.__showConsoleHudNotice) window.__showConsoleHudNotice("All orbital scenarios completed!", "ok");`,
    'nav no alert'
  )
  s = common(
    s,
    'nav',
    'DUAL HOHMANN ORBITAL NAVIGATION · SAT-01 AMARU-COMMS / SAT-02 INTI-SCIENCE',
    'SCIENCE · PUMA-3 (ORBIT/PROBE)'
  )

  // Compact CSS for dual satellite monitors in sidebar
  s = replaceOnce(
    s,
    '</style>',
    `
        .dual-monitors { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
        .sat-mon { background:#060b13; border:1px solid #1e2e48; border-radius:3px; padding:6px; display:flex; flex-direction:column; gap:4px; cursor:pointer; }
        .sat-mon.active { border-color:var(--crt-green); box-shadow:0 0 10px rgba(0,255,136,0.28); }
        .sat-mon-title { font-size:9px; font-weight:bold; color:#ffb703; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .sat-mon.s2 .sat-mon-title { color:#7dd3fc; }
        .sat-mon canvas { width:100%; height:48px; background:#030711; border:1px solid #1a273b; image-rendering:pixelated; display:block; }
        .sat-mon-meta { font-size:9px; color:var(--text-dim); display:flex; justify-content:space-between; }
        .btn-sel { background:#142033; border:1px solid #2d4466; color:#e2e8f0; font-family:inherit; font-size:9px; font-weight:bold; padding:4px; cursor:pointer; border-radius:2px; }
        .btn-sel.active { background:#022c22; color:var(--crt-green); border-color:var(--crt-green); }
        .btn-sel:hover { border-color:var(--crt-cyan); }
    </style>`,
    'nav css'
  )

  // Dual selector above telemetry-sidebar
  s = replaceOnce(
    s,
    '<div class="telemetry-sidebar">',
    `<div class="telemetry-sidebar">
            <div class="card-panel">
                <div class="card-header">
                    <span>ORBITING SATELLITES (180°)</span>
                    <span id="dualSatTag" style="color:var(--crt-cyan)">0/2 ALIGNED</span>
                </div>
                <div class="dual-monitors">
                    <div class="sat-mon active" id="mon1" onclick="selectSat(0)">
                        <div class="sat-mon-title">SAT-01 AMARU-COMMS</div>
                        <canvas id="satCanvas1" width="128" height="48"></canvas>
                        <div class="sat-mon-meta"><span id="alt1">412 km</span><span id="tgt1">550 km</span></div>
                        <button type="button" class="btn-sel active" id="btnSel1" onclick="event.stopPropagation(); selectSat(0)">CONTROL SAT-01</button>
                    </div>
                    <div class="sat-mon s2" id="mon2" onclick="selectSat(1)">
                        <div class="sat-mon-title">SAT-02 INTI-SCIENCE</div>
                        <canvas id="satCanvas2" width="128" height="48"></canvas>
                        <div class="sat-mon-meta"><span id="alt2">436 km</span><span id="tgt2">495 km</span></div>
                        <button type="button" class="btn-sel" id="btnSel2" onclick="event.stopPropagation(); selectSat(1)">CONTROL SAT-02</button>
                    </div>
                </div>
            </div>`,
    'nav sidebar monitors'
  )

  // Estado dual de 2 satélites
  s = replaceOnce(
    s,
    `let orbitState = {`,
    `let sats = [];
        let selectedSat = (typeof location !== 'undefined' && location.search && location.search.indexOf('sat=sat2') >= 0) ? 1 : 0;
        let orbitState = {`,
    'nav dual state'
  )

  // setupDifficulty: construye SAT-01 y SAT-02 desfasados 180°
  s = replaceOnce(
    s,
    `setVector(orbitState.vector);
            updateUI();
        }`,
    `const baseSat = {
                name: 'SAT-01 AMARU-COMMS',
                short: 'SAT-01',
                color: '#ffb703',
                altitude: orbitState.altitude,
                targetAlt: orbitState.targetAlt,
                tolerance: orbitState.tolerance,
                angle: Math.PI,
                speed: orbitState.speed,
                fuel: orbitState.fuel,
                vector: orbitState.vector,
                deltaV: orbitState.deltaV,
                isEnded: false,
                done: false,
                err: 0
            };
            const sat2Target = orbitState.vector === 'retrograde'
                ? Math.max(290, orbitState.targetAlt + 35)
                : Math.max(baseSat.altitude + 55, orbitState.targetAlt - 55);
            const sat2Alt = baseSat.altitude + 24;
            const sat2Dv = 15;
            const sat2 = {
                name: 'SAT-02 INTI-SCIENCE',
                short: 'SAT-02',
                color: '#7dd3fc',
                altitude: sat2Alt,
                targetAlt: sat2Target,
                tolerance: orbitState.tolerance,
                angle: 0.0,
                speed: Math.sqrt(MU / (R_EARTH + sat2Alt)),
                fuel: Math.min(100, baseSat.fuel + 5),
                vector: sat2Target >= sat2Alt ? 'prograde' : 'retrograde',
                deltaV: sat2Dv,
                isEnded: false,
                done: false,
                err: 0
            };
            sats = [baseSat, sat2];
            if (selectedSat >= sats.length) selectedSat = 0;
            orbitState = sats[selectedSat];
            refreshSatSelectors();
            setVector(orbitState.vector);
            updateUI();
        }

        function refreshSatSelectors() {
            [0, 1].forEach(function (k) {
                var m = document.getElementById('mon' + (k + 1));
                var b = document.getElementById('btnSel' + (k + 1));
                if (m) m.classList.toggle('active', k === selectedSat);
                if (b) b.classList.toggle('active', k === selectedSat);
            });
            var mText = document.getElementById('missionText');
            if (mText && sats[selectedSat]) {
                mText.textContent = 'MISSION: ' + sats[selectedSat].name + ' · HOHMANN MANEUVER';
            }
        }

        function selectSat(i) {
            if (isBurning || !sats[i]) return;
            selectedSat = i;
            orbitState = sats[i];
            refreshSatSelectors();
            setVector(orbitState.vector);
            updateUI();
        }`,
    'nav setupDifficulty dual'
  )

  // Physics: both satellites orbit simultaneously on the radar
  s = replaceOnce(
    s,
    `orbitState.angle += meanMotion * dt * 45;`,
    `sats.forEach(function (sat) {
                if (sat === orbitState) {
                    sat.angle += meanMotion * dt * 45;
                } else {
                    const rOther = R_EARTH + sat.altitude;
                    const mmOther = Math.sqrt(MU / Math.pow(rOther, 3));
                    sat.speed = Math.sqrt(MU / rOther);
                    sat.angle += mmOther * dt * 45;
                }
            });`,
    'nav physics dual'
  )

  // checkOutcome: upon completing assigned satellite maneuver, show debrief modal
  s = replaceOnce(
    s,
    `showDebriefModal(success, error);
        }`,
    `if (!success) {
                showDebriefModal(false, error);
                return;
            }
            orbitState.done = true;
            orbitState.err = error;
            updateUI();
            showDebriefModal(true, error);
        }`,
    'nav checkOutcome fluid'
  )

  // Draw opposing satellite in drawOrbitScene + pixel-art mini monitors SAT-01 and SAT-02
  s = replaceOnce(
    s,
    `// Thruster nozzle projected in bottom-right HUD corner`,
    `// Secondary satellite (opposite 180° in orbit)
            sats.forEach(function (sat) {
                if (sat === orbitState) return;
                const rO = scaleR + (sat.altitude / 850) * (scaleR * 0.95);
                const rOTgt = scaleR + (sat.targetAlt / 850) * (scaleR * 0.95);
                ctx.strokeStyle = 'rgba(125,211,252,0.35)';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 4]);
                ctx.beginPath(); ctx.arc(cx, cy, rO, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.arc(cx, cy, rOTgt, 0, Math.PI * 2); ctx.stroke();
                ctx.setLineDash([]);
                const ox = cx + Math.cos(sat.angle) * rO;
                const oy = cy + Math.sin(sat.angle) * rO;
                ctx.fillStyle = sat.color;
                ctx.fillRect(ox - 3, oy - 3, 6, 6);
                ctx.fillStyle = '#e2e8f0';
                ctx.font = 'bold 9px Courier New';
                ctx.fillText(sat.short + (sat.done ? ' ✔' : ''), ox + 8, oy - 5);
            });
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Courier New';
            ctx.fillText((orbitState.short || 'SAT-02') + ' ▶', shipX + 8, shipY - 6);

            // Thruster nozzle projected in bottom-right HUD corner`,
    'nav drawOrbitScene other sat'
  )

  s = replaceOnce(
    s,
    `function drawOrbitScene() {`,
    `function drawSatPreview(cEl, sat, isSat1, t) {
            if (!cEl) return;
            const sCtx = cEl.getContext('2d');
            const sw = cEl.width, sh = cEl.height;
            sCtx.fillStyle = '#030711';
            sCtx.fillRect(0, 0, sw, sh);
            sCtx.fillStyle = 'rgba(255,255,255,0.6)';
            for (let i = 0; i < 12; i++) sCtx.fillRect((i * 31) % sw, (i * 19) % sh, 1.5, 1.5);
            sCtx.fillStyle = '#0f3860';
            sCtx.beginPath(); sCtx.arc(sw / 2, sh + 48, 62, 0, Math.PI * 2); sCtx.fill();
            const mx = Math.round(sw / 2), my = 20;
            if (isSat1) {
                sCtx.fillStyle = '#1d4ed8';
                sCtx.fillRect(mx - 28, my - 13, 12, 26);
                sCtx.fillRect(mx + 16, my - 13, 12, 26);
                sCtx.fillStyle = '#60a5fa';
                sCtx.fillRect(mx - 28, my - 4, 12, 1);
                sCtx.fillRect(mx + 16, my - 4, 12, 1);
                sCtx.fillStyle = '#e0a82e';
                sCtx.fillRect(mx - 9, my - 9, 18, 18);
                sCtx.fillStyle = '#e2e8f0';
                sCtx.fillRect(mx - 6, my + 10, 12, 3);
            } else {
                sCtx.fillStyle = '#2563eb';
                sCtx.fillRect(mx - 26, my - 10, 14, 7);
                sCtx.fillRect(mx + 12, my - 10, 14, 7);
                sCtx.fillRect(mx - 26, my + 3, 14, 7);
                sCtx.fillRect(mx + 12, my + 3, 14, 7);
                sCtx.fillStyle = '#cbd5e1';
                sCtx.fillRect(mx - 11, my - 5, 20, 10);
                sCtx.fillStyle = '#22d3ee';
                sCtx.fillRect(mx + 8, my - 4, 6, 8);
                sCtx.strokeStyle = Math.sin(t * 8) > 0 ? '#4ade80' : '#22c55e';
                sCtx.beginPath(); sCtx.moveTo(mx + 11, my + 4); sCtx.lineTo(mx + 22, sh - 2); sCtx.stroke();
            }
            if (sat && sat.done) {
                sCtx.fillStyle = '#4ade80';
                sCtx.font = 'bold 10px Courier New';
                sCtx.fillText('OK ✔', 4, 11);
            }
        }

        function drawOrbitScene() {
            const nowT = performance.now() / 1000;
            if (sats.length >= 2) {
                drawSatPreview(document.getElementById('satCanvas1'), sats[0], true, nowT);
                drawSatPreview(document.getElementById('satCanvas2'), sats[1], false, nowT);
            }`,
    'nav sat previews'
  )

  s = replaceOnce(
    s,
    `document.getElementById('valPeri').textContent = \`\${Math.round(orbitState.altitude)} km\`;`,
    `document.getElementById('valPeri').textContent = \`\${Math.round(orbitState.altitude)} km\`;
            if (sats.length >= 2) {
                var a1 = document.getElementById('alt1'); if (a1) a1.textContent = sats[0].altitude.toFixed(0) + ' km';
                var t1 = document.getElementById('tgt1'); if (t1) { t1.textContent = (sats[0].done ? '✔ ' : '→') + sats[0].targetAlt + 'km'; t1.style.color = sats[0].done ? '#00ff88' : '#ffb703'; }
                var a2 = document.getElementById('alt2'); if (a2) a2.textContent = sats[1].altitude.toFixed(0) + ' km';
                var t2 = document.getElementById('tgt2'); if (t2) { t2.textContent = (sats[1].done ? '✔ ' : '→') + sats[1].targetAlt + 'km'; t2.style.color = sats[1].done ? '#00ff88' : '#7dd3fc'; }
                var dtTag = document.getElementById('dualSatTag');
                if (dtTag) {
                    var readyCount = (sats[0].done ? 1 : 0) + (sats[1].done ? 1 : 0);
                    dtTag.textContent = readyCount + '/2 READY';
                    dtTag.style.color = readyCount >= 1 ? '#00ff88' : '#00e5ff';
                }
            }
            var recHintEl = document.getElementById('recommendedDvHint');
            if (recHintEl && orbitState) {
                var recSigned = Math.round((orbitState.targetAlt - orbitState.altitude) / 0.95);
                var dirStr = recSigned >= 0 ? 'PROGRADE +' : 'RETROGRADE -';
                recHintEl.textContent = '💡 Recommended impulse: ' + (recSigned >= 0 ? '+' : '-') + Math.abs(recSigned) + ' m/s (' + dirStr.replace(/[+-]/g, '').trim() + ')';
            }`,
    'nav updateUI dual'
  )

  fs.writeFileSync(path.join(OUT, 'navegacion_orbital.html'), s)
}

// 5) Planetary Landing (PUMA-3): initial altitude 180m + gentle gravity + safe v < 12 m/s
{
  let s = readFirstAvailable(['aterrizaje_planetario.html'], 'aterrizaje_planetario.html')
  s = replaceOnce(
    s,
    /(?:La Alpaca Astronauta logró posar el módulo en la superficie del planeta extraño sin daños estructurales\.|La sonda científica del Escuadrón Andino logró posarse en la superficie planetaria sin daños estructurales\.|El Oficial Científico PUMA-3 logró posar la Sonda de Exploración en la superficie planetaria y recolectar las muestras geológicas\.|Science Officer PUMA-3 successfully landed the Exploration Probe on the planetary surface and collected geological samples\.)/,
    'Science Officer PUMA-3 successfully landed the Exploration Probe on the planetary surface and collected geological samples.',
    'lander squad text'
  )
  s = replaceOnce(s, /let altitude = [\d.]+;/, `let altitude = 180.0;`, 'lander init alt 180')
  s = replaceOnce(
    s,
    /altitude = [\d.]+;\s*velocity = [\d.]+;[\s\S]*?else if \(difficulty === 3\) gravity = [\d.]+;/,
    `altitude = 180.0;
            velocity = 5.5;
            fuel = 100.0;
            isBurning = false;

            if (difficulty === 1) gravity = 0.04;
            else if (difficulty === 2) gravity = 0.055;
            else if (difficulty === 3) gravity = 0.075;`,
    'lander setupScenario easy 180m'
  )
  s = replaceOnce(s, /if \(velocity <= [\d.]+\)/, `if (velocity <= 12.0)`, 'lander safe speed 12')
  s = replaceOnce(s, /const maxAlt = \d+;/, `const maxAlt = 200;`, 'lander visual scale 200m')
  if (!s.includes('if (canvas.width < 100 || canvas.height < 100) resizeCanvas();')) {
    s = replaceOnce(
      s,
      `        function render() {`,
      `        function render() {\n            if (canvas.width < 100 || canvas.height < 100) resizeCanvas();`,
      'lander render resize guard'
    )
  }
  const nlOrig = `function nextLevelOrFinish() { alert("¡Felicidades por completar la Hackathon con éxito total!"); location.href='index.html'; }`
  if (s.includes(nlOrig)) {
    s = replaceOnce(
      s,
      nlOrig,
      `function nextLevelOrFinish() {
            document.getElementById('debriefModal').style.display = 'none';
            try { window.parent.postMessage({ type: 'minigame-close', game: 'lander' }, '*'); } catch (e) {}
        }`,
      'lander nextLevel'
    )
  }
  s = common(
    s,
    'lander',
    'PLANETARY SCIENCE PROBE LANDING · PUMA-3',
    'SCIENCE · PUMA-3 (ORBIT/PROBE)'
  )
  fs.writeFileSync(path.join(OUT, 'aterrizaje_planetario.html'), s)
}

// 6) Telecom Tuning (SERPIENTE-2): ±25 Hz / ±20% tolerance + exact target readout next to sliders
{
  let s = readFirstAvailable(['reparacion_telecom.html'], 'reparacion_telecom.html')
  s = replaceOnce(
    s,
    `<b id="freqVal" style="color:var(--crt-cyan)">50 Hz</b>`,
    `<span><b id="freqVal" style="color:var(--crt-cyan)">50 Hz</b> <small id="freqTargetHint" style="color:var(--crt-green);margin-left:4px;">(Target: 50 Hz)</small></span>`,
    'telecom freq target hint'
  )
  s = replaceOnce(
    s,
    `<b id="gainVal" style="color:var(--crt-green)">50 %</b>`,
    `<span><b id="gainVal" style="color:var(--crt-green)">50 %</b> <small id="gainTargetHint" style="color:var(--crt-green);margin-left:4px;">(Target: 50%)</small></span>`,
    'telecom gain target hint'
  )
  s = replaceOnce(
    s,
    `            document.getElementById('freqVal').textContent = \`\${userFreq} Hz\`;
            document.getElementById('gainVal').textContent = \`\${userGain} %\`;`,
    `            document.getElementById('freqVal').textContent = \`\${userFreq} Hz\`;
            document.getElementById('gainVal').textContent = \`\${userGain} %\`;
            var fHint = document.getElementById('freqTargetHint');
            var gHint = document.getElementById('gainTargetHint');
            if (fHint) fHint.textContent = \`(Target: \${targetFreq} Hz)\`;
            if (gHint) gHint.textContent = \`(Target: \${targetGain}%)\`;`,
    'telecom updateSliders show exact target'
  )
  s = replaceOnce(
    s,
    `            const tolerance = difficulty === 1 ? 8 : (difficulty === 2 ? 5 : 3);

            if (freqDiff <= tolerance && gainDiff <= tolerance) {
                completeMission(freqDiff, gainDiff);
            } else {
                playBeep(150, 0.3);
                alert("Signal misaligned! Waveform does not match the satellite target.");
            }`,
    `            if (freqDiff <= 25 && gainDiff <= 20) {
                completeMission(freqDiff, gainDiff);
            } else {
                playBeep(180, 0.2);
                if (window.__showConsoleHudNotice) {
                    window.__showConsoleHudNotice('Tune near Target ' + targetFreq + ' Hz (±25) and ' + targetGain + '% (±20)', 'warn');
                }
            }`,
    'telecom wide tolerance 25Hz 20pct and single banner'
  )
  s = common(
    s,
    'telecom',
    'DSN TELECOMMUNICATIONS TUNING · SERPIENTE-2',
    'COMMS · SERPIENTE-2 (SAT-01 AMARU)'
  )
  fs.writeFileSync(path.join(OUT, 'reparacion_telecom.html'), s)
}

// 7) Orbital Meteorite Defense (CONDOR-4): target 5/7/9, large slow meteors (radius*1.6, speed*0.6, hitbox +28)
{
  let s = readFirstAvailable(['reencuentro_cometa.html'], 'reencuentro_cometa.html')
  s = replaceOnce(
    s,
    `let meteorites = [];`,
    `let meteorites = [];
        let lasers = [];
        let particles = [];`,
    'comet laser and particles arrays'
  )
  s = replaceOnce(
    s,
    `            // Adjust target score based on selected difficulty
            if (difficulty === 1) targetScore = 10;
            else if (difficulty === 2) targetScore = 15;
            else if (difficulty === 3) targetScore = 20;`,
    `            // Accessible target score by difficulty
            if (difficulty === 1) targetScore = 5;
            else if (difficulty === 2) targetScore = 7;
            else if (difficulty === 3) targetScore = 9;`,
    'comet easy targetScore 5 7 9'
  )
  s = replaceOnce(
    s,
    `meteorites = [];
            spawnTimer = 0;`,
    `meteorites = [];
            lasers = [];
            particles = [];
            const initInterval = difficulty === 1 ? 1.4 : (difficulty === 2 ? 1.1 : 0.9);
            spawnTimer = Math.max(0, initInterval - 0.3);`,
    'comet reset vfx and 0.3s spawn'
  )
  s = replaceOnce(
    s,
    `function resizeCanvas() { canvas.width = canvas.parentElement.clientWidth; canvas.height = canvas.parentElement.clientHeight; }`,
    `function resizeCanvas() {
            const pw = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
            const ph = canvas.parentElement ? canvas.parentElement.clientHeight : 0;
            const w = pw >= 100 ? pw : Math.max(480, Math.floor((window.innerWidth || 960) * 0.55));
            const h = ph >= 100 ? ph : Math.max(320, Math.floor((window.innerHeight || 640) * 0.70));
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        }`,
    'comet safe resizeCanvas'
  )
  s = replaceOnce(
    s,
    `playLaserSound();

            // Check if click hit any meteorite
            for (let i = meteorites.length - 1; i >= 0; i--) {
                const m = meteorites[i];
                const dist = Math.hypot(m.x - clickX, m.y - clickY);
                if (dist < m.radius + 10) {
                    playExplosionSound();
                    meteorites.splice(i, 1);`,
    `playLaserSound();
            lasers.push({ x: clickX, y: clickY, life: 1.0 });

            // Wide hitbox (m.radius + 28)
            for (let i = meteorites.length - 1; i >= 0; i--) {
                const m = meteorites[i];
                const dist = Math.hypot(m.x - clickX, m.y - clickY);
                if (dist < m.radius + 28) {
                    playExplosionSound();
                    for (let k = 0; k < 14; k++) {
                        const a = (Math.PI * 2 * k) / 14 + Math.random() * 0.3;
                        const sp = 1.4 + Math.random() * 3.2;
                        particles.push({
                            x: m.x, y: m.y,
                            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                            life: 1.0,
                            color: k % 3 === 0 ? '#00e5ff' : (k % 3 === 1 ? '#fbbf24' : '#f87171')
                        });
                    }
                    meteorites.splice(i, 1);`,
    'comet click wide hitbox laser particles'
  )
  s = replaceOnce(
    s,
    `function render() {
            if (!isPaused && !isMissionEnded) {
                missionTime += 0.016;
                spawnTimer += 0.016;`,
    `function render() {
            if (canvas.width < 100 || canvas.height < 100) resizeCanvas();
            if (!isPaused && !isMissionEnded) {
                missionTime += 0.016;
                spawnTimer += 0.016;
                updateUI();`,
    'comet clock update and resize guard in render'
  )
  s = replaceOnce(
    s,
    `const spawnInterval = difficulty === 1 ? 2.2 : (difficulty === 2 ? 1.6 : 1.0);`,
    `const spawnInterval = difficulty === 1 ? 1.4 : (difficulty === 2 ? 1.1 : 0.9);`,
    'comet brisk spawn interval'
  )
  s = replaceOnce(
    s,
    `                    meteorites.push({
                        x: startX,
                        y: startY,
                        targetX: cx + (Math.random() * 40 - 20),
                        targetY: cy + (Math.random() * 40 - 20),
                        speed: speed,
                        radius: 14 + Math.random() * 12
                    });`,
    `                    meteorites.push({
                        x: startX,
                        y: startY,
                        targetX: cx + (Math.random() * 40 - 20),
                        targetY: cy + (Math.random() * 40 - 20),
                        speed: speed * 0.6,
                        radius: (14 + Math.random() * 12) * 1.6
                    });`,
    'comet big slow meteors'
  )
  s = replaceOnce(
    s,
    `// Draw base/ship at center`,
    `// Concentric green orbital radar rings and sweep beam
            const maxR = Math.max(120, Math.min(canvas.width, canvas.height) * 0.46);
            ctx.strokeStyle = 'rgba(0, 255, 136, 0.18)';
            ctx.lineWidth = 1;
            for (let ring = 1; ring <= 4; ring++) {
                ctx.beginPath();
                ctx.arc(cx, cy, (maxR * ring) / 4, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(0, 255, 136, 0.12)';
            ctx.beginPath();
            ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy);
            ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR);
            ctx.stroke();
            const sweepAngle = missionTime * 1.45;
            ctx.strokeStyle = 'rgba(0, 255, 136, 0.45)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);
            ctx.stroke();

            // Draw base/ship at center`,
    'comet concentric radar rings'
  )
  s = replaceOnce(
    s,
    `// Draw approaching meteorites`,
    `// Cyan laser beams from station to clicked target
            for (let i = lasers.length - 1; i >= 0; i--) {
                const l = lasers[i];
                ctx.save();
                ctx.globalAlpha = l.life;
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 4;
                ctx.shadowColor = '#00e5ff';
                ctx.shadowBlur = 12;
                ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(l.x, l.y); ctx.stroke();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(l.x, l.y); ctx.stroke();
                ctx.beginPath(); ctx.arc(l.x, l.y, 7 * (1.2 - l.life), 0, Math.PI * 2); ctx.stroke();
                ctx.restore();
                l.life -= 0.085;
                if (l.life <= 0) lasers.splice(i, 1);
            }

            // Explosion particles
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                ctx.save();
                ctx.globalAlpha = p.life;
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
                ctx.restore();
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.045;
                if (p.life <= 0) particles.splice(i, 1);
            }

            // Draw approaching meteorites`,
    'comet render laser and particles'
  )
  s = common(
    s,
    'comet',
    'ORBITAL METEORITE DEFENSE · CONDOR-4',
    'COMMAND · CONDOR-4 (DIRECTOR)'
  )
  fs.writeFileSync(path.join(OUT, 'reencuentro_cometa.html'), s)
}

// 8) Satellite Cyberdefense (SERPIENTE-2): quota 4/5/6 + visual badge [ SAFE -> ALLOW ] / [ THREAT -> BLOCK ]
{
  let s = readFirstAvailable(['ciberdefensa_satelital.html'], 'ciberdefensa_satelital.html')
  s = replaceOnce(
    s,
    `        function nextPacket() {
            const payloadEl = document.getElementById('packetPayload');
            payloadEl.textContent = "📡 [Earth Control Center]: Receiving packet...";
            payloadEl.style.color = "var(--crt-amber)";

            // Simulate brief space signal arrival delay (1 second)
            setTimeout(() => {
                currentPacket = mockPayloads[Math.floor(Math.random() * mockPayloads.length)];
                payloadEl.textContent = currentPacket.text;
                payloadEl.style.color = "var(--crt-cyan)";
            }, 800);
        }`,
    `        function nextPacket() {
            const payloadEl = document.getElementById('packetPayload');
            currentPacket = mockPayloads[Math.floor(Math.random() * mockPayloads.length)];
            const badgeHtml = currentPacket.malicious
                ? '<div style="margin-top:6px;padding:3px 8px;display:inline-block;background:rgba(127,29,29,0.9);border:1px solid #f87171;color:#fecaca;font-weight:bold;border-radius:3px;">[ THREAT -> BLOCK ]</div>'
                : '<div style="margin-top:6px;padding:3px 8px;display:inline-block;background:rgba(6,78,59,0.9);border:1px solid #00ff88;color:#6ee7b7;font-weight:bold;border-radius:3px;">[ SAFE -> ALLOW ]</div>';
            payloadEl.innerHTML = '<div>' + currentPacket.text + '</div>' + badgeHtml;
            payloadEl.style.color = currentPacket.malicious ? '#fca5a5' : '#6ee7b7';
        }`,
    'cyber clear visual tag permit/block'
  )
  s = replaceOnce(
    s,
    `function filterAction(action) {
            if (isPaused || isMissionEnded) return;`,
    `function filterAction(action) {
            if (isPaused || isMissionEnded || !currentPacket) return;`,
    'cyber null packet guard'
  )
  s = replaceOnce(
    s,
    `function resizeCanvas() { canvas.width = canvas.parentElement.clientWidth; canvas.height = canvas.parentElement.clientHeight; }
        window.addEventListener('resize', resizeCanvases = resizeCanvas);`,
    `function resizeCanvas() {
            const pw = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
            const ph = canvas.parentElement ? canvas.parentElement.clientHeight : 0;
            const w = pw >= 100 ? pw : Math.max(480, Math.floor((window.innerWidth || 960) * 0.55));
            const h = ph >= 100 ? ph : Math.max(320, Math.floor((window.innerHeight || 640) * 0.70));
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        }
        window.addEventListener('resize', resizeCanvas);`,
    'cyber safe resizeCanvas'
  )
  s = replaceOnce(
    s,
    `function render() {
            if (!isPaused && !isMissionEnded) missionTime += 0.016;`,
    `function render() {
            if (canvas.width < 100 || canvas.height < 100) resizeCanvas();
            if (!isPaused && !isMissionEnded) { missionTime += 0.016; updateUI(); }`,
    'cyber clock update and resize guard'
  )
  s = replaceOnce(
    s,
    `function completeMission() {
            isMissionEnded = true;
            document.getElementById('debriefModal').style.display = 'flex';`,
    `function completeMission() {
            isMissionEnded = true;
            document.getElementById('debriefModal').style.display = 'flex';
            document.getElementById('debTitle').textContent = "SATELLITE FIREWALL SEALED!";
            document.getElementById('debBadge').textContent = "SUCCESS";
            document.getElementById('debDesc').textContent = "Security perimeter repelled the telemetry exfiltration attempt.";`,
    'cyber complete reset labels'
  )
  s = replaceOnce(
    s,
    `if (packetsChecked >= 10 + difficulty * 5) {`,
    `const targetQuota = difficulty <= 1 ? 4 : (difficulty === 2 ? 5 : 6);
            if (packetsChecked >= targetQuota) {`,
    'cyber quota 4/5/6'
  )
  s = replaceOnce(
    s,
    "document.getElementById('shieldStatus').textContent = `SHIELD INTACT: ${shieldIntegrity}%`;",
    "const _tq = difficulty <= 1 ? 4 : (difficulty === 2 ? 5 : 6);\n            document.getElementById('shieldStatus').textContent = `SHIELD INTACT: ${shieldIntegrity}% · PACKETS: ${packetsChecked}/${_tq}`;",
    'cyber hud quota display'
  )
  s = common(
    s,
    'cyber',
    'SATELLITE CYBERDEFENSE & FIREWALL · SERPIENTE-2',
    'COMMS · SERPIENTE-2 (SAT-01 AMARU)'
  )
  fs.writeFileSync(path.join(OUT, 'ciberdefensa_satelital.html'), s)
}

// 9..16) 8 new minigames (2 additional per role -> 16 total)
for (const mg of getNewMinigames()) {
  const built = common(mg.html, mg.id, mg.h1, mg.badge)
  fs.writeFileSync(path.join(OUT, mg.filename), built)
}

// 16b) Victory Cinematic 1: Laser Transmission Successful 32x32
{
  let s = fs.readFileSync(
    path.join(SRC, 'cinem_tica_orbital_transmisi_n_l_ser_exitosa_32x32.html'),
    'utf8'
  ).replace(/\r\n/g, '\n')

  s = replaceOnce(
    s,
    `        .hud-panel {
            background: rgba(6, 14, 28, 0.92);
            border: 1px solid #0ea5e9;
            box-shadow: 0 0 24px rgba(14, 165, 233, 0.28), inset 0 0 12px rgba(56, 189, 248, 0.12);
        }`,
    `        .hud-panel {
            background: rgba(6, 14, 28, 0.94);
            border: 1px solid #0ea5e9;
            box-shadow: 0 0 24px rgba(14, 165, 233, 0.28), inset 0 0 12px rgba(56, 189, 248, 0.12);
        }
        .hidden { display: none !important; }`,
    'victory laser css hidden fallback'
  )

  s = replaceOnce(
    s,
    `        <!-- Floating controls in top-right corner -->
        <div class="absolute top-3 right-3 flex items-center gap-2 z-20 opacity-85 hover:opacity-100 transition-opacity">
            <button id="btn-export" class="px-2.5 py-1.5 rounded bg-slate-950/85 hover:bg-slate-900 border border-slate-700/80 text-emerald-300 font-bold text-[10px] sm:text-xs flex items-center gap-1.5 backdrop-blur-sm transition cursor-pointer" title="Download standalone HTML file">
                <span>⬇</span>
                <span>EXPORT HTML</span>
            </button>
            <button id="btn-audio" class="px-2.5 py-1.5 rounded bg-slate-950/85 hover:bg-slate-900 border border-slate-700/80 text-amber-300 font-bold text-[10px] sm:text-xs flex items-center gap-1.5 backdrop-blur-sm transition cursor-pointer">
                <span id="audio-icon">🔇</span>
                <span id="audio-label">AUDIO</span>
            </button>
            <button id="btn-restart" class="px-2.5 py-1.5 rounded bg-slate-950/85 hover:bg-slate-900 border border-slate-700/80 text-cyan-300 font-bold text-[10px] sm:text-xs flex items-center gap-1.5 backdrop-blur-sm transition cursor-pointer">
                <span>↻</span>
                <span>REPLAY</span>
            </button>
        </div>`,
    `        <!-- Top-left badge with live mission telemetry -->
        <div id="mission-param-badge" class="absolute top-3 left-3 z-20 px-3 py-1.5 rounded bg-slate-950/85 border border-cyan-500/60 backdrop-blur-sm pointer-events-none">
            <div id="param-badge-title" class="font-pixel text-[9px] sm:text-[10px] text-cyan-300">STAGE 1/3 · ANDES-CRYO-01</div>
            <div id="param-badge-sub" class="text-[10px] sm:text-xs text-emerald-300 font-bold mt-0.5">BASE SCIENCE: 0 PTS · INTEGRITY: 100%</div>
        </div>

        <!-- Floating controls in top-right corner -->
        <div class="absolute top-3 right-3 flex items-center gap-2 z-20 opacity-90 hover:opacity-100 transition-opacity">
            <button id="btn-export" class="hidden sm:flex px-2.5 py-1.5 rounded bg-slate-950/85 hover:bg-slate-900 border border-slate-700/80 text-emerald-300 font-bold text-[10px] sm:text-xs items-center gap-1.5 backdrop-blur-sm transition cursor-pointer" title="Download standalone HTML file">
                <span>⬇</span>
                <span>EXPORT HTML</span>
            </button>
            <button id="btn-audio" class="px-2.5 py-1.5 rounded bg-slate-950/85 hover:bg-slate-900 border border-slate-700/80 text-amber-300 font-bold text-[10px] sm:text-xs flex items-center gap-1.5 backdrop-blur-sm transition cursor-pointer">
                <span id="audio-icon">🔊</span>
                <span id="audio-label">AUDIO</span>
            </button>
            <button id="btn-restart" class="px-2.5 py-1.5 rounded bg-slate-950/85 hover:bg-slate-900 border border-slate-700/80 text-cyan-300 font-bold text-[10px] sm:text-xs flex items-center gap-1.5 backdrop-blur-sm transition cursor-pointer">
                <span>↻</span>
                <span>REPLAY</span>
            </button>
            <button id="btn-skip-top" class="px-2.5 py-1.5 rounded bg-emerald-950/90 hover:bg-emerald-900 border border-emerald-400/80 text-emerald-200 font-bold text-[10px] sm:text-xs flex items-center gap-1.5 backdrop-blur-sm transition cursor-pointer">
                <span>⏭</span>
                <span>CONTINUE</span>
            </button>
        </div>`,
    'victory laser top controls & telemetry badge'
  )

  s = replaceOnce(
    s,
    `        <!-- Mission Accomplished End Overlay -->
        <div id="end-overlay" class="hidden absolute inset-0 bg-slate-950/45 flex flex-col items-center justify-center p-4 z-20">
            <div class="hud-panel border-2 border-emerald-400/90 rounded-xl p-5 sm:p-6 max-w-sm w-full text-center space-y-4">
                <div class="inline-block px-3 py-1 rounded bg-emerald-500/20 border border-emerald-400/60 text-emerald-300 text-[10px] font-bold tracking-widest">
                    TRANSMISSION COMPLETE • 100% INTEGRITY
                </div>
                <h2 class="font-pixel text-xs sm:text-sm text-white leading-relaxed">
                    ORBITAL LINK SUCCESSFUL
                </h2>
                <p class="text-xs text-slate-300 leading-relaxed">
                    <span class="text-cyan-300 font-bold">SAT-01</span> and <span class="text-purple-300 font-bold">SAT-02</span> synchronized their sensors and transmitted the scientific packets to the ground network with zero signal loss.
                </p>
                <div class="pt-1 flex justify-center gap-2">
                    <button id="btn-replay-modal" class="px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white font-bold text-xs shadow-lg shadow-cyan-500/30 border border-cyan-300/60 transition cursor-pointer flex items-center gap-1.5">
                        <span>↻</span> REPLAY
                    </button>
                    <button id="btn-export-modal" class="px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-300 font-bold text-xs border border-emerald-500/50 transition cursor-pointer flex items-center gap-1.5">
                        <span>⬇</span> EXPORT HTML
                    </button>
                </div>
            </div>
        </div>`,
    `        <!-- Mission Accomplished End Overlay -->
        <div id="end-overlay" class="hidden absolute inset-0 bg-slate-950/55 flex flex-col items-center justify-center p-4 z-20">
            <div class="hud-panel border-2 border-emerald-400/90 rounded-xl p-5 sm:p-6 max-w-md w-full text-center space-y-3.5">
                <div id="modal-stage-badge" class="inline-block px-3 py-1 rounded bg-emerald-500/20 border border-emerald-400/60 text-emerald-300 text-[10px] font-bold tracking-widest">
                    TRANSMISSION COMPLETE • 100% INTEGRITY
                </div>
                <h2 id="modal-title" class="font-pixel text-xs sm:text-sm text-white leading-relaxed">
                    ORBITAL LINK SUCCESSFUL
                </h2>
                <p id="modal-mission-packet" class="text-xs text-emerald-200 font-bold leading-relaxed bg-emerald-950/55 border border-emerald-500/40 rounded px-3 py-2">
                    SAT-01 and SAT-02 synchronized their sensors and transmitted the scientific packets to the ground network with zero signal loss.
                </p>
                <div id="modal-mission-stats" class="grid grid-cols-3 gap-2 text-left">
                    <div class="bg-slate-950/80 border border-slate-700 rounded p-2">
                        <div class="text-[9px] text-cyan-300 font-bold">MISSION</div>
                        <div id="stat-mission-code" class="text-[11px] font-bold text-white truncate mt-0.5">ANDES-CRYO-01</div>
                    </div>
                    <div class="bg-slate-950/80 border border-slate-700 rounded p-2">
                        <div class="text-[9px] text-amber-300 font-bold">BASE SCIENCE</div>
                        <div id="stat-mission-points" class="text-[11px] font-bold text-emerald-300 mt-0.5">0 PTS</div>
                    </div>
                    <div class="bg-slate-950/80 border border-slate-700 rounded p-2">
                        <div class="text-[9px] text-emerald-300 font-bold">INTEGRITY</div>
                        <div id="stat-mission-health" class="text-[11px] font-bold text-cyan-200 mt-0.5">100%</div>
                    </div>
                </div>
                <div id="modal-auto-note" class="text-[10px] text-cyan-300 font-bold"></div>
                <div class="pt-1 flex flex-col sm:flex-row justify-center gap-2">
                    <button id="btn-next-stage" class="px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-pixel text-[9px] sm:text-[10px] shadow-lg shadow-emerald-500/35 border border-emerald-200 transition cursor-pointer flex items-center justify-center gap-1.5">
                        ✔ CONTINUE TO MISSION SUMMARY
                    </button>
                    <button id="btn-replay-modal" class="px-3.5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 font-bold text-xs border border-cyan-500/50 transition cursor-pointer flex items-center justify-center gap-1.5">
                        <span>↻</span> REPLAY
                    </button>
                    <button id="btn-export-modal" class="hidden">⬇</button>
                </div>
            </div>
        </div>`,
    'victory laser modal mission stats & continue button'
  )

  s = replaceOnce(
    s,
    `        class EpicOrbitalAudio {
            constructor() {
                this.ctx = null;
                this.enabled = false;
            }

            toggle() {
                if (!this.ctx) {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    this.ctx = new AudioContext();
                }
                if (this.ctx.state === 'suspended') {
                    this.ctx.resume();
                }
                this.enabled = !this.enabled;
                return this.enabled;
            }

            playTelemetryPulse(freq = 520, duration = 0.09, type = 'sine', vol = 0.06) {
                if (!this.enabled || !this.ctx) return;`,
    `        class EpicOrbitalAudio {
            constructor() {
                this.ctx = null;
                this.enabled = true;
            }

            unlock() {
                try {
                    if (!this.ctx) {
                        const AudioCtx = window.AudioContext || window.webkitAudioContext;
                        if (AudioCtx) this.ctx = new AudioCtx();
                    }
                    if (this.ctx && this.ctx.state === 'suspended') {
                        this.ctx.resume().catch(() => {});
                    }
                } catch (e) {}
            }

            toggle() {
                this.unlock();
                this.enabled = !this.enabled;
                return this.enabled;
            }

            playTelemetryPulse(freq = 520, duration = 0.09, type = 'sine', vol = 0.06) {
                if (!this.enabled) return;
                if (!this.ctx) this.unlock();
                if (!this.ctx) return;
                if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});`,
    'victory laser audio active on start'
  )

  s = replaceOnce(
    s,
    `            playBeamActivationChord() {
                if (!this.enabled || !this.ctx) return;`,
    `            playBeamActivationChord() {
                if (!this.enabled) return;
                if (!this.ctx) this.unlock();
                if (!this.ctx) return;
                if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});`,
    'victory laser chord audio unlock'
  )

  s = replaceOnce(
    s,
    `            playSuccessFanfare() {
                if (!this.enabled || !this.ctx) return;`,
    `            playSuccessFanfare() {
                if (!this.enabled) return;
                if (!this.ctx) this.unlock();
                if (!this.ctx) return;
                if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});`,
    'victory laser fanfare audio unlock'
  )

  s = replaceOnce(
    s,
    `        const END_MODAL_TIME = 12.2;     // Aparece panel final de misión cumplida`,
    `        const END_MODAL_TIME = 12.0;     // Mission accomplished panel appears
        const urlParams = new URLSearchParams(window.location.search);
        const paramMissionNum = urlParams.get('mission') || '1';
        const paramMissionCode = urlParams.get('code') || 'ANDES-CRYO-01';
        const paramPoints = Math.max(0, Math.round(Number(urlParams.get('points') || 0)));
        const paramHealth = Math.max(0, Math.min(100, Math.round(Number(urlParams.get('health') ?? 100))));
        const isFinalMission = urlParams.get('isFinal') === '1' || paramMissionNum === '3';
        const isReplayMode = urlParams.get('replay') === '1';
        const missionPacketMsg =
            paramMissionNum === '1'
                ? '✔ 4.8 TB of Glacial Thermal Mapping sent to CENEPRED / NASA'
                : paramMissionNum === '2'
                    ? '✔ 12.4 TB of Lunar Ice Spectrometry sent to Artemis Base'
                    : '✔ L1 Geomagnetic Alert transmitted on time — Global Power Grid Protected';

        let endModalOpenedAt = null;
        let nextCinematicSent = false;

        function sendVictoryNextToParent(isAuto) {
            if (nextCinematicSent) return;
            nextCinematicSent = true;
            try {
                window.parent.postMessage({ type: 'VICTORY_CINEMATIC_NEXT', isFinal: isFinalMission, auto: Boolean(isAuto) }, '*');
            } catch (e) {}
        }

        function applyMissionParamsToUI() {
            const bTitle = document.getElementById('param-badge-title');
            const bSub = document.getElementById('param-badge-sub');
            const mBadge = document.getElementById('modal-stage-badge');
            const mTitle = document.getElementById('modal-title');
            const mPacket = document.getElementById('modal-mission-packet');
            const sCode = document.getElementById('stat-mission-code');
            const sPts = document.getElementById('stat-mission-points');
            const sHp = document.getElementById('stat-mission-health');
            const btnNext = document.getElementById('btn-next-stage');
            const btnSkip = document.getElementById('btn-skip-top');
            if (bTitle) bTitle.textContent = \`STAGE \${paramMissionNum}/3 · \${paramMissionCode}\`;
            if (bSub) bSub.textContent = \`BASE SCIENCE: \${paramPoints} PTS · INTEGRITY: \${paramHealth}%\`;
            if (mBadge) mBadge.textContent = \`MISSION \${paramMissionNum}/3 • \${paramMissionCode} • 100% LINK\`;
            if (mTitle) mTitle.textContent = isFinalMission ? 'L1 SOLAR ALERT TRANSMITTED SUCCESSFULLY' : 'ORBITAL LINK SUCCESSFUL';
            if (mPacket) mPacket.textContent = missionPacketMsg;
            if (sCode) sCode.textContent = paramMissionCode;
            if (sPts) sPts.textContent = \`\${paramPoints} PTS\`;
            if (sHp) sHp.textContent = \`\${paramHealth}%\`;
            if (btnNext) {
                btnNext.textContent = isReplayMode
                    ? '[ ✔ RETURN TO NASA HONOR ROLL ]'
                    : isFinalMission
                        ? '[ 🚀 LAUNCH RETURN HOME (EAGLE MISSION) ]'
                        : '[ ✔ VIEW MISSION SUMMARY & NASA BONUSES ]';
            }
            if (btnSkip && isReplayMode) {
                btnSkip.innerHTML = '<span>✔</span><span>RETURN</span>';
            }
        }`,
    'victory laser url params & parent postMessage'
  )

  s = replaceOnce(
    s,
    `            } else if (t >= DOWNLINK_START_TIME && t < COMPLETE_TIME) {
                banner.classList.remove('hidden');
                bannerMain.textContent = '📡 TRANSMITTING DATA TO EARTH 📡';
                bannerSub.textContent = 'HIGH-SPEED QUANTUM STREAM • OPTIMAL SIGNAL';`,
    `            } else if (t >= DOWNLINK_START_TIME && t < COMPLETE_TIME) {
                banner.classList.remove('hidden');
                bannerMain.textContent = isFinalMission
                    ? '🌞 TRANSMITTING L1 SOLAR ALERT TO EARTH 📡'
                    : \`📡 TRANSMITTING MISSION \${paramMissionNum}: \${paramMissionCode} 📡\`;
                bannerSub.textContent = isFinalMission
                    ? 'SAT-01 AMARU & SAT-02 INTI PROTECTING THE GLOBAL POWER GRID'
                    : 'HIGH-SPEED QUANTUM STREAM • CENEPRED / ARTEMIS / NASA';`,
    'victory laser mission-aware banner'
  )

  s = replaceOnce(
    s,
    `            // 7. Mostrar panel final al concluir la secuencia
            if (t >= END_MODAL_TIME) {
                const endOverlay = document.getElementById('end-overlay');
                if (endOverlay && endOverlay.classList.contains('hidden')) {
                    endOverlay.classList.remove('hidden');
                }
            }`,
    `            // 7. Show final modal upon sequence completion and gently auto-advance if applicable
            if (t >= END_MODAL_TIME) {
                const endOverlay = document.getElementById('end-overlay');
                if (endOverlay && endOverlay.classList.contains('hidden')) {
                    endOverlay.classList.remove('hidden');
                    endModalOpenedAt = performance.now();
                }
                const noteEl = document.getElementById('modal-auto-note');
                if (!isReplayMode && endModalOpenedAt && !nextCinematicSent) {
                    const waitMs = isFinalMission ? 2000 : 2400;
                    const remMs = Math.max(0, waitMs - (performance.now() - endModalOpenedAt));
                    if (noteEl) {
                        noteEl.textContent = isFinalMission
                            ? \`Launching Eagle Mission · Return Home in \${(remMs / 1000).toFixed(1)}s...\`
                            : \`Opening official NASA summary in \${(remMs / 1000).toFixed(1)}s...\`;
                    }
                    if (remMs <= 0) {
                        sendVictoryNextToParent(true);
                    }
                } else if (noteEl) {
                    noteEl.textContent = '';
                }
            }`,
    'victory laser end overlay auto advance'
  )

  s = replaceOnce(
    s,
    `            const endOverlay = document.getElementById('end-overlay');
            const banner = document.getElementById('mission-banner');
            const transferHud = document.getElementById('transfer-hud');`,
    `            endModalOpenedAt = null;
            nextCinematicSent = false;
            const endOverlay = document.getElementById('end-overlay');
            const banner = document.getElementById('mission-banner');
            const transferHud = document.getElementById('transfer-hud');`,
    'victory laser resetCinematic reset flags'
  )

  s = replaceOnce(
    s,
    `        window.onload = function () {
            resizeCanvas();
            resetCinematic();
            requestAnimationFrame(mainLoop);
        };`,
    `        document.getElementById('btn-next-stage').addEventListener('click', () => sendVictoryNextToParent(false));
        document.getElementById('btn-skip-top').addEventListener('click', () => sendVictoryNextToParent(false));
        window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
        window.addEventListener('keydown', () => audio.unlock(), { once: true });

        window.onload = function () {
            applyMissionParamsToUI();
            audio.unlock();
            resizeCanvas();
            resetCinematic();
            requestAnimationFrame(mainLoop);
        };`,
    'victory laser onload & postMessage buttons'
  )

  fs.writeFileSync(path.join(OUT, 'victory_laser_transmission.html'), s)
}

// 16c) Final Victory Cinematic: Eagle Mission · Return Home
{
  let s = fs.readFileSync(
    path.join(SRC, 'Misión Águila · Regreso a casa.html'),
    'utf8'
  ).replace(/\r\n/g, '\n')

  s = replaceOnce(
    s,
    `<div class="bar" id="tb"><span>EAGLE MISSION</span><span id="ck">T+00:00</span></div>`,
    `<div class="bar" id="tb"><span>EAGLE MISSION · RETURN HOME</span><span id="ck">T+00:00</span></div>
<button id="skipBtn" type="button" style="position:absolute;top:10.5%;right:2%;z-index:6;font-size:calc(var(--u)*.013);padding:.7% 1.4%;background:rgba(8,15,35,.85);color:#7dd3fc;border:1px solid rgba(56,189,248,.7);box-shadow:2px 2px 0 #000">⏭ SKIP TO HONOR ROLL</button>`,
    'victory return home skip button'
  )

  s = replaceOnce(
    s,
    `<div id="s"><h1>EAGLE MISSION<br>RETURN HOME</h1><button id="b">▶ LAUNCH (with audio)</button></div>`,
    `<div id="s" style="display:none"><h1>EAGLE MISSION<br>RETURN HOME</h1><button id="b">↻ REPLAY</button></div>`,
    'victory return home hide initial splash'
  )

  s = replaceOnce(
    s,
    ` if(d>38&&!ended){ended=1;const s=$('s');s.style.display='flex';s.className='end';$('b').textContent='↻ REPLAY'}`,
    ` if(d>=38&&!ended){ended=1;const sk=$('skipBtn');if(sk)sk.style.display='none';notifyReturnHomeFinished(false)}`,
    'victory return home 38s end postMessage'
  )

  s = replaceOnce(
    s,
    `$('b').onclick=()=>{t0=performance.now();f1=f2=f3=0;flash=0;ended=0;const s=$('s');s.style.display='none';s.className='';sound()};
requestAnimationFrame(frame);`,
    `let finishedPosted=0;
function stopReturnAudio(){try{if(ac&&ac.state!=='closed')ac.close()}catch(e){}}
function notifyReturnHomeFinished(skipped){
  if(finishedPosted)return;
  finishedPosted=1;
  if(skipped)stopReturnAudio();
  try{window.parent.postMessage({type:'RETURN_HOME_FINISHED',skipped:Boolean(skipped)},'*')}catch(e){}
}
function startReturnHome(){
  t0=performance.now();f1=f2=f3=0;flash=0;ended=0;finishedPosted=0;
  const s=$('s');s.style.display='none';s.className='';
  const sk=$('skipBtn');if(sk)sk.style.display='block';
  sound();
  if(ac&&ac.state==='suspended')ac.resume().catch(()=>{});
}
$('skipBtn').onclick=()=>{ended=1;notifyReturnHomeFinished(true)};
$('b').onclick=startReturnHome;
const unlockReturnAudio=()=>{try{if(ac&&ac.state==='suspended')ac.resume().catch(()=>{})}catch(e){}};
window.addEventListener('pointerdown',unlockReturnAudio,{once:true});
window.addEventListener('keydown',unlockReturnAudio,{once:true});
startReturnHome();
requestAnimationFrame(frame);`,
    'victory return home auto-start & skip handler'
  )

  fs.writeFileSync(path.join(OUT, 'victory_return_home.html'), s)
}

// 17) Automatic JS syntax validation of all 16 minigames and cinematics in public/minigames/*.html
const htmlFiles = fs.readdirSync(OUT).filter((f) => f.endsWith('.html')).sort()
const CINEMATIC_FILES = new Set([
  'game_over_explosion.html',
  'victory_laser_transmission.html',
  'victory_return_home.html',
])
const minigameFiles = htmlFiles.filter((f) => !CINEMATIC_FILES.has(f))
let validatedScripts = 0
for (const file of htmlFiles) {
  const fullPath = path.join(OUT, file)
  const html = fs.readFileSync(fullPath, 'utf8')
  const scriptMatches = [...html.matchAll(/<script(?:\s+([^>]*))?>([\s\S]*?)<\/script>/gi)]
  for (let i = 0; i < scriptMatches.length; i++) {
    const attrs = scriptMatches[i][1] || ''
    if (/\bsrc\s*=/.test(attrs)) continue
    const code = scriptMatches[i][2]
    try {
      new Function(code)
      validatedScripts++
    } catch (err) {
      console.error(`JS SYNTAX ERROR in ${file} (script #${i}):`, err.message)
      process.exit(1)
    }
  }
}

console.log(
  `OK ${minigameFiles.length} minigames generated (+${htmlFiles.length - minigameFiles.length} cinematics) and ${validatedScripts} <script> blocks validated without errors in`,
  OUT
)
