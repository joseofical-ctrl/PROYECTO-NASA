import { useSyncExternalStore } from 'react'
import { CHASSIS, CONTRACTS, LAUNCHERS, PART_BY_ID, PRESETS, ROLE_INFO } from './catalog'
import type { RoleId } from './catalog'
import { analyze } from './sim'
import type { Design, Telemetry } from './sim'

export type MsgKind = 'warn' | 'ok' | 'info'
export interface ChatMsg { id: number; from: RoleId | 'sistema'; to: RoleId | 'todos'; kind: MsgKind; text: string }

export interface CostFeedback {
  id: number
  deltaCost: number
  role: RoleId
  label: string
}

export interface GameState extends Design {
  activeRole: RoleId
  assignments: (RoleId | null)[]
  playerNames: Record<RoleId, string>
  chat: ChatMsg[]
  lastInstall: { id: string; at: number } | null
  lastCostEvent: CostFeedback | null
}

const DEFAULT_DESIGN: Design = { contractId: 'andes', launcherId: 'rideshare', chassisId: '6U', parts: {} }

const DEFAULT_NAMES: Record<RoleId, string> = {
  engineer: 'Player 1',
  comms: 'Player 2',
  science: 'Player 3',
  director: 'Player 4',
}

let msgId = 0
let costEventId = 0
const msg = (from: ChatMsg['from'], to: ChatMsg['to'], kind: MsgKind, text: string): ChatMsg => ({ id: ++msgId, from, to, kind, text })

let state: GameState = {
  ...DEFAULT_DESIGN,
  activeRole: 'director',
  assignments: ['director', null, null, null],
  playerNames: { ...DEFAULT_NAMES },
  chat: [],
  lastInstall: null,
  lastCostEvent: null,
}
const listeners = new Set<() => void>()
const set = (s: GameState) => { state = s; listeners.forEach((l) => l()) }

export const getState = () => state
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useGame = (): GameState => useSyncExternalStore(subscribe, getState)

const design = (s: GameState): Design => ({ contractId: s.contractId, launcherId: s.launcherId, chassisId: s.chassisId, parts: s.parts })

