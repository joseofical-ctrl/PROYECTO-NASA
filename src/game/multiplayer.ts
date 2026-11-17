import { ROLE_ORDER } from './catalog'
import type { RoleId } from './catalog'
import type { LauncherId, MissionId } from './missions'

export type RoomPhase = 'LOBBY' | 'MISSION_BRIEFING' | 'WORKSHOP' | 'LAUNCH' | 'STATION'
export type SatelliteId = 'sat1' | 'sat2'

export interface RoleClaimEntry {
  clientId: string
  playerName: string
  timestamp: number
}

export type RoleClaimsMap = Partial<Record<RoleId, RoleClaimEntry>>

export interface SatelliteDesignSync {
  id: SatelliteId
  code: string
  contractId: string
  launcherId: string
  chassisId: string
  parts: Record<string, number>
  updatedAt: number
  updatedByRole?: RoleId | string
  updatedByName?: string
  lastActionLabel?: string
}

export interface RoomMember {
  clientId: string
  pilotName: string
  roleId: string | null
  isHost: boolean
  lastSeen: number
}

export interface RoomParticipant {
  clientId: string
  playerName: string
  roleId?: string | null
  isHost?: boolean
  lastSeen: number
}

export interface RoomSnapshot {
  code: string
  hostClientId: string
  hostName: string
  phase: RoomPhase
  currentMissionIndex?: 1 | 2 | 3
  missionId?: MissionId
  launcherId?: LauncherId
  createdAt: number
  updatedAt: number
  selectionDeadlineAt?: number | null
  selectionRemainingSec?: number | null
  briefingDeadlineAt?: number | null
  briefingRemainingSec?: number | null
  briefingReady?: Record<string, boolean>
  briefingReadyClients?: string[]
  playerCount: number
  members?: Record<string, RoomMember>
  participants: RoomParticipant[]
  roles: RoleClaimsMap
  claims: RoleClaimsMap
  satellites: Record<SatelliteId, SatelliteDesignSync>
}

export const SATELLITE_META: Record<
  SatelliteId,
  {
    id: SatelliteId
    code: string
    subtitle: string
    icon: string
    defaultContract: string
    defaultLauncher: string
    defaultChassis: string
  }
> = {
  sat1: {
    id: 'sat1',
    code: 'SAT-01 AMARU-COMMS',
    subtitle: 'Andean Earth Observation & Telecom Relay',
    icon: '🛰️',
    defaultContract: 'andes',
    defaultLauncher: 'rideshare',
    defaultChassis: '6U',
  },
  sat2: {
    id: 'sat2',
    code: 'SAT-02 INTI-SCIENCE',
    subtitle: 'Secondary Deep-Space Science Explorer',
    icon: '🔭',
    defaultContract: 'andes',
    defaultLauncher: 'rideshare',
    defaultChassis: '12U',
  },
}

export const ROLE_WORKSHOP_FOCUS: Record<
  RoleId,
  { badge: string; shortDuty: string; stationTasks: string }
> = {
  director: {
    badge: 'Orbits, Contracts, Launch Vehicle & Liftoff',
    shortDuty: 'Orbit & Launch Validation',
    stationTasks: 'APAS Docking · Comet Defense',
  },
  engineer: {
    badge: 'Solar Arrays, Batteries, ADCS, Shielding & Thrusters',
    shortDuty: 'Spacecraft Power & Structure',
    stationTasks: 'EPS Grid · ECLSS O₂ Support',
  },
  science: {
    badge: 'Cameras, Spectrometers & NASA Science Payload',
    shortDuty: 'Scientific Payload Integration',
    stationTasks: 'Planetary Probe · SAT-02 Orbit',
  },
  comms: {
    badge: 'UHF, S/X-Band Antennas & DSN Deep-Space Link',
    shortDuty: 'Antennas & Telecommunications',
    stationTasks: 'DSN Telecom · Firewall 8080',
  },
}

const LOCAL_ROOMS_CACHE_KEY = 'cubesat_rooms_cache_v1'
const LOCAL_CLOSED_ROOMS_KEY = 'cubesat_closed_rooms_v1'
const MULTIPLAYER_BC_NAME = 'cubesat_multiplayer_sync'
const REQUEST_TIMEOUT_MS = 2500
const LOCAL_CODE_PREFIXES = ['ANDES', 'AGUILA', 'INTI', 'AMARU', 'CONDOR', 'CUSCO', 'QUIPU', 'CHASQUI']

const memoryRoomsCache = new Map<string, RoomSnapshot>()
const memoryClosedRooms = new Map<string, number>()

