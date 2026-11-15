import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import SpaceCanvas from './components/SpaceCanvas'
import Logo from './components/Logo'
import McButton from './components/McButton'
import SquadModal from './components/SquadModal'
import RoleWorkshopScreen from './components/RoleWorkshopScreen'
import LaunchDockingCutscene from './components/LaunchDockingCutscene'
import StationOperationScreen from './components/StationOperationScreen'
import OrbitalSimulationScreen from './components/OrbitalSimulationScreen'
import { ROLE_INFO } from './game/catalog'
import type { RoleId } from './game/catalog'
import { actions } from './game/store'
import { isMusicOn, playClick, playHover, playIntroSweep, setMusic, unlockAudio } from './audio'

type ScreenStage = 'menu' | 'workshop' | 'cutscene' | 'station' | 'orbit'

export default function App() {
  const [started, setStarted] = useState(false) // audio unlocked after first interaction
  const [showButtons, setShowButtons] = useState(false)
  const [music, setMusicState] = useState(false)
  const [squadMode, setSquadMode] = useState<null | 'solo' | 'squad'>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [stage, setStage] = useState<ScreenStage>('menu')
  const [workshop, setWorkshop] = useState<{
    assignments: (RoleId | null)[]
    startRole: RoleId
    playerNames: Record<RoleId, string>
  }>({
    assignments: ['director', null, null, null],
    startRole: 'director',
    playerNames: {
      engineer: 'Jugador 1',
      comms: 'Jugador 2',
      science: 'Jugador 3',
      director: 'Jugador 4',
    },
  })

  const notify = (m: string) => {
    setToast(m)
    window.setTimeout(() => setToast(null), 2600)
  }

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

  return (
    <div className="relative w-full h-full overflow-hidden text-white">
      {stage === 'workshop' && (
        <RoleWorkshopScreen
          assignments={workshop.assignments}
          startRole={workshop.startRole}
          playerNames={workshop.playerNames}
          onExit={() => setStage('menu')}
          onAuthorizedLaunch={() => setStage('cutscene')}
        />
      )}

      {stage === 'cutscene' && (
        <LaunchDockingCutscene
          onComplete={() => setStage('station')}
          onBackToWorkshop={() => setStage('workshop')}
        />
      )}

      {stage === 'station' && (
        <StationOperationScreen
          onBackToWorkshop={() => setStage('workshop')}
          onReplayCutscene={() => setStage('cutscene')}
          onOpenTelemetryReport={() => setStage('orbit')}
          onExitToMenu={() => setStage('menu')}
        />
      )}

      {stage === 'orbit' && (
        <OrbitalSimulationScreen
          onBackToWorkshop={() => setStage('workshop')}
          onReplayCutscene={() => setStage('station')}
          onExitToMenu={() => setStage('menu')}
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
            aria-label="Música"
          >
            {music ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span className="hidden sm:inline">{music ? 'MÚSICA ON' : 'MÚSICA OFF'}</span>
          </button>

          <main className="relative z-10 h-full flex flex-col items-center justify-start pt-[5vh] px-4 gap-4 sm:gap-6">
            <Logo onLogoDone={onLogoDone} />

            {showButtons && (
              <div className="w-full max-w-xl flex flex-col gap-3.5 mt-4 relative z-10">
                <McButton
                  delay={0}
                  className="w-full py-4 text-[11px] sm:text-xs"
                  onClick={() => setSquadMode('solo')}
                >
                  ▶ JUGAR MISIÓN (1 JUGADOR)
                </McButton>
                <McButton
                  delay={0.12}
                  className="w-full py-3.5 text-[10px] sm:text-[11px]"
                  onClick={() => setSquadMode('squad')}
                >
                  👥 MODO ESCUADRÓN (1-4 JUGADORES / ROLES)
                </McButton>
                <div className="grid grid-cols-2 gap-3.5">
                  <McButton
                    delay={0.24}
                    className="py-3.5 px-2 text-[9px] sm:text-[10px]"
                    onClick={() => notify('Sandbox libre: próximamente')}
                  >
                    🛠️ SANDBOX LIBRE
                  </McButton>
                  <McButton
                    delay={0.36}
                    className="py-3.5 px-2 text-[9px] sm:text-[10px]"
                    onClick={() => notify('Datos NASA & Créditos: próximamente')}
                  >
                    📡 DATOS NASA & CRÉDITOS
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
                HAZ CLIC PARA ACTIVAR EL AUDIO
              </motion.p>
            )}
          </main>
        </>
      )}

      <SquadModal
        open={squadMode !== null}
        mode={squadMode ?? 'squad'}
        onClose={() => setSquadMode(null)}
        onStart={(assignments, startRole, playerNames) => {
          setSquadMode(null)
          actions.initWorkshop(assignments, startRole, playerNames)
          setWorkshop({ assignments, startRole, playerNames })
          setStage('workshop')
          const activeSummary = assignments
            .filter((r): r is RoleId => r !== null)
            .map((r) => `${ROLE_INFO[r].icon} ${ROLE_INFO[r].code} (${playerNames[r]})`)
          notify(`Escuadrón en hangar: ${activeSummary.join(' · ')}`)
        }}
      />

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
