import type { RoleId } from './catalog'
import type { MinigameId } from '../components/minigames/MinigameFrame'

export type MissionId = 'andes' | 'luna' | 'sol'
export type LauncherId = 'rideshare' | 'light' | 'heavy'

export const MISSION_ORDER: MissionId[] = ['andes', 'luna', 'sol']
export const LAUNCHER_ORDER: LauncherId[] = ['rideshare', 'light', 'heavy']

export interface MissionBriefingDef {
  id: MissionId
  number: 1 | 2 | 3
  code: string
  orbitBadge: string
  stars: string
  levelLabel: string
  title: string
  subtitle: string
  budgetDisplay: string
  sciGoalDisplay: string
  radiationDisplay: string
  difficulty: 1 | 2 | 3
  defaultLauncherId: LauncherId
  compatibleLaunchers: LauncherId[]
  mandatoryLabels: string[]
  stationMinigames: MinigameId[]
  targetResolutions: 4 | 6 | 8
  defaultAmbientEvent: 'none' | 'solar_storm'
  roleProblems: Record<RoleId, string>
  accentColor: string
}

export interface LauncherBriefingDef {
  id: LauncherId
  name: string
  orbitTag: string
  costDisplay: string
  payloadDisplay: string
  sciBonusDisplay: string
  compatibleMissions: MissionId[]
  desc: string
  accentColor: string
}

export const MISSION_CATALOG: Record<MissionId, MissionBriefingDef> = {
  andes: {
    id: 'andes',
    number: 1,
    code: 'ANDES-CRYO-01',
    orbitBadge: 'LEO POLAR ORBIT',
    stars: '★',
    levelLabel: 'LEVEL 1 · CADET',
    title: 'Andean Glacier & Water Stress Monitoring',
    subtitle:
      'Thermal cartography and EPS power regulation in low polar orbit over the Andes mountain range.',
    budgetDisplay: '$650,000',
    sciGoalDisplay: '65 PTS',
    radiationDisplay: '18 krad',
    difficulty: 1,
    defaultLauncherId: 'rideshare',
    compatibleLaunchers: ['rideshare', 'light', 'heavy'],
    mandatoryLabels: ['+ Multispectral / Thermal IR Camera'],
    stationMinigames: ['dock', 'eps', 'nav', 'telecom'],
    targetResolutions: 4,
    defaultAmbientEvent: 'none',
    roleProblems: {
      director: '6-DOF APAS Space Docking (Level 1)',
      engineer: 'EPS Electrical Power Distribution (Level 1)',
      science: 'SAT-02 Hohmann Orbital Navigation (Level 1)',
      comms: 'DSN Telemetry & Telecom Tuning (Level 1)',
    },
    accentColor: '#38bdf8',
  },
  luna: {
    id: 'luna',
    number: 2,
    code: 'ARTEMIS-LUNAR-ICE',
    orbitBadge: 'LUNAR LLO ORBIT',
    stars: '★★',
    levelLabel: 'LEVEL 2 · COMMANDER',
    title: 'Lunar South Pole Ice Mapping',
    subtitle:
      'Translunar injection, deep-space cyber defense, and precision lunar probe landing inside polar craters.',
    budgetDisplay: '$1,450,000',
    sciGoalDisplay: '110 PTS',
    radiationDisplay: '55 krad',
    difficulty: 2,
    defaultLauncherId: 'light',
    compatibleLaunchers: ['light', 'heavy'],
    mandatoryLabels: [
      '+ Neutron Spectrometer',
      '+ High-Gain Antenna (HGA)',
    ],
    stationMinigames: ['comet', 'gyro', 'eclss', 'reactor', 'lander', 'spectro', 'cyber', 'hga'],
    targetResolutions: 6,
    defaultAmbientEvent: 'none',
    roleProblems: {
      director: 'Orbital Meteor Defense + 3D Gyroscope Calibration (Level 2)',
      engineer: 'ECLSS O₂ Life Support + Reactor Cooling Loop (Level 2)',
      science: 'Lunar Probe Landing + Mass Spectrometry (Level 2)',
      comms: 'Firewall 8080 Cyber Defense + High-Gain DSN Alignment (Level 2)',
    },
    accentColor: '#a78bfa',
  },
  sol: {
    id: 'sol',
    number: 3,
    code: 'HELIOS-SENTINEL-L1',
    orbitBadge: 'SUN-EARTH L1',
    stars: '★★★',
    levelLabel: 'LEVEL 3 · NASA LEGEND',
    title: 'Early Solar Storm Warning',
    subtitle:
      'Extreme deep-space operations at Sun-Earth L1 under geomagnetic storm conditions with all 8 critical subsystems active.',
    budgetDisplay: '$2,200,000',
    sciGoalDisplay: '150 PTS',
    radiationDisplay: '100 krad',
    difficulty: 3,
    defaultLauncherId: 'heavy',
    compatibleLaunchers: ['heavy'],
    mandatoryLabels: [
      '+ Space Magnetometer',
      '+ Solar Coronagraph',
      '+ Extreme Thermal/Radiation Shielding',
    ],
    stationMinigames: [
      'debris',
      'dock',
      'pcb',
      'eps',
      'thermal',
      'nav',
      'decrypt',
      'cyber',
    ],
    targetResolutions: 8,
    defaultAmbientEvent: 'solar_storm',
    roleProblems: {
      director: 'Kessler Debris Ejection + L1 APAS Docking (Level 3)',
      engineer: 'PCB Circuit Bypass + EPS Power Distribution (Level 3)',
      science: 'IR/UV Multispectral Telemetry + Dual Hohmann Orbit (Level 3)',
      comms: 'Quantum CRC Decryption + Firewall 8080 Cyber Defense (Level 3)',
    },
    accentColor: '#fbbf24',
  },
}

