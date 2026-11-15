// Genera public/minigames/*.html a partir de minijuegos_origen/*.html
// (conserva el código original y aplica sólo los parches de integración React + dual SAT-01/SAT-02).
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', 'minijuegos_origen')
const OUT = path.join(__dirname, '..', 'public', 'minigames')
fs.mkdirSync(OUT, { recursive: true })

function readFirstAvailable(candidates) {
  for (const f of candidates) {
    const p = path.join(SRC, f)
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  }
  throw new Error('No se encontró archivo origen entre: ' + candidates.join(', '))
}

function replaceOnce(src, find, repl, label) {
  const idx = typeof find === 'string' ? src.indexOf(find) : src.search(find)
  if (idx < 0) throw new Error('Patch no aplicado: ' + label)
  return src.replace(find, () => repl)
}

const bridge = (gameId) => `
<script>
/* === Puente con la Estación Espacial (iframe -> React) === */
(function () {
  var victorySent = false;
  function notifyVictory() {
    if (victorySent) return;
    victorySent = true;
    var payload = { type: 'MINIGAME_COMPLETE', game: '${gameId}', success: true };
    try { window.parent.postMessage(payload, '*'); } catch (e) {}
    try { window.parent.postMessage({ type: 'minigame-complete', game: '${gameId}', success: true }, '*'); } catch (e) {}
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      try { window.parent.postMessage({ type: 'minigame-close', game: '${gameId}' }, '*'); } catch (err) {}
    }
  });

  // 1) Minijuegos nuevos: completeMission(...)
  var origComplete = window.completeMission;
  if (typeof origComplete === 'function') {
    window.completeMission = function (arg0) {
      var r = origComplete.apply(this, arguments);
      if (arg0 !== false) notifyVictory();
      return r;
    };
  }

  // 2) Minijuegos v2: showDebriefModal(success, ...)
  var origDebrief = window.showDebriefModal;
  if (typeof origDebrief === 'function') {
    window.showDebriefModal = function (success) {
      var r = origDebrief.apply(this, arguments);
      if (success === true) notifyVictory();
      return r;
    };
  }

  // Permitir reintento limpio si el jugador repite dentro del modal
  ['resetMission', 'setupScenario', 'setupDifficulty', 'closeModalAndRetry'].forEach(function (fnName) {
    var origFn = window[fnName];
    if (typeof origFn === 'function') {
      window[fnName] = function () {
        victorySent = false;
        return origFn.apply(this, arguments);
      };
    }
  });

  window.addEventListener('load', function () { try { window.focus(); } catch (e) {} });
})();
</script>
`

function common(src, gameId, h1) {
  src = src.replace(/<button class="btn-(?:header|ui)" onclick="location\.href='index\.html'"[^>]*>[^<]*<\/button>\s*/g, '')
  if (h1) src = src.replace(/<h1>[^<]*<\/h1>/, `<h1>${h1}</h1>`)
  return src.replace('</body>', () => bridge(gameId) + '</body>')
}

// 1) Acoplamiento Espacial 6-DOF (CÓNDOR-4)
{
  let s = readFirstAvailable(['acoplamiento_espacial_2.html', 'acoplamiento_espacial.html'])
  s = common(s, 'dock', 'ACOPLAMIENTO ESPACIAL 6-DOF APAS · CÓNDOR-4')
  fs.writeFileSync(path.join(OUT, 'acoplamiento_espacial.html'), s)
}

// 2) Distribución Eléctrica EPS (ALPACA-1)
{
  let s = readFirstAvailable(['distribucion_electrica_2.html', 'distribucion_electrica.html'])
  s = common(s, 'eps', 'DISTRIBUCIÓN ELÉCTRICA EPS · ALPACA-1 · POWER MGD')
  fs.writeFileSync(path.join(OUT, 'distribucion_electrica.html'), s)
}

// 3) Soporte Vital ECLSS (ALPACA-1)
{
  let s = readFirstAvailable(['soporte_vital_2.html', 'soporte_vital.html'])
  s = common(s, 'eclss', 'SOPORTE VITAL ECLSS Y TANQUES O2 · ALPACA-1')
  fs.writeFileSync(path.join(OUT, 'soporte_vital.html'), s)
}

