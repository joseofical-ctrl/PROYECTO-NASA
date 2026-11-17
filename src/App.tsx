import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import SpaceCanvas from './components/SpaceCanvas'
import Logo from './components/Logo'
import McButton from './components/McButton'
import MissionLobbyScreen from './components/MissionLobbyScreen'
import MissionBriefingScreen from './components/MissionBriefingScreen'
import RoleWorkshopScreen from './components/RoleWorkshopScreen'
import LaunchDockingCutscene from './components/LaunchDockingCutscene'
import StationOperationScreen from './components/StationOperationScreen'
import OrbitalSimulationScreen from './components/OrbitalSimulationScreen'
import { CHARACTER_ORDER } from './game/catalog'
import type { RoleId } from './game/catalog'
import {
  MISSION_CATALOG,
  resolveCompatibleLauncher,
  sanitizeMissionId,
} from './game/missions'
import type { MissionId } from './game/missions'
import {
  advanceRoomNextMission,
  createMultiplayerRoom,
  fetchRoomByCode,
  findMyRoleInRoom,
  getDefaultPlayerName,
  getOrCreateClientId,
  leaveMultiplayerRoom,
  postRoomAction,
  savePlayerName,
  sendLeaveBeacon,
  sendRoomHeartbeat,
} from './game/multiplayer'
import type { RoomSnapshot } from './game/multiplayer'
import { actions } from './game/store'
import { isMusicOn, playClick, playHover, playIntroSweep, setMusic, unlockAudio } from './audio'

type ScreenStage = 'menu' | 'briefing' | 'workshop' | 'cutscene' | 'station' | 'orbit'
type MenuSubView = 'home' | 'join' | 'room'

