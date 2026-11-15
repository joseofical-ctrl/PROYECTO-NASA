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
    code: 'CÓNDOR-4',
    animalName: 'CÓNDOR',
    fullTitle: 'CÓNDOR ASTRONAUTA',
    short: 'DIRECTOR',
    name: 'Director de Misión',
    icon: '🦅',
    color: '#ffd23f',
    specialty: 'Centro de Control, Órbitas, Vehículos de Lanzamiento y Presupuesto',
    lore: 'Visión estratégica desde las alturas para liderar el Centro de Control.',
    hp: 95,
    sp: 100,
    spLabel: 'LIDERAZGO',
    quadrantPos: '100% 100%',
  },
  engineer: {
    id: 'engineer',
    characterId: 'alpaca',
    code: 'ALPACA-1',
    animalName: 'ALPACA',
    fullTitle: 'ALPACA ASTRONAUTA',
    short: 'INGENIERO',
    name: 'Ingeniero de Nave y Energía',
    icon: '🦙',
    color: '#ff9f43',
    specialty: 'Paneles Solares, Baterías, Control Térmico MLI y Propulsión',
    lore: 'Maestro del aislamiento térmico andino y los sistemas de potencia en el hangar.',
    hp: 100,
    sp: 92,
    spLabel: 'POTENCIA',
    quadrantPos: '0% 0%',
  },
  science: {
    id: 'science',
    characterId: 'puma',
    code: 'PUMA-3',
    animalName: 'PUMA',
    fullTitle: 'PUMA ASTRONAUTA',
    short: 'CIENTÍFICO',
    name: 'Oficial Científico',
    icon: '🐆',
    color: '#55efc4',
    specialty: 'Cargas Útiles, Cámaras Multiespectrales, Espectrómetros y Exploración Planetaria',
    lore: 'Rastreador implacable de hielo lunar y anomalías climáticas.',
    hp: 92,
    sp: 98,
    spLabel: 'CIENCIA',
    quadrantPos: '0% 100%',
  },
  comms: {
    id: 'comms',
    characterId: 'serpiente',
    code: 'SERPIENTE-2',
    animalName: 'SERPIENTE',
    fullTitle: 'SERPIENTE ASTRONAUTA',
    short: 'COMMS',
    name: 'Especialista de Comunicaciones',
    icon: '🐍',
    color: '#74b9ff',
    specialty: 'Antenas UHF/Banda X, Ondas de Radio y Link Budget',
    lore: 'Domina las frecuencias sinusoidales y enlaces de espacio profundo desde la cabina.',
    hp: 88,
    sp: 96,
    spLabel: 'FRECUENCIA',
    quadrantPos: '100% 0%',
  },
}
export const ROLE_ORDER: RoleId[] = ['director', 'engineer', 'science', 'comms']
export const CHARACTER_ORDER: RoleId[] = ['engineer', 'comms', 'science', 'director'] // 1: Alpaca, 2: Serpiente, 3: Puma, 4: Cóndor

export interface Contract {
  id: string; name: string; orbit: OrbitId; icon: string; desc: string
  budget: number; sciGoal: number; dvReq: number; kradReq: number
  eclipseMin: number // minutos de eclipse por órbita
  mandatory: string[] // ids de instrumentos obligatorios
  distKm: number; groundGainDb: number; coverage: number; groundName: string
}

export const CONTRACTS: Contract[] = [
  {
    id: 'andes', name: 'Andes LEO', orbit: 'LEO', icon: '🏔️', desc: 'Observación de los Andes desde 500 km.',
    budget: 1100, sciGoal: 40, dvReq: 0, kradReq: 5, eclipseMin: 35,
    mandatory: ['cam', 'thermal'], distKm: 500, groundGainDb: 0, coverage: 0.15, groundName: 'Estación Terrena Andes (pases ~15%)',
  },
  {
    id: 'luna', name: 'Luna LLO', orbit: 'LLO', icon: '🌙', desc: 'Órbita lunar baja: mapeo de hielo y campo magnético.',
    budget: 2300, sciGoal: 80, dvReq: 200, kradReq: 15, eclipseMin: 45,
    mandatory: ['neutron', 'cam'], distKm: 384400, groundGainDb: 55, coverage: 0.5, groundName: 'DSN 34 m (cobertura ~50%)',
  },
  {
    id: 'sol', name: 'Sol L1', orbit: 'L1', icon: '☀️', desc: 'Halo en L1: vigilancia del clima espacial solar.',
    budget: 3000, sciGoal: 90, dvReq: 150, kradReq: 30, eclipseMin: 0,
    mandatory: ['corona', 'mag'], distKm: 1500000, groundGainDb: 58, coverage: 0.4, groundName: 'DSN 70 m (cobertura ~40%)',
  },
]

