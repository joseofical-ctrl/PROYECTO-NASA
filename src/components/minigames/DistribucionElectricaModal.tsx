import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

export default function DistribucionElectricaModal(props: MinigameModalProps) {
  return (
    <MinigameFrame
      {...props}
      game="eps"
      file="distribucion_electrica.html"
      title="DISTRIBUCIÓN ELÉCTRICA EPS · ALPACA-1"
      accent="#ff9f1c"
    />
  )
}
