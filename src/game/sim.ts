import { CHASSIS, CONTRACTS, LAUNCHERS, PART_BY_ID } from './catalog.ts'
import type { RoleId } from './catalog.ts'

export interface Design {
  contractId: string
  launcherId: string
  chassisId: string
  parts: Record<string, number>
}

export interface Check { id: string; label: string; ok: boolean; role: RoleId; detail: string }

export const BUS_LOAD_W = 3 // computadora de a bordo
export const DOD = 0.8 // profundidad de descarga utilizable
export const DUTY = 0.1 // ciclo de trabajo de los instrumentos
const G0 = 9.81

export interface Telemetry {
  // Director & Costos por Rol
  cost: number; budget: number
  roleCosts: Record<RoleId, number>
  mass: number; massCap: number
  slotsUsed: number; slotsCap: number
  orbitReachable: boolean; launcherFitsChassis: boolean
  // Ingeniero
  pointing: number; genW: number; loadW: number; balanceW: number
  eclipseMin: number; eclipseNeedWh: number; batteryWh: number; usableWh: number; eclipseOk: boolean
  dvMs: number; dvReq: number; dvOk: boolean
  krad: number; kradReq: number; kradOk: boolean
  // Científico
  sciPts: number; sciGoal: number; sciFactor: number
  mandatory: { id: string; name: string; have: boolean }[]
  sciMass: number; sciPower: number; sciCost: number
  // Comms
  hasAntenna: boolean; bandOk: boolean
  dataGenMbps: number; downNominal: number; downNetMbps: number; downEffMbps: number
  coverage: number; fsplDb: number; groundGainDb: number; netLossDb: number
  linkOk: boolean
  checks: Check[]
  allOk: boolean
}

