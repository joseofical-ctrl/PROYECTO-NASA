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
  engineer: 'Jugador 1',
  comms: 'Jugador 2',
  science: 'Jugador 3',
  director: 'Jugador 4',
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

  // ALPACA-1 (Ingeniero) reclama cuando se rompe potencia/eclipse/escudo/dv
  if (newlyBad('power')) {
    out.push(
      msg(
        'engineer',
        actor,
        'warn',
        `"¡Oye ${whoTag}, al ${what} dejaste la nave en déficit eléctrico (${f(a.genW)}W gen vs ${f(a.loadW)}W consumo)! ¡Necesito instalar paneles solares más grandes!"`
      )
    )
  }
  if (newlyBad('eclipse')) {
    out.push(
      msg(
        'engineer',
        actor,
        'warn',
        `"¡Cuidado ${whoTag}! Con ${what} las baterías Li-Ion no aguantan el eclipse: nos faltan ${f(a.eclipseNeedWh - a.batteryWh)} Wh."`
      )
    )
  }
  if (newlyBad('krad')) {
    out.push(
      msg(
        'engineer',
        actor,
        'warn',
        `"¡Alerta de radiación! El blindaje actual (${a.krad} krad) no soporta los ${a.kradReq} krad de esta órbita. ¡A reforzar con MLI o Tántalo!"`
      )
    )
  }
  if (newlyBad('dv')) {
    out.push(
      msg(
        'engineer',
        actor,
        'warn',
        `"¡${whoTag}, tras ${what} el Delta-V cayó a ${Math.round(a.dvMs)} m/s (mínimo ${a.dvReq} m/s)! Tsiolkovsky no perdona el peso extra."`
      )
    )
  }

  // CÓNDOR-4 (Director) reclama cuando se rompe presupuesto, masa, slots u órbita
  if (newlyBad('budget')) {
    out.push(
      msg(
        'director',
        actor,
        'warn',
        `"¡Equipo (${whoTag}), nos pasamos del presupuesto de $${a.budget}k! Llevamos $${a.cost}k tras ${what}."`
      )
    )
  }
  if (newlyBad('mass')) {
    out.push(
      msg(
        'director',
        actor,
        'warn',
        `"¡Alto ahí ${whoTag}! Al ${what} la masa subió a ${f(a.mass)} kg y supera los ${a.massCap} kg del cohete."`
      )
    )
  }
  if (newlyBad('slots')) {
    out.push(
      msg(
        'director',
        actor,
        'warn',
        `"¡${whoTag}, sobrecarga de bahías! Ocupamos ${a.slotsUsed}U de ${a.slotsCap}U disponibles en el chasis."`
      )
    )
  }
  if (newlyBad('orbit')) {
    out.push(
      msg(
        'director',
        'todos',
        'warn',
        `"¡Atención Centro de Control! El vehículo de lanzamiento o chasis actual no es compatible con la órbita del contrato."`
      )
    )
  }

  // SERPIENTE-2 (Comms) reclama cuando el link budget no da abasto
  if (newlyBad('link')) {
    out.push(
      msg(
        'comms',
        actor,
        'warn',
        `"¡Sss-alerta ${whoTag}! Tras ${what} generamos ${a.dataGenMbps.toFixed(2)} Mbps pero mi antena solo descarga ${a.downEffMbps.toFixed(2)} Mbps. ¡Necesito una antena de mayor ganancia!"`
      )
    )
  }

  // PUMA-3 (Científico) reclama cuando faltan instrumentos o ciencia
  if (newlyBad('mand')) {
    out.push(
      msg(
        'science',
        actor,
        'warn',
        `"¡Oigan (${whoTag})! Nos faltan instrumentos obligatorios de la NASA para cumplir los objetivos científicos."`
      )
    )
  }
  if (newlyBad('sci')) {
    out.push(
      msg(
        'science',
        actor,
        'warn',
        `"¡${whoTag}, la ciencia cayó a ${f(a.sciPts)} pts (meta ${a.sciGoal} pts)! Mejoremos el apuntado ADCS o instalemos más sensores."`
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
          `"✔ ¡Excelente trabajo equipo! ${check.label} en verde (${check.detail})."`
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
        '"¡Escuadrón Andino, todos los subsistemas están en verde! Listos para autorizar el despegue desde el Centro de Control."'
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
    apply({ contractId: id }, `firmar el contrato ${c.name}`)
    const extra: ChatMsg[] = [
      msg(
        'director',
        'todos',
        'info',
        `"Nuevo contrato firmado: ${c.name}. Instrumentos obligatorios para 🐆 PUMA-3 → ${c.mandatory.map((m) => PART_BY_ID[m].name).join(' + ')}. Meta: ${c.sciGoal} pts, ${c.kradReq} krad, ${c.dvReq} m/s."`
      ),
    ]
    set({ ...state, chat: [...state.chat, ...extra].slice(-40) })
  },
  setLauncher(id: string) { apply({ launcherId: id }, `contratar el cohete ${LAUNCHERS.find((l) => l.id === id)!.name}`) },
  setChassis(id: string) {
    const ch = CHASSIS.find((c) => c.id === id)!
    const nextParts: Record<string, number> = { ...state.parts }
    let used = Object.entries(nextParts).reduce((acc, [pid, q]) => acc + (PART_BY_ID[pid]?.slots ?? 0) * q, 0)
    // Si el nuevo chasis es más pequeño, recorta piezas con slots para no dejar más U ocupadas que la capacidad del chasis
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
    apply({ chassisId: id, parts: nextParts }, `cambiar el chasis a ${ch.name}`)
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
              `"¡No caben más módulos en el chasis ${ch.name} (${used}/${ch.units}U)! Retira una pieza o pide a 🦅 CÓNDOR-4 un chasis más grande."`
            ),
          ].slice(-40),
        })
        return
      }
    }
    apply({ parts: { ...state.parts, [id]: q } }, `${delta > 0 ? 'instalar' : 'retirar'} ${p.name}${p.power && delta > 0 ? ` (${p.power} W)` : ''}`, delta > 0 ? id : undefined)
  },
  autoFill() {
    const pr = PRESETS[state.contractId]
    apply(
      { launcherId: pr.launcherId, chassisId: pr.chassisId, parts: { ...pr.parts } },
      `cargar el Preset Óptimo de ${CONTRACTS.find((c) => c.id === state.contractId)!.name}`,
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
          `"¡Preset óptimo cargado para ${CONTRACTS.find((c) => c.id === state.contractId)!.name}! Todos los sistemas en verde; listos para autorizar el despegue."`
        ),
      ].slice(-40),
    })
  },
  clear() {
    apply({ parts: {} }, 'vaciar los módulos del hangar')
  },
  post(m: ChatMsg) { set({ ...state, chat: [...state.chat, m].slice(-40) }) },
  initWorkshop(assignments: (RoleId | null)[], startRole: RoleId, playerNames?: Record<RoleId, string>) {
    const names = playerNames ? { ...DEFAULT_NAMES, ...playerNames } : { ...DEFAULT_NAMES }
    set({
      ...DEFAULT_DESIGN,
      activeRole: startRole,
      assignments,
      playerNames: names,
      lastInstall: null,
      lastCostEvent: null,
      chat: [
        msg('director', 'todos', 'info', `"¡Escuadrón Andino reportándose en el Hangar! Contrato inicial: Andes LEO. Usen las teclas 1-4 para alternar entre CÓNDOR-4, ALPACA-1, PUMA-3 y SERPIENTE-2."`),
        msg('engineer', 'science', 'info', `"¡Oye 🐆 PUMA-3, avísame qué cámaras e instrumentos vas a montar para dimensionar los paneles solares y las baterías Li-Ion!"`),
      ],
    })
  },
}

export { msg as makeMsg }
