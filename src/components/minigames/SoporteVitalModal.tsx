import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

export default function SoporteVitalModal(props: MinigameModalProps) {
  return (
    <MinigameFrame
      {...props}
      game="eclss"
      file="soporte_vital.html"
      title="ECLSS LIFE SUPPORT & O2 TANKS · ALPACA-1"
      accent="#55efc4"
    />
  )
}