/** Genera diálogos RPG entre los 4 personajes del Escuadrón Andino comparando telemetría antes/después de una acción. */
function conflicts(actor: RoleId, what: string, b: Telemetry, a: Telemetry, after: GameState): ChatMsg[] {
  const out: ChatMsg[] = []
  const actorInfo = ROLE_INFO[actor]
  const whoTag = `${actorInfo.icon} ${actorInfo.code}`
  const f = (n: number) => n.toFixed(1)
  const newlyBad = (id: string) => {
    const x = b.checks.find((c) => c.id === id)!, y = a.checks.find((c) => c.id === id)!
    return x.ok && !y.ok
  }
  const newlyGood = (id: string) => {
    const x = b.checks.find((c) => c.id === id)!, y = a.checks.find((c) => c.id === id)!
    return !x.ok && y.ok
  }

  // ALPACA-1 (Engineer) flags power/eclipse/shielding/dv issues
  if (newlyBad('power')) {
    out.push(
      msg(
        'engineer',
        actor,
        'warn',
        `"Hey ${whoTag}, after ${what}, power dropped into deficit (${f(a.genW)}W gen vs ${f(a.loadW)}W load)! We need larger solar arrays!"`
      )
    )
  }
  if (newlyBad('eclipse')) {
    out.push(
      msg(
        'engineer',
        actor,
        'warn',
        `"Heads up ${whoTag}! After ${what}, our Li-Ion batteries can't survive eclipse: short by ${f(a.eclipseNeedWh - a.batteryWh)} Wh."`
      )
    )
  }
  if (newlyBad('krad')) {
    out.push(
      msg(
        'engineer',
        actor,
        'warn',
        `"Radiation alert! Current shielding (${a.krad} krad) cannot handle ${a.kradReq} krad in this orbit. Reinforce with MLI or Ta/W!"`
      )
    )
  }
  if (newlyBad('dv')) {
    out.push(
      msg(
        'engineer',
        actor,
        'warn',
        `"${whoTag}, after ${what}, Delta-V fell to ${Math.round(a.dvMs)} m/s (minimum ${a.dvReq} m/s)! Tsiolkovsky is unforgiving with extra mass."`
      )
    )
  }

  // CONDOR-4 (Director) flags budget, mass, slots, or orbit compatibility
  if (newlyBad('budget')) {
    out.push(
      msg(
        'director',
        actor,
        'warn',
        `"Team (${whoTag}), we exceeded the $${a.budget}k budget! Total cost hit $${a.cost}k after ${what}."`
      )
    )
  }
  if (newlyBad('mass')) {
    out.push(
      msg(
        'director',
        actor,
        'warn',
        `"Hold on ${whoTag}! After ${what}, wet mass climbed to ${f(a.mass)} kg and exceeds the rocket's ${a.massCap} kg limit."`
      )
    )
  }
  if (newlyBad('slots')) {
    out.push(
      msg(
        'director',
        actor,
        'warn',
        `"${whoTag}, bay overload! We are using ${a.slotsUsed}U out of ${a.slotsCap}U available in this chassis."`
      )
    )
  }
  if (newlyBad('orbit')) {
    out.push(
      msg(
        'director',
        'todos',
        'warn',
        `"Flight Control alert! The current launch vehicle or chassis is incompatible with this contract orbit."`
      )
    )
  }

  // SERPIENTE-2 (Comms) flags link budget deficits
  if (newlyBad('link')) {
    out.push(
      msg(
        'comms',
        actor,
        'warn',
        `"Sss-alert ${whoTag}! After ${what}, payloads produce ${a.dataGenMbps.toFixed(2)} Mbps but downlink only handles ${a.downEffMbps.toFixed(2)} Mbps. Need a higher-gain antenna!"`
      )
    )
  }

  // PUMA-3 (Science) flags missing payloads or science goals
  if (newlyBad('mand')) {
    out.push(
      msg(
        'science',
        actor,
        'warn',
        `"Team (${whoTag})! We are missing mandatory NASA instruments required to meet science objectives."`
      )
    )
  }
  if (newlyBad('sci')) {
    out.push(
      msg(
        'science',
        actor,
        'warn',
        `"${whoTag}, science output dropped to ${f(a.sciPts)} pts (goal ${a.sciGoal} pts)! Upgrade ADCS pointing or add more instruments."`
      )
    )
  }

  for (const id of ['power', 'eclipse', 'link', 'mass', 'budget', 'dv', 'krad', 'slots', 'sci', 'mand', 'orbit']) {
    if (newlyGood(id)) {
      const check = a.checks.find((c) => c.id === id)!
      out.push(
        msg(
          check.role,
          'todos',
          'ok',
          `"✔ Great work team! ${check.label} is GO (${check.detail})."`
        )
      )
    }
  }

  if (a.allOk && !b.allOk) {
    out.push(
      msg(
        'director',
        'todos',
        'ok',
        '"Andean Squadron, all subsystems are GO! Ready to authorize launch from Flight Control."'
      )
    )
  }
  void after
  return out
}

function apply(next: Partial<GameState>, what: string, installedId?: string) {
  const before = analyze(design(state))
  const merged: GameState = { ...state, ...next }
  const after = analyze(design(merged))
  const extra = conflicts(state.activeRole, what, before, after, merged)
  const deltaCost = after.cost - before.cost
  const lastCostEvent: CostFeedback | null =
    deltaCost !== 0
      ? {
          id: ++costEventId,
          deltaCost,
          role: state.activeRole,
          label: what,
        }
      : state.lastCostEvent

  set({
    ...merged,
    chat: [...state.chat, ...extra].slice(-40),
    lastInstall: installedId ? { id: installedId, at: performance.now() } : state.lastInstall,
    lastCostEvent,
  })
}

