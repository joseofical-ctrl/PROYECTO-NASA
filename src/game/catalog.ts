// Catálogo de componentes, contratos, lanzadores y chasis (valores de juego inspirados en hardware real CubeSat/NASA).
// Costos en k$ (miles de dólares), masas en kg, potencia en W.

export type RoleId = 'director' | 'engineer' | 'science' | 'comms'
export type CharacterId = 'alpaca' | 'serpiente' | 'puma' | 'condor'
export type OrbitId = 'LEO' | 'LLO' | 'L1'
export type PartCat = 'solar' | 'battery' | 'adcs' | 'shield' | 'thruster' | 'instrument' | 'antenna'
export type Band = 'UHF' | 'S' | 'X'

export interface RoleInfo {
  id: RoleId
  characterId: CharacterId
  code: string
  animalName: string
  fullTitle: string
  short: string
  name: string
  icon: string
  color: string
  specialty: string
  lore: string
  hp: number
  sp: number
  spLabel: string
  quadrantPos: string
}

export const ROLE_INFO: Record<RoleId, RoleInfo> = {
  director: {
    id: 'director',
    characterId: 'condor',
    code: 'CONDOR-4',
    animalName: 'CONDOR',
    fullTitle: 'CONDOR ASTRONAUT',
    short: 'DIRECTOR',
    name: 'Mission Flight Director',
    icon: '🦅',
    color: '#ffd23f',
    specialty: 'Flight Control Center, Orbits, Launch Vehicles & Mission Budget',
    lore: 'High-altitude strategic command leading orbital operations from Flight Control.',
    hp: 95,
    sp: 100,
    spLabel: 'LEADERSHIP',
    quadrantPos: '100% 100%',
  },
  engineer: {
    id: 'engineer',
    characterId: 'alpaca',
    code: 'ALPACA-1',
    animalName: 'ALPACA',
    fullTitle: 'ALPACA ASTRONAUT',
    short: 'ENGINEER',
    name: 'Spacecraft & Power Engineer',
    icon: '🦙',
    color: '#ff9f43',
    specialty: 'Solar Arrays, Li-Ion Batteries, MLI Thermal Control & Propulsion',
    lore: 'Master of Andean thermal insulation and EPS power distribution in the hangar.',
    hp: 100,
    sp: 92,
    spLabel: 'POWER',
    quadrantPos: '0% 0%',
  },
  science: {
    id: 'science',
    characterId: 'puma',
    code: 'PUMA-3',
    animalName: 'PUMA',
    fullTitle: 'PUMA ASTRONAUT',
    short: 'SCIENCE',
    name: 'Chief Science Officer',
    icon: '🐆',
    color: '#55efc4',
    specialty: 'Scientific Payloads, Multispectral Cameras, Spectrometers & Planetary Exploration',
    lore: 'Relentless tracker of lunar water ice and climate anomalies across the solar system.',
    hp: 92,
    sp: 98,
    spLabel: 'SCIENCE',
    quadrantPos: '0% 100%',
  },
  comms: {
    id: 'comms',
    characterId: 'serpiente',
    code: 'SERPIENTE-2',
    animalName: 'SERPIENTE',
    fullTitle: 'SERPIENTE ASTRONAUT',
    short: 'COMMS',
    name: 'Telecom & Cyber Specialist',
    icon: '🐍',
    color: '#74b9ff',
    specialty: 'UHF / X-Band Antennas, RF Waveform & Deep Space Link Budget',
    lore: 'Commands high-gain frequencies and encrypted deep-space telemetry from the comms bay.',
    hp: 88,
    sp: 96,
    spLabel: 'FREQUENCY',
    quadrantPos: '100% 0%',
  },
}
export const ROLE_ORDER: RoleId[] = ['director', 'engineer', 'science', 'comms']
export const CHARACTER_ORDER: RoleId[] = ['engineer', 'comms', 'science', 'director'] // 1: Alpaca, 2: Serpiente, 3: Puma, 4: Condor

