import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CHASSIS, CONTRACTS, LAUNCHERS, ROLE_INFO, ROLE_ORDER } from '../game/catalog'
import type { RoleId } from '../game/catalog'
import { analyze } from '../game/sim'
import { actions, useGame } from '../game/store'
import { playClick, playHover, playIntroSweep } from '../audio'
import type { MinigameId } from './minigames/MinigameFrame'
import NavegacionOrbitalModal from './minigames/NavegacionOrbitalModal'
import DistribucionElectricaModal from './minigames/DistribucionElectricaModal'
import SoporteVitalModal from './minigames/SoporteVitalModal'
import AcoplamientoEspacialModal from './minigames/AcoplamientoEspacialModal'
import AterrizajePlanetarioModal from './minigames/AterrizajePlanetarioModal'
import ReparacionTelecomModal from './minigames/ReparacionTelecomModal'
import ReencuentroCometaModal from './minigames/ReencuentroCometaModal'
import CiberdefensaSatelitalModal from './minigames/CiberdefensaSatelitalModal'

interface Props {
  onBackToWorkshop: () => void
  onReplayCutscene: () => void
  onOpenTelemetryReport: () => void
  onExitToMenu: () => void
}

export type StationEventId = 'none' | 'eclipse' | 'solar_storm' | 'o2_leak'
export type FacingDir = 'left' | 'right' | 'up' | 'down'

// Mundo en grilla industrial de 32x32 píxeles (75 x 48 bloques = 2400 x 1536 px)
const TILE = 32
const WORLD_W = 2400
const WORLD_H = 1536

// Resolución lógica Pixel-Art HD panorámica (división 2.2x del viewport real, sin franjas 4:3)
const PIXEL_DOWNSCALE = 2.2
const MIN_PIXEL_W = 320
const MIN_PIXEL_H = 180

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type RoomId =
  | 'ground_segment'
  | 'launch_segment'
  | 'engine_room'
  | 'space_segment'
  | 'communications'
  | 'user_segment'
  | 'laboratory'
  | 'power_reactor'
  | 'life_electrical'

export type FloorStyle =
  | 'command'
  | 'hangar'
  | 'engine'
  | 'comms'
  | 'lab'
  | 'reactor'
  | 'grating'

interface StationRoom {
  id: RoomId
  label: string
  subLabel: string
  owner: RoleId | 'common'
  floorStyle: FloorStyle
  hull: Rect
  floor: Rect
  color: string
  navX: number
  navY: number
}

interface CorridorSegment {
  id: string
  rect: Rect
  orientation: 'horizontal' | 'vertical'
}

interface LaserSecurityGate {
  id: string
  owner: RoleId
  x: number
  y: number
  orientation: 'vertical' | 'horizontal'
  size: number
  blockRect: Rect
  roomLabel: string
}

interface SlidingDoor {
  id: string
  x: number
  y: number
  orientation: 'vertical' | 'horizontal'
  size: number
}

interface ConsoleStation {
  id: string
  role: RoleId
  roomId: RoomId
  zoneName: string
  subsystemLabel: string
  title: string
  shortLabel: string
  icon: string
  x: number
  y: number
  standX: number
  standY: number
  hint: string
  /** Roles adicionales que también pueden operar esta consola (centros de control satelital compartidos) */
  allowedRoles?: RoleId[]
}

// Propiedad estricta: cada consola solo puede ser operada por el especialista dueño del cuadrante
const canUseConsole = (c: ConsoleStation, role: RoleId) => c.role === role

interface ActiveTask {
  id: string
  role: RoleId
  consoleId: string
  kind: 'mission' | 'problem'
  title: string
  reason: string
}

interface IntercomLog {
  id: number
  from: RoleId | 'sistema'
  text: string
  kind: 'info' | 'warn' | 'ok'
}

interface CanvasFloatingText {
  id: number
  x: number
  y: number
  text: string
  color: string
  bornAt: number
}

interface AstronautEntity {
  role: RoleId
  x: number
  y: number
  dir: FacingDir
  walkFrame: number
  isMoving: boolean
  isInteracting: boolean
  interactUntil: number
  waypoints: { x: number; y: number; consoleId?: string }[]
  aiPauseUntil: number
  aiTargetIdx: number
}

// ============================================================================
// 1. ARQUITECTURA LIMPIA DE LAS 9 ÁREAS EN 4 CUADRANTES CON PROPIEDAD ESTRICTA
// ============================================================================
const STATION_ROOMS: StationRoom[] = [
  // a) GROUND SEGMENT (Cuadrante 1 · Base exclusiva de CÓNDOR-4, visitable por todos)
  {
    id: 'ground_segment',
    label: 'GROUND SEGMENT',
    subLabel: 'PUENTE CENTRAL · COMANDO HOLOGRÁFICO Y SIMULADOR APAS',
    owner: 'director',
    floorStyle: 'command',
    hull: { x: 896, y: 512, w: 576, h: 448 },
    floor: { x: 928, y: 576, w: 512, h: 352 },
    color: '#ffd23f',
    navX: 1184,
    navY: 752,
  },
  // b) LAUNCH SEGMENT (Cuadrante 1 · Hangar del Transbordador de CÓNDOR-4)
  {
    id: 'launch_segment',
    label: 'LAUNCH SEGMENT',
    subLabel: 'HANGAR DEL TRANSBORDADOR · BRAZO HIDRÁULICO',
    owner: 'director',
    floorStyle: 'hangar',
    hull: { x: 192, y: 448, w: 576, h: 480 },
    floor: { x: 224, y: 512, w: 512, h: 384 },
    color: '#ffd23f',
    navX: 544,
    navY: 720,
  },
  // c) ENGINE ROOM (Cuadrante 1 · Turbina Sur-Oeste de CÓNDOR-4)
  {
    id: 'engine_room',
    label: 'ENGINE ROOM',
    subLabel: 'TURBINA HORIZONTAL PESADA · MANIOBRAS DELTA-V',
    owner: 'director',
    floorStyle: 'engine',
    hull: { x: 224, y: 1024, w: 512, h: 352 },
    floor: { x: 256, y: 1088, w: 448, h: 256 },
    color: '#ffd23f',
    navX: 480,
    navY: 1216,
  },
  // d) SPACE SEGMENT (Cuadrante 4 · Sector SERPIENTE-2)
  {
    id: 'space_segment',
    label: 'SPACE SEGMENT',
    subLabel: 'SERVIDORES DSN · TELESCOPIO · 2 SATÉLITES CUBESAT',
    owner: 'comms',
    floorStyle: 'comms',
    hull: { x: 224, y: 64, w: 544, h: 320 },
    floor: { x: 256, y: 128, w: 480, h: 224 },
    color: '#74b9ff',
    navX: 512,
    navY: 240,
  },
  // e) COMMUNICATIONS (Cuadrante 4 · Sector SERPIENTE-2)
  {
    id: 'communications',
    label: 'COMMUNICATIONS',
    subLabel: 'DOMO DSN · MONITORES SAT-01/SAT-02 · ENCRIPTACIÓN',
    owner: 'comms',
    floorStyle: 'comms',
    hull: { x: 864, y: 64, w: 480, h: 320 },
    floor: { x: 896, y: 128, w: 416, h: 224 },
    color: '#74b9ff',
    navX: 1104,
    navY: 240,
  },
  // f) USER SEGMENT (Cuadrante 3 · Sector PUMA-3)
  {
    id: 'user_segment',
    label: 'USER SEGMENT',
    subLabel: 'MICROSCOPIOS · INCUBADORAS · MUESTRAS GLACIARES',
    owner: 'science',
    floorStyle: 'lab',
    hull: { x: 1504, y: 64, w: 576, h: 320 },
    floor: { x: 1536, y: 128, w: 512, h: 224 },
    color: '#55efc4',
    navX: 1792,
    navY: 240,
  },
  // g) LABORATORY (Cuadrante 3 · Sector PUMA-3)
  {
    id: 'laboratory',
    label: 'LABORATORY',
    subLabel: 'CAMPANA EXTRACTORA · MATRACES · PIZARRA CIENTÍFICA',
    owner: 'science',
    floorStyle: 'lab',
    hull: { x: 1568, y: 448, w: 480, h: 288 },
    floor: { x: 1600, y: 512, w: 416, h: 192 },
    color: '#55efc4',
    navX: 1792,
    navY: 608,
  },
  // h) POWER MGD & REACTOR (Cuadrante 2 · Sector ALPACA-1)
  {
    id: 'power_reactor',
    label: 'POWER MGD & REACTOR',
    subLabel: 'REACTOR · OSCILOSCOPIOS · PANELES TÉRMICOS · LITERA',
    owner: 'engineer',
    floorStyle: 'reactor',
    hull: { x: 1568, y: 768, w: 576, h: 384 },
    floor: { x: 1600, y: 832, w: 512, h: 288 },
    color: '#ff9f43',
    navX: 1824,
    navY: 960,
  },
  // i) LIFE SUPPORT & ELECTRICAL (ALPACA-1)
  {
    id: 'life_electrical',
    label: 'LIFE SUPPORT & ELECTRICAL',
    subLabel: 'O2 LIFE SUPPORT & ELECTRICAL MASTER SWITCH (ALPACA-1)',
    owner: 'engineer',
    floorStyle: 'grating',
    hull: { x: 864, y: 1056, w: 672, h: 384 },
    floor: { x: 896, y: 1120, w: 608, h: 288 },
    color: '#ff9f43',
    navX: 1184,
    navY: 1248,
  },
]

const ROOM_BY_ID: Record<RoomId, StationRoom> = Object.fromEntries(
  STATION_ROOMS.map((r) => [r.id, r])
) as Record<RoomId, StationRoom>

// Pasillos industriales de 32x32 con rejillas oscuras detalladas
const CORRIDORS: CorridorSegment[] = [
  { id: 'cor_west', rect: { x: 736, y: 672, w: 192, h: 96 }, orientation: 'horizontal' },
  { id: 'cor_engine', rect: { x: 432, y: 896, w: 96, h: 192 }, orientation: 'vertical' },
  { id: 'cor_north', rect: { x: 1056, y: 352, w: 96, h: 224 }, orientation: 'vertical' },
  { id: 'cor_space', rect: { x: 736, y: 192, w: 160, h: 96 }, orientation: 'horizontal' },
  { id: 'cor_east_lab', rect: { x: 1440, y: 576, w: 160, h: 96 }, orientation: 'horizontal' },
  { id: 'cor_user_lab', rect: { x: 1744, y: 352, w: 96, h: 160 }, orientation: 'vertical' },
  { id: 'cor_east_pwr', rect: { x: 1440, y: 832, w: 160, h: 96 }, orientation: 'horizontal' },
  { id: 'cor_south_life', rect: { x: 1136, y: 928, w: 96, h: 192 }, orientation: 'vertical' },
  { id: 'cor_eng_link_v', rect: { x: 1600, y: 1120, w: 96, h: 160 }, orientation: 'vertical' },
  { id: 'cor_eng_link_h', rect: { x: 1504, y: 1184, w: 192, h: 96 }, orientation: 'horizontal' },
]

// Compuertas Láser de Seguridad en las entradas a los sectores exclusivos de cada rol
const LASER_GATES: LaserSecurityGate[] = [
  {
    id: 'gate_director',
    owner: 'director',
    x: 832,
    y: 720,
    orientation: 'vertical',
    size: 96,
    blockRect: { x: 814, y: 672, w: 36, h: 96 },
    roomLabel: 'LAUNCH SEGMENT & ENGINE ROOM',
  },
  {
    id: 'gate_comms',
    owner: 'comms',
    x: 1104,
    y: 464,
    orientation: 'horizontal',
    size: 96,
    blockRect: { x: 1056, y: 446, w: 96, h: 36 },
    roomLabel: 'COMMUNICATIONS & SPACE SEGMENT',
  },
  {
    id: 'gate_science',
    owner: 'science',
    x: 1520,
    y: 624,
    orientation: 'vertical',
    size: 96,
    blockRect: { x: 1502, y: 576, w: 36, h: 96 },
    roomLabel: 'LABORATORY & USER SEGMENT',
  },
  {
    id: 'gate_engineer_east',
    owner: 'engineer',
    x: 1520,
    y: 880,
    orientation: 'vertical',
    size: 96,
    blockRect: { x: 1502, y: 832, w: 36, h: 96 },
    roomLabel: 'POWER MGD & REACTOR',
  },
  {
    id: 'gate_engineer_south',
    owner: 'engineer',
    x: 1184,
    y: 1024,
    orientation: 'horizontal',
    size: 96,
    blockRect: { x: 1136, y: 1006, w: 96, h: 36 },
    roomLabel: 'LIFE SUPPORT & ELECTRICAL',
  },
]

const SLIDING_DOORS: SlidingDoor[] = [
  { id: 'door_engine', x: 480, y: 992, orientation: 'horizontal', size: 96 },
  { id: 'door_space_comm', x: 816, y: 240, orientation: 'vertical', size: 96 },
  { id: 'door_user_lab', x: 1792, y: 432, orientation: 'horizontal', size: 96 },
  { id: 'door_life_elec', x: 1248, y: 1264, orientation: 'vertical', size: 96 },
]

const ROLE_SPAWNS: Record<RoleId, { x: number; y: number }> = {
  director: { x: 1184, y: 740 },
  comms: { x: 544, y: 240 },
  science: { x: 1760, y: 240 },
  engineer: { x: 1792, y: 960 },
}

// ============================================================================
// ESTACIONES INTERACTIVAS DISTRIBUIDAS EN LAS 9 SALAS OFICIALES
// ============================================================================
const CONSOLES: ConsoleStation[] = [
  // 🦅 ROL 1: CÓNDOR-4 (GROUND SEGMENT + LAUNCH SEGMENT + ENGINE ROOM)
  {
    id: 'dir_orbit',
    role: 'director',
    roomId: 'ground_segment',
    zoneName: 'GROUND SEGMENT (CENTRO)',
    subsystemLabel: 'CONTROL DE ACTITUD Y ÓRBITA',
    title: 'Consola Curva de 5 Pantallas Mundiales',
    shortLabel: '5 PANTALLAS MANDO',
    icon: '🧭',
    x: 1184,
    y: 624,
    standX: 1184,
    standY: 688,
    hint: 'Estabiliza la altitud y actitud orbital al 100% desde el puente de mando central.',
  },
  {
    id: 'dir_shield',
    role: 'director',
    roomId: 'launch_segment',
    zoneName: 'LAUNCH SEGMENT (HANGAR OESTE)',
    subsystemLabel: 'TORRETA TÁCTICA Y RADAR COMETA',
    title: 'Brazo Hidráulico, Escudos y Radar de Intercepción',
    shortLabel: 'RADAR COMETA',
    icon: '☄️',
    x: 608,
    y: 816,
    standX: 608,
    standY: 760,
    hint: 'Ejecuta el reencuentro e intercepción táctica del cometa para proteger el Casco al 100%.',
  },
  {
    id: 'dir_engine',
    role: 'director',
    roomId: 'engine_room',
    zoneName: 'ENGINE ROOM (TURBINA SUR-OESTE)',
    subsystemLabel: 'PROPULSIÓN PRINCIPAL DELTA-V',
    title: 'Turbina Horizontal Pesada y Tobera Orbital',
    shortLabel: 'TURBINA DELTA-V',
    icon: '🔥',
    x: 480,
    y: 1168,
    standX: 480,
    standY: 1236,
    hint: 'Ejecuta maniobra de acoplamiento y empuje Delta-V para estabilizar la órbita.',
  },

  // 🐍 ROL 4: SERPIENTE-2 (SPACE SEGMENT + COMMUNICATIONS)
  {
    id: 'com_align',
    role: 'comms',
    roomId: 'space_segment',
    zoneName: 'SPACE SEGMENT (NOROESTE)',
    subsystemLabel: 'CIBERDEFENSA Y FIREWALL SATELITAL',
    title: 'Estación Óptica y Firewall de Red Espacial',
    shortLabel: 'FIREWALL SATELITAL',
    icon: '🛡️',
    x: 448,
    y: 224,
    standX: 448,
    standY: 284,
    hint: 'Bloquea intrusiones y paquetes corruptos para asegurar la red satelital al 100%.',
  },
  {
    id: 'com_filter',
    role: 'comms',
    roomId: 'space_segment',
    zoneName: 'SPACE SEGMENT (SOPORTES CUBESAT)',
    subsystemLabel: 'SEGURIDAD DE TELEMETRÍA',
    title: 'Servidor Firewall y Soportes CubeSat',
    shortLabel: 'NODO CIBERDEFENSA',
    icon: '🔐',
    x: 640,
    y: 192,
    standX: 608,
    standY: 248,
    hint: 'Defiende la constelación CubeSat contra ciberataques y limpia la interferencia.',
  },
  {
    id: 'com_tx',
    role: 'comms',
    roomId: 'communications',
    zoneName: 'COMMUNICATIONS (DOMO PARABÓLICO)',
    subsystemLabel: 'REPARACIÓN TELECOM Y ENLACE DSN',
    title: 'Osciloscopio DSN y Plato Parabólico Giratorio',
    shortLabel: 'TELECOM / PLATO DSN',
    icon: '📡',
    x: 1104,
    y: 176,
    standX: 1104,
    standY: 240,
    hint: 'Repara el enlace de telecomunicaciones y transmite los paquetes del Buffer a la Tierra.',
  },

  // 🐆 ROL 3: PUMA-3 (USER SEGMENT + LABORATORY)
  {
    id: 'sci_scan',
    role: 'science',
    roomId: 'user_segment',
    zoneName: 'USER SEGMENT (NORESTE)',
    subsystemLabel: 'SONDA DE ATERRIZAJE Y BIO-ÓPTICA',
    title: 'Simulador de Sonda Planetaria y Microscopios',
    shortLabel: 'ATERRIZAJE SONDA',
    icon: '🛬',
    x: 1744,
    y: 168,
    standX: 1744,
    standY: 228,
    hint: 'Pilota el descenso de la sonda planetaria para recolectar muestras (+40% Buffer · +45 PTS).',
  },
  {
    id: 'sci_holo',
    role: 'science',
    roomId: 'user_segment',
    zoneName: 'USER SEGMENT (MESA HOLOGRÁFICA)',
    subsystemLabel: 'TELEMETRÍA DE DESCENSO 3D',
    title: 'Mesa Holográfica y Simulador Planetario',
    shortLabel: 'DESCENSO HOLO 3D',
    icon: '🧬',
    x: 1936,
    y: 256,
    standX: 1872,
    standY: 264,
    hint: 'Ejecuta el aterrizaje planetario asistido por holograma y carga datos en el Buffer.',
  },
  {
    id: 'sci_lab',
    role: 'science',
    roomId: 'laboratory',
    zoneName: 'LABORATORY (SUB-LAB PROCESADO)',
    subsystemLabel: 'NAVEGACIÓN SAT-02 INTI-SCIENCE',
    title: 'Terminal de Laboratorio y Telemetría SAT-02',
    shortLabel: 'LAB / ÓRBITA SAT-02',
    icon: '🛰️',
    x: 1792,
    y: 552,
    standX: 1792,
    standY: 616,
    hint: 'Controla la órbita del SAT-02 INTI-SCIENCE desde el sub-laboratorio científico.',
  },

  // 🦙 ROL 2: ALPACA-1 (POWER MGD & REACTOR + LIFE SUPPORT & ELECTRICAL)
  {
    id: 'eng_cool',
    role: 'engineer',
    roomId: 'power_reactor',
    zoneName: 'POWER MGD & REACTOR (ESTE)',
    subsystemLabel: 'DISTRIBUCIÓN ELÉCTRICA EPS Y REACTOR',
    title: 'Reactor Cilíndrico Naranja y Buses EPS',
    shortLabel: 'NÚCLEO REACTOR EPS',
    icon: '☢️',
    x: 1760,
    y: 912,
    standX: 1760,
    standY: 984,
    hint: 'Balancea los buses eléctricos del reactor y lleva la Batería Global al 100%.',
  },
  {
    id: 'eng_solar',
    role: 'engineer',
    roomId: 'power_reactor',
    zoneName: 'POWER MGD (PANELES EXTERIORES)',
    subsystemLabel: 'ARREGLOS SOLARES Y RACKS LED',
    title: 'Racks de Carga y Distribución Eléctrica',
    shortLabel: 'RACKS Y PANELES',
    icon: '⚡',
    x: 1968,
    y: 912,
    standX: 1936,
    standY: 968,
    hint: 'Distribuye la energía de los paneles solares entre los módulos (+100% Batería).',
  },
  {
    id: 'eng_o2',
    role: 'engineer',
    roomId: 'life_electrical',
    zoneName: 'LIFE SUPPORT (TANQUES O2 SUR-OESTE)',
    subsystemLabel: 'SOPORTE VITAL ECLSS Y PRESIÓN O2',
    title: '2 Tanques Azules O2 con Válvulas ECLSS',
    shortLabel: 'SOPORTE VITAL O2',
    icon: '🫧',
    x: 1040,
    y: 1184,
    standX: 1040,
    standY: 1256,
    hint: 'Regula O2, CO2, presión y humedad en los 2 tanques azules al 100% (ALPACA-1).',
  },
  {
    id: 'eng_switch',
    role: 'engineer',
    roomId: 'life_electrical',
    zoneName: 'ELECTRICAL (CUARTO CONTIGUO SURESTE)',
    subsystemLabel: 'DISTRIBUCIÓN ELÉCTRICA CENTRAL',
    title: 'Palanca Gigante MASTER SWITCH Eléctrico',
    shortLabel: 'MASTER SWITCH',
    icon: '🕹️',
    x: 1384,
    y: 1184,
    standX: 1384,
    standY: 1256,
    hint: 'Acciona el interruptor maestro de alta tensión para estabilizar todos los módulos.',
  },

  // 🛰️ CENTROS DE CONTROL SATELITAL (navegación dual SAT-01 / SAT-02)
  {
    id: 'sat_ctrl_1',
    role: 'comms',
    roomId: 'space_segment',
    zoneName: 'SPACE SEGMENT (CENTRO SATELITAL 1)',
    subsystemLabel: 'ENLACE EN VIVO · SAT-01 AMARU-COMMS',
    title: 'Estación de Mando Doble con Hologramas Dorados',
    shortLabel: 'CONTROL SAT-01/02',
    icon: '🛰️',
    x: 340,
    y: 296,
    standX: 340,
    standY: 332,
    hint: 'Maniobra el SAT-01 AMARU-COMMS y el SAT-02 INTI-SCIENCE con Delta-V y transferencia de Hohmann.',
  },
  {
    id: 'sat_ctrl_2',
    role: 'science',
    roomId: 'user_segment',
    zoneName: 'USER SEGMENT (CENTRO SATELITAL 2)',
    subsystemLabel: 'ENLACE EN VIVO · SAT-02 INTI-SCIENCE',
    title: 'Estación de Mando con Pantallas Duales y Radar',
    shortLabel: 'CONTROL SAT-02/01',
    icon: '📡',
    x: 1780,
    y: 296,
    standX: 1780,
    standY: 332,
    hint: 'Maniobra el SAT-02 INTI-SCIENCE y el SAT-01 AMARU-COMMS desde tu estación de ciencia.',
  },
]

// Minijuego que abre cada consola al presionar "E" (2 minijuegos por personaje)
const CONSOLE_MINIGAME: Record<string, MinigameId> = {
  // 🦅 CÓNDOR-4: Acoplamiento Espacial + Reencuentro Cometa
  dir_orbit: 'dock',
  dir_engine: 'dock',
  dir_shield: 'comet',
  // 🦙 ALPACA-1: Distribución Eléctrica + Soporte Vital O2
  eng_solar: 'eps',
  eng_switch: 'eps',
  eng_cool: 'eps',
  eng_o2: 'eclss',
  // 🐆 PUMA-3: Aterrizaje Planetario + Navegación Orbital (SAT-02 INTI-SCIENCE)
  sci_scan: 'lander',
  sci_holo: 'lander',
  sat_ctrl_2: 'nav',
  sci_lab: 'nav',
  // 🐍 SERPIENTE-2: Reparación Telecom + Ciberdefensa Satelital (+ SAT-01 AMARU-COMMS)
  com_tx: 'telecom',
  com_align: 'cyber',
  com_filter: 'cyber',
  sat_ctrl_1: 'nav',
}

// Consolas cuyas tareas se completan al ganar cada minijuego
const MINIGAME_CONSOLES: Record<MinigameId, string[]> = {
  dock: ['dir_orbit', 'dir_engine'],
  comet: ['dir_shield'],
  eps: ['eng_solar', 'eng_switch', 'eng_cool'],
  eclss: ['eng_o2'],
  lander: ['sci_scan', 'sci_holo'],
  nav: ['sat_ctrl_1', 'sat_ctrl_2', 'sci_lab'],
  telecom: ['com_tx'],
  cyber: ['com_align', 'com_filter'],
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

function isPointInsideWalkableGeometry(px: number, py: number): boolean {
  const margin = 16
  for (const rm of STATION_ROOMS) {
    const f = rm.floor
    if (
      px >= f.x + margin &&
      px <= f.x + f.w - margin &&
      py >= f.y + margin &&
      py <= f.y + f.h - margin
    ) {
      return true
    }
  }
  for (const cor of CORRIDORS) {
    const r = cor.rect
    if (px >= r.x + 8 && px <= r.x + r.w - 8 && py >= r.y + 8 && py <= r.y + r.h - 8) {
      return true
    }
  }
  return false
}

function findRoomAtPoint(px: number, py: number): StationRoom | null {
  for (const rm of STATION_ROOMS) {
    const h = rm.hull
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
      return rm
    }
  }
  return null
}

// ============================================================================
// ARQUITECTURA DE 4 CUADRANTES Y BACKLOG DE MISIONES POR ESPECIALISTA
// ============================================================================
type QuadrantId = RoleId

interface QuadrantDef {
  id: QuadrantId
  sectorNum: number
  title: string
  roomsSummary: string
  entryPoint: { x: number; y: number }
  cameraFocus: { x: number; y: number; zoom: number }
  miniRooms: { x: number; y: number; w: number; h: number; accent?: boolean }[]
}

const QUADRANT_DEFS: Record<QuadrantId, QuadrantDef> = {
  director: {
    id: 'director',
    sectorNum: 1,
    title: 'CUADRANTE 1 · MANDO Y HANGAR',
    roomsSummary: 'GROUND · LAUNCH · ENGINE',
    entryPoint: { x: 1184, y: 848 },
    cameraFocus: { x: 1184, y: 736, zoom: 0.72 },
    miniRooms: [
      { x: 42, y: 12, w: 50, h: 28, accent: true }, // Ground
      { x: 8, y: 8, w: 28, h: 28 }, // Launch
      { x: 10, y: 40, w: 30, h: 18 }, // Engine
    ],
  },
  engineer: {
    id: 'engineer',
    sectorNum: 2,
    title: 'CUADRANTE 2 · POTENCIA Y SOPORTE O2',
    roomsSummary: 'POWER · LIFE SUPPORT · ELEC',
    entryPoint: { x: 1760, y: 1012 },
    cameraFocus: { x: 1856, y: 960, zoom: 0.72 },
    miniRooms: [
      { x: 38, y: 10, w: 54, h: 28, accent: true }, // Power/Reactor
      { x: 12, y: 38, w: 54, h: 20 }, // Life Support + Electrical
    ],
  },
  science: {
    id: 'science',
    sectorNum: 3,
    title: 'CUADRANTE 3 · CIENCIA Y SONDAS',
    roomsSummary: 'USER SEGMENT · LABORATORY',
    entryPoint: { x: 1792, y: 244 },
    cameraFocus: { x: 1792, y: 224, zoom: 0.74 },
    miniRooms: [
      { x: 10, y: 6, w: 56, h: 24, accent: true }, // User Segment
      { x: 16, y: 33, w: 46, h: 20 }, // Laboratory
    ],
  },
  comms: {
    id: 'comms',
    sectorNum: 4,
    title: 'CUADRANTE 4 · ESPACIO Y COMMS',
    roomsSummary: 'SPACE SEGMENT · DSN COMMS',
    entryPoint: { x: 512, y: 244 },
    cameraFocus: { x: 800, y: 224, zoom: 0.58 },
    miniRooms: [
      { x: 6, y: 14, w: 44, h: 36, accent: true }, // Space Segment
      { x: 54, y: 14, w: 40, h: 36 }, // Communications
    ],
  },
}

const MINIMAP_SPATIAL_ORDER: QuadrantId[] = ['comms', 'science', 'director', 'engineer']

interface BacklogMissionDef {
  id: string
  role: RoleId
  consoleIds: string[]
  title: string
  quadrantTag: string
}

const MISSION_BACKLOG: BacklogMissionDef[] = [
  {
    id: 'm_sci_lander',
    role: 'science',
    consoleIds: ['sci_scan', 'sci_holo'],
    title: 'Aterrizaje Sonda y Muestras Planetarias',
    quadrantTag: 'USER SEG',
  },
  {
    id: 'm_sci_nav',
    role: 'science',
    consoleIds: ['sat_ctrl_2', 'sci_lab'],
    title: 'Navegación Orbital SAT-02 INTI-SCIENCE',
    quadrantTag: 'USER / LAB',
  },
  {
    id: 'm_com_telecom',
    role: 'comms',
    consoleIds: ['com_tx'],
    title: 'Reparación Telecom y Enlace DSN',
    quadrantTag: 'COMMS',
  },
  {
    id: 'm_com_cyber',
    role: 'comms',
    consoleIds: ['com_align', 'com_filter', 'sat_ctrl_1'],
    title: 'Ciberdefensa Satelital y SAT-01',
    quadrantTag: 'SPACE SEG',
  },
  {
    id: 'm_eng_eps',
    role: 'engineer',
    consoleIds: ['eng_switch', 'eng_solar', 'eng_cool'],
    title: 'Distribución Eléctrica EPS / Reactor',
    quadrantTag: 'POWER / ELEC',
  },
  {
    id: 'm_eng_eclss',
    role: 'engineer',
    consoleIds: ['eng_o2'],
    title: 'Soporte Vital O2 (Tanques Azules)',
    quadrantTag: 'LIFE SUPPORT',
  },
  {
    id: 'm_dir_dock',
    role: 'director',
    consoleIds: ['dir_orbit', 'dir_engine'],
    title: 'Acoplamiento APAS / Control Orbital',
    quadrantTag: 'GROUND SEG',
  },
  {
    id: 'm_dir_comet',
    role: 'director',
    consoleIds: ['dir_shield'],
    title: 'Reencuentro Cometa / Escudo Hangar',
    quadrantTag: 'LAUNCH SEG',
  },
]

function findQuadrantAtPoint(px: number, py: number): QuadrantId {
  const rm = findRoomAtPoint(px, py)
  if (rm) {
    if (rm.id === 'life_electrical') {
      return 'engineer'
    }
    if (rm.owner !== 'common') return rm.owner
    return 'director'
  }
  if (py < 420) return px < 1420 ? 'comms' : 'science'
  if (px < 850) return 'director'
  if (px > 1490) return py < 740 ? 'science' : 'engineer'
  if (py > 980) return 'engineer'
  return 'director'
}

// ============================================================================
// GRAFO DE NAVEGACIÓN ENTRE SALAS Y PASILLOS
// ============================================================================
interface NavNode {
  id: string
  x: number
  y: number
  neighbors: string[]
}

const NAV_NODES: Record<string, NavNode> = {
  ground_segment: {
    id: 'ground_segment',
    x: 1184,
    y: 752,
    neighbors: ['j_west', 'j_north', 'j_east_lab', 'j_east_pwr', 'j_south'],
  },
  j_west: {
    id: 'j_west',
    x: 800,
    y: 720,
    neighbors: ['ground_segment', 'launch_segment'],
  },
  launch_segment: {
    id: 'launch_segment',
    x: 512,
    y: 720,
    neighbors: ['j_west', 'j_engine'],
  },
  j_engine: {
    id: 'j_engine',
    x: 480,
    y: 992,
    neighbors: ['launch_segment', 'engine_room'],
  },
  engine_room: {
    id: 'engine_room',
    x: 480,
    y: 1216,
    neighbors: ['j_engine'],
  },
  j_north: {
    id: 'j_north',
    x: 1104,
    y: 440,
    neighbors: ['ground_segment', 'communications'],
  },
  communications: {
    id: 'communications',
    x: 1104,
    y: 240,
    neighbors: ['j_north', 'j_space'],
  },
  j_space: {
    id: 'j_space',
    x: 816,
    y: 240,
    neighbors: ['communications', 'space_segment'],
  },
  space_segment: {
    id: 'space_segment',
    x: 544,
    y: 240,
    neighbors: ['j_space'],
  },
  j_east_lab: {
    id: 'j_east_lab',
    x: 1504,
    y: 624,
    neighbors: ['ground_segment', 'laboratory'],
  },
  laboratory: {
    id: 'laboratory',
    x: 1792,
    y: 624,
    neighbors: ['j_east_lab', 'j_user'],
  },
  j_user: {
    id: 'j_user',
    x: 1792,
    y: 432,
    neighbors: ['laboratory', 'user_segment'],
  },
  user_segment: {
    id: 'user_segment',
    x: 1792,
    y: 240,
    neighbors: ['j_user'],
  },
  j_east_pwr: {
    id: 'j_east_pwr',
    x: 1504,
    y: 880,
    neighbors: ['ground_segment', 'power_reactor'],
  },
  power_reactor: {
    id: 'power_reactor',
    x: 1760,
    y: 960,
    neighbors: ['j_east_pwr', 'j_eng_link'],
  },
  j_eng_link: {
    id: 'j_eng_link',
    x: 1648,
    y: 1232,
    neighbors: ['power_reactor', 'life_electrical'],
  },
  j_south: {
    id: 'j_south',
    x: 1184,
    y: 1000,
    neighbors: ['ground_segment', 'life_electrical'],
  },
  life_electrical: {
    id: 'life_electrical',
    x: 1184,
    y: 1248,
    neighbors: ['j_south', 'j_eng_link'],
  },
}

function findNearestNavNode(px: number, py: number): string {
  const rm = findRoomAtPoint(px, py)
  if (rm && NAV_NODES[rm.id]) return rm.id
  let best = 'ground_segment'
  let bestD = Infinity
  for (const k of Object.keys(NAV_NODES)) {
    const n = NAV_NODES[k]
    const d = Math.hypot(n.x - px, n.y - py)
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return best
}

function buildWaypointPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  consoleId?: string
): { x: number; y: number; consoleId?: string }[] {
  const startRoom = findRoomAtPoint(sx, sy)
  const endRoom = findRoomAtPoint(tx, ty)
  if (startRoom && endRoom && startRoom.id === endRoom.id) {
    return [{ x: tx, y: ty, consoleId }]
  }

  const startId = findNearestNavNode(sx, sy)
  const endId = findNearestNavNode(tx, ty)
  if (startId === endId) {
    return [{ x: tx, y: ty, consoleId }]
  }

  const queue: string[][] = [[startId]]
  const visited = new Set<string>([startId])
  let foundPath: string[] = [startId, endId]

  while (queue.length > 0) {
    const path = queue.shift()!
    const last = path[path.length - 1]
    if (last === endId) {
      foundPath = path
      break
    }
    for (const nb of NAV_NODES[last]?.neighbors ?? []) {
      if (!visited.has(nb)) {
        visited.add(nb)
        queue.push([...path, nb])
      }
    }
  }

  const waypoints: { x: number; y: number; consoleId?: string }[] = []
  for (let i = 1; i < foundPath.length; i++) {
    const node = NAV_NODES[foundPath[i]]
    if (node) {
      waypoints.push({ x: node.x, y: node.y })
    }
  }
  waypoints.push({ x: tx, y: ty, consoleId })
  return waypoints
}

// ============================================================================
// 2. ATLAS MODULAR OFFSCREEN DE SPRITES PIXEL-ART 16-BITS (imageSmoothingEnabled = false)
// ============================================================================
type FurnitureSpriteId =
  | 'nasaBookshelf'
  | 'commanderChair'
  | 'dockingSimulator'
  | 'secondaryOrbitalMonitor'
  | 'toolWorkbench'
  | 'oscilloscopeBench'
  | 'sparePartsCabinet'
  | 'auxBatteryBank'
  | 'thermalDiagPanel'
  | 'techBunk'
  | 'geoGlacierShelf'
  | 'botanicalIncubator'
  | 'scienceWhiteboard'
  | 'dsnServerRack'
  | 'spectrumAnalyzer'
  | 'cryptoDevice'
  | 'dualSatTrackMonitors'
  | 'receiverAntenna'

type InteractiveSpriteId =
  | 'apasRadarBadge'
  | 'navTerminalBadge'
  | 'epsPanelBadge'
  | 'eclssConsoleBadge'
  | 'satCtrlBadge'

interface StationSpriteAtlas {
  characterSheets: Record<RoleId, HTMLCanvasElement>
  furniture: Record<FurnitureSpriteId, HTMLCanvasElement>
  interactive: Record<InteractiveSpriteId, HTMLCanvasElement>
}

const CHAR_SPRITE_CELL = 64
const ATLAS_OUTLINE = '#070b12'

