import { useEffect, useRef, useState } from 'react'

export type MinigameId =
  | 'nav'
  | 'eps'
  | 'eclss'
  | 'dock'
  | 'lander'
  | 'telecom'
  | 'comet'
  | 'cyber'
  | 'gyro'
  | 'debris'
  | 'reactor'
  | 'pcb'
  | 'spectro'
  | 'thermal'
  | 'hga'
  | 'decrypt'

export const MINIGAME_META: Record<
  MinigameId,
  { file: string; title: string; accent: string }
> = {
  dock: {
    file: 'acoplamiento_espacial.html',
    title: '6-DOF APAS SPACECRAFT DOCKING · CONDOR-4',
    accent: '#ffd23f',
  },
  comet: {
    file: 'reencuentro_cometa.html',
    title: 'ORBITAL METEOROID DEFENSE · CONDOR-4',
    accent: '#fb923c',
  },
  gyro: {
    file: 'calibracion_giroscopio.html',
    title: '3D GYROSCOPE CALIBRATION & ADCS CONTROL · CONDOR-4',
    accent: '#facc15',
  },
  debris: {
    file: 'eyeccion_escombros.html',
    title: 'KESSLER ORBITAL RADAR & DEBRIS EJECTION · CONDOR-4',
    accent: '#f59e0b',
  },
  eps: {
    file: 'distribucion_electrica.html',
    title: 'EPS ELECTRICAL POWER DISTRIBUTION · ALPACA-1',
    accent: '#ff9f1c',
  },
  eclss: {
    file: 'soporte_vital.html',
    title: 'ECLSS LIFE SUPPORT & O2 TANKS · ALPACA-1',
    accent: '#4ade80',
  },
  reactor: {
    file: 'refrigeracion_reactor.html',
    title: 'CRYOGENIC REACTOR COOLING · ALPACA-1',
    accent: '#fb923c',
  },
  pcb: {
    file: 'reparacion_circuitos.html',
    title: 'PCB BUS ROUTING & BYPASS · ALPACA-1',
    accent: '#34d399',
  },
  lander: {
    file: 'aterrizaje_planetario.html',
    title: 'SCIENCE PROBE PLANETARY LANDING · PUMA-3',
    accent: '#55efc4',
  },
  nav: {
    file: 'navegacion_orbital.html',
    title: 'DUAL HOHMANN ORBITAL NAVIGATION · PUMA-3',
    accent: '#2dd4bf',
  },
  spectro: {
    file: 'espectrometria_masas.html',
    title: 'GLACIAL MASS SPECTROMETRY · PUMA-3',
    accent: '#22d3ee',
  },
  thermal: {
    file: 'telemetria_multiespectral.html',
    title: 'MULTISPECTRAL IR/UV TELEMETRY · PUMA-3',
    accent: '#a78bfa',
  },
  telecom: {
    file: 'reparacion_telecom.html',
    title: 'DSN TELECOMMUNICATIONS TUNING · SERPIENTE-2',
    accent: '#38bdf8',
  },
  cyber: {
    file: 'ciberdefensa_satelital.html',
    title: 'SATELLITE CYBER DEFENSE & FIREWALL 8080 · SERPIENTE-2',
    accent: '#60a5fa',
  },
  hga: {
    file: 'alineacion_antena_dsn.html',
    title: 'DSN HIGH-GAIN ANTENNA ALIGNMENT · SERPIENTE-2',
    accent: '#74b9ff',
  },
  decrypt: {
    file: 'desencriptacion_cuantica.html',
    title: 'QUANTUM DECRYPTION & CRC CHECKSUM · SERPIENTE-2',
    accent: '#818cf8',
  },
}

