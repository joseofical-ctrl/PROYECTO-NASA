import { useEffect, useRef } from 'react'

/** Retro 2D pixel-art panoramic deep space @ 60 FPS. Rendered at low-res and upscaled for crisp pixels. */
const PX = 3 // size of a "game pixel" in screen px

type Star = { x: number; y: number; s: number; phase: number; c: string }

function makeStars(n: number, w: number, h: number, colors: string[]): Star[] {
  return Array.from({ length: n }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    s: Math.random(),
    phase: Math.random() * Math.PI * 2,
    c: colors[Math.floor(Math.random() * colors.length)],
  }))
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: (dx: number, dy: number, d: number) => string | null) {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y)
      if (d <= r) {
        const c = color(x, y, d / r)
        if (c) { ctx.fillStyle = c; ctx.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1) }
      }
    }
}

function drawRingedPlanet(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const bands = ['#d98c4a', '#c4733a', '#e8a867', '#b8602f']
  const ring = (front: boolean) => {
    for (let a = 0; a < Math.PI * 2; a += 0.012) {
      const isFront = Math.sin(a) > 0
      if (isFront !== front) continue
      for (let k = 1.35; k < 1.95; k += 0.04) {
        const x = Math.cos(a) * r * k
        const y = Math.sin(a) * r * k * 0.28
        // rotate ring a bit
        const rx = x * 0.97 - y * 0.25, ry = x * 0.25 + y * 0.97
        ctx.fillStyle = k > 1.6 && k < 1.68 ? '#2a1a3a' : k < 1.6 ? '#e9d3a0' : '#b79a70'
        ctx.fillRect(Math.round(cx + rx), Math.round(cy + ry), 1, 1)
      }
    }
  }
  ring(false)
  disc(ctx, cx, cy, r, (dx, dy, d) => {
    const band = bands[Math.abs(Math.floor((dy + r) / 3)) % bands.length]
    if (dx + dy > r * 0.9 || d > 0.93 && dx + dy > 0) return '#7a3f20'
    if (dx * 0.6 + dy * 0.8 < -r * 0.5 && d > 0.8) return '#f5c488'
    return band
  })
  ring(true)
}

function drawEarth(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number) {
  disc(ctx, cx, cy, r + 2, (_x, _y, d) => (d > 0.88 ? 'rgba(90,170,255,0.35)' : null))
  disc(ctx, cx, cy, r, (dx, dy, d) => {
    const lon = dx + t * 1.5
    const land = Math.sin(lon * 0.45) * Math.cos(dy * 0.5 + 1) + Math.sin(lon * 0.17 + dy * 0.3) * 0.6
    let col = land > 0.35 ? (land > 0.9 ? '#e8f0e0' : '#3f9a4a') : '#1f5bb8'
    if (Math.abs(dy) > r * 0.88) col = '#f2f6ff'
    if (dx * 0.7 + dy * 0.7 > r * 0.45) col = col === '#3f9a4a' ? '#1d5a2a' : col === '#1f5bb8' ? '#10346e' : '#9aa6bf'
    if (d > 0.93) col = '#6fb0ff'
    return col
  })
}

function drawMoon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const craters = [[-3, -2, 2], [3, 2, 2], [-1, 4, 1], [2, -4, 1]]
  disc(ctx, cx, cy, r, (dx, dy, d) => {
    for (const [x, y, cr] of craters) if ((dx - x) ** 2 + (dy - y) ** 2 <= cr * cr) return '#8a8d96'
    if (dx * 0.7 + dy * 0.7 > r * 0.4) return '#7b7e87'
    return d > 0.9 ? '#b9bcc6' : '#cfd2db'
  })
}

function drawCubeSat(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const px = Math.round(x), py = Math.round(y)
  const r = (c: string, a: number, b: number, w: number, h: number) => { ctx.fillStyle = c; ctx.fillRect(px + a, py + b, w, h) }
  // solar panels
  r('#000', -14, -2, 10, 6); r('#2a5cff', -13, -1, 8, 4); r('#7fb0ff', -13, -1, 8, 1)
  r('#000', 8, -2, 10, 6); r('#2a5cff', 9, -1, 8, 4); r('#7fb0ff', 9, -1, 8, 1)
  // body
  r('#000', -5, -4, 14, 10); r('#cfd6e4', -4, -3, 12, 8); r('#ffffff', -4, -3, 12, 1); r('#7d869c', -4, 4, 12, 1)
  r('#e63946', -1, -1, 4, 3)
  // antenna + blinking led
  r('#aaa', 2, -7, 1, 3)
  if (Math.floor(t * 3) % 2 === 0) r('#ff3b3b', 1, -8, 3, 2)
}

