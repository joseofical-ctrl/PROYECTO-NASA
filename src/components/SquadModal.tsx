import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { X, Users, UserCheck } from 'lucide-react'
import { playClick, playHover } from '../audio'
import { CHARACTER_ORDER, ROLE_INFO } from '../game/catalog'
import type { RoleId } from '../game/catalog'
import CharacterPortrait, { RpgStatBars } from './CharacterPortrait'

export const ROLES = CHARACTER_ORDER.map((r) => ROLE_INFO[r])

interface Props {
  open: boolean
  mode?: 'solo' | 'squad'
  onClose: () => void
  onStart: (
    assign: (RoleId | null)[],
    startRole: RoleId,
    playerNames: Record<RoleId, string>
  ) => void
}

export default function SquadModal({ open, mode = 'squad', onClose, onStart }: Props) {
  // Default slots for 4 characters: 1: Alpaca (engineer), 2: Serpiente (comms), 3: Puma (science), 4: Cóndor (director)
  const [selectedRoles, setSelectedRoles] = useState<Record<RoleId, boolean>>({
    engineer: true,
    comms: mode === 'squad',
    science: mode === 'squad',
    director: true,
  })
  const [startRole, setStartRole] = useState<RoleId>('director')
  const [playerNames, setPlayerNames] = useState<Record<RoleId, string>>({
    engineer: 'Player 1',
    comms: 'Player 2',
    science: 'Player 3',
    director: 'Player 4',
  })

  const toggleCharacter = (role: RoleId) => {
    setSelectedRoles((prev) => {
      const next = { ...prev, [role]: !prev[role] }
      if (next[role]) setStartRole(role)
      return next
    })
  }

  const selectAllSquad = () => {
    playClick()
    setSelectedRoles({ engineer: true, comms: true, science: true, director: true })
  }

  const activeList = CHARACTER_ORDER.filter((r) => selectedRoles[r])
  const count = activeList.length

  const handleLaunch = (forcedStartRole?: RoleId) => {
    const chosenStart = forcedStartRole ?? (selectedRoles[startRole] ? startRole : activeList[0] ?? 'director')
    const assignments: (RoleId | null)[] = CHARACTER_ORDER.map((r) => (selectedRoles[r] ? r : null))
    onStart(assignments, chosenStart, playerNames)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3 bg-black/85"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="mc-panel w-full max-w-6xl max-h-[92vh] overflow-y-auto lg:overflow-hidden p-2.5 sm:p-3.5 font-pixel text-white flex flex-col justify-between"
            initial={{ scale: 0.85, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Arcade Header Compacto */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 pb-2 border-b-4 border-black shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[9px] bg-yellow-400 text-black font-bold">
                    SELECT YOUR ASTRONAUT
                  </span>
                  <span className="text-[9px] text-cyan-300">ANDEAN SPACE SQUADRON</span>
                </div>
                <h2
                  className="text-xs sm:text-sm text-yellow-300 mt-1"
                  style={{ textShadow: '2px 2px 0 #000' }}
                >
                  CREW & ROLE SELECTION (1-4 PLAYERS)
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="mc-btn px-2.5 py-1.5 text-[9px] flex items-center gap-1.5"
                  onMouseEnter={playHover}
                  onClick={selectAllSquad}
                >
                  <Users size={13} /> FULL SQUADRON (4P)
                </button>
                <button
                  className="mc-btn p-1.5"
                  aria-label="Close"
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    onClose()
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* 4 Arcade Character Cards Grid (Compactado sin scroll vertical) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {CHARACTER_ORDER.map((roleId, idx) => {
                const info = ROLE_INFO[roleId]
                const isSelected = selectedRoles[roleId]
                const isLeader = startRole === roleId && isSelected

                return (
                  <motion.div
                    key={roleId}
                    whileHover={{ y: -2 }}
                    className="flex flex-col justify-between p-2 transition-all"
                    style={{
                      background: isSelected ? '#1a2342' : '#121526',
                      border: `3px solid ${isSelected ? info.color : '#000'}`,
                      boxShadow: isSelected
                        ? `inset 0 0 0 2px #000, 0 0 12px ${info.color}44`
                        : 'inset 2px 2px 0 #2a304d',
                    }}
                  >
                    <div>
                      {/* Card Top Header */}
                      <div
                        className="flex items-center justify-between px-2 py-1 mb-1.5 text-[9px]"
                        style={{
                          background: '#090b16',
                          border: '2px solid #000',
                          color: info.color,
                        }}
                      >
                        <span className="truncate">
                          {idx + 1}: {info.fullTitle}
                        </span>
                        <span className="shrink-0 ml-1">{info.icon}</span>
                      </div>

                      {/* Compact Pixel-Art Character Portrait (h-32 / h-36) */}
                      <div
                        className="relative w-full h-32 sm:h-36 mb-1.5 cursor-pointer group"
                        onClick={() => {
                          playClick()
                          toggleCharacter(roleId)
                        }}
                      >
                        <CharacterPortrait
                          characterId={info.characterId}
                          variant="scene"
                          className="w-full h-full"
                        />

                        {/* Top-left RPG Avatar & Bars overlay */}
                        <div
                          className="absolute top-1.5 left-1.5 right-6 p-1 flex items-center gap-1.5 pointer-events-none"
                          style={{
                            background: 'rgba(10, 12, 24, 0.85)',
                            border: '2px solid #000',
                          }}
                        >
                          <CharacterPortrait
                            characterId={info.characterId}
                            variant="avatar"
                            size={24}
                          />
                          <RpgStatBars characterId={info.characterId} compact />
                        </div>

                        {/* P1-P4 Arcade Badge (Left side so it never overlaps ALPACA-1 on right) */}
                        <div
                          className="absolute bottom-1 left-1 px-1.5 py-1 text-[9px] leading-none"
                          style={{
                            background: isSelected ? info.color : '#222',
                            color: isSelected ? '#000' : '#888',
                            border: '2px solid #000',
                          }}
                        >
                          {isSelected ? `P${idx + 1} READY` : `P${idx + 1} OFF`}
                        </div>
                      </div>

                      {/* Role & Specialty Badge */}
                      <div
                        className="px-2 py-1 mb-1.5 text-center"
                        style={{
                          background: '#0b0e1d',
                          border: '2px solid #000',
                        }}
                      >
                        <div className="text-[10px] font-bold truncate" style={{ color: info.color }}>
                          {info.name.toUpperCase()}
                        </div>
                      </div>

                      {/* 1-line Specialty Summary (sin párrafo largo de lore) */}
                      <p className="text-[9px] text-cyan-100 leading-snug truncate mb-1.5" title={info.specialty}>
                        <strong className="text-yellow-300">Spec:</strong> {info.specialty}
                      </p>
                    </div>

                    {/* Player Name Input + Action Buttons */}
                    <div className="pt-1.5 border-t-2 border-black/80 flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[9px] text-gray-400 shrink-0">
                          {info.code}:
                        </label>
                        <input
                          type="text"
                          value={playerNames[roleId]}
                          onChange={(e) =>
                            setPlayerNames((n) => ({ ...n, [roleId]: e.target.value }))
                          }
                          maxLength={18}
                          className="w-full min-w-0 px-2 py-1 text-[9px] font-pixel text-yellow-200 bg-[#080a14] border-2 border-black focus:border-yellow-400 focus:outline-none"
                          placeholder={`Player ${idx + 1}`}
                        />
                      </div>

                      <div className="flex gap-1.5">
                        <button
                          onMouseEnter={playHover}
                          onClick={() => {
                            playClick()
                            toggleCharacter(roleId)
                          }}
                          className="mc-btn flex-1 py-1.5 px-2 text-[9px]"
                          style={
                            isSelected
                              ? {
                                  background: '#1e5a3a',
                                  color: '#7bff9a',
                                  borderColor: '#7bff9a',
                                }
                              : undefined
                          }
                        >
                          {isSelected ? '✔ ASSIGNED' : '+ ASSIGN'}
                        </button>
                        <button
                          onMouseEnter={playHover}
                          onClick={() => {
                            playClick()
                            setSelectedRoles((p) => ({ ...p, [roleId]: true }))
                            setStartRole(roleId)
                            handleLaunch(roleId)
                          }}
                          className="mc-btn py-1.5 px-2.5 text-[9px]"
                          title="Enter Workshop with this crew member"
                          style={isLeader ? { color: '#ffff55' } : undefined}
                        >
                          ▶ PLAY
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>

            {/* Footer Controls Compacto */}
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 pt-2 border-t-4 border-black shrink-0">
              <div className="text-[9px] text-gray-300 flex items-center gap-2">
                <UserCheck size={14} className="text-green-400 shrink-0" />
                <span>
                  ACTIVE ASTRONAUTS: <strong className="text-yellow-300">{count}/4</strong> ·
                  Switch crew with keys <strong className="text-cyan-300">1-4</strong>.
                </span>
              </div>
              <div className="flex gap-2.5">
                <button
                  className="mc-btn px-3.5 py-2 text-[10px]"
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    onClose()
                  }}
                >
                  CANCEL
                </button>
                <button
                  className="mc-btn px-4 py-2 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={count === 0}
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    handleLaunch()
                  }}
                >
                  🚀 ENTER HANGAR ({count}/4)
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
