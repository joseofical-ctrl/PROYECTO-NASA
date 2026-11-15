import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { CHASSIS, CONTRACTS, ROLE_INFO, ROLE_ORDER } from '../game/catalog'
import type { RoleId } from '../game/catalog'
import { analyze } from '../game/sim'
import type { Telemetry } from '../game/sim'
import { actions, makeMsg, useGame } from '../game/store'
import type { CostFeedback } from '../game/store'
import HangarCanvas from './HangarCanvas'
import LeftPanel from './workshop/LeftPanel'
import TelemetryPanel from './workshop/TelemetryPanel'
import CharacterPortrait, { RpgStatBars } from './CharacterPortrait'
import { playClick, playHover, playIntroSweep } from '../audio'

interface Props {
  assignments: (RoleId | null)[]
  startRole: RoleId
  playerNames?: Record<RoleId, string>
  onExit: () => void
  onAuthorizedLaunch?: () => void
}

/** Colores del Stacked Progress Bar para cada uno de los 4 roles */
const STACK_ROLE_STYLE: Record<RoleId, { color: string; label: string }> = {
  director: { color: '#fbbf24', label: 'CÓNDOR-4' }, // Ámbar/Dorado
  engineer: { color: '#22d3ee', label: 'ALPACA-1' }, // Cian
  science: { color: '#10b981', label: 'PUMA-3' },   // Esmeralda
  comms: { color: '#a855f7', label: 'SERPIENTE-2' }, // Violeta
}