function createPixelGridSprite(
  gridW: number,
  gridH: number,
  pixelSize: number,
  painter: (
    p: (gx: number, gy: number, gw: number, gh: number, color: string) => void,
    sctx: CanvasRenderingContext2D
  ) => void
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = gridW * pixelSize
  c.height = gridH * pixelSize
  const sctx = c.getContext('2d')
  if (sctx) {
    sctx.imageSmoothingEnabled = false
    const p = (gx: number, gy: number, gw: number, gh: number, color: string) => {
      sctx.fillStyle = color
      sctx.fillRect(
        Math.round(gx * pixelSize),
        Math.round(gy * pixelSize),
        Math.max(1, Math.round(gw * pixelSize)),
        Math.max(1, Math.round(gh * pixelSize))
      )
    }
    painter(p, sctx)
  }
  return c
}

function drawHelmetDomeToCtx(
  ctx: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  ringColor: string,
  tintFill: string
) {
  ctx.fillStyle = ATLAS_OUTLINE
  ctx.fillRect(dx + 1, dy - 1, dw - 2, 1)
  ctx.fillRect(dx + 1, dy + dh, dw - 2, 1)
  ctx.fillRect(dx - 1, dy + 1, 1, dh - 2)
  ctx.fillRect(dx + dw, dy + 1, 1, dh - 2)
  ctx.fillRect(dx, dy, 1, 1)
  ctx.fillRect(dx + dw - 1, dy, 1, 1)
  ctx.fillRect(dx, dy + dh - 1, 1, 1)
  ctx.fillRect(dx + dw - 1, dy + dh - 1, 1, 1)

  ctx.fillStyle = tintFill
  ctx.fillRect(dx + 1, dy + 1, dw - 2, dh - 2)

  ctx.fillStyle = ringColor
  ctx.fillRect(dx + 2, dy, dw - 4, 1)
  ctx.fillRect(dx + 2, dy + dh - 1, dw - 4, 1)
  ctx.fillRect(dx, dy + 2, 1, dh - 4)
  ctx.fillRect(dx + dw - 1, dy + 2, 1, dh - 4)
  ctx.fillRect(dx + 1, dy + 1, 1, 1)
  ctx.fillRect(dx + dw - 2, dy + 1, 1, 1)
  ctx.fillRect(dx + 1, dy + dh - 2, 1, 1)
  ctx.fillRect(dx + dw - 2, dy + dh - 2, 1, 1)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(dx + 2, dy + 2, 4, 1)
  ctx.fillRect(dx + 2, dy + 3, 2, 3)
  ctx.fillStyle = 'rgba(224, 242, 254, 0.72)'
  ctx.fillRect(dx + 3, dy + 6, 1, 2)
  ctx.fillRect(dx + dw - 4, dy + dh - 4, 2, 1)
}

function paintAstronautPoseToAtlas(
  ctx: CanvasRenderingContext2D,
  role: RoleId,
  poseKind: 'idle' | 'walk' | 'work',
  poseIdx: number
) {
  const isWalking = poseKind === 'walk'
  const isInteracting = poseKind === 'work'
  const walkAngles = [0.7, 0.25, -0.7, -0.25]
  const stride = isWalking ? walkAngles[poseIdx % 4] : 0
  const walkBob = isWalking ? (poseIdx % 2 === 0 ? -1 : 0) : 0
  const breath = (poseKind === 'idle' && poseIdx === 1 ? -1 : 0) + (isInteracting && poseIdx === 1 ? -1 : 0) + walkBob
  const wavePhase = isWalking ? poseIdx * 1.3 : poseIdx * 1.7

  // Sombra suave en suelo
  ctx.fillStyle = 'rgba(2, 6, 16, 0.45)'
  ctx.fillRect(-11, 13, 22, 4)
  ctx.fillRect(-8, 12, 16, 6)

  if (role === 'engineer') {
    const legL = Math.round(stride * 3.5)
    const legR = Math.round(-stride * 3.5)
    const earTwitch = poseKind !== 'idle' && poseIdx % 2 === 1 ? -1 : 0

    // Mochila de soporte vital con contorno oscuro
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-12, -12 + breath, 8, 17)
    ctx.fillStyle = '#475569'
    ctx.fillRect(-11, -11 + breath, 6, 15)
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(-10, -10 + breath, 4, 12)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(-9, -8 + breath, 2, 3)
    ctx.fillStyle = poseIdx % 2 === 0 ? '#4ade80' : '#16a34a'
    ctx.fillRect(-9, -3 + breath, 2, 2)

    // Colita de alpaca blanca contorneada
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-13, 0 + breath, 5, 6)
    ctx.fillStyle = '#fff8e7'
    ctx.fillRect(-12, 1 + breath, 3, 4)

    // Pierna trasera (izquierda) + bota espacial
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(Math.round(-7 + legL * 0.5), 3, 7, 13 + Math.max(0, legL))
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(Math.round(-6 + legL * 0.5), 4, 5, 8 + Math.max(0, legL))
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(Math.round(-6 + legL * 0.5), 7, 5, 2)
    ctx.fillStyle = '#475569'
    ctx.fillRect(Math.round(-7 + legL * 0.5), 11 + Math.max(0, legL), 6, 3)
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(Math.round(-6 + legL * 0.5), 11 + Math.max(0, legL), 4, 1)

    // Pierna delantera (derecha) + bota
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(Math.round(0 + legR * 0.5), 3, 7, 13 + Math.max(0, legR))
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(Math.round(1 + legR * 0.5), 4, 5, 8 + Math.max(0, legR))
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(Math.round(1 + legR * 0.5), 7, 5, 2)
    ctx.fillStyle = '#334155'
    ctx.fillRect(Math.round(0 + legR * 0.5), 11 + Math.max(0, legR), 7, 3)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(Math.round(1 + legR * 0.5), 11 + Math.max(0, legR), 5, 1)

    // Torso del traje con contorno + luces + cinturón
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-8, -10 + breath, 16, 16)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-7, -9 + breath, 14, 14)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(-6, -8 + breath, 12, 11)
    ctx.fillStyle = '#334155'
    ctx.fillRect(-7, 2 + breath, 14, 3)
    ctx.fillStyle = '#fbbf24'
    ctx.fillRect(-2, 2 + breath, 4, 3)
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(-5, -6 + breath, 3, 2)
    ctx.fillStyle = '#2563eb'
    ctx.fillRect(2, -6 + breath, 3, 2)
    ctx.fillStyle = '#334155'
    ctx.fillRect(-3, -3 + breath, 6, 4)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(-2, -2 + breath, 4, 2)

    // Anillo metálico del cuello
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-7, -12 + breath, 14, 4)
    ctx.fillStyle = '#64748b'
    ctx.fillRect(-6, -11 + breath, 12, 2)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-4, -11 + breath, 8, 1)

    // Cuello y cabeza peluda de Alpaca dentro del casco
    ctx.fillStyle = '#fff8e7'
    ctx.fillRect(-4, -22 + breath, 8, 11)
    ctx.fillStyle = '#f3d5b5'
    ctx.fillRect(-4, -16 + breath, 2, 2)
    ctx.fillRect(2, -19 + breath, 2, 2)

    // Orejas con contorno oscuro
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-6, -32 + breath + earTwitch, 5, 6)
    ctx.fillRect(1, -32 + breath - earTwitch, 5, 6)
    ctx.fillStyle = '#fff8e7'
    ctx.fillRect(-5, -31 + breath + earTwitch, 3, 5)
    ctx.fillRect(2, -31 + breath - earTwitch, 3, 5)
    ctx.fillStyle = '#f4a261'
    ctx.fillRect(-4, -30 + breath + earTwitch, 1, 3)
    ctx.fillRect(3, -30 + breath - earTwitch, 1, 3)

    // Cabeza y hocico de Alpaca
    ctx.fillStyle = '#fff8e7'
    ctx.fillRect(-6, -27 + breath, 12, 9)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-5, -28 + breath, 10, 3)
    ctx.fillStyle = '#f3d5b5'
    ctx.fillRect(-2, -23 + breath, 6, 4)
    ctx.fillStyle = '#78350f'
    ctx.fillRect(1, -23 + breath, 2, 1)
    ctx.fillRect(0, -21 + breath, 3, 1)

    // Ojos vivos con brillo blanco
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-3, -25 + breath, 2, 2)
    ctx.fillRect(3, -25 + breath, 2, 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-3, -25 + breath, 1, 1)
    ctx.fillRect(3, -25 + breath, 1, 1)

    drawHelmetDomeToCtx(ctx, -9, -31 + breath, 18, 20, '#5ef0ff', 'rgba(94, 240, 255, 0.16)')

    const armSwing = isInteracting ? 6 : Math.round(-stride * 3)
    const armY = isInteracting ? -6 + breath : -5 + breath
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(2, armY - 1, 10 + (isInteracting ? 4 : Math.max(0, Math.round(armSwing * 0.4))), 6)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(3, armY, 5 + (isInteracting ? 4 : 0), 4)
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(3, armY, 3, 2)
    ctx.fillStyle = '#475569'
    ctx.fillRect(7 + (isInteracting ? 4 : Math.round(armSwing * 0.4)), armY, 3, 4)
  } else if (role === 'comms') {
    for (let seg = 24; seg >= 0; seg--) {
      const tNorm = seg / 24
      const wave = Math.sin(seg * 0.5 - wavePhase) * (isWalking ? 5.5 : 3.4)
      const sx = -tNorm * 16 + wave * (0.35 + tNorm * 0.65)
      const sy =
        seg < 8
          ? -10 + seg * 2.2 + breath
          : 7 + Math.sin(seg * 0.35 - wavePhase * 0.7) * 2.2 + (seg - 8) * 0.38
      const radius = Math.max(2.5, 6.2 - tNorm * 3.8)
      const rx = Math.round(sx - radius)
      const ry = Math.round(sy - radius * 0.8)
      const rw = Math.round(radius * 2)
      const rh = Math.round(radius * 1.6)

      ctx.fillStyle = ATLAS_OUTLINE
      ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2)

      const isDarkBand = seg % 4 === 0
      ctx.fillStyle = isDarkBand ? '#1e293b' : seg % 2 === 0 ? '#ea580c' : '#f97316'
      ctx.fillRect(rx, ry, rw, rh)
      if (!isDarkBand) {
        ctx.fillStyle = '#fdba74'
        ctx.fillRect(
          Math.round(sx - radius * 0.4),
          Math.round(sy - radius * 0.4),
          Math.round(radius),
          Math.round(radius * 0.8)
        )
      }
    }

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-7, -13 + breath, 15, 10)
    ctx.fillStyle = '#64748b'
    ctx.fillRect(-6, -12 + breath, 13, 8)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-5, -11 + breath, 11, 6)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-3, -10 + breath, 7, 4)
    ctx.fillStyle = poseIdx % 2 === 0 ? '#38bdf8' : '#22c55e'
    ctx.fillRect(-2, -9 + breath, 2, 2)
    ctx.fillStyle = '#fbbf24'
    ctx.fillRect(1, -9 + breath, 2, 2)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-7, -24 + breath, 15, 11)
    ctx.fillStyle = '#ea580c'
    ctx.fillRect(-6, -23 + breath, 13, 9)
    ctx.fillStyle = '#fb923c'
    ctx.fillRect(-5, -22 + breath, 12, 6)
    ctx.fillStyle = '#9a3412'
    ctx.fillRect(-4, -23 + breath, 8, 2)

    ctx.fillStyle = '#fde047'
    ctx.fillRect(-2, -20 + breath, 3, 3)
    ctx.fillRect(3, -20 + breath, 3, 3)
    ctx.fillStyle = '#000000'
    ctx.fillRect(-1, -20 + breath, 1, 3)
    ctx.fillRect(4, -20 + breath, 1, 3)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-2, -20 + breath, 1, 1)
    ctx.fillRect(3, -20 + breath, 1, 1)

    if (poseIdx % 2 === 1 || isInteracting) {
      const ext = isInteracting ? 2 : 1
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(7, -17 + breath, 4 + ext, 2)
      ctx.fillRect(10 + ext, -18 + breath, 2, 1)
      ctx.fillRect(10 + ext, -15 + breath, 2, 1)
    }

    drawHelmetDomeToCtx(ctx, -9, -26 + breath, 19, 15, '#74b9ff', 'rgba(116, 185, 255, 0.17)')
  } else if (role === 'science') {
    const legL = Math.round(stride * 4)
    const legR = Math.round(-stride * 4)

    for (let s = 0; s < 10; s++) {
      const tx = -7 - s * 1.7
      const ty = 2 + Math.sin(wavePhase - s * 0.45) * 3.0 - s * 0.3
      ctx.fillStyle = ATLAS_OUTLINE
      ctx.fillRect(Math.round(tx) - 1, Math.round(ty) - 1, 5, 5)
      ctx.fillStyle = s > 7 ? '#451a03' : s % 2 === 0 ? '#d97706' : '#f59e0b'
      ctx.fillRect(Math.round(tx), Math.round(ty), 3, 3)
    }

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-12, -13 + breath, 8, 17)
    ctx.fillStyle = '#64748b'
    ctx.fillRect(-11, -12 + breath, 6, 15)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-10, -11 + breath, 4, 12)
    ctx.fillStyle = '#55efc4'
    ctx.fillRect(-9, -8 + breath, 2, 4)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(Math.round(-8 + legL * 0.6), 2, 8, 14 + Math.max(0, legL))
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(Math.round(-6 + legL * 0.6), 3, 5, 9 + Math.max(0, legL))
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(Math.round(-6 + legL * 0.6), 5, 5, 2)
    ctx.fillStyle = '#334155'
    ctx.fillRect(Math.round(-7 + legL * 0.6), 11 + Math.max(0, legL), 7, 4)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(Math.round(0 + legR * 0.6), 2, 8, 14 + Math.max(0, legR))
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(Math.round(1 + legR * 0.6), 3, 6, 9 + Math.max(0, legR))
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(Math.round(1 + legR * 0.6), 5, 6, 2)
    ctx.fillStyle = '#475569'
    ctx.fillRect(Math.round(1 + legR * 0.6), 11 + Math.max(0, legR), 6, 4)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-9, -12 + breath, 18, 17)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-8, -11 + breath, 16, 15)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-7, -10 + breath, 14, 12)
    ctx.fillStyle = '#2563eb'
    ctx.fillRect(-8, -9 + breath, 4, 4)
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(4, -9 + breath, 4, 3)
    ctx.fillStyle = '#1e3a8a'
    ctx.fillRect(-3, -7 + breath, 6, 5)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(-2, -6 + breath, 4, 3)
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(-8, 1 + breath, 16, 3)
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(-2, 1 + breath, 4, 3)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-7, -26 + breath, 5, 5)
    ctx.fillRect(2, -26 + breath, 5, 5)
    ctx.fillStyle = '#b45309'
    ctx.fillRect(-6, -25 + breath, 3, 3)
    ctx.fillRect(3, -25 + breath, 3, 3)
    ctx.fillStyle = '#d97706'
    ctx.fillRect(-6, -23 + breath, 12, 11)
    ctx.fillStyle = '#f59e0b'
    ctx.fillRect(-5, -22 + breath, 10, 9)
    ctx.fillStyle = '#fef3c7'
    ctx.fillRect(-3, -17 + breath, 7, 4)
    ctx.fillStyle = '#451a03'
    ctx.fillRect(0, -17 + breath, 3, 2)
    ctx.fillStyle = '#bef264'
    ctx.fillRect(-4, -20 + breath, 3, 2)
    ctx.fillRect(2, -20 + breath, 3, 2)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-3, -20 + breath, 1, 2)
    ctx.fillRect(3, -20 + breath, 1, 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-4, -20 + breath, 1, 1)
    ctx.fillRect(2, -20 + breath, 1, 1)

    drawHelmetDomeToCtx(ctx, -9, -26 + breath, 18, 16, '#55efc4', 'rgba(85, 239, 196, 0.16)')

    const armAngle = isInteracting ? -4 : Math.round(stride * 2)
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(4, -6 + breath, 7, 6)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(5, -5 + breath, 5, 4)
    ctx.fillStyle = '#334155'
    ctx.fillRect(8, -4 + breath, 3, 3)

    ctx.strokeStyle = ATLAS_OUTLINE
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(9, -3 + breath)
    ctx.lineTo(15, 6 + armAngle)
    ctx.stroke()
    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(9, -3 + breath)
    ctx.lineTo(15, 6 + armAngle)
    ctx.stroke()
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(11, 3 + armAngle, 8, 5)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(12, 4 + armAngle, 6, 3)
  } else {
    const legL = Math.round(stride * 3.5)
    const legR = Math.round(-stride * 3.5)
    const wingFlap = isWalking
      ? (poseIdx % 2 === 0 ? 4 : -2)
      : isInteracting
      ? (poseIdx % 2 === 0 ? 5 : -1)
      : poseIdx % 2 === 0
      ? 1
      : -1

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-7, 4 + breath, 14, 8)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-6, 5 + breath, 12, 6)
    ctx.fillStyle = '#334155'
    ctx.fillRect(-4, 6 + breath, 8, 4)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(Math.round(-8 + legL * 0.5), 6, 8, 9 + Math.max(0, legL))
    ctx.fillRect(Math.round(0 + legR * 0.5), 6, 8, 9 + Math.max(0, legR))
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(Math.round(-5 + legL * 0.5), 7, 3, 6 + Math.max(0, legL))
    ctx.fillRect(Math.round(2 + legR * 0.5), 7, 3, 6 + Math.max(0, legR))
    ctx.fillStyle = '#eab308'
    ctx.fillRect(Math.round(-7 + legL * 0.5), 12 + Math.max(0, legL), 6, 2)
    ctx.fillRect(Math.round(1 + legR * 0.5), 12 + Math.max(0, legR), 6, 2)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-22, -8 + breath - wingFlap, 16, 17)
    ctx.fillRect(6, -8 + breath - wingFlap, 16, 17)
    ctx.fillStyle = '#ea580c'
    ctx.fillRect(-17, Math.round(-7 + breath - wingFlap * 0.6), 11, 6)
    ctx.fillRect(6, Math.round(-7 + breath - wingFlap * 0.6), 11, 6)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(-19, Math.round(-2 + breath - wingFlap * 0.8), 12, 4)
    ctx.fillRect(7, Math.round(-2 + breath - wingFlap * 0.8), 12, 4)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-21, 1 + breath - wingFlap, 13, 6)
    ctx.fillRect(8, 1 + breath - wingFlap, 13, 6)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-8, -10 + breath, 16, 17)
    ctx.fillStyle = '#c2410c'
    ctx.fillRect(-7, -9 + breath, 14, 15)
    ctx.fillStyle = '#f97316'
    ctx.fillRect(-6, -8 + breath, 12, 13)
    ctx.fillStyle = '#fdba74'
    ctx.fillRect(-5, -8 + breath, 4, 5)
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(-6, -2 + breath, 12, 3)
    ctx.fillStyle = '#ffd23f'
    ctx.fillRect(-2, -5 + breath, 4, 4)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-8, -14 + breath, 16, 6)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-7, -13 + breath, 14, 5)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-6, -10 + breath, 12, 2)

    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(-5, -25 + breath, 10, 13)
    ctx.fillStyle = '#be123c'
    ctx.fillRect(-4, -22 + breath, 8, 9)
    ctx.fillStyle = '#e11d48'
    ctx.fillRect(-3, -24 + breath, 5, 3)
    ctx.fillStyle = ATLAS_OUTLINE
    ctx.fillRect(3, -20 + breath, 6, 5)
    ctx.fillStyle = '#fde047'
    ctx.fillRect(3, -19 + breath, 5, 3)
    ctx.fillRect(6, -17 + breath, 2, 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, -20 + breath, 2, 2)
    ctx.fillStyle = '#000000'
    ctx.fillRect(1, -20 + breath, 1, 1)

    drawHelmetDomeToCtx(ctx, -8, -26 + breath, 17, 15, '#ffd23f', 'rgba(255, 210, 63, 0.16)')
  }
}

function createStationSpriteAtlas(): StationSpriteAtlas {
  const buildCharSheet = (role: RoleId) => {
    const sheet = document.createElement('canvas')
    sheet.width = CHAR_SPRITE_CELL * 8
    sheet.height = CHAR_SPRITE_CELL
    const sctx = sheet.getContext('2d')
    if (sctx) {
      sctx.imageSmoothingEnabled = false
      const frames: { kind: 'idle' | 'walk' | 'work'; idx: number }[] = [
        { kind: 'idle', idx: 0 },
        { kind: 'idle', idx: 1 },
        { kind: 'walk', idx: 0 },
        { kind: 'walk', idx: 1 },
        { kind: 'walk', idx: 2 },
        { kind: 'walk', idx: 3 },
        { kind: 'work', idx: 0 },
        { kind: 'work', idx: 1 },
      ]
      frames.forEach((f, col) => {
        sctx.save()
        sctx.translate(col * CHAR_SPRITE_CELL + 32, 42)
        paintAstronautPoseToAtlas(sctx, role, f.kind, f.idx)
        sctx.restore()
      })
    }
    return sheet
  }

  const characterSheets: Record<RoleId, HTMLCanvasElement> = {
    director: buildCharSheet('director'),
    engineer: buildCharSheet('engineer'),
    science: buildCharSheet('science'),
    comms: buildCharSheet('comms'),
  }

  // Mobiliario temático 16-bits con pixelSize entero uniforme (px = 2) y contornos oscuros #070b12
  const PX = 2
  const furniture: Record<FurnitureSpriteId, HTMLCanvasElement> = {
    // 1. DIRECTOR (CÓNDOR-4)
    nasaBookshelf: createPixelGridSprite(26, 22, PX, (p) => {
      p(0, 0, 26, 22, ATLAS_OUTLINE)
      p(1, 1, 24, 20, '#334155')
      p(2, 2, 22, 18, '#1e293b')
      for (const sy of [6, 12, 18]) {
        p(2, sy, 22, 1, '#475569')
      }
      const colors = ['#ef4444', '#38bdf8', '#fbbf24', '#e2e8f0', '#2563eb', '#f97316']
      for (let i = 0; i < 6; i++) {
        p(3 + i * 3, 2, 2, 4, colors[i % colors.length])
        p(4 + i * 3, 8, 2, 4, colors[(i + 2) % colors.length])
        p(3 + i * 3, 14, 2, 4, colors[(i + 4) % colors.length])
      }
      p(20, 15, 3, 3, '#ffd23f')
    }),
    commanderChair: createPixelGridSprite(16, 18, PX, (p) => {
      p(1, 1, 14, 16, ATLAS_OUTLINE)
      p(2, 2, 12, 10, '#1e293b')
      p(3, 2, 10, 2, '#ffd23f')
      p(3, 4, 10, 6, '#334155')
      p(1, 9, 2, 6, '#64748b')
      p(13, 9, 2, 6, '#64748b')
      p(3, 11, 10, 4, '#475569')
      p(6, 15, 4, 2, '#94a3b8')
    }),
    dockingSimulator: createPixelGridSprite(26, 22, PX, (p) => {
      p(0, 0, 26, 22, ATLAS_OUTLINE)
      p(1, 1, 24, 20, '#334155')
      p(2, 2, 22, 11, '#0f172a')
      p(3, 3, 20, 9, '#0284c7')
      p(11, 4, 4, 7, '#fde047')
      p(9, 6, 8, 3, '#fde047')
      p(12, 7, 2, 1, '#0f172a')
      p(2, 14, 22, 6, '#475569')
      p(5, 13, 2, 5, '#cbd5e1')
      p(4, 12, 4, 2, '#ef4444')
      p(11, 15, 10, 3, '#1e293b')
      p(12, 16, 3, 1, '#4ade80')
      p(17, 16, 3, 1, '#ffd23f')
    }),
    secondaryOrbitalMonitor: createPixelGridSprite(22, 18, PX, (p) => {
      p(0, 2, 22, 16, ATLAS_OUTLINE)
      p(1, 3, 20, 14, '#252c37')
      p(2, 0, 18, 10, ATLAS_OUTLINE)
      p(3, 1, 16, 8, '#082f49')
      p(4, 4, 14, 1, '#38bdf8')
      p(6, 3, 4, 3, '#fde047')
      p(12, 5, 5, 2, '#4ade80')
      p(3, 11, 16, 4, '#334155')
      p(4, 12, 10, 2, '#64748b')
      p(16, 12, 2, 2, '#22c55e')
    }),

    // 2. ENGINEER (ALPACA-1)
    toolWorkbench: createPixelGridSprite(28, 18, PX, (p) => {
      p(0, 2, 28, 16, ATLAS_OUTLINE)
      p(1, 3, 26, 14, '#475569')
      p(2, 4, 24, 6, '#64748b')
      p(4, 5, 8, 2, '#cbd5e1')
      p(11, 4, 3, 4, '#cbd5e1')
      p(16, 5, 6, 3, '#f97316')
      p(22, 6, 3, 1, '#fde047')
      p(2, 11, 11, 5, '#334155')
      p(15, 11, 11, 5, '#334155')
      p(6, 13, 3, 1, '#facc15')
      p(19, 13, 3, 1, '#facc15')
    }),
    oscilloscopeBench: createPixelGridSprite(24, 18, PX, (p) => {
      p(0, 2, 24, 16, ATLAS_OUTLINE)
      p(1, 3, 22, 14, '#334155')
      p(2, 0, 14, 10, ATLAS_OUTLINE)
      p(3, 1, 12, 8, '#042f1e')
      p(4, 5, 2, 1, '#4ade80')
      p(6, 3, 2, 2, '#4ade80')
      p(8, 5, 2, 2, '#4ade80')
      p(10, 3, 4, 2, '#fde047')
      p(17, 2, 5, 7, '#0f172a')
      p(18, 3, 3, 2, '#fb923c')
      p(18, 6, 3, 2, '#38bdf8')
      p(2, 11, 20, 5, '#475569')
      p(4, 13, 5, 2, '#fbbf24')
      p(12, 13, 8, 2, '#94a3b8')
    }),
    sparePartsCabinet: createPixelGridSprite(20, 22, PX, (p) => {
      p(0, 0, 20, 22, ATLAS_OUTLINE)
      p(1, 1, 18, 20, '#334155')
      p(2, 2, 16, 18, '#475569')
      for (let r = 0; r < 4; r++) {
        p(3, 3 + r * 4, 14, 3, r === 1 ? '#ea580c' : '#1e293b')
        p(8, 4 + r * 4, 4, 1, '#facc15')
      }
      p(3, 19, 14, 1, '#64748b')
    }),
    auxBatteryBank: createPixelGridSprite(24, 16, PX, (p) => {
      p(0, 0, 24, 16, ATLAS_OUTLINE)
      p(1, 1, 22, 14, '#1e293b')
      for (let b = 0; b < 3; b++) {
        p(2 + b * 7, 2, 6, 12, '#0f172a')
        p(3 + b * 7, 3, 4, 3, '#4ade80')
        p(3 + b * 7, 7, 4, 3, '#22c55e')
        p(3 + b * 7, 11, 4, 2, '#facc15')
      }
    }),
    thermalDiagPanel: createPixelGridSprite(24, 14, PX, (p) => {
      p(0, 0, 24, 14, ATLAS_OUTLINE)
      p(1, 1, 22, 12, '#334155')
      p(2, 2, 20, 10, '#0f172a')
      p(3, 3, 6, 8, '#0284c7')
      p(9, 4, 6, 6, '#f97316')
      p(11, 5, 3, 4, '#fde047')
      p(16, 3, 5, 8, '#1e293b')
      p(17, 4, 3, 2, '#ef4444')
      p(17, 8, 3, 2, '#4ade80')
    }),
    techBunk: createPixelGridSprite(26, 18, PX, (p) => {
      p(0, 0, 26, 18, ATLAS_OUTLINE)
      p(1, 1, 24, 16, '#334155')
      p(2, 3, 22, 12, '#1e293b')
      p(3, 4, 6, 10, '#f8fafc')
      p(9, 4, 14, 10, '#1d4ed8')
      p(9, 4, 3, 10, '#38bdf8')
      p(2, 1, 4, 2, '#fde047')
    }),

    // 3. SCIENCE (PUMA-3)
    geoGlacierShelf: createPixelGridSprite(24, 22, PX, (p) => {
      p(0, 0, 24, 22, ATLAS_OUTLINE)
      p(1, 1, 22, 20, '#334155')
      p(2, 2, 20, 18, '#0f172a')
      p(2, 9, 20, 2, '#475569')
      p(2, 16, 20, 2, '#475569')
      for (let i = 0; i < 4; i++) {
        p(3 + i * 5, 3, 3, 6, '#67e8f9')
        p(4 + i * 5, 4, 1, 4, '#ffffff')
      }
      p(3, 12, 4, 4, '#d97706')
      p(9, 11, 5, 5, '#94a3b8')
      p(16, 12, 5, 4, '#10b981')
    }),
    botanicalIncubator: createPixelGridSprite(18, 22, PX, (p) => {
      p(0, 0, 18, 22, ATLAS_OUTLINE)
      p(1, 1, 16, 4, '#334155')
      p(1, 17, 16, 4, '#334155')
      p(2, 5, 14, 12, '#064e3b')
      p(3, 6, 12, 10, '#047857')
      p(4, 5, 10, 1, '#f472b6')
      p(8, 10, 2, 6, '#4ade80')
      p(5, 8, 8, 3, '#86efac')
      p(6, 12, 3, 2, '#4ade80')
      p(10, 11, 3, 2, '#4ade80')
      p(4, 18, 10, 2, '#55efc4')
    }),
    scienceWhiteboard: createPixelGridSprite(28, 16, PX, (p) => {
      p(0, 0, 28, 16, ATLAS_OUTLINE)
      p(1, 1, 26, 14, '#cbd5e1')
      p(2, 2, 24, 12, '#f8fafc')
      p(4, 4, 8, 1, '#0284c7')
      p(4, 6, 6, 1, '#ef4444')
      p(4, 8, 9, 1, '#16a34a')
      p(16, 4, 7, 7, '#0f172a')
      p(17, 5, 5, 5, '#38bdf8')
      p(18, 6, 3, 3, '#fde047')
      p(21, 12, 4, 2, '#ef4444')
    }),

    // 4. COMMS (SERPIENTE-2)
    dsnServerRack: createPixelGridSprite(16, 24, PX, (p) => {
      p(0, 0, 16, 24, ATLAS_OUTLINE)
      p(1, 1, 14, 22, '#1e293b')
      for (let i = 0; i < 6; i++) {
        p(2, 2 + i * 3, 12, 2, '#0f172a')
        p(3, 2 + i * 3, 2, 2, i % 2 === 0 ? '#38bdf8' : '#4ade80')
        p(11, 2 + i * 3, 2, 2, i === 2 ? '#ef4444' : '#fbbf24')
      }
      p(3, 20, 10, 2, '#334155')
    }),
    spectrumAnalyzer: createPixelGridSprite(24, 18, PX, (p) => {
      p(0, 2, 24, 16, ATLAS_OUTLINE)
      p(1, 3, 22, 14, '#334155')
      p(2, 1, 20, 10, ATLAS_OUTLINE)
      p(3, 2, 18, 8, '#021d2d')
      p(4, 6, 3, 1, '#74b9ff')
      p(7, 4, 3, 2, '#38bdf8')
      p(10, 7, 3, 2, '#74b9ff')
      p(13, 3, 3, 3, '#fde047')
      p(16, 6, 4, 1, '#38bdf8')
      p(3, 12, 18, 4, '#1e293b')
      p(5, 13, 2, 2, '#4ade80')
      p(9, 13, 2, 2, '#38bdf8')
      p(13, 13, 6, 2, '#cbd5e1')
    }),
    cryptoDevice: createPixelGridSprite(18, 18, PX, (p) => {
      p(0, 0, 18, 18, ATLAS_OUTLINE)
      p(1, 1, 16, 16, '#1e293b')
      p(3, 3, 12, 8, '#052e16')
      p(4, 4, 2, 2, '#4ade80')
      p(8, 4, 2, 2, '#22c55e')
      p(12, 4, 2, 2, '#4ade80')
      p(6, 7, 2, 2, '#fde047')
      p(10, 7, 2, 2, '#4ade80')
      p(3, 12, 12, 4, '#334155')
      p(5, 13, 8, 2, '#38bdf8')
    }),
    dualSatTrackMonitors: createPixelGridSprite(28, 18, PX, (p) => {
      p(0, 3, 28, 15, ATLAS_OUTLINE)
      p(1, 4, 26, 13, '#252c37')
      p(2, 0, 11, 9, ATLAS_OUTLINE)
      p(3, 1, 9, 7, '#3a2a05')
      p(4, 4, 7, 1, '#fde047')
      p(7, 3, 2, 3, '#fde047')
      p(15, 0, 11, 9, ATLAS_OUTLINE)
      p(16, 1, 9, 7, '#082f49')
      p(17, 4, 7, 1, '#22d3ee')
      p(20, 3, 2, 3, '#4ade80')
      p(4, 10, 20, 4, '#0f172a')
      p(6, 11, 12, 2, '#94a3b8')
      p(20, 11, 3, 2, '#38bdf8')
    }),
    receiverAntenna: createPixelGridSprite(16, 20, PX, (p) => {
      p(3, 14, 10, 5, ATLAS_OUTLINE)
      p(4, 15, 8, 3, '#475569')
      p(7, 6, 2, 9, '#94a3b8')
      p(2, 2, 12, 6, ATLAS_OUTLINE)
      p(3, 3, 10, 4, '#cbd5e1')
      p(6, 0, 4, 3, '#fde047')
      p(7, 1, 2, 1, '#38bdf8')
    }),
  }

  // Placas/insignias distintivas de terminales interactivas para diferenciarlas del mobiliario
  const interactive: Record<InteractiveSpriteId, HTMLCanvasElement> = {
    apasRadarBadge: createPixelGridSprite(14, 10, PX, (p) => {
      p(0, 0, 14, 10, ATLAS_OUTLINE)
      p(1, 1, 12, 8, '#78350f')
      p(2, 2, 10, 6, '#fbbf24')
      p(5, 3, 4, 4, '#0f172a')
      p(6, 4, 2, 2, '#fef08a')
    }),
    navTerminalBadge: createPixelGridSprite(14, 10, PX, (p) => {
      p(0, 0, 14, 10, ATLAS_OUTLINE)
      p(1, 1, 12, 8, '#1e3a8a')
      p(2, 2, 10, 6, '#38bdf8')
      p(4, 4, 6, 2, '#ffffff')
      p(6, 2, 2, 6, '#ffffff')
    }),
    epsPanelBadge: createPixelGridSprite(14, 10, PX, (p) => {
      p(0, 0, 14, 10, ATLAS_OUTLINE)
      p(1, 1, 12, 8, '#7c2d12')
      p(2, 2, 10, 6, '#fb923c')
      p(6, 2, 3, 3, '#fef08a')
      p(5, 5, 3, 3, '#fef08a')
    }),
    eclssConsoleBadge: createPixelGridSprite(14, 10, PX, (p) => {
      p(0, 0, 14, 10, ATLAS_OUTLINE)
      p(1, 1, 12, 8, '#064e3b')
      p(2, 2, 10, 6, '#55efc4')
      p(4, 3, 6, 4, '#0f172a')
      p(5, 4, 4, 2, '#4ade80')
    }),
    satCtrlBadge: createPixelGridSprite(14, 10, PX, (p) => {
      p(0, 0, 14, 10, ATLAS_OUTLINE)
      p(1, 1, 12, 8, '#1e293b')
      p(2, 2, 10, 6, '#67e8f9')
      p(3, 4, 2, 2, '#fde047')
      p(6, 3, 2, 4, '#0f172a')
      p(9, 4, 2, 2, '#fde047')
    }),
  }

  return { characterSheets, furniture, interactive }
}

let cachedStationAtlas: StationSpriteAtlas | null = null
function getStationSpriteAtlas(): StationSpriteAtlas | null {
  if (typeof document === 'undefined') return null
  if (!cachedStationAtlas) {
    cachedStationAtlas = createStationSpriteAtlas()
  }
  return cachedStationAtlas
}

function drawAtlasSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  worldX: number,
  worldY: number,
  centered = false
) {
  const prevSmooth = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  const dx = centered ? Math.round(worldX - sprite.width / 2) : Math.round(worldX)
  const dy = centered ? Math.round(worldY - sprite.height / 2) : Math.round(worldY)
  ctx.drawImage(sprite, dx, dy)
  ctx.imageSmoothingEnabled = prevSmooth
}

