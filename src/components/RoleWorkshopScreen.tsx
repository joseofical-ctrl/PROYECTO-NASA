import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Lock } from 'lucide-react'
import {
  CHASSIS,
  CONTRACTS,
  LAUNCHERS,
  PART_BY_ID,
  PARTS,
  PRESETS,
  ROLE_INFO,
  ROLE_ORDER,
} from '../game/catalog'
import type { RoleId } from '../game/catalog'
import {
  missionIdToIndex,
  missionIndexToId,
  sanitizeMissionId,
  sanitizeMissionIndex,
} from '../game/missions'
import { analyze } from '../game/sim'
import type { Design, Telemetry } from '../game/sim'
import {
  SATELLITE_META,
  postRoomAction,
} from '../game/multiplayer'
import type {
  RoleClaimsMap,
  RoomSnapshot,
  SatelliteDesignSync,
  SatelliteId,
} from '../game/multiplayer'
import { actions, makeMsg, useGame } from '../game/store'
import type { CostFeedback } from '../game/store'
import HangarCanvas from './HangarCanvas'
import LeftPanel from './workshop/LeftPanel'
import type { WorkshopOps } from './workshop/LeftPanel'
import TelemetryPanel from './workshop/TelemetryPanel'
import CharacterPortrait, { RpgStatBars } from './CharacterPortrait'
import { playClick, playHover, playIntroSweep } from '../audio'

interface Props {
  assignments: (RoleId | null)[]
  startRole: RoleId
  playerNames?: Record<RoleId, string>
  roomCode?: string | null
  clientId?: string
  playerName?: string
  roomSnapshot?: RoomSnapshot | null
  assignedRole?: RoleId | null
  isSoloOffline?: boolean
  onRoomUpdated?: (room: RoomSnapshot) => void
  onExit: () => void
  onAuthorizedLaunch?: () => void
}

const PART_SLOTS_MAP: Record<string, number> = Object.fromEntries(
  PARTS.map((p) => [p.id, p.slots])
)

function defaultDesignForSat(satId: SatelliteId): Design {
  const meta = SATELLITE_META[satId]
  return {
    contractId: meta.defaultContract,
    launcherId: meta.defaultLauncher,
    chassisId: meta.defaultChassis,
    parts: {},
  }
}

function syncToDesign(sync: SatelliteDesignSync | undefined, satId: SatelliteId): Design {
  if (!sync) return defaultDesignForSat(satId)
  return {
    contractId: sync.contractId || SATELLITE_META[satId].defaultContract,
    launcherId: sync.launcherId || SATELLITE_META[satId].defaultLauncher,
    chassisId: sync.chassisId || SATELLITE_META[satId].defaultChassis,
    parts: { ...(sync.parts ?? {}) },
  }
}

function designsEqual(a: Design, b: Design): boolean {
  if (a.contractId !== b.contractId || a.launcherId !== b.launcherId || a.chassisId !== b.chassisId) {
    return false
  }
  const keysA = Object.entries(a.parts).filter(([, q]) => q > 0)
  const keysB = Object.entries(b.parts).filter(([, q]) => q > 0)
  if (keysA.length !== keysB.length) return false
  for (const [k, q] of keysA) {
    if ((b.parts[k] ?? 0) !== q) return false
  }
  return true
}

/** Colores del Stacked Progress Bar para cada uno de los 4 roles */
const STACK_ROLE_STYLE: Record<RoleId, { color: string; label: string }> = {
  director: { color: '#fbbf24', label: 'CONDOR-4' }, // Ámbar/Dorado
  engineer: { color: '#22d3ee', label: 'ALPACA-1' }, // Cian
  science: { color: '#10b981', label: 'PUMA-3' },   // Esmeralda
  comms: { color: '#a855f7', label: 'SERPIENTE-2' }, // Violeta
}