export interface Launcher { id: string; name: string; icon: string; cost: number; capKg: number; maxU: number; orbits: OrbitId[]; desc: string }
export const LAUNCHERS: Launcher[] = [
  { id: 'rideshare', name: 'Rideshare', icon: '🚐', cost: 150, capKg: 13, maxU: 6, orbits: ['LEO'], desc: 'Barato; solo LEO, hasta 6U.' },
  { id: 'light', name: 'Dedicado Ligero', icon: '🚀', cost: 450, capKg: 24, maxU: 12, orbits: ['LEO', 'LLO'], desc: 'Llega a la Luna.' },
  { id: 'heavy', name: 'Pesado', icon: '🛰️', cost: 850, capKg: 40, maxU: 12, orbits: ['LEO', 'LLO', 'L1'], desc: 'Alcanza L1.' },
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
  power?: number // consumo W
  gen?: number // generación W
  wh?: number // capacidad batería
  isp?: number; prop?: number // propulsor
  krad?: number // blindaje
  point?: number // calidad de apuntado 0-1
  sci?: number; data?: number // ciencia y Mbps generados
  downMbps?: number; gainDb?: number; bands?: Band[]
}

export const PARTS: Part[] = [
  // ---- Ingeniero: solar
  { id: 'solar_fix', cat: 'solar', role: 'engineer', icon: '▦', name: 'Panel fijo de cuerpo', desc: 'Celdas pegadas al chasis.', cost: 30, mass: 0.2, slots: 0, max: 4, gen: 6 },
  { id: 'solar_dep', cat: 'solar', role: 'engineer', icon: '▥', name: 'Ala desplegable', desc: 'Ala solar con bisagras.', cost: 90, mass: 0.5, slots: 0, max: 2, gen: 14 },
  { id: 'solar_he', cat: 'solar', role: 'engineer', icon: '▩', name: 'Ala triple-unión HE', desc: 'Celdas de alta eficiencia.', cost: 200, mass: 0.9, slots: 0, max: 2, gen: 28 },
  // ---- baterías
  { id: 'bat20', cat: 'battery', role: 'engineer', icon: '🔋', name: 'Li-Ion 20 Wh', desc: 'Celda 18650 básica.', cost: 40, mass: 0.15, slots: 1, max: 4, wh: 20 },
  { id: 'bat40', cat: 'battery', role: 'engineer', icon: '🔋', name: 'Li-Ion 40 Wh', desc: 'Pack de 4 celdas.', cost: 70, mass: 0.3, slots: 1, max: 3, wh: 40 },
  { id: 'bat90', cat: 'battery', role: 'engineer', icon: '🔋', name: 'Li-Ion 90 Wh', desc: 'Pack grande, 2U.', cost: 180, mass: 0.6, slots: 2, max: 2, wh: 90 },
  // ---- ADCS
  { id: 'mtq', cat: 'adcs', role: 'engineer', icon: '🧲', name: 'Magnetorquer', desc: 'Apuntado grueso (70%).', cost: 50, mass: 0.3, slots: 1, max: 1, power: 1, point: 0.7 },
  { id: 'rw', cat: 'adcs', role: 'engineer', icon: '🎡', name: 'Ruedas de reacción 3 ejes', desc: 'Apuntado fino (100%).', cost: 150, mass: 0.8, slots: 2, max: 1, power: 3, point: 1 },
  // ---- Blindaje
  { id: 'sh_al', cat: 'shield', role: 'engineer', icon: '🛡️', name: 'Blindaje Aluminio 2 mm', desc: '+5 krad.', cost: 30, mass: 0.5, slots: 0, max: 2, krad: 5 },
  { id: 'sh_ta', cat: 'shield', role: 'engineer', icon: '🥇', name: 'Blindaje Ta/W dorado', desc: '+14 krad. Pesado.', cost: 120, mass: 1.5, slots: 0, max: 2, krad: 14 },
  { id: 'sh_mli', cat: 'shield', role: 'engineer', icon: '🧱', name: 'Manta térmica MLI', desc: '+1 krad, control térmico.', cost: 25, mass: 0.2, slots: 0, max: 1, krad: 1 },
  // ---- Propulsores
  { id: 'th_cold', cat: 'thruster', role: 'engineer', icon: '💨', name: 'Gas frío', desc: 'Isp 65 s, 0.4 kg propelente.', cost: 40, mass: 0.7, slots: 1, max: 2, power: 1, isp: 65, prop: 0.4 },
  { id: 'th_mono', cat: 'thruster', role: 'engineer', icon: '🔥', name: 'Monopropelente verde', desc: 'Isp 220 s, 1.0 kg propelente.', cost: 120, mass: 1.6, slots: 2, max: 2, power: 3, isp: 220, prop: 1.0 },
  { id: 'th_ion', cat: 'thruster', role: 'engineer', icon: '✨', name: 'Propulsor iónico', desc: 'Isp 800 s, 0.6 kg Xe.', cost: 220, mass: 1.0, slots: 2, max: 2, power: 8, isp: 800, prop: 0.6 },
  // ---- Instrumentos (Científico)
  { id: 'cam', cat: 'instrument', role: 'science', icon: '📷', name: 'Cámara Multiespectral', desc: 'Imágenes VIS/NIR. Consume mucha energía.', cost: 140, mass: 1.2, slots: 2, max: 1, power: 12, sci: 30, data: 2.0 },
  { id: 'thermal', cat: 'instrument', role: 'science', icon: '🌡️', name: 'Sensor Térmico IR', desc: 'Radiómetro infrarrojo.', cost: 90, mass: 0.6, slots: 1, max: 1, power: 4, sci: 20, data: 0.5 },
  { id: 'neutron', cat: 'instrument', role: 'science', icon: '☢️', name: 'Espectrómetro de Neutrones', desc: 'Detecta hielo de agua.', cost: 200, mass: 1.5, slots: 2, max: 1, power: 6, sci: 40, data: 0.3 },
  { id: 'corona', cat: 'instrument', role: 'science', icon: '🌞', name: 'Coronógrafo', desc: 'Observa la corona solar.', cost: 260, mass: 2.0, slots: 3, max: 1, power: 9, sci: 50, data: 3.0 },
  { id: 'mag', cat: 'instrument', role: 'science', icon: '🧭', name: 'Magnetómetro', desc: 'Campo magnético / viento solar.', cost: 70, mass: 0.3, slots: 1, max: 1, power: 1.5, sci: 25, data: 0.1 },
  // ---- Antenas (Comms)
  { id: 'uhf', cat: 'antenna', role: 'comms', icon: '📶', name: 'UHF Whip', desc: 'Solo LEO. 0.1 Mbps.', cost: 20, mass: 0.1, slots: 1, max: 1, power: 2, downMbps: 0.1, gainDb: 0, bands: ['UHF'] },
  { id: 'spatch', cat: 'antenna', role: 'comms', icon: '📡', name: 'Banda S Patch', desc: '2 Mbps, 6 dBi.', cost: 60, mass: 0.2, slots: 1, max: 1, power: 5, downMbps: 2, gainDb: 6, bands: ['S'] },
  { id: 'iris', cat: 'antenna', role: 'comms', icon: '🛰️', name: 'JPL Iris Banda X', desc: 'Transpondedor DSN. 8 Mbps, 12 dBi.', cost: 280, mass: 1.2, slots: 2, max: 1, power: 12, downMbps: 8, gainDb: 12, bands: ['X', 'S'] },
  { id: 'hga', cat: 'antenna', role: 'comms', icon: '🍽️', name: 'Reflectarray HGA', desc: '40 Mbps, 28 dBi.', cost: 340, mass: 1.5, slots: 3, max: 1, power: 15, downMbps: 40, gainDb: 28, bands: ['X'] },
]

export const PART_BY_ID: Record<string, Part> = Object.fromEntries(PARTS.map((p) => [p.id, p]))
export const CAT_LABEL: Record<PartCat, string> = {
  solar: '☀️ PANELES SOLARES', battery: '🔋 BATERÍAS Li-Ion', adcs: '🎯 ADCS / RUEDAS', shield: '🛡️ BLINDAJE', thruster: '🔥 PROPULSORES',
  instrument: '🔭 INSTRUMENTOS NASA', antenna: '📡 TRANSCEPTORES Y ANTENAS',
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
