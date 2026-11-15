import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

export default function AcoplamientoEspacialModal(props: MinigameModalProps) {
  return (
    <MinigameFrame
      {...props}
      game="dock"
      file="acoplamiento_espacial.html"
      title="ACOPLAMIENTO ESPACIAL Y RENDEZVOUS APAS · CÓNDOR-4"
      accent="#ffd23f"
    />
  )
}
