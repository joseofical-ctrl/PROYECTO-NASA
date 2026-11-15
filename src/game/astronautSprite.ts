import type { RoleId } from './catalog'

export const ATLAS_OUTLINE = '#070b12'

export function drawHelmetDomeToCtx(
  ctx: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  ringColor: string,
  tintFill: string
) {
  ctx.fillStyle = ATLAS_OUTLINE
  ctx.fillRect(dx + 1, dy - 1, dw - 2, 1)
  ctx.fillRect(dx + 1, dy + dh, dw - 2, 1)
  ctx.fillRect(dx - 1, dy + 1, 1, dh - 2)
  ctx.fillRect(dx + dw, dy + 1, 1, dh - 2)
  ctx.fillRect(dx, dy, 1, 1)
  ctx.fillRect(dx + dw - 1, dy, 1, 1)
  ctx.fillRect(dx, dy + dh - 1, 1, 1)
  ctx.fillRect(dx + dw - 1, dy + dh - 1, 1, 1)

  ctx.fillStyle = tintFill
  ctx.fillRect(dx + 1, dy + 1, dw - 2, dh - 2)

  ctx.fillStyle = ringColor
  ctx.fillRect(dx + 2, dy, dw - 4, 1)
  ctx.fillRect(dx + 2, dy + dh - 1, dw - 4, 1)
  ctx.fillRect(dx, dy + 2, 1, dh - 4)
  ctx.fillRect(dx + dw - 1, dy + 2, 1, dh - 4)
  ctx.fillRect(dx + 1, dy + 1, 1, 1)
  ctx.fillRect(dx + dw - 2, dy + 1, 1, 1)
  ctx.fillRect(dx + 1, dy + dh - 2, 1, 1)
  ctx.fillRect(dx + dw - 2, dy + dh - 2, 1, 1)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(dx + 2, dy + 2, 4, 1)
  ctx.fillRect(dx + 2, dy + 3, 2, 3)
  ctx.fillStyle = 'rgba(224, 242, 254, 0.72)'
  ctx.fillRect(dx + 3, dy + 6, 1, 2)
  ctx.fillRect(dx + dw - 4, dy + dh - 4, 2, 1)
}