export interface Contract {
  id: string; name: string; orbit: OrbitId; icon: string; desc: string
  budget: number; sciGoal: number; dvReq: number; kradReq: number
  eclipseMin: number // eclipse duration per orbit (minutes)
  mandatory: string[] // mandatory instrument IDs
  distKm: number; groundGainDb: number; coverage: number; groundName: string
}

export const CONTRACTS: Contract[] = [
  {
    id: 'andes', name: 'Andes LEO', orbit: 'LEO', icon: '🏔️', desc: 'Andean glacier & hydrological stress observation from 500 km.',
    budget: 1100, sciGoal: 40, dvReq: 0, kradReq: 5, eclipseMin: 35,
    mandatory: ['cam', 'thermal'], distKm: 500, groundGainDb: 0, coverage: 0.15, groundName: 'Andes Ground Station (~15% pass coverage)',
  },
  {
    id: 'luna', name: 'Lunar LLO', orbit: 'LLO', icon: '🌙', desc: 'Low Lunar Orbit: polar water-ice & magnetic field mapping.',
    budget: 2300, sciGoal: 80, dvReq: 200, kradReq: 15, eclipseMin: 45,
    mandatory: ['neutron', 'cam'], distKm: 384400, groundGainDb: 55, coverage: 0.5, groundName: 'DSN 34 m (~50% coverage)',
  },
  {
    id: 'sol', name: 'Sun L1', orbit: 'L1', icon: '☀️', desc: 'Sun-Earth L1 halo orbit: early solar storm & space weather watch.',
    budget: 3000, sciGoal: 90, dvReq: 150, kradReq: 30, eclipseMin: 0,
    mandatory: ['corona', 'mag'], distKm: 1500000, groundGainDb: 58, coverage: 0.4, groundName: 'DSN 70 m (~40% coverage)',
  },
]

export interface Launcher { id: string; name: string; icon: string; cost: number; capKg: number; maxU: number; orbits: OrbitId[]; desc: string }
export const LAUNCHERS: Launcher[] = [
  { id: 'rideshare', name: 'SSO Economy Rideshare', icon: '🚐', cost: 150, capKg: 13, maxU: 6, orbits: ['LEO'], desc: 'Low-cost; LEO only, up to 6U.' },
  { id: 'light', name: 'Dedicated Light Launcher', icon: '🚀', cost: 450, capKg: 24, maxU: 12, orbits: ['LEO', 'LLO'], desc: 'Reaches Lunar LLO.' },
  { id: 'heavy', name: 'Deep Space Heavy Lifter', icon: '🛰️', cost: 850, capKg: 40, maxU: 12, orbits: ['LEO', 'LLO', 'L1'], desc: 'Reaches Sun-Earth L1.' },
]

export interface Chassis { id: string; name: string; units: number; cols: number; rows: number; cost: number; mass: number; krad: number }
export const CHASSIS: Chassis[] = [
  { id: '3U', name: '3U', units: 3, cols: 1, rows: 3, cost: 60, mass: 4, krad: 3 },
  { id: '6U', name: '6U', units: 6, cols: 2, rows: 3, cost: 110, mass: 8, krad: 3 },
  { id: '12U', name: '12U', units: 12, cols: 2, rows: 6, cost: 200, mass: 12, krad: 3 },
]

export interface Part {
  id: string; cat: PartCat; role: RoleId; icon: string; name: string; desc: string
  cost: number; mass: number; slots: number; max: number
  power?: number // power draw W
  gen?: number // power generation W
  wh?: number // battery capacity Wh
  isp?: number; prop?: number // propulsion
  krad?: number // radiation tolerance
  point?: number // pointing accuracy 0-1
  sci?: number; data?: number // science points & Mbps generated
  downMbps?: number; gainDb?: number; bands?: Band[]
}

