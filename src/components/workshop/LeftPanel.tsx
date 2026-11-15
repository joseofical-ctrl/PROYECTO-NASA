import { useState } from 'react'
import { CHASSIS, CONTRACTS, LAUNCHERS, PART_BY_ID, PARTS, ROLE_INFO } from '../../game/catalog'
import type { Part, PartCat, RoleId } from '../../game/catalog'
import { actions } from '../../game/store'
import type { GameState } from '../../game/store'
import { missionIdToIndex, sanitizeMissionId } from '../../game/missions'
import { playClick, playHover } from '../../audio'
import { Section } from './ui'

export interface WorkshopOps {
  setContract: (id: string) => void
  setLauncher: (id: string) => void
  setChassis: (id: string) => void
  changePart: (id: string, delta: number) => void
}

function CompactCard({
  active,
  disabled,
  onClick,
  children,
  warn,
  dimmed,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  warn?: boolean
  dimmed?: boolean
}) {
  return (
    <button
      disabled={disabled}
      onMouseEnter={disabled ? undefined : playHover}
      onClick={() => {
        if (disabled) return
        playClick()
        onClick()
      }}
      className={`text-[clamp(8.5px,0.68vw,10px)] text-left px-2 py-1.5 w-full transition-colors min-w-0 ${
        disabled ? 'cursor-not-allowed' : ''
      } ${dimmed ? 'opacity-45 grayscale-[50%]' : ''}`}
      style={{
        background: active ? '#2a3f8f' : '#1b2038',
        color: active ? '#ffff7a' : '#e0e6f5',
        border: `3px solid ${active ? '#fff' : warn ? '#a83232' : '#000'}`,
        boxShadow: active ? 'inset 2px 2px 0 #6f8cff' : 'inset 2px 2px 0 #2f3659',
      }}
    >
      {children}
    </button>
  )
}

function DirectorLeft({
  s,
  ops,
  lockedContractId = null,
  currentMissionIndex,
}: {
  s: GameState
  ops: WorkshopOps
  lockedContractId?: string | null
  currentMissionIndex?: 1 | 2 | 3
}) {
  const contract = CONTRACTS.find((c) => c.id === s.contractId)!
  const activeStage =
    currentMissionIndex ??
    (lockedContractId ? missionIdToIndex(sanitizeMissionId(lockedContractId)) : null)

  return (
    <div className="flex flex-col gap-2">
      <Section title="🎖️ CONTRATOS NASA">
        {CONTRACTS.map((c, idx) => {
          const cardStage = (idx + 1) as 1 | 2 | 3
          const isCampaignLocked = Boolean(lockedContractId && c.id !== lockedContractId)
          const isPastStage = Boolean(activeStage && cardStage < activeStage)
          const isFutureStage = Boolean(activeStage && cardStage > activeStage)
          const isCurrentStage = activeStage ? cardStage === activeStage : c.id === s.contractId

          return (
            <CompactCard
              key={c.id}
              active={isCurrentStage}
              disabled={isCampaignLocked}
              dimmed={isFutureStage}
              onClick={() => ops.setContract(c.id)}
            >
              <div className="text-[clamp(8.5px,0.68vw,10px)] flex items-center justify-between gap-1.5 min-w-0">
                <span className="truncate">
                  {cardStage}. {c.icon} {c.name}
                </span>
                <span className="text-cyan-300 shrink-0">{c.orbit}</span>
              </div>
              <div className="text-[clamp(8px,0.6vw,9px)] flex items-center justify-between text-gray-300 mt-0.5 gap-1">
                <span>💰 ${c.budget}k</span>
                {isPastStage ? (
                  <span className="text-emerald-300 font-bold">✅ COMPLETADA</span>
                ) : isFutureStage ? (
                  <span className="text-slate-400 font-bold">🔒 BLOQUEADA</span>
                ) : lockedContractId ? (
                  <span className="text-yellow-300 font-bold">▶ ETAPA {cardStage}</span>
                ) : (
                  <span>🔬 Meta {c.sciGoal} pts</span>
                )}
              </div>
            </CompactCard>
          )
        })}
      </Section>

      <Section title="🚀 LANZADOR">
        {LAUNCHERS.map((l) => {
          const bad = !l.orbits.includes(contract.orbit)
          return (
              <CompactCard
              key={l.id}
              active={l.id === s.launcherId}
              warn={bad}
              onClick={() => ops.setLauncher(l.id)}
            >
              <div className="text-[clamp(8.5px,0.68vw,10px)] flex items-center justify-between gap-1.5 min-w-0">
                <span className="truncate">
                  {l.icon} {l.name}
                </span>
                <span className="text-yellow-300 shrink-0">💰 ${l.cost}k</span>
              </div>
              <div className="text-[clamp(8px,0.6vw,9px)] flex items-center justify-between text-gray-300 mt-0.5 flex-wrap gap-1">
                <span>
                  ⚖️ {l.capKg}kg · 📦 {l.maxU}U
                </span>
                {bad ? (
                  <span className="text-red-400">❌ Sin {contract.orbit}</span>
                ) : (
                  <span className="text-green-300">✔ {l.orbits.join('/')}</span>
                )}
              </div>
            </CompactCard>
          )
        })}
      </Section>

      <Section title="📦 CHASIS CUBESAT">
        <div className="grid grid-cols-3 gap-1">
          {CHASSIS.map((c) => (
            <CompactCard
              key={c.id}
              active={c.id === s.chassisId}
              onClick={() => ops.setChassis(c.id)}
            >
              <div className="text-[clamp(8.5px,0.68vw,10px)] text-center font-bold">{c.name}</div>
              <div className="text-[clamp(8px,0.6vw,9px)] text-center text-gray-300 mt-0.5">
                {c.mass}kg
              </div>
              <div className="text-[clamp(8px,0.6vw,9px)] text-center text-yellow-300">
                ${c.cost}k
              </div>
            </CompactCard>
          ))}
        </div>
      </Section>
    </div>
  )
}