export const actions = {
  setRole(r: RoleId) { set({ ...state, activeRole: r }) },
  setContract(id: string) {
    const c = CONTRACTS.find((x) => x.id === id)!
    apply({ contractId: id }, `signing ${c.name} contract`)
    const extra: ChatMsg[] = [
      msg(
        'director',
        'todos',
        'info',
        `"New contract signed: ${c.name}. Mandatory payloads for 🐆 PUMA-3 -> ${c.mandatory.map((m) => PART_BY_ID[m].name).join(' + ')}. Target: ${c.sciGoal} pts, ${c.kradReq} krad, ${c.dvReq} m/s."`
      ),
    ]
    set({ ...state, chat: [...state.chat, ...extra].slice(-40) })
  },
  setLauncher(id: string) { apply({ launcherId: id }, `selecting ${LAUNCHERS.find((l) => l.id === id)!.name} launcher`) },
  setChassis(id: string) {
    const ch = CHASSIS.find((c) => c.id === id)!
    const nextParts: Record<string, number> = { ...state.parts }
    let used = Object.entries(nextParts).reduce((acc, [pid, q]) => acc + (PART_BY_ID[pid]?.slots ?? 0) * q, 0)
    // If downsizing chassis, trim slotted modules to fit U capacity
    if (used > ch.units) {
      for (const [pid] of Object.entries(nextParts).reverse()) {
        const s = PART_BY_ID[pid]?.slots ?? 0
        if (s <= 0) continue
        while (nextParts[pid] > 0 && used > ch.units) {
          nextParts[pid]--
          used -= s
        }
      }
    }
    apply({ chassisId: id, parts: nextParts }, `resizing chassis to ${ch.name}`)
  },
  changePart(id: string, delta: number) {
    const p = PART_BY_ID[id]
    const cur = state.parts[id] ?? 0
    const q = Math.max(0, Math.min(p.max, cur + delta))
    if (q === cur) return
    if (delta > 0 && p.slots > 0) {
      const ch = CHASSIS.find((c) => c.id === state.chassisId)!
      const used = Object.entries(state.parts).reduce(
        (acc, [pid, cnt]) => acc + (PART_BY_ID[pid]?.slots ?? 0) * cnt,
        0
      )
      if (used + p.slots > ch.units) {
        set({
          ...state,
          chat: [
            ...state.chat,
            msg(
              'director',
              state.activeRole,
              'warn',
              `"No more modules fit inside the ${ch.name} chassis (${used}/${ch.units}U)! Remove a part or ask 🦅 CONDOR-4 for a larger bus."`
            ),
          ].slice(-40),
        })
        return
      }
    }
    apply({ parts: { ...state.parts, [id]: q } }, `${delta > 0 ? 'installing' : 'removing'} ${p.name}${p.power && delta > 0 ? ` (${p.power} W)` : ''}`, delta > 0 ? id : undefined)
  },
  autoFill() {
    const pr = PRESETS[state.contractId]
    apply(
      { launcherId: pr.launcherId, chassisId: pr.chassisId, parts: { ...pr.parts } },
      `loading Optimal Preset for ${CONTRACTS.find((c) => c.id === state.contractId)!.name}`,
      'preset'
    )
    set({
      ...state,
      chat: [
        ...state.chat,
        msg(
          'director',
          'todos',
          'ok',
          `"Optimal preset loaded for ${CONTRACTS.find((c) => c.id === state.contractId)!.name}! All systems GO; ready for launch authorization."`
        ),
      ].slice(-40),
    })
  },
  clear() {
    apply({ parts: {} }, 'clearing hangar modules')
  },
  loadDesign(next: Design, note?: { role?: RoleId | 'sistema'; text?: string; kind?: MsgKind; installedId?: string }) {
    const cleanText = note?.text?.trim()
    set({
      ...state,
      contractId: next.contractId,
      launcherId: next.launcherId,
      chassisId: next.chassisId,
      parts: { ...next.parts },
      lastInstall: note?.installedId ? { id: note.installedId, at: Date.now() } : state.lastInstall,
      chat: cleanText
        ? [...state.chat, msg(note?.role ?? 'sistema', 'todos', note?.kind ?? 'info', cleanText)].slice(-40)
        : state.chat,
    })
  },
  setPlayerNames(playerNames: Partial<Record<RoleId, string>>) {
    set({ ...state, playerNames: { ...state.playerNames, ...playerNames } })
  },
  post(m: ChatMsg) { set({ ...state, chat: [...state.chat, m].slice(-40) }) },
  initWorkshop(
    assignments: (RoleId | null)[],
    startRole: RoleId,
    playerNames?: Record<RoleId, string>,
    initialDesign?: Design
  ) {
    const names = playerNames ? { ...DEFAULT_NAMES, ...playerNames } : { ...DEFAULT_NAMES }
    const seedDesign = initialDesign ?? DEFAULT_DESIGN
    set({
      ...seedDesign,
      parts: { ...seedDesign.parts },
      activeRole: startRole,
      assignments,
      playerNames: names,
      lastInstall: null,
      lastCostEvent: null,
      chat: [
        msg('director', 'todos', 'info', `"Andean Squadron reporting to the Hangar! Initial contract: Andes LEO. Use keys 1-4 to switch between CONDOR-4, ALPACA-1, PUMA-3, and SERPIENTE-2."`),
        msg('engineer', 'science', 'info', `"Hey 🐆 PUMA-3, let me know which cameras and payloads we're mounting so I can size the solar arrays and Li-Ion batteries!"`),
      ],
    })
  },
}

export { msg as makeMsg }
