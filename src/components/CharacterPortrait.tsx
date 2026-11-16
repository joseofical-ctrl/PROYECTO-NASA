import { useEffect, useRef } from 'react'
import type { CharacterId, RoleId } from '../game/catalog'
import { ROLE_INFO } from '../game/catalog'
import { renderAstronautSceneCanvas } from '../game/astronautSprite'

interface Props {
  characterId: CharacterId | RoleId
  variant?: 'scene' | 'avatar'
  className?: string
  size?: number
}

const CHAR_MAP: Record<CharacterId | RoleId, CharacterId> = {
  alpaca: 'alpaca',
  serpiente: 'serpiente',
  puma: 'puma',
  condor: 'condor',
  engineer: 'alpaca',
  comms: 'serpiente',
  science: 'puma',
  director: 'condor',
}

/** Detailed Pixel-Art SVG Fallbacks & Mini Avatars for each Andean Astronaut */
function PixelAnimalSvg({ id, className = '' }: { id: CharacterId; className?: string }) {
  if (id === 'alpaca') {
    return (
      <svg viewBox="0 0 16 16" className={`w-full h-full ${className}`} shapeRendering="crispEdges">
        <rect width="16" height="16" fill="#182238" />
        {/* Stars & Hangar wall */}
        <rect x="1" y="1" width="1" height="1" fill="#5ef0ff" />
        <rect x="13" y="2" width="1" height="1" fill="#fff" />
        {/* Suit shoulders */}
        <rect x="3" y="12" width="10" height="4" fill="#e5ebf7" />
        <rect x="4" y="13" width="8" height="3" fill="#cfd6e4" />
        <rect x="6" y="13" width="4" height="2" fill="#e63946" />
        <rect x="5" y="11" width="6" height="2" fill="#8590a8" />
        {/* Alpaca ears & wool */}
        <rect x="5" y="2" width="2" height="3" fill="#fff8e7" />
        <rect x="9" y="2" width="2" height="3" fill="#fff8e7" />
        <rect x="6" y="3" width="1" height="2" fill="#f4a261" />
        <rect x="9" y="3" width="1" height="2" fill="#f4a261" />
        {/* Fluffy head */}
        <rect x="4" y="4" width="8" height="7" fill="#fff8e7" />
        <rect x="5" y="3" width="6" height="2" fill="#ffffff" />
        {/* Face details */}
        <rect x="5" y="6" width="2" height="2" fill="#1d1e2c" />
        <rect x="9" y="6" width="2" height="2" fill="#1d1e2c" />
        <rect x="5" y="6" width="1" height="1" fill="#fff" />
        <rect x="9" y="6" width="1" height="1" fill="#fff" />
        <rect x="6" y="7" width="4" height="3" fill="#f3d5b5" />
        <rect x="7" y="7" width="2" height="1" fill="#8d5b4c" />
        <rect x="7" y="9" width="2" height="1" fill="#8d5b4c" />
        {/* Glass Helmet Bubble Outline & Glint */}
        <rect x="3" y="1" width="10" height="1" fill="#5ef0ff" />
        <rect x="2" y="2" width="1" height="9" fill="#5ef0ff" />
        <rect x="13" y="2" width="1" height="9" fill="#5ef0ff" />
        <rect x="3" y="11" width="10" height="1" fill="#8590a8" />
        <rect x="4" y="2" width="2" height="1" fill="#ffffff" />
        <rect x="3" y="3" width="1" height="2" fill="#ffffff" />
      </svg>
    )
  }

  if (id === 'serpiente') {
    return (
      <svg viewBox="0 0 16 16" className={`w-full h-full ${className}`} shapeRendering="crispEdges">
        <rect width="16" height="16" fill="#0d1326" />
        {/* Radio wave background */}
        <rect x="1" y="3" width="2" height="1" fill="#74b9ff" />
        <rect x="13" y="4" width="2" height="1" fill="#74b9ff" />
        {/* Coiled orange/black body & space collar */}
        <rect x="3" y="12" width="10" height="4" fill="#e76f51" />
        <rect x="5" y="13" width="2" height="3" fill="#1d1e2c" />
        <rect x="10" y="13" width="2" height="3" fill="#1d1e2c" />
        <rect x="4" y="11" width="8" height="2" fill="#adb5bd" />
        <rect x="6" y="11" width="4" height="1" fill="#5ef0ff" />
        {/* Snake head */}
        <rect x="5" y="4" width="6" height="6" fill="#e76f51" />
        <rect x="4" y="5" width="8" height="4" fill="#f4a261" />
        <rect x="6" y="4" width="4" height="1" fill="#2a9d8f" />
        {/* Slit eyes */}
        <rect x="5" y="6" width="2" height="2" fill="#ffd23f" />
        <rect x="9" y="6" width="2" height="2" fill="#ffd23f" />
        <rect x="6" y="6" width="1" height="2" fill="#000" />
        <rect x="9" y="6" width="1" height="2" fill="#000" />
        {/* Forked tongue */}
        <rect x="7" y="9" width="2" height="2" fill="#e63946" />
        <rect x="6" y="10" width="1" height="1" fill="#e63946" />
        <rect x="9" y="10" width="1" height="1" fill="#e63946" />
        {/* Helmet Bubble */}
        <rect x="3" y="2" width="10" height="1" fill="#74b9ff" />
        <rect x="2" y="3" width="1" height="8" fill="#74b9ff" />
        <rect x="13" y="3" width="1" height="8" fill="#74b9ff" />
        <rect x="4" y="3" width="2" height="1" fill="#fff" />
      </svg>
    )
  }

  if (id === 'puma') {
    return (
      <svg viewBox="0 0 16 16" className={`w-full h-full ${className}`} shapeRendering="crispEdges">
        <rect width="16" height="16" fill="#24152b" />
        {/* Planet & stars */}
        <rect x="12" y="2" width="2" height="2" fill="#55efc4" />
        <rect x="2" y="2" width="1" height="1" fill="#fff" />
        {/* NASA Suit */}
        <rect x="3" y="12" width="10" height="4" fill="#e5ebf7" />
        <rect x="5" y="13" width="3" height="2" fill="#1d4ed8" />
        <rect x="9" y="13" width="2" height="1" fill="#e63946" />
        <rect x="4" y="11" width="8" height="1" fill="#8590a8" />
        {/* Puma ears & head */}
        <rect x="4" y="3" width="2" height="2" fill="#d98c4a" />
        <rect x="10" y="3" width="2" height="2" fill="#d98c4a" />
        <rect x="4" y="4" width="8" height="7" fill="#d98c4a" />
        <rect x="5" y="5" width="6" height="5" fill="#e8a867" />
        {/* Fierce eyes & muzzle */}
        <rect x="5" y="6" width="2" height="2" fill="#55efc4" />
        <rect x="9" y="6" width="2" height="2" fill="#55efc4" />
        <rect x="6" y="6" width="1" height="2" fill="#000" />
        <rect x="9" y="6" width="1" height="2" fill="#000" />
        <rect x="6" y="8" width="4" height="2" fill="#fff8e7" />
        <rect x="7" y="8" width="2" height="1" fill="#1d1e2c" />
        {/* Helmet Bubble */}
        <rect x="3" y="1" width="10" height="1" fill="#55efc4" />
        <rect x="2" y="2" width="1" height="9" fill="#55efc4" />
        <rect x="13" y="2" width="1" height="9" fill="#55efc4" />
        <rect x="4" y="2" width="2" height="1" fill="#fff" />
      </svg>
    )
  }

  // condor
  return (
    <svg viewBox="0 0 16 16" className={`w-full h-full ${className}`} shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#151b30" />
      {/* Control screens */}
      <rect x="1" y="2" width="2" height="2" fill="#ffd23f" />
      <rect x="13" y="2" width="2" height="2" fill="#5ef0ff" />
      {/* Orange flight suit & dark wings */}
      <rect x="2" y="12" width="12" height="4" fill="#f46036" />
      <rect x="1" y="12" width="2" height="4" fill="#2b2d42" />
      <rect x="13" y="12" width="2" height="4" fill="#2b2d42" />
      {/* White Andean Condor Collar Ruff */}
      <rect x="4" y="9" width="8" height="3" fill="#ffffff" />
      <rect x="5" y="10" width="6" height="2" fill="#e5ebf7" />
      {/* Condor Head & Crest */}
      <rect x="6" y="3" width="4" height="2" fill="#c1121f" />
      <rect x="5" y="4" width="6" height="5" fill="#e07a5f" />
      {/* Hooked golden/ivory beak */}
      <rect x="3" y="6" width="3" height="2" fill="#ffd23f" />
      <rect x="3" y="7" width="1" height="2" fill="#e9c46a" />
      {/* Sharp eye */}
      <rect x="7" y="5" width="2" height="2" fill="#ffd23f" />
      <rect x="7" y="5" width="1" height="1" fill="#000" />
      {/* Helmet Bubble */}
      <rect x="3" y="1" width="10" height="1" fill="#ffd23f" />
      <rect x="2" y="2" width="1" height="9" fill="#ffd23f" />
      <rect x="13" y="2" width="1" height="9" fill="#ffd23f" />
      <rect x="4" y="2" width="2" height="1" fill="#fff" />
    </svg>
  )
}

