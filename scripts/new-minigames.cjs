// Generador de los 8 minijuegos CRT nuevos (uno por consola avanzada) en HTML5 Canvas + Web Audio puro.
// Exporta getNewMinigames() -> Array<{ filename, id, h1, badge, html }>

const BASE_CSS = `
:root {
  --bg: #050811;
  --panel: #0a1120;
  --border: #1e2d48;
  --crt-green: #00ff88;
  --crt-cyan: #00e5ff;
  --crt-amber: #ffb703;
  --crt-red: #ff3b5c;
  --text: #e2e8f0;
  --dim: #7c8ea6;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: 100%; height: 100%; overflow: hidden;
  background: var(--bg); color: var(--text);
  font-family: 'Courier New', Consolas, monospace;
}
body { display: flex; flex-direction: column; }
.scanlines {
  position: fixed; inset: 0; pointer-events: none; z-index: 90;
  background: repeating-linear-gradient(0deg, rgba(0,229,255,0.025) 0px, rgba(0,0,0,0.16) 2px, transparent 3px);
}
header {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 14px; background: #080d1a; border-bottom: 2px solid var(--border);
  flex-shrink: 0; z-index: 10;
}
.title-block { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.badge-system {
  display: inline-block; width: fit-content;
  font-size: 10px; font-weight: bold; letter-spacing: 1px;
  color: var(--crt-cyan); background: rgba(0,229,255,0.1);
  border: 1px solid rgba(0,229,255,0.35); padding: 2px 6px;
}
h1 { font-size: 14px; letter-spacing: 0.6px; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
.select-diff, .btn-header {
  background: #0f192d; color: #e2e8f0; border: 1px solid #2c4063;
  font-family: inherit; font-size: 11px; font-weight: bold;
  padding: 5px 9px; cursor: pointer; border-radius: 2px;
}
.btn-header:hover { border-color: var(--crt-cyan); color: #fff; }
.workspace {
  flex: 1; min-height: 0; display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(270px, 0.95fr);
  gap: 10px; padding: 10px; z-index: 5;
}
.panel {
  background: var(--panel); border: 2px solid var(--border);
  display: flex; flex-direction: column; min-height: 0; position: relative;
  box-shadow: inset 0 0 24px rgba(0,0,0,0.65);
}
.panel-head {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 7px 10px; background: #0d1629; border-bottom: 1px solid var(--border);
  font-size: 11px; font-weight: bold; letter-spacing: 0.5px; color: var(--crt-cyan); flex-shrink: 0;
}
.canvas-wrap { flex: 1; min-height: 0; position: relative; background: #03060e; }
.canvas-wrap canvas { width: 100%; height: 100%; display: block; }
.hud-banner {
  position: absolute; left: 50%; top: 10px; transform: translateX(-50%);
  padding: 5px 12px; background: rgba(7,12,24,0.92); border: 1px solid var(--crt-amber);
  color: var(--crt-amber); font-size: 11px; font-weight: bold; z-index: 8;
  pointer-events: none; opacity: 0; transition: opacity 0.2s; white-space: nowrap;
}
.hud-banner.show { opacity: 1; }
.hud-banner.ok { border-color: var(--crt-green); color: var(--crt-green); }
.hud-banner.err { border-color: var(--crt-red); color: var(--crt-red); }
.side-body {
  flex: 1; min-height: 0; padding: 10px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 8px;
}
.tele-card {
  background: #060b16; border: 1px solid #1b2b45; padding: 8px 10px;
  display: flex; flex-direction: column; gap: 5px;
}
.tele-row { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
.tele-lbl { color: var(--dim); }
.tele-val { font-weight: bold; color: var(--crt-cyan); }
.bar-bg { width: 100%; height: 8px; background: #0b1324; border: 1px solid #1e3150; overflow: hidden; }
.bar-fill { height: 100%; background: var(--crt-green); transition: width 0.12s; }
.ctrl-box { background: #070d1a; border: 1px solid #1c2c46; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.slider { width: 100%; accent-color: var(--crt-cyan); cursor: pointer; }
.btn-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.btn-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
.btn-ctrl {
  background: #10203a; color: #e2e8f0; border: 1px solid #2b4570;
  font-family: inherit; font-size: 11px; font-weight: bold; padding: 7px 6px; cursor: pointer;
}
.btn-ctrl:hover:not(:disabled) { border-color: var(--crt-cyan); background: #162b4d; }
.btn-ctrl.active { border-color: var(--crt-green); background: #052e22; color: var(--crt-green); }
.btn-ctrl.warn { border-color: var(--crt-amber); color: var(--crt-amber); }
.btn-ctrl:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary {
  background: linear-gradient(180deg, #0284c7, #0369a1); color: #fff;
  border: 1px solid #38bdf8; font-family: inherit; font-size: 12px; font-weight: bold;
  padding: 9px; cursor: pointer; width: 100%;
}
.btn-primary:hover:not(:disabled) { filter: brightness(1.12); }
.btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
.note-box { background: rgba(0,0,0,0.35); border-left: 3px solid var(--crt-cyan); padding: 7px 9px; font-size: 11px; color: #9fb2c9; line-height: 1.4; }
.guide-box { background: rgba(6,78,59,0.35); border: 1px solid var(--crt-green); color: #a7f3d0; padding: 6px 8px; font-size: 11px; font-weight: bold; line-height: 1.35; border-radius: 3px; }
.btn-assist { background: linear-gradient(180deg, #059669, #047857); color: #ecfdf5; border: 1px solid var(--crt-green); font-family: inherit; font-size: 11px; font-weight: bold; padding: 7px 8px; cursor: pointer; width: 100%; border-radius: 3px; box-shadow: 0 0 10px rgba(0,255,136,0.22); }
.btn-assist:hover { filter: brightness(1.15); }
.modal-overlay {
  display: none; position: fixed; inset: 0; background: rgba(2,5,12,0.86);
  z-index: 80; align-items: center; justify-content: center; padding: 16px;
}
.modal-card {
  width: 520px; max-width: 96%; background: #0c1426; border: 2px solid var(--crt-cyan);
  box-shadow: 0 0 32px rgba(0,229,255,0.28); padding: 18px;
  display: flex; flex-direction: column; gap: 12px;
}
.modal-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #24395c; padding-bottom: 8px; }
.modal-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #070d1a; border: 1px solid #1e2f4d; padding: 10px; font-size: 11px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 820px) {
  .workspace { grid-template-columns: 1fr; grid-template-rows: 1.1fr 1fr; }
}
`

const SHARED_HELPERS = `
let audioCtx = null;
let soundEnabled = true;
window.__mgAdjustCount = 0;
function noteUserAdjust() {
  window.__mgAdjustCount = (window.__mgAdjustCount || 0) + 1;
}
function setGuideText(msg) {
  var g = document.getElementById('directGuideBox');
  if (g && msg) g.textContent = msg;
}
function triggerQuickAssist() {
  noteUserAdjust();
  if (typeof autoAssistMinigame === 'function') autoAssistMinigame();
  if (typeof playTone === 'function') playTone(840, 0.12, 'triangle');
}
function initAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function playTone(freq, dur, type) {
  if (!soundEnabled) return;
  try {
    initAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq || 440, audioCtx.currentTime);
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (dur || 0.08));
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + (dur || 0.08));
  } catch (e) {}
}
function toggleAudio() {
  soundEnabled = !soundEnabled;
  var el = document.getElementById('btnAudio');
  if (el) el.textContent = soundEnabled ? '🔊 AUDIO: ON' : '🔇 AUDIO: OFF';
  if (soundEnabled) playTone(760, 0.07, 'sine');
}
var hudTimer = null;
function showHud(msg, kind) {
  if (typeof window.__showConsoleHudNotice === 'function') {
    window.__showConsoleHudNotice(msg, kind === 'err' ? 'warn' : (kind || 'ok'));
    return;
  }
  var b = document.getElementById('hudBanner');
  if (!b) return;
  b.textContent = msg;
  b.className = 'hud-banner show' + (kind ? ' ' + kind : '');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(function () { b.classList.remove('show'); }, 2200);
}
function fmtClock(sec) {
  var s = Math.max(0, Math.floor(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function resizeCanvasEl(c) {
  if (!c) return;
  var pw = c.parentElement ? c.parentElement.clientWidth : 0;
  var ph = c.parentElement ? c.parentElement.clientHeight : 0;
  var w = pw >= 100 ? pw : Math.max(480, Math.floor((window.innerWidth || 960) * 0.55));
  var h = ph >= 100 ? ph : Math.max(320, Math.floor((window.innerHeight || 640) * 0.70));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}
`

