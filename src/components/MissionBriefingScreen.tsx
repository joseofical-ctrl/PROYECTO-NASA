import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, CheckCircle2, Clock, Lock, Rocket, ShieldAlert } from 'lucide-react'
import { playClick, playHover } from '../audio'
import { ROLE_INFO, ROLE_ORDER } from '../game/catalog'
import type { RoleId } from '../game/catalog'
import {
  defaultLauncherForStage,
  LAUNCHER_CATALOG,
  LAUNCHER_ORDER,
  MISSION_CATALOG,
  MISSION_ORDER,
  missionIdToIndex,
  missionIndexToId,
  sanitizeMissionId,
  sanitizeMissionIndex,
} from '../game/missions'
import type { LauncherId, MissionId } from '../game/missions'
import {
  postRoomAction,
  toggleRoomBriefingReady,
} from '../game/multiplayer'
import type { RoomSnapshot } from '../game/multiplayer'

interface Props {
  room: RoomSnapshot | null
  clientId: string
  playerName: string
  myRole: RoleId | null
  onRoomUpdated: (room: RoomSnapshot) => void
  onBackToMenu: () => void
  onNotify: (msg: string) => void
}

const LAUNCHER_STAGE_NUMBER: Record<LauncherId, 1 | 2 | 3> = {
  rideshare: 1,
  light: 2,
  heavy: 3,
}

