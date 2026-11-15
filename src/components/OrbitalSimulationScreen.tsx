import { motion } from 'framer-motion'
import { CHASSIS, CONTRACTS, LAUNCHERS, PART_BY_ID, ROLE_INFO, ROLE_ORDER } from '../game/catalog'
import { analyze } from '../game/sim'
import { useGame } from '../game/store'
import SpaceCanvas from './SpaceCanvas'
import CharacterPortrait from './CharacterPortrait'
import { playClick, playHover, playIntroSweep } from '../audio'
import { useEffect } from 'react'

interface Props {
  onBackToWorkshop: () => void
  onReplayCutscene: () => void
  onExitToMenu: () => void
}

export default function OrbitalSimulationScreen({
  onBackToWorkshop,
  onReplayCutscene,
  onExitToMenu,
}: Props) {
  const s = useGame()
  const t = analyze({
    contractId: s.contractId,
    launcherId: s.launcherId,
    chassisId: s.chassisId,
    parts: s.parts,
  })
  const contract = CONTRACTS.find((c) => c.id === s.contractId)!
  const launcher = LAUNCHERS.find((l) => l.id === s.launcherId)!
  const chassis = CHASSIS.find((c) => c.id === s.chassisId)!

  useEffect(() => {
    playIntroSweep()
  }, [])

  const score = Math.round(
    t.sciPts * 12 +
      Math.max(0, t.budget - t.cost) * 0.5 +
      (t.allOk ? 500 : 0)
  )

  return (
    <div className="relative w-full h-full overflow-y-auto font-pixel text-white flex items-center justify-center p-4">
      <SpaceCanvas />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(6,10,28,0.65) 20%, rgba(0,0,0,0.9) 100%)',
        }}
      />

      <motion.div
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 20 }}
        className="mc-panel relative z-10 w-full max-w-4xl p-4 sm:p-6"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b-4 border-black">
          <div>
            <div className="ui-meta text-cyan-300">
              🛰️ TELEMETRÍA ORBITAL EN VIVO · ÓRBITA {contract.orbit}
            </div>
            <h1
              className="ui-title text-yellow-300 mt-1"
              style={{ textShadow: '3px 3px 0 #000' }}
            >
              {contract.icon} {contract.name.toUpperCase()} — EN OPERACIÓN
            </h1>
          </div>
          <div
            className="px-3 py-2 text-right border-2 border-black"
            style={{ background: '#0e172f' }}
          >
            <div className="ui-meta text-gray-400">PUNTAJE OFICIAL NASA</div>
            <div className="ui-title text-green-300 font-bold">{score} PTS</div>
          </div>
        </div>

        {/* 4 Key Orbital KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-4">
          <div className="p-2.5 bg-[#10162b] border-2 border-black">
            <div className="ui-meta text-yellow-300">💰 PRESUPUESTO</div>
            <div className="ui-item mt-1 font-bold text-white">
              ${t.cost}k / ${t.budget}k
            </div>
            <div className="ui-meta text-green-300 mt-1">
              Ahorro: ${Math.max(0, t.budget - t.cost)}k
            </div>
          </div>

          <div className="p-2.5 bg-[#10162b] border-2 border-black">
            <div className="ui-meta text-orange-300">☀️ ENERGÍA / ΔV</div>
            <div className="ui-item mt-1 font-bold text-white">
              {t.balanceW >= 0 ? `+${t.balanceW.toFixed(1)}` : t.balanceW.toFixed(1)} W
            </div>
            <div className="ui-meta text-cyan-200 mt-1">
              Δv: {Math.round(t.dvMs)} m/s · {t.krad} krad
            </div>
          </div>

          <div className="p-2.5 bg-[#10162b] border-2 border-black">
            <div className="ui-meta text-emerald-300">🔬 CIENCIA LOGRADA</div>
            <div className="ui-item mt-1 font-bold text-white">
              {t.sciPts.toFixed(0)} / {t.sciGoal} pts
            </div>
            <div className="ui-meta text-emerald-200 mt-1">
              Chasis {chassis.name} · {launcher.name}
            </div>
          </div>

          <div className="p-2.5 bg-[#10162b] border-2 border-black">
            <div className="ui-meta text-blue-300">📡 ENLACE DSN/TIERRA</div>
            <div className="ui-item mt-1 font-bold text-white">
              ↓{t.downEffMbps.toFixed(2)} Mbps
            </div>
            <div className="ui-meta text-blue-200 mt-1">
              Datos: {t.dataGenMbps.toFixed(2)} Mbps
            </div>
          </div>
        </div>

        {/* Crew Summary Cards */}
        <div className="mb-4">
          <div className="ui-title text-yellow-300 mb-2">
            👥 REPORTE DEL ESCUADRÓN ANDINO A BORDO
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {ROLE_ORDER.map((r) => {
              const info = ROLE_INFO[r]
              const pName = s.playerNames?.[r] ?? 'Astronauta'
              const spend = t.roleCosts[r] ?? 0
              return (
                <div
                  key={r}
                  className="p-2 bg-[#0c1022] flex items-center gap-2"
                  style={{ border: `2px solid ${info.color}` }}
                >
                  <CharacterPortrait
                    characterId={info.characterId}
                    variant="avatar"
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="ui-item font-bold" style={{ color: info.color }}>
                      {info.icon} {info.code}
                    </div>
                    <div className="ui-meta text-white truncate">{pName}</div>
                    <div className="ui-meta text-gray-400 mt-0.5">
                      Inversión: <strong className="text-yellow-300">${spend}k</strong>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Installed Hardware Manifest */}
        <div className="p-2.5 bg-[#0a0d1c] border-2 border-black mb-5">
          <div className="ui-meta text-cyan-300 mb-1.5">
            🔧 MANIFIESTO DE MÓDULOS EN ÓRBITA ({t.slotsUsed}/{t.slotsCap}U · {t.mass.toFixed(1)}/{t.massCap} kg)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(s.parts)
              .filter(([, q]) => q > 0)
              .map(([id, q]) => {
                const p = PART_BY_ID[id]
                if (!p) return null
                return (
                  <span
                    key={id}
                    className="px-2 py-1 ui-meta bg-[#18223d] border border-black text-gray-200"
                  >
                    {p.icon} {p.name} <strong className="text-yellow-300">x{q}</strong>
                  </span>
                )
              })}
          </div>
        </div>

        {/* Navigation Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              onBackToWorkshop()
            }}
            className="mc-btn px-4 py-3 ui-item"
          >
            🛠️ VOLVER AL TALLER
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              onMouseEnter={playHover}
              onClick={() => {
                playClick()
                onReplayCutscene()
              }}
              className="mc-btn px-4 py-3 ui-item"
            >
              🎬 REPETIR CINEMÁTICA
            </button>
            <button
              onMouseEnter={playHover}
              onClick={() => {
                playClick()
                onExitToMenu()
              }}
              className="mc-btn px-4 py-3 ui-item"
              style={{ color: '#7bff9a' }}
            >
              🏠 MENÚ PRINCIPAL
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
