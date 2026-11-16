import MinigameFrame from './MinigameFrame'
import type { MinigameModalProps } from './MinigameFrame'

export default function DistribucionElectricaModal(props: MinigameModalProps) {
  return (
    <MinigameFrame
      {...props}
      game="eps"
      file="distribucion_electrica.html"
      title="EPS ELECTRICAL POWER DISTRIBUTION · ALPACA-1"
      accent="#ff9f1c"
    />
  )
}
