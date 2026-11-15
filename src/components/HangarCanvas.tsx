import { useEffect, useRef } from 'react'
import { CHASSIS, PART_BY_ID } from '../game/catalog'

interface Props {
  chassisId: string
  parts: Record<string, number>
  lastInstall: { id: string; at: number } | null
}

type Ctx = CanvasRenderingContext2D
const rect = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h) }
const px = (c: Ctx, x: number, y: number, col: string) => rect(c, x, y, 1, 1, col)
function circle(c: Ctx, cx: number, cy: number, r: number, col: string) {
  c.fillStyle = col
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + 1) c.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1)
}
function line(c: Ctx, x0: number, y0: number, x1: number, y1: number, col: string, th = 1) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))
  c.fillStyle = col
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n
    c.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), th, th)
  }
}
/** Octágono con esquinas biseladas */
function octagon(c: Ctx, x: number, y: number, w: number, h: number, ch: number, col: string) {
  c.fillStyle = col
  for (let j = 0; j < h; j++) {
    const inset = j < ch ? ch - j : j >= h - ch ? j - (h - ch) + 1 : 0
    if (w - 2 * inset > 0) c.fillRect(Math.round(x + inset), Math.round(y + j), w - 2 * inset, 1)
  }
}

// ---------- Configuración por chasis ----------
interface ShipCfg {
  cols: number; rows: number; fwMin: number
  noseH: number; serviceH: number; bellH: number; bellTop: number; bellBot: number
  tank: number; aux: number; wing: number; wingTh: number; xWings: boolean; bands: number; domeR: number; dishR: number
  name: string
}
const CFG: Record<string, ShipCfg> = {
  '3U': { cols: 1, rows: 3, fwMin: 32, noseH: 15, serviceH: 14, bellH: 11, bellTop: 9, bellBot: 17, tank: 4, aux: 0, wing: 30, wingTh: 14, xWings: false, bands: 0, domeR: 7, dishR: 11, name: 'SONDA LIGERA EXPLORADORA' },
  '6U': { cols: 2, rows: 3, fwMin: 40, noseH: 18, serviceH: 18, bellH: 13, bellTop: 12, bellBot: 22, tank: 5, aux: 2, wing: 44, wingTh: 18, xWings: false, bands: 1, domeR: 9, dishR: 15, name: 'NAVE ORBITAL ESTÁNDAR' },
  '12U': { cols: 3, rows: 4, fwMin: 50, noseH: 22, serviceH: 22, bellH: 15, bellTop: 15, bellBot: 28, tank: 6, aux: 4, wing: 62, wingTh: 13, xWings: true, bands: 2, domeR: 11, dishR: 21, name: 'CRUCERO PESADO DE ESPACIO PROFUNDO' },
}

const BAY_COL: Record<string, string> = {
  cam: '#5ef0ff', thermal: '#ff8a3d', neutron: '#2ecc71', corona: '#ffd23f', mag: '#c0c8d8',
  bat20: '#2ecc71', bat40: '#2ecc71', bat90: '#2ecc71', rw: '#a8b0c4', mtq: '#d98c4a',
  uhf: '#b28bff', spatch: '#b28bff', iris: '#b28bff', hga: '#b28bff', th_cold: '#dfe6ff', th_mono: '#ff9f43', th_ion: '#5ef0ff',
}