export function drawAnimatedAstronaut(
  ctx: CanvasRenderingContext2D,
  role: RoleId,
  x: number,
  y: number,
  dir: FacingDir,
  walkFrame: number,
  isInteracting: boolean,
  time: number
) {
  const atlas = getStationSpriteAtlas()
  const isWalking = walkFrame > 0.01 && Math.abs(Math.sin(walkFrame)) > 0.02
  const flipX = dir === 'left' ? -1 : 1

  ctx.save()
  ctx.translate(Math.round(x), Math.round(y))
  ctx.scale(flipX * 1.32, 1.32)
  ctx.imageSmoothingEnabled = false

  if (atlas) {
    const sheet = atlas.characterSheets[role]
    let col = 0
    if (isInteracting) {
      col = 6 + (Math.floor(time * 5) % 2)
    } else if (isWalking) {
      const step = Math.floor((walkFrame / (Math.PI * 0.5)) % 4)
      col = 2 + ((step + 4) % 4)
    } else {
      col = Math.floor(time * 2.2) % 2
    }
    ctx.drawImage(
      sheet,
      col * CHAR_SPRITE_CELL,
      0,
      CHAR_SPRITE_CELL,
      CHAR_SPRITE_CELL,
      -32,
      -42,
      CHAR_SPRITE_CELL,
      CHAR_SPRITE_CELL
    )
  } else {
    paintAstronautPoseToAtlas(ctx, role, isInteracting ? 'work' : isWalking ? 'walk' : 'idle', 0)
  }

  // Efectos vivos ligeros al trabajar (chispas, ondas RF, pulso de escáner o marco táctico)
  if (isInteracting) {
    if (role === 'engineer') {
      const sparkPhase = Math.floor(time * 18) % 3
      ctx.fillStyle = sparkPhase === 0 ? '#fde047' : sparkPhase === 1 ? '#38bdf8' : '#fb923c'
      ctx.fillRect(15, -9, 3, 3)
      ctx.fillRect(18, -4, 2, 2)
      ctx.fillRect(14, -2, 2, 2)
    } else if (role === 'comms') {
      const r1 = 6 + ((time * 24) % 14)
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(12, -18, r1, -0.7, 0.7)
      ctx.stroke()
    } else if (role === 'science') {
      const scanR = 4 + ((time * 22) % 12)
      ctx.strokeStyle = '#55efc4'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(15, 2, scanR, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.strokeStyle = '#ffd23f'
      ctx.lineWidth = 1.5
      ctx.strokeRect(-14, -29, 28, 44)
    }
  }

  ctx.restore()
}

// ============================================================================
// 3. DIBUJO PROCEDURAL DE CARA PIXEL-ART PARA EL HUD RPG (CERO IMG)
// ============================================================================
function drawPixelFaceIcon(
  ctx: CanvasRenderingContext2D,
  role: RoleId,
  x: number,
  y: number,
  size: number,
  time: number
) {
  ctx.save()
  ctx.translate(x, y)
  const s = size / 16

  ctx.fillStyle = '#141c33'
  ctx.fillRect(0, 0, size, size)

  const px = (gx: number, gy: number, gw: number, gh: number, col: string) => {
    ctx.fillStyle = col
    ctx.fillRect(Math.round(gx * s), Math.round(gy * s), Math.ceil(gw * s), Math.ceil(gh * s))
  }

  if (role === 'engineer') {
    px(3, 12, 10, 4, '#e2e8f0')
    px(6, 13, 4, 2, '#ef4444')
    px(5, 2, 2, 3, '#fff8e7')
    px(9, 2, 2, 3, '#fff8e7')
    px(4, 4, 8, 7, '#fff8e7')
    px(5, 6, 2, 2, '#0f172a')
    px(9, 6, 2, 2, '#0f172a')
    px(6, 7, 4, 3, '#f3d5b5')
    px(3, 1, 10, 1, '#5ef0ff')
    px(2, 2, 1, 9, '#5ef0ff')
    px(13, 2, 1, 9, '#5ef0ff')
  } else if (role === 'comms') {
    px(3, 12, 10, 4, '#ea580c')
    px(4, 11, 8, 2, '#94a3b8')
    px(5, 4, 6, 6, '#f97316')
    px(5, 6, 2, 2, '#fde047')
    px(9, 6, 2, 2, '#fde047')
    if (Math.sin(time * 5) > 0) px(7, 9, 2, 3, '#ef4444')
    px(3, 2, 10, 1, '#74b9ff')
    px(2, 3, 1, 8, '#74b9ff')
    px(13, 3, 1, 8, '#74b9ff')
  } else if (role === 'science') {
    px(3, 12, 10, 4, '#f8fafc')
    px(6, 13, 4, 2, '#2563eb')
    px(4, 3, 2, 2, '#b45309')
    px(10, 3, 2, 2, '#b45309')
    px(4, 4, 8, 7, '#d97706')
    px(6, 8, 4, 2, '#fef3c7')
    px(5, 6, 2, 2, '#bef264')
    px(9, 6, 2, 2, '#bef264')
    px(3, 2, 10, 1, '#55efc4')
    px(2, 3, 1, 8, '#55efc4')
    px(13, 3, 1, 8, '#55efc4')
  } else {
    px(2, 11, 12, 5, '#ea580c')
    px(4, 9, 8, 3, '#ffffff')
    px(5, 4, 6, 5, '#be123c')
    px(8, 6, 4, 2, '#fde047')
    px(6, 5, 2, 2, '#ffffff')
    px(3, 2, 10, 1, '#ffd23f')
    px(2, 3, 1, 8, '#ffd23f')
    px(13, 3, 1, 8, '#ffd23f')
  }

  ctx.strokeStyle = '#000'
  ctx.lineWidth = 1.5
  ctx.strokeRect(0, 0, size, size)
  ctx.restore()
}

// ============================================================================
// 4. TRAZADO OCTOGONAL CON CLIPPING PERFECTO Y CASCO DE 3 CAPAS PIXELADAS
// ============================================================================
function traceOctagonPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  bev: number
) {
  ctx.beginPath()
  ctx.moveTo(x + bev, y)
  ctx.lineTo(x + w - bev, y)
  ctx.lineTo(x + w, y + bev)
  ctx.lineTo(x + w, y + h - bev)
  ctx.lineTo(x + w - bev, y + h)
  ctx.lineTo(x + bev, y + h)
  ctx.lineTo(x, y + h - bev)
  ctx.lineTo(x, y + bev)
  ctx.closePath()
}

function drawClippedRoomInteriorAnd3LayerHull(
  ctx: CanvasRenderingContext2D,
  rm: StationRoom,
  time: number,
  overviewMode: boolean
) {
  const { x, y, w, h } = rm.hull
  const outerBev = 38

  // --------------------------------------------------------------------------
  // CAPA 1 DEL CASCO: Borde negro exterior limpio (2px-3px)
  // --------------------------------------------------------------------------
  ctx.fillStyle = '#04070d'
  traceOctagonPath(ctx, x - 3, y - 3, w + 6, h + 6, outerBev + 2)
  ctx.fill()

  // --------------------------------------------------------------------------
  // CAPA 2 DEL CASCO: Biseles metálicos escalonados (#4b596e -> #384252 -> #252c37 -> #161b22)
  // --------------------------------------------------------------------------
  ctx.fillStyle = '#4b596e'
  traceOctagonPath(ctx, x, y, w, h, outerBev)
  ctx.fill()

  ctx.fillStyle = '#384252'
  traceOctagonPath(ctx, x + 2, y + 2, w - 4, h - 4, outerBev - 1)
  ctx.fill()

  ctx.fillStyle = '#252c37'
  traceOctagonPath(ctx, x + 6, y + 6, w - 12, h - 12, outerBev - 3)
  ctx.fill()

  ctx.fillStyle = '#161b22'
  traceOctagonPath(ctx, x + 11, y + 11, w - 22, h - 22, outerBev - 6)
  ctx.fill()

  // Contorno negro interno antes del suelo
  const inX = x + 15
  const inY = y + 15
  const inW = w - 30
  const inH = h - 30
  const inBev = outerBev - 8

  ctx.fillStyle = '#070b12'
  traceOctagonPath(ctx, inX - 2, inY - 2, inW + 4, inH + 4, inBev + 1)
  ctx.fill()

  // --------------------------------------------------------------------------
  // CAPA 3 DEL CASCO: Remaches finos 2x2 cada 12px y placas estructurales a 45°
  // --------------------------------------------------------------------------
  for (let rx = x + outerBev + 6; rx <= x + w - outerBev - 8; rx += 12) {
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(rx, y + 4, 3, 3)
    ctx.fillRect(rx, y + h - 7, 3, 3)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(rx, y + 3, 2, 2)
    ctx.fillRect(rx, y + h - 8, 2, 2)
  }
  for (let ry = y + outerBev + 6; ry <= y + h - outerBev - 8; ry += 12) {
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(x + 4, ry, 3, 3)
    ctx.fillRect(x + w - 7, ry, 3, 3)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(x + 3, ry, 2, 2)
    ctx.fillRect(x + w - 8, ry, 2, 2)
  }

  // Costillas estructurales en los chaflanes a 45°
  const drawCornerRibs = (cx1: number, cy1: number, cx2: number, cy2: number, nx: number, ny: number) => {
    for (const t of [0.22, 0.48, 0.74]) {
      const px = Math.round(cx1 + (cx2 - cx1) * t)
      const py = Math.round(cy1 + (cy2 - cy1) * t)
      ctx.strokeStyle = '#141923'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px + nx * 13, py + ny * 13)
      ctx.stroke()
      ctx.strokeStyle = '#4b596e'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px + 1, py)
      ctx.lineTo(px + nx * 11, py + ny * 11)
      ctx.stroke()
      ctx.fillStyle = '#cbd5e1'
      ctx.fillRect(px + nx * 4 - 1, py + ny * 4 - 1, 2, 2)
    }
  }
  drawCornerRibs(x, y + outerBev, x + outerBev, y, 1, 1)
  drawCornerRibs(x + w - outerBev, y, x + w, y + outerBev, -1, 1)
  drawCornerRibs(x + w, y + h - outerBev, x + w - outerBev, y + h, -1, -1)
  drawCornerRibs(x + outerBev, y + h, x, y + h - outerBev, 1, -1)

  // --------------------------------------------------------------------------
  // CLIPPING OCTOGONAL PARA BALDOSAS 16-BITS, COLUMNAS Y CORNISA DE LEDs CÁLIDOS
  // --------------------------------------------------------------------------
  ctx.save()
  traceOctagonPath(ctx, inX, inY, inW, inH, inBev)
  ctx.clip()

  const startCol = Math.floor(inX / TILE)
  const endCol = Math.ceil((inX + inW) / TILE)
  const startRow = Math.floor(inY / TILE)
  const endRow = Math.ceil((inY + inH) / TILE)

  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      const tx = c * TILE
      const ty = r * TILE
      const checker = (r + c) % 2 === 0

      if (rm.floorStyle === 'lab') {
        ctx.fillStyle = checker ? '#4b5b70' : '#404f63'
        ctx.fillRect(tx, ty, TILE, TILE)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
        ctx.fillRect(tx + 1, ty + 1, TILE - 2, 1)
        ctx.fillRect(tx + 1, ty + 1, 1, TILE - 2)
        ctx.strokeStyle = '#252c37'
        ctx.lineWidth = 1.5
        ctx.strokeRect(tx, ty, TILE, TILE)
        ctx.fillStyle = '#cbd5e1'
        ctx.fillRect(tx + 3, ty + 3, 2, 2)
      } else if (rm.floorStyle === 'hangar') {
        const isPerimeter =
          tx < inX + 36 || tx + TILE > inX + inW - 36 || ty < inY + 72 || ty + TILE > inY + inH - 36
        ctx.fillStyle = checker ? '#343c49' : '#2a323e'
        ctx.fillRect(tx, ty, TILE, TILE)
        if (isPerimeter) {
          ctx.fillStyle = '#eab308'
          ctx.fillRect(tx + 2, ty + 2, 12, 5)
          ctx.fillStyle = '#111827'
          ctx.fillRect(tx + 16, ty + 2, 12, 5)
        }
        ctx.strokeStyle = '#161b22'
        ctx.lineWidth = 1.5
        ctx.strokeRect(tx, ty, TILE, TILE)
      } else if (rm.floorStyle === 'grating') {
        const isElectricalSide = tx >= 1248
        if (isElectricalSide) {
          ctx.fillStyle = checker ? '#2f3847' : '#252c37'
          ctx.fillRect(tx, ty, TILE, TILE)
          ctx.strokeStyle = '#161b22'
          ctx.lineWidth = 1.5
          ctx.strokeRect(tx, ty, TILE, TILE)
          ctx.fillStyle = '#475569'
          ctx.fillRect(tx + 3, ty + 3, 2, 2)
        } else {
          ctx.fillStyle = '#313b4a'
          ctx.fillRect(tx, ty, TILE, TILE)
          ctx.fillStyle = '#141922'
          for (let gy = 4; gy < TILE - 3; gy += 6) {
            for (let gx = 4; gx < TILE - 3; gx += 6) {
              ctx.fillRect(tx + gx, ty + gy, 4, 3)
            }
          }
          ctx.strokeStyle = '#1e2530'
          ctx.lineWidth = 1.5
          ctx.strokeRect(tx, ty, TILE, TILE)
        }
      } else if (rm.floorStyle === 'engine') {
        ctx.fillStyle = checker ? '#2c3442' : '#242b37'
        ctx.fillRect(tx, ty, TILE, TILE)
        ctx.fillStyle = '#161b22'
        ctx.fillRect(tx + 4, ty + 14, TILE - 8, 3)
        ctx.strokeStyle = '#161b22'
        ctx.lineWidth = 1.5
        ctx.strokeRect(tx, ty, TILE, TILE)
      } else if (rm.floorStyle === 'reactor') {
        // Suelo de rejilla metálica oscura industrial con travesaños de acero y bronce
        ctx.fillStyle = '#0d121a'
        ctx.fillRect(tx, ty, TILE, TILE)
        ctx.fillStyle = checker ? '#232b38' : '#1d2430'
        ctx.fillRect(tx, ty, TILE, 3)
        ctx.fillRect(tx, ty + TILE - 3, TILE, 3)
        ctx.fillRect(tx, ty, 3, TILE)
        ctx.fillRect(tx + TILE - 3, ty, 3, TILE)
        for (let gy = 4; gy < TILE - 4; gy += 6) {
          for (let gx = 4; gx < TILE - 4; gx += 6) {
            ctx.fillStyle = '#2e3848'
            ctx.fillRect(tx + gx, ty + gy, 5, 1)
            ctx.fillStyle = '#070a10'
            ctx.fillRect(tx + gx, ty + gy + 1, 4, 4)
            ctx.fillStyle = '#151b26'
            ctx.fillRect(tx + gx + 4, ty + gy + 1, 1, 4)
          }
        }
        ctx.fillStyle = 'rgba(217, 119, 6, 0.16)'
        ctx.fillRect(tx + 1, ty + 1, TILE - 2, 1)
        ctx.strokeStyle = '#0f141d'
        ctx.lineWidth = 1.5
        ctx.strokeRect(tx, ty, TILE, TILE)
        ctx.fillStyle = '#b45309'
        ctx.fillRect(tx + 2, ty + 2, 2, 2)
        ctx.fillRect(tx + TILE - 4, ty + TILE - 4, 2, 2)
      } else {
        // Baldosas 16x16 biseladas estilo GROUND SEGMENT con micro-remaches
        const halfTile = TILE / 2
        for (let sr = 0; sr < 2; sr++) {
          for (let sc = 0; sc < 2; sc++) {
            const stx = tx + sc * halfTile
            const sty = ty + sr * halfTile
            const subChk = (r * 2 + sr + c * 2 + sc) % 2 === 0
            ctx.fillStyle = subChk ? '#252c37' : '#202731'
            ctx.fillRect(stx, sty, halfTile, halfTile)
            ctx.fillStyle = 'rgba(148, 163, 184, 0.08)'
            ctx.fillRect(stx + 1, sty + 1, halfTile - 2, 1)
            ctx.fillRect(stx + 1, sty + 1, 1, halfTile - 2)
            ctx.strokeStyle = '#141922'
            ctx.lineWidth = 1
            ctx.strokeRect(stx + 0.5, sty + 0.5, halfTile - 1, halfTile - 1)
          }
        }
        ctx.strokeStyle = '#313b4b'
        ctx.lineWidth = 1
        ctx.strokeRect(tx + 0.5, ty + 0.5, TILE - 1, TILE - 1)
        ctx.fillStyle = '#475569'
        ctx.fillRect(tx + 2, ty + 2, 2, 2)
      }
    }
  }

  // 2) Pared 3/4 con columnas estructurales biseladas, paneles técnicos y cornisa LED cálida
  const isIndustrialBronze = rm.id === 'power_reactor' || rm.id === 'life_electrical'
  const wallH = 54
  ctx.fillStyle = isIndustrialBronze ? '#151921' : '#161b22'
  ctx.fillRect(inX, inY, inW, wallH)

  const warmGlow = ctx.createLinearGradient(0, inY, 0, inY + wallH)
  warmGlow.addColorStop(0, isIndustrialBronze ? 'rgba(217, 119, 6, 0.24)' : 'rgba(251, 191, 36, 0.17)')
  warmGlow.addColorStop(0.5, isIndustrialBronze ? 'rgba(68, 56, 46, 0.42)' : 'rgba(56, 66, 82, 0.34)')
  warmGlow.addColorStop(1, 'rgba(18, 23, 31, 0.94)')
  ctx.fillStyle = warmGlow
  ctx.fillRect(inX, inY, inW, wallH)

  // Bahías técnicas + columnas estructurales cada 64px (con arcos acero/bronce grabados en Reactor/LifeSupport)
  for (let wx = inX; wx < inX + inW; wx += 32) {
    const isColumn = ((wx - inX) / 32) % 2 === 0
    if (isColumn) {
      ctx.fillStyle = '#141922'
      ctx.fillRect(wx, inY + 8, 12, wallH - 8)
      ctx.fillStyle = isIndustrialBronze ? '#475569' : '#384252'
      ctx.fillRect(wx + 2, inY + 9, 8, wallH - 12)
      ctx.fillStyle = isIndustrialBronze ? '#b45309' : '#4b596e'
      ctx.fillRect(wx + 3, inY + 9, 3, wallH - 13)
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(wx + 4, inY + 18, 4, 18)
      if (isIndustrialBronze) {
        // Grabado bronce/cobre y arcada estructural remachada
        ctx.fillStyle = '#d97706'
        ctx.fillRect(wx + 1, inY + 10, 10, 3)
        ctx.fillRect(wx + 4, inY + 21, 4, 2)
        ctx.fillRect(wx + 4, inY + 30, 4, 2)
        ctx.fillStyle = '#78350f'
        ctx.fillRect(wx + 1, inY + wallH - 10, 10, 8)
      } else {
        ctx.fillStyle = '#252c37'
        ctx.fillRect(wx + 1, inY + wallH - 10, 10, 8)
      }
    }

    // Panel de muro entre columnas
    const px = wx + (isColumn ? 13 : 2)
    const pw = isColumn ? 17 : 28
    ctx.fillStyle = isIndustrialBronze ? '#252a34' : '#232a36'
    ctx.fillRect(px, inY + 11, pw, wallH - 19)
    ctx.fillStyle = isIndustrialBronze ? '#92400e' : '#384252'
    ctx.fillRect(px, inY + 11, pw, 2)
    ctx.fillStyle = '#161b22'
    ctx.fillRect(px + 2, inY + 28, pw - 4, 2)
    if (isIndustrialBronze && !isColumn) {
      // Detalle grabado en arco de bronce sobre bahías industriales
      ctx.strokeStyle = '#b45309'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(px + pw / 2, inY + 28, Math.floor(pw / 2) - 3, Math.PI, 0)
      ctx.stroke()
    }

    if (((wx - inX) / 32) % 3 === 1) {
      ctx.fillStyle = '#090d16'
      ctx.fillRect(px + 6, inY + 17, 10, 6)
      ctx.fillStyle = Math.sin(time * 4 + wx) > 0 ? '#38bdf8' : '#22c55e'
      ctx.fillRect(px + 8, inY + 19, 3, 2)
      ctx.fillStyle = '#fbbf24'
      ctx.fillRect(px + 12, inY + 19, 2, 2)
    }
  }

  // Cornisa superior continua con tira fina de luces LED cálidas ámbar
  ctx.fillStyle = '#252c37'
  ctx.fillRect(inX, inY, inW, 9)
  ctx.fillStyle = '#384252'
  ctx.fillRect(inX, inY + 8, inW, 1)
  for (let lx = inX + inBev - 6; lx < inX + inW - inBev + 4; lx += 12) {
    ctx.fillStyle = '#b45309'
    ctx.fillRect(lx, inY + 2, 8, 4)
    ctx.fillStyle = '#f59e0b'
    ctx.fillRect(lx + 1, inY + 2, 6, 3)
    ctx.fillStyle = '#fef08a'
    ctx.fillRect(lx + 2, inY + 3, 4, 1)
  }

  // Zócalo inferior de pared con sombra sobre el piso
  ctx.fillStyle = '#384252'
  ctx.fillRect(inX, inY + wallH - 7, inW, 5)
  ctx.fillStyle = '#070b12'
  ctx.fillRect(inX, inY + wallH - 2, inW, 2)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.40)'
  ctx.fillRect(inX, inY + wallH, inW, 8)

  ctx.restore()

  // En vista mapa completo, etiqueta nítida con contorno 2px fuera de cada sala
  if (overviewMode) {
    ctx.save()
    ctx.font = 'bold 18px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    const tx = Math.round(x + w / 2)
    const ty = Math.round(y - 12)
    ctx.fillStyle = '#000000'
    for (const [ox, oy] of [
      [-2, 0],
      [2, 0],
      [0, -2],
      [0, 2],
      [-2, -2],
      [2, 2],
    ]) {
      ctx.fillText(rm.label, tx + ox, ty + oy)
    }
    ctx.fillStyle = rm.color
    ctx.fillText(rm.label, tx, ty)
    ctx.restore()
  }
}

