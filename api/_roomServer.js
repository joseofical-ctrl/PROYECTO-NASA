// Shared multiplayer & station-sync room engine for both Vite dev middleware and Vercel Serverless (/api/index.js).
// Uses standard ESM JavaScript with zero third-party dependencies.

const MAX_ROOM_MEMBERS = 4
const HEARTBEAT_TIMEOUT_MS = 8_000
const CLAIM_TTL_MS = 8_000
const PLAYER_TTL_MS = 8_000
const SELECTION_TIMEOUT_MS = 15_000
const BRIEFING_TIMEOUT_MS = 45_000
const CLOSED_ROOM_TTL_MS = 60_000
export const CLEANUP_INTERVAL_MS = 2_000
const DEFAULT_ROOM_CODE = 'DEFAULT'
const ALL_ROLE_IDS = ['director', 'engineer', 'science', 'comms']
const VALID_ROLE_IDS = new Set(ALL_ROLE_IDS)

const CODE_PREFIXES = ['AGUILA', 'ANDES', 'INTI', 'AMARU', 'CONDOR', 'CUSCO', 'QUIPU', 'CHASQUI']

const createEmptySharedStation = (keepPoints = 0, keepRetryEpoch = 0) => ({
  completedMinigames: [],
  resolvedCount: 0,
  roleResolvedCounts: { director: 0, engineer: 0, science: 0, comms: 0 },
  consoleCooldowns: {},
  attemptCounts: {},
  recentNonces: [],
  activeThreats: [],
  stats: {},
  stationHealth: 100,
  isGameOver: false,
  gameOverReason: '',
  retryEpoch: keepRetryEpoch,
  points: Math.max(0, Math.round(keepPoints)),
  lastUpdated: 0,
})

function sanitizeMissionId(raw) {
  if (raw === 'luna' || raw === 'sol' || raw === 'andes') return raw
  return 'andes'
}

function sanitizeLauncherId(raw) {
  if (raw === 'rideshare' || raw === 'light' || raw === 'heavy') return raw
  return 'rideshare'
}

function missionIndexToId(idx) {
  if (idx === 2) return 'luna'
  if (idx === 3) return 'sol'
  return 'andes'
}

function missionIdToIndex(id) {
  if (id === 'luna') return 2
  if (id === 'sol') return 3
  return 1
}

function defaultLauncherForStage(idx) {
  if (idx === 2) return 'light'
  if (idx === 3) return 'heavy'
  return 'rideshare'
}

function resolveCompatibleLauncher(missionId, launcherId) {
  if (missionId === 'sol') return 'heavy'
  if (missionId === 'luna') {
    return launcherId === 'heavy' ? 'heavy' : 'light'
  }
  return launcherId
}

function sanitizeDir(dir) {
  if (dir === 'up' || dir === 'down' || dir === 'left' || dir === 'right') {
    return dir
  }
  return 'down'
}

function sanitizeRoomCode(raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16)
}

function sanitizePhase(phase) {
  if (
    phase === 'LOBBY' ||
    phase === 'MISSION_BRIEFING' ||
    phase === 'WORKSHOP' ||
    phase === 'LAUNCH' ||
    phase === 'STATION'
  ) {
    return phase
  }
  return null
}

function readJsonBody(req, onDone) {
  if (req && req.body !== undefined && req.body !== null) {
    try {
      if (typeof req.body === 'string') {
        onDone(null, req.body ? JSON.parse(req.body) : {})
        return
      }
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(req.body)) {
        const txt = req.body.toString('utf8')
        onDone(null, txt ? JSON.parse(txt) : {})
        return
      }
      if (typeof req.body === 'object') {
        onDone(null, req.body)
        return
      }
    } catch {
      onDone(new Error('INVALID_JSON'), null)
      return
    }
  }

  if (req && req.readableEnded) {
    onDone(null, {})
    return
  }

  let finished = false
  let rawBody = ''
  const done = (err, parsed) => {
    if (finished) return
    finished = true
    onDone(err, parsed)
  }

  try {
    req.setEncoding?.('utf8')
    req.on('data', (chunk) => {
      rawBody += typeof chunk === 'string' ? chunk : String(chunk)
    })
    req.on('end', () => {
      try {
        const parsed = rawBody ? JSON.parse(rawBody) : {}
        done(null, parsed)
      } catch {
        done(new Error('INVALID_JSON'), null)
      }
    })
    req.on('error', () => {
      done(new Error('INVALID_JSON'), null)
    })
  } catch {
    done(new Error('INVALID_JSON'), null)
  }
}

function createInitialSatellites(now) {
  return {
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
  }
}

function createEmptyRoom(code, hostClientId, hostName, now = Date.now()) {
  const members = {}
  if (hostClientId) {
    members[hostClientId] = {
      clientId: hostClientId,
      pilotName: hostName,
      roleId: null,
      isHost: true,
      lastSeen: now,
    }
  }
  return {
    code,
    hostClientId,
    hostName,
    phase: 'LOBBY',
    currentMissionIndex: 1,
    missionId: 'andes',
    launcherId: 'rideshare',
    createdAt: now,
    updatedAt: now,
    selectionDeadlineAt: null,
    briefingDeadlineAt: null,
    briefingReady: {},
    members,
    roles: {},
    players: {},
    satellites: createInitialSatellites(now),
    sharedStation: createEmptySharedStation(),
  }
}

function parseQueryParams(url) {
  const qIdx = url.indexOf('?')
  if (qIdx === -1) return {}
  const out = {}
  const sp = new URLSearchParams(url.slice(qIdx + 1))
  sp.forEach((v, k) => {
    out[k] = v
  })
  return out
}