export default function SpaceCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let W = 0, H = 0
    let far: Star[] = [], mid: Star[] = [], bright: Star[] = []
    let raf = 0
    const start = performance.now()

    const resize = () => {
      W = Math.ceil(window.innerWidth / PX)
      H = Math.ceil(window.innerHeight / PX)
      canvas.width = W
      canvas.height = H
      ctx.imageSmoothingEnabled = false
      far = makeStars(160, W, H, ['#5a6a9a', '#7a86b0', '#445'])
      mid = makeStars(70, W, H, ['#cfd8ff', '#a8c0ff', '#ffe9b0'])
      bright = makeStars(22, W, H, ['#ffffff', '#9ff', '#fff6a0'])
    }
    resize()
    window.addEventListener('resize', resize)

    const wrapX = (x: number, span: number) => ((x % span) + span) % span

    const frame = (now: number) => {
      const t = (now - start) / 1000
      // gradient-ish background in bands
      const bandsC = ['#04030d', '#060416', '#080620', '#0a0728', '#0c0a2e']
      const bh = Math.ceil(H / bandsC.length)
      bandsC.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * bh, W, bh) })

      // Nebula (very slow parallax), pixel blobs purple / cyan
      const nebSpan = W + 300
      const nx = -wrapX(t * 2, nebSpan)
      for (let rep = 0; rep < 2; rep++) {
        const ox = nx + rep * nebSpan
        const blobs: [number, number, number, string][] = [
          [W * 0.25, H * 0.3, 90, '140,60,200'], [W * 0.5, H * 0.45, 110, '40,180,220'],
          [W * 0.75, H * 0.25, 80, '170,70,190'], [W * 0.1, H * 0.7, 100, '50,120,220'], [W * 0.62, H * 0.8, 90, '120,50,180'],
        ]
        for (const [bx, by, br, rgb] of blobs) {
          for (let s = 4; s >= 1; s--) {
            const rr = (br * s) / 4
            ctx.fillStyle = `rgba(${rgb},${0.045})`
            for (let y = -rr; y < rr; y += 3)
              for (let x = -rr; x < rr; x += 3) {
                const n = Math.sin(x * 0.13 + by) * Math.cos(y * 0.11 + bx) + 0.3 * Math.sin((x + y) * 0.3)
                if (Math.sqrt(x * x + y * y) < rr * (0.75 + 0.25 * n)) ctx.fillRect(Math.round(bx + ox + x), Math.round(by + y), 3, 3)
              }
          }
        }
      }

      // Star layers
      const layer = (stars: Star[], speed: number, size: number, twinkle: boolean) => {
        for (const s of stars) {
          const x = wrapX(s.x - t * speed, W)
          let a = 1
          if (twinkle) a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (2 + s.s * 3) + s.phase))
          ctx.globalAlpha = a
          ctx.fillStyle = s.c
          ctx.fillRect(Math.floor(x), Math.floor(s.y), size, size)
          if (twinkle && size > 1 && a > 0.85) { // cross sparkle
            ctx.fillRect(Math.floor(x) - 1, Math.floor(s.y), 3, 1)
            ctx.fillRect(Math.floor(x), Math.floor(s.y) - 1, 1, 3)
          }
        }
        ctx.globalAlpha = 1
      }
      layer(far, 2, 1, false)
      layer(mid, 5, 1, true)

      // Ringed planet (parallax slow), loops across a wide span
      const span = W + 260
      const ppx = W - wrapX(t * 4 + W * 0.35, span) + 100
      drawRingedPlanet(ctx, ppx - 130, H * 0.28, Math.round(Math.min(34, H * 0.1)))

      // Moon + Earth far away (slower)
      const eSpan = W + 220
      const ex = W + 60 - wrapX(t * 3 + W * 0.2, eSpan)
      drawEarth(ctx, ex, H * 0.72, Math.round(Math.min(30, H * 0.09)), t)
      drawMoon(ctx, ex + 52, H * 0.72 - 30, 7)

      layer(bright, 10, 2, true)

      // CubeSat crossing a gentle orbit
      const cs = 40
      const cx = ((t * cs) % (W + 80)) - 40
      const cy = H * 0.52 + Math.sin(t * 0.6 + cx * 0.015) * 14
      drawCubeSat(ctx, cx, cy, t)

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return (
    <canvas
      ref={ref}
      className="fixed inset-0 w-full h-full"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