/** Ilustración orbital SVG con estética pixel/vectorial para cada objetivo espacial */
function MissionOrbitIllustration({ missionId }: { missionId: MissionId }) {
  if (missionId === 'andes') {
    return (
      <svg viewBox="0 0 260 96" className="w-full h-24 rounded border border-slate-700/80 bg-[#040918]">
        <circle cx="22" cy="18" r="1" fill="#cbd5e1" opacity="0.7" />
        <circle cx="64" cy="12" r="1.2" fill="#e2e8f0" opacity="0.8" />
        <circle cx="212" cy="16" r="1.1" fill="#7dd3fc" opacity="0.8" />
        <circle cx="240" cy="34" r="1" fill="#fde047" opacity="0.7" />
        <circle cx="190" cy="48" r="1" fill="#fff" opacity="0.5" />
        <circle cx="130" cy="148" r="90" fill="#0c4a6e" stroke="#38bdf8" strokeWidth="2" />
        <path
          d="M58 84 L82 64 L96 74 L118 52 L138 69 L154 57 L176 74 L198 84 Z"
          fill="#0f172a"
          stroke="#7dd3fc"
          strokeWidth="1.2"
        />
        <path
          d="M110 60 L118 52 L127 60 L122 61 L118 58 L113 61 Z M148 62 L154 57 L161 63 L156 64 L154 61 L150 64 Z"
          fill="#f8fafc"
        />
        <ellipse
          cx="130"
          cy="64"
          rx="84"
          ry="34"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          opacity="0.85"
        />
        <polygon points="84,34 114,66 130,66" fill="#22d3ee" opacity="0.24" />
        <g transform="translate(72, 22)">
          <rect x="-10" y="3" width="8" height="4" fill="#1d4ed8" stroke="#93c5fd" strokeWidth="0.6" />
          <rect x="10" y="3" width="8" height="4" fill="#1d4ed8" stroke="#93c5fd" strokeWidth="0.6" />
          <rect x="0" y="0" width="10" height="10" fill="#fbbf24" stroke="#fef08a" strokeWidth="0.8" />
          <rect x="3" y="8" width="4" height="3" fill="#22d3ee" />
        </g>
        <text x="10" y="16" fill="#7dd3fc" fontSize="8" fontFamily="monospace" fontWeight="bold">
          LEO · POLO ANDINO
        </text>
      </svg>
    )
  }

  if (missionId === 'luna') {
    return (
      <svg viewBox="0 0 260 96" className="w-full h-24 rounded border border-slate-700/80 bg-[#060616]">
        <circle cx="24" cy="20" r="1.2" fill="#e2e8f0" opacity="0.8" />
        <circle cx="54" cy="40" r="1" fill="#c4b5fd" opacity="0.7" />
        <circle cx="222" cy="18" r="1.2" fill="#fde047" opacity="0.7" />
        <circle cx="238" cy="64" r="1" fill="#fff" opacity="0.6" />
        <circle cx="34" cy="28" r="11" fill="#1d4ed8" stroke="#60a5fa" strokeWidth="1.2" />
        <path d="M29 24 Q35 20 39 27 Q35 32 29 29 Z" fill="#22c55e" opacity="0.85" />
        <ellipse
          cx="154"
          cy="52"
          rx="68"
          ry="30"
          fill="none"
          stroke="#c084fc"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <circle cx="154" cy="52" r="24" fill="#94a3b8" stroke="#e2e8f0" strokeWidth="1.4" />
        <circle cx="145" cy="46" r="4.5" fill="#64748b" />
        <circle cx="163" cy="56" r="5.5" fill="#64748b" />
        <circle cx="155" cy="39" r="3" fill="#64748b" />
        <path d="M140 70 Q154 78 168 70" fill="none" stroke="#38bdf8" strokeWidth="3" />
        <g transform="translate(206, 26)">
          <rect x="-8" y="2" width="7" height="4" fill="#2563eb" stroke="#93c5fd" strokeWidth="0.5" />
          <rect x="8" y="2" width="7" height="4" fill="#2563eb" stroke="#93c5fd" strokeWidth="0.5" />
          <rect x="-1" y="0" width="9" height="9" fill="#e2e8f0" stroke="#c084fc" strokeWidth="0.8" />
          <circle cx="-8" cy="11" r="3" fill="none" stroke="#38bdf8" strokeWidth="1" />
        </g>
        <text x="10" y="86" fill="#d8b4fe" fontSize="8" fontFamily="monospace" fontWeight="bold">
          LLO · POLO SUR LUNAR
        </text>
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 260 96" className="w-full h-24 rounded border border-slate-700/80 bg-[#120608]">
      <circle cx="110" cy="16" r="1" fill="#fef08a" opacity="0.8" />
      <circle cx="182" cy="14" r="1.2" fill="#e2e8f0" opacity="0.7" />
      <circle cx="236" cy="24" r="1" fill="#7dd3fc" opacity="0.7" />
      <circle cx="28" cy="48" r="36" fill="#f97316" opacity="0.22" />
      <circle cx="28" cy="48" r="24" fill="#f59e0b" stroke="#fef08a" strokeWidth="2" />
      <path d="M56 36 Q95 30 132 39" fill="none" stroke="#fbbf24" strokeWidth="1.3" strokeDasharray="3 3" />
      <path d="M58 48 Q98 52 138 48" fill="none" stroke="#f87171" strokeWidth="1.5" strokeDasharray="4 2" />
      <path d="M56 60 Q95 66 132 58" fill="none" stroke="#fb923c" strokeWidth="1.3" strokeDasharray="3 3" />
      <ellipse cx="144" cy="48" rx="14" ry="24" fill="none" stroke="#fde047" strokeWidth="1.5" strokeDasharray="3 2" />
      <circle cx="144" cy="48" r="2.5" fill="#fde047" />
      <g transform="translate(139, 20)">
        <rect x="-7" y="2" width="6" height="4" fill="#b45309" stroke="#fde047" strokeWidth="0.6" />
        <rect x="8" y="2" width="6" height="4" fill="#b45309" stroke="#fde047" strokeWidth="0.6" />
        <rect x="0" y="0" width="8" height="8" fill="#fbbf24" stroke="#fff" strokeWidth="0.8" />
      </g>
      <circle cx="212" cy="48" r="16" fill="#0369a1" stroke="#38bdf8" strokeWidth="1.5" />
      <path d="M206 42 Q216 38 220 49 Q214 57 204 52 Z" fill="#22c55e" opacity="0.85" />
      <path d="M188 26 Q178 48 188 70" fill="none" stroke="#38bdf8" strokeWidth="1.5" opacity="0.7" />
      <text x="122" y="86" fill="#fde047" fontSize="8" fontFamily="monospace" fontWeight="bold">
        PUNTO LAGRANGE L1 · TORMENTA SOLAR
      </text>
    </svg>
  )
}

/** Mini SVG de cohete portador con diseño Pixel/Aeroespacial */
function LauncherSvg({ launcherId }: { launcherId: LauncherId }) {
  const height = launcherId === 'heavy' ? 66 : launcherId === 'light' ? 56 : 48
  const accent = LAUNCHER_CATALOG[launcherId].accentColor
  return (
    <svg viewBox="0 0 72 78" className="w-14 h-16 shrink-0 bg-[#050a18] border border-slate-700/80 rounded">
      <circle cx="12" cy="14" r="1" fill="#fff" opacity="0.7" />
      <circle cx="58" cy="18" r="1" fill="#7dd3fc" opacity="0.7" />
      <circle cx="50" cy="44" r="1" fill="#fde047" opacity="0.6" />
      {launcherId === 'heavy' && (
        <>
          <rect x="20" y="34" width="7" height="30" rx="2" fill="#cbd5e1" stroke={accent} strokeWidth="0.8" />
          <rect x="45" y="34" width="7" height="30" rx="2" fill="#cbd5e1" stroke={accent} strokeWidth="0.8" />
          <polygon points="20,64 27,64 23.5,73" fill="#f97316" />
          <polygon points="45,64 52,64 48.5,73" fill="#f97316" />
        </>
      )}
      <rect
        x="30"
        y={70 - height}
        width="12"
        height={height - 6}
        rx="2"
        fill="#f1f5f9"
        stroke={accent}
        strokeWidth="1"
      />
      <polygon
        points={`30,${70 - height} 36,${59 - height} 42,${70 - height}`}
        fill={accent}
      />
      <rect x="33" y={78 - height} width="6" height="4" fill="#0f172a" />
      <polygon points="31,64 41,64 36,75" fill="#fbbf24" />
    </svg>
  )
}

export default function MissionBriefingScreen({
  room,
  clientId,
  playerName,
  myRole,
  onRoomUpdated,
  onBackToMenu,
  onNotify,
}: Props) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 300)
    return () => window.clearInterval(id)
  }, [])

  const currentMissionIndex: 1 | 2 | 3 = sanitizeMissionIndex(
    room?.currentMissionIndex ?? missionIdToIndex(sanitizeMissionId(room?.missionId))
  )
  const activeMissionId: MissionId = missionIndexToId(currentMissionIndex)
  const activeLauncherId: LauncherId = defaultLauncherForStage(currentMissionIndex)
  const activeMission = MISSION_CATALOG[activeMissionId]
  const activeLauncher = LAUNCHER_CATALOG[activeLauncherId]

  const connectedCount = room?.participants?.length ?? room?.playerCount ?? 1
  const readySet = useMemo(() => {
    const set = new Set<string>(room?.briefingReadyClients ?? [])
    if (room?.briefingReady) {
      for (const [cid, ok] of Object.entries(room.briefingReady)) {
        if (ok) set.add(cid)
      }
    }
    return set
  }, [room?.briefingReady, room?.briefingReadyClients])

  const readyCount = readySet.size
  const amIReady = readySet.has(clientId)
  const isHost = Boolean(room && (!room.hostClientId || room.hostClientId === clientId))
  const isDirector = Boolean(room && room.roles?.director?.clientId === clientId)
  const canConfirmMission = !room || isHost || isDirector

  const remainingSec = useMemo(() => {
    if (room?.briefingDeadlineAt) {
      return Math.max(0, Math.ceil((room.briefingDeadlineAt - nowMs) / 1000))
    }
    if (typeof room?.briefingRemainingSec === 'number') {
      return room.briefingRemainingSec
    }
    return 45
  }, [room?.briefingDeadlineAt, room?.briefingRemainingSec, nowMs])

  const handleToggleReady = async () => {
    if (!room || busy) return
    playClick()
    setBusy(true)
    try {
      const res = await toggleRoomBriefingReady(room.code, clientId, playerName, !amIReady)
      if (res.room) onRoomUpdated(res.room)
    } catch {
      onNotify('No se pudo actualizar tu estado de lectura.')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmPhase = async (targetPhase: 'WORKSHOP' | 'STATION') => {
    if (!room || busy) return
    if (!canConfirmMission) {
      onNotify('Esperando a que el Host o CÓNDOR-4 confirme el inicio de la etapa.')
      return
    }
    playClick()
    setBusy(true)
    try {
      const res = await postRoomAction(room.code, {
        action: 'set_phase',
        clientId,
        playerName,
        phase: targetPhase,
        missionId: activeMissionId,
        launcherId: activeLauncherId,
      })
      if (res.room) onRoomUpdated(res.room)
    } catch {
      onNotify('No se pudo confirmar la etapa actual de campaña.')
    } finally {
      setBusy(false)
    }
  }

  const myRoleInfo = myRole ? ROLE_INFO[myRole] : null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-20 flex flex-col bg-[#050814]/95 text-white overflow-y-auto overflow-x-hidden font-pixel"
    >
      {/* Barra Superior Fija de Campaña Secuencial */}
      <header className="sticky top-0 z-30 w-full bg-[#090f24]/95 border-b-4 border-black px-3 sm:px-5 py-2.5 shadow-[0_6px_24px_rgba(0,0,0,0.65)]">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => {
                playClick()
                onBackToMenu()
              }}
              className="mc-btn px-2.5 py-1.5 text-[clamp(8px,0.65vw,10px)] flex items-center gap-1.5 shrink-0"
            >
              <ArrowLeft size={13} />
              <span>VOLVER</span>
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  className="text-[clamp(10px,1.08vw,15px)] font-bold text-cyan-300 tracking-wide truncate"
                  style={{ textShadow: '2px 2px 0 #000' }}
                >
                  CAMPAÑA CIENTÍFICA · MISIÓN ACTUAL: ETAPA {currentMissionIndex} DE 3
                </h1>
                {room && (
                  <span className="px-2 py-0.5 text-[clamp(7.5px,0.6vw,9px)] bg-slate-900 border border-cyan-400/50 text-cyan-200 rounded whitespace-nowrap">
                    SALA {room.code} · {connectedCount}/4
                  </span>
                )}
                {myRoleInfo && (
                  <span
                    className="px-2 py-0.5 text-[clamp(7.5px,0.6vw,9px)] bg-slate-900 border rounded whitespace-nowrap"
                    style={{ borderColor: myRoleInfo.color, color: myRoleInfo.color }}
                  >
                    {myRoleInfo.icon} {myRoleInfo.code}
                  </span>
                )}
              </div>
              <p className="font-sans text-[11px] text-slate-300 truncate mt-0.5">
                Progresión secuencial obligatoria · Etapa {currentMissionIndex}:{' '}
                <strong className="text-yellow-300">{activeMission.code}</strong> · Cohete:{' '}
                <strong className="text-cyan-300">{activeLauncher.name}</strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              className={`px-3 py-1.5 border-2 rounded flex items-center gap-2 text-[clamp(8.5px,0.72vw,11px)] font-bold whitespace-nowrap ${
                remainingSec <= 10
                  ? 'bg-red-950/85 border-red-400 text-red-200 animate-pulse'
                  : 'bg-amber-950/80 border-amber-400/80 text-amber-200'
              }`}
            >
              <Clock size={14} />
              <span>⏱ {String(remainingSec).padStart(2, '0')}s para lectura de briefing</span>
            </div>

            <button
              type="button"
              disabled={busy}
              onMouseEnter={playHover}
              onClick={() => void handleToggleReady()}
              className={`mc-btn px-3 py-2 text-[clamp(8px,0.68vw,10px)] font-bold flex items-center gap-1.5 whitespace-nowrap ${
                amIReady ? 'text-black' : 'text-emerald-200'
              }`}
              style={{
                background: amIReady
                  ? 'linear-gradient(180deg, #4ade80 0%, #16a34a 100%)'
                  : 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
                borderColor: amIReady ? '#bbf7d0' : '#38bdf8',
              }}
            >
              <Check size={13} />
              <span>✔ ESTOY LISTO ({readyCount}/{connectedCount})</span>
            </button>

            {canConfirmMission ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onMouseEnter={playHover}
                  onClick={() => void handleConfirmPhase('WORKSHOP')}
                  className="mc-btn px-3.5 py-2 text-[clamp(8.5px,0.7vw,11px)] font-bold flex items-center gap-1.5 whitespace-nowrap text-white"
                  style={{
                    background: 'linear-gradient(180deg, #22c55e 0%, #15803d 100%)',
                    borderColor: '#86efac',
                    boxShadow: '0 0 18px rgba(34,197,94,0.45)',
                  }}
                >
                  <Rocket size={14} />
                  <span>🚀 CONFIRMAR MISIÓN Y ABRIR TALLER</span>
                </button>
                {currentMissionIndex >= 2 && (
                  <button
                    type="button"
                    disabled={busy}
                    onMouseEnter={playHover}
                    onClick={() => void handleConfirmPhase('STATION')}
                    className="mc-btn px-3 py-2 text-[clamp(8px,0.65vw,10px)] font-bold flex items-center gap-1.5 whitespace-nowrap text-cyan-100"
                    style={{
                      background: 'linear-gradient(180deg, #0369a1 0%, #1e3a8a 100%)',
                      borderColor: '#7dd3fc',
                    }}
                  >
                    <span>🛰️ IR DIRECTO A ESTACIÓN</span>
                  </button>
                )}
              </>
            ) : (
              <div className="px-3 py-1.5 bg-slate-900 border border-slate-600 text-slate-300 text-[clamp(8px,0.62vw,9.5px)] rounded flex items-center gap-1.5 whitespace-nowrap">
                <Lock size={12} className="text-amber-300" />
                <span>Solo Host / CÓNDOR-4 confirma inicio</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="w-full max-w-7xl mx-auto px-3 sm:px-5 py-4 space-y-5">
        {/* FASE 1 · HOJA DE RUTA SECUENCIAL DE 3 ETAPAS */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-cyan-500/20 border border-cyan-400 text-cyan-200 text-[clamp(8px,0.65vw,10px)] font-bold rounded">
                FASE 1 · PROGRESIÓN DE CAMPAÑA SECUENCIAL
              </span>
              <span className="font-sans text-xs text-slate-300">
                Las 3 misiones se desbloquean en orden estricto al completar todos los problemas de cada órbita.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 min-w-0">
            {MISSION_ORDER.map((id) => {
              const m = MISSION_CATALOG[id]
              const isCompleted = m.number < currentMissionIndex
              const isCurrent = m.number === currentMissionIndex
              const isLocked = m.number > currentMissionIndex

              return (
                <div
                  key={id}
                  className={`flex flex-col justify-between p-3.5 border-4 rounded transition-all min-w-0 ${
                    isCurrent
                      ? 'bg-[#101c3a] ring-2 ring-yellow-300/85 shadow-[0_0_26px_rgba(56,189,248,0.3)]'
                      : isCompleted
                        ? 'bg-[#092218]/90 border-emerald-500/80'
                        : 'bg-[#090c1a]/75 border-slate-700/70 opacity-50 grayscale-[75%]'
                  }`}
                  style={{
                    borderColor: isCurrent ? m.accentColor : isCompleted ? '#22c55e' : undefined,
                  }}
                >
                  <div className="space-y-2.5 min-w-0">
                    {/* Cabecera de estado secuencial */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                      {isCurrent ? (
                        <span className="text-[9px] px-2 py-0.5 rounded font-bold bg-amber-400 text-black truncate max-w-full">
                          {m.number === 3 ? '▶ MISIÓN FINAL EN CURSO' : '▶ MISIÓN ACTUAL EN CURSO'}
                        </span>
                      ) : isCompleted ? (
                        <span className="text-[9px] px-2 py-0.5 rounded font-bold bg-emerald-500 text-black flex items-center gap-1 truncate max-w-full">
                          <CheckCircle2 size={11} className="shrink-0" />
                          <span className="truncate">✅ MISIÓN {m.number} COMPLETADA</span>
                        </span>
                      ) : (
                        <span className="text-[9px] px-2 py-0.5 rounded font-bold bg-slate-800 border border-slate-600 text-slate-300 flex items-center gap-1 truncate max-w-full">
                          <Lock size={10} className="shrink-0" /> BLOQUEADA
                        </span>
                      )}

                      <span className="text-[9px] px-2 py-0.5 text-yellow-300 font-bold truncate max-w-full">
                        {m.stars} {m.levelLabel}
                      </span>
                    </div>

                    {/* Órbita + Ilustración */}
                    <div className="flex items-center justify-between text-[clamp(7px,0.54vw,8px)]">
                      <span
                        className="px-2 py-0.5 rounded border font-bold"
                        style={{
                          background: 'rgba(15, 23, 42, 0.9)',
                          borderColor: isLocked ? '#475569' : m.accentColor,
                          color: isLocked ? '#94a3b8' : m.accentColor,
                        }}
                      >
                        {m.orbitBadge}
                      </span>
                    </div>

                    <MissionOrbitIllustration missionId={id} />

                    {/* Código y título */}
                    <div>
                      <div
                        className="text-[clamp(9px,0.72vw,11px)] font-bold tracking-wide"
                        style={{ color: isLocked ? '#94a3b8' : isCompleted ? '#4ade80' : m.accentColor }}
                      >
                        ETAPA {m.number} · {m.code}
                      </div>
                      <h2 className="text-[clamp(10px,0.84vw,12.5px)] font-bold text-white leading-snug mt-1">
                        {m.title}
                      </h2>
                      <p className="font-sans text-xs text-slate-300 mt-1 leading-relaxed">
                        {m.subtitle}
                      </p>
                    </div>

                    {/* Especificaciones clave */}
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className="p-1.5 bg-[#060a18] border border-slate-700 rounded">
                        <div className="text-[clamp(6.5px,0.52vw,7.5px)] text-slate-400">
                          PRESUPUESTO
                        </div>
                        <div className="text-[clamp(8.5px,0.68vw,10.5px)] font-bold text-emerald-300 mt-0.5">
                          {m.budgetDisplay}
                        </div>
                      </div>
                      <div className="p-1.5 bg-[#060a18] border border-slate-700 rounded">
                        <div className="text-[clamp(6.5px,0.52vw,7.5px)] text-slate-400">
                          META CIENCIA
                        </div>
                        <div className="text-[clamp(8.5px,0.68vw,10.5px)] font-bold text-yellow-300 mt-0.5">
                          {m.sciGoalDisplay}
                        </div>
                      </div>
                      <div className="p-1.5 bg-[#060a18] border border-slate-700 rounded">
                        <div className="text-[clamp(6.5px,0.52vw,7.5px)] text-slate-400">
                          RADIACIÓN
                        </div>
                        <div className="text-[clamp(8.5px,0.68vw,10.5px)] font-bold text-orange-300 mt-0.5">
                          {m.radiationDisplay}
                        </div>
                      </div>
                    </div>

                    {/* Requisitos obligatorios */}
                    <div className="p-2 bg-[#070b1a] border border-cyan-900/70 rounded">
                      <div className="text-[clamp(7px,0.55vw,8px)] text-cyan-300 font-bold mb-1">
                        MÓDULOS OBLIGATORIOS EN TALLER
                      </div>
                      <ul className="font-sans text-[11px] text-cyan-100 space-y-0.5">
                        {m.mandatoryLabels.map((lbl) => (
                          <li key={lbl}>{lbl}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Problemas y emergencias de esta misión por rol */}
                    <div className="p-2 bg-[#160b14]/80 border border-amber-500/45 rounded">
                      <div className="flex items-center gap-1 text-[clamp(7px,0.55vw,8px)] text-amber-300 font-bold mb-1">
                        <ShieldAlert size={11} />
                        <span>
                          PROBLEMAS DE ESTACIÓN (META: {m.targetResolutions} PROBLEMAS · {m.stationMinigames.length} SISTEMAS · NIVEL {m.difficulty})
                        </span>
                      </div>
                      <div className="space-y-1 font-sans text-[11px]">
                        {ROLE_ORDER.map((r) => {
                          const rInfo = ROLE_INFO[r]
                          const isMineRole = myRole === r
                          return (
                            <div
                              key={r}
                              className={`flex items-start gap-1.5 px-1.5 py-0.5 rounded ${
                                isMineRole && isCurrent ? 'bg-amber-400/15 border border-amber-400/50' : ''
                              }`}
                            >
                              <span className="shrink-0">{rInfo.icon}</span>
                              <div className="min-w-0 leading-tight">
                                <span className="font-bold" style={{ color: rInfo.color }}>
                                  {rInfo.code}:
                                </span>{' '}
                                <span className="text-slate-200">{m.roleProblems[r]}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Estado inferior fijo (NO seleccionable manualmente) */}
                  <button
                    type="button"
                    disabled
                    className={`mt-3 w-full py-2 px-2 text-[clamp(7.5px,0.6vw,9px)] font-bold border-2 rounded cursor-default ${
                      isCompleted
                        ? 'bg-emerald-600/90 border-emerald-300 text-black'
                        : isCurrent
                          ? 'bg-cyan-500 border-yellow-300 text-black shadow-[0_0_12px_rgba(34,211,238,0.45)]'
                          : 'bg-slate-900 border-slate-600 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {isCompleted
                      ? `✅ MISIÓN ${m.number} COMPLETADA`
                      : isCurrent
                        ? m.number === 3
                          ? '▶ MISIÓN FINAL EN CURSO'
                          : '▶ MISIÓN ACTUAL EN CURSO'
                        : `🔒 BLOQUEADA (COMPLETA MISIÓN ${m.number - 1})`}
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        {/* FASE 2 · COHETE PORTADOR ASIGNADO POR ETAPA */}
        <section className="pb-4">
          <div className="flex flex-wrap items-center gap-2 mb-2.5">
            <span className="px-2 py-0.5 bg-amber-500/20 border border-amber-400 text-amber-200 text-[clamp(8px,0.65vw,10px)] font-bold rounded">
              FASE 2 · COHETE PORTADOR (ASIGNACIÓN POR ETAPA)
            </span>
            <span className="font-sans text-xs text-slate-300">
              Asignado automáticamente según la etapa actual: {activeLauncher.name} ({activeMission.orbitBadge}).
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 min-w-0">
            {LAUNCHER_ORDER.map((lid) => {
              const l = LAUNCHER_CATALOG[lid]
              const launcherStage = LAUNCHER_STAGE_NUMBER[lid]
              const isAssigned = lid === activeLauncherId
              const isPast = launcherStage < currentMissionIndex

              return (
                <div
                  key={lid}
                  className={`flex items-center gap-3 p-3 border-4 rounded transition-all min-w-0 cursor-default ${
                    isAssigned
                      ? 'bg-[#101c3a] ring-2 ring-yellow-300/80 shadow-[0_0_20px_rgba(251,191,36,0.22)]'
                      : isPast
                        ? 'bg-[#092218]/65 border-emerald-700/70 opacity-75'
                        : 'bg-[#080b18]/80 border-slate-700/60 opacity-45 grayscale-[70%]'
                  }`}
                  style={{
                    borderColor: isAssigned ? l.accentColor : undefined,
                  }}
                >
                  <LauncherSvg launcherId={lid} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className="text-[clamp(7px,0.54vw,8px)] font-bold"
                        style={{ color: isAssigned ? l.accentColor : '#94a3b8' }}
                      >
                        {l.orbitTag}
                      </span>
                      {isAssigned ? (
                        <span className="px-1.5 py-0.5 text-[clamp(6.5px,0.5vw,7.5px)] bg-emerald-400 text-black font-bold rounded whitespace-nowrap">
                          ▶ ASIGNADO · ETAPA {currentMissionIndex}
                        </span>
                      ) : isPast ? (
                        <span className="px-1.5 py-0.5 text-[clamp(6.5px,0.5vw,7.5px)] bg-emerald-950 border border-emerald-500 text-emerald-300 rounded whitespace-nowrap">
                          ✅ ETAPA {launcherStage}
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[clamp(6.5px,0.5vw,7.5px)] bg-slate-900 border border-slate-600 text-slate-400 rounded whitespace-nowrap">
                          🔒 ETAPA {launcherStage}
                        </span>
                      )}
                    </div>

                    <h3 className="text-[clamp(9px,0.72vw,10.5px)] font-bold text-white mt-0.5 leading-snug">
                      {l.name}
                    </h3>
                    <p className="font-sans text-[11px] text-slate-300 mt-0.5 line-clamp-2">
                      {l.desc}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 mt-2 text-[clamp(7.5px,0.58vw,8.5px)]">
                      <span className="px-1.5 py-0.5 bg-black/60 border border-slate-700 text-emerald-300 rounded">
                        {l.costDisplay}
                      </span>
                      <span className="px-1.5 py-0.5 bg-black/60 border border-slate-700 text-cyan-200 rounded">
                        {l.payloadDisplay}
                      </span>
                      <span className="px-1.5 py-0.5 bg-black/60 border border-slate-700 text-yellow-300 rounded">
                        {l.sciBonusDisplay}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </main>
    </motion.div>
  )
}