function CharacterSceneCanvas({ role, color, code }: { role: RoleId; color: string; code: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let tick = 0
    renderAstronautSceneCanvas(ctx, role, canvas.width, canvas.height, tick)

    const timer = window.setInterval(() => {
      tick = (tick + 1) % 24
      renderAstronautSceneCanvas(ctx, role, canvas.width, canvas.height, tick)
    }, 340)

    return () => window.clearInterval(timer)
  }, [role])

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      style={{
        border: '3px solid #000',
        boxShadow: `inset 0 0 0 2px ${color}`,
      }}
    >
      <canvas
        ref={canvasRef}
        width={132}
        height={84}
        className="w-full h-full block"
        style={{ imageRendering: 'pixelated' }}
      />
      <div
        className="text-[9px] leading-none absolute bottom-1 right-1 px-1.5 py-1 font-pixel pointer-events-none"
        style={{
          background: '#0b0d1ce6',
          color,
          border: '2px solid #000',
        }}
      >
        {code}
      </div>
    </div>
  )
}

export default function CharacterPortrait({
  characterId,
  variant = 'scene',
  className = '',
  size,
}: Props) {
  const charId = CHAR_MAP[characterId]
  const roleKey = (Object.keys(ROLE_INFO) as RoleId[]).find((r) => ROLE_INFO[r].characterId === charId)!
  const info = ROLE_INFO[roleKey]
  const sizeStyle = size ? { width: size, height: size } : undefined

  if (variant === 'avatar') {
    return (
      <div
        className={`relative overflow-hidden select-none shrink-0 ${className}`}
        style={{
          ...sizeStyle,
          border: '2px solid #000',
          boxShadow: `inset 0 0 0 1px ${info.color}`,
          imageRendering: 'pixelated',
        }}
      >
        <PixelAnimalSvg id={charId} />
      </div>
    )
  }

  return (
    <div
      className={`relative w-full h-full overflow-hidden select-none ${className}`}
      style={sizeStyle}
    >
      <CharacterSceneCanvas role={roleKey} color={info.color} code={info.code} />
    </div>
  )
}

