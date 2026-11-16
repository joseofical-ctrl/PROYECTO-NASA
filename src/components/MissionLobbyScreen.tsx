import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Lock,
  LogIn,
  RefreshCw,
  Rocket,
  RotateCcw,
  Trash2,
  Users,
} from 'lucide-react'
import { playClick, playHover } from '../audio'
import { CHARACTER_ORDER, ROLE_INFO } from '../game/catalog'
import type { RoleId } from '../game/catalog'
import {
  ROLE_WORKSHOP_FOCUS,
  clearAllMultiplayerRooms,
  fetchRoomByCode,
  findMyRoleInRoom,
  joinMultiplayerRoom,
  listActiveRooms,
  normalizeRoomCode,
  postRoomAction,
  sendRoomHeartbeat,
} from '../game/multiplayer'
import type { RoomPhase, RoomSnapshot } from '../game/multiplayer'
import CharacterPortrait, { RpgStatBars } from './CharacterPortrait'

interface Props {
  view: 'join' | 'room'
  clientId: string
  playerName: string
  onChangePlayerName: (name: string) => void
  room: RoomSnapshot | null
  onEnterRoom: (room: RoomSnapshot) => void
  onBackToMenu: () => void
  onNotify: (msg: string) => void
}

const PHASE_LABEL: Record<RoomPhase, { label: string; badgeClass: string }> = {
  LOBBY: { label: 'MISSION LOBBY', badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50' },
  MISSION_BRIEFING: {
    label: 'MISSION BRIEFING',
    badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/50',
  },
  WORKSHOP: {
    label: 'SATELLITE WORKSHOP',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-400/50',
  },
  LAUNCH: {
    label: 'LAUNCH IN PROGRESS',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50',
  },
  STATION: {
    label: 'SPACE STATION',
    badgeClass: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/50',
  },
}

export default function MissionLobbyScreen({
  view,
  clientId,
  playerName,
  onChangePlayerName,
  room,
  onEnterRoom,
  onBackToMenu,
  onNotify,
}: Props) {
  const [activeRooms, setActiveRooms] = useState<RoomSnapshot[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [clearingRooms, setClearingRooms] = useState(false)
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [autoStartSec, setAutoStartSec] = useState<number | null>(null)

  const refreshActiveRooms = useCallback(async (silent = false) => {
    if (!silent) setLoadingRooms(true)
    try {
      const list = await listActiveRooms()
      setActiveRooms(list)
    } catch {
      if (!silent) setErrorMsg('Unable to reach the network room server.')
    } finally {
      if (!silent) setLoadingRooms(false)
    }
  }, [])

  // Sondeo de salas activas en red mientras estamos en la vista de unirse
  useEffect(() => {
    if (view !== 'join' || room) return
    void refreshActiveRooms()
    const timer = window.setInterval(() => {
      void refreshActiveRooms(true)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [view, room, refreshActiveRooms])

  const myRole = room ? findMyRoleInRoom(room, clientId) : null
  const isHost = Boolean(room && room.hostClientId === clientId)
  const claimedCount = room ? Object.keys(room.roles ?? {}).length : 0
  const participantsList = useMemo(
    () => (room?.members ? Object.values(room.members) : room?.participants ?? []),
    [room?.members, room?.participants]
  )
  const connectedCount = participantsList.length
  const isRoomFull = connectedCount >= 4

  const allParticipantsHaveRole = useMemo(() => {
    if (!room || !myRole) return false
    const claimedClients = new Set(Object.values(room.roles ?? {}).map((c) => c.clientId))
    if (participantsList.length === 0) return claimedCount > 0
    return participantsList.every((p) => claimedClients.has(p.clientId))
  }, [room, myRole, participantsList, claimedCount])

  const timerActive = Boolean(
    room &&
      room.phase === 'LOBBY' &&
      isRoomFull &&
      !allParticipantsHaveRole &&
      (typeof room.selectionDeadlineAt === 'number' ||
        typeof room.selectionRemainingSec === 'number')
  )

  // Reloj local para animar la cuenta regresiva únicamente cuando la sala está completa (4/4)
  useEffect(() => {
    if (!timerActive) return
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [timerActive])

  const remainingSec = useMemo<number | null>(() => {
    if (!room || room.phase !== 'LOBBY') return null
    if (!isRoomFull || allParticipantsHaveRole) return null
    if (typeof room.selectionDeadlineAt === 'number') {
      return Math.max(0, Math.ceil((room.selectionDeadlineAt - nowMs) / 1000))
    }
    return typeof room.selectionRemainingSec === 'number' ? room.selectionRemainingSec : null
  }, [room, isRoomFull, allParticipantsHaveRole, nowMs])

  // Cuando el temporizador de sala llena (4/4) toca 00s en LOBBY, sincronizamos para mostrar roles auto-asignados
  const expiredSyncDoneRef = useRef<string | null>(null)
  useEffect(() => {
    if (!room || room.phase !== 'LOBBY' || !isRoomFull || allParticipantsHaveRole) {
      expiredSyncDoneRef.current = null
      return
    }
    if (remainingSec === null || remainingSec > 0) {
      expiredSyncDoneRef.current = null
      return
    }
    const sig = `${room.code}:${room.selectionDeadlineAt ?? 0}`
    if (expiredSyncDoneRef.current === sig) return
    expiredSyncDoneRef.current = sig
    void sendRoomHeartbeat(room.code, clientId, playerName)
      .then((res) => {
        if (res.room) onEnterRoom(res.room)
      })
      .catch(() => {})
  }, [room, isRoomFull, allParticipantsHaveRole, remainingSec, clientId, playerName, onEnterRoom])

  const handleClearAllRooms = async () => {
    if (clearingRooms) return
    playClick()
    setClearingRooms(true)
    setErrorMsg(null)
    try {
      await clearAllMultiplayerRooms()
      setActiveRooms([])
      onNotify('All network rooms cleared (0 active)')
    } catch {
      setErrorMsg('Failed to clear server rooms.')
    } finally {
      setClearingRooms(false)
    }
  }

  const handleJoinRoom = async (codeRaw: string) => {
    const clean = normalizeRoomCode(codeRaw)
    if (!clean) {
      setErrorMsg('Enter a valid room code (e.g., CUSCO-25).')
      return
    }
    if (busy) return
    playClick()
    setBusy(true)
    setErrorMsg(null)
    try {
      const existing = await fetchRoomByCode(clean)
      if (!existing) {
        setErrorMsg(`No active room exists with code "${clean}".`)
        return
      }
      const joinRes = await joinMultiplayerRoom(clean, clientId, playerName)
      if (!joinRes.ok || !joinRes.room) {
        const msg =
          joinRes.status === 404
            ? `No active room exists with code "${clean}".`
            : joinRes.error || 'Unable to join room.'
        setErrorMsg(msg)
        onNotify(msg)
        void refreshActiveRooms(true)
        return
      }
      onEnterRoom(joinRes.room)
      onNotify(`Connected to room ${clean}`)
    } catch {
      setErrorMsg(`Connection error joining room "${clean}".`)
    } finally {
      setBusy(false)
    }
  }

  const handleClaimRole = async (roleId: RoleId) => {
    if (!room || busy) return
    const existingMyRole = findMyRoleInRoom(room, clientId)
    if (existingMyRole) {
      onNotify(
        `🔒 Your crew role is locked as ${ROLE_INFO[existingMyRole].code} while the team finishes selection.`
      )
      return
    }
    const currentClaim = room.roles?.[roleId]
    if (currentClaim && currentClaim.clientId !== clientId) {
      onNotify(`🔒 ${ROLE_INFO[roleId].code} is already selected by ${currentClaim.playerName}`)
      return
    }

    playClick()
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await postRoomAction(room.code, {
        action: 'claim_role',
        clientId,
        playerName,
        roleId,
        role: roleId,
      })
      if (res.room) onEnterRoom(res.room)
      if (res.status === 409) {
        const msg =
          res.error === 'ALREADY_HAS_ROLE'
            ? '🔒 You have already selected a crew role; it remains locked until the squad is ready.'
            : `🔒 ${ROLE_INFO[roleId].code} was just claimed by ${res.ownerName ?? 'another pilot'}!`
        setErrorMsg(msg)
        onNotify(msg)
      } else if (res.ok) {
        onNotify(
          `✔ Selected and locked ${ROLE_INFO[roleId].icon} ${ROLE_INFO[roleId].code}`
        )
      }
    } catch {
      setErrorMsg('Error syncing role selection.')
    } finally {
      setBusy(false)
    }
  }

  const handleResetRoles = async () => {
    if (!room || busy) return
    playClick()
    setBusy(true)
    setAutoStartSec(null)
    try {
      const res = await postRoomAction(room.code, {
        action: 'reset',
        clientId,
        playerName,
      })
      if (res.room) onEnterRoom(res.room)
      onNotify(
        isRoomFull
          ? 'Roles reset · 15s countdown started (4/4)'
          : 'Roles reset · Waiting for 4/4 crew in room'
      )
    } finally {
      setBusy(false)
    }
  }

  const handleCloseRoom = async () => {
    if (!room || busy) return
    playClick()
    setBusy(true)
    try {
      await postRoomAction(room.code, {
        action: 'close_room',
        clientId,
        playerName,
      })
      onNotify(`Room ${room.code} closed and deleted`)
    } catch {
      // ignorar
    } finally {
      setBusy(false)
      onBackToMenu()
    }
  }

  const handleLeaveRoomToMenu = () => {
    playClick()
    onBackToMenu()
  }

  const handleHostEnterBriefing = useCallback(async () => {
    if (!room || busy) return
    const myRole = findMyRoleInRoom(room, clientId)
    if (!myRole) {
      const msg = 'Select your crew role above before advancing to mission selection.'
      setErrorMsg(msg)
      onNotify(msg)
      return
    }
    playClick()
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await postRoomAction(room.code, {
        action: 'set_phase',
        clientId,
        playerName,
        phase: 'MISSION_BRIEFING',
      })
      if (res.room) onEnterRoom(res.room)
    } catch {
      setErrorMsg('Unable to advance to Scientific Mission Briefing.')
    } finally {
      setBusy(false)
    }
  }, [room, busy, clientId, playerName, onEnterRoom, onNotify])

  // Auto-inicio sincronizado en 3s únicamente cuando los 4/4 jugadores de la sala ya tienen rol bloqueado
  const shouldAutoAdvance =
    Boolean(room && room.phase === 'LOBBY' && allParticipantsHaveRole) &&
    (isRoomFull || claimedCount >= 4)

  const autoLaunchTriggeredRef = useRef(false)
  useEffect(() => {
    if (!shouldAutoAdvance) {
      setAutoStartSec(null)
      autoLaunchTriggeredRef.current = false
      return
    }
    setAutoStartSec(3)
    const interval = window.setInterval(() => {
      setAutoStartSec((prev) => {
        if (prev === null) return 3
        if (prev <= 1) return 0
        return prev - 1
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [shouldAutoAdvance])

  useEffect(() => {
    if (autoStartSec !== 0 || !isHost || autoLaunchTriggeredRef.current) return
    autoLaunchTriggeredRef.current = true
    void handleHostEnterBriefing()
  }, [autoStartSec, isHost, handleHostEnterBriefing])

  const copyRoomCode = () => {
    if (!room) return
    playClick()
    try {
      void navigator.clipboard.writeText(room.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
      onNotify(`Code ${room.code} copied to clipboard`)
    } catch {
      onNotify(`Room code: ${room.code}`)
    }
  }

  // ==================== VISTA A: UNIRSE POR CÓDIGO O SALAS ACTIVAS ====================
  if (view === 'join' || !room) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl mx-auto px-3 font-pixel text-white overflow-x-hidden min-w-0"
      >
        <div className="mc-panel p-3 sm:p-4 bg-[#090f24]/94 border-2 border-cyan-400/55 shadow-[0_14px_45px_rgba(0,0,0,0.8)] min-w-0">
          {/* Cabecera */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 mb-3 border-b-2 border-black/80 min-w-0">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <button
                onMouseEnter={playHover}
                onClick={() => {
                  playClick()
                  onBackToMenu()
                }}
                className="mc-btn px-2.5 py-1 text-[clamp(8.5px,0.68vw,10px)] flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <ArrowLeft size={13} />
                <span>BACK TO MENU</span>
              </button>
              <div className="min-w-0">
                <div className="text-[clamp(7.5px,0.6vw,9px)] text-cyan-300 truncate">
                  LAN MULTIPLAYER · ANDEAN SQUADRON
                </div>
                <h2
                  className="text-[clamp(10px,0.9vw,13px)] text-yellow-300 mt-0.5 truncate"
                  style={{ textShadow: '2px 2px 0 #000' }}
                >
                  JOIN MISSION ROOM
                </h2>
              </div>
            </div>

            {/* Nombre del Piloto persistente en localStorage */}
            <div className="flex items-center gap-2 bg-black/50 px-2 py-1 border border-cyan-500/40 rounded shrink-0">
              <span className="text-[clamp(8.5px,0.68vw,10px)] text-cyan-300 whitespace-nowrap">
                PILOT:
              </span>
              <input
                type="text"
                maxLength={18}
                value={playerName}
                onChange={(e) => onChangePlayerName(e.target.value)}
                placeholder="Pilot callsign..."
                className="bg-[#0d1836] border border-cyan-400/50 px-2 py-0.5 text-[clamp(9px,0.72vw,11px)] text-yellow-200 font-pixel w-32 sm:w-36 focus:outline-none focus:border-yellow-400"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="mb-2.5 px-3 py-1.5 bg-red-950/90 border border-red-400 text-red-200 text-[clamp(8.5px,0.68vw,10px)]">
              ⚠ {errorMsg}
            </div>
          )}

          {/* Ingreso por Código de Sala */}
          <div className="p-3 bg-[#0f1a38]/90 border-2 border-cyan-400/45 rounded mb-3">
            <div className="text-[clamp(8.5px,0.68vw,10px)] text-cyan-300 font-bold mb-1.5">
              🔑 JOIN BY ROOM CODE
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleJoinRoom(joinCodeInput)
              }}
              className="flex flex-col sm:flex-row gap-2 min-w-0"
            >
              <input
                type="text"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(normalizeRoomCode(e.target.value))}
                placeholder="ROOM CODE (E.G., CUSCO-25)"
                className="flex-1 min-w-0 bg-black/75 border-2 border-cyan-500/60 px-3 py-2 text-[clamp(9.5px,0.78vw,12px)] text-yellow-300 tracking-wider font-pixel placeholder:text-slate-500 focus:outline-none focus:border-yellow-400"
              />
              <button
                type="submit"
                onMouseEnter={playHover}
                disabled={busy || !joinCodeInput.trim()}
                className="mc-btn px-4 py-2 text-[clamp(9.5px,0.78vw,12px)] flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
              >
                <LogIn size={14} />
                <span>{busy ? 'CONNECTING...' : 'JOIN ROOM'}</span>
              </button>
            </form>
          </div>

          {/* Lista de Salas Activas en Red */}
          <div className="p-3 bg-[#0c142c]/90 border-2 border-slate-700 rounded">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[clamp(9.5px,0.78vw,12px)] text-emerald-300 font-bold truncate">
                  🌐 ACTIVE NETWORK ROOMS ({activeRooms.length})
                </span>
                <span className="text-[clamp(7.5px,0.6vw,9px)] text-emerald-400 whitespace-nowrap shrink-0">
                  ● LIVE
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onMouseEnter={playHover}
                  onClick={() => void handleClearAllRooms()}
                  disabled={clearingRooms}
                  className="px-2 py-1 text-[clamp(7.5px,0.62vw,9px)] bg-red-950/85 hover:bg-red-900 border border-red-500/60 text-red-200 flex items-center gap-1 rounded whitespace-nowrap disabled:opacity-50"
                  title="Delete all active rooms from the server"
                >
                  <Trash2 size={11} />
                  <span>{clearingRooms ? 'CLEARING...' : 'CLOSE / CLEAR ROOMS'}</span>
                </button>
                <button
                  onMouseEnter={playHover}
                  onClick={() => void refreshActiveRooms()}
                  className="px-2 py-1 text-[clamp(7.5px,0.62vw,9px)] bg-slate-900 hover:bg-slate-800 border border-cyan-500/40 text-cyan-200 flex items-center gap-1 rounded whitespace-nowrap"
                >
                  <RefreshCw size={11} className={loadingRooms ? 'animate-spin' : ''} />
                  <span>REFRESH</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto overflow-x-hidden pr-1">
              {activeRooms.length === 0 ? (
                <div className="p-3.5 bg-black/45 border border-slate-700/80 text-center font-sans text-xs text-slate-400 rounded">
                  No active rooms right now (0 rooms). Click{' '}
                  <strong className="text-yellow-300">+ CREATE ROOM</strong> from the main menu
                  to launch a new mission room.
                </div>
              ) : (
                activeRooms.map((r) => {
                  const roomClaimCount = Object.keys(r.roles ?? {}).length
                  const ph = PHASE_LABEL[r.phase]
                  const full = r.playerCount >= 4 && !r.members?.[clientId]
                  return (
                    <button
                      key={r.code}
                      onMouseEnter={playHover}
                      onClick={() => void handleJoinRoom(r.code)}
                      className="w-full min-w-0 text-left p-2 bg-black/60 hover:bg-cyan-950/60 border-2 border-cyan-500/40 hover:border-yellow-400 rounded flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="px-2 py-0.5 bg-yellow-400 text-black text-[clamp(9.5px,0.78vw,12px)] font-bold tracking-wider rounded shrink-0 whitespace-nowrap">
                          {r.code}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[clamp(8.5px,0.68vw,10px)] text-white truncate">
                            HOST: <span className="text-cyan-300">{r.hostName}</span>
                          </div>
                          <div className="text-[9px] text-slate-400 font-sans truncate">
                            Connected: {r.playerCount}/4 · Roles selected: {roomClaimCount}/4
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`px-1.5 py-0.5 text-[clamp(7px,0.58vw,8px)] border rounded whitespace-nowrap ${ph.badgeClass}`}
                        >
                          {ph.label}
                        </span>
                        <span
                          className={`px-2.5 py-1 text-white text-[clamp(7.5px,0.62vw,9px)] rounded font-bold whitespace-nowrap ${
                            full ? 'bg-red-800/90 border border-red-400/60' : 'bg-emerald-600'
                          }`}
                        >
                          {full ? 'FULL 4/4' : 'JOIN →'}
                        </span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </motion.div>
    )
  }

  // ==================== VISTA B: DENTRO DE SALA (4 TARJETAS ANIMADAS + BLOQUEO FIRME) ====================
  const phInfo = PHASE_LABEL[room.phase]
  const timerUrgent = room.phase === 'LOBBY' && remainingSec !== null && remainingSec <= 5

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-6xl mx-auto px-3 font-pixel text-white overflow-x-hidden min-w-0"
    >
      <div className="mc-panel p-2.5 sm:p-3.5 bg-[#090f24]/95 border-2 border-cyan-400/60 shadow-[0_14px_45px_rgba(0,0,0,0.8)] min-w-0">
        {/* Cabecera de Sala Compartida */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2.5 border-b-2 border-black min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <button
              onMouseEnter={playHover}
              onClick={handleLeaveRoomToMenu}
              className="mc-btn px-2 py-1 text-[clamp(7.5px,0.6vw,9px)] flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <ArrowLeft size={12} />
              <span>BACK TO MENU</span>
            </button>

            <div className="flex items-center gap-1.5 bg-black/75 border-2 border-yellow-400 px-2.5 py-1 rounded shrink-0">
              <span className="text-[clamp(7.5px,0.6vw,9px)] text-slate-300">ROOM:</span>
              <span className="text-[clamp(11px,0.95vw,15px)] text-yellow-300 font-bold tracking-widest whitespace-nowrap">
                {room.code}
              </span>
              <button
                onClick={copyRoomCode}
                title="Copy room code"
                className="p-1 bg-yellow-400/20 hover:bg-yellow-400/40 text-yellow-200 rounded"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>

            {/* Temporizador de Selección de Rol: OCULTO mientras falten jugadores (X/4); activo solo en sala llena 4/4 */}
            {room.phase === 'LOBBY' && (
              !isRoomFull ? (
                <span className="px-2 py-1 text-[clamp(7.5px,0.6vw,9px)] font-bold border-2 rounded flex items-center gap-1.5 bg-amber-950/75 border-amber-400/80 text-amber-200 max-w-full min-w-0">
                  <Clock size={12} className="animate-pulse shrink-0" />
                  <span className="truncate">
                    ⏳ Awaiting crew ({connectedCount}/4 connected)...
                  </span>
                </span>
              ) : allParticipantsHaveRole ? (
                <span className="px-2 py-1 text-[clamp(7.5px,0.6vw,9px)] font-bold border-2 rounded flex items-center gap-1.5 bg-emerald-950 border-emerald-400 text-emerald-300 whitespace-nowrap">
                  <Check size={12} />
                  <span>4/4 CREW READY</span>
                </span>
              ) : remainingSec !== null ? (
                <span
                  className={`px-2 py-1 text-[clamp(8px,0.65vw,10px)] font-bold border-2 rounded flex items-center gap-1.5 whitespace-nowrap ${
                    remainingSec === 0
                      ? 'bg-emerald-950 border-emerald-400 text-emerald-300'
                      : timerUrgent
                        ? 'bg-red-950 border-red-400 text-red-200 animate-pulse'
                        : 'bg-[#0e1b3a] border-cyan-400/70 text-cyan-200'
                  }`}
                  title="Room full 4/4: remaining open roles will be auto-assigned at 00s"
                >
                  <Clock size={12} />
                  <span>
                    {remainingSec === 0
                      ? '⏱ AUTO-ASSIGNING...'
                      : `⏱ ${String(remainingSec).padStart(2, '0')}s until auto-assignment`}
                  </span>
                </span>
              ) : null
            )}

            <span
              className={`px-1.5 py-0.5 text-[clamp(7.5px,0.6vw,9px)] border rounded whitespace-nowrap ${phInfo.badgeClass}`}
            >
              {phInfo.label}
            </span>

            <span
              title={isHost ? 'HOST' : `HOST: ${room.hostName}`}
              className={`px-1.5 py-0.5 text-[clamp(7.5px,0.6vw,9px)] border rounded max-w-[165px] truncate ${
                isHost
                  ? 'bg-amber-500/25 text-amber-200 border-amber-400'
                  : 'bg-slate-800 text-cyan-300 border-cyan-500/40'
              }`}
            >
              {isHost ? '👑 HOST' : `🌐 HOST: ${room.hostName}`}
            </span>

            <span className="px-1.5 py-0.5 text-[clamp(7.5px,0.6vw,9px)] bg-black/50 border border-slate-600 text-slate-200 rounded flex items-center gap-1 whitespace-nowrap">
              <Users size={11} className="text-emerald-400 shrink-0" />
              {connectedCount}/4 IN ROOM · {claimedCount}/4 ROLES
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-1.5 bg-black/50 px-2 py-0.5 border border-cyan-500/35 rounded">
              <span className="text-[clamp(7.5px,0.6vw,9px)] text-cyan-300 whitespace-nowrap">
                PILOT:
              </span>
              <input
                type="text"
                maxLength={18}
                value={playerName}
                onChange={(e) => onChangePlayerName(e.target.value)}
                className="bg-[#0d1836] border border-cyan-400/40 px-1.5 py-0.5 text-[clamp(8.5px,0.68vw,10px)] text-yellow-200 font-pixel w-24 sm:w-28 focus:outline-none focus:border-yellow-400"
              />
            </div>

            {isHost && (
              <>
                <button
                  onClick={() => void handleResetRoles()}
                  className="px-2 py-1 text-[clamp(7.5px,0.6vw,9px)] bg-slate-900 hover:bg-amber-950/70 border border-amber-500/50 text-amber-200 rounded flex items-center gap-1 whitespace-nowrap"
                  title="Release all crew roles and reset timer"
                >
                  <RotateCcw size={11} />
                  <span>RELEASE ROLES</span>
                </button>
                <button
                  onClick={() => void handleCloseRoom()}
                  className="px-2 py-1 text-[clamp(7.5px,0.6vw,9px)] bg-red-950/85 hover:bg-red-900 border border-red-500/60 text-red-200 rounded flex items-center gap-1 whitespace-nowrap"
                  title="Close and delete this room"
                >
                  <Trash2 size={11} />
                  <span>CLOSE ROOM</span>
                </button>
              </>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="mb-2 px-3 py-1 bg-red-950/90 border border-red-400 text-red-200 text-[clamp(8.5px,0.68vw,10px)]">
            ⚠ {errorMsg}
          </div>
        )}

        {/* 4 Tarjetas Pixel-Art de Selección de Personaje con Bloqueo Firme */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 min-w-0">
          {CHARACTER_ORDER.map((roleId) => {
            const info = ROLE_INFO[roleId]
            const focus = ROLE_WORKSHOP_FOCUS[roleId]
            const claim = room.roles?.[roleId]
            const isMine = claim?.clientId === clientId
            const isTakenByOther = Boolean(claim && !isMine)
            const lockedBecauseAlreadyPicked = Boolean(!claim && myRole !== null)

            return (
              <div
                key={roleId}
                className={`relative flex flex-col justify-between p-2 rounded border-2 transition-all min-w-0 ${
                  isMine
                    ? 'bg-emerald-950/65 border-emerald-400 ring-2 ring-yellow-400/80 shadow-[0_0_24px_rgba(74,222,128,0.38)]'
                    : isTakenByOther
                      ? 'bg-red-950/30 border-amber-500/70'
                      : 'bg-[#0e1938]/90 border-cyan-500/45 hover:border-emerald-400'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1 min-w-0">
                    <span
                      className="text-[clamp(8.5px,0.7vw,10.5px)] font-bold tracking-wide whitespace-nowrap truncate min-w-0"
                      style={{ color: info.color }}
                      title={info.code}
                    >
                      {info.icon} {info.code}
                    </span>
                    {isMine ? (
                      <span className="px-1 py-0.5 text-[clamp(6.5px,0.52vw,7.5px)] bg-yellow-400 text-black font-bold rounded whitespace-nowrap shrink-0">
                        ✔ YOURS
                      </span>
                    ) : isTakenByOther ? (
                      <span className="px-1 py-0.5 text-[clamp(6.5px,0.52vw,7.5px)] bg-red-950 border border-amber-400 text-amber-200 rounded flex items-center gap-0.5 whitespace-nowrap shrink-0">
                        <Lock size={8} /> LOCKED
                      </span>
                    ) : (
                      <span className="px-1 py-0.5 text-[clamp(6.5px,0.55vw,8px)] bg-emerald-950 border border-emerald-400 text-emerald-300 rounded whitespace-nowrap shrink-0">
                        ● AVAILABLE
                      </span>
                    )}
                  </div>

                  {/* Escena Pixel-Art animada de cuerpo completo (Alpaca / Serpiente / Puma / Cóndor) */}
                  <div className="relative h-28 bg-[#050a18] overflow-hidden mb-1.5">
                    <CharacterPortrait characterId={info.characterId} variant="scene" />
                    {isTakenByOther && (
                      <div className="absolute inset-x-0 top-0 bg-red-950/88 border-b border-amber-400/80 px-2 py-0.5 flex items-center justify-center gap-1 text-center min-w-0">
                        <Lock size={10} className="text-amber-300 shrink-0" />
                        <span
                          className="text-[clamp(7px,0.55vw,8px)] text-amber-200 font-bold truncate"
                          title={`CLAIMED BY ${claim?.playerName.toUpperCase()}`}
                        >
                          BY {claim?.playerName.toUpperCase()}
                        </span>
                      </div>
                    )}
                    {isMine && (
                      <div className="absolute inset-x-0 top-0 bg-emerald-900/90 border-b border-yellow-400 px-2 py-0.5 text-center text-[clamp(7px,0.55vw,8px)] text-yellow-300 font-bold truncate">
                        ✔ YOUR SELECTED ROLE
                      </div>
                    )}
                  </div>

                  <div className="text-[clamp(8.5px,0.68vw,10px)] text-white font-bold mb-1 truncate">
                    {info.name}
                  </div>
                  <RpgStatBars characterId={info.characterId} compact />

                  <div className="mt-1.5 p-1.5 bg-black/55 border border-slate-700/80 rounded space-y-0.5">
                    <div className="text-[clamp(7px,0.58vw,8px)] text-cyan-300">
                      🔧 WORKSHOP: <span className="text-slate-200 font-sans">{focus.badge}</span>
                    </div>
                    <div className="text-[clamp(7px,0.58vw,8px)] text-amber-300">
                      🛰 STATION: <span className="text-slate-200 font-sans">{focus.stationTasks}</span>
                    </div>
                  </div>
                </div>

                {/* Bloqueo firme: una vez que el jugador elige un personaje, su rol y los otros 3 botones quedan bloqueados hasta que el Host reinicie o todos completen */}
                <button
                  onMouseEnter={
                    isMine || isTakenByOther || lockedBecauseAlreadyPicked ? undefined : playHover
                  }
                  onClick={() => void handleClaimRole(roleId)}
                  disabled={busy || isMine || isTakenByOther || lockedBecauseAlreadyPicked}
                  title={
                    isTakenByOther
                      ? `🔒 CLAIMED BY ${claim?.playerName.toUpperCase()}`
                      : undefined
                  }
                  className={`mt-2 w-full py-1.5 px-1.5 text-[clamp(7.5px,0.6vw,9px)] font-bold border-2 rounded transition-colors truncate whitespace-nowrap ${
                    isMine
                      ? 'bg-emerald-500 border-yellow-300 text-black cursor-default shadow-[0_0_12px_rgba(74,222,128,0.5)]'
                      : isTakenByOther
                        ? 'bg-red-950/85 border-amber-500/70 text-amber-200 cursor-not-allowed opacity-90'
                        : lockedBecauseAlreadyPicked
                          ? 'bg-slate-900 border-slate-700 text-slate-500 cursor-not-allowed'
                          : 'bg-emerald-700 hover:bg-emerald-600 border-emerald-400 text-white'
                  }`}
                >
                  {isMine
                    ? '✔ YOUR CREW'
                    : isTakenByOther
                      ? `🔒 ${claim?.playerName.slice(0, 10).toUpperCase()}`
                      : lockedBecauseAlreadyPicked
                        ? '🔒 ROLE LOCKED'
                        : `SELECT ${info.code}`}
                </button>
              </div>
            )
          })}
        </div>

        {/* Barra Inferior de Transición Sincronizada al Taller */}
        <div className="mt-2.5 pt-2.5 border-t-2 border-black flex flex-wrap items-center justify-between gap-2 min-w-0">
          <div className="font-sans text-xs text-slate-300 min-w-0 flex-1">
            {!isRoomFull ? (
              myRole ? (
                <span>
                  <strong className="text-amber-300">
                    ⏳ Awaiting crew in room ({connectedCount}/4 connected)...
                  </strong>{' '}
                  · Locked role:{' '}
                  <strong className="text-yellow-300">
                    {ROLE_INFO[myRole].icon} {ROLE_INFO[myRole].code}
                  </strong>
                  .
                </span>
              ) : (
                <span className="text-amber-300">
                  ⏳ Awaiting crew in room ({connectedCount}/4 connected)... You may select an{' '}
                  <strong className="text-emerald-300">● AVAILABLE</strong> role above.
                </span>
              )
            ) : myRole ? (
              autoStartSec !== null ? (
                <span className="text-emerald-300 font-bold">
                  🚀 Full crew assigned! Advancing to Mission Selection in{' '}
                  <span className="text-yellow-300">{autoStartSec}s</span>...
                </span>
              ) : (
                <span>
                  Locked role:{' '}
                  <strong className="text-yellow-300">
                    {ROLE_INFO[myRole].icon} {ROLE_INFO[myRole].code}
                  </strong>{' '}
                  · Waiting for remaining squadron (4/4) to select{' '}
                  <strong className="text-cyan-300">Science Mission & Launch Vehicle</strong>.
                </span>
              )
            ) : (
              <span className="text-amber-300">
                ⚠ Room full (4/4): select an{' '}
                <strong className="text-emerald-300">● AVAILABLE</strong> role above before the
                countdown ends (
                {remainingSec !== null ? `${String(remainingSec).padStart(2, '0')}s` : 'auto'}).
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isHost ? (
              <button
                onMouseEnter={allParticipantsHaveRole ? playHover : undefined}
                onClick={() => void handleHostEnterBriefing()}
                disabled={busy || !allParticipantsHaveRole}
                className="mc-btn px-4 py-2 text-[clamp(9.5px,0.78vw,12px)] font-bold flex items-center gap-2 whitespace-nowrap disabled:opacity-55"
                style={{
                  background: allParticipantsHaveRole
                    ? 'linear-gradient(180deg, #22c55e 0%, #15803d 100%)'
                    : 'linear-gradient(180deg, #475569 0%, #334155 100%)',
                  borderColor: allParticipantsHaveRole ? '#86efac' : '#94a3b8',
                  boxShadow: allParticipantsHaveRole ? '0 0 18px rgba(34,197,94,0.55)' : undefined,
                }}
              >
                <Rocket size={15} />
                <span>
                  🚀 SELECT SCIENCE MISSION ({claimedCount}/4)
                </span>
              </button>
            ) : (
              <div className="px-3 py-1.5 bg-cyan-950/80 border-2 border-cyan-400/60 text-cyan-200 text-[clamp(8.5px,0.68vw,10px)] rounded flex items-center gap-2">
                <span className="animate-pulse">⏳</span>
                <span>
                  {autoStartSec !== null
                    ? `SQUADRON READY · LOADING MISSION IN ${autoStartSec}s...`
                    : room.phase === 'LOBBY'
                      ? `WAITING FOR HOST (${room.hostName}) TO START MISSION...`
                      : `SELECT AN AVAILABLE ROLE ABOVE TO ENTER ${phInfo.label}`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