/** Bahía tecnológica en forma de cápsula, integrada en el casco */
function drawBay(c: Ctx, id: string | null, first: boolean, x: number, y: number, t: number) {
  rect(c, x + 1, y, 10, 11, '#000'); rect(c, x, y + 1, 12, 9, '#000')
  rect(c, x + 1, y + 1, 10, 9, '#121829')
  if (!id) { rect(c, x + 3, y + 5, 6, 1, '#27304c'); return }
  const col = BAY_COL[id]
  c.globalAlpha = 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(t * 3 + x * 0.3 + y))
  rect(c, x + 1, y + 1, 10, 9, col)
  c.globalAlpha = 1
  rect(c, x + 2, y + 1, 8, 1, col); rect(c, x + 2, y + 9, 8, 1, col)
  if (!first) { rect(c, x + 5, y + 3, 2, 5, col); return }
  const cx = x + 6, cy = y + 5
  switch (id) {
    case 'cam': circle(c, cx, cy, 4, '#0b1a4a'); circle(c, cx, cy, 2, '#5ef0ff'); px(c, cx - 1, cy - 1, '#fff'); break
    case 'thermal': circle(c, cx, cy, 3, '#ff8a3d'); circle(c, cx, cy, 1, '#ffe0b0'); break
    case 'neutron': for (let i = -4; i <= 4; i++) rect(c, cx - (4 - Math.abs(i)), cy + Math.round(i * 0.9), (4 - Math.abs(i)) * 2 + 1, 1, '#2ecc71'); px(c, cx, cy, '#0b3d1f'); break
    case 'corona': circle(c, cx, cy, 4, '#ffd23f'); circle(c, cx, cy, 3, '#000'); break
    case 'mag': rect(c, cx - 3, cy - 2, 6, 4, '#c0c8d8'); px(c, cx + 2, cy - 1, '#f55'); rect(c, cx - 1, cy - 1, 2, 2, '#355'); break
    case 'bat20': case 'bat40': case 'bat90': for (let i = 0; i < 3; i++) rect(c, x + 3, y + 2 + i * 3, 6, 2, i < (id === 'bat20' ? 1 : id === 'bat40' ? 2 : 3) ? '#7bff9a' : '#1d5a34'); break
    case 'rw': circle(c, cx, cy, 4, '#a8b0c4'); circle(c, cx, cy, 1, '#2a2f40'); line(c, cx, cy, cx + Math.cos(t * 6) * 4, cy + Math.sin(t * 6) * 4, '#2a2f40'); break
    case 'mtq': for (let i = 0; i < 4; i++) rect(c, x + 3, y + 2 + i * 2, 6, 1, '#d98c4a'); break
    case 'uhf': case 'spatch': case 'iris': case 'hga': rect(c, x + 3, y + 3, 6, 5, '#5a3d8f'); px(c, x + 4, y + 4, Math.floor(t * 4) % 2 ? '#7bff9a' : '#1d5a34'); rect(c, x + 3, y + 6, 6, 1, '#b28bff'); break
    case 'th_cold': case 'th_mono': case 'th_ion': circle(c, cx, cy, 3, '#222'); circle(c, cx, cy, 2, col); break
  }
}

function drawPanel(c: Ctx, x: number, y: number, dir: 1 | -1, len: number, th: number, slope: number, kind: 'dep' | 'he', t: number) {
  const base = kind === 'he' ? '#1a2a6a' : '#2a5cff'
  const ln = kind === 'he' ? '#b8942e' : '#0b1f6a'
  for (let i = 0; i < len; i++) {
    const xx = x + dir * i, yy = y + Math.round(i * slope)
    rect(c, xx, yy - 1, 1, th + 2, '#000')
    if (i % 15 === 14) { rect(c, xx, yy, 1, th, '#8a8f9c'); continue }
    rect(c, xx, yy, 1, th, base)
    if (i % 5 === 0) rect(c, xx, yy, 1, th, ln)
    for (let k = 4; k < th; k += 5) px(c, xx, yy + k, ln)
  }
  const g = Math.floor((t * 30) % (len + 20)) - 10
  if (g >= 0 && g < len) { c.globalAlpha = 0.7; px(c, x + dir * g, y + Math.round(g * slope) + 1, '#fff'); px(c, x + dir * g, y + Math.round(g * slope) + 2, '#fff'); c.globalAlpha = 1 }
}