function mainStatBadge(p: Part): { text: string; color: string; bg: string } {
  if (p.gen) return { text: `⚡ +${p.gen}W`, color: '#ffd23f', bg: '#3a2e0d' }
  if (p.wh) return { text: `🔋 ${p.wh}Wh`, color: '#7bff9a', bg: '#103824' }
  if (p.point) return { text: `🧭 ${Math.round(p.point * 100)}%`, color: '#74c0fc', bg: '#102a45' }
  if (p.krad) return { text: `🛡️ +${p.krad} krad`, color: '#ffd23f', bg: '#382b12' }
  if (p.isp) return { text: `🔥 Isp ${p.isp}s`, color: '#ff9f43', bg: '#3d2010' }
  if (p.sci) return { text: `🔬 +${p.sci} pts`, color: '#55efc4', bg: '#0e3830' }
  if (p.downMbps) return { text: `📡 ${p.downMbps} Mbps`, color: '#74b9ff', bg: '#12284c' }
  return { text: `⚡ -${p.power ?? 0}W`, color: '#ff8a8a', bg: '#3a1515' }
}

type EngTab = 'energy' | 'adcs' | 'shield' | 'thruster'

const ENG_TABS: { id: EngTab; label: string; cats: PartCat[] }[] = [
  { id: 'energy', label: '☀️ Energía', cats: ['solar', 'battery'] },
  { id: 'adcs', label: '🧭 ADCS', cats: ['adcs'] },
  { id: 'shield', label: '🛡️ Blindaje', cats: ['shield'] },
  { id: 'thruster', label: '🔥 Motor', cats: ['thruster'] },
]

function PartRow({
  p,
  s,
  remainingBudget,
  ops,
}: {
  p: Part
  s: GameState
  remainingBudget: number
  ops: WorkshopOps
}) {
  const q = s.parts[p.id] ?? 0
  const main = mainStatBadge(p)
  const chassis = CHASSIS.find((c) => c.id === s.chassisId)!
  const slotsUsed = Object.entries(s.parts).reduce(
    (acc, [pid, cnt]) => acc + (PART_BY_ID[pid]?.slots ?? 0) * cnt,
    0
  )
  const canAdd = q < p.max && (p.slots === 0 || slotsUsed + p.slots <= chassis.units)
  const exceedsBudget = p.cost > remainingBudget

  return (
    <div
      className="px-2 py-1.5 min-w-0"
      style={{
        background: q > 0 ? '#1f3252' : '#191e33',
        border: `3px solid ${q > 0 ? '#74c0fc' : exceedsBudget ? '#7a2222' : '#000'}`,
        boxShadow: 'inset 2px 2px 0 #2d3559',
      }}
    >
      {/* Top Row: Name + [- q/max +] */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <span className="text-[clamp(8.5px,0.68vw,10px)] text-white leading-snug min-w-0 truncate">
          {p.icon} {p.name}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          <button
            className="mc-btn w-5 h-5 text-[9px] !border-[2px] disabled:opacity-40"
            disabled={q <= 0}
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              ops.changePart(p.id, -1)
            }}
          >
            -
          </button>
          <span className="text-[clamp(8px,0.6vw,9px)] w-7 text-center text-yellow-300 font-bold">
            {q}/{p.max}
          </span>
          <button
            className="mc-btn w-5 h-5 text-[9px] !border-[2px] disabled:opacity-40"
            disabled={!canAdd}
            onMouseEnter={playHover}
            onClick={() => {
              playClick()
              ops.changePart(p.id, 1)
            }}
          >
            +
          </button>
        </span>
      </div>

      {/* Bottom Row: Maximum 3 visual badges (Cost, Weight/Slots, Main Stat) */}
      <div className="flex items-center justify-between gap-1 mt-1 flex-wrap">
        <span
          className="text-[clamp(7.5px,0.58vw,9px)] px-1.5 py-0.5 border border-black"
          style={
            exceedsBudget
              ? { background: '#4a1414', color: '#ff8a8a', borderColor: '#ff4d4d' }
              : { background: '#262312', color: '#ffd23f' }
          }
        >
          💰 ${p.cost}k
        </span>
        <span
          className="text-[clamp(7.5px,0.58vw,9px)] px-1.5 py-0.5 border border-black"
          style={{ background: '#1a2035', color: '#cbd5e1' }}
        >
          ⚖️ {p.mass}kg·{p.slots}U
        </span>
        <span
          className="text-[clamp(7.5px,0.58vw,9px)] px-1.5 py-0.5 border border-black font-bold"
          style={{ background: main.bg, color: main.color }}
        >
          {main.text}
        </span>
      </div>
    </div>
  )
}