export const PARTS: Part[] = [
  // ---- Engineer: Solar Arrays
  { id: 'solar_fix', cat: 'solar', role: 'engineer', icon: '▦', name: 'Body-Mounted Solar Panel', desc: 'Cells bonded to chassis walls.', cost: 30, mass: 0.2, slots: 0, max: 4, gen: 6 },
  { id: 'solar_dep', cat: 'solar', role: 'engineer', icon: '▥', name: 'Deployable Solar Wing', desc: 'Hinged deployable solar array.', cost: 90, mass: 0.5, slots: 0, max: 2, gen: 14 },
  { id: 'solar_he', cat: 'solar', role: 'engineer', icon: '▩', name: 'Triple-Junction HE Wing', desc: 'High-efficiency space cells.', cost: 200, mass: 0.9, slots: 0, max: 2, gen: 28 },
  // ---- Batteries
  { id: 'bat20', cat: 'battery', role: 'engineer', icon: '🔋', name: 'Li-Ion 20 Wh Pack', desc: 'Baseline 18650 cell pack.', cost: 40, mass: 0.15, slots: 1, max: 4, wh: 20 },
  { id: 'bat40', cat: 'battery', role: 'engineer', icon: '🔋', name: 'Li-Ion 40 Wh Pack', desc: '4-cell avionics battery pack.', cost: 70, mass: 0.3, slots: 1, max: 3, wh: 40 },
  { id: 'bat90', cat: 'battery', role: 'engineer', icon: '🔋', name: 'Li-Ion 90 Wh Pack', desc: 'Heavy-duty 2U battery pack.', cost: 180, mass: 0.6, slots: 2, max: 2, wh: 90 },
  // ---- ADCS
  { id: 'mtq', cat: 'adcs', role: 'engineer', icon: '🧲', name: 'Magnetorquer Coil', desc: 'Coarse attitude pointing (70%).', cost: 50, mass: 0.3, slots: 1, max: 1, power: 1, point: 0.7 },
  { id: 'rw', cat: 'adcs', role: 'engineer', icon: '🎡', name: '3-Axis Reaction Wheels', desc: 'Fine precision pointing (100%).', cost: 150, mass: 0.8, slots: 2, max: 1, power: 3, point: 1 },
  // ---- Shielding
  { id: 'sh_al', cat: 'shield', role: 'engineer', icon: '🛡️', name: '2 mm Aluminum Shielding', desc: '+5 krad radiation hardening.', cost: 30, mass: 0.5, slots: 0, max: 2, krad: 5 },
  { id: 'sh_ta', cat: 'shield', role: 'engineer', icon: '🥇', name: 'Ta/W Gold-Alloy Shield', desc: '+14 krad. High mass.', cost: 120, mass: 1.5, slots: 0, max: 2, krad: 14 },
  { id: 'sh_mli', cat: 'shield', role: 'engineer', icon: '🧱', name: 'MLI Thermal Blanket', desc: '+1 krad & thermal regulation.', cost: 25, mass: 0.2, slots: 0, max: 1, krad: 1 },
  // ---- Propulsion
  { id: 'th_cold', cat: 'thruster', role: 'engineer', icon: '💨', name: 'Cold-Gas Thruster', desc: 'Isp 65 s, 0.4 kg propellant.', cost: 40, mass: 0.7, slots: 1, max: 2, power: 1, isp: 65, prop: 0.4 },
  { id: 'th_mono', cat: 'thruster', role: 'engineer', icon: '🔥', name: 'Green Monopropellant', desc: 'Isp 220 s, 1.0 kg propellant.', cost: 120, mass: 1.6, slots: 2, max: 2, power: 3, isp: 220, prop: 1.0 },
  { id: 'th_ion', cat: 'thruster', role: 'engineer', icon: '✨', name: 'Hall/Ion Thruster', desc: 'Isp 800 s, 0.6 kg Xenon.', cost: 220, mass: 1.0, slots: 2, max: 2, power: 8, isp: 800, prop: 0.6 },
  // ---- Science Instruments
  { id: 'cam', cat: 'instrument', role: 'science', icon: '📷', name: 'Multispectral Camera', desc: 'VIS/NIR imagery. High power draw.', cost: 140, mass: 1.2, slots: 2, max: 1, power: 12, sci: 30, data: 2.0 },
  { id: 'thermal', cat: 'instrument', role: 'science', icon: '🌡️', name: 'Thermal IR Sensor', desc: 'Infrared thermal radiometer.', cost: 90, mass: 0.6, slots: 1, max: 1, power: 4, sci: 20, data: 0.5 },
  { id: 'neutron', cat: 'instrument', role: 'science', icon: '☢️', name: 'Neutron Spectrometer', desc: 'Detects subsurface water ice.', cost: 200, mass: 1.5, slots: 2, max: 1, power: 6, sci: 40, data: 0.3 },
  { id: 'corona', cat: 'instrument', role: 'science', icon: '🌞', name: 'Solar Coronagraph', desc: 'Monitors solar corona CMEs.', cost: 260, mass: 2.0, slots: 3, max: 1, power: 9, sci: 50, data: 3.0 },
  { id: 'mag', cat: 'instrument', role: 'science', icon: '🧭', name: 'Space Magnetometer', desc: 'Measures magnetic field & solar wind.', cost: 70, mass: 0.3, slots: 1, max: 1, power: 1.5, sci: 25, data: 0.1 },
  // ---- Comms Antennas
  { id: 'uhf', cat: 'antenna', role: 'comms', icon: '📶', name: 'UHF Whip Antenna', desc: 'LEO only. 0.1 Mbps.', cost: 20, mass: 0.1, slots: 1, max: 1, power: 2, downMbps: 0.1, gainDb: 0, bands: ['UHF'] },
  { id: 'spatch', cat: 'antenna', role: 'comms', icon: '📡', name: 'S-Band Patch Array', desc: '2 Mbps, 6 dBi.', cost: 60, mass: 0.2, slots: 1, max: 1, power: 5, downMbps: 2, gainDb: 6, bands: ['S'] },
  { id: 'iris', cat: 'antenna', role: 'comms', icon: '🛰️', name: 'JPL Iris X-Band Transponder', desc: 'DSN deep-space transceiver. 8 Mbps, 12 dBi.', cost: 280, mass: 1.2, slots: 2, max: 1, power: 12, downMbps: 8, gainDb: 12, bands: ['X', 'S'] },
  { id: 'hga', cat: 'antenna', role: 'comms', icon: '🍽️', name: 'High-Gain Reflectarray (HGA)', desc: '40 Mbps, 28 dBi.', cost: 340, mass: 1.5, slots: 3, max: 1, power: 15, downMbps: 40, gainDb: 28, bands: ['X'] },
]

