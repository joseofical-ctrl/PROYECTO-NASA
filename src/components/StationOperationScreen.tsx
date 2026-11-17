import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CHASSIS, CONTRACTS, LAUNCHERS, ROLE_INFO, ROLE_ORDER } from '../game/catalog'
import type { RoleId } from '../game/catalog'
import { getNextMissionId, MISSION_CATALOG, sanitizeMissionId } from '../game/missions'
import type { MissionId } from '../game/missions'
import { paintAstronautPoseToAtlas } from '../game/astronautSprite'
import { analyze } from '../game/sim'
import { actions, useGame } from '../game/store'
import { playClick, playHover, playIntroSweep } from '../audio'
import GameOverExplosionModal from './GameOverExplosionModal'
import VictoryCinematicModal from './VictoryCinematicModal'
import type { VictoryPhase } from './VictoryCinematicModal'
import MinigameFrame, { MINIGAME_META } from './minigames/MinigameFrame'
import type { MinigameId } from './minigames/MinigameFrame'

import {
  getCachedRoomSnapshot,
  postRolesSyncWithRehydrate,
  postStationSyncWithRehydrate,
  saveCachedRoomSnapshot,
} from '../game/multiplayer'
import type { RoleClaimsMap as SharedRoleClaimsMap, RoomSnapshot } from '../game/multiplayer'