function EngineerLeft({
  s,
  remainingBudget,
  ops,
}: {
  s: GameState
  remainingBudget: number
  ops: WorkshopOps
}) {
  const [tab, setTab] = useState<EngTab>('energy')
  const activeTab = ENG_TABS.find((t) => t.id === tab)!
  const list = PARTS.filter((p) => activeTab.cats.includes(p.cat))

  return (
    <div className="flex flex-col gap-2">
      {/* 4 Mini-tabs */}
      <div className="grid grid-cols-2 gap-1.5">
        {ENG_TABS.map((t) => {
          const on = t.id === tab
          return (
            <button
              key={t.id}
              onMouseEnter={playHover}
              onClick={() => {
                playClick()
                setTab(t.id)
              }}
              className="text-[9px] py-1.5 px-1.5 text-center"
              style={{
                background: on ? '#ff9f43' : '#1b2038',
                color: on ? '#000' : '#d0d7de',
                border: `2px solid ${on ? '#fff' : '#000'}`,
                fontWeight: on ? 'bold' : 'normal',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        {list.map((p) => (
          <PartRow key={p.id} p={p} s={s} remainingBudget={remainingBudget} ops={ops} />
        ))}
      </div>
    </div>
  )
}

function SimpleRoleParts({
  s,
  role,
  remainingBudget,
  ops,
}: {
  s: GameState
  role: RoleId
  remainingBudget: number
  ops: WorkshopOps
}) {
  const cat: PartCat = role === 'science' ? 'instrument' : 'antenna'
  const title = role === 'science' ? '🔭 INSTRUMENTOS NASA' : '📡 ANTENAS ESPACIALES'
  const color = role === 'science' ? '#55efc4' : '#74b9ff'
  const list = PARTS.filter((p) => p.cat === cat)

  return (
    <Section title={title} color={color}>
      {list.map((p) => (
        <PartRow key={p.id} p={p} s={s} remainingBudget={remainingBudget} ops={ops} />
      ))}
    </Section>
  )
}

export default function LeftPanel({
  s,
  remainingBudget,
  ops = actions,
  assignedRole = null,
  lockedContractId = null,
  currentMissionIndex,
}: {
  s: GameState
  remainingBudget: number
  ops?: WorkshopOps
  assignedRole?: RoleId | null
  lockedContractId?: string | null
  currentMissionIndex?: 1 | 2 | 3
}) {
  const activeInfo = ROLE_INFO[s.activeRole]
  const isOwnSpecialty = assignedRole ? s.activeRole === assignedRole : false

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {assignedRole && (
        <div
          className="px-2 py-1 text-[clamp(8px,0.62vw,9px)] border-2 border-black flex items-center justify-between gap-1.5 min-w-0"
          style={{
            background: isOwnSpecialty ? '#0e3624' : '#1b2442',
            color: isOwnSpecialty ? '#7bff9a' : '#bae6fd',
          }}
        >
          <span className="truncate">
            {isOwnSpecialty ? '⭐ TU ESPECIALIDAD:' : '🤝 ASISTIENDO A:'} {activeInfo.icon} {activeInfo.code}
          </span>
        </div>
      )}
      {s.activeRole === 'director' && (
        <DirectorLeft
          s={s}
          ops={ops}
          lockedContractId={lockedContractId}
          currentMissionIndex={currentMissionIndex}
        />
      )}
      {s.activeRole === 'engineer' && (
        <EngineerLeft s={s} remainingBudget={remainingBudget} ops={ops} />
      )}
      {s.activeRole !== 'director' && s.activeRole !== 'engineer' && (
        <SimpleRoleParts s={s} role={s.activeRole} remainingBudget={remainingBudget} ops={ops} />
      )}
    </div>
  )
}
