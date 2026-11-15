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
    subtitle: 'Observación Andina y Enlace Telecom',
    icon: '🛰️',
    defaultContract: 'andes',
    defaultLauncher: 'rideshare',
    defaultChassis: '6U',
  },
  sat2: {
    id: 'sat2',
    code: 'SAT-02 INTI-SCIENCE',
    subtitle: 'Exploración Científica Secundaria',
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
    badge: 'Órbitas, Contratos, Cohete y Despegue',
    shortDuty: 'Validación de Órbita y Lanzamiento',
    stationTasks: 'Acoplamiento APAS · Defensa Cometa',
  },
  engineer: {
    badge: 'Paneles Solares, Baterías, ADCS, Blindaje y Motor',
    shortDuty: 'Energía y Estructura del CubeSat',
    stationTasks: 'Distribución EPS · Soporte Vital O2',
  },
  science: {
    badge: 'Cámaras, Espectrómetros y Carga Útil NASA',
    shortDuty: 'Carga Útil Científica',
    stationTasks: 'Sonda Planetaria · Órbita SAT-02',
  },
  comms: {
    badge: 'Antenas UHF, Banda S/X y Enlace DSN',
    shortDuty: 'Antenas y Telecomunicaciones',
    stationTasks: 'Telecom DSN · Ciberdefensa 8080',
  },
}

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
    // ignorar errores de almacenamiento
  }
  return `PILOTO-${clientId.slice(-4).toUpperCase()}`
}

export function savePlayerName(name: string): void {
  try {
    window.localStorage.setItem('squadron_player_name_v1', name)
  } catch {
    // ignorar errores de almacenamiento
  }
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16)
}

let pendingLeavePromise: Promise<unknown> | null = null

export async function listActiveRooms(): Promise<RoomSnapshot[]> {
  if (pendingLeavePromise) {
    await pendingLeavePromise.catch(() => undefined)
  }
  const res = await fetch('/api/rooms', { cache: 'no-store' })
  if (!res.ok) throw new Error('ROOMS_LIST_ERROR')
  const data = (await res.json()) as { rooms?: RoomSnapshot[] }
  return Array.isArray(data.rooms) ? data.rooms : []
}

export async function fetchRoomByCode(code: string): Promise<RoomSnapshot | null> {
  const clean = normalizeRoomCode(code)
  if (!clean) return null
  const res = await fetch(`/api/rooms/${encodeURIComponent(clean)}`, { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('ROOM_FETCH_ERROR')
  const data = (await res.json()) as { room?: RoomSnapshot }
  return data.room ?? null
}

export async function clearAllMultiplayerRooms(): Promise<void> {
  const res = await fetch('/api/rooms/clear', { method: 'POST' })
  if (!res.ok) throw new Error('ROOMS_CLEAR_ERROR')
}

export async function createMultiplayerRoom(
  clientId: string,
  playerName: string
): Promise<RoomSnapshot> {
  if (pendingLeavePromise) {
    await pendingLeavePromise.catch(() => undefined)
  }
  const res = await fetch('/api/rooms/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, playerName }),
  })
  if (!res.ok) throw new Error('ROOM_CREATE_ERROR')
  const data = (await res.json()) as { room?: RoomSnapshot }
  if (!data.room) throw new Error('ROOM_EMPTY')
  return data.room
}

export async function postRoomAction(
  roomCode: string,
  payload: Record<string, unknown>
): Promise<{
  status: number
  ok: boolean
  deleted?: boolean
  code?: string
  error?: string
  ownerName?: string
  ownedRole?: string
  room?: RoomSnapshot
}> {
  const clean = normalizeRoomCode(roomCode)
  const res = await fetch(`/api/rooms/${encodeURIComponent(clean)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    deleted?: boolean
    code?: string
    error?: string
    ownerName?: string
    ownedRole?: string
    room?: RoomSnapshot
  }
  return {
    status: res.status,
    ok: res.ok && data.ok !== false,
    deleted: data.deleted,
    code: data.code,
    error: data.error,
    ownerName: data.ownerName,
    ownedRole: data.ownedRole,
    room: data.room,
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
    // ignorar errores al cerrar pestaña
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