export const LAUNCHER_CATALOG: Record<LauncherId, LauncherBriefingDef> = {
  rideshare: {
    id: 'rideshare',
    name: 'SSO Economy Rideshare',
    orbitTag: 'LEO POLAR ORBIT',
    costDisplay: '$85,000',
    payloadDisplay: '13.0 kg max',
    sciBonusDisplay: '+0 PTS',
    compatibleMissions: ['andes'],
    desc: 'Shared Falcon SSO rideshare deployment optimized for Andean CubeSats in Low Earth Orbit.',
    accentColor: '#22d3ee',
  },
  light: {
    id: 'light',
    name: 'Dedicated Light Launcher + Kick Stage',
    orbitTag: 'LEO · LUNAR LLO',
    costDisplay: '$290,000',
    payloadDisplay: '24.0 kg max',
    sciBonusDisplay: '+25 PTS',
    compatibleMissions: ['andes', 'luna'],
    desc: 'Dedicated vehicle with powered kick stage capable of lunar orbit insertion (LLO).',
    accentColor: '#a78bfa',
  },
  heavy: {
    id: 'heavy',
    name: 'Deep Space Heavy Lifter',
    orbitTag: 'LEO · LLO · DEEP L1',
    costDisplay: '$520,000',
    payloadDisplay: '40.0 kg max',
    sciBonusDisplay: '+50 PTS',
    compatibleMissions: ['andes', 'luna', 'sol'],
    desc: 'Heavy-lift fairing with maximum Delta-V certified for deep space and Sun-Earth L1.',
    accentColor: '#fbbf24',
  },
}

export function sanitizeMissionId(raw: unknown): MissionId {
  if (raw === 'luna' || raw === 'sol' || raw === 'andes') return raw
  return 'andes'
}

export function sanitizeLauncherId(raw: unknown): LauncherId {
  if (raw === 'rideshare' || raw === 'light' || raw === 'heavy') return raw
  return 'rideshare'
}

/** Devuelve el lanzador elegido si alcanza la órbita de la misión, o el predeterminado compatible. */
export function resolveCompatibleLauncher(missionId: MissionId, launcherId: LauncherId): LauncherId {
  const mission = MISSION_CATALOG[missionId]
  if (mission.compatibleLaunchers.includes(launcherId)) {
    return launcherId
  }
  return mission.defaultLauncherId
}

export function getNextMissionId(missionId: MissionId): MissionId | null {
  if (missionId === 'andes') return 'luna'
  if (missionId === 'luna') return 'sol'
  return null
}

export function missionIdToIndex(missionId: MissionId): 1 | 2 | 3 {
  if (missionId === 'luna') return 2
  if (missionId === 'sol') return 3
  return 1
}

export function missionIndexToId(index: unknown): MissionId {
  if (index === 2 || index === '2') return 'luna'
  if (index === 3 || index === '3') return 'sol'
  return 'andes'
}

export function sanitizeMissionIndex(raw: unknown): 1 | 2 | 3 {
  if (raw === 2 || raw === '2') return 2
  if (raw === 3 || raw === '3') return 3
  return 1
}

export function defaultLauncherForStage(index: 1 | 2 | 3): LauncherId {
  if (index === 2) return 'light'
  if (index === 3) return 'heavy'
  return 'rideshare'
}