/** Dibuja el sprite completo pixel-art del astronauta (alpaca, serpiente, puma o cóndor) centrado en (0, 0) */
export function paintAstronautPoseToAtlas(
  ctx: CanvasRenderingContext2D,
  role: RoleId,
  poseKind: 'idle' | 'walk' | 'work',
  poseIdx: number
) {
  const isWalking = poseKind === 'walk'
  const isInteracting = poseKind === 'work'
  const walkAngles = [0.7, 0.25, -0.7, -0.25]
  const stride = isWalking ? walkAngles[poseIdx % 4] : 0
  const walkBob = isWalking ? (poseIdx % 2 === 0 ? -1 : 0) : 0
  const breath =
    (poseKind === 'idle' && poseIdx % 2 === 1 ? -1 : 0) +
    (isInteracting && poseIdx % 2 === 1 ? -1 : 0) +
    walkBob
  const wavePhase = isWalking ? poseIdx * 1.3 : poseIdx * 1.7

  // Sombra suave en suelo
  ctx.fillStyle = 'rgba(2, 6, 16, 0.45)'
  ctx.fillRect(-11, 13, 22, 4)
  ctx.fillRect(-8, 12, 16, 6)

  if (role === 'engineer') {
    const legL = Math.round(stride * 3.5)
    const legR = Math.round(-stride * 3.5)
    const earTwitch = poseKind !== 'idle' && poseIdx % 2 === 1 ? -1 : 0

    // Mochila de soporte vital con contorno oscuro
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-12, -12 + breath, 8, 17)
    ctx.fillStyle = '#475569'
    ctx.fillRect(-11, -11 + breath, 6, 15)
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(-10, -10 + breath, 4, 12)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(-9, -8 + breath, 2, 3)
    ctx.fillStyle = poseIdx % 2 === 0 ? '#4ade80' : '#16a34a'
    ctx.fillRect(-9, -3 + breath, 2, 2)

    // Colita de alpaca blanca contorneada
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-13, 0 + breath, 5, 6)
    ctx.fillStyle = '#fff8e7'
    ctx.fillRect(-12, 1 + breath, 3, 4)

    // Pierna trasera (izquierda) + bota espacial
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(Math.round(-7 + legL * 0.5), 3, 7, 13 + Math.max(0, legL))
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(Math.round(-6 + legL * 0.5), 4, 5, 8 + Math.max(0, legL))
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(Math.round(-6 + legL * 0.5), 7, 5, 2)
    ctx.fillStyle = '#475569'
    ctx.fillRect(Math.round(-7 + legL * 0.5), 11 + Math.max(0, legL), 6, 3)
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(Math.round(-6 + legL * 0.5), 11 + Math.max(0, legL), 4, 1)

    // Pierna delantera (derecha) + bota
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(Math.round(0 + legR * 0.5), 3, 7, 13 + Math.max(0, legR))
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(Math.round(1 + legR * 0.5), 4, 5, 8 + Math.max(0, legR))
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(Math.round(1 + legR * 0.5), 7, 5, 2)
    ctx.fillStyle = '#334155'
    ctx.fillRect(Math.round(0 + legR * 0.5), 11 + Math.max(0, legR), 7, 3)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(Math.round(1 + legR * 0.5), 11 + Math.max(0, legR), 5, 1)

    // Torso del traje con contorno + luces + cinturón
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-8, -10 + breath, 16, 16)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-7, -9 + breath, 14, 14)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(-6, -8 + breath, 12, 11)
    ctx.fillStyle = '#334155'
    ctx.fillRect(-7, 2 + breath, 14, 3)
    ctx.fillStyle = '#fbbf24'
    ctx.fillRect(-2, 2 + breath, 4, 3)
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(-5, -6 + breath, 3, 2)
    ctx.fillStyle = '#2563eb'
    ctx.fillRect(2, -6 + breath, 3, 2)
    ctx.fillStyle = '#334155'
    ctx.fillRect(-3, -3 + breath, 6, 4)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(-2, -2 + breath, 4, 2)

    // Anillo metálico del cuello
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-7, -12 + breath, 14, 4)
    ctx.fillStyle = '#64748b'
    ctx.fillRect(-6, -11 + breath, 12, 2)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-4, -11 + breath, 8, 1)

    // Cuello y cabeza peluda de Alpaca dentro del casco
    ctx.fillStyle = '#fff8e7'
    ctx.fillRect(-4, -22 + breath, 8, 11)
    ctx.fillStyle = '#f3d5b5'
    ctx.fillRect(-4, -16 + breath, 2, 2)
    ctx.fillRect(2, -19 + breath, 2, 2)

    // Orejas con contorno oscuro
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-6, -32 + breath + earTwitch, 5, 6)
    ctx.fillRect(1, -32 + breath - earTwitch, 5, 6)
    ctx.fillStyle = '#fff8e7'
    ctx.fillRect(-5, -31 + breath + earTwitch, 3, 5)
    ctx.fillRect(2, -31 + breath - earTwitch, 3, 5)
    ctx.fillStyle = '#f4a261'
    ctx.fillRect(-4, -30 + breath + earTwitch, 1, 3)
    ctx.fillRect(3, -30 + breath - earTwitch, 1, 3)

    // Cabeza y hocico de Alpaca
    ctx.fillStyle = '#fff8e7'
    ctx.fillRect(-6, -27 + breath, 12, 9)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-5, -28 + breath, 10, 3)
    ctx.fillStyle = '#f3d5b5'
    ctx.fillRect(-2, -23 + breath, 6, 4)
    ctx.fillStyle = '#78350f'
    ctx.fillRect(1, -23 + breath, 2, 1)
    ctx.fillRect(0, -21 + breath, 3, 1)

    // Ojos vivos con brillo blanco
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-3, -25 + breath, 2, 2)
    ctx.fillRect(3, -25 + breath, 2, 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-3, -25 + breath, 1, 1)
    ctx.fillRect(3, -25 + breath, 1, 1)

    drawHelmetDomeToCtx(ctx, -9, -31 + breath, 18, 20, '#5ef0ff', 'rgba(94, 240, 255, 0.16)')

    const armSwing = isInteracting ? 6 : Math.round(-stride * 3)
    const armY = isInteracting ? -6 + breath : -5 + breath
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(2, armY - 1, 10 + (isInteracting ? 4 : Math.max(0, Math.round(armSwing * 0.4))), 6)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(3, armY, 5 + (isInteracting ? 4 : 0), 4)
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(3, armY, 3, 2)
    ctx.fillStyle = '#475569'
    ctx.fillRect(7 + (isInteracting ? 4 : Math.round(armSwing * 0.4)), armY, 3, 4)
  } else if (role === 'comms') {
    for (let seg = 24; seg >= 0; seg--) {
      const tNorm = seg / 24
      const wave = Math.sin(seg * 0.5 - wavePhase) * (isWalking ? 5.5 : 3.4)
      const sx = -tNorm * 16 + wave * (0.35 + tNorm * 0.65)
      const sy =
        seg < 8
          ? -10 + seg * 2.2 + breath
          : 7 + Math.sin(seg * 0.35 - wavePhase * 0.7) * 2.2 + (seg - 8) * 0.38
      const radius = Math.max(2.5, 6.2 - tNorm * 3.8)
      const rx = Math.round(sx - radius)
      const ry = Math.round(sy - radius * 0.8)
      const rw = Math.round(radius * 2)
      const rh = Math.round(radius * 1.6)

      ctx.fillStyle = ATLAS_OUTLINE
      ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2)

      const isDarkBand = seg % 4 === 0
      ctx.fillStyle = isDarkBand ? '#1e293b' : seg % 2 === 0 ? '#ea580c' : '#f97316'
      ctx.fillRect(rx, ry, rw, rh)
      if (!isDarkBand) {
        ctx.fillStyle = '#fdba74'
        ctx.fillRect(
          Math.round(sx - radius * 0.4),
          Math.round(sy - radius * 0.4),
          Math.round(radius),
          Math.round(radius * 0.8)
        )
      }
    }

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-7, -13 + breath, 15, 10)
    ctx.fillStyle = '#64748b'
    ctx.fillRect(-6, -12 + breath, 13, 8)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-5, -11 + breath, 11, 6)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-3, -10 + breath, 7, 4)
    ctx.fillStyle = poseIdx % 2 === 0 ? '#38bdf8' : '#22c55e'
    ctx.fillRect(-2, -9 + breath, 2, 2)
    ctx.fillStyle = '#fbbf24'
    ctx.fillRect(1, -9 + breath, 2, 2)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-7, -24 + breath, 15, 11)
    ctx.fillStyle = '#ea580c'
    ctx.fillRect(-6, -23 + breath, 13, 9)
    ctx.fillStyle = '#fb923c'
    ctx.fillRect(-5, -22 + breath, 12, 6)
    ctx.fillStyle = '#9a3412'
    ctx.fillRect(-4, -23 + breath, 8, 2)

    ctx.fillStyle = '#fde047'
    ctx.fillRect(-2, -20 + breath, 3, 3)
    ctx.fillRect(3, -20 + breath, 3, 3)
    ctx.fillStyle = '#000000'
    ctx.fillRect(-1, -20 + breath, 1, 3)
    ctx.fillRect(4, -20 + breath, 1, 3)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-2, -20 + breath, 1, 1)
    ctx.fillRect(3, -20 + breath, 1, 1)

    if (poseIdx % 2 === 1 || isInteracting) {
      const ext = isInteracting ? 2 : 1
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(7, -17 + breath, 4 + ext, 2)
      ctx.fillRect(10 + ext, -18 + breath, 2, 1)
      ctx.fillRect(10 + ext, -15 + breath, 2, 1)
    }

    drawHelmetDomeToCtx(ctx, -9, -26 + breath, 19, 15, '#74b9ff', 'rgba(116, 185, 255, 0.17)')
  } else if (role === 'science') {
    const legL = Math.round(stride * 4)
    const legR = Math.round(-stride * 4)

    for (let s = 0; s < 10; s++) {
      const tx = -7 - s * 1.7
      const ty = 2 + Math.sin(wavePhase - s * 0.45) * 3.0 - s * 0.3
      ctx.fillStyle = ATLAS_OUTLINE
      ctx.fillRect(Math.round(tx) - 1, Math.round(ty) - 1, 5, 5)
      ctx.fillStyle = s > 7 ? '#451a03' : s % 2 === 0 ? '#d97706' : '#f59e0b'
      ctx.fillRect(Math.round(tx), Math.round(ty), 3, 3)
    }

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-12, -13 + breath, 8, 17)
    ctx.fillStyle = '#64748b'
    ctx.fillRect(-11, -12 + breath, 6, 15)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-10, -11 + breath, 4, 12)
    ctx.fillStyle = '#55efc4'
    ctx.fillRect(-9, -8 + breath, 2, 4)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(Math.round(-8 + legL * 0.6), 2, 8, 14 + Math.max(0, legL))
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(Math.round(-6 + legL * 0.6), 3, 5, 9 + Math.max(0, legL))
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(Math.round(-6 + legL * 0.6), 5, 5, 2)
    ctx.fillStyle = '#334155'
    ctx.fillRect(Math.round(-7 + legL * 0.6), 11 + Math.max(0, legL), 7, 4)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(Math.round(0 + legR * 0.6), 2, 8, 14 + Math.max(0, legR))
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(Math.round(1 + legR * 0.6), 3, 6, 9 + Math.max(0, legR))
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(Math.round(1 + legR * 0.6), 5, 6, 2)
    ctx.fillStyle = '#475569'
    ctx.fillRect(Math.round(1 + legR * 0.6), 11 + Math.max(0, legR), 6, 4)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-9, -12 + breath, 18, 17)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-8, -11 + breath, 16, 15)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-7, -10 + breath, 14, 12)
    ctx.fillStyle = '#2563eb'
    ctx.fillRect(-8, -9 + breath, 4, 4)
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(4, -9 + breath, 4, 3)
    ctx.fillStyle = '#1e3a8a'
    ctx.fillRect(-3, -7 + breath, 6, 5)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(-2, -6 + breath, 4, 3)
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(-8, 1 + breath, 16, 3)
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(-2, 1 + breath, 4, 3)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-7, -26 + breath, 5, 5)
    ctx.fillRect(2, -26 + breath, 5, 5)
    ctx.fillStyle = '#b45309'
    ctx.fillRect(-6, -25 + breath, 3, 3)
    ctx.fillRect(3, -25 + breath, 3, 3)
    ctx.fillStyle = '#d97706'
    ctx.fillRect(-6, -23 + breath, 12, 11)
    ctx.fillStyle = '#f59e0b'
    ctx.fillRect(-5, -22 + breath, 10, 9)
    ctx.fillStyle = '#fef3c7'
    ctx.fillRect(-3, -17 + breath, 7, 4)
    ctx.fillStyle = '#451a03'
    ctx.fillRect(0, -17 + breath, 3, 2)
    ctx.fillStyle = '#bef264'
    ctx.fillRect(-4, -20 + breath, 3, 2)
    ctx.fillRect(2, -20 + breath, 3, 2)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-3, -20 + breath, 1, 2)
    ctx.fillRect(3, -20 + breath, 1, 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-4, -20 + breath, 1, 1)
    ctx.fillRect(2, -20 + breath, 1, 1)

    drawHelmetDomeToCtx(ctx, -9, -26 + breath, 18, 16, '#55efc4', 'rgba(85, 239, 196, 0.16)')

    const armAngle = isInteracting ? -4 : Math.round(stride * 2)
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(4, -6 + breath, 7, 6)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(5, -5 + breath, 5, 4)
    ctx.fillStyle = '#334155'
    ctx.fillRect(8, -4 + breath, 3, 3)

    ctx.strokeStyle = ATLAS_OUTLINE
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(9, -3 + breath)
    ctx.lineTo(15, 6 + armAngle)
    ctx.stroke()
    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(9, -3 + breath)
    ctx.lineTo(15, 6 + armAngle)
    ctx.stroke()
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(11, 3 + armAngle, 8, 5)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(12, 4 + armAngle, 6, 3)
  } else {
    const legL = Math.round(stride * 3.5)
    const legR = Math.round(-stride * 3.5)
    const wingFlap = isWalking
      ? poseIdx % 2 === 0
        ? 4
        : -2
      : isInteracting
        ? poseIdx % 2 === 0
          ? 5
          : -1
        : poseIdx % 2 === 0
          ? 1
          : -1

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-7, 4 + breath, 14, 8)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-6, 5 + breath, 12, 6)
    ctx.fillStyle = '#334155'
    ctx.fillRect(-4, 6 + breath, 8, 4)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(Math.round(-8 + legL * 0.5), 6, 8, 9 + Math.max(0, legL))
    ctx.fillRect(Math.round(0 + legR * 0.5), 6, 8, 9 + Math.max(0, legR))
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(Math.round(-5 + legL * 0.5), 7, 3, 6 + Math.max(0, legL))
    ctx.fillRect(Math.round(2 + legR * 0.5), 7, 3, 6 + Math.max(0, legR))
    ctx.fillStyle = '#eab308'
    ctx.fillRect(Math.round(-7 + legL * 0.5), 12 + Math.max(0, legL), 6, 2)
    ctx.fillRect(Math.round(1 + legR * 0.5), 12 + Math.max(0, legR), 6, 2)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-22, -8 + breath - wingFlap, 16, 17)
    ctx.fillRect(6, -8 + breath - wingFlap, 16, 17)
    ctx.fillStyle = '#ea580c'
    ctx.fillRect(-17, Math.round(-7 + breath - wingFlap * 0.6), 11, 6)
    ctx.fillRect(6, Math.round(-7 + breath - wingFlap * 0.6), 11, 6)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(-19, Math.round(-2 + breath - wingFlap * 0.8), 12, 4)
    ctx.fillRect(7, Math.round(-2 + breath - wingFlap * 0.8), 12, 4)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-21, 1 + breath - wingFlap, 13, 6)
    ctx.fillRect(8, 1 + breath - wingFlap, 13, 6)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-8, -10 + breath, 16, 17)
    ctx.fillStyle = '#c2410c'
    ctx.fillRect(-7, -9 + breath, 14, 15)
    ctx.fillStyle = '#f97316'
    ctx.fillRect(-6, -8 + breath, 12, 13)
    ctx.fillStyle = '#fdba74'
    ctx.fillRect(-5, -8 + breath, 4, 5)
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(-6, -2 + breath, 12, 3)
    ctx.fillStyle = '#ffd23f'
    ctx.fillRect(-2, -5 + breath, 4, 4)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-8, -14 + breath, 16, 6)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-7, -13 + breath, 14, 5)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-6, -10 + breath, 12, 2)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-5, -25 + breath, 10, 13)
    ctx.fillStyle = '#be123c'
    ctx.fillRect(-4, -22 + breath, 8, 9)
    ctx.fillStyle = '#e11d48'
    ctx.fillRect(-3, -24 + breath, 5, 3)
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(3, -20 + breath, 6, 5)
    ctx.fillStyle = '#fde047'
    ctx.fillRect(3, -19 + breath, 5, 3)
    ctx.fillRect(6, -17 + breath, 2, 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, -20 + breath, 2, 2)
    ctx.fillStyle = '#000000'
    ctx.fillRect(1, -20 + breath, 1, 1)

    drawHelmetDomeToCtx(ctx, -8, -26 + breath, 17, 15, '#ffd23f', 'rgba(255, 210, 63, 0.16)')
  }
}

