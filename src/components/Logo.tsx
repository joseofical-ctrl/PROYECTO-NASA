import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'

export const SPLASHES = [
  'Now with 80% battery DoD!',
  'Watch that Link Budget!',
  'Tsiolkovsky approves this bus!',
  '100% NASA SSRI Engineering Data!',
  "Don't forget L1 radiation shielding!",
]

// Thick black outline + stacked dark blue/grey extrusion going down (block/titanium look)
function extrude(depth: number, unit: number): string {
  const shadows: string[] = []
  const o = unit
  // black outline around the front face
  for (const [x, y] of [[-o, -o], [0, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [o, o]]) shadows.push(`${x}px ${y}px 0 #000`)
  // extrusion layers
  for (let i = 1; i <= depth; i++) {
    shadows.push(`${i * 0.4}px ${i}px 0 ${i % 2 ? '#3a4766' : '#2c3652'}`)
    shadows.push(`${o + i * 0.4}px ${o + i}px 0 #000`)
  }
  return shadows.join(',')
}

interface Props { onLogoDone: () => void }

export default function Logo({ onLogoDone }: Props) {
  const [showSplash, setShowSplash] = useState(false)
  const splash = useMemo(() => SPLASHES[Math.floor(Math.random() * SPLASHES.length)], [])

  useEffect(() => {
    const t = window.setTimeout(() => { setShowSplash(true); onLogoDone() }, 1400)
    return () => window.clearTimeout(t)
  }, [onLogoDone])

  const faceStyle = (size: string, unit: number, depth: number): React.CSSProperties => ({
    fontSize: size,
    color: '#5ef0ff',
    textShadow: extrude(depth, unit),
    letterSpacing: '0.04em',
    lineHeight: 1.1,
  })

  return (
    <div style={{ perspective: 900 }} className="relative mb-6 sm:mb-8">
      <motion.div
        initial={{ scale: 0.1, opacity: 0, rotateX: 55, z: -600 }}
        animate={{ scale: [0.1, 1.18, 0.94, 1.04, 1], opacity: [0, 1, 1, 1, 1], rotateX: [55, -6, 3, -1, 0] }}
        transition={{ duration: 1.4, times: [0, 0.5, 0.7, 0.85, 1], ease: 'easeOut' }}
        className="font-pixel text-center relative z-10"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <div style={faceStyle('clamp(28px, 6.8vw, 80px)', 4, 8)}>CUBESAT</div>
        <div style={{ ...faceStyle('clamp(24px, 5.6vw, 66px)', 4, 8), color: '#9be8ff', marginTop: 10 }}>ARCHITECT</div>
        <div
          className="mt-5 inline-block px-3 py-1 text-[10px] sm:text-xs tracking-widest"
          style={{ color: '#fff', background: '#0b1230', border: '3px solid #000', boxShadow: 'inset 0 0 0 2px #2a5cff, 3px 3px 0 #000' }}
        >
          NASA SPACE APPS EDITION
        </div>
      </motion.div>

      {showSplash && (
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 12 }}
          className="absolute z-20 pointer-events-none"
          style={{ right: '-2%', bottom: '-18px' }}
        >
          <div className="splash font-pixel whitespace-nowrap text-[10px] sm:text-xs" style={{ color: '#ffff00', textShadow: '3px 3px 0 #3f3f00' }}>
            {splash}
          </div>
        </motion.div>
      )}
    </div>
  )
}