function drawDish(c: Ctx, cx: number, baseY: number, R: number, needleTip: boolean, t: number) {
  const depth = Math.max(3, Math.round(R * 0.45))
  // pata de soporte
  rect(c, cx - 1, baseY, 2, 6, '#9aa0ad')
  for (let i = -R; i <= R; i++) {
    const u = i / R
    const yy = baseY - depth + Math.round(depth * (1 - u * u)) * 1 // borde alto, centro bajo
    const top = baseY - 2 - Math.round(depth * u * u)
    void yy
    px(c, cx + i, top, '#f4f4f4')
    for (let k = 1; k <= 2; k++) px(c, cx + i, top + k, k === 1 ? '#d9c27a' : '#8a6f2a')
  }
  // aguja central (feed) con puntales
  const tipY = baseY - 2 - R
  line(c, cx, baseY - 2, cx, tipY, '#e0e0e0')
  line(c, cx - R, baseY - 2 - depth, cx, tipY + 2, '#9aa0ad')
  line(c, cx + R, baseY - 2 - depth, cx, tipY + 2, '#9aa0ad')
  if (needleTip) { px(c, cx, tipY - 1, Math.floor(t * 4) % 2 ? '#ff3b3b' : '#6a1a1a') }
}

export default function HangarCanvas({ chassisId, parts, lastInstall }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const live = useRef({ chassisId, parts, lastInstall })
  live.current = { chassisId, parts, lastInstall }

  useEffect(() => {
    const canvas = ref.current!
    const c = canvas.getContext('2d')!
    let W = 0, H = 0, raf = 0
    const t0 = performance.now()
    const resize = () => {
      const r = wrap.current!.getBoundingClientRect()
      const scale = Math.max(1, Math.min(4, Math.floor(r.height / 215)))
      W = Math.max(120, Math.floor(r.width / scale)); H = Math.max(120, Math.floor(r.height / scale))
      canvas.width = W; canvas.height = H
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap.current!)

    const frame = (now: number) => {
      const t = (now - t0) / 1000
      const { chassisId, parts, lastInstall } = live.current
      const ch = CHASSIS.find((x) => x.id === chassisId)!
      const g = CFG[chassisId]
      const q = (id: string) => parts[id] ?? 0

      // ===== Hangar =====
      rect(c, 0, 0, W, H, '#0d1020')
      for (let y = 0; y < H * 0.78; y += 12) for (let x = (y / 12) % 2 ? 0 : 12; x < W; x += 24) rect(c, x, y, 11, 11, '#121730')
      const wx = Math.round(W * 0.7), wy = 14, ww = Math.round(W * 0.24), wh = 36
      rect(c, wx - 2, wy - 2, ww + 4, wh + 4, '#000'); rect(c, wx, wy, ww, wh, '#050616')
      for (let i = 0; i < 24; i++) { const sx = (i * 37) % ww, sy = (i * 53) % wh; if ((i + Math.floor(t * 2)) % 7) px(c, wx + sx, wy + sy, '#fff') }
      circle(c, wx + ww - 10, wy + 12, 7, '#2f6ad8'); circle(c, wx + ww - 12, wy + 10, 3, '#3f9a4a')
      for (let i = 0; i < 5; i++) { const lx = Math.round((W / 5) * (i + 0.5)); rect(c, lx - 10, 0, 20, 3, '#ffd23f'); c.globalAlpha = 0.07; rect(c, lx - 18, 3, 36, H * 0.7, '#ffe9a0'); c.globalAlpha = 1 }
      const floorY = H - 14
      rect(c, 0, floorY, W, H - floorY, '#191e36'); rect(c, 0, floorY, W, 2, '#3a4472')
      for (let x = 0; x < W; x += 16) rect(c, x, floorY + 2, 1, H, '#232a4a')
      for (let x = 0; x < W; x += 32) rect(c, x, floorY, 16, 2, '#ffd23f')

      // ===== Geometría de la nave =====
      const cx = Math.round(W / 2)
      const fw = Math.max(g.fwMin, g.cols * 14 + 12)
      const fh = g.rows * 13 + 10
      const sw = fw + 16
      const bob = Math.round(Math.sin(t * 1.2) * 1.2)
      const yBellBot = floorY - 30 + bob
      const yBellTop = yBellBot - g.bellH
      const ySvcTop = yBellTop - g.serviceH
      const yFusTop = ySvcTop - fh
      const yNoseTop = yFusTop - g.noseH
      const fusMid = yFusTop + fh / 2

      // ===== Plataforma de sujeción =====
      rect(c, cx - 46, floorY - 12, 92, 4, '#000'); rect(c, cx - 45, floorY - 11, 90, 2, '#6b7285')
      rect(c, cx - 40, floorY - 8, 6, 8, '#3a4256'); rect(c, cx + 34, floorY - 8, 6, 8, '#3a4256')
      for (let i = 0; i < 90; i += 6) rect(c, cx - 45 + i, floorY - 12, 3, 1, '#ffd23f')
      for (const s of [-1, 1]) {
        const bx = cx + s * 40, ty = ySvcTop + g.serviceH * 0.6, tx = cx + s * (sw / 2 + 1)
        line(c, bx, floorY - 12, tx, ty, '#000', 4); line(c, bx, floorY - 12, tx, ty, i2(t) ? '#ffd23f' : '#e0b020', 2)
        rect(c, tx - (s > 0 ? 0 : 3), ty - 2, 3, 5, '#999')
      }

      // ===== Alas solares (detrás del casco) =====
      const wings: ('dep' | 'he')[] = [...Array(q('solar_he')).fill('he'), ...Array(q('solar_dep')).fill('dep')].slice(0, 2)
      wings.forEach((kind, i) => {
        const dir = (i === 0 ? 1 : -1) as 1 | -1
        const ax = cx + dir * (fw / 2)
        rect(c, dir === 1 ? ax : ax - 3, fusMid - 2, 3, 5, '#8a8f9c')
        if (g.xWings) {
          line(c, ax, fusMid, ax + dir * 6, fusMid - 10, '#8a8f9c', 2); line(c, ax, fusMid, ax + dir * 6, fusMid + 6, '#8a8f9c', 2)
          drawPanel(c, ax + dir * 5, fusMid - 10 - g.wingTh + 3, dir, g.wing, g.wingTh, -0.28, kind, t)
          drawPanel(c, ax + dir * 5, fusMid + 6, dir, g.wing, g.wingTh, 0.28, kind, t)
        } else {
          rect(c, ax + (dir === 1 ? 3 : -8), fusMid - 1, 5, 3, '#8a8f9c')
          drawPanel(c, ax + dir * 5, fusMid - Math.round(g.wingTh / 2), dir, g.wing, g.wingTh, 0, kind, t)
        }
      })

      // ===== Servicio: tanques esféricos + anillo =====
      for (const s of [-1, 1]) {
        const tcx = cx + s * (sw / 2 + g.tank - 1), tcy = ySvcTop + g.serviceH / 2
        rect(c, cx + s * (sw / 2 - 2) - (s > 0 ? 0 : 4), tcy - 1, 5, 3, '#6b7285')
        circle(c, tcx, tcy, g.tank + 1, '#000'); circle(c, tcx, tcy, g.tank, '#aeb6c8')
        circle(c, tcx + 1, tcy + 1, g.tank - 2, '#8790a6'); px(c, tcx - 2, tcy - 2, '#fff'); px(c, tcx - 1, tcy - 2, '#fff')
        rect(c, tcx - g.tank, tcy, g.tank * 2 + 1, 1, '#4a5166')
      }
      octagon(c, cx - sw / 2 - 1, ySvcTop - 1, sw + 2, g.serviceH + 2, 5, '#000')
      octagon(c, cx - sw / 2, ySvcTop, sw, g.serviceH, 4, '#6b7285')
      octagon(c, cx - sw / 2 + 2, ySvcTop + 2, sw - 4, g.serviceH - 4, 3, '#464d63')
      rect(c, cx - sw / 2 + 4, ySvcTop + 1, sw - 8, 1, '#cfd6e4')
      for (let b = 1; b <= g.bands + 1; b++) rect(c, cx - sw / 2 + 2, ySvcTop + Math.round((g.serviceH * b) / (g.bands + 2)), sw - 4, 1, '#252b3b')
      for (let x = cx - sw / 2 + 6; x < cx + sw / 2 - 4; x += 8) { px(c, x, ySvcTop + 3, ((x + Math.floor(t * 2)) % 3) ? '#ffd23f' : '#6a5410'); px(c, x, ySvcTop + g.serviceH - 4, '#9aa0ad') }

      // propulsión
      const hasIon = q('th_ion') > 0, hasMono = q('th_mono') > 0, hasCold = q('th_cold') > 0
      const thrusting = hasIon || hasMono || hasCold
      const fire: [string, string] = hasIon ? ['#5ef0ff', '#d8fbff'] : hasMono ? ['#ff9f43', '#ffd23f'] : ['#cfd8ff', '#ffffff']
      const flick = Math.floor(t * 22) % 2
      // toberas auxiliares
      for (let i = 0; i < g.aux; i++) {
        const side = i % 2 === 0 ? -1 : 1, ring = Math.floor(i / 2)
        const nx = cx + side * (sw / 2 - 4 - ring * 9)
        const ny = ySvcTop + g.serviceH
        rect(c, nx - 3, ny, 6, 1, '#000'); rect(c, nx - 2, ny + 1, 4, 3, '#000'); rect(c, nx - 1, ny + 1, 2, 2, '#9aa0ad')
        if (thrusting) for (let k = 0; k < 6; k++) rect(c, nx - 1 + (k > 3 ? 0 : 0), ny + 4 + k, 2 - (k > 3 ? 1 : 0), 1, fire[(k + flick) % 2])
      }
      // campana principal
      for (let j = 0; j < g.bellH; j++) {
        const w = Math.round(g.bellTop + ((g.bellBot - g.bellTop) * j) / (g.bellH - 1))
        rect(c, cx - w / 2 - 1, yBellTop + j, w + 2, 1, '#000')
        rect(c, cx - w / 2, yBellTop + j, w, 1, j > g.bellH - 4 ? '#c0c6d4' : '#6b7285')
        if (j > 2) rect(c, cx - w / 2 + 2, yBellTop + j, w - 4, 1, j > g.bellH - 5 ? '#1a1d27' : '#3a4256')
      }
      rect(c, cx - g.bellBot / 2 - 1, yBellBot - 1, g.bellBot + 2, 1, '#e8edf7')
      if (thrusting) {
        const len = hasIon || hasMono ? 15 : 8
        if (hasIon) { c.globalAlpha = 0.18 + 0.06 * flick; circle(c, cx, yBellBot + 6, g.bellBot * 0.7, '#5ef0ff'); c.globalAlpha = 1 }
        for (let k = 0; k < len; k++) {
          const w = Math.max(1, Math.round(g.bellBot * 0.8 * (1 - k / len)))
          rect(c, cx - w / 2, yBellBot + k, w, 1, fire[(k + flick) % 2])
        }
      }

      // ===== Fuselaje octogonal =====
      const fx = cx - fw / 2
      const slotList: { id: string; first: boolean }[] = []
      for (const cat of ['instrument', 'antenna', 'adcs', 'battery', 'thruster'])
        for (const [id, n] of Object.entries(parts)) {
          const p = PART_BY_ID[id]
          if (p.cat !== cat || n <= 0) continue
          for (let k = 0; k < n; k++) for (let s = 0; s < p.slots; s++) slotList.push({ id, first: s === 0 })
        }
      const total = g.cols * g.rows
      // aletas estructurales (superior e inferior) con paneles fijos
      const fins = [[1, 1], [-1, 1], [1, 0], [-1, 0]] // [lado, inferior?]
      fins.forEach(([s, low], i) => {
        const fyy = low ? yFusTop + fh - 22 : yFusTop + 8
        const fxx = s > 0 ? cx + fw / 2 - 1 : cx - fw / 2 - 7
        rect(c, fxx - 1, fyy - 1, 9, 16, '#000'); rect(c, fxx, fyy, 7, 14, '#5b6785'); rect(c, fxx, fyy, 7, 1, '#aab4cf')
        if (i < q('solar_fix')) { rect(c, fxx + 1, fyy + 2, 5, 10, '#2a5cff'); for (let k = 0; k < 10; k += 3) rect(c, fxx + 1, fyy + 2 + k, 5, 1, '#0b1f6a'); px(c, fxx + 2, fyy + 3, '#fff') }
        else for (let k = 2; k < 12; k += 4) px(c, fxx + 3, fyy + k, '#cfd6e4')
      })
      // luces de navegación
      const blink = Math.floor(t * 1.5) % 2
      px(c, cx - fw / 2 - 7, yFusTop + fh - 8, blink ? '#ff3b3b' : '#5a1414'); rect(c, cx - fw / 2 - 8, yFusTop + fh - 8, 1, 1, blink ? '#ff9a9a' : '#000')
      px(c, cx + fw / 2 + 6, yFusTop + fh - 8, !blink ? '#4dff88' : '#14502a')

      // blindajes: se dibujan detrás como armadura que envuelve el casco
      const overflow = slotList.length > total
      if (overflow) { c.globalAlpha = 0.5 + 0.4 * Math.sin(t * 10); octagon(c, fx - 4, yFusTop - 4, fw + 8, fh + 8, 10, '#ff2b2b'); c.globalAlpha = 1 }
      for (let k = q('sh_ta') * 2; k >= 1; k--) octagon(c, fx - 1 - k, yFusTop - 1 - k, fw + 2 + 2 * k, fh + 2 + 2 * k, 6 + k, k % 2 ? '#ffd23f' : '#b98a14')
      for (let k = q('sh_al'); k >= 1; k--) octagon(c, fx - 1 - k, yFusTop - 1 - k, fw + 2 + 2 * k, fh + 2 + 2 * k, 6 + k, k % 2 ? '#e5ebf7' : '#aab4cf')
      octagon(c, fx - 1, yFusTop - 1, fw + 2, fh + 2, 7, '#000')
      octagon(c, fx, yFusTop, fw, fh, 6, '#8590a8')
      octagon(c, fx + 2, yFusTop + 2, fw - 4, fh - 4, 5, '#2b3248')
      rect(c, fx + 6, yFusTop + 1, fw - 12, 1, '#e0e6f5'); rect(c, fx + 1, yFusTop + 6, 1, fh - 12, '#cfd6e4')
      rect(c, fx + fw - 2, yFusTop + 6, 1, fh - 12, '#4a5166'); rect(c, fx + 6, yFusTop + fh - 2, fw - 12, 1, '#4a5166')
      for (const [rx, ry] of [[5, 5], [fw - 6, 5], [5, fh - 6], [fw - 6, fh - 6]]) px(c, fx + rx, yFusTop + ry, '#dfe6f7')
      // Kapton MLI dorado
      if (q('sh_mli')) {
        for (let i = 0; i < fw - 14; i += 2) {
          const col = (i / 2) % 2 ? '#e8a317' : '#ffd34d'
          rect(c, fx + 7 + i, yFusTop + 2, 2, 3, col); rect(c, fx + 7 + i, yFusTop + fh - 5, 2, 3, col)
        }
        for (let j = 0; j < 7; j++) { rect(c, fx + 1 + j, yFusTop + 6 - j > 0 ? yFusTop + 6 - j : yFusTop, 1, 1, '#ffd34d'); rect(c, fx + fw - 2 - j, yFusTop + 6 - j, 1, 1, '#e8a317') }
      }
      if (q('sh_ta')) {
        const gl = Math.floor((t * 22) % (fh + 30)) - 10
        if (gl >= 0 && gl < fh) { c.globalAlpha = 0.8; line(c, fx - 2, yFusTop + gl, fx + 4, yFusTop + gl - 4, '#fff'); c.globalAlpha = 1 }
      }
      // bahías (slots) integradas
      const bx0 = Math.round(cx - (g.cols * 14 - 2) / 2), by0 = yFusTop + 5
      for (let i = 0; i < total; i++) {
        drawBay(c, slotList[i]?.id ?? null, slotList[i]?.first ?? false, bx0 + (i % g.cols) * 14, by0 + Math.floor(i / g.cols) * 13, t)
      }

      // ===== Nariz escalonada + cúpula =====
      const stepH = Math.round(g.noseH / 3)
      const ws = [fw * 0.5, fw * 0.74, fw * 0.96].map((w) => Math.round(w / 2) * 2)
      for (let s = 0; s < 3; s++) {
        const yy = yNoseTop + s * stepH, h = s === 2 ? g.noseH - 2 * stepH : stepH
        rect(c, cx - ws[s] / 2 - 1, yy - 1, ws[s] + 2, h + 1, '#000')
        rect(c, cx - ws[s] / 2, yy, ws[s], h, '#7d869c')
        rect(c, cx - ws[s] / 2, yy, ws[s], 1, '#d6ddef'); rect(c, cx - ws[s] / 2, yy, 1, h, '#b4bccf'); rect(c, cx + ws[s] / 2 - 1, yy, 1, h, '#4a5166')
        rect(c, cx - ws[s] / 2 + 2, yy + h - 2, ws[s] - 4, 1, '#d4a017') // anillo de acoplamiento dorado
        for (let x = cx - ws[s] / 2 + 3; x < cx + ws[s] / 2 - 2; x += 5) px(c, x, yy + 2, '#2b3248')
      }
      // cúpula de sensores
      const dR = g.domeR
      for (let j = 0; j < dR; j++) {
        const w = Math.round(Math.sqrt(dR * dR - (dR - j) * (dR - j)) * 2)
        rect(c, cx - w / 2 - 1, yNoseTop - dR + j, w + 2, 1, '#000')
        rect(c, cx - w / 2, yNoseTop - dR + j, w, 1, j < dR / 2 ? '#8be8ff' : '#2a8fb8')
      }
      px(c, cx - 3, yNoseTop - dR + 3, '#fff'); px(c, cx - 2, yNoseTop - dR + 3, '#fff'); px(c, cx - 3, yNoseTop - dR + 4, '#fff')
      px(c, cx, yNoseTop - dR - 1, Math.floor(t * 2) % 2 ? '#5ef0ff' : '#14505e') // luz cian

      // Telescopio / cámara frontal
      if (q('cam') || q('corona')) {
        const lx = cx - ws[0] / 2 - 1, ly = yNoseTop + 3, len = q('corona') ? 16 : 10
        rect(c, lx - len - 1, ly - 1, len + 1, 8, '#000'); rect(c, lx - len, ly, len, 6, '#4a5166'); rect(c, lx - len, ly, len, 1, '#aab4cf')
        circle(c, lx - len, ly + 3, 3, '#000'); circle(c, lx - len, ly + 3, 2, q('corona') ? '#ffd23f' : '#5ef0ff'); px(c, lx - len - 1, ly + 2, '#fff')
      }
      // Antenas
      const mY = yNoseTop - dR
      if (q('uhf')) { const ax = cx + dR - 2; rect(c, ax, mY - 22, 1, 24, '#ddd'); px(c, ax, mY - 23, Math.floor(t * 3) % 2 ? '#ff5555' : '#601a1a') }
      if (q('spatch')) { const ax = cx - dR - 4; rect(c, ax - 6, yNoseTop - 6, 13, 4, '#000'); rect(c, ax - 5, yNoseTop - 5, 11, 2, '#d4a017'); rect(c, ax, yNoseTop - 2, 1, 4, '#999') }
      if (q('iris')) { const ax = cx + dR + 7; rect(c, ax, yNoseTop - 8, 2, 12, '#aaa'); drawDish(c, ax, yNoseTop - 10, 7, true, t) }
      if (q('hga')) drawDish(c, cx, mY - 6, g.dishR, true, t)

      // ===== Construcción viva =====
      const age = lastInstall ? performance.now() - lastInstall.at : 99999
      const active = age < 1100
      const seed = lastInstall ? Math.abs(Math.sin(lastInstall.at * 0.013)) : 0.5
      const ty = yNoseTop + g.noseH + fh * (0.1 + 0.8 * seed)
      const tx = fx - 2
      const ax = Math.round(Math.max(18, W * 0.1)), ay = 0
      const hx0 = active ? tx : tx - 34 + Math.sin(t * 0.8) * 4
      const hy0 = active ? ty : yFusTop + fh * 0.4 + Math.sin(t * 1.3) * 8
      const dist = Math.hypot(hx0 - ax, hy0 - ay)
      const L = Math.max(60, dist * 0.62)
      const d = Math.min(dist, 2 * L - 1)
      const a = Math.atan2(hy0 - ay, hx0 - ax)
      const ang = a + Math.acos(Math.min(1, d / (2 * L)))
      const ex = ax + Math.cos(ang) * L, ey = ay + Math.sin(ang) * L
      const hx = ax + Math.cos(a) * d, hy = ay + Math.sin(a) * d
      rect(c, ax - 7, 0, 14, 5, '#555'); rect(c, ax - 5, 0, 10, 3, '#888')
      line(c, ax, ay + 2, ex, ey, '#000', 5); line(c, ax, ay + 2, ex, ey, '#f0b020', 3)
      line(c, ex, ey, hx, hy, '#000', 5); line(c, ex, ey, hx, hy, '#d89a18', 3)
      for (let k = 1; k < 5; k++) px(c, ax + (ex - ax) * (k / 5), ay + 2 + (ey - ay - 2) * (k / 5), '#7a5408')
      circle(c, ex, ey, 3, '#222'); px(c, ex, ey, '#ffd23f'); circle(c, hx, hy, 2, '#ddd')
      if (active) {
        const k = 1 - age / 1100
        // rayo láser de soldadura (breve)
        if (age < 650) {
          const f = Math.floor(t * 40) % 2
          line(c, hx, hy, tx + 1, ty, f ? '#ff3b3b' : '#ff9a9a', 2)
          line(c, hx, hy, tx + 1, ty, '#fff', 1)
        }
        for (let i = 0; i < 14; i++) {
          const r = Math.random() * 9, th = Math.random() * 6.28
          px(c, tx + Math.cos(th) * r, ty + Math.sin(th) * r, Math.random() > 0.5 ? '#fff' : Math.random() > 0.5 ? '#ffd23f' : '#ff8a3d')
        }
        c.globalAlpha = 0.45 * k; circle(c, tx + 2, ty, 7, '#fff'); c.globalAlpha = 1
        c.globalAlpha = 0.18 * k; octagon(c, fx, yFusTop, fw, fh, 6, '#5ef0ff'); c.globalAlpha = 1
        for (let i = 0; i < 10; i++) px(c, fx - 6 + Math.random() * (fw + 12), yFusTop - 6 + Math.random() * (fh + 12), '#5ef0ff')
      }

      void ch
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <div ref={wrap} className="relative w-full h-full" style={{ border: '4px solid #000', boxShadow: 'inset 0 0 0 2px #3a4472' }}>
      <canvas ref={ref} className="absolute inset-0 w-full h-full" style={{ imageRendering: 'pixelated' }} />
      <div className="ui-meta absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-black/75 text-yellow-200 whitespace-nowrap font-pixel pointer-events-none">
        {CFG[chassisId].name}
      </div>
    </div>
  )
}

const i2 = (t: number) => Math.floor(t * 2) % 2 === 0