function drawSpaceStationWorld(
  ctx: CanvasRenderingContext2D,
  time: number,
  state: {
    battery: number
    lifeSupport: number
    dataBuffer: number
    orbitStability: number
    hull: number
    signalQuality: number
    activeEvent: StationEventId
    activeRole: RoleId
    overviewMode: boolean
    nearestConsoleId: string | null
    hoveredConsoleId: string | null
    activeTaskConsoleIds: Set<string>
    doorOpenMap: Record<string, number>
  }
) {
  // 1. FONDO DE ESPACIO PROFUNDO Y ESTRELLAS PARPADEANTES
  ctx.fillStyle = '#040711'
  ctx.fillRect(-600, -600, WORLD_W + 1200, WORLD_H + 1200)

  for (let i = 0; i < 220; i++) {
    const sx = (i * 317 + 43) % WORLD_W
    const sy = (i * 229 + 19) % WORLD_H
    const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(time * (1.1 + (i % 5) * 0.35) + i))
    ctx.fillStyle =
      i % 9 === 0
        ? `rgba(125, 211, 252, ${twinkle})`
        : i % 13 === 0
        ? `rgba(253, 224, 71, ${twinkle})`
        : `rgba(255, 255, 255, ${twinkle})`
    const sz = i % 6 === 0 ? 3 : 2
    ctx.fillRect(sx, sy, sz, sz)
  }

  // 2. LA TIERRA CURVADA AL FONDO DERECHO
  const drawEarthArc = (cx: number, cy: number, r: number) => {
    ctx.save()
    const grad = ctx.createRadialGradient(cx, cy, r - 25, cx, cy, r + 40)
    grad.addColorStop(0, '#1d4ed8')
    grad.addColorStop(0.82, '#38bdf8')
    grad.addColorStop(1, 'rgba(56, 189, 248, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, r + 36, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#1e40af'
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()

    ctx.clip()
    const drift = Math.sin(time * 0.15) * 16
    ctx.fillStyle = '#22c55e'
    ctx.fillRect(cx - r + 40 + drift, cy - 150, 170, 120)
    ctx.fillRect(cx - r + 80 + drift, cy - 20, 150, 140)
    ctx.fillStyle = '#15803d'
    ctx.fillRect(cx - r + 60 + drift, cy - 110, 110, 80)
    ctx.fillStyle = '#a16207'
    ctx.fillRect(cx - r + 75 + drift, cy - 90, 38, 150)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
    ctx.fillRect(cx - r + 25 - drift, cy - 170, 190, 24)
    ctx.fillRect(cx - r + 55 + drift * 0.5, cy + 30, 175, 28)
    ctx.restore()
  }
  drawEarthArc(2480, 140, 410)
  drawEarthArc(2490, 1380, 420)

  // 3. ENORMES ALAS DE PANELES SOLARES AZULES EN EL EXTERIOR
  const drawSolarWing = (
    x: number,
    y: number,
    cols: number,
    rows: number,
    cellW: number,
    cellH: number
  ) => {
    const totalW = cols * (cellW + 6) + 18
    const totalH = rows * (cellH + 6)
    const midX = x + Math.floor(totalW / 2)
    ctx.fillStyle = '#6c7a89'
    ctx.fillRect(midX - 7, y - 36, 14, totalH + 72)

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isRight = c >= cols / 2
        const px = x + c * (cellW + 6) + (isRight ? 18 : 0)
        const py = y + r * (cellH + 6)
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(px - 2, py - 2, cellW + 4, cellH + 4)
        const shimmer = Math.sin(time * 2.5 + r * 0.7 + c * 0.5) > 0.65
        ctx.fillStyle =
          state.activeEvent === 'eclipse' ? '#172554' : shimmer ? '#3b82f6' : '#1d4ed8'
        ctx.fillRect(px, py, cellW, cellH)
        ctx.fillStyle = '#60a5fa'
        ctx.fillRect(px + Math.floor(cellW / 2), py, 2, cellH)
        ctx.fillRect(px, py + Math.floor(cellH / 2), cellW, 2)
      }
    }
  }
  drawSolarWing(24, 140, 5, 4, 28, 44)
  drawSolarWing(2160, 120, 6, 4, 28, 46)
  drawSolarWing(2175, 810, 6, 5, 28, 46)

  // 3b. DOS SATÉLITES DISTINTOS EN LADOS OPUESTOS DE LA ÓRBITA DEL PLANETA
  {
    const ocx = WORLD_W / 2
    const ocy = WORLD_H / 2
    const orx = 1300
    const ory = 860
    const angleSat1 = time * 0.4
    const angleSat2 = time * 0.4 + Math.PI

    ctx.save()
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.2)'
    ctx.lineWidth = 2
    ctx.setLineDash([14, 12])
    ctx.beginPath()
    ctx.ellipse(ocx, ocy, orx, ory, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    // SAT-01 nace en el lado occidental (izquierda); SAT-02 en el oriental (derecha)
    const sat1 = { x: ocx - Math.cos(angleSat1) * orx, y: ocy - Math.sin(angleSat1) * ory }
    const sat2 = { x: ocx - Math.cos(angleSat2) * orx, y: ocy - Math.sin(angleSat2) * ory }

    // ---- SAT-01 AMARU-COMMS: cuerpo hexagonal dorado, plato HGA blanco, 2 paneles solares verticales
    {
      const ang = Math.atan2(ocy - sat1.y, ocx - sat1.x)
      ctx.save()
      ctx.translate(sat1.x, sat1.y)
      ctx.scale(1.5, 1.5)
      for (const d of [-1, 1]) {
        const px = d * 42 - 11
        ctx.fillStyle = '#6c7a89'
        ctx.fillRect(d * 20 - (d < 0 ? 14 : 0), -2, 14, 4)
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(px - 2, -46, 26, 92)
        ctx.fillStyle = '#1d4ed8'
        ctx.fillRect(px, -44, 22, 88)
        ctx.fillStyle = '#60a5fa'
        for (let r = 0; r < 8; r++) ctx.fillRect(px, -44 + r * 11, 22, 1)
        ctx.fillRect(px + 11, -44, 1, 88)
      }
      // Hexágono Kapton dorado
      const hex = (rad: number, col: string) => {
        ctx.fillStyle = col
        ctx.beginPath()
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k + Math.PI / 6
          ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad)
        }
        ctx.closePath()
        ctx.fill()
      }
      hex(22, '#7c5a0a')
      hex(18, '#e0a82e')
      ctx.fillStyle = '#fde047'
      ctx.fillRect(-10, -12, 9, 5)
      ctx.fillRect(3, 4, 8, 4)
      ctx.fillStyle = '#b45309'
      ctx.fillRect(-12, 5, 7, 3)
      // Plato parabólico + ondas cian apuntando al planeta
      ctx.save()
      ctx.rotate(ang)
      ctx.fillStyle = '#334155'
      ctx.fillRect(14, -2, 14, 4)
      ctx.fillStyle = '#94a3b8'
      ctx.beginPath()
      ctx.ellipse(28, 0, 6, 22, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f8fafc'
      ctx.beginPath()
      ctx.ellipse(27, 0, 5, 20, 0, 0, Math.PI * 2)
      ctx.fill()
      for (let k = 0; k < 3; k++) {
        const ph = (time * 0.9 + k / 3) % 1
        ctx.strokeStyle = `rgba(103, 232, 249, ${(1 - ph).toFixed(2)})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(30, 0, 12 + ph * 70, -0.55, 0.55)
        ctx.stroke()
      }
      ctx.restore()
      ctx.restore()

      ctx.save()
      ctx.font = 'bold 10px "Press Start 2P", monospace'
      ctx.textAlign = 'center'
      const t1 = 'SAT-01 AMARU-COMMS'
      const w1 = ctx.measureText(t1).width + 12
      ctx.fillStyle = 'rgba(9, 13, 26, 0.85)'
      ctx.fillRect(sat1.x - w1 / 2, sat1.y + 78, w1, 18)
      ctx.fillStyle = '#fde047'
      ctx.fillText(t1, sat1.x, sat1.y + 91)
      ctx.restore()
    }

    // ---- SAT-02 INTI-SCIENCE: cilindro plateado/azul, lente multiespectral, láser verde, 4 alas en X
    {
      const ang = Math.atan2(ocy - sat2.y, ocx - sat2.x)
      ctx.save()
      ctx.translate(sat2.x, sat2.y)
      ctx.scale(1.5, 1.5)
      ctx.rotate(ang)
      // 4 alas solares desplegadas en "X"
      for (let k = 0; k < 4; k++) {
        ctx.save()
        ctx.translate(-10, 0)
        ctx.rotate(Math.PI / 4 + (k * Math.PI) / 2)
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(12, -9, 48, 18)
        ctx.fillStyle = '#2563eb'
        ctx.fillRect(14, -7, 44, 14)
        ctx.fillStyle = '#93c5fd'
        ctx.fillRect(14, 0, 44, 1)
        for (let c = 0; c < 5; c++) ctx.fillRect(22 + c * 9, -7, 1, 14)
        ctx.restore()
      }
      // Cuerpo cilíndrico
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(-36, -13, 52, 26)
      ctx.fillStyle = '#cbd5e1'
      ctx.fillRect(-35, -12, 50, 24)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(-35, -12, 50, 4)
      ctx.fillStyle = '#2563eb'
      ctx.fillRect(-24, -12, 6, 24)
      ctx.fillRect(-6, -12, 6, 24)
      ctx.fillStyle = '#64748b'
      ctx.fillRect(-35, 8, 50, 4)
      // Lente óptico multiespectral gigante en la punta
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(20, 0, 16, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#0284c7'
      ctx.beginPath()
      ctx.arc(20, 0, 13, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#67e8f9'
      ctx.beginPath()
      ctx.arc(20, 0, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#a78bfa'
      ctx.beginPath()
      ctx.arc(20, 0, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(15, -8, 3, 3)
      // Haz láser verde escaneando el planeta
      const flick = 0.55 + 0.45 * Math.abs(Math.sin(time * 9))
      ctx.strokeStyle = `rgba(74, 222, 128, ${flick.toFixed(2)})`
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(36, 0)
      ctx.lineTo(260, Math.sin(time * 2) * 26)
      ctx.stroke()
      ctx.fillStyle = '#bbf7d0'
      ctx.fillRect(256, Math.sin(time * 2) * 26 - 3, 6, 6)
      ctx.restore()

      ctx.save()
      ctx.font = 'bold 10px "Press Start 2P", monospace'
      ctx.textAlign = 'center'
      const t2 = 'SAT-02 INTI-SCIENCE'
      const w2 = ctx.measureText(t2).width + 12
      ctx.fillStyle = 'rgba(9, 13, 26, 0.85)'
      ctx.fillRect(sat2.x - w2 / 2, sat2.y + 78, w2, 18)
      ctx.fillStyle = '#67e8f9'
      ctx.fillText(t2, sat2.x, sat2.y + 91)
      ctx.restore()
    }
  }

  // 4. PROPULSORES RCS NARANJAS Y GRISES EN LOS BORDES EXTERIORES DEL CASCO
  const drawRcsThrusterPod = (tx: number, ty: number, dir: 'left' | 'right' | 'up' | 'down') => {
    ctx.save()
    ctx.translate(tx, ty)
    // Soporte metálico gris y cuerpo naranja industrial
    ctx.fillStyle = '#05070d'
    ctx.fillRect(-13, -13, 26, 26)
    ctx.fillStyle = '#6c7a89'
    ctx.fillRect(-11, -11, 22, 22)
    ctx.fillStyle = '#ea580c'
    ctx.fillRect(-8, -8, 16, 16)
    ctx.fillStyle = '#f97316'
    ctx.fillRect(-6, -6, 12, 8)
    // Toberas oscuras
    ctx.fillStyle = '#1e293b'
    if (dir === 'left') ctx.fillRect(-17, -5, 6, 10)
    if (dir === 'right') ctx.fillRect(11, -5, 6, 10)
    if (dir === 'up') ctx.fillRect(-5, -17, 10, 6)
    if (dir === 'down') ctx.fillRect(-5, 11, 10, 6)

    const firing = Math.sin(time * 6 + tx * 0.1) > 0.58
    if (firing) {
      ctx.fillStyle = '#67e8f9'
      if (dir === 'left') ctx.fillRect(-28, -3, 11, 6)
      if (dir === 'right') ctx.fillRect(17, -3, 11, 6)
      if (dir === 'up') ctx.fillRect(-3, -28, 6, 11)
      if (dir === 'down') ctx.fillRect(-3, 17, 6, 11)
    }
    ctx.restore()
  }
  drawRcsThrusterPod(214, 190, 'left')
  drawRcsThrusterPod(182, 620, 'left')
  drawRcsThrusterPod(182, 780, 'left')
  drawRcsThrusterPod(214, 1120, 'left')
  drawRcsThrusterPod(496, 52, 'up')
  drawRcsThrusterPod(980, 52, 'up')
  drawRcsThrusterPod(1790, 52, 'up')
  drawRcsThrusterPod(2090, 220, 'right')
  drawRcsThrusterPod(2060, 580, 'right')
  drawRcsThrusterPod(1200, 1450, 'down')

  // 5. CASCOS OCTOGONALES DE 3 CAPAS CON CLIPPING PERFECTO DE BALDOSAS
  for (const rm of STATION_ROOMS) {
    drawClippedRoomInteriorAnd3LayerHull(ctx, rm, time, state.overviewMode)
  }

  // 6. PASILLOS INDUSTRIALES DE 32x32 CON PAREDES DE 3 CAPAS Y REJILLAS OSCURAS DETALLADAS
  for (const cor of CORRIDORS) {
    const { x, y, w, h } = cor.rect
    if (cor.orientation === 'horizontal') {
      // Paredes superior e inferior de 3 capas sin bloquear los extremos de conexión
      ctx.fillStyle = '#05070d'
      ctx.fillRect(x, y - 12, w, 12)
      ctx.fillRect(x, y + h, w, 12)
      ctx.fillStyle = '#6c7a89'
      ctx.fillRect(x, y - 10, w, 5)
      ctx.fillRect(x, y + h + 5, w, 5)
      ctx.fillStyle = '#2c343e'
      ctx.fillRect(x, y - 5, w, 5)
      ctx.fillRect(x, y + h, w, 5)
    } else {
      // Paredes izquierda y derecha de 3 capas sin bloquear los extremos de conexión
      ctx.fillStyle = '#05070d'
      ctx.fillRect(x - 12, y, 12, h)
      ctx.fillRect(x + w, y, 12, h)
      ctx.fillStyle = '#6c7a89'
      ctx.fillRect(x - 10, y, 5, h)
      ctx.fillRect(x + w + 5, y, 5, h)
      ctx.fillStyle = '#2c343e'
      ctx.fillRect(x - 5, y, 5, h)
      ctx.fillRect(x + w, y, 5, h)
    }

    const cols = Math.floor(w / TILE)
    const rows = Math.floor(h / TILE)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = x + c * TILE
        const ty = r * TILE + y
        ctx.fillStyle = (r + c) % 2 === 0 ? '#4b5563' : '#404956'
        ctx.fillRect(tx, ty, TILE, TILE)
        ctx.strokeStyle = '#2c343e'
        ctx.lineWidth = 1
        ctx.strokeRect(tx + 0.5, ty + 0.5, TILE - 1, TILE - 1)

        // Rejillas oscuras detalladas en el suelo de los pasillos
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(tx + 4, ty + 6, 24, 20)
        ctx.fillStyle = '#334155'
        for (let bar = 8; bar <= 22; bar += 4) {
          ctx.fillRect(tx + 6, ty + bar, 20, 2)
        }
        ctx.fillStyle = '#64748b'
        ctx.fillRect(tx + 5, ty + 7, 2, 2)
        ctx.fillRect(tx + 25, ty + 7, 2, 2)
      }
    }
  }

  // ==========================================================================
  // 7. OBJETOS INTERIORES EN PIXEL-ART DETALLADO (LAS 9 SALAS)
  // ==========================================================================

  // --------------------------------------------------------------------------
  // a) GROUND SEGMENT (Proyector holográfico octogonal isométrico + anillo octogonal
  //    con monitores de ondas/radar y teclados LED, racks finos, CRT OPERATIONAL y cables)
  // --------------------------------------------------------------------------
  {
    // Rejillas de ventilación finas con lamas biseladas y pernos en esquinas
    for (const [vx, vy] of [
      [984, 608],
      [1342, 608],
      [984, 846],
      [1342, 846],
    ]) {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(vx, vy, 36, 28)
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 1.5
      ctx.strokeRect(vx + 0.5, vy + 0.5, 35, 27)
      for (let bar = 4; bar <= 22; bar += 4) {
        ctx.fillStyle = '#252c37'
        ctx.fillRect(vx + 4, vy + bar, 28, 2)
        ctx.fillStyle = '#4b596e'
        ctx.fillRect(vx + 4, vy + bar, 28, 1)
      }
      ctx.fillStyle = '#94a3b8'
      ctx.fillRect(vx + 2, vy + 2, 1.5, 1.5)
      ctx.fillRect(vx + 32.5, vy + 2, 1.5, 1.5)
      ctx.fillRect(vx + 2, vy + 24.5, 1.5, 1.5)
      ctx.fillRect(vx + 32.5, vy + 24.5, 1.5, 1.5)
    }

    // Cables con curvas suaves en píxel fino (vaina oscura + aislamiento + brillo + grapas)
    const drawSmoothCable = (
      x0: number,
      y0: number,
      cx1: number,
      cy1: number,
      cx2: number,
      cy2: number,
      x1: number,
      y1: number,
      coreCol: string,
      shineCol: string
    ) => {
      ctx.lineCap = 'round'
      ctx.strokeStyle = '#070b12'
      ctx.lineWidth = 4.5
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1)
      ctx.stroke()

      ctx.strokeStyle = coreCol
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1)
      ctx.stroke()

      ctx.strokeStyle = shineCol
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0, y0 - 0.6)
      ctx.bezierCurveTo(cx1, cy1 - 0.6, cx2, cy2 - 0.6, x1, y1 - 0.6)
      ctx.stroke()
    }

    // Manojos rojos (izquierda -> anillo) y azules (norte/este -> anillo)
    drawSmoothCable(966, 620, 1044, 620, 1068, 694, 1104, 768, '#dc2626', '#f87171')
    drawSmoothCable(966, 626, 1038, 626, 1062, 704, 1100, 776, '#b91c1c', '#ef4444')
    drawSmoothCable(966, 840, 1042, 840, 1072, 832, 1108, 816, '#dc2626', '#f87171')

    drawSmoothCable(1400, 744, 1344, 744, 1308, 766, 1266, 788, '#2563eb', '#60a5fa')
    drawSmoothCable(1400, 750, 1348, 750, 1314, 774, 1268, 794, '#1d4ed8', '#38bdf8')
    drawSmoothCable(1292, 566, 1292, 646, 1272, 712, 1246, 748, '#2563eb', '#60a5fa')

    // Grapas metálicas con pernos sujetando los cables
    for (const [cxClip, cyClip] of [
      [1018, 620],
      [1022, 837],
      [1352, 744],
      [1289, 622],
    ]) {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(cxClip - 1, cyClip - 1, 9, 9)
      ctx.fillStyle = '#475569'
      ctx.fillRect(cxClip, cyClip, 7, 7)
      ctx.fillStyle = '#cbd5e1'
      ctx.fillRect(cxClip + 1, cyClip + 1, 2, 2)
      ctx.fillRect(cxClip + 4, cyClip + 4, 2, 2)
    }

    // Pantallas verdes CRT en la pared superior derecha (GROUND SEGMENT OPERATIONAL)
    ctx.fillStyle = '#070b12'
    ctx.fillRect(1236, 518, 188, 46)
    ctx.fillStyle = '#2b3444'
    ctx.fillRect(1238, 520, 184, 42)
    ctx.strokeStyle = '#4b596e'
    ctx.lineWidth = 1.5
    ctx.strokeRect(1238.5, 520.5, 183, 41)

    // CRT principal verde ("GROUND SEGMENT" / "OPERATIONAL" nítido en Press Start 2P)
    ctx.fillStyle = '#031a0d'
    ctx.fillRect(1243, 524, 138, 34)
    ctx.strokeStyle = '#16a34a'
    ctx.lineWidth = 1.5
    ctx.strokeRect(1243.5, 524.5, 137, 33)
    // Líneas sutiles de escaneo CRT
    ctx.fillStyle = 'rgba(74, 222, 128, 0.08)'
    for (let sl = 526; sl < 556; sl += 3) {
      ctx.fillRect(1245, sl, 134, 1)
    }
    ctx.save()
    ctx.font = 'bold 8px "Press Start 2P", monospace'
    ctx.textAlign = 'left'
    const crtTx = 1248
    const drawCrtText = (txt: string, ty: number, col: string) => {
      ctx.fillStyle = '#020b05'
      ctx.fillText(txt, crtTx - 1, ty, 128)
      ctx.fillText(txt, crtTx + 1, ty, 128)
      ctx.fillText(txt, crtTx, ty - 1, 128)
      ctx.fillText(txt, crtTx, ty + 1, 128)
      ctx.fillStyle = col
      ctx.fillText(txt, crtTx, ty, 128)
    }
    drawCrtText('GROUND SEGMENT', 535, '#4ade80')
    drawCrtText('OPERATIONAL', 546, '#86efac')
    ctx.restore()
    // Traza animada + barra de actividad CRT
    const crtScanW = Math.round(((Math.sin(time * 3) + 1) / 2) * 102) + 16
    ctx.fillStyle = '#052e16'
    ctx.fillRect(1248, 550, 126, 4)
    ctx.fillStyle = '#4ade80'
    ctx.fillRect(1248, 550, crtScanW, 4)
    ctx.fillStyle = '#bbf7d0'
    ctx.fillRect(1248 + crtScanW - 2, 550, 2, 4)

    // CRT auxiliar derecho (mini radar polar y bandas en verde)
    ctx.fillStyle = '#031a0d'
    ctx.fillRect(1385, 524, 33, 34)
    ctx.strokeStyle = '#16a34a'
    ctx.lineWidth = 1.2
    ctx.strokeRect(1385.5, 524.5, 32, 33)
    const arx = 1401
    const ary = 539
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.5)'
    ctx.beginPath()
    ctx.arc(arx, ary, 10, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(arx, ary, 5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = '#86efac'
    ctx.beginPath()
    ctx.moveTo(arx, ary)
    ctx.lineTo(arx + Math.cos(time * 3) * 10, ary + Math.sin(time * 3) * 10)
    ctx.stroke()
    ctx.fillStyle = Math.sin(time * 6) > 0 ? '#4ade80' : '#14532d'
    ctx.fillRect(1412, 527, 3, 3)

    // CRT verde auxiliar pared superior izquierda (barras espectrales y onda)
    ctx.fillStyle = '#070b12'
    ctx.fillRect(942, 518, 98, 46)
    ctx.fillStyle = '#2b3444'
    ctx.fillRect(944, 520, 94, 42)
    ctx.fillStyle = '#031a0d'
    ctx.fillRect(948, 524, 86, 34)
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 1.2
    ctx.strokeRect(948.5, 524.5, 85, 33)
    for (let bar = 0; bar < 7; bar++) {
      const hBar = 5 + Math.round(((Math.sin(time * 4.5 + bar * 0.9) + 1) / 2) * 18)
      ctx.fillStyle = '#16a34a'
      ctx.fillRect(954 + bar * 11, 553 - hBar, 7, hBar)
      ctx.fillStyle = '#86efac'
      ctx.fillRect(954 + bar * 11, 553 - hBar, 7, 2)
    }

    // Racks finos de servidores con hileras delgadas de LEDs y rejilla superior
    const drawServerRack = (rx: number, ry: number, rw: number, rh: number, seed: number) => {
      ctx.fillStyle = '#05070d'
      ctx.fillRect(rx - 2, ry - 2, rw + 4, rh + 4)
      ctx.fillStyle = '#1c232e'
      ctx.fillRect(rx, ry, rw, rh)
      ctx.strokeStyle = '#4b596e'
      ctx.lineWidth = 1.5
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1)
      // Rejilla superior de ventilación
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(rx + 3, ry + 3, rw - 6, 5)
      ctx.fillStyle = '#475569'
      for (let gx = rx + 5; gx < rx + rw - 6; gx += 4) {
        ctx.fillRect(gx, ry + 4, 2, 3)
      }
      // Hileras finas de servidores 1U con LEDs multicolor
      for (let sy = ry + 11; sy < ry + rh - 7; sy += 7) {
        ctx.fillStyle = '#0b1018'
        ctx.fillRect(rx + 3, sy, rw - 6, 6)
        ctx.fillStyle = '#2a3342'
        ctx.fillRect(rx + 4, sy + 1, rw - 8, 4)
        // Tiradores metálicos laterales
        ctx.fillStyle = '#64748b'
        ctx.fillRect(rx + 4, sy + 1, 2, 4)
        ctx.fillRect(rx + rw - 6, sy + 1, 2, 4)
        // 3 micro-LEDs finos por hoja
        const pA = Math.sin(time * 7 + sy * 0.15 + seed) > 0
        const pB = Math.cos(time * 5.5 + sy * 0.25 + seed) > 0.15
        const pC = Math.sin(time * 9 + sy * 0.4 + seed) > 0.72
        ctx.fillStyle = pA ? '#4ade80' : '#14532d'
        ctx.fillRect(rx + 8, sy + 2, 3, 2)
        ctx.fillStyle = pB ? '#38bdf8' : '#082f49'
        ctx.fillRect(rx + 13, sy + 2, 3, 2)
        ctx.fillStyle = pC ? '#ef4444' : '#fbbf24'
        ctx.fillRect(rx + rw - 11, sy + 2, 3, 2)
        // Ranura de unidad fina
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(rx + 18, sy + 2, Math.max(4, rw - 32), 2)
      }
    }
    drawServerRack(932, 584, 38, 76, 1)
    drawServerRack(932, 780, 38, 114, 2)
    drawServerRack(1394, 686, 38, 134, 3)

    // Proyector Holográfico Octogonal Superior (1184, 628) + Mapa Isométrico nítido flotante
    const hx = 1184
    const hy = 628

    // Cono de luz cian volumétrico con haces laterales definidos
    const coneGrad = ctx.createLinearGradient(hx, hy - 8, hx, hy - 86)
    coneGrad.addColorStop(0, 'rgba(56, 189, 248, 0.36)')
    coneGrad.addColorStop(0.55, 'rgba(34, 211, 238, 0.18)')
    coneGrad.addColorStop(1, 'rgba(56, 189, 248, 0.03)')
    ctx.fillStyle = coneGrad
    ctx.beginPath()
    ctx.moveTo(hx - 20, hy - 6)
    ctx.lineTo(hx + 20, hy - 6)
    ctx.lineTo(hx + 54, hy - 84)
    ctx.lineTo(hx - 54, hy - 84)
    ctx.closePath()
    ctx.fill()

    // Haces diagonales internos finos del proyector
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.25)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hx - 14, hy - 6)
    ctx.lineTo(hx - 48, hy - 82)
    ctx.moveTo(hx + 14, hy - 6)
    ctx.lineTo(hx + 48, hy - 82)
    ctx.moveTo(hx, hy - 6)
    ctx.lineTo(hx, hy - 82)
    ctx.stroke()

    // Base octogonal escalonada metálica con biseles y pernos
    ctx.fillStyle = '#05070d'
    traceOctagonPath(ctx, hx - 32, hy - 14, 64, 32, 10)
    ctx.fill()
    ctx.fillStyle = '#4b596e'
    traceOctagonPath(ctx, hx - 30, hy - 12, 60, 28, 9)
    ctx.fill()
    ctx.fillStyle = '#2a3342'
    traceOctagonPath(ctx, hx - 26, hy - 9, 52, 22, 8)
    ctx.fill()
    ctx.fillStyle = '#18202c'
    traceOctagonPath(ctx, hx - 20, hy - 6, 40, 16, 6)
    ctx.fill()

    // Lente óptico multicapa + LEDs de perímetro
    ctx.fillStyle = '#0284c7'
    traceOctagonPath(ctx, hx - 14, hy - 3, 28, 10, 4)
    ctx.fill()
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(hx - 10, hy - 1, 20, 6)
    ctx.fillStyle = '#e0f2fe'
    ctx.fillRect(hx - 5, hy + 1, 10, 2)
    for (const [bxOff, byOff, col] of [
      [-23, -1, '#38bdf8'],
      [21, -1, '#38bdf8'],
      [-23, 5, '#fbbf24'],
      [21, 5, '#4ade80'],
    ] as const) {
      ctx.fillStyle = col
      ctx.fillRect(hx + bxOff, hy + byOff, 2, 2)
    }

    // Mapa Isométrico nítido flotando dentro del haz de luz cian
    const mapY = hy - 50 + Math.round(Math.sin(time * 2.4) * 2)
    ctx.save()
    // Plano romboidal isométrico de base + cuadrícula fina
    ctx.fillStyle = 'rgba(14, 165, 233, 0.22)'
    ctx.strokeStyle = '#67e8f9'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(hx, mapY - 18)
    ctx.lineTo(hx + 40, mapY)
    ctx.lineTo(hx, mapY + 18)
    ctx.lineTo(hx - 40, mapY)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.strokeStyle = 'rgba(103, 232, 249, 0.45)'
    ctx.lineWidth = 1
    for (const u of [-0.5, 0, 0.5]) {
      ctx.beginPath()
      ctx.moveTo(hx + (u + 1) * 20, mapY + (u - 1) * 9)
      ctx.lineTo(hx + (u - 1) * 20, mapY + (u + 1) * 9)
      ctx.stroke()
    }
    for (const v of [-0.5, 0, 0.5]) {
      ctx.beginPath()
      ctx.moveTo(hx + (-1 - v) * 20, mapY + (-1 + v) * 9)
      ctx.lineTo(hx + (1 - v) * 20, mapY + (1 + v) * 9)
      ctx.stroke()
    }

    // Relieves topográficos isométricos por capas con líneas de elevación
    const drawIsoTerrainPeak = (px: number, py: number, rw: number, rh: number, elev: number, col: string) => {
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.65)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px - rw, py)
      ctx.lineTo(px - rw, py - elev)
      ctx.moveTo(px + rw, py)
      ctx.lineTo(px + rw, py - elev)
      ctx.moveTo(px, py + rh)
      ctx.lineTo(px, py + rh - elev)
      ctx.stroke()

      ctx.fillStyle = col
      ctx.beginPath()
      ctx.moveTo(px, py - rh - elev)
      ctx.lineTo(px + rw, py - elev)
      ctx.lineTo(px, py + rh - elev)
      ctx.lineTo(px - rw, py - elev)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#e0f2fe'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    drawIsoTerrainPeak(hx - 12, mapY + 1, 12, 6, 6, 'rgba(34, 211, 238, 0.85)')
    drawIsoTerrainPeak(hx + 8, mapY - 2, 13, 7, 10, 'rgba(74, 222, 128, 0.85)')
    drawIsoTerrainPeak(hx + 8, mapY - 2, 7, 4, 15, 'rgba(190, 242, 100, 0.92)')

    // Anillos orbitales inclinados + satélite dorado orbitando
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.72)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.ellipse(hx, mapY - 4, 44, 14, -0.14, 0, Math.PI * 2)
    ctx.stroke()
    const orbAng = time * 1.9
    const sxOrb = hx + Math.cos(orbAng) * 44
    const syOrb = mapY - 4 + Math.sin(orbAng) * 14
    ctx.fillStyle = '#fde047'
    ctx.fillRect(Math.round(sxOrb) - 2, Math.round(syOrb) - 2, 4, 4)

    // Línea de escaneo vertical holográfica
    const scanLineY = hy - 80 + ((time * 30) % 68)
    ctx.fillStyle = 'rgba(224, 242, 254, 0.45)'
    ctx.fillRect(hx - 42, Math.round(scanLineY), 84, 1.5)
    ctx.restore()

    // Anillo Central Octogonal de Consolas (escritorio biselado, monitores onda/radar, teclados y sillas)
    const ringX = 1184
    const ringY = 804

    // Sillas de operador estilizadas orientadas hacia el escritorio central
    const chairAngles = [
      -Math.PI * 0.84,
      -Math.PI * 0.16,
      Math.PI * 0.14,
      Math.PI * 0.39,
      Math.PI * 0.61,
      Math.PI * 0.86,
    ]
    for (const ang of chairAngles) {
      const chx = Math.round(ringX + Math.cos(ang) * 98)
      const chy = Math.round(ringY + Math.sin(ang) * 72)
      ctx.save()
      ctx.translate(chx, chy)
      ctx.rotate(ang + Math.PI / 2)
      // Base de silla + cojín asiento + apoyabrazos + respaldo estilizado con LED
      ctx.fillStyle = '#070b12'
      ctx.fillRect(-13, -10, 26, 20)
      ctx.fillStyle = '#252c37'
      ctx.fillRect(-11, -8, 22, 14)
      ctx.fillStyle = '#384252'
      ctx.fillRect(-9, -7, 18, 9)
      // Apoyabrazos laterales
      ctx.fillStyle = '#64748b'
      ctx.fillRect(-12, -6, 3, 11)
      ctx.fillRect(9, -6, 3, 11)
      // Respaldo y franja LED cian lumbar
      ctx.fillStyle = '#475569'
      ctx.fillRect(-10, 4, 20, 5)
      ctx.fillStyle = '#38bdf8'
      ctx.fillRect(-7, 6, 14, 2)
      ctx.restore()
    }

    // Escritorio octogonal con biseles metálicos claros y oscuros y plataforma circular de puente de mando
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.ellipse(ringX, ringY, 134, 96, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.ellipse(ringX, ringY, 126, 90, 0, 0, Math.PI * 2)
    ctx.stroke()

    // Anillo curvo de iluminación de mamparo circular superior en GROUND SEGMENT
    ctx.strokeStyle = '#384252'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(1184, 720, 260, Math.PI * 1.16, Math.PI * 1.84)
    ctx.stroke()

    ctx.fillStyle = '#05070d'
    traceOctagonPath(ctx, ringX - 84, ringY - 62, 168, 124, 38)
    ctx.fill()
    ctx.fillStyle = '#4b596e'
    traceOctagonPath(ctx, ringX - 81, ringY - 59, 162, 118, 36)
    ctx.fill()
    ctx.fillStyle = '#364152'
    traceOctagonPath(ctx, ringX - 78, ringY - 56, 156, 112, 34)
    ctx.fill()
    ctx.fillStyle = '#232b38'
    traceOctagonPath(ctx, ringX - 68, ringY - 48, 136, 96, 29)
    ctx.fill()

    // Pozo interior táctico del escritorio con radar polar animado
    ctx.fillStyle = '#070b12'
    traceOctagonPath(ctx, ringX - 40, ringY - 28, 80, 56, 18)
    ctx.fill()
    ctx.fillStyle = '#08131f'
    traceOctagonPath(ctx, ringX - 37, ringY - 25, 74, 50, 16)
    ctx.fill()
    ctx.strokeStyle = '#0ea5e9'
    ctx.lineWidth = 1.5
    traceOctagonPath(ctx, ringX - 37, ringY - 25, 74, 50, 16)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ringX - 34, ringY)
    ctx.lineTo(ringX + 34, ringY)
    ctx.moveTo(ringX, ringY - 22)
    ctx.lineTo(ringX, ringY + 22)
    ctx.stroke()
    for (const rr of [9, 17, 25]) {
      ctx.strokeStyle = rr === 17 ? 'rgba(74, 222, 128, 0.55)' : 'rgba(56, 189, 248, 0.45)'
      ctx.beginPath()
      ctx.ellipse(ringX, ringY, rr * 1.25, rr * 0.85, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    const ringSweep = time * 2.2
    ctx.strokeStyle = '#4ade80'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(ringX, ringY)
    ctx.lineTo(ringX + Math.cos(ringSweep) * 28, ringY + Math.sin(ringSweep) * 19)
    ctx.stroke()
    ctx.fillStyle = '#fde047'
    ctx.fillRect(ringX + Math.round(Math.cos(time * 0.7) * 16), ringY + Math.round(Math.sin(time * 0.7) * 10), 2, 2)

    // 6 Estaciones sobre el anillo con monitores de ondas/radares finos y teclados LED
    const consoleAngles = [
      -Math.PI * 0.78,
      -Math.PI * 0.22,
      Math.PI * 0.14,
      Math.PI * 0.39,
      Math.PI * 0.61,
      Math.PI * 0.86,
    ]
    consoleAngles.forEach((ang, idx) => {
      const mx = Math.round(ringX + Math.cos(ang) * 56)
      const my = Math.round(ringY + Math.sin(ang) * 40)
      const isGreen = idx % 2 === 0

      // Carcasa biselada del monitor + teclado
      ctx.fillStyle = '#05070d'
      ctx.fillRect(mx - 15, my - 11, 30, 23)
      ctx.fillStyle = '#384252'
      ctx.fillRect(mx - 14, my - 10, 28, 15)
      ctx.fillStyle = isGreen ? '#031d11' : '#062033'
      ctx.fillRect(mx - 12, my - 8, 24, 11)
      ctx.strokeStyle = isGreen ? '#4ade80' : '#22d3ee'
      ctx.lineWidth = 1
      ctx.strokeRect(mx - 12.5, my - 8.5, 25, 12)

      // Gráfica fina distinta por monitor (osciloscopio / radar / órbita / barras)
      const mode = idx % 4
      if (mode === 0) {
        // Gráfica de onda verde fina
        ctx.strokeStyle = '#86efac'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let px = -10; px <= 10; px += 2) {
          const wy = my - 3 + Math.sin(time * 6 + px * 0.55 + idx) * 3.5
          if (px === -10) ctx.moveTo(mx + px, wy)
          else ctx.lineTo(mx + px, wy)
        }
        ctx.stroke()
      } else if (mode === 1) {
        // Radar cian en miniatura
        ctx.strokeStyle = '#22d3ee'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(mx - 4, my - 3, 4, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = '#bae6fd'
        ctx.beginPath()
        ctx.moveTo(mx - 4, my - 3)
        ctx.lineTo(mx - 4 + Math.cos(time * 4 + idx) * 4, my - 3 + Math.sin(time * 4 + idx) * 4)
        ctx.stroke()
        ctx.fillStyle = '#4ade80'
        ctx.fillRect(mx + 3, my - 6, 7, 2)
        ctx.fillRect(mx + 3, my - 2, 5, 2)
      } else if (mode === 2) {
        // Traza orbital sinusoidal + punto dorado
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let px = -10; px <= 10; px += 2) {
          const wy = my - 3 + Math.sin(px * 0.35 + idx) * 3
          if (px === -10) ctx.moveTo(mx + px, wy)
          else ctx.lineTo(mx + px, wy)
        }
        ctx.stroke()
        const dotX = -8 + ((time * 10 + idx * 4) % 16)
        ctx.fillStyle = '#fde047'
        ctx.fillRect(Math.round(mx + dotX), Math.round(my - 3 + Math.sin(dotX * 0.35 + idx) * 3), 2, 2)
      } else {
        // Barras de espectro verde/ámbar
        for (let b = 0; b < 5; b++) {
          const bh = 2 + Math.round(((Math.sin(time * 5 + b + idx) + 1) / 2) * 6)
          ctx.fillStyle = b === 4 ? '#fbbf24' : '#4ade80'
          ctx.fillRect(mx - 10 + b * 4, my + 1 - bh, 3, bh)
        }
      }

      // Teclado pixelado con lucecitas LED debajo del monitor
      ctx.fillStyle = '#161b22'
      ctx.fillRect(mx - 14, my + 5, 28, 6)
      ctx.fillStyle = '#64748b'
      for (let kx = -12; kx <= 4; kx += 3) {
        ctx.fillRect(mx + kx, my + 6, 2, 1.5)
        ctx.fillRect(mx + kx, my + 8.5, 2, 1.5)
      }
      // Barra espaciadora y botones de estado luminosos
      ctx.fillStyle = '#94a3b8'
      ctx.fillRect(mx - 8, my + 10, 10, 1)
      ctx.fillStyle = Math.sin(time * 8 + idx) > 0 ? '#ef4444' : '#fbbf24'
      ctx.fillRect(mx + 7, my + 6, 2, 2)
      ctx.fillStyle = '#4ade80'
      ctx.fillRect(mx + 10, my + 6, 2, 2)
      ctx.fillStyle = '#38bdf8'
      ctx.fillRect(mx + 7, my + 9, 5, 1.5)
    })

    // Mobiliario temático del Director (estantería NASA, silla de mando, monitor orbital)
    const atlasGround = getStationSpriteAtlas()
    if (atlasGround) {
      drawAtlasSprite(ctx, atlasGround.furniture.nasaBookshelf, 1054, 574)
      drawAtlasSprite(ctx, atlasGround.furniture.secondaryOrbitalMonitor, 1344, 868)
      drawAtlasSprite(ctx, atlasGround.furniture.commanderChair, 1168, 866)
      drawAtlasSprite(ctx, atlasGround.furniture.commanderChair, 1086, 728)
    }
  }

  // --------------------------------------------------------------------------
  // b) LAUNCH SEGMENT (Transbordador contorneado, marcas L, brazo naranja, tanques y cápsulas)
  // --------------------------------------------------------------------------
  {
    ctx.fillStyle = '#facc15'
    ctx.fillRect(288, 576, 48, 7)
    ctx.fillRect(288, 576, 7, 48)
    ctx.fillRect(560, 576, 48, 7)
    ctx.fillRect(601, 576, 7, 48)
    ctx.fillRect(288, 785, 48, 7)
    ctx.fillRect(288, 744, 7, 48)
    ctx.fillRect(560, 785, 48, 7)
    ctx.fillRect(601, 744, 7, 48)

    ctx.save()
    ctx.translate(448, 680)
    ctx.scale(1.85, 1.85)
    // Contorno negro + sombra delta
    ctx.fillStyle = '#070b12'
    ctx.beginPath()
    ctx.moveTo(-59, -39)
    ctx.lineTo(13, -16)
    ctx.lineTo(52, 0)
    ctx.lineTo(13, 16)
    ctx.lineTo(-59, 39)
    ctx.closePath()
    ctx.fill()

    // Sombreado térmico de alas
    ctx.fillStyle = '#cbd5e1'
    ctx.beginPath()
    ctx.moveTo(-53, -34)
    ctx.lineTo(10, -12)
    ctx.lineTo(44, 0)
    ctx.lineTo(10, 12)
    ctx.lineTo(-53, 34)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#f8fafc'
    ctx.beginPath()
    ctx.moveTo(-51, -31)
    ctx.lineTo(9, -11)
    ctx.lineTo(42, 0)
    ctx.lineTo(9, 11)
    ctx.lineTo(-51, 31)
    ctx.closePath()
    ctx.fill()

    // Fuselaje con compuertas de carga y cabinas cristal
    ctx.fillStyle = '#e2e8f0'
    ctx.fillRect(-48, -11, 76, 22)
    ctx.strokeStyle = '#64748b'
    ctx.lineWidth = 0.8
    ctx.strokeRect(-44, -9, 54, 18)
    ctx.beginPath()
    ctx.moveTo(-44, 0)
    ctx.lineTo(10, 0)
    ctx.stroke()

    // Parabrisas oscuro + reflejo azul
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(18, -7, 12, 14)
    ctx.fillRect(34, -5, 10, 10)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(20, -5, 4, 4)
    ctx.fillRect(20, 2, 4, 4)
    // Toberas traseras OMS + brillo sutil
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(-62, -9, 9, 6)
    ctx.fillRect(-62, 3, 9, 6)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(-63, -7, 2, 2)
    ctx.fillRect(-63, 5, 2, 2)
    ctx.restore()

    // 2 Cápsulas cian superiores con tapas metálicas atornilladas y brillo cilíndrico
    for (const capX of [592, 648]) {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(capX - 3, 517, 44, 78)
      ctx.fillStyle = '#334155'
      ctx.fillRect(capX - 1, 519, 40, 11)
      ctx.fillRect(capX - 1, 583, 40, 11)
      ctx.fillStyle = '#64748b'
      ctx.fillRect(capX + 1, 521, 36, 3)
      ctx.fillRect(capX + 1, 585, 36, 3)
      ctx.fillStyle = '#0891b2'
      ctx.fillRect(capX + 2, 530, 34, 53)
      ctx.fillStyle = '#22d3ee'
      ctx.fillRect(capX + 5, 532, 22, 49)
      ctx.fillStyle = '#cffafe'
      ctx.fillRect(capX + 7, 534, 5, 44)
    }

    // 2 Tanques grises inferiores con manómetro, válvulas y franjas
    for (const tankX of [256, 312]) {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(tankX - 2, 794, 44, 80)
      ctx.fillStyle = '#475569'
      ctx.fillRect(tankX + 10, 786, 20, 10)
      ctx.fillStyle = '#dc2626'
      ctx.fillRect(tankX + 13, 782, 14, 4)
      ctx.fillStyle = '#64748b'
      ctx.fillRect(tankX, 796, 40, 76)
      ctx.fillStyle = '#94a3b8'
      ctx.fillRect(tankX + 4, 799, 26, 70)
      ctx.fillStyle = '#e2e8f0'
      ctx.fillRect(tankX + 7, 804, 8, 60)
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(tankX, 822, 40, 6)
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(tankX + 25, 804, 10, 10)
      ctx.fillStyle = '#fde047'
      ctx.fillRect(tankX + 27, 806, 6, 6)
    }

    // Brazo robótico hidráulico naranja articulado con pistón cromado y garra
    const armRot = Math.sin(time * 1.8) * 0.24
    ctx.fillStyle = '#070b12'
    ctx.fillRect(590, 802, 60, 42)
    ctx.fillStyle = '#b45309'
    ctx.fillRect(592, 804, 56, 38)
    ctx.fillStyle = '#f59e0b'
    ctx.fillRect(595, 807, 50, 8)
    ctx.save()
    ctx.translate(616, 804)
    ctx.rotate(armRot)
    ctx.fillStyle = '#070b12'
    ctx.fillRect(-76, -14, 82, 22)
    ctx.fillStyle = '#ea580c'
    ctx.fillRect(-74, -12, 78, 18)
    ctx.fillStyle = '#fb923c'
    ctx.fillRect(-72, -10, 74, 5)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(-48, 2, 42, 4)
    ctx.fillStyle = '#facc15'
    ctx.fillRect(-88, -18, 18, 28)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-86, -14, 10, 20)
    ctx.restore()

    // Simulador APAS + manuales de vuelo en Hangar (CÓNDOR-4)
    const atlasLaunch = getStationSpriteAtlas()
    if (atlasLaunch) {
      drawAtlasSprite(ctx, atlasLaunch.furniture.dockingSimulator, 224, 514)
      drawAtlasSprite(ctx, atlasLaunch.furniture.nasaBookshelf, 646, 514)
    }
  }

  // --------------------------------------------------------------------------
  // c) ENGINE ROOM (Turbina horizontal pesada con aletas, plasma y tobera Mach)
  // --------------------------------------------------------------------------
  {
    ctx.fillStyle = '#070b12'
    ctx.beginPath()
    ctx.moveTo(226, 1165)
    ctx.lineTo(162, 1133)
    ctx.lineTo(162, 1267)
    ctx.lineTo(226, 1235)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#1e293b'
    ctx.beginPath()
    ctx.moveTo(224, 1168)
    ctx.lineTo(164, 1136)
    ctx.lineTo(164, 1264)
    ctx.lineTo(224, 1232)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#64748b'
    ctx.lineWidth = 2
    ctx.stroke()

    const flameLen = 36 + Math.sin(time * 18) * 14
    ctx.fillStyle = 'rgba(14, 165, 233, 0.45)'
    ctx.beginPath()
    ctx.moveTo(164, 1146)
    ctx.lineTo(164 - flameLen * 1.25, 1200)
    ctx.lineTo(164, 1254)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(186, 230, 253, 0.85)'
    ctx.beginPath()
    ctx.moveTo(164, 1168)
    ctx.lineTo(164 - flameLen * 0.75, 1200)
    ctx.lineTo(164, 1232)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#070b12'
    ctx.fillRect(270, 1134, 264, 116)
    ctx.fillStyle = '#334155'
    ctx.fillRect(272, 1136, 260, 112)
    ctx.fillStyle = '#475569'
    ctx.fillRect(288, 1150, 228, 84)
    for (let ringX = 308; ringX <= 488; ringX += 36) {
      ctx.fillStyle = '#161b22'
      ctx.fillRect(ringX, 1140, 14, 104)
      ctx.fillStyle = '#64748b'
      ctx.fillRect(ringX + 3, 1142, 4, 100)
    }
    const coreGlow = 0.65 + 0.35 * Math.sin(time * 8)
    ctx.fillStyle = `rgba(249, 115, 22, ${coreGlow})`
    ctx.fillRect(320, 1176, 160, 32)
    ctx.fillStyle = '#fef08a'
    ctx.fillRect(328, 1185, 144, 14)

    // Telemetría de empuje en Sala de Motores (CÓNDOR-4)
    const atlasEngine = getStationSpriteAtlas()
    if (atlasEngine) {
      drawAtlasSprite(ctx, atlasEngine.furniture.secondaryOrbitalMonitor, 612, 1094)
      drawAtlasSprite(ctx, atlasEngine.furniture.commanderChair, 622, 1142)
    }
  }

  // --------------------------------------------------------------------------
  // d) SPACE SEGMENT (Sala circular SERPIENTE-2, ventanal panorámico gigante SAT-01 + planeta bandeado y anillo de consolas)
  // --------------------------------------------------------------------------
  {
    const drawPanoramicSat01Window = (wx: number, wy: number, ww: number, wh: number) => {
      // Marco metálico biselado de lado a lado en la pared superior
      ctx.fillStyle = '#05070d'
      ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8)
      ctx.fillStyle = '#4b596e'
      ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4)
      ctx.fillStyle = '#252c37'
      ctx.fillRect(wx, wy, ww, wh)

      const ix = wx + 5
      const iy = wy + 5
      const iw = ww - 10
      const ih = wh - 10

      ctx.save()
      ctx.beginPath()
      ctx.rect(ix, iy, iw, ih)
      ctx.clip()

      // Espacio profundo + estrellas pixeladas
      ctx.fillStyle = '#030612'
      ctx.fillRect(ix, iy, iw, ih)
      for (let sIdx = 0; sIdx < 48; sIdx++) {
        const sx = ix + ((sIdx * 79 + 11) % iw)
        const sy = iy + ((sIdx * 43 + 7) % ih)
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(time * 1.8 + sIdx))
        ctx.fillStyle = sIdx % 7 === 0 ? `rgba(125, 211, 252, ${tw})` : `rgba(248, 250, 252, ${tw})`
        ctx.fillRect(sx, sy, sIdx % 5 === 0 ? 2 : 1.5, sIdx % 5 === 0 ? 2 : 1.5)
      }

      // Gran planeta bandeado a la derecha del ventanal
      const px = ix + iw * 0.81
      const py = iy + ih * 0.56
      const pr = Math.min(ih * 0.72, 54)
      const atm = ctx.createRadialGradient(px, py, pr - 6, px, py, pr + 12)
      atm.addColorStop(0, 'rgba(251, 146, 60, 0.25)')
      atm.addColorStop(1, 'rgba(56, 189, 248, 0)')
      ctx.fillStyle = atm
      ctx.beginPath()
      ctx.arc(px, py, pr + 12, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.beginPath()
      ctx.arc(px, py, pr, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = '#c26d3a'
      ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2)
      const bandColors = ['#f59e0b', '#fcd34d', '#b45309', '#fed7aa', '#9a3412', '#fbbf24']
      bandColors.forEach((bCol, bIdx) => {
        const by = py - pr + bIdx * Math.round((pr * 2) / bandColors.length)
        ctx.fillStyle = bCol
        ctx.fillRect(px - pr, by, pr * 2, 7)
      })
      // Sombra curvada de fase nocturna planetaria
      ctx.fillStyle = 'rgba(3, 6, 18, 0.42)'
      ctx.beginPath()
      ctx.arc(px + pr * 0.48, py + 6, pr * 1.05, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Satélite SAT-01 con paneles solares azules flotando a la izquierda
      const satX = ix + iw * 0.24
      const satY = iy + ih * 0.52 + Math.sin(time * 1.7) * 3
      ctx.save()
      ctx.translate(satX, satY)
      ctx.rotate(-0.14 + Math.sin(time * 0.9) * 0.04)
      // Alas azules solares izquierda/derecha
      for (const side of [-1, 1]) {
        ctx.fillStyle = '#64748b'
        ctx.fillRect(side * 10 - (side < 0 ? 6 : 0), -1.5, 6, 3)
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(side * 27 - 11, -14, 22, 28)
        ctx.fillStyle = '#1d4ed8'
        ctx.fillRect(side * 27 - 10, -13, 20, 26)
        ctx.fillStyle = '#60a5fa'
        ctx.fillRect(side * 27 - 10, -4, 20, 1)
        ctx.fillRect(side * 27 - 10, 4, 20, 1)
        ctx.fillRect(side * 27, -13, 1, 26)
      }
      // Cuerpo hexagonal dorado + antena parabólica blanca
      ctx.fillStyle = '#b45309'
      ctx.fillRect(-10, -9, 20, 18)
      ctx.fillStyle = '#facc15'
      ctx.fillRect(-8, -7, 16, 14)
      ctx.fillStyle = '#e2e8f0'
      ctx.fillRect(5, -13, 8, 8)
      ctx.fillStyle = '#38bdf8'
      ctx.fillRect(8, -10, 3, 3)
      ctx.restore()

      // Ondas de enlace desde SAT-01 hacia el puente
      for (let wv = 0; wv < 2; wv++) {
        const ph = (time * 0.9 + wv * 0.5) % 1
        ctx.strokeStyle = `rgba(103, 232, 249, ${(0.75 * (1 - ph)).toFixed(2)})`
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(satX + 8, satY + 6, 10 + ph * 22, 0.1, 1.3)
        ctx.stroke()
      }

      // Reflejos diagonales sutiles de cristal blindado
      ctx.fillStyle = 'rgba(186, 230, 253, 0.08)'
      ctx.beginPath()
      ctx.moveTo(ix + iw * 0.16, iy)
      ctx.lineTo(ix + iw * 0.25, iy)
      ctx.lineTo(ix + iw * 0.1, iy + ih)
      ctx.lineTo(ix + iw * 0.01, iy + ih)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      // Montantes verticales metálicos del ventanal panorámico con remaches
      for (const mPos of [0.33, 0.67]) {
        const mx = Math.round(wx + ww * mPos)
        ctx.fillStyle = '#070b12'
        ctx.fillRect(mx - 4, wy, 8, wh)
        ctx.fillStyle = '#4b596e'
        ctx.fillRect(mx - 2, wy + 2, 4, wh - 4)
        ctx.fillStyle = '#cbd5e1'
        ctx.fillRect(mx - 1, wy + 6, 2, 2)
        ctx.fillRect(mx - 1, wy + wh - 8, 2, 2)
      }
    }

    // Ventanal panorámico de lado a lado en SPACE SEGMENT
    drawPanoramicSat01Window(256, 80, 480, 76)

    // Suelo de plataforma circular en perspectiva para el anillo central de consolas
    const sCx = 448
    const sCy = 228
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(sCx, sCy, 92, 56, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.ellipse(sCx, sCy, 84, 50, 0, 0, Math.PI * 2)
    ctx.stroke()

    // Sillas giratorias en el anillo circular
    for (const ang of [-Math.PI * 0.85, -Math.PI * 0.15, Math.PI * 0.22, Math.PI * 0.78]) {
      const chx = Math.round(sCx + Math.cos(ang) * 74)
      const chy = Math.round(sCy + Math.sin(ang) * 44)
      ctx.fillStyle = '#070b12'
      ctx.fillRect(chx - 10, chy - 8, 20, 16)
      ctx.fillStyle = '#334155'
      ctx.fillRect(chx - 8, chy - 6, 16, 11)
      ctx.fillStyle = '#38bdf8'
      ctx.fillRect(chx - 5, chy + 3, 10, 2)
    }

    // Anillo circular central de consolas con múltiples monitores verdes y cian
    ctx.fillStyle = '#05070d'
    ctx.beginPath()
    ctx.ellipse(sCx, sCy, 56, 36, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#384252'
    ctx.beginPath()
    ctx.ellipse(sCx, sCy, 53, 33, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#071422'
    ctx.beginPath()
    ctx.ellipse(sCx, sCy, 30, 18, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#34d399'
    ctx.lineWidth = 1.5
    ctx.stroke()
    // Barrido de órbita central en pozo de consola
    ctx.strokeStyle = '#67e8f9'
    ctx.beginPath()
    ctx.moveTo(sCx, sCy)
    ctx.lineTo(sCx + Math.cos(time * 2.2) * 26, sCy + Math.sin(time * 2.2) * 15)
    ctx.stroke()

    for (let mIdx = 0; mIdx < 6; mIdx++) {
      const mAng = (mIdx * Math.PI) / 3 - 0.3
      const mx = Math.round(sCx + Math.cos(mAng) * 42)
      const my = Math.round(sCy + Math.sin(mAng) * 25)
      const isCyan = mIdx % 2 === 0
      ctx.fillStyle = '#05070d'
      ctx.fillRect(mx - 12, my - 9, 24, 16)
      ctx.fillStyle = isCyan ? '#042f49' : '#032214'
      ctx.fillRect(mx - 10, my - 7, 20, 12)
      ctx.strokeStyle = isCyan ? '#22d3ee' : '#4ade80'
      ctx.lineWidth = 1
      ctx.strokeRect(mx - 10, my - 7, 20, 12)
      ctx.fillStyle = isCyan ? '#67e8f9' : '#4ade80'
      ctx.fillRect(mx - 7, my - 3 + Math.round(Math.sin(time * 5 + mIdx) * 2), 14, 2)
    }

    // Estación secundaria / Filtro de Constelación CubeSat en borde derecho (640, 192 -> com_filter)
    ctx.fillStyle = '#070b12'
    ctx.fillRect(606, 166, 76, 56)
    ctx.fillStyle = '#252c37'
    ctx.fillRect(608, 168, 72, 52)
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 1.5
    ctx.strokeRect(608, 168, 72, 52)
    ctx.fillStyle = '#031d11'
    ctx.fillRect(614, 174, 28, 20)
    ctx.fillRect(646, 174, 28, 20)
    ctx.fillStyle = '#4ade80'
    ctx.fillRect(618, 182 + Math.round(Math.sin(time * 4) * 4), 20, 3)
    ctx.fillStyle = '#67e8f9'
    ctx.fillRect(650, 180, 18, 8)
    // Silla derecha frente a consola lateral
    ctx.fillStyle = '#070b12'
    ctx.fillRect(688, 184, 18, 18)
    ctx.fillStyle = '#334155'
    ctx.fillRect(690, 186, 14, 14)

    // Consola lateral izquierda con silla (x ~ 256, y ~ 200) + Racks de comunicaciones en bordes inferiores
    ctx.fillStyle = '#070b12'
    ctx.fillRect(248, 174, 46, 86)
    ctx.fillStyle = '#2b3444'
    ctx.fillRect(250, 176, 42, 82)
    ctx.fillStyle = '#042f49'
    ctx.fillRect(256, 184, 30, 20)
    ctx.fillStyle = '#031d11'
    ctx.fillRect(256, 214, 30, 20)
    ctx.fillStyle = '#4ade80'
    ctx.fillRect(260, 222, 22, 3)
    ctx.fillStyle = '#22d3ee'
    ctx.fillRect(260, 192, 22, 3)
    // Silla lateral izquierda
    ctx.fillStyle = '#070b12'
    ctx.fillRect(298, 202, 18, 18)
    ctx.fillStyle = '#334155'
    ctx.fillRect(300, 204, 14, 14)

    const atlasSpace = getStationSpriteAtlas()
    if (atlasSpace) {
      drawAtlasSprite(ctx, atlasSpace.furniture.dsnServerRack, 246, 290)
      drawAtlasSprite(ctx, atlasSpace.furniture.spectrumAnalyzer, 578, 308)
      drawAtlasSprite(ctx, atlasSpace.furniture.dsnServerRack, 694, 296)
    }

    // ------------------------------------------------------------------------
    // e) COMMUNICATIONS (Puente circular DSN · SERPIENTE-2 con ventanal panorámico gigante y anillo verde/cian)
    // ------------------------------------------------------------------------
    drawPanoramicSat01Window(896, 80, 416, 74)

    const cCx = 1104
    const cCy = 204
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(cCx, cCy, 98, 56, 0, 0, Math.PI * 2)
    ctx.stroke()

    ctx.fillStyle = '#05070d'
    ctx.beginPath()
    ctx.ellipse(cCx, cCy, 76, 42, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#252c37'
    ctx.beginPath()
    ctx.ellipse(cCx, cCy, 73, 39, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 1.5
    ctx.stroke()

    for (let cm = 0; cm < 5; cm++) {
      const ang = -Math.PI * 0.88 + cm * (Math.PI * 0.44)
      const mx = Math.round(cCx + Math.cos(ang) * 52)
      const my = Math.round(cCy + Math.sin(ang) * 26)
      const gMon = cm % 2 === 0
      ctx.fillStyle = '#070b12'
      ctx.fillRect(mx - 14, my - 10, 28, 18)
      ctx.fillStyle = gMon ? '#032214' : '#042f49'
      ctx.fillRect(mx - 12, my - 8, 24, 14)
      ctx.strokeStyle = gMon ? '#4ade80' : '#22d3ee'
      ctx.strokeRect(mx - 12, my - 8, 24, 14)
      ctx.fillStyle = gMon ? '#4ade80' : '#67e8f9'
      for (let b = 0; b < 4; b++) {
        const bh = 3 + Math.round(((Math.sin(time * 5 + b + cm) + 1) / 2) * 7)
        ctx.fillRect(mx - 9 + b * 5, my + 4 - bh, 3, bh)
      }
    }

    const atlasComms = getStationSpriteAtlas()
    if (atlasComms) {
      drawAtlasSprite(ctx, atlasComms.furniture.dsnServerRack, 892, 166)
      drawAtlasSprite(ctx, atlasComms.furniture.receiverAntenna, 944, 170)
      drawAtlasSprite(ctx, atlasComms.furniture.cryptoDevice, 1226, 170)
      drawAtlasSprite(ctx, atlasComms.furniture.dsnServerRack, 1278, 166)
      drawAtlasSprite(ctx, atlasComms.furniture.dualSatTrackMonitors, 902, 290)
      drawAtlasSprite(ctx, atlasComms.furniture.spectrumAnalyzer, 1226, 290)
    }
  }

  // --------------------------------------------------------------------------
  // f) USER SEGMENT (Sala PUMA-3: 3 cilindros bio cristal + consola curva ADN/gráficas + plataforma hexagonal dorada + ventanal SAT-02)
  // --------------------------------------------------------------------------
  {
    // Tuberías metálicas conectadas a la pared izquierda/superior alimentando los 3 bio-cilindros
    ctx.fillStyle = '#070b12'
    ctx.fillRect(1532, 114, 146, 14)
    ctx.fillRect(1532, 114, 14, 168)
    ctx.fillStyle = '#64748b'
    ctx.fillRect(1534, 116, 142, 10)
    ctx.fillRect(1534, 116, 10, 164)
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(1534, 118, 142, 3)
    ctx.fillRect(1536, 118, 3, 160)
    // Codos y válvulas conectoras por cilindro
    for (const px of [1564, 1608, 1652]) {
      ctx.fillStyle = '#334155'
      ctx.fillRect(px - 6, 124, 12, 20)
      ctx.fillStyle = '#22d3ee'
      ctx.fillRect(px - 2, 128, 4, 6)
    }

    // 3 Cilindros/cápsulas biológicas verticales de cristal a la izquierda (2 verdes, 1 azul cian)
    const drawBioCylinder = (cx: number, cy: number, variant: 'green' | 'cyan', seed: number) => {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(cx - 19, cy - 52, 38, 104)
      // Cúpula superior e inferior metálica con anillos remachados
      ctx.fillStyle = '#475569'
      ctx.fillRect(cx - 17, cy - 50, 34, 14)
      ctx.fillRect(cx - 17, cy + 36, 34, 14)
      ctx.fillStyle = '#94a3b8'
      ctx.fillRect(cx - 14, cy - 48, 28, 4)
      ctx.fillRect(cx - 14, cy + 40, 28, 4)
      ctx.fillStyle = variant === 'green' ? '#4ade80' : '#22d3ee'
      ctx.fillRect(cx - 8, cy - 41, 16, 2)
      ctx.fillRect(cx - 8, cy + 37, 16, 2)

      // Tubo de cristal translúcido + líquido brillante
      ctx.fillStyle = variant === 'green' ? '#064e3b' : '#083344'
      ctx.fillRect(cx - 14, cy - 36, 28, 72)
      ctx.fillStyle = variant === 'green' ? 'rgba(34, 197, 94, 0.78)' : 'rgba(6, 182, 212, 0.80)'
      ctx.fillRect(cx - 12, cy - 34, 24, 68)

      // Muestra orgánica / cristal flotando dentro
      const bob = Math.round(Math.sin(time * 2.3 + seed * 1.4) * 4)
      if (variant === 'green') {
        ctx.fillStyle = '#15803d'
        ctx.fillRect(cx - 3, cy - 8 + bob, 6, 22)
        ctx.fillStyle = '#86efac'
        ctx.fillRect(cx - 8, cy - 16 + bob, 16, 12)
        ctx.fillStyle = '#bbf7d0'
        ctx.fillRect(cx - 5, cy - 20 + bob, 10, 5)
      } else {
        ctx.fillStyle = '#0284c7'
        ctx.fillRect(cx - 6, cy - 14 + bob, 12, 26)
        ctx.fillStyle = '#a5f3fc'
        ctx.fillRect(cx - 3, cy - 18 + bob, 6, 32)
      }

      // Burbujas animadas subiendo + reflejo de cristal
      for (let b = 0; b < 5; b++) {
        const by = cy + 28 - ((time * 26 + b * 14 + seed * 11) % 58)
        const bx = cx - 8 + ((b * 5 + seed * 3) % 16)
        ctx.fillStyle = '#ecfeff'
        ctx.fillRect(bx, Math.round(by), 2.5, 2.5)
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.42)'
      ctx.fillRect(cx - 10, cy - 31, 3, 62)
      ctx.strokeStyle = '#cbd5e1'
      ctx.lineWidth = 1.2
      ctx.strokeRect(cx - 13.5, cy - 35.5, 27, 71)
    }
    drawBioCylinder(1564, 194, 'green', 1)
    drawBioCylinder(1608, 194, 'cyan', 2)
    drawBioCylinder(1652, 194, 'green', 3)

    // Centro: Plataforma hexagonal elevada con anillos de luz dorados girando bajo los pies de PUMA (1764, 240)
    {
      const px = 1764
      const py = 240
      const drawHex = (cx: number, cy: number, rx: number, ry: number, col: string) => {
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.moveTo(cx - rx * 0.52, cy - ry)
        ctx.lineTo(cx + rx * 0.52, cy - ry)
        ctx.lineTo(cx + rx, cy)
        ctx.lineTo(cx + rx * 0.52, cy + ry)
        ctx.lineTo(cx - rx * 0.52, cy + ry)
        ctx.lineTo(cx - rx, cy)
        ctx.closePath()
        ctx.fill()
      }
      // Sombra 3D + peldaño metálico biselado
      drawHex(px, py + 7, 72, 34, '#070b12')
      drawHex(px, py + 4, 70, 32, '#334155')
      drawHex(px, py, 68, 30, '#475569')
      drawHex(px, py, 56, 24, '#1e293b')
      drawHex(px, py, 40, 16, '#0f172a')

      // Anillos de luz dorados girando en la plataforma hexagonal
      ctx.save()
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.ellipse(px, py, 48, 20, 0, 0, Math.PI * 2)
      ctx.stroke()

      ctx.strokeStyle = '#fde047'
      ctx.lineWidth = 1.5
      ctx.setLineDash([12, 8])
      ctx.lineDashOffset = -time * 28
      ctx.beginPath()
      ctx.ellipse(px, py, 36, 14, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])

      // Puntos dorados orbitando la plataforma
      for (let g = 0; g < 4; g++) {
        const ga = time * 1.8 + (g * Math.PI) / 2
        const gx = Math.round(px + Math.cos(ga) * 48)
        const gy = Math.round(py + Math.sin(ga) * 20)
        ctx.fillStyle = '#fef08a'
        ctx.fillRect(gx - 2, gy - 2, 4, 4)
      }
      ctx.restore()
    }

    // Centro superior: Consola curva panorámica con pantallas verdes/cian de gráficas y ADN (1758, 152)
    {
      ctx.fillStyle = '#070b12'
      ctx.beginPath()
      ctx.moveTo(1686, 174)
      ctx.quadraticCurveTo(1758, 128, 1848, 174)
      ctx.lineTo(1842, 194)
      ctx.quadraticCurveTo(1758, 154, 1694, 194)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#334155'
      ctx.beginPath()
      ctx.moveTo(1690, 172)
      ctx.quadraticCurveTo(1758, 132, 1844, 172)
      ctx.lineTo(1838, 188)
      ctx.quadraticCurveTo(1758, 152, 1698, 188)
      ctx.closePath()
      ctx.fill()

      // 3 Monitores panorámicos curvos verdes y cian sobre la consola (DNA + Gráficas)
      const screens = [
        { x: 1698, y: 126, w: 42, h: 30, kind: 'graph' },
        { x: 1746, y: 118, w: 48, h: 32, kind: 'dna' },
        { x: 1800, y: 126, w: 42, h: 30, kind: 'bars' },
      ] as const
      for (const sc of screens) {
        ctx.fillStyle = '#05070d'
        ctx.fillRect(sc.x - 2, sc.y - 2, sc.w + 4, sc.h + 4)
        ctx.fillStyle = sc.kind === 'dna' ? '#042a3a' : '#032014'
        ctx.fillRect(sc.x, sc.y, sc.w, sc.h)
        ctx.strokeStyle = sc.kind === 'dna' ? '#22d3ee' : '#4ade80'
        ctx.lineWidth = 1.2
        ctx.strokeRect(sc.x, sc.y, sc.w, sc.h)

        if (sc.kind === 'dna') {
          // Doble hélice de ADN animada verde/cian
          for (let dx = 4; dx < sc.w - 4; dx += 5) {
            const p = time * 4 + dx * 0.28
            const y1 = sc.y + sc.h / 2 + Math.sin(p) * 8
            const y2 = sc.y + sc.h / 2 - Math.sin(p) * 8
            ctx.fillStyle = '#34d399'
            ctx.fillRect(sc.x + dx, Math.min(y1, y2), 1.5, Math.abs(y2 - y1))
            ctx.fillStyle = '#67e8f9'
            ctx.fillRect(sc.x + dx - 1, Math.round(y1) - 1, 3, 3)
            ctx.fillStyle = '#86efac'
            ctx.fillRect(sc.x + dx - 1, Math.round(y2) - 1, 3, 3)
          }
        } else if (sc.kind === 'graph') {
          ctx.strokeStyle = '#4ade80'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          for (let gx = 3; gx <= sc.w - 4; gx += 3) {
            const gy = sc.y + sc.h / 2 + Math.sin(time * 4 + gx * 0.3) * 8
            if (gx === 3) ctx.moveTo(sc.x + gx, gy)
            else ctx.lineTo(sc.x + gx, gy)
          }
          ctx.stroke()
        } else {
          for (let b = 0; b < 5; b++) {
            const bh = 5 + Math.round(((Math.sin(time * 5 + b * 0.9) + 1) / 2) * 16)
            ctx.fillStyle = b % 2 === 0 ? '#22d3ee' : '#4ade80'
            ctx.fillRect(sc.x + 5 + b * 7, sc.y + sc.h - 4 - bh, 5, bh)
          }
        }
      }
    }

    // Derecha: Enorme ventanal espacial biselado con planeta bandeado y satélite científico SAT-02
    {
      const wx = 1876
      const wy = 84
      const ww = 176
      const wh = 122
      ctx.fillStyle = '#05070d'
      ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8)
      ctx.fillStyle = '#4b596e'
      ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4)
      ctx.fillStyle = '#252c37'
      ctx.fillRect(wx, wy, ww, wh)

      const ix = wx + 5
      const iy = wy + 5
      const iw = ww - 10
      const ih = wh - 10
      ctx.save()
      ctx.beginPath()
      ctx.rect(ix, iy, iw, ih)
      ctx.clip()

      ctx.fillStyle = '#030712'
      ctx.fillRect(ix, iy, iw, ih)
      for (let i = 0; i < 34; i++) {
        const sx = ix + ((i * 61 + 9) % iw)
        const sy = iy + ((i * 47 + 5) % ih)
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(time * 1.6 + i))
        ctx.fillStyle = `rgba(248, 250, 252, ${tw})`
        ctx.fillRect(sx, sy, 2, 2)
      }

      // Planeta grande con bandas atmosféricas estilo Júpiter/Tierra en la esquina derecha
      const plX = ix + iw * 0.8
      const plY = iy + ih * 0.54
      const plR = 54
      const plAtm = ctx.createRadialGradient(plX, plY, plR - 8, plX, plY, plR + 14)
      plAtm.addColorStop(0, 'rgba(56, 189, 248, 0.30)')
      plAtm.addColorStop(1, 'rgba(56, 189, 248, 0)')
      ctx.fillStyle = plAtm
      ctx.beginPath()
      ctx.arc(plX, plY, plR + 14, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.beginPath()
      ctx.arc(plX, plY, plR, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = '#1e40af'
      ctx.fillRect(plX - plR, plY - plR, plR * 2, plR * 2)
      const pBands = ['#0284c7', '#e0f2fe', '#0ea5e9', '#15803d', '#38bdf8', '#fde68a', '#1d4ed8']
      pBands.forEach((bCol, idx) => {
        ctx.fillStyle = bCol
        ctx.fillRect(plX - plR, plY - plR + idx * 15, plR * 2, 9)
      })
      ctx.fillStyle = 'rgba(2, 6, 18, 0.36)'
      ctx.beginPath()
      ctx.arc(plX + 26, plY + 8, plR, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Satélite científico SAT-02 flotando en el espacio con paneles solares azules
      const s2X = ix + iw * 0.32
      const s2Y = iy + ih * 0.45 + Math.sin(time * 1.9 + 1) * 3.5
      ctx.save()
      ctx.translate(s2X, s2Y)
      ctx.rotate(0.22)
      for (const sd of [-1, 1]) {
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(sd * 22 - 12, -13, 24, 26)
        ctx.fillStyle = '#2563eb'
        ctx.fillRect(sd * 22 - 11, -12, 22, 24)
        ctx.fillStyle = '#93c5fd'
        ctx.fillRect(sd * 22 - 11, -3, 22, 1)
        ctx.fillRect(sd * 22 - 11, 4, 22, 1)
        ctx.fillRect(sd * 22, -12, 1, 24)
      }
      ctx.fillStyle = '#cbd5e1'
      ctx.fillRect(-10, -8, 20, 16)
      ctx.fillStyle = '#2563eb'
      ctx.fillRect(-4, -8, 5, 16)
      // Lente óptico cian apuntando al planeta
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(10, 0, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#22d3ee'
      ctx.beginPath()
      ctx.arc(10, 0, 4.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Montante central y reflejo biselado de vidrio
      ctx.fillStyle = 'rgba(186, 230, 253, 0.09)'
      ctx.beginPath()
      ctx.moveTo(ix + 18, iy)
      ctx.lineTo(ix + 42, iy)
      ctx.lineTo(ix + 10, iy + ih)
      ctx.lineTo(ix - 12, iy + ih)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      // Refuerzo metálico vertical biselado del ventanal
      ctx.fillStyle = '#384252'
      ctx.fillRect(wx + Math.floor(ww * 0.48), wy, 5, wh)
      ctx.fillStyle = '#cbd5e1'
      for (let ry = wy + 8; ry < wy + wh - 6; ry += 22) {
        ctx.fillRect(wx + 2, ry, 2, 2)
        ctx.fillRect(wx + ww - 4, ry, 2, 2)
      }
    }

    // Pod holográfico compacto en (1936, 256) para sci_holo sin tapar el ventanal ni la plataforma hexagonal
    {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(1898, 224, 76, 56)
      ctx.fillStyle = '#252c37'
      ctx.fillRect(1900, 226, 72, 52)
      ctx.fillStyle = '#0284c7'
      ctx.fillRect(1908, 234, 56, 36)
      const holoBob = Math.sin(time * 4) * 2.5
      ctx.fillStyle = 'rgba(103, 232, 249, 0.28)'
      ctx.strokeStyle = '#67e8f9'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(1936, 226 + holoBob)
      ctx.lineTo(1958, 238 + holoBob)
      ctx.lineTo(1936, 250 + holoBob)
      ctx.lineTo(1914, 238 + holoBob)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }

    // Estantería glaciar e incubadora botánica en los zócalos inferiores de PUMA-3
    const atlasUser = getStationSpriteAtlas()
    if (atlasUser) {
      drawAtlasSprite(ctx, atlasUser.furniture.botanicalIncubator, 1554, 286)
      drawAtlasSprite(ctx, atlasUser.furniture.geoGlacierShelf, 1998, 272)
    }
  }

  // --------------------------------------------------------------------------
  // g) LABORATORY (Ventanal espacial, campana extractora, mesa ADN y muestras glaciares · PUMA-3)
  // --------------------------------------------------------------------------
  {
    // Ventanal espacial biselado en la pared superior derecha de LABORATORY
    {
      const lx = 1860
      const ly = 466
      const lw = 156
      const lh = 76
      ctx.fillStyle = '#05070d'
      ctx.fillRect(lx - 3, ly - 3, lw + 6, lh + 6)
      ctx.fillStyle = '#384252'
      ctx.fillRect(lx, ly, lw, lh)
      ctx.save()
      ctx.beginPath()
      ctx.rect(lx + 4, ly + 4, lw - 8, lh - 8)
      ctx.clip()
      ctx.fillStyle = '#030712'
      ctx.fillRect(lx + 4, ly + 4, lw - 8, lh - 8)
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = '#f8fafc'
        ctx.fillRect(lx + 8 + ((i * 37) % (lw - 16)), ly + 8 + ((i * 23) % (lh - 16)), 2, 2)
      }
      ctx.fillStyle = '#0284c7'
      ctx.beginPath()
      ctx.arc(lx + lw - 12, ly + lh + 18, 62, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#22c55e'
      ctx.fillRect(lx + lw - 52, ly + lh - 18, 24, 16)
      ctx.restore()
    }

    ctx.fillStyle = '#070b12'
    ctx.fillRect(1622, 486, 132, 60)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(1624, 488, 128, 56)
    ctx.fillStyle = 'rgba(125, 211, 252, 0.35)'
    ctx.fillRect(1634, 498, 108, 36)
    ctx.fillStyle = '#ec4899'
    ctx.fillRect(1652, 516, 14, 14)
    ctx.fillStyle = '#22c55e'
    ctx.fillRect(1682, 514, 14, 16)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(1712, 516, 14, 14)

    // Mesa curva científica para sci_lab (1792, 552)
    ctx.fillStyle = '#070b12'
    ctx.fillRect(1760, 526, 68, 44)
    ctx.fillStyle = '#334155'
    ctx.fillRect(1762, 528, 64, 40)
    ctx.fillStyle = '#032014'
    ctx.fillRect(1768, 533, 52, 22)
    ctx.strokeStyle = '#55efc4'
    ctx.lineWidth = 1.2
    ctx.strokeRect(1768, 533, 52, 22)
    ctx.fillStyle = '#55efc4'
    for (let dx = 4; dx < 46; dx += 6) {
      const yy = 544 + Math.round(Math.sin(time * 4 + dx * 0.4) * 5)
      ctx.fillRect(1768 + dx, yy, 4, 3)
    }

    ctx.fillStyle = '#0f172a'
    ctx.fillRect(1880, 558, 104, 62)
    ctx.strokeStyle = '#55efc4'
    ctx.lineWidth = 2
    ctx.strokeRect(1880, 558, 104, 62)
    for (let r = 0; r < 4; r++) {
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(1890, 566 + r * 12, 84, 8)
      ctx.fillStyle = (Math.floor(time * 6) + r) % 2 === 0 ? '#55efc4' : '#0284c7'
      ctx.fillRect(1894, 568 + r * 12, 42, 4)
      ctx.fillStyle = '#fbbf24'
      ctx.fillRect(1962, 568 + r * 12, 6, 4)
    }

    const atlasLab = getStationSpriteAtlas()
    if (atlasLab) {
      drawAtlasSprite(ctx, atlasLab.furniture.scienceWhiteboard, 1768, 464)
      drawAtlasSprite(ctx, atlasLab.furniture.botanicalIncubator, 1768, 652)
      drawAtlasSprite(ctx, atlasLab.furniture.geoGlacierShelf, 1922, 646)
    }
  }

  // --------------------------------------------------------------------------
  // h) POWER MGD & REACTOR (Sala ALPACA-1: Reactor abierto vórtice plasma azul/blanco + robot asistente + caja herramientas + estación doble nivel ⚡ + ventana Tierra + 3 vitrinas cristales 98%/97%/99%)
  // --------------------------------------------------------------------------
  {
    // Cables blindados bronce/cobre y cian conectando el Reactor (1668, 912) con la estación de doble nivel (1804, 910)
    ctx.strokeStyle = '#92400e'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(1668, 912)
    ctx.lineTo(1752, 912)
    ctx.stroke()
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(1668, 912)
    ctx.lineTo(1752, 912)
    ctx.stroke()

    // 1) IZQUIERDA: Imponente Reactor Circular abierto con bobinas naranjas y vórtice de plasma azul/blanco girando
    {
      const rx = 1668
      const ry = 912
      const halo = ctx.createRadialGradient(rx, ry, 10, rx, ry, 68 + Math.sin(time * 4) * 3)
      halo.addColorStop(0, 'rgba(224, 242, 254, 0.9)')
      halo.addColorStop(0.35, 'rgba(56, 189, 248, 0.55)')
      halo.addColorStop(0.7, 'rgba(234, 88, 12, 0.25)')
      halo.addColorStop(1, 'rgba(15, 23, 42, 0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(rx, ry, 68, 0, Math.PI * 2)
      ctx.fill()

      // Anillo exterior pesado en acero + bronce/cobre grabado
      ctx.fillStyle = '#070b12'
      ctx.beginPath()
      ctx.arc(rx, ry, 54, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#78350f'
      ctx.beginPath()
      ctx.arc(rx, ry, 50, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#d97706'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.fillStyle = '#1e293b'
      ctx.beginPath()
      ctx.arc(rx, ry, 42, 0, Math.PI * 2)
      ctx.fill()

      // 8 Bobinas naranjas / cobre radiales con bridas metálicas
      for (let k = 0; k < 8; k++) {
        const ang = (k * Math.PI) / 4 + 0.12
        ctx.save()
        ctx.translate(rx, ry)
        ctx.rotate(ang)
        ctx.fillStyle = '#070b12'
        ctx.fillRect(30, -7, 18, 14)
        ctx.fillStyle = '#ea580c'
        ctx.fillRect(31, -5, 14, 10)
        ctx.fillStyle = '#fb923c'
        ctx.fillRect(33, -4, 3, 8)
        ctx.fillRect(39, -4, 3, 8)
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(45, -6, 4, 12)
        ctx.restore()
      }

      // Pozo interior + Vórtice de plasma azul/blanco girando en su núcleo
      ctx.fillStyle = '#041326'
      ctx.beginPath()
      ctx.arc(rx, ry, 30, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.translate(rx, ry)
      ctx.rotate(time * 3.4)
      for (let arm = 0; arm < 4; arm++) {
        ctx.rotate(Math.PI / 2)
        ctx.strokeStyle = arm % 2 === 0 ? '#38bdf8' : '#e0f2fe'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(10, 0, 14, 0, Math.PI * 0.85)
        ctx.stroke()
      }
      ctx.restore()

      const coreR = 11 + Math.sin(time * 8) * 2
      ctx.fillStyle = '#38bdf8'
      ctx.beginPath()
      ctx.arc(rx, ry, coreR + 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(rx, ry, coreR - 2, 0, Math.PI * 2)
      ctx.fill()

      // Racks industriales pequeños al lado izquierdo del reactor + caja herramientas abierta + llaves + robot asistente
      const drawReactorSideRack = (sx: number, sy: number, sh: number) => {
        ctx.fillStyle = '#070b12'
        ctx.fillRect(sx - 2, sy - 2, 30, sh + 4)
        ctx.fillStyle = '#1e293b'
        ctx.fillRect(sx, sy, 26, sh)
        ctx.strokeStyle = '#b45309'
        ctx.lineWidth = 1.2
        ctx.strokeRect(sx, sy, 26, sh)
        for (let row = sy + 6; row < sy + sh - 6; row += 8) {
          ctx.fillStyle = '#0f172a'
          ctx.fillRect(sx + 3, row, 20, 5)
          ctx.fillStyle = Math.sin(time * 6 + row) > 0 ? '#4ade80' : '#38bdf8'
          ctx.fillRect(sx + 5, row + 1, 4, 3)
          ctx.fillStyle = '#fb923c'
          ctx.fillRect(sx + 16, row + 1, 4, 3)
        }
      }
      drawReactorSideRack(1594, 838, 68)
      drawReactorSideRack(1594, 916, 68)

      // Pequeño robot asistente blanco/azul con ojo luminoso cian junto al reactor
      {
        const bx = 1624
        const by = 1006 + Math.round(Math.sin(time * 3.5) * 1.5)
        ctx.fillStyle = '#070b12'
        ctx.fillRect(bx - 13, by - 15, 26, 30)
        // Antena superior
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(bx - 1, by - 21, 2, 6)
        ctx.fillStyle = '#22d3ee'
        ctx.fillRect(bx - 2, by - 23, 4, 3)
        // Cuerpo blanco & franja azul cobalto
        ctx.fillStyle = '#f8fafc'
        ctx.fillRect(bx - 11, by - 13, 22, 22)
        ctx.fillStyle = '#2563eb'
        ctx.fillRect(bx - 11, by - 2, 22, 6)
        // Visor oscuro + ojo luminoso cian
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(bx - 8, by - 11, 16, 8)
        ctx.fillStyle = Math.sin(time * 5) > -0.7 ? '#22d3ee' : '#a5f3fc'
        ctx.fillRect(bx - 2 + Math.round(Math.sin(time * 1.8) * 3), by - 9, 5, 4)
        // Orugas metálicas
        ctx.fillStyle = '#334155'
        ctx.fillRect(bx - 12, by + 9, 24, 5)
      }

      // Caja de herramientas abierta roja/acero y llaves sobre la rejilla del piso
      {
        const tx = 1678
        const ty = 1046
        ctx.fillStyle = '#070b12'
        ctx.fillRect(tx - 18, ty - 14, 36, 26)
        // Tapa abierta inclinada hacia atrás
        ctx.fillStyle = '#991b1b'
        ctx.fillRect(tx - 16, ty - 12, 32, 9)
        // Base roja de caja + bandejas metálicas y herramienta interior
        ctx.fillStyle = '#dc2626'
        ctx.fillRect(tx - 16, ty - 3, 32, 13)
        ctx.fillStyle = '#cbd5e1'
        ctx.fillRect(tx - 13, ty - 5, 26, 4)
        ctx.fillStyle = '#facc15'
        ctx.fillRect(tx - 3, ty + 1, 6, 3)

        // Llaves y destornilladores sueltos en la rejilla del piso
        ctx.fillStyle = '#cbd5e1'
        ctx.fillRect(1716, 1054, 16, 4)
        ctx.fillRect(1714, 1052, 4, 8)
        ctx.fillRect(1729, 1052, 4, 8)
        ctx.fillStyle = '#f97316'
        ctx.fillRect(1656, 1064, 7, 4)
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(1663, 1065, 11, 2)
      }
    }

    // 2) CENTRO: Estación de control de doble nivel con monitores de circuitos verdes, botones rojos/verdes y gran rayo amarillo ⚡
    {
      const cx = 1796
      const cy = 910
      // Nivel superior inclinado (monitores de circuitos verdes + emblemático rayo amarillo ⚡ arriba)
      ctx.fillStyle = '#070b12'
      ctx.fillRect(cx - 56, cy - 42, 112, 54)
      ctx.fillStyle = '#2c3442'
      ctx.fillRect(cx - 54, cy - 40, 108, 50)
      ctx.strokeStyle = '#d97706'
      ctx.lineWidth = 2
      ctx.strokeRect(cx - 54, cy - 40, 108, 50)

      // 2 Monitores verdes de circuitos de potencia en el nivel superior
      for (const mxOff of [-44, 6]) {
        ctx.fillStyle = '#031d11'
        ctx.fillRect(cx + mxOff, cy - 33, 38, 28)
        ctx.strokeStyle = '#4ade80'
        ctx.lineWidth = 1.2
        ctx.strokeRect(cx + mxOff, cy - 33, 38, 28)
        ctx.strokeStyle = '#22c55e'
        ctx.beginPath()
        ctx.moveTo(cx + mxOff + 4, cy - 19)
        ctx.lineTo(cx + mxOff + 14, cy - 19)
        ctx.lineTo(cx + mxOff + 18, cy - 26)
        ctx.lineTo(cx + mxOff + 34, cy - 26)
        ctx.moveTo(cx + mxOff + 14, cy - 19)
        ctx.lineTo(cx + mxOff + 18, cy - 12)
        ctx.lineTo(cx + mxOff + 34, cy - 12)
        ctx.stroke()
        ctx.fillStyle = '#bbf7d0'
        ctx.fillRect(cx + mxOff + 10 + Math.round(((time * 22) % 22)), cy - 27, 3, 3)
      }

      // Nivel inferior de escritorio operador con botonera roja y verde luminosa
      ctx.fillStyle = '#070b12'
      ctx.fillRect(cx - 64, cy + 6, 128, 30)
      ctx.fillStyle = '#334155'
      ctx.fillRect(cx - 62, cy + 8, 124, 26)
      ctx.fillStyle = '#92400e'
      ctx.fillRect(cx - 62, cy + 8, 124, 4)
      for (let b = 0; b < 8; b++) {
        ctx.fillStyle = b % 2 === 0 ? '#ef4444' : '#22c55e'
        ctx.fillRect(cx - 50 + b * 13, cy + 16, 8, 6)
        ctx.fillStyle = '#f8fafc'
        ctx.fillRect(cx - 48 + b * 13, cy + 17, 3, 2)
      }
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(cx - 44, cy + 25, 88, 6)

      // Gran icono de rayo amarillo brillante arriba de la estación central de ALPACA ⚡
      const bx = cx
      const by = cy - 60
      ctx.fillStyle = '#070b12'
      ctx.beginPath()
      ctx.arc(bx, by, 18, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#1e293b'
      ctx.beginPath()
      ctx.arc(bx, by, 15, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#fde047'
      ctx.beginPath()
      ctx.moveTo(bx + 3, by - 11)
      ctx.lineTo(bx - 8, by + 1)
      ctx.lineTo(bx, by + 1)
      ctx.lineTo(bx - 4, by + 11)
      ctx.lineTo(bx + 8, by - 1)
      ctx.lineTo(bx, by - 1)
      ctx.closePath()
      ctx.fill()
    }

    // 3) DERECHA: Arco de ventana con horizonte brillante de la Tierra + debajo 3 vitrinas con cristales de energía cian (98%, 97%, 99%)
    {
      // Arco de ventana industrial en acero y bronce mostrando horizonte brillante de la Tierra
      const wx = 1916
      const wy = 796
      const ww = 196
      const wh = 76
      ctx.fillStyle = '#070b12'
      ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6)
      ctx.fillStyle = '#78350f'
      ctx.fillRect(wx, wy, ww, wh)
      ctx.strokeStyle = '#d97706'
      ctx.lineWidth = 2
      ctx.strokeRect(wx, wy, ww, wh)

      ctx.save()
      ctx.beginPath()
      ctx.rect(wx + 6, wy + 6, ww - 12, wh - 12)
      ctx.clip()
      ctx.fillStyle = '#020612'
      ctx.fillRect(wx + 6, wy + 6, ww - 12, wh - 12)
      for (let i = 0; i < 24; i++) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(wx + 12 + ((i * 31) % (ww - 24)), wy + 10 + ((i * 19) % 24), 1.5, 1.5)
      }
      // Horizonte brillante curvo de la Tierra abajo en la ventana
      const earthY = wy + wh + 78
      const glow = ctx.createRadialGradient(wx + ww / 2, earthY, 85, wx + ww / 2, earthY, 128)
      glow.addColorStop(0, '#1d4ed8')
      glow.addColorStop(0.75, '#38bdf8')
      glow.addColorStop(1, 'rgba(56, 189, 248, 0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(wx + ww / 2, earthY, 128, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#1d4ed8'
      ctx.beginPath()
      ctx.arc(wx + ww / 2, earthY, 108, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#a5f3fc'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.fillRect(wx + 42, wy + 52, 48, 6)
      ctx.fillRect(wx + 114, wy + 56, 36, 5)
      ctx.restore()

      // Debajo del arco: 3 vitrinas blindadas con cristales de energía cian brillantes (98%, 97%, 99%)
      const crystalPcts = ['98%', '97%', '99%']
      for (let cIdx = 0; cIdx < 3; cIdx++) {
        const vx = 1922 + cIdx * 62
        const vy = 886
        ctx.fillStyle = '#070b12'
        ctx.fillRect(vx - 2, vy - 2, 54, 86)
        ctx.fillStyle = '#252c37'
        ctx.fillRect(vx, vy, 50, 82)
        ctx.strokeStyle = '#b45309'
        ctx.lineWidth = 1.5
        ctx.strokeRect(vx, vy, 50, 82)

        // Cristal cian facetado brillante dentro de la vitrina
        ctx.fillStyle = '#041d2e'
        ctx.fillRect(vx + 6, vy + 6, 38, 52)
        ctx.fillStyle = '#0284c7'
        ctx.beginPath()
        ctx.moveTo(vx + 25, vy + 10)
        ctx.lineTo(vx + 36, vy + 28)
        ctx.lineTo(vx + 31, vy + 52)
        ctx.lineTo(vx + 19, vy + 52)
        ctx.lineTo(vx + 14, vy + 28)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#67e8f9'
        ctx.beginPath()
        ctx.moveTo(vx + 25, vy + 13)
        ctx.lineTo(vx + 32, vy + 28)
        ctx.lineTo(vx + 25, vy + 49)
        ctx.lineTo(vx + 19, vy + 28)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(vx + 23, vy + 19, 3, 18)

        // Visor digital verde mostrando 98%, 97%, 99%
        ctx.fillStyle = '#031d11'
        ctx.fillRect(vx + 6, vy + 62, 38, 16)
        ctx.strokeStyle = '#22c55e'
        ctx.lineWidth = 1
        ctx.strokeRect(vx + 6, vy + 62, 38, 16)
        ctx.font = 'bold 8px "Press Start 2P", monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = '#4ade80'
        ctx.fillText(crystalPcts[cIdx], vx + 25, vy + 74)
      }
    }

    // Mobiliario complementario industrial ALPACA-1 en la parte baja sin estorbar pasillos ni la caja/robot
    const atlasPower = getStationSpriteAtlas()
    if (atlasPower) {
      drawAtlasSprite(ctx, atlasPower.furniture.sparePartsCabinet, 1598, 1068)
      drawAtlasSprite(ctx, atlasPower.furniture.auxBatteryBank, 1820, 1072)
      drawAtlasSprite(ctx, atlasPower.furniture.oscilloscopeBench, 1940, 1058)
      drawAtlasSprite(ctx, atlasPower.furniture.thermalDiagPanel, 2032, 1060)
    }
  }

  // --------------------------------------------------------------------------
  // i) LIFE SUPPORT & ELECTRICAL (Tanques O2 detallados + tuberías + MASTER SWITCH)
  // --------------------------------------------------------------------------
  {
    ctx.fillStyle = '#2c343e'
    ctx.fillRect(1240, 1120, 16, 96)
    ctx.fillRect(1240, 1312, 16, 96)

    ctx.fillStyle = '#64748b'
    ctx.fillRect(940, 1116, 176, 10)
    ctx.fillRect(982, 1116, 10, 24)
    ctx.fillRect(1050, 1116, 10, 24)
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(940, 1118, 176, 4)

    const drawDetailedO2Tank = (tx: number, ty: number) => {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(tx - 2, ty - 2, 58, 104)
      ctx.fillStyle = '#475569'
      ctx.fillRect(tx + 18, ty - 10, 18, 10)
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(tx + 12, ty - 15, 30, 6)
      ctx.fillStyle = '#0369a1'
      ctx.fillRect(tx, ty, 54, 100)
      ctx.fillStyle = '#0284c7'
      ctx.fillRect(tx + 6, ty + 10, 42, 80)
      const hLvl = Math.round((state.lifeSupport / 100) * 72)
      ctx.fillStyle = state.lifeSupport < 50 ? '#ef4444' : '#38bdf8'
      ctx.fillRect(tx + 10, ty + 86 - hLvl, 34, hLvl)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.42)'
      ctx.fillRect(tx + 10, ty + 14, 5, 68)
      ctx.fillStyle = '#070b12'
      ctx.fillRect(tx + 34, ty + 14, 12, 12)
      ctx.fillStyle = '#fde047'
      ctx.fillRect(tx + 36, ty + 16, 8, 8)

      ctx.font = 'bold 12px "Press Start 2P", monospace'
      ctx.fillStyle = '#070b12'
      ctx.textAlign = 'center'
      ctx.fillText('O2', tx + 27, ty + 56)
    }
    drawDetailedO2Tank(960, 1138)
    drawDetailedO2Tank(1028, 1138)

    ctx.fillStyle = '#070b12'
    ctx.fillRect(1108, 1130, 56, 106)
    ctx.fillStyle = '#334155'
    ctx.fillRect(1110, 1132, 52, 12)
    ctx.fillRect(1110, 1222, 52, 12)
    ctx.fillStyle = '#16a34a'
    ctx.fillRect(1116, 1144, 40, 78)
    ctx.fillStyle = '#22c55e'
    ctx.fillRect(1120, 1146, 30, 74)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
    ctx.fillRect(1121, 1148, 5, 70)
    for (let b = 0; b < 4; b++) {
      const by = 1212 - ((time * 26 + b * 15) % 60)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(1128 + b * 6, by, 3, 3)
    }

    ctx.fillStyle = '#070b12'
    ctx.fillRect(1310, 1132, 148, 92)
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(1312, 1134, 144, 88)
    ctx.strokeStyle = '#facc15'
    ctx.lineWidth = 2.5
    ctx.strokeRect(1312, 1134, 144, 88)

    ctx.fillStyle = '#0f172a'
    ctx.fillRect(1364, 1152, 40, 52)
    const leverUp = state.battery >= 60
    ctx.fillStyle = leverUp ? '#22c55e' : '#ef4444'
    ctx.fillRect(1356, leverUp ? 1154 : 1184, 56, 16)
    ctx.font = 'bold 9px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#000000'
    ctx.fillText('MASTER SWITCH', 1385, 1126)
    ctx.fillStyle = '#fde047'
    ctx.fillText('MASTER SWITCH', 1384, 1125)

    // Etiquetas claras de subdivisión Oeste (LIFE SUPPORT · PUMA-3) vs Este (ELECTRICAL · ALPACA-1) + mobiliario
    const atlasSplit = getStationSpriteAtlas()
    if (atlasSplit) {
      drawAtlasSprite(ctx, atlasSplit.furniture.botanicalIncubator, 908, 1332)
      drawAtlasSprite(ctx, atlasSplit.furniture.geoGlacierShelf, 1134, 1332)
      drawAtlasSprite(ctx, atlasSplit.furniture.sparePartsCabinet, 1278, 1332)
      drawAtlasSprite(ctx, atlasSplit.furniture.techBunk, 1416, 1340)
    }
    ctx.font = 'bold 7px "Press Start 2P", monospace'
    ctx.fillStyle = '#000000'
    ctx.fillText('LIFE SUPPORT (ALPACA-1)', 1062, 1396)
    ctx.fillText('ELECTRICAL (ALPACA-1)', 1386, 1396)
    ctx.fillStyle = '#55efc4'
    ctx.fillText('LIFE SUPPORT (ALPACA-1)', 1061, 1395)
    ctx.fillStyle = '#ff9f43'
    ctx.fillText('ELECTRICAL (ALPACA-1)', 1385, 1395)
  }

  // ==========================================================================
  // 7b. CENTROS DE CONTROL SATELITAL (conectados en vivo a SAT-01 y SAT-02)
  // ==========================================================================
  {
    const linkBlink = Math.sin(time * 5) > 0

    // ---- Centro 1 · SPACE SEGMENT: estación de mando doble, hologramas dorados y teclados LED (SAT-01)
    {
      const cx = 340
      const cy = 300
      ctx.fillStyle = '#05070d'
      ctx.fillRect(cx - 64, cy - 2, 128, 34)
      ctx.fillStyle = '#334155'
      ctx.fillRect(cx - 62, cy, 124, 30)
      ctx.fillStyle = '#d4a017'
      ctx.fillRect(cx - 62, cy, 124, 3)
      // Teclado doble pixelado + LEDs
      for (let bx = cx - 54; bx <= cx + 42; bx += 6) {
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(bx, cy + 8, 4, 2)
        ctx.fillRect(bx, cy + 12, 4, 2)
      }
      for (let b = 0; b < 8; b++) {
        ctx.fillStyle = b % 3 === 0 ? '#ef4444' : b % 2 === 0 ? '#fde047' : '#38bdf8'
        ctx.fillRect(cx - 54 + b * 14, cy + 20, 8, 5)
      }
      for (const mx of [cx - 54, cx + 6]) {
        ctx.fillStyle = '#05070d'
        ctx.fillRect(mx - 2, cy - 30, 52, 32)
        ctx.fillStyle = '#3a2a05'
        ctx.fillRect(mx, cy - 28, 48, 28)
        ctx.strokeStyle = '#fde047'
        ctx.lineWidth = 1.5
        ctx.strokeRect(mx, cy - 28, 48, 28)
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.7)'
        ctx.beginPath()
        ctx.ellipse(mx + 24, cy - 14, 18, 9, 0, 0, Math.PI * 2)
        ctx.stroke()
        const oa = time * 1.6 + mx
        ctx.fillStyle = '#fde047'
        ctx.fillRect(mx + 24 + Math.cos(oa) * 18 - 2, cy - 14 + Math.sin(oa) * 9 - 2, 4, 4)
      }
      for (const hx of [cx - 30, cx + 30]) {
        const hy = cy - 58
        ctx.fillStyle = 'rgba(253, 224, 71, 0.16)'
        ctx.beginPath()
        ctx.moveTo(hx - 12, cy - 32)
        ctx.lineTo(hx + 12, cy - 32)
        ctx.lineTo(hx + 20, hy + 10)
        ctx.lineTo(hx - 20, hy + 10)
        ctx.closePath()
        ctx.fill()
        ctx.save()
        ctx.translate(hx, hy + Math.sin(time * 3 + hx) * 2)
        const sx = Math.cos(time * 2 + hx)
        ctx.scale(Math.max(0.25, Math.abs(sx)), 1)
        ctx.strokeStyle = '#fde047'
        ctx.lineWidth = 2
        ctx.beginPath()
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k
          ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9)
        }
        ctx.closePath()
        ctx.stroke()
        ctx.strokeRect(-22, -2, 12, 4)
        ctx.strokeRect(10, -2, 12, 4)
        ctx.restore()
      }
      ctx.fillStyle = '#94a3b8'
      ctx.fillRect(cx + 72, cy - 40, 4, 66)
      ctx.fillStyle = '#fde047'
      ctx.fillRect(cx + 64, cy - 46, 20, 6)
      ctx.fillRect(cx + 72, cy - 56, 4, 10)
      ctx.fillStyle = linkBlink ? '#4ade80' : '#14532d'
      ctx.fillRect(cx + 70, cy - 60, 8, 6)
      ctx.font = 'bold 9px "Press Start 2P", monospace'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#000000'
      ctx.fillText('SAT-01 ●', cx + 1, cy - 77)
      ctx.fillStyle = '#fde047'
      ctx.fillText('SAT-01 ●', cx, cy - 78)
    }

    // ---- Centro 2 · USER SEGMENT: pantallas duales, radar y teclado LED (SAT-02)
    {
      const cx = 1780
      const cy = 300
      ctx.fillStyle = '#05070d'
      ctx.fillRect(cx - 70, cy - 2, 140, 34)
      ctx.fillStyle = '#334155'
      ctx.fillRect(cx - 68, cy, 136, 30)
      ctx.fillStyle = '#22d3ee'
      ctx.fillRect(cx - 68, cy, 136, 3)
      for (let bx = cx - 58; bx <= cx + 48; bx += 6) {
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(bx, cy + 8, 4, 2)
        ctx.fillRect(bx, cy + 12, 4, 2)
      }
      for (let b = 0; b < 9; b++) {
        ctx.fillStyle = b % 3 === 0 ? '#ef4444' : b % 2 === 0 ? '#4ade80' : '#38bdf8'
        ctx.fillRect(cx - 60 + b * 14, cy + 20, 8, 5)
      }
      for (const mx of [cx - 64, cx - 10]) {
        ctx.fillStyle = '#05070d'
        ctx.fillRect(mx - 2, cy - 34, 50, 36)
        ctx.fillStyle = '#082f49'
        ctx.fillRect(mx, cy - 32, 46, 32)
        ctx.strokeStyle = '#22d3ee'
        ctx.lineWidth = 1.5
        ctx.strokeRect(mx, cy - 32, 46, 32)
        ctx.fillStyle = '#4ade80'
        for (let l = 0; l < 4; l++) {
          const lw = 10 + ((Math.sin(time * 2 + l + mx) + 1) / 2) * 26
          ctx.fillRect(mx + 5, cy - 27 + l * 7, lw, 3)
        }
      }
      const rx = cx + 52
      const ry = cy - 22
      ctx.fillStyle = '#05070d'
      ctx.beginPath()
      ctx.arc(rx, ry, 25, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#052e16'
      ctx.beginPath()
      ctx.arc(rx, ry, 22, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#22c55e'
      ctx.lineWidth = 1
      for (const rr of [8, 15, 22]) {
        ctx.beginPath()
        ctx.arc(rx, ry, rr, 0, Math.PI * 2)
        ctx.stroke()
      }
      const sw = time * 2.4
      ctx.strokeStyle = '#86efac'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(rx, ry)
      ctx.lineTo(rx + Math.cos(sw) * 22, ry + Math.sin(sw) * 22)
      ctx.stroke()
      ctx.fillStyle = '#67e8f9'
      ctx.fillRect(rx + Math.cos(time * 0.4 + Math.PI) * 14 - 2, ry + Math.sin(time * 0.4 + Math.PI) * 14 - 2, 4, 4)
      ctx.fillStyle = linkBlink ? '#4ade80' : '#14532d'
      ctx.fillRect(cx - 4, cy - 44, 8, 6)
      ctx.font = 'bold 9px "Press Start 2P", monospace'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#000000'
      ctx.fillText('SAT-02 ●', cx + 1, cy - 51)
      ctx.fillStyle = '#67e8f9'
      ctx.fillText('SAT-02 ●', cx, cy - 52)
    }
  }

  // 8. PUERTAS CORREDIZAS MECÁNICAS INTERNAS
  for (const door of SLIDING_DOORS) {
    const openAmt = state.doorOpenMap[door.id] ?? 0
    const half = door.size / 2
    const gap = openAmt * (half - 8)

    if (door.orientation === 'vertical') {
      ctx.fillStyle = '#94a3b8'
      ctx.fillRect(door.x - 6, door.y - half, 12, half - gap)
      ctx.fillRect(door.x - 6, door.y + gap, 12, half - gap)
    } else {
      ctx.fillStyle = '#94a3b8'
      ctx.fillRect(door.x - half, door.y - 6, half - gap, 12)
      ctx.fillRect(door.x + gap, door.y - 6, half - gap, 12)
    }
  }

  // 9. MARCOS ABIERTOS DE TRANSICIÓN ENTRE SECTORES (paso físico 100% libre sin puertas láser)
  for (const gate of LASER_GATES) {
    const ownerInfo = ROLE_INFO[gate.owner]
    const half = gate.size / 2

    ctx.fillStyle = '#1e293b'
    if (gate.orientation === 'vertical') {
      ctx.fillRect(gate.x - 8, gate.y - half - 6, 16, 10)
      ctx.fillRect(gate.x - 8, gate.y + half - 4, 16, 10)
      // Baliza LED abierta en el umbral metálico
      ctx.fillStyle = '#22c55e'
      ctx.fillRect(gate.x - 2, gate.y - half - 2, 4, 4)
      ctx.fillRect(gate.x - 2, gate.y + half - 2, 4, 4)
      ctx.fillStyle = ownerInfo.color
      ctx.fillRect(gate.x - 1, gate.y - 4, 2, 8)
    } else {
      ctx.fillRect(gate.x - half - 6, gate.y - 8, 10, 16)
      ctx.fillRect(gate.x + half - 4, gate.y - 8, 10, 16)
      ctx.fillStyle = '#22c55e'
      ctx.fillRect(gate.x - half - 2, gate.y - 2, 4, 4)
      ctx.fillRect(gate.x + half - 2, gate.y - 2, 4, 4)
      ctx.fillStyle = ownerInfo.color
      ctx.fillRect(gate.x - 4, gate.y - 1, 8, 2)
    }
  }

  // ==========================================================================
  // 10. ELEMENTOS INTERACTIVOS DISTINTIVOS (INSIGNIA DEL ATLAS + BRILLO + "!" + 🔒)
  // ==========================================================================
  const interactiveAtlas = getStationSpriteAtlas()?.interactive
  for (const c of CONSOLES) {
    const isMyRole = canUseConsole(c, state.activeRole)
    const isNearOrHovered = state.nearestConsoleId === c.id || state.hoveredConsoleId === c.id
    const hasActiveTask = state.activeTaskConsoleIds.has(c.id)
    const roleColor = ROLE_INFO[c.role].color
    const pulse = 0.5 + 0.5 * Math.sin(time * 6)
    const mg = CONSOLE_MINIGAME[c.id]

    ctx.save()
    // Aura interactiva en el suelo para distinguir las terminales operables del mobiliario decorativo
    ctx.strokeStyle = !isMyRole && isNearOrHovered
      ? '#f87171'
      : hasActiveTask
      ? '#fde047'
      : isNearOrHovered
      ? '#ffffff'
      : roleColor
    ctx.lineWidth = hasActiveTask || isNearOrHovered ? 3.5 : 2
    ctx.globalAlpha = isMyRole ? (hasActiveTask || isNearOrHovered ? 0.95 : 0.62) : isNearOrHovered ? 0.9 : 0.36
    ctx.beginPath()
    ctx.ellipse(
      c.standX,
      c.standY + 12,
      hasActiveTask || isNearOrHovered ? 24 + pulse * 4 : 18,
      hasActiveTask || isNearOrHovered ? 11 + pulse * 2 : 8,
      0,
      0,
      Math.PI * 2
    )
    ctx.stroke()

    ctx.globalAlpha = 1
    // Placa pixel-art interactiva del Atlas diferenciada del mobiliario
    if (interactiveAtlas) {
      const badgeSprite =
        mg === 'dock' || mg === 'comet'
          ? interactiveAtlas.apasRadarBadge
          : mg === 'eps'
          ? interactiveAtlas.epsPanelBadge
          : mg === 'eclss' || mg === 'lander'
          ? interactiveAtlas.eclssConsoleBadge
          : c.id.startsWith('sat_ctrl') || mg === 'telecom'
          ? interactiveAtlas.satCtrlBadge
          : interactiveAtlas.navTerminalBadge
      drawAtlasSprite(ctx, badgeSprite, c.x - badgeSprite.width / 2, c.y + 12)
    }

    const bounce = Math.round(Math.sin(time * 7.5) * 4)

    // Candado claro de SOLO LECTURA si el jugador activo NO es el dueño de esta terminal
    if (!isMyRole && isNearOrHovered) {
      const lx = Math.round(c.x)
      const ly = Math.round(c.y - 38 + bounce * 0.4)
      ctx.fillStyle = '#070b12'
      ctx.fillRect(lx - 13, ly - 13, 26, 24)
      ctx.strokeStyle = '#f87171'
      ctx.lineWidth = 2
      ctx.strokeRect(lx - 13, ly - 13, 26, 24)
      ctx.strokeStyle = '#fca5a5'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(lx, ly - 3, 5, Math.PI, 0)
      ctx.stroke()
      ctx.fillStyle = '#f87171'
      ctx.fillRect(lx - 6, ly - 2, 12, 9)
      ctx.fillStyle = '#070b12'
      ctx.fillRect(lx - 1, ly + 1, 2, 4)
    }

    // Indicador pixel-art "!" amarillo rebotando sobre consola con tarea activa o zona de consola activa del dueño
    if (hasActiveTask || (isMyRole && isNearOrHovered)) {
      const bx = Math.round(c.x - 16)
      const by = Math.round(c.y - 54 + bounce)
      ctx.fillStyle = '#000000'
      ctx.fillRect(bx - 3, by - 3, 38, 38)
      ctx.fillStyle = hasActiveTask && Math.sin(time * 10) > 0 ? '#ef4444' : '#f59e0b'
      ctx.fillRect(bx, by, 32, 32)
      ctx.fillStyle = '#fde047'
      ctx.fillRect(bx + 4, by + 4, 24, 24)
      ctx.fillStyle = '#000000'
      ctx.fillRect(bx + 13, by + 6, 6, 13)
      ctx.fillRect(bx + 13, by + 21, 6, 5)
    }

    // Cursor pixel-art amarillo señalando la consola operada por el dueño
    if (isMyRole && isNearOrHovered) {
      const ax = Math.round(c.x)
      const ay = Math.round(c.y - 70 + bounce * 0.5)
      ctx.fillStyle = '#000000'
      ctx.fillRect(ax - 12, ay - 12, 24, 16)
      ctx.fillStyle = '#fde047'
      ctx.fillRect(ax - 9, ay - 9, 18, 6)
      ctx.fillRect(ax - 5, ay - 3, 10, 4)
      ctx.fillRect(ax - 2, ay + 1, 4, 3)
    }

    ctx.restore()
  }
}

// ============================================================================
// 5. COMPONENTE PRINCIPAL (LIENZO 100% ANCHO + MODAL GRANDE DE CONSOLA RETRO)
// ============================================================================
export default function StationOperationScreen({
  onBackToWorkshop,
  onReplayCutscene,
  onOpenTelemetryReport,
  onExitToMenu,
}: Props) {
  const s = useGame()
  const contract = CONTRACTS.find((c) => c.id === s.contractId) ?? CONTRACTS[0]
  const launcher = LAUNCHERS.find((l) => l.id === s.launcherId) ?? LAUNCHERS[0]
  const chassis = CHASSIS.find((c) => c.id === s.chassisId) ?? CHASSIS[1]

  const baseTel = useMemo(
    () =>
      analyze({
        contractId: s.contractId,
        launcherId: s.launcherId,
        chassisId: s.chassisId,
        parts: s.parts,
      }),
    [s.contractId, s.launcherId, s.chassisId, s.parts]
  )

  // ESTADO INICIAL 100% ESTABLE
  const [battery, setBattery] = useState<number>(92)
  const [lifeSupport, setLifeSupport] = useState<number>(100)
  const [dataBuffer, setDataBuffer] = useState<number>(0)
  const [orbitStability, setOrbitStability] = useState<number>(100)
  const [hull, setHull] = useState<number>(100)
  const [signalQuality, setSignalQuality] = useState<number>(100)
  const [officialScience, setOfficialScience] = useState(() => Math.round(baseTel.sciPts * 0.4))
  const [missionProgress, setMissionProgress] = useState<number>(15)
  const [activeEvent, setActiveEvent] = useState<StationEventId>('none')
  const [overviewMode, setOverviewMode] = useState(false)
  const [visitingQuadrant, setVisitingQuadrant] = useState<QuadrantId | null>(null)
  const [playerCurrentQuadrant, setPlayerCurrentQuadrant] = useState<QuadrantId>(s.activeRole)
  const [visitorAlert, setVisitorAlert] = useState<{ msg: string; owner: RoleId } | null>(null)
  const [completedMissionIds, setCompletedMissionIds] = useState<string[]>([])
  const [missionPanelOpen, setMissionPanelOpen] = useState(true)
  const [missionCompleted, setMissionCompleted] = useState(false)
  const [nearestConsoleId, setNearestConsoleId] = useState<string | null>(null)
  const [hoveredConsoleId, setHoveredConsoleId] = useState<string | null>(null)
  const [openConsoleId, setOpenConsoleIdRaw] = useState<string | null>(null)
  const [activeMinigame, setActiveMinigame] = useState<MinigameId | null>(null)
  const [navSatTarget, setNavSatTarget] = useState<'sat1' | 'sat2'>('sat1')
  // Al "abrir" una consola con minijuego asignado, se abre el modal del minijuego en lugar de la terminal simple
  const setOpenConsoleId = useCallback((id: string | null) => {
    if (id) {
      const mg = CONSOLE_MINIGAME[id]
      if (mg) {
        if (mg === 'nav') {
          setNavSatTarget(id === 'sat_ctrl_2' || id === 'sci_lab' ? 'sat2' : 'sat1')
        }
        setActiveMinigame(mg)
        setOpenConsoleIdRaw(null)
        return
      }
    }
    setOpenConsoleIdRaw(id)
  }, [])
  const [currentRoomLabel, setCurrentRoomLabel] = useState<string>('GROUND SEGMENT')

  // Cola reactiva de misiones/problemas encadenados (máximo 2 activos a la vez)
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([
    {
      id: 'init_sci',
      role: 'science',
      consoleId: 'sci_scan',
      kind: 'mission',
      title: 'Aterrizaje Sonda Planetaria (USER SEGMENT)',
      reason:
        'La estación se encuentra 100% estable en órbita. Acércate al simulador en USER SEGMENT para pilotar la sonda planetaria e iniciar la cadena de misión.',
    },
  ])

  const [logs, setLogs] = useState<IntercomLog[]>(() => [
    {
      id: 1,
      from: 'director',
      kind: 'ok',
      text: `"¡Estación en órbita! Acércate a cualquier máquina con el signo (!) y presiona 'E' para abrir la terminal de la NASA."`,
    },
  ])

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasSizeRef = useRef<{ w: number; h: number }>({ w: 640, h: 360 })
  const keysRef = useRef<Set<string>>(new Set())
  const logIdRef = useRef(2)
  const floatIdRef = useRef(1)
  const floatingTextsRef = useRef<CanvasFloatingText[]>([])
  const doorOpenRef = useRef<Record<string, number>>({})
  const lastGateWarnAtRef = useRef<number>(0)
  const deniedConsoleRef = useRef<{ consoleId: string; owner: RoleId; until: number } | null>(null)

  const camRef = useRef<{ x: number; y: number; zoom: number }>({
    x: ROOM_BY_ID.ground_segment.hull.x + ROOM_BY_ID.ground_segment.hull.w / 2,
    y: ROOM_BY_ID.ground_segment.hull.h / 2 + ROOM_BY_ID.ground_segment.hull.y,
    zoom: 0.72,
  })

  const astronautsRef = useRef<Record<RoleId, AstronautEntity>>({
    director: {
      role: 'director',
      x: ROLE_SPAWNS.director.x,
      y: ROLE_SPAWNS.director.y,
      dir: 'left',
      walkFrame: 0,
      isMoving: false,
      isInteracting: false,
      interactUntil: 0,
      waypoints: [],
      aiPauseUntil: 2.5,
      aiTargetIdx: 0,
    },
    engineer: {
      role: 'engineer',
      x: ROLE_SPAWNS.engineer.x,
      y: ROLE_SPAWNS.engineer.y,
      dir: 'left',
      walkFrame: 0,
      isMoving: false,
      isInteracting: false,
      interactUntil: 0,
      waypoints: [],
      aiPauseUntil: 2.0,
      aiTargetIdx: 0,
    },
    science: {
      role: 'science',
      x: ROLE_SPAWNS.science.x,
      y: ROLE_SPAWNS.science.y,
      dir: 'down',
      walkFrame: 0,
      isMoving: false,
      isInteracting: false,
      interactUntil: 0,
      waypoints: [],
      aiPauseUntil: 1.8,
      aiTargetIdx: 0,
    },
    comms: {
      role: 'comms',
      x: ROLE_SPAWNS.comms.x,
      y: ROLE_SPAWNS.comms.y,
      dir: 'right',
      walkFrame: 0,
      isMoving: false,
      isInteracting: false,
      interactUntil: 0,
      waypoints: [],
      aiPauseUntil: 2.2,
      aiTargetIdx: 0,
    },
  })

  const activeRole = s.activeRole
  const activeRoleInfo = ROLE_INFO[activeRole]

  const isLowO2 = lifeSupport < 65
  const isOrbitDrift = orbitStability < 70

  // Resolución lógica Pixel-Art HD adaptativa: mitad del contenedor visual (~640x360 a 720x400) sin franjas 4:3
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return

    const syncCanvasSize = () => {
      const nextW = Math.max(MIN_PIXEL_W, Math.round(vp.clientWidth / PIXEL_DOWNSCALE))
      const nextH = Math.max(MIN_PIXEL_H, Math.round(vp.clientHeight / PIXEL_DOWNSCALE))
      canvasSizeRef.current = { w: nextW, h: nextH }
      const canvas = canvasRef.current
      if (canvas) {
        if (canvas.width !== nextW) canvas.width = nextW
        if (canvas.height !== nextH) canvas.height = nextH
      }
    }

    syncCanvasSize()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(syncCanvasSize)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])

  const pushLog = useCallback(
    (from: RoleId | 'sistema', kind: 'info' | 'warn' | 'ok', text: string) => {
      setLogs((prev) => [...prev.slice(-18), { id: ++logIdRef.current, from, kind, text }])
    },
    []
  )

  const spawnCanvasFloating = useCallback((x: number, y: number, text: string, color: string) => {
    floatingTextsRef.current.push({
      id: ++floatIdRef.current,
      x,
      y,
      text,
      color,
      bornAt: performance.now() / 1000,
    })
  }, [])

  const playConsoleBeep = useCallback((freq = 520, ok = true) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ac = new AudioCtx()
      const now = ac.currentTime
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = ok ? 'square' : 'sawtooth'
      osc.frequency.setValueAtTime(freq, now)
      osc.frequency.exponentialRampToValueAtTime(ok ? freq * 1.45 : freq * 0.55, now + 0.16)
      g.gain.setValueAtTime(0.001, now)
      g.gain.exponentialRampToValueAtTime(0.11, now + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.17)
      osc.connect(g)
      g.connect(ac.destination)
      osc.start(now)
      osc.stop(now + 0.19)
      window.setTimeout(() => void ac.close().catch(() => {}), 300)
    } catch {
      // Ignore audio errors
    }
  }, [])

  const triggerReadOnlyAlert = useCallback(
    (target: ConsoleStation | RoleId, wx?: number, wy?: number) => {
      const ownerRole: RoleId = typeof target === 'string' ? target : target.role
      const ownerInfo = ROLE_INFO[ownerRole]
      const now = performance.now() / 1000
      const lockMsg = `🔒 SOLO ${ownerInfo.animalName} PUEDE RESOLVER ESTE SISTEMA`

      setVisitorAlert({ msg: lockMsg, owner: ownerRole })
      if (typeof target !== 'string') {
        deniedConsoleRef.current = { consoleId: target.id, owner: ownerRole, until: now + 3.0 }
      }

      if (now - lastGateWarnAtRef.current < 0.35) return
      lastGateWarnAtRef.current = now

      playConsoleBeep(195, false)
      const ent = astronautsRef.current[activeRole]
      const fx = wx ?? (typeof target === 'string' ? ent.x : target.x)
      const fy = wy ?? (typeof target === 'string' ? ent.y - 34 : target.y - 26)
      spawnCanvasFloating(fx, fy, lockMsg, '#fbbf24')
      pushLog('sistema', 'warn', `"${lockMsg} (${ownerInfo.icon} ${ownerInfo.code})"`)
    },
    [activeRole, playConsoleBeep, pushLog, spawnCanvasFloating]
  )

  useEffect(() => {
    if (!visitorAlert) return
    const t = window.setTimeout(() => setVisitorAlert(null), 3800)
    return () => window.clearTimeout(t)
  }, [visitorAlert])

  const upsertReactiveTasks = useCallback((completedConsoleId: string, nextTasks: ActiveTask[]) => {
    setActiveTasks((prev) => {
      const remaining = prev.filter((t) => t.consoleId !== completedConsoleId)
      const merged = [...remaining]
      for (const nt of nextTasks) {
        if (!merged.some((m) => m.consoleId === nt.consoleId)) {
          merged.push(nt)
        }
      }
      return merged.slice(-2)
    })
  }, [])

  // ==========================================================================
  // MOTOR DE REACCIÓN EN CADENA AL EJECUTAR ACCIÓN EN EL MODAL DE CONSOLA
  // ==========================================================================
  const executeConsole = useCallback(
    (c: ConsoleStation) => {
      const nowSec = performance.now() / 1000
      const ent = astronautsRef.current[c.role]
      ent.isInteracting = true
      ent.interactUntil = nowSec + 1.35
      ent.dir = c.x < ent.x ? 'left' : 'right'

      const advanceProgress = (delta: number) => {
        setMissionProgress((p) => {
          const next = clamp(p + delta, 0, 100)
          if (next >= 100) {
            setMissionCompleted(true)
            playIntroSweep()
          }
          return next
        })
      }

      switch (c.id) {
        case 'sci_scan':
        case 'sci_holo': {
          playConsoleBeep(780, true)
          const newBuf = clamp(dataBuffer + 55, 0, 100)
          setDataBuffer(newBuf)
          setOfficialScience((sPts) => sPts + 30)
          setBattery((b) => clamp(b - 28, 35, 100))
          advanceProgress(12)

          spawnCanvasFloating(c.x, c.y - 24, '+55% DATOS · ⚡ SOBRECARGA REACTOR', '#55efc4')
          pushLog(
            'science',
            'warn',
            `"🐆 PUMA-3 analizó muestras en USER SEGMENT (+55% Buffer), pero sobrecargó el núcleo naranja. ¡🦙 ALPACA-1 estabiliza POWER MGD & REACTOR y 🐍 SERPIENTE-2 transmite en COMMUNICATIONS!"`
          )

          upsertReactiveTasks(c.id, [
            {
              id: `task_eng_${Date.now()}`,
              role: 'engineer',
              consoleId: 'eng_cool',
              kind: 'problem',
              title: 'Estabilizar Reactor Naranja en POWER MGD',
              reason:
                'El láser multiespectral de PUMA-3 calentó el núcleo cilíndrico naranja y consumió carga de las baterías.',
            },
            {
              id: `task_com_${Date.now()}`,
              role: 'comms',
              consoleId: 'com_tx',
              kind: 'mission',
              title: 'Transmitir Datos DSN en COMMUNICATIONS',
              reason:
                'Hay un paquete científico listo en el Buffer de Memoria esperando ser enviado a la Tierra por la antena parabólica.',
            },
          ])
          break
        }

        case 'sci_lab': {
          playConsoleBeep(680, true)
          setOfficialScience((sPts) => sPts + 25)
          setDataBuffer((v) => clamp(v + 40, 0, 100))
          advanceProgress(10)
          spawnCanvasFloating(c.x, c.y - 24, '⚗️ MATRACES PROCESADOS (+25 PTS)', '#7bff9a')
          pushLog(
            'science',
            'ok',
            `"🐆 PUMA-3 procesó los matraces en la campana extractora de LABORATORY. ¡Paquete listo para 🐍 SERPIENTE-2 en COMMUNICATIONS!"`
          )
          upsertReactiveTasks(c.id, [
            {
              id: `task_com_lab_${Date.now()}`,
              role: 'comms',
              consoleId: 'com_tx',
              kind: 'mission',
              title: 'Transmitir Paquetes DSN en COMMUNICATIONS',
              reason:
                'El servidor científico de LABORATORY comprimió nuevos resultados listos para descarga orbital.',
            },
          ])
          break
        }

        case 'com_tx': {
          playConsoleBeep(880, true)
          const gainedSci = Math.max(35, Math.round(Math.max(40, dataBuffer) * (signalQuality / 100)))
          setDataBuffer(0)
          setOfficialScience((sPts) => sPts + gainedSci)
          setOrbitStability(58)
          advanceProgress(18)

          spawnCanvasFloating(c.x, c.y - 24, `🚀 +${gainedSci} PTS A TIERRA · 🧭 DERIVA ORBITAL`, '#74b9ff')
          pushLog(
            'comms',
            'warn',
            `"🐍 SERPIENTE-2 transmitió por el plato parabólico de COMMUNICATIONS (+${gainedSci} PTS), pero el giro movió la actitud orbital. ¡🦅 CÓNDOR-4, corrige la órbita en GROUND SEGMENT!"`
          )

          upsertReactiveTasks(c.id, [
            {
              id: `task_dir_orbit_${Date.now()}`,
              role: 'director',
              consoleId: 'dir_orbit',
              kind: 'problem',
              title: 'Corregir Altitud en las 5 Pantallas (GROUND SEGMENT)',
              reason:
                'El retroceso de la transmisión en Banda X en COMMUNICATIONS desvió el apuntamiento orbital de la estación al 58%.',
            },
          ])
          break
        }

        case 'com_align':
        case 'com_filter': {
          playConsoleBeep(700, true)
          setSignalQuality(100)
          if (activeEvent === 'solar_storm') setActiveEvent('none')
          advanceProgress(9)
          spawnCanvasFloating(c.x, c.y - 24, '📡 SPACE SEGMENT SINCRONIZADO AL 100%', '#74b9ff')
          pushLog(
            'comms',
            'ok',
            `"🐍 SERPIENTE-2 alineó el telescopio y los 2 CubeSats en SPACE SEGMENT. Cruza al módulo contiguo COMMUNICATIONS para transmitir a Tierra."`
          )
          upsertReactiveTasks(c.id, [
            {
              id: `task_com_tx_${Date.now()}`,
              role: 'comms',
              consoleId: 'com_tx',
              kind: 'mission',
              title: 'Transmitir en el Domo de COMMUNICATIONS',
              reason: 'Telescopio óptico y constelación CubeSat alineados al 100% con la Tierra.',
            },
          ])
          break
        }

        case 'dir_orbit':
        case 'dir_engine': {
          playConsoleBeep(600, true)
          setOrbitStability(100)
          setLifeSupport(58)
          advanceProgress(15)

          spawnCanvasFloating(c.x, c.y - 24, '🧭 ÓRBITA 100% · 🫧 PRESURIZAR O2', '#ffd23f')
          pushLog(
            'director',
            'warn',
            `"🦅 CÓNDOR-4 estabilizó la órbita al 100%. El impulso de la turbina consumió presión de cabina: ¡🦙 ALPACA-1, presuriza los 2 Tanques Azules O2 en LIFE SUPPORT!"`
          )

          upsertReactiveTasks(c.id, [
            {
              id: `task_eng_o2_${Date.now()}`,
              role: 'engineer',
              consoleId: 'eng_o2',
              kind: 'problem',
              title: 'Presurizar Tanques O2 en LIFE SUPPORT',
              reason:
                'La maniobra de corrección orbital de CÓNDOR-4 consumió presión del circuito de Soporte Vital O2 (58%).',
            },
          ])
          break
        }

        case 'dir_shield': {
          playConsoleBeep(720, true)
          setHull(100)
          advanceProgress(12)
          spawnCanvasFloating(c.x, c.y - 24, '🛡️ TRANSBORDADOR Y BRAZO AL 100%', '#5ef0ff')
          pushLog(
            'director',
            'ok',
            `"🦅 CÓNDOR-4 aseguró el brazo hidráulico naranja y el transbordador blanco en LAUNCH SEGMENT."`
          )
          upsertReactiveTasks(c.id, [
            {
              id: `task_sci_lab_${Date.now()}`,
              role: 'science',
              consoleId: 'sci_lab',
              kind: 'mission',
              title: 'Procesar Muestras en LABORATORY',
              reason: 'Hangar estabilizado y listo para nuevo lote de análisis químico.',
            },
          ])
          break
        }

        case 'eng_cool':
        case 'eng_solar':
        case 'eng_switch': {
          playConsoleBeep(680, true)
          setBattery(98)
          if (activeEvent === 'eclipse') setActiveEvent('none')
          advanceProgress(14)

          spawnCanvasFloating(c.x, c.y - 24, '⚡ REACTOR Y MASTER SWITCH AL 98%', '#ffd23f')
          pushLog(
            'engineer',
            'ok',
            `"🦙 ALPACA-1 estabilizó el núcleo naranja del REACTOR y los racks de baterías (+98% Energía). ¡🐍 SERPIENTE-2 tiene potencia máxima en COMMUNICATIONS!"`
          )

          upsertReactiveTasks(c.id, [
            {
              id: `task_com_tx2_${Date.now()}`,
              role: 'comms',
              consoleId: dataBuffer >= 30 ? 'com_tx' : 'com_align',
              kind: 'mission',
              title:
                dataBuffer >= 30
                  ? 'Transmitir Paquetes DSN en COMMUNICATIONS'
                  : 'Alinear Telescopio en SPACE SEGMENT',
              reason: 'ALPACA-1 restableció el 98% de potencia en el Reactor y los paneles solares.',
            },
          ])
          break
        }

        case 'eng_o2': {
          playConsoleBeep(620, true)
          setLifeSupport(100)
          setHull(100)
          advanceProgress(15)

          spawnCanvasFloating(c.x, c.y - 24, '🫧 TANQUES O2 AL 100% · NAVE NOMINAL', '#7bff9a')
          pushLog(
            'engineer',
            'ok',
            `"🦙 ALPACA-1 presurizó los 2 tanques azules de O2 en LIFE SUPPORT al 100%. ¡Sistema listo para la sonda científica en USER SEGMENT!"`
          )

          upsertReactiveTasks(c.id, [
            {
              id: `task_sci_cycle_${Date.now()}`,
              role: 'science',
              consoleId: 'sci_holo',
              kind: 'mission',
              title: 'Descenso Planetario en USER SEGMENT',
              reason: 'Soporte vital O2 y válvulas restaurados al 100% por ALPACA-1.',
            },
          ])
          break
        }
      }

      const solvedIds = MISSION_BACKLOG.filter((m) => m.consoleIds.includes(c.id)).map((m) => m.id)
      if (solvedIds.length > 0) {
        setCompletedMissionIds((prev) => Array.from(new Set([...prev, ...solvedIds])))
      }

      setOpenConsoleId(null)
    },
    [
      activeEvent,
      dataBuffer,
      playConsoleBeep,
      pushLog,
      setOpenConsoleId,
      signalQuality,
      spawnCanvasFloating,
      upsertReactiveTasks,
    ]
  )

  // ==========================================================================
  // CONEXIÓN GLOBAL: al ganar un minijuego se actualiza el estado COMPARTIDO de la estación
  // ==========================================================================
  const handleMinigameComplete = useCallback(
    (game: MinigameId) => {
      playConsoleBeep(880, true)
      const me = astronautsRef.current[activeRole]
      const fx = me.x
      const fy = me.y - 44
      const advance = (delta: number) => {
        setMissionProgress((p) => {
          const next = clamp(p + delta, 0, 100)
          if (next >= 100) {
            setMissionCompleted(true)
            playIntroSweep()
          }
          return next
        })
      }
      const group = MINIGAME_CONSOLES[game]
      setActiveTasks((prev) => prev.filter((t) => !group.includes(t.consoleId)))
      const solvedMinigameIds = MISSION_BACKLOG.filter((m) =>
        m.consoleIds.some((cid) => group.includes(cid))
      ).map((m) => m.id)
      if (solvedMinigameIds.length > 0) {
        setCompletedMissionIds((prev) => Array.from(new Set([...prev, ...solvedMinigameIds])))
      }
      const stamp = Date.now()

      switch (game) {
        case 'dock':
          setOrbitStability(100)
          setHull((h) => clamp(h + 15, 0, 100))
          setOfficialScience((v) => v + 35)
          advance(13)
          spawnCanvasFloating(fx, fy, '🚀 ACOPLAMIENTO APAS COMPLETO · +35 PTS', '#ffd23f')
          pushLog(
            activeRole,
            'ok',
            '"🚀 Acoplamiento APAS completado a menos de 0.15 m/s: órbita 100%, casco +15% (+35 PTS)."'
          )
          upsertReactiveTasks(group[0], [
            {
              id: `task_eclss_${stamp}`,
              role: 'engineer',
              consoleId: 'eng_o2',
              kind: 'mission',
              title: 'Estabilizar Soporte Vital O2 (LIFE SUPPORT)',
              reason: 'El módulo acoplado requiere equilibrar presión, O2 y humedad con ALPACA-1.',
            },
          ])
          break

        case 'comet':
          setHull(100)
          setOrbitStability((o) => clamp(o + 15, 0, 100))
          setOfficialScience((v) => v + 40)
          advance(13)
          spawnCanvasFloating(fx, fy, '☄️ COMETA INTERCEPTADO · CASCO 100% · +40 PTS', '#ffd23f')
          pushLog(
            activeRole,
            'ok',
            '"☄️ Reencuentro con el cometa superado: escudos activos, casco restaurado al 100% (+40 PTS)."'
          )
          upsertReactiveTasks(group[0], [
            {
              id: `task_lander_${stamp}`,
              role: 'science',
              consoleId: 'sci_scan',
              kind: 'mission',
              title: 'Aterrizaje Sonda en USER SEGMENT',
              reason: 'Cometa analizado y casco seguro: PUMA-3 puede descender la sonda planetaria.',
            },
          ])
          break

        case 'eps':
          setBattery(100)
          if (activeEvent === 'eclipse') setActiveEvent('none')
          setOfficialScience((v) => v + 35)
          advance(12)
          spawnCanvasFloating(fx, fy, '⚡ BUSES EPS BALANCEADOS · BATERÍA 100% · +35 PTS', '#ffd23f')
          pushLog(
            activeRole,
            'ok',
            '"⚡ Distribución EPS balanceada: Batería al 100% (+35 PTS) compartida con toda la estación."'
          )
          upsertReactiveTasks(group[0], [
            {
              id: `task_cyber_${stamp}`,
              role: 'comms',
              consoleId: 'com_align',
              kind: 'mission',
              title: 'Ciberdefensa Satelital (SPACE SEGMENT)',
              reason: 'Con energía al 100%, SERPIENTE-2 debe blindar los nodos contra ciberataques.',
            },
          ])
          break

        case 'eclss':
          setLifeSupport(100)
          if (activeEvent === 'o2_leak') setActiveEvent('none')
          setOfficialScience((v) => v + 35)
          advance(12)
          spawnCanvasFloating(fx, fy, '🫧 SOPORTE VITAL O2 100% · +35 PTS', '#55efc4')
          pushLog(
            activeRole,
            'ok',
            '"🫧 ECLSS estabilizado por ALPACA-1: O2, CO2, presión y temperatura nominales al 100% (+35 PTS)."'
          )
          upsertReactiveTasks(group[0], [
            {
              id: `task_nav_sat2_${stamp}`,
              role: 'science',
              consoleId: 'sat_ctrl_2',
              kind: 'mission',
              title: 'Órbita SAT-02 INTI-SCIENCE (USER SEGMENT)',
              reason: 'Atmósfera estable en la nave: PUMA-3 puede calibrar la órbita del SAT-02.',
            },
          ])
          break

        case 'lander':
          setDataBuffer((v) => clamp(v + 40, 0, 100))
          setOfficialScience((v) => v + 45)
          advance(13)
          spawnCanvasFloating(fx, fy, '🛬 ATERRIZAJE SONDA · +40% DATOS · +45 PTS', '#55efc4')
          pushLog(
            activeRole,
            'ok',
            '"🛬 Sonda planetaria aterrizada con éxito por PUMA-3: muestras recolectadas (+40% Buffer · +45 PTS)."'
          )
          upsertReactiveTasks(group[0], [
            {
              id: `task_telecom_${stamp}`,
              role: 'comms',
              consoleId: 'com_tx',
              kind: 'mission',
              title: 'Reparación Telecom DSN (COMMUNICATIONS)',
              reason: 'Hay muestras planetarias en el Buffer listas para transmitirse a la Tierra.',
            },
          ])
          break

        case 'nav':
          setOrbitStability(100)
          setSignalQuality(100)
          if (activeEvent === 'solar_storm') setActiveEvent('none')
          setOfficialScience((v) => v + 40)
          advance(13)
          spawnCanvasFloating(fx, fy, '🛰️ SAT-01 / SAT-02 EN ÓRBITA · +40 PTS', '#74b9ff')
          pushLog(
            activeRole,
            'ok',
            '"🛰️ Satélites orbitales (AMARU-COMMS e INTI-SCIENCE) alineados al 100%: órbita y señal estables (+40 PTS)."'
          )
          upsertReactiveTasks(group[0], [
            {
              id: `task_eps_${stamp}`,
              role: 'engineer',
              consoleId: 'eng_switch',
              kind: 'mission',
              title: 'Distribución Eléctrica EPS (POWER MGD)',
              reason: 'Los satélites alineados demandan carga estable entre los 3 buses de potencia.',
            },
          ])
          break

        case 'telecom':
          setSignalQuality(100)
          setDataBuffer(0)
          if (activeEvent === 'solar_storm') setActiveEvent('none')
          setOfficialScience((v) => v + 35)
          advance(12)
          spawnCanvasFloating(fx, fy, '📡 TELECOM DSN 100% · BUFFER ENVIADO · +35 PTS', '#74b9ff')
          pushLog(
            activeRole,
            'ok',
            '"📡 Enlace DSN reparado por SERPIENTE-2: señal al 100% y Buffer descargado a la Tierra (+35 PTS)."'
          )
          upsertReactiveTasks(group[0], [
            {
              id: `task_dock_${stamp}`,
              role: 'director',
              consoleId: 'dir_orbit',
              kind: 'mission',
              title: 'Acoplamiento APAS en GROUND SEGMENT',
              reason: 'Telemetría DSN al 100%: CÓNDOR-4 autorizado para maniobra de acoplamiento.',
            },
          ])
          break

        case 'cyber':
          setSignalQuality(100)
          if (activeEvent === 'solar_storm') setActiveEvent('none')
          setOfficialScience((v) => v + 40)
          advance(12)
          spawnCanvasFloating(fx, fy, '🛡️ FIREWALL SATELITAL 100% · +40 PTS', '#74b9ff')
          pushLog(
            activeRole,
            'ok',
            '"🛡️ Ciberdefensa completada por SERPIENTE-2: intrusiones bloqueadas y red segura al 100% (+40 PTS)."'
          )
          upsertReactiveTasks(group[0], [
            {
              id: `task_comet_${stamp}`,
              role: 'director',
              consoleId: 'dir_shield',
              kind: 'mission',
              title: 'Reencuentro Cometa en LAUNCH SEGMENT',
              reason: 'Red satelital limpia: CÓNDOR-4 puede activar el radar táctico en Hangar.',
            },
          ])
          break
      }
    },
    [activeEvent, activeRole, playConsoleBeep, pushLog, spawnCanvasFloating, upsertReactiveTasks]
  )

  const closeMinigame = useCallback(() => {
    setActiveMinigame(null)
    playClick()
  }, [])

  const openOrWalkToConsole = useCallback(
    (c: ConsoleStation) => {
      // Bloqueo estricto de solo lectura para visitantes: NUNCA cambiar el rol ni abrir terminales ajenas
      if (!canUseConsole(c, activeRole)) {
        triggerReadOnlyAlert(c, c.x, c.y - 24)
        return
      }
      const ent = astronautsRef.current[activeRole]
      const dist = Math.hypot(ent.x - c.standX, ent.y - c.standY)
      if (dist < 95) {
        playClick()
        setOpenConsoleId(c.id)
      } else {
        setVisitingQuadrant(null)
        ent.waypoints = buildWaypointPath(ent.x, ent.y, c.standX, c.standY, c.id)
      }
    },
    [activeRole, setOpenConsoleId, triggerReadOnlyAlert]
  )

  const openConsole = useMemo(
    () => (openConsoleId ? CONSOLES.find((c) => c.id === openConsoleId) ?? null : null),
    [openConsoleId]
  )

  // Controles de teclado: E abre consola propia cercana (o alerta solo lectura si es ajena); 1-4 cambia especialista
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeMinigame) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const k = e.key.toLowerCase()

      if (k === 'escape') {
        if (openConsoleId) {
          e.preventDefault()
          playClick()
          setOpenConsoleId(null)
        } else if (visitingQuadrant) {
          e.preventDefault()
          playClick()
          setVisitingQuadrant(null)
        }
        return
      }

      if (openConsole) {
        if (k === ' ' || k === 'enter' || k === 'e') {
          e.preventDefault()
          executeConsole(openConsole)
        }
        return
      }

      if (e.key >= '1' && e.key <= '4') {
        const idx = Number(e.key) - 1
        setVisitingQuadrant(null)
        setOpenConsoleId(null)
        actions.setRole(ROLE_ORDER[idx])
        playClick()
        return
      }

      if (k === 'e' || k === ' ' || k === 'enter') {
        e.preventDefault()
        const me = astronautsRef.current[activeRole]
        // 1. Verificar cualquier consola cercana (propia o ajena) para aplicar el bloqueo estricto de visitante
        let nearestAny: ConsoleStation | null = null
        let nearestAnyDist = Infinity
        for (const c of CONSOLES) {
          const d = Math.hypot(c.standX - me.x, c.standY - me.y)
          if (d < nearestAnyDist) {
            nearestAnyDist = d
            nearestAny = c
          }
        }
        if (nearestAny && nearestAnyDist < 115) {
          if (!canUseConsole(nearestAny, activeRole)) {
            triggerReadOnlyAlert(nearestAny, nearestAny.x, nearestAny.y - 24)
            return
          }
          playClick()
          setOpenConsoleId(nearestAny.id)
          return
        }

        // 2. Si está inspeccionando un cuadrante ajeno desde el minimapa y presiona E, alertar solo lectura
        if (visitingQuadrant && visitingQuadrant !== activeRole) {
          triggerReadOnlyAlert(visitingQuadrant)
          return
        }

        // 3. De lo contrario caminar hacia su consola propia más cercana
        const myConsoles = CONSOLES.filter((c) => canUseConsole(c, activeRole))
        let best: ConsoleStation | null = null
        let bestD = Infinity
        for (const c of myConsoles) {
          const d = Math.hypot(c.standX - me.x, c.standY - me.y)
          if (d < bestD) {
            bestD = d
            best = c
          }
        }
        if (best) {
          openOrWalkToConsole(best)
        }
        return
      }

      keysRef.current.add(k)
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        astronautsRef.current[activeRole].waypoints = []
        setVisitingQuadrant(null)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase())
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    activeMinigame,
    activeRole,
    executeConsole,
    openConsole,
    openConsoleId,
    openOrWalkToConsole,
    setOpenConsoleId,
    triggerReadOnlyAlert,
    visitingQuadrant,
  ])

  // Al abrir un minijuego se sueltan las teclas de movimiento retenidas
  useEffect(() => {
    if (activeMinigame) keysRef.current.clear()
  }, [activeMinigame])

  const activeTaskConsoleIds = useMemo(
    () => new Set(activeTasks.map((t) => t.consoleId)),
    [activeTasks]
  )

  const liveStateRef = useRef({
    battery,
    lifeSupport,
    dataBuffer,
    orbitStability,
    hull,
    signalQuality,
    activeEvent,
    activeRole,
    overviewMode,
    visitingQuadrant,
    playerCurrentQuadrant,
    nearestConsoleId,
    hoveredConsoleId,
    activeTaskConsoleIds,
  })
  useEffect(() => {
    liveStateRef.current = {
      battery,
      lifeSupport,
      dataBuffer,
      orbitStability,
      hull,
      signalQuality,
      activeEvent,
      activeRole,
      overviewMode,
      visitingQuadrant,
      playerCurrentQuadrant,
      nearestConsoleId,
      hoveredConsoleId,
      activeTaskConsoleIds,
    }
  }, [
    battery,
    lifeSupport,
    dataBuffer,
    orbitStability,
    hull,
    signalQuality,
    activeEvent,
    activeRole,
    overviewMode,
    visitingQuadrant,
    playerCurrentQuadrant,
    nearestConsoleId,
    hoveredConsoleId,
    activeTaskConsoleIds,
  ])

  // ==========================================================================
  // 6. BUCLE PRINCIPAL DE MOTOR CANVAS PIXEL-ART A 60 FPS
  // ==========================================================================
  useEffect(() => {
    let rafId = 0
    let lastTime = performance.now() / 1000

    const tick = (nowMs: number) => {
      const time = nowMs / 1000
      const dt = Math.min(0.05, Math.max(0.001, time - lastTime))
      lastTime = time

      const st = liveStateRef.current
      const ks = keysRef.current
      const speed = 225

      for (const r of ROLE_ORDER) {
        const ent = astronautsRef.current[r]
        if (time > ent.interactUntil) {
          ent.isInteracting = false
        }

        let vx = 0
        let vy = 0

        if (r === st.activeRole) {
          if (ks.has('arrowleft') || ks.has('a')) vx -= 1
          if (ks.has('arrowright') || ks.has('d')) vx += 1
          if (ks.has('arrowup') || ks.has('w')) vy -= 1
          if (ks.has('arrowdown') || ks.has('s')) vy += 1

          if (vx !== 0 || vy !== 0) {
            const len = Math.hypot(vx, vy)
            vx = (vx / len) * speed
            vy = (vy / len) * speed
          } else if (ent.waypoints.length > 0) {
            const wp = ent.waypoints[0]
            const dx = wp.x - ent.x
            const dy = wp.y - ent.y
            const dist = Math.hypot(dx, dy)
            if (dist < 12) {
              const finishedWp = ent.waypoints.shift()!
              if (finishedWp.consoleId) {
                const targetC = CONSOLES.find((c) => c.id === finishedWp.consoleId)
                if (targetC && canUseConsole(targetC, st.activeRole)) {
                  playClick()
                  setOpenConsoleId(finishedWp.consoleId)
                }
              }
            } else {
              vx = (dx / dist) * speed
              vy = (dy / dist) * speed
            }
          }
        } else {
          if (ent.waypoints.length > 0) {
            const wp = ent.waypoints[0]
            const dx = wp.x - ent.x
            const dy = wp.y - ent.y
            const dist = Math.hypot(dx, dy)
            if (dist < 12) {
              ent.waypoints.shift()
              if (ent.waypoints.length === 0) {
                ent.isInteracting = true
                ent.interactUntil = time + 1.8
                ent.aiPauseUntil = time + 4.5 + Math.random() * 2.5
              }
            } else {
              vx = (dx / dist) * (speed * 0.56)
              vy = (dy / dist) * (speed * 0.56)
            }
          } else if (time > ent.aiPauseUntil) {
            const myConsoles = CONSOLES.filter((c) => c.role === r)
            if (myConsoles.length > 0) {
              ent.aiTargetIdx = (ent.aiTargetIdx + 1) % myConsoles.length
              const nextC = myConsoles[ent.aiTargetIdx]
              if (nextC) {
                ent.waypoints = buildWaypointPath(ent.x, ent.y, nextC.standX, nextC.standY)
              }
            }
          }
        }

        if (vx !== 0 || vy !== 0) {
          const nx = ent.x + vx * dt
          const ny = ent.y + vy * dt

          // Movimiento libre entre cuadrantes (visitantes pueden caminar por toda la estación)
          if (isPointInsideWalkableGeometry(nx, ent.y)) {
            ent.x = nx
          }
          if (isPointInsideWalkableGeometry(ent.x, ny)) {
            ent.y = ny
          }

          if (Math.abs(vx) >= Math.abs(vy)) {
            ent.dir = vx < 0 ? 'left' : 'right'
          } else {
            ent.dir = vy < 0 ? 'up' : 'down'
          }
          ent.isMoving = true
          ent.walkFrame += dt * 11
        } else {
          ent.isMoving = false
          ent.walkFrame = 0
        }
      }

      // Actualizar sala actual y cuadrante actual del jugador activo
      const activeEnt = astronautsRef.current[st.activeRole]
      const curRm = findRoomAtPoint(activeEnt.x, activeEnt.y)
      if (curRm) {
        setCurrentRoomLabel((prev) => (prev !== curRm.label ? curRm.label : prev))
      }
      const detectedQuad = findQuadrantAtPoint(activeEnt.x, activeEnt.y)
      if (detectedQuad !== st.playerCurrentQuadrant) {
        setPlayerCurrentQuadrant(detectedQuad)
      }
      if (st.visitingQuadrant && detectedQuad === st.visitingQuadrant && activeEnt.isMoving) {
        setVisitingQuadrant(null)
      }

      // Actualizar consola cercana (propia o ajena) para mostrar [ PRESIONA 'E' ] o [ 🔒 SOLO LECTURA ]
      let bestId: string | null = null
      let bestDist = Infinity
      for (const c of CONSOLES) {
        const d = Math.hypot(c.standX - activeEnt.x, c.standY - activeEnt.y)
        if (d < bestDist) {
          bestDist = d
          bestId = c.id
        }
      }
      const nearId = bestDist < 92 ? bestId : null
      if (nearId !== st.nearestConsoleId) {
        setNearestConsoleId(nearId)
      }

      for (const door of SLIDING_DOORS) {
        let minDist = Infinity
        for (const r of ROLE_ORDER) {
          const a = astronautsRef.current[r]
          const d = Math.hypot(a.x - door.x, a.y - door.y)
          if (d < minDist) minDist = d
        }
        const targetOpen = minDist < 105 ? 1 : 0
        const cur = doorOpenRef.current[door.id] ?? 0
        doorOpenRef.current[door.id] = cur + (targetOpen - cur) * Math.min(1, dt * 8)
      }

      // Cámara encuadrada a la resolución Pixel-Art HD panorámica (~clientWidth / 2.2)
      const vpEl = viewportRef.current
      if (vpEl && vpEl.clientWidth > 0 && vpEl.clientHeight > 0) {
        const nextW = Math.max(MIN_PIXEL_W, Math.round(vpEl.clientWidth / PIXEL_DOWNSCALE))
        const nextH = Math.max(MIN_PIXEL_H, Math.round(vpEl.clientHeight / PIXEL_DOWNSCALE))
        if (nextW !== canvasSizeRef.current.w || nextH !== canvasSizeRef.current.h) {
          canvasSizeRef.current = { w: nextW, h: nextH }
        }
      }
      const cw = canvasSizeRef.current.w
      const ch = canvasSizeRef.current.h
      let targetZoom: number
      let targetCamX: number
      let targetCamY: number

      if (st.overviewMode) {
        targetZoom = Math.min(cw / (WORLD_W * 1.12), ch / (WORLD_H * 1.12))
        targetCamX = WORLD_W / 2
        targetCamY = WORLD_H / 2
      } else if (st.visitingQuadrant) {
        const qFocus = QUADRANT_DEFS[st.visitingQuadrant].cameraFocus
        targetZoom = clamp(Math.min(cw / 960, ch / 560, qFocus.zoom), 0.52, 0.88)
        targetCamX = qFocus.x
        targetCamY = qFocus.y
      } else if (curRm) {
        const padX = curRm.id === 'engine_room' ? 110 : 64
        const padY = curRm.id === 'communications' ? 88 : 60
        targetZoom = clamp(
          Math.min(cw / (curRm.hull.w + padX), ch / (curRm.hull.h + padY)),
          0.55,
          0.98
        )
        targetCamX = curRm.hull.x + curRm.hull.w / 2 + (curRm.id === 'engine_room' ? -22 : 0)
        targetCamY = curRm.hull.y + curRm.hull.h / 2 + (curRm.id === 'communications' ? -8 : 0)
      } else {
        targetZoom = 0.84
        targetCamX = activeEnt.x
        targetCamY = activeEnt.y
      }

      camRef.current.x += (targetCamX - camRef.current.x) * Math.min(1, dt * 6.5)
      camRef.current.y += (targetCamY - camRef.current.y) * Math.min(1, dt * 6.5)
      camRef.current.zoom += (targetZoom - camRef.current.zoom) * Math.min(1, dt * 6.5)

      // Renderizar escena en el Canvas Pixel-Art HD a pantalla completa
      const canvas = canvasRef.current
      if (canvas) {
        if (canvas.width !== cw) canvas.width = cw
        if (canvas.height !== ch) canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.imageSmoothingEnabled = false
          ctx.clearRect(0, 0, cw, ch)

          ctx.save()
          ctx.translate(Math.round(cw / 2), Math.round(ch / 2))
          ctx.scale(camRef.current.zoom, camRef.current.zoom)
          ctx.translate(-camRef.current.x, -camRef.current.y)

          drawSpaceStationWorld(ctx, time, {
            battery: st.battery,
            lifeSupport: st.lifeSupport,
            dataBuffer: st.dataBuffer,
            orbitStability: st.orbitStability,
            hull: st.hull,
            signalQuality: st.signalQuality,
            activeEvent: st.activeEvent,
            activeRole: st.activeRole,
            overviewMode: st.overviewMode,
            nearestConsoleId: st.nearestConsoleId,
            hoveredConsoleId: st.hoveredConsoleId,
            activeTaskConsoleIds: st.activeTaskConsoleIds,
            doorOpenMap: doorOpenRef.current,
          })

          if (activeEnt.waypoints.length > 0) {
            const dest = activeEnt.waypoints[activeEnt.waypoints.length - 1]
            ctx.strokeStyle = ROLE_INFO[st.activeRole].color
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(dest.x, dest.y + 10, 12 + Math.sin(time * 8) * 2, 0, Math.PI * 2)
            ctx.stroke()
          }

          // Renderizar SIEMPRE los 4 especialistas físicos en sus sectores (sin duplicados ni niebla opaca)
          const sortedRoles = [...ROLE_ORDER].sort(
            (a, b) => astronautsRef.current[a].y - astronautsRef.current[b].y
          )
          const visibleRoles: { role: RoleId; x: number; y: number }[] = []
          for (const r of sortedRoles) {
            const a = astronautsRef.current[r]
            visibleRoles.push({ role: r, x: a.x, y: a.y })

            const info = ROLE_INFO[r]
            const isMe = r === st.activeRole

            ctx.save()
            ctx.strokeStyle = info.color
            ctx.lineWidth = isMe ? 3 : 1.5
            ctx.globalAlpha = isMe ? 0.95 : 0.45
            ctx.beginPath()
            ctx.ellipse(a.x, a.y + 18, isMe ? 20 : 16, isMe ? 8 : 6, 0, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()

            drawAnimatedAstronaut(
              ctx,
              r,
              a.x,
              a.y,
              a.dir,
              a.walkFrame,
              a.isInteracting,
              time
            )
          }

          ctx.restore()

          // ================================================================
          // CAPA SCREEN-SPACE PIXEL-ART HD (TEXTOS NÍTIDOS CON BORDE 1px-2px)
          // ================================================================
          const drawOutlinedPixelText = (
            text: string,
            tx: number,
            ty: number,
            fill: string,
            font: string,
            align: CanvasTextAlign = 'center',
            outlinePx = 1
          ) => {
            ctx.font = font
            ctx.textAlign = align
            const px = Math.round(tx)
            const py = Math.round(ty)
            ctx.fillStyle = '#000000'
            for (let ox = -outlinePx; ox <= outlinePx; ox++) {
              for (let oy = -outlinePx; oy <= outlinePx; oy++) {
                if (ox === 0 && oy === 0) continue
                ctx.fillText(text, px + ox, py + oy)
              }
            }
            ctx.fillText(text, px, py + outlinePx + 1)
            ctx.fillStyle = fill
            ctx.fillText(text, px, py)
          }

          // Etiquetas nítidas de los 4 personajes (CÓNDOR, ALPACA, PUMA, SERPIENTE) en 'Press Start 2P'
          const charNameFont =
            cw >= 540
              ? 'bold 8px "Press Start 2P", monospace'
              : 'bold 7px "Press Start 2P", monospace'
          for (const vr of visibleRoles) {
            const info = ROLE_INFO[vr.role]
            const isMe = vr.role === st.activeRole
            const rawX = (vr.x - camRef.current.x) * camRef.current.zoom + cw / 2
            const rawY = (vr.y - 46 - camRef.current.y) * camRef.current.zoom + ch / 2
            if (rawX < -40 || rawX > cw + 40 || rawY < -30 || rawY > ch + 30) continue
            const sx = clamp(Math.round(rawX), 42, cw - 42)
            const sy = clamp(Math.round(rawY), 34, ch - 30)
            ctx.font = charNameFont
            const tw = Math.ceil(ctx.measureText(info.animalName).width + 12)
            const bx = Math.round(sx - tw / 2)
            ctx.fillStyle = isMe ? 'rgba(9, 14, 28, 0.90)' : 'rgba(6, 10, 22, 0.78)'
            ctx.fillRect(bx, sy - 11, tw, 13)
            ctx.strokeStyle = isMe ? info.color : 'rgba(71, 85, 105, 0.85)'
            ctx.lineWidth = 1
            ctx.strokeRect(bx + 0.5, sy - 10.5, tw - 1, 12)
            drawOutlinedPixelText(info.animalName, sx, sy - 1, info.color, charNameFont, 'center', 1)
          }

          // Textos flotantes de eventos/acciones en 'Press Start 2P'
          const floatFont =
            cw >= 540
              ? 'bold 8px "Press Start 2P", monospace'
              : 'bold 7px "Press Start 2P", monospace'
          floatingTextsRef.current = floatingTextsRef.current.filter((ft) => time - ft.bornAt < 2.3)
          for (const ft of floatingTextsRef.current) {
            const age = time - ft.bornAt
            const wy = ft.y - age * 28
            const rawSx = (ft.x - camRef.current.x) * camRef.current.zoom + cw / 2
            const rawSy = (wy - camRef.current.y) * camRef.current.zoom + ch / 2
            ctx.font = floatFont
            const w = Math.min(cw - 24, Math.ceil(ctx.measureText(ft.text).width + 14))
            const sx = clamp(Math.round(rawSx), Math.ceil(w / 2) + 8, cw - Math.ceil(w / 2) - 8)
            const sy = clamp(Math.round(rawSy), 38, ch - 34)
            const fx = Math.round(sx - w / 2)
            ctx.fillStyle = 'rgba(5, 8, 20, 0.94)'
            ctx.fillRect(fx, sy - 12, w, 15)
            ctx.strokeStyle = ft.color
            ctx.lineWidth = 1
            ctx.strokeRect(fx + 0.5, sy - 11.5, w - 1, 14)
            drawOutlinedPixelText(ft.text, sx, sy - 1, ft.color, floatFont, 'center', 1)
          }

          // Cartel de bloqueo rojo/ámbar sobre la consola ajena cuando intentas operar o inspeccionarla
          const activeDenied =
            deniedConsoleRef.current && deniedConsoleRef.current.until > time
              ? CONSOLES.find((c) => c.id === deniedConsoleRef.current?.consoleId) ?? null
              : null
          const activeForeignPid = st.nearestConsoleId ?? st.hoveredConsoleId
          const activeForeignConsole = activeForeignPid
            ? CONSOLES.find((c) => c.id === activeForeignPid && !canUseConsole(c, st.activeRole)) ?? null
            : null
          const lockBannerConsole = activeDenied ?? activeForeignConsole
          if (lockBannerConsole && !canUseConsole(lockBannerConsole, st.activeRole)) {
            const ownerInfoLock = ROLE_INFO[lockBannerConsole.role]
            const lockLabel = `🔒 SOLO ${ownerInfoLock.animalName} PUEDE RESOLVER ESTE SISTEMA`
            const rawCx = (lockBannerConsole.x - camRef.current.x) * camRef.current.zoom + cw / 2
            const rawCy = (lockBannerConsole.y - 44 - camRef.current.y) * camRef.current.zoom + ch / 2
            const lockFont = cw >= 580 ? 'bold 7px "Press Start 2P", monospace' : 'bold 6px "Press Start 2P", monospace'
            ctx.font = lockFont
            const bw = Math.min(cw - 24, Math.ceil(ctx.measureText(lockLabel).width + 16))
            const bx = clamp(Math.round(rawCx - bw / 2), 10, cw - bw - 10)
            const by = clamp(Math.round(rawCy - 16), 34, ch - 46)
            ctx.fillStyle = 'rgba(42, 8, 12, 0.96)'
            ctx.fillRect(bx, by, bw, 18)
            ctx.strokeStyle = '#ef4444'
            ctx.lineWidth = 1.5
            ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 17)
            ctx.strokeStyle = '#f59e0b'
            ctx.lineWidth = 1
            ctx.strokeRect(bx + 2.5, by + 2.5, bw - 5, 13)
            drawOutlinedPixelText(lockLabel, bx + bw / 2, by + 12, '#fde68a', lockFont, 'center', 1)
          }

          // Mini insignia RPG arriba a la izquierda nítida (38x26 px)
          ctx.save()
          const hudX = 6
          const hudY = 6
          ctx.fillStyle = 'rgba(10, 15, 32, 0.92)'
          ctx.fillRect(hudX, hudY, 38, 26)
          ctx.strokeStyle = ROLE_INFO[st.activeRole].color
          ctx.lineWidth = 1
          ctx.strokeRect(hudX + 0.5, hudY + 0.5, 37, 25)
          drawPixelFaceIcon(ctx, st.activeRole, hudX + 3, hudY + 3, 20, time)
          const redPct = clamp((st.lifeSupport + st.hull) / 200, 0, 1)
          const bluePct = clamp(st.battery / 100, 0, 1)
          ctx.fillStyle = '#090d1a'
          ctx.fillRect(hudX + 26, hudY + 3, 4, 20)
          const redH = Math.round(20 * redPct)
          ctx.fillStyle = '#dc2626'
          ctx.fillRect(hudX + 26, hudY + 23 - redH, 4, redH)
          ctx.fillStyle = '#090d1a'
          ctx.fillRect(hudX + 31, hudY + 3, 4, 20)
          const blueH = Math.round(20 * bluePct)
          ctx.fillStyle = '#38bdf8'
          ctx.fillRect(hudX + 31, hudY + 23 - blueH, 4, blueH)
          ctx.restore()

          // Arriba al centro: Nombre del segmento actual o modo visitante en 'Press Start 2P'
          const inspectingQuad = st.visitingQuadrant
          const effectiveOwner = inspectingQuad ?? st.playerCurrentQuadrant
          const isForeignView = effectiveOwner !== st.activeRole
          const roomBanner = st.overviewMode
            ? 'MAPA ESTACION'
            : inspectingQuad
            ? `OBS: ${QUADRANT_DEFS[inspectingQuad].roomsSummary}`
            : `${curRm?.label ?? 'PASILLO DE CONEXION'}${
                isForeignView ? ` · SOLO LECTURA (${ROLE_INFO[effectiveOwner].animalName})` : ''
              }`
          const titleFont =
            cw >= 580
              ? 'bold 10px "Press Start 2P", monospace'
              : cw >= 440
              ? 'bold 8px "Press Start 2P", monospace'
              : 'bold 7px "Press Start 2P", monospace'
          ctx.font = titleFont
          const titleW = Math.min(cw - 140, Math.ceil(ctx.measureText(roomBanner).width + 20))
          const titleBoxX = Math.round(cw / 2 - titleW / 2)
          ctx.fillStyle = isForeignView && !st.overviewMode ? 'rgba(42, 14, 18, 0.88)' : 'rgba(4, 7, 17, 0.78)'
          ctx.fillRect(titleBoxX, 5, titleW, 20)
          ctx.strokeStyle = isForeignView && !st.overviewMode ? '#f87171' : '#384252'
          ctx.lineWidth = 1
          ctx.strokeRect(titleBoxX + 0.5, 5.5, titleW - 1, 19)
          drawOutlinedPixelText(
            roomBanner,
            cw / 2,
            20,
            isForeignView && !st.overviewMode ? '#fca5a5' : '#fbbf24',
            titleFont,
            'center',
            2
          )

          // Abajo al centro: [ PRESIONA "E" VER CONSOLA ] con icono '!' amarillo encima, o bloqueo de rol
          const promptCid = st.nearestConsoleId ?? st.hoveredConsoleId
          const promptConsole = promptCid ? CONSOLES.find((c) => c.id === promptCid) ?? null : null
          if (promptConsole) {
            const canOperate = canUseConsole(promptConsole, st.activeRole)
            const promptText = canOperate
              ? '[ PRESIONA "E" VER CONSOLA ]'
              : `🔒 SOLO ${ROLE_INFO[promptConsole.role].animalName} PUEDE RESOLVER ESTE SISTEMA`
            let promptFont =
              cw >= 600
                ? 'bold 9px "Press Start 2P", monospace'
                : 'bold 8px "Press Start 2P", monospace'
            ctx.font = promptFont
            if (ctx.measureText(promptText).width > cw * 0.68) {
              promptFont = 'bold 7px "Press Start 2P", monospace'
              ctx.font = promptFont
            }
            const pw = Math.ceil(ctx.measureText(promptText).width + 18)
            const px = Math.round(cw / 2 - pw / 2)

            if (canOperate) {
              // Icono '!' amarillo pixel-art encima de la barra dorada activa
              const exY = Math.round(ch - 41 + Math.sin(time * 7.5) * 2)
              const exX = Math.round(cw / 2 - 7)
              ctx.fillStyle = '#000000'
              ctx.fillRect(exX - 1, exY - 1, 16, 16)
              ctx.fillStyle = '#f59e0b'
              ctx.fillRect(exX, exY, 14, 14)
              ctx.fillStyle = '#fde047'
              ctx.fillRect(exX + 2, exY + 2, 10, 10)
              ctx.fillStyle = '#000000'
              ctx.fillRect(exX + 6, exY + 3, 2, 5)
              ctx.fillRect(exX + 6, exY + 9, 2, 2)
            }

            ctx.fillStyle = canOperate ? 'rgba(4, 7, 17, 0.94)' : 'rgba(42, 8, 12, 0.96)'
            ctx.fillRect(px, ch - 25, pw, 19)
            ctx.strokeStyle = canOperate ? '#fbbf24' : '#f59e0b'
            ctx.lineWidth = 1.5
            ctx.strokeRect(px + 0.5, ch - 24.5, pw - 1, 18)
            drawOutlinedPixelText(
              promptText,
              cw / 2,
              ch - 11,
              canOperate ? '#fde047' : '#fca5a5',
              promptFont,
              'center',
              2
            )
          }
        }
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [])

  const screenToWorld = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { wx: 0, wy: 0 }
    const rect = canvas.getBoundingClientRect()
    const cw = canvas.width || canvasSizeRef.current.w
    const ch = canvas.height || canvasSizeRef.current.h
    const sx = ((e.clientX - rect.left) / (rect.width || 1)) * cw
    const sy = ((e.clientY - rect.top) / (rect.height || 1)) * ch
    const wx = (sx - cw / 2) / camRef.current.zoom + camRef.current.x
    const wy = (sy - ch / 2) / camRef.current.zoom + camRef.current.y
    return { wx, wy }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { wx, wy } = screenToWorld(e)
    let found: string | null = null
    for (const c of CONSOLES) {
      if (Math.hypot(wx - c.x, wy - c.y) < 42 || Math.hypot(wx - c.standX, wy - c.standY) < 36) {
        found = c.id
        break
      }
    }
    if (found !== hoveredConsoleId) {
      setHoveredConsoleId(found)
    }
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { wx, wy } = screenToWorld(e)

    // Detectar clic sobre cualquier consola: si es ajena, bloquear en modo SOLO LECTURA
    for (const c of CONSOLES) {
      if (Math.hypot(wx - c.x, wy - c.y) < 48 || Math.hypot(wx - c.standX, wy - c.standY) < 42) {
        if (!canUseConsole(c, activeRole)) {
          triggerReadOnlyAlert(c, c.x, c.y - 24)
          return
        }
        openOrWalkToConsole(c)
        return
      }
    }

    // Visitantes pueden caminar libremente por cualquier sala/pasillo de los 4 cuadrantes para observar
    if (isPointInsideWalkableGeometry(wx, wy)) {
      const me = astronautsRef.current[activeRole]
      me.waypoints = buildWaypointPath(me.x, me.y, wx, wy)
      playClick()
    }
  }

  const finalScore = useMemo(() => {
    const healthAvg = (battery + lifeSupport + orbitStability + hull) / 4
    return Math.round(
      officialScience * 10 +
        healthAvg * 6 +
        Math.max(0, baseTel.budget - baseTel.cost) * 0.5 +
        (baseTel.allOk ? 400 : 150)
    )
  }, [battery, lifeSupport, orbitStability, hull, officialScience, baseTel.budget, baseTel.cost, baseTel.allOk])

  const medal = useMemo(() => {
    if (finalScore >= 1400 && hull >= 70 && lifeSupport >= 60) {
      return {
        tier: 'MEDALLA DE ORO NASA',
        icon: '🥇',
        color: '#ffd23f',
        desc: 'Excelencia Orbital Andina: Telemetría, Ciencia y Supervivencia Perfectas.',
      }
    }
    if (finalScore >= 950) {
      return {
        tier: 'MEDALLA DE PLATA NASA',
        icon: '🥈',
        color: '#e2e8f0',
        desc: 'Misión Exitosa: Objetivos científicos cumplidos con anomalías controladas.',
      }
    }
    return {
      tier: 'MEDALLA DE BRONCE NASA',
      icon: '🥉',
      color: '#f97316',
      desc: 'Misión Operativa: El CubeSat sobrevivió a la órbita con datos parciales.',
    }
  }, [finalScore, hull, lifeSupport])

  const lastLog = logs[logs.length - 1]
  const openConsoleTask = useMemo(
    () => (openConsole ? activeTasks.find((t) => t.consoleId === openConsole.id) ?? null : null),
    [activeTasks, openConsole]
  )

  const pendingBacklog = useMemo(() => {
    const activeSet = new Set(activeTasks.map((t) => t.consoleId))
    const doneSet = new Set(completedMissionIds)
    return MISSION_BACKLOG.filter(
      (m) => !doneSet.has(m.id) && !m.consoleIds.some((cid) => activeSet.has(cid))
    )
  }, [activeTasks, completedMissionIds])

  const completedBacklog = useMemo(() => {
    const doneSet = new Set(completedMissionIds)
    return MISSION_BACKLOG.filter((m) => doneSet.has(m.id))
  }, [completedMissionIds])

  return (
    <div
      className="relative w-full h-full flex flex-col font-pixel text-white overflow-hidden select-none"
      style={{ background: '#050711' }}
    >
      {/* =====================================================================
          HEADER SUPERIOR COMPACTO (SIN BARRAS HORIZONTALES ANCHAS DE MISIONES)
         ===================================================================== */}
      <header
        className="flex flex-wrap items-center justify-between gap-1.5 px-2 py-1 shrink-0 border-b-4 border-black z-30"
        style={{ background: '#10142a', boxShadow: '0 2px 0 #2e3866' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              onBackToWorkshop()
            }}
            className="mc-btn px-2 py-1 text-[9px] shrink-0"
          >
            🛠️ TALLER
          </button>
          <div className="min-w-0">
            <div className="text-[10px] sm:text-[11px] text-cyan-300 truncate">
              🛰️ ESTACIÓN · {contract.name.toUpperCase()}
            </div>
            <div className="text-[8px] text-gray-300 truncate">
              SALA: <strong style={{ color: activeRoleInfo.color }}>{currentRoomLabel}</strong> ·{' '}
              <span className="text-yellow-300">WASD · &quot;E&quot; CONSOLAS</span>
            </div>
          </div>
        </div>

        {/* Telemetría vital ultra-compacta en píldoras (cero barras anchas) */}
        <div className="hidden lg:flex items-center gap-1.5 text-[8px] shrink-0">
          <span
            className={`px-1.5 py-0.5 border ${
              battery < 60 ? 'border-amber-400 bg-[#2b1d0e] text-amber-200' : 'border-black bg-[#090c1a] text-yellow-300'
            }`}
          >
            ⚡{Math.round(battery)}%
          </span>
          <span
            className={`px-1.5 py-0.5 border ${
              isLowO2 ? 'border-amber-400 bg-[#2b1d0e] text-amber-200 animate-pulse' : 'border-black bg-[#090c1a] text-cyan-300'
            }`}
          >
            🫧{Math.round(lifeSupport)}%
          </span>
          <span
            className={`px-1.5 py-0.5 border ${
              dataBuffer >= 50 ? 'border-emerald-400 bg-[#0d2e24] text-emerald-200' : 'border-black bg-[#090c1a] text-emerald-300'
            }`}
          >
            💾{Math.round(dataBuffer)}%
          </span>
          <span
            className={`px-1.5 py-0.5 border ${
              isOrbitDrift ? 'border-amber-400 bg-[#2b1d0e] text-amber-200 animate-pulse' : 'border-black bg-[#090c1a] text-purple-300'
            }`}
          >
            🧭{Math.round(orbitStability)}%
          </span>
          <span className="px-1.5 py-0.5 border border-black bg-[#090c1a] text-blue-300">
            🛡️{Math.round(hull)}%·📡{Math.round(signalQuality)}%
          </span>
        </div>

        {/* Conmutador Rápido de Especialista (1-4) + Finalizar */}
        <div className="flex flex-wrap items-center gap-1 shrink-0">
          {ROLE_ORDER.map((r, i) => {
            const info = ROLE_INFO[r]
            const on = activeRole === r
            const hasTaskForRole = activeTasks.some((t) => t.role === r)
            return (
              <button
                key={r}
                onMouseEnter={playHover}
                onClick={() => {
                  playClick()
                  setVisitingQuadrant(null)
                  setOpenConsoleId(null)
                  actions.setRole(r)
                }}
                className={`text-[8px] sm:text-[9px] px-1.5 py-1 flex items-center gap-1 whitespace-nowrap ${
                  hasTaskForRole && !on ? 'animate-pulse' : ''
                }`}
                style={{
                  background: on ? '#2a3f8f' : '#1b2038',
                  color: on ? info.color : '#cbd5e1',
                  border: `2px solid ${hasTaskForRole ? '#fde047' : on ? '#fff' : '#000'}`,
                }}
              >
                <span>{info.icon}</span>
                <span>
                  [{i + 1}: {info.animalName}]
                </span>
                {hasTaskForRole && (
                  <span className="px-1 bg-yellow-400 text-black text-[7px] font-bold">!</span>
                )}
              </button>
            )
          })}
          <button
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              setMissionCompleted(true)
              playIntroSweep()
            }}
            className="mc-btn px-2 py-1 text-[8px] sm:text-[9px]"
            style={{ background: '#15803d', color: '#7bff9a', borderColor: '#7bff9a' }}
          >
            🏆 FINALIZAR
          </button>
        </div>
      </header>

      {/* =====================================================================
          LIENZO PIXEL-ART FULLSCREEN + MINIMAPA 4 CUADRANTES + PANEL VERTICAL DERECHO
         ===================================================================== */}
      <div className="flex-1 min-h-0 w-full overflow-hidden flex">
        <div
          ref={viewportRef}
          className="relative w-full h-full bg-[#04060e] overflow-hidden"
        >
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setHoveredConsoleId(null)}
            className="w-full h-full block cursor-crosshair"
            style={{ imageRendering: 'pixelated' }}
          />

          {/* ALERTA DE BLOQUEO DE SOLO LECTURA AL INTENTAR OPERAR TERMINAL AJENA */}
          {visitorAlert && (
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40 max-w-xl w-[92%] sm:w-auto px-3.5 py-2 border-2 border-red-400 bg-[#2a090d]/95 shadow-2xl text-center">
              <div className="text-[9px] sm:text-[10px] text-red-200 font-bold leading-snug">
                {visitorAlert.msg}
              </div>
              <div className="text-[8px] text-amber-300 mt-1">
                PROPIETARIO EXCLUSIVO: {ROLE_INFO[visitorAlert.owner].icon}{' '}
                {ROLE_INFO[visitorAlert.owner].code} · USA TECLA [1-4] SI DESEAS CONTROLARLO
              </div>
            </div>
          )}

          {/* PÍLDORA DE MODO VISITANTE / OBSERVACIÓN DE CUADRANTE AJENO */}
          {!visitorAlert &&
            (visitingQuadrant && visitingQuadrant !== activeRole ||
              playerCurrentQuadrant !== activeRole) && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 z-20 px-2.5 py-1 bg-[#0b1328]/90 border border-cyan-400/70 flex flex-wrap items-center gap-2 text-[8px]">
                <span className="text-cyan-200">
                  👁️ MODO VISITANTE (SOLO LECTURA) · SECTOR DE{' '}
                  <strong style={{ color: ROLE_INFO[visitingQuadrant ?? playerCurrentQuadrant].color }}>
                    {ROLE_INFO[visitingQuadrant ?? playerCurrentQuadrant].icon}{' '}
                    {ROLE_INFO[visitingQuadrant ?? playerCurrentQuadrant].code}
                  </strong>
                </span>
                {visitingQuadrant && visitingQuadrant !== playerCurrentQuadrant && (
                  <button
                    onClick={() => {
                      playClick()
                      const target = QUADRANT_DEFS[visitingQuadrant].entryPoint
                      const me = astronautsRef.current[activeRole]
                      me.waypoints = buildWaypointPath(me.x, me.y, target.x, target.y)
                    }}
                    className="px-1.5 py-0.5 bg-cyan-900/90 border border-cyan-400 text-cyan-100 hover:bg-cyan-700"
                  >
                    🚶 CAMINAR AQUÍ
                  </button>
                )}
                {visitingQuadrant && (
                  <button
                    onClick={() => {
                      playClick()
                      setVisitingQuadrant(null)
                    }}
                    className="px-1.5 py-0.5 bg-amber-900/90 border border-amber-400 text-amber-100 hover:bg-amber-700"
                  >
                    🎯 MI PERSONAJE
                  </button>
                )}
              </div>
            )}

          {/* Botones flotantes superiores (alineados a la izquierda del panel vertical derecho) */}
          <div
            className={`absolute top-2 z-20 flex flex-wrap justify-end gap-1.5 transition-all ${
              missionPanelOpen ? 'right-[240px]' : 'right-14'
            }`}
          >
            <button
              onClick={() => {
                playClick()
                setVisitingQuadrant(null)
                setOverviewMode(false)
                const me = astronautsRef.current[activeRole]
                me.waypoints = buildWaypointPath(
                  me.x,
                  me.y,
                  ROOM_BY_ID.ground_segment.navX,
                  ROOM_BY_ID.ground_segment.navY
                )
              }}
              className="mc-btn px-2 py-1 text-[8px]"
              style={{ background: '#1e293b', color: '#fde047' }}
            >
              🚶 GROUND SEG
            </button>
            <button
              onClick={() => {
                playClick()
                setVisitingQuadrant(null)
                setOverviewMode((v) => !v)
              }}
              className="mc-btn px-2 py-1 text-[8px]"
              style={{
                background: overviewMode ? '#14532d' : '#1e293b',
                color: overviewMode ? '#86efac' : '#67e8f9',
              }}
            >
              {overviewMode ? '🔍 SEGUIR JUGADOR' : '👁️ MAPA GLOBAL'}
            </button>
          </div>

          {/* =================================================================
              MINIMAPA INTERACTIVO DE LOS 4 CUADRANTES (ESQUINA INFERIOR IZQUIERDA)
             ================================================================= */}
          <div
            className="mc-panel absolute bottom-2 left-2 z-20 p-1.5 w-72 border-2 border-cyan-500/50"
            style={{ background: 'rgba(8, 12, 26, 0.90)', backdropFilter: 'blur(4px)' }}
          >
            <div className="flex items-center justify-between text-[7px] text-cyan-300 mb-1">
              <span>🗺️ 4 CUADRANTES · CLIC PARA VISITAR</span>
              <button
                onClick={() => {
                  playClick()
                  setOverviewMode(false)
                  setVisitingQuadrant(null)
                }}
                className="px-1 py-0.5 bg-slate-800 border border-slate-600 text-yellow-300 hover:bg-slate-700"
              >
                🎯 YO
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1 bg-[#050814] p-1 border border-black">
              {MINIMAP_SPATIAL_ORDER.map((qid) => {
                const q = QUADRANT_DEFS[qid]
                const ownerInfo = ROLE_INFO[qid]
                const hasIssue = activeTasks.some((t) => t.role === qid)
                const isPlayerHere = playerCurrentQuadrant === qid
                const isObserving = visitingQuadrant === qid
                const isOwnerMe = activeRole === qid
                return (
                  <button
                    key={qid}
                    onClick={() => {
                      playClick()
                      setOverviewMode(false)
                      if (qid === activeRole && playerCurrentQuadrant === activeRole) {
                        setVisitingQuadrant(null)
                      } else {
                        setVisitingQuadrant((prev) => (prev === qid ? null : qid))
                      }
                    }}
                    className={`relative p-1 text-left border transition-colors ${
                      hasIssue ? 'border-amber-400' : isObserving ? 'border-cyan-400' : isPlayerHere ? 'border-white' : 'border-slate-800'
                    }`}
                    style={{
                      background: isObserving
                        ? 'rgba(14, 116, 144, 0.28)'
                        : isPlayerHere
                        ? 'rgba(30, 41, 59, 0.9)'
                        : 'rgba(12, 18, 36, 0.85)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-1 text-[7px] leading-none mb-0.5">
                      <span className="truncate font-bold" style={{ color: ownerInfo.color }}>
                        {ownerInfo.icon} S{q.sectorNum} {isOwnerMe ? '·TÚ' : ''}
                      </span>
                      {hasIssue ? (
                        <span className="px-1 bg-red-600 text-yellow-200 font-bold animate-pulse">
                          !
                        </span>
                      ) : (
                        <span className="text-emerald-400 font-bold">●</span>
                      )}
                    </div>

                    {/* Esquema SVG del cuadrante */}
                    <svg viewBox="0 0 100 64" className="w-full h-8 bg-[#040711] border border-slate-900">
                      {q.miniRooms.map((mr, idx) => (
                        <rect
                          key={idx}
                          x={mr.x}
                          y={mr.y}
                          width={mr.w}
                          height={mr.h}
                          rx={2}
                          fill={mr.accent ? `${ownerInfo.color}33` : '#1e293b'}
                          stroke={ownerInfo.color}
                          strokeWidth={mr.accent ? 2 : 1.2}
                        />
                      ))}
                      {/* Marcador del dueño en el cuadrante */}
                      <circle cx={78} cy={14} r={4} fill={ownerInfo.color} />
                      {/* Marcador pulsante si el jugador activo está aquí */}
                      {isPlayerHere && (
                        <>
                          <circle
                            cx={30}
                            cy={32}
                            r={9}
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth={2}
                          />
                          <circle cx={30} cy={32} r={4.5} fill="#fde047" />
                        </>
                      )}
                    </svg>

                    <div className="flex items-center justify-between text-[6px] text-gray-300 mt-0.5 truncate">
                      <span className="truncate">{q.roomsSummary}</span>
                      {isPlayerHere && <span className="text-yellow-300 shrink-0">📍</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* =================================================================
              PANEL VERTICAL COMPACTO Y SEMITRANSPARENTE DE MISIONES (BORDE DERECHO)
             ================================================================= */}
          <div className="absolute top-2 right-2 bottom-2 z-20 flex flex-col items-end pointer-events-none">
            <button
              onClick={() => {
                playClick()
                setMissionPanelOpen((o) => !o)
              }}
              className="pointer-events-auto mb-1 px-2 py-1 text-[8px] border border-cyan-500/60 bg-[#080d1e]/90 text-cyan-200 hover:bg-[#101a38]"
            >
              {missionPanelOpen
                ? `📋 MISIONES (${Math.round(missionProgress)}%) ▾`
                : `📋 ${Math.round(missionProgress)}%`}
            </button>

            {missionPanelOpen && (
              <aside
                className="pointer-events-auto w-56 max-h-full overflow-y-auto p-2 border-2 border-cyan-500/40 flex flex-col gap-2 shadow-xl"
                style={{
                  background: 'rgba(8, 12, 26, 0.84)',
                  backdropFilter: 'blur(5px)',
                }}
              >
                {/* Progreso y ciencia compactos dentro del panel */}
                <div className="p-1.5 bg-[#050814]/80 border border-slate-800">
                  <div className="flex items-center justify-between text-[8px]">
                    <span className="text-yellow-300">⏱️ AVANCE {Math.round(missionProgress)}%</span>
                    <span className="text-emerald-300">🔬 {officialScience}</span>
                  </div>
                  <div className="w-full h-1.5 bg-black mt-1">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${missionProgress}%`,
                        background: 'linear-gradient(90deg, #22c55e, #5ef0ff)',
                      }}
                    />
                  </div>
                </div>

                {/* 🔴 / 🟡 MISIONES ACTIVAS / URGENTES */}
                <div>
                  <div className="text-[7px] text-red-300 font-bold mb-1 tracking-wide">
                    🔴 ACTIVAS / URGENTES ({activeTasks.length})
                  </div>
                  <div className="flex flex-col gap-1">
                    {activeTasks.map((t, idx) => {
                      const tOwner = ROLE_INFO[t.role]
                      const isUrgent = t.kind === 'problem'
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            playClick()
                            if (t.role === activeRole) {
                              const c = CONSOLES.find((cc) => cc.id === t.consoleId)
                              if (c) openOrWalkToConsole(c)
                            } else {
                              setOverviewMode(false)
                              setVisitingQuadrant(t.role)
                            }
                          }}
                          className={`w-full text-left p-1.5 border text-[7px] leading-snug transition-colors ${
                            idx === 0
                              ? 'border-yellow-400 bg-amber-950/50'
                              : 'border-slate-700 bg-slate-900/60'
                          } hover:bg-slate-800/80`}
                        >
                          <div className="flex items-center justify-between gap-1 font-bold">
                            <span>
                              {isUrgent ? '🔴' : '🟡'} {tOwner.icon} {tOwner.animalName}
                            </span>
                            <span className="text-[6px] text-cyan-300">
                              {t.role === activeRole ? 'IR ▶' : 'VER 👁️'}
                            </span>
                          </div>
                          <div className="text-white mt-0.5">{t.title}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* ⏳ PENDIENTES POR CUADRANTE */}
                <div>
                  <div className="text-[7px] text-amber-200 font-bold mb-1">
                    ⏳ PENDIENTES ({pendingBacklog.length})
                  </div>
                  <div className="flex flex-col gap-1">
                    {pendingBacklog.slice(0, 5).map((m) => {
                      const mOwner = ROLE_INFO[m.role]
                      return (
                        <button
                          key={m.id}
                          onClick={() => {
                            playClick()
                            if (m.role === activeRole) {
                              const targetC = CONSOLES.find((cc) => cc.id === m.consoleIds[0])
                              if (targetC) openOrWalkToConsole(targetC)
                            } else {
                              setOverviewMode(false)
                              setVisitingQuadrant(m.role)
                            }
                          }}
                          className="w-full text-left px-1.5 py-1 border border-slate-800 bg-[#0b1022]/75 hover:border-cyan-500/50 text-[7px]"
                        >
                          <div className="flex items-center justify-between text-[6px]" style={{ color: mOwner.color }}>
                            <span>
                              ⏳ {mOwner.icon} {m.quadrantTag}
                            </span>
                            <span>{m.role === activeRole ? 'IR' : 'OBS'}</span>
                          </div>
                          <div className="text-gray-200 truncate mt-0.5">{m.title}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* ✅ COMPLETADAS */}
                {completedBacklog.length > 0 && (
                  <div>
                    <div className="text-[7px] text-emerald-300 font-bold mb-1">
                      ✅ COMPLETADAS ({completedBacklog.length})
                    </div>
                    <div className="flex flex-col gap-1">
                      {completedBacklog.map((m) => (
                        <div
                          key={m.id}
                          className="px-1.5 py-1 border border-emerald-900/70 bg-emerald-950/30 text-[7px] text-emerald-200 truncate"
                        >
                          ✅ {ROLE_INFO[m.role].icon} {m.title}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            )}
          </div>

          <div
            className={`hidden lg:block absolute bottom-2 z-10 px-2 py-1 bg-black/85 border border-gray-800 text-[8px] text-gray-300 transition-all ${
              missionPanelOpen ? 'right-[240px]' : 'right-2'
            }`}
          >
            🕹️ <strong className="text-yellow-300">WASD / Clic</strong> · Terminal:{' '}
            <strong className="text-cyan-300">[&quot;E&quot;]</strong>
          </div>
        </div>
      </div>

      {/* =====================================================================
          MINIJUEGOS DEL EQUIPO (MODAL GRANDE AL PRESIONAR "E" EN LA CONSOLA DEL ROL)
         ===================================================================== */}
      {activeMinigame === 'nav' && (
        <NavegacionOrbitalModal
          satTarget={navSatTarget}
          onClose={closeMinigame}
          onComplete={handleMinigameComplete}
        />
      )}
      {activeMinigame === 'eps' && (
        <DistribucionElectricaModal onClose={closeMinigame} onComplete={handleMinigameComplete} />
      )}
      {activeMinigame === 'eclss' && (
        <SoporteVitalModal onClose={closeMinigame} onComplete={handleMinigameComplete} />
      )}
      {activeMinigame === 'dock' && (
        <AcoplamientoEspacialModal onClose={closeMinigame} onComplete={handleMinigameComplete} />
      )}
      {activeMinigame === 'lander' && (
        <AterrizajePlanetarioModal onClose={closeMinigame} onComplete={handleMinigameComplete} />
      )}
      {activeMinigame === 'telecom' && (
        <ReparacionTelecomModal onClose={closeMinigame} onComplete={handleMinigameComplete} />
      )}
      {activeMinigame === 'comet' && (
        <ReencuentroCometaModal onClose={closeMinigame} onComplete={handleMinigameComplete} />
      )}
      {activeMinigame === 'cyber' && (
        <CiberdefensaSatelitalModal onClose={closeMinigame} onComplete={handleMinigameComplete} />
      )}

      {/* =====================================================================
          MODAL DE CONSOLA RETRO GRANDE Y CENTRADO AL PRESIONAR "E" (13px-16px)
         ===================================================================== */}
      <AnimatePresence>
        {openConsole && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpenConsoleId(null)}
          >
            <motion.div
              className="mc-panel w-full max-w-2xl p-5 sm:p-6 text-left border-4 border-cyan-400"
              style={{
                background: 'linear-gradient(180deg, #0c1428 0%, #070b18 100%)',
                boxShadow: '0 0 0 4px #000, 0 20px 50px rgba(0, 0, 0, 0.9)',
              }}
              initial={{ scale: 0.85, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Encabezado de la Terminal NASA */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b-4 border-black">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{openConsole.icon}</span>
                  <div>
                    <div className="text-[11px] text-cyan-300 tracking-wide">
                      TERMINAL NASA · {openConsole.zoneName}
                    </div>
                    <h2
                      className="text-[14px] sm:text-[16px] font-bold text-yellow-300 mt-0.5 leading-snug"
                      style={{ textShadow: '2px 2px 0 #000' }}
                    >
                      {openConsole.title}
                    </h2>
                  </div>
                </div>
                <span
                  className="px-2.5 py-1 text-[11px] font-bold border-2 border-black"
                  style={{
                    background: openConsoleTask ? '#f59e0b' : '#15803d',
                    color: openConsoleTask ? '#000' : '#fff',
                  }}
                >
                  {openConsoleTask ? '⚠️ REQUIERE ACCIÓN' : '✅ SUBSISTEMA OPERATIVO'}
                </span>
              </div>

              {/* Estado Actual del Subsistema */}
              <div className="p-3.5 mb-4 bg-[#101b38] border-2 border-black">
                <div className="flex items-center justify-between text-[12px] sm:text-[13px] text-cyan-200 mb-1.5">
                  <span>SUBSISTEMA: {openConsole.subsystemLabel}</span>
                  <span className="font-bold text-white">
                    OPERADOR: {ROLE_INFO[openConsole.role].icon} {ROLE_INFO[openConsole.role].code}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px] mt-2">
                  <div className="p-2 bg-[#080d1c] border border-slate-700">
                    <div className="text-yellow-300 text-[10px]">⚡ ENERGÍA</div>
                    <div className="text-[14px] font-bold text-white mt-0.5">{Math.round(battery)}%</div>
                  </div>
                  <div className="p-2 bg-[#080d1c] border border-slate-700">
                    <div className="text-cyan-300 text-[10px]">🫧 OXÍGENO O2</div>
                    <div className="text-[14px] font-bold text-white mt-0.5">{Math.round(lifeSupport)}%</div>
                  </div>
                  <div className="p-2 bg-[#080d1c] border border-slate-700">
                    <div className="text-emerald-300 text-[10px]">💾 BUFFER</div>
                    <div className="text-[14px] font-bold text-white mt-0.5">{Math.round(dataBuffer)}%</div>
                  </div>
                  <div className="p-2 bg-[#080d1c] border border-slate-700">
                    <div className="text-purple-300 text-[10px]">🧭 ÓRBITA</div>
                    <div className="text-[14px] font-bold text-white mt-0.5">{Math.round(orbitStability)}%</div>
                  </div>
                </div>
              </div>

              {/* Descripción en letra grande (13px-16px) de la Misión o Problema Activo */}
              <div
                className="p-4 mb-4 border-2"
                style={{
                  background: openConsoleTask ? '#261a07' : '#0b152b',
                  borderColor: openConsoleTask ? '#fde047' : '#38bdf8',
                }}
              >
                <div
                  className="text-[13px] sm:text-[15px] font-bold mb-2"
                  style={{ color: openConsoleTask ? '#fde047' : '#67e8f9' }}
                >
                  {openConsoleTask
                    ? `🎯 ${openConsoleTask.kind === 'problem' ? 'PROBLEMA ACTIVO' : 'MISIÓN ACTIVA'}: ${
                        openConsoleTask.title
                      }`
                    : `📋 DIAGNÓSTICO DE CONSOLA: ${openConsole.shortLabel}`}
                </div>
                <p className="text-[13px] sm:text-[14px] text-gray-100 leading-relaxed">
                  {openConsoleTask ? openConsoleTask.reason : openConsole.hint}
                </p>
                <div className="mt-3 pt-2.5 border-t border-slate-700 text-[12px] sm:text-[13px] text-emerald-300 leading-relaxed">
                  <strong>EFECTO DE OPERACIÓN:</strong> {openConsole.hint}
                </div>
              </div>

              {/* Último mensaje de la tripulación */}
              {lastLog && (
                <div className="p-3 mb-5 bg-[#060913] border-l-4 border-yellow-400 text-[12px] sm:text-[13px] text-gray-300 leading-relaxed">
                  <strong className="text-yellow-300">📻 BITÁCORA: </strong>
                  {lastLog.text}
                </div>
              )}

              {/* Botones Grandes de Acción */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
                <button
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    setOpenConsoleId(null)
                  }}
                  className="mc-btn px-4 py-3 text-[12px] sm:text-[13px]"
                  style={{ background: '#334155', color: '#e2e8f0' }}
                >
                  [ ESC / CERRAR ]
                </button>
                <button
                  onMouseEnter={playHover}
                  onClick={() => executeConsole(openConsole)}
                  className="mc-btn flex-1 px-5 py-3 text-[13px] sm:text-[15px] font-bold"
                  style={{
                    background: '#15803d',
                    color: '#fef08a',
                    borderColor: '#4ade80',
                  }}
                >
                  [ ⚡ EJECUTAR / SOLUCIONAR (ESPACIO / ENTER) ]
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          MODAL DE REPORTE FINAL DE LA NASA (MEDALLA ORO / PLATA / BRONCE)
         ===================================================================== */}
      <AnimatePresence>
        {missionCompleted && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="mc-panel w-full max-w-2xl p-5 text-center"
              initial={{ scale: 0.75, y: 20 }}
              animate={{ scale: 1, y: 0 }}
            >
              <div className="text-4xl mb-2">{medal.icon}</div>
              <div
                className="text-sm sm:text-base font-bold"
                style={{ color: medal.color, textShadow: '2px 2px 0 #000' }}
              >
                {medal.tier}
              </div>
              <div className="text-[10px] text-cyan-200 mt-1">{medal.desc}</div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-4 text-left">
                <div className="p-2 bg-[#10162b] border-2 border-black">
                  <div className="text-[9px] text-yellow-300">PUNTAJE TOTAL</div>
                  <div className="text-xs font-bold text-green-300 mt-1">
                    {finalScore} PTS
                  </div>
                </div>
                <div className="p-2 bg-[#10162b] border-2 border-black">
                  <div className="text-[9px] text-emerald-300">CIENCIA TRANSMITIDA</div>
                  <div className="text-xs font-bold text-white mt-1">
                    {officialScience} PTS
                  </div>
                </div>
                <div className="p-2 bg-[#10162b] border-2 border-black">
                  <div className="text-[9px] text-cyan-300">NAVE / COHETE</div>
                  <div className="text-[10px] font-bold text-white mt-1">
                    {chassis.name} · {launcher.name}
                  </div>
                </div>
                <div className="p-2 bg-[#10162b] border-2 border-black">
                  <div className="text-[9px] text-orange-300">PRESUPUESTO</div>
                  <div className="text-xs font-bold text-white mt-1">
                    ${baseTel.cost}k / ${baseTel.budget}k
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-2.5 mt-4">
                <button
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    setMissionCompleted(false)
                  }}
                  className="mc-btn px-3.5 py-2.5 text-[10px]"
                >
                  🛰️ SEGUIR EN ESTACIÓN
                </button>
                <button
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    onReplayCutscene()
                  }}
                  className="mc-btn px-3.5 py-2.5 text-[10px]"
                >
                  🎬 CINEMÁTICA
                </button>
                <button
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    onOpenTelemetryReport()
                  }}
                  className="mc-btn px-3.5 py-2.5 text-[10px]"
                  style={{ color: '#5ef0ff' }}
                >
                  📊 VER TELEMETRÍA DETALLADA
                </button>
                <button
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    onExitToMenu()
                  }}
                  className="mc-btn px-4 py-2.5 text-[10px]"
                  style={{ color: '#7bff9a' }}
                >
                  🏠 MENÚ PRINCIPAL
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