/** Panel Horizontal Compacto Global: Presupuesto Compartido, Stacked Bar y Masa/Slots */
function SharedTeamBudgetBar({
  t,
  activeRole,
  costFloat,
  roleClaims,
  clientId,
  hasRoom = false,
}: {
  t: Telemetry
  activeRole: RoleId
  costFloat: CostFeedback | null
  roleClaims?: RoleClaimsMap
  clientId?: string
  hasRoom?: boolean
}) {
  const remaining = t.budget - t.cost
  const isOver = remaining < 0
  const scaleMax = Math.max(t.budget, t.cost, 1)

  return (
    <div
      className="mc-panel px-2 py-1.5 flex flex-col gap-1 shrink-0 relative overflow-visible min-w-0"
      style={{
        background: '#11162b',
        borderColor: isOver ? '#ff4d4d' : '#000',
      }}
    >
      {/* Fila superior: Fondo común + Restante/Excedido + Masa/Slots globales */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="text-[clamp(8.5px,0.68vw,10px)] text-yellow-300 whitespace-nowrap">
            💰 SHARED NASA BUDGET:{' '}
            <strong className="text-white">
              ${t.cost}k / ${t.budget}k
            </strong>
          </span>

          <span
            className={`text-[clamp(8px,0.64vw,10px)] px-1.5 py-0.5 font-bold border-2 border-black whitespace-nowrap ${
              isOver ? 'animate-pulse' : ''
            }`}
            style={{
              background: isOver ? '#5c1111' : '#0f3d26',
              color: isOver ? '#ff6b6b' : '#7bff9a',
            }}
          >
            {isOver
              ? `⚠️ OVER BUDGET -$${Math.abs(remaining)}k`
              : `REMAINING: $${remaining}k`}
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
                className="text-[clamp(7.5px,0.6vw,9px)] px-1.5 py-0.5 font-bold border-2 border-black pointer-events-none"
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
        <div className="flex items-center gap-1 text-[clamp(8px,0.6vw,9px)] shrink-0">
          <span
            className="px-1.5 py-0.5 border border-black whitespace-nowrap"
            style={{
              background: t.mass <= t.massCap ? '#152238' : '#4a1414',
              color: t.mass <= t.massCap ? '#93c5fd' : '#ff8a8a',
            }}
          >
            ⚖️ MASS: {t.mass.toFixed(1)}/{t.massCap}kg
          </span>
          <span
            className="px-1.5 py-0.5 border border-black whitespace-nowrap"
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
        className="w-full h-3 p-[2px] flex overflow-hidden relative"
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

      {/* 4 Mini-etiquetas en una fila fija (grid-cols-4 min-w-0) con truncado limpio */}
      <div className="grid grid-cols-4 gap-1 min-w-0">
        {ROLE_ORDER.map((r) => {
          const info = ROLE_INFO[r]
          const st = STACK_ROLE_STYLE[r]
          const spend = t.roleCosts[r] ?? 0
          const isCurrent = activeRole === r
          const claim = roleClaims?.[r]
          const isLockedByOther = Boolean(
            hasRoom && claim && (!clientId || claim.clientId !== clientId)
          )
          const isVacant = Boolean(hasRoom && !claim)
          return (
            <button
              key={r}
              disabled={isLockedByOther}
              onClick={() => {
                if (isLockedByOther) return
                playClick()
                actions.setRole(r)
              }}
              className={`min-w-0 text-[8px] xl:text-[9px] px-1.5 py-0.5 flex items-center justify-between gap-1 border border-black transition-all ${
                isLockedByOther ? 'opacity-45 cursor-not-allowed' : ''
              }`}
              style={{
                background: isLockedByOther ? '#080b16' : isCurrent ? '#1e294a' : '#0b0e1c',
                boxShadow:
                  isCurrent && !isLockedByOther ? `inset 0 0 0 1px ${st.color}` : undefined,
              }}
              title={
                isLockedByOther
                  ? `🔒 Role locked by ${claim!.playerName}`
                  : isVacant
                    ? `${info.code} [BOT / OPEN] - Click to manage subsystems`
                    : `Switch to ${info.code}`
              }
            >
              <span className="flex items-center gap-1 min-w-0 flex-1">
                <span
                  className="w-2 h-2 inline-block shrink-0 border border-black"
                  style={{ background: isLockedByOther ? '#475569' : st.color }}
                />
                <span className="shrink-0">{isLockedByOther ? '🔒' : info.icon}</span>
                <span className={`${isLockedByOther ? 'text-slate-500' : 'text-gray-300'} truncate`}>
                  {info.animalName}
                </span>
              </span>
              <span
                className="font-bold shrink-0 max-w-[64px] truncate text-right"
                style={{ color: isLockedByOther ? '#fbbf24' : st.color }}
              >
                {isLockedByOther ? claim!.playerName.slice(0, 6) : `$${spend}k`}
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
      className="mb-2 px-2 py-1.5 flex items-center gap-2 min-w-0"
      style={{
        background: '#0c1022',
        border: `3px solid ${info.color}`,
        boxShadow: 'inset 2px 2px 0 #000',
      }}
    >
      <CharacterPortrait characterId={info.characterId} variant="avatar" size={40} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 min-w-0">
          <span
            className="whitespace-nowrap shrink-0 text-[9px] xl:text-[10px] px-1.5 py-0.5 font-bold"
            style={{ background: info.color, color: '#000' }}
          >
            {info.code}
          </span>
          <span
            className="truncate max-w-[85px] text-[8px] text-cyan-200 text-right"
            title={playerName}
          >
            {playerName}
          </span>
        </div>
        <div
          className="text-[clamp(8.5px,0.65vw,10px)] mt-0.5 truncate"
          style={{ color: info.color }}
        >
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
  roomCode = null,
  clientId,
  playerName = 'Astronaut',
  roomSnapshot = null,
  assignedRole = null,
  isSoloOffline = false,
  onRoomUpdated,
  onExit,
  onAuthorizedLaunch,
}: Props) {
  const s = useGame()
  const [launch, setLaunch] = useState<null | 'ok' | 'fail'>(null)
  const [msgIdx, setMsgIdx] = useState(0)
  const [costFloat, setCostFloat] = useState<CostFeedback | null>(null)
  const [activeSatId, setActiveSatId] = useState<SatelliteId>('sat1')
  const [satDesigns, setSatDesigns] = useState<Record<SatelliteId, Design>>(() => ({
    sat1: syncToDesign(roomSnapshot?.satellites?.sat1, 'sat1'),
    sat2: syncToDesign(roomSnapshot?.satellites?.sat2, 'sat2'),
  }))
  const [remoteEventBanner, setRemoteEventBanner] = useState<string | null>(null)

  const initializedKeyRef = useRef<string | null>(null)
  const pendingWritesRef = useRef(0)
  const lastRemoteSatStampRef = useRef<Record<SatelliteId, number>>({ sat1: 0, sat2: 0 })

  const effectiveRole: RoleId = assignedRole ?? startRole
  const effectiveNames = useMemo<Record<RoleId, string>>(() => {
    const base: Record<RoleId, string> = {
      engineer: playerNames?.engineer ?? 'Player 1',
      comms: playerNames?.comms ?? 'Player 2',
      science: playerNames?.science ?? 'Player 3',
      director: playerNames?.director ?? 'Player 4',
    }
    if (roomSnapshot?.roles) {
      for (const r of ROLE_ORDER) {
        const claim = roomSnapshot.roles[r]
        if (claim?.playerName) base[r] = claim.playerName
      }
    }
    if (assignedRole && playerName) {
      base[assignedRole] = playerName
    }
    return base
  }, [playerNames, roomSnapshot?.roles, assignedRole, playerName])

  const myPrimaryRole = useMemo<RoleId | null>(() => {
    if (assignedRole) return assignedRole
    if (roomSnapshot?.roles && clientId) {
      for (const r of ROLE_ORDER) {
        if (roomSnapshot.roles[r]?.clientId === clientId) return r
      }
    }
    return null
  }, [assignedRole, roomSnapshot?.roles, clientId])

  const getLockedOwnerName = useCallback(
    (r: RoleId): string | null => {
      if (!roomCode) return null
      const claim = roomSnapshot?.roles?.[r]
      if (claim && (!clientId || claim.clientId !== clientId)) {
        return claim.playerName
      }
      return null
    },
    [roomCode, roomSnapshot?.roles, clientId]
  )

  // Si el rol que estaba viendo el jugador pasa a pertenecer a otro jugador conectado, regresamos de inmediato a su rol principal
  useEffect(() => {
    if (!roomCode || !myPrimaryRole) return
    if (getLockedOwnerName(s.activeRole) !== null) {
      actions.setRole(myPrimaryRole)
    }
  }, [roomCode, myPrimaryRole, s.activeRole, getLockedOwnerName])

  // Inicializa la sesión de taller para la sala o modo individual, cargando el diseño guardado si existe
  useEffect(() => {
    const key = roomCode ? `room:${roomCode}:${effectiveRole}` : `solo:${effectiveRole}`
    if (initializedKeyRef.current === key) return
    initializedKeyRef.current = key

    if (roomSnapshot?.satellites) {
      const next1 = syncToDesign(roomSnapshot.satellites.sat1, 'sat1')
      const next2 = syncToDesign(roomSnapshot.satellites.sat2, 'sat2')
      setSatDesigns({ sat1: next1, sat2: next2 })
      lastRemoteSatStampRef.current = {
        sat1: roomSnapshot.satellites.sat1?.updatedAt ?? 0,
        sat2: roomSnapshot.satellites.sat2?.updatedAt ?? 0,
      }
      actions.initWorkshop(assignments, effectiveRole, effectiveNames, next1)
    } else if (Object.keys(s.parts).length === 0 && s.chat.length === 0) {
      actions.initWorkshop(assignments, effectiveRole, effectiveNames, defaultDesignForSat('sat1'))
    } else {
      actions.setRole(effectiveRole)
    }
  }, [roomCode, effectiveRole, roomSnapshot?.satellites, assignments, effectiveNames, s.parts, s.chat.length])

  // Sincroniza cambios remotos de SAT-01 y SAT-02 desde otros jugadores en la sala
  useEffect(() => {
    if (!roomSnapshot?.satellites || pendingWritesRef.current > 0) return

    actions.setPlayerNames(effectiveNames)

    const next1 = syncToDesign(roomSnapshot.satellites.sat1, 'sat1')
    const next2 = syncToDesign(roomSnapshot.satellites.sat2, 'sat2')
    const sync1 = roomSnapshot.satellites.sat1
    const sync2 = roomSnapshot.satellites.sat2

    setSatDesigns((prev) => {
      if (designsEqual(prev.sat1, next1) && designsEqual(prev.sat2, next2)) return prev
      return { sat1: next1, sat2: next2 }
    })

    const activeSync = activeSatId === 'sat1' ? sync1 : sync2
    const activeNext = activeSatId === 'sat1' ? next1 : next2
    const curStoreDesign: Design = {
      contractId: s.contractId,
      launcherId: s.launcherId,
      chassisId: s.chassisId,
      parts: s.parts,
    }

    if (activeSync && !designsEqual(curStoreDesign, activeNext)) {
      const remoteStamp = activeSync.updatedAt ?? 0
      const isNewRemoteAction =
        remoteStamp > lastRemoteSatStampRef.current[activeSatId] &&
        Boolean(activeSync.lastActionLabel)
      lastRemoteSatStampRef.current[activeSatId] = remoteStamp

      let changedPartId: string | undefined
      for (const [pid, qty] of Object.entries(activeNext.parts)) {
        if (qty > (curStoreDesign.parts[pid] ?? 0)) {
          changedPartId = pid
          break
        }
      }

      const actorRole =
        activeSync.updatedByRole && activeSync.updatedByRole in ROLE_INFO
          ? (activeSync.updatedByRole as RoleId)
          : 'sistema'

      actions.loadDesign(
        activeNext,
        isNewRemoteAction
          ? {
              role: actorRole,
              kind: 'info',
              installedId: changedPartId,
              text: `"${activeSync.updatedByName ?? 'Squadron'} updated ${SATELLITE_META[activeSatId].code}: ${activeSync.lastActionLabel}"`,
            }
          : { role: actorRole, kind: 'info', installedId: changedPartId }
      )
      if (isNewRemoteAction && activeSync.lastActionLabel) {
        setRemoteEventBanner(
          `📡 ${activeSync.updatedByName ?? 'Team'}: ${activeSync.lastActionLabel} (${SATELLITE_META[activeSatId].code})`
        )
      }
    } else if (sync1 || sync2) {
      for (const sid of ['sat1', 'sat2'] as const) {
        const sy = roomSnapshot.satellites[sid]
        if (sy && sy.updatedAt > lastRemoteSatStampRef.current[sid] && sy.lastActionLabel) {
          lastRemoteSatStampRef.current[sid] = sy.updatedAt
          if (sid !== activeSatId) {
            setRemoteEventBanner(
              `📡 ${sy.updatedByName ?? 'Team'}: ${sy.lastActionLabel} (${SATELLITE_META[sid].code})`
            )
          }
        }
      }
    }
  }, [
    roomSnapshot,
    activeSatId,
    s.contractId,
    s.launcherId,
    s.chassisId,
    s.parts,
    effectiveNames,
  ])

  useEffect(() => {
    if (!remoteEventBanner) return
    const timer = window.setTimeout(() => setRemoteEventBanner(null), 2600)
    return () => window.clearTimeout(timer)
  }, [remoteEventBanner])

  // Dispara el badge flotante cada vez que ocurre un cambio de costo
  useEffect(() => {
    if (!s.lastCostEvent) return
    setCostFloat(s.lastCostEvent)
    const timer = window.setTimeout(() => setCostFloat(null), 1600)
    return () => window.clearTimeout(timer)
  }, [s.lastCostEvent])

  const t1 = useMemo(() => analyze(satDesigns.sat1), [satDesigns.sat1])
  const t2 = useMemo(() => analyze(satDesigns.sat2), [satDesigns.sat2])
  const bothSatsReady = t1.allOk && t2.allOk

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
  const sequentialMissionIndex: 1 | 2 | 3 = sanitizeMissionIndex(
    roomSnapshot?.currentMissionIndex ??
      missionIdToIndex(sanitizeMissionId(roomSnapshot?.missionId ?? s.contractId))
  )
  const lockedContractId = roomCode ? missionIndexToId(sequentialMissionIndex) : null

  const contract = CONTRACTS.find((c) => c.id === s.contractId)!
  const chassis = CHASSIS.find((c) => c.id === s.chassisId)!
  const remainingBudget = t.budget - t.cost
  const activeSatMeta = SATELLITE_META[activeSatId]

  const pushSatConfigToRoom = useCallback(
    async (satId: SatelliteId, nextDesign: Design, actionLabel: string) => {
      if (!roomCode || !clientId) return
      pendingWritesRef.current += 1
      try {
        const res = await postRoomAction(roomCode, {
          action: 'satellite_config',
          clientId,
          playerName,
          role: assignedRole ?? s.activeRole,
          satId,
          contractId: nextDesign.contractId,
          launcherId: nextDesign.launcherId,
          chassisId: nextDesign.chassisId,
          parts: nextDesign.parts,
          actionLabel,
        })
        if (res.room && pendingWritesRef.current <= 1) {
          onRoomUpdated?.(res.room)
        }
      } catch {
        // reintento natural por sondeo
      } finally {
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1)
      }
    },
    [roomCode, clientId, playerName, assignedRole, s.activeRole, onRoomUpdated]
  )

  const switchSatellite = (satId: SatelliteId) => {
    if (satId === activeSatId) return
    playClick()
    const currentSnapshot: Design = {
      contractId: s.contractId,
      launcherId: s.launcherId,
      chassisId: s.chassisId,
      parts: { ...s.parts },
    }
    const nextDesigns: Record<SatelliteId, Design> = {
      ...satDesigns,
      [activeSatId]: currentSnapshot,
    }
    setSatDesigns(nextDesigns)
    setActiveSatId(satId)
    actions.loadDesign(nextDesigns[satId])
  }

  const workshopOps: WorkshopOps = useMemo(
    () => ({
      setContract(id: string) {
        if (lockedContractId && id !== lockedContractId) {
          return
        }
        actions.setContract(id)
        const cName = CONTRACTS.find((c) => c.id === id)?.name ?? id
        const next: Design = {
          contractId: id,
          launcherId: s.launcherId,
          chassisId: s.chassisId,
          parts: { ...s.parts },
        }
        setSatDesigns((prev) => ({ ...prev, [activeSatId]: next }))
        void pushSatConfigToRoom(activeSatId, next, `contract ${cName}`)
      },
      setLauncher(id: string) {
        actions.setLauncher(id)
        const lName = LAUNCHERS.find((l) => l.id === id)?.name ?? id
        const next: Design = {
          contractId: s.contractId,
          launcherId: id,
          chassisId: s.chassisId,
          parts: { ...s.parts },
        }
        setSatDesigns((prev) => ({ ...prev, [activeSatId]: next }))
        void pushSatConfigToRoom(activeSatId, next, `launcher ${lName}`)
      },
      setChassis(id: string) {
        actions.setChassis(id)
        const ch = CHASSIS.find((c) => c.id === id)!
        const nextParts: Record<string, number> = { ...s.parts }
        let used = Object.entries(nextParts).reduce(
          (acc, [pid, q]) => acc + (PART_BY_ID[pid]?.slots ?? 0) * q,
          0
        )
        if (used > ch.units) {
          for (const [pid] of Object.entries(nextParts).reverse()) {
            const slots = PART_BY_ID[pid]?.slots ?? 0
            if (slots <= 0) continue
            while (nextParts[pid] > 0 && used > ch.units) {
              nextParts[pid]--
              used -= slots
            }
          }
        }
        const next: Design = {
          contractId: s.contractId,
          launcherId: s.launcherId,
          chassisId: id,
          parts: nextParts,
        }
        setSatDesigns((prev) => ({ ...prev, [activeSatId]: next }))
        void pushSatConfigToRoom(activeSatId, next, `chassis ${ch.name}`)
      },
      changePart(id: string, delta: number) {
        const p = PART_BY_ID[id]
        const cur = s.parts[id] ?? 0
        const nextQty = Math.max(0, Math.min(p.max, cur + delta))
        if (nextQty === cur) return
        if (delta > 0 && p.slots > 0) {
          const used = Object.entries(s.parts).reduce(
            (acc, [pid, cnt]) => acc + (PART_BY_ID[pid]?.slots ?? 0) * cnt,
            0
          )
          if (used + p.slots > chassis.units) {
            actions.changePart(id, delta)
            return
          }
        }
        actions.changePart(id, delta)
        const nextParts = { ...s.parts }
        if (nextQty <= 0) delete nextParts[id]
        else nextParts[id] = nextQty
        const next: Design = {
          contractId: s.contractId,
          launcherId: s.launcherId,
          chassisId: s.chassisId,
          parts: nextParts,
        }
        setSatDesigns((prev) => ({ ...prev, [activeSatId]: next }))

        if (roomCode && clientId) {
          pendingWritesRef.current += 1
          void postRoomAction(roomCode, {
            action: 'satellite_part',
            clientId,
            playerName,
            role: assignedRole ?? s.activeRole,
            satId: activeSatId,
            partId: id,
            delta,
            maxCount: p.max,
            partSlots: p.slots,
            chassisUnits: chassis.units,
            partSlotsMap: PART_SLOTS_MAP,
            actionLabel: `${delta > 0 ? '+1' : '-1'} ${p.name}`,
          })
            .then((res) => {
              if (res.room && pendingWritesRef.current <= 1) {
                onRoomUpdated?.(res.room)
              }
            })
            .catch(() => {})
            .finally(() => {
              pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1)
            })
        }
      },
    }),
    [
      s.launcherId,
      s.chassisId,
      s.contractId,
      s.parts,
      s.activeRole,
      chassis.units,
      activeSatId,
      roomCode,
      clientId,
      playerName,
      assignedRole,
      pushSatConfigToRoom,
      onRoomUpdated,
      lockedContractId,
    ]
  )

  const handleAutoFillCurrentSat = () => {
    playClick()
    actions.autoFill()
    const pr = PRESETS[s.contractId]
    const next: Design = {
      contractId: s.contractId,
      launcherId: pr.launcherId,
      chassisId: pr.chassisId,
      parts: { ...pr.parts },
    }
    setSatDesigns((prev) => ({ ...prev, [activeSatId]: next }))
    void pushSatConfigToRoom(activeSatId, next, `optimal preset ${activeSatMeta.code}`)
  }

  const handleAutoFillBothSats = () => {
    playClick()
    const pr1 = PRESETS[satDesigns.sat1.contractId]
    const pr2 = PRESETS[satDesigns.sat2.contractId]
    const next1: Design = {
      contractId: satDesigns.sat1.contractId,
      launcherId: pr1.launcherId,
      chassisId: pr1.chassisId,
      parts: { ...pr1.parts },
    }
    const next2: Design = {
      contractId: satDesigns.sat2.contractId,
      launcherId: pr2.launcherId,
      chassisId: pr2.chassisId,
      parts: { ...pr2.parts },
    }
    setSatDesigns({ sat1: next1, sat2: next2 })
    actions.loadDesign(activeSatId === 'sat1' ? next1 : next2, {
      role: assignedRole ?? s.activeRole,
      kind: 'ok',
      installedId: 'preset',
      text: '"Dual fleet ready! SAT-01 AMARU-COMMS and SAT-02 INTI-SCIENCE configured with optimal presets."',
    })
    void pushSatConfigToRoom('sat1', next1, 'optimal preset SAT-01')
    void pushSatConfigToRoom('sat2', next2, 'optimal preset SAT-02')
  }

  const handleClearCurrentSat = () => {
    playClick()
    actions.clear()
    const next: Design = {
      contractId: s.contractId,
      launcherId: s.launcherId,
      chassisId: s.chassisId,
      parts: {},
    }
    setSatDesigns((prev) => ({ ...prev, [activeSatId]: next }))
    void pushSatConfigToRoom(activeSatId, next, `cleared ${activeSatMeta.code}`)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const i = Number(e.key) - 1
      if (i >= 0 && i < 4) {
        const targetRole = ROLE_ORDER[i]
        const ownerName = getLockedOwnerName(targetRole)
        if (ownerName !== null) {
          setRemoteEventBanner(
            `🔒 ${ROLE_INFO[targetRole].code} is locked by ${ownerName}`
          )
          return
        }
        actions.setRole(targetRole)
        playClick()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [getLockedOwnerName])

  // Apunta siempre al último diálogo cuando llega un mensaje nuevo
  useEffect(() => {
    if (s.chat.length > 0) setMsgIdx(s.chat.length - 1)
  }, [s.chat.length])

  const isHost = Boolean(roomSnapshot && clientId && roomSnapshot.hostClientId === clientId)
  const canLaunch = !roomCode || isHost || assignedRole === 'director' || s.activeRole === 'director'

  const doLaunch = async () => {
    if (bothSatsReady) {
      if (roomCode && clientId) {
        try {
          const res = await postRoomAction(roomCode, {
            action: 'set_phase',
            clientId,
            playerName,
            phase: 'LAUNCH',
          })
          if (res.status === 403) {
            actions.post(
              makeMsg(
                'director',
                'todos',
                'warn',
                '"Only the Room Host or 🦅 CONDOR-4 can authorize synchronized launch."'
              )
            )
            return
          }
          if (res.room) onRoomUpdated?.(res.room)
        } catch {
          // continúa transición local si falló momentáneamente
        }
      }

      actions.post(
        makeMsg(
          'director',
          'todos',
          'ok',
          `"Synchronized launch authorized! SAT-01 AMARU-COMMS and SAT-02 INTI-SCIENCE cleared for orbit."`
        )
      )
      if (onAuthorizedLaunch) {
        onAuthorizedLaunch()
      } else {
        playIntroSweep()
        setLaunch('ok')
      }
    } else {
      const bad1 = t1.checks.filter((c) => !c.ok)
      const bad2 = t2.checks.filter((c) => !c.ok)
      const summary = [
        bad1.length > 0 ? `SAT-01 (${bad1.map((b) => b.label).join(', ')})` : null,
        bad2.length > 0 ? `SAT-02 (${bad2.map((b) => b.label).join(', ')})` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      actions.post(
        makeMsg(
          'director',
          'todos',
          'warn',
          `"Launch aborted! Missing requirements on: ${summary}."`
        )
      )
      setLaunch('fail')
    }
  }

  const activePlayerName = s.playerNames?.[s.activeRole] ?? 'Astronaut'
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
      className="relative z-10 h-full flex flex-col font-pixel text-white overflow-x-hidden"
      style={{ background: 'linear-gradient(#070818, #0b0d24)' }}
    >
      {/* Barra superior en 1 sola fila horizontal sin scroll */}
      <header
        className="flex items-center justify-between gap-1.5 px-2 py-1 shrink-0 overflow-x-hidden min-w-0 flex-nowrap"
        style={{
          background: '#10132a',
          borderBottom: '4px solid #000',
          boxShadow: '0 2px 0 #3a4472',
        }}
      >
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
          <button
            className="mc-btn px-2 py-1 text-[9px] xl:text-[10px] flex items-center gap-1 shrink-0 whitespace-nowrap"
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              onExit()
            }}
          >
            <ArrowLeft size={13} /> MENU
          </button>
          <div className="leading-tight min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
              <span
                className="text-[clamp(9px,0.72vw,11px)] text-cyan-300 truncate min-w-0"
                style={{ textShadow: '2px 2px 0 #000' }}
              >
                ASSEMBLY WORKSHOP · {activeSatMeta.icon} {activeSatMeta.code}
              </span>
              {roomCode ? (
                <span className="px-1.5 py-0.5 text-[clamp(7.5px,0.58vw,9px)] bg-yellow-400 text-black font-bold border border-black whitespace-nowrap shrink-0">
                  🔑 ROOM: {roomCode}
                </span>
              ) : (
                <span className="px-1.5 py-0.5 text-[clamp(7.5px,0.58vw,9px)] bg-slate-800 text-slate-300 border border-slate-600 whitespace-nowrap shrink-0">
                  {isSoloOffline ? '🛠️ LOCAL WORKSHOP' : '🛠️ LOCAL WORKSHOP'}
                </span>
              )}
              <span
                className={`px-1.5 py-0.5 text-[clamp(7px,0.56vw,8.5px)] border whitespace-nowrap shrink-0 ${
                  bothSatsReady
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-400'
                    : 'bg-amber-950/70 text-amber-200 border-amber-500/50'
                }`}
              >
                {bothSatsReady
                  ? '✅ FLEET 2/2'
                  : `🛠️ ${(t1.allOk ? 1 : 0) + (t2.allOk ? 1 : 0)}/2 READY`}
              </span>
            </div>
            <div className="text-[clamp(8px,0.6vw,9px)] text-gray-300 truncate mt-0.5">
              🔒 STAGE {sequentialMissionIndex}/3 · {contract.icon} {contract.name} · Chassis{' '}
              {chassis.name}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 min-w-0">
          <span className="hidden 2xl:inline text-[9px] text-gray-400 whitespace-nowrap shrink-0">
            ROLE (1-4):
          </span>
          <div className="flex items-center gap-1 flex-nowrap min-w-0">
            {ROLE_ORDER.map((r, i) => {
              const info = ROLE_INFO[r]
              const on = s.activeRole === r
              const claim = roomSnapshot?.roles?.[r]
              const isMine = claim?.clientId === clientId || (!roomCode && myPrimaryRole === r)
              const lockedOwner = getLockedOwnerName(r)
              const isOtherOwner = lockedOwner !== null
              const isVacant = Boolean(roomCode && !claim)
              const pName = claim?.playerName ?? effectiveNames[r]
              return (
                <button
                  key={r}
                  disabled={isOtherOwner}
                  onMouseEnter={isOtherOwner ? undefined : playHover}
                  onClick={() => {
                    if (isOtherOwner) return
                    playClick()
                    actions.setRole(r)
                  }}
                  className={`text-[clamp(8px,0.6vw,9.5px)] px-1.5 py-0.5 whitespace-nowrap flex items-center gap-1 shrink-0 ${
                    isOtherOwner ? 'opacity-45 cursor-not-allowed' : ''
                  }`}
                  style={{
                    background: isOtherOwner ? '#101424' : on ? '#2a3f8f' : '#262b42',
                    color: isOtherOwner ? '#64748b' : on ? info.color : '#bbb',
                    border: `2px solid ${
                      isOtherOwner
                        ? '#334155'
                        : on
                          ? '#fff'
                          : isMine
                            ? '#4ade80'
                            : '#000'
                    }`,
                    boxShadow:
                      on && !isOtherOwner
                        ? `inset 2px 2px 0 #6f8cff, 0 0 0 1px ${info.color}`
                        : 'inset 2px 2px 0 #3d4466',
                  }}
                  title={
                    isOtherOwner
                      ? `🔒 ${info.code} claimed by ${lockedOwner} (Locked)`
                      : isVacant
                        ? `${info.code} [BOT / OPEN] - Vacant, click to manage subsystems`
                        : `Your character (${info.code}) - ${pName}`
                  }
                >
                  <CharacterPortrait
                    characterId={info.characterId}
                    variant="avatar"
                    size={16}
                  />
                  <span>
                    [{i + 1}: {info.animalName}]
                  </span>
                  {isMine && <span className="text-emerald-300 font-bold">★</span>}
                  {isVacant && !on && (
                    <span className="px-1 py-0 text-[7px] bg-cyan-950 border border-cyan-500/60 text-cyan-200">
                      OPEN
                    </span>
                  )}
                  {isOtherOwner && (
                    <span className="text-amber-300 flex items-center gap-0.5 text-[8px] max-w-[68px] truncate">
                      <Lock size={9} className="shrink-0" />
                      <span className="truncate">{lockedOwner.slice(0, 6)}</span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {/* Cuerpo con columnas laterales proporcionadas */}
      <div className="flex-1 min-h-0 grid gap-1.5 p-1.5 grid-cols-1 lg:grid-cols-[264px_1fr_264px] xl:grid-cols-[276px_1fr_276px] overflow-y-auto lg:overflow-hidden">
        {/* Columna Izquierda: Carnet único + Catálogo limpio */}
        <aside className="mc-panel p-1.5 overflow-y-auto overflow-x-hidden min-h-[240px] lg:min-h-0 min-w-0">
          <AstronautIdCard role={s.activeRole} playerName={activePlayerName} />
          <LeftPanel
            s={s}
            remainingBudget={remainingBudget}
            ops={workshopOps}
            assignedRole={assignedRole}
            lockedContractId={lockedContractId}
            currentMissionIndex={sequentialMissionIndex}
          />
        </aside>

        {/* Columna Central: Barra Global de Presupuesto Compartido + Selector SAT-01/SAT-02 + Hangar + Diálogo RPG */}
        <main className="flex flex-col gap-1.5 min-h-[400px] lg:min-h-0 min-w-0">
          {/* 0. Pestañas compartidas SAT-01 AMARU-COMMS y SAT-02 INTI-SCIENCE */}
          <div className="grid grid-cols-2 gap-1.5 shrink-0 min-w-0">
            {(['sat1', 'sat2'] as const).map((sid) => {
              const meta = SATELLITE_META[sid]
              const tel = sid === 'sat1' ? t1 : t2
              const isSelected = activeSatId === sid
              return (
                <button
                  key={sid}
                  onMouseEnter={playHover}
                  onClick={() => switchSatellite(sid)}
                  className="px-2 py-1 text-left border-2 transition-all flex items-center justify-between gap-1.5 min-w-0"
                  style={{
                    background: isSelected ? '#1a2f5e' : '#0d1328',
                    borderColor: isSelected ? '#38bdf8' : tel.allOk ? '#15803d' : '#000',
                    boxShadow: isSelected ? 'inset 0 0 0 1px #7dd3fc' : undefined,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[clamp(8.5px,0.68vw,10px)] font-bold text-yellow-200 truncate">
                      {meta.icon} {meta.code}
                    </div>
                    <div className="text-[clamp(7.5px,0.58vw,8.5px)] text-slate-300 truncate">
                      {meta.subtitle}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-[clamp(7.5px,0.58vw,8.5px)] px-1.5 py-0.5 border font-bold ${
                        tel.allOk
                          ? 'bg-emerald-950 border-emerald-400 text-emerald-300'
                          : 'bg-amber-950/80 border-amber-500/60 text-amber-200'
                      }`}
                    >
                      {tel.allOk ? '✅ READY' : '⏳ PENDING'}
                    </div>
                    <div className="text-[clamp(7.5px,0.58vw,8.5px)] text-cyan-300 mt-0.5">
                      ${tel.cost}k · {tel.slotsUsed}/{tel.slotsCap}U
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* 1. Barra Global Compartida de Presupuesto y Masa */}
          <SharedTeamBudgetBar
            t={t}
            activeRole={s.activeRole}
            costFloat={costFloat}
            roleClaims={roomSnapshot?.roles}
            clientId={clientId}
            hasRoom={Boolean(roomCode)}
          />

          {/* 2. Hangar con barra superior dedicada sin encimar textos */}
          <div className="flex-1 min-h-[200px] flex flex-col gap-1 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-1.5 px-2 py-0.5 bg-[#0e1326] border-2 border-black shrink-0 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <div className="text-[clamp(8.5px,0.66vw,10px)] text-cyan-200 whitespace-nowrap truncate">
                  {activeSatMeta.icon} {activeSatMeta.code} · {chassis.name}
                </div>
                {remoteEventBanner && (
                  <span className="px-1.5 py-0.5 text-[clamp(7.5px,0.58vw,8.5px)] bg-cyan-950 border border-cyan-400/70 text-cyan-200 truncate">
                    {remoteEventBanner}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  className="mc-btn px-1.5 py-0.5 text-[clamp(7.5px,0.6vw,9px)] whitespace-nowrap"
                  onMouseEnter={playHover}
                  onClick={handleAutoFillCurrentSat}
                >
                  ⚙️ AUTO CURRENT SAT
                </button>
                <button
                  className="mc-btn px-1.5 py-0.5 text-[clamp(7.5px,0.6vw,9px)] whitespace-nowrap"
                  onMouseEnter={playHover}
                  onClick={handleAutoFillBothSats}
                  style={{
                    background: 'linear-gradient(180deg, #0f766e 0%, #115e59 100%)',
                    borderColor: '#2dd4bf',
                  }}
                >
                  ✨ AUTO-BUILD BOTH SATELLITES
                </button>
                <button
                  className="mc-btn px-1.5 py-0.5 text-[clamp(7.5px,0.6vw,9px)]"
                  onMouseEnter={playHover}
                  onClick={handleClearCurrentSat}
                  title="Clear current satellite"
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
            className="mc-panel px-2 py-1 min-h-[56px] flex items-center gap-2 shrink-0 min-w-0"
            style={{ borderLeft: `5px solid ${msgCol}` }}
          >
            {fromInfo ? (
              <CharacterPortrait
                characterId={fromInfo.characterId}
                variant="avatar"
                size={36}
              />
            ) : (
              <div
                className="w-[36px] h-[36px] flex items-center justify-center text-base shrink-0"
                style={{ background: '#1b2038', border: '2px solid #000' }}
              >
                🤖
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[clamp(8px,0.62vw,9px)] mb-0.5 min-w-0">
                <span
                  className="font-bold truncate"
                  style={{ color: fromInfo ? fromInfo.color : '#ffd23f' }}
                >
                  [{fromInfo ? `${fromInfo.icon} ${fromInfo.code}` : '🤖 SYSTEM'}]
                </span>
                {currentMsg && currentMsg.to !== 'todos' && (
                  <span className="text-gray-400 shrink-0">
                    → [{ROLE_INFO[currentMsg.to].icon} {ROLE_INFO[currentMsg.to].code}]
                  </span>
                )}
              </div>
              <div
                className="text-[clamp(8px,0.62vw,9px)] leading-snug line-clamp-2"
                style={{ color: msgCol }}
              >
                {currentMsg ? currentMsg.text : 'No active alerts.'}
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
                  title="Previous alert"
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
                  title="Next alert"
                >
                  &gt;
                </button>
              </div>
              <span className="text-[8px] text-gray-400">
                {s.chat.length > 0 ? `${msgIdx + 1}/${s.chat.length}` : '0/0'}
              </span>
            </div>
          </div>
        </main>

        {/* Columna Derecha: Sin carnet duplicado, solo 3-4 medidores grandes */}
        <aside className="mc-panel p-1.5 overflow-y-auto overflow-x-hidden min-h-[240px] lg:min-h-0 min-w-0">
          <div
            className="text-[clamp(9px,0.72vw,11px)] mb-1.5 pb-1 flex items-center justify-between gap-1 min-w-0"
            style={{
              color: activeRoleInfo.color,
              borderBottom: '2px solid #000',
              textShadow: '2px 2px 0 #000',
            }}
          >
            <span className="truncate">📊 TELEMETRY · {activeRoleInfo.code}</span>
            <span className="shrink-0">{activeRoleInfo.icon}</span>
          </div>
          <TelemetryPanel
            role={s.activeRole}
            t={t}
            contractId={s.contractId}
            onLaunch={() => void doLaunch()}
            bothSatsReady={bothSatsReady}
            canLaunch={canLaunch}
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
                    ANDEAN SQUADRON LAUNCH SUCCESSFUL!
                  </h2>
                  <p className="ui-meta mt-3 leading-relaxed text-gray-300">
                    {contract.name} · Science {t.sciPts.toFixed(0)} pts · ${t.cost}k
                  </p>
                </>
              ) : (
                <>
                  <div className="text-4xl">⚠️</div>
                  <h2
                    className="ui-title text-red-400 mt-3"
                    style={{ textShadow: '3px 3px 0 #000' }}
                  >
                    LAUNCH ABORTED
                  </h2>
                  <div className="mt-3 flex flex-col gap-2 text-left max-h-64 overflow-y-auto pr-1">
                    {[
                      { code: 'SAT-01 AMARU-COMMS', tel: t1 },
                      { code: 'SAT-02 INTI-SCIENCE', tel: t2 },
                    ].map(({ code, tel }) =>
                      tel.checks
                        .filter((c) => !c.ok)
                        .map((c) => {
                          const rInfo = ROLE_INFO[c.role]
                          return (
                            <div
                              key={`${code}-${c.id}`}
                              className="ui-meta leading-relaxed flex items-center gap-2"
                              style={{ color: '#ffd0d0' }}
                            >
                              <CharacterPortrait
                                characterId={rInfo.characterId}
                                variant="avatar"
                                size={24}
                              />
                              <span>
                                [{code} · {rInfo.code}] {c.label}: {c.detail}
                              </span>
                            </div>
                          )
                        })
                    )}
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
                CLOSE
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
