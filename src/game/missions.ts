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
    orbitBadge: 'ÓRBITA POLAR LEO',
    stars: '★',
    levelLabel: 'NIVEL 1 · CADETE',
    title: 'Monitoreo Glaciar y Estrés Hídrico en los Andes',
    subtitle:
      'Cartografía térmica y control energético en órbita polar baja sobre la cordillera andina.',
    budgetDisplay: '$650.000',
    sciGoalDisplay: '65 PTS',
    radiationDisplay: '18 krad',
    difficulty: 1,
    defaultLauncherId: 'rideshare',
    compatibleLaunchers: ['rideshare', 'light', 'heavy'],
    mandatoryLabels: ['+ Cámara Multiespectral / Térmica'],
    stationMinigames: ['dock', 'eps', 'nav', 'telecom'],
    targetResolutions: 4,
    defaultAmbientEvent: 'none',
    roleProblems: {
      director: 'Acoplamiento Espacial 6-DOF APAS (Nivel 1)',
      engineer: 'Distribución Eléctrica EPS (Nivel 1)',
      science: 'Navegación Orbital Hohmann SAT-02 (Nivel 1)',
      comms: 'Sintonización Telecomunicaciones DSN (Nivel 1)',
    },
    accentColor: '#38bdf8',
  },
  luna: {
    id: 'luna',
    number: 2,
    code: 'ARTEMIS-LUNAR-ICE',
    orbitBadge: 'ÓRBITA LUNAR LLO',
    stars: '★★',
    levelLabel: 'NIVEL 2 · COMANDANTE',
    title: 'Cartografía de Hielo Lunar en el Polo Sur',
    subtitle:
      'Inserción translunar, ciberdefensa en enlace profundo y descenso de sonda sobre cráteres polares.',
    budgetDisplay: '$1.450.000',
    sciGoalDisplay: '110 PTS',
    radiationDisplay: '55 krad',
    difficulty: 2,
    defaultLauncherId: 'light',
    compatibleLaunchers: ['light', 'heavy'],
    mandatoryLabels: [
      '+ Espectrómetro de Neutrones',
      '+ Antena de Alta Ganancia (HGA)',
    ],
    stationMinigames: ['comet', 'gyro', 'eclss', 'reactor', 'lander', 'spectro', 'cyber', 'hga'],
    targetResolutions: 6,
    defaultAmbientEvent: 'none',
    roleProblems: {
      director: 'Defensa Orbital Meteoritos + Calibración Giroscopio 3D (Nivel 2)',
      engineer: 'Soporte Vital ECLSS O₂ + Refrigeración del Reactor (Nivel 2)',
      science: 'Aterrizaje Sonda Lunar + Espectrometría de Masas (Nivel 2)',
      comms: 'Ciberdefensa Firewall 8080 + Antena Alta Ganancia DSN (Nivel 2)',
    },
    accentColor: '#a78bfa',
  },
  sol: {
    id: 'sol',
    number: 3,
    code: 'HELIOS-SENTINEL-L1',
    orbitBadge: 'SOL-TIERRA L1',
    stars: '★★★',
    levelLabel: 'NIVEL 3 · LEYENDA NASA',
    title: 'Alerta Temprana de Tormentas Solares',
    subtitle:
      'Operación extrema en el punto Lagrange L1 bajo tormenta geomagnética con los 8 subsistemas críticos de alta intensidad activos.',
    budgetDisplay: '$2.200.000',
    sciGoalDisplay: '150 PTS',
    radiationDisplay: '100 krad',
    difficulty: 3,
    defaultLauncherId: 'heavy',
    compatibleLaunchers: ['heavy'],
    mandatoryLabels: [
      '+ Magnetómetro Espacial',
      '+ Coronógrafo Solar',
      '+ Blindaje Extremo Térmico/Radiación',
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
      director: 'Eyección Escombros Kessler + Acoplamiento APAS L1 (Nivel 3)',
      engineer: 'Reparación Circuitos PCB + Distribución Eléctrica EPS (Nivel 3)',
      science: 'Telemetría Multiespectral IR/UV + Órbita Hohmann Dual (Nivel 3)',
      comms: 'Desencriptación Cuántica CRC + Ciberdefensa Firewall 8080 (Nivel 3)',
    },
    accentColor: '#fbbf24',
  },
}

export const LAUNCHER_CATALOG: Record<LauncherId, LauncherBriefingDef> = {
  rideshare: {
    id: 'rideshare',
    name: 'Rideshare Económico SSO',
    orbitTag: 'ÓRBITA POLAR LEO',
    costDisplay: '$85.000',
    payloadDisplay: '13.0 kg max',
    sciBonusDisplay: '+0 PTS',
    compatibleMissions: ['andes'],
    desc: 'Despliegue compartido en lanzador Falcon SSO optimizado para CubeSats andinos en órbita baja.',
    accentColor: '#22d3ee',
  },
  light: {
    id: 'light',
    name: 'Lanzador Dedicado Ligero + Kick Stage',
    orbitTag: 'LEO · ÓRBITA LUNAR LLO',
    costDisplay: '$290.000',
    payloadDisplay: '24.0 kg max',
    sciBonusDisplay: '+25 PTS',
    compatibleMissions: ['andes', 'luna'],
    desc: 'Vehículo dedicado con etapa superior propulsada capaz de inyectar carga útil en órbita lunar LLO.',
    accentColor: '#a78bfa',
  },
  heavy: {
    id: 'heavy',
    name: 'Lanzador Pesado de Espacio Profundo',
    orbitTag: 'LEO · LLO · L1 PROFUNDO',
    costDisplay: '$520.000',
    payloadDisplay: '40.0 kg max',
    sciBonusDisplay: '+50 PTS',
    compatibleMissions: ['andes', 'luna', 'sol'],
    desc: 'Cofia pesada de máxima capacidad Δv certificada para espacio profundo y el punto Sol-Tierra L1.',
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