function wrapGame({ id, title, h1, badge, diffOptions, leftTitle, leftTagId, leftTagText, extraCanvasHtml = '', guideText = 'Sigue la guía en pantalla o pulsa AUTO-CALIBRAR.', rightHtml, modalTitle, modalStatsHtml, scriptBody }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${BASE_CSS}</style>
</head>
<body>
<div class="scanlines"></div>
<header>
  <div class="title-block">
    <span class="badge-system">${badge}</span>
    <h1>${h1}</h1>
  </div>
  <div class="top-controls">
    <label for="diffSelect" style="font-size:11px;color:var(--dim);">NIVEL:</label>
    <select id="diffSelect" class="select-diff" onchange="changeDifficulty(this.value)">
      ${diffOptions}
    </select>
    <button class="btn-header" onclick="toggleAudio()" id="btnAudio">🔊 AUDIO: ON</button>
    <button class="btn-header" onclick="togglePause()" id="btnPause">⏸ PAUSA</button>
    <button class="btn-header" onclick="resetMission()">↻ REINICIAR</button>
  </div>
</header>
<div class="workspace">
  <div class="panel">
    <div class="panel-head">
      <span>${leftTitle}</span>
      <span id="${leftTagId}" style="color:var(--crt-amber)">${leftTagText}</span>
    </div>
    <div class="canvas-wrap">
      <canvas id="mainCanvas"></canvas>
      <div id="hudBanner" class="hud-banner"></div>
      ${extraCanvasHtml}
    </div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <span>CONSOLA DE CONTROL</span>
      <span id="clockDisplay">00:00</span>
    </div>
    <div class="side-body">
      <div class="guide-box" id="directGuideBox">${guideText}</div>
      <button type="button" class="btn-assist" id="btnQuickAssist" onclick="triggerQuickAssist()">⚡ AUTO-CALIBRAR / ASISTENCIA IA</button>
      ${rightHtml}
    </div>
  </div>
</div>
<div class="modal-overlay" id="debriefModal">
  <div class="modal-card">
    <div class="modal-head">
      <span style="font-size:15px;font-weight:bold;color:var(--crt-green)" id="debTitle">${modalTitle}</span>
      <span class="badge-system" id="debBadge">ÉXITO</span>
    </div>
    <p id="debDesc" style="font-size:12px;color:#cbd5e1;line-height:1.5;">Sistema estabilizado nominalmente.</p>
    <div class="modal-metrics">${modalStatsHtml}</div>
    <div class="modal-actions">
      <button class="btn-header" onclick="closeModalAndRetry()">REINTENTAR</button>
      <button class="btn-header" style="background:#0284c7;color:#fff;" onclick="nextLevelOrFinish()">SIGUIENTE NIVEL</button>
    </div>
  </div>
</div>
<script>
${SHARED_HELPERS}
${scriptBody}
</script>
</body>
</html>`
}

function getNewMinigames() {
  // 1) CÓNDOR-4: calibracion_giroscopio.html ('gyro')
  const gyroHtml = wrapGame({
    id: 'gyro',
    title: 'Calibración Giroscopio 3D - CÓNDOR-4',
    h1: 'CALIBRACIÓN DE GIROSCOPIO 3D Y CONTROL ADCS · CÓNDOR-4',
    badge: 'DIRECTOR // ADCS GIROSCOPIO (CÓNDOR-4)',
    diffOptions: '<option value="1">Nivel 1 - Perturbación Leve</option><option value="2" selected>Nivel 2 - Par Multieje</option><option value="3">Nivel 3 - Ráfaga Solar Severa</option>',
    leftTitle: 'HORIZONTE ARTIFICIAL Y GIMBAL 3 EJES',
    leftTagId: 'gyroStatus',
    leftTagText: 'DERIVA ACTIVA',
    rightHtml: `
      <div class="tele-card">
        <div class="tele-row"><span class="tele-lbl">PITCH (θ):</span><span class="tele-val" id="valPitch">0.00 rad/s</span></div>
        <div class="tele-row"><span class="tele-lbl">ROLL (φ):</span><span class="tele-val" id="valRoll">0.00 rad/s</span></div>
        <div class="tele-row"><span class="tele-lbl">YAW (ψ):</span><span class="tele-val" id="valYaw">0.00 rad/s</span></div>
        <div class="tele-row"><span class="tele-lbl">VELOCIDAD TOTAL |ω|:</span><span class="tele-val" id="valMag" style="color:var(--crt-amber)">0.00 rad/s</span></div>
        <div class="tele-row"><span class="tele-lbl">ESTABILIDAD (&lt;0.05 rad/s × 2.5s):</span><span class="tele-val" id="valHold">0.0 / 2.5 s</span></div>
        <div class="bar-bg"><div class="bar-fill" id="barHold" style="width:0%"></div></div>
      </div>
      <div class="ctrl-box">
        <div class="tele-row"><span class="tele-lbl">POTENCIA DE PULSO RCS:</span><span class="tele-val" id="valPower">0.06 rad/s</span></div>
        <input type="range" class="slider" id="slPulse" min="1" max="12" value="6" oninput="noteUserAdjust();pulseStep=this.value*0.01;document.getElementById('valPower').textContent=pulseStep.toFixed(2)+' rad/s'">
        <div class="btn-grid">
          <button class="btn-ctrl" onclick="applyTorque('pitch', -1)">▲ PITCH - [W]</button>
          <button class="btn-ctrl" onclick="applyTorque('pitch', 1)">▼ PITCH + [S]</button>
          <button class="btn-ctrl" onclick="applyTorque('roll', -1)">↺ ROLL - [A]</button>
          <button class="btn-ctrl" onclick="applyTorque('roll', 1)">↻ ROLL + [D]</button>
          <button class="btn-ctrl" onclick="applyTorque('yaw', -1)">◄ YAW - [Q]</button>
          <button class="btn-ctrl" onclick="applyTorque('yaw', 1)">► YAW + [E]</button>
        </div>
      </div>
      <div class="note-box">Aplica impulsos opuestos para frenar la rotación del CubeSat. Mantén <b>|ω| &lt; 0.05 rad/s</b> durante <b>2.5 segundos</b> (o usa AUTO-CALIBRAR).</div>
    `,
    modalTitle: 'GIROSCOPIO CALIBRADO',
    modalStatsHtml: '<div>Derivación Final: <b id="debMag">-</b></div><div>Tiempo: <b id="debTime">-</b></div><div>Pulsos RCS: <b id="debPulses">-</b></div><div>Rango: <b id="debGrade">-</b></div>',
    scriptBody: `
      const canvas = document.getElementById('mainCanvas'), ctx = canvas.getContext('2d');
      let difficulty = 2, isPaused = false, isEnded = false, missionTime = 0, holdTime = 0, pulses = 0, pulseStep = 0.06;
      let omega = { pitch: 0.2, roll: -0.18, yaw: 0.14 }, angle = { pitch: 0.4, roll: -0.3, yaw: 0.2 }, gustTimer = 0;

      function setupScenario(lvl) {
        difficulty = parseInt(lvl) || 2;
        window.__mgAdjustCount = 0;
        isPaused = false; isEnded = false; missionTime = 0; holdTime = 0; pulses = 0; gustTimer = 0;
        const amp = difficulty === 1 ? 0.10 : difficulty === 2 ? 0.14 : 0.18;
        omega = {
          pitch: (Math.random() > 0.5 ? 1 : -1) * (amp * (0.7 + Math.random() * 0.4)),
          roll: (Math.random() > 0.5 ? 1 : -1) * (amp * (0.7 + Math.random() * 0.4)),
          yaw: (Math.random() > 0.5 ? 1 : -1) * (amp * (0.6 + Math.random() * 0.4))
        };
        angle = { pitch: omega.pitch * 1.4, roll: omega.roll * 1.4, yaw: omega.yaw * 1.4 };
        updateUI();
      }
      function changeDifficulty(v) { setupScenario(v); }
      function togglePause() { isPaused = !isPaused; document.getElementById('btnPause').textContent = isPaused ? '▶ REANUDAR' : '⏸ PAUSA'; }
      function resetMission() { setupScenario(difficulty); }
      function autoAssistMinigame() {
        if (isPaused || isEnded) return;
        omega = { pitch: 0.01, roll: -0.01, yaw: 0.005 };
        angle = { pitch: 0.02, roll: -0.02, yaw: 0.01 };
        holdTime = Math.max(holdTime, 2.0);
        showHud('✔ ADCS AUTO-CALIBRADO (<0.05 rad/s)', 'ok');
        updateUI();
      }
      function applyTorque(axis, sign) {
        if (isPaused || isEnded) return;
        noteUserAdjust();
        omega[axis] += sign * pulseStep;
        pulses++;
        playTone(320 + Math.abs(omega[axis]) * 400, 0.05, 'triangle');
        updateUI();
      }
      window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'w') applyTorque('pitch', -1);
        else if (k === 's') applyTorque('pitch', 1);
        else if (k === 'a') applyTorque('roll', -1);
        else if (k === 'd') applyTorque('roll', 1);
        else if (k === 'q') applyTorque('yaw', -1);
        else if (k === 'e') applyTorque('yaw', 1);
      });
      function completeMission() {
        isEnded = true;
        playTone(880, 0.16, 'sine');
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = '¡ADCS SINCRONIZADO!';
        document.getElementById('debTitle').style.color = 'var(--crt-green)';
        document.getElementById('debBadge').textContent = 'ESTABLE';
        document.getElementById('debDesc').textContent = 'Los tres ejes del giroscopio quedaron estabilizados debajo de 0.05 rad/s.';
        const mag = Math.hypot(omega.pitch, omega.roll, omega.yaw);
        document.getElementById('debMag').textContent = mag.toFixed(3) + ' rad/s';
        document.getElementById('debTime').textContent = Math.round(missionTime) + ' s';
        document.getElementById('debPulses').textContent = pulses;
        document.getElementById('debGrade').textContent = pulses < 35 ? 'A+ ÓPTIMO' : 'A NOMINAL';
      }
      function failMission(msg) { isEnded = true; showHud(msg, 'err'); }
      function closeModalAndRetry() { document.getElementById('debriefModal').style.display = 'none'; resetMission(); }
      function nextLevelOrFinish() { document.getElementById('debriefModal').style.display = 'none'; setupScenario(Math.min(3, difficulty + 1)); }

      function updateUI() {
        const mag = Math.hypot(omega.pitch, omega.roll, omega.yaw);
        document.getElementById('valPitch').textContent = omega.pitch.toFixed(3) + ' rad/s';
        document.getElementById('valRoll').textContent = omega.roll.toFixed(3) + ' rad/s';
        document.getElementById('valYaw').textContent = omega.yaw.toFixed(3) + ' rad/s';
        const mEl = document.getElementById('valMag');
        mEl.textContent = mag.toFixed(3) + ' rad/s';
        mEl.style.color = mag < 0.05 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('valHold').textContent = holdTime.toFixed(1) + ' / 2.5 s';
        document.getElementById('barHold').style.width = Math.min(100, (holdTime / 2.5) * 100) + '%';
        document.getElementById('gyroStatus').textContent = mag < 0.05 ? 'LOCK EN PROGRESO (' + holdTime.toFixed(1) + 's)' : 'CORRECCIÓN REQUERIDA';
        document.getElementById('gyroStatus').style.color = mag < 0.05 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('clockDisplay').textContent = fmtClock(missionTime);
        if (mag < 0.05) {
          setGuideText('✔ |ω| estable (' + holdTime.toFixed(1) + '/2.5s) — Ya puedes CONFIRMAR arriba');
        } else {
          const axes = [
            { k: 'pitch', neg: '▲ PITCH - [W]', pos: '▼ PITCH + [S]', v: omega.pitch },
            { k: 'roll', neg: '↺ ROLL - [A]', pos: '↻ ROLL + [D]', v: omega.roll },
            { k: 'yaw', neg: '◄ YAW - [Q]', pos: '► YAW + [E]', v: omega.yaw }
          ].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
          setGuideText('👉 Pulsa ' + (axes.v > 0 ? axes.neg : axes.pos) + ' (o AUTO-CALIBRAR)');
        }
      }

      let last = performance.now();
      function loop(now) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        resizeCanvasEl(canvas);
        if (!isPaused && !isEnded) {
          missionTime += dt;
          if (difficulty >= 2) {
            omega.pitch += Math.sin(missionTime * 1.1) * 0.002 * difficulty * dt;
            omega.roll += Math.cos(missionTime * 0.9) * 0.002 * difficulty * dt;
          }
          angle.pitch += omega.pitch * dt * 2.2;
          angle.roll += omega.roll * dt * 2.2;
          angle.yaw += omega.yaw * dt * 2.2;
          const mag = Math.hypot(omega.pitch, omega.roll, omega.yaw);
          if (mag < 0.05) {
            holdTime += dt;
            angle.pitch *= (1 - 1.5 * dt); angle.roll *= (1 - 1.5 * dt);
            if (holdTime >= 2.5) completeMission();
          } else {
            holdTime = Math.max(0, holdTime - dt * 0.6);
          }
          updateUI();
        }
        const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.34;
        ctx.fillStyle = '#03060e'; ctx.fillRect(0, 0, w, h);
        // Grid
        ctx.strokeStyle = '#0e1d36'; ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 36) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (let y = 0; y < h; y += 36) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        // Horizonte artificial
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
        ctx.translate(cx, cy);
        ctx.rotate(angle.roll);
        const pitchShift = Math.max(-R, Math.min(R, Math.sin(angle.pitch) * R * 0.85));
        ctx.fillStyle = '#06203a'; ctx.fillRect(-R * 1.5, -R * 1.5, R * 3, R * 1.5 + pitchShift);
        ctx.fillStyle = '#141923'; ctx.fillRect(-R * 1.5, pitchShift, R * 3, R * 1.5);
        ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-R * 1.4, pitchShift); ctx.lineTo(R * 1.4, pitchShift); ctx.stroke();
        ctx.restore();
        // Anillos Gimbal 3D
        const drawRing = (rx, ry, rot, col) => {
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        };
        const mag = Math.hypot(omega.pitch, omega.roll, omega.yaw);
        drawRing(R * 1.12, R * 1.12, 0, mag < 0.05 ? '#00ff88' : '#38bdf8');
        drawRing(R * 1.03, Math.max(14, Math.abs(Math.cos(angle.pitch)) * R * 1.03), angle.yaw, '#ffb703');
        drawRing(Math.max(14, Math.abs(Math.cos(angle.roll)) * R * 0.92), R * 0.92, angle.pitch * 0.5, '#00ff88');
        // Mira fija central
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 8, cy); ctx.moveTo(cx + 8, cy); ctx.lineTo(cx + 26, cy);
        ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy - 6); ctx.stroke();
        ctx.fillStyle = mag < 0.05 ? '#00ff88' : '#ffb703';
        ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'center';
        ctx.fillText(mag < 0.05 ? 'BLOQUEO INERCIAL: ' + holdTime.toFixed(1) + 's / 2.5s' : 'ESTABILIZAR < 0.05 rad/s (o AUTO-CALIBRAR)', cx, cy + R * 1.28);
        requestAnimationFrame(loop);
      }
      window.addEventListener('load', () => { setupScenario(2); requestAnimationFrame(loop); });
    `
  })

  // 2) CÓNDOR-4: eyeccion_escombros.html ('debris')
  const debrisHtml = wrapGame({
    id: 'debris',
    title: 'Eyección de Escombros Kessler - CÓNDOR-4',
    h1: 'RADAR ORBITAL KESSLER Y EYECCIÓN DE ESCOMBROS · CÓNDOR-4',
    badge: 'DIRECTOR // EVASIÓN KESSLER (CÓNDOR-4)',
    diffOptions: '<option value="1">Nivel 1 - Tránsito Moderado</option><option value="2" selected>Nivel 2 - Nube de Fragmentos</option><option value="3">Nivel 3 - Síndrome Kessler</option>',
    leftTitle: 'RADAR POLAR DE ESCOMBROS ORBITALES',
    leftTagId: 'debrisStatus',
    leftTagText: 'ESQUIVE ACTIVO',
    rightHtml: `
      <div class="tele-card">
        <div class="tele-row"><span class="tele-lbl">INTEGRIDAD CASCO:</span><span class="tele-val" id="valHull">100%</span></div>
        <div class="bar-bg"><div class="bar-fill" id="barHull" style="width:100%"></div></div>
        <div class="tele-row"><span class="tele-lbl">SUPERVIVENCIA:</span><span class="tele-val" id="valSurv" style="color:var(--crt-green)">0.0 / 9.0 s</span></div>
        <div class="bar-bg"><div class="bar-fill" id="barSurv" style="width:0%;background:var(--crt-cyan)"></div></div>
        <div class="tele-row"><span class="tele-lbl">ESCOMBROS EVADIDOS:</span><span class="tele-val" id="valDodged">0</span></div>
      </div>
      <div class="ctrl-box">
        <div class="tele-row"><span class="tele-lbl">PROPULSORES EVASIVOS X/Y:</span><span class="tele-val">WASD / FLECHAS</span></div>
        <div class="btn-grid-3">
          <div></div><button class="btn-ctrl" onmousedown="noteUserAdjust();thrust.y=-1" onmouseup="thrust.y=0" ontouchstart="noteUserAdjust();thrust.y=-1" ontouchend="thrust.y=0">▲ NORTE</button><div></div>
          <button class="btn-ctrl" onmousedown="noteUserAdjust();thrust.x=-1" onmouseup="thrust.x=0" ontouchstart="noteUserAdjust();thrust.x=-1" ontouchend="thrust.x=0">◄ OESTE</button>
          <button class="btn-ctrl" onmousedown="noteUserAdjust();thrust.y=1" onmouseup="thrust.y=0" ontouchstart="noteUserAdjust();thrust.y=1" ontouchend="thrust.y=0">▼ SUR</button>
          <button class="btn-ctrl" onmousedown="noteUserAdjust();thrust.x=1" onmouseup="thrust.x=0" ontouchstart="noteUserAdjust();thrust.x=1" ontouchend="thrust.x=0">► ESTE</button>
        </div>
        <button class="btn-primary" id="btnEmp" onclick="fireEmp()">🛡 DEFLECTOR EMP DE CHOQUE [ESPACIO]</button>
      </div>
      <div class="note-box">Esquiva con <b>WASD / Flechas</b> o pulsa <b>EMP</b> durante 8–10 segundos.</div>
    `,
    modalTitle: 'CORREDOR ORBITAL DESPEJADO',
    modalStatsHtml: '<div>Casco Restante: <b id="debHull">-</b></div><div>Fragmentos Evadidos: <b id="debCount">-</b></div><div>Pulsos EMP: <b id="debEmp">-</b></div><div>Rango: <b id="debGrade">-</b></div>',
    scriptBody: `
      const canvas = document.getElementById('mainCanvas'), ctx = canvas.getContext('2d');
      let difficulty = 2, isPaused = false, isEnded = false, missionTime = 0, targetTime = 9, hull = 100;
      let empCd = 0, empWave = 0, empUses = 0, dodged = 0, spawnTimer = 0;
      let ship = { x: 0.5, y: 0.5, vx: 0, vy: 0 }, thrust = { x: 0, y: 0 }, keys = {};
      let debris = [], sparks = [];

      function setupScenario(lvl) {
        difficulty = parseInt(lvl) || 2;
        window.__mgAdjustCount = 0;
        isPaused = false; isEnded = false; missionTime = 0; hull = 100; empCd = 0; empWave = 0; empUses = 0; dodged = 0; spawnTimer = 0;
        targetTime = difficulty === 1 ? 8 : difficulty === 2 ? 9 : 10;
        ship = { x: 0.5, y: 0.5, vx: 0, vy: 0 }; debris = []; sparks = [];
        updateUI();
      }
      function changeDifficulty(v) { setupScenario(v); }
      function togglePause() { isPaused = !isPaused; document.getElementById('btnPause').textContent = isPaused ? '▶ REANUDAR' : '⏸ PAUSA'; }
      function resetMission() { setupScenario(difficulty); }
      function autoAssistMinigame() {
        if (isPaused || isEnded) return;
        dodged += debris.length;
        debris = [];
        empWave = 1.0;
        empCd = 0;
        missionTime = Math.max(missionTime, targetTime - 1.5);
        showHud('✔ RADAR DESPEJADO POR ASISTENCIA IA', 'ok');
        updateUI();
      }
      function fireEmp() {
        if (isPaused || isEnded || empCd > 0) return;
        noteUserAdjust();
        empCd = 2.5; empWave = 1.0; empUses++;
        playTone(620, 0.22, 'sawtooth');
        const cx = ship.x * canvas.width, cy = ship.y * canvas.height;
        for (let i = debris.length - 1; i >= 0; i--) {
          const d = debris[i];
          if (Math.hypot(d.x - cx, d.y - cy) < 220) {
            for (let k = 0; k < 8; k++) sparks.push({ x: d.x, y: d.y, vx: (Math.random()-0.5)*160, vy: (Math.random()-0.5)*160, l: 0.5, c: '#00e5ff' });
            debris.splice(i, 1); dodged++;
          }
        }
        showHud('🛡 DEFLECTOR EMP ACTIVADO', 'ok');
      }
      window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) noteUserAdjust();
        keys[k] = true;
        if (e.code === 'Space') { e.preventDefault(); fireEmp(); }
      });
      window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

      function completeMission() {
        isEnded = true; playTone(920, 0.2, 'sine');
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = '¡TRÁNSITO DE ESCOMBROS COMPLETADO!';
        document.getElementById('debTitle').style.color = 'var(--crt-green)';
        document.getElementById('debBadge').textContent = 'ÓRBITA SEGURA';
        document.getElementById('debDesc').textContent = 'La estación atravesó el cinturón de fragmentos Kessler protegiendo la integridad estructural.';
        document.getElementById('debHull').textContent = Math.round(hull) + '%';
        document.getElementById('debCount').textContent = dodged;
        document.getElementById('debEmp').textContent = empUses;
        document.getElementById('debGrade').textContent = hull >= 80 ? 'A+ EXCELENTE' : 'A ESTABLE';
      }
      function failMission() {
        isEnded = true; playTone(140, 0.35, 'sawtooth');
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = 'IMPACTO CRÍTICO DE ESCOMBROS';
        document.getElementById('debTitle').style.color = 'var(--crt-red)';
        document.getElementById('debBadge').textContent = 'BRECHA';
        document.getElementById('debDesc').textContent = 'Múltiples impactos fragmentaron el blindaje orbital. Usa los propulsores y el deflector EMP.';
        document.getElementById('debHull').textContent = '0%';
        document.getElementById('debCount').textContent = dodged;
        document.getElementById('debEmp').textContent = empUses;
        document.getElementById('debGrade').textContent = 'F REPROBADO';
      }
      function closeModalAndRetry() { document.getElementById('debriefModal').style.display = 'none'; resetMission(); }
      function nextLevelOrFinish() { document.getElementById('debriefModal').style.display = 'none'; setupScenario(Math.min(3, difficulty + 1)); }

      function updateUI() {
        document.getElementById('valHull').textContent = Math.round(hull) + '%';
        document.getElementById('valHull').style.color = hull > 45 ? 'var(--crt-green)' : 'var(--crt-red)';
        document.getElementById('barHull').style.width = hull + '%';
        document.getElementById('barHull').style.background = hull > 45 ? 'var(--crt-green)' : 'var(--crt-red)';
        document.getElementById('valSurv').textContent = missionTime.toFixed(1) + ' / ' + targetTime.toFixed(1) + ' s';
        document.getElementById('barSurv').style.width = Math.min(100, (missionTime / targetTime) * 100) + '%';
        document.getElementById('valDodged').textContent = dodged;
        const b = document.getElementById('btnEmp');
        b.disabled = empCd > 0;
        b.textContent = empCd > 0 ? '⏳ RECARGA EMP (' + Math.ceil(empCd) + 's)' : '🛡 DEFLECTOR EMP DE CHOQUE [ESPACIO]';
        document.getElementById('clockDisplay').textContent = fmtClock(missionTime);
        const rem = Math.max(0, targetTime - missionTime);
        setGuideText(rem <= 0.1 || missionTime >= 4.0
          ? '✔ Corredor seguro — Listo para CONFIRMAR arriba'
          : '👉 Esquiva o pulsa [ESPACIO] EMP (' + rem.toFixed(1) + 's restantes)');
      }

      let last = performance.now();
      function loop(now) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        resizeCanvasEl(canvas);
        const w = canvas.width, h = canvas.height;
        if (!isPaused && !isEnded) {
          missionTime += dt;
          if (empCd > 0) empCd = Math.max(0, empCd - dt);
          if (empWave > 0) empWave = Math.max(0, empWave - dt * 2.4);
          let ax = thrust.x + (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
          let ay = thrust.y + (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0);
          ship.vx = (ship.vx + ax * 1.65 * dt) * 0.92;
          ship.vy = (ship.vy + ay * 1.65 * dt) * 0.92;
          ship.x = Math.max(0.08, Math.min(0.92, ship.x + ship.vx));
          ship.y = Math.max(0.08, Math.min(0.92, ship.y + ship.vy));

          spawnTimer += dt;
          const rate = difficulty === 1 ? 0.85 : difficulty === 2 ? 0.72 : 0.58;
          if (spawnTimer >= rate) {
            spawnTimer = 0;
            const side = Math.floor(Math.random() * 4);
            let sx = 0, sy = 0;
            if (side === 0) { sx = Math.random() * w; sy = -18; }
            else if (side === 1) { sx = w + 18; sy = Math.random() * h; }
            else if (side === 2) { sx = Math.random() * w; sy = h + 18; }
            else { sx = -18; sy = Math.random() * h; }
            const tx = ship.x * w + (Math.random() - 0.5) * 160;
            const ty = ship.y * h + (Math.random() - 0.5) * 160;
            const ang = Math.atan2(ty - sy, tx - sx);
            const spd = (65 + difficulty * 18) + Math.random() * 35;
            debris.push({ x: sx, y: sy, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r: 7 + Math.random() * 6 });
          }

          const px = ship.x * w, py = ship.y * h;
          for (let i = debris.length - 1; i >= 0; i--) {
            const d = debris[i]; d.x += d.vx * dt; d.y += d.vy * dt;
            if (Math.hypot(d.x - px, d.y - py) < d.r + 12) {
              debris.splice(i, 1); hull = Math.max(0, hull - 10);
              playTone(190, 0.16, 'square');
              showHud('⚠ ROZADURA EN CASCO (-10%)', 'warn');
              for (let k = 0; k < 10; k++) sparks.push({ x: px, y: py, vx: (Math.random()-0.5)*190, vy: (Math.random()-0.5)*190, l: 0.45, c: '#ff3b5c' });
              if (hull <= 0) { failMission(); break; }
            } else if (d.x < -40 || d.x > w + 40 || d.y < -40 || d.y > h + 40) {
              debris.splice(i, 1); dodged++;
            }
          }
          for (let i = sparks.length - 1; i >= 0; i--) {
            const sp = sparks[i]; sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.l -= dt;
            if (sp.l <= 0) sparks.splice(i, 1);
          }
          if (!isEnded && missionTime >= targetTime) completeMission();
          updateUI();
        }
        ctx.fillStyle = '#03060e'; ctx.fillRect(0, 0, w, h);
        const rcx = w / 2, rcy = h / 2;
        ctx.strokeStyle = 'rgba(0,229,255,0.12)'; ctx.lineWidth = 1;
        [0.2, 0.35, 0.5].forEach((f) => { ctx.beginPath(); ctx.arc(rcx, rcy, Math.min(w,h)*f, 0, Math.PI*2); ctx.stroke(); });
        const sx = ship.x * w, sy = ship.y * h;
        if (empWave > 0) {
          ctx.strokeStyle = 'rgba(0,229,255,' + empWave + ')'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(sx, sy, (1 - empWave) * 165, 0, Math.PI * 2); ctx.stroke();
        }
        debris.forEach((d) => {
          ctx.fillStyle = '#ff3b5c'; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fda4af'; ctx.lineWidth = 1.5; ctx.stroke();
        });
        sparks.forEach((sp) => { ctx.fillStyle = sp.c; ctx.fillRect(sp.x - 2, sp.y - 2, 4, 4); });
        // Estación
        ctx.fillStyle = '#00ff88'; ctx.fillRect(sx - 10, sy - 6, 20, 12);
        ctx.fillStyle = '#38bdf8'; ctx.fillRect(sx - 20, sy - 3, 8, 6); ctx.fillRect(sx + 12, sy - 3, 8, 6);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.strokeRect(sx - 10, sy - 6, 20, 12);
        requestAnimationFrame(loop);
      }
      window.addEventListener('load', () => { setupScenario(2); requestAnimationFrame(loop); });
    `
  })

  // 3) ALPACA-1: refrigeracion_reactor.html ('reactor')
  const reactorHtml = wrapGame({
    id: 'reactor',
    title: 'Control Térmico del Reactor - ALPACA-1',
    h1: 'REFRIGERACIÓN CRIOGÉNICA DEL REACTOR DE FISIÓN · ALPACA-1',
    badge: 'INGENIERÍA // REFRIGERACIÓN REACTOR (ALPACA-1)',
    diffOptions: '<option value="1">Nivel 1 - Carga Térmica Media</option><option value="2" selected>Nivel 2 - Sobrecalentamiento Crítico</option><option value="3">Nivel 3 - Picos Térmicos Solares</option>',
    leftTitle: 'CIRCUITO PRIMARIO DE AMONÍACO LÍQUIDO (NH3)',
    leftTagId: 'rxStatus',
    leftTagText: 'NÚCLEOS SOBRECALENTADOS',
    rightHtml: `
      <div class="tele-card">
        <div class="tele-row"><span class="tele-lbl">TEMP. PROMEDIO (META &lt;480°C):</span><span class="tele-val" id="valAvgT">610°C</span></div>
        <div class="tele-row"><span class="tele-lbl">PRESIÓN DE CIRCUITO (&lt;100 PSI):</span><span class="tele-val" id="valPress">50 PSI</span></div>
        <div class="bar-bg"><div class="bar-fill" id="barPress" style="width:55%"></div></div>
      </div>
      <div class="ctrl-box">
        <div class="tele-row"><span class="tele-lbl">BOMBA NÚCLEO A (<span id="ta">810°C</span>):</span><span class="tele-val" id="pa">40%</span></div>
        <input type="range" class="slider" id="sl0" min="0" max="100" value="40" oninput="setPump(0,this.value)">
        <div class="tele-row"><span class="tele-lbl">BOMBA NÚCLEO B (<span id="tb">830°C</span>):</span><span class="tele-val" id="pb">40%</span></div>
        <input type="range" class="slider" id="sl1" min="0" max="100" value="40" oninput="setPump(1,this.value)">
        <div class="tele-row"><span class="tele-lbl">BOMBA NÚCLEO C (<span id="tc">820°C</span>):</span><span class="tele-val" id="pc">40%</span></div>
        <input type="range" class="slider" id="sl2" min="0" max="100" value="40" oninput="setPump(2,this.value)">
        <div class="tele-row"><span class="tele-lbl">BOMBA NÚCLEO D (<span id="td">840°C</span>):</span><span class="tele-val" id="pd">40%</span></div>
        <input type="range" class="slider" id="sl3" min="0" max="100" value="40" oninput="setPump(3,this.value)">
      </div>
      <div class="btn-grid">
        <button class="btn-ctrl" id="btnRad" onclick="toggleRadiators()">❄ RADIADORES: OFF</button>
        <button class="btn-ctrl warn" id="btnPurge" onclick="purgeSteam()">💨 PURGAR VAPOR</button>
      </div>
      <div class="note-box">Despliega los <b>Radiadores</b> y sube las bombas A-D para enfriar los 4 núcleos por debajo de <b>480°C</b> (o pulsa AUTO-CALIBRAR).</div>
    `,
    modalTitle: 'REACTOR ENFRIAMIENTO NOMINAL',
    modalStatsHtml: '<div>Temp. Final: <b id="debTemp">-</b></div><div>Presión Máx: <b id="debPress">-</b></div><div>Tiempo: <b id="debTime">-</b></div><div>Rango: <b id="debGrade">-</b></div>',
    scriptBody: `
      const canvas = document.getElementById('mainCanvas'), ctx = canvas.getContext('2d');
      let difficulty = 2, isPaused = false, isEnded = false, missionTime = 0, pressure = 50, maxPress = 50;
      let cores = [600, 625, 610, 635], pumps = [55, 55, 55, 55], radOpen = false, purgeCd = 0, flowPhase = 0;

      function setupScenario(lvl) {
        difficulty = parseInt(lvl) || 2;
        window.__mgAdjustCount = 0;
        isPaused = false; isEnded = false; missionTime = 0; pressure = 46; maxPress = 46; radOpen = false; purgeCd = 0;
        const base = difficulty === 1 ? 560 : difficulty === 2 ? 610 : 650;
        cores = [base - 10, base + 15, base, base + 20];
        pumps = [55, 55, 55, 55];
        [0, 1, 2, 3].forEach((i) => { document.getElementById('sl' + i).value = pumps[i]; });
        updateRadBtn(); updateUI();
      }
      function changeDifficulty(v) { setupScenario(v); }
      function togglePause() { isPaused = !isPaused; document.getElementById('btnPause').textContent = isPaused ? '▶ REANUDAR' : '⏸ PAUSA'; }
      function resetMission() { setupScenario(difficulty); }
      function autoAssistMinigame() {
        if (isPaused || isEnded) return;
        radOpen = true;
        updateRadBtn();
        pumps = [85, 85, 85, 85];
        [0, 1, 2, 3].forEach((i) => { document.getElementById('sl' + i).value = 85; });
        pressure = 42;
        cores = cores.map((c) => Math.min(c, 455));
        showHud('✔ RADIADORES ON Y BOMBAS AL 85% (<480°C)', 'ok');
        updateUI();
      }
      function setPump(i, v) { noteUserAdjust(); pumps[i] = parseInt(v); playTone(260 + pumps[i] * 2, 0.03); updateUI(); }
      function toggleRadiators() {
        if (isPaused || isEnded) return;
        noteUserAdjust();
        radOpen = !radOpen; playTone(radOpen ? 680 : 420, 0.09); updateRadBtn(); updateUI();
      }
      function updateRadBtn() {
        const b = document.getElementById('btnRad');
        b.textContent = radOpen ? '❄ RADIADORES: ON' : '❄ RADIADORES: OFF';
        b.classList.toggle('active', radOpen);
      }
      function purgeSteam() {
        if (isPaused || isEnded || purgeCd > 0) return;
        noteUserAdjust();
        pressure = Math.max(25, pressure - 26); purgeCd = 3.0;
        playTone(900, 0.14, 'sawtooth');
        showHud('💨 VAPOR PURGADO (-26 PSI)', 'ok');
        updateUI();
      }
      function completeMission() {
        isEnded = true; playTone(900, 0.18);
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = '¡REACTOR ESTABILIZADO < 480°C!';
        document.getElementById('debTitle').style.color = 'var(--crt-green)';
        document.getElementById('debBadge').textContent = 'TÉRMICO OK';
        document.getElementById('debDesc').textContent = 'Todos los canales del reactor bajaron de 400°C con presión nominal en circuito NH3.';
        const avg = cores.reduce((a, b) => a + b, 0) / 4;
        document.getElementById('debTemp').textContent = Math.round(avg) + ' °C';
        document.getElementById('debPress').textContent = Math.round(maxPress) + ' PSI';
        document.getElementById('debTime').textContent = Math.round(missionTime) + ' s';
        document.getElementById('debGrade').textContent = maxPress < 92 ? 'A+ SEGURO' : 'A NOMINAL';
      }
      function failMission(reason) {
        isEnded = true; playTone(150, 0.35, 'sawtooth');
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = 'COLAPSO DEL CIRCUITO TÉRMICO';
        document.getElementById('debTitle').style.color = 'var(--crt-red)';
        document.getElementById('debBadge').textContent = 'SOBREPRESIÓN';
        document.getElementById('debDesc').textContent = reason;
        const avg = cores.reduce((a, b) => a + b, 0) / 4;
        document.getElementById('debTemp').textContent = Math.round(avg) + ' °C';
        document.getElementById('debPress').textContent = Math.round(pressure) + ' PSI';
        document.getElementById('debTime').textContent = Math.round(missionTime) + ' s';
        document.getElementById('debGrade').textContent = 'F FALLIDO';
      }
      function closeModalAndRetry() { document.getElementById('debriefModal').style.display = 'none'; resetMission(); }
      function nextLevelOrFinish() { document.getElementById('debriefModal').style.display = 'none'; setupScenario(Math.min(3, difficulty + 1)); }

      function updateUI() {
        const lbls = ['ta', 'tb', 'tc', 'td'], plbls = ['pa', 'pb', 'pc', 'pd'];
        cores.forEach((t, i) => {
          document.getElementById(lbls[i]).textContent = Math.round(t) + '°C';
          document.getElementById(plbls[i]).textContent = pumps[i] + '%';
        });
        const avg = cores.reduce((a, b) => a + b, 0) / 4;
        document.getElementById('valAvgT').textContent = Math.round(avg) + '°C';
        document.getElementById('valAvgT').style.color = avg < 480 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('valPress').textContent = Math.round(pressure) + ' PSI';
        document.getElementById('valPress').style.color = pressure > 88 ? 'var(--crt-red)' : 'var(--crt-cyan)';
        document.getElementById('barPress').style.width = Math.min(100, pressure) + '%';
        document.getElementById('barPress').style.background = pressure > 88 ? 'var(--crt-red)' : 'var(--crt-cyan)';
        const pb = document.getElementById('btnPurge');
        pb.disabled = purgeCd > 0;
        pb.textContent = purgeCd > 0 ? '⏳ PURGA (' + Math.ceil(purgeCd) + 's)' : '💨 PURGAR VAPOR';
        document.getElementById('clockDisplay').textContent = fmtClock(missionTime);
        if (avg < 480) setGuideText('✔ Núcleos refrigerados (<480°C) — Listo para CONFIRMAR arriba');
        else if (!radOpen) setGuideText('👉 Paso 1: Enciende [❄ RADIADORES: ON] o pulsa AUTO-CALIBRAR');
        else setGuideText('👉 Paso 2: Sube bombas A-D > 75% (Meta <480°C)');
      }

      let last = performance.now();
      function loop(now) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        resizeCanvasEl(canvas);
        if (!isPaused && !isEnded) {
          missionTime += dt; flowPhase += dt * (radOpen ? 3.2 : 1.6);
          if (purgeCd > 0) purgeCd = Math.max(0, purgeCd - dt);
          const avgPump = pumps.reduce((a, b) => a + b, 0) / 4;
          const pressRate = (avgPump - (radOpen ? 75 : 52)) * 0.08 + difficulty * 0.25;
          pressure = Math.max(20, pressure + pressRate * dt);
          maxPress = Math.max(maxPress, pressure);
          const heatGen = 8 + difficulty * 2.5;
          for (let i = 0; i < 4; i++) {
            const cool = (pumps[i] / 100) * (radOpen ? 85 : 52);
            cores[i] = Math.max(290, cores[i] + (heatGen - cool) * dt);
            if (cores[i] >= 980) { failMission('Fusión térmica en Núcleo ' + String.fromCharCode(65 + i) + ' (>980°C).'); break; }
          }
          if (!isEnded && pressure >= 105) failMission('Ruptura por sobrepresión del circuito NH3 (>=105 PSI).');
          if (!isEnded && cores.every((c) => c < 480)) completeMission();
          updateUI();
        }
        const w = canvas.width, h = canvas.height;
        ctx.fillStyle = '#03060e'; ctx.fillRect(0, 0, w, h);
        // Alerones radiadores exteriores
        ctx.fillStyle = radOpen ? '#0369a1' : '#1e293b';
        ctx.fillRect(18, 18, radOpen ? w - 36 : 70, 14);
        ctx.strokeStyle = radOpen ? '#38bdf8' : '#475569'; ctx.strokeRect(18, 18, radOpen ? w - 36 : 70, 14);
        // 4 Barras de núcleos
        const bw = Math.min(82, (w - 110) / 4), gap = (w - bw * 4) / 5, baseY = h - 42, maxH = h - 105;
        cores.forEach((t, i) => {
          const x = gap + i * (bw + gap), frac = Math.min(1, Math.max(0.08, (t - 250) / 700));
          const bh = frac * maxH;
          ctx.fillStyle = '#091122'; ctx.fillRect(x, baseY - maxH, bw, maxH);
          ctx.strokeStyle = '#25395c'; ctx.strokeRect(x, baseY - maxH, bw, maxH);
          ctx.fillStyle = t < 480 ? '#00ff88' : t < 700 ? '#ffb703' : '#ff3b5c';
          ctx.fillRect(x + 4, baseY - bh, bw - 8, bh);
          // Meta 480°C line
          const goalY = baseY - ((480 - 250) / 700) * maxH;
          ctx.strokeStyle = '#00ff88'; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(x - 4, goalY); ctx.lineTo(x + bw + 4, goalY); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'center';
          ctx.fillText('NÚCLEO ' + String.fromCharCode(65 + i), x + bw / 2, baseY + 18);
          ctx.fillText(Math.round(t) + '°C', x + bw / 2, baseY - bh - 6);
          // Burbuja flujo amoníaco
          const py = baseY - ((flowPhase * 40 + i * 25) % maxH);
          ctx.fillStyle = '#00e5ff'; ctx.fillRect(x + bw / 2 - 2, py, 4, 4);
        });
        requestAnimationFrame(loop);
      }
      window.addEventListener('load', () => { setupScenario(2); requestAnimationFrame(loop); });
    `
  })

  // 4) ALPACA-1: reparacion_circuitos.html ('pcb')
  const pcbHtml = wrapGame({
    id: 'pcb',
    title: 'Reparación de Circuitos PCB - ALPACA-1',
    h1: 'ENRUTAMIENTO DE BUSES PCB Y BYPASS DE CAPACITORES · ALPACA-1',
    badge: 'INGENIERÍA // PLACA PCB (ALPACA-1)',
    diffOptions: '<option value="1">Nivel 1 - 1 Capacitor Quemado</option><option value="2" selected>Nivel 2 - Bus Complejo</option><option value="3">Nivel 3 - Placa Crítica</option>',
    leftTitle: 'MATRIZ PCB 5x5 (CLIC PARA ROTAR PISTA 90°)',
    leftTagId: 'pcbStatus',
    leftTagText: '0 / 3 SALIDAS CONECTADAS',
    rightHtml: `
      <div class="tele-card">
        <div class="tele-row"><span class="tele-lbl">RESERVA BATERÍA EMERG.:</span><span class="tele-val" id="valBat">100%</span></div>
        <div class="bar-bg"><div class="bar-fill" id="barBat" style="width:100%"></div></div>
        <div class="tele-row"><span class="tele-lbl">BUSES ENERGIZADOS:</span><span class="tele-val" id="valOut">0 / 3</span></div>
        <div class="tele-row"><span class="tele-lbl">ROTACIONES / BYPASS:</span><span class="tele-val" id="valMoves">0</span></div>
      </div>
      <div class="ctrl-box">
        <div class="tele-row"><span class="tele-lbl">HERRAMIENTA DE CLIC:</span><span class="tele-val" id="toolModeTxt">ROTAR PISTA ↻</span></div>
        <div class="btn-grid">
          <button class="btn-ctrl active" id="btnToolRot" onclick="setTool('rot')">↻ ROTAR [1]</button>
          <button class="btn-ctrl warn" id="btnToolByp" onclick="setTool('bypass')">⚡ SOLDAR BYPASS [2]</button>
        </div>
      </div>
      <div class="note-box">Haz clic en los nodos de cobre para rotar las pistas y conectar las <b>3 entradas (IN)</b> con las <b>3 salidas (OUT)</b>. Si encuentras un capacitor quemado en rojo (<b>CAP</b>), usa <b>Soldar Bypass</b>.</div>
    `,
    modalTitle: 'PLACA PCB ENERGIZADA AL 100%',
    modalStatsHtml: '<div>Buses Activos: <b id="debOut">3 / 3</b></div><div>Reserva Final: <b id="debBat">-</b></div><div>Operaciones: <b id="debMoves">-</b></div><div>Calificación: <b id="debGrade">-</b></div>',
    scriptBody: `
      const canvas = document.getElementById('mainCanvas'), ctx = canvas.getContext('2d');
      // Bits: 1=N, 2=E, 4=S, 8=W
      const SHAPES = { I: [5, 10], L: [3, 6, 12, 9], T: [7, 14, 13, 11], X: [15] };
      let difficulty = 2, isPaused = false, isEnded = false, missionTime = 0, battery = 100, moves = 0, tool = 'rot';
      let grid = [], lit = [], inRows = [0, 2, 4], outRows = [0, 2, 4], outLit = [false, false, false];

      function rotMask(mask, r) {
        let m = mask;
        for (let k = 0; k < r; k++) {
          m = ((m & 1) << 1) | ((m & 2) << 1) | ((m & 4) << 1) | ((m & 8) >> 3);
        }
        return m;
      }

      function setupScenario(lvl) {
        difficulty = parseInt(lvl) || 2;
        window.__mgAdjustCount = 0;
        isPaused = false; isEnded = false; missionTime = 0; battery = 100; moves = 0;
        const rows = 5, cols = 5;
        grid = [];
        for (let r = 0; r < rows; r++) {
          const row = [];
          for (let c = 0; c < cols; c++) {
            const onBus = inRows.includes(r);
            let type = onBus ? 'I' : 'L';
            if ((c === 1 || c === 3) && (r === 1 || r === 3)) type = 'T';
            if (onBus && c === 2 && r === 2) type = 'X';
            row.push({ type, rot: onBus ? 1 : Math.floor(Math.random() * 4), blown: false, fixed: false });
          }
          grid.push(row);
        }
        // Pre-alineado dejando 2 o 3 pistas sencillas por rotar + 1 capacitor
        const rotSpots = difficulty === 1 ? [[0, 2]] : difficulty === 2 ? [[0, 1], [4, 3]] : [[0, 1], [2, 3], [4, 1]];
        rotSpots.forEach(([r, c]) => { grid[r][c].rot = 0; });
        const blownSpots = difficulty === 3 ? [[2, 2], [4, 2]] : [[2, 2]];
        blownSpots.forEach(([r, c]) => { grid[r][c].type = 'I'; grid[r][c].rot = 1; grid[r][c].blown = true; grid[r][c].fixed = false; });
        setTool('rot');
        computePower(); updateUI();
      }
      function setTool(t) {
        tool = t;
        document.getElementById('btnToolRot').classList.toggle('active', t === 'rot');
        document.getElementById('btnToolByp').classList.toggle('active', t === 'bypass');
        document.getElementById('toolModeTxt').textContent = t === 'rot' ? 'ROTAR PISTA ↻' : 'SOLDAR BYPASS ⚡';
      }
      function autoAssistMinigame() {
        if (isPaused || isEnded) return;
        inRows.forEach((r) => {
          for (let c = 0; c < 5; c++) {
            const cell = grid[r][c];
            if (cell.blown) cell.fixed = true;
            cell.rot = 1;
          }
        });
        computePower(); updateUI();
        showHud('✔ CIRCUITOS PCB RUTADOS AUTOMÁTICAMENTE', 'ok');
      }
      function cellMask(r, c) {
        const g = grid[r][c];
        if (g.blown && !g.fixed) return 0;
        return rotMask(SHAPES[g.type][0], g.rot);
      }
      function computePower() {
        lit = Array.from({ length: 5 }, () => Array(5).fill(false));
        const q = [];
        inRows.forEach((r) => {
          if ((cellMask(r, 0) & 8) !== 0) { lit[r][0] = true; q.push([r, 0]); }
        });
        const dirs = [[-1,0,1,4],[0,1,2,8],[1,0,4,1],[0,-1,8,2]];
        while (q.length) {
          const [r, c] = q.shift();
          const m = cellMask(r, c);
          dirs.forEach(([dr, dc, bit, opp]) => {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < 5 && nc >= 0 && nc < 5 && !lit[nr][nc]) {
              if ((m & bit) && (cellMask(nr, nc) & opp)) { lit[nr][nc] = true; q.push([nr, nc]); }
            }
          });
        }
        outLit = outRows.map((r) => lit[r][4] && (cellMask(r, 4) & 2) !== 0);
        if (!isEnded && outLit.every(Boolean)) completeMission();
      }
      function changeDifficulty(v) { setupScenario(v); }
      function togglePause() { isPaused = !isPaused; document.getElementById('btnPause').textContent = isPaused ? '▶ REANUDAR' : '⏸ PAUSA'; }
      function resetMission() { setupScenario(difficulty); }

      canvas.addEventListener('click', (e) => {
        if (isPaused || isEnded) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const { x0, y0, sz } = boardMetrics();
        const c = Math.floor((mx - x0) / sz), r = Math.floor((my - y0) / sz);
        if (r < 0 || r >= 5 || c < 0 || c >= 5) return;
        const cell = grid[r][c];
        noteUserAdjust();
        if (cell.blown && !cell.fixed) {
          cell.fixed = true; cell.rot = 1; moves++; playTone(760, 0.1);
          showHud('✔ BYPASS SOLDADO', 'ok');
        } else {
          cell.rot = (cell.rot + 1) % 4; moves++; playTone(480, 0.05);
        }
        computePower(); updateUI();
      });
      window.addEventListener('keydown', (e) => { if (e.key === '1') setTool('rot'); if (e.key === '2') setTool('bypass'); });

      function completeMission() {
        isEnded = true; playTone(940, 0.2);
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = '¡CIRCUITO PCB RESTAURADO!';
        document.getElementById('debTitle').style.color = 'var(--crt-green)';
        document.getElementById('debBadge').textContent = '3/3 BUSES OK';
        document.getElementById('debDesc').textContent = 'Las tres líneas de potencia fluyen sin cortos ni caída hacia los módulos críticos.';
        document.getElementById('debOut').textContent = '3 / 3';
        document.getElementById('debBat').textContent = Math.round(battery) + '%';
        document.getElementById('debMoves').textContent = moves;
        document.getElementById('debGrade').textContent = battery > 60 ? 'A+ ÓPTIMO' : 'A NOMINAL';
      }
      function failMission() {
        isEnded = true; playTone(150, 0.35, 'sawtooth');
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = 'BATERÍA DE RESPALDO AGOTADA';
        document.getElementById('debTitle').style.color = 'var(--crt-red)';
        document.getElementById('debBadge').textContent = 'APAGÓN';
        document.getElementById('debDesc').textContent = 'El circuito no se completó antes de que la reserva de emergencia cayera a 0%.';
        document.getElementById('debOut').textContent = outLit.filter(Boolean).length + ' / 3';
        document.getElementById('debBat').textContent = '0%';
        document.getElementById('debMoves').textContent = moves;
        document.getElementById('debGrade').textContent = 'F FALLIDO';
      }
      function closeModalAndRetry() { document.getElementById('debriefModal').style.display = 'none'; resetMission(); }
      function nextLevelOrFinish() { document.getElementById('debriefModal').style.display = 'none'; setupScenario(Math.min(3, difficulty + 1)); }

      function updateUI() {
        const cnt = outLit.filter(Boolean).length;
        document.getElementById('valOut').textContent = cnt + ' / 3';
        document.getElementById('pcbStatus').textContent = cnt + ' / 3 SALIDAS CONECTADAS';
        document.getElementById('pcbStatus').style.color = cnt === 3 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('valBat').textContent = Math.round(battery) + '%';
        document.getElementById('barBat').style.width = battery + '%';
        document.getElementById('barBat').style.background = battery > 35 ? 'var(--crt-green)' : 'var(--crt-red)';
        document.getElementById('valMoves').textContent = moves;
        document.getElementById('clockDisplay').textContent = fmtClock(missionTime);
        let hint = '✔ 3/3 salidas energizadas — Listo para CONFIRMAR';
        for (const r of inRows) {
          let broken = false;
          for (let c = 0; c < 5; c++) {
            const cell = grid[r] && grid[r][c];
            if (cell && ((cell.blown && !cell.fixed) || (cell.type === 'I' && cell.rot % 2 !== 1))) {
              hint = '👉 Haz clic en Fila ' + (r + 1) + ', Col ' + (c + 1) + ' (' + (cell.blown ? 'CAP✖' : 'rotar') + ') o pulsa AUTO-CALIBRAR';
              broken = true; break;
            }
          }
          if (broken) break;
        }
        setGuideText(hint);
      }
      function boardMetrics() {
        const w = canvas.width, h = canvas.height;
        const sz = Math.floor(Math.min(w - 130, h - 40) / 5);
        return { x0: (w - sz * 5) / 2, y0: (h - sz * 5) / 2, sz };
      }

      let last = performance.now();
      function loop(now) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        resizeCanvasEl(canvas);
        if (!isPaused && !isEnded) {
          missionTime += dt;
          battery = Math.max(0, battery - dt * (0.45 + difficulty * 0.2));
          if (battery <= 0) failMission();
          updateUI();
        }
        const w = canvas.width, h = canvas.height;
        ctx.fillStyle = '#03120b'; ctx.fillRect(0, 0, w, h);
        const { x0, y0, sz } = boardMetrics();
        // Etiquetas IN / OUT
        inRows.forEach((r, idx) => {
          const cy = y0 + r * sz + sz / 2;
          ctx.fillStyle = '#00e5ff'; ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'right';
          ctx.fillText('IN-' + (idx + 1) + ' ▸', x0 - 8, cy + 4);
          ctx.fillStyle = outLit[idx] ? '#00ff88' : '#ffb703'; ctx.textAlign = 'left';
          ctx.fillText('▸ OUT-' + (idx + 1), x0 + sz * 5 + 8, cy + 4);
        });
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 5; c++) {
            const x = x0 + c * sz, y = y0 + r * sz, cx = x + sz / 2, cy = y + sz / 2;
            const g = grid[r][c], isLit = lit[r][c], m = cellMask(r, c);
            ctx.fillStyle = g.blown && !g.fixed ? '#240b14' : '#082016';
            ctx.fillRect(x + 2, y + 2, sz - 4, sz - 4);
            ctx.strokeStyle = isLit ? '#00ff88' : '#1b4735'; ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 2, y + 2, sz - 4, sz - 4);
            if (g.blown && !g.fixed) {
              ctx.fillStyle = '#ff3b5c'; ctx.font = 'bold 10px Courier New'; ctx.textAlign = 'center';
              ctx.fillText('CAP✖', cx, cy + 4);
            } else {
              ctx.strokeStyle = isLit ? '#00ff88' : '#3d705c'; ctx.lineWidth = Math.max(4, sz * 0.14);
              ctx.lineCap = 'round';
              if (m & 1) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, y + 2); ctx.stroke(); }
              if (m & 2) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x + sz - 2, cy); ctx.stroke(); }
              if (m & 4) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, y + sz - 2); ctx.stroke(); }
              if (m & 8) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x + 2, cy); ctx.stroke(); }
              ctx.fillStyle = g.fixed ? '#00e5ff' : (isLit ? '#bbf7d0' : '#4a7a68');
              ctx.beginPath(); ctx.arc(cx, cy, Math.max(4, sz * 0.1), 0, Math.PI * 2); ctx.fill();
            }
          }
        }
        requestAnimationFrame(loop);
      }
      window.addEventListener('load', () => { setupScenario(2); requestAnimationFrame(loop); });
    `
  })

  // 5) PUMA-3: espectrometria_masas.html ('spectro')
  const spectroHtml = wrapGame({
    id: 'spectro',
    title: 'Espectrometría de Masas Glaciar - PUMA-3',
    h1: 'PERFORACIÓN LÁSER Y ESPECTROMETRÍA DE MASAS · PUMA-3',
    badge: 'CIENCIA // ESPECTROMETRÍA DE MASAS (PUMA-3)',
    diffOptions: '<option value="1">Nivel 1 - Hielo Superficial</option><option value="2" selected>Nivel 2 - Núcleo Glaciar Mixto</option><option value="3">Nivel 3 - Isótopos Raros Lunar</option>',
    leftTitle: 'TALADRO TÉRMICO + GRÁFICO DE MASAS (m/z)',
    leftTagId: 'specStatus',
    leftTagText: 'MUESTRA 1 / 3',
    rightHtml: `
      <div class="tele-card">
        <div class="tele-row"><span class="tele-lbl">ISÓTOPO OBJETIVO:</span><span class="tele-val" id="valTargetIso">H2O (18.0 u)</span></div>
        <div class="tele-row"><span class="tele-lbl">MUESTRAS AISLADAS:</span><span class="tele-val" id="valCaught">0 / 3</span></div>
        <div class="tele-row"><span class="tele-lbl">COINCIDENCIA ESPECTRAL:</span><span class="tele-val" id="valMatch">0%</span></div>
        <div class="bar-bg"><div class="bar-fill" id="barMatch" style="width:0%"></div></div>
      </div>
      <div class="ctrl-box">
        <div class="tele-row"><span class="tele-lbl">FRECUENCIA LÁSER (Hz):</span><span><span class="tele-val" id="valLaser">450 Hz</span> <small id="tgtLaserHint" style="color:var(--crt-green)">(Obj: 340)</small></span></div>
        <input type="range" class="slider" id="slLaser" min="100" max="900" value="450" oninput="noteUserAdjust();updateTune()">
        <div class="tele-row"><span class="tele-lbl">ENERGÍA TÉRMICA (kW):</span><span><span class="tele-val" id="valPower">50 kW</span> <small id="tgtHeatHint" style="color:var(--crt-green)">(Obj: 62)</small></span></div>
        <input type="range" class="slider" id="slHeat" min="10" max="100" value="50" oninput="noteUserAdjust();updateTune()">
      </div>
      <button class="btn-primary" onclick="capturePeak()">🔬 CAPTURAR PICO QUÍMICO</button>
      <div class="note-box">Alinea Frecuencia y Energía con los valores <b>Obj</b> (&ge; 70%) y pulsa <b>Capturar</b> (3 muestras) o usa AUTO-CALIBRAR.</div>
    `,
    modalTitle: 'COMPOSICIÓN QUÍMICA VERIFICADA',
    modalStatsHtml: '<div>Isótopos Analizados: <b id="debIso">3 / 3</b></div><div>Precisión Media: <b id="debAcc">-</b></div><div>Tiempo: <b id="debTime">-</b></div><div>Rango: <b id="debGrade">-</b></div>',
    scriptBody: `
      const canvas = document.getElementById('mainCanvas'), ctx = canvas.getContext('2d');
      const SAMPLES = [
        { name: 'H2O CRISTALINO (18 u)', freq: 340, heat: 62 },
        { name: 'ISÓTOPO O-18 (20 u)', freq: 615, heat: 78 },
        { name: 'HELIO-3 REGOLITO (3 u)', freq: 790, heat: 44 }
      ];
      let difficulty = 2, isPaused = false, isEnded = false, missionTime = 0, stage = 0, userFreq = 450, userHeat = 50, phase = 0, accSum = 0;

      function setupScenario(lvl) {
        difficulty = parseInt(lvl) || 2;
        isPaused = false; isEnded = false; missionTime = 0; stage = 0; accSum = 0;
        userFreq = 450; userHeat = 50;
        document.getElementById('slLaser').value = userFreq;
        document.getElementById('slHeat').value = userHeat;
        updateTune();
        window.__mgAdjustCount = 0;
      }
      function changeDifficulty(v) { setupScenario(v); }
      function togglePause() { isPaused = !isPaused; document.getElementById('btnPause').textContent = isPaused ? '▶ REANUDAR' : '⏸ PAUSA'; }
      function resetMission() { setupScenario(difficulty); }
      function autoAssistMinigame() {
        if (isPaused || isEnded) return;
        const tgt = SAMPLES[Math.min(stage, SAMPLES.length - 1)];
        document.getElementById('slLaser').value = tgt.freq;
        document.getElementById('slHeat').value = tgt.heat;
        updateTune();
        showHud('✔ LÁSER SINTONIZADO AL 100% — PULSA CAPTURAR O CONFIRMAR', 'ok');
      }
      function updateTune() {
        userFreq = parseInt(document.getElementById('slLaser').value);
        userHeat = parseInt(document.getElementById('slHeat').value);
        document.getElementById('valLaser').textContent = userFreq + ' Hz';
        document.getElementById('valPower').textContent = userHeat + ' kW';
        updateUI();
      }
      function calcMatch() {
        const tgt = SAMPLES[stage];
        const fErr = Math.abs(userFreq - tgt.freq) / 800;
        const hErr = Math.abs(userHeat - tgt.heat) / 90;
        return Math.max(0, Math.round(100 * (1 - (fErr * 0.65 + hErr * 0.45))));
      }
      function capturePeak() {
        if (isPaused || isEnded) return;
        noteUserAdjust();
        const m = calcMatch();
        const req = 70;
        if (m >= req) {
          accSum += m; stage++;
          playTone(860, 0.14);
          if (stage >= SAMPLES.length) completeMission();
          else { showHud('✔ PICO QUÍMICO AISLADO (' + stage + '/3)', 'ok'); updateUI(); }
        } else {
          playTone(210, 0.16, 'sawtooth');
          showHud('⚠ Acerca a ' + SAMPLES[stage].freq + ' Hz / ' + SAMPLES[stage].heat + ' kW (>=70%)', 'warn');
        }
      }
      function completeMission() {
        isEnded = true; playTone(980, 0.22);
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = '¡ESPECTROMETRÍA COMPLETADA!';
        document.getElementById('debTitle').style.color = 'var(--crt-green)';
        document.getElementById('debBadge').textContent = 'MUESTRAS OK';
        document.getElementById('debDesc').textContent = 'El espectrómetro aisló H2O, Isótopo O-18 y Helio-3 del testigo glaciar.';
        document.getElementById('debIso').textContent = '3 / 3';
        document.getElementById('debAcc').textContent = Math.round(accSum / 3) + '%';
        document.getElementById('debTime').textContent = Math.round(missionTime) + ' s';
        document.getElementById('debGrade').textContent = accSum / 3 >= 94 ? 'A+ PURO' : 'A CIENTÍFICO';
      }
      function closeModalAndRetry() { document.getElementById('debriefModal').style.display = 'none'; resetMission(); }
      function nextLevelOrFinish() { document.getElementById('debriefModal').style.display = 'none'; setupScenario(Math.min(3, difficulty + 1)); }

      function updateUI() {
        const tgt = SAMPLES[Math.min(stage, 2)];
        const m = calcMatch();
        document.getElementById('valTargetIso').textContent = tgt.name;
        document.getElementById('valCaught').textContent = stage + ' / 3';
        document.getElementById('specStatus').textContent = 'MUESTRA ' + Math.min(3, stage + 1) + ' / 3';
        document.getElementById('valMatch').textContent = m + '%';
        document.getElementById('valMatch').style.color = m >= 70 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('barMatch').style.width = m + '%';
        document.getElementById('barMatch').style.background = m >= 70 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('tgtLaserHint').textContent = '(Obj: ' + tgt.freq + ' Hz)';
        document.getElementById('tgtHeatHint').textContent = '(Obj: ' + tgt.heat + ' kW)';
        document.getElementById('clockDisplay').textContent = fmtClock(missionTime);
        setGuideText(m >= 70
          ? '✔ Coincidencia ' + m + '% — Pulsa [🔬 CAPTURAR PICO] o CONFIRMAR'
          : '👉 Pon Láser ~' + tgt.freq + ' Hz y Calor ~' + tgt.heat + ' kW (>=70%)');
      }

      let last = performance.now();
      function loop(now) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        resizeCanvasEl(canvas);
        if (!isPaused && !isEnded) { missionTime += dt; phase += dt * 4; updateUI(); }
        const w = canvas.width, h = canvas.height, midY = h * 0.32;
        ctx.fillStyle = '#03060e'; ctx.fillRect(0, 0, w, h);
        // Bloque de hielo y haz láser superior
        ctx.fillStyle = '#0d2b45'; ctx.fillRect(20, midY - 26, w - 40, 26);
        ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = Math.max(1.5, userHeat / 25);
        ctx.beginPath(); ctx.moveTo(w / 2, 12); ctx.lineTo(w / 2 + Math.sin(phase * 3) * 3, midY - 12); ctx.stroke();
        // Espectrómetro inferior
        const gx0 = 24, gw = w - 48, gy0 = h - 30, gh = h * 0.48;
        ctx.strokeStyle = '#15253e'; ctx.lineWidth = 1;
        for (let i = 0; i <= 8; i++) { const x = gx0 + (i / 8) * gw; ctx.beginPath(); ctx.moveTo(x, gy0 - gh); ctx.lineTo(x, gy0); ctx.stroke(); }
        const tgt = SAMPLES[Math.min(stage, 2)];
        const plotCurve = (fVal, hVal, col, dashed) => {
          ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2.5;
          if (dashed) ctx.setLineDash([5, 4]);
          ctx.beginPath();
          const cxPeak = gx0 + ((fVal - 100) / 800) * gw;
          for (let px = gx0; px <= gx0 + gw; px += 3) {
            const d = (px - cxPeak) / 28;
            const noise = Math.sin(px * 0.12 + phase) * 3 * (difficulty * 0.6);
            const y = gy0 - Math.exp(-d * d) * (gh * (hVal / 105)) - Math.abs(noise);
            if (px === gx0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
          }
          ctx.stroke(); ctx.restore();
        };
        plotCurve(tgt.freq, tgt.heat, '#00ff88', true);
        plotCurve(userFreq, userHeat, '#ffb703', false);
        requestAnimationFrame(loop);
      }
      window.addEventListener('load', () => { setupScenario(2); requestAnimationFrame(loop); });
    `
  })

  // 6) PUMA-3: telemetria_multiespectral.html ('thermal')
  const thermalHtml = wrapGame({
    id: 'thermal',
    title: 'Telemetría Multiespectral IR/UV - PUMA-3',
    h1: 'CORONÓGRAFO SOLAR Y TELEMETRÍA MULTIESPECTRAL · PUMA-3',
    badge: 'CIENCIA // TELEMETRÍA IR/UV (PUMA-3)',
    diffOptions: '<option value="1">Nivel 1 - Fulguración Clara</option><option value="2" selected>Nivel 2 - Anomalía Multibanda</option><option value="3">Nivel 3 - Tormenta Coronal</option>',
    leftTitle: 'VISOR ÓPTICO / CORONÓGRAFO (CALIBRAR Y CLICAR ANOMALÍA)',
    leftTagId: 'thmStatus',
    leftTagText: '0 / 3 ANOMALÍAS REGISTRADAS',
    rightHtml: `
      <div class="tele-card">
        <div class="tele-row"><span class="tele-lbl">BANDA REQUERIDA:</span><span class="tele-val" id="valReqBand">INFRARROJO (IR)</span></div>
        <div class="tele-row"><span class="tele-lbl">NITIDEZ ÓPTICA:</span><span class="tele-val" id="valClarity">35%</span></div>
        <div class="bar-bg"><div class="bar-fill" id="barClarity" style="width:35%"></div></div>
        <div class="tele-row"><span class="tele-lbl">ANOMALÍAS ESCANEADAS:</span><span class="tele-val" id="valCount">0 / 3</span></div>
      </div>
      <div class="ctrl-box">
        <div class="tele-lbl" style="font-size:11px;">FILTRO DE BANDA ESPECTRAL:</div>
        <div class="btn-grid-3">
          <button class="btn-ctrl active" id="bandIR" onclick="setBand('IR')">IR</button>
          <button class="btn-ctrl" id="bandUV" onclick="setBand('UV')">UV</button>
          <button class="btn-ctrl" id="bandXR" onclick="setBand('XR')">RAYOS-X</button>
        </div>
        <div class="tele-row"><span class="tele-lbl">ENFOQUE ÓPTICO (mm):</span><span><span class="tele-val" id="valFocus">50 mm</span> <small id="tgtFocusHint" style="color:var(--crt-green)">(Obj: 72)</small></span></div>
        <input type="range" class="slider" id="slFocus" min="10" max="100" value="50" oninput="noteUserAdjust();updateOptics()">
        <div class="tele-row"><span class="tele-lbl">GANANCIA SENSOR (dB):</span><span><span class="tele-val" id="valGain">50 dB</span> <small id="tgtGainHint" style="color:var(--crt-green)">(Obj: 64)</small></span></div>
        <input type="range" class="slider" id="slGain" min="10" max="100" value="50" oninput="noteUserAdjust();updateOptics()">
      </div>
      <div class="note-box">Selecciona la banda, pon Enfoque y Ganancia cerca de los valores <b>Obj</b> (&ge; 70%) y haz clic en la anomalía (o usa AUTO-CALIBRAR).</div>
    `,
    modalTitle: 'ANOMALÍAS MULTIESPECTRALES CATALOGADAS',
    modalStatsHtml: '<div>Anomalías: <b id="debCount">3 / 3</b></div><div>Nitidez Media: <b id="debClarity">-</b></div><div>Tiempo: <b id="debTime">-</b></div><div>Rango: <b id="debGrade">-</b></div>',
    scriptBody: `
      const canvas = document.getElementById('mainCanvas'), ctx = canvas.getContext('2d');
      const BANDS = { IR: 'INFRARROJO (IR)', UV: 'ULTRAVIOLETA (UV)', XR: 'RAYOS-X CORONAL' };
      let difficulty = 2, isPaused = false, isEnded = false, missionTime = 0, band = 'IR', focus = 50, gain = 50, scanned = 0, claritySum = 0;
      let target = { band: 'IR', focus: 72, gain: 64, x: 0.35, y: 0.45, vx: 0.02, vy: 0.015 };

      function spawnTarget(idx) {
        const bs = ['IR', 'UV', 'XR'];
        target = {
          band: bs[idx % 3],
          focus: 20 + Math.floor(Math.random() * 68),
          gain: 25 + Math.floor(Math.random() * 60),
          x: 0.25 + Math.random() * 0.50,
          y: 0.25 + Math.random() * 0.50,
          vx: (Math.random() > 0.5 ? 1 : -1) * (0.006 * difficulty),
          vy: (Math.random() > 0.5 ? 1 : -1) * (0.006 * difficulty)
        };
      }
      function setupScenario(lvl) {
        difficulty = parseInt(lvl) || 2;
        isPaused = false; isEnded = false; missionTime = 0; scanned = 0; claritySum = 0;
        focus = 50; gain = 50;
        document.getElementById('slFocus').value = 50; document.getElementById('slGain').value = 50;
        setBand('IR'); spawnTarget(0); updateOptics();
        window.__mgAdjustCount = 0;
      }
      function changeDifficulty(v) { setupScenario(v); }
      function togglePause() { isPaused = !isPaused; document.getElementById('btnPause').textContent = isPaused ? '▶ REANUDAR' : '⏸ PAUSA'; }
      function resetMission() { setupScenario(difficulty); }
      function autoAssistMinigame() {
        if (isPaused || isEnded) return;
        setBand(target.band);
        document.getElementById('slFocus').value = target.focus;
        document.getElementById('slGain').value = target.gain;
        updateOptics();
        showHud('✔ ÓPTICA AL 100% — HAZ CLIC EN EL DESTELLO O CONFIRMA', 'ok');
      }
      function setBand(b) {
        noteUserAdjust();
        band = b;
        ['IR', 'UV', 'XR'].forEach((k) => document.getElementById('band' + k).classList.toggle('active', k === b));
        playTone(620, 0.05); updateOptics();
      }
      function calcClarity() {
        if (band !== target.band) return 15;
        const fErr = Math.abs(focus - target.focus) / 90;
        const gErr = Math.abs(gain - target.gain) / 90;
        return Math.max(10, Math.round(100 * (1 - (fErr * 0.6 + gErr * 0.55))));
      }
      function updateOptics() {
        focus = parseInt(document.getElementById('slFocus').value);
        gain = parseInt(document.getElementById('slGain').value);
        document.getElementById('valFocus').textContent = focus + ' mm';
        document.getElementById('valGain').textContent = gain + ' dB';
        updateUI();
      }
      canvas.addEventListener('click', (e) => {
        if (isPaused || isEnded) return;
        noteUserAdjust();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const tx = target.x * canvas.width, ty = target.y * canvas.height;
        const cl = calcClarity(), req = 70;
        if (cl < req) { playTone(200, 0.14); showHud('⚠ Sube nitidez >= 70% (' + target.band + ' / ' + target.focus + 'mm / ' + target.gain + 'dB)', 'warn'); return; }
        if (Math.hypot(mx - tx, my - ty) < 48) {
          claritySum += cl; scanned++;
          playTone(880, 0.16);
          if (scanned >= 3) completeMission();
          else { showHud('✔ ANOMALÍA ' + scanned + '/3 CAPTURADA', 'ok'); spawnTarget(scanned); updateUI(); }
        } else {
          showHud('🎯 HAZ CLIC DIRECTO SOBRE EL DESTELLO ANÓMALO');
        }
      });
      function completeMission() {
        isEnded = true; playTone(980, 0.22);
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = '¡BARRIDO MULTIESPECTRAL COMPLETO!';
        document.getElementById('debTitle').style.color = 'var(--crt-green)';
        document.getElementById('debBadge').textContent = '3/3 ESPECTROS';
        document.getElementById('debDesc').textContent = 'Telemetría IR, UV y Rayos-X enfocada y almacenada con nitidez científica.';
        document.getElementById('debCount').textContent = '3 / 3';
        document.getElementById('debClarity').textContent = Math.round(claritySum / 3) + '%';
        document.getElementById('debTime').textContent = Math.round(missionTime) + ' s';
        document.getElementById('debGrade').textContent = claritySum / 3 >= 93 ? 'A+ NÍTIDO' : 'A ÓPTIMO';
      }
      function closeModalAndRetry() { document.getElementById('debriefModal').style.display = 'none'; resetMission(); }
      function nextLevelOrFinish() { document.getElementById('debriefModal').style.display = 'none'; setupScenario(Math.min(3, difficulty + 1)); }

      function updateUI() {
        const cl = calcClarity();
        document.getElementById('valReqBand').textContent = BANDS[target.band];
        document.getElementById('valClarity').textContent = cl + '%';
        document.getElementById('valClarity').style.color = cl >= 70 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('barClarity').style.width = cl + '%';
        document.getElementById('barClarity').style.background = cl >= 70 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('tgtFocusHint').textContent = '(Obj: ' + target.focus + ' mm)';
        document.getElementById('tgtGainHint').textContent = '(Obj: ' + target.gain + ' dB)';
        document.getElementById('valCount').textContent = scanned + ' / 3';
        document.getElementById('thmStatus').textContent = scanned + ' / 3 ANOMALÍAS REGISTRADAS';
        document.getElementById('clockDisplay').textContent = fmtClock(missionTime);
        setGuideText(cl >= 70
          ? '✔ Nitidez ' + cl + '% — Haz clic sobre el destello o CONFIRMAR arriba'
          : '👉 Banda ' + target.band + ', Enfoque ~' + target.focus + ' mm, Ganancia ~' + target.gain + ' dB');
      }

      let last = performance.now();
      function loop(now) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        resizeCanvasEl(canvas);
        if (!isPaused && !isEnded) {
          missionTime += dt;
          target.x += target.vx * dt; target.y += target.vy * dt;
          if (target.x < 0.16 || target.x > 0.84) target.vx *= -1;
          if (target.y < 0.16 || target.y > 0.84) target.vy *= -1;
          updateUI();
        }
        const w = canvas.width, h = canvas.height;
        ctx.fillStyle = band === 'IR' ? '#120508' : band === 'UV' ? '#0b0618' : '#030814';
        ctx.fillRect(0, 0, w, h);
        // Disco solar o planeta al fondo
        const col = band === 'IR' ? '#ff6b35' : band === 'UV' ? '#a855f7' : '#38bdf8';
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.36, 0, Math.PI * 2); ctx.stroke();
        const cl = calcClarity(), blur = (100 - cl) * 0.35;
        const tx = target.x * w, ty = target.y * h;
        const grad = ctx.createRadialGradient(tx, ty, 2, tx, ty, 12 + blur * 1.4);
        grad.addColorStop(0, cl > 80 ? '#00ff88' : col);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(tx, ty, 14 + blur * 1.5, 0, Math.PI * 2); ctx.fill();
        if (cl >= 70) {
          ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2;
          ctx.strokeRect(tx - 20, ty - 20, 40, 40);
        }
        requestAnimationFrame(loop);
      }
      window.addEventListener('load', () => { setupScenario(2); requestAnimationFrame(loop); });
    `
  })

  // 7) SERPIENTE-2: alineacion_antena_dsn.html ('hga')
  const hgaHtml = wrapGame({
    id: 'hga',
    title: 'Alineación de Antena DSN - SERPIENTE-2',
    h1: 'RASTREO DE ANTENA DE ALTA GANANCIA HGA / DSN · SERPIENTE-2',
    badge: 'COMUNICACIONES // ANTENA DSN (SERPIENTE-2)',
    diffOptions: '<option value="1">Nivel 1 - Órbita Lenta</option><option value="2" selected>Nivel 2 - Seguimiento Dinámico</option><option value="3">Nivel 3 - Perturbación Atmosférica</option>',
    leftTitle: 'RADAR POLAR DE SEGUIMIENTO SATELITAL',
    leftTagId: 'hgaStatus',
    leftTagText: 'SNR INSUFICIENTE',
    rightHtml: `
      <div class="tele-card">
        <div class="tele-row"><span class="tele-lbl">CALIDAD DE ENLACE (SNR):</span><span class="tele-val" id="valSnr">0%</span></div>
        <div class="bar-bg"><div class="bar-fill" id="barSnr" style="width:0%"></div></div>
        <div class="tele-row"><span class="tele-lbl">DESCARGA TELEMETRÍA (SNR &ge; 75%):</span><span class="tele-val" id="valDl">0%</span></div>
        <div class="bar-bg"><div class="bar-fill" id="barDl" style="width:0%;background:var(--crt-cyan)"></div></div>
        <div class="tele-row"><span class="tele-lbl">OBJETIVO POLARIZACIÓN:</span><span class="tele-val" id="valPolTarget">+25°</span></div>
      </div>
      <div class="ctrl-box">
        <div class="tele-row"><span class="tele-lbl">ACIMUT (AZ):</span><span class="tele-val" id="valAz">180°</span></div>
        <input type="range" class="slider" id="slAz" min="0" max="360" value="180" oninput="noteUserAdjust();updateDish()">
        <div class="tele-row"><span class="tele-lbl">ELEVACIÓN (EL):</span><span class="tele-val" id="valEl">45°</span></div>
        <input type="range" class="slider" id="slEl" min="10" max="90" value="45" oninput="noteUserAdjust();updateDish()">
        <div class="tele-row"><span class="tele-lbl">POLARIZACIÓN (POL):</span><span class="tele-val" id="valPol">0°</span></div>
        <input type="range" class="slider" id="slPol" min="-90" max="90" value="0" oninput="noteUserAdjust();updateDish()">
      </div>
      <div class="note-box">Arrastra sobre el radar hacia el satélite verde o ajusta <b>AZ / EL / POL</b> hasta <b>SNR &ge; 75%</b> (descarga rápida en ~5s).</div>
    `,
    modalTitle: 'DESCARGA DE ALTA GANANCIA COMPLETA',
    modalStatsHtml: '<div>Bloque Recibido: <b id="debDl">100%</b></div><div>SNR Promedio: <b id="debSnr">-</b></div><div>Tiempo: <b id="debTime">-</b></div><div>Rango: <b id="debGrade">-</b></div>',
    scriptBody: `
      const canvas = document.getElementById('mainCanvas'), ctx = canvas.getContext('2d');
      let difficulty = 2, isPaused = false, isEnded = false, missionTime = 0, dl = 0, snrSamples = 0, snrSum = 0;
      let az = 180, el = 45, pol = 0, satAz = 60, satEl = 52, satPol = 25, dragging = false;

      function setupScenario(lvl) {
        difficulty = parseInt(lvl) || 2;
        isPaused = false; isEnded = false; missionTime = 0; dl = 0; snrSamples = 0; snrSum = 0;
        satAz = 75; satEl = 55; satPol = [-40, 30, 55, -20][Math.floor(Math.random() * 4)];
        az = 180; el = 45; pol = 0;
        document.getElementById('slAz').value = az; document.getElementById('slEl').value = el; document.getElementById('slPol').value = pol;
        updateDish();
        window.__mgAdjustCount = 0;
      }
      function changeDifficulty(v) { setupScenario(v); }
      function togglePause() { isPaused = !isPaused; document.getElementById('btnPause').textContent = isPaused ? '▶ REANUDAR' : '⏸ PAUSA'; }
      function resetMission() { setupScenario(difficulty); }
      function autoAssistMinigame() {
        if (isPaused || isEnded) return;
        az = Math.round(satAz); el = Math.round(satEl); pol = Math.round(satPol);
        document.getElementById('slAz').value = az;
        document.getElementById('slEl').value = el;
        document.getElementById('slPol').value = pol;
        dl = Math.max(dl, 65);
        updateDish();
        showHud('✔ ANTENA HGA ALINEADA AL 100% — LISTO PARA CONFIRMAR', 'ok');
      }
      function updateDish() {
        az = parseInt(document.getElementById('slAz').value);
        el = parseInt(document.getElementById('slEl').value);
        pol = parseInt(document.getElementById('slPol').value);
        document.getElementById('valAz').textContent = az + '°';
        document.getElementById('valEl').textContent = el + '°';
        document.getElementById('valPol').textContent = (pol > 0 ? '+' : '') + pol + '°';
      }
      function aimFromPointer(e) {
        noteUserAdjust();
        const rect = canvas.getBoundingClientRect();
        const cx = canvas.width / 2, cy = canvas.height / 2, R = Math.min(canvas.width, canvas.height) * 0.4;
        const dx = (e.clientX - rect.left) - cx, dy = (e.clientY - rect.top) - cy;
        const d = Math.min(R, Math.hypot(dx, dy));
        az = Math.round(((Math.atan2(dy, dx) * 180 / Math.PI) + 450) % 360);
        el = Math.max(10, Math.min(90, Math.round(90 - (d / R) * 80)));
        document.getElementById('slAz').value = az; document.getElementById('slEl').value = el;
        updateDish();
      }
      canvas.addEventListener('mousedown', (e) => { dragging = true; aimFromPointer(e); });
      window.addEventListener('mousemove', (e) => { if (dragging && !isPaused && !isEnded) aimFromPointer(e); });
      window.addEventListener('mouseup', () => { dragging = false; });

      function angDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
      function calcSnr() {
        const dAz = angDiff(az, satAz), dEl = Math.abs(el - satEl), dPol = Math.abs(pol - satPol);
        return Math.max(0, Math.round(100 - dAz * 0.7 - dEl * 0.9 - dPol * 0.45));
      }
      function completeMission() {
        isEnded = true; playTone(920, 0.22);
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = '¡ENLACE HGA / DSN SELLADO!';
        document.getElementById('debTitle').style.color = 'var(--crt-green)';
        document.getElementById('debBadge').textContent = 'LOCK 100%';
        document.getElementById('debDesc').textContent = 'La antena parabólica mantuvo el enganche sobre el CubeSat hasta recibir el bloque completo.';
        const avg = snrSamples ? Math.round(snrSum / snrSamples) : 95;
        document.getElementById('debDl').textContent = '100%';
        document.getElementById('debSnr').textContent = avg + '%';
        document.getElementById('debTime').textContent = Math.round(missionTime) + ' s';
        document.getElementById('debGrade').textContent = avg >= 92 ? 'A+ LÁSER LOCK' : 'A NOMINAL';
      }
      function closeModalAndRetry() { document.getElementById('debriefModal').style.display = 'none'; resetMission(); }
      function nextLevelOrFinish() { document.getElementById('debriefModal').style.display = 'none'; setupScenario(Math.min(3, difficulty + 1)); }

      function updateUI(snr) {
        document.getElementById('valSnr').textContent = snr + '%';
        document.getElementById('valSnr').style.color = snr >= 75 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('barSnr').style.width = snr + '%';
        document.getElementById('barSnr').style.background = snr >= 75 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('valDl').textContent = Math.round(dl) + '%';
        document.getElementById('barDl').style.width = Math.min(100, dl) + '%';
        document.getElementById('valPolTarget').textContent = (satPol > 0 ? '+' : '') + Math.round(satPol) + '°';
        document.getElementById('hgaStatus').textContent = snr >= 75 ? 'DESCARGA EN CURSO (' + Math.round(dl) + '%)' : 'RASTREANDO SATÉLITE...';
        document.getElementById('hgaStatus').style.color = snr >= 75 ? 'var(--crt-green)' : 'var(--crt-amber)';
        document.getElementById('clockDisplay').textContent = fmtClock(missionTime);
        setGuideText(snr >= 75
          ? '✔ SNR enganchado (' + Math.round(dl) + '%) — Ya puedes CONFIRMAR arriba'
          : '👉 Pon AZ=' + Math.round(satAz) + '°, EL=' + Math.round(satEl) + '°, POL=' + (satPol > 0 ? '+' : '') + Math.round(satPol) + '°');
      }

      let last = performance.now();
      function loop(now) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        resizeCanvasEl(canvas);
        const spd = difficulty === 1 ? 3 : difficulty === 2 ? 5 : 7;
        let snr = calcSnr();
        if (!isPaused && !isEnded) {
          missionTime += dt;
          satAz = (satAz + spd * dt) % 360;
          satEl = 48 + Math.sin(missionTime * 0.25 * difficulty) * 16;
          if (difficulty === 3) satPol = Math.sin(missionTime * 0.15) * 35;
          snr = calcSnr();
          snrSum += snr; snrSamples++;
          if (snr >= 75) { dl = Math.min(100, dl + dt * 18.0); if (dl >= 100) completeMission(); }
          updateUI(snr);
        }
        const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.4;
        ctx.fillStyle = '#03060e'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#132844'; ctx.lineWidth = 1;
        [0.33, 0.66, 1].forEach((f) => { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke(); });
        ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
        const polarXY = (a, e) => {
          const rr = ((90 - e) / 80) * R, rad = (a - 90) * Math.PI / 180;
          return [cx + Math.cos(rad) * rr, cy + Math.sin(rad) * rr];
        };
        const [sx, sy] = polarXY(satAz, satEl), [dx, dy] = polarXY(az, el);
        ctx.fillStyle = '#00ff88'; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill();
        ctx.font = 'bold 10px Courier New'; ctx.fillText('SAT', sx + 10, sy - 6);
        ctx.strokeStyle = snr >= 90 ? '#00ff88' : '#00e5ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(dx, dy, 15, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(dx - 20, dy); ctx.lineTo(dx + 20, dy); ctx.moveTo(dx, dy - 20); ctx.lineTo(dx, dy + 20); ctx.stroke();
        requestAnimationFrame(loop);
      }
      window.addEventListener('load', () => { setupScenario(2); requestAnimationFrame(loop); });
    `
  })

  // 8) SERPIENTE-2: desencriptacion_cuantica.html ('decrypt')
  const decryptHtml = wrapGame({
    id: 'decrypt',
    title: 'Desencriptación Cuántica CRC - SERPIENTE-2',
    h1: 'MATRIZ DE PARIDAD CUÁNTICA Y DESENCRIPTACIÓN CRC · SERPIENTE-2',
    badge: 'COMUNICACIONES // DESENCRIPTACIÓN CUÁNTICA (SERPIENTE-2)',
    diffOptions: '<option value="1">Nivel 1 - 1 Bit Corrupto/Trama</option><option value="2" selected>Nivel 2 - Ruido Solar CRC</option><option value="3">Nivel 3 - Doble Error Cósmico</option>',
    leftTitle: 'MATRIZ HEXADECIMAL DE TELEMETRÍA Y CHECKSUM XOR',
    leftTagId: 'decStatus',
    leftTagText: 'TRAMA 1 / 3',
    rightHtml: `
      <div class="tele-card">
        <div class="tele-row"><span class="tele-lbl">TRAMAS DESENCRIPTADAS:</span><span class="tele-val" id="valFrames">0 / 3</span></div>
        <div class="bar-bg"><div class="bar-fill" id="barFrames" style="width:0%"></div></div>
        <div class="tele-row"><span class="tele-lbl">INTEGRIDAD CRC ACTUAL:</span><span class="tele-val" id="valCrc" style="color:var(--crt-amber)">CORRUPTO</span></div>
        <div class="tele-row"><span class="tele-lbl">ERRORES DETECTADOS:</span><span class="tele-val" id="valErrs">0</span></div>
      </div>
      <div class="ctrl-box">
        <div class="tele-lbl" style="font-size:11px;">CORRECCIÓN DEL NODO SELECCIONADO:</div>
        <button class="btn-primary" onclick="fixSelectedByte()">🔧 INVERTIR BIT DE PARIDAD (AUTO-CRC)</button>
        <button class="btn-ctrl" onclick="submitFrame()" id="btnVerify">✔ VERIFICAR Y FIRMAR TRAMA</button>
      </div>
      <div class="note-box">Haz clic en la celda roja donde cruzan fila y columna en error, pulsa <b>Invertir Bit</b> y firma <b>3 tramas</b> (o usa AUTO-CALIBRAR).</div>
    `,
    modalTitle: 'TELEMETRÍA CUÁNTICA DESENCRIPTADA',
    modalStatsHtml: '<div>Tramas Validadas: <b id="debFrames">3 / 3</b></div><div>Fallos de Firma: <b id="debErrs">-</b></div><div>Tiempo: <b id="debTime">-</b></div><div>Rango: <b id="debGrade">-</b></div>',
    scriptBody: `
      const canvas = document.getElementById('mainCanvas'), ctx = canvas.getContext('2d');
      let difficulty = 2, isPaused = false, isEnded = false, missionTime = 0, frame = 0, wrongSubmits = 0;
      let mat = [], expectedRow = [0,0,0,0], expectedCol = [0,0,0,0], sel = { r: -1, c: -1 };

      function genMatrix() {
        mat = [];
        for (let r = 0; r < 4; r++) {
          const row = [];
          for (let c = 0; c < 4; c++) row.push(16 + Math.floor(Math.random() * 220));
          mat.push(row);
        }
        expectedRow = mat.map((row) => row.reduce((a, b) => a ^ b, 0));
        expectedCol = [0, 1, 2, 3].map((c) => mat.reduce((a, row) => a ^ row[c], 0));
        const flips = 1;
        const used = new Set();
        for (let i = 0; i < flips; i++) {
          const rr = Math.floor(Math.random() * 4), cc = Math.floor(Math.random() * 4);
          const key = rr + ',' + cc;
          if (!used.has(key)) { used.add(key); mat[rr][cc] ^= 0x0f; }
        }
        sel = { r: -1, c: -1 };
      }
      function checkParity() {
        const rOk = mat.map((row, r) => row.reduce((a, b) => a ^ b, 0) === expectedRow[r]);
        const cOk = [0, 1, 2, 3].map((c) => mat.reduce((a, row) => a ^ row[c], 0) === expectedCol[c]);
        return { rOk, cOk, allOk: rOk.every(Boolean) && cOk.every(Boolean) };
      }
      function setupScenario(lvl) {
        difficulty = parseInt(lvl) || 2;
        window.__mgAdjustCount = 0;
        isPaused = false; isEnded = false; missionTime = 0; frame = 0; wrongSubmits = 0;
        genMatrix(); updateUI();
      }
      function changeDifficulty(v) { setupScenario(v); }
      function togglePause() { isPaused = !isPaused; document.getElementById('btnPause').textContent = isPaused ? '▶ REANUDAR' : '⏸ PAUSA'; }
      function resetMission() { setupScenario(difficulty); }
      function autoAssistMinigame() {
        if (isPaused || isEnded) return;
        const { rOk, cOk } = checkParity();
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            if (!rOk[r] && !cOk[c]) { mat[r][c] ^= 0x0f; sel = { r, c }; }
          }
        }
        showHud('✔ PARIDAD CRC CORREGIDA — PULSA FIRMAR TRAMA O CONFIRMAR', 'ok');
        updateUI();
      }

      function gridMetrics() {
        const w = canvas.width, h = canvas.height;
        const cw = Math.min(82, Math.floor((w - 150) / 4)), ch = Math.min(62, Math.floor((h - 110) / 4));
        const x0 = (w - cw * 4 - 70) / 2, y0 = (h - ch * 4 - 45) / 2;
        return { x0, y0, cw, ch };
      }
      canvas.addEventListener('click', (e) => {
        if (isPaused || isEnded) return;
        noteUserAdjust();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const { x0, y0, cw, ch } = gridMetrics();
        const c = Math.floor((mx - x0) / cw), r = Math.floor((my - y0) / ch);
        if (r >= 0 && r < 4 && c >= 0 && c < 4) { sel = { r, c }; playTone(560, 0.04); }
      });
      function fixSelectedByte() {
        if (isPaused || isEnded) return;
        noteUserAdjust();
        if (sel.r < 0) {
          const { rOk, cOk } = checkParity();
          for (let r = 0; r < 4 && sel.r < 0; r++) {
            for (let c = 0; c < 4; c++) {
              if (!rOk[r] && !cOk[c]) { sel = { r, c }; break; }
            }
          }
          if (sel.r < 0) { showHud('TRAMA YA VÁLIDA — PULSA FIRMAR', 'ok'); return; }
        }
        mat[sel.r][sel.c] ^= 0x0f;
        playTone(720, 0.07);
        updateUI();
      }
      function submitFrame() {
        if (isPaused || isEnded) return;
        noteUserAdjust();
        const { allOk } = checkParity();
        if (!allOk) {
          wrongSubmits++; playTone(200, 0.16, 'sawtooth');
          showHud('⚠ Corrige la celda roja con INVERTIR BIT antes de firmar', 'warn');
          updateUI(); return;
        }
        frame++; playTone(880, 0.12);
        if (frame >= 3) completeMission();
        else { showHud('✔ TRAMA ' + frame + '/3 VERIFICADA', 'ok'); genMatrix(); updateUI(); }
      }
      function completeMission() {
        isEnded = true; playTone(980, 0.22);
        document.getElementById('debriefModal').style.display = 'flex';
        document.getElementById('debTitle').textContent = '¡CANAL CUÁNTICO DESCIFRADO!';
        document.getElementById('debTitle').style.color = 'var(--crt-green)';
        document.getElementById('debBadge').textContent = 'CRC VÁLIDO';
        document.getElementById('debDesc').textContent = 'Las tramas de telemetría quedaron limpias de corrupción por radiación cósmica.';
        document.getElementById('debFrames').textContent = '3 / 3';
        document.getElementById('debErrs').textContent = wrongSubmits;
        document.getElementById('debTime').textContent = Math.round(missionTime) + ' s';
        document.getElementById('debGrade').textContent = wrongSubmits === 0 ? 'A+ PERFECTO' : 'A SEGURO';
      }
      function closeModalAndRetry() { document.getElementById('debriefModal').style.display = 'none'; resetMission(); }
      function nextLevelOrFinish() { document.getElementById('debriefModal').style.display = 'none'; setupScenario(Math.min(3, difficulty + 1)); }

      function updateUI() {
        const { rOk, cOk, allOk } = checkParity();
        document.getElementById('valFrames').textContent = frame + ' / 3';
        document.getElementById('barFrames').style.width = (frame / 3) * 100 + '%';
        document.getElementById('decStatus').textContent = 'TRAMA ' + Math.min(3, frame + 1) + ' / 3';
        document.getElementById('valCrc').textContent = allOk ? 'PARIDAD OK ✔' : 'BIT CORRUPTO ✖';
        document.getElementById('valCrc').style.color = allOk ? 'var(--crt-green)' : 'var(--crt-red)';
        document.getElementById('valErrs').textContent = wrongSubmits;
        document.getElementById('clockDisplay').textContent = fmtClock(missionTime);
        if (allOk) {
          setGuideText('✔ Paridad OK — Pulsa [✔ VERIFICAR Y FIRMAR] o CONFIRMAR (' + frame + '/3)');
        } else {
          let br = 0, bc = 0;
          for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!rOk[r] && !cOk[c]) { br = r; bc = c; }
          setGuideText('👉 Clic celda roja [F' + (br + 1) + ', C' + (bc + 1) + '] -> Pulsa INVERTIR BIT');
        }
      }

      let last = performance.now();
      function loop(now) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        resizeCanvasEl(canvas);
        if (!isPaused && !isEnded) { missionTime += dt; updateUI(); }
        const w = canvas.width, h = canvas.height;
        ctx.fillStyle = '#03060e'; ctx.fillRect(0, 0, w, h);
        const { x0, y0, cw, ch } = gridMetrics();
        const { rOk, cOk } = checkParity();
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            const x = x0 + c * cw, y = y0 + r * ch;
            const bad = !rOk[r] && !cOk[c];
            const isSel = sel.r === r && sel.c === c;
            ctx.fillStyle = isSel ? '#0c2b45' : bad ? '#280a16' : '#091426';
            ctx.fillRect(x + 3, y + 3, cw - 6, ch - 6);
            ctx.strokeStyle = isSel ? '#00e5ff' : bad ? '#ff3b5c' : '#1e3554';
            ctx.lineWidth = isSel ? 2.5 : 1.5;
            ctx.strokeRect(x + 3, y + 3, cw - 6, ch - 6);
            ctx.fillStyle = bad ? '#fda4af' : '#e2e8f0';
            ctx.font = 'bold 14px Courier New'; ctx.textAlign = 'center';
            ctx.fillText('0x' + mat[r][c].toString(16).toUpperCase().padStart(2, '0'), x + cw / 2, y + ch / 2 + 5);
          }
          // Checksum fila a la derecha
          const rx = x0 + 4 * cw + 38, ry = y0 + r * ch + ch / 2 + 4;
          ctx.fillStyle = rOk[r] ? '#00ff88' : '#ff3b5c';
          ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'center';
          ctx.fillText(rOk[r] ? 'OK ✔' : 'ERR ✖', rx, ry);
        }
        for (let c = 0; c < 4; c++) {
          const cx = x0 + c * cw + cw / 2, cy = y0 + 4 * ch + 22;
          ctx.fillStyle = cOk[c] ? '#00ff88' : '#ff3b5c';
          ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'center';
          ctx.fillText(cOk[c] ? 'OK' : 'ERR', cx, cy);
        }
        requestAnimationFrame(loop);
      }
      window.addEventListener('load', () => { setupScenario(2); requestAnimationFrame(loop); });
    `
  })

  return [
    { filename: 'calibracion_giroscopio.html', id: 'gyro', h1: 'CALIBRACIÓN DE GIROSCOPIO 3D Y CONTROL ADCS · CÓNDOR-4', badge: 'DIRECTOR // ADCS GIROSCOPIO (CÓNDOR-4)', html: gyroHtml },
    { filename: 'eyeccion_escombros.html', id: 'debris', h1: 'RADAR ORBITAL KESSLER Y EYECCIÓN DE ESCOMBROS · CÓNDOR-4', badge: 'DIRECTOR // EVASIÓN KESSLER (CÓNDOR-4)', html: debrisHtml },
    { filename: 'refrigeracion_reactor.html', id: 'reactor', h1: 'REFRIGERACIÓN CRIOGÉNICA DEL REACTOR DE FISIÓN · ALPACA-1', badge: 'INGENIERÍA // REFRIGERACIÓN REACTOR (ALPACA-1)', html: reactorHtml },
    { filename: 'reparacion_circuitos.html', id: 'pcb', h1: 'ENRUTAMIENTO DE BUSES PCB Y BYPASS DE CAPACITORES · ALPACA-1', badge: 'INGENIERÍA // PLACA PCB (ALPACA-1)', html: pcbHtml },
    { filename: 'espectrometria_masas.html', id: 'spectro', h1: 'PERFORACIÓN LÁSER Y ESPECTROMETRÍA DE MASAS · PUMA-3', badge: 'CIENCIA // ESPECTROMETRÍA DE MASAS (PUMA-3)', html: spectroHtml },
    { filename: 'telemetria_multiespectral.html', id: 'thermal', h1: 'CORONÓGRAFO SOLAR Y TELEMETRÍA MULTIESPECTRAL · PUMA-3', badge: 'CIENCIA // TELEMETRÍA IR/UV (PUMA-3)', html: thermalHtml },
    { filename: 'alineacion_antena_dsn.html', id: 'hga', h1: 'RASTREO DE ANTENA DE ALTA GANANCIA HGA / DSN · SERPIENTE-2', badge: 'COMUNICACIONES // ANTENA DSN (SERPIENTE-2)', html: hgaHtml },
    { filename: 'desencriptacion_cuantica.html', id: 'decrypt', h1: 'MATRIZ DE PARIDAD CUÁNTICA Y DESENCRIPTACIÓN CRC · SERPIENTE-2', badge: 'COMUNICACIONES // DESENCRIPTACIÓN CUÁNTICA (SERPIENTE-2)', html: decryptHtml },
  ]
}

module.exports = { getNewMinigames }