export const PART_BY_ID: Record<string, Part> = Object.fromEntries(PARTS.map((p) => [p.id, p]))
export const CAT_LABEL: Record<PartCat, string> = {
  solar: '☀️ SOLAR ARRAYS', battery: '🔋 Li-Ion BATTERIES', adcs: '🎯 ADCS / WHEELS', shield: '🛡️ SHIELDING', thruster: '🔥 PROPULSION',
  instrument: '🔭 NASA INSTRUMENTS', antenna: '📡 TRANSCEIVERS & ANTENNAS',
}
export const ROLE_CATS: Record<RoleId, PartCat[]> = {
  director: [],
  engineer: ['solar', 'battery', 'adcs', 'shield', 'thruster'],
  science: ['instrument'],
  comms: ['antenna'],
}

/** Presets óptimos (verificados con la simulación) por contrato */
export const PRESETS: Record<string, { launcherId: string; chassisId: string; parts: Record<string, number> }> = {
  andes: { launcherId: 'rideshare', chassisId: '6U', parts: { cam: 1, thermal: 1, mtq: 1, bat20: 1, spatch: 1, solar_dep: 2, solar_fix: 1, sh_al: 1 } },
  luna: { launcherId: 'light', chassisId: '12U', parts: { neutron: 1, cam: 1, mag: 1, rw: 1, bat40: 1, spatch: 1, th_ion: 1, solar_dep: 2, solar_fix: 2, sh_ta: 1 } },
  sol: { launcherId: 'heavy', chassisId: '12U', parts: { corona: 1, mag: 1, thermal: 1, rw: 1, hga: 1, th_ion: 1, solar_dep: 2, solar_fix: 3, sh_ta: 2 } },
}
