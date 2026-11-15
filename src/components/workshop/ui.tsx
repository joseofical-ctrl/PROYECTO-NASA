import type { ReactNode } from 'react'

export function Section({
  title,
  children,
  color = '#ffd23f',
}: {
  title: string
  children: ReactNode
  color?: string
}) {
  return (
    <section className="mb-2">
      <h3
        className="text-[clamp(9px,0.72vw,11px)] mb-1 pb-0.5 truncate"
        style={{ color, borderBottom: '2px solid #000', textShadow: '2px 2px 0 #000' }}
      >
        {title}
      </h3>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  )
}

/** Medidor / Barra grande estilo HUD Arcade con estado OK (verde) o ALERTA (rojo) */
export function BigGauge({
  icon,
  label,
  valueText,
  ratio,
  ok,
  subText,
}: {
  icon: string
  label: string
  valueText: string
  ratio: number
  ok: boolean
  subText?: string
}) {
  const clamped = Math.max(0, Math.min(1, ratio))
  const col = ok ? '#2ecc71' : '#ff4d4d'
  const badgeBg = ok ? '#103b25' : '#4a1414'

  return (
    <div
      className="px-2 py-1.5 flex flex-col gap-1 min-w-0"
      style={{
        background: '#13172b',
        border: `3px solid ${ok ? '#235c3b' : '#7a2222'}`,
        boxShadow: 'inset 2px 2px 0 #0a0c18',
      }}
    >
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <span className="text-[clamp(8.5px,0.68vw,10px)] text-white flex items-center gap-1 min-w-0 truncate">
          <span className="shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        <span
          className="text-[clamp(7.5px,0.58vw,9px)] px-1.5 py-0.5 font-bold border border-black shrink-0"
          style={{ background: badgeBg, color: col }}
        >
          {ok ? 'OK' : 'ALERTA'}
        </span>
      </div>

      <div
        className="text-[clamp(9px,0.72vw,11px)] font-bold tracking-wide truncate"
        style={{ color: col }}
      >
        {valueText}
      </div>

      <div className="h-3 p-[2px]" style={{ background: '#060812', border: '2px solid #000' }}>
        <div
          className="h-full transition-all duration-200"
          style={{
            width: `${clamped * 100}%`,
            background: `repeating-linear-gradient(90deg, ${col} 0 8px, rgba(0,0,0,0.45) 8px 10px)`,
          }}
        />
      </div>

      {subText && <div className="text-[clamp(8px,0.62vw,9px)] text-gray-300 truncate">{subText}</div>}
    </div>
  )
}

export function Box({ children }: { children: ReactNode }) {
  return (
    <div
      className="px-2 py-1.5 flex flex-col gap-1 min-w-0"
      style={{
        background: '#13172b',
        border: '3px solid #000',
        boxShadow: 'inset 2px 2px 0 #2d3354',
      }}
    >
      {children}
    </div>
  )
}