export function createRoomEngine(options = {}) {
  const enableSse = options.enableSse !== false
  const rooms = new Map()
  const closedRooms = new Map()
  const subscribers = new Set()

  const pruneClosedTombstones = (now = Date.now()) => {
    for (const [code, exp] of closedRooms.entries()) {
      if (now >= exp) closedRooms.delete(code)
    }
  }

  const markRoomClosed = (code, now = Date.now()) => {
    if (code && code !== DEFAULT_ROOM_CODE) {
      closedRooms.set(code, now + CLOSED_ROOM_TTL_MS)
    }
  }

  const getOrCreateDefaultRoom = (hostClientId = '', hostName = 'Host', now = Date.now()) => {
    let existing = rooms.get(DEFAULT_ROOM_CODE)
    if (!existing) {
      existing = createEmptyRoom(DEFAULT_ROOM_CODE, hostClientId, hostName, now)
      rooms.set(DEFAULT_ROOM_CODE, existing)
    }
    return existing
  }

  const generateRoomCode = () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const prefix = CODE_PREFIXES[Math.floor(Math.random() * CODE_PREFIXES.length)]
      const num = String(Math.floor(1 + Math.random() * 98)).padStart(2, '0')
      const candidate = `${prefix}-${num}`
      if (!rooms.has(candidate)) return candidate
    }
    return `AGUILA-${Math.floor(100 + Math.random() * 899)}`
  }

  const findRoleForClient = (room, clientId) => {
    for (const [roleId, entry] of Object.entries(room.roles)) {
      if (entry.clientId === clientId) return roleId
    }
    return null
  }

  const removePlayersByClient = (room, clientId, exceptRoleId) => {
    for (const [key, entry] of Object.entries(room.players)) {
      if (key !== exceptRoleId && entry.clientId === clientId) {
        delete room.players[key]
      }
    }
  }

  const syncMembersMetadata = (room) => {
    const roleByClient = new Map()
    for (const [roleId, entry] of Object.entries(room.roles)) {
      if (room.members[entry.clientId]) {
        roleByClient.set(entry.clientId, roleId)
      }
    }
    for (const member of Object.values(room.members)) {
      member.roleId = roleByClient.get(member.clientId) ?? null
      member.isHost = member.clientId === room.hostClientId
    }
  }

  const syncLobbySelectionTimer = (room, now = Date.now()) => {
    const memberList = Object.values(room.members)
    const claimedClients = new Set(Object.values(room.roles).map((e) => e.clientId))
    const allMembersClaimed =
      memberList.length > 0 && memberList.every((m) => claimedClients.has(m.clientId))
    const allRolesFilled = ALL_ROLE_IDS.every((r) => Boolean(room.roles[r]))

    if (
      room.phase !== 'LOBBY' ||
      memberList.length < MAX_ROOM_MEMBERS ||
      allMembersClaimed ||
      allRolesFilled
    ) {
      room.selectionDeadlineAt = null
      return
    }
    if (room.selectionDeadlineAt === null) {
      room.selectionDeadlineAt = now + SELECTION_TIMEOUT_MS
    }
  }

  const autoAssignRemainingRoles = (room, now = Date.now()) => {
    if (room.phase !== 'LOBBY') {
      room.selectionDeadlineAt = null
      return false
    }
    if (Object.keys(room.members).length < MAX_ROOM_MEMBERS) {
      room.selectionDeadlineAt = null
      return false
    }
    if (room.selectionDeadlineAt === null || now < room.selectionDeadlineAt) {
      return false
    }
    const freeRoles = ALL_ROLE_IDS.filter((r) => !room.roles[r])
    if (freeRoles.length === 0) {
      room.selectionDeadlineAt = null
      return false
    }

    const claimedClients = new Set(Object.values(room.roles).map((e) => e.clientId))
    let assigned = false
    for (const member of Object.values(room.members)) {
      if (claimedClients.has(member.clientId) || freeRoles.length === 0) continue
      const pickIdx = Math.floor(Math.random() * freeRoles.length)
      const [chosenRole] = freeRoles.splice(pickIdx, 1)
      room.roles[chosenRole] = {
        clientId: member.clientId,
        playerName: member.pilotName,
        timestamp: now,
      }
      member.roleId = chosenRole
      claimedClients.add(member.clientId)
      assigned = true
    }
    if (assigned) {
      room.updatedAt = now
    }
    syncLobbySelectionTimer(room, now)
    return assigned
  }

  const applyMissionToRoomSatellites = (
    room,
    missionId,
    launcherId,
    now = Date.now(),
    actorName = 'Mission'
  ) => {
    const validLauncher = resolveCompatibleLauncher(missionId, launcherId)
    room.missionId = missionId
    room.launcherId = validLauncher
    room.satellites.sat1.contractId = missionId
    room.satellites.sat1.launcherId = validLauncher
    room.satellites.sat1.updatedAt = now
    room.satellites.sat1.updatedByName = actorName
    room.satellites.sat1.lastActionLabel = `Mission ${missionId.toUpperCase()} (${validLauncher})`

    room.satellites.sat2.contractId = missionId
    room.satellites.sat2.launcherId = validLauncher
    room.satellites.sat2.updatedAt = now
    room.satellites.sat2.updatedByName = actorName
    room.satellites.sat2.lastActionLabel = `Mission ${missionId.toUpperCase()} (${validLauncher})`
  }

  const syncBriefingTimerAndAdvance = (room, now = Date.now()) => {
    if (room.phase !== 'MISSION_BRIEFING') {
      room.briefingDeadlineAt = null
      return false
    }
    if (room.briefingDeadlineAt === null) {
      room.briefingDeadlineAt = now + BRIEFING_TIMEOUT_MS
    }
    const memberList = Object.values(room.members)
    const allReadyMulti =
      memberList.length >= 2 && memberList.every((m) => Boolean(room.briefingReady[m.clientId]))
    const expired = now >= room.briefingDeadlineAt

    if (!expired && !allReadyMulti) {
      return false
    }

    room.phase = 'WORKSHOP'
    room.briefingDeadlineAt = null
    room.briefingReady = {}
    applyMissionToRoomSatellites(room, room.missionId, room.launcherId, now, room.hostName || 'System')
    room.sharedStation = createEmptySharedStation(room.currentMissionIndex > 1 ? room.sharedStation.points : 0)
    room.updatedAt = now
    return true
  }

  const purgeStaleMembers = (room, now = Date.now()) => {
    let rolesChanged = false

    for (const [cid, member] of Object.entries(room.members)) {
      if (now - member.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        delete room.members[cid]
        for (const [roleId, entry] of Object.entries(room.roles)) {
          if (entry.clientId === cid) {
            delete room.roles[roleId]
            rolesChanged = true
          }
        }
        removePlayersByClient(room, cid)
      }
    }

    for (const [roleId, entry] of Object.entries(room.roles)) {
      if (!room.members[entry.clientId] || now - entry.timestamp > CLAIM_TTL_MS) {
        delete room.roles[roleId]
        if (room.players[roleId]?.clientId === entry.clientId) {
          delete room.players[roleId]
        }
        rolesChanged = true
      }
    }

    for (const [roleId, entry] of Object.entries(room.players)) {
      if (!room.members[entry.clientId] || now - entry.lastSeen > PLAYER_TTL_MS) {
        delete room.players[roleId]
      }
    }

    if (room.hostClientId && !room.members[room.hostClientId]) {
      const nextHost = Object.values(room.members)[0]
      if (nextHost) {
        room.hostClientId = nextHost.clientId
        room.hostName = nextHost.pilotName
      } else {
        room.hostClientId = ''
      }
    }

    syncMembersMetadata(room)
    if (autoAssignRemainingRoles(room, now)) {
      rolesChanged = true
      syncMembersMetadata(room)
    }
    for (const cid of Object.keys(room.briefingReady)) {
      if (!room.members[cid]) delete room.briefingReady[cid]
    }
    syncLobbySelectionTimer(room, now)
    if (syncBriefingTimerAndAdvance(room, now)) {
      rolesChanged = true
    }
    return rolesChanged
  }

  const serializeRoom = (room) => {
    const now = Date.now()
    const membersMap = {}
    for (const [cid, m] of Object.entries(room.members)) {
      membersMap[cid] = { ...m }
    }
    const memberValues = Object.values(membersMap)
    const connectedCount = memberValues.length
    const selectionActive =
      room.phase === 'LOBBY' && connectedCount >= MAX_ROOM_MEMBERS && room.selectionDeadlineAt !== null
    const selectionRemainingSec = selectionActive
      ? Math.max(0, Math.ceil((room.selectionDeadlineAt - now) / 1000))
      : null
    const briefingActive = room.phase === 'MISSION_BRIEFING' && room.briefingDeadlineAt !== null
    const briefingRemainingSec = briefingActive
      ? Math.max(0, Math.ceil((room.briefingDeadlineAt - now) / 1000))
      : null
    const cleanReady = {}
    for (const cid of Object.keys(room.briefingReady)) {
      if (room.briefingReady[cid] && membersMap[cid]) cleanReady[cid] = true
    }
    return {
      code: room.code,
      hostClientId: room.hostClientId,
      hostName: room.hostName,
      phase: room.phase,
      currentMissionIndex: room.currentMissionIndex,
      missionId: room.missionId,
      launcherId: room.launcherId,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      selectionDeadlineAt: selectionActive ? room.selectionDeadlineAt : null,
      selectionRemainingSec,
      briefingDeadlineAt: briefingActive ? room.briefingDeadlineAt : null,
      briefingRemainingSec,
      briefingReady: cleanReady,
      briefingReadyClients: Object.keys(cleanReady),
      playerCount: connectedCount,
      members: membersMap,
      participants: memberValues.map((m) => ({
        clientId: m.clientId,
        playerName: m.pilotName,
        roleId: m.roleId,
        isHost: m.isHost,
        lastSeen: m.lastSeen,
      })),
      roles: room.roles,
      claims: room.roles,
      players: room.players,
      satellites: room.satellites,
      sharedStation: room.sharedStation,
    }
  }

  const broadcastRoomDeleted = (roomCode, explicitlyClosed = true) => {
    const payload = `data: ${JSON.stringify({
      roomCode,
      deleted: true,
      explicitlyClosed,
      claims: {},
      room: null,
      serverTime: Date.now(),
    })}\n\n`
    for (const sub of Array.from(subscribers)) {
      if (sub.roomCode !== roomCode) continue
      try {
        sub.res.write(payload)
      } catch {
        subscribers.delete(sub)
      }
    }
  }

  const broadcastRoomRoles = (room) => {
    const payload = `data: ${JSON.stringify({
      roomCode: room.code,
      claims: room.roles,
      room: serializeRoom(room),
      serverTime: Date.now(),
    })}\n\n`
    for (const sub of Array.from(subscribers)) {
      if (sub.roomCode !== room.code) continue
      try {
        sub.res.write(payload)
      } catch {
        subscribers.delete(sub)
      }
    }
  }

  const cleanupRooms = (now = Date.now()) => {
    pruneClosedTombstones(now)
    for (const [code, room] of Array.from(rooms.entries())) {
      const rolesChanged = purgeStaleMembers(room, now)
      const activeCount = Object.keys(room.members).length
      if (code !== DEFAULT_ROOM_CODE && activeCount === 0) {
        broadcastRoomDeleted(code, false)
        rooms.delete(code)
      } else if (rolesChanged) {
        broadcastRoomRoles(room)
      }
    }
  }

  const removeClientFromRoom = (room, clientId, now = Date.now(), reason = 'leave') => {
    if (!clientId) return { deleted: false, changed: false }
    const wasHost = room.hostClientId === clientId
    const wasMember = Boolean(room.members[clientId])
    delete room.members[clientId]
    delete room.briefingReady[clientId]

    let rolesChanged = false
    for (const [roleId, entry] of Object.entries(room.roles)) {
      if (entry.clientId === clientId) {
        delete room.roles[roleId]
        rolesChanged = true
      }
    }
    removePlayersByClient(room, clientId)

    for (const [roleId, entry] of Object.entries(room.roles)) {
      if (!room.members[entry.clientId]) {
        delete room.roles[roleId]
        rolesChanged = true
      }
    }

    const remainingMembers = Object.values(room.members)
    if (
      room.code !== DEFAULT_ROOM_CODE &&
      ((wasHost && (room.phase === 'LOBBY' || reason === 'switch')) ||
        remainingMembers.length === 0)
    ) {
      if (wasHost && room.phase === 'LOBBY') {
        markRoomClosed(room.code, now)
      }
      broadcastRoomDeleted(room.code, wasHost && room.phase === 'LOBBY')
      rooms.delete(room.code)
      return { deleted: true, changed: true, explicitlyClosed: wasHost && room.phase === 'LOBBY' }
    }

    if (wasHost && remainingMembers.length > 0) {
      room.hostClientId = remainingMembers[0].clientId
      room.hostName = remainingMembers[0].pilotName
    }

    purgeStaleMembers(room, now)
    room.updatedAt = now
    return { deleted: false, changed: wasMember || wasHost || rolesChanged }
  }

  const removeClientFromOtherRooms = (clientId, keepRoomCode, reason, now = Date.now()) => {
    if (!clientId) return
    for (const [code, existingRoom] of Array.from(rooms.entries())) {
      if (keepRoomCode && code === keepRoomCode) continue
      const hasRole = Object.values(existingRoom.roles).some((e) => e.clientId === clientId)
      const hasPlayer = Object.values(existingRoom.players).some((p) => p.clientId === clientId)
      if (
        existingRoom.members[clientId] ||
        existingRoom.hostClientId === clientId ||
        hasRole ||
        hasPlayer
      ) {
        const res = removeClientFromRoom(existingRoom, clientId, now, reason)
        if (!res.deleted && res.changed) {
          broadcastRoomRoles(existingRoom)
        }
      }
    }
  }

  const upsertRoomMember = (room, clientId, pilotName, now = Date.now()) => {
    purgeStaleMembers(room, now)
    const existing = room.members[clientId]
    if (existing) {
      existing.lastSeen = now
      if (pilotName) existing.pilotName = pilotName
      if (!room.hostClientId) {
        room.hostClientId = clientId
        room.hostName = existing.pilotName
      } else if (room.hostClientId === clientId && pilotName) {
        room.hostName = existing.pilotName
      }
      existing.isHost = room.hostClientId === clientId
      existing.roleId = findRoleForClient(room, clientId)
      return { ok: true, isNew: false, member: existing }
    }

    if (Object.keys(room.members).length >= MAX_ROOM_MEMBERS) {
      return { ok: false, error: 'Room is full (4/4 players)' }
    }

    if (!room.hostClientId) {
      room.hostClientId = clientId
      room.hostName = pilotName
    }
    const createdMember = {
      clientId,
      pilotName,
      roleId: findRoleForClient(room, clientId),
      isHost: room.hostClientId === clientId,
      lastSeen: now,
    }
    room.members[clientId] = createdMember
    return { ok: true, isNew: true, member: createdMember }
  }

  // Reconstruct a missing room seamlessly on Vercel cold start from the client's open snapshot
  const rehydrateRoomIfMissing = (code, parsed, now = Date.now()) => {
    if (!code || code === DEFAULT_ROOM_CODE) return null
    if (closedRooms.has(code)) return null
    const snap = parsed?.rehydrateRoom
    if (!snap || typeof snap !== 'object') return null

    const fallbackCid =
      typeof parsed?.clientId === 'string' && parsed.clientId.trim() ? parsed.clientId.trim() : ''
    const fallbackName =
      typeof parsed?.playerName === 'string' && parsed.playerName.trim()
        ? parsed.playerName.trim().slice(0, 24)
        : 'Commander'
    const hostClientId =
      typeof snap.hostClientId === 'string' && snap.hostClientId.trim()
        ? snap.hostClientId.trim()
        : fallbackCid
    const hostName =
      typeof snap.hostName === 'string' && snap.hostName.trim()
        ? snap.hostName.trim().slice(0, 24)
        : fallbackName

    const room = createEmptyRoom(code, hostClientId, hostName, now)
    const phase = sanitizePhase(snap.phase)
    if (phase) room.phase = phase
    const mId = sanitizeMissionId(snap.missionId)
    room.missionId = mId
    room.currentMissionIndex =
      snap.currentMissionIndex === 2 || snap.currentMissionIndex === 3 || snap.currentMissionIndex === 1
        ? snap.currentMissionIndex
        : missionIdToIndex(mId)
    room.launcherId = resolveCompatibleLauncher(
      mId,
      sanitizeLauncherId(snap.launcherId ?? defaultLauncherForStage(room.currentMissionIndex))
    )

    if (snap.members && typeof snap.members === 'object') {
      for (const [cid, m] of Object.entries(snap.members)) {
        if (!cid || !m || typeof m !== 'object') continue
        room.members[cid] = {
          clientId: cid,
          pilotName:
            typeof m.pilotName === 'string' && m.pilotName.trim()
              ? m.pilotName.trim().slice(0, 24)
              : fallbackName,
          roleId: typeof m.roleId === 'string' && VALID_ROLE_IDS.has(m.roleId) ? m.roleId : null,
          isHost: Boolean(m.isHost) || cid === hostClientId,
          lastSeen: now,
        }
      }
    }
    if (fallbackCid && !room.members[fallbackCid]) {
      room.members[fallbackCid] = {
        clientId: fallbackCid,
        pilotName: fallbackName,
        roleId: null,
        isHost: !room.hostClientId || room.hostClientId === fallbackCid,
        lastSeen: now,
      }
    }

    const srcRoles = snap.roles && typeof snap.roles === 'object' ? snap.roles : snap.claims
    if (srcRoles && typeof srcRoles === 'object') {
      for (const [rId, entry] of Object.entries(srcRoles)) {
        if (!VALID_ROLE_IDS.has(rId) || !entry || typeof entry !== 'object') continue
        const rCid = typeof entry.clientId === 'string' ? entry.clientId.trim() : ''
        if (!rCid) continue
        if (!room.members[rCid]) {
          room.members[rCid] = {
            clientId: rCid,
            pilotName:
              typeof entry.playerName === 'string' && entry.playerName.trim()
                ? entry.playerName.trim().slice(0, 24)
                : 'Specialist',
            roleId: rId,
            isHost: rCid === hostClientId,
            lastSeen: now,
          }
        }
        room.roles[rId] = {
          clientId: rCid,
          playerName: room.members[rCid].pilotName,
          timestamp: now,
        }
      }
    }

    if (snap.briefingReady && typeof snap.briefingReady === 'object') {
      for (const [cid, flag] of Object.entries(snap.briefingReady)) {
        if (flag && room.members[cid]) room.briefingReady[cid] = true
      }
    }

    if (snap.satellites && typeof snap.satellites === 'object') {
      for (const satKey of ['sat1', 'sat2']) {
        const srcSat = snap.satellites[satKey]
        if (!srcSat || typeof srcSat !== 'object') continue
        const cleanParts = {}
        if (srcSat.parts && typeof srcSat.parts === 'object') {
          for (const [pid, qty] of Object.entries(srcSat.parts)) {
            const n = Number(qty)
            if (Number.isFinite(n) && n > 0) cleanParts[pid] = Math.round(n)
          }
        }
        room.satellites[satKey] = {
          ...room.satellites[satKey],
          contractId: sanitizeMissionId(srcSat.contractId ?? mId),
          launcherId: resolveCompatibleLauncher(
            mId,
            sanitizeLauncherId(srcSat.launcherId ?? room.launcherId)
          ),
          chassisId: typeof srcSat.chassisId === 'string' && srcSat.chassisId ? srcSat.chassisId : room.satellites[satKey].chassisId,
          parts: cleanParts,
          updatedAt: now,
          updatedByRole: srcSat.updatedByRole,
          updatedByName: srcSat.updatedByName,
          lastActionLabel: srcSat.lastActionLabel,
        }
      }
    }

    if (typeof snap.selectionDeadlineAt === 'number' && snap.selectionDeadlineAt > now) {
      room.selectionDeadlineAt = snap.selectionDeadlineAt
    }
    if (typeof snap.briefingDeadlineAt === 'number' && snap.briefingDeadlineAt > now) {
      room.briefingDeadlineAt = snap.briefingDeadlineAt
    }

    syncMembersMetadata(room)
    rooms.set(code, room)
    return room
  }

  const pruneExpiredCooldowns = (cooldowns, now) => {
    const next = {}
    if (!cooldowns) return next
    for (const [k, exp] of Object.entries(cooldowns)) {
      if (typeof exp === 'number' && Number.isFinite(exp) && exp > now) {
        next[k] = exp
      }
    }
    return next
  }

  const filterThreatsAgainstCooldowns = (threats, cooldowns, now) => {
    return threats.filter((item) => {
      if (!item || typeof item !== 'object') return false
      const g = item.game
      if (typeof g !== 'string' || !g.trim()) return false
      const exp = cooldowns[g.trim()]
      return !(typeof exp === 'number' && exp > now)
    })
  }

  const sendJson = (res, status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(JSON.stringify(body))
  }

  const sendNotFound = (res, roomCode, extra = {}) => {
    const code = sanitizeRoomCode(roomCode)
    const explicitlyClosed = Boolean(code && closedRooms.has(code))
    sendJson(res, 404, {
      ok: false,
      deleted: explicitlyClosed,
      explicitlyClosed,
      roomNotFound: true,
      error: 'ROOM_NOT_FOUND',
      ...extra,
    })
  }

  const applyStationSyncPayload = (room, parsed, now) => {
    const clientId = typeof parsed.clientId === 'string' ? parsed.clientId.trim() : ''
    const roleId = typeof parsed.roleId === 'string' ? parsed.roleId.trim() : ''
    const cleanName =
      typeof parsed.playerName === 'string' && parsed.playerName.trim()
        ? parsed.playerName.trim().slice(0, 24)
        : 'Specialist'

    if (clientId) {
      const memberRes = upsertRoomMember(room, clientId, cleanName, now)
      if (!memberRes.ok) {
        return { ok: false, error: memberRes.error }
      }
      for (const entry of Object.values(room.roles)) {
        if (entry.clientId === clientId) {
          entry.timestamp = now
          if (parsed.playerName?.trim()) {
            entry.playerName = cleanName
          }
        }
      }
    }

    if (roleId && clientId && parsed.player && typeof parsed.player === 'object') {
      const owner = room.roles[roleId]
      if (!owner || owner.clientId === clientId) {
        removePlayersByClient(room, clientId, roleId)
        room.players[roleId] = {
          clientId,
          playerName: owner?.playerName ?? cleanName,
          x: Number.isFinite(Number(parsed.player.x)) ? Number(parsed.player.x) : 0,
          y: Number.isFinite(Number(parsed.player.y)) ? Number(parsed.player.y) : 0,
          dir: sanitizeDir(parsed.player.dir),
          walkFrame: Number.isFinite(Number(parsed.player.walkFrame))
            ? Number(parsed.player.walkFrame)
            : 0,
          isInteracting: Boolean(parsed.player.isInteracting),
          currentRoom:
            typeof parsed.player.currentRoom === 'string' && parsed.player.currentRoom.trim()
              ? parsed.player.currentRoom.trim().slice(0, 48)
              : 'STATION',
          lastSeen: now,
        }
        if (owner) {
          owner.timestamp = now
          if (parsed.playerName?.trim()) {
            owner.playerName = cleanName
          }
        }
      }
    }

    if (room.sharedStation.lastUpdated === 0 && parsed.seedStation) {
      const seededCompleted = Array.isArray(parsed.seedStation.completedMinigames)
        ? parsed.seedStation.completedMinigames.filter((g) => typeof g === 'string')
        : []
      const seededThreats = Array.isArray(parsed.seedStation.activeThreats)
        ? filterThreatsAgainstCooldowns(
            parsed.seedStation.activeThreats,
            room.sharedStation.consoleCooldowns ?? {},
            now
          )
        : []
      const seededStats = {}
      if (parsed.seedStation.stats && typeof parsed.seedStation.stats === 'object') {
        for (const [k, v] of Object.entries(parsed.seedStation.stats)) {
          if (typeof v === 'number' && Number.isFinite(v)) seededStats[k] = v
        }
      }
      const seededPoints =
        typeof parsed.seedStation.points === 'number' && Number.isFinite(parsed.seedStation.points)
          ? Math.max(0, Math.round(parsed.seedStation.points))
          : 0
      const seededHealth =
        typeof parsed.seedStation.stationHealth === 'number' &&
        Number.isFinite(parsed.seedStation.stationHealth)
          ? Math.max(0, Math.min(100, Math.round(parsed.seedStation.stationHealth * 10) / 10))
          : 100
      const baseStation = createEmptySharedStation(Math.max(room.sharedStation.points, seededPoints))
      room.sharedStation = {
        ...baseStation,
        completedMinigames: Array.from(new Set(seededCompleted)),
        activeThreats: seededThreats,
        stats: seededStats,
        stationHealth: seededHealth,
        lastUpdated: now,
      }
    }

    room.sharedStation.consoleCooldowns = pruneExpiredCooldowns(room.sharedStation.consoleCooldowns, now)
    if (typeof room.sharedStation.resolvedCount !== 'number') {
      room.sharedStation.resolvedCount = room.sharedStation.completedMinigames.length
    }
    if (!room.sharedStation.roleResolvedCounts) {
      room.sharedStation.roleResolvedCounts = { director: 0, engineer: 0, science: 0, comms: 0 }
    }
    if (!room.sharedStation.attemptCounts) {
      room.sharedStation.attemptCounts = {}
    }
    if (
      typeof room.sharedStation.stationHealth !== 'number' ||
      !Number.isFinite(room.sharedStation.stationHealth)
    ) {
      room.sharedStation.stationHealth = 100
    }
    if (typeof room.sharedStation.isGameOver !== 'boolean') {
      room.sharedStation.isGameOver = false
    }
    if (typeof room.sharedStation.gameOverReason !== 'string') {
      room.sharedStation.gameOverReason = ''
    }
    if (typeof room.sharedStation.retryEpoch !== 'number') {
      room.sharedStation.retryEpoch = 0
    }

    const prevResolvedCount = room.sharedStation.resolvedCount
    let stationTouched = false

    if (typeof parsed.completedGame === 'string' && parsed.completedGame.trim()) {
      const game = parsed.completedGame.trim()
      const nonce = typeof parsed.completionNonce === 'string' ? parsed.completionNonce.trim() : ''
      const recentNonces = Array.isArray(room.sharedStation.recentNonces) ? room.sharedStation.recentNonces : []
      const isDuplicateNonce = nonce ? recentNonces.includes(nonce) : false
      const currentlyInCooldown =
        typeof room.sharedStation.consoleCooldowns[game] === 'number' &&
        room.sharedStation.consoleCooldowns[game] > now

      if (!isDuplicateNonce && !currentlyInCooldown) {
        if (!room.sharedStation.completedMinigames.includes(game)) {
          room.sharedStation.completedMinigames = [...room.sharedStation.completedMinigames, game]
        }
        room.sharedStation.resolvedCount = (room.sharedStation.resolvedCount ?? 0) + 1
        const compRole =
          typeof parsed.completedRole === 'string' && VALID_ROLE_IDS.has(parsed.completedRole.trim())
            ? parsed.completedRole.trim()
            : VALID_ROLE_IDS.has(roleId)
              ? roleId
              : ''
        if (compRole) {
          room.sharedStation.roleResolvedCounts[compRole] =
            (room.sharedStation.roleResolvedCounts[compRole] ?? 0) + 1
        }
        room.sharedStation.attemptCounts[game] = (room.sharedStation.attemptCounts[game] ?? 0) + 1
        const cdSec =
          typeof parsed.cooldownSeconds === 'number' && Number.isFinite(parsed.cooldownSeconds)
            ? Math.max(120, Math.min(150, Math.round(parsed.cooldownSeconds)))
            : 135
        room.sharedStation.consoleCooldowns[game] = now + cdSec * 1000
        if (nonce) {
          room.sharedStation.recentNonces = [...recentNonces, nonce].slice(-48)
        }
        if (
          typeof parsed.pointsDelta === 'number' &&
          Number.isFinite(parsed.pointsDelta) &&
          parsed.pointsDelta !== 0
        ) {
          room.sharedStation.points = Math.max(
            0,
            Math.round(room.sharedStation.points + parsed.pointsDelta)
          )
        }
        if (!room.sharedStation.isGameOver) {
          room.sharedStation.stationHealth = Math.min(
            100,
            Math.round((room.sharedStation.stationHealth + 15) * 10) / 10
          )
        }
      }
      room.sharedStation.activeThreats = filterThreatsAgainstCooldowns(
        room.sharedStation.activeThreats,
        room.sharedStation.consoleCooldowns,
        now
      )
      stationTouched = true
    } else if (
      typeof parsed.pointsDelta === 'number' &&
      Number.isFinite(parsed.pointsDelta) &&
      parsed.pointsDelta !== 0
    ) {
      room.sharedStation.points = Math.max(
        0,
        Math.round(room.sharedStation.points + parsed.pointsDelta)
      )
      stationTouched = true
    }

    if (
      !room.sharedStation.isGameOver &&
      typeof parsed.healthDelta === 'number' &&
      Number.isFinite(parsed.healthDelta) &&
      parsed.healthDelta !== 0
    ) {
      const hNonce = typeof parsed.healthNonce === 'string' ? parsed.healthNonce.trim() : ''
      const recentNonces = Array.isArray(room.sharedStation.recentNonces) ? room.sharedStation.recentNonces : []
      if (!hNonce || !recentNonces.includes(hNonce)) {
        room.sharedStation.stationHealth = Math.max(
          0,
          Math.min(100, Math.round((room.sharedStation.stationHealth + parsed.healthDelta) * 10) / 10)
        )
        if (hNonce) {
          room.sharedStation.recentNonces = [...recentNonces, hNonce].slice(-48)
        }
        if (room.sharedStation.stationHealth <= 0) {
          room.sharedStation.isGameOver = true
          room.sharedStation.gameOverReason =
            (typeof parsed.gameOverReason === 'string' && parsed.gameOverReason.trim()) ||
            'Overall station integrity dropped to 0% following critical failures.'
        }
        stationTouched = true
      }
    }

    if (parsed.isGameOver === true && !room.sharedStation.isGameOver) {
      room.sharedStation.isGameOver = true
      room.sharedStation.gameOverReason =
        (typeof parsed.gameOverReason === 'string' && parsed.gameOverReason.trim()) ||
        'Catastrophic collapse in vital station systems.'
      stationTouched = true
    }

    if (Array.isArray(parsed.completedMinigames) && parsed.completedMinigames.length > 0) {
      const merged = new Set(room.sharedStation.completedMinigames)
      for (const g of parsed.completedMinigames) {
        if (typeof g === 'string' && g.trim()) merged.add(g.trim())
      }
      if (merged.size > room.sharedStation.completedMinigames.length) {
        room.sharedStation.completedMinigames = Array.from(merged)
        room.sharedStation.activeThreats = filterThreatsAgainstCooldowns(
          room.sharedStation.activeThreats,
          room.sharedStation.consoleCooldowns,
          now
        )
        stationTouched = true
      }
    }

    if (parsed.statsPatch && typeof parsed.statsPatch === 'object') {
      for (const [k, v] of Object.entries(parsed.statsPatch)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          room.sharedStation.stats[k] = v
          stationTouched = true
        }
      }
    }

    const acceptBulkUpdate =
      parsed.forceStateUpdate === true &&
      (typeof parsed.knownSolvedCount !== 'number' || parsed.knownSolvedCount >= prevResolvedCount)

    if (acceptBulkUpdate) {
      if (Array.isArray(parsed.activeThreats)) {
        room.sharedStation.activeThreats = filterThreatsAgainstCooldowns(
          parsed.activeThreats,
          room.sharedStation.consoleCooldowns,
          now
        )
        stationTouched = true
      }
      if (parsed.stats && typeof parsed.stats === 'object') {
        for (const [k, v] of Object.entries(parsed.stats)) {
          if (typeof v === 'number' && Number.isFinite(v)) {
            room.sharedStation.stats[k] = v
          }
        }
        stationTouched = true
      }
    }

    if (stationTouched) {
      room.sharedStation.lastUpdated = now
    }
    room.updatedAt = now
    return { ok: true }
  }

  const handleRoomAction = (room, parsed, res, now) => {
    const action = typeof parsed.action === 'string' ? parsed.action.trim() : 'heartbeat'
    const clientId = typeof parsed.clientId === 'string' ? parsed.clientId.trim() : ''
    const roleIdRaw =
      typeof parsed.roleId === 'string'
        ? parsed.roleId
        : typeof parsed.role === 'string'
          ? parsed.role
          : ''
    const roleId = roleIdRaw.trim()
    const playerName =
      typeof parsed.playerName === 'string' && parsed.playerName.trim()
        ? parsed.playerName.trim().slice(0, 24)
        : 'Specialist'

    if (action === 'close_room') {
      markRoomClosed(room.code, now)
      broadcastRoomDeleted(room.code, true)
      rooms.delete(room.code)
      sendJson(res, 200, {
        ok: true,
        deleted: true,
        explicitlyClosed: true,
        room: null,
        claims: {},
        serverTime: now,
      })
      return
    }

    if (action === 'leave' || action === 'leave_room') {
      const leaveRes = removeClientFromRoom(room, clientId, now, 'leave')
      if (leaveRes.deleted) {
        sendJson(res, 200, {
          ok: true,
          deleted: true,
          explicitlyClosed: Boolean(leaveRes.explicitlyClosed),
          room: null,
          claims: {},
          serverTime: now,
        })
        return
      }
      if (leaveRes.changed) broadcastRoomRoles(room)
      sendJson(res, 200, {
        ok: true,
        deleted: false,
        room: serializeRoom(room),
        claims: room.roles,
        serverTime: now,
      })
      return
    }

    const prunedRoles = purgeStaleMembers(room, now)

    if (clientId) {
      const memberCheck = upsertRoomMember(room, clientId, playerName, now)
      if (!memberCheck.ok) {
        if (prunedRoles) broadcastRoomRoles(room)
        sendJson(res, 400, {
          ok: false,
          code: 'ROOM_FULL',
          error: memberCheck.error,
          room: serializeRoom(room),
          claims: room.roles,
          serverTime: now,
        })
        return
      }
      if (action === 'join' && memberCheck.isNew) {
        removeClientFromOtherRooms(clientId, room.code, 'switch', now)
      }
    }

    if (action === 'reset') {
      for (const k of Object.keys(room.roles)) delete room.roles[k]
      for (const k of Object.keys(room.players)) delete room.players[k]
      for (const member of Object.values(room.members)) member.roleId = null
      room.selectionDeadlineAt = null
      room.briefingDeadlineAt = null
      room.briefingReady = {}
      if (parsed.resetPhase) {
        room.phase = 'LOBBY'
        room.currentMissionIndex = 1
        applyMissionToRoomSatellites(room, 'andes', 'rideshare', now, 'System')
      }
      if (parsed.resetStation) {
        room.sharedStation = createEmptySharedStation()
      }
      syncLobbySelectionTimer(room, now)
      room.updatedAt = now
      broadcastRoomRoles(room)
      sendJson(res, 200, { ok: true, room: serializeRoom(room), claims: room.roles, serverTime: now })
      return
    }

    if (action === 'claim' || action === 'claim_role') {
      if (!roleId || !clientId) {
        sendJson(res, 400, {
          ok: false,
          error: 'MISSING_FIELDS',
          room: serializeRoom(room),
          claims: room.roles,
        })
        return
      }
      const alreadyOwned = Object.entries(room.roles).find(
        ([k, entry]) => k !== roleId && entry.clientId === clientId
      )
      if (alreadyOwned && room.phase === 'LOBBY' && parsed.allowSwap !== true) {
        sendJson(res, 409, {
          ok: false,
          error: 'ALREADY_HAS_ROLE',
          ownedRole: alreadyOwned[0],
          room: serializeRoom(room),
          claims: room.roles,
        })
        return
      }
      const existing = room.roles[roleId]
      if (existing && existing.clientId !== clientId) {
        syncLobbySelectionTimer(room, now)
        if (prunedRoles) broadcastRoomRoles(room)
        sendJson(res, 409, {
          ok: false,
          error: 'ROLE_LOCKED_BY_OTHER',
          ownerName: existing.playerName,
          room: serializeRoom(room),
          claims: room.roles,
        })
        return
      }
      for (const [k, entry] of Object.entries(room.roles)) {
        if (k !== roleId && entry.clientId === clientId) {
          delete room.roles[k]
        }
      }
      removePlayersByClient(room, clientId, roleId)
      room.roles[roleId] = { clientId, playerName, timestamp: now }
      if (room.members[clientId]) {
        room.members[clientId].roleId = roleId
      }
      syncLobbySelectionTimer(room, now)
      room.updatedAt = now
      broadcastRoomRoles(room)
      sendJson(res, 200, { ok: true, room: serializeRoom(room), claims: room.roles, serverTime: now })
      return
    }

    if (action === 'release' || action === 'release_role') {
      let changed = prunedRoles
      if (roleId && room.roles[roleId]) {
        if (!clientId || room.roles[roleId].clientId === clientId) {
          const ownerCid = room.roles[roleId].clientId
          delete room.roles[roleId]
          if (room.players[roleId] && (!clientId || room.players[roleId].clientId === clientId)) {
            delete room.players[roleId]
          }
          if (room.members[ownerCid]) room.members[ownerCid].roleId = null
          changed = true
        }
      } else if (clientId) {
        for (const [k, entry] of Object.entries(room.roles)) {
          if (entry.clientId === clientId) {
            delete room.roles[k]
            changed = true
          }
        }
        removePlayersByClient(room, clientId)
        if (room.members[clientId]) room.members[clientId].roleId = null
      }
      syncLobbySelectionTimer(room, now)
      room.updatedAt = now
      if (changed) broadcastRoomRoles(room)
      sendJson(res, 200, { ok: true, room: serializeRoom(room), claims: room.roles, serverTime: now })
      return
    }

    if (action === 'select_mission') {
      const isHost = !room.hostClientId || room.hostClientId === clientId
      const isDirector = Boolean(clientId && room.roles.director?.clientId === clientId)
      if (!isHost && !isDirector) {
        sendJson(res, 403, {
          ok: false,
          error: 'ONLY_HOST_OR_DIRECTOR',
          room: serializeRoom(room),
        })
        return
      }
      const activeStageMission = missionIndexToId(room.currentMissionIndex)
      if (
        typeof parsed.missionId === 'string' &&
        sanitizeMissionId(parsed.missionId) !== activeStageMission
      ) {
        sendJson(res, 403, {
          ok: false,
          code: 'MISSION_STAGE_LOCKED',
          error: 'Campaign is sequential: complete the current stage before advancing.',
          room: serializeRoom(room),
        })
        return
      }
      const stageLauncher = defaultLauncherForStage(room.currentMissionIndex)
      applyMissionToRoomSatellites(room, activeStageMission, stageLauncher, now, playerName)
      room.updatedAt = now
      broadcastRoomRoles(room)
      sendJson(res, 200, { ok: true, room: serializeRoom(room), claims: room.roles, serverTime: now })
      return
    }

    if (action === 'toggle_briefing_ready') {
      if (clientId) {
        const nextReady =
          typeof parsed.ready === 'boolean' ? parsed.ready : !Boolean(room.briefingReady[clientId])
        if (nextReady) {
          room.briefingReady[clientId] = true
        } else {
          delete room.briefingReady[clientId]
        }
        syncBriefingTimerAndAdvance(room, now)
        room.updatedAt = now
        broadcastRoomRoles(room)
      }
      sendJson(res, 200, { ok: true, room: serializeRoom(room), claims: room.roles, serverTime: now })
      return
    }

    if (action === 'advance_next_mission') {
      const isHost = !room.hostClientId || room.hostClientId === clientId
      const isDirector = Boolean(clientId && room.roles.director?.clientId === clientId)
      const isMember = Boolean(clientId && room.members[clientId])
      if (!isHost && !isDirector && !isMember) {
        sendJson(res, 403, {
          ok: false,
          error: 'ONLY_ROOM_MEMBER',
          room: serializeRoom(room),
        })
        return
      }
      const nextIndex = Math.min(3, room.currentMissionIndex + 1)
      const nextMission = missionIndexToId(nextIndex)
      const nextLauncher = defaultLauncherForStage(nextIndex)
      room.currentMissionIndex = nextIndex
      applyMissionToRoomSatellites(room, nextMission, nextLauncher, now, playerName)
      const targetPhase = sanitizePhase(parsed.targetPhase) ?? 'MISSION_BRIEFING'
      room.phase = targetPhase
      room.briefingDeadlineAt = targetPhase === 'MISSION_BRIEFING' ? now + BRIEFING_TIMEOUT_MS : null
      room.briefingReady = {}
      const keptPoints =
        typeof parsed.keepPoints === 'number' && Number.isFinite(parsed.keepPoints)
          ? Math.max(0, Math.round(parsed.keepPoints))
          : room.sharedStation.points
      room.sharedStation = {
        ...createEmptySharedStation(keptPoints),
        stats: {
          battery: 95,
          lifeSupport: 100,
          dataBuffer: 0,
          orbitStability: 100,
          hull: 100,
          signalQuality: 100,
        },
        lastUpdated: now,
      }
      room.updatedAt = now
      broadcastRoomRoles(room)
      sendJson(res, 200, { ok: true, room: serializeRoom(room), claims: room.roles, serverTime: now })
      return
    }

    if (action === 'set_phase') {
      const nextPhase = sanitizePhase(parsed.phase)
      if (!nextPhase) {
        sendJson(res, 400, { ok: false, error: 'INVALID_PHASE', room: serializeRoom(room) })
        return
      }
      const isHost = !room.hostClientId || room.hostClientId === clientId
      const isDirector = Boolean(clientId && room.roles.director?.clientId === clientId)
      if (nextPhase === 'MISSION_BRIEFING' && !isHost && room.phase === 'LOBBY') {
        sendJson(res, 403, { ok: false, error: 'ONLY_HOST_CAN_START', room: serializeRoom(room) })
        return
      }
      if (
        (nextPhase === 'MISSION_BRIEFING' ||
          nextPhase === 'WORKSHOP' ||
          nextPhase === 'LAUNCH' ||
          nextPhase === 'STATION') &&
        !isHost &&
        !isDirector
      ) {
        sendJson(res, 403, {
          ok: false,
          error: 'ONLY_HOST_OR_DIRECTOR',
          room: serializeRoom(room),
        })
        return
      }
      const activeStageMission = missionIndexToId(room.currentMissionIndex)
      const activeStageLauncher = defaultLauncherForStage(room.currentMissionIndex)
      room.phase = nextPhase
      if (nextPhase === 'MISSION_BRIEFING') {
        room.briefingDeadlineAt = now + BRIEFING_TIMEOUT_MS
        room.briefingReady = {}
        applyMissionToRoomSatellites(room, activeStageMission, activeStageLauncher, now, playerName)
      } else if (nextPhase === 'WORKSHOP') {
        room.briefingDeadlineAt = null
        room.briefingReady = {}
        applyMissionToRoomSatellites(room, activeStageMission, activeStageLauncher, now, playerName)
        room.sharedStation = createEmptySharedStation(
          room.currentMissionIndex > 1 ? room.sharedStation.points : 0
        )
      } else {
        room.briefingDeadlineAt = null
      }
      syncLobbySelectionTimer(room, now)
      room.updatedAt = now
      broadcastRoomRoles(room)
      sendJson(res, 200, { ok: true, room: serializeRoom(room), claims: room.roles, serverTime: now })
      return
    }

    if (action === 'satellite_part') {
      const satId = parsed.satId === 'sat2' ? 'sat2' : 'sat1'
      const sat = room.satellites[satId]
      const partId = typeof parsed.partId === 'string' ? parsed.partId.trim() : ''
      const delta = Number(parsed.delta) || 0
      const maxCount = Math.max(1, Number(parsed.maxCount) || 4)
      const partSlots = Math.max(0, Number(parsed.partSlots) || 0)
      const chassisUnits = Math.max(1, Number(parsed.chassisUnits) || 12)
      const partSlotsMap =
        parsed.partSlotsMap && typeof parsed.partSlotsMap === 'object' ? parsed.partSlotsMap : null

      if (!partId || delta === 0) {
        sendJson(res, 400, { ok: false, error: 'INVALID_PART', room: serializeRoom(room) })
        return
      }

      const cur = sat.parts[partId] ?? 0
      const nextQty = Math.max(0, Math.min(maxCount, cur + delta))
      if (delta > 0 && partSlots > 0 && partSlotsMap) {
        let usedSlots = 0
        for (const [pid, qty] of Object.entries(sat.parts)) {
          usedSlots += (Number(partSlotsMap[pid]) || 0) * (Number(qty) || 0)
        }
        if (usedSlots + partSlots > chassisUnits) {
          sendJson(res, 200, {
            ok: false,
            error: 'SLOTS_FULL',
            room: serializeRoom(room),
            serverTime: now,
          })
          return
        }
      }

      if (nextQty === 0) {
        delete sat.parts[partId]
      } else {
        sat.parts[partId] = nextQty
      }
      sat.updatedAt = now
      sat.updatedByRole = roleId || sat.updatedByRole
      sat.updatedByName = playerName
      if (typeof parsed.actionLabel === 'string' && parsed.actionLabel.trim()) {
        sat.lastActionLabel = parsed.actionLabel.trim().slice(0, 96)
      }
      room.updatedAt = now
      sendJson(res, 200, { ok: true, room: serializeRoom(room), claims: room.roles, serverTime: now })
      return
    }

    if (action === 'satellite_config') {
      const satId = parsed.satId === 'sat2' ? 'sat2' : 'sat1'
      const sat = room.satellites[satId]
      sat.contractId = missionIndexToId(room.currentMissionIndex)
      if (typeof parsed.launcherId === 'string' && parsed.launcherId.trim()) {
        sat.launcherId = resolveCompatibleLauncher(sat.contractId, sanitizeLauncherId(parsed.launcherId))
      }
      if (typeof parsed.chassisId === 'string' && parsed.chassisId.trim()) {
        sat.chassisId = parsed.chassisId.trim()
      }
      if (parsed.parts && typeof parsed.parts === 'object') {
        const cleanParts = {}
        for (const [pid, qty] of Object.entries(parsed.parts)) {
          const n = Number(qty)
          if (Number.isFinite(n) && n > 0) cleanParts[pid] = Math.round(n)
        }
        sat.parts = cleanParts
      }
      sat.updatedAt = now
      sat.updatedByRole = roleId || sat.updatedByRole
      sat.updatedByName = playerName
      if (typeof parsed.actionLabel === 'string' && parsed.actionLabel.trim()) {
        sat.lastActionLabel = parsed.actionLabel.trim().slice(0, 96)
      }
      room.updatedAt = now
      sendJson(res, 200, { ok: true, room: serializeRoom(room), claims: room.roles, serverTime: now })
      return
    }

    if (action === 'sync_station' || action === 'sync') {
      const syncRes = applyStationSyncPayload(room, parsed, now)
      if (!syncRes.ok) {
        sendJson(res, 400, {
          ok: false,
          code: 'ROOM_FULL',
          error: syncRes.error,
          room: serializeRoom(room),
          claims: room.roles,
          serverTime: now,
        })
        return
      }
      if (prunedRoles) broadcastRoomRoles(room)
      sendJson(res, 200, {
        ok: true,
        room: serializeRoom(room),
        roles: room.roles,
        claims: room.roles,
        players: room.players,
        sharedStation: room.sharedStation,
        serverTime: now,
      })
      return
    }

    let activeRole = null
    if (clientId) {
      for (const [k, entry] of Object.entries(room.roles)) {
        if (entry.clientId === clientId) {
          entry.timestamp = now
          if (typeof parsed.playerName === 'string' && parsed.playerName.trim()) {
            entry.playerName = playerName
          }
          activeRole = k
        }
      }
    }
    syncLobbySelectionTimer(room, now)
    room.updatedAt = now
    if (prunedRoles) broadcastRoomRoles(room)
    sendJson(res, 200, {
      ok: true,
      activeRole,
      room: serializeRoom(room),
      claims: room.roles,
      serverTime: now,
    })
  }

  const handleRoomsRoute = (req, res, subUrl) => {
    const method = (req.method ?? 'GET').toUpperCase()
    const pathOnly = subUrl.split('?')[0] ?? '/'
    const parts = pathOnly.split('/').filter(Boolean)
    const query = parseQueryParams(subUrl)

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.end()
      return true
    }

    const now = Date.now()
    cleanupRooms(now)

    if (method === 'DELETE' || (method === 'POST' && parts.length === 1 && parts[0] === 'clear')) {
      for (const code of Array.from(rooms.keys())) {
        markRoomClosed(code, now)
        broadcastRoomDeleted(code, true)
      }
      rooms.clear()
      sendJson(res, 200, { ok: true, rooms: [], serverTime: now })
      return true
    }

    if (method === 'POST' && parts.length === 1 && parts[0] === 'create') {
      readJsonBody(req, (err, parsed) => {
        if (err || !parsed) {
          sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
          return
        }
        const reqNow = Date.now()
        cleanupRooms(reqNow)
        const clientId =
          typeof parsed.clientId === 'string' && parsed.clientId.trim()
            ? parsed.clientId.trim()
            : `host-${reqNow.toString(36)}`
        const playerName =
          typeof parsed.playerName === 'string' && parsed.playerName.trim()
            ? parsed.playerName.trim().slice(0, 24)
            : 'Commander'

        removeClientFromOtherRooms(clientId, null, 'switch', reqNow)

        let code = sanitizeRoomCode(parsed.requestedCode)
        if (!code || rooms.has(code) || code === DEFAULT_ROOM_CODE) {
          code = generateRoomCode()
        }
        closedRooms.delete(code)
        const room = createEmptyRoom(code, clientId, playerName, reqNow)
        rooms.set(code, room)
        sendJson(res, 200, { ok: true, room: serializeRoom(room), serverTime: reqNow })
      })
      return true
    }

    if (method === 'POST' && parts.length === 2 && parts[1] === 'action') {
      const code = sanitizeRoomCode(decodeURIComponent(parts[0]))
      readJsonBody(req, (err, parsed) => {
        if (err || !parsed) {
          sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
          return
        }
        const reqNow = Date.now()
        cleanupRooms(reqNow)
        let room = rooms.get(code)
        if (!room) {
          const act = typeof parsed.action === 'string' ? parsed.action.trim() : ''
          if (act === 'close_room') {
            markRoomClosed(code, reqNow)
            sendJson(res, 200, {
              ok: true,
              deleted: true,
              explicitlyClosed: true,
              room: null,
              claims: {},
              serverTime: reqNow,
            })
            return
          }
          if (act === 'leave' || act === 'leave_room') {
            sendJson(res, 200, { ok: true, deleted: true, room: null, claims: {}, serverTime: reqNow })
            return
          }
          room = rehydrateRoomIfMissing(code, parsed, reqNow)
        }
        if (!room) {
          sendNotFound(res, code, { serverTime: reqNow })
          return
        }
        handleRoomAction(room, parsed, res, reqNow)
      })
      return true
    }

    if (method === 'GET') {
      const requestedCode =
        parts.length === 1
          ? sanitizeRoomCode(decodeURIComponent(parts[0]))
          : sanitizeRoomCode(query.code ?? query.roomCode)

      if (requestedCode) {
        const room = rooms.get(requestedCode)
        if (!room) {
          sendNotFound(res, requestedCode, { serverTime: now })
          return true
        }
        sendJson(res, 200, { ok: true, room: serializeRoom(room), serverTime: now })
        return true
      }

      const list = Array.from(rooms.values())
        .filter((r) => r.code !== DEFAULT_ROOM_CODE && Object.keys(r.members).length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 16)
        .map((r) => serializeRoom(r))
      sendJson(res, 200, { ok: true, rooms: list, serverTime: now })
      return true
    }

    return false
  }

  const handleLobbyRoute = (req, res, subUrl) => {
    const method = (req.method ?? 'GET').toUpperCase()
    const pathOnly = subUrl.split('?')[0] ?? '/'
    const parts = pathOnly.split('/').filter(Boolean)
    const query = parseQueryParams(subUrl)

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.end()
      return true
    }

    const now = Date.now()
    cleanupRooms(now)

    if (method === 'DELETE' || (method === 'POST' && parts.length === 1 && parts[0] === 'clear')) {
      for (const code of Array.from(rooms.keys())) {
        markRoomClosed(code, now)
        broadcastRoomDeleted(code, true)
      }
      rooms.clear()
      sendJson(res, 200, { ok: true, rooms: [], serverTime: now })
      return true
    }

    if (method === 'GET') {
      const requestedCode = sanitizeRoomCode(query.code ?? query.roomCode)
      if (requestedCode) {
        const room = rooms.get(requestedCode)
        if (!room) {
          sendNotFound(res, requestedCode, { serverTime: now })
          return true
        }
        sendJson(res, 200, { ok: true, room: serializeRoom(room), serverTime: now })
        return true
      }
      const list = Array.from(rooms.values())
        .filter((r) => r.code !== DEFAULT_ROOM_CODE && Object.keys(r.members).length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 16)
        .map((r) => serializeRoom(r))
      sendJson(res, 200, { ok: true, rooms: list, serverTime: now })
      return true
    }

    if (method === 'POST') {
      readJsonBody(req, (err, parsed) => {
        if (err || !parsed) {
          sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
          return
        }
        const reqNow = Date.now()
        cleanupRooms(reqNow)
        const code = sanitizeRoomCode(parsed.roomCode) || DEFAULT_ROOM_CODE
        let room =
          code === DEFAULT_ROOM_CODE
            ? getOrCreateDefaultRoom(
                String(parsed.clientId ?? ''),
                String(parsed.playerName ?? 'Host'),
                reqNow
              )
            : rooms.get(code)
        if (!room && code !== DEFAULT_ROOM_CODE) {
          room = rehydrateRoomIfMissing(code, parsed, reqNow)
        }
        if (!room) {
          sendNotFound(res, code, { serverTime: reqNow })
          return
        }
        handleRoomAction(room, parsed, res, reqNow)
      })
      return true
    }

    return false
  }

  const handleRolesSyncRoute = (req, res, subUrl) => {
    const method = (req.method ?? 'GET').toUpperCase()
    const query = parseQueryParams(subUrl)

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.end()
      return true
    }

    const now = Date.now()
    cleanupRooms(now)
    const queryRoomCode = sanitizeRoomCode(query.roomCode ?? query.code) || DEFAULT_ROOM_CODE

    if (method === 'GET') {
      const room =
        queryRoomCode === DEFAULT_ROOM_CODE
          ? getOrCreateDefaultRoom('', 'Host', now)
          : rooms.get(queryRoomCode)
      if (!room) {
        sendNotFound(res, queryRoomCode, {
          roomCode: queryRoomCode,
          claims: {},
          roles: {},
          serverTime: now,
        })
        return true
      }
      const pruned = purgeStaleMembers(room, now)
      if (pruned) broadcastRoomRoles(room)

      if (subUrl.includes('stream=1')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: enableSse ? 'keep-alive' : 'close',
          'Access-Control-Allow-Origin': '*',
        })
        const initialFrame = `retry: 1500\ndata: ${JSON.stringify({
          roomCode: room.code,
          claims: room.roles,
          room: serializeRoom(room),
          serverTime: now,
        })}\n\n`
        if (!enableSse) {
          res.end(initialFrame)
          return true
        }
        const subscriber = { roomCode: room.code, res }
        subscribers.add(subscriber)
        subscriber.res.write(`: connected\n\n`)
        subscriber.res.write(initialFrame)
        req.on('close', () => {
          subscribers.delete(subscriber)
        })
        return true
      }

      sendJson(res, 200, {
        roomCode: room.code,
        claims: room.roles,
        roles: room.roles,
        room: serializeRoom(room),
        serverTime: now,
      })
      return true
    }

    if (method === 'POST') {
      readJsonBody(req, (err, parsed) => {
        if (err || !parsed) {
          sendJson(res, 400, { ok: false, error: 'INVALID_JSON', claims: {} })
          return
        }
        const reqNow = Date.now()
        cleanupRooms(reqNow)
        const code = sanitizeRoomCode(parsed.roomCode ?? queryRoomCode) || DEFAULT_ROOM_CODE
        let room =
          code === DEFAULT_ROOM_CODE
            ? getOrCreateDefaultRoom(
                String(parsed.clientId ?? ''),
                String(parsed.playerName ?? 'Host'),
                reqNow
              )
            : rooms.get(code)
        if (!room && code !== DEFAULT_ROOM_CODE) {
          room = rehydrateRoomIfMissing(code, parsed, reqNow)
        }
        if (!room) {
          sendNotFound(res, code, {
            claims: {},
            roles: {},
            serverTime: reqNow,
          })
          return
        }
        handleRoomAction(room, parsed, res, reqNow)
      })
      return true
    }

    return false
  }

  const handleStationSyncRoute = (req, res, subUrl) => {
    const method = (req.method ?? 'GET').toUpperCase()
    const query = parseQueryParams(subUrl)

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.end()
      return true
    }

    const now = Date.now()
    cleanupRooms(now)
    const queryRoomCode = sanitizeRoomCode(query.roomCode ?? query.code) || DEFAULT_ROOM_CODE

    if (method === 'GET') {
      const room =
        queryRoomCode === DEFAULT_ROOM_CODE
          ? getOrCreateDefaultRoom('', 'Host', now)
          : rooms.get(queryRoomCode)
      if (!room) {
        sendNotFound(res, queryRoomCode, {
          roomCode: queryRoomCode,
          roles: {},
          claims: {},
          players: {},
        })
        return true
      }
      const prunedClaims = purgeStaleMembers(room, now)
      if (prunedClaims) broadcastRoomRoles(room)

      sendJson(res, 200, {
        ok: true,
        roomCode: room.code,
        currentMissionIndex: room.currentMissionIndex,
        missionId: room.missionId,
        launcherId: room.launcherId,
        roles: room.roles,
        claims: room.roles,
        players: room.players,
        sharedStation: room.sharedStation,
        satellites: room.satellites,
        phase: room.phase,
        room: serializeRoom(room),
        serverTime: now,
      })
      return true
    }

    if (method === 'POST') {
      readJsonBody(req, (err, parsed) => {
        if (err || !parsed) {
          sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
          return
        }
        const reqNow = Date.now()
        cleanupRooms(reqNow)
        const code = sanitizeRoomCode(parsed.roomCode ?? queryRoomCode) || DEFAULT_ROOM_CODE
        let room =
          code === DEFAULT_ROOM_CODE
            ? getOrCreateDefaultRoom(
                String(parsed.clientId ?? ''),
                String(parsed.playerName ?? 'Host'),
                reqNow
              )
            : rooms.get(code)
        if (!room && code !== DEFAULT_ROOM_CODE) {
          room = rehydrateRoomIfMissing(code, parsed, reqNow)
        }
        if (!room) {
          sendNotFound(res, code, {
            roomCode: code,
            serverTime: reqNow,
          })
          return
        }
        const prunedClaims = purgeStaleMembers(room, reqNow)

        if (parsed.action === 'reset_station' || parsed.action === 'retry_mission') {
          const nextEpoch = (room.sharedStation.retryEpoch ?? 0) + 1
          room.sharedStation = createEmptySharedStation(room.sharedStation.points, nextEpoch)
          room.sharedStation.lastUpdated = reqNow
          room.updatedAt = reqNow
          if (prunedClaims) broadcastRoomRoles(room)
          sendJson(res, 200, {
            ok: true,
            roomCode: room.code,
            currentMissionIndex: room.currentMissionIndex,
            missionId: room.missionId,
            launcherId: room.launcherId,
            phase: room.phase,
            roles: room.roles,
            claims: room.roles,
            players: room.players,
            sharedStation: room.sharedStation,
            room: serializeRoom(room),
            serverTime: reqNow,
          })
          return
        }

        const syncRes = applyStationSyncPayload(room, parsed, reqNow)
        if (!syncRes.ok) {
          sendJson(res, 400, {
            ok: false,
            code: 'ROOM_FULL',
            error: syncRes.error,
            roomCode: room.code,
            roles: room.roles,
            claims: room.roles,
            players: room.players,
            serverTime: reqNow,
          })
          return
        }
        if (prunedClaims) broadcastRoomRoles(room)
        sendJson(res, 200, {
          ok: true,
          roomCode: room.code,
          currentMissionIndex: room.currentMissionIndex,
          missionId: room.missionId,
          launcherId: room.launcherId,
          roles: room.roles,
          claims: room.roles,
          players: room.players,
          sharedStation: room.sharedStation,
          satellites: room.satellites,
          phase: room.phase,
          room: serializeRoom(room),
          serverTime: reqNow,
        })
      })
      return true
    }

    return false
  }

  const handleApiRequest = (req, res, fallbackNext) => {
    const rawUrl = req.originalUrl || req.url || '/'
    const qIdx = rawUrl.indexOf('?')
    const pathOnly = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx)
    const querySuffix = qIdx === -1 ? '' : rawUrl.slice(qIdx)

    if (pathOnly.startsWith('/api/rooms')) {
      const subPath = pathOnly.slice('/api/rooms'.length) || '/'
      if (handleRoomsRoute(req, res, `${subPath}${querySuffix}`)) return true
    } else if (pathOnly.startsWith('/api/lobby')) {
      const subPath = pathOnly.slice('/api/lobby'.length) || '/'
      if (handleLobbyRoute(req, res, `${subPath}${querySuffix}`)) return true
    } else if (pathOnly.startsWith('/api/roles-sync')) {
      const subPath = pathOnly.slice('/api/roles-sync'.length) || '/'
      if (handleRolesSyncRoute(req, res, `${subPath}${querySuffix}`)) return true
    } else if (pathOnly.startsWith('/api/station-sync')) {
      const subPath = pathOnly.slice('/api/station-sync'.length) || '/'
      if (handleStationSyncRoute(req, res, `${subPath}${querySuffix}`)) return true
    }

    if (typeof fallbackNext === 'function') {
      fallbackNext()
      return false
    }

    sendJson(res, 404, { ok: false, error: 'NOT_FOUND', path: pathOnly })
    return false
  }

  return {
    cleanupRooms,
    handleRoomsRoute,
    handleLobbyRoute,
    handleRolesSyncRoute,
    handleStationSyncRoute,
    handleApiRequest,
  }
}

export function getSharedRoomEngine(options = {}) {
  const g = globalThis
  if (!g.__CUBESAT_ROOM_ENGINE__) {
    g.__CUBESAT_ROOM_ENGINE__ = createRoomEngine(options)
  }
  return g.__CUBESAT_ROOM_ENGINE__
}
