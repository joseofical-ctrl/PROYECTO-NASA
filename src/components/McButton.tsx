import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { playClick, playHover } from '../audio'

interface Props {
  children: ReactNode
  onClick?: () => void
  className?: string
  delay?: number
}

export default function McButton({ children, onClick, className = '', delay = 0 }: Props) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 18 }}
      onMouseEnter={playHover}
      onFocus={playHover}
      onClick={() => { playClick(); onClick?.() }}
      className={`mc-btn flex items-center justify-center gap-2 text-center ${className}`}
    >
      {children}
    </motion.button>
  )
}
