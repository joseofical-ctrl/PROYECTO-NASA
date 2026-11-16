import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef } from 'react'
import { isMusicOn, setMusic } from '../audio'
import { ROLE_INFO } from '../game/catalog'
import type { RoleId } from '../game/catalog'
import { MISSION_CATALOG } from '../game/missions'
import type { MissionBriefingDef, MissionId } from '../game/missions'
import CharacterPortrait from './CharacterPortrait'

export type VictoryPhase =
  | 'none'
  | 'laser_cinematic'
  | 'stage_summary'
  | 'return_home_cinematic'
  | 'final_honor_roll'

interface VictoryCinematicModalProps {
  phase: Exclude<VictoryPhase, 'none'>
  missionDef: MissionBriefingDef
  nextMissionId: MissionId | null
  baseSciencePoints: number
  stationHealth: number
  resolvedCount: number
  missionTargetCount: number
  roleResolvedCounts: Record<RoleId, number>
  pilotNamesByRole: Record<RoleId, string>
  chassisName: string
  launcherName: string
  isReplayCinematic: boolean
  laserNonce: number
  returnHomeNonce: number
  onLaserNext: () => void
  onReturnHomeFinished: () => void
  onContinueNextMission: (totalScore: number) => void
  onReplayReturnHome: () => void
  onReplayLaser: () => void
  onOpenTelemetryReport: () => void
  onContinueInStation: () => void
  onExitToMenu: () => void
}

const HONOR_ROLE_ORDER: RoleId[] = ['engineer', 'comms', 'science', 'director']

const ROLE_HONOR_TITLES: Record<RoleId, string> = {
  director: '🏅 Master of Docking & Orbital Defense',
  engineer: '🏅 Core & Life Support Guardian',
  science: '🏅 Planetary Exploration Pioneer',
  comms: '🏅 Cyber Shield & Deep Space Link',
}

const MISSION_TRANSMISSION_REPORT: Record<MissionId, string> = {
  andes: '✔ 4.8 TB of Glacial Thermal Cartography transmitted to CENEPRED / NASA',
  luna: '✔ 12.4 TB of Lunar Ice Spectrometry transmitted to Artemis Base',
  sol: '✔ L1 Geomagnetic Early Warning transmitted on time — Global Power Grid Protected',
}

interface NasaRankInfo {
  label: string
  tierShort: string
  textColor: string
  borderColor: string
  bg: string
}

function getNasaOfficialRank(health: number): NasaRankInfo {
  if (health >= 90) {
    return {
      label: '★★★ RANK S+ · ANDEAN SQUADRON LEGEND',
      tierShort: 'S+',
      textColor: '#ffd23f',
      borderColor: '#facc15',
      bg: 'rgba(234, 179, 8, 0.16)',
    }
  }
  if (health >= 70) {
    return {
      label: '★★ RANK A · NASA ORBITAL COMMANDER',
      tierShort: 'A',
      textColor: '#22d3ee',
      borderColor: '#06b6d4',
      bg: 'rgba(6, 182, 212, 0.16)',
    }
  }
  return {
    label: '★ RANK B · APPROVED MISSION OFFICER',
    tierShort: 'B',
    textColor: '#34d399',
    borderColor: '#10b981',
    bg: 'rgba(16, 185, 129, 0.16)',
  }
}

