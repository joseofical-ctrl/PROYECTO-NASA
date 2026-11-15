import { CONTRACTS, PART_BY_ID } from '../../game/catalog'
import type { RoleId } from '../../game/catalog'
import type { Telemetry } from '../../game/sim'
import { BigGauge, Box } from './ui'
import { playClick, playHover } from '../../audio'

/** 1) 🦅 DIRECTOR (CÓNDOR-4) */
function Director({
  t,
  onLaunch,
  launchReady,
}: {
  t: Telemetry
  onLaunch: () => void
  launchReady?: boolean
}) {
  const orbitOk = t.orbitReachable && t.launcherFitsChassis
  const energyOk = t.genW >= t.loadW && t.eclipseOk && t.dvOk && t.kradOk
  const scienceOk = t.sciPts >= t.sciGoal && t.mandatory.every((m) => m.have)
  const commsOk = t.linkOk

  const statusBadges = [
    { icon: '🌍', label: 'Órbita', ok: orbitOk },
    { icon: '⚡', label: 'Energía', ok: energyOk },
    { icon: '🔬', label: 'Ciencia', ok: scienceOk },
    { icon: '📡', label: 'Comms', ok: commsOk },
  ]

  return (
    <div className="flex flex-col gap-2">
      {/* 1) Barra de Presupuesto */}
      <BigGauge
        icon="💰"
        label="PRESUPUESTO"
        valueText={`$${t.cost}k / $${t.budget}k`}
        ratio={t.budget > 0 ? t.cost / t.budget : 0}
        ok={t.cost <= t.budget}
      />

      {/* 2) Barra de Masa */}
      <BigGauge
        icon="⚖️"
        label="MASA HÚMEDA"
        valueText={`${t.mass.toFixed(1)} / ${t.massCap} kg`}
        ratio={t.massCap > 0 ? t.mass / t.massCap : 0}
        ok={t.mass <= t.massCap}
      />

      {/* 3) Barra de Volumen (Slots U) */}
      <BigGauge
        icon="📦"
        label="VOLUMEN CHASIS"
        valueText={`${t.slotsUsed} / ${t.slotsCap} U`}
        ratio={t.slotsCap > 0 ? t.slotsUsed / t.slotsCap : 0}
        ok={t.slotsUsed <= t.slotsCap}
      />

      {/* 4) Resumen visual de 4 iconos grandes */}
      <div className="grid grid-cols-2 gap-1">
        {statusBadges.map((b) => (
          <div
            key={b.label}
            className="px-2 py-1.5 flex items-center justify-between border-2 border-black min-w-0"
            style={{
              background: b.ok ? '#113624' : '#3d1518',
              color: b.ok ? '#7bff9a' : '#ff8a8a',
            }}
          >
            <span className="text-[clamp(8px,0.62vw,9.5px)] flex items-center gap-1 truncate">
              <span>{b.icon}</span>
              <span className="truncate">{b.label}</span>
            </span>
            <span className="text-[clamp(8.5px,0.68vw,10px)] font-bold shrink-0">{b.ok ? 'OK' : '✖'}</span>
          </div>
        ))}
      </div>

      {/* Botón grande Autorizar Despegue */}
      <button
        onMouseEnter={playHover}
        onClick={() => {
          playClick()
          onLaunch()
        }}
        className="mc-btn w-full py-2.5 text-[clamp(9px,0.72vw,11px)] mt-0.5 font-bold"
        style={
          (launchReady ?? t.allOk)
            ? {
                background: '#15803d',
                color: '#7bff9a',
                borderColor: '#7bff9a',
                boxShadow: 'inset 4px 4px 0 #4ade80, inset -4px -4px 0 #14532d, 0 0 14px #22c55e88',
              }
            : undefined
        }
      >
        🚀 AUTORIZAR DESPEGUE
      </button>
    </div>
  )
}

