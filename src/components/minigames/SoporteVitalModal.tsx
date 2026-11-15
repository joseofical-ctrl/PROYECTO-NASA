import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

export default function SoporteVitalModal(props: MinigameModalProps) {
  return (
    <MinigameFrame
      {...props}
      game="eclss"
      file="soporte_vital.html"
      title="SOPORTE VITAL ECLSS Y TANQUES O2 · ALPACA-1"
      accent="#55efc4"
    />
  )
}
