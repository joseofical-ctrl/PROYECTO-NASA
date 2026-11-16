import { useEffect, useRef, useState } from 'react'
import { isMusicOn, setMusic } from '../audio'

interface Props {
  reason: string
  missionLabel: string
  onRetryMission: () => void
  onExitToMenu: () => void
}

/**
 * Cinemática fullscreen de colisión orbital 32x32 + explosión + overlay GAME OVER.
 * Conecta con /minigames/game_over_explosion.html mediante postMessage.
 */
export default function GameOverExplosionModal({
  reason,
  missionLabel,
  onRetryMission,
  onExitToMenu,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    const wasOn = isMusicOn()
    if (wasOn) {
      setMusic(false)
    }
    return () => {
      if (wasOn) {
        setMusic(true)
      }
    }
  }, [])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (iframeRef.current?.contentWindow && e.source !== iframeRef.current.contentWindow) {
        return
      }
      const data = e.data as { type?: string } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'GAME_OVER_RETRY') {
        onRetryMission()
      } else if (data.type === 'GAME_OVER_MENU') {
        onExitToMenu()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onRetryMission, onExitToMenu])

  const [src] = useState(() => {
    const params = new URLSearchParams({
      reason: reason || 'Orbital integrity collapsed to 0%.',
      mission: missionLabel || '',
    })
    return `${import.meta.env.BASE_URL}minigames/game_over_explosion.html?${params.toString()}`
  })

  return (
    <div
      className="fixed inset-0 z-[200] bg-black flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="GAME OVER — Orbital Collision"
      style={{ fontFamily: '"Press Start 2P", monospace' }}
    >
      <iframe
        ref={iframeRef}
        src={src}
        title="32x32 Orbital Collision Cinematic & GAME OVER"
        className="w-full h-full flex-1 border-0"
      />
    </div>
  )
}