/** 2) 🦙 INGENIERO (ALPACA-1) - Solo 4 barras grandes */
function Engineer({ t }: { t: Telemetry }) {
  const powerMax = Math.max(t.loadW, t.genW, 1)
  const eclMax = Math.max(t.eclipseNeedWh, t.batteryWh, 1)
  const dvMax = Math.max(t.dvReq, t.dvMs, 1)
  const kradMax = Math.max(t.kradReq, t.krad, 1)

  return (
    <div className="flex flex-col gap-2">
      {/* 1) Energía Diurna (W) */}
      <BigGauge
        icon="☀️"
        label="ENERGÍA DIURNA"
        valueText={`${t.genW.toFixed(1)}W gen / ${t.loadW.toFixed(1)}W`}
        ratio={t.genW / powerMax}
        ok={t.genW >= t.loadW}
      />

      {/* 2) Batería en Eclipse (Wh) */}
      <BigGauge
        icon="🔋"
        label="BATERÍA ECLIPSE"
        valueText={
          t.eclipseMin === 0
            ? 'Órbita L1 (Sin eclipse)'
            : `${t.batteryWh.toFixed(0)} / ${t.eclipseNeedWh.toFixed(0)} Wh`
        }
        ratio={t.eclipseMin === 0 ? 1 : t.batteryWh / eclMax}
        ok={t.eclipseOk}
      />

      {/* 3) Propulsión Delta-V (m/s) */}
      <BigGauge
        icon="🔥"
        label="PROPULSIÓN DELTA-V"
        valueText={`${Math.round(t.dvMs)} / ${t.dvReq} m/s`}
        ratio={t.dvReq === 0 ? 1 : t.dvMs / dvMax}
        ok={t.dvOk}
      />

      {/* 4) Blindaje Radiación (krad) */}
      <BigGauge
        icon="🛡️"
        label="BLINDAJE RADIACIÓN"
        valueText={`${t.krad} / ${t.kradReq} krad`}
        ratio={t.krad / kradMax}
        ok={t.kradOk}
      />
    </div>
  )
}

/** 3) 🐆 CIENTÍFICO (PUMA-3) */
function Science({ t }: { t: Telemetry }) {
  return (
    <div className="flex flex-col gap-2">
      {/* 1) Medidor gigante de Puntos de Ciencia */}
      <BigGauge
        icon="🔬"
        label="PUNTOS DE CIENCIA"
        valueText={`${t.sciPts.toFixed(0)} / ${t.sciGoal} pts`}
        ratio={t.sciGoal > 0 ? t.sciPts / t.sciGoal : 0}
        ok={t.sciPts >= t.sciGoal}
      />

      {/* 2) Los 2 Instrumentos Obligatorios */}
      <Box>
        <div className="text-[clamp(8.5px,0.68vw,10px)] text-cyan-300 mb-0.5">📋 OBLIGATORIOS</div>
        {t.mandatory.map((m) => {
          const part = PART_BY_ID[m.id]
          return (
            <div
              key={m.id}
              className="px-2 py-1.5 flex items-center justify-between border-2 border-black min-w-0"
              style={{
                background: m.have ? '#113624' : '#3d1518',
                color: m.have ? '#7bff9a' : '#ff9a9a',
              }}
            >
              <span className="text-[clamp(8px,0.65vw,10px)] truncate">
                {part?.icon} {m.name}
              </span>
              <span className="text-[10px] shrink-0 ml-1.5">{m.have ? '✅' : '❌'}</span>
            </div>
          )
        })}
      </Box>

      {/* 3) Un único resumen compacto de Consumo */}
      <div
        className="p-2 text-center"
        style={{
          background: '#171d36',
          border: '3px solid #000',
          boxShadow: 'inset 2px 2px 0 #2e3866',
        }}
      >
        <div className="text-[clamp(8.5px,0.68vw,10px)] text-yellow-300 mb-0.5">⚡ CONSUMO DE PAYLOAD</div>
        <div className="text-[clamp(8px,0.62vw,9px)] text-white leading-snug">
          Tus cámaras usan{' '}
          <strong className="text-orange-300">{t.sciPower.toFixed(1)} W</strong> y{' '}
          <strong className="text-cyan-300">{t.sciMass.toFixed(1)} kg</strong>
        </div>
      </div>
    </div>
  )
}