interface Props {
  onBackToWorkshop: () => void
  onReplayCutscene?: () => void
  onOpenTelemetryReport: () => void
  onExitToMenu: () => void
  onRoomClosed?: () => void
  onRoomUpdated?: (room: RoomSnapshot) => void
  onAdvanceMission?: (nextMissionId: MissionId, keepPoints?: number) => void
  missionId?: MissionId | string
  roomCode?: string | null
  clientIdOverride?: string
  initialAssignedRole?: RoleId | null
  initialPlayerName?: string
  initialRoleClaims?: SharedRoleClaimsMap
  initialSoloMode?: boolean
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

interface SectorThreshold {
  id: string
  owner: RoleId
  x: number
  y: number
  orientation: 'vertical' | 'horizontal'
  size: number
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
    subLabel: 'CENTRAL BRIDGE · HOLOGRAPHIC COMMAND & APAS SIMULATOR',
    owner: 'director',
    floorStyle: 'command',
    hull: { x: 896, y: 512, w: 576, h: 448 },
    floor: { x: 928, y: 576, w: 512, h: 352 },
    color: '#ffd23f',
    navX: 1104,
    navY: 692,
  },
  // b) LAUNCH SEGMENT (Cuadrante 1 · Hangar del Transbordador de CÓNDOR-4)
  {
    id: 'launch_segment',
    label: 'LAUNCH SEGMENT',
    subLabel: 'SHUTTLE BAY · HYDRAULIC MANIPULATOR ARM',
    owner: 'director',
    floorStyle: 'hangar',
    hull: { x: 192, y: 448, w: 576, h: 480 },
    floor: { x: 224, y: 512, w: 512, h: 384 },
    color: '#ffd23f',
    navX: 608,
    navY: 720,
  },
  // c) ENGINE ROOM (Cuadrante 1 · Turbina Sur-Oeste de CÓNDOR-4)
  {
    id: 'engine_room',
    label: 'ENGINE ROOM',
    subLabel: 'HEAVY PROPULSION TURBINE · DELTA-V MANEUVERS',
    owner: 'director',
    floorStyle: 'engine',
    hull: { x: 224, y: 1024, w: 512, h: 352 },
    floor: { x: 256, y: 1088, w: 448, h: 256 },
    color: '#ffd23f',
    navX: 548,
    navY: 1200,
  },
  // d) SPACE SEGMENT (Cuadrante 4 · Sector SERPIENTE-2)
  {
    id: 'space_segment',
    label: 'SPACE SEGMENT',
    subLabel: 'DSN SERVERS · OPTICAL TELESCOPE · DUAL CUBESAT ARRAY',
    owner: 'comms',
    floorStyle: 'comms',
    hull: { x: 224, y: 64, w: 544, h: 320 },
    floor: { x: 256, y: 128, w: 480, h: 224 },
    color: '#74b9ff',
    navX: 544,
    navY: 240,
  },
  // e) COMMUNICATIONS (Cuadrante 4 · Sector SERPIENTE-2)
  {
    id: 'communications',
    label: 'COMMUNICATIONS',
    subLabel: 'DSN DOME · SAT-01/SAT-02 MONITORS · QUANTUM ENCRYPTION',
    owner: 'comms',
    floorStyle: 'comms',
    hull: { x: 864, y: 64, w: 480, h: 320 },
    floor: { x: 896, y: 128, w: 416, h: 224 },
    color: '#74b9ff',
    navX: 1104,
    navY: 266,
  },
  // f) USER SEGMENT (Cuadrante 3 · Sector PUMA-3)
  {
    id: 'user_segment',
    label: 'USER SEGMENT',
    subLabel: 'MICROSCOPY LAB · BIO-INCUBATORS · GLACIAL CORE SAMPLES',
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
    subLabel: 'FUME HOOD · ANALYTICAL FLASKS · SCIENCE TELEMETRY BOARD',
    owner: 'science',
    floorStyle: 'lab',
    hull: { x: 1568, y: 448, w: 480, h: 288 },
    floor: { x: 1600, y: 512, w: 416, h: 192 },
    color: '#55efc4',
    navX: 1784,
    navY: 616,
  },
  // h) POWER MGD & REACTOR (Cuadrante 2 · Sector ALPACA-1)
  {
    id: 'power_reactor',
    label: 'POWER MGD & REACTOR',
    subLabel: 'FUSION CORE · OSCILLOSCOPES · THERMAL PANELS · CREW BUNK',
    owner: 'engineer',
    floorStyle: 'reactor',
    hull: { x: 1568, y: 768, w: 576, h: 384 },
    floor: { x: 1600, y: 832, w: 512, h: 288 },
    color: '#ff9f43',
    navX: 1836,
    navY: 1004,
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

// Marcos de transición abiertos entre sectores (paso físico 100% libre para los 4 personajes)
const SECTOR_THRESHOLDS: SectorThreshold[] = [
  {
    id: 'gate_director',
    owner: 'director',
    x: 832,
    y: 720,
    orientation: 'vertical',
    size: 96,
    roomLabel: 'LAUNCH SEGMENT & ENGINE ROOM',
  },
  {
    id: 'gate_comms',
    owner: 'comms',
    x: 1104,
    y: 464,
    orientation: 'horizontal',
    size: 96,
    roomLabel: 'COMMUNICATIONS & SPACE SEGMENT',
  },
  {
    id: 'gate_science',
    owner: 'science',
    x: 1520,
    y: 624,
    orientation: 'vertical',
    size: 96,
    roomLabel: 'LABORATORY & USER SEGMENT',
  },
  {
    id: 'gate_engineer_east',
    owner: 'engineer',
    x: 1520,
    y: 880,
    orientation: 'vertical',
    size: 96,
    roomLabel: 'POWER MGD & REACTOR',
  },
  {
    id: 'gate_engineer_south',
    owner: 'engineer',
    x: 1184,
    y: 1024,
    orientation: 'horizontal',
    size: 96,
    roomLabel: 'LIFE SUPPORT & ELECTRICAL',
  },
]

// Puertas automáticas en TODAS las conexiones entre pasillos y las 9 áreas (se abren al paso de cualquier personaje)
const SLIDING_DOORS: SlidingDoor[] = [
  { id: 'door_launch_west', x: 744, y: 720, orientation: 'vertical', size: 96 },
  { id: 'door_ground_west', x: 920, y: 720, orientation: 'vertical', size: 96 },
  { id: 'door_engine', x: 480, y: 992, orientation: 'horizontal', size: 96 },
  { id: 'door_ground_north', x: 1104, y: 564, orientation: 'horizontal', size: 96 },
  { id: 'door_comms_south', x: 1104, y: 364, orientation: 'horizontal', size: 96 },
  { id: 'door_space_comm', x: 816, y: 240, orientation: 'vertical', size: 96 },
  { id: 'door_ground_east_lab', x: 1448, y: 624, orientation: 'vertical', size: 96 },
  { id: 'door_lab_west', x: 1592, y: 624, orientation: 'vertical', size: 96 },
  { id: 'door_user_lab', x: 1792, y: 432, orientation: 'horizontal', size: 96 },
  { id: 'door_ground_east_pwr', x: 1448, y: 880, orientation: 'vertical', size: 96 },
  { id: 'door_pwr_west', x: 1592, y: 880, orientation: 'vertical', size: 96 },
  { id: 'door_ground_south', x: 1184, y: 940, orientation: 'horizontal', size: 96 },
  { id: 'door_life_north', x: 1184, y: 1108, orientation: 'horizontal', size: 96 },
  { id: 'door_pwr_south', x: 1648, y: 1128, orientation: 'horizontal', size: 96 },
  { id: 'door_life_east', x: 1512, y: 1232, orientation: 'vertical', size: 96 },
  { id: 'door_life_elec', x: 1248, y: 1264, orientation: 'vertical', size: 96 },
]

const ROLE_SPAWNS: Record<RoleId, { x: number; y: number }> = {
  director: { x: 1184, y: 696 },
  comms: { x: 544, y: 240 },
  science: { x: 1764, y: 240 },
  engineer: { x: 1836, y: 984 },
}

// ============================================================================
// 16 ESTACIONES INTERACTIVAS DISTRIBUIDAS EN LAS 9 SALAS (4 POR ROL, 1-A-1)
// ============================================================================
const CONSOLES: ConsoleStation[] = [
  // 🦅 ROL 1: CÓNDOR-4 (GROUND SEGMENT x2 + LAUNCH SEGMENT + ENGINE ROOM)
  {
    id: 'dir_orbit',
    role: 'director',
    roomId: 'ground_segment',
    zoneName: 'GROUND SEGMENT (CENTER)',
    subsystemLabel: '6-DOF APAS ORBITAL DOCKING',
    title: '5-Display Curved Command Console & APAS Docking',
    shortLabel: 'APAS DOCKING',
    icon: '🚀',
    x: 1184,
    y: 628,
    standX: 1184,
    standY: 692,
    hint: 'Execute 6-DOF APAS spacecraft docking maneuver from the central bridge.',
  },
  {
    id: 'dir_shield',
    role: 'director',
    roomId: 'ground_segment',
    zoneName: 'GROUND SEGMENT (NORTHEAST RADAR)',
    subsystemLabel: 'ORBITAL METEOROID DEFENSE',
    title: 'Polar Radar Orbital Defense Station',
    shortLabel: 'COMET DEFENSE',
    icon: '☄️',
    x: 1330,
    y: 580,
    standX: 1330,
    standY: 634,
    hint: 'Intercept incoming meteoroids with the orbital laser turret to maintain 100% hull integrity.',
  },
  {
    id: 'dir_gyro',
    role: 'director',
    roomId: 'launch_segment',
    zoneName: 'LAUNCH SEGMENT (HYDRAULIC ARM)',
    subsystemLabel: '3D ADCS GYROSCOPE CALIBRATION',
    title: 'Hydraulic Arm & 3D Gyroscope Calibrator',
    shortLabel: '3D GYROSCOPE',
    icon: '🎯',
    x: 618,
    y: 816,
    standX: 618,
    standY: 760,
    hint: 'Fire counter-acting RCS pulses in Pitch/Roll/Yaw to stabilize the gyroscope (<0.05 rad/s).',
  },
  {
    id: 'dir_engine',
    role: 'director',
    roomId: 'engine_room',
    zoneName: 'ENGINE ROOM (SOUTHWEST TURBINE)',
    subsystemLabel: 'KESSLER RADAR & DEBRIS EVASION',
    title: 'Heavy Turbine & Kessler Debris Radar',
    shortLabel: 'DEBRIS EVASION',
    icon: '💥',
    x: 392,
    y: 1246,
    standX: 480,
    standY: 1284,
    hint: 'Engage thrusters and EMP deflector to clear the Kessler orbital debris belt.',
  },

  // 🦙 ROL 2: ALPACA-1 (POWER MGD & REACTOR x2 + LIFE SUPPORT + ENGINE ROOM)
  {
    id: 'eng_solar',
    role: 'engineer',
    roomId: 'power_reactor',
    zoneName: 'POWER MGD (SOLAR ARRAYS & EPS BUSES)',
    subsystemLabel: 'EPS ELECTRICAL DISTRIBUTION',
    title: 'Solar Charge Racks & EPS Bus Matrix',
    shortLabel: 'SOLAR EPS BUSES',
    icon: '⚡',
    x: 1968,
    y: 920,
    standX: 1968,
    standY: 992,
    hint: 'Balance Buses A/B/C and regulate critical loads during orbital eclipses (+100% Battery).',
  },
  {
    id: 'eng_cool',
    role: 'engineer',
    roomId: 'power_reactor',
    zoneName: 'POWER MGD & REACTOR (CORE)',
    subsystemLabel: 'CRYOGENIC REACTOR COOLING',
    title: 'Thermal Core Reactor & NH3 Coolant Pumps',
    shortLabel: 'NH3 COOLING',
    icon: '☢️',
    x: 1836,
    y: 910,
    standX: 1836,
    standY: 978,
    hint: 'Activate radiators and ammonia pumps to bring reactor core temperature below 400°C.',
  },
  {
    id: 'eng_o2',
    role: 'engineer',
    roomId: 'life_electrical',
    zoneName: 'LIFE SUPPORT (O2 TANKS)',
    subsystemLabel: 'ECLSS LIFE SUPPORT & O2 PRESSURE',
    title: 'Dual Blue O2 Tanks with ECLSS Valves',
    shortLabel: 'O2 LIFE SUPPORT',
    icon: '🫧',
    x: 980,
    y: 1184,
    standX: 980,
    standY: 1264,
    hint: 'Regulate cabin O2, N2, CO2 scrubbers, and thermal control in real time.',
  },
  {
    id: 'eng_pcb',
    role: 'engineer',
    roomId: 'engine_room',
    zoneName: 'ENGINE ROOM (EAST ELECTRICAL BAY)',
    subsystemLabel: 'PCB CIRCUIT DIAGNOSTICS & REPAIR',
    title: 'PCB Diagnostics & Micro-Soldering Bench',
    shortLabel: 'PCB CIRCUITS',
    icon: '🔌',
    x: 634,
    y: 1112,
    standX: 576,
    standY: 1126,
    hint: 'Rotate copper traces and bypass blown capacitors to re-energize all 3 output rails.',
  },

  // 🐆 ROL 3: PUMA-3 (USER SEGMENT x2 + LABORATORY + LAUNCH SEGMENT)
  {
    id: 'sci_scan',
    role: 'science',
    roomId: 'user_segment',
    zoneName: 'USER SEGMENT (NORTHEAST)',
    subsystemLabel: 'PLANETARY PROBE DESCENT',
    title: 'Planetary Probe Descent Simulator',
    shortLabel: 'PROBE LANDING',
    icon: '🛬',
    x: 1744,
    y: 168,
    standX: 1744,
    standY: 228,
    hint: 'Pilot retro-braking descent of the science lander for safe touchdown (<5.0 m/s).',
  },
  {
    id: 'sat_ctrl_2',
    role: 'science',
    roomId: 'user_segment',
    zoneName: 'USER SEGMENT (SATELLITE BAY 2)',
    subsystemLabel: 'DUAL HOHMANN ORBITAL TRANSFER',
    title: 'Orbital Tracking Station SAT-02 INTI-SCIENCE',
    shortLabel: 'HOHMANN ORBIT',
    icon: '🛰️',
    x: 1628,
    y: 298,
    standX: 1718,
    standY: 298,
    hint: 'Compute and fire the Hohmann Δv burn to align SAT-02 INTI-SCIENCE.',
  },
  {
    id: 'sci_lab',
    role: 'science',
    roomId: 'laboratory',
    zoneName: 'LABORATORY (SCIENCE SUB-LAB)',
    subsystemLabel: 'GLACIAL MASS SPECTROMETRY',
    title: 'Laser Drill & Mass Spectrometer',
    shortLabel: 'm/z SPECTROMETER',
    icon: '🔬',
    x: 1875,
    y: 552,
    standX: 1852,
    standY: 598,
    hint: 'Tune laser frequency and thermal energy to isolate H2O, O-18, and Helium-3.',
  },
  {
    id: 'sci_thermal',
    role: 'science',
    roomId: 'launch_segment',
    zoneName: 'LAUNCH SEGMENT (PAYLOAD MODULE)',
    subsystemLabel: 'MULTISPECTRAL IR/UV TELEMETRY',
    title: 'Solar Coronagraph & Multiband IR/UV/X Viewer',
    shortLabel: 'IR / UV / X VIEWER',
    icon: '🌞',
    x: 640,
    y: 580,
    standX: 640,
    standY: 632,
    hint: 'Calibrate spectral filter (IR, UV, X-Ray), focus, and gain on solar anomalies.',
  },

  // 🐍 ROL 4: SERPIENTE-2 (SPACE SEGMENT x2 + COMMUNICATIONS x2)
  {
    id: 'sat_ctrl_1',
    role: 'comms',
    roomId: 'space_segment',
    zoneName: 'SPACE SEGMENT (SATELLITE FIREWALL)',
    subsystemLabel: 'CYBER DEFENSE & PORT 8080 FIREWALL',
    title: 'SAT-01 AMARU-COMMS Firewall & Defense Terminal',
    shortLabel: 'CYBER DEFENSE 8080',
    icon: '🛡️',
    x: 362,
    y: 286,
    standX: 362,
    standY: 336,
    hint: 'Inspect live network frames to block SQL injections and data exfiltration attempts.',
  },
  {
    id: 'com_decrypt',
    role: 'comms',
    roomId: 'space_segment',
    zoneName: 'SPACE SEGMENT (CUBESAT CRYPTOGRAPHY)',
    subsystemLabel: 'QUANTUM CRC DECRYPTION',
    title: 'Hexadecimal CRC Matrix & Quantum Decryptor',
    shortLabel: 'CRC DECRYPTION',
    icon: '🔐',
    x: 644,
    y: 194,
    standX: 644,
    standY: 248,
    hint: 'Locate cosmic-ray corrupted bytes in red rows/columns and repair CRC parity.',
  },
  {
    id: 'com_tx',
    role: 'comms',
    roomId: 'communications',
    zoneName: 'COMMUNICATIONS (PARABOLIC DOME)',
    subsystemLabel: 'DSN TELECOMMUNICATIONS TUNING',
    title: 'DSN Oscilloscope & Carrier Wave Tuner',
    shortLabel: 'DSN TELECOM',
    icon: '📡',
    x: 1104,
    y: 194,
    standX: 1104,
    standY: 260,
    hint: 'Match frequency (Hz) and gain (%) to the green target carrier wave for the satellite link.',
  },
  {
    id: 'com_hga',
    role: 'comms',
    roomId: 'communications',
    zoneName: 'COMMUNICATIONS (NORTHEAST HGA TRACKING)',
    subsystemLabel: 'HIGH-GAIN ANTENNA ALIGNMENT',
    title: 'Polar Tracking Radar for HGA / DSN Antenna',
    shortLabel: 'HIGH-GAIN ANTENNA',
    icon: '📶',
    x: 1244,
    y: 156,
    standX: 1244,
    standY: 210,
    hint: 'Track the satellite in Azimuth, Elevation, and Polarization keeping SNR >= 90% until downlink completes.',
  },
]

// Mapeo estricto 1-a-1: 16 consolas físicas <-> 16 minijuegos únicos (4 por personaje)
const CONSOLE_MINIGAME: Record<string, MinigameId> = {
  // 🦅 CÓNDOR-4 (4)
  dir_orbit: 'dock',
  dir_shield: 'comet',
  dir_gyro: 'gyro',
  dir_engine: 'debris',
  // 🦙 ALPACA-1 (4)
  eng_solar: 'eps',
  eng_o2: 'eclss',
  eng_cool: 'reactor',
  eng_pcb: 'pcb',
  // 🐆 PUMA-3 (4)
  sci_scan: 'lander',
  sat_ctrl_2: 'nav',
  sci_lab: 'spectro',
  sci_thermal: 'thermal',
  // 🐍 SERPIENTE-2 (4)
  com_tx: 'telecom',
  sat_ctrl_1: 'cyber',
  com_hga: 'hga',
  com_decrypt: 'decrypt',
}

interface UniqueMinigameDef {
  game: MinigameId
  role: RoleId
  primaryConsoleId: string
  title: string
  threatTitle: string
  actionHint: string
  quadrantTag: string
  metricLabel: string
}

const UNIQUE_MINIGAME_DEFS: Record<MinigameId, UniqueMinigameDef> = {
  dock: {
    game: 'dock',
    role: 'director',
    primaryConsoleId: 'dir_orbit',
    title: 'APAS Orbital Docking',
    threatTitle: 'Capsule drift · Orbit -1.0%/s',
    actionHint: 'Capsule misaligned at APAS — Proceed to correct orbital docking',
    quadrantTag: 'GROUND SEG',
    metricLabel: 'ORBIT',
  },
  comet: {
    game: 'comet',
    role: 'director',
    primaryConsoleId: 'dir_shield',
    title: 'Orbital Meteoroid Defense',
    threatTitle: 'Incoming meteoroids · Hull -1.2%/s',
    actionHint: 'Incoming meteoroid swarm — Proceed to laser defense turret',
    quadrantTag: 'GROUND SEG',
    metricLabel: 'HULL',
  },
  gyro: {
    game: 'gyro',
    role: 'director',
    primaryConsoleId: 'dir_gyro',
    title: '3D ADCS Gyroscope Calibration',
    threatTitle: 'ADCS multi-axis torque · Orbit -1.0%/s',
    actionHint: 'ADCS gyroscope off-axis — Proceed to stabilize CMG flywheels',
    quadrantTag: 'LAUNCH SEG',
    metricLabel: 'ATTITUDE',
  },
  debris: {
    game: 'debris',
    role: 'director',
    primaryConsoleId: 'dir_engine',
    title: 'Kessler Debris Evasion',
    threatTitle: 'Kessler debris cloud · Hull -1.3%/s',
    actionHint: 'Orbital debris in flight corridor — Engage radar and deflector shield',
    quadrantTag: 'ENGINE ROOM',
    metricLabel: 'HULL',
  },
  eps: {
    game: 'eps',
    role: 'engineer',
    primaryConsoleId: 'eng_solar',
    title: 'EPS Power Distribution',
    threatTitle: 'Solar eclipse · Battery -1.5%/s',
    actionHint: 'Solar eclipse draining battery — Proceed to balance G1/G2/G3 generators',
    quadrantTag: 'POWER MGD',
    metricLabel: 'BATTERY',
  },
  eclss: {
    game: 'eclss',
    role: 'engineer',
    primaryConsoleId: 'eng_o2',
    title: 'ECLSS O2 / CO2 Life Support',
    threatTitle: 'High CO2 · O2 dropping -1.5%/s',
    actionHint: 'Elevated CO2 concentration — Purge CO2 scrubbers and seal cabin pressure',
    quadrantTag: 'LIFE SUPPORT',
    metricLabel: 'OXYGEN',
  },
  reactor: {
    game: 'reactor',
    role: 'engineer',
    primaryConsoleId: 'eng_cool',
    title: 'NH3 Reactor Cooling',
    threatTitle: 'Core overheating · Battery -1.2%/s',
    actionHint: 'Thermal cores >750°C — Pump NH3 coolant into reactor loop',
    quadrantTag: 'REACTOR CORE',
    metricLabel: 'CORE',
  },
  pcb: {
    game: 'pcb',
    role: 'engineer',
    primaryConsoleId: 'eng_pcb',
    title: 'PCB Circuit Repair',
    threatTitle: 'PCB bus short · Battery -1.4%/s',
    actionHint: 'Master bus short circuit — Bridge PCB capacitors and breakers',
    quadrantTag: 'ENGINE BAY',
    metricLabel: 'BUSES',
  },
  lander: {
    game: 'lander',
    role: 'science',
    primaryConsoleId: 'sci_scan',
    title: 'PUMA-3 Planetary Probe',
    threatTitle: 'Probe descending (500m → 0m)',
    actionHint: 'Science probe in free fall — Ignite landing retro-thrusters',
    quadrantTag: 'USER SEG',
    metricLabel: 'ALTITUDE',
  },
  nav: {
    game: 'nav',
    role: 'science',
    primaryConsoleId: 'sat_ctrl_2',
    title: 'SAT-02 INTI-SCIENCE Orbit',
    threatTitle: 'SAT-02 off-orbit · Signal ↓',
    actionHint: 'SAT-02 INTI-SCIENCE off course — Execute Hohmann transfer burn',
    quadrantTag: 'USER SEG',
    metricLabel: 'SAT-02',
  },
  spectro: {
    game: 'spectro',
    role: 'science',
    primaryConsoleId: 'sci_lab',
    title: 'Glacial Mass Spectrometry',
    threatTitle: 'm/z analysis buffer ↑ · Samples',
    actionHint: 'Unresolved glacial samples — Tune and capture spectral peaks',
    quadrantTag: 'LABORATORY',
    metricLabel: 'BUFFER',
  },
  thermal: {
    game: 'thermal',
    role: 'science',
    primaryConsoleId: 'sci_thermal',
    title: 'Multispectral IR/UV Telemetry',
    threatTitle: 'Coronal anomaly · Signal ↓',
    actionHint: 'Unfocused solar thermal anomalies — Scan via IR/UV optics',
    quadrantTag: 'LAUNCH LAB',
    metricLabel: 'OPTICS',
  },
  telecom: {
    game: 'telecom',
    role: 'comms',
    primaryConsoleId: 'com_tx',
    title: 'DSN Telecom Repair',
    threatTitle: 'Antenna desynced · Buffer ↑ 100%',
    actionHint: 'DSN link out of phase and buffer filling — Tune frequency and gain',
    quadrantTag: 'COMMS DSN',
    metricLabel: 'BUFFER',
  },
  cyber: {
    game: 'cyber',
    role: 'comms',
    primaryConsoleId: 'sat_ctrl_1',
    title: 'Port 8080 Firewall Defense',
    threatTitle: 'Port 8080 intrusion · Signal ↓',
    actionHint: 'Active intrusion on port 8080 — Filter malicious firewall packets',
    quadrantTag: 'SPACE SEG',
    metricLabel: 'SIGNAL',
  },
  hga: {
    game: 'hga',
    role: 'comms',
    primaryConsoleId: 'com_hga',
    title: 'High-Gain Antenna Alignment',
    threatTitle: 'Satellite missing HGA lock · Buffer ↑',
    actionHint: 'Ka-band beam lost on HGA — Lock azimuth, elevation, and polarization',
    quadrantTag: 'COMMS HGA',
    metricLabel: 'HGA SNR',
  },
  decrypt: {
    game: 'decrypt',
    role: 'comms',
    primaryConsoleId: 'com_decrypt',
    title: 'Quantum CRC Decryption',
    threatTitle: 'Corrupted packets · Signal -1.4%/s',
    actionHint: 'Cosmic rays corrupting CRC matrix — Repair quantum parity bits',
    quadrantTag: 'SPACE CRC',
    metricLabel: 'CRC NET',
  },
}

interface ActiveThreat {
  id: string
  game: MinigameId
  role: RoleId
  consoleId: string
  title: string
  urgency: number
  probeAlt: number
  startedAt: number
  attempt?: number
  seed?: number
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const DIRECTION_ARROWS_8 = ['➡', '↘', '⬇', '↙', '⬅', '↖', '⬆', '↗'] as const
function getDirectionArrow(dx: number, dy: number): string {
  const angle = Math.atan2(dy, dx)
  const octant = Math.round((8 * angle) / (2 * Math.PI) + 8) % 8
  return DIRECTION_ARROWS_8[octant] ?? '➡'
}

type SolidObstacle =
  | {
      id: string
      roomId: RoomId
      kind: 'rect'
      x: number
      y: number
      w: number
      h: number
      shadow?: boolean
    }
  | {
      id: string
      roomId: RoomId
      kind: 'circle'
      cx: number
      cy: number
      r: number
      shadow?: boolean
    }
  | {
      id: string
      roomId: RoomId
      kind: 'ellipse'
      cx: number
      cy: number
      rx: number
      ry: number
      shadow?: boolean
    }

const PLAYER_COLLISION_RADIUS = 11

// Obstáculos sólidos con masa física real para las 9 salas de la estación
const SOLID_OBSTACLES: SolidObstacle[] = [
  // a) GROUND SEGMENT
  { id: 'gs_rack_nw', roomId: 'ground_segment', kind: 'rect', x: 932, y: 584, w: 38, h: 76 },
  { id: 'gs_rack_sw', roomId: 'ground_segment', kind: 'rect', x: 932, y: 780, w: 38, h: 114 },
  { id: 'gs_rack_e', roomId: 'ground_segment', kind: 'rect', x: 1394, y: 686, w: 38, h: 134 },
  { id: 'gs_bookshelf', roomId: 'ground_segment', kind: 'rect', x: 988, y: 576, w: 52, h: 42 },
  { id: 'gs_holo', roomId: 'ground_segment', kind: 'ellipse', cx: 1184, cy: 630, rx: 32, ry: 17 },
  { id: 'gs_ring_desk', roomId: 'ground_segment', kind: 'ellipse', cx: 1184, cy: 796, rx: 86, ry: 62 },
  { id: 'gs_mon_sw', roomId: 'ground_segment', kind: 'rect', x: 978, y: 888, w: 44, h: 36 },
  { id: 'gs_chair_sw', roomId: 'ground_segment', kind: 'rect', x: 1024, y: 890, w: 32, h: 34 },

  // b) LAUNCH SEGMENT
  { id: 'ls_sim', roomId: 'launch_segment', kind: 'rect', x: 224, y: 514, w: 52, h: 44 },
  { id: 'ls_bookshelf', roomId: 'launch_segment', kind: 'rect', x: 516, y: 516, w: 52, h: 44 },
  { id: 'ls_capsules', roomId: 'launch_segment', kind: 'rect', x: 588, y: 518, w: 106, h: 76 },
  { id: 'ls_shuttle_wings', roomId: 'launch_segment', kind: 'rect', x: 342, y: 610, w: 124, h: 140, shadow: false },
  { id: 'ls_shuttle_nose', roomId: 'launch_segment', kind: 'rect', x: 466, y: 650, w: 78, h: 60, shadow: false },
  { id: 'ls_tanks', roomId: 'launch_segment', kind: 'rect', x: 254, y: 784, w: 102, h: 88 },
  { id: 'ls_robot_arm', roomId: 'launch_segment', kind: 'rect', x: 586, y: 798, w: 66, h: 48 },

  // c) ENGINE ROOM
  { id: 'er_turbine', roomId: 'engine_room', kind: 'rect', x: 264, y: 1148, w: 256, h: 110 },
  { id: 'er_monitor', roomId: 'engine_room', kind: 'rect', x: 612, y: 1094, w: 44, h: 36 },
  { id: 'er_chair', roomId: 'engine_room', kind: 'rect', x: 618, y: 1140, w: 32, h: 36 },

  // d) SPACE SEGMENT
  { id: 'ss_left_console', roomId: 'space_segment', kind: 'rect', x: 252, y: 174, w: 62, h: 86 },
  { id: 'ss_center_console', roomId: 'space_segment', kind: 'ellipse', cx: 448, cy: 228, rx: 56, ry: 36 },
  { id: 'ss_cubesat_console', roomId: 'space_segment', kind: 'rect', x: 606, y: 166, w: 96, h: 56 },
  { id: 'ss_sat1_hub', roomId: 'space_segment', kind: 'rect', x: 298, y: 274, w: 128, h: 44 },
  { id: 'ss_rack_mid', roomId: 'space_segment', kind: 'rect', x: 516, y: 298, w: 32, h: 48 },
  { id: 'ss_spec_mid', roomId: 'space_segment', kind: 'rect', x: 568, y: 308, w: 48, h: 36 },
  { id: 'ss_rack_e', roomId: 'space_segment', kind: 'rect', x: 694, y: 296, w: 32, h: 48 },

  // e) COMMUNICATIONS
  { id: 'cm_dsn_desk', roomId: 'communications', kind: 'ellipse', cx: 1104, cy: 194, rx: 76, ry: 42 },
  { id: 'cm_rack_nw', roomId: 'communications', kind: 'rect', x: 898, y: 134, w: 32, h: 48 },
  { id: 'cm_ant_nw', roomId: 'communications', kind: 'rect', x: 944, y: 138, w: 32, h: 40 },
  { id: 'cm_crypto_ne', roomId: 'communications', kind: 'rect', x: 1226, y: 138, w: 36, h: 36 },
  { id: 'cm_rack_ne', roomId: 'communications', kind: 'rect', x: 1276, y: 134, w: 32, h: 48 },
  { id: 'cm_mon_sw', roomId: 'communications', kind: 'rect', x: 904, y: 300, w: 56, h: 36 },
  { id: 'cm_spec_se', roomId: 'communications', kind: 'rect', x: 1226, y: 304, w: 48, h: 36 },

  // f) USER SEGMENT
  { id: 'us_bio_tubes', roomId: 'user_segment', kind: 'rect', x: 1545, y: 142, w: 128, h: 104 },
  { id: 'us_curve_console', roomId: 'user_segment', kind: 'rect', x: 1686, y: 128, w: 162, h: 66 },
  { id: 'us_holo_pod', roomId: 'user_segment', kind: 'rect', x: 1898, y: 224, w: 76, h: 56 },
  { id: 'us_sat2_hub', roomId: 'user_segment', kind: 'rect', x: 1558, y: 286, w: 140, h: 42 },
  { id: 'us_incubator', roomId: 'user_segment', kind: 'rect', x: 1944, y: 298, w: 36, h: 44 },
  { id: 'us_glacier', roomId: 'user_segment', kind: 'rect', x: 1994, y: 298, w: 48, h: 44 },

  // g) LABORATORY
  { id: 'lb_hood', roomId: 'laboratory', kind: 'rect', x: 1618, y: 512, w: 118, h: 34 },
  { id: 'lb_desk', roomId: 'laboratory', kind: 'rect', x: 1846, y: 532, w: 58, h: 42 },
  { id: 'lb_rack_e', roomId: 'laboratory', kind: 'rect', x: 1912, y: 558, w: 96, h: 62 },
  { id: 'lb_incubator', roomId: 'laboratory', kind: 'rect', x: 1768, y: 652, w: 36, h: 44 },
  { id: 'lb_glacier', roomId: 'laboratory', kind: 'rect', x: 1922, y: 646, w: 48, h: 44 },

  // h) POWER MGD & REACTOR
  { id: 'pr_rack_w1', roomId: 'power_reactor', kind: 'rect', x: 1604, y: 944, w: 28, h: 52 },
  { id: 'pr_robot', roomId: 'power_reactor', kind: 'rect', x: 1608, y: 1012, w: 26, h: 28 },
  { id: 'pr_reactor', roomId: 'power_reactor', kind: 'circle', cx: 1712, cy: 972, r: 46 },
  { id: 'pr_console', roomId: 'power_reactor', kind: 'rect', x: 1772, y: 868, w: 128, h: 78 },
  { id: 'pr_crystals', roomId: 'power_reactor', kind: 'rect', x: 1924, y: 884, w: 174, h: 86 },
  { id: 'pr_cabinet', roomId: 'power_reactor', kind: 'rect', x: 1756, y: 1068, w: 40, h: 44 },
  { id: 'pr_battery', roomId: 'power_reactor', kind: 'rect', x: 1814, y: 1072, w: 48, h: 32 },
  { id: 'pr_toolbox', roomId: 'power_reactor', kind: 'rect', x: 1876, y: 1072, w: 36, h: 26 },
  { id: 'pr_osc', roomId: 'power_reactor', kind: 'rect', x: 1936, y: 1058, w: 48, h: 36 },
  { id: 'pr_thermal', roomId: 'power_reactor', kind: 'rect', x: 2028, y: 1060, w: 48, h: 28 },

  // i) LIFE SUPPORT & ELECTRICAL
  { id: 'le_divider_top', roomId: 'life_electrical', kind: 'rect', x: 1240, y: 1120, w: 16, h: 96, shadow: false },
  { id: 'le_divider_bot', roomId: 'life_electrical', kind: 'rect', x: 1240, y: 1312, w: 16, h: 96, shadow: false },
  { id: 'le_o2_tanks', roomId: 'life_electrical', kind: 'rect', x: 916, y: 1130, w: 126, h: 110 },
  { id: 'le_bio_pod', roomId: 'life_electrical', kind: 'rect', x: 1054, y: 1130, w: 56, h: 106 },
  { id: 'le_master_sw', roomId: 'life_electrical', kind: 'rect', x: 1310, y: 1132, w: 148, h: 92 },
  { id: 'le_incubator', roomId: 'life_electrical', kind: 'rect', x: 908, y: 1332, w: 36, h: 44 },
  { id: 'le_glacier', roomId: 'life_electrical', kind: 'rect', x: 1134, y: 1332, w: 48, h: 44 },
  { id: 'le_cabinet', roomId: 'life_electrical', kind: 'rect', x: 1278, y: 1332, w: 40, h: 44 },
  { id: 'le_bunk', roomId: 'life_electrical', kind: 'rect', x: 1416, y: 1340, w: 52, h: 36 },
]

function isPointInsideSolidObstacle(
  px: number,
  py: number,
  radius = PLAYER_COLLISION_RADIUS
): boolean {
  for (const ob of SOLID_OBSTACLES) {
    if (ob.kind === 'rect') {
      if (
        px >= ob.x - radius &&
        px <= ob.x + ob.w + radius &&
        py >= ob.y - radius &&
        py <= ob.y + ob.h + radius
      ) {
        return true
      }
    } else if (ob.kind === 'circle') {
      const lim = ob.r + radius
      const dx = px - ob.cx
      const dy = py - ob.cy
      if (dx * dx + dy * dy < lim * lim) {
        return true
      }
    } else {
      const rx = ob.rx + radius
      const ry = ob.ry + radius
      const nx = (px - ob.cx) / rx
      const ny = (py - ob.cy) / ry
      if (nx * nx + ny * ny < 1) {
        return true
      }
    }
  }
  return false
}

function drawObstacleFloorShadow(ctx: CanvasRenderingContext2D, ob: SolidObstacle) {
  if (ob.shadow === false) return
  ctx.save()
  ctx.fillStyle = 'rgba(2, 5, 14, 0.44)'
  ctx.beginPath()
  if (ob.kind === 'rect') {
    ctx.ellipse(
      ob.x + ob.w / 2,
      ob.y + ob.h + 1,
      ob.w * 0.48 + 3,
      Math.max(5, Math.min(13, ob.h * 0.2)),
      0,
      0,
      Math.PI * 2
    )
  } else if (ob.kind === 'circle') {
    ctx.ellipse(ob.cx, ob.cy + ob.r * 0.88, ob.r * 0.96, ob.r * 0.34, 0, 0, Math.PI * 2)
  } else {
    ctx.ellipse(
      ob.cx,
      ob.cy + ob.ry * 0.85,
      ob.rx * 0.96,
      Math.max(8, ob.ry * 0.34),
      0,
      0,
      Math.PI * 2
    )
  }
  ctx.fill()
  ctx.restore()
}

function isPointInsideWalkableGeometry(
  px: number,
  py: number,
  checkObstacles = true
): boolean {
  if (checkObstacles && isPointInsideSolidObstacle(px, py)) {
    return false
  }
  const margin = 14
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
  const inAnyRoomHull = findRoomAtPoint(px, py) !== null
  for (const cor of CORRIDORS) {
    const r = cor.rect
    if (cor.orientation === 'horizontal') {
      if (px >= r.x && px <= r.x + r.w && py >= r.y + 10 && py <= r.y + r.h - 10) {
        return true
      }
      // Bocas abiertas hacia las habitaciones conectadas (elimina toda pared invisible en puertas)
      if (
        inAnyRoomHull &&
        px >= r.x - 30 &&
        px <= r.x + r.w + 30 &&
        py >= r.y + 12 &&
        py <= r.y + r.h - 12
      ) {
        return true
      }
    } else {
      if (px >= r.x + 10 && px <= r.x + r.w - 10 && py >= r.y && py <= r.y + r.h) {
        return true
      }
      if (
        inAnyRoomHull &&
        px >= r.x + 12 &&
        px <= r.x + r.w - 12 &&
        py >= r.y - 30 &&
        py <= r.y + r.h + 30
      ) {
        return true
      }
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

function deriveStationEvent(
  threats: Pick<ActiveThreat, 'game'>[],
  defaultAmbient: StationEventId
): StationEventId {
  const gameSet = new Set(threats.map((t) => t.game))
  if (gameSet.has('eps') || gameSet.has('reactor') || gameSet.has('pcb')) {
    return 'eclipse'
  }
  if (gameSet.has('eclss')) {
    return 'o2_leak'
  }
  if (
    defaultAmbient === 'solar_storm' ||
    gameSet.has('cyber') ||
    gameSet.has('decrypt') ||
    gameSet.has('comet') ||
    gameSet.has('debris') ||
    gameSet.has('telecom') ||
    gameSet.has('hga') ||
    gameSet.has('nav') ||
    gameSet.has('gyro') ||
    gameSet.has('thermal')
  ) {
    return 'solar_storm'
  }
  return 'none'
}

function findCorridorAtPoint(px: number, py: number): CorridorSegment | null {
  for (const cor of CORRIDORS) {
    const r = cor.rect
    if (px >= r.x - 20 && px <= r.x + r.w + 20 && py >= r.y - 20 && py <= r.y + r.h + 20) {
      return cor
    }
  }
  return null
}

function findNearestWalkablePoint(px: number, py: number): { x: number; y: number } | null {
  if (isPointInsideWalkableGeometry(px, py)) return { x: px, y: py }
  const rm = findRoomAtPoint(px, py)
  let baseX = px
  let baseY = py
  if (rm) {
    baseX = clamp(px, rm.floor.x + 18, rm.floor.x + rm.floor.w - 18)
    baseY = clamp(py, rm.floor.y + 18, rm.floor.y + rm.floor.h - 18)
  } else {
    const cor = findCorridorAtPoint(px, py)
    if (!cor) return null
    baseX = clamp(px, cor.rect.x + 14, cor.rect.x + cor.rect.w - 14)
    baseY = clamp(py, cor.rect.y + 14, cor.rect.y + cor.rect.h - 14)
  }
  if (isPointInsideWalkableGeometry(baseX, baseY)) return { x: baseX, y: baseY }
  for (const dist of [14, 28, 42, 58, 76, 96, 120]) {
    for (let i = 0; i < 16; i++) {
      const ang = (i * Math.PI * 2) / 16
      const tx = baseX + Math.cos(ang) * dist
      const ty = baseY + Math.sin(ang) * dist
      if (isPointInsideWalkableGeometry(tx, ty)) {
        return { x: tx, y: ty }
      }
    }
  }
  if (rm && isPointInsideWalkableGeometry(rm.navX, rm.navY)) {
    return { x: rm.navX, y: rm.navY }
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
  miniRooms: { roomId: RoomId; x: number; y: number; w: number; h: number; accent?: boolean }[]
}

const QUADRANT_DEFS: Record<QuadrantId, QuadrantDef> = {
  director: {
    id: 'director',
    sectorNum: 1,
    title: 'QUADRANT 1 · COMMAND & HANGAR',
    roomsSummary: 'GROUND · LAUNCH · ENGINE',
    entryPoint: { x: 1184, y: 692 },
    cameraFocus: { x: 1184, y: 736, zoom: 0.72 },
    miniRooms: [
      { roomId: 'ground_segment', x: 42, y: 12, w: 50, h: 28, accent: true }, // Ground
      { roomId: 'launch_segment', x: 8, y: 8, w: 28, h: 28 }, // Launch
      { roomId: 'engine_room', x: 10, y: 40, w: 30, h: 18 }, // Engine
    ],
  },
  engineer: {
    id: 'engineer',
    sectorNum: 2,
    title: 'QUADRANT 2 · POWER & O2 SUPPORT',
    roomsSummary: 'POWER · LIFE SUPPORT · ELEC',
    entryPoint: { x: 1836, y: 1004 },
    cameraFocus: { x: 1856, y: 960, zoom: 0.72 },
    miniRooms: [
      { roomId: 'power_reactor', x: 38, y: 10, w: 54, h: 28, accent: true }, // Power/Reactor
      { roomId: 'life_electrical', x: 12, y: 38, w: 54, h: 20 }, // Life Support + Electrical
    ],
  },
  science: {
    id: 'science',
    sectorNum: 3,
    title: 'QUADRANT 3 · SCIENCE & PROBES',
    roomsSummary: 'USER SEGMENT · LABORATORY',
    entryPoint: { x: 1792, y: 244 },
    cameraFocus: { x: 1792, y: 224, zoom: 0.74 },
    miniRooms: [
      { roomId: 'user_segment', x: 10, y: 6, w: 56, h: 24, accent: true }, // User Segment
      { roomId: 'laboratory', x: 16, y: 33, w: 46, h: 20 }, // Laboratory
    ],
  },
  comms: {
    id: 'comms',
    sectorNum: 4,
    title: 'QUADRANT 4 · SPACE & COMMS',
    roomsSummary: 'SPACE SEGMENT · DSN COMMS',
    entryPoint: { x: 512, y: 244 },
    cameraFocus: { x: 800, y: 224, zoom: 0.58 },
    miniRooms: [
      { roomId: 'space_segment', x: 6, y: 14, w: 44, h: 36, accent: true }, // Space Segment
      { roomId: 'communications', x: 54, y: 14, w: 40, h: 36 }, // Communications
    ],
  },
}

const MINIMAP_SPATIAL_ORDER: QuadrantId[] = ['comms', 'science', 'director', 'engineer']

interface BacklogMissionDef {
  id: string
  game: MinigameId
  role: RoleId
  consoleIds: string[]
  title: string
  quadrantTag: string
}

const MISSION_BACKLOG: BacklogMissionDef[] = [
  // 🦅 CÓNDOR-4 (4)
  {
    id: 'm_dir_dock',
    game: 'dock',
    role: 'director',
    consoleIds: ['dir_orbit'],
    title: 'APAS Orbital Docking',
    quadrantTag: 'GROUND SEG',
  },
  {
    id: 'm_dir_comet',
    game: 'comet',
    role: 'director',
    consoleIds: ['dir_shield'],
    title: 'Comet & Meteoroid Defense',
    quadrantTag: 'GROUND SEG',
  },
  {
    id: 'm_dir_gyro',
    game: 'gyro',
    role: 'director',
    consoleIds: ['dir_gyro'],
    title: '3D ADCS Gyroscope Calibration',
    quadrantTag: 'LAUNCH SEG',
  },
  {
    id: 'm_dir_debris',
    game: 'debris',
    role: 'director',
    consoleIds: ['dir_engine'],
    title: 'Kessler Debris Evasion',
    quadrantTag: 'ENGINE ROOM',
  },
  // 🦙 ALPACA-1 (4)
  {
    id: 'm_eng_eps',
    game: 'eps',
    role: 'engineer',
    consoleIds: ['eng_solar'],
    title: 'EPS Power Distribution',
    quadrantTag: 'POWER MGD',
  },
  {
    id: 'm_eng_eclss',
    game: 'eclss',
    role: 'engineer',
    consoleIds: ['eng_o2'],
    title: 'ECLSS Life Support (O2 / CO2)',
    quadrantTag: 'LIFE SUPPORT',
  },
  {
    id: 'm_eng_reactor',
    game: 'reactor',
    role: 'engineer',
    consoleIds: ['eng_cool'],
    title: 'NH3 Reactor Cooling',
    quadrantTag: 'REACTOR CORE',
  },
  {
    id: 'm_eng_pcb',
    game: 'pcb',
    role: 'engineer',
    consoleIds: ['eng_pcb'],
    title: 'PCB Circuit Repair',
    quadrantTag: 'ENGINE BAY',
  },
  // 🐆 PUMA-3 (4)
  {
    id: 'm_sci_lander',
    game: 'lander',
    role: 'science',
    consoleIds: ['sci_scan'],
    title: 'Planetary Probe Landing',
    quadrantTag: 'USER SEG',
  },
  {
    id: 'm_sci_nav',
    game: 'nav',
    role: 'science',
    consoleIds: ['sat_ctrl_2'],
    title: 'Hohmann Orbital Navigation SAT-02',
    quadrantTag: 'USER SEG',
  },
  {
    id: 'm_sci_spectro',
    game: 'spectro',
    role: 'science',
    consoleIds: ['sci_lab'],
    title: 'Glacial Mass Spectrometry',
    quadrantTag: 'LABORATORY',
  },
  {
    id: 'm_sci_thermal',
    game: 'thermal',
    role: 'science',
    consoleIds: ['sci_thermal'],
    title: 'Multispectral IR/UV Telemetry',
    quadrantTag: 'LAUNCH LAB',
  },
  // 🐍 SERPIENTE-2 (4)
  {
    id: 'm_com_telecom',
    game: 'telecom',
    role: 'comms',
    consoleIds: ['com_tx'],
    title: 'Telecom & DSN Link Repair',
    quadrantTag: 'COMMS DSN',
  },
  {
    id: 'm_com_cyber',
    game: 'cyber',
    role: 'comms',
    consoleIds: ['sat_ctrl_1'],
    title: 'Port 8080 Firewall Defense',
    quadrantTag: 'SPACE SEG',
  },
  {
    id: 'm_com_hga',
    game: 'hga',
    role: 'comms',
    consoleIds: ['com_hga'],
    title: 'DSN High-Gain Antenna Alignment',
    quadrantTag: 'COMMS HGA',
  },
  {
    id: 'm_com_decrypt',
    game: 'decrypt',
    role: 'comms',
    consoleIds: ['com_decrypt'],
    title: 'Quantum CRC Decryption',
    quadrantTag: 'SPACE CRC',
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
    x: 1104,
    y: 692,
    neighbors: ['j_west', 'j_north', 'j_ground_ne', 'j_ground_sw'],
  },
  j_ground_ne: {
    id: 'j_ground_ne',
    x: 1324,
    y: 656,
    neighbors: ['ground_segment', 'j_east_lab', 'j_ground_se'],
  },
  j_ground_se: {
    id: 'j_ground_se',
    x: 1324,
    y: 880,
    neighbors: ['j_ground_ne', 'j_east_pwr', 'j_ground_s'],
  },
  j_ground_sw: {
    id: 'j_ground_sw',
    x: 1068,
    y: 874,
    neighbors: ['ground_segment', 'j_west', 'j_ground_s'],
  },
  j_ground_s: {
    id: 'j_ground_s',
    x: 1184,
    y: 888,
    neighbors: ['j_ground_sw', 'j_ground_se', 'j_south'],
  },
  j_west: {
    id: 'j_west',
    x: 800,
    y: 720,
    neighbors: ['ground_segment', 'j_ground_sw', 'launch_segment'],
  },
  launch_segment: {
    id: 'launch_segment',
    x: 608,
    y: 720,
    neighbors: ['j_west', 'j_launch_south'],
  },
  j_launch_south: {
    id: 'j_launch_south',
    x: 480,
    y: 804,
    neighbors: ['launch_segment', 'j_engine'],
  },
  j_engine: {
    id: 'j_engine',
    x: 480,
    y: 992,
    neighbors: ['j_launch_south', 'j_engine_entry'],
  },
  j_engine_entry: {
    id: 'j_engine_entry',
    x: 548,
    y: 1116,
    neighbors: ['j_engine', 'engine_room'],
  },
  engine_room: {
    id: 'engine_room',
    x: 548,
    y: 1200,
    neighbors: ['j_engine_entry'],
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
    y: 266,
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
    neighbors: ['j_ground_ne', 'laboratory'],
  },
  laboratory: {
    id: 'laboratory',
    x: 1784,
    y: 616,
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
    neighbors: ['j_ground_se', 'j_pwr_nw'],
  },
  j_pwr_nw: {
    id: 'j_pwr_nw',
    x: 1648,
    y: 880,
    neighbors: ['j_east_pwr', 'j_pwr_sw'],
  },
  j_pwr_sw: {
    id: 'j_pwr_sw',
    x: 1648,
    y: 1082,
    neighbors: ['j_pwr_nw', 'power_reactor', 'j_eng_link'],
  },
  power_reactor: {
    id: 'power_reactor',
    x: 1836,
    y: 1004,
    neighbors: ['j_pwr_sw'],
  },
  j_eng_link: {
    id: 'j_eng_link',
    x: 1648,
    y: 1232,
    neighbors: ['j_pwr_sw', 'life_electrical'],
  },
  j_south: {
    id: 'j_south',
    x: 1184,
    y: 1000,
    neighbors: ['j_ground_s', 'life_electrical'],
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
  if (
    startRoom &&
    (!endRoom || startRoom.id !== endRoom.id) &&
    NAV_NODES[startId] &&
    Math.hypot(NAV_NODES[startId].x - sx, NAV_NODES[startId].y - sy) > 36
  ) {
    waypoints.push({ x: NAV_NODES[startId].x, y: NAV_NODES[startId].y })
  }
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

  // En vista mapa completo, etiqueta nítida con contorno 2px centrada en el interior del piso de cada sala
  if (overviewMode) {
    ctx.save()
    ctx.font = 'bold 15px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    const tx = Math.round(rm.floor.x + rm.floor.w * (rm.id === 'engine_room' ? 0.56 : 0.5))
    const ty = Math.round(rm.floor.y + Math.min(72, Math.max(28, rm.floor.h * 0.24)))
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
    activeThreats: ActiveThreat[]
    completedMinigames: Set<MinigameId>
    consoleCooldowns: Partial<Record<MinigameId, number>>
    serverNowMs: number
    missionCompleted: boolean
    missionGames: Set<MinigameId>
    doorOpenMap: Record<string, number>
    activePlayerPos: { x: number; y: number }
    astronauts: Record<RoleId, AstronautEntity>
  }
) {
  const threatMap = new Map(state.activeThreats.map((t) => [t.game, t]))
  const isEclipseActive = state.activeEvent === 'eclipse' || threatMap.has('eps')
  const activeRoom = findRoomAtPoint(state.activePlayerPos.x, state.activePlayerPos.y)
  const activeCorridor = findCorridorAtPoint(state.activePlayerPos.x, state.activePlayerPos.y)
  const depthItems: { sortY: number; draw: () => void }[] = []
  const pushDepth = (sortY: number, draw: () => void) => {
    depthItems.push({ sortY, draw })
  }

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
        ctx.fillStyle = isEclipseActive
          ? '#172554'
          : shimmer
          ? '#3b82f6'
          : '#1d4ed8'
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
    const navThreat = threatMap.has('nav')
    const sat2DriftRx = navThreat ? orx + 125 + Math.sin(time * 2.4) * 32 : orx
    const sat2DriftRy = navThreat ? ory + 78 + Math.cos(time * 2.0) * 24 : ory

    ctx.save()
    ctx.strokeStyle = navThreat ? 'rgba(248, 113, 113, 0.35)' : 'rgba(125, 211, 252, 0.2)'
    ctx.lineWidth = 2
    ctx.setLineDash([14, 12])
    ctx.beginPath()
    ctx.ellipse(ocx, ocy, orx, ory, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    // SAT-01 nace en el lado occidental (izquierda); SAT-02 en el oriental (derecha)
    const sat1 = { x: ocx - Math.cos(angleSat1) * orx, y: ocy - Math.sin(angleSat1) * ory }
    const sat2 = {
      x: ocx - Math.cos(angleSat2) * sat2DriftRx,
      y: ocy - Math.sin(angleSat2) * sat2DriftRy,
    }

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
      // Haz láser escaneando el planeta (verde nominal, naranja parpadeante si SAT-02 deriva)
      const sat2OffOrbit = threatMap.has('nav')
      const flick = 0.55 + 0.45 * Math.abs(Math.sin(time * 9))
      ctx.strokeStyle = sat2OffOrbit
        ? `rgba(248, 113, 113, ${flick.toFixed(2)})`
        : `rgba(74, 222, 128, ${flick.toFixed(2)})`
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(36, 0)
      ctx.lineTo(sat2OffOrbit ? 165 : 260, Math.sin(time * (sat2OffOrbit ? 7 : 2)) * 28)
      ctx.stroke()
      ctx.fillStyle = sat2OffOrbit ? '#fca5a5' : '#bbf7d0'
      ctx.fillRect(sat2OffOrbit ? 162 : 256, Math.sin(time * (sat2OffOrbit ? 7 : 2)) * 28 - 3, 6, 6)
      ctx.restore()

      ctx.save()
      ctx.font = 'bold 10px "Press Start 2P", monospace'
      ctx.textAlign = 'center'
      const t2 = sat2OffOrbit ? 'SAT-02 INTI-SCIENCE [DRIFT!]' : 'SAT-02 INTI-SCIENCE'
      const w2 = ctx.measureText(t2).width + 12
      ctx.fillStyle = sat2OffOrbit ? 'rgba(69, 10, 10, 0.92)' : 'rgba(9, 13, 26, 0.85)'
      ctx.fillRect(sat2.x - w2 / 2, sat2.y + 78, w2, 18)
      ctx.fillStyle = sat2OffOrbit ? '#fca5a5' : '#67e8f9'
      ctx.fillText(t2, sat2.x, sat2.y + 91)
      ctx.restore()
    }
  }

  // 3c. EFECTOS EXTERIORES EN TIEMPO REAL DE AMENAZAS (METEORITOS / CÁPSULA DERIVA)
  if (threatMap.has('comet')) {
    for (let m = 0; m < 7; m++) {
      const spd = 280 + (m % 3) * 110
      const spanW = WORLD_W + 600
      const mx = WORLD_W + 300 - ((time * spd + m * 410) % spanW)
      const my = 90 + ((m * 235 + time * 75) % (WORLD_H - 180))
      ctx.save()
      ctx.fillStyle = 'rgba(249, 115, 22, 0.45)'
      ctx.fillRect(mx + 12, my - 4, 34, 8)
      ctx.fillStyle = 'rgba(253, 224, 71, 0.7)'
      ctx.fillRect(mx + 6, my - 2, 18, 4)
      ctx.fillStyle = '#475569'
      ctx.fillRect(mx - 10, my - 10, 20, 20)
      ctx.fillStyle = '#94a3b8'
      ctx.fillRect(mx - 7, my - 7, 14, 12)
      ctx.fillStyle = '#f97316'
      ctx.fillRect(mx - 5, my - 3, 5, 5)
      ctx.restore()
    }
  }

  if (threatMap.has('dock')) {
    const capX = 195 + Math.sin(time * 1.15) * 32
    const capY = 665 + Math.cos(time * 0.95) * 26
    ctx.save()
    ctx.translate(capX, capY)
    ctx.rotate(Math.sin(time * 1.4) * 0.22)
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(-30, -18, 60, 36)
    ctx.fillStyle = '#e2e8f0'
    ctx.fillRect(-26, -15, 52, 30)
    ctx.fillStyle = '#f97316'
    ctx.fillRect(14, -12, 10, 24)
    if (Math.sin(time * 12) > 0) {
      ctx.fillStyle = '#fde047'
      ctx.fillRect(-38, -6, 8, 5)
      ctx.fillRect(-38, 2, 8, 5)
    }
    ctx.restore()
    ctx.save()
    ctx.font = 'bold 8px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(69, 10, 10, 0.9)'
    ctx.fillRect(capX - 58, capY + 26, 116, 15)
    ctx.fillStyle = '#fde047'
    ctx.fillText('DRIFTING CAPSULE', capX, capY + 37)
    ctx.restore()
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
  // 7. OBJETOS INTERIORES EN PIXEL-ART DETALLADO + SOMBRAS + Y-SORTING (LAS 9 SALAS)
  // ==========================================================================

  // Sombras elípticas suaves en el suelo debajo de cada obstáculo y de los 4 personajes
  for (const ob of SOLID_OBSTACLES) {
    drawObstacleFloorShadow(ctx, ob)
  }
  ctx.save()
  ctx.fillStyle = 'rgba(2, 5, 14, 0.44)'
  ctx.beginPath()
  ctx.ellipse(438, 696, 98, 46, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  for (const r of ROLE_ORDER) {
    const a = state.astronauts[r]
    const info = ROLE_INFO[r]
    const isMe = r === state.activeRole
    ctx.save()
    ctx.fillStyle = 'rgba(2, 5, 14, 0.46)'
    ctx.beginPath()
    ctx.ellipse(a.x, a.y + 18, isMe ? 18 : 14, isMe ? 7 : 5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = info.color
    ctx.lineWidth = isMe ? 3 : 1.5
    ctx.globalAlpha = isMe ? 0.95 : 0.45
    ctx.beginPath()
    ctx.ellipse(a.x, a.y + 18, isMe ? 20 : 16, isMe ? 8 : 6, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    pushDepth(a.y + 16, () => {
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
    })
  }

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
    pushDepth(660, () => drawServerRack(932, 584, 38, 76, 1))
    pushDepth(894, () => drawServerRack(932, 780, 38, 114, 2))
    pushDepth(820, () => drawServerRack(1394, 686, 38, 134, 3))

    // Proyector Holográfico Octogonal Superior (1184, 628) + Mapa Isométrico nítido flotante
    const hx = 1184
    const hy = 628
    pushDepth(646, () => {
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

      const scanLineY = hy - 80 + ((time * 30) % 68)
      ctx.fillStyle = 'rgba(224, 242, 254, 0.45)'
      ctx.fillRect(hx - 42, Math.round(scanLineY), 84, 1.5)
      ctx.restore()
    })

    // Anillo Central Octogonal de Consolas (escritorio biselado, monitores onda/radar, teclados y sillas)
    const ringX = 1184
    const ringY = 796

    // Plataforma circular de piso y anillo de mamparo en GROUND SEGMENT
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

    ctx.strokeStyle = '#384252'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(1184, 720, 260, Math.PI * 1.16, Math.PI * 1.84)
    ctx.stroke()

    pushDepth(ringY + 62, () => {
      const chairAngles = [
        -Math.PI * 0.84,
        -Math.PI * 0.16,
        Math.PI * 0.14,
        Math.PI * 0.39,
        Math.PI * 0.61,
        Math.PI * 0.86,
      ]
      for (const ang of chairAngles) {
        const chx = Math.round(ringX + Math.cos(ang) * 86)
        const chy = Math.round(ringY + Math.sin(ang) * 62)
        ctx.save()
        ctx.translate(chx, chy)
        ctx.rotate(ang + Math.PI / 2)
        ctx.fillStyle = '#070b12'
        ctx.fillRect(-13, -10, 26, 20)
        ctx.fillStyle = '#252c37'
        ctx.fillRect(-11, -8, 22, 14)
        ctx.fillStyle = '#384252'
        ctx.fillRect(-9, -7, 18, 9)
        ctx.fillStyle = '#64748b'
        ctx.fillRect(-12, -6, 3, 11)
        ctx.fillRect(9, -6, 3, 11)
        ctx.fillStyle = '#475569'
        ctx.fillRect(-10, 4, 20, 5)
        ctx.fillStyle = '#38bdf8'
        ctx.fillRect(-7, 6, 14, 2)
        ctx.restore()
      }

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
    })

    // Mobiliario temático del Director (estantería NASA, silla de mando, monitor orbital)
    const atlasGround = getStationSpriteAtlas()
    if (atlasGround) {
      pushDepth(618, () => drawAtlasSprite(ctx, atlasGround.furniture.nasaBookshelf, 988, 574))
      pushDepth(924, () => drawAtlasSprite(ctx, atlasGround.furniture.secondaryOrbitalMonitor, 978, 888))
      pushDepth(924, () => drawAtlasSprite(ctx, atlasGround.furniture.commanderChair, 1024, 890))
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

    pushDepth(750, () => {
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
    })

    // 2 Cápsulas cian superiores con tapas metálicas atornilladas y brillo cilíndrico
    pushDepth(594, () => {
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
    })

    // 2 Tanques grises inferiores con manómetro, válvulas y franjas
    pushDepth(872, () => {
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
    })

    // Brazo robótico hidráulico naranja articulado con pistón cromado y garra
    const armRot = Math.sin(time * 1.8) * 0.24
    pushDepth(846, () => {
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
    })

    // Simulador APAS + manuales de vuelo en Hangar (CÓNDOR-4)
    const atlasLaunch = getStationSpriteAtlas()
    if (atlasLaunch) {
      pushDepth(558, () => drawAtlasSprite(ctx, atlasLaunch.furniture.dockingSimulator, 224, 514))
      pushDepth(560, () => drawAtlasSprite(ctx, atlasLaunch.furniture.nasaBookshelf, 516, 516))
    }
  }

  // --------------------------------------------------------------------------
  // c) ENGINE ROOM (Turbina horizontal pesada con aletas, plasma y tobera Mach)
  // --------------------------------------------------------------------------
  {
    pushDepth(1258, () => {
      ctx.fillStyle = '#070b12'
      ctx.beginPath()
      ctx.moveTo(226, 1170)
      ctx.lineTo(162, 1138)
      ctx.lineTo(162, 1272)
      ctx.lineTo(226, 1240)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#1e293b'
      ctx.beginPath()
      ctx.moveTo(224, 1173)
      ctx.lineTo(164, 1141)
      ctx.lineTo(164, 1269)
      ctx.lineTo(224, 1237)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = 2
      ctx.stroke()

      const flameLen = 36 + Math.sin(time * 18) * 14
      ctx.fillStyle = 'rgba(14, 165, 233, 0.45)'
      ctx.beginPath()
      ctx.moveTo(164, 1151)
      ctx.lineTo(164 - flameLen * 1.25, 1205)
      ctx.lineTo(164, 1259)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(186, 230, 253, 0.85)'
      ctx.beginPath()
      ctx.moveTo(164, 1173)
      ctx.lineTo(164 - flameLen * 0.75, 1205)
      ctx.lineTo(164, 1237)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#070b12'
      ctx.fillRect(264, 1148, 256, 110)
      ctx.fillStyle = '#334155'
      ctx.fillRect(266, 1150, 252, 106)
      ctx.fillStyle = '#475569'
      ctx.fillRect(282, 1164, 220, 78)
      for (let rx = 300; rx <= 480; rx += 36) {
        ctx.fillStyle = '#161b22'
        ctx.fillRect(rx, 1154, 14, 98)
        ctx.fillStyle = '#64748b'
        ctx.fillRect(rx + 3, 1156, 4, 94)
      }
      const coreGlow = 0.65 + 0.35 * Math.sin(time * 8)
      ctx.fillStyle = `rgba(249, 115, 22, ${coreGlow})`
      ctx.fillRect(312, 1188, 156, 30)
      ctx.fillStyle = '#fef08a'
      ctx.fillRect(320, 1196, 140, 14)
    })

    // Telemetría de empuje en Sala de Motores (CÓNDOR-4)
    const atlasEngine = getStationSpriteAtlas()
    if (atlasEngine) {
      pushDepth(1130, () => drawAtlasSprite(ctx, atlasEngine.furniture.secondaryOrbitalMonitor, 612, 1094))
      pushDepth(1176, () => drawAtlasSprite(ctx, atlasEngine.furniture.commanderChair, 618, 1140))
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
    pushDepth(264, () => {
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
      ctx.strokeStyle = '#67e8f9'
      ctx.beginPath()
      ctx.moveTo(sCx, sCy)
      ctx.lineTo(sCx + Math.cos(time * 2.2) * 26, sCy + Math.sin(time * 2.2) * 15)
      ctx.stroke()

      const cyberHack = threatMap.has('cyber')
      for (let mIdx = 0; mIdx < 6; mIdx++) {
        const mAng = (mIdx * Math.PI) / 3 - 0.3
        const mx = Math.round(sCx + Math.cos(mAng) * 42)
        const my = Math.round(sCy + Math.sin(mAng) * 25)
        const glitchOn = cyberHack && Math.sin(time * 22 + mIdx * 3) > 0
        const isCyan = mIdx % 2 === 0
        ctx.fillStyle = '#05070d'
        ctx.fillRect(mx - 12, my - 9, 24, 16)
        ctx.fillStyle = glitchOn ? '#450a0a' : isCyan ? '#042f49' : '#032214'
        ctx.fillRect(mx - 10, my - 7, 20, 12)
        ctx.strokeStyle = glitchOn ? '#ef4444' : isCyan ? '#22d3ee' : '#4ade80'
        ctx.lineWidth = 1
        ctx.strokeRect(mx - 10, my - 7, 20, 12)
        ctx.fillStyle = glitchOn ? (mIdx % 2 === 0 ? '#22d3ee' : '#ef4444') : isCyan ? '#67e8f9' : '#4ade80'
        ctx.fillRect(mx - 7, my - 3 + Math.round(Math.sin(time * 5 + mIdx) * 2), 14, 2)
      }
      if (cyberHack) {
        ctx.fillStyle = Math.sin(time * 16) > 0 ? 'rgba(239, 68, 68, 0.22)' : 'rgba(34, 211, 238, 0.22)'
        ctx.fillRect(sCx - 54, sCy - 24, 108, 4)
        ctx.fillRect(sCx - 42, sCy + 14, 84, 3)
        ctx.font = 'bold 7px "Press Start 2P", monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = Math.sin(time * 10) > 0 ? '#ef4444' : '#22d3ee'
        ctx.fillText('PORT 8080 HACK!', sCx, sCy - 40)
      }
    })

    // Estación secundaria / Filtro de Constelación CubeSat en borde derecho (com_filter)
    pushDepth(222, () => {
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
      ctx.fillStyle = '#070b12'
      ctx.fillRect(684, 184, 18, 18)
      ctx.fillStyle = '#334155'
      ctx.fillRect(686, 186, 14, 14)
    })

    // Consola lateral izquierda con silla
    pushDepth(260, () => {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(252, 174, 46, 86)
      ctx.fillStyle = '#2b3444'
      ctx.fillRect(254, 176, 42, 82)
      ctx.fillStyle = '#042f49'
      ctx.fillRect(260, 184, 30, 20)
      ctx.fillStyle = '#031d11'
      ctx.fillRect(260, 214, 30, 20)
      ctx.fillStyle = '#4ade80'
      ctx.fillRect(264, 222, 22, 3)
      ctx.fillStyle = '#22d3ee'
      ctx.fillRect(264, 192, 22, 3)
      ctx.fillStyle = '#070b12'
      ctx.fillRect(298, 202, 16, 18)
      ctx.fillStyle = '#334155'
      ctx.fillRect(300, 204, 12, 14)
    })

    const atlasSpace = getStationSpriteAtlas()
    if (atlasSpace) {
      pushDepth(346, () => drawAtlasSprite(ctx, atlasSpace.furniture.dsnServerRack, 516, 298))
      pushDepth(344, () => drawAtlasSprite(ctx, atlasSpace.furniture.spectrumAnalyzer, 568, 308))
      pushDepth(344, () => drawAtlasSprite(ctx, atlasSpace.furniture.dsnServerRack, 694, 296))
    }

    // ------------------------------------------------------------------------
    // e) COMMUNICATIONS (Puente circular DSN · SERPIENTE-2 con ventanal panorámico gigante y anillo verde/cian)
    // ------------------------------------------------------------------------
    drawPanoramicSat01Window(896, 80, 416, 74)

    const cCx = 1104
    const cCy = 194
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(cCx, cCy, 98, 56, 0, 0, Math.PI * 2)
    ctx.stroke()

    pushDepth(cCy + 42, () => {
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

      const telecomDesync = threatMap.has('telecom')
      for (let cm = 0; cm < 5; cm++) {
        const ang = -Math.PI * 0.88 + cm * (Math.PI * 0.44)
        const mx = Math.round(cCx + Math.cos(ang) * 52)
        const my = Math.round(cCy + Math.sin(ang) * 26)
        const gMon = cm % 2 === 0
        ctx.fillStyle = '#070b12'
        ctx.fillRect(mx - 14, my - 10, 28, 18)
        ctx.fillStyle = telecomDesync ? '#2a0b09' : gMon ? '#032214' : '#042f49'
        ctx.fillRect(mx - 12, my - 8, 24, 14)
        ctx.strokeStyle = telecomDesync ? '#f97316' : gMon ? '#4ade80' : '#22d3ee'
        ctx.strokeRect(mx - 12, my - 8, 24, 14)
        if (telecomDesync) {
          ctx.strokeStyle = cm % 2 === 0 ? '#ef4444' : '#f59e0b'
          ctx.beginPath()
          for (let wx = -10; wx <= 10; wx += 2) {
            const wy = my + Math.sin((wx + time * 14) * 0.7 + cm) * 5
            if (wx === -10) ctx.moveTo(mx + wx, wy)
            else ctx.lineTo(mx + wx, wy)
          }
          ctx.stroke()
        } else {
          ctx.fillStyle = gMon ? '#4ade80' : '#67e8f9'
          for (let b = 0; b < 4; b++) {
            const bh = 3 + Math.round(((Math.sin(time * 5 + b + cm) + 1) / 2) * 7)
            ctx.fillRect(mx - 9 + b * 5, my + 4 - bh, 3, bh)
          }
        }
      }
    })

    const atlasComms = getStationSpriteAtlas()
    if (atlasComms) {
      pushDepth(182, () => drawAtlasSprite(ctx, atlasComms.furniture.dsnServerRack, 898, 134))
      pushDepth(178, () => drawAtlasSprite(ctx, atlasComms.furniture.receiverAntenna, 944, 138))
      pushDepth(174, () => drawAtlasSprite(ctx, atlasComms.furniture.cryptoDevice, 1226, 138))
      pushDepth(182, () => drawAtlasSprite(ctx, atlasComms.furniture.dsnServerRack, 1276, 134))
      pushDepth(336, () => drawAtlasSprite(ctx, atlasComms.furniture.dualSatTrackMonitors, 904, 300))
      pushDepth(340, () => drawAtlasSprite(ctx, atlasComms.furniture.spectrumAnalyzer, 1226, 304))
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
    pushDepth(246, () => {
      drawBioCylinder(1564, 194, 'green', 1)
      drawBioCylinder(1608, 194, 'cyan', 2)
      drawBioCylinder(1652, 194, 'green', 3)
    })

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
    pushDepth(194, () => {
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
    })

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
    pushDepth(280, () => {
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
    })

    // Estantería glaciar e incubadora botánica en los zócalos inferiores de PUMA-3
    const atlasUser = getStationSpriteAtlas()
    if (atlasUser) {
      pushDepth(342, () => drawAtlasSprite(ctx, atlasUser.furniture.botanicalIncubator, 1944, 298))
      pushDepth(342, () => drawAtlasSprite(ctx, atlasUser.furniture.geoGlacierShelf, 1994, 298))
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

    pushDepth(546, () => {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(1618, 486, 118, 60)
      ctx.fillStyle = '#cbd5e1'
      ctx.fillRect(1620, 488, 114, 56)
      ctx.fillStyle = 'rgba(125, 211, 252, 0.35)'
      ctx.fillRect(1628, 498, 98, 36)
      ctx.fillStyle = '#ec4899'
      ctx.fillRect(1642, 516, 14, 14)
      ctx.fillStyle = '#22c55e'
      ctx.fillRect(1670, 514, 14, 16)
      ctx.fillStyle = '#38bdf8'
      ctx.fillRect(1698, 516, 14, 14)
    })

    // Mesa curva científica para sci_lab (1875, 552, despejando puerta Norte)
    pushDepth(574, () => {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(1846, 532, 58, 42)
      ctx.fillStyle = '#334155'
      ctx.fillRect(1848, 534, 54, 38)
      ctx.fillStyle = '#032014'
      ctx.fillRect(1852, 539, 46, 21)
      ctx.strokeStyle = '#55efc4'
      ctx.lineWidth = 1.2
      ctx.strokeRect(1852, 539, 46, 21)
      ctx.fillStyle = '#55efc4'
      for (let dx = 4; dx < 40; dx += 6) {
        const yy = 549 + Math.round(Math.sin(time * 4 + dx * 0.4) * 5)
        ctx.fillRect(1852 + dx, yy, 4, 3)
      }
    })

    pushDepth(620, () => {
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(1912, 558, 96, 62)
      ctx.strokeStyle = '#55efc4'
      ctx.lineWidth = 2
      ctx.strokeRect(1912, 558, 96, 62)
      for (let r = 0; r < 4; r++) {
        ctx.fillStyle = '#1e293b'
        ctx.fillRect(1920, 566 + r * 12, 80, 8)
        ctx.fillStyle = (Math.floor(time * 6) + r) % 2 === 0 ? '#55efc4' : '#0284c7'
        ctx.fillRect(1924, 568 + r * 12, 38, 4)
        ctx.fillStyle = '#fbbf24'
        ctx.fillRect(1988, 568 + r * 12, 6, 4)
      }
    })

    const atlasLab = getStationSpriteAtlas()
    if (atlasLab) {
      drawAtlasSprite(ctx, atlasLab.furniture.scienceWhiteboard, 1768, 464)
      pushDepth(696, () => drawAtlasSprite(ctx, atlasLab.furniture.botanicalIncubator, 1768, 652))
      pushDepth(690, () => drawAtlasSprite(ctx, atlasLab.furniture.geoGlacierShelf, 1922, 646))
    }
  }

  // --------------------------------------------------------------------------
  // h) POWER MGD & REACTOR (Sala ALPACA-1: Reactor abierto vórtice plasma azul/blanco + robot asistente + caja herramientas + estación doble nivel ⚡ + ventana Tierra + 3 vitrinas cristales 98%/97%/99%)
  // --------------------------------------------------------------------------
  {
    // Cables blindados bronce/cobre y cian conectando el Reactor (1712, 972) con la estación de doble nivel (1836, 910)
    ctx.strokeStyle = '#92400e'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(1712, 972)
    ctx.lineTo(1790, 922)
    ctx.stroke()
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(1712, 972)
    ctx.lineTo(1790, 922)
    ctx.stroke()

    // 1) IZQUIERDA: Reactor Circular abierto despejando acceso Oeste (1712, 972, r=46)
    {
      const rx = 1712
      const ry = 972
      pushDepth(1018, () => {
        const halo = ctx.createRadialGradient(rx, ry, 8, rx, ry, 58 + Math.sin(time * 4) * 3)
        halo.addColorStop(0, 'rgba(224, 242, 254, 0.9)')
        halo.addColorStop(0.35, 'rgba(56, 189, 248, 0.55)')
        halo.addColorStop(0.7, 'rgba(234, 88, 12, 0.25)')
        halo.addColorStop(1, 'rgba(15, 23, 42, 0)')
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(rx, ry, 58, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = '#070b12'
        ctx.beginPath()
        ctx.arc(rx, ry, 46, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#78350f'
        ctx.beginPath()
        ctx.arc(rx, ry, 42, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#d97706'
        ctx.lineWidth = 3
        ctx.stroke()
        ctx.fillStyle = '#1e293b'
        ctx.beginPath()
        ctx.arc(rx, ry, 35, 0, Math.PI * 2)
        ctx.fill()

        for (let k = 0; k < 8; k++) {
          const ang = (k * Math.PI) / 4 + 0.12
          ctx.save()
          ctx.translate(rx, ry)
          ctx.rotate(ang)
          ctx.fillStyle = '#070b12'
          ctx.fillRect(24, -6, 16, 12)
          ctx.fillStyle = '#ea580c'
          ctx.fillRect(25, -4, 12, 8)
          ctx.fillStyle = '#fb923c'
          ctx.fillRect(27, -3, 3, 6)
          ctx.fillRect(32, -3, 3, 6)
          ctx.fillStyle = '#94a3b8'
          ctx.fillRect(38, -5, 3, 10)
          ctx.restore()
        }

        ctx.fillStyle = '#041326'
        ctx.beginPath()
        ctx.arc(rx, ry, 25, 0, Math.PI * 2)
        ctx.fill()

        ctx.save()
        ctx.translate(rx, ry)
        ctx.rotate(time * 3.4)
        for (let arm = 0; arm < 4; arm++) {
          ctx.rotate(Math.PI / 2)
          ctx.strokeStyle = arm % 2 === 0 ? '#38bdf8' : '#e0f2fe'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(8, 0, 12, 0, Math.PI * 0.85)
          ctx.stroke()
        }
        ctx.restore()

        const coreR = 9 + Math.sin(time * 8) * 2
        ctx.fillStyle = '#38bdf8'
        ctx.beginPath()
        ctx.arc(rx, ry, coreR + 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(rx, ry, coreR - 2, 0, Math.PI * 2)
        ctx.fill()
      })

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
      pushDepth(996, () => drawReactorSideRack(1604, 944, 52))

      // Pequeño robot asistente blanco/azul con ojo luminoso cian bajo puerta Oeste
      pushDepth(1038, () => {
        const bx = 1621
        const by = 1024 + Math.round(Math.sin(time * 3.5) * 1.5)
        ctx.fillStyle = '#070b12'
        ctx.fillRect(bx - 13, by - 15, 26, 30)
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(bx - 1, by - 21, 2, 6)
        ctx.fillStyle = '#22d3ee'
        ctx.fillRect(bx - 2, by - 23, 4, 3)
        ctx.fillStyle = '#f8fafc'
        ctx.fillRect(bx - 11, by - 13, 22, 22)
        ctx.fillStyle = '#2563eb'
        ctx.fillRect(bx - 11, by - 2, 22, 6)
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(bx - 8, by - 11, 16, 8)
        ctx.fillStyle = Math.sin(time * 5) > -0.7 ? '#22d3ee' : '#a5f3fc'
        ctx.fillRect(bx - 2 + Math.round(Math.sin(time * 1.8) * 3), by - 9, 5, 4)
        ctx.fillStyle = '#334155'
        ctx.fillRect(bx - 12, by + 9, 24, 5)
      })

      // Caja de herramientas abierta roja/acero sin obstruir salida Sur
      pushDepth(1098, () => {
        const tx = 1894
        const ty = 1085
        ctx.fillStyle = '#070b12'
        ctx.fillRect(tx - 18, ty - 14, 36, 26)
        ctx.fillStyle = '#991b1b'
        ctx.fillRect(tx - 16, ty - 12, 32, 9)
        ctx.fillStyle = '#dc2626'
        ctx.fillRect(tx - 16, ty - 3, 32, 13)
        ctx.fillStyle = '#cbd5e1'
        ctx.fillRect(tx - 13, ty - 5, 26, 4)
        ctx.fillStyle = '#facc15'
        ctx.fillRect(tx - 3, ty + 1, 6, 3)

        ctx.fillStyle = '#cbd5e1'
        ctx.fillRect(tx + 20, ty + 6, 12, 4)
        ctx.fillStyle = '#f97316'
        ctx.fillRect(tx - 10, ty + 14, 7, 3)
      })
    }

    // 2) CENTRO: Estación de control de doble nivel con monitores de circuitos verdes y gran rayo ⚡
    {
      const cx = 1836
      const cy = 910
      pushDepth(946, () => {
        ctx.fillStyle = '#070b12'
        ctx.fillRect(cx - 56, cy - 42, 112, 54)
        ctx.fillStyle = '#2c3442'
        ctx.fillRect(cx - 54, cy - 40, 108, 50)
        ctx.strokeStyle = '#d97706'
        ctx.lineWidth = 2
        ctx.strokeRect(cx - 54, cy - 40, 108, 50)

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
      })
    }

    // 3) DERECHA: Arco de ventana con horizonte brillante de la Tierra + debajo 3 vitrinas con cristales de energía cian (98%, 97%, 99%)
    {
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

      pushDepth(968, () => {
        const crystalPcts = ['98%', '97%', '99%']
        for (let cIdx = 0; cIdx < 3; cIdx++) {
          const vx = 1924 + cIdx * 62
          const vy = 886
          ctx.fillStyle = '#070b12'
          ctx.fillRect(vx - 2, vy - 2, 54, 86)
          ctx.fillStyle = '#252c37'
          ctx.fillRect(vx, vy, 50, 82)
          ctx.strokeStyle = '#b45309'
          ctx.lineWidth = 1.5
          ctx.strokeRect(vx, vy, 50, 82)

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
      })
    }

    // Mobiliario complementario industrial ALPACA-1 en la parte baja sin estorbar pasillos ni la salida Sur
    const atlasPower = getStationSpriteAtlas()
    if (atlasPower) {
      pushDepth(1112, () => drawAtlasSprite(ctx, atlasPower.furniture.sparePartsCabinet, 1756, 1068))
      pushDepth(1104, () => drawAtlasSprite(ctx, atlasPower.furniture.auxBatteryBank, 1814, 1072))
      pushDepth(1094, () => drawAtlasSprite(ctx, atlasPower.furniture.oscilloscopeBench, 1936, 1058))
      pushDepth(1088, () => drawAtlasSprite(ctx, atlasPower.furniture.thermalDiagPanel, 2028, 1060))
    }
  }

  // --------------------------------------------------------------------------
  // i) LIFE SUPPORT & ELECTRICAL (Tanques O2 detallados + tuberías + MASTER SWITCH)
  // --------------------------------------------------------------------------
  {
    pushDepth(1216, () => {
      ctx.fillStyle = '#2c343e'
      ctx.fillRect(1240, 1120, 16, 96)
    })
    pushDepth(1408, () => {
      ctx.fillStyle = '#2c343e'
      ctx.fillRect(1240, 1312, 16, 96)
    })

    ctx.fillStyle = '#64748b'
    ctx.fillRect(906, 1116, 176, 10)
    ctx.fillRect(940, 1116, 10, 24)
    ctx.fillRect(1008, 1116, 10, 24)
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(906, 1118, 176, 4)

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
    pushDepth(1238, () => {
      drawDetailedO2Tank(918, 1138)
      drawDetailedO2Tank(986, 1138)
    })

    pushDepth(1236, () => {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(1054, 1130, 56, 106)
      ctx.fillStyle = '#334155'
      ctx.fillRect(1056, 1132, 52, 12)
      ctx.fillRect(1056, 1222, 52, 12)
      ctx.fillStyle = '#16a34a'
      ctx.fillRect(1062, 1144, 40, 78)
      ctx.fillStyle = '#22c55e'
      ctx.fillRect(1066, 1146, 30, 74)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
      ctx.fillRect(1067, 1148, 5, 70)
      for (let b = 0; b < 4; b++) {
        const by = 1212 - ((time * 26 + b * 15) % 60)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(1074 + b * 6, by, 3, 3)
      }
    })

    pushDepth(1224, () => {
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
      ctx.fillText('MASTER SWITCH', 1385, 1148)
      ctx.fillStyle = '#fde047'
      ctx.fillText('MASTER SWITCH', 1384, 1147)
    })

    // Etiquetas claras de subdivisión Oeste (LIFE SUPPORT) vs Este (ELECTRICAL) centradas en piso interior + mobiliario
    const atlasSplit = getStationSpriteAtlas()
    if (atlasSplit) {
      pushDepth(1376, () => drawAtlasSprite(ctx, atlasSplit.furniture.botanicalIncubator, 908, 1332))
      pushDepth(1376, () => drawAtlasSprite(ctx, atlasSplit.furniture.geoGlacierShelf, 1134, 1332))
      pushDepth(1376, () => drawAtlasSprite(ctx, atlasSplit.furniture.sparePartsCabinet, 1278, 1332))
      pushDepth(1376, () => drawAtlasSprite(ctx, atlasSplit.furniture.techBunk, 1416, 1340))
    }
    ctx.font = 'bold 7px "Press Start 2P", monospace'
    ctx.fillStyle = '#000000'
    ctx.fillText('LIFE SUPPORT (ALPACA-1)', 1079, 1296)
    ctx.fillText('ELECTRICAL (ALPACA-1)', 1375, 1296)
    ctx.fillStyle = '#55efc4'
    ctx.fillText('LIFE SUPPORT (ALPACA-1)', 1078, 1295)
    ctx.fillStyle = '#ff9f43'
    ctx.fillText('ELECTRICAL (ALPACA-1)', 1374, 1295)

    // Neblina ámbar parpadeante y alerta CO2 en LIFE SUPPORT cuando está activo soporte_vital
    if (threatMap.has('eclss')) {
      const hazeAlpha = 0.14 + 0.12 * Math.abs(Math.sin(time * 4.5))
      ctx.fillStyle = `rgba(245, 158, 11, ${hazeAlpha.toFixed(2)})`
      ctx.fillRect(898, 1122, 344, 284)
      ctx.font = 'bold 8px "Press Start 2P", monospace'
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(42, 18, 4, 0.92)'
      ctx.fillRect(962, 1104, 128, 16)
      ctx.fillStyle = '#fbbf24'
      ctx.fillText('CO2 ↑ O2 -1.5%/s', 1026, 1116)
    }
  }

  // Telemetría de descenso de Sonda en USER SEGMENT cuando está activo aterrizaje_planetario
  const landerThreatWorld = threatMap.get('lander')
  if (landerThreatWorld) {
    const lx = 1744
    const ly = 136
    const altFrac = clamp(landerThreatWorld.probeAlt / 500, 0, 1)
    ctx.fillStyle = 'rgba(4, 12, 24, 0.92)'
    ctx.fillRect(lx - 42, ly - 18, 84, 22)
    ctx.strokeStyle = landerThreatWorld.probeAlt < 160 ? '#ef4444' : '#38bdf8'
    ctx.lineWidth = 1.5
    ctx.strokeRect(lx - 42, ly - 18, 84, 22)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(lx - 36, ly - 3, 72, 4)
    ctx.fillStyle = landerThreatWorld.probeAlt < 160 ? '#ef4444' : '#22c55e'
    ctx.fillRect(lx - 36, ly - 3, Math.round(72 * altFrac), 4)
    ctx.font = 'bold 7px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = landerThreatWorld.probeAlt < 160 ? '#fca5a5' : '#7dd3fc'
    ctx.fillText(`ALT ${Math.round(landerThreatWorld.probeAlt)}m ↓`, lx, ly - 7)
  }

  // Atenuación de luces interiores durante eclipse solar (la sala activa del jugador mantiene iluminación legible)
  if (isEclipseActive) {
    for (const rm of STATION_ROOMS) {
      if (rm.id === activeRoom?.id) continue
      ctx.fillStyle = 'rgba(4, 9, 28, 0.34)'
      ctx.fillRect(rm.floor.x, rm.floor.y, rm.floor.w, rm.floor.h)
    }
  }

  // ==========================================================================
  // 7b. CENTROS DE CONTROL SATELITAL (conectados en vivo a SAT-01 y SAT-02)
  // ==========================================================================
  {
    const linkBlink = Math.sin(time * 5) > 0

    // ---- Centro 1 · SPACE SEGMENT: estación de mando doble, hologramas dorados y teclados LED (SAT-01)
    pushDepth(318, () => {
      const cx = 362
      const cy = 286
      ctx.fillStyle = '#05070d'
      ctx.fillRect(cx - 64, cy - 2, 128, 34)
      ctx.fillStyle = '#334155'
      ctx.fillRect(cx - 62, cy, 124, 30)
      ctx.fillStyle = '#d4a017'
      ctx.fillRect(cx - 62, cy, 124, 3)
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
    })

    // ---- Centro 2 · USER SEGMENT: pantallas duales, radar y teclado LED (SAT-02, despejando puerta Sur)
    pushDepth(328, () => {
      const cx = 1628
      const cy = 298
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
    })
  }

  // Renderizado unificado Y-Sorting (muebles, máquinas, transbordador, reactor y los 4 especialistas)
  depthItems.sort((a, b) => a.sortY - b.sortY)
  for (const item of depthItems) {
    item.draw()
  }

  // 7c. ILUMINACIÓN AUTOMÁTICA AL CAMINAR (sala/pasillo visitado 100% a color; salas lejanas en penumbra suave)
  if (!state.overviewMode) {
    for (const rm of STATION_ROOMS) {
      if (rm.id === activeRoom?.id) {
        // Realce cálido de iluminación activa en la sala donde está parado el personaje
        ctx.save()
        ctx.strokeStyle = rm.color
        ctx.globalAlpha = 0.42
        ctx.lineWidth = 2.5
        traceOctagonPath(ctx, rm.hull.x + 15, rm.hull.y + 15, rm.hull.w - 30, rm.hull.h - 30, 30)
        ctx.stroke()
        ctx.restore()
      } else {
        ctx.save()
        ctx.fillStyle = 'rgba(3, 6, 16, 0.42)'
        traceOctagonPath(ctx, rm.hull.x + 15, rm.hull.y + 15, rm.hull.w - 30, rm.hull.h - 30, 30)
        ctx.fill()
        ctx.restore()
      }
    }

    for (const cor of CORRIDORS) {
      const cx = cor.rect.x + cor.rect.w / 2
      const cy = cor.rect.y + cor.rect.h / 2
      const nearCor =
        activeCorridor?.id === cor.id ||
        Math.hypot(state.activePlayerPos.x - cx, state.activePlayerPos.y - cy) < 135
      if (!nearCor) {
        ctx.fillStyle = 'rgba(3, 6, 16, 0.36)'
        ctx.fillRect(cor.rect.x, cor.rect.y, cor.rect.w, cor.rect.h)
      }
    }
  }

  // 8. PUERTAS CORREDIZAS AUTOMÁTICAS EN TODAS LAS ÁREAS (se abren por completo al paso de cualquiera)
  for (const door of SLIDING_DOORS) {
    const openAmt = clamp(state.doorOpenMap[door.id] ?? 0, 0, 1)
    const half = door.size / 2
    const gap = openAmt * (half - 2)
    const leafLen = Math.max(0, half - gap)
    const sensorGreen = openAmt > 0.25 ? '#4ade80' : '#22c55e'

    if (door.orientation === 'vertical') {
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(door.x - 8, door.y - half - 4, 16, 6)
      ctx.fillRect(door.x - 8, door.y + half - 2, 16, 6)
      ctx.fillStyle = sensorGreen
      ctx.fillRect(door.x - 2, door.y - half - 2, 4, 3)
      ctx.fillRect(door.x - 2, door.y + half - 1, 4, 3)
      if (leafLen > 1) {
        ctx.fillStyle = '#475569'
        ctx.fillRect(door.x - 6, door.y - half, 12, leafLen)
        ctx.fillRect(door.x - 6, door.y + gap, 12, leafLen)
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(door.x - 3, door.y - half + 2, 6, Math.max(1, leafLen - 4))
        ctx.fillRect(door.x - 3, door.y + gap + 2, 6, Math.max(1, leafLen - 4))
      }
    } else {
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(door.x - half - 4, door.y - 8, 6, 16)
      ctx.fillRect(door.x + half - 2, door.y - 8, 6, 16)
      ctx.fillStyle = sensorGreen
      ctx.fillRect(door.x - half - 2, door.y - 2, 3, 4)
      ctx.fillRect(door.x + half - 1, door.y - 2, 3, 4)
      if (leafLen > 1) {
        ctx.fillStyle = '#475569'
        ctx.fillRect(door.x - half, door.y - 6, leafLen, 12)
        ctx.fillRect(door.x + gap, door.y - 6, leafLen, 12)
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(door.x - half + 2, door.y - 3, Math.max(1, leafLen - 4), 6)
        ctx.fillRect(door.x + gap + 2, door.y - 3, Math.max(1, leafLen - 4), 6)
      }
    }
  }

  // 9. BALIZAS DE TRANSICIÓN ENTRE SECTORES (paso 100% libre, cero láseres bloqueantes)
  for (const gate of SECTOR_THRESHOLDS) {
    const ownerInfo = ROLE_INFO[gate.owner]
    const half = gate.size / 2

    ctx.fillStyle = '#1e293b'
    if (gate.orientation === 'vertical') {
      ctx.fillRect(gate.x - 8, gate.y - half - 6, 16, 10)
      ctx.fillRect(gate.x - 8, gate.y + half - 4, 16, 10)
      ctx.fillStyle = '#4ade80'
      ctx.fillRect(gate.x - 2, gate.y - half - 2, 4, 4)
      ctx.fillRect(gate.x - 2, gate.y + half - 2, 4, 4)
      ctx.fillStyle = ownerInfo.color
      ctx.fillRect(gate.x - 1, gate.y - 4, 2, 8)
    } else {
      ctx.fillRect(gate.x - half - 6, gate.y - 8, 10, 16)
      ctx.fillRect(gate.x + half - 4, gate.y - 8, 10, 16)
      ctx.fillStyle = '#4ade80'
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
    const roleColor = ROLE_INFO[c.role].color
    const pulse = 0.5 + 0.5 * Math.sin(time * 6)
    const mg = CONSOLE_MINIGAME[c.id]
    const inStage = mg ? state.missionGames.has(mg) : false
    const cdExp = mg ? state.consoleCooldowns[mg] : undefined
    const isInCooldown = Boolean(
      mg && inStage && !state.missionCompleted && typeof cdExp === 'number' && cdExp > state.serverNowMs
    )
    const cooldownSecLeft =
      isInCooldown && typeof cdExp === 'number'
        ? Math.max(1, Math.ceil((cdExp - state.serverNowMs) / 1000))
        : 0
    const isSolved = Boolean(
      mg && inStage && (isInCooldown || (state.missionCompleted && state.completedMinigames.has(mg)))
    )
    const liveThreat = inStage && !isInCooldown && !state.missionCompleted && mg ? threatMap.get(mg) : undefined
    const hasMyActiveTask =
      isMyRole &&
      inStage &&
      !isInCooldown &&
      !state.missionCompleted &&
      (Boolean(liveThreat) || state.activeTaskConsoleIds.has(c.id))

    ctx.save()
    // Aura interactiva en el suelo para distinguir terminales estabilizadas, en emergencia de TU rol y disponibles
    ctx.strokeStyle = !isMyRole && isNearOrHovered
      ? '#f87171'
      : isSolved
      ? '#22c55e'
      : !inStage
      ? '#64748b'
      : hasMyActiveTask
      ? '#fde047'
      : isNearOrHovered
      ? '#ffffff'
      : roleColor
    ctx.lineWidth = hasMyActiveTask || isNearOrHovered ? 3.5 : 2
    ctx.globalAlpha = !inStage
      ? isNearOrHovered
        ? 0.72
        : 0.25
      : isSolved
      ? isNearOrHovered
        ? 0.9
        : 0.55
      : isMyRole
      ? hasMyActiveTask || isNearOrHovered
        ? 0.95
        : 0.62
      : isNearOrHovered
      ? 0.9
      : 0.34
    ctx.beginPath()
    ctx.ellipse(
      c.standX,
      c.standY + 12,
      hasMyActiveTask || isNearOrHovered ? 24 + pulse * 4 : 18,
      hasMyActiveTask || isNearOrHovered ? 11 + pulse * 2 : 8,
      0,
      0,
      Math.PI * 2
    )
    ctx.stroke()

    ctx.globalAlpha = inStage ? 1 : 0.62
    // Placa pixel-art interactiva del Atlas diferenciada del mobiliario
    if (interactiveAtlas) {
      const badgeSprite =
        mg === 'dock' || mg === 'comet' || mg === 'debris'
          ? interactiveAtlas.apasRadarBadge
          : mg === 'eps' || mg === 'pcb'
          ? interactiveAtlas.epsPanelBadge
          : mg === 'eclss' || mg === 'reactor' || mg === 'lander'
          ? interactiveAtlas.eclssConsoleBadge
          : c.id.startsWith('sat_ctrl') || mg === 'telecom' || mg === 'hga' || mg === 'decrypt'
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

    // Indicador verde cuando la consola está en enfriamiento temporal o etapa completada ✅
    if (isSolved) {
      const solvedLabel = isInCooldown
        ? `🟢 STABILIZED · ${cooldownSecLeft}s`
        : '✅ COMPLETED'
      ctx.font = 'bold 6px "Press Start 2P", monospace'
      const gw = Math.max(64, Math.ceil(ctx.measureText(solvedLabel).width + 10))
      const gx = Math.round(c.x - gw / 2)
      const gy = Math.round(c.y - 42)
      ctx.fillStyle = '#022c22'
      ctx.fillRect(gx, gy, gw, 14)
      ctx.strokeStyle = '#22c55e'
      ctx.lineWidth = 1.5
      ctx.strokeRect(gx, gy, gw, 14)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#4ade80'
      ctx.fillText(solvedLabel, Math.round(c.x), gy + 10)
    } else if (isMyRole && inStage && (hasMyActiveTask || isNearOrHovered)) {
      // Indicador pixel-art "!" amarillo/rojo rebotando SOLO en consolas del propio rol del jugador
      const bx = Math.round(c.x - 16)
      const by = Math.round(c.y - 54 + bounce)
      ctx.fillStyle = '#000000'
      ctx.fillRect(bx - 3, by - 3, 38, 38)
      ctx.fillStyle = hasMyActiveTask && Math.sin(time * 10) > 0 ? '#ef4444' : '#f59e0b'
      ctx.fillRect(bx, by, 32, 32)
      ctx.fillStyle = '#fde047'
      ctx.fillRect(bx + 4, by + 4, 24, 24)
      ctx.fillStyle = '#000000'
      ctx.fillRect(bx + 13, by + 6, 6, 13)
      ctx.fillRect(bx + 13, by + 21, 6, 5)

      // Barra de urgencia en vivo sobre la consola amenazada del jugador activo
      if (liveThreat && c.id === liveThreat.consoleId) {
        const ux = Math.round(c.x - 26)
        const uy = by - 12
        const frac = clamp(liveThreat.urgency / 100, 0.08, 1)
        ctx.fillStyle = '#050814'
        ctx.fillRect(ux, uy, 52, 8)
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 1
        ctx.strokeRect(ux, uy, 52, 8)
        ctx.fillStyle = liveThreat.urgency > 65 ? '#ef4444' : '#f59e0b'
        ctx.fillRect(ux + 2, uy + 2, Math.round(48 * frac), 4)
      }
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
interface RoleClaimEntry {
  clientId: string
  playerName: string
  timestamp: number
}

type RoleClaimsMap = Partial<Record<RoleId, RoleClaimEntry>>

interface RemotePlayerState {
  clientId: string
  playerName?: string
  x: number
  y: number
  dir: FacingDir
  walkFrame: number
  isInteracting: boolean
  currentRoom: string
  lastSeen: number
}

type RemotePlayersMap = Partial<Record<RoleId, RemotePlayerState>>

interface SharedStationStats {
  battery: number
  lifeSupport: number
  dataBuffer: number
  orbitStability: number
  hull: number
  signalQuality: number
}

interface SharedStationSnapshot {
  completedMinigames: string[]
  resolvedCount?: number
  roleResolvedCounts?: Partial<Record<RoleId, number>>
  consoleCooldowns?: Record<string, number>
  attemptCounts?: Record<string, number>
  activeThreats: ActiveThreat[]
  stats: Partial<SharedStationStats>
  stationHealth?: number
  isGameOver?: boolean
  gameOverReason?: string
  retryEpoch?: number
  points: number
  lastUpdated: number
}

const ROLES_SYNC_CHANNEL = 'squadron-roles-sync'

function getOrCreateClientId(): string {
  const key = 'squadron_client_id_v1'
  try {
    const existing = window.localStorage.getItem(key) || window.sessionStorage.getItem(key)
    if (existing) {
      window.localStorage.setItem(key, existing)
      return existing
    }
    const uuid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(key, uuid)
    window.sessionStorage.setItem(key, uuid)
    return uuid
  } catch {
    return `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

function getDefaultPlayerName(clientId: string): string {
  try {
    const saved =
      window.localStorage.getItem('squadron_player_name_v1') ||
      window.sessionStorage.getItem('squadron_player_name_v1')
    if (saved && saved.trim()) return saved.trim().slice(0, 18)
  } catch {
    // ignorar errores de almacenamiento
  }
  return `OPERATOR-${clientId.slice(-4).toUpperCase()}`
}

export default function StationOperationScreen({
  onBackToWorkshop,
  onOpenTelemetryReport,
  onExitToMenu,
  onRoomClosed,
  onRoomUpdated,
  onAdvanceMission,
  missionId,
  roomCode = null,
  clientIdOverride,
  initialAssignedRole = null,
  initialPlayerName,
  initialRoleClaims,
  initialSoloMode = false,
}: Props) {
  const s = useGame()
  const advancingMissionLockUntilRef = useRef<number>(0)
  const [syncedMissionId, setSyncedMissionId] = useState<MissionId | null>(() =>
    missionId ? sanitizeMissionId(missionId) : null
  )
  useEffect(() => {
    if (missionId) {
      setSyncedMissionId(sanitizeMissionId(missionId))
    }
  }, [missionId])

  const activeMissionId: MissionId = syncedMissionId ?? sanitizeMissionId(s.contractId)
  const activeMissionDef = MISSION_CATALOG[activeMissionId]
  const missionGames = activeMissionDef.stationMinigames
  const missionGamesRef = useRef<MinigameId[]>(missionGames)
  missionGamesRef.current = missionGames
  const missionTargetCount = activeMissionDef.targetResolutions
  const missionTargetCountRef = useRef<number>(missionTargetCount)
  missionTargetCountRef.current = missionTargetCount
  const missionDiff = activeMissionDef.difficulty
  const nextMissionId = getNextMissionId(activeMissionId)

  const contract = CONTRACTS.find((c) => c.id === activeMissionId) ?? CONTRACTS[0]
  const launcher = LAUNCHERS.find((l) => l.id === s.launcherId) ?? LAUNCHERS[0]
  const chassis = CHASSIS.find((c) => c.id === s.chassisId) ?? CHASSIS[1]

  const baseTel = useMemo(
    () =>
      analyze({
        contractId: activeMissionId,
        launcherId: s.launcherId,
        chassisId: s.chassisId,
        parts: s.parts,
      }),
    [activeMissionId, s.launcherId, s.chassisId, s.parts]
  )

  // ESTADO INICIAL 100% ESTABLE + MOTOR DE MINIJUEGOS FILTRADOS POR MISIÓN Y AMENAZAS EN TIEMPO REAL
  const [battery, setBattery] = useState<number>(92)
  const [lifeSupport, setLifeSupport] = useState<number>(100)
  const [dataBuffer, setDataBuffer] = useState<number>(0)
  const [orbitStability, setOrbitStability] = useState<number>(100)
  const [hull, setHull] = useState<number>(100)
  const [signalQuality, setSignalQuality] = useState<number>(100)
  const [stationHealth, setStationHealth] = useState<number>(100)
  const stationHealthRef = useRef<number>(100)
  const [isGameOver, setIsGameOver] = useState<boolean>(false)
  const isGameOverRef = useRef<boolean>(false)
  const [gameOverReason, setGameOverReason] = useState<string>('')
  const [healthDamageFlash, setHealthDamageFlash] = useState<boolean>(false)
  const healthFlashTimerRef = useRef<number | null>(null)
  const retryEpochRef = useRef<number>(0)
  const [officialScience, setOfficialScience] = useState(() => Math.round(baseTel.sciPts * 0.4))
  const [completedMinigames, setCompletedMinigames] = useState<Set<MinigameId>>(() => new Set())
  const completedMinigamesRef = useRef<Set<MinigameId>>(new Set())
  const [resolvedCount, setResolvedCount] = useState<number>(0)
  const resolvedCountRef = useRef<number>(0)
  const [roleResolvedCounts, setRoleResolvedCounts] = useState<Record<RoleId, number>>({
    director: 0,
    engineer: 0,
    science: 0,
    comms: 0,
  })
  const roleResolvedCountsRef = useRef<Record<RoleId, number>>({
    director: 0,
    engineer: 0,
    science: 0,
    comms: 0,
  })
  const [consoleCooldowns, setConsoleCooldowns] = useState<Partial<Record<MinigameId, number>>>({})
  const consoleCooldownsRef = useRef<Partial<Record<MinigameId, number>>>({})
  const attemptCountsRef = useRef<Partial<Record<MinigameId, number>>>({})
  const serverClockOffsetRef = useRef<number>(0)
  const [cooldownNowMs, setCooldownNowMs] = useState<number>(() => Date.now())
  const [remoteAlertBanner, setRemoteAlertBanner] = useState<{
    game: MinigameId
    consoleId: string
    sector: string
    distM: number
    arrow: string
    hint: string
    urgency: number
  } | null>(null)
  const remoteAlertSigRef = useRef<string>('')
  const getServerNowMs = useCallback(() => Date.now() + serverClockOffsetRef.current, [])
  const isGameInCooldown = useCallback(
    (game: MinigameId, nowMs = getServerNowMs()): boolean => {
      const exp = consoleCooldownsRef.current[game]
      return typeof exp === 'number' && exp > nowMs
    },
    [getServerNowMs]
  )
  const missionProgress = Math.min(100, Math.round((resolvedCount / missionTargetCount) * 100))
  const [activeEvent, setActiveEvent] = useState<StationEventId>(activeMissionDef.defaultAmbientEvent)
  const [overviewMode, setOverviewMode] = useState(false)
  const [visitingQuadrant, setVisitingQuadrant] = useState<QuadrantId | null>(null)
  const [playerCurrentQuadrant, setPlayerCurrentQuadrant] = useState<QuadrantId>(s.activeRole)
  const [visitorAlert, setVisitorAlert] = useState<{ msg: string; owner: RoleId } | null>(null)
  const [missionPanelOpen, setMissionPanelOpen] = useState(true)
  const [missionCompleted, setMissionCompleted] = useState(false)
  const [victoryPhase, setVictoryPhase] = useState<VictoryPhase>('none')
  const [victoryReplayMode, setVictoryReplayMode] = useState(false)
  const [laserCinematicNonce, setLaserCinematicNonce] = useState(1)
  const [returnHomeCinematicNonce, setReturnHomeCinematicNonce] = useState(1)
  const startVictoryCinematicFlow = useCallback(() => {
    setOpenConsoleIdRaw(null)
    setActiveMinigame(null)
    setRemoteAlertBanner(null)
    setVictoryReplayMode(false)
    setLaserCinematicNonce((n) => n + 1)
    setMissionCompleted(true)
    setVictoryPhase('laser_cinematic')
    playIntroSweep()
  }, [])
  const [nearestConsoleId, setNearestConsoleId] = useState<string | null>(null)
  const [hoveredConsoleId, setHoveredConsoleId] = useState<string | null>(null)
  const [openConsoleId, setOpenConsoleIdRaw] = useState<string | null>(null)
  const [activeMinigame, setActiveMinigame] = useState<MinigameId | null>(null)
  const [navSatTarget, setNavSatTarget] = useState<'sat1' | 'sat2'>('sat1')
  const [currentRoomLabel, setCurrentRoomLabel] = useState<string>('GROUND SEGMENT')

  // =========================================================================
  // LOBBY DE SELECCIÓN DE ROL + SINCRONIZACIÓN MULTI-PC (LAN /api/roles-sync)
  // =========================================================================
  const clientId = useMemo(
    () => clientIdOverride?.trim() || getOrCreateClientId(),
    [clientIdOverride]
  )
  const activeRoomCode = useMemo(
    () => (roomCode && roomCode.trim() ? roomCode.trim().toUpperCase() : null),
    [roomCode]
  )
  const rolesSyncChannelName = activeRoomCode
    ? `${ROLES_SYNC_CHANNEL}-${activeRoomCode}`
    : ROLES_SYNC_CHANNEL
  const [playerName, setPlayerName] = useState<string>(
    () => initialPlayerName?.trim() || getDefaultPlayerName(clientId)
  )
  const [roleClaims, setRoleClaims] = useState<RoleClaimsMap>(() => {
    if (initialRoleClaims && Object.keys(initialRoleClaims).length > 0) {
      return initialRoleClaims as RoleClaimsMap
    }
    if (initialAssignedRole) {
      return {
        [initialAssignedRole]: {
          clientId,
          playerName: initialPlayerName?.trim() || getDefaultPlayerName(clientId),
          timestamp: Date.now(),
        },
      }
    }
    return {}
  })
  const [roleLobbyOpen, setRoleLobbyOpen] = useState<boolean>(
    () => !(Boolean(initialSoloMode) || Boolean(initialAssignedRole))
  )
  const [soloPracticeMode, setSoloPracticeMode] = useState<boolean>(() => Boolean(initialSoloMode))
  const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null)
  const [syncConnected, setSyncConnected] = useState<boolean>(false)
  const [syncBusyRole, setSyncBusyRole] = useState<RoleId | null>(null)
  const [remotePlayerRoles, setRemotePlayerRoles] = useState<Partial<Record<RoleId, string>>>({})

  const remotePlayersRef = useRef<RemotePlayersMap>({})
  const remoteRolesSigRef = useRef<string>('')
  const syncInFlightRef = useRef<boolean>(false)
  const hasSyncedSharedStationRef = useRef<boolean>(false)
  const statsSnapshotRef = useRef<SharedStationStats>({
    battery: 92,
    lifeSupport: 100,
    dataBuffer: 0,
    orbitStability: 100,
    hull: 100,
    signalQuality: 100,
  })
  useEffect(() => {
    statsSnapshotRef.current = {
      battery,
      lifeSupport,
      dataBuffer,
      orbitStability,
      hull,
      signalQuality,
    }
  }, [battery, lifeSupport, dataBuffer, orbitStability, hull, signalQuality])

  const officialScienceRef = useRef<number>(officialScience)
  useEffect(() => {
    officialScienceRef.current = officialScience
  }, [officialScience])

  const missionCompletedRef = useRef<boolean>(missionCompleted)
  useEffect(() => {
    missionCompletedRef.current = missionCompleted
  }, [missionCompleted])

  const roleClaimsRef = useRef<RoleClaimsMap>({})
  useEffect(() => {
    roleClaimsRef.current = roleClaims
  }, [roleClaims])
  const soloPracticeModeRef = useRef<boolean>(soloPracticeMode)
  useEffect(() => {
    soloPracticeModeRef.current = soloPracticeMode
  }, [soloPracticeMode])
  const playerNameRef = useRef<string>(playerName)
  useEffect(() => {
    playerNameRef.current = playerName
    try {
      window.localStorage.setItem('squadron_player_name_v1', playerName)
      window.sessionStorage.setItem('squadron_player_name_v1', playerName)
    } catch {
      // ignorar errores de almacenamiento
    }
  }, [playerName])

  const myClaimedRole = useMemo<RoleId | null>(() => {
    for (const r of ROLE_ORDER) {
      if (roleClaims[r]?.clientId === clientId) return r
    }
    return null
  }, [roleClaims, clientId])

  const myClaimedRoleRef = useRef<RoleId | null>(myClaimedRole)
  useEffect(() => {
    myClaimedRoleRef.current = myClaimedRole
  }, [myClaimedRole])

  const activeRoleRef = useRef<RoleId>(s.activeRole)
  activeRoleRef.current = s.activeRole

  const isLocalStationLeader = useCallback((): boolean => {
    if (soloPracticeModeRef.current) return true
    const mine = myClaimedRoleRef.current
    if (!mine) return false
    const connectedRoles = new Set<RoleId>([mine])
    for (const r of ROLE_ORDER) {
      if (remotePlayersRef.current[r]) {
        connectedRoles.add(r)
      }
    }
    const leader = ROLE_ORDER.find((r) => connectedRoles.has(r)) ?? mine
    return leader === mine
  }, [])

  const isRoleLockedByOther = useCallback(
    (r: RoleId): boolean => {
      if (soloPracticeMode) return false
      const c = roleClaims[r]
      return Boolean(c && c.clientId !== clientId) || Boolean(remotePlayerRoles[r])
    },
    [roleClaims, remotePlayerRoles, clientId, soloPracticeMode]
  )

  const applySyncedClaims = useCallback((nextClaims: RoleClaimsMap | undefined) => {
    if (!nextClaims || typeof nextClaims !== 'object') return
    setRoleClaims(nextClaims)
    setSyncConnected(true)
  }, [])

  const onRoomClosedRef = useRef(onRoomClosed)
  onRoomClosedRef.current = onRoomClosed
  const roomClosedNotifiedRef = useRef(false)
  const notifyRoomClosedOnce = useCallback(() => {
    if (roomClosedNotifiedRef.current) return
    roomClosedNotifiedRef.current = true
    onRoomClosedRef.current?.()
  }, [])

  // Sincroniza rol asignado al entrar directamente desde el Lobby / Cinemática
  useEffect(() => {
    if (initialAssignedRole && !initialSoloMode) {
      actions.setRole(initialAssignedRole)
      setPlayerCurrentQuadrant(initialAssignedRole)
    }
  }, [initialAssignedRole, initialSoloMode])

  const broadcastRolesUpdate = useCallback(
    (claimsPayload?: RoleClaimsMap) => {
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel(rolesSyncChannelName)
          bc.postMessage({ type: 'sync', claims: claimsPayload ?? null, ts: Date.now() })
          bc.close()
        }
      } catch {
        // BroadcastChannel opcional
      }
    },
    [rolesSyncChannelName]
  )

  // Solo forzamos volver al rol propio cuando inicia sesión o si el rol que mirábamos pasa a otro jugador;
  // los roles vacantes ([BOT / LIBRE]) pueden operarse localmente sin soltar nuestro bloqueo principal.
  const hadClaimedRoleRef = useRef<boolean>(Boolean(initialAssignedRole))
  const syncedInitialClaimRef = useRef<boolean>(Boolean(initialAssignedRole))
  useEffect(() => {
    if (myClaimedRole) {
      hadClaimedRoleRef.current = true
      const activeIsLockedByOther = isRoleLockedByOther(s.activeRole)
      if ((!syncedInitialClaimRef.current || activeIsLockedByOther) && s.activeRole !== myClaimedRole && !soloPracticeMode) {
        actions.setRole(myClaimedRole)
      }
      syncedInitialClaimRef.current = true
    } else if (hadClaimedRoleRef.current && !soloPracticeMode) {
      hadClaimedRoleRef.current = false
      syncedInitialClaimRef.current = false
      setRoleLobbyOpen(true)
      setSyncErrorMsg(
        'Your role was released or the room was reset. Select an available specialist.'
      )
    }
  }, [myClaimedRole, isRoleLockedByOther, s.activeRole, soloPracticeMode])

  // Suscripción en tiempo real: SSE + Polling 800ms + BroadcastChannel + Latido 1.5s + sendBeacon
  useEffect(() => {
    let cancelled = false
    const roomQuery = activeRoomCode ? `roomCode=${encodeURIComponent(activeRoomCode)}` : ''
    const rolesGetUrl = roomQuery ? `/api/roles-sync?${roomQuery}` : '/api/roles-sync'
    const rolesStreamUrl = roomQuery
      ? `/api/roles-sync?stream=1&${roomQuery}`
      : '/api/roles-sync?stream=1'

    const fetchSnapshot = async () => {
      try {
        const res = await fetch(rolesGetUrl, { cache: 'no-store' })
        if (res.status === 404 && activeRoomCode) {
          const data = (await res.json().catch(() => null)) as { explicitlyClosed?: boolean } | null
          if (data?.explicitlyClosed) {
            if (!cancelled) notifyRoomClosedOnce()
            return
          }
          const rehydrated = await postRolesSyncWithRehydrate(activeRoomCode, {
            action: 'heartbeat',
            clientId,
            roomCode: activeRoomCode,
            playerName:
              playerNameRef.current.trim() || `OPERATOR-${clientId.slice(-4).toUpperCase()}`,
          })
          if (rehydrated.deleted && rehydrated.explicitlyClosed) {
            if (!cancelled) notifyRoomClosedOnce()
            return
          }
          if (!cancelled && rehydrated.claims) {
            applySyncedClaims(rehydrated.claims)
          }
          return
        }
        if (!res.ok) return
        const data = (await res.json()) as {
          claims?: RoleClaimsMap
          deleted?: boolean
          explicitlyClosed?: boolean
          room?: RoomSnapshot
        }
        if (data.deleted && data.explicitlyClosed && activeRoomCode) {
          if (!cancelled) notifyRoomClosedOnce()
          return
        }
        if (data.room) saveCachedRoomSnapshot(data.room, false)
        if (!cancelled && data.claims) {
          applySyncedClaims(data.claims)
        }
      } catch {
        if (activeRoomCode && getCachedRoomSnapshot(activeRoomCode)) {
          if (!cancelled) setSyncConnected(true)
        } else if (!cancelled) {
          setSyncConnected(false)
        }
      }
    }

    void fetchSnapshot()

    let es: EventSource | null = null
    try {
      if (typeof EventSource !== 'undefined') {
        es = new EventSource(rolesStreamUrl)
        es.onopen = () => {
          if (!cancelled) setSyncConnected(true)
        }
        es.onmessage = (ev) => {
          try {
            const parsed = JSON.parse(ev.data) as {
              claims?: RoleClaimsMap
              deleted?: boolean
              explicitlyClosed?: boolean
              room?: RoomSnapshot
            }
            if (parsed.deleted && parsed.explicitlyClosed && activeRoomCode) {
              if (!cancelled) notifyRoomClosedOnce()
              return
            }
            if (parsed.room) saveCachedRoomSnapshot(parsed.room, false)
            if (!cancelled && parsed.claims) {
              applySyncedClaims(parsed.claims)
            }
          } catch {
            // ignorar tramas incompletas
          }
        }
        es.onerror = () => {
          // On Vercel Serverless without persistent SSE, polling handles live sync smoothly
          if (!activeRoomCode && !cancelled) setSyncConnected(false)
        }
      }
    } catch {
      // Fallback por polling HTTP
    }

    let bc: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(rolesSyncChannelName)
        bc.onmessage = (ev) => {
          const d = ev.data as { claims?: RoleClaimsMap | null } | undefined
          if (!cancelled && d?.claims) {
            applySyncedClaims(d.claims)
          } else {
            void fetchSnapshot()
          }
        }
      }
    } catch {
      // ignorar si no existe BroadcastChannel
    }

    const pollTimer = window.setInterval(() => {
      void fetchSnapshot()
    }, 800)

    const heartbeatTimer = window.setInterval(async () => {
      if (soloPracticeModeRef.current) return
      const curClaims = roleClaimsRef.current
      const ownsAny = ROLE_ORDER.some((r) => curClaims[r]?.clientId === clientId)
      if (!activeRoomCode && !ownsAny) return
      try {
        const res = await postRolesSyncWithRehydrate(activeRoomCode, {
          action: 'heartbeat',
          clientId,
          ...(activeRoomCode ? { roomCode: activeRoomCode } : {}),
          playerName:
            playerNameRef.current.trim() || `OPERATOR-${clientId.slice(-4).toUpperCase()}`,
        })
        if (
          ((res.deleted && res.explicitlyClosed) ||
            (res.status === 400 && res.code === 'ROOM_FULL')) &&
          activeRoomCode
        ) {
          if (!cancelled) notifyRoomClosedOnce()
          return
        }
        if (!cancelled && res.claims) {
          applySyncedClaims(res.claims)
        }
      } catch {
        // se reintenta en el siguiente ciclo
      }
    }, 1500)

    const onBeforeUnload = () => {
      if (activeRoomCode) return
      try {
        const payload = JSON.stringify({
          action: 'leave',
          clientId,
        })
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([payload], { type: 'application/json' })
          navigator.sendBeacon('/api/roles-sync', blob)
        }
      } catch {
        // ignorar errores al cerrar pestaña
      }
    }
    if (!activeRoomCode) {
      window.addEventListener('beforeunload', onBeforeUnload)
    }

    return () => {
      cancelled = true
      window.clearInterval(pollTimer)
      window.clearInterval(heartbeatTimer)
      window.removeEventListener('beforeunload', onBeforeUnload)
      es?.close()
      bc?.close()
    }
  }, [applySyncedClaims, clientId, activeRoomCode, rolesSyncChannelName, notifyRoomClosedOnce])

  const claimRoleRemote = useCallback(
    async (r: RoleId) => {
      playClick()
      setSyncErrorMsg(null)
      if (soloPracticeMode) {
        setVisitingQuadrant(null)
        setOpenConsoleIdRaw(null)
        actions.setRole(r)
        setRoleLobbyOpen(false)
        return
      }
      setSyncBusyRole(r)
      const cleanName =
        playerNameRef.current.trim() || `OPERATOR-${clientId.slice(-4).toUpperCase()}`
      try {
        const data = await postRolesSyncWithRehydrate(activeRoomCode, {
          action: 'claim',
          roleId: r,
          clientId,
          ...(activeRoomCode ? { roomCode: activeRoomCode } : {}),
          playerName: cleanName,
        })
        if (data.claims) {
          applySyncedClaims(data.claims)
          broadcastRolesUpdate(data.claims)
        }
        if (data.status === 409 || !data.ok) {
          if (data.status === 409) {
            const owner = data.ownerName || data.claims?.[r]?.playerName || 'another operator'
            setSyncErrorMsg(`Role ${ROLE_INFO[r].code} is already claimed by ${owner}.`)
            return
          }
          setSyncErrorMsg(
            'Unable to connect to multiplayer sync. You can enable Solo Practice Mode.'
          )
          return
        }
        setVisitingQuadrant(null)
        setOpenConsoleIdRaw(null)
        actions.setRole(r)
        setRoleLobbyOpen(false)
      } catch {
        setSyncErrorMsg(
          'Unable to connect to /api/roles-sync on the network. You can enable Solo Practice Mode.'
        )
      } finally {
        setSyncBusyRole(null)
      }
    },
    [applySyncedClaims, broadcastRolesUpdate, clientId, activeRoomCode, soloPracticeMode]
  )

  const releaseMyRoleRemote = useCallback(
    async (keepLobbyOpen = true) => {
      playClick()
      setSyncErrorMsg(null)
      hadClaimedRoleRef.current = false
      try {
        const data = await postRolesSyncWithRehydrate(activeRoomCode, {
          action: 'release',
          clientId,
          ...(activeRoomCode ? { roomCode: activeRoomCode } : {}),
        })
        if (data.ok && data.claims) {
          applySyncedClaims(data.claims)
          broadcastRolesUpdate(data.claims)
        }
      } catch {
        // silent fallback if offline
      } finally {
        if (keepLobbyOpen) setRoleLobbyOpen(true)
      }
    },
    [applySyncedClaims, broadcastRolesUpdate, clientId, activeRoomCode]
  )

  const resetRoomHostRemote = useCallback(async () => {
    playClick()
    setSyncErrorMsg(null)
    hadClaimedRoleRef.current = false
    remotePlayersRef.current = {}
    remoteRolesSigRef.current = ''
    setRemotePlayerRoles({})
    try {
      const data = await postRolesSyncWithRehydrate(activeRoomCode, {
        action: 'reset',
        ...(activeRoomCode ? { roomCode: activeRoomCode } : {}),
      })
      if (data.ok) {
        if (data.claims) {
          applySyncedClaims(data.claims)
          broadcastRolesUpdate(data.claims)
        }
        if (!soloPracticeMode) {
          setRoleLobbyOpen(true)
        }
      }
    } catch {
      setSyncErrorMsg('No response from /api/roles-sync while resetting the room.')
    }
  }, [applySyncedClaims, broadcastRolesUpdate, activeRoomCode, soloPracticeMode])

  // Problemas activos en tiempo real (coordinados con enfriamiento 120s-150s tras resolver)
  const [activeThreats, setActiveThreats] = useState<ActiveThreat[]>(() => {
    const firstGame =
      missionGames.find((g) => UNIQUE_MINIGAME_DEFS[g].role === s.activeRole) ??
      missionGames[0] ??
      'dock'
    const firstDef = UNIQUE_MINIGAME_DEFS[firstGame]
    return [
      {
        id: `threat_${firstGame}_init`,
        game: firstGame,
        role: firstDef.role,
        consoleId: firstDef.primaryConsoleId,
        title: firstDef.title,
        urgency: firstGame === 'lander' ? 14 : 18,
        probeAlt: firstGame === 'lander' ? 500 : 0,
        startedAt: 0,
        attempt: 1,
        seed: 101,
      },
    ]
  })
  const activeThreatsRef = useRef<ActiveThreat[]>(activeThreats)
  useEffect(() => {
    activeThreatsRef.current = activeThreats
  }, [activeThreats])
  const nextThreatCountdownRef = useRef<number>(20)

  const activeTasks: ActiveTask[] = useMemo(
    () =>
      activeThreats.map((t) => ({
        id: t.id,
        role: t.role,
        consoleId: t.consoleId,
        kind: t.urgency >= 50 ? 'problem' : 'mission',
        title: `${t.title} · ${UNIQUE_MINIGAME_DEFS[t.game].quadrantTag}`,
        reason: UNIQUE_MINIGAME_DEFS[t.game].threatTitle,
      })),
    [activeThreats]
  )

  const [logs, setLogs] = useState<IntercomLog[]>(() => [
    {
      id: 1,
      from: 'director',
      kind: 'ok',
      text: `"${activeMissionDef.code} on orbit! Approach an alerted console (!) and press 'E'. ${missionGames.length} unique anomalies active (Level ${missionDiff})."`,
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
      const lockMsg = `🔒 Exclusive console for ${ownerInfo.animalName} — Read-only access`

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

  const teleportActivePlayerTo = useCallback(
    (tx: number, ty: number, label?: string, color?: string) => {
      const me = astronautsRef.current[activeRole]
      me.x = tx
      me.y = ty
      me.waypoints = []
      me.isMoving = false
      for (const door of SLIDING_DOORS) {
        if (Math.hypot(tx - door.x, ty - door.y) < 155) {
          doorOpenRef.current[door.id] = 1
        }
      }
      setOverviewMode(false)
      setVisitingQuadrant(null)
      if (label) {
        spawnCanvasFloating(tx, ty - 34, `📍 ${label}`, color ?? ROLE_INFO[activeRole].color)
      }
    },
    [activeRole, spawnCanvasFloating]
  )

  useEffect(() => {
    if (!visitorAlert) return
    const t = window.setTimeout(() => setVisitorAlert(null), 3800)
    return () => window.clearTimeout(t)
  }, [visitorAlert])

  const rollConsoleCooldownSeconds = () => 120 + Math.floor(Math.random() * 31)

  const pickNextPendingMinigame = useCallback(
    (
      _solved: Set<MinigameId>,
      currentThreats: ActiveThreat[],
      preferDifferentFrom?: RoleId[]
    ): MinigameId | null => {
      const nowServer = getServerNowMs()
      const busy = new Set(currentThreats.map((t) => t.game))
      const eligible = missionGamesRef.current.filter((g) => {
        if (busy.has(g)) return false
        const exp = consoleCooldownsRef.current[g]
        return !(typeof exp === 'number' && exp > nowServer)
      })
      if (eligible.length === 0) return null

      // Priorizar primero consolas NO resueltas, luego roles sin amenaza activa y menor # de ejecuciones
      eligible.sort((a, b) => {
        const unsolvedPriorityA = _solved.has(a) ? 1 : 0
        const unsolvedPriorityB = _solved.has(b) ? 1 : 0
        if (unsolvedPriorityA !== unsolvedPriorityB) return unsolvedPriorityA - unsolvedPriorityB
        const diffPriorityA =
          preferDifferentFrom && preferDifferentFrom.includes(UNIQUE_MINIGAME_DEFS[a].role) ? 1 : 0
        const diffPriorityB =
          preferDifferentFrom && preferDifferentFrom.includes(UNIQUE_MINIGAME_DEFS[b].role) ? 1 : 0
        if (diffPriorityA !== diffPriorityB) return diffPriorityA - diffPriorityB
        const attA = attemptCountsRef.current[a] ?? 0
        const attB = attemptCountsRef.current[b] ?? 0
        return attA - attB
      })
      return eligible[0]
    },
    [getServerNowMs]
  )

  const createThreatForGame = useCallback(
    (
      game: MinigameId,
      startedAt = performance.now() / 1000,
      attempt?: number,
      seed?: number
    ): ActiveThreat => {
      const def = UNIQUE_MINIGAME_DEFS[game]
      const resolvedAttempt = attempt ?? (attemptCountsRef.current[game] ?? 0) + 1
      const resolvedSeed =
        typeof seed === 'number' && Number.isFinite(seed)
          ? seed
          : Math.floor(1000 + Math.random() * 89000)
      return {
        id: `threat_${game}_${resolvedAttempt}_${Math.round(startedAt * 1000)}`,
        game,
        role: def.role,
        consoleId: def.primaryConsoleId,
        title: def.title,
        urgency: game === 'lander' ? 14 : 18,
        probeAlt: game === 'lander' ? 500 : 0,
        startedAt,
        attempt: resolvedAttempt,
        seed: resolvedSeed,
      }
    },
    []
  )

  const triggerDamageFlash = useCallback(() => {
    setHealthDamageFlash(true)
    if (healthFlashTimerRef.current) {
      window.clearTimeout(healthFlashTimerRef.current)
    }
    healthFlashTimerRef.current = window.setTimeout(() => {
      setHealthDamageFlash(false)
    }, 650)
  }, [])

  const resetCurrentStageForRetry = useCallback(
    (nextEpoch?: number) => {
      if (typeof nextEpoch === 'number' && Number.isFinite(nextEpoch)) {
        retryEpochRef.current = nextEpoch
      }
      const nextDef = MISSION_CATALOG[activeMissionId]
      const nextGames = nextDef.stationMinigames
      const nextFirst =
        nextGames.find((g) => UNIQUE_MINIGAME_DEFS[g].role === activeRoleRef.current) ??
        nextGames[0] ??
        'dock'
      const initThreat = createThreatForGame(nextFirst, performance.now() / 1000, 1, 101)

      completedMinigamesRef.current = new Set()
      setCompletedMinigames(new Set())
      resolvedCountRef.current = 0
      setResolvedCount(0)
      roleResolvedCountsRef.current = { director: 0, engineer: 0, science: 0, comms: 0 }
      setRoleResolvedCounts({ director: 0, engineer: 0, science: 0, comms: 0 })
      consoleCooldownsRef.current = {}
      setConsoleCooldowns({})
      attemptCountsRef.current = {}
      setRemoteAlertBanner(null)
      remoteAlertSigRef.current = ''
      setActiveMinigame(null)
      setOpenConsoleIdRaw(null)
      setMissionCompleted(false)
      setVictoryPhase('none')
      setVictoryReplayMode(false)
      isGameOverRef.current = false
      setIsGameOver(false)
      setGameOverReason('')
      setHealthDamageFlash(false)
      stationHealthRef.current = 100
      setStationHealth(100)
      activeThreatsRef.current = [initThreat]
      setActiveThreats([initThreat])
      setBattery(95)
      setLifeSupport(100)
      setDataBuffer(0)
      setOrbitStability(100)
      setHull(100)
      setSignalQuality(100)
      statsSnapshotRef.current = {
        battery: 95,
        lifeSupport: 100,
        dataBuffer: 0,
        orbitStability: 100,
        hull: 100,
        signalQuality: 100,
      }
      hasSyncedSharedStationRef.current = false
      setActiveEvent(nextDef.defaultAmbientEvent)
      nextThreatCountdownRef.current = 18
    },
    [activeMissionId, createThreatForGame]
  )

  const applySharedStationFromServer = useCallback(
    (shared: SharedStationSnapshot | undefined, serverTimeMs?: number) => {
      if (typeof serverTimeMs === 'number' && Number.isFinite(serverTimeMs)) {
        serverClockOffsetRef.current = serverTimeMs - Date.now()
      }
      if (!shared || soloPracticeModeRef.current || !shared.lastUpdated) return

      if (
        typeof shared.retryEpoch === 'number' &&
        Number.isFinite(shared.retryEpoch) &&
        shared.retryEpoch > retryEpochRef.current
      ) {
        resetCurrentStageForRetry(shared.retryEpoch)
        pushLog(
          'director',
          'ok',
          '"🔄 MISSION RESET TO 100% BY SQUADRON. All systems restored!"'
        )
        return
      }

      const isInitialHydration = !hasSyncedSharedStationRef.current
      hasSyncedSharedStationRef.current = true

      if (typeof shared.stationHealth === 'number' && Number.isFinite(shared.stationHealth)) {
        const serverHp = clamp(Math.round(shared.stationHealth * 10) / 10, 0, 100)
        if (serverHp !== stationHealthRef.current) {
          if (!isInitialHydration && serverHp <= stationHealthRef.current - 5) {
            triggerDamageFlash()
            playConsoleBeep(180, false)
          }
          stationHealthRef.current = serverHp
          setStationHealth(serverHp)
        }
      }

      if (shared.isGameOver === true && !isGameOverRef.current) {
        isGameOverRef.current = true
        setIsGameOver(true)
        setGameOverReason(
          shared.gameOverReason || 'Critical Space Station failure: hull & core integrity depleted.'
        )
        setActiveMinigame(null)
        setOpenConsoleIdRaw(null)
        setRemoteAlertBanner(null)
      }

      const nowServer =
        typeof serverTimeMs === 'number' && Number.isFinite(serverTimeMs)
          ? serverTimeMs
          : getServerNowMs()
      setCooldownNowMs(nowServer)

      const allowedGames = missionGamesRef.current
      const prevSolved = completedMinigamesRef.current
      const incomingSolved = (Array.isArray(shared.completedMinigames) ? shared.completedMinigames : []).filter(
        (g): g is MinigameId => allowedGames.includes(g as MinigameId)
      )

      const prevCooldowns = consoleCooldownsRef.current
      const nextCooldowns: Partial<Record<MinigameId, number>> = {}
      const newlyCooledGames: MinigameId[] = []
      if (shared.consoleCooldowns && typeof shared.consoleCooldowns === 'object') {
        for (const [k, exp] of Object.entries(shared.consoleCooldowns)) {
          if (
            allowedGames.includes(k as MinigameId) &&
            typeof exp === 'number' &&
            Number.isFinite(exp) &&
            exp > nowServer
          ) {
            nextCooldowns[k as MinigameId] = exp
            const prevExp = prevCooldowns[k as MinigameId]
            if (!prevExp || Math.abs(exp - prevExp) > 5000) {
              newlyCooledGames.push(k as MinigameId)
            }
          }
        }
      }
      consoleCooldownsRef.current = nextCooldowns
      setConsoleCooldowns(nextCooldowns)

      if (shared.attemptCounts && typeof shared.attemptCounts === 'object') {
        const mergedAttempts: Partial<Record<MinigameId, number>> = { ...attemptCountsRef.current }
        for (const [k, cnt] of Object.entries(shared.attemptCounts)) {
          if (allowedGames.includes(k as MinigameId) && typeof cnt === 'number' && Number.isFinite(cnt)) {
            mergedAttempts[k as MinigameId] = Math.max(mergedAttempts[k as MinigameId] ?? 0, cnt)
          }
        }
        attemptCountsRef.current = mergedAttempts
      }

      if (shared.roleResolvedCounts && typeof shared.roleResolvedCounts === 'object') {
        const nextRoleCounts: Record<RoleId, number> = { ...roleResolvedCountsRef.current }
        let roleChanged = false
        for (const r of ROLE_ORDER) {
          const val = shared.roleResolvedCounts[r]
          if (typeof val === 'number' && Number.isFinite(val) && val > nextRoleCounts[r]) {
            nextRoleCounts[r] = val
            roleChanged = true
          }
        }
        if (roleChanged) {
          roleResolvedCountsRef.current = nextRoleCounts
          setRoleResolvedCounts(nextRoleCounts)
        }
      }

      const newlySolvedRemotely = incomingSolved.filter((g) => !prevSolved.has(g))
      if (newlySolvedRemotely.length > 0) {
        const merged = new Set<MinigameId>(prevSolved)
        for (const g of incomingSolved) merged.add(g)
        completedMinigamesRef.current = merged
        setCompletedMinigames(merged)
      }

      const incomingResolvedCount = Math.max(
        resolvedCountRef.current,
        typeof shared.resolvedCount === 'number' && Number.isFinite(shared.resolvedCount)
          ? shared.resolvedCount
          : incomingSolved.length
      )
      const resolvedAdvanced = incomingResolvedCount > resolvedCountRef.current
      if (resolvedAdvanced) {
        resolvedCountRef.current = incomingResolvedCount
        setResolvedCount(incomingResolvedCount)

        if (!isInitialHydration) {
          const notifyList =
            newlyCooledGames.length > 0 ? newlyCooledGames : newlySolvedRemotely
          for (const g of notifyList) {
            const def = UNIQUE_MINIGAME_DEFS[g]
            if (def.role === activeRoleRef.current) {
              playConsoleBeep(880, true)
              const c = CONSOLES.find((cc) => cc.id === def.primaryConsoleId)
              if (c) {
                spawnCanvasFloating(c.x, c.y - 34, `🟢 ${def.title.toUpperCase()} STABILIZED`, '#4ade80')
              }
              pushLog(
                def.role,
                'ok',
                `"🟢 ${ROLE_INFO[def.role].animalName} stabilized ${def.title} (${incomingResolvedCount}/${missionTargetCountRef.current})."`
              )
            }
          }
        }

        if (incomingResolvedCount >= missionTargetCountRef.current && !missionCompletedRef.current) {
          activeThreatsRef.current = []
          setActiveThreats([])
          setRemoteAlertBanner(null)
          setActiveEvent(MISSION_CATALOG[activeMissionId].defaultAmbientEvent)
          startVictoryCinematicFlow()
        }
      }

      if (typeof shared.points === 'number' && shared.points !== officialScienceRef.current) {
        officialScienceRef.current = shared.points
        setOfficialScience(shared.points)
      }

      const shouldAdoptWorldState =
        isInitialHydration || !isLocalStationLeader() || resolvedAdvanced

      if (shouldAdoptWorldState) {
        if (shared.stats && typeof shared.stats === 'object') {
          const nextStats: SharedStationStats = {
            battery:
              typeof shared.stats.battery === 'number'
                ? shared.stats.battery
                : statsSnapshotRef.current.battery,
            lifeSupport:
              typeof shared.stats.lifeSupport === 'number'
                ? shared.stats.lifeSupport
                : statsSnapshotRef.current.lifeSupport,
            dataBuffer:
              typeof shared.stats.dataBuffer === 'number'
                ? shared.stats.dataBuffer
                : statsSnapshotRef.current.dataBuffer,
            orbitStability:
              typeof shared.stats.orbitStability === 'number'
                ? shared.stats.orbitStability
                : statsSnapshotRef.current.orbitStability,
            hull:
              typeof shared.stats.hull === 'number'
                ? shared.stats.hull
                : statsSnapshotRef.current.hull,
            signalQuality:
              typeof shared.stats.signalQuality === 'number'
                ? shared.stats.signalQuality
                : statsSnapshotRef.current.signalQuality,
          }
          if (nextStats.battery !== statsSnapshotRef.current.battery) setBattery(nextStats.battery)
          if (nextStats.lifeSupport !== statsSnapshotRef.current.lifeSupport)
            setLifeSupport(nextStats.lifeSupport)
          if (nextStats.dataBuffer !== statsSnapshotRef.current.dataBuffer)
            setDataBuffer(nextStats.dataBuffer)
          if (nextStats.orbitStability !== statsSnapshotRef.current.orbitStability)
            setOrbitStability(nextStats.orbitStability)
          if (nextStats.hull !== statsSnapshotRef.current.hull) setHull(nextStats.hull)
          if (nextStats.signalQuality !== statsSnapshotRef.current.signalQuality)
            setSignalQuality(nextStats.signalQuality)
          statsSnapshotRef.current = nextStats
        }

        if (Array.isArray(shared.activeThreats)) {
          const allowedNow = missionGamesRef.current
          const nextThreats = missionCompletedRef.current
            ? []
            : shared.activeThreats.filter((t) => {
                if (!allowedNow.includes(t.game)) return false
                const exp = nextCooldowns[t.game]
                return !(typeof exp === 'number' && exp > nowServer)
              })
          const prevSig = activeThreatsRef.current
            .map((t) => `${t.id}:${Math.round(t.urgency)}:${Math.round(t.probeAlt)}`)
            .join('|')
          const nextSig = nextThreats
            .map((t) => `${t.id}:${Math.round(t.urgency)}:${Math.round(t.probeAlt)}`)
            .join('|')
          if (prevSig !== nextSig) {
            activeThreatsRef.current = nextThreats
            setActiveThreats(nextThreats)
            setActiveEvent(
              deriveStationEvent(nextThreats, MISSION_CATALOG[activeMissionId].defaultAmbientEvent)
            )
          }
        }
      }
    },
    [
      activeMissionId,
      getServerNowMs,
      isLocalStationLeader,
      playConsoleBeep,
      pushLog,
      resetCurrentStageForRetry,
      spawnCanvasFloating,
      triggerDamageFlash,
    ]
  )

  const sendStationSync = useCallback(
    async (extra?: {
      completedGame?: MinigameId
      completedRole?: RoleId
      cooldownSeconds?: number
      completionNonce?: string
      pointsDelta?: number
      healthDelta?: number
      healthNonce?: string
      isGameOver?: boolean
      gameOverReason?: string
      statsPatch?: Partial<SharedStationStats>
      activeThreats?: ActiveThreat[]
      stats?: SharedStationStats
      knownSolvedCount?: number
      forceStateUpdate?: boolean
    }) => {
      if (soloPracticeModeRef.current) return
      const controlledRole = activeRoleRef.current
      const primaryRole = myClaimedRoleRef.current
      const controlledClaim = roleClaimsRef.current[controlledRole]
      const controlledLockedByOther =
        Boolean(controlledClaim && controlledClaim.clientId !== clientId) ||
        Boolean(remotePlayersRef.current[controlledRole])
      const myRole = !controlledLockedByOther ? controlledRole : primaryRole
      const me = myRole ? astronautsRef.current[myRole] : null
      const curRm = me ? findRoomAtPoint(me.x, me.y) : null

      const body: Record<string, unknown> = {
        action: 'sync',
        clientId,
        ...(activeRoomCode ? { roomCode: activeRoomCode } : {}),
        playerName: playerNameRef.current.trim() || `OPERATOR-${clientId.slice(-4).toUpperCase()}`,
        seedStation: {
          completedMinigames: Array.from(completedMinigamesRef.current),
          activeThreats: activeThreatsRef.current,
          stats: statsSnapshotRef.current,
          stationHealth: stationHealthRef.current,
          points: officialScienceRef.current,
        },
        ...(myRole && me
          ? {
              roleId: myRole,
              player: {
                x: Math.round(me.x * 10) / 10,
                y: Math.round(me.y * 10) / 10,
                dir: me.dir,
                walkFrame: Math.round(me.walkFrame * 100) / 100,
                isInteracting: me.isInteracting,
                currentRoom: curRm ? curRm.label : 'CONNECTING CORRIDOR',
              },
            }
          : {}),
        ...(extra ?? {}),
      }

      const syncRes = await postStationSyncWithRehydrate(activeRoomCode, body)
      if (syncRes.deleted && syncRes.explicitlyClosed && activeRoomCode) {
        notifyRoomClosedOnce()
        return
      }
      if (!syncRes.ok || !syncRes.data) return
      const data = syncRes.data as {
        deleted?: boolean
        explicitlyClosed?: boolean
        missionId?: string
        phase?: string
        serverTime?: number
        room?: RoomSnapshot
        roles?: RoleClaimsMap
        players?: Record<string, RemotePlayerState>
        sharedStation?: SharedStationSnapshot
      }
      if (data.deleted && data.explicitlyClosed && activeRoomCode) {
        notifyRoomClosedOnce()
        return
      }
      if (
        data.room &&
        data.phase &&
        data.phase !== 'STATION' &&
        Date.now() >= advancingMissionLockUntilRef.current
      ) {
        onRoomUpdated?.(data.room)
        return
      }
      if (data.missionId && Date.now() >= advancingMissionLockUntilRef.current) {
        const nextM = sanitizeMissionId(data.missionId)
        setSyncedMissionId((prev) => (prev === nextM ? prev : nextM))
      }

      if (data.roles) {
        applySyncedClaims(data.roles)
      }

      const nextRemotes: RemotePlayersMap = {}
      const nextNames: Partial<Record<RoleId, string>> = {}
      if (data.players && typeof data.players === 'object') {
        for (const r of ROLE_ORDER) {
          const entry = data.players[r]
          if (entry && entry.clientId && entry.clientId !== clientId) {
            nextRemotes[r] = entry
            nextNames[r] = entry.playerName || ROLE_INFO[r].animalName
          }
        }
      }
      remotePlayersRef.current = nextRemotes

      const nextSig = ROLE_ORDER.map((r) => `${r}:${nextNames[r] ?? ''}`).join('|')
      if (nextSig !== remoteRolesSigRef.current) {
        remoteRolesSigRef.current = nextSig
        setRemotePlayerRoles(nextNames)
      }

      applySharedStationFromServer(data.sharedStation, data.serverTime)
    },
    [
      applySharedStationFromServer,
      applySyncedClaims,
      clientId,
      activeRoomCode,
      notifyRoomClosedOnce,
      onRoomUpdated,
    ]
  )

  // Sincronización en tiempo real del mapa, posiciones (10Hz) y progreso compartido (/api/station-sync)
  useEffect(() => {
    if (soloPracticeMode) {
      remotePlayersRef.current = {}
      remoteRolesSigRef.current = ''
      setRemotePlayerRoles({})
      return
    }
    let cancelled = false
    const timer = window.setInterval(() => {
      if (syncInFlightRef.current) return
      syncInFlightRef.current = true
      void sendStationSync()
        .catch(() => {})
        .finally(() => {
          if (!cancelled) syncInFlightRef.current = false
        })
    }, 100)
    return () => {
      cancelled = true
      syncInFlightRef.current = false
      window.clearInterval(timer)
    }
  }, [sendStationSync, soloPracticeMode])

  const triggerStationGameOver = useCallback(
    (reasonText: string) => {
      if (isGameOverRef.current) return
      isGameOverRef.current = true
      setIsGameOver(true)
      setGameOverReason(reasonText)
      setActiveMinigame(null)
      setOpenConsoleIdRaw(null)
      setRemoteAlertBanner(null)
      if (!soloPracticeModeRef.current) {
        void sendStationSync({
          isGameOver: true,
          gameOverReason: reasonText,
          forceStateUpdate: true,
        }).catch(() => {})
      }
    },
    [sendStationSync]
  )

  const handleRetryMissionStage = useCallback(async () => {
    playClick()
    if (soloPracticeModeRef.current || !activeRoomCode) {
      resetCurrentStageForRetry(retryEpochRef.current + 1)
      pushLog('director', 'ok', '"🔄 CURRENT MISSION RESET TO 100% INTEGRITY."')
      return
    }
    try {
      const syncRes = await postStationSyncWithRehydrate(activeRoomCode, {
        action: 'retry_mission',
        roomCode: activeRoomCode,
        clientId,
      })
      if (syncRes.ok && syncRes.data) {
        const data = syncRes.data as { sharedStation?: SharedStationSnapshot }
        const epoch = data.sharedStation?.retryEpoch ?? retryEpochRef.current + 1
        resetCurrentStageForRetry(epoch)
        pushLog(
          'director',
          'ok',
          '"🔄 CURRENT MISSION RESET TO 100% FOR THE ENTIRE SQUADRON."'
        )
        return
      }
    } catch {
      // Fallback local reset if network momentarily unreachable
    }
    resetCurrentStageForRetry(retryEpochRef.current + 1)
  }, [activeRoomCode, clientId, pushLog, resetCurrentStageForRetry])

  const prevMissionIdRef = useRef<MissionId>(activeMissionId)
  useEffect(() => {
    if (prevMissionIdRef.current === activeMissionId) return
    prevMissionIdRef.current = activeMissionId
    const nextDef = MISSION_CATALOG[activeMissionId]
    resetCurrentStageForRetry()
    pushLog(
      'director',
      'ok',
      `"🧭 MISSION ${nextDef.number} (${nextDef.code}) ACTIVE: Target ${nextDef.targetResolutions} anomalies (Level ${nextDef.difficulty})."`
    )
  }, [activeMissionId, pushLog, resetCurrentStageForRetry])

  // Al "abrir" una consola con minijuego asignado, filtra por misión activa y respeta enfriamiento 35s-50s
  const setOpenConsoleId = useCallback(
    (id: string | null) => {
      if (id) {
        const mg = CONSOLE_MINIGAME[id]
        if (mg && !missionGamesRef.current.includes(mg)) {
          const c = CONSOLES.find((cc) => cc.id === id)
          const def = UNIQUE_MINIGAME_DEFS[mg]
          playConsoleBeep(420, false)
          if (c) {
            spawnCanvasFloating(c.x, c.y - 26, '⏳ STANDBY TERMINAL · LATER STAGE', '#94a3b8')
          }
          pushLog(
            def.role,
            'info',
            `"⏳ ${def.title} is on standby for another stage of the science campaign."`
          )
          setOpenConsoleIdRaw(null)
          return
        }
        if (mg && missionGamesRef.current.includes(mg)) {
          const nowServer = getServerNowMs()
          const cdExp = consoleCooldownsRef.current[mg]
          if (typeof cdExp === 'number' && cdExp > nowServer) {
            const secLeft = Math.max(1, Math.ceil((cdExp - nowServer) / 1000))
            const c = CONSOLES.find((cc) => cc.id === id)
            const def = UNIQUE_MINIGAME_DEFS[mg]
            playConsoleBeep(760, true)
            if (c) {
              spawnCanvasFloating(
                c.x,
                c.y - 26,
                `🟢 STABILIZED (Cooldown: ${secLeft}s)`,
                '#55efc4'
              )
            }
            pushLog(
              def.role,
              'ok',
              `"🟢 STABILIZED (Cooldown: ${secLeft}s) · ${def.title} nominal until cooldown expires."`
            )
            setOpenConsoleIdRaw(null)
            return
          }
          if (missionCompletedRef.current) {
            const c = CONSOLES.find((cc) => cc.id === id)
            if (c) {
              spawnCanvasFloating(c.x, c.y - 26, '✅ STAGE COMPLETED', '#55efc4')
            }
            setOpenConsoleIdRaw(null)
            return
          }
          if (mg === 'nav') {
            setNavSatTarget(id === 'sat_ctrl_2' || id === 'sci_lab' ? 'sat2' : 'sat1')
          }
          setActiveMinigame(mg)
          setOpenConsoleIdRaw(null)
          return
        }
      }
      setOpenConsoleIdRaw(id)
    },
    [getServerNowMs, playConsoleBeep, pushLog, spawnCanvasFloating]
  )

  // Temporizador UI (1s) para refrescar contadores de enfriamiento (35s-50s) en todas las PCs
  useEffect(() => {
    if (missionCompleted) return
    const timer = window.setInterval(() => {
      const nowServer = getServerNowMs()
      setCooldownNowMs(nowServer)
      const prevMap = consoleCooldownsRef.current
      let pruned = false
      const nextMap: Partial<Record<MinigameId, number>> = {}
      for (const [k, exp] of Object.entries(prevMap)) {
        if (typeof exp === 'number' && exp > nowServer) {
          nextMap[k as MinigameId] = exp
        } else {
          pruned = true
        }
      }
      if (pruned) {
        consoleCooldownsRef.current = nextMap
        setConsoleCooldowns(nextMap)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [getServerNowMs, missionCompleted])

  // Motor en tiempo real (1s): reactiva sistemas cuando termina el enfriamiento hasta alcanzar la meta de etapa
  useEffect(() => {
    if (activeMinigame || missionCompleted || isGameOver) return
    const timer = window.setInterval(() => {
      if (!soloPracticeModeRef.current && (!myClaimedRoleRef.current || !isLocalStationLeader())) {
        return
      }
      if (!soloPracticeModeRef.current && !hasSyncedSharedStationRef.current) {
        return
      }

      const nowSec = performance.now() / 1000
      const nowServer = getServerNowMs()
      const targetGoal = missionTargetCountRef.current
      const remainingNeeded = Math.max(0, targetGoal - resolvedCountRef.current)
      if (remainingNeeded <= 0) return

      const maxConcurrent = Math.min(remainingNeeded, missionGamesRef.current.length >= 8 ? 3 : 2)
      let current = activeThreatsRef.current.filter((t) => !isGameInCooldown(t.game, nowServer))

      if (current.length === 0) {
        const nextGame = pickNextPendingMinigame(completedMinigamesRef.current, current)
        if (nextGame) {
          const spawned = createThreatForGame(nextGame, nowSec)
          current = [spawned]
          const def = UNIQUE_MINIGAME_DEFS[nextGame]
          if (def.role === activeRoleRef.current) {
            playConsoleBeep(260, false)
            const c = CONSOLES.find((cc) => cc.id === def.primaryConsoleId)
            if (c) {
              spawnCanvasFloating(c.x, c.y - 26, `⚠️ ${def.title.toUpperCase()}`, '#ff7b7b')
            }
            pushLog(def.role, 'warn', `"⚠️ SECTOR ANOMALY (${def.quadrantTag}): ${def.threatTitle}"`)
          }
          nextThreatCountdownRef.current = 18
        }
      } else if (current.length < maxConcurrent) {
        nextThreatCountdownRef.current -= 1
        if (nextThreatCountdownRef.current <= 0) {
          nextThreatCountdownRef.current = 18
          const nextGame = pickNextPendingMinigame(
            completedMinigamesRef.current,
            current,
            current.map((t) => t.role)
          )
          if (nextGame) {
            const spawned = createThreatForGame(nextGame, nowSec)
            current = [...current, spawned]
            const def = UNIQUE_MINIGAME_DEFS[nextGame]
            if (def.role === activeRoleRef.current) {
              const c = CONSOLES.find((cc) => cc.id === def.primaryConsoleId)
              playConsoleBeep(260, false)
              if (c) {
                spawnCanvasFloating(c.x, c.y - 26, `⚠️ ${def.title.toUpperCase()}`, '#ff7b7b')
              }
              pushLog(
                def.role,
                'warn',
                `"🚨 NEW SECTOR ANOMALY (${def.quadrantTag}): ${def.threatTitle}"`
              )
            }
          }
        }
      }

      let touchDownWarn = false
      const nextStats: SharedStationStats = { ...statsSnapshotRef.current }
      const adjustStat = (
        key: 'hull' | 'orbitStability' | 'battery' | 'lifeSupport' | 'signalQuality' | 'dataBuffer',
        delta: number,
        min = 12,
        max = 100
      ) => {
        nextStats[key] = clamp(Number((nextStats[key] + delta).toFixed(1)), min, max)
      }
      const updated = current.map((t) => {
        let nextAlt = t.probeAlt
        switch (t.game) {
          case 'comet':
            adjustStat('hull', -1.2, 0)
            break
          case 'dock':
            adjustStat('orbitStability', -1.0, 10)
            break
          case 'eps':
            adjustStat('battery', -1.5, 0)
            break
          case 'eclss':
            adjustStat('lifeSupport', -1.5, 0)
            break
          case 'lander':
            nextAlt = Math.max(0, t.probeAlt - 12)
            if (nextAlt <= 0) {
              nextAlt = 420
              touchDownWarn = true
              adjustStat('hull', -8, 0)
            }
            break
          case 'nav':
            adjustStat('orbitStability', -0.8, 10)
            adjustStat('signalQuality', -0.9, 10)
            break
          case 'telecom':
            adjustStat('dataBuffer', 2.5, 0, 100)
            adjustStat('signalQuality', -0.5, 10)
            break
          case 'cyber':
            adjustStat('signalQuality', -1.3, 10)
            break
          case 'gyro':
            adjustStat('orbitStability', -1.0, 10)
            break
          case 'debris':
            adjustStat('hull', -1.3, 0)
            break
          case 'reactor':
            adjustStat('battery', -1.2, 0)
            break
          case 'pcb':
            adjustStat('battery', -1.4, 0)
            break
          case 'spectro':
            adjustStat('dataBuffer', 1.8, 0, 100)
            break
          case 'thermal':
            adjustStat('signalQuality', -0.9, 10)
            break
          case 'hga':
            adjustStat('dataBuffer', 2.2, 0, 100)
            adjustStat('signalQuality', -0.7, 10)
            break
          case 'decrypt':
            adjustStat('signalQuality', -1.4, 10)
            break
        }
        return {
          ...t,
          probeAlt: nextAlt,
          urgency: clamp(Number((t.urgency + 2.6).toFixed(1)), 0, 100),
        }
      })

      if (touchDownWarn) {
        pushLog(
          'science',
          'warn',
          '"🛬 PUMA-3 probe grazed surface at 0m! Hull -8%, altimeter reset to 420m for recovery maneuver."'
        )
      }

      if (nextStats.battery !== statsSnapshotRef.current.battery) setBattery(nextStats.battery)
      if (nextStats.lifeSupport !== statsSnapshotRef.current.lifeSupport)
        setLifeSupport(nextStats.lifeSupport)
      if (nextStats.dataBuffer !== statsSnapshotRef.current.dataBuffer)
        setDataBuffer(nextStats.dataBuffer)
      if (nextStats.orbitStability !== statsSnapshotRef.current.orbitStability)
        setOrbitStability(nextStats.orbitStability)
      if (nextStats.hull !== statsSnapshotRef.current.hull) setHull(nextStats.hull)
      if (nextStats.signalQuality !== statsSnapshotRef.current.signalQuality)
        setSignalQuality(nextStats.signalQuality)
      statsSnapshotRef.current = nextStats

      activeThreatsRef.current = updated
      setActiveThreats(updated)

      const derivedEvent = deriveStationEvent(
        updated,
        MISSION_CATALOG[activeMissionId].defaultAmbientEvent
      )
      setActiveEvent(derivedEvent)

      // Drenado progresivo de Vida General de la Estación: -0.8%/s por fallo activo (-1.8%/s si urgencia >= 95)
      let healthDrainPerSec = 0
      for (const t of updated) {
        healthDrainPerSec += t.urgency >= 95 ? 1.8 : 0.8
      }
      const healthDelta = healthDrainPerSec > 0 ? -Number(healthDrainPerSec.toFixed(2)) : 0
      const nextStationHp = clamp(
        Number((stationHealthRef.current + healthDelta).toFixed(1)),
        0,
        100
      )
      if (nextStationHp !== stationHealthRef.current) {
        stationHealthRef.current = nextStationHp
        setStationHealth(nextStationHp)
      }

      let collapseReason = ''
      if (nextStationHp <= 0) {
        collapseReason =
          'Station Hull & Core Integrity dropped to 0% due to prolonged unresolved orbital anomalies.'
      } else if (nextStats.hull <= 0) {
        collapseReason =
          'Catastrophic Structural Hull fracture (0%) following repeated orbital debris and meteoroid impacts.'
      } else if (nextStats.battery <= 0) {
        collapseReason =
          'Total EPS electrical blackout (Battery 0%): irreversible loss of station control.'
      } else if (nextStats.lifeSupport <= 0) {
        collapseReason =
          'Critical ECLSS Life Support collapse (Oxygen/Pressure 0%) across all pressurized modules.'
      }

      const tickNonce =
        healthDelta !== 0
          ? `tick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          : undefined

      if (collapseReason) {
        if (!isGameOverRef.current) {
          isGameOverRef.current = true
          setIsGameOver(true)
          setGameOverReason(collapseReason)
          setActiveMinigame(null)
          setOpenConsoleIdRaw(null)
          setRemoteAlertBanner(null)
        }
        if (!soloPracticeModeRef.current) {
          void sendStationSync({
            activeThreats: updated,
            stats: nextStats,
            knownSolvedCount: resolvedCountRef.current,
            forceStateUpdate: true,
            ...(healthDelta !== 0 ? { healthDelta, healthNonce: tickNonce } : {}),
            isGameOver: true,
            gameOverReason: collapseReason,
          }).catch(() => {})
        }
        return
      }

      if (!soloPracticeModeRef.current) {
        void sendStationSync({
          activeThreats: updated,
          stats: nextStats,
          knownSolvedCount: resolvedCountRef.current,
          forceStateUpdate: true,
          ...(healthDelta !== 0 ? { healthDelta, healthNonce: tickNonce } : {}),
        }).catch(() => {})
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [
    activeMinigame,
    createThreatForGame,
    getServerNowMs,
    isGameOver,
    isGameInCooldown,
    isLocalStationLeader,
    missionCompleted,
    pickNextPendingMinigame,
    playConsoleBeep,
    pushLog,
    sendStationSync,
    spawnCanvasFloating,
  ])

  const upsertReactiveTasks = useCallback((_completedConsoleId: string, _nextTasks: ActiveTask[]) => {}, [])

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

      const advanceProgress = (_delta: number) => {}

      switch (c.id) {
        case 'sci_scan':
        case 'sci_holo': {
          playConsoleBeep(780, true)
          const newBuf = clamp(dataBuffer + 55, 0, 100)
          setDataBuffer(newBuf)
          setOfficialScience((sPts) => sPts + 30)
          setBattery((b) => clamp(b - 28, 35, 100))
          advanceProgress(12)

          spawnCanvasFloating(c.x, c.y - 24, '+55% DATA · ⚡ REACTOR OVERLOAD', '#55efc4')
          pushLog(
            'science',
            'warn',
            `"🐆 PUMA-3 analyzed samples in USER SEGMENT (+55% Buffer), overloading the thermal reactor core. 🦙 ALPACA-1, stabilize POWER MGD & REACTOR; 🐍 SERPIENTE-2, transmit via COMMUNICATIONS!"`
          )

          upsertReactiveTasks(c.id, [
            {
              id: `task_eng_${Date.now()}`,
              role: 'engineer',
              consoleId: 'eng_cool',
              kind: 'problem',
              title: 'Stabilize Thermal Reactor Core in POWER MGD',
              reason:
                'PUMA-3 multispectral laser overheated the thermal reactor core and drained battery reserves.',
            },
            {
              id: `task_com_${Date.now()}`,
              role: 'comms',
              consoleId: 'com_tx',
              kind: 'mission',
              title: 'Transmit DSN Telemetry in COMMUNICATIONS',
              reason:
                'A science telemetry packet is queued in the Data Buffer awaiting Earth downlink via the parabolic dish.',
            },
          ])
          break
        }

        case 'sci_lab': {
          playConsoleBeep(680, true)
          setOfficialScience((sPts) => sPts + 25)
          setDataBuffer((v) => clamp(v + 40, 0, 100))
          advanceProgress(10)
          spawnCanvasFloating(c.x, c.y - 24, '⚗️ SAMPLES PROCESSED (+25 PTS)', '#7bff9a')
          pushLog(
            'science',
            'ok',
            `"🐆 PUMA-3 processed lab samples under the LABORATORY fume hood. Telemetry packet ready for 🐍 SERPIENTE-2 in COMMUNICATIONS!"`
          )
          upsertReactiveTasks(c.id, [
            {
              id: `task_com_lab_${Date.now()}`,
              role: 'comms',
              consoleId: 'com_tx',
              kind: 'mission',
              title: 'Downlink DSN Packets in COMMUNICATIONS',
              reason:
                'The LABORATORY science server compressed new assay results ready for orbital downlink.',
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

          spawnCanvasFloating(c.x, c.y - 24, `🚀 +${gainedSci} PTS DOWNLINKED · 🧭 ORBITAL DRIFT`, '#74b9ff')
          pushLog(
            'comms',
            'warn',
            `"🐍 SERPIENTE-2 transmitted via the COMMUNICATIONS parabolic dish (+${gainedSci} PTS), inducing attitude drift. 🦅 CONDOR-4, correct orbit in GROUND SEGMENT!"`
          )

          upsertReactiveTasks(c.id, [
            {
              id: `task_dir_orbit_${Date.now()}`,
              role: 'director',
              consoleId: 'dir_orbit',
              kind: 'problem',
              title: 'Correct Attitude on 5-Display Console (GROUND SEGMENT)',
              reason:
                'X-band transmission recoil in COMMUNICATIONS shifted station orbital attitude to 58%.',
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
          spawnCanvasFloating(c.x, c.y - 24, '📡 SPACE SEGMENT SYNCHRONIZED 100%', '#74b9ff')
          pushLog(
            'comms',
            'ok',
            `"🐍 SERPIENTE-2 aligned the telescope and both CubeSats in SPACE SEGMENT. Proceed to COMMUNICATIONS to downlink to Earth."`
          )
          upsertReactiveTasks(c.id, [
            {
              id: `task_com_tx_${Date.now()}`,
              role: 'comms',
              consoleId: 'com_tx',
              kind: 'mission',
              title: 'Transmit from COMMUNICATIONS Dome',
              reason: 'Optical telescope and CubeSat constellation aligned 100% with Earth ground stations.',
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

          spawnCanvasFloating(c.x, c.y - 24, '🧭 ORBIT 100% · 🫧 PRESSURIZE O2', '#ffd23f')
          pushLog(
            'director',
            'warn',
            `"🦅 CONDOR-4 stabilized orbit to 100%. Thruster burn depleted cabin pressure: 🦙 ALPACA-1, pressurize the dual O2 tanks in LIFE SUPPORT!"`
          )

          upsertReactiveTasks(c.id, [
            {
              id: `task_eng_o2_${Date.now()}`,
              role: 'engineer',
              consoleId: 'eng_o2',
              kind: 'problem',
              title: 'Pressurize O2 Tanks in LIFE SUPPORT',
              reason:
                'CONDOR-4 orbital correction burn depleted O2 Life Support loop pressure (58%).',
            },
          ])
          break
        }

        case 'dir_shield': {
          playConsoleBeep(720, true)
          setHull(100)
          advanceProgress(12)
          spawnCanvasFloating(c.x, c.y - 24, '🛡️ SHUTTLE & ARM AT 100%', '#5ef0ff')
          pushLog(
            'director',
            'ok',
            `"🦅 CONDOR-4 secured the hydraulic manipulator arm and orbiter shuttle in LAUNCH SEGMENT."`
          )
          upsertReactiveTasks(c.id, [
            {
              id: `task_sci_lab_${Date.now()}`,
              role: 'science',
              consoleId: 'sci_lab',
              kind: 'mission',
              title: 'Process Samples in LABORATORY',
              reason: 'Hangar stabilized and cleared for the next chemical assay batch.',
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

          spawnCanvasFloating(c.x, c.y - 24, '⚡ REACTOR & MASTER SWITCH AT 98%', '#ffd23f')
          pushLog(
            'engineer',
            'ok',
            `"🦙 ALPACA-1 stabilized the REACTOR core and battery racks (+98% Power). 🐍 SERPIENTE-2 now has full power in COMMUNICATIONS!"`
          )

          upsertReactiveTasks(c.id, [
            {
              id: `task_com_tx2_${Date.now()}`,
              role: 'comms',
              consoleId: dataBuffer >= 30 ? 'com_tx' : 'com_align',
              kind: 'mission',
              title:
                dataBuffer >= 30
                  ? 'Downlink DSN Packets in COMMUNICATIONS'
                  : 'Align Telescope in SPACE SEGMENT',
              reason: 'ALPACA-1 restored 98% power across the Reactor and solar array buses.',
            },
          ])
          break
        }

        case 'eng_o2': {
          playConsoleBeep(620, true)
          setLifeSupport(100)
          setHull(100)
          advanceProgress(15)

          spawnCanvasFloating(c.x, c.y - 24, '🫧 O2 TANKS 100% · STATION NOMINAL', '#7bff9a')
          pushLog(
            'engineer',
            'ok',
            `"🦙 ALPACA-1 pressurized the dual O2 tanks in LIFE SUPPORT to 100%. Systems nominal for science probe ops in USER SEGMENT!"`
          )

          upsertReactiveTasks(c.id, [
            {
              id: `task_sci_cycle_${Date.now()}`,
              role: 'science',
              consoleId: 'sci_holo',
              kind: 'mission',
              title: 'Planetary Descent Ops in USER SEGMENT',
              reason: 'O2 Life Support and pressure valves restored to 100% by ALPACA-1.',
            },
          ])
          break
        }
      }

      const fallbackMg = CONSOLE_MINIGAME[c.id]
      if (
        fallbackMg &&
        missionGamesRef.current.includes(fallbackMg) &&
        !isGameInCooldown(fallbackMg)
      ) {
        const prevResolved = resolvedCountRef.current
        const nextResolved = prevResolved + 1
        resolvedCountRef.current = nextResolved
        setResolvedCount(nextResolved)
        const nextSet = new Set(completedMinigamesRef.current)
        nextSet.add(fallbackMg)
        completedMinigamesRef.current = nextSet
        setCompletedMinigames(nextSet)
        const cdSec = rollConsoleCooldownSeconds()
        const cdUntil = getServerNowMs() + cdSec * 1000
        consoleCooldownsRef.current = { ...consoleCooldownsRef.current, [fallbackMg]: cdUntil }
        setConsoleCooldowns(consoleCooldownsRef.current)
        if (!soloPracticeModeRef.current) {
          void sendStationSync({
            completedGame: fallbackMg,
            completedRole: UNIQUE_MINIGAME_DEFS[fallbackMg].role,
            cooldownSeconds: cdSec,
            completionNonce: `${clientId}-${fallbackMg}-${Date.now()}`,
            knownSolvedCount: prevResolved,
          }).catch(() => {})
        }
      }

      setOpenConsoleId(null)
    },
    [
      activeEvent,
      dataBuffer,
      playConsoleBeep,
      pushLog,
      sendStationSync,
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
      setActiveMinigame(null)
      playConsoleBeep(880, true)

      const me = astronautsRef.current[activeRole]
      const fx = me.x
      const fy = me.y - 44

      // 1. Registrar resolución, incrementar contador por rol y asignar enfriamiento de 120s a 150s
      const defCompleted = UNIQUE_MINIGAME_DEFS[game]
      const prevResolvedCount = resolvedCountRef.current
      const nextResolvedCount = prevResolvedCount + 1
      resolvedCountRef.current = nextResolvedCount
      setResolvedCount(nextResolvedCount)

      const nextRoleCounts: Record<RoleId, number> = {
        ...roleResolvedCountsRef.current,
        [defCompleted.role]: (roleResolvedCountsRef.current[defCompleted.role] ?? 0) + 1,
      }
      roleResolvedCountsRef.current = nextRoleCounts
      setRoleResolvedCounts(nextRoleCounts)

      const nextAttemptNum = (attemptCountsRef.current[game] ?? 0) + 1
      attemptCountsRef.current = { ...attemptCountsRef.current, [game]: nextAttemptNum }

      const cooldownSec = rollConsoleCooldownSeconds()
      const cooldownUntil = getServerNowMs() + cooldownSec * 1000
      const nextCooldownMap: Partial<Record<MinigameId, number>> = {
        ...consoleCooldownsRef.current,
        [game]: cooldownUntil,
      }
      consoleCooldownsRef.current = nextCooldownMap
      setConsoleCooldowns(nextCooldownMap)
      setCooldownNowMs(getServerNowMs())

      const completionNonce = `${clientId}-${game}-${nextAttemptNum}-${Date.now().toString(36)}`

      const nextSolved = new Set(completedMinigamesRef.current)
      nextSolved.add(game)
      completedMinigamesRef.current = nextSolved
      setCompletedMinigames(nextSolved)

      // Al completar un minijuego, restaurar +15% de Vida General de la Estación (máximo 100%)
      const healedHealth = clamp(Number((stationHealthRef.current + 15).toFixed(1)), 0, 100)
      stationHealthRef.current = healedHealth
      setStationHealth(healedHealth)

      // 2. Resolver amenaza activa y restaurar barras afectadas al 100%
      const nowSec = performance.now() / 1000
      let remaining = activeThreatsRef.current.filter((t) => t.game !== game)
      const statsPatch: Partial<SharedStationStats> = {}
      let pointsDelta = 0
      const applyReward = (pts: number, color: string, badge: string, logMsg: string) => {
        pointsDelta = pts
        if (pointsDelta > 0) {
          officialScienceRef.current += pointsDelta
          setOfficialScience((v) => v + pointsDelta)
        }
        spawnCanvasFloating(fx, fy, badge, color)
        pushLog(activeRole, 'ok', logMsg)
      }

      switch (game) {
        case 'dock': {
          const nextHull = clamp(Math.round(statsSnapshotRef.current.hull + 15), 0, 100)
          statsPatch.orbitStability = 100
          statsPatch.hull = nextHull
          pointsDelta = 35
          setOrbitStability(100)
          setHull(nextHull)
          if (pointsDelta > 0) {
            officialScienceRef.current += pointsDelta
            setOfficialScience((v) => v + pointsDelta)
          }
          spawnCanvasFloating(fx, fy, '🚀 APAS DOCKING 100% · +35 PTS', '#ffd23f')
          pushLog(
            activeRole,
            'ok',
            '"🚀 CONDOR-4 completed APAS docking: orbit 100%, hull +15% (+35 PTS)."'
          )
          break
        }

        case 'comet': {
          const nextOrbit = clamp(
            Math.round(statsSnapshotRef.current.orbitStability + 15),
            0,
            100
          )
          statsPatch.hull = 100
          statsPatch.orbitStability = nextOrbit
          pointsDelta = 40
          setHull(100)
          setOrbitStability(nextOrbit)
          if (pointsDelta > 0) {
            officialScienceRef.current += pointsDelta
            setOfficialScience((v) => v + pointsDelta)
          }
          spawnCanvasFloating(fx, fy, '☄️ METEOROID DEFLECTED · HULL 100% · +40 PTS', '#ffd23f')
          pushLog(
            activeRole,
            'ok',
            '"☄️ Orbital defense completed by CONDOR-4: meteoroids cleared and hull at 100% (+40 PTS)."'
          )
          break
        }

        case 'eps':
          statsPatch.battery = 100
          pointsDelta = 35
          setBattery(100)
          if (pointsDelta > 0) {
            officialScienceRef.current += pointsDelta
            setOfficialScience((v) => v + pointsDelta)
          }
          spawnCanvasFloating(fx, fy, '⚡ EPS POWER 100% · ECLIPSE CLEARED · +35 PTS', '#ffd23f')
          pushLog(
            activeRole,
            'ok',
            '"⚡ ALPACA-1 balanced EPS buses: battery and cabin power at 100% (+35 PTS)."'
          )
          break

        case 'eclss':
          statsPatch.lifeSupport = 100
          pointsDelta = 35
          setLifeSupport(100)
          if (pointsDelta > 0) {
            officialScienceRef.current += pointsDelta
            setOfficialScience((v) => v + pointsDelta)
          }
          spawnCanvasFloating(fx, fy, '🫧 O2 LIFE SUPPORT 100% · CO2 ZERO · +35 PTS', '#55efc4')
          pushLog(
            activeRole,
            'ok',
            '"🫧 ECLSS scrubbed by ALPACA-1: O2 at 100%, CO2 haze cleared (+35 PTS)."'
          )
          break

        case 'lander': {
          const nextBuf = nextSolved.has('telecom')
            ? statsSnapshotRef.current.dataBuffer
            : clamp(Math.max(statsSnapshotRef.current.dataBuffer, 35), 0, 100)
          statsPatch.dataBuffer = nextBuf
          pointsDelta = 45
          setDataBuffer(nextBuf)
          if (pointsDelta > 0) {
            officialScienceRef.current += pointsDelta
            setOfficialScience((v) => v + pointsDelta)
          }
          spawnCanvasFloating(fx, fy, '🛬 PROBE TOUCHDOWN CONFIRMED · +45 PTS', '#55efc4')
          pushLog(
            activeRole,
            'ok',
            '"🛬 PUMA-3 landed the planetary probe safely: surface samples collected (+45 PTS)."'
          )
          break
        }

        case 'nav':
          statsPatch.orbitStability = 100
          statsPatch.signalQuality = 100
          pointsDelta = 40
          setOrbitStability(100)
          setSignalQuality(100)
          if (pointsDelta > 0) {
            officialScienceRef.current += pointsDelta
            setOfficialScience((v) => v + pointsDelta)
          }
          spawnCanvasFloating(fx, fy, '🛰️ SAT-02 INTI-SCIENCE ON ORBIT · 100% · +40 PTS', '#74b9ff')
          pushLog(
            activeRole,
            'ok',
            '"🛰️ PUMA-3 aligned SAT-02 INTI-SCIENCE into nominal orbit: signal 100% (+40 PTS)."'
          )
          break

        case 'telecom':
          statsPatch.signalQuality = 100
          statsPatch.dataBuffer = 0
          pointsDelta = 35
          setSignalQuality(100)
          setDataBuffer(0)
          if (pointsDelta > 0) {
            officialScienceRef.current += pointsDelta
            setOfficialScience((v) => v + pointsDelta)
          }
          spawnCanvasFloating(fx, fy, '📡 DSN TELECOM 100% · BUFFER 0% · +35 PTS', '#74b9ff')
          pushLog(
            activeRole,
            'ok',
            '"📡 SERPIENTE-2 synchronized the DSN antenna: buffer downlinked and signal 100% (+35 PTS)."'
          )
          break

        case 'cyber':
          statsPatch.signalQuality = 100
          pointsDelta = 40
          setSignalQuality(100)
          if (pointsDelta > 0) {
            officialScienceRef.current += pointsDelta
            setOfficialScience((v) => v + pointsDelta)
          }
          spawnCanvasFloating(fx, fy, '🛡️ FIREWALL 8080 SECURED · 100% · +40 PTS', '#74b9ff')
          pushLog(
            activeRole,
            'ok',
            '"🛡️ SERPIENTE-2 sealed port 8080: intrusion neutralized at 100% (+40 PTS)."'
          )
          break

        case 'gyro':
          statsPatch.orbitStability = 100
          setOrbitStability(100)
          applyReward(
            40,
            '#ffd23f',
            '🧭 CMG GYROSCOPE CALIBRATED · 100% · +40 PTS',
            '"🧭 CONDOR-4 stabilized CMG flywheels: orbital attitude at 100% (+40 PTS)."'
          )
          break

        case 'debris': {
          const nextOrbit = clamp(Math.round(statsSnapshotRef.current.orbitStability + 12), 0, 100)
          statsPatch.hull = 100
          statsPatch.orbitStability = nextOrbit
          setHull(100)
          setOrbitStability(nextOrbit)
          applyReward(
            45,
            '#ffd23f',
            '🛰️ DEBRIS CLEARED · HULL 100% · +45 PTS',
            '"🛰️ CONDOR-4 cleared orbital debris from the solar corridor: hull at 100% (+45 PTS)."'
          )
          break
        }

        case 'reactor': {
          const nextHull = clamp(Math.round(statsSnapshotRef.current.hull + 8), 0, 100)
          statsPatch.battery = 100
          statsPatch.hull = nextHull
          setBattery(100)
          setHull(nextHull)
          applyReward(
            40,
            '#55efc4',
            '☢️ REACTOR COOLED · POWER 100% · +40 PTS',
            '"☢️ ALPACA-1 balanced cryogenic reactor loops: power at 100% (+40 PTS)."'
          )
          break
        }

        case 'pcb':
          statsPatch.battery = 100
          setBattery(100)
          applyReward(
            45,
            '#55efc4',
            '🔌 PCB BUSES BRIDGED · POWER 100% · +45 PTS',
            '"🔌 ALPACA-1 repaired the master PCB bus after the solar storm: power at 100% (+45 PTS)."'
          )
          break

        case 'spectro': {
          const nextBuf = clamp(Math.round(statsSnapshotRef.current.dataBuffer * 0.25), 0, 100)
          const nextSig = clamp(Math.round(statsSnapshotRef.current.signalQuality + 12), 0, 100)
          statsPatch.dataBuffer = nextBuf
          statsPatch.signalQuality = nextSig
          setDataBuffer(nextBuf)
          setSignalQuality(nextSig)
          applyReward(
            40,
            '#a29bfe',
            '🧪 SPECTROMETRY VERIFIED · +40 PTS',
            '"🧪 PUMA-3 resolved spectral peaks from glacial science samples (+40 PTS)."'
          )
          break
        }

        case 'thermal': {
          const nextHull = clamp(Math.round(statsSnapshotRef.current.hull + 10), 0, 100)
          statsPatch.signalQuality = 100
          statsPatch.hull = nextHull
          setSignalQuality(100)
          setHull(nextHull)
          applyReward(
            45,
            '#a29bfe',
            '🌡️ MULTISPECTRAL TELEMETRY 100% · +45 PTS',
            '"🌡️ PUMA-3 calibrated infrared thermal mapping against solar flares: signal at 100% (+45 PTS)."'
          )
          break
        }

        case 'hga':
          statsPatch.signalQuality = 100
          statsPatch.dataBuffer = 0
          setSignalQuality(100)
          setDataBuffer(0)
          applyReward(
            40,
            '#74b9ff',
            '🛰️ DSN ANTENNA ALIGNED · 100% · BUFFER 0% · +40 PTS',
            '"🛰️ SERPIENTE-2 locked the DSN Ka-band beam: link at 100% and buffer downlinked (+40 PTS)."'
          )
          break

        case 'decrypt':
          statsPatch.signalQuality = 100
          setSignalQuality(100)
          applyReward(
            45,
            '#74b9ff',
            '🔐 QUANTUM KEY ESTABLISHED · 100% · +45 PTS',
            '"🔐 SERPIENTE-2 decrypted the emergency quantum channel: network secured at 100% (+45 PTS)."'
          )
          break
      }

      const nextStatsSnapshot: SharedStationStats = {
        ...statsSnapshotRef.current,
        ...statsPatch,
      }
      statsSnapshotRef.current = nextStatsSnapshot

      // 3. Desbloquear victoria al alcanzar la meta de problemas resueltos de la etapa (4/6/8)
      if (nextResolvedCount >= missionTargetCountRef.current) {
        activeThreatsRef.current = []
        setActiveThreats([])
        setRemoteAlertBanner(null)
        setActiveEvent(MISSION_CATALOG[activeMissionId].defaultAmbientEvent)
        startVictoryCinematicFlow()
        if (!soloPracticeModeRef.current) {
          void sendStationSync({
            completedGame: game,
            completedRole: defCompleted.role,
            cooldownSeconds: cooldownSec,
            completionNonce,
            pointsDelta,
            statsPatch,
            activeThreats: [],
            stats: nextStatsSnapshot,
            knownSolvedCount: prevResolvedCount,
            forceStateUpdate: true,
          }).catch(() => {})
        }
        return
      }

      if (remaining.length === 0) {
        const nextGame = pickNextPendingMinigame(nextSolved, remaining)
        if (nextGame) {
          const spawned = createThreatForGame(nextGame, nowSec)
          remaining = [spawned]
          const def = UNIQUE_MINIGAME_DEFS[nextGame]
          if (def.role === activeRoleRef.current) {
            pushLog(
              def.role,
              'warn',
              `"⚠️ NEXT ANOMALY (${def.quadrantTag}): ${def.threatTitle}"`
            )
          }
        }
      }
      nextThreatCountdownRef.current = 18
      activeThreatsRef.current = remaining
      setActiveThreats(remaining)

      setActiveEvent(
        deriveStationEvent(remaining, MISSION_CATALOG[activeMissionId].defaultAmbientEvent)
      )

      if (!soloPracticeModeRef.current) {
        void sendStationSync({
          completedGame: game,
          completedRole: defCompleted.role,
          cooldownSeconds: cooldownSec,
          completionNonce,
          pointsDelta,
          statsPatch,
          activeThreats: remaining,
          stats: nextStatsSnapshot,
          knownSolvedCount: prevResolvedCount,
          forceStateUpdate: true,
        }).catch(() => {})
      }
    },
    [
      activeMissionId,
      activeRole,
      clientId,
      createThreatForGame,
      getServerNowMs,
      pickNextPendingMinigame,
      playConsoleBeep,
      pushLog,
      sendStationSync,
      spawnCanvasFloating,
    ]
  )

  const handleMinigameFail = useCallback(
    (game: MinigameId) => {
      if (isGameOverRef.current) return
      const def = UNIQUE_MINIGAME_DEFS[game]
      const nextHealth = clamp(Number((stationHealthRef.current - 20).toFixed(1)), 0, 100)
      stationHealthRef.current = nextHealth
      setStationHealth(nextHealth)
      triggerDamageFlash()
      playConsoleBeep(165, false)

      const me = astronautsRef.current[activeRoleRef.current]
      if (me) {
        spawnCanvasFloating(me.x, me.y - 46, '💥 -20% STATION INTEGRITY', '#ff4d6d')
      }
      pushLog(
        def.role,
        'warn',
        `"💥 FAILURE IN ${def.title.toUpperCase()}: -20% Station Hull & Core Integrity (current: ${Math.round(nextHealth)}%)."`
      )

      const failNonce = `fail-${clientId}-${game}-${Date.now().toString(36)}`
      if (nextHealth <= 0) {
        const reasonText = `Critical failure in ${def.title}: Station Hull & Core Integrity depleted to 0%.`
        if (!soloPracticeModeRef.current) {
          void sendStationSync({
            healthDelta: -20,
            healthNonce: failNonce,
            isGameOver: true,
            gameOverReason: reasonText,
          }).catch(() => {})
        }
        triggerStationGameOver(reasonText)
        return
      }

      if (!soloPracticeModeRef.current) {
        void sendStationSync({
          healthDelta: -20,
          healthNonce: failNonce,
        }).catch(() => {})
      }
    },
    [
      clientId,
      playConsoleBeep,
      pushLog,
      sendStationSync,
      spawnCanvasFloating,
      triggerDamageFlash,
      triggerStationGameOver,
    ]
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

      if (roleLobbyOpen) {
        if (k === 'escape' && (soloPracticeMode || myClaimedRole !== null)) {
          e.preventDefault()
          playClick()
          setRoleLobbyOpen(false)
        }
        return
      }

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
        const targetRole = ROLE_ORDER[idx]
        if (isRoleLockedByOther(targetRole)) {
          playClick()
          const owner =
            remotePlayerRoles[targetRole] ??
            roleClaims[targetRole]?.playerName ??
            'another operator'
          const me = astronautsRef.current[activeRole]
          spawnCanvasFloating(me.x, me.y - 44, `🔒 ${ROLE_INFO[targetRole].code} (${owner})`, '#f87171')
          pushLog(
            targetRole,
            'warn',
            `"🔒 Role locked: ${ROLE_INFO[targetRole].code} is operated remotely by ${owner}."`
          )
          return
        }
        if (!soloPracticeMode && !myClaimedRole && targetRole !== myClaimedRole) {
          void claimRoleRemote(targetRole)
          return
        }
        setVisitingQuadrant(null)
        setOpenConsoleId(null)
        actions.setRole(targetRole)
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

        // 3. De lo contrario caminar hacia su consola con alerta o sistema pendiente más cercano
        const activeMissionSet = new Set(missionGamesRef.current)
        const myConsoles = CONSOLES.filter((c) => canUseConsole(c, activeRole))
        const activeRoleThreat = activeThreatsRef.current.find((t) => t.role === activeRole)
        const threatenedConsoles = activeRoleThreat
          ? myConsoles.filter((c) => CONSOLE_MINIGAME[c.id] === activeRoleThreat.game)
          : []
        const stageConsoles = myConsoles.filter((c) => {
          const mg = CONSOLE_MINIGAME[c.id]
          return Boolean(mg && activeMissionSet.has(mg))
        })
        const pendingConsoles = stageConsoles.filter((c) => {
          const mg = CONSOLE_MINIGAME[c.id]
          return !mg || !isGameInCooldown(mg)
        })
        const pool =
          threatenedConsoles.length > 0
            ? threatenedConsoles
            : pendingConsoles.length > 0
            ? pendingConsoles
            : stageConsoles.length > 0
            ? stageConsoles
            : myConsoles
        let best: ConsoleStation | null = null
        let bestD = Infinity
        for (const c of pool) {
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
    claimRoleRemote,
    executeConsole,
    isGameInCooldown,
    isRoleLockedByOther,
    myClaimedRole,
    openConsole,
    openConsoleId,
    openOrWalkToConsole,
    pushLog,
    remotePlayerRoles,
    roleClaims,
    roleLobbyOpen,
    setOpenConsoleId,
    soloPracticeMode,
    spawnCanvasFloating,
    triggerReadOnlyAlert,
    visitingQuadrant,
  ])

  // Al abrir un minijuego o el Lobby de roles se sueltan las teclas de movimiento retenidas
  useEffect(() => {
    if (activeMinigame || roleLobbyOpen) keysRef.current.clear()
  }, [activeMinigame, roleLobbyOpen])

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
    activeThreats,
    completedMinigames,
    consoleCooldowns,
    missionCompleted,
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
      activeThreats,
      completedMinigames,
      consoleCooldowns,
      missionCompleted,
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
    activeThreats,
    completedMinigames,
    consoleCooldowns,
    missionCompleted,
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
        const remoteHuman =
          r !== st.activeRole && !soloPracticeModeRef.current
            ? remotePlayersRef.current[r]
            : undefined
        const isClaimedByOther =
          r !== st.activeRole &&
          !soloPracticeModeRef.current &&
          Boolean(roleClaimsRef.current[r] && roleClaimsRef.current[r]!.clientId !== clientId)

        if (!remoteHuman && time > ent.interactUntil) {
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
            if (dist < 16) {
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
        } else if (remoteHuman) {
          // Rol ocupado por jugador humano en red LAN: NO ejecutar IA de bot.
          // Interpolación suave (Lerp) a 60 FPS hacia las coordenadas recibidas de su PC.
          ent.waypoints = []
          const dx = remoteHuman.x - ent.x
          const dy = remoteHuman.y - ent.y
          const dist = Math.hypot(dx, dy)
          if (dist > 280) {
            ent.x = remoteHuman.x
            ent.y = remoteHuman.y
          } else {
            ent.x += dx * 0.35
            ent.y += dy * 0.35
          }
          ent.dir = remoteHuman.dir
          ent.isInteracting = remoteHuman.isInteracting
          const isRemotelyWalking = dist > 1.2 || remoteHuman.walkFrame > 0
          ent.isMoving = isRemotelyWalking
          if (isRemotelyWalking) {
            ent.walkFrame += dt * 11
          } else {
            ent.walkFrame = 0
          }
          continue
        } else if (isClaimedByOther) {
          // Rol reservado en lobby LAN esperando su primer paquete de posición (~100ms)
          ent.waypoints = []
          ent.isMoving = false
          ent.walkFrame = 0
          continue
        } else {
          if (ent.waypoints.length > 0) {
            const wp = ent.waypoints[0]
            const dx = wp.x - ent.x
            const dy = wp.y - ent.y
            const dist = Math.hypot(dx, dy)
            if (dist < 16) {
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
          const prevX = ent.x
          const prevY = ent.y

          // Movimiento libre entre cuadrantes (con colisión sólida X/Y separada contra objetos)
          if (isPointInsideWalkableGeometry(nx, ent.y)) {
            ent.x = nx
          }
          if (isPointInsideWalkableGeometry(ent.x, ny)) {
            ent.y = ny
          }

          let moved = ent.x !== prevX || ent.y !== prevY
          if (!moved && ent.waypoints.length > 0) {
            // Deslizamiento suave alrededor de obstáculos sólidos cuando el desplazamiento por clic queda bloqueado
            const wp = ent.waypoints[0]
            const len = Math.hypot(vx, vy) || 1
            const ux = vx / len
            const uy = vy / len
            const px = -uy
            const py = ux
            const slideDist = Math.min(len, speed) * dt
            const sideAOpen = isPointInsideWalkableGeometry(
              ent.x + px * 16 + ux * 10,
              ent.y + py * 16 + uy * 10
            )
            const sideBOpen = isPointInsideWalkableGeometry(
              ent.x - px * 16 + ux * 10,
              ent.y - py * 16 + uy * 10
            )
            const primarySign =
              sideAOpen && !sideBOpen
                ? 1
                : !sideAOpen && sideBOpen
                  ? -1
                  : (wp.x + wp.y) % 2 >= 1
                    ? 1
                    : -1
            const signs = [primarySign, -primarySign]
            const candidates: [number, number][] = []
            for (const s of signs) {
              candidates.push([
                ent.x + (ux * 0.42 + s * px * 0.9) * slideDist,
                ent.y + (uy * 0.42 + s * py * 0.9) * slideDist,
              ])
              candidates.push([ent.x + s * px * slideDist, ent.y + s * py * slideDist])
            }
            for (const [cx, cy] of candidates) {
              if (isPointInsideWalkableGeometry(cx, cy)) {
                ent.x = cx
                ent.y = cy
                moved = true
                break
              }
            }
            if (!moved && r !== st.activeRole) {
              ent.waypoints = []
              ent.aiPauseUntil = time + 1.2
            }
          }

          if (moved) {
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
        } else {
          ent.isMoving = false
          ent.walkFrame = 0
        }
      }

      // Actualizar sala actual y cuadrante actual del jugador activo
      const activeEnt = astronautsRef.current[st.activeRole]
      const curRm = findRoomAtPoint(activeEnt.x, activeEnt.y)
      const nextRoomLabel = curRm ? curRm.label : 'CONNECTING CORRIDOR'
      setCurrentRoomLabel((prev) => (prev !== nextRoomLabel ? nextRoomLabel : prev))
      const detectedQuad = findQuadrantAtPoint(activeEnt.x, activeEnt.y)
      if (detectedQuad !== st.playerCurrentQuadrant) {
        setPlayerCurrentQuadrant(detectedQuad)
      }
      if (st.visitingQuadrant && detectedQuad === st.visitingQuadrant && activeEnt.isMoving) {
        setVisitingQuadrant(null)
      }

      // Actualizar consola cercana (propia o ajena) para mostrar [ PRESIONA 'E' ] o bloqueo de solo lectura
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

      // Todas las puertas entre pasillos y áreas se abren automáticamente al acercarse cualquiera de los 4 personajes
      for (const door of SLIDING_DOORS) {
        let minDist = Infinity
        for (const r of ROLE_ORDER) {
          const a = astronautsRef.current[r]
          const d = Math.hypot(a.x - door.x, a.y - door.y)
          if (d < minDist) minDist = d
        }
        const targetOpen = minDist < 155 ? 1 : 0
        const cur = doorOpenRef.current[door.id] ?? 0
        doorOpenRef.current[door.id] = cur + (targetOpen - cur) * Math.min(1, dt * 12)
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
      } else {
        // Seguimiento suave continuo sobre la posición (x, y) del personaje activo en pasillos o cualquier habitación
        targetZoom = curRm
          ? clamp(Math.min(cw / (curRm.hull.w + 96), ch / (curRm.hull.h + 84)), 0.72, 0.90)
          : 0.84
        targetCamX = activeEnt.x
        targetCamY = activeEnt.y
      }

      camRef.current.x += (targetCamX - camRef.current.x) * Math.min(1, dt * 7.5)
      camRef.current.y += (targetCamY - camRef.current.y) * Math.min(1, dt * 7.5)
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

          const hasCometThreat = st.activeThreats.some(
            (t) => t.game === 'comet' && t.role === st.activeRole
          )
          const cometPulse = hasCometThreat && time % 5 < 0.45
          const shakeX = cometPulse ? Math.round(Math.sin(time * 46) * 3.5) : 0
          const shakeY = cometPulse ? Math.round(Math.cos(time * 54) * 2.5) : 0

          ctx.save()
          ctx.translate(Math.round(cw / 2) + shakeX, Math.round(ch / 2) + shakeY)
          ctx.scale(camRef.current.zoom, camRef.current.zoom)
          ctx.translate(-camRef.current.x, -camRef.current.y)

          const canvasServerNowMs = Date.now() + serverClockOffsetRef.current
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
            activeThreats: st.activeThreats,
            completedMinigames: st.completedMinigames,
            consoleCooldowns: st.consoleCooldowns,
            serverNowMs: canvasServerNowMs,
            missionCompleted: st.missionCompleted,
            missionGames: new Set(missionGamesRef.current),
            activePlayerPos: { x: activeEnt.x, y: activeEnt.y },
            astronauts: astronautsRef.current,
          })

          if (activeEnt.waypoints.length > 0) {
            const dest = activeEnt.waypoints[activeEnt.waypoints.length - 1]
            ctx.strokeStyle = ROLE_INFO[st.activeRole].color
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(dest.x, dest.y + 10, 12 + Math.sin(time * 8) * 2, 0, Math.PI * 2)
            ctx.stroke()
          }

          // Los 4 especialistas ya fueron dibujados mediante Y-Sorting dentro de drawSpaceStationWorld;
          // recolectamos sus posiciones para las etiquetas pixel-art en Screen-Space.
          const visibleRoles: { role: RoleId; x: number; y: number }[] = ROLE_ORDER.map((r) => ({
            role: r,
            x: astronautsRef.current[r].x,
            y: astronautsRef.current[r].y,
          }))

          ctx.restore()

          // Interferencia visual sutil en pantalla SOLO para SERPIENTE-2 cuando ciberataque (puerto 8080) afecta su sector
          if (
            st.activeRole === 'comms' &&
            st.activeThreats.some((t) => t.game === 'cyber') &&
            Math.sin(time * 23) > 0.58
          ) {
            const gY = Math.round(((Math.sin(time * 37) + 1) * 0.5) * Math.max(40, ch - 36))
            ctx.fillStyle = Math.floor(time * 18) % 2 === 0 ? 'rgba(34, 211, 238, 0.20)' : 'rgba(248, 113, 113, 0.18)'
            ctx.fillRect(0, gY, Math.round(cw * 0.24), 2)
            ctx.fillRect(Math.round(cw * 0.76), Math.max(24, gY - 12), Math.round(cw * 0.24), 2)
          }

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

          // Etiquetas nítidas de los 4 personajes: [JUGADOR] SERPIENTE ● / [TÚ] / [BOT]
          const charNameFont =
            cw >= 540
              ? 'bold 8px "Press Start 2P", monospace'
              : 'bold 7px "Press Start 2P", monospace'
          for (const vr of visibleRoles) {
            const info = ROLE_INFO[vr.role]
            const isMe = vr.role === st.activeRole
            const remotePlayer =
              !isMe && !soloPracticeModeRef.current ? remotePlayersRef.current[vr.role] : undefined
            const isRemoteConnected = Boolean(remotePlayer)
            const rawX = (vr.x - camRef.current.x) * camRef.current.zoom + cw / 2
            const rawY = (vr.y - 46 - camRef.current.y) * camRef.current.zoom + ch / 2
            if (rawX < -70 || rawX > cw + 70 || rawY < -30 || rawY > ch + 30) continue

            const tagText = isRemoteConnected
              ? `[PLAYER] ${info.animalName}`
              : isMe && !soloPracticeModeRef.current && myClaimedRoleRef.current === vr.role
                ? `[YOU] ${info.animalName}`
                : !isMe
                  ? `[BOT] ${info.animalName}`
                  : info.animalName

            ctx.font = charNameFont
            const dotExtraW = isRemoteConnected ? 11 : 0
            const tw = Math.ceil(ctx.measureText(tagText).width + 12 + dotExtraW)
            const halfW = Math.ceil(tw / 2)
            const sx = clamp(Math.round(rawX), halfW + 4, cw - halfW - 4)
            const sy = clamp(Math.round(rawY), 34, ch - 30)
            const bx = Math.round(sx - tw / 2)

            ctx.fillStyle = isRemoteConnected
              ? 'rgba(4, 28, 18, 0.92)'
              : isMe
                ? 'rgba(9, 14, 28, 0.90)'
                : 'rgba(6, 10, 22, 0.78)'
            ctx.fillRect(bx, sy - 11, tw, 13)
            ctx.strokeStyle = isRemoteConnected
              ? '#22c55e'
              : isMe
                ? info.color
                : 'rgba(71, 85, 105, 0.85)'
            ctx.lineWidth = isRemoteConnected || isMe ? 1.5 : 1
            ctx.strokeRect(bx + 0.5, sy - 10.5, tw - 1, 12)

            if (isRemoteConnected) {
              // Punto verde brillante (●) indicando jugador humano conectado en red LAN
              const dotX = bx + 7
              const dotY = sy - 5
              ctx.fillStyle = '#052e16'
              ctx.fillRect(dotX - 3, dotY - 3, 6, 6)
              ctx.fillStyle = Math.sin(time * 5) > -0.6 ? '#4ade80' : '#22c55e'
              ctx.fillRect(dotX - 2, dotY - 2, 4, 4)
              drawOutlinedPixelText(
                tagText,
                sx + 5,
                sy - 1,
                info.color,
                charNameFont,
                'center',
                1
              )
            } else {
              const labelColor = !isMe && !soloPracticeModeRef.current ? '#94a3b8' : info.color
              drawOutlinedPixelText(tagText, sx, sy - 1, labelColor, charNameFont, 'center', 1)
            }
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
            const lockLabel = `🔒 Exclusive console for ${ownerInfoLock.animalName} — Read-only access`
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

          // El cartel superior de sala se renderiza en React (Fila 2 del stack vertical) para evitar solapamientos.

          // Indicador direccional pulsante en el borde de cámara hacia consola en fallo exclusiva de TU rol
          const myActiveThreatsCanvas = st.missionCompleted
            ? []
            : st.activeThreats
                .filter((t) => t.role === st.activeRole)
                .sort((a, b) => b.urgency - a.urgency)
          const primaryMyThreat = myActiveThreatsCanvas[0]
          let nextRemoteBannerSig = ''
          let nextRemoteBannerVal: {
            game: MinigameId
            consoleId: string
            sector: string
            distM: number
            arrow: string
            hint: string
            urgency: number
          } | null = null

          if (primaryMyThreat) {
            const tc = CONSOLES.find((cc) => cc.id === primaryMyThreat.consoleId)
            if (tc) {
              const dx = tc.x - activeEnt.x
              const dy = tc.y - activeEnt.y
              const distPx = Math.hypot(dx, dy)
              const distM = Math.max(1, Math.round(distPx / 18))
              const arrow = getDirectionArrow(dx, dy)
              const tcRoom = ROOM_BY_ID[tc.roomId]
              const sectorLabel = tcRoom
                ? tcRoom.label
                : UNIQUE_MINIGAME_DEFS[primaryMyThreat.game].quadrantTag
              const screenX = (tc.x - camRef.current.x) * camRef.current.zoom + cw / 2
              const screenY = (tc.y - camRef.current.y) * camRef.current.zoom + ch / 2
              const isOffCamera =
                screenX < 40 || screenX > cw - 40 || screenY < 36 || screenY > ch - 36
              const isFarAway = isOffCamera || curRm?.id !== tc.roomId || distPx > 210

              if (isFarAway) {
                const minX = 210
                const maxX = Math.max(minX + 20, cw - 260)
                const minY = 135
                const maxY = Math.max(minY + 20, ch - 140)
                const safeCx = Math.round((minX + maxX) / 2)
                const safeCy = Math.round((minY + maxY) / 2)
                const dirX = screenX - safeCx
                const dirY = screenY - safeCy
                const ang = Math.atan2(dirY, dirX)
                const maxRx = Math.max(12, (maxX - minX) / 2)
                const maxRy = Math.max(12, (maxY - minY) / 2)
                const cosA = Math.cos(ang)
                const sinA = Math.sin(ang)
                const scaleEdge = Math.min(
                  Math.abs(cosA) > 0.001 ? maxRx / Math.abs(cosA) : 9999,
                  Math.abs(sinA) > 0.001 ? maxRy / Math.abs(sinA) : 9999
                )
                const edgeX = clamp(Math.round(safeCx + cosA * scaleEdge), minX, maxX)
                const edgeY = clamp(Math.round(safeCy + sinA * scaleEdge), minY, maxY)
                const arrowPulse = 0.72 + 0.28 * Math.sin(time * 9)

                ctx.save()
                ctx.translate(edgeX, edgeY)
                ctx.globalAlpha = arrowPulse
                ctx.fillStyle = 'rgba(127, 29, 29, 0.92)'
                ctx.beginPath()
                ctx.arc(0, 0, 14, 0, Math.PI * 2)
                ctx.fill()
                ctx.strokeStyle = primaryMyThreat.urgency >= 65 ? '#f87171' : '#fde047'
                ctx.lineWidth = 2
                ctx.stroke()
                ctx.save()
                ctx.rotate(ang)
                ctx.fillStyle = '#fde047'
                ctx.beginPath()
                ctx.moveTo(8, 0)
                ctx.lineTo(-5, -6)
                ctx.lineTo(-2, 0)
                ctx.lineTo(-5, 6)
                ctx.closePath()
                ctx.fill()
                ctx.restore()
                ctx.restore()

                drawOutlinedPixelText(
                  `${distM}m`,
                  edgeX,
                  edgeY + 22 > maxY ? edgeY - 17 : edgeY + 22,
                  '#fde047',
                  'bold 7px "Press Start 2P", monospace',
                  'center',
                  1
                )

                nextRemoteBannerSig = `${primaryMyThreat.game}:${tc.roomId}:${distM}:${arrow}`
                nextRemoteBannerVal = {
                  game: primaryMyThreat.game,
                  consoleId: tc.id,
                  sector: sectorLabel,
                  distM,
                  arrow,
                  hint: UNIQUE_MINIGAME_DEFS[primaryMyThreat.game].actionHint,
                  urgency: Math.round(primaryMyThreat.urgency),
                }
              }
            }
          }
          if (nextRemoteBannerSig !== remoteAlertSigRef.current) {
            remoteAlertSigRef.current = nextRemoteBannerSig
            setRemoteAlertBanner(nextRemoteBannerVal)
          }

          // Abajo al centro: [ PRESIONA "E" VER CONSOLA ], [ 🟢 ESTABILIZADO (Enfriamiento: XXs) ] o bloqueo de rol
          const promptCid = st.nearestConsoleId ?? st.hoveredConsoleId
          const promptConsole = promptCid ? CONSOLES.find((c) => c.id === promptCid) ?? null : null
          if (promptConsole) {
            const canOperate = canUseConsole(promptConsole, st.activeRole)
            const promptMg = CONSOLE_MINIGAME[promptConsole.id]
            const isReserveConsole = Boolean(
              canOperate && promptMg && !missionGamesRef.current.includes(promptMg)
            )
            const promptCdExp =
              canOperate && !isReserveConsole && promptMg
                ? st.consoleCooldowns[promptMg]
                : undefined
            const isCooldownConsole = Boolean(
              typeof promptCdExp === 'number' && promptCdExp > canvasServerNowMs
            )
            const promptCdSecLeft =
              isCooldownConsole && typeof promptCdExp === 'number'
                ? Math.max(1, Math.ceil((promptCdExp - canvasServerNowMs) / 1000))
                : 0
            const isSolvedConsole = Boolean(
              canOperate &&
                !isReserveConsole &&
                promptMg &&
                (isCooldownConsole || (st.missionCompleted && st.completedMinigames.has(promptMg)))
            )
            const promptText = !canOperate
              ? `🔒 Exclusive console for ${ROLE_INFO[promptConsole.role].animalName} — Read-only access`
              : isReserveConsole
              ? '[ STANDBY MODULE · LATER STAGE ]'
              : isCooldownConsole
              ? `[ 🟢 STABILIZED (Cooldown: ${promptCdSecLeft}s) ]`
              : isSolvedConsole
              ? '[ SYSTEM STABILIZED ✅ ]'
              : '[ PRESS "E" TO INSPECT CONSOLE ]'
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

            if (canOperate && !isSolvedConsole && !isReserveConsole) {
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

            ctx.fillStyle = !canOperate
              ? 'rgba(42, 8, 12, 0.96)'
              : isReserveConsole
              ? 'rgba(15, 23, 42, 0.92)'
              : isSolvedConsole
              ? 'rgba(6, 36, 22, 0.95)'
              : 'rgba(4, 7, 17, 0.94)'
            ctx.fillRect(px, ch - 25, pw, 19)
            ctx.strokeStyle = !canOperate
              ? '#f59e0b'
              : isReserveConsole
              ? '#64748b'
              : isSolvedConsole
              ? '#34d399'
              : '#fbbf24'
            ctx.lineWidth = 1.5
            ctx.strokeRect(px + 0.5, ch - 24.5, pw - 1, 18)
            drawOutlinedPixelText(
              promptText,
              cw / 2,
              ch - 11,
              !canOperate
                ? '#fca5a5'
                : isReserveConsole
                ? '#94a3b8'
                : isSolvedConsole
                ? '#6ee7b7'
                : '#fde047',
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

    // Paso 100% libre por todas las salas y pasillos de la estación al hacer clic
    const walkTarget = findNearestWalkablePoint(wx, wy)
    if (walkTarget) {
      setVisitingQuadrant(null)
      setOverviewMode(false)
      const me = astronautsRef.current[activeRole]
      me.waypoints = buildWaypointPath(me.x, me.y, walkTarget.x, walkTarget.y)
      playClick()
    }
  }

  const pilotNamesByRole = useMemo<Record<RoleId, string>>(() => {
    const out = {} as Record<RoleId, string>
    for (const r of ROLE_ORDER) {
      out[r] =
        r === activeRole
          ? playerName
          : (!soloPracticeMode
              ? remotePlayerRoles[r] || roleClaims[r]?.playerName
              : undefined) ||
            roleClaims[r]?.playerName ||
            `AI ${ROLE_INFO[r].animalName}`
    }
    return out
  }, [activeRole, playerName, soloPracticeMode, remotePlayerRoles, roleClaims])

  const lastLog = logs[logs.length - 1]
  const openConsoleTask = useMemo(
    () => (openConsole ? activeTasks.find((t) => t.consoleId === openConsole.id) ?? null : null),
    [activeTasks, openConsole]
  )

  const myActiveThreats = useMemo(
    () => activeThreats.filter((t) => t.role === activeRole),
    [activeThreats, activeRole]
  )

  const myCooldownItems = useMemo(() => {
    return missionGames
      .filter((g) => {
        if (UNIQUE_MINIGAME_DEFS[g].role !== activeRole) return false
        const exp = consoleCooldowns[g]
        return typeof exp === 'number' && exp > cooldownNowMs
      })
      .map((g) => ({
        game: g,
        def: UNIQUE_MINIGAME_DEFS[g],
        secLeft: Math.max(1, Math.ceil(((consoleCooldowns[g] ?? 0) - cooldownNowMs) / 1000)),
      }))
  }, [activeRole, consoleCooldowns, cooldownNowMs, missionGames])

  const myPendingBacklog = useMemo(() => {
    const activeGames = new Set(activeThreats.map((t) => t.game))
    return MISSION_BACKLOG.filter(
      (m) =>
        m.role === activeRole &&
        missionGames.includes(m.game) &&
        !activeGames.has(m.game) &&
        !((consoleCooldowns[m.game] ?? 0) > cooldownNowMs)
    )
  }, [activeRole, activeThreats, consoleCooldowns, cooldownNowMs, missionGames])

  const completedBacklog = useMemo(
    () =>
      MISSION_BACKLOG.filter(
        (m) => missionGames.includes(m.game) && completedMinigames.has(m.game)
      ),
    [completedMinigames, missionGames]
  )

  const formatThreatMetric = useCallback(
    (t: ActiveThreat): string => {
      switch (t.game) {
        case 'lander':
          return `ALT ${Math.round(t.probeAlt)}m ↓`
        case 'comet':
          return `HULL ${Math.round(hull)}%`
        case 'dock':
          return `ORBIT ${Math.round(orbitStability)}%`
        case 'gyro':
          return `ATT ${Math.round(orbitStability)}%`
        case 'debris':
          return `DEB ${Math.round(hull)}%`
        case 'eps':
          return `BAT ${Math.round(battery)}%`
        case 'eclss':
          return `O2 ${Math.round(lifeSupport)}%`
        case 'reactor':
          return `CORE ${Math.round(battery)}%`
        case 'pcb':
          return `BUS ${Math.round(battery)}%`
        case 'nav':
          return `SAT-02 ${Math.round(signalQuality)}%`
        case 'spectro':
          return `SPEC ${Math.round(dataBuffer)}% ↑`
        case 'thermal':
          return `IR ${Math.round(signalQuality)}%`
        case 'telecom':
          return `BUF ${Math.round(dataBuffer)}% ↑`
        case 'hga':
          return `HGA ${Math.round(signalQuality)}%`
        case 'cyber':
          return `NET ${Math.round(signalQuality)}%`
        case 'decrypt':
          return `QKD ${Math.round(signalQuality)}%`
      }
    },
    [battery, dataBuffer, hull, lifeSupport, orbitStability, signalQuality]
  )

  const liveThreatProps = useMemo(() => {
    if (!activeMinigame) {
      return {
        threatQuery: undefined,
        threatState: undefined,
      }
    }
    const threat = activeThreats.find((t) => t.game === activeMinigame)
    const alt = Math.round(threat?.probeAlt ?? 500)
    const attempt = threat?.attempt ?? (attemptCountsRef.current[activeMinigame] ?? 0) + 1
    const seed = threat?.seed ?? (attempt * 1337 + activeMinigame.charCodeAt(0) * 31)
    const stateObj: Record<string, number | string> = {
      game: activeMinigame,
      mission: activeMissionId,
      diff: missionDiff,
      attempt,
      seed,
      alt,
      hull: Math.round(hull),
      battery: Math.round(battery),
      o2: Math.round(lifeSupport),
      orbit: Math.round(orbitStability),
      signal: Math.round(signalQuality),
      buffer: Math.round(dataBuffer),
      urgency: Math.round(threat?.urgency ?? 0),
    }
    const q = `diff=${missionDiff}&attempt=${attempt}&seed=${seed}&alt=${stateObj.alt}&hull=${stateObj.hull}&battery=${stateObj.battery}&o2=${stateObj.o2}&orbit=${stateObj.orbit}&signal=${stateObj.signal}&buffer=${stateObj.buffer}`
    return {
      threatQuery: q,
      threatState: stateObj,
    }
  }, [
    activeMinigame,
    activeMissionId,
    activeThreats,
    battery,
    dataBuffer,
    hull,
    lifeSupport,
    missionDiff,
    orbitStability,
    signalQuality,
  ])

  const hpRounded = Math.max(0, Math.min(100, Math.round(stationHealth)))
  const hpCritical = hpRounded < 35
  const hpAmber = hpRounded >= 35 && hpRounded < 65

  return (
    <div
      className={`relative w-full h-full flex flex-col font-pixel text-white overflow-hidden select-none transition-transform duration-75 ${
        healthDamageFlash ? 'translate-x-1 -translate-y-0.5' : ''
      }`}
      style={{ background: '#050711' }}
    >
      {healthDamageFlash && (
        <div
          className="pointer-events-none fixed inset-0 z-[150] border-4 border-red-500 animate-pulse"
          style={{
            background:
              'radial-gradient(circle at center, rgba(239,68,68,0.06) 35%, rgba(220,38,38,0.42) 100%)',
          }}
        />
      )}
      {/* =====================================================================
          HEADER SUPERIOR COMPACTO (SIN BARRAS HORIZONTALES ANCHAS DE MISIONES)
         ===================================================================== */}
      <header
        className="flex flex-wrap items-center justify-between gap-1 px-2 py-0.5 shrink-0 border-b-4 border-black z-30 overflow-x-hidden min-w-0"
        style={{ background: '#10142a', boxShadow: '0 2px 0 #2e3866' }}
      >
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <button
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              onExitToMenu()
            }}
            className="mc-btn px-1.5 py-0.5 text-[clamp(8px,0.62vw,9px)] shrink-0 whitespace-nowrap"
            title="Leave room and return to main menu"
          >
            ← MENU
          </button>
          <button
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              onBackToWorkshop()
            }}
            className="mc-btn px-1.5 py-0.5 text-[clamp(8px,0.62vw,9px)] shrink-0 whitespace-nowrap"
          >
            🛠️ WORKSHOP
          </button>
          <div className="min-w-0">
            <div className="text-[clamp(8.5px,0.72vw,11px)] text-cyan-300 truncate">
              🛰️ STATION · STAGE {activeMissionDef.number}/3 · {activeMissionDef.code} (
              {contract.orbit})
            </div>
            <div className="text-[clamp(7px,0.58vw,8px)] text-gray-300 truncate">
              MODULE: <strong style={{ color: activeRoleInfo.color }}>{currentRoomLabel}</strong> ·{' '}
              <span className="text-yellow-300">WASD / ARROWS · &quot;E&quot; / SPACE CONSOLES</span>
            </div>
          </div>
        </div>

        {/* Telemetría vital ultra-compacta en píldoras (cero barras anchas) */}
        <div className="hidden lg:flex items-center gap-1 text-[clamp(7px,0.58vw,8px)] shrink-0">
          <span
            className={`px-1 py-0.5 border whitespace-nowrap ${
              battery < 60 ? 'border-amber-400 bg-[#2b1d0e] text-amber-200' : 'border-black bg-[#090c1a] text-yellow-300'
            }`}
          >
            ⚡{Math.round(battery)}%
          </span>
          <span
            className={`px-1 py-0.5 border whitespace-nowrap ${
              isLowO2 ? 'border-amber-400 bg-[#2b1d0e] text-amber-200 animate-pulse' : 'border-black bg-[#090c1a] text-cyan-300'
            }`}
          >
            🫧{Math.round(lifeSupport)}%
          </span>
          <span
            className={`px-1 py-0.5 border whitespace-nowrap ${
              dataBuffer >= 50 ? 'border-emerald-400 bg-[#0d2e24] text-emerald-200' : 'border-black bg-[#090c1a] text-emerald-300'
            }`}
          >
            💾{Math.round(dataBuffer)}%
          </span>
          <span
            className={`px-1 py-0.5 border whitespace-nowrap ${
              isOrbitDrift ? 'border-amber-400 bg-[#2b1d0e] text-amber-200 animate-pulse' : 'border-black bg-[#090c1a] text-purple-300'
            }`}
          >
            🧭{Math.round(orbitStability)}%
          </span>
          <span
            className={`px-1 py-0.5 border whitespace-nowrap ${
              hull < 70 || signalQuality < 70 || (activeRole === 'comms' && activeThreats.some((t) => t.game === 'cyber'))
                ? 'border-red-400 bg-[#2d0c16] text-red-200 animate-pulse'
                : 'border-black bg-[#090c1a] text-blue-300'
            }`}
          >
            🛡️{Math.round(hull)}%·📡{Math.round(signalQuality)}%
          </span>
        </div>

        {/* Conmutador Rápido de Especialista (1-4) + Sala de Roles + Finalizar */}
        <div className="flex flex-wrap items-center gap-1 shrink-0 min-w-0 max-w-full">
          <span
            className="text-[clamp(7px,0.55vw,8px)] px-1.5 py-0.5 border border-black font-bold whitespace-nowrap max-w-[115px] truncate"
            style={{
              background: soloPracticeMode ? '#1e293b' : syncConnected ? '#052e16' : '#3b0712',
              color: soloPracticeMode ? '#fde047' : syncConnected ? '#7bff9a' : '#fda4af',
            }}
            title={
              soloPracticeMode
                ? 'Solo Practice Mode active'
                : syncConnected
                  ? `Connected to room ${activeRoomCode ?? 'SQUADRON-DEFAULT'}`
                  : 'Disconnected from /api/roles-sync'
            }
          >
            {soloPracticeMode
              ? '👤 SOLO'
              : activeRoomCode
                ? `${syncConnected ? '🔑' : '⚠️'} ${activeRoomCode}`
                : syncConnected
                  ? '🌐 LAN'
                  : '🌐 OFF'}
          </span>
          {ROLE_ORDER.map((r, i) => {
            const info = ROLE_INFO[r]
            const on = activeRole === r
            const claim = roleClaims[r]
            const remoteLiveName = !soloPracticeMode ? remotePlayerRoles[r] : undefined
            const locked = isRoleLockedByOther(r)
            const lockedOwnerName = remoteLiveName ?? claim?.playerName ?? 'OTHER'
            const isPrimaryMine = !soloPracticeMode && r === myClaimedRole
            const isVacantBot = !soloPracticeMode && !locked && r !== myClaimedRole
            const hasTaskForRole = activeTasks.some((t) => t.role === r)
            const isMyRoleIssue = hasTaskForRole && on
            return (
              <button
                key={r}
                disabled={locked}
                onMouseEnter={locked ? undefined : playHover}
                title={
                  locked
                    ? `🔒 Locked by ${lockedOwnerName}`
                    : isVacantBot
                      ? `${info.code} [BOT / OPEN] - Vacant, click to operate`
                      : `Your specialist (${info.code})`
                }
                onClick={() => {
                  if (locked) return
                  if (!soloPracticeMode && !myClaimedRole) {
                    void claimRoleRemote(r)
                    return
                  }
                  playClick()
                  setVisitingQuadrant(null)
                  setOpenConsoleId(null)
                  actions.setRole(r)
                }}
                className={`text-[clamp(7.5px,0.6vw,9px)] px-1.5 py-0.5 flex items-center gap-1 whitespace-nowrap min-w-0 ${
                  locked ? 'opacity-45 cursor-not-allowed' : ''
                }`}
                style={{
                  background: locked ? '#0b0e1c' : on ? '#2a3f8f' : '#1b2038',
                  color: locked ? '#64748b' : on ? info.color : '#cbd5e1',
                  border: `2px solid ${
                    locked
                      ? '#334155'
                      : isMyRoleIssue
                        ? '#fde047'
                        : on
                          ? '#fff'
                          : isPrimaryMine
                            ? '#4ade80'
                            : '#000'
                  }`,
                }}
              >
                <span className="shrink-0">{locked ? '🔒' : info.icon}</span>
                <span className="shrink-0">
                  [{i + 1}: {info.animalName}]
                </span>
                {locked && (
                  <span className="text-[clamp(6.5px,0.52vw,7.5px)] text-amber-300 font-bold max-w-[52px] truncate">
                    {lockedOwnerName.slice(0, 6)}
                  </span>
                )}
                {isPrimaryMine && <span className="text-[7px] text-emerald-300 shrink-0">★</span>}
                {isVacantBot && !on && (
                  <span className="px-1 bg-cyan-950 border border-cyan-500/60 text-cyan-200 text-[6px] shrink-0">
                    OPEN
                  </span>
                )}
                {isMyRoleIssue ? (
                  <span className="px-1 bg-yellow-400 text-black text-[7px] font-bold shrink-0 animate-pulse">
                    !
                  </span>
                ) : hasTaskForRole ? (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                    title="Squadmate handling active anomaly"
                  />
                ) : null}
              </button>
            )
          })}
          <button
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              setSyncErrorMsg(null)
              setRoleLobbyOpen(true)
            }}
            className="mc-btn px-1.5 py-0.5 text-[clamp(7.5px,0.6vw,9px)] whitespace-nowrap"
            style={{ background: '#1e1b4b', color: '#a5b4fc', borderColor: '#6366f1' }}
          >
            👥 SWITCH / ROLE LOBBY
          </button>
          <button
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              startVictoryCinematicFlow()
            }}
            className="mc-btn px-1.5 py-0.5 text-[clamp(7.5px,0.6vw,9px)] whitespace-nowrap"
            style={{ background: '#15803d', color: '#7bff9a', borderColor: '#7bff9a' }}
          >
            🏆 FINISH MISSION
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

          {/* STACK VERTICAL CENTRAL SUPERIOR (CERO SOLAPAMIENTO ENTRE VIDA, SALA, VISITA Y ALERTAS) */}
          <div
            className={`pointer-events-none absolute top-2 left-12 z-30 flex flex-col items-center gap-1.5 min-w-0 pt-7 lg:pt-0 ${
              missionPanelOpen ? 'right-[240px] lg:right-[472px]' : 'right-14 sm:right-[290px]'
            }`}
          >
            {/* Fila 1 (top-2): Barra compacta ❤️ STATION HULL & CORE INTEGRITY */}
            <div
              className={`pointer-events-auto w-full max-w-md flex items-center gap-2 px-2.5 py-1 border-2 shadow-lg ${
                hpCritical
                  ? 'border-red-500 bg-[#2a070f]/95 animate-pulse shadow-[0_0_16px_rgba(239,68,68,0.65)]'
                  : hpAmber
                    ? 'border-amber-400 bg-[#1f1505]/95'
                    : 'border-amber-500/80 bg-[#080e1e]/92'
              }`}
            >
              <span
                className={`shrink-0 text-[10px] font-sans font-bold whitespace-nowrap ${
                  hpCritical ? 'text-red-300' : hpAmber ? 'text-amber-300' : 'text-emerald-300'
                }`}
              >
                ❤️ STATION HULL &amp; CORE INTEGRITY ({hpRounded}%)
              </span>
              <div className="flex-1 min-w-[64px] h-2.5 bg-black border border-slate-700 overflow-hidden">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${hpRounded}%`,
                    background: hpCritical
                      ? 'linear-gradient(90deg, #dc2626 0%, #ef4444 100%)'
                      : hpAmber
                        ? 'linear-gradient(90deg, #d97706 0%, #f59e0b 100%)'
                        : 'linear-gradient(90deg, #16a34a 0%, #22c55e 100%)',
                  }}
                />
              </div>
              <span
                className={`shrink-0 text-[10px] font-sans font-bold tabular-nums ${
                  hpCritical ? 'text-red-400' : hpAmber ? 'text-amber-300' : 'text-emerald-300'
                }`}
              >
                {hpRounded}%
              </span>
            </div>

            {/* Fila 2: Nombre de sala actual + Visitando sector + Volver integrado en la misma píldora */}
            {(() => {
              const effectiveOwnerHud = visitingQuadrant ?? playerCurrentQuadrant
              const isForeignHud = !overviewMode && effectiveOwnerHud !== activeRole
              const roomTitleHud = overviewMode
                ? 'STATION MAP'
                : visitingQuadrant
                  ? `OBS: ${QUADRANT_DEFS[visitingQuadrant].roomsSummary}`
                  : `${currentRoomLabel}${isForeignHud ? ' · READ-ONLY' : ''}`
              return (
                <div
                  className={`pointer-events-auto max-w-[520px] w-fit px-3 py-1 border flex items-center justify-center gap-2 shadow-lg min-w-0 ${
                    isForeignHud
                      ? 'border-red-400/80 bg-[#2a0e12]/92 text-red-200'
                      : 'border-slate-600 bg-[#040711]/90 text-amber-300'
                  }`}
                >
                  <span className="text-[11px] font-sans font-bold tracking-wide truncate min-w-0">
                    {roomTitleHud}
                  </span>
                  {isForeignHud && (
                    <>
                      <span className="text-[10px] font-sans text-cyan-200 truncate min-w-0">
                        · VISITING SECTOR OF{' '}
                        <strong style={{ color: ROLE_INFO[effectiveOwnerHud].color }}>
                          {ROLE_INFO[effectiveOwnerHud].icon}{' '}
                          {ROLE_INFO[effectiveOwnerHud].animalName}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          playClick()
                          teleportActivePlayerTo(
                            ROLE_SPAWNS[activeRole].x,
                            ROLE_SPAWNS[activeRole].y,
                            ROLE_INFO[activeRole].animalName,
                            activeRoleInfo.color
                          )
                        }}
                        className="shrink-0 px-2 py-0.5 bg-amber-900/95 border border-amber-400 text-[10px] font-sans font-bold text-amber-100 hover:bg-amber-700 whitespace-nowrap"
                      >
                        🎯 RETURN TO MY SECTOR
                      </button>
                    </>
                  )}
                </div>
              )
            })()}

            {/* Fila 3: Alerta de bloqueo de consola ajena */}
            {visitorAlert && (
              <div className="pointer-events-auto max-w-xl w-full px-3.5 py-2 border-2 border-red-400 bg-[#2a090d]/95 shadow-2xl text-center">
                <div className="text-[11px] font-sans text-red-200 font-bold leading-snug">
                  {visitorAlert.msg}
                </div>
                <div className="text-[10px] font-sans text-amber-300 mt-0.5">
                  EXCLUSIVE OWNER: {ROLE_INFO[visitorAlert.owner].icon}{' '}
                  {ROLE_INFO[visitorAlert.owner].code} ·{' '}
                  {isRoleLockedByOther(visitorAlert.owner)
                    ? `🔒 LOCKED BY ${
                        (
                          remotePlayerRoles[visitorAlert.owner] ??
                          roleClaims[visitorAlert.owner]?.playerName ??
                          'OTHER PILOT'
                        ).toUpperCase()
                      } — READ-ONLY`
                    : 'VACANT ROLE [BOT/OPEN] · OPERATE WITH KEYS [1-4]'}
                </div>
              </div>
            )}

            {/* Fila 3 (alterna): Banner compacto exclusivo de fallo remoto en tu propio sector */}
            {!visitorAlert && !missionCompleted && remoteAlertBanner && (
              <button
                type="button"
                onClick={() => {
                  playClick()
                  const tc = CONSOLES.find((cc) => cc.id === remoteAlertBanner.consoleId)
                  if (tc) openOrWalkToConsole(tc)
                }}
                className={`pointer-events-auto max-w-xl w-full px-3 py-1.5 border-2 text-left shadow-xl transition-all hover:brightness-110 ${
                  remoteAlertBanner.urgency >= 65
                    ? 'border-red-400 bg-[#2d0a12]/95 text-red-100'
                    : 'border-amber-400 bg-[#221706]/95 text-amber-100'
                }`}
                title="Click to navigate directly to the affected console"
              >
                <div className="flex items-center justify-between gap-2 text-[10px] font-sans font-bold leading-snug">
                  <span className="truncate">
                    ⚠️ [SECTOR ALERT - {remoteAlertBanner.sector} ({remoteAlertBanner.distM}m away{' '}
                    <span className="text-yellow-300">{remoteAlertBanner.arrow}</span>)]:{' '}
                    <span className="text-white font-normal">{remoteAlertBanner.hint}</span>
                  </span>
                  <span className="shrink-0 text-[9px] text-yellow-300 uppercase">
                    {remoteAlertBanner.urgency >= 65 ? 'CRITICAL · ENGAGE ▶' : 'CAUTION · ENGAGE ▶'}
                  </span>
                </div>
              </button>
            )}
          </div>

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
              {overviewMode ? '🔍 FOLLOW CREW' : '👁️ GLOBAL MAP'}
            </button>
          </div>

          {/* =================================================================
              MINIMAPA INTERACTIVO DE LOS 4 SECTORES (CLIC PARA TELETRANSPORTAR SIN CAMBIAR DE ROL)
             ================================================================= */}
          <div
            className="mc-panel absolute bottom-2 left-2 z-20 p-1.5 w-72 border-2 border-cyan-500/50"
            style={{ background: 'rgba(8, 12, 26, 0.90)', backdropFilter: 'blur(4px)' }}
          >
            <div className="flex items-center justify-between text-[7px] text-cyan-300 mb-1">
              <span>🗺️ 4 SECTORS · CLICK TO JUMP</span>
              <button
                onClick={() => {
                  playClick()
                  if (playerCurrentQuadrant !== activeRole) {
                    teleportActivePlayerTo(
                      ROLE_SPAWNS[activeRole].x,
                      ROLE_SPAWNS[activeRole].y,
                      ROLE_INFO[activeRole].animalName,
                      activeRoleInfo.color
                    )
                  } else {
                    setOverviewMode(false)
                    setVisitingQuadrant(null)
                  }
                }}
                className="px-1 py-0.5 bg-slate-800 border border-slate-600 text-yellow-300 hover:bg-slate-700"
              >
                🎯 ME
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1 bg-[#050814] p-1 border border-black">
              {MINIMAP_SPATIAL_ORDER.map((qid) => {
                const q = QUADRANT_DEFS[qid]
                const ownerInfo = ROLE_INFO[qid]
                const hasIssue = activeTasks.some((t) => t.role === qid)
                const isPlayerHere = playerCurrentQuadrant === qid
                const isOwnerMe = activeRole === qid
                return (
                  <button
                    key={qid}
                    onClick={() => {
                      playClick()
                      const dest = qid === activeRole ? ROLE_SPAWNS[activeRole] : q.entryPoint
                      teleportActivePlayerTo(dest.x, dest.y, q.roomsSummary, ownerInfo.color)
                    }}
                    className={`relative p-1 text-left border transition-colors ${
                      hasIssue && isOwnerMe
                        ? 'border-amber-400'
                        : isPlayerHere
                          ? 'border-white'
                          : 'border-slate-800'
                    }`}
                    style={{
                      background: isPlayerHere
                        ? 'rgba(30, 41, 59, 0.9)'
                        : 'rgba(12, 18, 36, 0.85)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-1 text-[7px] leading-none mb-0.5">
                      <span className="truncate font-bold" style={{ color: ownerInfo.color }}>
                        {ownerInfo.icon} S{q.sectorNum} {isOwnerMe ? '·YOU' : ''}
                      </span>
                      {hasIssue && isOwnerMe ? (
                        <span className="px-1 bg-red-600 text-yellow-200 font-bold animate-pulse">
                          !
                        </span>
                      ) : hasIssue ? (
                        <span
                          className="text-amber-400 font-bold"
                          title="Squadmate handling anomaly in this sector"
                        >
                          ●
                        </span>
                      ) : (
                        <span className="text-emerald-400 font-bold">●</span>
                      )}
                    </div>

                    {/* Esquema SVG del cuadrante (clic en cualquier sala teletransporta directo allí) */}
                    <svg viewBox="0 0 100 64" className="w-full h-8 bg-[#040711] border border-slate-900">
                      {q.miniRooms.map((mr, idx) => {
                        const targetRm = ROOM_BY_ID[mr.roomId]
                        return (
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
                            className="cursor-pointer hover:opacity-80"
                            onClick={(e) => {
                              e.stopPropagation()
                              playClick()
                              teleportActivePlayerTo(
                                targetRm.navX,
                                targetRm.navY,
                                targetRm.label,
                                ownerInfo.color
                              )
                            }}
                          >
                            <title>{targetRm.label}</title>
                          </rect>
                        )
                      })}
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
                ? `📋 MISSIONS (${Math.round(missionProgress)}%) ▾`
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
                  <div className="flex items-center justify-between text-[7px] text-cyan-300 mb-0.5 truncate">
                    <span>🎯 {activeMissionDef.code}</span>
                    <span>STAGE {activeMissionDef.number}/3</span>
                  </div>
                  <div className="flex items-center justify-between text-[8px]">
                    <span className="text-yellow-300">
                      ⏱️ PROGRESS {missionProgress}% ({resolvedCount}/{missionTargetCount})
                    </span>
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

                {/* 👥 ESTADO DISCRETO DE LOS 4 ESPECIALISTAS (PUNTO ● PARA COMPAÑEROS) */}
                <div className="p-1.5 bg-[#050814]/75 border border-slate-800">
                  <div className="text-[6.5px] text-slate-400 font-bold mb-1">
                    👥 SQUADRON (YOUR ROLE + CREW)
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {ROLE_ORDER.map((r) => {
                      const info = ROLE_INFO[r]
                      const hasRoleIssue = activeThreats.some((t) => t.role === r)
                      const isMeRole = r === activeRole
                      return (
                        <div
                          key={r}
                          className={`flex items-center justify-between px-1.5 py-0.5 border text-[6.5px] ${
                            isMeRole
                              ? 'border-cyan-500/70 bg-cyan-950/35'
                              : 'border-slate-800 bg-[#090e1d]'
                          }`}
                        >
                          <span className="truncate font-bold" style={{ color: info.color }}>
                            {info.icon} {info.animalName}
                          </span>
                          <span
                            className={
                              hasRoleIssue
                                ? isMeRole
                                  ? 'text-red-400 font-bold'
                                  : 'text-amber-400 font-bold'
                                : 'text-emerald-400'
                            }
                            title={
                              hasRoleIssue
                                ? 'Active anomaly'
                                : 'Sector nominal'
                            }
                          >
                            {isMeRole && hasRoleIssue ? '!' : '●'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 🔴 / 🟡 TUS ALERTAS ACTIVAS (EXCLUSIVAS DE TU ROL PARA CERO SATURACIÓN) */}
                <div>
                  <div className="text-[7px] text-red-300 font-bold mb-1 tracking-wide">
                    🔴 YOUR ALERTS ({myActiveThreats.length})
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {myActiveThreats.length === 0 && (
                      <div className="p-1.5 border border-emerald-700/60 bg-emerald-950/30 text-[7px] text-emerald-200">
                        ✅ Your sector ({activeRoleInfo.animalName}) is currently nominal.
                      </div>
                    )}
                    {myActiveThreats.map((t, idx) => {
                      const tOwner = ROLE_INFO[t.role]
                      const def = UNIQUE_MINIGAME_DEFS[t.game]
                      const liveMetric = formatThreatMetric(t)
                      const isUrgent = t.urgency >= 50
                      const urgColor =
                        t.urgency >= 75 ? '#f87171' : t.urgency >= 45 ? '#fbbf24' : '#38bdf8'
                      const c = CONSOLES.find((cc) => cc.id === t.consoleId)
                      const tcRoomLabel = c ? ROOM_BY_ID[c.roomId].label : def.quadrantTag
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            playClick()
                            if (c) {
                              openOrWalkToConsole(c)
                            } else {
                              const dest = QUADRANT_DEFS[t.role].entryPoint
                              teleportActivePlayerTo(dest.x, dest.y, tOwner.animalName, tOwner.color)
                            }
                          }}
                          className={`w-full text-left p-1.5 border text-[7px] leading-snug transition-colors ${
                            isUrgent || idx === 0
                              ? 'border-red-400/90 bg-red-950/45'
                              : 'border-amber-500/80 bg-amber-950/45'
                          } hover:bg-slate-800/80`}
                        >
                          <div className="flex items-center justify-between gap-1 font-bold">
                            <span>
                              {isUrgent ? '🔴' : '🟡'} {tcRoomLabel}
                            </span>
                            <span
                              className="px-1 py-0.5 text-[6px] border border-black"
                              style={{ background: '#070b18', color: urgColor }}
                            >
                              {liveMetric}
                            </span>
                          </div>
                          <div className="text-white mt-0.5 font-bold">{t.title}</div>
                          <div className="text-[6px] text-amber-200/90 mt-0.5">{def.actionHint}</div>
                          <div className="w-full h-1 bg-black mt-1">
                            <div
                              className="h-full transition-all duration-300"
                              style={{ width: `${Math.round(t.urgency)}%`, background: urgColor }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[6px] text-cyan-300 mt-0.5">
                            <span>{def.quadrantTag}</span>
                            <span>GO ▶</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 🟢 SISTEMAS EN ENFRIAMIENTO (35s - 50s ANTES DE POSIBLE REACTIVACIÓN) */}
                {myCooldownItems.length > 0 && (
                  <div>
                    <div className="text-[7px] text-emerald-300 font-bold mb-1">
                      🟢 STABILIZED ({myCooldownItems.length})
                    </div>
                    <div className="flex flex-col gap-1">
                      {myCooldownItems.map((item) => (
                        <div
                          key={item.game}
                          className="px-1.5 py-1 border border-emerald-800/80 bg-emerald-950/30 text-[6.5px] text-emerald-200"
                        >
                          <div className="font-bold truncate">
                            🟢 {item.def.title}
                          </div>
                          <div className="text-emerald-300/90 mt-0.5">
                            Cooldown: {item.secLeft}s
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ⏳ PENDIENTES DISPONIBLES EN TU SECTOR */}
                <div>
                  <div className="text-[7px] text-amber-200 font-bold mb-1">
                    ⏳ YOUR QUEUE ({myPendingBacklog.length})
                  </div>
                  <div className="flex flex-col gap-1">
                    {myPendingBacklog.map((m) => {
                      const mOwner = ROLE_INFO[m.role]
                      return (
                        <button
                          key={m.id}
                          onClick={() => {
                            playClick()
                            const targetC = CONSOLES.find((cc) => cc.id === m.consoleIds[0])
                            if (targetC) {
                              openOrWalkToConsole(targetC)
                            } else {
                              const dest = QUADRANT_DEFS[m.role].entryPoint
                              teleportActivePlayerTo(dest.x, dest.y, mOwner.animalName, mOwner.color)
                            }
                          }}
                          className="w-full text-left px-1.5 py-1 border border-slate-800 bg-[#0b1022]/75 hover:border-cyan-500/50 text-[7px]"
                        >
                          <div className="flex items-center justify-between text-[6px]" style={{ color: mOwner.color }}>
                            <span>
                              ⏳ {mOwner.icon} {m.quadrantTag}
                            </span>
                            <span>GO ▶</span>
                          </div>
                          <div className="text-gray-200 truncate mt-0.5">{m.title}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* ✅ HISTORIAL COMPLETADAS EN ETAPA */}
                {completedBacklog.length > 0 && (
                  <div>
                    <div className="text-[7px] text-cyan-300 font-bold mb-1">
                      📊 STAGE LOG ({resolvedCount}/{missionTargetCount})
                    </div>
                    <div className="flex flex-col gap-1">
                      {completedBacklog.map((m) => (
                        <div
                          key={m.id}
                          className="px-1.5 py-1 border border-slate-800 bg-[#070d1c] text-[6.5px] text-emerald-200 truncate"
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
            🕹️ <strong className="text-yellow-300">WASD / Arrows / Click</strong> · Interact:{' '}
            <strong className="text-cyan-300">[E] / SPACE</strong>
          </div>
        </div>
      </div>

      {/* =====================================================================
          MINIJUEGOS DEL EQUIPO (MODAL GRANDE AL PRESIONAR "E" EN LA CONSOLA DEL ROL)
         ===================================================================== */}
      {activeMinigame && (
        <MinigameFrame
          game={activeMinigame}
          file={MINIGAME_META[activeMinigame].file}
          title={MINIGAME_META[activeMinigame].title}
          accent={MINIGAME_META[activeMinigame].accent}
          query={activeMinigame === 'nav' ? `sat=${navSatTarget}` : undefined}
          onClose={closeMinigame}
          onComplete={handleMinigameComplete}
          onFail={handleMinigameFail}
          {...liveThreatProps}
        />
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
                      NASA TERMINAL · {openConsole.zoneName}
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
                  {openConsoleTask ? '⚠️ ACTION REQUIRED' : '✅ SUBSYSTEM NOMINAL'}
                </span>
              </div>

              {/* Estado Actual del Subsistema */}
              <div className="p-3.5 mb-4 bg-[#101b38] border-2 border-black">
                <div className="flex items-center justify-between text-[12px] sm:text-[13px] text-cyan-200 mb-1.5">
                  <span>SUBSYSTEM: {openConsole.subsystemLabel}</span>
                  <span className="font-bold text-white">
                    OPERATOR: {ROLE_INFO[openConsole.role].icon} {ROLE_INFO[openConsole.role].code}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px] mt-2">
                  <div className="p-2 bg-[#080d1c] border border-slate-700">
                    <div className="text-yellow-300 text-[10px]">⚡ ENERGY</div>
                    <div className="text-[14px] font-bold text-white mt-0.5">{Math.round(battery)}%</div>
                  </div>
                  <div className="p-2 bg-[#080d1c] border border-slate-700">
                    <div className="text-cyan-300 text-[10px]">🫧 LIFE O2</div>
                    <div className="text-[14px] font-bold text-white mt-0.5">{Math.round(lifeSupport)}%</div>
                  </div>
                  <div className="p-2 bg-[#080d1c] border border-slate-700">
                    <div className="text-emerald-300 text-[10px]">💾 BUFFER</div>
                    <div className="text-[14px] font-bold text-white mt-0.5">{Math.round(dataBuffer)}%</div>
                  </div>
                  <div className="p-2 bg-[#080d1c] border border-slate-700">
                    <div className="text-purple-300 text-[10px]">🧭 ORBIT</div>
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
                    ? `🎯 ${openConsoleTask.kind === 'problem' ? 'ACTIVE ANOMALY' : 'ACTIVE MISSION'}: ${
                        openConsoleTask.title
                      }`
                    : `📋 CONSOLE DIAGNOSTICS: ${openConsole.shortLabel}`}
                </div>
                <p className="text-[13px] sm:text-[14px] text-gray-100 leading-relaxed">
                  {openConsoleTask ? openConsoleTask.reason : openConsole.hint}
                </p>
                <div className="mt-3 pt-2.5 border-t border-slate-700 text-[12px] sm:text-[13px] text-emerald-300 leading-relaxed">
                  <strong>OPERATION EFFECT:</strong> {openConsole.hint}
                </div>
              </div>

              {/* Último mensaje de la tripulación */}
              {lastLog && (
                <div className="p-3 mb-5 bg-[#060913] border-l-4 border-yellow-400 text-[12px] sm:text-[13px] text-gray-300 leading-relaxed">
                  <strong className="text-yellow-300">📻 COMMS LOG: </strong>
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
                  [ ESC / CLOSE ]
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
                  [ ⚡ EXECUTE / RESOLVE (SPACE / ENTER) ]
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          CINEMÁTICAS OFICIALES DE VICTORIA Y CUADRO DE HONOR NASA
         ===================================================================== */}
      {missionCompleted && victoryPhase !== 'none' && (
        <VictoryCinematicModal
          phase={victoryPhase}
          missionDef={activeMissionDef}
          nextMissionId={nextMissionId}
          baseSciencePoints={officialScience}
          stationHealth={stationHealth}
          resolvedCount={resolvedCount}
          missionTargetCount={missionTargetCount}
          roleResolvedCounts={roleResolvedCounts}
          pilotNamesByRole={pilotNamesByRole}
          chassisName={chassis.name}
          launcherName={launcher.name}
          isReplayCinematic={victoryReplayMode}
          laserNonce={laserCinematicNonce}
          returnHomeNonce={returnHomeCinematicNonce}
          onLaserNext={() => {
            if (victoryReplayMode) {
              setVictoryReplayMode(false)
              setVictoryPhase(activeMissionDef.number === 3 ? 'final_honor_roll' : 'stage_summary')
            } else if (activeMissionDef.number === 3) {
              setReturnHomeCinematicNonce((n) => n + 1)
              setVictoryPhase('return_home_cinematic')
            } else {
              setVictoryPhase('stage_summary')
            }
          }}
          onReturnHomeFinished={() => {
            setVictoryReplayMode(false)
            setVictoryPhase('final_honor_roll')
          }}
          onContinueNextMission={(totalScore) => {
            playClick()
            if (!nextMissionId) return
            advancingMissionLockUntilRef.current = Date.now() + 2500
            setSyncedMissionId(nextMissionId)
            setVictoryPhase('none')
            setVictoryReplayMode(false)
            setMissionCompleted(false)
            if (onAdvanceMission) {
              onAdvanceMission(nextMissionId, totalScore)
            }
          }}
          onReplayReturnHome={() => {
            playClick()
            setVictoryReplayMode(true)
            setReturnHomeCinematicNonce((n) => n + 1)
            setVictoryPhase('return_home_cinematic')
          }}
          onReplayLaser={() => {
            playClick()
            setVictoryReplayMode(true)
            setLaserCinematicNonce((n) => n + 1)
            setVictoryPhase('laser_cinematic')
          }}
          onOpenTelemetryReport={() => {
            playClick()
            onOpenTelemetryReport()
          }}
          onContinueInStation={() => {
            playClick()
            setVictoryPhase('none')
            setVictoryReplayMode(false)
            setMissionCompleted(false)
          }}
          onExitToMenu={() => {
            playClick()
            setVictoryPhase('none')
            setVictoryReplayMode(false)
            setMissionCompleted(false)
            onExitToMenu()
          }}
        />
      )}

      {/* =====================================================================
          MODAL PIXEL-ART: SELECTOR DE ESPECIALISTA DEL ESCUADRÓN ANDINO (MULTI-PC LAN)
         ===================================================================== */}
      <AnimatePresence>
        {roleLobbyOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.94, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
              className="w-full max-w-5xl max-h-[92vh] overflow-y-auto bg-[#101428] border-4 border-[#5ef0ff] shadow-[0_0_32px_rgba(34,211,238,0.35)] p-4 sm:p-5"
            >
              {/* Cabecera */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#232b4f] pb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] sm:text-xs font-bold tracking-wider text-[#5ef0ff]">
                      🛰️ ANDEAN SQUADRON SPECIALIST SELECT
                    </span>
                    <span
                      className="text-[8px] sm:text-[9px] px-2 py-0.5 border font-bold"
                      style={{
                        background: soloPracticeMode ? '#1e293b' : syncConnected ? '#052e16' : '#3b0712',
                        borderColor: soloPracticeMode ? '#facc15' : syncConnected ? '#4ade80' : '#f87171',
                        color: soloPracticeMode ? '#fde047' : syncConnected ? '#86efac' : '#fca5a5',
                      }}
                    >
                      {soloPracticeMode
                        ? '🎮 SOLO PRACTICE MODE (UNLOCKED)'
                        : syncConnected
                          ? `🌐 ROOM ${activeRoomCode ?? 'LAN'} REAL-TIME`
                          : '⚠️ RECONNECTING LAN (/api/roles-sync)'}
                    </span>
                  </div>
                  <p className="text-[9px] sm:text-[10px] text-slate-300 mt-1">
                    {soloPracticeMode
                      ? 'Control all 4 specialists freely from this workstation (keys 1–4). Your changes do not lock the LAN room.'
                      : 'Each workstation on the local network claims one unique specialist. Once claimed, it remains locked to others until released or disconnected.'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onMouseEnter={playHover}
                    onClick={() => {
                      playClick()
                      onExitToMenu()
                    }}
                    className="mc-btn px-3 py-1.5 text-[9px] sm:text-[10px]"
                    style={{ background: '#3b0712', color: '#fecdd3', borderColor: '#f87171' }}
                  >
                    ← MENU
                  </button>
                  {(soloPracticeMode || myClaimedRole !== null) && (
                    <button
                      onMouseEnter={playHover}
                      onClick={() => {
                        playClick()
                        setRoleLobbyOpen(false)
                      }}
                      className="mc-btn px-3 py-1.5 text-[9px] sm:text-[10px]"
                      style={{ background: '#1e293b', color: '#f8fafc', borderColor: '#94a3b8' }}
                    >
                      ✕ RETURN TO STATION
                    </button>
                  )}
                </div>
              </div>

              {/* Barra de controles: Nombre de operador, Modo Práctica, Liberar, Resetear Host */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 bg-[#090c1a] border-2 border-[#1f294d] p-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <label
                    htmlFor="squadron-player-name"
                    className="text-[8px] sm:text-[9px] text-cyan-300 font-bold whitespace-nowrap"
                  >
                    WORKSTATION CALLSIGN:
                  </label>
                  <input
                    id="squadron-player-name"
                    type="text"
                    maxLength={18}
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value.toUpperCase())}
                    placeholder="OPERATOR-PC"
                    className="bg-[#131830] border-2 border-[#38bdf8] text-[#f8fafc] text-[9px] sm:text-[10px] px-2 py-1 w-44 outline-none focus:border-yellow-300"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!activeRoomCode && (
                    <button
                      onMouseEnter={playHover}
                      onClick={() => {
                        playClick()
                        setSyncErrorMsg(null)
                        if (!soloPracticeMode) {
                          setSoloPracticeMode(true)
                          if (myClaimedRole) {
                            void releaseMyRoleRemote(false)
                          }
                        } else {
                          setSoloPracticeMode(false)
                        }
                      }}
                      className="mc-btn px-2.5 py-1.5 text-[8px] sm:text-[9px]"
                      style={{
                        background: soloPracticeMode ? '#713f12' : '#1b2038',
                        color: soloPracticeMode ? '#fef08a' : '#cbd5e1',
                        borderColor: soloPracticeMode ? '#facc15' : '#475569',
                      }}
                    >
                      {soloPracticeMode ? '✅ LOCAL MODE ACTIVE' : '🛠️ LOCAL MODE'}
                    </button>
                  )}

                  <button
                    disabled={soloPracticeMode || !myClaimedRole}
                    onMouseEnter={soloPracticeMode || !myClaimedRole ? undefined : playHover}
                    onClick={() => void releaseMyRoleRemote(true)}
                    className={`mc-btn px-2.5 py-1.5 text-[8px] sm:text-[9px] ${
                      soloPracticeMode || !myClaimedRole ? 'opacity-45 cursor-not-allowed' : ''
                    }`}
                    style={{ background: '#1e293b', color: '#7dd3fc', borderColor: '#38bdf8' }}
                  >
                    🔓 RELEASE MY ROLE
                  </button>

                  <button
                    onMouseEnter={playHover}
                    onClick={() => void resetRoomHostRemote()}
                    className="mc-btn px-2.5 py-1.5 text-[8px] sm:text-[9px]"
                    style={{ background: '#450a0a', color: '#fca5a5', borderColor: '#ef4444' }}
                  >
                    ↺ RESET ROOM (HOST)
                  </button>
                </div>
              </div>

              {syncErrorMsg && (
                <div className="mt-2.5 px-3 py-2 bg-[#3b0712] border-2 border-red-400 text-red-200 text-[9px] sm:text-[10px]">
                  ⚠️ {syncErrorMsg}
                </div>
              )}

              {/* Tarjetas de los 4 Especialistas */}
              <div className="mt-3.5 grid grid-cols-1 md:grid-cols-2 gap-3">
                {ROLE_ORDER.map((r, idx) => {
                  const info = ROLE_INFO[r]
                  const claim = roleClaims[r]
                  const isMine = soloPracticeMode ? activeRole === r : claim?.clientId === clientId
                  const locked = isRoleLockedByOther(r)
                  const busy = syncBusyRole === r
                  const roleGames = missionGames.map((id) => UNIQUE_MINIGAME_DEFS[id]).filter(
                    (def) => def.role === r
                  )

                  return (
                    <button
                      key={r}
                      type="button"
                      disabled={locked || syncBusyRole !== null}
                      onMouseEnter={locked ? undefined : playHover}
                      onClick={() => {
                        if (locked) return
                        if (!soloPracticeMode && myClaimedRole) {
                          playClick()
                          setVisitingQuadrant(null)
                          setOpenConsoleId(null)
                          actions.setRole(r)
                          setRoleLobbyOpen(false)
                          return
                        }
                        void claimRoleRemote(r)
                      }}
                      className={`text-left p-3 sm:p-3.5 border-4 transition-transform ${
                        locked
                          ? 'opacity-60 cursor-not-allowed grayscale-[30%]'
                          : 'cursor-pointer hover:-translate-y-0.5'
                      }`}
                      style={{
                        background: locked ? '#0b0e1b' : isMine ? '#142646' : '#141933',
                        borderColor: locked
                          ? '#334155'
                          : isMine
                            ? '#7bff9a'
                            : info.color,
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl sm:text-2xl">{info.icon}</span>
                          <div>
                            <div
                              className="text-[10px] sm:text-xs font-bold tracking-wide"
                              style={{ color: locked ? '#94a3b8' : info.color }}
                            >
                              [{idx + 1}] {info.code} · {info.short}
                            </div>
                            <div className="text-[8px] sm:text-[9px] text-slate-300">
                              {info.specialty}
                            </div>
                          </div>
                        </div>

                        <span
                          className="text-[7px] sm:text-[8px] px-1.5 py-0.5 border font-bold whitespace-nowrap"
                          style={{
                            background: locked
                              ? '#1e293b'
                              : isMine
                                ? '#052e16'
                                : '#0b2538',
                            borderColor: locked
                              ? '#64748b'
                              : isMine
                                ? '#4ade80'
                                : '#38bdf8',
                            color: locked
                              ? '#cbd5e1'
                              : isMine
                                ? '#86efac'
                                : '#7dd3fc',
                          }}
                        >
                          {busy
                            ? 'CONNECTING...'
                            : locked
                              ? remotePlayerRoles[r]
                                ? `● ON DECK: ${remotePlayerRoles[r]}`
                                : `🔒 ${claim?.playerName ?? 'CLAIMED'}`
                              : isMine
                                ? '✅ YOUR ACTIVE ROLE'
                                : '🤖 BOT SUPPORT · SELECT'}
                        </span>
                      </div>

                      <div className="mt-2.5 space-y-1">
                        <div className="text-[8px] text-slate-400 font-bold">
                          2 ASSIGNED MINIGAMES:
                        </div>
                        {roleGames.map((mg) => {
                          const done = completedMinigames.has(mg.game)
                          return (
                            <div
                              key={mg.game}
                              className="flex items-center justify-between gap-2 px-2 py-1 bg-[#090c1a] border border-[#232b4f] text-[8px] sm:text-[9px]"
                            >
                              <span className="text-slate-100 truncate">
                                {done ? '✅' : '🕹️'} {mg.title}
                              </span>
                              <span className="text-[#5ef0ff] text-[7px] sm:text-[8px] shrink-0">
                                {mg.quadrantTag}
                              </span>
                            </div>
                          )
                        })}
                      </div>

                      <div className="mt-2.5 flex items-center justify-between text-[8px] font-bold">
                        {locked ? (
                          <span className="text-red-300">
                            🔒 LOCKED BY OTHER PILOT ({claim?.playerName ?? 'LAN'})
                          </span>
                        ) : isMine ? (
                          <span className="text-[#7bff9a]">
                            ▶ CLICK TO DEPLOY AS {info.code}
                          </span>
                        ) : (
                          <span className="text-cyan-300">
                            ▶ CLICK TO DEPLOY
                          </span>
                        )}
                        <span className="text-slate-400">{info.animalName}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isGameOver && (
        <GameOverExplosionModal
          reason={
            gameOverReason ||
            'Orbital integrity collapsed to 0%: catastrophic loss of the space station.'
          }
          missionLabel={`STAGE ${activeMissionDef.number}/3 · ${activeMissionDef.code}`}
          onRetryMission={() => {
            void handleRetryMissionStage()
          }}
          onExitToMenu={onExitToMenu}
        />
      )}
    </div>
  )
}
