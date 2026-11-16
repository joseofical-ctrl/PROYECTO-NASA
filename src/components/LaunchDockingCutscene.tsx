import { useCallback, useEffect, useRef, useState } from 'react'
import { isMusicOn, setMusic } from '../audio'

interface Props {
  onComplete: () => void
  onBackToWorkshop?: () => void
}

// ============================================================================
// CONSTANTES EXACTAS DE LOS DOS ARCHIVOS ORIGINALES (240x135)
// ============================================================================
const W = 240
const H = 135
const G = 122
const CX = 120
const TOP0 = G - 69
const IGN = 4.5
const LIFT = 7
const SEP = 260

// Gradiente de cielo exacto de Despegue pixelado_2.html
const K: [number, [number, number, number], [number, number, number]][] = [
  [0, [42, 47, 107], [255, 154, 92]],
  [0.3, [63, 134, 196], [169, 212, 234]],
  [1, [2, 2, 12], [12, 16, 48]],
]

// Constantes exactas de Misión Águila · Acoplamiento (2)_2.html
const D = '#0a0714'
const RIM: [number, number, number][] = [
  [120, 230, 255],
  [255, 150, 60],
  [255, 196, 92],
  [255, 105, 70],
]
const NAMES = ['ALPACA', 'SERPIENTE', 'PUMA', 'CONDOR'] as const