/** Panel Horizontal Compacto Global: Presupuesto Compartido, Stacked Bar y Masa/Slots */
function SharedTeamBudgetBar({
  t,
  activeRole,
  costFloat,
}: {
  t: Telemetry
  activeRole: RoleId
  costFloat: CostFeedback | null
}) {
  const remaining = t.budget - t.cost
  const isOver = remaining < 0
  const scaleMax = Math.max(t.budget, t.cost, 1)

  return (
    <div
      className="mc-panel px-2.5 py-2 flex flex-col gap-1.5 shrink-0 relative overflow-visible"
      style={{
        background: '#11162b',
        borderColor: isOver ? '#ff4d4d' : '#000',
      }}
    >
      {/* Fila superior: Fondo común + Restante/Excedido + Masa/Slots globales */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-yellow-300">
            💰 FONDO COMÚN NASA:{' '}
            <strong className="text-white">
              ${t.cost}k / ${t.budget}k
            </strong>
          </span>

          <span
            className={`text-[10px] px-2 py-0.5 font-bold border-2 border-black ${
              isOver ? 'animate-pulse' : ''
            }`}
            style={{
              background: isOver ? '#5c1111' : '#0f3d26',
              color: isOver ? '#ff6b6b' : '#7bff9a',
            }}
          >
            {isOver
              ? `⚠️ EXCEDIDO EN -$${Math.abs(remaining)}k`
              : `RESTANTE: $${remaining}k`}
          </span>

          {/* Animación flotante al comprar [+$XXk / -$XXk] */}
          <AnimatePresence mode="popLayout">
            {costFloat && (
              <motion.span
                key={costFloat.id}
                initial={{ opacity: 0, y: 10, scale: 0.7 }}
                animate={{ opacity: 1, y: -2, scale: 1.05 }}
                exit={{ opacity: 0, y: -14, scale: 0.8 }}
                transition={{ duration: 0.45 }}
                className="text-[9px] px-2 py-0.5 font-bold border-2 border-black pointer-events-none"
                style={{
                  background: costFloat.deltaCost > 0 ? '#4a1810' : '#0f3d26',
                  color: costFloat.deltaCost > 0 ? '#ff9f43' : '#7bff9a',
                }}
              >
                {ROLE_INFO[costFloat.role].icon}{' '}
                {costFloat.deltaCost > 0
                  ? `-$${costFloat.deltaCost}k`
                  : `+$${Math.abs(costFloat.deltaCost)}k`}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Indicadores globales compactos de Masa y Volumen U */}
        <div className="flex items-center gap-1.5 text-[9px]">
          <span
            className="px-2 py-0.5 border border-black"
            style={{
              background: t.mass <= t.massCap ? '#152238' : '#4a1414',
              color: t.mass <= t.massCap ? '#93c5fd' : '#ff8a8a',
            }}
          >
            ⚖️ MASA: {t.mass.toFixed(1)}/{t.massCap}kg
          </span>
          <span
            className="px-2 py-0.5 border border-black"
            style={{
              background: t.slotsUsed <= t.slotsCap ? '#152238' : '#4a1414',
              color: t.slotsUsed <= t.slotsCap ? '#cbd5e1' : '#ff8a8a',
            }}
          >
            📦 SLOTS: {t.slotsUsed}/{t.slotsCap}U
          </span>
        </div>
      </div>

      {/* Barra de Progreso Multicolor (Stacked Progress Bar) */}
      <div
        className="w-full h-3.5 p-[2px] flex overflow-hidden relative"
        style={{ background: '#060812', border: '2px solid #000' }}
      >
        {ROLE_ORDER.map((r) => {
          const c = t.roleCosts[r] ?? 0
          const widthPct = (c / scaleMax) * 100
          if (widthPct <= 0) return null
          const st = STACK_ROLE_STYLE[r]
          return (
            <div
              key={r}
              className="h-full transition-all duration-300 first:rounded-none"
              style={{
                width: `${widthPct}%`,
                background: st.color,
                borderRight: '1px solid #000',
              }}
              title={`${ROLE_INFO[r].code}: $${c}k`}
            />
          )
        })}
      </div>

      {/* 4 Mini-etiquetas con la carita/icono de cada personaje y su gasto actual */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {ROLE_ORDER.map((r) => {
          const info = ROLE_INFO[r]
          const st = STACK_ROLE_STYLE[r]
          const spend = t.roleCosts[r] ?? 0
          const isCurrent = activeRole === r
          return (
            <button
              key={r}
              onClick={() => {
                playClick()
                actions.setRole(r)
              }}
              className="text-[9px] px-2 py-1 flex items-center justify-between border border-black transition-all"
              style={{
                background: isCurrent ? '#1e294a' : '#0b0e1c',
                boxShadow: isCurrent ? `inset 0 0 0 1px ${st.color}` : undefined,
              }}
              title={`Cambiar a ${info.code}`}
            >
              <span className="flex items-center gap-1 truncate">
                <span
                  className="w-2 h-2 inline-block shrink-0 border border-black"
                  style={{ background: st.color }}
                />
                <span>{info.icon}</span>
                <span className="text-gray-300 truncate">{info.animalName}</span>
              </span>
              <span className="font-bold ml-1" style={{ color: st.color }}>
                ${spend}k
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Carnet compacto del Astronauta activo (SOLO en la columna izquierda) */
function AstronautIdCard({ role, playerName }: { role: RoleId; playerName: string }) {
  const info = ROLE_INFO[role]
  return (
    <div
      className="mb-2.5 p-2 flex items-center gap-2.5"
      style={{
        background: '#0c1022',
        border: `3px solid ${info.color}`,
        boxShadow: 'inset 2px 2px 0 #000',
      }}
    >
      <CharacterPortrait characterId={info.characterId} variant="avatar" size={44} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span
            className="text-[9px] px-1.5 py-0.5 font-bold"
            style={{ background: info.color, color: '#000' }}
          >
            {info.code}
          </span>
          <span className="text-[9px] text-cyan-200 truncate">{playerName}</span>
        </div>
        <div className="text-[10px] mt-1 truncate" style={{ color: info.color }}>
          {info.icon} {info.name}
        </div>
        <div className="mt-1">
          <RpgStatBars characterId={info.characterId} compact />
        </div>
      </div>
    </div>
  )
}

export default function RoleWorkshopScreen({
  assignments,
  startRole,
  playerNames,
  onExit,
  onAuthorizedLaunch,
}: Props) {
  const s = useGame()
  const [launch, setLaunch] = useState<null | 'ok' | 'fail'>(null)
  const [msgIdx, setMsgIdx] = useState(0)
  const [costFloat, setCostFloat] = useState<CostFeedback | null>(null)

  // Solo inicializa el estado cuando se arranca una nueva sesión de taller desde el menú, preservando el diseño al volver desde la cinemática
  useEffect(() => {
    if (Object.keys(s.parts).length === 0 && s.chat.length === 0) {
      actions.initWorkshop(assignments, startRole, playerNames)
    }
  }, [assignments, startRole, playerNames, s.parts, s.chat.length])

  // Dispara el badge flotante cada vez que ocurre un cambio de costo
  useEffect(() => {
    if (!s.lastCostEvent) return
    setCostFloat(s.lastCostEvent)
    const timer = window.setTimeout(() => setCostFloat(null), 1600)
    return () => window.clearTimeout(timer)
  }, [s.lastCostEvent])

  const t = useMemo(
    () =>
      analyze({
        contractId: s.contractId,
        launcherId: s.launcherId,
        chassisId: s.chassisId,
        parts: s.parts,
      }),
    [s.contractId, s.launcherId, s.chassisId, s.parts]
  )
  const contract = CONTRACTS.find((c) => c.id === s.contractId)!
  const chassis = CHASSIS.find((c) => c.id === s.chassisId)!
  const remainingBudget = t.budget - t.cost

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const i = Number(e.key) - 1
      if (i >= 0 && i < 4) {
        actions.setRole(ROLE_ORDER[i])
        playClick()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Apunta siempre al último diálogo cuando llega un mensaje nuevo
  useEffect(() => {
    if (s.chat.length > 0) setMsgIdx(s.chat.length - 1)
  }, [s.chat.length])

  const doLaunch = () => {
    if (t.allOk) {
      actions.post(
        makeMsg(
          'director',
          'todos',
          'ok',
          `"¡Despegue autorizado por CÓNDOR-4! ${contract.name} en camino. ¡Misión cumplida, Escuadrón Andino!"`
        )
      )
      if (onAuthorizedLaunch) {
        onAuthorizedLaunch()
      } else {
        playIntroSweep()
        setLaunch('ok')
      }
    } else {
      const bad = t.checks.filter((c) => !c.ok)
      actions.post(
        makeMsg(
          'director',
          'todos',
          'warn',
          `"¡Despegue abortado en Centro de Control! Pendientes: ${bad.map((b) => b.label).join(', ')}."`
        )
      )
      setLaunch('fail')
    }
  }

  const activePlayerName = s.playerNames?.[s.activeRole] ?? 'Astronauta'
  const activeRoleInfo = ROLE_INFO[s.activeRole]
  const currentMsg = s.chat[Math.min(msgIdx, Math.max(0, s.chat.length - 1))]
  const fromInfo =
    currentMsg && currentMsg.from !== 'sistema' ? ROLE_INFO[currentMsg.from] : null
  const msgCol =
    !currentMsg
      ? '#cfd8ff'
      : currentMsg.kind === 'warn'
      ? '#ff6b6b'
      : currentMsg.kind === 'ok'
      ? '#55efc4'
      : '#cfd8ff'

  return (
    <div
      className="relative z-10 h-full flex flex-col font-pixel text-white"
      style={{ background: 'linear-gradient(#070818, #0b0d24)' }}
    >
      {/* Barra superior en 1 sola fila horizontal */}
      <header
        className="flex items-center justify-between gap-2 px-2.5 py-1.5 shrink-0 overflow-x-auto"
        style={{
          background: '#10132a',
          borderBottom: '4px solid #000',
          boxShadow: '0 2px 0 #3a4472',
        }}
      >
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            className="mc-btn px-2.5 py-1.5 text-[10px] flex items-center gap-1 shrink-0"
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              onExit()
            }}
          >
            <ArrowLeft size={14} /> MENÚ
          </button>
          <div className="leading-tight">
            <div className="text-[12px] sm:text-[13px] text-cyan-300 whitespace-nowrap" style={{ textShadow: '2px 2px 0 #000' }}>
              TALLER DE ENSAMBLAJE · ESCUADRÓN ANDINO
            </div>
            <div className="text-[9px] text-gray-300 whitespace-nowrap mt-0.5">
              {contract.icon} {contract.name} · Chasis {chassis.name}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden xl:inline text-[9px] text-gray-400 whitespace-nowrap">
            ROL (1-4):
          </span>
          <div className="flex items-center gap-1.5 flex-nowrap">
            {ROLE_ORDER.map((r, i) => {
              const info = ROLE_INFO[r]
              const on = s.activeRole === r
              const pName = s.playerNames?.[r]
              return (
                <button
                  key={r}
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    actions.setRole(r)
                  }}
                  className="text-[9px] px-2 py-1 whitespace-nowrap flex items-center gap-1.5 shrink-0"
                  style={{
                    background: on ? '#2a3f8f' : '#262b42',
                    color: on ? info.color : '#bbb',
                    border: `2px solid ${on ? '#fff' : '#000'}`,
                    boxShadow: on
                      ? `inset 2px 2px 0 #6f8cff, 0 0 0 1px ${info.color}`
                      : 'inset 2px 2px 0 #3d4466',
                  }}
                  title={`${info.code} (${info.name}) - ${pName}`}
                >
                  <CharacterPortrait
                    characterId={info.characterId}
                    variant="avatar"
                    size={20}
                  />
                  <span>
                    [{i + 1}: {info.animalName}]
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {/* Cuerpo con columnas laterales proporcionadas (w-68 / 276px) */}
      <div className="flex-1 min-h-0 grid gap-2 p-2 grid-cols-1 lg:grid-cols-[276px_1fr_276px] overflow-y-auto lg:overflow-hidden">
        {/* Columna Izquierda: Carnet único + Catálogo limpio */}
        <aside className="mc-panel p-2 overflow-y-auto min-h-[260px] lg:min-h-0">
          <AstronautIdCard role={s.activeRole} playerName={activePlayerName} />
          <LeftPanel s={s} remainingBudget={remainingBudget} />
        </aside>

        {/* Columna Central: Barra Global de Presupuesto Compartido + Hangar + Caja de Diálogo RPG */}
        <main className="flex flex-col gap-2 min-h-[420px] lg:min-h-0 min-w-0">
          {/* 1. Barra Global Compartida de Presupuesto y Masa */}
          <SharedTeamBudgetBar
            t={t}
            activeRole={s.activeRole}
            costFloat={costFloat}
          />

          {/* 2. Hangar con barra superior dedicada sin encimar textos */}
          <div className="flex-1 min-h-[210px] flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 px-2 py-1 bg-[#0e1326] border-2 border-black shrink-0">
              <div className="text-[9px] sm:text-[10px] text-cyan-200 whitespace-nowrap truncate">
                🛰️ HANGAR · CUBESAT {chassis.name}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  className="mc-btn px-2.5 py-1 text-[9px] whitespace-nowrap"
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    actions.autoFill()
                  }}
                >
                  ⚙️ AUTO-COMPLETAR EQUIPO (PRESET ÓPTIMO)
                </button>
                <button
                  className="mc-btn px-2 py-1 text-[9px]"
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    actions.clear()
                  }}
                  title="Vaciar Hangar"
                >
                  🗑️
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 relative">
              <HangarCanvas
                chassisId={s.chassisId}
                parts={s.parts}
                lastInstall={s.lastInstall}
              />
            </div>
          </div>

          {/* Caja de diálogo RPG compacta */}
          <div
            className="mc-panel px-2.5 py-1.5 min-h-[64px] flex items-center gap-2.5 shrink-0"
            style={{ borderLeft: `5px solid ${msgCol}` }}
          >
            {fromInfo ? (
              <CharacterPortrait
                characterId={fromInfo.characterId}
                variant="avatar"
                size={40}
              />
            ) : (
              <div
                className="w-[40px] h-[40px] flex items-center justify-center text-base shrink-0"
                style={{ background: '#1b2038', border: '2px solid #000' }}
              >
                🤖
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[9px] mb-0.5">
                <span
                  className="font-bold"
                  style={{ color: fromInfo ? fromInfo.color : '#ffd23f' }}
                >
                  [{fromInfo ? `${fromInfo.icon} ${fromInfo.code}` : '🤖 SISTEMA'}]
                </span>
                {currentMsg && currentMsg.to !== 'todos' && (
                  <span className="text-gray-400">
                    → [{ROLE_INFO[currentMsg.to].icon} {ROLE_INFO[currentMsg.to].code}]
                  </span>
                )}
              </div>
              <div
                className="text-[9px] leading-snug line-clamp-2"
                style={{ color: msgCol }}
              >
                {currentMsg ? currentMsg.text : 'Sin alertas activas.'}
              </div>
            </div>

            {/* Navegación < > de alertas anteriores */}
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <div className="flex items-center gap-1">
                <button
                  className="mc-btn w-6 h-6 text-[9px] !border-[2px] disabled:opacity-35"
                  disabled={msgIdx <= 0}
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    setMsgIdx((i) => Math.max(0, i - 1))
                  }}
                  title="Alerta anterior"
                >
                  &lt;
                </button>
                <button
                  className="mc-btn w-6 h-6 text-[9px] !border-[2px] disabled:opacity-35"
                  disabled={msgIdx >= s.chat.length - 1}
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    setMsgIdx((i) => Math.min(s.chat.length - 1, i + 1))
                  }}
                  title="Siguiente alerta"
                >
                  &gt;
                </button>
              </div>
              <span className="text-[9px] text-gray-400">
                {s.chat.length > 0 ? `${msgIdx + 1}/${s.chat.length}` : '0/0'}
              </span>
            </div>
          </div>
        </main>

        {/* Columna Derecha: Sin carnet duplicado, solo 3-4 medidores grandes */}
        <aside className="mc-panel p-2 overflow-y-auto min-h-[260px] lg:min-h-0">
          <div
            className="text-[11px] mb-2 pb-1 flex items-center justify-between"
            style={{
              color: activeRoleInfo.color,
              borderBottom: '2px solid #000',
              textShadow: '2px 2px 0 #000',
            }}
          >
            <span>📊 TELEMETRÍA · {activeRoleInfo.code}</span>
            <span>{activeRoleInfo.icon}</span>
          </div>
          <TelemetryPanel
            role={s.activeRole}
            t={t}
            contractId={s.contractId}
            onLaunch={doLaunch}
          />
        </aside>
      </div>

      <AnimatePresence>
        {launch && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLaunch(null)}
          >
            <motion.div
              className="mc-panel p-6 max-w-lg w-full text-center overflow-hidden"
              initial={{ scale: 0.6 }}
              animate={{ scale: 1 }}
              onClick={(e) => e.stopPropagation()}
            >
              {launch === 'ok' ? (
                <>
                  <motion.div
                    className="text-6xl"
                    initial={{ y: 60 }}
                    animate={{
                      y: [60, 0, -20, -120],
                      scale: [1, 1.1, 1, 0.6],
                      opacity: [1, 1, 1, 0.2],
                    }}
                    transition={{ duration: 2.4 }}
                  >
                    🚀
                  </motion.div>
                  <h2
                    className="ui-title text-green-300 mt-4"
                    style={{ textShadow: '3px 3px 0 #000' }}
                  >
                    ¡DESPEGUE EXITOSO DEL ESCUADRÓN ANDINO!
                  </h2>
                  <p className="ui-meta mt-3 leading-relaxed text-gray-300">
                    {contract.name} · Ciencia {t.sciPts.toFixed(0)} pts · ${t.cost}k
                  </p>
                </>
              ) : (
                <>
                  <div className="text-4xl">⚠️</div>
                  <h2
                    className="ui-title text-red-400 mt-3"
                    style={{ textShadow: '3px 3px 0 #000' }}
                  >
                    DESPEGUE ABORTADO
                  </h2>
                  <div className="mt-3 flex flex-col gap-2 text-left">
                    {t.checks
                      .filter((c) => !c.ok)
                      .map((c) => {
                        const rInfo = ROLE_INFO[c.role]
                        return (
                          <div
                            key={c.id}
                            className="ui-meta leading-relaxed flex items-center gap-2"
                            style={{ color: '#ffd0d0' }}
                          >
                            <CharacterPortrait
                              characterId={rInfo.characterId}
                              variant="avatar"
                              size={24}
                            />
                            <span>
                              [{rInfo.code}] {c.label}: {c.detail}
                            </span>
                          </div>
                        )
                      })}
                  </div>
                </>
              )}
              <button
                className="mc-btn mt-5 px-5 py-3 ui-item"
                onMouseEnter={playHover}
                onClick={() => {
                  playClick()
                  setLaunch(null)
                }}
              >
                CERRAR
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
