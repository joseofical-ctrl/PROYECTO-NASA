import { useEffect, useRef, useState } from 'react'

export type MinigameId = 'nav' | 'eps' | 'eclss' | 'dock' | 'lander' | 'telecom' | 'comet' | 'cyber'

export interface MinigameModalProps {
  onClose: () => void
  onComplete: (game: MinigameId) => void
}

interface FrameProps extends MinigameModalProps {
  game: MinigameId
  file: string
  query?: string
  title: string
  accent: string
}

/**
 * Modal grande a pantalla completa que ejecuta el minijuego original del equipo
 * (HTML/Canvas/Web Audio en /public/minigames) y lo conecta con la estación vía postMessage.
 */
export default function MinigameFrame({ game, file, query, title, accent, onClose, onComplete }: FrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [completed, setCompleted] = useState(false)
  const completedRef = useRef(false)

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const data = e.data as { type?: string; game?: string; success?: boolean } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'minigame-close') {
        onClose()
      } else if (
        (data.type === 'MINIGAME_COMPLETE' && data.success !== false && !completedRef.current) ||
        (data.type === 'minigame-complete' && data.success && !completedRef.current)
      ) {
        completedRef.current = true
        setCompleted(true)
        onComplete(game)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKey)
    }
  }, [game, onClose, onComplete])

  const src = `${import.meta.env.BASE_URL}minigames/${file}${query ? `?${query}` : ''}`

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black"
      role="dialog"
      aria-label={title}
      style={{ fontFamily: '"Press Start 2P", monospace' }}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-3 px-3 py-2"
        style={{ background: '#090d1a', borderBottom: `3px solid ${accent}` }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-[11px] leading-snug" style={{ color: accent }}>
            {title}
          </span>
          {completed && (
            <span
              className="shrink-0 border px-2 py-1 text-[9px] leading-snug"
              style={{ color: '#4ade80', borderColor: '#4ade80', background: '#022c22' }}
            >
              ✔ ESTACIÓN ACTUALIZADA
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 border-2 px-3 py-2 text-[10px] leading-snug hover:brightness-125"
          style={{ color: '#fde047', borderColor: '#fde047', background: '#1a1405' }}
        >
          [ ✕ VOLVER A LA ESTACIÓN (ESC) ]
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        className="min-h-0 w-full flex-1 border-0"
        onLoad={() => iframeRef.current?.contentWindow?.focus()}
      />
    </div>
  )
}