const STARS = [
  [10, 12],
  [24, 22],
  [36, 9],
  [52, 17],
  [78, 11],
  [95, 20],
  [112, 8],
  [15, 38],
  [106, 36],
  [124, 24],
  [8, 52],
  [120, 48],
] as const

/** Renderiza una escena Pixel-Art espacial completa con el personaje astronauta animado dentro de su recuadro */
export function renderAstronautSceneCanvas(
  ctx: CanvasRenderingContext2D,
  role: RoleId,
  width: number,
  height: number,
  tick: number
) {
  ctx.imageSmoothingEnabled = false

  // Fondo espacial por especialista
  const bgTop =
    role === 'director'
      ? '#0d1532'
      : role === 'engineer'
        ? '#091a2e'
        : role === 'science'
          ? '#150d2a'
          : '#0a132c'
  const bgBot =
    role === 'director'
      ? '#1d2b57'
      : role === 'engineer'
        ? '#12314a'
        : role === 'science'
          ? '#261844'
          : '#16274d'

  const grad = ctx.createLinearGradient(0, 0, 0, height)
  grad.addColorStop(0, bgTop)
  grad.addColorStop(1, bgBot)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)

  // Estrellas pixel-art con titileo
  STARS.forEach(([sx, sy], i) => {
    const px = Math.round((sx / 132) * width)
    const py = Math.round((sy / 84) * height)
    const twinkle = (tick + i) % 5 === 0
    ctx.fillStyle = twinkle ? '#ffd23f' : i % 2 === 0 ? '#ffffff' : '#93c5fd'
    ctx.fillRect(px, py, twinkle ? 2 : 1, twinkle ? 2 : 1)
  })

  // Decorado espacial único por rol (planeta / satélite / ondas / reactor)
  if (role === 'director') {
    // Planeta con anillos en esquina superior izquierda
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(14, 14, 14, 12)
    ctx.fillStyle = '#0284c7'
    ctx.fillRect(16, 16, 10, 8)
    ctx.fillStyle = '#fde047'
    ctx.fillRect(9, 19, 24, 2)
  } else if (role === 'engineer') {
    // Panel solar espacial + núcleo brillante
    ctx.fillStyle = '#1e3a8a'
    ctx.fillRect(10, 14, 18, 10)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(12, 16, 6, 6)
    ctx.fillRect(20, 16, 6, 6)
    ctx.fillStyle = '#4ade80'
    ctx.fillRect(width - 20, 16, 4, 4)
  } else if (role === 'science') {
    // Exoplaneta esmeralda y lunas
    ctx.fillStyle = '#10b981'
    ctx.fillRect(width - 26, 12, 14, 14)
    ctx.fillStyle = '#6ee7b7'
    ctx.fillRect(width - 24, 14, 5, 5)
    ctx.fillStyle = '#5ef0ff'
    ctx.fillRect(width - 31, 20, 3, 3)
  } else {
    // Ondas de radio y satélite de enlace
    const pulse = tick % 2 === 0
    ctx.fillStyle = pulse ? '#74b9ff' : '#38bdf8'
    ctx.fillRect(width - 24, 14, 10, 6)
    ctx.fillStyle = '#fb923c'
    ctx.fillRect(width - 28, 16, 3, 2)
    ctx.fillRect(width - 13, 16, 3, 2)
    ctx.fillStyle = '#fde047'
    ctx.fillRect(16, 18, pulse ? 8 : 5, 1)
    ctx.fillRect(14, 15, pulse ? 10 : 6, 1)
  }

  // Plataforma metálica espacial de cubierta donde camina/posa el personaje
  const deckY = height - 16
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, deckY, width, 16)
  ctx.fillStyle = '#334155'
  ctx.fillRect(0, deckY, width, 2)
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(0, deckY + 2, width, 12)
  for (let gx = 8; gx < width; gx += 16) {
    ctx.fillStyle = (tick + gx) % 32 === 0 ? '#5ef0ff' : '#475569'
    ctx.fillRect(gx, deckY + 6, 4, 2)
  }

  // Astronauta de cuerpo completo centrado y escalado nítido (1.45x / 1.5x)
  ctx.save()
  ctx.translate(Math.round(width / 2), deckY - 19)
  ctx.scale(1.4, 1.4)
  const poseKind = tick % 6 < 4 ? 'idle' : 'work'
  paintAstronautPoseToAtlas(ctx, role, poseKind, tick % 2)
  ctx.restore()
}