export function getOrCreateClientId(): string {
  const key = 'squadron_client_id_v1'
  try {
    const existing = window.localStorage.getItem(key)
    if (existing) return existing
    const legacy = window.sessionStorage.getItem(key)
    const uuid =
      legacy ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
    window.localStorage.setItem(key, uuid)
    return uuid
  } catch {
    return `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

export function getDefaultPlayerName(clientId: string): string {
  try {
    const saved =
      window.localStorage.getItem('squadron_player_name_v1') ||
      window.sessionStorage.getItem('squadron_player_name_v1')
    if (saved && saved.trim()) return saved.trim().slice(0, 18)
  } catch {
    // ignore storage errors
  }
  return `PILOT-${clientId.slice(-4).toUpperCase()}`
}

export function savePlayerName(name: string): void {
  try {
    window.localStorage.setItem('squadron_player_name_v1', name)
  } catch {
    // ignore storage errors
  }
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16)
}

function readStoredRoomsMap(): Record<string, RoomSnapshot> {
  try {
    const raw = window.localStorage.getItem(LOCAL_ROOMS_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, RoomSnapshot>) : {}
  } catch {
    return {}
  }
}

function writeStoredRoomsMap(map: Record<string, RoomSnapshot>): void {
  try {
    window.localStorage.setItem(LOCAL_ROOMS_CACHE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota / private mode errors
  }
}

function isRoomMarkedClosed(code: string): boolean {
  const now = Date.now()
  const memExp = memoryClosedRooms.get(code)
  if (typeof memExp === 'number' && memExp > now) return true
  if (typeof memExp === 'number') memoryClosedRooms.delete(code)
  try {
    const raw = window.localStorage.getItem(LOCAL_CLOSED_ROOMS_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as Record<string, number>
    const exp = parsed?.[code]
    if (typeof exp === 'number' && exp > now) return true
  } catch {
    // ignore
  }
  return false
}

function markRoomClosedLocally(code: string): void {
  const clean = normalizeRoomCode(code)
  if (!clean) return
  const exp = Date.now() + 60_000
  memoryClosedRooms.set(clean, exp)
  try {
    const raw = window.localStorage.getItem(LOCAL_CLOSED_ROOMS_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {}
    parsed[clean] = exp
    window.localStorage.setItem(LOCAL_CLOSED_ROOMS_KEY, JSON.stringify(parsed))
  } catch {
    // ignore
  }
}

function unmarkRoomClosedLocally(code: string): void {
  const clean = normalizeRoomCode(code)
  if (!clean) return
  memoryClosedRooms.delete(clean)
  try {
    const raw = window.localStorage.getItem(LOCAL_CLOSED_ROOMS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, number>
    if (parsed && clean in parsed) {
      delete parsed[clean]
      window.localStorage.setItem(LOCAL_CLOSED_ROOMS_KEY, JSON.stringify(parsed))
    }
  } catch {
    // ignore
  }
}

function broadcastSyncMessage(msg: Record<string, unknown>): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(MULTIPLAYER_BC_NAME)
      bc.postMessage({ ...msg, ts: Date.now() })
      bc.close()
    }
  } catch {
    // optional BroadcastChannel
  }
}

// Keep memoryRoomsCache synced across same-origin tabs via BroadcastChannel
try {
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    const listenerBc = new BroadcastChannel(MULTIPLAYER_BC_NAME)
    listenerBc.onmessage = (ev) => {
      const d = ev.data as { type?: string; room?: RoomSnapshot; code?: string } | null
      if (!d || typeof d !== 'object') return
      if (d.type === 'room_update' && d.room?.code) {
        const clean = normalizeRoomCode(d.room.code)
        unmarkRoomClosedLocally(clean)
        memoryRoomsCache.set(clean, d.room)
        const stored = readStoredRoomsMap()
        stored[clean] = d.room
        writeStoredRoomsMap(stored)
      } else if (d.type === 'room_deleted' && d.code) {
        const clean = normalizeRoomCode(d.code)
        memoryRoomsCache.delete(clean)
        markRoomClosedLocally(clean)
        const stored = readStoredRoomsMap()
        if (clean in stored) {
          delete stored[clean]
          writeStoredRoomsMap(stored)
        }
      }
    }
  }
} catch {
  // ignore
}

export function getCachedRoomSnapshot(code: string): RoomSnapshot | null {
  const clean = normalizeRoomCode(code)
  if (!clean || isRoomMarkedClosed(clean)) return null
  const mem = memoryRoomsCache.get(clean)
  if (mem) return mem
  const stored = readStoredRoomsMap()
  const hit = stored[clean]
  if (hit && typeof hit === 'object') {
    memoryRoomsCache.set(clean, hit)
    return hit
  }
  return null
}

export function saveCachedRoomSnapshot(room: RoomSnapshot | null | undefined, broadcast = true): void {
  if (!room || !room.code) return
  const clean = normalizeRoomCode(room.code)
  if (!clean) return
  unmarkRoomClosedLocally(clean)
  memoryRoomsCache.set(clean, room)
  const stored = readStoredRoomsMap()
  stored[clean] = room
  writeStoredRoomsMap(stored)
  if (broadcast) {
    broadcastSyncMessage({ type: 'room_update', room })
  }
}

function removeCachedRoomSnapshot(code: string, markClosed: boolean): void {
  const clean = normalizeRoomCode(code)
  if (!clean) return
  memoryRoomsCache.delete(clean)
  if (markClosed) markRoomClosedLocally(clean)
  const stored = readStoredRoomsMap()
  if (clean in stored) {
    delete stored[clean]
    writeStoredRoomsMap(stored)
  }
  if (markClosed) {
    broadcastSyncMessage({ type: 'room_deleted', code: clean })
  }
}

function generateLocalRoomCode(): string {
  const prefix = LOCAL_CODE_PREFIXES[Math.floor(Math.random() * LOCAL_CODE_PREFIXES.length)]
  const num = String(Math.floor(10 + Math.random() * 89))
  return `${prefix}-${num}`
}

function buildLocalRoomSnapshot(code: string, clientId: string, playerName: string): RoomSnapshot {
  const now = Date.now()
  const cleanName = (playerName || '').trim().slice(0, 24) || 'Commander'
  const member: RoomMember = {
    clientId,
    pilotName: cleanName,
    roleId: null,
    isHost: true,
    lastSeen: now,
  }
  return {
    code,
    hostClientId: clientId,
    hostName: cleanName,
    phase: 'LOBBY',
    currentMissionIndex: 1,
    missionId: 'andes',
    launcherId: 'rideshare',
    createdAt: now,
    updatedAt: now,
    selectionDeadlineAt: null,
    selectionRemainingSec: null,
    briefingDeadlineAt: null,
    briefingRemainingSec: null,
    briefingReady: {},
    briefingReadyClients: [],
    playerCount: 1,
    members: { [clientId]: member },
    participants: [
      {
        clientId,
        playerName: cleanName,
        roleId: null,
        isHost: true,
        lastSeen: now,
      },
    ],
    roles: {},
    claims: {},
    satellites: {
      sat1: {
        id: 'sat1',
        code: 'SAT-01 AMARU-COMMS',
        contractId: 'andes',
        launcherId: 'rideshare',
        chassisId: '6U',
        parts: {},
        updatedAt: now,
      },
      sat2: {
        id: 'sat2',
        code: 'SAT-02 INTI-SCIENCE',
        contractId: 'andes',
        launcherId: 'rideshare',
        chassisId: '12U',
        parts: {},
        updatedAt: now,
      },
    },
  }
}

function missionIndexToIdLocal(idx: 1 | 2 | 3): MissionId {
  if (idx === 2) return 'luna'
  if (idx === 3) return 'sol'
  return 'andes'
}

function defaultLauncherForStageLocal(idx: 1 | 2 | 3): LauncherId {
  if (idx === 2) return 'light'
  if (idx === 3) return 'heavy'
  return 'rideshare'
}

function rebuildParticipants(members: Record<string, RoomMember>): RoomParticipant[] {
  return Object.values(members).map((m) => ({
    clientId: m.clientId,
    playerName: m.pilotName,
    roleId: m.roleId,
    isHost: m.isHost,
    lastSeen: m.lastSeen,
  }))
}

function applyRoomActionLocally(
  baseRoom: RoomSnapshot,
  payload: Record<string, unknown>
): {
  status: number
  ok: boolean
  deleted?: boolean
  explicitlyClosed?: boolean
  code?: string
  error?: string
  ownerName?: string
  ownedRole?: string
  room?: RoomSnapshot
} {
  const now = Date.now()
  const action = typeof payload.action === 'string' ? payload.action.trim() : 'heartbeat'
  const clientId = typeof payload.clientId === 'string' ? payload.clientId.trim() : ''
  const roleId = (
    typeof payload.roleId === 'string'
      ? payload.roleId
      : typeof payload.role === 'string'
        ? payload.role
        : ''
  ).trim() as RoleId | ''
  const playerName =
    typeof payload.playerName === 'string' && payload.playerName.trim()
      ? payload.playerName.trim().slice(0, 24)
      : 'Specialist'

  const next: RoomSnapshot = {
    ...baseRoom,
    members: { ...(baseRoom.members ?? {}) },
    roles: { ...(baseRoom.roles ?? {}) },
    briefingReady: { ...(baseRoom.briefingReady ?? {}) },
    satellites: {
      sat1: {
        ...baseRoom.satellites.sat1,
        parts: { ...(baseRoom.satellites.sat1?.parts ?? {}) },
      },
      sat2: {
        ...baseRoom.satellites.sat2,
        parts: { ...(baseRoom.satellites.sat2?.parts ?? {}) },
      },
    },
  }

  if (action === 'close_room') {
    removeCachedRoomSnapshot(next.code, true)
    return { status: 200, ok: true, deleted: true, explicitlyClosed: true }
  }

  if (action === 'leave' || action === 'leave_room') {
    if (clientId && next.members) {
      delete next.members[clientId]
      if (next.briefingReady) delete next.briefingReady[clientId]
      for (const r of ROLE_ORDER) {
        if (next.roles[r]?.clientId === clientId) delete next.roles[r]
      }
      const remaining = Object.values(next.members)
      const wasHost = next.hostClientId === clientId
      if ((wasHost && next.phase === 'LOBBY') || remaining.length === 0) {
        removeCachedRoomSnapshot(next.code, wasHost && next.phase === 'LOBBY')
        return {
          status: 200,
          ok: true,
          deleted: true,
          explicitlyClosed: wasHost && next.phase === 'LOBBY',
        }
      }
      if (wasHost && remaining.length > 0) {
        next.hostClientId = remaining[0].clientId
        next.hostName = remaining[0].pilotName
      }
    }
    next.participants = rebuildParticipants(next.members ?? {})
    next.playerCount = next.participants.length
    next.claims = next.roles
    next.updatedAt = now
    saveCachedRoomSnapshot(next)
    return { status: 200, ok: true, deleted: false, room: next }
  }

  if (clientId && next.members) {
    const existing = next.members[clientId]
    if (!existing && Object.keys(next.members).length >= 4) {
      return { status: 400, ok: false, code: 'ROOM_FULL', error: 'Room is full (4/4 players)', room: baseRoom }
    }
    const existingRole = ROLE_ORDER.find((r) => next.roles[r]?.clientId === clientId) ?? null
    next.members[clientId] = {
      clientId,
      pilotName: existing?.pilotName && !payload.playerName ? existing.pilotName : playerName,
      roleId: existingRole,
      isHost: !next.hostClientId || next.hostClientId === clientId,
      lastSeen: now,
    }
    if (!next.hostClientId) {
      next.hostClientId = clientId
      next.hostName = next.members[clientId].pilotName
    }
  }

  if (action === 'reset') {
    next.roles = {}
    if (next.members) {
      for (const m of Object.values(next.members)) m.roleId = null
    }
    next.selectionDeadlineAt = null
    next.briefingDeadlineAt = null
    next.briefingReady = {}
    if (payload.resetPhase) {
      next.phase = 'LOBBY'
      next.currentMissionIndex = 1
      next.missionId = 'andes'
      next.launcherId = 'rideshare'
    }
  } else if ((action === 'claim' || action === 'claim_role') && roleId && clientId) {
    const alreadyOwned = ROLE_ORDER.find(
      (r) => r !== roleId && next.roles[r]?.clientId === clientId
    )
    if (alreadyOwned && next.phase === 'LOBBY' && payload.allowSwap !== true) {
      return { status: 409, ok: false, error: 'ALREADY_HAS_ROLE', ownedRole: alreadyOwned, room: baseRoom }
    }
    const current = next.roles[roleId]
    if (current && current.clientId !== clientId) {
      return {
        status: 409,
        ok: false,
        error: 'ROLE_LOCKED_BY_OTHER',
        ownerName: current.playerName,
        room: baseRoom,
      }
    }
    for (const r of ROLE_ORDER) {
      if (r !== roleId && next.roles[r]?.clientId === clientId) delete next.roles[r]
    }
    next.roles[roleId] = { clientId, playerName, timestamp: now }
    if (next.members?.[clientId]) next.members[clientId].roleId = roleId
  } else if (action === 'release' || action === 'release_role') {
    if (roleId && next.roles[roleId] && (!clientId || next.roles[roleId]?.clientId === clientId)) {
      delete next.roles[roleId]
      if (clientId && next.members?.[clientId]) next.members[clientId].roleId = null
    } else if (clientId) {
      for (const r of ROLE_ORDER) {
        if (next.roles[r]?.clientId === clientId) delete next.roles[r]
      }
      if (next.members?.[clientId]) next.members[clientId].roleId = null
    }
  } else if (action === 'toggle_briefing_ready' && clientId && next.briefingReady) {
    const flag = typeof payload.ready === 'boolean' ? payload.ready : !next.briefingReady[clientId]
    if (flag) next.briefingReady[clientId] = true
    else delete next.briefingReady[clientId]
    const memberIds = Object.keys(next.members ?? {})
    if (memberIds.length >= 2 && memberIds.every((id) => Boolean(next.briefingReady?.[id]))) {
      next.phase = 'WORKSHOP'
      next.briefingDeadlineAt = null
      next.briefingReady = {}
    }
  } else if (action === 'set_phase') {
    const phase = payload.phase as RoomPhase
    if (phase === 'LOBBY' || phase === 'MISSION_BRIEFING' || phase === 'WORKSHOP' || phase === 'LAUNCH' || phase === 'STATION') {
      next.phase = phase
      next.briefingDeadlineAt = phase === 'MISSION_BRIEFING' ? now + 45_000 : null
      if (phase === 'WORKSHOP') next.briefingReady = {}
    }
  } else if (action === 'advance_next_mission') {
    const curIdx = next.currentMissionIndex ?? 1
    const nextIdx = Math.min(3, curIdx + 1) as 1 | 2 | 3
    const nextMission = missionIndexToIdLocal(nextIdx)
    const nextLauncher = defaultLauncherForStageLocal(nextIdx)
    next.currentMissionIndex = nextIdx
    next.missionId = nextMission
    next.launcherId = nextLauncher
    next.satellites.sat1.contractId = nextMission
    next.satellites.sat1.launcherId = nextLauncher
    next.satellites.sat2.contractId = nextMission
    next.satellites.sat2.launcherId = nextLauncher
    next.phase = (payload.targetPhase as RoomPhase) || 'MISSION_BRIEFING'
    next.briefingDeadlineAt = next.phase === 'MISSION_BRIEFING' ? now + 45_000 : null
    next.briefingReady = {}
  } else if (action === 'satellite_part') {
    const satId: SatelliteId = payload.satId === 'sat2' ? 'sat2' : 'sat1'
    const partId = typeof payload.partId === 'string' ? payload.partId.trim() : ''
    const delta = Number(payload.delta) || 0
    const maxCount = Math.max(1, Number(payload.maxCount) || 4)
    if (partId && delta !== 0) {
      const sat = next.satellites[satId]
      const cur = sat.parts[partId] ?? 0
      const q = Math.max(0, Math.min(maxCount, cur + delta))
      if (q === 0) delete sat.parts[partId]
      else sat.parts[partId] = q
      sat.updatedAt = now
      sat.updatedByName = playerName
      if (typeof payload.actionLabel === 'string') sat.lastActionLabel = payload.actionLabel
    }
  } else if (action === 'satellite_config') {
    const satId: SatelliteId = payload.satId === 'sat2' ? 'sat2' : 'sat1'
    const sat = next.satellites[satId]
    if (typeof payload.launcherId === 'string') sat.launcherId = payload.launcherId
    if (typeof payload.chassisId === 'string') sat.chassisId = payload.chassisId
    if (payload.parts && typeof payload.parts === 'object') {
      sat.parts = { ...(payload.parts as Record<string, number>) }
    }
    sat.updatedAt = now
    sat.updatedByName = playerName
    if (typeof payload.actionLabel === 'string') sat.lastActionLabel = payload.actionLabel
  }

  next.participants = rebuildParticipants(next.members ?? {})
  next.playerCount = next.participants.length
  next.claims = next.roles
  next.briefingReadyClients = Object.keys(next.briefingReady ?? {})
  next.updatedAt = now
  saveCachedRoomSnapshot(next)
  return { status: 200, ok: true, room: next }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? window.setTimeout(() => ctrl.abort(), timeoutMs) : undefined
  try {
    return await fetch(url, {
      ...init,
      ...(ctrl ? { signal: ctrl.signal } : {}),
    })
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

let pendingLeavePromise: Promise<unknown> | null = null

export async function listActiveRooms(): Promise<RoomSnapshot[]> {
  if (pendingLeavePromise) {
    await pendingLeavePromise.catch(() => undefined)
  }
  const merged = new Map<string, RoomSnapshot>()
  const now = Date.now()
  for (const room of Object.values(readStoredRoomsMap())) {
    if (room?.code && !isRoomMarkedClosed(room.code) && now - (room.updatedAt ?? 0) < 90_000) {
      merged.set(room.code, room)
    }
  }
  try {
    const res = await fetchWithTimeout('/api/rooms', { cache: 'no-store' })
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { rooms?: RoomSnapshot[] } | null
      if (data && Array.isArray(data.rooms)) {
        for (const r of data.rooms) {
          if (r?.code) {
            saveCachedRoomSnapshot(r, false)
            merged.set(r.code, r)
          }
        }
      }
    }
  } catch {
    // fallback silently to local/cached rooms
  }
  return Array.from(merged.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function fetchRoomByCode(code: string): Promise<RoomSnapshot | null> {
  const clean = normalizeRoomCode(code)
  if (!clean) return null
  const cached = getCachedRoomSnapshot(clean)

  try {
    const res = await fetchWithTimeout(`/api/rooms/${encodeURIComponent(clean)}`, {
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => null)) as {
      room?: RoomSnapshot
      deleted?: boolean
      explicitlyClosed?: boolean
    } | null

    if (res.ok && data?.room) {
      saveCachedRoomSnapshot(data.room, false)
      return data.room
    }

    if (data?.explicitlyClosed) {
      removeCachedRoomSnapshot(clean, true)
      return null
    }

    // Serverless cold start returned 404: re-hydrate automatically if client already has this room open
    if (res.status === 404 && cached) {
      const rehydrateRes = await fetchWithTimeout(
        `/api/rooms/${encodeURIComponent(clean)}/action`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'heartbeat',
            clientId: cached.hostClientId,
            playerName: cached.hostName,
            rehydrateRoom: cached,
          }),
        }
      ).catch(() => null)
      if (rehydrateRes?.ok) {
        const rd = (await rehydrateRes.json().catch(() => null)) as { room?: RoomSnapshot } | null
        if (rd?.room) {
          saveCachedRoomSnapshot(rd.room, false)
          return rd.room
        }
      }
      return cached
    }
  } catch {
    if (cached) return cached
  }

  return cached
}

export async function clearAllMultiplayerRooms(): Promise<void> {
  for (const code of Object.keys(readStoredRoomsMap())) {
    removeCachedRoomSnapshot(code, true)
  }
  memoryRoomsCache.clear()
  try {
    await fetchWithTimeout('/api/rooms/clear', { method: 'POST' })
  } catch {
    // local clear already succeeded
  }
}

export async function createMultiplayerRoom(
  clientId: string,
  playerName: string
): Promise<RoomSnapshot> {
  if (pendingLeavePromise) {
    await pendingLeavePromise.catch(() => undefined)
  }
  const cleanName = (playerName || '').trim().slice(0, 24) || 'Commander'

  try {
    const res = await fetchWithTimeout(
      '/api/rooms/create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, playerName: cleanName }),
      },
      REQUEST_TIMEOUT_MS
    )
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { room?: RoomSnapshot } | null
      if (data?.room?.code) {
        saveCachedRoomSnapshot(data.room)
        return data.room
      }
    }
  } catch {
    // Fallback immediately to local client room creation on timeout/network/404/500
  }

  const localRoom = buildLocalRoomSnapshot(generateLocalRoomCode(), clientId, cleanName)
  saveCachedRoomSnapshot(localRoom)
  return localRoom
}

export async function postRoomAction(
  roomCode: string,
  payload: Record<string, unknown>
): Promise<{
  status: number
  ok: boolean
  deleted?: boolean
  explicitlyClosed?: boolean
  code?: string
  error?: string
  ownerName?: string
  ownedRole?: string
  room?: RoomSnapshot
}> {
  const clean = normalizeRoomCode(roomCode)
  const cached = clean ? getCachedRoomSnapshot(clean) : null
  const action = typeof payload.action === 'string' ? payload.action.trim() : ''

  try {
    let res = await fetchWithTimeout(`/api/rooms/${encodeURIComponent(clean)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    let data = (await res.json().catch(() => null)) as {
      ok?: boolean
      deleted?: boolean
      explicitlyClosed?: boolean
      code?: string
      error?: string
      ownerName?: string
      ownedRole?: string
      room?: RoomSnapshot
    } | null

    // Automatic cold-start re-hydration if server lost memory between invocations
    if (
      res.status === 404 &&
      !data?.explicitlyClosed &&
      cached &&
      action !== 'close_room' &&
      action !== 'leave' &&
      action !== 'leave_room'
    ) {
      const retryRes = await fetchWithTimeout(`/api/rooms/${encodeURIComponent(clean)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, rehydrateRoom: cached }),
      }).catch(() => null)
      if (retryRes) {
        res = retryRes
        data = (await retryRes.json().catch(() => null)) as typeof data
      }
    }

    if (res.ok && data) {
      if (data.deleted) {
        removeCachedRoomSnapshot(clean, Boolean(data.explicitlyClosed))
      } else if (data.room) {
        saveCachedRoomSnapshot(data.room)
      }
      return {
        status: res.status,
        ok: data.ok !== false,
        deleted: data.deleted,
        explicitlyClosed: data.explicitlyClosed,
        code: data.code,
        error: data.error,
        ownerName: data.ownerName,
        ownedRole: data.ownedRole,
        room: data.room,
      }
    }

    // Genuine game-rule rejections (locked role, room full, sequential mission guard) pass through
    if (res.status === 409 || res.status === 403 || (res.status === 400 && data?.code === 'ROOM_FULL')) {
      if (data?.room) saveCachedRoomSnapshot(data.room, false)
      return {
        status: res.status,
        ok: false,
        deleted: data?.deleted,
        code: data?.code,
        error: data?.error,
        ownerName: data?.ownerName,
        ownedRole: data?.ownedRole,
        room: data?.room,
      }
    }

    if (data?.explicitlyClosed) {
      removeCachedRoomSnapshot(clean, true)
      return {
        status: 404,
        ok: false,
        deleted: true,
        explicitlyClosed: true,
        error: data.error,
      }
    }
  } catch {
    // Fall back seamlessly to local state mutation below
  }

  if (cached) {
    return applyRoomActionLocally(cached, payload)
  }

  return {
    status: 404,
    ok: false,
    deleted: false,
    error: 'ROOM_NOT_FOUND',
  }
}

export async function postRolesSyncWithRehydrate(
  roomCode: string | null,
  payload: Record<string, unknown>
): Promise<{
  status: number
  ok: boolean
  deleted?: boolean
  explicitlyClosed?: boolean
  code?: string
  error?: string
  ownerName?: string
  claims?: RoleClaimsMap
  room?: RoomSnapshot
}> {
  const clean = roomCode ? normalizeRoomCode(roomCode) : ''
  const cached = clean ? getCachedRoomSnapshot(clean) : null
  const action = typeof payload.action === 'string' ? payload.action.trim() : ''

  try {
    let res = await fetchWithTimeout('/api/roles-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    let data = (await res.json().catch(() => null)) as {
      ok?: boolean
      deleted?: boolean
      explicitlyClosed?: boolean
      code?: string
      error?: string
      ownerName?: string
      claims?: RoleClaimsMap
      room?: RoomSnapshot
    } | null

    if (
      res.status === 404 &&
      clean &&
      cached &&
      !data?.explicitlyClosed &&
      action !== 'close_room' &&
      action !== 'leave' &&
      action !== 'leave_room'
    ) {
      const retryRes = await fetchWithTimeout('/api/roles-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, rehydrateRoom: cached }),
      }).catch(() => null)
      if (retryRes) {
        res = retryRes
        data = (await retryRes.json().catch(() => null)) as typeof data
      }
    }

    if (res.ok && data) {
      if (data.room) saveCachedRoomSnapshot(data.room)
      return {
        status: res.status,
        ok: data.ok !== false,
        deleted: data.deleted,
        explicitlyClosed: data.explicitlyClosed,
        code: data.code,
        error: data.error,
        ownerName: data.ownerName,
        claims: data.claims,
        room: data.room,
      }
    }

    if (data?.explicitlyClosed && clean) {
      removeCachedRoomSnapshot(clean, true)
      return {
        status: res.status,
        ok: false,
        deleted: true,
        explicitlyClosed: true,
        error: data.error,
      }
    }

    if (res.status === 409 || (res.status === 400 && data?.code === 'ROOM_FULL')) {
      return {
        status: res.status,
        ok: false,
        code: data?.code,
        error: data?.error,
        ownerName: data?.ownerName,
        claims: data?.claims,
        room: data?.room,
      }
    }
  } catch {
    // Fallback cleanly to local snapshot if network unavailable
  }

  if (cached) {
    const localRes = applyRoomActionLocally(cached, payload)
    return {
      status: localRes.status,
      ok: localRes.ok,
      deleted: localRes.deleted,
      explicitlyClosed: localRes.explicitlyClosed,
      code: localRes.code,
      error: localRes.error,
      ownerName: localRes.ownerName,
      claims: localRes.room?.roles ?? cached.roles,
      room: localRes.room,
    }
  }

  return { status: 503, ok: false, error: 'NETWORK_UNAVAILABLE' }
}

export async function postStationSyncWithRehydrate(
  roomCode: string | null,
  body: Record<string, unknown>
): Promise<{
  status: number
  ok: boolean
  deleted?: boolean
  explicitlyClosed?: boolean
  data: Record<string, unknown> | null
}> {
  const clean = roomCode ? normalizeRoomCode(roomCode) : ''
  const cached = clean ? getCachedRoomSnapshot(clean) : null

  try {
    let res = await fetchWithTimeout('/api/station-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let data = (await res.json().catch(() => null)) as Record<string, unknown> | null

    if (res.status === 404 && clean && cached && !data?.explicitlyClosed) {
      const retryRes = await fetchWithTimeout('/api/station-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, rehydrateRoom: cached }),
      }).catch(() => null)
      if (retryRes) {
        res = retryRes
        data = (await retryRes.json().catch(() => null)) as Record<string, unknown> | null
      }
    }

    if (res.ok && data) {
      const serverRoom = data.room as RoomSnapshot | undefined
      if (serverRoom?.code) {
        saveCachedRoomSnapshot(serverRoom, false)
      }
      return {
        status: res.status,
        ok: true,
        deleted: Boolean(data.deleted),
        explicitlyClosed: Boolean(data.explicitlyClosed),
        data,
      }
    }

    if (data?.explicitlyClosed && clean) {
      removeCachedRoomSnapshot(clean, true)
      return {
        status: res.status,
        ok: false,
        deleted: true,
        explicitlyClosed: true,
        data,
      }
    }

    return {
      status: res.status,
      ok: false,
      deleted: false,
      explicitlyClosed: false,
      data,
    }
  } catch {
    return {
      status: 503,
      ok: false,
      deleted: false,
      explicitlyClosed: false,
      data: null,
    }
  }
}

export async function joinMultiplayerRoom(
  roomCode: string,
  clientId: string,
  playerName: string
) {
  return postRoomAction(roomCode, {
    action: 'join',
    clientId,
    playerName,
  })
}

export async function sendRoomHeartbeat(
  roomCode: string,
  clientId: string,
  playerName: string
) {
  return postRoomAction(roomCode, {
    action: 'heartbeat',
    clientId,
    playerName,
  })
}

export async function leaveMultiplayerRoom(
  roomCode: string,
  clientId: string,
  playerName?: string
): Promise<void> {
  const clean = normalizeRoomCode(roomCode)
  if (!clean || !clientId) return
  const req = postRoomAction(clean, {
    action: 'leave',
    clientId,
    playerName,
  }).catch(() => undefined)
  pendingLeavePromise = req
  try {
    await req
  } finally {
    if (pendingLeavePromise === req) pendingLeavePromise = null
  }
}

export function sendLeaveBeacon(
  roomCode: string,
  clientId: string,
  playerName?: string
): void {
  const clean = normalizeRoomCode(roomCode)
  if (!clean || !clientId) return
  const url = `/api/rooms/${encodeURIComponent(clean)}/action`
  const payload = JSON.stringify({
    action: 'leave',
    clientId,
    playerName,
  })
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' })
      if (navigator.sendBeacon(url, blob)) return
    }
  } catch {
    // fallback keepalive
  }
  try {
    if (typeof fetch === 'function') {
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      })
    }
  } catch {
    // ignore errors on tab close
  }
}

export function findMyRoleInRoom(
  room: RoomSnapshot | null | undefined,
  clientId: string
): RoleId | null {
  if (!room?.roles) return null
  for (const [role, entry] of Object.entries(room.roles)) {
    if (entry?.clientId === clientId) return role as RoleId
  }
  return null
}

export async function selectRoomMission(
  roomCode: string,
  clientId: string,
  playerName: string,
  missionId: MissionId,
  launcherId?: LauncherId
) {
  return postRoomAction(roomCode, {
    action: 'select_mission',
    clientId,
    playerName,
    missionId,
    ...(launcherId ? { launcherId } : {}),
  })
}

export async function toggleRoomBriefingReady(
  roomCode: string,
  clientId: string,
  playerName: string,
  ready?: boolean
) {
  return postRoomAction(roomCode, {
    action: 'toggle_briefing_ready',
    clientId,
    playerName,
    ...(typeof ready === 'boolean' ? { ready } : {}),
  })
}

export async function advanceRoomNextMission(
  roomCode: string,
  clientId: string,
  playerName: string,
  missionId: MissionId,
  options?: { launcherId?: LauncherId; targetPhase?: RoomPhase; keepPoints?: number }
) {
  return postRoomAction(roomCode, {
    action: 'advance_next_mission',
    clientId,
    playerName,
    missionId,
    ...(options?.launcherId ? { launcherId: options.launcherId } : {}),
    ...(options?.targetPhase ? { targetPhase: options.targetPhase } : {}),
    ...(typeof options?.keepPoints === 'number' ? { keepPoints: options.keepPoints } : {}),
  })
}

// Clean convenience aliases
export const createRoom = createMultiplayerRoom
export const joinRoom = joinMultiplayerRoom
export const performRoomAction = postRoomAction
export const fetchRoomState = fetchRoomByCode
export const syncStation = postStationSyncWithRehydrate