export function analyze(d: Design): Telemetry {
  const contract = CONTRACTS.find((c) => c.id === d.contractId)!
  const launcher = LAUNCHERS.find((l) => l.id === d.launcherId)!
  const chassis = CHASSIS.find((c) => c.id === d.chassisId)!
  const installed = Object.entries(d.parts)
    .filter(([, q]) => q > 0)
    .map(([id, q]) => ({ p: PART_BY_ID[id], q }))

  let cost = launcher.cost + chassis.cost
  const roleCosts: Record<RoleId, number> = {
    director: launcher.cost + chassis.cost,
    engineer: 0,
    science: 0,
    comms: 0,
  }
  let mass = chassis.mass
  let slotsUsed = 0
  let genRaw = 0
  let loadW = BUS_LOAD_W
  let batteryWh = 0
  let krad = chassis.krad
  let pointing = 0
  let sciRaw = 0
  let dataGen = 0
  let sciMass = 0, sciPower = 0, sciCost = 0
  let propTot = 0, ispWeighted = 0
  const have = new Set<string>()
  let bestAnt: { nominal: number; bands: string[] } | null = null
  let antNominalMax = 0

  for (const { p, q } of installed) {
    cost += p.cost * q
    roleCosts[p.role] += p.cost * q
    mass += p.mass * q
    slotsUsed += p.slots * q
    genRaw += (p.gen ?? 0) * q
    loadW += (p.power ?? 0) * q
    batteryWh += (p.wh ?? 0) * q
    krad += (p.krad ?? 0) * q
    if (p.point) pointing = Math.max(pointing, p.point)
    if (p.cat === 'instrument') {
      have.add(p.id)
      sciRaw += (p.sci ?? 0) * q
      dataGen += (p.data ?? 0) * q
      sciMass += p.mass * q; sciPower += (p.power ?? 0) * q; sciCost += p.cost * q
    }
    if (p.prop && p.isp) { propTot += p.prop * q; ispWeighted += p.prop * q * p.isp }
    if (p.cat === 'antenna') {
      const bandOkHere = contract.orbit === 'LEO' || !p.bands!.includes('UHF') || p.bands!.length > 1
      const nominal = bandOkHere ? p.downMbps ?? 0 : 0
      if (nominal >= antNominalMax) { antNominalMax = nominal; bestAnt = { nominal, bands: p.bands! } }
    }
  }

  const pointEff = 0.5 + 0.5 * pointing
  const genW = genRaw * pointEff
  const sciFactor = 0.6 + 0.4 * pointing
  const sciPts = sciRaw * sciFactor

  const eclipseNeedWh = (loadW * contract.eclipseMin) / 60 / DOD
  const usableWh = batteryWh * DOD
  const eclipseOk = contract.eclipseMin === 0 || batteryWh >= eclipseNeedWh

  let dvMs = 0
  if (propTot > 0 && mass > propTot) dvMs = (ispWeighted / propTot) * G0 * Math.log(mass / (mass - propTot))

  const fsplDb = 20 * Math.log10(contract.distKm / 500)
  const netLossDb = Math.max(fsplDb - contract.groundGainDb, 0)
  const hasAntenna = bestAnt !== null
  const downNominal = bestAnt ? (bestAnt as { nominal: number }).nominal : 0
  const downNetMbps = downNominal * Math.pow(10, -netLossDb / 10)
  const downEffMbps = downNetMbps * contract.coverage
  const dataGenMbps = dataGen * DUTY
  const bandOk = !hasAntenna ? false : downNominal > 0
  const linkOk = hasAntenna && downEffMbps >= dataGenMbps && bandOk

  const mandatory = contract.mandatory.map((id) => ({ id, name: PART_BY_ID[id].name, have: have.has(id) }))
  const orbitReachable = launcher.orbits.includes(contract.orbit)
  const launcherFitsChassis = chassis.units <= launcher.maxU

  const tel = {
    cost, budget: contract.budget, roleCosts, mass, massCap: launcher.capKg, slotsUsed, slotsCap: chassis.units,
    orbitReachable, launcherFitsChassis,
    pointing, genW, loadW, balanceW: genW - loadW,
    eclipseMin: contract.eclipseMin, eclipseNeedWh, batteryWh, usableWh, eclipseOk,
    dvMs, dvReq: contract.dvReq, dvOk: dvMs >= contract.dvReq,
    krad, kradReq: contract.kradReq, kradOk: krad >= contract.kradReq,
    sciPts, sciGoal: contract.sciGoal, sciFactor, mandatory, sciMass, sciPower, sciCost,
    hasAntenna, bandOk, dataGenMbps, downNominal, downNetMbps, downEffMbps,
    coverage: contract.coverage, fsplDb, groundGainDb: contract.groundGainDb, netLossDb, linkOk,
  }

  const f1 = (n: number) => n.toFixed(1)
  const checks: Check[] = [
    { id: 'orbit', role: 'director', label: 'Launcher reaches orbit', ok: orbitReachable && launcherFitsChassis, detail: !orbitReachable ? `${launcher.name} cannot reach ${contract.orbit}` : !launcherFitsChassis ? `${launcher.name} supports up to ${launcher.maxU}U` : 'OK' },
    { id: 'budget', role: 'director', label: 'Budget', ok: cost <= contract.budget, detail: `$${cost}k / $${contract.budget}k` },
    { id: 'mass', role: 'director', label: 'Mass vs payload cap', ok: mass <= launcher.capKg, detail: `${f1(mass)} / ${launcher.capKg} kg` },
    { id: 'slots', role: 'director', label: 'Chassis U-slots', ok: slotsUsed <= chassis.units, detail: `${slotsUsed} / ${chassis.units} U` },
    { id: 'power', role: 'engineer', label: 'Power balance', ok: genW >= loadW, detail: `${f1(genW)} W gen / ${f1(loadW)} W` },
    { id: 'eclipse', role: 'engineer', label: 'Eclipse survival', ok: eclipseOk, detail: `${f1(batteryWh)} / ${f1(eclipseNeedWh)} Wh` },
    { id: 'dv', role: 'engineer', label: 'Delta-V', ok: tel.dvOk, detail: `${Math.round(dvMs)} / ${contract.dvReq} m/s` },
    { id: 'krad', role: 'engineer', label: 'Radiation', ok: tel.kradOk, detail: `${krad} / ${contract.kradReq} krad` },
    { id: 'mand', role: 'science', label: 'Mandatory payloads', ok: mandatory.every((m) => m.have), detail: `${mandatory.filter((m) => m.have).length}/${mandatory.length}` },
    { id: 'sci', role: 'science', label: 'Science goal', ok: sciPts >= contract.sciGoal, detail: `${f1(sciPts)} / ${contract.sciGoal} pts` },
    { id: 'link', role: 'comms', label: 'Downlink budget', ok: linkOk, detail: !hasAntenna ? 'No antenna' : !bandOk ? 'Band unsupported' : `${downEffMbps.toFixed(2)} / ${dataGenMbps.toFixed(2)} Mbps` },
  ]
  return { ...tel, checks, allOk: checks.every((c) => c.ok) }
}