interface Puff {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  a: number
  m: number
  hot: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const rgb = (c: [number, number, number]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`

function pal(k: number): [[number, number, number], [number, number, number]] {
  const kk = clamp(k, 0, 1)
  let i = 0
  while (i < K.length - 2 && kk > K[i + 1][0]) i++
  const [k0, t0, b0] = K[i]
  const [k1, t1, b1] = K[i + 1]
  const u = clamp((kk - k0) / (k1 - k0 || 1), 0, 1)
  return [
    [lerp(t0[0], t1[0], u), lerp(t0[1], t1[1], u), lerp(t0[2], t1[2], u)],
    [lerp(b0[0], b1[0], u), lerp(b0[1], b1[1], u), lerp(b0[2], b1[2], u)],
  ]
}

export default function LaunchDockingCutscene({ onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [topLeft, setTopLeft] = useState('EAGLE MISSION · TELEMETRY')
  const [topRight, setTopRight] = useState('T-00:07')
  const [botLeft, setBotLeft] = useState('PAD LC-39A · SYSTEMS NOMINAL')
  const [botRight, setBotRight] = useState('ALT 0.0 KM · VEL 0 M/S')
  const [bigText, setBigText] = useState('EAGLE MISSION')
  const [subText, setSubText] = useState('ORBITAL LAUNCH')
  const [bigScale, setBigScale] = useState(1)
  const [showEndBtn, setShowEndBtn] = useState(false)

  const phaseRef = useRef<'launch' | 'docking'>('launch')
  const t0Ref = useRef<number>(0)
  const puffsRef = useRef<Puff[]>([])
  const cuesRef = useRef<Set<string>>(new Set())

  // Web Audio nodes
  const acRef = useRef<AudioContext | null>(null)
  const noiseGainRef = useRef<GainNode | null>(null)
  const noiseFilterRef = useRef<BiquadFilterNode | null>(null)

  // Pause background chiptune music while cutscene runs
  useEffect(() => {
    const wasOn = isMusicOn()
    if (wasOn) setMusic(false)
    return () => {
      if (wasOn) setMusic(true)
    }
  }, [])

  const initAudio = useCallback((mode: 'launch' | 'docking') => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!acRef.current) {
      const ac = new AudioCtx()
      acRef.current = ac

      const len = ac.sampleRate * 2
      const buf = ac.createBuffer(1, len, ac.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1
      }
      const src = ac.createBufferSource()
      src.buffer = buf
      src.loop = true

      const flt = ac.createBiquadFilter()
      const gn = ac.createGain()
      gn.gain.value = 0.0001

      src.connect(flt)
      flt.connect(gn)
      gn.connect(ac.destination)
      src.start()

      noiseFilterRef.current = flt
      noiseGainRef.current = gn
    }

    if (acRef.current.state === 'suspended') {
      void acRef.current.resume()
    }

    const flt = noiseFilterRef.current
    const gn = noiseGainRef.current
    if (flt && gn && acRef.current) {
      const now = acRef.current.currentTime
      if (mode === 'launch') {
        flt.type = 'lowpass'
        flt.frequency.setValueAtTime(180, now)
        gn.gain.setValueAtTime(0.0001, now)
      } else {
        flt.type = 'bandpass'
        flt.frequency.setValueAtTime(1400, now)
        flt.Q.setValueAtTime(2.2, now)
        gn.gain.setValueAtTime(0.0001, now)
      }
    }
  }, [])

  const tn = useCallback(
    (
      f: number,
      dur = 0.12,
      type: OscillatorType = 'square',
      vol = 0.1,
      f2?: number
    ) => {
      const ac = acRef.current
      if (!ac) return
      if (ac.state === 'suspended') void ac.resume()
      const now = ac.currentTime
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.type = type
      o.frequency.setValueAtTime(f, now)
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur)
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(vol, now + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
      o.connect(g)
      g.connect(ac.destination)
      o.start(now)
      o.stop(now + dur + 0.02)
    },
    []
  )

  const once = useCallback((key: string, fn: () => void) => {
    if (!cuesRef.current.has(key)) {
      cuesRef.current.add(key)
      fn()
    }
  }, [])

  const startDockingPhase = useCallback(() => {
    phaseRef.current = 'docking'
    t0Ref.current = performance.now()
    cuesRef.current.clear()
    puffsRef.current = []
    setShowEndBtn(false)
    setBigScale(1)
    initAudio('docking')
  }, [initAudio])

  const restartAll = useCallback(() => {
    phaseRef.current = 'launch'
    t0Ref.current = performance.now()
    cuesRef.current.clear()
    puffsRef.current = []
    setShowEndBtn(false)
    setBigScale(1)
    initAudio('launch')
  }, [initAudio])

  const handleSkip = () => {
    if (phaseRef.current === 'launch') {
      startDockingPhase()
    } else {
      onComplete()
    }
  }

  useEffect(() => {
    initAudio('launch')
    t0Ref.current = performance.now()

    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    ctx.imageSmoothingEnabled = false

    // Deterministic stars & clouds matching the original HTML files
    const stars = Array.from({ length: 90 }, (_, i) => ({
      x: (i * 73 + 19) % W,
      y: (i * 41 + 7) % H,
      s: i % 3,
      p: (i * 1.7) % 6.28,
    }))

    const clouds = [
      { x: 18, y: 34, w: 38, h: 7, v: 0.7 },
      { x: 158, y: 24, w: 44, h: 8, v: 0.85 },
      { x: 46, y: 62, w: 32, h: 6, v: 0.55 },
      { x: 176, y: 54, w: 36, h: 7, v: 0.65 },
    ]

    const R = (x: number, y: number, w: number, h: number, col: string) => {
      ctx.fillStyle = col
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
    }

    const disc = (cx: number, cy: number, r: number, col: string) => {
      ctx.fillStyle = col
      const rr = r * r
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= rr + 0.3) {
            ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1)
          }
        }
      }
    }

    const ring = (cx: number, cy: number, r: number, col: string) => {
      ctx.fillStyle = col
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const d2 = dx * dx + dy * dy
          if (d2 <= r * r + 0.5 && d2 >= (r - 1.2) * (r - 1.2)) {
            ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1)
          }
        }
      }
    }

    // ========================================================================
    // PARTE 1: FUNCIONES EXACTAS DE `Despegue pixelado_2.html`
    // ========================================================================
    const fire = (sx: number, w: number, L: number, yb: number) => {
      if (L <= 0) return
      for (let j = 0; j < L; j++) {
        const p = j / L
        const jx = (Math.random() - 0.5) * (1.5 + p * 2.5)
        const cw = Math.max(1, Math.round(w * (1 - p * 0.55)))
        const x0 = Math.round(sx - cw / 2 + jx)
        const y0 = Math.round(yb + j)
        R(x0 - 1, y0, cw + 2, 1, p < 0.4 ? '#ff5a1f' : '#c82814')
        R(x0, y0, cw, 1, p < 0.65 ? '#ff9a3c' : '#ff5a1f')
        if (cw >= 3 && p < 0.75) {
          R(x0 + 1, y0, cw - 2, 1, p < 0.35 ? '#fff9d6' : '#ffd24a')
        }
      }
    }

    const srb = (sx: number, y: number) => {
      // Cono superior escalonado
      R(sx + 2, y, 1, 2, '#eef2fa')
      R(sx + 1, y + 2, 3, 3, '#eef2fa')
      R(sx, y + 5, 5, 48, '#dde4f2')
      R(sx + 1, y + 5, 2, 48, '#ffffff')
      R(sx + 4, y + 5, 1, 48, '#9aa5be')
      // Bandas rojas/grises
      R(sx, y + 12, 5, 2, '#b04a3a')
      R(sx, y + 26, 5, 1, '#7c879e')
      R(sx, y + 40, 5, 1, '#7c879e')
      // Tobera inferior
      R(sx - 1, y + 53, 7, 3, '#4a5268')
      R(sx - 2, y + 56, 9, 2, '#2b3040')
    }

    const shuttle = (top: number, fl: number, on: boolean, attachSrb: boolean) => {
      // Tanque externo naranja (ET)
      R(CX - 5, top, 10, 4, '#c95b2b')
      R(CX - 3, top - 3, 6, 3, '#c95b2b')
      R(CX - 1, top - 5, 2, 2, '#e07845')
      R(CX - 7, top + 4, 14, 52, '#c95b2b')
      R(CX - 5, top + 4, 4, 52, '#e07845')
      R(CX + 4, top + 4, 3, 52, '#8f3b18')
      R(CX - 5, top + 56, 10, 2, '#8f3b18')

      // SRBs acoplados
      if (attachSrb) {
        srb(CX - 12, top + 8)
        srb(CX + 7, top + 8)
      }

      // Orbitador / Alas delta
      const oy = top + 14
      for (let r = 0; r < 22; r++) {
        const span = Math.min(18, Math.round(4 + r * 0.72))
        R(CX - span, oy + 20 + r, span * 2, 1, '#1c1e2a')
        R(CX - span + 1, oy + 20 + r, span * 2 - 2, 1, '#e6ebf5')
      }
      // Fuselaje central del orbitador
      R(CX - 4, oy + 4, 8, 38, '#f3f6fc')
      R(CX - 3, oy + 4, 3, 38, '#ffffff')
      R(CX - 3, oy + 1, 6, 3, '#e6ebf5')
      R(CX - 2, oy - 1, 4, 2, '#1c1e2a') // nariz térmica negra
      // Ventanilla de cabina
      R(CX - 3, oy + 5, 6, 2, '#1c1e2a')
      R(CX - 2, oy + 5, 2, 1, '#5ec8ff')
      R(CX + 1, oy + 5, 2, 1, '#5ec8ff')
      // Estabilizador vertical y motores OMS
      R(CX - 1, oy + 28, 2, 14, '#cfd7e6')
      R(CX - 4, oy + 42, 3, 3, '#2b3040')
      R(CX + 1, oy + 42, 3, 3, '#2b3040')

      if (on) {
        fire(CX, 6, fl, oy + 45)
        if (attachSrb) {
          fire(CX - 10, 7, fl + 6, top + 66)
          fire(CX + 9, 7, fl + 6, top + 66)
        }
      }
    }

    // ========================================================================
    // PARTE 2: FUNCIONES EXACTAS DE `Misión Águila · Acoplamiento (2)_2.html`
    // ========================================================================
    const tank = (top: number) => {
      R(-4, top - 4, 8, 2, '#c95b2b')
      R(-6, top - 2, 12, 3, '#c95b2b')
      R(-7, top + 1, 14, 44, '#c95b2b')
      R(-5, top + 1, 4, 44, '#e07845')
      R(4, top + 1, 3, 44, '#8f3b18')
      R(-5, top + 45, 10, 2, '#8f3b18')
    }

    const orbiter = (top: number) => {
      const oy = top + 6
      for (let r = 0; r < 18; r++) {
        const span = Math.min(15, Math.round(4 + r * 0.65))
        R(-span, oy + 14 + r, span * 2, 1, '#1c1e2a')
        R(-span + 1, oy + 14 + r, span * 2 - 2, 1, '#e6ebf5')
      }
      R(-4, oy, 8, 32, '#f3f6fc')
      R(-3, oy, 3, 32, '#ffffff')
      R(-3, oy - 3, 6, 3, '#e6ebf5')
      R(-2, oy - 5, 4, 2, '#1c1e2a')
      R(-3, oy + 2, 6, 2, '#1c1e2a')
      R(-2, oy + 2, 4, 1, '#5ec8ff')
      R(-1, oy + 20, 2, 12, '#cfd7e6')
      R(-3, oy + 32, 6, 2, '#2b3040')
    }

    const station = (d: number) => {
      const sx = 186
      const sy = 56
      // Paneles solares superiores e inferiores
      for (const dir of [-1, 1]) {
        const py = dir < 0 ? sy - 44 : sy + 10
        R(sx - 10, py, 12, 34, '#1b3b82')
        R(sx + 6, py, 12, 34, '#1b3b82')
        for (let r = 2; r < 34; r += 5) {
          R(sx - 10, py + r, 12, 1, '#4ea3ff')
          R(sx + 6, py + r, 12, 1, '#4ea3ff')
        }
        R(sx - 4, dir < 0 ? sy - 10 : sy + 6, 2, 4, '#9aa5be')
        R(sx + 12, dir < 0 ? sy - 10 : sy + 6, 2, 4, '#9aa5be')
      }
      // Cuerpo presurizado de la estación
      R(sx - 24, sy - 7, 50, 14, '#cfd7e6')
      R(sx - 24, sy - 5, 50, 4, '#ffffff')
      R(sx - 24, sy + 4, 50, 3, '#8a95ad')
      R(sx - 12, sy - 9, 18, 18, '#dde4f2')
      R(sx - 8, sy - 3, 4, 4, '#5ec8ff')
      R(sx + 2, sy - 3, 4, 4, '#5ec8ff')

      // Extensión del tubo de acople en d > 5.5
      const ext = clamp((d - 5.5) / 2.2, 0, 1)
      const tubeLen = Math.round(6 + ext * 12)
      R(sx - 24 - tubeLen, sy - 4, tubeLen, 8, '#7c879e')
      R(sx - 24 - tubeLen, sy - 2, tubeLen, 3, '#cfd7e6')
      R(sx - 26 - tubeLen, sy - 5, 2, 10, '#4a5268')

      // Luz baliza de acople
      const blink = Math.floor(d * 4) % 2 === 0
      R(sx - 25 - tubeLen, sy - 7, 2, 2, blink ? '#55ff99' : '#1b4d30')
    }

    const pos = (d: number) => {
      // Aproximación horizontal -> giro a vertical en d=5..7.2 -> contacto en d=8.5
      const pApproach = clamp(d / 8.5, 0, 1)
      const ease = 1 - Math.pow(1 - pApproach, 1.8)
      const x = lerp(62, 142, ease)
      const y = lerp(58, 56, ease)
      const rotP = clamp((d - 5) / 2.2, 0, 1)
      const smoothRot = rotP * rotP * (3 - 2 * rotP)
      // De horizontal apuntando a la derecha (Math.PI / 2) a vertical (0)
      const ang = lerp(Math.PI / 2, 0, smoothRot)
      return { x, y, ang }
    }

    const space = (d: number) => {
      R(0, 0, W, H, '#03040c')
      for (const s of stars) {
        const b = 0.5 + 0.5 * Math.sin(d * 2.5 + s.p)
        if (b > 0.25) {
          R(s.x, s.y, 1, 1, s.s === 2 ? '#ffd88a' : s.s === 1 ? '#cfe4ff' : '#7d8bb0')
        }
      }

      // Curvatura de la Tierra abajo
      for (let x = 0; x < W; x++) {
        const dx = (x - CX) / 150
        const ey = Math.round(114 + dx * dx * 22)
        R(x, ey - 2, 1, 2, '#5ec8ff')
        R(x, ey, 1, H - ey, '#1a4ba6')
        if (((x + Math.floor(d * 3)) % 34) < 12 && ey + 3 < H) {
          R(x, ey + 3, 1, H - ey - 3, '#2c7a52')
        }
      }

      // Separación del tanque naranja en d >= 3
      const { x, y, ang } = pos(d)
      if (d < 3) {
        ctx.save()
        ctx.translate(Math.round(x), Math.round(y))
        ctx.rotate(ang)
        tank(-18)
        orbiter(-18)
        ctx.restore()
      } else {
        const dtSep = d - 3
        const tx = x - dtSep * 10
        const ty = y + 10 + dtSep * dtSep * 2.4
        if (ty < H + 30) {
          ctx.save()
          ctx.translate(Math.round(tx), Math.round(ty))
          ctx.rotate(Math.PI / 2 + dtSep * 0.18)
          tank(-18)
          ctx.restore()
        }

        ctx.save()
        ctx.translate(Math.round(x), Math.round(y))
        ctx.rotate(ang)
        orbiter(-18)
        ctx.restore()
      }

      // Chispas blancas de maniobra RCS
      if ((d > 3 && d < 3.6) || (d > 5 && d < 7.2) || (d > 7.4 && d < 8.4)) {
        if (Math.floor(d * 24) % 2 === 0) {
          R(x + 6, y - 14, 3, 1, '#ffffff')
          R(x - 8, y + 12, 3, 1, '#ffffff')
        }
      }

      station(d)

      // Flash de acoplamiento en d = 8.5
      if (d >= 8.5 && d < 9.1) {
        const a = 1 - (d - 8.5) / 0.6
        ctx.fillStyle = `rgba(255,245,210,${a * 0.75})`
        ctx.fillRect(0, 0, W, H)
      }
    }

    /** Dibuja la silueta/forma del tripulante `i` en `(px, oy)` con fase de paso `ph` */
    const who = (i: number, px: number, ph: number, oy: number, col: string) => {
      const s1 = Math.round(Math.sin(ph) * 2.5)
      const s2 = Math.round(Math.sin(ph + Math.PI) * 2.5)

      if (i === 0) {
        // ALPACA: orejas largas, cuello estilizado, casco, piernas
        R(px - 3, oy - 31, 2, 5, col)
        R(px + 1, oy - 31, 2, 5, col)
        disc(px, oy - 23, 4, col)
        R(px - 2, oy - 19, 4, 6, col)
        R(px - 5, oy - 14, 10, 9, col)
        R(px - 3, oy - 5, 2, 5 + s1, col)
        R(px + 1, oy - 5, 2, 5 + s2, col)
      } else if (i === 1) {
        // SERPIENTE: cuerpo sinuoso en S + cabeza con casco
        const wv = Math.round(Math.sin(ph * 1.5) * 2)
        disc(px, oy - 22, 4, col)
        R(px - 2 + wv, oy - 18, 4, 6, col)
        R(px - 4 - wv, oy - 12, 8, 5, col)
        R(px - 6, oy - 7, 11, 4, col)
        R(px - 8 + wv, oy - 3, 14, 3, col)
      } else if (i === 2) {
        // PUMA: orejas felinas redondeadas, torso atlético, cola curva
        const tw = Math.round(Math.sin(ph) * 1.5)
        R(px - 4, oy - 27, 2, 2, col)
        R(px + 2, oy - 27, 2, 2, col)
        disc(px, oy - 22, 4, col)
        R(px - 5, oy - 17, 10, 11, col)
        R(px - 9, oy - 12 + tw, 4, 2, col)
        R(px - 10, oy - 14 + tw, 2, 2, col)
        R(px - 3, oy - 6, 2, 6 + s1, col)
        R(px + 1, oy - 6, 2, 6 + s2, col)
      } else {
        // CÓNDOR: cresta, gran envergadura de alas/capa, collarín y piernas
        const wf = Math.round(Math.sin(ph) * 1.5)
        R(px - 2, oy - 28, 4, 2, col)
        disc(px, oy - 23, 4, col)
        R(px - 9, oy - 16 + wf, 18, 6, col)
        R(px - 5, oy - 17, 10, 11, col)
        R(px - 3, oy - 6, 2, 6 + s1, col)
        R(px + 1, oy - 6, 2, 6 + s2, col)
      }
    }

    const crew = (i: number, px: number, ph: number) => {
      const floorY = 104
      const bob = Math.abs(Math.sin(ph)) * 1.2
      const oy = Math.round(floorY - bob)
      const rim = RIM[i]
      const rimStr = rgb(rim)

      // 1) Halo radial suave detrás del tripulante
      const grad = ctx.createRadialGradient(px, oy - 14, 2, px, oy - 14, 22)
      grad.addColorStop(0, `rgba(${rim[0]},${rim[1]},${rim[2]},0.32)`)
      grad.addColorStop(1, `rgba(${rim[0]},${rim[1]},${rim[2]},0)`)
      ctx.fillStyle = grad
      ctx.fillRect(px - 24, oy - 38, 48, 44)

      // 2) Reflejo invertido en el suelo (scale(1, -1) con globalAlpha = 0.2)
      ctx.save()
      ctx.translate(0, floorY * 2)
      ctx.scale(1, -1)
      ctx.globalAlpha = 0.2
      who(i, px, ph, oy, rimStr)
      who(i, px, ph, oy, D)
      ctx.restore()

      // 3) Borde de luz RIM[i] + silueta D + anillo de casco
      who(i, px - 1, ph, oy, rimStr)
      who(i, px + 1, ph, oy, rimStr)
      who(i, px, ph, oy - 1, rimStr)
      who(i, px, ph, oy, D)
      ring(px, oy - (i === 0 || i === 3 ? 23 : 22), 5, rimStr)
      R(px + 1, oy - 24, 2, 1, rimStr)
    }

    const tunnel = (d: number) => {
      // Pasillo púrpura #0d0b22 con columnas #17133a, ventanas con estrellas y reflejo en el piso
      R(0, 0, W, H, '#0d0b22')
      R(0, 0, W, 22, '#17133a')
      R(0, 22, W, 2, '#2d2566')
      R(0, 104, W, H - 104, '#120f2e')
      R(0, 103, W, 2, '#3a3180')

      // Columnas y ventanales con estrellas
      for (let x = 16; x < W; x += 42) {
        R(x - 4, 24, 8, 79, '#17133a')
        R(x - 2, 24, 4, 79, '#221c52')
        if (x + 28 < W) {
          R(x + 6, 36, 24, 40, '#05040d')
          R(x + 7, 37, 22, 38, '#08071a')
          R(x + 7, 37, 22, 2, '#3a3180')
          // Estrellas visibles por la ventana
          R(x + 11, 46, 1, 1, '#ffffff')
          R(x + 22, 54, 1, 1, '#ffd88a')
          R(x + 15, 64, 1, 1, '#9be8ff')
        }
      }

      // Luces en el techo y reflejo en el piso
      for (let x = 36; x < W; x += 42) {
        R(x - 6, 23, 12, 2, '#ffb347')
        ctx.fillStyle = 'rgba(255,179,71,0.07)'
        ctx.fillRect(x - 10, 25, 20, 78)
        ctx.fillStyle = 'rgba(255,179,71,0.12)'
        ctx.fillRect(x - 8, 105, 16, 12)
      }

      // Escotilla izquierda
      R(0, 30, 16, 73, '#221c52')
      R(14, 32, 2, 69, '#ffb347')

      // Desfile de los 4 tripulantes desde d >= 12
      if (d >= 12) {
        const tCrew = d - 12
        for (let i = 0; i < 4; i++) {
          const local = tCrew - i * 4.2
          if (local < 0) continue
          const targetX = 192 - i * 38
          const walkDur = 3.2
          const u = clamp(local / walkDur, 0, 1)
          const px = Math.round(lerp(18, targetX, u))
          const walking = u < 1
          const ph = walking ? local * 9 : 0

          if (walking) {
            const stepIdx = Math.floor(local * 3)
            once(`step_${i}_${stepIdx}`, () => {
              tn(stepIdx % 2 === 0 ? 160 : 130, 0.05, 'triangle', 0.08, 70)
            })
          }

          crew(i, px, ph)
        }
      }
    }

    let raf = 0
    let prevNow = performance.now()

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prevNow) / 1000)
      prevNow = now
      const elapsed = (now - t0Ref.current) / 1000

      if (phaseRef.current === 'launch') {
        // ====================================================================
        // LOOP PARTE 1: DESPEGUE (`t` de 0 a 24.5s, transición en `lt > 17.5`)
        // ====================================================================
        const t = elapsed
        const lt = Math.max(0, t - LIFT)
        const alt = lt > 0 ? lt * lt * 3.2 : 0
        const k = clamp(alt / 600, 0, 1)
        const camY = alt

        // 3 beeps cuadrados a 660Hz en 1.5s, 2.5s, 3.5s
        if (t >= 1.5) once('b3', () => tn(660, 0.12, 'square', 0.12))
        if (t >= 2.5) once('b2', () => tn(660, 0.12, 'square', 0.12))
        if (t >= 3.5) once('b1', () => tn(660, 0.12, 'square', 0.12))

        // Modulación de audio: ruido blanco con filtro lowpass (180Hz -> 900Hz -> 250Hz)
        if (acRef.current && noiseFilterRef.current && noiseGainRef.current) {
          const acNow = acRef.current.currentTime
          if (t < IGN) {
            noiseGainRef.current.gain.setTargetAtTime(0.0001, acNow, 0.05)
            noiseFilterRef.current.frequency.setTargetAtTime(180, acNow, 0.05)
          } else if (t < LIFT) {
            const u = (t - IGN) / (LIFT - IGN)
            noiseGainRef.current.gain.setTargetAtTime(0.05 + u * 0.16, acNow, 0.05)
            noiseFilterRef.current.frequency.setTargetAtTime(180 + u * 720, acNow, 0.05)
          } else {
            const fade = clamp(1 - k * 0.75, 0.04, 1)
            noiseGainRef.current.gain.setTargetAtTime(0.22 * fade, acNow, 0.06)
            noiseFilterRef.current.frequency.setTargetAtTime(lerp(900, 250, k), acNow, 0.06)
          }
        }

        // Vibración de cámara
        const shake =
          t >= IGN && t < LIFT
            ? 1.8
            : t >= LIFT && k < 0.75
            ? 1.5 * (1 - k)
            : 0
        const sx = (Math.random() - 0.5) * 2 * shake
        const sy = (Math.random() - 0.5) * 2 * shake

        ctx.save()
        ctx.translate(Math.round(sx), Math.round(sy))

        // Cielo con pal(k)
        const [cTop, cBot] = pal(k)
        for (let y = 0; y < H; y++) {
          const u = y / H
          const r = lerp(cTop[0], cBot[0], u)
          const g = lerp(cTop[1], cBot[1], u)
          const b = lerp(cTop[2], cBot[2], u)
          R(0, y, W, 1, rgb([r, g, b]))
        }

        // Sol cálido al amanecer (k < 0.3)
        if (k < 0.3) {
          const sunY = Math.round(88 + camY * 0.35)
          disc(188, sunY, 14, '#ffae52')
          disc(188, sunY, 10, '#ffd97d')
        }

        // Estrellas cuando k > 0.2
        if (k > 0.2) {
          for (const s of stars) {
            const syStar = (s.y + Math.floor(camY * 0.15)) % H
            if (((s.x + Math.floor(t * 4)) % 5) === 0 && k < 0.5) continue
            R(s.x, syStar, 1, 1, s.s === 2 ? '#ffd88a' : '#ffffff')
          }
        }

        // Curvatura de la Tierra cuando k > 0.5
        if (k > 0.5) {
          const u = (k - 0.5) / 0.5
          const baseE = Math.round(lerp(H + 18, H - 14, u))
          for (let x = 0; x < W; x++) {
            const dx = (x - CX) / 140
            const ey = Math.round(baseE + dx * dx * 18)
            if (ey < H) {
              R(x, ey - 1, 1, 1, '#5ec8ff')
              R(x, ey, 1, H - ey, '#163b88')
            }
          }
        }

        // Nubes
        if (k < 0.85) {
          for (const cl of clouds) {
            const cy = Math.round(cl.y + camY * cl.v)
            if (cy > -20 && cy < H + 20) {
              R(cl.x, cy, cl.w, cl.h, '#eef4fc')
              R(cl.x + 4, cy - 3, cl.w - 8, 3, '#ffffff')
              R(cl.x + 2, cy + cl.h - 2, cl.w - 4, 2, '#b9c9de')
            }
          }
        }

        // Líneas de velocidad durante el ascenso
        if (lt > 1.2 && k < 0.92) {
          for (let i = 0; i < 8; i++) {
            const lx = (i * 31 + 11) % W
            if (Math.abs(lx - CX) < 24) continue
            const ly = (Math.floor(t * 140 + i * 37) % (H + 20)) - 10
            R(lx, ly, 1, 8, 'rgba(255,255,255,0.22)')
          }
        }

        // Colinas (#27403a, #2f4a35), plataforma y torre roja (#b04a3a en x=72)
        const gy = Math.round(G + camY)
        if (gy < H + 80) {
          // Colinas lejanas
          for (let x = 0; x < W; x++) {
            const h1 = Math.round(8 + Math.sin(x * 0.045) * 4 + Math.cos(x * 0.02) * 3)
            const h2 = Math.round(4 + Math.cos(x * 0.06 + 1) * 3)
            R(x, gy - h1, 1, h1, '#27403a')
            R(x, gy - h2, 1, h2, '#2f4a35')
          }
          // Suelo y plataforma
          R(0, gy, W, H - gy + 40, '#1a2421')
          R(CX - 42, gy - 4, 84, 5, '#596377')
          R(CX - 36, gy - 7, 72, 3, '#7c879e')

          // Torre de lanzamiento roja en x=72
          const tx = 72
          R(tx, gy - 68, 12, 64, '#b04a3a')
          for (let y = gy - 66; y < gy - 6; y += 6) {
            R(tx + 2, y, 8, 2, '#d46554')
            R(tx + 3, y + 2, 6, 3, '#222836')
          }
          // Pararrayos superior
          R(tx + 5, gy - 76, 2, 8, '#cfd7e6')
          // Brazo umbilical retráctil
          const retract = lt > 0 ? Math.min(20, Math.round(lt * 10)) : 0
          R(tx + 12, gy - 50, Math.max(4, 28 - retract), 3, '#9aa5be')
        }

        // Posición vertical del transbordador en pantalla
        const shipTop =
          t < LIFT
            ? TOP0
            : Math.round(lerp(TOP0, 34, clamp(lt / 4.5, 0, 1)))

        // Onda de choque en ignición
        if (t >= IGN && t < IGN + 0.55) {
          const u = (t - IGN) / 0.55
          const rw = Math.round(12 + u * 80)
          R(CX - rw, gy - 3, rw * 2, 2, '#fff4cc')
        }

        // Separación parabólica de los SRB cuando alt > SEP
        const attached = alt < SEP
        if (!attached) {
          const sepT = (alt - SEP) / 75
          once('sep_snd', () => tn(170, 0.25, 'sawtooth', 0.14, 65))
          const dx = Math.round(12 + sepT * 26)
          const dy = Math.round(8 + sepT * sepT * 14)
          srb(CX - dx - 2, shipTop + dy)
          srb(CX + dx - 3, shipTop + dy)
        }

        // Dibujo del transbordador + tanque + fuego
        const firing = t >= IGN
        const flameLen =
          t < IGN
            ? 0
            : t < LIFT
            ? Math.round(6 + ((t - IGN) / (LIFT - IGN)) * 12)
            : 18 + (Math.floor(t * 25) % 5)
        shuttle(shipTop, flameLen, firing, attached)

        // Sistema de partículas puffs (hasta 320 partículas)
        if (firing && k < 0.82) {
          const spawnN = t < LIFT ? 5 : 4
          for (let i = 0; i < spawnN; i++) {
            if (puffsRef.current.length >= 320) break
            const atPad = gy < H + 12
            puffsRef.current.push({
              x: CX + (Math.random() - 0.5) * 18,
              y: atPad && t < LIFT + 1.2 ? gy - 4 : shipTop + 66,
              vx:
                atPad && t < LIFT + 1.2
                  ? (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 42)
                  : (Math.random() - 0.5) * 18,
              vy:
                atPad && t < LIFT + 1.2
                  ? -4 - Math.random() * 14
                  : 26 + Math.random() * 24,
              r: 3 + Math.random() * 4,
              a: 0,
              m: 0.8 + Math.random() * 0.7,
              hot: Math.random() < 0.5 ? 1 : 0,
            })
          }
        }

        const alive: Puff[] = []
        for (const p of puffsRef.current) {
          p.a += dt
          if (p.a >= p.m) continue
          p.x += p.vx * dt
          p.y += p.vy * dt
          const u = p.a / p.m
          const r = Math.round(p.r + u * 4)
          const col =
            u < 0.18 && p.hot
              ? '#ffd24a'
              : u < 0.45
              ? '#f1f5fb'
              : u < 0.75
              ? '#c5cfde'
              : '#7c879e'
          disc(p.x, p.y, r, col)
          alive.push(p)
        }
        puffsRef.current = alive

        ctx.restore()

        // Launch telemetry and phase callouts
        const tMinus = Math.ceil(LIFT - t)
        setTopLeft('EAGLE MISSION · TELEMETRY')
        setTopRight(
          t < LIFT
            ? `T-00:0${Math.max(0, tMinus)}`
            : `T+00:${String(Math.floor(lt)).padStart(2, '0')}`
        )
        setBotLeft(
          t < IGN
            ? 'PAD LC-39A · SYSTEMS NOMINAL'
            : t < LIFT
            ? 'SSME IGNITION · 100% THRUST'
            : alt < SEP
            ? 'SUPERSONIC ASCENT · MAX-Q'
            : 'ORBITAL INSERTION IN PROGRESS'
        )
        setBotRight(
          `ALT ${(alt * 0.18).toFixed(1)} KM · VEL ${Math.round(lt * 420)} M/S`
        )

        if (t < 1.5) {
          setBigText('EAGLE MISSION')
          setSubText('ORBITAL LAUNCH')
          setBigScale(1)
        } else if (t < 2.5) {
          setBigText('3')
          setSubText('')
          setBigScale(1 + (1 - (t - 1.5)) * 0.35)
        } else if (t < 3.5) {
          setBigText('2')
          setSubText('')
          setBigScale(1 + (1 - (t - 2.5)) * 0.35)
        } else if (t < IGN) {
          setBigText('1')
          setSubText('')
          setBigScale(1 + (1 - (t - 3.5)) * 0.35)
        } else if (t < LIFT) {
          setBigText('IGNITION')
          setSubText('MAIN ENGINES')
          setBigScale(1)
        } else if (t < 9.8) {
          setBigText('LIFTOFF!')
          setSubText('')
          setBigScale(1)
        } else if (alt < SEP) {
          setBigText('')
          setSubText('')
          setBigScale(1)
        } else if (lt < 14.5) {
          setBigText('STAGE 1 SEP')
          setSubText('SRB BOOSTERS JETTISONED')
          setBigScale(1)
        } else {
          setBigText('IN ORBIT')
          setSubText('MISSION ACCOMPLISHED')
          setBigScale(1)
        }

        // Transición automática a Parte 2 cuando lt > 17.5
        if (lt > 17.5) {
          startDockingPhase()
        }
      } else {
        // ====================================================================
        // LOOP PARTE 2: ACOPLAMIENTO (`d` de 0 a 31.5s)
        // ====================================================================
        const d = elapsed
        setBigScale(1)

        // Sonidos puntuales en 3s, 5s, 8.5s, 8.65s
        if (d >= 3.0) once('s_tank', () => tn(140, 0.2, 'sawtooth', 0.12, 60))
        if (d >= 5.0) once('s_rcs', () => tn(320, 0.16, 'square', 0.08, 190))
        if (d >= 8.5) once('s_dock1', () => tn(220, 0.18, 'triangle', 0.16, 95))
        if (d >= 8.65) once('s_dock2', () => tn(520, 0.22, 'square', 0.12, 260))

        // Filtro bandpass a 1400Hz para soplidos RCS y esclusa
        if (acRef.current && noiseGainRef.current) {
          const acNow = acRef.current.currentTime
          const hiss =
            (d > 3.0 && d < 3.5) ||
            (d > 5.0 && d < 7.0) ||
            (d > 8.5 && d < 9.2) ||
            (d > 10.4 && d < 11.4)
          noiseGainRef.current.gain.setTargetAtTime(hiss ? 0.05 : 0.0001, acNow, 0.04)
        }

        if (d < 10.4) {
          space(d)
        } else {
          tunnel(d)
        }

        // Docking telemetry and phase callouts
        setTopLeft('EAGLE MISSION · DOCKING')
        setTopRight(`LEO ORBIT · T+${String(Math.floor(d)).padStart(2, '0')}S`)

        if (d < 2.6) {
          setBigText('STATION')
          setSubText('IN SIGHT')
          setBotLeft('ORBITAL RENDEZVOUS APPROACH')
          setBotRight('REL VEL 12.4 M/S')
        } else if (d < 4.8) {
          setBigText('SEPARATION')
          setSubText('EXTERNAL TANK JETTISONED')
          setBotLeft('ET JETTISON COMPLETE')
          setBotRight('RCS ACTIVE')
        } else if (d < 7.0) {
          setBigText('MANEUVER')
          setSubText('PITCH TO VERTICAL')
          setBotLeft('PMA-2 PORT ALIGNMENT')
          setBotRight('ATTITUDE 90°')
        } else if (d < 8.5) {
          const distM = Math.max(0, Math.ceil((8.5 - d) * 14))
          setBigText('DOCKING')
          setSubText(`RANGE ${distM} M`)
          setBotLeft('DOCKING PROBE EXTENDED')
          setBotRight(`RANGE ${distM} M`)
        } else if (d < 10.4) {
          setBigText('DOCKED!')
          setSubText('HARD CAPTURE CONFIRMED')
          setBotLeft('MECHANICAL CAPTURE COMPLETE')
          setBotRight('PRESSURE NOMINAL')
        } else if (d < 12.0) {
          setBigText('HATCH')
          setSubText('OPEN')
          setBotLeft('BOARDING TUNNEL PRESSURIZED')
          setBotRight('CREW INGRESS')
        } else if (d < 28.8) {
          const idx = clamp(Math.floor((d - 12.0) / 4.2), 0, 3)
          const name = NAMES[idx]
          setBigText(name)
          setSubText(`CREW MEMBER ${idx + 1}`)
          setBotLeft(`CREW ${idx + 1}: ${name}`)
          setBotRight(`${idx + 1}/4 ABOARD STATION`)
        } else {
          setBigText('WELCOME')
          setSubText('ABOARD THE STATION')
          setBotLeft('FULL CREW: ALPACA · SERPIENTE · PUMA · CONDOR')
          setBotRight('MISSION READY')
        }

        if (d > 31.0) {
          setShowEndBtn(true)
        }
      }

      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      if (acRef.current) {
        void acRef.current.close().catch(() => {})
        acRef.current = null
      }
    }
  }, [initAudio, once, startDockingPhase, tn])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
    >
      {/* Contenedor 16:9 idéntico a los HTML originales */}
      <div
        style={{
          width: 'min(100vw, calc(100vh * 16 / 9))',
          aspectRatio: '16 / 9',
          position: 'relative',
          overflow: 'hidden',
          background: '#000',
          fontFamily: '"Press Start 2P", monospace',
        }}
      >
        <canvas
          ref={canvasRef}
          width={240}
          height={135}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            imageRendering: 'pixelated',
          }}
        />

        {/* Viñeta radial exacta */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.6))',
          }}
        />

        {/* Barra superior (#tb) */}
        <div
          id="tb"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '9%',
            background: '#000',
            color: '#ffb347',
            padding: '0 3%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 'clamp(8px, 1.1vw, 13px)',
            letterSpacing: '0.06em',
            zIndex: 10,
          }}
        >
          <span>{topLeft}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span>{topRight}</span>
            <button
              onClick={handleSkip}
              style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 'clamp(7px, 0.9vw, 10px)',
                color: '#ffb347',
                background: 'transparent',
                border: '1px solid #ffb347',
                padding: '3px 6px',
                cursor: 'pointer',
              }}
            >
              [⏭ SKIP]
            </button>
          </div>
        </div>

        {/* Barra inferior (#bb) */}
        <div
          id="bb"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '9%',
            background: '#000',
            color: '#ffb347',
            padding: '0 3%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 'clamp(8px, 1.1vw, 13px)',
            letterSpacing: '0.06em',
            zIndex: 10,
          }}
        >
          <span>{botLeft}</span>
          <span>{botRight}</span>
        </div>

        {/* Textos centrales #big y #sub */}
        {bigText && (
          <div
            id="big"
            style={{
              position: 'absolute',
              top: '36%',
              left: 0,
              right: 0,
              textAlign: 'center',
              color: '#ffb347',
              fontSize: 'clamp(16px, 3.2vw, 38px)',
              textShadow: '3px 3px 0 #000, -2px -2px 0 #000',
              transform: `scale(${bigScale})`,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {bigText}
          </div>
        )}

        {subText && (
          <div
            id="sub"
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              textAlign: 'center',
              color: '#fff',
              fontSize: 'clamp(9px, 1.3vw, 16px)',
              textShadow: '2px 2px 0 #000',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {subText}
          </div>
        )}

        {/* Botones estilo retro #ffb347 al terminar en d > 31 */}
        {showEndBtn && (
          <div
            style={{
              position: 'absolute',
              top: '64%',
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
              gap: '14px',
              zIndex: 20,
            }}
          >
            <button
              onClick={onComplete}
              style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 'clamp(9px, 1.1vw, 13px)',
                color: '#000',
                background: '#ffb347',
                border: '2px solid #fff',
                padding: '8px 14px',
                cursor: 'pointer',
                boxShadow: '3px 3px 0 #000',
              }}
            >
              CONTINUE ▶
            </button>
            <button
              onClick={restartAll}
              style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 'clamp(9px, 1.1vw, 13px)',
                color: '#ffb347',
                background: '#000',
                border: '2px solid #ffb347',
                padding: '8px 14px',
                cursor: 'pointer',
                boxShadow: '3px 3px 0 #000',
              }}
            >
              ↻ REPLAY
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
