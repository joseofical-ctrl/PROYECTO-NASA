import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

export default function AcoplamientoEspacialModal(props: MinigameModalProps) {
  return (
    <MinigameFrame
      {...props}
      game="dock"
      file="acoplamiento_espacial.html"
      title="APAS SPACECRAFT DOCKING & RENDEZVOUS · CONDOR-4"
      accent="#ffd23f"
    />
  )
}