export default function VictoryCinematicModal({
  phase,
  missionDef,
  nextMissionId,
  baseSciencePoints,
  stationHealth,
  resolvedCount,
  missionTargetCount,
  roleResolvedCounts,
  pilotNamesByRole,
  chassisName,
  launcherName,
  isReplayCinematic,
  laserNonce,
  returnHomeNonce,
  onLaserNext,
  onReturnHomeFinished,
  onContinueNextMission,
  onReplayReturnHome,
  onReplayLaser,
  onOpenTelemetryReport,
  onContinueInStation,
  onExitToMenu,
}: VictoryCinematicModalProps) {
  const laserIframeRef = useRef<HTMLIFrameElement | null>(null)
  const returnIframeRef = useRef<HTMLIFrameElement | null>(null)

  const playingFullscreenAudioCinematic =
    phase === 'laser_cinematic' || phase === 'return_home_cinematic'

  // Silenciar BGM de la estación durante las cinemáticas para escuchar fanfarria y efectos
  useEffect(() => {
    if (!playingFullscreenAudioCinematic) return
    const wasOn = isMusicOn()
    if (wasOn) {
      setMusic(false)
    }
    return () => {
      if (wasOn) {
        setMusic(true)
      }
    }
  }, [playingFullscreenAudioCinematic])

  // Puente postMessage desde victory_laser_transmission.html y victory_return_home.html
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string } | null
      if (!data || typeof data !== 'object') return

      if (data.type === 'VICTORY_CINEMATIC_NEXT') {
        if (
          laserIframeRef.current?.contentWindow &&
          e.source !== laserIframeRef.current.contentWindow
        ) {
          return
        }
        onLaserNext()
      } else if (data.type === 'RETURN_HOME_FINISHED') {
        if (
          returnIframeRef.current?.contentWindow &&
          e.source !== returnIframeRef.current.contentWindow
        ) {
          return
        }
        onReturnHomeFinished()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onLaserNext, onReturnHomeFinished])

  const roundedHealth = Math.max(0, Math.min(100, Math.round(stationHealth)))
  const roundedBaseScience = Math.max(0, Math.round(baseSciencePoints))
  const integrityBonus = roundedHealth * 2
  const satelliteBonus = 150
  const totalVictoryScore = roundedBaseScience + integrityBonus + satelliteBonus
  const nasaRank = useMemo(() => getNasaOfficialRank(roundedHealth), [roundedHealth])
  const transmissionReport = MISSION_TRANSMISSION_REPORT[missionDef.id]

  const laserSrc = useMemo(() => {
    const params = new URLSearchParams({
      mission: String(missionDef.number),
      code: missionDef.code,
      points: String(roundedBaseScience),
      health: String(roundedHealth),
      isFinal: missionDef.number === 3 ? '1' : '0',
      replay: isReplayCinematic ? '1' : '0',
      v: String(laserNonce),
    })
    return `${import.meta.env.BASE_URL}minigames/victory_laser_transmission.html?${params.toString()}`
  }, [
    missionDef.number,
    missionDef.code,
    roundedBaseScience,
    roundedHealth,
    isReplayCinematic,
    laserNonce,
  ])

  const returnHomeSrc = useMemo(() => {
    const params = new URLSearchParams({
      mission: String(missionDef.number),
      points: String(totalVictoryScore),
      health: String(roundedHealth),
      v: String(returnHomeNonce),
    })
    return `${import.meta.env.BASE_URL}minigames/victory_return_home.html?${params.toString()}`
  }, [missionDef.number, totalVictoryScore, roundedHealth, returnHomeNonce])

  const showReturnHomeBackdrop =
    phase === 'return_home_cinematic' || phase === 'final_honor_roll'
  const showOverlayPanel = phase === 'stage_summary' || phase === 'final_honor_roll'
  const isFinalCampaign = phase === 'final_honor_roll'

  return (
    <div
      className="fixed inset-0 z-[180] bg-black/95 flex items-center justify-center overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Official NASA Victory Cinematic"
      style={{ fontFamily: '"Press Start 2P", monospace' }}
    >
      {/* Escena A: Transmisión Láser Orbital 32x32 */}
      {phase === 'laser_cinematic' && (
        <iframe
          key={`laser-${laserNonce}`}
          ref={laserIframeRef}
          src={laserSrc}
          title="32x32 Orbital Laser Transmission Cinematic"
          className="absolute inset-0 w-full h-full border-0"
        />
      )}

      {/* Escena B: Misión Águila · Regreso a Casa (permanece detrás del Cuadro de Honor Final) */}
      {showReturnHomeBackdrop && (
        <iframe
          key={`return-${returnHomeNonce}`}
          ref={returnIframeRef}
          src={returnHomeSrc}
          title="Eagle Mission · Return Home"
          className="absolute inset-0 w-full h-full border-0"
        />
      )}

      {/* Panel Superpuesto de Resumen de Etapa o Gran Victoria Final / Cuadro de Honor NASA */}
      <AnimatePresence>
        {showOverlayPanel && (
          <motion.div
            key={`panel-${phase}`}
            className="relative z-20 w-full h-full overflow-y-auto flex items-center justify-center p-2.5 sm:p-4"
            style={{
              background: isFinalCampaign
                ? 'rgba(4, 9, 24, 0.72)'
                : 'rgba(3, 6, 18, 0.90)',
              backdropFilter: 'blur(3px)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="mc-panel w-full max-w-4xl p-3.5 sm:p-5 text-center border-4 my-auto"
              style={{
                borderColor: isFinalCampaign ? '#facc15' : '#34d399',
                background: isFinalCampaign
                  ? 'linear-gradient(180deg, rgba(12, 22, 48, 0.94) 0%, rgba(5, 10, 24, 0.96) 100%)'
                  : 'linear-gradient(180deg, #091226 0%, #050814 100%)',
                boxShadow: isFinalCampaign
                  ? '0 0 42px rgba(250, 204, 21, 0.42)'
                  : '0 0 36px rgba(16, 185, 129, 0.35)',
              }}
              initial={{ scale: 0.9, y: 18 }}
              animate={{ scale: 1, y: 0 }}
            >
              {/* Cabecera de Etapa / Gran Victoria */}
              <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
                <span
                  className="inline-block px-2.5 py-1 border text-[8px] sm:text-[9px] font-bold tracking-wider"
                  style={{
                    borderColor: isFinalCampaign ? '#fde047' : '#34d399',
                    color: isFinalCampaign ? '#fef08a' : '#6ee7b7',
                    background: isFinalCampaign
                      ? 'rgba(113, 63, 18, 0.65)'
                      : 'rgba(6, 78, 59, 0.75)',
                  }}
                >
                  {isFinalCampaign
                    ? '🏆 GRAND FINAL VICTORY · NASA HONOR ROLL · CAMPAIGN 3/3'
                    : `MISSION STAGE COMPLETE · STAGE ${missionDef.number} OF 3`}
                </span>
                <span
                  className="inline-block px-2.5 py-1 border text-[8px] sm:text-[9px] font-bold"
                  style={{
                    borderColor: nasaRank.borderColor,
                    color: nasaRank.textColor,
                    background: nasaRank.bg,
                  }}
                >
                  {nasaRank.label}
                </span>
              </div>

              <div
                className="text-[11px] sm:text-sm font-bold leading-snug"
                style={{
                  color: isFinalCampaign ? '#fef08a' : '#6ee7b7',
                  textShadow: '2px 2px 0 #000',
                }}
              >
                {isFinalCampaign
                  ? `🦅 WELCOME HOME, ANDEAN SQUADRON! · ${missionDef.code}`
                  : `✅ MISSION ${missionDef.number} COMPLETE: ${missionDef.code}`}
              </div>

              <div className="text-[8px] sm:text-[9px] text-cyan-200 mt-1">
                {missionDef.title} · {resolvedCount}/{missionTargetCount} Critical Consoles Stabilized ·{' '}
                {chassisName} / {launcherName}
              </div>

              {/* Telemetría Real Transmitida */}
              <div className="mt-2.5 px-3 py-2 bg-emerald-950/60 border border-emerald-400/70 text-[8.5px] sm:text-[10px] text-emerald-200 font-bold leading-relaxed">
                {transmissionReport}
              </div>

              {/* Desglose de Puntuación Oficial NASA */}
              <div className="mt-3 bg-[#080d1e]/90 border-2 border-slate-700 p-2.5 sm:p-3 text-left">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-[8px] sm:text-[9px] text-cyan-300 font-bold">
                    📊 MISSION SCORE BREAKDOWN &amp; BONUSES:
                  </span>
                  <span className="text-[9px] sm:text-[11px] text-yellow-300 font-bold">
                    TOTAL: {totalVictoryScore} PTS
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="p-2 bg-[#101730] border border-cyan-500/40">
                    <div className="text-[7.5px] text-cyan-300">📡 Mission Base Science</div>
                    <div className="text-[10px] sm:text-xs font-bold text-white mt-1">
                      +{roundedBaseScience} PTS
                    </div>
                    <div className="text-[7px] text-slate-400 mt-0.5">
                      {resolvedCount}/{missionTargetCount} consoles resolved
                    </div>
                  </div>
                  <div className="p-2 bg-[#101730] border border-emerald-500/40">
                    <div className="text-[7.5px] text-emerald-300">
                      🛡️ Orbital Integrity Bonus
                    </div>
                    <div className="text-[10px] sm:text-xs font-bold text-emerald-300 mt-1">
                      +{integrityBonus} PTS
                    </div>
                    <div className="text-[7px] text-slate-400 mt-0.5">
                      Station Integrity: {roundedHealth}% × 2
                    </div>
                  </div>
                  <div className="p-2 bg-[#101730] border border-amber-400/45">
                    <div className="text-[7.5px] text-amber-300">
                      ⚡ Satellite Efficiency Bonus
                    </div>
                    <div className="text-[10px] sm:text-xs font-bold text-yellow-300 mt-1">
                      +{satelliteBonus} PTS
                    </div>
                    <div className="text-[7px] text-slate-400 mt-0.5">
                      SAT-01 AMARU-COMMS &amp; SAT-02 INTI-SCIENCE active
                    </div>
                  </div>
                </div>
              </div>

              {/* Cuadro de Honor por Especialista (4 Astronautas con Sprite) */}
              <div className="mt-3 bg-[#070b18]/90 border-2 border-slate-800 p-2.5 text-left">
                <div className="text-[8px] sm:text-[9px] text-yellow-300 font-bold mb-2">
                  🏅 ANDEAN SQUADRON SPECIALIST HONOR ROLL:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {HONOR_ROLE_ORDER.map((r) => {
                    const rInfo = ROLE_INFO[r]
                    const solvedByRole = roleResolvedCounts[r] ?? 0
                    const pilotName = pilotNamesByRole[r] || rInfo.animalName
                    return (
                      <div
                        key={r}
                        className="p-2 border-2 bg-[#0d142a] flex items-center gap-2 min-w-0"
                        style={{ borderColor: rInfo.color }}
                      >
                        <div className="shrink-0 border border-black/80 bg-[#070b18]">
                          <CharacterPortrait characterId={r} variant="avatar" size={40} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div
                            className="text-[8px] font-bold truncate"
                            style={{ color: rInfo.color }}
                          >
                            {rInfo.icon} {rInfo.animalName}
                          </div>
                          <div className="text-[7.5px] text-white font-bold truncate mt-0.5">
                            {pilotName}
                          </div>
                          <div className="text-[6.8px] text-amber-200 leading-tight mt-0.5">
                            {ROLE_HONOR_TITLES[r]}
                          </div>
                          <div className="text-[7.5px] font-bold text-emerald-300 mt-1">
                            ✔ {solvedByRole} EMERGENCIES
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Vista previa siguiente etapa (solo Etapa 1 o Etapa 2) */}
              {!isFinalCampaign && nextMissionId && (
                <div className="mt-3 p-2.5 bg-indigo-950/60 border border-indigo-400/70 text-left">
                  <div className="text-[8px] text-indigo-300 font-bold">
                    🔭 NEXT CAMPAIGN STAGE UNLOCKED:
                  </div>
                  <div className="text-[9px] sm:text-[10px] text-white font-bold mt-0.5">
                    MISSION {MISSION_CATALOG[nextMissionId].number}:{' '}
                    {MISSION_CATALOG[nextMissionId].code} — {MISSION_CATALOG[nextMissionId].title}
                  </div>
                  <div className="text-[7.5px] text-cyan-200 mt-0.5">
                    Goal: {MISSION_CATALOG[nextMissionId].targetResolutions} anomalies (Level{' '}
                    {MISSION_CATALOG[nextMissionId].difficulty}) ·{' '}
                    {MISSION_CATALOG[nextMissionId].orbitBadge}
                  </div>
                </div>
              )}

              {/* Botones de Acción */}
              {!isFinalCampaign ? (
                <div className="flex flex-wrap justify-center gap-2 mt-3.5">
                  {nextMissionId && (
                    <button
                      onClick={() => onContinueNextMission(totalVictoryScore)}
                      className="mc-btn px-4 py-2.5 text-[9.5px] sm:text-[10px] font-bold"
                      style={{
                        background: 'linear-gradient(180deg, #22c55e 0%, #15803d 100%)',
                        borderColor: '#86efac',
                        color: '#ffffff',
                        boxShadow: '0 0 18px rgba(34,197,94,0.55)',
                      }}
                    >
                      [ 🚀 CONTINUE TO NEXT MISSION ]
                    </button>
                  )}
                  <button
                    onClick={onReplayLaser}
                    className="mc-btn px-3 py-2 text-[8.5px]"
                    style={{ color: '#67e8f9' }}
                  >
                    📡 REPLAY LASER LINK
                  </button>
                  <button
                    onClick={onOpenTelemetryReport}
                    className="mc-btn px-3 py-2 text-[8.5px]"
                    style={{ color: '#5ef0ff' }}
                  >
                    📊 NASA TELEMETRY
                  </button>
                  <button
                    onClick={onContinueInStation}
                    className="mc-btn px-3 py-2 text-[8.5px]"
                  >
                    🛰️ STAY ON STATION
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap justify-center gap-2 mt-3.5">
                  <button
                    onClick={onReplayReturnHome}
                    className="mc-btn px-3.5 py-2.5 text-[8.5px] sm:text-[9px] font-bold"
                    style={{
                      background: 'linear-gradient(180deg, #0284c7 0%, #1e3a8a 100%)',
                      borderColor: '#7dd3fc',
                      color: '#ffffff',
                    }}
                  >
                    [ 🎬 REPLAY RETURN HOME CINEMATIC ]
                  </button>
                  <button
                    onClick={onReplayLaser}
                    className="mc-btn px-3.5 py-2.5 text-[8.5px] sm:text-[9px] font-bold"
                    style={{
                      background: 'linear-gradient(180deg, #0f766e 0%, #134e4a 100%)',
                      borderColor: '#5eead4',
                      color: '#ecfeff',
                    }}
                  >
                    [ 📡 REPLAY 32x32 LASER TRANSMISSION ]
                  </button>
                  <button
                    onClick={onOpenTelemetryReport}
                    className="mc-btn px-3.5 py-2.5 text-[8.5px] sm:text-[9px] font-bold"
                    style={{
                      background: 'linear-gradient(180deg, #6d28d9 0%, #4c1d95 100%)',
                      borderColor: '#c4b5fd',
                      color: '#ffffff',
                    }}
                  >
                    [ 📊 OPEN NASA ENGINEERING REPORT ]
                  </button>
                  <button
                    onClick={onExitToMenu}
                    className="mc-btn px-4 py-2.5 text-[9px] sm:text-[9.5px] font-bold"
                    style={{
                      background: 'linear-gradient(180deg, #eab308 0%, #a16207 100%)',
                      borderColor: '#fef08a',
                      color: '#ffffff',
                      boxShadow: '0 0 18px rgba(234,179,8,0.5)',
                    }}
                  >
                    [ 🏆 NEW GAME / RETURN TO MENU ]
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