export default function App() {
  const [started, setStarted] = useState(false) // audio unlocked after first interaction
  const [showButtons, setShowButtons] = useState(false)
  const [music, setMusicState] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [stage, setStage] = useState<ScreenStage>('menu')
  const [menuSubView, setMenuSubView] = useState<MenuSubView>('home')
  const [creatingRoom, setCreatingRoom] = useState(false)

  const clientId = useMemo(() => getOrCreateClientId(), [])
  const [playerName, setPlayerName] = useState<string>(() => getDefaultPlayerName(clientId))
  const [room, setRoom] = useState<RoomSnapshot | null>(null)

  const [workshop, setWorkshop] = useState<{
    assignments: (RoleId | null)[]
    startRole: RoleId
    playerNames: Record<RoleId, string>
  }>({
    assignments: ['director', null, null, null],
    startRole: 'director',
    playerNames: {
      engineer: 'Player 1',
      comms: 'Player 2',
      science: 'Player 3',
      director: 'Player 4',
    },
  })

  const notify = useCallback((m: string) => {
    setToast(m)
    window.setTimeout(() => setToast(null), 2600)
  }, [])

  const handlePlayerNameChange = useCallback((name: string) => {
    const clipped = name.slice(0, 18)
    setPlayerName(clipped)
    savePlayerName(clipped)
  }, [])

  // Browsers block audio until a gesture: first click/key triggers the intro sweep.
  useEffect(() => {
    if (started) return
    const go = () => {
      unlockAudio()
      playIntroSweep()
      setMusic(true)
      setMusicState(true)
      setStarted(true)
    }
    window.addEventListener('pointerdown', go, { once: true })
    window.addEventListener('keydown', go, { once: true })
    return () => {
      window.removeEventListener('pointerdown', go)
      window.removeEventListener('keydown', go)
    }
  }, [started])

  const onLogoDone = useCallback(() => setShowButtons(true), [])

  const toggleMusic = () => {
    unlockAudio()
    const next = !isMusicOn()
    setMusic(next)
    setMusicState(next)
    playClick()
  }

  const roomCode = room?.code ?? null
  const myRoomRole = useMemo(() => findMyRoleInRoom(room, clientId), [room, clientId])

  const playerNameRef = useRef(playerName)
  playerNameRef.current = playerName
  const stageRef = useRef(stage)
  stageRef.current = stage
  const roomCodeRef = useRef<string | null>(roomCode)
  roomCodeRef.current = roomCode

  const applyRoomSnapshot = useCallback(
    (nextRoom: RoomSnapshot) => {
      setRoom(nextRoom)
      const myRole = findMyRoleInRoom(nextRoom, clientId)
      if (!myRole) return

      const names: Record<RoleId, string> = {
        engineer: nextRoom.roles?.engineer?.playerName ?? 'Player 1',
        comms: nextRoom.roles?.comms?.playerName ?? 'Player 2',
        science: nextRoom.roles?.science?.playerName ?? 'Player 3',
        director: nextRoom.roles?.director?.playerName ?? 'Player 4',
      }
      const assign: (RoleId | null)[] = CHARACTER_ORDER.map((r) =>
        nextRoom.roles?.[r] ? r : null
      )

      setWorkshop({
        assignments: assign,
        startRole: myRole,
        playerNames: names,
      })

      if (
        nextRoom.phase === 'MISSION_BRIEFING' &&
        (stageRef.current === 'menu' ||
          stageRef.current === 'station' ||
          stageRef.current === 'orbit' ||
          stageRef.current === 'workshop')
      ) {
        setStage('briefing')
        const stDef = MISSION_CATALOG[sanitizeMissionId(nextRoom.missionId)]
        notify(`🧭 Room ${nextRoom.code}: Stage ${nextRoom.currentMissionIndex ?? stDef.number}/3 · ${stDef.code}`)
      } else if (
        nextRoom.phase === 'WORKSHOP' &&
        (stageRef.current === 'menu' || stageRef.current === 'briefing')
      ) {
        setStage('workshop')
        const mCode = MISSION_CATALOG[sanitizeMissionId(nextRoom.missionId)].code
        notify(`🚀 Room ${nextRoom.code}: Entering Assembly Workshop · ${mCode}`)
      } else if (
        nextRoom.phase === 'LAUNCH' &&
        (stageRef.current === 'workshop' || stageRef.current === 'briefing')
      ) {
        setStage('cutscene')
        notify(`🔥 Room ${nextRoom.code}: Synchronized Liftoff!`)
      } else if (
        nextRoom.phase === 'STATION' &&
        (stageRef.current === 'cutscene' || stageRef.current === 'briefing')
      ) {
        setStage('station')
      }
    },
    [clientId, notify]
  )

  const handleCreateRoomFromMenu = async () => {
    if (creatingRoom) return
    setCreatingRoom(true)
    try {
      const created = await createMultiplayerRoom(clientId, playerName)
      roomCodeRef.current = created.code
      setRoom(created)
      setMenuSubView('room')
      notify(`Room created: ${created.code} — Select your astronaut specialist`)
    } catch {
      notify('Could not create multiplayer room')
    } finally {
      setCreatingRoom(false)
    }
  }

  // Send immediate leave beacon via navigator.sendBeacon if tab closes or reloads
  useEffect(() => {
    if (!roomCode) return
    const handleUnload = () => {
      if (roomCodeRef.current) {
        sendLeaveBeacon(roomCodeRef.current, clientId, playerNameRef.current)
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [roomCode, clientId])

  const handleRemoteRoomClosed = useCallback(
    (msg = 'Room has been closed') => {
      roomCodeRef.current = null
      setRoom(null)
      setMenuSubView('join')
      if (stageRef.current !== 'menu') {
        setStage('menu')
      }
      setShowButtons(true)
      notify(msg)
    },
    [notify]
  )

  // Room polling (500 ms) + strict heartbeat (1.5 s) across Lobby, Workshop, Cutscene & Orbit
  useEffect(() => {
    if (!roomCode || stage === 'station') return
    let cancelled = false

    const pollRoom = async () => {
      try {
        const fresh = await fetchRoomByCode(roomCode)
        if (!cancelled && roomCodeRef.current === roomCode) {
          if (fresh) {
            applyRoomSnapshot(fresh)
          } else {
            handleRemoteRoomClosed('Room has been closed')
          }
        }
      } catch {
        // retry automatically on next tick
      }
    }

    const pollTimer = window.setInterval(() => {
      void pollRoom()
    }, 500)

    const hbTimer = window.setInterval(() => {
      void sendRoomHeartbeat(
        roomCode,
        clientId,
        playerNameRef.current.trim() || getDefaultPlayerName(clientId)
      )
        .then((res) => {
          if (cancelled || roomCodeRef.current !== roomCode) return
          if (res.deleted || (res.status === 400 && res.code === 'ROOM_FULL')) {
            handleRemoteRoomClosed(res.error || 'Room has been closed')
            return
          }
          if (res.room) applyRoomSnapshot(res.room)
        })
        .catch(() => {})
    }, 1500)

    let bc: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('cubesat_multiplayer_sync')
        bc.onmessage = (ev) => {
          const d = ev.data as { type?: string; room?: RoomSnapshot; code?: string } | null
          if (!d || typeof d !== 'object' || cancelled || roomCodeRef.current !== roomCode) return
          if (d.type === 'room_update' && d.room?.code === roomCode) {
            applyRoomSnapshot(d.room)
          } else if (d.type === 'room_deleted' && d.code === roomCode) {
            handleRemoteRoomClosed('Room has been closed')
          }
        }
      }
    } catch {
      // optional BroadcastChannel
    }

    return () => {
      cancelled = true
      window.clearInterval(pollTimer)
      window.clearInterval(hbTimer)
      bc?.close()
    }
  }, [roomCode, stage, clientId, applyRoomSnapshot, handleRemoteRoomClosed])

  const exitRoomToMenu = useCallback(async () => {
    const codeToLeave = roomCodeRef.current
    roomCodeRef.current = null
    setRoom(null)
    actions.setContract('andes')
    actions.setLauncher('rideshare')
    setMenuSubView('home')
    setShowButtons(true)
    setStage('menu')
    if (codeToLeave) {
      await leaveMultiplayerRoom(codeToLeave, clientId, playerNameRef.current)
    }
  }, [clientId])

  const handleCutsceneComplete = useCallback(async () => {
    if (roomCode) {
      try {
        const res = await postRoomAction(roomCode, {
          action: 'set_phase',
          clientId,
          playerName: playerNameRef.current,
          phase: 'STATION',
        })
        if (res.room) setRoom(res.room)
      } catch {
        // continuar transición local
      }
    }
    setStage('station')
  }, [roomCode, clientId])

  const handleBackToWorkshop = useCallback(async () => {
    if (roomCode) {
      try {
        const fresh = await fetchRoomByCode(roomCode)
        if (fresh) setRoom(fresh)
      } catch {
        // mantener último estado
      }
    }
    setStage('workshop')
  }, [roomCode])

  const handleAdvanceNextMission = useCallback(
    async (nextMissionId: MissionId, keepPoints?: number) => {
      const mDef = MISSION_CATALOG[nextMissionId]
      const validLauncher = resolveCompatibleLauncher(nextMissionId, mDef.defaultLauncherId)
      actions.setContract(nextMissionId)
      actions.setLauncher(validLauncher)
      if (roomCode) {
        try {
          const res = await advanceRoomNextMission(
            roomCode,
            clientId,
            playerNameRef.current,
            nextMissionId,
            { launcherId: validLauncher, targetPhase: 'MISSION_BRIEFING', keepPoints }
          )
          if (res.room) applyRoomSnapshot(res.room)
        } catch {
          // continuar localmente
        }
      }
      notify(`🚀 Unlocked Stage ${mDef.number}/3: ${mDef.code} (Level ${mDef.difficulty})`)
    },
    [roomCode, clientId, applyRoomSnapshot, notify]
  )

  return (
    <div className="relative w-full h-full overflow-hidden text-white">
      {stage === 'briefing' && (
        <MissionBriefingScreen
          room={room}
          clientId={clientId}
          playerName={playerName}
          myRole={myRoomRole}
          onRoomUpdated={applyRoomSnapshot}
          onBackToMenu={() => void exitRoomToMenu()}
          onNotify={notify}
        />
      )}

      {stage === 'workshop' && (
        <RoleWorkshopScreen
          assignments={workshop.assignments}
          startRole={workshop.startRole}
          playerNames={workshop.playerNames}
          roomCode={roomCode}
          clientId={clientId}
          playerName={playerName}
          roomSnapshot={room}
          assignedRole={myRoomRole}
          onRoomUpdated={applyRoomSnapshot}
          onExit={() => void exitRoomToMenu()}
          onAuthorizedLaunch={() => setStage('cutscene')}
        />
      )}

      {stage === 'cutscene' && (
        <LaunchDockingCutscene
          onComplete={() => void handleCutsceneComplete()}
          onBackToWorkshop={() => void handleBackToWorkshop()}
        />
      )}

      {stage === 'station' && (
        <StationOperationScreen
          roomCode={roomCode}
          missionId={room?.missionId}
          clientIdOverride={clientId}
          initialAssignedRole={myRoomRole}
          initialPlayerName={playerName}
          initialRoleClaims={room?.roles}
          onRoomUpdated={applyRoomSnapshot}
          onAdvanceMission={(nextId, keepPts) => void handleAdvanceNextMission(nextId, keepPts)}
          onBackToWorkshop={() => void handleBackToWorkshop()}
          onReplayCutscene={() => setStage('cutscene')}
          onOpenTelemetryReport={() => setStage('orbit')}
          onExitToMenu={() => void exitRoomToMenu()}
          onRoomClosed={() => handleRemoteRoomClosed('Room has been closed')}
        />
      )}

      {stage === 'orbit' && (
        <OrbitalSimulationScreen
          onBackToWorkshop={() => void handleBackToWorkshop()}
          onReplayCutscene={() => setStage('station')}
          onExitToMenu={() => void exitRoomToMenu()}
        />
      )}

      {stage === 'menu' && (
        <>
          <SpaceCanvas />
          <div
            className="fixed inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.65) 100%)',
            }}
          />

          <button
            onClick={toggleMusic}
            onMouseEnter={playHover}
            className="mc-btn fixed top-3 right-3 z-40 p-2.5 flex items-center gap-2 text-[9px]"
            aria-label="Music toggle"
          >
            {music ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span className="hidden sm:inline">{music ? 'MUSIC ON' : 'MUSIC OFF'}</span>
          </button>

          {menuSubView === 'home' ? (
            <main className="relative z-10 h-full flex flex-col items-center justify-start pt-[5vh] px-4 gap-4 sm:gap-6">
              <Logo onLogoDone={onLogoDone} />

              {showButtons && (
                <div className="w-full max-w-xl flex flex-col gap-3.5 mt-4 relative z-10">
                  <McButton
                    delay={0}
                    className="w-full py-4 text-[11px] sm:text-xs"
                    onClick={() => {
                      setRoom(null)
                      setMenuSubView('join')
                    }}
                  >
                    🌐 MULTIPLAYER (JOIN ROOM)
                  </McButton>
                  <McButton
                    delay={0.12}
                    className="w-full py-3.5 text-[10px] sm:text-[11px]"
                    onClick={() => void handleCreateRoomFromMenu()}
                  >
                    {creatingRoom ? '⏳ CREATING ROOM...' : '+ CREATE ROOM'}
                  </McButton>
                  <div className="grid grid-cols-2 gap-3.5">
                    <McButton
                      delay={0.24}
                      className="py-3.5 px-2 text-[9px] sm:text-[10px]"
                      onClick={() => notify('Free Sandbox mode: coming soon')}
                    >
                      🛠️ FREE SANDBOX
                    </McButton>
                    <McButton
                      delay={0.36}
                      className="py-3.5 px-2 text-[9px] sm:text-[10px]"
                      onClick={() => notify('NASA Open Data & Credits: coming soon')}
                    >
                      📡 NASA DATA &amp; CREDITS
                    </McButton>
                  </div>
                </div>
              )}

              {!started && (
                <motion.p
                  className="absolute bottom-6 text-[9px] text-gray-300"
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                >
                  CLICK ANYWHERE TO ENABLE AUDIO
                </motion.p>
              )}
            </main>
          ) : (
            <main className="relative z-10 h-full overflow-y-auto flex flex-col items-center justify-start pt-[3vh] pb-12 px-3">
              <MissionLobbyScreen
                view={menuSubView}
                clientId={clientId}
                playerName={playerName}
                onChangePlayerName={handlePlayerNameChange}
                room={room}
                onEnterRoom={(r) => {
                  roomCodeRef.current = r.code
                  setMenuSubView('room')
                  applyRoomSnapshot(r)
                }}
                onBackToMenu={() => void exitRoomToMenu()}
                onNotify={notify}
              />
            </main>
          )}
        </>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            className="mc-panel fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 text-[9px] text-yellow-200 max-w-[92vw] text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {stage === 'menu' && (
        <div className="fixed bottom-2 left-3 text-[9px] text-gray-400 z-10 pointer-events-none">
          CubeSat Architect v0.1 · NASA Space Apps 2026
        </div>
      )}
    </div>
  )
}