/** 4) 🐍 COMMS (SERPIENTE-2) */
function Comms({ t, contractId }: { t: Telemetry; contractId: string }) {
  const contract = CONTRACTS.find((c) => c.id === contractId)!
  const maxMbps = Math.max(t.dataGenMbps, t.downEffMbps, 0.1)
  const txPct =
    !t.hasAntenna || !t.bandOk
      ? 0
      : t.dataGenMbps <= 0
      ? 100
      : Math.min(100, Math.round((t.downEffMbps / t.dataGenMbps) * 100))

  const orbits: { id: 'LEO' | 'LLO' | 'L1'; label: string }[] = [
    { id: 'LEO', label: 'LEO' },
    { id: 'LLO', label: 'LUNA' },
    { id: 'L1', label: 'SOL L1' },
  ]

  // Si tiene antena en banda S/X llega a las 3; UHF solo LEO
  const reach = (orb: 'LEO' | 'LLO' | 'L1') => {
    if (!t.hasAntenna) return false
    if (orb === 'LEO') return true
    return t.downNominal >= 2
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 1) Barra comparativa grande de Datos Generados vs Descarga */}
      <BigGauge
        icon="📶"
        label="DATOS vs DESCARGA"
        valueText={`↓${t.downEffMbps.toFixed(2)} / ${t.dataGenMbps.toFixed(2)} Mbps`}
        ratio={t.downEffMbps / maxMbps}
        ok={t.linkOk}
      />

      {/* 2) Indicador visual de Alcance de Antena (LEO / Luna / L1) */}
      <Box>
        <div className="text-[10px] text-cyan-300">🛰️ ALCANCE DE ANTENA</div>
        <div className="grid grid-cols-3 gap-1.5">
          {orbits.map((o) => {
            const isTarget = contract.orbit === o.id
            const ok = reach(o.id)
            return (
              <div
                key={o.id}
                className="p-1.5 text-center border-2"
                style={{
                  background: ok ? '#113624' : '#3d1518',
                  borderColor: isTarget ? '#ffd23f' : '#000',
                  color: ok ? '#7bff9a' : '#ff8a8a',
                }}
              >
                <div className="text-[9px] font-bold">{o.label}</div>
                <div className="text-[11px] mt-0.5">{ok ? '✅' : '❌'}</div>
              </div>
            )
          })}
        </div>
      </Box>

      {/* 3) Porcentaje de Éxito de Transmisión */}
      <BigGauge
        icon="📡"
        label="ÉXITO DE TRANSMISIÓN"
        valueText={`${txPct}% TRANSMITIDO`}
        ratio={txPct / 100}
        ok={txPct >= 100 && t.hasAntenna}
      />
    </div>
  )
}

export default function TelemetryPanel({
  role,
  t,
  contractId,
  onLaunch,
  bothSatsReady,
  canLaunch = false,
}: {
  role: RoleId
  t: Telemetry
  contractId: string
  onLaunch: () => void
  bothSatsReady?: boolean
  canLaunch?: boolean
}) {
  const roleSpend = t.roleCosts[role] ?? 0
  const rolePct = t.budget > 0 ? Math.round((roleSpend / t.budget) * 100) : 0
  const ready = bothSatsReady ?? t.allOk

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {/* Resumen compacto de gasto por rol */}
      <div
        className="text-[clamp(8px,0.62vw,9px)] px-2 py-1 text-center leading-snug"
        style={{
          background: '#0e1326',
          border: '2px solid #000',
          color: '#e2e8f0',
        }}
      >
        Tu gasto en este rol:{' '}
        <strong className="text-yellow-300">${roleSpend}k</strong> (
        <strong className="text-cyan-300">{rolePct}%</strong> del equipo)
      </div>

      {role === 'director' && <Director t={t} onLaunch={onLaunch} launchReady={ready} />}
      {role === 'engineer' && <Engineer t={t} />}
      {role === 'science' && <Science t={t} />}
      {role === 'comms' && <Comms t={t} contractId={contractId} />}

      {role !== 'director' && canLaunch && (
        <button
          onMouseEnter={playHover}
          onClick={() => {
            playClick()
            onLaunch()
          }}
          className="mc-btn w-full py-2 text-[clamp(8.5px,0.68vw,10px)] mt-0.5 font-bold"
          style={
            ready
              ? {
                  background: '#15803d',
                  color: '#7bff9a',
                  borderColor: '#7bff9a',
                  boxShadow: 'inset 4px 4px 0 #4ade80, inset -4px -4px 0 #14532d, 0 0 14px #22c55e88',
                }
              : undefined
          }
        >
          🚀 AUTORIZAR DESPEGUE DE LA FLOTA
        </button>
      )}
    </div>
  )
}