// 4) Navegación Orbital Hohmann Dual SAT-01 AMARU-COMMS / SAT-02 INTI-SCIENCE (PUMA-3 & SERPIENTE-2)
{
  let s = readFirstAvailable(['navegacion_orbital_2.html', 'navegacion_orbital.html'])
  s = common(s, 'nav', 'NAVEGACIÓN ORBITAL HOHMANN DUAL · SAT-01 AMARU-COMMS / SAT-02 INTI-SCIENCE')

  // CSS compacto para los dos monitores satelitales en la barra lateral
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

  // Selector dual arriba de telemetry-sidebar
  s = replaceOnce(
    s,
    '<div class="telemetry-sidebar">',
    `<div class="telemetry-sidebar">
            <div class="card-panel">
                <div class="card-header">
                    <span>SATÉLITES EN ÓRBITA (180°)</span>
                    <span id="dualSatTag" style="color:var(--crt-cyan)">0/2 LISTOS</span>
                </div>
                <div class="dual-monitors">
                    <div class="sat-mon active" id="mon1" onclick="selectSat(0)">
                        <div class="sat-mon-title">SAT-01 AMARU-COMMS</div>
                        <canvas id="satCanvas1" width="128" height="48"></canvas>
                        <div class="sat-mon-meta"><span id="alt1">412 km</span><span id="tgt1">550 km</span></div>
                        <button type="button" class="btn-sel active" id="btnSel1" onclick="event.stopPropagation(); selectSat(0)">CONTROLAR SAT-01</button>
                    </div>
                    <div class="sat-mon s2" id="mon2" onclick="selectSat(1)">
                        <div class="sat-mon-title">SAT-02 INTI-SCIENCE</div>
                        <canvas id="satCanvas2" width="128" height="48"></canvas>
                        <div class="sat-mon-meta"><span id="alt2">436 km</span><span id="tgt2">495 km</span></div>
                        <button type="button" class="btn-sel" id="btnSel2" onclick="event.stopPropagation(); selectSat(1)">CONTROLAR SAT-02</button>
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
            const sat2Dv = Math.max(35, Math.round(Math.abs(sat2Target - sat2Alt) * 0.98));
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
                mText.textContent = 'MISIÓN: ' + sats[selectedSat].name + ' · MANIOBRA HOHMANN';
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

  // Física: ambos satélites orbitan simultáneamente en el radar
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

  // checkOutcome: exige alinear tanto SAT-01 como SAT-02
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
            if (sats.length >= 2 && !sats.every(function (x) { return x.done; })) {
                orbitState.isEnded = false;
                var otherIdx = selectedSat === 0 ? 1 : 0;
                var other = sats[otherIdx];
                var pill = document.getElementById('missionStatusPill');
                if (pill) { pill.textContent = orbitState.short + ' ✔ · FALTA ' + other.short; pill.style.color = 'var(--crt-green)'; }
                var goal = document.getElementById('missionGoal');
                if (goal) goal.textContent = orbitState.name + ' ALINEADO ✔. Ahora selecciona ' + other.name + ' arriba y ejecuta su maniobra.';
                updateUI();
                return;
            }
            const maxErr = sats.length ? Math.max.apply(null, sats.map(function (x) { return x.err || 0; })) : error;
            showDebriefModal(true, maxErr);
        }`,
    'nav checkOutcome dual'
  )

  // Dibujo del satélite opuesto en drawOrbitScene + mini monitores pixel-art SAT-01 y SAT-02
  s = replaceOnce(
    s,
    `// Elemento Tobera proyectado en la esquina derecha del HUD`,
    `// Satélite secundario (opuesto 180° en órbita)
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
            ctx.fillText((orbitState.short || 'SAT-01') + ' ▶', shipX + 8, shipY - 6);

            // Elemento Tobera proyectado en la esquina derecha del HUD`,
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
                    dtTag.textContent = readyCount + '/2 LISTOS';
                    dtTag.style.color = readyCount === 2 ? '#00ff88' : '#00e5ff';
                }
            }`,
    'nav updateUI dual'
  )

  fs.writeFileSync(path.join(OUT, 'navegacion_orbital.html'), s)
}

// 5) Aterrizaje Planetario (PUMA-3)
{
  let s = readFirstAvailable(['aterrizaje_planetario.html'])
  s = replaceOnce(
    s,
    'La Alpaca Astronauta logró posar el módulo en la superficie del planeta extraño sin daños estructurales.',
    'La sonda científica del Escuadrón Andino logró posarse en la superficie planetaria sin daños estructurales.',
    'lander squad text'
  )
  s = replaceOnce(
    s,
    `function nextLevelOrFinish() { alert("¡Felicidades por completar la Hackathon con éxito total!"); location.href='index.html'; }`,
    `function nextLevelOrFinish() {
            document.getElementById('debriefModal').style.display = 'none';
            if (difficulty < 3) {
                document.getElementById('diffSelect').value = String(difficulty + 1);
                setupScenario(difficulty + 1);
            } else {
                try { window.parent.postMessage({ type: 'minigame-close', game: 'lander' }, '*'); } catch (e) {}
            }
        }`,
    'lander nextLevel'
  )
  s = common(s, 'lander', 'ATERRIZAJE PLANETARIO DE SONDA CIENTÍFICA · PUMA-3')
  fs.writeFileSync(path.join(OUT, 'aterrizaje_planetario.html'), s)
}

// 6) Sintonización de Telecomunicaciones (SERPIENTE-2)
{
  let s = readFirstAvailable(['reparacion_telecom.html'])
  s = common(s, 'telecom', 'SINTONIZACIÓN DE TELECOMUNICACIONES DSN · SERPIENTE-2')
  fs.writeFileSync(path.join(OUT, 'reparacion_telecom.html'), s)
}

// 7) Defensa Orbital contra Meteoritos (CÓNDOR-4)
{
  let s = readFirstAvailable(['reencuentro_cometa.html'])
  s = common(s, 'comet', 'DEFENSA ORBITAL CONTRA METEORITOS · CÓNDOR-4')
  fs.writeFileSync(path.join(OUT, 'reencuentro_cometa.html'), s)
}

// 8) Ciberdefensa Satelital (SERPIENTE-2)
{
  let s = readFirstAvailable(['ciberdefensa_satelital.html'])
  s = common(s, 'cyber', 'CIBERDEFENSA SATELITAL Y FIREWALL · SERPIENTE-2')
  fs.writeFileSync(path.join(OUT, 'ciberdefensa_satelital.html'), s)
}

console.log('OK 8 minijuegos generados en', OUT)