/** RPG retro red (HP/Energía) & blue (Especialidad) bars */
export function RpgStatBars({
  characterId,
  compact = false,
}: {
  characterId: CharacterId | RoleId
  compact?: boolean
}) {
  const charId = CHAR_MAP[characterId]
  const roleKey = (Object.keys(ROLE_INFO) as RoleId[]).find((r) => ROLE_INFO[r].characterId === charId)!
  const info = ROLE_INFO[roleKey]

  return (
    <div className={`flex flex-col ${compact ? 'gap-1' : 'gap-1.5'} w-full font-pixel`}>
      {/* Red HP / Energy Bar */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] leading-none text-red-400 w-7 shrink-0">HP</span>
        <div
          className={`flex-1 ${compact ? 'h-2' : 'h-2.5'} p-[1px]`}
          style={{ background: '#140c1c', border: '2px solid #000' }}
        >
          <div
            className="h-full"
            style={{
              width: `${info.hp}%`,
              background: 'linear-gradient(180deg, #ff6b6b 0%, #c92a2a 60%, #8a1c1c 100%)',
            }}
          />
        </div>
      </div>
      {/* Blue Specialty Bar */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] leading-none text-cyan-300 w-7 shrink-0">SP</span>
        <div
          className={`flex-1 ${compact ? 'h-2' : 'h-2.5'} p-[1px]`}
          style={{ background: '#0c162c', border: '2px solid #000' }}
        >
          <div
            className="h-full"
            style={{
              width: `${info.sp}%`,
              background: 'linear-gradient(180deg, #74c0fc 0%, #1c7ed6 60%, #1864ab 100%)',
            }}
          />
        </div>
      </div>
    </div>
  )
}
