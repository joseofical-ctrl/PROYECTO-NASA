import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

interface Props extends MinigameModalProps {
  satTarget?: 'sat1' | 'sat2'
}

export default function NavegacionOrbitalModal({ satTarget = 'sat1', ...props }: Props) {
  return (
    <MinigameFrame
      {...props}
      game="nav"
      file="navegacion_orbital.html"
      query={`sat=${satTarget}`}
      title="NAVEGACIÓN ORBITAL HOHMANN DUAL · SAT-01 AMARU-COMMS / SAT-02 INTI-SCIENCE"
      accent="#74b9ff"
    />
  )
}