export interface MinigameModalProps {
  onClose: () => void
  onComplete: (game: MinigameId) => void
  onFail?: (game: MinigameId) => void
  threatQuery?: string
  threatState?: Record<string, number | string>
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
export default function MinigameFrame({
  game,
  file,
  query,
  threatQuery,
  threatState,
  title,
  accent,
  onClose,
  onComplete,
  onFail,
}: FrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [completed, setCompleted] = useState(false)
  const [wonPending, setWonPending] = useState(false)
  const completedRef = useRef(false)
  const wonPendingRef = useRef(false)
  const lastFailAtRef = useRef(0)
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail

  const confirmAndClose = () => {
    if (wonPendingRef.current && !completedRef.current) {
      completedRef.current = true
      setCompleted(true)
      onComplete(game)
    }
    onClose()
  }

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const data = e.data as { type?: string; game?: string; success?: boolean } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'MINIGAME_WON_PENDING') {
        wonPendingRef.current = true
        setWonPending(true)
      } else if (data.type === 'minigame-close') {
        if (wonPendingRef.current && !completedRef.current) {
          completedRef.current = true
          setCompleted(true)
          onComplete(game)
        }
        onClose()
      } else if (data.type === 'MINIGAME_FAILED' && !completedRef.current) {
        const now = Date.now()
        if (now - lastFailAtRef.current > 400) {
          lastFailAtRef.current = now
          onFailRef.current?.(game)
        }
      } else if (
        (data.type === 'MINIGAME_COMPLETE' && data.success !== false && !completedRef.current) ||
        (data.type === 'minigame-complete' && data.success && !completedRef.current)
      ) {
        completedRef.current = true
        wonPendingRef.current = true
        setCompleted(true)
        setWonPending(true)
        onComplete(game)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (wonPendingRef.current && !completedRef.current) {
          completedRef.current = true
          setCompleted(true)
          onComplete(game)
        }
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

  const [src] = useState(() => {
    const combinedQuery = [query, threatQuery].filter(Boolean).join('&')
    return `${import.meta.env.BASE_URL}minigames/${file}${combinedQuery ? `?${combinedQuery}` : ''}`
  })

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
          {(completed || wonPending) && (
            <span
              className="shrink-0 border px-2 py-1 text-[9px] leading-snug"
              style={{ color: '#4ade80', borderColor: '#4ade80', background: '#022c22' }}
            >
              ✔ SYSTEM RESOLVED
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!(completed || wonPending) && (
            <button
              type="button"
              onClick={() => {
                const cw = iframeRef.current?.contentWindow
                if (cw) {
                  try {
                    cw.postMessage({ type: 'REQUEST_VERIFY_MINIGAME', game }, '*')
                  } catch {
                    // ignore postMessage errors
                  }
                }
              }}
              className="shrink-0 border-2 px-3 py-2 text-[9.5px] font-bold leading-snug hover:brightness-125"
              style={{
                color: '#ecfeff',
                borderColor: '#22d3ee',
                background: 'linear-gradient(180deg, #059669 0%, #0e7490 100%)',
                boxShadow: '0 0 12px rgba(34, 211, 238, 0.35)',
              }}
            >
              [ ✔ CONFIRM &amp; VALIDATE SYSTEM ]
            </button>
          )}
          <button
            type="button"
            onClick={confirmAndClose}
            className="shrink-0 border-2 px-3 py-2 text-[10px] leading-snug hover:brightness-125"
            style={{
              color: completed || wonPending ? '#4ade80' : '#fde047',
              borderColor: completed || wonPending ? '#4ade80' : '#fde047',
              background: completed || wonPending ? '#022c22' : '#1a1405',
            }}
          >
            {completed || wonPending
              ? '[ ✔ RETURN TO STATION ]'
              : '[ ✕ RETURN TO STATION (ESC) ]'}
          </button>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        className="min-h-0 w-full flex-1 border-0"
        onLoad={() => {
          const cw = iframeRef.current?.contentWindow
          if (cw) {
            cw.focus()
            if (threatState) {
              try {
                cw.postMessage({ type: 'THREAT_SYNC', ...threatState }, '*')
              } catch {
                // ignore postMessage errors
              }
            }
          }
        }}
      />
    </div>
  )
}
